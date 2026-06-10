import pytest
from httpx import AsyncClient
from backend.app.helpers.plants_list import PlantsList


_API_KEY = {"X-API-Key": "test_api_key_for_testing"}


@pytest.mark.anyio
async def test_list_plant_uuids_basic(async_client: AsyncClient, monkeypatch):
    mock_data = [
        {
            "uuid": "uuid1",
            "water_retained_pct": 30,
            "water_loss_total_pct": 10,
            "recommended_water_threshold_pct": 20,
            "days_offset": 1,
        },
        {
            "uuid": "uuid2",
            "water_retained_pct": 10,
            "water_loss_total_pct": 20,
            "recommended_water_threshold_pct": 20,
            "days_offset": -1,
        },
    ]

    def mock_fetch_all(**kwargs):
        return mock_data

    monkeypatch.setattr("backend.app.routes.plants.PlantsList.fetch_all", mock_fetch_all)

    # Test without needs_watering filter
    resp = await async_client.get("/api/plants/uuids", headers=_API_KEY)
    assert resp.status_code == 200
    assert resp.json() == ["uuid1", "uuid2"]


@pytest.mark.anyio
async def test_list_plant_uuids_needs_watering_manual(async_client: AsyncClient, monkeypatch):
    mock_data = [
        # p["water_retained_pct"] <= thresh (10 <= 20) -> True
        {
            "uuid": "needs_water",
            "water_retained_pct": 10,
            "water_loss_total_pct": 20,
            "recommended_water_threshold_pct": 20,
            "days_offset": -1,
        },
        # p["water_retained_pct"] > thresh (30 > 20) -> False
        {
            "uuid": "no_needs_water",
            "water_retained_pct": 30,
            "water_loss_total_pct": 10,
            "recommended_water_threshold_pct": 20,
            "days_offset": 1,
        },
        # p["water_loss_total_pct"] == 0 and retained > 0 -> False
        {
            "uuid": "just_watered",
            "water_retained_pct": 100,
            "water_loss_total_pct": 0,
            "recommended_water_threshold_pct": 20,
            "days_offset": 7,
        },
        # p["water_loss_total_pct"] == 0 and retained is None -> False
        {
            "uuid": "just_watered_no_retained",
            "water_retained_pct": None,
            "water_loss_total_pct": 0,
            "recommended_water_threshold_pct": 20,
            "days_offset": 7,
        },
        # retained is None, days_offset <= 0 -> True
        {
            "uuid": "no_weight_needs_water",
            "water_retained_pct": None,
            "water_loss_total_pct": None,
            "recommended_water_threshold_pct": 20,
            "days_offset": 0,
        },
        # retained is None, days_offset > 0 -> False
        {
            "uuid": "no_weight_no_needs_water",
            "water_retained_pct": None,
            "water_loss_total_pct": None,
            "recommended_water_threshold_pct": 20,
            "days_offset": 1,
        },
    ]

    monkeypatch.setattr(
        "backend.app.routes.plants.PlantsList.fetch_all", lambda **kwargs: mock_data
    )

    resp = await async_client.get(
        "/api/plants/uuids", headers=_API_KEY, params={"needs_watering": "true"}
    )
    assert resp.status_code == 200
    assert resp.json() == ["needs_water", "no_weight_needs_water"]

    resp = await async_client.get(
        "/api/plants/uuids", headers=_API_KEY, params={"needs_watering": "false"}
    )
    assert resp.status_code == 200
    assert resp.json() == [
        "no_needs_water",
        "just_watered",
        "just_watered_no_retained",
        "no_weight_no_needs_water",
    ]


@pytest.mark.anyio
async def test_list_plant_uuids_needs_watering_vacation(async_client: AsyncClient, monkeypatch):
    mock_data = [
        {"uuid": "vacation_needs_water", "days_offset": 0},
        {"uuid": "vacation_no_needs_water", "days_offset": 1},
        {"uuid": "vacation_none_offset", "days_offset": None},
    ]

    monkeypatch.setattr(
        "backend.app.routes.plants.PlantsList.fetch_all", lambda **kwargs: mock_data
    )

    resp = await async_client.get(
        "/api/plants/uuids",
        headers=_API_KEY,
        params={"needs_watering": "true", "operationMode": "vacation"},
    )
    assert resp.status_code == 200
    assert resp.json() == ["vacation_needs_water"]

    resp = await async_client.get(
        "/api/plants/uuids",
        headers=_API_KEY,
        params={"needs_watering": "false", "operationMode": "vacation"},
    )
    assert resp.status_code == 200
    assert resp.json() == ["vacation_no_needs_water", "vacation_none_offset"]


@pytest.mark.anyio
async def test_list_plant_uuids_cookies_and_thresholds(async_client: AsyncClient, monkeypatch):
    captured = {}

    def mock_fetch_all(**kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr("backend.app.routes.plants.PlantsList.fetch_all", mock_fetch_all)

    # Test cookies
    headers = {"Cookie": "operationMode=vacation; defaultThreshold=40.5", **_API_KEY}
    await async_client.get("/api/plants/uuids", headers=headers)
    assert captured["mode"] == "vacation"
    assert captured["default_threshold"] == 40.5

    # Test query params override cookies
    await async_client.get(
        "/api/plants/uuids",
        params={"operationMode": "manual", "defaultThreshold": "50"},
        headers=headers,
    )
    assert captured["mode"] == "manual"
    assert captured["default_threshold"] == 50.0


@pytest.mark.anyio
async def test_list_plant_uuids_thresh_none_uses_default(async_client: AsyncClient, monkeypatch):
    mock_data = [
        {
            "uuid": "use_default_thresh",
            "water_retained_pct": 25,
            "water_loss_total_pct": 10,
            "recommended_water_threshold_pct": None,
            "days_offset": 1,
        },
    ]

    monkeypatch.setattr(
        "backend.app.routes.plants.PlantsList.fetch_all", lambda **kwargs: mock_data
    )

    # defaultThreshold=30, retained=25 -> 25 <= 30 -> True
    resp = await async_client.get(
        "/api/plants/uuids",
        headers=_API_KEY,
        params={"needs_watering": "true", "defaultThreshold": "30"},
    )
    assert resp.json() == ["use_default_thresh"]

    # defaultThreshold=20, retained=25 -> 25 <= 20 -> False
    resp = await async_client.get(
        "/api/plants/uuids",
        headers=_API_KEY,
        params={"needs_watering": "true", "defaultThreshold": "20"},
    )
    assert resp.json() == []


@pytest.mark.anyio
async def test_parse_default_threshold_coverage(async_client: AsyncClient, monkeypatch):
    # This test is just to hit the error paths in parse_default_threshold
    captured = {}

    def mock_fetch_all(**kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr("backend.app.routes.plants.PlantsList.fetch_all", mock_fetch_all)

    # Invalid threshold should fallback to 40.0
    await async_client.get(
        "/api/plants/uuids", headers=_API_KEY, params={"defaultThreshold": "invalid"}
    )
    assert captured["default_threshold"] == 40.0
