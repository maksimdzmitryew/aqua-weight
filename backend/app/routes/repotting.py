from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from ..db import HEX_RE, bin_to_hex, get_conn_factory
from ..helpers.last_plant_event import LastPlantEvent
from ..helpers.watering import get_last_watering_event as _get_last_watering_event
from ..schemas.measurement import (
    RepottingCreateRequest,
    RepottingResponse,
    RepottingUpdateRequest,
)
from ..security import require_plant_access
from ..services.auth_service import generate_ulid_bytes
from ..services.measurements import (
    DerivedWeights,
    compute_water_losses,
    parse_timestamp_local,
    validate_water_loss,
)

app = APIRouter()


# Expose a stable alias for tests/monkeypatching.
# Some environments may not keep imported names on the module object as expected;
# define an explicit shim to guarantee attribute presence.
def get_last_watering_event(cursor, plant_id_hex):
    return _get_last_watering_event(cursor, plant_id_hex)


@app.post("/plants/{plant_id}/repotting", response_model=RepottingResponse)
async def create_repotting_event(
    plant_id: Annotated[str, Depends(require_plant_access)],
    payload: RepottingCreateRequest,
    get_conn_fn=Depends(get_conn_factory),
):
    required_fields = ["measured_at", "measured_weight_g", "last_wet_weight_g"]

    for field in required_fields:
        # NOTE: "0" is a valid value for weights (schema uses ge=0), so check only for None.
        if getattr(payload, field, None) is None:
            raise HTTPException(status_code=400, detail="Missing required field: " + field)

    measured_at = payload.measured_at
    measured_weight_g = payload.measured_weight_g
    repotted_weight_g = payload.last_wet_weight_g
    note = payload.note if payload.note is not None else None
    confirm_small_pot = bool(payload.confirm_small_pot)

    SMALLINT_UNSIGNED_MAX = 65535
    if measured_weight_g is not None and measured_weight_g > SMALLINT_UNSIGNED_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"measured_weight_g must be <= {SMALLINT_UNSIGNED_MAX}",
        )
    if repotted_weight_g is not None and repotted_weight_g > SMALLINT_UNSIGNED_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"last_wet_weight_g must be <= {SMALLINT_UNSIGNED_MAX}",
        )

    def do_insert():
        conn = get_conn_fn()
        try:
            with conn.cursor() as cur:
                # Optionally retrieve last watering event if needed in future; not used in current logic

                # Fetch previous last record for this plant using the helper class
                last_plant_event = LastPlantEvent.get_last_event(plant_id)
                if last_plant_event:
                    prev_measured_weight = last_plant_event["measured_weight_g"]
                    prev_last_dry = last_plant_event["last_dry_weight_g"]
                    prev_last_wet = last_plant_event["last_wet_weight_g"]
                    prev_last_water = last_plant_event["water_added_g"]
                else:
                    prev_measured_weight, prev_last_dry, prev_last_wet = None, None, None
                    raise HTTPException(status_code=404, detail="Last Plant event not found")

                # Pre-check derived dry weight BEFORE any writes.
                # If the user does not confirm, abort with 409 so no repotting-related
                # measurement rows are created for this request.
                prev_last_water_g = prev_last_water or 0
                effective_water_added_g = prev_last_water_g
                if repotted_weight_g - prev_last_water_g < 0:
                    if not confirm_small_pot:
                        raise HTTPException(
                            status_code=409,
                            detail=(
                                "Moved to a very small pot? "
                                "If yes, re-submit with confirm_small_pot=true to reset water_added_g to 0 and continue. "
                                "If no, the previous water_added_g is greater than the new total weight."
                            ),
                        )
                    # User confirmed: record the repotting with water_added_g reset to 0.
                    effective_water_added_g = 0

                derived_last_dry_weight_g = repotted_weight_g - effective_water_added_g

                # new_dry_weight = repotted_weight_g - last_watering_water_added
                measured_at_shift = parse_timestamp_local(measured_at, fixed_microseconds=100)

                new_id = generate_ulid_bytes()

                cur.execute(
                    (
                        "INSERT INTO plants_measurements (id, plant_id, measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g) "
                        "VALUES (%s, UNHEX(%s), %s, %s, %s, %s, %s)"
                    ),
                    (
                        new_id,
                        plant_id,
                        measured_at_shift,
                        measured_weight_g,
                        None,
                        None,
                        effective_water_added_g,
                    ),
                )

                # Calculate water loss using shared services
                derived = DerivedWeights(
                    last_dry_weight_g=prev_last_dry,
                    last_wet_weight_g=prev_last_wet,
                    water_added_g=effective_water_added_g,
                    prev_measured_weight=prev_measured_weight,
                    last_watering_water_added=effective_water_added_g,
                )
                loss_calc = compute_water_losses(
                    cursor=cur,
                    plant_id_hex=plant_id,
                    measured_at_db=measured_at,
                    measured_weight_g=measured_weight_g,
                    derived=derived,
                    exclude_measurement_id=None,
                )

                # Validate water loss
                try:
                    validate_water_loss(
                        cursor=cur,
                        plant_id_hex=plant_id,
                        current_weight=measured_weight_g,
                        measured_at=measured_at,
                    )
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))

                measured_at_shift = parse_timestamp_local(measured_at, fixed_microseconds=200)

                new_id = generate_ulid_bytes()

                cur.execute(
                    (
                        "INSERT INTO plants_measurements (id, plant_id, measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g, water_loss_total_pct, water_loss_total_g, water_loss_day_pct, water_loss_day_g, method_id, use_last_method, scale_id) "
                        "VALUES (%s, UNHEX(%s), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                    ),
                    (
                        new_id,
                        plant_id,
                        measured_at_shift,
                        None,
                        prev_last_dry,
                        prev_last_wet,
                        effective_water_added_g,
                        loss_calc.water_loss_total_pct,
                        loss_calc.water_loss_total_g,
                        loss_calc.water_loss_day_pct,
                        loss_calc.water_loss_day_g,
                        None,
                        1,
                        None,
                    ),
                )

                measured_at_shift = parse_timestamp_local(measured_at, fixed_microseconds=300)
                new_measured_weight_g = derived_last_dry_weight_g

                new_id = generate_ulid_bytes()

                cur.execute(
                    (
                        "INSERT INTO plants_measurements (id, plant_id, measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g, note) "
                        "VALUES (%s, UNHEX(%s), %s, %s, %s, %s, %s, %s)"
                    ),
                    (
                        new_id,
                        plant_id,
                        measured_at_shift,
                        repotted_weight_g,
                        new_measured_weight_g,
                        repotted_weight_g,
                        effective_water_added_g,
                        note,
                    ),
                )

                # Repotting invalidates the plant's previous dry/minimum and max-water assumptions.
                # Reset the calculated fields as agreed:
                # - max_water_weight_g -> 0
                # - min_dry_weight_g -> measured_weight_g (repot form field)
                cur.execute(
                    """
                    UPDATE plants
                    SET
                        min_dry_weight_g = %s,
                        max_water_weight_g = %s
                    WHERE id = UNHEX(%s)
                    """,
                    (repotted_weight_g, 0, plant_id),
                )

                result = {
                    "id": bin_to_hex(new_id),
                    "plant_id": plant_id,
                    "measured_at": measured_at,
                    "measured_weight_g": measured_weight_g,
                    "last_wet_weight_g": repotted_weight_g,
                    "water_loss_total_g": loss_calc.water_loss_total_g,
                    "note": note,
                }
                return result
        finally:
            try:
                conn.close()
            except Exception:
                pass

    return await run_in_threadpool(do_insert)


@app.put("/plants/{plant_id}/repotting/{id_hex}", response_model=RepottingResponse)
async def update_repotting_event(
    plant_id: Annotated[str, Depends(require_plant_access)],
    id_hex: str,
    payload: RepottingUpdateRequest,
    get_conn_fn=Depends(get_conn_factory),
):
    required_fields = ["measured_at", "measured_weight_g", "last_wet_weight_g"]

    for field in required_fields:
        if getattr(payload, field, None) is None:
            raise HTTPException(status_code=400, detail="Missing required field: " + field)

    measured_at = payload.measured_at
    measured_weight_g = payload.measured_weight_g
    last_wet_weight_g = payload.last_wet_weight_g
    note = payload.note or ""

    local_dt = parse_timestamp_local(measured_at)

    def do_update():
        conn = get_conn_fn()
        try:
            with conn.cursor() as cursor:
                # Ownership check
                cursor.execute(
                    "SELECT plant_id FROM plants_measurements WHERE id=UNHEX(%s)", (id_hex,)
                )
                row = cursor.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Not found")

                db_plant_id = (
                    row[0].hex() if isinstance(row[0], (bytes, bytearray)) else str(row[0])
                )
                if db_plant_id.lower() != plant_id.lower():
                    raise HTTPException(status_code=404, detail="Not found")

                water_loss_total_g = None

                query = """
                        UPDATE plants_measurements
                        SET plant_id=UNHEX(%s), measured_at=%s, measured_weight_g=%s, last_wet_weight_g=%s, water_loss_total_g=%s, note=%s
                        WHERE id=UNHEX(%s)
                        """
                data = (
                    plant_id,
                    local_dt,
                    measured_weight_g,
                    last_wet_weight_g,
                    water_loss_total_g,
                    note,
                    id_hex,
                )
                cursor.execute(query, data)

                # Keep plant-level calculated fields consistent when a repotting event is edited.
                cursor.execute(
                    """
                    UPDATE plants
                    SET
                        min_dry_weight_g = %s,
                        max_water_weight_g = %s
                    WHERE id = UNHEX(%s)
                    """,
                    (last_wet_weight_g, 0, plant_id),
                )

                result = {
                    "id": id_hex,
                    "plant_id": plant_id,
                    "measured_at": measured_at,
                    "measured_weight_g": measured_weight_g,
                    "last_wet_weight_g": last_wet_weight_g,
                    "note": note,
                }
                return result
        finally:
            try:
                conn.close()
            except Exception:
                pass

    return await run_in_threadpool(do_update)
