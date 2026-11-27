"""Group appointment is one slot; roster membership and tuition credit are independent."""
from datetime import date, datetime, timedelta, timezone
import pytest
from apps.core.models import Family, Student, Studio, TeachingContract, TeachingGroup, User
from apps.lessons.models import Lesson, LessonParticipant
from apps.students.lesson_account import lesson_account_response


def second_pupil(studio):
    user=User.objects.create_user(email="second-group@example.org",password="StrongPass123!",role="student",first_name="Second",last_name="Pupil",is_approved=True)
    return Student.objects.create(studio=studio,user=user,is_active=True)


def payload(studio,teacher,student_ids,**source):
    start=datetime(2027,1,11,15,0,tzinfo=timezone.utc)
    return {"studio":str(studio.pk),"teacher":str(teacher.pk),"lesson_type":"group",
            "scheduled_start":start.isoformat(),"scheduled_end":(start+timedelta(minutes=45)).isoformat(),
            "participant_ids":[str(s) for s in student_ids],**source}


@pytest.mark.django_db
def test_group_roster_and_historical_snapshot(authenticated_client,studio,teacher,student):
    second=second_pupil(studio)
    base="/api/students/groups/"
    result=authenticated_client.post(base,{"name":"Blockflöte","student_ids":[str(student.pk),str(second.pk)]},format="json")
    assert result.status_code==201,result.data
    group=TeachingGroup.objects.get(pk=result.data["id"])
    assert group.members.count()==2
    data=payload(studio,teacher,[student.pk,second.pk],teaching_group=str(group.pk))
    response=authenticated_client.post("/api/lessons/",data,format="json")
    assert response.status_code==201,response.data
    lesson=Lesson.objects.get(teaching_group=group)
    assert lesson.participants.count()==2
    assert Lesson.objects.filter(studio=studio).count()==1
    assert authenticated_client.patch(base+str(group.pk)+"/",{"student_ids":[str(student.pk)]},format="json").status_code==200
    assert lesson.participants.count()==2
    assert authenticated_client.delete(base+str(group.pk)+"/").status_code==204
    group.refresh_from_db()
    assert group.archived_at and lesson.participants.count()==2


@pytest.mark.django_db
def test_family_participants_and_independent_quota(authenticated_client,studio,teacher,student):
    second=second_pupil(studio)
    family=Family.objects.create(studio=studio,name="Familie Test")
    Student.objects.filter(pk__in=[student.pk,second.pk]).update(family=family)
    for member in (student,second):
        TeachingContract.objects.create(student=member,contract_start_date=date(2027,1,1),contract_year_start=date(2027,1,1),lesson_minutes=45,monthly_amount=135)
    data=payload(studio,teacher,[student.pk,second.pk],teaching_family=str(family.pk))
    response=authenticated_client.post("/api/lessons/",data,format="json")
    assert response.status_code==201,response.data
    lesson=Lesson.objects.get(teaching_family=family)
    response=authenticated_client.patch(f"/api/lessons/{lesson.pk}/",{"status":"completed","participant_statuses":{str(second.pk):"student_cancelled"}},format="json")
    assert response.status_code==200,response.data
    one=lesson_account_response(student)["summary"]
    two=lesson_account_response(second)["summary"]
    assert one["delivered"]==1 and one["credited"]==1
    assert two["delivered"]==0 and two["credited"]==1
    assert two["student_cancelled"]==1


@pytest.mark.django_db
def test_family_selection_and_overlap_validation(authenticated_client,studio,teacher,student,student_authenticated_client):
    second=second_pupil(studio)
    family=Family.objects.create(studio=studio,name="Familie Test")
    student.family=family
    student.save(update_fields=["family"])
    data=payload(studio,teacher,[student.pk,second.pk],teaching_family=str(family.pk))
    assert authenticated_client.post("/api/lessons/",data,format="json").status_code==400
    second.family=family
    second.save(update_fields=["family"])
    assert student_authenticated_client.post("/api/lessons/",data,format="json").status_code==400
    assert authenticated_client.post("/api/lessons/",data,format="json").status_code==201
    assert authenticated_client.post("/api/lessons/",data,format="json").status_code==400
    assert LessonParticipant.objects.filter(lesson__teaching_family=family).count()==2
