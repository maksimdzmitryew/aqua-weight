import types
from datetime import datetime

import backend.app.helpers.calibration as calib


class _FakeCursor:
    def __init__(self, plants_rows=None, watering_rows_map=None):
        self._plants_rows = plants_rows or []
        # map plant_hex -> list of watering rows (id, measured_at, water_added_g, last_wet_weight_g)
        self._watering_rows_map = watering_rows_map or {}
        self._last_sql = ""
        self._last_params = ()
        self._phase = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self._last_sql = sql
        self._last_params = tuple(params or [])
        if "FROM plants p" in sql:
            self._phase = "plants"
        elif "FROM plants_measurements" in sql:
            self._phase = "watering"

    def fetchall(self):
        if self._phase == "plants":
            return list(self._plants_rows)
        if self._phase == "watering":
            # plant id is the first param always
            plant_hex = self._last_params[0]
            rows = list(self._watering_rows_map.get(plant_hex, []))
            # If there is a since parameter, apply strict greater-than filter
            if len(self._last_params) > 1:
                since_dt = self._last_params[1]
                rows = [r for r in rows if r[1] and r[1] > since_dt]
            return rows
        return []


class _FakeConn:
    def __init__(self, plants_rows=None, watering_rows_map=None):
        self._cursor = _FakeCursor(plants_rows, watering_rows_map)

    def cursor(self):
        return self._cursor


def _mk_meas_row(id_bytes: bytes, dt: datetime, water_added: int, last_wet: int | None):
    return (id_bytes, dt, water_added, last_wet)


def test__parse_db_dt_variants():
    # datetime stays datetime
    now = datetime(2024, 1, 2, 3, 4, 5)
    assert calib._parse_db_dt(now) == now
    # seconds
    assert calib._parse_db_dt("2024-01-02 03:04:05") == now
    # microseconds
    assert calib._parse_db_dt("2024-01-02 03:04:05.000001") == datetime(2024, 1, 2, 3, 4, 5, 1)
    # empty/invalid
    assert calib._parse_db_dt(None) is None
    assert calib._parse_db_dt("bad") is None


def test_calibrate_by_max_water_retained_without_repot_filters_all():
    # Two plants: one invalid (missing configs), one valid
    plant1_id = bytes.fromhex("11" * 16)
    plant2_id = bytes.fromhex("22" * 16)
    plant3_none = None  # to cover pid_bytes is None branch
    plants_rows = [
        # id, min_dry_weight_g, max_water_weight_g
        (plant1_id, None, 20),  # skipped due to missing min_dry
        (plant2_id, 80, 20),
        (plant3_none, 10, 5),  # skipped due to None id
    ]

    m1 = bytes.fromhex("aa" * 16)
    dt1 = datetime(2024, 1, 10, 12, 0, 0)
    rows_map = {
        plant2_id.hex(): [
            _mk_meas_row(m1, dt1, 15, 95),  # under by 5 vs max_water 20 => 25%
        ]
    }

    conn = _FakeConn(plants_rows=plants_rows, watering_rows_map=rows_map)

    # Monkeypatch last repot to None (no filter)
    def _no_repot(conn, plant_hex):
        return None

    orig = calib.get_last_repotting_event
    try:
        calib.get_last_repotting_event = _no_repot  # type: ignore
        result = calib.calibrate_by_max_water_retained(conn)
    finally:
        calib.get_last_repotting_event = orig  # type: ignore

    p2 = plant2_id.hex()
    assert list(result.keys()) == [p2]
    item = result[p2][0]
    assert item["id"] == m1.hex()
    assert item["measured_at"] == dt1.isoformat(sep=" ", timespec="seconds")
    assert item["water_added_g"] == 15
    assert item["last_wet_weight_g"] == 95
    assert item["target_weight_g"] == 100  # 80 + 20
    assert item["under_g"] == 5
    assert item["under_pct"] == 25.0


