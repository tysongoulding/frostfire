#!/usr/bin/env bash
# Adversarial & Empirical Test Suite for box-cgroups.sh
set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "$0")/../../cloud/microvm/scripts" && pwd)/box-cgroups.sh"
echo "=== Testing box-cgroups.sh Edge Cases & Hardening ==="
echo "Target script: ${SCRIPT_PATH}"

# Source functions from box-cgroups.sh without executing main setup
export SAND_BOX_CGROUPS_DISABLED="true"
# shellcheck source=../../cloud/microvm/scripts/box-cgroups.sh
source "${SCRIPT_PATH}"
unset SAND_BOX_CGROUPS_DISABLED

# ---------------------------------------------------------------------------
# Test 1: sand_cgroups_enabled Flag Logic
# ---------------------------------------------------------------------------
echo "[Test 1] Testing sand_cgroups_enabled disabled flag variations..."
for val in "1" "true" "yes" "TRUE" "YES" " 1 " " true "; do
  export SAND_BOX_CGROUPS_DISABLED="${val}"
  if sand_cgroups_enabled; then
    echo "FAIL: Expected sand_cgroups_enabled to return 1 (disabled) for '${val}'"
    exit 1
  fi
done

for val in "" "0" "false" "no" "random"; do
  export SAND_BOX_CGROUPS_DISABLED="${val}"
  if ! sand_cgroups_enabled; then
    echo "FAIL: Expected sand_cgroups_enabled to return 0 (enabled) for '${val}'"
    exit 1
  fi
done
unset SAND_BOX_CGROUPS_DISABLED
echo "  -> Flag variations PASSED"

# ---------------------------------------------------------------------------
# Test 2: Group Name Path Traversal Sanitization
# ---------------------------------------------------------------------------
echo "[Test 2] Testing sand_cgroup_sanitize_group..."
bad_groups=("../evil" "evil/../../etc" "/absolute" "" ".." "foo/..")
for grp in "${bad_groups[@]}"; do
  if sand_cgroup_sanitize_group "${grp}"; then
    echo "FAIL: Unsanitized group '${grp}' was accepted!"
    exit 1
  fi
done

good_groups=("interactive" "agent" "sandbox_1" "my-group" "interactive/subgroup")
for grp in "${good_groups[@]}"; do
  if ! sand_cgroup_sanitize_group "${grp}"; then
    echo "FAIL: Valid group '${grp}' was rejected!"
    exit 1
  fi
done
echo "  -> Group name sanitization PASSED"

# ---------------------------------------------------------------------------
# Test 3: Byte Unit Parsing
# ---------------------------------------------------------------------------
echo "[Test 3] Testing parse_bytes unit conversion..."
assert_eq() {
  local actual="$1" expected="$2" label="$3"
  if [ "${actual}" != "${expected}" ]; then
    echo "FAIL: parse_bytes ${label}: expected ${expected}, got ${actual}"
    exit 1
  fi
}

assert_eq "$(parse_bytes "4G")" "4294967296" "4G"
assert_eq "$(parse_bytes "6g")" "6442450944" "6g"
assert_eq "$(parse_bytes "512M")" "536870912" "512M"
assert_eq "$(parse_bytes "1024K")" "1048576" "1024K"
assert_eq "$(parse_bytes "1000")" "1000" "raw 1000"
echo "  -> Unit conversion PASSED"

# ---------------------------------------------------------------------------
# Test 4: Cgroup CPU Weight Bounds (1..10000)
# ---------------------------------------------------------------------------
echo "[Test 4] Testing cpu.weight boundary validation..."
FAKE_ROOT=$(mktemp -d /tmp/cgroup_test_XXXXXX)
trap "rm -rf \"${FAKE_ROOT}\"" EXIT
export SAND_CGROUP_ROOT="${FAKE_ROOT}"
mkdir -p "${FAKE_ROOT}/interactive"

# Non-numeric weights must be ignored
sand_cgroup_apply_weight "interactive" "invalid_weight"
if [ -f "${FAKE_ROOT}/interactive/cpu.weight" ]; then
  echo "FAIL: Non-numeric weight wrote to cpu.weight"
  exit 1
fi

# Out-of-range weights (<1 or >10000) must be ignored
sand_cgroup_apply_weight "interactive" "0"
sand_cgroup_apply_weight "interactive" "10001"
sand_cgroup_apply_weight "interactive" "999999"
if [ -f "${FAKE_ROOT}/interactive/cpu.weight" ]; then
  echo "FAIL: Out-of-range weight wrote to cpu.weight"
  exit 1
fi

# Valid weight in range 1..10000 must be written
sand_cgroup_apply_weight "interactive" "800"
if [ ! -f "${FAKE_ROOT}/interactive/cpu.weight" ] || [ "$(cat "${FAKE_ROOT}/interactive/cpu.weight")" != "800" ]; then
  echo "FAIL: Valid weight 800 was not written"
  exit 1
fi

sand_cgroup_apply_weight "interactive" "1"
assert_eq "$(cat "${FAKE_ROOT}/interactive/cpu.weight")" "1" "weight 1"

sand_cgroup_apply_weight "interactive" "10000"
assert_eq "$(cat "${FAKE_ROOT}/interactive/cpu.weight")" "10000" "weight 10000"
echo "  -> CPU weight bounds PASSED"

# ---------------------------------------------------------------------------
# Test 5: Ratio Invariant Verification (interactive >= agent * 8)
# ---------------------------------------------------------------------------
echo "[Test 5] Verifying 8:1 priority ratio invariant..."
IW="${SAND_CGROUP_INTERACTIVE_WEIGHT:-800}"
AW="${SAND_CGROUP_AGENT_WEIGHT:-100}"
if [ "${IW}" -lt "$((AW * 8))" ]; then
  echo "FAIL: Interactive weight (${IW}) violates 8:1 priority ratio over agent weight (${AW})"
  exit 1
fi
echo "  -> 8:1 ratio invariant PASSED (${IW} >= ${AW} * 8)"

echo "=== ALL box-cgroups.sh ADVERSARIAL TESTS PASSED! ==="
