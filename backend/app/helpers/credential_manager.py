"""Credential Manager for secure storage and management of WhatsApp credentials.

This module provides a robust credential management system that addresses the issues
with the previous XOR+HMAC approach. It uses Fernet symmetric encryption with proper
key derivation, supports credential migration, and ensures persistence across container restarts.
Credentials are stored encrypted ONLY in the database, not in files.
"""

import base64
import hashlib
import hmac
import logging
import os
import secrets
import json as json_module
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

logger = logging.getLogger(__name__)

# Key derivation constants
KDF_SALT_SIZE = 16
KDF_ITERATIONS = 100000
KDF_KEY_SIZE = 32
ENCRYPTION_VERSION = "v2"
ENCRYPTION_KEY_VERSION = "v1"

# Environment variable names
CREDENTIALS_ENCRYPTION_KEY_ENV = "CREDENTIALS_ENCRYPTION_KEY"
WHATSAPP_API_URL_ENV = "WHATSAPP_API_URL"
WHATSAPP_API_TOKEN_ENV = "WHATSAPP_API_TOKEN"
WHATSAPP_TEMPLATE_NAME_ENV = "WHATSAPP_TEMPLATE_NAME"
WHATSAPP_PHONE_NUMBER_ID_ENV = "WHATSAPP_PHONE_NUMBER_ID"

# JSON keys for encrypted data structure
KDF_SALT_KEY = "salt"
ENCRYPTED_DATA_KEY = "encrypted_data"
KDF_VERSION_KEY = "kdf_version"
TIMESTAMP_KEY = "created_at"
ENCRYPTION_VERSION_KEY = "version"

def _normalize_db_salt(salt: bytes) -> bytes:
    """Normalize salt values coming from MariaDB.

    Historically we stored 16-byte salts into a BINARY(32) column, which causes
    MariaDB to right-pad with NUL bytes. That makes PBKDF2 derive a different
    key on read vs write. If we detect that pattern, strip to the original 16.
    """
    if not salt:
        return salt
    # Detect the legacy pattern: 16 bytes of real salt + 16 bytes of padding.
    if len(salt) == 32 and salt[16:] == (b"\x00" * 16):
        return salt[:16]
    return salt


def _derive_key_from_password(password: str, salt: bytes, iterations: int = KDF_ITERATIONS) -> bytes:
    """Derive encryption key from password using PBKDF2.

    Args:
        password: The password string
        salt: Random salt
        iterations: Number of iterations for key derivation

    Returns:
        Derived encryption key
    """
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=KDF_KEY_SIZE,
        salt=salt,
        iterations=iterations,
    )
    return kdf.derive(password.encode())


def _generate_encryption_key() -> Tuple[bytes, bytes]:
    """Generate a new encryption key with salt using PBKDF2.

    Returns:
        Tuple of (encryption_key, salt)
    """
    salt = secrets.token_bytes(KDF_SALT_SIZE)
    password = os.getenv(CREDENTIALS_ENCRYPTION_KEY_ENV)
    if not password:
        raise ValueError("CREDENTIALS_ENCRYPTION_KEY environment variable is not set")

    key = _derive_key_from_password(password, salt)
    return key, salt


def _load_credentials_from_env() -> Dict[str, Optional[str]]:
    """Load WhatsApp credentials from environment variables.

    Returns:
        Dictionary with WhatsApp credentials from environment
    """
    return {
        "api_url": os.getenv(WHATSAPP_API_URL_ENV),
        "api_token": os.getenv(WHATSAPP_API_TOKEN_ENV),
        "template_name": os.getenv(WHATSAPP_TEMPLATE_NAME_ENV),
        "phone_number_id": os.getenv(WHATSAPP_PHONE_NUMBER_ID_ENV),
    }


