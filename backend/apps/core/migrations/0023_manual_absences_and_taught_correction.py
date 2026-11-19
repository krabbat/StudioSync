# StudioSync: date-free taught total corrections and dated manual absences.
import uuid
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0022_teaching_lesson_account"),
    ]

    operations = [
        migrations.AddField(
            model_name="teachingyearaccount",
            name="manual_taught_delta",
            field=models.IntegerField(default=0),
        ),
        migrations.CreateModel(
            name="TeachingManualAbsence",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("date", models.DateField()),
                ("kind", models.CharField(max_length=20, choices=[
                    ("student_cancelled", "Schülerabsage – angerechnet"),
                    ("teacher_cancelled", "Lehrerausfall – nicht angerechnet"),
                ])),
                ("comment", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="core.user")),
                ("year_account", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="manual_absences", to="core.teachingyearaccount")),
            ],
            options={
                "db_table": "teaching_manual_absences",
                "ordering": ["date", "created_at"],
            },
        ),
    ]
