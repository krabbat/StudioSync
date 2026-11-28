"""Focused regression coverage; no actual SMTP or Home Assistant calls."""
from datetime import datetime, timedelta, time
from decimal import Decimal
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from django.core import mail
from django.core.mail.backends.locmem import EmailBackend
from django.utils import timezone

from apps.billing.automation import prepare_due_runs, run_billing_automation
from apps.billing.block_billing import block_status, generate_blocks, run_block_billing
from apps.billing.family_billing import generate_month
from apps.billing.models import (
    BillingAutomation, BillingRun, BlockBillingPlan, BlockInvoice,
    Invoice, StudentBillingProfile, TuitionMonth,
)
from apps.core.models import TeachingContract, Family, Student, User
from apps.lessons.models import Lesson

BERLIN = ZoneInfo("Europe/Berlin")


def setup_student(studio, student, admin_user, *, email="rechnung@musart.de", amount="135.00", payment="cash"):
    today = timezone.localdate(timezone=BERLIN)
    month = today.replace(day=1)
    TeachingContract.objects.create(student=student, contract_start_date=month,
        contract_year_start=month, lesson_minutes=45, monthly_amount=Decimal(amount))
    studio.address_line1, studio.postal_code, studio.city = "Testweg 1", "15738", "Zeuthen"
    studio.save(update_fields=["address_line1", "postal_code", "city"])
    student.address_line1, student.postal_code, student.city = "Testweg 2", "15738", "Zeuthen"
    student.save(update_fields=["address_line1", "postal_code", "city"])
    StudentBillingProfile.objects.create(student=student, recipient_name="Testperson",
        recipient_email=email, payment_method=payment)
    admin_user.preferences = {"technical": {"smtp_host": "mail.example.org", "smtp_port": "465",
        "smtp_username": "sender@example.org", "smtp_password": "mock", "smtp_from_email": "sender@example.org"}}
    admin_user.save(update_fields=["preferences"])
    return today, month


def make_lessons(studio, student, teacher, count, status="completed"):
    end = timezone.now() - timedelta(minutes=1)
    return Lesson.objects.bulk_create([
        Lesson(studio=studio, student=student, teacher=teacher, status=status,
               scheduled_start=end - timedelta(hours=i+1, minutes=45),
               scheduled_end=end - timedelta(hours=i+1))
        for i in range(count)
    ])


@pytest.mark.django_db
def test_block_send_once_then_payment_preserves_fifth_lesson(authenticated_client, studio, student, teacher, admin_user):
    today, month = setup_student(studio, student, admin_user)
    endpoint = f"/api/students/{student.pk}/block-billing/"
    response = authenticated_client.put(endpoint, {"enabled": True, "starts_on": str(today-timedelta(days=2)),
        "units_per_block": 4, "block_amount": "100.00", "test_only": True}, format="json")
    assert response.status_code == 200, response.data
    plan = BlockBillingPlan.objects.get(student=student)
    make_lessons(studio, student, teacher, 3)
    make_lessons(studio, student, teacher, 1, "scheduled")
    assert generate_blocks(plan.pk) == []
    make_lessons(studio, student, teacher, 2)
    with patch("apps.billing.invoice_delivery.assert_public_host"), patch("apps.billing.invoice_delivery.get_connection", return_value=EmailBackend()):
        assert run_block_billing()["sent"] == 1
        assert run_block_billing()["sent"] == 0
    bill = BlockInvoice.objects.get(plan=plan)
    assert bill.invoice.total_amount == Decimal("100.00")
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["rechnung@musart.de"]
    assert mail.outbox[0].subject.startswith("[TEST]")
    assert bill.units.count() == 4
    assert block_status(student)["open_units"] == 5
    assert generate_month(studio.pk, month)[0] == []
    assert authenticated_client.post(f"/api/billing/invoices/{bill.invoice_id}/mark-paid/").status_code == 200
    assert block_status(student)["open_units"] == 1
    assert authenticated_client.post(endpoint, {"action": "reset"}, format="json").data["open_units"] == 0
    assert Lesson.objects.filter(student=student, status="completed").count() == 5
    assert authenticated_client.delete(f"/api/billing/invoices/{bill.invoice_id}/").status_code == 400


