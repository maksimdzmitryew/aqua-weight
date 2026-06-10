import datetime
import types
import uuid as _uuid

import pytest
from httpx import AsyncClient
from fastapi import FastAPI

# Target module imports for monkeypatching
import backend.app.routes.repotting as repotting_mod
from backend.app.db.deps import get_conn_factory


VALID_HEX = "a" * 32
ISO_TIME = "2025-01-02T03:04:05"
_API_KEY = {"X-API-Key": "test_api_key_for_testing"}

# Session-scoped counter so IDs are unique across tests (avoids duplicate PRIMARY keys).
_uuid_counter = {"i": 0}


class DummyCursor:
    def __init__(self, store):
        self.store = store
        self.lastrowid = 123  # deterministic id
        self.executed = []
        self.store["cursor"] = self
        self._fetchone_result = None
        self._inserted_plant_id = None  # track plant_id from INSERTs

    def execute(self, query, params=None):
        # record the call for assertions
        self.executed.append((query, params))
        # store last call params for convenience
        self.store["last_execute"] = (query, params)
        q = query.lower() if isinstance(query, str) else ""
        # Track plant_id from INSERT INTO plants_measurements so we can
        # return it for the ownership SELECT during update tests.
        if "insert into plants_measurements" in q and params:
            # params layout: (id, plant_id_hex_or_bytes, ...)
            plant_id_val = params[1] if len(params) > 1 else None
            if isinstance(plant_id_val, str):
                # Hex string – convert to bytes for consistent fetchone
                self._inserted_plant_id = bytes.fromhex(plant_id_val)
            elif isinstance(plant_id_val, (bytes, bytearray)):
                self._inserted_plant_id = bytes(plant_id_val)
        # For SELECT plant_id FROM plants_measurements, return the last
        # inserted plant_id so the ownership check in update succeeds.
        if "select plant_id from plants_measurements" in q:
            if self._inserted_plant_id is not None:
                self._fetchone_result = (self._inserted_plant_id,)
            else:
                self._fetchone_result = (b"\x00" * 16,)
        elif "select" in q:
            self._fetchone_result = None
        else:
            self._fetchone_result = None

    def fetchone(self):
        return self._fetchone_result

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def close(self):
        pass


class DummyConn:
    def __init__(self, store):
        self.store = store
        self._cursor = DummyCursor(store)

    def cursor(self):
        return self._cursor

    def close(self):
        self.store["closed"] = True


@pytest.fixture()
def dummy_db(app: FastAPI):
    """Override get_conn_factory to return a dummy connection and collect executed queries."""
    store = {}
    conn = DummyConn(store)

    def _override():
        return lambda: conn

    app.dependency_overrides[get_conn_factory] = _override
    yield store
    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.fixture(autouse=True)
def patch_uuid(monkeypatch):
    """Make generate_ulid_bytes return unique deterministic IDs for each call.

    Uses a *module-level* counter so IDs are unique across tests in this module,
    avoiding duplicate PRIMARY keys when the DB is not cleaned between tests.
    """

    def _gen():
        _uuid_counter["i"] += 1
        return _uuid_counter["i"].to_bytes(16, "big")

    monkeypatch.setattr(repotting_mod, "generate_ulid_bytes", _gen)


@pytest.fixture(autouse=True)
async def _reset_db(async_client: AsyncClient):
    """Reset the test DB before each test to avoid cross-test contamination."""
    r = await async_client.post("/api/test/reset", headers=_API_KEY)
    assert r.status_code == 200


@pytest.fixture()
def patch_services(monkeypatch):
    """Patch external service/helpers used by the route to deterministic stubs."""
    # Last watering event
    monkeypatch.setattr(
        repotting_mod, "get_last_watering_event", lambda cur, pid: {"water_added_g": 50}
    )

    # Last plant event present by default
    def _last_event(_pid):
        return {
            "measured_weight_g": 900,
            "last_dry_weight_g": 800,
            "last_wet_weight_g": 1000,
            "water_added_g": 200,
        }

    monkeypatch.setattr(repotting_mod.LastPlantEvent, "get_last_event", staticmethod(_last_event))

    # compute_water_losses returns a simple object with required attrs
    class Loss:
        def __init__(self):
            self.water_loss_total_pct = 10.0
            self.water_loss_total_g = 100
            self.water_loss_day_pct = 1.0
            self.water_loss_day_g = 10

    monkeypatch.setattr(repotting_mod, "compute_water_losses", lambda **kwargs: Loss())

    # parse_timestamp_local just echo the same string for simplicity
    monkeypatch.setattr(
        repotting_mod, "parse_timestamp_local", lambda s, fixed_microseconds=None: s
    )


