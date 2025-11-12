import asyncio
import uuid
from datetime import datetime, timedelta

import pytest

from backend.app.db import get_conn


API_BASE = "/api/locations"


@pytest.fixture(autouse=True)
def _clean_db() -> None:
    # Hard cleanup before each test to ensure isolation
    conn = get_conn()
    try:
        conn.autocommit(True)
        with conn.cursor() as cur:
            # Remove dependent rows first
            cur.execute("DELETE FROM plants")
            cur.execute("DELETE FROM locations")
    finally:
        conn.close()


def insert_location(name: str, description: str | None = None, sort_order: int = 0, created_at: datetime | None = None) -> str:
    """Insert a location and return its hex id string."""
    hex_id = uuid.uuid4().hex
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if created_at is None:
                cur.execute(
                    "INSERT INTO locations (id, name, description, sort_order) VALUES (UNHEX(%s), %s, %s, %s)",
                    (hex_id, name, description, sort_order),
                )
            else:
                cur.execute(
                    "INSERT INTO locations (id, name, description, sort_order, created_at) VALUES (UNHEX(%s), %s, %s, %s, %s)",
                    (hex_id, name, description, sort_order, created_at),
                )
        return hex_id
    finally:
        conn.close()


def insert_plant_with_location(location_hex: str) -> str:
    plant_id = uuid.uuid4().hex
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO plants (id, name, location_id) VALUES (UNHEX(%s), %s, UNHEX(%s))",
                (plant_id, f"Plant-{plant_id[:6]}", location_hex),
            )
        return plant_id
    finally:
        conn.close()


@pytest.mark.anyio
async def test_list_locations_orders_by_sort_created_name(async_client):
    now = datetime.utcnow()
    # Two with same sort_order to test created_at DESC within same sort
    l1 = insert_location("A", sort_order=1, created_at=now - timedelta(minutes=5))
    l2 = insert_location("B", sort_order=1, created_at=now - timedelta(minutes=1))
    l3 = insert_location("C", sort_order=0, created_at=now - timedelta(minutes=3))

    resp = await async_client.get(API_BASE)
    assert resp.status_code == 200
    data = resp.json()
    # Expect l3 first (sort_order 0), then among l1/l2 (sort 1) newer first -> l2 then l1
    uuids = [item["uuid"] for item in data]
    assert uuids == [l3, l2, l1]
    # Validate fields presence
    assert all("name" in item and "created_at" in item for item in data)


