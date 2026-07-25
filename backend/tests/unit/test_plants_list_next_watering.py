from datetime import datetime, timedelta
import pytest
from backend.app.helpers.plants_list import PlantsList

class FakeCursor:
    def __init__(self, rows=None, last_watering_at: datetime | None = None, execute_raises: bool = False):
        self._default_rows = list(rows or [])
        self._last_watering_at = last_watering_at
        self._execute_raises = execute_raises
        self.last_query = None
        self.last_params = None
        self._responses = [] # List of (substring, result)

    def add_response(self, substring, result):
        self._responses.append((substring, result))

    def __enter__(self): return self
    def __exit__(self, exc_type, exc, tb): return False

    def execute(self, query, params=None):
        if self._execute_raises:
            raise RuntimeError("db error")
        self.last_query = query
        self.last_params = list(params or [])

    def fetchall(self):
        for sub, res in self._responses:
            if sub in self.last_query or sub.strip() in self.last_query:
                return res
        return list(self._default_rows)

    def fetchone(self):
        for sub, res in self._responses:
            if sub in self.last_query or sub.strip() in self.last_query:
                return res[0] if isinstance(res, list) and res else res
        return (self._last_watering_at,) if self._last_watering_at is not None else None

class FakeConn:
    def __init__(self, cursor: FakeCursor):
        self._cursor = cursor
        self.closed = False
    def cursor(self): return self._cursor
    def close(self): self.closed = True

def _row(pid, name, loc_id, created, measured, loss=None):
    return (pid, name, None, None, loc_id, None, created, measured, loss)

def _full_row(pid, name, min_dry=100.0, max_water=50.0, thr_pct=40.0, created=None, measured=None, weight=None, loss=None, archive=0):
    return (pid, name, "notes", "species", min_dry, max_water, thr_pct, "hint", None, "loc", created, created, measured, weight, min_dry, min_dry+max_water, loss, archive, 0, "desc")

@pytest.fixture(autouse=True)
def mock_external_helpers(monkeypatch):
    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "get_last_repotting_event", lambda c, u: None)
    return None

def test_next_watering_projection_and_roll_forward(monkeypatch):
    now = datetime.utcnow()
    pid = bytes.fromhex("ab" * 16)
    last_watering_at = now - timedelta(days=10)
    freq_days = 3
    rows = [_row(pid, "Fern", None, now - timedelta(days=20), now - timedelta(days=1), 5.0)]
    cursor = FakeCursor(rows=rows, last_watering_at=last_watering_at)
    fake_conn = FakeConn(cursor)
    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: (freq_days, 5))
    # Mock get_last_watering_event_since to return a tuple (measured_at, last_dry_weight_g, last_wet_weight_g, water_added_g)
    monkeypatch.setattr(pl_mod, "get_last_watering_event_since", lambda c, u: (last_watering_at, None, None, 100.0))
    items = PlantsList.fetch_all()
    assert items[0]["next_watering_at"] == last_watering_at + timedelta(days=freq_days)

def test_next_watering_math_exception_yields_none(monkeypatch):
    now = datetime.utcnow()
    pid = bytes.fromhex("cd" * 16)
    rows = [_row(pid, "Palm", None, now - timedelta(days=30), now - timedelta(days=1), 7.0)]
    cursor = FakeCursor(rows=rows, last_watering_at=now - timedelta(days=10))
    fake_conn = FakeConn(cursor)
    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: (3, 3))
    def _boom(*args, **kwargs): raise ValueError("boom")
    monkeypatch.setattr(pl_mod, "timedelta", _boom)
    items = PlantsList.fetch_all()
    assert items[0]["next_watering_at"] is None

