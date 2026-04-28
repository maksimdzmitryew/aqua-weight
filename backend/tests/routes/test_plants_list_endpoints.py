import pytest
from httpx import AsyncClient


@pytest.mark.anyio
async def test_list_reference_endpoints(async_client: AsyncClient):
    endpoints = [
        "/api/substrate-types",
        "/api/light-levels",
        "/api/pest-statuses",
        "/api/health-statuses",
        "/api/scales",
        "/api/measurement-methods",
    ]
    for ep in endpoints:
        resp = await async_client.get(ep)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "uuid" in data[0]
            assert "name" in data[0]
