from datetime import timedelta

import pytest
from django.utils import timezone

from apps.core.models import TeachingContract
from apps.lessons.models import Lesson, LessonParticipant
from apps.students.lesson_account import lesson_account_response


@pytest.mark.django_db
def test_profile_history_contract_count_edit_and_next_appointment(authenticated_client, student_authenticated_client, studio, teacher, student):
    now = timezone.now()
    start = timezone.localdate() - timedelta(days=60)
    TeachingContract.objects.create(
        student=student, contract_start_date=start, contract_year_start=start,
        lesson_minutes=45, monthly_amount=135,
    )

    def lesson(days, status="completed", kind="private", direct=True):
        scheduled = now + timedelta(days=days)
        return Lesson.objects.create(
            studio=studio, teacher=teacher, student=student if direct else None,
            scheduled_start=scheduled, scheduled_end=scheduled + timedelta(minutes=45),
            status=status, lesson_type=kind,
        )

    lesson(-80)
    lesson(-5)
    lesson(-4, "cancelled")
    shared = lesson(-3, kind="group", direct=False)
    LessonParticipant.objects.create(lesson=shared, student=student, name_snapshot="Test")
    absent = lesson(-2, kind="group", direct=False)
    LessonParticipant.objects.create(lesson=absent, student=student, name_snapshot="Test", status="student_cancelled")
    lesson(1, "cancelled")
    upcoming = lesson(2, "scheduled", kind="group", direct=False)
    LessonParticipant.objects.create(lesson=upcoming, student=student, name_snapshot="Test")
    lesson(3, "scheduled")

    url = f"/api/students/{student.pk}/"
    response = authenticated_client.get(url)
    assert response.status_code == 200, response.data
    assert response.data["contract_start_date"] == start.isoformat()
    assert response.data["shared_lessons_total"] == 2
    from datetime import datetime
    assert datetime.fromisoformat(response.data["next_lesson"]) == upcoming.scheduled_start
    before = lesson_account_response(student)["summary"]
    edit = authenticated_client.post(url + "lesson-history/", {"shared_lessons_total": 100}, format="json")
    assert edit.status_code == 200, edit.data
    assert edit.data["shared_lessons_total"] == 100
    assert lesson_account_response(student)["summary"] == before
    lesson(-1)
    assert authenticated_client.get(url).data["shared_lessons_total"] == 101
    assert student_authenticated_client.post(url + "lesson-history/", {"shared_lessons_total": 1}, format="json").status_code == 403
    assert authenticated_client.post(url + "lesson-history/", {"shared_lessons_total": -1}, format="json").status_code == 400


@pytest.mark.django_db
def test_profile_history_without_contract(authenticated_client, student):
    url = f"/api/students/{student.pk}/"
    response = authenticated_client.get(url)
    assert response.status_code == 200
    assert response.data["contract_start_date"] is None
    assert response.data["shared_lessons_total"] is None
    assert authenticated_client.post(url + "lesson-history/", {"shared_lessons_total": 1}, format="json").status_code == 400
