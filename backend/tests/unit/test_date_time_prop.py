import pytest
from hypothesis import given, strategies as st
from datetime import datetime, timezone, timedelta

from backend.app.utils.date_time import (
    normalize_measured_at,
    normalize_measured_at_local,
    to_iso_utc,
    parse_dt,
)


iso_no_tz = st.datetimes(
    timezones=st.just(None),
    min_value=datetime(1970, 1, 1),
    max_value=datetime(2100, 12, 31),
).map(lambda d: d.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M"))

iso_with_z = st.datetimes(
    timezones=st.just(timezone.utc),
    min_value=datetime(1970, 1, 1),  # bounds must be naive per Hypothesis API
    max_value=datetime(2100, 12, 31),
).map(lambda d: d.replace(microsecond=0, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"))


@given(iso_no_tz)
def test_normalize_measured_at_zero_seconds_for_utc_strings(raw):
    dt = normalize_measured_at(raw, fill_with="zeros", fixed_milliseconds=0)
    assert dt.tzinfo is not None
    assert dt.tzinfo == timezone.utc
    assert dt.second == 0
    assert dt.microsecond == 0


@given(iso_no_tz)
def test_normalize_measured_at_local_zero_seconds_for_local_strings(raw):
    dt = normalize_measured_at_local(raw, fill_with="zeros", fixed_milliseconds=0)
    assert dt.tzinfo is None  # local representation is naive
    assert dt.second == 0
    assert dt.microsecond == 0


@given(iso_with_z, st.integers(min_value=-1000, max_value=5000))
def test_fixed_milliseconds_are_clamped_local(z_str, ms):
    dt = normalize_measured_at_local(z_str, fill_with="zeros", fixed_milliseconds=ms)
    assert 0 <= dt.microsecond // 1000 <= 999


@given(iso_with_z)
def test_parse_dt_and_to_iso_roundtrip(z_str):
    # parse_dt should return tz-aware UTC; to_iso_utc should end with Z
    dt = parse_dt(z_str)
    assert dt.tzinfo is not None
    assert dt.tzinfo == timezone.utc
    out = to_iso_utc(dt)
    assert out.endswith("Z")


@given(iso_with_z, st.integers(min_value=0, max_value=59), st.integers(min_value=-100, max_value=2000))
def test_fill_with_fixed_requires_bounds(z_str, sec, ms):
    # When using fill_with=fixed, passing fixed values should be applied with clamping for ms
    dt = normalize_measured_at(z_str, fill_with="fixed", fixed_seconds=sec, fixed_milliseconds=ms)
    assert dt.second == sec
    assert 0 <= dt.microsecond // 1000 <= 999


def test_invalid_fill_with_raises():
    with pytest.raises(ValueError):
        normalize_measured_at("2025-01-01T00:00", fill_with="nope")
    with pytest.raises(ValueError):
        normalize_measured_at_local("2025-01-01T00:00", fill_with="nope")


def test_fill_with_fixed_requires_params():
    with pytest.raises(ValueError):
        normalize_measured_at("2025-01-01T00:00", fill_with="fixed")
    with pytest.raises(ValueError):
        normalize_measured_at_local("2025-01-01T00:00", fill_with="fixed")
