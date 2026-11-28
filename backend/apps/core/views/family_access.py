"""Family portal grants. No parent is given access to the studio's owner APIs."""
from datetime import date
from uuid import UUID

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from rest_framework import permissions
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.models import Family, FamilyAccess, Student, TeachingContract, User, MailMessageCache
from apps.core.tenancy import studios_for_request
from apps.core.international_email import InternationalEmailField
from apps.core.security import revoke_user_tokens
from apps.core.mail_associations import student_catalog, assigned_student_ids, normalize_address
from apps.core.mail_cache import mailbox_account_key
from apps.core.mail_service import get_folder_message, MailFetchError
from apps.billing.models import Invoice
from apps.billing.invoice_delivery import invoice_pdf_bytes
from apps.billing.family_payments import line_paid
from apps.billing.payment_status import payment_state, paid_amount
from apps.students.serializers import TeachingContractSerializer
from apps.students.lesson_account import lesson_account_response
from apps.lessons.models import Lesson
from apps.resources.models import Resource


def uuid_value(value):
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError({"code": "invalid_id"})


def age_review(student):
    birth = student.birth_date
    if not birth:
        return False
    today = timezone.localdate()
    return today.year-birth.year-((today.month,today.day)<(birth.month,birth.day)) >= 18


def admin_family(request, family_id):
    if request.user.role != "admin":
        raise PermissionDenied()
    family = Family.objects.filter(pk=family_id, studio__in=studios_for_request(request), archived_at__isnull=True).first()
    if family is None:
        raise NotFound()
    return family


def grant_data(grant):
    students = grant.students.filter(family=grant.family, studio=grant.family.studio)
    return {"id": str(grant.pk), "user_id": str(grant.user_id),
            "name": grant.user.get_full_name(), "email": grant.user.email,
            "student_ids": [str(s.pk) for s in students],
            "adult_review": [str(s.pk) for s in students if age_review(s)],
            "can_view_communication": grant.can_view_communication, "revoked": bool(grant.revoked_at),
            "login_enabled": grant.user.is_active and grant.user.is_approved and grant.user.has_usable_password()}


def valid_students(family, raw):
    if not isinstance(raw, list) or len(raw)>100:
        raise ValidationError({"code": "invalid_students"})
    ids = {uuid_value(v) for v in raw}
    rows = list(Student.objects.filter(pk__in=ids, family=family, studio=family.studio, user__role="student"))
    if len(rows) != len(ids):
        raise ValidationError({"code": "invalid_students"})
    return rows


def activate_account(user, data, *, new=False):
    password = data.get("password")
    if password:
        if not isinstance(password, str) or password != data.get("confirm_password"):
            raise ValidationError({"code":"password_mismatch"})
        try:
            email = InternationalEmailField().run_validation(data.get("login_email") or user.email)
        except ValidationError:
            raise ValidationError({"code":"invalid_email"})
        if email.casefold().endswith(".invalid") or User.objects.filter(email__iexact=email).exclude(pk=user.pk).exists():
            raise ValidationError({"code":"email_unavailable"})
        user.email = email
        try:
            validate_password(password, user=user)
        except DjangoValidationError:
            raise ValidationError({"code":"weak_password"})
        user.set_password(password)
        user.is_active = True
        user.is_approved = True
        user.save()
        if not new:
            revoke_user_tokens(user)
    elif new or not (user.is_active and user.is_approved and user.has_usable_password()):
        raise ValidationError({"code":"login_required"})


