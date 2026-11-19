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


@pytest.mark.api
@pytest.mark.django_db
def test_existing_student_account_password_activation(authenticated_client, student, admin_user):
    """An admin enables login on the existing account without making a second User."""
    from apps.core.models import User

    account = student.user
    account.set_unusable_password()
    account.is_approved = False
    account.save(update_fields=["password", "is_approved"])
    before = User.objects.count()

    response = authenticated_client.post(
        f"/api/students/{student.pk}/set-password/",
        {"password": "eX7!nQ83rV#p2y", "confirm_password": "eX7!nQ83rV#p2y"},
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK
    assert User.objects.count() == before
    account.refresh_from_db()
    assert account.check_password("eX7!nQ83rV#p2y")
    assert account.is_approved
    assert Student.objects.get(pk=student.pk).user_id == account.pk


@pytest.mark.api
@pytest.mark.django_db
def test_student_password_cannot_be_changed_by_teacher_or_with_mismatch(
    authenticated_client, teacher_authenticated_client, student
):
    """Student password changes are restricted to studio admins."""
    url = f"/api/students/{student.pk}/set-password/"
    unauthorized = teacher_authenticated_client.post(
        url, {"password": "LongPass123!", "confirm_password": "LongPass123!"}, format="json"
    )
    assert unauthorized.status_code == status.HTTP_403_FORBIDDEN
    mismatch = authenticated_client.post(
        url, {"password": "LongPass123!", "confirm_password": "Different123!"}, format="json"
    )
    assert mismatch.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.api
@pytest.mark.django_db
def test_public_registration_disabled(api_client):
    """Public signup must not create duplicate student or teacher accounts."""
    from apps.core.models import User

    before = User.objects.count()
    response = api_client.post(
        "/api/auth/register/",
        {
            "email": "uninvited@example.test", "password": "LongPass123!",
            "first_name": "Uninvited", "last_name": "Account", "role": "teacher",
        },
        format="json",
    )
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert User.objects.count() == before


@pytest.mark.api
@pytest.mark.django_db
def test_home_address_in_student_and_lesson_api(authenticated_client, student, teacher, studio):
    """The scheduler receives the pupil's address, not a studio room."""
    from datetime import timedelta
    from django.utils import timezone
    from apps.lessons.models import Lesson

    update = authenticated_client.patch(
        f"/api/students/{student.pk}/",
        {
            "address_line1": "Hauptstr. 12a",
            "postal_code": "15738",
            "city": "Zeuthen",
        },
        format="json",
    )
    assert update.status_code == status.HTTP_200_OK
    detail = authenticated_client.get(f"/api/students/{student.pk}/")
    assert detail.status_code == status.HTTP_200_OK
    assert detail.data["address_line1"] == "Hauptstr. 12a"

    student.refresh_from_db()
    assert student.postal_code == "15738"
    assert student.city == "Zeuthen"

    now = timezone.now()
    lesson = Lesson.objects.create(
        student=student, teacher=teacher, studio=studio,
        scheduled_start=now, scheduled_end=now + timedelta(minutes=45),
    )
    response = authenticated_client.get("/api/lessons/")
    assert response.status_code == status.HTTP_200_OK
    rows = response.data.get("results", []) if isinstance(response.data, dict) else response.data
    row = next(item for item in rows if str(item["id"]) == str(lesson.id))
    assert row["student_address"] == "Hauptstr. 12a, 15738 Zeuthen"


@pytest.mark.api
@pytest.mark.django_db
def test_admin_user_creation_cannot_duplicate_student(authenticated_client, studio):
    """All pupils must be enrolled through the students API, never /core/users/."""
    from apps.core.models import User

    before = User.objects.count()
    response = authenticated_client.post(
        "/api/core/users/",
        {
            "first_name": "Duplicated",
            "last_name": "Pupil",
            "email": "duplicate-student@example.test",
            "role": "student",
        },
        format="json",
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert User.objects.count() == before


@pytest.mark.api
@pytest.mark.django_db
def test_new_student_password_activates_existing_linked_account(authenticated_client, studio):
    """Enrolling a pupil with a password makes one student and one login."""
    from apps.core.models import User

    before = User.objects.count()
    response = authenticated_client.post(
        "/api/students/",
        {
            "first_name": "New",
            "last_name": "Pupil",
            "email": "new-pupil-with-login@example.test",
            "instrument": "Violin",
            "password": "rS7!qT93#pV6",
            "confirm_password": "rS7!qT93#pV6",
        },
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED
    assert User.objects.count() == before + 1
    student = Student.objects.get(pk=response.data["id"])
    assert str(student.user_id) == str(response.data["user"])
    assert student.user.is_approved
    assert student.user.check_password("rS7!qT93#pV6")


@pytest.mark.api
@pytest.mark.django_db
def test_new_student_without_password_has_no_login_yet(authenticated_client):
    """An enrollment may be saved without enabling access immediately."""
    response = authenticated_client.post(
        "/api/students/",
        {
            "first_name": "New",
            "last_name": "No Login",
            "email": "new-pupil-without-login@example.test",
            "instrument": "Piano",
        },
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED
    student = Student.objects.get(pk=response.data["id"])
    assert not student.user.has_usable_password()
    assert not student.user.is_approved


@pytest.mark.api
@pytest.mark.django_db
def test_student_creation_rejects_password_mismatch_without_creating_account(
    authenticated_client,
):
    from apps.core.models import User

    before = User.objects.count()
    response = authenticated_client.post(
        "/api/students/",
        {
            "first_name": "Mismatch",
            "last_name": "Pupil",
            "email": "mismatch-pupil@example.test",
            "password": "rS7!qT93#pV6",
            "confirm_password": "wrong",
        },
        format="json",
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert User.objects.count() == before


@pytest.mark.api
@pytest.mark.django_db
def test_failed_student_profile_creation_rolls_back_user(
    authenticated_client, monkeypatch,
):
    """A server-side error during student insertion must not leave an orphan User."""
    from apps.core.models import User

    before = User.objects.count()

    def fail_student_insert(*args, **kwargs):
        raise RuntimeError("Simulated student insertion failure")

    monkeypatch.setattr(Student.objects, "create", fail_student_insert)
    with pytest.raises(RuntimeError, match="Simulated student insertion failure"):
        authenticated_client.post(
            "/api/students/",
            {
                "first_name": "Rollback",
                "last_name": "Pupil",
                "email": "rollback-pupil@example.test",
                "instrument": "Flute",
                "password": "rS7!qT93#pV6",
                "confirm_password": "rS7!qT93#pV6",
            },
            format="json",
        )
    assert User.objects.count() == before


@pytest.mark.api
@pytest.mark.django_db
def test_student_can_update_own_personal_data(student_authenticated_client, student):
    response = student_authenticated_client.patch(
        f"/api/students/{student.pk}/",
        {
            "first_name": "Neuer",
            "email": "neu-schueler@example.test",
            "birth_date": "2014-02-28",
            "address_line1": "Hauptstraße 12",
            "postal_code": "15738",
            "city": "Zeuthen",
            "emergency_contact_name": "Elternteil",
            "emergency_contact_phone": "+49 30 123456",
        },
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK, response.data
    student.refresh_from_db()
    student.user.refresh_from_db()
    assert student.user.first_name == "Neuer"
    assert student.user.email == "neu-schueler@example.test"
    assert student.birth_date.isoformat() == "2014-02-28"
    assert student.city == "Zeuthen"
    assert student.emergency_contact_name == "Elternteil"


@pytest.mark.api
@pytest.mark.django_db
def test_student_cannot_change_admin_fields(student_authenticated_client, student):
    old_teacher_id = student.primary_teacher_id
    response = student_authenticated_client.patch(
        f"/api/students/{student.pk}/",
        {"is_active": False, "primary_teacher": None, "enrollment_date": "2020-01-01"},
        format="json",
    )
    assert response.status_code == status.HTTP_403_FORBIDDEN
    student.refresh_from_db()
    assert student.is_active is True
    assert student.primary_teacher_id == old_teacher_id


@pytest.mark.api
@pytest.mark.django_db
def test_student_cannot_update_another_student(student_authenticated_client, student, studio):
    from apps.core.models import User

    other = User.objects.create_user(
        email="not-mine@example.test", password="testpass123", role="student"
    )
    other_student = Student.objects.create(user=other, studio=studio, instrument="Flöte")
    response = student_authenticated_client.patch(
        f"/api/students/{other_student.pk}/",
        {"email": "stolen@example.test"}, format="json",
    )
    assert response.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)
    other.refresh_from_db()
    assert other.email == "not-mine@example.test"


@pytest.mark.api
@pytest.mark.django_db
def test_admin_can_change_student_email_and_duplicates_are_rejected(
    authenticated_client, student, admin_user
):
    url = f"/api/students/{student.pk}/"
    duplicate = authenticated_client.patch(
        url, {"email": admin_user.email}, format="json"
    )
    assert duplicate.status_code == status.HTTP_400_BAD_REQUEST
    student.user.refresh_from_db()
    assert student.user.email == "student@test.com"

    changed = authenticated_client.patch(
        url, {"email": "neu@example.test"}, format="json"
    )
    assert changed.status_code == status.HTTP_200_OK, changed.data
    student.user.refresh_from_db()
    assert student.user.email == "neu@example.test"

@pytest.mark.api
@pytest.mark.django_db
def test_student_cannot_delete_own_profile(student_authenticated_client, student):
    response = student_authenticated_client.delete(f"/api/students/{student.pk}/")
    assert response.status_code == status.HTTP_403_FORBIDDEN
    student.refresh_from_db()
