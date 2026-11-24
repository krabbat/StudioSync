"""Regression checks for real IMAP state changes and guarded batch operations."""

from unittest.mock import MagicMock, patch

import pytest
from django.urls import reverse

from apps.core.mail_actions import apply_folder_action, apply_inbox_action
from apps.core.mail_service import MailFetchError

CONFIG = {
    "imap_host": "mail.manitu.de",
    "imap_port": "993",
    "imap_username": "musikunterricht@musart.de",
    "imap_password": "server-side-only",
    "imap_security": "ssl",
}


def mock_imap():
    client = MagicMock()
    client.select.return_value = ("OK", [b"2"])
    client.response.return_value = ("UIDVALIDITY", [b"99"])
    client.list.return_value = (
        "OK",
        [
            rb'(\HasNoChildren) "/" "INBOX"',
            rb'(\HasNoChildren \Junk) "/" "Junk"',
            rb'(\HasNoChildren \Archive) "/" "Archive"',
            rb'(\HasNoChildren \Trash) "/" "Trash"',
        ],
    )

    def command(name, *args):
        if name == "FETCH":
            assert args == ("12,34", "(UID FLAGS)")
            return (
                "OK",
                [
                    b"1 (UID 12 FLAGS ())",
                    b"2 (UID 34 FLAGS (\\Seen))",
                ],
            )
        if name in ("STORE", "MOVE"):
            return "OK", []
        raise AssertionError(f"Unexpected IMAP command: {name}")

    client.uid.side_effect = command
    return client


def run_with_client(client, action, uids=None, generation="99"):
    with (
        patch("apps.core.mail_service.assert_public_host"),
        patch("apps.core.mail_actions.imaplib.IMAP4_SSL", return_value=client),
    ):
        return apply_inbox_action(
            CONFIG, action, uids if uids is not None else ["12", "34"], generation
        )


@pytest.mark.parametrize(
    ("action", "operator"),
    [("read", "+FLAGS.SILENT"), ("unread", "-FLAGS.SILENT")],
)
def test_batch_seen_flags_use_uid_store_and_do_not_move(action, operator):
    client = mock_imap()
    result = run_with_client(client, action)
    assert result == {
        "action": action,
        "uids": ["12", "34"],
        "updated": 2,
    }
    client.select.assert_called_once_with("INBOX", readonly=False)
    client.uid.assert_any_call("STORE", "12,34", operator, r"(\Seen)")
    client.list.assert_not_called()
    client.logout.assert_called_once()


@pytest.mark.parametrize(
    ("action", "folder"),
    [("spam", b'"Junk"'), ("archive", b'"Archive"'), ("delete", b'"Trash"')],
)
def test_move_uses_real_server_folders_without_expunging(action, folder):
    client = mock_imap()
    run_with_client(client, action)
    client.uid.assert_any_call("MOVE", "12,34", folder)
    client.uid.assert_any_call("FETCH", "12,34", "(UID FLAGS)")
    client.store.assert_not_called()
    client.expunge.assert_not_called()
    client.create.assert_not_called()


def test_archive_folder_created_only_on_explicit_archive_action():
    client = mock_imap()
    client.list.side_effect = [
        ("OK", [rb'(\HasNoChildren) "/" "INBOX"']),
        ("OK", [
            rb'(\HasNoChildren) "/" "INBOX"',
            rb'(\HasNoChildren) "/" "Archive"',
        ]),
    ]
    client.create.return_value = ("OK", [])
    run_with_client(client, "archive")
    client.create.assert_called_once_with("Archive")
    client.uid.assert_any_call("MOVE", "12,34", b'"Archive"')


def test_missing_spam_folder_never_creates_or_moves_anything():
    client = mock_imap()
    client.list.return_value = ("OK", [rb'(\HasNoChildren) "/" "INBOX"'])
    with pytest.raises(MailFetchError, match="spam"):
        run_with_client(client, "spam")
    client.create.assert_not_called()
    assert not any(call.args[0] == "MOVE" for call in client.uid.call_args_list)


def test_ambiguous_folder_is_not_guessed():
    client = mock_imap()
    client.list.return_value = (
        "OK",
        [
            rb'(\HasNoChildren) "/" "Spam"',
            rb'(\HasNoChildren) "/" "Junk"',
        ],
    )
    with pytest.raises(MailFetchError, match="Mehrere"):
        run_with_client(client, "spam")
    assert not any(call.args[0] == "MOVE" for call in client.uid.call_args_list)


def test_stale_mailbox_generation_makes_no_changes():
    client = mock_imap()
    with pytest.raises(MailFetchError, match="Postfachgeneration"):
        run_with_client(client, "read", generation="100")
    client.uid.assert_not_called()
    client.create.assert_not_called()


def test_missing_mail_uid_does_not_change_partial_batch():
    client = mock_imap()
    client.uid.return_value = ("OK", [b"1 (UID 12 FLAGS ())"])
    client.uid.side_effect = None
    with pytest.raises(MailFetchError, match="erneut abrufen"):
        run_with_client(client, "archive")
    assert client.uid.call_count == 1
    client.list.assert_not_called()
    client.create.assert_not_called()