class FamilyGrantAdminView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, family_id, grant_id=None):
        family = admin_family(request, family_id)
        if grant_id is not None:
            grant=family.access_grants.filter(pk=grant_id).first()
            if not grant: raise NotFound()
            return Response(grant_data(grant))
        return Response([grant_data(g) for g in family.access_grants.select_related("user")])

    @transaction.atomic
    def post(self, request, family_id, grant_id=None):
        if grant_id is not None: raise NotFound()
        family = admin_family(request, family_id)
        family = Family.objects.select_for_update().get(pk=family.pk)
        rows = valid_students(family, request.data.get("student_ids", []))
        communication = request.data.get("can_view_communication", True)
        if not isinstance(communication, bool) or (not rows and not communication):
            raise ValidationError({"code":"invalid_permissions"})
        raw_user = request.data.get("user_id")
        if raw_user:
            # A selected existing pupil is explicit; email matching never creates access.
            user = User.objects.filter(pk=uuid_value(raw_user), role="student",
                student_profile__family=family, student_profile__studio=family.studio).first()
            if not user:
                raise ValidationError({"code":"invalid_person"})
            if family.access_grants.filter(user=user).exists():
                raise ValidationError({"code":"grant_exists"})
            activate_account(user, request.data)
        else:
            index = request.data.get("contact_index")
            if not isinstance(index, int) or isinstance(index, bool) or index<0 or index>=len(family.contacts or []):
                raise ValidationError({"code":"invalid_person"})
            contact = family.contacts[index]
            first = str(contact.get("first_name") or "").strip()
            last = str(contact.get("last_name") or "").strip()
            if not first or not last:
                raise ValidationError({"code":"contact_names_required"})
            email = str(request.data.get("login_email") or contact.get("email") or "").strip()
            user = User(role="parent", first_name=first, last_name=last, email=email,
                        phone=str(contact.get("phone") or "")[:20])
            activate_account(user, request.data, new=True)
        grant = FamilyAccess.objects.create(family=family, user=user, can_view_communication=communication)
        grant.students.set(rows)
        return Response(grant_data(grant), status=201)

    @transaction.atomic
    def put(self, request, family_id, grant_id=None):
        family = admin_family(request, family_id)
        grant = family.access_grants.select_for_update().filter(pk=grant_id).select_related("user").first()
        if not grant:
            raise NotFound()
        rows = valid_students(family, request.data.get("student_ids", []))
        communication = request.data.get("can_view_communication", False)
        if not isinstance(communication,bool) or (not rows and not communication):
            raise ValidationError({"code":"invalid_permissions"})
        if request.data.get("password"):
            activate_account(grant.user, request.data)
        grant.can_view_communication = communication
        grant.revoked_at = None
        grant.save(update_fields=["can_view_communication","revoked_at"])
        grant.students.set(rows)
        return Response(grant_data(grant))

    @transaction.atomic
    def delete(self, request, family_id, grant_id=None):
        family = admin_family(request, family_id)
        grant = family.access_grants.filter(pk=grant_id).first()
        if not grant:
            raise NotFound()
        grant.revoked_at = timezone.now()
        grant.save(update_fields=["revoked_at"])
        return Response(status=204)


def portal_grants(user):
    if user.role not in ("parent","student") or not user.is_active or not user.is_approved:
        return FamilyAccess.objects.none()
    grants = FamilyAccess.objects.filter(user=user, family__archived_at__isnull=True, revoked_at__isnull=True)
    # A pupil acting as guardian must still belong to the same family.
    if user.role == "student":
        grants = grants.filter(family__students__user=user)
    return grants.distinct()


def portal_grant(request, family_id):
    grant = portal_grants(request.user).filter(family_id=family_id).select_related("family__studio__owner").first()
    if grant is None:
        raise NotFound()
    return grant


def allowed_students(grant):
    return grant.students.filter(family=grant.family, studio=grant.family.studio, user__role="student").select_related("user")


def portal_student(grant, student_id):
    student = allowed_students(grant).filter(pk=student_id).first()
    if not student:
        raise NotFound()
    return student


def student_invoices(student):
    return Invoice.objects.filter(studio=student.studio, sent_at__isnull=False).filter(
        Q(student=student)|Q(tuition_months__student=student)).exclude(status="draft").exclude(block_bill__test_only=True).filter(monthly_test=False).distinct()


def invoice_share(invoice, student):
    if invoice.family_id:
        lines = invoice.line_items.filter(student=student)
        amount = sum((l.total_price for l in lines), 0)
        paid = sum((line_paid(l) for l in lines), 0)
    else:
        amount, paid = invoice.total_amount, paid_amount(invoice)
    return {"id":str(invoice.pk),"number":invoice.invoice_number,"month":invoice.service_month,
            "amount":str(amount),"paid":str(paid),"status":payment_state(invoice)}


def allowed_resources(student):
    return Resource.objects.filter(studio=student.studio).filter(
        Q(is_public=True)|Q(shared_with_students=student)|Q(band__in=student.bands.all())).distinct()


def mailbox_config(grant):
    owner = grant.family.studio.owner
    prefs = owner.preferences if isinstance(owner.preferences,dict) else {}
    config = prefs.get("technical", {})
    return owner, config if isinstance(config,dict) else {}


def family_message_query(grant):
    if not grant.can_view_communication:
        raise PermissionDenied()
    owner, config = mailbox_config(grant)
    return MailMessageCache.objects.filter(folder_cache__studio=grant.family.studio,
        folder_cache__owner=owner, folder_cache__account_key=mailbox_account_key(config),
        folder_cache__folder__in=["inbox","sent","archive"]).select_related("folder_cache")


def family_message_matches(grant, row, catalog, by_address):
    # Do not expose drafts, manual exclusions or messages outside the granted family.
    ids = {str(pk) for pk in grant.family.students.values_list("pk",flat=True)}
    if row.manual_student_ids is not None:
        return bool(ids.intersection(str(v) for v in row.manual_student_ids))
    if ids.intersection(assigned_student_ids(row,catalog,by_address)):
        return True
    addresses = {normalize_address(c.get("email")) for c in grant.family.contacts or [] if isinstance(c,dict)}
    addresses.add(normalize_address(grant.family.billing_email))
    addresses.discard("")
    return bool(addresses.intersection(normalize_address(a) for a in (row.contact_addresses or [row.email])))


