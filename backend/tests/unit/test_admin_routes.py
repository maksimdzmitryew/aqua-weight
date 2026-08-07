"""Unit tests for backend.app.routes.admin.

These tests drive every line/branch of the admin route module without touching
any live database or network. External boundaries are mocked: the FastAPI auth
dependency (require_admin_user) and device id resolver (get_device_id), and the
DB dependency (get_db). Handlers are invoked directly via the app's dependency
overrides so production DB access is fully stubbed by a FakeConnection.
"""

import datetime
import hashlib
import secrets

import pytest

from backend.app.routes import admin as admin_routes
from backend.app.schemas.admin import InviteCreateRequest, RoleUpdateRequest
from backend.app.security import get_db, get_device_id, require_admin_user


@pytest.fixture(autouse=True)
def _reset_overrides(app):
    app.dependency_overrides = {}
    yield
    app.dependency_overrides = {}


_ADMIN_ID = bytes(range(16))
_ADMIN_HEX = _ADMIN_ID.hex()  # 32-char hex id accepted by hex_to_bin


def _admin_user() -> dict:
    return {
        "id": _ADMIN_ID,
        "id_hex": _ADMIN_HEX,
        "username": "admin",
        "global_role": "admin",
    }


_TARGET_ID = bytes(16)
_TARGET_HEX = _TARGET_ID.hex()


@pytest.fixture
def admin_user(app):
    user = _admin_user()
    app.dependency_overrides[require_admin_user] = lambda: user
    return user


class FakeCursor:
    def __init__(self, *, fetchone_result=None, fetchone_results=None, fetchall_result=None):
        if fetchone_results is None:
            fetchone_results = [fetchone_result]
        self._fetchone_queue = list(fetchone_results)
        self._fetchall_result = fetchall_result or []
        self.queries: list[tuple[str, tuple | None]] = []
        self.closed = False

    def execute(self, query, params=None):
        self.queries.append((query, tuple(params) if params is not None else None))
        return 1

    def fetchone(self):
        if not self._fetchone_queue:
            return None
        return self._fetchone_queue.pop(0)

    def fetchall(self):
        return list(self._fetchall_result)

    def close(self):
        self.closed = True


class FakeConnection:
    def __init__(self, cursors: list[FakeCursor], *, autocommit=True):
        self._cursors = list(cursors)
        self.seen: list[FakeCursor] = []
        self.autocommit_calls: list[bool] = []
        self.committed = 0
        self.rolled_back = 0
        self._autocommit = autocommit

    def cursor(self):
        cur = self._cursors.pop(0) if self._cursors else FakeCursor()
        self.seen.append(cur)
        return cur

    def autocommit(self, value: bool) -> None:
        self._autocommit = value
        self.autocommit_calls.append(value)

    def commit(self) -> None:
        self.committed += 1

    def rollback(self) -> None:
        self.rolled_back += 1


@pytest.fixture
def db_override(app):
    conn = FakeConnection([])
    app.dependency_overrides[get_db] = lambda: conn
    return conn


# ---------------------------------------------------------------------------
# GET /admin/users
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_users_returns_mapped_entries(app, admin_user, db_override):
    created = datetime.datetime(2026, 1, 1, 12, 0, 0, tzinfo=datetime.timezone.utc)
    rows = [
        (
            b"\x01\x02\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00",
            "alice",
            "admin",
            created,
            1,
        ),
        (
            b"\x03\x04\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00",
            "bob",
            "customer",
            created,
            0,
        ),
    ]
    db_override._cursors = [FakeCursor(fetchall_result=rows)]

    resp = await admin_routes.list_users(db=db_override, _admin=admin_user)

    assert resp.users[0].username == "alice"
    assert resp.users[0].mfa_enabled is True
    assert (
        resp.users[0].id_hex
        == b"\x01\x02\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".hex()
    )
    assert resp.users[1].mfa_enabled is False
    assert (
        resp.users[1].id_hex
        == b"\x03\x04\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".hex()
    )


@pytest.mark.asyncio
async def test_list_users_empty(app, admin_user, db_override):
    db_override._cursors = [FakeCursor(fetchall_result=[])]

    resp = await admin_routes.list_users(db=db_override, _admin=admin_user)

    assert resp.users == []


