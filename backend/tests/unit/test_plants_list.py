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
    last_dry_weight_g: float | None = 100.0,
    last_wet_weight_g: float | None = 200.0,
    water_loss_total_pct: float | None = 50.0,
    archive: int = 0,
    sort_order: int = 0,
    description: str | None = None,
):
    # Full shape (20 columns):
    # 0 id, 1 name, 2 notes, 3 species_name, 4 min_dry, 5 max_water, 6 thr_pct,
    # 7 identify_hint, 8 location_id, 9 location_name, 10 created_at,
    # 11 updated_at, 12 measured_at, 13 measured_weight_g, 14 last_dry_weight_g,
    # 15 last_wet_weight_g, 16 water_loss_total_pct, 17 archive, 18 sort_order,
    # 19 description
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
        last_dry_weight_g,
        last_wet_weight_g,
        water_loss_total_pct,
        archive,
        sort_order,
        description or notes,
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
    # Mock get_last_watering_event_since to return a proper watering event tuple
    # (measured_at, last_dry_weight_g, last_wet_weight_g, water_added_g)
    monkeypatch.setattr(
        pl_mod,
        "get_last_watering_event_since",
        lambda *a, **k: (last_watering, 100.0, 200.0, 50.0),
    )

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


def test_fetch_all_needs_weighing_vacation(monkeypatch):
    """Test needs_weighing_filter in vacation mode (lines 73-77)."""
    from backend.app.helpers import plants_list as pl_mod

    fake_conn = FakeConnection(rows=[])
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    # Case: needs_weighing_filter=True, mode="vacation"
    PlantsList.fetch_all(needs_weighing_filter=True, mode="vacation")
    assert "AND 1=0" in fake_conn._cursor.last_query

    # Case: needs_weighing_filter=False, mode="vacation"
    PlantsList.fetch_all(needs_weighing_filter=False, mode="vacation")
    assert "AND 1=0" not in fake_conn._cursor.last_query


def test_fetch_all_needs_weighing_manual(monkeypatch):
    """Test needs_weighing_filter in manual mode (lines 78-84)."""
    from backend.app.helpers import plants_list as pl_mod

    fake_conn = FakeConnection(rows=[])
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    # Case: needs_weighing_filter=True, mode="manual"
    PlantsList.fetch_all(needs_weighing_filter=True, mode="manual")
    assert (
        "AND (latest_pm.measured_at IS NULL OR latest_pm.measured_at < %s)"
        in fake_conn._cursor.last_query
    )

    # Case: needs_weighing_filter=False, mode="manual"
    PlantsList.fetch_all(needs_weighing_filter=False, mode="manual")
    assert (
        "AND (latest_pm.measured_at IS NOT NULL AND latest_pm.measured_at >= %s)"
        in fake_conn._cursor.last_query
    )


def test_fetch_all_uuids(monkeypatch):
    """Test uuids filter (lines 87-89)."""
    from backend.app.helpers import plants_list as pl_mod

    fake_conn = FakeConnection(rows=[])
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    uuids = ["1234567890abcdef1234567890abcdef", "abcdef1234567890abcdef1234567890"]
    PlantsList.fetch_all(uuids=uuids)
    assert "AND p.id IN (UNHEX(%s), UNHEX(%s))" in fake_conn._cursor.last_query
    assert uuids[0] in fake_conn._cursor.last_params
    assert uuids[1] in fake_conn._cursor.last_params


def test_count_all_needs_weighing_vacation(monkeypatch):
    """Test count_all with needs_weighing_filter in vacation mode (lines 359-363)."""
    from backend.app.helpers import plants_list as pl_mod

    fake_conn = FakeConnection(count_result=0)
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    # Case: needs_weighing_filter=True, mode="vacation"
    PlantsList.count_all(needs_weighing_filter=True, mode="vacation")
    assert "AND 1=0" in fake_conn._cursor.last_query

    # Case: needs_weighing_filter=False, mode="vacation"
    PlantsList.count_all(needs_weighing_filter=False, mode="vacation")
    assert "AND 1=0" not in fake_conn._cursor.last_query


