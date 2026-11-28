"""Idempotent monthly billing and isolated scheduled test dispatch."""
from datetime import datetime
from email.utils import formataddr, make_msgid
from zoneinfo import ZoneInfo
import logging

from django.core.mail import EmailMultiAlternatives, get_connection
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.core.models import Studio, Student
from apps.core.international_email import validate_international_email
from apps.core.mail_outbound import _smtp_utf8_bytes, _open_sent_folder, _save_sent_copy
from apps.core.mail_cache import invalidate_sent_folder
from .models import BillingAutomation, BillingRun, BillingRunItem
from .family_billing import generate_month
from .invoice_pdf import invoice_snapshot, missing_billing_fields, render_invoice_pdf
from .invoice_delivery import smtp_settings_for_studio, send_invoice, InvoiceDeliveryError

LOG = logging.getLogger(__name__)
BERLIN = ZoneInfo("Europe/Berlin")


class BillingAutomationSerializer(serializers.ModelSerializer):
    monthly_day = serializers.IntegerField(min_value=1, max_value=28)
    test_at = serializers.DateTimeField(default_timezone=BERLIN, allow_null=True, required=False)

    class Meta:
        model = BillingAutomation
        fields = ["monthly_enabled", "monthly_from", "monthly_day", "monthly_time",
                  "monthly_send", "test_enabled", "test_at", "test_month", "test_send"]

    def validate(self, attrs):
        for key in ("monthly_from", "test_month"):
            if attrs.get(key) and attrs[key].day != 1:
                raise serializers.ValidationError({key: "Bitte den Monatsersten angeben."})
        if attrs.get("monthly_enabled") and not attrs.get("monthly_from"):
            raise serializers.ValidationError("Bitte den ersten Abrechnungsmonat angeben.")
        if attrs.get("test_enabled") and not (attrs.get("test_at") and attrs.get("test_month")):
            raise serializers.ValidationError("Testtermin und Leistungsmonat sind erforderlich.")
        if attrs.get("test_enabled") and attrs["test_at"] <= timezone.now():
            raise serializers.ValidationError("Der Testtermin muss in der Zukunft liegen.")
        return attrs


def settings_payload(studio):
    settings = BillingAutomation.objects.filter(studio=studio).first()
    settings = settings or BillingAutomation(studio=studio)
    names = {str(student.pk): student.user.get_full_name() for student in Student.objects.filter(studio=studio).select_related("user")}
    runs = studio.billing_runs.prefetch_related("items").order_by("-created_at")[:15]
    return {"settings": BillingAutomationSerializer(settings).data, "runs": [
        {"id": run.pk, "kind": run.kind, "service_month": run.service_month.isoformat(),
         "scheduled_for": run.scheduled_for.isoformat(), "status": run.status,
         "skipped": [{**entry, "name": names.get(entry.get("student"), "")} for entry in run.skipped], "error": run.error,
         "items": [{"number": item.number, "recipient": item.recipient,
                    "amount": str(item.amount), "state": item.state, "error": item.error}
                   for item in run.items.all()]}
        for run in runs
    ]}


@transaction.atomic
def save_settings(studio, data):
    Studio.objects.select_for_update().get(pk=studio.pk)
    settings = BillingAutomation.objects.filter(studio=studio).first()
    serializer = BillingAutomationSerializer(settings, data=data)
    serializer.is_valid(raise_exception=True)
    serializer.save(studio=studio)
    return settings_payload(studio)


def prepare_test_items(run):
    # Real invoice rows, using the same grouping and line items, but without
    # consuming any production tuition allocation.
    invoices, skipped = generate_month(run.studio_id, run.service_month, monthly_test=True)
    for invoice in invoices:
        snapshot = invoice_snapshot(invoice)
        recipient = snapshot.get("recipient_email", "").strip()
        missing = missing_billing_fields(invoice, snapshot)
        error = ""
        if missing:
            error = "Fehlende Rechnungsdaten: " + ", ".join(missing)
        elif recipient.rsplit("@", 1)[-1].casefold() != "musart.de":
            error = "Testversand ausschließlich an @musart.de."
        if error:
            BillingRunItem.objects.create(run=run, number=invoice.invoice_number,
                recipient=recipient, amount=invoice.total_amount, state="error", error=error)
            invoice.delete()
            continue
        BillingRunItem.objects.create(
            run=run, invoice=invoice, number=invoice.invoice_number,
            recipient=recipient, amount=invoice.total_amount,
            state="pending" if run.send else "draft")
    return skipped


def prepare_month_items(run):
    invoices, skipped = generate_month(run.studio_id, run.service_month)
    for invoice in invoices:
        snapshot = invoice_snapshot(invoice)
        BillingRunItem.objects.create(
            run=run, invoice=invoice, number=invoice.invoice_number,
            recipient=snapshot.get("recipient_email", ""),
            amount=invoice.total_amount, state="pending" if run.send else "draft")
    return skipped


