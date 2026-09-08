#!/usr/bin/env bash
set -u

TEST_VALUES=(
  "abc"
  "3.5"
  ""
  "!@#"
  "1a"
  "0x10"
  "0"
  "-1"
  "1"
  "16"
  "17"
  " "
  "100"
)

echo "=== Testing VM_COUNT boundary inputs ==="
for val in "${TEST_VALUES[@]}"; do
  output=$(bash scripts/setup-cluster.sh --vms "$val" --dry-run 2>&1)
  ec=$?
  printf "Input: %-8s | ExitCode: %d | " "'$val'" "$ec"
  if [ $ec -eq 0 ]; then
    echo "Result: ALLOWED (Exit 0)"
  else
    echo "Result: REJECTED (Exit $ec)"
  fi
done