class FamilyPortalView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    def get(self, request):
        return Response([{"id":str(g.family_id),"name":str(g.family),
            "communication":g.can_view_communication,
            "students":[{"id":str(s.pk),"name":s.user.get_full_name()} for s in allowed_students(g)]}
            for g in portal_grants(request.user).select_related("family")])


class FamilyPortalStudentView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    def get(self, request, family_id, student_id):
        grant = portal_grant(request, family_id)
        student = portal_student(grant,student_id)
        contract = TeachingContract.objects.filter(student=student).first()
        account = lesson_account_response(student)
        # Only customer-facing totals, not private correction notes or tracker diagnostics.
        summary = {**account.get("summary",{}), "quota":account.get("quota",44)} if account.get("available") else None
        lessons = Lesson.objects.filter(studio=student.studio).filter(Q(student=student)|Q(participants__student=student)).distinct().order_by("-scheduled_start")[:100]
        group_statuses = dict(student.group_participations.values_list("lesson_id","status"))
        def individual_status(lesson):
            value=group_statuses.get(lesson.pk,"inherit")
            return lesson.status if value=="inherit" else "cancelled" if value in ("student_cancelled","teacher_cancelled") else value
        invoices = student_invoices(student)[:100]
        resources = allowed_resources(student).order_by("title")[:200]
        return Response({"id":str(student.pk),"name":student.user.get_full_name(),
            "birth_date":student.birth_date,"instrument":student.instrument,
            "email":student.contact_email,"phone":student.user.phone,
            "address":[student.address_line1,student.postal_code,student.city],
            "contract":TeachingContractSerializer(contract).data if contract else None,
            "summary":summary,
            "lessons":[{"id":str(l.pk),"start":l.scheduled_start,"end":l.scheduled_end,"status":individual_status(l)} for l in lessons],
            "invoices":[invoice_share(i,student) for i in invoices],
            "resources":[{"id":str(r.pk),"title":r.title,"has_file":bool(r.file),"url":r.external_url} for r in resources]})


class FamilyPortalResourceView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    def get(self, request, family_id, student_id, resource_id):
        student = portal_student(portal_grant(request,family_id),student_id)
        resource = allowed_resources(student).filter(pk=resource_id).first()
        if not resource or not resource.file:
            raise NotFound()
        response=FileResponse(resource.file.open("rb"),as_attachment=True,filename=resource.file.name.rsplit("/",1)[-1])
        response["Cache-Control"]="private, no-store"
        return response


class FamilyPortalInvoiceView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    def get(self, request, family_id, student_id, invoice_id):
        grant=portal_grant(request,family_id)
        student=portal_student(grant,student_id)
        invoice=student_invoices(student).filter(pk=invoice_id).first()
        if not invoice:
            raise NotFound()
        # A collective PDF contains other children's charges; only show it if all
        # students on that invoice are explicitly permitted.
        if invoice.family_id:
            billed=set(invoice.tuition_months.values_list("student_id",flat=True))
            permitted=set(allowed_students(grant).values_list("pk",flat=True))
            if not billed or not billed.issubset(permitted):
                raise PermissionDenied()
        response=HttpResponse(invoice_pdf_bytes(invoice),content_type="application/pdf")
        response["Content-Disposition"]=f'attachment; filename="MUSart-{invoice.invoice_number}.pdf"'
        response["Cache-Control"]="private, no-store"
        return response


class FamilyPortalMailView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    def get(self, request, family_id, message_id=None):
        grant=portal_grant(request,family_id)
        query=family_message_query(grant)
        catalog,by_address=student_catalog(grant.family.studio)
        if message_id is not None:
            row=query.filter(pk=message_id).first()
            if not row or not family_message_matches(grant,row,catalog,by_address):
                raise NotFound()
            body=row.body if row.body_loaded else None
            if body is None:
                owner,config=mailbox_config(grant)
                if not row.folder_cache.uidvalidity:
                    raise NotFound()
                try:
                    data=get_folder_message(config,row.folder_cache.folder,row.uid,expected_uidvalidity=row.folder_cache.uidvalidity)
                except MailFetchError:
                    raise NotFound()
                # Re-check live correspondent headers before returning message text.
                row.contact_addresses=data.get("contact_addresses",[])
                row.email=data.get("email","")
                if not family_message_matches(grant,row,catalog,by_address):
                    raise NotFound()
                body=data.get("body","")
            return Response({"id":row.pk,"subject":row.subject,"body":body,"date":row.date})
        try:
            offset=int(request.query_params.get("offset",0))
            if not 0<=offset<=1000000:raise ValueError()
        except (TypeError,ValueError):
            raise ValidationError({"code":"invalid_page"})
        rows=[]
        for row in query.order_by("-date","-pk").iterator(chunk_size=500):
            if family_message_matches(grant,row,catalog,by_address):
                rows.append({"id":row.pk,"subject":row.subject,"date":row.date,"from":row.sender_name,"preview":row.preview})
        return Response({"messages":rows[offset:offset+40],"total":len(rows),"has_more":offset+40<len(rows)})
