import re
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Cookie, Depends, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from ..db import bin_to_hex, get_conn, hex_to_bin
from ..helpers.plants_list import PlantsList
from ..schemas.plant import (
    PaginatedPlantsResponse,
    PlantCreateRequest,
    PlantDetail,
    PlantUpdateRequest,
    ReferenceItem,
)
from ..security import (
    get_db,
    require_authenticated_user,
    require_plant_access,
    require_plant_owner,
    verify_location_access,
    verify_plant_access,
)
from ..services.auth_service import generate_ulid_bytes
from ..utils.settings_defaults import parse_default_threshold

app = APIRouter()


@app.get("/substrate-types", response_model=list[ReferenceItem])
async def list_substrate_types():
    def fetch():
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id, name FROM substrate_types ORDER BY sort_order, name")
                return [{"uuid": r[0].hex(), "name": r[1]} for r in cur.fetchall()]
        finally:
            conn.close()

    return await run_in_threadpool(fetch)


@app.get("/light-levels", response_model=list[ReferenceItem])
async def list_light_levels():
    def fetch():
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id, name FROM light_levels ORDER BY sort_order, name")
                return [{"uuid": r[0].hex(), "name": r[1]} for r in cur.fetchall()]
        finally:
            conn.close()

    return await run_in_threadpool(fetch)


@app.get("/pest-statuses", response_model=list[ReferenceItem])
async def list_pest_statuses():
    def fetch():
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id, name FROM pest_statuses ORDER BY sort_order, name")
                return [{"uuid": r[0].hex(), "name": r[1]} for r in cur.fetchall()]
        finally:
            conn.close()

    return await run_in_threadpool(fetch)


@app.get("/health-statuses", response_model=list[ReferenceItem])
async def list_health_statuses():
    def fetch():
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id, name FROM health_statuses ORDER BY sort_order, name")
                return [{"uuid": r[0].hex(), "name": r[1]} for r in cur.fetchall()]
        finally:
            conn.close()

    return await run_in_threadpool(fetch)


@app.get("/scales", response_model=list[ReferenceItem])
async def list_scales():
    def fetch():
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id, name FROM scales ORDER BY sort_order, name")
                return [{"uuid": r[0].hex(), "name": r[1]} for r in cur.fetchall()]
        finally:
            conn.close()

    return await run_in_threadpool(fetch)


@app.get("/measurement-methods", response_model=list[ReferenceItem])
async def list_measurement_methods():
    def fetch():
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id, name FROM measurement_methods ORDER BY sort_order, name")
                return [{"uuid": r[0].hex(), "name": r[1]} for r in cur.fetchall()]
        finally:
            conn.close()

    return await run_in_threadpool(fetch)


class PlantNameItem(BaseModel):
    """Minimal plant data for dropdowns - only uuid and name."""

    uuid: str
    name: str


@app.get("/plants/names", response_model=list[PlantNameItem])
async def list_plant_names(
    current_user: Annotated[dict, Depends(require_authenticated_user)],
) -> list[PlantNameItem]:
    """
    Fetch only uuid and name for all active plants the user has access to.
    Used for dropdowns to minimize data transfer and prevent DDoS via large payloads.
    Returns all active plants without pagination.
    """

    def fetch():
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                if current_user["global_role"] == "admin":
                    query = """
                        SELECT p.id, p.name
                        FROM plants p
                        WHERE p.archive = 0
                        ORDER BY p.sort_order ASC, p.created_at DESC, p.name ASC
                    """
                    params = ()
                else:
                    query = """
                        SELECT p.id, p.name
                        FROM plants p
                        WHERE p.archive = 0
                        AND (
                            p.owner_id = %s
                            OR p.location_id IN (
                                SELECT location_id FROM user_location_acl WHERE user_id = %s
                            )
                        )
                        ORDER BY p.sort_order ASC, p.created_at DESC, p.name ASC
                    """
                    params = (current_user["id"], current_user["id"])

                cur.execute(query, params)
                rows = cur.fetchall() or []

                results = []
                for row in rows:
                    plant_id = row[0]
                    name = row[1]
                    uuid_hex = bin_to_hex(plant_id) if plant_id else None
                    if uuid_hex and name:
                        results.append(PlantNameItem(uuid=uuid_hex, name=name))

                return results
        finally:
            try:
                conn.close()
            except Exception:
                pass

    return await run_in_threadpool(fetch)


