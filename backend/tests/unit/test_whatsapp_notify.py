from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest


import backend.app.helpers.whatsapp_notify as wn


class FakeCursor:
    def __init__(self, *, fetchall_result=None):
        self.fetchall_result = list(fetchall_result or [])
        self.executed: list[tuple[str, tuple | None]] = []
        self.closed = False

    def execute(self, query, params=None):
        self.executed.append((query, tuple(params) if params is not None else None))
        return 1

    def fetchall(self):
        return list(self.fetchall_result)

    def close(self):
        self.closed = True


class FakeConn:
    def __init__(self, cursors: list[FakeCursor] | None = None):
        self._cursors = list(cursors or [])
        self.seen: list[FakeCursor] = []

    def cursor(self):
        cur = self._cursors.pop(0) if self._cursors else FakeCursor()
        self.seen.append(cur)
        return cur


def test_render_placeholders_handles_empty_template() -> None:
    assert wn.render_placeholders("", {"x": "y"}) == ""


def test_render_placeholders_replaces_values_and_aliases_and_preserves_unknown() -> None:
    rendered = wn.render_placeholders(
        "count={{weight_count}} list={{weight_list}} loc={{location_count}} unk={{nope}}",
        {
            "weight_plants_count": "2",
            "weight_plants_list": "A,B",
            "location_group_count": "3",
        },
    )
    assert rendered == "count=2 list=A,B loc=3 unk={{nope}}"


def test_get_whatsapp_credentials_returns_manager_result(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(wn, "get_whatsapp_credentials_from_manager", lambda conn: {"api_url": "u"})
    assert wn.get_whatsapp_credentials(conn=object()) == {"api_url": "u"}


def test_get_whatsapp_credentials_returns_empty_on_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom(_conn):
        raise RuntimeError("db down")

    monkeypatch.setattr(wn, "get_whatsapp_credentials_from_manager", boom)
    assert wn.get_whatsapp_credentials(conn=object()) == {
        "api_url": "",
        "api_token": "",
        "template_name": "",
        "phone_number_id": "",
    }


def test_save_whatsapp_credentials_delegates_to_manager(monkeypatch: pytest.MonkeyPatch) -> None:
    called = {}

    def fake_save(conn, api_url, api_token, template_name, phone_number_id):
        called["args"] = (conn, api_url, api_token, template_name, phone_number_id)
        return True

    monkeypatch.setattr(wn, "save_whatsapp_credentials_from_manager", fake_save)
    conn = object()
    assert wn.save_whatsapp_credentials(conn, "u", "t", "tpl", "pid") is True
    assert called["args"] == (conn, "u", "t", "tpl", "pid")


def test_save_whatsapp_credentials_returns_false_on_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_args, **_kwargs):
        raise ValueError("bad")

    monkeypatch.setattr(wn, "save_whatsapp_credentials_from_manager", boom)
    # The function catches exceptions and returns False instead of re-raising
    result = wn.save_whatsapp_credentials(object(), "u", "t", "tpl")
    assert result is False


