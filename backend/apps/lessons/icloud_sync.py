"""Bidirectional iCloud CalDAV synchronization for MUSart teaching lessons.

One iCloud VEVENT UID maps to a series and one RECURRENCE-ID maps to one
lesson. This module never sends lesson notification emails on import, since
bulk_create/QuerySet.update bypass the standard post_save signal.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone as utc_timezone
from hashlib import sha256
from zoneinfo import ZoneInfo
import json
import re
import uuid

from dateutil.rrule import rrulestr
from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone
from icalendar import Calendar, Event

from apps.core.models import Student, Teacher, User, Family, TeachingGroup
from apps.core.views.icloud_calendar import (
    ICloudSetupError, _allowed_calendar_url, _connect, _credentials, _discover,
    _settings,
)
from apps.lessons.models import (
    ICloudCalendarOccurrence, ICloudCalendarSeries, Lesson, LessonParticipant,
)

WINDOW_BEFORE = 35
WINDOW_AFTER = 370
LOCAL_TZ = ZoneInfo("Europe/Berlin")
COMPLETED_STATUSES = {"completed", "in_progress", "no_show"}


def _dt(value):
    """Return an aware datetime; all-day calendar items are not lessons."""
    if not isinstance(value, datetime):
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, LOCAL_TZ)
    return value


def _key(value):
    return _dt(value).astimezone(utc_timezone.utc).replace(microsecond=0).isoformat()


def _raw(value):
    return value.decode("utf-8") if isinstance(value, bytes) else str(value)


def _hash(value):
    return sha256(value.encode("utf-8")).hexdigest()


def _lesson_signature(lesson):
    values = [
        lesson.scheduled_start.astimezone(utc_timezone.utc).isoformat(),
        lesson.scheduled_end.astimezone(utc_timezone.utc).isoformat(),
        lesson.status, lesson.location or "", lesson.summary or "",
        str(lesson.student_id or ""), str(lesson.teacher_id),
    ]
    # Preserve existing signatures for regular students so introducing guest
    # fields does not make every old appointment look locally modified.
    if lesson.guest_name or lesson.guest_address:
        values.extend([lesson.guest_name or "", lesson.guest_address or ""])
    if lesson.teaching_family_id or lesson.teaching_group_id:
        values.extend([str(lesson.teaching_family_id or ""), str(lesson.teaching_group_id or ""),
                       lesson.group_ha_zone, lesson.group_name_snapshot])
    return _hash(json.dumps(values, ensure_ascii=False))


def group_snapshot(lesson):
    if not (lesson.teaching_family_id or lesson.teaching_group_id):
        return {}
    return {"family":str(lesson.teaching_family_id or ""), "group":str(lesson.teaching_group_id or ""),
            "name":lesson.group_name_snapshot, "zone":lesson.group_ha_zone, "is_online":lesson.is_online, "online_meeting_url":lesson.online_meeting_url,
            "members":[{"id":str(p.student_id),"name":p.name_snapshot} for p in lesson.participants.all()]}


def group_fields(series):
    booking = series.group_booking
    if not booking:
        return {}
    family = Family.objects.filter(pk=booking["family"],studio=series.studio).first() if booking["family"] else None
    group = TeachingGroup.objects.filter(pk=booking["group"],studio=series.studio).first() if booking["group"] else None
    if bool(family) == bool(group):
        raise ICloudSetupError("Ungültige Gruppen-Zuordnung.")
    ids = [m["id"] for m in booking["members"]]
    if len(ids)<2 or Student.objects.filter(studio=series.studio,pk__in=ids).count()!=len(ids):
        raise ICloudSetupError("Ungültige Gruppen-Teilnehmerliste.")
    return {"teaching_family":family,"teaching_group":group,"group_name_snapshot":booking["name"],
            "group_ha_zone":booking["zone"],"lesson_type":"group","is_online":booking.get("is_online",False),"online_meeting_url":booking.get("online_meeting_url","")}


def _master_and_overrides(content):
    data = Calendar.from_ical(content.encode("utf-8") if isinstance(content, str) else content)
    events = [part for part in data.walk() if part.name == "VEVENT"]
    masters = [part for part in events if not part.get("RECURRENCE-ID")]
    if len(masters) != 1:
        raise ICloudSetupError("Kalendereintrag enthält keine eindeutige Terminserie.")
    master = masters[0]
    if not master.get("UID") or not master.get("DTSTART"):
        raise ICloudSetupError("Kalendereintrag enthält keine UID oder Startzeit.")
    return data, master, {
        _key(part["RECURRENCE-ID"].dt): part
        for part in events if part.get("RECURRENCE-ID") and _dt(part["RECURRENCE-ID"].dt)
    }


def _expand(content, now=None):
    _, master, overrides = _master_and_overrides(content)
    start = _dt(master["DTSTART"].dt)
    if start is None:
        return []
    end = _dt(master["DTEND"].dt) if master.get("DTEND") else None
    duration = (end - start) if end else timedelta(minutes=45)
    if duration <= timedelta(0):
        return []
    now = now or timezone.now()
    low, high = now - timedelta(days=WINDOW_BEFORE), now + timedelta(days=WINDOW_AFTER)
    original_starts = []
    rule = master.get("RRULE")
    if rule:
        recurrence = rrulestr(_raw(rule.to_ical()), dtstart=start)
        original_starts = list(recurrence.between(low, high, inc=True))
    elif low <= start <= high:
        original_starts = [start]

    for rdate in master.get("RDATE", []) if isinstance(master.get("RDATE"), list) else ([master.get("RDATE")] if master.get("RDATE") else []):
        original_starts += [_dt(v.dt) for v in rdate.dts if _dt(v.dt) and low <= _dt(v.dt) <= high]

    excluded = set()
    ex = master.get("EXDATE", [])
    for item in ex if isinstance(ex, list) else ([ex] if ex else []):
        excluded.update(_key(v.dt) for v in item.dts if _dt(v.dt))

    result = {}
    for original in original_starts:
        rid = _key(original)
        override = overrides.get(rid)
        candidate = override or master
        # The master's DTSTART/DTEND define only the FIRST occurrence.
        # Every following instance uses the RRULE-generated start plus
        # the master duration, unless that instance has an override.
        changed_start = (
            _dt(override["DTSTART"].dt)
            if override is not None and override.get("DTSTART")
            else original
        )
        changed_end = (
            _dt(override["DTEND"].dt)
            if override is not None and override.get("DTEND")
            else changed_start + duration
        )
        cancelled = rid in excluded or _raw(candidate.get("STATUS", "")).upper() == "CANCELLED"
        result[rid] = {
            "rid": rid, "start": changed_start, "end": changed_end,
            "cancelled": cancelled,
            "title": _raw(candidate.get("SUMMARY", master.get("SUMMARY", ""))),
            "location": _raw(candidate.get("LOCATION", master.get("LOCATION", ""))),
            "description": _raw(candidate.get("DESCRIPTION", master.get("DESCRIPTION", ""))),
        }

    # An exception can move a remote occurrence into this window even if its
    # original timestamp is outside the master expansion window.
    for rid, override in overrides.items():
        if rid in result:
            continue
        altered = _dt(override["DTSTART"].dt) if override.get("DTSTART") else None
        if altered and low <= altered <= high:
            altered_end = _dt(override["DTEND"].dt) if override.get("DTEND") else altered + duration
            result[rid] = {
                "rid": rid, "start": altered, "end": altered_end,
                "cancelled": _raw(override.get("STATUS", "")).upper() == "CANCELLED",
                "title": _raw(override.get("SUMMARY", master.get("SUMMARY", ""))),
                "location": _raw(override.get("LOCATION", master.get("LOCATION", ""))),
                "description": _raw(override.get("DESCRIPTION", master.get("DESCRIPTION", ""))),
            }
    return [result[key] for key in sorted(result)]


def _student_from_title(studio, title):
    """Link only unambiguous full names, never fuzzy surname-only matches."""
    folded = title.casefold()
    matches = []
    for student in Student.objects.filter(studio=studio).select_related("user"):
        name = student.user.get_full_name().strip()
        if name and re.search(r"(?<!\w)" + re.escape(name.casefold()) + r"(?!\w)", folded):
            matches.append(student)
    return matches[0] if len(matches) == 1 else None


def _default_teacher(studio):
    qs = Teacher.objects.filter(studio=studio).select_related("user")
    return (qs.filter(user__first_name__iexact="Peter", user__last_name__iexact="Sartori").first()
            or qs.first())


def _resolve_student(series, master):
    if series.student_id:
        return series.student
    student_id = _raw(master.get("X-STUDIOSYNC-STUDENT-ID", "")).strip()
    if student_id:
        return Student.objects.filter(pk=student_id, studio=series.studio).first()
    return _student_from_title(series.studio, series.title)


def _conflict(lesson, student, teacher, start, end, participant_ids=()):
    """Return the actual blocking lesson, not only a boolean.

    Any overlapping lesson with the same teacher OR student is a collision.
    Exclude the exact linked lesson being updated.
    """
    overlapping = Lesson.objects.filter(
        studio=teacher.studio, status__in=["scheduled", "in_progress"],
        scheduled_start__lt=end, scheduled_end__gt=start,
    ).filter(Q(teacher=teacher) | (Q(student=student)|Q(participants__student=student) if student else Q(pk__isnull=True)) | Q(student_id__in=participant_ids) | Q(participants__student_id__in=participant_ids)).distinct()
    if lesson is not None:
        overlapping = overlapping.exclude(pk=lesson.pk)
    return overlapping.select_related(
        "teacher__user", "student__user", "band"
    ).order_by("scheduled_start").first()


def _collision_detail(series, incoming, blocking):
    """Show both calendar times, the actual blocking student and lesson ID."""
    start = timezone.localtime(incoming["start"], LOCAL_TZ)
    end = timezone.localtime(incoming["end"], LOCAL_TZ)
    existing_start = timezone.localtime(blocking.scheduled_start, LOCAL_TZ)
    existing_end = timezone.localtime(blocking.scheduled_end, LOCAL_TZ)
    other_name = (
        blocking.student.user.get_full_name()
        if blocking.student_id else
        blocking.band.name if blocking.band_id else "Sonstiger Unterrichtstermin"
    )
    cause = (
        "Lehrkraft bereits belegt"
        if blocking.teacher_id == series.teacher_id
        else "Schüler bereits belegt"
    )
    return (
        f"Terminkollision: iCloud \"{incoming['title']}\" "
        f"{start:%d.%m.%Y} {start:%H:%M}–{end:%H:%M} Uhr; "
        f"StudioSync \"{other_name}\" "
        f"{existing_start:%d.%m.%Y} "
        f"{existing_start:%H:%M}–{existing_end:%H:%M} Uhr "
        f"({cause}, Termin-ID {blocking.pk})."
    )


def _set_error(series, message):
    series.last_error = message
    series.save(update_fields=["last_error", "updated_at"])


def _cancel_icloud_deleted_occurrence(link, stats):
    """Preserve a remotely deleted appointment in StudioSync as red/cancelled.

    Retain the Lesson and its stable iCloud link so a future poll cannot
    re-export the removed VEVENT. Never alter documented or paid attendance.
    """
    lesson = link.lesson
    if lesson is None:
        return False
    if lesson.is_paid or lesson.status in COMPLETED_STATUSES:
        return False
    if lesson.status != "cancelled":
        Lesson.objects.filter(pk=lesson.pk).update(
            status="cancelled", cancelled_at=timezone.now()
        )
        lesson.status = "cancelled"
        stats["cancelled"] = stats.get("cancelled", 0) + 1
    link.synced_signature = _lesson_signature(lesson)
    link.save(update_fields=["synced_signature", "updated_at"])
    return True


def _import_series(user, studio, calendar_url, remote_event, stats):
    raw = _raw(remote_event.data)
    _, master, _ = _master_and_overrides(raw)
    uid = str(master["UID"])
    remote_url = str(remote_event.url)
    _allowed_calendar_url(remote_url)

    series, made = ICloudCalendarSeries.objects.get_or_create(
        user=user, calendar_url=calendar_url, uid=uid,
        defaults={"studio": studio, "remote_url": remote_url}
    )
    remote_hash = _hash(raw)
    remote_is_unchanged = not made and remote_hash == series.remote_hash
    dirty = [
        entry for entry in series.occurrences.select_related("lesson")
        if entry.lesson and entry.synced_signature and
        _lesson_signature(entry.lesson) != entry.synced_signature
    ]
    if not made and remote_hash != series.remote_hash and dirty:
        # An explicit Apple deletion is a local cancellation, including when
        # the same occurrence had pending edits in StudioSync.
        deleted_recurrences = {
            event["rid"] for event in _expand(raw) if event["cancelled"]
        }
        for link in dirty:
            if link.recurrence_id in deleted_recurrences:
                _cancel_icloud_deleted_occurrence(link, stats)
        if any(link.recurrence_id not in deleted_recurrences for link in dirty):
            _set_error(series, "Konflikt: Termin wurde gleichzeitig in Apple und StudioSync geändert.")
            stats["conflicts"] += 1
            return series
    # When only StudioSync has changed, DO NOT return early and leave a
    # previously recorded collision in place. Recheck all other occurrences,
    # but preserve locally edited ones for the subsequent CalDAV push.
    locally_changed = {
        entry.lesson_id for entry in dirty
        if not made and remote_hash == series.remote_hash
    }

    series.remote_url = remote_url
    series.ical_data = raw
    series.remote_hash = remote_hash
    series.title = _raw(master.get("SUMMARY", ""))[:500]
    series.location = _raw(master.get("LOCATION", ""))[:500]
    series.last_synced_at = timezone.now()
    series.last_error = ""
    if not series.teacher_id:
        teacher_id = _raw(master.get("X-STUDIOSYNC-TEACHER-ID", "")).strip()
        teacher = None
        if teacher_id:
            try:
                teacher = Teacher.objects.filter(pk=uuid.UUID(teacher_id), studio=studio).first()
            except ValueError:
                pass
        series.teacher = teacher or _default_teacher(studio)
    guest_marker = _raw(master.get("X-STUDIOSYNC-GUEST-NAME", "")).strip()
    guest_name = (
        _raw(master.get("SUMMARY", guest_marker)).strip()[:200]
        if guest_marker else ""
    )
    guest_address = (
        _raw(master.get("LOCATION", "")).strip()
        or _raw(master.get("X-STUDIOSYNC-GUEST-ADDRESS", "")).strip()
    )[:500]
    grouped = bool(series.group_booking)
    if not grouped and master.get("X-STUDIOSYNC-GROUP-BOOKING"):
        _set_error(series, "Gruppentermin ohne lokale Zuordnung; bitte in StudioSync prüfen.")
        stats["unassigned"] += 1
        return series
    fields = group_fields(series) if grouped else {}
    participant_ids = [m["id"] for m in series.group_booking.get("members", [])]
    if grouped or guest_name:
        series.student = None
    elif not series.student_id:
        series.student = _resolve_student(series, master)
    series.save()
    if (not series.student_id and not guest_name and not grouped) or not series.teacher_id:
        _set_error(series, "Schüler zuordnen" if not series.student_id and not guest_name else "Keine Lehrkraft vorhanden")
        stats["unassigned"] += 1
        return series

    expected = _expand(raw)
    present = set()
    collisions = []
    for entry in expected:
        rid, start, end = entry["rid"], entry["start"], entry["end"]
        present.add(rid)
        if not start or not end or start >= end:
            continue
        link, created = ICloudCalendarOccurrence.objects.get_or_create(
            series=series, recurrence_id=rid
        )
        lesson = link.lesson
        if entry["cancelled"]:
            # EXDATE / cancelled VEVENT: remove it from Apple, but retain the
            # StudioSync lesson, unchanged identity, and red cancelled status.
            _cancel_icloud_deleted_occurrence(link, stats)
            continue
        if (
            remote_is_unchanged
            and lesson is not None
            and link.synced_signature
            and link.synced_signature == _lesson_signature(lesson)
        ):
            # Both copies already agree: don't rewrite an unrelated lesson's
            # status, cancellation details or timestamps on every full sync.
            continue
        if not lesson and link.synced_signature:
            # A previously linked StudioSync lesson was deleted locally.
            # Do not recreate it on the next pull; export a cancelled exception.
            continue
        if not lesson and not entry["cancelled"]:
            # Attach an existing local lesson before creating a new one.
            matching = None if grouped else Lesson.objects.filter(
                studio=studio, student=series.student, teacher=series.teacher,
                teaching_family__isnull=True, teaching_group__isnull=True,
                guest_name=guest_name, scheduled_start=start, scheduled_end=end,
            ).exclude(icloud_occurrence__isnull=False).first()
            if matching:
                lesson = matching
            else:
                blocking = _conflict(None, series.student, series.teacher, start, end, participant_ids)
                if blocking:
                    collisions.append(_collision_detail(series, entry, blocking))
                    stats["conflicts"] += 1
                    continue
                lesson = Lesson(
                    studio=studio, student=series.student, teacher=series.teacher,
                    guest_name=guest_name, guest_address=guest_address,
                    scheduled_start=start, scheduled_end=end, status="scheduled",
                    location=entry["location"][:200], summary=entry["description"][:5000],
                    **(fields if grouped else {"lesson_type":"private"}),
                )
                # Never call save(): that would send one email per imported lesson.
                with transaction.atomic():
                    Lesson.objects.bulk_create([lesson])
                    if grouped:
                        LessonParticipant.objects.bulk_create([LessonParticipant(lesson=lesson,student_id=m["id"],name_snapshot=m["name"]) for m in series.group_booking["members"]])
                    link.lesson=lesson
                    link.save()
                stats["imported"] += 1
            link.lesson = lesson
        if lesson:
            if lesson.pk in locally_changed and lesson.status not in COMPLETED_STATUSES:
                # Remote event is unchanged. Do not undo a local move:
                # _push_changes will emit the matching RECURRENCE-ID override.
                continue
            if lesson.status in COMPLETED_STATUSES:
                # Accounting history is authoritative, not the calendar.
                link.synced_signature = _lesson_signature(lesson)
            else:
                blocking = (
                    _conflict(lesson, series.student, series.teacher, start, end, list(lesson.participants.values_list("student_id",flat=True)) if grouped else ())
                    if not entry["cancelled"] else None
                )
                if blocking:
                    collisions.append(_collision_detail(series, entry, blocking))
                    stats["conflicts"] += 1
                    continue
                changes = {
                    "scheduled_start": start, "scheduled_end": end,
                    "location": entry["location"][:200],
                    "summary": entry["description"][:5000],
                    "guest_name": guest_name,
                    "guest_address": guest_address,
                    "status": "scheduled",
                }
                Lesson.objects.filter(pk=lesson.pk).update(**changes)
                for key, value in changes.items():
                    setattr(lesson, key, value)
                link.synced_signature = _lesson_signature(lesson)
        link.save()

    for link in series.occurrences.select_related("lesson"):
        if link.recurrence_id in present or not link.lesson:
            continue
        lesson = link.lesson
        if (timezone.now() - timedelta(days=WINDOW_BEFORE) <= lesson.scheduled_start
                <= timezone.now() + timedelta(days=WINDOW_AFTER)):
            # RRULE truncated in Apple: keep the occurrence as a red cancellation
            # in StudioSync, including its student and notes.
            _cancel_icloud_deleted_occurrence(link, stats)
    if collisions:
        shown = collisions[:5]
        if len(collisions) > 5:
            shown.append(f"... sowie {len(collisions) - 5} weitere Überschneidungen.")
        _set_error(series, "\n".join(shown))
    return series


def _ical_for_lesson(lesson):
    ical = Calendar()
    ical.add("prodid", "-//MUSart StudioSync//iCloud//DE")
    ical.add("version", "2.0")
    event = Event()
    event.add("uid", f"studiosync-{lesson.id}@musart.de")
    event.add("dtstamp", timezone.now())
    event.add("dtstart", lesson.scheduled_start.astimezone(LOCAL_TZ))
    event.add("dtend", lesson.scheduled_end.astimezone(LOCAL_TZ))
    event.add("summary", lesson.student.user.get_full_name() if lesson.student_id else (lesson.group_name_snapshot or lesson.guest_name or "MUSart Unterricht"))
    event.add("location", lesson.guest_address or lesson.location or "")
    if lesson.guest_name and not lesson.student_id:
        event.add("X-STUDIOSYNC-GUEST-NAME", lesson.guest_name)
        if lesson.guest_address:
            event.add("X-STUDIOSYNC-GUEST-ADDRESS", lesson.guest_address)
    if lesson.teaching_family_id or lesson.teaching_group_id:
        event.add("X-STUDIOSYNC-GROUP-BOOKING", "1")
    if lesson.summary:
        event.add("description", lesson.summary)
    if lesson.student_id:
        event.add("X-STUDIOSYNC-STUDENT-ID", str(lesson.student_id))
    event.add("X-STUDIOSYNC-TEACHER-ID", str(lesson.teacher_id))
    if lesson.status == "cancelled":
        event.add("status", "CANCELLED")
    ical.add_component(event)
    return ical.to_ical().decode("utf-8")


def _set_property(event, key, value):
    if key in event:
        del event[key]
    event.add(key.lower(), value)


def _push_changes(series, remote, stats):
    # Recheck the remote revision immediately before writing local edits.
    remote.load()
    raw = _raw(remote.data)
    if _hash(raw) != series.remote_hash:
        _set_error(series, "Konflikt: iCloud wurde nach dem letzten Abgleich verändert.")
        stats["conflicts"] += 1
        return

    cal, master, overrides = _master_and_overrides(raw)
    recurring = bool(master.get("RRULE") or master.get("RDATE"))

    # A locally deleted stand-alone lesson stays as "cancelled" in StudioSync,
    # but its matching resource must disappear from Apple entirely.
    if not recurring:
        links = list(series.occurrences.select_related("lesson"))
        if links and any(
            link.lesson is not None and link.lesson.status == "cancelled"
            and (
                link.synced_signature == "pending-delete"
                or link.synced_signature != _lesson_signature(link.lesson)
            )
            for link in links
        ):
            remote.delete()
            series.last_error = (
                "Terminserie in iCloud gelöscht; Unterrichtstermin in StudioSync als abgesagt erhalten."
            )
            series.last_synced_at = timezone.now()
            series.save(update_fields=["last_error", "last_synced_at", "updated_at"])
            for link in links:
                if link.lesson_id:
                    link.synced_signature = _lesson_signature(link.lesson)
                    link.save(update_fields=["synced_signature", "updated_at"])
            stats["exported"] += 1
            return

    modified_links = []
    for entry in series.occurrences.select_related("lesson"):
        lesson = entry.lesson
        removed = (
            lesson is not None and lesson.status == "cancelled"
            and (
                entry.synced_signature == "pending-delete"
                or entry.synced_signature != _lesson_signature(lesson)
            )
        )
        if lesson is None:
            # Old tombstones from previous deployments must not be re-uploaded.
            continue
        if lesson is not None and _lesson_signature(lesson) == entry.synced_signature:
            continue
        if lesson is not None and lesson.status in COMPLETED_STATUSES:
            # Calendar never controls the teaching/accounting classification.
            entry.synced_signature = _lesson_signature(lesson)
            entry.save(update_fields=["synced_signature", "updated_at"])
            continue
        if removed and recurring:
            recurrence_day = datetime.fromisoformat(entry.recurrence_id).astimezone(LOCAL_TZ)
            master.add("exdate", recurrence_day)
            existing = overrides.get(entry.recurrence_id)
            if existing is not None:
                cal.subcomponents[:] = [
                    component for component in cal.subcomponents
                    if component is not existing
                ]
            modified_links.append(entry)
            continue
        if recurring:
            override = overrides.get(entry.recurrence_id)
            if override is None:
                override = Event()
                override.add("uid", series.uid)
                override.add("summary", series.title or "MUSart Unterricht")
                override.add("recurrence-id", datetime.fromisoformat(entry.recurrence_id).astimezone(LOCAL_TZ))
                cal.add_component(override)
            target = override
        else:
            target = master
        if removed:
            # Never write a cancellation event: this particular iCloud
            # occurrence is removed from the recurring series via EXDATE.
            continue
        else:
            if lesson.student_id != series.student_id:
                _set_error(series, "Schülerwechsel bitte über die Serienzuordnung vornehmen.")
                stats["conflicts"] += 1
                return
            _set_property(target, "DTSTART", lesson.scheduled_start.astimezone(LOCAL_TZ))
            _set_property(target, "DTEND", lesson.scheduled_end.astimezone(LOCAL_TZ))
            _set_property(target, "LOCATION", lesson.guest_address or lesson.location or "")
            _set_property(target, "DESCRIPTION", lesson.summary or "")
            if lesson.guest_name and not lesson.student_id:
                _set_property(target, "SUMMARY", lesson.guest_name)
                _set_property(target, "X-STUDIOSYNC-GUEST-NAME", lesson.guest_name)
                _set_property(target, "X-STUDIOSYNC-GUEST-ADDRESS", lesson.guest_address or "")
            _set_property(target, "STATUS", "CANCELLED" if lesson.status == "cancelled" else "CONFIRMED")
        _set_property(target, "DTSTAMP", timezone.now())
        modified_links.append(entry)

    if not modified_links:
        return
    remote.data = cal.to_ical().decode("utf-8")
    remote.save()
    remote.load()
    series.ical_data = _raw(remote.data)
    series.remote_hash = _hash(series.ical_data)
    series.last_synced_at = timezone.now()
    series.last_error = ""
    series.save(update_fields=["ical_data", "remote_hash", "last_synced_at", "last_error", "updated_at"])
    for link in modified_links:
        link.synced_signature = _lesson_signature(link.lesson) if link.lesson else "deleted"
        link.save(update_fields=["synced_signature", "updated_at"])
        stats["exported"] += 1


@contextmanager
def _icloud_lock(user):
    """One lock shared by sync jobs and series edits."""
    if connection.vendor != "postgresql":
        yield
        return
    lock_id = int.from_bytes(
        sha256(("musart-icloud:" + str(user.pk)).encode()).digest()[:8],
        byteorder="big", signed=True,
    )
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(%s)", [lock_id])
        acquired = cursor.fetchone()[0]
    if not acquired:
        raise ICloudSetupError("Der iCloud-Abgleich läuft bereits. Bitte erneut versuchen.")
    try:
        yield
    finally:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_unlock(%s)", [lock_id])


def sync_icloud_user(user):
    """Serialize manual and scheduled jobs for the same Apple account."""
    with _icloud_lock(user):
        return _sync_icloud_user_impl(user)


def _sync_icloud_user_impl(user):
    """Run one pull-then-push idempotent round trip."""
    cfg = _settings(user)
    calendar_url = _allowed_calendar_url(cfg.get("icloud_calendar_url") or "")
    username, password = _credentials(user)
    studio = user.owned_studios.order_by("id").first()
    if not studio:
        raise ICloudSetupError("Kein eigenes Studio gefunden.")
    stats = {"imported": 0, "exported": 0, "cancelled": 0, "unassigned": 0, "conflicts": 0}
    with _connect(username, password) as client:
        available = {item["url"] for item in _discover(client)}
        if calendar_url not in available:
            raise ICloudSetupError("iCloud-Kalender wurde nicht gefunden.")
        remote_calendar = client.calendar(url=calendar_url)
        remote_items = {}
        for item in remote_calendar.events():
            try:
                item.load()
                _, master, _ = _master_and_overrides(_raw(item.data))
                remote_items[str(master["UID"])] = item
            except (ICloudSetupError, ValueError, TypeError):
                # All-day, malformed and unrelated entries are not lessons.
                continue

        for uid, item in remote_items.items():
            try:
                with transaction.atomic():
                    _import_series(user, studio, calendar_url, item, stats)
            except Exception as exc:
                stats["conflicts"] += 1
                # Continue with the other unrelated series; never retry blindly.
                ICloudCalendarSeries.objects.filter(
                    user=user, calendar_url=calendar_url, uid=uid
                ).update(last_error="Importfehler: " + str(exc)[:200])

        all_series = ICloudCalendarSeries.objects.filter(user=user, calendar_url=calendar_url)
        for series in all_series:
            remote = remote_items.get(series.uid)
            if remote is None:
                # Require two successful polls for an entirely missing resource.
                # Never delete its StudioSync lesson records.
                if series.last_error.startswith("Terminserie in iCloud gelöscht;"):
                    continue
                if series.last_error != "Terminserie in iCloud fehlt; Löschung wird geprüft.":
                    _set_error(series, "Terminserie in iCloud fehlt; Löschung wird geprüft.")
                    continue
                with transaction.atomic():
                    for link in series.occurrences.select_related("lesson"):
                        _cancel_icloud_deleted_occurrence(link, stats)
                    _set_error(
                        series,
                        "Terminserie in iCloud gelöscht; Unterrichtstermine in StudioSync als abgesagt erhalten."
                    )
                continue
            if series.last_error:
                continue
            try:
                _push_changes(series, remote, stats)
            except Exception as exc:
                _set_error(series, "Exportfehler: " + str(exc)[:200])
                stats["conflicts"] += 1

        # Export stand-alone StudioSync lessons without iCloud identity.
        low = timezone.now() - timedelta(days=WINDOW_BEFORE)
        high = timezone.now() + timedelta(days=WINDOW_AFTER)
        local_lessons = Lesson.objects.filter(
            studio=studio, scheduled_start__gte=low, scheduled_start__lte=high,
        ).filter(
            Q(student__isnull=False) | ~Q(guest_name="") | Q(teaching_family__isnull=False) | Q(teaching_group__isnull=False)
        ).exclude(icloud_occurrence__isnull=False).select_related("student__user", "teacher")
        for lesson in local_lessons:
            if lesson.status == "cancelled":
                continue
            if any(
                item["start"] == lesson.scheduled_start and item["end"] == lesson.scheduled_end
                for series in all_series if series.uid in remote_items
                for item in _expand(_raw(remote_items[series.uid].data))
            ):
                # An unresolved iCloud event already occupies this slot.
                continue
            try:
                content = _ical_for_lesson(lesson)
                created = remote_calendar.save_event(content)
                created.load()
                _, master, _ = _master_and_overrides(_raw(created.data))
                record, _ = ICloudCalendarSeries.objects.get_or_create(
                    user=user, calendar_url=calendar_url, uid=str(master["UID"]),
                    defaults={
                        "studio": studio, "student": lesson.student,
                        "teacher": lesson.teacher, "title": str(master.get("SUMMARY", "")),
                        "group_booking":group_snapshot(lesson),
                    },
                )
                record.remote_url = str(created.url)
                record.ical_data = _raw(created.data)
                record.remote_hash = _hash(record.ical_data)
                record.last_synced_at = timezone.now()
                record.save()
                ICloudCalendarOccurrence.objects.update_or_create(
                    series=record, recurrence_id=_key(lesson.scheduled_start),
                    defaults={"lesson": lesson, "synced_signature": _lesson_signature(lesson)},
                )
                stats["exported"] += 1
            except Exception as exc:
                stats["conflicts"] += 1
                # Avoid leaking secrets or mail contents in user-facing errors.
                stats["last_error"] = "Export eines StudioSync-Termins fehlgeschlagen."
    return stats


def _find_series_resource(calendar, series):
    """Locate the exact CalDAV resource by URL or stable VEVENT UID."""
    by_uid = None
    for item in calendar.events():
        item.load()
        if str(item.url) == series.remote_url:
            return item
        try:
            _, master, _ = _master_and_overrides(_raw(item.data))
            if str(master["UID"]) == series.uid:
                by_uid = item
        except (ICloudSetupError, ValueError, TypeError):
            continue
    return by_uid


def _trim_rdates(master, cutoff_key):
    """Remove future explicit recurrence dates, retaining earlier RDATEs."""
    rdates = master.get("RDATE")
    if not rdates:
        return
    items = rdates if isinstance(rdates, list) else [rdates]
    retained = [
        value.dt for item in items for value in item.dts
        if _dt(value.dt) and _key(value.dt) < cutoff_key
    ]
    del master["RDATE"]
    if retained:
        master.add("rdate", retained)


def _remove_late_overrides(cal, cutoff_key):
    """A detached exception must not survive ending its parent series."""
    cal.subcomponents[:] = [
        part for part in cal.subcomponents
        if not (
            part.name == "VEVENT" and part.get("RECURRENCE-ID")
            and _dt(part["RECURRENCE-ID"].dt) is not None
            and _key(part["RECURRENCE-ID"].dt) >= cutoff_key
        )
    ]


def end_icloud_series_from_lesson(lesson):
    """Permanently remove THIS and all later series lessons, not cancellations.

    For a weekly RRULE, shorten Apple's recurrence. RDATE and already-ended
    master records are handled too. An iCloud failure never deletes local rows.
    Earlier appointments and completed/paid accounting history are protected.
    """
    link = getattr(lesson, "icloud_occurrence", None)
    if link is None:
        raise ICloudSetupError("Dieser Termin gehört zu keiner iCloud-Terminserie.")
    series = link.series
    cutoff_key = link.recurrence_id
    cutoff = datetime.fromisoformat(cutoff_key)
    future_links = list(
        series.occurrences.filter(recurrence_id__gte=cutoff_key).select_related("lesson")
    )
    if any(
        entry.lesson is not None and (
            entry.lesson.is_paid or entry.lesson.status in COMPLETED_STATUSES
        ) for entry in future_links
    ):
        raise ICloudSetupError(
            "Ein oder mehrere zukünftige Unterrichtstermine sind bereits erteilt "
            "oder bezahlt und können nicht endgültig gelöscht werden."
        )

    user = series.user
    username, password = _credentials(user)
    calendar_url = _allowed_calendar_url(series.calendar_url)
    remote_deleted = False
    remote_data = None

    with _icloud_lock(user):
        with _connect(username, password) as client:
            if calendar_url not in {item["url"] for item in _discover(client)}:
                raise ICloudSetupError("Der hinterlegte iCloud-Kalender ist nicht erreichbar.")
            calendar = client.calendar(url=calendar_url)
            remote = _find_series_resource(calendar, series)
            if remote is not None:
                remote.load()
                raw = _raw(remote.data)
                if _hash(raw) != series.remote_hash:
                    raise ICloudSetupError(
                        "Der iCloud-Kalender wurde verändert. Bitte zuerst synchronisieren."
                    )
                cal, master, _ = _master_and_overrides(raw)
                first_start = _dt(master["DTSTART"].dt)

                if cutoff <= first_start:
                    # The selected instance is the master: the whole resource
                    # lies at or after cutoff and may be removed completely.
                    remote.delete()
                    remote_deleted = True
                else:
                    rule = master.get("RRULE")
                    if rule:
                        if "COUNT" in rule:
                            del rule["COUNT"]
                        rule["UNTIL"] = (
                            cutoff.astimezone(utc_timezone.utc) - timedelta(seconds=1)
                        )
                    # A series with only RDATE (or one already truncated in
                    # Apple) must also allow a future-series deletion.
                    _trim_rdates(master, cutoff_key)
                    _remove_late_overrides(cal, cutoff_key)
                    changed = cal.to_ical().decode("utf-8")
                    if changed != raw:
                        remote.data = changed
                        remote.save()
                        remote.load()
                    remote_data = _raw(remote.data)
            else:
                # Apple already has no matching event. The user explicitly
                # requested permanent removal from StudioSync as well.
                remote_deleted = True

        with transaction.atomic():
            ids = [entry.lesson_id for entry in future_links if entry.lesson_id]
            if ids:
                Lesson.objects.filter(pk__in=ids).delete()
            # Remove the retired recurrence identities so the "future"
            # instances no longer appear in StudioSync.
            series.occurrences.filter(recurrence_id__gte=cutoff_key).delete()
            if remote_deleted:
                if not series.occurrences.exists():
                    series.delete()
                else:
                    series.last_error = (
                        "Terminserie in iCloud gelöscht; frühere Unterrichtsdaten bleiben erhalten."
                    )
                    series.last_synced_at = timezone.now()
                    series.save(update_fields=["last_error", "last_synced_at", "updated_at"])
            else:
                series.ical_data = remote_data
                series.remote_hash = _hash(remote_data)
                series.last_error = ""
                series.last_synced_at = timezone.now()
                series.save(update_fields=[
                    "ical_data", "remote_hash", "last_error", "last_synced_at", "updated_at",
                ])
    return len(ids)


def permanently_delete_lesson(lesson):
    """Administrator-only, explicit hard deletion of one lesson and Apple event.

    The API verifies admin rights and protected accounting state first.
    The CalDAV operation succeeds before the local row is physically removed.
    """
    link = getattr(lesson, "icloud_occurrence", None)
    if link is None:
        Lesson.objects.filter(pk=lesson.pk).delete()
        return

    series = link.series
    user = series.user
    calendar_url = _allowed_calendar_url(series.calendar_url)
    username, password = _credentials(user)
    with _icloud_lock(user):
        remote_deleted = False
        remote_data = None
        with _connect(username, password) as client:
            if calendar_url not in {item["url"] for item in _discover(client)}:
                raise ICloudSetupError("Der hinterlegte iCloud-Kalender ist nicht erreichbar.")
            calendar = client.calendar(url=calendar_url)
            remote = _find_series_resource(calendar, series)
            if remote is not None:
                remote.load()
                raw = _raw(remote.data)
                if _hash(raw) != series.remote_hash:
                    raise ICloudSetupError(
                        "Der iCloud-Termin wurde verändert. Bitte zuerst synchronisieren."
                    )
                cal, master, overrides = _master_and_overrides(raw)
                recurring = bool(master.get("RRULE") or master.get("RDATE"))
                if not recurring:
                    # No actual repetition remains in this resource.
                    # A deleted/absent override has nothing left to remove.
                    if link.recurrence_id == _key(master["DTSTART"].dt):
                        remote.delete()
                        remote_deleted = True
                    elif link.recurrence_id in overrides:
                        cal.subcomponents[:] = [
                            part for part in cal.subcomponents
                            if part is not overrides[link.recurrence_id]
                        ]
                        remote.data = cal.to_ical().decode("utf-8")
                        remote.save()
                        remote.load()
                        remote_data = _raw(remote.data)
                else:
                    recurrence_dt = datetime.fromisoformat(link.recurrence_id)
                    # EXDATE removes only the requested recurrence instance.
                    master.add("exdate", recurrence_dt.astimezone(LOCAL_TZ))
                    existing = overrides.get(link.recurrence_id)
                    if existing is not None:
                        cal.subcomponents[:] = [
                            part for part in cal.subcomponents if part is not existing
                        ]
                    remote.data = cal.to_ical().decode("utf-8")
                    remote.save()
                    remote.load()
                    remote_data = _raw(remote.data)
        with transaction.atomic():
            Lesson.objects.filter(pk=lesson.pk).delete()
            if remote_deleted:
                if series.occurrences.count() <= 1:
                    series.delete()
                else:
                    series.last_error = (
                        "Terminserie in iCloud gelöscht; übrige Unterrichtsdaten bleiben erhalten."
                    )
                    series.save(update_fields=["last_error", "updated_at"])
            else:
                # Keep a hard-deleted UID/RECURRENCE-ID tombstone so a cached
                # Apple version cannot recreate the manually purged lesson.
                link.lesson = None
                link.synced_signature = "hard-deleted"
                link.save(update_fields=["lesson", "synced_signature", "updated_at"])
                if remote_data is not None:
                    series.ical_data = remote_data
                    series.remote_hash = _hash(remote_data)
                    series.last_error = ""
                    series.last_synced_at = timezone.now()
                    series.save(update_fields=[
                        "ical_data", "remote_hash", "last_error", "last_synced_at", "updated_at",
                    ])


def create_icloud_series(user, *, student, teacher, start, end, frequency, until=None, summary="", group_booking=None):
    """Create a real VEVENT recurrence in Apple and import its instances."""
    if frequency not in {"weekly", "biweekly", "monthly"}:
        raise ICloudSetupError("Ungültige Wiederholungsregel.")
    group_booking = group_booking or {}
    studio = teacher.studio
    if studio.owner_id != user.id or (student and student.studio_id != studio.pk) or (not student and not group_booking):
        raise ICloudSetupError("Schüler und Lehrkraft müssen zum eigenen Studio gehören.")
    if end <= start:
        raise ICloudSetupError("Das Terminende muss nach dem Beginn liegen.")
    calendar_url = _allowed_calendar_url(_settings(user).get("icloud_calendar_url") or "")
    username, password = _credentials(user)

    ical = Calendar()
    ical.add("prodid", "-//MUSart StudioSync//iCloud recurrence//DE")
    ical.add("version", "2.0")
    event = Event()
    event.add("uid", f"studiosync-{uuid.uuid4()}@musart.de")
    event.add("dtstamp", timezone.now())
    event.add("dtstart", start.astimezone(LOCAL_TZ))
    event.add("dtend", end.astimezone(LOCAL_TZ))
    event.add("summary", group_booking["name"] if group_booking else student.user.get_full_name())
    if summary:
        event.add("description", str(summary)[:5000])
    if group_booking:
        event.add("X-STUDIOSYNC-GROUP-BOOKING", "1")
    else:
        event.add("X-STUDIOSYNC-STUDENT-ID", str(student.id))
    event.add("X-STUDIOSYNC-TEACHER-ID", str(teacher.id))
    values = {"freq": "monthly" if frequency == "monthly" else "weekly"}
    if frequency == "biweekly":
        values["interval"] = 2
    if until:
        values["until"] = until
    event.add("rrule", values)
    ical.add_component(event)
    with _connect(username, password) as client:
        if calendar_url not in {item["url"] for item in _discover(client)}:
            raise ICloudSetupError("Der gewählte iCloud-Kalender ist nicht erreichbar.")
        cal = client.calendar(url=calendar_url)
        saved = cal.save_event(ical.to_ical().decode("utf-8"))
        saved.load()
        stats = {"imported": 0, "exported": 0, "cancelled": 0, "unassigned": 0, "conflicts": 0}
        if group_booking:
            _, master, _ = _master_and_overrides(_raw(saved.data))
            ICloudCalendarSeries.objects.get_or_create(user=user,calendar_url=calendar_url,uid=str(master["UID"]),
                defaults={"studio":studio,"teacher":teacher,"remote_url":str(saved.url),"group_booking":group_booking})
        _import_series(user, studio, calendar_url, saved, stats)
    return stats


def sync_all_icloud_users():
    """Entry point for the existing Django-Q scheduler."""
    results = {}
    for user in User.objects.filter(role="admin", owned_studios__isnull=False).distinct():
        cfg = _settings(user)
        if not (cfg.get("icloud_calendar_url") and cfg.get("icloud_app_password")):
            continue
        try:
            results[str(user.pk)] = sync_icloud_user(user)
        except Exception:
            results[str(user.pk)] = {"error": "iCloud-Abgleich fehlgeschlagen"}
    return results
