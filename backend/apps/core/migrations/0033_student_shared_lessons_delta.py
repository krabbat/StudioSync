from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0032_student_additional_guardians")]
    operations = [
        migrations.AddField(
            model_name="student",
            name="shared_lessons_delta",
            field=models.IntegerField(default=0),
        ),
    ]
