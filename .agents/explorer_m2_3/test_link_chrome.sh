#!/usr/bin/env bash
set -euo pipefail

TEST_DIR=$(mktemp -d)
trap 'rm -rf "${TEST_DIR}"' EXIT

MASTER_DIR="${TEST_DIR}/chrome-profile/Default"
mkdir -p "${MASTER_DIR}"
echo "master_cookie_db" > "${MASTER_DIR}/Cookies"
echo "master_login_db" > "${MASTER_DIR}/Login Data"
echo "master_account_db" > "${MASTER_DIR}/Login Data For Account"

SECONDARY_PROFILE="${TEST_DIR}/chrome-profile-2"
SECONDARY_DEFAULT="${SECONDARY_PROFILE}/Default"
mkdir -p "${SECONDARY_DEFAULT}"

# Stale WAL/journal files in secondary
touch "${SECONDARY_DEFAULT}/Cookies-wal"
touch "${SECONDARY_DEFAULT}/Cookies-shm"

CHROME_SESSION_DIR="${MASTER_DIR}"
export CHROME_SESSION_DIR

# Run linking logic
bash -c '
PROFILE_DIR="'"${SECONDARY_PROFILE}"'"
SESSION_DIR="${CHROME_SESSION_DIR}"

if [[ "${PROFILE_DIR}" == */Default ]]; then
  DEFAULT_DIR="${PROFILE_DIR}"
  PROFILE_DIR="${PROFILE_DIR%/Default}"
else
  DEFAULT_DIR="${PROFILE_DIR}/Default"
fi

ensure_secure_dir() {
  local dir="$1"
  mkdir -p "${dir}" 2>/dev/null || true
  chmod 700 "${dir}" 2>/dev/null || true
  if [ "$(id -u)" -eq 0 ] && id "box" >/dev/null 2>&1; then
    chown box:box "${dir}" 2>/dev/null || true
  fi
}

ensure_secure_dir "${SESSION_DIR}"

CANONICAL_TARGET="$(readlink -f "${SESSION_DIR}" 2>/dev/null || echo "${SESSION_DIR}")"
CANONICAL_DEST="$(readlink -f "${DEFAULT_DIR}" 2>/dev/null || echo "${DEFAULT_DIR}")"
if [ "${CANONICAL_TARGET}" = "${CANONICAL_DEST}" ]; then
  exit 0
fi

if [ -L "${DEFAULT_DIR}" ]; then
  rm -f "${DEFAULT_DIR}" 2>/dev/null || true
fi
ensure_secure_dir "${DEFAULT_DIR}"

SESSION_FILES=(Cookies "Login Data" "Login Data For Account")
for name in "${SESSION_FILES[@]}"; do
  target="${SESSION_DIR}/${name}"
  link="${DEFAULT_DIR}/${name}"

  rm -f "${link}-journal" "${link}-wal" "${link}-shm" 2>/dev/null || true

  if [ ! -e "${target}" ] && [ ! -L "${target}" ]; then
    touch "${target}" 2>/dev/null || true
    chmod 600 "${target}" 2>/dev/null || true
  fi

  if [ -L "${link}" ] && [ "$(readlink "${link}" 2>/dev/null)" = "${target}" ]; then
    continue
  fi

  rm -f "${link}" 2>/dev/null || true
  ln -s "${target}" "${link}" 2>/dev/null || true
done
'

# Verification 1: Check symlinks
for name in Cookies "Login Data" "Login Data For Account"; do
  if [ ! -L "${SECONDARY_DEFAULT}/${name}" ]; then
    echo "FAIL: Expected ${name} to be symlink"
    exit 1
  fi
  TARGET_PATH=$(readlink "${SECONDARY_DEFAULT}/${name}")
  if [ "${TARGET_PATH}" != "${MASTER_DIR}/${name}" ]; then
    echo "FAIL: Target path mismatch for ${name}: got ${TARGET_PATH}"
    exit 1
  fi
done

# Verification 2: Stale wal/shm removed
if [ -e "${SECONDARY_DEFAULT}/Cookies-wal" ] || [ -e "${SECONDARY_DEFAULT}/Cookies-shm" ]; then
  echo "FAIL: Stale WAL/SHM was not removed"
  exit 1
fi

# Verification 3: Content matches master
if [ "$(cat "${SECONDARY_DEFAULT}/Cookies")" != "master_cookie_db" ]; then
  echo "FAIL: Content mismatch"
  exit 1
fi

# Verification 4: Circular symlink test (running with MASTER_DIR as target)
bash -c '
PROFILE_DIR="'"${TEST_DIR}/chrome-profile"'"
SESSION_DIR="${CHROME_SESSION_DIR}"

if [[ "${PROFILE_DIR}" == */Default ]]; then
  DEFAULT_DIR="${PROFILE_DIR}"
  PROFILE_DIR="${PROFILE_DIR%/Default}"
else
  DEFAULT_DIR="${PROFILE_DIR}/Default"
fi

CANONICAL_TARGET="$(readlink -f "${SESSION_DIR}" 2>/dev/null || echo "${SESSION_DIR}")"
CANONICAL_DEST="$(readlink -f "${DEFAULT_DIR}" 2>/dev/null || echo "${DEFAULT_DIR}")"
if [ "${CANONICAL_TARGET}" = "${CANONICAL_DEST}" ]; then
  exit 0
fi

# Should NOT reach here
exit 1
'

if [ "$(cat "${MASTER_DIR}/Cookies")" != "master_cookie_db" ]; then
  echo "FAIL: Master database was modified or corrupted by circular invocation!"
  exit 1
fi

echo "ALL CHROME LINKING TESTS PASSED!"
