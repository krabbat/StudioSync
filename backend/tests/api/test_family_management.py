import pytest
from apps.core.models import Family, Student, Studio, User, TeachingContract
from datetime import date

BASE = "/api/students/families/"

@pytest.mark.django_db
def test_family_create_and_members_preserve_contract(authenticated_client, studio, student):
    contract = TeachingContract.objects.create(student=student, contract_start_date=date(2027,1,1),
        contract_year_start=date(2027,1,1), lesson_minutes=45, monthly_amount=135)
    response = authenticated_client.post(BASE, {"name":"Familie Test", "ha_zone_entity_id":"zone.familie_test",
        "contacts":[{"name":"Elternteil","email":"parent@example.com","phone":"","relation":"Mutter"}]}, format="json")
    assert response.status_code == 201, response.data
    fid = response.data["id"]
    assert Family.objects.get(pk=fid).primary_parent_id is None
    response = authenticated_client.put(f"{BASE}{fid}/members/", {"student_ids":[str(student.pk)]}, format="json")
    assert response.status_code == 200, response.data
    student.refresh_from_db()
    assert str(student.family_id) == fid
    assert response.data["students"][0]["monthly_amount"] == "135.00"
    response = authenticated_client.put(f"{BASE}{fid}/members/", {"student_ids":[]}, format="json")
    assert response.status_code == 200
    student.refresh_from_db()
    assert student.family_id is None
    assert TeachingContract.objects.filter(pk=contract.pk, student=student).exists()

@pytest.mark.django_db
def test_family_scope_and_student_assignment(authenticated_client, student_authenticated_client, studio, student):
    other_owner = User.objects.create_user(email="other-admin@example.com", password="password", role="admin")
    other = Studio.objects.create(name="Other", owner=other_owner, email="other@example.com")
    foreign = Family.objects.create(studio=other, name="Andere Familie")
    own = Family.objects.create(studio=studio, name="Eigene Familie")
    assert authenticated_client.get(f"{BASE}{foreign.pk}/").status_code == 404
    assert authenticated_client.patch(f"/api/students/{student.pk}/", {"family":str(foreign.pk)}, format="json").status_code == 400
    assert authenticated_client.patch(f"/api/students/{student.pk}/", {"family":str(own.pk)}, format="json").status_code == 200
    student.refresh_from_db()
    assert student.family_id == own.pk
    assert student_authenticated_client.patch(f"/api/students/{student.pk}/", {"family":None}, format="json").status_code == 403
    assert student_authenticated_client.get(f"{BASE}{own.pk}/").status_code == 404

@pytest.mark.django_db
def test_membership_does_not_silently_move_student(authenticated_client, studio, student):
    first = Family.objects.create(studio=studio, name="Erste")
    second = Family.objects.create(studio=studio, name="Zweite")
    student.family = first
    student.save(update_fields=["family"])
    response = authenticated_client.put(f"{BASE}{second.pk}/members/", {"student_ids":[str(student.pk)]}, format="json")
    assert response.status_code == 400
    student.refresh_from_db()
    assert student.family_id == first.pk


@pytest.mark.django_db
def test_member_data_includes_own_contact_without_emergency_contact(authenticated_client, studio, student):
    family = Family.objects.create(studio=studio, name="Familie Test")
    student.family = family
    student.contact_email = "contact@example.org"
    student.emergency_contact_name = ""
    student.save(update_fields=["family", "contact_email", "emergency_contact_name"])
    student.user.first_name = "Maria"
    student.user.last_name = "von Test"
    student.user.phone = "030123456"
    student.user.save(update_fields=["first_name", "last_name", "phone"])
    response = authenticated_client.get(f"{BASE}{family.pk}/member-data/")
    assert response.status_code == 200, response.data
    assert len(response.data) == 1
    row = response.data[0]
    assert row["id"] == str(student.pk)
    assert row["contacts"] == []
    assert row["person"] == {"name":"Maria von Test", "first_name":"Maria", "last_name":"von Test",
                             "relation":"", "email":"contact@example.org", "phone":"030123456"}
    student.contact_email = "student-technical@example.invalid"
    student.save(update_fields=["contact_email"])
    response = authenticated_client.get(f"{BASE}{family.pk}/member-data/")
    assert response.data[0]["person"]["email"] == ""


@pytest.mark.django_db
def test_family_accepts_german_international_email(authenticated_client, studio):
    address = "groß@example.org"
    result = authenticated_client.post(BASE, {"name":"Familie Test","billing_email":address,
        "contacts":[{"first_name":"Anna","last_name":"Groß","email":address}]}, format="json")
    assert result.status_code == 201, result.data
    assert result.data["billing_email"] == address
    assert result.data["contacts"][0]["email"] == address
    invalid = authenticated_client.patch(BASE+result.data["id"]+"/", {"billing_email":"gro ß@example.org"}, format="json")
    assert invalid.status_code == 400
    blank = authenticated_client.patch(BASE+result.data["id"]+"/", {"billing_email":""}, format="json")
    assert blank.status_code == 200



@pytest.mark.django_db
def test_additional_guardians_persist_and_are_family_billing_candidates(authenticated_client, studio, student):
    from apps.core.mail_associations import student_catalog

    family = Family.objects.create(studio=studio, name="Familie Test")
    student.family = family
    student.emergency_contact_first_name = "Anna"
    student.emergency_contact_last_name = "Test"
    student.emergency_contact_name = "Anna Test"
    student.emergency_contact_phone = "030123456"
    student.save()
    endpoint = f"/api/students/{student.pk}/"
    guardians = [
        {"first_name": "Max", "last_name": "Test", "phone": "030123457", "email": "max@example.org"},
        {"first_name": "Eva", "last_name": "Test", "phone": "030123458"},
    ]
    response = authenticated_client.patch(endpoint, {"additional_guardians": guardians}, format="json")
    assert response.status_code == 200, response.data
    student.refresh_from_db()
    assert student.emergency_contact_name == "Anna Test"
    assert len(student.additional_guardians) == 2
    assert authenticated_client.get(endpoint).data["additional_guardians"][0]["email"] == "max@example.org"
    assert str(student.pk) in student_catalog(studio)[1]["max@example.org"]
    rows = authenticated_client.get(f"{BASE}{family.pk}/member-data/").data
    row = next(r for r in rows if r["id"] == str(student.pk))
    assert [c["name"] for c in row["contacts"]] == ["Anna Test", "Max Test", "Eva Test"]
    assert [c["billing"]["recipient_name"] for c in row["guardian_sources"]] == ["Anna Test", "Max Test", "Eva Test"]
    assert row["guardian_sources"][1]["billing"]["recipient_email"] == "max@example.org"
    assert row["guardian_sources"][2]["billing"]["recipient_email"] == ""
    assert authenticated_client.patch(endpoint, {"additional_guardians": [{"first_name": "Invalid"}]}, format="json").status_code == 400
    assert authenticated_client.patch(endpoint, {"notes": "ignored"}, format="json").status_code == 200
    student.refresh_from_db()
    assert len(student.additional_guardians) == 2
    assert authenticated_client.patch(endpoint, {"additional_guardians": []}, format="json").status_code == 200
    student.refresh_from_db()
    assert student.additional_guardians == []
    assert student.emergency_contact_name == "Anna Test"
