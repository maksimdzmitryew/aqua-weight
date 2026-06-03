import base64
import hashlib
import hmac
import os
import secrets
import string
import time
from typing import Annotated, Any

import jwt
import pyotp
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext

from .db import HEX_RE, get_conn, hex_to_bin

# Constants from environment
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "insecure-default-secret")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
NONCE_SECRET_KEY = os.getenv("NONCE_SECRET_KEY", "insecure-nonce-default")

# Security enforcement: prevent insecure defaults in non-test/non-dev environments
if os.getenv("TEST_MODE") != "1" and os.getenv("APP_ENV", "development").lower() != "development":
    if JWT_SECRET_KEY == "insecure-default-secret":
        raise RuntimeError("JWT_SECRET_KEY must be set in production")
    if NONCE_SECRET_KEY == "insecure-nonce-default":
        raise RuntimeError("NONCE_SECRET_KEY must be set in production")
NONCE_MIN_AGE_SECONDS = 5
NONCE_MAX_AGE_SECONDS = 900  # 15 minutes

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


def generate_page_nonce(request: Request) -> str:
    """
    Generate a server-signed nonce containing a timestamp and bound to the client context.
    Context binding uses User-Agent to prevent simple replay across different browsers.
    """
    timestamp = int(time.time())
    user_agent = request.headers.get("user-agent", "")
    message = f"{timestamp}|{user_agent}".encode()
    signature = hmac.new(NONCE_SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()
    payload = f"{timestamp}:{signature}"
    return base64.b64encode(payload.encode()).decode()


def verify_page_nonce(nonce_b64: str, request: Request) -> bool:
    """
    Verify a server-signed nonce.
    Checks:
    1. Signature integrity using NONCE_SECRET_KEY.
    2. Context binding (User-Agent).
    3. Minimum age (5s) to deter automated bot submissions.
    4. Maximum age (15m) to prevent long-term replay.
    """
    try:
        payload = base64.b64decode(nonce_b64.encode()).decode()
        timestamp_str, signature = payload.split(":", 1)
        timestamp = int(timestamp_str)
    except Exception:
        return False

    # 1. Temporal validation
    now = int(time.time())
    age = now - timestamp
    if age < NONCE_MIN_AGE_SECONDS or age > NONCE_MAX_AGE_SECONDS:
        return False

    # 2. Context & Signature validation
    user_agent = request.headers.get("user-agent", "")
    message = f"{timestamp}|{user_agent}".encode()
    expected_signature = hmac.new(NONCE_SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()

    return hmac.compare_digest(signature, expected_signature)


async def get_device_id(
    request: Request,
    x_device_id: Annotated[str | None, Header(alias="X-Device-ID")] = None,
) -> str:
    """
    FastAPI dependency to resolve device_id from headers or cookies.
    X-Device-ID header takes precedence over device_id cookie.
    Ensures no IP-based tracking is used for device resolution.
    """
    if x_device_id:
        return x_device_id

    return request.cookies.get("device_id", "")


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
        if not required:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="API_KEY must be set even in TEST_MODE for fallback access",
            )

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

    if not HEX_RE.match(location_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid location ID format",
        )

    if current_user["global_role"] == "admin":
        return location_id

    user_id = current_user["id"]
    if user_id is None:  # Test mode fallback without a real user
        return location_id

    with db.cursor() as cur:
        cur.execute(
            "SELECT role FROM user_location_acl WHERE user_id = %s AND location_id = UNHEX(%s)",
            (user_id, location_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access to this location denied",
            )
        # For now, any role (owner/helper) is sufficient for location access
        # unless a specific operation requires owner.
    return location_id


async def verify_location_access(
    db: Any,
    user_id: bytes,
    global_role: str,
    location_id: str,
    require_owner: bool = False,
) -> None:
    """
    Helper to verify location access for any user/location pair.
    Can be used for body payloads or other non-path sources.
    """
    if not HEX_RE.match(location_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid location ID format",
        )

    if global_role == "admin" or user_id is None:
        return

    with db.cursor() as cur:
        cur.execute(
            "SELECT role FROM user_location_acl WHERE user_id = %s AND location_id = UNHEX(%s)",
            (user_id, location_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access to this location denied",
            )
        if require_owner and row[0] != "owner":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Owner privileges required for this location",
            )


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

    if not HEX_RE.match(plant_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid plant ID format",
        )

    if current_user["global_role"] == "admin":
        return plant_id

    user_id = current_user["id"]
    if user_id is None:  # Test mode fallback without a real user
        return plant_id

    with db.cursor() as cur:
        # Check both direct plant ownership and location-inherited ACL
        cur.execute(
            """
            SELECT p.owner_id, acl.role
            FROM plants p
            LEFT JOIN user_location_acl acl ON p.location_id = acl.location_id AND acl.user_id = %s
            WHERE p.id = UNHEX(%s)
            """,
            (user_id, plant_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Plant not found",
            )

        owner_id, acl_role = row
        # Access granted if user is direct owner OR has an ACL role (owner/helper) at the location
        if owner_id == user_id or acl_role in ("owner", "helper"):
            return plant_id

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Access to this plant denied",
    )


async def require_plant_owner(
    request: Request,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
) -> str:
    """
    Dependency that ensures the user has OWNER access to the plant.
    Owner access is either direct plant ownership or 'owner' role in location ACL.
    """
    plant_id = request.path_params.get("plant_id") or request.path_params.get("id_hex")
    if not plant_id:
        return ""

    if not HEX_RE.match(plant_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid plant ID format",
        )

    if current_user["global_role"] == "admin":
        return plant_id

    user_id = current_user["id"]
    if user_id is None:
        return plant_id

    with db.cursor() as cur:
        cur.execute(
            """
            SELECT p.owner_id, acl.role
            FROM plants p
            LEFT JOIN user_location_acl acl ON p.location_id = acl.location_id AND acl.user_id = %s
            WHERE p.id = UNHEX(%s)
            """,
            (user_id, plant_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Plant not found",
            )

        owner_id, acl_role = row
        if owner_id == user_id or acl_role == "owner":
            return plant_id

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Owner privileges required for this plant",
    )


async def verify_plant_access(
    db: Any,
    user_id: bytes,
    global_role: str,
    plant_id: str,
    require_owner: bool = False,
) -> None:
    """
    Helper to verify plant access for any user/plant pair.
    Can be used for list of IDs or other non-path sources.
    """
    if not HEX_RE.match(plant_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid plant ID format",
        )

    if global_role == "admin" or user_id is None:
        return

    with db.cursor() as cur:
        cur.execute(
            """
            SELECT p.owner_id, acl.role
            FROM plants p
            LEFT JOIN user_location_acl acl ON p.location_id = acl.location_id AND acl.user_id = %s
            WHERE p.id = UNHEX(%s)
            """,
            (user_id, plant_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Plant not found",
            )

        owner_id, acl_role = row
        if require_owner:
            if owner_id == user_id or acl_role == "owner":
                return
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Owner privileges required for this plant",
            )
        else:
            if owner_id == user_id or acl_role in ("owner", "helper"):
                return
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access to this plant denied",
            )


async def verify_measurement_access(
    db: Any,
    user_id: bytes,
    global_role: str,
    measurement_id: str,
) -> str:
    """
    Helper to verify access to a measurement by checking its parent plant access.
    Returns the plant_id (hex) if access is granted.
    """
    if not HEX_RE.match(measurement_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid measurement ID format",
        )

    with db.cursor() as cur:
        cur.execute(
            "SELECT HEX(plant_id) FROM plants_measurements WHERE id = UNHEX(%s)",
            (measurement_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Measurement not found",
            )
        plant_id = row[0]

    await verify_plant_access(db, user_id, global_role, plant_id)
    return plant_id


async def require_measurement_access(
    request: Request,
    current_user: Annotated[dict, Depends(require_authenticated_user)],
    db: Annotated[Any, Depends(get_db)],
) -> str:
    """
    Dependency that ensures the user has access to the plant associated with the measurement.
    """
    measurement_id = request.path_params.get("id_hex")
    if not measurement_id:
        return ""
    return await verify_measurement_access(
        db, current_user["id"], current_user["global_role"], measurement_id
    )
