from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0031_teaching_groups")]
    operations = [
        migrations.AddField(
            model_name="student",
            name="additional_guardians",
            field=models.JSONField(default=list, blank=True),
        ),
    ]
