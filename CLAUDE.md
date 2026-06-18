# AW — Project Guide for Claude Code

## What This Project Is

AW (Aqua Weight) is a home-automation / IoT system that tracks plant weight measurements, computes watering needs, and lets users control watering via a web UI. It is a multi-container Docker application.

**Domain:** `https://aw.max` (local dev, TLS via locally-signed certs)

## Architecture

4 Docker containers:

| Container | Tech | Role |
|-----------|------|------|
| `backend` | FastAPI (Python 3.11) | REST API at `/api/*` |
| `frontend` | React 18 + Vite dev server | Web UI, served via Nginx |
| `db` | MariaDB 10.11 LTS | Persistent data |
| `nginx` | Nginx | TLS termination, reverse proxy |

Nginx routes `/api/*` → backend, everything else → frontend.

## Directory Structure

```
aw/
├── CLAUDE.md                  ← You are here
├── README.md                  ├── Full setup guide, security notes, operation modes
├── ABOUT.txt                  ├── High-level project summary (table format)
├── TEST.md                    ├── Test commands, tooling choices, DB isolation rules
├── TESTING_STRATEGY.md        ├── Test strategy, coverage targets, priorities
├── Makefile                   ├── All developer workflows (run `make help`)
├── docker-compose.yml         ├── Runtime stack
├── docker-compose.test.yml    ├── Test stack (isolated DB: appdb_test)
├── pyproject.toml             ├── Python config: pytest, coverage, ruff, mypy, black
├── .pre-commit-config.yaml    ├── Pre-commit hooks (ruff, black, mypy, eslint, prettier)
│
├── backend/
│   ├── app/
│   │   ├── main.py            ├── FastAPI entry point, router registration
│   │   ├── errors.py          ├── Error handlers
│   │   ├── security.py        ├── API key auth, TOTP, recovery codes
│   │   ├── routes/            ├── API route modules (plants, measurements, auth, etc.)
│   │   ├── schemas/           ├── Pydantic request/response schemas
│   │   ├── services/          ├── Business logic layer
│   │   ├── helpers/           ├── Domain helpers (plants_list, watering, water_loss)
│   │   ├── utils/             ├── Utilities (date_time, etc.)
│   │   └── db/                ├── DB connection, models, migrations
│   ├── tests/
│   │   ├── unit/              ├── Unit tests
│   │   ├── integration/       ├── Integration tests (with MariaDB)
│   │   └── factories/         ├── Test factories (factory_boy)
│   ├── Dockerfile             ├── Runtime image
│   ├── Dockerfile.test        ├── Test runner image
│   ├── requirements.txt       ├── Runtime dependencies
│   ├── requirements-tests.txt ├── Test dependencies
│   └── TESTING.md             ├── Backend testing guide (commands, fixtures, patterns)
│
├── frontend/
│   ├── src/
│   │   ├── pages/             ├── Page components (PlantsList, PlantEdit, Settings, etc.)
│   │   ├── components/        ├── Shared components (forms, layout, dialogs)
│   │   ├── api/               ├── API client layer
│   │   ├── context/           ├── React contexts (AuthContext, SettingsContext)
│   │   ├── hooks/             ├── Custom hooks (useDocumentTitle, etc.)
│   │   ├── utils/             ├── Frontend utilities
│   │   ├── ThemeContext.jsx   ├── Theme provider (light/dark/system)
│   │   └── main.jsx           ├── React entry point
│   ├── tests/
│   │   ├── unit/              ├── Unit tests (Vitest + React Testing Library)
│   │   └── e2e/               ├── E2E tests (Playwright)
│   ├── TESTING.md             ├── Frontend testing guide
│   └── vitest.config.ts       ├── Vitest configuration
│
├── db/
│   ├── init/                  ├── DB initialization scripts (schema.sql)
│   └── my.cnf                 ├── MariaDB configuration
│
├── nginx/
│   ├── nginx.conf             ├── Nginx configuration
│   └── Dockerfile             ├── Nginx image
│
├── ssl/                       ├── TLS certificates (not committed, gitignored)
├── scripts/                   ├── Helper scripts (cert generation, dependency audit)
└── .github/workflows/         ├── CI/CD (ci.yml, e2e.yml)
```

## Tech Stack

### Backend
- **Runtime:** Python 3.11, FastAPI, Uvicorn
- **Database:** MariaDB 10.11 via PyMySQL
- **Testing:** pytest, pytest-cov, factory_boy, Faker, httpx
- **Linting/Formatting:** ruff, black, mypy
- **Key patterns:** Route → Service → Helper layered architecture

### Frontend
- **Runtime:** React 18, Vite dev server
- **Testing:** Vitest, React Testing Library, MSW, Playwright
- **Linting/Formatting:** ESLint, Prettier

## Developer Workflows

All standard commands are in `make help`. Key targets:

### Runtime
```bash
make run-build          # Build runtime containers
make run-up             # Start runtime stack (detached)
make run-down           # Stop runtime stack
```

