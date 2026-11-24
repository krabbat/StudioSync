"""Owner-private, PostgreSQL-persistent mail drafts including device attachments."""

import json
import uuid

from django.db import transaction
from django.http import HttpResponse
from django.utils.http import content_disposition_header

from apps.core.mail_cache import mailbox_account_key
from apps.core.mail_outbound import (
    MAX_ATTACHMENTS, MAX_BODY, MAX_SUBJECT, MailSendError,
    _collect_attachments, _valid_email,
)
from apps.core.mail_associations import student_catalog
from apps.core.models import MailDraft, MailDraftAttachment, Student
from apps.resources.models import Resource


def draft_queryset(studio, owner, config):
    return MailDraft.objects.filter(
        studio=studio, owner=owner, account_key=mailbox_account_key(config),
    )


def _parse_ids(raw, name):
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError) as exc:
            raise MailSendError(f"Ungültige {name}.") from exc
    if not isinstance(raw, list) or len(raw) > 250:
        raise MailSendError(f"Ungültige {name}.")
    return list(dict.fromkeys(str(value) for value in raw))


def draft_summary(draft, catalog=None):
    selected = [catalog[str(sid)] for sid in draft.student_ids
                if catalog and str(sid) in catalog]
    names = [student["name"] for student in selected]
    instruments = sorted({
        name for student in selected for name in student["instruments"]
    })
    return {
        "id": str(draft.pk),
        "from": "Entwurf",
        "email": draft.recipient,
        "subject": draft.subject or "(Ohne Betreff)",
        "date": draft.updated_at.isoformat(),
        "unread": False,
        "starred": False,
        "preview": draft.body[:160],
        "attachments": [
            row.filename for row in draft.local_attachments.all()
        ],
        "has_attachment": bool(draft.local_attachments.all() or draft.resource_ids),
        "student": ", ".join(names),
        "student_ids": [str(sid) for sid in draft.student_ids],
        "student_names": names,
        "instruments": instruments,
        "instrument": ", ".join(instruments),
    }


def list_drafts(studio, owner, config, offset=0, limit=40):
    qs = draft_queryset(studio, owner, config).prefetch_related("local_attachments")
    total = qs.count()
    catalog, _ = student_catalog(studio)
    records = list(qs[offset:offset + limit])
    return {
        "messages": [draft_summary(draft, catalog) for draft in records],
        "total": total,
        "has_more": offset + len(records) < total,
        "offset": offset,
        "limit": limit,
        "uidvalidity": None,
        "syncing": False,
        "synced": True,
        "last_synced_at": None,
        "cached_ids": [str(draft.pk) for draft in records],
    }


def get_draft(draft, studio):
    resources = {
        str(resource.pk): resource
        for resource in Resource.objects.filter(
            studio=studio, pk__in=draft.resource_ids,
        ).exclude(file="").exclude(file__isnull=True)
    }
    return {
        "id": str(draft.pk),
        "recipient": draft.recipient,
        "additional_recipient": draft.additional_recipient,
        "student_ids": [str(sid) for sid in draft.student_ids],
        "resource_ids": [str(sid) for sid in draft.resource_ids],
        "resources": [{
            "id": str(resource.pk),
            "title": resource.title,
            "filename": resource.file.name.rsplit("/", 1)[-1],
            "size": resource.file_size,
            "mime_type": resource.mime_type,
            "folder_name": resource.folder.name if resource.folder else "",
        } for resource_id in draft.resource_ids
          if (resource := resources.get(str(resource_id))) is not None],
        "subject": draft.subject,
        "body": draft.body,
        "local_attachments": [{
            "id": str(attachment.pk),
            "filename": attachment.filename,
            "mime_type": attachment.content_type,
            "size": len(attachment.payload),
        } for attachment in draft.local_attachments.all()],
    }


def save_draft(studio, owner, config, data, uploads):
    subject = data.get("subject") or ""
    body = data.get("body") or ""
    recipient = data.get("manual_recipient") or ""
    additional = data.get("additional_recipient") or ""
    for item in (subject, body, recipient, additional):
        if not isinstance(item, str):
            raise MailSendError("Ungültiger Entwurfsinhalt.")
    if len(subject) > MAX_SUBJECT or len(body) > MAX_BODY:
        raise MailSendError("Entwurf überschreitet die erlaubte Textlänge.")
    if recipient and not _valid_email(recipient):
        raise MailSendError("Die Empfängeradresse ist ungültig.")
    if additional and not _valid_email(additional):
        raise MailSendError("Die zusätzliche Adresse ist ungültig.")

    student_ids = _parse_ids(data.get("student_ids", "[]"), "Schülerauswahl")
    resource_ids = _parse_ids(data.get("resource_ids", "[]"), "Dateiauswahl")
    try:
        student_ids = [str(uuid.UUID(item)) for item in student_ids]
        resource_ids = [str(uuid.UUID(item)) for item in resource_ids]
    except (ValueError, TypeError, AttributeError) as exc:
        raise MailSendError("Ungültige Schüler- oder Dateikennung.") from exc
    known_students = set(str(pk) for pk in Student.objects.filter(
        studio=studio, pk__in=student_ids
    ).values_list("pk", flat=True))
    if len(known_students) != len(student_ids):
        raise MailSendError("Ein ausgewählter Schüler existiert nicht mehr.")

    # Size-check all data, including resources; save only local upload bytes.
    if len(uploads) + len(resource_ids) > MAX_ATTACHMENTS:
        raise MailSendError("Maximal acht Anhänge pro Entwurf sind erlaubt.")
    files = _collect_attachments(uploads, studio, resource_ids)
    local_payloads = files[:len(uploads)]

    identifier = data.get("draft_id")
    if identifier:
        try:
            identifier = uuid.UUID(str(identifier))
        except (ValueError, AttributeError, TypeError) as exc:
            raise MailSendError("Ungültiger Entwurf.") from exc
    with transaction.atomic():
        if identifier:
            draft = draft_queryset(studio, owner, config).filter(pk=identifier).first()
            if draft is None:
                raise MailSendError("Der Entwurf ist nicht mehr vorhanden.")
        else:
            draft = MailDraft(
                studio=studio, owner=owner, account_key=mailbox_account_key(config),
            )
        draft.recipient = recipient
        draft.additional_recipient = additional
        draft.student_ids = student_ids
        draft.resource_ids = resource_ids
        draft.subject = subject
        draft.body = body
        draft.save()
        draft.local_attachments.all().delete()
        MailDraftAttachment.objects.bulk_create([
            MailDraftAttachment(
                draft=draft, filename=name, payload=payload, content_type=mime,
            ) for name, payload, mime in local_payloads
        ])
    return get_draft(draft, studio)


def draft_file_response(draft, file_id):
    attachment = draft.local_attachments.filter(pk=file_id).first()
    if attachment is None:
        return None
    response = HttpResponse(bytes(attachment.payload),
                            content_type=attachment.content_type)
    response["Content-Disposition"] = content_disposition_header(
        as_attachment=True, filename=attachment.filename,
    )
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    return response
