import uuid
import pytest
from httpx import AsyncClient

from backend.app.db import get_conn


@pytest.mark.anyio
async def test_create_plant_hex_to_bytes_none_and_valid(async_client: AsyncClient):
    # Reset DB to a clean state
    r = await async_client.post("/api/test/reset")
    assert r.status_code == 200

    # 1) Create plant without any hex fields provided -> hex_to_bytes(None) path is exercised
    r = await async_client.post("/api/plants", json={"name": "No Hex Fields"})
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # 2) Insert a valid location to satisfy FK and create plant with location_id -> hex_to_bytes(validhex)
    location_hex = uuid.uuid4().hex
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO locations (id, name) VALUES (UNHEX(%s), %s)",
                (location_hex, "Test Location"),
            )
    finally:
        conn.close()

    r = await async_client.post(
        "/api/plants",
        json={
            "name": "With Location",
            "location_id": location_hex,
        },
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # Confirm the created plant appears in the list
    lr = await async_client.get("/api/plants")
    assert lr.status_code == 200
    items = lr.json()
    assert any(it["name"] == "With Location" for it in items)


async def _create_plant_and_get_uuid(async_client: AsyncClient, name: str) -> str:
    r = await async_client.post("/api/plants", json={"name": name})
    assert r.status_code == 200
    # Find uuid via list endpoint
    lr = await async_client.get("/api/plants")
    assert lr.status_code == 200
    for it in lr.json():
        if it["name"] == name:
            return it["uuid"]
    raise AssertionError("Created plant not found")


@pytest.mark.anyio
async def test_update_plant_uses_hex_to_bytes_with_valid_location(async_client: AsyncClient):
    # Reset DB
    r = await async_client.post("/api/test/reset")
    assert r.status_code == 200

    # Create initial plant
    plant_uuid = await _create_plant_and_get_uuid(async_client, "Updater")

    # Insert a location that we'll assign on update
    new_loc_hex = uuid.uuid4().hex
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO locations (id, name) VALUES (UNHEX(%s), %s)",
                (new_loc_hex, "Update Target Location"),
            )
    finally:
        conn.close()

    # Update: provide location_id (valid hex) to exercise hex_to_bytes regex/convert path
    ur = await async_client.put(
        f"/api/plants/{plant_uuid}",
        json={
            "name": "Updater v2",
            "location_id": new_loc_hex,
        },
    )
    assert ur.status_code == 200
    assert ur.json()["ok"] is True

    # Verify using GET that location was updated and uuid stays the same
    gr = await async_client.get(f"/api/plants/{plant_uuid}")
    assert gr.status_code == 200
    item = gr.json()
    assert item["uuid"] == plant_uuid
    assert item["name"] == "Updater v2"
    assert item["location_id"] == new_loc_hex
