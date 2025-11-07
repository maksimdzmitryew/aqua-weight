from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, constr

HexID = constr(pattern=r"^[0-9a-f]{32}$")

class LocationListItem(BaseModel):
    id: int
    uuid: Optional[HexID] = None
    name: str
    description: Optional[str] = None
    created_at: datetime

class LocationDetail(BaseModel):
    id: int
    uuid: Optional[HexID] = None
    name: str
    description: Optional[str] = None
    created_at: datetime

class LocationCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    sort_order: int = Field(default=0, ge=0)

class LocationUpdateByNameRequest(BaseModel):
    original_name: str
    name: str