@pytest.mark.asyncio
async def test_create_repotting_happy_path(async_client: AsyncClient, dummy_db, patch_services):
    # First create a plant in the real DB so require_plant_access can find it
    plant_r = await async_client.post("/api/plants", headers=_API_KEY, json={"name": "RepotTest"})
    assert plant_r.status_code == 200
    plant_uid = plant_r.json().get("uuid")
    # If uuid not in response, find via list
    if not plant_uid:
        lr = await async_client.get("/api/plants", headers=_API_KEY)
        plant_uid = next(it["uuid"] for it in lr.json()["items"] if it["name"] == "RepotTest")

    payload = {
        "plant_id": plant_uid,
        "measured_at": ISO_TIME,
        "measured_weight_g": 880,
        "last_wet_weight_g": 1200,
        "note": "repotted to bigger pot",
    }

    resp = await async_client.post(
        f"/api/plants/{plant_uid}/repotting", headers=_API_KEY, json=payload
    )
    assert resp.status_code == 200
    data = resp.json()

    # Response contains these echoed fields
    assert data["plant_id"] == plant_uid
    assert data["measured_at"] == ISO_TIME
    assert data["measured_weight_g"] == 880
    assert data["last_wet_weight_g"] == 1200
    assert data.get("note") == "repotted to bigger pot"
    assert data.get("water_loss_total_g") == 100

    # Verify the plant still exists after repotting
    gr = await async_client.get(f"/api/plants/{plant_uid}", headers=_API_KEY)
    assert gr.status_code == 200


