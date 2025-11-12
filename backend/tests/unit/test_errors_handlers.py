import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from backend.app.errors import MySQLError, PyMySQLError, GENERIC_DB_ERROR_MESSAGE


@pytest.mark.anyio
async def test_mysql_error_handler_returns_generic_500(app: FastAPI, async_client: AsyncClient):
    async def _raise_mysql_error():  # type: ignore[no-untyped-def]
        # Simulate a low-level DB error raised somewhere in code
        raise MySQLError("boom")

    # Dynamically add a temporary route that raises MySQLError
    app.add_api_route("/__test_raise_mysql_error", _raise_mysql_error, methods=["GET"])  # type: ignore[arg-type]

    resp = await async_client.get("/__test_raise_mysql_error")

    assert resp.status_code == 500
    assert resp.json() == {"detail": GENERIC_DB_ERROR_MESSAGE}


@pytest.mark.anyio
async def test_pymysql_error_handler_returns_generic_500(app: FastAPI, async_client: AsyncClient):
    async def _raise_pymysql_error():  # type: ignore[no-untyped-def]
        # Simulate a driver-specific error class from pymysql.err.Error
        raise PyMySQLError("driver err")

    # Dynamically add a temporary route that raises PyMySQLError
    app.add_api_route("/__test_raise_pymysql_error", _raise_pymysql_error, methods=["GET"])  # type: ignore[arg-type]

    resp = await async_client.get("/__test_raise_pymysql_error")

    assert resp.status_code == 500
    assert resp.json() == {"detail": GENERIC_DB_ERROR_MESSAGE}
