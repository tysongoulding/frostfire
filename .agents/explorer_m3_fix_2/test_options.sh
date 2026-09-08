#!/usr/bin/env bash
set -euo pipefail

test_port_b() {
  local port="$1"
  if ! [[ "${port}" =~ ^[0-9]{1,5}$ ]] || (( 10#${port} < 1 || 10#${port} > 65535 )); then
    return 1
  fi
  return 0
}

for input in "abc" "3.5" "" " " "0" "-1" "65536" "70000" "9999999999999999999999999" "1" "80" "50051" "65535" "050051"; do
  res="PASS"
  test_port_b "${input}" 2>/dev/null || res="FAIL"
  echo "Port '${input}': ${res}"
done
