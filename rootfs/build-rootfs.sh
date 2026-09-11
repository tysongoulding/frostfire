#!/usr/bin/env bash
set -euo pipefail

# Frostfire Debian 13 (Trixie) Rootfs Appliance Pipeline
ROOTFS_SIZE_MB=8192
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/build"
ROOTFS_IMG="${BUILD_DIR}/rootfs.ext4"
MOUNT_DIR="/mnt/frostfire-rootfs"

mkdir -p "${BUILD_DIR}"
echo ">>> Creating ${ROOTFS_SIZE_MB}MB blank ext4 rootfs image..."
dd if=/dev/zero of="${ROOTFS_IMG}" bs=1M count="${ROOTFS_SIZE_MB}" status=progress
mkfs.ext4 -F -b 4096 "${ROOTFS_IMG}"

sudo mkdir -p "${MOUNT_DIR}"
sudo mount -o loop "${ROOTFS_IMG}" "${MOUNT_DIR}"

trap 'sudo umount "${MOUNT_DIR}" || true; sudo rm -rf "${MOUNT_DIR}"' EXIT

echo ">>> Running debootstrap (Debian 13 Trixie)..."
sudo debootstrap --arch=amd64 trixie "${MOUNT_DIR}" http://deb.debian.org/debian

echo ">>> Configuring base system & user 'box' inside chroot..."
sudo chroot "${MOUNT_DIR}" /bin/bash -c "
  set -euo pipefail
  export DEBIAN_FRONTEND=noninteractive

  # Hostname & Network
  echo 'frostfire-box' > /etc/hostname
  cat <<EOF > /etc/hosts
127.0.0.1 localhost
127.0.1.1 frostfire-box
EOF

  # Apt sources
  cat <<EOF > /etc/apt/sources.list
deb http://deb.debian.org/debian trixie main contrib non-free non-free-firmware
deb http://security.debian.org/debian-security trixie-security main
EOF

  apt-get update
  apt-get install -y --no-install-recommends \
    xvfb xfwm4 picom x11vnc websockify novnc \
    dbus dbus-x11 xdotool x11-utils x11-xserver-utils \
    curl wget git jq sudo procps net-tools iproute2 ripgrep \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 ca-certificates gnupg \
    python3 python3-pip

  # Install Google Chrome Stable
  wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/trusted.gpg.d/google.gpg
  echo 'deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main' > /etc/apt/sources.list.d/google-chrome.list
  apt-get update
  apt-get install -y google-chrome-stable

  # Create user 'box' (UID 1000)
  if ! id -u box >/dev/null 2>&1; then
    useradd -u 1000 -m -s /bin/bash box
    echo 'box:box' | chpasswd
    echo 'box ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/box
  fi

  # Generate deterministic machine-id
  dbus-uuidgen > /etc/machine-id
  cp /etc/machine-id /var/lib/dbus/machine-id
"

echo ">>> Injecting Frostfire scripts and daemons from repository..."
sudo mkdir -p "${MOUNT_DIR}/usr/local/bin" "${MOUNT_DIR}/exec-daemon" "${MOUNT_DIR}/home/box/frostfire-host" "${MOUNT_DIR}/usr/local/share"

if [ -d "${ROOT_DIR}/usr-local-bin" ]; then
  sudo cp -r "${ROOT_DIR}/usr-local-bin/"* "${MOUNT_DIR}/usr/local/bin/"
  sudo chmod +x "${MOUNT_DIR}/usr/local/bin/"*
fi

if [ -d "${ROOT_DIR}/exec-daemon" ]; then
  sudo cp -r "${ROOT_DIR}/exec-daemon/"* "${MOUNT_DIR}/exec-daemon/"
fi

if [ -d "${ROOT_DIR}/home-box/frostfire-host" ]; then
  sudo cp -r "${ROOT_DIR}/home-box/frostfire-host/"* "${MOUNT_DIR}/home/box/frostfire-host/"
  sudo ln -sfn /home/box/frostfire-host "${MOUNT_DIR}/home/box/sand-host"
fi

if [ -d "${ROOT_DIR}/usr-local-share" ]; then
  sudo cp -r "${ROOT_DIR}/usr-local-share/"* "${MOUNT_DIR}/usr/local/share/"
fi

echo ">>> Injecting Google Chrome enterprise policies..."
if [ -d "${ROOT_DIR}/etc-policies/policies/managed" ]; then
  sudo mkdir -p "${MOUNT_DIR}/etc/opt/chrome/policies/managed"
  sudo cp "${ROOT_DIR}/etc-policies/policies/managed/"*.json "${MOUNT_DIR}/etc/opt/chrome/policies/managed/"
fi

echo ">>> Setting ownership for /home/box..."
sudo chroot "${MOUNT_DIR}" chown -R box:box /home/box /exec-daemon

echo ">>> Rootfs appliance build completed successfully: ${ROOTFS_IMG}"
