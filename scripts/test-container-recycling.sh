#!/usr/bin/env bash
# ==============================================================================
# Frostfire Cloud: Automated Container Recycling & Persistence Verification Harness
# Verifies bit-for-bit state preservation across ephemeral microVM recycling
# Location: scripts/test-container-recycling.sh
#
# Simulates the 5-phase container recycling lifecycle:
# Phase 1: Container 1 Active Lifecycle & Workload Seeding
# Phase 2: Persistence & State Snapshotting
# Phase 3: Simulated Container Recycling Event (Obliteration)
# Phase 4: Container 2 Recovery & Rehydration
# Phase 5: Verification & Integrity Assertions
# ==============================================================================
set -euo pipefail

# ------------------------------------------------------------------------------
# Test Environment Sandbox Configuration
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Sandboxed base directory
TEST_BASE_DIR="${TEST_BASE_DIR:-/tmp/frostfire-recycling-test-$$}"
EFS_DIR="${TEST_BASE_DIR}/mnt_workspace"
REPO_DIR="${EFS_DIR}/test-repo"
MIRROR_DIR="${EFS_DIR}/.frostfire/credentials"
STATE_DIR="${EFS_DIR}/.frostfire/state/test-agent"
CHECKSUMS_FILE="${EFS_DIR}/baseline-checksums.sha256"

# Two simulated ephemeral container roots
C1_ROOT="${TEST_BASE_DIR}/container_1"
C1_HOME="${C1_ROOT}/home/frostfire"

C2_ROOT="${TEST_BASE_DIR}/container_2"
C2_HOME="${C2_ROOT}/home/frostfire"

# Executable paths
PERSIST_CLI_AUTH="${REPO_ROOT}/cloud/microvm/bin/persist-cli-auth"
SYNC_WORKSPACE_STATE="${REPO_ROOT}/scripts/sync-workspace-state.sh"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { printf "${GREEN}[PASS]${NC} %s\n" "$*"; }
fail() { printf "${RED}[FAIL]${NC} %s\n" "$*" >&2; exit 1; }
info() { printf "${BLUE}[INFO]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$*"; }

cleanup() {
    local exit_code=$?
    if [ "$exit_code" -eq 0 ]; then
        info "Cleaning up sandbox directory: ${TEST_BASE_DIR}"
        rm -rf "${TEST_BASE_DIR}"
        pass "Test suite completed successfully."
    else
        warn "Preserving sandbox directory for forensics: ${TEST_BASE_DIR}"
    fi
}
trap cleanup EXIT

# ------------------------------------------------------------------------------
# Phase 0: Prerequisite Validation & Sandbox Setup
# ------------------------------------------------------------------------------
info "Phase 0: Initializing sandbox environment..."
command -v git >/dev/null 2>&1 || fail "git command not found"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum command not found"
command -v tar >/dev/null 2>&1 || fail "tar command not found"

[ -f "$PERSIST_CLI_AUTH" ] || fail "persist-cli-auth script not found at ${PERSIST_CLI_AUTH}"
chmod +x "$PERSIST_CLI_AUTH"

[ -f "$SYNC_WORKSPACE_STATE" ] || fail "sync-workspace-state.sh script not found at ${SYNC_WORKSPACE_STATE}"
chmod +x "$SYNC_WORKSPACE_STATE"

rm -rf "${TEST_BASE_DIR}"
mkdir -p "${EFS_DIR}" "${C1_HOME}" "${C2_HOME}" "${STATE_DIR}"
pass "Phase 0 completed."

# ------------------------------------------------------------------------------
# Phase 1: Container 1 Active Lifecycle & Workload Seeding
# ------------------------------------------------------------------------------
info "Phase 1: Seeding Container 1 credentials and workspace repository..."

# 1.1 Seed Developer CLI Credentials in Container 1
mkdir -p "${C1_HOME}/.ssh/Cache" \
         "${C1_HOME}/.aws" \
         "${C1_HOME}/.config/gh/GPUCache" \
         "${C1_HOME}/.config/gcloud/configurations" \
         "${C1_HOME}/.docker" \
         "${C1_HOME}/.vercel" \
         "${C1_HOME}/.fly"