def test_next_watering_projection_future_no_roll_forward(monkeypatch):
    now = datetime.utcnow()
    pid = bytes.fromhex("aa" * 16)
    last_at = now - timedelta(days=1)
    rows = [_row(pid, "ZZ", None, now-timedelta(days=3), now-timedelta(days=1), 3.0)]
    cursor = FakeCursor(rows=rows, last_watering_at=last_at)
    fake_conn = FakeConn(cursor)
    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: (10, 10))
    # Mock get_last_watering_event_since to return the last watering event
    monkeypatch.setattr(pl_mod, "get_last_watering_event_since", lambda c, u: (last_at, None, 100.0, 50.0))
    items = PlantsList.fetch_all()
    assert items[0]["next_watering_at"] == last_at + timedelta(days=10)

def test_next_watering_db_exception_yields_none(monkeypatch):
    now = datetime.utcnow()
    cursor = FakeCursor(rows=[_row(bytes.fromhex("ef"*16), "P", None, now, now)])
    class TwoCursorConn():
        def __init__(self): self.count = 0
        def cursor(self):
            self.count += 1
            if self.count == 2: return FakeCursor(execute_raises=True)
            return cursor
        def close(self): pass
    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "get_conn", lambda: TwoCursorConn())
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: (5, 5))
    items = PlantsList.fetch_all()
    assert items[0]["next_watering_at"] is None

def test_next_watering_fallback_last_watering_exception(monkeypatch):
    now = datetime.utcnow()
    cursor = FakeCursor(rows=[_row(bytes.fromhex("11"*16), "P", None, now, now)])
    def _boom(*args, **kwargs): raise RuntimeError("fail")
    class MultiCursorConn(FakeConn):
        def __init__(self, main_cursor):
            super().__init__(main_cursor)
            self.count = 0
        def cursor(self):
            self.count += 1
            if self.count == 2:
                c = FakeCursor()
                c.execute = _boom
                return c
            return self._cursor
    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "get_conn", lambda: MultiCursorConn(cursor))
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: (5, 1))
    items = PlantsList.fetch_all()
    assert items[0]["next_watering_at"] is None

def test_next_watering_calculation_exception_resets_values(monkeypatch):
    now = datetime.utcnow()
    cursor = FakeCursor(rows=[_row(bytes.fromhex("12"*16), "Ivy", None, now, now, 2.0)])
    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: (5, 2))
    def _bad_td(*args, **kwargs): raise ValueError("err")
    monkeypatch.setattr(pl_mod, "timedelta", _bad_td)
    items = PlantsList.fetch_all()
    assert items[0]["next_watering_at"] is None

def test_next_watering_vacation_mode_decay(monkeypatch):
    now = datetime.utcnow()
    pid = bytes.fromhex("dd" * 16)
    last_at = now - timedelta(days=5)
    row = (pid, "Ivy", None, None, None, None, 30.0, None, None, None, now-timedelta(days=20), now-timedelta(days=7), now-timedelta(days=5), None, None, None, 0.0, 0, 0, None)
    cursor = FakeCursor(rows=[row], last_watering_at=last_at)
    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: (10, 5))
    # Mock get_last_watering_event_since to return a tuple (measured_at, last_dry_weight_g, last_wet_weight_g, water_added_g)
    monkeypatch.setattr(pl_mod, "get_last_watering_event_since", lambda c, u: (last_at, None, None, 100.0))
    items = PlantsList.fetch_all(mode="vacation")
    assert items[0]["water_retained_pct"] == 65.0

def test_check_watering_prediction_all_cases(monkeypatch):
    now = datetime.utcnow().replace(microsecond=0)
    pid = bytes.fromhex("11" * 16)
    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: (None, 0))
    
    # Case: Repotting exists
    cursor = FakeCursor(rows=[_full_row(pid, "P1", created=now, measured=now, weight=145)])
    fake_repot = type('obj', (object,), {'measured_at': (now - timedelta(days=5)).isoformat()})
    monkeypatch.setattr(pl_mod, "get_last_repotting_event", lambda c, u: fake_repot)
    cursor.add_response("SELECT measured_at FROM plants_measurements", [(now - timedelta(days=4),)]) # last watering
    cursor.add_response("SELECT measured_at, measured_weight_g", [(now-timedelta(days=2), 100), (now-timedelta(days=1), 99), (now, 98.5)])
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    items = PlantsList.fetch_all()
    assert items[0]["needs_watering_prediction"] is True

    # Case: No measurements
    cursor = FakeCursor(rows=[_full_row(pid, "P1", created=now, measured=now, weight=145)])
    monkeypatch.setattr(pl_mod, "get_last_repotting_event", lambda c, u: None)
    cursor.add_response("SELECT created_at", [(now,)])
    cursor.add_response("SELECT measured_at, measured_weight_g", [])
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    items = PlantsList.fetch_all()
    assert items[0]["needs_watering_prediction"] is False

