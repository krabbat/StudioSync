"""Keep lesson cancellation details and status scoped to the edited appointment."""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.lessons.models import Lesson


@pytest.fixture
def cancellation_appointments(db, studio, student, teacher):
    base = timezone.now() + timedelta(days=2)
    cancelled = Lesson(
        studio=studio,
        student=student,
        teacher=teacher,
        status="scheduled",
        scheduled_start=base,
        scheduled_end=base + timedelta(minutes=45),
    )
    unrelated = Lesson(
        studio=studio,
        student=student,
        teacher=teacher,
        status="scheduled",
        scheduled_start=base + timedelta(hours=3),
        scheduled_end=base + timedelta(hours=3, minutes=45),
    )
    # Avoid sending student notification e-mails during tests.
    Lesson.objects.bulk_create([cancelled, unrelated])
    return cancelled, unrelated


@pytest.mark.django_db
def test_save_cancelled_reason_and_leave_other_lesson_unchanged(
    authenticated_client, cancellation_appointments,
):
    cancelled, unrelated = cancellation_appointments
    reason = "Schüler ist krank; die Familie hat rechtzeitig abgesagt."
    response = authenticated_client.patch(
        f"/api/lessons/{cancelled.pk}/",
        {"status": "cancelled", "cancellation_reason": reason},
        format="json",
    )

    assert response.status_code == 200, response.data
    assert response.data["status"] == "cancelled"
    assert response.data["cancellation_reason"] == reason

    cancelled.refresh_from_db()
    unrelated.refresh_from_db()
    assert cancelled.status == "cancelled"
    assert cancelled.cancellation_reason == reason
    # Status controls the appointment colour. An unrelated row must not change.
    assert unrelated.status == "scheduled"
    assert unrelated.cancellation_reason == ""


@pytest.mark.django_db
def test_calendar_list_supplies_cancellation_reason_to_edit_dialog(
    authenticated_client, cancellation_appointments,
):
    cancelled, _ = cancellation_appointments
    reason = "Eltern haben den Termin telefonisch abgesagt."

    resp = authenticated_client.patch(
        f"/api/lessons/{cancelled.pk}/",
        {"status": "cancelled", "cancellation_reason": reason},
        format="json",
    )
    assert resp.status_code == 200, resp.data

    listing = authenticated_client.get("/api/lessons/")
    assert listing.status_code == 200
    rows = listing.data.get("results", []) if isinstance(listing.data, dict) else listing.data
    updated = next(row for row in rows if str(row["id"]) == str(cancelled.pk))
    assert updated["status"] == "cancelled"
    assert updated["cancellation_reason"] == reason

    edit = authenticated_client.patch(
        f"/api/lessons/{cancelled.pk}/",
        {"cancellation_reason": reason + " Nachtrag."},
        format="json",
    )
    assert edit.status_code == 200
    cancelled.refresh_from_db()
    assert cancelled.cancellation_reason == reason + " Nachtrag."
