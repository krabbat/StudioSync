"""CalDAV sync identity tables: series and per-occurrence links."""
import uuid
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0008_external_calendar_models"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("core", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="ICloudCalendarSeries",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("calendar_url", models.URLField(max_length=2000)),
                ("uid", models.CharField(max_length=500)),
                ("remote_url", models.URLField(blank=True, max_length=2000)),
                ("ical_data", models.TextField(blank=True)),
                ("remote_hash", models.CharField(blank=True, max_length=64)),
                ("title", models.CharField(blank=True, max_length=500)),
                ("location", models.CharField(blank=True, max_length=500)),
                ("last_error", models.TextField(blank=True)),
                ("last_synced_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("student", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="icloud_series", to="core.student")),
                ("teacher", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="icloud_series", to="core.teacher")),
                ("studio", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="icloud_series", to="core.studio")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="icloud_series", to=settings.AUTH_USER_MODEL)),
            ],
            options={"db_table": "icloud_calendar_series"},
        ),
        migrations.AddConstraint(
            model_name="icloudcalendarseries",
            constraint=models.UniqueConstraint(
                fields=("user", "calendar_url", "uid"),
                name="unique_icloud_series_owner_calendar_uid",
            ),
        ),
        migrations.CreateModel(
            name="ICloudCalendarOccurrence",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("recurrence_id", models.CharField(max_length=64)),
                ("synced_signature", models.CharField(blank=True, max_length=64)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("lesson", models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="icloud_occurrence", to="lessons.lesson")),
                ("series", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="occurrences", to="lessons.icloudcalendarseries")),
            ],
            options={"db_table": "icloud_calendar_occurrences"},
        ),
        migrations.AddConstraint(
            model_name="icloudcalendaroccurrence",
            constraint=models.UniqueConstraint(
                fields=("series", "recurrence_id"),
                name="unique_icloud_series_occurrence",
            ),
        ),
    ]
