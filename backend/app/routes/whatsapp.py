"""WhatsApp notification routes for helping users and test messages."""

import json
import logging
from datetime import datetime, timezone
from typing import Annotated, Any, List

from fastapi import APIRouter, Depends, HTTPException, status
import pytz

from ..helpers.whatsapp_notify import (
    get_thirsty_plants,
    format_digest_message,
    ensure_whatsapp_send_logs_table,
    record_whatsapp_send_log,
    render_placeholders,
    send_whatsapp_message,
    send_whatsapp_text_message,
    save_whatsapp_credentials,
    SETTINGS_KEY_DAILY_DIGEST,
)
from ..security import get_db, require_authenticated_user, require_admin_user
from ..services.settings_service import SettingsService

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

logger = logging.getLogger(__name__)


@router.get("/helping-users")
async def get_helping_users(
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
) -> List[dict]:
    """Get list of helping users for the authenticated user."""
    service = SettingsService(db)
    settings, _ = service.get_settings(current_user["id"])
    return settings.get("whatsapp_helpers", [])


@router.post("/helping-users")
async def add_helping_user(
    payload: dict,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
) -> dict:
    """Add a helping user."""
    name = payload.get("name", "").strip()
    phone = payload.get("phone", "").strip() or None

    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Helper name is required",
        )

    service = SettingsService(db)
    settings, version = service.get_settings(current_user["id"])
    helpers = settings.get("whatsapp_helpers", [])

    # Generate a simple ID
    import time
    helper_id = f"helper_{int(time.time() * 1000)}"

    new_helper = {"id": helper_id, "name": name, "phone": phone}
    helpers.append(new_helper)

    service.update_settings(current_user["id"], {**settings, "whatsapp_helpers": helpers}, version)

    return new_helper


@router.delete("/helping-users/{helper_id}")
async def delete_helping_user(
    helper_id: str,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
) -> dict:
    """Delete a helping user."""
    service = SettingsService(db)
    settings, version = service.get_settings(current_user["id"])
    helpers = settings.get("whatsapp_helpers", [])

    updated_helpers = [h for h in helpers if h.get("id") != helper_id]

    if len(updated_helpers) == len(helpers):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Helper not found",
        )

    service.update_settings(current_user["id"], {**settings, "whatsapp_helpers": updated_helpers}, version)
    return {"ok": True}


@router.post("/send-test")
async def send_test_message(
    payload: dict,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
) -> dict:
    """Send a test WhatsApp message to verify the number is configured correctly."""
    target = payload.get("to", "").strip()

    if not target:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="WhatsApp number is required",
        )

    # Send a simple test message
    message = "🧪 This is a test message from Aqua Weight. Your WhatsApp integration is working!"

    sent, error = send_whatsapp_text_message(target, message, conn=db)
    record_whatsapp_send_log(
        db,
        user_id=current_user.get("id"),
        to_number=target,
        message_type="text",
        triggered_by="manual_test",
        body=message,
        success=sent,
        error_message=error or None,
    )

    if sent:
        return {"message": "Test message sent successfully!"}
    else:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error or "Failed to send test message. Check WhatsApp API configuration.",
        )


@router.post("/trigger-digest")
async def trigger_digest(
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
) -> dict:
    """Manually trigger a digest of thirsty plants (for vacation mode helpers)."""
    service = SettingsService(db)
    settings, version = service.get_settings(current_user["id"])

    whatsapp_number = settings.get("whatsapp_number")
    if not whatsapp_number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="WhatsApp number not configured",
        )

    helpers = settings.get("whatsapp_helpers", [])
    thirsty_plants = get_thirsty_plants(db, current_user["id"])
    message = format_digest_message(thirsty_plants, helpers_count=len(helpers))

    sent, error = send_whatsapp_text_message(whatsapp_number, message, conn=db)
    record_whatsapp_send_log(
        db,
        user_id=current_user.get("id"),
        to_number=whatsapp_number,
        message_type="text",
        triggered_by="manual",
        body=message,
        success=sent,
        error_message=error or None,
    )

    if sent:
        # Record notification timestamp
        settings["whatsapp_last_notification"] = {
            "sent_at": datetime.now(timezone.utc).isoformat(),
            "triggered_by": "helping_user",
            "thirsty_plants": [p["name"] for p in thirsty_plants],
        }
        service.update_settings(current_user["id"], settings, version)

    return {"thirsty_plants": thirsty_plants, "sent": sent}


# ============================================================================
# Admin routes for WhatsApp credentials management
# ============================================================================

@router.get("/daily-digest")
async def get_daily_digest(
    current_user: Annotated[dict, Depends(require_admin_user)],
    db: Annotated[Any, Depends(get_db)],
) -> dict:
    """Get the admin's daily digest template text."""
    service = SettingsService(db)
    settings, _ = service.get_settings(current_user["id"])
    return {"daily_digest": settings.get(SETTINGS_KEY_DAILY_DIGEST, "") or ""}


@router.post("/daily-digest")
async def save_daily_digest(
    payload: dict,
    current_user: Annotated[dict, Depends(require_admin_user)],
    db: Annotated[Any, Depends(get_db)],
) -> dict:
    """Save the admin's daily digest template text."""
    daily_digest = (payload.get("daily_digest", "") or "").strip()
    service = SettingsService(db)
    settings, version = service.get_settings(current_user["id"])
    settings[SETTINGS_KEY_DAILY_DIGEST] = daily_digest
    service.update_settings(current_user["id"], settings, version)
    return {"ok": True}


