"""Regression tests for the administrator IMAP configuration screen."""

import pytest
from email.utils import formataddr
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
def test_auth_profile_includes_saved_mail_settings_for_admin_without_exposing_passwords(
    authenticated_client, admin_user,
):
    """The frontend loads its current user from /auth/me/, not /core/users/me/."""
    admin_user.preferences = {"technical": {
        "smtp_host": "smtp.example.org",
        "smtp_port": "465",
        "smtp_username": "smtp@example.org",
        "smtp_password": "secret-smtp",
        "smtp_from_email": "sender@example.org",
        "smtp_from_name": "Music Studio",
        "smtp_use_tls": False,
        "imap_host": "imap.example.org",
        "imap_port": "993",
        "imap_security": "ssl",
        "imap_username": "imap@example.org",
        "imap_password": "secret-imap",
    }}
    admin_user.save(update_fields=["preferences"])

    response = authenticated_client.get(reverse("user_me"))
    assert response.status_code == 200, response.data
    technical = response.data["preferences"]["technical"]
    assert technical["smtp_host"] == "smtp.example.org"
    assert technical["smtp_port"] == "465"
    assert technical["smtp_username"] == "smtp@example.org"
    assert technical["smtp_from_email"] == "sender@example.org"
    assert technical["smtp_from_name"] == "Music Studio"
    assert technical["smtp_use_tls"] is False
    assert technical["imap_host"] == "imap.example.org"
    assert technical["imap_port"] == "993"
    assert technical["imap_security"] == "ssl"
    assert technical["imap_username"] == "imap@example.org"
    assert technical["smtp_password_set"] is True
    assert technical["imap_password_set"] is True
    assert "smtp_password" not in technical
    assert "imap_password" not in technical
    assert "secret-smtp" not in str(response.data)
    assert "secret-imap" not in str(response.data)


@pytest.mark.django_db
def test_auth_profile_hides_technical_settings_for_other_roles(
    teacher_authenticated_client, student_authenticated_client,
):
    for client in (teacher_authenticated_client, student_authenticated_client):
        response = client.get(reverse("user_me"))
        assert response.status_code == 200, response.data
        assert "technical" not in response.data.get("preferences", {})


@pytest.mark.django_db
def test_updating_imap_only_preserves_existing_smtp_fields_and_secret(
    authenticated_client, admin_user,
):
    admin_user.preferences = {"technical": {
        "smtp_host": "mail.manitu.de",
        "smtp_port": "465",
        "smtp_username": "outgoing@example.org",
        "smtp_password": "existing-smtp-secret",
        "smtp_from_email": "outgoing@example.org",
        "smtp_use_tls": False,
    }}
    admin_user.save(update_fields=["preferences"])

    response = authenticated_client.patch(reverse("user-me-manual"), {
        "preferences": {"technical": {
            "imap_host": "mail.manitu.de",
            "imap_port": "993",
            "imap_username": "incoming@example.org",
            "imap_password": "new-imap-secret",
            "imap_security": "ssl",
        }}
    }, format="json")
    assert response.status_code == 200, response.data
    admin_user.refresh_from_db()
    tech = admin_user.preferences["technical"]
    assert tech["smtp_host"] == "mail.manitu.de"
    assert tech["smtp_port"] == "465"
    assert tech["smtp_username"] == "outgoing@example.org"
    assert tech["smtp_from_email"] == "outgoing@example.org"
    assert tech["smtp_password"] == "existing-smtp-secret"
    assert tech["imap_password"] == "new-imap-secret"


@pytest.mark.django_db
def test_updating_smtp_only_preserves_existing_imap_fields_and_secret(
    authenticated_client, admin_user,
):
    admin_user.preferences = {"technical": {
        "imap_host": "mail.manitu.de",
        "imap_port": "993",
        "imap_username": "incoming@example.org",
        "imap_password": "existing-imap-secret",
        "imap_security": "ssl",
    }}
    admin_user.save(update_fields=["preferences"])

    response = authenticated_client.patch(reverse("user-me-manual"), {
        "preferences": {"technical": {
            "smtp_host": "mail.manitu.de",
            "smtp_port": "465",
            "smtp_username": "outgoing@example.org",
            "smtp_from_email": "outgoing@example.org",
            "smtp_use_tls": False,
        }}
    }, format="json")
    assert response.status_code == 200, response.data
    admin_user.refresh_from_db()
    tech = admin_user.preferences["technical"]
    assert tech["imap_host"] == "mail.manitu.de"
    assert tech["imap_port"] == "993"
    assert tech["imap_username"] == "incoming@example.org"
    assert tech["imap_password"] == "existing-imap-secret"
    assert tech["smtp_host"] == "mail.manitu.de"


