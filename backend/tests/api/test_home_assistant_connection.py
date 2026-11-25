"""Home Assistant integration must remain admin-only and read-only."""
import json
from unittest.mock import MagicMock, patch

import pytest


PATH = "/api/core/home-assistant/connection/"


@pytest.mark.django_db
def test_no_token_means_unconfigured_not_anonymous_access(
    authenticated_client, studio, monkeypatch,
):
    monkeypatch.delenv("HA_ACCESS_TOKEN", raising=False)
    monkeypatch.setenv("HA_BASE_URL", "https://musart.myds.me")
    response = authenticated_client.get(PATH)
    assert response.status_code == 200
    assert response.data["connected"] is False
    assert response.data["configured"] is False
    assert response.data["url"] == "https://musart.myds.me"


@pytest.mark.django_db
def test_teacher_cannot_query_ha_devices(
    teacher_authenticated_client, studio, monkeypatch,
):
    monkeypatch.setenv("HA_ACCESS_TOKEN", "must-remain-private")
    response = teacher_authenticated_client.get(PATH)
    assert response.status_code == 403
    assert "must-remain-private" not in str(response.data)


@pytest.mark.django_db
def test_connection_reads_only_entity_names_and_never_discloses_token_or_gps(
    authenticated_client, studio, monkeypatch,
):
    secret = "secret-is-only-server-side"
    monkeypatch.setenv("HA_ACCESS_TOKEN", secret)
    monkeypatch.setenv("HA_BASE_URL", "https://musart.myds.me")
    monkeypatch.setenv("HA_TRACKER_ENTITY_ID", "device_tracker.iphone")

    entities = [
        {
            "entity_id": "zone.max_mustermann",
            "attributes": {
                "friendly_name": "Max Mustermann", "latitude": 52.0, "longitude": 13.0,
            },
        },
        {
            "entity_id": "device_tracker.iphone",
            "attributes": {
                "friendly_name": "iPhone", "latitude": 52.0, "longitude": 13.0,
            },
        },
    ]
    response_obj = MagicMock()
    response_obj.__enter__.return_value.read.return_value = json.dumps(entities).encode()
    opener = MagicMock()
    opener.open.return_value = response_obj

    with patch("apps.core.views.home_assistant.build_opener", return_value=opener):
        response = authenticated_client.get(PATH)

    assert response.status_code == 200, response.data
    assert response.data["connected"] is True
    assert response.data["zones"] == [
        {"entity_id": "zone.max_mustermann", "name": "Max Mustermann"},
    ]
    assert response.data["trackers"] == [
        {"entity_id": "device_tracker.iphone", "name": "iPhone"},
    ]
    assert response.data["tracker_found"] is True
    assert secret not in str(response.data)
    assert "latitude" not in str(response.data)
    assert "longitude" not in str(response.data)
    assert opener.open.call_count == 1
    req = opener.open.call_args.args[0]
    assert req.get_method() == "GET"
    assert req.full_url == "https://musart.myds.me/api/states"
    assert req.get_header("Authorization") == "Bearer " + secret


@pytest.mark.django_db
def test_http_and_embedded_credentials_are_not_accepted(
    authenticated_client, studio, monkeypatch,
):
    monkeypatch.setenv("HA_ACCESS_TOKEN", "dummy")
    for url in ("http://musart.myds.me", "https://user:password@musart.myds.me"):
        monkeypatch.setenv("HA_BASE_URL", url)
        response = authenticated_client.get(PATH)
        assert response.status_code == 400
        assert "password" not in str(response.data)

@pytest.mark.django_db
def test_saved_configuration_is_used_and_token_is_redacted(
    authenticated_client, studio, monkeypatch,
):
    monkeypatch.delenv("HA_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("HA_BASE_URL", raising=False)
    secret = "new-studiosync-ha-token"
    me = "/api/core/users/me/"
    response = authenticated_client.patch(me, {"preferences": {"technical": {
        "ha_base_url": "https://musart.myds.me:8123",
        "ha_access_token": secret,
        "ha_tracker_entity_id": "device_tracker.peters_iphone",
    }}}, format="json")
    assert response.status_code == 200, response.data
    profile = authenticated_client.get(me)
    assert secret not in str(profile.data)
    assert profile.data["preferences"]["technical"]["ha_access_token_set"] is True

    # An unrelated mail save or blank token must retain the existing HA secret.
    response = authenticated_client.patch(me, {"preferences": {"technical": {
        "smtp_host": "mail.manitu.de", "ha_access_token": "",
    }}}, format="json")
    assert response.status_code == 200, response.data

    entities = [{"entity_id": "device_tracker.peters_iphone",
                 "attributes": {"friendly_name": "iPhone"}}]
    opener = MagicMock()
    opener.open.return_value.__enter__.return_value.read.return_value = json.dumps(entities).encode()
    with patch("apps.core.views.home_assistant.build_opener", return_value=opener):
        response = authenticated_client.get(PATH)
    assert response.status_code == 200, response.data
    assert response.data["tracker_found"] is True
    req = opener.open.call_args.args[0]
    assert req.full_url == "https://musart.myds.me:8123/api/states"
    assert req.get_method() == "GET"
    assert req.get_header("Authorization") == "Bearer " + secret
    assert secret not in str(response.data)


@pytest.mark.django_db
def test_saved_unapproved_destination_is_not_contacted(
    authenticated_client, studio, monkeypatch,
):
    monkeypatch.delenv("HA_BASE_URL", raising=False)
    response = authenticated_client.patch("/api/core/users/me/", {"preferences": {"technical": {
        "ha_base_url": "https://unapproved.example",
        "ha_access_token": "must-not-be-forwarded",
    }}}, format="json")
    assert response.status_code == 200, response.data
    with patch("apps.core.views.home_assistant.build_opener") as opener:
        response = authenticated_client.get(PATH)
    assert response.status_code == 400
    opener.assert_not_called()
    assert "must-not-be-forwarded" not in str(response.data)
