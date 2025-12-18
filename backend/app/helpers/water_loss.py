"""
Helper functions for measurement calculations.
"""

from typing import Optional

import pymysql

from ..helpers.watering import get_last_watering_event


class WaterLossCalculation:
    """Data class to hold water loss calculation results."""

    def __init__(self):
        self.water_loss_day_g: Optional[int] = None
        self.water_loss_day_pct: Optional[float] = None
        self.water_loss_total_g: Optional[int] = None
        self.water_loss_total_pct: Optional[float] = None
        self.is_watering_event: bool = False


def calculate_water_loss(
        cursor: pymysql.cursors.Cursor,
        plant_id_hex: str,
        measured_at: str,
        measured_weight_g: Optional[int],
        last_wet_weight_g: Optional[int],
        water_added_g: Optional[int],
        last_watering_water_added: int,
        prev_measured_weight: Optional[int],
        exclude_measurement_id: Optional[str] = None
) -> WaterLossCalculation:
    """
    Calculate water loss metrics for a measurement.

    Args:
        cursor: Database cursor
        plant_id_hex: Plant ID as hex string
        measured_at: Measurement timestamp
        measured_weight_g: Current measured weight
        last_wet_weight_g: Last wet weight (after watering)
        water_added_g: Water added in this measurement (if watering event)
        last_watering_water_added: Water added in the last watering event
        prev_measured_weight: Previous measurement weight
        exclude_measurement_id: ID to exclude from queries (for updates)

    Returns:
        WaterLossCalculation object with calculated values
    """
    result = WaterLossCalculation()

    # Determine if this is a watering event
    # is_watering_event = (water_added_g is not None and int(water_added_g) > 0)
    is_watering_event = (measured_weight_g is None)
    result.is_watering_event = is_watering_event

    # If this is a watering event, all loss fields should be NULL
    if is_watering_event:
        result.water_loss_total_pct = 0
        return result

    # Calculate daily loss
    daydiff = None
    baseline_for_day = prev_measured_weight if (
            measured_weight_g is not None and prev_measured_weight is not None
    ) else last_wet_weight_g

    if measured_weight_g is not None and baseline_for_day is not None:
        try:
            daydiff = max(baseline_for_day - measured_weight_g, 0)
            result.water_loss_day_g = daydiff

            # Use last watering event's water_added for percentage calculation
            if last_watering_water_added > 0:
                result.water_loss_day_pct = round(
                    (daydiff / float(last_watering_water_added)) * 100.0, 2
                )
            elif (last_wet_weight_g or 0) > 0:
                result.water_loss_day_pct = round(
                    (daydiff / float(last_wet_weight_g)) * 100.0, 2
                )
        except Exception:
            pass

    # Calculate total loss since last watering event
    try:
        # Build exclusion clause for updates
        exclude_clause = ""
        exclude_params = []
        if exclude_measurement_id:
            exclude_clause = " AND id <> UNHEX(%s)"
            exclude_params = [exclude_measurement_id]

        last_watering_event = get_last_watering_event(cursor, plant_id_hex)
        last_watering_water_added = last_watering_event["water_added_g"] if last_watering_event else 0
        last_watered_at = last_watering_event["measured_at"] if last_watering_event else None

        if last_watering_event:

            # Sum existing daily losses after the last watering and before or at current
            sum_query = f"""
                SELECT COALESCE(
                    SUM(
                        COALESCE(
                            water_loss_day_g,
                            GREATEST(
                                COALESCE(last_wet_weight_g, 0) - COALESCE(measured_weight_g, 0),
                                0
                            )
                        )
                    ),
                    0
                )
                FROM plants_measurements
                WHERE plant_id = UNHEX(%s)
                  {exclude_clause}
                  AND measured_at > %s
                  AND measured_at <= %s
            """
            sum_params = [plant_id_hex] + exclude_params + [last_watered_at, measured_at]
            cursor.execute(sum_query, sum_params)
            summed = cursor.fetchone()[0] or 0

            # Include current measurement's daily loss
            total_g = int(summed) + int(result.water_loss_day_g or 0)
            result.water_loss_total_g = total_g

            if last_watering_water_added > 0:
                result.water_loss_total_pct = round(
                    (total_g / float(last_watering_water_added)) * 100.0, 2
                )

                # If day pct not set yet, use last event's water_added
                if result.water_loss_day_pct is None and daydiff is not None:
                    try:
                        result.water_loss_day_pct = round(
                            (float(daydiff) / float(last_watering_water_added)) * 100.0, 2
                        )
                    except Exception:
                        pass
        else:
            # No prior watering event; leave totals as None
            result.water_loss_total_g = None
            result.water_loss_total_pct = None
    except Exception:
        # On any error, keep totals as None
        pass

    return result
