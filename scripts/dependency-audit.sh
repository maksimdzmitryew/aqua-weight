#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PYTHON_AUDIT_OK=true
NODE_AUDIT_OK=true

echo "== Python dependency audit =="
if command -v pip-audit >/dev/null 2>&1; then
    pip-audit -r "$PROJECT_ROOT/backend/requirements.txt" || PYTHON_AUDIT_OK=false
else
    echo "WARNING: pip-audit not installed. Install with: pip install pip-audit"
    echo "Skipping Python audit."
    PYTHON_AUDIT_OK=false
fi

echo ""
echo "== Node dependency audit (prod deps) =="
if command -v npm >/dev/null 2>&1; then
    (cd "$PROJECT_ROOT/frontend" && npm audit --omit=dev) || NODE_AUDIT_OK=false
else
    echo "WARNING: npm not installed. Install Node.js to run npm audit."
    echo "Skipping Node audit."
    NODE_AUDIT_OK=false
fi

echo ""
if [ "$PYTHON_AUDIT_OK" = true ] && [ "$NODE_AUDIT_OK" = true ]; then
    echo "✓ All dependency audits passed."
    exit 0
else
    echo "✗ One or more dependency audits failed or were skipped."
    exit 1
fi
