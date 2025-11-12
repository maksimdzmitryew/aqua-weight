import asyncio
import pytest
from httpx import AsyncClient
from backend.app.routes.plants import _validate_and_update_order


@pytest.mark.anyio
async def test_list_plants_initially_empty_and_after_create(async_client: AsyncClient):
    # Reset DB
    r = await async_client.post("/api/test/reset")
    assert r.status_code == 200

    # Initially empty list
    r = await async_client.get("/api/plants")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
    assert r.json() == []

    # Create a plant
    r = await async_client.post("/api/plants", json={"name": "Alpha"})
    assert r.status_code == 200
    data = r.json()
    assert data.get("ok") is True
    assert data.get("name") == "Alpha"

    # List should contain Alpha
    r = await async_client.get("/api/plants")
    items = r.json()
    assert any(item["name"] == "Alpha" for item in items)


async def _create_and_get_uuid(async_client: AsyncClient, name: str) -> str:
    resp = await async_client.post("/api/plants", json={"name": name})
    assert resp.status_code == 200
    # Find it by name in list to get uuid
    r = await async_client.get("/api/plants")
    items = r.json()
    for it in items:
        if it["name"] == name:
            assert it["uuid"] and len(it["uuid"]) == 32
            return it["uuid"]
    raise AssertionError("Created plant not found in list")


@pytest.mark.anyio
async def test_create_plant_validation(async_client: AsyncClient):
    await async_client.post("/api/test/reset")

    # Empty/whitespace name -> 400
    r = await async_client.post("/api/plants", json={"name": "   \t  "})
    assert r.status_code == 400
    assert r.json()["detail"] == "Name cannot be empty"

    # Provide datetime fields to exercise to_dt in create
    r = await async_client.post(
        "/api/plants",
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
    await async_client.post("/api/test/reset")

    # Invalid id
    r = await async_client.get("/api/plants/abc")
    assert r.status_code == 400
    assert r.json()["detail"] == "Invalid plant id"

    # Non-existent valid id
    missing_id = "f" * 32
    r = await async_client.get(f"/api/plants/{missing_id}")
    assert r.status_code == 404
    assert r.json()["detail"] == "Plant not found"

    # Create and fetch
    uid = await _create_and_get_uuid(async_client, "Bravo")
    r = await async_client.get(f"/api/plants/{uid}")
    assert r.status_code == 200
    item = r.json()
    assert item["uuid"] == uid
    assert item["name"] == "Bravo"


@pytest.mark.anyio
async def test_update_plant_happy_and_errors(async_client: AsyncClient):
    await async_client.post("/api/test/reset")

    # Invalid id -> 400
    r = await async_client.put("/api/plants/xyz", json={"name": "X"})
    assert r.status_code == 400
    assert r.json()["detail"] == "Invalid id"

    # Non-existent valid id -> 404
    missing_id = "a" * 32
    r = await async_client.put(f"/api/plants/{missing_id}", json={"description": "d"})
    assert r.status_code == 404
    assert r.json()["detail"] == "Plant not found"

    # Empty name -> 400 (validation branch)
    uid = await _create_and_get_uuid(async_client, "Charlie")
    r = await async_client.put(f"/api/plants/{uid}", json={"name": "   "})
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
    r = await async_client.put(f"/api/plants/{uid}", json=payload)
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # Verify via GET
    g = await async_client.get(f"/api/plants/{uid}")
    assert g.status_code == 200
    item = g.json()
    assert item["name"] == "Charlie Prime"


@pytest.mark.anyio
async def test_reorder_plants_endpoint_and_helper_errors(async_client: AsyncClient):
    await async_client.post("/api/test/reset")

    # Empty list -> 400 via endpoint
    r = await async_client.put("/api/plants/order", json={"ordered_ids": []})
    assert r.status_code == 400
    assert r.json()["detail"] == "ordered_ids cannot be empty"

    # Empty list -> 400 via helper directly (covers _validate_and_update_order branch)
    with pytest.raises(Exception):
        _validate_and_update_order("plants", [])

    # Non-existent ids -> 400
    r = await async_client.put(
        "/api/plants/order",
        json={"ordered_ids": ["1" * 32, "2" * 32]},
    )
    assert r.status_code == 400
    assert r.json()["detail"] in {"Some ids do not exist or are archived", "Some ids do not exist"}

    # Create two plants
    a = await _create_and_get_uuid(async_client, "Delta")
    b = await _create_and_get_uuid(async_client, "Echo")

    # Use helper to reorder: a before b
    _validate_and_update_order("plants", [a, b])

    # Verify order a, b
    r = await async_client.get("/api/plants")
    names = [it["name"] for it in r.json()]
    assert names[:2] == ["Delta", "Echo"]

    # Then via endpoint reorder: b before a
    r = await async_client.put(
        "/api/plants/order",
        json={"ordered_ids": [b, a]},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # Verify list order is Echo, then Delta
    r = await async_client.get("/api/plants")
    names = [it["name"] for it in r.json()]
    assert names[:2] == ["Echo", "Delta"]


@pytest.mark.anyio
async def test_delete_plant_happy_and_errors(async_client: AsyncClient):
    await async_client.post("/api/test/reset")

    # Invalid id
    r = await async_client.delete("/api/plants/zzz")
    assert r.status_code == 400
    assert r.json()["detail"] == "Invalid id"

    # Valid but missing
    missing_id = "e" * 32
    r = await async_client.delete(f"/api/plants/{missing_id}")
    assert r.status_code == 404
    assert r.json()["detail"] == "Plant not found"

    # Create and delete
    uid = await _create_and_get_uuid(async_client, "Foxtrot")
    r = await async_client.delete(f"/api/plants/{uid}")
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # Confirm gone
    r = await async_client.get(f"/api/plants/{uid}")
    assert r.status_code == 404
