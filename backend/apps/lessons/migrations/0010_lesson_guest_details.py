"""Optional name and address for appointments outside the student register."""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0009_icloud_calendar_sync"),
    ]

    operations = [
        migrations.AddField(
            model_name="lesson", name="guest_name",
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name="lesson", name="guest_address",
            field=models.CharField(blank=True, max_length=500),
        ),
    ]
