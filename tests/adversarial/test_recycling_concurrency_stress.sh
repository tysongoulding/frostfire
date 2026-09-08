#!/usr/bin/env bash
# ==============================================================================
# Challenger M6-R2.2: Adversarial Concurrency, Signal Trapping & Cache Exclusion Suite
# Location: tests/adversarial/test_recycling_concurrency_stress.sh
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

TEST_SANDBOX="/tmp/frostfire_challenger_stress_$$"
PERSIST_ROOT="${TEST_SANDBOX}/efs"
MIRROR_ROOT="${PERSIST_ROOT}/.frostfire/credentials"

SYNC_SCRIPT="${REPO_ROOT}/scripts/sync-workspace-state.sh"
PERSIST_SCRIPT="${REPO_ROOT}/cloud/microvm/bin/persist-cli-auth"

export FROSTFIRE_PERSIST_ROOT="${PERSIST_ROOT}"
export CLI_AUTH_MIRROR="${MIRROR_ROOT}"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

TOTAL_TESTS=0
PASSED_TESTS=0
DEFECTS_FOUND=0

pass() {
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    PASSED_TESTS=$((PASSED_TESTS + 1))
    printf "${GREEN}[PASS]${NC} %s\n" "$*"
}

fail() {
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    DEFECTS_FOUND=$((DEFECTS_FOUND + 1))
    printf "${RED}[FAIL / DEFECT]${NC} %s\n" "$*" >&2
}

info() { printf "${BLUE}[INFO]${NC} %s\n" "$*"; }

cleanup() {
    local code=$?
    rm -rf "${TEST_SANDBOX}"
    if [ "$code" -eq 0 ] && [ "$DEFECTS_FOUND" -eq 0 ]; then
        printf "\n${GREEN}All adversarial challenger tests PASSED (Total: %d, Passed: %d, Defects: %d)${NC}\n" "$TOTAL_TESTS" "$PASSED_TESTS" "$DEFECTS_FOUND"
        exit 0
    else
        printf "\n${RED}Adversarial challenger tests FAILED (Total: %d, Passed: %d, Defects: %d)${NC}\n" "$TOTAL_TESTS" "$PASSED_TESTS" "$DEFECTS_FOUND"
        exit 1
    fi
}
trap cleanup EXIT

mkdir -p "${PERSIST_ROOT}" "${MIRROR_ROOT}"

# ==============================================================================
# SECTION 1: Multi-Agent Concurrency & Isolation
# ==============================================================================
info "--- SECTION 1: Multi-Agent Concurrency & Isolation ---"

# 1.1: 10 Parallel distinct agents snapshotting simultaneously
info "Test 1.1: 10 distinct agents snapshotting concurrently to shared EFS..."
AGENT_PIDS=()
for i in $(seq 1 10); do
    (
        ws="${TEST_SANDBOX}/ws_agent_${i}"
        mkdir -p "$ws"
        git -C "$ws" init -q
        git -C "$ws" config user.name "Agent $i"
        git -C "$ws" config user.email "agent${i}@frostfire.dev"
        printf "agent $i initial\n" > "$ws/file.txt"
        git -C "$ws" add "$ws/file.txt"
        git -C "$ws" commit -m "commit $i" -q
        printf "agent $i staged\n" > "$ws/staged.txt"
        git -C "$ws" add "$ws/staged.txt"
        printf "agent $i untracked\n" > "$ws/untracked.txt"

        "$SYNC_SCRIPT" snapshot "agent_${i}" "$ws" >/dev/null 2>&1
    ) &
    AGENT_PIDS+=($!)
done

ALL_SUCCEEDED=1
for pid in "${AGENT_PIDS[@]}"; do
    if ! wait "$pid"; then
        ALL_SUCCEEDED=0
    fi
done

if [ "$ALL_SUCCEEDED" -eq 1 ]; then
    MANIFESTS_COUNT="$(find "${PERSIST_ROOT}/.frostfire/state" -name "manifest.json" | wc -l)"
    if [ "$MANIFESTS_COUNT" -eq 10 ]; then
        pass "10 distinct agents completed concurrent snapshots with valid manifests"
    else
        fail "Expected 10 manifests from concurrent agents, found: $MANIFESTS_COUNT"
    fi
else
    fail "One or more concurrent agent snapshots failed"
fi

