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


@pytest.mark.django_db
def test_local_cancellation_reason_does_not_recolour_another_icloud_lesson(
    admin_user, studio, student, teacher,
):
    """Cancelling one linked occurrence must not modify a sibling's status."""
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

        edited, untouched = list(
            Lesson.objects.filter(studio=studio).order_by("scheduled_start")
        )
        reason = "Schüler musste den Unterricht wegen Krankheit absagen."
        Lesson.objects.filter(pk=edited.pk).update(
            status="cancelled", cancellation_reason=reason,
        )
        second = sync_icloud_user(admin_user)
        assert second["exported"] == 1
        assert second["conflicts"] == 0

        # A later automatic sync must preserve both the reason and the
        # neighbouring lesson's original status/colour.
        third = sync_icloud_user(admin_user)
        assert third["conflicts"] == 0
        edited.refresh_from_db()
        untouched.refresh_from_db()

    assert edited.status == "cancelled"
    assert edited.cancellation_reason == reason
    assert untouched.status == "scheduled"
    assert untouched.cancellation_reason == ""


def _apple_group_event(start, title, description, *, count=1, location=""):
    cal = Calendar()
    cal.add("prodid", "-//MUSart calendar notes tests//DE")
    cal.add("version", "2.0")
    event = Event()
    event.add("uid", "apple-native-group@example.org")
    event.add("dtstamp", start)
    event.add("dtstart", start)
    event.add("dtend", start + timedelta(minutes=45))
    event.add("summary", title)
    event.add("description", description)
    if location:
        event.add("location", location)
    if count > 1:
        event.add("rrule", {"freq": "weekly", "count": count})
    cal.add_component(event)
    return cal.to_ical().decode("utf-8")


def _apple_group_fixture(studio, student, *, family=True):
    from apps.core.models import Family, TeachingGroup, Student, User
    student.user.first_name = "Anna Maria"
    student.user.save(update_fields=["first_name"])
    student.instrument = "Gitarre"
    student.save(update_fields=["instrument"])
    user = User.objects.create_user(email="apple-group-member@example.org", password="Test123456!",
                                    role="student", first_name="Max", last_name="Beispiel")
    second = Student.objects.create(studio=studio, user=user, instrument="Gitarre")
    if family:
        source = Family.objects.create(studio=studio, name="Familie Beispiel", ha_zone_entity_id="Familie Beispiel")
        Student.objects.filter(pk__in=[student.pk, second.pk]).update(family=source)
    else:
        source = TeachingGroup.objects.create(studio=studio, name="Gitarrengruppe")
        source.members.set([student, second])
    return source, second


@pytest.mark.django_db
@pytest.mark.parametrize("family,count", [(True, 1), (True, 3), (False, 1)])
def test_apple_native_group_import(admin_user, studio, student, teacher, family, count):
    from apps.lessons.icloud_sync import _import_series, _ical_for_lesson
    source, second = _apple_group_fixture(studio, student, family=family)
    start = timezone.now() + timedelta(days=3)
    remote = _remote(_apple_group_event(start, str(source), "Gitarre\nAnna Maria, Max\nNeue Stücke",
                                      count=count, location="Musikraum"))
    stats = {"imported":0,"exported":0,"cancelled":0,"unassigned":0,"conflicts":0}
    series = _import_series(admin_user, studio, CALENDAR_URL, remote, stats)
    assert not series.last_error, series.last_error
    assert stats["imported"] == count
    assert Lesson.objects.count() == count
    for lesson in Lesson.objects.all():
        assert lesson.lesson_type == "group"
        assert lesson.student_id is None
        assert lesson.summary == "Neue Stücke"
        assert lesson.group_ha_zone == ("" if family else "Musikraum")
        assert set(lesson.participants.values_list("student_id", flat=True)) == {student.pk, second.pk}
        assert set(lesson.participants.values_list("first_name_snapshot", flat=True)) == {"Anna Maria", "Max"}
        assert set(lesson.participants.values_list("instrument_snapshot", flat=True)) == {"Gitarre"}
        event = Calendar.from_ical(_ical_for_lesson(lesson)).walk("VEVENT")[0]
        lines = str(event["DESCRIPTION"]).splitlines()
        assert lines[0] == "Gitarre"
        assert set(lines[1].split(", ")) == {"Anna Maria", "Max"}
        assert lines[2] == "Neue Stücke"
    _import_series(admin_user, studio, CALENDAR_URL, remote, stats)
    assert stats["imported"] == count
    assert Lesson.objects.count() == count