def test_fetch_all_extended_branches(monkeypatch):
    now = datetime.utcnow()
    pid = bytes.fromhex("22" * 16)
    import backend.app.helpers.plants_list as pl_mod
    
    # Test archived, search numeric, sort
    cursor = FakeCursor(rows=[_full_row(pid, "Archived", created=now, measured=now, archive=1)])
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    items = PlantsList.fetch_all(status="archived", search="50", sort_by="name", sort_dir="desc", limit=10, offset=0)
    assert items[0]["archive"] == 1
    assert "p.archive = 1" in cursor.last_query
    assert "ORDER BY p.name DESC" in cursor.last_query

    # Test needs_weighing_filter in manual and vacation
    PlantsList.fetch_all(needs_weighing_filter=True)
    assert "latest_pm.measured_at < %s" in cursor.last_query
    PlantsList.fetch_all(needs_weighing_filter=True, mode="vacation")
    assert "1=0" in cursor.last_query

    # Test ACL
    current_user = {"id": 123, "global_role": "user"}
    PlantsList.fetch_all(current_user=current_user)
    assert "p.owner_id = %s" in cursor.last_query

def test_count_all_comprehensive(monkeypatch):
    cursor = FakeCursor()
    cursor.add_response("SELECT COUNT(*)", [(100,)])
    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    count = PlantsList.count_all(search="foo", status="active", needs_weighing_filter=False, current_user={"id": 1, "global_role": "user"})
    assert count == 100
    assert "p.archive = 0" in cursor.last_query
    assert "p.owner_id = %s" in cursor.last_query

def test_check_watering_prediction_check2(monkeypatch):
    now = datetime.utcnow().replace(microsecond=0)
    pid = bytes.fromhex("44" * 16)
    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: (None, 0))
    monkeypatch.setattr(pl_mod, "get_last_repotting_event", lambda c, u: None)

    # Check 2: losing < 33% of average for more than 2 consecutive intervals
    # Must FAIL Check 1 first (no 2+ consecutive losses < 2)
    # Losses: [10000, 10000, 10000, 5, 5, 5, 5, 10000, 10000]
    # 5 > 2 -> Check 1 False.
    # remaining_losses [10000, 10000, 5, 5, 5, 5, 10000] -> avg ~5003, threshold ~1651
    # Ensure base is significantly after created_at
    base = now - timedelta(days=20)
    created_at = now - timedelta(days=50)
    rows_m = [
        (base + timedelta(days=1), 100000),
        (base + timedelta(days=2), 90000),  # 10000
        (base + timedelta(days=3), 80000),  # 10000
        (base + timedelta(days=4), 70000),  # 10000
        (base + timedelta(days=5), 69995),  # 5
        (base + timedelta(days=6), 69990),  # 5
        (base + timedelta(days=7), 69985),  # 5
        (base + timedelta(days=8), 69980),  # 5
        (base + timedelta(days=9), 59980),  # 10000
        (base + timedelta(days=10), 49980), # 10000
    ]
    cursor = FakeCursor(rows=[_full_row(pid, "P1", created=now, measured=now, weight=145)])
    cursor.add_response("SELECT created_at", [(created_at,)])
    cursor.add_response("SELECT measured_at, measured_weight_g", rows_m)
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    items = PlantsList.fetch_all()
    assert items[0]["needs_watering_prediction"] is True


# --- Tests for exception coverage: lines 230-231, 297-300 ---


