import types
import pytest
from datetime import datetime

from backend.app.helpers.water_loss import calculate_water_loss


class FakeCursor:
    def __init__(self, summed=0):
        self.summed = summed
        self.queries = []

    def execute(self, query, params=None):
        # Record last query for debugging
        self.queries.append((query, params))

    def fetchone(self):
        # Only used for SUM query; return a single-value tuple
        return (self.summed,)


@pytest.fixture
def fake_cursor():
    return FakeCursor()


def test_calculate_water_loss_watering_event_returns_zero_pct(fake_cursor, monkeypatch):
    # measured_weight_g None => watering event
    monkeypatch.setattr(
        'backend.app.helpers.water_loss.get_last_watering_event',
        lambda cursor, plant_id_hex: None,
    )
    res = calculate_water_loss(
        cursor=fake_cursor,
        plant_id_hex='abc',
        measured_at='2025-01-01T00:00:00Z',
        measured_weight_g=None,
        last_wet_weight_g=500,
        water_added_g=1000,
        last_watering_water_added=1000,
        prev_measured_weight=480,
    )
    assert res.is_watering_event is True
    assert res.water_loss_total_pct == 0
    assert res.water_loss_day_g is None


def test_calculate_water_loss_day_and_total_pct_with_prev_and_last_event(fake_cursor, monkeypatch):
    # Last watering added 800g, previous summed since watering is 100, current daydiff 20 => total 120
    fake_cursor.summed = 100

    last_event = {
        'water_added_g': 800,
        'measured_at': '2024-12-31T00:00:00Z',
    }
    monkeypatch.setattr(
        'backend.app.helpers.water_loss.get_last_watering_event',
        lambda cursor, plant_id_hex: last_event,
    )

    res = calculate_water_loss(
        cursor=fake_cursor,
        plant_id_hex='abc',
        measured_at='2025-01-01T10:00:00Z',
        measured_weight_g=480,
        last_wet_weight_g=500,
        water_added_g=None,
        last_watering_water_added=800,
        prev_measured_weight=500,
    )

    # baseline is prev_measured_weight (500) so daydiff = 20
    assert res.water_loss_day_g == 20
    assert res.water_loss_day_pct == pytest.approx((20/800)*100, rel=1e-3)
    # total = summed(100) + day(20) = 120; pct uses last_watering_water_added
    assert res.water_loss_total_g == 120
    assert res.water_loss_total_pct == pytest.approx((120/800)*100, rel=1e-3)


def test_calculate_water_loss_uses_last_wet_when_prev_missing(fake_cursor, monkeypatch):
    fake_cursor.summed = 0
    last_event = {
        'water_added_g': 1000,
        'measured_at': '2024-12-31T00:00:00Z',
    }
    monkeypatch.setattr(
        'backend.app.helpers.water_loss.get_last_watering_event',
        lambda cursor, plant_id_hex: last_event,
    )

    res = calculate_water_loss(
        cursor=fake_cursor,
        plant_id_hex='abc',
        measured_at='2025-01-02T00:00:00Z',
        measured_weight_g=900,
        last_wet_weight_g=950,
        water_added_g=None,
        last_watering_water_added=1000,
        prev_measured_weight=None,
    )

    # baseline is last_wet_weight_g (950) => daydiff 50
    assert res.water_loss_day_g == 50
    assert res.water_loss_day_pct == pytest.approx(5.0)
    assert res.water_loss_total_g == 50
    assert res.water_loss_total_pct == pytest.approx(5.0)


def test_calculate_water_loss_no_prior_watering_keeps_totals_none(fake_cursor, monkeypatch):
    monkeypatch.setattr(
        'backend.app.helpers.water_loss.get_last_watering_event',
        lambda cursor, plant_id_hex: None,
    )

    res = calculate_water_loss(
        cursor=fake_cursor,
        plant_id_hex='abc',
        measured_at='2025-01-01T00:00:00Z',
        measured_weight_g=900,
        last_wet_weight_g=950,
        water_added_g=None,
        last_watering_water_added=0,
        prev_measured_weight=920,
    )

    assert res.is_watering_event is False
    assert res.water_loss_day_g == 20  # baseline 920 - 900
    assert res.water_loss_total_g is None
    assert res.water_loss_total_pct is None


def test_calculate_water_loss_exclude_measurement_id_param(fake_cursor, monkeypatch):
    fake_cursor.summed = 10
    last_event = {
        'water_added_g': 200,
        'measured_at': '2024-12-31T00:00:00Z',
    }
    monkeypatch.setattr(
        'backend.app.helpers.water_loss.get_last_watering_event',
        lambda cursor, plant_id_hex: last_event,
    )

    res = calculate_water_loss(
        cursor=fake_cursor,
        plant_id_hex='abc',
        measured_at='2025-01-01T00:00:00Z',
        measured_weight_g=195,
        last_wet_weight_g=200,
        water_added_g=None,
        last_watering_water_added=200,
        prev_measured_weight=200,
        exclude_measurement_id='DEADBEEF',
    )

    # Ensure SUM result is included and percentages computed
    assert res.water_loss_day_g == 5
    assert res.water_loss_total_g == 15
    assert res.water_loss_total_pct == pytest.approx((15/200)*100, rel=1e-3)
