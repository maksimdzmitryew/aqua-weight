from __future__ import annotations

import pytest

import backend.app.helpers.water_loss as wl


class FakeCursor:
    def __init__(self, *, fetchone_results: list[object | None] | None = None, explode_on_execute: bool = False):
        self._fetchone_results = list(fetchone_results or [])
        self._explode_on_execute = explode_on_execute
        self.executed: list[tuple[str, tuple | None]] = []

    def execute(self, query: str, params=None):
        if self._explode_on_execute:
            raise RuntimeError("execute failed")
        self.executed.append((query, tuple(params) if params is not None else None))
        return 1

    def fetchone(self):
        if not self._fetchone_results:
            return None
        return self._fetchone_results.pop(0)


def test_calculate_water_loss_watering_event_returns_early_and_sets_total_pct_zero() -> None:
    cur = FakeCursor()
    out = wl.calculate_water_loss(
        cur,
        plant_id_hex="a" * 32,
        measured_at="2026-01-02 10:00:00",
        measured_weight_g=None,
        last_wet_weight_g=100,
        water_added_g=None,
        last_watering_water_added=0,
        prev_measured_weight=110,
    )
    assert out.is_watering_event is True
    assert out.water_loss_total_pct == 0
    assert out.water_loss_day_g is None
    assert out.water_loss_total_g is None


def test_calculate_water_loss_day_pct_uses_last_watering_water_added_when_positive() -> None:
    cur = FakeCursor()
    out = wl.calculate_water_loss(
        cur,
        plant_id_hex="a" * 32,
        measured_at="2026-01-02 10:00:00",
        measured_weight_g=90,
        last_wet_weight_g=120,
        water_added_g=None,
        last_watering_water_added=20,
        prev_measured_weight=100,
    )
    assert out.is_watering_event is False
    assert out.water_loss_day_g == 10
    assert out.water_loss_day_pct == 50.0


def test_calculate_water_loss_day_pct_falls_back_to_last_wet_weight_when_no_water_added() -> None:
    cur = FakeCursor()
    out = wl.calculate_water_loss(
        cur,
        plant_id_hex="a" * 32,
        measured_at="2026-01-02 10:00:00",
        measured_weight_g=150,
        last_wet_weight_g=200,
        water_added_g=None,
        last_watering_water_added=0,
        prev_measured_weight=None,
    )
    assert out.water_loss_day_g == 50
    assert out.water_loss_day_pct == 25.0


def test_calculate_water_loss_ignores_day_pct_errors() -> None:
    cur = FakeCursor()
    out = wl.calculate_water_loss(
        cur,
        plant_id_hex="a" * 32,
        measured_at="2026-01-02 10:00:00",
        measured_weight_g="bad",  # triggers exception in daydiff calc
        last_wet_weight_g=200,
        water_added_g=None,
        last_watering_water_added=10,
        prev_measured_weight=300,
    )
    assert out.is_watering_event is False
    assert out.water_loss_day_g is None
    assert out.water_loss_day_pct is None


def test_calculate_water_loss_totals_include_sum_and_set_day_pct_if_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        wl,
        "get_last_watering_event",
        lambda _cursor, _plant_id_hex: {"measured_at": "2026-01-01 00:00:00", "water_added_g": 40},
    )
    cur = FakeCursor(fetchone_results=[(7,)])

    out = wl.calculate_water_loss(
        cur,
        plant_id_hex="a" * 32,
        measured_at="2026-01-02 10:00:00",
        measured_weight_g=90,
        last_wet_weight_g=0,
        water_added_g=None,
        last_watering_water_added=0,
        prev_measured_weight=100,
        exclude_measurement_id="f" * 32,
    )

    assert out.water_loss_day_g == 10
    assert out.water_loss_total_g == 17
    assert out.water_loss_total_pct == 42.5
    assert out.water_loss_day_pct == 25.0

    (q, params) = cur.executed[-1]
    assert "id <> UNHEX(%s)" in q
    assert params is not None
    assert params[0] == "a" * 32
    assert params[1] == "f" * 32


