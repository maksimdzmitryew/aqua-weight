from __future__ import annotations

from contextlib import contextmanager

import pytest
from cryptography.fernet import Fernet

from backend.app.helpers import credential_manager as cm


class FakeCursor:
    def __init__(self, *, fetchone=None, fetchall=None):
        self.fetchone_return = fetchone
        self.fetchall_return = fetchall if fetchall is not None else []
        self.executed: list[tuple[str, tuple | None]] = []
        self.closed = False

    def execute(self, query, params=None):
        self.executed.append((query, tuple(params) if params is not None else None))
        return 1

    def fetchone(self):
        return self.fetchone_return

    def fetchall(self):
        return self.fetchall_return

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
    # New schema: api_url (plaintext), template_name (plaintext), api_token_enc, phone_number_id_enc
    row = (
        "https://api",                              # api_url (plaintext)
        "tpl",                                      # template_name (plaintext)
        f.encrypt(b"tok").decode(),               # api_token_enc
        f.encrypt(b"pid").decode(),               # phone_number_id_enc
    )
    _CURSORS.extend([FakeCursor(), FakeCursor(fetchone=row)])

    assert cm.get_whatsapp_credentials(conn=object()) == {
        "api_url": "https://api",
        "api_token": "tok",
        "template_name": "tpl",
        "phone_number_id": "pid",
    }


def test_get_whatsapp_credentials_plain_text_row() -> None:
    """Test that plaintext api_url and template_name are returned as-is."""
    # Mix of set and None values to exercise the `or ""` branches.
    # New schema: api_url (plaintext), template_name (plaintext), api_token_enc, phone_number_id_enc
    row = ("urlA", "tplA", None, None)
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
    # New schema: api_url (plaintext), template_name (plaintext), api_token_enc, phone_number_id_enc
    # inserted as positional placeholders: (id, api_url, template_name, api_token_enc, phone_number_id_enc)
    inserted_values = inserts[0]
    assert len(inserted_values) == 5, f"Expected 5 values, got {len(inserted_values)}: {inserted_values}"
    f = Fernet(key)
    # Plaintext values (non-sensitive, should remain as-is)
    assert inserted_values[1] == "u"      # api_url (plaintext)
    assert inserted_values[2] == "tpl"    # template_name (plaintext)
    # Encrypted values (sensitive, encrypted)
    assert f.decrypt(inserted_values[3].encode()).decode() == "t"      # api_token_enc
    assert f.decrypt(inserted_values[4].encode()).decode() == "pid"    # phone_number_id_enc


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


def test_get_or_create_encryption_key_invalid_env_key_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test that invalid CREDENTIALS_ENCRYPTION_KEY raises an error (no fallback to DB)."""
    monkeypatch.setenv("CREDENTIALS_ENCRYPTION_KEY", "invalid-key-not-valid-fernet")
    cur = FakeCursor(fetchone=None)
    _CURSORS.append(cur)

    with pytest.raises(ValueError, match="Fernet key must be 32 url-safe base64-encoded bytes"):
        cm.get_or_create_encryption_key(conn=object())

    # No database interaction should occur since the exception is raised first
    assert not any("CREATE TABLE IF NOT EXISTS encryption_keys" in q for q, _ in cur.executed)
    assert not any("INSERT INTO encryption_keys" in q for q, _ in cur.executed)


def test_ensure_whatsapp_credentials_table_missing_columns_drops_and_recreates() -> None:
    """Test that table with missing required columns is dropped and recreated."""
    # DESCRIBE succeeds but missing required columns (new schema needs api_token_enc and phone_number_id_enc)
    existing_columns = ["id", "api_url", "template_name"]
    cur = FakeCursor(fetchall=[(col,) for col in existing_columns])
    _CURSORS.append(cur)

    cm.ensure_whatsapp_credentials_table(conn=object())

    # Should have executed DESCRIBE and DROP TABLE
    queries = [q for q, _ in cur.executed]
    assert any("DESCRIBE whatsapp_credentials" in q for q in queries)
    assert any("DROP TABLE IF EXISTS whatsapp_credentials" in q for q in queries)
    assert any("CREATE TABLE IF NOT EXISTS whatsapp_credentials" in q for q in queries)


def test_ensure_whatsapp_credentials_table_describe_fails_with_other_error() -> None:
    """Test that non-table-not-exist errors in DESCRIBE are handled gracefully."""

    class FailingCursor(FakeCursor):
        def execute(self, query, params=None):
            if "DESCRIBE" in query:
                raise Exception("Some other database error")
            return super().execute(query, params)

    cur = FailingCursor()
    _CURSORS.append(cur)

    # Should not raise, should continue to CREATE TABLE
    cm.ensure_whatsapp_credentials_table(conn=object())

    assert any("CREATE TABLE IF NOT EXISTS whatsapp_credentials" in q for q, _ in cur.executed)


def test_ensure_whatsapp_credentials_table_describe_fails_with_table_not_exist() -> None:
    """Test that 'doesn't exist' error in DESCRIBE skips warning and creates table."""

    class FailingCursor(FakeCursor):
        def execute(self, query, params=None):
            if "DESCRIBE" in query:
                raise Exception("Table 'whatsapp_credentials' doesn't exist")
            return super().execute(query, params)

    cur = FailingCursor()
    _CURSORS.append(cur)

    # Should not raise, should continue to CREATE TABLE without warning
    cm.ensure_whatsapp_credentials_table(conn=object())

    assert any("CREATE TABLE IF NOT EXISTS whatsapp_credentials" in q for q, _ in cur.executed)


