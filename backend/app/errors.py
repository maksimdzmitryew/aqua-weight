from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# We use PyMySQL in db/core.py, so we catch its base error types
try:
    import pymysql
    from pymysql import MySQLError  # type: ignore
    from pymysql.err import Error as PyMySQLError  # type: ignore
except Exception:  # pragma: no cover - fallback if driver not installed in env
    pymysql = None  # type: ignore

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
    async def mysql_error_handler(request: Request, exc: Exception):  # noqa: ANN001
        return JSONResponse(status_code=500, content={"detail": GENERIC_DB_ERROR_MESSAGE})

    @app.exception_handler(PyMySQLError)
    async def pymysql_error_handler(request: Request, exc: Exception):  # noqa: ANN001
        return JSONResponse(status_code=500, content={"detail": GENERIC_DB_ERROR_MESSAGE})

    # Optional: keep validation and HTTP exceptions default behavior; no custom handler is added for them.
    # FastAPI already provides detailed 422 for RequestValidationError and passes through HTTPException.
