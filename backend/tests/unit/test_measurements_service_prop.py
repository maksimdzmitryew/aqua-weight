import types
from typing import Optional

import pytest
from hypothesis import given, strategies as st

from backend.app.services.measurements import (
    ensure_exclusive_water_vs_weight,
    derive_weights,
)


# Strategy for optional non-negative grams
opt_nonneg = st.one_of(st.none(), st.integers(min_value=0, max_value=50000))


@given(measured_weight_g=opt_nonneg, water_added_g=opt_nonneg)
def test_exclusive_rule_property(measured_weight_g: Optional[int], water_added_g: Optional[int]):
    # It should only raise when both are simultaneously provided and water_added_g > 0
    should_raise = measured_weight_g is not None and (water_added_g or 0) > 0
    if should_raise:
        with pytest.raises(ValueError):
            ensure_exclusive_water_vs_weight(measured_weight_g, water_added_g)
    else:
        ensure_exclusive_water_vs_weight(measured_weight_g, water_added_g)


class _FakeCursor:
    def __init__(self, row):
        # row is either None or a 3-tuple: (measured_weight_g, last_dry_weight_g, last_wet_weight_g)
        self._row = row
        self._sql = None
        self._params = None

    def execute(self, sql, params=None):
        self._sql = sql
        self._params = params

    def fetchone(self):
        return self._row


@given(
    # Whether there was a previous row
    has_prev=st.booleans(),
    prev_measured=st.one_of(st.none(), st.integers(min_value=0, max_value=50000)),
    prev_ld=st.one_of(st.none(), st.integers(min_value=0, max_value=50000)),
    prev_lw=st.one_of(st.none(), st.integers(min_value=0, max_value=50000)),
    measured_weight_g=st.one_of(st.none(), st.integers(min_value=0, max_value=50000)),
    last_dry_weight_g=st.one_of(st.none(), st.integers(min_value=0, max_value=50000)),
    last_wet_weight_g=st.one_of(st.none(), st.integers(min_value=0, max_value=50000)),
    payload_water_added_g=st.one_of(st.none(), st.integers(min_value=0, max_value=50000)),
    last_watering_added=st.integers(min_value=0, max_value=50000),
)

def test_derive_weights_invariants(
    has_prev,
    prev_measured,
    prev_ld,
    prev_lw,
    measured_weight_g,
    last_dry_weight_g,
    last_wet_weight_g,
    payload_water_added_g,
    last_watering_added,
):
    # fake DB previous row
    fake_row = (prev_measured, prev_ld, prev_lw) if has_prev else None
    cur = _FakeCursor(fake_row)

    # Patch watering lookup using context manager to avoid function-scoped fixture
    from unittest.mock import patch
    with patch(
        "backend.app.services.measurements.get_last_watering_event",
        lambda cursor, plant_id_hex: {"water_added_g": last_watering_added},
    ): 
        derived = derive_weights(
            cursor=cur,
            plant_id_hex="0" * 32,
            measured_at_db="2025-01-01 00:00:00",
            measured_weight_g=measured_weight_g,
            last_dry_weight_g=last_dry_weight_g,
            last_wet_weight_g=last_wet_weight_g,
            payload_water_added_g=payload_water_added_g,
        )

    # Invariants
    assert isinstance(derived.water_added_g, int)

    # If it's a measurement event (measured_weight_g provided), water_added mirrors last watering volume
    if measured_weight_g is not None:
        assert derived.last_watering_water_added == last_watering_added
        assert derived.water_added_g == last_watering_added

    # If both last_wet and last_dry are set on watering flow, their difference should match water_added when not overridden by missing dry
    if measured_weight_g is None and derived.last_wet_weight_g is not None and derived.last_dry_weight_g is not None:
        diff = int(derived.last_wet_weight_g) - int(derived.last_dry_weight_g)
        if diff >= 0:
            assert derived.water_added_g == diff
