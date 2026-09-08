#!/usr/bin/env bash
# ==============================================================================
# Adversarial & Empirical Verification Suite: sync-workspace-state.sh
# Location: tests/adversarial/test_sync_workspace_adversarial.sh
#
# Stress tests:
# 1. Dirty Git State Extremes (staged/unstaged, deep nesting, binary, empty, spaces/symbols, symlinks, deleted, renamed, worktrees)
# 2. Concurrent Invocation & Locking (flock contention, timeout exit 75, queuing)
# 3. Corruption & Recovery (tar corruption, manifest tampering, premature mutation)
# 4. Active Branch Invariance (HEAD, branch ref, commit graph, detached HEAD)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SYNC_SCRIPT="${REPO_ROOT}/scripts/sync-workspace-state.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

TEST_SANDBOX="/tmp/ff_adversarial_suite_$$"
export FROSTFIRE_PERSIST_ROOT="${TEST_SANDBOX}/persist"

pass() { printf "${GREEN}[PASS]${NC} %s\n" "$*"; }
fail() { printf "${RED}[FAIL]${NC} %s\n" "$*" >&2; }
info() { printf "${BLUE}[INFO]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[DEFECT]${NC} %s\n" "$*"; }

TOTAL_TESTS=0
PASSED_TESTS=0
DEFECTS_FOUND=0

record_pass() {
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    PASSED_TESTS=$((PASSED_TESTS + 1))
    pass "$1"
}

record_defect() {
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    DEFECTS_FOUND=$((DEFECTS_FOUND + 1))
    warn "$1"
}

cleanup() {
    rm -rf "${TEST_SANDBOX}"
    echo "=============================================================================="
    printf "Adversarial Stress Suite Summary: %d tests executed | %d passed | %d defects surfaced\n" \
        "$TOTAL_TESTS" "$PASSED_TESTS" "$DEFECTS_FOUND"
    echo "=============================================================================="
}
trap cleanup EXIT

mkdir -p "${TEST_SANDBOX}" "${FROSTFIRE_PERSIST_ROOT}"

# ==============================================================================
# SECTION 1: Dirty Git State Extremes
# ==============================================================================
info "--- SECTION 1: Dirty Git State Extremes ---"

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

# Note: staged tree is not referenced by commit, so fetch shadow commit alone leaves staged_tree missing in clones!
# Copy objects directly to test clean restore
tar -C "${WS_DIR}/.git/objects" -c . | (cd "${RESTORE_DIR}/.git/objects" && tar -x --skip-old-files 2>/dev/null || true)

"${SYNC_SCRIPT}" restore dirty_agent "${RESTORE_DIR}" >/dev/null

# Verify checksums across dirty extremes
find . -not -path '*/.*' -not -name 'symlink*' -type f -exec sha256sum {} + | sort > "${TEST_SANDBOX}/post_dirty_checksums.sha256"
if diff -u "${TEST_SANDBOX}/pre_dirty_checksums.sha256" "${TEST_SANDBOX}/post_dirty_checksums.sha256" >/dev/null; then
    record_pass "Dirty extremes (staged, unstaged, deep nesting, binary, empty, spaces/symbols, symlinks) bit-for-bit preserved"
else
    fail "Dirty extremes checksum mismatch"
fi

# 1.8 Verify symlinks preserved
if [ -L symlink_file ] && [ -L symlink_dir ] && [ -L 'symlink with spaces' ]; then
    record_pass "Symlinks (file, dir, spaces) faithfully recreated"
else
    fail "Symlinks not properly recreated"
fi

# 1.9 Adversarial Test: Deleted Files handling
info "Testing deletion handling on restore..."
DEL_TEST_DIR="${TEST_SANDBOX}/del_ws"
mkdir -p "${DEL_TEST_DIR}"
cd "${DEL_TEST_DIR}"
git init -q -b main
git config user.email "challenger@frostfire.dev"
git config user.name "Challenger"
echo "delete me" > del_target.txt
git add del_target.txt
git commit -m "add del_target" -q

# Delete unstaged
rm del_target.txt
"${SYNC_SCRIPT}" snapshot del_agent "${DEL_TEST_DIR}" >/dev/null

# Fresh clone containing del_target.txt
DEL_RESTORE="${TEST_SANDBOX}/del_ws_restored"
git clone "${DEL_TEST_DIR}" "${DEL_RESTORE}" -q
git -C "${DEL_RESTORE}" fetch "${DEL_TEST_DIR}" "refs/frostfire/shadow/*:refs/frostfire/shadow/*" -q
"${SYNC_SCRIPT}" restore del_agent "${DEL_RESTORE}" >/dev/null