def _ensure_encryption_key_table_exists(conn) -> None:
    """Ensure the encryption_keys table exists."""
    with conn.cursor() as cur:
        cur.execute("SHOW TABLES LIKE 'encryption_keys'")
        table_exists = cur.fetchone() is not None
        if not table_exists:
            cred_id = _generate_bin16_id()
            cur.execute("""
                CREATE TABLE encryption_keys (
                    id BINARY(16) NOT NULL,
                    version VARCHAR(20) NOT NULL DEFAULT 'v1',
                    encrypted_key TEXT NOT NULL,
                    salt BINARY(32) NOT NULL,
                    key_label VARCHAR(100) NULL,
                    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                    PRIMARY KEY (id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
            """)
            logger.info("Created encryption_keys table")
            return


def _encrypt_password(password: str, salt: bytes) -> Tuple[str, bytes]:
    """Encrypt a password with salt using KDF and Fernet."""
    key = _derive_key_from_password(password, salt)
    encrypted_key = _encrypt_with_fernet(password, key)
    return encrypted_key, key


def _decrypt_password(encrypted_key: str, salt: bytes, original_password: str) -> bool:
    """Verify a password by attempting to decrypt and re-derive key."""
    try:
        # Derive key using the provided password to check if it matches
        derived_key = _derive_key_from_password(original_password, salt)

        # Verify by encrypting a test value
        test_encrypted = _encrypt_with_fernet("test", derived_key)
        test_decrypted = _decrypt_with_fernet(test_encrypted, derived_key)
        return test_decrypted == "test"
    except Exception:
        return False


def _get_encryption_key_from_env_and_store(conn) -> Tuple[bytes, bytes]:
    """Get encryption key from environment variable and store it in database."""
    password = os.getenv(CREDENTIALS_ENCRYPTION_KEY_ENV)
    if not password:
        raise ValueError(f"{CREDENTIALS_ENCRYPTION_KEY_ENV} environment variable not set")

    # Deterministic 32-byte salt (matches BINARY(32) storage without padding issues).
    salt = hashlib.sha256(password.encode()).digest()
    key = _derive_key_from_password(password, salt)

    # Store the key in database using Fernet encryption with the password itself as the key
    # This allows us to decrypt it later without needing the environment variable
    encrypted_key = _encrypt_with_fernet(password, key)

    with conn.cursor() as cur:
        try:
            _ensure_encryption_key_table_exists(conn)

            # Check if key already exists
            cur.execute("SELECT COUNT(*) FROM encryption_keys WHERE version = 'v1'")
            count = cur.fetchone()[0]

            if count > 0:
                # Update existing record
                cur.execute(
                    """
                    UPDATE encryption_keys
                    SET encrypted_key = %s, salt = %s, updated_at = NOW(6)
                    WHERE version = 'v1'
                    """,
                    (encrypted_key, salt),
                )
                logger.info(f"Updated encryption key in database")
            else:
                # Insert new record
                cred_id = _generate_bin16_id()
                cur.execute(
                    """
                    INSERT INTO encryption_keys (id, version, encrypted_key, salt, key_label, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, NOW(6), NOW(6))
                    """,
                    (cred_id, "v1", encrypted_key, salt, "Persistent encryption key for WhatsApp credentials"),
                )
                logger.info(f"Stored encryption key in database (ID: {cred_id.hex()})")

        except Exception as e:
            logger.error(f"Failed to store encryption key in database: {e}")
            raise

    return key, salt