@pytest.mark.anyio
async def test_create_location_success_and_normalization(async_client):
    payload = {"name": "  New   Name  ", "description": "desc", "sort_order": 3}
    resp = await async_client.post(API_BASE, json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["name"] == "New Name"  # normalized
    assert "created_at" in body

    # Ensure it exists in DB
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM locations WHERE name=%s", ("New Name",))
            assert cur.fetchone()[0] == 1
    finally:
        conn.close()


@pytest.mark.anyio
async def test_create_location_empty_name_400(async_client):
    resp = await async_client.post(API_BASE, json={"name": "   ", "description": None, "sort_order": 0})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Name cannot be empty"


@pytest.mark.anyio
async def test_create_location_duplicate_409(async_client):
    insert_location("Duplicates")
    resp = await async_client.post(API_BASE, json={"name": "Duplicates"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Location name already exists"


@pytest.mark.anyio
async def test_update_location_by_name_empty_new_name_400(async_client):
    resp = await async_client.put(f"{API_BASE}/by-name", json={"original_name": "X", "name": "   "})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Name cannot be empty"


@pytest.mark.anyio
async def test_update_location_by_name_update_existing(async_client):
    insert_location("Alpha")
    resp = await async_client.put(f"{API_BASE}/by-name", json={"original_name": "Alpha", "name": "Beta"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["created"] is False
    assert body["rows_affected"] >= 1
    assert body["name"] == "Beta"

    # DB reflects rename
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM locations WHERE name=%s", ("Beta",))
            assert cur.fetchone()[0] == 1
            cur.execute("SELECT COUNT(*) FROM locations WHERE name=%s", ("Alpha",))
            assert cur.fetchone()[0] == 0
    finally:
        conn.close()


@pytest.mark.anyio
async def test_update_location_by_name_noop_same_normalized(async_client):
    insert_location("Gamma")
    resp = await async_client.put(f"{API_BASE}/by-name", json={"original_name": "Gamma", "name": "   Gamma  "})
    assert resp.status_code == 200
    body = resp.json()
    assert body["rows_affected"] == 0
    assert body["created"] is False


@pytest.mark.anyio
async def test_update_location_by_name_create_when_missing(async_client):
    resp = await async_client.put(f"{API_BASE}/by-name", json={"original_name": "Does Not Exist", "name": "Created Name"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] is True
    assert body["rows_affected"] == 1

    # Exists in DB now
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM locations WHERE name=%s", ("Created Name",))
            assert cur.fetchone()[0] == 1
    finally:
        conn.close()


@pytest.mark.anyio
async def test_update_location_by_name_conflict_409(async_client):
    insert_location("One")
    insert_location("Two")
    resp = await async_client.put(f"{API_BASE}/by-name", json={"original_name": "Three", "name": "Two"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Location name already exists"


@pytest.mark.anyio
async def test_delete_location_invalid_id_400(async_client):
    resp = await async_client.delete(f"{API_BASE}/not-a-hex")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid id"


@pytest.mark.anyio
async def test_delete_location_conflict_has_plants_409(async_client):
    loc_id = insert_location("Loc With Plant")
    insert_plant_with_location(loc_id)
    resp = await async_client.delete(f"{API_BASE}/{loc_id}")
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Cannot delete location: it has plants assigned"


@pytest.mark.anyio
async def test_delete_location_not_found_404(async_client):
    random_id = uuid.uuid4().hex
    resp = await async_client.delete(f"{API_BASE}/{random_id}")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Location not found"


@pytest.mark.anyio
async def test_delete_location_success(async_client):
    loc_id = insert_location("Delete Me")
    resp = await async_client.delete(f"{API_BASE}/{loc_id}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    # Ensure removed
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM locations WHERE id=UNHEX(%s)", (loc_id,))
            assert cur.fetchone()[0] == 0
    finally:
        conn.close()


@pytest.mark.anyio
async def test_reorder_locations_empty_list_400(async_client):
    resp = await async_client.put(f"{API_BASE}/order", json={"ordered_ids": []})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "ordered_ids cannot be empty"


@pytest.mark.anyio
async def test_reorder_locations_missing_ids_400(async_client):
    l1 = insert_location("L1")
    missing = uuid.uuid4().hex
    resp = await async_client.put(f"{API_BASE}/order", json={"ordered_ids": [l1, missing]})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Some ids do not exist"


@pytest.mark.anyio
async def test_reorder_locations_success_and_list_reflects(async_client):
    l1 = insert_location("L1", sort_order=5)
    l2 = insert_location("L2", sort_order=3)
    l3 = insert_location("L3", sort_order=1)

    # New order: l3, l1, l2
    resp = await async_client.put(f"{API_BASE}/order", json={"ordered_ids": [l3, l1, l2]})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # Listing should reflect sort_order 1..n applied as given
    resp2 = await async_client.get(API_BASE)
    assert resp2.status_code == 200
    data = resp2.json()
    uuids = [item["uuid"] for item in data]
    assert uuids == [l3, l1, l2]


@pytest.mark.anyio
async def test_update_location_by_name_conflict_when_both_exist(async_client):
    insert_location("Orig")
    insert_location("Used")
    resp = await async_client.put(f"{API_BASE}/by-name", json={"original_name": "Orig", "name": "Used"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Location name already exists"


class _BoomCursor:
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False
    def execute(self, *args, **kwargs):
        raise RuntimeError("boom execute")
    def fetchone(self):
        return None

class _BoomConn:
    def __init__(self):
        self._closed = False
    def autocommit(self, value):
        pass
    def cursor(self):
        return _BoomCursor()
    def commit(self):
        raise RuntimeError("boom commit")
    def rollback(self):
        # Raising here should exercise the inner except around rollback
        raise RuntimeError("boom rollback")
    def close(self):
        self._closed = True


@pytest.mark.anyio
async def test_create_location_rollback_inner_except(monkeypatch, app):
    from backend.app.routes import locations as loc_mod
    from httpx import AsyncClient, ASGITransport
    monkeypatch.setattr(loc_mod, "get_conn", lambda: _BoomConn())
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(API_BASE, json={"name": "X"})
    # Unhandled error -> 500 from global handler
    assert resp.status_code == 500


@pytest.mark.anyio
async def test_update_location_rollback_inner_except(monkeypatch, app):
    from backend.app.routes import locations as loc_mod
    from httpx import AsyncClient, ASGITransport
    monkeypatch.setattr(loc_mod, "get_conn", lambda: _BoomConn())
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.put(f"{API_BASE}/by-name", json={"original_name": "A", "name": "B"})
    assert resp.status_code == 500


@pytest.mark.anyio
async def test_delete_location_rollback_inner_except(monkeypatch, app):
    from backend.app.routes import locations as loc_mod
    from httpx import AsyncClient, ASGITransport
    monkeypatch.setattr(loc_mod, "get_conn", lambda: _BoomConn())
    some_hex = uuid.uuid4().hex
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.delete(f"{API_BASE}/{some_hex}")
    assert resp.status_code == 500


@pytest.mark.anyio
async def test_reorder_locations_rollback_inner_except(monkeypatch, app):
    from backend.app.routes import locations as loc_mod
    from httpx import AsyncClient, ASGITransport
    monkeypatch.setattr(loc_mod, "get_conn", lambda: _BoomConn())
    # Needs non-empty list to reach DB block
    ids = [uuid.uuid4().hex]
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.put(f"{API_BASE}/order", json={"ordered_ids": ids})
    assert resp.status_code == 500
