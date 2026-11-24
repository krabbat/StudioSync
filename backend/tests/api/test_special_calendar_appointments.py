"""Special appointments require no student profile and keep their free-form notes."""
from datetime import timedelta

import pytest
from django.utils import timezone
from icalendar import Calendar

from apps.lessons.icloud_sync import _expand, _ical_for_lesson
from apps.lessons.models import Lesson


@pytest.mark.django_db
def test_admin_creates_special_appointment_without_student(
    authenticated_client, studio, teacher,
):
    start = timezone.now() + timedelta(days=2)
    payload = {
        "studio": str(studio.pk),
        "teacher": str(teacher.pk),
        "guest_name": "Gast Probestunde",
        "guest_address": "Musterstraße 3, 15738 Zeuthen",
        "summary": "Gitarre. Probestunde; Instrument bitte mitbringen.",
        "scheduled_start": start.isoformat(),
        "scheduled_end": (start + timedelta(minutes=45)).isoformat(),
        "lesson_type": "private",
        "status": "scheduled",
    }
    response = authenticated_client.post("/api/lessons/", payload, format="json")
    assert response.status_code == 201, response.data
    appointment = Lesson.objects.get(guest_name="Gast Probestunde")
    assert appointment.student_id is None
    assert appointment.guest_address == payload["guest_address"]
    assert appointment.summary == payload["summary"]
    listing = authenticated_client.get("/api/lessons/")
    assert listing.status_code == 200
    rows = listing.data.get("results", []) if isinstance(listing.data, dict) else listing.data
    row = next(item for item in rows if str(item["id"]) == str(appointment.id))
    assert row["student_name"] == "Gast Probestunde"
    assert row["student_address"] == payload["guest_address"]
    assert row["guest_name"] == payload["guest_name"]
    assert row["summary"] == payload["summary"]


@pytest.mark.django_db
def test_special_appointment_can_change_its_free_notes(
    authenticated_client, studio, teacher,
):
    start = timezone.now() + timedelta(days=4)
    lesson = Lesson(
        studio=studio, teacher=teacher, student=None,
        guest_name="Sondergast", guest_address="Testweg 4, Wildau",
        scheduled_start=start, scheduled_end=start + timedelta(minutes=30),
        summary="Probestunde",
    )
    Lesson.objects.bulk_create([lesson])
    response = authenticated_client.patch(
        f"/api/lessons/{lesson.pk}/",
        {"summary": "Ersatztermin – Gehörbildung"},
        format="json",
    )
    assert response.status_code == 200, response.data
    lesson.refresh_from_db()
    assert lesson.summary == "Ersatztermin – Gehörbildung"


@pytest.mark.django_db
def test_guest_name_address_and_notes_are_preserved_in_ical(
    studio, teacher,
):
    start = timezone.now() + timedelta(days=4)
    lesson = Lesson(
        studio=studio, teacher=teacher, student=None,
        guest_name="Probestunde Gast", guest_address="Testweg 4, Wildau",
        scheduled_start=start, scheduled_end=start + timedelta(minutes=45),
        summary="Flöte. Keine Vorkenntnisse.",
    )
    raw = _ical_for_lesson(lesson)
    master = [part for part in Calendar.from_ical(raw).walk() if part.name == "VEVENT"][0]
    assert str(master["SUMMARY"]) == lesson.guest_name
    assert str(master["LOCATION"]) == lesson.guest_address
    assert str(master["DESCRIPTION"]) == lesson.summary
    assert str(master["X-STUDIOSYNC-GUEST-NAME"]) == lesson.guest_name
    expanded = _expand(raw)
    assert len(expanded) == 1
    assert expanded[0]["description"] == lesson.summary
