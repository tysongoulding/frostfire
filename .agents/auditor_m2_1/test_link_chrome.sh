#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(pwd)/cloud/microvm/scripts/link-chrome-session.sh"
TEMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

MASTER_DIR="${TEMP_DIR}/master"
DISPLAY_DIR="${TEMP_DIR}/display-2"

mkdir -p "${MASTER_DIR}" "${DISPLAY_DIR}"

export CHROME_SESSION_DIR="${MASTER_DIR}"

# 1. Circular path test: running against master dir should be a no-op and not delete anything
echo "master-cookies" > "${MASTER_DIR}/Cookies"
bash "${SCRIPT_PATH}" "${MASTER_DIR}"
if [ ! -f "${MASTER_DIR}/Cookies" ]; then
  echo "FAIL: Master Cookies was deleted on self-target run!"
  exit 1
fi

# 2. Linking test: linking to display-2
echo "master-login" > "${MASTER_DIR}/Login Data"
# Create stale lock files
mkdir -p "${DISPLAY_DIR}/Default"
touch "${DISPLAY_DIR}/Default/Cookies-journal" "${DISPLAY_DIR}/Default/Cookies-wal"

bash "${SCRIPT_PATH}" "${DISPLAY_DIR}"

# Verify symlinks
if [ ! -L "${DISPLAY_DIR}/Default/Cookies" ]; then
  echo "FAIL: Cookies is not a symlink"
  exit 1
fi
if [ ! -L "${DISPLAY_DIR}/Default/Login Data" ]; then
  echo "FAIL: Login Data is not a symlink"
  exit 1
fi

# Verify lock files deleted
if [ -f "${DISPLAY_DIR}/Default/Cookies-journal" ] || [ -f "${DISPLAY_DIR}/Default/Cookies-wal" ]; then
  echo "FAIL: Stale SQLite locks were not cleaned up"
  exit 1
fi

echo "ALL CHROME LINKING AUDIT TESTS PASSED"
