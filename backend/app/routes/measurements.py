from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime
from starlette.concurrency import run_in_threadpool
import re
import uuid
from ..utils.db_utils import get_db_connection
from ..helpers.watering import get_last_watering_event
from ..helpers.water_loss import calculate_water_loss
from ..helpers.last_plant_event import LastPlantEvent

app = APIRouter()


HEX_RE = re.compile(r"^[0-9a-fA-F]{32}$")


class MeasurementCreate(BaseModel):
    plant_id: str
    measured_at: str
    measured_weight_g: int | None = None
    method_id: str | None = None
    use_last_method: bool = False
    scale_id: str | None = None
    note: str | None = None
    # Optional fields for watering/repotting flows
    last_dry_weight_g: int | None = None
    last_wet_weight_g: int | None = None
    water_added_g: int | None = None


class MeasurementUpdate(BaseModel):
    measured_at: str | None = None
    measured_weight_g: int | None = None
    last_dry_weight_g: int | None = None
    last_wet_weight_g: int | None = None
    water_added_g: int | None = None
    method_id: str | None = None
    use_last_method: bool | None = None
    scale_id: str | None = None
    note: str | None = None


def _hex_to_bytes(h: str | None):
    if not h:
        return None
    hs = (h or "").strip().lower()
    if re.fullmatch(r"[0-9a-f]{32}", hs):
        try:
            return bytes.fromhex(hs)
        except Exception:
            return None
    return None


def _to_dt_string(s: str | None):
    if not s:
        return None
    return s.strip().replace("T", " ")


@app.get("/api/measurements/last")
async def get_last_measurement(plant_id: str):
    if not HEX_RE.match(plant_id or ""):
        raise HTTPException(status_code=400, detail="Invalid plant_id")

    def do_fetch():
        conn = get_db_connection()
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
                def to_hex(b):
                    return b.hex() if isinstance(b, (bytes, bytearray)) else None
                return {
                    "measured_at": row[0].isoformat(sep=" ", timespec="seconds") if row[0] else None,
                    "measured_weight_g": row[1],
                    "last_dry_weight_g": row[2],
                    "last_wet_weight_g": row[3],
                    "water_added_g": row[4],
                    "method_id": to_hex(row[5]),
                    "scale_id": to_hex(row[6]),
                    "note": row[7],
                }
        finally:
            conn.close()

    return await run_in_threadpool(do_fetch)


@app.get("/api/plants/{id_hex}/measurements")
async def list_measurements_for_plant(id_hex: str):
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid plant id")

    def do_fetch():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    (
                        """
                    SELECT id, measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g,
                           water_loss_total_pct, water_loss_total_g, water_loss_day_pct, water_loss_day_g
                    FROM plants_measurements
                    WHERE plant_id=UNHEX(%s)
                    ORDER BY measured_at DESC
                    """
                    ),
                    (id_hex,),
                )
                rows = cur.fetchall() or []
                results = []
                for r in rows:
                    _id = r[0]
                    results.append({
                        "id": _id.hex() if isinstance(_id, (bytes, bytearray)) else None,
                        "measured_at": r[1].isoformat(sep=" ", timespec="seconds") if r[1] else None,
                        "measured_weight_g": r[2],
                        "last_dry_weight_g": r[3],
                        "last_wet_weight_g": r[4],
                        "water_added_g": r[5],
                        "water_loss_total_pct": float(r[6]) if r[6] is not None else None,
                        "water_loss_total_g": r[7],
                        "water_loss_day_pct": float(r[8]) if r[8] is not None else None,
                        "water_loss_day_g": r[9],
                    })
                return results
        finally:
            conn.close()

    return await run_in_threadpool(do_fetch)


