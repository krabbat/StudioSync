"""Read-only IMAP inbox access for StudioSync.

No remote flags are changed by browsing. UID is scoped to INBOX and paired
with UIDVALIDITY to prevent stale selections after a mailbox rebuild.
"""

import imaplib
import logging
import re
import ssl
from contextlib import contextmanager
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr, parsedate_to_datetime
from html import unescape

from django.utils.html import strip_tags

from apps.core.security import assert_public_host

LOG = logging.getLogger(__name__)
LIST_PAGE_SIZE = 40
MAX_PAGE_SIZE = 80
MAX_PREVIEW_BYTES = 5 * 1024 * 1024
MAX_TEXT_LENGTH = 150_000


class MailFetchError(Exception):
    """A sanitized failure safe to report to the mailbox owner."""


def _configuration(config):
    host = str(config.get("imap_host") or "").strip()
    user = str(config.get("imap_username") or "").strip()
    password = config.get("imap_password") or ""
    security = str(config.get("imap_security") or "ssl").strip().lower()
    try:
        port = int(config.get("imap_port") or (143 if security == "starttls" else 993))
    except (ValueError, TypeError) as exc:
        raise MailFetchError("Der IMAP-Port ist ungültig.") from exc

    if not host or not user or not password:
        raise MailFetchError("Bitte zuerst IMAP unter Einstellungen → Technik vollständig einrichten.")
    if len(host) > 253 or any(char.isspace() for char in host):
        raise MailFetchError("Der IMAP-Servername ist ungültig.")
    if (security, port) not in {("ssl", 993), ("starttls", 143)}:
        raise MailFetchError("Nur IMAP über SSL/TLS (993) oder STARTTLS (143) wird unterstützt.")
    try:
        assert_public_host(host, port)
    except (OSError, ValueError) as exc:
        raise MailFetchError("Der IMAP-Server ist nicht zulässig oder nicht erreichbar.") from exc
    return host, port, user, password, security


@contextmanager
def _readonly_inbox(config):
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
        status, _ = client.select("INBOX", readonly=True)
        if status != "OK":
            raise MailFetchError("Der Posteingang konnte nicht geöffnet werden.")
        yield client
    except MailFetchError:
        raise
    except (imaplib.IMAP4.error, OSError, ssl.SSLError, TimeoutError) as exc:
        LOG.warning("Read-only IMAP inbox access failed: %s", type(exc).__name__)
        raise MailFetchError("Der Posteingang konnte nicht abgerufen werden. Bitte IMAP-Zugang prüfen.") from exc
    finally:
        if client is not None:
            try:
                client.logout()
            except (imaplib.IMAP4.error, OSError):
                pass


def _uidvalidity(client):
    status, data = client.response("UIDVALIDITY")
    if status != "UIDVALIDITY" or not data:
        return None
    first = data[0]
    if isinstance(first, bytes):
        first = first.decode("ascii", errors="ignore")
    return str(first).strip() if first is not None else None


def _parse_metadata(item):
    """IMAP literal pairs contain (response metadata, header bytes)."""
    if not isinstance(item, tuple) or len(item) < 2:
        return None
    meta, header = item[0], item[1]
    if not isinstance(meta, bytes) or not isinstance(header, bytes):
        return None
    matched = re.search(rb"\bUID\s+(\d+)\b", meta, re.IGNORECASE)
    if not matched:
        return None

    flags_match = re.search(rb"\bFLAGS\s+\(([^)]*)\)", meta, re.IGNORECASE)
    flags = flags_match.group(1).lower() if flags_match else b""
    size_match = re.search(rb"\bRFC822\.SIZE\s+(\d+)", meta, re.IGNORECASE)
    size = int(size_match.group(1)) if size_match else None

    message = BytesParser(policy=policy.default).parsebytes(header, headersonly=True)
    name, address = parseaddr(str(message.get("From", "")))
    raw_date = str(message.get("Date", ""))
    date = None
    if raw_date:
        try:
            date = parsedate_to_datetime(raw_date).isoformat()
        except (ValueError, TypeError, IndexError, OverflowError):
            date = None

    content_type = str(message.get("Content-Type", "")).lower()
    return {
        "id": matched.group(1).decode("ascii"),
        "from": name or address or "Unbekannter Absender",
        "email": address,
        "subject": str(message.get("Subject", "")) or "(Ohne Betreff)",
        "date": date,
        "unread": b"\\seen" not in flags,
        "starred": b"\\flagged" in flags,
        "answered": b"\\answered" in flags,
        "has_attachment": "multipart/mixed" in content_type,
        "size": size,
        "preview": "",
        "attachments": [],
    }


