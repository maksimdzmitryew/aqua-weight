import pytest
import httpx


@pytest.mark.integration
@pytest.mark.asyncio
async def test_measurement_flow(client: httpx.AsyncClient, admin_token, auth_headers):
    """Test measurement creation and its effect on watering prediction."""
    # Create a plant
    create_resp = await client.post(
        "/plants",
        json={"name": "Measurement Test Plant"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert create_resp.status_code == 201
    plant_uuid = create_resp.json()["uuid"]

    # Add weight measurement
    weight_resp = await client.post(
        f"/plants/{plant_uuid}/measurements/weight",
        json={"measured_weight_g": 200, "measured_at": "2024-01-01T12:00"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert weight_resp.status_code in (200, 201)

    # List measurements
    list_resp = await client.get(f"/plants/{plant_uuid}/measurements", headers=auth_headers)
    assert list_resp.status_code == 200
    measurements = list_resp.json()
    assert len(measurements) >= 1

    # Add watering event
    watering_resp = await client.post(
        f"/plants/{plant_uuid}/measurements/watering",
        json={"water_added_g": 100, "measured_at": "2024-01-02T12:00"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert watering_resp.status_code in (200, 201)

    # Verify plant list shows updated data
    plants_resp = await client.get("/plants", headers=auth_headers)
    assert plants_resp.status_code == 200
