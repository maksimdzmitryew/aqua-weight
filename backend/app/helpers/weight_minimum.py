from typing import Optional, List
from ..schemas.measurement import MeasurementItem
import logging


def calculate_min_dry_weight_g(conn, plant_id_hex: str, last_repotting: Optional[MeasurementItem]) -> Optional[float]:
    """
    Calculate the minimum measured_weight_g for a plant since last repotting.
    If there's no repotting event, calculate from all measurements.
    """
    try:
        # Get minimum possible weight
        weights = get_measured_weights_since_repotting(conn, plant_id_hex, last_repotting)
        if not weights:
            return None
        return min(weights)
    except Exception:
        return None

def get_measured_weights_since_repotting(conn, plant_id_hex: str, last_repotting: Optional[MeasurementItem]) -> List[float]:
    """
    Get all measured_weight_g values for a plant since the last repotting event.
    If there's no repotting event, get all measured_weight_g values.
    """
    try:
        # If there's no repotting event, get all measurements
        if not last_repotting:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT measured_weight_g
                    FROM plants_measurements
                    WHERE plant_id = UNHEX(%s)
                      AND measured_weight_g IS NOT NULL
                    ORDER BY measured_at ASC
                    """,
                    (plant_id_hex,)
                )
                rows = cur.fetchall()

                return [row[0] for row in rows if row[0] is not None]
        else:
            # Get measurements since the last repotting event
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT measured_weight_g
                    FROM plants_measurements
                    WHERE plant_id = UNHEX(%s)
                      AND measured_at > %s
                      AND measured_weight_g IS NOT NULL
                    ORDER BY measured_at ASC
                    """,
                    (plant_id_hex, last_repotting.measured_at)
                )
                rows = cur.fetchall()
                return [row[0] for row in rows if row[0] is not None]
    except Exception as e:
        print(
            "Could not read weight",
            e,
        )
        return []
