import backend.app.helpers.water_weight as ww


class _FakeCursor:
    def __init__(self):
        self.executed = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self.executed.append((sql, tuple(params or ())))

    def fetchall(self):
        return []


class _FakeConn:
    def __init__(self, fail=False):
        self._cursor = _FakeCursor()
        self._fail = fail
        self.committed = False

    def cursor(self):
        if self._fail:
            raise RuntimeError("boom")
        return self._cursor

    def commit(self):
        self.committed = True


def test_update_min_dry_and_max_watering_updates_and_commits():
    conn = _FakeConn()

    # Monkeypatch dependencies
    orig_get_last = ww.get_last_repotting_event
    orig_min = ww.calculate_min_dry_weight_g
    orig_max = ww.calculate_max_watering_added_g
    try:
        ww.get_last_repotting_event = lambda c, h: object()  # type: ignore
        ww.calculate_min_dry_weight_g = lambda c, h, r: 100  # type: ignore
        ww.calculate_max_watering_added_g = lambda c, h, r: 20  # type: ignore

        # New measurement lowers min and raises max
        ww.update_min_dry_weight_and_max_watering_added_g(conn, "aa" * 16, new_measured_weight_g=90, new_added_watering_g=25)

        # Verify SQL executed with updated values and commit called
        assert conn.committed is True
        assert conn._cursor.executed
        sql, params = conn._cursor.executed[-1]
        assert "UPDATE plants" in sql
        assert params[0] == 90  # min_dry_weight_g
        assert params[1] == 25  # max_water_weight_g
        assert params[2] == "aa" * 16
    finally:
        ww.get_last_repotting_event = orig_get_last  # type: ignore
        ww.calculate_min_dry_weight_g = orig_min  # type: ignore
        ww.calculate_max_watering_added_g = orig_max  # type: ignore


def test_update_min_dry_and_max_watering_handles_exception():
    conn = _FakeConn(fail=True)
    # Should not raise
    ww.update_min_dry_weight_and_max_watering_added_g(conn, "bb" * 16, None, None)
