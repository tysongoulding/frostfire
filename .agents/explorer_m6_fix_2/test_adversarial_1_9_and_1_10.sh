#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SYNC_SCRIPT="${SCRIPT_DIR}/proposed_sync-workspace-state.sh"

TEST_SANDBOX="/tmp/ff_test_fix2_$$"
export FROSTFIRE_PERSIST_ROOT="${TEST_SANDBOX}/persist"
mkdir -p "${TEST_SANDBOX}" "${FROSTFIRE_PERSIST_ROOT}"

cleanup() {
    rm -rf "${TEST_SANDBOX}"
}
trap cleanup EXIT

echo "=== Testing Current sync-workspace-state.sh ==="

# 1.9 Test: Deleted Files handling
echo "Running Test 1.9 (Deleted Files)..."
DEL_TEST_DIR="${TEST_SANDBOX}/del_ws"
mkdir -p "${DEL_TEST_DIR}"
cd "${DEL_TEST_DIR}"
git init -q -b main
git config user.email "challenger@frostfire.dev"
git config user.name "Challenger"
echo "delete me" > del_target.txt
git add del_target.txt
git commit -m "add del_target" -q

rm del_target.txt
"${SYNC_SCRIPT}" snapshot del_agent "${DEL_TEST_DIR}" >/dev/null

DEL_RESTORE="${TEST_SANDBOX}/del_ws_restored"
git clone "${DEL_TEST_DIR}" "${DEL_RESTORE}" -q
git -C "${DEL_RESTORE}" fetch "${DEL_TEST_DIR}" "refs/frostfire/shadow/*:refs/frostfire/shadow/*" -q
"${SYNC_SCRIPT}" restore del_agent "${DEL_RESTORE}" >/dev/null

if [ -f "${DEL_RESTORE}/del_target.txt" ]; then
    echo "CURRENT RESULT: Defect 3 reproduced: del_target.txt resurrected!"
else
    echo "CURRENT RESULT: del_target.txt properly unlinked!"
fi

# 1.10 Test: Renamed Files handling
echo "Running Test 1.10 (Renamed Files)..."
REN_TEST_DIR="${TEST_SANDBOX}/ren_ws"
mkdir -p "${REN_TEST_DIR}"
cd "${REN_TEST_DIR}"
git init -q -b main
git config user.email "challenger@frostfire.dev"
git config user.name "Challenger"
echo "original content" > orig.txt
git add orig.txt
git commit -m "add orig" -q

git mv orig.txt renamed.txt
"${SYNC_SCRIPT}" snapshot ren_agent "${REN_TEST_DIR}" >/dev/null

REN_RESTORE="${TEST_SANDBOX}/ren_ws_restored"
git clone --no-local "${REN_TEST_DIR}" "${REN_RESTORE}" -q
git -C "${REN_RESTORE}" fetch "${REN_TEST_DIR}" "refs/frostfire/shadow/*:refs/frostfire/shadow/*" -q
tar -C "${REN_TEST_DIR}/.git/objects" -c . | (cd "${REN_RESTORE}/.git/objects" && tar -x --skip-old-files 2>/dev/null || true)
"${SYNC_SCRIPT}" restore ren_agent "${REN_RESTORE}" >/dev/null

if [ -f "${REN_RESTORE}/orig.txt" ] && [ -f "${REN_RESTORE}/renamed.txt" ]; then
    echo "CURRENT RESULT: Defect 4 reproduced: orig.txt zombie alongside renamed.txt!"
else
    echo "CURRENT RESULT: Renamed file cleanly swapped!"
fi
