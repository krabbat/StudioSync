from django.db.models import Q
from django.db import transaction
from decimal import Decimal
from django.db.models import Sum
from django.http import HttpResponse
from django.utils import timezone
from zoneinfo import ZoneInfo
from uuid import UUID

from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.core.tenancy import studio_for_request, studios_for_request

from .models import Invoice, Payment, Subscription, SubscriptionPlan
from .family_billing import existing_period, generate_month
from .payment_status import MANUAL_PAYMENT_NOTE, berlin_today, open_amount
from .invoice_delivery import InvoiceDeliveryError, send_invoice, invoice_pdf_bytes
from .serializers import InvoiceSerializer, SubscriptionPlanSerializer, SubscriptionSerializer


def visible_invoices(user):
    """Invoices the user is allowed to see. No cross-studio fallback."""
    from apps.core.tenancy import studios_for_user

    studios = studios_for_user(user)
    if getattr(user, "role", None) == "admin":
        return Invoice.objects.filter(studio__in=studios)
    if getattr(user, "role", None) == "teacher" and hasattr(user, "teacher_profile"):
        return Invoice.objects.filter(studio=user.teacher_profile.studio)
    if hasattr(user, "student_profile"):
        student = user.student_profile
        return Invoice.objects.filter(Q(student=student) | Q(band__in=student.bands.all())).distinct()
    if getattr(user, "role", None) == "parent":
        return Invoice.objects.filter(
            Q(student__family__primary_parent=user) | Q(student__family__secondary_parent=user)
        ).distinct()
    return Invoice.objects.none()


def payable_invoices(user):
    """Invoices this user is allowed to pay. Teachers are read-only."""
    if getattr(user, "role", None) == "teacher":
        return Invoice.objects.none()
    return visible_invoices(user)


class InvoiceViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing invoices
    """

    serializer_class = InvoiceSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = visible_invoices(self.request.user)
        student_id = self.request.query_params.get("student")
        if student_id:
            try:
                UUID(student_id)
            except (TypeError, ValueError):
                raise ValidationError({"student": "Ungültige Schüler-ID."})
            queryset = queryset.filter(Q(student_id=student_id) | Q(tuition_months__student_id=student_id)).distinct()
        family_id = self.request.query_params.get("family")
        if family_id:
            if self.request.user.role != "admin":
                raise PermissionDenied()
            from apps.core.models import Family
            family = Family.objects.filter(pk=family_id, studio__in=studios_for_request(self.request)).first()
            if not family:
                raise ValidationError({"code": "invalid_family"})
            queryset = queryset.filter(Q(family=family) | Q(student__family=family)).distinct()
        return queryset.defer("pdf_document")

    def create(self, request, *args, **kwargs):
        """Issue a draft; send only through the real mailer and report the outcome."""
        if request.user.role != "admin":
            raise PermissionDenied("Nur Administratoren dürfen Rechnungen erstellen.")
        studio = studio_for_request(request)
        if studio is None:
            raise ValidationError("Kein zugeordnetes Studio vorhanden.")
        from apps.core.models import Student
        student_id = request.data.get("student")
        if not Student.objects.filter(pk=student_id, studio=studio).exists():
            raise ValidationError({"student": "Schüler gehört nicht zu diesem Studio."})
        if request.data.get("band"):
            raise ValidationError({"band": "MUSart-Rechnungen werden einzelnen Schülern zugeordnet."})

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            from apps.core.models import Studio
            Studio.objects.select_for_update().get(pk=studio.pk)
            student = Student.objects.select_related("family").get(pk=student_id, studio=studio)
            start = serializer.validated_data.get("service_month")
            end = serializer.validated_data.get("service_month_end") or start
            if start and student.family_id and not student.family.individual_billing:
                raise ValidationError({"code": "family_billing_required"})
            if start and existing_period(student, start, end):
                raise ValidationError({"code": "already_billed"})
            invoice = serializer.save(
                studio=studio,
                status="draft",
                issue_date=timezone.localdate(timezone=ZoneInfo("Europe/Berlin")),
            )

        error_message = ""
        if request.data.get("send_now") is True:
            try:
                send_invoice(invoice.pk)
            except InvoiceDeliveryError as exc:
                error_message = str(exc)

        invoice.refresh_from_db()
        data = self.get_serializer(invoice).data
        data["email_error"] = error_message
        return Response(data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="generate-month")
    def generate_monthly(self, request):
        if request.user.role != "admin":
            raise PermissionDenied()
        studio = studio_for_request(request)
        if studio is None:
            raise ValidationError({"code": "invalid_studio"})
        from datetime import date
        try:
            month = date.fromisoformat(request.data.get("month", ""))
            family_id = UUID(str(request.data["family"])) if request.data.get("family") else None
        except (ValueError, TypeError):
            raise ValidationError({"code": "invalid_month"})
        invoices, skipped = generate_month(studio.pk, month, family_id)
        return Response({"invoices": self.get_serializer(invoices, many=True).data, "skipped": skipped})

    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf(self, request, pk=None):
        """Serve archive/preview via authorized API, never via public media files."""
        invoice = self.get_object()
        if not invoice.student and not invoice.family_id:
            raise ValidationError({"detail": "Für diese Rechnung ist keine Schüler-PDF-Vorlage vorhanden."})
        pdf_data = invoice_pdf_bytes(invoice)
        response = HttpResponse(pdf_data, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'attachment; filename="MUSart-Rechnung-{invoice.invoice_number}.pdf"'
        )
        response["Cache-Control"] = "private, no-store"
        return response

    @action(detail=True, methods=["post"], url_path="send")
    def send(self, request, pk=None):
        """Explicit admin action: send again, including already issued invoices."""
        if request.user.role != "admin":
            raise PermissionDenied("Nur Administratoren dürfen Rechnungen versenden.")
        invoice = self.get_object()
        try:
            delivered = send_invoice(invoice.pk, resend=True)
        except InvoiceDeliveryError as exc:
            return Response(
                {"detail": str(exc), "email_sent": False},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({
            "detail": "Rechnung erneut per E-Mail verschickt." if invoice.sent_at else "Rechnung per E-Mail verschickt.",
            "email_sent": True,
            "already_sent": bool(invoice.sent_at),
        })

    @action(detail=True, methods=["post"], url_path="mark-paid")
    def mark_paid(self, request, pk=None):
        """Manually book payment for the remaining invoice amount."""
        if request.user.role != "admin":
            raise PermissionDenied("Nur Administratoren dürfen Zahlungen verbuchen.")
        invoice = self.get_object()
        with transaction.atomic():
            invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
            if invoice.status == "cancelled":
                raise ValidationError({"detail": "Stornierte Rechnungen können nicht bezahlt werden."})
            remaining = open_amount(invoice)
            if remaining > 0:
                profile = getattr(invoice.student, "billing_profile", None) if invoice.student else None
                method = invoice.family.payment_method if invoice.family_id else (profile.payment_method if profile else "bank_transfer")
                Payment.objects.create(
                    invoice=invoice,
                    amount=remaining,
                    payment_method=method,
                    status="completed",
                    notes=MANUAL_PAYMENT_NOTE,
                    processed_by=request.user,
                )
            invoice.amount_paid = invoice.total_amount
            invoice.paid_date = berlin_today()
            invoice.status = "paid"
            invoice.save(update_fields=["amount_paid", "paid_date", "status", "updated_at"])
        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="mark-pending")
    def mark_pending(self, request, pk=None):
        """Reverse manually booked payments, preserving independent transactions."""
        if request.user.role != "admin":
            raise PermissionDenied("Nur Administratoren dürfen Zahlungen zurücknehmen.")
        invoice = self.get_object()
        with transaction.atomic():
            invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
            manual = invoice.payments.filter(status="completed", notes=MANUAL_PAYMENT_NOTE)
            manually_paid = manual.aggregate(total=Sum("amount"))["total"] or Decimal("0")
            if not manually_paid:
                raise ValidationError({
                    "detail": "Keine manuell verbuchte Zahlung zum Zurücknehmen vorhanden."
                })
            manual.delete()
            invoice.amount_paid = max(Decimal("0"), invoice.amount_paid - manually_paid)
            invoice.paid_date = None
            invoice.status = ("partial" if invoice.amount_paid > 0 else
                              "sent" if invoice.sent_at else "draft")
            invoice.save(update_fields=["amount_paid", "paid_date", "status", "updated_at"])
        return Response(self.get_serializer(invoice).data)

    def update(self, request, *args, **kwargs):
        if request.user.role != "admin":
            return Response(
                {"detail": "Only admins can update invoices."}, status=status.HTTP_403_FORBIDDEN
            )
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if request.user.role != "admin":
            return Response(
                {"detail": "Only admins can update invoices."}, status=status.HTTP_403_FORBIDDEN
            )
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if request.user.role != "admin":
            return Response(
                {"detail": "Only admins can delete invoices."}, status=status.HTTP_403_FORBIDDEN
            )
        if self.get_object().tuition_months.exists():
            raise ValidationError({"code": "tuition_invoice_protected"})
        return super().destroy(request, *args, **kwargs)

class SubscriptionPlanViewSet(viewsets.ModelViewSet):
    serializer_class = SubscriptionPlanSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        studios = studios_for_request(self.request)
        if user.role == "admin":
            return SubscriptionPlan.objects.filter(studio__in=studios)
        if user.role == "teacher" and hasattr(user, "teacher_profile"):
            return SubscriptionPlan.objects.filter(studio=user.teacher_profile.studio)
        if hasattr(user, "student_profile"):
            return SubscriptionPlan.objects.filter(studio=user.student_profile.studio, is_active=True)
        return SubscriptionPlan.objects.none()

    def perform_create(self, serializer):
        if self.request.user.role != "admin":
            raise permissions.PermissionDenied("Only admins can create subscription plans.")
        studio = studio_for_request(self.request)
        if studio is None:
            raise ValidationError("No studio found to associate with this plan.")
        serializer.save(studio=studio)

    def update(self, request, *args, **kwargs):
        if request.user.role != "admin":
            raise permissions.PermissionDenied("Only admins can update subscription plans.")
        return super().update(request, *args, **kwargs)


class SubscriptionViewSet(viewsets.ModelViewSet):
    serializer_class = SubscriptionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        studios = studios_for_request(self.request)
        if user.role == "admin":
            return Subscription.objects.filter(studio__in=studios)
        if user.role == "teacher" and hasattr(user, "teacher_profile"):
            return Subscription.objects.filter(studio=user.teacher_profile.studio)
        if hasattr(user, "student_profile"):
            return Subscription.objects.filter(student=user.student_profile)
        return Subscription.objects.none()

    def perform_create(self, serializer):
        user = self.request.user
        if user.role not in ["admin", "student"]:
            raise permissions.PermissionDenied("Only admins or students can create subscriptions.")

        if user.role == "admin":
            studio = studio_for_request(self.request)
        else:
            student = getattr(user, "student_profile", None)
            studio = getattr(student, "studio", None)
        if studio is None:
            raise ValidationError("No studio found to associate with this subscription.")
        plan = serializer.validated_data.get("plan")
        if plan is not None and plan.studio_id != studio.id:
            raise ValidationError("That plan belongs to a different studio.")
        serializer.save(studio=studio)