def test_generate_bin16_id_delegates_to_credential_manager(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.app.helpers import credential_manager as cm

    monkeypatch.setattr(cm, "_generate_bin16_id", lambda: b"x" * 16)
    assert wn._generate_bin16_id() == b"x" * 16


def test_ensure_whatsapp_send_logs_table_executes_create() -> None:
    cur = FakeCursor()
    conn = FakeConn([cur])

    wn.ensure_whatsapp_send_logs_table(conn)

    assert any("CREATE TABLE IF NOT EXISTS whatsapp_send_logs" in q for q, _p in cur.executed)
    assert cur.closed is True


def test_record_whatsapp_send_log_inserts_row(monkeypatch: pytest.MonkeyPatch) -> None:
    # First cursor: ensure table; second: insert.
    ensure_cur = FakeCursor()
    insert_cur = FakeCursor()
    conn = FakeConn([ensure_cur, insert_cur])

    monkeypatch.setattr(wn, "_generate_bin16_id", lambda: b"1" * 16)

    wn.record_whatsapp_send_log(
        conn,
        user_id=b"u1",
        to_number="+123",
        message_type="text",
        triggered_by="helping_user",
        body="hi",
        success=True,
        error_message=None,
    )

    assert any("INSERT INTO whatsapp_send_logs" in q for q, _p in insert_cur.executed)


def test_record_whatsapp_send_log_ignores_ensure_table_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Force ensure to fail; insert still attempted and failures are swallowed.
    monkeypatch.setattr(
        wn,
        "ensure_whatsapp_send_logs_table",
        lambda _conn: (_ for _ in ()).throw(RuntimeError("x")),
    )

    conn = FakeConn([FakeCursor()])
    monkeypatch.setattr(wn, "_generate_bin16_id", lambda: b"1" * 16)

    wn.record_whatsapp_send_log(
        conn,
        user_id=None,
        to_number="+123",
        message_type="text",
        triggered_by="helping_user",
        body=None,
        success=False,
        error_message="err",
    )


def test_record_whatsapp_send_log_ignores_insert_error(monkeypatch: pytest.MonkeyPatch) -> None:
    class ExplodingCursor(FakeCursor):
        def execute(self, query, params=None):
            raise RuntimeError("insert failed")

    conn = FakeConn([FakeCursor(), ExplodingCursor()])
    monkeypatch.setattr(wn, "_generate_bin16_id", lambda: b"1" * 16)

    wn.record_whatsapp_send_log(
        conn,
        user_id=b"u1",
        to_number="+123",
        message_type="text",
        triggered_by="helping_user",
        body="hi",
        success=True,
        error_message=None,
    )


def test_get_thirsty_plants_filters_and_maps(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        wn.PlantsList,
        "fetch_all",
        lambda **_kwargs: [
            {
                "needs_water": True,
                "name": "A",
                "location": "L",
                "water_retained_pct": 10,
                "recommended_water_threshold_pct": None,
            },
            {"needs_water": False, "name": "B"},
            {
                "needs_water": True,
                "name": None,
                "location": None,
                "water_retained_pct": None,
                "recommended_water_threshold_pct": 55,
            },
        ],
    )

    out = wn.get_thirsty_plants(conn=None, owner_user_id=b"u1")
    assert out == [
        {
            "name": "A",
            "location": "L",
            "water_retained_pct": 10,
            "min_water_retention": wn.DEFAULT_WATER_THRESHOLD_PCT,
        },
        {
            "name": None,
            "location": "Unknown",
            "water_retained_pct": None,
            "min_water_retention": 55,
        },
    ]


def test_build_thirsty_list_empty() -> None:
    assert wn._build_thirsty_list([]) == "All plants are watered. No watering needed today."


def test_build_thirsty_list_with_combined_template_groups_by_location() -> None:
    template = (
        "[[AW_LOCATION_GROUP_HEADER]]\n"
        "Loc={{location_group}} ({{location_group_count}})\n"
        "[[AW_ITEM_TEMPLATE]]\n"
        "* {{name}} @ {{location}} retained={{water_retained_pct}} min={{min_water_retention}}\n"
    )
    plants = [
        {"name": "A", "location": "Kitchen", "water_retained_pct": 10, "min_water_retention": 40},
        {
            "name": "B",
            "location": "Kitchen",
            "water_retained_pct": None,
            "min_water_retention": None,
        },
        {"name": "C", "location": None, "water_retained_pct": 5, "min_water_retention": 30},
    ]

    msg = wn._build_thirsty_list(plants, template=template)

    assert "Loc=Kitchen (2)" in msg
    assert "* A @ Kitchen retained=10% min=40%" in msg
    assert "* B @ Kitchen retained=N/A min=N/A" in msg
    assert "Loc=no location (1)" in msg
    # Per-plant placeholder keeps original behavior: empty/None location becomes "Unknown".
    assert "* C @ Unknown retained=5% min=30%" in msg


def test_build_thirsty_list_header_only_template_still_adds_default_items() -> None:
    template = "[[AW_LOCATION_GROUP_HEADER]]\nH {{location_group}}\n"  # no item template
    plants = [
        {
            "name": "A",
            "location": "Kitchen",
            "water_retained_pct": None,
            "min_water_retention": None,
        },
        {"name": "B", "location": "Kitchen", "water_retained_pct": 1, "min_water_retention": 2},
    ]
    msg = wn._build_thirsty_list(plants, template=template)
    assert msg.splitlines()[0] == "H Kitchen"
    assert "- A (Kitchen) water retained: N/A" in msg
    assert "- B (Kitchen) water retained: 1%" in msg


def test_build_thirsty_list_skips_empty_rendered_header(monkeypatch: pytest.MonkeyPatch) -> None:
    # Cover the branch where a header template exists but renders to an empty string.
    real_render = wn.render_placeholders

    def fake_render(template_text: str, values: dict[str, str]) -> str:
        if template_text == "ANY":
            return ""
        return real_render(template_text, values)

    monkeypatch.setattr(wn, "render_placeholders", fake_render)
    template = "[[AW_LOCATION_GROUP_HEADER]]\n" "ANY\n" "[[AW_ITEM_TEMPLATE]]\n" "* {{name}}\n"
    msg = wn._build_thirsty_list(
        [
            {
                "name": "A",
                "location": "Kitchen",
                "water_retained_pct": None,
                "min_water_retention": None,
            }
        ],
        template=template,
    )
    assert msg.strip() == "* A"


def test_build_thirsty_list_default_format_without_template() -> None:
    msg = wn._build_thirsty_list(
        [
            {
                "name": "A",
                "location": "Kitchen",
                "water_retained_pct": None,
                "min_water_retention": None,
            }
        ],
        template=None,
    )
    assert msg == "- A (Kitchen) water retained: N/A"


def test_get_weight_plants_maps_rows_and_computes_days(monkeypatch: pytest.MonkeyPatch) -> None:
    fixed_now = datetime(2025, 1, 10, 12, 0, 0, tzinfo=timezone.utc)

    class FakeDatetime:
        @staticmethod
        def now(tz=None):
            return fixed_now

        @staticmethod
        def fromisoformat(s):
            return datetime.fromisoformat(s)

    monkeypatch.setattr(wn, "datetime", FakeDatetime)

    measured_at_naive = datetime(2025, 1, 7, 12, 0, 0)  # naive
    measured_at_aware = datetime(2025, 1, 9, 12, 0, 0, tzinfo=timezone.utc)
    cur = FakeCursor(
        fetchall_result=[
            (b"p1", "A", "Kitchen", measured_at_naive, 111),
            (b"p2", "B", None, measured_at_aware, None),
            (b"p3", "C", "Office", None, 9),
        ]
    )
    conn = FakeConn([cur])

    out = wn.get_weight_plants(conn, owner_user_id=b"u1")
    assert out == [
        {
            "name": "A",
            "location": "Kitchen",
            "measured_weight_g": 111,
            "measured_at": measured_at_naive.replace(tzinfo=timezone.utc),
            "days_since_last_weigh": 3,
        },
        {
            "name": "B",
            "location": "Unknown",
            "measured_weight_g": None,
            "measured_at": measured_at_aware,
            "days_since_last_weigh": 1,
        },
        {
            "name": "C",
            "location": "Office",
            "measured_weight_g": 9,
            "measured_at": None,
            "days_since_last_weigh": None,
        },
    ]


def test_build_weight_plants_list_empty_uses_default_or_template() -> None:
    assert wn._build_weight_plants_list([]) == "No weighing data available yet."
    assert wn._build_weight_plants_list([], template="X") == "X"


def test_build_weight_plants_list_with_header_only_template() -> None:
    template = "[[AW_LOCATION_GROUP_HEADER]]\nH {{location_count}}\n"  # no item template
    plants = [
        {"name": "A", "location": "Kitchen", "measured_weight_g": 1, "days_since_last_weigh": 2}
    ]
    msg = wn._build_weight_plants_list(plants, template=template)
    # Header rendered via alias: template uses location_count, code provides location_group_count.
    assert msg.splitlines()[0] == "H 1"
    # With no item template, the default per-plant line is appended.
    assert "- A (Kitchen): 1g, last weighed: 2" in msg


def test_build_weight_plants_list_with_combined_template_renders_items() -> None:
    template = (
        "[[AW_LOCATION_GROUP_HEADER]]\n"
        "Loc={{location_group}} ({{location_count}})\n"
        "[[AW_ITEM_TEMPLATE]]\n"
        "* {{name}} @ {{location}} weight={{measured_weight_g}} days={{days_since_last_weigh}}\n"
    )
    plants = [
        {"name": "A", "location": "Kitchen", "measured_weight_g": 1, "days_since_last_weigh": 2},
        {"name": None, "location": None, "measured_weight_g": None, "days_since_last_weigh": None},
    ]
    msg = wn._build_weight_plants_list(plants, template=template)
    assert "Loc=Kitchen (1)" in msg
    assert "* A @ Kitchen weight=1g days=2" in msg
    assert "Loc=no location (1)" in msg
    assert "* Unknown @ Unknown weight=N/A days=N/A" in msg


def test_build_weight_plants_list_with_simple_item_template_no_header() -> None:
    # Template without the location header marker should be treated as an item template.
    template = "* {{name}} @ {{location}}"
    plants = [
        {
            "name": "A",
            "location": "Kitchen",
            "measured_weight_g": None,
            "days_since_last_weigh": None,
        },
        # Same location to cover the "already seen location" branch in grouping.
        {"name": "B", "location": "Kitchen", "measured_weight_g": 1, "days_since_last_weigh": 2},
    ]
    msg = wn._build_weight_plants_list(plants, template=template)
    assert msg.splitlines() == ["* A @ Kitchen", "* B @ Kitchen"]


def test_build_weight_plants_list_skips_empty_rendered_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_render = wn.render_placeholders

    def fake_render(template_text: str, values: dict[str, str]) -> str:
        if template_text == "ANY":
            return ""
        return real_render(template_text, values)

    monkeypatch.setattr(wn, "render_placeholders", fake_render)
    template = "[[AW_LOCATION_GROUP_HEADER]]\n" "ANY\n" "[[AW_ITEM_TEMPLATE]]\n" "* {{name}}\n"
    msg = wn._build_weight_plants_list(
        [{"name": "A", "location": "Kitchen", "measured_weight_g": 1, "days_since_last_weigh": 2}],
        template=template,
    )
    assert msg.strip() == "* A"


def test_format_digest_message_helpers_branch() -> None:
    assert "No watering needed" in wn.format_digest_message([], helpers_count=0)

    msg = wn.format_digest_message(
        [{"name": "A", "location": "L", "water_retained_pct": None}],
        helpers_count=1,
    )
    assert "1 plant(s) need watering" in msg
    assert "helper(s) can assist" in msg


def test_format_digest_message_non_empty_without_helpers() -> None:
    msg = wn.format_digest_message(
        [{"name": "A", "location": "L", "water_retained_pct": 10}],
        helpers_count=0,
    )
    assert "helper(s) can assist" not in msg


class FakeHttpxClient:
    def __init__(
        self, *, response: httpx.Response | None = None, raise_exc: Exception | None = None
    ):
        self._response = response
        self._raise_exc = raise_exc
        self.posts: list[tuple[str, dict, dict]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def post(self, url, *, headers=None, json=None):
        self.posts.append((url, headers or {}, json or {}))
        if self._raise_exc:
            raise self._raise_exc
        assert self._response is not None
        return self._response


def test_send_whatsapp_message_missing_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("WHATSAPP_API_URL", raising=False)
    monkeypatch.delenv("WHATSAPP_API_TOKEN", raising=False)

    ok, err = wn.send_whatsapp_message(group_id="g", message="m", conn=None)
    assert ok is False
    assert "not configured" in err


def test_send_whatsapp_message_success_builds_phone_number_id_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req = httpx.Request("POST", "https://example/messages")
    resp = httpx.Response(200, json={"ok": True}, request=req)
    fake_client = FakeHttpxClient(response=resp)
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_client)

    monkeypatch.setattr(
        wn,
        "get_whatsapp_credentials",
        lambda _conn: {
            "api_url": "https://graph.example/v18.0",
            "api_token": "t",
            "template_name": "tpl",
            "phone_number_id": "PN",
        },
    )

    ok, err = wn.send_whatsapp_message(group_id="+1", message="ignored", conn=object())
    assert (ok, err) == (True, "")
    assert fake_client.posts[0][0] == "https://graph.example/v18.0/PN/messages"


def test_send_whatsapp_message_does_not_duplicate_messages_suffix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req = httpx.Request("POST", "https://example/messages")
    resp = httpx.Response(200, json={"ok": True}, request=req)
    fake_client = FakeHttpxClient(response=resp)
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_client)

    monkeypatch.setattr(
        wn,
        "get_whatsapp_credentials",
        lambda _conn: {
            "api_url": "https://graph.example/v18.0/messages",
            "api_token": "t",
            "template_name": "tpl",
            "phone_number_id": "PN",
        },
    )

    ok, err = wn.send_whatsapp_message(group_id="+1", message="ignored", conn=object())
    assert (ok, err) == (True, "")
    # When api_url already ends with /messages, phone_number_id is not appended.
    assert fake_client.posts[0][0] == "https://graph.example/v18.0/messages"


