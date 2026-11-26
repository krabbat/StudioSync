from django.db import migrations, models

def populate(apps, schema_editor):
    Student = apps.get_model("core", "Student")
    for s in Student.objects.select_related("user").iterator():
        parts = s.emergency_contact_name.strip().split(maxsplit=1)
        s.emergency_contact_first_name = parts[0] if len(parts) == 2 else ""
        s.emergency_contact_last_name = parts[-1] if parts else ""
        s.contact_email = s.user.email
        s.save(update_fields=["emergency_contact_first_name", "emergency_contact_last_name", "contact_email"])

class Migration(migrations.Migration):
    dependencies = [("core", "0027_family_management")]
    operations = [
        migrations.AddField(model_name="student", name="emergency_contact_first_name", field=models.CharField(max_length=100, blank=True)),
        migrations.AddField(model_name="student", name="emergency_contact_last_name", field=models.CharField(max_length=100, blank=True)),
        migrations.AddField(model_name="student", name="contact_email", field=models.EmailField(max_length=254, blank=True)),
        migrations.RunPython(populate, migrations.RunPython.noop),
    ]
