This directory is used by CI to hold ephemeral, self-signed TLS certificates for E2E tests.

Files generated at workflow time:

- github-ci.fullchain.pem
- github-ci.privkey.pem

Notes:
- These are generated during GitHub Actions runs and are not intended for production.
- docker-compose.yml and docker-compose.test.yml mount these files into the nginx container as /etc/ssl/aw.max/fullchain.pem and /etc/ssl/aw.max/privkey.pem.
- Local development may use different certificates or plain HTTP; these CI files are optional locally.
