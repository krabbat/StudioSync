"""MUSart payment states, manual payment marking, and dashboard KPIs."""

from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.billing.models import Invoice, Payment
from apps.billing.payment_status import (
    MANUAL_PAYMENT_NOTE,
    paid_amount,
    open_amount,
    payment_state,
    payment_totals,
    effective_due_date,
)


def make_invoice(studio, student, *, due_date, issued=date(2026, 11, 22),
                 amount="135.00", paid="0.00", status="sent"):
    return Invoice.objects.create(
        studio=studio, student=student, issue_date=issued,
        due_date=due_date, total_amount=Decimal(amount),
        amount_paid=Decimal(paid), status=status,
        sent_at=timezone.now() if status == "sent" else None,
    )


@pytest.mark.django_db
def test_backdated_due_date_stays_pending_when_newly_issued(studio, student):
    invoice = make_invoice(studio, student, due_date=date(2026, 10, 7))
    assert effective_due_date(invoice) == date(2026, 11, 29)
    assert payment_state(invoice, on_date=date(2026, 11, 22)) == "pending"
    assert payment_state(invoice, on_date=date(2026, 11, 29)) == "pending"
    assert payment_state(invoice, on_date=date(2026, 11, 30)) == "overdue"
    assert invoice.status == "sent"


@pytest.mark.django_db
def test_regular_invoice_becomes_overdue_after_due_date(studio, student):
    invoice = make_invoice(studio, student, due_date=date(2026, 11, 25))
    assert payment_state(invoice, on_date=date(2026, 11, 25)) == "pending"
    assert payment_state(invoice, on_date=date(2026, 11, 26)) == "overdue"
    invoice.status = "paid"
    assert payment_state(invoice, on_date=date(2026, 11, 30)) == "paid"


@pytest.mark.django_db
def test_summaries_account_for_partial_paid_and_exclude_cancelled(studio, student):
    pending = make_invoice(studio, student, due_date=date(2026, 10, 7))
    partially_paid = make_invoice(
        studio, student, due_date=date(2026, 11, 7),
        issued=date(2026, 10, 22),  # Issued before due date; no retroactive seven-day grace period.
        amount="135.00", paid="50.00", status="partial",
    )
    paid_legacy = make_invoice(
        studio, student, due_date=date(2026, 11, 7), status="paid",
    )
    cancelled = make_invoice(
        studio, student, due_date=date(2026, 10, 7), status="cancelled",
    )
    totals = payment_totals(
        [pending, partially_paid, paid_legacy, cancelled],
        on_date=date(2026, 11, 22),
    )
    assert totals["pending"] == Decimal("135.00")
    assert totals["overdue"] == Decimal("85.00")
    assert totals["paid"] == Decimal("185.00")
    assert paid_amount(paid_legacy) == Decimal("135.00")
    assert open_amount(paid_legacy) == Decimal("0")


@pytest.mark.django_db
def test_paid_action_records_payment_and_reverses_it(
    authenticated_client, studio, student
):
    invoice = make_invoice(studio, student, due_date=date(2026, 10, 7))
    with patch("apps.billing.payment_status.berlin_today", return_value=date(2026, 11, 22)):
        initial = authenticated_client.get(reverse("invoice-detail", args=[invoice.id]))
        assert initial.status_code == 200, initial.data
        assert initial.data["payment_status"] == "pending"
        assert initial.data["payment_remaining"] == "135.00"

        marked = authenticated_client.post(reverse("invoice-mark-paid", args=[invoice.pk]))
        assert marked.status_code == 200, marked.data
        assert marked.data["payment_status"] == "paid"
        assert marked.data["payment_remaining"] == "0"
        assert marked.data["payment_received"] == "135.00"

        # Pressing the paid button again cannot book a second payment.
        assert authenticated_client.post(
            reverse("invoice-mark-paid", args=[invoice.pk])
        ).status_code == 200
        assert Payment.objects.filter(invoice=invoice, notes=MANUAL_PAYMENT_NOTE).count() == 1

        reopened = authenticated_client.post(reverse("invoice-mark-pending", args=[invoice.pk]))
        assert reopened.status_code == 200, reopened.data
        assert reopened.data["payment_status"] == "pending"

    invoice.refresh_from_db()
    assert invoice.status == "sent"
    assert invoice.amount_paid == Decimal("0")
    assert invoice.paid_date is None
    assert not Payment.objects.filter(invoice=invoice).exists()


