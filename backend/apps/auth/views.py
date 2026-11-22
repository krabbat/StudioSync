from email.utils import formataddr
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from apps.core.security import revoke_user_tokens

from apps.core.serializers import UserSerializer

User = get_user_model()


class AuthAnonThrottle(AnonRateThrottle):
    """Slow down anonymous registration and password-reset attempts."""

    rate = "30/hour"


class MeView(APIView):
    """
    Returns the current authenticated user's details.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        # The serializer needs the authenticated request to expose the owner's
        # technical settings while keeping SMTP/IMAP passwords redacted.
        serializer = UserSerializer(request.user, context={"request": request})
        return Response(serializer.data)


class RegisterView(APIView):
    """Accounts are created by the studio owner; self-registration is disabled."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        return Response(
            {"detail": "Public registration is disabled. Contact your music teacher for access."},
            status=status.HTTP_403_FORBIDDEN,
        )


class PasswordResetRequestView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [AuthAnonThrottle]

    def post(self, request):
        email = request.data.get("email")
        if not email:
            return Response({"error": "Email is required"}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email=email).first()
        if user:
            from apps.core.email_utils import get_email_settings, get_frontend_url
            from apps.core.tenancy import studios_for_user

            token = default_token_generator.make_token(user)
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            base_url = get_frontend_url(request)
            reset_link = f"{base_url}/reset-password?uid={uid}&token={token}"

            email_settings = get_email_settings()
            studio = studios_for_user(user).order_by("created_at").first()
            sender_name = studio.name if studio else email_settings["from_name"]
            send_mail(
                "Password Reset Request",
                f"Click the link to reset your password: {reset_link}",
                formataddr((sender_name, email_settings["from_email"])),
                [email],
                fail_silently=False,
            )

        # Always return success to prevent email enumeration
        return Response(
            {"message": "If an account exists with this email, a reset link has been sent."}
        )


class PasswordResetConfirmView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [AuthAnonThrottle]

    def post(self, request):
        uidb64 = request.data.get("uid")
        token = request.data.get("token")
        password = request.data.get("password")

        if not all([uidb64, token, password]):
            return Response({"error": "Missing fields"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            user = User.objects.get(pk=uid)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return Response({"error": "Invalid link"}, status=status.HTTP_400_BAD_REQUEST)

        if default_token_generator.check_token(user, token):
            try:
                validate_password(password, user=user)
            except DjangoValidationError as exc:
                return Response({"error": exc.messages}, status=status.HTTP_400_BAD_REQUEST)
            user.set_password(password)
            user.save()
            revoke_user_tokens(user)
            return Response({"message": "Password has been reset successfully."})

        return Response({"error": "Invalid or expired token"}, status=status.HTTP_400_BAD_REQUEST)
