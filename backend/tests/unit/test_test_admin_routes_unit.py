"""Unit tests for backend.app.routes.test_admin.

These tests drive the remaining uncovered lines/branches of the test-admin route
module without touching any live database or network. The DB boundary (connect /
cursor context managers) is fully stubbed by a FakeConnection/FakeCursor, and the
security secrets used by the login handler are pinned so JWT encoding is
deterministic. Handlers are invoked directly (they have no FastAPI auth
dependency), with TEST_MODE enforced via the app fixture.

Targeted coverage gaps (vs. integration tests):
  - Lines 28-42: `_get_or_create_test_admin` "create" branch (user does not yet
    exist -> INSERT and returns (id_hex, True)).
  - Lines 155-173: the `test_login` handler (token minting path).
  - Lines 8-10: the `except ImportError` top-level import fallback branch.
"""

import importlib

import pytest

import backend.app.routes.test_admin as test_admin


# ---------------------------------------------------------------------------
# Fake DB boundary
# ---------------------------------------------------------------------------


class FakeCursor:
    def __init__(self, *, fetchone_result=None):
        self._fetchone_result = fetchone_result
        self.queries: list[tuple[str, tuple | None]] = []
        self.closed = False

    def execute(self, query, params=None):
        self.queries.append((query, tuple(params) if params is not None else None))
        return 1

    def fetchone(self):
        return self._fetchone_result

    def close(self):
        self.closed = True


class FakeConnection:
    def __init__(self, fetchone_result=None):
        self._fetchone_result = fetchone_result
        self.cursors: list[FakeCursor] = []
        self.closed = False

    def cursor(self):
        cur = FakeCursor(fetchone_result=self._fetchone_result)
        self.cursors.append(cur)
        return cur

    def close(self):
        self.closed = True


class _FakeConnectCM:
    def __init__(self, conn: FakeConnection):
        self._conn = conn

    def __enter__(self):
        return self._conn

    def __exit__(self, *exc):
        return False


class _FakeCursorCM:
    def __init__(self, conn: FakeConnection):
        self._conn = conn

    def __enter__(self):
        return self._conn.cursor()

    def __exit__(self, *exc):
        return False


@pytest.fixture
def fake_conn(monkeypatch: pytest.MonkeyPatch):
    created = {}

    def _make(fetchone_result=None):
        conn = FakeConnection(fetchone_result=fetchone_result)
        created["conn"] = conn
        return conn

    # Default: start with a connection whose SELECT returns no existing user,
    # so the "create" branch of _get_or_create_test_admin is exercised.
    conn = FakeConnection(fetchone_result=None)
    created["conn"] = conn

    monkeypatch.setattr(test_admin, "connect", lambda: _FakeConnectCM(_make()))
    monkeypatch.setattr(test_admin, "cursor", lambda c: _FakeCursorCM(c))
    monkeypatch.setattr(test_admin, "hash_password", lambda pw: f"hashed::{pw}")
    # test_login imports JWT_SECRET_KEY/JWT_ALGORITHM lazily from
    # backend.app.security, which default to usable values in TEST_MODE.
    return created


# ---------------------------------------------------------------------------
# _ensure_test_mode is a guard requiring TEST_MODE=1; the app fixture sets it,
# so all handlers run. We exercise the create branch and the login handler.
# ---------------------------------------------------------------------------


def test_get_or_create_test_admin_creates_when_missing(fake_conn):
    """Lines 28-42: when no test_admin user exists, one is INSERTed.

    _get_or_create_test_admin should return the fixed hex id and created=True,
    and the INSERT query must carry the deterministic admin id, username,
    hashed password, and 'admin' role.
    """
    admin_id_hex, created = test_admin._get_or_create_test_admin()

    assert admin_id_hex == "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    assert created is True

    conn = fake_conn["conn"]
    assert len(conn.cursors) >= 1
    # First cursor = SELECT (returns None); second cursor = INSERT.
    insert_cursor = conn.cursors[-1]
    insert_query, insert_params = insert_cursor.queries[-1]
    assert "INSERT INTO users" in insert_query
    assert insert_params[0] == "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    assert insert_params[1] == "test_admin"
    assert insert_params[2] == "hashed::testpassword"
    assert insert_params[3] == "admin"
    assert insert_params[4] == "{}"


def test_get_or_create_test_admin_returns_existing_when_present(monkeypatch):
    """Complementary branch (line 26 `if row:` True) for completeness."""
    existing_hex = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

    class _SelCur(FakeCursor):
        def fetchone(self):
            return (existing_hex,)

    class _SelConn(FakeConnection):
        def cursor(self):
            return _SelCur()

    monkeypatch.setattr(test_admin, "connect", lambda: _FakeConnectCM(_SelConn()))
    monkeypatch.setattr(test_admin, "cursor", lambda c: _FakeCursorCM(c))

    admin_id_hex, created = test_admin._get_or_create_test_admin()
    assert admin_id_hex == existing_hex
    assert created is False


def test_ensure_test_admin_user_returns_id(fake_conn):
    admin_id_hex = test_admin._ensure_test_admin_user()
    assert admin_id_hex == "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


def test_test_login_mints_token(fake_conn):
    """Lines 155-173: the login handler returns a bearer token + user info."""
    resp = test_admin.test_login()

    assert resp["token_type"] == "bearer"
    assert isinstance(resp["access_token"], str) and resp["access_token"]
    assert resp["user"]["id"] == "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    assert resp["user"]["username"] == "test_admin"
    assert resp["user"]["global_role"] == "admin"


# ---------------------------------------------------------------------------
# Lines 8-10: the `except ImportError` top-level fallback import branch.
# Simulated by importing the module under a name that breaks the relative
# import, forcing the fallback path to run.
# ---------------------------------------------------------------------------


def test_module_import_fallback_when_relative_import_fails():
    """Lines 8-10: when the relative import fails, the fallback runs.

    The module comment states the fallback fires "when imported as a
    top-level module during pytest collection". Loading the same source file
    under a top-level name (no package) makes the relative `from ..db.core`
    import genuinely fail, so the except branch performs the absolute import.
    Coverage tracks by source file, so these lines are recorded.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "test_admin_standalone_top",
        test_admin.__file__,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    # Fallback import path populated connect/cursor/hash_password from the
    # backend.app.* absolute path.
    assert hasattr(module, "connect")
    assert hasattr(module, "hash_password")