# ---------------------------------------------------------------------------
# PATCH /admin/users/{user_id_hex}/role
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_user_role_success(app, admin_user, db_override):
    target_hex = _TARGET_HEX
    db_override._cursors = [FakeCursor(fetchone_result=(1,))]

    resp = await admin_routes.update_user_role(
        user_id_hex=target_hex,
        payload=RoleUpdateRequest(global_role="customer"),
        db=db_override,
        current_user=admin_user,
    )

    assert resp == {"message": "User role updated successfully"}
    update_query, update_params = db_override.seen[-1].queries[-1]
    assert "UPDATE users SET global_role" in update_query
    assert update_params[0] == "customer"
    assert update_params[1] == _TARGET_ID


@pytest.mark.asyncio
async def test_update_user_role_rejects_self(app, admin_user, db_override):
    with pytest.raises(Exception) as exc:
        await admin_routes.update_user_role(
            user_id_hex=admin_user["id_hex"],
            payload=RoleUpdateRequest(global_role="customer"),
            db=db_override,
            current_user=admin_user,
        )
    assert exc.value.status_code == 400
    # No DB access should be attempted when self-target is rejected.
    assert db_override.seen == []


@pytest.mark.asyncio
async def test_update_user_role_invalid_id_format(app, admin_user, db_override):
    with pytest.raises(Exception) as exc:
        await admin_routes.update_user_role(
            user_id_hex="not-hex",
            payload=RoleUpdateRequest(global_role="customer"),
            db=db_override,
            current_user=admin_user,
        )
    assert exc.value.status_code == 400
    assert db_override.seen == []


@pytest.mark.asyncio
async def test_update_user_role_user_not_found(app, admin_user, db_override):
    target_hex = _TARGET_HEX
    db_override._cursors = [FakeCursor(fetchone_result=None)]

    with pytest.raises(Exception) as exc:
        await admin_routes.update_user_role(
            user_id_hex=target_hex,
            payload=RoleUpdateRequest(global_role="customer"),
            db=db_override,
            current_user=admin_user,
        )
    assert exc.value.status_code == 404
    # Only the SELECT (existence check) should have run, not the UPDATE.
    assert len(db_override.seen) == 1
    assert db_override.seen[0].queries[0][0].startswith("SELECT 1 FROM users")


# ---------------------------------------------------------------------------
# POST /admin/users/{user_id_hex}/mfa-reset
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reset_user_mfa_invalid_id_format(app, admin_user, db_override):
    with pytest.raises(Exception) as exc:
        await admin_routes.reset_user_mfa(
            user_id_hex="not-hex",
            db=db_override,
            current_user=admin_user,
            current_device_id_str="dev-1",
        )
    assert exc.value.status_code == 400
    assert db_override.seen == []


@pytest.mark.asyncio
async def test_reset_user_mfa_user_not_found(app, admin_user, db_override):
    target_hex = _TARGET_HEX
    db_override._cursors = [FakeCursor(fetchone_result=None)]

    with pytest.raises(Exception) as exc:
        await admin_routes.reset_user_mfa(
            user_id_hex=target_hex,
            db=db_override,
            current_user=admin_user,
            current_device_id_str="dev-1",
        )
    assert exc.value.status_code == 404
    # Only the existence SELECT should run.
    assert len(db_override.seen) == 1


@pytest.mark.asyncio
async def test_reset_user_mfa_self_reset_device_found(app, admin_user, db_override):
    target_hex = admin_user["id_hex"]
    # First fetchone -> user exists; second fetchone -> device found.
    cur = FakeCursor(fetchone_results=[(1,), (42,)])
    db_override._cursors = [cur]

    resp = await admin_routes.reset_user_mfa(
        user_id_hex=target_hex,
        db=db_override,
        current_user=admin_user,
        current_device_id_str="dev-1",
    )

    assert resp == {"message": "MFA reset and sessions revoked successfully"}
    assert db_override.committed == 1
    assert db_override.rolled_back == 0
    assert any("DELETE FROM user_totp_secrets" in q for q, _ in cur.queries)
    assert any("DELETE FROM user_recovery_codes" in q for q, _ in cur.queries)
    assert any("SELECT id FROM devices WHERE device_id" in q for q, _ in cur.queries)
    scoped_update = [q for q, p in cur.queries if "UPDATE auth_refresh_tokens" in q]
    assert scoped_update
    assert "device_id != %s" in scoped_update[-1]
    assert db_override.autocommit_calls == [False, True]


