import uuid
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone

from rest_framework import serializers

from apps.core.models import Student, TeachingContract, User
from apps.core.international_email import InternationalEmailField
from apps.core.tenancy import studio_for_request


class StudentListSerializer(serializers.ModelSerializer):
    """Serializer for listing students"""

    name = serializers.SerializerMethodField()
    email = serializers.CharField(source="contact_email", read_only=True)
    avatar = serializers.SerializerMethodField()
    teacher_name = serializers.CharField(
        source="primary_teacher.user.get_full_name", read_only=True, allow_null=True
    )
    status = serializers.SerializerMethodField()
    next_lesson = serializers.SerializerMethodField()

    class Meta:
        model = Student
        fields = [
            "id",
            "name",
            "email",
            "avatar",
            "enrollment_date",
            "instrument",
            "address_line1",
            "postal_code",
            "city",
            "teacher_name",
            "primary_teacher",
            "status",
            "next_lesson",
            "is_active",
        ]

    def get_name(self, obj):
        return obj.user.get_full_name()

    def get_avatar(self, obj):
        if obj.user.avatar:
            return obj.user.avatar.url
        return None

    def get_status(self, obj):
        return "active" if obj.is_active else "inactive"

    def get_next_lesson(self, obj):
        from apps.students.lesson_history import next_lesson
        value = next_lesson(obj)
        return value.isoformat() if value else None


class StudentDetailSerializer(serializers.ModelSerializer):
    """Detailed serializer for single student"""

    name = serializers.CharField(source="user.get_full_name", read_only=True)
    email = serializers.CharField(source="contact_email", read_only=True)
    phone = serializers.CharField(source="user.phone", read_only=True)
    avatar = serializers.SerializerMethodField()
    teacher = serializers.SerializerMethodField()
    login_enabled = serializers.SerializerMethodField()
    login_email = serializers.SerializerMethodField()
    contract_start_date = serializers.SerializerMethodField()
    shared_lessons_total = serializers.SerializerMethodField()
    next_lesson = serializers.SerializerMethodField()

    def _history(self, obj):
        from apps.students.lesson_history import history_response
        if not hasattr(self, "_profile_history"):
            self._profile_history = {}
        if obj.pk not in self._profile_history:
            self._profile_history[obj.pk] = history_response(obj)
        return self._profile_history[obj.pk]

    def get_contract_start_date(self, obj):
        value = self._history(obj)["contract_start_date"]
        return value.isoformat() if value else None

    def get_shared_lessons_total(self, obj):
        return self._history(obj)["shared_lessons_total"]

    def get_next_lesson(self, obj):
        value = self._history(obj)["next_lesson"]
        return value.isoformat() if value else None

    def get_login_email(self, obj):
        actor = getattr(self.context.get("request"), "user", None)
        if not actor or (actor.role != "admin" and actor.pk != obj.user_id):
            return ""
        return "" if obj.user.email.casefold().endswith(".invalid") else obj.user.email
    family_name = serializers.SerializerMethodField()

    def get_family_name(self, obj):
        return str(obj.family) if obj.family_id else None

    class Meta:
        model = Student
        fields = "__all__"

    def get_avatar(self, obj):
        if obj.user.avatar:
            return obj.user.avatar.url
        return None

    def get_login_enabled(self, obj):
        account = obj.user
        return account.is_active and account.is_approved and account.has_usable_password()

    def get_teacher(self, obj):
        if obj.primary_teacher:
            return {
                "id": str(obj.primary_teacher.id),
                "name": obj.primary_teacher.user.get_full_name(),
            }
        return None


class AdditionalGuardianSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=100)
    last_name = serializers.CharField(max_length=100)
    phone = serializers.CharField(max_length=20)
    email = InternationalEmailField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        # A supplied list replaces all additional guardians, even on a PATCH.
        # DRF skips required fields in nested serializers when the root is
        # partial, so explicitly require each complete contact here.
        missing = {key: "Dieses Feld ist erforderlich."
                   for key in ("first_name", "last_name", "phone")
                   if key not in attrs}
        if missing:
            raise serializers.ValidationError(missing)
        attrs.setdefault("email", "")
        return attrs


class StudentCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating students with nested user data"""

    # Return the linked account ID directly on creation, so avatar upload does not
    # depend on a second student-detail request.
    user = serializers.UUIDField(source="user_id", read_only=True)
    first_name = serializers.CharField(write_only=True)
    last_name = serializers.CharField(write_only=True)
    email = InternationalEmailField(write_only=True, required=False, allow_blank=True)
    login_email = InternationalEmailField(write_only=True, required=False, allow_blank=True)
    access_mode = serializers.ChoiceField(choices=["none", "own"], write_only=True, required=False)
    phone = serializers.CharField(write_only=True, required=False, allow_blank=True)
    additional_guardians = AdditionalGuardianSerializer(many=True, required=False)
    password = serializers.CharField(
        write_only=True, required=False, allow_blank=True, trim_whitespace=False,
        style={"input_type": "password"},
    )
    confirm_password = serializers.CharField(
        write_only=True, required=False, allow_blank=True, trim_whitespace=False,
        style={"input_type": "password"},
    )

    class Meta:
        model = Student
        fields = [
            "id",
            "user",
            "first_name",
            "last_name",
            "email",
            "phone",
            "password",
            "confirm_password",
            "instrument",
            "instruments",
            "family",
            "studio",
            "birth_date",
            "enrollment_date",
            "address_line1",
            "postal_code",
            "city",
            "emergency_contact_name",
            "emergency_contact_first_name", "emergency_contact_last_name", "contact_email", "login_email", "access_mode",
            "emergency_contact_phone",
            "additional_guardians",
            "primary_teacher",
            "is_active",
        ]
        read_only_fields = ["studio"]

    def validate_email(self, email):
        return User.objects.normalize_email(email.strip())

    def validate_family(self, family):
        request = self.context.get("request")
        if not request or request.user.role != "admin":
            raise serializers.ValidationError("Nur Administratoren dürfen Familien zuordnen.")
        studio = self.instance.studio if self.instance else studio_for_request(request)
        if family and (not studio or family.studio_id != studio.id or family.archived_at):
            raise serializers.ValidationError("Familie gehört nicht zu diesem Studio.")
        return family

    def validate_primary_teacher(self, teacher):
        if teacher is None:
            return None
        request = self.context.get("request")
        studio = self.instance.studio if self.instance else (
            studio_for_request(request) if request else None
        )
        if studio is None or teacher.studio_id != studio.id or not teacher.is_active:
            raise serializers.ValidationError("Select an active teacher from your own studio.")
        return teacher

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if self.instance is not None and (
            "password" in attrs or "confirm_password" in attrs
        ):
            raise serializers.ValidationError(
                {"password": "Change an existing student's password through their profile."}
            )

        if self.instance and "access_mode" in attrs:
            raise serializers.ValidationError({"access_mode": "Zugang im Profil verwalten."})
        mode = attrs.get("access_mode", "own" if attrs.get("password") else "none")
        if not self.instance:
            login = attrs.get("login_email") or attrs.get("email", "")
            if mode == "own":
                if not login or login.lower().endswith(".invalid") or not attrs.get("password"):
                    raise serializers.ValidationError({"login_email": "Eigener Zugang benötigt eine echte Login-E-Mail und ein Passwort."})
                if User.objects.filter(email__iexact=login).exists():
                    raise serializers.ValidationError({"login_email": "Diese Login-Adresse ist bereits vergeben."})
            elif attrs.get("password"):
                raise serializers.ValidationError({"password": "Ohne eigenen Zugang kein Passwort angeben."})
        elif "login_email" in attrs:
            raise serializers.ValidationError({"login_email": "Login-Adresse separat verwalten."})
        if "emergency_contact_first_name" in attrs or "emergency_contact_last_name" in attrs:
            first = attrs.get("emergency_contact_first_name", getattr(self.instance, "emergency_contact_first_name", ""))
            last = attrs.get("emergency_contact_last_name", getattr(self.instance, "emergency_contact_last_name", ""))
            attrs["emergency_contact_name"] = " ".join(x for x in (first, last) if x)
        elif "emergency_contact_name" in attrs:
            parts = attrs["emergency_contact_name"].split(maxsplit=1)
            attrs["emergency_contact_first_name"] = parts[0] if len(parts)==2 else ""
            attrs["emergency_contact_last_name"] = parts[-1] if parts else ""
        password = attrs.get("password", "")
        confirmation = attrs.get("confirm_password", "")
        if password != confirmation:
            raise serializers.ValidationError(
                {"confirm_password": "Passwords do not match."}
            )
        if password:
            account = User(
                email=attrs.get("email", ""),
                first_name=attrs.get("first_name", ""),
                last_name=attrs.get("last_name", ""),
                role="student",
            )
            try:
                validate_password(password, user=account)
            except DjangoValidationError as error:
                raise serializers.ValidationError({"password": error.messages})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        # DateField must receive a date (not a datetime) for correct response serialization.
        validated_data.setdefault("enrollment_date", timezone.localdate())
        password = validated_data.pop("password", "")
        validated_data.pop("confirm_password", None)
        mode = validated_data.pop("access_mode", "own" if password else "none")
        contact = validated_data.pop("email", "")
        login = validated_data.pop("login_email", "") or contact
        validated_data.setdefault("contact_email", contact)
        user_data = {
            "first_name": validated_data.pop("first_name"),
            "last_name": validated_data.pop("last_name"),
            "email": login if mode == "own" else f"student-{uuid.uuid4().hex}@example.invalid",
            "phone": validated_data.pop("phone", ""),
            "role": "student",
            "is_active": True,
            "is_approved": bool(password),
        }

        # Check if user exists (by email) -> Logical decision: for now fail if exists, or link?
        # MVP: Fail if exists to avoid account hijacking.
        if User.objects.filter(email=user_data["email"]).exists():
            raise serializers.ValidationError({"email": "User with this email already exists."})

        user = User.objects.create_user(password=password or None, **user_data)

        # Get studio context from view
        if "studio" not in validated_data:
            # This relies on perform_create in view to pass studio or defaults
            pass

        # Check if student profile was already created by signal
        if hasattr(user, "student_profile"):
            student = user.student_profile
            # Update with validated data
            for key, value in validated_data.items():
                setattr(student, key, value)
            student.save()
        else:
            student = Student.objects.create(user=user, **validated_data)

        return student

    @transaction.atomic
    def update(self, instance, validated_data):
        # Handle user updates if provided
        user = instance.user
        if "first_name" in validated_data:
            user.first_name = validated_data.pop("first_name")
        if "last_name" in validated_data:
            user.last_name = validated_data.pop("last_name")
        if "phone" in validated_data:
            user.phone = validated_data.pop("phone")
        if "email" in validated_data:
            validated_data["contact_email"] = validated_data.pop("email")
        user.save()

        previous_family = instance.family_id
        updated = super().update(instance, validated_data)
        if previous_family and previous_family != updated.family_id:
            from apps.core.models import FamilyAccess
            for grant in FamilyAccess.objects.filter(family_id=previous_family, students=updated):
                grant.students.remove(updated)
            FamilyAccess.objects.filter(family_id=previous_family, user_id=updated.user_id).delete()
        return updated


class TeachingContractSerializer(serializers.ModelSerializer):
    """Tuition-specific contract fields; student association comes from the URL."""

    class Meta:
        model = TeachingContract
        fields = [
            "id", "contract_start_date", "contract_year_start",
            "lesson_minutes", "monthly_amount", "price_kind",
            "special_agreements",
        ]
        read_only_fields = ["id"]

