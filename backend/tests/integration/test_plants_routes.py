import asyncio
import os
import uuid

import pytest
from httpx import AsyncClient

from backend.app.db import get_conn
from backend.app.routes.plants import _validate_and_update_order


API_KEY = "test_api_key_for_testing"


@pytest.fixture(autouse=True)
def _clean_db() -> None:
    """Ensure a clean DB state and a test admin user for auth fallback."""
    os.environ.setdefault("API_KEY", API_KEY)
    conn = get_conn()
    try:
        conn.autocommit(True)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM plants")
            cur.execute("DELETE FROM locations")
            cur.execute("DELETE FROM users")
            admin_uid = uuid.uuid4().hex
            cur.execute(
                "INSERT INTO users (id, username, password_hash, global_role, settings_json) VALUES (UNHEX(%s), %s, %s, %s, %s)",
                (admin_uid, "test_admin", "hashed", "admin", "{}"),
            )
    finally:
        conn.close()


async def _create_and_get_uuid(async_client: AsyncClient, name: str) -> str:
    resp = await async_client.post("/api/plants", headers={"X-API-Key": API_KEY}, json={"name": name})
    assert resp.status_code == 200
    # Find it by name in list to get uuid (paginated response)
    r = await async_client.get("/api/plants", headers={"X-API-Key": API_KEY})
    data = r.json()
    items = data["items"]
    for it in items:
        if it["name"] == name:
            assert it["uuid"] and len(it["uuid"]) == 32
            return it["uuid"]
    raise AssertionError("Created plant not found in list")


@pytest.mark.anyio
async def test_list_plants_initially_empty_and_after_create(async_client: AsyncClient):
    # Initially empty list (paginated response)
    r = await async_client.get("/api/plants", headers={"X-API-Key": API_KEY})
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict)
    assert "items" in data
    assert "total" in data
    assert "global_total" in data
    assert data["items"] == []
    assert data["total"] == 0
    assert data["global_total"] == 0

    # Create a plant
    r = await async_client.post("/api/plants", headers={"X-API-Key": API_KEY}, json={"name": "Alpha"})
    assert r.status_code == 200
    plant_data = r.json()
    assert plant_data.get("ok") is True
    assert plant_data.get("name") == "Alpha"

    # List should contain Alpha (paginated response)
    r = await async_client.get("/api/plants", headers={"X-API-Key": API_KEY})
    data = r.json()
    assert any(item["name"] == "Alpha" for item in data["items"])


