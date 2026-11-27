"""
Lesson API serializers
"""

from rest_framework import serializers
from django.db import transaction
from django.db.models import Q

from apps.lessons.models import Lesson, LessonParticipant, LessonNote, LessonPlan, RecurringPattern, StudentGoal


class GroupLessonReadMixin(serializers.Serializer):
    group_participants = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()

    def get_status(self, obj):
        request = self.context.get('request')
        if request and request.user.role == 'student' and (obj.teaching_family_id or obj.teaching_group_id):
            p = obj.participants.filter(student__user=request.user).first()
            if p and p.status != 'inherit':
                return 'cancelled' if p.status in ('student_cancelled','teacher_cancelled') else p.status
        return obj.status

    def get_group_participants(self, obj):
        if not (obj.teaching_family_id or obj.teaching_group_id):
            return []
        qs = obj.participants.all()
        request = self.context.get("request")
        if request and request.user.role not in ("admin","teacher"):
            qs = qs.filter(student__user=request.user)
        return [{"id":str(p.student_id),"name":p.name_snapshot,"status":p.status} for p in qs]


class LessonListSerializer(GroupLessonReadMixin, serializers.ModelSerializer):
    """Simple serializer for lesson lists"""

    student_name = serializers.SerializerMethodField()
    teacher_name = serializers.CharField(source="teacher.user.get_full_name", read_only=True)
    student_instrument = serializers.SerializerMethodField()
    student_address = serializers.SerializerMethodField()
    band_name = serializers.SerializerMethodField()

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if request is not None and request.user.role not in ("admin", "teacher"):
            fields.pop("ha_attendance", None)
        return fields

    def get_student_address(self, obj):
        """Use the student or special appointment's actual address."""
        if obj.teaching_family_id:
            family=obj.teaching_family
            return ", ".join(part for part in (family.address_line1, " ".join(v for v in (family.postal_code,family.city) if v)) if part)
        if not obj.student_id:
            return obj.guest_address or ""
        pupil = obj.student
        city_line = " ".join(part for part in (pupil.postal_code, pupil.city) if part)
        return ", ".join(part for part in (pupil.address_line1, city_line) if part)

    def get_student_name(self, obj):
        if obj.student_id:
            return obj.student.user.get_full_name()
        return obj.group_name_snapshot or obj.guest_name or None

    def get_student_instrument(self, obj):
        if obj.student_id:
            return obj.student.instrument
        return None

    def get_band_name(self, obj):
        if obj.band_id:
            return obj.band.name
        return None
    room_name = serializers.CharField(source="room.name", read_only=True)
    lesson_plan_title = serializers.CharField(source="lesson_plan.title", read_only=True)
    duration_minutes = serializers.IntegerField(read_only=True)
    student_profile_id = serializers.SerializerMethodField()
    is_recurring = serializers.SerializerMethodField()

    def get_is_recurring(self, obj):
        link = getattr(obj, "icloud_occurrence", None)
        if link is None:
            return False
        content = link.series.ical_data or ""
        # An older CalDAV resource may already have been truncated in Apple.
        # Multiple locally linked instances still form a series for the UI.
        return (
            "RRULE:" in content or "RDATE:" in content
            or link.series.occurrences.count() > 1
        )

    def get_student_profile_id(self, obj):
        """Return the student profile UUID as a plain string for frontend matching."""
        if obj.student:
            return str(obj.student.id)
        return None

    class Meta:
        model = Lesson
        fields = [
            "id",
            "student",
            "student_name",
            "student_profile_id",
            "guest_name",
            "guest_address",
            "is_recurring",
            "teacher",
            "teacher_name",
            "student_instrument",
            "student_address",
            "band",
            "band_name",
            "teaching_family",
            "teaching_group",
            "group_name_snapshot",
            "group_ha_zone",
            "group_participants",
            "room",
            "room_name",
            "lesson_type",
            "status",
            "cancellation_reason",
            "cancellation_kind",
            "scheduled_start",
            "scheduled_end",
            "duration_minutes",
            "location",
            "is_online",
            "online_meeting_url",
            "summary",
            "is_paid",
            "lesson_plan",
            "lesson_plan_title",
            "ha_attendance",
        ]


