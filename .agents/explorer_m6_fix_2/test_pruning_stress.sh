#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC_SCRIPT="${SCRIPT_DIR}/proposed_sync-workspace-state.sh"

TEST_SANDBOX="/tmp/ff_adversarial_prune_stress_$$"
export FROSTFIRE_PERSIST_ROOT="${TEST_SANDBOX}/persist"
mkdir -p "${TEST_SANDBOX}" "${FROSTFIRE_PERSIST_ROOT}"

cleanup() {
    rm -rf "${TEST_SANDBOX}"
}
trap cleanup EXIT

echo "=== Stress Testing Pruning Mechanics ==="

WS_DIR="${TEST_SANDBOX}/stress_ws"
mkdir -p "${WS_DIR}"
cd "${WS_DIR}"
git init -q -b main
git config user.email "test@frostfire.dev"
git config user.name "Tester"

# 1. Complex filenames
mkdir -p 'nested dir/with spaces'
echo "to delete with spaces" > 'nested dir/with spaces/del with spaces #$@%.txt'
echo "to rename with spaces" > 'nested dir/with spaces/ren with spaces #$@%.txt'
echo "staged del with spaces" > 'staged del #1.txt'
echo "staged ren with spaces" > 'staged ren #1.txt'

git add .
git commit -m "init" -q

# Perform unstaged deletion & rename
rm 'nested dir/with spaces/del with spaces #$@%.txt'
mv 'nested dir/with spaces/ren with spaces #$@%.txt' 'nested dir/with spaces/new ren.txt'

# Perform staged deletion & rename
git rm -q 'staged del #1.txt'
git mv 'staged ren #1.txt' 'staged ren new #1.txt'

# Snapshot
"${SYNC_SCRIPT}" snapshot stress_agent "${WS_DIR}" >/dev/null

# Restore into isolated clone
RESTORE_DIR="${TEST_SANDBOX}/stress_ws_restored"
git clone --no-local "${WS_DIR}" "${RESTORE_DIR}" -q
git -C "${RESTORE_DIR}" fetch "${WS_DIR}" "refs/frostfire/shadow/*:refs/frostfire/shadow/*" -q
tar -C "${WS_DIR}/.git/objects" -c . | (cd "${RESTORE_DIR}/.git/objects" && tar -x --skip-old-files 2>/dev/null || true)

"${SYNC_SCRIPT}" restore stress_agent "${RESTORE_DIR}" >/dev/null

# Verifications
echo "Checking results..."
# 1. Unstaged deleted file must not exist on disk
if [ -e "${RESTORE_DIR}/nested dir/with spaces/del with spaces #$@%.txt" ]; then
    echo "[FAIL] Unstaged deleted file with spaces was resurrected!"
    exit 1
fi

# 2. Unstaged renamed original file must not exist on disk
if [ -e "${RESTORE_DIR}/nested dir/with spaces/ren with spaces #$@%.txt" ]; then
    echo "[FAIL] Unstaged renamed original file with spaces was not pruned!"
    exit 1
fi

# 3. Unstaged renamed target file must exist (via untracked tarball)
if [ ! -f "${RESTORE_DIR}/nested dir/with spaces/new ren.txt" ]; then
    echo "[FAIL] Unstaged renamed target file was not restored!"
    exit 1
fi

# 4. Staged deleted file must not exist on disk
if [ -e "${RESTORE_DIR}/staged del #1.txt" ]; then
    echo "[FAIL] Staged deleted file with spaces was resurrected!"
    exit 1
fi

# 5. Staged renamed original file must not exist on disk
if [ -e "${RESTORE_DIR}/staged ren #1.txt" ]; then
    echo "[FAIL] Staged renamed original file with spaces was not pruned!"
    exit 1
fi

# 6. Staged renamed target file must exist
if [ ! -f "${RESTORE_DIR}/staged ren new #1.txt" ]; then
    echo "[FAIL] Staged renamed target file was not restored!"
    exit 1
fi

echo "ALL COMPLEX PRUNING STRESS TESTS PASSED PERFECTLY!"
