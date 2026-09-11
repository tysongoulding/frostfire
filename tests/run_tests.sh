#!/usr/bin/env bash
set -euo pipefail

# Frostfire Cloud E2E Test Suite Shell Runner
# Discovers Python 3 and executes tests/run_all_tests.py

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PYTHON_BIN=""
if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
else
    echo "[-] ERROR: Python 3 is required to execute the test suite but was not found on PATH." >&2
    exit 1
fi

cd "${WORKSPACE_ROOT}"
exec "${PYTHON_BIN}" "${SCRIPT_DIR}/run_all_tests.py" "$@"
