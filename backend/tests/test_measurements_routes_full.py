import types
import uuid as _uuid
import pytest
from httpx import AsyncClient, ASGITransport
from fastapi import FastAPI

from backend.app.db import get_conn_factory
from backend.app.routes import measurements as measurements_routes


class _WaterLossObj:
    def __init__(self, *, total_pct=10.0, total_g=20, day_pct=1.0, day_g=2, is_watering=False):
        self.water_loss_total_pct = total_pct
        self.water_loss_total_g = total_g
        self.water_loss_day_pct = day_pct
        self.water_loss_day_g = day_g
        self.is_watering_event = is_watering


class _DerivedObj:
    def __init__(self, ld=90, lw=120, wa=30, prev=None, last_wa=30):
        self.last_dry_weight_g = ld
        self.last_wet_weight_g = lw
        self.water_added_g = wa
        self.prev_measured_weight = prev
        self.last_watering_water_added = last_wa


class _FakeCursor:
    def __init__(self, *, rows_one=None, rows_all=None, delete_ok=True, not_found=False, raise_on_insert=False, raise_on_update=False):
        # rows for SELECT ... LIMIT 1
        self.rows_one = rows_one
        # rows for SELECT multiple
        self.rows_all = rows_all or []
        # For delete rowcount
        self._delete_ok = delete_ok
        self._not_found = not_found
        self.rowcount = 0
        self._last = None
        self.raise_on_insert = raise_on_insert
        self.raise_on_update = raise_on_update

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self._last = (sql, params)
        sql_norm = " ".join(sql.split()).lower()
        if sql_norm.startswith("select") and "limit 1" in sql_norm:
            # prepare fetchone
            self._next_one = self.rows_one
        elif sql_norm.startswith("select"):
            self._next_all = self.rows_all
        elif sql_norm.startswith("delete"):
            # simulate delete
            if self._delete_ok:
                self.rowcount = 1
            else:
                self.rowcount = 0
        elif sql_norm.startswith("insert"):
            if self.raise_on_insert:
                raise RuntimeError("insert failed")
        elif sql_norm.startswith("update"):
            if self.raise_on_update:
                raise RuntimeError("update failed")
        else:
            # other statements
            pass

    def fetchone(self):
        return self._next_one

    def fetchall(self):
        return self._next_all

    def close(self):
        pass


class _FakeConn:
    def __init__(self, cursor: _FakeCursor, *, raise_on_rollback: bool = False):
        self._cursor = cursor
        self.autocommit_state = True
        self.raise_on_rollback = raise_on_rollback

    def cursor(self):
        return self._cursor

    def autocommit(self, state: bool):
        self.autocommit_state = state

    def commit(self):
        pass

    def rollback(self):
        if self.raise_on_rollback:
            raise RuntimeError("rollback failed")
        pass

    def close(self):
        pass


@pytest.mark.asyncio
async def test__to_dt_string_unit():
    fn = measurements_routes._to_dt_string
    assert fn(None) is None
    assert fn("") is None
    assert fn("2025-01-01T12:30:00 ") == "2025-01-01 12:30:00"


@pytest.mark.asyncio
async def test_get_last_measurement_invalid_plant(app: FastAPI, async_client: AsyncClient):
    resp = await async_client.get("/api/measurements/last", params={"plant_id": "xyz"})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid plant_id"


