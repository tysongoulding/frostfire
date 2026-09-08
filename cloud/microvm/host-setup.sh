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

echo "=== 3. Setting Up Isolated TAP Networking (172.16.x.0/24) ==="
# Enable IPv4 forwarding
sudo sysctl -w net.ipv4.ip_forward=1 > /dev/null

# Primary outbound physical interface
PRIMARY_IFACE="$(ip -o route get 1.1.1.1 2>/dev/null | awk '{print $5}' || echo "eth0")"

setup_tap() {
  local TAP_NAME="$1"
  local HOST_IP="$2"

  if ! ip link show "${TAP_NAME}" > /dev/null 2>&1; then
    sudo ip tuntap add dev "${TAP_NAME}" mode tap user "${USER}" 2>/dev/null || sudo ip tuntap add dev "${TAP_NAME}" mode tap
    sudo ip addr add "${HOST_IP}/24" dev "${TAP_NAME}"
    sudo ip link set dev "${TAP_NAME}" up
    echo "[+] Configured ${TAP_NAME} with host IP ${HOST_IP}/24"
  fi
}

# 3 TAP interfaces for 3 microVMs (User 1, User 2, User 3)
setup_tap "tap0" "172.16.0.1"
setup_tap "tap1" "172.16.1.1"
setup_tap "tap2" "172.16.2.1"

# -----------------------------------------------------------------------------
# MicroVM Network Isolation Invariant Enforcement (AGENTS.md / ORIGINAL_REQUEST §R3)
# Invariant: Guest microVMs run on isolated subnets (172.16.x.0/24) with NO direct
# public internet access (NO NAT MASQUERADE) and NO cross-tenant forwarding.
# All egress is strictly outbound-only reverse-tunnel traffic via frostfire-gateway.
# -----------------------------------------------------------------------------

echo "=== 4. Enforcing Strict MicroVM Network Isolation ==="

# 1. Purge legacy or accidental NAT MASQUERADE rules
if [ -n "${PRIMARY_IFACE}" ]; then
  sudo iptables -t nat -D POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE 2>/dev/null || true
fi
sudo iptables -t nat -D POSTROUTING -s 172.16.0.0/16 -j MASQUERADE 2>/dev/null || true

# Explicitly ensure microVM subnets are NEVER translated
sudo iptables -t nat -C POSTROUTING -s 172.16.0.0/16 -j RETURN 2>/dev/null || \
  sudo iptables -t nat -A POSTROUTING -s 172.16.0.0/16 -j RETURN

# 2. Block direct WAN forwarding in both directions
if [ -n "${PRIMARY_IFACE}" ]; then
  for TAP in tap0 tap1 tap2; do
    sudo iptables -D FORWARD -i "${TAP}" -o "${PRIMARY_IFACE}" -j ACCEPT 2>/dev/null || true
    sudo iptables -C FORWARD -i "${TAP}" -o "${PRIMARY_IFACE}" -j DROP 2>/dev/null || \
      sudo iptables -A FORWARD -i "${TAP}" -o "${PRIMARY_IFACE}" -j DROP
    sudo iptables -C FORWARD -i "${PRIMARY_IFACE}" -o "${TAP}" -j DROP 2>/dev/null || \
      sudo iptables -A FORWARD -i "${PRIMARY_IFACE}" -o "${TAP}" -j DROP
  done
fi

# 3. Block cross-tenant lateral movement between microVMs
sudo iptables -C FORWARD -i tap+ -o tap+ -j DROP 2>/dev/null || \
  sudo iptables -A FORWARD -i tap+ -o tap+ -j DROP

# 4. Drop any forwarded packets originating from the 172.16.0.0/16 range
sudo iptables -C FORWARD -s 172.16.0.0/16 -j DROP 2>/dev/null || \
  sudo iptables -A FORWARD -s 172.16.0.0/16 -j DROP

# 5. Prevent guest microVMs from accessing AWS Instance Metadata Service (IMDS)
sudo iptables -C FORWARD -d 169.254.169.254/32 -j DROP 2>/dev/null || \
  sudo iptables -A FORWARD -d 169.254.169.254/32 -j DROP

# 6. Host INPUT filtering: guests may ONLY talk to their own 172.16.x.1 gateway
for i in 0 1 2; do
  TAP="tap${i}"
  HOST_IP="172.16.${i}.1"

  # Block IMDS targeting on the host interface
  sudo iptables -C INPUT -i "${TAP}" -d 169.254.169.254/32 -j DROP 2>/dev/null || \
    sudo iptables -I INPUT 1 -i "${TAP}" -d 169.254.169.254/32 -j DROP

  # Allow communication directed strictly to the guest's assigned gateway IP
  sudo iptables -C INPUT -i "${TAP}" -d "${HOST_IP}" -j ACCEPT 2>/dev/null || \
    sudo iptables -A INPUT -i "${TAP}" -d "${HOST_IP}" -j ACCEPT

  # Drop any other destination (e.g. host's public IP, other TAP IPs)
  sudo iptables -C INPUT -i "${TAP}" ! -d "${HOST_IP}" -j DROP 2>/dev/null || \
    sudo iptables -A INPUT -i "${TAP}" ! -d "${HOST_IP}" -j DROP
done

echo "[✓] Isolated network bridge configured: tap0, tap1, tap2 strictly isolated (172.16.x.0/24, no NAT, WAN egress blocked)."
