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
