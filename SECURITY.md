# Security Policy

We take the security of this project seriously. Please follow the guidelines below when using or contributing.

## Supported versions
This project is in active development. Security fixes will be applied to the default branch.

## Reporting a vulnerability
- Do not open public issues for suspected vulnerabilities.
- Instead, please report privately via email or a direct message to the maintainers.
- Provide steps to reproduce, affected versions/commit, and any relevant logs.
- We will acknowledge receipt within 72 hours and work with you on a fix and coordinated disclosure.

## Secrets and sensitive data
- Never commit secrets (API keys, passwords, tokens) or private keys.
- Do not commit TLS materials (certificates/keys). Place local dev certs under `./ssl/` on your machine only. The `ssl/` directory is ignored by Git and excluded from Docker build contexts.
- Keep all environment-specific credentials in a local `.env` file or CI/CD secrets manager, not in the repository.
- Example values in `.env.example` are placeholders for local development only and must be overridden in real deployments.

## Docker and deployment
- Build contexts are restricted via `.dockerignore` to avoid leaking local secrets into images.
- Do not mount or bake real secrets into images. Use runtime secrets/variables (e.g., Docker secrets, CI/CD secret stores) for production.
- The sample `docker-compose.yml` uses development-friendly defaults. Override via `.env` for any non-local environment, and never use the default credentials in production.

## Hardening recommendations (optional)
- Use a secrets scanner (e.g., `detect-secrets`, `git-secrets`) locally and in CI.
- Enable Dependabot or similar tooling for dependency updates.
- Run container image scanners (e.g., Trivy, Grype) in CI.
- Consider read-only file systems, dropping privileges, and resource limits for containers in production.

## Responsible disclosure
If you discover a security issue, please keep it confidential and allow us reasonable time to release a fix before public disclosure. Thank you for helping keep the community safe.