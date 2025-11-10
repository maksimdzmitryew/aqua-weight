import os
from fastapi import APIRouter, HTTPException
from ..db.core import connect, cursor

app = APIRouter(prefix="/test", tags=["test-admin"])  # will be mounted under /api when enabled


def _ensure_test_mode():
    if os.getenv("TEST_MODE") != "1":
        raise HTTPException(status_code=404, detail="Not Found")


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

    return {"status": "ok", "location_id": location_id_hex, "plant_id": plant_id_hex}


# Compatibility endpoints expected by Playwright e2e tests
@app.post("/seed")
def seed():
    """Reset the DB and seed minimal data (if any). Only in TEST_MODE.
    Provided for compatibility with e2e tests that POST /api/test/seed.
    """
    _ensure_test_mode()
    # Truncate all data and then run minimal seed.
    reset_db()
    seed_minimal()
    return {"status": "ok"}


@app.post("/cleanup")
def cleanup():
    """Cleanup test data by truncating tables. Only in TEST_MODE.
    Provided for compatibility with e2e tests that POST /api/test/cleanup.
    """
    _ensure_test_mode()
    reset_db()
    return {"status": "ok"}
