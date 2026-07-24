from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from ..db import HEX_RE, bin_to_hex, get_conn_factory, hex_to_bin
from ..helpers.calibration import (
    calibrate_by_max_water_retained,
    calibrate_by_minimum_dry_weight,
)
from ..helpers.last_repotting import get_last_repotting_event
from ..helpers.needs_water import compute_water_status
from ..helpers.plants_list import PlantsList
from ..helpers.water_loss import WaterLossCalculation
from ..helpers.water_retained import (
    calculate_water_retained,
    get_last_watering_event_since,
)
from ..helpers.water_weight import (
    update_min_dry_weight_and_max_watering_added_g,
)
from ..helpers.weighing import needs_weighing
from ..schemas.measurement import (
    LastMeasurementResponse,
    MeasurementCreateRequest,
    MeasurementItem,
    MeasurementUpdateRequest,
    WateringApproximationItem,
    WateringApproximationResponse,
)
from ..schemas.plant import PlantCalibrationItem
from ..security import (
    require_authenticated_user,
    require_plant_access,
)
from ..services.auth_service import generate_ulid_bytes
from ..services.measurements import (
    DerivedWeights,
    compute_water_losses,
    derive_weights,
    ensure_exclusive_water_vs_weight,
    parse_timestamp_local,
    validate_water_loss,
)
from ..utils.settings_defaults import parse_default_threshold
from ..metrics import watering_events_total, measurements_total

# Ensure router is defined before any @app.* decorators are used
app = APIRouter()


# Internal helpers to make post-transaction computations testable and covered
def _compute_water_retained_for_plant(
    cur,
    plant_id_hex: str,
    *,
    measured_weight_g: int | None,
    water_loss_total_pct: float | None,
) -> float | None:
    """Fetch plant min/max and compute rounded water_retained_pct.

    The wet reference is taken from the last watering event after the reset
    (plant creation or last repotting) so pre-reset waterings are ignored.
    Returns None when there is no watering event since the reset.
    """
    cur.execute(
        "SELECT min_dry_weight_g, max_water_weight_g FROM plants WHERE id = UNHEX(%s)",
        (plant_id_hex,),
    )
    plant_row = cur.fetchone()
    if not plant_row:
        # Preserve existing behavior expectations (the caller assumes a plant row exists)
        # We return None here to avoid unbound variables while keeping semantics simple for tests.
        min_dry_weight_g = None
        max_water_weight_g = None
    else:
        min_dry_weight_g = plant_row[0]
        max_water_weight_g = plant_row[1]

    # Wet reference reset-anchored to the last watering event after creation/repotting.
    last_watering_ref = get_last_watering_event_since(cur.connection, plant_id_hex)
    last_wet_weight_g = last_watering_ref[2] if last_watering_ref else None

    water_retained_calc = calculate_water_retained(
        min_dry_weight_g=min_dry_weight_g,
        max_water_weight_g=max_water_weight_g,
        measured_weight_g=measured_weight_g,
        last_wet_weight_g=last_wet_weight_g,
        water_loss_total_pct=water_loss_total_pct,
    )
    if water_retained_calc.water_retained_pct is None:
        return None
    return round(water_retained_calc.water_retained_pct, 0)


def _post_delete_recalculate_and_commit(conn, plant_id_hex: str, measured_weight_g: int | None):
    """After a successful delete, recalculate min dry/max watering and commit.

    We pass None for new values to force refresh from current database state.
    """
    update_min_dry_weight_and_max_watering_added_g(conn, plant_id_hex, None, None)
    conn.commit()


# --- New: Simple endpoint to record a delegated/reported watering (no weights) ---
class VacationWateringCreateRequest(BaseModel):
    measured_at: str | None = None


