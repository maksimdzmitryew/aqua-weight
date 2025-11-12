import pytest
from httpx import AsyncClient

# We will monkeypatch backend.app.routes.plants.get_conn to simulate DB failures


class Boom(Exception):
    pass


class FakeCursor:
    def __init__(self, fail_on_execute_at: int | None = None, returns_exists: bool = False):
        self._exec_count = 0
        self.fail_on_execute_at = fail_on_execute_at
        self._returns_exists = returns_exists
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self._exec_count += 1
        if self.fail_on_execute_at and self._exec_count == self.fail_on_execute_at:
            # Raise a low-level DB error
            raise Boom("db execute failed")
        # Simulate behavior for specific queries used in update/create/delete paths
        if isinstance(sql, str) and sql.strip().upper().startswith("SELECT 1 FROM PLANTS"):
            # Existence check
            return True
        if isinstance(sql, str) and sql.strip().upper().startswith("SELECT COUNT(*) FROM PLANTS"):
            # For reorder endpoint count; default to zero forcing mismatch elsewhere when needed
            return True
        if isinstance(sql, str) and sql.strip().upper().startswith("DELETE FROM PLANTS"):
            # Simulate delete not used here
            self.rowcount = 1
            return True
        return True

    def fetchone(self):
        # Existence check result
        if self._returns_exists:
            return (1,)
        # Count query result default
        return (0,)


class FakeConn:
    def __init__(self, fail_on_execute_at: int | None = None, returns_exists: bool = False, rollback_raises: bool = False):
        self._cursor = FakeCursor(fail_on_execute_at=fail_on_execute_at, returns_exists=returns_exists)
        self._rollback_raises = rollback_raises
        self._closed = False

    def autocommit(self, _):
        return None

    def cursor(self):
        return self._cursor

    def commit(self):
        return None

    def rollback(self):
        if self._rollback_raises:
            raise Boom("rollback failed")
        return None

    def close(self):
        self._closed = True


@pytest.mark.anyio
async def test_create_plant_db_error_triggers_rollback_inner_except(async_client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    # Arrange: reset and patch connection to fail on first INSERT execute and rollback raising
    await async_client.post("/api/test/reset")

    from backend.app import routes as routes_pkg
    import backend.app.routes.plants as plants_mod

    def fake_get_conn():
        # fail on first execute inside do_insert, and make rollback raise to hit inner except pass
        return FakeConn(fail_on_execute_at=1, rollback_raises=True)

    monkeypatch.setattr(plants_mod, "get_conn", staticmethod(fake_get_conn))

    # Act
    resp = await async_client.post("/api/plants", json={"name": "Boomy"})

    # Assert: internal error due to raised Boom, but rollback inner except executed
    assert resp.status_code >= 500


@pytest.mark.anyio
async def test_reorder_plants_db_error_rollback_inner_except(async_client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await async_client.post("/api/test/reset")
    import backend.app.routes.plants as plants_mod

    def fake_get_conn():
        # Cause failure on the SELECT COUNT(*) execute to trigger except, and rollback raises
        return FakeConn(fail_on_execute_at=1, rollback_raises=True)

    monkeypatch.setattr(plants_mod, "get_conn", staticmethod(fake_get_conn))

    # Non-empty list so code enters try and hits failing execute
    resp = await async_client.put("/api/plants/order", json={"ordered_ids": ["1" * 32]})
    assert resp.status_code >= 500


@pytest.mark.anyio
async def test_update_plant_db_error_triggers_rollback_inner_except(async_client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await async_client.post("/api/test/reset")
    # First, create a plant normally (without patch)
    r = await async_client.post("/api/plants", json={"name": "ToUpdate"})
    assert r.status_code == 200
    # Find its uuid
    lst = await async_client.get("/api/plants")
    uid = next(it["uuid"] for it in lst.json() if it["name"] == "ToUpdate")

    import backend.app.routes.plants as plants_mod

    # Patch connection so that SELECT exists succeeds (cursor returns (1,)), but UPDATE execute fails.
    class FakeCursorUpdate(FakeCursor):
        def __init__(self):
            super().__init__()
            self._exec_count = 0

        def execute(self, sql, params=None):
            self._exec_count += 1
            if isinstance(sql, str) and sql.strip().upper().startswith("SELECT 1 FROM PLANTS"):
                return True
            if isinstance(sql, str) and sql.strip().upper().startswith("UPDATE PLANTS SET"):
                raise Boom("update failed")
            return True

        def fetchone(self):
            # make exists True
            return (1,)

    class FakeConnUpdate(FakeConn):
        def __init__(self, rollback_raises=True):
            self._cursor = FakeCursorUpdate()
            self._rollback_raises = rollback_raises
            self._closed = False

    def fake_get_conn():
        return FakeConnUpdate(rollback_raises=True)

    monkeypatch.setattr(plants_mod, "get_conn", staticmethod(fake_get_conn))

    resp = await async_client.put(f"/api/plants/{uid}", json={"description": "x"})
    assert resp.status_code >= 500


@pytest.mark.anyio
async def test_update_plant_to_dt_empty_string_returns_none(async_client: AsyncClient):
    await async_client.post("/api/test/reset")
    # Create a plant
    r = await async_client.post("/api/plants", json={"name": "Timey"})
    assert r.status_code == 200
    # Get id
    lst = await async_client.get("/api/plants")
    uid = next(it["uuid"] for it in lst.json() if it["name"] == "Timey")

    # Send empty strings for datetime fields to trigger to_dt's early None path
    payload = {
        "name": "Timey",  # keep NOT NULL column valid
        "substrate_last_refresh_at": "",
        "fertilized_last_at": "",
    }
    resp = await async_client.put(f"/api/plants/{uid}", json=payload)
    # Even with empty strings, should be ok 200
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_validate_and_update_order_count_mismatch_hits_135(async_client: AsyncClient):
    # Ensure empty DB for plants
    await async_client.post("/api/test/reset")
    from backend.app.routes.plants import _validate_and_update_order
    with pytest.raises(Exception) as excinfo:
        _validate_and_update_order("plants", ["1" * 32, "2" * 32])
    # HTTPException from count mismatch
    assert "do not exist" in str(excinfo.value)


@pytest.mark.anyio
async def test_validate_and_update_order_rollback_inner_except(async_client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await async_client.post("/api/test/reset")
    import backend.app.routes.plants as plants_mod

    class FailConn(FakeConn):
        def __init__(self):
            super().__init__(fail_on_execute_at=1, rollback_raises=True)

    monkeypatch.setattr(plants_mod, "get_conn", staticmethod(lambda: FailConn()))

    from backend.app.routes.plants import _validate_and_update_order

    with pytest.raises(Exception):
        _validate_and_update_order("plants", ["a" * 32])
