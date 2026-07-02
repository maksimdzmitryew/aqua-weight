import pytest
import httpx


@pytest.mark.integration
@pytest.mark.asyncio
async def test_plant_crud_flow(client: httpx.AsyncClient, admin_token, auth_headers):
    """Test the full plant lifecycle: create, read, update, delete."""
    # Create a plant
    create_resp = await client.post(
        "/plants",
        json={"name": "Integration Test Fern", "notes": "Original notes"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert create_resp.status_code == 201
    plant = create_resp.json()
    plant_uuid = plant["uuid"]
    assert plant["name"] == "Integration Test Fern"

    # Read the plant
    get_resp = await client.get(f"/plants/{plant_uuid}", headers=auth_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["name"] == "Integration Test Fern"

    # Update the plant
    update_resp = await client.patch(
        f"/plants/{plant_uuid}",
        json={"name": "Updated Fern", "notes": "Updated notes"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert update_resp.status_code == 200

    # Verify update
    get_resp2 = await client.get(f"/plants/{plant_uuid}", headers=auth_headers)
    assert get_resp2.json()["name"] == "Updated Fern"

    # Delete the plant
    delete_resp = await client.delete(f"/plants/{plant_uuid}", headers=auth_headers)
    assert delete_resp.status_code == 200

    # Verify deletion
    get_resp3 = await client.get(f"/plants/{plant_uuid}", headers=auth_headers)
    assert get_resp3.status_code == 404
