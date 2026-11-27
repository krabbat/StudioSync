from django.db import migrations, models


def backfill(apps, schema_editor):
    Participant = apps.get_model("lessons", "LessonParticipant")
    Series = apps.get_model("lessons", "ICloudCalendarSeries")
    Student = apps.get_model("core", "Student")
    db = schema_editor.connection.alias
    batch = []
    for participant in Participant.objects.using(db).select_related("student__user").iterator(chunk_size=500):
        participant.first_name_snapshot = participant.student.user.first_name
        participant.instrument_snapshot = participant.student.instrument
        batch.append(participant)
        if len(batch) >= 500:
            Participant.objects.using(db).bulk_update(batch, ["first_name_snapshot", "instrument_snapshot"])
            batch = []
    if batch:
        Participant.objects.using(db).bulk_update(batch, ["first_name_snapshot", "instrument_snapshot"])
    for series in Series.objects.using(db).exclude(group_booking={}).iterator(chunk_size=200):
        booking = series.group_booking
        if not isinstance(booking, dict):
            continue
        members = booking.get("members", [])
        ids = [member["id"] for member in members]
        pupils = {str(p.pk): p for p in Student.objects.using(db).filter(studio_id=series.studio_id, pk__in=ids).select_related("user")}
        for member in members:
            pupil = pupils.get(str(member["id"]))
            if pupil:
                member.setdefault("first_name", pupil.user.first_name)
                member.setdefault("instrument", pupil.instrument)
        series.group_booking = booking
        series.save(using=db, update_fields=["group_booking"])


class Migration(migrations.Migration):
    dependencies = [("lessons", "0014_group_calendar")]
    operations = [
        migrations.AddField(model_name="lessonparticipant", name="first_name_snapshot", field=models.CharField(max_length=150, blank=True)),
        migrations.AddField(model_name="lessonparticipant", name="instrument_snapshot", field=models.CharField(max_length=100, blank=True)),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
