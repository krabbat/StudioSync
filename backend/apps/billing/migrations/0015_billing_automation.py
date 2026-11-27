from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies = [("billing", "0014_block_billing")]
    operations = [
        migrations.CreateModel(name="BillingAutomation", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("monthly_enabled", models.BooleanField(default=False)),
            ("monthly_from", models.DateField(blank=True, null=True)),
            ("monthly_day", models.PositiveSmallIntegerField(default=1)),
            ("monthly_time", models.TimeField(default="08:00")),
            ("monthly_send", models.BooleanField(default=True)),
            ("test_enabled", models.BooleanField(default=False)),
            ("test_at", models.DateTimeField(blank=True, null=True)),
            ("test_month", models.DateField(blank=True, null=True)),
            ("test_send", models.BooleanField(default=True)),
            ("studio", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="billing_automation", to="core.studio")),
        ]),
        migrations.CreateModel(name="BillingRun", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("kind", models.CharField(max_length=12)),
            ("service_month", models.DateField()),
            ("scheduled_for", models.DateTimeField()),
            ("send", models.BooleanField(default=True)),
            ("status", models.CharField(default="preparing", max_length=20)),
            ("skipped", models.JSONField(blank=True, default=list)),
            ("error", models.TextField(blank=True, default="")),
            ("created_at", models.DateTimeField(auto_now_add=True)),
            ("studio", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="billing_runs", to="core.studio")),
        ], options={"constraints": [
            models.UniqueConstraint(fields=("studio", "kind", "scheduled_for"), name="unique_billing_run_time"),
            models.UniqueConstraint(fields=("studio", "service_month"), condition=models.Q(kind="monthly"), name="unique_monthly_billing_run"),
        ]}),
        migrations.CreateModel(name="BillingRunItem", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("number", models.CharField(max_length=60)),
            ("recipient", models.CharField(blank=True, max_length=320)),
            ("amount", models.DecimalField(decimal_places=2, max_digits=10)),
            ("snapshot", models.JSONField(blank=True, default=dict)),
            ("pdf_document", models.BinaryField(blank=True, null=True)),
            ("state", models.CharField(default="pending", max_length=20)),
            ("error", models.TextField(blank=True, default="")),
            ("invoice", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="billing.invoice")),
            ("run", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="items", to="billing.billingrun")),
        ]),
    ]
