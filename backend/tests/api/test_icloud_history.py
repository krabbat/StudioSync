from datetime import datetime, timedelta
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
    assert result.status_code == 200, result.data
    assert result.data["count"] == 3
    assert result.data["calendar_name"] == "Standard"
    assert result.data["mode"] == "exact"
    assert result.data["matches"] == [{"title": "Test Schüler", "count": 3,
        "first_date": "2024-11-01", "dates": result.data["dates"]}]
    client.calendar.assert_called_once_with(url=source)
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
