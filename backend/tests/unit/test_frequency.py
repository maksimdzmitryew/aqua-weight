from datetime import datetime, timedelta

import backend.app.helpers.frequency as freq


class _FakeCursor:
    def __init__(self, events_map):
        self._events_map = events_map
        self._since = None
        self._plant_hex = None
        self._phase = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self._phase = "meas"
        if params:
            self._plant_hex = params[0]
            if len(params) > 1:
                self._since = params[1]

    def fetchall(self):
        events = list(self._events_map.get(self._plant_hex, []))
        if self._since is not None:
            events = [e for e in events if e >= self._since]
        return [(e,) for e in events]


class _FakeConn:
    def __init__(self, events_map):
        self._cursor = _FakeCursor(events_map)

    def cursor(self):
        return self._cursor


def test_compute_frequency_days_not_enough():
    plant_hex = "aa" * 16
    conn = _FakeConn({plant_hex: [datetime(2024, 1, 1, 0, 0, 0)]})
    # No repot event
    orig = freq.get_last_repotting_event
    try:
        freq.get_last_repotting_event = lambda c, h: None  # type: ignore
        assert freq.compute_frequency_days(conn, plant_hex) is None
    finally:
        freq.get_last_repotting_event = orig  # type: ignore


def test_compute_frequency_days_bad_iso_repot_parsing_falls_back():
    plant_hex = "dd" * 16
    base = datetime(2024, 3, 1, 0, 0, 0)
    events = [base + timedelta(days=2), base + timedelta(days=4)]
    conn = _FakeConn({plant_hex: events})

    class Rep:
        def __init__(self, measured_at):
            self.measured_at = measured_at

    rep = Rep("not-a-valid-iso")

    orig = freq.get_last_repotting_event
    try:
        freq.get_last_repotting_event = lambda c, h: rep  # type: ignore
        # Parsing fails → since_dt None → both events counted → interval 2 days -> result 2
        assert freq.compute_frequency_days(conn, plant_hex) == 2
    finally:
        freq.get_last_repotting_event = orig  # type: ignore


def test_compute_frequency_days_median_rounded_and_filter_since():
    plant_hex = "bb" * 16
    base = datetime(2024, 1, 1, 0, 0, 0)
    # Events at 2, 3, and 7 days after base; one before base to test filter
    events = [
        base - timedelta(days=1),
        base + timedelta(days=2),
        base + timedelta(days=5),  # interval 3 days
        base + timedelta(days=12),  # interval 7 days
    ]
    conn = _FakeConn({plant_hex: events})

    class Rep:
        def __init__(self, measured_at):
            self.measured_at = measured_at

    # Provide ISO string to exercise fromisoformat path
    rep = Rep((base).isoformat(sep=" ", timespec="seconds"))

    orig = freq.get_last_repotting_event
    try:
        freq.get_last_repotting_event = lambda c, h: rep  # type: ignore
        # Intervals: [3, 7] -> median = 5 -> rounded 5
        assert freq.compute_frequency_days(conn, plant_hex) == 5
    finally:
        freq.get_last_repotting_event = orig  # type: ignore


def test_compute_frequency_days_ignores_negative_interval():
    plant_hex = "cc" * 16
    t0 = datetime(2024, 1, 1)
    # Out-of-order/duplicate timestamps could yield zero/negative; ensure non-negative check
    events = [t0, t0, t0 - timedelta(days=1), t0 + timedelta(days=1)]
    conn = _FakeConn({plant_hex: events})
    orig = freq.get_last_repotting_event
    try:
        freq.get_last_repotting_event = lambda c, h: None  # type: ignore
        # DB orders ascending, so effective sequence is [t0-1, t0, t0, t0+1]
        # Intervals: [1, 0, 1] -> median = 1 -> result 1 day
        assert freq.compute_frequency_days(conn, plant_hex) == 1
    finally:
        freq.get_last_repotting_event = orig  # type: ignore


def test_compute_frequency_days_empty_intervals_branch_via_descending_events():
    plant_hex = "ee" * 16
    t0 = datetime(2024, 4, 1)
    # We'll monkeypatch the internal fetch helper to return strictly descending times
    events_desc = [t0 + timedelta(days=2), t0 + timedelta(days=1), t0]

    orig_fetch = freq._fetch_watering_events_since
    orig_repot = freq.get_last_repotting_event
    try:
        freq.get_last_repotting_event = lambda c, h: None  # type: ignore
        freq._fetch_watering_events_since = lambda c, h, s: list(events_desc)  # type: ignore
        # All consecutive deltas negative -> intervals_days remains empty -> return None (line 87)
        assert freq.compute_frequency_days(_FakeConn({}), plant_hex) is None
    finally:
        freq._fetch_watering_events_since = orig_fetch  # type: ignore
        freq.get_last_repotting_event = orig_repot  # type: ignore
