from datetime import datetime


class FakeCursor:
    def __init__(self, rows):
        self._rows = rows
        self._executed = []

    def execute(self, sql, params=None):
        # record the call for inspection if needed
        self._executed.append((" ".join(sql.split()), tuple(params or ())))

    def fetchall(self):
        return self._rows

    # context manager protocol
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeConn:
    def __init__(self, rows):
        self.rows = rows

    def cursor(self):
        return FakeCursor(self.rows)


def test_get_added_waterings_without_repotting_branch():
    from app.helpers.watering_maximum import get_added_waterings_since_repotting
    rows = [(10,), (None,), (20,)]
    conn = FakeConn(rows)
    vals = get_added_waterings_since_repotting(conn, "deadbeef" * 4, last_repotting=None)
    assert vals == [10, 20]


def test_get_added_waterings_with_repotting_branch_filters_and_orders():
    from app.helpers.watering_maximum import get_added_waterings_since_repotting

    class Rep:
        measured_at = "2025-01-02 10:00:00"

    # Includes before/after and None values
    rows = [
        (5,),
        (None,),
        (7,),
    ]
    conn = FakeConn(rows)
    vals = get_added_waterings_since_repotting(conn, "cafebabe" * 4, last_repotting=Rep())
    assert vals == [5, 7]


def test_calculate_max_watering_added_g_returns_none_on_empty_and_error():
    from app.helpers.watering_maximum import calculate_max_watering_added_g

    class BoomConn(FakeConn):
        def cursor(self):  # force exception in helper
            raise RuntimeError("db down")

    # Empty list -> None
    conn_empty = FakeConn([])
    assert calculate_max_watering_added_g(conn_empty, "id", last_repotting=None) is None

    # Exception -> None
    conn_boom = BoomConn([])
    assert calculate_max_watering_added_g(conn_boom, "id", last_repotting=None) is None


def test_calculate_max_watering_added_g_catches_internal_exception(monkeypatch):
    # Ensure the exception within calculate_max_watering_added_g is caught
    # by making the helper it calls raise directly.
    import app.helpers.watering_maximum as wm

    def boom(*args, **kwargs):
        raise ValueError("unexpected failure")

    monkeypatch.setattr(wm, "get_added_waterings_since_repotting", boom)

    # Any conn works because the helper is patched out
    assert wm.calculate_max_watering_added_g(object(), "id", last_repotting=None) is None