@app.post("/plants/{plant_id}/measurements/vacation/watering")
async def create_vacation_watering(
    plant_id: Annotated[str, Depends(require_plant_access)],
    payload: VacationWateringCreateRequest,
    defaultThreshold: str | None = Cookie(None),
    get_conn_fn=Depends(get_conn_factory),
):
    """
    Create a watering event for Vacation mode by collecting the latest water_added_g.

    The endpoint finds the latest non-NULL water_added_g for the plant (defaulting to 0 if none found)
    and then records it with a specific Vacation mode signature:
      - water_loss_total_pct = 0
      - water_added_g = equals water_added_g from any latest measurement event
      - measured_weight_g = NULL
      - last_dry_weight_g = NULL
      - last_wet_weight_g = NULL
      - water_loss_total_g = NULL
      - water_loss_day_pct = NULL
      - water_loss_day_g = NULL

    Note: This watering event is ignored by the backend frequency calculator
    (see compute_frequency_days) because last_dry_weight_g and last_wet_weight_g
    are NULL.
    """
    if not HEX_RE.match(plant_id or ""):
        raise HTTPException(status_code=400, detail="Invalid plant_id")

    from ..utils.date_time import now_local_iso

    measured_at_str = payload.measured_at or now_local_iso()
    try:
        measured_at_dt = parse_timestamp_local(measured_at_str)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid measured_at: {e}")

    def do_work():
        conn = get_conn_fn()
        try:
            with conn.cursor() as cur:
                # Fetch latest water_added_g that is not NULL
                cur.execute(
                    """
                    SELECT water_added_g
                    FROM plants_measurements
                    WHERE plant_id = UNHEX(%s)
                      AND water_added_g IS NOT NULL
                    ORDER BY measured_at DESC
                    LIMIT 1
                    """,
                    (plant_id,),
                )
                row = cur.fetchone()
                water_added_g = row[0] if row else 0

                # Fetch latest method_id and scale_id for this plant
                cur.execute(
                    """
                    SELECT method_id, scale_id
                    FROM plants_measurements
                    WHERE plant_id = UNHEX(%s)
                      AND (method_id IS NOT NULL OR scale_id IS NOT NULL)
                    ORDER BY measured_at DESC
                    LIMIT 1
                    """,
                    (plant_id,),
                )
                row = cur.fetchone()
                method_id_bin = row[0] if row and row[0] else None
                scale_id_bin = row[1] if row and row[1] else None

                new_id = generate_ulid_bytes()
                final_note = "[vacation] watering"

                cur.execute(
                    """
                    INSERT INTO plants_measurements (
                        id, plant_id, measured_at,
                        measured_weight_g, last_dry_weight_g, last_wet_weight_g,
                        water_added_g, water_loss_total_pct,
                        method_id, scale_id, note
                    ) VALUES (%s, UNHEX(%s), %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        new_id,
                        plant_id,
                        measured_at_dt,
                        None,  # measured_weight_g
                        None,  # last_dry_weight_g
                        None,  # last_wet_weight_g
                        water_added_g,
                        0,  # water_loss_total_pct marks a watering event
                        method_id_bin,
                        scale_id_bin,
                        final_note,
                    ),
                )
                conn.commit()

                # Record Prometheus metric
                watering_events_total.labels(mode="vacation").inc()

                # Compute water retained percentage for response
                water_retained_pct = _compute_water_retained_for_plant(
                    cur,
                    plant_id,
                    measured_weight_g=None,
                    water_loss_total_pct=0,
                )

                # Fetch the plant's stored recommended threshold (mirrors the list).
                cur.execute(
                    "SELECT recommended_water_threshold_pct FROM plants WHERE id = UNHEX(%s)",
                    (plant_id,),
                )
                _rec_row = cur.fetchone()
                recommended_thr = _rec_row[0] if _rec_row else None

                # Authoritative needs_water for vacation mode (single source of truth).
                status = compute_water_status(
                    conn,
                    plant_id,
                    water_retained_pct=water_retained_pct,
                    water_loss_total_pct=0,
                    mode="vacation",
                    recommended_water_threshold_pct=recommended_thr,
                    default_threshold=parse_default_threshold(defaultThreshold),
                )

                return {
                    "id": bin_to_hex(new_id),
                    "plant_id": plant_id,
                    "measured_at": measured_at_dt.isoformat(sep=" ", timespec="microseconds"),
                    "water_loss_total_pct": 0.0,
                    "water_retained_pct": water_retained_pct,
                    "needs_water": status.needs_water,
                    "note": final_note,
                }
        except Exception as e:
            try:
                conn.rollback()
            except Exception:
                pass
            raise HTTPException(status_code=500, detail=f"Failed to create vacation watering: {e}")
        finally:
            conn.close()

    return await run_in_threadpool(do_work)


class ReportedWateringCreateRequest(BaseModel):
    # Optional local timestamp string (e.g., from input type=datetime-local). If omitted, uses now.
    measured_at: str | None = None
    # Optional free text; we will prefix with "[reported]" marker when storing.
    note: str | None = None
    # Optional reporter name to include in note (lightweight attribution only)
    reporter: str | None = None


@app.post("/plants/{plant_id}/measurements/reported-watering")
async def create_reported_watering(
    plant_id: Annotated[str, Depends(require_plant_access)],
    payload: ReportedWateringCreateRequest,
    get_conn_fn=Depends(get_conn_factory),
):
    """
    Create a lightweight watering marker when a delegate reports watering without measurements.

    Storage signature (Manual/Delegate mode):
      - water_loss_total_pct = 0
      - water_added_g = equals water_added_g from any latest measurement event (watering or weighing)
      - measured_weight_g = NULL
      - last_dry_weight_g = NULL
      - last_wet_weight_g = NULL
      - water_loss_total_g = NULL
      - water_loss_day_pct = NULL
      - water_loss_day_g = NULL
      - measured_at = provided timestamp (or now)
      - note = "[reported] ..." with optional reporter and free-form note

    Note: This watering event is ignored by the backend frequency calculator
    (see compute_frequency_days) because last_dry_weight_g and last_wet_weight_g
    are NULL.
    """
    if not HEX_RE.match(plant_id or ""):
        raise HTTPException(status_code=400, detail="Invalid plant_id")

    # Parse/normalize timestamp using existing utility to match other endpoints
    from ..utils.date_time import now_local_iso

    measured_at_str = payload.measured_at or now_local_iso()
    try:
        measured_at_dt = parse_timestamp_local(measured_at_str)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid measured_at: {e}")

    # Compose a concise note
    parts = ["[reported] watering"]
    if (payload.reporter or "").strip():
        parts.append(f"by {payload.reporter.strip()}")
    if (payload.note or "").strip():
        parts.append(f"— {payload.note.strip()}")
    final_note = " ".join(parts)

    def do_insert():
        conn = get_conn_fn()
        try:
            with conn.cursor() as cur:
                # Fetch latest water_added_g that is not NULL
                cur.execute(
                    """
                    SELECT water_added_g
                    FROM plants_measurements
                    WHERE plant_id = UNHEX(%s)
                      AND water_added_g IS NOT NULL
                    ORDER BY measured_at DESC
                    LIMIT 1
                    """,
                    (plant_id,),
                )
                row = cur.fetchone()
                water_added_g = row[0] if row else 0

                new_id = generate_ulid_bytes()
                cur.execute(
                    (
                        """
                        INSERT INTO plants_measurements (
                          id, plant_id, measured_at,
                          measured_weight_g, last_dry_weight_g, last_wet_weight_g,
                          water_added_g, water_loss_total_pct, note
                        ) VALUES (%s, UNHEX(%s), %s, %s, %s, %s, %s, %s, %s)
                        """
                    ),
                    (
                        new_id,
                        plant_id,
                        measured_at_dt,
                        None,  # measured_weight_g
                        None,  # last_dry_weight_g
                        None,  # last_wet_weight_g
                        water_added_g,
                        0,  # water_loss_total_pct marks a watering event for scheduling
                        final_note,
                    ),
                )
                conn.commit()
                return {
                    "id": bin_to_hex(new_id),
                    "plant_id": plant_id,
                    "measured_at": measured_at_dt.isoformat(sep=" ", timespec="microseconds"),
                    "note": final_note,
                }
        except Exception as e:
            try:
                conn.rollback()
            except Exception:
                pass
            raise HTTPException(status_code=500, detail=f"Failed to create reported watering: {e}")
        finally:
            try:
                conn.close()
            except Exception:
                pass

    return await run_in_threadpool(do_insert)


def _to_dt_string(s: str | None):
    if not s:
        return None
    return s.strip().replace("T", " ")


@app.get(
    "/plants/measurements/approximation/watering", response_model=WateringApproximationResponse
)
async def get_watering_approximation(
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    operationMode: str | None = Cookie(None),
    defaultThreshold: str | None = Cookie(None),
):
    """
    Calculate virtual water retained, frequency, and next watering date for all active plants.
    Currently, this endpoint is a simple projection based on existing PlantsList logic,
    but it's intended for extension when automated IOT measurements or other data sources
    are not available (e.g., in Vacation mode).
    """
    mode = operationMode or "manual"
    def_thr = parse_default_threshold(defaultThreshold)

    def fetch():
        plants = PlantsList.fetch_all(
            mode=mode, default_threshold=def_thr, current_user=current_user
        )
        items = []
        for p in plants:
            next_at = p.get("next_watering_at")
            first_at = p.get("first_calculated_at")
            # For each plant, also calculate needs_weighing based on its latest measurement date
            items.append(
                WateringApproximationItem(
                    plant_uuid=p["uuid"],
                    virtual_water_retained_pct=p.get("water_retained_pct"),
                    frequency_days=p.get("frequency_days"),
                    frequency_confidence=p.get("frequency_confidence"),
                    next_watering_at=(
                        next_at.isoformat()
                        if next_at and hasattr(next_at, "isoformat")
                        else (str(next_at) if next_at else None)
                    ),
                    first_calculated_at=(
                        first_at.isoformat()
                        if first_at and hasattr(first_at, "isoformat")
                        else (str(first_at) if first_at else None)
                    ),
                    days_offset=p.get("days_offset"),
                    needs_weighing=p.get("needs_weighing", False),
                )
            )
        return WateringApproximationResponse(items=items)

    return await run_in_threadpool(fetch)


@app.get("/plants/{plant_id}/measurements/last", response_model=LastMeasurementResponse | None)
async def get_last_measurement(
    plant_id: Annotated[str, Depends(require_plant_access)],
    get_conn_fn=Depends(get_conn_factory),
):
    if not HEX_RE.match(plant_id or ""):
        raise HTTPException(status_code=400, detail="Invalid plant_id")

    def do_fetch():
        conn = get_conn_fn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    (
                        """
                    SELECT measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g, method_id, scale_id, note
                    FROM plants_measurements
                    WHERE plant_id=UNHEX(%s)
                    ORDER BY measured_at DESC
                    LIMIT 1
                    """
                    ),
                    (plant_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return {
                    "measured_at": (
                        row[0].isoformat(sep=" ", timespec="microseconds") if row[0] else None
                    ),
                    "measured_weight_g": row[1],
                    "last_dry_weight_g": row[2],
                    "last_wet_weight_g": row[3],
                    "water_added_g": row[4],
                    "method_id": bin_to_hex(row[5]),
                    "scale_id": bin_to_hex(row[6]),
                    "note": row[7],
                }
        finally:
            conn.close()

    return await run_in_threadpool(do_fetch)


@app.get("/plants/measurements/calibrating", response_model=list[PlantCalibrationItem])
async def list_plants_for_calibration(
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    get_conn_fn=Depends(get_conn_factory),
):
    """Returns plants enriched with calibration data (underwatering after repotting)."""

    def fetch():
        # Use the same base list and ordering as the Plants list page
        base = PlantsList.fetch_all(current_user=current_user)

        # Compute calibration data
        conn = get_conn_fn()
        try:
            max_map = calibrate_by_max_water_retained(conn)
            min_map = calibrate_by_minimum_dry_weight(conn)
        finally:
            try:
                conn.close()
            except Exception:
                pass

        result: list[dict] = []
        # Preserve ordering by iterating the already-sorted base list
        for base_item in base:
            pid = base_item.get("uuid") or base_item.get("id")
            if not pid:
                continue
            calib = {
                "max_water_retained": max_map.get(pid, []),
                "min_dry_weight": min_map.get(pid, []),
            }
            enriched = dict(base_item)
            enriched["calibration"] = calib
            result.append(enriched)
        return result

    return await run_in_threadpool(fetch)


class CorrectionsRequest(BaseModel):
    from_ts: str | None = None  # ISO local, optional
    to_ts: str | None = None  # ISO local, optional
    cap: str | None = None  # 'capacity' | 'retained_ratio'
    edit_last_wet: bool | None = True
    # Optional hints from UI: the chosen starting measurement and the most negative diff value
    start_measurement_id: str | None = None
    start_diff_to_max_g: int | None = None


@app.post("/plants/{plant_id}/measurements/corrections")
async def apply_measurements_corrections(
    plant_id: Annotated[str, Depends(require_plant_access)],
    payload: CorrectionsRequest,
    get_conn_fn=Depends(get_conn_factory),
):
    """
    Deterministically correct past over-watering events for a plant.

    - Select watering entries (measured_weight_g IS NULL) in the given window
      (default: since last repotting) where last_wet_weight_g exceeds a cap.
    - Cap rule:
        * 'capacity' (default): target = min_dry_weight_g + max_water_weight_g
        * 'retained_ratio': target = min_dry_weight_g + (recommended_water_threshold_pct/100) * max_water_weight_g
    - For each overfilled row, compute excess = last_wet_weight_g - target (>=0)
      and update water_added_g = GREATEST(0, water_added_g - excess).
      If edit_last_wet = true, also set last_wet_weight_g = LEAST(last_wet_weight_g, target).
    Returns a summary with counts and totals per plant.
    """
    cap_mode = (payload.cap or "capacity").lower()
    if cap_mode not in ("capacity", "retained_ratio"):
        raise HTTPException(status_code=400, detail="Invalid cap mode")

    def do_apply():
        conn = get_conn_fn()
        try:
            with conn.cursor() as cur:
                # Fetch plant params
                cur.execute(
                    """
                    SELECT min_dry_weight_g, max_water_weight_g, COALESCE(recommended_water_threshold_pct, 100)
                    FROM plants
                    WHERE id = UNHEX(%s)
                    """,
                    (plant_id,),
                )
                row = cur.fetchone()
                min_dry, max_water, rec_pct = row
                if min_dry is None or max_water is None or max_water <= 0:
                    # Nothing to do if calibration incomplete
                    return {"updated": 0, "total_excess_g": 0, "details": []}

            # Determine window
            from_dt = parse_timestamp_local(payload.from_ts) if payload.from_ts else None
            to_dt = (
                parse_timestamp_local(payload.to_ts, fixed_milliseconds=999)
                if payload.to_ts
                else None
            )
            if not from_dt and not to_dt:
                # Default: since last repotting
                last_repot = get_last_repotting_event(conn, plant_id)
                if last_repot and last_repot.measured_at:
                    try:
                        # parse_timestamp_local accepts str; we may already have a datetime
                        if isinstance(last_repot.measured_at, datetime):
                            from_dt = last_repot.measured_at
                        else:
                            from_dt = parse_timestamp_local(str(last_repot.measured_at))
                    except Exception:
                        from_dt = None

            # Build dynamic WHERE for window
            where_parts = ["plant_id = UNHEX(%s)", "measured_weight_g IS NULL"]
            params: list = [plant_id]
            if from_dt:
                where_parts.append("measured_at >= %s")
                params.append(from_dt)
            if to_dt:
                where_parts.append("measured_at <= %s")
                params.append(to_dt)
            where_clause = " AND ".join(where_parts)

            # Compute target per row (constant for cap modes we support now)
            if cap_mode == "capacity":
                target_weight = int(min_dry) + int(max_water)
            else:
                ratio = max(0, min(100, int(rec_pct))) / 100.0
                target_weight = int(min_dry) + int(round(ratio * int(max_water)))

            # Select candidate rows that exceed target
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT id, measured_at, water_added_g, last_wet_weight_g
                    FROM plants_measurements
                    WHERE {where_clause} AND last_wet_weight_g IS NOT NULL AND last_wet_weight_g > %s
                    ORDER BY measured_at ASC
                    """,
                    (*params, target_weight),
                )
                rows = cur.fetchall() or []

            if not rows:
                return {"updated": 0, "total_excess_g": 0, "details": []}

            # Apply updates in a transaction
            conn.autocommit(False)
            total_excess = 0
            updated = 0
            details = []
            try:
                with conn.cursor() as cur:
                    for r in rows:
                        mid, measured_at, water_added_g, last_wet_weight_g = r
                        excess = max(0, int(last_wet_weight_g) - int(target_weight))
                        if excess <= 0:
                            continue
                        new_added = max(0, int(water_added_g or 0) - excess)
                        if payload.edit_last_wet:
                            cur.execute(
                                """
                                UPDATE plants_measurements
                                SET water_added_g = %s,
                                    last_wet_weight_g = LEAST(COALESCE(last_wet_weight_g, %s), %s)
                                WHERE id = %s
                                """,
                                (new_added, target_weight, target_weight, mid),
                            )
                        else:
                            cur.execute(
                                """
                                UPDATE plants_measurements
                                SET water_added_g = %s
                                WHERE id = %s
                                """,
                                (new_added, mid),
                            )
                        updated += 1
                        total_excess += excess
                        details.append(
                            {
                                "id": bin_to_hex(mid),
                                "measured_at": (
                                    measured_at.isoformat(sep=" ", timespec="microseconds")
                                    if isinstance(measured_at, datetime)
                                    else str(measured_at)
                                ),
                                "excess_g": excess,
                                "new_water_added_g": new_added,
                            }
                        )
                conn.commit()
            except Exception:
                try:
                    conn.rollback()
                except Exception:
                    pass
                raise
            finally:
                conn.autocommit(True)

            return {
                "updated": updated,
                "total_excess_g": total_excess,
                "details": details,
                "target_weight_g": target_weight,
            }
        finally:
            try:
                conn.close()
            except Exception:
                pass

    return await run_in_threadpool(do_apply)


