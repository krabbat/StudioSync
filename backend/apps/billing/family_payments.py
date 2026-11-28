"""Allocate tuition payments only to explicitly selected invoice lines."""
from decimal import Decimal, InvalidOperation
from django.db.models import Sum
from rest_framework.exceptions import ValidationError
from .models import Payment, PaymentAllocation
from .payment_status import berlin_today, MANUAL_PAYMENT_NOTE

ZERO = Decimal("0.00")


def line_paid(line):
    return line.payment_allocations.filter(payment__status="completed").aggregate(
        total=Sum("amount"))["total"] or ZERO


def book_allocated_payment(invoice, raw_allocations, method, actor, manual_full=False):
    """Call inside transaction with invoice row locked."""
    if invoice.status == "cancelled" or not (invoice.monthly_test or invoice.tuition_months.exists()):
        raise ValidationError({"code": "invalid_invoice"})
    if method not in {"bank_transfer", "paypal", "cash"}:
        raise ValidationError({"code": "invalid_method"})
    lines = {str(line.pk): line for line in invoice.line_items.all()}
    paid_by_line = {key: line_paid(line) for key,line in lines.items()}
    if sum(paid_by_line.values(), ZERO) != invoice.amount_paid:
        raise ValidationError({"code": "unallocated_payment"})
    if manual_full:
        amounts = {key: line.total_price-paid_by_line[key] for key,line in lines.items()
                   if line.total_price > paid_by_line[key]}
    else:
        if not isinstance(raw_allocations, dict) or not raw_allocations or set(raw_allocations)-set(lines):
            raise ValidationError({"code": "invalid_allocation"})
        amounts = {}
        for key, value in raw_allocations.items():
            try:
                amount = Decimal(str(value))
                if not amount.is_finite() or amount <= 0 or amount != amount.quantize(Decimal("0.01")):
                    raise ValueError()
            except (InvalidOperation, ValueError, TypeError):
                raise ValidationError({"code": "invalid_amount"})
            if amount > lines[key].total_price-paid_by_line[key]:
                raise ValidationError({"code": "amount_exceeds_line"})
            amounts[key] = amount
    total = sum(amounts.values(), ZERO)
    if total <= 0 or invoice.amount_paid+total > invoice.total_amount:
        raise ValidationError({"code": "invalid_amount"})
    payment = Payment.objects.create(invoice=invoice, amount=total, payment_method=method,
        status="completed", processed_by=actor, notes=MANUAL_PAYMENT_NOTE)
    PaymentAllocation.objects.bulk_create([PaymentAllocation(payment=payment,line_item=lines[key],amount=amount)
                                            for key,amount in amounts.items()])
    invoice.amount_paid += total
    invoice.status = "paid" if invoice.amount_paid == invoice.total_amount else "partial"
    invoice.paid_date = berlin_today() if invoice.status == "paid" else None
    invoice.save(update_fields=["amount_paid", "status", "paid_date", "updated_at"])
    return payment
