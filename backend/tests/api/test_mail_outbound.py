"""SMTP recipient privacy, student roster and send API regression tests."""

import smtplib
from unittest.mock import MagicMock, patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.core.mail_outbound import (
    MailSendError,
    _collect_attachments,
    _resolve_addresses,
    active_student_recipients,
    send_student_mail,
    studio_resource_attachments,
)
from apps.core.models import Family, Student, User
from apps.resources.models import Resource

SETTINGS = {
    "smtp_host": "smtp.example.org",
    "smtp_port": "465",
    "smtp_username": "musikunterricht@musart.de",
    "smtp_password": "hidden-password",
    "smtp_from_email": "musikunterricht@musart.de",
    "imap_host": "imap.example.org",
    "imap_port": "993",
    "imap_security": "ssl",
    "imap_username": "musikunterricht@musart.de",
    "imap_password": "hidden-imap",
}


@pytest.fixture
def two_siblings(studio, student_user):
    parent = User.objects.create_user(
        email="eltern@example.org",
        first_name="Eltern",
        last_name="Beispiel",
        password="password",
        role="parent",
    )
    family = Family.objects.create(studio=studio, primary_parent=parent)
    first = Student.objects.create(
        studio=studio, user=student_user, family=family,
        instrument="Klavier", instruments=["Klavier", "Gehörbildung"],
    )
    second_user = User.objects.create_user(
        email="geschwister@example.org",
        first_name="Leo",
        last_name="Beispiel",
        password="password",
    )
    second = Student.objects.create(
        studio=studio, user=second_user, family=family,
        instrument="Gitarre",
    )
    return first, second


@pytest.mark.django_db
def test_active_roster_uses_family_contact_and_student_instruments(
    studio, two_siblings
):
    first, second = two_siblings
    recipients = active_student_recipients(studio)
    assert {student["id"] for student in recipients} == {
        str(first.id), str(second.id),
    }
    assert all(student["email"] == "eltern@example.org" for student in recipients)
    assert all(student["contact_type"] == "Elternkontakt" for student in recipients)
    assert "Gehörbildung" in next(
        student["instruments"] for student in recipients
        if student["id"] == str(first.pk)
    )


@pytest.mark.django_db
def test_inactive_students_are_never_in_the_roster(studio, two_siblings):
    first, second = two_siblings
    second.is_active = False
    second.save(update_fields=["is_active"])
    recipients = active_student_recipients(studio)
    assert [item["id"] for item in recipients] == [str(first.id)]


@pytest.mark.django_db
def test_selected_siblings_share_one_smtp_destination(studio, two_siblings):
    first, second = two_siblings
    addresses = _resolve_addresses(
        studio, [str(first.id), str(second.id)], "",
    )
    assert addresses == [{
        "email": "eltern@example.org",
        "student_ids": [str(first.id), str(second.id)],
    }]


@pytest.mark.django_db
def test_cannot_send_to_inactive_or_nonexistent_student(studio, two_siblings):
    first, second = two_siblings
    second.is_active = False
    second.save(update_fields=["is_active"])
    with pytest.raises(MailSendError, match="geändert"):
        _resolve_addresses(studio, [str(second.id)], "")
    with pytest.raises(MailSendError, match="geändert"):
        _resolve_addresses(studio, ["00000000-0000-0000-0000-000000000000"], "")


@pytest.mark.django_db
def test_real_smtp_sends_only_one_private_mail_to_shared_family_address(
    studio, two_siblings
):
    first, second = two_siblings
    connection = MagicMock()
    connection.send_messages.return_value = 1
    sent_session = MagicMock()
    files = [
        SimpleUploadedFile(
            "noten.pdf", b"%PDF-1.4", content_type="application/pdf"
        )
    ]
    with (
        patch("apps.core.mail_outbound.assert_public_host"),
        patch("apps.core.mail_outbound.get_connection", return_value=connection)
        as connection_factory,
        patch(
            "apps.core.mail_outbound._open_sent_folder",
            return_value=(sent_session, b'"Sent"'),
        ),
        patch("apps.core.mail_outbound._save_sent_copy") as append,
    ):
        result = send_student_mail(
            studio=studio, config=SETTINGS,
            student_ids=[str(first.id), str(second.id)],
            manual_recipient="", subject="Noten", body="Hier sind die Übungen.",
            uploads=files,
        )
    assert result["sent"] == 1
    assert result["failed"] == 0
    assert len(result["student_ids_sent"]) == 2
    assert connection_factory.call_args.kwargs["use_ssl"] is True
    assert connection_factory.call_args.kwargs["use_tls"] is False
    assert connection_factory.call_args.kwargs["port"] == 465
    assert connection_factory.call_args.kwargs["password"] == "hidden-password"
    sent = connection.send_messages.call_args.args[0][0]
    assert sent.to == ["eltern@example.org"]
    assert sent.bcc == []
    assert sent.subject == "Noten"
    assert sent.attachments[0][0] == "noten.pdf"
    assert sent.extra_headers["Message-ID"]
    append.assert_called_once()
    sent_session.logout.assert_called_once()


