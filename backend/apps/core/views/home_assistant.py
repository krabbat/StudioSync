"""Read-only Home Assistant connection probe (no teaching status changes).

The access token is supplied to Django via HA_ACCESS_TOKEN in the server
environment. Neither the token nor raw tracker coordinates leave the backend.
"""
import json
import os
import ssl
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, HTTPSHandler

from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView


class _NoRedirect(HTTPRedirectHandler):
    """Prevent forwarding the Bearer token to a redirected host."""

    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class HomeAssistantConnectionView(APIView):
    """Check HTTPS authentication and list zone/tracker names, without writes."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.user.role != "admin" or not request.user.owned_studios.exists():
            raise PermissionDenied("Nur Studio-Administratoren dürfen Home Assistant abfragen.")

        base = os.getenv("HA_BASE_URL", "https://musart.myds.me").strip().rstrip("/")
        token = os.getenv("HA_ACCESS_TOKEN", "").strip()
        tracker = os.getenv("HA_TRACKER_ENTITY_ID", "").strip()
        parts = urlsplit(base)
        if (parts.scheme != "https" or not parts.hostname or parts.username or
                parts.password or parts.query or parts.fragment):
            return Response(
                {"detail": "Bitte eine gültige HTTPS-Adresse in HA_BASE_URL konfigurieren."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not token:
            return Response({
                "configured": False,
                "connected": False,
                "url": base,
                "tracker": tracker,
                "detail": "Home-Assistant-Zugangstoken fehlt auf dem StudioSync-Server.",
            })

        # No redirects, certificate checks remain enabled; only GET requests.
        opener = build_opener(_NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))
        try:
            req = Request(
                base + "/api/states",
                headers={
                    "Authorization": "Bearer " + token,
                    "Accept": "application/json",
                },
                method="GET",
            )
            with opener.open(req, timeout=12) as response:
                states = json.loads(response.read(2_000_000).decode("utf-8"))
            if not isinstance(states, list):
                raise ValueError("Expected list of entity states")
        except HTTPError as exc:
            detail = (
                "Home Assistant hat die Anmeldung abgelehnt. Zugangstoken prüfen."
                if exc.code in (401, 403) else
                "Home Assistant antwortet mit HTTP " + str(exc.code) + ". HTTPS-Adresse und Reverse Proxy prüfen."
            )
            return Response(
                {"connected": False, "configured": True, "detail": detail},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except (URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
            return Response(
                {"connected": False, "configured": True,
                 "detail": "Home Assistant ist über die konfigurierte HTTPS-Adresse nicht erreichbar oder liefert keine gültigen Zustandsdaten."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        def public_entities(prefix):
            return sorted(
                [
                    {
                        "entity_id": item["entity_id"],
                        "name": item.get("attributes", {}).get("friendly_name") or item["entity_id"],
                    }
                    for item in states
                    if isinstance(item, dict)
                    and isinstance(item.get("entity_id"), str)
                    and item["entity_id"].startswith(prefix)
                    and isinstance(item.get("attributes", {}), dict)
                ],
                key=lambda item: item["name"].casefold(),
            )

        zones = public_entities("zone.")
        trackers = public_entities("device_tracker.")
        return Response({
            "configured": True,
            "connected": True,
            "url": base,
            "tracker": tracker,
            "tracker_found": bool(tracker and any(item["entity_id"] == tracker for item in trackers)),
            "zones": zones,
            "trackers": trackers,
        })
