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


def payload(student, **extras):
    return {
        "student": str(student.pk),
        "due_date": "2027-01-07",
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
    assert len(mail.outbox) == 1

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
