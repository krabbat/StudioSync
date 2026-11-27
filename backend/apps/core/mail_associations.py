"""Tenant-scoped automatic and manual association of cached mails with students.

Matching includes student, both parents, family billing and individual billing
contacts. Shared family addresses intentionally associate siblings; the admin can
override an ambiguous message without altering the other messages.
"""

from collections import defaultdict
from datetime import datetime, timezone as dt_timezone
from email.utils import getaddresses

from django.db import connection
from django.db.models import Exists, OuterRef, Q

from apps.core.models import Family, MailDraft, MailDraftAttachment, MailMessageCache, Student


def normalize_address(address):
    return str(address or "").strip().casefold()


def extract_contacts(message):
    """Collect unique addresses from all correspondent headers."""
    fields = []
    for header in ("From", "To", "Cc", "Reply-To"):
        fields.extend(message.get_all(header, []))
    return list(dict.fromkeys(
        email for _, address in getaddresses([str(value) for value in fields])
        if (email := normalize_address(address))
    ))[:100]


def student_catalog(studio):
    records = Student.objects.filter(studio=studio).select_related(
        "user", "family__primary_parent", "family__secondary_parent",
        "billing_profile",
    ).order_by("user__last_name", "user__first_name")
    students = {}
    by_address = defaultdict(set)
    for student in records:
        sid = str(student.pk)
        names = student.user.get_full_name().strip() or student.user.email
        instruments = list(dict.fromkeys(
            item.strip() for item in
            [student.instrument, *(student.instruments if isinstance(student.instruments, list) else [])]
            if isinstance(item, str) and item.strip()
        ))
        addresses = [student.contact_email, student.user.email]
        if student.family_id:
            family = student.family
            addresses.extend([
                family.primary_parent.email if family.primary_parent else "",
                family.secondary_parent.email if family.secondary_parent else "",
                family.billing_email,
            ])
            addresses.extend(c.get("email", "") for c in (family.contacts or []) if isinstance(c, dict))
        billing_profile = getattr(student, "billing_profile", None)
        if billing_profile:
            addresses.append(billing_profile.recipient_email)
        safe_addresses = sorted({
            value for item in addresses if (value := normalize_address(item)) and not value.endswith(".invalid")
        })
        students[sid] = {
            "id": sid,
            "name": names,
            "instruments": instruments,
            "addresses": safe_addresses,
        }
        for address in safe_addresses:
            by_address[address].add(sid)
    return students, by_address


def assigned_student_ids(message, catalog, by_address):
    """None = automatic contact matching, list = explicit admin override."""
    if message.manual_student_ids is not None:
        return sorted(str(sid) for sid in message.manual_student_ids
                      if str(sid) in catalog)
    contacts = message.contact_addresses or [message.email]
    ids = set()
    for contact in contacts:
        ids.update(by_address.get(normalize_address(contact), ()))
    return sorted(ids)


def enrich_cached_message(row, catalog, by_address):
    ids = assigned_student_ids(row, catalog, by_address)
    names = [catalog[sid]["name"] for sid in ids]
    instruments = sorted({
        instrument for sid in ids for instrument in catalog[sid]["instruments"]
    })
    return {
        "student_ids": ids,
        "student_names": names,
        "student": ", ".join(names),
        "instruments": instruments,
        "instrument": ", ".join(instruments),
        "assignment_manual": row.manual_student_ids is not None,
    }


def _sort_timestamp(value):
    """Sort mixed historical IMAP dates and draft timestamps safely."""
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value or ""))
        except (ValueError, TypeError):
            return float("-inf")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt_timezone.utc)
    return parsed.timestamp()


