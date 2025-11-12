import pytest

from backend.app.db.ids import is_hex_id, normalize_hex_id, hex_to_bin, bin_to_hex


def test_is_hex_id_variants():
    # Falsy
    assert is_hex_id(None) is False
    assert is_hex_id("") is False
    # Invalid length and characters
    assert is_hex_id("abc") is False
    assert is_hex_id("g" * 32) is False  # non-hex
    # Valid lower and upper, with whitespace
    valid = "0f" * 16
    assert is_hex_id(valid) is True
    assert is_hex_id(valid.upper()) is True
    assert is_hex_id("  " + valid + "  ") is True


def test_normalize_hex_id():
    valid = "AA" * 16
    assert normalize_hex_id(None) is None
    assert normalize_hex_id("") is None
    assert normalize_hex_id("xyz") is None
    # trims and lowercases
    assert normalize_hex_id("  " + valid + "  ") == valid.lower()


def test_hex_to_bin_and_back_roundtrip():
    valid = "12" * 16  # 32 hex chars
    b = hex_to_bin(valid)
    assert isinstance(b, (bytes, bytearray))
    assert len(b) == 16
    # Round-trip
    assert bin_to_hex(b) == valid


def test_hex_to_bin_invalid_inputs():
    assert hex_to_bin(None) is None
    assert hex_to_bin("not-hex") is None
    # wrong length
    assert hex_to_bin("ab" * 10) is None


def test_bin_to_hex_inputs():
    assert bin_to_hex(None) is None
    assert bin_to_hex(b"\x00\x01") == "0001"
    assert bin_to_hex(bytearray(b"\x0a\x0b")) == "0a0b"


def test_hex_to_bin_handles_fromhex_exception(monkeypatch):
    # Force the ids module to use a fake bytes with a fromhex that raises, to hit ids.py:35–36
    valid = "ab" * 16

    class FakeBytes:
        @classmethod
        def fromhex(cls, s):
            raise ValueError("boom")

    # Patch the name `bytes` in the ids module's global namespace
    import backend.app.db.ids as ids_mod

    monkeypatch.setattr(ids_mod, "bytes", FakeBytes, raising=False)

    assert hex_to_bin(valid) is None
