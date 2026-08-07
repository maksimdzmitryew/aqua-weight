import pytest
from unittest.mock import Mock, MagicMock, patch
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, Request
from httpx import AsyncClient

from backend.app.routes import measurements as measurements_routes
from backend.app.db import get_conn_factory
from backend.app.security import require_authenticated_user, require_plant_access


@pytest.fixture(autouse=True, scope="module")
def _override_measurements_auth(app: FastAPI):
    """Bypass auth for all tests in this module since they test business logic, not auth."""
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "id": None,
        "id_hex": None,
        "username": "test_admin",
        "global_role": "admin",
    }

    def _bypass_plant_access(request: Request) -> str:
        plant_id = request.path_params.get("plant_id", "")
        if plant_id and not measurements_routes.HEX_RE.match(plant_id):
            raise HTTPException(status_code=400, detail="Invalid plant_id")
        return plant_id

    app.dependency_overrides[require_plant_access] = _bypass_plant_access
    yield
    app.dependency_overrides.pop(require_authenticated_user, None)
    app.dependency_overrides.pop(require_plant_access, None)


class _FakeCursor:
    """Fake cursor for mocking database operations in tests."""

    def __init__(
        self,
        *,
        rows_one=None,
        rows_all=None,
        delete_ok=True,
        not_found=False,
        raise_on_insert=False,
        raise_on_update=False,
    ):
        # rows for SELECT ... LIMIT 1
        self.rows_one = rows_one
        # rows for SELECT multiple
        self.rows_all = rows_all or []
        self._delete_ok = delete_ok
        self._not_found = not_found
        self.rowcount = 0
        self._last = None
        self.raise_on_insert = raise_on_insert
        self.raise_on_update = raise_on_update
        self._next_one = None
        self._next_all = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self._last = (sql, params)
        sql_norm = " ".join(sql.split()).lower()

        # Default: next_one is None, next_all is empty
        self._next_one = None
        self._next_all = []

        if sql_norm.startswith("select"):
            self._next_all = self.rows_all

            if "limit 1" in sql_norm:
                # Specialized mocks for common queries
                if (
                    "from plants_measurements" in sql_norm
                    and "last_dry_weight_g is not null" in sql_norm
                    and "group by" in sql_norm
                    and "having" in sql_norm
                ):
                    # get_last_repotting_event expects 10 columns
                    self._next_one = (
                        b"\x66" * 16,
                        datetime(2025, 1, 1),
                        150,
                        100,
                        None,
                        50,
                        None,
                        None,
                        None,
                        None,
                    )
                elif (
                    "from plants_measurements" in sql_norm
                    and "plant_id = unhex" in sql_norm
                    and "measured_at = %s" in sql_norm
                ):
                    # Second query in get_last_repotting_event
                    self._next_one = (
                        b"\x66" * 16,
                        datetime(2025, 1, 1),
                        150,
                        100,
                        None,
                        50,
                        None,
                        None,
                        None,
                        None,
                    )
                elif (
                    "from plants_measurements" in sql_norm
                    and "measured_weight_g is null" in sql_norm
                    and "water_loss_total_pct = 0" in sql_norm
                    and "water_added_g > 0" in sql_norm
                ):
                    # get_last_watering_event_since query
                    self._next_one = None
                elif "from plants " in sql_norm and "id = unhex" in sql_norm:
                    # plant info query
                    if self.rows_all is not None and len(self.rows_all) > 0:
                        self._next_one = self.rows_all[0]
                    else:
                        self._next_one = self.rows_one
                else:
                    self._next_one = self.rows_one
            elif "max(measured_at)" in sql_norm:
                self._next_one = [datetime.utcnow()]
            elif (
                " from plants " in sql_norm
                and " where " in sql_norm
                and "id = unhex" not in sql_norm
            ):
                if self.rows_all is not None and len(self.rows_all) > 0:
                    self._next_one = self.rows_all[0]
                else:
                    self._next_one = self.rows_one
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
    """Fake connection for mocking database operations in tests."""

    def __init__(self, cursor: _FakeCursor, *, raise_on_rollback: bool = False):
        self._cursor = cursor
        cursor.connection = self  # Back-reference for code that uses cur.connection
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
async def test_apply_measurements_corrections_no_excess(
    app: FastAPI, async_client: AsyncClient, monkeypatch
):
    """Test corrections when no measurements exceed the cap (edited from test_water_loss.py)."""
    plant_id = "aa" * 16

    # Mock all the required dependencies
    cur = _FakeCursor()
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    # Setup the fake cursor responses
    cur.rows_one = (100, 200, 100)  # min_dry, max_water, rec_pct (plant params)
    cur.rows_all = []  # no watering events

    # When - call the endpoint
    r = await async_client.post(
        f"/api/plants/{plant_id}/measurements/corrections",
        json={
            "from_ts": None,
            "to_ts": None,
            "cap": "capacity",
            "edit_last_wet": True,
        },
    )

    # Then
    assert r.status_code == 200
    data = r.json()
    assert data == {"updated": 0, "total_excess_g": 0, "details": []}

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_apply_measurements_corrections_capacity_cap_mode(
    app: FastAPI, async_client: AsyncClient, monkeypatch
):
    """Test corrections with capacity cap mode (edited from test_water_loss.py)."""
    plant_id = "aa" * 16

    # Mock the cursor responses
    cur = _FakeCursor()
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    # Setup plant params
    cur.rows_one = (100, 200, 100)  # min_dry, max_water, rec_pct

    # Setup watering events that exceed capacity
    cur.rows_all = [
        (
            b"1" * 16,
            datetime(2025, 1, 1),
            500,
            450,
        ),  # id, measured_at, water_added_g, last_wet_weight_g
    ]

    # When - call the endpoint with explicit time window to avoid get_last_repotting_event call
    r = await async_client.post(
        f"/api/plants/{plant_id}/measurements/corrections",
        json={
            "from_ts": datetime(2024, 12, 31, 23, 59, 59).isoformat(),
            "to_ts": datetime(2025, 1, 2, 0, 0, 1).isoformat(),
            "cap": "capacity",
            "edit_last_wet": True,
        },
    )

    # Then
    assert r.status_code == 200
    data = r.json()
    assert data["updated"] == 1
    assert data["total_excess_g"] == 150  # 450 - (100 + 200)
    assert len(data["details"]) == 1
    assert data["details"][0]["excess_g"] == 150
    assert data["details"][0]["new_water_added_g"] == 350  # 500 - 150

    # Verify the update query was called
    # Check through the injected cursor
    assert cur._last is not None
    sql, params = cur._last
    assert "UPDATE plants_measurements" in sql
    assert "water_added_g" in sql

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_apply_measurements_corrections_retained_ratio_cap_mode(
    app: FastAPI, async_client: AsyncClient, monkeypatch
):
    """Test corrections with retained_ratio cap mode (edited from test_water_loss.py)."""
    plant_id = "aa" * 16

    # Mock the cursor responses
    cur = _FakeCursor()
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    # Setup plant params with 80% threshold
    cur.rows_one = (100, 200, 80)  # min_dry, max_water, rec_pct

    # Setup watering events that exceed retained ratio cap
    cur.rows_all = [
        (
            b"2" * 16,
            datetime(2025, 1, 1),
            500,
            460,
        ),  # id, measured_at, water_added_g, last_wet_weight_g
    ]

    # When - call the endpoint with explicit time window to avoid get_last_repotting_event call
    r = await async_client.post(
        f"/api/plants/{plant_id}/measurements/corrections",
        json={
            "from_ts": datetime(2024, 12, 31, 23, 59, 59).isoformat(),
            "to_ts": datetime(2025, 1, 2, 0, 0, 1).isoformat(),
            "cap": "retained_ratio",
            "edit_last_wet": True,
        },
    )

    # Then
    assert r.status_code == 200
    data = r.json()
    # Target = 100 + (80/100) * 200 = 260
    # Excess = 460 - 260 = 200
    # New water_added = 500 - 200 = 300
    assert data["updated"] == 1
    assert data["total_excess_g"] == 200
    assert len(data["details"]) == 1
    assert data["details"][0]["excess_g"] == 200
    assert data["details"][0]["new_water_added_g"] == 300

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_apply_measurements_corrections_invalid_cap_mode(
    app: FastAPI, async_client: AsyncClient, monkeypatch
):
    """Test corrections with invalid cap mode raises HTTPException."""
    plant_id = "aa" * 16

    # When/Then - should raise HTTPException with 400 status
    r = await async_client.post(
        f"/api/plants/{plant_id}/measurements/corrections",
        json={
            "from_ts": None,
            "to_ts": None,
            "cap": "invalid_mode",
            "edit_last_wet": True,
        },
    )

    assert r.status_code == 400
    data = r.json()
    assert "Invalid cap mode" in data["detail"]


