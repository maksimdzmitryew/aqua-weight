from typing import Annotated, Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..security import get_db, require_authenticated_user
from ..services.settings_service import SettingsService

router = APIRouter(tags=["settings"])


class SettingsResponse(BaseModel):
    settings: Dict[str, Any]
    version: int


class SettingsUpdateRequest(BaseModel):
    settings: Dict[str, Any]
    version: int | None = None


@router.get("/settings", response_model=SettingsResponse)
async def get_settings(
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
):
    if current_user["id"] is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Settings not available for guest/mock users",
        )

    service = SettingsService(db)
    settings, version = service.get_settings(current_user["id"])
    return {"settings": settings, "version": version}


@router.put("/settings", status_code=status.HTTP_204_NO_CONTENT)
async def update_settings(
    payload: SettingsUpdateRequest,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
):
    if current_user["id"] is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Settings cannot be updated for guest/mock users",
        )

    service = SettingsService(db)
    service.update_settings(current_user["id"], payload.settings, payload.version)
    return
