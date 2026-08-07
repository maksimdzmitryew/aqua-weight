"""Unit tests for backend.app.services.auth_service.

These drive every line/branch of auth_service.py to 100% coverage using
lightweight fakes for the DB boundary (no real MariaDB, no real argon2).
"""

import jwt
from contextlib import ExitStack, contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from backend.app.services.auth_service import AuthService, generate_ulid_bytes


USER_ID = bytes(range(16))
USER_ID_HEX = USER_ID.hex()
DEVICE_ID_STR = "device-123"


class FakeCursor:
    def __init__(
        self,
        *,
        fetchone=None,
        fetchall=None,
        fetchone_seq=None,
        execute_side_effect=None,
    ):
        self._fetchone = fetchone
        self._fetchone_seq = list(fetchone_seq) if fetchone_seq is not None else None
        self._fetchall = fetchall if fetchall is not None else []
        self.queries = []
        self.closed = False
        self._raise = execute_side_effect

    def execute(self, query, params=None):
        self.queries.append((query, tuple(params) if params is not None else None))
        if self._raise is not None:
            if isinstance(self._raise, list):
                val = self._raise.pop(0)
                if isinstance(val, Exception):
                    raise val
                return val
            raise self._raise

    def fetchone(self):
        if self._fetchone_seq is not None:
            return self._fetchone_seq.pop(0) if self._fetchone_seq else None
        return self._fetchone

    def fetchall(self):
        return list(self._fetchall)

    def close(self):
        self.closed = True


class FakeConn:
    def __init__(self, cursors):
        self._cursors = list(cursors)
        self.seen = []
        self.autocommit = MagicMock()
        self.commit = MagicMock()
        self.rollback = MagicMock()

    def cursor(self):
        cur = self._cursors.pop(0) if self._cursors else FakeCursor()
        self.seen.append(cur)
        return cur


def c(*, fetchone=None, fetchall=None, fetchone_seq=None, execute_raises=None):
    return FakeCursor(
        fetchone=fetchone,
        fetchall=fetchall,
        fetchone_seq=fetchone_seq,
        execute_side_effect=execute_raises,
    )


@contextmanager
def patch_all(jwt_decode=None):
    with ExitStack() as stack:
        mocks = {}
        for name in [
            "verify_password",
            "verify_totp_code",
            "verify_recovery_code",
            "generate_recovery_codes",
            "hash_password",
            "hash_recovery_code",
        ]:
            m = stack.enter_context(patch(f"backend.app.services.auth_service.{name}"))
            mocks[name] = m

        mocks["verify_password"].return_value = True
        mocks["verify_totp_code"].return_value = True
        mocks["verify_recovery_code"].return_value = True
        mocks["generate_recovery_codes"].return_value = [f"RC{i:04d}-AAAA" for i in range(10)]
        mocks["hash_password"].return_value = "HP"
        mocks["hash_recovery_code"].return_value = "HR"

        if jwt_decode is not None:
            mocks["jwt_decode"] = stack.enter_context(
                patch(
                    "backend.app.services.auth_service.jwt.decode",
                    side_effect=jwt_decode,
                )
            )
        yield mocks


# --------------------------------------------------------------------------- #
# Helpers / constructor
# --------------------------------------------------------------------------- #


def test_constructor_stores_connection():
    conn = FakeConn([])
    svc = AuthService(conn)
    assert svc.db is conn


def test_hash_token_returns_32_byte_digest():
    svc = AuthService(FakeConn([]))
    digest = svc._hash_token("abc")
    assert isinstance(digest, bytes)
    assert len(digest) == 32


def test_generate_refresh_token_is_url_safe_string():
    svc = AuthService(FakeConn([]))
    token = svc._generate_refresh_token()
    assert isinstance(token, str)
    assert len(token) == 43  # secrets.token_urlsafe(32)


