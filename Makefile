# Standardized developer workflows

# Compose files
RUN_COMPOSE = docker-compose.yml
TEST_COMPOSE = docker-compose.test.yml

define WORKFLOW_HINT
	@echo ""
	@echo "  Write code"
	@echo "      ↓"
	@echo "  make test-be    ← unit tests backend$(if $(filter test-be,$(MAKECMDGOALS)),                 ← you are here ←)"
	@echo "  make test-fe    ← unit tests frontend$(if $(filter test-fe,$(MAKECMDGOALS)),                ← you are here ←)"
	@echo "  make test-e2e   ← end-to-end tests frontend$(if $(filter test-e2e,$(MAKECMDGOALS)),         ← you are here ←)"
	@echo "      ↓"
	@echo "  make fe-fix     ← auto-fix formatting + lint$(if $(filter fe-fix,$(MAKECMDGOALS)),          ← you are here ←)"
	@echo "      ↓"
	@echo "  make be-cicd    ← verify: pre-commit checks pass$(if $(filter be-cicd,$(MAKECMDGOALS)),     ← you are here ←)"
	@echo "  make fe-cicd    ← verify: pre-commit checks pass$(if $(filter fe-cicd,$(MAKECMDGOALS)),     ← you are here ←)"
	@echo "      ↓"
	@echo "  git commit"
	@echo ""
endef

.PHONY: help
help:
	@echo "Runtime targets (docker-compose.yml):"
	@echo "  make run-build         - Build runtime containers"
	@echo "  make run-up            - Start runtime containers (detached)"
	@echo "  make run-up-f          - Start runtime containers (foreground)"
	@echo "  make run-down          - Stop runtime containers"
	@echo "  make run-start         - Start runtime containers"
	@echo "  make run-stop          - Stop runtime containers"
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
	@echo "  make test-e2e          - Run Playwright E2E tests"
	@echo "  make test-e2e-ci-wait  - Reproduce GitHub CI wait-for-services check from a clean stack"
	@echo "  make e2e-deps          - Run Playwright E2E tests with reinstalling deps"
	@echo "  make e2e-headed        - Run Playwright E2E tests in headed mode"
	@echo "  make e2e-report        - Open Playwright report"
	@echo "  make e2e-cicd          - Run CI/CD pipeline for E2E"
	@echo ""
	@echo "Frontend targets (local/Docker):"
	@echo "  make fe-dev            - Start Vite dev server (local)"
	@echo "  make test-fe           - Run frontend unit tests (in Docker)"
	@echo "  make test-fe-ci        - Run frontend unit tests in GitHub CI parity mode (Node 24 + npm ci + CI=true)"
	@echo "  make fe-sb             - Start Storybook (local)"
	@echo "  make fe-sb-build       - Build static Storybook (local)"
	@echo "  make fe-format         - Auto-fix frontend formatting with Prettier"
	@echo "  make fe-lint           - Auto-fix frontend ESLint issues"
	@echo "  make fe-fix            - Auto-fix formatting and lint"
	@echo "  make fe-cicd           - Run CI/CD pipeline for FE"
	@echo ""
	@echo "Backend tooling (in Docker):"
	@echo "  make be-lint           - Run ruff"
	@echo "  make be-lint-fix       - Run ruff with --fix"
	@echo "  make be-fmt            - Run black check"
	@echo "  make be-fmt-fix        - Run black fix"
	@echo "  make be-mypy           - Run mypy"
	@echo "  make be-pre-commit     - Run pre-commit (CI config)"
	@echo "  make be-cicd           - Run CI/CD pipeline for BE"
	@echo ""
	@echo "Utility:"
	@echo "  make certs             - Generate dev certificates"
	@echo "  make dep-audit         - Audit dependencies for vulnerable/drifting versions"
	@echo ""
	@echo "Developer workflow:"
	$(WORKFLOW_HINT)


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

.PHONY: run-start
run-start:
	docker compose -f $(RUN_COMPOSE) start

.PHONY: run-stop
run-stop:
	docker compose -f $(RUN_COMPOSE) stop

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