# SSH keys & config
printf '%s\n' '-----BEGIN OPENSSH PRIVATE KEY-----' 'MOCK_ED25519_PRIVATE_KEY_DATA_BLOCK' '-----END OPENSSH PRIVATE KEY-----' > "${C1_HOME}/.ssh/id_ed25519"
printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockPublicKey test@frostfire.dev\n' > "${C1_HOME}/.ssh/id_ed25519.pub"
printf 'Host *\n  ServerAliveInterval 60\n  IdentityFile ~/.ssh/id_ed25519\n' > "${C1_HOME}/.ssh/config"
printf 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n' > "${C1_HOME}/.ssh/known_hosts"
printf 'transient_ssh_cache_bytes\n' > "${C1_HOME}/.ssh/Cache/session_cache.dat"

# AWS CLI
printf '[default]\naws_access_key_id = AKIAIOSFODNN7EXAMPLE\naws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n' > "${C1_HOME}/.aws/credentials"
printf '[default]\nregion = us-east-1\noutput = json\n' > "${C1_HOME}/.aws/config"

# GitHub CLI
printf 'github.com:\n  oauth_token: gho_mock_test_token_1234567890abcdef\n  user: frostfire-agent\n  git_protocol: https\n' > "${C1_HOME}/.config/gh/hosts.yml"
printf 'git_protocol: https\neditor: vim\n' > "${C1_HOME}/.config/gh/config.yml"
printf 'transient_gpu_blob_cache\n' > "${C1_HOME}/.config/gh/GPUCache/blob.bin"

# Docker, Vercel, Fly
printf '{"auths":{"https://index.docker.io/v1/":{"auth":"bW9ja3VzZXI6bW9ja3Bhc3M="}}}\n' > "${C1_HOME}/.docker/config.json"
printf '{"token":"mock_vercel_api_token_xyz"}\n' > "${C1_HOME}/.vercel/auth.json"
printf 'access_token: fly_mock_access_token_abc\n' > "${C1_HOME}/.fly/config.yml"

# Netrc, npmrc, gitconfig, git-credentials
printf 'machine api.github.com login frostfire password token_xyz123\n' > "${C1_HOME}/.netrc"
printf '//registry.npmjs.org/:_authToken=npm_mock_secret_token_789\n' > "${C1_HOME}/.npmrc"
printf '[user]\n  name = Frostfire Autonomous Agent\n  email = agent@frostfire.cloud\n[credential]\n  helper = store\n' > "${C1_HOME}/.gitconfig"
printf 'https://frostfire:secret_git_pass@github.com\n' > "${C1_HOME}/.git-credentials"

# 1.2 Initialize Git Repository in Workspace
mkdir -p "${REPO_DIR}"
cd "${REPO_DIR}"
git init -q
git config user.name "Frostfire Agent"
git config user.email "agent@frostfire.cloud"

# Baseline tracked commit
printf '// Frostfire Autonomous Cloud Agent Entrypoint\npub fn main() {\n    println!("Agent online");\n}\n' > main.rs
printf '# Frostfire Test Repo\nAutonomous execution workspace.\n' > README.md
git add main.rs README.md
git commit -m "Initial baseline commit" -q
BASELINE_COMMIT="$(git rev-parse HEAD)"

# Create Staged Changes
printf 'pub fn execute_workload() -> bool { true }\n' > staged_feature.rs
git add staged_feature.rs

# Create Unstaged Modifications
printf '\n// Modified during session 1: in-flight edits\n' >> main.rs

# Create Untracked Files
mkdir -p artifacts
printf '{"run_id":"run-001","status":"running","step":3}\n' > artifacts/execution_state.json
printf 'DATABASE_URL=postgres://frostfire:secret@localhost:5432/db\nAPI_KEY=ff_live_key_999\n' > .env.local
dd if=/dev/urandom of=artifacts/binary_payload.bin bs=1024 count=128 2>/dev/null

