#!/usr/bin/env bash
set -euo pipefail

test_vms_2c() {
  local val="$1"
  if ! [[ "${val}" =~ ^[1-9][0-9]?$ ]] || [ "${val}" -gt 16 ]; then
    return 1
  fi
  return 0
}

test_port_2c() {
  local val="$1"
  if ! [[ "${val}" =~ ^[1-9][0-9]{0,4}$ ]] || [ "${val}" -gt 65535 ]; then
    return 1
  fi
  return 0
}

echo "Testing 2C VMs:"
for v in "abc" "3.5" "" " " "0" "-1" "17" "9999999999999999999999999" "1" "8" "08" "16"; do
  res="PASS"
  test_vms_2c "${v}" 2>/dev/null || res="FAIL"
  echo "VM '${v}': ${res}"
done

echo ""
echo "Testing 2C Port:"
for p in "abc" "3.5" "" " " "0" "-1" "65536" "70000" "9999999999999999999999999" "1" "80" "50051" "65535" "050051"; do
  res="PASS"
  test_port_2c "${p}" 2>/dev/null || res="FAIL"
  echo "Port '${p}': ${res}"
done