@pytest.mark.asyncio
async def test_apply_measurements_corrections_calibration_incomplete(
    app: FastAPI, async_client: AsyncClient, monkeypatch
):
    """Test corrections when plant calibration is incomplete (no min_dry/max_water)."""
    plant_id = "aa" * 16

    # Mock the cursor responses
    cur = _FakeCursor()
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    # Setup incomplete calibration (no min_dry/max_water)
    cur.rows_one = (None, None, 100)  # No min_dry/max_water

    # When - call the endpoint
    r = await async_client.post(
        f"/api/plants/{plant_id}/measurements/corrections",
        json={
            "from_ts": None,
            "to_ts": None,
            "cap": "capacity",
            "edit_last_wet": True,
        },
    )

    # Then - should return empty results
    assert r.status_code == 200
    data = r.json()
    assert data == {"updated": 0, "total_excess_g": 0, "details": []}

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_apply_measurements_corrections_with_time_window(
    app: FastAPI, async_client: AsyncClient, monkeypatch
):
    """Test corrections with specific time window (from_ts/to_ts)."""
    plant_id = "aa" * 16

    # Mock the cursor responses
    cur = _FakeCursor()
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    # Setup plant params
    cur.rows_one = (100, 200, 100)  # min_dry, max_water, rec_pct

    # Setup watering events within the time window that need correction
    # The mock returns rows_all directly without filtering by WHERE clause
    cur.rows_all = [
        (b"3" * 16, datetime(2025, 6, 1), 500, 450),  # Exceeds target: 450 > 300, needs correction
    ]

    # When - call the endpoint with time window
    r = await async_client.post(
        f"/api/plants/{plant_id}/measurements/corrections",
        json={
            "from_ts": datetime(2025, 1, 1, 12, 0, 0).isoformat(),
            "to_ts": datetime(2025, 12, 31, 23, 59, 59).isoformat(),
            "cap": "capacity",
            "edit_last_wet": True,
        },
    )

    # Then
    assert r.status_code == 200
    data = r.json()
    # Only one event needs correction: 450 - 300 = 150 excess
    assert data["updated"] == 1
    assert data["total_excess_g"] == 150

    app.dependency_overrides.pop(get_conn_factory, None)


