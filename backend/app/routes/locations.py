import uuid
from datetime import datetime

import pymysql
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from ..db import HEX_RE, get_conn
from ..schemas.location import (
    LocationCreateRequest,
    LocationListItem,
    LocationUpdateByNameRequest,
)

app = APIRouter()


@app.get("/locations", response_model=list[LocationListItem])
async def list_locations() -> list[LocationListItem]:
    # Load real locations from the database but keep a simple integer id for UI purposes
    def fetch_locations():
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                # Prefer sort_order, then newest first, then name for stable listing
                cur.execute("SELECT id, name, description, created_at FROM locations ORDER BY sort_order ASC, created_at DESC, name ASC")
                rows = cur.fetchall() or []
                results: list[LocationListItem] = []
                now = datetime.utcnow()
                for idx, row in enumerate(rows, start=1):
                    # row = (id, name, description, created_at)
                    lid = row[0]
                    name = row[1]
                    description = row[2]
                    created_at = row[3] or now
                    uuid_hex = lid.hex() if isinstance(lid, (bytes, bytearray)) else None
                    results.append(LocationListItem(id=idx, uuid=uuid_hex, name=name, description=description, created_at=created_at))
                return results
        finally:
            conn.close()

    return await run_in_threadpool(fetch_locations)


class LocationCreate(BaseModel):
    name: str
    description: str | None = None
    sort_order: int = 0


@app.post("/locations", response_model=dict)
async def create_location(payload: LocationCreateRequest):
    # Normalize name: trim and collapse spaces
    def normalize(s: str) -> str:
        return " ".join((s or "").split())

    name = normalize(payload.name)
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    def do_insert():
        conn = get_conn()
        try:
            conn.autocommit(False)
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
                conn.commit()
                return {"ok": True, "name": name, "created_at": created_at}
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
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


@app.put("/locations/by-name", response_model=dict)
async def update_location_by_name(payload: LocationUpdateByNameRequest):
    # Normalize names: trim and collapse internal whitespace
    def normalize(s: str) -> str:
        return " ".join((s or "").split())

    new_name = normalize(payload.name)
    orig_name = normalize(payload.original_name)

    if not new_name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    def do_update():
        conn = get_conn()
        try:
            conn.autocommit(False)
            with conn.cursor() as cur:
                # Look up rows for original and new names (normalized)
                cur.execute("SELECT id FROM locations WHERE name=%s LIMIT 1", (orig_name,))
                orig_row = cur.fetchone()
                cur.execute("SELECT id FROM locations WHERE name=%s LIMIT 1", (new_name,))
                new_row = cur.fetchone()

                if orig_row:
                    # If the new name resolves to the same row (per DB collation), treat as no-op
                    if new_row and new_row == orig_row:
                        conn.commit()
                        return 0, False
                    # If the new name is used by a different row, it's a conflict
                    if new_row and new_row != orig_row:
                        raise pymysql.err.IntegrityError(1062, "Duplicate entry")
                    # Otherwise safe to update the existing row by original name
                    cur.execute(
                        "UPDATE locations SET name=%s WHERE name=%s",
                        (new_name, orig_name),
                    )
                    conn.commit()
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
                    conn.commit()
                    return 1, True
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            conn.close()

    try:
        affected, created = await run_in_threadpool(do_update)
    except pymysql.err.IntegrityError:
        # Unique constraint violation on name
        raise HTTPException(status_code=409, detail="Location name already exists")

    return {"ok": True, "rows_affected": affected, "name": new_name, "created": created}




@app.delete("/locations/{id_hex}")
async def delete_location(id_hex: str):
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid id")

    def do_delete():
        conn = get_conn()
        try:
            conn.autocommit(False)
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
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            conn.close()

    await run_in_threadpool(do_delete)
    return {"ok": True}


class ReorderPayload(BaseModel):
    ordered_ids: list[str]


@app.put("/locations/order")
async def reorder_locations(payload: ReorderPayload):
    async def do_update():
        if not payload.ordered_ids:
            raise HTTPException(status_code=400, detail="ordered_ids cannot be empty")
        conn = get_conn()
        try:
            conn.autocommit(False)
            with conn.cursor() as cur:
                placeholders = ",".join(["UNHEX(%s)"] * len(payload.ordered_ids))
                cur.execute(f"SELECT COUNT(*) FROM locations WHERE id IN ({placeholders})", payload.ordered_ids)
                count = cur.fetchone()[0]
                if count != len(payload.ordered_ids):
                    raise HTTPException(status_code=400, detail="Some ids do not exist")
                for idx, hex_id in enumerate(payload.ordered_ids, start=1):
                    cur.execute("UPDATE locations SET sort_order=%s WHERE id=UNHEX(%s)", (idx, hex_id))
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            conn.close()
    await run_in_threadpool(lambda: None)  # ensure async context preserved
    await do_update()
    return {"ok": True}
