import asyncio
from datetime import datetime, timedelta
from typing import List, Dict

import pytest

from backend.app.helpers.plants_list import PlantsList


@pytest.mark.anyio
async def test_daily_health_ok(async_client):
    resp = await async_client.get("/api/daily/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data == {"status": "ok"}


@pytest.mark.anyio
async def test_daily_care_uses_default_threshold_and_shapes_response(monkeypatch, async_client):
    called_with: dict = {}

    sample_items: List[Dict] = [
        {
            "id": 1,
            "uuid": None,
            "name": "Aloe Vera",
            "description": "Succulent",
            "species": "Aloe",
            "location": "Kitchen",
            "location_id": None,
            "created_at": datetime.utcnow() - timedelta(days=1),
            "water_loss_total_pct": 80.0,
        }
    ]

    def fake_fetch_all(min_water_loss_total_pct=None):
        called_with["arg"] = min_water_loss_total_pct
        return sample_items

    monkeypatch.setattr(PlantsList, "fetch_all", staticmethod(fake_fetch_all))

    resp = await async_client.get("/api/daily")
    assert resp.status_code == 200
    body = resp.json()

    # Assert default parameter was used by the route (70 as per Query default)
    assert called_with["arg"] == 70

    # Response conforms to DailyCareResponse model
    assert body["status"] == "ok"
    assert isinstance(body["items"], list)
    assert body["items"][0]["name"] == "Aloe Vera"
    assert body["items"][0]["water_loss_total_pct"] == 80.0


@pytest.mark.anyio
async def test_daily_care_passes_through_custom_threshold(monkeypatch, async_client):
    seen = {}

    def fake_fetch_all(min_water_loss_total_pct=None):
        seen["arg"] = min_water_loss_total_pct
        return [
            {
                "id": 1,
                "uuid": None,
                "name": "Monstera",
                "description": None,
                "species": "Monstera deliciosa",
                "location": None,
                "location_id": None,
                "created_at": datetime.utcnow(),
                "water_loss_total_pct": 55.5,
            }
        ]

    monkeypatch.setattr(PlantsList, "fetch_all", staticmethod(fake_fetch_all))

    resp = await async_client.get(
        "/api/daily", params={"min_water_loss_total_pct": 50.5}
    )
    assert resp.status_code == 200
    payload = resp.json()

    # Ensure our parameter was forwarded to the helper
    assert pytest.approx(seen["arg"], rel=1e-6) == 50.5

    # Ensure payload reflects mocked data
    assert payload["status"] == "ok"
    assert payload["items"][0]["name"] == "Monstera"
    assert payload["items"][0]["water_loss_total_pct"] == 55.5
