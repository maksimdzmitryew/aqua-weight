import types
import pytest

from backend.app.services.measurements import (
    parse_timestamp_local,
    ts_to_db_string,
    ensure_exclusive_water_vs_weight,
    derive_weights,
)


def test_parse_timestamp_local_zero_seconds():
    dt = parse_timestamp_local("2025-01-02T03:04")
    assert dt.tzinfo is None
    assert dt.second == 0
    assert dt.microsecond == 0


def test_ts_to_db_string_formats_seconds(monkeypatch):
    # parse local then to string should keep seconds
    dt = parse_timestamp_local("2025-01-02T03:04")
    s = ts_to_db_string(dt)
    assert s.endswith(":00")


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
