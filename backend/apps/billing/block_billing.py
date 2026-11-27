"""Block billing based only on completed calendar units, independent of quotas."""
from datetime import datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo
import logging
import secrets

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from apps.core.models import Student, Studio
from apps.lessons.models import Lesson
from .models import BlockBillingPlan, BlockInvoice, BlockBillingUnit, Invoice, InvoiceLineItem
from .invoice_pdf import lesson_subject
from .invoice_delivery import send_invoice, InvoiceDeliveryError
from .payment_status import berlin_today

LOG = logging.getLogger(__name__)
BERLIN = ZoneInfo("Europe/Berlin")


class BlockPlanSerializer(serializers.ModelSerializer):
    units_per_block = serializers.IntegerField(min_value=1, max_value=100)
    block_amount = serializers.DecimalField(max_digits=8, decimal_places=2, min_value=Decimal("0.01"))

    class Meta:
        model = BlockBillingPlan
        fields = ["enabled", "starts_on", "units_per_block", "block_amount", "test_only"]

    def validate(self, attrs):
        student = self.context["student"]
        if attrs.get("enabled", getattr(self.instance, "enabled", False)):
            if not student.is_active or not hasattr(student, "teaching_contract"):
                raise serializers.ValidationError("Ein aktiver Schüler mit Unterrichtsvertrag ist erforderlich.")
            if getattr(getattr(student, "billing_profile", None), "payment_method", "") != "cash":
                raise serializers.ValidationError("Bitte zuerst Barzahlung in den Rechnungsdaten hinterlegen.")
            if student.family_id and not student.family.individual_billing:
                raise serializers.ValidationError("Blockabrechnung ist derzeit nur mit Einzelabrechnung möglich.")
        if self.instance and self.instance.units.exists():
            switching_live = self.instance.test_only and not attrs.get("test_only", self.instance.test_only)
            if switching_live:
                last_test = self.instance.units.filter(test_only=True).order_by("-lesson_date").first()
                first_live = max(berlin_today(), last_test.lesson_date + timedelta(days=1)) if last_test else berlin_today()
                if attrs.get("starts_on", self.instance.starts_on) < first_live:
                    raise serializers.ValidationError("Für den Produktivstart muss der Abrechnungsbeginn nach den Teststunden liegen.")
            elif (attrs.get("starts_on", self.instance.starts_on) != self.instance.starts_on
                  or attrs.get("test_only", self.instance.test_only) != self.instance.test_only):
                raise serializers.ValidationError("Der Abrechnungsbeginn oder Testmodus eines bereits genutzten Kontos darf nicht verändert werden.")
        return attrs


def eligible(plan):
    return (plan.enabled and plan.student.is_active
            and hasattr(plan.student, "teaching_contract")
            and getattr(getattr(plan.student, "billing_profile", None), "payment_method", "") == "cash"
            and (not plan.student.family_id or plan.student.family.individual_billing))


def completed_lessons(plan):
    """One completed appointment equals one UE, including completed group participation."""
    return Lesson.objects.filter(
        studio_id=plan.student.studio_id,
        scheduled_start__gte=datetime.combine(plan.starts_on, time.min, tzinfo=BERLIN),
        scheduled_end__lte=timezone.now(),
    ).filter(
        Q(student=plan.student, status="completed", lesson_type__in=["private", "makeup"])
        | Q(participants__student=plan.student, participants__status="completed")
        | Q(participants__student=plan.student, participants__status="inherit", status="completed")
    ).distinct().order_by("scheduled_start", "pk")


def pending_lessons(plan):
    return completed_lessons(plan).exclude(pk__in=plan.units.filter(test_only=plan.test_only).values("lesson_id"))


def block_status(student):
    plan = BlockBillingPlan.objects.filter(student=student).first()
    if not plan:
        return {"plan": None, "open_units": 0, "unbilled_units": 0, "bills": []}
    outstanding = plan.units.filter(test_only=plan.test_only, reset_at__isnull=True, bill__isnull=False).exclude(
        bill__invoice__status="paid",
    ).count()
    unbilled = pending_lessons(plan).count()
    return {
        "plan": BlockPlanSerializer(plan).data,
        "open_units": outstanding + unbilled,
        "unbilled_units": unbilled,
        "bills": [
            {"id": str(b.invoice_id), "number": b.invoice.invoice_number,
             "status": b.invoice.status, "sent": bool(b.invoice.sent_at),
             "error": b.delivery_error, "attempted": bool(b.attempted_at)}
            for b in plan.bills.filter(test_only=plan.test_only).select_related("invoice").order_by("-pk")[:20]
        ],
    }


@transaction.atomic
def save_plan(student, data):
    Studio.objects.select_for_update().get(pk=student.studio_id)
    plan = BlockBillingPlan.objects.select_for_update().filter(student=student).first()
    serializer = BlockPlanSerializer(plan, data=data, context={"student": student})
    serializer.is_valid(raise_exception=True)
    serializer.save(student=student)
    return block_status(student)