def test_count_all_needs_weighing_manual(monkeypatch):
    """Test count_all with needs_weighing_filter in manual mode (lines 364-370)."""
    from backend.app.helpers import plants_list as pl_mod

    fake_conn = FakeConnection(count_result=0)
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    # Case: needs_weighing_filter=True, mode="manual"
    PlantsList.count_all(needs_weighing_filter=True, mode="manual")
    assert (
        "AND (latest_pm.measured_at IS NULL OR latest_pm.measured_at < %s)"
        in fake_conn._cursor.last_query
    )

    # Case: needs_weighing_filter=False, mode="manual"
    PlantsList.count_all(needs_weighing_filter=False, mode="manual")
    assert (
        "AND (latest_pm.measured_at IS NOT NULL AND latest_pm.measured_at >= %s)"
        in fake_conn._cursor.last_query
    )


def test_count_all_uuids(monkeypatch):
    """Test count_all with uuids filter (lines 373-375)."""
    from backend.app.helpers import plants_list as pl_mod

    fake_conn = FakeConnection(count_result=0)
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    uuids = ["1234567890abcdef1234567890abcdef", "abcdef1234567890abcdef1234567890"]
    PlantsList.count_all(uuids=uuids)
    assert "AND p.id IN (UNHEX(%s), UNHEX(%s))" in fake_conn._cursor.last_query
    assert uuids[0] in fake_conn._cursor.last_params
    assert uuids[1] in fake_conn._cursor.last_params


# --- Tests for non-admin current_user ACL branch in fetch_all (lines 77-83) ---


def test_fetch_all_current_user_non_admin(monkeypatch):
    """Test non-admin current_user adds owner/ACL filter (lines 77-83)."""
    fake_conn = FakeConnection(rows=[])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    current_user = {"id": 7, "global_role": "user"}
    PlantsList.fetch_all(current_user=current_user)
    assert "OR p.location_id IN (" in fake_conn._cursor.last_query
    assert fake_conn._cursor.last_params == [7, 7]


def test_fetch_all_current_user_admin_no_filter(monkeypatch):
    """Admin current_user must not add ACL filter (branch 76->84)."""
    fake_conn = FakeConnection(rows=[])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    current_user = {"id": 7, "global_role": "admin"}
    PlantsList.fetch_all(current_user=current_user)
    assert "OR p.location_id IN (" not in fake_conn._cursor.last_query
    assert fake_conn._cursor.last_params == []


# --- Tests for sort_by handling (lines 143-145) ---


def test_fetch_all_sort_by_desc(monkeypatch):
    """Test valid sort_by with desc direction (lines 143-145)."""
    fake_conn = FakeConnection(rows=[])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    PlantsList.fetch_all(sort_by="name", sort_dir="desc")
    assert "ORDER BY p.name DESC" in fake_conn._cursor.last_query
    assert ", p.sort_order ASC" in fake_conn._cursor.last_query


def test_fetch_all_sort_by_invalid(monkeypatch):
    """Invalid sort_by falls back to default ordering (line 147)."""
    fake_conn = FakeConnection(rows=[])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    PlantsList.fetch_all(sort_by="not_a_column")
    assert "p.sort_order ASC, p.created_at DESC, p.name ASC" in fake_conn._cursor.last_query


# --- Tests for repot snapshot float-conversion exception (lines 238-244) ---


def test_fetch_all_repot_snapshot_float_exception(monkeypatch):
    """Repot snapshot branch where float() conversion raises (lines 238-244)."""
    now = datetime.utcnow()
    pid = bytes.fromhex("11" * 16)
    # measured_weight_g set, last_dry/wet set, water_loss_total_pct None -> repot snapshot
    # Use non-numeric strings so float() raises and except branch is hit.
    row = make_row_full(
        pid_bytes=pid,
        name="Repot",
        measured_at=now,
        measured_weight_g="bad",
        last_dry_weight_g="bad",
        last_wet_weight_g="bad",
        water_loss_total_pct=None,
    )
    fake_conn = FakeConnection(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda *a, **k: (None, 0))
    # Avoid calculate_water_retained receiving non-numeric inputs (it would raise
    # in its own code path); we only want to exercise the float() except at 243-244.
    monkeypatch.setattr(pl_mod, "calculate_water_retained", lambda **k: _NoneRetained())

    items = PlantsList.fetch_all()
    assert len(items) == 1


