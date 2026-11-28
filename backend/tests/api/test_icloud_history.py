from datetime import date, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from icalendar import Calendar, Event

from apps.core.views.icloud_history import historical_dates, historical_matches
from apps.lessons.icloud_sync import LOCAL_TZ
from apps.lessons.models import ICloudCalendarSeries


def fixture_calendar():
    start = datetime(2024, 11, 1, 15, tzinfo=LOCAL_TZ)
    now = start + timedelta(days=30)
    data = Calendar()
    data.add("prodid", "-//StudioSync Test//")
    data.add("version", "2.0")

    def event(title, uid, when, recurrence=None):
        e = Event()
        e.add("summary", title)
        e.add("uid", uid)
        e.add("dtstamp", now)
        e.add("dtstart", when)
        e.add("dtend", when + timedelta(minutes=45))
        if recurrence:
            e.add("recurrence-id", recurrence)
        data.add_component(e)
        return e

    master = event("Test Schüler", "series@example.org", start)
    master.add("rrule", {"freq": "weekly", "count": 8})
    master.add("exdate", start + timedelta(days=7))
    event("Test Schüler", "series@example.org", start + timedelta(days=15), start + timedelta(days=14))
    event("Test Schüler", "series@example.org", start + timedelta(days=21), start + timedelta(days=21)).add("status", "CANCELLED")
    resource = MagicMock()
    resource.data = data.to_ical()
    calendar = MagicMock()
    calendar.events.return_value = [resource, resource]  # identical UID/instance must not count twice
    return calendar, now


def test_history_counts_actual_past_instances_without_writes():
    calendar, now = fixture_calendar()
    assert historical_dates(calendar, "test schüler", now) == [
        {"date": "2024-11-01", "count": 1},
        {"date": "2024-11-16", "count": 1},
        {"date": "2024-11-29", "count": 1},
    ]
    assert historical_dates(calendar, "Test", now) == []
    calendar.events.return_value[0].load.assert_not_called()
    calendar.save_event.assert_not_called()
    calendar.events.return_value[0].delete.assert_not_called()


@pytest.mark.django_db
def test_history_api_is_read_only_and_admin_only(authenticated_client, teacher_authenticated_client, admin_user, studio):
    url = "https://p12-caldav.icloud.com/123/calendars/abc/"
    admin_user.preferences = {"technical": {
        "icloud_username": "test@icloud.com", "icloud_app_password": "secret",
        "icloud_calendar_url": url,
    }}
    admin_user.save(update_fields=["preferences"])
    source = "https://p12-caldav.icloud.com/123/calendars/standard/"
    calendar, now = fixture_calendar()
    client = MagicMock()
    client.calendar.return_value = calendar
    context = MagicMock()
    context.__enter__.return_value = client
    endpoint = "/api/core/calendar/icloud/history/"
    with patch("apps.core.views.icloud_history._connect", return_value=context), patch(
        "apps.core.views.icloud_history._discover", return_value=[
            {"url": url, "name": "MUSart Unterricht"}, {"url": source, "name": "Standard"}
        ]
    ), patch("apps.core.views.icloud_history.timezone.now", return_value=now):
        assert authenticated_client.post(endpoint, {"title": "Test Schüler"}, format="json").status_code == 400
        assert authenticated_client.post(endpoint, {"title": "Test Schüler", "calendar_url": url}, format="json").status_code == 400
        assert authenticated_client.post(endpoint, {"title": "Test Schüler", "calendar_url": source + "unknown/"}, format="json").status_code == 400
        result = authenticated_client.post(endpoint, {"title": "Test Schüler", "calendar_url": source}, format="json")
        filtered = authenticated_client.post(endpoint, {"title": "Test", "calendar_url": source,
            "mode": "partial", "from_date": "2024-11-16"}, format="json")
        invalid = authenticated_client.post(endpoint, {"title": "Test", "calendar_url": source,
            "from_date": "2024-02-30"}, format="json")
    assert result.status_code == 200, result.data
    assert result.data["count"] == 3
    assert result.data["calendar_name"] == "Standard"
    assert result.data["mode"] == "exact"
    match = result.data["matches"][0]
    assert {key: value for key, value in match.items() if key != "occurrences"} == {
        "title": "Test Schüler", "count": 3, "first_date": "2024-11-01", "dates": result.data["dates"]}
    assert len(match["occurrences"]) == 3
    assert result.data["duplicate_count"] == 0
    assert client.calendar.call_count == 2
    assert all(call.kwargs == {"url": source} for call in client.calendar.call_args_list)
    assert filtered.status_code == 200, filtered.data
    assert filtered.data["from_date"] == "2024-11-16"
    assert filtered.data["first_date"] == "2024-11-16"
    assert filtered.data["count"] == 2
    assert filtered.data["matches"][0]["count"] == 2
    assert invalid.status_code == 400
    assert result.data["first_date"] == "2024-11-01"
    assert ICloudCalendarSeries.objects.count() == 0
    assert teacher_authenticated_client.post(endpoint, {"title": "Test Schüler"}, format="json").status_code == 403


