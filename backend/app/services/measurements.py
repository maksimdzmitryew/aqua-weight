"""
Stateless helpers for measurement endpoints.
Centralizes timestamp parsing, payload validation, and shared computations
across weight, watering, and repotting flows.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import pymysql

from ..helpers.watering import get_last_watering_event
from ..utils.date_time import normalize_measured_at, normalize_measured_at_local


# --- Timestamp helpers -------------------------------------------------------

def parse_timestamp_utc(raw: str, *, fixed_milliseconds: int | None = None) -> datetime:
    """
    Parse FE ISO string and return tz-aware UTC datetime with zeroed seconds and
    optional fixed milliseconds for deterministic ordering.
    """
    return normalize_measured_at(raw, fill_with="zeros", fixed_milliseconds=fixed_milliseconds)


def parse_timestamp_local(raw: str, *, fixed_milliseconds: int | None = None) -> datetime:
    """
    Parse FE ISO string and return a timezone-naive LOCAL datetime with zeroed seconds and
    optional fixed milliseconds for deterministic ordering, suitable for SQL DATETIME.
    """
    return normalize_measured_at_local(raw, fill_with="zeros", fixed_milliseconds=fixed_milliseconds)


def ts_to_db_string(dt: datetime) -> str:
    """Format datetime to 'YYYY-MM-DD HH:MM:SS' for DB usage."""
    return dt.astimezone().strftime("%Y-%m-%d %H:%M:%S")


# --- Validation --------------------------------------------------------------

def ensure_exclusive_water_vs_weight(measured_weight_g: Optional[int], water_added_g: Optional[int]) -> None:
    """
    Enforce exclusivity between measured_weight_g and water_added_g for standard
    measurement events:
      - Weight measurement: measured_weight_g >= 0, water_added_g must be None or 0
      - Watering event: measured_weight_g must be None, water_added_g >= 0 (can be 0)
    Repotting flows can bypass this check at the router level if needed.
    """
    if measured_weight_g is not None and (water_added_g or 0) > 0:
        raise ValueError("Provide either measured_weight_g or water_added_g, not both")


# --- Derivations -------------------------------------------------------------

@dataclass
class DerivedWeights:
    last_dry_weight_g: Optional[int]
    last_wet_weight_g: Optional[int]
    water_added_g: int
    prev_measured_weight: Optional[int]
    last_watering_water_added: int


def derive_weights(
    cursor: pymysql.cursors.Cursor,
    plant_id_hex: str,
    measured_at_db,
    measured_weight_g: Optional[int],
    last_dry_weight_g: Optional[int],
    last_wet_weight_g: Optional[int],
    payload_water_added_g: Optional[int],
    exclude_measurement_id: Optional[str] = None,
) -> DerivedWeights:
    """
    Derive effective last_dry/last_wet/water_added and previous measured weight.
    Mirrors legacy routers' behavior while consolidating logic.
    Uses the previous measurement BEFORE the current measured_at and excludes
    the current record (by id) when updating to avoid zero day loss baselines.
    """
    # Get last watering event
    last_watering_event = get_last_watering_event(cursor, plant_id_hex)
    last_watering_water_added = last_watering_event["water_added_g"] if last_watering_event else 0

    # Fetch previous measurement BEFORE the current timestamp, excluding current id when provided
    where_exclude = ""
    params = [plant_id_hex, measured_at_db]
    if exclude_measurement_id:
        where_exclude = " AND id <> UNHEX(%s)"
        params = [plant_id_hex, exclude_measurement_id, measured_at_db]

    cursor.execute(
        f"""
        SELECT measured_weight_g, last_dry_weight_g, last_wet_weight_g
        FROM plants_measurements
        WHERE plant_id=UNHEX(%s)
          {where_exclude}
          AND measured_at < %s
        ORDER BY measured_at DESC
        LIMIT 1
        """,
        params,
    )
    row = cursor.fetchone()
    if row:
        prev_measured_weight = row[0]
        prev_last_dry = row[1]
        prev_last_wet = row[2]
    else:
        prev_measured_weight, prev_last_dry, prev_last_wet = None, None, None

    # Fill defaults for last dry
    # Priority:
    # 1) explicit payload value
    # 2) previous measurement weight (if exists)
    # 3) when no previous, fall back to current measured_weight_g
    # 4) otherwise previous last_dry (may be None on first record)
    if last_dry_weight_g is None:
        if prev_measured_weight is not None:
            ld_local = prev_measured_weight
        elif measured_weight_g is not None:
            ld_local = measured_weight_g
        else:
            ld_local = prev_last_dry
    else:
        ld_local = last_dry_weight_g

    # Fill defaults for last wet
    if last_wet_weight_g is None:
        if prev_last_wet is None and ld_local is not None:
            lw_local = (ld_local or 0) + (last_watering_water_added or 0)
        else:
            lw_local = prev_last_wet
    else:
        lw_local = last_wet_weight_g

    # Determine water_added
    if payload_water_added_g is not None and int(payload_water_added_g) > 0:
        wa_local = int(payload_water_added_g)
    else:
        wa_local = (lw_local or 0) - (ld_local or 0) if measured_weight_g is None else last_watering_water_added

    # If watering event, prefer recomputing from wet/dry if available
    if measured_weight_g is None:
        if last_wet_weight_g is not None and int(last_wet_weight_g) > 0 and ld_local is not None:
            wa_local = (lw_local or 0) - (ld_local or 0)
        else:
            if (
                payload_water_added_g is not None
                and int(payload_water_added_g) > 0
                and ld_local is not None
                and int(ld_local) > 0
            ):
                wa_local = int(payload_water_added_g)
                if last_wet_weight_g is None:
                    lw_local = int(payload_water_added_g) + int(ld_local)
    else:
        # measurement event
        wa_local = last_watering_water_added

    return DerivedWeights(
        last_dry_weight_g=ld_local,
        last_wet_weight_g=lw_local,
        water_added_g=int(wa_local) if wa_local else 0,
        prev_measured_weight=prev_measured_weight,
        last_watering_water_added=last_watering_water_added,
    )


def compute_water_losses(
    cursor: pymysql.cursors.Cursor,
    plant_id_hex: str,
    measured_at_db: str,
    measured_weight_g: Optional[int],
    derived: DerivedWeights,
    exclude_measurement_id: Optional[str] = None,
):
    """
    Wrapper around calculate_water_loss with consistent arguments.
    Returns the WaterLossCalculation object.
    """
    from ..helpers.water_loss import calculate_water_loss  # local import to avoid cycles

    return calculate_water_loss(
        cursor=cursor,
        plant_id_hex=plant_id_hex,
        measured_at=measured_at_db,
        measured_weight_g=measured_weight_g,
        last_wet_weight_g=derived.last_wet_weight_g,
        water_added_g=None,
        last_watering_water_added=derived.last_watering_water_added,
        prev_measured_weight=derived.prev_measured_weight,
        exclude_measurement_id=exclude_measurement_id,
    )
