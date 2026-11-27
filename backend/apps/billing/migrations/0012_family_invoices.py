from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies = [("billing", "0011_invoice_service_month_end"), ("core", "0029_family_individual_billing")]
    operations = [
        migrations.AddField(model_name="invoice", name="family", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="invoices", to="core.family")),
        migrations.AddField(model_name="invoicelineitem", name="student", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="invoice_positions", to="core.student")),
        migrations.AddField(model_name="invoicelineitem", name="student_name_snapshot", field=models.CharField(blank=True, max_length=255)),
        migrations.CreateModel(name="TuitionMonth", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("month", models.DateField()),
            ("student", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="billed_months", to="core.student")),
            ("invoice", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="tuition_months", to="billing.invoice")),
            ("line_item", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="tuition_months", to="billing.invoicelineitem")),
        ], options={"constraints": [models.UniqueConstraint(fields=("student", "month"), name="unique_student_tuition_month")]}),
    ]
