from datetime import datetime, timezone
from types import SimpleNamespace

from apps.core.views.stats import recent_lesson_activity


class Rows(list):
    def iterator(self, chunk_size):
        return iter(self)


def lesson(pk, status="scheduled", pattern=None, series=None):
    now = datetime(2026, 11, 26, 17, 15, tzinfo=timezone.utc)
    return SimpleNamespace(pk=pk, status=status, recurring_pattern_id=pattern,
                           icloud_occurrence=SimpleNamespace(series_id=series) if series else None,
                           student_id=None, band_id=None, guest_name="Testschüler",
                           activity_time=now, scheduled_start=now)


def test_series_grouping_and_distinct_outcomes():
    rows = Rows([lesson("a", pattern="one"), lesson("b", pattern="one"),
                 lesson("c", series="two"), lesson("d", series="two"),
                 lesson("e", "completed", pattern="one"),
                 lesson("f", "completed", pattern="one"),
                 lesson("g")])
    result = recent_lesson_activity(rows)
    assert [r["id"] for r in result] == ["a", "c", "e", "f", "g"]
    assert result[0]["text"] == "Serientermine geplant: Testschüler"
    assert result[0]["scheduled_start"] is None
    assert result[2]["scheduled_start"] == rows[4].scheduled_start
    assert result[2]["time"] == rows[4].activity_time


def test_limit_after_grouping():
    rows = Rows([lesson(str(i), pattern="one") for i in range(30)]
                + [lesson(str(i)) for i in range(30, 40)])
    assert [r["id"] for r in recent_lesson_activity(rows)] == ["0", "30", "31", "32", "33"]
