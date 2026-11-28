from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("lessons", "0015_participant_display_snapshot")]
    operations = [
        migrations.AddField(
            model_name="icloudcalendarseries",
            name="dismissed_notice",
            field=models.CharField(max_length=64, blank=True, default=""),
        ),
    ]