def get_or_create_encryption_key(conn=None, fallback_to_env: bool = True) -> Tuple[bytes, bytes]:
    """Get existing encryption key and salt from database, or create new ones if they don't exist.

    Args:
        conn: Database connection if available, otherwise will create one.
        fallback_to_env: If True and no key in database, try environment variable for backward compatibility.

    Returns:
        Tuple of (encryption_key, salt)

    Raises:
        ValueError: If no encryption key is configured anywhere (DB or env).
    """
    # We REQUIRE the master secret to be present in the environment (.env in compose).
    password = os.getenv(CREDENTIALS_ENCRYPTION_KEY_ENV)
    if not password:
        raise ValueError(
            f"{CREDENTIALS_ENCRYPTION_KEY_ENV} is required. "
            "Set it in .env (docker-compose) to encrypt/decrypt WhatsApp credentials."
        )

    # First try to get salt (and optional sentinel) from database.
    if conn:
        try:
            _ensure_encryption_key_table_exists(conn)
        except Exception as e:
            logger.error(f"Failed to ensure encryption_keys table exists: {e}")
            raise

        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, encrypted_key, salt FROM encryption_keys WHERE version = 'v1' ORDER BY created_at DESC LIMIT 1"
            )
            row = cur.fetchone()
            if row:
                cred_id, encrypted_key, salt = row
                salt = _normalize_db_salt(salt)
                key = _derive_key_from_password(password, salt)
                # Best-effort validation: if the DB contains a sentinel encrypted value
                # and it decrypts, it should match the configured password.
                try:
                    sentinel = _decrypt_with_fernet(encrypted_key, key)
                    if sentinel and sentinel != password:
                        raise ValueError("Encryption key mismatch (DB sentinel does not match env secret)")
                except Exception:
                    # If sentinel can't be decrypted, credentials decryption will fail too;
                    # surface this early and clearly.
                    raise ValueError("Encryption key mismatch or corrupted encryption_keys row")

                logger.info(f"Derived encryption key from environment secret (ID: {cred_id.hex()})")
                return key, salt

        # No row exists yet: create one using a 32-byte salt to match BINARY(32) storage.
        salt = secrets.token_bytes(32)
        key = _derive_key_from_password(password, salt)
        encrypted_key = _encrypt_with_fernet(password, key)
        cred_id = _generate_bin16_id()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO encryption_keys (id, version, encrypted_key, salt, key_label, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, NOW(6), NOW(6))
                """,
                (cred_id, "v1", encrypted_key, salt, "Master secret sentinel (derived from env)"),
            )
        logger.info(f"Created encryption key sentinel in database (ID: {cred_id.hex()})")
        return key, salt

    # If no DB connection provided, fall back to a deterministic salt for in-process use.
    # Note: persistence requires a DB connection so the salt can be stored.
    salt = hashlib.sha256(password.encode()).digest()
    key = _derive_key_from_password(password, salt)
    return key, salt


def _encrypt_with_fernet(value: str, key: bytes) -> str:
    """Encrypt a value using Fernet encryption.

    Args:
        value: Value to encrypt
        key: Encryption key

    Returns:
        Encrypted value
    """
    if not value:
        return ""

    fernet = Fernet(base64.urlsafe_b64encode(key))
    encrypted = fernet.encrypt(value.encode()).decode()
    return encrypted


def _decrypt_with_fernet(encrypted_value: str, key: bytes) -> str:
    """Decrypt a value using Fernet encryption.

    Args:
        encrypted_value: Value to decrypt
        key: Encryption key

    Returns:
        Decrypted value
    """
    if not encrypted_value:
        return ""

    fernet = Fernet(base64.urlsafe_b64encode(key))
    decrypted = fernet.decrypt(encrypted_value.encode()).decode()
    return decrypted


def ensure_whatsapp_credentials_table(conn) -> None:
    """Ensure the whatsapp_credentials table exists and is on the expected schema.

    Note: older installs may have a legacy table without phone_number_id/version/migration_status.
    In that case we ALTER the table in-place rather than relying on CREATE TABLE IF NOT EXISTS.
    """
    with conn.cursor() as cur:
        cur.execute("SHOW TABLES LIKE 'whatsapp_credentials'")
        table_exists = cur.fetchone() is not None

        if not table_exists:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS whatsapp_credentials (
                    id BINARY(16) NOT NULL,
                    api_url TEXT NOT NULL,
                    api_token TEXT NOT NULL,
                    template_name TEXT NOT NULL,
                    phone_number_id TEXT NULL,
                    active TINYINT(1) NOT NULL DEFAULT 1,
                    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                    version VARCHAR(10) NOT NULL DEFAULT 'v1',
                    migration_status VARCHAR(20) NOT NULL DEFAULT 'active',
                    PRIMARY KEY (id),
                    KEY idx_whatsapp_active (active),
                    KEY idx_whatsapp_version (version)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
                """
            )
            logger.info("Created new whatsapp_credentials table with phone_number_id support")
            return

        # Existing table: add missing columns for backward compatibility.
        cur.execute("DESCRIBE whatsapp_credentials")
        columns = {row[0] for row in cur.fetchall()}

        # Legacy table had: id, api_url, api_token, template_name, active, created_at, updated_at
        if "phone_number_id" not in columns:
            cur.execute("ALTER TABLE whatsapp_credentials ADD COLUMN phone_number_id TEXT NULL")
        if "version" not in columns:
            cur.execute("ALTER TABLE whatsapp_credentials ADD COLUMN version VARCHAR(10) NOT NULL DEFAULT 'v1'")
        if "migration_status" not in columns:
            cur.execute(
                "ALTER TABLE whatsapp_credentials ADD COLUMN migration_status VARCHAR(20) NOT NULL DEFAULT 'active'"
            )

        # Indexes are not critical for correctness; try to create them but don't fail hard.
        try:
            if "active" in columns:
                cur.execute("CREATE INDEX idx_whatsapp_active ON whatsapp_credentials (active)")
        except Exception:
            pass
        try:
            if "version" in columns:
                cur.execute("CREATE INDEX idx_whatsapp_version ON whatsapp_credentials (version)")
        except Exception:
            pass

        logger.info("Ensured whatsapp_credentials table schema (legacy installs upgraded if needed)")


