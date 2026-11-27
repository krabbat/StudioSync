from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("core", "0028_student_contact_names")]
    operations = [
        migrations.AddField(model_name="family", name="individual_billing", field=models.BooleanField(default=False)),
    ]
