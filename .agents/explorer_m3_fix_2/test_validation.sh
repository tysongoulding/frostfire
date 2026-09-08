#!/usr/bin/env bash
set -euo pipefail

VM_COUNT="9999999999999999999999999"
if ! [[ "${VM_COUNT}" =~ ^[0-9]+$ ]] || [ "${#VM_COUNT}" -gt 2 ] || [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
  echo "CAUGHT!"
else
  echo "BYPASSED!"
fi