async def test_apply_measurements_corrections_edit_last_wet_false(
    app: FastAPI, async_client: AsyncClient, monkeypatch
):
    """Test corrections when edit_last_wet is false (only water_added_g updated)."""
    plant_id = "aa" * 16

    # Mock the cursor responses
    cur = _FakeCursor()
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    # Setup plant params
    cur.rows_one = (100, 200, 100)  # min_dry, max_water, rec_pct

    # Setup watering events
    cur.rows_all = [
        (b"6" * 16, datetime(2025, 1, 1), 500, 450),
    ]

    # When - call the endpoint with edit_last_wet = false
    r = await async_client.post(
        f"/api/plants/{plant_id}/measurements/corrections",
        json={
            "from_ts": None,
            "to_ts": None,
            "cap": "capacity",
            "edit_last_wet": False,
        },
    )

    # Then
    assert r.status_code == 200
    data = r.json()
    assert data["updated"] == 1
    assert data["total_excess_g"] == 150

    # Verify that UPDATE includes both water_added_g and last_wet_weight_g when edit_last_wet=True
    # (This would need a more sophisticated assertion on the mock)
    # For now, just verify the correction happened

    app.dependency_overrides.pop(get_conn_factory, None)


@pytest.mark.asyncio
async def test_apply_measurements_corrections_datetime_measured_at(
    app: FastAPI, async_client: AsyncClient, monkeypatch
):
    """Test corrections when last_repotting_event returns datetime for measured_at (line 588).

    This tests the branch where measured_at is already a datetime object instead of a string.
    Line 588: from_dt = last_repot.measured_at
    """
    plant_id = "aa" * 16

    # Mock the cursor responses
    cur = _FakeCursor()
    conn = _FakeConn(cur)
    app.dependency_overrides[get_conn_factory] = lambda: (lambda: conn)

    # Setup plant params
    cur.rows_one = (100, 200, 100)  # min_dry, max_water, rec_pct

    # Setup watering events that need correction
    cur.rows_all = [
        (b"7" * 16, datetime(2025, 1, 1), 500, 450),
    ]

    # Mock get_last_repotting_event to return a MeasurementItem-like object with datetime measured_at
    # Use a simple object to bypass Pydantic validation
    class FakeMeasurementItem:
        def __init__(self):
            self.id = "ff" * 16
            self.measured_at = datetime(2025, 1, 1)  # datetime, not string - triggers line 588
            self.measured_weight_g = 150
            self.last_dry_weight_g = 100
            self.last_wet_weight_g = 100
            self.water_added_g = 0

    fake_repot = FakeMeasurementItem()

    # Patch get_last_repotting_event at the module level
    import backend.app.routes.measurements as measurements_module

    original_get_last_repotting = measurements_module.get_last_repotting_event
    monkeypatch.setattr(
        measurements_module, "get_last_repotting_event", lambda conn, pid: fake_repot
    )

    # When - call the endpoint WITHOUT explicit time window to trigger get_last_repotting_event
    r = await async_client.post(
        f"/api/plants/{plant_id}/measurements/corrections",
        json={
            "from_ts": None,
            "to_ts": None,
            "cap": "capacity",
            "edit_last_wet": True,
        },
    )

    # Then
    assert r.status_code == 200
    data = r.json()
    assert data["updated"] == 1
    assert data["total_excess_g"] == 150  # 450 - (100 + 200)

    # Cleanup
    app.dependency_overrides.pop(get_conn_factory, None)
    monkeypatch.setattr(
        measurements_module, "get_last_repotting_event", original_get_last_repotting
    )
