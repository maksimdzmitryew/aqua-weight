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
from ..db.core import get_conn
from .plants_list import PlantsList
from .credential_manager import (
    get_whatsapp_credentials as get_whatsapp_credentials_from_manager,
    save_whatsapp_credentials as save_whatsapp_credentials_from_manager,
    ensure_whatsapp_credentials_table,
    migrate_old_credentials,
    initialize_whatsapp_credentials_if_needed,
    backup_credentials,
    get_or_create_encryption_key,
    _encrypt_with_fernet,
    _decrypt_with_fernet,
    _generate_bin16_id,
)

logger = logging.getLogger(__name__)

DEFAULT_WATER_THRESHOLD_PCT = 40
DEFAULT_TEMPLATE_NAME = "jaspers_market_plain_text_v1"
DEFAULT_TEMPLATE_LANGUAGE = "en_US"

# Settings key (stored in users.settings_json)
SETTINGS_KEY_DAILY_DIGEST = "whatsapp_daily_digest"

_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")




def get_whatsapp_credentials(conn) -> dict:
    """Fetch WhatsApp credentials from database.

    Returns dict with 'api_url', 'api_token', 'template_name', and 'phone_number_id' keys.
    Uses the new credential manager for encryption/decryption.
    """
    try:
        # Use the new credential manager
        return get_whatsapp_credentials_from_manager(conn)
    except Exception as e:
        logger.error(f"Failed to get WhatsApp credentials: {e}")
        # Return empty credentials structure to prevent 500 errors
        return {
            "api_url": "",
            "api_token": "",
            "template_name": "",
            "phone_number_id": "",
        }


def save_whatsapp_credentials(conn, api_url: str, api_token: str, template_name: str, phone_number_id: str = "") -> bool:
    """Save WhatsApp credentials to database (encrypted)."""
    try:
        # Use the credential manager for encryption (required; no insecure fallbacks).
        return save_whatsapp_credentials_from_manager(conn, api_url, api_token, template_name, phone_number_id)
    except Exception as e:
        logger.error(f"Failed to save WhatsApp credentials: {e}")
        # Don't re-raise - return failure status
        return False


def _generate_bin16_id() -> bytes:
    """Generate a compact 16-byte ID suitable for BINARY(16) primary keys."""
    from .credential_manager import _generate_bin16_id as cm_generate_bin16_id
    return cm_generate_bin16_id()


