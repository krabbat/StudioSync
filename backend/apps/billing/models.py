"""
Billing models - Invoice, Payment, InvoiceLineItem
"""

import secrets
import uuid
from zoneinfo import ZoneInfo
from decimal import Decimal

from django.db import models
from django.utils import timezone

from apps.core.models import Band, Studio, User


class StudentBillingProfile(models.Model):
    """Independent invoice recipient settings; never infer email from student login."""

    PAYMENT_METHOD_CHOICES = [
        ("bank_transfer", "Banküberweisung"),
        ("paypal", "PayPal"),
        ("cash", "Barzahlung"),
    ]

    student = models.OneToOneField(
        "core.Student", on_delete=models.CASCADE, related_name="billing_profile"
    )
    payment_method = models.CharField(
        max_length=20, choices=PAYMENT_METHOD_CHOICES, default="bank_transfer"
    )
    recipient_name = models.CharField(max_length=200, blank=True)
    recipient_email = models.EmailField(blank=True)
    recipient_address_line1 = models.CharField(max_length=255, blank=True)
    recipient_postal_code = models.CharField(max_length=20, blank=True)
    recipient_city = models.CharField(max_length=100, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "student_billing_profiles"


class Invoice(models.Model):
    """
    Invoice for a band/group
    """

    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("sent", "Sent"),
        ("paid", "Paid"),
        ("partial", "Partially Paid"),
        ("overdue", "Overdue"),
        ("cancelled", "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    studio = models.ForeignKey(Studio, on_delete=models.CASCADE, related_name="invoices")

    # Bill To (can be Band or Student)
    band = models.ForeignKey(
        Band, on_delete=models.SET_NULL, null=True, blank=True, related_name="invoices"
    )
    student = models.ForeignKey(
        "core.Student", on_delete=models.SET_NULL, null=True, blank=True, related_name="invoices"
    )

    family = models.ForeignKey(
        "core.Family", on_delete=models.PROTECT, null=True, blank=True, related_name="invoices"
    )
    # Attribution
    teacher = models.ForeignKey(
        "core.Teacher",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invoices_generated",
    )

    # Invoice details
    invoice_number = models.CharField(max_length=50, unique=True, db_index=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")

    # Amounts
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    amount_paid = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))

    # Dates
    issue_date = models.DateField(default=timezone.localdate)
    due_date = models.DateField()
    service_month = models.DateField(null=True, blank=True)  # First day of tuition month
    service_month_end = models.DateField(null=True, blank=True)  # Optional inclusive last month (first day)
    paid_date = models.DateField(null=True, blank=True)

    # Notes
    notes = models.TextField(blank=True)
    internal_notes = models.TextField(blank=True)  # Not visible to client

    # Late fees
    late_fee_applied = models.BooleanField(default=False)
    late_fee_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    # Archive on the database to avoid exposing private invoices via MEDIA_URL.
    pdf_document = models.BinaryField(blank=True, null=True, editable=False)
    pdf_created_at = models.DateTimeField(blank=True, null=True, editable=False)
    document_snapshot = models.JSONField(default=dict, blank=True, editable=False)
    stripe_session_id = models.CharField(max_length=200, blank=True, db_index=True)

    class Meta:
        db_table = "invoices"
        ordering = ["-issue_date", "-invoice_number"]
        indexes = [
            models.Index(fields=["invoice_number"]),
            models.Index(fields=["band", "status"]),
            models.Index(fields=["due_date"]),
        ]

    def __str__(self):
        subject = (
            self.band.name
            if self.band
            else (self.student.user.get_full_name() if self.student else "Unknown")
        )
        return f"Invoice {self.invoice_number} - {subject} - {self.total_amount}"

    @property
    def balance_due(self):
        """Calculate remaining balance"""
        return self.total_amount - self.amount_paid

    @property
    def is_overdue(self):
        """Use the payment state; email delivery is independent."""
        from .payment_status import payment_state
        return payment_state(self) == "overdue"

    def save(self, *args, **kwargs):
        if not self.invoice_number:
            # Non-sequential: date of creation + cryptographically random decimal digits.
            # Do not expose the number of issued invoices or students.
            for _ in range(10):
                candidate = f"{timezone.localdate(timezone=ZoneInfo('Europe/Berlin')):%Y%m%d}-{secrets.randbelow(10**10):010d}"
                if not type(self).objects.filter(invoice_number=candidate).exists():
                    self.invoice_number = candidate
                    break
            else:
                raise RuntimeError("Could not allocate a unique invoice number.")
        super().save(*args, **kwargs)

    def calculate_totals(self):
        """Recalculate invoice totals from line items"""
        line_items = self.line_items.all()
        self.subtotal = sum(item.total_price for item in line_items)
        self.total_amount = (
            self.subtotal + self.tax_amount - self.discount_amount + self.late_fee_amount
        )
        self.save()


class InvoiceLineItem(models.Model):
    """
    Individual line item on an invoice
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="line_items")

    # Item details
    description = models.CharField(max_length=500)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("1.00"))
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    total_price = models.DecimalField(max_digits=10, decimal_places=2)

    # Student attribution survives changes to family membership.
    student = models.ForeignKey("core.Student", on_delete=models.SET_NULL, null=True, blank=True,
                                related_name="invoice_positions")
    student_name_snapshot = models.CharField(max_length=255, blank=True)
    # Optional lesson reference
    lesson = models.ForeignKey(
        "lessons.Lesson",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invoice_line_items",
    )

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "invoice_line_items"
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.description} - {self.total_price}"

    def save(self, *args, **kwargs):
        """Auto-calculate total price"""
        self.total_price = self.quantity * self.unit_price
        super().save(*args, **kwargs)


class TuitionMonth(models.Model):
    """Unique allocation of a student's monthly fee to an invoice."""
    student = models.ForeignKey("core.Student", on_delete=models.PROTECT, related_name="billed_months")
    month = models.DateField()
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="tuition_months")
    line_item = models.ForeignKey(InvoiceLineItem, on_delete=models.PROTECT, related_name="tuition_months")
    class Meta:
        constraints = [models.UniqueConstraint(fields=["student", "month"], name="unique_student_tuition_month")]


