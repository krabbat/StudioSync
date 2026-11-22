"""Manual MUSart invoice dispatch with real SMTP acknowledgement and PDF attachment."""

from __future__ import annotations

from email.utils import formataddr

from django.core.mail import EmailMultiAlternatives, get_connection
from django.db import transaction
from django.utils import timezone

from apps.core.security import assert_public_host

from .invoice_pdf import invoice_snapshot, missing_billing_fields, render_invoice_pdf
from .models import Invoice


class InvoiceDeliveryError(Exception):
    """Safe, human-readable reason why an invoice was not sent."""


def smtp_settings_for_studio(studio):
    """Never use student email or the first arbitrary admin's mail account."""
    owner = studio.owner
    prefs = owner.preferences if isinstance(owner.preferences, dict) else {}
    tech = prefs.get("technical", {})
    if not isinstance(tech, dict):
        tech = {}
    needed = ["smtp_host", "smtp_port", "smtp_username", "smtp_password", "smtp_from_email"]
    if any(not tech.get(key) for key in needed):
        raise InvoiceDeliveryError(
            "SMTP ist nicht vollständig eingerichtet (Einstellungen → Technik)."
        )
    try:
        port = int(tech["smtp_port"])
        assert_public_host(str(tech["smtp_host"]), port)
    except (ValueError, TypeError) as exc:
        raise InvoiceDeliveryError("Der eingestellte SMTP-Server ist nicht zulässig oder nicht erreichbar.") from exc

    if port not in (465, 587):
        raise InvoiceDeliveryError("Für den Rechnungsversand bitte Port 465 oder 587 verwenden.")
    return {
        "host": tech["smtp_host"],
        "port": port,
        "username": tech["smtp_username"],
        "password": tech["smtp_password"],
        "use_tls": port == 587,
        "use_ssl": port == 465,
        "timeout": 15,
    }, tech["smtp_from_email"], tech.get("smtp_from_name") or studio.name


def send_invoice(invoice_id, *, resend=False):
    """Send another email only if explicitly requested for an issued invoice.

    Resending preserves the archived PDF, original addressee and first send date.
    """
    with transaction.atomic():
        invoice = (
            Invoice.objects.select_for_update()
            # The student FK is nullable: joining it here creates an OUTER JOIN
            # that PostgreSQL refuses to lock with SELECT FOR UPDATE.
            # Student and user are loaded lazily when building the snapshot.
            .select_related("studio__owner")
            .get(pk=invoice_id)
        )
        if invoice.sent_at and not resend:
            return False
        already_sent = bool(invoice.sent_at)
        if invoice.status == "cancelled":
            raise InvoiceDeliveryError("Eine stornierte Rechnung kann nicht versendet werden.")

        snapshot = invoice.document_snapshot or invoice_snapshot(invoice)
        missing = missing_billing_fields(invoice, snapshot)
        if missing:
            raise InvoiceDeliveryError("Rechnungsversand nicht möglich. Es fehlen: " + ", ".join(missing))
        connection_args, sender_email, sender_name = smtp_settings_for_studio(invoice.studio)
        pdf = bytes(invoice.pdf_document) if invoice.pdf_document else render_invoice_pdf(snapshot)

        from django.core.exceptions import ValidationError
        from django.core.validators import validate_email
        try:
            validate_email(snapshot["recipient_email"])
            validate_email(sender_email)
        except ValidationError as exc:
            raise InvoiceDeliveryError("Die Rechnungs- oder Absender-E-Mail ist ungültig.") from exc

        paid = float(snapshot["balance_due"]) <= 0
        subject = f"MUSart – Rechnung {invoice.invoice_number}"
        intro = (
            "Der Rechnungsbetrag wurde bereits beglichen."
            if paid else
            f"Bitte beachten Sie die Fälligkeit am {snapshot['due_date']}."
        )
        body = (
            f"Guten Tag {snapshot['recipient_name']},\n\n"
            f"anbei erhalten Sie Ihre MUSart-Rechnung {invoice.invoice_number} als PDF.\n"
            f"{intro}\n\n"
            f"Mit freundlichen Grüßen\n{sender_name}\n"
        )
        try:
            email = EmailMultiAlternatives(
                subject=subject,
                body=body,
                from_email=formataddr((sender_name, sender_email)),
                to=[snapshot["recipient_email"]],
                reply_to=(
                    [snapshot["sender_email"]]
                    if snapshot.get("sender_email")
                    and snapshot["sender_email"] != sender_email
                    else []
                ),
                connection=get_connection(
                    backend="django.core.mail.backends.smtp.EmailBackend",
                    **connection_args,
                ),
            )
            email.attach(
                f"MUSart-Rechnung-{invoice.invoice_number}.pdf",
                pdf,
                "application/pdf",
            )
            if email.send(fail_silently=False) != 1:
                raise InvoiceDeliveryError("Der SMTP-Server hat den Versand nicht bestätigt.")
        except InvoiceDeliveryError:
            raise
        except Exception as exc:
            # Do not expose SMTP details or credentials in API responses.
            import logging
            logging.getLogger(__name__).exception(
                "Invoice email failed for invoice %s", invoice.id
            )
            raise InvoiceDeliveryError("SMTP-Versand fehlgeschlagen. Die E-Mail wurde nicht bestätigt.") from exc

        if already_sent:
            # Do not touch previously issued invoice data or its original send timestamp.
            return True
        invoice.pdf_document = pdf
        invoice.document_snapshot = snapshot
        invoice.pdf_created_at = timezone.now()
        invoice.sent_at = timezone.now()
        if invoice.status == "draft":
            invoice.status = "sent"
        invoice.save(update_fields=[
            "pdf_document", "document_snapshot", "pdf_created_at", "sent_at", "status", "updated_at"
        ])
        return True


def invoice_pdf_bytes(invoice):
    """Download immutable archived PDF, or preview current draft without freezing it."""
    if invoice.pdf_document:
        return bytes(invoice.pdf_document)
    return render_invoice_pdf(invoice_snapshot(invoice))
