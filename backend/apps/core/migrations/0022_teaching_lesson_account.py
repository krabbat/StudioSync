# StudioSync: separate accounting from existing calendar entries.
import uuid
import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0021_teaching_contract"),
        ("lessons", "0008_external_calendar_models"),
    ]

    operations = [
        migrations.CreateModel(
            name="TeachingYearAccount",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("year_start", models.DateField()),
                ("quota", models.PositiveSmallIntegerField(default=46, validators=[django.core.validators.MinValueValidator(1)])),
                ("quota_reason", models.TextField(blank=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("student", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="teaching_years", to="core.student")),
            ],
            options={"db_table": "teaching_year_accounts"},
        ),
        migrations.AddConstraint(
            model_name="teachingyearaccount",
            constraint=models.UniqueConstraint(fields=("student", "year_start"), name="unique_teaching_year"),
        ),
        migrations.CreateModel(
            name="TeachingLessonClassification",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("kind", models.CharField(max_length=25, choices=[
                    ("student_cancelled", "Schülerabsage – angerechnet"),
                    ("teacher_cancelled", "Lehrerausfall – nicht angerechnet"),
                    ("makeup_credited", "Nachholstunde – angerechnet"),
                    ("makeup_not_credited", "Nachholstunde – bereits angerechnet"),
                ])),
                ("reason", models.TextField()),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("lesson", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="tuition_classification", to="lessons.lesson")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="core.user")),
                ("year_account", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="classifications", to="core.teachingyearaccount")),
            ],
            options={"db_table": "teaching_lesson_classifications"},
        ),
        migrations.CreateModel(
            name="TeachingLessonAdjustment",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("date", models.DateField()),
                ("delivered_delta", models.SmallIntegerField(default=0)),
                ("credited_delta", models.SmallIntegerField(default=0)),
                ("reason", models.TextField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="core.user")),
                ("year_account", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="adjustments", to="core.teachingyearaccount")),
            ],
            options={"db_table": "teaching_lesson_adjustments", "ordering": ["date", "created_at"]},
        ),
    ]
