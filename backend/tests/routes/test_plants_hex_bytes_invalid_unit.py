import asyncio
import types
import pytest

from backend.app.routes.plants import create_plant, update_plant
from backend.app.schemas.plant import PlantCreateRequest, PlantUpdateRequest


class DummyCreate:
    def __init__(self):
        self.name = "Unit Invalid"
        self.description = None
        self.species_name = None
        self.botanical_name = None
        self.cultivar = None
        # invalid hex strings that fail regex -> hit final return None path in hex_to_bytes
        self.location_id = "not_a_hex_32"
        self.substrate_type_id = "z" * 31
        self.light_level_id = "g" * 32
        self.pest_status_id = "-" * 32
        self.health_status_id = "123"
        self.photo_url = None
        self.default_measurement_method_id = " "+"1"*31
        self.substrate_last_refresh_at = None
        self.fertilized_last_at = None
        self.fertilizer_ec_ms = None


class DummyUpdate:
    def __init__(self):
        self.name = "Unit Invalid Updated"
        # invalid hex strings to hit final return None in update's hex_to_bytes
        self.location_id = "X" * 16
        self.substrate_type_id = "y" * 10
        self.light_level_id = "q" * 1
        self.pest_status_id = "foo"
        self.health_status_id = "bar"
        self.photo_url = None
        self.default_measurement_method_id = "baz"
        self.substrate_last_refresh_at = None
        self.fertilized_last_at = None
        self.fertilizer_ec_ms = None
        self.description = None
        self.species_name = None
        self.botanical_name = None
        self.cultivar = None


@pytest.mark.anyio
async def test_hex_to_bytes_invalid_paths_unit(async_client):
    # Call create_plant directly with a dummy payload to bypass Pydantic and HTTP layer
    resp = await create_plant(DummyCreate())
    assert resp["ok"] is True

    # Find created UUID via GET list to get an id for update
    lr = await async_client.get("/api/plants")
    assert lr.status_code == 200
    items = lr.json()
    uid = next(it["uuid"] for it in items if it["name"] == "Unit Invalid")

    # Call update_plant directly with invalid hex fields
    resp2 = await update_plant(uid, DummyUpdate())
    assert resp2["ok"] is True
