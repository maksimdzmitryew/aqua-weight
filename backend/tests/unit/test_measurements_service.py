import types
import pytest

from backend.app.services.measurements import (
    parse_timestamp_local,
    ts_to_db_string,
    ensure_exclusive_water_vs_weight,
    derive_weights,
    validate_water_loss,
)


def test_parse_timestamp_local_zero_seconds():
    dt = parse_timestamp_local("2025-01-02T03:04")
    assert dt.tzinfo is None
    assert dt.second == 0
    assert dt.microsecond == 0


def test_ts_to_db_string_formats_seconds(monkeypatch):
    # parse local then to string should keep seconds and microseconds
    dt = parse_timestamp_local("2025-01-02T03:04")
    s = ts_to_db_string(dt)
    assert s.endswith(":00.000000")


@pytest.mark.parametrize(
    "mw, wa, expect_error",
    [
        (100, None, False),
        (None, 200, False),
        (None, 0, False),
        (100, 0, False),
        (100, 1, True),
    ],
)
def test_exclusive_water_vs_weight(mw, wa, expect_error):
    if expect_error:
        with pytest.raises(ValueError):
            ensure_exclusive_water_vs_weight(mw, wa)
    else:
        ensure_exclusive_water_vs_weight(mw, wa)


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows
        self._executed = []
        self._ix = -1
        self.connection = (
            object()
        )  # Mock connection for get_last_watering_event_since(cursor.connection, ...)

    def execute(self, sql, params=None):
        self._executed.append((sql, params))

    def fetchone(self):
        return self._rows[0] if self._rows else None


def test_derive_weights_basic(monkeypatch):
    # no previous measurements, no watering event
    cur = _FakeCursor(rows=[])

    # Patch get_last_watering_event to return None
    monkeypatch.setattr(
        "backend.app.helpers.watering.get_last_watering_event",
        lambda cursor, plant_id_hex: None,
    )

    result = derive_weights(
        cursor=cur,
        plant_id_hex="a" * 32,
        measured_at_db="2025-01-01 00:00:00",
        measured_weight_g=1000,
        last_dry_weight_g=None,
        last_wet_weight_g=None,
        payload_water_added_g=None,
    )

    assert result.last_dry_weight_g == 1000
    # last_wet defaults to last_dry + last_watering (0)
    assert result.last_wet_weight_g == 1000
    # for measurement events, water_added mirrors last watering (0)
    assert result.water_added_g == 0


class _FakeValidationCursor:
    """Cursor that returns a sequence of rows from fetchone and records execute args."""

    def __init__(self, rows):
        self._rows = list(rows) if rows else []
        self._index = 0
        self.sql = None
        self.params = None

    def execute(self, sql, params=None):
        self.sql = sql
        self.params = params

    def fetchone(self):
        if self._index < len(self._rows):
            row = self._rows[self._index]
            self._index += 1
            return row
        return None


def test_validate_water_loss_returns_when_current_weight_none():
    # Line 85-87: early return when current_weight is None
    cur = _FakeValidationCursor(rows=[])
    # Should not raise and should not even need a DB row
    validate_water_loss(
        cursor=cur,
        plant_id_hex="a" * 32,
        current_weight=None,
        measured_at="2025-01-01 00:00:00",
    )
    assert cur.sql is None


def test_validate_water_loss_returns_when_no_previous_weight(monkeypatch):
    # Lines 88-112: executes query but previous row is None -> early return
    # First row: capacity info (3 cols), Second row: None for previous weight
    cur = _FakeValidationCursor(rows=[(None, None, None), None])
    validate_water_loss(
        cursor=cur,
        plant_id_hex="a" * 32,
        current_weight=500,
        measured_at="2025-01-01 00:00:00",
    )
    # Query ran, params are [plant_id_hex, measured_at] with no exclude clause
    assert "AND id <> UNHEX(%s)" not in cur.sql
    assert cur.params == ["a" * 32, "2025-01-01 00:00:00"]


def test_validate_water_loss_uses_exclude_measurement_id_branch(monkeypatch):
    # Lines 88-93: exclude_measurement_id branch builds exclusion clause + params
    # First row: capacity info, Second row: None for previous weight
    cur = _FakeValidationCursor(rows=[(None, None, None), None])
    validate_water_loss(
        cursor=cur,
        plant_id_hex="a" * 32,
        current_weight=500,
        measured_at="2025-01-01 00:00:00",
        exclude_measurement_id="b" * 32,
    )
    assert "AND id <> UNHEX(%s)" in cur.sql
    assert cur.params == ["a" * 32, "b" * 32, "2025-01-01 00:00:00"]


def test_validate_water_loss_returns_when_change_within_threshold():
    # Lines 108-120 (no raise branch): prev_weight present and diff <= threshold
    # current=500, prev=300 -> diff=200 <= threshold=500
    # First row: capacity info (no capacity limits), Second row: prev_weight=300
    cur = _FakeValidationCursor(rows=[(None, None, None), (300,)])
    validate_water_loss(
        cursor=cur,
        plant_id_hex="a" * 32,
        current_weight=500,
        measured_at="2025-01-01 00:00:00",
    )
    assert cur.params == ["a" * 32, "2025-01-01 00:00:00"]


def test_validate_water_loss_raises_when_change_exceeds_threshold():
    # Lines 114-120: diff > threshold triggers ValueError
    # current=500, prev=2000 -> diff=1500 > threshold=500
    # First row: capacity info (no capacity limits), Second row: prev_weight=2000
    cur = _FakeValidationCursor(rows=[(None, None, None), (2000,)])
    with pytest.raises(ValueError) as exc:
        validate_water_loss(
            cursor=cur,
            plant_id_hex="a" * 32,
            current_weight=500,
            measured_at="2025-01-01 00:00:00",
        )
    assert "change of 1500g exceeds current weight 500g" in str(exc.value)


def test_validate_water_loss_raises_when_exceeds_saturation_capacity():
    # Lines 110-119: current_weight > min_dry_weight_g + max_water_weight_g
    # First row: capacity info with min_dry=100, max_water=500, last_dry=None
    # current_weight=700 > 100 + 500 = 600 (saturated_min)
    cur = _FakeValidationCursor(rows=[(100, 500, None)])
    with pytest.raises(ValueError) as exc:
        validate_water_loss(
            cursor=cur,
            plant_id_hex="a" * 32,
            current_weight=700,
            measured_at="2025-01-01 00:00:00",
        )
    assert "exceeds the plant's saturated capacity" in str(exc.value)
    assert "600g = min dry 100g + max water 500g" in str(exc.value)


def test_validate_water_loss_raises_when_exceeds_last_dry_plus_max_water():
    # Lines 120-128: current_weight > last_dry_weight_g + max_water_weight_g
    # First row: capacity info with min_dry=None, max_water=500, last_dry=200
    # current_weight=800 > 200 + 500 = 700 (saturated_last)
    cur = _FakeValidationCursor(rows=[(None, 500, 200)])
    with pytest.raises(ValueError) as exc:
        validate_water_loss(
            cursor=cur,
            plant_id_hex="a" * 32,
            current_weight=800,
            measured_at="2025-01-01 00:00:00",
        )
    assert "exceeds the last dry weight plus max water" in str(exc.value)
    assert "700g" in str(exc.value)
