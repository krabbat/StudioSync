"""Student-mail association and private reusable message drafts."""

import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0025_mail_cache"),
    ]

    operations = [
        migrations.AddField(
            model_name="mailmessagecache",
            name="contact_addresses",
            field=models.JSONField(default=list, blank=True),
        ),
        migrations.AddField(
            model_name="mailmessagecache",
            name="manual_student_ids",
            field=models.JSONField(default=None, null=True, blank=True),
        ),
        migrations.CreateModel(
            name="MailDraft",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4,
                                         editable=False, serialize=False)),
                ("account_key", models.CharField(max_length=64)),
                ("recipient", models.CharField(max_length=320, blank=True)),
                ("additional_recipient", models.CharField(max_length=320, blank=True)),
                ("student_ids", models.JSONField(default=list, blank=True)),
                ("resource_ids", models.JSONField(default=list, blank=True)),
                ("subject", models.CharField(max_length=220, blank=True)),
                ("body", models.TextField(blank=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("studio", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                           related_name="mail_drafts", to="core.studio")),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                          related_name="mail_drafts", to=settings.AUTH_USER_MODEL)),
            ],
            options={"db_table": "mail_drafts", "ordering": ["-updated_at"]},
        ),
        migrations.CreateModel(
            name="MailDraftAttachment",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4,
                                         editable=False, serialize=False)),
                ("filename", models.CharField(max_length=200)),
                ("content_type", models.CharField(max_length=150,
                                                  default="application/octet-stream")),
                ("payload", models.BinaryField()),
                ("draft", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                          related_name="local_attachments", to="core.maildraft")),
            ],
            options={"db_table": "mail_draft_attachments"},
        ),
    ]
