"""Shared monthly tuition billing. Draft generation never sends mail."""
from calendar import monthrange
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import ValidationError

from apps.core.models import Family, Student, Studio
from .models import Invoice, InvoiceLineItem, TuitionMonth
from .invoice_pdf import invoice_snapshot, lesson_subject
from .payment_status import berlin_today


def existing_period(student, start, end):
    """Includes legacy manually created single-student invoices and new allocations."""
    return (TuitionMonth.objects.filter(student=student, month__range=(start, end)).exists()
            or Invoice.objects.filter(student=student, service_month__lte=end)
            .exclude(status="cancelled")
            .filter(Q(service_month_end__gte=start) |
                    Q(service_month_end__isnull=True, service_month__gte=start)).exists())


@transaction.atomic
def generate_month(studio_id, month, family_id=None):
    """Serialize with manual creation; one charge per student and month.

    Contract starts during the month are flagged for manual review, not prorated
    without an agreed rule. Inactive students are never automatically charged.
    """
    if month.day != 1:
        raise ValidationError({"code": "invalid_month"})
    studio = Studio.objects.select_for_update().get(pk=studio_id)
    families = {f.pk: f for f in Family.objects.filter(studio=studio)}
    if family_id is not None and family_id not in families:
        raise ValidationError({"code": "invalid_family"})
    students = Student.objects.filter(studio=studio, is_active=True, user__role="student",
                                       teaching_contract__isnull=False)
    if family_id is not None:
        students = students.filter(family_id=family_id)
    students = list(students.select_related("user", "teaching_contract").order_by("pk"))
    end = month.replace(day=monthrange(month.year, month.month)[1])
    skipped = []
    groups = {}
    for student in students:
        contract = student.teaching_contract
        if contract.contract_start_date > end:
            continue
        if existing_period(student, month, month):
            skipped.append({"student": str(student.pk), "code": "already_billed"})
            continue
        if contract.contract_start_date > month:
            skipped.append({"student": str(student.pk), "code": "partial_start"})
            continue
        family = families.get(student.family_id)
        key = ("family", family.pk) if family and not family.individual_billing else ("student", student.pk)
        groups.setdefault(key, []).append(student)
    created = []
    for (kind, key), members in groups.items():
        family = families[key] if kind == "family" else None
        today = berlin_today()
        invoice = Invoice.objects.create(studio=studio, family=family,
            student=None if family else members[0], service_month=month,
            issue_date=today, due_date=today+timedelta(days=7), status="draft")
        for student in members:
            name = student.user.get_full_name()
            item = InvoiceLineItem.objects.create(invoice=invoice, student=student,
                student_name_snapshot=name, description=f"{lesson_subject(student)} – {name}",
                quantity=Decimal("1"), unit_price=student.teaching_contract.monthly_amount)
            TuitionMonth.objects.create(student=student, month=month, invoice=invoice, line_item=item)
        invoice.calculate_totals()
        # Freeze identity and charge details when generating, not on later membership changes.
        invoice.document_snapshot = invoice_snapshot(invoice)
        if family:
            invoice.document_snapshot["family_name"] = str(family)
        invoice.save(update_fields=["document_snapshot", "updated_at"])
        created.append(invoice)
    return created, skipped