def test_fetch_all_repot_snapshot_success(monkeypatch):
    """Repot snapshot: plant's min/max weights passed to calculate_water_retained."""
    now = datetime.utcnow()
    pid = bytes.fromhex("66" * 16)
    # measured_weight_g set, last_dry/wet set, water_loss_total_pct None -> repot snapshot.
    row = make_row_full(
        pid_bytes=pid,
        name="RepotOK",
        measured_at=now,
        measured_weight_g=150.0,
        last_dry_weight_g=100.0,
        last_wet_weight_g=200.0,
        water_loss_total_pct=None,
    )
    fake_conn = FakeConnection(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda *a, **k: (None, 0))
    # Capture the effective min/max passed to calculate_water_retained
    captured = {}

    def _capture(**k):
        captured["min_dry"] = k["min_dry_weight_g"]
        captured["max_water"] = k["max_water_weight_g"]
        return _NoneRetained()

    monkeypatch.setattr(pl_mod, "calculate_water_retained", _capture)

    items = PlantsList.fetch_all()
    assert len(items) == 1
    # min_dry_weight_g and max_water_weight_g come from plant table (row[4], row[5])
    assert captured["min_dry"] == 100.0
    assert captured["max_water"] == 200.0


def test_fetch_all_repot_snapshot_non_positive_capacity(monkeypatch):
    """Repot snapshot: derived_capacity_g <= 0 -> effective weights unchanged (branch 240->246)."""
    now = datetime.utcnow()
    pid = bytes.fromhex("aa" * 16)
    # last_wet < last_dry so capacity is negative -> skip override (lines 240->242).
    row = make_row_full(
        pid_bytes=pid,
        name="RepotNeg",
        measured_at=now,
        measured_weight_g=150.0,
        last_dry_weight_g=200.0,
        last_wet_weight_g=100.0,
        water_loss_total_pct=None,
    )
    fake_conn = FakeConnection(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda *a, **k: (None, 0))

    captured = {}

    def _capture(**k):
        captured["min_dry"] = k["min_dry_weight_g"]
        captured["max_water"] = k["max_water_weight_g"]
        return _NoneRetained()

    monkeypatch.setattr(pl_mod, "calculate_water_retained", _capture)

    items = PlantsList.fetch_all()
    assert len(items) == 1
    # effective weights unchanged (original 100.0 / 200.0 from make_row_full)
    assert captured["min_dry"] == 100.0
    assert captured["max_water"] == 200.0


# --- Tests for standard_needs_water with None water_retained_pct (lines 340->343, 346) ---


def test_fetch_all_standard_needs_water_none_retained(monkeypatch):
    """water_retained_pct None: needs water True when water_loss != 0 (lines 340-341)."""
    now = datetime.utcnow()
    pid = bytes.fromhex("22" * 16)
    row = make_row_full(
        pid_bytes=pid,
        name="NoRetain",
        measured_at=now,
        measured_weight_g=150.0,
        last_dry_weight_g=100.0,
        last_wet_weight_g=200.0,
        water_loss_total_pct=10.0,
    )
    fake_conn = FakeConnection(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    # Force water_retained_pct to None via calculate_water_retained mock
    monkeypatch.setattr(pl_mod, "calculate_water_retained", lambda **k: _NoneRetained())
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda *a, **k: (None, 0))
    # Mock _check_watering_prediction to return True (simulating low water loss prediction)
    monkeypatch.setattr(pl_mod.PlantsList, "_check_watering_prediction", lambda *a, **k: True)

    items = PlantsList.fetch_all(default_threshold=None)
    assert items[0]["needs_water"] is True


def test_fetch_all_standard_needs_water_zero_loss_suppresses(monkeypatch):
    """water_loss_total_pct == 0 suppresses needs_water even if retained None (line 346)."""
    now = datetime.utcnow()
    pid = bytes.fromhex("33" * 16)
    row = make_row_full(
        pid_bytes=pid,
        name="ZeroLoss",
        measured_at=now,
        measured_weight_g=150.0,
        last_dry_weight_g=100.0,
        last_wet_weight_g=200.0,
        water_loss_total_pct=0,
    )
    fake_conn = FakeConnection(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "calculate_water_retained", lambda **k: _NoneRetained())
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda *a, **k: (None, 0))

    items = PlantsList.fetch_all(default_threshold=None)
    assert items[0]["needs_water"] is False


class _NoneRetained:
    water_retained_pct = None


# --- Tests for vacation needs_water branches (lines 356-366) ---


