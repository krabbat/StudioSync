"""StudioSync SMTP dispatch scoped to active students of the admin's studio.

The browser supplies student IDs, never recipient addresses for roster entries.
Each unique address gets a private message; siblings sharing one family address
receive exactly one copy. The SMTP credentials never leave the backend.
"""

import imaplib
from email.headerregistry import Address
from email.message import EmailMessage as StandardEmailMessage
from email.policy import SMTPUTF8
import logging
import mimetypes
import os
import smtplib
import uuid
import ssl
from collections import OrderedDict
from email.utils import formataddr, make_msgid

from django.core.exceptions import ValidationError
from django.core.mail import EmailMultiAlternatives, get_connection

from apps.core.international_email import validate_international_email

from apps.core.mail_folders import MailFolderError, resolve_folder
from apps.core.mail_signature import (
    html_mail_with_signature,
    plain_mail_with_signature,
)
from apps.core.mail_service import MailFetchError, _configuration
from apps.core.models import Student
from apps.resources.models import Resource
from apps.core.security import assert_public_host

LOG = logging.getLogger(__name__)
MAX_STUDENTS = 250
MAX_SUBJECT = 220
MAX_BODY = 100_000
MAX_ATTACHMENTS = 8
MAX_TOTAL_ATTACHMENT_SIZE = 12 * 1024 * 1024
MAX_EACH_ATTACHMENT_SIZE = 8 * 1024 * 1024


class MailSendError(Exception):
    """Validated, sanitized outbound mail error."""


def _valid_email(value):
    address = (value or "").strip()
    if not address or address.casefold().endswith(".invalid"):
        return ""
    try:
        return validate_international_email(address)
    except ValidationError:
        return ""


def _recipient_address(student):
    """Prefer a family's designated main parent for general communication."""
    explicit = _valid_email(student.contact_email)
    if explicit:
        return explicit, "Kontakt"
    family = student.family
    if family and family.primary_parent and family.primary_parent.is_active:
        parent_email = _valid_email(family.primary_parent.email)
        if parent_email:
            return parent_email, "Elternkontakt"
    return _valid_email(student.contact_email or student.user.email), "Schüler"


def active_student_recipients(studio):
    students = (
        Student.objects.filter(
            studio=studio,
            is_active=True,
            user__is_active=True,
        )
        .select_related("user", "family__primary_parent")
        .order_by("user__last_name", "user__first_name")
    )
    result = []
    for student in students:
        address, contact_type = _recipient_address(student)
        instruments = []
        extra = student.instruments if isinstance(student.instruments, list) else []
        for value in [student.instrument, *extra]:
            if isinstance(value, str):
                name = value.strip()
                if name and name.casefold() not in {
                    item.casefold() for item in instruments
                }:
                    instruments.append(name)
        result.append({
            "id": str(student.pk),
            "name": student.user.get_full_name().strip() or "Ohne Namen",
            "email": address,
            "contact_type": contact_type,
            "instruments": instruments,
            "selectable": bool(address),
        })
    return result


def _smtp_settings(config):
    host = str(config.get("smtp_host") or "").strip()
    username = str(config.get("smtp_username") or "").strip()
    password = config.get("smtp_password") or ""
    sender = _valid_email(config.get("smtp_from_email"))
    try:
        port = int(config.get("smtp_port") or 0)
    except (TypeError, ValueError) as exc:
        raise MailSendError("Der SMTP-Port ist ungültig.") from exc

    if not host or not username or not password or not sender:
        raise MailSendError(
            "Bitte SMTP-Server, Absenderadresse und Passwort "
            "unter Einstellungen → Technik hinterlegen."
        )
    if len(host) > 253 or any(char.isspace() for char in host):
        raise MailSendError("Der SMTP-Servername ist ungültig.")
    if port not in (465, 587):
        raise MailSendError("Für SMTP sind nur SSL (465) und STARTTLS (587) zulässig.")
    try:
        assert_public_host(host, port)
    except (OSError, ValueError) as exc:
        raise MailSendError("Der SMTP-Server ist nicht zulässig oder nicht erreichbar.") from exc

    return {
        "host": host,
        "port": port,
        "username": username,
        "password": password,
        "sender": sender,
        "use_ssl": port == 465,
        "use_tls": port == 587,
    }


