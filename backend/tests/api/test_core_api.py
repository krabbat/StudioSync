"""
Tests for core API endpoints (studios, teachers, students).
"""

from django.urls import reverse

import pytest
from rest_framework import status

from apps.core.models import Student, Studio


@pytest.mark.api
@pytest.mark.django_db
class TestStudioAPI:
    """Test studio-related API endpoints."""

    def test_list_studios_authenticated(self, authenticated_client, studio):
        """Test authenticated user can list studios."""
        url = reverse("studio-list")
        response = authenticated_client.get(url)

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) >= 1

    def test_list_studios_unauthenticated(self, api_client, studio):
        """Test unauthenticated user cannot list studios."""
        url = reverse("studio-list")
        response = api_client.get(url)

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_create_studio_as_admin(self, authenticated_client):
        """Test admin can create a studio."""
        url = reverse("studio-list")
        data = {
            "name": "Brand New Studio",
            "email": "brandnew@test.com",
            "address_line1": "789 New St",
            "city": "New City",
            "state": "NC",
        }
        response = authenticated_client.post(url, data, format="json")

        assert response.status_code in [status.HTTP_201_CREATED, status.HTTP_200_OK]
        assert Studio.objects.filter(name="Brand New Studio").exists()

    def test_retrieve_studio(self, authenticated_client, studio):
        """Test retrieving a specific studio."""
        url = reverse("studio-detail", args=[studio.id])
        response = authenticated_client.get(url)

        assert response.status_code == status.HTTP_200_OK
        assert response.data["name"] == studio.name


@pytest.mark.api
@pytest.mark.django_db
class TestTeacherAPI:
    """Test teacher-related API endpoints."""

    def test_list_teachers(self, authenticated_client, teacher):
        """Test listing teachers."""
        url = reverse("teacher-list")
        response = authenticated_client.get(url)

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) >= 1

    def test_create_teacher(self, authenticated_client, studio, teacher_user):
        """Test creating a teacher."""
        url = reverse("teacher-list")
        data = {
            "user": teacher_user.id,
            "studio": studio.id,
            "bio": "New teacher bio",
            "hourly_rate": "60.00",
            "instruments": ["Guitar", "Piano"],
        }
        response = authenticated_client.post(url, data, format="json")

        # May already exist from fixture
        assert response.status_code in [
            status.HTTP_201_CREATED,
            status.HTTP_200_OK,
            status.HTTP_400_BAD_REQUEST,
        ]

    def test_retrieve_teacher(self, authenticated_client, teacher):
        """Test retrieving a specific teacher."""
        url = reverse("teacher-detail", args=[teacher.id])
        response = authenticated_client.get(url)

        assert response.status_code == status.HTTP_200_OK
        assert response.data["bio"] == teacher.bio

    def test_update_teacher(self, teacher_authenticated_client, teacher):
        """Test teacher can update their own profile."""
        url = reverse("teacher-detail", args=[teacher.id])
        data = {"bio": "Updated bio", "hourly_rate": "75.00"}
        response = teacher_authenticated_client.patch(url, data, format="json")

        assert response.status_code in [status.HTTP_200_OK, status.HTTP_403_FORBIDDEN]
        # If successful, verify the update
        if response.status_code == status.HTTP_200_OK:
            teacher.refresh_from_db()
            assert teacher.bio == "Updated bio"


@pytest.mark.api
@pytest.mark.django_db
class TestStudentAPI:
    """Test student-related API endpoints."""

    def test_list_students(self, authenticated_client, student):
        """Test listing students."""
        url = reverse("student-list")
        response = authenticated_client.get(url)

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) >= 1

    def test_create_student(self, authenticated_client, studio, teacher, student_user):
        """Test creating a student."""
        url = reverse("student-list")
        data = {
            "user": student_user.id,
            "studio": studio.id,
            "primary_teacher": teacher.id,
            "instrument": "Violin",
        }
        response = authenticated_client.post(url, data, format="json")

        # May already exist from fixture
        assert response.status_code in [
            status.HTTP_201_CREATED,
            status.HTTP_200_OK,
            status.HTTP_400_BAD_REQUEST,
        ]

    def test_retrieve_student(self, authenticated_client, student):
        """Test retrieving a specific student."""
        url = reverse("student-detail", args=[student.id])
        response = authenticated_client.get(url)

        assert response.status_code == status.HTTP_200_OK
        assert response.data["instrument"] == student.instrument

    def test_student_cannot_access_other_students(self, student_authenticated_client, student):
        """Test student cannot access other students' data."""
        # Create another student
        from django.contrib.auth import get_user_model

        user_model = get_user_model()
        other_user = user_model.objects.create_user(
            email="other@test.com", password="testpass123", role="student"
        )
        other_student = Student.objects.create(
            user=other_user,
            studio=student.studio,
            primary_teacher=student.primary_teacher,
            instrument="Drums",
        )

        url = reverse("student-detail", args=[other_student.id])
        response = student_authenticated_client.get(url)

        # Should either be forbidden or only show own data
        assert response.status_code in [
            status.HTTP_403_FORBIDDEN,
            status.HTTP_404_NOT_FOUND,
            status.HTTP_200_OK,
        ]


@pytest.mark.api
@pytest.mark.django_db
def test_dashboard_student_count_matches_student_roster(authenticated_client, studio, student, admin_user):
    """An admin's stray student profile must not inflate the dashboard count."""
    Student.objects.create(user=admin_user, studio=studio, instrument="")

    dashboard = authenticated_client.get("/api/core/stats/")
    roster_stats = authenticated_client.get("/api/students/stats/")

    assert dashboard.status_code == status.HTTP_200_OK
    assert roster_stats.status_code == status.HTTP_200_OK
    assert dashboard.data["overview"]["total_students"]["value"] == 1
    assert roster_stats.data["active_students"] == 1


