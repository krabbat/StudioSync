"""Remote Apple deletions are retained in StudioSync as red cancellations."""
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone
from icalendar import Calendar, Event

from apps.lessons.icloud_sync import _import_series, _key, sync_icloud_user
from apps.lessons.models import ICloudCalendarOccurrence, ICloudCalendarSeries, Lesson

CAL_URL = "https://p12-caldav.icloud.com/abc/calendars/unterricht/"
REMOTE_URL = CAL_URL + "apple-recurring.ics"


def _ical(start, name, *, removed=None):
    calendar = Calendar()
    calendar.add("version", "2.0")
    calendar.add("prodid", "-//MUSart remote deletion tests//DE")
    event = Event()
    event.add("uid", "apple-recurring-deletions@musart.de")
    event.add("dtstamp", timezone.now())
    event.add("dtstart", start)
    event.add("dtend", start + timedelta(minutes=45))
    event.add("summary", name)
    event.add("rrule", {"freq": "weekly", "count": 3})
    if removed is not None:
        event.add("exdate", removed)
    calendar.add_component(event)
    return calendar.to_ical().decode("utf-8")


def _remote(raw):
    remote = MagicMock()
    remote.url = REMOTE_URL
    remote.data = raw
    remote.load.return_value = None
    return remote


@pytest.mark.django_db
def test_apple_exdate_marks_one_future_lesson_cancelled(
    admin_user, studio, student, teacher,
):
    start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=4)
    first = _remote(_ical(start, student.user.get_full_name()))
    stats = {"imported": 0, "exported": 0, "cancelled": 0, "unassigned": 0, "conflicts": 0}
    series = _import_series(admin_user, studio, CAL_URL, first, stats)
    assert stats["imported"] == 3
    assert Lesson.objects.filter(studio=studio, student=student).count() == 3

    first.data = _ical(
        start, student.user.get_full_name(),
        removed=start + timedelta(days=7),
    )
    _import_series(admin_user, studio, CAL_URL, first, stats)
    assert stats["cancelled"] == 1
    cancelled = Lesson.objects.get(
        student=student, scheduled_start=start + timedelta(days=7)
    )
    assert cancelled.status == "cancelled"
    assert Lesson.objects.filter(student=student, status="scheduled").count() == 2
    link = ICloudCalendarOccurrence.objects.get(
        series=series, recurrence_id=_key(start + timedelta(days=7))
    )
    assert link.lesson_id is not None
    assert link.synced_signature != "remote-deleted"

    # Repeated pulls must not resurrect the removed occurrence.
    _import_series(admin_user, studio, CAL_URL, first, stats)
    assert stats["cancelled"] == 1
    assert Lesson.objects.filter(student=student).count() == 3


@pytest.mark.django_db
def test_apple_exdate_keeps_paid_lesson_for_teaching_history(
    admin_user, studio, student, teacher,
):
    start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=3)
    remote = _remote(_ical(start, student.user.get_full_name()))
    stats = {"imported": 0, "exported": 0, "cancelled": 0, "unassigned": 0, "conflicts": 0}
    series = _import_series(admin_user, studio, CAL_URL, remote, stats)
    middle = ICloudCalendarOccurrence.objects.get(
        series=series, recurrence_id=_key(start + timedelta(days=7))
    ).lesson
    Lesson.objects.filter(pk=middle.pk).update(is_paid=True, status="completed")
    remote.data = _ical(
        start, student.user.get_full_name(),
        removed=start + timedelta(days=7),
    )
    _import_series(admin_user, studio, CAL_URL, remote, stats)
    middle.refresh_from_db()
    assert middle.is_paid
    assert middle.status == "completed"
    assert stats["cancelled"] == 0


