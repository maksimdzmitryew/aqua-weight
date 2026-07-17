"""API contract tests — verify request/response schemas match Pydantic models."""

import pytest
import httpx


@pytest.mark.integration
@pytest.mark.asyncio
async def test_plant_list_schema(client: httpx.AsyncClient, auth_headers):
    """GET /api/plants returns PaginatedPlantsResponse schema."""
    resp = await client.get("/plants", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    # Verify top-level keys match PaginatedPlantsResponse
    assert "items" in data
    assert "total" in data
    assert "page" in data
    assert "limit" in data
    assert "total_pages" in data
    # Verify item shape
    if data["items"]:
        item = data["items"][0]
        assert "uuid" in item
        assert "name" in item
        assert "water_retained_pct" in item
        assert "needs_watering_prediction" in item


@pytest.mark.integration
@pytest.mark.asyncio
async def test_plant_create_valid_schema(client: httpx.AsyncClient, auth_headers):
    """POST /api/plants with valid payload returns 200/201."""
    resp = await client.post(
        "/plants",
        json={"name": "Contract Test Plant"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert resp.status_code in (200, 201)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_plant_create_invalid_schema(client: httpx.AsyncClient, auth_headers):
    """POST /api/plants with invalid payload returns 422."""
    resp = await client.post(
        "/plants",
        json={"invalid_field": "no_name"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert resp.status_code == 422


@pytest.mark.integration
@pytest.mark.asyncio
async def test_plant_detail_schema(client: httpx.AsyncClient, auth_headers):
    """GET /api/plants/{id} returns PlantDetail schema."""
    # Create a plant first
    create_resp = await client.post(
        "/plants",
        json={"name": "Detail Schema Test"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    plant = create_resp.json()
    plant_uuid = plant["uuid"]

    resp = await client.get(f"/plants/{plant_uuid}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "uuid" in data
    assert "name" in data
    assert data["name"] == "Detail Schema Test"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_plant_update_valid_schema(client: httpx.AsyncClient, auth_headers):
    """PATCH /api/plants/{id} with valid payload returns 200."""
    create_resp = await client.post(
        "/plants",
        json={"name": "Update Schema Test"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    plant_uuid = create_resp.json()["uuid"]

    resp = await client.patch(
        f"/plants/{plant_uuid}",
        json={"name": "Updated Schema Test"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert resp.status_code == 200


@pytest.mark.integration
@pytest.mark.asyncio
async def test_settings_schema(client: httpx.AsyncClient, auth_headers):
    """GET /api/settings returns settings schema."""
    resp = await client.get("/settings", headers=auth_headers)
    assert resp.status_code == 200


@pytest.mark.integration
@pytest.mark.asyncio
async def test_settings_update_schema(client: httpx.AsyncClient, auth_headers):
    """PUT /api/settings with valid payload returns 200/204."""
    resp = await client.put(
        "/settings",
        json={"settings": {"theme": "dark"}},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert resp.status_code in (200, 204)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_measurement_weight_schema(client: httpx.AsyncClient, auth_headers):
    """POST /api/plants/{id}/measurements/weight returns measurement schema."""
    create_resp = await client.post(
        "/plants",
        json={"name": "Measurement Schema Test"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    plant_uuid = create_resp.json()["uuid"]

    resp = await client.post(
        f"/plants/{plant_uuid}/measurements/weight",
        json={"measured_weight_g": 150, "measured_at": "2024-01-01T12:00"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert resp.status_code in (200, 201)
    data = resp.json()
    assert data["status"] == "success"
    assert "id" in data["data"]
    assert data["meta"]["timestamp"] == "2024-01-01T12:00:00"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_measurement_watering_schema(client: httpx.AsyncClient, auth_headers):
    """POST /api/plants/{id}/measurements/watering returns measurement schema."""
    create_resp = await client.post(
        "/plants",
        json={"name": "Watering Schema Test"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    plant_uuid = create_resp.json()["uuid"]

    resp = await client.post(
        f"/plants/{plant_uuid}/measurements/watering",
        json={"water_added_g": 100, "measured_at": "2024-01-01T12:00"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert resp.status_code in (200, 201)
    data = resp.json()
    assert data["status"] == "success"
    assert "id" in data["data"]
    assert data["meta"]["timestamp"] == "2024-01-01T12:00:00"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_invalid_sort_by_returns_error(client: httpx.AsyncClient, auth_headers):
    """Invalid sortBy value should be handled gracefully."""
    resp = await client.get("/plants?sortBy=invalid_column", headers=auth_headers)
    # Should either 400 or silently ignore (gracefully handle)
    assert resp.status_code in (200, 400)
