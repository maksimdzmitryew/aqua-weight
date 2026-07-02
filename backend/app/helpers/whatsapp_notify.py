"""WhatsApp notification helper functions."""

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

from ..db.core import cursor

logger = logging.getLogger(__name__)

DEFAULT_WATER_THRESHOLD_PCT = 40


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


DEFAULT_TEMPLATE_NAME = "jaspers_market_plain_text_v1"


def send_whatsapp_message(group_id: str, message: str) -> tuple[bool, str]:
    """Send a message via WhatsApp Business API using a template.

    The template is defined in Meta WhatsApp Manager. The ``message`` arg is
    logged for debugging but the template content is controlled by Meta.

    Returns tuple of (success: bool, error_message: str) for detailed error reporting.
    """
    api_url = os.getenv("WHATSAPP_API_URL")
    api_token = os.getenv("WHATSAPP_API_TOKEN")
    template_name = os.getenv("WHATSAPP_TEMPLATE_NAME", DEFAULT_TEMPLATE_NAME)

    if not api_url or not api_token:
        logger.warning("WhatsApp API credentials not configured. Skipping send.")
        return False, "WhatsApp API credentials not configured on the server"

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                f"{api_url}/messages",
                headers={"Authorization": f"Bearer {api_token}"},
                json={
                    "messaging_product": "whatsapp",
                    "to": group_id,
                    "type": "template",
                    "template": {
                        "name": template_name,
                        "language": {"code": "en_US"},
                    },
                },
            )
            response.raise_for_status()
            logger.info(f"WhatsApp message sent to {group_id} via template '{template_name}'")
            return True, ""
    except httpx.HTTPStatusError as e:
        error_detail = "Unknown error"
        try:
            error_json = e.response.json()
            fb_error = error_json.get("error", {})
            error_detail = fb_error.get("message", str(e))
            # Include error code if available (e.g., "#100 Invalid OAuth access token")
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
