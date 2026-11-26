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