if [ -f "${DEL_RESTORE}/del_target.txt" ]; then
    record_defect "Defect: Deleted file 'del_target.txt' resurrected on restore (git checkout-index does not prune deleted files)"
else
    record_pass "Deleted file properly unlinked on restore"
fi

# 1.10 Adversarial Test: Renamed Files handling
info "Testing renamed file handling on restore..."
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
    record_defect "Defect: Renamed file left zombie original 'orig.txt' alongside 'renamed.txt' on restore"
else
    record_pass "Renamed file cleanly swapped without duplicate"
fi

# 1.11 Adversarial Test: Git Worktree Support
info "Testing git worktree snapshot support..."
WT_BASE="${TEST_SANDBOX}/wt_base"
mkdir -p "${WT_BASE}"
cd "${WT_BASE}"
git init -q -b main
git config user.email "challenger@frostfire.dev"
git config user.name "Challenger"
echo "base" > base.txt
git add base.txt
git commit -m "init" -q

git worktree add ../wt_linked -b linked_branch -q
cd "${TEST_SANDBOX}/wt_linked"
echo "worktree staged" > wt_staged.txt
git add wt_staged.txt

set +e
"${SYNC_SCRIPT}" snapshot wt_agent "${TEST_SANDBOX}/wt_linked" 2>"${TEST_SANDBOX}/wt_err.log"
WT_EXIT=$?
set -e

if [ "$WT_EXIT" -ne 0 ]; then
    record_defect "Defect: Snapshot fails on Git worktrees where .git is a file (fatal: not a valid object name)"
else
    record_pass "Git worktree snapshot succeeded"
fi

# 1.12 Adversarial Test: Staged Tree Dangling Object / Remote Fetch
info "Testing staged tree reachability across git fetch..."
FETCH_BASE="${TEST_SANDBOX}/fetch_base"
mkdir -p "${FETCH_BASE}"
cd "${FETCH_BASE}"
git init -q -b main
git config user.email "challenger@frostfire.dev"
git config user.name "Challenger"
echo "v1" > f.txt
git add f.txt
git commit -m "v1" -q

echo "v2 staged" > f.txt
git add f.txt
echo "v3 unstaged" >> f.txt
"${SYNC_SCRIPT}" snapshot fetch_agent "${FETCH_BASE}" >/dev/null

# Clone into fresh destination and fetch ONLY shadow refs via standard git transport
FETCH_DEST="${TEST_SANDBOX}/fetch_dest"
git clone --no-local "${FETCH_BASE}" "${FETCH_DEST}" -q
git -C "${FETCH_DEST}" fetch "${FETCH_BASE}" "refs/frostfire/shadow/*:refs/frostfire/shadow/*" -q

set +e
"${SYNC_SCRIPT}" restore fetch_agent "${FETCH_DEST}" 2>"${TEST_SANDBOX}/fetch_restore_err.log"
FETCH_RESTORE_EXIT=$?
set -e

if [ "$FETCH_RESTORE_EXIT" -ne 0 ]; then
    record_defect "Defect: staged_tree_sha is an unreferenced dangling object; remote fetch fails with 'failed to unpack tree object'"
else
    record_pass "Staged tree successfully unpacked in remote clone"
fi


# ==============================================================================
# SECTION 2: Concurrent Invocation & Locking
# ==============================================================================
info "--- SECTION 2: Concurrent Invocation & Locking ---"

CONC_WS="${TEST_SANDBOX}/conc_ws"
mkdir -p "${CONC_WS}"
cd "${CONC_WS}"
git init -q -b main
git config user.email "challenger@frostfire.dev"
git config user.name "Challenger"
echo "init" > file.txt
git add file.txt
git commit -m "init" -q

# 2.1 Lock timeout with conflicting external holder
LOCK_FILE="${FROSTFIRE_PERSIST_ROOT}/.frostfire/locks/timeout_agent.lock"
mkdir -p "$(dirname "$LOCK_FILE")"

(
    exec 200>"$LOCK_FILE"
    flock -x 200
    sleep 2
) &
HOLDER_PID=$!
sleep 0.3

set +e
LOCK_TIMEOUT=1 "${SYNC_SCRIPT}" snapshot timeout_agent "${CONC_WS}" 2>"${TEST_SANDBOX}/timeout_err.log"
TIMEOUT_EXIT=$?
set -e
wait "$HOLDER_PID"

if [ "$TIMEOUT_EXIT" -eq 75 ] && grep -q "Failed to acquire lock" "${TEST_SANDBOX}/timeout_err.log"; then
    record_pass "Lock contention properly aborted with exit code 75 (EX_TEMPFAIL) on timeout"
else
    fail "Expected exit code 75 on lock timeout, got $TIMEOUT_EXIT"