.PHONY: test-start
test-start:
	docker compose -f $(TEST_COMPOSE) start

.PHONY: test-stop
test-stop:
	docker compose -f $(TEST_COMPOSE) stop

.PHONY: test-logs
test-logs:
	docker compose -f $(TEST_COMPOSE) logs -f

.PHONY: test-ps
test-ps:
	docker compose -f $(TEST_COMPOSE) ps

.PHONY: test-be
test-be:
	docker compose -f $(TEST_COMPOSE) up -d runner
	docker compose -f $(TEST_COMPOSE) exec -T runner pytest -q
	$(WORKFLOW_HINT)

.PHONY: test-full
test-full:
	docker compose -f $(TEST_COMPOSE) exec -T runner pytest

.PHONY: test-cov
test-cov:
	docker compose -f $(TEST_COMPOSE) exec -T runner pytest -q --cov=app --cov-report=term-missing

# --- E2E ---
.PHONY: e2e-deps
e2e-deps:
	docker compose -f $(TEST_COMPOSE) up -d e2e
	docker compose -f $(TEST_COMPOSE) exec -T e2e bash -lc "cd /app && npm install && npx playwright test --config playwright.config.ts"

.PHONY: test-e2e
test-e2e:
	docker compose -f $(TEST_COMPOSE) up -d e2e
	docker compose -f $(TEST_COMPOSE) exec -T e2e bash -lc "cd /app && npx playwright test --config playwright.config.ts"
	$(WORKFLOW_HINT)

.PHONY: test-e2e-ci-wait
test-e2e-ci-wait:
	@# Mirrors GitHub E2E readiness behavior from a clean Docker volume state.
	docker compose -f $(TEST_COMPOSE) down -v
	SSL_CERT_FILE=./ssl/dev.fullchain.pem SSL_KEY_FILE=./ssl/dev.privkey.pem docker compose -f $(TEST_COMPOSE) up -d --build db backend frontend nginx
	@bash -lc 'set -euo pipefail; \
		backend_ready=0; \
		for i in {1..90}; do \
			if curl -sSf http://127.0.0.1:5080/api/health >/dev/null; then backend_ready=1; echo "Backend is up"; break; fi; \
			echo "Waiting for backend..."; sleep 5; \
		done; \
		frontend_ready=0; \
		for i in {1..90}; do \
			if curl -sSf http://127.0.0.1:5080/ >/dev/null; then frontend_ready=1; echo "Frontend is up"; break; fi; \
			echo "Waiting for frontend..."; sleep 5; \
		done; \
		if [ "$$backend_ready" -ne 1 ] || [ "$$frontend_ready" -ne 1 ]; then \
			echo "Stack not reachable after wait; dumping logs..."; \
			docker compose -f $(TEST_COMPOSE) ps; \
			docker compose -f $(TEST_COMPOSE) logs --no-color nginx || true; \
			docker compose -f $(TEST_COMPOSE) logs --no-color backend || true; \
			docker compose -f $(TEST_COMPOSE) logs --no-color frontend || true; \
			exit 1; \
		fi; \
		echo "Services reachable via nginx at http://127.0.0.1:5080"'

.PHONY: e2e-headed
e2e-headed:
	docker compose -f $(TEST_COMPOSE) up -d e2e
	docker compose -f $(TEST_COMPOSE) exec -T e2e bash -lc "cd /app && npx playwright test --config playwright.config.ts --headed"

.PHONY: e2e-report
e2e-report:
	npm run e2e:report --prefix frontend

# --- Frontend ---
.PHONY: fe-dev
fe-dev:
	npm run dev --prefix frontend

.PHONY: test-fe
test-fe:
	docker compose -f $(TEST_COMPOSE) up -d e2e
	@# Safe execution in /tmp to avoid Dropbox Bus errors on macOS
	docker compose -f $(TEST_COMPOSE) exec -T e2e bash -lc "\
		mkdir -p /tmp/fe && \
		find . -maxdepth 1 ! -name 'node_modules' ! -name '.' -exec cp -rp {} /tmp/fe/ \; && \
		cd /tmp/fe && \
		rm -rf node_modules && \
		ln -s /app/node_modules node_modules && \
		npm run test:unit:coverage && \
		cp -r coverage /app/"
		$(WORKFLOW_HINT)

