from django.core.exceptions import ValidationError as DjangoValidationError
from django.contrib.auth.password_validation import validate_password
from django.db import models, transaction

from rest_framework import filters, permissions, status, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.models import Family, Student, Teacher, TeachingContract
from apps.core.tenancy import studio_for_request, studios_for_request
from apps.students.serializers import (
    StudentCreateUpdateSerializer,
    StudentDetailSerializer,
    StudentListSerializer,
    TeachingContractSerializer,
)
from apps.students.serializers_family import FamilySerializer
from apps.billing.models import StudentBillingProfile
from apps.billing.serializers import StudentBillingProfileSerializer


class StudentViewSet(viewsets.ModelViewSet):
    """
    API endpoints for managing students
    """

    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["user__first_name", "user__last_name", "instrument"]
    ordering_fields = ["user__last_name", "enrollment_date"]
    ordering = ["user__last_name"]

    def get_serializer_class(self):
        if self.action == "list":
            return StudentListSerializer
        if self.action in ["create", "update", "partial_update"]:
            return StudentCreateUpdateSerializer
        return StudentDetailSerializer

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        # Roll back user creation if the student profile or response serialization fails.
        return super().create(request, *args, **kwargs)

    def get_queryset(self):
        user = self.request.user
        queryset = Student.objects.select_related("user", "primary_teacher__user", "family").filter(
            user__role="student", studio__in=studios_for_request(self.request)
        )

        if user.role == "admin":
            return queryset

        if user.role == "teacher" and hasattr(user, "teacher_profile"):
            return queryset.filter(primary_teacher=user.teacher_profile)

        if user.role == "parent":
            return queryset.filter(
                models.Q(family__primary_parent=user) | models.Q(family__secondary_parent=user)
            )

        if hasattr(user, "student_profile"):
            student_profile = user.student_profile
            # Bandmates are visible for scheduling, but retrieve() hides medical fields.
            user_bands = student_profile.bands.all()
            if user_bands.exists():
                return queryset.filter(
                    models.Q(id=student_profile.id) | models.Q(bands__in=user_bands)
                ).distinct()
            return queryset.filter(id=student_profile.id)

        return queryset.none()

    def update(self, request, *args, **kwargs):
        # Students may edit only their own personal fields. They must never
        # change teacher assignment, enrollment data, activity or contract data.
        if request.user.role == "student":
            student = self.get_object()
            if student.user_id != request.user.id:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("Nur das eigene Profil darf bearbeitet werden.")
            personal_fields = {
                "first_name", "last_name", "email", "phone", "birth_date",
                "address_line1", "postal_code", "city",
                "emergency_contact_name", "emergency_contact_phone", "emergency_contact_first_name", "emergency_contact_last_name", "contact_email",
            }
            if set(request.data.keys()) - personal_fields:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("Dieses Feld kann nicht selbst bearbeitet werden.")
        elif request.user.role not in ("admin", "teacher"):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Keine Berechtigung zum Bearbeiten von Schülerdaten.")
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if request.user.role != "admin":
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Nur Administratoren dürfen Schülerprofile löschen.")
        return super().destroy(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        if request.user.role == "student" and instance.user_id != request.user.id:
            serializer = StudentListSerializer(instance, context={"request": request})
            return Response(serializer.data)
        return super().retrieve(request, *args, **kwargs)


    @action(detail=True, methods=["get", "put"], url_path="billing-profile")
    def billing_profile(self, request, pk=None):
        """Admin-only invoice recipient and payment preference, independent of student login."""
        if request.user.role != "admin":
            raise PermissionDenied("Nur Administratoren dürfen Rechnungsdaten einsehen oder ändern.")

        student = self.get_object()
        profile = StudentBillingProfile.objects.filter(student=student).first()
        if request.method == "GET":
            # No implicit copying of the student's email into billing data.
            return Response(StudentBillingProfileSerializer(
                profile or StudentBillingProfile(student=student)
            ).data)

        serializer = StudentBillingProfileSerializer(instance=profile, data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            serializer.save(student=student)
        return Response(serializer.data)

    @action(detail=True, methods=["get", "put"], url_path="contract")
    def contract(self, request, pk=None):
        """Students see only their own contract; only admins can create/edit it."""
        from rest_framework.exceptions import PermissionDenied

        student = self.get_object()
        actor = request.user
        is_admin = actor.role == "admin"
        is_owner = actor.role == "student" and student.user_id == actor.id

        if not (is_admin or is_owner):
            raise PermissionDenied("Keine Berechtigung zum Zugriff auf diesen Vertrag.")

        contract = TeachingContract.objects.filter(student=student).first()
        if request.method == "GET":
            return Response({
                "contract": (
                    TeachingContractSerializer(contract).data if contract else None
                )
            })

        if not is_admin:
            raise PermissionDenied("Vertragsdaten dürfen nur Administratoren ändern.")

        serializer = TeachingContractSerializer(instance=contract, data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            serializer.save(student=student)
        return Response({"contract": serializer.data})

    @action(detail=True, methods=["get", "post"], url_path="lesson-account")
    def lesson_account(self, request, pk=None):
        """Current or selected contract-year overview and administrator corrections."""
        from rest_framework.exceptions import PermissionDenied
        from apps.students.lesson_account import lesson_account_response, apply_lesson_account_change

        student = self.get_object()
        actor = request.user
        is_admin = actor.role == "admin"
        is_owner = actor.role == "student" and student.user_id == actor.id

        if not (is_admin or is_owner):
            raise PermissionDenied("Keine Berechtigung für diese Unterrichtsübersicht.")
        if request.method == "POST":
            if not is_admin:
                raise PermissionDenied("Nur Administratoren dürfen Unterrichtskonten ändern.")
            apply_lesson_account_change(student, actor, request.data)

        return Response(lesson_account_response(
            student,
            request.data.get("year_start") if request.method == "POST" else request.query_params.get("year_start"),
        ))

    @action(detail=False, methods=["get"], url_path="instruments")
    def instruments(self, request):
        """Return sorted unique instrument list: studio curated list + instruments used by existing students."""
        # 1. Instruments already assigned to students
        student_instruments = (
            self.get_queryset()
            .exclude(instrument="")
            .exclude(instrument__isnull=True)
            .values_list("instrument", flat=True)
            .distinct()
        )

        # 2. Curated list stored in studio settings
        curated: list = []
        studio = studio_for_request(request)
        if studio and isinstance(studio.settings, dict):
            curated = studio.settings.get("instruments", [])

        merged = sorted(
            {i.strip().title() for i in list(student_instruments) + curated if i and i.strip()}
        )
        return Response(merged)

    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request):
        """Return aggregate stats for the students the current user can access."""
        qs = self.get_queryset()
        total = qs.count()
        active = qs.filter(is_active=True).count()
        unassigned = qs.filter(primary_teacher__isnull=True).count()
        return Response(
            {
                "total_students": total,
                "active_students": active,
                "unassigned_students": unassigned,
            }
        )

    @action(detail=True, methods=["post"], url_path="set-password")
    def set_password(self, request, pk=None):
        """Activate the existing pupil's account; never create another account."""
        if request.user.role != "admin":
            return Response({"detail": "Only administrators can set student passwords."},
                            status=status.HTTP_403_FORBIDDEN)
        student = self.get_object()
        password = request.data.get("password")
        if not isinstance(password, str) or not password:
            return Response({"password": ["A password is required."]},
                            status=status.HTTP_400_BAD_REQUEST)
        if password != request.data.get("confirm_password"):
            return Response({"confirm_password": ["Passwords do not match."]},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_password(password, user=student.user)
        except DjangoValidationError as error:
            return Response({"password": error.messages}, status=status.HTTP_400_BAD_REQUEST)

        account = student.user
        if not account.is_active:
            return Response({"detail": "The student account is inactive."},
                            status=status.HTTP_400_BAD_REQUEST)
        account.set_password(password)
        account.is_approved = True
        account.save(update_fields=["password", "is_approved"])
        return Response({"detail": "Student login is ready."})

    def perform_create(self, serializer):
        user = self.request.user
        if user.role != "admin":
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Only admins can create students.")
        studio = studio_for_request(self.request)
        if studio is None:
            from rest_framework.exceptions import ValidationError

            raise ValidationError("No studio is associated with this account.")
        # In individual-teacher mode, new students belong to the owner by default.
        # An explicit teacher choice (including null) always takes precedence.
        extra = {"studio": studio}
        if "primary_teacher" not in self.request.data and (studio.settings or {}).get("solo_teacher_mode"):
            owner_teacher = Teacher.objects.filter(
                studio=studio, user=studio.owner, is_active=True
            ).first()
            if owner_teacher:
                extra["primary_teacher"] = owner_teacher
        serializer.save(**extra)


class FamilyViewSet(viewsets.ModelViewSet):
    """
    API endpoints for managing families
    """

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = FamilySerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["name", "primary_parent__last_name", "primary_parent__email", "students__user__last_name"]
    pagination_class = None

    def get_queryset(self):
        user = self.request.user
        queryset = Family.objects.select_related(
            "primary_parent", "secondary_parent"
        ).prefetch_related("students__user", "students__teaching_contract").filter(studio__in=studios_for_request(self.request)).order_by("name", "id")
        if user.role == "admin":
            return queryset
        # Expanded profiles contain private billing and contact data. Only admins
        # may access this management API; existing account relationships remain intact.
        return queryset.none()

    def _require_manager(self):
        if self.request.user.role != "admin":
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied("Nur Administratoren dürfen Familien bearbeiten.")

    def create(self, request, *args, **kwargs):
        self._require_manager()
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        studio = studio_for_request(self.request)
        if studio is None:
            from rest_framework.exceptions import ValidationError

            raise ValidationError("No studio is associated with this account.")
        serializer.save(studio=studio)

    def update(self, request, *args, **kwargs):
        self._require_manager()
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self._require_manager()
        return super().partial_update(request, *args, **kwargs)

    @action(detail=True, methods=["get"], url_path="available-students")
    def available_students(self, request, pk=None):
        self._require_manager()
        family = self.get_object()
        rows = Student.objects.filter(studio=family.studio, user__role="student",
            family__isnull=True).select_related("user").order_by("user__last_name", "user__first_name")
        return Response([{"id": str(s.pk), "name": s.user.get_full_name(), "instrument": s.instrument} for s in rows])

    @action(detail=True, methods=["get"], url_path="member-data")
    def member_data(self, request, pk=None):
        """Explicit import candidates from assigned students only."""
        self._require_manager()
        family = self.get_object()
        result = []
        for student in family.students.select_related("user", "billing_profile").filter(studio=family.studio):
            profile = getattr(student, "billing_profile", None)
            contacts = []
            if student.emergency_contact_name:
                contacts.append({"name": student.emergency_contact_name, "first_name": student.emergency_contact_first_name, "last_name": student.emergency_contact_last_name, "relation": "",
                    "phone": student.emergency_contact_phone, "email": ""})
            billing = None
            if profile:
                billing = StudentBillingProfileSerializer(profile).data
            result.append({"id": str(student.pk), "name": student.user.get_full_name(),
                           "contacts": contacts, "billing": billing})
        return Response(result)

    @action(detail=True, methods=["put"], url_path="members")
    @transaction.atomic
    def members(self, request, pk=None):
        self._require_manager()
        family = Family.objects.select_for_update().get(pk=self.get_object().pk)
        ids = request.data.get("student_ids")
        if not isinstance(ids, list):
            raise ValidationError({"student_ids": "Bitte eine Schülerliste übermitteln."})
        from uuid import UUID
        try:
            ids = {UUID(str(value)) for value in ids}
        except (ValueError, TypeError):
            raise ValidationError({"student_ids": "Ungültige Schüler-ID."})
        rows = list(Student.objects.select_for_update().filter(
            models.Q(pk__in=ids) | models.Q(family=family),
            studio=family.studio, user__role="student"))
        selected = [s for s in rows if s.pk in ids]
        if len(selected) != len(ids) or any(s.family_id not in (None, family.pk) for s in selected):
            raise ValidationError({"student_ids": "Schüler gehört einem anderen Studio oder einer anderen Familie an."})
        Student.objects.filter(family=family).exclude(pk__in=ids).update(family=None)
        Student.objects.filter(pk__in=ids, studio=family.studio).update(family=family)
        return Response(self.get_serializer(Family.objects.get(pk=family.pk)).data)

    def destroy(self, request, *args, **kwargs):
        self._require_manager()
        raise ValidationError("Familien können in dieser Ausbaustufe nicht gelöscht werden.")
