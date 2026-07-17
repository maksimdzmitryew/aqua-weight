from __future__ import annotations

from contextlib import contextmanager

import pytest
from cryptography.fernet import Fernet

from backend.app.helpers import credential_manager as cm


class FakeCursor:
    def __init__(self, *, fetchone=None):
        self.fetchone_return = fetchone
        self.executed: list[tuple[str, tuple | None]] = []
        self.closed = False

    def execute(self, query, params=None):
        self.executed.append((query, tuple(params) if params is not None else None))
        return 1

    def fetchone(self):
        return self.fetchone_return

    def close(self):
        self.closed = True


# Queue of pre-configured cursors. Tests append in the order the production
# code opens them (one per `with cursor(conn)` block).
_CURSORS: list[FakeCursor] = []


@contextmanager
def _fake_cursor(conn):
    cur = _CURSORS.pop(0) if _CURSORS else FakeCursor()
    try:
        yield cur
    finally:
        cur.close()


@pytest.fixture(autouse=True)
def _patch_cursor(monkeypatch: pytest.MonkeyPatch):
    _CURSORS.clear()
    monkeypatch.setattr(cm, "cursor", _fake_cursor)
    yield


def test_generate_bin16_id_returns_16_bytes() -> None:
    _id = cm._generate_bin16_id()
    assert isinstance(_id, bytes)
    assert len(_id) == 16


def test_normalize_fernet_key_from_str() -> None:
    key = Fernet.generate_key().decode()
    assert cm._normalize_fernet_key(key) == key.encode("utf-8")


def test_normalize_fernet_key_from_bytes() -> None:
    key = Fernet.generate_key()
    assert cm._normalize_fernet_key(key) == key


def test_get_or_create_encryption_key_uses_env(monkeypatch: pytest.MonkeyPatch) -> None:
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("CREDENTIALS_ENCRYPTION_KEY", key)
    result = cm.get_or_create_encryption_key(conn=object())
    assert result == key.encode("utf-8")


def test_get_or_create_encryption_key_uses_stored_row(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CREDENTIALS_ENCRYPTION_KEY", raising=False)
    stored = Fernet.generate_key().decode()
    cur = FakeCursor(fetchone=(stored,))
    _CURSORS.append(cur)

    result = cm.get_or_create_encryption_key(conn=object())

    assert result == stored.encode("utf-8")
    assert any("CREATE TABLE IF NOT EXISTS encryption_keys" in q for q, _ in cur.executed)
    assert any("SELECT encrypted_key" in q for q, _ in cur.executed)


def test_get_or_create_encryption_key_generates_new_when_no_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CREDENTIALS_ENCRYPTION_KEY", raising=False)
    cur = FakeCursor(fetchone=None)
    _CURSORS.append(cur)

    result = cm.get_or_create_encryption_key(conn=object())

    assert isinstance(result, bytes)
    # Result is a valid Fernet key.
    Fernet(result)
    assert any("INSERT INTO encryption_keys" in q for q, _ in cur.executed)


def test_encrypt_with_fernet_round_trips(monkeypatch: pytest.MonkeyPatch) -> None:
    key = Fernet.generate_key()
    monkeypatch.setenv("CREDENTIALS_ENCRYPTION_KEY", key.decode())
    token = cm._encrypt_with_fernet(key, "hello")
    assert cm._decrypt_with_fernet(key, token) == "hello"


def test_encrypt_with_fernet_empty_plaintext(monkeypatch: pytest.MonkeyPatch) -> None:
    key = Fernet.generate_key()
    monkeypatch.setenv("CREDENTIALS_ENCRYPTION_KEY", key.decode())
    token = cm._encrypt_with_fernet(key, None)
    assert cm._decrypt_with_fernet(key, token) == ""


def test_decrypt_with_fernet_empty_token() -> None:
    key = Fernet.generate_key()
    assert cm._decrypt_with_fernet(key, "") == ""
    assert cm._decrypt_with_fernet(key, None) == ""


def test_decrypt_with_fernet_invalid_token(monkeypatch: pytest.MonkeyPatch) -> None:
    key = Fernet.generate_key()
    monkeypatch.setenv("CREDENTIALS_ENCRYPTION_KEY", key.decode())
    other = Fernet.generate_key()
    bad_token = Fernet(other).encrypt(b"x").decode()
    assert cm._decrypt_with_fernet(key, bad_token) == ""


def test_ensure_whatsapp_credentials_table_creates_table() -> None:
    cur = FakeCursor()
    _CURSORS.append(cur)

    cm.ensure_whatsapp_credentials_table(conn=object())

    assert any("CREATE TABLE IF NOT EXISTS whatsapp_credentials" in q for q, _ in cur.executed)
    assert cur.closed is True


def test_get_whatsapp_credentials_conn_none_returns_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WHATSAPP_API_URL", "https://u")
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "tok")
    monkeypatch.setenv("WHATSAPP_TEMPLATE_NAME", "tpl")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "pid")

    assert cm.get_whatsapp_credentials(conn=None) == {
        "api_url": "https://u",
        "api_token": "tok",
        "template_name": "tpl",
        "phone_number_id": "pid",
    }


