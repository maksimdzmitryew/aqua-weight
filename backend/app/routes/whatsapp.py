"""WhatsApp notification routes for helping users and test messages."""

import json
import logging
from datetime import datetime, timezone
from typing import Annotated, Any, List

from fastapi import APIRouter, Depends, HTTPException, status

from ..helpers.whatsapp_notify import (
    get_thirsty_plants,
    format_digest_message,
    send_whatsapp_message,
)
from ..security import get_db, require_authenticated_user
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

    sent, error = send_whatsapp_message(target, message)

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

    sent, _ = send_whatsapp_message(whatsapp_number, message)

    if sent:
        # Record notification timestamp
        settings["whatsapp_last_notification"] = {
            "sent_at": datetime.now(timezone.utc).isoformat(),
            "triggered_by": "helping_user",
            "thirsty_plants": [p["name"] for p in thirsty_plants],
        }
        service.update_settings(current_user["id"], settings, version)

    return {"thirsty_plants": thirsty_plants, "sent": sent}