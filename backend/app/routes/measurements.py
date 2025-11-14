from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from datetime import datetime
from starlette.concurrency import run_in_threadpool
import re
import uuid
from ..db import get_conn, get_conn_factory, HEX_RE, hex_to_bin, bin_to_hex
from ..helpers.watering import get_last_watering_event
from ..helpers.water_loss import calculate_water_loss
from ..helpers.last_plant_event import LastPlantEvent
from ..helpers.water_weight import update_min_dry_weight_and_max_watering_added_g
from ..services.measurements import (
    parse_timestamp_local,
    ensure_exclusive_water_vs_weight,
    derive_weights,
    compute_water_losses,
)
from ..schemas.measurement import (
    MeasurementCreateRequest,
    MeasurementUpdateRequest,
    MeasurementItem,
    LastMeasurementResponse,
)

app = APIRouter()




def _to_dt_string(s: str | None):
    if not s:
        return None
    return s.strip().replace("T", " ")


@app.get("/measurements/last", response_model=LastMeasurementResponse | None)
async def get_last_measurement(plant_id: str, get_conn_fn = Depends(get_conn_factory)):
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
                    "measured_at": row[0].isoformat(sep=" ", timespec="seconds") if row[0] else None,
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


@app.get("/plants/{id_hex}/measurements", response_model=list[MeasurementItem])
async def list_measurements_for_plant(id_hex: str, get_conn_fn = Depends(get_conn_factory)):
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid plant id")

    def do_fetch():
        conn = get_conn_fn()
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
                        "id": bin_to_hex(_id),
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


@app.post("/measurements/watering")
@app.post("/measurements/weight")
async def create_measurement(payload: MeasurementCreateRequest, get_conn_fn = Depends(get_conn_factory)):
    if not HEX_RE.match(payload.plant_id or ""):
        raise HTTPException(status_code=400, detail="Invalid plant_id")

    # Normalize inputs using services
    try:
        ensure_exclusive_water_vs_weight(payload.measured_weight_g, payload.water_added_g)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Use deterministic milliseconds so multiple events at the same minute can be ordered
    measured_at_dt = parse_timestamp_local(payload.measured_at, fixed_milliseconds=0)
    measured_at = measured_at_dt  # pass timezone-naive local datetime directly to DB driver

    mw = payload.measured_weight_g
    ld = payload.last_dry_weight_g
    lw = payload.last_wet_weight_g
    payload_water_added = payload.water_added_g

    def do_insert():
        conn = get_conn_fn()
        try:
            conn.autocommit(False)
            with (conn.cursor() as cur):
                # Derive effective weights and water_added
                derived = derive_weights(
                    cursor=cur,
                    plant_id_hex=payload.plant_id,
                    measured_at_db=measured_at,
                    measured_weight_g=mw,
                    last_dry_weight_g=ld,
                    last_wet_weight_g=lw,
                    payload_water_added_g=payload_water_added,
                    exclude_measurement_id=None,
                )

                # Calculate water loss using shared service
                loss_calc = compute_water_losses(
                    cursor=cur,
                    plant_id_hex=payload.plant_id,
                    measured_at_db=measured_at,
                    measured_weight_g=mw,
                    derived=derived,
                    exclude_measurement_id=None,
                )

                ld_local = derived.last_dry_weight_g
                lw_local = derived.last_wet_weight_g
                wa_local = derived.water_added_g

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
                        hex_to_bin(payload.method_id),
                        1 if payload.use_last_method else 0,
                        hex_to_bin(payload.scale_id),
                        (payload.note or None),
                    ),
                )

                # If this is a weight measurement (not a watering event), update the min dry weight
                if not loss_calc.is_watering_event and mw_insert is not None:
                    # Update the plant's min_dry_weight_g if needed
                    update_min_dry_weight_and_max_watering_added_g(conn, payload.plant_id, mw_insert, None)

                # Commit transaction after all statements succeed
                conn.commit()

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
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            conn.close()

    return await run_in_threadpool(do_insert)


@app.put("/measurements/watering/{id_hex}")
@app.put("/measurements/weight/{id_hex}")
async def update_measurement(id_hex: str, payload: MeasurementUpdateRequest, get_conn_fn = Depends(get_conn_factory)):
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
                    (id_hex,)
                )
                base = cur.fetchone()
                if not base:
                    raise HTTPException(status_code=404, detail="Not found")
                plant_id_bytes = base[0]
                current_measured_at = base[1]
                current_mw, current_ld, current_lw, current_wa = base[2], base[3], base[4], base[5]
                plant_hex = plant_id_bytes.hex() if isinstance(plant_id_bytes, (bytes, bytearray)) else None

                # Validate exclusivity
                try:
                    ensure_exclusive_water_vs_weight(payload.measured_weight_g, payload.water_added_g)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))

                # Normalize incoming values
                measured_at = (
                    parse_timestamp_local(payload.measured_at, fixed_milliseconds=0)
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
                    (1 if payload.use_last_method else 0) if payload.use_last_method is not None else None,
                    hex_to_bin(payload.scale_id) if payload.scale_id is not None else None,
                    (payload.note if payload.note is not None else None),
                    id_hex,
                )
                cur.execute(sql, params)

                # If this is a weight measurement (not a watering event) and the weight has changed, update the min dry weight
                if not loss_calc.is_watering_event and (mw_update is not None or current_mw is not None):
                    # Calculate the effective new weight (use the updated one if provided, otherwise use the old one)
                    effective_new_weight = mw_update if mw_update is not None else current_mw
                    if effective_new_weight is not None:
                        update_min_dry_weight_and_max_watering_added_g(conn, plant_hex, effective_new_weight, None)

                conn.commit()

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


@app.get("/measurements/{id_hex}")
async def get_measurement(id_hex: str, get_conn_fn = Depends(get_conn_factory)):
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
                    (id_hex,)
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Not found")
                return {
                    "id": bin_to_hex(row[0]),
                    "plant_id": bin_to_hex(row[1]),
                    "measured_at": row[2].isoformat(sep=" ", timespec="seconds") if row[2] else None,
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


@app.delete("/measurements/{id_hex}")
async def delete_measurement(id_hex: str, get_conn_fn = Depends(get_conn_factory)):
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid id")

    def do_delete():
        conn = get_conn_fn()
        try:

            # First, get the measurement details to identify the plant
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT plant_id, measured_weight_g
                    FROM plants_measurements
                    WHERE id = UNHEX(%s)
                    """,
                    (id_hex,)
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Measurement not found")

                plant_id_hex = row[0].hex() if isinstance(row[0], bytes) else row[0]
                measured_weight_g = row[1]

            with conn.cursor() as cur:
                cur.execute("DELETE FROM plants_measurements WHERE id=UNHEX(%s)", (id_hex,))
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Not found")
                # Recalculate the minimum dry weight for the plant
                if measured_weight_g is not None:
                    update_min_dry_weight_and_max_watering_added_g(conn, plant_id_hex, measured_weight_g, None)

                conn.commit()

                return {"message": "Measurement deleted successfully"}
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise HTTPException(status_code=500, detail="Internal server error")

        finally:
            conn.close()

    await run_in_threadpool(do_delete)
    return {"ok": True}
