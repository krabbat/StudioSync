"""Persistent owner-scoped IMAP cache with background delta synchronization.

The HTTP list endpoint reads only PostgreSQL. Django-Q synchronizes message
UIDs, changed flags and newly encountered headers. Full message bodies are
fetched just once on opening; attachments are represented by filenames only.

Q jobs contain only a folder-cache ID, never IMAP credentials.
"""

import hashlib
import logging
import re
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from django_q.tasks import async_task

from apps.core.mail_folders import FOLDER_KEYS
from apps.core.mail_service import (
    LIST_PAGE_SIZE,
    MAX_PAGE_SIZE,
    MailFetchError,
    _parse_metadata,
    _readonly_folder,
    _uidvalidity,
    get_folder_message,
)
from apps.core.models import MailFolderCache, MailMessageCache

LOG = logging.getLogger(__name__)
SYNC_AGE_SECONDS = 45
RETRY_SECONDS = 35
LOCK_TIMEOUT_SECONDS = 95
INITIAL_CACHED_COUNT = 200
MAX_NEW_HEADERS_PER_JOB = 250
FETCH_BATCH = 50
UID_FLAGS = re.compile(rb"\bUID\s+(\d+)\b.*?\bFLAGS\s+\(([^)]*)\)", re.I)


def mailbox_account_key(config):
    """Identify an account without persisting the password in the cache."""
    parts = (
        str(config.get("imap_host") or "").strip().casefold(),
        str(config.get("imap_port") or "993").strip(),
        str(config.get("imap_security") or "ssl").strip().casefold(),
        str(config.get("imap_username") or "").strip().casefold(),
    )
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()


def folder_for_owner(studio, owner, config, folder):
    if folder not in FOLDER_KEYS:
        raise MailFetchError("Unbekannter E-Mail-Ordner.")
    if owner.role != "admin" or studio.owner_id != owner.pk:
        raise MailFetchError("Kein Zugriff auf dieses E-Mail-Postfach.")
    cache, _ = MailFolderCache.objects.get_or_create(
        studio=studio, owner=owner, account_key=mailbox_account_key(config),
        folder=folder,
    )
    return cache


def _serialize_message(record, include_body=False):
    data = {
        "id": str(record.uid),
        "from": record.sender_name,
        "email": record.email,
        "subject": record.subject,
        "date": record.date or None,
        "unread": record.unread,
        "starred": record.starred,
        "answered": record.answered,
        "has_attachment": record.has_attachment,
        "size": record.size,
        "preview": record.preview,
        "attachments": record.attachments,
    }
    if include_body:
        data["body"] = record.body
    return data


def schedule_folder_sync(cache, force=False, requested_count=INITIAL_CACHED_COUNT):
    """Atomic lock protects against duplicate background jobs across web workers."""
    now = timezone.now()
    required = max(INITIAL_CACHED_COUNT, int(requested_count))
    with transaction.atomic():
        current = MailFolderCache.objects.select_for_update().get(pk=cache.pk)
        if required > current.requested_count:
            current.requested_count = required
        running = bool(
            current.sync_started_at
            and now - current.sync_started_at < timedelta(seconds=LOCK_TIMEOUT_SECONDS)
        )
        needed = min(current.requested_count, current.server_total) if current.last_synced_at else current.requested_count
        missing_page = current.messages.count() < needed
        fresh = bool(
            current.last_synced_at
            and now - current.last_synced_at < timedelta(seconds=SYNC_AGE_SECONDS)
        )
        attempted_recently = bool(
            current.last_attempt_at
            and now - current.last_attempt_at < timedelta(seconds=RETRY_SECONDS)
        )
        if running or (not force and (fresh and not missing_page or attempted_recently)):
            current.save(update_fields=["requested_count"])
            return False
        current.sync_started_at = now
        current.last_attempt_at = now
        current.sync_error = ""
        current.save(update_fields=[
            "requested_count", "sync_started_at", "last_attempt_at", "sync_error",
        ])
    try:
        # Serialized task arguments must never include the user's IMAP password.
        async_task("apps.core.mail_cache.sync_folder_task", current.pk)
    except Exception as exc:
        LOG.warning("Queueing IMAP sync failed (%s)", type(exc).__name__)
        MailFolderCache.objects.filter(pk=current.pk, sync_started_at=now).update(
            sync_started_at=None, sync_error="Hintergrundabgleich konnte nicht gestartet werden."
        )
        return False
    return True