@pytest.mark.django_db
def test_notice_archive_restore_does_not_delete_series(authenticated_client, admin_user, studio):
    url = "https://p12-caldav.icloud.com/123/calendars/abc/"
    admin_user.preferences = {"technical": {"icloud_calendar_url": url}}
    admin_user.save(update_fields=["preferences"])
    series = ICloudCalendarSeries.objects.create(user=admin_user, studio=studio, calendar_url=url,
        uid="old@example.org", title="Old", last_error="Schüler zuordnen")
    endpoint = f"/api/core/calendar/icloud/series/{series.pk}/notice/"
    result = authenticated_client.post(endpoint, {"action": "dismiss"}, format="json")
    assert result.status_code == 200, result.data
    assert result.data["series"][0]["dismissed"] is True
    series.refresh_from_db()
    assert series.last_error == "Schüler zuordnen"
    result = authenticated_client.post(endpoint, {"action": "restore"}, format="json")
    assert result.data["series"][0]["dismissed"] is False
    authenticated_client.post(endpoint, {"action": "dismiss"}, format="json")
    series.last_error = "Neuer Konflikt"
    series.save(update_fields=["last_error"])
    result = authenticated_client.get("/api/core/calendar/icloud/series/")
    assert result.data["series"][0]["dismissed"] is False


def test_partial_title_search_groups_actual_titles_and_deduplicates():
    calendar, now = fixture_calendar()
    data = Calendar.from_ical(calendar.events.return_value[0].data)
    # Rename a moved occurrence independently of the series master.
    for event in data.walk("VEVENT"):
        if event.get("RECURRENCE-ID") and not event.get("STATUS"):
            event["SUMMARY"] = "Test Schüler – Klavier"
    calendar.events.return_value[0].data = data.to_ical()
    other = Calendar()
    other.add("prodid", "-//Test//")
    other.add("version", "2.0")
    event = Event()
    event.add("uid", "other@example.org")
    event.add("summary", "Test Andere Person")
    event.add("dtstamp", now)
    event.add("dtstart", now - timedelta(days=3))
    event.add("dtend", now - timedelta(days=3) + timedelta(minutes=45))
    other.add_component(event)
    resource = MagicMock()
    resource.data = other.to_ical()
    calendar.events.return_value += [resource, resource]
    exact = historical_matches(calendar, "TEST SCHÜLER", now)
    assert sum(d["count"] for d in exact["dates"]) == 2
    assert historical_matches(calendar, "Test", now)["matches"] == []
    partial = historical_matches(calendar, "test", now, mode="partial")
    assert [(g["title"], g["count"], g["first_date"]) for g in partial["matches"]] == [
        ("Test Andere Person", 1, "2024-11-28"),
        ("Test Schüler", 2, "2024-11-01"),
        ("Test Schüler – Klavier", 1, "2024-11-16"),
    ]
    assert sum(d["count"] for d in partial["dates"]) == 4
    assert historical_matches(calendar, "unbekannt", now, mode="partial")["matches"] == []


@pytest.mark.parametrize("mode, title", [("exact", "Test Schüler"), ("partial", "Test")])
def test_history_start_date_inclusive_uses_moved_occurrence_date(mode, title):
    calendar, now = fixture_calendar()
    result = historical_matches(calendar, title, now, mode=mode, from_date=date(2024, 11, 16))
    assert result["dates"] == [{"date": "2024-11-16", "count": 1}, {"date": "2024-11-29", "count": 1}]
    assert result["matches"][0]["first_date"] == "2024-11-16"
    assert result["matches"][0]["count"] == 2
    assert historical_matches(calendar, title, now, mode=mode, from_date=date(2024, 12, 1)) == {
        "dates": [], "matches": [], "duplicate_count": 0,
    }


def test_duplicate_slots_with_different_uids_are_counted_once_but_distinct_times_remain():
    calendar, now = fixture_calendar()
    start = datetime(2024, 11, 1, 15, tzinfo=LOCAL_TZ)
    for uid, when in [("copy@example.org", start), ("extra@example.org", start + timedelta(hours=2))]:
        data = Calendar()
        data.add("prodid", "-//Test//")
        data.add("version", "2.0")
        event = Event()
        event.add("uid", uid)
        event.add("summary", "Test Schüler")
        event.add("dtstamp", now)
        event.add("dtstart", when)
        event.add("dtend", when + timedelta(minutes=45))
        data.add_component(event)
        resource = MagicMock()
        resource.data = data.to_ical()
        calendar.events.return_value.append(resource)
    result = historical_matches(calendar, "Test Schüler", now)
    assert result["duplicate_count"] == 1
    assert result["dates"] == [
        {"date": "2024-11-01", "count": 2},
        {"date": "2024-11-16", "count": 1},
        {"date": "2024-11-29", "count": 1},
    ]
    rows = result["matches"][0]["occurrences"]
    assert [row["start"] for row in rows if row["date"] == "2024-11-01"] == [
        "2024-11-01T15:00:00+01:00", "2024-11-01T17:00:00+01:00",
    ]
