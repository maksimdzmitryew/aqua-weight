import pytest
from fastapi import HTTPException

from backend.app.security import require_api_key


def test_require_api_key_allows_in_test_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_MODE", "1")
    monkeypatch.setenv("API_KEY", "secret")

    require_api_key(None)


def test_require_api_key_allows_when_api_key_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_MODE", "0")
    monkeypatch.delenv("API_KEY", raising=False)

    require_api_key(None)


def test_require_api_key_allows_when_api_key_matches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_MODE", "0")
    monkeypatch.setenv("API_KEY", "secret")

    require_api_key("secret")


def test_require_api_key_raises_when_api_key_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_MODE", "0")
    monkeypatch.setenv("API_KEY", "secret")

    with pytest.raises(HTTPException) as exc_info:
        require_api_key("wrong")

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Unauthorized"
