import pytest


from backend.app.services.settings_service import SettingsService


class FakeCursor:
    def __init__(self, *, fetchone_result=None, fetchall_result=None):
        self._fetchone_result = fetchone_result
        self._fetchall_result = fetchall_result or []
        self.queries: list[tuple[str, tuple | None]] = []
        self.closed = False

    def execute(self, query, params=None):
        self.queries.append((query, tuple(params) if params is not None else None))
        return 1

    def fetchone(self):
        return self._fetchone_result

    def fetchall(self):
        return list(self._fetchall_result)

    def close(self):
        self.closed = True


class FakeConnection:
    def __init__(self, cursors: list[FakeCursor]):
        self._cursors = list(cursors)
        self.seen: list[FakeCursor] = []

    def cursor(self):
        if not self._cursors:
            cur = FakeCursor()
        else:
            cur = self._cursors.pop(0)
        self.seen.append(cur)
        return cur


def test_parse_settings_json_accepts_dict() -> None:
    svc = SettingsService(FakeConnection([]))
    assert svc._parse_settings_json({"theme": "dark"}) == {"theme": "dark"}


def test_parse_settings_json_decodes_valid_string() -> None:
    svc = SettingsService(FakeConnection([]))
    assert svc._parse_settings_json('{"theme": "dark"}') == {"theme": "dark"}


def test_parse_settings_json_invalid_string_returns_empty() -> None:
    svc = SettingsService(FakeConnection([]))
    assert svc._parse_settings_json("{not-json") == {}


def test_parse_settings_json_unknown_type_returns_empty() -> None:
    svc = SettingsService(FakeConnection([]))
    assert svc._parse_settings_json(123) == {}


def test_get_settings_returns_default_when_row_missing() -> None:
    ensure_cur = FakeCursor()
    select_cur = FakeCursor(fetchone_result=None)
    conn = FakeConnection([ensure_cur, select_cur])

    svc = SettingsService(conn)
    settings, version = svc.get_settings(user_id=b"ignored")

    assert settings == {}
    assert version == 1


def test_get_settings_parses_json_and_returns_version() -> None:
    ensure_cur = FakeCursor()
    select_cur = FakeCursor(fetchone_result=('{"theme": "dark"}', 2))
    conn = FakeConnection([ensure_cur, select_cur])

    svc = SettingsService(conn)
    settings, version = svc.get_settings(user_id=b"ignored")

    assert settings == {"theme": "dark"}
    assert version == 2


def test_validate_settings_ignores_unknown_keys() -> None:
    svc = SettingsService(FakeConnection([]))
    svc.validate_settings({"unknown_key": 123})


def test_validate_settings_raises_on_type_mismatch_for_allowlisted_key() -> None:
    svc = SettingsService(FakeConnection([]))
    with pytest.raises(ValueError, match=r"Setting 'theme' must be of type str"):
        svc.validate_settings({"theme": 123})


def test_update_settings_executes_versioned_update() -> None:
    ensure_cur = FakeCursor()
    update_cur = FakeCursor()
    conn = FakeConnection([ensure_cur, update_cur])
    svc = SettingsService(conn)

    assert svc.update_settings(user_id=b"ignored", settings={"theme": "dark"}, version=3) is True

    # Second cursor corresponds to the UPDATE.
    query, params = conn.seen[1].queries[-1]
    assert "settings_schema_version" in query
    assert params is not None
    assert params[-1] == 1  # SYSTEM_SETTINGS_ID


def test_update_settings_executes_unversioned_update() -> None:
    ensure_cur = FakeCursor()
    update_cur = FakeCursor()
    conn = FakeConnection([ensure_cur, update_cur])
    svc = SettingsService(conn)

    assert svc.update_settings(user_id=b"ignored", settings={"theme": "dark"}, version=None) is True

    query, _params = conn.seen[1].queries[-1]
    assert "settings_schema_version" not in query


def test_get_whatsapp_enabled_users_filters_and_parses() -> None:
    select_cur = FakeCursor(
        fetchall_result=[
            (b"u1", '{"whatsapp_enabled": true, "whatsapp_number": "123"}'),
            (b"u2", '{"whatsapp_enabled": true, "whatsapp_number": ""}'),
            (b"u3", '{"whatsapp_enabled": false, "whatsapp_number": "123"}'),
            (b"u4", "{invalid"),
            (b"u5", {"whatsapp_enabled": True, "whatsapp_number": "555"}),
            (b"u6", None),
        ]
    )
    conn = FakeConnection([select_cur])
    svc = SettingsService(conn)

    users = svc.get_whatsapp_enabled_users()

    assert users == [
        (b"u1", {"whatsapp_enabled": True, "whatsapp_number": "123"}),
        (b"u5", {"whatsapp_enabled": True, "whatsapp_number": "555"}),
    ]
