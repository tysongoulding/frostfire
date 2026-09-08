#!/usr/bin/env bash
# Empirical adversarial test harness for link-chrome-session.sh
set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "$0")/../../cloud/microvm/scripts" && pwd)/link-chrome-session.sh"

echo "=== Testing link-chrome-session.sh Edge Cases & Hardening ==="
echo "Target script: ${SCRIPT_PATH}"

TEST_BASE=$(mktemp -d /tmp/chrome_test_XXXXXX)
trap "rm -rf \"${TEST_BASE}\"" EXIT

# ---------------------------------------------------------------------------
# Test 1: Empty argument handling
# ---------------------------------------------------------------------------
echo "[Test 1] Testing empty argument invocation..."
set +e
bash "${SCRIPT_PATH}" ""
RET=$?
set -e
if [ "${RET}" -ne 0 ]; then
  echo "FAIL: Empty argument returned non-zero: ${RET}"
  exit 1
fi
echo "  -> Passed: Empty argument safely exits 0"

# ---------------------------------------------------------------------------
# Test 2: Standard linking and database content parity
# ---------------------------------------------------------------------------
echo "[Test 2] Testing standard profile linking..."
MASTER_DIR="${TEST_BASE}/master/Default"
mkdir -p "${MASTER_DIR}"
echo "master-cookies-payload-xyz" > "${MASTER_DIR}/Cookies"
echo "master-login-payload-xyz" > "${MASTER_DIR}/Login Data"
echo "master-account-payload-xyz" > "${MASTER_DIR}/Login Data For Account"

SEC_PROFILE="${TEST_BASE}/profile-display-2"
export CHROME_SESSION_DIR="${MASTER_DIR}"

bash "${SCRIPT_PATH}" "${SEC_PROFILE}"

for f in Cookies "Login Data" "Login Data For Account"; do
  LINK="${SEC_PROFILE}/Default/${f}"
  if [ ! -L "${LINK}" ]; then
    echo "FAIL: Expected symlink at ${LINK}"
    exit 1
  fi
  TARGET=$(readlink "${LINK}")
  if [ "${TARGET}" != "${MASTER_DIR}/${f}" ]; then
    echo "FAIL: Symlink target mismatch: ${TARGET} != ${MASTER_DIR}/${f}"
    exit 1
  fi
  CONTENT=$(cat "${LINK}")
  EXPECTED=$(cat "${MASTER_DIR}/${f}")
  if [ "${CONTENT}" != "${EXPECTED}" ]; then
    echo "FAIL: Content mismatch through symlink for ${f}"
    exit 1
  fi
done
echo "  -> Passed: Standard linking succeeded with bitwise parity"

# ---------------------------------------------------------------------------
# Test 3: Circular destination (Exact SESSION_DIR)
# ---------------------------------------------------------------------------
echo "[Test 3] Testing circular destination when PROFILE_DIR is SESSION_DIR..."
# Calling with SESSION_DIR itself must NOT delete Cookies or Login Data!
bash "${SCRIPT_PATH}" "${MASTER_DIR}"
if [ ! -f "${MASTER_DIR}/Cookies" ] || [ -L "${MASTER_DIR}/Cookies" ]; then
  echo "FAIL: Circular invocation corrupted or replaced master Cookies with symlink!"
  exit 1
fi
if [ "$(cat "${MASTER_DIR}/Cookies")" != "master-cookies-payload-xyz" ]; then
  echo "FAIL: Master Cookies content was altered!"
  exit 1
fi
echo "  -> Passed: Circular invocation safely aborted without data loss"

# ---------------------------------------------------------------------------
# Test 4: Circular destination (Parent of SESSION_DIR)
# ---------------------------------------------------------------------------
echo "[Test 4] Testing circular destination when PROFILE_DIR is parent of Default..."
MASTER_PARENT="${TEST_BASE}/master"
bash "${SCRIPT_PATH}" "${MASTER_PARENT}"
if [ "$(cat "${MASTER_DIR}/Cookies")" != "master-cookies-payload-xyz" ]; then
  echo "FAIL: Invocation with master parent altered master Cookies!"
  exit 1
fi
echo "  -> Passed: Master parent invocation safely handled"

# ---------------------------------------------------------------------------
# Test 5: Circular destination with symlinked / relative paths
# ---------------------------------------------------------------------------
echo "[Test 5] Testing circular destination with relative / dot-dot path..."
bash "${SCRIPT_PATH}" "${TEST_BASE}/master/../master/Default"
if [ "$(cat "${MASTER_DIR}/Cookies")" != "master-cookies-payload-xyz" ]; then
  echo "FAIL: Relative path circular invocation altered master Cookies!"
  exit 1
fi
echo "  -> Passed: Canonical path detection resolved relative paths"

