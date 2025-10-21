from typing import Any
import os
import pymysql

def get_db_connection():
    """Create and return a new database connection"""
    return pymysql.connect(
        host=os.getenv("DB_HOST", "db"),
        user=os.getenv("DB_USER", "appuser"),
        password=os.getenv("DB_PASSWORD", "apppass"),
        database=os.getenv("DB_NAME", "appdb"),
        autocommit=True
    )

def return_db_connection(conn):
    """Close and clean up a database connection"""
    if conn:
        conn.close()
