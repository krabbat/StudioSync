"""Read-only HA attendance, independent of teaching quota and raw GPS storage."""
import json
import logging
import os
import re
import ssl
import unicodedata
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timedelta, time, timezone as utc_timezone
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPSHandler
from zoneinfo import ZoneInfo

from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone

from apps.core.models import Studio
from apps.core.views.home_assistant import _NoRedirect
from apps.lessons.models import Lesson

LOG = logging.getLogger(__name__)
LOCAL = ZoneInfo("Europe/Berlin")
TOLERANCE = timedelta(minutes=30)
MIN_SECONDS = 1200
INVALID = {"unknown", "unavailable", ""}
DEFAULT_BASE = "https://musart.myds.me:8123"


def norm(value):
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).casefold().split())


def stamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(value):
    return value.astimezone(utc_timezone.utc).isoformat()


class HA:
    def __init__(self, owner):
        cfg = (owner.preferences or {}).get("technical") or {}
        env = os.getenv("HA_BASE_URL", DEFAULT_BASE).strip().rstrip("/")
        self.base = str(cfg.get("ha_base_url") or env).strip().rstrip("/")
        self.token = str(cfg.get("ha_access_token") or (
            os.getenv("HA_ACCESS_TOKEN", "") if self.base == env else "")).strip()
        self.tracker = str(cfg.get("ha_tracker_entity_id") or os.getenv("HA_TRACKER_ENTITY_ID", "")).strip()
        parts = urlsplit(self.base)
        if (self.base not in {DEFAULT_BASE, env} or parts.scheme != "https"
                or not parts.hostname or parts.username is not None or parts.password is not None
                or parts.path or parts.query or parts.fragment or not self.token
                or not re.fullmatch(r"device_tracker\.[a-z0-9_]+", self.tracker)):
            raise ValueError("HA configuration incomplete")
        self.opener = build_opener(_NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))

    def get(self, path):
        req = Request(self.base + path, headers={"Authorization": "Bearer " + self.token,
                       "Accept": "application/json"}, method="GET")
        with self.opener.open(req, timeout=8) as response:
            return json.loads(response.read(8_000_000))

    def states(self):
        states = self.get("/api/states")
        if not isinstance(states, list):
            raise ValueError("Invalid HA states")
        zones = defaultdict(list)
        current = None
        for item in states:
            entity = item.get("entity_id", "")
            if entity.startswith("zone."):
                name = item.get("attributes", {}).get("friendly_name")
                if name:
                    zones[norm(name)].append((entity, name))
            elif entity == self.tracker:
                current = norm(item.get("state"))
        return zones, current

    def history(self, start, end):
        query = urlencode({"filter_entity_id": self.tracker, "end_time": iso(end)})
        data = self.get("/api/history/period/" + quote(iso(start), safe="") + "?" + query)
        return intervals(data, start, end, self.tracker)


def intervals(data, start, end, tracker):
    """History must include the initial state; never infer absence from a gap."""
    if end <= start or not isinstance(data, list) or len(data) != 1 or not data[0]:
        raise ValueError("Missing tracker history")
    changes = []
    for item in data[0]:
        if item.get("entity_id", tracker) != tracker:
            raise ValueError("Unexpected tracker")
        changed = stamp(item["last_changed"])
        if changed.tzinfo is None:
            raise ValueError("Missing timezone")
        changes.append((changed, norm(item.get("state"))))
    changes.sort(key=lambda x: x[0])
    if changes[0][0] > start + timedelta(seconds=1):
        raise ValueError("History does not cover start")
    result = []
    for i, (at, state) in enumerate(changes):
        left = max(start, at)
        right = min(end, changes[i+1][0] if i+1 < len(changes) else end)
        if right <= left:
            continue
        if result and result[-1][2] == state and result[-1][1] == left:
            result[-1] = (result[-1][0], right, state)
        else:
            result.append((left, right, state))
    if not result or result[0][0] > start + timedelta(seconds=1) or result[-1][1] < end:
        raise ValueError("Incomplete tracker history")
    return result


def subject(lesson):
    return norm(lesson.student.user.get_full_name() if lesson.student_id else lesson.guest_name)


def zone_for(lesson, zones):
    matches = zones.get(subject(lesson), [])
    return matches[0] if len(matches) == 1 else None


def matching(state, zone):
    return state not in INVALID and state in {norm(zone[1]), norm(zone[0]), norm(zone[0][5:])}


def window(lesson):
    return lesson.scheduled_start - TOLERANCE, lesson.scheduled_end + TOLERANCE


