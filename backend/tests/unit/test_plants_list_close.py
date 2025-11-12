import types
from typing import Any, List

import pytest

# Target under test
from backend.app.helpers.plants_list import PlantsList, get_conn as real_get_conn  # type: ignore


class _FakeCursor:
    def __init__(self, rows: List[tuple] | None = None):
        self._rows = rows or []
        self.executed: list[tuple[str, list[Any]]] = []

    def execute(self, query: str, params: list[Any] | None = None) -> None:
        self.executed.append((query, params or []))

    def fetchall(self):
        return list(self._rows)


class _CursorCtxMgr:
    def __init__(self, cursor: _FakeCursor):
        self._cursor = cursor

    def __enter__(self) -> _FakeCursor:
        return self._cursor

    def __exit__(self, exc_type, exc, tb) -> None:  # pragma: no cover - trivial
        return None


class _FakeConn:
    def __init__(self, rows: List[tuple] | None = None, close_raises: bool = False):
        self._cursor = _FakeCursor(rows)
        self._close_raises = close_raises
        self.closed = False

    def cursor(self):
        return _CursorCtxMgr(self._cursor)

    def close(self):
        # Toggle a flag to ensure close was invoked
        self.closed = True
        if self._close_raises:
            raise RuntimeError("boom closing")


@pytest.fixture
def _restore_get_conn():
    # Provide a fixture to restore get_conn if a test fails mid-way
    try:
        yield
    finally:
        # Best-effort restore in case a test forgets to do so
        import backend.app.helpers.plants_list as plants_list

        plants_list.get_conn = real_get_conn  # type: ignore[attr-defined]


def _install_fake_get_conn(fake_conn: _FakeConn):
    import backend.app.helpers.plants_list as plants_list

    def _fake_get_conn():
        return fake_conn

    plants_list.get_conn = _fake_get_conn  # type: ignore[attr-defined]


def test_fetch_all_closes_connection_success(_restore_get_conn):
    # No rows returned; close() succeeds
    fake_conn = _FakeConn(rows=[], close_raises=False)
    _install_fake_get_conn(fake_conn)

    result = PlantsList.fetch_all()

    assert result == []
    # Ensure our fake connection was closed
    assert fake_conn.closed is True


def test_fetch_all_swallow_close_exception(_restore_get_conn):
    # Even if close() raises, fetch_all should not propagate and should return results
    # Provide a single minimal row (matching the SELECT columns order) to exercise mapping
    # Columns: p.id, p.name, p.description, p.species_name, p.location_id, l.name, p.created_at, latest_pm.measured_at, latest_pm.water_loss_total_pct
    pid = b"\x00" * 16
    location_id = b"\x11" * 16
    row = (
        pid,  # id (BINARY(16))
        "Aloe",  # name
        "Succulent",  # description
        "Aloe vera",  # species_name
        location_id,  # location_id (BINARY(16))
        "Kitchen",  # location name
        None,  # created_at
        None,  # measured_at (latest)
        12.5,  # water_loss_total_pct
    )
    fake_conn = _FakeConn(rows=[row], close_raises=True)
    _install_fake_get_conn(fake_conn)

    # Should not raise despite close() raising
    items = PlantsList.fetch_all()

    assert isinstance(items, list) and len(items) == 1
    item = items[0]
    # Synthetic index starts from 1
    assert item["id"] == 1
    assert item["uuid"] == pid.hex()
    assert item["name"] == "Aloe"
    assert item["description"] == "Succulent"
    assert item["species"] == "Aloe vera"
    assert item["location"] == "Kitchen"
    assert item["location_id"] == location_id.hex()
    assert item["water_loss_total_pct"] == 12.5
    # Despite exception in close, function handled it and continued
    assert fake_conn.closed is True
