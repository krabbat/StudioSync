"""Authenticated setup-independent endpoints for manual iCloud synchronization."""
from datetime import datetime, time, timezone as utc_timezone
import logging

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status
from rest_framework.response import Response

from apps.core.models import Student, Teacher
from apps.core.views.icloud_calendar import _AdminICloudView, ICloudSetupError
from apps.lessons.icloud_sync import (
    LOCAL_TZ, _default_teacher, _raw, _hash, _lesson_signature,
    create_icloud_series, sync_icloud_user,
)
from apps.core.views.icloud_calendar import _credentials, _connect, _discover, _allowed_calendar_url
from apps.lessons.models import ICloudCalendarSeries
from apps.lessons.serializers import LessonCreateSerializer

LOG = logging.getLogger(__name__)


def _studio(request):
    return request.user.owned_studios.order_by("id").first()


def _series_payload(user):
    studio = user.owned_studios.order_by("id").first()
    students = Student.objects.filter(studio=studio).select_related("user").order_by(
        "user__last_name", "user__first_name"
    )
    cfg = user.preferences.get("technical", {}) if isinstance(user.preferences, dict) else {}
    target = cfg.get("icloud_calendar_url", "")
    series = ICloudCalendarSeries.objects.filter(
        user=user, studio=studio, calendar_url=target
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
                "student_name": item.student.user.get_full_name() if item.student else item.group_booking.get("name", ""),
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
        if series.group_booking:
            return Response({"detail": "Gruppenzuordnung in StudioSync bearbeiten."}, status=400)
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
        grouped = bool(request.data.get("teaching_family") or request.data.get("teaching_group"))
        student = None if grouped else Student.objects.filter(
            pk=request.data.get("student"), studio=studio
        ).first()
        if not student and not grouped:
            return Response({"detail": "Schüler nicht gefunden."}, status=400)
        teacher_id = request.data.get("teacher")
        teacher = (
            Teacher.objects.filter(pk=teacher_id, studio=studio).first()
            if teacher_id else (student.primary_teacher if student else None) or _default_teacher(studio)
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
        booking = None
        if grouped:
            payload = {**request.data, "studio":str(studio.pk), "teacher":str(teacher.pk), "lesson_type":"group"}
            serializer=LessonCreateSerializer(data=payload,context={"request":request})
            serializer.is_valid(raise_exception=True)
            data=serializer.validated_data
            family=data.get("teaching_family")
            group=data.get("teaching_group")
            ids=data["participant_ids"]
            pupils=Student.objects.filter(studio=studio,pk__in=ids).select_related("user").order_by("pk")
            booking={"family":str(family.pk) if family else "", "group":str(group.pk) if group else "",
                     "name":str(family or group),"zone":data.get("group_ha_zone",""),"is_online":data.get("is_online",False),"online_meeting_url":data.get("online_meeting_url",""),
                     "members":[{"id":str(p.pk),"name":p.user.get_full_name()} for p in pupils]}
        try:
            stats = create_icloud_series(
                request.user, student=student, teacher=teacher, start=start,
                end=end, frequency=str(request.data.get("frequency", "")), until=until,
                summary=str(request.data.get("summary") or ""),
                **({"group_booking":booking} if booking else {}),
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


class ICloudSeriesResolveView(_AdminICloudView):
    """Explicit owner choice for concurrent edits: Apple or StudioSync wins."""

    def post(self, request, series_id):
        studio = _studio(request)
        series = ICloudCalendarSeries.objects.filter(
            id=series_id, studio=studio, user=request.user
        ).first()
        if not series:
            return Response({"detail": "Terminserie nicht gefunden."}, status=404)
        prefer = str(request.data.get("prefer") or "")
        if prefer not in ("apple", "studiosync"):
            return Response({"detail": "Bitte Apple oder StudioSync als Quelle auswählen."}, status=400)
        try:
            target = _allowed_calendar_url(series.calendar_url)
            username, password = _credentials(request.user)
            with _connect(username, password) as client:
                if target not in {item["url"] for item in _discover(client)}:
                    raise ICloudSetupError("Der iCloud-Kalender wurde nicht gefunden.")
                calendar = client.calendar(url=target)
                remote = next((
                    item for item in calendar.events()
                    if str(item.url) == series.remote_url
                ), None)
                if remote is None:
                    raise ICloudSetupError("Der iCloud-Termin ist nicht mehr vorhanden.")
                remote.load()
                if prefer == "apple":
                    # Clear local-dirty markers so an Apple edit can be imported.
                    for link in series.occurrences.select_related("lesson"):
                        if link.lesson:
                            link.synced_signature = _lesson_signature(link.lesson)
                            link.save(update_fields=["synced_signature", "updated_at"])
                else:
                    # Acknowledge remote revisions and push the tracked local edits.
                    series.ical_data = _raw(remote.data)
                    series.remote_hash = _hash(series.ical_data)
                series.last_error = ""
                series.save(update_fields=["ical_data", "remote_hash", "last_error", "updated_at"])
            stats = sync_icloud_user(request.user)
            return Response({**stats, **_series_payload(request.user)})
        except ICloudSetupError as exc:
            return Response({"detail": str(exc)}, status=400)
        except Exception:
            LOG.exception("Resolving iCloud conflict failed")
            return Response({"detail": "Kalenderkonflikt konnte nicht aufgelöst werden."}, status=502)