def allocate(rows, lessons, zones, full=False):
    """Allocate zone intervals once; split overlaps at actual scheduled boundaries.
    Full statistics assign each segment to nearest plausible lesson, even beyond its window.
    """
    output = defaultdict(list)
    mapped = [(lesson, zone_for(lesson, zones)) for lesson in lessons]
    for left, right, state in rows:
        candidates = [(lesson, zone) for lesson, zone in mapped
                      if zone and matching(state, zone)
                      and max(left, window(lesson)[0]) < min(right, window(lesson)[1])]
        if not candidates:
            continue
        cuts = {left, right}
        for lesson, _ in candidates:
            for cut in (*window(lesson), lesson.scheduled_start, lesson.scheduled_end):
                if left < cut < right:
                    cuts.add(cut)
        cuts = sorted(cuts)
        for a, b in zip(cuts, cuts[1:]):
            mid = a + (b-a)/2
            eligible = [lesson for lesson, _ in candidates if full or window(lesson)[0] <= mid < window(lesson)[1]]
            if not eligible:
                continue
            def distance(lesson):
                return max((lesson.scheduled_start-mid).total_seconds(),
                           (mid-lesson.scheduled_end).total_seconds(), 0)
            eligible.sort(key=lambda lesson: (distance(lesson), lesson.scheduled_start, str(lesson.pk)))
            output[eligible[0].pk].append((a,b))
    return output


def seconds(parts):
    return int(sum((b-a).total_seconds() for a,b in parts))


def teacher_scope(studio):
    # A single configured tracker belongs to the owner/only active teacher.
    ids = list(studio.teachers.filter(is_active=True).values_list("pk", "user_id"))
    own = [pk for pk, uid in ids if uid == studio.owner_id]
    return own[0] if own else (ids[0][0] if len(ids) == 1 else None)


def lessons_for(studio, activation):
    teacher = teacher_scope(studio)
    return Lesson.objects.filter(studio=studio, teacher_id=teacher,
        scheduled_start__gte=activation, is_online=False).filter(
        Q(student__isnull=False) | ~Q(guest_name="")).select_related("student__user")


@contextmanager
def locked(job):
    if connection.vendor != "postgresql":
        yield True
        return
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(%s, %s)", [74321, job])
        acquired = cursor.fetchone()[0]
    try:
        yield acquired
    finally:
        if acquired:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_unlock(%s, %s)", [74321, job])


def update_live(lesson, zone, tracker, current, rows, assigned, now):
    low, high = window(lesson)
    parts = assigned.get(lesson.pk, [])
    amount = seconds(parts)
    valid = current is not None and current not in INVALID and bool(rows) and rows[0][0] <= low + timedelta(seconds=1) and not any(state in INVALID for a,b,state in rows
                                  if a < min(now, high) and b > low)
    present = current is not None and matching(current, zone)
    with transaction.atomic():
        obj = Lesson.objects.select_for_update().get(pk=lesson.pk)
        if (obj.scheduled_start != lesson.scheduled_start or obj.scheduled_end != lesson.scheduled_end
                or obj.student_id != lesson.student_id or obj.guest_name != lesson.guest_name
                or obj.status == "cancelled"):
            return
        info = dict(obj.ha_attendance or {})
        info.update(zone=zone[0], zone_name=zone[1], tracker=tracker, checked_at=iso(now),
                    present=present)
        if rows and not obj.ha_finalized_at:
            info["attendance_seconds"] = amount
            info["arrival"] = iso(parts[0][0]) if parts else None
            info["departure"] = iso(parts[-1][1]) if parts and not present else None
        if not obj.ha_finalized_at:
            info["error"] = "" if valid else "Standortverlauf unvollständig"
            if now >= high:
                info["final_attempted_at"] = iso(now)
        obj.ha_attendance = info
        # Continue observing a matching visit beyond the deadline until departure.
        if present and now >= low and (now <= high + timedelta(minutes=4) or obj.ha_watch_active):
            obj.ha_watch_active = True
        elif current is not None and current not in INVALID:
            obj.ha_watch_active = False
        if not obj.ha_manual_override and not obj.ha_finalized_at and obj.status in {"scheduled", "in_progress"}:
            if now >= obj.scheduled_end and valid and amount >= MIN_SECONDS:
                obj.status = "completed"
                obj.ha_finalized_at = now
                obj.actual_start = parts[0][0]
                obj.actual_end = parts[-1][1]
            elif now >= high and valid:
                obj.status = "no_show"
                obj.ha_finalized_at = now
            elif now >= obj.scheduled_start and present:
                obj.status = "in_progress"
        obj.save(update_fields=["ha_attendance","ha_watch_active","ha_finalized_at",
                                "status","actual_start","actual_end","updated_at"])


