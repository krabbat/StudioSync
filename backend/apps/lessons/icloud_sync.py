"""Bidirectional iCloud CalDAV synchronization for MUSart teaching lessons.

One iCloud VEVENT UID maps to a series and one RECURRENCE-ID maps to one
lesson. This module never sends lesson notification emails on import, since
bulk_create/QuerySet.update bypass the standard post_save signal.
"""
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

from apps.core.models import Student, Teacher, User
from apps.core.views.icloud_calendar import (
    ICloudSetupError, _allowed_calendar_url, _connect, _credentials, _discover,
    _settings,
)
from apps.lessons.models import (
    ICloudCalendarOccurrence, ICloudCalendarSeries, Lesson,
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
        lesson.status, lesson.location or "", lesson.summary or "", str(lesson.student_id or ""),
        str(lesson.teacher_id),
    ]
    return _hash(json.dumps(values, ensure_ascii=False))


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


def _conflict(lesson, student, teacher, start, end):
    """Return the actual blocking lesson, not only a boolean.

    Any overlapping lesson with the same teacher OR student is a collision.
    Exclude the exact linked lesson being updated.
    """
    overlapping = Lesson.objects.filter(
        studio=student.studio, status__in=["scheduled", "in_progress"],
        scheduled_start__lt=end, scheduled_end__gt=start,
    ).filter(Q(teacher=teacher) | Q(student=student))
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
    if not series.student_id:
        series.student = _resolve_student(series, master)
    series.save()

    if not series.student_id or not series.teacher_id:
        _set_error(series, "Schüler zuordnen" if not series.student_id else "Keine Lehrkraft vorhanden")
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
            matching = Lesson.objects.filter(
                studio=studio, student=series.student, teacher=series.teacher,
                scheduled_start=start, scheduled_end=end,
            ).exclude(icloud_occurrence__isnull=False).first()
            if matching:
                lesson = matching
            else:
                blocking = _conflict(None, series.student, series.teacher, start, end)
                if blocking:
                    collisions.append(_collision_detail(series, entry, blocking))
                    stats["conflicts"] += 1
                    continue
                lesson = Lesson(
                    studio=studio, student=series.student, teacher=series.teacher,
                    scheduled_start=start, scheduled_end=end, status="scheduled",
                    location=entry["location"][:200], summary=entry["description"][:5000],
                    lesson_type="private",
                )
                # Never call save(): that would send one email per imported lesson.
                Lesson.objects.bulk_create([lesson])
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
                    _conflict(lesson, series.student, series.teacher, start, end)
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
                    "status": "cancelled" if entry["cancelled"] else "scheduled",
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
                <= timezone.now() + timedelta(days=WINDOW_AFTER)
                and lesson.status not in COMPLETED_STATUSES):
            Lesson.objects.filter(pk=lesson.pk).update(status="cancelled")
            lesson.status = "cancelled"
            link.synced_signature = _lesson_signature(lesson)
            link.save(update_fields=["synced_signature", "updated_at"])
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
    event.add("summary", lesson.student.user.get_full_name() if lesson.student_id else "MUSart Unterricht")
    event.add("location", lesson.location or "")
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

    # A stand-alone appointment must disappear from Apple Calendar completely;
    # a recurrence instance must instead be excluded from its parent series.
    if not recurring:
        links = list(series.occurrences.select_related("lesson"))
        if links and all(
            link.lesson_id is None and link.synced_signature
            for link in links
        ):
            remote.delete()
            series.delete()
            stats["exported"] += 1
            return

    modified_links = []
    for entry in series.occurrences.select_related("lesson"):
        lesson = entry.lesson
        removed = lesson is None and entry.synced_signature and entry.synced_signature != "deleted"
        if lesson is None and not removed:
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
            # A recurrence exception for the same original date would supersede EXDATE.
            existing = overrides.get(entry.recurrence_id)
            if existing is not None:
                # Compare by identity: icalendar's equality operator cannot
                # safely compare VEVENT objects with None.
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
            _set_property(target, "STATUS", "CANCELLED")
        else:
            if lesson.student_id != series.student_id:
                _set_error(series, "Schülerwechsel bitte über die Serienzuordnung vornehmen.")
                stats["conflicts"] += 1
                return
            _set_property(target, "DTSTART", lesson.scheduled_start.astimezone(LOCAL_TZ))
            _set_property(target, "DTEND", lesson.scheduled_end.astimezone(LOCAL_TZ))
            _set_property(target, "LOCATION", lesson.location or "")
            _set_property(target, "DESCRIPTION", lesson.summary or "")
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


def sync_icloud_user(user):
    """Serialize manual and scheduled jobs for the same Apple account."""
    if connection.vendor != "postgresql":
        return _sync_icloud_user_impl(user)
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
        return _sync_icloud_user_impl(user)
    finally:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_unlock(%s)", [lock_id])


def _sync_icloud_user_impl(user):
    """Run one pull-then-push idempotent round trip."""
    cfg = _settings(user)
    calendar_url = _allowed_calendar_url(cfg.get("icloud_calendar_url") or "")
    username, password = _credentials(user)
    studio = user.owned_studios.order_by("id").first()
    if not studio:
        raise ICloudSetupError("Kein eigenes Studio gefunden.")
    stats = {"imported": 0, "exported": 0, "unassigned": 0, "conflicts": 0}
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
                # Require two successful polls before processing a remote deletion.
                if series.last_error != "Terminserie in iCloud fehlt; Löschung wird geprüft.":
                    _set_error(series, "Terminserie in iCloud fehlt; Löschung wird geprüft.")
                    continue
                for link in series.occurrences.select_related("lesson"):
                    if link.lesson and link.lesson.status not in COMPLETED_STATUSES:
                        Lesson.objects.filter(pk=link.lesson_id).update(status="cancelled")
                        link.lesson.status = "cancelled"
                        link.synced_signature = _lesson_signature(link.lesson)
                        link.save(update_fields=["synced_signature", "updated_at"])
                _set_error(series, "Terminserie wurde in iCloud gelöscht; zukünftige Einheiten abgesagt.")
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
            studio=studio, student__isnull=False,
            scheduled_start__gte=low, scheduled_start__lte=high,
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


def create_icloud_series(user, *, student, teacher, start, end, frequency, until=None):
    """Create a real VEVENT recurrence in Apple and import its instances."""
    if frequency not in {"weekly", "biweekly", "monthly"}:
        raise ICloudSetupError("Ungültige Wiederholungsregel.")
    if student.studio_id != teacher.studio_id or student.studio.owner_id != user.id:
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
    event.add("summary", student.user.get_full_name())
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
        stats = {"imported": 0, "exported": 0, "unassigned": 0, "conflicts": 0}
        _import_series(user, student.studio, calendar_url, saved, stats)
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
