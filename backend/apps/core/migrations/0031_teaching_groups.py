from django.db import migrations, models
import django.db.models.deletion
import uuid

class Migration(migrations.Migration):
    dependencies = [("core", "0030_family_access")]
    operations = [
        migrations.CreateModel(name="TeachingGroup", fields=[
            ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
            ("name", models.CharField(max_length=200)),
            ("archived_at", models.DateTimeField(blank=True, null=True)),
            ("studio", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="teaching_groups", to="core.studio")),
            ("members", models.ManyToManyField(blank=True, related_name="teaching_groups", to="core.student")),
        ], options={"ordering":["name","id"]}),
    ]
