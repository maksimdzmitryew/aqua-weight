import uuid
from datetime import datetime
from typing import Annotated, Any

import pymysql
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..db import HEX_RE
from ..security import get_db, require_authenticated_user
from ..schemas.location import (
    LocationCreateRequest,
    LocationListItem,
    LocationUpdateByNameRequest,
)

app = APIRouter()


@app.get("/locations", response_model=list[LocationListItem])
def list_locations(
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
) -> list[LocationListItem]:
    # Load real locations from the database but keep a simple integer id for UI purposes
    with db.cursor() as cur:
        # Prefer sort_order, then newest first, then name for stable listing
        if current_user["global_role"] == "admin":
            cur.execute(
                "SELECT id, name, description, created_at FROM locations ORDER BY sort_order ASC, created_at DESC, name ASC"
            )
        else:
            cur.execute(
                """
                SELECT l.id, l.name, l.description, l.created_at
                FROM locations l
                JOIN user_location_acl acl ON l.id = acl.location_id
                WHERE acl.user_id = %s
                ORDER BY l.sort_order ASC, l.created_at DESC, l.name ASC
                """,
                (current_user["id"],),
            )
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
            results.append(
                LocationListItem(
                    id=idx,
                    uuid=uuid_hex,
                    name=name,
                    description=description,
                    created_at=created_at,
                )
            )
        return results


class LocationCreate(BaseModel):
    name: str
    description: str | None = None
    sort_order: int = 0


@app.post("/locations", response_model=dict)
def create_location(
    payload: LocationCreateRequest,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
):
    # Normalize name: trim and collapse spaces
    def normalize(s: str) -> str:
        return " ".join((s or "").split())

    name = normalize(payload.name)
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    try:
        db.autocommit(False)
        with db.cursor() as cur:
            # Check duplicate
            cur.execute("SELECT 1 FROM locations WHERE name=%s LIMIT 1", (name,))
            if cur.fetchone():
                raise pymysql.err.IntegrityError(1062, "Duplicate entry")
            new_id = uuid.uuid4().bytes
            cur.execute(
                "INSERT INTO locations (id, name, description, sort_order) VALUES (%s, %s, %s, %s)",
                (new_id, name, payload.description, int(payload.sort_order or 0)),
            )
            # Grant ownership mapping to the creator
            cur.execute(
                "INSERT INTO user_location_acl (user_id, location_id, role) VALUES (%s, %s, 'owner')",
                (current_user["id"], new_id),
            )
            # Return created_at
            cur.execute("SELECT created_at FROM locations WHERE id=%s LIMIT 1", (new_id,))
            row = cur.fetchone()
            created_at = row[0] if row else datetime.utcnow()
            db.commit()
            return {"ok": True, "name": name, "created_at": created_at}
    except pymysql.err.IntegrityError as e:
        db.rollback()
        if e.args[0] == 1062:
            raise HTTPException(status_code=409, detail="Location name already exists")
        raise
    except Exception:
        db.rollback()
        raise


class LocationUpdateByName(BaseModel):
    original_name: str
    name: str