# 1.2: High-contention race on same agent (5 concurrent snapshots)
info "Test 1.2: High-contention race on SAME agent ID (5 simultaneous snapshots)..."
SAME_AGENT_WS="${TEST_SANDBOX}/ws_same_agent"
mkdir -p "$SAME_AGENT_WS"
git -C "$SAME_AGENT_WS" init -q
git -C "$SAME_AGENT_WS" config user.name "Same Agent"
git -C "$SAME_AGENT_WS" config user.email "same@frostfire.dev"
printf "base\n" > "$SAME_AGENT_WS/data.txt"
git -C "$SAME_AGENT_WS" add "$SAME_AGENT_WS/data.txt"
git -C "$SAME_AGENT_WS" commit -m "base" -q

CONTENTION_PIDS=()
for i in $(seq 1 5); do
    (
        printf "edit $i\n" >> "$SAME_AGENT_WS/data.txt"
        "$SYNC_SCRIPT" snapshot "contended_agent" "$SAME_AGENT_WS" >/dev/null 2>&1 || exit $?
    ) &
    CONTENTION_PIDS+=($!)
done

FAILED_CONTENTION=0
for pid in "${CONTENTION_PIDS[@]}"; do
    if ! wait "$pid"; then
        FAILED_CONTENTION=$((FAILED_CONTENTION + 1))
    fi
done

MANIFEST_PATH="${PERSIST_ROOT}/.frostfire/state/contended_agent/manifest.json"
if [ -f "$MANIFEST_PATH" ] && python3 -m json.tool "$MANIFEST_PATH" >/dev/null 2>&1; then
    pass "High-contention serialization on same agent produced valid, uncorrupted manifest.json"
else
    fail "High-contention on same agent corrupted or dropped manifest.json"
fi

# 1.3: Simultaneous snapshot vs restore race on same agent
info "Test 1.3: Simultaneous snapshot vs restore race on same agent..."
RACE_WS_SRC="${TEST_SANDBOX}/race_src"
mkdir -p "$RACE_WS_SRC"
git -C "$RACE_WS_SRC" init -q
git -C "$RACE_WS_SRC" config user.name "Race Agent"
git -C "$RACE_WS_SRC" config user.email "race@frostfire.dev"
printf "v1\n" > "$RACE_WS_SRC/version.txt"
git -C "$RACE_WS_SRC" add .
git -C "$RACE_WS_SRC" commit -m "v1" -q

# Seed snapshot
"$SYNC_SCRIPT" snapshot "race_agent" "$RACE_WS_SRC" >/dev/null 2>&1

# Clone to dst
RACE_WS_DST="${TEST_SANDBOX}/race_dst"
git clone -q "$RACE_WS_SRC" "$RACE_WS_DST"
git -C "$RACE_WS_DST" fetch -q origin "refs/frostfire/shadow/*:refs/frostfire/shadow/*"

# Launch concurrent snapshot and restore
(
    printf "v2_snapshot\n" >> "$RACE_WS_SRC/version.txt"
    "$SYNC_SCRIPT" snapshot "race_agent" "$RACE_WS_SRC" >/dev/null 2>&1
) &
PID_SNAP=$!

(
    "$SYNC_SCRIPT" restore "race_agent" "$RACE_WS_DST" >/dev/null 2>&1
) &
PID_RESTORE=$!

wait "$PID_SNAP" || true
wait "$PID_RESTORE" || true

# Check that DST workspace is valid and not corrupted
if git -C "$RACE_WS_DST" status >/dev/null 2>&1; then
    pass "Simultaneous snapshot vs restore race completed without workspace corruption"
else
    fail "Simultaneous snapshot vs restore race caused Git repository corruption"
fi

# ==============================================================================
# SECTION 2: Signal Trapping & Daemon Resilience
# ==============================================================================
info "--- SECTION 2: Signal Trapping & Daemon Resilience ---"

# 2.1: Watch daemon graceful SIGTERM flush
info "Test 2.1: sync-workspace-state.sh watch SIGTERM graceful flush..."
WATCH_WS="${TEST_SANDBOX}/watch_ws"
mkdir -p "$WATCH_WS"
git -C "$WATCH_WS" init -q
git -C "$WATCH_WS" config user.name "Watch Agent"
git -C "$WATCH_WS" config user.email "watch@frostfire.dev"
printf "watch init\n" > "$WATCH_WS/watch.txt"
git -C "$WATCH_WS" add .
git -C "$WATCH_WS" commit -m "watch init" -q

"$SYNC_SCRIPT" watch "watch_agent" "$WATCH_WS" 1 &
WATCH_PID=$!
sleep 1.5

# Mutate workspace with in-flight changes
printf "watch pending change\n" >> "$WATCH_WS/watch.txt"
printf "watch untracked file\n" > "$WATCH_WS/new_untracked.txt"

