import pytest

from backend.app.security import get_db, require_authenticated_user
from backend.app.services.settings_service import SettingsService


@pytest.fixture(autouse=True)
def _clear_dependency_overrides(app):
    app.dependency_overrides = {}
    yield
    app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_get_settings_rejects_guest_user(async_client, app):
    app.dependency_overrides[require_authenticated_user] = lambda: {"id": None}

    resp = await async_client.get("/api/settings")

    assert resp.status_code == 400
    assert resp.json() == {"detail": "Settings not available for guest/mock users"}


@pytest.mark.asyncio
async def test_get_settings_returns_settings(async_client, app, monkeypatch: pytest.MonkeyPatch):
    fake_db = object()
    app.dependency_overrides[require_authenticated_user] = lambda: {"id": b"u1"}
    app.dependency_overrides[get_db] = lambda: fake_db

    def fake_get_settings(self, user_id):
        assert self.db_conn is fake_db
        assert user_id == b"u1"
        return {"theme": "dark"}, 2

    monkeypatch.setattr(SettingsService, "get_settings", fake_get_settings)

    resp = await async_client.get("/api/settings")

    assert resp.status_code == 200
    assert resp.json() == {"settings": {"theme": "dark"}, "version": 2}


@pytest.mark.asyncio
async def test_update_settings_rejects_guest_user(async_client, app):
    app.dependency_overrides[require_authenticated_user] = lambda: {"id": None}

    resp = await async_client.put("/api/settings", json={"settings": {}, "version": None})

    assert resp.status_code == 400
    assert resp.json() == {"detail": "Settings cannot be updated for guest/mock users"}


@pytest.mark.asyncio
async def test_update_settings_calls_service(async_client, app, monkeypatch: pytest.MonkeyPatch):
    fake_db = object()
    app.dependency_overrides[require_authenticated_user] = lambda: {"id": b"u1"}
    app.dependency_overrides[get_db] = lambda: fake_db

    seen: dict[str, object] = {}

    def fake_update_settings(self, user_id, settings, version=None):
        assert self.db_conn is fake_db
        seen["user_id"] = user_id
        seen["settings"] = settings
        seen["version"] = version
        return True

    monkeypatch.setattr(SettingsService, "update_settings", fake_update_settings)

    payload = {"settings": {"theme": "dark"}, "version": 3}
    resp = await async_client.put("/api/settings", json=payload)

    assert resp.status_code == 204
    assert seen == {"user_id": b"u1", "settings": {"theme": "dark"}, "version": 3}
