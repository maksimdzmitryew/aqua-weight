### Tooling Choices
- Python backend
  - Test runner: `pytest`
  - Coverage: `coverage.py` via `pytest-cov`
  - Type checking: `mypy`
  - Linting/formatting: `ruff` + `black`
  - Factories/fixtures: `factory_boy`, `Faker`
  - HTTP testing: `httpx` + framework-specific test client (e.g., FastAPI `TestClient` or Flask `app.test_client()`)
  - DB strategy: `sqlite` in-memory for simple apps; `testcontainers` for real dependencies (Postgres, Redis, S3, etc.)
  - Async: `pytest-asyncio` (if applicable)
  - Mutation testing (later): `mutmut`
- React frontend
  - Unit/component tests: `Jest` + `@testing-library/react`
  - Mocking network: `msw`
  - E2E: `Playwright` (or `Cypress` if preferred)
  - Lint/format: `eslint` + `prettier`
  - Visual/interaction docs (optional but recommended): `Storybook`
- Cross-cutting
  - Pre-commit hooks: `pre-commit`
  - Env mgmt: `poetry`/`uv` or `pip-tools` for Python; `pnpm`/`npm`/`yarn` for JS
  - CI: GitHub Actions (or your platform) with caching, test matrices
  - Containers: `docker` + `docker-compose` for integration tests

### Typical workflow
- First time (or after changing `backend/Dockerfile.test`, `backend/requirements*.txt`, or the base image):
  - `docker compose -f docker-compose.test.yml up -d --build tests`
- Subsequent test runs (code-only changes don’t require rebuild because your repo is bind‑mounted into the container):
  - `docker compose -f docker-compose.test.yml exec tests pytest -q`

### Extra tips
- Run a specific test file or node:
  - `docker compose -f docker-compose.test.yml exec tests pytest -q backend/tests/test_something.py::TestClass::test_case`
- Run with coverage (matches your `pyproject.toml` defaults too):
  - `docker compose -f docker-compose.test.yml exec tests pytest -q --cov=backend/app --cov-report=term-missing`
- Network note: your test compose file uses an external network (e.g., `aw_aw-net`). If it doesn’t exist yet, bring up the main stack once: `docker compose up -d`.

## Database Isolation Requirements for Runtime and Test Environments

### MANDATORY RULES

1. Shared Infrastructure
   - Runtime and test environments MUST connect to the same database server instance/container
   - No separate database servers or containers shall be provisioned for testing

2. Schema Separation
   - Runtime environment MUST use a dedicated database name (schema)
   - Test environment MUST use a different database name (schema)
   - The two database names MUST be distinct and non-overlapping
   - Example: `plantapp_production` for runtime, `plantapp_test` for tests

3. Zero Cross-Contamination
   - Tests MUST NEVER perform any write operations (INSERT, UPDATE, DELETE, TRUNCATE, DROP, CREATE, ALTER) to the runtime database name
   - Tests MUST NEVER perform any read operations from the runtime database name
   - Any test configuration that could potentially write to the runtime database MUST fail immediately with a clear error
   - Connection strings, environment variables, and configuration files used by tests MUST be validated to ensure they point exclusively to the test database name

4. Enforcement Mechanisms Required
   - Database connection initialization in test code MUST validate that the target database name is NOT the runtime database name
   - Test fixtures/setup MUST include assertions verifying the correct database name is in use
   - CI/CD pipeline MUST fail if tests attempt to access the runtime database name

### One‑liners:
- Ensure container is up, then run tests (no forced rebuild):
  - `docker compose -f docker-compose.test.yml up -d tests && docker compose -f docker-compose.test.yml exec tests pytest -q`
- Force rebuild only when the image changed:
  - `docker compose -f docker-compose.test.yml build tests && docker compose -f docker-compose.test.yml up -d tests && docker compose -f docker-compose.test.yml exec tests pytest -q`

Notes:
- Rebuild is only necessary when dependencies or the test image definition change. Examples that require rebuild:
  - You edit `backend/requirements.txt` or `backend/requirements-dev.txt`.
  - You edit `backend/Dockerfile.test`.
  - You change the base OS/tooling inside the image.
- No rebuild needed when you only change Python app code or tests, since the repo is mounted as a volume (`./:/app`).
- If the container ever stops, start it again without rebuilding: `docker compose -f docker-compose.test.yml up -d tests`.