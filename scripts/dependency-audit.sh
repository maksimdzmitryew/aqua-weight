#!/usr/bin/env bash
set -euo pipefail

echo "== Python dependency audit =="
if command -v pip-audit >/dev/null 2>&1; then
  pip-audit -r backend/requirements.txt
else
  echo "pip-audit not installed. Install with: pip install pip-audit"
fi

echo ""
echo "== Node dependency audit (prod deps) =="
if command -v npm >/dev/null 2>&1; then
  (cd frontend && npm audit --omit=dev)
else
  echo "npm not installed. Install Node.js to run npm audit."
fi