def test_send_whatsapp_message_without_phone_number_id_preserves_messages_suffix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req = httpx.Request("POST", "https://example/messages")
    resp = httpx.Response(200, json={"ok": True}, request=req)
    fake_client = FakeHttpxClient(response=resp)
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_client)

    monkeypatch.setenv("WHATSAPP_API_URL", "https://graph.example/v18.0/messages")
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "t")

    ok, err = wn.send_whatsapp_message(group_id="+1", message="ignored", conn=None)
    assert (ok, err) == (True, "")
    assert fake_client.posts[0][0] == "https://graph.example/v18.0/messages"


def test_send_whatsapp_message_http_status_error_extracts_facebook_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req = httpx.Request("POST", "https://graph.example/v18.0/messages")
    resp = httpx.Response(
        400,
        json={"error": {"message": "Bad", "code": 999}},
        request=req,
    )
    fake_client = FakeHttpxClient(response=resp)
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_client)

    monkeypatch.setenv("WHATSAPP_API_URL", "https://graph.example/v18.0")
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "t")
    monkeypatch.delenv("WHATSAPP_PHONE_NUMBER_ID", raising=False)

    ok, err = wn.send_whatsapp_message(group_id="+1", message="ignored", conn=None)
    assert ok is False
    assert err == "(999) Bad"