class Payment(models.Model):
    """
    Payment record for invoices
    """

    PAYMENT_METHOD_CHOICES = [
        ("cash", "Cash"),
        ("check", "Check"),
        ("credit_card", "Credit Card"),
        ("debit_card", "Debit Card"),
        ("bank_transfer", "Bank Transfer"),
        ("paypal", "PayPal"),
        ("stripe", "Stripe"),
        ("other", "Other"),
    ]

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("completed", "Completed"),
        ("failed", "Failed"),
        ("refunded", "Refunded"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="payments")

    # Payment details
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="completed")

    # External reference (e.g., Stripe transaction ID)
    transaction_id = models.CharField(max_length=200, blank=True, db_index=True)

    # Metadata
    notes = models.TextField(blank=True)
    processed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="processed_payments"
    )

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(default=timezone.now)
    refunded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "payments"
        ordering = ["-processed_at"]
        indexes = [
            models.Index(fields=["transaction_id"]),
            models.Index(fields=["invoice", "status"]),
        ]

    def __str__(self):
        return f"Payment {self.amount} for {self.invoice.invoice_number}"


class PaymentAllocation(models.Model):
    """Explicit assignment of a received payment to a tuition line."""
    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name="allocations")
    line_item = models.ForeignKey(InvoiceLineItem, on_delete=models.PROTECT, related_name="payment_allocations")
    amount = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["payment", "line_item"], name="unique_payment_line"),
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="positive_payment_allocation"),
        ]


