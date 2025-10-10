#!/usr/bin/env bash
set -euo pipefail

# Generate a locally signed TLS certificate for a given domain using an existing local CA.
# Outputs to ./ssl/privkey.pem and ./ssl/fullchain.pem to match nginx config.
#
# Secure defaults for this project:
#  - domain: aw.max (override with --domain)
#  - CA location: prompted interactively unless provided via flags
#  - validity days: 825 (override with --days)
#
# Usage examples:
#   bash scripts/gen-local-cert.sh
#   bash scripts/gen-local-cert.sh --domain aw.max --ca-dir /path/to/ca --ca-name dockerCA
#   bash scripts/gen-local-cert.sh --ca-cert /path/to/dockerCA.crt --ca-key /path/to/dockerCA.key
#   bash scripts/gen-local-cert.sh --force
#
# This script never writes secrets outside the repository. Outputs are placed under ./ssl.

DOMAIN="aw.max"
CA_DIR=""
CA_NAME=""
CA_CERT=""
CA_KEY=""
DAYS=825
FORCE=0

print_help() {
  sed -n '1,80p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="${2:-}"; shift 2;;
    --ca-dir)
      CA_DIR="${2:-}"; shift 2;;
    --ca-name)
      CA_NAME="${2:-}"; shift 2;;
    --ca-cert)
      CA_CERT="${2:-}"; shift 2;;
    --ca-key)
      CA_KEY="${2:-}"; shift 2;;
    --days)
      DAYS="${2:-}"; shift 2;;
    --force|-f)
      FORCE=1; shift;;
    -h|--help)
      print_help; exit 0;;
    *)
      echo "Unknown argument: $1" >&2; echo; print_help; exit 1;;
  esac
done

PROJECT_ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SSL_DIR="$PROJECT_ROOT_DIR/ssl"
WORK_DIR="$PROJECT_ROOT_DIR/.certwork"
mkdir -p "$SSL_DIR" "$WORK_DIR"

# If exact CA files not provided, prompt for CA directory/name and discover files
if [[ -z "$CA_CERT" || -z "$CA_KEY" ]]; then
  if [[ -z "$CA_DIR" ]]; then
    read -r -p "Enter path to your local CA directory (contains CA cert and key): " CA_DIR
  fi
  if [[ -z "$CA_NAME" ]]; then
    read -r -p "Enter your CA base name (e.g., 'dockerCA' if files look like dockerCA.crt/key): " CA_NAME
  fi

  CANDIDATE_CERTS=(
    "$CA_DIR/$CA_NAME.crt"
    "$CA_DIR/$CA_NAME.pem"
    "$CA_DIR/$CA_NAME-ca.crt"
    "$CA_DIR/$CA_NAME-ca.pem"
  )
  CANDIDATE_KEYS=(
    "$CA_DIR/$CA_NAME.key"
    "$CA_DIR/$CA_NAME-key.pem"
    "$CA_DIR/$CA_NAME.key.pem"
  )
  for f in "${CANDIDATE_CERTS[@]}"; do
    if [[ -z "$CA_CERT" && -f "$f" ]]; then CA_CERT="$f"; fi
  done
  for f in "${CANDIDATE_KEYS[@]}"; do
    if [[ -z "$CA_KEY" && -f "$f" ]]; then CA_KEY="$f"; fi
  done
fi

# Validate CA paths
if [[ -z "$CA_CERT" || -z "$CA_KEY" ]]; then
  echo "Error: Could not locate CA certificate and key." >&2
  echo "Provide --ca-cert and --ca-key or ensure your CA directory/name is correct." >&2
  exit 1
fi

if [[ ! -r "$CA_CERT" || ! -r "$CA_KEY" ]]; then
  echo "Error: CA files are not readable: $CA_CERT / $CA_KEY" >&2
  exit 1
fi

PRIVKEY="$SSL_DIR/privkey.pem"
FULLCHAIN="$SSL_DIR/fullchain.pem"
CERT_TMP="$WORK_DIR/$DOMAIN.cert.pem"
KEY_TMP="$WORK_DIR/$DOMAIN.key.pem"
CSR_TMP="$WORK_DIR/$DOMAIN.csr.pem"
CONF_TMP="$WORK_DIR/$DOMAIN.openssl.cnf"
EXT_TMP="$WORK_DIR/$DOMAIN.ext"

if [[ -f "$PRIVKEY" || -f "$FULLCHAIN" ]]; then
  if [[ "$FORCE" != "1" ]]; then
    echo "Output files already exist:"
    [[ -f "$PRIVKEY" ]] && echo " - $PRIVKEY"
    [[ -f "$FULLCHAIN" ]] && echo " - $FULLCHAIN"
    echo "Re-run with --force to overwrite." >&2
    exit 1
  else
    rm -f "$PRIVKEY" "$FULLCHAIN"
  fi
fi

# Create a minimal OpenSSL config for SANs
cat > "$CONF_TMP" <<EOF
[ req ]
default_bits       = 2048
prompt             = no
default_md         = sha256
distinguished_name = dn
req_extensions     = req_ext

[ dn ]
C  = US
ST = Local
L  = Dev
O  = Local Dev
OU = Dev
CN = $DOMAIN

[ req_ext ]
subjectAltName = @alt_names

[ alt_names ]
DNS.1 = $DOMAIN
DNS.2 = www.$DOMAIN
DNS.3 = localhost
IP.1  = 127.0.0.1
IP.2  = ::1
EOF

cat > "$EXT_TMP" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[ alt_names ]
DNS.1 = $DOMAIN
DNS.2 = www.$DOMAIN
DNS.3 = localhost
IP.1  = 127.0.0.1
IP.2  = ::1
EOF

# Generate key and CSR
openssl genrsa -out "$KEY_TMP" 2048 >/dev/null 2>&1
openssl req -new -key "$KEY_TMP" -out "$CSR_TMP" -config "$CONF_TMP" >/dev/null 2>&1

# Sign with local CA
openssl x509 -req -in "$CSR_TMP" -CA "$CA_CERT" -CAkey "$CA_KEY" -CAcreateserial \
  -out "$CERT_TMP" -days "$DAYS" -sha256 -extfile "$EXT_TMP" >/dev/null 2>&1

# Build fullchain: leaf + CA
cat "$CERT_TMP" > "$FULLCHAIN"
cat "$CA_CERT" >> "$FULLCHAIN"

# Move private key to final location
mv "$KEY_TMP" "$PRIVKEY"

# Secure permissions
chmod 600 "$PRIVKEY"
chmod 644 "$FULLCHAIN"

# Cleanup work files (keep CSR/conf for debugging if needed)
rm -f "$CSR_TMP" "$CERT_TMP" "$CONF_TMP" "$EXT_TMP" "$WORK_DIR/ca.srl" 2>/dev/null || true

# Minimal output to avoid leaking paths
echo "Successfully generated TLS materials under ./ssl"