import os
from contextlib import contextmanager
import pymysql

__all__ = [
    "get_conn",
    "connect",
    "cursor",
]


def get_conn():
    """Create and return a new PyMySQL connection (autocommit enabled)."""
    return pymysql.connect(
        host=os.getenv("DB_HOST", "db"),
        user=os.getenv("DB_USER", "appuser"),
        password=os.getenv("DB_PASSWORD", "apppass"),
        database=os.getenv("DB_NAME", "appdb"),
        autocommit=True,
    )


@contextmanager
def connect():
    """Context manager that yields a DB connection and closes it afterwards."""
    conn = get_conn()
    try:
        yield conn
    finally:
        try:
            conn.close()
        except Exception:
            pass


@contextmanager
def cursor(conn):
    """Context manager that yields a DB cursor for a given connection."""
    cur = conn.cursor()
    try:
        yield cur
    finally:
        try:
            cur.close()
        except Exception:
            pass
