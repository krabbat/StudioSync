"""Profile history independent of annual tuition quotas and billing."""
from django.db.models import Q
from django.utils import timezone

from apps.core.models import TeachingContract
from apps.lessons.models import Lesson, LessonParticipant


def contract_start(student):
    return TeachingContract.objects.filter(student=student).values_list(
        "contract_start_date", flat=True
    ).first()


def completed_lessons(student, start):
    if start is None:
        return 0
    now = timezone.now()
    direct = Lesson.objects.filter(
        studio=student.studio, student=student,
        lesson_type__in=("private", "makeup"), status="completed",
        scheduled_start__date__gte=start, scheduled_start__lte=now,
    ).values_list("pk", flat=True)
    shared = LessonParticipant.objects.filter(
        student=student, lesson__studio=student.studio,
        lesson__scheduled_start__date__gte=start, lesson__scheduled_start__lte=now,
    ).filter(
        Q(status="completed") | Q(status="inherit", lesson__status="completed")
    ).values_list("lesson_id", flat=True)
    return len(set(direct).union(shared))


def next_lesson(student):
    return Lesson.objects.filter(
        studio=student.studio, status="scheduled", scheduled_start__gte=timezone.now(),
    ).filter(
        Q(student=student) | Q(participants__student=student, participants__status="inherit")
    ).order_by("scheduled_start").values_list("scheduled_start", flat=True).first()


def history_response(student):
    start = contract_start(student)
    return {
        "contract_start_date": start,
        "shared_lessons_total": max(0, completed_lessons(student, start) + student.shared_lessons_delta) if start else None,
        "next_lesson": next_lesson(student),
    }