@pytest.mark.django_db
def test_partial_send_returns_successful_ids_without_resending(studio, student_user):
    first = Student.objects.create(studio=studio, user=student_user)
    second_user = User.objects.create_user(
        email="second@example.org",
        first_name="Zwei",
        last_name="Test",
        password="password",
    )
    second = Student.objects.create(studio=studio, user=second_user)
    connection = MagicMock()
    connection.send_messages.side_effect = [1, smtplib.SMTPException("failed")]
    with (
        patch("apps.core.mail_outbound.assert_public_host"),
        patch("apps.core.mail_outbound.get_connection", return_value=connection),
        patch(
            "apps.core.mail_outbound._open_sent_folder",
            return_value=(MagicMock(), b'"Sent"'),
        ),
        patch("apps.core.mail_outbound._save_sent_copy"),
    ):
        result = send_student_mail(
            studio=studio, config=SETTINGS,
            student_ids=[str(first.pk), str(second.pk)],
            manual_recipient="", subject="Info", body="Nachricht",
            uploads=[],
        )
    assert result["sent"] == 1
    assert result["failed"] == 1
    assert result["student_ids_sent"] == [str(first.pk)]
    assert connection.send_messages.call_count == 2


@pytest.mark.django_db
def test_invalid_message_cannot_reach_smtp(studio, two_siblings):
    first, _ = two_siblings
    with patch("apps.core.mail_outbound.get_connection") as connection:
        with pytest.raises(MailSendError, match="Betreff"):
            send_student_mail(
                studio=studio, config=SETTINGS,
                student_ids=[str(first.pk)], manual_recipient="",
                subject="", body="Text", uploads=[],
            )
    connection.assert_not_called()


@pytest.mark.django_db
def test_admin_roster_api_returns_no_password_or_inactive(
    authenticated_client, admin_user, studio, two_siblings
):
    admin_user.preferences = {"technical": dict(SETTINGS)}
    admin_user.save(update_fields=["preferences"])
    response = authenticated_client.get(reverse("mail-recipients"))
    assert response.status_code == 200, response.data
    assert response.data["total"] == 2
    assert "hidden-password" not in str(response.data)
    assert "hidden-imap" not in str(response.data)


@pytest.mark.django_db
def test_admin_send_api_restricts_access_and_passes_ids_not_emails(
    authenticated_client, teacher_authenticated_client, student_authenticated_client,
    admin_user, studio, two_siblings
):
    first, _ = two_siblings
    admin_user.preferences = {"technical": dict(SETTINGS)}
    admin_user.save(update_fields=["preferences"])
    body = {
        "student_ids": f'["{first.pk}"]',
        "manual_recipient": "",
        "subject": "Hallo",
        "body": "Morgen findet Unterricht statt.",
    }
    endpoint = reverse("mail-send")
    assert teacher_authenticated_client.post(
        endpoint, body, format="multipart"
    ).status_code == 403
    assert student_authenticated_client.post(
        endpoint, body, format="multipart"
    ).status_code == 403
    with patch("apps.core.views.mail_outbound.send_student_mail") as sender:
        sender.return_value = {
            "sent": 1, "failed": 0,
            "student_ids_sent": [str(first.pk)], "manual_sent": False,
            "copies_failed": 0,
        }
        response = authenticated_client.post(
            endpoint, body, format="multipart"
        )
    assert response.status_code == 200, response.data
    assert sender.call_args.kwargs["student_ids"] == [str(first.pk)]
    assert sender.call_args.kwargs["config"]["smtp_password"] == "hidden-password"
    assert sender.call_args.kwargs["config"]["imap_password"] == "hidden-imap"
    assert "hidden-password" not in str(response.data)
    assert "hidden-imap" not in str(response.data)


@pytest.mark.django_db
def test_bad_recipient_json_is_refused(authenticated_client, studio):
    response = authenticated_client.post(
        reverse("mail-send"),
        {
            "student_ids": "{bad",
            "manual_recipient": "",
            "subject": "Hallo",
            "body": "Test",
        }, format="multipart",
    )
    assert response.status_code == 400


@pytest.fixture
def saved_studiosync_pdf(studio, admin_user, tmp_path, settings):
    """One actual on-disk resource, isolated from production storage."""
    settings.MEDIA_ROOT = str(tmp_path)
    return Resource.objects.create(
        studio=studio,
        uploaded_by=admin_user,
        title="Klavier-Arbeitsblatt",
        resource_type="pdf",
        file=SimpleUploadedFile(
            "klavierblatt.pdf", b"%PDF-1.4 Beispiel",
            content_type="application/pdf",
        ),
        file_size=17,
        mime_type="application/pdf",
        instrument="Klavier",
    )


@pytest.mark.django_db
def test_mail_resource_directory_only_lists_stored_files(
    studio, saved_studiosync_pdf
):
    items = studio_resource_attachments(studio)
    assert len(items["resources"]) == 1
    item = items["resources"][0]
    assert item["id"] == str(saved_studiosync_pdf.pk)
    assert item["title"] == "Klavier-Arbeitsblatt"
    assert item["filename"].endswith("klavierblatt.pdf")
    assert "file_url" not in item
    assert studio_resource_attachments(studio, "Gitarre")["resources"] == []
    assert studio_resource_attachments(studio, "Klavier")["resources"]


