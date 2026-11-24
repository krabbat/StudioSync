"""CalDAV regression coverage: recurring import, matching, idempotence and edits."""
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone
from icalendar import Calendar, Event

from apps.lessons.icloud_sync import _expand, sync_icloud_user
from apps.lessons.models import Lesson, ICloudCalendarSeries, ICloudCalendarOccurrence

CALENDAR_URL = "https://p12-caldav.icloud.com/abc/calendars/unterricht/"
EVENT_URL = CALENDAR_URL + "weekly.ics"


def _ical(start, *, count=3, student_name="Student Test", moved=False):
    result = Calendar()
    result.add("prodid", "-//MUSart tests//DE")
    result.add("version", "2.0")
    master = Event()
    master.add("uid", "recurring-test-123@example.org")
    master.add("dtstamp", start)
    master.add("dtstart", start)
    master.add("dtend", start + timedelta(minutes=45))
    master.add("summary", student_name + " – Klavier")
    master.add("rrule", {"freq": "weekly", "count": count})
    result.add_component(master)
    if moved:
        exception = Event()
        exception.add("uid", "recurring-test-123@example.org")
        exception.add("recurrence-id", start + timedelta(days=7))
        exception.add("dtstart", start + timedelta(days=7, hours=2))
        exception.add("dtend", start + timedelta(days=7, hours=2, minutes=45))
        exception.add("summary", student_name + " – verschoben")
        result.add_component(exception)
    return result.to_ical().decode("utf-8")


def _remote(raw):
    remote = MagicMock()
    remote.url = EVENT_URL
    remote.data = raw
    remote.load.side_effect = lambda: None
    return remote


def _connect_mock(remote):
    calendar = MagicMock()
    calendar.url = CALENDAR_URL
    calendar.get_display_name.return_value = "MUSart Unterricht"
    client = MagicMock()
    client.principal.return_value.calendars.return_value = [calendar]
    client.calendar.return_value.events.return_value = [remote]
    context = MagicMock()
    context.__enter__.return_value = client
    return context


@pytest.mark.django_db
def test_weekly_icloud_series_is_imported_without_duplicates(
    admin_user, studio, student, teacher
):
    admin_user.preferences = {"technical": {
        "icloud_username": "user@icloud.com", "icloud_app_password": "secret",
        "icloud_calendar_url": CALENDAR_URL,
    }}
    admin_user.save(update_fields=["preferences"])
    start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=3)
    remote = _remote(_ical(start))
    with patch("apps.lessons.icloud_sync._connect", return_value=_connect_mock(remote)):
        first = sync_icloud_user(admin_user)
        second = sync_icloud_user(admin_user)
    assert first["imported"] == 3
    assert second["imported"] == 0
    assert Lesson.objects.filter(studio=studio, student=student).count() == 3
    assert ICloudCalendarSeries.objects.count() == 1
    assert ICloudCalendarOccurrence.objects.count() == 3


@pytest.mark.django_db
def test_ambiguous_icloud_title_waits_for_student_assignment(
    admin_user, studio, student, teacher
):
    admin_user.preferences = {"technical": {
        "icloud_username": "user@icloud.com", "icloud_app_password": "secret",
        "icloud_calendar_url": CALENDAR_URL,
    }}
    admin_user.save(update_fields=["preferences"])
    start = timezone.now() + timedelta(days=3)
    remote = _remote(_ical(start, student_name="Unbekannt"))
    with patch("apps.lessons.icloud_sync._connect", return_value=_connect_mock(remote)):
        result = sync_icloud_user(admin_user)
    assert result["unassigned"] == 1
    assert Lesson.objects.count() == 0
    record = ICloudCalendarSeries.objects.get()
    assert record.student is None
    assert record.last_error == "Schüler zuordnen"


def test_one_occurrence_can_move_without_shifting_whole_apple_series():
    start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=3)
    expanded = _expand(_ical(start, moved=True))
    assert len(expanded) == 3
    assert expanded[0]["start"] == start
    assert expanded[1]["start"] == start + timedelta(days=7, hours=2)
    assert expanded[2]["start"] == start + timedelta(days=14)


@pytest.mark.django_db
def test_local_single_occurrence_change_is_pushed_as_exception(
    admin_user, studio, student, teacher
):
    admin_user.preferences = {"technical": {
        "icloud_username": "user@icloud.com", "icloud_app_password": "secret",
        "icloud_calendar_url": CALENDAR_URL,
    }}
    admin_user.save(update_fields=["preferences"])
    start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=3)
    remote = _remote(_ical(start))
    context = _connect_mock(remote)
    with patch("apps.lessons.icloud_sync._connect", return_value=context):
        sync_icloud_user(admin_user)
        second = Lesson.objects.order_by("scheduled_start")[1]
        second.scheduled_start += timedelta(hours=2)
        second.scheduled_end += timedelta(hours=2)
        second.save(update_fields=["scheduled_start", "scheduled_end"])
        stats = sync_icloud_user(admin_user)
    assert stats["exported"] == 1
    parsed = Calendar.from_ical(remote.data)
    exceptions = [part for part in parsed.walk("VEVENT") if part.get("RECURRENCE-ID")]
    assert len(exceptions) == 1
    assert exceptions[0]["DTSTART"].dt == second.scheduled_start.astimezone(
        exceptions[0]["DTSTART"].dt.tzinfo
    )
