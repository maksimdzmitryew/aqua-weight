import os
import asyncio
from typing import AsyncIterator, Iterator

import pytest
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

# Import the real FastAPI app
from backend.app.main import app as real_app


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    # Let pytest-asyncio/anyio know we use asyncio
    return "asyncio"


@pytest.fixture(scope="session")
def app() -> FastAPI:
    """Provide the FastAPI application for tests.

    Dependency overrides can be wired here when needed.
    """
    return real_app


@pytest.fixture(autouse=True)
def _override_test_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Ensure DB env vars are set to test values and isolated per test run.

    We don't hit the DB in smoke tests, but this prepares for DB-backed tests.
    """
    monkeypatch.setenv("DB_HOST", os.getenv("TEST_DB_HOST", "db"))
    monkeypatch.setenv("DB_USER", os.getenv("TEST_DB_USER", "appuser"))
    monkeypatch.setenv("DB_PASSWORD", os.getenv("TEST_DB_PASSWORD", "apppass"))
    monkeypatch.setenv("DB_NAME", os.getenv("TEST_DB_NAME", "appdb_test"))
    yield


@pytest.fixture
async def async_client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    """httpx AsyncClient bound to the ASGI app.

    Prefer this for async endpoint testing.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
