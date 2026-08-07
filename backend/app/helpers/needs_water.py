"""Shared computation of a plant's watering status.

Single source of truth for ``needs_water`` and ``needs_watering_prediction``,
used by both the plant-list assembly (``helpers/plants_list.py``) and the
measurement save endpoints (``routes/measurements.py``). Centralising it here
lets the bulk pages read the authoritative ``needs_water`` straight from the
save response instead of issuing a second ``GET /plants`` round-trip.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from ..helpers.water_retained import get_last_watering_event_since


@dataclass
class WaterStatus:
    needs_water: bool = False
    needs_watering_prediction: bool = False


def compute_water_status(
    conn,
    plant_id_hex: str,
    *,
    water_retained_pct: Optional[float],
    water_loss_total_pct: Optional[float],
    mode: str = "manual",
    recommended_water_threshold_pct: Optional[float] = None,
    default_threshold: float = 40.0,
    days_offset: Optional[int] = None,
) -> WaterStatus:
    """Return the authoritative (needs_water, needs_watering_prediction).

    Faithfully reproduces the logic previously inlined in
    ``PlantsList.fetch_all`` so the measurement save endpoints can reuse it
    without duplicating it.
    """
    thresh_val = (
        recommended_water_threshold_pct
        if recommended_water_threshold_pct is not None
        else default_threshold
    )

    standard_needs_water = False
    if mode != "vacation":
        if water_retained_pct is not None and thresh_val is not None:
            standard_needs_water = water_retained_pct <= thresh_val
        elif water_retained_pct is None:
            # No watering event since the reset: decide via the low
            # water-loss/day prediction rule over post-reset measurements.
            from ..helpers.plants_list import PlantsList

            standard_needs_water = PlantsList._check_watering_prediction(conn, plant_id_hex)

        if water_loss_total_pct == 0 and (water_retained_pct is None or water_retained_pct > 0):
            standard_needs_water = False

    needs_watering_prediction = False
    if not standard_needs_water:
        from ..helpers.plants_list import PlantsList

        needs_watering_prediction = PlantsList._check_watering_prediction(conn, plant_id_hex)

    needs_water = False
    if mode == "vacation":
        if days_offset is None:
            days_offset = _days_offset_for_plant(conn, plant_id_hex)
        if days_offset is not None and days_offset <= 0:
            needs_water = True
        elif water_retained_pct is not None and thresh_val is not None:
            needs_water = water_retained_pct <= thresh_val
    else:
        needs_water = standard_needs_water

    return WaterStatus(
        needs_water=needs_water,
        needs_watering_prediction=needs_watering_prediction,
    )


def _days_offset_for_plant(conn, plant_id_hex: str) -> Optional[int]:
    """Vacation projection: days until next watering (negative = overdue).

    Mirrors ``PlantsList.fetch_all``: last watering event + frequency_days.
    """
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT frequency_days FROM plants WHERE id = UNHEX(%s)",
                (plant_id_hex,),
            )
            row = cur.fetchone()
            freq_days = row[0] if row else None

        last_watering = get_last_watering_event_since(conn, plant_id_hex)
        last_watering_at = last_watering[0] if last_watering else None

        if freq_days is None or freq_days <= 0 or not last_watering_at:
            return None

        today_date = datetime.now().date()
        first_date = (last_watering_at + timedelta(days=int(freq_days))).date()
        return (first_date - today_date).days
    except Exception:
        return None
