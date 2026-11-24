"""Student correspondence, shared-parent matching and durable private drafts."""

from datetime import datetime, timedelta, timezone
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
from apps.core.models import Family, MailDraft, MailMessageCache, Student, User

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


@pytest.mark.django_db
def test_student_communication_lists_all_received_sent_archived_and_drafts_with_pages(
    studio, admin_user, family_students,
):
    student, sibling = family_students
    inbox = folder_for_owner(studio, admin_user, SETTINGS, "inbox")
    sent = folder_for_owner(studio, admin_user, SETTINGS, "sent")
    archive = folder_for_owner(studio, admin_user, SETTINGS, "archive")
    starting_at = datetime(2026, 11, 24, 8, 0, tzinfo=timezone.utc)

    MailMessageCache.objects.bulk_create([
        MailMessageCache(
            folder_cache=inbox, uid=index + 1, sender_name="Eltern",
            email="parent@example.org", subject=f"Anfrage {index + 1}",
            contact_addresses=["parent@example.org"],
            date=(starting_at + timedelta(minutes=index)).isoformat(),
        ) for index in range(45)
    ])
    MailMessageCache.objects.create(
        folder_cache=sent, uid=101, sender_name="Eltern",
        email="parent@example.org", subject="Antwort",
        contact_addresses=["parent@example.org"],
        date=(starting_at + timedelta(minutes=60)).isoformat(),
    )
    # An archived message can have only the old single-address cache field.
    MailMessageCache.objects.create(
        folder_cache=archive, uid=102, sender_name="Eltern",
        email="parent@example.org", subject="Alte Anfrage",
        date=(starting_at - timedelta(days=1)).isoformat(),
    )
    MailMessageCache.objects.create(
        folder_cache=inbox, uid=103, sender_name="Fremd",
        email="unrelated@example.org", subject="Andere Familie",
        contact_addresses=["unrelated@example.org"],
    )
    MailDraft.objects.create(
        studio=studio, owner=admin_user, account_key=inbox.account_key,
        student_ids=[str(student.pk)], subject="Entwurf für Schüler",
        body="Noch nicht gesendet",
    )
    MailDraft.objects.create(
        studio=studio, owner=admin_user, account_key=inbox.account_key,
        recipient="parent@example.org",
        subject="Entwurf an Eltern",
    )

    first = mail_student_overview(
        studio, admin_user, inbox.account_key, str(student.pk),
        offset=0, limit=40,
    )
    second = mail_student_overview(
        studio, admin_user, inbox.account_key, str(student.pk),
        offset=40, limit=40,
    )
    assert first["total"] == 49
    assert first["counts"] == {"received": 46, "sent": 1, "draft": 2}
    assert first["has_more"] is True
    assert second["has_more"] is False
    assert len(first["messages"]) == 40
    assert len(second["messages"]) == 9
    combined = first["messages"] + second["messages"]
    assert len({(item["folder"], item["uid"]) for item in combined}) == 49
    assert {item["category"] for item in combined} == {"received", "sent", "draft"}
    assert sum(item["category"] == "draft" for item in combined) == 2
    assert all(item["uid"] for item in combined)
    assert all(
        datetime.fromisoformat(combined[i]["date"]).timestamp()
        >= datetime.fromisoformat(combined[i + 1]["date"]).timestamp()
        for i in range(len(combined) - 1)
    )
    # The shared parent's address intentionally associates a second student.
    sibling_page = mail_student_overview(
        studio, admin_user, inbox.account_key, str(sibling.pk),
    )
    assert sibling_page["total"] >= 48


@pytest.mark.django_db
def test_communication_endpoint_pages_are_owner_only_and_validate_bounds(
    studio, admin_user, family_students, authenticated_client,
    teacher_authenticated_client,
):
    student, _ = family_students
    admin_user.preferences = {"technical": SETTINGS}
    admin_user.save(update_fields=["preferences"])
    url = reverse("mail-student-overview", kwargs={"student_id": student.pk})
    assert teacher_authenticated_client.get(url).status_code == 403
    assert authenticated_client.get(url + "?offset=-1").status_code == 400
    assert authenticated_client.get(url + "?limit=101").status_code == 400
    with patch("apps.core.mail_cache.async_task") as queued:
        result = authenticated_client.get(url + "?offset=0&limit=40")
    assert result.status_code == 200
    assert result.data["total"] == 0
    assert result.data["counts"] == {"received": 0, "sent": 0, "draft": 0}
    assert result.data["has_more"] is False
    # Inbox, Sent, Archive queue refresh without exposing credentials.
    assert queued.call_count == 3
