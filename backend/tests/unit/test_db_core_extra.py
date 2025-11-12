import pytest
from types import SimpleNamespace

from backend.app.db import core as core_mod


class _ConnPingFailCloseFail:
    def __init__(self):
        self.closed = False
        self.ping_called = False
        self._cursor = _CursorCloseFail()

    def ping(self, reconnect: bool = False):
        self.ping_called = True
        raise RuntimeError("ping failed")

    def close(self):
        self.closed = True
        # Simulate an exception on close to hit the except: pass branch
        raise RuntimeError("close failed")

    def cursor(self):
        return self._cursor


class _ConnPingFail:
    def __init__(self):
        self.closed = False
        self._cursor = _CursorCloseFail()

    def ping(self, reconnect: bool = False):
        raise RuntimeError("ping failed again")

    def close(self):
        self.closed = True

    def cursor(self):
        return self._cursor


class _ConnOK:
    def __init__(self):
        self.closed = False
        self.ping_called_with = None
        self._cursor = _CursorCloseFail()

    def ping(self, reconnect: bool = False):
        self.ping_called_with = reconnect
        return None

    def close(self):
        self.closed = True

    def cursor(self):
        return self._cursor


class _CursorCloseFail:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True
        raise RuntimeError("cursor close failed")


def test_get_conn_ping_fail_close_raises_then_retry_success(monkeypatch):
    # First connection: ping fails; close also raises (lines 50-51). Second succeeds.
    seq = [_ConnPingFailCloseFail(), _ConnOK()]

    def fake_connect(**kwargs):
        return seq.pop(0)

    monkeypatch.setattr(core_mod, "time", SimpleNamespace(sleep=lambda _x: None))
    monkeypatch.setattr(core_mod, "pymysql", SimpleNamespace(connect=fake_connect))

    conn = core_mod.get_conn()
    assert isinstance(conn, _ConnOK)
    assert conn.ping_called_with is True


def test_get_conn_both_attempts_fail_raises(monkeypatch):
    # Both attempts raise to cover the final raise in except block (line 59)
    seq = [_ConnPingFail(), _ConnPingFail()]

    def fake_connect(**kwargs):
        return seq.pop(0)

    monkeypatch.setattr(core_mod, "time", SimpleNamespace(sleep=lambda _x: None))
    monkeypatch.setattr(core_mod, "pymysql", SimpleNamespace(connect=fake_connect))

    with pytest.raises(Exception):
        core_mod.get_conn()


def test_connect_ping_fails_and_close_raises(monkeypatch):
    # get_conn returns a connection whose ping raises and whose close raises
    fake = _ConnPingFailCloseFail()
    monkeypatch.setattr(core_mod, "get_conn", lambda: fake)

    # Despite ping failure, context should yield; on exit, close raises but is suppressed (78-79)
    with core_mod.connect() as c:
        assert c is fake
    # close was invoked despite raising internally
    assert fake.closed is True


def test_cursor_close_exception_is_suppressed():
    # Ensure the cursor() context manager suppresses close exceptions (91-92)
    fake = _ConnOK()
    cur = fake.cursor()
    with core_mod.cursor(fake) as c:
        assert c is cur
    # close was called and exception suppressed
    assert cur.closed is True