def test_get_now_utc_is_timezone_aware():
    svc = AuthService(FakeConn([]))
    now = svc._get_now_utc()
    assert isinstance(now, datetime)
    assert now.tzinfo is not None


def test_generate_ulid_bytes_returns_sixteen_bytes():
    ulid = generate_ulid_bytes()
    assert isinstance(ulid, bytes)
    assert len(ulid) == 16
    # First 6 bytes are a big-endian millisecond timestamp in a sane range.
    timestamp = int.from_bytes(ulid[:6], byteorder="big")
    assert timestamp > 1_000_000_000_000


# --------------------------------------------------------------------------- #
# issue_tokens
# --------------------------------------------------------------------------- #


def test_issue_tokens_with_device_name_and_rotation():
    svc = AuthService(
        FakeConn(
            [
                c(fetchone=None),  # _resolve_device: create new device
                c(),  # transaction
            ]
        )
    )
    access, refresh = svc.issue_tokens(
        user_id=USER_ID,
        device_id_str=DEVICE_ID_STR,
        user_agent="ua",
        rotated_from_id=b"rot",
        device_name="My Phone",
    )
    assert isinstance(access, str)
    assert isinstance(refresh, str)
    # The transaction cursor should store the device name.
    txn = svc.db.seen[-1]
    assert any("device_name" in q for q, _ in txn.queries)
    assert any("rotated_from_id" in q or "%s" in q for q, _ in txn.queries)


def test_issue_tokens_without_device_name():
    svc = AuthService(FakeConn([c(fetchone=None), c()]))
    access, refresh = svc.issue_tokens(
        user_id=USER_ID,
        device_id_str=DEVICE_ID_STR,
        user_agent="ua",
    )
    assert access and refresh
    txn = svc.db.seen[-1]
    # Without a device name, the second INSERT shape omits device_name.
    assert any("INSERT INTO user_devices" in q and "device_name" not in q for q, _ in txn.queries)


def test_issue_tokens_existing_device_without_user_agent():
    svc = AuthService(FakeConn([c(fetchone=(b"devid",)), c()]))
    svc.issue_tokens(user_id=USER_ID, device_id_str=DEVICE_ID_STR)
    resolve = svc.db.seen[0]
    # No user_agent -> the UPDATE branch is skipped.
    assert all("UPDATE devices" not in q for q, _ in resolve.queries)


def test_issue_tokens_existing_device_with_user_agent():
    svc = AuthService(FakeConn([c(fetchone=(b"devid",)), c()]))
    svc.issue_tokens(user_id=USER_ID, device_id_str=DEVICE_ID_STR, user_agent="ua")
    resolve = svc.db.seen[0]
    assert any("UPDATE devices" in q for q, _ in resolve.queries)


def test_issue_tokens_rolls_back_on_transaction_error():
    svc = AuthService(FakeConn([c(fetchone=None), c(execute_raises=RuntimeError("boom"))]))
    try:
        svc.issue_tokens(user_id=USER_ID, device_id_str=DEVICE_ID_STR)
        assert False, "expected RuntimeError"
    except RuntimeError:
        pass
    assert svc.db.rollback.called
    assert not svc.db.commit.called


# --------------------------------------------------------------------------- #
# _resolve_device
# --------------------------------------------------------------------------- #


def test_resolve_device_creates_new():
    svc = AuthService(FakeConn([c(fetchone=None)]))
    internal = svc._resolve_device(DEVICE_ID_STR, user_agent="ua")
    assert internal is not None
    assert any("INSERT INTO devices" in q for q, _ in svc.db.seen[0].queries)


def test_resolve_device_existing_updates_user_agent():
    svc = AuthService(FakeConn([c(fetchone=(b"devid",))]))
    internal = svc._resolve_device(DEVICE_ID_STR, user_agent="ua")
    assert internal == b"devid"
    assert any("UPDATE devices" in q for q, _ in svc.db.seen[0].queries)


