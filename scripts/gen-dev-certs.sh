#!/usr/bin/env bash
set -euo pipefail

SSL_DIR=${SSL_DIR:-"$(dirname "$0")/../ssl"}
CERT_FILE=${SSL_DIR}/dev.fullchain.pem
KEY_FILE=${SSL_DIR}/dev.privkey.pem

mkdir -p "${SSL_DIR}"

echo "Generating local development self-signed certs in ${SSL_DIR}..."
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "${KEY_FILE}" \
  -out "${CERT_FILE}" \
  -days 3650 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,DNS:aw.max"

echo "Done:"
echo "  CERT: ${CERT_FILE}"
echo "  KEY : ${KEY_FILE}"