def render_placeholders(template_text: str, values: Dict[str, str]) -> str:
    """Render {{placeholders}} using an allowlist mapping.

    Unknown placeholders are left unchanged.
    """
    if not template_text:
        return ""

    # Backwards/forwards compatible placeholder aliases.
    # This lets us rename placeholders in templates/UI without breaking stored templates.
    aliases: dict[str, str] = {
        # Daily digest
        "weight_count": "weight_plants_count",
        "weight_plants_count": "weight_count",
        "weight_list": "weight_plants_list",
        "weight_plants_list": "weight_list",
        # Sub-templates
        "location_count": "location_group_count",
        "location_group_count": "location_count",
    }

    def _replace(match: re.Match) -> str:
        key = match.group(1)
        if key in values:
            return str(values[key])
        alias = aliases.get(key)
        if alias and alias in values:
            return str(values[alias])
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

    This is intentionally aligned with the UI's plants list logic (Bulk watering / Daily care),
    which uses the backend-computed ``needs_water`` field as the single source of truth.
    That prevents the WhatsApp digest from disagreeing with the app UI.
    """
    # NOTE: keep the existing signature to avoid touching callers. `conn` is not used here
    # because PlantsList manages its own connection lifecycle.
    current_user = {"id": owner_user_id, "global_role": "user"}
    default_threshold = float(DEFAULT_WATER_THRESHOLD_PCT)

    items = PlantsList.fetch_all(
        status="active",
        mode="manual",
        default_threshold=default_threshold,
        current_user=current_user,
    )

    thirsty_items = [p for p in items if p.get("needs_water", False)]

    results: list[dict[str, Any]] = []
    for plant in thirsty_items:
        threshold = plant.get("recommended_water_threshold_pct")
        if threshold is None:
            threshold = DEFAULT_WATER_THRESHOLD_PCT

        results.append(
            {
                "name": plant.get("name"),
                "location": plant.get("location") or "Unknown",
                "water_retained_pct": plant.get("water_retained_pct"),
                "min_water_retention": threshold,
            }
        )
    return results


def _build_thirsty_list(thirsty_plants: list[dict], template: str | None = None) -> str:
    """Build the thirsty list using optional template or default format.

    Template placeholders:
    - {{name}} - plant name
    - {{location}} - plant location
    - {{location_group}} - location header (only rendered for first plant in each location group)
    - {{location_group_count}} - number of plants in the location group
    - {{water_retained_pct}} - water retained percentage
    - {{min_water_retention}} - minimum required water retention value
    """
    if not thirsty_plants:
        # Even if a per-plant template is configured, an empty list should not render
        # placeholder-laden plant rows. Return a plain message instead.
        return "All plants are watered. No watering needed today."

    header_template: str | None = None
    item_template: str | None = template
    if template and "[[AW_LOCATION_GROUP_HEADER]]" in template:
        # Combined template string encoded by the Admin UI.
        # Format:
        # [[AW_LOCATION_GROUP_HEADER]]
        # <header template>
        # [[AW_ITEM_TEMPLATE]]
        # <item template>
        #
        # If the item template is missing, fall back to empty.
        after_header = template.split("[[AW_LOCATION_GROUP_HEADER]]", 1)[1]
        if "[[AW_ITEM_TEMPLATE]]" in after_header:
            header_part, item_part = after_header.split("[[AW_ITEM_TEMPLATE]]", 1)
            header_template = header_part.strip("\n")
            item_template = item_part.strip("\n")
        else:
            header_template = after_header.strip("\n")
            item_template = ""

    # Group by first occurrence of each location, preserving overall order.
    # This intentionally reorders plants to cluster by location for better readability in WhatsApp.
    grouped_by_location: dict[str, list[dict]] = {}
    location_order: list[str] = []
    for plant in thirsty_plants:
        location_key = (plant.get("location") or "").strip() or "no location"
        if location_key not in grouped_by_location:
            grouped_by_location[location_key] = []
            location_order.append(location_key)
        grouped_by_location[location_key].append(plant)

    lines: list[str] = []
    for location_key in location_order:
        plants = grouped_by_location[location_key]
        group_count_str = str(len(plants))

        if header_template:
            header_values = {
                "location_group": location_key,
                "location_count": group_count_str,
            }
            header_rendered = render_placeholders(header_template, header_values).strip("\n")
            if header_rendered:
                lines.append(header_rendered)

        for idx, plant in enumerate(plants):
            name = plant.get("name") or "Unknown"
            # Keep the original "Unknown" behavior for per-plant location placeholder,
            # while grouping uses "no location" as requested.
            location = plant.get("location") or "Unknown"
            retained = plant.get("water_retained_pct")
            retained_str = f"{retained}%" if retained is not None else "N/A"
            min_retention = plant.get("min_water_retention")
            min_retention_str = f"{min_retention}%" if min_retention is not None else "N/A"

            if item_template:
                plant_values = {
                    "name": name,
                    "location": location,
                    # Kept for backwards compatibility, but "moved" to the header template in the UI.
                    "location_group": location_key if idx == 0 else "",
                    "location_count": group_count_str if idx == 0 else "",
                    "water_retained_pct": retained_str,
                    "min_water_retention": min_retention_str,
                }
                rendered = render_placeholders(item_template, plant_values)
                lines.append(rendered)
            else:
                # Default remains per-plant; grouping only applies to templates.
                lines.append(f"- {name} ({location}) water retained: {retained_str}")
    return "\n".join(lines)


def get_weight_plants(conn, owner_user_id: bytes) -> List[Dict[str, Any]]:
    """Query plants that need weighing for the owner.

    Returns plants ordered by sort_order, then by name for stable ordering.
    Only includes plants that were weighed more than 18 hours ago or never weighed.
    Each plant includes days_since_last_weigh for the weight plants template.
    """
    threshold = datetime.now(timezone.utc) - timedelta(hours=18)
    with cursor(conn) as cur:
        cur.execute(
            """
            SELECT p.id, p.name, l.name AS location_name,
                   latest_pm.measured_at, latest_pm.measured_weight_g
            FROM plants p
            LEFT JOIN locations l ON p.location_id = l.id
            LEFT JOIN (
                SELECT plant_id, measured_at, measured_weight_g,
                       ROW_NUMBER() OVER (PARTITION BY plant_id ORDER BY measured_at DESC) AS rn
                FROM plants_measurements
            ) latest_pm ON latest_pm.plant_id = p.id AND latest_pm.rn = 1
            WHERE p.owner_id = %s
              AND p.archive = 0
              AND (latest_pm.measured_at IS NULL OR latest_pm.measured_at < %s)
            ORDER BY p.sort_order ASC, p.name ASC
            """,
            (owner_user_id, threshold),
        )
        rows = cur.fetchall()

    now = datetime.now(timezone.utc)
    results = []
    for row in rows:
        # SELECT columns:
        # 0 p.id, 1 p.name, 2 location_name, 3 measured_at, 4 measured_weight_g
        measured_at = row[3]
        measured_weight_g = row[4]
        days_since = None
        if measured_at:
            if measured_at.tzinfo is None:
                measured_at = measured_at.replace(tzinfo=timezone.utc)
            days_since = (now - measured_at).days

        results.append({
            "name": row[1],
            "location": row[2] or "Unknown",
            "measured_weight_g": measured_weight_g,
            "measured_at": measured_at,
            "days_since_last_weigh": days_since,
        })
    return results


def _build_weight_plants_list(weight_plants: list[dict], template: str | None = None) -> str:
    """Build the weight plants list using optional template or default format.

    Template placeholders:
    - {{name}} - plant name
    - {{location}} - plant location
    - {{location_group}} - location header (only rendered for first plant in each location group)
    - {{location_group_count}} - number of plants in the location group
    - {{measured_weight_g}} - last measured weight in grams
    - {{days_since_last_weigh}} - days since last weighing
    """
    if not weight_plants:
        default_template = "No weighing data available yet."
        return template if template else default_template

    header_template: str | None = None
    item_template: str | None = template
    if template and "[[AW_LOCATION_GROUP_HEADER]]" in template:
        after_header = template.split("[[AW_LOCATION_GROUP_HEADER]]", 1)[1]
        if "[[AW_ITEM_TEMPLATE]]" in after_header:
            header_part, item_part = after_header.split("[[AW_ITEM_TEMPLATE]]", 1)
            header_template = header_part.strip("\n")
            item_template = item_part.strip("\n")
        else:
            header_template = after_header.strip("\n")
            item_template = ""

    # Group by first occurrence of each location, preserving overall order.
    grouped_by_location: dict[str, list[dict]] = {}
    location_order: list[str] = []
    for plant in weight_plants:
        location_key = (plant.get("location") or "").strip() or "no location"
        if location_key not in grouped_by_location:
            grouped_by_location[location_key] = []
            location_order.append(location_key)
        grouped_by_location[location_key].append(plant)

    lines: list[str] = []
    for location_key in location_order:
        plants = grouped_by_location[location_key]
        group_count_str = str(len(plants))

        if header_template:
            header_values = {
                "location_group": location_key,
                "location_group_count": group_count_str,
            }
            header_rendered = render_placeholders(header_template, header_values).strip("\n")
            if header_rendered:
                lines.append(header_rendered)

        for idx, plant in enumerate(plants):
            name = plant.get("name") or "Unknown"
            # Keep original per-plant placeholder behavior.
            location = plant.get("location") or "Unknown"
            weight = plant.get("measured_weight_g")
            weight_str = f"{weight}g" if weight is not None else "N/A"
            days_since = plant.get("days_since_last_weigh")
            # Templates often use "... {{days_since_last_weigh}} days ago".
            # Return a bare number string to avoid "day(s) days ago".
            days_str = str(days_since) if days_since is not None else "N/A"

            if item_template:
                plant_values = {
                    "name": name,
                    "location": location,
                    "location_group": location_key if idx == 0 else "",
                    "location_count": group_count_str if idx == 0 else "",
                    "measured_weight_g": weight_str,
                    "days_since_last_weigh": days_str,
                }
                rendered = render_placeholders(item_template, plant_values)
                lines.append(rendered)
            else:
                # Default remains per-plant; grouping only applies to templates.
                lines.append(f"- {name} ({location}): {weight_str}, last weighed: {days_str}")
    return "\n".join(lines)


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
        phone_number_id = creds.get("phone_number_id")
    else:
        api_url = os.getenv("WHATSAPP_API_URL")
        api_token = os.getenv("WHATSAPP_API_TOKEN")
        template_name = os.getenv("WHATSAPP_TEMPLATE_NAME", DEFAULT_TEMPLATE_NAME)
        phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID")

    if not api_url or not api_token:
        logger.warning("WhatsApp API credentials not configured. Skipping send.")
        return False, "WhatsApp API credentials not configured on the server"

    # Build the messages URL using phone_number_id if available
    messages_url = api_url.rstrip("/")
    if "{phone_number_id}" in messages_url and phone_number_id:
        # Replace placeholder with actual phone number ID
        messages_url = messages_url.replace("{phone_number_id}", phone_number_id)
    elif phone_number_id and not messages_url.endswith("/messages"):
        # Append phone_number_id to URL (backward compatibility)
        messages_url = f"{messages_url}/{phone_number_id}/messages"
    elif not messages_url.endswith("/messages"):
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
        phone_number_id = creds.get("phone_number_id")
    else:
        api_url = os.getenv("WHATSAPP_API_URL")
        api_token = os.getenv("WHATSAPP_API_TOKEN")
        phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID")

    if not api_url or not api_token:
        logger.warning("WhatsApp API credentials not configured. Skipping send.")
        return False, "WhatsApp API credentials not configured on the server"

    if not body or not body.strip():
        return False, "Message body is empty"

    messages_url = api_url.rstrip("/")
    if "{phone_number_id}" in messages_url and phone_number_id:
        # Replace placeholder with actual phone number ID
        messages_url = messages_url.replace("{phone_number_id}", phone_number_id)
    elif phone_number_id and not messages_url.endswith("/messages"):
        # Append phone_number_id to URL (backward compatibility)
        messages_url = f"{messages_url}/{phone_number_id}/messages"
    elif not messages_url.endswith("/messages"):
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
