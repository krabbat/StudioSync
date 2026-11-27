from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies = [("billing", "0013_payment_allocation"), ("core", "0031_teaching_groups")]
    operations = [
        migrations.CreateModel(name="BlockBillingPlan", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("enabled", models.BooleanField(default=False)),
            ("starts_on", models.DateField()),
            ("units_per_block", models.PositiveSmallIntegerField(default=4)),
            ("block_amount", models.DecimalField(max_digits=8, decimal_places=2)),
            ("test_only", models.BooleanField(default=True)),
            ("student", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="block_billing", to="core.student")),
        ]),
        migrations.CreateModel(name="BlockInvoice", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("test_only", models.BooleanField(default=True)),
            ("attempted_at", models.DateTimeField(blank=True, null=True)),
            ("delivery_error", models.TextField(blank=True, default="")),
            ("plan", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="bills", to="billing.blockbillingplan")),
            ("invoice", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="block_bill", to="billing.invoice")),
        ]),
        migrations.CreateModel(name="BlockBillingUnit", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("lesson_id", models.UUIDField()),
            ("lesson_date", models.DateField()),
            ("test_only", models.BooleanField(default=True)),
            ("reset_at", models.DateTimeField(blank=True, null=True)),
            ("reset_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="core.user")),
            ("plan", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="units", to="billing.blockbillingplan")),
            ("bill", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="units", to="billing.blockinvoice")),
        ], options={"constraints": [models.UniqueConstraint(fields=("plan", "lesson_id", "test_only"), name="unique_block_billed_lesson")]}),
    ]
