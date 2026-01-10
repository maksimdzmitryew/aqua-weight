import os
import asyncio
from typing import List, Tuple

import pytest

from backend.app.db.core import connect, cursor


@pytest.mark.anyio
async def test_reset_returns_404_when_test_mode_disabled(async_client, monkeypatch):
    # Ensure runtime app has routes mounted, but request-time guard should block
    monkeypatch.setenv("TEST_MODE", "0")
    resp = await async_client.post("/api/test/reset")
    assert resp.status_code == 404
    assert resp.json().get("detail") == "Not Found"


def _fetch_hex_ids_and_names(table: str) -> List[Tuple[str, str]]:
    with connect() as conn:
        with cursor(conn) as cur:
            cur.execute(f"SELECT HEX(id), name FROM {table} ORDER BY name")
            return list(cur.fetchall())


def _count_rows(table: str) -> int:
    with connect() as conn:
        with cursor(conn) as cur:
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            return int(cur.fetchone()[0])


@pytest.mark.anyio
async def test_seed_minimal_inserts_expected_rows_and_is_idempotent(async_client):
    # Start from clean slate
    await async_client.post("/api/test/reset")

    # First seed
    r1 = await async_client.post("/api/test/seed-minimal")
    assert r1.status_code == 200
    body1 = r1.json()
    assert body1["status"] == "ok"
    assert body1["location_id"] == "11111111111111111111111111111111"
    assert body1["plant_id"] == "22222222222222222222222222222222"
    assert body1["plant_id_2"] == "33333333333333333333333333333333"

    # Validate DB state
    locs = _fetch_hex_ids_and_names("locations")
    plants = _fetch_hex_ids_and_names("plants")
    assert locs == [("11111111111111111111111111111111", "Living Room")]
    assert plants == [
        ("22222222222222222222222222222222", "Seed Fern"),
        ("33333333333333333333333333333333", "Seed Ivy"),
    ]

    # Second seed should be idempotent and keep same data
    r2 = await async_client.post("/api/test/seed-minimal")
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2 == body1

    # Still exactly correct row counts and values
    assert _count_rows("locations") == 1
    assert _count_rows("plants") == 2
    assert _fetch_hex_ids_and_names("locations") == locs
    assert _fetch_hex_ids_and_names("plants") == plants


@pytest.mark.anyio
async def test_seed_endpoint_performs_reset_then_seed(async_client):
    # Ensure minimal seed exists
    await async_client.post("/api/test/seed-minimal")

    # Insert some extra dummy data that should be wiped by /seed
    dummy_loc = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    dummy_plant = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
    with connect() as conn:
        with cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO locations (id, name, description, sort_order)
                VALUES (UNHEX(%s), %s, %s, 0)
                """,
                (dummy_loc, "Spare Room", None),
            )
            cur.execute(
                """
                INSERT INTO plants (id, name, location_id, sort_order)
                VALUES (UNHEX(%s), %s, UNHEX(%s), 0)
                """,
                (dummy_plant, "Temp Plant", dummy_loc),
            )

    # Call seed endpoint (should reset and then seed minimal)
    resp = await async_client.post("/api/test/seed")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}

    # Verify only minimal records remain
    assert _count_rows("locations") == 1
    assert _count_rows("plants") == 2
    assert _fetch_hex_ids_and_names("locations") == [
        ("11111111111111111111111111111111", "Living Room")
    ]
    assert _fetch_hex_ids_and_names("plants") == [
        ("22222222222222222222222222222222", "Seed Fern"),
        ("33333333333333333333333333333333", "Seed Ivy"),
    ]


@pytest.mark.anyio
async def test_cleanup_truncates_tables(async_client):
    # Seed to ensure there is data to clear
    await async_client.post("/api/test/seed")

    # Create a dummy measurement/event row if schema allows; otherwise rely on plants/locations
    # For robustness, just ensure counts > 0 before cleanup where applicable
    assert _count_rows("plants") >= 1
    assert _count_rows("locations") >= 1

    # Cleanup should truncate all relevant tables
    resp = await async_client.post("/api/test/cleanup")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}

    # Verify emptiness across targeted tables
    for table in [
        "plants_measurements",
        "plants_events",
        "plants",
        "locations",
    ]:
        assert _count_rows(table) == 0