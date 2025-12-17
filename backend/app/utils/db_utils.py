from ..db import get_conn as _get_conn


def get_db_connection():
    """Create and return a new database connection using the centralized DB core."""
    return _get_conn()

def return_db_connection(conn):
    """Close and clean up a database connection"""
    if conn:
        conn.close()