def test_fetch_all_get_last_watering_event_since_exception(monkeypatch):
    """Cover lines 230-231: exception in get_last_watering_event_since is caught."""
    now = datetime.utcnow()
    pid = bytes.fromhex("aa" * 16)
    row = _row(pid, "TestPlant", None, now, now, 5.0)
    cursor = FakeCursor(rows=[row])
    fake_conn = FakeConn(cursor)
    import backend.app.helpers.plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    # Mock get_last_watering_event_since to raise an exception
    monkeypatch.setattr(
        pl_mod, "get_last_watering_event_since", lambda c, u: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    # Mock compute_frequency_days to return valid values so we can test the flow
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: (7, 1))

    items = PlantsList.fetch_all()
    assert len(items) == 1
    # When last_watering_ref is None due to exception, water_retained_pct should be None
    assert items[0]["water_retained_pct"] is None


def test_fetch_all_projection_timedelta_exception(monkeypatch):
    """Cover lines 297-300: exception in timedelta projection calculation."""
    now = datetime.utcnow()
    pid = bytes.fromhex("bb" * 16)
    row = _row(pid, "TestPlant", None, now, now, 5.0)
    cursor = FakeCursor(rows=[row])
    fake_conn = FakeConn(cursor)
    import backend.app.helpers.plants_list as pl_mod

    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)
    # Mock get_last_watering_event_since to return a valid watering event tuple
    # (measured_at, last_dry_weight_g, last_wet_weight_g, water_added_g)
    last_watering_at = now - timedelta(days=5)
    monkeypatch.setattr(pl_mod, "get_last_watering_event_since", lambda c, u: (last_watering_at, 100.0, 200.0, 50.0))
    # Mock compute_frequency_days to return valid freq_days
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: (7, 1))
    # Mock timedelta to raise an exception
    def _boom(*args, **kwargs):
        raise ValueError("timedelta boom")

    monkeypatch.setattr(pl_mod, "timedelta", _boom)

    items = PlantsList.fetch_all()
    assert len(items) == 1
    # When projection fails, next_watering_at should be None
    assert items[0]["next_watering_at"] is None
    assert items[0]["first_calculated_at"] is None
    assert items[0]["days_offset"] is None

def test_check_watering_prediction_fail_all(monkeypatch):
    now = datetime.utcnow().replace(microsecond=0)
    pid = bytes.fromhex("88" * 16)
    import backend.app.helpers.plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "compute_frequency_days", lambda c, u: (None, 0))
    monkeypatch.setattr(pl_mod, "get_last_repotting_event", lambda c, u: None)

    # Fail both checks to reach the final return False
    # Losses: [10, 10, 10]
    base = now - timedelta(days=10)
    rows_m = [(base, 100), (base+timedelta(days=1), 90), (base+timedelta(days=2), 80)]
    cursor = FakeCursor(rows=[_full_row(pid, "P1", created=now, measured=now, weight=145)])
    cursor.add_response("SELECT created_at", [(base - timedelta(days=1),)])
    cursor.add_response("FROM plants_measurements WHERE plant_id = UNHEX(%s) AND measured_at > %s AND measured_weight_g IS NOT NULL", rows_m)
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    items = PlantsList.fetch_all()
    assert items[0]["needs_watering_prediction"] is False

def test_fetch_all_search_text_and_exceptions(monkeypatch):
    now = datetime.utcnow()
    pid = bytes.fromhex("55" * 16)
    import backend.app.helpers.plants_list as pl_mod
    
    # Test text search
    cursor = FakeCursor(rows=[_full_row(pid, "Searchable", created=now, measured=now)])
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    PlantsList.fetch_all(search="some text")
    assert "p.name LIKE %s" in cursor.last_query
    
    # Test water_loss_total_pct == 0 branch (lines 343-346)
    # water_loss=0.0, water_retained=100.0 -> standard_needs_water = False
    cursor2 = FakeCursor(rows=[_full_row(pid, "P1", created=now, measured=now, weight=150, loss=0.0)])
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor2))
    items = PlantsList.fetch_all()
    assert items[0]["needs_water"] is False

    # Test vacation mode threshold branch (lines 359-366)
    cursor3 = FakeCursor(rows=[_full_row(pid, "P1", created=now, measured=now, weight=110, loss=20.0)]) # retained (110-100)/50 = 20%
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor3))
    # retained 20% <= threshold 40% -> needs_water = True
    items = PlantsList.fetch_all(mode="vacation")
    assert items[0]["needs_water"] is True