@app.get("/plants/{plant_id}/measurements", response_model=list[MeasurementItem])
async def list_measurements_for_plant(
    plant_id: Annotated[str, Depends(require_plant_access)],
    get_conn_fn=Depends(get_conn_factory),
):
    def do_fetch():
        conn = get_conn_fn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    (
                        """
                    SELECT id, measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g,
                           water_loss_total_pct, water_loss_total_g, water_loss_day_pct, water_loss_day_g, note
                    FROM plants_measurements
                    WHERE plant_id=UNHEX(%s)
                    ORDER BY measured_at DESC
                    """
                    ),
                    (plant_id,),
                )
                rows = cur.fetchall() or []
                results = []
                for r in rows:
                    _id = r[0]
                    results.append(
                        {
                            "id": bin_to_hex(_id),
                            "measured_at": (
                                r[1].isoformat(sep=" ", timespec="microseconds") if r[1] else None
                            ),
                            "measured_weight_g": r[2],
                            "last_dry_weight_g": r[3],
                            "last_wet_weight_g": r[4],
                            "water_added_g": r[5],
                            "water_loss_total_pct": float(r[6]) if r[6] is not None else None,
                            "water_loss_total_g": r[7],
                            "water_loss_day_pct": float(r[8]) if r[8] is not None else None,
                            "water_loss_day_g": r[9],
                            "note": r[10],
                        }
                    )

                # Group by second for repotting identification
                buckets = {}
                for res in results:
                    ts_sec = res["measured_at"][:19] if res["measured_at"] else ""
                    buckets.setdefault(ts_sec, []).append(res)

                # Post-processing: Apply type classification
                for ts_sec, bucket in buckets.items():
                    candidates_a = []
                    candidates_b = []
                    candidates_c = []
                    for i, res in enumerate(bucket):
                        mw = res.get("measured_weight_g")
                        ld = res.get("last_dry_weight_g")
                        lw = res.get("last_wet_weight_g")
                        # Row A: mw set, ld and lw NULL
                        if mw is not None and ld is None and lw is None:
                            candidates_a.append(i)
                        # Row B: mw NULL, ld and lw set (water-loss fields may be NULL)
                        elif mw is None and ld is not None and lw is not None:
                            candidates_b.append(i)
                        # Row C: mw, ld, lw all set AND mw == lw
                        elif mw is not None and ld is not None and lw is not None and mw == lw:
                            candidates_c.append(i)

                    if len(candidates_a) == 1 and len(candidates_b) == 1 and len(candidates_c) == 1:
                        bucket[candidates_a[0]]["type"] = "Repotting"
                        bucket[candidates_b[0]]["type"] = "Repotting"
                        bucket[candidates_c[0]]["type"] = "Repotting"

                for res in results:
                    if res.get("type"):
                        continue
                    mw = res.get("measured_weight_g")
                    wa = res.get("water_added_g")
                    wl = res.get("water_loss_total_pct")

                    if wa and wa > 0 and (wl or 0) == 0 and mw is None:
                        res["type"] = "Aqua"
                    elif mw is not None and (wl is not None or wa == 0):
                        res["type"] = "Weight"
                    else:
                        res["type"] = "Measurement"

                return results
        finally:
            conn.close()

    return await run_in_threadpool(do_fetch)