def test_fetch_all_vacation_needs_water_days_offset(monkeypatch):
    """Vacation: days_offset <= 0 sets needs_water True (line 357)."""
    now = datetime.utcnow()
    pid = bytes.fromhex("44" * 16)
    row = make_row(pid_bytes=pid, name="Vac", created_at=now)

    # Far enough in the past that first_calculated_at is in the past -> days_offset <= 0
    last_watering = now - timedelta(days=10)

    class VacCursor(FakeCursor):
        def __init__(self, rows):
            super().__init__(rows)
            self._call_count = 0

        def fetchone(self):
            self._call_count += 1
            if self._call_count == 1:
                return (last_watering,)
            return (0,)

    class VacConn(FakeConnection):
        def __init__(self, rows):
            self._cursor = VacCursor(rows)
            self.closed = False

    fake_conn = VacConn(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda *a, **k: (7, 1))
    monkeypatch.setattr(pl_mod, "calculate_water_retained", lambda **k: _LowRetained())

    items = PlantsList.fetch_all(mode="vacation", default_threshold=50.0)
    assert items[0]["needs_water"] is True


def test_fetch_all_vacation_needs_water_retained_threshold(monkeypatch):
    """Vacation: days_offset None, retained <= threshold sets needs_water (lines 359-366)."""
    now = datetime.utcnow()
    pid = bytes.fromhex("55" * 16)
    # No last_watering_at -> fetchone returns (0,) so last_watering_at = None,
    # days_offset stays None, branch 359->370.
    row = make_row(pid_bytes=pid, name="Vac2", created_at=now)

    class Vac2Cursor(FakeCursor):
        def fetchone(self):
            return (0,)

    class Vac2Conn(FakeConnection):
        def __init__(self, rows):
            self._cursor = Vac2Cursor(rows)
            self.closed = False

    fake_conn = Vac2Conn(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    # freq_days None keeps days_offset None; retained below threshold -> needs water
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda *a, **k: (None, 0))
    monkeypatch.setattr(pl_mod, "calculate_water_retained", lambda **k: _LowRetained())

    items = PlantsList.fetch_all(mode="vacation", default_threshold=50.0)
    assert items[0]["needs_water"] is True


class _LowRetained:
    water_retained_pct = 10.0


# --- Tests for exception in fetch_all main try (lines 422-423) ---


def test_fetch_all_execute_exception(monkeypatch):
    """Exception in main query execute returns [] (lines 422-423)."""

    class BoomCursor(FakeCursor):
        def execute(self, query, params=None):
            raise RuntimeError("boom")

    class BoomConn(FakeConnection):
        def __init__(self):
            self._cursor = BoomCursor()
            self.closed = False

    fake_conn = BoomConn()
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    items = PlantsList.fetch_all()
    assert items == []


# --- Tests for _check_watering_prediction paths (lines 447-542) ---


def _repot_item(measured_at: str):
    from backend.app.schemas.measurement import MeasurementItem

    return MeasurementItem(
        id="11" * 16,
        measured_at=measured_at,
        measured_weight_g=None,
        last_dry_weight_g=None,
        last_wet_weight_g=None,
        water_added_g=None,
        water_loss_total_pct=None,
        water_loss_total_g=None,
        water_loss_day_pct=None,
        water_loss_day_g=None,
    )


class PredictionCursor(FakeCursor):
    """Configurable cursor for _check_watering_prediction sequencing."""

    def __init__(self, rows=None, weight_rows=None, repot_at=None):
        super().__init__(rows)
        self._weight_rows = weight_rows or []
        self._repot_at = repot_at
        self._state = 0

    def fetchone(self):
        # Call 1: get_last_repotting_event (handled in test via monkeypatch)
        # Calls come from _check_watering_prediction inner cursors:
        #   a) repot branch: SELECT measured_at ... water_added_g > 0 (fetchone)
        #   b) final: SELECT measured_at, measured_weight_g (fetchall -> rows)
        self._state += 1
        if self._state == 1:
            return (self._repot_at,) if self._repot_at else None
        return (0,)

    def fetchall(self):
        return list(self._weight_rows)


def test_check_watering_prediction_no_repot_created_at(monkeypatch):
    """No repot: falls back to plant created_at; rows < 2 -> False (lines 438-445, 489-490)."""
    from backend.app.helpers import plants_list as pl_mod

    fake_conn = FakeConnection(rows=[])
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "get_last_repotting_event", lambda *a, **k: None)

    result = PlantsList._check_watering_prediction(fake_conn, "11" * 16)
    assert result is False