def test_ensure_whatsapp_credentials_table_with_all_columns_no_drop() -> None:
    """Test that table with all required columns does not get dropped and recreated."""
    # All required columns present (new schema)
    existing_columns = [
        "id", "api_url", "template_name", "api_token_enc", "phone_number_id_enc"
    ]
    cur = FakeCursor(fetchall=[(col,) for col in existing_columns])
    _CURSORS.append(cur)

    cm.ensure_whatsapp_credentials_table(conn=object())

    queries = [q for q, _ in cur.executed]
    assert any("DESCRIBE whatsapp_credentials" in q for q in queries)
    # Should NOT have executed DROP TABLE
    assert not any("DROP TABLE IF EXISTS whatsapp_credentials" in q for q in queries)
    # Should still have CREATE TABLE (for idempotency)
    assert any("CREATE TABLE IF NOT EXISTS whatsapp_credentials" in q for q in queries)


def test_get_whatsapp_credentials_corrupted_schema_recovers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test that corrupted schema (Unknown column) is recovered by dropping and recreating."""
    monkeypatch.delenv("WHATSAPP_API_URL", raising=False)
    monkeypatch.delenv("WHATSAPP_API_TOKEN", raising=False)
    monkeypatch.delenv("WHATSAPP_TEMPLATE_NAME", raising=False)
    monkeypatch.delenv("WHATSAPP_PHONE_NUMBER_ID", raising=False)

    # First cursor: ensure_whatsapp_credentials_table (CREATE TABLE) at line 188
    ensure_cur = FakeCursor()

    # Second cursor: SELECT that fails with "Unknown column", then DROP (recovery), then retry SELECT
    class RecoveryCursor(FakeCursor):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._select_count = 0

        def execute(self, query, params=None):
            # First SELECT should fail
            if "SELECT" in query and "whatsapp_credentials" in query:
                self._select_count += 1
                if self._select_count == 1:
                    raise Exception("Unknown column 'api_url_enc' in 'field list'")
                # After recovery, SELECT should return None
                self.fetchone_return = None
            return super().execute(query, params)

    select_cur = RecoveryCursor()

    # Third cursor: ensure_whatsapp_credentials_table (CREATE TABLE) at line 208
    create_cur = FakeCursor()

    _CURSORS.extend([ensure_cur, select_cur, create_cur])

    result = cm.get_whatsapp_credentials(conn=object())

    # Should return env fallback since no row after recovery
    assert result == {"api_url": "", "api_token": "", "template_name": "", "phone_number_id": ""}


def test_get_whatsapp_credentials_corrupted_schema_recovers_with_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test that corrupted schema recovery works when row exists after retry."""
    key = Fernet.generate_key()
    monkeypatch.setenv("CREDENTIALS_ENCRYPTION_KEY", key.decode())
    f = Fernet(key)

    # First cursor: ensure_whatsapp_credentials_table (CREATE TABLE) at line 188
    ensure_cur = FakeCursor()

    # Second cursor: SELECT that fails with "Unknown column", then DROP (recovery), then retry SELECT
    class RecoveryCursor(FakeCursor):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._select_count = 0

        def execute(self, query, params=None):
            # First SELECT should fail, second should return row
            if "SELECT" in query and "whatsapp_credentials" in query:
                self._select_count += 1
                if self._select_count == 1:
                    raise Exception("Unknown column 'api_url_enc' in 'field list'")
                # After recovery, SELECT should return row with new schema
                # New schema: api_url (plaintext), template_name (plaintext), api_token_enc, phone_number_id_enc
                row = (
                    "https://api",                              # api_url (plaintext)
                    "tpl",                                      # template_name (plaintext)
                    f.encrypt(b"tok").decode(),               # api_token_enc
                    f.encrypt(b"pid").decode(),               # phone_number_id_enc
                )
                self.fetchone_return = row
            return super().execute(query, params)

    select_cur = RecoveryCursor()

    # Third cursor: ensure_whatsapp_credentials_table (CREATE TABLE) at line 208
    create_cur = FakeCursor()

    _CURSORS.extend([ensure_cur, select_cur, create_cur])

    result = cm.get_whatsapp_credentials(conn=object())

    assert result == {
        "api_url": "https://api",
        "api_token": "tok",
        "template_name": "tpl",
        "phone_number_id": "pid",
    }


