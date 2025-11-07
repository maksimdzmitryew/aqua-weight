from datetime import datetime, timezone, timedelta


def to_iso_utc(dt: datetime | None) -> str | None:
    """
    Serialize a datetime to UTC ISO 8601 with trailing 'Z'.
    - If dt is None: return None.
    - If dt is naive: assume it is already UTC (DB boundary) and set tzinfo=UTC.
    - If dt has TZ: convert to UTC.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def parse_dt(value: datetime | str) -> datetime:
    """
    Parse various datetime formats and return a tz-aware UTC datetime.
    Accepted inputs:
    - datetime (naive or tz-aware). Naive assumed UTC.
    - ISO 8601 strings, with or without 'Z' or offsets, with 'T' or space separator.
    - SQL-like strings 'YYYY-MM-DD HH:MM[:SS][.ffffff]'.
    """
    if isinstance(value, datetime):
        dt = value
    else:
        s = value.strip()
        # normalize 'Z' to '+00:00' for fromisoformat
        s_norm = s.replace("Z", "+00:00")
        # Try ISO first (handles both 'T' and space)
        try:
            dt = datetime.fromisoformat(s_norm)
        except ValueError:
            # Attempt to convert SQL-like by replacing space with 'T' and try again
            try:
                s2 = s_norm.replace(" ", "T", 1)
                dt = datetime.fromisoformat(s2)
            except ValueError as e:
                raise ValueError(f"Unsupported datetime format: {value}") from e

    # Normalize to UTC tz-aware
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt


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


def normalize_measured_at_local(raw: str,
                                *,
                                fill_with: str = "zeros",
                                fixed_seconds: int | None = None,
                                fixed_milliseconds: int | None = None) -> datetime:
    """
    Parse FE ISO datetime like "2025-10-21T19:33" and return a timezone-naive datetime
    representing the user's local wall-clock time. This value is suitable for inserting
    into SQL DATETIME columns (which are timezone-agnostic).

    Behavior:
    - If the input has no timezone (e.g., from <input type="datetime-local">), keep values as-is.
    - If the input has a timezone or 'Z', convert to local time and then drop tzinfo.
    - Seconds default to 0 unless specified via fill_with/fixed_* arguments.
    - Milliseconds can be set deterministically via fixed_milliseconds (0..999), stored as microseconds.
    """
    raw = raw.strip()
    dt = datetime.fromisoformat(raw)

    # If tz-aware, convert to local time and drop tzinfo; if naive, leave as-is
    if dt.tzinfo is not None:
        # Convert to OS local time then strip tzinfo
        local_dt = dt.astimezone()  # system local timezone
        dt = local_dt.replace(tzinfo=None)

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
        now = datetime.now()  # local time
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
