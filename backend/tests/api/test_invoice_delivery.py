"""MUSart manual invoice PDF and SMTP integration; no live mail is sent."""

from datetime import date
from io import BytesIO
from unittest.mock import patch

import pytest
from django.core import mail
from django.core.mail.backends.locmem import EmailBackend as InMemoryMailBackend
from django.urls import reverse
from rest_framework import status

from apps.billing.models import Invoice, StudentBillingProfile


def prepare_billing(studio, admin_user, student, *, email="eltern@example.org"):
    studio.address_line1 = "Hauptstraße 1"
    studio.postal_code = "15738"
    studio.city = "Zeuthen"
    studio.save(update_fields=["address_line1", "postal_code", "city"])
    student.address_line1 = "Musterweg 12"
    student.postal_code = "15732"
    student.city = "Schulzendorf"
    student.save(update_fields=["address_line1", "postal_code", "city"])
    StudentBillingProfile.objects.create(
        student=student, recipient_name="Mutter Beispiel",
        recipient_email=email, payment_method="bank_transfer",
    )
    admin_user.preferences = {"technical": {
        "smtp_host": "mail.example.org",
        "smtp_port": "465",
        "smtp_username": "info@example.org",
        "smtp_password": "dummy-test-password",
        "smtp_from_email": "info@example.org",
        "smtp_from_name": "MUSart",
    }}
    admin_user.save(update_fields=["preferences"])


@pytest.mark.django_db
def test_invoice_uses_musart_sender_payment_options_and_instrument(studio, student, admin_user):
    """Explicit studio settings and the database instrument appear in the snapshot."""
    from apps.billing.invoice_pdf import (
        invoice_snapshot, lesson_subject, render_invoice_pdf,
    )
    from apps.billing.models import InvoiceLineItem

    prepare_billing(studio, admin_user, student)
    studio.settings = {
        **(studio.settings or {}),
        "billing_sender_name": "Peter Müller",
        "billing_sender_street": "Lindenring 68",
        "billing_sender_postal_code": "15738",
        "billing_sender_city": "Zeuthen",
        "billing_sender_email": "musikunterricht@musart.de",
        "bank_account_holder": "Peter Müller",
        "bank_name": "Mittelbrandenburgische Sparkasse",
        "bank_iban": "DE36160500001102555645",
        "paypal_email": "xasteryia@googlemail.com",
    }
    studio.save(update_fields=["settings"])
    student.instrument = "Saxophon"
    student.instruments = ["Saxophon"]
    student.save(update_fields=["instrument", "instruments"])

    invoice = Invoice.objects.create(studio=studio, student=student, due_date=date(2027, 1, 7))
    InvoiceLineItem.objects.create(
        invoice=invoice, description="Monatsbeitrag Januar 2027",
        quantity=1, unit_price=135,
    )
    invoice.calculate_totals()
    snapshot = invoice_snapshot(invoice)
    assert snapshot["sender_name"] == "Peter Müller"
    assert snapshot["sender_street"] == "Lindenring 68"
    assert snapshot["sender_postal_code"] == "15738"
    assert snapshot["sender_city"] == "Zeuthen"
    assert snapshot["sender_email"] == "musikunterricht@musart.de"
    assert snapshot["bank_holder"] == "Peter Müller"
    assert snapshot["bank_name"] == "Mittelbrandenburgische Sparkasse"
    assert snapshot["bank_iban"] == "DE36160500001102555645"
    assert snapshot["paypal_email"] == "xasteryia@googlemail.com"
    assert snapshot["lesson_subject"] == "Saxophonunterricht"
    assert render_invoice_pdf(snapshot).startswith(b"%PDF")

    student.instrument = ""
    student.save(update_fields=["instrument"])
    assert lesson_subject(student) == "Saxophonunterricht"
    student.instruments = []
    assert lesson_subject(student) == "Musikunterricht"