def test_resolve_device_existing_without_user_agent():
    svc = AuthService(FakeConn([c(fetchone=(b"devid",))]))
    internal = svc._resolve_device(DEVICE_ID_STR)
    assert internal == b"devid"
    assert all("UPDATE devices" not in q for q, _ in svc.db.seen[0].queries)


# --------------------------------------------------------------------------- #
# login
# --------------------------------------------------------------------------- #


def test_login_invalid_username_raises():
    with patch_all() as m:
        svc = AuthService(FakeConn([c(fetchone=None)]))
        try:
            svc.login("nobody", "pw", DEVICE_ID_STR)
            assert False
        except ValueError as e:
            assert "Invalid username or password" in str(e)
        # Password verification must not even be attempted.
        assert not m["verify_password"].called


def test_login_invalid_password_raises():
    conn = FakeConn([c(fetchone=(USER_ID, "uname", "ph", "user"))])
    with patch_all() as m:
        m["verify_password"].return_value = False
        svc = AuthService(conn)
        try:
            svc.login("uname", "wrong", DEVICE_ID_STR)
            assert False
        except ValueError as e:
            assert "Invalid username or password" in str(e)


def test_login_success_without_mfa():
    conn = FakeConn(
        [
            c(fetchone_seq=[(USER_ID, "uname", "ph", "user"), None]),  # user, then no-MFA
            c(fetchone=None),  # issue_tokens _resolve_device
            c(),  # issue_tokens txn
        ]
    )
    with patch_all():
        svc = AuthService(conn)
        result = svc.login("uname", "pw", DEVICE_ID_STR)
    assert "access_token" in result
    assert result["user"]["global_role"] == "user"
    assert "mfa_required" not in result


def test_login_success_trusted_device_mfa():
    conn = FakeConn(
        [
            c(
                fetchone_seq=[
                    (USER_ID, "uname", "ph", "admin"),  # user
                    (1,),  # MFA enabled
                    (1, "Existing Name"),  # user_devices: trusted
                ]
            ),
            c(fetchone=None),  # _resolve_device during mfa check
            c(fetchone=None),  # issue_tokens _resolve_device
            c(),  # issue_tokens txn
        ]
    )
    with patch_all():
        svc = AuthService(conn)
        result = svc.login("uname", "pw", DEVICE_ID_STR, user_agent="ua", device_name="Phone")
    assert "access_token" in result
    assert result["user"]["global_role"] == "admin"


def test_login_mfa_required_untrusted_device():
    conn = FakeConn(
        [
            c(
                fetchone_seq=[
                    (USER_ID, "uname", "ph", "user"),
                    (1,),  # MFA enabled
                    (0, "MyPhone"),  # user_devices: not trusted
                ]
            ),
            c(fetchone=None),  # _resolve_device
        ]
    )
    with patch_all():
        svc = AuthService(conn)
        result = svc.login("uname", "pw", DEVICE_ID_STR)
    assert result["mfa_required"] is True
    assert result["device_name"] == "MyPhone"


def test_login_mfa_required_no_device_row():
    conn = FakeConn(
        [
            c(
                fetchone_seq=[
                    (USER_ID, "uname", "ph", "user"),
                    (1,),  # MFA enabled
                    None,  # user_devices: no row
                ]
            ),
            c(fetchone=None),  # _resolve_device
        ]
    )
    with patch_all():
        svc = AuthService(conn)
        result = svc.login("uname", "pw", DEVICE_ID_STR)
    assert result["mfa_required"] is True
    assert result["device_name"] is None


def test_login_success_and_trust_device():
    conn = FakeConn(
        [
            c(
                fetchone_seq=[
                    (USER_ID, "uname", "ph", "user"),
                    None,  # MFA disabled
                ]
            ),
            c(fetchone=None),  # issue_tokens _resolve_device
            c(),  # issue_tokens txn
            c(fetchone=None),  # set_device_trusted _resolve_device
            c(),  # set_device_trusted txn
        ]
    )
    with patch_all():
        svc = AuthService(conn)
        result = svc.login("uname", "pw", DEVICE_ID_STR, trust_device=True, device_name="Phone")
    assert "access_token" in result
    trust_txn = conn.seen[-1]
    assert any("UPDATE user_devices" in q and "device_name" in q for q, _ in trust_txn.queries)