@app.get("/plants", response_model=PaginatedPlantsResponse)
async def list_plants(
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    page: int = 1,
    limit: int = 20,
    search: str | None = None,
    status: str = "active",
    needs_weighing: bool | None = None,
    uuids: str | None = None,
    operationMode: str | None = None,  # Try query param first
    defaultThreshold: str | None = None,  # Try query param first
    operationModeCookie: str | None = Cookie(None, alias="operationMode"),
    defaultThresholdCookie: str | None = Cookie(None, alias="defaultThreshold"),
) -> PaginatedPlantsResponse:
    # Validate and sanitize pagination parameters
    if page < 1:
        raise HTTPException(status_code=400, detail="page must be >= 1")
    if limit < 1 or limit > 100:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 100")

    mode = operationMode or operationModeCookie or "manual"
    def_thr = parse_default_threshold(defaultThreshold or defaultThresholdCookie)
    offset = (page - 1) * limit

    uuid_list = [u.strip() for u in uuids.split(",")] if uuids else None

    def fetch():
        # Get filtered count for pagination
        total = PlantsList.count_all(
            search=search,
            status=status,
            needs_weighing_filter=needs_weighing,
            mode=mode,
            uuids=uuid_list,
            current_user=current_user,
        )

        # Get global count for drift detection (always without filters besides ACL)
        global_total = PlantsList.count_all(search=None, status="active", current_user=current_user)

        # Calculate total pages based on filtered count
        total_pages = (total + limit - 1) // limit if total > 0 else 0

        # Fetch paginated items
        items = PlantsList.fetch_all(
            mode=mode,
            default_threshold=def_thr,
            offset=offset,
            limit=limit,
            search=search,
            status=status,
            needs_weighing_filter=needs_weighing,
            uuids=uuid_list,
            current_user=current_user,
        )

        return PaginatedPlantsResponse(
            items=items,
            total=total,
            global_total=global_total,
            page=page,
            limit=limit,
            total_pages=total_pages,
        )

    return await run_in_threadpool(fetch)


class PlantCreate(BaseModel):
    # Minimum fields; all but name are optional
    # General
    name: str
    plant_type: str | None = None
    identify_hint: str | None = None
    typical_action: str | None = None
    description: str | None = None
    notes: str | None = None
    location_id: str | None = None
    photo_url: str | None = None
    # Service
    default_measurement_method_id: str | None = None
    # Care
    recommended_water_threshold_pct: int | None = None
    biomass_weight_g: int | None = None
    biomass_last_at: str | None = None
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
    # Calculated
    min_dry_weight_g: int | None = None
    max_water_weight_g: int | None = None


def get_location_owner_id(db: Any, location_id_hex: str) -> bytes | None:
    """Fetch the owner ID for a given location."""
    with db.cursor() as cur:
        cur.execute(
            "SELECT user_id FROM user_location_acl WHERE location_id = UNHEX(%s) AND role = 'owner' LIMIT 1",
            (location_id_hex,),
        )
        row = cur.fetchone()
        return row[0] if row else None


@app.get("/plants/uuids", response_model=list[str])
async def list_plant_uuids(
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    status: str = "active",
    needs_weighing: bool | None = None,
    needs_watering: bool | None = None,
    operationMode: str | None = None,  # Try query param first
    defaultThreshold: str | None = None,  # Try query param first
    operationModeCookie: str | None = Cookie(None, alias="operationMode"),
    defaultThresholdCookie: str | None = Cookie(None, alias="defaultThreshold"),
) -> list[str]:
    mode = operationMode or operationModeCookie or "manual"
    def_thr = parse_default_threshold(defaultThreshold or defaultThresholdCookie)

    def fetch():
        items = PlantsList.fetch_all(
            status=status,
            needs_weighing_filter=needs_weighing,
            mode=mode,
            default_threshold=def_thr,
            current_user=current_user,
        )

        if needs_watering is not None:

            def check_needs_water(p):
                if mode == "vacation":
                    return p["days_offset"] is not None and p["days_offset"] <= 0

                retained = p["water_retained_pct"]

                # If the plant was just watered (signature: water_loss_total_pct is 0),
                # it doesn't need water in manual/automatic mode.
                if p["water_loss_total_pct"] == 0 and (retained is None or retained > 0):
                    return False

                if retained is not None:
                    # Use default threshold if plant doesn't have one
                    thresh = p["recommended_water_threshold_pct"]
                    if thresh is None:
                        thresh = def_thr

                    return (thresh is not None and retained <= thresh) or p.get(
                        "needs_watering_prediction", False
                    )

                # If we have no weight data, and no approximation, we assume it needs attention
                # (weighing/watering) by default to avoid missing plants.
                if p["days_offset"] is not None:
                    return p["days_offset"] <= 0
                return True or p.get("needs_watering_prediction", False)

            items = [item for item in items if check_needs_water(item) == needs_watering]

        return [p["uuid"] for p in items]

    return await run_in_threadpool(fetch)


