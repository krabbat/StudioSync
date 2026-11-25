"""Temporary, opt-out attendance diagnostics; never log credentials or raw GPS."""
import json
import logging
import os
from pathlib import Path
from zoneinfo import ZoneInfo

from django.utils import timezone

LOG = logging.getLogger(__name__)
LOCAL = ZoneInfo("Europe/Berlin")

# Explicit allowlist: do not write arbitrary HA responses or exception messages.
FIELDS = {
    "studio", "lesson", "zone", "tracker", "scheduled_start", "scheduled_end",
    "window_start", "window_end", "previous_status", "status", "present",
    "history_valid", "attendance_seconds", "arrival", "departure", "watch_active",
    "manual_override", "finalized", "reason", "error_type", "http_status",
    "candidate_count", "recovery_count", "history_start", "history_end",
    "interval_count", "statistics_day", "total_seconds", "total_arrival",
    "total_departure", "statistics_pending", "activation", "next_run",
    "remaining_watch_count", "remaining_check_count", "source",
}


def event(name, **fields):
    if os.getenv("HA_ATTENDANCE_DIAGNOSTICS", "0").strip().lower() not in {"1", "true", "yes", "on"}:
        return
    try:
        payload = {"time": timezone.now().astimezone(LOCAL).isoformat(timespec="seconds"),
                   "event": name}
        payload.update({key: value for key, value in fields.items() if key in FIELDS})
        line = (json.dumps(payload, ensure_ascii=False, default=str) + "\n").encode("utf-8")
        path = Path(os.getenv("HA_ATTENDANCE_LOG_PATH", "/app/ha-diagnostics/attendance.jsonl"))
        # O_APPEND + a single write keeps entries intact across worker processes.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.write(fd, line)
        finally:
            os.close(fd)
    except (OSError, ValueError, TypeError):
        # Diagnostics must never prevent attendance or calendar processing.
        LOG.warning("HA attendance diagnostic log could not be written")