def cached_folder_page(studio, owner, config, folder, offset=0, limit=LIST_PAGE_SIZE,
                       refresh=False):
    """No IMAP request is made while serving the list from PostgreSQL."""
    offset = int(offset)
    limit = int(limit)
    if not 0 <= offset <= 1_000_000 or not 1 <= limit <= MAX_PAGE_SIZE:
        raise MailFetchError("Ungültige Seitenangabe.")
    cache = folder_for_owner(studio, owner, config, folder)
    schedule_folder_sync(
        cache, force=refresh, requested_count=offset + limit,
    )
    cache.refresh_from_db()
    now = timezone.now()
    syncing = bool(
        cache.sync_started_at
        and now - cache.sync_started_at < timedelta(seconds=LOCK_TIMEOUT_SECONDS)
    )
    rows = list(cache.messages.order_by("-uid")[offset:offset + limit])
    count = cache.messages.count()
    known_total = cache.server_total if cache.last_synced_at else count
    return {
        "messages": [_serialize_message(item) for item in rows],
        "total": max(count, known_total),
        "has_more": offset + len(rows) < max(count, known_total),
        "offset": offset,
        "limit": limit,
        "uidvalidity": cache.uidvalidity or None,
        "syncing": syncing,
        "synced": cache.last_synced_at is not None,
        "last_synced_at": cache.last_synced_at.isoformat() if cache.last_synced_at else None,
        "sync_error": cache.sync_error,
    }


def cached_message_detail(studio, owner, config, folder, uid, expected_uidvalidity=None):
    """Open once via IMAP; afterwards serve sanitized text from PostgreSQL."""
    if not re.fullmatch(r"[1-9]\d{0,19}", str(uid)):
        raise MailFetchError("Ungültige Nachrichtenkennung.")
    cache = folder_for_owner(studio, owner, config, folder)
    if expected_uidvalidity and cache.uidvalidity and (
        str(expected_uidvalidity) != cache.uidvalidity
    ):
        raise MailFetchError("Das Postfach wurde verändert. Bitte neu abrufen.")
    record = cache.messages.filter(uid=int(uid)).first()
    if record and record.body_loaded:
        return _serialize_message(record, include_body=True)

    # The existing detail loader validates UIDVALIDITY on the live server,
    # including before initial cache synchronization is complete.
    result = get_folder_message(
        config, folder, uid,
        expected_uidvalidity=expected_uidvalidity or cache.uidvalidity or None,
    )
    data = {
        "sender_name": result["from"][:320],
        "email": result["email"][:320],
        "subject": result["subject"],
        "date": result.get("date") or "",
        "unread": result["unread"],
        "starred": result["starred"],
        "answered": result.get("answered", False),
        "has_attachment": result["has_attachment"],
        "size": result.get("size"),
        "preview": result["preview"],
        "attachments": result["attachments"],
        "body": result["body"],
        "body_loaded": True,
    }
    # Don't write a message retrieved under a superseded UIDVALIDITY.
    cache.refresh_from_db()
    if expected_uidvalidity and cache.uidvalidity and cache.uidvalidity != str(expected_uidvalidity):
        raise MailFetchError("Das Postfach wurde verändert. Bitte neu abrufen.")
    cache.messages.update_or_create(uid=int(uid), defaults=data)
    return result


def _parse_flags(records):
    flags = {}
    for record in records or []:
        metadata = record[0] if isinstance(record, tuple) else record
        if not isinstance(metadata, bytes):
            continue
        match = UID_FLAGS.search(metadata)
        if match:
            tokens = match.group(2).lower()
            flags[int(match.group(1))] = (
                b"\\seen" not in tokens,
                b"\\flagged" in tokens,
                b"\\answered" in tokens,
            )
    return flags


def _chunks(items, size=FETCH_BATCH):
    for index in range(0, len(items), size):
        yield items[index:index + size]


