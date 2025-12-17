class FakeCursor:
    def __init__(self, rows):
        self._rows = rows
        self._executed = []

    def execute(self, sql, params=None):
        self._executed.append((" ".join(sql.split()), tuple(params or ())))

    def fetchall(self):
        return self._rows

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeConn:
    def __init__(self, rows):
        self.rows = rows

    def cursor(self):
        return FakeCursor(self.rows)


def test_get_measured_weights_without_repotting():
    from app.helpers.weight_minimum import get_measured_weights_since_repotting
    rows = [(100,), (None,), (95,), (110,)]
    conn = FakeConn(rows)
    vals = get_measured_weights_since_repotting(conn, "dead" * 8, last_repotting=None)
    assert vals == [100, 95, 110]


def test_get_measured_weights_with_repotting():
    from app.helpers.weight_minimum import get_measured_weights_since_repotting

    class Rep:
        measured_at = "2025-02-01 00:00:00"

    rows = [(98,), (None,), (90,)]
    conn = FakeConn(rows)
    vals = get_measured_weights_since_repotting(conn, "beef" * 8, last_repotting=Rep())
    assert vals == [98, 90]


def test_calculate_min_dry_weight_g_min_and_empty_and_exception():
    from app.helpers.weight_minimum import calculate_min_dry_weight_g

    class BoomConn(FakeConn):
        def cursor(self):
            raise RuntimeError("db down")

    # Non-empty rows -> min
    conn_vals = FakeConn([(100,), (95,), (110,)])
    assert calculate_min_dry_weight_g(conn_vals, "id", last_repotting=None) == 95

    # Empty rows -> None
    conn_empty = FakeConn([])
    assert calculate_min_dry_weight_g(conn_empty, "id", last_repotting=None) is None

    # Exception -> None
    conn_boom = BoomConn([])
    assert calculate_min_dry_weight_g(conn_boom, "id", last_repotting=None) is None
