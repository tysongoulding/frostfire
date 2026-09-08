#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(pwd)/cloud/microvm/scripts/box-cgroups.sh"
TEMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

export SAND_CGROUP_ROOT="${TEMP_DIR}/cgroup"
mkdir -p "${SAND_CGROUP_ROOT}"

# Simulate cgroup v2 controllers file
echo "cpu memory pids" > "${SAND_CGROUP_ROOT}/cgroup.controllers"
touch "${SAND_CGROUP_ROOT}/cgroup.subtree_control"
touch "${SAND_CGROUP_ROOT}/cgroup.procs"

# Source box-cgroups.sh
# shellcheck source=/dev/null
source "${SCRIPT_PATH}"

# Test sand_cgroup_setup
sand_cgroup_setup

# Verify directories created
if [ ! -d "${SAND_CGROUP_ROOT}/interactive" ] || [ ! -d "${SAND_CGROUP_ROOT}/agent" ]; then
  echo "FAIL: Interactive or agent cgroup domain not created"
  exit 1
fi

# Verify weights
INTERACTIVE_WEIGHT="$(cat "${SAND_CGROUP_ROOT}/interactive/cpu.weight" 2>/dev/null || echo "")"
AGENT_WEIGHT="$(cat "${SAND_CGROUP_ROOT}/agent/cpu.weight" 2>/dev/null || echo "")"

if [ "${INTERACTIVE_WEIGHT}" != "800" ]; then
  echo "FAIL: Expected interactive cpu.weight 800, got '${INTERACTIVE_WEIGHT}'"
  exit 1
fi

if [ "${AGENT_WEIGHT}" != "100" ]; then
  echo "FAIL: Expected agent cpu.weight 100, got '${AGENT_WEIGHT}'"
  exit 1
fi

# Verify subtree_control has controllers written
SUBTREE="$(cat "${SAND_CGROUP_ROOT}/cgroup.subtree_control" 2>/dev/null || echo "")"
if [[ "${SUBTREE}" != *"+"* ]]; then
  echo "FAIL: Subtree control does not contain controller activations: '${SUBTREE}'"
  exit 1
fi

# Verify process placement
sand_cgroup_place interactive 12345
PLACED="$(cat "${SAND_CGROUP_ROOT}/interactive/cgroup.procs" 2>/dev/null || echo "")"
if [ "${PLACED}" != "12345" ]; then
  echo "FAIL: Process 12345 was not placed in interactive cgroup: '${PLACED}'"
  exit 1
fi

echo "ALL BOX-CGROUPS AUDIT TESTS PASSED"
