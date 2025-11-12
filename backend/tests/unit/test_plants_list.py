import builtins
from datetime import datetime, timedelta
import types
import pytest

from backend.app.helpers.plants_list import PlantsList


class FakeCursor:
    def __init__(self, rows=None):
        self._rows = rows or []
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

    def close(self):
        self.closed = True


class FakeConnection:
    def __init__(self, rows=None):
        self._cursor = FakeCursor(rows=rows)
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
    assert items[0]["created_at"].replace(microsecond=0) == (now - timedelta(days=1)).replace(microsecond=0)
    # Second item has no measured_at, should pick created_at
    assert items[1]["created_at"].replace(microsecond=0) == (now - timedelta(days=2)).replace(microsecond=0)

    # Water loss passthrough
    assert items[0]["water_loss_total_pct"] == 12.5
    assert items[1]["water_loss_total_pct"] is None


def test_fetch_all_with_min_water_loss_filter_passes_params(monkeypatch):
    # One row just to ensure mapping still works
    now = datetime.utcnow()
    pid = bytes.fromhex("33" * 16)
    row = make_row(
        pid_bytes=pid,
        name="Cactus",
        created_at=now,
        measured_at=now,
        water_loss_total_pct=20.0,
    )
    fake_conn = FakeConnection(rows=[row])

    from backend.app.helpers import plants_list as pl_mod
    monkeypatch.setattr(pl_mod, "get_conn", lambda: fake_conn)

    items = PlantsList.fetch_all(min_water_loss_total_pct=10.0)

    # Verify parameters captured by FakeCursor
    cur = fake_conn._cursor
    assert cur.last_params == [10.0]
    # The query should contain the additional filter clause
    assert "latest_pm.water_loss_total_pct > %s" in cur.last_query

    # Mapping sanity check
    assert items[0]["uuid"] == pid.hex()
