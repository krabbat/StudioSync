"""Read-only IMAP inbox and administrator access regression tests."""

from unittest.mock import MagicMock, patch

import pytest
from django.urls import reverse

from apps.core.mail_service import MailFetchError, get_inbox_message, list_inbox

CONFIG = {
    "imap_host": "mail.manitu.de",
    "imap_port": "993",
    "imap_username": "musikunterricht@musart.de",
    "imap_password": "only-on-server-secret",
    "imap_security": "ssl",
}


def headers(sender="Familie Beispiel <kontakt@example.org>", subject="Termin"):
    return (
        f"From: {sender}\r\n"
        f"Subject: {subject}\r\n"
        "Date: Mon, 23 Nov 2026 09:42:00 +0100\r\n"
        "Content-Type: text/plain; charset=utf-8\r\n"
        "\r\n"
    ).encode("utf-8")


def fake_client():
    connection = MagicMock()
    connection.select.return_value = ("OK", [b"3"])
    connection.response.return_value = ("UIDVALIDITY", [b"99"])
    return connection


def test_inbox_lists_newest_uids_with_headers_only_and_keeps_mail_unread():
    connection = fake_client()

    def uid_call(command, *args):
        if command == "SEARCH":
            return "OK", [b"17 5 42"]
        assert command == "FETCH"
        assert args == ("42,17", "(UID FLAGS RFC822.SIZE BODY.PEEK[HEADER])")
        return "OK", [
            (
                b"3 (UID 17 FLAGS () RFC822.SIZE 123 BODY[HEADER] {80}",
                headers(subject="Alt"),
            ),
            b")",
            (
                b"2 (UID 42 FLAGS (\\Seen \\Flagged) RFC822.SIZE 400 BODY[HEADER] {80}",
                headers(subject="Neu"),
            ),
            b")",
        ]

    connection.uid.side_effect = uid_call
    with (
        patch("apps.core.mail_service.assert_public_host"),
        patch("apps.core.mail_service.imaplib.IMAP4_SSL", return_value=connection),
    ):
        page = list_inbox(CONFIG, limit=2)

    assert [m["id"] for m in page["messages"]] == ["42", "17"]
    assert page["messages"][0]["unread"] is False
    assert page["messages"][0]["starred"] is True
    assert page["messages"][1]["unread"] is True
    assert page["total"] == 3
    assert page["has_more"] is True
    assert page["uidvalidity"] == "99"
    connection.select.assert_called_once_with("INBOX", readonly=True)
    connection.store.assert_not_called()
    connection.logout.assert_called_once()
    assert "only-on-server-secret" not in str(page)


def test_one_message_fetches_body_without_setting_seen_flag():
    connection = fake_client()
    raw = (
        headers()
        + b"Ein paar Noten fuer morgen.\r\n"
    )
    connection.uid.side_effect = [
        ("OK", [(b"1 (UID 17 FLAGS () RFC822.SIZE 220 BODY[HEADER] {80}", headers())]),
        ("OK", [(b"1 (UID 17 BODY[] {140}", raw)]),
    ]
    with (
        patch("apps.core.mail_service.assert_public_host"),
        patch("apps.core.mail_service.imaplib.IMAP4_SSL", return_value=connection),
    ):
        message = get_inbox_message(CONFIG, "17", expected_uidvalidity="99")

    assert message["id"] == "17"
    assert "Noten" in message["body"]
    assert message["unread"] is True
    assert connection.uid.call_count == 2
    assert "BODY.PEEK[]" in str(connection.uid.call_args_list)
    connection.store.assert_not_called()


def test_wrong_uidvalidity_aborts_without_downloading():
    connection = fake_client()
    with (
        patch("apps.core.mail_service.assert_public_host"),
        patch("apps.core.mail_service.imaplib.IMAP4_SSL", return_value=connection),
    ):
        with pytest.raises(MailFetchError, match="erneut"):
            get_inbox_message(CONFIG, "17", expected_uidvalidity="100")
    connection.uid.assert_not_called()


def test_oversized_mail_is_not_downloaded():
    connection = fake_client()
    connection.uid.return_value = (
        "OK",
        [(b"1 (UID 17 FLAGS () RFC822.SIZE 999999999 BODY[HEADER] {80}", headers())],
    )
    with (
        patch("apps.core.mail_service.assert_public_host"),
        patch("apps.core.mail_service.imaplib.IMAP4_SSL", return_value=connection),
    ):
        with pytest.raises(MailFetchError, match="zu groß"):
            get_inbox_message(CONFIG, "17")
    assert connection.uid.call_count == 1


@pytest.mark.django_db
def test_mail_api_reuses_admin_saved_credentials_without_echo(
    authenticated_client, admin_user, studio
):
    admin_user.preferences = {"technical": dict(CONFIG)}
    admin_user.save(update_fields=["preferences"])

    with patch("apps.core.views.mail.list_inbox") as backend:
        backend.return_value = {
            "messages": [], "total": 0, "has_more": False,
            "offset": 0, "limit": 40, "uidvalidity": "99",
        }
        response = authenticated_client.get(reverse("mail-inbox-list"))

    assert response.status_code == 200, response.data
    assert backend.call_args.args[0]["imap_password"] == "only-on-server-secret"
    assert "only-on-server-secret" not in str(response.data)


@pytest.mark.django_db
def test_mail_api_rejects_teacher_student_and_anonymous(
    teacher_authenticated_client, student_authenticated_client, api_client, studio
):
    for client in (teacher_authenticated_client, student_authenticated_client):
        assert client.get(reverse("mail-inbox-list")).status_code == 403
        response = client.get(reverse("mail-inbox-detail", kwargs={"uid": "12"}))
        assert response.status_code == 403
    assert api_client.get(reverse("mail-inbox-list")).status_code in (401, 403)


@pytest.mark.django_db
def test_mail_api_returns_safe_error_and_validates_page(authenticated_client, studio):
    response = authenticated_client.get(reverse("mail-inbox-list") + "?limit=10000")
    assert response.status_code == 400
    with patch(
        "apps.core.views.mail.list_inbox", side_effect=MailFetchError("IMAP-Fehler")
    ):
        response = authenticated_client.get(reverse("mail-inbox-list"))
    assert response.status_code == 502
    assert response.data["detail"] == "IMAP-Fehler"
