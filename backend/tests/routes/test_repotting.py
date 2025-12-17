import datetime
import types
import uuid as _uuid

import pytest
from httpx import AsyncClient

# Target module imports for monkeypatching
import backend.app.routes.repotting as repotting_mod


VALID_HEX = "a" * 32
ISO_TIME = "2025-01-02T03:04:05"


class DummyCursor:
    def __init__(self, store):
        self.store = store
        self.lastrowid = 123  # deterministic id
        self.executed = []

    def execute(self, query, params=None):
        # record the call for assertions
        self.executed.append((query, params))
        # store last call params for convenience
        self.store["last_execute"] = (query, params)

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
def dummy_db(monkeypatch):
    """Patch get_conn to return a dummy connection and collect executed queries."""
    store = {}
    conn = DummyConn(store)
    monkeypatch.setattr(repotting_mod, "get_conn", lambda: conn)
    return store


@pytest.fixture(autouse=True)
def patch_uuid(monkeypatch):
    """Make uuid4 deterministic so number of INSERTs doesn't break tests."""
    class _FixedUUID:
        def __init__(self):
            self._i = 0
        def uuid4(self):
            self._i += 1
            # Return 16 zero bytes; value doesn't matter for the test
            return types.SimpleNamespace(bytes=b"\x00" * 16)
    fixed = _FixedUUID()
    monkeypatch.setattr(repotting_mod, "uuid", fixed)


@pytest.fixture()
def patch_services(monkeypatch):
    """Patch external service/helpers used by the route to deterministic stubs."""
    # Last watering event
    monkeypatch.setattr(repotting_mod, "get_last_watering_event", lambda cur, pid: {"water_added_g": 50})

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
    monkeypatch.setattr(repotting_mod, "parse_timestamp_local", lambda s, fixed_milliseconds=None: s)


@pytest.mark.asyncio
async def test_create_repotting_happy_path(async_client: AsyncClient, dummy_db, patch_services):
    payload = {
        "plant_id": VALID_HEX,
        "measured_at": ISO_TIME,
        "measured_weight_g": 880,
        "last_wet_weight_g": 1200,
        "note": "repotted to bigger pot",
    }

    resp = await async_client.post("/api/measurements/repotting", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    # Response contains these echoed fields
    assert data["plant_id"] == VALID_HEX
    assert data["measured_at"] == ISO_TIME
    assert data["measured_weight_g"] == 880
    assert data["last_wet_weight_g"] == 1200

    # Ensure the DB connection was closed by the route finally block
    assert dummy_db.get("closed") is True

    # There should be 3 INSERT statements executed in sequence
    executed = dummy_db.get("last_execute")  # last one
    assert executed is not None
    # Last insert includes note parameter
    last_query, last_params = executed
    assert "INSERT INTO plants_measurements" in last_query
    # note is last param in that query
    assert last_params[-1] in (None, "repotted to bigger pot")


@pytest.mark.asyncio
async def test_create_repotting_invalid_plant_id(async_client: AsyncClient, dummy_db, patch_services, monkeypatch):
    # Pydantic enforces hex format; to hit the route's own HEX_RE check,
    # provide a valid hex and patch HEX_RE to a stricter pattern that rejects it.
    import re as _re
    monkeypatch.setattr(repotting_mod, "HEX_RE", _re.compile(r"^b{32}$"))

    bad_payload = {
        "plant_id": VALID_HEX,  # valid per schema but rejected by patched HEX_RE
        "measured_at": ISO_TIME,
        "measured_weight_g": 500,
        "last_wet_weight_g": 600,
    }
    resp = await async_client.post("/api/measurements/repotting", json=bad_payload)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid plant_id"


@pytest.mark.asyncio
async def test_create_repotting_missing_required_due_to_zero(async_client: AsyncClient, dummy_db, patch_services):
    # measured_weight_g=0 should be treated as missing by the route's falsy check
    payload = {
        "plant_id": VALID_HEX,
        "measured_at": ISO_TIME,
        "measured_weight_g": 0,
        "last_wet_weight_g": 600,
    }
    resp = await async_client.post("/api/measurements/repotting", json=payload)
    assert resp.status_code == 400
    assert resp.json()["detail"].startswith("Missing required field:")


@pytest.mark.asyncio
async def test_create_repotting_no_last_event_404(async_client: AsyncClient, dummy_db, patch_services, monkeypatch):
    # Force LastPlantEvent.get_last_event to return None to trigger 404
    monkeypatch.setattr(repotting_mod.LastPlantEvent, "get_last_event", staticmethod(lambda _pid: None))

    payload = {
        "plant_id": VALID_HEX,
        "measured_at": ISO_TIME,
        "measured_weight_g": 880,
        "last_wet_weight_g": 1200,
    }

    resp = await async_client.post("/api/measurements/repotting", json=payload)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Last Plant event not found"


@pytest.mark.asyncio
async def test_update_repotting_happy_path(async_client: AsyncClient, dummy_db, monkeypatch):
    # Patch get_conn only; other helpers aren't used in PUT handler
    # Also capture the execute data tuple for assertions
    store = dummy_db

    payload = {
        "plant_id": VALID_HEX,
        "measured_at": ISO_TIME,
        "measured_weight_g": 777,
        "last_wet_weight_g": 1500,
        "note": "ok",
    }

    resp = await async_client.put(f"/api/measurements/repotting/{'1'*32}", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    assert data["plant_id"] == VALID_HEX
    assert data["measured_at"] == ISO_TIME
    assert data["measured_weight_g"] == 777
    assert data["last_wet_weight_g"] == 1500

    # Inspect the UPDATE call parameters to ensure timezone conversion happened
    # It is the last execute recorded in our dummy cursor
    query, params = store["last_execute"]
    # params layout: (plant_id, local_dt, measured_weight_g, last_wet_weight_g, water_loss_total_g, note, id_hex)
    local_dt = params[1]
    assert isinstance(local_dt, datetime.datetime)
    # pytz timezone should be set to US/Eastern (DstTzInfo)
    assert "US/Eastern" in str(local_dt.tzinfo)


@pytest.mark.asyncio
async def test_update_repotting_missing_required_field(async_client: AsyncClient, dummy_db):
    # Omitting last_wet_weight_g should trigger 400 due to explicit None check
    payload = {
        "plant_id": VALID_HEX,
        "measured_at": ISO_TIME,
        "measured_weight_g": 777,
        # "last_wet_weight_g": None  # implicit None by omission
    }
    resp = await async_client.put(f"/api/measurements/repotting/{'2'*32}", json=payload)
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
