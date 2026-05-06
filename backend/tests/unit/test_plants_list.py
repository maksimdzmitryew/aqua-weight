import builtins
from datetime import datetime, timedelta
import types
import pytest

from backend.app.helpers.plants_list import PlantsList


class FakeCursor:
    def __init__(self, rows=None, count_result=None):
        self._rows = rows or []
        self._count_result = count_result
        self.last_query = None
        self.last_params = None
        self.closed = False

    # context manager protocol used by PyMySQL cursors
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()
        return False

    # DB-API methods the code calls
    def execute(self, query, params=None):
        self.last_query = query
        self.last_params = list(params or [])
        return len(self._rows)

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        if self._count_result is not None:
            return (self._count_result,)
        return (0,)

    def close(self):
        self.closed = True


class FakeConnection:
    def __init__(self, rows=None, count_result=None):
        self._cursor = FakeCursor(rows=rows, count_result=count_result)
        self.closed = False

    def cursor(self):
        # Return a fresh cursor each time to mimic real behavior
        return self._cursor

    def close(self):
        self.closed = True


def make_row(
    *,
    pid_bytes: bytes,
    name: str = "N",
    description: str | None = None,
    species_name: str | None = None,
    location_id_bytes: bytes | None = None,
    location_name: str | None = None,
    created_at: datetime | None = None,
    measured_at: datetime | None = None,
    water_loss_total_pct: float | None = None,
):
    # Row layout matches SELECT in PlantsList.fetch_all
    # 0 id, 1 name, 2 description, 3 species_name, 4 location_id,
    # 5 location_name, 6 created_at, 7 measured_at, 8 water_loss_total_pct
    return (
        pid_bytes,
        name,
        description,
        species_name,
        location_id_bytes,
        location_name,
        created_at,
        measured_at,
        water_loss_total_pct,
    )


def test_fetch_all_empty(monkeypatch):
    fake_conn = FakeConnection(rows=[])

    # Monkeypatch get_conn used inside module
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    items = PlantsList.fetch_all()
    assert items == []
    # ensure connection closed in finally block
    assert fake_conn.closed is True


def test_fetch_all_mapping_and_timestamp_preference(monkeypatch):
    # Prepare two plants: first has measured_at; second has no measurement
    now = datetime.utcnow()
    pid1 = bytes.fromhex("11" * 16)
    pid2 = bytes.fromhex("22" * 16)
    loc1 = bytes.fromhex("aa" * 16)

    row1 = make_row(
        pid_bytes=pid1,
        name="Aloe",
        description="Succulent",
        species_name="Aloe vera",
        location_id_bytes=loc1,
        location_name="Kitchen",
        created_at=now - timedelta(days=5),
        measured_at=now - timedelta(days=1),
        water_loss_total_pct=12.5,
    )
    row2 = make_row(
        pid_bytes=pid2,
        name="Ficus",
        description=None,
        species_name=None,
        location_id_bytes=None,
        location_name=None,
        created_at=now - timedelta(days=2),
        measured_at=None,
        water_loss_total_pct=None,
    )

    fake_conn = FakeConnection(rows=[row1, row2])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    items = PlantsList.fetch_all()

    # Synthetic id starts from 1
    assert items[0]["id"] == 1
    assert items[1]["id"] == 2

    # UUID hex should equal bytes.hex()
    assert items[0]["uuid"] == pid1.hex()
    assert items[1]["uuid"] == pid2.hex()

    # Location mapping and hex conversion
    assert items[0]["location"] == "Kitchen"
    assert items[0]["location_id"] == loc1.hex()
    assert items[1]["location"] is None
    assert items[1]["location_id"] is None

    # Timestamp preference: measured_at over created_at over now
    assert items[0]["created_at"].replace(microsecond=0) == (now - timedelta(days=1)).replace(
        microsecond=0
    )
    # Second item has no measured_at, should pick created_at
    assert items[1]["created_at"].replace(microsecond=0) == (now - timedelta(days=2)).replace(
        microsecond=0
    )

    # Water loss passthrough
    assert items[0]["water_loss_total_pct"] == 12.5
    assert items[1]["water_loss_total_pct"] is None