def live_studio(studio, activation, now, only=None):
    base = lessons_for(studio, activation)
    # No HA request without a real lesson window or an already tracked visit.
    qs = base.filter(Q(scheduled_start__lte=now+TOLERANCE,
                       scheduled_end__gte=now-TOLERANCE-timedelta(minutes=4),
                       status__in=["scheduled","in_progress"], ha_finalized_at__isnull=True,
                       ha_manual_override=False)
                     | Q(ha_watch_active=True)).exclude(status="cancelled")
    if only:
        qs = base.filter(pk=only).exclude(status="cancelled")
    selected = list(qs)
    if not only:
        # One historical recovery attempt for recently missed deadlines; no perpetual polling.
        overdue = base.filter(scheduled_end__lt=now-TOLERANCE-timedelta(minutes=4),
            scheduled_end__gte=now-timedelta(days=2), status__in=["scheduled","in_progress"],
            ha_finalized_at__isnull=True, ha_manual_override=False).exclude(
                ha_attendance__has_key="final_attempted_at")
        seen = {l.pk for l in selected}
        recovery = [l for l in overdue if l.pk not in seen]
        # Reserve the one-time recovery attempt before contacting HA, including outages.
        for lesson in recovery:
            with transaction.atomic():
                obj = Lesson.objects.select_for_update().get(pk=lesson.pk)
                info = dict(obj.ha_attendance or {})
                info["final_attempted_at"] = iso(now)
                obj.ha_attendance = info
                obj.save(update_fields=["ha_attendance", "updated_at"])
        selected.extend(recovery)
    if not selected:
        return
    ha = HA(studio.owner)
    zones, current = ha.states()
    for lesson in selected:
        if not zone_for(lesson, zones):
            with transaction.atomic():
                obj = Lesson.objects.select_for_update().get(pk=lesson.pk)
                info = dict(obj.ha_attendance or {})
                info.update(error="Keine eindeutige Schülerzone gefunden", checked_at=iso(now))
                if now >= window(lesson)[1]:
                    info["final_attempted_at"] = iso(now)
                obj.ha_attendance = info
                obj.ha_watch_active = False
                obj.save(update_fields=["ha_attendance","ha_watch_active","updated_at"])
    selected = [lesson for lesson in selected if zone_for(lesson, zones)]
    if not selected:
        return
    # Include the final polling tick after the tolerance expires (scheduler jitter).
    start = min(window(l)[0] for l in selected)
    end = now
    related = list(base.filter(scheduled_start__lt=end+TOLERANCE,
                   scheduled_end__gt=start-TOLERANCE).exclude(status="cancelled"))
    rows = []
    if end > start and any(not l.ha_finalized_at and not l.ha_manual_override for l in selected):
        try:
            rows = ha.history(start, end)
        except Exception:
            LOG.warning("HA history unavailable for studio %s", studio.pk)
    assigned = allocate(rows, related, zones)
    for lesson in selected:
        update_live(lesson, zone_for(lesson, zones), ha.tracker, current, rows, assigned, now)


def run_live(activated_at):
    activation = stamp(activated_at)
    now = timezone.now()
    with locked(1) as acquired:
        if not acquired:
            return
        for studio in Studio.objects.select_related("owner"):
            try:
                live_studio(studio, activation, now)
            except Exception:
                LOG.warning("HA live check failed for studio %s", studio.pk)


def run_nightly(activated_at):
    now = timezone.now()
    local = now.astimezone(LOCAL)
    # Called on both possible UTC equivalents of 03:00 (DST); only one queries HA.
    if local.hour != 3:
        return
    activation = stamp(activated_at)
    day = local.date() - timedelta(days=1)
    start = max(activation, datetime.combine(day, time.min, LOCAL))
    end = datetime.combine(local.date(), time.min, LOCAL)
    if start >= end:
        return
    with locked(2) as acquired:
        if not acquired:
            return
        for studio in Studio.objects.select_related("owner"):
            try:
                lessons = list(lessons_for(studio, activation).filter(
                    scheduled_start__gte=start, scheduled_start__lt=end).exclude(status="cancelled"))
                if not lessons or all((l.ha_attendance or {}).get("statistics_day") == day.isoformat() for l in lessons):
                    continue
                ha = HA(studio.owner)
                zones, _ = ha.states()
                # Include post-midnight departure up to the nightly run.
                rows = ha.history(start, now)
                assigned = allocate(rows, lessons, zones, full=True)
                if any(state in INVALID for _,_,state in rows):
                    continue
                for lesson in lessons:
                    if not zone_for(lesson, zones):
                        continue
                    parts = assigned.get(lesson.pk, [])
                    with transaction.atomic():
                        obj = Lesson.objects.select_for_update().get(pk=lesson.pk)
                        info = dict(obj.ha_attendance or {})
                        info.update(statistics_day=day.isoformat(), total_seconds=seconds(parts),
                                    total_arrival=iso(parts[0][0]) if parts else None,
                                    total_departure=iso(parts[-1][1]) if parts and parts[-1][1] < now else None)
                        obj.ha_attendance = info
                        obj.save(update_fields=["ha_attendance","updated_at"])
            except Exception:
                LOG.warning("HA nightly statistics failed for studio %s", studio.pk)