def test_rotate_tokens_invalid_token():
    with patch_all():
        svc = AuthService(FakeConn([c(fetchone=None)]))
        try:
            svc.rotate_tokens("bogus", DEVICE_ID_STR)
            assert False
        except ValueError as e:
            assert "Invalid refresh token" in str(e)


def test_rotate_tokens_revoked_detected():
    now = datetime.now(timezone.utc)
    row = (b"tid", USER_ID, b"dev", now, now, "uname", "user")
    with patch_all():
        svc = AuthService(FakeConn([c(fetchone=row), c()]))
        try:
            svc.rotate_tokens("tok", DEVICE_ID_STR)
            assert False
        except ValueError as e:
            assert "revoked" in str(e)
    # Revoke-all path must have been executed.
    assert any(
        "UPDATE auth_refresh_tokens SET revoked_at" in q
        for cur in svc.db.seen
        for q, _ in cur.queries
    )


def test_rotate_tokens_expired():
    past = datetime(2020, 1, 1)
    row = (b"tid", USER_ID, b"dev", None, past, "uname", "user")
    with patch_all():
        svc = AuthService(FakeConn([c(fetchone=row)]))
        try:
            svc.rotate_tokens("tok", DEVICE_ID_STR)
            assert False
        except ValueError as e:
            assert "expired" in str(e)


def test_rotate_tokens_success():
    future = datetime.now() + timedelta(days=1)
    row = (b"tid", USER_ID, b"dev", None, future, "uname", "admin")
    conn = FakeConn([c(fetchone=row), c(fetchone=None), c()])
    with patch_all():
        svc = AuthService(conn)
        access, refresh, user = svc.rotate_tokens("tok", DEVICE_ID_STR)
    assert access and refresh
    assert user["global_role"] == "admin"
    # The old token is marked revoked in the same query block.
    assert any("UPDATE auth_refresh_tokens SET revoked_at" in q for q, _ in conn.seen[0].queries)


# --------------------------------------------------------------------------- #
# revoke helpers
# --------------------------------------------------------------------------- #


def test_revoke_session_executes():
    svc = AuthService(FakeConn([c()]))
    svc.revoke_session("tok")
    assert any("UPDATE auth_refresh_tokens SET revoked_at" in q for q, _ in svc.db.seen[0].queries)


def test_revoke_device_sessions_executes():
    svc = AuthService(FakeConn([c()]))
    svc.revoke_device_sessions(USER_ID, b"dev")
    assert any("UPDATE auth_refresh_tokens SET revoked_at" in q for q, _ in svc.db.seen[0].queries)


def test_revoke_all_user_sessions_executes():
    svc = AuthService(FakeConn([c()]))
    svc.revoke_all_user_sessions(USER_ID)
    assert any("UPDATE auth_refresh_tokens SET revoked_at" in q for q, _ in svc.db.seen[0].queries)


# --------------------------------------------------------------------------- #
# set_device_trusted
# --------------------------------------------------------------------------- #


def test_set_device_trusted_true_with_name():
    svc = AuthService(FakeConn([c(fetchone=None), c()]))
    svc.set_device_trusted(USER_ID, DEVICE_ID_STR, True, "Phone")
    txn = svc.db.seen[-1]
    assert any(
        "UPDATE user_devices SET trusted" in q and "device_name" in q for q, _ in txn.queries
    )
    # No session revocation when trusting.
    assert all("revoked_at" not in q for q, _ in txn.queries)


