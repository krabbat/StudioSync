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
    assert Lesson.objects.filter(pk=appointment.pk, status="cancelled").exists()


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
        assert Lesson.objects.filter(pk=appointment.pk, status="cancelled").exists()
        link = ICloudCalendarOccurrence.objects.get(pk=occurrence.pk)
        assert link.lesson_id == appointment.pk
        assert link.synced_signature == "pending-delete"
        link.synced_signature = "synced"
        link.save(update_fields=["synced_signature"])
        return {"conflicts": 1}

    with patch("apps.lessons.icloud_sync.sync_icloud_user", side_effect=mark_uploaded) as fake:
        response = authenticated_client.delete(f"/api/lessons/{appointment.pk}/")

    fake.assert_called_once()
    assert response.status_code == 200
    assert response.data["icloud_synced"] is True
    assert ICloudCalendarOccurrence.objects.filter(pk=occurrence.pk, lesson=appointment).exists()


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
        lesson=appointment, synced_signature="pending-delete",
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
    assert link.synced_signature != "pending-delete"
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
    assert ICloudCalendarSeries.objects.filter(pk=series.pk).exists()
    assert stats["exported"] == 1


@pytest.mark.django_db
def test_deleting_recurring_override_removes_exception_by_identity(
    admin_user, appointment,
):
    """If an instance was rescheduled, its VEVENT override must not survive EXDATE."""
    start = appointment.scheduled_start
    cal = Calendar.from_ical(_event(start, recurring=True))
    override = Event()
    override.add("uid", "test-deletion@musart.de")
    override.add("recurrence-id", start)
    override.add("dtstart", start + timedelta(hours=2))
    override.add("dtend", start + timedelta(hours=2, minutes=45))
    override.add("summary", "Rescheduled lesson")
    cal.add_component(override)
    raw = cal.to_ical().decode("utf-8")

    series = ICloudCalendarSeries.objects.create(
        user=admin_user, studio=appointment.studio,
        calendar_url=CAL_URL, uid="test-deletion@musart.de",
        ical_data=raw, remote_hash=_hash(raw),
    )
    ICloudCalendarOccurrence.objects.create(
        series=series, recurrence_id=_key(start),
        synced_signature="previous-state",
    )
    remote = MagicMock()
    remote.data = raw
    stats = {"exported": 0, "conflicts": 0}

    _push_changes(series, remote, stats)

    changed = Calendar.from_ical(remote.data)
    events = [part for part in changed.walk() if part.name == "VEVENT"]
    assert len(events) == 1
    assert events[0].get("RRULE") is not None
    assert events[0].get("EXDATE") is not None
    assert stats["exported"] == 1
