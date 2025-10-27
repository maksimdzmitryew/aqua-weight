from ..utils.db_utils import get_db_connection, return_db_connection  # Import from db utility module

class LastPlantEvent:
    """
    Helper to fetch the last measurement record for a plant.
    Usage:
      helper = last_plant_event(cursor)
      last = helper.for_plant(payload.plant_id)
    or
      last = last_plant_event.for_plant_static(cursor, payload.plant_id)
    """
    @staticmethod
    def get_last_event(plant_id: str):
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g, method_id, scale_id, note
                    FROM plants_measurements
                    WHERE plant_id=UNHEX(%s)
                    ORDER BY measured_at DESC
                    LIMIT 1
                    """,
                    (plant_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                def to_hex(b):
                    return b.hex() if isinstance(b, (bytes, bytearray)) else None
                return {
                    "measured_at": row[0].isoformat(sep=" ", timespec="seconds") if row[0] else None,
                    "measured_weight_g": row[1],
                    "last_dry_weight_g": row[2],
                    "last_wet_weight_g": row[3],
                    "water_added_g": row[4],
                    "method_id": to_hex(row[5]),
                    "scale_id": to_hex(row[6]),
                    "note": row[7],
                }
        finally:
            return_db_connection(conn)  # Return the connection to the pool