def test_calibrate_by_max_water_retained_edge_values_none_and_invalid_water_added():
    # Plant with events that produce None branches for under_* and also invalid values
    plant_id = bytes.fromhex("44" * 16)
    plants_rows = [(plant_id, 10, 5)]

    dt = datetime(2024, 2, 2, 2, 2, 2)
    class Weird:
        """Object that raises on first int() and succeeds on second call.

        This lets us exercise the exception branch inside the calculation while still
        allowing serialization to succeed later in the pipeline.
        """

        def __init__(self):
            self._calls = 0

        def __int__(self):
            if self._calls == 0:
                self._calls += 1
                raise ValueError("first int fails")
            self._calls += 1
            return 3

    rows_map = {
        plant_id.hex(): [
            # water_added_g is None -> under_* should be None
            _mk_meas_row(bytes.fromhex("ee" * 16), dt, None, None),
            # weird value: first int() fails inside try, second int() during serialization succeeds
            _mk_meas_row(bytes.fromhex("ef" * 16), dt, Weird(), None),
        ]
    }

    conn = _FakeConn(plants_rows=plants_rows, watering_rows_map=rows_map)

    orig = calib.get_last_repotting_event
    try:
        calib.get_last_repotting_event = lambda c, h: None  # type: ignore
        res = calib.calibrate_by_max_water_retained(conn)
    finally:
        calib.get_last_repotting_event = orig  # type: ignore

    items = res[plant_id.hex()]
    assert items[0]["under_g"] is None and items[0]["under_pct"] is None
    # second item due to Weird() value
    assert items[1]["water_added_g"] == 3
    assert items[1]["under_g"] is None and items[1]["under_pct"] is None


def test_calibrate_by_max_water_retained_skips_empty_items_branch():
    # Plant has no watering rows; ensure branch where items is falsy is covered
    plant_id = bytes.fromhex("55" * 16)
    conn = _FakeConn(plants_rows=[(plant_id, 1, 1)], watering_rows_map={})

    orig = calib.get_last_repotting_event
    try:
        calib.get_last_repotting_event = lambda c, h: None  # type: ignore
        res = calib.calibrate_by_max_water_retained(conn)
    finally:
        calib.get_last_repotting_event = orig  # type: ignore

    # No key added for this plant because there are no items
    assert plant_id.hex() not in res


def test_calibrate_by_minimum_dry_weight_returns_empty_mapping():
    conn = _FakeConn(plants_rows=[], watering_rows_map={})
    assert calib.calibrate_by_minimum_dry_weight(conn) == {}


def test_calibrate_by_max_water_retained_with_repot_filters_since_datetime_str():
    plant_id = bytes.fromhex("33" * 16)
    plants_rows = [(plant_id, 50, 10)]

    before = datetime(2024, 1, 1, 0, 0, 0)
    at = datetime(2024, 1, 5, 0, 0, 0)
    after = datetime(2024, 1, 10, 0, 0, 0)

    rows_map = {
        plant_id.hex(): [
            _mk_meas_row(bytes.fromhex("bb" * 16), before, 7, None),
            _mk_meas_row(bytes.fromhex("cc" * 16), at, 10, 60),
            _mk_meas_row(bytes.fromhex("dd" * 16), after, 8, 58),
        ]
    }

    conn = _FakeConn(plants_rows=plants_rows, watering_rows_map=rows_map)

    # Return object with measured_at as ISO string to exercise _parse_db_dt path
    Rep = types.SimpleNamespace
    rep_obj = Rep(measured_at=at.isoformat(sep=" ", timespec="seconds"))

    orig = calib.get_last_repotting_event
    try:
        calib.get_last_repotting_event = lambda c, h: rep_obj  # type: ignore
        res = calib.calibrate_by_max_water_retained(conn)
    finally:
        calib.get_last_repotting_event = orig  # type: ignore

    items = res[plant_id.hex()]
    # Should include only events strictly after repot (at is excluded)
    assert len(items) == 1
    assert items[0]["id"] == bytes.fromhex("dd" * 16).hex()
    # under = max_water(10) - added
    assert items[0]["under_g"] == 2
    assert items[0]["under_pct"] == 20.0
