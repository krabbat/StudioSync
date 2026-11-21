# Independent billing recipient data per student. No implicit student-email copy.
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("billing", "0006_subscriptionplan_subscription"),
        ("core", "0024_annual_quota_44"),
    ]

    operations = [
        migrations.CreateModel(
            name="StudentBillingProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("payment_method", models.CharField(
                    choices=[("bank_transfer", "Banküberweisung"), ("paypal", "PayPal"), ("cash", "Barzahlung")],
                    default="bank_transfer", max_length=20)),
                ("recipient_name", models.CharField(blank=True, max_length=200)),
                ("recipient_email", models.EmailField(blank=True, max_length=254)),
                ("recipient_address_line1", models.CharField(blank=True, max_length=255)),
                ("recipient_postal_code", models.CharField(blank=True, max_length=20)),
                ("recipient_city", models.CharField(blank=True, max_length=100)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("student", models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="billing_profile", to="core.student")),
            ],
            options={"db_table": "student_billing_profiles"},
        ),
    ]
