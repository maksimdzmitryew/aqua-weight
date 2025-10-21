from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import json
import datetime
from pytz import timezone
from starlette.concurrency import run_in_threadpool
import uuid
import re
from app.helpers.watering import get_last_watering_event
from app.helpers.water_loss import calculate_water_loss
from app.utils.db_utils import get_db_connection, return_db_connection  # Import from new utility module

app = APIRouter()

HEX_RE = re.compile(r"^[0-9a-fA-F]{32}$")

class RepottingCreate(BaseModel):
    plant_id: str
    measured_at: str
    measured_weight_g: int | None = None
    last_wet_weight_g: int | None = None

class RepottingUpdate(BaseModel):
    measured_at: str | None = None
    measured_weight_g: int | None = None
    last_wet_weight_g: int | None = None

@app.post("/api/measurements/repotting")
async def create_repotting_event(payload: RepottingCreate):
    required_fields = ["plant_id", "measured_at", "measured_weight_g", "last_wet_weight_g"]

    for field in required_fields:
        if not getattr(payload, field):
            raise HTTPException(status_code=400, detail="Missing required field: " + field)

    plant_id = payload.plant_id
    measured_at = payload.measured_at
    measured_weight_g = payload.measured_weight_g
    last_wet_weight_g = payload.last_wet_weight_g
    #note = payload.note if not None else None

    diff_weight = measured_weight_g - last_wet_weight_g
    new_dry = measured_weight_g + diff_weight

    if not HEX_RE.match(plant_id or ""):
        raise HTTPException(status_code=400, detail="Invalid plant_id")

    # Convert measured_at from string to datetime object in UTC, then convert to local timezone
    utc_tz = datetime.timezone.utc
    dt_object = datetime.datetime.fromisoformat(measured_at).replace(tzinfo=utc_tz)
    local_dt = dt_object.astimezone(tz=timezone("US/Eastern"))

    conn = get_db_connection()

    def do_insert():
        try:
            last_watering_event = get_last_watering_event(conn.cursor(), plant_id)
            last_watering_water_added=last_watering_event["water_added_g"]
            prev_measured_weight=last_watering_event["measured_weight_g"]

            # Calculate water loss using helper
            loss_calc = calculate_water_loss(
                cursor=conn.cursor(),
                plant_id_hex=plant_id,
                measured_at=local_dt,
                measured_weight_g=measured_weight_g,
                last_wet_weight_g=last_wet_weight_g,
                water_added_g=None,
                last_watering_water_added=last_watering_water_added,
                prev_measured_weight=prev_measured_weight,
                exclude_measurement_id=None
            )

            new_id = uuid.uuid4().bytes

            with conn.cursor() as cur:

                cur.execute(
                    (
                        "INSERT INTO plants_measurements (id, plant_id, measured_at, measured_weight_g, last_wet_weight_g) "
                        "VALUES (%s, UNHEX(%s), %s, %s, %s)"
                    ),
                    (
                        new_id,
                        plant_id,
                        measured_at,
                        measured_weight_g,
                        last_wet_weight_g,
                    ),
                )


                # new_id = uuid.uuid4().bytes
                # cur.execute(
                #     (
                #         "INSERT INTO plants_measurements (id, plant_id, measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g) "
                #         "VALUES (%s, UNHEX(%s), %s, %s, %s, %s)"
                #     ),
                #     (
                #         new_id,
                #         plant_id,
                #         measured_at,
                #         measured_weight_g,
                #         new_dry,
                #         last_wet_weight_g,
                #     ),
                # )

                result = {
                    "id": cur.lastrowid,
                    "plant_id": plant_id,
                    "measured_at": measured_at,
                    "measured_weight_g": measured_weight_g,
                    "last_wet_weight_g": last_wet_weight_g,
                        "water_loss_total_g": loss_calc.water_loss_total_g,
#                    "note": note
                }
                return result
        finally:
            return_db_connection(conn)  # Return the connection to the pool

    return await run_in_threadpool(do_insert)

@app.put("/api/measurements/repotting/{id_hex}")
async def update_repotting_event(id_hex: int, payload: dict):
    required_fields = ["plant_id", "measured_at", "measured_weight_g", "last_wet_weight_g"]

    for field in required_fields:
        if not payload.get(field):
            raise HTTPException(status_code=400, detail="Missing required field: " + field)

    plant_id = payload["plant_id"]
    measured_at = payload["measured_at"]
    measured_weight_g = payload.get("measured_weight_g", None)
    last_wet_weight_g = payload.get("last_wet_weight_g", None)
    note = payload.get("note", "")

    # Convert measured_at from string to datetime object in UTC, then convert to local timezone
    utc_tz = datetime.timezone.utc
    dt_object = datetime.datetime.fromisoformat(measured_at).replace(tzinfo=utc_tz)
    local_dt = dt_object.astimezone(tz=timezone("US/Eastern"))

    conn = get_db_connection()
    try:
        last_watering_event = get_last_watering_event(conn, plant_id)
        water_loss = calculate_water_loss(conn, plant_id, local_dt, measured_weight_g, last_wet_weight_g, last_watering_event)

        cursor = conn.cursor()
        query = """
                UPDATE repotting_events
                SET plant_id=%s, measured_at=%s, measured_weight_g=%s, last_wet_weight_g=%s, water_loss_total_g=%s, note=%s
                WHERE id=%s \
                """
        data = (plant_id, local_dt, measured_weight_g, last_wet_weight_g, water_loss.water_loss_total_g, note, id_hex)
        cursor.execute(query, data)
        conn.commit()

        result = {
            "id": id_hex,
            "plant_id": plant_id,
            "measured_at": measured_at,
            "measured_weight_g": measured_weight_g,
            "last_wet_weight_g": last_wet_weight_g,
            "water_loss_total_g": water_loss.water_loss_total_g,
            "note": note
        }
        return result
    finally:
        return_db_connection(conn)  # Return the connection to the pool