@pytest.mark.django_db
def test_smtp_connection_test_uses_saved_secret_without_browser_echo(
    authenticated_client, admin_user, studio,
):
    studio.name = "MUSart Musikunterricht"
    studio.save(update_fields=["name"])
    admin_user.preferences = {"technical": {
        "smtp_host": "mail.manitu.de",
        "smtp_port": "465",
        "smtp_username": "outgoing@example.org",
        "smtp_password": "existing-smtp-secret",
        "smtp_from_email": "outgoing@example.org",
        "smtp_from_name": "MUSart Peter Müller",
        "smtp_use_tls": False,
    }}
    admin_user.save(update_fields=["preferences"])

    with (
        patch("apps.core.views.core.assert_public_host"),
        patch("django.core.mail.get_connection") as get_connection,
        patch("django.core.mail.EmailMultiAlternatives") as mail,
    ):
        response = authenticated_client.post(reverse("user-send-test-email"), {
            "smtp_host": "mail.manitu.de",
            "smtp_port": "465",
            "smtp_username": "outgoing@example.org",
            "smtp_password": "",
            "smtp_from_email": "outgoing@example.org",
            "smtp_use_tls": False,
        }, format="json")

    assert response.status_code == 200, response.data
    assert get_connection.call_args.kwargs["password"] == "existing-smtp-secret"
    assert get_connection.call_args.kwargs["use_ssl"] is True
    assert get_connection.call_args.kwargs["use_tls"] is False
    assert mail.call_args.kwargs["from_email"] == formataddr(
        ("MUSart Musikunterricht", "outgoing@example.org")
    )
    mail.return_value.send.assert_called_once()
    assert "existing-smtp-secret" not in str(response.data)


@pytest.mark.django_db
def test_background_mail_uses_current_studio_name_not_stored_smtp_alias(
    admin_user, studio,
):
    """The central mail worker must read the studio name even after it changes."""
    from apps.core.email_utils import get_email_settings
    admin_user.preferences = {"technical": {
        "smtp_from_email": "outgoing@example.org",
        "smtp_from_name": "Veralteter SMTP-Absendername",
    }}
    admin_user.save(update_fields=["preferences"])
    studio.name = "MUSart - Musikunterricht"
    studio.save(update_fields=["name"])

    settings = get_email_settings()
    assert settings["from_name"] == "MUSart - Musikunterricht"
    assert settings["from_email"] == "outgoing@example.org"


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


@pytest.mark.django_db
def test_imap_settings_save_via_user_profile_without_password_disclosure(
    authenticated_client, admin_user,
):
    url = reverse("user-me-manual")
    first = authenticated_client.patch(url, {
        "preferences": {"technical": {
            "imap_host": "mail.manitu.de",
            "imap_port": "993",
            "imap_security": "ssl",
            "imap_username": "musikunterricht@musart.de",
            "imap_password": "temporary-test-password",
        }}
    }, format="json")
    assert first.status_code == 200, first.data
    assert first.data["preferences"]["technical"]["imap_password_set"] is True
    assert "imap_password" not in first.data["preferences"]["technical"]
    assert "temporary-test-password" not in str(first.data)

    second = authenticated_client.patch(url, {
        "preferences": {"technical": {"imap_password": "", "imap_port": "993"}}
    }, format="json")
    assert second.status_code == 200, second.data
    admin_user.refresh_from_db()
    assert admin_user.preferences["technical"]["imap_password"] == "temporary-test-password"


def test_imap_starttls_upgrade_precedes_password_login():
    config = {
        "imap_host": "mail.manitu.de",
        "imap_port": "143",
        "imap_security": "starttls",
        "imap_username": "test@example.org",
        "imap_password": "secret",
    }
    client = MagicMock()
    client.noop.return_value = ("OK", [])
    with (
        patch("apps.core.imap_service.assert_public_host"),
        patch("apps.core.imap_service.imaplib.IMAP4", return_value=client),
    ):
        assert check_imap_connection(config)
    assert client.method_calls[0][0] == "starttls"
    assert client.method_calls[1][0] == "login"
    client.logout.assert_called_once()