def test_set_device_trusted_false_revokes_sessions():
    svc = AuthService(FakeConn([c(fetchone=None), c()]))
    svc.set_device_trusted(USER_ID, DEVICE_ID_STR, False)
    txn = svc.db.seen[-1]
    assert any("UPDATE user_devices SET trusted" in q for q, _ in txn.queries)
    assert any("revoked_at" in q for q, _ in txn.queries)


def test_set_device_trusted_true_without_name():
    svc = AuthService(FakeConn([c(fetchone=None), c()]))
    svc.set_device_trusted(USER_ID, DEVICE_ID_STR, True)
    txn = svc.db.seen[-1]
    assert any(
        "UPDATE user_devices SET trusted" in q and "device_name" not in q for q, _ in txn.queries
    )


def test_set_device_trusted_rolls_back_on_error():
    svc = AuthService(FakeConn([c(fetchone=None), c(execute_raises=RuntimeError("boom"))]))
    try:
        svc.set_device_trusted(USER_ID, DEVICE_ID_STR, True)
        assert False
    except RuntimeError:
        pass
    assert svc.db.rollback.called


# --------------------------------------------------------------------------- #
# get_user_devices
# --------------------------------------------------------------------------- #


def test_get_user_devices_returns_recognized_list():
    last = datetime.now(timezone.utc)
    svc = AuthService(FakeConn([c(fetchall=[("dev1", "Phone", 1, last, "ua")])]))
    devices = svc.get_user_devices(USER_ID)
    assert len(devices) == 1
    d = devices[0]
    assert d["device_id"] == "dev1"
    assert d["trusted"] is True
    assert d["recognized"] is True
    assert d["user_agent"] == "ua"


# --------------------------------------------------------------------------- #
# verify_mfa
# --------------------------------------------------------------------------- #


MFA_PAYLOAD = {
    "type": "mfa_challenge",
    "sub": USER_ID_HEX,
    "device_id": DEVICE_ID_STR,
}


def test_verify_mfa_invalid_token_type():
    # A payload missing the "mfa_challenge" type raises inside the try block,
    # which the surrounding `except Exception` converts to "Invalid MFA token".
    with patch_all(jwt_decode=lambda *a, **k: {"sub": USER_ID_HEX, "device_id": DEVICE_ID_STR}):
        svc = AuthService(FakeConn([]))
        try:
            svc.verify_mfa("tok", "123456")
            assert False
        except ValueError as e:
            assert "Invalid MFA token" in str(e)


def test_verify_mfa_expired_signature():
    with patch_all(jwt_decode=jwt.ExpiredSignatureError):
        svc = AuthService(FakeConn([]))
        try:
            svc.verify_mfa("tok", "123456")
            assert False
        except ValueError as e:
            assert "expired" in str(e)


def test_verify_mfa_generic_decode_error():
    with patch_all(jwt_decode=ValueError("bad")):
        svc = AuthService(FakeConn([]))
        try:
            svc.verify_mfa("tok", "123456")
            assert False
        except ValueError as e:
            assert "Invalid MFA token" in str(e)


def test_verify_mfa_user_not_found():
    with patch_all(jwt_decode=lambda *a, **k: dict(MFA_PAYLOAD)):
        svc = AuthService(FakeConn([c(fetchone=None)]))
        try:
            svc.verify_mfa("tok", "123456")
            assert False
        except ValueError as e:
            assert "User not found" in str(e)


def test_verify_mfa_recovery_code_success():
    conn = FakeConn(
        [
            c(fetchone=("user", "admin")),  # SELECT users
            c(fetchall=[(b"hash1",)]),  # consume_recovery_code select
            c(),  # consume txn
            c(fetchone=None),  # issue_tokens resolve
            c(),  # issue_tokens txn
        ]
    )
    with patch_all(jwt_decode=lambda *a, **k: dict(MFA_PAYLOAD)):
        svc = AuthService(conn)
        access, refresh, user = svc.verify_mfa("tok", "ABCD-EFGH")
    assert access and refresh
    assert user["username"] == "user"


