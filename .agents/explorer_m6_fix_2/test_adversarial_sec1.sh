#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SYNC_SCRIPT="${SCRIPT_DIR}/proposed_sync-workspace-state.sh"

TEST_SANDBOX="/tmp/ff_adversarial_test_sec1_$$"
export FROSTFIRE_PERSIST_ROOT="${TEST_SANDBOX}/persist"
mkdir -p "${TEST_SANDBOX}" "${FROSTFIRE_PERSIST_ROOT}"

cleanup() {
    rm -rf "${TEST_SANDBOX}"
}
trap cleanup EXIT

echo "--- SECTION 1: Testing Dirty Git State Extremes with Proposed Fix ---"

WS_DIR="${TEST_SANDBOX}/dirty_ws"
mkdir -p "${WS_DIR}"
cd "${WS_DIR}"
git init -q -b main
git config user.email "challenger@frostfire.dev"
git config user.name "Challenger"

# Base tracked files
echo "base file 1 content" > base1.txt
echo "base file 2 content" > base2.txt
echo "file to delete content" > to_delete.txt
echo "file to rename content" > to_rename.txt
mkdir -p base_dir
echo "inside base dir" > base_dir/sub.txt
git add .
git commit -m "Initial commit" -q

# 1.1 Staged & Unstaged modifications
echo "staged modification in base1" >> base1.txt
git add base1.txt
echo "unstaged modification in base2" >> base2.txt

# 1.2 Empty files (staged and untracked)
touch empty_staged.txt
git add empty_staged.txt
touch empty_untracked.txt

# 1.3 Untracked deep nesting
mkdir -p nested/level1/level2/level3/level4
echo "deeply nested payload" > nested/level1/level2/level3/level4/target.txt

# 1.4 Binary files
dd if=/dev/urandom of=binary_blob.bin bs=1024 count=32 2>/dev/null
dd if=/dev/urandom of=nested/level1/binary_nested.bin bs=1024 count=16 2>/dev/null

# 1.5 Spaces, quotes, and special characters
echo "spaces and symbols content" > 'file with spaces and symbols #$@%.txt'
mkdir -p 'dir with spaces and @signs'
echo "subfile" > 'dir with spaces and @signs/nested spaces.txt'

# 1.6 Symlinks
ln -s base1.txt symlink_file
ln -s base_dir symlink_dir
ln -s 'file with spaces and symbols #$@%.txt' 'symlink with spaces'

# Record pre-snapshot checksums
find . -not -path '*/.*' -not -name 'symlink*' -type f -exec sha256sum {} + | sort > "${TEST_SANDBOX}/pre_dirty_checksums.sha256"

# Execute snapshot
"${SYNC_SCRIPT}" snapshot dirty_agent "${WS_DIR}" >/dev/null

# 1.7 Restore into isolated clone
RESTORE_DIR="${TEST_SANDBOX}/dirty_ws_restored"
mkdir -p "${RESTORE_DIR}"
cd "${RESTORE_DIR}"
git init -q -b main
git config user.email "challenger@frostfire.dev"
git config user.name "Challenger"
git fetch "${WS_DIR}" "refs/frostfire/shadow/*:refs/frostfire/shadow/*" -q

tar -C "${WS_DIR}/.git/objects" -c . | (cd "${RESTORE_DIR}/.git/objects" && tar -x --skip-old-files 2>/dev/null || true)

"${SYNC_SCRIPT}" restore dirty_agent "${RESTORE_DIR}" >/dev/null

# Verify checksums across dirty extremes
find . -not -path '*/.*' -not -name 'symlink*' -type f -exec sha256sum {} + | sort > "${TEST_SANDBOX}/post_dirty_checksums.sha256"
if diff -u "${TEST_SANDBOX}/pre_dirty_checksums.sha256" "${TEST_SANDBOX}/post_dirty_checksums.sha256" >/dev/null; then
    echo "[PASS] Dirty extremes bit-for-bit preserved"
else
    echo "[FAIL] Dirty extremes checksum mismatch"
    diff -u "${TEST_SANDBOX}/pre_dirty_checksums.sha256" "${TEST_SANDBOX}/post_dirty_checksums.sha256"
    exit 1
fi

# 1.8 Verify symlinks preserved
if [ -L symlink_file ] && [ -L symlink_dir ] && [ -L 'symlink with spaces' ]; then
    echo "[PASS] Symlinks faithfully recreated"
else
    echo "[FAIL] Symlinks not properly recreated"
    exit 1
fi

# 1.9 Deleted Files
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
    echo "[FAIL] Deleted file resurrected"
    exit 1
else
    echo "[PASS] Deleted file properly unlinked"
fi

# 1.10 Renamed Files
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
    echo "[FAIL] Renamed file left zombie original"
    exit 1
else
    echo "[PASS] Renamed file cleanly swapped"
fi

echo "ALL SECTION 1 TESTS PASSED WITH PROPOSED FIX!"