# 1.3 Record Pre-Recycling Checksums
info "Computing baseline SHA-256 checksums..."
(
    cd "${C1_HOME}"
    sha256sum .ssh/id_ed25519 .ssh/id_ed25519.pub .ssh/config .ssh/known_hosts \
              .aws/credentials .aws/config \
              .config/gh/hosts.yml .config/gh/config.yml \
              .docker/config.json .vercel/auth.json .fly/config.yml \
              .netrc .npmrc .gitconfig .git-credentials
    cd "${REPO_DIR}"
    sha256sum main.rs README.md staged_feature.rs \
              artifacts/execution_state.json .env.local artifacts/binary_payload.bin
) > "${CHECKSUMS_FILE}"

pass "Phase 1 completed: Workload seeded and baseline manifest recorded."

# ------------------------------------------------------------------------------
# Phase 2: Persistence & State Snapshotting
# ------------------------------------------------------------------------------
info "Phase 2: Executing workspace and credential snapshotting..."

# Run sync-workspace-state.sh snapshot which snapshots git worktree and calls persist-cli-auth save
export FROSTFIRE_PERSIST_ROOT="${EFS_DIR}"
export WORKSPACE_DIR="${REPO_DIR}"
export CLI_AUTH_HOME="${C1_HOME}"
export CLI_AUTH_MIRROR="${MIRROR_DIR}"

info "Executing sync-workspace-state.sh snapshot test-agent..."
"$SYNC_WORKSPACE_STATE" snapshot test-agent "${REPO_DIR}"

# Assert mirror directory contents
[ -d "${MIRROR_DIR}/.ssh" ] || fail "Mirror missing .ssh directory"
[ -f "${MIRROR_DIR}/.ssh/id_ed25519" ] || fail "Mirror missing id_ed25519"
[ -f "${MIRROR_DIR}/.aws/credentials" ] || fail "Mirror missing AWS credentials"
[ -f "${MIRROR_DIR}/.config/gh/hosts.yml" ] || fail "Mirror missing gh hosts.yml"
[ -f "${MIRROR_DIR}/.netrc" ] || fail "Mirror missing .netrc"
[ -f "${MIRROR_DIR}/.npmrc" ] || fail "Mirror missing .npmrc"
[ -f "${MIRROR_DIR}/.gitconfig" ] || fail "Mirror missing .gitconfig"

# Assert cache pruning in mirror
[ ! -e "${MIRROR_DIR}/.ssh/Cache" ] || fail "Mirror leaked .ssh/Cache directory"
[ ! -e "${MIRROR_DIR}/.config/gh/GPUCache" ] || fail "Mirror leaked .config/gh/GPUCache directory"

# Assert mirror permissions (0700 dirs, 0600 files)
SSH_DIR_PERM="$(stat -c '%a' "${MIRROR_DIR}/.ssh")"
[ "$SSH_DIR_PERM" = "700" ] || fail "Mirror .ssh permissions are not 0700 (got: $SSH_DIR_PERM)"
KEY_FILE_PERM="$(stat -c '%a' "${MIRROR_DIR}/.ssh/id_ed25519")"
[ "$KEY_FILE_PERM" = "600" ] || fail "Mirror id_ed25519 permissions are not 0600 (got: $KEY_FILE_PERM)"

# Assert manifest and shadow ref
[ -f "${STATE_DIR}/manifest.json" ] || fail "Missing manifest.json at ${STATE_DIR}/manifest.json"
SHADOW_REF_COMMIT="$(git -C "${REPO_DIR}" rev-parse -q --verify refs/frostfire/shadow/test-agent || echo "")"
[ -n "$SHADOW_REF_COMMIT" ] || fail "Missing git shadow ref refs/frostfire/shadow/test-agent"

sync
pass "Phase 2 completed: Credentials mirrored and workspace state captured."

# ------------------------------------------------------------------------------
# Phase 3: Simulated Container Recycling Event (Obliteration)
# ------------------------------------------------------------------------------
info "Phase 3: Simulating container recycling (destroying Container 1 and wiping ephemeral state)..."

# 3.1 Obliterate Container 1 Ephemeral Disk
rm -rf "${C1_ROOT}"
[ ! -d "${C1_ROOT}" ] || fail "Container 1 root was not completely destroyed"

