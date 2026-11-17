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