def test_get_whatsapp_credentials_no_row_returns_env_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for var in (
        "WHATSAPP_API_URL",
        "WHATSAPP_API_TOKEN",
        "WHATSAPP_TEMPLATE_NAME",
        "WHATSAPP_PHONE_NUMBER_ID",
    ):
        monkeypatch.delenv(var, raising=False)
    _CURSORS.extend([FakeCursor(), FakeCursor(fetchone=None)])

    assert cm.get_whatsapp_credentials(conn=object()) == {
        "api_url": "",
        "api_token": "",
        "template_name": "",
        "phone_number_id": "",
    }


def test_get_whatsapp_credentials_decrypts_encrypted_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key = Fernet.generate_key()
    monkeypatch.setenv("CREDENTIALS_ENCRYPTION_KEY", key.decode())
    f = Fernet(key)
    row = (
        None,
        None,
        None,
        None,
        f.encrypt(b"https://api").decode(),
        f.encrypt(b"tok").decode(),
        f.encrypt(b"tpl").decode(),
        f.encrypt(b"pid").decode(),
    )
    _CURSORS.extend([FakeCursor(), FakeCursor(fetchone=row)])

    assert cm.get_whatsapp_credentials(conn=object()) == {
        "api_url": "https://api",
        "api_token": "tok",
        "template_name": "tpl",
        "phone_number_id": "pid",
    }


def test_get_whatsapp_credentials_legacy_plaintext_row() -> None:
    # Mix of set and None values to exercise the `or ""` branches.
    row = ("urlA", None, "tplA", None, None, None, None, None)
    _CURSORS.extend([FakeCursor(), FakeCursor(fetchone=row)])

    assert cm.get_whatsapp_credentials(conn=object()) == {
        "api_url": "urlA",
        "api_token": "",
        "template_name": "tplA",
        "phone_number_id": "",
    }


def test_save_whatsapp_credentials_encrypts_and_inserts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key = Fernet.generate_key()
    monkeypatch.setenv("CREDENTIALS_ENCRYPTION_KEY", key.decode())
    ensure_cur = FakeCursor()
    insert_cur = FakeCursor()
    _CURSORS.extend([ensure_cur, insert_cur])

    assert cm.save_whatsapp_credentials(conn=object(), api_url="u", api_token="t",
                                        template_name="tpl", phone_number_id="pid") is True

    assert any("CREATE TABLE IF NOT EXISTS whatsapp_credentials" in q for q, _ in ensure_cur.executed)
    inserts = [p for q, p in insert_cur.executed if "INSERT INTO whatsapp_credentials" in q]
    assert inserts
    enc = inserts[0][5:9]
    f = Fernet(key)
    assert f.decrypt(enc[0].encode()).decode() == "u"
    assert f.decrypt(enc[1].encode()).decode() == "t"
    assert f.decrypt(enc[2].encode()).decode() == "tpl"
    assert f.decrypt(enc[3].encode()).decode() == "pid"


def test_migrate_old_credentials_is_noop() -> None:
    assert cm.migrate_old_credentials(conn=object()) is False


def test_initialize_when_existing_credentials_present() -> None:
    count_cur = FakeCursor(fetchone=(5,))
    _CURSORS.extend([FakeCursor(), count_cur])

    assert cm.initialize_whatsapp_credentials_if_needed(conn=object()) is False
    assert any("SELECT COUNT(*)" in q for q, _ in count_cur.executed)


def test_initialize_when_empty_and_token_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WHATSAPP_API_URL", "https://u")
    monkeypatch.delenv("WHATSAPP_API_TOKEN", raising=False)
    monkeypatch.delenv("WHATSAPP_TEMPLATE_NAME", raising=False)
    monkeypatch.delenv("WHATSAPP_PHONE_NUMBER_ID", raising=False)
    _CURSORS.extend([FakeCursor(), FakeCursor(fetchone=None)])

    assert cm.initialize_whatsapp_credentials_if_needed(conn=object()) is False


def test_initialize_when_empty_and_url_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("WHATSAPP_API_URL", raising=False)
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "tok")
    _CURSORS.extend([FakeCursor(), FakeCursor(fetchone=None)])

    assert cm.initialize_whatsapp_credentials_if_needed(conn=object()) is False


def test_initialize_when_empty_and_credentials_present_saves(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key = Fernet.generate_key()
    monkeypatch.setenv("CREDENTIALS_ENCRYPTION_KEY", key.decode())
    monkeypatch.setenv("WHATSAPP_API_URL", "https://u")
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "tok")
    monkeypatch.setenv("WHATSAPP_TEMPLATE_NAME", "tpl")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "pid")
    ensure_init = FakeCursor()
    count_cur = FakeCursor(fetchone=(0,))
    ensure_save = FakeCursor()
    insert_save = FakeCursor()
    _CURSORS.extend([ensure_init, count_cur, ensure_save, insert_save])

    assert cm.initialize_whatsapp_credentials_if_needed(conn=object()) is True
    assert any("INSERT INTO whatsapp_credentials" in q for q, _ in insert_save.executed)


def test_backup_credentials_returns_env_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WHATSAPP_API_URL", "https://u")
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "tok")
    monkeypatch.setenv("WHATSAPP_TEMPLATE_NAME", "tpl")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "pid")

    assert cm.backup_credentials(conn=None) == {
        "api_url": "https://u",
        "api_token": "tok",
        "template_name": "tpl",
        "phone_number_id": "pid",
    }
