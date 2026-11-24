"""Admin-only persistent mail drafts, with strictly private attachment downloads."""

from rest_framework import permissions, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.mail_drafts import (
    draft_file_response, draft_queryset, get_draft, list_drafts, save_draft,
)
from apps.core.mail_outbound import MailSendError
from apps.core.views.mail import _mailbox_config
from apps.core.tenancy import studio_for_request


class MailDraftsView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        config = _mailbox_config(request)
        try:
            offset = int(request.query_params.get("offset", "0"))
            limit = int(request.query_params.get("limit", "40"))
        except (TypeError, ValueError):
            return Response({"detail": "Ungültige Seitenauswahl."},
                            status=status.HTTP_400_BAD_REQUEST)
        if not 0 <= offset <= 1_000_000 or not 1 <= limit <= 80:
            return Response({"detail": "Ungültige Seitenauswahl."},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response(list_drafts(
            studio_for_request(request), request.user, config,
            offset=offset, limit=limit,
        ))

    def post(self, request):
        config = _mailbox_config(request)
        try:
            data = save_draft(
                studio_for_request(request), request.user, config,
                request.data, request.FILES.getlist("attachments"),
            )
        except MailSendError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(data, status=status.HTTP_200_OK)


class MailDraftDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, draft_id):
        config = _mailbox_config(request)
        studio = studio_for_request(request)
        draft = draft_queryset(studio, request.user, config).filter(pk=draft_id).first()
        if draft is None:
            return Response({"detail": "Entwurf nicht gefunden."},
                            status=status.HTTP_404_NOT_FOUND)
        return Response(get_draft(draft, studio))

    def delete(self, request, draft_id):
        config = _mailbox_config(request)
        deleted, _ = draft_queryset(
            studio_for_request(request), request.user, config
        ).filter(pk=draft_id).delete()
        if not deleted:
            return Response({"detail": "Entwurf nicht gefunden."},
                            status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MailDraftAttachmentView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, draft_id, file_id):
        config = _mailbox_config(request)
        draft = draft_queryset(
            studio_for_request(request), request.user, config
        ).filter(pk=draft_id).first()
        if draft is None:
            return Response({"detail": "Entwurf nicht gefunden."},
                            status=status.HTTP_404_NOT_FOUND)
        response = draft_file_response(draft, file_id)
        if response is None:
            return Response({"detail": "Datei nicht gefunden."},
                            status=status.HTTP_404_NOT_FOUND)
        return response
