import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status

from ..db import bin_to_hex, cursor, hex_to_bin
from ..schemas.admin import (
    InviteCreateRequest,
    InviteResponse,
    RoleUpdateRequest,
    UserListEntry,
    UserListResponse,
)
from ..security import get_db, get_device_id, require_admin_user

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=UserListResponse)
async def list_users(
    db: Annotated[Any, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin_user)],
):
    """List all users in the system."""
    with cursor(db) as cur:
        cur.execute(
            """
            SELECT u.id, u.username, u.global_role, u.created_at, 
                   CASE WHEN s.secret IS NOT NULL THEN 1 ELSE 0 END as mfa_enabled
            FROM users u
            LEFT JOIN user_totp_secrets s ON u.id = s.user_id
            ORDER BY u.created_at DESC
            """
        )
        rows = cur.fetchall()

    users = [
        UserListEntry(
            id_hex=bin_to_hex(row[0]),
            username=row[1],
            global_role=row[2],
            created_at=row[3],
            mfa_enabled=bool(row[4]),
        )
        for row in rows
    ]
    return UserListResponse(users=users)


@router.patch("/users/{user_id_hex}/role")
async def update_user_role(
    user_id_hex: str,
    payload: RoleUpdateRequest,
    db: Annotated[Any, Depends(get_db)],
    current_user: Annotated[dict, Depends(require_admin_user)],
):
    """Update a user's global role. Admins cannot change their own role."""
    if user_id_hex == current_user["id_hex"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admins cannot change their own role",
        )

    user_id_bin = hex_to_bin(user_id_hex)
    if not user_id_bin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid user ID format",
        )

    with cursor(db) as cur:
        cur.execute("SELECT 1 FROM users WHERE id = %s", (user_id_bin,))
        if not cur.fetchone():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        cur.execute(
            "UPDATE users SET global_role = %s WHERE id = %s",
            (payload.global_role, user_id_bin),
        )

    return {"message": "User role updated successfully"}


@router.post("/users/{user_id_hex}/mfa-reset")
async def reset_user_mfa(
    user_id_hex: str,
    db: Annotated[Any, Depends(get_db)],
    current_user: Annotated[dict, Depends(require_admin_user)],
    current_device_id_str: Annotated[str, Depends(get_device_id)],
):
    """Reset MFA for a user and revoke sessions (except current device if self-reset)."""
    user_id_bin = hex_to_bin(user_id_hex)
    if not user_id_bin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid user ID format",
        )

    now = datetime.now(timezone.utc)

    with cursor(db) as cur:
        # Check if user exists
        cur.execute("SELECT 1 FROM users WHERE id = %s", (user_id_bin,))
        if not cur.fetchone():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        try:
            db.autocommit(False)
            # 1. Delete MFA secrets
            cur.execute("DELETE FROM user_totp_secrets WHERE user_id = %s", (user_id_bin,))
            cur.execute("DELETE FROM user_recovery_codes WHERE user_id = %s", (user_id_bin,))

            # 2. Revoke sessions
            if user_id_hex == current_user["id_hex"]:
                # Exclude current device from revocation
                cur.execute("SELECT id FROM devices WHERE device_id = %s", (current_device_id_str,))
                dev_row = cur.fetchone()
                if dev_row:
                    current_device_internal_id = dev_row[0]
                    cur.execute(
                        """
                        UPDATE auth_refresh_tokens 
                        SET revoked_at = %s 
                        WHERE user_id = %s AND device_id != %s AND revoked_at IS NULL
                        """,
                        (now, user_id_bin, current_device_internal_id),
                    )
                else:
                    # Device not found (shouldn't happen if authenticated), revoke all
                    cur.execute(
                        "UPDATE auth_refresh_tokens SET revoked_at = %s WHERE user_id = %s AND revoked_at IS NULL",
                        (now, user_id_bin),
                    )
            else:
                # Revoke all sessions for the target user
                cur.execute(
                    "UPDATE auth_refresh_tokens SET revoked_at = %s WHERE user_id = %s AND revoked_at IS NULL",
                    (now, user_id_bin),
                )

            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.autocommit(True)

    return {"message": "MFA reset and sessions revoked successfully"}


@router.post("/invites", response_model=InviteResponse)
async def create_invite(
    payload: InviteCreateRequest,
    db: Annotated[Any, Depends(get_db)],
    current_user: Annotated[dict, Depends(require_admin_user)],
):
    """Generate a new invitation token."""
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).digest()

    expires_at = datetime.now(timezone.utc) + timedelta(days=payload.expires_in_days)

    with cursor(db) as cur:
        cur.execute(
            """
            INSERT INTO invite_tokens (token_hash, user_id, expires_at)
            VALUES (%s, %s, %s)
            """,
            (token_hash, current_user["id"], expires_at),
        )

    return InviteResponse(token=token, expires_at=expires_at)