@pytest.mark.django_db
def test_block_test_guard_and_access(authenticated_client, student_authenticated_client, studio, student, teacher, admin_user):
    today, _ = setup_student(studio, student, admin_user, email="external@example.org")
    plan = BlockBillingPlan.objects.create(student=student, enabled=True, starts_on=today-timedelta(days=2),
                                           units_per_block=4, block_amount=Decimal("100.00"), test_only=True)
    make_lessons(studio, student, teacher, 4)
    with patch("apps.billing.invoice_delivery.get_connection") as connection:
        assert run_block_billing()["sent"] == 0
        assert run_block_billing()["sent"] == 0
        connection.assert_not_called()
    bill = BlockInvoice.objects.get(plan=plan)
    assert bill.attempted_at and "@musart.de" in bill.delivery_error
    assert bill.invoice.sent_at is None
    assert student_authenticated_client.get(f"/api/students/{student.pk}/block-billing/").status_code == 403
    assert student_authenticated_client.get("/api/billing/invoices/automation/").status_code == 403


@pytest.mark.django_db
def test_scheduled_test_run_persists_admin_invoice(authenticated_client, student_authenticated_client, studio, student, admin_user):
    today, month = setup_student(studio, student, admin_user, payment="bank_transfer")
    family = Family.objects.create(studio=studio, name="Testfamilie", billing_recipient_name="Testeltern",
        billing_email="familie@musart.de", address_line1="Testweg 3", postal_code="15738", city="Zeuthen")
    student.family = family
    student.save(update_fields=["family"])
    sibling_user = User.objects.create_user(email="sibling@example.org", password="SafeStudent123!", role="student",
        first_name="Sibling", last_name="Test", is_approved=True)
    sibling, _ = Student.objects.get_or_create(user=sibling_user, defaults={"studio": studio, "family": family})
    sibling.studio, sibling.family = studio, family
    sibling.save(update_fields=["studio", "family"])
    TeachingContract.objects.create(student=sibling, contract_start_date=month, contract_year_start=month,
        lesson_minutes=45, monthly_amount=Decimal("65.00"))
    at = timezone.now() + timedelta(minutes=1)
    endpoint = "/api/billing/invoices/automation/"
    response = authenticated_client.put(endpoint, {"monthly_enabled": False, "monthly_from": str(month),
        "monthly_day": 1, "monthly_time": "08:00", "monthly_send": True,
        "test_enabled": True, "test_at": at.isoformat(), "test_month": str(month), "test_send": True}, format="json")
    assert response.status_code == 200, response.data
    prepare_due_runs(studio.pk, at-timedelta(seconds=1))
    assert not BillingRun.objects.exists()
    prepare_due_runs(studio.pk, at)
    run = BillingRun.objects.get(studio=studio, kind="test")
    item = run.items.get()
    assert item.amount == Decimal("200.00")
    assert item.recipient == "familie@musart.de"
    invoice = item.invoice
    assert invoice.monthly_test and invoice.invoice_number.startswith("TEST-")
    assert invoice.total_amount == Decimal("200.00")
    assert not TuitionMonth.objects.exists()
    with patch("apps.billing.invoice_delivery.assert_public_host"), patch("apps.billing.invoice_delivery.get_connection", return_value=EmailBackend()):
        run_billing_automation()
        run_billing_automation()
    item.refresh_from_db()
    assert item.state == "sent"
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["familie@musart.de"]
    invoice.refresh_from_db()
    assert invoice.sent_at and invoice.document_snapshot["test_only"]
    assert bytes(invoice.pdf_document).startswith(b"%PDF")
    assert not TuitionMonth.objects.exists()
    url = f"/api/billing/invoices/{invoice.pk}/"
    assert authenticated_client.get(url).data["monthly_test"]
    assert student_authenticated_client.get(url).status_code == 404
    from apps.billing.payment_status import payment_totals
    assert payment_totals(Invoice.objects.filter(studio=studio))["pending"] == Decimal("200.00")
    assert authenticated_client.post(url + "mark-paid/").status_code == 200
    invoice.refresh_from_db()
    assert invoice.amount_paid == Decimal("200.00")
    assert authenticated_client.delete(url).status_code == 204
    assert not Invoice.objects.filter(pk=invoice.pk).exists()
    assert len(generate_month(studio.pk, month)[0]) == 1
    assert not BillingAutomation.objects.get(studio=studio).test_enabled