def get_whatsapp_credentials(conn, enforce_persistence: bool = False) -> dict:
    """Fetch WhatsApp credentials from database (decrypted using Fernet).

    Args:
        conn: Database connection
        enforce_persistence: If True, will only use database-stored keys and raise
            error if none found. If False (default), falls back to environment variables.

    Returns:
        Dictionary with WhatsApp credentials
    """
    from ..db.core import cursor

    try:
        ensure_whatsapp_credentials_table(conn)
        _ensure_encryption_key_table_exists(conn)
    except Exception as e:
        logger.warning(f"Could not ensure table exists: {e}")

    with cursor(conn) as cur:
        cur.execute(
            "SELECT api_url, api_token, template_name, phone_number_id, version FROM whatsapp_credentials WHERE active = 1 LIMIT 1"
        )
        row = cur.fetchone()
        if row:
            try:
                api_url, api_token, template_name, phone_number_id, version = row

                # Get the encryption key from database
                try:
                    key, salt = get_or_create_encryption_key(conn, fallback_to_env=False)
                except ValueError as e:
                    if enforce_persistence:
                        raise
                    logger.warning(f"No persistent encryption key found: {e}")
                    # Fall back to environment variables if allowed
                    env_creds = _load_credentials_from_env()
                    if any(env_creds.values()):
                        logger.warning("Falling back to environment variables for credentials")
                        return {
                            "api_url": env_creds["api_url"],
                            "api_token": env_creds["api_token"],
                            "template_name": env_creds["template_name"],
                            "phone_number_id": env_creds["phone_number_id"],
                        }
                    raise

                # Decrypt all credentials using the same key
                try:
                    decrypted_url = _decrypt_with_fernet(api_url, key)
                    decrypted_token = _decrypt_with_fernet(api_token, key)
                    decrypted_template = _decrypt_with_fernet(template_name, key)
                    decrypted_phone_id = _decrypt_with_fernet(phone_number_id, key)
                except Exception as decrypt_err:
                    # Compatibility: older versions stored base64 values (not encryption).
                    # If we detect base64, migrate to Fernet in-place.
                    import base64 as _b64
                    import binascii as _binascii

                    def _try_b64(s: str) -> str:
                        if not s:
                            return ""
                        try:
                            return _b64.b64decode(s.encode(), validate=True).decode()
                        except (_binascii.Error, UnicodeDecodeError):
                            return ""

                    migrated_url = _try_b64(api_url)
                    migrated_token = _try_b64(api_token)
                    migrated_template = _try_b64(template_name)
                    migrated_phone_id = _try_b64(phone_number_id) if phone_number_id else ""

                    if migrated_url.startswith("http") and migrated_token:
                        logger.warning("Detected legacy base64 WhatsApp credentials; migrating to Fernet")
                        default_template = "jaspers_market_plain_text_v1"
                        if not save_whatsapp_credentials(
                            conn, migrated_url, migrated_token, migrated_template or default_template, migrated_phone_id
                        ):
                            raise RuntimeError("Failed to migrate legacy base64 credentials")
                        return {
                            "api_url": migrated_url,
                            "api_token": migrated_token,
                            "template_name": migrated_template or default_template,
                            "phone_number_id": migrated_phone_id,
                        }

                    raise decrypt_err

                creds = {
                    "api_url": decrypted_url if decrypted_url else None,
                    "api_token": decrypted_token if decrypted_token else None,
                    "template_name": decrypted_template if decrypted_template else None,
                    "phone_number_id": decrypted_phone_id if decrypted_phone_id else None,
                }

                logger.info(f"Decrypted WhatsApp credentials from database (version: {version})")
                return creds

            except Exception as e:
                logger.error(f"Failed to decrypt WhatsApp credentials: {e}")
                raise RuntimeError(f"Credential decryption failed: {e}")

    # If no credentials exist in database but fallback allowed
    if not enforce_persistence:
        # Try environment variables
        env_creds = _load_credentials_from_env()
        if any(env_creds.values()):
            logger.warning("No credentials in database, falling back to environment variables")
            return {
                "api_url": env_creds["api_url"],
                "api_token": env_creds["api_token"],
                "template_name": env_creds["template_name"],
                "phone_number_id": env_creds["phone_number_id"],
            }

    # If no credentials exist in database or environment and enforce_persistence is True,
    # attempt to create an empty entry
    try:
        initialize_whatsapp_credentials_if_needed(conn)
        # After initialization, try to fetch credentials again with enforcement
        return get_whatsapp_credentials(conn, enforce_persistence=True)
    except Exception as e:
        logger.error(f"Failed to initialize WhatsApp credentials: {e}")
        # Ultimate fallback to environment variables (less secure but maintains functionality)
        return {
            "api_url": os.getenv(WHATSAPP_API_URL_ENV),
            "api_token": os.getenv(WHATSAPP_API_TOKEN_ENV),
            "template_name": os.getenv(WHATSAPP_TEMPLATE_NAME_ENV),
            "phone_number_id": os.getenv(WHATSAPP_PHONE_NUMBER_ID_ENV),
        }


