"""Controlled IMAP changes for messages selected in the StudioSync inbox.

All commands use UIDs (never sequence numbers), validate UIDVALIDITY and
confirm each selected message still exists before applying any operation.
Moving messages uses UID MOVE; no unsafe COPY/EXPUNGE fallback is attempted.
"""

import imaplib
import logging
import re
import ssl
from contextlib import contextmanager

from apps.core.mail_service import MailFetchError, _configuration, _uidvalidity

LOG = logging.getLogger(__name__)
MAX_BATCH = 200
ALLOWED_ACTIONS = {"read", "unread", "spam", "archive"}

# An IMAP LIST record contains flags, a hierarchy delimiter and a mailbox name.
# Preserve the server-returned mailbox token (including quotes/IMAP UTF-7)
# when passing it back to UID MOVE, rather than constructing a folder path.
LIST_PATTERN = re.compile(
    rb'^\((?P<flags>[^)]*)\)\s+(?:"(?:[^"\\]|\\.)*"|NIL)\s+'
    rb'(?P<mailbox>"(?:[^"\\]|\\.)*"|\S+)\s*$'
)
UID_PATTERN = re.compile(rb"\bUID\s+(\d+)\b", re.IGNORECASE)


@contextmanager
def _writable_inbox(config):
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
        status, _ = client.select("INBOX", readonly=False)
        if status != "OK":
            raise MailFetchError("Der Posteingang konnte nicht geöffnet werden.")
        yield client
    except MailFetchError:
        raise
    except (imaplib.IMAP4.error, OSError, ssl.SSLError, TimeoutError) as exc:
        LOG.warning("IMAP write operation failed (%s)", type(exc).__name__)
        raise MailFetchError(
            "Die IMAP-Aktion ist fehlgeschlagen. Bitte den Posteingang aktualisieren."
        ) from exc
    finally:
        if client is not None:
            try:
                client.logout()
            except (imaplib.IMAP4.error, OSError):
                pass


def _validated_uids(uids):
    if not isinstance(uids, list) or not 1 <= len(uids) <= MAX_BATCH:
        raise MailFetchError(
            "Bitte 1 bis 200 Nachrichten für diese Aktion auswählen."
        )
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
        if isinstance(record, tuple):
            metadata = record[0]
        else:
            metadata = record
        if isinstance(metadata, bytes):
            match = UID_PATTERN.search(metadata)
            if match:
                existing.add(match.group(1).decode("ascii"))
    if not set(uids).issubset(existing):
        raise MailFetchError(
            "Mindestens eine Nachricht wurde inzwischen verändert oder verschoben. "
            "Bitte den Posteingang neu abrufen."
        )


def _available_folders(client):
    status, records = client.list()
    if status != "OK":
        raise MailFetchError(
            "Die IMAP-Ordner konnten nicht gelesen werden."
        )
    folders = []
    for entry in records or []:
        if not isinstance(entry, bytes):
            continue
        match = LIST_PATTERN.match(entry)
        if not match:
            continue
        flags = match.group("flags").lower().split()
        if b"\\noselect" in flags:
            continue
        token = match.group("mailbox")
        name = token.strip(b'"').decode("ascii", errors="ignore").lower()
        leaf = re.split(r"[/.]", name)[-1]
        folders.append((flags, leaf, token))
    return folders


def _destination(client, action):
    folders = _available_folders(client)
    special = b"\\junk" if action == "spam" else b"\\archive"
    by_flag = [token for flags, _, token in folders if special in flags]
    if len(by_flag) == 1:
        return by_flag[0]
    if len(by_flag) > 1:
        raise MailFetchError(
            "Mehrere gleichartige Zielordner vorhanden. "
            "Bitte die Ordnerkonfiguration prüfen."
        )

    matches = (
        {"spam", "junk", "junk-e-mail", "spamverdacht", "spam-mails"}
        if action == "spam"
        else {"archive", "archiv", "archives"}
    )
    by_name = [token for _, leaf, token in folders if leaf in matches]
    if len(by_name) == 1:
        return by_name[0]
    if len(by_name) > 1:
        raise MailFetchError(
            "Mehrere mögliche Zielordner gefunden. Bitte die IMAP-Ordner prüfen."
        )
    if action == "spam":
        raise MailFetchError(
            "Auf dem Mailserver wurde kein eindeutiger Spam-Ordner gefunden."
        )

    # Creating an archive is only done when the user explicitly requests
    # archiving and the mailbox has no Archive/Archiv folder yet.
    status, _ = client.create("Archive")
    if status != "OK":
        raise MailFetchError(
            "Kein Archivordner gefunden und der Server konnte keinen anlegen."
        )
    created = [
        token for _, leaf, token in _available_folders(client)
        if leaf == "archive"
    ]
    if len(created) != 1:
        raise MailFetchError(
            "Der angelegte Archivordner konnte nicht eindeutig ermittelt werden."
        )
    return created[0]


def apply_inbox_action(config, action, uids, expected_uidvalidity):
    """Apply one validated batch. Return only after IMAP confirms success.

    No flags or folders are changed if UIDVALIDITY/UID membership is stale.
    """
    if action not in ALLOWED_ACTIONS:
        raise MailFetchError("Unbekannte E-Mail-Aktion.")
    selected = _validated_uids(uids)
    expected = str(expected_uidvalidity or "")
    if not re.fullmatch(r"[1-9]\d{0,19}", expected):
        raise MailFetchError(
            "Der Postfachstand fehlt. Bitte zuerst die Nachrichten abrufen."
        )

    with _writable_inbox(config) as client:
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
            target = _destination(client, action)
            # UID MOVE is an atomic move supported by current Dovecot versions.
            # An unsupported MOVE reports NO/BAD rather than partially copying.
            status, _ = client.uid("MOVE", uid_set, target)

        if status != "OK":
            raise MailFetchError(
                "Der Mailserver hat die Aktion nicht bestätigt. "
                "Bitte den Posteingang aktualisieren."
            )

        return {
            "action": action,
            "uids": selected,
            "updated": len(selected),
        }
