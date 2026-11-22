"""Separate invoice payment state from email delivery status."""

from datetime import timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.utils import timezone

MANUAL_PAYMENT_NOTE = "MUSART: manuell als bezahlt markiert"


def berlin_today():
    return timezone.localdate(timezone=ZoneInfo("Europe/Berlin"))


def paid_amount(invoice):
    """Support older 'paid' rows even when amount_paid was not filled."""
    total = max(invoice.total_amount or Decimal("0"), Decimal("0"))
    amount = max(invoice.amount_paid or Decimal("0"), Decimal("0"))
    return total if invoice.status == "paid" else min(total, amount)


def open_amount(invoice):
    return max(Decimal("0"), (invoice.total_amount or Decimal("0")) - paid_amount(invoice))


def payment_state(invoice, *, on_date=None):
    """pending / overdue / paid; past-due-date retro invoices get 7 issue days."""
    if invoice.status == "cancelled":
        return "cancelled"
    if invoice.status == "paid" or open_amount(invoice) == 0:
        return "paid"
    today = on_date or berlin_today()
    threshold = invoice.due_date
    if invoice.due_date < invoice.issue_date:
        threshold = invoice.issue_date + timedelta(days=7)
    return "overdue" if today > threshold else "pending"


def payment_totals(invoices, *, on_date=None):
    """Three non-overlapping monetary totals, using outstanding partial balances."""
    totals = {"paid": Decimal("0.00"), "pending": Decimal("0.00"),
              "overdue": Decimal("0.00")}
    today = on_date or berlin_today()
    for invoice in invoices:
        state = payment_state(invoice, on_date=today)
        if state == "cancelled":
            continue
        totals["paid"] += paid_amount(invoice)
        remaining = open_amount(invoice)
        if remaining > 0 and state in ("pending", "overdue"):
            totals[state] += remaining
    return totals
