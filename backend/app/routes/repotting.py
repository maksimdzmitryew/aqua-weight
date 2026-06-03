import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pytz import timezone
from starlette.concurrency import run_in_threadpool

from ..db import HEX_RE, bin_to_hex, get_conn, get_conn_factory
from ..helpers.last_plant_event import LastPlantEvent
from ..helpers.watering import get_last_watering_event as _get_last_watering_event
from ..schemas.measurement import (
    RepottingCreateRequest,
    RepottingResponse,
    RepottingUpdateRequest,
)
from ..security import get_db, require_plant_access
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
        if not getattr(payload, field):
            raise HTTPException(status_code=400, detail="Missing required field: " + field)

    measured_at = payload.measured_at
    measured_weight_g = payload.measured_weight_g
    repotted_weight_g = payload.last_wet_weight_g
    note = payload.note if payload.note is not None else None

    if not HEX_RE.match(plant_id or ""):
        raise HTTPException(status_code=400, detail="Invalid plant_id")

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
                        prev_last_water,
                    ),
                )

                # Calculate water loss using shared services
                derived = DerivedWeights(
                    last_dry_weight_g=prev_last_dry,
                    last_wet_weight_g=prev_last_wet,
                    water_added_g=prev_last_water or 0,
                    prev_measured_weight=prev_measured_weight,
                    last_watering_water_added=prev_last_water or 0,
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
                        prev_last_water,
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
                new_measured_weight_g = repotted_weight_g - (prev_last_water or 0)

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
                        prev_last_water,
                        note,
                    ),
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
                cursor.execute("SELECT plant_id FROM plants_measurements WHERE id=UNHEX(%s)", (id_hex,))
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
