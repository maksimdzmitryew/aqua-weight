import pytest
from datetime import datetime, timezone, timedelta

from backend.app.utils.date_time import to_iso_utc, parse_dt, normalize_measured_at, normalize_measured_at_local


@pytest.mark.parametrize(
    "dt_in, expected",
    [
        (None, None),
        (datetime(2025, 1, 1, 12, 0, 0), "2025-01-01T12:00:00Z"),  # naive assumed UTC
        (datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone(timedelta(hours=2))), "2025-01-01T10:00:00Z"),
        (datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc), "2025-01-01T12:00:00Z"),
    ],
)
def test_to_iso_utc(dt_in, expected):
    assert to_iso_utc(dt_in) == expected


@pytest.mark.parametrize(
    "raw, expected_iso",
    [
        ("2025-01-02T03:04:05Z", "2025-01-02T03:04:05+00:00"),
        ("2025-01-02T05:04:05+02:00", "2025-01-02T03:04:05+00:00"),
        ("2025-01-02 03:04:05", "2025-01-02T03:04:05+00:00"),
        (datetime(2025, 1, 2, 3, 4, 5), "2025-01-02T03:04:05+00:00"),
        (datetime(2025, 1, 2, 3, 4, 5, tzinfo=timezone(timedelta(hours=-3))), "2025-01-02T06:04:05+00:00"),
    ],
)
def test_parse_dt_variants(raw, expected_iso):
    dt = parse_dt(raw)
    assert dt.tzinfo is not None
    assert dt.isoformat() == expected_iso


def test_parse_dt_invalid():
    with pytest.raises(ValueError):
        parse_dt("not-a-date")


@pytest.mark.parametrize(
    "raw, opts, expected_suffix",
    [
        ("2025-03-10T12:30", {"fill_with": "zeros"}, ":00+00:00"),
        ("2025-03-10T12:30:10", {"fill_with": "zeros"}, ":00+00:00"),
        ("2025-03-10T12:30:10+02:00", {"fill_with": "zeros"}, ":00+00:00"),
        ("2025-03-10T12:30", {"fill_with": "fixed", "fixed_seconds": 7, "fixed_milliseconds": 123}, ":07.123000+00:00"),
    ],
)
def test_normalize_measured_at_variants(raw, opts, expected_suffix):
    dt = normalize_measured_at(raw, **opts)
    assert dt.tzinfo is not None
    assert dt.isoformat().endswith(expected_suffix)


def test_normalize_measured_at_server_uses_now_but_keeps_fields(monkeypatch):
    fake_now = datetime(2025, 6, 1, 1, 2, 3, 456000, tzinfo=timezone.utc)
    monkeypatch.setattr("backend.app.utils.date_time.datetime", datetime)
    # patch datetime.now returning fake_now using a small helper class
    class _FakeDT(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            return fake_now if tz is None else fake_now.astimezone(tz)

    monkeypatch.setattr("backend.app.utils.date_time.datetime", _FakeDT)
    dt = normalize_measured_at("2025-06-01T10:20", fill_with="server")
    assert dt.second == fake_now.second
    assert dt.microsecond == fake_now.microsecond


@pytest.mark.parametrize(
    "raw, opts, expect_second, expect_micro",
    [
        ("2025-03-10T12:30", {"fill_with": "zeros"}, 0, 0),
        ("2025-03-10T12:30:10", {"fill_with": "zeros"}, 0, 0),
        ("2025-03-10T12:30:10Z", {"fill_with": "zeros"}, 0, 0),
        ("2025-03-10T12:30", {"fill_with": "fixed", "fixed_seconds": 9, "fixed_milliseconds": 7}, 9, 7000),
    ],
)
def test_normalize_measured_at_local_variants(raw, opts, expect_second, expect_micro):
    dt = normalize_measured_at_local(raw, **opts)
    # local variant returns naive datetime
    assert dt.tzinfo is None
    assert dt.second == expect_second
    assert dt.microsecond == expect_micro


def test_normalize_measured_at_local_server(monkeypatch):
    # Ensure 'server' uses local now seconds/millis
    class _FakeDT(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            return datetime(2025, 7, 1, 2, 3, 4, 123000)

    monkeypatch.setattr("backend.app.utils.date_time.datetime", _FakeDT)
    dt = normalize_measured_at_local("2025-07-01T10:20", fill_with="server")
    assert dt.second == 4
    assert dt.microsecond == 123000


def test_normalize_measured_at_invalid_fill():
    with pytest.raises(ValueError):
        normalize_measured_at("2025-01-01T00:00", fill_with="nope")


def test_normalize_measured_at_local_invalid_fill():
    with pytest.raises(ValueError):
        normalize_measured_at_local("2025-01-01T00:00", fill_with="nope")
