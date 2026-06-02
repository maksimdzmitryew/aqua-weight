from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from ..services.auth_service import AuthService
from ..schemas.auth import (
    DeviceListResponse,
    InviteCompleteRequest,
    LoginRequest,
    LogoutRequest,
    MFAEnrollRequest,
    MFAVerifyRequest,
    RecoveryCodesRegenerateRequest,
)
from ..security import (
    generate_page_nonce,
    get_db,
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
    request: Request,
    response: Response,
    db: Annotated[Any, Depends(get_db)],
):
    """
    Authenticate a user and initiate a session.
    If MFA is enabled, this may return a challenge instead of full tokens.
    """
    auth_service = AuthService(db)
    try:
        user_agent = request.headers.get("user-agent")
        result = auth_service.login(
            username=payload.username,
            password=payload.password,
            device_id_str=payload.device_id,
            user_agent=user_agent,
            trust_device=payload.trust_device,
            device_name=payload.device_name,
        )

        if result.get("mfa_required"):
            return result

        refresh_token = result.get("refresh_token")
        response.set_cookie(
            key="refresh_token",
            value=refresh_token,
            httponly=True,
            secure=True,
            samesite="strict",
        )

        return {
            "access_token": result.get("access_token"),
            "token_type": "bearer",
            "user": result.get("user"),
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )


@router.post("/invite/complete")
async def invite_complete(
    payload: InviteCompleteRequest,
    request: Request,
    response: Response,
    db: Annotated[Any, Depends(get_db)],
):
    """
    Complete the invitation flow, set a password, and enroll in MFA.
    Enforces honeypot and page nonce verification.
    """
    # 1. Honeypot check
    if payload.email:
        # Silently fail or return generic error to deter bots
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid request",
        )

    # 2. Page nonce check (Anti-bot minimum time-on-page)
    if not verify_page_nonce(payload.page_nonce, request):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or expired page nonce",
        )

    # 3. Process invite completion
    auth_service = AuthService(db)
    try:
        user_agent = request.headers.get("user-agent")
        access_token, refresh_token, recovery_codes = auth_service.complete_invite(
            token=payload.token,
            password=payload.password,
            totp_secret=payload.totp_secret,
            totp_code=payload.totp_code,
            device_id_str=payload.device_id,
            user_agent=user_agent,
            trust_device=payload.trust_device,
            device_name=payload.device_name,
        )

        response.set_cookie(
            key="refresh_token",
            value=refresh_token,
            httponly=True,
            secure=True,  # Should be True in production (HTTPS)
            samesite="strict",
        )

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "recovery_codes": recovery_codes,
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/refresh")
async def refresh(
    request: Request,
    response: Response,
    device_id: Annotated[str, Depends(get_device_id)],
    db: Annotated[Any, Depends(get_db)],
):
    """
    Exchange a valid refresh token cookie for a new access token and a rotated refresh token.
    Implements strict rotation and reuse detection.
    """
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token missing",
        )

    auth_service = AuthService(db)
    try:
        access_token, new_refresh_token, user_data = auth_service.rotate_tokens(
            refresh_token=refresh_token,
            device_id_str=device_id,
        )

        response.set_cookie(
            key="refresh_token",
            value=new_refresh_token,
            httponly=True,
            secure=True,
            samesite="strict",
        )

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": user_data,
        }
    except ValueError as e:
        # Map rotation/expiration errors to 401
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )


@router.post("/mfa/verify")
async def mfa_verify(
    payload: MFAVerifyRequest,
    request: Request,
    response: Response,
    db: Annotated[Any, Depends(get_db)],
):
    """
    Verify a TOTP code during the login flow.
    """
    auth_service = AuthService(db)
    try:
        user_agent = request.headers.get("user-agent")
        access_token, refresh_token, user_data = auth_service.verify_mfa(
            mfa_token=payload.mfa_token,
            totp_code=payload.code,
            user_agent=user_agent,
            trust_device=payload.trust_device,
            device_name=payload.device_name,
        )

        response.set_cookie(
            key="refresh_token",
            value=refresh_token,
            httponly=True,
            secure=True,
            samesite="strict",
        )

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": user_data,
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )


@router.get(
    "/mfa/enroll",
    dependencies=[Depends(require_authenticated_user)],
)
async def mfa_enroll_get(
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
):
    """
    Get a new TOTP secret for MFA setup.
    """
    auth_service = AuthService(db)
    try:
        secret = auth_service.generate_mfa_setup(current_user["id"])
        return {"secret": secret}
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post(
    "/mfa/enroll",
)
async def mfa_enroll(
    payload: MFAEnrollRequest,
    request: Request,
    response: Response,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    device_id: Annotated[str, Depends(get_device_id)],
    db: Annotated[Any, Depends(get_db)],
):
    """
    Set up MFA for an already authenticated user.
    Verifies the first code and issues new tokens.
    """
    auth_service = AuthService(db)
    try:
        user_agent = request.headers.get("user-agent")
        access_token, refresh_token, recovery_codes = auth_service.enroll_mfa(
            user_id=current_user["id"],
            secret=payload.secret,
            code=payload.code,
            device_id_str=device_id,
            user_agent=user_agent,
        )

        response.set_cookie(
            key="refresh_token",
            value=refresh_token,
            httponly=True,
            secure=True,
            samesite="strict",
        )

        return {
            "message": "MFA enrollment successful",
            "enrolled_at": datetime.now(timezone.utc).isoformat(),
            "recovery_codes": recovery_codes,
            "access_token": access_token,
            "token_type": "bearer",
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get(
    "/devices",
    response_model=DeviceListResponse,
)
async def get_devices(
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
):
    """
    List all devices that have accessed the authenticated user's account.
    Exposes recognized/trusted markers and last login metadata.
    """
    auth_service = AuthService(db)
    devices = auth_service.get_user_devices(current_user["id"])
    return {"devices": devices}


@router.post(
    "/devices/{device_id}/untrust",
)
async def untrust_device(
    device_id: str,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
):
    """
    Remove trust from a device and revoke all associated refresh tokens.
    """
    auth_service = AuthService(db)
    try:
        auth_service.set_device_trusted(
            user_id=current_user["id"],
            device_id_str=device_id,
            trusted=False,
        )
        return {"message": f"Device {device_id} untrusted and sessions revoked"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post(
    "/logout",
    dependencies=[Depends(require_authenticated_user)],
)
async def logout(
    payload: LogoutRequest,
    request: Request,
    response: Response,
    db: Annotated[Any, Depends(get_db)],
):
    """
    Revoke the current session and refresh token for the specified device.
    Clears the refresh token cookie.
    """
    refresh_token = request.cookies.get("refresh_token")
    if refresh_token:
        auth_service = AuthService(db)
        auth_service.revoke_session(refresh_token)

    response.delete_cookie(key="refresh_token")
    return {"detail": "Logged out"}


@router.post(
    "/recovery-codes/regenerate",
)
async def regenerate_recovery_codes(
    payload: RecoveryCodesRegenerateRequest,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
):
    """
    Regenerate recovery codes for the authenticated user.
    Requires password re-verification and enforces a 24-hour rate limit.
    """
    auth_service = AuthService(db)
    try:
        new_codes = auth_service.regenerate_recovery_codes(
            user_id=current_user["id"],
            password=payload.password,
        )
        return {"recovery_codes": new_codes}
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