# ---------------------------------------------------------------------------
# Test 6: Stale SQLite lock files cleanup (-wal, -shm, -journal)
# ---------------------------------------------------------------------------
echo "[Test 6] Testing stale SQLite lock cleanup in target display directory..."
SEC_PROFILE_3="${TEST_BASE}/profile-display-3"
mkdir -p "${SEC_PROFILE_3}/Default"
# Inject poisoned stale lock files
touch "${SEC_PROFILE_3}/Default/Cookies-wal"
touch "${SEC_PROFILE_3}/Default/Cookies-shm"
touch "${SEC_PROFILE_3}/Default/Cookies-journal"
touch "${SEC_PROFILE_3}/Default/Login Data-wal"
touch "${SEC_PROFILE_3}/Default/Login Data-shm"
touch "${SEC_PROFILE_3}/Default/Login Data-journal"
touch "${SEC_PROFILE_3}/Default/Login Data For Account-wal"
touch "${SEC_PROFILE_3}/Default/Login Data For Account-shm"
touch "${SEC_PROFILE_3}/Default/Login Data For Account-journal"

bash "${SCRIPT_PATH}" "${SEC_PROFILE_3}"

for f in Cookies "Login Data" "Login Data For Account"; do
  for ext in -wal -shm -journal; do
    POISON_FILE="${SEC_PROFILE_3}/Default/${f}${ext}"
    if [ -e "${POISON_FILE}" ]; then
      echo "FAIL: Stale lock file was not removed: ${POISON_FILE}"
      exit 1
    fi
  done
done
echo "  -> Passed: All 9 stale SQLite lock files were pruned"

# ---------------------------------------------------------------------------
# Test 7: Missing source files in master directory
# ---------------------------------------------------------------------------
echo "[Test 7] Testing missing source files in CHROME_SESSION_DIR..."
FRESH_MASTER="${TEST_BASE}/fresh_master/Default"
mkdir -p "${FRESH_MASTER}"
# Note: FRESH_MASTER has no Cookies, Login Data, or Login Data For Account
export CHROME_SESSION_DIR="${FRESH_MASTER}"

FRESH_PROFILE="${TEST_BASE}/profile-display-4"
bash "${SCRIPT_PATH}" "${FRESH_PROFILE}"

for f in Cookies "Login Data" "Login Data For Account"; do
  if [ ! -f "${FRESH_MASTER}/${f}" ]; then
    echo "FAIL: Master database file was not initialized: ${FRESH_MASTER}/${f}"
    exit 1
  fi
  LINK="${FRESH_PROFILE}/Default/${f}"
  if [ ! -L "${LINK}" ]; then
    echo "FAIL: Symlink was not created when master file was newly initialized"
    exit 1
  fi
  TARGET=$(readlink "${LINK}")
  if [ "${TARGET}" != "${FRESH_MASTER}/${f}" ]; then
    echo "FAIL: Symlink target mismatch: ${TARGET} != ${FRESH_MASTER}/${f}"
    exit 1
  fi
done
echo "  -> Passed: Missing source files were created with secure permissions"

# ---------------------------------------------------------------------------
# Test 8: Pre-existing regular files in destination (replacement test)
# ---------------------------------------------------------------------------
echo "[Test 8] Testing pre-existing conflicting regular files in destination..."
CONFLICT_PROFILE="${TEST_BASE}/profile-display-5"
mkdir -p "${CONFLICT_PROFILE}/Default"
echo "stale_local_cookie" > "${CONFLICT_PROFILE}/Default/Cookies"
echo "stale_local_login" > "${CONFLICT_PROFILE}/Default/Login Data"

bash "${SCRIPT_PATH}" "${CONFLICT_PROFILE}"

for f in Cookies "Login Data"; do
  LINK="${CONFLICT_PROFILE}/Default/${f}"
  if [ ! -L "${LINK}" ]; then
    echo "FAIL: Existing regular file was not replaced with symlink at ${LINK}"
    exit 1
  fi
  if [ "$(cat "${LINK}")" != "" ]; then
    # Fresh master was empty
    echo "FAIL: Symlink did not point to fresh master"
    exit 1
  fi
done
echo "  -> Passed: Conflicting local files safely replaced with master symlinks"

# ---------------------------------------------------------------------------
# Test 9: Idempotency check
# ---------------------------------------------------------------------------
echo "[Test 9] Testing idempotency across repeated executions..."
bash "${SCRIPT_PATH}" "${CONFLICT_PROFILE}"
bash "${SCRIPT_PATH}" "${CONFLICT_PROFILE}"
for f in Cookies "Login Data" "Login Data For Account"; do
  LINK="${CONFLICT_PROFILE}/Default/${f}"
  if [ ! -L "${LINK}" ]; then
    echo "FAIL: Symlink corrupted during repeated runs"
    exit 1
  fi
done
echo "  -> Passed: Repeated runs are completely idempotent"

echo "=== ALL link-chrome-session.sh EDGE CASE TESTS PASSED! ==="