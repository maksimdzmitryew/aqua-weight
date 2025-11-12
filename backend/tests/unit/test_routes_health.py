import pytest


@pytest.mark.asyncio
async def test_health_endpoints(async_client):
    # Root app health
    r = await async_client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}

    # Router-mounted root
    r2 = await async_client.get("/api/")
    assert r2.status_code == 200
    assert r2.json() == {"message": "Hello World"}

    # Hello name
    r3 = await async_client.get("/api/hello/Alice")
    assert r3.status_code == 200
    assert r3.json()["message"].startswith("Hello ")
    assert r3.json()["message"].endswith("Alice")

    # Health under /api
    r4 = await async_client.get("/api/health")
    assert r4.status_code == 200
    assert r4.json() == {"status": "ok"}
