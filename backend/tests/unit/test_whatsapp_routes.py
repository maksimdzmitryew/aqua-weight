"""Unit tests for backend.app.routes.whatsapp.

These tests cover every line/branch of the whatsapp route module without
touching any live network or database. External boundaries are mocked:
the FastAPI auth dependencies (require_authenticated_user / require_admin_user),
the DB dependency (get_db), and all the whatsapp_notify helper functions
that the route module imports by name.
"""

import pytest

from backend.app import routes
from backend.app.routes import whatsapp as whatsapp_routes
from backend.app.security import get_db, require_authenticated_user, require_admin_user


def _admin_user() -> dict:
    return {
        "id": b"admin",
        "id_hex": "61646d696e",
        "username": "admin",
        "global_role": "admin",
    }


def _plain_user() -> dict:
    return {
        "id": b"user",
        "id_hex": "75736572",
        "username": "user",
        "global_role": "user",
    }


@pytest.fixture(autouse=True)
def _reset_overrides(app):
    app.dependency_overrides = {}
    yield
    app.dependency_overrides = {}


@pytest.fixture
def fake_db():
    return object()


@pytest.fixture
def authed_user(app):
    user = _admin_user()
    app.dependency_overrides[require_authenticated_user] = lambda: user
    return user


@pytest.fixture
def admin_user(app):
    user = _admin_user()
    # The whatsapp router is mounted under an internal_auth_router that carries a
    # router-level Depends(require_authenticated_user); admin endpoints also depend
    # on require_admin_user. Override both so no real auth/DB is needed.
    app.dependency_overrides[require_authenticated_user] = lambda: user
    app.dependency_overrides[require_admin_user] = lambda: user
    return user


@pytest.fixture
def db_override(app, fake_db):
    app.dependency_overrides[get_db] = lambda: fake_db
    return fake_db


# ---------------------------------------------------------------------------
# GET /whatsapp/helping-users
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_helping_users_returns_helpers(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    settings = {"whatsapp_helpers": [{"id": "h1", "name": "Bob", "phone": "+1"}]}

    def fake_get(self, user_id):
        return settings, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)

    resp = await async_client.get("/api/whatsapp/helping-users")
    assert resp.status_code == 200
    assert resp.json() == [{"id": "h1", "name": "Bob", "phone": "+1"}]


@pytest.mark.asyncio
async def test_get_helping_users_missing_key_returns_empty(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_get(self, user_id):
        return {}, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)

    resp = await async_client.get("/api/whatsapp/helping-users")
    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# POST /whatsapp/helping-users
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_helping_user_success_with_phone(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    settings: dict = {"whatsapp_helpers": []}
    captured = {}

    def fake_get(self, user_id):
        return settings, 5

    def fake_update(self, user_id, new_settings, version=None):
        captured["settings"] = new_settings
        captured["version"] = version
        return True

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)
    monkeypatch.setattr(whatsapp_routes.SettingsService, "update_settings", fake_update)

    resp = await async_client.post(
        "/api/whatsapp/helping-users", json={"name": "  Alice  ", "phone": "  +123 "}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Alice"
    assert body["phone"] == "+123"
    assert body["id"].startswith("helper_")
    assert captured["settings"]["whatsapp_helpers"][0]["name"] == "Alice"
    assert captured["version"] == 5


@pytest.mark.asyncio
async def test_add_helping_user_success_without_phone(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    settings: dict = {}
    captured = {}

    def fake_get(self, user_id):
        return settings, 1

    def fake_update(self, user_id, new_settings, version=None):
        captured["settings"] = new_settings
        return True

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)
    monkeypatch.setattr(whatsapp_routes.SettingsService, "update_settings", fake_update)

    resp = await async_client.post("/api/whatsapp/helping-users", json={"name": "NoPhone"})
    assert resp.status_code == 200
    assert resp.json()["phone"] is None
    assert captured["settings"]["whatsapp_helpers"][0]["phone"] is None


@pytest.mark.asyncio
async def test_add_helping_user_missing_name(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_get(self, user_id):
        return {}, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)

    resp = await async_client.post("/api/whatsapp/helping-users", json={"phone": "+1"})
    assert resp.status_code == 400
    assert resp.json() == {"detail": "Helper name is required"}


# ---------------------------------------------------------------------------
# DELETE /whatsapp/helping-users/{helper_id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_helping_user_success(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    settings = {"whatsapp_helpers": [{"id": "h1"}, {"id": "h2"}]}
    captured = {}

    def fake_get(self, user_id):
        return settings, 3

    def fake_update(self, user_id, new_settings, version=None):
        captured["settings"] = new_settings
        return True

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)
    monkeypatch.setattr(whatsapp_routes.SettingsService, "update_settings", fake_update)

    resp = await async_client.delete("/api/whatsapp/helping-users/h1")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert [h["id"] for h in captured["settings"]["whatsapp_helpers"]] == ["h2"]


