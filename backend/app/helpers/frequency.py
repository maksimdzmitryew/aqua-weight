from __future__ import annotations

"""
Helpers to compute watering frequency in days per plant.

Rules provided by product:
- Consider only measurements since the last repotting event (if any).
- A watering event is a measurement row where:
    measured_weight_g IS NULL AND water_loss_total_pct = 0
- No cooldown, no volatility filtering.
- Frequency is computed from the intervals between consecutive watering events
  (need at least 2 events → 1 interval). Consider all events since repot.
- Result rounded to the nearest whole day. If not enough data, return None.
"""

from datetime import datetime
from statistics import median
from typing import List, Optional

from .last_repotting import get_last_repotting_event


def _fetch_watering_events_since(
    conn, plant_id_hex: str, since_dt: Optional[datetime]
) -> List[datetime]:
    """Return watering event timestamps (ascending) since given datetime (inclusive).

    Watering event detection per spec: measured_weight_g IS NULL AND water_loss_total_pct = 0.
    """
    with conn.cursor() as cur:
        if since_dt is None:
            cur.execute(
                """
                SELECT measured_at
                FROM plants_measurements
                WHERE plant_id = UNHEX(%s)
                  AND measured_weight_g IS NULL
                  AND water_loss_total_pct = 0
                ORDER BY measured_at ASC
                """,
                (plant_id_hex,),
            )
        else:
            cur.execute(
                """
                SELECT measured_at
                FROM plants_measurements
                WHERE plant_id = UNHEX(%s)
                  AND measured_at >= %s
                  AND measured_weight_g IS NULL
                  AND water_loss_total_pct = 0
                ORDER BY measured_at ASC
                """,
                (plant_id_hex, since_dt),
            )
        rows = cur.fetchall() or []
        return [r[0] for r in rows if r and r[0] is not None]


def compute_frequency_days(conn, plant_id_hex: str) -> tuple[Optional[int], int]:
    """Compute watering frequency in days for a plant.

    Returns (frequency_days, event_count).
    Frequency is an integer number of days, rounded to nearest, or None if not enough data.
    Event count is the number of watering events found.
    """
    last_repot = get_last_repotting_event(conn, plant_id_hex)
    since_dt = None
    if last_repot and last_repot.measured_at:
        try:
            since_dt = datetime.fromisoformat(last_repot.measured_at)
        except Exception:
            since_dt = None

    events = _fetch_watering_events_since(conn, plant_id_hex, since_dt)
    event_count = len(events)
    if event_count < 2:
        return None, event_count

    # Compute consecutive intervals in days (float)
    day_secs = 24 * 60 * 60
    intervals_days: List[float] = []
    for prev, curr in zip(events, events[1:]):
        dt = (curr - prev).total_seconds() / day_secs
        if dt >= 0:
            intervals_days.append(dt)

    if not intervals_days:
        return None, event_count

    # Use median for robustness to an outlier extra-long or short interval
    freq = median(intervals_days)

    # Round to nearest whole day and return as int
    return int(round(freq)), event_count
