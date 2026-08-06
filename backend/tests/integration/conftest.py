import pytest
import httpx

BASE_URL = "http://api:8000/api"


@pytest.fixture
async def client():
    async with httpx.AsyncClient(base_url=BASE_URL) as c:
        yield c


@pytest.fixture
async def admin_token(client: httpx.AsyncClient):
    # Reset DB and seed
    await client.post("/test/reset")
    await client.post("/test/seed")
    # Login
    resp = await client.post("/test/login")
    data = resp.json()
    return data["access_token"]


@pytest.fixture
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}