def _resolve_addresses(studio, student_ids, manual_recipient, additional_recipient=''):
    if not isinstance(student_ids, list) or len(student_ids) > MAX_STUDENTS:
        raise MailSendError("Ungültige Schülerauswahl.")
    ids = [str(uid) for uid in student_ids]
    if len(ids) != len(set(ids)):
        raise MailSendError("Schüler dürfen nicht mehrfach ausgewählt werden.")
    available = {item["id"]: item for item in active_student_recipients(studio)}
    missing = [uid for uid in ids if uid not in available]
    if missing:
        raise MailSendError(
            "Die Empfängerliste hat sich geändert. Bitte die Schüler neu auswählen."
        )
    if any(not available[uid]["selectable"] for uid in ids):
        raise MailSendError("Ein ausgewählter Schüler hat keine gültige Kontaktadresse.")
    manual = (manual_recipient or "").strip()
    additional = (additional_recipient or "").strip()
    if manual and not _valid_email(manual):
        raise MailSendError("Die eingegebene E-Mail-Adresse ist ungültig.")
    if additional and not _valid_email(additional):
        raise MailSendError("Die zusätzliche E-Mail-Adresse ist ungültig.")

    unique = OrderedDict()
    for uid in ids:
        address = available[uid]["email"]
        key = address.lower()
        entry = unique.setdefault(key, {"email": address, "student_ids": []})
        entry["student_ids"].append(uid)
    if manual:
        unique.setdefault(manual.lower(), {"email": manual, "student_ids": []})
    if additional:
        unique.setdefault(additional.lower(), {
            "email": additional, "student_ids": [],
        })
    if not unique:
        raise MailSendError("Bitte mindestens einen Empfänger auswählen.")
    if len(unique) > MAX_STUDENTS:
        raise MailSendError("Es wurden zu viele Empfänger ausgewählt.")
    return list(unique.values())


def studio_resource_attachments(studio, query=""):
    """Return files from this studio only; never leak their storage URLs."""
    from django.db.models import Q

    resources = (
        Resource.objects.filter(studio=studio)
        .exclude(file="")
        .exclude(file__isnull=True)
        .select_related("folder")
        .order_by("title", "id")
    )
    search = str(query or "").strip()[:120]
    if search:
        resources = resources.filter(
            Q(title__icontains=search)
            | Q(file__icontains=search)
            | Q(instrument__icontains=search)
            | Q(folder__name__icontains=search)
        )
    # A server-side search can retrieve files beyond the first 100.
    items = []
    records = list(resources[:101])
    for resource in records[:100]:
        items.append({
            "id": str(resource.pk),
            "title": resource.title,
            "filename": os.path.basename(resource.file.name),
            "size": resource.file_size,
            "mime_type": resource.mime_type,
            "folder_name": resource.folder.name if resource.folder else "",
        })
    return {"resources": items, "has_more": len(records) > 100}


def _collect_attachments(files, studio=None, resource_ids=None):
    """Resolve and size-check all attachments before opening any SMTP session."""
    resource_ids = resource_ids if resource_ids is not None else []
    if not isinstance(resource_ids, list) or len(resource_ids) > MAX_ATTACHMENTS:
        raise MailSendError("Ungültige StudioSync-Dateiauswahl.")
    if len(files) + len(resource_ids) > MAX_ATTACHMENTS:
        raise MailSendError("Maximal acht Anhänge pro Nachricht sind erlaubt.")
    unique = []
    for candidate in resource_ids:
        try:
            resource_id = str(uuid.UUID(str(candidate)))
        except (ValueError, AttributeError, TypeError) as exc:
            raise MailSendError("Ungültige StudioSync-Dateikennung.") from exc
        if resource_id in unique:
            raise MailSendError("Eine StudioSync-Datei wurde mehrfach ausgewählt.")
        unique.append(resource_id)

    resources = {}
    if unique:
        if studio is None:
            raise MailSendError("StudioSync-Dateien benötigen einen Studio-Kontext.")
        resources = {
            str(resource.pk): resource for resource in
            Resource.objects.filter(studio=studio, pk__in=unique)
            .exclude(file="")
            .exclude(file__isnull=True)
        }
        if len(resources) != len(unique):
            raise MailSendError(
                "Eine ausgewählte StudioSync-Datei ist nicht mehr verfügbar."
            )

    total = 0
    attachments = []
    for uploaded in files:
        if not uploaded.name or uploaded.size > MAX_EACH_ATTACHMENT_SIZE:
            raise MailSendError("Ein Anhang ist zu groß oder hat keinen Dateinamen.")
        total += uploaded.size
        if total > MAX_TOTAL_ATTACHMENT_SIZE:
            raise MailSendError(
                "Die Anhänge dürfen zusammen höchstens 12 MB groß sein."
            )
        filename = os.path.basename(uploaded.name.replace("\\", "/"))[:200]
        data = uploaded.read(MAX_EACH_ATTACHMENT_SIZE + 1)
        if len(data) > MAX_EACH_ATTACHMENT_SIZE:
            raise MailSendError("Ein lokaler Anhang ist zu groß.")
        attachments.append((
            filename, data, uploaded.content_type or "application/octet-stream",
        ))

    for resource_id in unique:
        resource = resources[resource_id]
        if resource.file_size is not None and resource.file_size > MAX_EACH_ATTACHMENT_SIZE:
            raise MailSendError("Eine StudioSync-Datei ist größer als 8 MB.")
        try:
            with resource.file.open("rb") as resource_file:
                payload = resource_file.read(MAX_EACH_ATTACHMENT_SIZE + 1)
        except Exception as exc:
            # Storage backends (including S3) may raise provider-specific errors.
            LOG.warning("Studio resource attachment unreadable (%s)", type(exc).__name__)
            raise MailSendError(
                "Eine StudioSync-Datei konnte nicht geöffnet werden."
            ) from exc
        if len(payload) > MAX_EACH_ATTACHMENT_SIZE:
            raise MailSendError("Eine StudioSync-Datei ist größer als 8 MB.")
        total += len(payload)
        if total > MAX_TOTAL_ATTACHMENT_SIZE:
            raise MailSendError(
                "Die Anhänge dürfen zusammen höchstens 12 MB groß sein."
            )
        filename = os.path.basename(resource.file.name.replace("\\", "/"))[:200]
        mime = resource.mime_type or mimetypes.guess_type(filename)[0]
        if not mime or "/" not in mime:
            mime = "application/octet-stream"
        attachments.append((filename, payload, mime))
    return attachments