def test_verify_mfa_totp_success():
    conn = FakeConn(
        [
            c(fetchone_seq=[("user", "admin"), (b"secret",)]),  # users, then secret
            c(fetchone=None),  # issue_tokens resolve
            c(),  # issue_tokens txn
        ]
    )
    with patch_all(jwt_decode=lambda *a, **k: dict(MFA_PAYLOAD)):
        svc = AuthService(conn)
        access, refresh, user = svc.verify_mfa("tok", "123456")
    assert access and refresh
    assert user["id"] == USER_ID_HEX


def test_verify_mfa_invalid_totp_code():
    conn = FakeConn(
        [
            c(fetchone_seq=[("user", "admin"), (b"secret",)]),
        ]
    )
    with patch_all(jwt_decode=lambda *a, **k: dict(MFA_PAYLOAD)) as m:
        m["verify_totp_code"].return_value = False
        svc = AuthService(conn)
        try:
            svc.verify_mfa("tok", "123456")
            assert False
        except ValueError as e:
            assert "Invalid verification code" in str(e)


def test_verify_mfa_recovery_code_no_match():
    conn = FakeConn(
        [
            c(fetchone=("user", "admin")),
            c(fetchall=[(b"hash1",)]),
        ]
    )
    with patch_all(jwt_decode=lambda *a, **k: dict(MFA_PAYLOAD)) as m:
        m["verify_recovery_code"].return_value = False
        svc = AuthService(conn)
        try:
            svc.verify_mfa("tok", "ABCD-EFGH")
            assert False
        except ValueError as e:
            assert "Invalid verification code" in str(e)


def test_verify_mfa_totp_missing_secret():
    conn = FakeConn(
        [
            c(fetchone_seq=[("user", "admin"), None]),  # users, no secret row
        ]
    )
    with patch_all(jwt_decode=lambda *a, **k: dict(MFA_PAYLOAD)):
        svc = AuthService(conn)
        try:
            svc.verify_mfa("tok", "123456")
            assert False
        except ValueError as e:
            assert "Invalid verification code" in str(e)


def test_verify_mfa_trust_device():
    conn = FakeConn(
        [
            c(fetchone=("user", "admin")),
            c(fetchall=[(b"hash1",)]),
            c(),  # consume txn
            c(fetchone=None),  # issue_tokens resolve
            c(),  # issue_tokens txn
            c(fetchone=None),  # set_device_trusted resolve
            c(),  # set_device_trusted txn
        ]
    )
    with patch_all(jwt_decode=lambda *a, **k: dict(MFA_PAYLOAD)):
        svc = AuthService(conn)
        svc.verify_mfa("tok", "ABCD-EFGH", trust_device=True, device_name="Phone")
    trust_txn = conn.seen[-1]
    assert any("UPDATE user_devices SET trusted" in q for q, _ in trust_txn.queries)


# --------------------------------------------------------------------------- #
# consume_recovery_code
# --------------------------------------------------------------------------- #


def test_consume_recovery_code_matches():
    with patch_all():
        svc = AuthService(FakeConn([c(fetchall=[(b"hash1",)]), c()]))
        assert svc.consume_recovery_code(USER_ID, "ABCD-EFGH") is True


def test_consume_recovery_code_no_match():
    with patch_all() as m:
        m["verify_recovery_code"].return_value = False
        svc = AuthService(FakeConn([c(fetchall=[(b"hash1",)])]))
        assert svc.consume_recovery_code(USER_ID, "ABCD-EFGH") is False


def test_consume_recovery_code_skip_invalid_hash():
    with patch_all() as m:
        m["verify_recovery_code"].side_effect = [Exception("bad"), True]
        svc = AuthService(FakeConn([c(fetchall=[(b"h1",), (b"h2",)]), c()]))
        assert svc.consume_recovery_code(USER_ID, "ABCD-EFGH") is True


