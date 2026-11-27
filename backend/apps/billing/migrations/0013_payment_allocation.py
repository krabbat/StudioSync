from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies = [("billing", "0012_family_invoices")]
    operations = [
        migrations.CreateModel(name="PaymentAllocation", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("amount", models.DecimalField(max_digits=10, decimal_places=2)),
            ("payment", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="allocations", to="billing.payment")),
            ("line_item", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="payment_allocations", to="billing.invoicelineitem")),
        ], options={"constraints": [
            models.UniqueConstraint(fields=("payment", "line_item"), name="unique_payment_line"),
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="positive_payment_allocation"),
        ]}),
    ]