# Send SIGTERM to watch daemon
kill -TERM "$WATCH_PID" 2>/dev/null || true
wait "$WATCH_PID" 2>/dev/null || true

# Verify that the shutdown handler flushed the dirty changes
WATCH_MANIFEST="${PERSIST_ROOT}/.frostfire/state/watch_agent/manifest.json"
if [ -f "$WATCH_MANIFEST" ]; then
    WATCH_DIRTY="$(grep -o '"dirty": *[a-z]*' "$WATCH_MANIFEST" | awk -F: '{print $2}' | tr -d ' "')"
    WATCH_UNTRACKED="$(grep -o '"untracked_count": *[0-9]*' "$WATCH_MANIFEST" | awk -F: '{print $2}' | tr -d ' "')"
    if [ "$WATCH_DIRTY" = "true" ] && [ "$WATCH_UNTRACKED" -eq 1 ]; then
        pass "Watch daemon caught SIGTERM and flushed dirty workspace state & untracked files"
    else
        fail "Watch daemon SIGTERM flush failed: dirty=$WATCH_DIRTY untracked=$WATCH_UNTRACKED"
    fi
else
    fail "Watch daemon SIGTERM flush failed: no manifest produced"
fi

# 2.2: Lock release verification on sudden termination
info "Test 2.2: Lock release verification after interrupt..."
LOCK_TEST_WS="${TEST_SANDBOX}/lock_test_ws"
mkdir -p "$LOCK_TEST_WS"
git -C "$LOCK_TEST_WS" init -q
git -C "$LOCK_TEST_WS" config user.name "Lock Agent"
git -C "$LOCK_TEST_WS" config user.email "lock@frostfire.dev"
printf "lock data\n" > "$LOCK_TEST_WS/lock.txt"
git -C "$LOCK_TEST_WS" add .
git -C "$LOCK_TEST_WS" commit -m "lock" -q

# Run snapshot in subshell and kill it with SIGKILL
(
    exec 200>"${PERSIST_ROOT}/.frostfire/locks/lock_agent.lock"
    flock -x 200
    sleep 5
) &
HELD_PID=$!
sleep 0.5
kill -9 "$HELD_PID" 2>/dev/null || true
wait "$HELD_PID" 2>/dev/null || true

# Assert subsequent snapshot can immediately acquire lock without deadlocking or waiting 10s
LOCK_START=$(date +%s)
"$SYNC_SCRIPT" snapshot "lock_agent" "$LOCK_TEST_WS" >/dev/null 2>&1
LOCK_END=$(date +%s)
LOCK_DURATION=$((LOCK_END - LOCK_START))

if [ "$LOCK_DURATION" -lt 5 ]; then
    pass "Kernel lock cleanly released on process death; immediate re-acquisition succeeded in ${LOCK_DURATION}s"
else
    fail "Lock not cleanly released on process death; took ${LOCK_DURATION}s to acquire"
fi

# 2.3: persist-cli-auth watch SIGTERM flush
info "Test 2.3: persist-cli-auth save-loop / watch SIGTERM graceful exit..."
CLI_WATCH_HOME="${TEST_SANDBOX}/cli_watch_home"
mkdir -p "${CLI_WATCH_HOME}/.aws"
printf "[default]\naws_access_key_id = AKIATEST\n" > "${CLI_WATCH_HOME}/.aws/credentials"

CLI_AUTH_HOME="${CLI_WATCH_HOME}" CLI_AUTH_SAVE_INTERVAL_S=1 "$PERSIST_SCRIPT" watch &
CLI_WATCH_PID=$!
sleep 1.5

# Mutate credential
printf "aws_secret_access_key = SECRETTEST\n" >> "${CLI_WATCH_HOME}/.aws/credentials"
kill -TERM "$CLI_WATCH_PID" 2>/dev/null || true
wait "$CLI_WATCH_PID" 2>/dev/null || true

if grep -q "SECRETTEST" "${MIRROR_ROOT}/.aws/credentials" 2>/dev/null; then
    pass "persist-cli-auth watch caught SIGTERM and flushed updated credentials before exiting"
else
    fail "persist-cli-auth watch failed to flush credentials on SIGTERM"
fi

# ==============================================================================
# SECTION 3: Cache Exclusion & Sizing Cap Hardening
# ==============================================================================
info "--- SECTION 3: Cache Exclusion & Sizing Cap Hardening ---"

