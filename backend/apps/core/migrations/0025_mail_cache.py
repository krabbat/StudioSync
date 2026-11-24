"""Persistent tenant-scoped cache for IMAP headers and opened message bodies."""

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0024_annual_quota_44"),
    ]

    operations = [
        migrations.CreateModel(
            name="MailFolderCache",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("account_key", models.CharField(max_length=64)),
                ("folder", models.CharField(max_length=16)),
                ("uidvalidity", models.CharField(blank=True, max_length=24)),
                ("server_total", models.PositiveIntegerField(default=0)),
                ("requested_count", models.PositiveIntegerField(default=200)),
                ("last_synced_at", models.DateTimeField(blank=True, null=True)),
                ("sync_started_at", models.DateTimeField(blank=True, null=True)),
                ("sync_error", models.CharField(blank=True, max_length=240)),
                ("owner", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="mail_cache_folders",
                    to=settings.AUTH_USER_MODEL,
                )),
                ("studio", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="mail_cache_folders",
                    to="core.studio",
                )),
            ],
            options={"db_table": "mail_folder_cache"},
        ),
        migrations.CreateModel(
            name="MailMessageCache",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uid", models.BigIntegerField()),
                ("sender_name", models.CharField(blank=True, max_length=320)),
                ("email", models.CharField(blank=True, max_length=320)),
                ("subject", models.TextField(blank=True)),
                ("date", models.CharField(blank=True, max_length=64)),
                ("unread", models.BooleanField(default=True)),
                ("starred", models.BooleanField(default=False)),
                ("answered", models.BooleanField(default=False)),
                ("has_attachment", models.BooleanField(default=False)),
                ("size", models.BigIntegerField(blank=True, null=True)),
                ("preview", models.TextField(blank=True)),
                ("attachments", models.JSONField(blank=True, default=list)),
                ("body", models.TextField(blank=True)),
                ("body_loaded", models.BooleanField(default=False)),
                ("folder_cache", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="messages",
                    to="core.mailfoldercache",
                )),
            ],
            options={"db_table": "mail_message_cache"},
        ),
        migrations.AddConstraint(
            model_name="mailfoldercache",
            constraint=models.UniqueConstraint(
                fields=("studio", "owner", "account_key", "folder"),
                name="unique_mail_cache_folder_account",
            ),
        ),
        migrations.AddConstraint(
            model_name="mailmessagecache",
            constraint=models.UniqueConstraint(
                fields=("folder_cache", "uid"),
                name="unique_mail_cache_message_uid",
            ),
        ),
        migrations.AddIndex(
            model_name="mailmessagecache",
            index=models.Index(
                fields=["folder_cache", "-uid"],
                name="mail_cache_folder_uid_desc",
            ),
        ),
    ]
