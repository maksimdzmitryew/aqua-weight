import json
import logging
from typing import Any, Dict, Tuple

import pymysql

from ..db.core import cursor

ALLOWED_SETTINGS_KEYS = {
    "theme": str,
    "language": str,
    "notifications_enabled": bool,
    "default_view": str,
}


class SettingsService:
    def __init__(self, db_conn: pymysql.connections.Connection):
        self.db_conn = db_conn

    def get_settings(self, user_id: bytes) -> Tuple[Dict[str, Any], int]:
        """Fetch user settings and schema version from the database."""
        with cursor(self.db_conn) as cur:
            sql = "SELECT settings_json, settings_schema_version FROM users WHERE id = %s"
            cur.execute(sql, (user_id,))
            result = cur.fetchone()
            if not result:
                return {}, 1

            settings_json, version = result

            # Handle potential variations in how PyMySQL/MariaDB returns JSON columns
            if isinstance(settings_json, str):
                try:
                    settings_data = json.loads(settings_json)
                except json.JSONDecodeError:
                    logging.error(f"Failed to decode settings_json for user {user_id.hex()}")
                    settings_data = {}
            elif isinstance(settings_json, dict):
                settings_data = settings_json
            else:
                settings_data = {}

            return settings_data, version

    def validate_settings(self, settings: Dict[str, Any]) -> None:
        """Validate settings against the whitelist and types."""
        for key, value in settings.items():
            if key not in ALLOWED_SETTINGS_KEYS:
                raise ValueError(f"Setting key '{key}' is not allowed")

            expected_type = ALLOWED_SETTINGS_KEYS[key]
            if not isinstance(value, expected_type):
                raise ValueError(f"Setting '{key}' must be of type {expected_type.__name__}")

    def update_settings(
        self, user_id: bytes, settings: Dict[str, Any], version: int | None = None
    ) -> bool:
        """Update user settings with full replacement."""
        self.validate_settings(settings)
        with cursor(self.db_conn) as cur:
            # MariaDB JSON column accepts a JSON string
            settings_str = json.dumps(settings)
            if version is not None:
                sql = "UPDATE users SET settings_json = %s, settings_schema_version = %s, updated_at = NOW(6) WHERE id = %s"
                cur.execute(sql, (settings_str, version, user_id))
            else:
                sql = "UPDATE users SET settings_json = %s, updated_at = NOW(6) WHERE id = %s"
                cur.execute(sql, (settings_str, user_id))
            return True
