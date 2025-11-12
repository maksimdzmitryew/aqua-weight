from datetime import datetime

import pytest

from backend.app.helpers.last_plant_event import LastPlantEvent


class FakeCursor:
    def __init__(self, row=None):
        self._row = row
        self.last_query = None
        self.last_params = None
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()
        return False

    def execute(self, query, params=None):
        self.last_query = query
        self.last_params = list(params or [])
        return 1 if self._row is not None else 0

    def fetchone(self):
        return self._row

    def close(self):
        self.closed = True


class FakeConnection:
    def __init__(self, row=None):
        self._cursor = FakeCursor(row=row)
        self.closed = False

    def cursor(self):
        return self._cursor

    def close(self):
        self.closed = True


def test_get_last_event_none(monkeypatch):
    # No rows returned
    fake_conn = FakeConnection(row=None)
    from backend.app.helpers import last_plant_event as mod
    monkeypatch.setattr(mod, "get_conn", lambda: fake_conn)

    assert LastPlantEvent.get_last_event("abcd" * 8) is None
    assert fake_conn.closed is True


def test_get_last_event_happy_path(monkeypatch):
    measured_at = datetime(2025, 1, 2, 3, 4, 5)
    # method_id and scale_id stored as bytes -> should be hex in output
    method_id = bytes.fromhex("de" * 16)
    scale_id = bytes.fromhex("ad" * 16)
    row = (
        measured_at,  # measured_at
        123.4,        # measured_weight_g
        50.0,         # last_dry_weight_g
        200.0,        # last_wet_weight_g
        70.0,         # water_added_g
        method_id,    # method_id (bytes)
        scale_id,     # scale_id (bytes)
        "note text",  # note
    )

    fake_conn = FakeConnection(row=row)
    from backend.app.helpers import last_plant_event as mod
    monkeypatch.setattr(mod, "get_conn", lambda: fake_conn)

    out = LastPlantEvent.get_last_event("0f" * 16)

    assert out == {
        "measured_at": measured_at.isoformat(sep=" ", timespec="seconds"),
        "measured_weight_g": 123.4,
        "last_dry_weight_g": 50.0,
        "last_wet_weight_g": 200.0,
        "water_added_g": 70.0,
        "method_id": method_id.hex(),
        "scale_id": scale_id.hex(),
        "note": "note text",
    }

    # Also ensure the parameter passed to the query is the plant hex id string
    cur = fake_conn._cursor
    assert cur.last_params == ["0f" * 16]



def test_get_last_event_close_exception_is_swallowed(monkeypatch):
    class ExplodingCloseConnection(FakeConnection):
        def close(self):
            # mark flag then raise to simulate failure on closing
            self.closed = True
            raise Exception("close failed")

    fake_conn = ExplodingCloseConnection(row=None)
    from backend.app.helpers import last_plant_event as mod
    monkeypatch.setattr(mod, "get_conn", lambda: fake_conn)

    # Should not raise even though close() explodes
    result = LastPlantEvent.get_last_event("abcd" * 8)
    assert result is None
    # The close was attempted
    assert fake_conn.closed is True