@transaction.atomic
def prepare_due_runs(studio_id, now):
    studio = Studio.objects.select_for_update().get(pk=studio_id)
    settings = BillingAutomation.objects.select_for_update().filter(studio=studio).first()
    if not settings:
        return
    local = now.astimezone(BERLIN)
    month = local.date().replace(day=1)
    candidates = []
    if settings.monthly_enabled and settings.monthly_from and month >= settings.monthly_from:
        at = datetime.combine(month.replace(day=settings.monthly_day), settings.monthly_time, tzinfo=BERLIN)
        if now >= at and not BillingRun.objects.filter(studio=studio, kind="monthly", service_month=month).exists():
            candidates.append(("monthly", month, at, settings.monthly_send))
    if settings.test_enabled and settings.test_at and settings.test_month and now >= settings.test_at:
        if not BillingRun.objects.filter(studio=studio, kind="test", scheduled_for=settings.test_at).exists():
            candidates.append(("test", settings.test_month, settings.test_at, settings.test_send))
        settings.test_enabled = False
        settings.save(update_fields=["test_enabled"])
    for kind, service_month, at, send in candidates:
        run = BillingRun.objects.create(studio=studio, kind=kind, service_month=service_month,
                                       scheduled_for=at, send=send)
        try:
            with transaction.atomic():
                run.skipped = prepare_test_items(run) if kind == "test" else prepare_month_items(run)
                run.status = "ready"
                run.save(update_fields=["skipped", "status"])
        except Exception:
            LOG.exception("Billing preparation failed for run %s", run.pk)
            run.status = "error"
            run.error = "Rechnungserstellung fehlgeschlagen; bitte Serverprotokoll prüfen."
            run.save(update_fields=["status", "error"])


def deliver_test(item):
    data = item.snapshot
    recipient = validate_international_email(data["recipient_email"].strip())
    if recipient.rsplit("@", 1)[-1].casefold() != "musart.de":
        raise InvoiceDeliveryError("Testversand ausschließlich an @musart.de.")
    studio = item.run.studio
    kwargs, sender, studio_name = smtp_settings_for_studio(studio)
    sender = validate_international_email(sender)
    subject = "[TEST] MUSart – Rechnung " + item.number
    body = ("Guten Tag " + data["recipient_name"] + ",\n\n"
            "anbei erhalten Sie eine Testrechnung. Bitte nicht bezahlen.\n\n"
            "Mit freundlichen Grüßen\n" + data["sender_name"])
    filename = "MUSart-" + item.number + ".pdf"
    pdf = bytes(item.pdf_document)
    connection = get_connection(backend="django.core.mail.backends.smtp.EmailBackend", **kwargs)
    raw, email = None, None
    if any(not addr.rsplit("@", 1)[0].isascii() for addr in (sender, recipient)):
        def envelope(address):
            local, domain = address.rsplit("@", 1)
            return local + "@" + domain.encode("idna").decode("ascii")
        sender, recipient = envelope(sender), envelope(recipient)
        raw = _smtp_utf8_bytes(sender=sender, recipient=recipient, studio_name=studio_name,
                              subject=subject, plain=body, html=None,
                              attachments=[(filename, pdf, "application/pdf")], message_id=make_msgid())
        try:
            connection.open()
            smtp = connection.connection
            if smtp is None or not smtp.has_extn("smtputf8"):
                raise InvoiceDeliveryError("SMTPUTF8 wird nicht unterstützt.")
            if smtp.sendmail(sender, [recipient], raw, mail_options=("SMTPUTF8", "BODY=8BITMIME")):
                raise InvoiceDeliveryError("SMTP hat den Testversand nicht bestätigt.")
        finally:
            try:
                connection.close()
            except Exception:
                LOG.warning("Closing test invoice SMTP connection failed")
    else:
        email = EmailMultiAlternatives(subject=subject, body=body, from_email=formataddr((studio_name, sender)),
                                       to=[recipient], connection=connection)
        email.attach(filename, pdf, "application/pdf")
        if email.send(fail_silently=False) != 1:
            raise InvoiceDeliveryError("SMTP hat den Testversand nicht bestätigt.")
    technical = (studio.owner.preferences or {}).get("technical", {})
    client = None
    if all(technical.get(key) for key in ("imap_host", "imap_username", "imap_password")):
        try:
            client, folder = _open_sent_folder(technical)
            _save_sent_copy(client, folder, email, raw)
            invalidate_sent_folder(studio, studio.owner, technical)
        except Exception:
            LOG.warning("Test invoice accepted, Sent copy failed")
        finally:
            if client:
                try:
                    client.logout()
                except Exception:
                    pass


def deliver_item(pk):
    # Commit the attempt before sending. Never automatically retry an
    # ambiguous SMTP result, including a process crash after acceptance.
    with transaction.atomic():
        item = BillingRunItem.objects.select_for_update().get(pk=pk)
        if item.state != "pending":
            return
        item.state = "attempted"
        item.save(update_fields=["state"])
    try:
        if item.run.kind == "test" and not item.invoice_id and item.snapshot and item.pdf_document:
            # Compatibility for isolated test items queued before migration.
            deliver_test(item)
        else:
            if not item.invoice_id:
                raise InvoiceDeliveryError("Rechnungsentwurf wurde gelöscht.")
            send_invoice(item.invoice_id)
            item.invoice.refresh_from_db()
            if not item.invoice.sent_at:
                raise InvoiceDeliveryError("Versand wurde nicht bestätigt.")
        item.state = "sent"
    except InvoiceDeliveryError as exc:
        item.state, item.error = "error", str(exc)
    except Exception:
        LOG.exception("Invoice dispatch failed for item %s", pk)
        item.state, item.error = "error", "Versandstatus unklar; bitte manuell prüfen."
    item.save(update_fields=["state", "error"])


def run_billing_automation():
    from .block_billing import run_block_billing
    results = {"block": run_block_billing(), "runs": 0}
    for studio_id in BillingAutomation.objects.values_list("studio_id", flat=True):
        try:
            prepare_due_runs(studio_id, timezone.now())
        except Exception:
            LOG.exception("Billing scheduler failed for studio %s", studio_id)
    for run in BillingRun.objects.filter(status="ready"):
        for item_id in run.items.filter(state="pending").values_list("pk", flat=True):
            deliver_item(item_id)
        # No duplicate send if the worker stops after claiming an item.
        if not run.items.filter(state="pending").exists():
            run.status = "review" if run.items.filter(state__in=["error", "attempted"]).exists() else "finished"
            run.save(update_fields=["status"])
            results["runs"] += 1
    return results
