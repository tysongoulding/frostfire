#!/usr/bin/env bash
# Runs a vanilla Firecracker microVM instance using the official Unix Domain Socket REST API.
# Usage: ./run-vm.sh <vm_id_or_user_index 0|1|2> [vmlinux_path] [rootfs_path]

set -euo pipefail

VM_INDEX="${1:-0}"
KERNEL="${2:-/var/lib/frostfire/vmlinux-6.12}"
ROOTFS="${3:-/var/lib/frostfire/rootfs.ext4}"

TAP_NAME="tap${VM_INDEX}"
GUEST_IP="172.16.${VM_INDEX}.2"
MASK="255.255.255.0"
GATEWAY="172.16.${VM_INDEX}.1"
GUEST_MAC="AA:FC:00:00:00:0${VM_INDEX}"

SOCKET="/tmp/firecracker-${VM_INDEX}.socket"
rm -f "${SOCKET}"

echo "[+] Starting Firecracker API listener on ${SOCKET}..."
firecracker --api-sock "${SOCKET}" > "/tmp/firecracker-${VM_INDEX}.log" 2>&1 &
FC_PID=$!

# Wait for socket to appear
for _ in {1..20}; do
  [ -S "${SOCKET}" ] && break
  sleep 0.05
done

# Helper to send curl requests to socket
fc_curl() {
  local METHOD="$1"
  local ENDPOINT="$2"
  local DATA="${3:-}"
  if [ -n "${DATA}" ]; then
    curl --silent --show-error --unix-socket "${SOCKET}" -X "${METHOD}" "http://localhost/${ENDPOINT}" \
      -H "Content-Type: application/json" -d "${DATA}"
  else
    curl --silent --show-error --unix-socket "${SOCKET}" -X "${METHOD}" "http://localhost/${ENDPOINT}" \
      -H "Content-Type: application/json"
  fi
}

echo "[+] Configuring Boot Source (Kernel: ${KERNEL})..."
fc_curl PUT "boot-source" "{
  \"kernel_image_path\": \"${KERNEL}\",
  \"boot_args\": \"console=ttyS0 reboot=k panic=1 pci=off ip=${GUEST_IP}::${GATEWAY}:${MASK}::eth0:off\"
}"

echo "[+] Configuring Rootfs Drive (${ROOTFS})..."
fc_curl PUT "drives/rootfs" "{
  \"drive_id\": \"rootfs\",
  \"path_on_host\": \"${ROOTFS}\",
  \"is_root_device\": true,
  \"is_read_only\": false
}"

echo "[+] Configuring Network Interface (${TAP_NAME} -> ${GUEST_IP})..."
fc_curl PUT "network-interfaces/eth0" "{
  \"iface_id\": \"eth0\",
  \"guest_mac\": \"${GUEST_MAC}\",
  \"host_dev_name\": \"${TAP_NAME}\"
}"

echo "[+] Configuring Machine Configuration (4 vCPUs, 4096 MB RAM)..."
fc_curl PUT "machine-config" "{
  \"vcpu_count\": 4,
  \"mem_size_mib\": 4096,
  \"smt\": false
}"

echo "[+] Booting Firecracker MicroVM ${VM_INDEX}..."
fc_curl PUT "actions" '{"action_type": "InstanceStart"}'

echo "[✓] MicroVM ${VM_INDEX} running! PID: ${FC_PID}, IP: ${GUEST_IP}"
wait "${FC_PID}"