@app.post("/api/measurements/watering")
@app.post("/api/measurements/weight")
async def create_measurement(payload: MeasurementCreate):
    if not HEX_RE.match(payload.plant_id or ""):
        raise HTTPException(status_code=400, detail="Invalid plant_id")

    # Normalize inputs
    measured_at = _to_dt_string(payload.measured_at) or datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    mw = payload.measured_weight_g
    ld = payload.last_dry_weight_g
    lw = payload.last_wet_weight_g
    payload_water_added = payload.water_added_g

    def do_insert():
        conn = get_db_connection()
        try:
            with (conn.cursor() as cur):
                # Use the helper to get last watering event for water_added_g reference
                last_watering_event = get_last_watering_event(cur, payload.plant_id)
                last_watering_water_added = last_watering_event["water_added_g"] if last_watering_event else 0

                # Fetch previous last record for this plant using the helper class
                last_plant_event = LastPlantEvent.get_last_event(payload.plant_id)
                if last_plant_event:
                    prev_measured_weight = last_plant_event["measured_weight_g"]
                    prev_last_dry = last_plant_event["last_dry_weight_g"]
                    prev_last_wet = last_plant_event["last_wet_weight_g"]
                else:
                    prev_measured_weight, prev_last_dry, prev_last_wet = None, None, None

                # For A flow: copy previous last_* if not provided
                if ld is None:
                    if prev_measured_weight is None:
                        ld_local = prev_last_dry
                    else:
                        ld_local = prev_measured_weight
                else:
                    ld_local = ld

                if lw is None:
                    if prev_last_wet is None and ld_local is not None:
                        lw_local = ld_local + last_watering_water_added
                    else:
                        lw_local = prev_last_wet
                else:
                    lw_local = lw

                # Determine water_added_g to use
                if payload_water_added is not None and int(payload_water_added) > 0:
                    # Explicitly provided (watering or repotting event)
                    wa_local = int(payload_water_added)
                else:
                    # Use from last watering event for calculations
                    wa_local = lw_local - ld_local if payload.measured_weight_g is None else last_watering_water_added

                # Determine effective water_added_g
                # Watering event
                if payload.measured_weight_g is None:
                    if lw is not None and int(lw) > 0:
                        # calculate added water if wet weight is provided
                        wa_local = lw_local - ld_local
                    else:
                        if payload_water_added is not None and int(payload_water_added) > 0 and ld_local is not None and int(ld_local) > 0:
                            wa_local = payload_water_added
                            # calculate wet weight if not provided
                            lw_local = payload_water_added + ld_local
                # Measurement event
                else:
                    # Use from last watering event for calculations
                    wa_local = last_watering_water_added

                # Calculate water loss using helper
                loss_calc = calculate_water_loss(
                    cursor=cur,
                    plant_id_hex=payload.plant_id,
                    measured_at=measured_at,
                    measured_weight_g=mw,
                    last_wet_weight_g=lw_local,
                    water_added_g=payload_water_added,
                    last_watering_water_added=last_watering_water_added,
                    prev_measured_weight=prev_measured_weight,
                    exclude_measurement_id=None
                )

                # For watering events, measured_weight_g must be NULL
                mw_insert = None if loss_calc.is_watering_event else mw

                # Store the water_added_g value
                wa_insert = int(wa_local) if wa_local else 0

                new_id = uuid.uuid4().bytes
                cur.execute(
                    (
                        "INSERT INTO plants_measurements (id, plant_id, measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g, water_loss_total_pct, water_loss_total_g, water_loss_day_pct, water_loss_day_g, method_id, use_last_method, scale_id, note) "
                        "VALUES (%s, UNHEX(%s), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                    ),
                    (
                        new_id,
                        payload.plant_id,
                        measured_at,
                        mw_insert,
                        ld_local,
                        lw_local,
                        wa_insert,
                        loss_calc.water_loss_total_pct,
                        loss_calc.water_loss_total_g,
                        loss_calc.water_loss_day_pct,
                        loss_calc.water_loss_day_g,
                        _hex_to_bytes(payload.method_id),
                        1 if payload.use_last_method else 0,
                        _hex_to_bytes(payload.scale_id),
                        (payload.note or None),
                    ),
                )

                return {
                    "status": "success",
                    "data": {
                        "id": new_id.hex(),
                        "water_loss_total_pct": loss_calc.water_loss_total_pct
                    },
                    "meta": {
                        "timestamp": measured_at,
                        "version": "1.0"
                    }
                }
        finally:
            conn.close()

    return await run_in_threadpool(do_insert)


@app.put("/api/measurements/watering/{id_hex}")
@app.put("/api/measurements/weight/{id_hex}")
async def update_measurement(id_hex: str, payload: MeasurementUpdate):
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid id")

    def do_update():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # Fetch existing row to determine plant and previous measurement
                cur.execute(
                    "SELECT plant_id, measured_at FROM plants_measurements WHERE id=UNHEX(%s) LIMIT 1",
                    (id_hex,)
                )
                base = cur.fetchone()
                if not base:
                    raise HTTPException(status_code=404, detail="Not found")
                plant_id_bytes = base[0]
                current_measured_at = base[1]
                plant_hex = plant_id_bytes.hex() if isinstance(plant_id_bytes, (bytes, bytearray)) else None

                # Use the helper to get last watering event for water_added_g reference
                last_watering_event = get_last_watering_event(cur, plant_hex)
                last_watering_water_added = last_watering_event["water_added_g"] if last_watering_event else 0

                # Normalize incoming values
                measured_at = _to_dt_string(payload.measured_at) if payload.measured_at is not None else None
                mw = payload.measured_weight_g if payload.measured_weight_g is not None else None
                ld = payload.last_dry_weight_g if payload.last_dry_weight_g is not None else None
                lw = payload.last_wet_weight_g if payload.last_wet_weight_g is not None else None
                wa = payload.water_added_g if payload.water_added_g is not None else None

                # Use DB current values if some fields not provided
                cur.execute(
                    "SELECT measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g FROM plants_measurements WHERE id=UNHEX(%s)",
                    (id_hex,)
                )
                curr_vals = cur.fetchone()
                curr_mw = curr_vals[0] if curr_vals else None
                curr_ld = curr_vals[1] if curr_vals else None
                curr_lw = curr_vals[2] if curr_vals else None
                curr_wa = curr_vals[3] if curr_vals else 0

                mw_eff = mw if mw is not None else curr_mw
                lw_eff = lw if lw is not None else curr_lw
                ld_eff = ld if ld is not None else curr_ld
                wa_eff_payload = wa if wa is not None else curr_wa
                # Determine effective measured_at
                measured_at_eff = measured_at if measured_at is not None else current_measured_at

                # Determine effective water_added_g
                # Watering event
                if payload.measured_weight_g is None:
                    if lw is not None and int(lw) > 0:
                        # calculate added water if wet weight is provided
                        wa_eff = lw_eff - ld_eff
                    else:
                        if wa is not None and int(wa) > 0 and ld_eff is not None and int(ld_eff) > 0:
                            wa_eff = wa
                            # calculate wet weight if not provided
                            lw_eff = wa + ld_eff
                # Measurement event
                else:
                    # Use from last watering event for calculations
                    wa_eff = last_watering_water_added

                # Determine previous measurement (by time) for day loss calc
                prev_row = None
                if plant_hex:
                    cur.execute(
                        (
                            """
                        SELECT measured_weight_g
                        FROM plants_measurements
                        WHERE plant_id = UNHEX(%s)
                          AND id <> UNHEX(%s)
                          AND measured_at < %s
                        ORDER BY measured_at DESC LIMIT 1
                        """
                        ),
                        (plant_hex, id_hex, measured_at_eff)
                    )
                    prev_row = cur.fetchone()
                prev_measured_weight = prev_row[0] if prev_row else None

                # Calculate water loss using helper
                loss_calc = calculate_water_loss(
                    cursor=cur,
                    plant_id_hex=plant_hex,
                    measured_at=measured_at_eff,
                    measured_weight_g=mw_eff,
                    last_wet_weight_g=lw_eff,
                    water_added_g=wa_eff_payload,
                    last_watering_water_added=last_watering_water_added,
                    prev_measured_weight=prev_measured_weight,
                    exclude_measurement_id=id_hex
                )

                # For watering events, measured_weight_g must be NULL
                mw_update = None if loss_calc.is_watering_event else (mw if payload.measured_weight_g is not None else curr_mw)

                # Determine water_added_g to store
                wa_update = int(wa_eff) if wa_eff else 0

                sql = (
                    "UPDATE plants_measurements SET measured_at=COALESCE(%s, measured_at), measured_weight_g=%s, last_dry_weight_g=%s, last_wet_weight_g=%s, water_added_g=%s, "
                    "water_loss_total_pct=%s, water_loss_total_g=%s, water_loss_day_pct=%s, water_loss_day_g=%s, method_id=%s, use_last_method=COALESCE(%s, use_last_method), scale_id=%s, note=%s WHERE id=UNHEX(%s)"
                )
                params = (
                    (measured_at if measured_at is not None else None),
                    mw_update,
                    ld_eff,
                    lw_eff,
                    wa_update,
                    loss_calc.water_loss_total_pct,
                    loss_calc.water_loss_total_g,
                    loss_calc.water_loss_day_pct,
                    loss_calc.water_loss_day_g,
                    _hex_to_bytes(payload.method_id) if payload.method_id is not None else None,
                    (1 if payload.use_last_method else 0) if payload.use_last_method is not None else None,
                    _hex_to_bytes(payload.scale_id) if payload.scale_id is not None else None,
                    (payload.note if payload.note is not None else None),
                    id_hex,
                )
                cur.execute(sql, params)

                return {
                    "status": "success",
                    "data": {
                        "id": id_hex,
                        "water_loss_total_pct": loss_calc.water_loss_total_pct
                    },
                    "meta": {
                        "timestamp": measured_at,
                        "version": "1.0"
                    }
                }

        finally:
            conn.close()

    return await run_in_threadpool(do_update)


@app.get("/api/measurements/{id_hex}")
async def get_measurement(id_hex: str):
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid id")

    def do_fetch():
        conn = get_db_connection()
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
                    (id_hex,)
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Not found")
                def to_hex(b):
                    return b.hex() if isinstance(b, (bytes, bytearray)) else None
                return {
                    "id": to_hex(row[0]),
                    "plant_id": to_hex(row[1]),
                    "measured_at": row[2].isoformat(sep=" ", timespec="seconds") if row[2] else None,
                    "measured_weight_g": row[3],
                    "last_dry_weight_g": row[4],
                    "last_wet_weight_g": row[5],
                    "water_added_g": row[6],
                    "water_loss_total_pct": float(row[7]) if row[7] is not None else None,
                    "water_loss_total_g": row[8],
                    "water_loss_day_pct": float(row[9]) if row[9] is not None else None,
                    "water_loss_day_g": row[10],
                    "method_id": to_hex(row[11]),
                    "use_last_method": bool(row[12]) if row[12] is not None else False,
                    "scale_id": to_hex(row[13]),
                    "note": row[14],
                }
        finally:
            conn.close()

    return await run_in_threadpool(do_fetch)


@app.delete("/api/measurements/{id_hex}")
async def delete_measurement(id_hex: str):
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid id")

    def do_delete():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM plants_measurements WHERE id=UNHEX(%s)", (id_hex,))
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Not found")
        finally:
            conn.close()

    await run_in_threadpool(do_delete)
    return {"ok": True}
