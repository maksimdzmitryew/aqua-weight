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
    Also enforce safety rules: tests must never use the runtime database.
    """
    # Point to test DB by default (can be overridden by TEST_DB_* envs)
    monkeypatch.setenv("DB_HOST", os.getenv("TEST_DB_HOST", "db"))
    monkeypatch.setenv("DB_USER", os.getenv("TEST_DB_USER", "appuser"))
    monkeypatch.setenv("DB_PASSWORD", os.getenv("TEST_DB_PASSWORD", "apppass"))
    monkeypatch.setenv("DB_NAME", os.getenv("TEST_DB_NAME", "appdb_test"))

    # Safety checks: fail fast if misconfigured
    runtime_db = os.getenv("RUNTIME_DB_NAME", "appdb")
    test_db = os.getenv("DB_NAME")
    assert test_db != runtime_db, (
        f"Tests are configured to use runtime DB name '{runtime_db}'. "
        f"Set TEST_DB_NAME to a dedicated test DB (e.g., 'appdb_test')."
    )
    assert test_db and test_db.endswith("_test"), (
        "Test DB name must end with '_test' to avoid collisions (got: %r)" % test_db
    )
    yield


@pytest.fixture
async def async_client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    """httpx AsyncClient bound to the ASGI app.

    Prefer this for async endpoint testing.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
