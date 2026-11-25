"""A future-series deletion modifies RRULE in CalDAV, not only loaded instances."""
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone
from icalendar import Calendar, Event

from apps.lessons.icloud_sync import (
    _expand, _hash, _key, end_icloud_series_from_lesson,
)
from apps.lessons.models import (
    ICloudCalendarOccurrence, ICloudCalendarSeries, Lesson,
)

CAL_URL = "https://p12-caldav.icloud.com/abc/calendars/unterricht/"
EVENT_URL = CAL_URL + "lesson-series.ics"


def _series(start):
    calendar = Calendar()
    calendar.add("prodid", "-//MUSart test series//DE")
    calendar.add("version", "2.0")
    master = Event()
    master.add("uid", "future-series-test@musart.de")
    master.add("dtstamp", timezone.now())
    master.add("dtstart", start)
    master.add("dtend", start + timedelta(minutes=45))
    master.add("summary", "Test Schüler")
    master.add("rrule", {"freq": "weekly", "count": 4})
    calendar.add_component(master)
    return calendar.to_ical().decode("utf-8")


@pytest.fixture
def linked_series(db, admin_user, studio, student, teacher):
    start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=3)
    raw = _series(start)
    series = ICloudCalendarSeries.objects.create(
        user=admin_user, studio=studio, calendar_url=CAL_URL,
        uid="future-series-test@musart.de", remote_url=EVENT_URL,
        ical_data=raw, remote_hash=_hash(raw),
        student=student, teacher=teacher,
    )
    lessons = []
    for i in range(4):
        current = start + timedelta(days=i * 7)
        lesson = Lesson(
            studio=studio, student=student, teacher=teacher,
            scheduled_start=current,
            scheduled_end=current + timedelta(minutes=45),
            status="scheduled",
        )
        lessons.append(lesson)
    Lesson.objects.bulk_create(lessons)
    for lesson in lessons:
        ICloudCalendarOccurrence.objects.create(
            series=series, recurrence_id=_key(lesson.scheduled_start),
            lesson=lesson, synced_signature="synced-lesson",
        )
    remote = MagicMock()
    remote.url = EVENT_URL
    remote.data = raw
    client = MagicMock()
    client.calendar.return_value.events.return_value = [remote]
    context = MagicMock()
    context.__enter__.return_value = client
    return series, lessons, remote, context


@pytest.mark.django_db
def test_delete_from_second_week_preserves_first_and_truncates_apple(
    linked_series,
):
    series, lessons, remote, context = linked_series
    with (
        patch("apps.lessons.icloud_sync._connect", return_value=context),
        patch("apps.lessons.icloud_sync._discover", return_value=[{"url": CAL_URL}]),
        patch("apps.lessons.icloud_sync._credentials", return_value=("test@icloud.com", "secret")),
    ):
        affected = end_icloud_series_from_lesson(lessons[1])

    assert affected == 3
    assert Lesson.objects.filter(pk=lessons[0].pk).exists()
    for item in lessons[1:]:
        assert Lesson.objects.filter(pk=item.pk, status="cancelled").exists()
    remote.save.assert_called_once()
    remote.delete.assert_not_called()
    remaining = _expand(remote.data)
    assert len(remaining) == 1
    assert remaining[0]["start"] == lessons[0].scheduled_start
    series.refresh_from_db()
    assert series.remote_hash == _hash(remote.data)
    assert ICloudCalendarOccurrence.objects.filter(
        series=series, lesson__isnull=False
    ).count() == 4


@pytest.mark.django_db
def test_delete_from_first_week_removes_whole_apple_resource(linked_series):
    series, lessons, remote, context = linked_series
    with (
        patch("apps.lessons.icloud_sync._connect", return_value=context),
        patch("apps.lessons.icloud_sync._discover", return_value=[{"url": CAL_URL}]),
        patch("apps.lessons.icloud_sync._credentials", return_value=("test@icloud.com", "secret")),
    ):
        affected = end_icloud_series_from_lesson(lessons[0])

    assert affected == 4
    remote.delete.assert_called_once()
    assert ICloudCalendarSeries.objects.filter(pk=series.pk).exists()
    assert Lesson.objects.filter(pk__in=[lesson.pk for lesson in lessons], status="cancelled").count() == 4


@pytest.mark.django_db
def test_paid_future_lesson_blocks_series_deletion_before_remote_edit(
    linked_series,
):
    series, lessons, remote, context = linked_series
    Lesson.objects.filter(pk=lessons[2].pk).update(is_paid=True)
    with pytest.raises(Exception, match="bezahlte"):
        end_icloud_series_from_lesson(lessons[1])
    remote.delete.assert_not_called()
    remote.save.assert_not_called()
    assert Lesson.objects.filter(pk__in=[lesson.pk for lesson in lessons]).count() == 4


@pytest.mark.django_db
def test_future_deletion_refuses_icloud_remote_conflict(linked_series):
    series, lessons, remote, context = linked_series
    remote.data = _series(lessons[0].scheduled_start + timedelta(hours=1))
    with (
        patch("apps.lessons.icloud_sync._connect", return_value=context),
        patch("apps.lessons.icloud_sync._discover", return_value=[{"url": CAL_URL}]),
        patch("apps.lessons.icloud_sync._credentials", return_value=("test@icloud.com", "secret")),
        pytest.raises(Exception, match="verändert"),
    ):
        end_icloud_series_from_lesson(lessons[1])
    assert Lesson.objects.filter(pk__in=[lesson.pk for lesson in lessons]).count() == 4
