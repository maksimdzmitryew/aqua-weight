import pytest
import httpx


@pytest.mark.integration
@pytest.mark.asyncio
async def test_settings_flow(client: httpx.AsyncClient, admin_token, auth_headers):
    """Test settings CRUD."""
    # Get default settings
    get_resp = await client.get("/settings", headers=auth_headers)
    assert get_resp.status_code == 200
    settings = get_resp.json()

    # Update settings
    update_resp = await client.put(
        "/settings",
        json={"theme": "dark", "operationMode": "manual", "defaultThreshold": "35"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert update_resp.status_code in (200, 204)

    # Verify updated settings
    get_resp2 = await client.get("/settings", headers=auth_headers)
    assert get_resp2.status_code == 200
    updated = get_resp2.json()
    assert updated.get("theme") == "dark"
