"""Apple iCloud CalDAV connection and non-destructive read/write verification.

A single dedicated calendar is selected by its server-discovered URL. The
credentials never leave the backend in API responses and are only used against
Apple's CalDAV service and its *.icloud.com calendar hosts.
"""
from datetime import timedelta
from urllib.parse import urlparse
import uuid

import caldav
from django.utils import timezone
from icalendar import Calendar, Event
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView


class ICloudSetupError(Exception):
    pass


def _allowed_calendar_url(url):
    parsed = urlparse(str(url))
    host = (parsed.hostname or "").lower().rstrip(".")
    if (
        parsed.scheme != "https"
        or not (host == "caldav.icloud.com" or host.endswith("-caldav.icloud.com"))
        or parsed.port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise ICloudSetupError("Der ausgewählte Kalender liegt nicht auf einem iCloud-CalDAV-Server.")
    return str(url)


def _settings(user):
    prefs = user.preferences if isinstance(user.preferences, dict) else {}
    technical = prefs.get("technical")
    return technical if isinstance(technical, dict) else {}


def _credentials(user):
    cfg = _settings(user)
    username = str(cfg.get("icloud_username") or "").strip()
    password = str(cfg.get("icloud_app_password") or "").strip()
    if not username or not password:
        raise ICloudSetupError("Bitte Apple-Konto und app-spezifisches Passwort zuerst speichern.")
    return username, password


def _discover(client):
    calendars = []
    for item in client.principal().calendars():
        url = str(item.url)
        try:
            _allowed_calendar_url(url)
        except ICloudSetupError:
            continue
        calendars.append({
            "name": str(item.get_display_name() or "Unbenannter Kalender"),
            "url": url,
        })
    return calendars


def _connect(username, password):
    return caldav.DAVClient(
        url="https://caldav.icloud.com/",
        username=username,
        password=password,
        timeout=15,
    )


class _AdminICloudView(APIView):
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.user.role != "admin" or not request.user.owned_studios.exists():
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Nur Studio-Administratoren können iCloud verbinden.")


class ICloudCalendarListView(_AdminICloudView):
    """Discover all available iCloud calendars using saved credentials."""

    def get(self, request):
        try:
            username, password = _credentials(request.user)
            with _connect(username, password) as client:
                calendars = _discover(client)
            return Response({"calendars": calendars})
        except ICloudSetupError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            return Response({
                "detail": "iCloud-Verbindung fehlgeschlagen. Apple-Konto, App-Passwort und Netzwerkzugang prüfen."
            }, status=status.HTTP_502_BAD_GATEWAY)


class ICloudCalendarWriteTestView(_AdminICloudView):
    """Prove bidirectional CalDAV permissions via create/read/delete test event."""

    def post(self, request):
        try:
            cfg = _settings(request.user)
            target = _allowed_calendar_url(cfg.get("icloud_calendar_url") or "")
            username, password = _credentials(request.user)
            with _connect(username, password) as client:
                calendars = _discover(client)
                if target not in [item["url"] for item in calendars]:
                    raise ICloudSetupError(
                        "Kalender nicht gefunden. Bitte die Kalenderliste erneut laden und auswählen."
                    )
                calendar = client.calendar(url=target)
                marker = uuid.uuid4().hex
                uid = f"studiosync-connection-check-{marker}@musart.de"
                start = timezone.now() - timedelta(days=2)
                end = start + timedelta(minutes=5)
                data = Calendar()
                data.add("prodid", "-//MUSart StudioSync//CalDAV check//DE")
                data.add("version", "2.0")
                event = Event()
                event.add("uid", uid)
                event.add("summary", f"StudioSync Verbindungstest {marker[:8]}")
                event.add("dtstamp", timezone.now())
                event.add("dtstart", start)
                event.add("dtend", end)
                data.add_component(event)

                created = None
                try:
                    created = calendar.save_event(data.to_ical().decode("utf-8"))
                    created.load()
                    verified = Calendar.from_ical(created.data)
                    if not any(
                        comp.name == "VEVENT" and str(comp.get("UID", "")) == uid
                        for comp in verified.walk()
                    ):
                        raise ICloudSetupError("Testtermin konnte nicht aus iCloud zurückgelesen werden.")
                finally:
                    if created is not None:
                        try:
                            created.delete()
                        except Exception:
                            raise ICloudSetupError(
                                "Testtermin wurde angelegt, konnte aber nicht gelöscht werden. "
                                f"Bitte im Apple-Kalender nach 'StudioSync Verbindungstest {marker[:8]}' suchen."
                            )
            return Response({
                "detail": "Lesen, Schreiben und Löschen im ausgewählten iCloud-Kalender erfolgreich."
            })
        except ICloudSetupError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            return Response({
                "detail": "iCloud-Schreibtest fehlgeschlagen. Bitte App-Passwort und Kalenderfreigabe prüfen."
            }, status=status.HTTP_502_BAD_GATEWAY)