def list_inbox(config, offset=0, limit=LIST_PAGE_SIZE):
    """Return newest IMAP UIDs first. Header-only fetch is fast and read-only."""
    offset = max(0, int(offset))
    limit = max(1, min(MAX_PAGE_SIZE, int(limit)))
    with _readonly_inbox(config) as client:
        status, data = client.uid("SEARCH", None, "ALL")
        if status != "OK":
            raise MailFetchError("Die Nachrichtenliste konnte nicht geladen werden.")

        # Never treat IMAP sequence numbers as permanent identifiers.
        uids = sorted((int(uid) for uid in (data[0] or b"").split()), reverse=True)
        total = len(uids)
        batch = [str(uid) for uid in uids[offset:offset + limit]]
        messages = []
        if batch:
            status, records = client.uid(
                "FETCH", ",".join(batch), "(UID FLAGS RFC822.SIZE BODY.PEEK[HEADER])"
            )
            if status != "OK":
                raise MailFetchError("Die Nachrichtenköpfe konnten nicht geladen werden.")

            indexed = {}
            for record in records or []:
                parsed = _parse_metadata(record)
                if parsed:
                    indexed[parsed["id"]] = parsed
            messages = [indexed[uid] for uid in batch if uid in indexed]

        return {
            "messages": messages,
            "total": total,
            "has_more": offset + len(batch) < total,
            "offset": offset,
            "limit": limit,
            "uidvalidity": _uidvalidity(client),
        }


def _message_body(message):
    attachments = []
    plain = None
    html = None
    for part in message.walk():
        if part.is_multipart():
            continue
        disposition = part.get_content_disposition()
        filename = part.get_filename()
        if filename:
            attachments.append(str(filename)[:255])
        if disposition == "attachment" or filename:
            continue
        if part.get_content_type() not in ("text/plain", "text/html"):
            continue
        try:
            value = part.get_content()
        except (LookupError, UnicodeError, ValueError):
            raw = part.get_payload(decode=True) or b""
            value = raw.decode(part.get_content_charset() or "utf-8", errors="replace")
        if not isinstance(value, str):
            continue
        if part.get_content_type() == "text/plain" and plain is None:
            plain = value
        if part.get_content_type() == "text/html" and html is None:
            html = value

    # Never inject arbitrary sender HTML into StudioSync.
    if plain is not None:
        body = plain
    elif html is not None:
        body = strip_tags(re.sub(r"(?i)<\s*br\s*/?\s*>|</\s*(?:p|div|li|tr|h[1-6])\s*>", "\n", html))
        body = unescape(body)
    else:
        body = "(Kein lesbarer Nachrichtentext)"
    return body[:MAX_TEXT_LENGTH], attachments


def get_inbox_message(config, uid, expected_uidvalidity=None):
    """Fetch one selected message; reject stale UIDs and oversized previews."""
    if not re.fullmatch(r"[1-9]\d{0,19}", str(uid)):
        raise MailFetchError("Ungültige Nachrichtenkennung.")

    with _readonly_inbox(config) as client:
        uidvalidity = _uidvalidity(client)
        if expected_uidvalidity and uidvalidity != str(expected_uidvalidity):
            raise MailFetchError("Das Postfach wurde verändert. Bitte die Nachrichten neu abrufen.")

        status, records = client.uid("FETCH", str(uid), "(UID RFC822.SIZE FLAGS BODY.PEEK[HEADER])")
        if status != "OK":
            raise MailFetchError("Die Nachricht konnte nicht gefunden werden.")
        parsed = next((candidate for item in (records or [])
                       if (candidate := _parse_metadata(item)) is not None), None)
        if not parsed or parsed["id"] != str(uid):
            raise MailFetchError("Die Nachricht existiert nicht mehr. Bitte erneut abrufen.")
        if parsed["size"] is None or parsed["size"] > MAX_PREVIEW_BYTES:
            raise MailFetchError(
                "Diese Nachricht ist für die Textvorschau zu groß (über 5 MB). "
                "Eine Anhangsansicht folgt im nächsten Schritt."
            )

        status, data = client.uid("FETCH", str(uid), "(UID BODY.PEEK[])")
        if status != "OK":
            raise MailFetchError("Der Nachrichtentext konnte nicht geladen werden.")
        raw = next(
            (item[1] for item in (data or [])
             if isinstance(item, tuple) and len(item) > 1 and isinstance(item[1], bytes)),
            None,
        )
        if raw is None or len(raw) > MAX_PREVIEW_BYTES:
            raise MailFetchError("Der Nachrichtentext konnte nicht sicher geladen werden.")
        message = BytesParser(policy=policy.default).parsebytes(raw)
        body, attachments = _message_body(message)
        parsed.update({"body": body, "preview": body[:160], "attachments": attachments})
        return parsed
