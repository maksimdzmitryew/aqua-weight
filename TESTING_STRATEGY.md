# One‑Pager Test Strategy and Priorities

Project: AW (FastAPI backend + React/Vite frontend)
Date: 2025‑11‑08
Owner: QA/Dev

1) Context and Scope
- Objective: Establish a pragmatic testing baseline focusing on the most critical CRUD paths and UX flows to enable safe iteration.
- Out of scope (for now): Performance/load, exhaustive cross‑browser, and full device matrix; deep security pen‑testing.

2) Inventory: Critical Surfaces
Backend (FastAPI, mounted under /api)
- Health: GET /health, GET /hello/{name}
- Plants (CRUD and ordering):
  - GET /plants (list)
  - POST /plants (create)
  - GET /plants/{id} (details)
  - PATCH /plants/{id} (update)
  - DELETE /plants/{id} (delete)
  - POST /plants/reorder (reorder IDs)
- Measurements:
  - POST /measurements (create measurement)
  - GET /measurements?... (query/list as implemented)
- Locations (CRUD): list/create/get/update/delete
- Daily/Repotting helpers: endpoints under routes/daily.py and routes/repotting.py
Notes: Exact param shapes defined in backend/app/schemas/*.py; DB via PyMySQL to MariaDB.

Frontend (React 18 + Vite)
- Pages: PlantsList, PlantCreate, PlantEdit, PlantDetails, MeasurementCreate, BulkWeightMeasurement, LocationsList, LocationCreate, LocationEdit, WateringCreate, RepottingCreate, DailyCare, Dashboard, Settings.
- Components: form fields (TextInput, NumberInput, Select, Checkbox, DateTimeLocal), feedback (Loader, ErrorNotice, EmptyState), layout (DashboardLayout, PageHeader, IconButton, ConfirmDialog).

3) External Dependencies and Environment
- Database: MariaDB 10.11 (docker-compose service "db"), accessed via PyMySQL; schema in db/init/schema.sql.
- Web: Nginx terminates TLS, proxies frontend/backend; local certs in ssl/.
- Caching/Message brokers: None presently.
- Third‑party APIs: None presently.
- Config: python-dotenv used; containerized dev via docker-compose.

4) Minimal Support Matrix (initial)
- Python: 3.10 (tooling and runtime target) — reflected in .tool-versions; compatible with FastAPI 0.115 and uvicorn 0.30.
- Node.js: 20.x LTS (tooling and Vite dev server) — reflected in .tool-versions and frontend Dockerfile.
- Package managers: pip (backend), npm (frontend). Browsers for E2E: latest Chromium in CI initially.

5) Test Strategy and Levels
- Unit (Priority 1)
  - Backend: pure helpers in app/helpers/* (e.g., plants_list, watering, water_loss), schemas validations, utilities (utils/date_time.py etc.).
  - Frontend: form field components and utilities (src/utils/datetime.js) using React Testing Library.
- API/Controller tests (Priority 1)
  - FastAPI router endpoints for plants, measurements, locations: happy paths + key errors (validation, 404, constraint checks) using TestClient/httpx.
- Integration (Priority 2)
  - Backend with real MariaDB where behavior depends on SQL constraints. Seed via lightweight factories; run schema.sql in setup.
  - Frontend component integration with mocked network (msw) to cover list rendering, form submission success/error.
- E2E smoke (Priority 3)
  - Small Playwright suite: load PlantsList, create plant, create measurement, verify appearance.

6) Test Data and Fixtures
- Backend: deterministic factory patterns for Plant and Measurement; DB reset per test; datetime helpers to freeze time where appropriate.
- Frontend: msw handlers for /api/plants, /api/measurements, /api/locations; test-utils with router and potential providers.

7) Prioritized Coverage Targets (initial)
- Backend
  - Plants CRUD + reorder: 70%+ statements on routes/plants.py and helpers that compute list ordering.
  - Measurements create + read: 60%+ for routes/measurements.py and services/measurements.py.
  - Locations CRUD basic happy paths: minimal smoke.
  - Health endpoints: smoke only.
- Frontend
  - PlantsList: list rendering, empty state, error state.
  - MeasurementCreate + BulkWeightMeasurement: form validation, submission success/error.
  - Form fields: basic behavior (onChange, validation, disabled states).

8) Tooling Direction (next steps)
- Backend: pytest, pytest-cov, ruff, black, mypy; httpx/pytest-asyncio if needed. Optionally testcontainers for MariaDB; otherwise ephemeral local MariaDB with isolated schema.
- Frontend: jest + @testing-library/react + @testing-library/user-event; msw for network; eslint+prettier.
- CI: GitHub Actions job to run unit + API tests; coverage thresholds enforced at conservative levels initially.

9) Risks and Assumptions
- DB behavior differs between MariaDB and SQLite; avoid SQLite for constraints-heavy paths, or cover via testcontainers.
- Timezones and datetime parsing are error-prone (utils/date_time, DateTimeLocal component); add tests around boundary cases.
- IDs appear to use hex/bytes conversions in plants routes; include tests for invalid IDs and normalization.

10) Definition of Done for Step 1
- This document committed and discoverable at repo root.
- .tool-versions committed with Python 3.10 and Node 20.
- Inventory lists critical endpoints/pages and dependencies.
