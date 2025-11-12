from datetime import datetime, timezone

import types

from backend.app.helpers.watering import get_last_watering_event


class _FakeCursor:
    def __init__(self, row):
        self._row = row
        self.executed = None
        self.params = None

    def execute(self, query, params):
        # store for inspection if needed
        self.executed = query
        self.params = params

    def fetchone(self):
        return self._row


def _b(n: int) -> bytes:
    # Produce deterministic 16-byte values
    return bytes([n] * 16)


def test_get_last_watering_event_returns_none_when_no_row():
    cursor = _FakeCursor(row=None)
    res = get_last_watering_event(cursor, "a" * 32)
    assert res is None


def test_get_last_watering_event_maps_row_correctly():
    # Prepare timestamps
    measured_at = datetime(2025, 1, 2, 3, 4, 5)  # naive -> treated as UTC, adds Z
    created_at = datetime(2025, 1, 2, 3, 4, 5, tzinfo=timezone.utc)  # already UTC
    updated_at = None  # ensure branch that keeps None

    row = (
        _b(1),  # id (bytes)
        _b(2),  # plant_id (bytes)
        measured_at,  # measured_at
        None,  # measured_weight_g
        900,  # last_dry_weight_g
        1000,  # last_wet_weight_g
        123,  # water_added_g
        0,  # water_loss_total_pct (numeric)
        None,  # water_loss_total_g
        None,  # water_loss_day_pct
        None,  # water_loss_day_g
        _b(3),  # method_id (bytes)
        1,  # use_last_method (truthy)
        _b(4),  # scale_id (bytes)
        "note here",  # note
        created_at,  # created_at
        updated_at,  # updated_at
    )

    cursor = _FakeCursor(row=row)

    res = get_last_watering_event(cursor, "b" * 32)

    # Hex conversions
    assert res["id"] == _b(1).hex()
    assert res["plant_id"] == _b(2).hex()
    assert res["method_id"] == _b(3).hex()
    assert res["scale_id"] == _b(4).hex()

    # Date conversions to UTC ISO with trailing 'Z'
    assert res["measured_at"] == "2025-01-02T03:04:05Z"
    assert res["created_at"] == "2025-01-02T03:04:05Z"
    assert res["updated_at"] is None

    # Numeric fields and booleans
    assert res["measured_weight_g"] is None
    assert res["last_dry_weight_g"] == 900
    assert res["last_wet_weight_g"] == 1000
    assert res["water_added_g"] == 123
    assert res["water_loss_total_pct"] == 0.0
    assert res["water_loss_total_g"] is None
    assert res["water_loss_day_pct"] is None
    assert res["water_loss_day_g"] is None
    assert res["use_last_method"] is True
    assert res["note"] == "note here"