@pytest.mark.django_db
def test_monthly_job_idempotent_draft_only(studio, student, admin_user):
    _, month = setup_student(studio, student, admin_user, payment="bank_transfer")
    BillingAutomation.objects.create(studio=studio, monthly_enabled=True, monthly_from=month,
        monthly_day=1, monthly_time=time(8), monthly_send=False)
    at = datetime.combine(month, time(8), tzinfo=BERLIN)
    prepare_due_runs(studio.pk, at-timedelta(seconds=1))
    assert not Invoice.objects.exists()
    prepare_due_runs(studio.pk, at)
    prepare_due_runs(studio.pk, at+timedelta(minutes=1))
    assert Invoice.objects.filter(service_month=month, status="draft").count() == 1
    assert TuitionMonth.objects.filter(month=month).count() == 1
    assert BillingRun.objects.filter(kind="monthly", studio=studio).count() == 1


def setup_collective_family(studio, student, admin_user, *, email="family@example.org"):
    _, month = setup_student(studio, student, admin_user, payment="bank_transfer")
    family = Family.objects.create(studio=studio, name="Testfamilie", billing_recipient_name="Testeltern",
        billing_email=email, address_line1="Testweg 3", postal_code="15738", city="Zeuthen")
    student.family = family
    student.save(update_fields=["family"])
    sibling_user = User.objects.create_user(email="family-sibling@example.org", password="SafeStudent123!",
        role="student", first_name="Sibling", last_name="Test", is_approved=True)
    sibling = Student.objects.create(user=sibling_user, studio=studio, family=family)
    TeachingContract.objects.create(student=sibling, contract_start_date=month, contract_year_start=month,
        lesson_minutes=45, monthly_amount=Decimal("65.00"))
    return family, month


@pytest.mark.django_db
def test_manual_family_month_creates_and_sends_once(authenticated_client, studio, student, admin_user):
    family, month = setup_collective_family(studio, student, admin_user)
    payload = {"family": str(family.pk), "month": str(month), "send_now": True}
    endpoint = "/api/billing/invoices/generate-month/"
    with patch("apps.billing.invoice_delivery.assert_public_host"), patch(
        "apps.billing.invoice_delivery.get_connection", return_value=EmailBackend()
    ):
        response = authenticated_client.post(endpoint, payload, format="json")
        assert response.status_code == 200, response.data
        row = response.data["invoices"][0]
        assert row["email_sent"] and not row["email_error"]
        invoice = Invoice.objects.get(pk=row["id"])
        assert invoice.family_id == family.pk and not invoice.student_id
        assert invoice.total_amount == Decimal("200.00")
        assert invoice.sent_at and bytes(invoice.pdf_document).startswith(b"%PDF")
        assert len(mail.outbox) == 1 and mail.outbox[0].to == ["family@example.org"]
        assert mail.outbox[0].attachments[0][2] == "application/pdf"
        assert authenticated_client.post(endpoint, payload, format="json").data["invoices"] == []
    assert len(mail.outbox) == 1


