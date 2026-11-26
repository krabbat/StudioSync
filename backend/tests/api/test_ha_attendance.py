from datetime import datetime, timedelta, timezone as utc
from unittest.mock import patch
from types import SimpleNamespace

import pytest
from django.utils import timezone

from apps.core.models import TeachingContract
from apps.lessons.ha_attendance import (
    allocate, intervals, live_studio, norm, run_nightly, seconds, window,
    attendance_decision, required_seconds, zone_for,
)
from apps.lessons.models import Lesson
from apps.students.lesson_account import lesson_account_response


TRACKER = "device_tracker.peters_iphone"
MIN = timedelta(minutes=1)


def make_lesson(studio, teacher, student, start):
    lesson = Lesson(studio=studio, teacher=teacher, student=student,
                    scheduled_start=start, scheduled_end=start + 30 * MIN)
    Lesson.objects.bulk_create([lesson])
    return lesson


def mock_ha(ha, lesson, changes):
    name = lesson.student.user.get_full_name()
    zone = ("zone.test_pupil", name)
    ha.tracker = TRACKER
    ha.states.return_value = ({norm(name): [zone]}, norm(name))
    def history(start, end):
        return [(max(a, start), min(b, end), state) for a,b,state in changes
                if max(a,start) < min(b,end)]
    ha.history.side_effect = history
    return zone


def test_history_includes_initial_state_and_exact_seconds():
    start = datetime(2026, 11, 26, 15, tzinfo=utc.utc)
    end = start + 30 * MIN
    raw = [[{"entity_id": TRACKER, "state": "Max", "last_changed": (start-MIN).isoformat()},
            {"state": "not_home", "last_changed": (start+20*MIN).isoformat()}]]
    rows = intervals(raw, start, end, TRACKER)
    assert rows[0] == (start, start+20*MIN, "max")
    assert seconds([(a,b) for a,b,s in rows if s == "max"]) == 1200
    with pytest.raises(ValueError):
        intervals([], start, end, TRACKER)


@pytest.mark.django_db
def test_late_arrival_live_completion_and_stop_on_departure(studio, teacher, student):
    start = timezone.now()
    lesson = make_lesson(studio, teacher, student, start)
    activation = start - 60*MIN
    name = norm(student.user.get_full_name())
    changes = [(start-30*MIN,start+10*MIN,"not_home"),
               (start+10*MIN,start+70*MIN,name),
               (start+70*MIN,start+100*MIN,"not_home")]
    with patch("apps.lessons.ha_attendance.HA") as client:
        ha = client.return_value
        zone = mock_ha(ha, lesson, changes)
        live_studio(studio, activation, start+16*MIN)
        lesson.refresh_from_db()
        assert lesson.status == "in_progress"
        live_studio(studio, activation, start+30*MIN)
        lesson.refresh_from_db()
        assert lesson.status == "completed"
        live_studio(studio, activation, start+35*MIN)
        lesson.refresh_from_db()
        assert lesson.status == "completed"
        assert lesson.ha_attendance["attendance_seconds"] == 1200
        assert lesson.ha_watch_active
        live_studio(studio, activation, start+66*MIN)
        lesson.refresh_from_db()
        assert lesson.ha_watch_active
        ha.states.return_value = ({name:[zone]}, "not_home")
        live_studio(studio, activation, start+71*MIN)
        lesson.refresh_from_db()
        assert not lesson.ha_watch_active
        ha.states.reset_mock()
        live_studio(studio, activation, start+73*MIN)
        ha.states.assert_not_called()


@pytest.mark.django_db
def test_short_visit_no_show_counted_once_and_manual_correction(studio, teacher, student, authenticated_client):
    start = timezone.now() - 75*MIN
    lesson = make_lesson(studio, teacher, student, start)
    activation = start-60*MIN
    name = norm(student.user.get_full_name())
    changes = [(start-30*MIN,start,name),
               (start,start+timedelta(seconds=1199),name),
               (start+timedelta(seconds=1199),start+90*MIN,"not_home")]
    # Only 19:59 within the scheduled lesson.
    changes[0] = (start-30*MIN,start,"not_home")
    day = timezone.localdate()
    TeachingContract.objects.create(student=student, contract_start_date=day-timedelta(days=2),
        contract_year_start=day-timedelta(days=2), lesson_minutes=30, monthly_amount=100)
    with patch("apps.lessons.ha_attendance.HA") as client:
        ha = client.return_value
        zone = mock_ha(ha, lesson, changes)
        ha.states.return_value = ({name:[zone]}, "not_home")
        live_studio(studio, activation, start+61*MIN)
        lesson.refresh_from_db()
        assert lesson.status == "no_show"
        assert lesson.ha_attendance["attendance_seconds"] == 1199
        assert lesson_account_response(student)["summary"]["credited"] == 1
        live_studio(studio, activation, start+63*MIN)
        assert lesson_account_response(student)["summary"]["credited"] == 1
        response = authenticated_client.patch(f"/api/lessons/{lesson.pk}/",
            {"status":"completed"}, format="json")
        assert response.status_code == 200, response.data
        lesson.refresh_from_db()
        assert lesson.ha_manual_override
        live_studio(studio, activation, start+65*MIN)
        lesson.refresh_from_db()
        assert lesson.status == "completed"
        assert lesson_account_response(student)["summary"]["credited"] == 1


