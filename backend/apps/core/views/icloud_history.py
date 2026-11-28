"""Read-only historical occurrence count in the configured Apple calendar."""
from collections import Counter
from datetime import datetime

from django.utils import timezone
from icalendar import Calendar
from rest_framework.response import Response

from apps.core.views.icloud_calendar import (
    _AdminICloudView, _allowed_calendar_url, _connect, _credentials, _discover,
    _settings, ICloudSetupError,
)
from apps.lessons.icloud_sync import LOCAL_TZ, _expand, _master_and_overrides, _raw
from apps.lessons.icloud_notes import normal


def historical_dates(calendar, title, now=None):
    now = now or timezone.now()
    low = datetime(1900, 1, 1, tzinfo=LOCAL_TZ)
    matches = {}
    wanted = normal(title)
    for item in calendar.events():
        item.load()
        raw = _raw(item.data)
        data = Calendar.from_ical(raw)
        if not any(e.name == "VEVENT" and normal(e.get("SUMMARY")) == wanted for e in data.walk()):
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
            if normal(occurrence["title"]) != wanted:
                continue
            matches[(uid, occurrence["rid"])] = occurrence["start"].astimezone(LOCAL_TZ).date().isoformat()
    counts = Counter(matches.values())
    return [{"date": day, "count": counts[day]} for day in sorted(counts)]


class ICloudHistoryView(_AdminICloudView):
    def post(self, request):
        title = str(request.data.get("title") or "").strip()
        if not title or len(title) > 500:
            return Response({"detail": "Bitte einen gültigen Terminnamen eingeben."}, status=400)
        try:
            target = _allowed_calendar_url(_settings(request.user).get("icloud_calendar_url") or "")
            username, password = _credentials(request.user)
            with _connect(username, password) as client:
                if target not in {row["url"] for row in _discover(client)}:
                    raise ICloudSetupError("Der iCloud-Kalender wurde nicht gefunden.")
                dates = historical_dates(client.calendar(url=target), title)
            return Response({"title": title, "dates": dates, "count": sum(row["count"] for row in dates)})
        except ICloudSetupError as exc:
            return Response({"detail": str(exc)}, status=400)
        except Exception:
            return Response({"detail": "Kalenderabfrage nicht vollständig möglich. Es wurden keine Daten übernommen."}, status=502)