@pytest.mark.asyncio
async def test_delete_helping_user_not_found(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    settings = {"whatsapp_helpers": [{"id": "h1"}]}

    def fake_get(self, user_id):
        return settings, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)

    resp = await async_client.delete("/api/whatsapp/helping-users/missing")
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Helper not found"}


# ---------------------------------------------------------------------------
# POST /whatsapp/send-test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_test_message_success(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    captured = {}

    def fake_send(to, body, conn=None):
        captured["to"] = to
        captured["body"] = body
        return True, None

    monkeypatch.setattr(whatsapp_routes, "send_whatsapp_text_message", fake_send)
    monkeypatch.setattr(whatsapp_routes, "record_whatsapp_send_log", lambda *a, **k: None)

    resp = await async_client.post("/api/whatsapp/send-test", json={"to": "  +999 "})
    assert resp.status_code == 200
    assert resp.json() == {"message": "Test message sent successfully!"}
    assert captured["to"] == "+999"
    assert "test message" in captured["body"]


@pytest.mark.asyncio
async def test_send_test_message_missing_target(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(whatsapp_routes, "send_whatsapp_text_message", lambda *a, **k: (True, None))
    resp = await async_client.post("/api/whatsapp/send-test", json={})
    assert resp.status_code == 400
    assert resp.json() == {"detail": "WhatsApp number is required"}


@pytest.mark.asyncio
async def test_send_test_message_send_failure(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(
        whatsapp_routes, "send_whatsapp_text_message", lambda *a, **k: (False, "boom")
    )
    monkeypatch.setattr(whatsapp_routes, "record_whatsapp_send_log", lambda *a, **k: None)

    resp = await async_client.post("/api/whatsapp/send-test", json={"to": "+999"})
    assert resp.status_code == 500
    assert resp.json()["detail"] == "boom"


# ---------------------------------------------------------------------------
# POST /whatsapp/trigger-digest
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_trigger_digest_success_records_timestamp(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    settings = {"whatsapp_number": "  +111 ", "whatsapp_helpers": [{"id": "h"}]}
    captured = {}

    def fake_get(self, user_id):
        return settings, 7

    def fake_update(self, user_id, new_settings, version=None):
        captured["settings"] = new_settings
        return True

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)
    monkeypatch.setattr(whatsapp_routes.SettingsService, "update_settings", fake_update)
    monkeypatch.setattr(whatsapp_routes, "get_thirsty_plants", lambda conn, uid: [{"name": "Fern"}])
    monkeypatch.setattr(whatsapp_routes, "format_digest_message", lambda plants, helpers_count=0: "digest")
    monkeypatch.setattr(whatsapp_routes, "send_whatsapp_text_message", lambda *a, **k: (True, None))
    monkeypatch.setattr(whatsapp_routes, "record_whatsapp_send_log", lambda *a, **k: None)

    resp = await async_client.post("/api/whatsapp/trigger-digest")
    assert resp.status_code == 200
    body = resp.json()
    assert body["sent"] is True
    assert body["thirsty_plants"] == [{"name": "Fern"}]
    assert captured["settings"]["whatsapp_last_notification"]["sent_at"]
    assert captured["settings"]["whatsapp_last_notification"]["thirsty_plants"] == ["Fern"]


@pytest.mark.asyncio
async def test_trigger_digest_no_number(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    settings = {"whatsapp_helpers": []}

    def fake_get(self, user_id):
        return settings, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)

    resp = await async_client.post("/api/whatsapp/trigger-digest")
    assert resp.status_code == 400
    assert resp.json() == {"detail": "WhatsApp number not configured"}


@pytest.mark.asyncio
async def test_trigger_digest_send_failure(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    settings = {"whatsapp_number": "+111"}

    def fake_get(self, user_id):
        return settings, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)
    monkeypatch.setattr(whatsapp_routes, "get_thirsty_plants", lambda conn, uid: [])
    monkeypatch.setattr(whatsapp_routes, "format_digest_message", lambda plants, helpers_count=0: "digest")
    monkeypatch.setattr(whatsapp_routes, "send_whatsapp_text_message", lambda *a, **k: (False, "nope"))
    monkeypatch.setattr(whatsapp_routes, "record_whatsapp_send_log", lambda *a, **k: None)

    resp = await async_client.post("/api/whatsapp/trigger-digest")
    assert resp.status_code == 200
    assert resp.json() == {"thirsty_plants": [], "sent": False}


# ---------------------------------------------------------------------------
# GET/POST /whatsapp/daily-digest (admin)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_daily_digest_returns_template(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_get(self, user_id):
        return {whatsapp_routes.SETTINGS_KEY_DAILY_DIGEST: "Hello {{date}}"}, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)

    resp = await async_client.get("/api/whatsapp/daily-digest")
    assert resp.status_code == 200
    assert resp.json() == {"daily_digest": "Hello {{date}}"}


@pytest.mark.asyncio
async def test_get_daily_digest_missing_returns_empty(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_get(self, user_id):
        return {}, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)

    resp = await async_client.get("/api/whatsapp/daily-digest")
    assert resp.status_code == 200
    assert resp.json() == {"daily_digest": ""}


@pytest.mark.asyncio
async def test_save_daily_digest_success(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    settings: dict = {}
    captured = {}

    def fake_get(self, user_id):
        return settings, 2

    def fake_update(self, user_id, new_settings, version=None):
        captured["settings"] = new_settings
        captured["version"] = version
        return True

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)
    monkeypatch.setattr(whatsapp_routes.SettingsService, "update_settings", fake_update)

    resp = await async_client.post(
        "/api/whatsapp/daily-digest", json={"daily_digest": "  Hi  "}
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert captured["settings"][whatsapp_routes.SETTINGS_KEY_DAILY_DIGEST] == "Hi"
    assert captured["version"] == 2


# ---------------------------------------------------------------------------
# GET/POST /whatsapp/thirsty-list (admin)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_thirsty_list_template(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_get(self, user_id):
        return {whatsapp_routes.SETTINGS_KEY_THIRSTY_LIST_TEMPLATE: "TL"}, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)

    resp = await async_client.get("/api/whatsapp/thirsty-list")
    assert resp.status_code == 200
    assert resp.json() == {"thirsty_list_template": "TL"}


@pytest.mark.asyncio
async def test_get_thirsty_list_template_missing(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_get(self, user_id):
        return {}, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)

    resp = await async_client.get("/api/whatsapp/thirsty-list")
    assert resp.status_code == 200
    assert resp.json() == {"thirsty_list_template": ""}


@pytest.mark.asyncio
async def test_save_thirsty_list_template(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    settings: dict = {}
    captured = {}

    def fake_get(self, user_id):
        return settings, 4

    def fake_update(self, user_id, new_settings, version=None):
        captured["settings"] = new_settings
        return True

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)
    monkeypatch.setattr(whatsapp_routes.SettingsService, "update_settings", fake_update)

    resp = await async_client.post("/api/whatsapp/thirsty-list", json={"thirsty_list_template": " t "})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert captured["settings"][whatsapp_routes.SETTINGS_KEY_THIRSTY_LIST_TEMPLATE] == "t"


# ---------------------------------------------------------------------------
# GET/POST /whatsapp/weight-plants (admin)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_weight_plants_template(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_get(self, user_id):
        return {whatsapp_routes.SETTINGS_KEY_WEIGHT_PLANTS_TEMPLATE: "WP"}, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)

    resp = await async_client.get("/api/whatsapp/weight-plants")
    assert resp.status_code == 200
    assert resp.json() == {"weight_plants_template": "WP"}


