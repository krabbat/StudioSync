"""MUSart configurable feature menu settings and admin-only persistence."""
import pytest

from apps.core.models import SetupStatus


@pytest.fixture
def legacy_setup(db):
    """An existing studio whose old setup enabled every original module."""
    return SetupStatus.objects.create(
        is_completed=True,
        setup_version="1.0",
        features_enabled={
            "billing": True,
            "inventory": False,
            "messaging": True,
            "resources": True,
            "goals": True,
            "bands": True,
            "analytics": True,
            "practice_rooms": False,
        },
        setup_data={"language": "de", "completed_by": "admin@example.de"},
    )


@pytest.mark.django_db
def test_legacy_feature_defaults_hide_bands_gigs_and_reports(
    api_client, legacy_setup,
):
    response = api_client.get("/api/core/setup/status/")
    assert response.status_code == 200
    selected = response.data["features_enabled"]
    assert selected["bands"] is False
    assert selected["gigs"] is False
    assert selected["analytics"] is False
    assert selected["billing"] is True
    assert selected["messaging"] is True
    # Reading must not silently modify or discard the original setup settings.
    legacy_setup.refresh_from_db()
    assert legacy_setup.features_enabled["bands"] is True
    assert legacy_setup.setup_data["language"] == "de"


@pytest.mark.django_db
def test_admin_can_save_feature_visibility_and_reenable_reports(
    authenticated_client, legacy_setup,
):
    result = authenticated_client.patch(
        "/api/core/setup/features/",
        {"features_enabled": {
            "bands": False, "gigs": False, "analytics": True,
        }},
        format="json",
    )
    assert result.status_code == 200, result.data
    assert result.data["features_enabled"]["analytics"] is True
    assert result.data["features_enabled"]["bands"] is False
    assert result.data["features_enabled"]["gigs"] is False
    assert result.data["features_enabled"]["billing"] is True

    status_result = authenticated_client.get("/api/core/setup/status/")
    assert status_result.status_code == 200
    assert status_result.data["features_enabled"]["analytics"] is True

    legacy_setup.refresh_from_db()
    assert legacy_setup.setup_data["features_customized"] is True
    assert legacy_setup.setup_data["language"] == "de"
    assert legacy_setup.features_enabled["inventory"] is False


@pytest.mark.django_db
def test_admin_can_toggle_bands_and_gigs_independently(
    authenticated_client, legacy_setup,
):
    first = authenticated_client.patch(
        "/api/core/setup/features/",
        {"features_enabled": {"gigs": True}},
        format="json",
    )
    assert first.status_code == 200
    assert first.data["features_enabled"]["gigs"] is True
    assert first.data["features_enabled"]["bands"] is False

    second = authenticated_client.patch(
        "/api/core/setup/features/",
        {"features_enabled": {"bands": True, "gigs": False}},
        format="json",
    )
    assert second.status_code == 200
    assert second.data["features_enabled"]["bands"] is True
    assert second.data["features_enabled"]["gigs"] is False


@pytest.mark.django_db
@pytest.mark.parametrize("fixture_name", [
    "teacher_authenticated_client", "student_authenticated_client",
])
def test_only_admin_can_change_feature_visibility(request, fixture_name, legacy_setup):
    client = request.getfixturevalue(fixture_name)
    response = client.patch(
        "/api/core/setup/features/",
        {"features_enabled": {"analytics": True}},
        format="json",
    )
    assert response.status_code == 403
    legacy_setup.refresh_from_db()
    assert "features_customized" not in legacy_setup.setup_data


@pytest.mark.django_db
def test_feature_change_requires_authentication(api_client, legacy_setup):
    response = api_client.patch(
        "/api/core/setup/features/",
        {"features_enabled": {"analytics": True}},
        format="json",
    )
    assert response.status_code in (401, 403)


@pytest.mark.django_db
@pytest.mark.parametrize("body", [
    {"features_enabled": {}},
    {"features_enabled": {"analytics": "false"}},
    {"features_enabled": {"bands": 1}},
    {"features_enabled": {"unknown_feature": True}},
])
def test_invalid_feature_changes_do_not_overwrite_settings(
    authenticated_client, legacy_setup, body,
):
    response = authenticated_client.patch(
        "/api/core/setup/features/", body, format="json",
    )
    assert response.status_code == 400
    legacy_setup.refresh_from_db()
    assert legacy_setup.features_enabled["analytics"] is True
    assert "features_customized" not in legacy_setup.setup_data
