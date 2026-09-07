#!/usr/bin/env bash
# Host setup script for vanilla AWS EC2 bare metal instance (c6i.metal, Ubuntu 24.04 LTS)
# Installs official AWS Firecracker release, configures KVM, TAP devices, and NAT.

set -euo pipefail

FIRECRACKER_VERSION="v1.10.1"
ARCH="$(uname -m)"

echo "=== 1. Validating KVM Hardware Acceleration ==="
if [ ! -e /dev/kvm ]; then
  echo "[-] Error: /dev/kvm not found. Ensure you are running on an EC2 bare metal (.metal) or nested-virt instance." >&2
  exit 1
fi
sudo chmod 666 /dev/kvm
echo "[✓] /dev/kvm available and accessible."

echo "=== 2. Installing Official AWS Firecracker Binaries ==="
TMP_DIR="$(mktemp -d)"
curl -fsSL "https://github.com/firecracker-microvm/firecracker/releases/download/${FIRECRACKER_VERSION}/firecracker-${FIRECRACKER_VERSION}-${ARCH}.tgz" | tar -xz -C "${TMP_DIR}"
sudo install -m 755 "${TMP_DIR}/release-${FIRECRACKER_VERSION}-${ARCH}/firecracker-${FIRECRACKER_VERSION}-${ARCH}" /usr/local/bin/firecracker
sudo install -m 755 "${TMP_DIR}/release-${FIRECRACKER_VERSION}-${ARCH}/jailer-${FIRECRACKER_VERSION}-${ARCH}" /usr/local/bin/jailer
rm -rf "${TMP_DIR}"
echo "[✓] Installed firecracker $(firecracker --version | head -n1) to /usr/local/bin/firecracker"

echo "=== 3. Setting Up Vanilla TAP Networking & iptables NAT ==="
# Enable IPv4 forwarding
sudo sysctl -w net.ipv4.ip_forward=1 > /dev/null

# Primary outbound physical interface
PRIMARY_IFACE="$(ip -o route get 1.1.1.1 | awk '{print $5}')"

setup_tap() {
  local TAP_NAME="$1"
  local HOST_IP="$2"

  if ! ip link show "${TAP_NAME}" > /dev/null 2>&1; then
    sudo ip tuntap add dev "${TAP_NAME}" mode tap user "${USER}"
    sudo ip addr add "${HOST_IP}/24" dev "${TAP_NAME}"
    sudo ip link set dev "${TAP_NAME}" up
    echo "[+] Configured ${TAP_NAME} with host IP ${HOST_IP}/24"
  fi
}

# 3 TAP interfaces for 3 microVMs (User 1, User 2, User 3)
setup_tap "tap0" "172.16.0.1"
setup_tap "tap1" "172.16.1.1"
setup_tap "tap2" "172.16.2.1"

# NAT MASQUERADE for outbound internet traffic
sudo iptables -t nat -C POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE 2>/dev/null || \
  sudo iptables -t nat -A POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE

sudo iptables -C FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
  sudo iptables -A FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

for TAP in tap0 tap1 tap2; do
  sudo iptables -C FORWARD -i "${TAP}" -o "${PRIMARY_IFACE}" -j ACCEPT 2>/dev/null || \
    sudo iptables -A FORWARD -i "${TAP}" -o "${PRIMARY_IFACE}" -j ACCEPT
done

echo "[✓] Host networking initialized: tap0, tap1, tap2 routed via ${PRIMARY_IFACE} with NAT."
