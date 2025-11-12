import re
from typing import Optional

__all__ = [
    "HEX_RE",
    "is_hex_id",
    "normalize_hex_id",
    "hex_to_bin",
    "bin_to_hex",
]

HEX_RE = re.compile(r"^[0-9a-fA-F]{32}$")


def is_hex_id(s: str | None) -> bool:
    if not s:
        return False
    return bool(HEX_RE.fullmatch(s.strip().lower()))


def normalize_hex_id(s: str | None) -> Optional[str]:
    if not s:
        return None
    ss = s.strip().lower()
    return ss if is_hex_id(ss) else None


def hex_to_bin(h: str | None) -> Optional[bytes]:
    """Convert 32-char hex string to 16-byte value for BINARY(16) columns."""
    hh = normalize_hex_id(h)
    if not hh:
        return None
    try:
        return bytes.fromhex(hh)
    except Exception:
        return None


def bin_to_hex(b: bytes | bytearray | None) -> Optional[str]:
    if isinstance(b, (bytes, bytearray)):
        return b.hex()
    return None
