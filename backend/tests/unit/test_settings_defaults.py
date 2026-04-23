from backend.app.utils.settings_defaults import DEFAULT_THRESHOLD_FALLBACK
from backend.app.utils.settings_defaults import parse_default_threshold


def test_parse_default_threshold_none_uses_fallback():
    assert parse_default_threshold(None) == DEFAULT_THRESHOLD_FALLBACK


def test_parse_default_threshold_invalid_string_uses_fallback():
    assert parse_default_threshold("not-a-number") == DEFAULT_THRESHOLD_FALLBACK


def test_parse_default_threshold_clamps_range():
    assert parse_default_threshold(-5) == 0.0
    assert parse_default_threshold(120) == 100.0
