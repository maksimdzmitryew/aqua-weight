from datetime import datetime, timezone, timedelta
import pytest

from backend.app.utils.date_time import (
    to_iso_utc,
    parse_dt,
    normalize_measured_at,
    normalize_measured_at_local,
)


def test_to_iso_utc_variants():
    assert to_iso_utc(None) is None
    # naive assumed UTC
    dt_naive = datetime(2025, 1, 2, 3, 4, 5)
    assert to_iso_utc(dt_naive) == "2025-01-02T03:04:05Z"
    # aware with offset converts to Z
    dt_aware = datetime(2025, 1, 2, 4, 4, 5, tzinfo=timezone(timedelta(hours=1)))
    assert to_iso_utc(dt_aware) == "2025-01-02T03:04:05Z"


def test_parse_dt_variants_and_errors():
    # ISO with Z
    d1 = parse_dt("2025-01-02T03:04:05Z")
    assert d1.tzinfo == timezone.utc and d1.isoformat() == "2025-01-02T03:04:05+00:00"
    # ISO with offset and space separator
    d2 = parse_dt("2025-01-02 04:04:05+01:00")
    assert d2 == datetime(2025, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    # SQL-like without tz -> assume UTC
    d3 = parse_dt("2025-01-02 03:04:05")
    assert d3 == datetime(2025, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    # Invalid raises
    with pytest.raises(ValueError):
        parse_dt("not-a-date")


def test_normalize_measured_at_fill_modes_and_clamp():
    base = "2025-10-21T19:33"  # missing seconds
    # zeros
    out0 = normalize_measured_at(base, fill_with="zeros")
    assert out0 == datetime(2025, 10, 21, 19, 33, 0, 0, tzinfo=timezone.utc)
    # server with fixed overrides (deterministic)
    out1 = normalize_measured_at(base, fill_with="server", fixed_seconds=7, fixed_milliseconds=123)
    assert out1 == datetime(2025, 10, 21, 19, 33, 7, 123000, tzinfo=timezone.utc)
    # fixed requires both args and clamps ms
    out2 = normalize_measured_at(base, fill_with="fixed", fixed_seconds=59, fixed_milliseconds=2000)
    assert out2 == datetime(2025, 10, 21, 19, 33, 59, 999000, tzinfo=timezone.utc)
    # tz-aware input converted to UTC
    out3 = normalize_measured_at("2025-10-21T21:33+02:00", fill_with="zeros")
    assert out3 == datetime(2025, 10, 21, 19, 33, 0, 0, tzinfo=timezone.utc)
    # invalid fill_with
    with pytest.raises(ValueError):
        normalize_measured_at(base, fill_with="unknown")
    # fixed without args raises
    with pytest.raises(ValueError):
        normalize_measured_at(base, fill_with="fixed", fixed_seconds=None, fixed_milliseconds=10)
    with pytest.raises(ValueError):
        normalize_measured_at(base, fill_with="fixed", fixed_seconds=10, fixed_milliseconds=None)
    # For local variant: providing seconds but omitting milliseconds should raise (covers line 154)
    with pytest.raises(ValueError):
        normalize_measured_at_local(base, fill_with="fixed", fixed_seconds=10, fixed_milliseconds=None)


def test_normalize_measured_at_local_modes_and_tz():
    base = "2025-10-21T19:33"
    # zeros
    out0 = normalize_measured_at_local(base, fill_with="zeros")
    assert out0.tzinfo is None and out0.second == 0 and out0.microsecond == 0
    assert (out0.year, out0.month, out0.day, out0.hour, out0.minute) == (2025, 10, 21, 19, 33)
    # server with fixed overrides
    out1 = normalize_measured_at_local(base, fill_with="server", fixed_seconds=7, fixed_milliseconds=321)
    assert out1.tzinfo is None and out1.second == 7 and out1.microsecond == 321000
    # fixed clamps ms
    out2 = normalize_measured_at_local(base, fill_with="fixed", fixed_seconds=5, fixed_milliseconds=2000)
    assert out2.second == 5 and out2.microsecond == 999000 and out2.tzinfo is None
    # input with Z should convert to local time then drop tzinfo; to make this deterministic, compare offset difference
    out3 = normalize_measured_at_local("2025-10-21T19:33:00Z", fill_with="zeros")
    # After conversion, it's still the same wall-clock time when local tz is UTC; otherwise hour may differ — only assert tzinfo None and minute preserved
    assert out3.tzinfo is None and out3.minute == 33
    # invalid fill_with
    with pytest.raises(ValueError):
        normalize_measured_at_local(base, fill_with="unknown")