@pytest.mark.django_db
@pytest.mark.parametrize("notes", ["Gitarre", "Gitarre\nAnna Maria, Unbekannt", "Klavier\nAnna Maria, Max"])
def test_invalid_apple_group_notes_do_not_create_appointments(admin_user, studio, student, teacher, notes):
    from apps.lessons.icloud_sync import _import_series
    source, _ = _apple_group_fixture(studio, student)
    remote = _remote(_apple_group_event(timezone.now()+timedelta(days=3), str(source), notes))
    stats = {"imported":0,"exported":0,"cancelled":0,"unassigned":0,"conflicts":0}
    series = _import_series(admin_user, studio, CALENDAR_URL, remote, stats)
    assert series.last_error
    assert stats["unassigned"] == 1
    assert not Lesson.objects.exists()


@pytest.mark.django_db
def test_apple_group_note_edits_preserve_occurrence_identity(admin_user, studio, student, teacher):
    from apps.lessons.icloud_sync import _import_series
    from apps.core.models import Student, User
    source, second = _apple_group_fixture(studio, student)
    third_user = User.objects.create_user(email="third-apple-member@example.org",password="Test123456!",role="student",first_name="Tom",last_name="Beispiel")
    third = Student.objects.create(studio=studio,user=third_user,family=source,instrument="Gitarre")
    start = timezone.now() + timedelta(days=3)
    remote = _remote(_apple_group_event(start, str(source), "Gitarre\nAnna Maria, Max"))
    stats = {"imported":0,"exported":0,"cancelled":0,"unassigned":0,"conflicts":0}
    _import_series(admin_user, studio, CALENDAR_URL, remote, stats)
    lesson = Lesson.objects.get()
    old_id = lesson.pk
    remote.data = _apple_group_event(start, str(source), "Gitarre\nAnna Maria, Tom\nGeändert")
    series = _import_series(admin_user, studio, CALENDAR_URL, remote, stats)
    assert not series.last_error, series.last_error
    lesson.refresh_from_db()
    assert lesson.pk == old_id and Lesson.objects.count() == 1
    assert set(lesson.participants.values_list("student_id",flat=True)) == {student.pk,third.pk}
    assert lesson.summary == "Geändert"
    lesson.status = "completed"
    lesson.save(update_fields=["status"])
    # Finish the prior local change through a fresh sync before another Apple edit.
    _import_series(admin_user, studio, CALENDAR_URL, remote, stats)
    from apps.lessons.icloud_sync import _push_changes
    _push_changes(series,remote,stats)
    remote.data = _apple_group_event(start, str(source), "Gitarre\nAnna Maria, Max")
    _import_series(admin_user, studio, CALENDAR_URL, remote, stats)
    lesson.refresh_from_db()
    assert lesson.status == "completed"
    assert set(lesson.participants.values_list("student_id",flat=True)) == {student.pk,third.pk}


@pytest.mark.django_db
def test_apple_group_recurrence_override_has_own_participants(admin_user, studio, student, teacher):
    from apps.lessons.icloud_sync import _import_series, _push_changes
    from apps.core.models import Student, User
    source, second = _apple_group_fixture(studio, student)
    third_user = User.objects.create_user(email="third-override@example.org",password="Test123456!",role="student",first_name="Tom",last_name="Beispiel")
    third = Student.objects.create(studio=studio,user=third_user,family=source,instrument="Gitarre")
    start = timezone.now().replace(microsecond=0) + timedelta(days=3)
    cal = Calendar.from_ical(_apple_group_event(start, str(source), "Gitarre\nAnna Maria, Max", count=2))
    master = cal.walk("VEVENT")[0]
    override = Event()
    override.add("uid", str(master["UID"]))
    override.add("dtstamp", start)
    override.add("recurrence-id", start + timedelta(days=7))
    override.add("dtstart", start + timedelta(days=7))
    override.add("dtend", start + timedelta(days=7,minutes=45))
    override.add("summary", str(source))
    override.add("description", "Gitarre\nAnna Maria, Tom\nVertretung")
    cal.add_component(override)
    remote = _remote(cal.to_ical().decode("utf-8"))
    stats = {"imported":0,"exported":0,"cancelled":0,"unassigned":0,"conflicts":0}
    series = _import_series(admin_user, studio, CALENDAR_URL, remote, stats)
    assert not series.last_error, series.last_error
    one, two = Lesson.objects.order_by("scheduled_start")
    assert set(one.participants.values_list("student_id",flat=True)) == {student.pk, second.pk}
    assert set(two.participants.values_list("student_id",flat=True)) == {student.pk, third.pk}
    assert two.summary == "Vertretung"
    two.summary = "Neuer Kommentar"
    two.save(update_fields=["summary"])
    series = _import_series(admin_user, studio, CALENDAR_URL, remote, stats)
    _push_changes(series, remote, stats)
    changed = [e for e in Calendar.from_ical(remote.data).walk("VEVENT") if e.get("RECURRENCE-ID")][0]
    assert str(changed["DESCRIPTION"]) == "Gitarre\nAnna Maria, Tom\nNeuer Kommentar"
