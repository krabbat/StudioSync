from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient
from apps.billing.models import Invoice, InvoiceLineItem, TuitionMonth, PaymentAllocation
from apps.billing.invoice_pdf import invoice_snapshot, render_invoice_pdf
from apps.core.models import Family, FamilyAccess, Student, TeachingContract, User, MailMessageCache
from apps.core.mail_cache import folder_for_owner
from apps.core.mail_associations import mail_student_overview

MONTH = date(2027,1,1)
GENERATE = "/api/billing/invoices/generate-month/"


def make_family(studio,student):
    family=Family.objects.create(studio=studio,name="Familie Test",billing_recipient_name="Eltern Test",
        billing_email="parent@example.org",address_line1="Testweg 1",postal_code="15738",city="Zeuthen",
        contacts=[{"name":"Eltern Test","first_name":"Eltern","last_name":"Test","email":"parent@example.org","phone":"","relation":"parent"}])
    student.family=family
    student.save(update_fields=["family"])
    sibling_user=User.objects.create_user(email="second@example.org",password="SafeStudent123!",role="student",
        first_name="Second",last_name="Test",is_approved=True)
    sibling=Student.objects.create(user=sibling_user,studio=studio,family=family)
    for member,amount in [(student,135),(sibling,100)]:
        TeachingContract.objects.create(student=member,contract_start_date=MONTH,contract_year_start=MONTH,
            lesson_minutes=45,monthly_amount=amount)
    return family,sibling


@pytest.mark.django_db
def test_collective_month_idempotent_and_individual_mode(authenticated_client,studio,student):
    family,sibling=make_family(studio,student)
    response=authenticated_client.post(GENERATE,{"family":str(family.pk),"month":str(MONTH)},format="json")
    assert response.status_code==200,response.data
    assert len(response.data["invoices"])==1
    invoice=Invoice.objects.get(pk=response.data["invoices"][0]["id"])
    assert invoice.family_id==family.pk and invoice.student_id is None
    assert invoice.total_amount==Decimal("235.00")
    assert set(invoice.line_items.values_list("student_id",flat=True))=={student.pk,sibling.pk}
    assert TuitionMonth.objects.filter(invoice=invoice).count()==2
    snapshot=invoice_snapshot(invoice)
    assert snapshot["recipient_email"]=="parent@example.org"
    assert render_invoice_pdf(snapshot).startswith(b"%PDF")
    assert authenticated_client.get(f"/api/billing/invoices/{invoice.pk}/pdf/").status_code==200
    duplicate=authenticated_client.post(GENERATE,{"family":str(family.pk),"month":str(MONTH)},format="json")
    assert duplicate.data["invoices"]==[]
    family.individual_billing=True
    family.save(update_fields=["individual_billing"])
    feb=authenticated_client.post(GENERATE,{"family":str(family.pk),"month":"2027-02-01"},format="json")
    assert feb.status_code==200,feb.data
    assert len(feb.data["invoices"])==2
    assert all(i["student"] and not i["family"] for i in feb.data["invoices"])
    assert Invoice.objects.get(pk=invoice.pk).total_amount==Decimal("235.00")


@pytest.mark.django_db
def test_partial_payment_allocated_and_protected(authenticated_client,studio,student):
    family,sibling=make_family(studio,student)
    response=authenticated_client.post(GENERATE,{"family":str(family.pk),"month":str(MONTH)},format="json")
    invoice=Invoice.objects.get(pk=response.data["invoices"][0]["id"])
    line=invoice.line_items.get(student=student)
    url=f"/api/billing/invoices/{invoice.pk}/book-payment/"
    payload={"payment_method":"bank_transfer","allocations":{str(line.pk):"135.00"}}
    response=authenticated_client.post(url,payload,format="json")
    assert response.status_code==200,response.data
    invoice.refresh_from_db()
    assert invoice.amount_paid==Decimal("135.00") and invoice.status=="partial"
    assert PaymentAllocation.objects.get(line_item=line).amount==Decimal("135.00")
    assert authenticated_client.post(url,payload,format="json").status_code==400
    assert authenticated_client.post(f"/api/billing/invoices/{invoice.pk}/mark-paid/").status_code==200
    invoice.refresh_from_db()
    assert invoice.amount_paid==Decimal("235.00") and invoice.status=="paid"
    assert PaymentAllocation.objects.filter(line_item__invoice=invoice).count()==2
    assert authenticated_client.delete(f"/api/billing/invoices/{invoice.pk}/").status_code==400


@pytest.mark.django_db
def test_grants_only_explicit_profiles_and_revocation(authenticated_client,studio,student,student_authenticated_client):
    family,sibling=make_family(studio,student)
    base=f"/api/core/family-access/{family.pk}/"
    portal=f"/api/core/family-portal/{family.pk}/"
    payload={"contact_index":0,"login_email":"parent@example.org","password":"StrongGuardian!8394",
             "confirm_password":"StrongGuardian!8394","student_ids":[str(student.pk)],"can_view_communication":True}
    assert student_authenticated_client.post(base,payload,format="json").status_code==403
    response=authenticated_client.post(base,payload,format="json")
    assert response.status_code==201,response.data
    assert "password" not in response.data
    grant=FamilyAccess.objects.get(pk=response.data["id"])
    assert grant.user.check_password(payload["password"])
    actor=APIClient();actor.force_authenticate(user=grant.user)
    assert actor.get(portal+f"students/{student.pk}/").status_code==200
    assert actor.get(portal+f"students/{sibling.pk}/").status_code==404
    assert actor.get("/api/core/mail/cache/students/").status_code==403
    assert authenticated_client.delete(base+str(grant.pk)+"/").status_code==204
    assert actor.get(portal+f"students/{student.pk}/").status_code==404
    assert authenticated_client.put(base+str(grant.pk)+"/",{"student_ids":[str(student.pk)],"can_view_communication":True},format="json").status_code==200
    assert actor.get(portal+f"students/{student.pk}/").status_code==200


@pytest.mark.django_db
def test_student_guardian_and_archival(authenticated_client,studio,student,student_authenticated_client):
    family,sibling=make_family(studio,student)
    base=f"/api/core/family-access/{family.pk}/"
    response=authenticated_client.post(base,{"user_id":str(student.user_id),"student_ids":[str(sibling.pk)],
        "can_view_communication":True},format="json")
    assert response.status_code==201,response.data
    portal=f"/api/core/family-portal/{family.pk}/students/{sibling.pk}/"
    assert student_authenticated_client.get(portal).status_code==200
    assert authenticated_client.post(f"/api/students/families/{family.pk}/archive/").status_code==204
    student.refresh_from_db();sibling.refresh_from_db();family.refresh_from_db()
    assert family.archived_at and student.family_id is None and sibling.family_id is None
    assert TeachingContract.objects.filter(student=student).exists()
    assert student_authenticated_client.get(portal).status_code==404


@pytest.mark.django_db
def test_family_mail_shared_contact_deduplicates(studio,student,admin_user):
    family,sibling=make_family(studio,student)
    folder=folder_for_owner(studio,admin_user,{},"inbox")
    MailMessageCache.objects.create(folder_cache=folder,uid=1,email="parent@example.org",
        subject="Family",contact_addresses=["parent@example.org"])
    MailMessageCache.objects.create(folder_cache=folder,uid=2,email="unrelated@example.org",
        subject="Unrelated",contact_addresses=["unrelated@example.org"])
    data=mail_student_overview(studio,admin_user,folder.account_key,None,family_id=family.pk)
    assert data["total"]==1
    assert data["messages"][0]["subject"]=="Family"
