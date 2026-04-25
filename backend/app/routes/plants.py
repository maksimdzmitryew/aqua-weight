import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Cookie, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from ..db import HEX_RE, bin_to_hex, get_conn, hex_to_bin
from ..helpers.plants_list import PlantsList
from ..schemas.plant import (
    PaginatedPlantsResponse,
    PlantCreateRequest,
    PlantDetail,
    PlantUpdateRequest,
    ReferenceItem,
)
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
async def list_plant_names() -> list[PlantNameItem]:
    """
    Fetch only uuid and name for all active plants.
    Used for dropdowns to minimize data transfer and prevent DDoS via large payloads.
    Returns all active plants without pagination.
    """

    def fetch():
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                query = """
                    SELECT p.id, p.name
                    FROM plants p
                    WHERE p.archive = 0
                    ORDER BY p.sort_order ASC, p.created_at DESC, p.name ASC
                """
                cur.execute(query)
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
    page: int = 1,
    limit: int = 20,
    search: str | None = None,
    operationMode: str | None = Cookie(None),
    defaultThreshold: str | None = Cookie(None),
) -> PaginatedPlantsResponse:
    # Validate and sanitize pagination parameters
    if page < 1:
        raise HTTPException(status_code=400, detail="page must be >= 1")
    if limit < 1 or limit > 100:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 100")

    mode = operationMode or "manual"
    def_thr = parse_default_threshold(defaultThreshold)
    offset = (page - 1) * limit

    def fetch():
        # Get filtered count for pagination
        total = PlantsList.count_all(search=search)

        # Get global count for drift detection (always without filters)
        global_total = PlantsList.count_all(search=None)

        # Calculate total pages based on filtered count
        total_pages = (total + limit - 1) // limit if total > 0 else 0

        # Fetch paginated items
        items = PlantsList.fetch_all(
            mode=mode, default_threshold=def_thr, offset=offset, limit=limit, search=search
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


@app.post("/plants")
async def create_plant(payload: PlantCreateRequest):
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
        conn = get_conn()
        try:
            conn.autocommit(False)
            with conn.cursor() as cur:
                new_id = uuid.uuid4().bytes
                sql = """
                    INSERT INTO plants (
                        id, name, plant_type, identify_hint, typical_action,
                        description, notes, location_id, photo_url,
                        default_measurement_method_id, scale_id, sort_order, repotted, archive,
                        recommended_water_threshold_pct, biomass_weight_g, biomass_last_at,
                        species_name, botanical_name, cultivar, substrate_type_id,
                        substrate_last_refresh_at, fertilized_last_at, fertilizer_ec_ms,
                        light_level_id, pest_status_id, health_status_id,
                        min_dry_weight_g, max_water_weight_g
                    ) VALUES (
                        %s, %s, %s, %s, %s,
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
                    name,
                    (payload.plant_type or None),
                    (payload.identify_hint or None),
                    (payload.typical_action or None),
                    (payload.description or None),
                    (payload.notes or None),
                    hex_to_bytes(payload.location_id),
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

    return await run_in_threadpool(do_insert)


# Reordering endpoints
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
async def reorder_plants(payload: ReorderPayload):
    # Only reorder non-archived plants in the provided list
    def do_update():
        conn = get_conn()
        try:
            conn.autocommit(False)
            with conn.cursor() as cur:
                if not payload.ordered_ids:
                    raise HTTPException(status_code=400, detail="ordered_ids cannot be empty")
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

    await run_in_threadpool(do_update)
    return {"ok": True}


@app.delete("/plants/{id_hex}")
async def delete_plant(id_hex: str):
    if not HEX_RE.match(id_hex or ""):
        raise HTTPException(status_code=400, detail="Invalid id")

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


@app.put("/plants/{id_hex}")
async def update_plant(id_hex: str, payload: PlantUpdateRequest):
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
        conn = get_conn()
        try:
            conn.autocommit(False)
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM plants WHERE id=UNHEX(%s) LIMIT 1", (id_hex,))
                exists = cur.fetchone()
                if not exists:
                    raise HTTPException(status_code=404, detail="Plant not found")

                sql = """
                    UPDATE plants SET
                        name=%s, plant_type=%s, identify_hint=%s, typical_action=%s,
                        description=%s, notes=%s, location_id=%s, photo_url=%s,
                        default_measurement_method_id=%s, scale_id=%s, sort_order=%s, repotted=%s, archive=%s,
                        recommended_water_threshold_pct=%s, biomass_weight_g=%s, biomass_last_at=%s,
                        species_name=%s, botanical_name=%s, cultivar=%s, substrate_type_id=%s,
                        substrate_last_refresh_at=%s, fertilized_last_at=%s, fertilizer_ec_ms=%s,
                        light_level_id=%s, pest_status_id=%s, health_status_id=%s,
                        min_dry_weight_g=%s, max_water_weight_g=%s
                    WHERE id=UNHEX(%s)
                """
                params = (
                    (normalize(payload.name) if payload.name is not None else None),
                    (payload.plant_type if payload.plant_type is not None else None),
                    (payload.identify_hint if payload.identify_hint is not None else None),
                    (payload.typical_action if payload.typical_action is not None else None),
                    (payload.description if payload.description is not None else None),
                    (payload.notes if payload.notes is not None else None),
                    hex_to_bytes(payload.location_id),
                    (payload.photo_url if payload.photo_url is not None else None),
                    hex_to_bytes(payload.default_measurement_method_id),
                    hex_to_bytes(payload.scale_id),
                    (payload.sort_order if payload.sort_order is not None else 0),
                    (payload.repotted if payload.repotted is not None else 0),
                    (payload.archive if payload.archive is not None else 0),
                    payload.recommended_water_threshold_pct,
                    payload.biomass_weight_g,
                    to_dt(payload.biomass_last_at),
                    (payload.species_name if payload.species_name is not None else None),
                    (payload.botanical_name if payload.botanical_name is not None else None),
                    (payload.cultivar if payload.cultivar is not None else None),
                    hex_to_bytes(payload.substrate_type_id),
                    to_dt(payload.substrate_last_refresh_at),
                    to_dt(payload.fertilized_last_at),
                    payload.fertilizer_ec_ms,
                    hex_to_bytes(payload.light_level_id),
                    hex_to_bytes(payload.pest_status_id),
                    hex_to_bytes(payload.health_status_id),
                    payload.min_dry_weight_g,
                    payload.max_water_weight_g,
                    id_hex,
                )
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

    await run_in_threadpool(do_update)
    return {"ok": True}


@app.get("/plants/{id_hex}")
async def get_plant(id_hex: str) -> PlantDetail:
    def fetch_one():
        if not HEX_RE.match(id_hex or ""):
            raise HTTPException(status_code=400, detail="Invalid plant id")
        conn = get_conn()
        try:
            with conn.cursor() as cur:
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
                    (hex_to_bin(id_hex),),
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
