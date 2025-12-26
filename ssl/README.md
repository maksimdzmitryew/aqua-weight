This directory is used for TLS materials in CI and local development.

GitHub CI (generated at workflow time):

- github-ci.fullchain.pem
- github-ci.privkey.pem

Notes for CI:
- These are generated during GitHub Actions runs and are not intended for production.
- docker-compose.yml and docker-compose.test.yml mount certificate paths via env vars:
  - SSL_CERT_FILE (defaults locally to ./ssl/dev.fullchain.pem)
  - SSL_KEY_FILE (defaults locally to ./ssl/dev.privkey.pem)
  The CI workflow sets these env vars to the github-ci.* filenames.

Local development:
- Generate local self-signed certs once:
  make dev-certs
  This will create:
  - dev.fullchain.pem
  - dev.privkey.pem

- With those files present, `docker compose up -d` will start nginx successfully.

Security & scope:
- All files here are for testing/development only; never use in production.
