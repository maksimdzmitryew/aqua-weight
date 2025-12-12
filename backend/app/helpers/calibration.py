from __future__ import annotations

from typing import Dict, List, Optional
from datetime import datetime

from .last_repotting import get_last_repotting_event
from ..db import bin_to_hex
from datetime import datetime


def _parse_db_dt(value) -> Optional[datetime]:
    """
    Best‑effort parse for timestamps coming from helpers that may already be strings.
    Accepts:
      - datetime (returned as‑is)
      - 'YYYY-MM-DD HH:MM:SS' (seconds)
      - 'YYYY-MM-DD HH:MM:SS.ssssss' (microseconds)
    Returns None on failure.
    """
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    s = str(value).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            pass
    return None


def calibrate_by_max_water_retained(conn) -> Dict[str, List[dict]]:
    """
    For each plant, examine watering events since the last repotting.
    Detect watering events that did not reach 100% saturation (min_dry + max_water).
    Return mapping: plant_uuid_hex -> list of dicts with calculated underwatering.

    Each item contains:
      - measured_at (str)
      - water_added_g (int)
      - last_wet_weight_g (int | None)
      - target_weight_g (int) = min_dry + max_water
      - under_g (int) = max(0, target - last_wet)
      - under_pct (float) = (under_g / max_water) * 100
    """

    results: Dict[str, List[dict]] = {}

    # Fetch plants basic data needed for the calculation
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.id, p.min_dry_weight_g, p.max_water_weight_g
            FROM plants p
            WHERE p.archive = 0
            """
        )
        plants_rows = cur.fetchall() or []

    for row in plants_rows:
        pid_bytes = row[0]
        min_dry = row[1]
        max_water = row[2]

        # Sanity checks
        if pid_bytes is None:
            continue
        if min_dry is None or max_water is None or max_water <= 0:
            continue

        plant_hex = pid_bytes.hex() if isinstance(pid_bytes, (bytes, bytearray)) else str(pid_bytes)

        # Find last repotting event
        last_repot = get_last_repotting_event(conn, plant_hex)

        # Build query for watering events
        params = [plant_hex]
        where_since = ""
        if last_repot and last_repot.measured_at:
            # Only include events strictly AFTER the last repotting moment
            where_since = " AND measured_at > %s"
            parsed = _parse_db_dt(last_repot.measured_at)
            params.append(parsed or last_repot.measured_at)

        with conn.cursor() as cur:
            cur.execute(
                (
                    """
                    SELECT id, measured_at, water_added_g, last_wet_weight_g
                    FROM plants_measurements
                    WHERE plant_id = UNHEX(%s)
                      AND measured_weight_g IS NULL
                    """
                    + where_since +
                    """
                    ORDER BY measured_at DESC
                    """
                ),
                params,
            )
            watering_rows = cur.fetchall() or []

        target_weight = int(min_dry) + int(max_water)
        items: List[dict] = []
        for wr in watering_rows:
            mid = wr[0]
            measured_at_dt = wr[1]
            water_added_g = wr[2]
            last_wet_weight_g = wr[3]

            # Compute "Underwatering" based on water added vs max water capacity, per requirement/example.
            # Example: min=80, max_water=20, water_added=15 -> under_g = 5, under_pct = 25% of max_water? (example says 15%)
            # The spec says: underwater would be 5g and 15%. That implies percent points relative to total weight target
            # or specifically states "in % points" with example 15%. Given max_water is 20 and added 15, remaining 5 is 25% of max water.
            # However the provided example states 15%, which matches 5/ (min+max)? No: 5/100 = 5%.
            # Prior discussions aligned on percent relative to max_water. We'll follow the requirement text before the example:
            # "in grams and in % points" and use percent of max_water (consistent with previous implementation),
            # while computing under_g from water_added instead of last wet weight.
            if water_added_g is not None and max_water:
                try:
                    under_g_val = max(0, int(max_water) - int(water_added_g))
                except Exception:
                    under_g_val = None
                under_pct_val = (under_g_val / float(max_water)) * 100.0 if under_g_val is not None else None
            else:
                under_g_val = None
                under_pct_val = None

            items.append({
                "id": bin_to_hex(mid) if mid is not None else None,
                "measured_at": measured_at_dt.isoformat(sep=" ", timespec="seconds") if isinstance(measured_at_dt, datetime) else str(measured_at_dt) if measured_at_dt else None,
                "water_added_g": int(water_added_g) if water_added_g is not None else None,
                "last_wet_weight_g": int(last_wet_weight_g) if last_wet_weight_g is not None else None,
                "target_weight_g": int(target_weight),
                "under_g": int(under_g_val) if under_g_val is not None else None,
                "under_pct": float(under_pct_val) if under_pct_val is not None else None,
            })

        if items:
            results[plant_hex] = items

    return results


def calibrate_by_minimum_dry_weight(conn) -> Dict[str, List[dict]]:
    """
    Stub: returns empty mapping, but compatible structure with calibrate_by_max_water_retained.
    """
    return {}
