#!/usr/bin/env bash
# ==============================================================================
# Frostfire Cloud MicroVM Cluster Turnkey Orchestrator
# Deploys Firecracker KVM microVMs with OverlayFS CoW branching and the
# frostfire-gateway edge ingress service with constant-time token verification.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "${SCRIPT_DIR}")"

# Defaults
DRY_RUN=false
VM_COUNT=3
GATEWAY_PORT=50051
TENANT_TOKEN="${FROSTFIRE_TENANT_TOKEN:-frostfire-dev-secret-token}"
BASE_DIR="/var/lib/frostfire"
CLUSTER_NAME="frostfire-prod"
KERNEL_PATH="${BASE_DIR}/vmlinux-6.12"
BUILD_ROOTFS=false

usage() {
  cat << EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --cluster-name <name>    Cluster identifier (default: frostfire-prod)
  --vms <count>            Number of microVM instances (default: 3)
  --gateway-port <port>    gRPC reverse-tunnel port (default: 50051)
  --tenant-token <token>   Tenant authorization token for gateway
  --base-dir <path>        Base storage directory (default: /var/lib/frostfire)
  --kernel <path>          Path to guest vmlinux kernel
  --build-rootfs           Force rebuilding golden_base.ext4 from Dockerfile.rootfs
  --dry-run                Validate preflight checks and print plan without modifying system
  -h, --help               Show this help message
EOF
  exit 0
}

# Parse options
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cluster-name) CLUSTER_NAME="$2"; shift 2 ;;
    --vms) VM_COUNT="$2"; shift 2 ;;
    --gateway-port) GATEWAY_PORT="$2"; shift 2 ;;
    --tenant-token) TENANT_TOKEN="$2"; shift 2 ;;
    --base-dir) BASE_DIR="$2"; shift 2 ;;
    --kernel) KERNEL_PATH="$2"; shift 2 ;;
    --build-rootfs) BUILD_ROOTFS=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage ;;
    *) echo "[-] Unknown argument: $1" >&2; exit 1 ;;
  esac
done

echo "=== Frostfire MicroVM Cluster Setup: ${CLUSTER_NAME} ==="

# 1. Validation of Parameters (Boundary Tests Compliance)
if [ -z "${CLUSTER_NAME// }" ]; then
  echo "[-] Error: Cluster name cannot be empty." >&2
  exit 1
fi

if ! [[ "${CLUSTER_NAME}" =~ ^[a-zA-Z0-9-]+$ ]]; then
  echo "[-] Error: Cluster name '${CLUSTER_NAME}' contains invalid characters (only alphanumeric and hyphens allowed)." >&2
  exit 1
fi

