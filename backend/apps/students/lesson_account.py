"""Annual tuition quota from the real lesson calendar, with explicitly audited adjustments."""

import calendar
from datetime import date, timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.core.models import (
    TeachingContract, TeachingYearAccount, TeachingLessonAdjustment,
    TeachingLessonClassification,
)
from apps.lessons.models import Lesson


def _anniversary(first, year):
    return date(year, first.month, min(first.day, calendar.monthrange(year, first.month)[1]))


def _year_limits(contract, requested):
    first = contract.contract_year_start
    today = timezone.localdate()
    current = _anniversary(first, today.year)
    if current > today:
        current = _anniversary(first, today.year - 1)
    if current < first:
        current = first

    if requested:
        try:
            selected = date.fromisoformat(requested)
        except (TypeError, ValueError):
            raise serializers.ValidationError({"year_start": "Ungültiges Vertragsjahresdatum."})
        if (selected < first or selected > current or
                selected != _anniversary(first, selected.year)):
            raise serializers.ValidationError({
                "year_start": "Das ausgewählte Datum ist kein Vertragsjahresbeginn."
            })
    else:
        selected = current
    end = _anniversary(first, selected.year + 1)
    return selected, end, current


def _entries_for(student, start, end):
    # Only student-specific private lessons and makeup lessons; never count
    # bands, group workshops or other types against the private tuition quota.
    return (
        Lesson.objects.filter(
            student=student, scheduled_start__date__gte=start,
            scheduled_start__date__lt=end,
            lesson_type__in=["private", "makeup"],
            status__in=["completed", "cancelled", "no_show"],
        )
        .select_related("cancelled_by", "tuition_classification")
        .order_by("scheduled_start")
    )


def lesson_account_response(student, requested_year=None):
    contract = TeachingContract.objects.filter(student=student).first()
    if contract is None:
        return {"available": False, "reason": "no_contract"}

    year_start, year_end, current_start = _year_limits(contract, requested_year)
    account = TeachingYearAccount.objects.filter(
        student=student, year_start=year_start
    ).first()
    quota = account.quota if account is not None else 46

    delivered = credited = student_cancelled = teacher_cancelled = makeups = unknown = 0
    entries = []
    for lesson in _entries_for(student, year_start, year_end):
        classification = getattr(lesson, "tuition_classification", None)
        # Ignore orphaned classification after a year boundary is changed.
        if classification is not None and (
            account is None or classification.year_account_id != account.id
        ):
            classification = None
        kind = classification.kind if classification else ""
        impact = 0
        if lesson.status == "completed":
            delivered += 1
            if lesson.lesson_type == "makeup":
                makeups += 1
                if kind == "makeup_credited":
                    impact = 1
                elif kind != "makeup_not_credited":
                    unknown += 1  # an unclassified makeup must not consume quota
            else:
                impact = 1
        elif kind == "student_cancelled":
            student_cancelled += 1
            impact = 1
        elif kind == "teacher_cancelled":
            teacher_cancelled += 1
        else:
            unknown += 1  # ambiguous cancellation: do not auto-charge
        credited += impact
        entries.append({
            "id": str(lesson.id),
            "date": timezone.localtime(lesson.scheduled_start).date().isoformat(),
            "status": lesson.status,
            "lesson_type": lesson.lesson_type,
            "kind": kind,
            "delivered": lesson.status == "completed",
            "credited": impact,
            "reason": classification.reason if classification else lesson.cancellation_reason,
        })

    adjustments = []
    if account is not None:
        for adj in account.adjustments.all().order_by("date", "created_at"):
            delivered += adj.delivered_delta
            credited += adj.credited_delta
            adjustments.append({
                "id": str(adj.id), "date": adj.date.isoformat(),
                "delivered_delta": adj.delivered_delta,
                "credited_delta": adj.credited_delta,
                "reason": adj.reason,
            })

    available_years = []
    if current_start >= contract.contract_year_start:
        for year in range(contract.contract_year_start.year, current_start.year + 1):
            anniversary = _anniversary(contract.contract_year_start, year)
            if contract.contract_year_start <= anniversary <= current_start:
                available_years.append(anniversary.isoformat())

    return {
        "available": True,
        "year_start": year_start.isoformat(),
        "year_end": (year_end - timedelta(days=1)).isoformat(),
        "available_years": available_years,
        "quota": quota,
        "quota_reason": account.quota_reason if account else "",
        "lesson_minutes": contract.lesson_minutes,
        "summary": {
            "delivered": delivered, "credited": credited, "remaining": quota - credited,
            "student_cancelled": student_cancelled,
            "teacher_cancelled": teacher_cancelled,
            "makeups": makeups,
            "unclassified": unknown,
        },
        "entries": entries,
        "adjustments": adjustments,
    }


class QuotaSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["set_quota"])
    quota = serializers.IntegerField(min_value=1, max_value=999)
    reason = serializers.CharField(max_length=1000, allow_blank=False, trim_whitespace=True)


class AdjustmentSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["add_adjustment"])
    date = serializers.DateField()
    delivered_delta = serializers.IntegerField(min_value=-999, max_value=999)
    credited_delta = serializers.IntegerField(min_value=-999, max_value=999)
    reason = serializers.CharField(max_length=1000, trim_whitespace=True)

    def validate(self, data):
        if data["delivered_delta"] == 0 and data["credited_delta"] == 0:
            raise serializers.ValidationError("Mindestens ein Korrekturwert muss ungleich null sein.")
        return data


class ClassificationSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["classify"])
    lesson_id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=[
        "student_cancelled", "teacher_cancelled",
        "makeup_credited", "makeup_not_credited",
    ])
    reason = serializers.CharField(max_length=1000, trim_whitespace=True)


@transaction.atomic
def apply_lesson_account_change(student, actor, data):
    contract = TeachingContract.objects.filter(student=student).first()
    if contract is None:
        raise serializers.ValidationError("Zuerst muss ein Vertrag hinterlegt sein.")
    year_start, end, _ = _year_limits(contract, data.get("year_start"))
    action = data.get("action")
    if action == "set_quota":
        validated = QuotaSerializer(data=data)
    elif action == "add_adjustment":
        validated = AdjustmentSerializer(data=data)
    elif action == "classify":
        validated = ClassificationSerializer(data=data)
    else:
        raise serializers.ValidationError({"action": "Unbekannte Aktion."})
    validated.is_valid(raise_exception=True)
    content = validated.validated_data

    if action == "add_adjustment" and not year_start <= content["date"] < end:
        raise serializers.ValidationError({"date": "Datum liegt außerhalb des Vertragsjahres."})

    if action == "classify":
        lesson = Lesson.objects.filter(
            pk=content["lesson_id"], student=student,
            scheduled_start__date__gte=year_start,
            scheduled_start__date__lt=end,
            lesson_type__in=["private", "makeup"],
        ).first()
        if lesson is None:
            raise serializers.ValidationError({"lesson_id": "Termin nicht gefunden."})
        kind = content["kind"]
        if kind.startswith("makeup_"):
            valid = lesson.status == "completed" and lesson.lesson_type == "makeup"
        else:
            valid = lesson.status in ["cancelled", "no_show"]
        if not valid:
            raise serializers.ValidationError({"kind": "Diese Zuordnung passt nicht zum Termin."})

    account, _ = TeachingYearAccount.objects.get_or_create(
        student=student, year_start=year_start, defaults={"quota": 46}
    )
    if action == "set_quota":
        account.quota = content["quota"]
        account.quota_reason = content["reason"]
        account.save(update_fields=["quota", "quota_reason", "updated_at"])
    elif action == "add_adjustment":
        TeachingLessonAdjustment.objects.create(
            year_account=account, date=content["date"],
            delivered_delta=content["delivered_delta"],
            credited_delta=content["credited_delta"],
            reason=content["reason"], created_by=actor,
        )
    else:
        TeachingLessonClassification.objects.update_or_create(
            lesson=lesson,
            defaults={
                "year_account": account, "kind": content["kind"],
                "reason": content["reason"], "updated_by": actor,
            },
        )
