"""Persistent IMAP cache must remain owner-scoped, incremental and nonblocking."""

from contextlib import nullcontext
from unittest.mock import MagicMock, patch

import pytest
from django.urls import reverse

from apps.core.mail_cache import (
    _parse_flags,
    _sync_folder_from_imap,
    cached_folder_page,
    cached_message_detail,
    folder_for_owner,
    mailbox_account_key,
    update_cache_after_mail_action,
)
from apps.core.models import MailMessageCache

CONFIG = {
    "imap_host": "mail.example.org",
    "imap_port": "993",
    "imap_username": "musikunterricht@musart.de",
    "imap_password": "private-password-do-not-store",
    "imap_security": "ssl",
}


@pytest.mark.django_db
def test_first_page_reads_database_and_only_queues_credential_free_sync(studio, admin_user):
    with (
        patch("apps.core.mail_cache.async_task") as queued,
        patch("apps.core.mail_cache._readonly_folder") as imap,
    ):
        result = cached_folder_page(studio, admin_user, CONFIG, "inbox")
    assert result["messages"] == []
    assert result["syncing"] is True
    assert result["synced"] is False
    assert result["has_more"] is False
    queued.assert_called_once()
    assert queued.call_args.args[0] == "apps.core.mail_cache.sync_folder_task"
    assert isinstance(queued.call_args.args[1], int)
    assert "private-password" not in str(queued.call_args)
    imap.assert_not_called()


@pytest.mark.django_db
def test_cache_fingerprint_does_not_contain_password_and_changes_per_account():
    assert mailbox_account_key(CONFIG) == mailbox_account_key({
        **CONFIG, "imap_password": "rotated-secret",
    })
    assert mailbox_account_key(CONFIG) != mailbox_account_key({
        **CONFIG, "imap_username": "someone-else@example.org",
    })


@pytest.mark.django_db
def test_opened_body_reads_database_without_imap(studio, admin_user):
    folder = folder_for_owner(studio, admin_user, CONFIG, "inbox")
    folder.uidvalidity = "77"
    folder.save(update_fields=["uidvalidity"])
    MailMessageCache.objects.create(
        folder_cache=folder, uid=12, sender_name="Familie",
        email="family@example.org", subject="Termin", date="",
        body="Nachricht aus der Datenbank", body_loaded=True,
        preview="Nachricht aus der Datenbank",
    )
    with patch("apps.core.mail_cache.get_folder_message") as imap:
        result = cached_message_detail(
            studio, admin_user, CONFIG, "inbox", "12", expected_uidvalidity="77",
        )
    assert result["body"] == "Nachricht aus der Datenbank"
    assert result["email"] == "family@example.org"
    imap.assert_not_called()


def test_imap_flags_parsing_accepts_either_server_field_order():
    values = _parse_flags([
        b"1 (UID 11 FLAGS (\\Seen \\Flagged))",
        b"2 (FLAGS (\\Answered) UID 12)",
    ])
    assert values[11] == (False, True, False)
    assert values[12] == (True, False, True)