@pytest.mark.asyncio
async def test_get_last_measurement_none_and_row(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # First case: no rows -> None
    fake_cur = _FakeCursor(rows_one=None)
    fake_conn = _FakeConn(fake_cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: fake_conn)

    plant_hex = "aa" * 16
    r1 = await async_client.get("/api/measurements/last", params={"plant_id": plant_hex})
    assert r1.status_code == 200
    assert r1.json() is None

    # Second case: one row returned
    row = [
        types.SimpleNamespace(isoformat=lambda sep=" ", timespec="seconds": "2025-01-01 12:00:00"),  # measured_at
        100,  # measured_weight_g
        90,   # last_dry_weight_g
        120,  # last_wet_weight_g
        30,   # water_added_g
        bytes.fromhex("11" * 16),  # method_id
        bytes.fromhex("22" * 16),  # scale_id
        "note here",
    ]
    fake_cur.rows_one = row
    r2 = await async_client.get("/api/measurements/last", params={"plant_id": plant_hex})
    assert r2.status_code == 200
    data = r2.json()
    assert data["measured_at"] == "2025-01-01 12:00:00"
    assert data["method_id"] == ("11" * 16)
    assert data["scale_id"] == ("22" * 16)
    assert data["note"] == "note here"

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_list_measurements_for_plant_invalid_id(app: FastAPI, async_client: AsyncClient):
    resp = await async_client.get("/api/plants/nothex/measurements")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid plant id"


@pytest.mark.asyncio
async def test_create_measurement_validation_and_success(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # Validation: invalid plant id -> 400
    bad_payload = {
        "plant_id": "xyz",
        "measured_at": "2025-01-01T12:00:00",
    }
    r0 = await async_client.post("/api/measurements/weight", json=bad_payload)
    assert r0.status_code == 422 or r0.status_code == 400
    if r0.status_code == 400:
        assert r0.json()["detail"] == "Invalid plant_id"

    # Validation: both measured_weight_g and water_added_g provided -> 400
    payload = {
        "plant_id": "aa" * 16,
        "measured_at": "2025-01-01T12:00:00",
        "measured_weight_g": 100,
        "water_added_g": 10,
        "method_id": "bb" * 16,
        "scale_id": "cc" * 16,
        "use_last_method": False,
        "note": "x",
    }
    resp = await async_client.post("/api/measurements/weight", json=payload)
    assert resp.status_code == 400
    assert "Provide either measured_weight_g or water_added_g" in resp.json()["detail"]

    # Success watering event path
    # Stub compute and derive, and deterministic uuid
    monkeypatch.setattr(measurements_routes, "derive_weights", lambda **kwargs: _DerivedObj(ld=90, lw=120, wa=25))
    monkeypatch.setattr(measurements_routes, "compute_water_losses", lambda **kwargs: _WaterLossObj(is_watering=True))
    class _UUID:
        def __init__(self, b):
            self.bytes = b
            self._hex = b.hex()
        def hex(self):
            return self._hex
    fixed_bytes = bytes.fromhex("99" * 16)
    monkeypatch.setattr(measurements_routes.uuid, "uuid4", lambda: _UUID(fixed_bytes))

    fake_cur = _FakeCursor()
    fake_conn = _FakeConn(fake_cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: fake_conn)

    payload2 = {
        "plant_id": "aa" * 16,
        "measured_at": "2025-01-01T12:00:00",
        "measured_weight_g": None,
        "water_added_g": 25,
        "method_id": "bb" * 16,
        "scale_id": "cc" * 16,
        "use_last_method": True,
        "note": "watering",
    }
    r2 = await async_client.post("/api/measurements/watering", json=payload2)
    assert r2.status_code == 200
    j = r2.json()
    assert j["status"] == "success"
    assert j["data"]["id"] == ("99" * 16)
    assert j["meta"]["version"] == "1.0"

    # Failure path: exception during insert triggers rollback and 500
    fake_cur.raise_on_insert = True
    r3 = await async_client.post("/api/measurements/watering", json=payload2)
    assert r3.status_code >= 500

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_create_measurement_rollback_inner_except(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # Arrange deterministic stubs again
    monkeypatch.setattr(measurements_routes, "derive_weights", lambda **kwargs: _DerivedObj(ld=90, lw=120, wa=25))
    monkeypatch.setattr(measurements_routes, "compute_water_losses", lambda **kwargs: _WaterLossObj(is_watering=True))
    class _UUID:
        def __init__(self, b):
            self.bytes = b
            self._hex = b.hex()
        def hex(self):
            return self._hex
    fixed_bytes = bytes.fromhex("98" * 16)
    monkeypatch.setattr(measurements_routes.uuid, "uuid4", lambda: _UUID(fixed_bytes))

    cur = _FakeCursor(raise_on_insert=True)
    conn = _FakeConn(cur, raise_on_rollback=True)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    payload = {
        "plant_id": "aa" * 16,
        "measured_at": "2025-01-01T12:00:00",
        "measured_weight_g": None,
        "water_added_g": 25,
        "method_id": "bb" * 16,
        "scale_id": "cc" * 16,
        "use_last_method": True,
    }
    r = await async_client.post("/api/measurements/watering", json=payload)
    # Should surface as 500 but not crash the test harness
    assert r.status_code >= 500

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_update_measurement_rollback_inner_except(app: FastAPI, async_client: AsyncClient, monkeypatch):
    base_row = [
        bytes.fromhex("aa" * 16),  # plant_id bytes
        types.SimpleNamespace(),    # measured_at current
        100, 90, 120, 0,
    ]
    cur = _FakeCursor(rows_one=base_row, raise_on_update=True)
    conn = _FakeConn(cur, raise_on_rollback=True)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    # Stubs
    monkeypatch.setattr(measurements_routes, "derive_weights", lambda **kwargs: _DerivedObj(ld=95, lw=130, wa=0))
    monkeypatch.setattr(measurements_routes, "compute_water_losses", lambda **kwargs: _WaterLossObj(is_watering=False))

    mid = "33" * 16
    r = await async_client.put(f"/api/measurements/weight/{mid}", json={"measured_weight_g": 111})
    assert r.status_code >= 500

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_update_measurement_invalid_and_not_found(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # invalid id
    resp = await async_client.put("/api/measurements/weight/nothex", json={})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid id"

    # not found path
    cur = _FakeCursor(rows_one=None)
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)
    good_id = "ab" * 16
    r2 = await async_client.put(f"/api/measurements/watering/{good_id}", json={})
    assert r2.status_code == 404

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_update_measurement_success_and_validation_and_rollback(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # Base row exists
    base_row = [
        bytes.fromhex("aa" * 16),  # plant_id bytes
        types.SimpleNamespace(),    # measured_at current
        100, 90, 120, 0,            # curr mw, ld, lw, wa
    ]
    cur = _FakeCursor(rows_one=base_row)
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    # Stubs
    monkeypatch.setattr(measurements_routes, "derive_weights", lambda **kwargs: _DerivedObj(ld=95, lw=130, wa=0))
    monkeypatch.setattr(measurements_routes, "compute_water_losses", lambda **kwargs: _WaterLossObj(is_watering=False))

    pid = "ab" * 16

    # Validation: both measured_weight_g and water_added_g provided -> 400 (covers 254-255)
    r_val = await async_client.put(f"/api/measurements/weight/{pid}", json={"measured_weight_g": 110, "water_added_g": 5})
    assert r_val.status_code == 400

    # Success update path
    r = await async_client.put(f"/api/measurements/weight/{pid}", json={"measured_weight_g": 110})
    assert r.status_code == 200
    jj = r.json()
    assert jj["status"] == "success"
    assert jj["data"]["id"] == pid

    # Rollback path: raise on update to trigger 500 and inner rollback except (338-339)
    cur.raise_on_update = True
    r_err = await async_client.put(f"/api/measurements/weight/{pid}", json={"measured_weight_g": 120})
    assert r_err.status_code >= 500

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_get_measurement_invalid_not_found_and_success(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # invalid
    resp = await async_client.get("/api/measurements/nothex")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid id"

    # not found
    cur = _FakeCursor(rows_one=None)
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)
    gid = "11" * 16
    r2 = await async_client.get(f"/api/measurements/{gid}")
    assert r2.status_code == 404

    # success
    row = [
        bytes.fromhex("11" * 16),  # id
        bytes.fromhex("aa" * 16),  # plant_id
        types.SimpleNamespace(isoformat=lambda sep=" ", timespec="seconds": "2025-01-01 00:00:00"),
        100, 90, 120, 25, 10.5, 20, 1.2, 3,
        bytes.fromhex("bb" * 16),  # method_id
        1,                          # use_last_method
        bytes.fromhex("cc" * 16),  # scale_id
        "note",
    ]
    cur.rows_one = row
    r3 = await async_client.get(f"/api/measurements/{gid}")
    assert r3.status_code == 200
    data = r3.json()
    assert data["id"] == ("11" * 16)
    assert data["plant_id"] == ("aa" * 16)
    assert data["use_last_method"] is True
    assert data["method_id"] == ("bb" * 16)

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_delete_measurement_invalid_not_found_and_success(app: FastAPI, async_client: AsyncClient):
    # invalid
    resp = await async_client.delete("/api/measurements/nothex")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid id"

    # not found
    cur = _FakeCursor(delete_ok=False)
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    gid = "22" * 16
    r2 = await async_client.delete(f"/api/measurements/{gid}")
    assert r2.status_code == 404

    # success
    cur._delete_ok = True
    r3 = await async_client.delete(f"/api/measurements/{gid}")
    assert r3.status_code == 200
    assert r3.json() == {"ok": True}

    app.dependency_overrides.pop(get_conn_factory, None)
