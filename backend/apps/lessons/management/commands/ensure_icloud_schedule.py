"""Register the recurring iCloud sync with the existing Django Q worker."""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone
from django_q.models import Schedule


class Command(BaseCommand):
    help = "Ensure that CalDAV two-way sync runs every five minutes."

    def handle(self, *args, **options):
        name = "MUSart iCloud CalDAV sync"
        schedule, created = Schedule.objects.get_or_create(
            name=name,
            defaults={
                "func": "apps.lessons.icloud_sync.sync_all_icloud_users",
                "schedule_type": Schedule.MINUTES,
                "minutes": 5,
                "repeats": -1,
                "next_run": timezone.now() + timedelta(minutes=5),
            },
        )
        if not created and (
            schedule.func != "apps.lessons.icloud_sync.sync_all_icloud_users"
            or schedule.schedule_type != Schedule.MINUTES
            or schedule.minutes != 5
        ):
            schedule.func = "apps.lessons.icloud_sync.sync_all_icloud_users"
            schedule.schedule_type = Schedule.MINUTES
            schedule.minutes = 5
            schedule.repeats = -1
            schedule.next_run = timezone.now() + timedelta(minutes=5)
            schedule.save()
        self.stdout.write(self.style.SUCCESS("iCloud-CalDAV-Abgleich: Zeitplan aktiv (5 Minuten)."))
