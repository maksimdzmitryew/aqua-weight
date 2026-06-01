from typing import Annotated, Optional
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# Common constraints for reuse across Auth DTOs
PasswordStr = Annotated[str, StringConstraints(min_length=8, max_length=128)]
DeviceIDStr = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]
TOTPCodeStr = Annotated[str, StringConstraints(pattern=r"^\d{6}$")]


class AuthBase(BaseModel):
    """Base model for Auth DTOs enforcing strict payload validation."""

    model_config = ConfigDict(extra="forbid")


class LoginRequest(AuthBase):
    """Payload for user authentication."""

    username: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]
    password: PasswordStr
    device_id: DeviceIDStr
    trust_device: bool = False


class InviteCompleteRequest(AuthBase):
    """Payload for completing a user invitation and enrolling in MFA."""

    token: Annotated[str, StringConstraints(strip_whitespace=True)]
    password: PasswordStr
    device_id: DeviceIDStr
    page_nonce: Annotated[str, StringConstraints(strip_whitespace=True)]
    totp_code: TOTPCodeStr
    totp_secret: Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)]
    trust_device: bool = False
    email: Annotated[
        Optional[str],
        Field(
            default=None,
            max_length=0,
            description="Honeypot field; must be empty if present to pass anti-bot check.",
        ),
    ]


class LogoutRequest(AuthBase):
    """Payload for terminating sessions."""

    device_id: DeviceIDStr


class MFAEnrollRequest(AuthBase):
    """Payload for initial MFA setup."""

    secret: Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)]
    code: TOTPCodeStr


class MFAVerifyRequest(AuthBase):
    """Payload for MFA verification during login flow."""

    mfa_token: Annotated[str, StringConstraints(strip_whitespace=True)]
    code: str  # Can be TOTP or Recovery Code
    trust_device: bool = False


class RecoveryCodesRegenerateRequest(AuthBase):
    """Payload for regenerating recovery codes, requires password verification."""

    password: PasswordStr
