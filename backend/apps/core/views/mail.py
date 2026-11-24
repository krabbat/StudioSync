"""Owner-only IMAP endpoints and persistent PostgreSQL mail cache."""

import logging

from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.mail_actions import apply_folder_action, apply_inbox_action
from apps.core.mail_cache import (
    cached_folder_page,
    cached_message_detail,
    folder_for_owner,
    schedule_folder_sync,
    update_cache_after_mail_action,
)
from apps.core.mail_service import (
    MailFetchError,
    get_folder_message,
    get_inbox_message,
    list_folder,
    list_inbox,
)
from apps.core.tenancy import studio_for_request

LOG = logging.getLogger(__name__)


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


class MailFolderListView(APIView):
    """Load message headers for a known server-discovered folder."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, folder):
        config = _mailbox_config(request)
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
        try:
            return Response(list_folder(config, folder, offset=offset, limit=limit))
        except MailFetchError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY
            )


class MailFolderDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, folder, uid):
        config = _mailbox_config(request)
        uidvalidity = request.query_params.get("uidvalidity") or None
        try:
            data = get_folder_message(
                config, folder, uid, expected_uidvalidity=uidvalidity,
            )
        except MailFetchError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY
            )
        return Response(data)


class MailCachedFolderListView(APIView):
    """Instant cached folder page, with age-limited asynchronous IMAP refresh."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, folder):
        config = _mailbox_config(request)
        try:
            offset = int(request.query_params.get("offset", "0"))
            limit = int(request.query_params.get("limit", "40"))
            return Response(cached_folder_page(
                studio_for_request(request), request.user, config, folder,
                offset=offset, limit=limit,
            ))
        except (ValueError, TypeError, MailFetchError) as exc:
            detail = (str(exc) if isinstance(exc, MailFetchError)
                      else "Ungültige Seitenangabe.")
            return Response({"detail": detail}, status=status.HTTP_400_BAD_REQUEST)


class MailCachedFolderSyncView(APIView):
    """Explicit user refresh queues work without blocking the response."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, folder):
        config = _mailbox_config(request)
        cache = folder_for_owner(
            studio_for_request(request), request.user, config, folder
        )
        accepted = schedule_folder_sync(cache, force=True)
        cache.refresh_from_db()
        return Response({"syncing": accepted or cache.sync_started_at is not None})


class MailCachedFolderDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, folder, uid):
        config = _mailbox_config(request)
        uidvalidity = request.query_params.get("uidvalidity") or None
        try:
            return Response(cached_message_detail(
                studio_for_request(request), request.user, config, folder,
                uid, expected_uidvalidity=uidvalidity,
            ))
        except MailFetchError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY
            )


class MailFolderActionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, folder):
        config = _mailbox_config(request)
        if not isinstance(request.data, dict):
            return Response(
                {"detail": "Ungültige Aktionsdaten."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            result = apply_folder_action(
                config,
                folder,
                request.data.get("action"),
                request.data.get("uids"),
                request.data.get("uidvalidity"),
            )
            # IMAP already succeeded; never provoke a duplicate MOVE because
            # cache housekeeping encountered a problem.
            try:
                update_cache_after_mail_action(
                    studio_for_request(request), request.user, config, folder,
                    request.data.get("action"), result["uids"],
                    request.data.get("uidvalidity"),
                )
            except Exception as cache_exc:
                LOG.warning("Mail cache action update failed (%s)",
                            type(cache_exc).__name__)
        except MailFetchError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST
            )
        return Response(result)
