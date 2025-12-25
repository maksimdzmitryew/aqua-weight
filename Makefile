# Standardized developer workflows

# Compose files
RUN_COMPOSE = docker-compose.yml
TEST_COMPOSE = docker-compose.test.yml

.PHONY: help
help:
	@echo "Runtime targets (docker-compose.yml):"
	@echo "  make run-build         - Build runtime containers"
	@echo "  make run-up            - Start runtime containers (detached)"
	@echo "  make run-up-f          - Start runtime containers (foreground)"
	@echo "  make run-down          - Stop runtime containers"
	@echo "  make run-logs          - Show runtime logs"
	@echo "  make run-ps            - Status of runtime containers"
	@echo ""
	@echo "Test targets (docker-compose.test.yml):"
	@echo "  make test-build        - Build test containers"
	@echo "  make test-up           - Start test stack (detached)"
	@echo "  make test-up-f         - Start test stack (foreground)"
	@echo "  make test-down         - Stop test stack"
	@echo "  make test-be           - Run backend tests (pytest)"
	@echo "  make test-logs         - Show test logs"
	@echo "  make test-ps           - Status of test containers"
	@echo ""
	@echo "E2E targets (in Docker):"
	@echo "  make e2e               - Run Playwright E2E tests"
	@echo "  make e2e-headed        - Run Playwright E2E tests in headed mode"
	@echo "  make e2e-report        - Open Playwright report"
	@echo "  make e2e-quick         - Run Playwright E2E tests without reinstalling deps"
	@echo ""
	@echo "Frontend targets (local/Docker):"
	@echo "  make fe-dev            - Start Vite dev server (local)"
	@echo "  make test-fe      - Run frontend unit tests (in Docker)"
	@echo "  make fe-sb             - Start Storybook (local)"
	@echo "  make fe-sb-build       - Build static Storybook (local)"
	@echo ""
	@echo "Backend tooling (in Docker):"
	@echo "  make be-lint           - Run ruff"
	@echo "  make be-lint-fix       - Run ruff with --fix"
	@echo "  make be-fmt            - Run black check"
	@echo "  make be-fmt-fix        - Run black fix"
	@echo "  make be-mypy           - Run mypy"
	@echo "  make be-pre-commit     - Run pre-commit (CI config)"
	@echo ""
	@echo "Utility:"
	@echo "  make certs             - Generate dev certificates"

# --- Runtime stack ---
.PHONY: run-build
run-build:
	docker compose -f $(RUN_COMPOSE) build

.PHONY: run-up
run-up:
	docker compose -f $(RUN_COMPOSE) up -d

.PHONY: run-up-f
run-up-f:
	docker compose -f $(RUN_COMPOSE) up

.PHONY: run-down
run-down:
	docker compose -f $(RUN_COMPOSE) down

.PHONY: run-logs
run-logs:
	docker compose -f $(RUN_COMPOSE) logs -f

.PHONY: run-ps
run-ps:
	docker compose -f $(RUN_COMPOSE) ps

# --- Test stack ---
.PHONY: test-build
test-build:
	docker compose -f $(TEST_COMPOSE) build

.PHONY: test-up
test-up:
	docker compose -f $(TEST_COMPOSE) up -d

.PHONY: test-up-f
test-up-f:
	docker compose -f $(TEST_COMPOSE) up

.PHONY: test-down
test-down:
	docker compose -f $(TEST_COMPOSE) down

.PHONY: test-logs
test-logs:
	docker compose -f $(TEST_COMPOSE) logs -f

.PHONY: test-ps
test-ps:
	docker compose -f $(TEST_COMPOSE) ps

.PHONY: test-be
test-be:
	docker compose -f $(TEST_COMPOSE) up -d runner
	docker compose -f $(TEST_COMPOSE) exec runner pytest -q

.PHONY: test-full
test-full:
	docker compose -f $(TEST_COMPOSE) exec runner pytest

.PHONY: test-cov
test-cov:
	docker compose -f $(TEST_COMPOSE) exec runner pytest -q --cov=app --cov-report=term-missing

# --- E2E ---
.PHONY: e2e
e2e:
	docker compose -f $(TEST_COMPOSE) exec e2e bash -lc "npm install --prefix frontend && npx playwright test --config /app/frontend/playwright.config.ts"

.PHONY: e2e-quick
e2e-quick:
	docker compose -f $(TEST_COMPOSE) exec e2e npx playwright test --config /app/frontend/playwright.config.ts

.PHONY: e2e-headed
e2e-headed:
	docker compose -f $(TEST_COMPOSE) exec e2e npx playwright test --config /app/frontend/playwright.config.ts --headed

.PHONY: e2e-report
e2e-report:
	npm run e2e:report --prefix frontend

# --- Frontend ---
.PHONY: fe-dev
fe-dev:
	npm run dev --prefix frontend

.PHONY: test-fe
test-fe:
	docker compose -f $(TEST_COMPOSE) exec e2e npm run test:unit:coverage

.PHONY: fe-sb
fe-sb:
	npm run storybook --prefix frontend

.PHONY: fe-sb-build
fe-sb-build:
	npm run build-storybook --prefix frontend

# --- Utility ---
DEV_CERTS_SCRIPT := scripts/gen-dev-certs.sh
.PHONY: certs
certs:
	@bash $(DEV_CERTS_SCRIPT)

# --- Backend tooling in Docker ---
.PHONY: be-lint
be-lint:
	docker compose -f $(TEST_COMPOSE) up -d runner
	docker compose -f $(TEST_COMPOSE) exec runner bash -lc "ruff check backend/app"

.PHONY: be-lint-fix
be-lint-fix:
	docker compose -f $(TEST_COMPOSE) up -d runner
	docker compose -f $(TEST_COMPOSE) exec runner bash -lc "ruff check --fix backend/app"

.PHONY: be-fmt
be-fmt:
	docker compose -f $(TEST_COMPOSE) up -d runner
	docker compose -f $(TEST_COMPOSE) exec runner bash -lc "black --check backend/app"

.PHONY: be-fmt-fix
be-fmt-fix:
	docker compose -f $(TEST_COMPOSE) up -d runner
	docker compose -f $(TEST_COMPOSE) exec runner bash -lc "black backend/app"

.PHONY: be-mypy
be-mypy:
	docker compose -f $(TEST_COMPOSE) up -d runner
	docker compose -f $(TEST_COMPOSE) exec runner bash -lc "mypy backend/app"

.PHONY: be-pre-commit
be-pre-commit:
	docker compose -f $(TEST_COMPOSE) up -d runner
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
	  '        args: [\"--no-fix\"]' \
	  '        types_or: [python]' \
	  '        files: ^backend/|' \
	  > .pre-commit-config.ci.yaml"
	docker compose -f $(TEST_COMPOSE) exec runner bash -lc 'pre-commit run --all-files --show-diff-on-failure --color always --config .pre-commit-config.ci.yaml'
