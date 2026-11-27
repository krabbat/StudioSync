from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies = [("lessons","0012_merge_cancellation_attendance"),("core","0031_teaching_groups")]
    operations = [
        migrations.AddField(model_name="lesson", name="teaching_family", field=models.ForeignKey(blank=True,null=True,on_delete=django.db.models.deletion.PROTECT,related_name="group_lessons",to="core.family")),
        migrations.AddField(model_name="lesson", name="teaching_group", field=models.ForeignKey(blank=True,null=True,on_delete=django.db.models.deletion.PROTECT,related_name="lessons",to="core.teachinggroup")),
        migrations.AddField(model_name="lesson", name="group_name_snapshot", field=models.CharField(max_length=200,blank=True)),
        migrations.CreateModel(name="LessonParticipant", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("name_snapshot", models.CharField(max_length=255)),
            ("status", models.CharField(max_length=20,default="inherit",choices=[("inherit","Use appointment status"),("completed","Completed"),("student_cancelled","Student cancellation"),("teacher_cancelled","Teacher cancellation"),("no_show","No show")])),
            ("lesson",models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,related_name="participants",to="lessons.lesson")),
            ("student",models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,related_name="group_participations",to="core.student")),
        ],options={"ordering":["name_snapshot","id"],"constraints":[models.UniqueConstraint(fields=("lesson","student"),name="unique_lesson_participant")]}),
    ]