def test_check_watering_prediction_no_repot_truthy_created_at(monkeypatch):
    """No repot, created_at is a real datetime -> falls through 444 to weight query (444->475)."""
    now = datetime.utcnow()
    from backend.app.helpers import plants_list as pl_mod

    class TruthyCreatedCursor(FakeCursor):
        def fetchone(self):
            # First call: created_at query returns a real datetime (truthy)
            # We only need it to be truthy; weight rows returned below are < 2.
            return (now - timedelta(days=30),)

        def fetchall(self):
            return [(now - timedelta(days=1), 200.0)]

    class TruthyCreatedConn(FakeConnection):
        def __init__(self):
            self._cursor = TruthyCreatedCursor()
            self.closed = False

    fake_conn = TruthyCreatedConn()
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "get_last_repotting_event", lambda *a, **k: None)

    result = PlantsList._check_watering_prediction(fake_conn, "11" * 16)
    assert result is False


def test_check_watering_prediction_no_reference(monkeypatch):
    """No repot and created_at row None -> returns False (lines 443-445)."""

    class NoRefCursor(FakeCursor):
        def fetchone(self):
            return None

    class NoRefConn(FakeConnection):
        def __init__(self):
            self._cursor = NoRefCursor()
            self.closed = False

    fake_conn = NoRefConn()
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "get_last_repotting_event", lambda *a, **k: None)

    result = PlantsList._check_watering_prediction(fake_conn, "11" * 16)
    assert result is False


def test_check_watering_prediction_repot_watering_since(monkeypatch):
    """Repot exists; watering-since query returns row; weights < 2 -> False (lines 446-472, 489-490)."""
    now = datetime.utcnow()
    from backend.app.helpers import plants_list as pl_mod

    class RepotCursor(FakeCursor):
        def __init__(self):
            super().__init__([])
            self._state = 0

        def fetchone(self):
            self._state += 1
            # call 1: watering since repot (returns a row -> ref_at updated)
            if self._state == 1:
                return (now - timedelta(days=1),)
            # call 2: weight measurements fetchall -> returns empty
            return (0,)

        def fetchall(self):
            return []

    class RepotConn(FakeConnection):
        def __init__(self):
            self._cursor = RepotCursor()
            self.closed = False

    fake_conn = RepotConn()
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(
        pl_mod, "get_last_repotting_event", lambda *a, **k: _repot_item("2024-01-01 10:00:00")
    )

    result = PlantsList._check_watering_prediction(fake_conn, "11" * 16)
    assert result is False


def test_check_watering_prediction_check1_losing(monkeypatch):
    """Losing < 2g/day for 2 consecutive intervals -> True (lines 508-513)."""
    now = datetime.utcnow()
    from backend.app.helpers import plants_list as pl_mod

    weights = [
        (now - timedelta(days=3), 200.0),
        (now - timedelta(days=2), 199.0),
        (now - timedelta(days=1), 198.0),
    ]

    class C1Cursor(FakeCursor):
        def fetchone(self):
            return (0,)

        def fetchall(self):
            return weights

    class C1Conn(FakeConnection):
        def __init__(self):
            self._cursor = C1Cursor()
            self.closed = False

    fake_conn = C1Conn()
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(
        pl_mod, "get_last_repotting_event", lambda *a, **k: _repot_item("2024-01-01 10:00:00")
    )

    result = PlantsList._check_watering_prediction(fake_conn, "11" * 16)
    assert result is True


def test_check_watering_prediction_no_losses(monkeypatch):
    """delta_t <= 0 for all intervals -> losses empty -> False (lines 501-504)."""
    now = datetime.utcnow()
    from backend.app.helpers import plants_list as pl_mod

    # Identical timestamps -> delta_t == 0 -> no loss appended
    weights = [
        (now, 200.0),
        (now, 198.0),
    ]

    class NLCursor(FakeCursor):
        def fetchone(self):
            return (0,)

        def fetchall(self):
            return weights

    class NLConn(FakeConnection):
        def __init__(self):
            self._cursor = NLCursor()
            self.closed = False

    fake_conn = NLConn()
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(
        pl_mod, "get_last_repotting_event", lambda *a, **k: _repot_item("2024-01-01 10:00:00")
    )

    result = PlantsList._check_watering_prediction(fake_conn, "11" * 16)
    assert result is False


