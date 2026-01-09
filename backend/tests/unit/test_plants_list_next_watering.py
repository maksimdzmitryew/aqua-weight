from datetime import datetime, timedelta

import pytest

from backend.app.helpers.plants_list import PlantsList


class FakeCursor:
    def __init__(self, rows=None, last_watering_at: datetime | None = None, execute_raises: bool = False):
        self._rows = list(rows or [])
        self._last_watering_at = last_watering_at
        self._execute_raises = execute_raises
        self.last_query = None
        self.last_params = None

    # Context manager protocol
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        if self._execute_raises:
            raise RuntimeError("db error")
        self.last_query = query
        self.last_params = list(params or [])

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        # Simulate the latest watering event row with a single datetime column
        return (self._last_watering_at,) if self._last_watering_at is not None else None


class FakeConn:
    def __init__(self, cursor: FakeCursor):
        self._cursor = cursor
        self.closed = False

    def cursor(self):
        # Return the same cursor instance (the production code restores its state at the end)
        return self._cursor

    def close(self):
        self.closed = True


def _row(pid_bytes: bytes, name: str, location_id_bytes: bytes | None, created_at: datetime, measured_at: datetime, water_loss_total_pct: float | None = None):
    # Minimal 9-column row shape supported by PlantsList.fetch_all (see file comments)
    return (
        pid_bytes,  # id
        name,  # name
        None,  # notes/description
        None,  # species_name
        location_id_bytes,  # location_id
        None,  # location_name
        created_at,  # created_at
        measured_at,  # measured_at
        water_loss_total_pct,  # water_loss_total_pct
    )


def test_next_watering_projection_and_roll_forward(monkeypatch):
    # Arrange a plant and watering history that requires roll-forward
    now = datetime.utcnow()
    pid = bytes.fromhex("ab" * 16)
    last_watering_at = now - timedelta(days=10)  # long ago
    freq_days = 3  # so multiple steps should be added

    rows = [_row(pid, "Fern", None, created_at=now - timedelta(days=20), measured_at=now - timedelta(days=1), water_loss_total_pct=5.0)]
    cursor = FakeCursor(rows=rows, last_watering_at=last_watering_at)
    fake_conn = FakeConn(cursor)

    # Patch get_conn and compute_frequency_days
    import backend.app.helpers.plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda conn, uuid_hex: (freq_days, 5))

    items = PlantsList.fetch_all()

    assert items and items[0]["frequency_days"] == freq_days
    assert items[0]["frequency_confidence"] == 5
    # Projection should be at least 'now' (rolled forward); verify it advanced beyond last_watering_at
    nxt = items[0]["next_watering_at"]
    assert nxt is not None
    assert nxt > now - timedelta(days=1)  # should not be in the past
    assert nxt > last_watering_at


def test_next_watering_math_exception_falls_back_to_initial_projection(monkeypatch):
    # When the inner math block raises, code keeps the initial projection
    now = datetime.utcnow()
    pid = bytes.fromhex("cd" * 16)
    last_watering_at = now - timedelta(days=10)
    freq_days = 3

    rows = [_row(pid, "Palm", None, created_at=now - timedelta(days=30), measured_at=now - timedelta(days=1), water_loss_total_pct=7.0)]
    cursor = FakeCursor(rows=rows, last_watering_at=last_watering_at)
    fake_conn = FakeConn(cursor)

    import backend.app.helpers.plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda conn, uuid_hex: (freq_days, 3))

    # Force the inner roll-forward math to raise by monkeypatching ceil within the module
    class Boom(Exception):
        pass

    def _boom(*args, **kwargs):
        raise Boom("ceil broke")

    monkeypatch.setattr(pl_mod, "ceil", _boom)

    items = PlantsList.fetch_all()
    nxt = items[0]["next_watering_at"]
    # Initial projection should be last_watering_at + freq
    assert nxt == last_watering_at + timedelta(days=freq_days)


