import logging
import os
import secrets
import uuid
from typing import Any, Dict, Optional

from cryptography.fernet import Fernet, InvalidToken

from ..db.core import cursor

logger = logging.getLogger(__name__)

_ENV_CREDENTIALS_ENCRYPTION_KEY = "CREDENTIALS_ENCRYPTION_KEY"
_KEY_LABEL_WHATSAPP = "whatsapp_credentials"


def _generate_bin16_id() -> bytes:
    """Generate a compact 16-byte ID suitable for BINARY(16) primary keys."""

    return uuid.uuid4().bytes


def _normalize_fernet_key(key: str | bytes) -> bytes:
    if isinstance(key, str):
        key_b = key.strip().encode("utf-8")
    else:
        key_b = key
    # Fernet expects a urlsafe-base64-encoded 32-byte key.
    Fernet(key_b)
    return key_b


def get_or_create_encryption_key(conn) -> bytes:
    """Return the Fernet key used to encrypt WhatsApp credentials.

    Priority:
    1) env var `CREDENTIALS_ENCRYPTION_KEY`
    2) stored in `encryption_keys` table under `key_label='whatsapp_credentials'`
    """

    env_key = os.getenv(_ENV_CREDENTIALS_ENCRYPTION_KEY)
    if env_key:
        try:
            return _normalize_fernet_key(env_key)
        except Exception as e:
            logger.error(f"Invalid CREDENTIALS_ENCRYPTION_KEY in environment: {e}")
            raise

    # Ensure table exists even on older DBs.
    with cursor(conn) as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS encryption_keys (
              id BINARY(16) NOT NULL,
              version VARCHAR(20) NOT NULL DEFAULT 'v1',
              encrypted_key TEXT NOT NULL,
              salt BINARY(32) NOT NULL,
              key_label VARCHAR(100) NULL,
              created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
              updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
              PRIMARY KEY (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
            """
        )

        cur.execute(
            """
            SELECT encrypted_key
            FROM encryption_keys
            WHERE key_label = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (_KEY_LABEL_WHATSAPP,),
        )
        row = cur.fetchone()
        if row and row[0]:
            return _normalize_fernet_key(row[0])

        new_key = Fernet.generate_key()
        cur.execute(
            """
            INSERT INTO encryption_keys (id, version, encrypted_key, salt, key_label)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (
                _generate_bin16_id(),
                "v1",
                new_key.decode("utf-8"),
                secrets.token_bytes(32),
                _KEY_LABEL_WHATSAPP,
            ),
        )

    logger.warning(
        "No %s set; generated and stored a new key in DB (label=%s).",
        _ENV_CREDENTIALS_ENCRYPTION_KEY,
        _KEY_LABEL_WHATSAPP,
    )
    return new_key


def _encrypt_with_fernet(fernet_key: str | bytes, plaintext: str) -> str:
    f = Fernet(_normalize_fernet_key(fernet_key))
    return f.encrypt((plaintext or "").encode("utf-8")).decode("utf-8")


def _decrypt_with_fernet(fernet_key: str | bytes, token: Optional[str]) -> str:
    if not token:
        return ""
    f = Fernet(_normalize_fernet_key(fernet_key))
    try:
        return f.decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        logger.error("Failed to decrypt credentials: invalid token")
        return ""


def ensure_whatsapp_credentials_table(conn) -> None:
    """Ensure the WhatsApp credentials table exists with correct schema."""

    with cursor(conn) as cur:
        # First, check if table exists with expected columns
        try:
            cur.execute("DESCRIBE whatsapp_credentials")
            columns = {row[0] for row in cur.fetchall()}

            # Expected columns for the new schema:
            # - api_url, template_name: plaintext (non-sensitive)
            # - api_token_enc, phone_number_id_enc: encrypted (sensitive)
            required_columns = {
                'api_url',
                'template_name',
                'api_token_enc',
                'phone_number_id_enc'
            }

            missing_columns = required_columns - columns

            if missing_columns:
                # Table exists but missing required columns - drop and recreate
                cur.execute("DROP TABLE IF EXISTS whatsapp_credentials")
                logger.info(f"Dropped whatsapp_credentials table due to missing columns: {missing_columns}")
        except Exception as e:
            # Table doesn't exist or has corrupted schema - we'll create it below
            # Check if the error indicates table doesn't exist
            if "doesn't exist" not in str(e) and "Unknown table" not in str(e):
                logger.warning(f"Unexpected error checking whatsapp_credentials table: {e}")

        # Create table with only encrypted API credentials and plaintext metadata
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS whatsapp_credentials (
              id BINARY(16) NOT NULL,
              -- Plaintext metadata (non-sensitive)
              api_url TEXT NOT NULL,
              template_name TEXT NOT NULL,
              -- Encrypted API credentials (sensitive)
              api_token_enc TEXT NOT NULL,
              phone_number_id_enc TEXT NOT NULL,
              created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
              updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
              PRIMARY KEY (id),
              KEY idx_whatsapp_credentials_updated_at (updated_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
            """
        )


def get_whatsapp_credentials(conn=None) -> Dict[str, str]:
    """Fetch WhatsApp credentials.

    - If `conn` is provided: read from DB (decrypting if stored encrypted)
    - Else: read from environment variables
    """

    env_fallback = {
        "api_url": os.getenv("WHATSAPP_API_URL", ""),
        "api_token": os.getenv("WHATSAPP_API_TOKEN", ""),
        "template_name": os.getenv("WHATSAPP_TEMPLATE_NAME", ""),
        "phone_number_id": os.getenv("WHATSAPP_PHONE_NUMBER_ID", ""),
    }

    if conn is None:
        return env_fallback

    ensure_whatsapp_credentials_table(conn)
    with cursor(conn) as cur:
        try:
            cur.execute(
                """
                SELECT api_url, template_name,
                       api_token_enc, phone_number_id_enc
                FROM whatsapp_credentials
                ORDER BY updated_at DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()
        except Exception as e:
            # If column not found, the table might be corrupted - drop and recreate
            if "Unknown column" in str(e) or "doesn't exist" in str(e):
                logger.warning(f"WhatsApp credentials table has corrupted schema: {e}. Recreating table.")
                try:
                    # Try to drop the table and let ensure_whatsapp_credentials_table recreate it
                    cur.execute("DROP TABLE IF EXISTS whatsapp_credentials")
                    ensure_whatsapp_credentials_table(conn)

                    # Try the query again with the new schema
                    cur.execute(
                        """
                        SELECT api_url, template_name,
                               api_token_enc, phone_number_id_enc
                        FROM whatsapp_credentials
                        ORDER BY updated_at DESC
                        LIMIT 1
                        """
                    )
                    row = cur.fetchone()
                except Exception as recreate_e:
                    logger.error(f"Failed to recreate whatsapp_credentials table: {recreate_e}")
                    return env_fallback
            else:
                # Different error, re-raise
                raise e

    if not row:
        return env_fallback

    (
        api_url,
        template_name,
        api_token_enc,
        phone_number_id_enc,
    ) = row

    key = get_or_create_encryption_key(conn)
    # Decrypt encrypted fields; plaintext fields returned as-is (non-sensitive)
    return {
        "api_url": api_url or "",                                    # Plaintext (non-sensitive)
        "api_token": _decrypt_with_fernet(key, api_token_enc) if api_token_enc else "",    # Encrypted
        "template_name": template_name or "",                        # Plaintext (non-sensitive)
        "phone_number_id": _decrypt_with_fernet(key, phone_number_id_enc) if phone_number_id_enc else "",    # Encrypted
    }


def save_whatsapp_credentials(
    conn,
    api_url: str,
    api_token: str,
    template_name: str,
    phone_number_id: str = "",
) -> bool:
    """Save WhatsApp credentials to DB (encrypted).

    Note: api_url and template_name are stored as plaintext (non-sensitive).
    Only api_token and phone_number_id are encrypted.
    """

    ensure_whatsapp_credentials_table(conn)
    key = get_or_create_encryption_key(conn)

    # Only encrypt sensitive fields (api_token and phone_number_id)
    api_token_enc = _encrypt_with_fernet(key, api_token)
    phone_number_id_enc = _encrypt_with_fernet(key, phone_number_id)

    with cursor(conn) as cur:
        cur.execute(
            """
            INSERT INTO whatsapp_credentials (
              id,
              api_url, template_name,
              api_token_enc, phone_number_id_enc
            )
            VALUES (%s, %s, %s, %s, %s)
            """,
            (
                _generate_bin16_id(),
                api_url,
                template_name,
                api_token_enc,
                phone_number_id_enc,
            ),
        )
    return True


def migrate_old_credentials(conn) -> bool:
    """Optional migration hook.

    Kept for compatibility with existing callers; currently a no-op.
    """

    _ = conn
    return False


def initialize_whatsapp_credentials_if_needed(conn) -> bool:
    """Seed DB credentials from env vars if DB is empty."""

    ensure_whatsapp_credentials_table(conn)
    with cursor(conn) as cur:
        cur.execute("SELECT COUNT(*) FROM whatsapp_credentials")
        count_row = cur.fetchone()
        count = int(count_row[0]) if count_row else 0

    if count > 0:
        return False

    api_url = os.getenv("WHATSAPP_API_URL") or ""
    api_token = os.getenv("WHATSAPP_API_TOKEN") or ""
    template_name = os.getenv("WHATSAPP_TEMPLATE_NAME") or ""
    phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID") or ""

    if not api_url or not api_token:
        return False

    return save_whatsapp_credentials(conn, api_url, api_token, template_name, phone_number_id)


def backup_credentials(conn) -> Dict[str, Any]:
    """Return a backup payload of the current credentials (decrypted)."""

    creds = get_whatsapp_credentials(conn)
    return {
        "api_url": creds.get("api_url", ""),
        "api_token": creds.get("api_token", ""),
        "template_name": creds.get("template_name", ""),
        "phone_number_id": creds.get("phone_number_id", ""),
    }