"""Tenant-scoped automatic and manual association of cached mails with students.

Matching includes student, both parents, family billing and individual billing
contacts. Shared family addresses intentionally associate siblings; the admin can
override an ambiguous message without altering the other messages.
"""

from collections import defaultdict
from email.utils import getaddresses

from apps.core.models import MailMessageCache, Student


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
        addresses = [student.user.email]
        if student.family_id:
            family = student.family
            addresses.extend([
                family.primary_parent.email if family.primary_parent else "",
                family.secondary_parent.email if family.secondary_parent else "",
                family.billing_email,
            ])
        billing_profile = getattr(student, "billing_profile", None)
        if billing_profile:
            addresses.append(billing_profile.recipient_email)
        safe_addresses = sorted({
            value for item in addresses if (value := normalize_address(item))
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


def mail_student_overview(studio, owner, account_key, student_id, limit=25):
    """Overview is a bounded snapshot; link opens the real filtered mailclient."""
    catalog, by_address = student_catalog(studio)
    if str(student_id) not in catalog:
        return None
    from apps.core.models import MailMessageCache

    matches = []
    rows = MailMessageCache.objects.filter(
        folder_cache__studio=studio,
        folder_cache__owner=owner,
        folder_cache__account_key=account_key,
    ).exclude(folder_cache__folder__in=["spam", "trash"]).select_related(
        "folder_cache"
    ).order_by("-date", "-uid")[:5000]
    for record in rows:
        if str(student_id) not in assigned_student_ids(record, catalog, by_address):
            continue
        matches.append({
            "folder": record.folder_cache.folder,
            "uid": str(record.uid),
            "from": record.sender_name,
            "email": record.email,
            "subject": record.subject,
            "date": record.date,
            "preview": record.preview,
            "unread": record.unread,
            "has_attachment": record.has_attachment,
        })
        if len(matches) >= limit:
            break
    return {"student": catalog[str(student_id)], "messages": matches}