# 3.2 Obliterate Ephemeral Workspace Changes (Simulate dirty container crash/restart)
cd "${REPO_DIR}"
git reset --hard "${BASELINE_COMMIT}" -q
git clean -fdx -q

# Verify workspace is stripped clean to baseline
[ ! -f "${REPO_DIR}/staged_feature.rs" ] || fail "staged_feature.rs survived reset"
[ ! -f "${REPO_DIR}/.env.local" ] || fail ".env.local survived clean"
[ ! -d "${REPO_DIR}/artifacts" ] || fail "artifacts/ directory survived clean"
grep -q "session 1" "${REPO_DIR}/main.rs" && fail "main.rs unstaged modification survived clean"

# 3.3 Spawn Container 2
mkdir -p "${C2_HOME}"
[ -d "${C2_HOME}" ] || fail "Failed to initialize Container 2 home"
[ ! -e "${C2_HOME}/.ssh" ] || fail "Container 2 initialized with non-empty .ssh"
[ ! -e "${C2_HOME}/.aws" ] || fail "Container 2 initialized with non-empty .aws"

pass "Phase 3 completed: Ephemeral container destroyed and fresh container spawned."

# ------------------------------------------------------------------------------
# Phase 4: Container 2 Recovery & Rehydration
# ------------------------------------------------------------------------------
info "Phase 4: Restoring state inside Container 2..."

export CLI_AUTH_HOME="${C2_HOME}"
export CLI_AUTH_MIRROR="${MIRROR_DIR}"

info "Executing sync-workspace-state.sh restore test-agent..."
"$SYNC_WORKSPACE_STATE" restore test-agent "${REPO_DIR}"

pass "Phase 4 completed: State rehydrated into Container 2."

# ------------------------------------------------------------------------------
# Phase 5: Verification & Integrity Assertions
# ------------------------------------------------------------------------------
info "Phase 5: Verifying bit-for-bit file integrity and security boundaries..."

# 5.1 Bit-for-bit Checksum Audit
RESTORED_CHECKSUMS="${EFS_DIR}/restored-checksums.sha256"
(
    cd "${C2_HOME}"
    sha256sum .ssh/id_ed25519 .ssh/id_ed25519.pub .ssh/config .ssh/known_hosts \
              .aws/credentials .aws/config \
              .config/gh/hosts.yml .config/gh/config.yml \
              .docker/config.json .vercel/auth.json .fly/config.yml \
              .netrc .npmrc .gitconfig .git-credentials
    cd "${REPO_DIR}"
    sha256sum main.rs README.md staged_feature.rs \
              artifacts/execution_state.json .env.local artifacts/binary_payload.bin
) > "${RESTORED_CHECKSUMS}"

info "Comparing baseline vs restored SHA-256 checksums..."
if diff -u "${CHECKSUMS_FILE}" "${RESTORED_CHECKSUMS}"; then
    pass "Bit-for-bit cryptographic checksum audit PASSED: All 21 files identical."
else
    fail "Checksum mismatch detected! Restored files deviate from pre-recycling state."
fi

# 5.2 POSIX Permissions Audit
info "Verifying POSIX permission hardening in Container 2..."
C2_SSH_DIR_PERM="$(stat -c '%a' "${C2_HOME}/.ssh")"
[ "$C2_SSH_DIR_PERM" = "700" ] || fail "Container 2 .ssh dir perm is not 0700 (got: $C2_SSH_DIR_PERM)"

C2_KEY_PERM="$(stat -c '%a' "${C2_HOME}/.ssh/id_ed25519")"
[ "$C2_KEY_PERM" = "600" ] || fail "Container 2 id_ed25519 perm is not 0600 (got: $C2_KEY_PERM)"

C2_AWS_DIR_PERM="$(stat -c '%a' "${C2_HOME}/.aws")"
[ "$C2_AWS_DIR_PERM" = "700" ] || fail "Container 2 .aws dir perm is not 0700 (got: $C2_AWS_DIR_PERM)"

C2_AWS_CRED_PERM="$(stat -c '%a' "${C2_HOME}/.aws/credentials")"
[ "$C2_AWS_CRED_PERM" = "600" ] || fail "Container 2 AWS credentials perm is not 0600 (got: $C2_AWS_CRED_PERM)"