def test_get_whatsapp_credentials_select_fails_with_other_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test that SELECT failure with non-recoverable error is re-raised."""
    import re

    # First cursor: ensure_whatsapp_credentials_table (CREATE TABLE)
    ensure_cur = FakeCursor()

    # Second cursor: SELECT that fails with unexpected error
    class FailingSelectCursor(FakeCursor):
        def execute(self, query, params=None):
            if "SELECT" in query:
                raise Exception("Some unexpected database error")
            return super().execute(query, params)

    select_cur = FailingSelectCursor()

    _CURSORS.extend([ensure_cur, select_cur])

    # Should re-raise the exception
    with pytest.raises(Exception, match=re.escape("Some unexpected database error")):
        cm.get_whatsapp_credentials(conn=object())


def test_get_whatsapp_credentials_recovery_fails_returns_env_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test that when recovery fails, env fallback is returned."""
    monkeypatch.delenv("WHATSAPP_API_URL", raising=False)
    monkeypatch.delenv("WHATSAPP_API_TOKEN", raising=False)
    monkeypatch.delenv("WHATSAPP_TEMPLATE_NAME", raising=False)
    monkeypatch.delenv("WHATSAPP_PHONE_NUMBER_ID", raising=False)

    # First cursor: ensure_whatsapp_credentials_table (CREATE TABLE) at line 188
    ensure_cur = FakeCursor()

    # Second cursor: SELECT that fails with "Unknown column", then DROP fails, then retry fails
    class FailingRecoveryCursor(FakeCursor):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._select_count = 0

        def execute(self, query, params=None):
            # First SELECT should fail
            if "SELECT" in query and "whatsapp_credentials" in query:
                self._select_count += 1
                if self._select_count == 1:
                    raise Exception("Unknown column 'api_url_enc' in 'field list'")
                # Retry SELECT fails after recovery
                raise Exception("Retry failed")
            if "DROP TABLE" in query:
                raise Exception("DROP failed")
            return super().execute(query, params)

    select_cur = FailingRecoveryCursor()

    # Third cursor: ensure_whatsapp_credentials_table (CREATE TABLE) at line 208
    create_cur = FakeCursor()

    _CURSORS.extend([ensure_cur, select_cur, create_cur])

    result = cm.get_whatsapp_credentials(conn=object())

    # Should return env fallback since recovery failed
    assert result == {"api_url": "", "api_token": "", "template_name": "", "phone_number_id": ""}
