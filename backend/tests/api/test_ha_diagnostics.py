import json

from apps.lessons.ha_diagnostics import event


def test_diagnostic_log_enabled_and_secret_fields_discarded(tmp_path, monkeypatch):
    log = tmp_path / "attendance.jsonl"
    monkeypatch.setenv("HA_ATTENDANCE_DIAGNOSTICS", "1")
    monkeypatch.setenv("HA_ATTENDANCE_LOG_PATH", str(log))
    event("status_changed", lesson="test", previous_status="scheduled",
          status="in_progress", attendance_seconds=1200,
          token="sensitive", latitude=52, longitude=13)
    entry = json.loads(log.read_text())
    assert entry["event"] == "status_changed"
    assert entry["status"] == "in_progress"
    assert entry["attendance_seconds"] == 1200
    assert entry["time"]
    assert "sensitive" not in log.read_text()
    assert "latitude" not in entry and "longitude" not in entry


def test_diagnostic_logging_can_be_disabled(tmp_path, monkeypatch):
    log = tmp_path / "attendance.jsonl"
    monkeypatch.setenv("HA_ATTENDANCE_DIAGNOSTICS", "0")
    monkeypatch.setenv("HA_ATTENDANCE_LOG_PATH", str(log))
    event("recording_started", lesson="test")
    assert not log.exists()
