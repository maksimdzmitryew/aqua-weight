"""
Helper class for water retained calculations.
"""

from datetime import datetime
from typing import Any, Optional, Tuple

from ..helpers.last_repotting import get_last_repotting_event


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

    # No capacity means there has been no watering event since the reset
    # (plant creation or last repotting). Retained % is then undefined.
    if max_water_weight_g is None:
        return result

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
        # measured_weight_g equals the dry baseline (min_dry_weight_g): the plant is
        # at its driest, so retained water is 0%. The exception is when there is no
        # water-loss history yet (water_loss_total_pct is None or 0 — e.g. a freshly
        # repotted / newly created plant): there the retained % is undefined, so leave it None.
        if water_loss_total_pct not in (None, 0):
            result.water_retained_pct = 0.0

    return result


def get_last_watering_event_since(
    conn, plant_id_hex: str
) -> Optional[Tuple[Any, Any, Any, Any]]:
    """Return (measured_at, last_dry_weight_g, last_wet_weight_g) of the most recent watering
    event strictly after the reset boundary (last repotting, or plant creation if none).

    A watering event is identified by:
      - measured_weight_g IS NULL
      - water_loss_total_pct = 0
      - water_added_g > 0

    Returns None when no watering event exists after the reset boundary.
    """
    try:
        last_repot = get_last_repotting_event(conn, plant_id_hex)
        if last_repot and last_repot.measured_at:
            try:
                reset_at = datetime.fromisoformat(last_repot.measured_at.replace(" ", "T"))
            except Exception:
                reset_at = last_repot.measured_at
        else:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT created_at FROM plants WHERE id = UNHEX(%s)", (plant_id_hex,)
                )
                row = cur.fetchone()
                reset_at = row[0] if row else None

        if reset_at is None:
            return None

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT measured_at, last_dry_weight_g, last_wet_weight_g, water_added_g
                FROM plants_measurements
                WHERE plant_id = UNHEX(%s)
                  AND measured_at > %s
                  AND measured_weight_g IS NULL
                  AND water_loss_total_pct = 0
                  AND water_added_g > 0
                ORDER BY measured_at DESC
                LIMIT 1
                """,
                (plant_id_hex, reset_at),
            )
            row = cur.fetchone()
            if not row:
                return None
            return (row[0], row[1], row[2], row[3])
    except Exception:
        return None
