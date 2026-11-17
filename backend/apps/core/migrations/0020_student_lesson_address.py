from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0019_register_schedules")]

    operations = [
        migrations.AddField(
            model_name="student",
            name="address_line1",
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name="student",
            name="postal_code",
            field=models.CharField(blank=True, max_length=20),
        ),
        migrations.AddField(
            model_name="student",
            name="city",
            field=models.CharField(blank=True, max_length=100),
        ),
    ]
