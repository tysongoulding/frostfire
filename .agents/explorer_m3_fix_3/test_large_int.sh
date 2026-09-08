#!/usr/bin/env bash
v="9999999999999999999999999"
if ! [[ "$v" =~ ^[0-9]+$ ]] || [ "$v" -lt 1 ] || [ "$v" -gt 16 ]; then
  echo "Rejected"
else
  echo "Bypassed"
fi