def test_next_watering_projection_future_no_roll_forward(monkeypatch):
    # When projection is already in the future, the inner if is skipped
    now = datetime.utcnow()
    pid = bytes.fromhex("aa" * 16)
    last_watering_at = now - timedelta(days=1)
    freq_days = 10  # projection is in 9 days (future)

    rows = [_row(pid, "ZZ Plant", None, created_at=now - timedelta(days=3), measured_at=now - timedelta(days=1), water_loss_total_pct=3.0)]
    cursor = FakeCursor(rows=rows, last_watering_at=last_watering_at)
    fake_conn = FakeConn(cursor)

    import backend.app.helpers.plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: (freq_days, 10))

    items = PlantsList.fetch_all()
    assert items[0]["next_watering_at"] == last_watering_at + timedelta(days=freq_days)


def test_next_watering_db_exception_yields_none(monkeypatch):
    # If the inner DB block fails, next_watering_at should remain None
    now = datetime.utcnow()
    pid = bytes.fromhex("ef" * 16)
    rows = [_row(pid, "Monstera", None, created_at=now - timedelta(days=5), measured_at=now - timedelta(days=2), water_loss_total_pct=9.0)]
    # Main cursor should work; inner cursor should raise on execute
    main_cursor = FakeCursor(rows=rows, last_watering_at=None, execute_raises=False)
    inner_cursor = FakeCursor(rows=[], last_watering_at=None, execute_raises=True)

    class TwoCursorConn:
        def __init__(self):
            self._cursor_main = main_cursor
            self._cursor_inner = inner_cursor
            self._calls = 0

        def cursor(self):
            self._calls += 1
            return self._cursor_main if self._calls == 1 else self._cursor_inner

        def close(self):
            pass

    fake_conn = TwoCursorConn()

    import backend.app.helpers.plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda conn, uuid_hex: (4, 1))

    items = PlantsList.fetch_all()
    assert items[0]["next_watering_at"] is None


def test_next_watering_fallback_last_watering_exception(monkeypatch):
    # Cover line 157-159
    now = datetime.utcnow()
    pid = bytes.fromhex("bb" * 16)
    rows = [_row(pid, "Palm", None, created_at=now, measured_at=now)]
    
    main_cursor = FakeCursor(rows=rows)
    # This cursor will be used for the last watering event query
    inner_cursor = FakeCursor(rows=[])
    def _boom(*args, **kwargs):
        raise RuntimeError("last watering query failed")
    inner_cursor.execute = _boom

    class MultiCursorConn(FakeConn):
        def __init__(self, main, inner):
            self._main = main
            self._inner = inner
            self._count = 0
            self.closed = False
        def cursor(self):
            self._count += 1
            return self._main if self._count == 1 else self._inner

    fake_conn = MultiCursorConn(main_cursor, inner_cursor)
    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: (5, 1))

    items = PlantsList.fetch_all()
    assert items[0]["next_watering_at"] is None


def test_next_watering_calculation_exception_resets_values(monkeypatch):
    # Trigger Exception at line 190 by making timedelta fail
    now = datetime.utcnow()
    pid = bytes.fromhex("12" * 16)
    last_watering_at = now - timedelta(days=1)
    freq_days = 5

    rows = [_row(pid, "Ivy", None, created_at=now - timedelta(days=10), measured_at=now - timedelta(days=2), water_loss_total_pct=2.0)]
    cursor = FakeCursor(rows=rows, last_watering_at=last_watering_at)
    fake_conn = FakeConn(cursor)

    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda conn, uuid_hex: (freq_days, 2))

    # Mock timedelta to raise an exception
    def _bad_timedelta(*args, **kwargs):
        raise ValueError("timedelta error")

    monkeypatch.setattr(pl_mod, "timedelta", _bad_timedelta)

    items = PlantsList.fetch_all()

    assert items[0]["next_watering_at"] is None
    assert items[0]["first_calculated_at"] is None
    assert items[0]["days_offset"] is None
