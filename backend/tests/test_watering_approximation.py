import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from datetime import datetime, timedelta

@pytest.mark.asyncio
async def test_get_watering_approximation_success(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # Mock PlantsList.fetch_all
    mock_plants = [
        {
            "uuid": "0123456789abcdef0123456789abcdef",
            "water_retained_pct": 80.0,
            "frequency_days": 7,
            "next_watering_at": datetime(2025, 12, 30, 10, 0, 0),
        },
        {
            "uuid": "abcdef0123456789abcdef0123456789",
            "water_retained_pct": 40.0,
            "frequency_days": 3,
            "next_watering_at": None,
        }
    ]
    
    class MockPlantsList:
        @staticmethod
        def fetch_all():
            return mock_plants
            
    monkeypatch.setattr("backend.app.routes.measurements.PlantsList", MockPlantsList)
    
    response = await async_client.get("/api/measurements/approximation/watering")
    assert response.status_code == 200
    data = response.json()
    
    assert "items" in data
    assert len(data["items"]) == 2
    
    item1 = next(it for it in data["items"] if it["plant_uuid"] == "0123456789abcdef0123456789abcdef")
    assert item1["virtual_water_retained_pct"] == 80.0
    assert item1["frequency_days"] == 7
    assert "2025-12-30T10:00:00" in item1["next_watering_at"]
    
    item2 = next(it for it in data["items"] if it["plant_uuid"] == "abcdef0123456789abcdef0123456789")
    assert item2["virtual_water_retained_pct"] == 40.0
    assert item2["frequency_days"] == 3
    assert item2["next_watering_at"] is None
