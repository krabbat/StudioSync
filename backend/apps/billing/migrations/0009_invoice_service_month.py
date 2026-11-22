"""Optional monthly performance period for tuition invoices."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("billing", "0008_invoice_document")]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="service_month",
            field=models.DateField(blank=True, null=True),
        ),
    ]
