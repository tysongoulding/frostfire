#!/usr/bin/env bash
# Runs a Firecracker microVM instance with OverlayFS Copy-on-Write branching.
# Usage: ./run-vm.sh <vm_index_or_id> [vmlinux_path] [golden_base_path] [base_dir]

set -euo pipefail

VM_INDEX="${1:-0}"
KERNEL="${2:-/var/lib/frostfire/vmlinux-6.12}"
BASE_DIR="${4:-/var/lib/frostfire}"
GOLDEN_BASE="${3:-${BASE_DIR}/golden_base.ext4}"

# Guard against empty or path-traversal instance IDs
if [ -z "${VM_INDEX}" ] || [[ "${VM_INDEX}" == *".."* ]]; then
  echo "[-] Error: Invalid instance ID '${VM_INDEX}' (must not be empty or contain '..')" >&2
  exit 1
fi

INSTANCE_ID="vm-${VM_INDEX}"
INSTANCE_DIR="${BASE_DIR}/instances/${INSTANCE_ID}"
UPPER_DIR="${INSTANCE_DIR}/upper"
WORK_DIR="${INSTANCE_DIR}/work"
OVERLAY_IMG="${INSTANCE_DIR}/overlay.ext4"

# Fallback to rootfs.ext4 if golden_base.ext4 does not exist
if [ ! -f "${GOLDEN_BASE}" ] && [ -f "${BASE_DIR}/rootfs.ext4" ]; then
  GOLDEN_BASE="${BASE_DIR}/rootfs.ext4"
fi

TAP_NAME="tap${VM_INDEX}"
GUEST_IP="172.16.${VM_INDEX}.2"
MASK="255.255.255.0"
GATEWAY="172.16.${VM_INDEX}.1"
GUEST_MAC="AA:FC:00:00:00:0${VM_INDEX}"

SOCKET="/tmp/firecracker-${VM_INDEX}.socket"
LOG_FILE="/tmp/firecracker-${VM_INDEX}.log"

# Cleanup trap on termination
cleanup() {
  echo "[+] Cleaning up MicroVM ${INSTANCE_ID} resources..."
  if [ -n "${FC_PID:-}" ] && kill -0 "${FC_PID}" 2>/dev/null; then
    kill -TERM "${FC_PID}" 2>/dev/null || true
    wait "${FC_PID}" 2>/dev/null || true
  fi
  rm -f "${SOCKET}"
  echo "[✓] Teardown complete for ${INSTANCE_ID}."
}
trap cleanup EXIT INT TERM

# Ensure instance directories exist
mkdir -p "${UPPER_DIR}" "${WORK_DIR}"

# Initialize volatile sparse overlay ext4 image if missing (sub-5ms instantiation)
if [ ! -f "${OVERLAY_IMG}" ]; then
  fallocate -l 10G "${OVERLAY_IMG}" 2>/dev/null || truncate -s 10G "${OVERLAY_IMG}" 2>/dev/null || true
  mkfs.ext4 -F -b 4096 -q "${OVERLAY_IMG}" 2>/dev/null || true
fi

rm -f "${SOCKET}"

echo "[+] Starting Firecracker API listener on ${SOCKET}..."
firecracker --api-sock "${SOCKET}" > "${LOG_FILE}" 2>&1 &
FC_PID=$!

# Wait for socket to appear
for _ in {1..20}; do
  [ -S "${SOCKET}" ] && break
  sleep 0.05
done

if [ ! -S "${SOCKET}" ]; then
  echo "[-] Error: Firecracker socket ${SOCKET} failed to open." >&2
  exit 1
fi

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
  \"boot_args\": \"console=ttyS0 reboot=k panic=1 pci=off ip=${GUEST_IP}::${GATEWAY}:${MASK}::eth0:off root=/dev/vda ro init=/usr/local/bin/init-overlay\"
}"

echo "[+] Configuring Golden Base Rootfs Drive (${GOLDEN_BASE}) as Read-Only..."
fc_curl PUT "drives/rootfs" "{
  \"drive_id\": \"rootfs\",
  \"path_on_host\": \"${GOLDEN_BASE}\",
  \"is_root_device\": true,
  \"is_read_only\": true
}"

echo "[+] Configuring Volatile CoW Overlay Drive (${OVERLAY_IMG}) as Read-Write..."
fc_curl PUT "drives/overlay" "{
  \"drive_id\": \"overlay\",
  \"path_on_host\": \"${OVERLAY_IMG}\",
  \"is_root_device\": false,
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
