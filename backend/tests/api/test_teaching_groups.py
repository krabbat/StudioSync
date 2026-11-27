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
    data=payload(studio,teacher,[student.pk,second.pk],teaching_group=str(group.pk),group_ha_zone="Unterrichtsort")
    response=authenticated_client.post("/api/lessons/",data,format="json")
    assert response.status_code==201,response.data
    lesson=Lesson.objects.get(teaching_group=group)
    assert lesson.participants.count()==2
    listed=authenticated_client.get("/api/lessons/")
    assert listed.status_code==200
    rows=listed.data.get("results",[]) if isinstance(listed.data,dict) else listed.data
    assert len(rows)==1 and len(rows[0]["group_participants"])==2
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


@pytest.mark.django_db
@pytest.mark.parametrize("minutes,expected,review", [(30,"completed",False),(29,"scheduled",True)])
def test_ha_shared_window_counts_each_participant_once(studio,teacher,student,minutes,expected,review):
    from unittest.mock import patch
    from django.utils import timezone as dj_timezone
    from apps.lessons.ha_attendance import live_studio,norm
    second=second_pupil(studio)
    family=Family.objects.create(studio=studio,name="Familie Böhm",ha_zone_entity_id="Familie Böhm")
    Student.objects.filter(pk__in=[student.pk,second.pk]).update(family=family)
    start=dj_timezone.now().replace(microsecond=0)
    day=dj_timezone.localdate()
    for pupil in (student,second):
        TeachingContract.objects.create(student=pupil,contract_start_date=day-timedelta(days=2),contract_year_start=day-timedelta(days=2),lesson_minutes=45,monthly_amount=135)
    lesson=Lesson(studio=studio,teacher=teacher,teaching_family=family,group_name_snapshot=family.name,
        lesson_type="group",scheduled_start=start,scheduled_end=start+timedelta(minutes=45))
    Lesson.objects.bulk_create([lesson])
    for pupil in (student,second):
        LessonParticipant.objects.create(lesson=lesson,student=pupil,name_snapshot=pupil.user.get_full_name())
    name=norm(family.name)
    rows=[(start-timedelta(minutes=30),start,"not_home"),
          (start,start+timedelta(minutes=minutes),name),
          (start+timedelta(minutes=minutes),lesson.scheduled_end,"not_home")]
    with patch("apps.lessons.ha_attendance.HA") as mock:
        ha=mock.return_value
        ha.tracker="device_tracker.peters_iphone"
        ha.states.return_value=({name:[("zone.family",family.name)]},"not_home")
        ha.history.return_value=rows
        live_studio(studio,start-timedelta(days=1),lesson.scheduled_end)
        lesson.refresh_from_db()
        assert lesson.status==expected
        assert bool(lesson.ha_attendance.get("review_required"))==review
        assert lesson.ha_attendance["attendance_seconds"]==minutes*60
        assert lesson.ha_finalized_at
        live_studio(studio,start-timedelta(days=1),lesson.scheduled_end+timedelta(minutes=2))
        ha.history.assert_called_once()
    for pupil in (student,second):
        summary=lesson_account_response(pupil)["summary"]
        assert summary["credited"]==int(not review)
        assert summary["delivered"]==int(not review)


@pytest.mark.django_db
def test_icloud_group_series_preserves_roster_and_moved_occurrence(studio,teacher,student,admin_user):
    from unittest.mock import MagicMock
    from django.utils import timezone as dj_timezone
    from icalendar import Calendar,Event
    from apps.lessons.icloud_sync import _import_series
    from apps.lessons.models import ICloudCalendarSeries
    second=second_pupil(studio)
    group=TeachingGroup.objects.create(studio=studio,name="Duo")
    group.members.set([student,second])
    calendar_url="https://p12-caldav.icloud.com/abc/calendars/unterricht/"
    uid="group-test@musart.de"
    start=dj_timezone.now().replace(microsecond=0)+timedelta(days=3)
    booking={"family":"","group":str(group.pk),"name":"Duo","zone":"Unterrichtsort",
             "members":[{"id":str(p.pk),"name":p.user.get_full_name()} for p in (student,second)]}
    series=ICloudCalendarSeries.objects.create(studio=studio,user=admin_user,teacher=teacher,
        calendar_url=calendar_url,uid=uid,group_booking=booking)
    cal=Calendar()
    cal.add("prodid","-//MUSart tests//DE")
    cal.add("version","2.0")
    master=Event()
    master.add("uid",uid);master.add("dtstamp",start);master.add("dtstart",start)
    master.add("dtend",start+timedelta(minutes=45));master.add("summary","Duo")
    master.add("rrule",{"freq":"weekly","count":2})
    master.add("X-STUDIOSYNC-GROUP-BOOKING","1")
    cal.add_component(master)
    remote=MagicMock()
    remote.url=calendar_url+"duo.ics"
    remote.data=cal.to_ical().decode()
    def stats():return {"imported":0,"cancelled":0,"unassigned":0,"conflicts":0,"exported":0}
    result=stats()
    _import_series(admin_user,studio,calendar_url,remote,result)
    assert result["imported"]==2
    assert LessonParticipant.objects.filter(lesson__teaching_group=group).count()==4
    group.members.remove(second)
    occurrence=Lesson.objects.filter(teaching_group=group).order_by("scheduled_start").last()
    occurrence.participants.filter(student=second).update(status="student_cancelled")
    override=Event()
    override.add("uid",uid);override.add("recurrence-id",start+timedelta(days=7))
    override.add("dtstart",start+timedelta(days=7,hours=1));override.add("dtend",start+timedelta(days=7,hours=1,minutes=45))
    override.add("summary","Duo")
    cal.add_component(override)
    remote.data=cal.to_ical().decode()
    result=stats()
    _import_series(admin_user,studio,calendar_url,remote,result)
    occurrence.refresh_from_db()
    assert occurrence.scheduled_start==start+timedelta(days=7,hours=1)
    assert occurrence.participants.count()==2
    assert occurrence.participants.get(student=second).status=="student_cancelled"
    assert Lesson.objects.filter(teaching_group=group).count()==2
    assert result["conflicts"]==0
