"""Authenticated setup-independent endpoints for manual iCloud synchronization."""
from datetime import datetime, time, timezone as utc_timezone
import logging
from uuid import UUID

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status
from rest_framework.response import Response

from apps.core.models import Student, Teacher
from apps.core.views.icloud_calendar import _AdminICloudView, ICloudSetupError
from apps.lessons.icloud_sync import (
    LOCAL_TZ, _default_teacher, create_icloud_series, sync_icloud_user,
)
from apps.lessons.models import ICloudCalendarSeries

LOG = logging.getLogger(__name__)


def _studio(request):
    return request.user.owned_studios.order_by("id").first()


def _series_payload(user):
    studio = user.owned_studios.order_by("id").first()
    students = Student.objects.filter(studio=studio).select_related("user").order_by(
        "user__last_name", "user__first_name"
    )
    series = ICloudCalendarSeries.objects.filter(
        user=user, studio=studio
    ).select_related("student__user", "teacher__user").order_by("title")
    return {
        "students": [
            {"id": str(student.id), "name": student.user.get_full_name()}
            for student in students
        ],
        "series": [
            {
                "id": str(item.id),
                "uid": item.uid,
                "title": item.title,
                "student": str(item.student_id) if item.student_id else None,
                "student_name": item.student.user.get_full_name() if item.student else "",
                "teacher": str(item.teacher_id) if item.teacher_id else None,
                "error": item.last_error,
                "occurrences": item.occurrences.count(),
            }
            for item in series
        ],
    }


class ICloudSeriesView(_AdminICloudView):
    def get(self, request):
        return Response(_series_payload(request.user))


class ICloudSyncView(_AdminICloudView):
    def post(self, request):
        try:
            stats = sync_icloud_user(request.user)
        except ICloudSetupError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            LOG.exception("iCloud calendar synchronization failed")
            return Response(
                {"detail": "Der iCloud-Abgleich ist fehlgeschlagen. Bitte Serverprotokoll prüfen."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response({**stats, **_series_payload(request.user)})


class ICloudSeriesAssignView(_AdminICloudView):
    def post(self, request, series_id):
        studio = _studio(request)
        series = ICloudCalendarSeries.objects.filter(
            id=series_id, user=request.user, studio=studio
        ).first()
        if not series:
            return Response({"detail": "Terminserie nicht gefunden."}, status=404)
        student_id = str(request.data.get("student") or "").strip()
        student = Student.objects.filter(pk=student_id, studio=studio).first() if student_id else None
        if not student:
            return Response({"detail": "Bitte einen Schüler auswählen."}, status=400)
        series.student = student
        series.teacher = series.teacher or student.primary_teacher or _default_teacher(studio)
        series.last_error = ""
        series.save(update_fields=["student", "teacher", "last_error", "updated_at"])
        return ICloudSyncView().post(request)


class ICloudSeriesCreateView(_AdminICloudView):
    """Create a genuine recurring Apple calendar event from StudioSync."""

    def post(self, request):
        studio = _studio(request)
        student = Student.objects.filter(
            pk=request.data.get("student"), studio=studio
        ).first()
        if not student:
            return Response({"detail": "Schüler nicht gefunden."}, status=400)
        teacher_id = request.data.get("teacher")
        teacher = (
            Teacher.objects.filter(pk=teacher_id, studio=studio).first()
            if teacher_id else student.primary_teacher or _default_teacher(studio)
        )
        if not teacher:
            return Response({"detail": "Lehrkraft nicht gefunden."}, status=400)
        start = parse_datetime(str(request.data.get("scheduled_start") or ""))
        end = parse_datetime(str(request.data.get("scheduled_end") or ""))
        if not start or not end:
            return Response({"detail": "Beginn und Ende sind erforderlich."}, status=400)
        if timezone.is_naive(start):
            start = timezone.make_aware(start, LOCAL_TZ)
        if timezone.is_naive(end):
            end = timezone.make_aware(end, LOCAL_TZ)
        until = None
        until_str = str(request.data.get("until") or "").strip()
        if until_str:
            until_date = parse_date(until_str)
            if not until_date or until_date < start.astimezone(LOCAL_TZ).date():
                return Response({"detail": "Das Serienende ist ungültig."}, status=400)
            until = datetime.combine(until_date, time(23, 59, 59), tzinfo=LOCAL_TZ).astimezone(utc_timezone.utc)
        try:
            stats = create_icloud_series(
                request.user, student=student, teacher=teacher, start=start,
                end=end, frequency=str(request.data.get("frequency", "")), until=until,
            )
        except ICloudSetupError as exc:
            return Response({"detail": str(exc)}, status=400)
        except Exception:
            LOG.exception("Creating iCloud recurrence failed")
            return Response(
                {"detail": "Wiederholungstermin konnte nicht in iCloud angelegt werden."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response(stats, status=status.HTTP_201_CREATED)