@app.post("/plants/{plant_id}/measurements/watering")
@app.post("/plants/{plant_id}/measurements/weight")
async def create_measurement(
    plant_id: Annotated[str, Depends(require_plant_access)],
    payload: MeasurementCreateRequest,
    mode: str = "manual",
    defaultThreshold: str | None = Cookie(None),
    get_conn_fn=Depends(get_conn_factory),
):
    """
    Create a new measurement or watering event.

    Storage signature for Watering (Automatic and Manual mode):
      - last_dry_weight_g > 0
      - last_wet_weight_g > 0
      - water_added_g > 0
      - water_loss_total_pct = 0
      - measured_weight_g = NULL
      - water_loss_total_g = NULL
      - water_loss_day_pct = NULL
      - water_loss_day_g = NULL
    """
    # Normalize inputs using services
    try:
        ensure_exclusive_water_vs_weight(payload.measured_weight_g, payload.water_added_g)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Use deterministic milliseconds so multiple events at the same minute can be ordered
    measured_at_dt = parse_timestamp_local(payload.measured_at)
    measured_at = measured_at_dt  # pass timezone-naive local datetime directly to DB driver

    measured_weight = payload.measured_weight_g
    last_dry_weight = payload.last_dry_weight_g
    lw = payload.last_wet_weight_g
    payload_water_added = payload.water_added_g

    def do_insert():
        conn = get_conn_fn()
        try:
            conn.autocommit(False)
            with conn.cursor() as cur:
                # Derive effective weights and water_added
                derived = derive_weights(
                    cursor=cur,
                    plant_id_hex=plant_id,
                    measured_at_db=measured_at,
                    measured_weight_g=measured_weight,
                    last_dry_weight_g=last_dry_weight,
                    last_wet_weight_g=lw,
                    payload_water_added_g=payload_water_added,
                    exclude_measurement_id=None,
                )

                # Calculate water loss using shared service
                loss_calc = compute_water_losses(
                    cursor=cur,
                    plant_id_hex=plant_id,
                    measured_at_db=measured_at,
                    measured_weight_g=measured_weight,
                    derived=derived,
                    exclude_measurement_id=None,
                )

                # Validate water loss
                try:
                    validate_water_loss(
                        cursor=cur,
                        plant_id_hex=plant_id,
                        current_weight=measured_weight,
                        measured_at=measured_at,
                    )
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))

                last_dry_weight_local = derived.last_dry_weight_g
                lw_local = derived.last_wet_weight_g
                wa_local = derived.water_added_g

                # For watering events, measured_weight_g must be NULL
                mw_insert = None if loss_calc.is_watering_event else measured_weight

                # Store the water_added_g value
                wa_insert = int(wa_local) if wa_local else 0

                new_id = generate_ulid_bytes()
                cur.execute(
                    (
                        "INSERT INTO plants_measurements (id, plant_id, measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g, water_loss_total_pct, water_loss_total_g, water_loss_day_pct, water_loss_day_g, method_id, use_last_method, scale_id, note) "
                        "VALUES (%s, UNHEX(%s), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                    ),
                    (
                        new_id,
                        plant_id,
                        measured_at,
                        mw_insert,
                        last_dry_weight_local,
                        lw_local,
                        wa_insert,
                        loss_calc.water_loss_total_pct,
                        loss_calc.water_loss_total_g,
                        loss_calc.water_loss_day_pct,
                        loss_calc.water_loss_day_g,
                        hex_to_bin(payload.method_id) if payload.method_id else None,
                        1 if payload.use_last_method else 0,
                        hex_to_bin(payload.scale_id) if payload.scale_id else None,
                        (payload.note or None),
                    ),
                )

                # Check the min dry weight and max water added and Update if needed
                # If this is a weight measurement
                if not loss_calc.is_watering_event and mw_insert is not None:
                    check_min_weight = mw_insert
                    check_max_water = wa_local
                # If this is a watering event
                else:
                    check_min_weight = lw_local
                    check_max_water = wa_local

                update_min_dry_weight_and_max_watering_added_g(
                    conn, plant_id, check_min_weight, check_max_water
                )

                # Commit transaction after all statements succeed
                conn.commit()

                # Compute water retained percentage using the helper
                water_retained_pct = _compute_water_retained_for_plant(
                    cur,
                    plant_id,
                    measured_weight_g=mw_insert,
                    water_loss_total_pct=loss_calc.water_loss_total_pct,
                )

                # Compute if plant needs weighing based on latest measurement
                cur.execute(
                    "SELECT MAX(measured_at) FROM plants_measurements WHERE plant_id = UNHEX(%s)",
                    (plant_id,),
                )
                latest_at = cur.fetchone()[0]
                needs_weighing_val = needs_weighing(latest_at, mode)

                # Fetch the plant's stored recommended threshold (mirrors the list:
                # thresh_val = recommended if not None else default from cookie).
                cur.execute(
                    "SELECT recommended_water_threshold_pct FROM plants WHERE id = UNHEX(%s)",
                    (plant_id,),
                )
                _rec_row = cur.fetchone()
                recommended_thr = _rec_row[0] if _rec_row else None

                # Authoritative needs_water, computed once at save time so the bulk
                # pages read it straight from the response (no extra GET /plants).
                status = compute_water_status(
                    conn,
                    plant_id,
                    water_retained_pct=water_retained_pct,
                    water_loss_total_pct=loss_calc.water_loss_total_pct,
                    mode=mode,
                    recommended_water_threshold_pct=recommended_thr,
                    default_threshold=parse_default_threshold(defaultThreshold),
                )

                # Record Prometheus metrics
                if loss_calc.is_watering_event:
                    watering_events_total.labels(mode="manual").inc()
                else:
                    measurements_total.inc()

                return {
                    "status": "success",
                    "data": {
                        "id": new_id.hex(),
                        "water_loss_total_pct": loss_calc.water_loss_total_pct,
                        "water_retained_pct": water_retained_pct,
                        "needs_weighing": needs_weighing_val,
                        "needs_water": status.needs_water,
                    },
                    "meta": {"timestamp": measured_at, "version": "1.0"},
                }
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            conn.close()

    return await run_in_threadpool(do_insert)


@app.put("/plants/{plant_id}/measurements/watering/{id_hex}")
@app.put("/plants/{plant_id}/measurements/weight/{id_hex}")
async def update_measurement(
    plant_id: Annotated[str, Depends(require_plant_access)],
    id_hex: str,
    payload: MeasurementUpdateRequest,
    mode: str = "manual",
    defaultThreshold: str | None = Cookie(None),
    get_conn_fn=Depends(get_conn_factory),
):
    """
    Update an existing measurement or watering event.

    Safety:
    If the event is a Vacation/Reported watering (signature: weights are NULL),
    the system preserves this signature during updates by bypassing weight
    derivation and loss re-calculations, unless physical weights are explicitly provided.
    """
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid id")

    def do_update():
        conn = get_conn_fn()
        try:
            conn.autocommit(False)
            with conn.cursor() as cur:
                # Fetch existing row to determine plant and previous measurement
                cur.execute(
                    "SELECT plant_id, measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g FROM plants_measurements WHERE id=UNHEX(%s) LIMIT 1",
                    (id_hex,),
                )
                base = cur.fetchone()
                if not base:
                    raise HTTPException(status_code=404, detail="Not found")
                plant_id_bytes = base[0]
                plant_hex = (
                    plant_id_bytes.hex()
                    if isinstance(plant_id_bytes, (bytes, bytearray))
                    else str(plant_id_bytes)
                )
                if plant_hex.lower() != plant_id.lower():
                    raise HTTPException(status_code=404, detail="Not found")

                current_measured_at = base[1]
                current_mw, current_ld, current_lw, current_wa = base[2], base[3], base[4], base[5]

                # Validate exclusivity
                try:
                    ensure_exclusive_water_vs_weight(
                        payload.measured_weight_g, payload.water_added_g
                    )
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))

                # Normalize incoming values
                measured_at = (
                    parse_timestamp_local(payload.measured_at)
                    if payload.measured_at is not None
                    else None
                )
                mw = payload.measured_weight_g if payload.measured_weight_g is not None else None
                ld = payload.last_dry_weight_g if payload.last_dry_weight_g is not None else None
                lw = payload.last_wet_weight_g if payload.last_wet_weight_g is not None else None
                wa = payload.water_added_g if payload.water_added_g is not None else None

                # Effective values fallback to current DB row
                mw_eff = mw if mw is not None else current_mw
                ld_eff = ld if ld is not None else current_ld
                lw_eff = lw if lw is not None else current_lw
                wa_eff_payload = wa if wa is not None else current_wa
                measured_at_eff = measured_at if measured_at is not None else current_measured_at

                # Use derivation helper to recompute consistent fields
                # Skip re-derivation if this is a Vacation/Reported watering event (weights are NULL)
                # to preserve the technical signature.
                is_vacation_event = current_mw is None and current_ld is None and current_lw is None

                if is_vacation_event and mw is None and ld is None and lw is None:
                    # Maintain the Vacation signature
                    derived = DerivedWeights(
                        last_dry_weight_g=None,
                        last_wet_weight_g=None,
                        water_added_g=wa_eff_payload or current_wa or 0,
                        prev_measured_weight=None,  # Not used for Vacation events
                        last_watering_water_added=current_wa or 0,
                    )
                    loss_calc = WaterLossCalculation()
                    loss_calc.water_loss_total_pct = 0.0
                    loss_calc.is_watering_event = True
                else:
                    derived = derive_weights(
                        cursor=cur,
                        plant_id_hex=plant_hex,
                        measured_at_db=measured_at_eff,
                        measured_weight_g=mw_eff,
                        last_dry_weight_g=ld_eff,
                        last_wet_weight_g=lw_eff,
                        payload_water_added_g=wa_eff_payload,
                        exclude_measurement_id=id_hex,
                    )

                    # Determine previous measurement (by time) for day loss calc happens in compute
                    loss_calc = compute_water_losses(
                        cursor=cur,
                        plant_id_hex=plant_hex,
                        measured_at_db=measured_at_eff,
                        measured_weight_g=mw_eff,
                        derived=derived,
                        exclude_measurement_id=id_hex,
                    )

                # Validate water loss
                try:
                    validate_water_loss(
                        cursor=cur,
                        plant_id_hex=plant_hex,
                        current_weight=mw_eff,
                        measured_at=measured_at_eff,
                        exclude_measurement_id=id_hex,
                    )
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))

                mw_update = None if loss_calc.is_watering_event else mw_eff
                wa_update = int(derived.water_added_g) if derived.water_added_g else 0

                sql = (
                    "UPDATE plants_measurements SET measured_at=COALESCE(%s, measured_at), measured_weight_g=%s, last_dry_weight_g=%s, last_wet_weight_g=%s, water_added_g=%s, "
                    "water_loss_total_pct=%s, water_loss_total_g=%s, water_loss_day_pct=%s, water_loss_day_g=%s, method_id=%s, use_last_method=COALESCE(%s, use_last_method), scale_id=%s, note=%s WHERE id=UNHEX(%s)"
                )
                params = (
                    (measured_at if measured_at is not None else None),
                    mw_update,
                    derived.last_dry_weight_g,
                    derived.last_wet_weight_g,
                    wa_update,
                    loss_calc.water_loss_total_pct,
                    loss_calc.water_loss_total_g,
                    loss_calc.water_loss_day_pct,
                    loss_calc.water_loss_day_g,
                    hex_to_bin(payload.method_id) if payload.method_id is not None else None,
                    (
                        (1 if payload.use_last_method else 0)
                        if payload.use_last_method is not None
                        else None
                    ),
                    hex_to_bin(payload.scale_id) if payload.scale_id is not None else None,
                    (payload.note if payload.note is not None else None),
                    id_hex,
                )
                cur.execute(sql, params)

                # If this is a weight measurement (not a watering event) and the weight has changed, update the min dry weight
                if not loss_calc.is_watering_event and (
                    mw_update is not None or current_mw is not None
                ):
                    # Calculate the effective new weight (use the updated one if provided, otherwise use the old one)
                    effective_new_weight = mw_update if mw_update is not None else current_mw
                    update_min_dry_weight_and_max_watering_added_g(
                        conn, plant_hex, effective_new_weight, wa_eff_payload
                    )
                else:
                    update_min_dry_weight_and_max_watering_added_g(
                        conn, plant_hex, derived.last_wet_weight_g, wa_eff_payload
                    )

                conn.commit()

                # Compute water retained percentage using the helper
                water_retained_pct = _compute_water_retained_for_plant(
                    cur,
                    plant_hex,
                    measured_weight_g=mw_eff,
                    water_loss_total_pct=loss_calc.water_loss_total_pct,
                )

                # Compute if plant needs weighing based on latest measurement
                cur.execute(
                    "SELECT MAX(measured_at) FROM plants_measurements WHERE plant_id = UNHEX(%s)",
                    (plant_hex,),
                )
                latest_at = cur.fetchone()[0]
                needs_weighing_val = needs_weighing(latest_at, mode)

                # Fetch the plant's stored recommended threshold (mirrors the list).
                cur.execute(
                    "SELECT recommended_water_threshold_pct FROM plants WHERE id = UNHEX(%s)",
                    (plant_hex,),
                )
                _rec_row = cur.fetchone()
                recommended_thr = _rec_row[0] if _rec_row else None

                # Authoritative needs_water, computed once at save time.
                status = compute_water_status(
                    conn,
                    plant_hex,
                    water_retained_pct=water_retained_pct,
                    water_loss_total_pct=loss_calc.water_loss_total_pct,
                    mode=mode,
                    recommended_water_threshold_pct=recommended_thr,
                    default_threshold=parse_default_threshold(defaultThreshold),
                )

                return {
                    "status": "success",
                    "data": {
                        "id": id_hex,
                        "water_loss_total_pct": loss_calc.water_loss_total_pct,
                        "water_retained_pct": water_retained_pct,
                        "needs_weighing": needs_weighing_val,
                        "needs_water": status.needs_water,
                    },
                    "meta": {"timestamp": measured_at, "version": "1.0"},
                }
        except HTTPException:
            raise
        except Exception as e:
            print(
                "Could not update measurement: ",
                e,
            )
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            conn.close()

    return await run_in_threadpool(do_update)