@pytest.mark.django_db
def test_missing_apple_series_is_cancelled_after_two_polls(
    admin_user, studio, student, teacher,
):
    from apps.lessons.icloud_sync import _hash

    start = timezone.now() + timedelta(days=2)
    raw = _ical(start, student.user.get_full_name())
    series = ICloudCalendarSeries.objects.create(
        user=admin_user, studio=studio, student=student, teacher=teacher,
        calendar_url=CAL_URL, remote_url=REMOTE_URL,
        uid="apple-recurring-deletions@musart.de",
        ical_data=raw, remote_hash=_hash(raw),
    )
    lesson = Lesson(
        studio=studio, student=student, teacher=teacher, status="scheduled",
        scheduled_start=start, scheduled_end=start + timedelta(minutes=45),
    )
    Lesson.objects.bulk_create([lesson])
    link = ICloudCalendarOccurrence.objects.create(
        series=series, lesson=lesson,
        recurrence_id=_key(start), synced_signature="existing-signature",
    )
    client = MagicMock()
    client.calendar.return_value.events.return_value = []
    context = MagicMock()
    context.__enter__.return_value = client
    config = {
        "icloud_username": "user@icloud.com",
        "icloud_app_password": "password",
        "icloud_calendar_url": CAL_URL,
    }
    with (
        patch("apps.lessons.icloud_sync._connect", return_value=context),
        patch("apps.lessons.icloud_sync._discover", return_value=[{"url": CAL_URL}]),
        patch("apps.lessons.icloud_sync._settings", return_value=config),
        patch("apps.lessons.icloud_sync._credentials", return_value=("user@icloud.com", "password")),
    ):
        first = sync_icloud_user(admin_user)
        assert first["cancelled"] == 0
        assert Lesson.objects.filter(pk=lesson.pk).exists()
        second = sync_icloud_user(admin_user)
        assert second["cancelled"] == 1
        assert Lesson.objects.filter(pk=lesson.pk, status="cancelled").exists()
        third = sync_icloud_user(admin_user)
        assert third["cancelled"] == 0

    link.refresh_from_db()
    assert link.lesson_id is not None
    assert link.synced_signature != "remote-deleted"


@pytest.mark.django_db
def test_missing_apple_series_keeps_completed_paid_lesson(
    admin_user, studio, student, teacher,
):
    from apps.lessons.icloud_sync import _hash

    start = timezone.now() + timedelta(days=2)
    raw = _ical(start, student.user.get_full_name())
    series = ICloudCalendarSeries.objects.create(
        user=admin_user, studio=studio, student=student, teacher=teacher,
        calendar_url=CAL_URL, remote_url=REMOTE_URL,
        uid="apple-recurring-deletions@musart.de",
        ical_data=raw, remote_hash=_hash(raw),
        last_error="Terminserie in iCloud fehlt; Löschung wird geprüft.",
    )
    lesson = Lesson(
        studio=studio, student=student, teacher=teacher, status="completed",
        is_paid=True,
        scheduled_start=start, scheduled_end=start + timedelta(minutes=45),
    )
    Lesson.objects.bulk_create([lesson])
    ICloudCalendarOccurrence.objects.create(
        series=series, lesson=lesson,
        recurrence_id=_key(start), synced_signature="existing-signature",
    )
    client = MagicMock()
    client.calendar.return_value.events.return_value = []
    context = MagicMock()
    context.__enter__.return_value = client
    config = {
        "icloud_username": "user@icloud.com",
        "icloud_app_password": "password",
        "icloud_calendar_url": CAL_URL,
    }
    with (
        patch("apps.lessons.icloud_sync._connect", return_value=context),
        patch("apps.lessons.icloud_sync._discover", return_value=[{"url": CAL_URL}]),
        patch("apps.lessons.icloud_sync._settings", return_value=config),
        patch("apps.lessons.icloud_sync._credentials", return_value=("user@icloud.com", "password")),
    ):
        result = sync_icloud_user(admin_user)
    assert result["cancelled"] == 0
    lesson.refresh_from_db()
    assert lesson.status == "completed"
    assert lesson.is_paid
