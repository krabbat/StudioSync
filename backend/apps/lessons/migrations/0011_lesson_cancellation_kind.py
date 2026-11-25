"""Track who cancelled a lesson so the annual tuition quota is correct."""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0010_lesson_guest_details"),
    ]

    operations = [
        migrations.AddField(
            model_name="lesson",
            name="cancellation_kind",
            field=models.CharField(
                max_length=20, blank=True, default="",
                choices=[
                    ("student_cancelled", "Student cancellation – credited"),
                    ("teacher_cancelled", "Teacher cancellation – not credited"),
                ],
            ),
        ),
    ]
