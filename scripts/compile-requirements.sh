#!/usr/bin/env bash
set -euo pipefail

echo "== Compile Python requirements with hashes =="
if ! command -v pip-compile >/dev/null 2>&1; then
  echo "pip-compile not installed. Install with: pip install pip-tools"
  exit 1
fi

pip-compile --generate-hashes backend/requirements.txt --output-file backend/requirements.lock
echo "Wrote backend/requirements.lock (hash-pinned)"