class PaymentMethod(models.Model):
    """
    Saved payment methods for bands
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    band = models.ForeignKey(Band, on_delete=models.CASCADE, related_name="payment_methods")

    # Payment provider details
    provider = models.CharField(max_length=50)  # e.g., 'stripe', 'paypal'
    provider_payment_method_id = models.CharField(max_length=200)

    # Display information
    card_last_four = models.CharField(max_length=4, blank=True)
    card_brand = models.CharField(max_length=50, blank=True)
    expiry_month = models.IntegerField(null=True, blank=True)
    expiry_year = models.IntegerField(null=True, blank=True)

    # Flags
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "payment_methods"
        ordering = ["-is_default", "-created_at"]

    def __str__(self):
        if self.card_last_four:
            return f"{self.card_brand} ending in {self.card_last_four}"
        return f"{self.provider} payment method"


class SubscriptionPlan(models.Model):
    """
    Recurring billing plans (e.g., Weekly Lesson, Monthly Access)
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    studio = models.ForeignKey(Studio, on_delete=models.CASCADE, related_name="subscription_plans")
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    interval = models.CharField(
        max_length=20,
        choices=[("day", "Daily"), ("week", "Weekly"), ("month", "Monthly"), ("year", "Yearly")],
        default="month",
    )
    
    # Provider IDs (optional if created in Stripe directly vs local first)
    stripe_product_id = models.CharField(max_length=200, blank=True)
    stripe_price_id = models.CharField(max_length=200, blank=True)
    
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "subscription_plans"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} - ${self.price}/{self.interval}"


class Subscription(models.Model):
    """
    A student's enrollment in a subscription plan
    """

    STATUS_CHOICES = [
        ("active", "Active"),
        ("past_due", "Past Due"),
        ("canceled", "Canceled"),
        ("unpaid", "Unpaid"),
        ("trialing", "Trialing"),
        ("incomplete", "Incomplete"),
        ("incomplete_expired", "Incomplete Expired"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    studio = models.ForeignKey(Studio, on_delete=models.CASCADE, related_name="subscriptions")
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.RESTRICT, related_name="subscriptions")
    student = models.ForeignKey(
        "core.Student", on_delete=models.CASCADE, related_name="subscriptions"
    )
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="incomplete")
    
    stripe_subscription_id = models.CharField(max_length=200, blank=True, db_index=True)
    stripe_customer_id = models.CharField(max_length=200, blank=True)
    
    current_period_start = models.DateTimeField(null=True, blank=True)
    current_period_end = models.DateTimeField(null=True, blank=True)
    cancel_at_period_end = models.BooleanField(default=False)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "subscriptions"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.student} - {self.plan.name} ({self.status})"



class BlockBillingPlan(models.Model):
    """Explicit per-pupil billing agreement, independent of annual quotas."""
    student = models.OneToOneField("core.Student", on_delete=models.PROTECT, related_name="block_billing")
    enabled = models.BooleanField(default=False)
    starts_on = models.DateField()
    units_per_block = models.PositiveSmallIntegerField(default=4)
    block_amount = models.DecimalField(max_digits=8, decimal_places=2)
    test_only = models.BooleanField(default=True)


class BlockInvoice(models.Model):
    plan = models.ForeignKey(BlockBillingPlan, on_delete=models.PROTECT, related_name="bills")
    invoice = models.OneToOneField(Invoice, on_delete=models.PROTECT, related_name="block_bill")
    test_only = models.BooleanField(default=True)
    attempted_at = models.DateTimeField(null=True, blank=True)
    delivery_error = models.TextField(blank=True, default="")


class BlockBillingUnit(models.Model):
    """Snapshot identity; calendar deletion cannot erase an invoiced unit."""
    plan = models.ForeignKey(BlockBillingPlan, on_delete=models.PROTECT, related_name="units")
    lesson_id = models.UUIDField()
    lesson_date = models.DateField()
    bill = models.ForeignKey(BlockInvoice, on_delete=models.PROTECT, null=True, blank=True, related_name="units")
    reset_at = models.DateTimeField(null=True, blank=True)
    reset_by = models.ForeignKey("core.User", on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["plan", "lesson_id"], name="unique_block_billed_lesson")]
