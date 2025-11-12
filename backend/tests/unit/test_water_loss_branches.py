from datetime import datetime

import pytest

from backend.app.helpers.water_loss import calculate_water_loss, WaterLossCalculation


class DummyCursor:
    def __init__(self, sum_value=0):
        self.sql = None
        self.params = None
        self._sum_value = sum_value
        self._executed = False

    def execute(self, sql, params=None):
        self.sql = sql
        self.params = params
        self._executed = True

    def fetchone(self):
        # For the SUM query path, return a single-value tuple
        return (self._sum_value,)


def test_branch_67_to_85_skips_day_calc_when_no_baseline(monkeypatch):
    # measured_weight_g is provided, but both prev_measured_weight and last_wet are None
    # This makes baseline_for_day None, so the condition at line 67 is False, jumping to line 85.
    cur = DummyCursor()

    # Ensure last_watering_event is None so the totals section takes the 'no prior watering' path
    monkeypatch.setattr(
        "backend.app.helpers.water_loss.get_last_watering_event", lambda cursor, plant_id_hex: None
    )

    res = calculate_water_loss(
        cursor=cur,
        plant_id_hex="deadbeef" * 4,
        measured_at="2025-01-01 00:00:00",
        measured_weight_g=100,
        last_wet_weight_g=None,
        water_added_g=None,
        last_watering_water_added=0,
        prev_measured_weight=None,
        exclude_measurement_id=None,
    )

    assert isinstance(res, WaterLossCalculation)
    # No baseline, so day loss fields remain None
    assert res.water_loss_day_g is None
    assert res.water_loss_day_pct is None or res.water_loss_day_pct == 0
    # No prior watering event, totals are None
    assert res.water_loss_total_g is None
    assert res.water_loss_total_pct is None


def test_branch_127_to_148_total_pct_skipped_when_last_watering_added_zero(monkeypatch):
    # Setup so that:
    # - There IS a last watering event, but water_added_g == 0 -> condition at line 127 is False
    # - Day diff is computable (baseline set), so total_g can be computed
    cur = DummyCursor(sum_value=5)

    last_event = {
        "water_added_g": 0,  # triggers skipping total_pct computation
        "measured_at": "2024-12-31 00:00:00",
    }

    monkeypatch.setattr(
        "backend.app.helpers.water_loss.get_last_watering_event", lambda cursor, plant_id_hex: last_event
    )

    res = calculate_water_loss(
        cursor=cur,
        plant_id_hex="cafebabe" * 4,
        measured_at="2025-01-01 00:00:00",
        measured_weight_g=100,
        last_wet_weight_g=150,
        water_added_g=None,
        last_watering_water_added=0,  # passthrough; function will recalc from get_last_watering_event
        prev_measured_weight=120,     # baseline so day diff = 20
        exclude_measurement_id="a" * 32,
    )

    # Day loss computed (baseline 120 vs measured 100 => 20)
    assert res.water_loss_day_g == 20
    # Total_g should be sum_value (5) + day_g (20) = 25
    assert res.water_loss_total_g == 25
    # Because last_watering_event.water_added_g == 0, total pct branch is skipped
    assert res.water_loss_total_pct is None