@pytest.mark.django_db
def test_incremental_sync_downloads_only_new_headers_and_keeps_saved_body(
    studio, admin_user
):
    folder = folder_for_owner(studio, admin_user, CONFIG, "inbox")
    folder.uidvalidity = "99"
    folder.save(update_fields=["uidvalidity"])
    MailMessageCache.objects.create(
        folder_cache=folder, uid=10, sender_name="Alte Familie",
        email="old@example.org", subject="Alt", date="",
        body="Schon gespeicherter Inhalt", body_loaded=True,
        contact_addresses=["old@example.org"],
    )

    header = (
        b"From: Neue Familie <new@example.org>\r\n"
        b"To: MUSart <musikunterricht@musart.de>\r\n"
        b"Subject: Neue Anfrage\r\n"
        b"Date: Tue, 24 Nov 2026 08:00:00 +0100\r\n"
        b"Content-Type: text/plain; charset=utf-8\r\n\r\n"
    )
    client = MagicMock()
    client.response.return_value = ("UIDVALIDITY", [b"99"])
    requests = []

    def uid(command, *args):
        requests.append((command, *args))
        if command == "SEARCH":
            return "OK", [b"10 11"]
        if "BODY.PEEK[HEADER]" in args[1]:
            assert args[0] == "11"  # never download uid 10's header again
            return "OK", [(b"1 (UID 11 FLAGS () RFC822.SIZE 260)", header)]
        assert args[0] == "10"
        return "OK", [b"1 (FLAGS (\\Seen) UID 10)"]

    client.uid.side_effect = uid
    with patch("apps.core.mail_cache._readonly_folder", return_value=nullcontext(client)):
        _sync_folder_from_imap(folder, CONFIG)

    assert MailMessageCache.objects.get(folder_cache=folder, uid=10).body == (
        "Schon gespeicherter Inhalt"
    )
    assert MailMessageCache.objects.get(folder_cache=folder, uid=10).unread is False
    assert MailMessageCache.objects.get(folder_cache=folder, uid=11).email == "new@example.org"
    assert sum("BODY.PEEK[HEADER]" in str(item) for item in requests) == 1
    folder.refresh_from_db()
    assert folder.server_total == 2
    assert folder.uidvalidity == "99"
    assert folder.last_synced_at is not None
    with patch("apps.core.mail_cache.schedule_folder_sync"):
        snapshot = cached_folder_page(studio, admin_user, CONFIG, "inbox")
    assert set(snapshot["cached_ids"]) == {"10", "11"}


@pytest.mark.django_db
def test_uidvalidity_change_discards_old_cached_message(studio, admin_user):
    folder = folder_for_owner(studio, admin_user, CONFIG, "inbox")
    folder.uidvalidity = "99"
    folder.save(update_fields=["uidvalidity"])
    MailMessageCache.objects.create(
        folder_cache=folder, uid=10, sender_name="Alt",
        email="old@example.org", subject="Alt", body="Nicht mehr gültig",
        body_loaded=True,
    )
    client = MagicMock()
    client.response.return_value = ("UIDVALIDITY", [b"100"])
    client.uid.side_effect = [
        ("OK", [b"11"]),
        ("OK", [(b"1 (UID 11 FLAGS () RFC822.SIZE 230)", (
            b"From: Neue Familie <new@example.org>\r\nSubject: Neu\r\n\r\n"
        ))]),
    ]
    with patch("apps.core.mail_cache._readonly_folder", return_value=nullcontext(client)):
        _sync_folder_from_imap(folder, CONFIG)

    assert not folder.messages.filter(uid=10).exists()
    assert folder.messages.filter(uid=11).exists()


@pytest.mark.django_db
def test_action_updates_flags_or_invalidates_moved_message(studio, admin_user):
    folder = folder_for_owner(studio, admin_user, CONFIG, "inbox")
    folder.uidvalidity = "99"
    folder.save(update_fields=["uidvalidity"])
    MailMessageCache.objects.create(
        folder_cache=folder, uid=8, sender_name="Test",
        email="test@example.org", subject="Termin",
    )
    update_cache_after_mail_action(
        studio, admin_user, CONFIG, "inbox", "read", ["8"], "99",
    )
    assert folder.messages.get(uid=8).unread is False
    update_cache_after_mail_action(
        studio, admin_user, CONFIG, "inbox", "archive", ["8"], "99",
    )
    assert folder.messages.count() == 0


@pytest.mark.django_db
def test_api_cache_is_owner_only_without_asking_imap(
    authenticated_client, teacher_authenticated_client, admin_user, studio,
):
    admin_user.preferences = {"technical": CONFIG}
    admin_user.save(update_fields=["preferences"])
    endpoint = reverse("mail-cache-folder-list", kwargs={"folder": "inbox"})
    assert teacher_authenticated_client.get(endpoint).status_code == 403
    with (
        patch("apps.core.mail_cache.async_task") as queued,
        patch("apps.core.mail_cache._readonly_folder") as imap,
    ):
        response = authenticated_client.get(endpoint)
    assert response.status_code == 200, response.data
    assert response.data["messages"] == []
    assert response.data["syncing"] is True
    queued.assert_called_once()
    imap.assert_not_called()
