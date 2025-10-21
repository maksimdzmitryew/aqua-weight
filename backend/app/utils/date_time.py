from datetime import datetime, timezone, timedelta

def normalize_measured_at(raw: str,
                         *,
                         tz: timezone = timezone.utc,
                         fill_with: str = "zeros",
                         fixed_seconds: int | None = None,
                         fixed_milliseconds: int | None = None) -> datetime:
    """
    Parse FE ISO datetime like "2025-10-21T19:33:00" and return a tz-aware UTC datetime.
    - fill_with: "zeros" | "server" | "fixed"
    - fixed_seconds: integer 0..59 used when fill_with == "fixed" or when provided explicitly
    - fixed_milliseconds: integer 0..999 used when fill_with == "fixed" or when provided explicitly
    """
    raw = raw.strip()
    dt = datetime.fromisoformat(raw)  # accepts "YYYY-MM-DDTHH:MM", "YYYY-MM-DDTHH:MM:SS", etc.

    # make timezone-aware in UTC
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    dt = dt.astimezone(timezone.utc)

    # helpers and normalization
    def clamp_ms(ms: int) -> int:
        if ms < 0:
            return 0
        if ms > 999:
            return 999
        return ms

    if fill_with == "zeros":
        sec = 0 if fixed_seconds is None else int(fixed_seconds)
        ms = 0 if fixed_milliseconds is None else clamp_ms(int(fixed_milliseconds))
        return dt.replace(second=sec, microsecond=ms * 1000)

    if fill_with == "server":
        now = datetime.now(timezone.utc)
        sec = now.second if fixed_seconds is None else int(fixed_seconds)
        ms = now.microsecond // 1000 if fixed_milliseconds is None else clamp_ms(int(fixed_milliseconds))
        return dt.replace(second=sec, microsecond=ms * 1000)

    if fill_with == "fixed":
        if fixed_seconds is None:
            raise ValueError("fixed_seconds must be provided for fill_with='fixed'")
        if fixed_milliseconds is None:
            raise ValueError("fixed_milliseconds must be provided for fill_with='fixed'")
        sec = int(fixed_seconds)
        ms = clamp_ms(int(fixed_milliseconds))
        return dt.replace(second=sec, microsecond=ms * 1000)

    raise ValueError("unsupported fill_with value")