@app.get("/plants/{plant_id}/measurements/{id_hex}")
async def get_measurement(
    plant_id: Annotated[str, Depends(require_plant_access)],
    id_hex: str,
    get_conn_fn=Depends(get_conn_factory),
):
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid id")

    def do_fetch():
        conn = get_conn_fn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    (
                        """
                    SELECT id, plant_id, measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g,
                           water_loss_total_pct, water_loss_total_g, water_loss_day_pct, water_loss_day_g, method_id, use_last_method, scale_id, note
                    FROM plants_measurements
                    WHERE id=UNHEX(%s)
                    LIMIT 1
                    """
                    ),
                    (id_hex,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Not found")

                plant_id_bytes = row[1]
                plant_hex = (
                    plant_id_bytes.hex()
                    if isinstance(plant_id_bytes, (bytes, bytearray))
                    else str(plant_id_bytes)
                )
                if plant_hex.lower() != plant_id.lower():
                    raise HTTPException(status_code=404, detail="Not found")

                return {
                    "id": bin_to_hex(row[0]),
                    "plant_id": bin_to_hex(row[1]),
                    "measured_at": (
                        row[2].isoformat(sep=" ", timespec="microseconds") if row[2] else None
                    ),
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
                }
        finally:
            conn.close()

    return await run_in_threadpool(do_fetch)


@app.delete("/plants/{plant_id}/measurements/{id_hex}")
async def delete_measurement(
    plant_id: Annotated[str, Depends(require_plant_access)],
    id_hex: str,
    get_conn_fn=Depends(get_conn_factory),
):
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid id")

    def do_delete():
        conn = get_conn_fn()
        try:
            with conn.cursor() as cur:
                # First, get the measurement details to identify the plant
                cur.execute(
                    """
                    SELECT plant_id, measured_weight_g
                    FROM plants_measurements
                    WHERE id = UNHEX(%s)
                    """,
                    (id_hex,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Measurement not found")

                plant_id_bytes = row[0]
                plant_id_hex = (
                    plant_id_bytes.hex()
                    if isinstance(plant_id_bytes, (bytes, bytearray))
                    else str(plant_id_bytes)
                )
                if plant_id_hex.lower() != plant_id.lower():
                    raise HTTPException(status_code=404, detail="Measurement not found")

                measured_weight_g = row[1]

                cur.execute("DELETE FROM plants_measurements WHERE id=UNHEX(%s)", (id_hex,))
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Not found")
                # Recalculate and commit via helper
                _post_delete_recalculate_and_commit(conn, plant_id_hex, measured_weight_g)

                return {"message": "Measurement deleted successfully"}
        except HTTPException:
            raise
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise HTTPException(status_code=500, detail="Internal server error")

        finally:
            conn.close()

    return await run_in_threadpool(do_delete)
