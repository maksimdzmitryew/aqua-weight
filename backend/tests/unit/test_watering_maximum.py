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

    def fetchone(self):
        return self._rows[0] if self._rows else None

    # context manager protocol
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeConn:
    def __init__(self, rows):
        self.rows = rows
        self.cursor_instance = None

    def cursor(self):
        self.cursor_instance = FakeCursor(self.rows)
        return self.cursor_instance


def test_get_added_waterings_without_repotting_branch():
    from backend.app.helpers.watering_maximum import calculate_max_watering_added_g

    rows = [(20,)]
    conn = FakeConn(rows)
    assert calculate_max_watering_added_g(conn, "deadbeef" * 4, last_repotting=None) == 20
    assert conn.cursor_instance._executed[0][1] == ("deadbeef" * 4,)


def test_get_added_waterings_with_repotting_branch_filters_and_orders():
    from backend.app.helpers.watering_maximum import calculate_max_watering_added_g

    class Rep:
        measured_at = "2025-01-02 10:00:00"

    rows = [(7,)]
    conn = FakeConn(rows)
    assert calculate_max_watering_added_g(conn, "cafebabe" * 4, last_repotting=Rep()) == 7
    assert conn.cursor_instance._executed[0][1] == ("cafebabe" * 4, Rep.measured_at)


def test_calculate_max_watering_added_g_returns_none_on_empty_and_error():
    from backend.app.helpers.watering_maximum import calculate_max_watering_added_g

    class BoomConn(FakeConn):
        def cursor(self):  # force exception in helper
            raise RuntimeError("db down")

    # Empty list -> None
    conn_empty = FakeConn([])
    assert calculate_max_watering_added_g(conn_empty, "id", last_repotting=None) is None

    # Exception -> None
    conn_boom = BoomConn([])
    assert calculate_max_watering_added_g(conn_boom, "id", last_repotting=None) is None


def test_calculate_max_watering_added_g_catches_internal_exception():
    from backend.app.helpers.watering_maximum import calculate_max_watering_added_g

    class BoomCursor(FakeCursor):
        def execute(self, sql, params=None):
            raise ValueError("unexpected failure")

    class BoomConn(FakeConn):
        def cursor(self):
            return BoomCursor([])

    assert calculate_max_watering_added_g(BoomConn([]), "id", last_repotting=None) is None