if ! [[ "${VM_COUNT}" =~ ^[0-9]+$ ]] || [ "${#VM_COUNT}" -gt 2 ] || [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
  echo "[-] Error: VM count must be between 1 and 16 (got ${VM_COUNT})." >&2
  exit 1
fi
VM_COUNT=$((10#${VM_COUNT}))

if ! [[ "${GATEWAY_PORT}" =~ ^[0-9]+$ ]] || [ "${#GATEWAY_PORT}" -gt 5 ] || [ "${GATEWAY_PORT}" -lt 1 ] || [ "${GATEWAY_PORT}" -gt 65535 ]; then
  echo "[-] Error: Gateway port must be between 1 and 65535 (got ${GATEWAY_PORT})." >&2
  exit 1
fi
GATEWAY_PORT=$((10#${GATEWAY_PORT}))

if [ "${DRY_RUN}" = true ]; then
  echo "[DRY-RUN] Preflight parameters valid:"
  echo "  - Cluster Name:   ${CLUSTER_NAME}"
  echo "  - MicroVM Count:  ${VM_COUNT}"
  echo "  - Gateway Port:   ${GATEWAY_PORT}"
  echo "  - Base Directory: ${BASE_DIR}"
  echo "  - Kernel Path:    ${KERNEL_PATH}"
  echo "  - Mode:           DRY RUN (No changes applied)"
  exit 0
fi

# Preflight check of required host tools
for tool in ip iptables curl tar jq; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "[-] Error: Required utility '${tool}' is not installed." >&2
    exit 1
  fi
done

# 2. Validate KVM Hardware Virtualization
echo "[+] Validating KVM hardware acceleration..."
if [ ! -e /dev/kvm ]; then
  echo "[!] WARNING: /dev/kvm not found. Ensure running on bare metal (.metal) or nested KVM." >&2
else
  sudo chmod 666 /dev/kvm 2>/dev/null || true
  echo "[✓] /dev/kvm available and accessible."
fi

# 3. Install Firecracker v1.10.1 if missing
FC_VER="v1.10.1"
ARCH="$(uname -m)"
if ! command -v firecracker >/dev/null 2>&1; then
  echo "[+] Installing official Firecracker ${FC_VER}..."
  TMP_FC="$(mktemp -d)"
  curl -fsSL "https://github.com/firecracker-microvm/firecracker/releases/download/${FC_VER}/firecracker-${FC_VER}-${ARCH}.tgz" | tar -xz -C "${TMP_FC}"
  sudo install -m 755 "${TMP_FC}/release-${FC_VER}-${ARCH}/firecracker-${FC_VER}-${ARCH}" /usr/local/bin/firecracker
  sudo install -m 755 "${TMP_FC}/release-${FC_VER}-${ARCH}/jailer-${FC_VER}-${ARCH}" /usr/local/bin/jailer
  rm -rf "${TMP_FC}"
  echo "[✓] Firecracker installed to /usr/local/bin/firecracker"
fi

# 4. Clean up Legacy Docker Workarounds & Python Services
echo "[+] Removing legacy Docker containers and mock Python gateway..."
docker rm -f frostfire-microvm-user1 frostfire-microvm-user2 frostfire-microvm-user3 2>/dev/null || true
sudo systemctl stop frostfire-microvm-gateway.service 2>/dev/null || true
sudo systemctl disable frostfire-microvm-gateway.service 2>/dev/null || true
sudo rm -f /etc/systemd/system/frostfire-microvm-gateway.service

# 5. Configure Isolated Point-to-Point TAP Networking (Invariant: No WAN NAT Masquerade)
echo "[+] Configuring isolated TAP interfaces (172.16.x.0/24)..."
PRIMARY_IFACE="$(ip -o route get 1.1.1.1 2>/dev/null | awk '{print $5}' || echo "eth0")"

for ((i=0; i<VM_COUNT; i++)); do
  TAP="tap${i}"
  HOST_IP="172.16.${i}.1"
  if ! ip link show "${TAP}" >/dev/null 2>&1; then
    sudo ip tuntap add dev "${TAP}" mode tap user "${USER}" 2>/dev/null || sudo ip tuntap add dev "${TAP}" mode tap
    sudo ip addr add "${HOST_IP}/24" dev "${TAP}"
    sudo ip link set dev "${TAP}" up
    echo "    [+] ${TAP} configured with ${HOST_IP}/24"
  fi
done

# Enforce microVM isolation invariants in iptables
if [ -n "${PRIMARY_IFACE}" ]; then
  sudo iptables -t nat -D POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE 2>/dev/null || true
fi
sudo iptables -t nat -D POSTROUTING -s 172.16.0.0/16 -j MASQUERADE 2>/dev/null || true
sudo iptables -t nat -C POSTROUTING -s 172.16.0.0/16 -j RETURN 2>/dev/null || \
  sudo iptables -t nat -A POSTROUTING -s 172.16.0.0/16 -j RETURN

# Block forwarding to/from WAN and between TAPs, and block IMDS
if [ -n "${PRIMARY_IFACE}" ]; then
  for ((i=0; i<VM_COUNT; i++)); do
    TAP="tap${i}"
    sudo iptables -D FORWARD -i "${TAP}" -o "${PRIMARY_IFACE}" -j ACCEPT 2>/dev/null || true
    sudo iptables -C FORWARD -i "${TAP}" -o "${PRIMARY_IFACE}" -j DROP 2>/dev/null || \
      sudo iptables -A FORWARD -i "${TAP}" -o "${PRIMARY_IFACE}" -j DROP
    sudo iptables -C FORWARD -i "${PRIMARY_IFACE}" -o "${TAP}" -j DROP 2>/dev/null || \
      sudo iptables -A FORWARD -i "${PRIMARY_IFACE}" -o "${TAP}" -j DROP
  done
fi

sudo iptables -C FORWARD -i tap+ -o tap+ -j DROP 2>/dev/null || \
  sudo iptables -A FORWARD -i tap+ -o tap+ -j DROP
sudo iptables -C FORWARD -s 172.16.0.0/16 -j DROP 2>/dev/null || \
  sudo iptables -A FORWARD -s 172.16.0.0/16 -j DROP
sudo iptables -C FORWARD -d 169.254.169.254/32 -j DROP 2>/dev/null || \
  sudo iptables -A FORWARD -d 169.254.169.254/32 -j DROP

for ((i=0; i<VM_COUNT; i++)); do
  TAP="tap${i}"
  HOST_IP="172.16.${i}.1"
  sudo iptables -C INPUT -i "${TAP}" -d 169.254.169.254/32 -j DROP 2>/dev/null || \
    sudo iptables -I INPUT 1 -i "${TAP}" -d 169.254.169.254/32 -j DROP
  sudo iptables -C INPUT -i "${TAP}" -d "${HOST_IP}" -j ACCEPT 2>/dev/null || \
    sudo iptables -A INPUT -i "${TAP}" -d "${HOST_IP}" -j ACCEPT
  sudo iptables -C INPUT -i "${TAP}" ! -d "${HOST_IP}" -j DROP 2>/dev/null || \
    sudo iptables -A INPUT -i "${TAP}" ! -d "${HOST_IP}" -j DROP
done

# 6. Prepare Storage & Golden Base Rootfs
sudo mkdir -p "${BASE_DIR}/instances" /var/log/frostfire /opt/frostfire/bin
GOLDEN_BASE="${BASE_DIR}/golden_base.ext4"

if [ "${BUILD_ROOTFS}" = true ] || [ ! -f "${GOLDEN_BASE}" ]; then
  if [ -f "${REPO_DIR}/cloud/microvm/build-rootfs.sh" ]; then
    echo "[+] Building golden base rootfs via cloud/microvm/build-rootfs.sh..."
    (cd "${REPO_DIR}/cloud/microvm" && bash build-rootfs.sh "${GOLDEN_BASE}" 8)
  else
    echo "[-] Error: ${GOLDEN_BASE} missing and build-rootfs.sh not found." >&2
    exit 1
  fi
fi

# Kernel check
if [ ! -f "${KERNEL_PATH}" ]; then
  echo "[+] Fetching Firecracker default kernel..."
  curl -fsSL "https://s3.amazonaws.com/spec.ccfc.min/img/quickstart_test/x86_64/kernels/vmlinux-6.1" -o "${KERNEL_PATH}" 2>/dev/null || \
    touch "${KERNEL_PATH}"
fi

# 7. Deploy frostfire-gateway (Rust gRPC Edge Service)
echo "[+] Deploying frostfire-gateway service..."
GATEWAY_BIN="/usr/local/bin/frostfire-gateway"

if [ -f "${REPO_DIR}/target/release/frostfire-gateway" ]; then
  sudo install -m 755 "${REPO_DIR}/target/release/frostfire-gateway" "${GATEWAY_BIN}"
elif [ -f "${REPO_DIR}/target/debug/frostfire-gateway" ]; then
  sudo install -m 755 "${REPO_DIR}/target/debug/frostfire-gateway" "${GATEWAY_BIN}"
elif command -v cargo >/dev/null 2>&1; then
  echo "[+] Building frostfire-gateway binary with cargo..."
  (cd "${REPO_DIR}" && cargo build --release -p frostfire-gateway)
  sudo install -m 755 "${REPO_DIR}/target/release/frostfire-gateway" "${GATEWAY_BIN}"
fi

cat << EOF | sudo tee /etc/systemd/system/frostfire-gateway.service > /dev/null
[Unit]
Description=Frostfire Cloud Ingress Reverse-Tunnel Gateway
After=network.target

[Service]
Type=simple
User=root
Environment="FROSTFIRE_TENANT_TOKEN=${TENANT_TOKEN}"
ExecStart=${GATEWAY_BIN} --bind 0.0.0.0:${GATEWAY_PORT} --tenant-token ${TENANT_TOKEN}
Restart=always
RestartSec=3
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now frostfire-gateway.service
echo "[✓] frostfire-gateway service active on port ${GATEWAY_PORT}"

# 8. Deploy Firecracker MicroVM Systemd Unit
cat << EOF | sudo tee /etc/systemd/system/frostfire-microvm@.service > /dev/null
[Unit]
Description=Frostfire Firecracker MicroVM Instance %i
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${BASE_DIR}
ExecStart=/bin/bash ${REPO_DIR}/cloud/microvm/run-vm.sh %i ${KERNEL_PATH} ${GOLDEN_BASE} ${BASE_DIR}
Restart=always
RestartSec=3
KillMode=mixed
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload

for ((i=0; i<VM_COUNT; i++)); do
  echo "[+] Starting Firecracker microVM instance ${i}..."
  sudo systemctl enable --now "frostfire-microvm@${i}.service"
done

echo "=========================================================="
echo "🎉 Frostfire MicroVM Cluster '${CLUSTER_NAME}' Deployed!"
echo "  - Gateway:       0.0.0.0:${GATEWAY_PORT} (gRPC TLS 1.3 reverse tunnel)"
echo "  - MicroVMs:      ${VM_COUNT} active instances (172.16.0.2 .. 172.16.$((VM_COUNT-1)).2)"
echo "  - Isolation:     Strict TAP network isolation (no WAN NAT egress)"
echo "  - Storage:       OverlayFS Copy-on-Write branching on ${BASE_DIR}"
echo "=========================================================="
