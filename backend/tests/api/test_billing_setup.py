"""MUSart billing recipient settings and non-sequential invoice numbers."""

import re
from datetime import date

import pytest
from django.urls import reverse
from django.utils import timezone
from zoneinfo import ZoneInfo

from apps.billing.models import Invoice, StudentBillingProfile


@pytest.mark.django_db
def test_billing_email_independent_and_explicit(authenticated_client, student):
    url = reverse("student-billing-profile", args=[student.id])
    initial = authenticated_client.get(url)
    assert initial.status_code == 200
    assert initial.data["recipient_email"] == ""
    assert initial.data["payment_method"] == "bank_transfer"
    # The student login email is never copied automatically.
    assert student.user.email

    saved = authenticated_client.put(url, {
        "recipient_name": "Elternteil Mustermann",
        "recipient_email": "rechnung@example.org",
        "recipient_address_line1": "Musterstraße 3",
        "recipient_postal_code": "15732",
        "recipient_city": "Zeuthen",
        "payment_method": "paypal",
    }, format="json")
    assert saved.status_code == 200, saved.data
    assert saved.data["recipient_email"] == "rechnung@example.org"
    assert StudentBillingProfile.objects.get(student=student).recipient_email == "rechnung@example.org"
    student.user.refresh_from_db()
    assert student.user.email != "rechnung@example.org"


@pytest.mark.django_db
def test_billing_details_admin_only(
    student_authenticated_client, teacher_authenticated_client, student
):
    url = reverse("student-billing-profile", args=[student.id])
    for client in (student_authenticated_client, teacher_authenticated_client):
        assert client.get(url).status_code == 403
        assert client.put(url, {"recipient_email": "unauthorized@example.org"}, format="json").status_code == 403
    assert not StudentBillingProfile.objects.filter(student=student).exists()


@pytest.mark.django_db
def test_billing_profile_rejects_invalid_recipient_email(authenticated_client, student):
    url = reverse("student-billing-profile", args=[student.id])
    response = authenticated_client.put(url, {
        "recipient_email": "keine-email", "payment_method": "cash",
    }, format="json")
    assert response.status_code == 400
    assert "recipient_email" in response.data
    assert not StudentBillingProfile.objects.filter(student=student).exists()


@pytest.mark.django_db
def test_invoice_number_uses_date_and_random_digits(studio, student):
    invoices = [
        Invoice.objects.create(
            studio=studio, student=student, due_date=date(2027, 1, 7)
        ) for _ in range(3)
    ]
    for invoice in invoices:
        assert re.fullmatch(r"\d{8}-\d{10}", invoice.invoice_number)
        assert invoice.invoice_number.startswith(timezone.localdate(timezone=ZoneInfo("Europe/Berlin")).strftime("%Y%m%d") + "-")
    assert len({invoice.invoice_number for invoice in invoices}) == 3
    assert all(not item.invoice_number.startswith("INV-") for item in invoices)