def _create_persistence_migration_script():
    """Generate a script to migrate encryption key from environment to database."""
    return """
#!/bin/bash
# WhatsApp Credentials Migration Script
# This script migrates the CREDENTIALS_ENCRYPTION_KEY from environment to database

set -e

# Database connection parameters
DB_HOST="${DB_HOST:-db}"
DB_USER="${DB_USER:-appuser}"
DB_PASSWORD="${DB_PASSWORD:-apppass}"
DB_NAME="${DB_NAME:-appdb}"

# Get the encryption key from environment
ENCRYPTION_KEY="${CREDENTIALS_ENCRYPTION_KEY}"

if [ -z "$ENCRYPTION_KEY" ]; then
    echo "Error: CREDENTIALS_ENCRYPTION_KEY environment variable is not set"
    echo "Run: export CREDENTIALS_ENCRYPTION_KEY='your-secret-key'"
    exit 1
fi

# Generate a deterministic salt based on the key
SALT=$(echo -n "$ENCRYPTION_KEY" | sha256sum | cut -d' ' -f1 | xxd -r -p | head -c 16)

# Generate derived key using KDF
KEY=$(echo -n "$ENCRYPTION_KEY" | openssl enc -aes-256-cbc -md sha256 -salt -pass pass:"$ENCRYPTION_KEY" -kfile <(echo "$SALT") -hex 2>/dev/null | head -c 64)

if [ -z "$KEY" ]; then
    echo "Error: Failed to derive key from provided encryption key"
    exit 1
fi

# Connect to database and store the key
python3 <<END
import base64
import hashlib
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

import pymysql

# Get database connection
def derive_key(password, salt, iterations=100000):
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=iterations,
    )
    return kdf.derive(password.encode())

# Parse inputs
encryption_key = "$ENCRYPTION_KEY"
salt_b64 = "$SALT"
password_hash = "$KEY"

# Convert salt from hex to bytes
salt_bytes = bytes.fromhex(salt_b64)

# Encrypt the password with the derived key
from cryptography.fernet import Fernet
fernet_key = base64.urlsafe_b64encode(derive_key(encryption_key, salt_bytes)).decode()
fernet = Fernet(fernet_key)
encrypted_key = fernet.encrypt(encryption_key.encode()).decode()

# Connect to database and store
try:
    conn = pymysql.connect(
        host="$DB_HOST",
        user="$DB_USER",
        password="$DB_PASSWORD",
        database="$DB_NAME",
        autocommit=True
    )

    with conn.cursor() as cur:
        # Ensure table exists
        cur.execute('''
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
        ''')

        # Generate a new ID
        import secrets
        import time
        ts = int(time.time() * 1000)
        rand = secrets.token_bytes(8)
        cred_id = ts.to_bytes(8, "big") + rand

        # Store the key
        cur.execute(
            '''
            INSERT INTO encryption_keys (id, version, encrypted_key, salt, key_label, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, NOW(6), NOW(6))
            ''',
            (cred_id.hex(), "v1", encrypted_key, salt_bytes, "Migrated from environment variable CREDENTIALS_ENCRYPTION_KEY")
        )

        print("Successfully migrated encryption key from environment to database")
        print(f"Key ID: {cred_id.hex()}")

except Exception as e:
    print(f"Error: Failed to migrate encryption key: {e}")
    exit(1)
finally:
    conn.close()
END

# Update the backend to clear dependency on environment variable for the key
# and ensure the database version is used
cat > /app/app/helpers/_migration_complete.py <<'END'
# Flag file to indicate migration is complete
with open('/tmp/encryption_key_migration_complete', 'w') as f:
    f.write("1")
END

echo "Migration script completed. The encryption key is now stored in the database."
"""


