"""Unit tests for backend.app.routes.auth.

These tests drive every line/branch of the auth route module without touching
any live database or network. External boundaries are mocked: the FastAPI auth
dependencies (require_authenticated_user) and device id resolver (get_device_id),
the DB dependency (get_db), and the AuthService methods that the route module
constructs internally.
"""

import pytest

from backend.app.routes import auth as auth_routes
from backend.app.security import get_db, get_device_id, require_authenticated_user


@pytest.fixture(autouse=True)
def _reset_overrides(app):
    app.dependency_overrides = {}
    yield
    app.dependency_overrides = {}


def _authed_user() -> dict:
    return {
        "id": b"user",
        "id_hex": "75736572",
        "username": "user",
        "global_role": "user",
    }


@pytest.fixture
def authed_user(app):
    user = _authed_user()
    app.dependency_overrides[require_authenticated_user] = lambda: user
    return user


@pytest.fixture
def db_override(app):
    fake_db = object()
    app.dependency_overrides[get_db] = lambda: fake_db
    return fake_db


@pytest.fixture
def device_override(app):
    app.dependency_overrides[get_device_id] = lambda: "dev-1"
    return "dev-1"


# ---------------------------------------------------------------------------
# GET /auth/invite/page
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_invite_page_nonce(async_client, app):
    resp = await async_client.get("/api/auth/invite/page")
    assert resp.status_code == 200
    body = resp.json()
    assert "nonce" in body
    # nonce must be a non-empty base64 payload
    assert isinstance(body["nonce"], str) and body["nonce"]


