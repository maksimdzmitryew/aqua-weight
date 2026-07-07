"""WhatsApp notification helper functions."""

import base64
import hashlib
import hmac
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

from ..db.core import cursor

logger = logging.getLogger(__name__)

DEFAULT_WATER_THRESHOLD_PCT = 40
DEFAULT_TEMPLATE_NAME = "jaspers_market_plain_text_v1"
DEFAULT_TEMPLATE_LANGUAGE = "en_US"

# Settings key (stored in users.settings_json)
SETTINGS_KEY_DAILY_DIGEST = "whatsapp_daily_digest"

# Encryption key for WhatsApp credentials (from environment).
# Must be stable across restarts or DB-stored credentials cannot be decrypted.
_ENCRYPTION_KEY_VALUE = os.getenv("CREDENTIALS_ENCRYPTION_KEY")
_ENCRYPTION_KEY = (
    _ENCRYPTION_KEY_VALUE.encode().ljust(32, b'=')[:32]
    if _ENCRYPTION_KEY_VALUE
    else None
)

_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


def _xor_encrypt(data: bytes, key: bytes) -> bytes:
    """Simple XOR encryption with key cycling."""
    result = bytearray(len(data))
    for i, b in enumerate(data):
        result[i] = b ^ key[i % len(key)]
    return bytes(result)


