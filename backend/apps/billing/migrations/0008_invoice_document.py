"""Archive original issued PDFs and recipient snapshots in the database."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("billing", "0007_student_billing_profile")]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="pdf_document",
            field=models.BinaryField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name="invoice",
            name="pdf_created_at",
            field=models.DateTimeField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name="invoice",
            name="document_snapshot",
            field=models.JSONField(blank=True, default=dict, editable=False),
        ),
    ]
