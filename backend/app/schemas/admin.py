from datetime import datetime
from typing import Annotated, List, Optional
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

class AdminBase(BaseModel):
    """Base model for Admin DTOs enforcing strict payload validation."""
    model_config = ConfigDict(extra="forbid")

class UserListEntry(BaseModel):
    """Entry in the user list for admin management."""
    id_hex: str
    username: str
    global_role: str
    created_at: datetime
    mfa_enabled: bool

    model_config = ConfigDict(from_attributes=True)

class UserListResponse(BaseModel):
    """Response containing a list of users."""
    users: List[UserListEntry]

class RoleUpdateRequest(AdminBase):
    """Payload for updating a user's role."""
    global_role: Annotated[str, StringConstraints(pattern=r"^(admin|customer)$")]

class InviteCreateRequest(AdminBase):
    """Payload for creating a new invitation token."""
    expires_in_days: int = Field(default=7, ge=1, le=30)

class InviteResponse(BaseModel):
    """Response containing the generated invitation token."""
    token: str
    expires_at: datetime
