import types
from datetime import datetime
import pytest
from httpx import AsyncClient
from fastapi import FastAPI

from backend.app.db import get_conn_factory
from backend.app.routes import measurements as measurements_routes


class _SeqCursor:
    def __init__(self, *, plant_row=None, meas_rows=None, raise_on_update: bool = False):
        self._plant_row = plant_row
        self._meas_rows = meas_rows or []
        self._next_one = None
        self._next_all = []
        self.update_calls = []
        self.raise_on_update = raise_on_update

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        s = " ".join(sql.split()).lower()
        if s.startswith("select") and " from plants " in s:
            # Plant calibration params
            self._next_one = self._plant_row
        elif s.startswith("select") and "from plants_measurements" in s and "order by" in s:
            # Measurements query in corrections
            self._next_all = list(self._meas_rows)
        elif s.strip().startswith("update") and "plants_measurements" in s:
            self.update_calls.append((s, params))
            if self.raise_on_update:
                raise RuntimeError("update failed")
        else:
            # noop for others
            pass

    def fetchone(self):
        return self._next_one

    def fetchall(self):
        return self._next_all


class _SeqConn:
    def __init__(self, cursor: _SeqCursor, *, raise_on_rollback=False):
        self._cursor = cursor
        self._ac = True
        self.raise_on_rollback = raise_on_rollback

    def cursor(self):
        return self._cursor

    def autocommit(self, v: bool):
        self._ac = v

    def commit(self):
        pass

    def rollback(self):
        if self.raise_on_rollback:
            raise RuntimeError("rb fail")
        pass

    def close(self):
        pass