def _encrypt(value: str) -> str:
    """Encrypt a value using XOR + base64 encoding with HMAC signature.

    Format: base64(xor_data) + '.' + base64(hmac_signature)
    """
    if not value:
        return ""
    if _ENCRYPTION_KEY is None:
        raise ValueError("CREDENTIALS_ENCRYPTION_KEY is not configured")
    data = value.encode()
    encrypted = _xor_encrypt(data, _ENCRYPTION_KEY)
    signature = hmac.new(_ENCRYPTION_KEY, encrypted, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(encrypted).decode() + "." + base64.urlsafe_b64encode(signature).decode()


def _decrypt(value: str) -> str:
    """Decrypt a value encrypted with _encrypt."""
    if not value:
        return ""
    if _ENCRYPTION_KEY is None:
        raise ValueError("CREDENTIALS_ENCRYPTION_KEY is not configured")
    try:
        encrypted_b64, sig_b64 = value.rsplit(".", 1)
        encrypted = base64.urlsafe_b64decode(encrypted_b64.encode())
        signature = base64.urlsafe_b64decode(sig_b64.encode())

        # Verify HMAC
        expected_sig = hmac.new(_ENCRYPTION_KEY, encrypted, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected_sig):
            raise ValueError("Invalid signature - data may have been tampered with")

        decrypted = _xor_encrypt(encrypted, _ENCRYPTION_KEY)
        return decrypted.decode()
    except Exception as e:
        logger.error(f"Decryption failed: {e}")
        raise ValueError(f"Decryption failed: {e}")


def ensure_whatsapp_credentials_table(conn) -> None:
    """Ensure the whatsapp_credentials table exists."""
    with cursor(conn) as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS whatsapp_credentials (
                id BINARY(16) NOT NULL,
                api_url TEXT NOT NULL,
                api_token TEXT NOT NULL,
                template_name TEXT NOT NULL,
                active TINYINT(1) NOT NULL DEFAULT 1,
                created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                PRIMARY KEY (id),
                KEY idx_whatsapp_active (active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
        """)


def get_whatsapp_credentials(conn) -> dict:
    """Fetch WhatsApp credentials from database, falling back to environment variables.

    Returns dict with 'api_url', 'api_token', and 'template_name' keys.
    """
    try:
        ensure_whatsapp_credentials_table(conn)
    except Exception as e:
        logger.warning(f"Could not ensure table exists: {e}")

    with cursor(conn) as cur:
        cur.execute(
            "SELECT api_url, api_token, template_name FROM whatsapp_credentials WHERE active = 1 LIMIT 1"
        )
        row = cur.fetchone()
        if row:
            try:
                return {
                    "api_url": _decrypt(row[0]) if row[0] else None,
                    "api_token": _decrypt(row[1]) if row[1] else None,
                    "template_name": _decrypt(row[2]) if row[2] else None,
                }
            except Exception as e:
                logger.error(f"Failed to decrypt WhatsApp credentials: {e}")

    # Fallback to environment variables
    return {
        "api_url": os.getenv("WHATSAPP_API_URL"),
        "api_token": os.getenv("WHATSAPP_API_TOKEN"),
        "template_name": os.getenv("WHATSAPP_TEMPLATE_NAME"),
    }


def save_whatsapp_credentials(conn, api_url: str, api_token: str, template_name: str) -> bool:
    """Save WhatsApp credentials to database (encrypted)."""
    try:
        ensure_whatsapp_credentials_table(conn)

        cred_id = _generate_bin16_id()

        with cursor(conn) as cur:
            # Deactivate existing credentials
            cur.execute("UPDATE whatsapp_credentials SET active = 0")
            # Insert new credentials
            cur.execute(
                "INSERT INTO whatsapp_credentials (id, api_url, api_token, template_name, active) VALUES (%s, %s, %s, %s, 1)",
                (cred_id, _encrypt(api_url), _encrypt(api_token), _encrypt(template_name))
            )
        return True
    except Exception as e:
        logger.error(f"Failed to save WhatsApp credentials: {e}")
        return False


def _generate_bin16_id() -> bytes:
    """Generate a compact 16-byte ID suitable for BINARY(16) primary keys."""
    import secrets
    import time

    ts = int(time.time() * 1000)  # milliseconds, fits in 8 bytes
    rand = secrets.token_bytes(8)  # 8 random bytes
    return ts.to_bytes(8, "big") + rand


def render_placeholders(template_text: str, values: Dict[str, str]) -> str:
    """Render {{placeholders}} using an allowlist mapping.

    Unknown placeholders are left unchanged.
    """
    if not template_text:
        return ""

    def _replace(match: re.Match) -> str:
        key = match.group(1)
        if key in values:
            return str(values[key])
        return match.group(0)

    return _PLACEHOLDER_RE.sub(_replace, template_text)


def ensure_whatsapp_send_logs_table(conn) -> None:
    """Ensure the whatsapp_send_logs table exists for persisted send-attempt history."""
    with cursor(conn) as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS whatsapp_send_logs (
                id BINARY(16) NOT NULL,
                user_id BINARY(16) NULL,
                to_number VARCHAR(64) NOT NULL,
                message_type VARCHAR(20) NOT NULL,
                triggered_by VARCHAR(20) NOT NULL,
                body TEXT NULL,
                success TINYINT(1) NOT NULL,
                error_message TEXT NULL,
                created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                PRIMARY KEY (id),
                KEY idx_ws_logs_created_at (created_at),
                KEY idx_ws_logs_user_id (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
            """
        )


def record_whatsapp_send_log(
    conn,
    *,
    user_id: bytes | None,
    to_number: str,
    message_type: str,
    triggered_by: str,
    body: str | None,
    success: bool,
    error_message: str | None,
) -> None:
    """Persist a WhatsApp send attempt/result for admin visibility."""
    try:
        ensure_whatsapp_send_logs_table(conn)
    except Exception as e:
        logger.warning(f"Could not ensure whatsapp_send_logs exists: {e}")
        # Still attempt insert; may fail and be logged below.

    try:
        log_id = _generate_bin16_id()
        with cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO whatsapp_send_logs
                    (id, user_id, to_number, message_type, triggered_by, body, success, error_message)
                VALUES
                    (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    log_id,
                    user_id,
                    to_number,
                    message_type,
                    triggered_by,
                    body,
                    1 if success else 0,
                    error_message,
                ),
            )
    except Exception as e:
        logger.error(f"Failed to record WhatsApp send log: {e}")


def get_thirsty_plants(conn, owner_user_id: bytes) -> List[Dict[str, Any]]:
    """Query plants that need watering for the owner.

    Uses the latest measurement from ``plants_measurements`` to derive
    ``water_retained_pct`` (approximated as 100 - water_loss_total_pct).
    Falls back to "needs water" when no measurement exists.
    """
    with cursor(conn) as cur:
        cur.execute(
            """
            SELECT p.id, p.name, p.identify_hint, p.recommended_water_threshold_pct,
                   latest_pm.water_loss_total_pct, l.name AS location_name
            FROM plants p
            LEFT JOIN locations l ON p.location_id = l.id
            LEFT JOIN (
                SELECT plant_id, water_loss_total_pct,
                       ROW_NUMBER() OVER (PARTITION BY plant_id ORDER BY measured_at DESC) AS rn
                FROM plants_measurements
            ) latest_pm ON latest_pm.plant_id = p.id AND latest_pm.rn = 1
            WHERE p.owner_id = %s
              AND p.archive = 0
              AND (
                latest_pm.water_loss_total_pct IS NULL
                OR (100 - latest_pm.water_loss_total_pct) <= COALESCE(p.recommended_water_threshold_pct, 40)
              )
            ORDER BY p.name ASC
            """,
            (owner_user_id,),
        )
        rows = cur.fetchall()
    return [
        {
            "name": row[1],
            "location": row[5] or "Unknown",
            "water_retained_pct": round(100 - row[3], 1) if row[3] is not None else None,
        }
        for row in rows
    ]


def format_digest_message(thirsty_plants: List[Dict[str, Any]], helpers_count: int) -> str:
    """Format a WhatsApp-friendly text digest listing thirsty plants."""
    if not thirsty_plants:
        return "🌱 *Aqua Weight Daily Digest*\n\nAll plants are happy! No watering needed today."

    lines = ["🌱 *Aqua Weight Daily Digest*", ""]
    lines.append(f"📋 {len(thirsty_plants)} plant(s) need watering:")
    lines.append("")

    for plant in thirsty_plants:
        retained = plant.get("water_retained_pct")
        retained_str = f"{retained}%" if retained is not None else "N/A"
        lines.append(f"• {plant['name']} ({plant['location']}) — Water retained: {retained_str}")

    if helpers_count > 0:
        lines.append("")
        lines.append(f"👥 {helpers_count} helper(s) can assist with watering.")

    lines.append("")
    lines.append("_Sent by Aqua Weight_")
    return "\n".join(lines)


def send_whatsapp_message(group_id: str, message: str, conn=None) -> tuple[bool, str]:
    """Send a message via WhatsApp Business API using an approved template.

    Uses credentials from database (encrypted) with fallback to environment variables.
    The ``message`` arg is retained for the shared caller contract; the current
    template payload does not include body parameters.

    Returns tuple of (success: bool, error_message: str) for detailed error reporting.
    """
    # Get credentials from DB (with env fallback)
    if conn:
        creds = get_whatsapp_credentials(conn)
        api_url = creds.get("api_url")
        api_token = creds.get("api_token")
        template_name = creds.get("template_name", DEFAULT_TEMPLATE_NAME)
    else:
        api_url = os.getenv("WHATSAPP_API_URL")
        api_token = os.getenv("WHATSAPP_API_TOKEN")
        template_name = os.getenv("WHATSAPP_TEMPLATE_NAME", DEFAULT_TEMPLATE_NAME)

    if not api_url or not api_token:
        logger.warning("WhatsApp API credentials not configured. Skipping send.")
        return False, "WhatsApp API credentials not configured on the server"

    messages_url = api_url.rstrip("/")
    if not messages_url.endswith("/messages"):
        messages_url = f"{messages_url}/messages"

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                messages_url,
                headers={
                    "Authorization": f"Bearer {api_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "messaging_product": "whatsapp",
                    "to": group_id,
                    "type": "template",
                    "template": {
                        "name": template_name,
                        "language": {"code": DEFAULT_TEMPLATE_LANGUAGE},
                    },
                },
            )
            response.raise_for_status()
            logger.info(f"WhatsApp message sent to {group_id}")
            return True, ""
    except httpx.HTTPStatusError as e:
        error_detail = "Unknown error"
        try:
            error_json = e.response.json()
            fb_error = error_json.get("error", {})
            error_detail = fb_error.get("message", str(e))
            error_code = fb_error.get("code", fb_error.get("type", ""))
            if error_code:
                error_detail = f"({error_code}) {error_detail}"
        except Exception:
            error_detail = str(e)
        logger.error(f"Failed to send WhatsApp message: {error_detail}")
        return False, error_detail
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Failed to send WhatsApp message: {error_msg}")
        return False, error_msg