@transaction.atomic
def reset_block(student, actor):
    Studio.objects.select_for_update().get(pk=student.studio_id)
    plan = BlockBillingPlan.objects.select_for_update().filter(student=student, enabled=True).first()
    if not plan:
        raise ValidationError("Keine aktive Blockabrechnung vorhanden.")
    now = timezone.now()
    # Do not erase invoices or pretend cash was received. Reset only the counter.
    plan.units.filter(test_only=plan.test_only, reset_at__isnull=True).exclude(bill__invoice__status="paid").update(
        reset_at=now, reset_by=actor)
    BlockBillingUnit.objects.bulk_create([
        BlockBillingUnit(plan=plan, test_only=plan.test_only, lesson_id=lesson.pk,
                         lesson_date=timezone.localtime(lesson.scheduled_start, BERLIN).date(),
                         reset_at=now, reset_by=actor)
        for lesson in pending_lessons(plan)
    ])
    return block_status(student)


@transaction.atomic
def generate_blocks(plan_id):
    initial = BlockBillingPlan.objects.select_related("student").get(pk=plan_id)
    Studio.objects.select_for_update().get(pk=initial.student.studio_id)
    plan = BlockBillingPlan.objects.select_for_update().get(pk=plan_id)
    if not eligible(plan):
        return []
    lessons = list(pending_lessons(plan))
    created = []
    for offset in range(0, len(lessons) - plan.units_per_block + 1, plan.units_per_block):
        chunk = lessons[offset:offset + plan.units_per_block]
        dates = [timezone.localtime(item.scheduled_start, BERLIN).date() for item in chunk]
        today = berlin_today()
        invoice = Invoice.objects.create(
            studio_id=plan.student.studio_id, student=plan.student,
            invoice_number=("TEST-BLOCK-" + secrets.token_hex(10)) if plan.test_only else "",
            issue_date=today, due_date=today + timedelta(days=7), status="draft",
            notes=("TESTRECHNUNG – keine Zahlungsaufforderung. " if plan.test_only else "") + "Unterricht am " + ", ".join(d.strftime("%d.%m.%Y") for d in dates),
        )
        InvoiceLineItem.objects.create(
            invoice=invoice, student=plan.student, student_name_snapshot=plan.student.user.get_full_name(),
            description=f"{lesson_subject(plan.student)} – {plan.units_per_block} Unterrichtseinheiten",
            quantity=Decimal("1"), unit_price=plan.block_amount,
        )
        invoice.calculate_totals()
        bill = BlockInvoice.objects.create(plan=plan, invoice=invoice, test_only=plan.test_only)
        BlockBillingUnit.objects.bulk_create([
            BlockBillingUnit(plan=plan, test_only=plan.test_only, lesson_id=item.pk, lesson_date=day, bill=bill)
            for item, day in zip(chunk, dates)
        ])
        created.append(bill.pk)
    return created


def deliver_block(bill_id):
    # Claim once before SMTP. An uncertain outcome requires an explicit manual
    # retry, never a blind automatic resend on every scheduler run.
    with transaction.atomic():
        bill = BlockInvoice.objects.select_for_update().select_related("plan", "invoice").get(pk=bill_id)
        if bill.attempted_at or bill.invoice.sent_at or bill.invoice.status == "cancelled" or bill.test_only != bill.plan.test_only or not eligible(bill.plan):
            return False
        bill.attempted_at = timezone.now()
        bill.save(update_fields=["attempted_at"])
    try:
        sent = send_invoice(bill.invoice_id)
        if sent:
            BlockInvoice.objects.filter(pk=bill_id).update(delivery_error="")
        return sent
    except InvoiceDeliveryError as exc:
        BlockInvoice.objects.filter(pk=bill_id).update(delivery_error=str(exc))
    except Exception:
        LOG.exception("Block invoice delivery failed for %s", bill_id)
        BlockInvoice.objects.filter(pk=bill_id).update(delivery_error="Versandstatus unklar; bitte manuell prüfen.")
    return False


def run_block_billing():
    result = {"created": 0, "sent": 0, "errors": 0}
    for plan_id in BlockBillingPlan.objects.filter(enabled=True).values_list("pk", flat=True):
        try:
            result["created"] += len(generate_blocks(plan_id))
            for bill_id in BlockInvoice.objects.filter(
                plan_id=plan_id, attempted_at__isnull=True, invoice__sent_at__isnull=True,
            ).exclude(invoice__status="cancelled").values_list("pk", flat=True):
                result["sent"] += int(deliver_block(bill_id))
        except Exception:
            LOG.exception("Block billing failed for plan %s", plan_id)
            result["errors"] += 1
    return result
