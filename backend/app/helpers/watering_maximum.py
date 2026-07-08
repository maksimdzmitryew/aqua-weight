from typing import Optional

from ..schemas.measurement import MeasurementItem


def calculate_max_watering_added_g(
    conn, plant_id_hex: str, last_repotting: Optional[MeasurementItem]
) -> Optional[float]:
    """
    Calculate max daily watering amount (sum of water_added_g per date) since
    the last repotting event.

    Cutoff behavior:
      - If last_repotting is present: only include events with measured_at > repot_at (strict).
      - If no repotting: include all history.

    If no qualifying watering events exist, return None.
    """
    try:
        params = [plant_id_hex]
        repot_clause = ""
        if last_repotting and last_repotting.measured_at:
            repot_clause = " AND measured_at > %s"
            params.append(last_repotting.measured_at)

        # Watering event signature matches the backend's documented storage signature.
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT MAX(daily_sum)
                FROM (
                    SELECT DATE(measured_at) AS d, SUM(water_added_g) AS daily_sum
                    FROM plants_measurements
                    WHERE plant_id = UNHEX(%s)
                      AND measured_weight_g IS NULL
                      AND water_loss_total_pct = 0
                      AND water_loss_total_g IS NULL
                      AND water_loss_day_pct IS NULL
                      AND water_loss_day_g IS NULL
                      AND last_dry_weight_g IS NOT NULL
                      AND last_wet_weight_g IS NOT NULL
                      AND water_added_g > 0
                      {repot_clause}
                    GROUP BY DATE(measured_at)
                ) t
                """,
                params,
            )
            row = cur.fetchone()
            return row[0] if row and row[0] is not None else None
    except Exception:
        return None