.PHONY: test-fe-ci
test-fe-ci:
	@# Mirrors GitHub frontend unit-test job: Node 24 + npm ci + CI=true + coverage
	docker run --rm \
	  -v "$(PWD)/frontend:/src" \
	  node:24 \
	  bash -lc "\
		cp -r /src /tmp/fe && \
		cd /tmp/fe && \
		npm ci --no-audit --no-fund && \
		CI=true npm run test:unit:coverage"

.PHONY: fe-sb
fe-sb:
	npm run storybook --prefix frontend

.PHONY: fe-sb-build
fe-sb-build:
	npm run build-storybook --prefix frontend

.PHONY: fe-format
fe-format: ## Auto-fix frontend formatting with Prettier
	docker-compose run --rm frontend sh -c "npx prettier --write ."

.PHONY: fe-lint
fe-lint: ## Auto-fix frontend ESLint issues
	docker-compose run --rm frontend sh -c "npm run lint -- --fix"

.PHONY: fe-fix
fe-fix: ## Run all frontend auto-fixes
	$(MAKE) fe-format
	$(MAKE) fe-lint
	$(WORKFLOW_HINT)

.PHONY: fe-cicd
fe-cicd:
	docker compose -f $(TEST_COMPOSE) up -d runner
	docker compose -f $(TEST_COMPOSE) exec -T runner pre-commit run --all-files
	$(WORKFLOW_HINT)

# --- Utility ---
DEV_CERTS_SCRIPT := scripts/gen-dev-certs.sh
.PHONY: certs
certs:
	@bash $(DEV_CERTS_SCRIPT)

# --- Backend tooling in Docker ---
.PHONY: be-lint
be-lint:
	docker compose -f $(TEST_COMPOSE) up -d runner
	docker compose -f $(TEST_COMPOSE) exec -T runner bash -lc "ruff check backend/app"

.PHONY: be-lint-fix
be-lint-fix:
	docker compose -f $(TEST_COMPOSE) up -d runner
	docker compose -f $(TEST_COMPOSE) exec -T runner bash -lc "ruff check --fix backend/app"

.PHONY: be-fmt
be-fmt:
	docker compose -f $(TEST_COMPOSE) up -d runner
	docker compose -f $(TEST_COMPOSE) exec -T runner bash -lc "black --check backend/app"

.PHONY: be-fmt-fix
be-fmt-fix:
	docker compose -f $(TEST_COMPOSE) up -d runner
	docker compose -f $(TEST_COMPOSE) exec -T runner bash -lc "black backend/app"

.PHONY: be-mypy
be-mypy:
	docker compose -f $(TEST_COMPOSE) up -d runner
	docker compose -f $(TEST_COMPOSE) exec -T runner bash -lc "mypy backend/app"

.PHONY: be-pre-commit
be-pre-commit:
	docker compose -f $(TEST_COMPOSE) up -d runner
	docker compose -f $(TEST_COMPOSE) exec -T runner bash -lc "printf '%s\\n' \
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
	docker compose -f $(TEST_COMPOSE) exec -T runner bash -lc 'pre-commit run --all-files --show-diff-on-failure --color always --config .pre-commit-config.ci.yaml'

.PHONY: be-cicd
be-cicd:
	docker compose -f $(TEST_COMPOSE) up -d runner
	docker compose -f $(TEST_COMPOSE) exec -T runner pre-commit run --all-files
	$(WORKFLOW_HINT)

.PHONY: install-hooks
install-hooks:
	@cp scripts/prepare-commit-msg .git/hooks/prepare-commit-msg
	@chmod +x .git/hooks/prepare-commit-msg
	@echo "Git hooks installed."

# --- Security / dependency audit ---
.PHONY: dep-audit
dep-audit:
	bash scripts/dependency-audit.sh