@pytest.mark.django_db
def test_no_history_does_not_charge_and_no_ha_on_free_day(studio, teacher, student):
    start = timezone.now()
    activation = start-60*MIN
    with patch("apps.lessons.ha_attendance.HA") as client:
        live_studio(studio, activation, start)
        client.assert_not_called()
        lesson = make_lesson(studio, teacher, student, start)
        ha = client.return_value
        zone = mock_ha(ha, lesson, [])
        ha.states.return_value = ({norm(student.user.get_full_name()):[zone]}, "not_home")
        ha.history.side_effect = ValueError("unavailable")
        live_studio(studio, activation, start+61*MIN)
        lesson.refresh_from_db()
        assert lesson.status == "scheduled"
        assert lesson.ha_finalized_at is None


@pytest.mark.django_db
def test_nightly_counts_full_visit_without_changing_status(studio, teacher, student):
    from zoneinfo import ZoneInfo
    local = ZoneInfo("Europe/Berlin")
    start = datetime(2026,11,26,16,tzinfo=local)
    now = datetime(2026,11,27,3,tzinfo=local)
    lesson = make_lesson(studio, teacher, student, start)
    activation = start-timedelta(days=1)
    name = norm(student.user.get_full_name())
    changes = [(datetime(2026,11,26,0,tzinfo=local),start-5*MIN,"not_home"),
               (start-5*MIN,start+85*MIN,name),
               (start+85*MIN,now,"not_home")]
    with patch("apps.lessons.ha_attendance.HA") as client, patch(
            "apps.lessons.ha_attendance.timezone.now",return_value=now):
        mock_ha(client.return_value, lesson, changes)
        run_nightly(activation.isoformat())
    lesson.refresh_from_db()
    assert lesson.status == "scheduled"
    assert lesson.ha_attendance["total_seconds"] == 5400
    assert lesson.ha_attendance["statistics_day"] == "2026-11-26"


def virtual_lesson(pk, start, minutes, name, family=None):
    return SimpleNamespace(pk=pk, student_id=pk, student=SimpleNamespace(
        user=SimpleNamespace(get_full_name=lambda: name), family=family),
        scheduled_start=start, scheduled_end=start+minutes*MIN)


@pytest.mark.parametrize("minutes,minimum", [(30,20),(45,30),(60,40)])
def test_two_thirds_exact_boundary(minutes, minimum):
    start = datetime(2026,11,27,16,tzinfo=utc.utc)
    lesson = virtual_lesson(1,start,minutes,"Test")
    assert required_seconds(lesson) == minimum*60
    assert attendance_decision(lesson,lesson.scheduled_end,True,minimum*60,False) == "completed"
    assert attendance_decision(lesson,lesson.scheduled_end,True,minimum*60-1,False) == "no_show"
    assert attendance_decision(lesson,lesson.scheduled_end,False,0,False) is None


def test_family_continuous_visit_and_scheduled_boundaries():
    start = datetime(2026,11,27,16,tzinfo=utc.utc)
    family = SimpleNamespace(ha_zone_entity_id="Familie Böhm")
    first = virtual_lesson(1,start,45,"Test A",family)
    second = virtual_lesson(2,start+45*MIN,30,"Test B",family)
    zone = ("zone.familie_bohm","Familie Böhm")
    zones = {norm(zone[1]):[zone]}
    assert zone_for(first,zones) == zone_for(second,zones) == zone
    rows = [(start-5*MIN,start+85*MIN,norm(zone[1]))]
    assigned = allocate(rows,[first,second],zones)
    assert seconds(assigned[1]) == 2700
    assert seconds(assigned[2]) == 1800
    assert sum(seconds(p) for p in allocate(rows,[first,second],zones,full=True).values()) == 5400
    rows = [(start+16*MIN,start+65*MIN,norm(zone[1]))]
    assigned = allocate(rows,[first,second],zones)
    assert seconds(assigned[1]) == 1740
    assert seconds(assigned[2]) == 1200
    assert attendance_decision(first,first.scheduled_end,True,1740,True) == "no_show"
    assert attendance_decision(second,second.scheduled_end,True,1200,False) == "completed"


def test_family_zone_missing_or_ambiguous_never_falls_back():
    start = datetime(2026,11,27,16,tzinfo=utc.utc)
    family = SimpleNamespace(ha_zone_entity_id="")
    lesson = virtual_lesson(1,start,30,"Test",family)
    zones = {"test":[("zone.test","Test")]}
    assert zone_for(lesson,zones) is None
    family.ha_zone_entity_id = "Test"
    zones["test"].append(("zone.test2","Test"))
    assert zone_for(lesson,zones) is None
    lesson.student.family = None
    zones["test"].pop()
    assert zone_for(lesson,zones) == ("zone.test","Test")


def test_no_credit_before_or_after_scheduled_time():
    start = datetime(2026,11,27,16,tzinfo=utc.utc)
    lesson = virtual_lesson(1,start,45,"Test")
    zones = {"test":[("zone.test","Test")]}
    rows = [(start-30*MIN,start+10*MIN,"test"),
            (start+45*MIN,start+75*MIN,"test")]
    assert seconds(allocate(rows,[lesson],zones)[1]) == 600
