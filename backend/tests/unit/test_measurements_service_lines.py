import types
from datetime import datetime

import pytest

from backend.app.services import measurements as svc
from backend.app.services.measurements import DerivedWeights


class DummyCursor:
    def __init__(self, row=None):
        self._row = row
        self.sql = None
        self.params = None

    def execute(self, sql, params=None):
        self.sql = sql
        self.params = params

    def fetchone(self):
        return self._row


def test_parse_timestamp_utc_calls_normalize_with_zeros(monkeypatch):
    # Arrange: patch normalize_measured_at in the measurements module directly
    calls = {}

    def fake_normalize(raw, *, fill_with, fixed_milliseconds=None):
        # record args and return a recognizable value
        calls["raw"] = raw
        calls["fill_with"] = fill_with
        calls["fixed_milliseconds"] = fixed_milliseconds
        # return a datetime so downstream formatters wouldn't choke if used
        return datetime(2025, 1, 1, 12, 34, 0)

    monkeypatch.setattr(svc, "normalize_measured_at", fake_normalize)

    # Act
    fixed_ms = 123
    dt = svc.parse_timestamp_utc("2025-01-01T12:34:56.789Z", fixed_milliseconds=fixed_ms)

    # Assert: line 24 delegates to normalize_measured_at with zeros and our fixed ms
    assert calls == {
        "raw": "2025-01-01T12:34:56.789Z",
        "fill_with": "zeros",
        "fixed_milliseconds": fixed_ms,
    }
    assert isinstance(dt, datetime)


def test_derive_weights_exclude_measurement_id_branch(monkeypatch):
    # Arrange: provide previous row and patch last watering lookup
    cursor = DummyCursor(row=(100, 90, 110))
    monkeypatch.setattr(
        svc,
        "get_last_watering_event",
        lambda cursor, plant_id_hex: {"water_added_g": 50},
    )

    # Act
    _ = svc.derive_weights(
        cursor=cursor,
        plant_id_hex="a" * 32,
        measured_at_db="2024-03-10 09:00:00",
        measured_weight_g=200,
        last_dry_weight_g=None,
        last_wet_weight_g=None,
        payload_water_added_g=None,
        exclude_measurement_id="b" * 32,
    )

    # Assert: SQL contains the exclusion clause and params order matches the branch
    assert "AND id <> UNHEX(%s)" in cursor.sql
    assert cursor.params == ["a" * 32, "b" * 32, "2024-03-10 09:00:00"]


def test_compute_water_losses_wraps_and_passes_args(monkeypatch):
    # Arrange
    captured = {}

    def fake_calc(**kwargs):
        captured.update(kwargs)
        return "sentinel"

    # Patch function in helpers module; local import in compute_water_losses should pick it up
    import backend.app.helpers.water_loss as wl

    monkeypatch.setattr(wl, "calculate_water_loss", fake_calc)

    derived = DerivedWeights(
        last_dry_weight_g=90,
        last_wet_weight_g=110,
        water_added_g=20,
        prev_measured_weight=95,
        last_watering_water_added=30,
    )

    cursor = DummyCursor()

    # Act
    result = svc.compute_water_losses(
        cursor=cursor,
        plant_id_hex="deadbeef" * 4,
        measured_at_db="2024-06-01 10:00:00",
        measured_weight_g=150,
        derived=derived,
        exclude_measurement_id="c" * 32,
    )

    # Assert
    assert result == "sentinel"
    assert captured["cursor"] is cursor
    assert captured["plant_id_hex"] == "deadbeef" * 4
    assert captured["measured_at"] == "2024-06-01 10:00:00"
    assert captured["measured_weight_g"] == 150
    assert captured["last_wet_weight_g"] == 110
    # compute_water_losses always forwards None for water_added_g
    assert captured["water_added_g"] is None
    assert captured["last_watering_water_added"] == 30
    assert captured["prev_measured_weight"] == 95
    assert captured["exclude_measurement_id"] == "c" * 32



def test_branch_155_to_161_skip_recompute_lw_when_present(monkeypatch):
    # Watering flow: measured_weight_g is None
    # Force branch 145 to be False by providing last_wet_weight_g == 0 (non-None but not > 0)
    # Provide payload_water_added_g > 0 and ld_local > 0 so the inner branch executes
    # Expect: wa_local equals payload, and lw_local is NOT recomputed because last_wet_weight_g is not None
    from backend.app.services import measurements as svc

    # Patch last watering event (value is not used in this branch but keep consistent)
    monkeypatch.setattr(
        svc,
        "get_last_watering_event",
        lambda cursor, plant_id_hex: {"water_added_g": 42},
    )

    # Dummy cursor with no previous row
    class _Cur:
        def execute(self, sql, params=None):
            pass
        def fetchone(self):
            return None

    cur = _Cur()

    derived = svc.derive_weights(
        cursor=cur,
        plant_id_hex="0" * 32,
        measured_at_db="2025-01-01 00:00:00",
        measured_weight_g=None,            # watering flow
        last_dry_weight_g=100,             # ld_local > 0
        last_wet_weight_g=0,               # non-None but not > 0 to skip line 145 branch
        payload_water_added_g=30,          # positive payload triggers inner assignment
        exclude_measurement_id=None,
    )

    # lw_local should remain the provided 0 (no recompute at 156 because 155 condition is False)
    assert derived.last_wet_weight_g == 0
    # water_added should come from payload
    assert derived.water_added_g == 30
    # last dry preserved
    assert derived.last_dry_weight_g == 100
