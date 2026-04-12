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
    # Find its uuid (paginated response)
    lst = await async_client.get("/api/plants")
    uid = next(it["uuid"] for it in lst.json()["items"] if it["name"] == "ToUpdate")

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
    # Get id (paginated response)
    lst = await async_client.get("/api/plants")
    uid = next(it["uuid"] for it in lst.json()["items"] if it["name"] == "Timey")

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


# --- Tests for list_plant_names endpoint (lines 36-64) ---


class FakeCursorNames:
    """Cursor that returns plant names for list_plant_names tests."""
    def __init__(self, rows=None):
        self._rows = rows or []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        return len(self._rows)

    def fetchall(self):
        return self._rows


class FakeConnNames:
    """Connection for list_plant_names tests."""
    def __init__(self, rows=None, close_raises=False):
        self._cursor = FakeCursorNames(rows=rows)
        self._close_raises = close_raises
        self._closed = False

    def cursor(self):
        return self._cursor

    def close(self):
        if self._close_raises:
            raise Exception("close failed")
        self._closed = True


@pytest.mark.anyio
async def test_list_plant_names_returns_plants(async_client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    """Test list_plant_names endpoint returns plant names (lines 36-57)."""
    import backend.app.routes.plants as plants_mod

    # Create fake rows with binary plant IDs
    pid1 = bytes.fromhex("11" * 16)
    pid2 = bytes.fromhex("22" * 16)
    rows = [
        (pid1, "Aloe"),
        (pid2, "Fern"),
    ]

    monkeypatch.setattr(plants_mod, "get_conn", lambda: FakeConnNames(rows=rows))

    resp = await async_client.get("/api/plants/names")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["name"] == "Aloe"
    assert data[1]["name"] == "Fern"


@pytest.mark.anyio
async def test_list_plant_names_skips_invalid_entries(async_client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    """Test list_plant_names skips rows with None uuid or name (lines 53-55)."""
    import backend.app.routes.plants as plants_mod

    pid1 = bytes.fromhex("33" * 16)
    rows = [
        (None, "NoId"),       # skip: no id
        (pid1, None),         # skip: no name
        (pid1, "ValidPlant"), # include
    ]

    monkeypatch.setattr(plants_mod, "get_conn", lambda: FakeConnNames(rows=rows))

    resp = await async_client.get("/api/plants/names")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "ValidPlant"


@pytest.mark.anyio
async def test_list_plant_names_close_exception(async_client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    """Test list_plant_names handles close() exception gracefully (lines 59-62)."""
    import backend.app.routes.plants as plants_mod

    pid1 = bytes.fromhex("44" * 16)
    rows = [(pid1, "Plant")]

    monkeypatch.setattr(plants_mod, "get_conn", lambda: FakeConnNames(rows=rows, close_raises=True))

    # Should not raise, exception is caught
    resp = await async_client.get("/api/plants/names")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1


@pytest.mark.anyio
async def test_list_plant_names_empty(async_client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    """Test list_plant_names returns empty list when no plants (lines 47, 49-57)."""
    import backend.app.routes.plants as plants_mod

    monkeypatch.setattr(plants_mod, "get_conn", lambda: FakeConnNames(rows=[]))

    resp = await async_client.get("/api/plants/names")
    assert resp.status_code == 200
    data = resp.json()
    assert data == []


# --- Tests for pagination validation (lines 76-79) ---


@pytest.mark.anyio
async def test_list_plants_page_less_than_one(async_client: AsyncClient):
    """Test list_plants raises 400 when page < 1 (line 77)."""
    resp = await async_client.get("/api/plants?page=0")
    assert resp.status_code == 400
    assert "page must be >= 1" in resp.json()["detail"]


@pytest.mark.anyio
async def test_list_plants_limit_less_than_one(async_client: AsyncClient):
    """Test list_plants raises 400 when limit < 1 (line 79)."""
    resp = await async_client.get("/api/plants?limit=0")
    assert resp.status_code == 400
    assert "limit must be between 1 and 100" in resp.json()["detail"]


@pytest.mark.anyio
async def test_list_plants_limit_greater_than_100(async_client: AsyncClient):
    """Test list_plants raises 400 when limit > 100 (line 79)."""
    resp = await async_client.get("/api/plants?limit=101")
    assert resp.status_code == 400
    assert "limit must be between 1 and 100" in resp.json()["detail"]