def test_check_watering_prediction_check2_threshold(monkeypatch):
    """Consecutive loss < 33% avg for > 2 intervals -> True (lines 518-538)."""
    now = datetime.utcnow()
    from backend.app.helpers import plants_list as pl_mod

    # 7 rows -> 6 intervals: losses [3, 3, 3, 50, 50, 3].
    # check1 (loss < 2) never triggers; remaining (drop min 3, max 50)
    # avg ~14.75 -> threshold2 ~4.87; first three 3.0 < 4.87 -> returns True.
    weights = [
        (now - timedelta(days=6), 100.0),
        (now - timedelta(days=5), 97.0),
        (now - timedelta(days=4), 94.0),
        (now - timedelta(days=3), 91.0),
        (now - timedelta(days=2), 41.0),
        (now - timedelta(days=1), -9.0),
        (now - timedelta(days=0), -12.0),
    ]

    class C2Cursor(FakeCursor):
        def fetchone(self):
            return (0,)

        def fetchall(self):
            return weights

    class C2Conn(FakeConnection):
        def __init__(self):
            self._cursor = C2Cursor()
            self.closed = False

    fake_conn = C2Conn()
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(
        pl_mod, "get_last_repotting_event", lambda *a, **k: _repot_item("2024-01-01 10:00:00")
    )

    result = PlantsList._check_watering_prediction(fake_conn, "11" * 16)
    assert result is True


def test_check_watering_prediction_repot_no_watering_since(monkeypatch):
    """Repot exists but watering-since query returns None -> ref_at stays repot (lines 444->446, 471->475)."""
    now = datetime.utcnow()
    from backend.app.helpers import plants_list as pl_mod

    class RepotNoSinceCursor(FakeCursor):
        def fetchone(self):
            # watering-since query returns None -> ref_at stays repot_at
            return None

        def fetchall(self):
            # Not enough weight rows to predict -> False
            return [(now - timedelta(days=1), 200.0)]

    class RepotNoSinceConn(FakeConnection):
        def __init__(self):
            self._cursor = RepotNoSinceCursor()
            self.closed = False

    fake_conn = RepotNoSinceConn()
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(
        pl_mod, "get_last_repotting_event", lambda *a, **k: _repot_item("2024-01-01 10:00:00")
    )

    result = PlantsList._check_watering_prediction(fake_conn, "11" * 16)
    assert result is False


def test_fetch_all_standard_needs_water_retained_not_none_thresh_none(monkeypatch):
    """retained not None but thresh_val None -> needs_water stays False (line 340->343)."""
    now = datetime.utcnow()
    pid = bytes.fromhex("77" * 16)
    row = make_row_full(
        pid_bytes=pid,
        name="RetainNoThresh",
        measured_at=now,
        measured_weight_g=150.0,
        last_dry_weight_g=100.0,
        last_wet_weight_g=200.0,
        water_loss_total_pct=10.0,
        recommended_water_threshold_pct=None,
    )
    fake_conn = FakeConnection(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "calculate_water_retained", lambda **k: _LowRetained())
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda *a, **k: (None, 0))

    items = PlantsList.fetch_all(default_threshold=None)
    assert items[0]["needs_water"] is False


def test_fetch_all_vacation_retained_thresh_none(monkeypatch):
    """Vacation: days_offset None, retained not None, vac_thresh None -> skip (line 359->370)."""
    now = datetime.utcnow()
    pid = bytes.fromhex("88" * 16)
    row = make_row(pid_bytes=pid, name="Vac3", created_at=now)

    class V3Cursor(FakeCursor):
        def fetchone(self):
            return (0,)

    class V3Conn(FakeConnection):
        def __init__(self, rows):
            self._cursor = V3Cursor(rows)
            self.closed = False

    fake_conn = V3Conn(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda *a, **k: (None, 0))
    monkeypatch.setattr(pl_mod, "calculate_water_retained", lambda **k: _LowRetained())

    # default_threshold None and rec threshold None -> vac_thresh None
    items = PlantsList.fetch_all(mode="vacation", default_threshold=None)
    assert items[0]["needs_water"] is False