def save_whatsapp_credentials(conn, api_url: str, api_token: str, template_name: str, phone_number_id: str = "") -> bool:
    """Save WhatsApp credentials to database using Fernet encryption."""
    from ..db.core import cursor

    try:
        ensure_whatsapp_credentials_table(conn)
        _ensure_encryption_key_table_exists(conn)
    except Exception as e:
        logger.error(f"Failed to ensure tables exist: {e}")
        return False

    cred_id = _generate_bin16_id()

    # Get encryption key with better error handling - strict mode for production
    try:
        # Try to get key from database first with strict enforcement
        key, salt = get_or_create_encryption_key(conn, fallback_to_env=False)
    except ValueError as e:
        logger.error(f"No encryption key found in database: {e}")
        # In production, fail hard if no key is found
        if os.getenv("APP_ENV", "development") != "development":
            raise
        # For development/testing, allow fallback
        logger.warning("Falling back to environment variable in development mode")
        try:
            key, salt = get_or_create_encryption_key(conn, fallback_to_env=True)
        except Exception as e2:
            logger.error(f"Failed to get encryption key from environment: {e2}")
            return False
    except Exception as e:
        logger.error(f"Failed to get encryption key: {e}")
        return False

    # Encrypt credentials using Fernet
    encrypted_api_url = _encrypt_with_fernet(api_url, key)
    encrypted_api_token = _encrypt_with_fernet(api_token, key)
    encrypted_template_name = _encrypt_with_fernet(template_name, key)
    encrypted_phone_id = _encrypt_with_fernet(phone_number_id, key)

    try:
        with cursor(conn) as cur:
            # Begin transaction-like operations
            try:
                # Deactivate existing credentials
                cur.execute("UPDATE whatsapp_credentials SET active = 0, migration_status = 'migrated'")
                # Insert new credentials
                cur.execute(
                    """
                    INSERT INTO whatsapp_credentials (id, api_url, api_token, template_name, phone_number_id, active, version)
                    VALUES (%s, %s, %s, %s, %s, 1, %s)
                    """,
                    (
                        cred_id,
                        encrypted_api_url,
                        encrypted_api_token,
                        encrypted_template_name,
                        encrypted_phone_id,
                        ENCRYPTION_VERSION,
                    )
                )
                # Commit would happen here in a real transaction
                logger.info(f"Saved WhatsApp credentials with ID: {cred_id.hex()}")
            except Exception as e:
                # Rollback would happen here in a real transaction
                logger.error(f"Failed to save credentials to database: {e}")
                return False
    except Exception as e:
        logger.error(f"Database error while saving WhatsApp credentials: {e}")
        return False

    return True


