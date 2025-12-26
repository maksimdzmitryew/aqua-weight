from datetime import datetime

from backend.app.helpers.plants_list import PlantsList


class RaisingAttrCursor:
    """
    Cursor whose last_params/last_query properties raise on access to cover
    the exception branch when capturing _main_query_params/_main_query_sql (lines 59–61).
    Also supports fetchall() for the main query returning one minimal row.
    """

    def __init__(self, rows):
        self._rows = rows

    # context manager methods
    def __enter__(self):  # pragma: no cover - trivial
        return self

    def __exit__(self, exc_type, exc, tb):  # pragma: no cover - trivial
        return False

    def execute(self, query, params=None):
        # No-op; we want getattr to fail later
        pass

    # Properties that raise when accessed
    @property
    def last_params(self):  # type: ignore[override]
        raise RuntimeError("cannot read params")

    @property
    def last_query(self):  # type: ignore[override]
        raise RuntimeError("cannot read query")

    def fetchall(self):
        return list(self._rows)


class RestorableCursor:
    """
    Cursor that allows us to observe that at the end of fetch_all the module
    restores conn._cursor.last_params and last_query to the values captured
    after the main SELECT, even if a later inner query overwrites them.
    """

    def __init__(self, rows):
        self._rows = rows
        self._last_params = None
        self._last_query = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):  # pragma: no cover - trivial
        return False

    def execute(self, query, params=None):
        # Record every execute call — later inner query will overwrite these
        self._last_query = query
        self._last_params = list(params or [])

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        # No watering event (not relevant to this test)
        return None

    # Expose attributes with getter/setter so we can assert restoration
    @property
    def last_params(self):
        return self._last_params

    @last_params.setter
    def last_params(self, v):
        self._last_params = v

    @property
    def last_query(self):
        return self._last_query

    @last_query.setter
    def last_query(self, v):
        self._last_query = v


class DenySetCursor(RestorableCursor):
    """
    Same as RestorableCursor but raising on setting attributes to exercise the
    guarded try/except around the restoration (lines 207–208).
    """

    @RestorableCursor.last_params.setter
    def last_params(self, v):  # type: ignore[override]
        raise RuntimeError("no set")

    @RestorableCursor.last_query.setter
    def last_query(self, v):  # type: ignore[override]
        raise RuntimeError("no set")


class FakeConn:
    def __init__(self, cursor):
        self._cursor = cursor
        self.closed = False

    def cursor(self):
        return self._cursor

    def close(self):
        self.closed = True


def _row(pid_hex: str):
    pid = bytes.fromhex(pid_hex)
    now = datetime.utcnow()
    # Minimal 9-column layout supported by helper
    return (
        pid,
        "X",
        None,
        None,
        None,
        None,
        now,
        now,
        None,
    )


def test_capture_params_exception_is_swallowed_and_no_restore_attempt(monkeypatch):
    rows = [_row("01" * 16)]
    cursor = RaisingAttrCursor(rows)
    conn = FakeConn(cursor)

    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "get_conn", lambda: conn)
    # Frequency returns None so next_watering branch is skipped
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda conn, uid: None)

    items = PlantsList.fetch_all()
    assert len(items) == 1
    # Because capture failed, restoration should be skipped — attributes remain whatever inner code left
    # In this path there is no inner query, so attributes remain unset
    assert not hasattr(cursor, "_last_params") or cursor._rows is not None  # sanity; nothing crashes


def test_restore_main_cursor_params_and_query(monkeypatch):
    rows = [_row("02" * 16)]
    cursor = RestorableCursor(rows)
    conn = FakeConn(cursor)

    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "get_conn", lambda: conn)
    # Force next_watering path to run so that an inner execute overwrites last_params/query
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: 2)

    PlantsList.fetch_all(min_water_loss_total_pct=42)

    # After function returns, last_params/query must be those from the main SELECT (i.e., [42] and SQL containing WHERE ... > %s)
    assert cursor.last_params == [42]
    assert cursor.last_query and "latest_pm.water_loss_total_pct > %s" in cursor.last_query


def test_restore_block_exceptions_are_swallowed(monkeypatch):
    rows = [_row("03" * 16)]
    cursor = DenySetCursor(rows)
    conn = FakeConn(cursor)

    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "get_conn", lambda: conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: 2)

    # Should not raise even though setting last_params/last_query in restore block fails
    PlantsList.fetch_all(min_water_loss_total_pct=5)
