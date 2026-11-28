from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("billing", "0015_billing_automation")]
    operations = [
        migrations.AddField(
            model_name="invoice", name="monthly_test",
            field=models.BooleanField(default=False, editable=False),
        ),
    ]
