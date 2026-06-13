import re
import pytest
from httpx import AsyncClient
from fastapi import FastAPI

from backend.app.routes import measurements as measurements_routes


@pytest.mark.asyncio
async def test_create_measurement_invalid_hex_branch(
    app: FastAPI, async_client: AsyncClient, monkeypatch
):
    # Make the router's HEX_RE reject otherwise valid lower-case hex strings
    monkeypatch.setattr(measurements_routes, "HEX_RE", re.compile(r"^x$"))

    payload = {
        "measured_at": "2025-01-01T12:00:00",
        "measured_weight_g": 123,
        # leave water_added_g None to avoid exclusivity error
        # optional fields can be omitted
    }

    resp = await async_client.post(
        "/api/plants/" + "aa" * 16 + "/measurements/weight",
        headers={"X-API-Key": "test_api_key_for_testing"},
        json=payload,
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid plant_id"
