from __future__ import annotations

from typing import Callable

import pymysql

from .core import get_conn


def get_conn_factory() -> Callable[[], pymysql.connections.Connection]:
    """
    FastAPI dependency that provides a factory function to obtain a PyMySQL
    connection on demand. This is threadpool-friendly and easy to override in
    tests to supply a fake connection.
    """
    return get_conn