@pytest.mark.django_db
def test_reopening_does_not_remove_other_payments(authenticated_client, studio, student):
    invoice = make_invoice(
        studio, student, due_date=date(2026, 11, 30), paid="50.00", status="partial"
    )
    other = Payment.objects.create(
        invoice=invoice, amount=Decimal("50.00"), payment_method="bank_transfer",
        status="completed", notes="Automatisch zugeordnet",
    )
    paid = authenticated_client.post(reverse("invoice-mark-paid", args=[invoice.pk]))
    assert paid.status_code == 200, paid.data
    manual = Payment.objects.get(invoice=invoice, notes=MANUAL_PAYMENT_NOTE)
    assert manual.amount == Decimal("85.00")

    reopened = authenticated_client.post(reverse("invoice-mark-pending", args=[invoice.pk]))
    assert reopened.status_code == 200, reopened.data
    invoice.refresh_from_db()
    assert invoice.amount_paid == Decimal("50.00")
    assert invoice.status == "partial"
    assert invoice.payments.filter(pk=other.pk).exists()
    assert not invoice.payments.filter(notes=MANUAL_PAYMENT_NOTE).exists()


@pytest.mark.django_db
def test_only_admin_can_mark_payments(
    teacher_authenticated_client, student_authenticated_client,
    studio, student,
):
    invoice = make_invoice(studio, student, due_date=date(2026, 10, 7))
    for client in (teacher_authenticated_client, student_authenticated_client):
        assert client.post(reverse("invoice-mark-paid", args=[invoice.pk])).status_code == 403
        assert client.post(reverse("invoice-mark-pending", args=[invoice.pk])).status_code == 403


@pytest.mark.django_db
def test_dashboard_reports_three_amounts(authenticated_client, studio, student):
    make_invoice(studio, student, due_date=date(2026, 10, 7))
    make_invoice(studio, student, due_date=date(2026, 11, 1),
                 issued=date(2026, 10, 22))
    make_invoice(studio, student, due_date=date(2026, 11, 1), status="paid")
    with patch("apps.billing.payment_status.berlin_today", return_value=date(2026, 11, 22)):
        response = authenticated_client.get(reverse("dashboard-stats"))
    assert response.status_code == 200, response.data
    overview = response.data["overview"]
    assert overview["invoice_pending"]["value"] == 135.0
    assert overview["invoice_paid"]["value"] == 135.0
    assert overview["invoice_overdue"]["value"] == 135.0
    assert overview["unpaid_invoices"]["value"] == 270.0



@pytest.mark.django_db
def test_backdated_invoice_pdf_and_list_use_seven_day_deadline(studio, student):
    from apps.billing.invoice_pdf import (
        TAX_NOTICE, PAYMENT_NOTICE, invoice_snapshot, render_invoice_pdf,
    )
    from apps.billing.serializers import InvoiceSerializer
    from apps.billing.models import InvoiceLineItem

    invoice = make_invoice(
        studio, student, issued=date(2026, 11, 22),
        due_date=date(2026, 10, 7),
    )
    InvoiceLineItem.objects.create(
        invoice=invoice, description="Musikunterricht Oktober 2026",
        quantity=1, unit_price=135,
    )
    snapshot = invoice_snapshot(invoice)
    assert snapshot["issue_date"] == "22.11.2026"
    assert snapshot["due_date"] == "29.11.2026"
    # The original chosen date stays in the database as an audit attribute.
    assert invoice.due_date == date(2026, 10, 7)
    assert InvoiceSerializer(invoice).data["effective_due_date"] == "2026-11-29"
    assert payment_state(invoice, on_date=date(2026, 11, 29)) == "pending"
    assert payment_state(invoice, on_date=date(2026, 11, 30)) == "overdue"
    assert "Umsatzsteuerfrei" in TAX_NOTICE
    assert PAYMENT_NOTICE == (
        "Bitte zahlen Sie den offenen Betrag innerhalb von 7 Tagen "
        "entsprechend der vereinbarten Zahlungsmodalität."
    )
    assert render_invoice_pdf(snapshot).startswith(b"%PDF")


@pytest.mark.django_db
def test_future_due_date_remains_unchanged(studio, student):
    invoice = make_invoice(
        studio, student, issued=date(2026, 11, 22),
        due_date=date(2026, 12, 7),
    )
    assert effective_due_date(invoice) == date(2026, 12, 7)
    assert payment_state(invoice, on_date=date(2026, 12, 7)) == "pending"
    assert payment_state(invoice, on_date=date(2026, 12, 8)) == "overdue"