def payload(student, **extras):
    return {
        "student": str(student.pk),
        "due_date": "2027-01-07",
        "service_month": "2027-01-01",
        "line_items": [{
            "description": "Klavierunterricht – Monatsbeitrag Januar 2027",
            "quantity": "1",
            "unit_price": "135.00",
        }],
        **extras,
    }


@pytest.mark.django_db
def test_issue_emails_explicit_bill_to_not_student_login(authenticated_client, studio, admin_user, student):
    prepare_billing(studio, admin_user, student)
    with (
        patch("apps.billing.invoice_delivery.assert_public_host"),
        patch("apps.billing.invoice_delivery.get_connection", return_value=InMemoryMailBackend()),
    ):
        response = authenticated_client.post(
            reverse("invoice-list"), payload(student, send_now=True), format="json"
        )
    assert response.status_code == 201, response.data
    invoice = Invoice.objects.get(pk=response.data["id"])
    assert invoice.status == "sent"
    assert invoice.sent_at is not None
    assert invoice.pdf_created_at is not None
    assert bytes(invoice.pdf_document).startswith(b"%PDF")
    assert invoice.document_snapshot["recipient_email"] == "eltern@example.org"
    assert invoice.document_snapshot["recipient_name"] == "Mutter Beispiel"
    assert invoice.document_snapshot["service_period"] == "01.01.2027 - 31.01.2027"
    assert response.data["email_sent"] is True
    assert response.data["email_error"] == ""
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["eltern@example.org"]
    assert mail.outbox[0].to != [student.user.email]
    assert mail.outbox[0].attachments[0][2] == "application/pdf"

    pdf = authenticated_client.get(reverse("invoice-pdf", args=[invoice.id]))
    assert pdf.status_code == 200
    assert bytes(pdf.content).startswith(b"%PDF")


@pytest.mark.django_db
def test_missing_recipient_does_not_claim_sent_and_retry_sends_once(
    authenticated_client, studio, admin_user, student
):
    prepare_billing(studio, admin_user, student, email="")
    created = authenticated_client.post(
        reverse("invoice-list"), payload(student, send_now=True), format="json"
    )
    assert created.status_code == 201
    assert created.data["email_sent"] is False
    assert "Rechnungs-E-Mail" in created.data["email_error"]
    invoice = Invoice.objects.get(pk=created.data["id"])
    assert invoice.status == "draft"
    assert invoice.sent_at is None
    assert not invoice.pdf_document

    profile = StudentBillingProfile.objects.get(student=student)
    profile.recipient_email = "eltern@example.org"
    profile.save(update_fields=["recipient_email"])
    with (
        patch("apps.billing.invoice_delivery.assert_public_host"),
        patch("apps.billing.invoice_delivery.get_connection", return_value=InMemoryMailBackend()),
    ):
        first = authenticated_client.post(reverse("invoice-send", args=[invoice.id]))
        second = authenticated_client.post(reverse("invoice-send", args=[invoice.id]))
    assert first.status_code == 200, first.data
    assert first.data["email_sent"] is True
    assert second.data["already_sent"] is True
    assert len(mail.outbox) == 2
    assert mail.outbox[0].to == mail.outbox[1].to
    assert mail.outbox[0].attachments[0][1] == mail.outbox[1].attachments[0][1]

    invoice.refresh_from_db()
    original_pdf = bytes(invoice.pdf_document)
    profile.recipient_name = "Neuer Name"
    profile.save(update_fields=["recipient_name"])
    assert bytes(Invoice.objects.get(pk=invoice.pk).pdf_document) == original_pdf


@pytest.mark.django_db
def test_smtp_failure_never_marks_invoice_sent(authenticated_client, studio, admin_user, student):
    prepare_billing(studio, admin_user, student)
    with (
        patch("apps.billing.invoice_delivery.assert_public_host"),
        patch("apps.billing.invoice_delivery.get_connection", side_effect=OSError("SMTP unavailable")),
    ):
        # The connection object could fail during its creation as well as send().
        response = authenticated_client.post(
            reverse("invoice-list"), payload(student, send_now=True), format="json"
        )
    assert response.status_code == 201
    invoice = Invoice.objects.get(pk=response.data["id"])
    assert invoice.status == "draft"
    assert invoice.sent_at is None
    assert response.data["email_sent"] is False


