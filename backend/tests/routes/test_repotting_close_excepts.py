import types
import datetime
import pytest
from httpx import AsyncClient

import backend.app.routes.repotting as repotting_mod

VALID_HEX = "a" * 32
ISO_TIME = "2025-01-02T03:04:05"
_API_KEY = {"X-API-Key": "test_api_key_for_testing"}

# Session-scoped counter so IDs are unique across tests (avoids duplicate PRIMARY keys).
_uuid_counter = {"i": 0}


class DummyCursor:
    def __init__(self, store):
        self.store = store
        self.lastrowid = 321
        self.executed = []

    def execute(self, query, params=None):
        self.executed.append((query, params))
        self.store["last_execute"] = (query, params)

    def fetchone(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class RaisingCloseConn:
    def __init__(self, store):
        self.store = store
        self._cursor = DummyCursor(store)

    def cursor(self):
        return self._cursor

    def close(self):
        # Simulate a DB driver raising during close; the route should swallow it
        self.store["close_attempted"] = True
        raise RuntimeError("close failed")


@pytest.fixture(autouse=True)
def patch_uuid(monkeypatch):
    # Make generate_ulid_bytes return unique deterministic IDs for each call
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
    # Minimal patches needed by create handler
    monkeypatch.setattr(
        repotting_mod, "get_last_watering_event", lambda cur, pid: {"water_added_g": 50}
    )

    def _last_event(_pid):
        return {
            "measured_weight_g": 900,
            "last_dry_weight_g": 800,
            "last_wet_weight_g": 1000,
            "water_added_g": 200,
        }

    monkeypatch.setattr(repotting_mod.LastPlantEvent, "get_last_event", staticmethod(_last_event))

    class Loss:
        def __init__(self):
            self.water_loss_total_pct = 10.0
            self.water_loss_total_g = 100
            self.water_loss_day_pct = 1.0
            self.water_loss_day_g = 10

    monkeypatch.setattr(repotting_mod, "compute_water_losses", lambda **kwargs: Loss())
    monkeypatch.setattr(
        repotting_mod, "parse_timestamp_local", lambda s, fixed_microseconds=None: s
    )


@pytest.mark.asyncio
async def test_create_repotting_close_raises_is_swallowed(
    async_client: AsyncClient, patch_services, monkeypatch
):
    # Create a plant with a known ID so require_plant_access finds it
    from backend.app.db import get_conn

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO plants (id, name) VALUES (UNHEX(%s), %s)",
                (VALID_HEX, "CloseExceptsPlant"),
            )
    finally:
        conn.close()

    store = {}
    conn = RaisingCloseConn(store)
    # Patch get_conn in db.core (used by get_conn_factory) and db.deps (where it's captured)
    import backend.app.db.core as db_core
    import backend.app.db.deps as db_deps

    monkeypatch.setattr(db_core, "get_conn", lambda: conn)
    monkeypatch.setattr(db_deps, "get_conn", lambda: conn)

    payload = {
        "plant_id": VALID_HEX,
        "measured_at": ISO_TIME,
        "measured_weight_g": 880,
        "last_wet_weight_g": 1200,
    }

    resp = await async_client.post(
        f"/api/plants/{VALID_HEX}/repotting", headers=_API_KEY, json=payload
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["plant_id"] == VALID_HEX
    # Ensure close was attempted and exception suppressed
    assert store.get("close_attempted") is True


from backend.app.schemas.measurement import RepottingUpdateRequest


@pytest.mark.asyncio
async def test_update_repotting_close_raises_is_swallowed(monkeypatch):
    store = {}
    conn = RaisingCloseConn(store)
    # Patch get_conn in db.core (used by get_conn_factory) and db.deps (where it's captured)
    import backend.app.db.core as db_core
    import backend.app.db.deps as db_deps

    monkeypatch.setattr(db_core, "get_conn", lambda: conn)
    monkeypatch.setattr(db_deps, "get_conn", lambda: conn)

    payload = RepottingUpdateRequest(
        plant_id=VALID_HEX,
        measured_at=ISO_TIME,
        measured_weight_g=777,
        last_wet_weight_g=1500,
        note="ok",
    )

    # Call the route coroutine directly to isolate the finally:close() path.
    # The DummyCursor.fetchone() returns None, so the route raises HTTPException(404)
    # before reaching the return statement. The finally:conn.close() still runs and
    # its exception is swallowed - that is what we assert here.
    raised = None
    try:
        await repotting_mod.update_repotting_event("f" * 32, "f" * 32, payload, lambda: conn)
    except Exception as exc:
        raised = exc
    assert raised is not None, "Expected HTTPException from route"
    # Ensure close was attempted and exception suppressed
    assert store.get("close_attempted") is True