@pytest.mark.asyncio
async def test_create_repotting_invalid_plant_id(
    async_client: AsyncClient, dummy_db, patch_services, monkeypatch
):
    # First create a plant so require_plant_access finds it
    plant_r = await async_client.post(
        "/api/plants", headers=_API_KEY, json={"name": "RepotInvalidTest"}
    )
    assert plant_r.status_code == 200
    plant_uid = plant_r.json().get("uuid")
    if not plant_uid:
        lr = await async_client.get("/api/plants", headers=_API_KEY)
        plant_uid = next(
            it["uuid"] for it in lr.json()["items"] if it["name"] == "RepotInvalidTest"
        )

    # Pydantic enforces hex format; to hit the route's own HEX_RE check,
    # patch HEX_RE to a stricter pattern that rejects the valid hex.
    import re as _re

    monkeypatch.setattr(repotting_mod, "HEX_RE", _re.compile(r"^b{32}$"))

    bad_payload = {
        "plant_id": plant_uid,  # valid per schema but rejected by patched HEX_RE
        "measured_at": ISO_TIME,
        "measured_weight_g": 500,
        "last_wet_weight_g": 600,
    }
    resp = await async_client.post(
        f"/api/plants/{plant_uid}/repotting", headers=_API_KEY, json=bad_payload
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid plant_id"


@pytest.mark.asyncio
async def test_create_repotting_missing_required_due_to_zero(
    async_client: AsyncClient, dummy_db, patch_services
):
    # measured_weight_g=0 should be treated as missing by the route's falsy check
    payload = {
        "plant_id": VALID_HEX,
        "measured_at": ISO_TIME,
        "measured_weight_g": 0,
        "last_wet_weight_g": 600,
    }
    resp = await async_client.post(
        f"/api/plants/{VALID_HEX}/repotting", headers=_API_KEY, json=payload
    )
    assert resp.status_code == 400
    assert resp.json()["detail"].startswith("Missing required field:")


@pytest.mark.asyncio
async def test_create_repotting_no_last_event_404(
    async_client: AsyncClient, dummy_db, patch_services, monkeypatch
):
    # First create a plant so require_plant_access finds it
    plant_r = await async_client.post(
        "/api/plants", headers=_API_KEY, json={"name": "RepotNoEventTest"}
    )
    assert plant_r.status_code == 200
    plant_uid = plant_r.json().get("uuid")
    if not plant_uid:
        lr = await async_client.get("/api/plants", headers=_API_KEY)
        plant_uid = next(
            it["uuid"] for it in lr.json()["items"] if it["name"] == "RepotNoEventTest"
        )

    # Force LastPlantEvent.get_last_event to return None to trigger 404
    monkeypatch.setattr(
        repotting_mod.LastPlantEvent, "get_last_event", staticmethod(lambda _pid: None)
    )

    payload = {
        "plant_id": plant_uid,
        "measured_at": ISO_TIME,
        "measured_weight_g": 880,
        "last_wet_weight_g": 1200,
    }

    resp = await async_client.post(
        f"/api/plants/{plant_uid}/repotting", headers=_API_KEY, json=payload
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Last Plant event not found"


@pytest.mark.asyncio
async def test_update_repotting_happy_path(
    async_client: AsyncClient, dummy_db, patch_services, monkeypatch
):
    # First create a plant in the real DB so require_plant_access can find it
    plant_r = await async_client.post(
        "/api/plants", headers=_API_KEY, json={"name": "RepotUpdateTest"}
    )
    assert plant_r.status_code == 200
    plant_uid = plant_r.json().get("uuid")
    if not plant_uid:
        lr = await async_client.get("/api/plants", headers=_API_KEY)
        plant_uid = next(it["uuid"] for it in lr.json()["items"] if it["name"] == "RepotUpdateTest")

    # Create a repotting event first to get a valid measurement ID
    create_payload = {
        "plant_id": plant_uid,
        "measured_at": ISO_TIME,
        "measured_weight_g": 880,
        "last_wet_weight_g": 1200,
        "note": "initial repot",
    }
    create_resp = await async_client.post(
        f"/api/plants/{plant_uid}/repotting", headers=_API_KEY, json=create_payload
    )
    assert create_resp.status_code == 200
    meas_id = create_resp.json()["id"]

    # Now update the repotting event
    payload = {
        "plant_id": plant_uid,
        "measured_at": ISO_TIME,
        "measured_weight_g": 777,
        "last_wet_weight_g": 1500,
        "note": "ok",
    }

    resp = await async_client.put(
        f"/api/plants/{plant_uid}/repotting/{meas_id}", headers=_API_KEY, json=payload
    )
    assert resp.status_code == 200
    data = resp.json()

    assert data["plant_id"] == plant_uid
    assert data["measured_at"] == ISO_TIME
    assert data["measured_weight_g"] == 777
    assert data["last_wet_weight_g"] == 1500


@pytest.mark.asyncio
async def test_update_repotting_missing_required_field(async_client: AsyncClient, dummy_db):
    # First create a plant in the real DB so require_plant_access can find it
    plant_r = await async_client.post(
        "/api/plants", headers=_API_KEY, json={"name": "RepotMissingTest"}
    )
    assert plant_r.status_code == 200
    plant_uid = plant_r.json().get("uuid")
    if not plant_uid:
        lr = await async_client.get("/api/plants", headers=_API_KEY)
        plant_uid = next(
            it["uuid"] for it in lr.json()["items"] if it["name"] == "RepotMissingTest"
        )

    # Omitting last_wet_weight_g should trigger 400 due to explicit None check
    payload = {
        "plant_id": plant_uid,
        "measured_at": ISO_TIME,
        "measured_weight_g": 777,
        # "last_wet_weight_g": None  # implicit None by omission
    }
    resp = await async_client.put(
        f"/api/plants/{plant_uid}/repotting/{'2'*32}", headers=_API_KEY, json=payload
    )
    assert resp.status_code == 400
    assert resp.json()["detail"].startswith("Missing required field:")


def test_get_last_watering_event_wrapper_calls_underlying(monkeypatch):
    """Cover backend/app/routes/repotting.py line 23: ensure wrapper delegates to underlying helper."""
    called = {}

    def fake_underlying(cur, pid):
        called["args"] = (cur, pid)
        return {"ok": True, "pid": pid}

    # Patch the private imported helper and call the public wrapper
    monkeypatch.setattr(repotting_mod, "_get_last_watering_event", fake_underlying)

    cursor = object()
    pid = "abc123"
    res = repotting_mod.get_last_watering_event(cursor, pid)

    assert res == {"ok": True, "pid": pid}
    assert called["args"] == (cursor, pid)