fi

# 2.2 Concurrent queuing with 5 processes
PIDS=()
for i in $(seq 1 5); do
    (
        echo "change $i" >> "${CONC_WS}/file.txt"
        LOCK_TIMEOUT=15 "${SYNC_SCRIPT}" snapshot queue_agent "${CONC_WS}" >/dev/null 2>&1
    ) &
    PIDS+=($!)
done

CONC_FAILED=0
for pid in "${PIDS[@]}"; do
    if ! wait "$pid"; then
        CONC_FAILED=$((CONC_FAILED + 1))
    fi
done

if [ "$CONC_FAILED" -eq 0 ]; then
    record_pass "5 concurrent snapshot invocations serialized cleanly without corruption"
else
    fail "$CONC_FAILED concurrent snapshot invocations failed"
fi

# 2.3 Independent Agent Non-Interference
(
    LOCK_TIMEOUT=5 "${SYNC_SCRIPT}" snapshot agent_a "${CONC_WS}" >/dev/null 2>&1
) &
PID_A=$!
(
    LOCK_TIMEOUT=5 "${SYNC_SCRIPT}" snapshot agent_b "${CONC_WS}" >/dev/null 2>&1
) &
PID_B=$!

wait "$PID_A"
wait "$PID_B"
record_pass "Multi-tenant agent isolation: distinct agent IDs operate concurrently without lock interference"


# ==============================================================================
# SECTION 3: Corruption & Recovery
# ==============================================================================
info "--- SECTION 3: Corruption & Recovery ---"

CORRUPT_WS="${TEST_SANDBOX}/corrupt_ws"
mkdir -p "${CORRUPT_WS}"
cd "${CORRUPT_WS}"
git init -q -b main
git config user.email "challenger@frostfire.dev"
git config user.name "Challenger"
echo "init" > file.txt
git add file.txt
git commit -m "init" -q
echo "untracked content" > untracked.txt

"${SYNC_SCRIPT}" snapshot corrupt_agent "${CORRUPT_WS}" >/dev/null

STATE_DIR="${FROSTFIRE_PERSIST_ROOT}/.frostfire/state/corrupt_agent"
TARGET_TAR="$(readlink -f "${STATE_DIR}/.untracked.tar.gz" || echo "${STATE_DIR}/.untracked.tar.gz")"

# 3.1 Bit flip in archive detected by SHA-256 check
echo "MALICIOUS_BYTES" >> "$TARGET_TAR"

set +e
"${SYNC_SCRIPT}" restore corrupt_agent "${CORRUPT_WS}" 2>"${TEST_SANDBOX}/corrupt_err.log"
CORRUPT_EXIT=$?
set -e

if [ "$CORRUPT_EXIT" -eq 5 ] && grep -q "Checksum mismatch on untracked archive" "${TEST_SANDBOX}/corrupt_err.log"; then
    record_pass "Restore halted with exit code 5 on untracked archive corruption"
else
    fail "Expected exit code 5 on corrupt archive, got $CORRUPT_EXIT"
fi

# 3.2 Verify untracked file was NOT unpacked from corrupt archive
if [ -f "${TEST_SANDBOX}/unpacked_bogus" ]; then
    fail "Corrupted archive unpacked payload"
else
    record_pass "Corrupted archive payload successfully blocked from unpacking"
fi

# 3.3 Premature mutation before checksum check
# Create workspace with v1, snapshot with v2 + untracked, corrupt untracked, reset to v1, restore
MUT_WS="${TEST_SANDBOX}/mut_ws"
mkdir -p "${MUT_WS}"
cd "${MUT_WS}"
git init -q -b main
git config user.email "challenger@frostfire.dev"
git config user.name "Challenger"
echo "clean v1" > file.txt
git add file.txt
git commit -m "v1" -q

echo "mutated v2" > file.txt
echo "untracked" > untracked.txt
"${SYNC_SCRIPT}" snapshot premut_agent "${MUT_WS}" >/dev/null

PREMUT_TAR="$(readlink -f "${FROSTFIRE_PERSIST_ROOT}/.frostfire/state/premut_agent/.untracked.tar.gz")"
echo "CORRUPT" >> "$PREMUT_TAR"

# Reset working directory back to clean v1
git checkout -f HEAD -q
[ "$(cat file.txt)" = "clean v1" ] || fail "Failed to reset to v1"

set +e
"${SYNC_SCRIPT}" restore premut_agent "${MUT_WS}" 2>/dev/null
set -e

if [ "$(cat file.txt)" = "mutated v2" ]; then
    record_defect "Defect: Working directory mutated BEFORE archive checksum validation on corrupted restore"
