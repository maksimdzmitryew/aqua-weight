from __future__ import annotations

from datetime import datetime

from backend.app.helpers.last_repotting import get_last_repotting_event


class FakeCursor:
    def __init__(self, fetchone_results: list[object | None]):
        self._fetchone_results = list(fetchone_results)
        self.executed: list[tuple[str, tuple | None]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query: str, params=None):
        self.executed.append((query, tuple(params) if params is not None else None))
        return 1

    def fetchone(self):
        return self._fetchone_results.pop(0) if self._fetchone_results else None


class FakeConn:
    def __init__(self, cursor: FakeCursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor


def test_get_last_repotting_event_returns_none_when_no_repotting_triple_found() -> None:
    conn = FakeConn(FakeCursor([None]))
    assert get_last_repotting_event(conn, "a" * 32) is None


def test_get_last_repotting_event_returns_none_when_repot_at_is_null() -> None:
    conn = FakeConn(FakeCursor([(None,)]))
    assert get_last_repotting_event(conn, "a" * 32) is None


def test_get_last_repotting_event_returns_none_when_latest_row_missing() -> None:
    repot_at = datetime(2026, 1, 1, 12, 0, 0, 123456)
    conn = FakeConn(FakeCursor([(repot_at,), None]))
    assert get_last_repotting_event(conn, "a" * 32) is None


def test_get_last_repotting_event_maps_row_and_formats_id_and_datetime() -> None:
    repot_at = datetime(2026, 1, 1, 12, 0, 0, 123456)
    row_id = b"\x01" * 16
    row = (
        row_id,
        repot_at,
        100,
        80,
        120,
        20,
        10.5,
        5,
        1.25,
        1,
    )
    conn = FakeConn(FakeCursor([(repot_at,), row]))

    item = get_last_repotting_event(conn, "a" * 32)
    assert item is not None
    assert item.id == row_id.hex()
    assert item.measured_at == "2026-01-01 12:00:00.123456"
    assert item.measured_weight_g == 100
    assert item.last_dry_weight_g == 80
    assert item.last_wet_weight_g == 120
    assert item.water_added_g == 20
    assert item.water_loss_total_pct == 10.5
    assert item.water_loss_total_g == 5
    assert item.water_loss_day_pct == 1.25
    assert item.water_loss_day_g == 1


def test_get_last_repotting_event_allows_non_bytes_id_and_null_measured_at() -> None:
    repot_at = datetime(2026, 1, 1, 12, 0, 0, 123456)
    row = ("a" * 32, None, None, None, None, None, None, None, None, None)
    conn = FakeConn(FakeCursor([(repot_at,), row]))

    item = get_last_repotting_event(conn, "a" * 32)
    assert item is not None
    assert item.id == "a" * 32
    assert item.measured_at is None


def test_get_last_repotting_event_returns_none_and_logs_on_exception(capsys) -> None:
    class ExplodingConn:
        def cursor(self):
            raise RuntimeError("db down")

    assert get_last_repotting_event(ExplodingConn(), "a" * 32) is None
    out = capsys.readouterr().out
    assert "Failed to fetch measurement for plant" in out