class LessonDetailSerializer(GroupLessonReadMixin, serializers.ModelSerializer):
    """Detailed serializer for single lesson view"""

    student = serializers.SerializerMethodField()
    teacher = serializers.SerializerMethodField()
    band = serializers.SerializerMethodField()
    room = serializers.SerializerMethodField()
    duration_minutes = serializers.IntegerField(read_only=True)
    student_address = serializers.SerializerMethodField()

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if request is not None and request.user.role not in ("admin", "teacher"):
            for name in ("ha_attendance", "ha_finalized_at", "ha_manual_override", "ha_watch_active"):
                fields.pop(name, None)
        return fields

    def get_student_address(self, obj):
        if not obj.student_id:
            return ""
        pupil = obj.student
        city_line = " ".join(part for part in (pupil.postal_code, pupil.city) if part)
        return ", ".join(part for part in (pupil.address_line1, city_line) if part)

    class Meta:
        model = Lesson
        fields = "__all__"

    def get_student(self, obj):
        if not obj.student:
            return None
        return {
            "id": str(obj.student.id),
            "name": obj.student.user.get_full_name(),
            "instrument": obj.student.instrument,
        }

    def get_teacher(self, obj):
        return {
            "id": str(obj.teacher.id),
            "name": obj.teacher.user.get_full_name(),
        }

    def get_band(self, obj):
        if not obj.band:
            return None
        return {
            "id": str(obj.band.id),
            "name": obj.band.name,
        }

    def get_room(self, obj):
        if not obj.room:
            return None
        return {
            "id": str(obj.room.id),
            "name": obj.room.name,
        }


def _lesson_value(data, instance, name):
    if name in data:
        return data[name]
    return getattr(instance, name, None) if instance is not None else None


def _reject_lesson_mismatch(teacher, student, room, studio, start, end):
    if start and end and start >= end:
        raise serializers.ValidationError("scheduled_end must be after scheduled_start.")
    if teacher is not None and studio is not None and teacher.studio_id != studio.id:
        raise serializers.ValidationError("The teacher must belong to the lesson's studio.")
    if student is not None and studio is not None and student.studio_id != studio.id:
        raise serializers.ValidationError("The student must belong to the lesson's studio.")
    if room is not None and studio is not None and room.studio_id and room.studio_id != studio.id:
        raise serializers.ValidationError("The room must belong to the lesson's studio.")


def _reject_lesson_overlap(instance, teacher, student, room, start, end):
    if not (start and end and (teacher or student or room)):
        return
    overlap = Lesson.objects.filter(
        status__in=["scheduled", "in_progress"],
        scheduled_start__lt=end,
        scheduled_end__gt=start,
    )
    if instance is not None:
        overlap = overlap.exclude(pk=instance.pk)
    if teacher and overlap.filter(teacher=teacher).exists():
        raise serializers.ValidationError("That teacher already has a lesson at this time.")
    if student and overlap.filter(Q(student=student) | Q(participants__student=student)).exists():
        raise serializers.ValidationError("That student already has a lesson at this time.")
    if room and overlap.filter(room=room).exists():
        raise serializers.ValidationError("That room is already booked at this time.")


class LessonCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating lessons"""
    participant_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True, required=False, max_length=100)
    participant_statuses = serializers.DictField(child=serializers.ChoiceField(choices=LessonParticipant.STATUS_CHOICES), write_only=True, required=False)

    class Meta:
        model = Lesson
        fields = [
            "studio",
            "teacher",
            "student",
            "guest_name",
            "guest_address",
            "teaching_family",
            "teaching_group",
            "participant_ids",
            "participant_statuses",
            "group_ha_zone",
            "band",
            "room",
            "lesson_type",
            "status",
            "cancellation_reason",
            "cancellation_kind",
            "scheduled_start",
            "scheduled_end",
            "location",
            "is_online",
            "online_meeting_url",
            "rate",
            "summary",
            "lesson_plan",
        ]

    def validate(self, data):
        """Require a subject and reject overlapping teacher, student, or room times."""
        instance = getattr(self, "instance", None)
        student = _lesson_value(data, instance, "student")
        band = _lesson_value(data, instance, "band")
        room = _lesson_value(data, instance, "room")
        guest_name = (_lesson_value(data, instance, "guest_name") or "").strip()
        family = _lesson_value(data, instance, "teaching_family")
        group = _lesson_value(data, instance, "teaching_group")
        source = family or group
        old_source = bool(instance and (instance.teaching_family_id or instance.teaching_group_id))
        old_ids = set(instance.participants.values_list("student_id",flat=True)) if old_source else set()
        ids = data.get("participant_ids")
        selected = set(ids) if ids is not None else old_ids
        if old_source and not source:
            raise serializers.ValidationError({"code":"group_type_immutable"})
        if source:
            request = self.context.get("request")
            if request and request.user.role != "admin":
                raise serializers.ValidationError({"code":"group_admin_required"})
            if (family and group) or student or band or guest_name or _lesson_value(data,instance,"lesson_type")!="group":
                raise serializers.ValidationError({"code":"invalid_group_source"})
            studio = _lesson_value(data,instance,"studio")
            if studio is None or source.studio_id != studio.pk:
                raise serializers.ValidationError({"code":"invalid_group_source"})
            zone = (_lesson_value(data, instance, "group_ha_zone") or "").strip()
            if family and zone:
                raise serializers.ValidationError({"code":"family_zone_inherited"})
            if group and not zone and not _lesson_value(data,instance,"is_online"):
                raise serializers.ValidationError({"code":"group_zone_required"})
            if "group_ha_zone" in data: data["group_ha_zone"] = zone
            if len(selected)<2 or (ids is not None and len(ids)!=len(selected)):
                raise serializers.ValidationError({"code":"group_needs_two"})
            source_changed = not instance or family != instance.teaching_family or group != instance.teaching_group
            if instance and instance.status not in ("scheduled","in_progress") and (source_changed or selected != old_ids):
                raise serializers.ValidationError({"code":"historical_participants_immutable"})
            if source_changed or selected != old_ids:
                members = (family.students if family else group.members).filter(studio=studio,is_active=True,user__role="student")
                available = set(members.values_list("pk",flat=True))
                if source.archived_at or (group and selected != available) or not selected.issubset(available):
                    raise serializers.ValidationError({"code":"invalid_group_members"})
            if source_changed and instance:
                raise serializers.ValidationError({"code":"group_type_immutable"})
            for key in data.get("participant_statuses",{}):
                if key not in {str(pk) for pk in selected}:
                    raise serializers.ValidationError({"code":"invalid_participant"})
        elif selected or data.get("participant_statuses"):
            raise serializers.ValidationError({"code":"invalid_group_source"})
        if guest_name and (student or band):
            raise serializers.ValidationError(
                {"guest_name": "Ein Sondertermin darf keinem Schüler oder Ensemble gleichzeitig zugeordnet werden."}
            )
        if not student and not band and not room and not guest_name and not source:
            raise serializers.ValidationError(
                "Bitte einen Schüler, ein Ensemble oder einen Namen für den Sondertermin eintragen."
            )
        if guest_name:
            request = self.context.get("request")
            if request is not None and request.user.role not in ("admin", "teacher"):
                raise serializers.ValidationError(
                    {"guest_name": "Sondertermine dürfen nur durch Lehrkräfte oder Administratoren angelegt werden."}
                )
            data["guest_name"] = guest_name

        # Explicit cancellation origin is only meaningful while cancelled.
        # Clearing a cancellation must also clear its quota classification.
        effective_status = _lesson_value(data, instance, "status")
        if effective_status != "cancelled":
            if data.get("cancellation_kind"):
                raise serializers.ValidationError({
                    "cancellation_kind": "A cancellation type requires cancelled status."
                })
            if "status" in data:
                data["cancellation_kind"] = ""

        start = _lesson_value(data, instance, "scheduled_start")
        end = _lesson_value(data, instance, "scheduled_end")
        teacher = _lesson_value(data, instance, "teacher")
        studio = _lesson_value(data, instance, "studio")
        _reject_lesson_mismatch(teacher, student, room, studio, start, end)
        _reject_lesson_overlap(instance, teacher, student, room, start, end)
        if source and start and end:
            conflicts = Lesson.objects.filter(studio=studio,status__in=["scheduled","in_progress"],
                scheduled_start__lt=end,scheduled_end__gt=start).filter(Q(student_id__in=selected)|Q(participants__student_id__in=selected))
            if instance: conflicts=conflicts.exclude(pk=instance.pk)
            if conflicts.exists(): raise serializers.ValidationError({"code":"participant_overlap"})
        return data

    def _save_participants(self, instance, ids, statuses):
        if ids is not None:
            from apps.core.models import Student
            instance.participants.exclude(student_id__in=ids).delete()
            existing=set(instance.participants.values_list("student_id",flat=True))
            for student in Student.objects.filter(pk__in=set(ids)-existing).select_related("user"):
                LessonParticipant.objects.create(lesson=instance,student=student,name_snapshot=student.user.get_full_name())
        for key,value in statuses.items():
            instance.participants.filter(student_id=key).update(status=value)

    @transaction.atomic
    def create(self, validated_data):
        ids=validated_data.pop("participant_ids",None)
        statuses=validated_data.pop("participant_statuses",{})
        source=validated_data.get("teaching_family") or validated_data.get("teaching_group")
        if source: validated_data["group_name_snapshot"]=str(source)
        instance=super().create(validated_data)
        self._save_participants(instance,ids,statuses)
        return instance

    @transaction.atomic
    def update(self, instance, validated_data):
        ids=validated_data.pop("participant_ids",None)
        statuses=validated_data.pop("participant_statuses",{})
        instance=super().update(instance,validated_data)
        self._save_participants(instance,ids,statuses)
        return instance


class StudentGoalSerializer(serializers.ModelSerializer):
    """Serializer for student goals"""

    student_name = serializers.ReadOnlyField(source="student.user.get_full_name")

    class Meta:
        model = StudentGoal
        fields = [
            "id",
            "student",
            "student_name",
            "teacher",
            "title",
            "description",
            "status",
            "target_date",
            "achieved_date",
            "progress_percentage",
            "created_at",
        ]
        read_only_fields = ["teacher", "created_at"]
        extra_kwargs = {"student": {"required": False}}

    def create(self, validated_data):
        # Auto-assign teacher and student based on role
        request = self.context.get("request")
        user = request.user

        if hasattr(user, "teacher_profile"):
            validated_data["teacher"] = user.teacher_profile
            if "student" not in validated_data:
                raise serializers.ValidationError({"student": "Student is required."})

        elif hasattr(user, "student_profile"):
            validated_data["student"] = user.student_profile

        return super().create(validated_data)


class LessonPlanSerializer(serializers.ModelSerializer):
    """Serializer for lesson plans"""

    created_by_name = serializers.ReadOnlyField(source="created_by.user.get_full_name")
    resource_ids = serializers.ListField(
        child=serializers.UUIDField(), write_only=True, required=False
    )

    class Meta:
        model = LessonPlan
        fields = [
            "id",
            "title",
            "description",
            "content",
            "estimated_duration_minutes",
            "tags",
            "is_public",
            "created_by",
            "created_by_name",
            "resources",
            "resource_ids",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_by", "created_at", "updated_at"]
        extra_kwargs = {"resources": {"read_only": True}}

    def create(self, validated_data):
        resource_ids = validated_data.pop("resource_ids", [])
        plan = super().create(validated_data)
        if resource_ids:
            plan.resources.set(resource_ids)
        return plan

    def update(self, instance, validated_data):
        resource_ids = validated_data.pop("resource_ids", None)
        plan = super().update(instance, validated_data)
        if resource_ids is not None:
            plan.resources.set(resource_ids)
        return plan


class LessonNoteSerializer(serializers.ModelSerializer):
    """Serializer for lesson notes"""

    teacher_name = serializers.ReadOnlyField(source="teacher.user.get_full_name")

    class Meta:
        model = LessonNote
        fields = [
            "id",
            "lesson",
            "teacher",
            "teacher_name",
            "content",
            "practice_assignments",
            "homework",
            "pieces_practiced",
            "progress_rating",
            "strengths",
            "areas_for_improvement",
            "attachments",
            "visible_to_student",
            "visible_to_parent",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["teacher", "created_at", "updated_at"]


class RecurringPatternSerializer(serializers.ModelSerializer):
    """Serializer for recurring lesson patterns"""

    teacher_name = serializers.ReadOnlyField(source="teacher.user.get_full_name")
    student_name = serializers.ReadOnlyField(source="student.user.get_full_name")

    class Meta:
        model = RecurringPattern
        fields = [
            "id",
            "teacher",
            "teacher_name",
            "student",
            "student_name",
            "frequency",
            "day_of_week",
            "time",
            "duration_minutes",
            "start_date",
            "end_date",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def validate(self, data):
        """Validate that end_date is after start_date"""
        if data.get("end_date") and data.get("start_date"):
            if data["end_date"] < data["start_date"]:
                raise serializers.ValidationError({"end_date": "End date must be after start date"})
        return data


class ExternalCalendarFeedSerializer(serializers.ModelSerializer):
    """Serializer for external iCal feed subscriptions"""

    # Use CharField so we can normalise webcal:// before URL validation
    url = serializers.CharField(max_length=2000)
    event_count = serializers.SerializerMethodField()

    def get_event_count(self, obj):
        return obj.events.count()

    class Meta:
        from apps.lessons.models import ExternalCalendarFeed

        model = ExternalCalendarFeed
        fields = [
            "id",
            "name",
            "url",
            "color",
            "is_enabled",
            "last_synced_at",
            "last_error",
            "event_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["last_synced_at", "last_error", "created_at", "updated_at"]

    def validate_url(self, value):
        """Normalise webcal:// → https:// then validate as a URL."""
        from django.core.validators import URLValidator
        from django.core.exceptions import ValidationError as DjangoValidationError

        if value.startswith("webcal://"):
            value = "https://" + value[len("webcal://"):]

        validator = URLValidator(schemes=["http", "https"])
        try:
            validator(value)
        except DjangoValidationError:
            raise serializers.ValidationError(
                "Enter a valid iCal feed URL (http or https)."
            ) from None

        return value


class ExternalCalendarEventSerializer(serializers.ModelSerializer):
    """Read-only serializer for cached external calendar events"""

    feed_name = serializers.CharField(source="feed.name", read_only=True)
    feed_color = serializers.CharField(source="feed.color", read_only=True)

    class Meta:
        from apps.lessons.models import ExternalCalendarEvent

        model = ExternalCalendarEvent
        fields = [
            "id",
            "feed",
            "feed_name",
            "feed_color",
            "uid",
            "title",
            "description",
            "location",
            "start_dt",
            "end_dt",
        ]
        read_only_fields = fields