@pytest.mark.django_db
def test_mail_attaches_local_and_saved_studio_resources(
    studio, saved_studiosync_pdf
):
    local = SimpleUploadedFile(
        "hausaufgabe.txt", b"Noten notieren", content_type="text/plain"
    )
    data = _collect_attachments(
        [local], studio=studio, resource_ids=[str(saved_studiosync_pdf.pk)]
    )
    assert len(data) == 2
    assert data[0] == ("hausaufgabe.txt", b"Noten notieren", "text/plain")
    assert data[1][0].endswith("klavierblatt.pdf")
    assert data[1][1] == b"%PDF-1.4 Beispiel"
    assert data[1][2] == "application/pdf"


@pytest.mark.django_db
def test_mail_rejects_resource_from_another_studio_before_smtp(
    studio, saved_studiosync_pdf
):
    from apps.core.models import Studio

    owner = User.objects.create_user(
        email="other-owner@example.org", first_name="Test", last_name="Owner",
        password="test-secret", role="admin",
    )
    foreign_studio = Studio.objects.create(
        name="Anderer Musikunterricht", email="other@example.org", owner=owner
    )
    with pytest.raises(MailSendError, match="nicht mehr verfügbar"):
        _collect_attachments(
            [], studio=foreign_studio,
            resource_ids=[str(saved_studiosync_pdf.pk)],
        )


@pytest.mark.django_db
def test_attachment_limits_include_resources_and_local_files(
    studio, saved_studiosync_pdf
):
    local = [
        SimpleUploadedFile(f"datei-{i}.txt", b"test", content_type="text/plain")
        for i in range(8)
    ]
    with pytest.raises(MailSendError, match="Maximal acht"):
        _collect_attachments(
            local, studio=studio,
            resource_ids=[str(saved_studiosync_pdf.pk)],
        )
    with pytest.raises(MailSendError, match="mehrfach"):
        _collect_attachments(
            [], studio=studio,
            resource_ids=[
                str(saved_studiosync_pdf.pk), str(saved_studiosync_pdf.pk)
            ],
        )


@pytest.mark.django_db
def test_reply_recipient_and_optional_studio_address_deduplicated(studio):
    addresses = _resolve_addresses(
        studio, [], "eltern@example.org", "studio@example.org"
    )
    assert [item["email"] for item in addresses] == [
        "eltern@example.org", "studio@example.org"
    ]
    duplicate = _resolve_addresses(
        studio, [], "eltern@example.org", "ELTERN@example.org"
    )
    assert len(duplicate) == 1


@pytest.mark.django_db
def test_owner_only_resource_search_api(
    authenticated_client, teacher_authenticated_client, admin_user,
    studio, saved_studiosync_pdf
):
    admin_user.preferences = {"technical": dict(SETTINGS)}
    admin_user.save(update_fields=["preferences"])
    endpoint = reverse("mail-attachment-resources")
    assert teacher_authenticated_client.get(endpoint).status_code == 403
    response = authenticated_client.get(endpoint + "?q=Klavier")
    assert response.status_code == 200, response.data
    assert response.data["resources"][0]["id"] == str(saved_studiosync_pdf.pk)
    assert "hidden-password" not in str(response.data)


@pytest.mark.django_db
def test_send_api_receives_resource_ids_and_optional_extra_address(
    authenticated_client, admin_user, studio, saved_studiosync_pdf
):
    admin_user.preferences = {"technical": dict(SETTINGS)}
    admin_user.save(update_fields=["preferences"])
    body = {
        "student_ids": "[]",
        "resource_ids": f'["{saved_studiosync_pdf.pk}"]',
        "manual_recipient": "family@example.org",
        "additional_recipient": "lehrer@example.org",
        "subject": "Unterricht",
        "body": "Das Arbeitsblatt ist im Anhang.",
    }
    with patch("apps.core.views.mail_outbound.send_student_mail") as sender:
        sender.return_value = {
            "sent": 2, "failed": 0, "student_ids_sent": [],
            "manual_sent": True, "additional_sent": True,
            "copies_failed": 0,
        }
        response = authenticated_client.post(
            reverse("mail-send"), body, format="multipart"
        )
    assert response.status_code == 200
    kwargs = sender.call_args.kwargs
    assert kwargs["resource_ids"] == [str(saved_studiosync_pdf.pk)]
    assert kwargs["additional_recipient"] == "lehrer@example.org"


@pytest.mark.django_db
def test_sending_saved_file_uses_real_attachment_payload(
    studio, saved_studiosync_pdf
):
    from apps.core.mail_outbound import _collect_attachments

    attached = _collect_attachments(
        [], studio=studio, resource_ids=[str(saved_studiosync_pdf.pk)]
    )
    assert attached[0][1] == b"%PDF-1.4 Beispiel"
