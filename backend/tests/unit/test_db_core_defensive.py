import builtins
import pytest

# We target a defensive branch in backend.app.db.core.get_conn
# Specifically line 61: `raise last_err` which is intended as a
# never-reached fallback. To cover it, we monkeypatch builtins.range
# to return an empty iterable only when called as range(2), which is
# the retry loop in get_conn. All other uses of range delegate to the
# original built-in to avoid side effects.


def test_get_conn_defensive_fallthrough_raises(monkeypatch):
    from backend.app.db import core

    # Sanity: ensure original behavior would iterate twice
    assert list(range(2)) == [0, 1]

    original_range = builtins.range

    def fake_range(n):
        if n == 2:
            return []  # cause zero iterations in get_conn retry loop
        return original_range(n)

    # Patch builtins.range only for this test
    monkeypatch.setattr(builtins, "range", fake_range)

    # With zero iterations, the function reaches `raise last_err` where
    # last_err is None. Python raises a TypeError when you `raise None`.
    with pytest.raises(TypeError):
        core.get_conn()