def test_calculate_water_loss_keeps_totals_none_when_no_prior_watering_event(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(wl, "get_last_watering_event", lambda _cursor, _plant_id_hex: None)
    cur = FakeCursor()
    out = wl.calculate_water_loss(
        cur,
        plant_id_hex="a" * 32,
        measured_at="2026-01-02 10:00:00",
        measured_weight_g=90,
        last_wet_weight_g=120,
        water_added_g=None,
        last_watering_water_added=10,
        prev_measured_weight=100,
    )
    assert out.water_loss_total_g is None
    assert out.water_loss_total_pct is None


def test_calculate_water_loss_keeps_totals_none_on_execute_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        wl,
        "get_last_watering_event",
        lambda _cursor, _plant_id_hex: {"measured_at": "2026-01-01 00:00:00", "water_added_g": 40},
    )
    cur = FakeCursor(fetchone_results=[(7,)], explode_on_execute=True)
    out = wl.calculate_water_loss(
        cur,
        plant_id_hex="a" * 32,
        measured_at="2026-01-02 10:00:00",
        measured_weight_g=90,
        last_wet_weight_g=120,
        water_added_g=None,
        last_watering_water_added=0,
        prev_measured_weight=100,
    )
    assert out.water_loss_day_g == 10
    assert out.water_loss_total_g is None
    assert out.water_loss_total_pct is None


def test_calculate_water_loss_skips_daily_calc_when_no_baseline_and_handles_zero_water_added(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        wl,
        "get_last_watering_event",
        lambda _cursor, _plant_id_hex: {"measured_at": "2026-01-01 00:00:00", "water_added_g": 0},
    )
    cur = FakeCursor(fetchone_results=[(0,)])

    out = wl.calculate_water_loss(
        cur,
        plant_id_hex="a" * 32,
        measured_at="2026-01-02 10:00:00",
        measured_weight_g=90,
        last_wet_weight_g=None,
        water_added_g=None,
        last_watering_water_added=0,
        prev_measured_weight=None,
    )

    assert out.water_loss_day_g is None
    assert out.water_loss_total_g == 0
    assert out.water_loss_total_pct is None


def test_calculate_water_loss_does_not_override_existing_day_pct(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        wl,
        "get_last_watering_event",
        lambda _cursor, _plant_id_hex: {"measured_at": "2026-01-01 00:00:00", "water_added_g": 20},
    )
    cur = FakeCursor(fetchone_results=[(0,)])

    out = wl.calculate_water_loss(
        cur,
        plant_id_hex="a" * 32,
        measured_at="2026-01-02 10:00:00",
        measured_weight_g=90,
        last_wet_weight_g=0,
        water_added_g=None,
        last_watering_water_added=20,
        prev_measured_weight=100,
    )

    assert out.water_loss_day_g == 10
    assert out.water_loss_day_pct == 50.0
    assert out.water_loss_total_pct == 50.0


def test_calculate_water_loss_fallback_day_pct_logs_exception_and_continues(monkeypatch: pytest.MonkeyPatch) -> None:
    class FlakyFloat:
        def __init__(self):
            self._calls = 0

        def __gt__(self, other):
            return True

        def __float__(self):
            self._calls += 1
            if self._calls == 1:
                return 40.0
            raise ValueError("boom")

    monkeypatch.setattr(
        wl,
        "get_last_watering_event",
        lambda _cursor, _plant_id_hex: {"measured_at": "2026-01-01 00:00:00", "water_added_g": FlakyFloat()},
    )
    cur = FakeCursor(fetchone_results=[(0,)])

    out = wl.calculate_water_loss(
        cur,
        plant_id_hex="a" * 32,
        measured_at="2026-01-02 10:00:00",
        measured_weight_g=90,
        last_wet_weight_g=0,
        water_added_g=None,
        last_watering_water_added=0,
        prev_measured_weight=100,
    )

    assert out.water_loss_day_g == 10
    assert out.water_loss_total_pct == 25.0
    assert out.water_loss_day_pct is None
