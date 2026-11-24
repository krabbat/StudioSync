"""Apple CalDAV setup permissions, secret redaction, discovery and write test."""
from unittest.mock import MagicMock, patch

import pytest

from apps.core.security import merge_preferences, redact_preferences
from apps.core.views.icloud_calendar import _allowed_calendar_url, ICloudSetupError


def test_icloud_secret_is_not_returned_by_api_and_blank_secret_is_preserved():
    stored = {
        "technical": {
            "smtp_host": "mail.example.org",
            "icloud_app_password": "secret-pass",
            "icloud_username": "person@icloud.com",
        }
    }
    assert redact_preferences(stored, include_technical=True)["technical"] == {
        "smtp_host": "mail.example.org",
        "icloud_username": "person@icloud.com",
        "icloud_app_password_set": True,
        "smtp_password_set": False,
        "imap_password_set": False,
        "sms_auth_token_set": False,
    }
    updated = merge_preferences(stored, {"technical": {
        "icloud_app_password": "", "icloud_calendar_url": "https://p12-caldav.icloud.com/123/calendars/id/"
    }})
    assert updated["technical"]["icloud_app_password"] == "secret-pass"
    assert updated["technical"]["smtp_host"] == "mail.example.org"


@pytest.mark.parametrize("url", [
    "http://caldav.icloud.com/cal",
    "https://example.org/cal",
    "https://localhost/cal",
    "https://caldav.icloud.com.evil.org/cal",
    "https://user:password@caldav.icloud.com/cal",
])
def test_foreign_or_insecure_urls_are_blocked(url):
    with pytest.raises(ICloudSetupError):
        _allowed_calendar_url(url)


@pytest.mark.django_db
def test_teacher_cannot_access_icloud_settings(teacher_authenticated_client):
    response = teacher_authenticated_client.get("/api/core/calendar/icloud/calendars/")
    assert response.status_code == 403


@pytest.mark.django_db
def test_admin_discovers_calendars_without_exposing_secret(authenticated_client, admin_user, studio):
    admin_user.preferences = {"technical": {
        "icloud_username": "person@icloud.com", "icloud_app_password": "super-secret"
    }}
    admin_user.save(update_fields=["preferences"])
    calendar = MagicMock()
    calendar.url = "https://p12-caldav.icloud.com/123/calendars/abc/"
    calendar.get_display_name.return_value = "MUSart Unterricht"
    client = MagicMock()
    client.principal.return_value.calendars.return_value = [calendar]
    context = MagicMock()
    context.__enter__.return_value = client
    with patch("apps.core.views.icloud_calendar._connect", return_value=context):
        response = authenticated_client.get("/api/core/calendar/icloud/calendars/")
    assert response.status_code == 200
    assert response.data["calendars"] == [{
        "name": "MUSart Unterricht",
        "url": "https://p12-caldav.icloud.com/123/calendars/abc/",
    }]
    assert "super-secret" not in str(response.data)


@pytest.mark.django_db
def test_read_write_test_creates_reads_and_deletes_event(authenticated_client, admin_user, studio):
    url = "https://p12-caldav.icloud.com/123/calendars/abc/"
    admin_user.preferences = {"technical": {
        "icloud_username": "person@icloud.com",
        "icloud_app_password": "secret",
        "icloud_calendar_url": url,
    }}
    admin_user.save(update_fields=["preferences"])

    remote_calendar = MagicMock()
    remote_calendar.url = url
    remote_calendar.get_display_name.return_value = "MUSart Unterricht"
    created = MagicMock()

    def save_event(ics):
        created.data = ics
        return created

    remote_calendar.save_event.side_effect = save_event
    client = MagicMock()
    client.principal.return_value.calendars.return_value = [remote_calendar]
    client.calendar.return_value = remote_calendar
    context = MagicMock()
    context.__enter__.return_value = client

    with patch("apps.core.views.icloud_calendar._connect", return_value=context):
        response = authenticated_client.post("/api/core/calendar/icloud/test/")
    assert response.status_code == 200, response.data
    assert "erfolgreich" in response.data["detail"]
    remote_calendar.save_event.assert_called_once()
    created.load.assert_called_once()
    created.delete.assert_called_once()