@pytest.mark.asyncio
async def test_get_weight_plants_template_missing(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_get(self, user_id):
        return {}, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)

    resp = await async_client.get("/api/whatsapp/weight-plants")
    assert resp.status_code == 200
    assert resp.json() == {"weight_plants_template": ""}


@pytest.mark.asyncio
async def test_save_weight_plants_template(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    settings: dict = {}
    captured = {}

    def fake_get(self, user_id):
        return settings, 6

    def fake_update(self, user_id, new_settings, version=None):
        captured["settings"] = new_settings
        return True

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)
    monkeypatch.setattr(whatsapp_routes.SettingsService, "update_settings", fake_update)

    resp = await async_client.post("/api/whatsapp/weight-plants", json={"weight_plants_template": " w "})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert captured["settings"][whatsapp_routes.SETTINGS_KEY_WEIGHT_PLANTS_TEMPLATE] == "w"


# ---------------------------------------------------------------------------
# POST /whatsapp/daily-digest/send-test (admin)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_daily_digest_test_success(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    settings = {
        "whatsapp_number": "  +222 ",
        whatsapp_routes.SETTINGS_KEY_DAILY_DIGEST: "  Hi {{date}} ",
        whatsapp_routes.SETTINGS_KEY_THIRSTY_LIST_TEMPLATE: "TL",
        whatsapp_routes.SETTINGS_KEY_WEIGHT_PLANTS_TEMPLATE: "WP",
        "whatsapp_helpers": [{"id": "h"}],
    }
    captured = {}

    def fake_get(self, user_id):
        return settings, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)
    monkeypatch.setattr(whatsapp_routes, "get_thirsty_plants", lambda conn, uid: [{"name": "F"}])
    monkeypatch.setattr(whatsapp_routes, "get_weight_plants", lambda conn, uid: [{"name": "W"}])
    monkeypatch.setattr(whatsapp_routes, "_build_thirsty_list", lambda plants, tpl: "TLIST")
    monkeypatch.setattr(whatsapp_routes, "_build_weight_plants_list", lambda plants, tpl: "WLIST")
    monkeypatch.setattr(whatsapp_routes, "render_placeholders", lambda tpl, vals: "RENDERED")
    monkeypatch.setattr(whatsapp_routes, "send_whatsapp_text_message", lambda *a, **k: (True, None))
    monkeypatch.setattr(whatsapp_routes, "record_whatsapp_send_log", lambda *a, **k: None)

    resp = await async_client.post("/api/whatsapp/daily-digest/send-test")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "sent": True}


