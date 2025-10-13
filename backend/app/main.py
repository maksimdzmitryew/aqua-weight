from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from datetime import datetime
from starlette.concurrency import run_in_threadpool
import os
import pymysql
import uuid
import re

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
    species: str | None = None
    location: str | None = None
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
async def list_plants() -> list[Plant]:
    # Load real plants from the database but keep a simple integer id for UI purposes
    def fetch_plants():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # Prefer sort_order then name for stable listing; exclude archived plants
                cur.execute(
                    """
                    SELECT p.id, p.name, p.species_name, COALESCE(l.name, NULL) AS location_name, p.created_at
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
                    # row = (id, name, species_name, location_name, created_at)
                    pid = row[0]
                    name = row[1]
                    species_name = row[2]
                    location_name = row[3]
                    created_at = row[4] or now
                    uuid_hex = pid.hex() if isinstance(pid, (bytes, bytearray)) else None
                    results.append(Plant(id=idx, uuid=uuid_hex, name=name, species=species_name, location=location_name, created_at=created_at))
                return results
        finally:
            conn.close()

    return await run_in_threadpool(fetch_plants)


class Location(BaseModel):
    id: int  # synthetic sequential id for UI
    uuid: str | None = None  # stable DB id (hex)
    name: str
    type: str | None = None
    created_at: datetime


@app.get("/locations")
async def list_locations() -> list[Location]:
    # Load real locations from the database but keep a simple integer id for UI purposes
    def fetch_locations():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # Prefer sort_order, then newest first, then name for stable listing
                cur.execute("SELECT id, name, created_at FROM locations ORDER BY sort_order ASC, created_at DESC, name ASC")
                rows = cur.fetchall() or []
                results: list[Location] = []
                now = datetime.utcnow()
                for idx, row in enumerate(rows, start=1):
                    # row = (id, name, created_at)
                    lid = row[0]
                    name = row[1]
                    created_at = row[2] or now
                    uuid_hex = lid.hex() if isinstance(lid, (bytes, bytearray)) else None
                    results.append(Location(id=idx, uuid=uuid_hex, name=name, type=None, created_at=created_at))
                return results
        finally:
            conn.close()

    return await run_in_threadpool(fetch_locations)


class LocationCreate(BaseModel):
    name: str
    description: str | None = None
    sort_order: int = 0


@app.post("/locations")
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
    name: str
    description: str | None = None
    species_name: str | None = None
    botanical_name: str | None = None
    cultivar: str | None = None
    location: str | None = None  # free text; we'll map to location_id if exists
    sort_order: int = 0
    photo_url: str | None = None
    fertilizer_ec_ms: float | None = Field(default=None, ge=0)


@app.post("/plants")
async def create_plant(payload: PlantCreate):
    def normalize(s: str) -> str:
        return " ".join((s or "").split())

    name = normalize(payload.name)
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    def do_insert():
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                # Resolve location_id by name if provided
                location_id = None
                loc_name = normalize(payload.location) if payload.location else None
                if loc_name:
                    cur.execute("SELECT id FROM locations WHERE name=%s LIMIT 1", (loc_name,))
                    row = cur.fetchone()
                    if row:
                        location_id = row[0]
                new_id = uuid.uuid4().bytes
                cur.execute(
                    (
                        "INSERT INTO plants (id, name, description, species_name, botanical_name, cultivar, sort_order, location_id, photo_url, fertilizer_ec_ms) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                    ),
                    (
                        new_id,
                        name,
                        payload.description,
                        payload.species_name,
                        payload.botanical_name,
                        payload.cultivar,
                        int(payload.sort_order or 0),
                        location_id,
                        payload.photo_url,
                        payload.fertilizer_ec_ms,
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
async def reorder_locations(payload: ReorderPayload):
    await run_in_threadpool(_validate_and_update_order, "locations", payload.ordered_ids)
    return {"ok": True}


@app.put("/plants/order")
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
