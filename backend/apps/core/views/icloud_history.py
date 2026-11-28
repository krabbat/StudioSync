"""Read-only historical occurrence count in the configured Apple calendar."""
from collections import Counter, defaultdict
from datetime import datetime
import logging

from django.utils import timezone
from icalendar import Calendar
from rest_framework.response import Response

from apps.core.views.icloud_calendar import (
    _AdminICloudView, _allowed_calendar_url, _connect, _credentials, _discover,
    _settings, ICloudSetupError,
)
from apps.lessons.icloud_sync import LOCAL_TZ, _expand, _master_and_overrides, _raw
from apps.lessons.icloud_notes import normal


LOG = logging.getLogger(__name__)


def historical_matches(calendar, title, now=None, *, mode="exact"):
    now = now or timezone.now()
    low = datetime(1900, 1, 1, tzinfo=LOCAL_TZ)
    matches = {}
    wanted = normal(title)

    def title_matches(value):
        candidate = normal(value)
        return bool(wanted) and (wanted in candidate if mode == "partial" else wanted == candidate)

    for item in calendar.events():
        # A calendar-query REPORT normally already includes the iCalendar
        # payload. Avoid an additional HTTP GET for every historical event.
        content = item.data
        if not content:
            item.load()
            content = item.data
        if not content:
            raise ICloudSetupError("Ein Kalendereintrag konnte nicht vollständig gelesen werden.")
        raw = _raw(content)
        data = Calendar.from_ical(raw)
        if not any(e.name == "VEVENT" and title_matches(e.get("SUMMARY")) for e in data.walk()):
            continue
        _, master, _ = _master_and_overrides(raw)
        uid = str(master["UID"])
        for occurrence in _expand(raw, now=now, low=low, high=now):
            if occurrence["cancelled"] or not occurrence["start"] or not occurrence["end"]:
                continue
            if occurrence["end"] > now or occurrence["end"] <= occurrence["start"]:
                continue
            # An exception may have a different title: count the actual event
            # title, not the title of its original series.
            if not title_matches(occurrence["title"]):
                continue
            matches[(uid, occurrence["rid"])] = (
                occurrence["title"].strip(),
                occurrence["start"].astimezone(LOCAL_TZ).date().isoformat(),
            )
    grouped = defaultdict(Counter)
    counts = Counter()
    for event_title, day in matches.values():
        grouped[event_title][day] += 1
        counts[day] += 1

    def dates_for(counter):
        return [{"date": day, "count": counter[day]} for day in sorted(counter)]

    groups = [
        {"title": name, "count": sum(days.values()), "first_date": min(days), "dates": dates_for(days)}
        for name, days in sorted(grouped.items(), key=lambda item: (normal(item[0]), item[0]))
    ]
    return {"dates": dates_for(counts), "matches": groups}


def historical_dates(calendar, title, now=None):
    """Compatibility helper for the original exact-title query."""
    return historical_matches(calendar, title, now)["dates"]


class ICloudHistoryView(_AdminICloudView):
    def post(self, request):
        title = str(request.data.get("title") or "").strip()
        if not title or len(title) > 500:
            return Response({"detail": "Bitte einen gültigen Terminnamen eingeben."}, status=400)
        mode = request.data.get("mode", "exact")
        if mode not in ("exact", "partial"):
            return Response({"detail": "Ungültiger Suchmodus."}, status=400)
        try:
            source = str(request.data.get("calendar_url") or "").strip()
            if not source:
                raise ICloudSetupError("Bitte den ursprünglichen Apple-Kalender für die historische Abfrage auswählen.")
            target = _allowed_calendar_url(source)
            if target.rstrip("/") == str(_settings(request.user).get("icloud_calendar_url") or "").rstrip("/"):
                raise ICloudSetupError("Bitte einen anderen Kalender als den laufenden MUSart-Synchronisationskalender auswählen.")
            username, password = _credentials(request.user)
            with _connect(username, password) as client:
                calendar = next((row for row in _discover(client) if row["url"] == target), None)
                if calendar is None:
                    raise ICloudSetupError("Der ausgewählte iCloud-Kalender wurde nicht gefunden.")
                found = historical_matches(client.calendar(url=target), title, mode=mode)
            dates = found["dates"]
            return Response({"title": title, "mode": mode, "calendar_name": calendar.get("name", ""),
                             **found, "count": sum(row["count"] for row in dates),
                             "first_date": dates[0]["date"] if dates else None})
        except ICloudSetupError as exc:
            return Response({"detail": str(exc)}, status=400)
        except Exception:
            LOG.exception("Read-only iCloud history query failed")
            return Response({"detail": "Kalenderabfrage nicht vollständig möglich (HTTP 502). Bitte Serverprotokoll prüfen. Es wurden keine Daten übernommen."}, status=502)
