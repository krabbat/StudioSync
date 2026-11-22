from django.db.models import Q
from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from zoneinfo import ZoneInfo
from uuid import UUID

from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.core.tenancy import studio_for_request, studios_for_request

from .models import Invoice, Subscription, SubscriptionPlan
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
            queryset = queryset.filter(student_id=student_id)
        return queryset

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

    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf(self, request, pk=None):
        """Serve archive/preview via authorized API, never via public media files."""
        invoice = self.get_object()
        if not invoice.student:
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
        """Manual, idempotent retry for a still-unsent invoice."""
        if request.user.role != "admin":
            raise PermissionDenied("Nur Administratoren dürfen Rechnungen versenden.")
        invoice = self.get_object()
        try:
            delivered = send_invoice(invoice.pk)
        except InvoiceDeliveryError as exc:
            return Response(
                {"detail": str(exc), "email_sent": False},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({
            "detail": "Rechnung per E-Mail verschickt." if delivered else "Rechnung wurde bereits verschickt.",
            "email_sent": True,
            "already_sent": not delivered,
        })

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
        invoice = self.get_object()
        if invoice.sent_at:
            raise ValidationError({"detail": "Versendete Rechnungen können nicht gelöscht werden."})
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