@pytest.mark.asyncio
async def test_send_daily_digest_test_no_number(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_get(self, user_id):
        return {}, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)

    resp = await async_client.post("/api/whatsapp/daily-digest/send-test")
    assert resp.status_code == 400
    assert resp.json() == {"detail": "WhatsApp number not configured"}


@pytest.mark.asyncio
async def test_send_daily_digest_test_empty_template(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_get(self, user_id):
        return {"whatsapp_number": "+222"}, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)

    resp = await async_client.post("/api/whatsapp/daily-digest/send-test")
    assert resp.status_code == 400
    assert resp.json() == {"detail": "Daily digest is empty"}


@pytest.mark.asyncio
async def test_send_daily_digest_test_send_failure(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    settings = {
        "whatsapp_number": "+222",
        whatsapp_routes.SETTINGS_KEY_DAILY_DIGEST: "Hi",
    }

    def fake_get(self, user_id):
        return settings, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)
    monkeypatch.setattr(whatsapp_routes, "get_thirsty_plants", lambda conn, uid: [])
    monkeypatch.setattr(whatsapp_routes, "get_weight_plants", lambda conn, uid: [])
    monkeypatch.setattr(whatsapp_routes, "_build_thirsty_list", lambda plants, tpl: "")
    monkeypatch.setattr(whatsapp_routes, "_build_weight_plants_list", lambda plants, tpl: "")
    monkeypatch.setattr(whatsapp_routes, "render_placeholders", lambda tpl, vals: "RENDERED")
    monkeypatch.setattr(whatsapp_routes, "send_whatsapp_text_message", lambda *a, **k: (False, "fail"))
    monkeypatch.setattr(whatsapp_routes, "record_whatsapp_send_log", lambda *a, **k: None)

    resp = await async_client.post("/api/whatsapp/daily-digest/send-test")
    assert resp.status_code == 500
    assert resp.json()["detail"] == "fail"


