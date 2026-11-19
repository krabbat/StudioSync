# Generated for StudioSync tuition contract module (schema only; no data migration).
import uuid
from decimal import Decimal

import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0020_student_lesson_address")]

    operations = [
        migrations.CreateModel(
            name="TeachingContract",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("contract_start_date", models.DateField()),
                ("contract_year_start", models.DateField()),
                ("lesson_minutes", models.PositiveSmallIntegerField(choices=[(30, "30 Minuten"), (45, "45 Minuten"), (60, "60 Minuten")])),
                ("monthly_amount", models.DecimalField(max_digits=8, decimal_places=2, validators=[django.core.validators.MinValueValidator(Decimal("0.01"))])),
                ("price_kind", models.CharField(max_length=16, choices=[("standard", "Regulärer Monatsbeitrag"), ("individual", "Individuell vereinbarter Monatsbeitrag")], default="standard")),
                ("special_agreements", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("student", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="teaching_contract", to="core.student")),
            ],
            options={"db_table": "teaching_contracts"},
        ),
    ]
