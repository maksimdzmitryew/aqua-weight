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
        return _normalize_fernet_key(env_key)

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
    """Ensure the WhatsApp credentials table exists."""

    with cursor(conn) as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS whatsapp_credentials (
              id BINARY(16) NOT NULL,
              -- Legacy/plaintext columns (kept for backwards compatibility / migrations)
              api_url TEXT NULL,
              api_token TEXT NULL,
              template_name VARCHAR(255) NULL,
              phone_number_id VARCHAR(255) NULL,
              -- Encrypted columns (preferred)
              api_url_enc TEXT NULL,
              api_token_enc TEXT NULL,
              template_name_enc TEXT NULL,
              phone_number_id_enc TEXT NULL,
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
        cur.execute(
            """
            SELECT api_url, api_token, template_name, phone_number_id,
                   api_url_enc, api_token_enc, template_name_enc, phone_number_id_enc
            FROM whatsapp_credentials
            ORDER BY updated_at DESC
            LIMIT 1
            """
        )
        row = cur.fetchone()

    if not row:
        return env_fallback

    (
        api_url,
        api_token,
        template_name,
        phone_number_id,
        api_url_enc,
        api_token_enc,
        template_name_enc,
        phone_number_id_enc,
    ) = row

    if any([api_url_enc, api_token_enc, template_name_enc, phone_number_id_enc]):
        key = get_or_create_encryption_key(conn)
        return {
            "api_url": _decrypt_with_fernet(key, api_url_enc),
            "api_token": _decrypt_with_fernet(key, api_token_enc),
            "template_name": _decrypt_with_fernet(key, template_name_enc),
            "phone_number_id": _decrypt_with_fernet(key, phone_number_id_enc),
        }

    # Plaintext legacy row
    return {
        "api_url": api_url or "",
        "api_token": api_token or "",
        "template_name": template_name or "",
        "phone_number_id": phone_number_id or "",
    }


def save_whatsapp_credentials(
    conn,
    api_url: str,
    api_token: str,
    template_name: str,
    phone_number_id: str = "",
) -> bool:
    """Save WhatsApp credentials to DB (encrypted)."""

    ensure_whatsapp_credentials_table(conn)
    key = get_or_create_encryption_key(conn)

    api_url_enc = _encrypt_with_fernet(key, api_url)
    api_token_enc = _encrypt_with_fernet(key, api_token)
    template_name_enc = _encrypt_with_fernet(key, template_name)
    phone_number_id_enc = _encrypt_with_fernet(key, phone_number_id)

    with cursor(conn) as cur:
        cur.execute(
            """
            INSERT INTO whatsapp_credentials (
              id,
              api_url, api_token, template_name, phone_number_id,
              api_url_enc, api_token_enc, template_name_enc, phone_number_id_enc
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                _generate_bin16_id(),
                None,
                None,
                None,
                None,
                api_url_enc,
                api_token_enc,
                template_name_enc,
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
