"""Optional inclusive end month for manually created retrospective tuition invoices."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("billing", "0010_musart_invoice_settings")]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="service_month_end",
            field=models.DateField(blank=True, null=True),
        ),
    ]
