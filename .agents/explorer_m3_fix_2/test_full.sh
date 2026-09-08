#!/usr/bin/env bash
set -euo pipefail

validate() {
  local VM_COUNT="$1"
  local GATEWAY_PORT="$2"

  if ! [[ "${VM_COUNT}" =~ ^[0-9]+$ ]] || [ "${#VM_COUNT}" -gt 2 ] || [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
    echo "[-] Error: VM count must be between 1 and 16 (got ${VM_COUNT})." >&2
    return 1
  fi
  VM_COUNT=$((10#${VM_COUNT}))

  if ! [[ "${GATEWAY_PORT}" =~ ^[0-9]+$ ]] || [ "${#GATEWAY_PORT}" -gt 5 ] || [ "${GATEWAY_PORT}" -lt 1 ] || [ "${GATEWAY_PORT}" -gt 65535 ]; then
    echo "[-] Error: Gateway port must be between 1 and 65535 (got ${GATEWAY_PORT})." >&2
    return 1
  fi
  GATEWAY_PORT=$((10#${GATEWAY_PORT}))

  echo "SUCCESS: vms=${VM_COUNT}, port=${GATEWAY_PORT}"
  return 0
}

echo "=== Testing VM_COUNT validation ==="
for v in "abc" "3.5" "" " " "0" "-1" "17" "9999999999999999999999999" "1" "8" "08" "16"; do
  echo -n "VM_COUNT='${v}': "
  if validate "${v}" "50051" 2>/dev/null; then
    echo "PASS"
  else
    echo "REJECTED"
  fi
done

echo "=== Testing GATEWAY_PORT validation ==="
for p in "abc" "3.5" "" " " "0" "-1" "65536" "70000" "9999999999999999999999999" "1" "80" "50051" "65535"; do
  echo -n "GATEWAY_PORT='${p}': "
  if validate "3" "${p}" 2>/dev/null; then
    echo "PASS"
  else
    echo "REJECTED"
  fi
done
