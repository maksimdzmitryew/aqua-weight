# Testing Plan (Step-by-Step)

This is the actionable, step-by-step plan to reach the Success Criteria for testing and CI quality gates across the backend (FastAPI) and frontend (React/Vite). It complements TESTING_STRATEGY.md (one‑pager) and the quick commands in TEST.md.

Date: 2025‑11‑08
Owner: QA/Dev

## Objective
Introduce a pragmatic, scalable testing strategy (unit, integration, component/UI, end-to-end) for a Python backend and React frontend, with CI/CD quality gates and refactoring support.

## Guiding Principles
- Follow the testing pyramid: many fast unit tests; fewer integration; fewer e2e.
- Reliability and isolation first; avoid global state; prefer DI and pure functions.
- Stabilize interfaces; refactor toward testability.
- Small, incremental milestones; keep the build green.

## Tooling Choices
- Python backend
  - pytest, pytest-cov, mypy, ruff, black
  - factory_boy, Faker
  - httpx + framework test client (FastAPI TestClient)
  - pytest-asyncio (if applicable)
  - testcontainers for real deps (MariaDB) where needed
  - mutmut (later) for mutation testing on hot paths
- React frontend
  - Jest + @testing-library/react + @testing-library/user-event
  - msw for network mocking
  - Playwright for E2E
  - eslint + prettier
  - Storybook (optional)
- Cross-cutting
  - pre-commit hooks
  - Docker + docker-compose for local/integration
  - CI: GitHub Actions with caching and job matrix

## Step-by-Step Execution Plan

### 1) Baseline and Inventory (Day 0–2)
- Identify critical backend endpoints and React pages/components
  - Backend: plants CRUD + reorder, measurements create/read, locations CRUD, health
  - Frontend: PlantsList, MeasurementCreate, BulkWeightMeasurement, LocationsList, DailyCare flows
- Document external deps: MariaDB, Nginx, TLS; confirm docker-compose test setup
- Decide support matrix and pin versions (Python 3.11, Node 20.x)

Deliverables:
- One‑pager TESTING_STRATEGY.md (exists)
- Versions noted in docs; confirm docker setup

### 2) Initialize Test Tooling (Day 2–3)
- Backend: ensure pytest, pytest-cov, ruff, black, mypy in dev deps; configure pyproject (exists)
- Frontend: add jest, RTL, msw, user-event; jest config and setupTests
- Pre-commit: hooks for ruff/black/mypy/eslint/prettier/whitespace

Deliverables:
- Tooling installed and configs committed

### 3) Establish Test Harness and Scaffolding (Day 3–5)
- Backend pytest scaffolding
  - conftest.py with app fixture; DB cleanup per test; settings overrides for test DB
  - httpx AsyncClient/TestClient fixtures
  - DB strategy: MariaDB test schema (appdb_test) via docker-compose.test.yml
- Factories/builders
  - factory_boy factories for Plant, Measurement
- Frontend scaffolding
  - setupTests.ts with jest-dom and msw
  - test-utils.tsx render with providers (router, query client, theme as needed)

Deliverables:
- Empty green test suite locally and in CI

### 4) Foundational Unit Tests (Day 5–8)
- Backend: pure helpers, services, schemas validation; basic router happy/error cases
- Frontend: components for forms, list rendering, conditional UX; use RTL queries and events

Deliverables:
- 15–30 backend unit tests; 10–20 frontend component tests; baseline coverage

### 5) Integration Tests (Day 8–12)
- Backend: request → DB → response loops using MariaDB; seed with factories; run schema.sql
- Frontend: component integration with msw covering data fetching and error states

Deliverables:
- 6–10 integration tests; migrations/seed in setup

### 6) End-to-End (E2E) Feature Tests (Day 12–16)
- Playwright against composed stack (nginx+backend+frontend+db)
- Seed database per suite; stable selectors by roles/labels

Deliverables:
- 3–5 user journeys (create plant, create measurement, bulk upload)

### 7) CI/CD Integration and Quality Gates (Day 5–16, parallel)
- GitHub Actions jobs for backend, frontend, e2e
- Gates: coverage thresholds (progressively tightened), style/type checks, pre-commit enforcement

Deliverables:
- .github/workflows/ci.yml with green runs; coverage reports/badges

### 8) Refactor for Testability (Continuous)
- Introduce seams and DI for DB/3rd-party services
- Extract pure logic; ports/adapters for external calls
- React: minimize side effects in hooks; separate presentation vs container logic

Deliverables:
- Lower mocking complexity; faster, more reliable tests

### 9) Coverage Expansion and Resilience (Day 16–25)
- Negative/edge cases; hypothesis for critical logic
- Mutation testing pilot on hot path to uncover assertion gaps
- Flaky management: diagnose root causes; limit retries to known external nondeterminism
- Performance: mark slow; run nightly; parallelize with xdist

Deliverables:
- Increased confidence; brittle areas identified and hardened

### 10) Living Documentation and DX (Day 20–30)
- Testing READMEs per package (backend/TESTING.md, frontend/TESTING.md)
- Makefile targets for test/e2e flows; Storybook stories as interactive docs (optional)

Deliverables:
- Self‑serve docs; consistent developer workflows

## Key Config Snippets

### Pytest config (pyproject.toml excerpt)
- addopts: -ra -q --strict-markers --maxfail=1 --cov=backend/app --cov-report=term-missing
- markers: slow, integration, flaky
- asyncio settings configured

### FastAPI conftest.py (example)
- Provide app and HTTP client fixtures; override settings to ensure TEST DB (appdb_test) only

### Jest setup
- setupTests.ts imports @testing-library/jest-dom; msw server lifecycle hooks

### Playwright config
- tests/e2e directory; baseURL from E2E_BASE_URL env; HTML reporter to playwright-report

### GitHub Actions (simplified)
- Separate backend/frontend/e2e jobs; upload coverage; cache dependencies; fail on thresholds

## Database Isolation Requirements (MANDATORY)
- Runtime and tests use same DB server instance but separate schemas
- Tests must only target appdb_test; guardrails in fixtures and CI to fail otherwise
- E2E must not touch runtime DB
- For any tests use docker-compose.test.yml settings and appdb_test

## Rollout Timeline (30 days)
- Week 1: Tooling, scaffolding, first tests, CI green
- Week 2: Backend integration, msw-backed component integration
- Week 3: E2E smoke, initial gates, refactors for testability
- Week 4: Coverage hardening, mutation pilot, docs, raise thresholds

## Success Criteria
- CI enforces style, types, tests; average pipeline < 10 minutes
- Coverage: backend 80%+, frontend 70%+, critical modules 90%+
- <2% flaky rate over 2 weeks; mean time to diagnose < 30 minutes
- New features land with tests in the same PR; review checklist includes test scenarios

## How to Use This Plan
- Start with TESTING_STRATEGY.md for the overview and priorities
- Use this TEST_PLAN.md to drive implementation week by week
- See TEST.md for Docker-based test commands (unit, integration, e2e)