def test_consume_recovery_code_rolls_back_on_error():
    # The SELECT and the consuming transaction share the same cursor, so the
    # raising execute must be the 2nd call on that single cursor.
    with patch_all():
        svc = AuthService(
            FakeConn([c(fetchall=[(b"hash1",)], execute_raises=[None, RuntimeError("boom")])])
        )
        assert svc.consume_recovery_code(USER_ID, "ABCD-EFGH") is False
    assert svc.db.rollback.called


def test_regenerate_invalid_password_no_user():
    with patch_all():
        svc = AuthService(FakeConn([c(fetchone=None)]))
        try:
            svc.regenerate_recovery_codes(USER_ID, "pw")
            assert False
        except ValueError as e:
            assert "Invalid password" in str(e)


def test_regenerate_invalid_password_mismatch():
    with patch_all() as m:
        m["verify_password"].return_value = False
        svc = AuthService(FakeConn([c(fetchone=(b"ph",))]))
        try:
            svc.regenerate_recovery_codes(USER_ID, "pw")
            assert False
        except ValueError as e:
            assert "Invalid password" in str(e)


def test_regenerate_rate_limited():
    now = datetime.now(timezone.utc)
    recent = (now - timedelta(hours=1)).replace(tzinfo=None)
    with patch_all():
        svc = AuthService(FakeConn([c(fetchone_seq=[(b"ph",), (recent,)])]))
        try:
            svc.regenerate_recovery_codes(USER_ID, "pw")
            assert False
        except ValueError as e:
            assert "24 hours" in str(e)


def test_regenerate_success_no_prior_codes():
    with patch_all():
        svc = AuthService(FakeConn([c(fetchone_seq=[(b"ph",), (None,)]), c()]))
        codes = svc.regenerate_recovery_codes(USER_ID, "pw")
    assert len(codes) == 10


def test_regenerate_success_old_codes_aware():
    now = datetime.now(timezone.utc)
    old = (now - timedelta(hours=48)).replace(tzinfo=timezone.utc)
    with patch_all():
        svc = AuthService(FakeConn([c(fetchone_seq=[(b"ph",), (old,)]), c()]))
        codes = svc.regenerate_recovery_codes(USER_ID, "pw")
    assert len(codes) == 10


def test_regenerate_rolls_back_on_error():
    with patch_all():
        svc = AuthService(
            FakeConn(
                [
                    c(
                        fetchone_seq=[(b"ph",), (None,)],
                        execute_raises=[None, None, RuntimeError("boom")],
                    ),
                ]
            )
        )
        try:
            svc.regenerate_recovery_codes(USER_ID, "pw")
            assert False
        except RuntimeError:
            pass
        assert svc.db.rollback.called


def test_generate_mfa_setup_already_enrolled():
    with patch_all():
        svc = AuthService(FakeConn([c(fetchone=(1,))]))
        try:
            svc.generate_mfa_setup(USER_ID)
            assert False
        except ValueError as e:
            assert "already enrolled" in str(e)


def test_generate_mfa_setup_returns_secret():
    with patch_all():
        svc = AuthService(FakeConn([c(fetchone=None)]))
        secret = svc.generate_mfa_setup(USER_ID)
    assert isinstance(secret, str) and len(secret) > 0


# --------------------------------------------------------------------------- #
# enroll_mfa
# --------------------------------------------------------------------------- #


def test_enroll_mfa_already_enrolled():
    with patch_all():
        svc = AuthService(FakeConn([c(fetchone=(1,))]))
        try:
            svc.enroll_mfa(USER_ID, "secret", "123456", DEVICE_ID_STR)
            assert False
        except ValueError as e:
            assert "already enrolled" in str(e)


def test_enroll_mfa_invalid_totp():
    with patch_all() as m:
        m["verify_totp_code"].return_value = False
        svc = AuthService(FakeConn([c(fetchone=None)]))
        try:
            svc.enroll_mfa(USER_ID, "secret", "123456", DEVICE_ID_STR)
            assert False
        except ValueError as e:
            assert "Invalid TOTP" in str(e)


