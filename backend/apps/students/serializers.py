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
    email = serializers.EmailField(source="user.email", read_only=True)
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
        # This might be N+1 if not careful, but okay for MVP with small lists
        from apps.lessons.models import Lesson

        next_l = (
            Lesson.objects.filter(
                student=obj, status="scheduled", scheduled_start__gte=timezone.now()
            )
            .order_by("scheduled_start")
            .first()
        )

        if next_l:
            return next_l.scheduled_start
        return None


class StudentDetailSerializer(serializers.ModelSerializer):
    """Detailed serializer for single student"""

    name = serializers.CharField(source="user.get_full_name", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    phone = serializers.CharField(source="user.phone", read_only=True)
    avatar = serializers.SerializerMethodField()
    teacher = serializers.SerializerMethodField()
    login_enabled = serializers.SerializerMethodField()
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


class StudentCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating students with nested user data"""

    # Return the linked account ID directly on creation, so avatar upload does not
    # depend on a second student-detail request.
    user = serializers.UUIDField(source="user_id", read_only=True)
    first_name = serializers.CharField(write_only=True)
    last_name = serializers.CharField(write_only=True)
    email = InternationalEmailField(write_only=True)
    phone = serializers.CharField(write_only=True, required=False, allow_blank=True)
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
            "emergency_contact_phone",
            "primary_teacher",
            "is_active",
        ]
        read_only_fields = ["studio"]

    def validate_email(self, email):
        email = User.objects.normalize_email(email.strip())
        accounts = User.objects.filter(email__iexact=email)
        if self.instance is not None:
            accounts = accounts.exclude(pk=self.instance.user_id)
        if accounts.exists():
            raise serializers.ValidationError("Diese E-Mail-Adresse ist bereits vergeben.")
        return email

    def validate_family(self, family):
        request = self.context.get("request")
        if not request or request.user.role != "admin":
            raise serializers.ValidationError("Nur Administratoren dürfen Familien zuordnen.")
        studio = self.instance.studio if self.instance else studio_for_request(request)
        if family and (not studio or family.studio_id != studio.id):
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
        user_data = {
            "first_name": validated_data.pop("first_name"),
            "last_name": validated_data.pop("last_name"),
            "email": validated_data.pop("email"),
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
            user.email = validated_data.pop("email")
        user.save()

        return super().update(instance, validated_data)


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

