from __future__ import annotations

import re
import importlib
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from starlette.requests import Request

import backend.app.security as sec


def test_require_api_key_allows_in_test_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_MODE", "1")
    monkeypatch.setenv("API_KEY", "secret")

    sec.require_api_key(None)


def test_require_api_key_allows_when_api_key_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_MODE", "0")
    monkeypatch.delenv("API_KEY", raising=False)

    sec.require_api_key(None)


def test_require_api_key_allows_when_api_key_matches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_MODE", "0")
    monkeypatch.setenv("API_KEY", "secret")

    sec.require_api_key("secret")


def test_require_api_key_raises_when_api_key_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_MODE", "0")
    monkeypatch.setenv("API_KEY", "secret")

    with pytest.raises(HTTPException) as exc_info:
        sec.require_api_key("wrong")

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Unauthorized"


class FakeCursor:
    def __init__(self, fetchone_results=None):
        self._fetchone_results = list(fetchone_results or [])
        self.executed: list[tuple[str, tuple | None]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        self.executed.append((query, tuple(params) if params is not None else None))
        return 1

    def fetchone(self):
        return self._fetchone_results.pop(0) if self._fetchone_results else None


class FakeDB:
    def __init__(self, cursors: list[FakeCursor]):
        self._cursors = list(cursors)
        self.seen: list[FakeCursor] = []

    def cursor(self):
        cur = self._cursors.pop(0) if self._cursors else FakeCursor()
        self.seen.append(cur)
        return cur


def _request_with_headers(*, user_agent: str = "UA", cookie: str | None = None) -> Request:
    headers = [(b"user-agent", user_agent.encode())]
    if cookie is not None:
        headers.append((b"cookie", cookie.encode()))
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": headers,
        "query_string": b"",
        "server": ("test", 80),
        "client": ("test", 123),
    }
    return Request(scope)


def test_hash_and_verify_password_roundtrip() -> None:
    hashed = sec.hash_password("pw")
    assert sec.verify_password("pw", hashed) is True
    assert sec.verify_password("wrong", hashed) is False


