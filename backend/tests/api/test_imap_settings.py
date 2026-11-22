"""Regression tests for the administrator IMAP configuration screen."""

import pytest
from unittest.mock import MagicMock, patch
from django.urls import reverse

from apps.core.security import merge_preferences, redact_preferences
from apps.core.imap_service import ImapSetupError, check_imap_connection


def test_imap_password_never_returned_to_frontend_and_blank_update_keeps_it():
    current = {"technical": {
        "imap_host": "mail.manitu.de", "imap_port": "993",
        "imap_username": "musikunterricht@musart.de",
        "imap_password": "my-secret", "smtp_password": "smtp-secret",
    }}
    cleaned = redact_preferences(current, include_technical=True)["technical"]
    assert "imap_password" not in cleaned
    assert cleaned["imap_password_set"] is True
    assert "smtp_password" not in cleaned
    assert redact_preferences(current, include_technical=False) == {}

    merged = merge_preferences(current, {"technical": {
        "imap_host": "mail.manitu.de", "imap_password": "",
    }})
    assert merged["technical"]["imap_password"] == "my-secret"
    replaced = merge_preferences(current, {"technical": {"imap_password": "new-secret"}})
    assert replaced["technical"]["imap_password"] == "new-secret"


@pytest.mark.django_db
def test_admin_test_imap_uses_saved_password_without_echo(authenticated_client, admin_user):
    admin_user.preferences = {"technical": {
        "imap_host": "mail.manitu.de", "imap_port": "993",
        "imap_username": "musikunterricht@musart.de",
        "imap_security": "ssl", "imap_password": "secret",
    }}
    admin_user.save(update_fields=["preferences"])

    with patch("apps.core.imap_service.check_imap_connection", return_value=True) as check:
        response = authenticated_client.post(
            reverse("user-test-imap-connection"),
            {"imap_host": "mail.manitu.de", "imap_password": ""}, format="json",
        )
    assert response.status_code == 200, response.data
    assert "secret" not in str(response.data)
    assert check.call_args.args[0]["imap_password"] == "secret"


@pytest.mark.django_db
def test_students_and_teachers_cannot_test_imap(
    teacher_authenticated_client, student_authenticated_client,
):
    url = reverse("user-test-imap-connection")
    for client in (teacher_authenticated_client, student_authenticated_client):
        assert client.post(url, {}, format="json").status_code == 403


def test_imap_connection_only_authenticates_over_tls_without_reading():
    client = MagicMock()
    client.noop.return_value = ("OK", [])
    config = {
        "imap_host": "mail.manitu.de", "imap_port": "993",
        "imap_username": "musikunterricht@musart.de",
        "imap_password": "placeholder", "imap_security": "ssl",
    }
    with (
        patch("apps.core.imap_service.assert_public_host"),
        patch("apps.core.imap_service.imaplib.IMAP4_SSL", return_value=client) as imap,
    ):
        assert check_imap_connection(config)
    imap.assert_called_once()
    client.login.assert_called_once_with("musikunterricht@musart.de", "placeholder")
    client.noop.assert_called_once()
    client.logout.assert_called_once()
    client.select.assert_not_called()
    client.fetch.assert_not_called()
    client.store.assert_not_called()


@pytest.mark.parametrize("config", [
    {"imap_host": "mail.manitu.de", "imap_port": "25", "imap_security": "ssl",
     "imap_username": "user", "imap_password": "pw"},
    {"imap_host": "mail.manitu.de", "imap_port": "143", "imap_security": "none",
     "imap_username": "user", "imap_password": "pw"},
])
def test_imap_rejects_unsupported_or_unencrypted_protocol(config):
    with pytest.raises(ImapSetupError):
        check_imap_connection(config)