def _sync_folder_from_imap(cache, config):
    """Only missing headers and lightweight flags are downloaded each sync."""
    with _readonly_folder(config, cache.folder) as client:
        validity = _uidvalidity(client)
        if not validity:
            raise MailFetchError("Der Mailserver hat keine Postfachgeneration geliefert.")
        status, data = client.uid("SEARCH", None, "ALL")
        if status != "OK":
            raise MailFetchError("Der Mailserver konnte nicht nach Nachrichten suchen.")
        all_uids = sorted(
            {int(item) for item in (data[0] or b"").split()}, reverse=True
        )
        wanted = all_uids[:max(INITIAL_CACHED_COUNT, cache.requested_count)]
        if cache.uidvalidity != validity:
            existing = {}
        else:
            existing = {
                obj.uid: obj for obj in
                cache.messages.filter(uid__in=wanted)
            }
        missing = [uid for uid in wanted if uid not in existing][:MAX_NEW_HEADERS_PER_JOB]
        metadata = []
        for batch in _chunks(missing):
            status, records = client.uid(
                "FETCH", ",".join(str(uid) for uid in batch),
                "(UID FLAGS RFC822.SIZE BODY.PEEK[HEADER])",
            )
            if status != "OK":
                raise MailFetchError("Neue Nachrichtenköpfe konnten nicht geladen werden.")
            for item in records or []:
                parsed = _parse_metadata(item, cache.folder)
                if parsed and int(parsed["id"]) in batch:
                    metadata.append(parsed)

        # Refresh flags for already cached messages, but never re-fetch headers.
        flags = {}
        for batch in _chunks(list(existing)):
            status, records = client.uid(
                "FETCH", ",".join(str(uid) for uid in batch), "(UID FLAGS)",
            )
            if status != "OK":
                raise MailFetchError("Die Nachrichtenmarkierungen konnten nicht geladen werden.")
            flags.update(_parse_flags(records))

    # Finish only after all IMAP commands have succeeded.
    with transaction.atomic():
        current = MailFolderCache.objects.select_for_update().get(pk=cache.pk)
        if current.uidvalidity != validity:
            current.messages.all().delete()
            existing = {}
        else:
            # Rows already in the cache, but deleted/moved on the server.
            known_uids = list(current.messages.values_list("uid", flat=True))
            vanished = [uid for uid in known_uids if uid not in set(all_uids)]
            if vanished:
                current.messages.filter(uid__in=vanished).delete()

        current.messages.bulk_create([
            MailMessageCache(
                folder_cache=current, uid=int(item["id"]),
                sender_name=item["from"][:320],
                email=item["email"][:320],
                subject=item["subject"],
                date=item.get("date") or "",
                unread=item["unread"], starred=item["starred"],
                answered=item.get("answered", False),
                has_attachment=item["has_attachment"],
                size=item.get("size"), preview=item["preview"],
                attachments=item["attachments"],
            ) for item in metadata
        ], ignore_conflicts=True, batch_size=100)
        if flags:
            records = list(current.messages.filter(uid__in=flags))
            changed = []
            for item in records:
                unread, starred, answered = flags[item.uid]
                if ((item.unread, item.starred, item.answered)
                        != (unread, starred, answered)):
                    item.unread, item.starred, item.answered = unread, starred, answered
                    changed.append(item)
            if changed:
                MailMessageCache.objects.bulk_update(
                    changed, ["unread", "starred", "answered"], batch_size=100,
                )
        current.uidvalidity = validity
        current.server_total = len(all_uids)
        current.last_synced_at = timezone.now()
        current.sync_error = ""
        current.save(update_fields=[
            "uidvalidity", "server_total", "last_synced_at", "sync_error",
        ])


def sync_folder_task(folder_cache_id):
    """Django-Q worker entrypoint; resolve saved credentials on the server."""
    cache = MailFolderCache.objects.select_related("studio", "owner").filter(
        pk=folder_cache_id
    ).first()
    if not cache:
        return
    try:
        if cache.studio.owner_id != cache.owner_id or cache.owner.role != "admin":
            raise MailFetchError("Der Postfachzugriff ist nicht mehr berechtigt.")
        preferences = cache.owner.preferences
        technical = preferences.get("technical", {}) if isinstance(preferences, dict) else {}
        if not isinstance(technical, dict):
            technical = {}
        config = {key: technical.get(key) for key in (
            "imap_host", "imap_port", "imap_security", "imap_username", "imap_password"
        )}
        if cache.account_key != mailbox_account_key(config):
            raise MailFetchError("Die Postfacheinstellungen wurden geändert.")
        _sync_folder_from_imap(cache, config)
    except Exception as exc:
        LOG.warning("IMAP cache sync failed (%s)", type(exc).__name__)
        MailFolderCache.objects.filter(pk=folder_cache_id).update(
            sync_error="Der IMAP-Abgleich ist fehlgeschlagen. Bitte erneut abrufen."
        )
    finally:
        MailFolderCache.objects.filter(pk=folder_cache_id).update(sync_started_at=None)


def update_cache_after_mail_action(studio, owner, config, folder, action, uids,
                                   uidvalidity):
    """Keep the visible cache consistent immediately after a confirmed IMAP action."""
    cache = MailFolderCache.objects.filter(
        studio=studio, owner=owner,
        account_key=mailbox_account_key(config), folder=folder,
        uidvalidity=str(uidvalidity),
    ).first()
    if cache is None:
        return
    selected = [int(uid) for uid in uids]
    if action in ("read", "unread"):
        cache.messages.filter(uid__in=selected).update(unread=action == "unread")
    else:
        cache.messages.filter(uid__in=selected).delete()
        cache.last_synced_at = None
        cache.save(update_fields=["last_synced_at"])
        destination = {
            "archive": "archive", "delete": "trash", "spam": "spam",
            "restore": "inbox",
        }.get(action)
        if destination:
            MailFolderCache.objects.filter(
                studio=studio, owner=owner,
                account_key=mailbox_account_key(config), folder=destination,
            ).update(last_synced_at=None)


def invalidate_sent_folder(studio, owner, config):
    MailFolderCache.objects.filter(
        studio=studio, owner=owner, account_key=mailbox_account_key(config),
        folder="sent",
    ).update(last_synced_at=None)