def test_verify_password_generic_exception_returns_false(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that verify_password returns False on any unexpected exception from argon2."""
    from argon2 import PasswordHasher

    class MockHasher:
        def hash(self, password: str) -> str:
            return PasswordHasher().hash(password)

        def verify(self, hashed_password: str, password: str) -> None:
            raise RuntimeError("argon2 internal error")

    # Replace the module's pwd_hasher with our mock
    monkeypatch.setattr(sec, "pwd_hasher", MockHasher())
    assert sec.verify_password("any", "any_hash") is False


def test_totp_secret_and_verification_roundtrip() -> None:
    secret = sec.generate_totp_secret()
    assert isinstance(secret, str)
    code = sec.pyotp.TOTP(secret).now()
    assert sec.verify_totp_code(secret, code) is True


def test_generate_recovery_codes_format_and_count() -> None:
    codes = sec.generate_recovery_codes(count=3)
    assert len(codes) == 3
    assert all(re.fullmatch(r"[A-Z0-9]{4}-[A-Z0-9]{4}", c) for c in codes)


def test_recovery_code_hash_and_verify_roundtrip() -> None:
    code = "ABCD-EF12"
    hashed = sec.hash_recovery_code(code)
    assert sec.verify_recovery_code(code, hashed) is True
    assert sec.verify_recovery_code("ZZZZ-ZZZZ", hashed) is False


@pytest.mark.asyncio
async def test_get_device_id_prefers_header_over_cookie() -> None:
    req = _request_with_headers(cookie="device_id=cookie123")
    out = await sec.get_device_id(request=req, x_device_id="hdr123")
    assert out == "hdr123"


@pytest.mark.asyncio
async def test_get_device_id_falls_back_to_cookie() -> None:
    req = _request_with_headers(cookie="device_id=cookie123")
    out = await sec.get_device_id(request=req, x_device_id=None)
    assert out == "cookie123"


@pytest.mark.asyncio
async def test_get_device_id_missing_returns_empty() -> None:
    req = _request_with_headers(cookie=None)
    out = await sec.get_device_id(request=req, x_device_id=None)
    assert out == ""


def test_page_nonce_generate_and_verify_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    req = _request_with_headers(user_agent="UA")
    times = iter([94, 100])  # generate uses 94; verify uses 100 -> age=6
    monkeypatch.setattr(sec.time, "time", lambda: next(times))

    nonce = sec.generate_page_nonce(req)
    assert sec.verify_page_nonce(nonce, req) is True


def test_page_nonce_invalid_base64_returns_false() -> None:
    req = _request_with_headers(user_agent="UA")
    assert sec.verify_page_nonce("not-base64", req) is False


def test_page_nonce_too_young_and_too_old(monkeypatch: pytest.MonkeyPatch) -> None:
    req = _request_with_headers(user_agent="UA")

    # Too young: age=1
    times = iter([99, 100])
    monkeypatch.setattr(sec.time, "time", lambda: next(times))
    nonce = sec.generate_page_nonce(req)
    assert sec.verify_page_nonce(nonce, req) is False

    # Too old: age=901
    times = iter([0, 901])
    monkeypatch.setattr(sec.time, "time", lambda: next(times))
    nonce = sec.generate_page_nonce(req)
    assert sec.verify_page_nonce(nonce, req) is False


def test_page_nonce_signature_mismatch_returns_false(monkeypatch: pytest.MonkeyPatch) -> None:
    req_gen = _request_with_headers(user_agent="UA1")
    req_verify = _request_with_headers(user_agent="UA2")
    times = iter([94, 100])
    monkeypatch.setattr(sec.time, "time", lambda: next(times))
    nonce = sec.generate_page_nonce(req_gen)
    assert sec.verify_page_nonce(nonce, req_verify) is False


@pytest.mark.asyncio
async def test_require_authenticated_user_bearer_missing_subject(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sec.jwt, "decode", lambda *_a, **_k: {})
    auth = HTTPAuthorizationCredentials(scheme="Bearer", credentials="t")
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_authenticated_user(auth=auth, db=object(), x_api_key=None)
    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    assert "missing subject" in exc_info.value.detail


@pytest.mark.asyncio
async def test_require_authenticated_user_bearer_user_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sec.jwt, "decode", lambda *_a, **_k: {"sub": "a" * 32})
    monkeypatch.setattr(sec, "hex_to_bin", lambda _h: b"u" * 16)

    db = FakeDB([FakeCursor(fetchone_results=[None])])
    auth = HTTPAuthorizationCredentials(scheme="Bearer", credentials="t")
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_authenticated_user(auth=auth, db=db, x_api_key=None)
    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    assert "user not found" in exc_info.value.detail


@pytest.mark.asyncio
async def test_require_authenticated_user_bearer_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sec.jwt, "decode", lambda *_a, **_k: {"sub": "a" * 32})
    monkeypatch.setattr(sec, "hex_to_bin", lambda _h: b"u" * 16)

    user_row = (b"u" * 16, "name", "user")
    db = FakeDB([FakeCursor(fetchone_results=[user_row])])
    auth = HTTPAuthorizationCredentials(scheme="Bearer", credentials="t")
    out = await sec.require_authenticated_user(auth=auth, db=db, x_api_key=None)
    assert out["id"] == b"u" * 16
    assert out["id_hex"] == "a" * 32
    assert out["username"] == "name"
    assert out["global_role"] == "user"


@pytest.mark.asyncio
async def test_require_authenticated_user_bearer_expired(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_a, **_k):
        raise sec.jwt.ExpiredSignatureError("expired")

    monkeypatch.setattr(sec.jwt, "decode", boom)
    auth = HTTPAuthorizationCredentials(scheme="Bearer", credentials="t")
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_authenticated_user(auth=auth, db=object(), x_api_key=None)
    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    assert exc_info.value.detail == "Bearer token expired"


@pytest.mark.asyncio
async def test_require_authenticated_user_bearer_invalid(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_a, **_k):
        raise sec.jwt.PyJWTError("bad")

    monkeypatch.setattr(sec.jwt, "decode", boom)
    auth = HTTPAuthorizationCredentials(scheme="Bearer", credentials="t")
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_authenticated_user(auth=auth, db=object(), x_api_key=None)
    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    assert exc_info.value.detail == "Invalid Bearer token"


@pytest.mark.asyncio
async def test_require_authenticated_user_test_mode_fallback_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_MODE", "1")
    monkeypatch.delenv("API_KEY", raising=False)

    with pytest.raises(HTTPException) as exc_info:
        await sec.require_authenticated_user(auth=None, db=FakeDB([]), x_api_key=None)
    assert exc_info.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR


@pytest.mark.asyncio
async def test_require_authenticated_user_test_mode_fallback_admin_from_db(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_MODE", "1")
    monkeypatch.setenv("API_KEY", "k")

    admin_row = (b"a" * 16, "admin", "admin")
    db = FakeDB([FakeCursor(fetchone_results=[admin_row])])
    out = await sec.require_authenticated_user(auth=None, db=db, x_api_key="k")
    assert out["username"] == "admin"
    assert out["global_role"] == "admin"
    assert out["id_hex"] == (b"a" * 16).hex()


@pytest.mark.asyncio
async def test_require_authenticated_user_test_mode_fallback_no_admin_user(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_MODE", "1")
    monkeypatch.setenv("API_KEY", "k")
    db = FakeDB([FakeCursor(fetchone_results=[None])])
    out = await sec.require_authenticated_user(auth=None, db=db, x_api_key="k")
    assert out == {"id": None, "id_hex": None, "username": "test_admin", "global_role": "admin"}


@pytest.mark.asyncio
async def test_require_authenticated_user_test_mode_fallback_invalid_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_MODE", "1")
    monkeypatch.setenv("API_KEY", "k")
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_authenticated_user(auth=None, db=FakeDB([]), x_api_key="wrong")
    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    assert "Invalid API Key" in exc_info.value.detail


@pytest.mark.asyncio
async def test_require_authenticated_user_non_test_mode_requires_bearer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_MODE", "0")
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_authenticated_user(auth=None, db=FakeDB([]), x_api_key=None)
    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    assert "Bearer token missing" in exc_info.value.detail


@pytest.mark.asyncio
async def test_require_admin_user_allows_admin_and_rejects_non_admin() -> None:
    admin = {"global_role": "admin"}
    assert await sec.require_admin_user(admin) is admin
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_admin_user({"global_role": "user"})
    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.asyncio
async def test_require_location_access_branches() -> None:
    valid_hex = "a" * 32
    req = SimpleNamespace(path_params={"location_id": valid_hex})

    # Admin returns immediately
    out = await sec.require_location_access(req, {"global_role": "admin", "id": b"u"}, FakeDB([]))
    assert out == valid_hex

    # Missing location_id
    assert (
        await sec.require_location_access(
            SimpleNamespace(path_params={}),
            {"global_role": "user", "id": b"u"},
            FakeDB([]),
        )
        == ""
    )

    # Invalid hex
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_location_access(SimpleNamespace(path_params={"location_id": "zzz"}), {"global_role": "user", "id": b"u"}, FakeDB([]))
    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST

    # Test-mode fallback user with id=None returns location_id
    out = await sec.require_location_access(req, {"global_role": "user", "id": None}, FakeDB([]))
    assert out == valid_hex

    # No ACL row -> 403
    db = FakeDB([FakeCursor(fetchone_results=[None])])
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_location_access(req, {"global_role": "user", "id": b"u"}, db)
    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN

    # ACL row present -> allowed
    db = FakeDB([FakeCursor(fetchone_results=[("helper",)])])
    out = await sec.require_location_access(req, {"global_role": "user", "id": b"u"}, db)
    assert out == valid_hex


@pytest.mark.asyncio
async def test_verify_location_access_branches() -> None:
    valid_hex = "a" * 32
    # Invalid
    with pytest.raises(HTTPException):
        await sec.verify_location_access(FakeDB([]), b"u", "user", "zzz")

    # Admin/user_id None shortcuts
    assert await sec.verify_location_access(FakeDB([]), b"u", "admin", valid_hex) is None
    assert await sec.verify_location_access(FakeDB([]), None, "user", valid_hex) is None

    # No row -> denied
    with pytest.raises(HTTPException) as exc_info:
        await sec.verify_location_access(FakeDB([FakeCursor(fetchone_results=[None])]), b"u", "user", valid_hex)
    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN

    # Require owner and not owner -> denied
    with pytest.raises(HTTPException) as exc_info:
        await sec.verify_location_access(
            FakeDB([FakeCursor(fetchone_results=[("helper",)])]),
            b"u",
            "user",
            valid_hex,
            require_owner=True,
        )
    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN

    # Owner -> ok
    assert (
        await sec.verify_location_access(
            FakeDB([FakeCursor(fetchone_results=[("owner",)])]),
            b"u",
            "user",
            valid_hex,
            require_owner=True,
        )
        is None
    )


@pytest.mark.asyncio
async def test_require_plant_access_and_owner_branches() -> None:
    plant_hex = "b" * 32
    req = SimpleNamespace(path_params={"plant_id": plant_hex})

    # Missing plant_id
    assert await sec.require_plant_access(SimpleNamespace(path_params={}), {"global_role": "user", "id": b"u"}, FakeDB([])) == ""

    # Invalid hex
    with pytest.raises(HTTPException):
        await sec.require_plant_access(SimpleNamespace(path_params={"plant_id": "zzz"}), {"global_role": "user", "id": b"u"}, FakeDB([]))

    # Admin not found -> 404
    db = FakeDB([FakeCursor(fetchone_results=[None])])
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_plant_access(req, {"global_role": "admin", "id": b"u"}, db)
    assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND

    # Admin found -> ok
    db = FakeDB([FakeCursor(fetchone_results=[(1,)])])
    assert await sec.require_plant_access(req, {"global_role": "admin", "id": b"u"}, db) == plant_hex

    # Non-admin not found -> 404
    db = FakeDB([FakeCursor(fetchone_results=[None])])
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_plant_access(req, {"global_role": "user", "id": b"u"}, db)
    assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND

    # Non-admin allowed by ACL
    user_id = b"u" * 16
    db = FakeDB([FakeCursor(fetchone_results=[(b"x" * 16, "helper")])])
    assert await sec.require_plant_access(req, {"global_role": "user", "id": user_id}, db) == plant_hex

    # Non-admin denied
    db = FakeDB([FakeCursor(fetchone_results=[(b"x" * 16, None)])])
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_plant_access(req, {"global_role": "user", "id": user_id}, db)
    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN

    # Plant owner required: allowed by direct owner
    db = FakeDB([FakeCursor(fetchone_results=[(user_id, None)])])
    assert await sec.require_plant_owner(req, {"global_role": "user", "id": user_id}, db) == plant_hex

    # Plant owner required: missing plant_id
    assert (
        await sec.require_plant_owner(
            SimpleNamespace(path_params={}),
            {"global_role": "user", "id": user_id},
            FakeDB([]),
        )
        == ""
    )

    # Plant owner required: invalid hex
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_plant_owner(
            SimpleNamespace(path_params={"plant_id": "zzz"}),
            {"global_role": "user", "id": user_id},
            FakeDB([]),
        )
    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST

    # Admin in require_plant_owner not found -> 404
    db = FakeDB([FakeCursor(fetchone_results=[None])])
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_plant_owner(req, {"global_role": "admin", "id": user_id}, db)
    assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND

    # Admin in require_plant_owner found -> ok
    db = FakeDB([FakeCursor(fetchone_results=[(1,)])])
    assert await sec.require_plant_owner(req, {"global_role": "admin", "id": user_id}, db) == plant_hex

    # Non-admin require_plant_owner row missing -> 404
    db = FakeDB([FakeCursor(fetchone_results=[None])])
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_plant_owner(req, {"global_role": "user", "id": user_id}, db)
    assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND

    # Plant owner required: denied
    db = FakeDB([FakeCursor(fetchone_results=[(b"x" * 16, "helper")])])
    with pytest.raises(HTTPException) as exc_info:
        await sec.require_plant_owner(req, {"global_role": "user", "id": user_id}, db)
    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.asyncio
async def test_verify_plant_access_and_measurement_access(monkeypatch: pytest.MonkeyPatch) -> None:
    plant_hex = "b" * 32
    meas_hex = "c" * 32

    # Invalid plant id
    with pytest.raises(HTTPException):
        await sec.verify_plant_access(FakeDB([]), b"u", "user", "zzz")

    # Admin shortcut
    assert await sec.verify_plant_access(FakeDB([]), b"u", "admin", plant_hex) is None

    # Not found
    with pytest.raises(HTTPException) as exc_info:
        await sec.verify_plant_access(FakeDB([FakeCursor(fetchone_results=[None])]), b"u", "user", plant_hex)
    assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND

    # Allowed (non-owner, helper)
    db = FakeDB([FakeCursor(fetchone_results=[(b"x" * 16, "helper")])])
    assert await sec.verify_plant_access(db, b"u" * 16, "user", plant_hex) is None

    # Require owner denied
    db = FakeDB([FakeCursor(fetchone_results=[(b"x" * 16, "helper")])])
    with pytest.raises(HTTPException) as exc_info:
        await sec.verify_plant_access(db, b"u" * 16, "user", plant_hex, require_owner=True)
    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN

    # Require owner allowed
    db = FakeDB([FakeCursor(fetchone_results=[(b"u" * 16, None)])])
    assert await sec.verify_plant_access(db, b"u" * 16, "user", plant_hex, require_owner=True) is None

    # Non-owner denied for non-owner checks
    db = FakeDB([FakeCursor(fetchone_results=[(b"x" * 16, None)])])
    with pytest.raises(HTTPException) as exc_info:
        await sec.verify_plant_access(db, b"u" * 16, "user", plant_hex, require_owner=False)
    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN

    # Measurement access: invalid
    with pytest.raises(HTTPException):
        await sec.verify_measurement_access(FakeDB([]), b"u", "user", "zzz")

    # Measurement not found
    db = FakeDB([FakeCursor(fetchone_results=[None])])
    with pytest.raises(HTTPException) as exc_info:
        await sec.verify_measurement_access(db, b"u", "user", meas_hex)
    assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND

    # Measurement found delegates to verify_plant_access
    db = FakeDB([FakeCursor(fetchone_results=[(plant_hex,)])])
    called = {}

    async def fake_verify_plant_access(db_arg, user_id, global_role, plant_id, require_owner=False):
        called["args"] = (db_arg, user_id, global_role, plant_id, require_owner)

    monkeypatch.setattr(sec, "verify_plant_access", fake_verify_plant_access)
    out = await sec.verify_measurement_access(db, b"u", "user", meas_hex)
    assert out == plant_hex
    assert called["args"] == (db, b"u", "user", plant_hex, False)

    # require_measurement_access reads id_hex from request
    req = SimpleNamespace(path_params={"id_hex": meas_hex})

    async def fake_verify_measurement_access(*_a, **_k):
        return plant_hex

    monkeypatch.setattr(sec, "verify_measurement_access", fake_verify_measurement_access)
    out2 = await sec.require_measurement_access(req, {"id": b"u", "global_role": "user"}, db)
    assert out2 == plant_hex

    # Missing id_hex in request
    assert (
        await sec.require_measurement_access(
            SimpleNamespace(path_params={}),
            {"id": b"u", "global_role": "user"},
            db,
        )
        == ""
    )


@pytest.mark.asyncio
async def test_get_db_yields_and_closes(monkeypatch: pytest.MonkeyPatch) -> None:
    class Conn:
        def __init__(self):
            self.closed = False

        def close(self):
            self.closed = True

    conn = Conn()
    monkeypatch.setattr(sec, "get_conn", lambda: conn)

    agen = sec.get_db()
    got = await agen.__anext__()
    assert got is conn
    await agen.aclose()
    assert conn.closed is True


def test_module_env_enforcement_raises_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    # Reload the module under a "production"-like env to execute the guard.
    monkeypatch.setenv("TEST_MODE", "0")
    monkeypatch.setenv("APP_ENV", "production")

    # If both secrets are set, the module should import successfully.
    monkeypatch.setenv("JWT_SECRET_KEY", "secure")
    monkeypatch.setenv("NONCE_SECRET_KEY", "secure")
    importlib.reload(sec)

    # First: ensure we can reach the NONCE check by providing a secure JWT key.
    monkeypatch.setenv("JWT_SECRET_KEY", "secure")
    monkeypatch.delenv("NONCE_SECRET_KEY", raising=False)
    with pytest.raises(RuntimeError, match="NONCE_SECRET_KEY must be set"):
        importlib.reload(sec)

    # Second: JWT secret missing should fail first.
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
    monkeypatch.delenv("NONCE_SECRET_KEY", raising=False)
    with pytest.raises(RuntimeError, match="JWT_SECRET_KEY must be set"):
        importlib.reload(sec)

    # Restore to a safe env for the rest of the test process.
    monkeypatch.setenv("TEST_MODE", "1")
    monkeypatch.setenv("APP_ENV", "development")
    importlib.reload(sec)
