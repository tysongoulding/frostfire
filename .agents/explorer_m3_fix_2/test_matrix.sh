#!/usr/bin/env bash
set -euo pipefail

# Strategy 1: Literal Extension
strat1_vms() {
  local VM_COUNT="$1"
  if ! [[ "${VM_COUNT}" =~ ^[0-9]+$ ]] || [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
    return 1
  fi
  return 0
}

strat1_port() {
  local GATEWAY_PORT="$1"
  if ! [[ "${GATEWAY_PORT}" =~ ^[0-9]+$ ]] || [ "${GATEWAY_PORT}" -lt 1 ] || [ "${GATEWAY_PORT}" -gt 65535 ]; then
    return 1
  fi
  return 0
}

# Strategy 2: Length Guard + Decimal Normalization
strat2_vms() {
  local VM_COUNT="$1"
  if ! [[ "${VM_COUNT}" =~ ^[0-9]+$ ]] || [ "${#VM_COUNT}" -gt 2 ] || [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
    return 1
  fi
  VM_COUNT=$((10#${VM_COUNT}))
  return 0
}

strat2_port() {
  local GATEWAY_PORT="$1"
  if ! [[ "${GATEWAY_PORT}" =~ ^[0-9]+$ ]] || [ "${#GATEWAY_PORT}" -gt 5 ] || [ "${GATEWAY_PORT}" -lt 1 ] || [ "${GATEWAY_PORT}" -gt 65535 ]; then
    return 1
  fi
  GATEWAY_PORT=$((10#${GATEWAY_PORT}))
  return 0
}

# Strategy 3: Bounded Non-Zero Leading Regex
strat3_vms() {
  local VM_COUNT="$1"
  if ! [[ "${VM_COUNT}" =~ ^[1-9][0-9]?$ ]] || [ "${VM_COUNT}" -gt 16 ]; then
    return 1
  fi
  return 0
}

strat3_port() {
  local GATEWAY_PORT="$1"
  if ! [[ "${GATEWAY_PORT}" =~ ^[1-9][0-9]{0,4}$ ]] || [ "${GATEWAY_PORT}" -gt 65535 ]; then
    return 1
  fi
  return 0
}

echo "=== VM_COUNT Test Matrix ==="
printf "%-25s | %-10s | %-10s | %-10s\n" "Input" "Strat 1" "Strat 2" "Strat 3"
printf "%s\n" "-------------------------------------------------------------"

vms_cases=("abc" "3.5" "" " " "0" "-1" "1" "3" "8" "08" "16" "17" "100" "9999999999999999999999999")

for tc in "${vms_cases[@]}"; do
  # Run in subshells with 2>/dev/null to check pass/fail
  s1="PASS"; strat1_vms "${tc}" 2>/dev/null || s1="FAIL"
  s2="PASS"; strat2_vms "${tc}" 2>/dev/null || s2="FAIL"
  s3="PASS"; strat3_vms "${tc}" 2>/dev/null || s3="FAIL"
  printf "%-25s | %-10s | %-10s | %-10s\n" "'${tc}'" "${s1}" "${s2}" "${s3}"
done

echo ""
echo "=== GATEWAY_PORT Test Matrix ==="
printf "%-25s | %-10s | %-10s | %-10s\n" "Input" "Strat 1" "Strat 2" "Strat 3"
printf "%s\n" "-------------------------------------------------------------"

port_cases=("abc" "3.5" "" " " "0" "-1" "1" "80" "50051" "050051" "65535" "65536" "70000" "100000" "9999999999999999999999999")

for tc in "${port_cases[@]}"; do
  s1="PASS"; strat1_port "${tc}" 2>/dev/null || s1="FAIL"
  s2="PASS"; strat2_port "${tc}" 2>/dev/null || s2="FAIL"
  s3="PASS"; strat3_port "${tc}" 2>/dev/null || s3="FAIL"
  printf "%-25s | %-10s | %-10s | %-10s\n" "'${tc}'" "${s1}" "${s2}" "${s3}"
done
