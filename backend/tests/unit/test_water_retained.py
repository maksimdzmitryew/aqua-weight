from backend.app.helpers.water_retained import calculate_water_retained


def test_watering_event_substitution_uses_last_wet_when_loss_zero():
    # measured_weight_g is None and water_loss_total_pct == 0 -> treat as watering, use last_wet
    res = calculate_water_retained(
        min_dry_weight_g=80,
        max_water_weight_g=20,
        measured_weight_g=None,
        last_wet_weight_g=95,
        water_loss_total_pct=0,
    )
    # available = min(80+20, 95) - 80 = 15 -> remain = 95-80 = 15 => 15/15 = 1.0 -> 100%
    assert round(res.water_retained_pct, 2) == 100.0


def test_regular_measurement_with_last_wet_caps_effective_capacity_and_clamps():
    # measured 85; last_wet lower than saturated so effective capacity uses last_wet
    res = calculate_water_retained(
        min_dry_weight_g=80,
        max_water_weight_g=50,  # overstated historical maximum
        measured_weight_g=85,
        last_wet_weight_g=90,   # effective saturated = 90 (min of 130, 90)
        water_loss_total_pct=None,
    )
    # available = 90-80=10; remain = 85-80=5 -> 5/10 = 0.5 = 50%
    assert round(res.water_retained_pct, 2) == 50.0

    # Clamp above 100% when remain exceeds available
    res2 = calculate_water_retained(
        min_dry_weight_g=80,
        max_water_weight_g=10,
        measured_weight_g=200,  # far above
        last_wet_weight_g=100,
        water_loss_total_pct=None,
    )
    assert round(res2.water_retained_pct, 2) == 100.0

    # Clamp below 0% when remain negative
    res3 = calculate_water_retained(
        min_dry_weight_g=80,
        max_water_weight_g=10,
        measured_weight_g=70,  # below dry
        last_wet_weight_g=100,
        water_loss_total_pct=None,
    )
    assert round(res3.water_retained_pct, 2) == 0.0


def test_zero_or_invalid_capacity_leaves_none():
    # available_water_g becomes 0 -> result remains None
    res = calculate_water_retained(
        min_dry_weight_g=80,
        max_water_weight_g=0,
        measured_weight_g=85,
        last_wet_weight_g=None,
        water_loss_total_pct=None,
    )
    assert res.water_retained_pct is None


def test_equal_measured_equals_min_dry_uses_water_loss_or_defaults_100():
    # When measured == min_dry and water_loss_total_pct provided, use 100 - loss
    res = calculate_water_retained(
        min_dry_weight_g=80,
        max_water_weight_g=20,
        measured_weight_g=80,
        last_wet_weight_g=None,
        water_loss_total_pct=25,
    )
    assert res.water_retained_pct == 75

    # If loss is None -> falls back to 100
    res2 = calculate_water_retained(
        min_dry_weight_g=80,
        max_water_weight_g=20,
        measured_weight_g=80,
        last_wet_weight_g=None,
        water_loss_total_pct=None,
    )
    assert res2.water_retained_pct == 100


def test_early_return_when_measured_none_and_insufficient_data():
    # measured None, water_loss_total_pct not zero, and last_wet/min_dry insufficient -> return None
    res = calculate_water_retained(
        min_dry_weight_g=None,
        max_water_weight_g=10,
        measured_weight_g=None,
        last_wet_weight_g=None,
        water_loss_total_pct=5,
    )
    assert res.water_retained_pct is None


def test_early_return_when_regular_measurement_missing_min_dry():
    res = calculate_water_retained(
        min_dry_weight_g=None,
        max_water_weight_g=10,
        measured_weight_g=90,
        last_wet_weight_g=95,
        water_loss_total_pct=None,
    )
    assert res.water_retained_pct is None


def test_measured_none_but_has_last_wet_and_min_dry_computes_from_last_wet():
    res = calculate_water_retained(
        min_dry_weight_g=80,
        max_water_weight_g=30,
        measured_weight_g=None,
        last_wet_weight_g=100,
        water_loss_total_pct=10,  # not zero so no substitution
    )
    # effective saturated is min(110, 100)=100; available=20; remain=20 -> 100%
    assert round(res.water_retained_pct, 2) == 100.0


def test_last_wet_below_min_dry_uses_saturated_capacity_branch():
    # Covers branch at lines 66-70 where last_wet_weight_g < min_dry_weight_g,
    # so effective_saturated_weight remains saturated_weight (no min() adjustment)
    res = calculate_water_retained(
        min_dry_weight_g=80,
        max_water_weight_g=20,   # saturated = 100
        measured_weight_g=85,
        last_wet_weight_g=70,    # below min_dry -> condition false
        water_loss_total_pct=None,
    )
    # available = 100-80 = 20; remain = 85-80 = 5 -> 5/20 = 0.25 => 25%
    assert round(res.water_retained_pct, 2) == 25.0


def test_frac_ratio_none_branch_is_skipped_gracefully():
    # Craft a measured_weight_g that yields a water_remain_g whose division by
    # a number returns None, so `if frac_ratio is not None` evaluates to False.
    class FakeRemain:
        def __truediv__(self, other):
            return None

    class FakeMeasured:
        # Ensure we take the main branch (measured != min_dry)
        def __ne__(self, other):
            return True

        def __sub__(self, other):
            return FakeRemain()

    res = calculate_water_retained(
        min_dry_weight_g=80,
        max_water_weight_g=40,  # saturated = 120 -> available positive (covered)
        measured_weight_g=FakeMeasured(),
        last_wet_weight_g=None,
        water_loss_total_pct=None,
    )
    # Since frac_ratio is None, assignment branch is skipped -> stays None
    assert res.water_retained_pct is None
