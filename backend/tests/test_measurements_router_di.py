import types
import pytest
from httpx import AsyncClient
from fastapi import FastAPI

from backend.app.db import get_conn_factory


class _FakeCursor:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.rowcount = len(self.rows)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self._last = (sql, params)

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def close(self):
        pass


class _FakeConn:
    def __init__(self, rows=None):
        self._cursor = _FakeCursor(rows)
        self.autocommit_state = True

    def cursor(self):
        return self._cursor

    def autocommit(self, state: bool):
        self.autocommit_state = state

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass


@pytest.mark.asyncio
async def test_list_measurements_for_plant_di(app: FastAPI, async_client: AsyncClient, monkeypatch):
    # Fake one row coming from DB
    rows = [
        [
            bytes.fromhex("11" * 16),  # id
            # measured_at as a naive datetime-like with isoformat; we can pass a simple stub
            types.SimpleNamespace(isoformat=lambda sep=" ", timespec="seconds": "2025-01-01 00:00:00"),
            100,  # measured_weight_g
            90,   # last_dry_weight_g
            120,  # last_wet_weight_g
            30,   # water_added_g
            10.5, # water_loss_total_pct
            20,   # water_loss_total_g
            1.2,  # water_loss_day_pct
            3,    # water_loss_day_g
        ]
    ]

    fake_conn = _FakeConn(rows=rows)

    def _fake_factory():
        return fake_conn

    app.dependency_overrides[get_conn_factory] = lambda: _fake_factory

    plant_hex = "aa" * 16
    resp = await async_client.get(f"/api/plants/{plant_hex}/measurements")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert data[0]["id"] == ("11" * 16)
    assert data[0]["measured_weight_g"] == 100
    assert data[0]["water_loss_total_pct"] == 10.5

    # cleanup override
    app.dependency_overrides.pop(get_conn_factory, None)