# 3.1: All cache directory names pruned
info "Test 3.1: Thorough cache pruning in persist-cli-auth..."
PRUNE_HOME="${TEST_SANDBOX}/prune_home"
mkdir -p "${PRUNE_HOME}/.ssh/Cache" \
         "${PRUNE_HOME}/.ssh/cache" \
         "${PRUNE_HOME}/.ssh/.cache" \
         "${PRUNE_HOME}/.config/gh/GPUCache" \
         "${PRUNE_HOME}/.docker/buildx" \
         "${PRUNE_HOME}/.docker/scout" \
         "${PRUNE_HOME}/.aws/logs" \
         "${PRUNE_HOME}/.vercel/tmp" \
         "${PRUNE_HOME}/.fly/temp"

# Valid credentials
printf "ssh-ed25519 AAAAB3NzaC1yc2EAAAADAQAB\n" > "${PRUNE_HOME}/.ssh/id_ed25519.pub"
printf "gho_test_1234\n" > "${PRUNE_HOME}/.config/gh/hosts.yml"

# Transient files to be excluded
printf "trash\n" > "${PRUNE_HOME}/.ssh/Cache/dummy.dat"
printf "trash\n" > "${PRUNE_HOME}/.ssh/cache/dummy.dat"
printf "trash\n" > "${PRUNE_HOME}/.ssh/.cache/dummy.dat"
printf "trash\n" > "${PRUNE_HOME}/.config/gh/GPUCache/blob.dat"
printf "trash\n" > "${PRUNE_HOME}/.docker/buildx/cache.dat"
printf "trash\n" > "${PRUNE_HOME}/.docker/scout/index.db"
printf "trash\n" > "${PRUNE_HOME}/.aws/logs/cli.log"
printf "trash\n" > "${PRUNE_HOME}/.vercel/tmp/temp.json"
printf "trash\n" > "${PRUNE_HOME}/.fly/temp/session.bin"

PRUNE_MIRROR="${PERSIST_ROOT}/prune_mirror"
CLI_AUTH_HOME="${PRUNE_HOME}" CLI_AUTH_MIRROR="${PRUNE_MIRROR}" "$PERSIST_SCRIPT" save >/dev/null 2>&1

LEAKED=0
for forbidden in Cache cache .cache GPUCache buildx scout logs tmp temp; do
    if [ -e "${PRUNE_MIRROR}/.ssh/${forbidden}" ] || \
       [ -e "${PRUNE_MIRROR}/.config/gh/${forbidden}" ] || \
       [ -e "${PRUNE_MIRROR}/.docker/${forbidden}" ] || \
       [ -e "${PRUNE_MIRROR}/.aws/${forbidden}" ] || \
       [ -e "${PRUNE_MIRROR}/.vercel/${forbidden}" ] || \
       [ -e "${PRUNE_MIRROR}/.fly/${forbidden}" ]; then
        fail "persist-cli-auth leaked prohibited directory: ${forbidden}"
        LEAKED=1
    fi
done

if [ "$LEAKED" -eq 0 ]; then
    pass "All transient cache patterns (Cache, cache, .cache, GPUCache, buildx, scout, logs, tmp, temp) successfully excluded from mirror"
fi

# 3.2: 50 MiB Sizing Cap Enforcement
info "Test 3.2: 50 MiB Directory Cap Enforcement in persist-cli-auth..."
OVERSIZED_HOME="${TEST_SANDBOX}/oversized_home"
mkdir -p "${OVERSIZED_HOME}/.aws" "${OVERSIZED_HOME}/.ssh"
printf "small ssh key\n" > "${OVERSIZED_HOME}/.ssh/id_ed25519"

# Create a 52 MiB file in .aws (exceeding default 50 MiB cap)
dd if=/dev/zero of="${OVERSIZED_HOME}/.aws/oversized_bloat.dat" bs=1M count=52 2>/dev/null

OVERSIZED_MIRROR="${PERSIST_ROOT}/oversized_mirror"
SAVE_OUT="$(CLI_AUTH_HOME="${OVERSIZED_HOME}" CLI_AUTH_MIRROR="${OVERSIZED_MIRROR}" "$PERSIST_SCRIPT" save 2>&1 || true)"

if echo "$SAVE_OUT" | grep -q "oversized=1" && echo "$SAVE_OUT" | grep -q "SKIP oversized"; then
    if [ ! -e "${OVERSIZED_MIRROR}/.aws" ] && [ -f "${OVERSIZED_MIRROR}/.ssh/id_ed25519" ]; then
        pass "50 MiB sizing cap properly enforced: oversized directory skipped while valid directory persisted"
    else
        fail "Sizing cap failed: oversized target was persisted or valid target missed"
    fi
else
    fail "persist-cli-auth did not report oversized target: $SAVE_OUT"