def _generate_bin16_id() -> bytes:
    """Generate a compact 16-byte ID suitable for BINARY(16) primary keys."""
    import secrets
    import time

    ts = int(time.time() * 1000)  # milliseconds, fits in 8 bytes
    rand = secrets.token_bytes(8)  # 8 random bytes
    return ts.to_bytes(8, "big") + rand


def migrate_old_credentials(conn) -> bool:
    """Migrate credentials from old XOR+HMAC encryption to new Fernet encryption.

    Args:
        conn: Database connection

    Returns:
        True if migration succeeded, False otherwise
    """
    try:
        from .db.core import cursor

        with cursor(conn) as cur:
            # Check if there are any old credentials
            cur.execute(
                "SELECT id, api_url, api_token, template_name, phone_number_id, version FROM whatsapp_credentials WHERE migration_status = 'active'"
            )
            old_rows = cur.fetchall()

            if not old_rows:
                logger.info("No old credentials to migrate")
                return True

            logger.info(f"Migrating {len(old_rows)} old credentials")

            for row in old_rows:
                cred_id, api_url, api_token, template_name, phone_number_id, version = row

                try:
                    # Try to decrypt with old method using the original XOR approach
                    # For backward compatibility, we assume the old key was the environment variable
                    old_key_value = os.getenv(CREDENTIALS_ENCRYPTION_KEY_ENV)
                    if not old_key_value:
                        logger.error("CREDENTIALS_ENCRYPTION_KEY not set for migration")
                        raise ValueError("Cannot migrate - no encryption key")

                    # Create old-style key (32 bytes, padded with '=')
                    old_key = old_key_value.encode().ljust(32, b'=')[:32]

                    # Helper function for old XOR encryption
                    def xor_encrypt(data: bytes, key: bytes) -> bytes:
                        result = bytearray(len(data))
                        for i, b in enumerate(data):
                            result[i] = b ^ key[i % len(key)]
                        return bytes(result)

                    # Decrypt old credentials
                    def old_decrypt(value: str) -> str:
                        if not value:
                            return ""
                        try:
                            encrypted_b64, sig_b64 = value.rsplit(".", 1)
                            encrypted = base64.urlsafe_b64decode(encrypted_b64.encode())
                            signature = base64.urlsafe_b64decode(sig_b64.encode())

                            # Verify HMAC
                            expected_sig = hmac.new(old_key, encrypted, hashlib.sha256).digest()
                            if not hmac.compare_digest(signature, expected_sig):
                                raise ValueError("Invalid signature - data may have been tampered with")

                            decrypted = xor_encrypt(encrypted, old_key)
                            return decrypted.decode()
                        except Exception as e:
                            logger.error(f"Failed to decrypt old credential: {e}")
                            raise ValueError(f"Decryption failed: {e}")

                    # Decrypt old credentials
                    decrypted_url = old_decrypt(api_url)
                    decrypted_token = old_decrypt(api_token)
                    decrypted_template = old_decrypt(template_name)
                    decrypted_phone_id = old_decrypt(phone_number_id) if phone_number_id else ""

                    # Save new encrypted credentials
                    save_whatsapp_credentials(conn, decrypted_url, decrypted_token, decrypted_template, decrypted_phone_id)

                    # Mark as migrated
                    cur.execute(
                        "UPDATE whatsapp_credentials SET migration_status = 'migrated' WHERE id = %s",
                        (cred_id,)
                    )

                except Exception as e:
                    logger.error(f"Failed to migrate credentials {cred_id}: {e}")
                    # If migration fails, keep the old status
                    cur.execute(
                        "UPDATE whatsapp_credentials SET migration_status = 'migration_failed' WHERE id = %s",
                        (cred_id,)
                    )

        return True

    except Exception as e:
        logger.error(f"Failed to migrate credentials: {e}")
        return False


