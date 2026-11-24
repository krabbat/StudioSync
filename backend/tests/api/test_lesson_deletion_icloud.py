"""Deleting a lesson must remove only its event and protect teaching records."""
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone
from icalendar import Calendar, Event

from apps.lessons.icloud_sync import _hash, _key, _push_changes
from apps.lessons.models import Lesson, ICloudCalendarOccurrence, ICloudCalendarSeries

CAL_URL = "https://p12-caldav.icloud.com/abc/calendars/unterricht/"


@pytest.fixture
def appointment(db, studio, teacher, student):
    start = timezone.now() + timedelta(days=2)
    obj = Lesson(
        studio=studio, teacher=teacher, student=student, status="scheduled",
        scheduled_start=start, scheduled_end=start + timedelta(minutes=45),
    )
    Lesson.objects.bulk_create([obj])
    return obj


def _event(start, *, recurring=False):
    cal = Calendar()
    cal.add("version", "2.0")
    event = Event()
    event.add("uid", "test-deletion@musart.de")
    event.add("dtstamp", timezone.now())
    event.add("dtstart", start)
    event.add("dtend", start + timedelta(minutes=45))
    event.add("summary", "Test Schüler")
    if recurring:
        event.add("rrule", {"freq": "weekly", "count": 4})
    cal.add_component(event)
    return cal.to_ical().decode("utf-8")


@pytest.mark.django_db
def test_admin_can_delete_one_unlinked_lesson(authenticated_client, appointment):
    resp = authenticated_client.delete(f"/api/lessons/{appointment.pk}/")
    assert resp.status_code == 200
    assert resp.data["icloud_synced"] is True
    assert not Lesson.objects.filter(pk=appointment.pk).exists()


@pytest.mark.django_db
@pytest.mark.parametrize("status,paid", [
    ("completed", False), ("in_progress", False), ("no_show", False),
    ("scheduled", True),
])
def test_accounted_or_ongoing_lessons_are_protected(
    authenticated_client, appointment, status, paid,
):
    Lesson.objects.filter(pk=appointment.pk).update(status=status, is_paid=paid)
    resp = authenticated_client.delete(f"/api/lessons/{appointment.pk}/")
    assert resp.status_code == 400
    assert Lesson.objects.filter(pk=appointment.pk).exists()


@pytest.mark.django_db
def test_student_cannot_delete_lesson(student_authenticated_client, appointment):
    resp = student_authenticated_client.delete(f"/api/lessons/{appointment.pk}/")
    assert resp.status_code == 403
    assert Lesson.objects.filter(pk=appointment.pk).exists()


@pytest.mark.django_db
def test_delete_linked_occurrence_keeps_tombstone_for_icloud(
    authenticated_client, admin_user, appointment,
):
    series = ICloudCalendarSeries.objects.create(
        user=admin_user, studio=appointment.studio,
        calendar_url=CAL_URL, uid="test-deletion@musart.de",
        student=appointment.student, teacher=appointment.teacher,
    )
    occurrence = ICloudCalendarOccurrence.objects.create(
        series=series, recurrence_id=_key(appointment.scheduled_start),
        lesson=appointment, synced_signature="original-fingerprint",
    )

    def mark_uploaded(user):
        assert user.pk == admin_user.pk
        assert not Lesson.objects.filter(pk=appointment.pk).exists()
        link = ICloudCalendarOccurrence.objects.get(pk=occurrence.pk)
        assert link.lesson_id is None
        link.synced_signature = "deleted"
        link.save(update_fields=["synced_signature"])
        # An unrelated conflict must not change this lesson's outcome.
        return {"conflicts": 1}

    with patch("apps.lessons.icloud_sync.sync_icloud_user", side_effect=mark_uploaded) as fake:
        response = authenticated_client.delete(f"/api/lessons/{appointment.pk}/")

    fake.assert_called_once()
    assert response.status_code == 200
    assert response.data["icloud_synced"] is True
    assert ICloudCalendarOccurrence.objects.filter(pk=occurrence.pk, lesson__isnull=True).exists()


@pytest.mark.django_db
def test_delete_retains_icloud_tombstone_on_network_failure(
    authenticated_client, admin_user, appointment,
):
    series = ICloudCalendarSeries.objects.create(
        user=admin_user, studio=appointment.studio,
        calendar_url=CAL_URL, uid="test-deletion@musart.de",
    )
    occurrence = ICloudCalendarOccurrence.objects.create(
        series=series, recurrence_id=_key(appointment.scheduled_start),
        lesson=appointment, synced_signature="original-fingerprint",
    )
    with patch("apps.lessons.icloud_sync.sync_icloud_user", side_effect=OSError("offline")):
        response = authenticated_client.delete(f"/api/lessons/{appointment.pk}/")
    assert response.status_code == 200
    assert response.data["icloud_synced"] is False
    assert not Lesson.objects.filter(pk=appointment.pk).exists()
    assert ICloudCalendarOccurrence.objects.filter(pk=occurrence.pk, lesson__isnull=True).exists()


@pytest.mark.django_db
def test_deleting_one_recurring_occurrence_adds_exdate_not_whole_series(
    admin_user, appointment,
):
    raw = _event(appointment.scheduled_start, recurring=True)
    series = ICloudCalendarSeries.objects.create(
        user=admin_user, studio=appointment.studio,
        calendar_url=CAL_URL, uid="test-deletion@musart.de",
        ical_data=raw, remote_hash=_hash(raw),
        student=appointment.student, teacher=appointment.teacher,
    )
    link = ICloudCalendarOccurrence.objects.create(
        series=series, recurrence_id=_key(appointment.scheduled_start),
        synced_signature="previous-state",
    )
    remote = MagicMock()
    remote.data = raw
    remote.load.return_value = None
    stats = {"exported": 0, "conflicts": 0}
    _push_changes(series, remote, stats)
    parsed = Calendar.from_ical(remote.data)
    master = [part for part in parsed.walk() if part.name == "VEVENT"][0]
    assert master.get("RRULE")
    assert master.get("EXDATE")
    link.refresh_from_db()
    assert link.synced_signature == "deleted"
    assert stats["exported"] == 1
    remote.delete.assert_not_called()


@pytest.mark.django_db
def test_deleting_standalone_event_deletes_apple_event(
    admin_user, appointment,
):
    raw = _event(appointment.scheduled_start)
    series = ICloudCalendarSeries.objects.create(
        user=admin_user, studio=appointment.studio,
        calendar_url=CAL_URL, uid="test-deletion@musart.de",
        ical_data=raw, remote_hash=_hash(raw),
    )
    ICloudCalendarOccurrence.objects.create(
        series=series, recurrence_id=_key(appointment.scheduled_start),
        synced_signature="previous-state",
    )
    remote = MagicMock()
    remote.data = raw
    remote.load.return_value = None
    stats = {"exported": 0, "conflicts": 0}
    _push_changes(series, remote, stats)
    remote.delete.assert_called_once()
    assert not ICloudCalendarSeries.objects.filter(pk=series.pk).exists()
    assert stats["exported"] == 1
