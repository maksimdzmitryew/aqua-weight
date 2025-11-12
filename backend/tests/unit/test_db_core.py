import os
from types import SimpleNamespace
import pytest

from backend.app.db import core as core_mod


class _FakeConn:
    def __init__(self, *, ping_raises: bool = False):
        self._ping_raises = ping_raises
        self.ping_called_with = None
        self.closed = False
        self._cursor = _FakeCursor()

    def ping(self, reconnect: bool = False):
        self.ping_called_with = reconnect
        if self._ping_raises:
            raise RuntimeError("ping fail")

    def close(self):
        self.closed = True

    def cursor(self):
        return self._cursor


class _FakeCursor:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


def test_get_conn_uses_test_default_when_TEST_MODE(monkeypatch):
    calls = []

    def fake_connect(**kwargs):
        calls.append(kwargs)
        return _FakeConn()

    monkeypatch.setenv("TEST_MODE", "1")
    monkeypatch.delenv("DB_NAME", raising=False)
    monkeypatch.setattr(core_mod, "pymysql", SimpleNamespace(connect=fake_connect))

    conn = core_mod.get_conn()
    assert isinstance(conn, _FakeConn)
    assert calls[-1]["database"] == "appdb_test"
    assert conn.ping_called_with is True


def test_get_conn_DB_NAME_override(monkeypatch):
    calls = []

    def fake_connect(**kwargs):
        calls.append(kwargs)
        return _FakeConn()

    monkeypatch.setenv("TEST_MODE", "1")
    monkeypatch.setenv("DB_NAME", "custom_test")
    monkeypatch.setattr(core_mod, "pymysql", SimpleNamespace(connect=fake_connect))

    conn = core_mod.get_conn()
    assert calls[-1]["database"] == "custom_test"
    assert conn.ping_called_with is True


def test_get_conn_retries_on_ping_failure_and_closes_first(monkeypatch):
    first_conn = _FakeConn(ping_raises=True)
    second_conn = _FakeConn(ping_raises=False)
    seq = [first_conn, second_conn]

    def fake_connect(**kwargs):
        return seq.pop(0)

    # avoid sleep delays
    monkeypatch.setattr(core_mod, "time", SimpleNamespace(sleep=lambda _x: None))
    monkeypatch.setattr(core_mod, "pymysql", SimpleNamespace(connect=fake_connect))

    conn = core_mod.get_conn()
    # first connection should have been closed after ping failure
    assert first_conn.closed is True
    # second connection returned and ping called
    assert conn is second_conn
    assert conn.ping_called_with is True


def test_connect_context_manager_closes_even_on_exception(monkeypatch):
    fake = _FakeConn()
    monkeypatch.setattr(core_mod, "get_conn", lambda: fake)

    with pytest.raises(RuntimeError):
        with core_mod.connect() as c:
            assert c is fake
            raise RuntimeError("boom")
    assert fake.closed is True


def test_cursor_context_manager_closes_even_on_exception():
    fake = _FakeConn()
    cur = fake.cursor()
    with pytest.raises(ValueError):
        with core_mod.cursor(fake) as c:
            assert c is cur
            raise ValueError("err")
    assert cur.closed is True