def mail_student_overview(studio, owner, account_key, student_id,
                          limit=40, offset=0, *, family_id=None, contact_index=None):
    """All matching received/sent mail and local drafts, paginated newest first.

    Search all cached IMAP folders (including archive) and private PostgreSQL
    drafts. No fixed 25/5000 message ceiling: retrieve just the prefix needed
    for this requested page from each source and merge by date.
    """
    sid = str(student_id)
    catalog, by_address = student_catalog(studio)
    family = None
    if family_id is not None:
        family = Family.objects.filter(pk=family_id, studio=studio).first()
        if family is None:
            return None
        member_ids = {str(value) for value in family.students.values_list("pk", flat=True)} & set(catalog)
        if contact_index is not None:
            if contact_index < 0 or contact_index >= len(family.contacts or []):
                raise ValueError("invalid contact")
            contact = family.contacts[contact_index]
            addresses = {normalize_address(contact.get("email"))} if isinstance(contact, dict) else set()
            member_ids = set()
        else:
            addresses = {address for member in member_ids for address in catalog[member]["addresses"]}
            addresses.update(normalize_address(c.get("email")) for c in (family.contacts or []) if isinstance(c, dict))
            addresses.update(normalize_address(value) for value in (
                family.billing_email, family.primary_parent.email if family.primary_parent_id else "",
                family.secondary_parent.email if family.secondary_parent_id else ""))
        identity = {"id": str(family.pk), "name": str(family), "addresses": []}
    else:
        if sid not in catalog:
            return None
        member_ids = {sid}
        addresses = set(catalog[sid]["addresses"])
        identity = catalog[sid]
    addresses = sorted(a for a in addresses if a and not a.endswith(".invalid"))
    if not isinstance(offset, int) or not isinstance(limit, int) or (
        offset < 0 or offset > 1_000_000 or limit < 1 or limit > 100
    ):
        raise ValueError("Ungültige Seitenauswahl.")

    through = offset + limit + 1
    base_mail = MailMessageCache.objects.filter(
        folder_cache__studio=studio,
        folder_cache__owner=owner,
        folder_cache__account_key=account_key,
    ).exclude(folder_cache__folder="drafts").select_related(
        "folder_cache"
    ).order_by("-date", "-uid")
    base_drafts = MailDraft.objects.filter(
        studio=studio, owner=owner, account_key=account_key,
    ).annotate(
        has_local_attachment=Exists(
            MailDraftAttachment.objects.filter(draft_id=OuterRef("pk"))
        )
    ).order_by("-updated_at", "-id")

    if connection.vendor == "postgresql":
        # PostgreSQL JSONB containment keeps large mailboxes fast: filter
        # recipients in SQL before ordering and paging the combined result.
        address_queries = Q(pk__in=[])
        for address in addresses:
            address_queries |= Q(contact_addresses__contains=[address])
            address_queries |= Q(email__iexact=address)
        manual_query = Q(pk__in=[])
        draft_query = Q(pk__in=[])
        for member in member_ids:
            manual_query |= Q(manual_student_ids__contains=[member])
            draft_query |= Q(student_ids__contains=[member])
        mail_qs = base_mail.filter(manual_query |
            (Q(manual_student_ids__isnull=True) & address_queries))
        for address in addresses:
            draft_query |= Q(recipient__iexact=address)
            draft_query |= Q(additional_recipient__iexact=address)
        draft_qs = base_drafts.filter(draft_query)
        mail_total = mail_qs.count()
        sent_count = mail_qs.filter(folder_cache__folder="sent").count()
        draft_total = draft_qs.count()
        mail_rows = list(mail_qs[:through])
        draft_rows = list(draft_qs[:through])
    else:
        # SQLite does not support JSONField__contains. This fallback also
        # lets local tests exercise precisely the same association semantics.
        mail_matches = [
            row for row in base_mail.iterator(chunk_size=500)
            if ((row.manual_student_ids is not None and bool(member_ids.intersection(str(v) for v in row.manual_student_ids))) or
                (row.manual_student_ids is None and bool(set(addresses).intersection(normalize_address(a) for a in (row.contact_addresses or [row.email])))))
        ]
        mail_total = len(mail_matches)
        sent_count = sum(row.folder_cache.folder == "sent" for row in mail_matches)
        mail_rows = mail_matches[:through]
        address_set = set(addresses)
        draft_matches = [
            draft for draft in base_drafts.iterator(chunk_size=500)
            if member_ids.intersection(str(value) for value in draft.student_ids) or
            normalize_address(draft.recipient) in address_set or
            normalize_address(draft.additional_recipient) in address_set
        ]
        draft_total = len(draft_matches)
        draft_rows = draft_matches[:through]

    total = mail_total + draft_total
    merged = []
    for record in mail_rows:
        folder = record.folder_cache.folder
        merged.append({
            "folder": folder,
            "uid": str(record.uid),
            "category": "sent" if folder == "sent" else "received",
            "from": record.sender_name,
            "email": record.email,
            "subject": record.subject,
            "date": record.date,
            "preview": record.preview,
            "unread": record.unread,
            "has_attachment": record.has_attachment,
        })

    for draft in draft_rows:
        merged.append({
            "folder": "drafts",
            "uid": str(draft.pk),
            "category": "draft",
            "from": "Entwurf an: " + (draft.recipient or "Empfänger noch offen"),
            "email": draft.recipient,
            "subject": draft.subject or "(Ohne Betreff)",
            "date": draft.updated_at.isoformat(),
            "preview": draft.body[:160],
            "unread": False,
            "has_attachment": bool(draft.resource_ids or draft.has_local_attachment),
        })

    merged.sort(
        key=lambda item: (_sort_timestamp(item["date"]), item["folder"], item["uid"]),
        reverse=True,
    )
    return {
        "student": identity,
        "messages": merged[offset:offset + limit],
        "total": total,
        "offset": offset,
        "limit": limit,
        "has_more": offset + limit < total,
        "counts": {
            "received": mail_total - sent_count,
            "sent": sent_count,
            "draft": draft_total,
        },
    }