@pytest.mark.parametrize(
    ("action", "uids", "generation"),
    [
        ("expunge", ["12"], "99"),
        ("read", [], "99"),
        ("read", ["12", "2:*"], "99"),
        ("read", ["12"], ""),
        ("read", [str(i) for i in range(1, 202)], "99"),
    ],
)
def test_invalid_input_never_connects_to_mail_server(action, uids, generation):
    client = mock_imap()
    with pytest.raises(MailFetchError):
        run_with_client(client, action, uids, generation)
    client.login.assert_not_called()


@pytest.mark.django_db
def test_action_endpoint_uses_saved_admin_credentials(
    authenticated_client, admin_user, studio
):
    admin_user.preferences = {"technical": dict(CONFIG)}
    admin_user.save(update_fields=["preferences"])
    with patch("apps.core.views.mail.apply_inbox_action") as handler:
        handler.return_value = {
            "action": "read", "uids": ["12"], "updated": 1
        }
        response = authenticated_client.post(
            reverse("mail-inbox-actions"),
            {"action": "read", "uids": ["12"], "uidvalidity": "99"},
            format="json",
        )
    assert response.status_code == 200, response.data
    assert handler.call_args.args[0]["imap_password"] == "server-side-only"
    assert handler.call_args.args[1:] == ("read", ["12"], "99")
    assert "server-side-only" not in str(response.data)


@pytest.mark.django_db
def test_action_endpoint_rejects_other_roles_and_invalid_request(
    authenticated_client, teacher_authenticated_client,
    student_authenticated_client, studio
):
    endpoint = reverse("mail-inbox-actions")
    data = {"action": "read", "uids": ["12"], "uidvalidity": "99"}
    assert teacher_authenticated_client.post(endpoint, data).status_code == 403
    assert student_authenticated_client.post(endpoint, data).status_code == 403
    assert authenticated_client.post(
        endpoint, {"action": "read", "uids": [], "uidvalidity": "99"},
        format="json",
    ).status_code == 400


def test_delete_is_move_to_trash_never_permanent_deletion():
    client = mock_imap()
    run_with_client(client, "delete")
    client.uid.assert_any_call("MOVE", "12,34", b'"Trash"')
    client.expunge.assert_not_called()
    assert not any(
        call.args[0] == "STORE" and "\\Deleted" in str(call.args)
        for call in client.uid.call_args_list
    )


def test_delete_creates_trash_only_when_user_requests_move():
    client = mock_imap()
    client.list.side_effect = [
        ("OK", [rb'(\\HasNoChildren) "/" "INBOX"']),
        ("OK", [
            rb'(\\HasNoChildren) "/" "INBOX"',
            rb'(\\HasNoChildren) "/" "Trash"',
        ]),
    ]
    client.create.return_value = ("OK", [])
    run_with_client(client, "delete")
    client.create.assert_called_once_with("Trash")
    client.uid.assert_any_call("MOVE", "12,34", b'"Trash"')


@pytest.mark.parametrize(
    ("folder", "action", "destination"),
    [
        ("trash", "restore", "INBOX"),
        ("archive", "restore", "INBOX"),
        ("spam", "restore", "INBOX"),
    ],
)
def test_move_back_to_inbox_preserves_message_from_source_folder(
    folder, action, destination
):
    client = mock_imap()
    with (
        patch("apps.core.mail_service.assert_public_host"),
        patch("apps.core.mail_actions.imaplib.IMAP4_SSL", return_value=client),
    ):
        result = apply_folder_action(CONFIG, folder, action, ["12", "34"], "99")
    assert result["updated"] == 2
    client.uid.assert_any_call("MOVE", "12,34", destination)
    client.expunge.assert_not_called()
    assert client.select.call_args.kwargs["readonly"] is False
    assert client.select.call_args.args[0] != "INBOX"


@pytest.mark.django_db
def test_mail_folder_delete_endpoint_requires_admin_owner(
    authenticated_client, teacher_authenticated_client, admin_user, studio
):
    admin_user.preferences = {"technical": dict(CONFIG)}
    admin_user.save(update_fields=["preferences"])
    url = reverse("mail-folder-actions", kwargs={"folder": "inbox"})
    body = {"action": "delete", "uids": ["12"], "uidvalidity": "99"}
    assert teacher_authenticated_client.post(url, body, format="json").status_code == 403
    with patch("apps.core.views.mail.apply_folder_action") as handler:
        handler.return_value = {"action": "delete", "uids": ["12"], "updated": 1}
        response = authenticated_client.post(url, body, format="json")
    assert response.status_code == 200, response.data
    assert handler.call_args.args[1:] == ("inbox", "delete", ["12"], "99")
    assert handler.call_args.args[0]["imap_password"] == "server-side-only"