def _open_sent_folder(config):
    """Open one IMAP session for all copies in this dispatch."""
    client = None
    try:
        host, port, username, password, mode = _configuration(config)
        tls = ssl.create_default_context()
        if mode == "ssl":
            client = imaplib.IMAP4_SSL(host, port, ssl_context=tls, timeout=12)
        else:
            client = imaplib.IMAP4(host, port, timeout=12)
            client.starttls(ssl_context=tls)
        client.login(username, password)
        mailbox = resolve_folder(client, "sent")
        return client, mailbox
    except (
        MailFetchError, MailFolderError, OSError, ValueError, ssl.SSLError,
        imaplib.IMAP4.error, TimeoutError,
    ) as exc:
        if client is not None:
            try:
                client.logout()
            except (imaplib.IMAP4.error, OSError):
                pass
        LOG.warning("Opening Sent folder failed (%s)", type(exc).__name__)
        raise MailSendError(
            "Das Gesendet-Postfach konnte nicht zum Speichern geöffnet werden."
        ) from exc


def _save_sent_copy(client, mailbox, message, raw_message=None):
    """Append a copy with the same Message-ID once SMTP accepts the mail."""
    try:
        status, _ = client.append(
            mailbox, r"(\Seen)", None,
            raw_message if raw_message is not None else message.message().as_bytes()
        )
        if status != "OK":
            raise MailSendError("Der Server hat die Kopie nicht bestätigt.")
    except (imaplib.IMAP4.error, OSError, TimeoutError) as exc:
        LOG.warning("Saving Sent copy failed (%s)", type(exc).__name__)
        raise MailSendError(
            "Kopie konnte nicht im Gesendet-Ordner gespeichert werden."
        ) from exc


def _smtp_utf8_bytes(*, sender, recipient, studio_name, subject, plain, html, attachments, message_id):
    """Build RFC 6532 headers for real international mailbox addresses."""
    msg = StandardEmailMessage(policy=SMTPUTF8)
    msg["Subject"] = subject
    sender_local, sender_domain = sender.rsplit("@", 1)
    target_local, target_domain = recipient.rsplit("@", 1)
    # Python 3.12's addr_spec parser rejects SMTPUTF8 local parts;
    # explicit username/domain construction correctly preserves them.
    msg["From"] = Address(
        display_name=studio_name, username=sender_local, domain=sender_domain
    )
    msg["To"] = Address(username=target_local, domain=target_domain)
    msg["Message-ID"] = message_id
    msg.set_content(plain)
    msg.add_alternative(html, subtype="html")
    for filename, data, mime in attachments:
        maintype, subtype = mime.split("/", 1)
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)
    return msg.as_bytes()