def test_send_whatsapp_message_http_status_error_without_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req = httpx.Request("POST", "https://graph.example/v18.0/messages")
    resp = httpx.Response(400, json={"error": {"message": "Bad"}}, request=req)
    fake_client = FakeHttpxClient(response=resp)
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_client)
    monkeypatch.setenv("WHATSAPP_API_URL", "https://graph.example/v18.0")
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "t")

    ok, err = wn.send_whatsapp_message(group_id="+1", message="ignored", conn=None)
    assert (ok, err) == (False, "Bad")


def test_send_whatsapp_message_http_status_error_with_invalid_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req = httpx.Request("POST", "https://graph.example/v18.0/messages")
    resp = httpx.Response(400, content=b"not-json", request=req)
    fake_client = FakeHttpxClient(response=resp)
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_client)
    monkeypatch.setenv("WHATSAPP_API_URL", "https://graph.example/v18.0")
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "t")

    ok, err = wn.send_whatsapp_message(group_id="+1", message="ignored", conn=None)
    assert ok is False
    assert err


def test_send_whatsapp_message_generic_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_client = FakeHttpxClient(raise_exc=RuntimeError("boom"))
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_client)
    monkeypatch.setenv("WHATSAPP_API_URL", "https://graph.example/v18.0")
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "t")

    ok, err = wn.send_whatsapp_message(group_id="+1", message="ignored", conn=None)
    assert (ok, err) == (False, "boom")