@pytest.mark.django_db
def test_manual_family_failed_delivery_preserves_draft_and_no_duplicate(authenticated_client, studio, student, admin_user):
    family, month = setup_collective_family(studio, student, admin_user)
    payload = {"family": str(family.pk), "month": str(month), "send_now": True}
    endpoint = "/api/billing/invoices/generate-month/"
    with patch("apps.billing.invoice_delivery.assert_public_host"), patch(
        "apps.billing.invoice_delivery.get_connection", side_effect=OSError("SMTP unavailable")
    ):
        response = authenticated_client.post(endpoint, payload, format="json")
        assert response.status_code == 200, response.data
        row = response.data["invoices"][0]
        assert not row["email_sent"] and row["email_error"]
        invoice = Invoice.objects.get(pk=row["id"])
        assert invoice.status == "draft" and not invoice.sent_at
        assert TuitionMonth.objects.filter(invoice=invoice).count() == 2
        assert authenticated_client.post(endpoint, payload, format="json").data["invoices"] == []
    with patch("apps.billing.invoice_delivery.assert_public_host"), patch(
        "apps.billing.invoice_delivery.get_connection", return_value=EmailBackend()
    ):
        assert authenticated_client.post(f"/api/billing/invoices/{invoice.pk}/send/").status_code == 200
    invoice.refresh_from_db()
    assert invoice.sent_at and len(mail.outbox) == 1


@pytest.mark.django_db
def test_automatic_family_month_sends_once(studio, student, admin_user):
    family, month = setup_collective_family(studio, student, admin_user)
    BillingAutomation.objects.create(studio=studio, monthly_enabled=True, monthly_from=month,
        monthly_day=1, monthly_time=time(0), monthly_send=True)
    at = datetime.combine(month, time(0), tzinfo=BERLIN)
    prepare_due_runs(studio.pk, at)
    with patch("apps.billing.invoice_delivery.assert_public_host"), patch(
        "apps.billing.invoice_delivery.get_connection", return_value=EmailBackend()
    ):
        run_billing_automation()
        run_billing_automation()
    invoice = Invoice.objects.get(family=family, service_month=month)
    assert invoice.sent_at and invoice.total_amount == Decimal("200.00")
    assert BillingRun.objects.get(studio=studio, kind="monthly").items.get().state == "sent"
    assert len(mail.outbox) == 1 and mail.outbox[0].to == ["family@example.org"]


@pytest.mark.django_db
def test_admin_can_delete_unpaid_sent_family_invoice_and_release_months(authenticated_client,
        teacher_authenticated_client, studio, student, admin_user):
    family, month = setup_collective_family(studio, student, admin_user)
    endpoint = "/api/billing/invoices/generate-month/"
    payload = {"family": str(family.pk), "month": str(month), "send_now": True}
    with patch("apps.billing.invoice_delivery.assert_public_host"), patch(
        "apps.billing.invoice_delivery.get_connection", return_value=EmailBackend()
    ):
        response = authenticated_client.post(endpoint, payload, format="json")
        assert response.status_code == 200, response.data
        row = response.data["invoices"][0]
        assert row["email_sent"]
        pk = row["id"]
        url = f"/api/billing/invoices/{pk}/"
        assert teacher_authenticated_client.delete(url).status_code == 403
        assert authenticated_client.delete(url).status_code == 204
        assert not Invoice.objects.filter(pk=pk).exists()
        assert not TuitionMonth.objects.filter(invoice_id=pk).exists()
        assert not TuitionMonth.objects.filter(student__family=family, month=month).exists()
        # No mail is sent as a side effect of deletion.
        assert len(mail.outbox) == 1
        recreated = authenticated_client.post(endpoint, {**payload, "send_now": False}, format="json")
        assert recreated.status_code == 200, recreated.data
        assert len(recreated.data["invoices"]) == 1
        assert not recreated.data["invoices"][0]["email_sent"]
        assert len(mail.outbox) == 1
