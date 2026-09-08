#!/usr/bin/env bash

test_val() {
  local v="$1"
  local rejected=0

  # Check validation method
  # If length check or regex:
  if ! [[ "$v" =~ ^[0-9]+$ ]] || [ "${#v}" -gt 2 ] || [ "$v" -lt 1 ] || [ "$v" -gt 16 ]; then
    rejected=1
  fi
  printf "%-30s -> %s\n" "'$v'" "$([ $rejected -eq 1 ] && echo 'REJECTED' || echo 'ACCEPTED')"
}

echo "=== Comprehensive VM_COUNT tests ==="
test_val "abc"
test_val "3.5"
test_val ""
test_val "!@#"
test_val "1a"
test_val "0x10"
test_val " "
test_val "0"
test_val "-1"
test_val "1"
test_val "16"
test_val "17"
test_val "100"
test_val "9999999999999999999999999"
test_val "01"
test_val "08"
test_val "016"
test_val "-0"
test_val "+1"
test_val "1\n2"
test_val " 1 "
test_val "$(echo -e '1\x002')"
