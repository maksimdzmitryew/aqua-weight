# Backend Testing Guide

This guide explains how to run backend tests, the fixture philosophy, and common testing patterns we follow. Keep it handy for daily workflows.

## Commands

- Run or rebuild the Docker test stack (DB, backend image, test runner):
  - Rebuild and start: `docker compose -f docker-compose.test.yml up -d --build`
  - Stop stack: `docker compose -f docker-compose.test.yml down`

- Execute the backend test suite from the runner container using pytest:
  - `docker compose -f docker-compose.test.yml exec tests pytest -q`
  - With coverage: `docker compose -f docker-compose.test.yml exec tests pytest -q --cov=app --cov-report=term-missing`

- Run a focused test file or node:
  - `docker compose -f docker-compose.test.yml exec tests pytest backend/tests/unit/test_utils_datetime.py::test_parse_at_midnight`

## Structure

- Unit tests: `backend/tests/unit/`
- Integration tests: `backend/tests/integration/`
- Factories/builders: `backend/tests/factories/`

## Fixtures Philosophy

- Test isolation: each test should not depend on the order of other tests. Prefer functional scope fixtures.
- DB management: for integration tests, use the MariaDB test service from docker-compose and reset state per test or per module, seeding via factories.
- App client: provide FastAPI TestClient/httpx fixtures in `conftest.py` to exercise routes without hitting the network layer.
- Time and randomness: freeze time where determinism matters; prefer `faker` for realistic but deterministic data in factories.

## Patterns We Enforce

- AAA (Arrange-Act-Assert) or Given-When-Then structure in tests.
- Behavioral naming: `test_creates_plant_when_payload_valid` rather than implementation details.
- One primary assertion per test, with additional sanity checks allowed.
- Prefer lightweight seams and dependency injection over heavy mocking.

### Example (AAA)

```python
# Arrange
def test_creates_plant_when_payload_valid(client, plant_factory):
    payload = plant_factory.build_dict()

    # Act
    resp = client.post('/api/plants', json=payload)

    # Assert
    assert resp.status_code == 201
    body = resp.json()
    assert body['name'] == payload['name']
```

### Example (Given-When-Then)

```python
# Given a plant exists
plant = plant_factory.create()

# When we fetch it by id
resp = client.get(f'/api/plants/{plant.id}')

# Then we receive details
assert resp.status_code == 200
assert resp.json()['id'] == plant.id
```

## Linting and Type Checking (optional but recommended)

Inside the tests container:
- Ruff: `ruff backend`
- MyPy: `mypy backend`

## Tips

- Prefer real containers for DB-dependent logic (as in our docker-compose) instead of SQLite for parity with production (MariaDB).
- Stabilize API shapes in `app/schemas/*` and test validation boundaries.
