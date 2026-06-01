from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from ..services.auth_service import AuthService
from ..schemas.auth import (
    InviteCompleteRequest,
    LoginRequest,
    LogoutRequest,
    MFAEnrollRequest,
    MFAVerifyRequest,
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
        access_token, new_refresh_token = auth_service.rotate_tokens(
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
