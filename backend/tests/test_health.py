import pytest


@pytest.mark.asyncio
async def test_top_level_health(async_client):
    resp = await async_client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_api_health(async_client):
    # The health router is mounted under /api
    resp = await async_client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
