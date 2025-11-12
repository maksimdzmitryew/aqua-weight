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



def test_day_pct_uses_last_wet_weight_when_no_water_added(fake_cursor, monkeypatch):
    # No prior watering event in params and zero added => pct falls back to last_wet_weight_g (lines 77–80)
    monkeypatch.setattr(
        'backend.app.helpers.water_loss.get_last_watering_event',
        lambda cursor, plant_id_hex: None,
    )
    res = calculate_water_loss(
        cursor=fake_cursor,
        plant_id_hex='abc',
        measured_at='2025-01-03T00:00:00Z',
        measured_weight_g=950,
        last_wet_weight_g=1000,
        water_added_g=None,
        last_watering_water_added=0,
        prev_measured_weight=980,  # baseline=prev (980), daydiff=30
    )
    assert res.water_loss_day_g == 30
    # pct based on last_wet_weight_g (1000) because last_watering_water_added == 0
    assert res.water_loss_day_pct == pytest.approx((30/1000)*100, rel=1e-3)


def test_exception_in_daily_calc_is_swallowed(fake_cursor, monkeypatch):
    # Force TypeError in daydiff calculation (lines 81–82)
    monkeypatch.setattr(
        'backend.app.helpers.water_loss.get_last_watering_event',
        lambda cursor, plant_id_hex: None,
    )
    res = calculate_water_loss(
        cursor=fake_cursor,
        plant_id_hex='abc',
        measured_at='2025-01-03T00:00:00Z',
        measured_weight_g='bad',  # non-numeric causes subtraction error
        last_wet_weight_g=1000,
        water_added_g=None,
        last_watering_water_added=0,
        prev_measured_weight=980,
    )
    # Daily fields remain None due to exception being swallowed
    assert res.water_loss_day_g is None
    assert res.water_loss_day_pct is None


def test_day_pct_set_inside_totals_block_when_not_set_earlier(fake_cursor, monkeypatch):
    # earlier day pct not set (param last_watering_water_added is 0 and last_wet_weight_g is None),
    # but totals block knows 600 from last event and should set day pct (lines 134–139)
    fake_cursor.summed = 40  # accumulated since watering
    last_event = {
        'water_added_g': 600,
        'measured_at': '2025-01-01T00:00:00Z',
    }
    monkeypatch.setattr(
        'backend.app.helpers.water_loss.get_last_watering_event',
        lambda cursor, plant_id_hex: last_event,
    )
    res = calculate_water_loss(
        cursor=fake_cursor,
        plant_id_hex='abc',
        measured_at='2025-01-02T12:00:00Z',
        measured_weight_g=940,
        last_wet_weight_g=None,   # prevents early day pct fallback
        water_added_g=None,
        last_watering_water_added=0,  # prevents early day pct by first branch
        prev_measured_weight=950,     # baseline=950 => daydiff=10
    )
    # totals: summed 40 + day 10 = 50; pct based on last event 600
    assert res.water_loss_total_g == 50
    assert res.water_loss_total_pct == pytest.approx((50/600)*100, rel=1e-3)
    # and day pct should be set inside totals block using last_watering_water_added from event
    assert res.water_loss_day_pct == 1.67


def test_totals_block_exception_keeps_totals_none(fake_cursor, monkeypatch):
    # Make the totals try block raise (lines 144–146)
    def boom(cursor, plant_id_hex):
        raise RuntimeError('DB down')
    monkeypatch.setattr(
        'backend.app.helpers.water_loss.get_last_watering_event',
        boom,
    )
    res = calculate_water_loss(
        cursor=fake_cursor,
        plant_id_hex='abc',
        measured_at='2025-01-04T00:00:00Z',
        measured_weight_g=900,
        last_wet_weight_g=950,
        water_added_g=None,
        last_watering_water_added=0,
        prev_measured_weight=920,
    )
    # Totals remain None on exception
    assert res.water_loss_total_g is None
    assert res.water_loss_total_pct is None


def test_day_pct_inner_try_except_branch_hit(fake_cursor, monkeypatch):
    # Cover lines 127–148 and trigger inner try/except (138–139) by making float(daydiff) raise
    class FakeNumber:
        def __int__(self):
            return 3  # used when computing total_g
        def __float__(self):
            raise ValueError('cannot float me')

    last_event = {
        'water_added_g': 300,  # > 0 to enter totals pct branch
        'measured_at': '2025-01-01T00:00:00Z',
    }
    monkeypatch.setattr(
        'backend.app.helpers.water_loss.get_last_watering_event',
        lambda cursor, plant_id_hex: last_event,
    )

    # Monkeypatch builtins.max to return our FakeNumber for the daydiff calc
    import builtins as _builtins
    orig_max = _builtins.max
    def max_hook(*args, **kwargs):
        # When called from water_loss daily diff with two ints, return FakeNumber
        if len(args) == 2 and isinstance(args[0], int) and isinstance(args[1], int):
            return FakeNumber()
        return orig_max(*args, **kwargs)
    monkeypatch.setattr(_builtins, 'max', max_hook)

    fake_cursor.summed = 7  # accumulated since watering
    res = calculate_water_loss(
        cursor=fake_cursor,
        plant_id_hex='abc',
        measured_at='2025-01-02T00:00:00Z',
        measured_weight_g=197,     # baseline 200 → daydiff becomes FakeNumber
        last_wet_weight_g=200,
        water_added_g=None,
        last_watering_water_added=0,  # initial param not used for pct
        prev_measured_weight=200,
    )

    # total_g = 7 + int(FakeNumber)=3 => 10; totals pct uses last_event water_added_g 300
    assert res.water_loss_total_g == 10
    assert res.water_loss_total_pct == 3.33
    # inner try fails to compute day pct due to float(FakeNumber) raising; except swallows → still None
    assert res.water_loss_day_pct is None
