"""Student correspondence, shared-parent matching and durable private drafts."""

from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.core.mail_associations import (
    assigned_student_ids, extract_contacts, mail_student_overview, student_catalog,
)
from apps.core.mail_cache import folder_for_owner
from apps.core.mail_drafts import (
    draft_queryset, get_draft, list_drafts, save_draft,
)
from apps.core.mail_service import _parse_metadata
from apps.core.models import Family, MailMessageCache, Student, User

SETTINGS = {
    "imap_host": "mail.example.org",
    "imap_port": "993",
    "imap_security": "ssl",
    "imap_username": "musikunterricht@musart.de",
    "imap_password": "private-mail-password",
}


@pytest.fixture
def family_students(studio, student_user):
    parent = User.objects.create_user(
        email="parent@example.org", role="parent", password="test",
        first_name="Eltern", last_name="Kontakt",
    )
    family = Family.objects.create(studio=studio, primary_parent=parent)
    first = Student.objects.create(
        studio=studio, user=student_user, family=family,
        instrument="Klavier",
    )
    sibling_user = User.objects.create_user(
        email="sibling@example.org", password="test",
        first_name="Geschwister", last_name="Kontakt",
    )
    second = Student.objects.create(
        studio=studio, user=sibling_user, family=family,
        instrument="Gitarre",
    )
    return first, second


def test_imap_metadata_has_both_sender_and_recipient_contact_addresses():
    header = (
        b"From: Eltern <parent@example.org>\r\n"
        b"To: MUSart <musikunterricht@musart.de>\r\n"
        b"Cc: Schwester <sibling@example.org>\r\n"
        b"Subject: Probeunterricht\r\n\r\n"
    )
    parsed = _parse_metadata(
        (b"1 (UID 54 FLAGS () RFC822.SIZE 220)", header), "inbox",
    )
    assert parsed["email"] == "parent@example.org"
    assert set(parsed["contact_addresses"]) == {
        "parent@example.org", "musikunterricht@musart.de",
        "sibling@example.org",
    }


@pytest.mark.django_db
def test_shared_parent_matches_two_children_but_manual_override_can_correct_it(
    studio, admin_user, family_students,
):
    first, second = family_students
    folder = folder_for_owner(studio, admin_user, SETTINGS, "inbox")
    message = MailMessageCache.objects.create(
        folder_cache=folder, uid=54, sender_name="Eltern",
        email="parent@example.org", subject="Unterricht",
        contact_addresses=["parent@example.org", "musikunterricht@musart.de"],
    )
    catalog, by_address = student_catalog(studio)
    assert set(assigned_student_ids(message, catalog, by_address)) == {
        str(first.id), str(second.id),
    }
    message.manual_student_ids = [str(first.id)]
    message.save(update_fields=["manual_student_ids"])
    assert assigned_student_ids(message, catalog, by_address) == [str(first.id)]
    message.manual_student_ids = []
    message.save(update_fields=["manual_student_ids"])
    assert assigned_student_ids(message, catalog, by_address) == []
    message.manual_student_ids = None
    message.save(update_fields=["manual_student_ids"])
    assert set(assigned_student_ids(message, catalog, by_address)) == {
        str(first.id), str(second.id),
    }


@pytest.mark.django_db
def test_student_profile_overview_lists_only_associated_mail(
    studio, admin_user, family_students,
):
    first, second = family_students
    folder = folder_for_owner(studio, admin_user, SETTINGS, "sent")
    MailMessageCache.objects.create(
        folder_cache=folder, uid=21, sender_name="Familie",
        email="parent@example.org", subject="Notenblatt",
        contact_addresses=["musikunterricht@musart.de", "parent@example.org"],
        date="2026-11-24T12:00:00+01:00",
    )
    overview = mail_student_overview(
        studio, admin_user, folder.account_key, str(first.pk),
    )
    assert overview is not None
    assert len(overview["messages"]) == 1
    assert overview["messages"][0]["folder"] == "sent"
    assert overview["messages"][0]["uid"] == "21"


@pytest.mark.django_db
def test_draft_roundtrip_preserves_device_pdf_as_private_database_blob(
    studio, admin_user, family_students,
):
    first, _ = family_students
    upload = SimpleUploadedFile(
        "unterricht.pdf", b"%PDF-1.4 Unterrichtsmaterial",
        content_type="application/pdf",
    )
    with patch("apps.core.mail_drafts._collect_attachments",
               return_value=[("unterricht.pdf", upload.read(), "application/pdf")]):
        result = save_draft(studio, admin_user, SETTINGS, {
            "student_ids": f'["{first.id}"]', "resource_ids": "[]",
            "manual_recipient": "", "additional_recipient": "",
            "subject": "Noten", "body": "Anbei das Material.",
        }, [upload])
    assert result["local_attachments"][0]["filename"] == "unterricht.pdf"
    assert result["student_ids"] == [str(first.id)]
    stored = draft_queryset(studio, admin_user, SETTINGS).get(pk=result["id"])
    assert bytes(stored.local_attachments.get().payload) == b"%PDF-1.4 Unterrichtsmaterial"
    listing = list_drafts(studio, admin_user, SETTINGS)
    assert len(listing["messages"]) == 1
    assert listing["messages"][0]["has_attachment"] is True


@pytest.mark.django_db
def test_draft_and_student_endpoints_reject_non_owner(
    studio, admin_user, authenticated_client, teacher_authenticated_client,
):
    admin_user.preferences = {"technical": SETTINGS}
    admin_user.save(update_fields=["preferences"])
    draft_list = reverse("mail-drafts")
    student_list = reverse("mail-student-catalog")
    assert teacher_authenticated_client.get(draft_list).status_code == 403
    assert teacher_authenticated_client.get(student_list).status_code == 403
    assert authenticated_client.get(draft_list).status_code == 200
    assert authenticated_client.get(student_list).status_code == 200


@pytest.mark.django_db
def test_draft_attachment_response_is_authenticated_and_not_in_draft_json(
    studio, admin_user, authenticated_client, teacher_authenticated_client,
):
    admin_user.preferences = {"technical": SETTINGS}
    admin_user.save(update_fields=["preferences"])
    upload = SimpleUploadedFile("abc.txt", b"PRIVATE-DRAFT-BYTES", content_type="text/plain")
    saved = save_draft(studio, admin_user, SETTINGS, {
        "student_ids": "[]", "resource_ids": "[]",
        "manual_recipient": "", "additional_recipient": "",
        "subject": "Entwurf", "body": "",
    }, [upload])
    detail = reverse("mail-draft-detail", kwargs={"draft_id": saved["id"]})
    assert "PRIVATE-DRAFT-BYTES" not in str(authenticated_client.get(detail).data)
    file_id = saved["local_attachments"][0]["id"]
    url = reverse("mail-draft-file", kwargs={
        "draft_id": saved["id"], "file_id": file_id,
    })
    assert teacher_authenticated_client.get(url).status_code == 403
    response = authenticated_client.get(url)
    assert response.status_code == 200
    assert response.content == b"PRIVATE-DRAFT-BYTES"
    assert response["Cache-Control"] == "private, no-store"