@pytest.mark.django_db
def test_email_unauthorized_and_foreign_student_rejected(
    authenticated_client, teacher_authenticated_client, student_authenticated_client,
    studio, student, admin_user
):
    prepare_billing(studio, admin_user, student)
    created = authenticated_client.post(
        reverse("invoice-list"), payload(student, send_now=False), format="json"
    )
    assert created.status_code == 201
    pk = created.data["id"]
    assert teacher_authenticated_client.post(reverse("invoice-send", args=[pk])).status_code == 403
    assert student_authenticated_client.post(reverse("invoice-send", args=[pk])).status_code == 403
    assert student_authenticated_client.get(reverse("invoice-pdf", args=[pk])).status_code == 200

    from apps.core.models import Student, Studio, User
    other_admin = User.objects.create_user(
        email="otheradmin@example.org", password="testtest123", role="admin"
    )
    other_studio = Studio.objects.create(
        owner=other_admin, name="Other Studio", email="other@example.org",
    )
    other_user = User.objects.create_user(
        email="otherstudent@example.org", password="testtest123", role="student"
    )
    other_student = Student.objects.create(
        user=other_user, studio=other_studio, primary_teacher=None,
    )
    foreign = authenticated_client.post(reverse("invoice-list"), payload(other_student), format="json")
    assert foreign.status_code == 400
    assert Invoice.objects.count() == 1


@pytest.mark.django_db
def test_no_tax_is_added_to_invoice(authenticated_client, studio, admin_user, student):
    prepare_billing(studio, admin_user, student)
    created = authenticated_client.post(reverse("invoice-list"), payload(student), format="json")
    assert created.status_code == status.HTTP_201_CREATED
    assert created.data["tax_amount"] == "0.00"
    assert created.data["total_amount"] == "135.00"
    forbidden = authenticated_client.post(
        reverse("invoice-list"), payload(student, tax_amount="25.65"), format="json"
    )
    assert forbidden.status_code == 400

@pytest.mark.django_db
def test_manual_invoice_range_covers_inclusive_months(authenticated_client, studio, student):
    from apps.billing.invoice_pdf import invoice_snapshot
    from apps.billing.models import Invoice

    response = authenticated_client.post(reverse("invoice-list"), payload(
        student,
        send_now=False,
        service_month="2027-01-01",
        service_month_end="2027-03-01",
        line_items=[{
            "description": "Nachberechnung Unterricht Januar–März 2027",
            "quantity": "3",
            "unit_price": "135.00",
        }],
    ), format="json")
    assert response.status_code == 201, response.data
    invoice = Invoice.objects.get(pk=response.data["id"])
    assert invoice.service_month_end == date(2027, 3, 1)
    assert invoice.total_amount == 405
    assert invoice_snapshot(invoice)["service_period"] == "01.01.2027 - 31.03.2027"
    assert invoice.sent_at is None


@pytest.mark.django_db
def test_single_month_needs_no_end_and_custom_amount_remains_editable(
    authenticated_client, studio, student
):
    from apps.billing.invoice_pdf import invoice_snapshot
    from apps.billing.models import Invoice

    response = authenticated_client.post(reverse("invoice-list"), payload(
        student,
        send_now=False,
        service_month_end=None,
        line_items=[{
            "description": "Individueller Unterrichtsbeitrag Januar 2027",
            "quantity": "1",
            "unit_price": "95.00",
        }],
    ), format="json")
    assert response.status_code == 201, response.data
    invoice = Invoice.objects.get(pk=response.data["id"])
    assert invoice.service_month_end is None
    assert invoice.total_amount == 95
    assert invoice_snapshot(invoice)["service_period"] == "01.01.2027 - 31.01.2027"


