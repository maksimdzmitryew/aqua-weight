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