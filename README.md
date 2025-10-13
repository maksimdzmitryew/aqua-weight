AW multi-container setup (Ubuntu-based)

Overview
- 4 containers: backend (FastAPI), frontend (React via Vite dev server), db (MariaDB 10.11 LTS official image), nginx (TLS termination + reverse proxy)
- Domain: https://aw.max
- SSL: locally signed certs live in ./ssl
- One Nginx container proxies both frontend and backend

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

---

Do I need to restart any containers for changes to take effect?
Short answer: It depends on what changed. Use the guidance below.

- Frontend (Vite dev server inside container):
  - Source edits under frontend/ (JSX/TSX/CSS): no restart needed — hot reload updates automatically via Vite. docker-compose mounts ./frontend into the container and Vite uses polling to detect changes reliably inside Docker.
  - package.json changes (adding deps like react-router-dom) or frontend/Dockerfile changes: rebuild the image and recreate the container.
    - Commands:
      - docker compose build frontend
      - docker compose up -d frontend
      - Or in one go: docker compose up -d --build frontend

- Backend (FastAPI via Uvicorn):
  - The container runs Uvicorn without --reload. Code changes under backend/app will not auto-reload; restart the container to apply.
    - Commands:
      - docker compose restart backend
      - If you changed Python deps or backend/Dockerfile: docker compose up -d --build backend

- Nginx (reverse proxy and TLS):
  - nginx.conf changes: rebuild or at least restart nginx container.
    - docker compose up -d --build nginx
  - SSL cert/key files under ./ssl: container mounts them as a volume. Usually a restart is enough.
    - docker compose restart nginx

- Database (MariaDB):
  - Files in db/init/ run only on first database initialization. Changing them later won’t affect an existing data volume.
    - To re-run init scripts, you must remove the volume (DESTROYS DATA) and recreate:
      - docker compose down
      - docker volume rm aw_mariadb_data
      - docker compose up -d
  - Routine schema/data changes applied via SQL/migrations do not require restarting the DB container.

- docker-compose.yml or environment variable changes:
  - When you change docker-compose.yml or env used by a service, recreate affected services:
    - docker compose up -d --build <service>
  - For multiple services: docker compose up -d --build

- Unsure what to restart? Safe catch‑all:
  - docker compose up -d --build

Examples for recent changes in this repo:
- Added React Router and new Dashboard route (frontend source only): no restarts; Vite hot reload handles it. If you changed package.json, rebuild frontend.
- Edited nginx/nginx.conf to add a new proxy path: docker compose up -d --build nginx
- Updated db/init/schema.sql and want it to re-run: remove the DB volume (see above) and then docker compose up -d

Generating local TLS certificates (using your existing local CA)
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


## Git upstream configuration (set once, works for current and future branches)

You don’t have to set the upstream manually for every branch. You can configure Git to do it automatically on the first push, and you can also bulk‑set upstreams for your existing local branches.

One‑time global setup (Git 2.37+ recommended):

- Automatically set upstream on the first push of a new branch:
  git config --global push.autoSetupRemote true

- (Optional) Set the default remote used by plain `git push` if multiple remotes exist:
  git config --global remote.pushDefault origin

With these settings, when you create a new branch locally and simply run `git push` for the first time, Git will create the branch on `origin` and set the upstream automatically. Future pushes/pulls on that branch will “just work.”

For the current branch only (without changing global settings):
- One‑time for the current branch:
  git push -u origin HEAD

Bulk set upstream for all existing local branches (run once):
- This will create the remote branches (if missing) and set tracking for each local branch.
  for br in $(git for-each-ref --format='%(refname:short)' refs/heads); do \
    git push -u origin "$br"; \
  done

Notes:
- Git version: `push.autoSetupRemote` was introduced in Git 2.37. Check your version with `git --version`.
- If you can’t upgrade Git, you can make an alias that always sets upstream for the current branch:
  git config --global alias.pu 'push -u origin HEAD'
  # usage: git pu
- These settings are safe for both local development and CI. In CI, prefer explicit `git push origin HEAD:refs/heads/<branch>` if you need strict control.


## Default branch naming: main vs master

- Industry standard (2025): “main” is the widely adopted default branch name across major platforms (GitHub, GitLab, Bitbucket). “master” persists only in legacy repos.
- Recommendation: Use “main” for new repositories. For existing repos on “master,” migrate when convenient to reduce friction and align with ecosystem defaults.

Migration guide (safe steps):
1) Create/push main from your current default branch locally:
   git branch -m master main
   git push -u origin main

2) On your Git hosting (e.g., GitHub):
   - Settings → Branches → change Default branch to “main”.
   - Update branch protection rules to apply to “main”.

3) Update CI/CD and docs that explicitly reference “master”. Prefer using the symbolic default branch ref when possible (e.g., GitHub’s default branch setting or refs/heads/$(git symbolic-ref --short refs/remotes/origin/HEAD)).

4) Optionally remove the old branch (after switching default and updating PRs):
   git push origin --delete master

5) For existing local clones (teammates/CI runners):
   git branch -m master main
   git fetch origin
   git branch -u origin/main main
   git remote set-head origin -a

Notes:
- If your current default branch is already “main,” no action is needed.
- Some CI and branch protection configs are name-sensitive; review them during the migration.
