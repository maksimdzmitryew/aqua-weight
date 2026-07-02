#!/usr/bin/env bash
# Simple load test using wrk (faster, simpler than locust)
# Install wrk: brew install wrk (macOS) or apt install wrk (Linux)

set -euo pipefail

HOST="${1:-http://localhost:5080}"
DURATION="${2:-30s}"
THREADS="${3:-4}"
CONNECTIONS="${4:-100}"

echo "Load testing $HOST for $DURATION with $THREADS threads and $CONNECTIONS connections..."

# First, get an access token
TOKEN=$(curl -s -X POST "$HOST/api/test/login" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
echo "Got access token: ${TOKEN:0:20}..."

# Create a wrk script for authenticated requests
cat > /tmp/wrk_auth.lua << 'LUA'
wrk.headers["Authorization"] = "Bearer " .. os.getenv("AUTH_TOKEN")
LUA

AUTH_TOKEN="$TOKEN" wrk -t"$THREADS" -c"$CONNECTIONS" -d"$DURATION" \
    -s /tmp/wrk_auth.lua \
    "$HOST/api/plants?page=1&limit=20"

echo ""
echo "Load test complete."
