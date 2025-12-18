from typing import List, Optional

from ..schemas.measurement import MeasurementItem


def get_added_waterings_since_repotting(
    conn, plant_id_hex: str, last_repotting: Optional[MeasurementItem]
) -> List[float]:
    """
    Get all water_added_g values for a plant since the last repotting event.
    If there's no repotting event, get all measured_weight_g values.
    """
    try:
        # If there's no repotting event, get all measurements
        if not last_repotting:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT water_added_g
                    FROM plants_measurements
                    WHERE plant_id = UNHEX(%s)
                      AND water_added_g IS NOT NULL
                    ORDER BY measured_at ASC
                    """,
                    (plant_id_hex,),
                )
                rows = cur.fetchall()

                return [row[0] for row in rows if row[0] is not None]
        else:
            # might be inaccurate if repotting evevnt is the only one holding the water amount info
            # Get measurements since the last repotting event
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT water_added_g
                    FROM plants_measurements
                    WHERE plant_id = UNHEX(%s)
                      AND measured_at >= %s
                      AND water_added_g IS NOT NULL
                    ORDER BY measured_at ASC
                    """,
                    (plant_id_hex, last_repotting.measured_at),
                )
                rows = cur.fetchall()
                return [row[0] for row in rows if row[0] is not None]
    except Exception as e:
        print(
            "Could not read waterings added",
            e,
        )
        return []


def calculate_max_watering_added_g(
    conn, plant_id_hex: str, last_repotting: Optional[MeasurementItem]
) -> Optional[float]:
    """
    Calculate the minimum measured_weight_g for a plant since last repotting.
    If there's no repotting event, calculate from all measurements.
    """
    try:
        # Get maximum water that this weight is able to retain
        waterings = get_added_waterings_since_repotting(conn, plant_id_hex, last_repotting)
        if not waterings:
            return None
        return max(waterings)
    except Exception:
        return None
