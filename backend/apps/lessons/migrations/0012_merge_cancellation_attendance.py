"""Join the two independent lesson migration branches without altering data."""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("lessons", "0011_lesson_cancellation_kind"),
        ("lessons", "0011_lesson_ha_attendance"),
    ]
    operations = []
