"""Calendar cancellation responsibility determines annual tuition quota credit."""
from datetime import datetime, date, time, timedelta

import pytest
from django.utils import timezone

from apps.core.models import TeachingContract
from apps.lessons.models import Lesson
from apps.students.lesson_account import lesson_account_response


@pytest.fixture
def quota_lesson(db, studio, teacher, student):
    # Use a date within the active contractual year regardless of test execution date.
    year_start = date(timezone.localdate().year, 1, 1)
    TeachingContract.objects.create(
        student=student,
        contract_start_date=year_start,
        contract_year_start=year_start,
        lesson_minutes=45,
        monthly_amount="135.00",
    )
    start = timezone.make_aware(datetime.combine(date(year_start.year, 6, 15), time(15, 0)))
    lesson = Lesson(
        studio=studio, student=student, teacher=teacher, lesson_type="private",
        status="scheduled", scheduled_start=start,
        scheduled_end=start + timedelta(minutes=45),
    )
    # Skip unrelated notification hooks.
    Lesson.objects.bulk_create([lesson])
    return lesson, student, year_start


@pytest.mark.django_db
def test_teacher_cancellation_is_visible_but_not_credited(
    authenticated_client, quota_lesson,
):
    lesson, student, year_start = quota_lesson
    reply = authenticated_client.patch(
        f"/api/lessons/{lesson.pk}/",
        {
            "status": "cancelled",
            "cancellation_kind": "teacher_cancelled",
            "cancellation_reason": "Lehrkraft ist verhindert",
        },
        format="json",
    )
    assert reply.status_code == 200, reply.data
    lesson.refresh_from_db()
    assert lesson.status == "cancelled"
    assert lesson.cancellation_kind == "teacher_cancelled"

    account = lesson_account_response(student, year_start.isoformat())
    assert account["summary"]["credited"] == 0
    assert account["summary"]["remaining"] == 44
    assert account["summary"]["teacher_cancelled"] == 1
    assert account["summary"]["student_cancelled"] == 0

    listing = authenticated_client.get("/api/lessons/")
    entries = listing.data.get("results", []) if isinstance(listing.data, dict) else listing.data
    row = next(x for x in entries if str(x["id"]) == str(lesson.id))
    assert row["cancellation_kind"] == "teacher_cancelled"


@pytest.mark.django_db
def test_student_cancellation_counts_as_one_unit_and_can_be_corrected(
    authenticated_client, quota_lesson,
):
    lesson, student, year_start = quota_lesson
    for category, expected_credited in [
        ("student_cancelled", 1),
        ("teacher_cancelled", 0),
    ]:
        reply = authenticated_client.patch(
            f"/api/lessons/{lesson.pk}/",
            {"status": "cancelled", "cancellation_kind": category},
            format="json",
        )
        assert reply.status_code == 200, reply.data
        account = lesson_account_response(student, year_start.isoformat())
        assert account["summary"]["credited"] == expected_credited
        assert account["summary"]["remaining"] == 44 - expected_credited


@pytest.mark.django_db
def test_single_delete_can_record_teacher_cancellation_without_deleting_quota(
    authenticated_client, quota_lesson,
):
    lesson, student, year_start = quota_lesson
    reply = authenticated_client.delete(
        f"/api/lessons/{lesson.pk}/?scope=this&cancellation_kind=teacher_cancelled"
    )
    assert reply.status_code == 200, reply.data
    lesson.refresh_from_db()
    assert lesson.status == "cancelled"
    assert lesson.cancellation_kind == "teacher_cancelled"
    account = lesson_account_response(student, year_start.isoformat())
    assert account["summary"]["teacher_cancelled"] == 1
    assert account["summary"]["credited"] == 0
    assert account["summary"]["remaining"] == 44


@pytest.mark.django_db
def test_rescheduling_clears_old_cancellation_kind(authenticated_client, quota_lesson):
    lesson, student, year_start = quota_lesson
    cancelled = authenticated_client.patch(
        f"/api/lessons/{lesson.pk}/",
        {"status": "cancelled", "cancellation_kind": "teacher_cancelled"},
        format="json",
    )
    assert cancelled.status_code == 200, cancelled.data
    revived = authenticated_client.patch(
        f"/api/lessons/{lesson.pk}/", {"status": "scheduled"}, format="json",
    )
    assert revived.status_code == 200, revived.data
    lesson.refresh_from_db()
    assert lesson.cancellation_kind == ""
    assert lesson.status == "scheduled"
    assert lesson_account_response(student, year_start.isoformat())["summary"]["teacher_cancelled"] == 0


@pytest.mark.django_db
def test_invalid_cancellation_kind_is_rejected(authenticated_client, quota_lesson):
    lesson, _student, _year_start = quota_lesson
    reply = authenticated_client.patch(
        f"/api/lessons/{lesson.pk}/",
        {"status": "cancelled", "cancellation_kind": "invalid"},
        format="json",
    )
    assert reply.status_code == 400
    lesson.refresh_from_db()
    assert lesson.status == "scheduled"
