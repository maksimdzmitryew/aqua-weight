"""
Helper class for water retained calculations.
"""

from typing import Optional


class WaterRetainedCalculation:
    """Data class to hold water retained calculation results."""

    def __init__(self):
        self.water_retained_pct: Optional[float] = None


def calculate_water_retained(
    min_dry_weight_g: float,
    max_water_weight_g: float,
    measured_weight_g: Optional[float],
    last_wet_weight_g: Optional[float],
    water_loss_total_pct: Optional[float],
) -> WaterRetainedCalculation:
    """
    Calculate water retained percentage for a plant measurement.

    Args:
        min_dry_weight_g: Dry weight = pot + soil + plant completely dry
        max_water_weight_g: Maximum water retained capacity
        measured_weight_g: Current weight = weight read any day on a scale
        last_wet_weight_g: Last wet weight (after watering)
        water_loss_total_pct: Total water loss percentage

    Returns:
        WaterRetainedCalculation object with calculated water retained percentage
    """
    result = WaterRetainedCalculation()

    # Could after repotting followed by watering event
    if measured_weight_g is None and water_loss_total_pct == 0:
        measured_weight_g = last_wet_weight_g

    # 𝑊𝑐 − 𝑊𝑑
    # likely a watering event
    if measured_weight_g is None:
        # Check if we can still calculate with available data
        if last_wet_weight_g is not None and min_dry_weight_g is not None:
            water_remain_g = last_wet_weight_g - min_dry_weight_g
        else:
            return result
    # regular measurement event
    else:
        # Check if we can calculate with available data
        if measured_weight_g is not None and min_dry_weight_g is not None:
            water_remain_g = measured_weight_g - min_dry_weight_g
        else:
            return result

    if min_dry_weight_g != measured_weight_g:
        # Wfc: Saturated weight / field capacity (historical maximum capacity)
        saturated_weight_g = min_dry_weight_g + max_water_weight_g

        # Use an effective saturated weight that accounts for real last wet weight if it was lower
        # This helps when the saved max_water_weight_g is overstated due to past overwatering.
        effective_saturated_weight_g = saturated_weight_g
        if last_wet_weight_g is not None and min_dry_weight_g is not None:
            if last_wet_weight_g >= min_dry_weight_g:
                effective_saturated_weight_g = min(saturated_weight_g, last_wet_weight_g)

        # AWC = effective_Wfc − Wd: available water at (effective) field capacity
        available_water_g = effective_saturated_weight_g - min_dry_weight_g

        # Guard against invalid or zero capacity
        if available_water_g and available_water_g > 0:
            # current fraction of AWC remaining, clamped to [0, 1]
            frac_ratio = water_remain_g / available_water_g
            if frac_ratio is not None:
                frac_ratio = max(0.0, min(1.0, float(frac_ratio)))
                result.water_retained_pct = frac_ratio * 100.0
        # else: leave as None
    else:
        if water_loss_total_pct is not None:
            result.water_retained_pct = 100 - water_loss_total_pct
        else:
            result.water_retained_pct = 100

    return result
