from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import json
import datetime
from pytz import timezone
from starlette.concurrency import run_in_threadpool
import uuid
import re
from ..helpers.watering import get_last_watering_event
from ..db import get_conn, HEX_RE
from ..services.measurements import parse_timestamp_local, compute_water_losses, DerivedWeights
from ..helpers.last_plant_event import LastPlantEvent
from ..schemas.measurement import RepottingCreateRequest, RepottingUpdateRequest, RepottingResponse

app = APIRouter()


@app.post("/measurements/repotting", response_model=RepottingResponse)
async def create_repotting_event(payload: RepottingCreateRequest):
    required_fields = ["plant_id", "measured_at", "measured_weight_g", "last_wet_weight_g"]

    for field in required_fields:
        if not getattr(payload, field):
            raise HTTPException(status_code=400, detail="Missing required field: " + field)

    plant_id = payload.plant_id
    measured_at = payload.measured_at
    measured_weight_g = payload.measured_weight_g
    repotted_weight_g = payload.last_wet_weight_g
    note = payload.note if not None else None

    if not HEX_RE.match(plant_id or ""):
        raise HTTPException(status_code=400, detail="Invalid plant_id")

    conn = get_conn()

    def do_insert():
        try:

            with conn.cursor() as cur:

                # Optionally retrieve last watering event if needed in future; not used in current logic

                # Fetch previous last record for this plant using the helper class
                last_plant_event = LastPlantEvent.get_last_event(payload.plant_id)
                if last_plant_event:
                    prev_measured_weight = last_plant_event["measured_weight_g"]
                    prev_last_dry = last_plant_event["last_dry_weight_g"]
                    prev_last_wet = last_plant_event["last_wet_weight_g"]
                    prev_last_water = last_plant_event["water_added_g"]
                else:
                    prev_measured_weight, prev_last_dry, prev_last_wet = None, None, None
                    raise HTTPException(status_code=404, detail="Last Plant event not found")

                # new_dry_weight = repotted_weight_g - last_watering_water_added
                measured_at_shift = parse_timestamp_local(measured_at, fixed_milliseconds=1)

                new_id = uuid.uuid4().bytes

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

                measured_at_shift = parse_timestamp_local(measured_at, fixed_milliseconds=2)

                new_id = uuid.uuid4().bytes

                cur.execute(
                    (
                        "INSERT INTO plants_measurements (id, plant_id, measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g, water_loss_total_pct, water_loss_total_g, water_loss_day_pct, water_loss_day_g, method_id, use_last_method, scale_id) "
                        "VALUES (%s, UNHEX(%s), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                    ),
                    (
                        new_id,
                        payload.plant_id,
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

                measured_at_shift = parse_timestamp_local(measured_at, fixed_milliseconds=3)
                new_measured_weight_g = repotted_weight_g - prev_last_water

                new_id = uuid.uuid4().bytes

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
                        None,
                        prev_last_water,
                        note
                    ),
                )

                result = {
                    "id": cur.lastrowid,
                    "plant_id": plant_id,
                    "measured_at": measured_at,
                    "measured_weight_g": measured_weight_g,
                    "last_wet_weight_g": repotted_weight_g,
#                    "water_loss_total_g": loss_calc.water_loss_total_g,
#                    "note": note
                }
                return result
        finally:
            try:
                conn.close()
            except Exception:
                pass

    return await run_in_threadpool(do_insert)

@app.put("/measurements/repotting/{id_hex}", response_model=RepottingResponse)
async def update_repotting_event(id_hex: str, payload: RepottingUpdateRequest):
    required_fields = ["plant_id", "measured_at", "measured_weight_g", "last_wet_weight_g"]

    for field in required_fields:
        if getattr(payload, field, None) is None:
            raise HTTPException(status_code=400, detail="Missing required field: " + field)

    plant_id = payload.__dict__.get("plant_id")  # RepottingUpdateRequest may not include plant_id per schema; ensure retrieved if present
    measured_at = payload.measured_at
    measured_weight_g = payload.measured_weight_g
    last_wet_weight_g = payload.last_wet_weight_g
    note = payload.note or ""

    # Convert measured_at from string to datetime object in UTC, then convert to local timezone
    utc_tz = datetime.timezone.utc
    dt_object = datetime.datetime.fromisoformat(measured_at).replace(tzinfo=utc_tz)
    local_dt = dt_object.astimezone(tz=timezone("US/Eastern"))

    conn = get_conn()
    try:
        with conn.cursor() as cursor:
            # Legacy table update retained
            water_loss_total_g = None

            query = """
                    UPDATE repotting_events
                    SET plant_id=%s, measured_at=%s, measured_weight_g=%s, last_wet_weight_g=%s, water_loss_total_g=%s, note=%s
                    WHERE id=%s
                    """
            data = (plant_id, local_dt, measured_weight_g, last_wet_weight_g, water_loss_total_g, note, id_hex)
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