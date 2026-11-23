"""Authenticated admin-only endpoints for the read-only StudioSync inbox."""

from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.mail_actions import apply_inbox_action
from apps.core.mail_service import MailFetchError, get_inbox_message, list_inbox
from apps.core.tenancy import studio_for_request


def _mailbox_config(request):
    """Credentials always come from saved admin settings, never from the request."""
    studio = studio_for_request(request)
    if (
        request.user.role != "admin"
        or studio is None
        or studio.owner_id != request.user.id
    ):
        raise PermissionDenied(
            "Nur der Studio-Administrator darf auf das E-Mail-Postfach zugreifen."
        )

    preferences = (
        request.user.preferences if isinstance(request.user.preferences, dict) else {}
    )
    technical = preferences.get("technical", {})
    if not isinstance(technical, dict):
        technical = {}
    return {key: technical.get(key) for key in (
        "imap_host", "imap_port", "imap_username", "imap_security", "imap_password"
    )}


class MailInboxListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        try:
            offset = int(request.query_params.get("offset", "0"))
            limit = int(request.query_params.get("limit", "40"))
        except (ValueError, TypeError):
            return Response(
                {"detail": "Ungültige Seitenangabe."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not 0 <= offset <= 1_000_000 or not 1 <= limit <= 80:
            return Response(
                {"detail": "Ungültige Seitenangabe."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        config = _mailbox_config(request)
        try:
            data = list_inbox(config, offset=offset, limit=limit)
        except MailFetchError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(data)


class MailInboxDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, uid):
        config = _mailbox_config(request)
        uidvalidity = request.query_params.get("uidvalidity") or None
        try:
            data = get_inbox_message(config, uid, expected_uidvalidity=uidvalidity)
        except MailFetchError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(data)


class MailInboxActionView(APIView):
    """Write selected inbox UIDs only for the authenticated studio owner."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        config = _mailbox_config(request)
        if not isinstance(request.data, dict):
            return Response(
                {"detail": "Ungültige Aktionsdaten."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        action = request.data.get("action")
        uids = request.data.get("uids")
        uidvalidity = request.data.get("uidvalidity")
        try:
            result = apply_inbox_action(config, action, uids, uidvalidity)
        except MailFetchError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST
            )
        return Response(result)
