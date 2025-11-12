AW multi-container setup (Ubuntu-based)

Overview
- 4 containers: backend (FastAPI), frontend (React via Vite dev server), db (MariaDB 10.11 LTS official image), nginx (TLS termination + reverse proxy)
- Domain: https://aw.max
- SSL: locally signed certs live in ./ssl
- One Nginx container proxies both frontend and backend

Developer workflows and tests
- High-level plan: see TEST_PLAN.md (step-by-step actions) and TESTING_STRATEGY.md (one-pager priorities).
- See backend/TESTING.md and frontend/TESTING.md for per-package testing guides (commands, fixtures philosophy, AAA/GWT patterns).
- Standardized commands are available via Makefile. Run `make help` to discover targets (test-up, test, e2e, sb, etc.).

Background: collation and engine choice
- MySQL offers some of the most accurate modern Unicode collations (e.g., utf8mb4_0900_ai_ci), delivering high‑quality multilingual sorting, case/diacritic handling, and consistent comparisons across scripts.
- However, to avoid reliance on closed‑source stewardship and keep the stack community‑governed, this project uses MariaDB by default.
- MariaDB provides a comparable level of UTF‑8 collation quality (e.g., utf8mb4_uca1400_ai_ci), and end users are welcome to choose the engine/collation that best fits their needs and preferences.

Project layout
- backend/
  - app/main.py
  - requirements.txt
  - Dockerfile
- frontend/
  - package.json, vite.config.js, index.html, src/
  - Dockerfile
- nginx/
  - nginx.conf
  - Dockerfile
- ssl/
  - fullchain.pem (place your cert here)
  - privkey.pem (place your key here)
- docker-compose.yml
- .env.example (copy to .env to override DB creds)

Prerequisites
- Add hosts entry (already confirmed): 127.0.0.1 aw.max
- Create TLS certs for aw.max and place in ./ssl as:
  - ./ssl/fullchain.pem
  - ./ssl/privkey.pem
  Note: Do not commit real certs to VCS.

Quick start
1) Copy env defaults (optional):
   cp .env.example .env
   # edit .env to customize MariaDB credentials

2) Build and start:
   docker compose up --build

3) Open the site:
   https://aw.max

4) Test API endpoints (through nginx):
   - https://aw.max/api/
   - https://aw.max/api/hello/World

Services
- Backend (FastAPI):
  - URL (internal): http://backend:8000
  - Exposed via nginx at: https://aw.max/api/
  - Source: backend/app/main.py
- Frontend (React, Vite dev server):
  - URL (internal): http://frontend:5173
  - Exposed via nginx at: https://aw.max/
  - Source: frontend/
- Database (MariaDB 10.11 LTS official image):
  - Internal hostname: db
  - Credentials via .env or defaults in .env.example
- Nginx:
  - TLS termination for aw.max (certs from ./ssl)
  - Proxies /api/* to backend and everything else to frontend

Notes
- All app containers (backend, frontend, nginx) use Ubuntu base images. MariaDB uses the official mariadb:10.11 image (Debian-based).
- For local development with HTTPS, your browser may require trusting the locally signed CA/cert.
- Frontend fetches the API via the same origin and path prefix /api to avoid CORS in the browser; backend CORS also allows https://aw.max explicitly.
- To stop: docker compose down
- To clean DB data: docker volume rm aw_mariadb_data (careful: destroys data)

## Generating local TLS certificates (using your existing local CA)
This repo includes a helper script to create a certificate for aw.max signed by your local CA and place the outputs where nginx expects them (./ssl/fullchain.pem and ./ssl/privkey.pem).

Prerequisites
- Ensure you have a local Certificate Authority (CA) certificate and key. The script will prompt you for their location.
- Make sure the CA certificate is trusted by your OS/browser.

Usage
- Default (interactive prompts for CA location):
  bash scripts/gen-local-cert.sh

- Provide CA path/name explicitly (non-interactive):
  bash scripts/gen-local-cert.sh \
    --domain aw.max \
    --ca-dir /path/to/ca \
    --ca-name dockerCA

- Or specify exact files:
  bash scripts/gen-local-cert.sh \
    --ca-cert /path/to/dockerCA.crt \
    --ca-key  /path/to/dockerCA.key

- Overwrite existing ./ssl files if present:
  bash scripts/gen-local-cert.sh --force

Outputs
- ./ssl/privkey.pem
- ./ssl/fullchain.pem (leaf + CA cert)

After generating, start the stack:
- docker compose up --build
- Visit https://aw.max (ensure aw.max is mapped to 127.0.0.1 in /etc/hosts)



---

## Security and secrets

This repository is intended to be public/open-source. To reduce risk:

- Do not commit secrets of any kind (API keys, passwords, tokens) or private keys.
- Do not commit TLS materials. Place your local development certificates under `./ssl/` on your machine only. The `ssl/` directory is ignored by Git and excluded from Docker build contexts. The repository includes only `ssl/.gitkeep` as a placeholder.
- Use `.env` locally (copied from `.env.example`) and keep it untracked. In CI/CD, use your platform’s secret store to inject environment variables.
- Default credentials in `docker-compose.yml` and `.env.example` are for local development only. Override them via `.env` or CI/CD variables; never use them in production.
- Docker build contexts are restricted via `.dockerignore` to avoid leaking local files into images.

Recommended (optional):
- Use a local/CI secret scanner (e.g. `detect-secrets` or `git-secrets`).
- Enable dependency and container image scanning in CI (e.g. Dependabot, Trivy).
- Follow the guidelines in `SECURITY.md`.

## DB healthcheck mariadb-admin vs mysqladmin.

Using "mariadb-admin" is more robust, explicit, and quiet, which makes health status more accurate and logs cleaner. 
- Uses the MariaDB-native client: `mariadb-admin` is the preferred binary in MariaDB images; `mysqladmin` is a compatibility alias and may not be present/consistent across versions. Using `mariadb-admin` aligns with the image running.
- Forces a real TCP check: `-h 127.0.0.1 --protocol=TCP` ensures the healthcheck validates the TCP listener and authentication path. Without this, a client might fall back to the local Unix socket (depending on host and defaults), which can report healthy even if TCP isn’t accepting connections yet.
- Faster failure, avoids hangs: `--connect-timeout=3` prevents the healthcheck from stalling when the server isn’t reachable, so Compose can retry promptly.
- Quieter logs: `--silent` suppresses normal output so you don’t get noisy logs on each check.
- Explicit non‑zero exit on failure: `|| exit 1` guarantees a failing status if the command doesn’t succeed (the admin tool already exits non‑zero on failure, but this keeps the intention crystal-clear in a shell context).
- Works well with `start_period`: When paired with a reasonable `start_period` (e.g., 20s), it avoids early unauthenticated pings during server bootstrap that can generate “Access denied” noise.
 
### Optional refinements
- If you don’t want to use root for health checks, create a dedicated low‑privilege user and use that in the command.
- If you specifically want to validate the container’s network namespace loopback and TCP stack (not Docker DNS), `127.0.0.1` is fine. If you instead want to verify inter‑container name resolution and networking, you could target `-h db` (service name) without publishing the port; just keep `--protocol=TCP`.