def make_row_full(
    *,
    pid_bytes: bytes,
    name: str = "N",
    notes: str | None = None,
    species_name: str | None = None,
    min_dry_weight_g: float | None = 100.0,
    max_water_weight_g: float | None = 200.0,
    recommended_water_threshold_pct: float | None = 0.4,
    identify_hint: str | None = "hint",
    location_id_bytes: bytes | None = None,
    location_name: str | None = None,
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
    measured_at: datetime | None = None,
    measured_weight_g: float | None = 150.0,
    last_wet_weight_g: float | None = 200.0,
    water_loss_total_pct: float | None = 50.0,
    archive: int = 0,
):
    # Full shape (17 columns):
    # 0 id, 1 name, 2 notes, 3 species_name, 4 min_dry, 5 max_water, 6 thr_pct,
    # 7 identify_hint, 8 location_id, 9 location_name, 10 created_at,
    # 11 updated_at, 12 measured_at, 13 measured_weight_g, 14 last_wet_weight_g, 15 water_loss_total_pct, 16 archive
    return (
        pid_bytes,
        name,
        notes,
        species_name,
        min_dry_weight_g,
        max_water_weight_g,
        recommended_water_threshold_pct,
        identify_hint,
        location_id_bytes,
        location_name,
        created_at,
        updated_at,
        measured_at,
        measured_weight_g,
        last_wet_weight_g,
        water_loss_total_pct,
        archive,
    )