def test_plants_list_count_all_branches(monkeypatch):
    import backend.app.helpers.plants_list as pl_mod
    cursor = FakeCursor()
    cursor.add_response("SELECT COUNT(*)", [(5,)])
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    
    # status="archived", min_water_loss_total_pct, uuids
    PlantsList.count_all(status="archived", min_water_loss_total_pct=5.0, uuids=["aa"*16])
    assert "p.archive = 1" in cursor.last_query
    assert "latest_pm.water_loss_total_pct > %s" in cursor.last_query
    assert "p.id IN (UNHEX(%s))" in cursor.last_query

    # search numeric
    cursor.add_response("SELECT COUNT(*)", [(2,)])
    PlantsList.count_all(search="25")
    assert "p.recommended_water_threshold_pct <= %s" in cursor.last_query

def test_plants_list_exceptions_coverage(monkeypatch):
    import backend.app.helpers.plants_list as pl_mod
    
    # Mock get_conn to return an object that raises when cursor() is called
    class FailingConn:
        def cursor(self): raise RuntimeError("cursor fail")
        def close(self): pass

    monkeypatch.setattr(pl_mod, "get_conn", lambda: FailingConn())
    # count_all should return 0 on exception
    assert PlantsList.count_all() == 0
    # fetch_all should return [] on exception
    assert PlantsList.fetch_all() == []

def test_fetch_all_pagination_and_sort_extended(monkeypatch):
    import backend.app.helpers.plants_list as pl_mod
    now = datetime.utcnow()
    pid = bytes.fromhex("99" * 16)
    cursor = FakeCursor(rows=[_full_row(pid, "P1", created=now, measured=now)])
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    
    # Test limit/offset
    PlantsList.fetch_all(limit=5, offset=10)
    assert "LIMIT %s OFFSET %s" in cursor.last_query
    assert 5 in cursor.last_params
    assert 10 in cursor.last_params
    
    # Test sorting variations
    # The code maps 'location' to 'l.name'
    PlantsList.fetch_all(sort_by="location", sort_dir="asc")
    assert "ORDER BY l.name ASC" in cursor.last_query
    
    # The code maps 'latest_at' to 'latest_pm.measured_at'
    PlantsList.fetch_all(sort_by="latest_at")
    assert "ORDER BY latest_pm.measured_at ASC" in cursor.last_query

    # Test sort_order
    PlantsList.fetch_all(sort_by="sort_order", sort_dir="desc")
    assert "ORDER BY p.sort_order DESC" in cursor.last_query

def test_fetch_all_search_scenarios(monkeypatch):
    import backend.app.helpers.plants_list as pl_mod
    cursor = FakeCursor()
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    
    # Numeric search (threshold)
    PlantsList.fetch_all(search="25")
    assert "p.recommended_water_threshold_pct <= %s" in cursor.last_query
    
    # Text search
    PlantsList.fetch_all(search="some text")
    assert "p.name LIKE %s" in cursor.last_query

def test_fetch_all_status_and_filters(monkeypatch):
    import backend.app.helpers.plants_list as pl_mod
    cursor = FakeCursor()
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    
    # archived status
    PlantsList.fetch_all(status="archived")
    assert "p.archive = 1" in cursor.last_query
    
    # needs_weighing_filter
    PlantsList.fetch_all(needs_weighing_filter=False)
    assert "latest_pm.measured_at >= %s" in cursor.last_query
    
    # min_water_loss_total_pct
    PlantsList.fetch_all(min_water_loss_total_pct=10.0)
    assert "latest_pm.water_loss_total_pct > %s" in cursor.last_query

