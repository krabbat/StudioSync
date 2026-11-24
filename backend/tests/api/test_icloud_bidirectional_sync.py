"""CalDAV regression coverage: recurring import, matching, idempotence and edits."""
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone
from icalendar import Calendar, Event

from apps.lessons.icloud_sync import LOCAL_TZ, _expand, sync_icloud_user
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
    # A local lesson that is moved away from a conflict can be exported to iCloud.
    # Fake that server creation with a valid event rather than an empty MagicMock.
    def create_event(content):
        result = _remote(content)
        result.url = CALENDAR_URL + "export-" + str(len(content)) + ".ics"
        return result
    client.calendar.return_value.save_event.side_effect = create_event
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


@pytest.mark.django_db
def test_collision_names_exact_blocking_lesson_and_clears_after_rebooking(
    admin_user, studio, student, teacher
):
    """A weekly import must identify the OTHER student and the actual time."""
    from apps.core.models import Student, User

    admin_user.preferences = {"technical": {
        "icloud_username": "user@icloud.com",
        "icloud_app_password": "secret",
        "icloud_calendar_url": CALENDAR_URL,
    }}
    admin_user.save(update_fields=["preferences"])

    # A different pupil of the same teacher already occupies the iCloud slot.
    other_user = User.objects.create_user(
        email="other@test.com", password=None,
        role="student", first_name="Lina", last_name="Becker",
    )
    other_student = Student.objects.create(
        user=other_user, studio=studio, primary_teacher=teacher, instrument="Gitarre"
    )
    start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=3)
    blocker = Lesson(
        studio=studio, teacher=teacher, student=other_student,
        scheduled_start=start, scheduled_end=start + timedelta(minutes=45),
        lesson_type="private", status="scheduled",
    )
    Lesson.objects.bulk_create([blocker])  # no notification signal
    remote = _remote(_ical(start, count=1))

    with patch("apps.lessons.icloud_sync._connect", return_value=_connect_mock(remote)):
        first = sync_icloud_user(admin_user)
        series = ICloudCalendarSeries.objects.get()
        assert first["conflicts"] == 1
        assert "Terminkollision:" in series.last_error
        assert "Lina Becker" in series.last_error
        assert start.astimezone(LOCAL_TZ).strftime("%d.%m.%Y") in series.last_error
        assert "Lehrkraft bereits belegt" in series.last_error

        # The original blocker is moved to a different time.
        Lesson.objects.filter(pk=blocker.pk).update(
            scheduled_start=start + timedelta(hours=3),
            scheduled_end=start + timedelta(hours=3, minutes=45),
        )
        second = sync_icloud_user(admin_user)

    series.refresh_from_db()
    assert second["conflicts"] == 0
    assert second["imported"] == 1
    assert series.last_error == ""
    assert Lesson.objects.filter(student=student, scheduled_start=start).count() == 1


@pytest.mark.django_db
def test_old_collision_error_does_not_block_studiosync_move(
    admin_user, studio, student, teacher
):
    """A local move must export even after an earlier stored collision warning."""
    admin_user.preferences = {"technical": {
        "icloud_username": "user@icloud.com",
        "icloud_app_password": "secret",
        "icloud_calendar_url": CALENDAR_URL,
    }}
    admin_user.save(update_fields=["preferences"])
    start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=3)
    remote = _remote(_ical(start, count=2))
    with patch("apps.lessons.icloud_sync._connect", return_value=_connect_mock(remote)):
        first = sync_icloud_user(admin_user)
        assert first["imported"] == 2

        lesson = Lesson.objects.filter(student=student).order_by("scheduled_start").first()
        Lesson.objects.filter(pk=lesson.pk).update(
            scheduled_start=lesson.scheduled_start + timedelta(hours=2),
            scheduled_end=lesson.scheduled_end + timedelta(hours=2),
        )
        ICloudCalendarSeries.objects.update(last_error="Terminkollision: veralteter Hinweis")
        second = sync_icloud_user(admin_user)

    series = ICloudCalendarSeries.objects.get()
    assert series.last_error == ""
    assert second["exported"] == 1
    assert second["conflicts"] == 0