# ---------------------------------------------------------------------------
# POST /auth/login
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_success_sets_cookie(
    async_client, db_override, monkeypatch: pytest.MonkeyPatch
):
    captured = {}

    def fake_login(self, **kwargs):
        captured.update(kwargs)
        return {
            "access_token": "at",
            "refresh_token": "rt",
            "user": {"id": "u"},
            "mfa_required": False,
        }

    monkeypatch.setattr(auth_routes.AuthService, "login", fake_login)

    resp = await async_client.post(
        "/api/auth/login",
        json={
            "username": "bob",
            "password": "password1",
            "device_id": "d1",
            "trust_device": True,
            "device_name": "phone",
        },
        headers={"User-Agent": "agent/1.0"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"access_token": "at", "token_type": "bearer", "user": {"id": "u"}}
    # refresh token cookie set
    assert "refresh_token" in resp.cookies
    assert captured["username"] == "bob"
    assert captured["password"] == "password1"
    assert captured["device_id_str"] == "d1"
    assert captured["user_agent"] == "agent/1.0"
    assert captured["trust_device"] is True
    assert captured["device_name"] == "phone"


@pytest.mark.asyncio
async def test_login_mfa_challenge_returns_result(
    async_client, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_login(self, **kwargs):
        return {"mfa_required": True, "mfa_token": "mt"}

    monkeypatch.setattr(auth_routes.AuthService, "login", fake_login)

    resp = await async_client.post(
        "/api/auth/login",
        json={"username": "bob", "password": "password1", "device_id": "d1"},
    )
    assert resp.status_code == 200
    # When mfa_required, no cookie is set and the raw result is returned
    assert "refresh_token" not in resp.cookies
    assert resp.json() == {"mfa_required": True, "mfa_token": "mt"}


@pytest.mark.asyncio
async def test_login_invalid_credentials_raises_401(
    async_client, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_login(self, **kwargs):
        raise ValueError("bad credentials")

    monkeypatch.setattr(auth_routes.AuthService, "login", fake_login)

    resp = await async_client.post(
        "/api/auth/login",
        json={"username": "bob", "password": "wrongpass", "device_id": "d1"},
    )
    assert resp.status_code == 401
    assert resp.json() == {"detail": "bad credentials"}


# ---------------------------------------------------------------------------
# POST /auth/invite/complete
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_invite_complete_honeypot_returns_400():
    """Honeypot branch: the schema enforces email max_length=0, so a non-empty
    email can never arrive via HTTP validation. We exercise the branch by calling
    the handler directly with a payload object that carries a filled-in honeypot.
    """

    class _FakeRequest:
        headers = {}
        cookies = {}

    class _FakePayload:
        email = "spam@bot"
        page_nonce = ""
        token = "t"
        password = "password1"
        totp_secret = "s"
        totp_code = "123456"
        device_id = "d1"
        device_name = None
        trust_device = False

    called = {"complete_invite": False}

    class _FakeAuthService:
        def __init__(self, db):
            pass

        def complete_invite(self, **kwargs):
            called["complete_invite"] = True
            return ("at", "rt", ["RC"])

    monkeypatch_local = None
    import unittest.mock as mock

    with mock.patch.object(auth_routes, "AuthService", _FakeAuthService):
        from fastapi import HTTPException as _HTTPException

        with pytest.raises(_HTTPException) as exc_info:
            await auth_routes.invite_complete(
                payload=_FakePayload(),
                request=_FakeRequest(),
                response=mock.MagicMock(),
                db=object(),
            )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Invalid request"
    # Honeypot short-circuits before any invite processing
    assert called["complete_invite"] is False


@pytest.mark.asyncio
async def test_invite_complete_invalid_nonce_returns_403(
    async_client, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_verify(nonce_b64, request):
        return False

    monkeypatch.setattr(auth_routes, "verify_page_nonce", fake_verify)
    monkeypatch.setattr(auth_routes.AuthService, "complete_invite", lambda *a, **k: None)

    resp = await async_client.post(
        "/api/auth/invite/complete",
        json={"token": "t", "password": "password1", "device_id": "d1", "page_nonce": "n", "totp_secret": "s", "totp_code": "123456"},
    )
    assert resp.status_code == 403
    assert resp.json() == {"detail": "Invalid or expired page nonce"}


@pytest.mark.asyncio
async def test_invite_complete_success_sets_cookie(
    async_client, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_verify(nonce_b64, request):
        return True

    captured = {}

    def fake_complete_invite(self, **kwargs):
        captured.update(kwargs)
        return ("at", "rt", ["RC1", "RC2"])

    monkeypatch.setattr(auth_routes, "verify_page_nonce", fake_verify)
    monkeypatch.setattr(auth_routes.AuthService, "complete_invite", fake_complete_invite)

    resp = await async_client.post(
        "/api/auth/invite/complete",
        json={
            "token": "t",
            "password": "password1",
            "page_nonce": "n",
            "totp_secret": "s",
            "totp_code": "123456",
            "device_id": "d1",
            "trust_device": True,
            "device_name": "phone",
        },
        headers={"User-Agent": "agent/1.0"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"access_token": "at", "token_type": "bearer", "recovery_codes": ["RC1", "RC2"]}
    assert "refresh_token" in resp.cookies
    assert captured["token"] == "t"
    assert captured["password"] == "password1"
    assert captured["totp_secret"] == "s"
    assert captured["totp_code"] == "123456"
    assert captured["device_id_str"] == "d1"
    assert captured["user_agent"] == "agent/1.0"
    assert captured["trust_device"] is True
    assert captured["device_name"] == "phone"


@pytest.mark.asyncio
async def test_invite_complete_value_error_returns_400(
    async_client, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_verify(nonce_b64, request):
        return True

    def fake_complete_invite(self, **kwargs):
        raise ValueError("invite broken")

    monkeypatch.setattr(auth_routes, "verify_page_nonce", fake_verify)
    monkeypatch.setattr(auth_routes.AuthService, "complete_invite", fake_complete_invite)

    resp = await async_client.post(
        "/api/auth/invite/complete",
        json={"token": "t", "password": "password1", "device_id": "d1", "page_nonce": "n", "totp_secret": "s", "totp_code": "123456"},
    )
    assert resp.status_code == 400
    assert resp.json() == {"detail": "invite broken"}


# ---------------------------------------------------------------------------
# POST /auth/refresh
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refresh_missing_token_returns_401(
    async_client, db_override, device_override, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(auth_routes.AuthService, "rotate_tokens", lambda *a, **k: None)

    resp = await async_client.post("/api/auth/refresh")
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Refresh token missing"}


@pytest.mark.asyncio
async def test_refresh_success_rotates_and_sets_cookie(
    async_client, db_override, device_override, monkeypatch: pytest.MonkeyPatch
):
    captured = {}

    def fake_rotate(self, refresh_token, device_id_str):
        captured["refresh_token"] = refresh_token
        captured["device_id_str"] = device_id_str
        return ("at", "new_rt", {"id": "u"})

    monkeypatch.setattr(auth_routes.AuthService, "rotate_tokens", fake_rotate)

    async_client.cookies.set("refresh_token", "old_rt")
    resp = await async_client.post(
        "/api/auth/refresh",
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"access_token": "at", "token_type": "bearer", "user": {"id": "u"}}
    assert resp.cookies["refresh_token"] == "new_rt"
    assert captured["refresh_token"] == "old_rt"
    assert captured["device_id_str"] == "dev-1"


@pytest.mark.asyncio
async def test_refresh_value_error_returns_401(
    async_client, db_override, device_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_rotate(self, refresh_token, device_id_str):
        raise ValueError("expired")

    monkeypatch.setattr(auth_routes.AuthService, "rotate_tokens", fake_rotate)

    async_client.cookies.set("refresh_token", "old_rt")
    resp = await async_client.post(
        "/api/auth/refresh",
    )
    assert resp.status_code == 401
    assert resp.json() == {"detail": "expired"}


# ---------------------------------------------------------------------------
# POST /auth/mfa/verify
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mfa_verify_success_sets_cookie(
    async_client, db_override, monkeypatch: pytest.MonkeyPatch
):
    captured = {}

    def fake_verify_mfa(self, **kwargs):
        captured.update(kwargs)
        return ("at", "rt", {"id": "u"})

    monkeypatch.setattr(auth_routes.AuthService, "verify_mfa", fake_verify_mfa)

    resp = await async_client.post(
        "/api/auth/mfa/verify",
        json={"mfa_token": "mt", "code": "123456", "trust_device": True, "device_name": "phone"},
        headers={"User-Agent": "agent/1.0"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"access_token": "at", "token_type": "bearer", "user": {"id": "u"}}
    assert resp.cookies["refresh_token"] == "rt"
    assert captured["mfa_token"] == "mt"
    assert captured["totp_code"] == "123456"
    assert captured["user_agent"] == "agent/1.0"
    assert captured["trust_device"] is True
    assert captured["device_name"] == "phone"


@pytest.mark.asyncio
async def test_mfa_verify_value_error_returns_401(
    async_client, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_verify_mfa(self, **kwargs):
        raise ValueError("invalid code")

    monkeypatch.setattr(auth_routes.AuthService, "verify_mfa", fake_verify_mfa)

    resp = await async_client.post(
        "/api/auth/mfa/verify",
        json={"mfa_token": "mt", "code": "wrong"},
    )
    assert resp.status_code == 401
    assert resp.json() == {"detail": "invalid code"}


# ---------------------------------------------------------------------------
# GET /auth/mfa/enroll
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mfa_enroll_get_success(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    seen = {}

    def fake_generate(self, user_id):
        seen["user_id"] = user_id
        return "SECRET123"

    monkeypatch.setattr(auth_routes.AuthService, "generate_mfa_setup", fake_generate)

    resp = await async_client.get("/api/auth/mfa/enroll")
    assert resp.status_code == 200
    assert resp.json() == {"secret": "SECRET123"}
    assert seen["user_id"] == b"user"


@pytest.mark.asyncio
async def test_mfa_enroll_get_value_error_returns_400(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_generate(self, user_id):
        raise ValueError("no mfa")

    monkeypatch.setattr(auth_routes.AuthService, "generate_mfa_setup", fake_generate)

    resp = await async_client.get("/api/auth/mfa/enroll")
    assert resp.status_code == 400
    assert resp.json() == {"detail": "no mfa"}


# ---------------------------------------------------------------------------
# POST /auth/mfa/enroll
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mfa_enroll_post_success(
    async_client, authed_user, db_override, device_override, monkeypatch: pytest.MonkeyPatch
):
    captured = {}

    def fake_enroll(self, **kwargs):
        captured.update(kwargs)
        return ("at", "rt", ["RC1"])

    monkeypatch.setattr(auth_routes.AuthService, "enroll_mfa", fake_enroll)

    resp = await async_client.post(
        "/api/auth/mfa/enroll",
        json={"secret": "SECRET123", "code": "123456"},
        headers={"User-Agent": "agent/1.0"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["message"] == "MFA enrollment successful"
    assert body["recovery_codes"] == ["RC1"]
    assert body["access_token"] == "at"
    assert body["token_type"] == "bearer"
    assert "enrolled_at" in body
    assert resp.cookies["refresh_token"] == "rt"
    assert captured["user_id"] == b"user"
    assert captured["secret"] == "SECRET123"
    assert captured["code"] == "123456"
    assert captured["device_id_str"] == "dev-1"
    assert captured["user_agent"] == "agent/1.0"


@pytest.mark.asyncio
async def test_mfa_enroll_post_value_error_returns_400(
    async_client, authed_user, db_override, device_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_enroll(self, **kwargs):
        raise ValueError("bad code")

    monkeypatch.setattr(auth_routes.AuthService, "enroll_mfa", fake_enroll)

    resp = await async_client.post(
        "/api/auth/mfa/enroll",
        json={"secret": "SECRET123", "code": "123456"},
    )
    assert resp.status_code == 400
    assert resp.json() == {"detail": "bad code"}


# ---------------------------------------------------------------------------
# GET /auth/devices
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_devices_returns_list(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    seen = {}

    def fake_get(self, user_id):
        seen["user_id"] = user_id
        return [
            {
                "device_id": "d1",
                "device_name": "phone",
                "trusted": True,
                "last_login_at": "2024-01-01T00:00:00",
                "user_agent": "agent",
                "recognized": True,
            }
        ]

    monkeypatch.setattr(auth_routes.AuthService, "get_user_devices", fake_get)

    resp = await async_client.get("/api/auth/devices")
    assert resp.status_code == 200
    body = resp.json()
    assert body["devices"][0]["device_id"] == "d1"
    assert body["devices"][0]["trusted"] is True
    assert seen["user_id"] == b"user"


# ---------------------------------------------------------------------------
# POST /auth/devices/{device_id}/untrust
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_untrust_device_success(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    captured = {}

    def fake_set(self, **kwargs):
        captured.update(kwargs)
        return None

    monkeypatch.setattr(auth_routes.AuthService, "set_device_trusted", fake_set)

    resp = await async_client.post("/api/auth/devices/dev-9/untrust")
    assert resp.status_code == 200
    assert resp.json() == {"message": "Device dev-9 untrusted and sessions revoked"}
    assert captured["user_id"] == b"user"
    assert captured["device_id_str"] == "dev-9"
    assert captured["trusted"] is False


@pytest.mark.asyncio
async def test_untrust_device_exception_returns_400(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_set(self, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(auth_routes.AuthService, "set_device_trusted", fake_set)

    resp = await async_client.post("/api/auth/devices/dev-9/untrust")
    assert resp.status_code == 400
    assert resp.json() == {"detail": "boom"}


# ---------------------------------------------------------------------------
# POST /auth/logout
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_logout_with_token_revokes_and_clears_cookie(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    seen = {}

    def fake_revoke(self, refresh_token):
        seen["refresh_token"] = refresh_token

    monkeypatch.setattr(auth_routes.AuthService, "revoke_session", fake_revoke)

    async_client.cookies.set("refresh_token", "old_rt")
    resp = await async_client.post(
        "/api/auth/logout",
        json={"device_id": "d1"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"detail": "Logged out"}
    assert seen["refresh_token"] == "old_rt"
    # cookie cleared (delete_cookie removes it from the response)
    assert "refresh_token" not in resp.cookies


@pytest.mark.asyncio
async def test_logout_without_token_skips_revoke(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    called = {"revoked": False}

    def fake_revoke(self, refresh_token):
        called["revoked"] = True

    monkeypatch.setattr(auth_routes.AuthService, "revoke_session", fake_revoke)

    resp = await async_client.post(
        "/api/auth/logout",
        json={"device_id": "d1"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"detail": "Logged out"}
    assert called["revoked"] is False


# ---------------------------------------------------------------------------
# POST /auth/recovery-codes/regenerate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_regenerate_recovery_codes_success(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    seen = {}

    def fake_regen(self, user_id, password):
        seen["user_id"] = user_id
        seen["password"] = password
        return ["RC-A", "RC-B"]

    monkeypatch.setattr(auth_routes.AuthService, "regenerate_recovery_codes", fake_regen)

    resp = await async_client.post(
        "/api/auth/recovery-codes/regenerate",
        json={"password": "password1"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"recovery_codes": ["RC-A", "RC-B"]}
    assert seen["user_id"] == b"user"
    assert seen["password"] == "password1"


@pytest.mark.asyncio
async def test_regenerate_recovery_codes_value_error_returns_400(
    async_client, authed_user, db_override, monkeypatch: pytest.MonkeyPatch
):
    def fake_regen(self, user_id, password):
        raise ValueError("rate limited")

    monkeypatch.setattr(auth_routes.AuthService, "regenerate_recovery_codes", fake_regen)

    resp = await async_client.post(
        "/api/auth/recovery-codes/regenerate",
        json={"password": "password1"},
    )
    assert resp.status_code == 400
    assert resp.json() == {"detail": "rate limited"}
