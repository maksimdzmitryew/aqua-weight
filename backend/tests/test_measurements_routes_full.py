import types
from datetime import datetime
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
        # initialize next fetch holders to avoid attribute errors
        self._next_one = None
        self._next_all = []

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
            # Detect plant info query and return rows_all[0] for fetchone
            if " from plants " in sql_norm and " where " in sql_norm:
                self._next_one = self.rows_all[0] if self.rows_all else None
            else:
                # default behavior for other SELECTs without LIMIT
                if self.rows_one is not None:
                    self._next_one = self.rows_one
                elif self.rows_all:
                    self._next_one = self.rows_all[0]
                else:
                    self._next_one = None
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
async def test_create_reported_watering_invalid_and_success(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # invalid plant id
    r_bad = await async_client.post("/api/measurements/reported-watering", json={"plant_id": "nothex"})
    assert r_bad.status_code == 400
    assert r_bad.json()["detail"] == "Invalid plant_id"

    # invalid measured_at format -> 400
    r_bad_ts = await async_client.post(
        "/api/measurements/reported-watering",
        json={"plant_id": "aa" * 16, "measured_at": "bogus"},
    )
    assert r_bad_ts.status_code == 400
    assert "Invalid measured_at" in r_bad_ts.json()["detail"]

    # success path with composed note and deterministic id
    class _UUID:
        def __init__(self, b):
            self.bytes = b
    fixed_bytes = bytes.fromhex("77" * 16)
    monkeypatch.setattr(measurements_routes.uuid, "uuid4", lambda: _UUID(fixed_bytes))

    cur = _FakeCursor()
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    payload = {
        "plant_id": "aa" * 16,
        "measured_at": "2025-01-02T10:20:00",
        "reporter": "Alice",
        "note": "top-up",
    }
    r_ok = await async_client.post("/api/measurements/reported-watering", json=payload)
    assert r_ok.status_code == 200
    data = r_ok.json()
    assert data["id"] == ("77" * 16)
    assert data["plant_id"] == ("aa" * 16)
    assert data["measured_at"] == "2025-01-02 10:20:00"
    assert data["note"].startswith("[reported] watering")
    assert "by Alice" in data["note"] and "top-up" in data["note"]

    # insert failure -> rollback and 500
    cur.raise_on_insert = True
    r_fail = await async_client.post("/api/measurements/reported-watering", json=payload)
    assert r_fail.status_code >= 500

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_create_measurement_non_watering_branch_and_water_retained(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # Non-watering event: measured_weight present, compute returns is_watering=False
    monkeypatch.setattr(measurements_routes, "derive_weights", lambda **kwargs: _DerivedObj(ld=90, lw=120, wa=0))
    monkeypatch.setattr(measurements_routes, "compute_water_losses", lambda **kwargs: _WaterLossObj(is_watering=False))

    # deterministic id
    class _UUID:
        def __init__(self, b):
            self.bytes = b
    fixed_bytes = bytes.fromhex("66" * 16)
    monkeypatch.setattr(measurements_routes.uuid, "uuid4", lambda: _UUID(fixed_bytes))

    # Spy on water_retained calculation to ensure the block is executed
    calls = []
    monkeypatch.setattr(
        measurements_routes,
        "calculate_water_retained",
        lambda **kwargs: (calls.append(1) or types.SimpleNamespace(water_retained_pct=12.3)),
    )

    # Provide plant min/max for retained calc (queried after insert)
    cur = _FakeCursor()
    cur.rows_all = [(100, 200)]  # min_dry, max_water
    cur.rows_one = (100, 200)
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    payload = {
        "plant_id": "aa" * 16,
        "measured_at": "2025-01-01T12:00:00",
        "measured_weight_g": 150,
        "method_id": "bb" * 16,
        "scale_id": "cc" * 16,
        "use_last_method": False,
        "note": "weighing",
    }
    r = await async_client.post("/api/measurements/weight", json=payload)
    assert r.status_code == 200
    j = r.json()
    assert j["status"] == "success"
    assert j["data"]["id"] == ("66" * 16)
    # ensure calculate_water_retained was called
    assert len(calls) == 1

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_update_measurement_watering_branch_and_retained(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # Base row exists
    base_row = [bytes.fromhex("aa" * 16), datetime(2025, 1, 1, 0, 0, 0), None, 90, 120, 30]
    cur = _FakeCursor(rows_one=base_row)
    # Plant params for retained calc (queried after update)
    cur.rows_all = [(100, 200)]
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    # Stubs: watering event
    monkeypatch.setattr(measurements_routes, "derive_weights", lambda **kwargs: _DerivedObj(ld=95, lw=130, wa=25))
    monkeypatch.setattr(measurements_routes, "compute_water_losses", lambda **kwargs: _WaterLossObj(is_watering=True))
    calls = []
    monkeypatch.setattr(
        measurements_routes,
        "calculate_water_retained",
        lambda **kwargs: (calls.append(1) or types.SimpleNamespace(water_retained_pct=34.5)),
    )

    mid = "33" * 16
    r = await async_client.put(f"/api/measurements/watering/{mid}", json={"water_added_g": 25})
    assert r.status_code == 200
    jj = r.json()
    assert jj["status"] == "success"
    assert len(calls) == 1

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_delete_measurement_delete_rowcount_zero_and_rollback_except(app: FastAPI, async_client: AsyncClient):
    # Case 1: pre-select ok, but delete affects 0 rows -> triggers 404 inside do_delete then 5xx response
    cur = _FakeCursor(delete_ok=False)
    # pre-select returns a row
    cur.rows_one = [bytes.fromhex("aa" * 16), 123]
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)
    gid = "44" * 16
    r = await async_client.delete(f"/api/measurements/{gid}")
    assert r.status_code >= 500

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_create_measurement_retained_block_executes_without_spy(app: FastAPI, async_client: AsyncClient, monkeypatch):
    """Covers create_measurement post-insert retained calculation (524-529) without monkeypatching
    calculate_water_retained so the call site line is executed under coverage.
    """
    # Execute route internals synchronously to ensure coverage captures threadpool work
    async def _inline(fn):
        return fn()
    monkeypatch.setattr(measurements_routes, "run_in_threadpool", _inline)

    # Non-watering event path
    monkeypatch.setattr(measurements_routes, "derive_weights", lambda **kwargs: _DerivedObj(ld=90, lw=120, wa=0))
    monkeypatch.setattr(measurements_routes, "compute_water_losses", lambda **kwargs: _WaterLossObj(is_watering=False))

    class _UUID:
        def __init__(self, b):
            self.bytes = b
            self._hex = b.hex()
        def hex(self):
            return self._hex
    monkeypatch.setattr(measurements_routes.uuid, "uuid4", lambda: _UUID(bytes.fromhex("aa" * 16)))

    # Provide plant min/max for retained calc
    cur = _FakeCursor()
    cur.rows_all = [(100, 200)]
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    payload = {
        "plant_id": "aa" * 16,
        "measured_at": "2025-02-01T08:00:00",
        "measured_weight_g": 150,
        "method_id": "bb" * 16,
        "scale_id": "cc" * 16,
        "use_last_method": False,
    }
    r = await async_client.post("/api/measurements/weight", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert "water_retained_pct" in data["data"]
    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_update_measurement_retained_block_executes_without_spy(app: FastAPI, async_client: AsyncClient, monkeypatch):
    """Covers update_measurement post-commit retained calculation (675-680) without monkeypatching
    calculate_water_retained so the call site line is executed under coverage.
    """
    # Execute route internals synchronously to ensure coverage captures threadpool work
    async def _inline(fn):
        return fn()
    monkeypatch.setattr(measurements_routes, "run_in_threadpool", _inline)

    # Base row exists
    base_row = [bytes.fromhex("aa" * 16), datetime(2025, 1, 1, 0, 0, 0), 140, 90, 120, 0]
    cur = _FakeCursor(rows_one=base_row)
    # Plant params for retained calc (queried after update)
    cur.rows_all = [(100, 200)]
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    # Stubs: treat as non-watering update so measured_weight_g is used
    monkeypatch.setattr(measurements_routes, "derive_weights", lambda **kwargs: _DerivedObj(ld=95, lw=130, wa=0))
    monkeypatch.setattr(measurements_routes, "compute_water_losses", lambda **kwargs: _WaterLossObj(is_watering=False))

    mid = "66" * 16
    r = await async_client.put(f"/api/measurements/weight/{mid}", json={"measured_weight_g": 150})
    assert r.status_code == 200
    data = r.json()
    assert "water_retained_pct" in data["data"]
    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_delete_measurement_success_updates_min_dry_inline_pool(app: FastAPI, async_client: AsyncClient, monkeypatch):
    """Covers delete_measurement post-delete recalculation and commit (795-798) with inline threadpool
    to ensure coverage traces the lines.
    """
    async def _inline(fn):
        return fn()
    monkeypatch.setattr(measurements_routes, "run_in_threadpool", _inline)

    # Spy on update_min_dry_weight_and_max_watering_added_g
    calls = []
    monkeypatch.setattr(measurements_routes, "update_min_dry_weight_and_max_watering_added_g", lambda *a, **k: calls.append((a, k)))

    cur = _FakeCursor(delete_ok=True)
    # pre-select returns a row with measured_weight_g set
    cur.rows_one = [bytes.fromhex("aa" * 16), 200]
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    gid = "77" * 16
    r = await async_client.delete(f"/api/measurements/{gid}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert len(calls) == 1
    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test__compute_water_retained_for_plant_no_plant_row(monkeypatch):
    """Covers lines 54-55 where no plant row is found, ensuring None min/max are handled."""
    # Stub calculate_water_retained to control the returned pct
    class _Calc:
        def __init__(self, pct):
            self.water_retained_pct = pct
    monkeypatch.setattr(
        measurements_routes,
        "calculate_water_retained",
        lambda **kwargs: _Calc(12.6),
    )

    cur = _FakeCursor()  # rows_all empty -> SELECT from plants returns None
    pct = measurements_routes._compute_water_retained_for_plant(
        cur,
        "aa" * 16,
        measured_weight_g=None,
        last_wet_weight_g=None,
        water_loss_total_pct=None,
    )
    # Rounded to 0 decimals
    assert pct == 13


@pytest.mark.asyncio
async def test__compute_water_retained_for_plant_pct_none(monkeypatch):
    """Covers line 74: returns 0.0 when water_retained_pct is None."""
    class _Calc:
        def __init__(self, pct):
            self.water_retained_pct = pct
    monkeypatch.setattr(
        measurements_routes,
        "calculate_water_retained",
        lambda **kwargs: _Calc(None),
    )

    cur = _FakeCursor()
    cur.rows_one = [80, 20]
    pct = measurements_routes._compute_water_retained_for_plant(
        cur,
        "aa" * 16,
        measured_weight_g=100,
        last_wet_weight_g=100,
        water_loss_total_pct=0.0,
    )
    assert pct == 0.0


@pytest.mark.asyncio
async def test__post_delete_recalculate_and_commit_branch(monkeypatch):
    """Directly cover helper branch at 75-77: update invoked when measured_weight_g is not None, then commit."""
    calls: list = []
    monkeypatch.setattr(
        measurements_routes,
        "update_min_dry_weight_and_max_watering_added_g",
        lambda *a, **k: calls.append(("update", a, k)),
    )
    conn = _FakeConn(_FakeCursor())
    # Spy commit
    def _commit():
        calls.append(("commit",))
    monkeypatch.setattr(conn, "commit", _commit, raising=False)

    measurements_routes._post_delete_recalculate_and_commit(conn, "aa" * 16, 123)

    assert ("update",) == calls[0][:1]
    assert calls[-1][0] == "commit"


@pytest.mark.asyncio
async def test_delete_measurement_rollback_raises_covers_inner_except(app: FastAPI, async_client: AsyncClient):
    """Force rollback to raise so inner except (818-819) executes, returning 500."""
    cur = _FakeCursor(delete_ok=False)
    # Pre-select returns a valid row so code proceeds to DELETE and then 0 rowcount triggers error
    cur.rows_one = [bytes.fromhex("aa" * 16), 123]
    conn = _FakeConn(cur, raise_on_rollback=True)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    gid = "99" * 16
    r = await async_client.delete(f"/api/measurements/{gid}")
    assert r.status_code >= 500
    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_get_watering_approximation_success(app: FastAPI, async_client: AsyncClient, monkeypatch):
    """Covers lines 192-215: fetch function in get_watering_approximation."""
    from datetime import datetime, timedelta
    now = datetime.now()

    mock_plants = [
        {
            "uuid": "aa" * 16,
            "next_watering_at": now + timedelta(days=2),
            "first_calculated_at": now - timedelta(days=5),
            "water_retained_pct": 75.0,
            "frequency_days": 7,
            "frequency_confidence": 1,
            "days_offset": 0
        },
        {
            "uuid": "bb" * 16,
            "next_watering_at": "Not a datetime", # Test the string fallback
            "first_calculated_at": None,
            "water_retained_pct": None,
            "frequency_days": None,
            "frequency_confidence": None,
            "days_offset": None
        }
    ]

    monkeypatch.setattr("backend.app.routes.measurements.PlantsList.fetch_all", lambda: mock_plants)

    resp = await async_client.get("/api/measurements/approximation/watering")
    assert resp.status_code == 200
    data = resp.json()["items"]
    assert len(data) == 2
    assert data[0]["plant_uuid"] == "aa" * 16
    assert data[1]["next_watering_at"] == "Not a datetime"
    assert data[1]["first_calculated_at"] is None


@pytest.mark.asyncio
async def test__post_delete_recalculate_and_commit_none_weight_no_update(monkeypatch):
    """Cover the False branch of the helper if: measured_weight_g is None → no update call, but commit occurs."""
    calls: list = []
    # Spy update to ensure it's not called
    monkeypatch.setattr(
        measurements_routes,
        "update_min_dry_weight_and_max_watering_added_g",
        lambda *a, **k: calls.append(("update",)),
    )
    conn = _FakeConn(_FakeCursor())
    def _commit():
        calls.append(("commit",))
    monkeypatch.setattr(conn, "commit", _commit, raising=False)

    measurements_routes._post_delete_recalculate_and_commit(conn, "aa" * 16, None)

    # Ensure only commit recorded, no update
    assert ("commit",) in calls
    assert all(c[0] != "update" for c in calls)


@pytest.mark.asyncio
async def test_delete_measurement_success_updates_min_dry(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # Spy on update_min_dry_weight_and_max_watering_added_g
    calls = []
    monkeypatch.setattr(measurements_routes, "update_min_dry_weight_and_max_watering_added_g", lambda *a, **k: calls.append((a, k)))

    cur = _FakeCursor(delete_ok=True)
    # pre-select returns a row with measured_weight_g set
    cur.rows_one = [bytes.fromhex("aa" * 16), 200]
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    gid = "55" * 16
    r = await async_client.delete(f"/api/measurements/{gid}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    # ensure the min dry/max water update was invoked
    assert len(calls) == 1
    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_create_reported_watering_rollback_and_close_excepts(app: FastAPI, async_client: AsyncClient, monkeypatch):
    class _UUID:
        def __init__(self, b):
            self.bytes = b
    monkeypatch.setattr(measurements_routes.uuid, "uuid4", lambda: _UUID(bytes.fromhex("77" * 16)))

    class _Conn(_FakeConn):
        def __init__(self, cur):
            super().__init__(cur, raise_on_rollback=True)
        def close(self):
            raise RuntimeError("close failed")

    cur = _FakeCursor(raise_on_insert=True)
    conn = _Conn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    payload = {"plant_id": "aa" * 16, "measured_at": "2025-01-02T10:20:00"}
    r = await async_client.post("/api/measurements/reported-watering", json=payload)
    assert r.status_code >= 500
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

    # The route now queries plant min/max water weights; provide a dummy row
    fake_cur.rows_all = [(100, 200)]

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
        datetime(2025, 1, 1, 0, 0, 0),    # measured_at current as datetime
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
        datetime(2025, 1, 1, 0, 0, 0),    # measured_at current as datetime
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
    # Provide plant min/max weights for new route logic
    cur.rows_all = [(100, 200)]
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
    # The route now wraps exceptions and returns 5xx on missing measurement
    assert r2.status_code >= 500

    # success
    cur._delete_ok = True
    # Provide existing measurement details for the pre-delete SELECT
    cur.rows_one = [bytes.fromhex("aa" * 16), 100]
    r3 = await async_client.delete(f"/api/measurements/{gid}")
    assert r3.status_code == 200
    assert r3.json() == {"ok": True}

    app.dependency_overrides.pop(get_conn_factory, None)