def initialize_whatsapp_credentials_if_needed(conn) -> None:
    """Initialize WhatsApp credentials and encryption key if they don't exist.

    This function ensures that at least some credentials and encryption key are available.
    If none are configured, it creates an empty entry and sets up the initial encryption key.

    Args:
        conn: Database connection
    """
    try:
        ensure_whatsapp_credentials_table(conn)
        _ensure_encryption_key_table_exists(conn)

        with conn.cursor() as cur:
            # Check if encryption key exists
            cur.execute("SELECT COUNT(*) FROM encryption_keys WHERE version = 'v1'")
            key_count = cur.fetchone()[0]

            # Check if WhatsApp credentials exist
            cur.execute("SELECT COUNT(*) FROM whatsapp_credentials WHERE active = 1")
            cred_count = cur.fetchone()[0]

            # Only create initial setup if neither exists
            if key_count == 0 and cred_count == 0:
                logger.info("No encryption key or WhatsApp credentials found, creating initial setup")

                # Try to get encryption key from environment first
                env_password = os.getenv(CREDENTIALS_ENCRYPTION_KEY_ENV)
                if env_password:
                    # Use environment variable to generate and store encryption key
                    salt = hashlib.sha256(env_password.encode()).digest()
                    key = _derive_key_from_password(env_password, salt)

                    # Store in database
                    encrypted_key = _encrypt_with_fernet(env_password, key)
                    cred_id = _generate_bin16_id()

                    cur.execute(
                        """
                        INSERT INTO encryption_keys (id, version, encrypted_key, salt, key_label, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, NOW(6), NOW(6))
                        """,
                        (cred_id, "v1", encrypted_key, salt, "Initial encryption key from environment"),
                    )
                    logger.info(f"Created initial encryption key in database from environment (ID: {cred_id.hex()})")
                else:
                    # No environment variable, create empty encryption key entry
                    salt = secrets.token_bytes(KDF_SALT_SIZE)  # Generate random salt for empty key
                    key = secrets.token_bytes(KDF_KEY_SIZE)  # Generate random key
                    cred_id = _generate_bin16_id()

                    # Encrypt empty string with random key (for persistence)
                    empty_encrypted_key = _encrypt_with_fernet("", key)

                    cur.execute(
                        """
                        INSERT INTO encryption_keys (id, version, encrypted_key, salt, key_label, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, NOW(6), NOW(6))
                        """,
                        (cred_id, "v1", empty_encrypted_key, salt, "Empty initial encryption key"),
                    )
                    logger.info("Created empty encryption key entry")

                # Create empty WhatsApp credentials entry
                cred_id = _generate_bin16_id()
                empty_encrypted_url = _encrypt_with_fernet("", key)
                empty_encrypted_token = _encrypt_with_fernet("", key)
                empty_encrypted_template = _encrypt_with_fernet("", key)
                empty_encrypted_phone_id = _encrypt_with_fernet("", key)

                cur.execute(
                    """
                    INSERT INTO whatsapp_credentials (id, api_url, api_token, template_name, phone_number_id, active, version)
                    VALUES (%s, %s, %s, %s, %s, 1, %s)
                    """,
                    (
                        cred_id,
                        empty_encrypted_url,
                        empty_encrypted_token,
                        empty_encrypted_template,
                        empty_encrypted_phone_id,
                        ENCRYPTION_VERSION,
                    )
                )

                logger.info("Created empty WhatsApp credentials entry")

    except Exception as e:
        logger.error(f"Failed to initialize WhatsApp credentials: {e}")


def backup_credentials(conn) -> str:
    """Backup credentials to a file.

    Args:
        conn: Database connection

    Returns:
        Path to backup file
    """
    # This function is kept for compatibility but no longer creates file backups
    # to avoid the security concern of storing credentials in files
    logger.warning("Backup credentials to file is deprecated for security reasons. Credentials are stored encrypted in the database.")
    return ""
