from typing import Optional

from ..schemas.measurement import MeasurementItem


def get_last_repotting_event(conn, plant_id_hex: str) -> Optional[MeasurementItem]:
    """
    Find the last repotting event for a plant.
    Repotting is stored as a *triple* of measurement rows created at the same
    second (with different microseconds). The three rows have these signatures:

      - Row A: measured_weight_g set, last_dry_weight_g NULL, last_wet_weight_g NULL
      - Row B: measured_weight_g NULL, last_dry_weight_g set, last_wet_weight_g set,
               water_loss_total_* and water_loss_day_* populated (NOT NULL)
      - Row C: measured_weight_g set, last_dry_weight_g set, last_wet_weight_g set

    This helper returns the latest row (max measured_at) of the latest such
    triple (max timestamp). Callers use it as the cutoff moment for "since
    repotting" calculations.
    """

    try:
        with conn.cursor() as cur:
            # 1) Find the latest repotting triple by grouping rows by second.
            # We select the max timestamp within the matching second-bucket.
            cur.execute(
                """
                SELECT MAX(measured_at) AS repot_at
                FROM plants_measurements
                WHERE plant_id = UNHEX(%s)
                GROUP BY DATE_FORMAT(measured_at, '%%Y-%%m-%%d %%H:%%i:%%s')
                HAVING COUNT(*) >= 3
                   AND SUM(
                         CASE
                           WHEN measured_weight_g IS NOT NULL
                            AND last_dry_weight_g IS NULL
                            AND last_wet_weight_g IS NULL
                           THEN 1 ELSE 0
                         END
                       ) = 1
                   AND SUM(
                         CASE
                           WHEN measured_weight_g IS NULL
                            AND last_dry_weight_g IS NOT NULL
                            AND last_wet_weight_g IS NOT NULL
                            AND water_loss_total_pct IS NOT NULL
                            AND water_loss_total_g IS NOT NULL
                            AND water_loss_day_pct IS NOT NULL
                            AND water_loss_day_g IS NOT NULL
                           THEN 1 ELSE 0
                         END
                       ) = 1
                   AND SUM(
                         CASE
                           WHEN measured_weight_g IS NOT NULL
                            AND last_dry_weight_g IS NOT NULL
                            AND last_wet_weight_g IS NOT NULL
                           THEN 1 ELSE 0
                         END
                       ) = 1
                ORDER BY repot_at DESC
                LIMIT 1
                """,
                (plant_id_hex,),
            )
            repot_row = cur.fetchone()
            repot_at = repot_row[0] if repot_row else None
            if not repot_at:
                return None

            # 2) Fetch that latest row to return a MeasurementItem
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
                  AND measured_at = %s
                LIMIT 1
                """,
                (plant_id_hex, repot_at),
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
                water_loss_day_g=row[9],
            )
    except Exception as e:
        print(f"Failed to fetch measurement for plant: {e}")
        return None