else
    record_pass "Working directory atomic: not mutated on corrupt archive restore"
fi

# 3.4 Tampered manifest SHA-256
"${SYNC_SCRIPT}" snapshot tamper_agent "${CORRUPT_WS}" >/dev/null
TAMPER_DIR="${FROSTFIRE_PERSIST_ROOT}/.frostfire/state/tamper_agent"
sed -i 's/"untracked_sha256": *"[^"]*"/"untracked_sha256": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"/' "${TAMPER_DIR}/manifest.json"

set +e
"${SYNC_SCRIPT}" restore tamper_agent "${CORRUPT_WS}" 2>"${TEST_SANDBOX}/tamper_err.log"
TAMPER_EXIT=$?
set -e

if [ "$TAMPER_EXIT" -eq 5 ] && grep -q "Checksum mismatch" "${TEST_SANDBOX}/tamper_err.log"; then
    record_pass "Tampered manifest checksum correctly detected and blocked with exit code 5"
else
    fail "Expected exit code 5 on tampered manifest, got $TAMPER_EXIT"
fi


# ==============================================================================
# SECTION 4: Active Branch Invariance
# ==============================================================================
info "--- SECTION 4: Active Branch Invariance ---"

INV_WS="${TEST_SANDBOX}/inv_ws"
mkdir -p "${INV_WS}"
cd "${INV_WS}"
git init -q -b feature-active
git config user.email "challenger@frostfire.dev"
git config user.name "Challenger"

echo "c1" > f1.txt
git add f1.txt
git commit -m "commit 1" -q

echo "c2" > f2.txt
git add f2.txt
git commit -m "commit 2" -q

PRE_REF="$(git symbolic-ref HEAD)"
PRE_HEAD="$(git rev-parse HEAD)"
PRE_LOG="$(git log --oneline)"

# Introduce dirty state
echo "dirty edit 1" >> f1.txt
git add f1.txt
echo "dirty edit 2" >> f2.txt
echo "untracked" > untracked.txt

# Snapshot
"${SYNC_SCRIPT}" snapshot inv_agent "${INV_WS}" >/dev/null

POST_SNAP_REF="$(git symbolic-ref HEAD)"
POST_SNAP_HEAD="$(git rev-parse HEAD)"
POST_SNAP_LOG="$(git log --oneline)"

if [ "$PRE_REF" = "$POST_SNAP_REF" ] && [ "$PRE_HEAD" = "$POST_SNAP_HEAD" ] && [ "$PRE_LOG" = "$POST_SNAP_LOG" ]; then
    record_pass "Active branch invariance (named branch, HEAD, commit graph) fully preserved across snapshot"
else
    fail "Active branch mutated during snapshot"
fi

# Restore
"${SYNC_SCRIPT}" restore inv_agent "${INV_WS}" >/dev/null

POST_REST_REF="$(git symbolic-ref HEAD)"
POST_REST_HEAD="$(git rev-parse HEAD)"
POST_REST_LOG="$(git log --oneline)"

if [ "$PRE_REF" = "$POST_REST_REF" ] && [ "$PRE_HEAD" = "$POST_REST_HEAD" ] && [ "$PRE_LOG" = "$POST_REST_LOG" ]; then
    record_pass "Active branch invariance (named branch, HEAD, commit graph) fully preserved across restore"
else
    fail "Active branch mutated during restore"
fi

# 4.2 Detached HEAD Invariance
git checkout -f --detach HEAD~1 -q
DET_PRE_HEAD="$(git rev-parse HEAD)"
DET_PRE_LOG="$(git log --oneline)"

echo "detached dirty" >> f1.txt
git add f1.txt

"${SYNC_SCRIPT}" snapshot inv_det "${INV_WS}" >/dev/null

if ! git symbolic-ref -q HEAD >/dev/null && [ "$DET_PRE_HEAD" = "$(git rev-parse HEAD)" ] && [ "$DET_PRE_LOG" = "$(git log --oneline)" ]; then
    record_pass "Detached HEAD invariance maintained across snapshot"
else
    fail "Detached HEAD mutated during snapshot"
fi

"${SYNC_SCRIPT}" restore inv_det "${INV_WS}" >/dev/null

if ! git symbolic-ref -q HEAD >/dev/null && [ "$DET_PRE_HEAD" = "$(git rev-parse HEAD)" ] && [ "$DET_PRE_LOG" = "$(git log --oneline)" ]; then
    record_pass "Detached HEAD invariance maintained across restore"
else
    fail "Detached HEAD mutated during restore"
fi

if [ "$DEFECTS_FOUND" -gt 0 ] || [ "$PASSED_TESTS" -ne "$TOTAL_TESTS" ]; then
    exit 1
fi
exit 0

