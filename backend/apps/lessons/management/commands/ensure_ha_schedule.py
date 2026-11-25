"""Install HA schedules without changing their original activation date."""
from datetime import timedelta
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from django_q.models import Schedule


class Command(BaseCommand):
    help = "Register read-only Home Assistant attendance and nightly statistics."

    @transaction.atomic
    def handle(self, *args, **options):
        now = timezone.now()
        names = ("MUSart HA attendance (2 min)", "MUSart HA nightly statistics")
        live, created = Schedule.objects.get_or_create(name=names[0], defaults={
            "func": "apps.lessons.ha_attendance.run_live",
            "args": repr(now.isoformat()),
            "schedule_type": Schedule.MINUTES, "minutes": 2,
            "repeats": -1, "next_run": now + timedelta(minutes=2),
        })
        # UTC schedules at 01:00 and 02:00; the job checks Berlin local time.
        next_hour = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        Schedule.objects.get_or_create(name=names[1], defaults={
            "func": "apps.lessons.ha_attendance.run_nightly",
            "args": live.args,
            "schedule_type": Schedule.HOURLY,
            "repeats": -1, "next_run": next_hour,
        })
        self.stdout.write(self.style.SUCCESS("HA-Anwesenheit: beide Zeitpläne aktiv."))
