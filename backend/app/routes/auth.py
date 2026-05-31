from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..schemas.auth import (
    InviteCompleteRequest,
    LoginRequest,
    LogoutRequest,
    MFAEnrollRequest,
    MFAVerifyRequest,
)
from ..security import (
    generate_page_nonce,
    get_device_id,
    require_authenticated_user,
    verify_page_nonce,
)

router = APIRouter()


@router.get("/invite/page")
async def get_invite_page_nonce(request: Request):
    """
    Issue a short-lived, server-signed nonce to be used for invite completion.
    This serves as an anti-bot measure and ensures the user actually visited the page.
    """
    return {"nonce": generate_page_nonce(request)}


@router.post("/login")
async def login(
    payload: LoginRequest,
    device_id: Annotated[str, Depends(get_device_id)],
):
    """
    Authenticate a user and initiate a session.
    If MFA is enabled, this may return a challenge instead of full tokens.
    """
    # Business logic to be implemented in Milestone 4.2
    return {"detail": "Not implemented"}


@router.post("/invite/complete")
async def invite_complete(
    payload: InviteCompleteRequest,
    request: Request,
):
    """
    Complete the invitation flow, set a password, and enroll in MFA.
    Enforces honeypot and page nonce verification.
    """
    # Honeypot check (Milestone 4.3 requirement, but surface check here is appropriate)
    if payload.email:
        # Silently fail or return generic error to deter bots
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid request",
        )

    # Page nonce check
    if not verify_page_nonce(payload.page_nonce, request):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or expired page nonce",
        )

    # Business logic to be implemented in Milestone 4.2/4.3
    return {"detail": "Not implemented"}


@router.post("/mfa/verify")
async def mfa_verify(
    payload: MFAVerifyRequest,
):
    """
    Verify a TOTP code during the login flow.
    """
    # Business logic to be implemented in Milestone 4.2
    return {"detail": "Not implemented"}


@router.post(
    "/mfa/enroll",
    dependencies=[Depends(require_authenticated_user)],
)
async def mfa_enroll(
    payload: MFAEnrollRequest,
):
    """
    Set up MFA for an already authenticated user.
    """
    # Business logic to be implemented in Milestone 4.2
    return {"detail": "Not implemented"}


@router.post(
    "/logout",
    dependencies=[Depends(require_authenticated_user)],
)
async def logout(
    payload: LogoutRequest,
    device_id: Annotated[str, Depends(get_device_id)],
):
    """
    Revoke the current session and refresh token for the specified device.
    """
    # Business logic to be implemented in Milestone 4.2
    return {"detail": "Not implemented"}