# ---------------------------------------------------------------------------
# GET /whatsapp/logs (admin)
# ---------------------------------------------------------------------------


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows
        self.executed = None
        self.params = None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self.executed = sql
        self.params = params

    def fetchall(self):
        return self._rows


class _FakeDB:
    def __init__(self, rows):
        self._rows = rows

    def cursor(self):
        return _FakeCursor(self._rows)


@pytest.mark.asyncio
async def test_get_whatsapp_logs_default_limit(
    async_client, admin_user, app, monkeypatch: pytest.MonkeyPatch
):
    from datetime import datetime

    db = _FakeDB(
        [
            (
                b"\x01" * 16,
                b"\x02" * 16,
                "+1",
                "text",
                "manual",
                True,
                None,
                datetime(2024, 1, 1, 12, 0, 0),
            )
        ]
    )
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(whatsapp_routes, "ensure_whatsapp_send_logs_table", lambda *a, **k: None)

    resp = await async_client.get("/api/whatsapp/logs")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["success"] is True
    assert items[0]["to_number"] == "+1"
    assert items[0]["id_hex"] == (b"\x01" * 16).hex()
    assert items[0]["user_id_hex"] == (b"\x02" * 16).hex()
    assert items[0]["created_at"] == datetime(2024, 1, 1, 12, 0, 0).isoformat()


@pytest.mark.asyncio
async def test_get_whatsapp_logs_limit_clamped_low(
    async_client, admin_user, app, monkeypatch: pytest.MonkeyPatch
):
    db = _FakeDB([])
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(whatsapp_routes, "ensure_whatsapp_send_logs_table", lambda *a, **k: None)

    resp = await async_client.get("/api/whatsapp/logs?limit=0")
    assert resp.status_code == 200
    assert resp.json()["items"] == []


@pytest.mark.asyncio
async def test_get_whatsapp_logs_limit_clamped_high(
    async_client, admin_user, app, monkeypatch: pytest.MonkeyPatch
):
    db = _FakeDB([])
    app.dependency_overrides[get_db] = lambda: db
    cur_holder = {}

    def fake_ensure(*a, **k):
        return None

    monkeypatch.setattr(whatsapp_routes, "ensure_whatsapp_send_logs_table", fake_ensure)

    resp = await async_client.get("/api/whatsapp/logs?limit=99999")
    assert resp.status_code == 200
    assert resp.json()["items"] == []


@pytest.mark.asyncio
async def test_get_whatsapp_logs_null_fields(
    async_client, admin_user, app, monkeypatch: pytest.MonkeyPatch
):
    db = _FakeDB([(None, None, "+1", "text", "manual", 0, "err", None)])
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(whatsapp_routes, "ensure_whatsapp_send_logs_table", lambda *a, **k: None)

    resp = await async_client.get("/api/whatsapp/logs")
    assert resp.status_code == 200
    item = resp.json()["items"][0]
    assert item["id_hex"] is None
    assert item["user_id_hex"] is None
    assert item["success"] is False
    assert item["error_message"] == "err"
    assert item["created_at"] is None


