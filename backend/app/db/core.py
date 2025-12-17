import logging
import os
import time
from contextlib import contextmanager
 
import pymysql

__all__ = [
    "get_conn",
    "connect",
    "cursor",
]


def get_conn():
    """Create and return a new PyMySQL connection (autocommit enabled).

    Hardened against intermittent "server has gone away" by pinging the
    connection (with reconnect) before returning it and retrying once on
    transient connection errors.
    """
    host = os.getenv("DB_HOST", "db")
    user = os.getenv("DB_USER", "appuser")
    password = os.getenv("DB_PASSWORD", "apppass")
    # Auto-isolate tests: when TEST_MODE=1 and DB_NAME is not explicitly set,
    # default to appdb_test; otherwise default to appdb.
    test_mode = os.getenv("TEST_MODE") == "1"
    database = os.getenv("DB_NAME") or ("appdb_test" if test_mode else "appdb")

    last_err = None
    for attempt in range(2):
        try:
            conn = pymysql.connect(
                host=host,
                user=user,
                password=password,
                database=database,
                autocommit=True,
                connect_timeout=int(os.getenv("DB_CONNECT_TIMEOUT", "5")),
                read_timeout=int(os.getenv("DB_READ_TIMEOUT", "10")),
                write_timeout=int(os.getenv("DB_WRITE_TIMEOUT", "10")),
                charset="utf8mb4",
                use_unicode=True,
            )
            # Ensure the connection is alive; reconnect transparently if needed
            try:
                conn.ping(reconnect=True)
            except Exception:
                # If ping fails on first try, close and retry once
                try:
                    conn.close()
                except Exception:
                    pass
                raise
            return conn
        except Exception as e:
            logging.error(f"Error connecting to DB: {e}")
            last_err = e
            if attempt == 0:
                time.sleep(0.2)
                continue
            raise
    # Should not reach here, but raise last error defensively
    raise last_err  # type: ignore


@contextmanager
def connect():
    """Context manager that yields a DB connection and closes it afterwards."""
    conn = get_conn()
    try:
        try:
            conn.ping(reconnect=True)
        except Exception:
            # If ping fails here, let get_conn on next call handle retries
            pass
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
