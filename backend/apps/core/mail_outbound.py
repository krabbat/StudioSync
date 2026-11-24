"""StudioSync SMTP dispatch scoped to active students of the admin's studio.

The browser supplies student IDs, never recipient addresses for roster entries.
Each unique address gets a private message; siblings sharing one family address
receive exactly one copy. The SMTP credentials never leave the backend.
"""

import imaplib
import logging
import smtplib
import ssl
from collections import OrderedDict
from email.utils import formataddr, make_msgid

from django.core.exceptions import ValidationError
from django.core.mail import EmailMessage, get_connection
from django.core.validators import validate_email

from apps.core.mail_folders import MailFolderError, resolve_folder
from apps.core.mail_service import MailFetchError, _configuration
from apps.core.models import Student
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
    if not address:
        return ""
    try:
        validate_email(address)
    except ValidationError:
        return ""
    return address


def _recipient_address(student):
    """Prefer a family's designated main parent for general communication."""
    family = student.family
    if family and family.primary_parent and family.primary_parent.is_active:
        parent_email = _valid_email(family.primary_parent.email)
        if parent_email:
            return parent_email, "Elternkontakt"
    return _valid_email(student.user.email), "Schüler"


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


def _resolve_addresses(studio, student_ids, manual_recipient):
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
    if manual and not _valid_email(manual):
        raise MailSendError("Die zusätzlich eingegebene E-Mail-Adresse ist ungültig.")

    unique = OrderedDict()
    for uid in ids:
        address = available[uid]["email"]
        key = address.casefold()
        entry = unique.setdefault(key, {"email": address, "student_ids": []})
        entry["student_ids"].append(uid)
    if manual:
        unique.setdefault(manual.casefold(), {"email": manual, "student_ids": []})
    if not unique:
        raise MailSendError("Bitte mindestens einen Empfänger auswählen.")
    if len(unique) > MAX_STUDENTS:
        raise MailSendError("Es wurden zu viele Empfänger ausgewählt.")
    return list(unique.values())


def _collect_attachments(files):
    if len(files) > MAX_ATTACHMENTS:
        raise MailSendError("Maximal acht Anhänge pro Nachricht sind erlaubt.")
    total = 0
    attachments = []
    for uploaded in files:
        if not uploaded.name or uploaded.size > MAX_EACH_ATTACHMENT_SIZE:
            raise MailSendError("Ein Anhang ist zu groß oder hat keinen Dateinamen.")
        total += uploaded.size
        if total > MAX_TOTAL_ATTACHMENT_SIZE:
            raise MailSendError("Die Anhänge dürfen zusammen höchstens 12 MB groß sein.")
        attachments.append((
            uploaded.name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1][:200],
            uploaded.read(),
            uploaded.content_type or "application/octet-stream",
        ))
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


def _save_sent_copy(client, mailbox, message):
    """Append a copy with the same Message-ID once SMTP accepts the mail."""
    try:
        status, _ = client.append(
            mailbox, r"(\Seen)", None, message.message().as_bytes()
        )
        if status != "OK":
            raise MailSendError("Der Server hat die Kopie nicht bestätigt.")
    except (imaplib.IMAP4.error, OSError, TimeoutError) as exc:
        LOG.warning("Saving Sent copy failed (%s)", type(exc).__name__)
        raise MailSendError(
            "Kopie konnte nicht im Gesendet-Ordner gespeichert werden."
        ) from exc


def send_student_mail(
    *, studio, config, student_ids, manual_recipient, subject, body, uploads
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
    recipients = _resolve_addresses(studio, student_ids, manual_recipient)
    attachments = _collect_attachments(uploads)
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
            email = EmailMessage(
                subject=title,
                body=content,
                from_email=formataddr((studio.name, settings["sender"])),
                to=[recipient["email"]],
                connection=connection,
                headers={"Message-ID": make_msgid()},
            )
            for filename, data, mime in attachments:
                email.attach(filename, data, mime)
            try:
                delivered = email.send(fail_silently=False)
                if delivered != 1:
                    raise smtplib.SMTPException("SMTP rejected the message")
            except (smtplib.SMTPException, OSError, TimeoutError) as exc:
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
                    _save_sent_copy(sent_client, sent_mailbox, email)
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
    }