def test_send_whatsapp_text_message_empty_body(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WHATSAPP_API_URL", "https://graph.example/v18.0")
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "t")

    ok, err = wn.send_whatsapp_text_message(to_number="+1", body="   ", conn=None)
    assert (ok, err) == (False, "Message body is empty")


def test_send_whatsapp_text_message_missing_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("WHATSAPP_API_URL", raising=False)
    monkeypatch.delenv("WHATSAPP_API_TOKEN", raising=False)

    ok, err = wn.send_whatsapp_text_message(to_number="+1", body="hi", conn=None)
    assert ok is False
    assert "not configured" in err


def test_send_whatsapp_text_message_success_and_error_paths(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Success
    req_ok = httpx.Request("POST", "https://graph.example/v18.0/messages")
    resp_ok = httpx.Response(200, json={"ok": True}, request=req_ok)
    fake_ok = FakeHttpxClient(response=resp_ok)
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_ok)
    monkeypatch.setenv("WHATSAPP_API_URL", "https://graph.example/v18.0")
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "t")
    ok, err = wn.send_whatsapp_text_message(to_number="+1", body="hi", conn=None)
    assert (ok, err) == (True, "")

    # HTTP status error
    req_bad = httpx.Request("POST", "https://graph.example/v18.0/messages")
    resp_bad = httpx.Response(
        403, json={"error": {"message": "Nope", "type": "forbidden"}}, request=req_bad
    )
    fake_bad = FakeHttpxClient(response=resp_bad)
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_bad)
    ok, err = wn.send_whatsapp_text_message(to_number="+1", body="hi", conn=None)
    assert ok is False
    assert err == "(forbidden) Nope"

    # Generic exception
    fake_boom = FakeHttpxClient(raise_exc=RuntimeError("boom"))
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_boom)
    ok, err = wn.send_whatsapp_text_message(to_number="+1", body="hi", conn=None)
    assert (ok, err) == (False, "boom")