def test_fetch_all_full_row_mapping(monkeypatch):
    now = datetime.utcnow()
    pid = bytes.fromhex("44" * 16)
    loc = bytes.fromhex("bb" * 16)

    row = make_row_full(
        pid_bytes=pid,
        name="Spider Plant",
        notes="Fast growing",
        species_name="Chlorophytum comosum",
        location_id_bytes=loc,
        location_name="Living Room",
        created_at=now - timedelta(days=10),
        measured_at=now - timedelta(days=1),
        water_loss_total_pct=30.0,
    )

    fake_conn = FakeConnection(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    items = PlantsList.fetch_all()

    assert items[0]["uuid"] == pid.hex()
    assert items[0]["name"] == "Spider Plant"
    assert items[0]["notes"] == "Fast growing"
    assert items[0]["species"] == "Chlorophytum comosum"
    assert items[0]["location"] == "Living Room"
    assert items[0]["min_dry_weight_g"] == 100.0
    assert items[0]["max_water_weight_g"] == 200.0
    assert items[0]["recommended_water_threshold_pct"] == 0.4
    assert items[0]["identify_hint"] == "hint"
    assert items[0]["archive"] == 0


def test_fetch_all_full_row_mapping_archived(monkeypatch):
    now = datetime.utcnow()
    pid = bytes.fromhex("44" * 16)
    loc = bytes.fromhex("bb" * 16)

    row = make_row_full(
        pid_bytes=pid,
        name="Spider Plant",
        archive=1,
    )

    fake_conn = FakeConnection(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    items = PlantsList.fetch_all(status="all")

    assert items[0]["archive"] == 1


def test_fetch_all_compute_frequency_exception(monkeypatch):
    now = datetime.utcnow()
    pid = bytes.fromhex("55" * 16)
    row = make_row(pid_bytes=pid, name="Fern", created_at=now)

    fake_conn = FakeConnection(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    def _boom(*args, **kwargs):
        raise RuntimeError("frequency error")

    monkeypatch.setattr(pl_mod, "compute_frequency_days", _boom)

    items = PlantsList.fetch_all()
    assert items[0]["frequency_days"] is None
    assert items[0]["frequency_confidence"] == 0


def test_fetch_all_db_params_exception_coverage(monkeypatch):
    # Cover lines 62-64 (Exception in line 59)
    now = datetime.utcnow()
    pid = bytes.fromhex("66" * 16)
    row = make_row(pid_bytes=pid, name="Cactus", created_at=now)

    class BadCursor(FakeCursor):
        def __init__(self, rows=None):
            # Bypass FakeCursor.__init__ to avoid setting self.last_params which is now a property
            self._rows = rows or []
            self._last_query = None
            self.closed = False

        @property
        def last_query(self):
            return self._last_query

        @last_query.setter
        def last_query(self, value):
            self._last_query = value

        def execute(self, query, params=None):
            self.last_query = query
            # Skip setting last_params in execute
            return len(self._rows)

        @property
        def last_params(self):
            raise RuntimeError("no params")

    class BadConn(FakeConnection):
        def __init__(self, rows):
            super().__init__(rows)
            self._cursor = BadCursor(rows=rows)

    fake_conn = BadConn(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    # Should not raise
    items = PlantsList.fetch_all()
    assert len(items) == 1

    # Should not raise
    items = PlantsList.fetch_all()
    assert len(items) == 1


def test_fetch_all_with_min_water_loss_filter_full_coverage(monkeypatch):
    # Cover lines 52-53 and ensure query is correct
    now = datetime.utcnow()
    pid = bytes.fromhex("88" * 16)
    row = make_row_full(pid_bytes=pid, name="Cactus", water_loss_total_pct=25.0)
    fake_conn = FakeConnection(rows=[row])

    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    # Use a value that will trigger the if block
    items = PlantsList.fetch_all(min_water_loss_total_pct=10.0)

    assert len(items) == 1
    assert fake_conn._cursor.last_params == [10.0]
    assert "AND latest_pm.water_loss_total_pct > %s" in fake_conn._cursor.last_query


def test_fetch_all_restore_params_exception_coverage(monkeypatch):
    # Cover lines 240-241
    now = datetime.utcnow()
    pid = bytes.fromhex("99" * 16)
    row = make_row(pid_bytes=pid, name="Bamboo", created_at=now)

    class BadConnRestore:
        def __init__(self, cursor):
            self._real_cursor = cursor
            self.closed = False

        @property
        def _cursor(self):
            raise RuntimeError("no cursor property access")

        def cursor(self):
            return self._real_cursor

        def close(self):
            self.closed = True

    real_cursor = FakeCursor(rows=[row])
    fake_conn = BadConnRestore(real_cursor)

    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    # Should not raise during restore attempt
    items = PlantsList.fetch_all()
    assert len(items) == 1


def test_fetch_all_restore_params_branch_coverage(monkeypatch):
    # Cover branches 236->238, 238->242
    # 236->238: _main_query_params is not None
    # 238->242: _main_query_sql is None (if we make it None)
    now = datetime.utcnow()
    pid = bytes.fromhex("aa" * 16)
    row = make_row(pid_bytes=pid, name="Palm", created_at=now)

    class SqlFailCursor(FakeCursor):
        @property
        def last_query(self):
            raise AttributeError("no query")

        @last_query.setter
        def last_query(self, v):
            pass

    fake_cursor = SqlFailCursor(rows=[row])

    class FixedConn(FakeConnection):
        def __init__(self, cursor):
            self._cursor = cursor
            self.closed = False

        def cursor(self):
            return self._cursor

    fake_conn = FixedConn(fake_cursor)
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    items = PlantsList.fetch_all(min_water_loss_total_pct=5.0)
    assert len(items) == 1


# --- Tests for search filtering in fetch_all (lines 66-81) ---


def test_fetch_all_search_numeric_threshold(monkeypatch):
    """Test search with numeric value triggers threshold filter (lines 66-71)."""
    now = datetime.utcnow()
    pid = bytes.fromhex("cc" * 16)
    row = make_row_full(pid_bytes=pid, name="Fern", recommended_water_threshold_pct=0.3)
    fake_conn = FakeConnection(rows=[row])

    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    items = PlantsList.fetch_all(search="0.5")

    assert len(items) == 1
    assert 0.5 in fake_conn._cursor.last_params
    assert "AND p.recommended_water_threshold_pct <= %s" in fake_conn._cursor.last_query


def test_fetch_all_search_text_pattern(monkeypatch):
    """Test search with text value triggers LIKE search (lines 72-81)."""
    now = datetime.utcnow()
    pid = bytes.fromhex("dd" * 16)
    row = make_row_full(pid_bytes=pid, name="Monstera", notes="tropical plant")
    fake_conn = FakeConnection(rows=[row])

    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    items = PlantsList.fetch_all(search="tropical")

    assert len(items) == 1
    assert "%tropical%" in fake_conn._cursor.last_params
    assert "p.name LIKE %s" in fake_conn._cursor.last_query
    assert "p.notes LIKE %s" in fake_conn._cursor.last_query
    assert "l.name LIKE %s" in fake_conn._cursor.last_query
    assert "p.identify_hint LIKE %s" in fake_conn._cursor.last_query


def test_fetch_all_search_empty_string(monkeypatch):
    """Test search with empty/whitespace string is ignored."""
    now = datetime.utcnow()
    pid = bytes.fromhex("ee" * 16)
    row = make_row_full(pid_bytes=pid, name="Cactus")
    fake_conn = FakeConnection(rows=[row])

    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    items = PlantsList.fetch_all(search="   ")

    assert len(items) == 1
    # No search params should be added
    assert fake_conn._cursor.last_params == []


def test_fetch_all_with_pagination(monkeypatch):
    """Test fetch_all with limit and offset for pagination (lines 87-88)."""
    now = datetime.utcnow()
    pid = bytes.fromhex("ff" * 16)
    row = make_row_full(pid_bytes=pid, name="Paginated Plant")
    fake_conn = FakeConnection(rows=[row])

    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    items = PlantsList.fetch_all(limit=10, offset=5)

    assert len(items) == 1
    assert "LIMIT %s OFFSET %s" in fake_conn._cursor.last_query
    assert 10 in fake_conn._cursor.last_params
    assert 5 in fake_conn._cursor.last_params


# --- Tests for count_all method (lines 292-344) ---


def test_count_all_basic(monkeypatch):
    """Test count_all returns correct count (lines 301-315, 337-339)."""
    fake_conn = FakeConnection(count_result=5)

    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    count = PlantsList.count_all()

    assert count == 5
    assert fake_conn.closed is True
    assert "SELECT COUNT(*)" in fake_conn._cursor.last_query


def test_count_all_with_min_water_loss_filter(monkeypatch):
    """Test count_all with min_water_loss_total_pct filter (lines 316-318)."""
    fake_conn = FakeConnection(count_result=3)

    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    count = PlantsList.count_all(min_water_loss_total_pct=15.0)

    assert count == 3
    assert 15.0 in fake_conn._cursor.last_params
    assert "AND latest_pm.water_loss_total_pct > %s" in fake_conn._cursor.last_query


def test_count_all_search_numeric_threshold(monkeypatch):
    """Test count_all search with numeric value (lines 321-326)."""
    fake_conn = FakeConnection(count_result=2)

    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    count = PlantsList.count_all(search="0.4")

    assert count == 2
    assert 0.4 in fake_conn._cursor.last_params
    assert "AND p.recommended_water_threshold_pct <= %s" in fake_conn._cursor.last_query


def test_count_all_search_text_pattern(monkeypatch):
    """Test count_all search with text value (lines 327-335)."""
    fake_conn = FakeConnection(count_result=4)

    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    count = PlantsList.count_all(search="kitchen")

    assert count == 4
    assert "%kitchen%" in fake_conn._cursor.last_params
    assert "p.name LIKE %s" in fake_conn._cursor.last_query


def test_count_all_search_empty_string(monkeypatch):
    """Test count_all with empty search string is ignored."""
    fake_conn = FakeConnection(count_result=10)

    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    count = PlantsList.count_all(search="  ")

    assert count == 10
    assert fake_conn._cursor.last_params == []


def test_count_all_close_exception(monkeypatch):
    """Test count_all handles close() exception gracefully (lines 341-344)."""

    class BadCloseConnection(FakeConnection):
        def close(self):
            raise RuntimeError("close failed")

    fake_conn = BadCloseConnection(count_result=7)

    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    # Should not raise, exception is caught
    count = PlantsList.count_all()
    assert count == 7


def test_count_all_fetchone_none(monkeypatch):
    """Test count_all returns 0 when fetchone returns None (line 339)."""

    class NullCursor(FakeCursor):
        def fetchone(self):
            return None

    class NullConnection(FakeConnection):
        def __init__(self):
            self._cursor = NullCursor()
            self.closed = False

    fake_conn = NullConnection()

    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    count = PlantsList.count_all()
    assert count == 0


def test_fetch_all_status_archived(monkeypatch):
    """Test fetch_all with status='archived' (line 63)."""
    fake_conn = FakeConnection(rows=[])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    PlantsList.fetch_all(status="archived")
    assert "AND p.archive = 1" in fake_conn._cursor.last_query


def test_count_all_status_archived(monkeypatch):
    """Test count_all with status='archived' (lines 327-328)."""
    fake_conn = FakeConnection(count_result=0)
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    PlantsList.count_all(status="archived")
    assert "AND p.archive = 1" in fake_conn._cursor.last_query


def test_count_all_status_all(monkeypatch):
    """Test count_all with status not active/archived (line 327->329)."""
    fake_conn = FakeConnection(count_result=1)
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    PlantsList.count_all(status="all")
    # Verify neither archive=0 nor archive=1 was added
    assert "AND p.archive = 0" not in fake_conn._cursor.last_query
    assert "AND p.archive = 1" not in fake_conn._cursor.last_query


def test_fetch_all_vacation_mode_full(monkeypatch):
    """Test vacation mode and projection (lines 212-243)."""
    now = datetime.utcnow()
    pid = bytes.fromhex("cc" * 16)
    row = make_row(pid_bytes=pid, name="Vacation Plant", created_at=now)

    # We want last_watering_at to be now - 2 days
    last_watering = now - timedelta(days=2)

    class MultiCursor(FakeCursor):
        def __init__(self, rows):
            super().__init__(rows)
            self._call_count = 0

        def fetchone(self):
            self._call_count += 1
            if self._call_count == 1:  # inner query for last_watering_at
                return (last_watering,)
            return (0,)

    class MultiConn(FakeConnection):
        def __init__(self, rows):
            self._cursor = MultiCursor(rows)
            self.closed = False

    fake_conn = MultiConn(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda *args, **kwargs: (7, 1))

    # Test vacation mode
    items = PlantsList.fetch_all(mode="vacation", default_threshold=50.0)
    assert items[0]["water_retained_pct"] is not None
    assert items[0]["next_watering_at"] is not None


def test_fetch_all_projection_exception(monkeypatch):
    """Trigger exception in projection (line 240)."""
    now = datetime.utcnow()
    pid = bytes.fromhex("dd" * 16)
    row = make_row(pid_bytes=pid, name="Fail Plant", created_at=now)

    class FailCursor(FakeCursor):
        def fetchone(self):
            # Returning something that will fail in subtraction or similar
            return (object(),)

    class MultiConn(FakeConnection):
        def __init__(self, rows):
            self._cursor = FailCursor(rows)
            self.closed = False

    fake_conn = MultiConn(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda *args, **kwargs: (7, 1))

    items = PlantsList.fetch_all()
    assert items[0]["next_watering_at"] is None


def test_fetch_all_close_exception(monkeypatch):
    """Test fetch_all handles close() exception (lines 298-299)."""

    class BadCloseConn(FakeConnection):
        def close(self):
            raise RuntimeError("close failed")

    fake_conn = BadCloseConn(rows=[])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    # Should not raise
    PlantsList.fetch_all()


def test_fetch_all_no_cursor_attr(monkeypatch):
    """Cover line 287->294 branch."""

    class NoCursorConn:
        def cursor(self):
            return FakeCursor(rows=[])

        def close(self):
            pass

    fake_conn = NoCursorConn()
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    PlantsList.fetch_all()
