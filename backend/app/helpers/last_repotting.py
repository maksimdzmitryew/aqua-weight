from typing import Optional

from ..schemas.measurement import MeasurementItem


def get_last_repotting_event(conn, plant_id_hex: str) -> Optional[MeasurementItem]:
    """
    Find the last repotting event for a plant.
    A repotting event is identified by having numeric values for:
    measured_weight_g, last_dry_weight_g, water_added_g
    and null values for last_wet_weight_g, water_loss_total_pct, water_loss_total_g,
    water_loss_day_pct, water_loss_day_g
    """

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id,
                       measured_at,
                       measured_weight_g,
                       last_dry_weight_g,
                       last_wet_weight_g,
                       water_added_g,
                       water_loss_total_pct,
                       water_loss_total_g,
                       water_loss_day_pct,
                       water_loss_day_g
                FROM plants_measurements
                WHERE plant_id = UNHEX(%s)
                  AND measured_weight_g IS NOT NULL
                  AND last_dry_weight_g IS NOT NULL
                  AND water_added_g IS NOT NULL
                  AND last_wet_weight_g IS NULL
                  AND water_loss_total_pct IS NULL
                  AND water_loss_total_g IS NULL
                  AND water_loss_day_pct IS NULL
                  AND water_loss_day_g IS NULL
                ORDER BY measured_at DESC LIMIT 1
                """,
                (plant_id_hex,)
            )
            row = cur.fetchone()

            if not row:
                return None

            return MeasurementItem(
                id=row[0].hex() if isinstance(row[0], bytes) else row[0],
                measured_at=row[1].isoformat(sep=" ", timespec="microseconds") if row[1] else None,
                measured_weight_g=row[2],
                last_dry_weight_g=row[3],
                last_wet_weight_g=row[4],
                water_added_g=row[5],
                water_loss_total_pct=row[6],
                water_loss_total_g=row[7],
                water_loss_day_pct=row[8],
                water_loss_day_g=row[9]
            )
    except Exception as e:
        print(
            f"Failed to fetch measurement for plant: {e}"
        )
        return None
