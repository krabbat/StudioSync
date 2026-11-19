"""44 guaranteed annual lesson units: migrate only previously unmodified defaults.

Historical migrations remain immutable; 0022 originally created the 46-unit default.
An explicitly adjusted 46-unit quota (nonempty quota_reason) is preserved.
"""

import django.core.validators
from django.db import migrations, models


def update_existing_standard_quotas(apps, schema_editor):
    TeachingYearAccount = apps.get_model("core", "TeachingYearAccount")
    TeachingYearAccount.objects.filter(
        quota=46, quota_reason=""
    ).update(quota=44)


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0023_manual_absences_and_taught_correction"),
    ]

    operations = [
        migrations.AlterField(
            model_name="teachingyearaccount",
            name="quota",
            field=models.PositiveSmallIntegerField(
                default=44,
                validators=[django.core.validators.MinValueValidator(1)],
            ),
        ),
        migrations.RunPython(
            update_existing_standard_quotas,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
