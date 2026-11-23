"""Resolve selectable IMAP folders from the server's LIST response.

Only fixed StudioSync folder keys are accepted from the browser; the wire
mailbox names are always obtained from the authenticated IMAP server.
"""

import re

FOLDER_KEYS = {"inbox", "sent", "drafts", "archive", "spam", "trash"}
LIST_PATTERN = re.compile(
    rb'^\((?P<flags>[^)]*)\)\s+(?:"(?:[^"\\]|\\.)*"|NIL)\s+'
    rb'(?P<mailbox>"(?:[^"\\]|\\.)*"|\S+)\s*$'
)

SPECIAL_USES = {
    "sent": b"\\sent",
    "drafts": b"\\drafts",
    "archive": b"\\archive",
    "spam": b"\\junk",
    "trash": b"\\trash",
}

FOLDER_NAMES = {
    "sent": {"sent", "sent items", "sent messages", "gesendet", "gesendete elemente"},
    "drafts": {"drafts", "entwuerfe", "entwürfe", "draft"},
    "archive": {"archive", "archives", "archiv"},
    "spam": {"spam", "junk", "junk-e-mail", "spamverdacht", "spam-mails"},
    "trash": {"trash", "deleted items", "deleted messages", "papierkorb", "gelöscht", "gelöschte elemente"},
}


class MailFolderError(Exception):
    """A server-safe mailbox resolution failure."""


def available_folders(client):
    status, records = client.list()
    if status != "OK":
        raise MailFolderError("Die IMAP-Ordner konnten nicht gelesen werden.")
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


def resolve_folder(client, folder, create=False):
    """Return a verified IMAP mailbox token; optionally create only Trash/Archive.

    A new folder is created only on an explicit move into that destination.
    """
    if folder not in FOLDER_KEYS:
        raise MailFolderError("Dieser E-Mail-Ordner wird nicht unterstützt.")
    if folder == "inbox":
        return "INBOX"

    folders = available_folders(client)
    flagged = [
        token for flags, _, token in folders
        if SPECIAL_USES[folder] in flags
    ]
    if len(flagged) > 1:
        raise MailFolderError("Mehrere gleichartige IMAP-Ordner gefunden.")
    if len(flagged) == 1:
        return flagged[0]

    by_name = [
        token for _, leaf, token in folders
        if leaf in FOLDER_NAMES[folder]
    ]
    if len(by_name) > 1:
        raise MailFolderError(
            "Mehrere mögliche Zielordner gefunden. Bitte die IMAP-Ordner prüfen."
        )
    if len(by_name) == 1:
        return by_name[0]

    if create and folder in {"archive", "trash"}:
        name = "Archive" if folder == "archive" else "Trash"
        status, _ = client.create(name)
        if status != "OK":
            raise MailFolderError(
                f"Der Ordner {name} konnte auf dem Mailserver nicht angelegt werden."
            )
        # Re-query actual mailbox naming, rather than guessing the hierarchy.
        return resolve_folder(client, folder, create=False)

    raise MailFolderError(
        f"Auf dem Mailserver wurde kein eindeutiger Ordner für {folder} gefunden."
    )
