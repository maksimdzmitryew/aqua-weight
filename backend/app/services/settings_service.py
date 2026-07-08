import json
import logging
from typing import Any, Dict, List, Tuple

import pymysql

from ..db.core import cursor

ALLOWED_SETTINGS_KEYS = {
    "theme": str,
    "language": str,
    "notifications_enabled": bool,
    "default_view": str,
    "plantsListSort": dict,
    "whatsapp_enabled": bool,
    "whatsapp_number": str,
    "whatsapp_helpers": list,
    "whatsapp_last_notification": dict,
    "whatsapp_thirsty_list_template": str,
    "whatsapp_weight_plants_template": str,
}

SYSTEM_SETTINGS_ID = 1


class SettingsService:
    def __init__(self, db_conn: pymysql.connections.Connection):
        self.db_conn = db_conn

    def _ensure_system_settings(self) -> None:
        with cursor(self.db_conn) as cur:
            cur.execute(
                """
                INSERT IGNORE INTO system_settings (id, settings_json, settings_schema_version)
                VALUES (%s, %s, %s)
                """,
                (SYSTEM_SETTINGS_ID, "{}", 1),
            )

    def _parse_settings_json(self, settings_json: Any) -> Dict[str, Any]:
        # Handle potential variations in how PyMySQL/MariaDB returns JSON columns.
        if isinstance(settings_json, str):
            try:
                return json.loads(settings_json)
            except json.JSONDecodeError:
                logging.error("Failed to decode system settings_json")
                return {}
        if isinstance(settings_json, dict):
            return settings_json
        return {}

    def get_settings(self, user_id: bytes) -> Tuple[Dict[str, Any], int]:
        """Fetch system settings and schema version from the database."""
        self._ensure_system_settings()
        with cursor(self.db_conn) as cur:
            sql = "SELECT settings_json, settings_schema_version FROM system_settings WHERE id = %s"
            cur.execute(sql, (SYSTEM_SETTINGS_ID,))
            result = cur.fetchone()
            if not result:
                return {}, 1

            settings_json, version = result
            return self._parse_settings_json(settings_json), version

    def validate_settings(self, settings: Dict[str, Any]) -> None:
        """Validate settings against the whitelist and types.

        Unknown keys are allowed for backward compatibility — only keys in
        the whitelist are type-checked.
        """
        for key, value in settings.items():
            if key not in ALLOWED_SETTINGS_KEYS:
                continue

            expected_type = ALLOWED_SETTINGS_KEYS[key]
            if not isinstance(value, expected_type):
                raise ValueError(f"Setting '{key}' must be of type {expected_type.__name__}")

    def update_settings(
        self, user_id: bytes, settings: Dict[str, Any], version: int | None = None
    ) -> bool:
        """Update system settings with full replacement."""
        self.validate_settings(settings)
        self._ensure_system_settings()
        with cursor(self.db_conn) as cur:
            # MariaDB JSON column accepts a JSON string
            settings_str = json.dumps(settings)
            if version is not None:
                sql = "UPDATE system_settings SET settings_json = %s, settings_schema_version = %s, updated_at = NOW(6) WHERE id = %s"
                cur.execute(sql, (settings_str, version, SYSTEM_SETTINGS_ID))
            else:
                sql = "UPDATE system_settings SET settings_json = %s, updated_at = NOW(6) WHERE id = %s"
                cur.execute(sql, (settings_str, SYSTEM_SETTINGS_ID))
            return True

    def get_whatsapp_enabled_users(self) -> List[Tuple[bytes, Dict[str, Any]]]:
        """Return (user_id, settings) for users with WhatsApp enabled and a group ID set."""
        with cursor(self.db_conn) as cur:
            cur.execute("SELECT id, settings_json FROM users")
            rows = cur.fetchall()

        result = []
        for user_id, settings_json in rows:
            if isinstance(settings_json, str):
                try:
                    settings = json.loads(settings_json)
                except json.JSONDecodeError:
                    continue
            elif isinstance(settings_json, dict):
                settings = settings_json
            else:
                continue

            if settings.get("whatsapp_enabled") and settings.get("whatsapp_number"):
                result.append((user_id, settings))

        return result