### Testing
```bash
# Backend tests (in Docker test runner)
make test-be            # Run backend pytest suite
make test-cov           # Backend tests with coverage

# Frontend unit tests (in Docker e2e container)
make test-fe            # Run frontend unit tests with coverage

# E2E tests
make test-e2e           # Run Playwright E2E tests
```

### Linting / Formatting
```bash
make fix-be             # Backend: black + ruff --fix + mypy
make fix-fe             # Frontend: prettier + eslint --fix
make cicd-be            # Backend pre-commit checks
make cicd-fe            # Frontend pre-commit checks
```

### Test Stack Management
```bash
make test-up            # Start test stack (detached)
make test-down          # Stop test stack
make test-build         # Rebuild test images (only when Dockerfiles/deps change)
```

## Testing Details

### Backend Tests
- **Runner:** `docker compose -f docker-compose.test.yml exec runner pytest -q`
- **Config:** `pyproject.toml` — coverage on `backend/app`, branch coverage enabled
- **DB:** Uses `appdb_test` database (isolated from runtime `appdb`)
- **Structure:** `backend/tests/unit/` (pure logic), `backend/tests/integration/` (with DB)
- **Patterns:** AAA or Given-When-Then; behavioral test names (`test_creates_plant_when_payload_valid`)
- **Fixtures:** factory_boy factories in `backend/tests/factories/`
- **Detailed guide:** `backend/TESTING.md`

### Frontend Unit Tests
- **Runner:** `docker compose -f docker-compose.test.yml exec e2e npm run test:unit -- --run`
- **Config:** `vitest.config.ts` — jsdom environment, 100% coverage thresholds
- **Structure:** `frontend/tests/unit/` — colocated by feature (pages/, hooks/, etc.)
- **Mocking:** MSW for network mocking
- **Detailed guide:** `frontend/TESTING.md`

### E2E Tests
- **Runner:** `docker compose -f docker-compose.test.yml exec e2e npx playwright test`
- **Config:** `frontend/playwright.config.ts`
- **Base URL:** `https://aw.max` (via nginx proxy in test stack)

### DB Isolation Rule
Tests **MUST** use `appdb_test`. Runtime uses `appdb`. Never cross-contaminate. See `TEST.md` for full rules.

## Code Conventions

### Backend
- **Formatting:** black (line length 100)
- **Linting:** ruff (line length 120, rules: E/F/I/W)
- **Type checking:** mypy (strict, with relaxations for routes)
- **Import style:** ruff isort (profile: black)
- **Architecture:** Routes call Services, Services call Helpers. Keep routes thin.
- **Naming:** `snake_case` for functions/variables, `PascalCase` for classes

### Frontend
- **Formatting:** Prettier
- **Linting:** ESLint (flat config: `eslint.config.mjs`)
- **Component style:** Functional components with hooks
- **Naming:** `PascalCase` for components, `camelCase` for functions

## Security

- **TLS:** Locally-signed certs in `./ssl/` (gitignored). Generate with `make certs`.
- **Secrets:** `.env` file (gitignored), copy from `.env.example`
- **API Auth:** Optional static API key via `X-API-Key` header (bypassed in test mode)
- **Never commit:** secrets, TLS materials, `.env` files
- **Security guide:** `SECURITY.md`

## Operation Modes (Frontend Feature)

Three modes stored in `localStorage` under `operationMode`:
- **Automatic** — IoT measurements drive watering
- **Manual** (default) — Human input driven
- **Vacation** — Approximated historical schedule, virtual watering events

See `README.md` for full details on watering signatures and projection logic.

## Claude Code Task Guide

When working on a task, read these files first:

| Task Type | Read First |
|-----------|-----------|
| Backend API changes | `backend/app/routes/<module>.py`, `backend/app/schemas/<module>.py` |
| Backend business logic | `backend/app/services/<module>.py`, `backend/app/helpers/<module>.py` |
| Backend tests | `backend/TESTING.md`, `backend/tests/factories/` |
| DB schema changes | `db/init/schema.sql`, `backend/app/db/` |
| Security/auth changes | `backend/app/security.py` |
| Frontend page changes | `frontend/src/pages/<Page>.jsx`, `frontend/src/context/` |
| Frontend component changes | `frontend/src/components/<Component>.jsx` |
| Frontend tests | `frontend/TESTING.md` |
| CI/CD changes | `.github/workflows/ci.yml`, `.github/workflows/e2e.yml` |
| Docker changes | `docker-compose.yml`, `docker-compose.test.yml`, respective `Dockerfile`s |
| Linting/formatting issues | `pyproject.toml`, `eslint.config.mjs`, `.pre-commit-config.yaml` |

### Common Pitfalls
- **Test DB isolation:** Always use `appdb_test` for tests, never `appdb`
- **Frontend tabs:** The Settings page uses tabs (Preferences/Advanced/Security/Profile). Tests must switch tabs before querying fields in non-default tabs.
- **Coverage thresholds:** Frontend vitest config requires 100% coverage on all metrics. Backend requires 80%+ overall, 90%+ on critical modules.
- **Bind-mounted code:** Backend and frontend code is bind-mounted in containers. No rebuild needed for code-only changes — only for Dockerfile/dependency changes.