def test_enroll_mfa_success():
    conn = FakeConn([c(fetchone=None), c(fetchone=None), c()])
    with patch_all():
        svc = AuthService(conn)
        access, refresh, codes = svc.enroll_mfa(
            USER_ID, "secret", "123456", DEVICE_ID_STR, user_agent="ua"
        )
    assert access and refresh
    assert len(codes) == 10


def test_enroll_mfa_rolls_back_on_error():
    with patch_all():
        svc = AuthService(FakeConn([c(fetchone=None, execute_raises=[None, RuntimeError("boom")])]))
        try:
            svc.enroll_mfa(USER_ID, "secret", "123456", DEVICE_ID_STR)
            assert False
        except RuntimeError:
            pass
        assert svc.db.rollback.called


def test_complete_invite_invalid_token():
    with patch_all():
        svc = AuthService(FakeConn([c(fetchone=None)]))
        try:
            svc.complete_invite("tok", "pw", "secret", "123456", DEVICE_ID_STR)
            assert False
        except ValueError as e:
            assert "Invalid or expired invite token" in str(e)


def test_complete_invite_already_activated():
    now = datetime.now(timezone.utc)
    future = now + timedelta(days=1)
    with patch_all():
        svc = AuthService(FakeConn([c(fetchone=(USER_ID, future, now))]))
        try:
            svc.complete_invite("tok", "pw", "secret", "123456", DEVICE_ID_STR)
            assert False
        except ValueError as e:
            assert "already been activated" in str(e)


def test_complete_invite_expired():
    past = datetime(2020, 1, 1)
    with patch_all():
        svc = AuthService(FakeConn([c(fetchone=(USER_ID, past, None))]))
        try:
            svc.complete_invite("tok", "pw", "secret", "123456", DEVICE_ID_STR)
            assert False
        except ValueError as e:
            assert "expired" in str(e)


def test_complete_invite_invalid_totp():
    future = datetime.now() + timedelta(days=1)
    with patch_all() as m:
        m["verify_totp_code"].return_value = False
        svc = AuthService(FakeConn([c(fetchone=(USER_ID, future, None))]))
        try:
            svc.complete_invite("tok", "pw", "secret", "123456", DEVICE_ID_STR)
            assert False
        except ValueError as e:
            assert "Invalid TOTP" in str(e)


def test_complete_invite_success():
    future = datetime.now() + timedelta(days=1)
    conn = FakeConn([c(fetchone=(USER_ID, future, None)), c(fetchone=None), c()])
    with patch_all():
        svc = AuthService(conn)
        access, refresh, codes = svc.complete_invite(
            "tok", "pw", "secret", "123456", DEVICE_ID_STR, user_agent="ua"
        )
    assert access and refresh
    assert len(codes) == 10


def test_complete_invite_success_trust_device():
    future = datetime.now() + timedelta(days=1)
    conn = FakeConn(
        [
            c(fetchone=(USER_ID, future, None)),
            c(fetchone=None),  # issue_tokens resolve
            c(),  # issue_tokens txn
            c(fetchone=None),  # trust resolve
            c(),  # trust txn
        ]
    )
    with patch_all():
        svc = AuthService(conn)
        svc.complete_invite(
            "tok",
            "pw",
            "secret",
            "123456",
            DEVICE_ID_STR,
            trust_device=True,
            device_name="Phone",
        )
    assert any("UPDATE user_devices SET trusted" in q for cur in conn.seen for q, _ in cur.queries)


def test_complete_invite_rolls_back_on_error():
    future = datetime.now() + timedelta(days=1)
    with patch_all():
        svc = AuthService(
            FakeConn(
                [c(fetchone=(USER_ID, future, None), execute_raises=[None, RuntimeError("boom")])]
            )
        )
        try:
            svc.complete_invite("tok", "pw", "secret", "123456", DEVICE_ID_STR)
            assert False
        except RuntimeError:
            pass
        assert svc.db.rollback.called