@app.post("/plants")
async def create_plant(
    payload: PlantCreateRequest,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
):
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

    async def do_insert():
        # Access Check: If location_id is provided, ensure user has access to it
        # and sync owner_id with the location owner.
        owner_id = current_user["id"]
        if payload.location_id:
            await verify_location_access(
                db,
                current_user["id"],
                current_user["global_role"],
                payload.location_id,
            )
            loc_owner = get_location_owner_id(db, payload.location_id)
            if loc_owner:
                owner_id = loc_owner

        loc_id_bin = hex_to_bytes(payload.location_id)
        conn = get_conn()
        try:
            conn.autocommit(False)
            with conn.cursor() as cur:
                new_id = generate_ulid_bytes()
                sql = """
                    INSERT INTO plants (
                        id, owner_id, name, plant_type, identify_hint, typical_action,
                        description, notes, location_id, photo_url,
                        default_measurement_method_id, scale_id, sort_order, repotted, archive,
                        recommended_water_threshold_pct, biomass_weight_g, biomass_last_at,
                        species_name, botanical_name, cultivar, substrate_type_id,
                        substrate_last_refresh_at, fertilized_last_at, fertilizer_ec_ms,
                        light_level_id, pest_status_id, health_status_id,
                        min_dry_weight_g, max_water_weight_g
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s,
                        %s, %s
                    )
                """
                params = (
                    new_id,
                    owner_id,
                    name,
                    (payload.plant_type or None),
                    (payload.identify_hint or None),
                    (payload.typical_action or None),
                    (payload.description or None),
                    (payload.notes or None),
                    loc_id_bin,
                    (payload.photo_url or None),
                    hex_to_bytes(payload.default_measurement_method_id),
                    hex_to_bytes(payload.scale_id),
                    (payload.sort_order or 0),
                    (payload.repotted or 0),
                    (payload.archive or 0),
                    payload.recommended_water_threshold_pct,
                    payload.biomass_weight_g,
                    to_dt(payload.biomass_last_at),
                    (payload.species_name or None),
                    (payload.botanical_name or None),
                    (payload.cultivar or None),
                    hex_to_bytes(payload.substrate_type_id),
                    to_dt(payload.substrate_last_refresh_at),
                    to_dt(payload.fertilized_last_at),
                    payload.fertilizer_ec_ms,
                    hex_to_bytes(payload.light_level_id),
                    hex_to_bytes(payload.pest_status_id),
                    hex_to_bytes(payload.health_status_id),
                    payload.min_dry_weight_g,
                    payload.max_water_weight_g,
                )
                cur.execute(sql, params)
                # Fetch created_at
                cur.execute("SELECT created_at FROM plants WHERE id=%s", (new_id,))
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

    return await do_insert()


# Reordering endpoints


