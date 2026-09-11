#!/usr/bin/env bash
set -euo pipefail

# Frostfire Host Environment Bootstrap for AWS EC2 (Ubuntu 24.04 LTS with Nested KVM)

echo "============================================================"
echo ">>> Bootstrapping Frostfire Host Environment (Phase 1 POC)"
echo "============================================================"

# 1. Verify KVM Hardware Virtualization Support
if [ ! -e /dev/kvm ]; then
  echo "[-] ERROR: /dev/kvm not found! Ensure your EC2 Nitro instance has nested virtualization enabled."
  exit 1
fi
echo "[+] KVM virtualization device found (/dev/kvm)."
sudo usermod -aG kvm "$USER" || true
sudo chmod 666 /dev/kvm

# 2. Update Package Index & Install Base Dependencies
echo ">>> Installing host system toolchains and dependencies..."
sudo apt-get update && sudo apt-get install -y \
  build-essential \
  curl \
  wget \
  git \
  debootstrap \
  qemu-utils \
  e2fsprogs \
  iptables \
  iproute2 \
  pkg-config \
  libssl-dev \
  protobuf-compiler \
  libprotobuf-dev \
  flex \
  bison \
  libelf-dev \
  bc \
  jq \
  net-tools

# 3. Enable Linux IP Forwarding for Guest TAP NAT
echo ">>> Configuring host kernel networking..."
sudo sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.d/99-frostfire.conf > /dev/null

# 4. Install Official Firecracker Hypervisor Release
FIRECRACKER_VER="v1.10.1"
ARCH="$(uname -m)"
echo ">>> Downloading Firecracker release ${FIRECRACKER_VER} for ${ARCH}..."
curl -sSL "https://github.com/firecracker-microvm/firecracker/releases/download/${FIRECRACKER_VER}/firecracker-${FIRECRACKER_VER}-${ARCH}.tgz" -o /tmp/firecracker.tgz
tar -xzf /tmp/firecracker.tgz -C /tmp/
sudo mv "/tmp/release-${FIRECRACKER_VER}-${ARCH}/firecracker-${FIRECRACKER_VER}-${ARCH}" /usr/local/bin/firecracker
sudo mv "/tmp/release-${FIRECRACKER_VER}-${ARCH}/jailer-${FIRECRACKER_VER}-${ARCH}" /usr/local/bin/jailer
sudo chmod +x /usr/local/bin/firecracker /usr/local/bin/jailer
rm -rf /tmp/firecracker* "/tmp/release-${FIRECRACKER_VER}-${ARCH}"
echo "[+] Firecracker binary installed to /usr/local/bin/firecracker:"
/usr/local/bin/firecracker --version

# 5. Install Rust Toolchain
if ! command -v cargo >/dev/null 2>&1; then
  echo ">>> Installing Rust stable toolchain..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi
echo "[+] Rust toolchain active: $(rustc --version)"

# 6. Install Node.js 20+ LTS
if ! command -v node >/dev/null 2>&1; then
  echo ">>> Installing Node.js 20+ LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "[+] Node.js active: $(node --version)"

# 7. Configure Auto-Idle Shutdown Cron Daemon
echo ">>> Setting up auto-idle shutdown protection..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo cp "${SCRIPT_DIR}/check-idle-shutdown.sh" /usr/local/bin/check-idle-shutdown.sh
sudo chmod +x /usr/local/bin/check-idle-shutdown.sh

CRON_JOB="*/5 * * * * /usr/local/bin/check-idle-shutdown.sh"
(crontab -l 2>/dev/null | grep -v "check-idle-shutdown.sh" || true; echo "${CRON_JOB}") | crontab -
echo "[+] Auto-idle cron scheduled every 5 minutes."

echo "============================================================"
echo ">>> Frostfire Host Environment Setup Complete!"
echo "============================================================"