fi

# ==============================================================================
# SECTION 4: Multi-Cycle Ephemeral Rehydration Integrity
# ==============================================================================
info "--- SECTION 4: Multi-Cycle Ephemeral Rehydration Integrity ---"

# Cycle 1 -> Cycle 2 -> Cycle 3 rehydration chain with progressive edits
CHAIN_EFS="${PERSIST_ROOT}/chain_efs"
mkdir -p "$CHAIN_EFS"

# Cycle 1: Seed
C1_WS="${TEST_SANDBOX}/chain_c1"
mkdir -p "$C1_WS"
git -C "$C1_WS" init -q
git -C "$C1_WS" config user.name "Chain Agent"
git -C "$C1_WS" config user.email "chain@frostfire.dev"
printf "v1 line\n" > "$C1_WS/file1.txt"
git -C "$C1_WS" add .
git -C "$C1_WS" commit -m "v1" -q

printf "v2 staged\n" > "$C1_WS/file2.txt"
git -C "$C1_WS" add "$C1_WS/file2.txt"
printf "v2 unstaged\n" >> "$C1_WS/file1.txt"
printf "untracked c1\n" > "$C1_WS/untracked.txt"

C1_SHA1="$(sha256sum "$C1_WS/file1.txt" | cut -d' ' -f1)"
C1_SHA2="$(sha256sum "$C1_WS/file2.txt" | cut -d' ' -f1)"
C1_SHAU="$(sha256sum "$C1_WS/untracked.txt" | cut -d' ' -f1)"

FROSTFIRE_PERSIST_ROOT="$CHAIN_EFS" "$SYNC_SCRIPT" snapshot "chain_agent" "$C1_WS" >/dev/null 2>&1

# Cycle 2: Rehydrate into C2, modify, and snapshot again
C2_WS="${TEST_SANDBOX}/chain_c2"
git clone -q "$C1_WS" "$C2_WS"
git -C "$C2_WS" fetch -q origin "refs/frostfire/shadow/*:refs/frostfire/shadow/*"

FROSTFIRE_PERSIST_ROOT="$CHAIN_EFS" "$SYNC_SCRIPT" restore "chain_agent" "$C2_WS" >/dev/null 2>&1

# Verify C2 matches C1
C2_SHA1="$(sha256sum "$C2_WS/file1.txt" | cut -d' ' -f1)"
C2_SHA2="$(sha256sum "$C2_WS/file2.txt" | cut -d' ' -f1)"
C2_SHAU="$(sha256sum "$C2_WS/untracked.txt" | cut -d' ' -f1)"

if [ "$C1_SHA1" = "$C2_SHA1" ] && [ "$C1_SHA2" = "$C2_SHA2" ] && [ "$C1_SHAU" = "$C2_SHAU" ]; then
    # Progressive edit in C2
    printf "v3 unstaged\n" >> "$C2_WS/file1.txt"
    printf "untracked c2 extra\n" > "$C2_WS/extra.txt"
    C2_MOD_SHA1="$(sha256sum "$C2_WS/file1.txt" | cut -d' ' -f1)"
    C2_MOD_SHAX="$(sha256sum "$C2_WS/extra.txt" | cut -d' ' -f1)"

    FROSTFIRE_PERSIST_ROOT="$CHAIN_EFS" "$SYNC_SCRIPT" snapshot "chain_agent" "$C2_WS" >/dev/null 2>&1

    # Cycle 3: Rehydrate into C3
    C3_WS="${TEST_SANDBOX}/chain_c3"
    git clone -q "$C2_WS" "$C3_WS"
    git -C "$C3_WS" fetch -q origin "refs/frostfire/shadow/*:refs/frostfire/shadow/*"

    FROSTFIRE_PERSIST_ROOT="$CHAIN_EFS" "$SYNC_SCRIPT" restore "chain_agent" "$C3_WS" >/dev/null 2>&1

    C3_SHA1="$(sha256sum "$C3_WS/file1.txt" | cut -d' ' -f1)"
    C3_SHAX="$(sha256sum "$C3_WS/extra.txt" | cut -d' ' -f1)"

    if [ "$C2_MOD_SHA1" = "$C3_SHA1" ] && [ "$C2_MOD_SHAX" = "$C3_SHAX" ]; then
        pass "Multi-cycle rehydration chain (C1 -> C2 -> C3) preserved 100% cryptographic parity across successive modifications"
    else
        fail "Multi-cycle rehydration chain mismatch in C3"
    fi
else
    fail "Initial rehydration mismatch between C1 and C2"
fi

exit 0