@pytest.mark.asyncio
async def test_list_plants_for_calibration_enriched(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # Base list from PlantsList: replace the class with a simple stub namespace
    monkeypatch.setattr(
        measurements_routes,
        "PlantsList",
        types.SimpleNamespace(fetch_all=lambda: [
            {"id": 1, "uuid": "aa" * 16, "name": "A", "latest_at": datetime(2025, 1, 1, 0, 0, 0)},
            {"id": 2, "uuid": "bb" * 16, "name": "B", "latest_at": datetime(2025, 1, 1, 0, 0, 0)},
        ])
    )
    # Calibration maps
    entry = {
        "id": "11" * 16,
        "measured_at": "2025-01-01 00:00:00",
        "water_added_g": 0,
        "last_wet_weight_g": 0,
        "target_weight_g": 0,
        "under_g": 0,
        "under_pct": 0.0,
    }
    monkeypatch.setattr(measurements_routes, "calibrate_by_max_water_retained", lambda conn: {"aa" * 16: [entry], "bb" * 16: [entry]})
    monkeypatch.setattr(measurements_routes, "calibrate_by_minimum_dry_weight", lambda conn: {"aa" * 16: [entry]})

    r = await async_client.get("/api/measurements/calibrating")
    assert r.status_code == 200
    data = r.json()
    # Preserve order and include calibration
    assert data[0]["uuid"] == ("aa" * 16)
    mw = data[0]["calibration"]["max_water_retained"]
    md = data[0]["calibration"]["min_dry_weight"]
    assert isinstance(mw, list) and isinstance(md, list)
    assert all("id" in e for e in mw)
    assert all("id" in e for e in md)
    assert data[1]["uuid"] == ("bb" * 16)

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_list_plants_for_calibration_skips_missing_uuid_and_close_except(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # Include an entry without uuid to trigger `continue` branch (line 196)
    monkeypatch.setattr(
        measurements_routes,
        "PlantsList",
        types.SimpleNamespace(fetch_all=lambda: [
            {"id": 1, "uuid": "aa" * 16, "name": "A", "latest_at": datetime(2025, 1, 1, 0, 0, 0)},
            {"name": "NoUUID", "latest_at": datetime(2025, 1, 1, 0, 0, 0)},  # missing both uuid and id -> skipped
        ])
    )
    # Stub calibration maps to empty
    monkeypatch.setattr(measurements_routes, "calibrate_by_max_water_retained", lambda conn: {})
    monkeypatch.setattr(measurements_routes, "calibrate_by_minimum_dry_weight", lambda conn: {})

    # Provide a conn whose close() raises to hit the except in finally (lines 188-189)
    class _ConnCloseFail(_SeqConn):
        def close(self):
            raise RuntimeError("close fail")

    cur = _SeqCursor()
    conn = _ConnCloseFail(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    r = await async_client.get("/api/measurements/calibrating")
    assert r.status_code == 200
    data = r.json()
    # The item without uuid should be skipped
    assert all(item.get("uuid") for item in data)

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_apply_corrections_invalids_and_noops(app: FastAPI, async_client: AsyncClient):
    # invalid plant
    r_bad = await async_client.post("/api/measurements/corrections", json={"plant_id": "nothex"})
    assert r_bad.status_code == 400
    assert r_bad.json()["detail"] == "Invalid plant_id"

    # invalid cap
    r_cap = await async_client.post("/api/measurements/corrections", json={"plant_id": "aa" * 16, "cap": "bogus"})
    assert r_cap.status_code == 400
    assert r_cap.json()["detail"] == "Invalid cap mode"

    # plant not found
    cur = _SeqCursor(plant_row=None)
    conn = _SeqConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)
    r_nf = await async_client.post("/api/measurements/corrections", json={"plant_id": "aa" * 16})
    assert r_nf.status_code == 404

    # calibration incomplete: min_dry None
    cur._plant_row = (None, 200, 100)
    r_noop = await async_client.post("/api/measurements/corrections", json={"plant_id": "aa" * 16})
    assert r_noop.status_code == 200
    assert r_noop.json()["updated"] == 0

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_apply_corrections_capacity_and_retained_ratio(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # last repotting default window present
    monkeypatch.setattr(measurements_routes, "get_last_repotting_event", lambda conn, pid: types.SimpleNamespace(measured_at=datetime(2025, 1, 1, 0, 0, 0)))

    # Plant exists with full calibration
    plant_row = (100, 50, 80)  # min_dry, max_water, rec_pct
    # Two candidate measurements: one exceeding, one equal
    # id, measured_at, water_added_g, last_wet_weight_g
    m1 = (bytes.fromhex("11" * 16), datetime(2025, 1, 2, 0, 0, 0), 60, 170)  # target 150 -> excess 20 -> new_added 40
    m2 = (bytes.fromhex("22" * 16), datetime(2025, 1, 3, 0, 0, 0), 10, 150)  # no excess
    cur = _SeqCursor(plant_row=plant_row, meas_rows=[m1, m2])
    conn = _SeqConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    # capacity mode, edit_last_wet true (default)
    r1 = await async_client.post("/api/measurements/corrections", json={"plant_id": "aa" * 16})
    assert r1.status_code == 200
    j1 = r1.json()
    assert j1["updated"] == 1 and j1["total_excess_g"] == 20
    # ensure UPDATE called with LEAST branch
    assert any("last_wet_weight_g = least" in sql for sql, _ in cur.update_calls)

    # retained_ratio mode, edit_last_wet false
    cur.update_calls.clear()
    r2 = await async_client.post("/api/measurements/corrections", json={"plant_id": "aa" * 16, "cap": "retained_ratio", "edit_last_wet": False})
    assert r2.status_code == 200
    j2 = r2.json()
    assert j2["updated"] >= 1
    assert any("set water_added_g" in sql and "last_wet_weight_g" not in sql for sql, _ in cur.update_calls)

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_apply_corrections_window_build_no_rows_and_exceptions(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # Force last repotting to have a non-datetime value that will cause parse to raise -> caught (276-278)
    monkeypatch.setattr(measurements_routes, "get_last_repotting_event", lambda conn, pid: types.SimpleNamespace(measured_at="not-a-date"))

    # Plant present; no measurement rows
    cur = _SeqCursor(plant_row=(100, 50, 80), meas_rows=[])

    class _ConnCloseFail(_SeqConn):
        def __init__(self, c):
            super().__init__(c)
        def close(self):
            raise RuntimeError("close fail")

    conn = _ConnCloseFail(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    # Provide from_ts and to_ts to engage where_parts appends (283-286, 287-288)
    payload = {
        "plant_id": "aa" * 16,
        "from_ts": "2025-01-01 00:00:00",
        "to_ts": "2025-01-31 23:59:59",
    }
    r = await async_client.post("/api/measurements/corrections", json=payload)
    assert r.status_code == 200
    assert r.json()["updated"] == 0  # no rows => line 312

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_apply_corrections_update_failure_triggers_rollback_and_close_except(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # No default window; provide explicit so selection runs
    monkeypatch.setattr(measurements_routes, "get_last_repotting_event", lambda conn, pid: None)

    # One candidate row that exceeds target; UPDATE will raise
    plant_row = (100, 50, 100)
    m1 = (bytes.fromhex("11" * 16), datetime(2025, 1, 2, 0, 0, 0), 60, 170)
    cur = _SeqCursor(plant_row=plant_row, meas_rows=[m1], raise_on_update=True)

    class _ConnRBAndCloseFail(_SeqConn):
        def __init__(self, c):
            super().__init__(c, raise_on_rollback=False)
        def close(self):
            raise RuntimeError("close fail")

    conn = _ConnRBAndCloseFail(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    r = await async_client.post("/api/measurements/corrections", json={"plant_id": "aa" * 16})
    # Update fails -> exception path triggers rollback (355-360) and close except (368-369)
    assert r.status_code >= 500

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_apply_corrections_default_window_parse_error_branch(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # No from/to provided; last repotting has invalid measured_at -> triggers parse exception path (276-278)
    monkeypatch.setattr(measurements_routes, "get_last_repotting_event", lambda conn, pid: types.SimpleNamespace(measured_at="bogus-ts"))

    cur = _SeqCursor(plant_row=(100, 50, 80), meas_rows=[])
    conn = _SeqConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    r = await async_client.post("/api/measurements/corrections", json={"plant_id": "aa" * 16})
    assert r.status_code == 200
    assert r.json()["updated"] == 0

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_apply_corrections_update_failure_rollback_raises(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # Force update failure and rollback raising to cover except branch (358-359)
    monkeypatch.setattr(measurements_routes, "get_last_repotting_event", lambda conn, pid: None)

    plant_row = (100, 50, 100)
    m1 = (bytes.fromhex("11" * 16), datetime(2025, 1, 2, 0, 0, 0), 60, 170)
    cur = _SeqCursor(plant_row=plant_row, meas_rows=[m1], raise_on_update=True)

    class _ConnRBFail(_SeqConn):
        def __init__(self, c):
            super().__init__(c, raise_on_rollback=True)

    conn = _ConnRBFail(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    r = await async_client.post("/api/measurements/corrections", json={"plant_id": "aa" * 16})
    assert r.status_code >= 500

    app.dependency_overrides.pop(get_conn_factory, None)
