"""Validated IMAP flag changes and safe folder moves.

All mutations use message UIDs, require a matching UIDVALIDITY and check
that every requested UID still belongs to the selected source folder.
"""

import imaplib
import logging
import re
import ssl
from contextlib import contextmanager

from apps.core.mail_folders import MailFolderError, resolve_folder
from apps.core.mail_service import MailFetchError, _configuration, _uidvalidity

LOG = logging.getLogger(__name__)
MAX_BATCH = 200
ALLOWED_ACTIONS = {"read", "unread", "spam", "archive", "delete", "restore"}
UID_PATTERN = re.compile(rb"\bUID\s+(\d+)\b", re.IGNORECASE)


@contextmanager
def _writable_folder(config, folder):
    host, port, user, password, security = _configuration(config)
    client = None
    try:
        tls = ssl.create_default_context()
        if security == "ssl":
            client = imaplib.IMAP4_SSL(host, port, ssl_context=tls, timeout=12)
        else:
            client = imaplib.IMAP4(host, port, timeout=12)
            client.starttls(ssl_context=tls)
        client.login(user, password)
        try:
            source = resolve_folder(client, folder)
        except MailFolderError as exc:
            raise MailFetchError(str(exc)) from exc
        status, _ = client.select(source, readonly=False)
        if status != "OK":
            raise MailFetchError("Der ausgewählte Mailordner konnte nicht geöffnet werden.")
        yield client
    except MailFetchError:
        raise
    except (imaplib.IMAP4.error, OSError, ssl.SSLError, TimeoutError) as exc:
        LOG.warning("IMAP write operation failed (%s)", type(exc).__name__)
        raise MailFetchError(
            "Die IMAP-Aktion ist fehlgeschlagen. Bitte den Mailordner aktualisieren."
        ) from exc
    finally:
        if client is not None:
            try:
                client.logout()
            except (imaplib.IMAP4.error, OSError):
                pass


def _validated_uids(uids):
    if not isinstance(uids, list) or not 1 <= len(uids) <= MAX_BATCH:
        raise MailFetchError("Bitte 1 bis 200 Nachrichten für diese Aktion auswählen.")
    unique = []
    seen = set()
    for item in uids:
        value = str(item)
        if not re.fullmatch(r"[1-9]\d{0,19}", value):
            raise MailFetchError("Eine Nachrichtenkennung ist ungültig.")
        if value not in seen:
            unique.append(value)
            seen.add(value)
    return unique


def _verify_exists(client, uids):
    status, records = client.uid("FETCH", ",".join(uids), "(UID FLAGS)")
    if status != "OK":
        raise MailFetchError(
            "Die ausgewählten Nachrichten konnten nicht überprüft werden."
        )
    existing = set()
    for record in records or []:
        metadata = record[0] if isinstance(record, tuple) else record
        if isinstance(metadata, bytes):
            match = UID_PATTERN.search(metadata)
            if match:
                existing.add(match.group(1).decode("ascii"))
    if not set(uids).issubset(existing):
        raise MailFetchError(
            "Mindestens eine Nachricht wurde inzwischen verändert oder verschoben. "
            "Bitte den Mailordner neu abrufen."
        )


def apply_folder_action(config, folder, action, uids, expected_uidvalidity):
    """Mutate only the selected folder after validating every UID.

    Deleting means UID MOVE to Trash, never setting \Deleted or EXPUNGE.
    Archive/Trash can be created only when their explicit move is requested.
    """
    if not isinstance(action, str) or action not in ALLOWED_ACTIONS:
        raise MailFetchError("Unbekannte E-Mail-Aktion.")
    if folder not in {"inbox", "archive", "spam", "trash", "sent", "drafts"}:
        raise MailFetchError("Dieser E-Mail-Ordner wird nicht unterstützt.")
    if action == "restore" and folder not in {"archive", "trash", "spam"}:
        raise MailFetchError("Wiederherstellen ist hier nicht möglich.")
    if action == "archive" and folder == "archive":
        raise MailFetchError("Diese Nachricht befindet sich bereits im Archiv.")
    if action == "delete" and folder == "trash":
        raise MailFetchError("Diese Nachricht befindet sich bereits im Papierkorb.")
    if action == "spam" and folder == "spam":
        raise MailFetchError("Diese Nachricht befindet sich bereits in Spam.")

    selected = _validated_uids(uids)
    expected = str(expected_uidvalidity or "")
    if not re.fullmatch(r"[1-9]\d{0,19}", expected):
        raise MailFetchError(
            "Der Postfachstand fehlt. Bitte zuerst die Nachrichten abrufen."
        )

    with _writable_folder(config, folder) as client:
        current = _uidvalidity(client)
        if current is None or str(current) != expected:
            raise MailFetchError(
                "Die Postfachgeneration hat sich geändert. "
                "Bitte die Nachrichten neu abrufen."
            )
        _verify_exists(client, selected)
        uid_set = ",".join(selected)

        if action in ("read", "unread"):
            operator = "+FLAGS.SILENT" if action == "read" else "-FLAGS.SILENT"
            status, _ = client.uid("STORE", uid_set, operator, r"(\Seen)")
        else:
            destination = {
                "archive": "archive", "spam": "spam",
                "delete": "trash", "restore": "inbox",
            }[action]
            try:
                target = resolve_folder(
                    client, destination,
                    create=action in {"archive", "delete"},
                )
            except MailFolderError as exc:
                raise MailFetchError(str(exc)) from exc
            status, _ = client.uid("MOVE", uid_set, target)

        if status != "OK":
            raise MailFetchError(
                "Der Mailserver hat die Aktion nicht bestätigt. "
                "Bitte den Mailordner aktualisieren."
            )
        return {"action": action, "uids": selected, "updated": len(selected)}


def apply_inbox_action(config, action, uids, expected_uidvalidity):
    """Compatibility entry point for the existing inbox API."""
    return apply_folder_action(
        config, "inbox", action, uids, expected_uidvalidity,
    )
