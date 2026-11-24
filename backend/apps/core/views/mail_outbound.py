"""Admin-only SMTP composer endpoints: active student roster and send."""

import json

from rest_framework import permissions, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.mail_outbound import (
    MailSendError,
    active_student_recipients,
    send_student_mail,
)
from apps.core.views.mail import _mailbox_config
from apps.core.tenancy import studio_for_request


class MailRecipientsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        # The shared check enforces owner-only admin access before any roster data.
        _mailbox_config(request)
        studio = studio_for_request(request)
        students = active_student_recipients(studio)
        return Response({"students": students, "total": len(students)})


class MailSendView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        # A student's email address must never be accepted from untrusted
        # roster input; the service resolves the selected IDs server-side.
        _mailbox_config(request)
        studio = studio_for_request(request)

        raw_ids = request.data.get("student_ids", "[]")
        try:
            ids = json.loads(raw_ids) if isinstance(raw_ids, str) else raw_ids
        except (TypeError, ValueError):
            ids = None

        subject = request.data.get("subject", "")
        body = request.data.get("body", "")
        manual = request.data.get("manual_recipient", "")
        if not all(isinstance(v, str) for v in (subject, body, manual)):
            return Response(
                {"detail": "Ungültiger Nachrichteninhalt."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            result = send_student_mail(
                studio=studio,
                config={
                    **_mailbox_config(request),
                    **_saved_smtp_settings(request),
                },
                student_ids=ids,
                manual_recipient=manual,
                subject=subject,
                body=body,
                uploads=request.FILES.getlist("attachments"),
            )
        except MailSendError as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST
            )
        return Response(result)


def _saved_smtp_settings(request):
    prefs = request.user.preferences
    if not isinstance(prefs, dict):
        return {}
    technical = prefs.get("technical")
    if not isinstance(technical, dict):
        return {}
    return {
        key: technical.get(key)
        for key in (
            "smtp_host", "smtp_port", "smtp_username",
            "smtp_password", "smtp_use_tls", "smtp_from_email",
        )
    }
