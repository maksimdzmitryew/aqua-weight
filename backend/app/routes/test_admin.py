import os
import secrets

from fastapi import APIRouter, HTTPException, status

try:
    from ..db.core import connect, cursor
    from ..security import hash_password
except ImportError:  # fallback when imported as a top-level module during pytest collection
    from backend.app.db.core import connect, cursor
    from backend.app.security import hash_password

app = APIRouter(prefix="/test", tags=["test-admin"])  # will be mounted under /api when enabled


def _ensure_test_mode():
    if os.getenv("TEST_MODE") != "1":
        raise HTTPException(status_code=404, detail="Not Found")


def _get_or_create_test_admin():
    """Get or create the test admin user and return (id_hex, created)."""
    with connect() as conn:
        with cursor(conn) as cur:
            cur.execute("SELECT HEX(id) FROM users WHERE username = %s", ("test_admin",))
            row = cur.fetchone()
            if row:
                return row[0], False
            admin_id_hex = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            cur.execute(
                """
                INSERT INTO users (id, username, password_hash, global_role, settings_json)
                VALUES (UNHEX(%s), %s, %s, %s, %s)
                """,
                (
                    admin_id_hex,
                    "test_admin",
                    hash_password("testpassword"),
                    "admin",
                    "{}",
                ),
            )
            return admin_id_hex, True


def _ensure_test_admin_user():
    """Create or update a deterministic test admin user for E2E tests."""
    admin_id_hex, _ = _get_or_create_test_admin()
    return admin_id_hex


@app.post("/reset")
def reset_db():
    """Dangerous: truncate data tables for E2E tests.
    Enabled only when TEST_MODE=1.
    """
    _ensure_test_mode()
    # Order matters due to FKs. Delete child tables first.
    tables = [
        "plants_measurements",
        "plants_events",
        "plants",
        "locations",
    ]
    with connect() as conn:
        with cursor(conn) as cur:
            for tbl in tables:
                cur.execute(f"DELETE FROM {tbl}")
    return {"status": "ok"}


@app.post("/seed-minimal")
def seed_minimal():
    """Seed minimal deterministic data used by E2E tests.
    - Location: "Living Room"
    - Plant: "Seed Fern" (assigned to Living Room)
    Enabled only when TEST_MODE=1. Idempotent.
    Returns the created location and plant ids (hex strings) for convenience.
    """
    _ensure_test_mode()

    # Deterministic ULID/UUID-like hex ids (32 hex chars)
    location_id_hex = "11111111111111111111111111111111"
    plant_id_hex = "22222222222222222222222222222222"
    plant_id_2_hex = "33333333333333333333333333333333"

    with connect() as conn:
        with cursor(conn) as cur:
            # Insert location (id, name)
            cur.execute(
                """
                INSERT INTO locations (id, name, description, sort_order)
                VALUES (UNHEX(%s), %s, %s, 0)
                ON DUPLICATE KEY UPDATE name = VALUES(name)
                """,
                (location_id_hex, "Living Room", None),
            )

            # Insert plant minimal fields
            cur.execute(
                """
                INSERT INTO plants (id, name, location_id, sort_order)
                VALUES (UNHEX(%s), %s, UNHEX(%s), 0)
                ON DUPLICATE KEY UPDATE name = VALUES(name), location_id = VALUES(location_id)
                """,
                (plant_id_hex, "Seed Fern", location_id_hex),
            )

            cur.execute(
                """
                INSERT INTO plants (id, name, location_id, sort_order)
                VALUES (UNHEX(%s), %s, UNHEX(%s), 1)
                ON DUPLICATE KEY UPDATE name = VALUES(name), location_id = VALUES(location_id)
                """,
                (plant_id_2_hex, "Seed Ivy", location_id_hex),
            )

    return {
        "status": "ok",
        "location_id": location_id_hex,
        "plant_id": plant_id_hex,
        "plant_id_2": plant_id_2_hex,
    }


# Compatibility endpoints expected by Playwright e2e tests
@app.post("/seed")
def seed():
    """Reset the DB and seed minimal data (if any). Only in TEST_MODE.
    Provided for compatibility with e2e tests that POST /api/test/seed.
    Also creates a test admin user for E2E authentication.
    """
    _ensure_test_mode()
    # Truncate all data and then run minimal seed.
    reset_db()
    seed_minimal()
    admin_id = _ensure_test_admin_user()
    return {"status": "ok", "admin_id": admin_id}


@app.post("/cleanup")
def cleanup():
    """Cleanup test data by truncating tables. Only in TEST_MODE.
    Provided for compatibility with e2e tests that POST /api/test/cleanup.
    """
    _ensure_test_mode()
    reset_db()
    return {"status": "ok"}


@app.post("/login")
def test_login():
    """Authenticate the test admin user and return an access token for E2E tests.
    Only available in TEST_MODE.
    """
    _ensure_test_mode()
    from datetime import datetime, timedelta, timezone
    import jwt as _jwt
    from ..security import JWT_SECRET_KEY, JWT_ALGORITHM

    admin_id_hex, _ = _get_or_create_test_admin()

    # Generate access token
    now = datetime.now(timezone.utc)
    payload = {
        "sub": admin_id_hex,
        "iat": now,
        "exp": now + timedelta(minutes=60),
    }
    access_token = _jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": admin_id_hex,
            "username": "test_admin",
            "global_role": "admin",
        },
    }
