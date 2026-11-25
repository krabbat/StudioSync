from django.urls import include, path, re_path

from rest_framework.routers import DefaultRouter  # noqa: F401

from apps.core.views import (
    APIKeyViewSet,
    BandViewSet,
    DashboardAnalyticsView,
    DashboardStatsView,
    ReportsExportView,
    StudentViewSet,
    StudioViewSet,
    TeacherViewSet,
    UserViewSet,
    backup,
    gdpr,
    setup,
    update,
)
from apps.core.views.mail import (
    MailCachedFolderDetailView,
    MailCachedFolderListView,
    MailCachedFolderSyncView,
    MailStudentCatalogView,
    MailStudentOverviewView,
    MailMessageAssociationView,
    MailFolderActionView,
    MailFolderDetailView,
    MailFolderListView,
    MailInboxActionView,
    MailInboxDetailView,
    MailInboxListView,
)
from apps.core.views.mail_drafts import (
    MailDraftsView, MailDraftDetailView, MailDraftAttachmentView,
)
from apps.core.views.mail_outbound import (
    MailRecipientsView,
    MailResourceAttachmentsView,
    MailResourceDownloadView,
    MailSendView,
)
from apps.core.views.home_assistant import HomeAssistantConnectionView
from apps.core.views.icloud_calendar import ICloudCalendarListView, ICloudCalendarWriteTestView
from apps.core.views.icloud_sync import (
    ICloudSyncView, ICloudSeriesView, ICloudSeriesAssignView, ICloudSeriesCreateView,
    ICloudSeriesResolveView,
)
from config.routers import OptionalSlashRouter

router = OptionalSlashRouter()
router.register(r"users", UserViewSet, basename="user")
router.register(r"studios", StudioViewSet, basename="studio")
router.register(r"teachers", TeacherViewSet, basename="teacher")
router.register(r"students", StudentViewSet, basename="student")
router.register(r"bands", BandViewSet, basename="band")
router.register(r"api-keys", APIKeyViewSet, basename="api-key")
# Explicitly handle users/me with optional slash to prevent 404s
me_list = UserViewSet.as_view({"get": "me", "put": "me", "patch": "me"})

urlpatterns_manual = [
    re_path(r"^users/me/?$", me_list, name="user-me-manual"),
]

