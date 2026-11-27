from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("lessons","0013_lesson_participants")]
    operations = [
        migrations.AddField(model_name="lesson", name="group_ha_zone", field=models.CharField(blank=True,max_length=255)),
        migrations.AddField(model_name="icloudcalendarseries", name="group_booking", field=models.JSONField(blank=True,default=dict)),
    ]