@app.put("/locations/by-name", response_model=dict)
def update_location_by_name(
    payload: LocationUpdateByNameRequest,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
):
    # Normalize names: trim and collapse internal whitespace
    def normalize(s: str) -> str:
        return " ".join((s or "").split())

    new_name = normalize(payload.name)
    orig_name = normalize(payload.original_name)

    if not new_name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    try:
        db.autocommit(False)
        with db.cursor() as cur:
            # Look up rows for original and new names (normalized)
            cur.execute("SELECT id FROM locations WHERE name=%s LIMIT 1", (orig_name,))
            orig_row = cur.fetchone()
            cur.execute("SELECT id FROM locations WHERE name=%s LIMIT 1", (new_name,))
            new_row = cur.fetchone()

            if orig_row:
                # ACL Check: Only owner or admin can update existing location
                if current_user["global_role"] != "admin":
                    cur.execute(
                        "SELECT role FROM user_location_acl WHERE user_id = %s AND location_id = %s",
                        (current_user["id"], orig_row[0]),
                    )
                    acl_row = cur.fetchone()
                    if not acl_row or acl_row[0] != "owner":
                        raise HTTPException(
                            status_code=403,
                            detail="Owner privileges required to update location",
                        )

                # If the new name resolves to the same row (per DB collation), treat as no-op
                if new_row and new_row == orig_row:
                    db.commit()
                    return {"ok": True, "rows_affected": 0, "name": new_name, "created": False}
                # If the new name is used by a different row, it's a conflict
                if new_row and new_row != orig_row:
                    raise pymysql.err.IntegrityError(1062, "Duplicate entry")
                # Otherwise safe to update the existing row by original name
                cur.execute(
                    "UPDATE locations SET name=%s WHERE name=%s",
                    (new_name, orig_name),
                )
                db.commit()
                return {"ok": True, "rows_affected": cur.rowcount, "name": new_name, "created": False}
            else:
                # Original name not found, trying to create new
                if new_row:
                    # Can't create because new name already exists
                    raise pymysql.err.IntegrityError(1062, "Duplicate entry")
                # Insert new row with the new (normalized) name
                new_id = uuid.uuid4().bytes  # 16 bytes for BINARY(16)
                cur.execute(
                    "INSERT INTO locations (id, name) VALUES (%s, %s)",
                    (new_id, new_name),
                )
                # Grant ownership mapping to the creator
                cur.execute(
                    "INSERT INTO user_location_acl (user_id, location_id, role) VALUES (%s, %s, 'owner')",
                    (current_user["id"], new_id),
                )
                db.commit()
                return {"ok": True, "rows_affected": 1, "name": new_name, "created": True}
    except pymysql.err.IntegrityError as e:
        db.rollback()
        if e.args[0] == 1062:
            raise HTTPException(status_code=409, detail="Location name already exists")
        raise
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@app.delete("/locations/{id_hex}")
def delete_location(
    id_hex: str,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
):
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid id")

    try:
        db.autocommit(False)
        with db.cursor() as cur:
            # ACL Check: Only owner or admin can delete location
            if current_user["global_role"] != "admin":
                cur.execute(
                    "SELECT role FROM user_location_acl WHERE user_id = %s AND location_id = UNHEX(%s)",
                    (current_user["id"], id_hex),
                )
                acl_row = cur.fetchone()
                if not acl_row or acl_row[0] != "owner":
                    raise HTTPException(
                        status_code=403,
                        detail="Owner privileges required to delete location",
                    )

            # Check for any plants assigned to this location (regardless of archive status)
            cur.execute("SELECT COUNT(*) FROM plants WHERE location_id=UNHEX(%s)", (id_hex,))
            count = cur.fetchone()[0]
            if count and count > 0:
                raise HTTPException(
                    status_code=409, detail="Cannot delete location: it has plants assigned"
                )
            # Proceed to delete
            cur.execute("DELETE FROM locations WHERE id=UNHEX(%s)", (id_hex,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Location not found")
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    return {"ok": True}


class ReorderPayload(BaseModel):
    ordered_ids: list[str]


@app.put("/locations/order")
def reorder_locations(
    payload: ReorderPayload,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
):
    if not payload.ordered_ids:
        raise HTTPException(status_code=400, detail="ordered_ids cannot be empty")

    try:
        db.autocommit(False)
        with db.cursor() as cur:
            # Access Check: Ensure user has access to all locations being reordered if not admin
            if current_user["global_role"] != "admin":
                placeholders = ",".join(["UNHEX(%s)"] * len(payload.ordered_ids))
                cur.execute(
                    f"SELECT COUNT(*) FROM user_location_acl WHERE user_id = %s AND location_id IN ({placeholders})",
                    (current_user["id"], *payload.ordered_ids),
                )
                count = cur.fetchone()[0]
                if count != len(payload.ordered_ids):
                    raise HTTPException(
                        status_code=403, detail="Access to some locations denied"
                    )

            # Verification: Ensure all IDs exist in locations table
            placeholders = ",".join(["UNHEX(%s)"] * len(payload.ordered_ids))
            cur.execute(
                f"SELECT COUNT(*) FROM locations WHERE id IN ({placeholders})",
                payload.ordered_ids,
            )
            count = cur.fetchone()[0]
            if count != len(payload.ordered_ids):
                raise HTTPException(status_code=400, detail="Some ids do not exist")

            # Perform reordering
            for idx, hex_id in enumerate(payload.ordered_ids, start=1):
                cur.execute(
                    "UPDATE locations SET sort_order=%s WHERE id=UNHEX(%s)", (idx, hex_id)
                )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    return {"ok": True}