def test_send_whatsapp_text_message_http_status_error_without_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req = httpx.Request("POST", "https://graph.example/v18.0/messages")
    resp = httpx.Response(400, json={"error": {"message": "Bad"}}, request=req)
    fake_bad = FakeHttpxClient(response=resp)
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_bad)
    monkeypatch.setenv("WHATSAPP_API_URL", "https://graph.example/v18.0")
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "t")

    ok, err = wn.send_whatsapp_text_message(to_number="+1", body="hi", conn=None)
    assert (ok, err) == (False, "Bad")


def test_send_whatsapp_text_message_http_status_error_invalid_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req = httpx.Request("POST", "https://graph.example/v18.0/messages")
    resp = httpx.Response(400, content=b"not-json", request=req)
    fake_bad = FakeHttpxClient(response=resp)
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_bad)
    monkeypatch.setenv("WHATSAPP_API_URL", "https://graph.example/v18.0")
    monkeypatch.setenv("WHATSAPP_API_TOKEN", "t")

    ok, err = wn.send_whatsapp_text_message(to_number="+1", body="hi", conn=None)
    assert ok is False
    assert err


def test_send_whatsapp_text_message_uses_conn_credentials_and_messages_url_suffix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # api_url already ends with /messages; it should not be duplicated.
    req = httpx.Request("POST", "https://graph.example/v18.0/messages")
    resp = httpx.Response(200, json={"ok": True}, request=req)
    fake_client = FakeHttpxClient(response=resp)
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_client)
    monkeypatch.setattr(
        wn,
        "get_whatsapp_credentials",
        lambda _conn: {"api_url": "https://graph.example/v18.0/messages", "api_token": "t"},
    )

    ok, err = wn.send_whatsapp_text_message(to_number="+1", body="hi", conn=object())
    assert (ok, err) == (True, "")
    assert fake_client.posts[0][0] == "https://graph.example/v18.0/messages"