@pytest.mark.anyio
async def test_create_plant_validation(async_client: AsyncClient):
    # Empty/whitespace name -> 400
    r = await async_client.post("/api/plants", headers={"X-API-Key": API_KEY}, json={"name": "   \t  "})
    assert r.status_code == 400
    assert r.json()["detail"] == "Name cannot be empty"

    # Provide datetime fields to exercise to_dt in create
    r = await async_client.post(
        "/api/plants",
        headers={"X-API-Key": API_KEY},
        json={
            "name": "With Dates",
            "substrate_last_refresh_at": "2024-12-31T23:59",
            "fertilized_last_at": "2025-01-01T00:00:01",
        },
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True


@pytest.mark.anyio
async def test_get_plant_happy_and_errors(async_client: AsyncClient):
    # Invalid id
    r = await async_client.get("/api/plants/abc", headers={"X-API-Key": API_KEY})
    assert r.status_code == 400
    assert r.json()["detail"] == "Invalid plant ID format"

    # Non-existent valid id
    missing_id = "f" * 32
    r = await async_client.get(f"/api/plants/{missing_id}", headers={"X-API-Key": API_KEY})
    assert r.status_code == 404
    assert r.json()["detail"] == "Plant not found"

    # Create and fetch
    uid = await _create_and_get_uuid(async_client, "Bravo")
    r = await async_client.get(f"/api/plants/{uid}", headers={"X-API-Key": API_KEY})
    assert r.status_code == 200
    item = r.json()
    assert item["uuid"] == uid
    assert item["name"] == "Bravo"


@pytest.mark.anyio
async def test_update_plant_happy_and_errors(async_client: AsyncClient):
    # Invalid id -> 400
    r = await async_client.patch("/api/plants/xyz", headers={"X-API-Key": API_KEY}, json={"name": "X"})
    assert r.status_code == 400
    assert r.json()["detail"] == "Invalid plant ID format"

    # Non-existent valid id -> 200 (UPDATE affects 0 rows, no existence check in PATCH)
    missing_id = "a" * 32
    r = await async_client.patch(f"/api/plants/{missing_id}", headers={"X-API-Key": API_KEY}, json={"description": "d"})
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # Empty name -> 400 (validation branch)
    uid = await _create_and_get_uuid(async_client, "Charlie")
    r = await async_client.patch(f"/api/plants/{uid}", headers={"X-API-Key": API_KEY}, json={"name": "   "})
    assert r.status_code == 400
    assert r.json()["detail"] == "Name cannot be empty"

    # Happy update: change multiple fields including datetime strings normalization paths
    payload = {
        "name": "Charlie Prime",
        "description": "desc",
        "species_name": "Spec",
        "botanical_name": "Bot",
        "cultivar": "Cult",
        # keep foreign-keys None to avoid constraints
        "substrate_last_refresh_at": "2025-01-01T10:20",
        "fertilized_last_at": "2025-01-02T01:02:03",
        "fertilizer_ec_ms": 1.5,
        "photo_url": "http://example/image.jpg",
    }
    r = await async_client.patch(f"/api/plants/{uid}", headers={"X-API-Key": API_KEY}, json=payload)
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # Verify via GET
    g = await async_client.get(f"/api/plants/{uid}", headers={"X-API-Key": API_KEY})
    assert g.status_code == 200
    item = g.json()
    assert item["name"] == "Charlie Prime"


@pytest.mark.anyio
async def test_reorder_plants_endpoint_and_helper_errors(async_client: AsyncClient):
    # Empty list -> 400 via endpoint
    r = await async_client.put("/api/plants/order", headers={"X-API-Key": API_KEY}, json={"ordered_ids": []})
    assert r.status_code == 400
    assert r.json()["detail"] == "ordered_ids cannot be empty"

    # Empty list -> 400 via helper directly (covers _validate_and_update_order branch)
    with pytest.raises(Exception):
        _validate_and_update_order("plants", [])

    # Non-existent ids -> 400
    r = await async_client.put(
        "/api/plants/order",
        headers={"X-API-Key": API_KEY},
        json={"ordered_ids": ["1" * 32, "2" * 32]},
    )
    assert r.status_code == 400
    assert r.json()["detail"] in {"Some ids do not exist or are archived", "Some ids do not exist"}

    # Create two plants
    a = await _create_and_get_uuid(async_client, "Delta")
    b = await _create_and_get_uuid(async_client, "Echo")

    # Use helper to reorder: a before b
    _validate_and_update_order("plants", [a, b])

    # Verify order a, b (paginated response)
    r = await async_client.get("/api/plants", headers={"X-API-Key": API_KEY})
    data = r.json()
    names = [it["name"] for it in data["items"]]
    assert names[:2] == ["Delta", "Echo"]

    # Then via endpoint reorder: b before a
    r = await async_client.put(
        "/api/plants/order",
        headers={"X-API-Key": API_KEY},
        json={"ordered_ids": [b, a]},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # Verify list order is Echo, then Delta (paginated response)
    r = await async_client.get("/api/plants", headers={"X-API-Key": API_KEY})
    data = r.json()
    names = [it["name"] for it in data["items"]]
    assert names[:2] == ["Echo", "Delta"]


@pytest.mark.anyio
async def test_delete_plant_happy_and_errors(async_client: AsyncClient):
    # Invalid id
    r = await async_client.delete("/api/plants/zzz", headers={"X-API-Key": API_KEY})
    assert r.status_code == 400
    assert r.json()["detail"] == "Invalid plant ID format"

    # Valid but missing
    missing_id = "e" * 32
    r = await async_client.delete(f"/api/plants/{missing_id}", headers={"X-API-Key": API_KEY})
    assert r.status_code == 404
    assert r.json()["detail"] == "Plant not found"

    # Create and delete
    uid = await _create_and_get_uuid(async_client, "Foxtrot")
    r = await async_client.delete(f"/api/plants/{uid}", headers={"X-API-Key": API_KEY})
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # Confirm gone
    r = await async_client.get(f"/api/plants/{uid}", headers={"X-API-Key": API_KEY})
    assert r.status_code == 404
