from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("lessons", "0010_lesson_guest_details")]
    operations = [
        migrations.AddField(model_name="lesson", name="ha_attendance",
                            field=models.JSONField(default=dict, blank=True)),
        migrations.AddField(model_name="lesson", name="ha_finalized_at",
                            field=models.DateTimeField(null=True, blank=True)),
        migrations.AddField(model_name="lesson", name="ha_manual_override",
                            field=models.BooleanField(default=False)),
        migrations.AddField(model_name="lesson", name="ha_watch_active",
                            field=models.BooleanField(default=False, db_index=True)),
    ]
