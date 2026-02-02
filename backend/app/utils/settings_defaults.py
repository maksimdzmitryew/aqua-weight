from typing import Optional


DEFAULT_THRESHOLD_FALLBACK = 40.0


def parse_default_threshold(raw: Optional[object]) -> float:
    """Parse the default threshold value and clamp it to [0, 100]."""
    value = None
    if raw is not None:
        try:
            value = float(raw)
        except (TypeError, ValueError):
            value = None

    if value is None:
        value = DEFAULT_THRESHOLD_FALLBACK

    return max(0.0, min(100.0, float(value)))