def _build_thirsty_list(thirsty_plants: list[dict]) -> str:
    if not thirsty_plants:
        return "All plants are happy. No watering needed today."
    lines: list[str] = []
    for plant in thirsty_plants:
        name = plant.get("name") or "Unknown"
        location = plant.get("location") or "Unknown"
        retained = plant.get("water_retained_pct")
        retained_str = f"{retained}%" if retained is not None else "N/A"
        lines.append(f"- {name} ({location}) water retained: {retained_str}")
    return "\n".join(lines)


@router.post("/daily-digest/send-test")
async def send_daily_digest_test(
    current_user: Annotated[dict, Depends(require_admin_user)],
    db: Annotated[Any, Depends(get_db)],
) -> dict:
    """Render and send the admin's daily digest as a free-text WhatsApp message."""
    service = SettingsService(db)
    settings, _ = service.get_settings(current_user["id"])

    whatsapp_number = (settings.get("whatsapp_number") or "").strip()
    if not whatsapp_number:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="WhatsApp number not configured")

    digest_template = (settings.get(SETTINGS_KEY_DAILY_DIGEST) or "").strip()
    if not digest_template:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Daily digest is empty")

    helpers = settings.get("whatsapp_helpers", [])
    thirsty_plants = get_thirsty_plants(db, current_user["id"])

    # Keep keys explicit and small; unknown placeholders are left unchanged.
    now_berlin = datetime.now(pytz.timezone("Europe/Berlin"))
    values = {
        "date": now_berlin.strftime("%Y-%m-%d"),
        "thirsty_count": str(len(thirsty_plants)),
        "thirsty_list": _build_thirsty_list(thirsty_plants),
        "helpers_count": str(len(helpers)),
        "admin_username": current_user.get("username", ""),
    }

    message = render_placeholders(digest_template, values)
    sent, error = send_whatsapp_text_message(whatsapp_number, message, conn=db)
    record_whatsapp_send_log(
        db,
        user_id=current_user.get("id"),
        to_number=whatsapp_number,
        message_type="text",
        triggered_by="manual_test",
        body=message,
        success=sent,
        error_message=error or None,
    )

    if not sent:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error or "Failed to send daily digest test message",
        )

    return {"ok": True, "sent": True}


@router.get("/logs", dependencies=[Depends(require_admin_user)])
async def get_whatsapp_logs(
    db: Annotated[Any, Depends(get_db)],
    limit: int = 50,
) -> dict:
    """Get recent WhatsApp send attempts (admin only)."""
    if limit < 1:
        limit = 1
    if limit > 200:
        limit = 200

    ensure_whatsapp_send_logs_table(db)
    with db.cursor() as cur:
        cur.execute(
            """
            SELECT id, user_id, to_number, message_type, triggered_by, success, error_message, created_at
            FROM whatsapp_send_logs
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall()

    items = []
    for row in rows:
        log_id, user_id, to_number, message_type, triggered_by, success, error_message, created_at = row
        items.append(
            {
                "id_hex": log_id.hex() if log_id else None,
                "user_id_hex": user_id.hex() if user_id else None,
                "to_number": to_number,
                "message_type": message_type,
                "triggered_by": triggered_by,
                "success": bool(success),
                "error_message": error_message,
                "created_at": created_at.isoformat() if created_at else None,
            }
        )

    return {"items": items}


@router.get("/credentials", dependencies=[Depends(require_admin_user)])
async def get_whatsapp_credentials_route(db: Annotated[Any, Depends(get_db)]) -> dict:
    """Get current WhatsApp API credentials (admin only).

    Returns the configured credentials. Note: api_token is returned as masked value
    for security - use this endpoint to verify configuration, not to retrieve the token.
    """
    from ..helpers.whatsapp_notify import get_whatsapp_credentials
    creds = get_whatsapp_credentials(db)
    return {
        "api_url": creds.get("api_url", ""),
        "api_token": "***MASKED***" if creds.get("api_token") else "",
        "template_name": creds.get("template_name", ""),
        "configured": bool(creds.get("api_url") and creds.get("api_token")),
    }


@router.post("/credentials", dependencies=[Depends(require_admin_user)])
async def save_whatsapp_credentials_route(
    payload: dict,
    db: Annotated[Any, Depends(get_db)],
) -> dict:
    """Save WhatsApp API credentials (admin only).

    Stores credentials encrypted in the database. Existing credentials are
    deactivated before saving new ones.
    """
    api_url = payload.get("api_url", "").strip()
    api_token = payload.get("api_token", "").strip()
    template_name = payload.get("template_name", "").strip()
    if api_token.lower().startswith("bearer "):
        api_token = api_token[7:].strip()

    if not api_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="API URL is required",
        )
    if not api_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="API token is required",
        )
    if not template_name:
        template_name = "jaspers_market_plain_text_v1"  # Default fallback

    success = save_whatsapp_credentials(db, api_url, api_token, template_name)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save credentials",
        )

    return {"ok": True, "message": "Credentials saved successfully"}


@router.post("/credentials/send-test-template")
async def send_template_test_message(
    current_user: Annotated[dict, Depends(require_admin_user)],
    db: Annotated[Any, Depends(get_db)],
) -> dict:
    """Send a test WhatsApp message using the configured Meta template (admin only)."""
    service = SettingsService(db)
    settings, _ = service.get_settings(current_user["id"])

    whatsapp_number = (settings.get("whatsapp_number") or "").strip()
    if not whatsapp_number:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="WhatsApp number not configured")

    sent, error = send_whatsapp_message(whatsapp_number, "", conn=db)
    record_whatsapp_send_log(
        db,
        user_id=current_user.get("id"),
        to_number=whatsapp_number,
        message_type="template",
        triggered_by="manual_test",
        body=None,
        success=sent,
        error_message=error or None,
    )

    if not sent:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error or "Failed to send template test message",
        )

    return {"ok": True, "sent": True}