def test_fetch_all_repotting_derived_capacity(monkeypatch):
    import backend.app.helpers.plants_list as pl_mod
    now = datetime.utcnow()
    pid = bytes.fromhex("dd" * 16)
    # Row with measured_weight, last_dry, last_wet and water_loss is NULL
    # capacity = 50. effective_min = 100. effective_max = 50.
    # measured = 110 -> (110-100)/50 = 20% retained.
    row = (pid, "Repot", None, None, 60.0, 40.0, 40.0, None, None, None, now, now, now, 110.0, 100.0, 150.0, None, 0, 0, "desc")
    cursor = FakeCursor(rows=[row])
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    # Mock get_last_watering_event_since to return None (no watering event found)
    monkeypatch.setattr(pl_mod, "get_last_watering_event_since", lambda c, u: None)
    items = PlantsList.fetch_all()
    # With current implementation: min_dry=60, max_water=40, measured=110
    # water_remain = 110-60=50, saturated=60+40=100, available=100-60=40
    # frac = 50/40 = 1.25 -> clamped to 1.0 -> 100%
    assert items[0]["water_retained_pct"] == 100.0

def test_plants_list_final_coverage_gaps(monkeypatch):
    import backend.app.helpers.plants_list as pl_mod
    now = datetime.utcnow()
    
    # Line 94: needs_weighing_filter=False in vacation mode
    cursor = FakeCursor()
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    PlantsList.fetch_all(mode="vacation", needs_weighing_filter=False)
    
    # Line 159-161: Exception during _main_query_params capture
    class BoomCursor(FakeCursor):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            # Use a different name for the internal storage to avoid property collision
            self._real_last_params = None
        @property
        def last_params(self): raise RuntimeError("params fail")
        @last_params.setter
        def last_params(self, val): pass
    cursor2 = BoomCursor()
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor2))
    PlantsList.fetch_all()
    
    # Line 340-343: water_retained_pct is None
    # We use a row that yields None for retained pct
    row_none = (bytes.fromhex("ee"*16), "P", None, None, None, None, None, None, None, None, now, now, now, None, None, None, None, 0, 0, "desc")
    cursor3 = FakeCursor(rows=[row_none])
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor3))
    # Mock get_last_watering_event_since to return None (no watering event)
    monkeypatch.setattr(pl_mod, "get_last_watering_event_since", lambda c, u: None)
    # Mock _check_watering_prediction to return True for standard_needs_water
    monkeypatch.setattr(pl_mod.PlantsList, "_check_watering_prediction", lambda c, u: True)
    items = PlantsList.fetch_all()
    assert items[0]["needs_water"] is True # standard_needs_water = True
    
    # Line 639-640: Exception in finally's conn.close()
    class CloseFailingConn(FakeConn):
        def close(self): raise RuntimeError("close fail")
    monkeypatch.setattr(pl_mod, "get_conn", lambda: CloseFailingConn(FakeCursor()))
    PlantsList.count_all()

def test_check_watering_prediction_repot_watering(monkeypatch):
    import backend.app.helpers.plants_list as pl_mod
    now = datetime.utcnow().replace(microsecond=0)
    pid = bytes.fromhex("ff" * 16)
    # Line 470 branch: row exists for last watering since repot
    cursor = FakeCursor(rows=[_full_row(pid, "P1", created=now, measured=now)])
    fake_repot = type('obj', (object,), {'measured_at': (now - timedelta(days=10)).isoformat()})
    monkeypatch.setattr(pl_mod, "get_last_repotting_event", lambda c, u: fake_repot)
    # 468: row = cur.fetchone() (last watering since repot)
    cursor.add_response("SELECT measured_at", [(now - timedelta(days=5),)])
    monkeypatch.setattr(pl_mod, "get_conn", lambda: FakeConn(cursor))
    PlantsList.fetch_all()