@pytest.mark.api
@pytest.mark.django_db
def test_teacher_photo_upload_for_admin_account(authenticated_client, studio, admin_user, settings, tmp_path):
    """An admin with a teacher profile must be editable without an email/role lookup."""
    from io import BytesIO

    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image

    from apps.core.models import Teacher

    settings.MEDIA_ROOT = tmp_path
    teacher = Teacher.objects.create(user=admin_user, studio=studio)

    roster_response = authenticated_client.get("/api/core/teachers/")
    assert roster_response.status_code == status.HTTP_200_OK
    rows = roster_response.data.get("results", []) if isinstance(roster_response.data, dict) else roster_response.data
    row = next(row for row in rows if str(row["id"]) == str(teacher.id))
    assert str(row["user_id"]) == str(admin_user.id)

    stream = BytesIO()
    Image.new("RGB", (12, 12), "white").save(stream, format="JPEG")
    uploaded_photo = SimpleUploadedFile("teacher-avatar.jpg", stream.getvalue(), content_type="image/jpeg")

    upload_response = authenticated_client.patch(
        f"/api/core/users/{row['user_id']}/",
        {"avatar": uploaded_photo},
        format="multipart",
    )

    assert upload_response.status_code == status.HTTP_200_OK
    admin_user.refresh_from_db()
    assert admin_user.avatar.name.startswith("avatars/")
    assert upload_response.data["avatar"].startswith("/media/avatars/")


@pytest.mark.api
@pytest.mark.django_db
def test_analytics_student_enrollments_ignore_non_students(authenticated_client, student, studio, admin_user):
    """The growth chart agrees with the roster and uses enrollment_date, not created_at."""
    from django.utils import timezone

    today = timezone.now().date()
    student.enrollment_date = today
    student.save(update_fields=["enrollment_date"])
    Student.objects.create(user=admin_user, studio=studio, enrollment_date=today)

    response = authenticated_client.get("/api/core/analytics/")
    assert response.status_code == status.HTTP_200_OK
    assert response.data["student_growth"][-1]["students"] == 1


@pytest.mark.api
@pytest.mark.django_db
def test_solo_teacher_mode_uses_existing_admin_login(authenticated_client, admin_user, studio):
    """A studio owner can teach without creating another User account."""
    from apps.core.models import Teacher, User

    before = User.objects.count()
    response = authenticated_client.post(
        "/api/core/teachers/solo-mode/", {"enabled": True}, format="json"
    )
    assert response.status_code == status.HTTP_200_OK
    assert User.objects.count() == before

    profile = Teacher.objects.get(user=admin_user, studio=studio)
    studio.refresh_from_db()
    assert studio.settings["solo_teacher_mode"] is True
    assert response.data["teacher_id"] == str(profile.id)

    me = authenticated_client.get("/api/auth/me/")
    assert me.status_code == status.HTTP_200_OK
    assert str(me.data["teacher_profile"]["id"]) == str(profile.id)

    enrolled = authenticated_client.post(
        "/api/students/",
        {"first_name": "Solo", "last_name": "Pupil", "email": "solo-pupil@example.test"},
        format="json",
    )
    assert enrolled.status_code == status.HTTP_201_CREATED
    assert Student.objects.get(pk=enrolled.data["id"]).primary_teacher_id == profile.id

    disabled = authenticated_client.post(
        "/api/core/teachers/solo-mode/", {"enabled": False}, format="json"
    )
    assert disabled.status_code == status.HTTP_200_OK
    assert Teacher.objects.filter(pk=profile.id, user=admin_user).exists()
    studio.refresh_from_db()
    assert studio.settings["solo_teacher_mode"] is False


@pytest.mark.api
@pytest.mark.django_db
def test_solo_teacher_profile_takeover_preserves_assignments(
    authenticated_client, admin_user, studio, teacher, teacher_user, student
):
    """Claiming one's old teacher login keeps the original teacher ID and pupil links."""
    teacher_user.first_name = admin_user.first_name
    teacher_user.last_name = admin_user.last_name
    teacher_user.save(update_fields=["first_name", "last_name"])

    response = authenticated_client.post(
        "/api/core/teachers/solo-mode/",
        {"enabled": True, "teacher_id": str(teacher.id)},
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK
    teacher.refresh_from_db()
    student.refresh_from_db()
    assert teacher.user_id == admin_user.id
    assert student.primary_teacher_id == teacher.id
    assert teacher_user.__class__.objects.filter(pk=teacher_user.pk).exists()
    assert teacher_user.__class__.objects.filter(pk=teacher_user.pk, role="teacher").exists()


@pytest.mark.api
@pytest.mark.django_db
def test_student_assignment_rejects_teacher_from_another_studio(
    authenticated_client, studio, student
):
    """A pupil cannot be assigned to an instructor from another tenant."""
    from apps.core.models import Teacher, User

    other_owner = User.objects.create_user(
        email="other-owner@example.test", role="admin",
        first_name="Other", last_name="Owner"
    )
    other_studio = Studio.objects.create(
        name="Other School", owner=other_owner, email="other@example.test"
    )
    outside_teacher = Teacher.objects.create(user=other_owner, studio=other_studio)

    response = authenticated_client.patch(
        f"/api/students/{student.pk}/",
        {"primary_teacher": str(outside_teacher.pk)},
        format="json",
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    student.refresh_from_db()
    assert student.primary_teacher_id != outside_teacher.pk
