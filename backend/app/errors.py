from typing import TYPE_CHECKING

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# We use PyMySQL in db/core.py, so we catch its base error types.
# Use TYPE_CHECKING to keep mypy from seeing the runtime fallback definitions as redefinitions.
if TYPE_CHECKING:
    from pymysql import MySQLError as MySQLError  # pragma: no cover
    from pymysql.err import Error as PyMySQLError  # pragma: no cover
else:
    try:
        # Import real exceptions when driver is present
        from pymysql import MySQLError as MySQLError
        from pymysql.err import Error as PyMySQLError
    except Exception:  # pragma: no cover - fallback if driver not installed in env
        # Provide local fallbacks for runtime when PyMySQL is unavailable
        class MySQLError(Exception):
            pass

        class PyMySQLError(Exception):
            pass


GENERIC_DB_ERROR_MESSAGE = "Database error. Please try again later."


def register_exception_handlers(app: FastAPI) -> None:
    """Register global exception handlers.

    - Map DB-related exceptions to HTTP 500 with a generic message.
    - Do NOT override HTTPException handling provided by FastAPI.
    """

    @app.exception_handler(MySQLError)
    async def mysql_error_handler(request: Request, exc: Exception) -> JSONResponse:  # noqa: ANN001
        return JSONResponse(status_code=500, content={"detail": GENERIC_DB_ERROR_MESSAGE})

    @app.exception_handler(PyMySQLError)
    async def pymysql_error_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:  # noqa: ANN001
        return JSONResponse(status_code=500, content={"detail": GENERIC_DB_ERROR_MESSAGE})

    # Optional: keep validation and HTTP exceptions default behavior; no custom handler is added for them.
    # FastAPI already provides detailed 422 for RequestValidationError and passes through HTTPException.
