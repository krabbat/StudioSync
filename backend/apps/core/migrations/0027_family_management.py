from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("core", "0026_mail_communication")]
    operations = [
        migrations.AlterField(model_name="family", name="primary_parent",
            field=models.ForeignKey(to=settings.AUTH_USER_MODEL, on_delete=django.db.models.deletion.PROTECT,
                null=True, blank=True, related_name="primary_parent_families")),
        migrations.AddField(model_name="family", name="name", field=models.CharField(max_length=200, blank=True)),
        migrations.AddField(model_name="family", name="address_line1", field=models.CharField(max_length=255, blank=True)),
        migrations.AddField(model_name="family", name="postal_code", field=models.CharField(max_length=20, blank=True)),
        migrations.AddField(model_name="family", name="city", field=models.CharField(max_length=100, blank=True)),
        migrations.AddField(model_name="family", name="ha_zone_entity_id", field=models.CharField(max_length=255, blank=True)),
        migrations.AddField(model_name="family", name="contacts", field=models.JSONField(default=list, blank=True)),
        migrations.AddField(model_name="family", name="billing_recipient_name", field=models.CharField(max_length=200, blank=True)),
        migrations.AddField(model_name="family", name="payment_method", field=models.CharField(max_length=20, default="bank_transfer",
            choices=[("bank_transfer", "Banküberweisung"), ("paypal", "PayPal"), ("cash", "Barzahlung")])),
    ]