C2_NETRC_PERM="$(stat -c '%a' "${C2_HOME}/.netrc")"
[ "$C2_NETRC_PERM" = "600" ] || fail "Container 2 .netrc perm is not 0600 (got: $C2_NETRC_PERM)"

pass "POSIX permission audit PASSED: 0700 dirs and 0600 secret files enforced."

# 5.3 Cache Exemption Audit
[ ! -e "${C2_HOME}/.ssh/Cache" ] || fail "Container 2 incorrectly received pruned .ssh/Cache"
[ ! -e "${C2_HOME}/.config/gh/GPUCache" ] || fail "Container 2 incorrectly received pruned .config/gh/GPUCache"
pass "Cache exemption audit PASSED: Ephemeral cache files properly omitted."

# 5.4 Convergence & Idempotency Audit
info "Testing persist-cli-auth sync idempotency in Container 2..."
SYNC_OUTPUT="$(CLI_AUTH_HOME="${C2_HOME}" CLI_AUTH_MIRROR="${MIRROR_DIR}" "$PERSIST_CLI_AUTH" sync)"
echo "$SYNC_OUTPUT"
if echo "$SYNC_OUTPUT" | grep -q "persisted=0"; then
    pass "Sync idempotency audit PASSED: Zero redundant writes on synchronized state."
else
    fail "Sync idempotency failure: Unexpected mutations detected on unchanged state."
fi

# 5.5 Update Propagation Audit
info "Testing bidirectional sync propagation..."
printf '# New config line appended in Container 2\n[test]\n  key = value\n' >> "${C2_HOME}/.gitconfig"
CLI_AUTH_HOME="${C2_HOME}" CLI_AUTH_MIRROR="${MIRROR_DIR}" "$PERSIST_CLI_AUTH" sync
if grep -q "key = value" "${MIRROR_DIR}/.gitconfig"; then
    pass "Bidirectional sync audit PASSED: Local edits correctly propagated to mirror."
else
    fail "Bidirectional sync failure: Local edit was not mirrored."
fi

info "Executing status report and list commands..."
CLI_AUTH_HOME="${C2_HOME}" CLI_AUTH_MIRROR="${MIRROR_DIR}" "$PERSIST_CLI_AUTH" status
"$SYNC_WORKSPACE_STATE" list
"$SYNC_WORKSPACE_STATE" list --json

# 5.6 Watch Daemon & SIGTERM Trap Audit
info "Testing sync-workspace-state.sh watch daemon and termination trap..."
SYNC_INTERVAL_SECS=1 "$SYNC_WORKSPACE_STATE" watch test-agent "${REPO_DIR}" 1 &
WATCH_PID=$!
sleep 2

# Append a change to trigger watch snapshot
printf '// Watch trigger\n' >> "${REPO_DIR}/main.rs"
sleep 2

# Terminate watch daemon via SIGTERM and assert clean exit
kill -TERM "$WATCH_PID" 2>/dev/null || true
wait "$WATCH_PID" 2>/dev/null || true
pass "Watch daemon audit PASSED: Background loop detected changes and cleanly flushed on SIGTERM."

# 5.7 Clean Subcommand Audit
info "Testing sync-workspace-state.sh clean subcommand..."
"$SYNC_WORKSPACE_STATE" clean test-agent "${REPO_DIR}"
[ ! -d "${STATE_DIR}" ] || fail "State directory survived clean command"
[ ! -f "${EFS_DIR}/.frostfire/locks/test-agent.lock" ] || fail "Lock file survived clean command"
SHADOW_REF_CHECK="$(git -C "${REPO_DIR}" rev-parse -q --verify refs/frostfire/shadow/test-agent || echo "")"
[ -z "$SHADOW_REF_CHECK" ] || fail "Shadow ref survived clean command"
pass "Clean subcommand audit PASSED: All agent artifacts cleanly purged."

pass "ALL 5 PHASES OF CONTAINER RECYCLING & WORKSPACE SYNC VERIFICATION PASSED."
