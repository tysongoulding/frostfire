#!/usr/bin/env bash
# ==============================================================================
# Frostfire MicroVM Cluster Setup Boundary & Robustness Test Matrix
# Tests scripts/setup-cluster.sh input validation against edge cases and bounds
# ==============================================================================
set -u

SCRIPT="scripts/setup-cluster.sh"

TOTAL=0
PASSED=0
FAILED=0

run_test() {
  local desc="$1"
  local expected_exit="$2" # 0 for ACCEPT, non-zero for REJECT
  shift 2
  local args=("$@")

  TOTAL=$((TOTAL + 1))
  local output
  output=$(bash "${SCRIPT}" "${args[@]}" --dry-run 2>&1)
  local ec=$?

  local test_passed=0
  local reason=""

  if [ "${expected_exit}" -eq 0 ]; then
    if [ "${ec}" -eq 0 ]; then
      # Also check that no bash error messages leaked to stderr
      if echo "${output}" | grep -qiE "(syntax error|integer expression expected|unary operator expected)"; then
        test_passed=0
        reason="Exited 0 but leaked bash syntax/expression error: ${output}"
      else
        test_passed=1
      fi
    else
      test_passed=0
      reason="Expected exit 0 but got ${ec}. Output: ${output}"
    fi
  else
    if [ "${ec}" -ne 0 ]; then
      test_passed=1
    else
      test_passed=0
      reason="Expected non-zero exit code (rejection), but exited 0 (bypassed). Output: ${output}"
    fi
  fi

  if [ "${test_passed}" -eq 1 ]; then
    PASSED=$((PASSED + 1))
    printf "  [PASS] %-55s | Expected: %s | Actual EC: %d\n" "${desc}" "$([ "${expected_exit}" -eq 0 ] && echo 'ACCEPT' || echo 'REJECT')" "${ec}"
  else
    FAILED=$((FAILED + 1))
    printf "  [FAIL] %-55s | Expected: %s | Actual EC: %d\n" "${desc}" "$([ "${expected_exit}" -eq 0 ] && echo 'ACCEPT' || echo 'REJECT')" "${ec}"
    printf "         Reason: %s\n" "${reason}"
  fi
}

echo "=========================================================="
echo "Bash Cluster Setup Boundary Test Matrix (Pre-Fix Assessment)"
echo "=========================================================="

echo -e "\n--- Category 1: VM_COUNT Non-Integer Inputs ---"
run_test "VM_COUNT string 'abc'" 1 --vms "abc"
run_test "VM_COUNT float '3.5'" 1 --vms "3.5"
run_test "VM_COUNT float '1.0'" 1 --vms "1.0"
run_test "VM_COUNT empty string ''" 1 --vms ""
run_test "VM_COUNT whitespace '   '" 1 --vms "   "
run_test "VM_COUNT special chars '!@#'" 1 --vms "!@#"
run_test "VM_COUNT glob wildcard '*'" 1 --vms "*"
run_test "VM_COUNT shell inject '1; rm -rf /'" 1 --vms "1; rm -rf /"
run_test "VM_COUNT alphanumeric '1a'" 1 --vms "1a"
run_test "VM_COUNT hex notation '0x10'" 1 --vms "0x10"
run_test "VM_COUNT leading/trailing spaces ' 3 '" 1 --vms " 3 "
run_test "VM_COUNT 64-bit overflow '9999999999999999999999999'" 1 --vms "9999999999999999999999999"

echo -e "\n--- Category 2: VM_COUNT Numeric Bounds ---"
run_test "VM_COUNT negative '-1'" 1 --vms "-1"
run_test "VM_COUNT zero '0'" 1 --vms "0"
run_test "VM_COUNT lower bound '1'" 0 --vms "1"
run_test "VM_COUNT mid-range '3'" 0 --vms "3"
run_test "VM_COUNT upper bound '16'" 0 --vms "16"
run_test "VM_COUNT upper bound + 1 '17'" 1 --vms "17"
run_test "VM_COUNT large integer '100'" 1 --vms "100"

echo -e "\n--- Category 3: GATEWAY_PORT Non-Integer & Bounds ---"
run_test "GATEWAY_PORT string 'abc'" 1 --gateway-port "abc"
run_test "GATEWAY_PORT float '50051.5'" 1 --gateway-port "50051.5"
run_test "GATEWAY_PORT empty string ''" 1 --gateway-port ""
run_test "GATEWAY_PORT zero '0'" 1 --gateway-port "0"
run_test "GATEWAY_PORT negative '-1'" 1 --gateway-port "-1"
run_test "GATEWAY_PORT valid standard '50051'" 0 --gateway-port "50051"
run_test "GATEWAY_PORT lower bound '1'" 0 --gateway-port "1"
run_test "GATEWAY_PORT upper bound '65535'" 0 --gateway-port "65535"
run_test "GATEWAY_PORT upper bound + 1 '65536'" 1 --gateway-port "65536"
run_test "GATEWAY_PORT out-of-range '70000'" 1 --gateway-port "70000"
run_test "GATEWAY_PORT 64-bit overflow '9999999999999999999999999'" 1 --gateway-port "9999999999999999999999999"

echo -e "\n--- Category 4: CLUSTER_NAME Bounds & Invariants ---"
run_test "CLUSTER_NAME valid standard 'frostfire-prod'" 0 --cluster-name "frostfire-prod"
run_test "CLUSTER_NAME empty string ''" 1 --cluster-name ""
run_test "CLUSTER_NAME whitespace only '   '" 1 --cluster-name "   "
run_test "CLUSTER_NAME underscore 'cluster_prod'" 1 --cluster-name "cluster_prod"
run_test "CLUSTER_NAME special chars 'cluster@123'" 1 --cluster-name "cluster@123"

echo -e "\n=========================================================="
echo "Summary: Total: ${TOTAL} | Passed: ${PASSED} | Failed: ${FAILED}"
echo "=========================================================="

exit ${FAILED}
