from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from datetime import datetime
from starlette.concurrency import run_in_threadpool
import os
import pymysql
import uuid
import re
from app.helpers.watering import get_last_watering_event
from app.helpers.water_loss import calculate_water_loss

app = FastAPI()

# Allow frontend served at https://aw.max
origins = [
    "https://aw.max",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db_connection():
    host = os.getenv("DB_HOST", "db")
    user = os.getenv("DB_USER", "appuser")
    password = os.getenv("DB_PASSWORD", "apppass")
    database = os.getenv("DB_NAME", "appdb")
    return pymysql.connect(host=host, user=user, password=password, database=database, autocommit=True)


class Plant(BaseModel):
    id: int  # synthetic sequential id for UI
    uuid: str | None = None  # stable DB id (hex) for mutations like reordering
    name: str
    description: str | None = None
    species: str | None = None
    location: str | None = None
    location_id: str | None = None
    created_at: datetime


@app.get("/")
async def root():
    return {"message": "Hello World"}


@app.get("/hello/{name}")
async def say_hello(name: str):
    return {"message": f"Hello {name}"}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/plants")
@app.get("/api/plants")
async def list_plants() -> list[Plant]:
    # Load real plants from the database but keep a simple integer id for UI purposes
    def fetch_plants():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # Prefer sort_order then name for stable listing; exclude archived plants
                cur.execute(
                    """
                    SELECT p.id, p.name, p.description, p.species_name, p.location_id, COALESCE(l.name, NULL) AS location_name, p.created_at
                    FROM plants p
                    LEFT JOIN locations l ON l.id = p.location_id
                    WHERE p.archive = 0
                    ORDER BY p.sort_order ASC, p.created_at DESC, p.name ASC
                    """
                )
                rows = cur.fetchall() or []
                results: list[Plant] = []
                now = datetime.utcnow()
                for idx, row in enumerate(rows, start=1):
                    # row = (id, name, description, species_name, location_id, location_name, created_at)
                    pid = row[0]
                    name = row[1]
                    description = row[2]
                    species_name = row[3]
                    location_id_bytes = row[4]
                    location_name = row[5]
                    created_at = row[6] or now
                    uuid_hex = pid.hex() if isinstance(pid, (bytes, bytearray)) else None
                    location_id_hex = location_id_bytes.hex() if isinstance(location_id_bytes, (bytes, bytearray)) else None
                    results.append(Plant(id=idx, uuid=uuid_hex, name=name, description=description, species=species_name, location=location_name, location_id=location_id_hex, created_at=created_at))
                return results
        finally:
            conn.close()

    return await run_in_threadpool(fetch_plants)


class Location(BaseModel):
    id: int  # synthetic sequential id for UI
    uuid: str | None = None  # stable DB id (hex)
    name: str
    description: str | None = None
    created_at: datetime


@app.get("/locations")
@app.get("/api/locations")
async def list_locations() -> list[Location]:
    # Load real locations from the database but keep a simple integer id for UI purposes
    def fetch_locations():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # Prefer sort_order, then newest first, then name for stable listing
                cur.execute("SELECT id, name, description, created_at FROM locations ORDER BY sort_order ASC, created_at DESC, name ASC")
                rows = cur.fetchall() or []
                results: list[Location] = []
                now = datetime.utcnow()
                for idx, row in enumerate(rows, start=1):
                    # row = (id, name, description, created_at)
                    lid = row[0]
                    name = row[1]
                    description = row[2]
                    created_at = row[3] or now
                    uuid_hex = lid.hex() if isinstance(lid, (bytes, bytearray)) else None
                    results.append(Location(id=idx, uuid=uuid_hex, name=name, description=description, created_at=created_at))
                return results
        finally:
            conn.close()

    return await run_in_threadpool(fetch_locations)


class LocationCreate(BaseModel):
    name: str
    description: str | None = None
    sort_order: int = 0


@app.post("/locations")
@app.post("/api/locations")
async def create_location(payload: LocationCreate):
    # Normalize name: trim and collapse spaces
    def normalize(s: str) -> str:
        return " ".join((s or "").split())

    name = normalize(payload.name)
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    def do_insert():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # Check duplicate
                cur.execute("SELECT 1 FROM locations WHERE name=%s LIMIT 1", (name,))
                if cur.fetchone():
                    raise pymysql.err.IntegrityError(1062, "Duplicate entry")
                new_id = uuid.uuid4().bytes
                cur.execute(
                    "INSERT INTO locations (id, name, description, sort_order) VALUES (%s, %s, %s, %s)",
                    (new_id, name, payload.description, int(payload.sort_order or 0)),
                )
                # Return created_at
                cur.execute("SELECT created_at FROM locations WHERE name=%s LIMIT 1", (name,))
                row = cur.fetchone()
                created_at = row[0] if row else datetime.utcnow()
                return {"ok": True, "name": name, "created_at": created_at}
        finally:
            conn.close()

    try:
        result = await run_in_threadpool(do_insert)
    except pymysql.err.IntegrityError:
        raise HTTPException(status_code=409, detail="Location name already exists")

    return result


class LocationUpdateByName(BaseModel):
    original_name: str
    name: str


@app.put("/locations/by-name")
@app.put("/api/locations/by-name")
async def update_location_by_name(payload: LocationUpdateByName):
    # Normalize names: trim and collapse internal whitespace
    def normalize(s: str) -> str:
        return " ".join((s or "").split())

    new_name = normalize(payload.name)
    orig_name = normalize(payload.original_name)

    if not new_name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    def do_update():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # Update only the name field; 'type' field is not present in DB schema.

                # Look up rows for original and new names (normalized)
                cur.execute("SELECT id FROM locations WHERE name=%s LIMIT 1", (orig_name,))
                orig_row = cur.fetchone()
                cur.execute("SELECT id FROM locations WHERE name=%s LIMIT 1", (new_name,))
                new_row = cur.fetchone()

                if orig_row:
                    # If the new name resolves to the same row (per DB collation), treat as no-op
                    if new_row and new_row == orig_row:
                        return 0, False
                    # If the new name is used by a different row, it's a conflict
                    if new_row and new_row != orig_row:
                        raise pymysql.err.IntegrityError(1062, "Duplicate entry")
                    # Otherwise safe to update the existing row by original name
                    cur.execute(
                        "UPDATE locations SET name=%s WHERE name=%s",
                        (new_name, orig_name),
                    )
                    return cur.rowcount, False
                else:
                    # Original name not found
                    if new_row:
                        # Can't create because new name already exists
                        raise pymysql.err.IntegrityError(1062, "Duplicate entry")
                    # Insert new row with the new (normalized) name
                    new_id = uuid.uuid4().bytes  # 16 bytes for BINARY(16)
                    cur.execute(
                        "INSERT INTO locations (id, name) VALUES (%s, %s)",
                        (new_id, new_name),
                    )
                    return 1, True
        finally:
            conn.close()

    try:
        affected, created = await run_in_threadpool(do_update)
    except pymysql.err.IntegrityError:
        # Unique constraint violation on name
        raise HTTPException(status_code=409, detail="Location name already exists")

    return {"ok": True, "rows_affected": affected, "name": new_name, "created": created}


class PlantCreate(BaseModel):
    # General
    name: str
    description: str | None = None
    location_id: str | None = None  # hex ULID/UUID-like 32 chars
    photo_url: str | None = None
    default_measurement_method_id: str | None = None
    # Advanced
    species_name: str | None = None
    botanical_name: str | None = None
    cultivar: str | None = None
    substrate_type_id: str | None = None
    substrate_last_refresh_at: str | None = None
    fertilized_last_at: str | None = None
    fertilizer_ec_ms: float | None = Field(default=None, ge=0)
    # Health
    light_level_id: str | None = None
    pest_status_id: str | None = None
    health_status_id: str | None = None


@app.post("/plants")
@app.post("/api/plants")
async def create_plant(payload: PlantCreate):
    def normalize(s: str) -> str:
        return " ".join((s or "").split())

    def hex_to_bytes(h: str | None):
        if not h:
            return None
        hs = (h or "").strip().lower()
        if re.fullmatch(r"[0-9a-f]{32}", hs):
            try:
                return bytes.fromhex(hs)
            except Exception:
                return None
        return None

    def to_dt(s: str | None):
        if not s:
            return None
        # Accept HTML datetime-local value like 'YYYY-MM-DDTHH:MM' or with seconds
        ss = s.strip().replace("T", " ")
        return ss

    name = normalize(payload.name)
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    def do_insert():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                new_id = uuid.uuid4().bytes
                cur.execute(
                    (
                        "INSERT INTO plants (id, name, description, species_name, botanical_name, cultivar, sort_order, location_id, substrate_type_id, substrate_last_refresh_at, light_level_id, fertilized_last_at, fertilizer_ec_ms, pest_status_id, health_status_id, photo_url, default_measurement_method_id) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                    ),
                    (
                        new_id,
                        name,
                        (payload.description or None),
                        (payload.species_name or None),
                        (payload.botanical_name or None),
                        (payload.cultivar or None),
                        0,
                        hex_to_bytes(payload.location_id),
                        hex_to_bytes(payload.substrate_type_id),
                        to_dt(payload.substrate_last_refresh_at),
                        hex_to_bytes(payload.light_level_id),
                        to_dt(payload.fertilized_last_at),
                        payload.fertilizer_ec_ms,
                        hex_to_bytes(payload.pest_status_id),
                        hex_to_bytes(payload.health_status_id),
                        (payload.photo_url or None),
                        hex_to_bytes(payload.default_measurement_method_id),
                    ),
                )
                # Fetch created_at
                cur.execute("SELECT created_at FROM plants WHERE id=%s", (new_id,))
                row = cur.fetchone()
                created_at = row[0] if row else datetime.utcnow()
                return {"ok": True, "name": name, "created_at": created_at}
        finally:
            conn.close()

    return await run_in_threadpool(do_insert)


# Reordering endpoints
class ReorderPayload(BaseModel):
    ordered_ids: list[str]


def _validate_and_update_order(table: str, ids: list[str]):
    if not ids:
        raise HTTPException(status_code=400, detail="ordered_ids cannot be empty")

    # Update in a single connection
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Validate all ids exist and count matches
            placeholders = ",".join(["UNHEX(%s)"] * len(ids))
            cur.execute(f"SELECT COUNT(*) FROM {table} WHERE id IN ({placeholders})", ids)
            count = cur.fetchone()[0]
            if count != len(ids):
                raise HTTPException(status_code=400, detail="Some ids do not exist")
            # Assign sequential sort_order starting at 1
            for idx, hex_id in enumerate(ids, start=1):
                cur.execute(f"UPDATE {table} SET sort_order=%s WHERE id=UNHEX(%s)", (idx, hex_id))
    finally:
        conn.close()


@app.put("/locations/order")
@app.put("/api/locations/order")
async def reorder_locations(payload: ReorderPayload):
    await run_in_threadpool(_validate_and_update_order, "locations", payload.ordered_ids)
    return {"ok": True}


@app.put("/plants/order")
@app.put("/api/plants/order")
async def reorder_plants(payload: ReorderPayload):
    # Only reorder non-archived plants in the provided list
    def do_update():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                if not payload.ordered_ids:
                    raise HTTPException(status_code=400, detail="ordered_ids cannot be empty")
                # Validate IDs exist and are not archived
                placeholders = ",".join(["UNHEX(%s)"] * len(payload.ordered_ids))
                cur.execute(f"SELECT COUNT(*) FROM plants WHERE archive=0 AND id IN ({placeholders})", payload.ordered_ids)
                count = cur.fetchone()[0]
                if count != len(payload.ordered_ids):
                    raise HTTPException(status_code=400, detail="Some ids do not exist or are archived")
                for idx, hex_id in enumerate(payload.ordered_ids, start=1):
                    cur.execute("UPDATE plants SET sort_order=%s WHERE id=UNHEX(%s)", (idx, hex_id))
        finally:
            conn.close()
    await run_in_threadpool(do_update)
    return {"ok": True}


HEX_RE = re.compile(r"^[0-9a-fA-F]{32}$")


@app.delete("/plants/{id_hex}")
@app.delete("/api/plants/{id_hex}")
async def delete_plant(id_hex: str):
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid id")

    def do_delete():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # Try delete and check affected rows
                cur.execute("DELETE FROM plants WHERE id=UNHEX(%s)", (id_hex,))
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Plant not found")
        finally:
            conn.close()

    await run_in_threadpool(do_delete)
    return {"ok": True}


@app.delete("/locations/{id_hex}")
@app.delete("/api/locations/{id_hex}")
async def delete_location(id_hex: str):
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid id")

    def do_delete():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # Check for any plants assigned to this location (regardless of archive status)
                cur.execute("SELECT COUNT(*) FROM plants WHERE location_id=UNHEX(%s)", (id_hex,))
                count = cur.fetchone()[0]
                if count and count > 0:
                    raise HTTPException(status_code=409, detail="Cannot delete location: it has plants assigned")
                # Proceed to delete
                cur.execute("DELETE FROM locations WHERE id=UNHEX(%s)", (id_hex,))
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Location not found")
        finally:
            conn.close()

    await run_in_threadpool(do_delete)
    return {"ok": True}


class PlantUpdate(BaseModel):
    # Same fields as create; all optional
    name: str | None = None
    description: str | None = None
    location_id: str | None = None
    photo_url: str | None = None
    default_measurement_method_id: str | None = None
    species_name: str | None = None
    botanical_name: str | None = None
    cultivar: str | None = None
    substrate_type_id: str | None = None
    substrate_last_refresh_at: str | None = None
    fertilized_last_at: str | None = None
    fertilizer_ec_ms: float | None = Field(default=None, ge=0)
    light_level_id: str | None = None
    pest_status_id: str | None = None
    health_status_id: str | None = None


@app.put("/plants/{id_hex}")
@app.put("/api/plants/{id_hex}")
async def update_plant(id_hex: str, payload: PlantUpdate):
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid id")

    def normalize(s: str) -> str:
        return " ".join((s or "").split())

    def hex_to_bytes(h: str | None):
        if not h:
            return None
        hs = (h or "").strip().lower()
        if re.fullmatch(r"[0-9a-f]{32}", hs):
            try:
                return bytes.fromhex(hs)
            except Exception:
                return None
        return None

    def to_dt(s: str | None):
        if not s:
            return None
        return s.strip().replace("T", " ")

    if payload.name is not None and not normalize(payload.name):
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    def do_update():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                sql = (
                    "UPDATE plants SET name=%s, description=%s, species_name=%s, botanical_name=%s, cultivar=%s, location_id=%s, substrate_type_id=%s, substrate_last_refresh_at=%s, light_level_id=%s, fertilized_last_at=%s, fertilizer_ec_ms=%s, pest_status_id=%s, health_status_id=%s, photo_url=%s, default_measurement_method_id=%s WHERE id=UNHEX(%s)"
                )
                params = (
                    (normalize(payload.name) if payload.name is not None else None),
                    (payload.description if payload.description is not None else None),
                    (payload.species_name if payload.species_name is not None else None),
                    (payload.botanical_name if payload.botanical_name is not None else None),
                    (payload.cultivar if payload.cultivar is not None else None),
                    hex_to_bytes(payload.location_id) if payload.location_id is not None else None,
                    hex_to_bytes(payload.substrate_type_id) if payload.substrate_type_id is not None else None,
                    to_dt(payload.substrate_last_refresh_at) if payload.substrate_last_refresh_at is not None else None,
                    hex_to_bytes(payload.light_level_id) if payload.light_level_id is not None else None,
                    to_dt(payload.fertilized_last_at) if payload.fertilized_last_at is not None else None,
                    payload.fertilizer_ec_ms if payload.fertilizer_ec_ms is not None else None,
                    hex_to_bytes(payload.pest_status_id) if payload.pest_status_id is not None else None,
                    hex_to_bytes(payload.health_status_id) if payload.health_status_id is not None else None,
                    (payload.photo_url if payload.photo_url is not None else None),
                    hex_to_bytes(payload.default_measurement_method_id) if payload.default_measurement_method_id is not None else None,
                    id_hex,
                )
                cur.execute(sql, params)
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Plant not found")
        finally:
            conn.close()

    await run_in_threadpool(do_update)
    return {"ok": True}


# Measurements API
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


# Measurement item endpoints
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
                    """
                    SELECT measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g, method_id, scale_id, note
                    FROM plants_measurements
                    WHERE plant_id=UNHEX(%s)
                    ORDER BY measured_at DESC
                    LIMIT 1
                    """,
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
                    """
                    SELECT id, measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g,
                           water_loss_total_pct, water_loss_total_g, water_loss_day_pct, water_loss_day_g
                    FROM plants_measurements
                    WHERE plant_id=UNHEX(%s)
                    ORDER BY measured_at DESC
                    """,
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


@app.post("/api/measurements")
async def create_measurement(payload: MeasurementCreate):
    if not HEX_RE.match(payload.plant_id or ""):
        raise HTTPException(status_code=400, detail="Invalid plant_id")

    # Normalize inputs
    measured_at = _to_dt_string(payload.measured_at) or datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    mw = payload.measured_weight_g
    ld = payload.last_dry_weight_g
    lw = payload.last_wet_weight_g
    wa = payload.water_added_g if payload.water_added_g is not None else 0

    def do_insert():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # Use the helper to get last watering event for water_added_g reference
                last_watering_event = get_last_watering_event(cur, payload.plant_id)
                last_watering_water_added = last_watering_event["water_added_g"] if last_watering_event else 0

                # Fetch previous last record for this plant (by measured_at)
                cur.execute(
                    """
                    SELECT measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g
                    FROM plants_measurements
                    WHERE plant_id = UNHEX(%s)
                    ORDER BY measured_at DESC LIMIT 1
                    """,
                    (payload.plant_id,),
                )
                prev = cur.fetchone()
                prev_measured_weight = prev[1] if prev else None
                prev_last_dry = prev[2] if prev else None
                prev_last_wet = prev[3] if prev else None

                # For A flow: copy previous last_* if not provided
                if ld is None:
                    ld_local = prev_last_dry
                else:
                    ld_local = ld
                if lw is None:
                    lw_local = prev_last_wet
                else:
                    lw_local = lw

                # Determine water_added_g to use
                if payload.water_added_g is not None and int(payload.water_added_g) > 0:
                    # Explicitly provided (watering or repotting event)
                    wa_local = int(payload.water_added_g)
                else:
                    # Use from last watering event for calculations
                    wa_local = lw_local - ld_local if payload.measured_weight_g is None else last_watering_water_added

                # Calculate water loss using helper
                loss_calc = calculate_water_loss(
                    cursor=cur,
                    plant_id_hex=payload.plant_id,
                    measured_at=measured_at,
                    measured_weight_g=mw,
                    last_wet_weight_g=lw_local,
                    water_added_g=payload.water_added_g,
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
                return {"ok": True}
        finally:
            conn.close()

    return await run_in_threadpool(do_insert)

@app.put("/api/measurements/{id_hex}")
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
                    if wa_eff_payload is not None and int(wa_eff_payload) > 0:
                        # Explicitly provided (watering or repotting event)
                        wa_eff = int(wa_eff_payload)
                    else:
                        # Use from last watering event for calculations
                        wa_eff = last_watering_water_added

                # Determine previous measurement (by time) for day loss calc
                prev_row = None
                if plant_hex:
                    cur.execute(
                        """
                        SELECT measured_weight_g
                        FROM plants_measurements
                        WHERE plant_id = UNHEX(%s)
                          AND id <> UNHEX(%s)
                          AND measured_at < %s
                        ORDER BY measured_at DESC LIMIT 1
                        """,
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
        finally:
            conn.close()

    await run_in_threadpool(do_update)
    return {"ok": True}

@app.get("/api/plants/{id_hex}")
async def get_plant(id_hex: str) -> Plant:
    def fetch_one():
        # Validate UUID hex (16 bytes = 32 hex chars)
        if not re.fullmatch(r"[0-9a-fA-F]{32}", id_hex or ""):
            raise HTTPException(status_code=400, detail="Invalid plant id")
        def hex_to_bytes(h: str | None):
            return bytes.fromhex(h) if h else None
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT p.id, p.name, p.description, p.species_name, p.location_id, COALESCE(l.name, NULL) AS location_name, p.created_at
                    FROM plants p
                    LEFT JOIN locations l ON l.id = p.location_id
                    WHERE p.id = %s
                    """,
                    (hex_to_bytes(id_hex),),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Plant not found")
                pid = row[0]
                name = row[1]
                description = row[2]
                species_name = row[3]
                location_id_bytes = row[4]
                location_name = row[5]
                created_at = row[6] or datetime.utcnow()
                uuid_hex = pid.hex() if isinstance(pid, (bytes, bytearray)) else None
                location_id_hex = location_id_bytes.hex() if isinstance(location_id_bytes, (bytes, bytearray)) else None
                # For a single item, keep id as 1 to avoid implying order; UI uses uuid
                return Plant(id=1, uuid=uuid_hex, name=name, description=description, species=species_name, location=location_name, location_id=location_id_hex, created_at=created_at)
        finally:
            conn.close()
    return await run_in_threadpool(fetch_one)


@app.get("/api/measurements/{id_hex}")
async def get_measurement(id_hex: str):
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid id")

    def do_fetch():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, plant_id, measured_at, measured_weight_g, last_dry_weight_g, last_wet_weight_g, water_added_g,
                           water_loss_total_pct, water_loss_total_g, water_loss_day_pct, water_loss_day_g, method_id, use_last_method, scale_id, note
                    FROM plants_measurements
                    WHERE id=UNHEX(%s)
                    LIMIT 1
                    """,
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