def test_fetch_all_vacation_retained_threshold_set(monkeypatch):
    """Vacation: days_offset None, retained not None, vac_thresh set -> needs_water (lines 365->370)."""
    now = datetime.utcnow()
    pid = bytes.fromhex("99" * 16)
    row = make_row(pid_bytes=pid, name="Vac4", created_at=now)

    class V4Cursor(FakeCursor):
        def fetchone(self):
            return (0,)

    class V4Conn(FakeConnection):
        def __init__(self, rows):
            self._cursor = V4Cursor(rows)
            self.closed = False

    fake_conn = V4Conn(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda *a, **k: (None, 0))
    monkeypatch.setattr(pl_mod, "calculate_water_retained", lambda **k: _LowRetained())

    # retained 10.0 <= default_threshold 50.0 -> needs_water True
    items = PlantsList.fetch_all(mode="vacation", default_threshold=50.0)
    assert items[0]["needs_water"] is True


def test_fetch_all_vacation_retained_none(monkeypatch):
    """Vacation: days_offset None, retained None -> else branch sets needs_water=standard (359 false arc)."""
    now = datetime.utcnow()
    pid = bytes.fromhex("ab" * 16)
    row = make_row(pid_bytes=pid, name="Vac5", created_at=now)

    class V5Cursor(FakeCursor):
        def fetchone(self):
            return (0,)

    class V5Conn(FakeConnection):
        def __init__(self, rows):
            self._cursor = V5Cursor(rows)
            self.closed = False

    fake_conn = V5Conn(rows=[row])
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda *a, **k: (None, 0))
    monkeypatch.setattr(pl_mod, "calculate_water_retained", lambda **k: _NoneRetained())

    items = PlantsList.fetch_all(mode="vacation", default_threshold=50.0)
    assert items[0]["needs_water"] is False


def test_check_watering_prediction_few_rows_threshold(monkeypatch):
    """rows <= 4 path uses sum(losses)/len(losses); no consecutive trigger -> False (lines 526-527, 529-538)."""
    now = datetime.utcnow()
    from backend.app.helpers import plants_list as pl_mod

    # 3 rows -> 2 intervals, losses large enough not to trigger threshold2
    weights = [
        (now - timedelta(days=3), 200.0),
        (now - timedelta(days=2), 150.0),
        (now - timedelta(days=1), 100.0),
    ]

    class FRCursor(FakeCursor):
        def fetchone(self):
            return (0,)

        def fetchall(self):
            return weights

    class FRConn(FakeConnection):
        def __init__(self):
            self._cursor = FRCursor()
            self.closed = False

    fake_conn = FRConn()
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(
        pl_mod, "get_last_repotting_event", lambda *a, **k: _repot_item("2024-01-01 10:00:00")
    )

    result = PlantsList._check_watering_prediction(fake_conn, "11" * 16)
    assert result is False


def test_check_watering_prediction_exception(monkeypatch):
    """Exception during prediction returns False (lines 541-542)."""
    from backend.app.helpers import plants_list as pl_mod

    fake_conn = FakeConnection(rows=[])
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(
        pl_mod,
        "get_last_repotting_event",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")),
    )

    result = PlantsList._check_watering_prediction(fake_conn, "11" * 16)
    assert result is False


# --- Test for count_all non-admin ACL branch (lines 579-585) ---


def test_count_all_current_user_non_admin(monkeypatch):
    """count_all non-admin user adds ACL filter (lines 579-585)."""
    fake_conn = FakeConnection(count_result=3)
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    current_user = {"id": 9, "global_role": "user"}
    count = PlantsList.count_all(current_user=current_user)
    assert count == 3
    assert "OR p.location_id IN (" in fake_conn._cursor.last_query
    assert fake_conn._cursor.last_params == [9, 9]


def test_count_all_current_user_admin(monkeypatch):
    """count_all admin user adds no ACL filter (branch 578->576)."""
    fake_conn = FakeConnection(count_result=4)
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    current_user = {"id": 9, "global_role": "admin"}
    count = PlantsList.count_all(current_user=current_user)
    assert count == 4
    assert "OR p.location_id IN (" not in fake_conn._cursor.last_query


# --- Test for count_all execute exception (lines 634-635) ---


def test_count_all_execute_exception(monkeypatch):
    """Exception in count_all execute returns 0 (lines 634-635)."""

    class BoomCursor(FakeCursor):
        def execute(self, query, params=None):
            raise RuntimeError("boom")

    class BoomConn(FakeConnection):
        def __init__(self):
            self._cursor = BoomCursor()
            self.closed = False

    fake_conn = BoomConn()
    from backend.app.helpers import plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    count = PlantsList.count_all()
    assert count == 0
