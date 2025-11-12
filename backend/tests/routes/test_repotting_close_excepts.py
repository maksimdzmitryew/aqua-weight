import types
import datetime
import pytest
from httpx import AsyncClient

import backend.app.routes.repotting as repotting_mod

VALID_HEX = "a" * 32
ISO_TIME = "2025-01-02T03:04:05"


class DummyCursor:
    def __init__(self, store):
        self.store = store
        self.lastrowid = 321
        self.executed = []

    def execute(self, query, params=None):
        self.executed.append((query, params))
        self.store["last_execute"] = (query, params)

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
    # Make uuid4 deterministic for stable inserts
    class _FixedUUID:
        def __init__(self):
            self._i = 0
        def uuid4(self):
            self._i += 1
            return types.SimpleNamespace(bytes=b"\x00" * 16)
    monkeypatch.setattr(repotting_mod, "uuid", _FixedUUID())


@pytest.fixture()
def patch_services(monkeypatch):
    # Minimal patches needed by create handler
    monkeypatch.setattr(repotting_mod, "get_last_watering_event", lambda cur, pid: {"water_added_g": 50})

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
    monkeypatch.setattr(repotting_mod, "parse_timestamp_local", lambda s, fixed_milliseconds=None: s)


@pytest.mark.asyncio
async def test_create_repotting_close_raises_is_swallowed(async_client: AsyncClient, patch_services, monkeypatch):
    store = {}
    conn = RaisingCloseConn(store)
    monkeypatch.setattr(repotting_mod, "get_conn", lambda: conn)

    payload = {
        "plant_id": VALID_HEX,
        "measured_at": ISO_TIME,
        "measured_weight_g": 880,
        "last_wet_weight_g": 1200,
    }

    resp = await async_client.post("/api/measurements/repotting", json=payload)
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
    monkeypatch.setattr(repotting_mod, "get_conn", lambda: conn)

    payload = RepottingUpdateRequest(
        plant_id=VALID_HEX,
        measured_at=ISO_TIME,
        measured_weight_g=777,
        last_wet_weight_g=1500,
        note="ok",
    )

    # Call the route coroutine directly to isolate the finally:close() path
    result = await repotting_mod.update_repotting_event("f" * 32, payload)
    assert result["plant_id"] == VALID_HEX
    # Ensure close was attempted and exception suppressed
    assert store.get("close_attempted") is True