@app.post("/plants/{id_hex}/duplicate")
async def duplicate_plant(
    id_hex: Annotated[str, Depends(require_plant_access)],
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
):
    def do_duplicate():
        conn = get_conn()
        try:
            conn.autocommit(False)
            with conn.cursor() as cur:
                pid_bin = hex_to_bin(id_hex)

                cur.execute(
                    """
                    SELECT
                        name, plant_type, identify_hint, typical_action,
                        description, notes, location_id,
                        default_measurement_method_id, scale_id, sort_order, archive,
                        recommended_water_threshold_pct,
                        species_name, botanical_name, cultivar, substrate_type_id,
                        fertilizer_ec_ms, light_level_id, pest_status_id, health_status_id
                    FROM plants
                    WHERE id = %s
                    """,
                    (pid_bin,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Plant not found")

                loc_id_bin = row[6]
                owner_id = current_user["id"]
                if loc_id_bin:
                    loc_owner = get_location_owner_id(db, loc_id_bin.hex())
                    if loc_owner:
                        owner_id = loc_owner

                new_name = f"{row[0]} copy"
                new_id = generate_ulid_bytes()

                sql = """
                    INSERT INTO plants (
                        id, owner_id, name, plant_type, identify_hint, typical_action,
                        description, notes, location_id, photo_url,
                        default_measurement_method_id, scale_id, sort_order, repotted, archive,
                        recommended_water_threshold_pct,
                        species_name, botanical_name, cultivar, substrate_type_id,
                        fertilizer_ec_ms, light_level_id, pest_status_id, health_status_id,
                        biomass_weight_g, biomass_last_at, substrate_last_refresh_at,
                        fertilized_last_at, min_dry_weight_g, max_water_weight_g
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s, %s, %s,
                        %s,
                        %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s
                    )
                """
                params = (
                    new_id,
                    owner_id,
                    new_name,
                    row[1],
                    row[2],
                    row[3],
                    row[4],
                    row[5],
                    row[6],
                    None,
                    row[7],
                    row[8],
                    row[9],
                    0,
                    row[10],
                    row[11],
                    row[12],
                    row[13],
                    row[14],
                    row[15],
                    row[16],
                    row[17],
                    row[18],
                    row[19],
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                )
                cur.execute(sql, params)
                conn.commit()
                return {"ok": True, "uuid": new_id.hex(), "name": new_name}
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            conn.close()

    return await run_in_threadpool(do_duplicate)


class ReorderPayload(BaseModel):
    ordered_ids: list[str]


def _validate_and_update_order(table: str, ids: list[str]):
    if not ids:
        raise HTTPException(status_code=400, detail="ordered_ids cannot be empty")

    conn = get_conn()
    try:
        conn.autocommit(False)
        with conn.cursor() as cur:
            placeholders = ",".join(["UNHEX(%s)"] * len(ids))
            cur.execute(f"SELECT COUNT(*) FROM {table} WHERE id IN ({placeholders})", ids)
            count = cur.fetchone()[0]
            if count != len(ids):
                raise HTTPException(status_code=400, detail="Some ids do not exist")
            for idx, hex_id in enumerate(ids, start=1):
                cur.execute(f"UPDATE {table} SET sort_order=%s WHERE id=UNHEX(%s)", (idx, hex_id))
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        conn.close()


@app.put("/plants/order")
async def reorder_plants(
    payload: ReorderPayload,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
):
    # Only reorder non-archived plants in the provided list
    async def do_update():
        conn = get_conn()
        try:
            conn.autocommit(False)
            with conn.cursor() as cur:
                if not payload.ordered_ids:
                    raise HTTPException(status_code=400, detail="ordered_ids cannot be empty")

                # Access Check: Ensure user has access to all plants being reordered
                # For reordering, we allow both owners and helpers.
                for hex_id in payload.ordered_ids:
                    await verify_plant_access(
                        db,
                        current_user["id"],
                        current_user["global_role"],
                        hex_id,
                    )

                placeholders = ",".join(["UNHEX(%s)"] * len(payload.ordered_ids))
                cur.execute(
                    f"SELECT COUNT(*) FROM plants WHERE archive=0 AND id IN ({placeholders})",
                    payload.ordered_ids,
                )
                count = cur.fetchone()[0]
                if count != len(payload.ordered_ids):
                    raise HTTPException(
                        status_code=400, detail="Some ids do not exist or are archived"
                    )
                for idx, hex_id in enumerate(payload.ordered_ids, start=1):
                    cur.execute("UPDATE plants SET sort_order=%s WHERE id=UNHEX(%s)", (idx, hex_id))
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            conn.close()

    await do_update()
    return {"ok": True}


@app.delete("/plants/{id_hex}")
async def delete_plant(
    id_hex: Annotated[str, Depends(require_plant_owner)],
    current_user: Annotated[dict, Depends(require_authenticated_user)],
):
    def do_delete():
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM plants WHERE id=UNHEX(%s)", (id_hex,))
                if cur.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Plant not found")
        finally:
            conn.close()

    await run_in_threadpool(do_delete)
    return {"ok": True}


@app.patch("/plants/{id_hex}")
async def update_plant(
    id_hex: Annotated[str, Depends(require_plant_owner)],
    payload: PlantUpdateRequest,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
):
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

    async def do_update():
        update_data = payload.model_dump(exclude_unset=True)
        if not update_data:
            return {"ok": True}

        # If moving plant, verify access to new location and update owner
        if "location_id" in update_data:
            if update_data["location_id"]:
                await verify_location_access(
                    db,
                    current_user["id"],
                    current_user["global_role"],
                    update_data["location_id"],
                )
                loc_owner = get_location_owner_id(db, update_data["location_id"])
                if loc_owner:
                    update_data["owner_id"] = loc_owner
            else:
                # If moved out of location, default back to current user as owner
                update_data["owner_id"] = current_user["id"]

        conn = get_conn()
        try:
            conn.autocommit(False)
            with conn.cursor() as cur:
                fields = []
                params = []

                hex_fields = {
                    "location_id",
                    "default_measurement_method_id",
                    "scale_id",
                    "substrate_type_id",
                    "light_level_id",
                    "pest_status_id",
                    "health_status_id",
                }
                dt_fields = {"biomass_last_at", "substrate_last_refresh_at", "fertilized_last_at"}

                for field, value in update_data.items():
                    if field == "name":
                        val = normalize(value) if value is not None else None
                    elif field in hex_fields:
                        val = hex_to_bytes(value)
                    elif field in dt_fields:
                        val = to_dt(value)
                    else:
                        val = value

                    fields.append(f"{field}=%s")
                    params.append(val)

                sql = f"UPDATE plants SET {', '.join(fields)} WHERE id=UNHEX(%s)"
                params.append(id_hex)
                cur.execute(sql, params)
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            conn.close()

    await do_update()
    return {"ok": True}


@app.get("/plants/{id_hex}", response_model=PlantDetail)
async def get_plant(
    id_hex: Annotated[str, Depends(require_plant_access)],
    current_user: Annotated[dict, Depends(require_authenticated_user)],
):
    def fetch_one():
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                pid_bin = hex_to_bin(id_hex)

                cur.execute(
                    """
                    SELECT
                        p.id, p.name, p.plant_type, p.identify_hint, p.typical_action,
                        p.description, p.notes, p.location_id, l.name AS location_name, p.photo_url,
                        p.default_measurement_method_id, p.scale_id, p.sort_order, p.repotted, p.archive,
                        p.recommended_water_threshold_pct, p.biomass_weight_g, p.biomass_last_at,
                        p.species_name, p.botanical_name, p.cultivar, p.substrate_type_id,
                        p.substrate_last_refresh_at, p.fertilized_last_at, p.fertilizer_ec_ms,
                        p.light_level_id, p.pest_status_id, p.health_status_id,
                        p.min_dry_weight_g, p.max_water_weight_g, p.created_at
                    FROM plants p
                    LEFT JOIN locations l ON l.id = p.location_id
                    WHERE p.id = %s
                    """,
                    (pid_bin,),
                )
                row = cur.fetchone()

                if not row:
                    raise HTTPException(status_code=404, detail="Plant not found")

                return PlantDetail(
                    id=1,
                    uuid=row[0].hex(),
                    name=row[1],
                    plant_type=row[2],
                    identify_hint=row[3],
                    typical_action=row[4],
                    description=row[5],
                    notes=row[6],
                    location_id=row[7].hex() if row[7] else None,
                    location=row[8],
                    photo_url=row[9],
                    default_measurement_method_id=row[10].hex() if row[10] else None,
                    scale_id=row[11].hex() if row[11] else None,
                    sort_order=row[12],
                    repotted=row[13],
                    archive=row[14],
                    recommended_water_threshold_pct=row[15],
                    biomass_weight_g=row[16],
                    biomass_last_at=row[17],
                    species_name=row[18],
                    botanical_name=row[19],
                    cultivar=row[20],
                    substrate_type_id=row[21].hex() if row[21] else None,
                    substrate_last_refresh_at=row[22],
                    fertilized_last_at=row[23],
                    fertilizer_ec_ms=float(row[24]) if row[24] is not None else None,
                    light_level_id=row[25].hex() if row[25] else None,
                    pest_status_id=row[26].hex() if row[26] else None,
                    health_status_id=row[27].hex() if row[27] else None,
                    min_dry_weight_g=row[28],
                    max_water_weight_g=row[29],
                    created_at=row[30] or datetime.utcnow(),
                )
        finally:
            conn.close()

    return await run_in_threadpool(fetch_one)


class PlantUpdate(BaseModel):
    # Extended fields from PlantCreate; all optional
    # General
    name: str | None = None
    plant_type: str | None = None
    identify_hint: str | None = None
    typical_action: str | None = None
    description: str | None = None
    notes: str | None = None
    location_id: str | None = None
    photo_url: str | None = None
    # Service
    default_measurement_method_id: str | None = None
    # Care
    recommended_water_threshold_pct: int | None = None
    biomass_weight_g: int | None = None
    biomass_last_at: str | None = None
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
    # Calculated
    min_dry_weight_g: str | None = None
    max_water_weight_g: str | None = None
