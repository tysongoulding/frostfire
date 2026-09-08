#!/usr/bin/env bash

test_port() {
  local p="$1"
  local rejected=0
  if ! [[ "$p" =~ ^[0-9]+$ ]] || [ "${#p}" -gt 5 ] || [ "$p" -lt 1 ] || [ "$p" -gt 65535 ]; then
    rejected=1
  fi
  printf "Port: %-30s -> %s\n" "'$p'" "$([ $rejected -eq 1 ] && echo 'REJECTED' || echo 'ACCEPTED')"
}

echo "=== Comprehensive GATEWAY_PORT tests ==="
test_port "50051"
test_port "1"
test_port "65535"
test_port "0"
test_port "65536"
test_port "70000"
test_port "abc"
test_port "3.5"
test_port ""
test_port "!@#"
test_port "-1"
test_port "9999999999999999999999999"
test_port " 50051 "