@pytest.mark.django_db
@pytest.mark.parametrize("start,end", [
    ("2027-03-01", "2027-01-01"),
    (None, "2027-02-01"),
    ("2027-01-10", "2027-02-01"),
    ("2027-01-01", "2027-02-03"),
])
def test_invalid_month_range_rejected(authenticated_client, studio, student, start, end):
    response = authenticated_client.post(reverse("invoice-list"), payload(
        student, send_now=False, service_month=start, service_month_end=end
    ), format="json")
    assert response.status_code == 400, response.data
    assert "service_month_end" in response.data or "service_month" in response.data


@pytest.mark.django_db
def test_multi_month_pdf_without_separate_paypal_request(studio, student):
    from apps.billing.invoice_pdf import invoice_snapshot, render_invoice_pdf
    from apps.billing.models import Invoice, InvoiceLineItem
    invoice = Invoice.objects.create(
        studio=studio, student=student, due_date=date(2027, 4, 7),
        service_month=date(2027, 1, 1), service_month_end=date(2027, 3, 1),
    )
    InvoiceLineItem.objects.create(
        invoice=invoice, description="Saxophonunterricht Januar bis März",
        quantity=3, unit_price=135,
    )
    invoice.calculate_totals()
    snapshot = invoice_snapshot(invoice)
    assert snapshot["service_period"] == "01.01.2027 - 31.03.2027"
    pdf = render_invoice_pdf(snapshot)
    assert pdf.startswith(b"%PDF")

@pytest.mark.django_db
def test_resent_invoice_preserves_recipient_pdf_and_first_sent_at(
    authenticated_client, studio, admin_user, student
):
    prepare_billing(studio, admin_user, student)
    with (
        patch("apps.billing.invoice_delivery.assert_public_host"),
        patch("apps.billing.invoice_delivery.get_connection", return_value=InMemoryMailBackend()),
    ):
        created = authenticated_client.post(
            reverse("invoice-list"), payload(student, send_now=True), format="json"
        )
        assert created.status_code == 201, created.data
        invoice = Invoice.objects.get(pk=created.data["id"])
        original_sent_at = invoice.sent_at
        original_pdf = bytes(invoice.pdf_document)
        original_snapshot = invoice.document_snapshot.copy()
        profile = StudentBillingProfile.objects.get(student=student)
        profile.recipient_email = "new-recipient@example.org"
        profile.save(update_fields=["recipient_email"])
        resent = authenticated_client.post(reverse("invoice-send", args=[invoice.pk]))

    assert resent.status_code == 200, resent.data
    assert resent.data["already_sent"] is True
    assert len(mail.outbox) == 2
    assert mail.outbox[1].to == ["eltern@example.org"]
    assert mail.outbox[1].attachments[0][1] == original_pdf
    invoice.refresh_from_db()
    assert invoice.sent_at == original_sent_at
    assert bytes(invoice.pdf_document) == original_pdf
    assert invoice.document_snapshot == original_snapshot


@pytest.mark.django_db
def test_admin_may_delete_sent_invoice_other_roles_may_not(
    authenticated_client, teacher_authenticated_client, student_authenticated_client,
    studio, admin_user, student
):
    prepare_billing(studio, admin_user, student)
    with (
        patch("apps.billing.invoice_delivery.assert_public_host"),
        patch("apps.billing.invoice_delivery.get_connection", return_value=InMemoryMailBackend()),
    ):
        created = authenticated_client.post(
            reverse("invoice-list"), payload(student, send_now=True), format="json"
        )
    assert created.status_code == 201, created.data
    invoice_id = created.data["id"]
    url = reverse("invoice-detail", args=[invoice_id])
    assert teacher_authenticated_client.delete(url).status_code == 403
    assert student_authenticated_client.delete(url).status_code == 403
    assert Invoice.objects.filter(pk=invoice_id).exists()
    assert authenticated_client.delete(url).status_code == 204
    assert not Invoice.objects.filter(pk=invoice_id).exists()
