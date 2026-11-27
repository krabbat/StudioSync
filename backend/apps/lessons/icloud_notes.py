"""Human-readable calendar notes without fuzzy roster or instrument guesses."""
from collections import Counter
import unicodedata

from apps.core.models import Family, TeachingGroup, Student
from apps.core.views.icloud_calendar import ICloudSetupError


def normal(value):
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).casefold().split())


def note_lines(value):
    return str(value or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")


def member_snapshot(pupil, instrument=None):
    return {"id": str(pupil.pk), "name": pupil.user.get_full_name(),
            "first_name": pupil.user.first_name,
            "instrument": pupil.instrument if instrument is None else instrument}


def group_source(studio, title):
    """Exact family/group name only; never treat a surname as an individual."""
    key = normal(title)
    if not key:
        return None
    families = [f for f in Family.objects.filter(studio=studio, archived_at__isnull=True).select_related("primary_parent")
                if normal(str(f)) == key]
    groups = [g for g in TeachingGroup.objects.filter(studio=studio, archived_at__isnull=True) if normal(g.name) == key]
    matches = families + groups
    if not matches:
        return None
    if len(matches) != 1 or any(normal(p.user.get_full_name()) == key for p in Student.objects.filter(studio=studio).select_related("user")):
        raise ICloudSetupError("Kalendertitel ist nicht eindeutig einer Familie oder Gruppe zugeordnet.")
    return matches[0]


def participant_labels(members):
    counts = Counter(normal(m.get("first_name") or m["name"]) for m in members)
    return [m.get("first_name") or m["name"] if counts[normal(m.get("first_name") or m["name"])] == 1
            else m["name"] for m in members]


def common_instrument(members):
    result = {}
    for member in members:
        value = str(member.get("instrument") or "").strip()
        if value:
            result.setdefault(normal(value), value)
    return ", ".join(result.values())


def format_notes(instrument, summary, members=None):
    if members is None and not instrument:
        return summary or ""
    lines = [instrument or ""]
    if members is not None:
        lines.append(", ".join(participant_labels(members)))
    if summary:
        lines.append(summary)
    return "\n".join(lines)


def parse_group_notes(source, description, location="", previous=None):
    """Return the exact booked roster and free notes, not a changed pupil profile."""
    lines = note_lines(description)
    if len(lines) < 2 or not lines[0].strip() or not lines[1].strip():
        raise ICloudSetupError("Gruppentermin: In Notizzeile 1 Instrument und in Zeile 2 Teilnehmer eintragen.")
    instrument = lines[0].strip()
    labels = [v.strip() for v in lines[1].split(",")]
    if len(labels) < 2 or any(not v for v in labels) or len(set(map(normal, labels))) != len(labels):
        raise ICloudSetupError("Gruppentermin: Mindestens zwei unterschiedliche Teilnehmer erforderlich.")
    previous = previous or {}
    saved = previous.get("members", [])
    if saved and sorted(map(normal, labels)) == sorted(map(normal, participant_labels(saved))) and normal(instrument) == normal(common_instrument(saved)):
        # Keep the booked roster even after later changes to student profiles.
        return {**previous, "notes_format": 1}, "\n".join(lines[2:])
    family = isinstance(source, Family)
    pupils = list((source.students if family else source.members).filter(
        studio=source.studio, is_active=True, user__role="student").select_related("user"))
    selected = []
    for label in labels:
        matches = [p for p in pupils if normal(p.user.first_name) == normal(label)
                   or normal(p.user.get_full_name()) == normal(label)]
        if len(matches) != 1 or matches[0].pk in {p.pk for p in selected}:
            raise ICloudSetupError("Gruppentermin: Teilnehmer nicht eindeutig. Bei gleichen Vornamen vollständigen Namen verwenden.")
        pupil = matches[0]
        choices = [pupil.instrument] + (pupil.instruments if isinstance(pupil.instruments, list) else [])
        choices = {normal(v) for v in choices if v}
        if choices and normal(instrument) not in choices:
            raise ICloudSetupError("Gruppentermin: Instrument stimmt nicht mit allen ausgewählten Schülerprofilen überein.")
        selected.append(pupil)
    if not family and {p.pk for p in selected} != {p.pk for p in pupils}:
        raise ICloudSetupError("Gruppentermin: Bei einer festen Gruppe alle aktiven Mitglieder angeben.")
    return {
        "family": str(source.pk) if family else "",
        "group": "" if family else str(source.pk),
        "name": str(source),
        "zone": "" if family else (previous.get("zone") or location.strip() or str(source))[:255],
        "is_online": previous.get("is_online", False),
        "online_meeting_url": previous.get("online_meeting_url", ""),
        "members": [member_snapshot(p, instrument) for p in selected],
        "notes_format": 1,
    }, "\n".join(lines[2:])


def single_notes(student, description):
    """Recognize an instrument line without removing arbitrary legacy notes."""
    lines = note_lines(description)
    if not student or not lines:
        return description or ""
    choices = [student.instrument] + (student.instruments if isinstance(student.instruments, list) else [])
    if normal(lines[0]) in {normal(v) for v in choices if v}:
        return "\n".join(lines[1:])
    return description or ""