def send_whatsapp_text_message(to_number: str, body: str, conn=None) -> tuple[bool, str]:
    """Send a free-text WhatsApp message via the Cloud API.

    This uses the /messages endpoint with type="text". WhatsApp policy may reject
    this outside the customer-initiated 24h window; callers decide how to surface that.
    """
    if conn:
        creds = get_whatsapp_credentials(conn)
        api_url = creds.get("api_url")
        api_token = creds.get("api_token")
    else:
        api_url = os.getenv("WHATSAPP_API_URL")
        api_token = os.getenv("WHATSAPP_API_TOKEN")

    if not api_url or not api_token:
        logger.warning("WhatsApp API credentials not configured. Skipping send.")
        return False, "WhatsApp API credentials not configured on the server"

    if not body or not body.strip():
        return False, "Message body is empty"

    messages_url = api_url.rstrip("/")
    if not messages_url.endswith("/messages"):
        messages_url = f"{messages_url}/messages"

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                messages_url,
                headers={
                    "Authorization": f"Bearer {api_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "messaging_product": "whatsapp",
                    "to": to_number,
                    "type": "text",
                    "text": {"body": body},
                },
            )
            response.raise_for_status()
            logger.info(f"WhatsApp text message sent to {to_number}")
            return True, ""
    except httpx.HTTPStatusError as e:
        error_detail = "Unknown error"
        try:
            error_json = e.response.json()
            fb_error = error_json.get("error", {})
            error_detail = fb_error.get("message", str(e))
            error_code = fb_error.get("code", fb_error.get("type", ""))
            if error_code:
                error_detail = f"({error_code}) {error_detail}"
        except Exception:
            error_detail = str(e)
        logger.error(f"Failed to send WhatsApp text message: {error_detail}")
        return False, error_detail
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Failed to send WhatsApp text message: {error_msg}")
        return False, error_msg


def should_skip_notification(settings: dict) -> bool:
    """Check if notification should be skipped (helping user requested < 24h ago).

    Reads the last notification timestamp from the user's settings_json.
    """
    last = settings.get("whatsapp_last_notification")
    if not last:
        return False

    sent_at_str = last.get("sent_at")
    triggered_by = last.get("triggered_by")

    if not sent_at_str:
        return False

    try:
        sent_at = datetime.fromisoformat(sent_at_str)
    except (ValueError, TypeError):
        return False

    if sent_at.tzinfo is None:
        sent_at = sent_at.replace(tzinfo=timezone.utc)

    if (datetime.now(timezone.utc) - sent_at) < timedelta(hours=24):
        if triggered_by == "helping_user":
            return True
    return False
