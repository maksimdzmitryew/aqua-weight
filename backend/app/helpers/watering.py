
"""
Helper functions for watering-related operations.
"""

from typing import Any, Dict, Optional

import pymysql

from ..db import bin_to_hex


def get_last_watering_event(
    cursor: pymysql.cursors.Cursor,
    plant_id_hex: str
) -> Optional[Dict[str, Any]]:
    """
    Get the last watering event for a given plant.
    
    A watering event is identified by:
    - measured_weight_g IS NULL
    - water_loss_total_pct IS 0
    - water_loss_total_g IS NULL
    - water_loss_day_pct IS NULL
    - water_loss_day_g IS NULL
    AND:
    - last_dry_weight_g IS NOT NULL
    - last_wet_weight_g IS NOT NULL
    - water_added_g > 0
    
    Args:
        cursor: Database cursor
        plant_id_hex: ULID/UUID of the plant as hex string (32 chars)
    
    Returns:
        Dictionary with watering event data or None if not found
    """
    query = """
        SELECT 
            id,
            plant_id,
            measured_at,
            measured_weight_g,
            last_dry_weight_g,
            last_wet_weight_g,
            water_added_g,
            water_loss_total_pct,
            water_loss_total_g,
            water_loss_day_pct,
            water_loss_day_g,
            method_id,
            use_last_method,
            scale_id,
            note,
            created_at,
            updated_at
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
        ORDER BY measured_at DESC
        LIMIT 1
    """
    
    cursor.execute(query, (plant_id_hex,))
    row = cursor.fetchone()
    
    if not row:
        return None
    
    # Convert to dictionary
    from ..utils.date_time import to_iso_utc

    return {
        "id": bin_to_hex(row[0]),
        "plant_id": bin_to_hex(row[1]),
        "measured_at": to_iso_utc(row[2]) if row[2] else None,
        "measured_weight_g": row[3],
        "last_dry_weight_g": row[4],
        "last_wet_weight_g": row[5],
        "water_added_g": row[6],
        "water_loss_total_pct": float(row[7]) if row[7] is not None else None,
        "water_loss_total_g": row[8],
        "water_loss_day_pct": float(row[9]) if row[9] is not None else None,
        "water_loss_day_g": row[10],
        "method_id": bin_to_hex(row[11]),
        "use_last_method": bool(row[12]) if row[12] is not None else False,
        "scale_id": bin_to_hex(row[13]),
        "note": row[14],
        "created_at": to_iso_utc(row[15]) if row[15] else None,
        "updated_at": to_iso_utc(row[16]) if row[16] else None,
    }