@pytest.mark.asyncio
async def test_reset_user_mfa_self_reset_device_not_found(app, admin_user, db_override):
    target_hex = admin_user["id_hex"]
    # First fetchone -> user exists; second fetchone -> device NOT found.
    cur = FakeCursor(fetchone_results=[(1,), None])
    db_override._cursors = [cur]

    resp = await admin_routes.reset_user_mfa(
        user_id_hex=target_hex,
        db=db_override,
        current_user=admin_user,
        current_device_id_str="dev-1",
    )

    assert resp == {"message": "MFA reset and sessions revoked successfully"}
    # The fallback UPDATE (no device exclusion) must run.
    fallback_update = [q for q, _ in cur.queries if "UPDATE auth_refresh_tokens" in q]
    assert fallback_update
    assert "device_id != %s" not in fallback_update[-1]


@pytest.mark.asyncio
async def test_reset_user_mfa_other_user(app, admin_user, db_override):
    target_hex = _TARGET_HEX
    # Only the existence-check fetchone is reached for another user.
    db_override._cursors = [FakeCursor(fetchone_result=(1,))]

    resp = await admin_routes.reset_user_mfa(
        user_id_hex=target_hex,
        db=db_override,
        current_user=admin_user,
        current_device_id_str="dev-1",
    )

    assert resp == {"message": "MFA reset and sessions revoked successfully"}
    cur = db_override.seen[-1]
    revoke_update = [q for q, _ in cur.queries if "UPDATE auth_refresh_tokens" in q]
    assert revoke_update
    # No device exclusion for another user.
    assert "device_id != %s" not in revoke_update[-1]


@pytest.mark.asyncio
async def test_reset_user_mfa_rolls_back_on_error(app, admin_user, db_override):
    target_hex = _TARGET_HEX

    class BoomCursor(FakeCursor):
        def execute(self, query, params=None):
            if "DELETE FROM user_recovery_codes" in query:
                raise RuntimeError("db failure")
            return super().execute(query, params)

    db_override._cursors = [BoomCursor(fetchone_result=(1,))]

    with pytest.raises(RuntimeError):
        await admin_routes.reset_user_mfa(
            user_id_hex=target_hex,
            db=db_override,
            current_user=admin_user,
            current_device_id_str="dev-1",
        )

    assert db_override.rolled_back == 1
    assert db_override.committed == 0


# ---------------------------------------------------------------------------
# POST /admin/invites
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_invite_default_expiry(app, admin_user, db_override):
    db_override._cursors = [FakeCursor()]

    resp = await admin_routes.create_invite(
        payload=InviteCreateRequest(),
        db=db_override,
        current_user=admin_user,
    )

    assert isinstance(resp.token, str) and len(resp.token) > 0
    assert resp.expires_at > datetime.datetime.now(datetime.timezone.utc)
    insert_query, insert_params = db_override.seen[-1].queries[-1]
    assert "INSERT INTO invite_tokens" in insert_query
    assert insert_params[1] == _ADMIN_ID
    # SHA256 digest of the token.
    assert isinstance(insert_params[0], bytes) and len(insert_params[0]) == 32


@pytest.mark.asyncio
async def test_create_invite_custom_expiry(app, admin_user, db_override):
    db_override._cursors = [FakeCursor()]

    resp = await admin_routes.create_invite(
        payload=InviteCreateRequest(expires_in_days=30),
        db=db_override,
        current_user=admin_user,
    )

    expected = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=30)
    # Within a few seconds tolerance.
    assert abs((resp.expires_at - expected).total_seconds()) < 30
    insert_query, insert_params = db_override.seen[-1].queries[-1]
    assert "INSERT INTO invite_tokens" in insert_query
    # Ensure the persisted token_hash is the SHA256 of the returned token.
    assert insert_params[0] == hashlib.sha256(resp.token.encode()).digest()
