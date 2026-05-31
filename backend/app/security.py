import os
import secrets
import string
from typing import Annotated, Any

import jwt
import pyotp
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext

from .db import get_conn, hex_to_bin

# Constants from environment
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "insecure-default-secret")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

bearer_scheme = HTTPBearer(auto_error=False)

# Password and Recovery Code hashing context using Argon2
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


def hash_password(password: str) -> str:
    """Hash a password using Argon2."""
    return pwd_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    """Verify a password against an Argon2 hash."""
    return pwd_context.verify(password, hashed_password)


def generate_totp_secret() -> str:
    """Generate a new random Base32 TOTP secret."""
    return pyotp.random_base32()


def verify_totp_code(secret: str, code: str) -> bool:
    """Verify a 6-digit TOTP code against a secret."""
    totp = pyotp.TOTP(secret)
    return totp.verify(code)


def generate_recovery_codes(count: int = 10) -> list[str]:
    """
    Generate a list of random recovery codes in XXXX-XXXX format.
    Uses alphanumeric characters for better readability and secrets module for security.
    """
    codes = []
    chars = string.ascii_uppercase + string.digits
    for _ in range(count):
        part1 = "".join(secrets.choice(chars) for _ in range(4))
        part2 = "".join(secrets.choice(chars) for _ in range(4))
        codes.append(f"{part1}-{part2}")
    return codes


def hash_recovery_code(code: str) -> str:
    """Hash a recovery code using Argon2 (same as password)."""
    return hash_password(code)


def verify_recovery_code(code: str, hashed_code: str) -> bool:
    """Verify a recovery code against an Argon2 hash."""
    return verify_password(code, hashed_code)


async def get_db():
    """FastAPI dependency that yields a database connection."""
    conn = get_conn()
    try:
        yield conn
    finally:
        conn.close()


def require_api_key(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> None:
    """Require a static API key when configured.

    - If TEST_MODE=1, allow requests without a key for test automation.
    - If API_KEY is unset, auth is effectively disabled (dev convenience).
    """
    if os.getenv("TEST_MODE") == "1":
        return

    required = os.getenv("API_KEY")
    if not required:
        return

    if x_api_key != required:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )


async def require_authenticated_user(
    auth: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Any, Depends(get_db)],
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> dict:
    """
    Dependency that ensures the request is authenticated via Bearer token or API Key.
    Bearer auth always takes precedence. API Key fallback is only allowed if TEST_MODE=1.
    """
    if auth:
        try:
            payload = jwt.decode(auth.credentials, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
            user_id_hex = payload.get("sub")
            if not user_id_hex:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid Bearer token: missing subject",
                )

            user_id_bin = hex_to_bin(user_id_hex)
            with db.cursor() as cur:
                cur.execute(
                    "SELECT id, username, global_role FROM users WHERE id = %s", (user_id_bin,)
                )
                user = cur.fetchone()
                if not user:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Invalid Bearer token: user not found",
                    )
                return {
                    "id": user[0],
                    "id_hex": user_id_hex,
                    "username": user[1],
                    "global_role": user[2],
                }
        except jwt.ExpiredSignatureError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Bearer token expired",
            )
        except jwt.PyJWTError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Bearer token",
            )

    # Fallback to API Key only if TEST_MODE=1 and Bearer is missing
    if os.getenv("TEST_MODE") == "1":
        required = os.getenv("API_KEY")
        if required:
            if x_api_key == required:
                # Mock an admin user for legacy/test access
                with db.cursor() as cur:
                    cur.execute(
                        "SELECT id, username, global_role FROM users WHERE global_role = 'admin' LIMIT 1"
                    )
                    user = cur.fetchone()
                    if user:
                        return {
                            "id": user[0],
                            "id_hex": user[0].hex(),
                            "username": user[1],
                            "global_role": user[2],
                        }
                return {
                    "id": None,
                    "id_hex": None,
                    "username": "test_admin",
                    "global_role": "admin",
                }
            else:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid API Key (Test Mode fallback)",
                )
        else:
            # API_KEY not set in env, allow access in test mode as admin guest
            return {"id": None, "id_hex": None, "username": "test_guest", "global_role": "admin"}

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required: Bearer token missing",
    )


async def require_admin_user(
    current_user: Annotated[dict, Depends(require_authenticated_user)],
) -> dict:
    """Dependency that ensures the authenticated user has the 'admin' role."""
    if current_user["global_role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


async def require_location_access(
    request: Request,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
) -> str:
    """
    Dependency that ensures the user has access to the location specified in path parameters.
    Admins have access to all locations.
    """
    location_id = request.path_params.get("location_id") or request.path_params.get("id_hex")
    if not location_id:
        return ""

    if current_user["global_role"] == "admin":
        return location_id

    user_id = current_user["id"]
    if user_id is None:  # Test mode fallback without a real user
        return location_id

    with db.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM user_location_acl WHERE user_id = %s AND location_id = UNHEX(%s)",
            (user_id, location_id),
        )
        if not cur.fetchone():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access to this location denied",
            )

    return location_id


async def require_plant_access(
    request: Request,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
) -> str:
    """
    Dependency that ensures the user has access to the plant specified in path parameters.
    Access is derived from the plant's location ACL.
    """
    plant_id = request.path_params.get("plant_id") or request.path_params.get("id_hex")
    if not plant_id:
        return ""

    if current_user["global_role"] == "admin":
        return plant_id

    user_id = current_user["id"]
    if user_id is None:  # Test mode fallback without a real user
        return plant_id

    with db.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM plants p
            JOIN user_location_acl acl ON p.location_id = acl.location_id
            WHERE p.id = UNHEX(%s) AND acl.user_id = %s
            """,
            (plant_id, user_id),
        )
        if not cur.fetchone():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access to this plant denied",
            )

    return plant_id