urlpatterns = (
    [
        path("stats/", DashboardStatsView.as_view(), name="dashboard-stats"),
        path("analytics/", DashboardAnalyticsView.as_view(), name="dashboard-analytics"),
        path("reports/export/", ReportsExportView.as_view(), name="reports-export"),
        re_path(r"^home-assistant/connection/?$", HomeAssistantConnectionView.as_view(), name="home-assistant-connection"),
        re_path(r"^calendar/icloud/calendars/?$", ICloudCalendarListView.as_view(), name="icloud-calendars"),
        re_path(r"^calendar/icloud/test/?$", ICloudCalendarWriteTestView.as_view(), name="icloud-write-test"),
        re_path(r"^calendar/icloud/sync/?$", ICloudSyncView.as_view(), name="icloud-sync"),
        re_path(r"^calendar/icloud/series/?$", ICloudSeriesView.as_view(), name="icloud-series"),
        re_path(r"^calendar/icloud/series/create/?$", ICloudSeriesCreateView.as_view(), name="icloud-series-create"),
        re_path(r"^calendar/icloud/series/(?P<series_id>[0-9a-fA-F-]{36})/assign/?$", ICloudSeriesAssignView.as_view(), name="icloud-series-assign"),
        re_path(r"^calendar/icloud/series/(?P<series_id>[0-9a-fA-F-]{36})/resolve/?$", ICloudSeriesResolveView.as_view(), name="icloud-series-resolve"),
        re_path(r"^mail/inbox/?$", MailInboxListView.as_view(), name="mail-inbox-list"),
        re_path(
            r"^mail/recipients/?$",
            MailRecipientsView.as_view(),
            name="mail-recipients",
        ),
        re_path(
            r"^mail/send/?$",
            MailSendView.as_view(),
            name="mail-send",
        ),
        re_path(r"^mail/drafts/?$", MailDraftsView.as_view(), name="mail-drafts"),
        re_path(
            r"^mail/drafts/(?P<draft_id>[0-9a-fA-F-]{36})/?$",
            MailDraftDetailView.as_view(), name="mail-draft-detail",
        ),
        re_path(
            r"^mail/drafts/(?P<draft_id>[0-9a-fA-F-]{36})/attachments/(?P<file_id>[0-9a-fA-F-]{36})/?$",
            MailDraftAttachmentView.as_view(), name="mail-draft-file",
        ),
        re_path(
            r"^mail/attachments/resources/(?P<resource_id>[0-9a-fA-F-]{36})/download/?$",
            MailResourceDownloadView.as_view(),
            name="mail-attachment-resource-download",
        ),
        re_path(
            r"^mail/attachments/resources/?$",
            MailResourceAttachmentsView.as_view(),
            name="mail-attachment-resources",
        ),
        re_path(
            r"^mail/inbox/actions/?$",
            MailInboxActionView.as_view(),
            name="mail-inbox-actions",
        ),
        re_path(
            r"^mail/inbox/(?P<uid>[0-9]+)/?$",
            MailInboxDetailView.as_view(),
            name="mail-inbox-detail",
        ),
        re_path(
            r"^mail/cache/students/?$",
            MailStudentCatalogView.as_view(),
            name="mail-student-catalog",
        ),
        re_path(
            r"^mail/cache/students/(?P<student_id>[0-9a-fA-F-]{36})/overview/?$",
            MailStudentOverviewView.as_view(),
            name="mail-student-overview",
        ),
        re_path(
            r"^mail/cache/folders/(?P<folder>inbox|sent|drafts|archive|spam|trash)/(?P<uid>[0-9]+)/students/?$",
            MailMessageAssociationView.as_view(),
            name="mail-message-students",
        ),
        re_path(
            r"^mail/cache/folders/(?P<folder>inbox|sent|drafts|archive|spam|trash)/?$",
            MailCachedFolderListView.as_view(),
            name="mail-cache-folder-list",
        ),
        re_path(
            r"^mail/cache/folders/(?P<folder>inbox|sent|drafts|archive|spam|trash)/sync/?$",
            MailCachedFolderSyncView.as_view(),
            name="mail-cache-folder-sync",
        ),
        re_path(
            r"^mail/cache/folders/(?P<folder>inbox|sent|drafts|archive|spam|trash)/(?P<uid>[0-9]+)/?$",
            MailCachedFolderDetailView.as_view(),
            name="mail-cache-folder-detail",
        ),
        re_path(
            r"^mail/folders/(?P<folder>inbox|sent|drafts|archive|spam|trash)/?$",
            MailFolderListView.as_view(),
            name="mail-folder-list",
        ),
        re_path(
            r"^mail/folders/(?P<folder>inbox|sent|drafts|archive|spam|trash)/actions/?$",
            MailFolderActionView.as_view(),
            name="mail-folder-actions",
        ),
        re_path(
            r"^mail/folders/(?P<folder>inbox|sent|drafts|archive|spam|trash)/(?P<uid>[0-9]+)/?$",
            MailFolderDetailView.as_view(),
            name="mail-folder-detail",
        ),
        # Setup Wizard Endpoints (trailing slash optional — Next.js proxy strips trailing slashes)
        re_path(r"^setup/status/?$", setup.check_setup_status, name="setup-status"),
        re_path(r"^setup/features/?$", setup.update_feature_settings, name="setup-features"),
        re_path(r"^setup/complete/?$", setup.complete_setup_wizard, name="setup-complete"),
        # GDPR Compliance Endpoints
        path("gdpr/export-data/", gdpr.export_my_data, name="gdpr-export-data"),
        path("gdpr/delete-account/", gdpr.request_account_deletion, name="gdpr-delete-account"),
        path("gdpr/privacy-dashboard/", gdpr.privacy_dashboard, name="gdpr-privacy-dashboard"),
        path("gdpr/privacy-settings/", gdpr.update_privacy_settings, name="gdpr-privacy-settings"),
        path("gdpr/consent/", gdpr.record_consent, name="gdpr-consent"),
        # System Migration/Backup
        path("system/export/", backup.export_system, name="system-export"),
        path("system/import/", backup.import_system, name="system-import"),
        # Software Updates
        path("system/update/status/", update.update_status, name="update-status"),
        path("system/update/perform/", update.perform_update, name="update-perform"),
        path("system/update/version/", update.current_version, name="update-version"),
    ]
    + urlpatterns_manual
    + [
        path("", include(router.urls)),
    ]
)
