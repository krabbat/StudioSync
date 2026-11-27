from datetime import timedelta
from django.core.management.base import BaseCommand
from django.utils import timezone
from django_q.models import Schedule

class Command(BaseCommand):
    help = "Register the complete billing automation worker (once per minute)."

    def handle(self, *args, **options):
        Schedule.objects.update_or_create(
            name="MUSart Rechnungsautomatik",
            defaults={"func": "apps.billing.automation.run_billing_automation",
                      "schedule_type": Schedule.MINUTES, "minutes": 1,
                      "repeats": -1, "next_run": timezone.now() + timedelta(minutes=1)},
        )
        Schedule.objects.filter(name="MUSart Blockabrechnung", func="apps.billing.block_billing.run_block_billing").delete()
        self.stdout.write(self.style.SUCCESS("Rechnungsautomatik: Zeitplan aktiv (1 Minute)."))