def test_send_whatsapp_message_uses_placeholder_phone_number_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cover line 488: api_url contains {phone_number_id} placeholder."""
    req = httpx.Request("POST", "https://graph.example/v18.0/12345/messages")
    resp = httpx.Response(200, json={"ok": True}, request=req)
    fake_client = FakeHttpxClient(response=resp)
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_client)

    monkeypatch.setattr(
        wn,
        "get_whatsapp_credentials",
        lambda _conn: {
            "api_url": "https://graph.example/v18.0/{phone_number_id}/messages",
            "api_token": "t",
            "template_name": "tpl",
            "phone_number_id": "12345",
        },
    )

    ok, err = wn.send_whatsapp_message(group_id="+1", message="ignored", conn=object())
    assert (ok, err) == (True, "")
    assert fake_client.posts[0][0] == "https://graph.example/v18.0/12345/messages"


def test_send_whatsapp_text_message_uses_placeholder_phone_number_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cover line 561: api_url contains {phone_number_id} placeholder."""
    req = httpx.Request("POST", "https://graph.example/v18.0/67890/messages")
    resp = httpx.Response(200, json={"ok": True}, request=req)
    fake_client = FakeHttpxClient(response=resp)
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_client)

    monkeypatch.setattr(
        wn,
        "get_whatsapp_credentials",
        lambda _conn: {
            "api_url": "https://graph.example/v18.0/{phone_number_id}/messages",
            "api_token": "t",
            "phone_number_id": "67890",
        },
    )

    ok, err = wn.send_whatsapp_text_message(to_number="+1", body="hi", conn=object())
    assert (ok, err) == (True, "")
    assert fake_client.posts[0][0] == "https://graph.example/v18.0/67890/messages"


def test_send_whatsapp_text_message_builds_url_with_phone_number_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cover line 564: phone_number_id provided but no placeholder and url doesn't end with /messages."""
    req = httpx.Request("POST", "https://graph.example/v18.0/67890/messages")
    resp = httpx.Response(200, json={"ok": True}, request=req)
    fake_client = FakeHttpxClient(response=resp)
    monkeypatch.setattr(wn.httpx, "Client", lambda timeout: fake_client)

    monkeypatch.setattr(
        wn,
        "get_whatsapp_credentials",
        lambda _conn: {
            "api_url": "https://graph.example/v18.0",
            "api_token": "t",
            "phone_number_id": "67890",
        },
    )

    ok, err = wn.send_whatsapp_text_message(to_number="+1", body="hi", conn=object())
    assert (ok, err) == (True, "")
    assert fake_client.posts[0][0] == "https://graph.example/v18.0/67890/messages"


def test_should_skip_notification_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    fixed_now = datetime(2025, 1, 10, 12, 0, 0, tzinfo=timezone.utc)

    class FakeDatetime:
        @staticmethod
        def now(tz=None):
            return fixed_now

        @staticmethod
        def fromisoformat(s):
            return datetime.fromisoformat(s)

    monkeypatch.setattr(wn, "datetime", FakeDatetime)

    assert wn.should_skip_notification({}) is False
    assert wn.should_skip_notification({"whatsapp_last_notification": {}}) is False
    assert wn.should_skip_notification({"whatsapp_last_notification": {"sent_at": None}}) is False
    assert (
        wn.should_skip_notification({"whatsapp_last_notification": {"sent_at": "not-iso"}}) is False
    )

    recent = (fixed_now - timedelta(hours=1)).replace(tzinfo=None).isoformat()
    assert (
        wn.should_skip_notification(
            {"whatsapp_last_notification": {"sent_at": recent, "triggered_by": "helping_user"}}
        )
        is True
    )
    assert (
        wn.should_skip_notification(
            {"whatsapp_last_notification": {"sent_at": recent, "triggered_by": "admin"}}
        )
        is False
    )

    old = (fixed_now - timedelta(hours=25)).isoformat()
    assert (
        wn.should_skip_notification(
            {"whatsapp_last_notification": {"sent_at": old, "triggered_by": "helping_user"}}
        )
        is False
    )
