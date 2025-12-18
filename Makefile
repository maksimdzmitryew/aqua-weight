# Standardized developer workflows

# Compose files
TEST_COMPOSE = docker-compose.test.yml

.PHONY: help
help:
	@echo "Common targets:"
	@echo "  make test-up           - Build and start test stack (db, backend, frontend, nginx, tests)"
	@echo "  make test-down         - Stop test stack"
	@echo "  make test              - Run backend tests (pytest) in tests container"
	@echo "  make test-cov          - Run backend tests with coverage"
	@echo "  make e2e               - Run Playwright E2E tests"
	@echo "  make e2e-headed        - Run Playwright E2E tests in headed mode"
	@echo "  make e2e-report        - Open Playwright report"
	@echo "  make sb                - Start Storybook (frontend)"
	@echo "  make sb-build          - Build static Storybook"
	@echo "  make dev-frontend      - Start Vite dev server"
	@echo "  make lint-backend      - Run ruff (lint) inside backend container"
	@echo "  make lint-backend-fix  - Run ruff with --fix inside backend container"
	@echo "  make black-backend     - Run black --check inside backend container"
	@echo "  make mypy-backend      - Run mypy inside backend container"
	@echo "  make pre-commit-backend-ci - Run trimmed pre-commit (Python-only) inside backend container"

.PHONY: test-up
test-up:
	docker compose -f $(TEST_COMPOSE) up -d --build

.PHONY: test-down
test-down:
	docker compose -f $(TEST_COMPOSE) down

.PHONY: test
test:
	docker compose -f $(TEST_COMPOSE) exec tests pytest -q

.PHONY: test-cov
test-cov:
	docker compose -f $(TEST_COMPOSE) exec tests pytest -q --cov=app --cov-report=term-missing

.PHONY: e2e
e2e:
	docker compose -f $(TEST_COMPOSE) exec e2e bash -lc "npm ci --prefix frontend && npm run e2e --prefix frontend"

.PHONY: e2e-headed
e2e-headed:
	docker compose -f $(TEST_COMPOSE) exec e2e bash -lc "npm ci --prefix frontend && npm run e2e:headed --prefix frontend"

.PHONY: e2e-report
e2e-report:
	npm run e2e:report --prefix frontend

.PHONY: sb
sb:
	npm run storybook --prefix frontend

.PHONY: sb-build
sb-build:
	npm run build-storybook --prefix frontend

.PHONY: dev-frontend
dev-frontend:
	npm run dev --prefix frontend

DEV_CERTS_SCRIPT := scripts/gen-dev-certs.sh

.PHONY: dev-certs
dev-certs:
	@bash $(DEV_CERTS_SCRIPT)

# ------------------- Backend tooling in Docker -------------------
.PHONY: lint-backend
lint-backend:
	# Ensure test runner service is up so we can exec dev tools there
	docker compose -f $(TEST_COMPOSE) up -d --build runner
	# Run ruff check on backend Python code inside the tests runner container
	docker compose -f $(TEST_COMPOSE) exec runner bash -lc "ruff check backend/app"

.PHONY: lint-backend-fix
lint-backend-fix:
	docker compose -f $(TEST_COMPOSE) up -d --build runner
	docker compose -f $(TEST_COMPOSE) exec runner bash -lc "ruff check --fix backend/app"

.PHONY: black-backend
black-backend:
	docker compose -f $(TEST_COMPOSE) up -d --build runner
	docker compose -f $(TEST_COMPOSE) exec runner bash -lc "black --check backend/app"

.PHONY: mypy-backend
mypy-backend:
	docker compose -f $(TEST_COMPOSE) up -d --build runner
	docker compose -f $(TEST_COMPOSE) exec runner bash -lc "mypy backend/app"

.PHONY: pre-commit-backend-ci
pre-commit-backend-ci:
	# Run a CI-trimmed pre-commit config inside the tests runner container to avoid JS hooks
	docker compose -f $(TEST_COMPOSE) up -d --build runner
	# Robust, single-invocation YAML write via printf (avoids heredoc/Make parsing pitfalls)
	docker compose -f $(TEST_COMPOSE) exec runner bash -lc "printf '%s\\n' \
	  'repos:' \
	  '  - repo: https://github.com/pre-commit/pre-commit-hooks' \
	  '    rev: v4.6.0' \
	  '    hooks:' \
	  '      - id: check-merge-conflict' \
	  '' \
	  '  - repo: https://github.com/astral-sh/ruff-pre-commit' \
	  '    rev: v0.6.9' \
	  '    hooks:' \
	  '      - id: ruff' \
	  '        args: ["--no-fix"]' \
	  '        types_or: [python]' \
	  '        files: ^backend/|' \
	  > .pre-commit-config.ci.yaml"
	# Run with the generated, trimmed config
	docker compose -f $(TEST_COMPOSE) exec runner bash -lc 'pre-commit run --all-files --show-diff-on-failure --color always --config .pre-commit-config.ci.yaml'
