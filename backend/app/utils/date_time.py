from datetime import datetime, timezone


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


def normalize_measured_at(
    raw: str,
    *,
    tz: timezone = timezone.utc,
    fill_with: str = "zeros",
    fixed_seconds: int | None = None,
    fixed_milliseconds: int | None = None,
    fixed_microseconds: int | None = None,
) -> datetime:
    """
    Parse FE ISO datetime like "2025-10-21T19:33:00" and return a tz-aware UTC datetime.
    - fill_with: "zeros" | "server" | "fixed" | "preserve"
    - fixed_seconds: integer 0..59 used when fill_with == "fixed" or when provided explicitly
    - fixed_milliseconds: integer 0..999 used when provided explicitly (stored as ms*1000)
    - fixed_microseconds: integer 0..999999 used when provided explicitly (highest priority)
    """
    raw = raw.strip()
    s_norm = raw.replace("Z", "+00:00")
    dt = datetime.fromisoformat(s_norm)  # accepts "YYYY-MM-DDTHH:MM", "YYYY-MM-DDTHH:MM:SS", etc.

    # make timezone-aware in UTC
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    dt = dt.astimezone(timezone.utc)

    # helpers and normalization
    def clamp_ms(ms: int) -> int:
        return max(0, min(999, ms))

    def clamp_us(us: int) -> int:
        return max(0, min(999999, us))

    def get_usec(base_us: int) -> int:
        if fixed_microseconds is not None:
            return clamp_us(int(fixed_microseconds))
        if fixed_milliseconds is not None:
            return clamp_ms(int(fixed_milliseconds)) * 1000
        return base_us

    if fill_with == "zeros":
        sec = 0 if fixed_seconds is None else int(fixed_seconds)
        usec = get_usec(0)
        return dt.replace(second=sec, microsecond=usec)

    if fill_with == "preserve":
        sec = dt.second if fixed_seconds is None else int(fixed_seconds)
        usec = get_usec(dt.microsecond)
        return dt.replace(second=sec, microsecond=usec)

    if fill_with == "server":
        now = datetime.now(timezone.utc)
        sec = now.second if fixed_seconds is None else int(fixed_seconds)
        usec = get_usec(now.microsecond)
        return dt.replace(second=sec, microsecond=usec)

    if fill_with == "fixed":
        if fixed_seconds is None:
            raise ValueError("fixed_seconds must be provided for fill_with='fixed'")
        if fixed_milliseconds is None and fixed_microseconds is None:
            raise ValueError(
                "fixed_milliseconds or fixed_microseconds must be provided for fill_with='fixed'"
            )
        sec = int(fixed_seconds)
        usec = get_usec(
            0
        )  # Requires at least one of fixed_ms or fixed_us to be non-zero to be useful
        return dt.replace(second=sec, microsecond=usec)

    raise ValueError("unsupported fill_with value")


def normalize_measured_at_local(
    raw: str,
    *,
    fill_with: str = "zeros",
    fixed_seconds: int | None = None,
    fixed_milliseconds: int | None = None,
    fixed_microseconds: int | None = None,
) -> datetime:
    """
    Parse FE ISO datetime like "2025-10-21T19:33" and return a timezone-naive datetime
    representing the user's local wall-clock time. This value is suitable for inserting
    into SQL DATETIME columns (which are timezone-agnostic).

    Behavior:
    - If the input has no timezone (e.g., from <input type="datetime-local">), keep values as-is.
    - If the input has a timezone or 'Z', convert to local time and then drop tzinfo.
    - Seconds default to 0 unless specified via fill_with/fixed_* arguments.
    - Microseconds can be set via fixed_microseconds or fixed_milliseconds.
    """
    raw = raw.strip()
    s_norm = raw.replace("Z", "+00:00")
    dt = datetime.fromisoformat(s_norm)

    # If tz-aware, convert to local time and drop tzinfo; if naive, leave as-is
    if dt.tzinfo is not None:
        # Convert to OS local time then strip tzinfo
        local_dt = dt.astimezone()  # system local timezone
        dt = local_dt.replace(tzinfo=None)

    # helpers and normalization
    def clamp_ms(ms: int) -> int:
        return max(0, min(999, ms))

    def clamp_us(us: int) -> int:
        return max(0, min(999999, us))

    def get_usec(base_us: int) -> int:
        if fixed_microseconds is not None:
            return clamp_us(int(fixed_microseconds))
        if fixed_milliseconds is not None:
            return clamp_ms(int(fixed_milliseconds)) * 1000
        return base_us

    if fill_with == "zeros":
        sec = 0 if fixed_seconds is None else int(fixed_seconds)
        usec = get_usec(0)
        return dt.replace(second=sec, microsecond=usec)

    if fill_with == "preserve":
        sec = dt.second if fixed_seconds is None else int(fixed_seconds)
        usec = get_usec(dt.microsecond)
        return dt.replace(second=sec, microsecond=usec)

    if fill_with == "server":
        now = datetime.now()  # local time
        sec = now.second if fixed_seconds is None else int(fixed_seconds)
        usec = get_usec(now.microsecond)
        return dt.replace(second=sec, microsecond=usec)

    if fill_with == "fixed":
        if fixed_seconds is None:
            raise ValueError("fixed_seconds must be provided for fill_with='fixed'")
        if fixed_milliseconds is None and fixed_microseconds is None:
            raise ValueError(
                "fixed_milliseconds or fixed_microseconds must be provided for fill_with='fixed'"
            )
        sec = int(fixed_seconds)
        usec = get_usec(0)
        return dt.replace(second=sec, microsecond=usec)

    raise ValueError("unsupported fill_with value")


def now_local_iso() -> str:
    """Return current local time as ISO 8601 string with microsecond precision."""
    return datetime.now().isoformat(sep="T", timespec="microseconds")
