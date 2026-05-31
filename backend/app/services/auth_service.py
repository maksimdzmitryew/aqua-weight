import hashlib
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

import jwt
import pymysql

from ..db import bin_to_hex, cursor
from ..security import (
    JWT_ALGORITHM,
    JWT_SECRET_KEY,
    generate_recovery_codes,
    hash_password,
    verify_totp_code,
)

# Constants for token expiration
ACCESS_TOKEN_EXPIRE_MINUTES = 15
REFRESH_TOKEN_EXPIRE_DAYS = 7


def generate_ulid_bytes() -> bytes:
    """
    Generate a 16-byte ULID-like identifier.
    48-bit timestamp (milliseconds) + 80-bit randomness.
    Stored as BINARY(16) in the database.
    """
    timestamp = int(time.time() * 1000)
    # 6 bytes for timestamp (up to ~8900 AD)
    t_bytes = timestamp.to_bytes(6, byteorder="big")
    # 10 bytes of randomness
    r_bytes = os.urandom(10)
    return t_bytes + r_bytes


class AuthService:
    """
    Orchestrates authentication business logic: token lifecycle, device tracking,
    and session management. Follows a service-oriented pattern to isolate
    security logic from the route layer.
    """

    def __init__(self, db_conn: pymysql.connections.Connection):
        self.db = db_conn

    def _hash_token(self, token: str) -> bytes:
        """Hash a refresh token for secure storage using SHA-256."""
        return hashlib.sha256(token.encode()).digest()

    def _generate_refresh_token(self) -> str:
        """Generate a cryptographically secure random refresh token."""
        return secrets.token_urlsafe(32)

    def _get_now_utc(self) -> datetime:
        """Return current UTC datetime."""
        return datetime.now(timezone.utc)

    def issue_tokens(
        self,
        user_id: bytes,
        device_id_str: str,
        user_agent: Optional[str] = None,
        rotated_from_id: Optional[bytes] = None,
    ) -> Tuple[str, str]:
        """
        Issue a new Access Token (JWT) and Refresh Token pair.
        Orchestrates device registration and session persistence.
        """
        now = self._get_now_utc()
        access_expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        refresh_expire = now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

        # 1. Resolve internal device ID
        internal_device_id = self._resolve_device(device_id_str, user_agent)

        # 2. Generate Tokens
        access_token = jwt.encode(
            {"sub": bin_to_hex(user_id), "exp": int(access_expire.timestamp())},
            JWT_SECRET_KEY,
            algorithm=JWT_ALGORITHM,
        )
        refresh_token_plain = self._generate_refresh_token()
        refresh_token_hash = self._hash_token(refresh_token_plain)

        # 3. Persist session and update device state in an atomic transaction
        new_refresh_id = generate_ulid_bytes()

        with cursor(self.db) as cur:
            try:
                self.db.autocommit(False)

                # Register/Update user_device relationship
                cur.execute(
                    """
                    INSERT INTO user_devices (user_id, device_id, last_login_at)
                    VALUES (%s, %s, %s)
                    ON DUPLICATE KEY UPDATE last_login_at = %s
                    """,
                    (user_id, internal_device_id, now, now),
                )

                # Store refresh token
                cur.execute(
                    """
                    INSERT INTO auth_refresh_tokens (
                        id, token_hash, user_id, device_id, expires_at, rotated_from_id
                    ) VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        new_refresh_id,
                        refresh_token_hash,
                        user_id,
                        internal_device_id,
                        refresh_expire,
                        rotated_from_id,
                    ),
                )

                self.db.commit()
            except Exception:
                self.db.rollback()
                raise
            finally:
                self.db.autocommit(True)

        return access_token, refresh_token_plain

    def _resolve_device(self, device_id_str: str, user_agent: Optional[str] = None) -> bytes:
        """
        Resolve a client-provided device_id string to an internal BINARY(16) ID.
        Creates a new device record if it doesn't exist.
        """
        now = self._get_now_utc()
        with cursor(self.db) as cur:
            cur.execute("SELECT id FROM devices WHERE device_id = %s", (device_id_str,))
            row = cur.fetchone()

            if row:
                internal_id = row[0]
                # Update user agent if provided and different
                if user_agent:
                    cur.execute(
                        "UPDATE devices SET user_agent = %s, last_seen_at = %s WHERE id = %s",
                        (user_agent, now, internal_id),
                    )
                return internal_id

            # Create new device
            new_id = generate_ulid_bytes()
            cur.execute(
                "INSERT INTO devices (id, device_id, user_agent, last_seen_at) VALUES (%s, %s, %s, %s)",
                (new_id, device_id_str, user_agent, now),
            )
            return new_id

    def rotate_tokens(self, refresh_token: str, device_id_str: str) -> Tuple[str, str]:
        """
        Rotate an existing refresh token for a new pair.
        Implements strict reuse detection and revocation.
        """
        token_hash = self._hash_token(refresh_token)
        now = self._get_now_utc()

        with cursor(self.db) as cur:
            cur.execute(
                """
                SELECT id, user_id, device_id, revoked_at, expires_at
                FROM auth_refresh_tokens
                WHERE token_hash = %s
                """,
                (token_hash,),
            )
            token_row = cur.fetchone()

            if not token_row:
                raise ValueError("Invalid refresh token")

            t_id, user_id, device_id_bin, revoked_at, expires_at = token_row

            # Check for reuse/revocation
            if revoked_at:
                # Potential reuse attack! Revoke all tokens for this user/device pair.
                self.revoke_device_sessions(user_id, device_id_bin)
                raise ValueError("Token has been revoked: suspicious activity detected")

            # Check expiration
            if expires_at.replace(tzinfo=timezone.utc) < now:
                raise ValueError("Refresh token expired")

            # Mark old token as revoked
            cur.execute(
                "UPDATE auth_refresh_tokens SET revoked_at = %s WHERE id = %s",
                (now, t_id),
            )

        # Issue new pair using the chain tracking
        return self.issue_tokens(
            user_id=user_id,
            device_id_str=device_id_str,
            rotated_from_id=t_id,
        )

    def revoke_session(self, refresh_token: str) -> None:
        """Revoke a specific refresh token (logout)."""
        token_hash = self._hash_token(refresh_token)
        now = self._get_now_utc()
        with cursor(self.db) as cur:
            cur.execute(
                "UPDATE auth_refresh_tokens SET revoked_at = %s WHERE token_hash = %s AND revoked_at IS NULL",
                (now, token_hash),
            )

    def revoke_device_sessions(self, user_id: bytes, device_id: bytes) -> None:
        """Revoke all active refresh tokens for a specific user device."""
        now = self._get_now_utc()
        with cursor(self.db) as cur:
            cur.execute(
                "UPDATE auth_refresh_tokens SET revoked_at = %s WHERE user_id = %s AND device_id = %s AND revoked_at IS NULL",
                (now, user_id, device_id),
            )

    def revoke_all_user_sessions(self, user_id: bytes) -> None:
        """Revoke all active refresh tokens for a user across all devices."""
        now = self._get_now_utc()
        with cursor(self.db) as cur:
            cur.execute(
                "UPDATE auth_refresh_tokens SET revoked_at = %s WHERE user_id = %s AND revoked_at IS NULL",
                (now, user_id),
            )

    def set_device_trusted(self, user_id: bytes, device_id_str: str, trusted: bool = True) -> None:
        """Update the trust status of a device for a specific user. Untrusting revokes sessions."""
        now = self._get_now_utc()
        internal_device_id = self._resolve_device(device_id_str)
        trusted_at = now if trusted else None
        with cursor(self.db) as cur:
            try:
                self.db.autocommit(False)
                cur.execute(
                    """
                    UPDATE user_devices
                    SET trusted = %s, trusted_at = %s
                    WHERE user_id = %s AND device_id = %s
                    """,
                    (1 if trusted else 0, trusted_at, user_id, internal_device_id),
                )
                if not trusted:
                    cur.execute(
                        """
                        UPDATE auth_refresh_tokens
                        SET revoked_at = %s
                        WHERE user_id = %s AND device_id = %s AND revoked_at IS NULL
                        """,
                        (now, user_id, internal_device_id),
                    )
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise
            finally:
                self.db.autocommit(True)

    def consume_recovery_code(self, user_id: bytes, code: str) -> bool:
        """
        Verify and consume a recovery code. Mark as used if valid.
        Returns True if the code was valid and consumed.
        """
        now = self._get_now_utc()
        # We use SHA-256 to match the storage in complete_invite and schema.sql
        code_hash_attempt = hashlib.sha256(code.encode()).digest()

        with cursor(self.db) as cur:
            cur.execute(
                "SELECT code_hash FROM user_recovery_codes WHERE user_id = %s AND used_at IS NULL",
                (user_id,),
            )
            rows = cur.fetchall()

            for (code_hash,) in rows:
                if code_hash == code_hash_attempt:
                    cur.execute(
                        "UPDATE user_recovery_codes SET used_at = %s WHERE code_hash = %s",
                        (now, code_hash),
                    )
                    return True
        return False

    def complete_invite(
        self,
        token: str,
        password: str,
        totp_secret: str,
        totp_code: str,
        device_id_str: str,
        user_agent: Optional[str] = None,
        trust_device: bool = False,
    ) -> Tuple[str, str, list[str]]:
        """
        Complete an invitation: verify token, verify first TOTP, set password,
        enroll MFA, and issue first tokens.
        Returns (access_token, refresh_token, recovery_codes).
        """
        token_hash = hashlib.sha256(token.encode()).digest()
        now = self._get_now_utc()

        with cursor(self.db) as cur:
            # 1. Validate invite token
            cur.execute(
                "SELECT user_id, expires_at, activated_at FROM invite_tokens WHERE token_hash = %s",
                (token_hash,),
            )
            invite_row = cur.fetchone()

            if not invite_row:
                raise ValueError("Invalid or expired invite token")

            user_id, expires_at, activated_at = invite_row
            if activated_at:
                raise ValueError("Invite has already been activated")
            if expires_at.replace(tzinfo=timezone.utc) < now:
                raise ValueError("Invite token has expired")

            # 2. Verify TOTP code against the secret provided for enrollment
            if not verify_totp_code(totp_secret, totp_code):
                raise ValueError("Invalid TOTP verification code")

            # 3. Perform activation in transaction
            try:
                self.db.autocommit(False)

                # Update user password
                pwd_hash = hash_password(password)
                cur.execute(
                    "UPDATE users SET password_hash = %s WHERE id = %s",
                    (pwd_hash, user_id),
                )

                # Mark invite as activated
                cur.execute(
                    "UPDATE invite_tokens SET activated_at = %s WHERE token_hash = %s",
                    (now, token_hash),
                )

                # Store TOTP secret
                cur.execute(
                    "INSERT INTO user_totp_secrets (user_id, secret) VALUES (%s, %s)",
                    (user_id, totp_secret),
                )

                # Generate and store recovery codes
                recovery_codes_plain = generate_recovery_codes(10)
                for i, code in enumerate(recovery_codes_plain):
                    # We use SHA-256 for the code_hash to fit in BINARY(32) as defined in schema.sql,
                    # despite AUTH.md suggesting Argon2 (which requires VARCHAR).
                    # This ensures compatibility with the existing database schema.
                    code_hash = hashlib.sha256(code.encode()).digest()
                    cur.execute(
                        "INSERT INTO user_recovery_codes (code_hash, user_id, sort_order) VALUES (%s, %s, %s)",
                        (code_hash, user_id, i),
                    )

                # 4. Issue first token pair
                access_token, refresh_token = self.issue_tokens(
                    user_id=user_id,
                    device_id_str=device_id_str,
                    user_agent=user_agent,
                )

                # 5. Handle trusted device if requested
                if trust_device:
                    # Note: issue_tokens already updated user_devices, so we just set trust here
                    internal_device_id = self._resolve_device(device_id_str)
                    cur.execute(
                        "UPDATE user_devices SET trusted = 1, trusted_at = %s WHERE user_id = %s AND device_id = %s",
                        (now, user_id, internal_device_id),
                    )

                self.db.commit()
                return access_token, refresh_token, recovery_codes_plain

            except Exception:
                self.db.rollback()
                raise
            finally:
                self.db.autocommit(True)
