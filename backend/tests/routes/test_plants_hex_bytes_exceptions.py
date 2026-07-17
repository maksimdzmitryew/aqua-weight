import types
import uuid
import pytest
from httpx import AsyncClient

# We will monkeypatch the 'bytes' symbol in the plants module to force fromhex to raise
import backend.app.routes.plants as plants_module


_API_KEY = {"X-API-Key": "test_api_key_for_testing"}


class BytesRaiser:
    @staticmethod
    def fromhex(s: str):
        raise ValueError("forced error fromhex")


@pytest.mark.anyio
async def test_create_plant_hex_to_bytes_fromhex_exception(
    monkeypatch: pytest.MonkeyPatch, async_client: AsyncClient
):
    # Reset DB
    r = await async_client.post("/api/test/reset", headers=_API_KEY)
    assert r.status_code == 200

    # Monkeypatch bytes in plants module so hex_to_bytes will hit the except branch
    monkeypatch.setattr(plants_module, "bytes", BytesRaiser, raising=False)

    valid_hex = uuid.uuid4().hex  # matches regex but our fromhex will raise
    r = await async_client.post(
        "/api/plants",
        headers=_API_KEY,
        json={
            "name": "Exc Create",
            "location_id": valid_hex,
        },
    )
    # Should still succeed with location_id treated as None
    assert r.status_code == 201
    assert r.json()["ok"] is True


@pytest.mark.anyio
async def test_update_plant_hex_to_bytes_fromhex_exception(
    monkeypatch: pytest.MonkeyPatch, async_client: AsyncClient
):
    # Reset DB
    r = await async_client.post("/api/test/reset", headers=_API_KEY)
    assert r.status_code == 200

    # Create a plant
    r = await async_client.post("/api/plants", headers=_API_KEY, json={"name": "Exc Update"})
    assert r.status_code == 201

    # Find UUID via list (paginated response)
    lr = await async_client.get("/api/plants", headers=_API_KEY)
    uid = next(it["uuid"] for it in lr.json()["items"] if it["name"] == "Exc Update")

    # Monkeypatch bytes in plants module
    monkeypatch.setattr(plants_module, "bytes", BytesRaiser, raising=False)

    # Attempt update with a valid hex for location_id; hex_to_bytes will catch the error and return None
    valid_hex = uuid.uuid4().hex
    ur = await async_client.patch(
        f"/api/plants/{uid}",
        headers=_API_KEY,
        json={
            "name": "Exc Update v2",
            "location_id": valid_hex,
        },
    )
    assert ur.status_code == 200
    assert ur.json()["ok"] is True

    gr = await async_client.get(f"/api/plants/{uid}", headers=_API_KEY)
    assert gr.status_code == 200
    item = gr.json()
    assert item["name"] == "Exc Update v2"