def send_student_mail(
    *, studio, config, student_ids, manual_recipient, subject, body, uploads,
    resource_ids=None, additional_recipient="",
):
    """Send one private email per distinct address; report any partial success.

    A partially successful dispatch must not be retried wholesale. The returned
    student_ids identify deliveries accepted by SMTP for safe UI deselection.
    """
    title = (subject or "").strip()
    content = (body or "").strip()
    if not title or len(title) > MAX_SUBJECT or "\n" in title or "\r" in title:
        raise MailSendError("Bitte einen gültigen Betreff mit maximal 220 Zeichen eingeben.")
    if not content or len(content) > MAX_BODY:
        raise MailSendError("Bitte einen Nachrichtentext eingeben (maximal 100.000 Zeichen).")
    recipients = _resolve_addresses(
        studio, student_ids, manual_recipient, additional_recipient
    )
    attachments = _collect_attachments(uploads, studio, resource_ids)
    settings = _smtp_settings(config)

    connection = get_connection(
        backend="django.core.mail.backends.smtp.EmailBackend",
        host=settings["host"],
        port=settings["port"],
        username=settings["username"],
        password=settings["password"],
        use_ssl=settings["use_ssl"],
        use_tls=settings["use_tls"],
        timeout=12,
        fail_silently=False,
    )
    sent = []
    failed = []
    copies_failed = 0
    sent_client = None
    sent_mailbox = None
    sent_copy_unavailable = False

    try:
        connection.open()
        for recipient in recipients:
            email = EmailMultiAlternatives(
                subject=title,
                body=plain_mail_with_signature(content),
                from_email=(
                    formataddr((studio.name, settings["sender"]))
                    if settings["sender"].split("@", 1)[0].isascii()
                    else settings["sender"]
                ),
                to=[recipient["email"]],
                connection=connection,
                headers={"Message-ID": make_msgid()},
            )
            email.attach_alternative(html_mail_with_signature(content), "text/html")
            for filename, data, mime in attachments:
                email.attach(filename, data, mime)
            raw_message = None
            try:
                needs_utf8 = (
                    not recipient["email"].split("@", 1)[0].isascii()
                    or not settings["sender"].split("@", 1)[0].isascii()
                )
                if needs_utf8:
                    smtp = connection.connection
                    if smtp is None or not smtp.has_extn("smtputf8"):
                        raise smtplib.SMTPNotSupportedError(
                            "SMTPUTF8 wird vom Mailserver nicht unterstützt."
                        )
                    raw_message = _smtp_utf8_bytes(
                        sender=settings["sender"],
                        recipient=recipient["email"],
                        studio_name=studio.name,
                        subject=title,
                        plain=plain_mail_with_signature(content),
                        html=html_mail_with_signature(content),
                        attachments=attachments,
                        message_id=email.extra_headers["Message-ID"],
                    )
                    refused = smtp.sendmail(
                        settings["sender"], [recipient["email"]], raw_message,
                        mail_options=("SMTPUTF8", "BODY=8BITMIME"),
                    )
                    if refused:
                        raise smtplib.SMTPRecipientsRefused(refused)
                else:
                    delivered = email.send(fail_silently=False)
                    if delivered != 1:
                        raise smtplib.SMTPException("SMTP rejected the message")
            except (smtplib.SMTPException, OSError, TimeoutError, UnicodeError, ValueError) as exc:
                LOG.warning("SMTP recipient send failed (%s)", type(exc).__name__)
                failed.append(recipient)
                continue
            sent.append(recipient)
            if sent_copy_unavailable:
                copies_failed += 1
            else:
                try:
                    if sent_client is None:
                        sent_client, sent_mailbox = _open_sent_folder(config)
                    _save_sent_copy(sent_client, sent_mailbox, email, raw_message)
                except MailSendError:
                    copies_failed += 1
                    sent_copy_unavailable = True
    except (smtplib.SMTPException, OSError, TimeoutError) as exc:
        LOG.warning("SMTP connection failed (%s)", type(exc).__name__)
        # A connection failure before/after some sends must be reported without
        # losing previously accepted recipient delivery information.
        remaining = recipients[len(sent) + len(failed):]
        failed.extend(remaining)
    finally:
        try:
            connection.close()
        except (smtplib.SMTPException, OSError):
            pass
        if sent_client is not None:
            try:
                sent_client.logout()
            except (imaplib.IMAP4.error, OSError):
                pass

    return {
        "sent": len(sent),
        "failed": len(failed),
        "student_ids_sent": [
            uid for recipient in sent for uid in recipient["student_ids"]
        ],
        "manual_sent": bool(
            manual_recipient and
            any(
                recipient["email"].casefold() == manual_recipient.strip().casefold()
                for recipient in sent
            )
        ),
        "copies_failed": copies_failed,
        "additional_sent": bool(
            additional_recipient and any(
                recipient["email"].casefold()
                == additional_recipient.strip().casefold()
                for recipient in sent
            )
        ),
    }
