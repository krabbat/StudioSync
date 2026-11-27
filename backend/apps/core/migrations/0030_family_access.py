from django.db import migrations, models
import django.db.models.deletion
import uuid

class Migration(migrations.Migration):
    dependencies = [("core", "0029_family_individual_billing")]
    operations = [
        migrations.AddField(model_name="family", name="archived_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.CreateModel(name="FamilyAccess", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("can_view_communication", models.BooleanField(default=True)),
            ("created_at", models.DateTimeField(auto_now_add=True)),
            ("family", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="access_grants", to="core.family")),
            ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="family_access_grants", to="core.user")),
            ("students", models.ManyToManyField(blank=True, related_name="family_access_grants", to="core.student")),
        ], options={"constraints":[models.UniqueConstraint(fields=("family","user"), name="unique_family_access_user")]}),
    ]
