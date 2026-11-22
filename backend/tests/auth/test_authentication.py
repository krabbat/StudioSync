"""
Tests for authentication endpoints (registration, login, token refresh).
"""

from django.contrib.auth import get_user_model
from email.utils import formataddr
from unittest.mock import patch
from django.urls import reverse

import pytest
from rest_framework import status

User = get_user_model()


@pytest.mark.auth
@pytest.mark.django_db
class TestUserRegistration:
    """Accounts are created by the teacher, never through public signup."""

    @pytest.mark.parametrize("role", ["student", "parent", "teacher", "admin"])
    def test_public_registration_forbidden_for_every_role(self, api_client, role):
        before = User.objects.count()
        response = api_client.post(
            reverse("register"),
            {
                "email": "uninvited@test.com",
                "password": "testpass123",
                "first_name": "New",
                "last_name": "User",
                "role": role,
            },
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert User.objects.count() == before


@pytest.mark.auth
@pytest.mark.django_db
class TestUserLogin:
    """Test user login functionality."""

    def test_login_with_valid_credentials(self, api_client, admin_user):
        """Test login with valid credentials returns tokens."""
        url = reverse("token_obtain_pair")
        data = {"email": "admin@test.com", "password": "testpass123"}
        response = api_client.post(url, data, format="json")

        assert response.status_code == status.HTTP_200_OK
        assert "access" in response.data
        assert "refresh" in response.data

    def test_login_with_invalid_credentials(self, api_client, admin_user):
        """Test login with invalid credentials fails."""
        url = reverse("token_obtain_pair")
        data = {"email": "admin@test.com", "password": "wrongpassword"}
        response = api_client.post(url, data, format="json")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_login_with_nonexistent_user(self, api_client):
        """Test login with non-existent user fails."""
        url = reverse("token_obtain_pair")
        data = {"email": "nonexistent@test.com", "password": "testpass123"}
        response = api_client.post(url, data, format="json")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.auth
@pytest.mark.django_db
class TestTokenRefresh:
    """Test JWT token refresh functionality."""

    def test_refresh_token_success(self, api_client, admin_user):
        """Test successful token refresh."""
        # First, get tokens
        login_url = reverse("token_obtain_pair")
        login_data = {"email": "admin@test.com", "password": "testpass123"}
        login_response = api_client.post(login_url, login_data, format="json")
        refresh_token = login_response.data["refresh"]

        # Now refresh the token
        refresh_url = reverse("token_refresh")
        refresh_data = {"refresh": refresh_token}
        response = api_client.post(refresh_url, refresh_data, format="json")

        assert response.status_code == status.HTTP_200_OK
        assert "access" in response.data

    def test_refresh_token_with_invalid_token(self, api_client):
        """Test token refresh with invalid token fails."""
        refresh_url = reverse("token_refresh")
        refresh_data = {"refresh": "invalid_token_string"}
        response = api_client.post(refresh_url, refresh_data, format="json")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.auth
@pytest.mark.django_db
def test_password_reset_sender_uses_studio_name_not_legacy_smtp_name(api_client, admin_user, studio):
    studio.name = "MUSart - Musikunterricht"
    studio.save(update_fields=["name"])
    admin_user.preferences = {"technical": {
        "smtp_from_email": "musikunterricht@example.org",
        "smtp_from_name": "Veralteter SMTP-Absendername",
    }}
    admin_user.save(update_fields=["preferences"])

    with patch("apps.auth.views.send_mail") as send_mail:
        response = api_client.post(
            reverse("password_reset"), {"email": admin_user.email}, format="json",
        )

    assert response.status_code == 200, response.data
    send_mail.assert_called_once()
    assert send_mail.call_args.args[2] == formataddr(
        ("MUSart - Musikunterricht", "musikunterricht@example.org")
    )