# ---------------------------------------------------------------------------
# GET /whatsapp/credentials (admin)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_whatsapp_credentials(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_creds(conn):
        return {
            "api_url": "https://x",
            "api_token": "secret",
            "template_name": "tpl",
            "phone_number_id": "123",
        }

    from backend.app.helpers import whatsapp_notify

    monkeypatch.setattr(whatsapp_notify, "get_whatsapp_credentials", fake_creds)

    resp = await async_client.get("/api/whatsapp/credentials")
    assert resp.status_code == 200
    body = resp.json()
    assert body["api_url"] == "https://x"
    assert body["api_token"] == "***MASKED***"
    assert body["template_name"] == "tpl"
    assert body["phone_number_id"] == "123"
    assert body["configured"] is True


@pytest.mark.asyncio
async def test_get_whatsapp_credentials_unconfigured(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_creds(conn):
        return {"api_url": "", "api_token": ""}

    from backend.app.helpers import whatsapp_notify

    monkeypatch.setattr(whatsapp_notify, "get_whatsapp_credentials", fake_creds)

    resp = await async_client.get("/api/whatsapp/credentials")
    assert resp.status_code == 200
    body = resp.json()
    assert body["api_token"] == ""
    assert body["configured"] is False


# ---------------------------------------------------------------------------
# POST /whatsapp/credentials (admin)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_save_whatsapp_credentials_success(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    captured = {}

    def fake_save(conn, api_url, api_token, template_name, phone_number_id):
        captured.update(
            api_url=api_url,
            api_token=api_token,
            template_name=template_name,
            phone_number_id=phone_number_id,
        )
        return True

    monkeypatch.setattr(whatsapp_routes, "save_whatsapp_credentials", fake_save)

    resp = await async_client.post(
        "/api/whatsapp/credentials",
        json={
            "api_url": " https://x ",
            "api_token": "  tok ",
            "template_name": "  tpl ",
            "phone_number_id": " 5551234567 ",
        },
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "message": "Credentials saved successfully"}
    assert captured["api_url"] == "https://x"
    assert captured["api_token"] == "tok"
    assert captured["template_name"] == "tpl"
    assert captured["phone_number_id"] == "5551234567"


@pytest.mark.asyncio
async def test_save_whatsapp_credentials_strips_bearer_prefix(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    captured = {}

    def fake_save(conn, api_url, api_token, template_name, phone_number_id):
        captured["api_token"] = api_token
        return True

    monkeypatch.setattr(whatsapp_routes, "save_whatsapp_credentials", fake_save)

    resp = await async_client.post(
        "/api/whatsapp/credentials",
        json={"api_url": "https://x", "api_token": "Bearer   tok "},
    )
    assert resp.status_code == 200
    assert captured["api_token"] == "tok"


@pytest.mark.asyncio
async def test_save_whatsapp_credentials_default_template(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    captured = {}

    def fake_save(conn, api_url, api_token, template_name, phone_number_id):
        captured["template_name"] = template_name
        return True

    monkeypatch.setattr(whatsapp_routes, "save_whatsapp_credentials", fake_save)

    resp = await async_client.post(
        "/api/whatsapp/credentials", json={"api_url": "https://x", "api_token": "tok"}
    )
    assert resp.status_code == 200
    assert captured["template_name"] == "jaspers_market_plain_text_v1"


@pytest.mark.asyncio
async def test_save_whatsapp_credentials_missing_url(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    resp = await async_client.post(
        "/api/whatsapp/credentials", json={"api_token": "tok"}
    )
    assert resp.status_code == 400
    assert resp.json() == {"detail": "API URL is required"}


@pytest.mark.asyncio
async def test_save_whatsapp_credentials_missing_token(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    resp = await async_client.post(
        "/api/whatsapp/credentials", json={"api_url": "https://x"}
    )
    assert resp.status_code == 400
    assert resp.json() == {"detail": "API token is required"}


@pytest.mark.asyncio
async def test_save_whatsapp_credentials_both_errors(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    resp = await async_client.post("/api/whatsapp/credentials", json={})
    assert resp.status_code == 400
    assert resp.json() == {"detail": "API URL is required; API token is required"}


@pytest.mark.asyncio
async def test_save_whatsapp_credentials_invalid_phone_warns(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    captured = {}

    def fake_save(conn, api_url, api_token, template_name, phone_number_id):
        captured["phone_number_id"] = phone_number_id
        return True

    monkeypatch.setattr(whatsapp_routes, "save_whatsapp_credentials", fake_save)

    resp = await async_client.post(
        "/api/whatsapp/credentials",
        json={"api_url": "https://x", "api_token": "tok", "phone_number_id": "short"},
    )
    assert resp.status_code == 200
    assert captured["phone_number_id"] == "short"


@pytest.mark.asyncio
async def test_save_whatsapp_credentials_empty_phone_no_warning(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    captured = {}

    def fake_save(conn, api_url, api_token, template_name, phone_number_id):
        captured["phone_number_id"] = phone_number_id
        return True

    monkeypatch.setattr(whatsapp_routes, "save_whatsapp_credentials", fake_save)

    resp = await async_client.post(
        "/api/whatsapp/credentials", json={"api_url": "https://x", "api_token": "tok"}
    )
    assert resp.status_code == 200
    assert captured["phone_number_id"] == ""


@pytest.mark.asyncio
async def test_save_whatsapp_credentials_save_exception(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_save(conn, api_url, api_token, template_name, phone_number_id):
        raise RuntimeError("db exploded")

    monkeypatch.setattr(whatsapp_routes, "save_whatsapp_credentials", fake_save)

    resp = await async_client.post(
        "/api/whatsapp/credentials", json={"api_url": "https://x", "api_token": "tok"}
    )
    assert resp.status_code == 500
    assert "Failed to save credentials: db exploded" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_save_whatsapp_credentials_save_returns_false(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_save(conn, api_url, api_token, template_name, phone_number_id):
        return False

    monkeypatch.setattr(whatsapp_routes, "save_whatsapp_credentials", fake_save)

    resp = await async_client.post(
        "/api/whatsapp/credentials", json={"api_url": "https://x", "api_token": "tok"}
    )
    assert resp.status_code == 500
    assert resp.json() == {"detail": "Failed to save credentials. Please check server logs for details."}


# ---------------------------------------------------------------------------
# POST /whatsapp/credentials/send-test-template (admin)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_template_test_success(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    settings = {"whatsapp_number": "  +333 "}

    def fake_get(self, user_id):
        return settings, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)
    monkeypatch.setattr(whatsapp_routes, "send_whatsapp_message", lambda *a, **k: (True, None))
    monkeypatch.setattr(whatsapp_routes, "record_whatsapp_send_log", lambda *a, **k: None)

    resp = await async_client.post("/api/whatsapp/credentials/send-test-template")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "sent": True}


@pytest.mark.asyncio
async def test_send_template_test_no_number(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_get(self, user_id):
        return {}, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)

    resp = await async_client.post("/api/whatsapp/credentials/send-test-template")
    assert resp.status_code == 400
    assert resp.json() == {"detail": "WhatsApp number not configured"}


@pytest.mark.asyncio
async def test_send_template_test_send_failure(
    async_client, admin_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    settings = {"whatsapp_number": "+333"}

    def fake_get(self, user_id):
        return settings, 1

    monkeypatch.setattr(whatsapp_routes.SettingsService, "get_settings", fake_get)
    monkeypatch.setattr(whatsapp_routes, "send_whatsapp_message", lambda *a, **k: (False, "tmpl fail"))
    monkeypatch.setattr(whatsapp_routes, "record_whatsapp_send_log", lambda *a, **k: None)

    resp = await async_client.post("/api/whatsapp/credentials/send-test-template")
    assert resp.status_code == 500
    assert resp.json()["detail"] == "tmpl fail"
