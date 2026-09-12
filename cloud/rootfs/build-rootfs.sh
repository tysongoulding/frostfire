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

cleanup() {
  local exit_code=$?
  echo ">>> Cleaning up mounts and temporary build artifacts..."
  set +e
  if [ -f "${MOUNT_DIR}/usr/sbin/policy-rc.d" ]; then
    sudo rm -f "${MOUNT_DIR}/usr/sbin/policy-rc.d" 2>/dev/null || true
  fi
  for mp in "${MOUNT_DIR}/dev/pts" "${MOUNT_DIR}/dev" "${MOUNT_DIR}/sys" "${MOUNT_DIR}/proc"; do
    if mountpoint -q "${mp}" 2>/dev/null; then
      sudo umount -l "${mp}" 2>/dev/null || true
    fi
  done
  if mountpoint -q "${MOUNT_DIR}" 2>/dev/null; then
    sudo sync 2>/dev/null || true
    sudo umount -l "${MOUNT_DIR}" 2>/dev/null || true
  fi
  if [ -d "${MOUNT_DIR}" ]; then
    sudo rm -rf "${MOUNT_DIR}" 2>/dev/null || true
  fi
  exit "${exit_code}"
}
trap 'sudo umount "${MOUNT_DIR}" || true; cleanup' EXIT
trap cleanup ERR INT TERM

echo ">>> Running debootstrap (Debian 13 Trixie)..."
sudo debootstrap --arch=amd64 trixie "${MOUNT_DIR}" http://deb.debian.org/debian

echo ">>> Mounting virtual filesystems for chroot (/proc, /sys, /dev, /dev/pts)..."
sudo mount -t proc proc "${MOUNT_DIR}/proc"
sudo mount -t sysfs sys "${MOUNT_DIR}/sys"
sudo mount --bind /dev "${MOUNT_DIR}/dev"
sudo mount --bind /dev/pts "${MOUNT_DIR}/dev/pts"

echo ">>> Setting up policy-rc.d guard to prevent service autostart in chroot..."
sudo tee "${MOUNT_DIR}/usr/sbin/policy-rc.d" > /dev/null << 'EOF'
#!/bin/sh
exit 101
EOF
sudo chmod +x "${MOUNT_DIR}/usr/sbin/policy-rc.d"

echo ">>> Configuring base system & user 'box' inside chroot..."
sudo tee "${MOUNT_DIR}/tmp/chroot-setup.sh" > /dev/null << 'CHROOT_EOF'
#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# Hostname & Network
echo 'frostfire-box' > /etc/hostname
cat << 'EOF' > /etc/hosts
127.0.0.1 localhost
127.0.1.1 frostfire-box
EOF

# Static network interfaces
mkdir -p /etc/network
cat << 'EOF' > /etc/network/interfaces
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet static
    address 172.30.0.2
    netmask 255.255.255.0
    gateway 172.30.0.1
    dns-nameservers 8.8.8.8 1.1.1.1
EOF

# Systemd network configuration for eth0
mkdir -p /etc/systemd/network
cat << 'EOF' > /etc/systemd/network/10-eth0.network
[Match]
Name=eth0

[Network]
Address=172.30.0.2/24
Gateway=172.30.0.1
DNS=8.8.8.8
DNS=1.1.1.1
EOF

# Static resolv.conf (Google DNS 8.8.8.8)
rm -f /etc/resolv.conf
cat << 'EOF' > /etc/resolv.conf
nameserver 8.8.8.8
nameserver 1.1.1.1
EOF

# Apt sources for Debian 13 (Trixie)
cat << 'EOF' > /etc/apt/sources.list
deb http://deb.debian.org/debian trixie main contrib non-free non-free-firmware
deb http://security.debian.org/debian-security trixie-security main
EOF

echo ">>> Updating APT packages in chroot..."
apt-get update
apt-get install -y --no-install-recommends \
  xvfb xfwm4 picom x11vnc websockify novnc \
  plank hsetroot dconf-cli fuse3 libfuse2t64 \
  dbus dbus-x11 xdotool x11-utils x11-xserver-utils \
  curl wget git jq sudo procps net-tools iproute2 ripgrep \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 libasound2 ca-certificates gnupg \
  python3 python3-pip util-linux

# Install Google Chrome Stable
echo ">>> Installing Google Chrome Stable..."
mkdir -p /etc/apt/keyrings /etc/apt/trusted.gpg.d
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg
cp /etc/apt/keyrings/google-chrome.gpg /etc/apt/trusted.gpg.d/google.gpg
echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main' > /etc/apt/sources.list.d/google-chrome.list
apt-get update
apt-get install -y --no-install-recommends google-chrome-stable

# Create user 'box' (UID 1000, GID 1000)
echo ">>> Creating user 'box' (UID 1000, GID 1000)..."
if ! id -u box >/dev/null 2>&1; then
  groupadd -g 1000 box 2>/dev/null || true
  useradd -u 1000 -g 1000 -m -s /bin/bash box 2>/dev/null || useradd -u 1000 -m -s /bin/bash box
  echo 'box:box' | chpasswd
  usermod -aG sudo box 2>/dev/null || true
fi

# Passwordless sudo with chmod 0440
mkdir -p /etc/sudoers.d
echo 'box ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/box
chmod 0440 /etc/sudoers.d/box

# Generate deterministic machine-id
echo ">>> Generating deterministic machine-id..."
dbus-uuidgen > /etc/machine-id
mkdir -p /var/lib/dbus
cp /etc/machine-id /var/lib/dbus/machine-id
chmod 0444 /etc/machine-id /var/lib/dbus/machine-id

# Enable systemd-networkd
systemctl enable systemd-networkd.service 2>/dev/null || true

CHROOT_EOF

sudo chmod +x "${MOUNT_DIR}/tmp/chroot-setup.sh"
sudo chroot "${MOUNT_DIR}" /bin/bash /tmp/chroot-setup.sh
sudo rm -f "${MOUNT_DIR}/tmp/chroot-setup.sh"

echo ">>> Injecting Frostfire scripts and daemons from repository..."
if [ -d "${ROOT_DIR}/usr-local-bin" ]; then
  echo ">>> Injecting usr-local-bin utilities..."
  sudo mkdir -p "${MOUNT_DIR}/usr/local/bin"
  sudo cp -r "${ROOT_DIR}/usr-local-bin/"* "${MOUNT_DIR}/usr/local/bin/"
  sudo chmod +x "${MOUNT_DIR}/usr/local/bin/"*
fi

if [ -d "${ROOT_DIR}/usr-local-share" ]; then
  echo ">>> Injecting usr-local-share assets..."
  sudo mkdir -p "${MOUNT_DIR}/usr/local/share"
  sudo cp -r "${ROOT_DIR}/usr-local-share/"* "${MOUNT_DIR}/usr/local/share/"
fi

if [ -d "${ROOT_DIR}/exec-daemon" ]; then
  echo ">>> Injecting exec-daemon bundle..."
  sudo mkdir -p "${MOUNT_DIR}/exec-daemon"
  sudo cp -r "${ROOT_DIR}/exec-daemon/"* "${MOUNT_DIR}/exec-daemon/"

  # Recombine split binary: exec-daemon/node
  if ls "${MOUNT_DIR}/exec-daemon/node.part."* >/dev/null 2>&1; then
    echo ">>> Recombining split binary exec-daemon/node..."
    sudo bash -c "cat '${MOUNT_DIR}/exec-daemon/node.part.'* > '${MOUNT_DIR}/exec-daemon/node'"
    sudo chmod +x "${MOUNT_DIR}/exec-daemon/node"
  fi

  # Recombine split binary: exec-daemon/tools/origin
  if ls "${MOUNT_DIR}/exec-daemon/tools/origin.part."* >/dev/null 2>&1; then
    echo ">>> Recombining split binary exec-daemon/tools/origin..."
    sudo bash -c "cat '${MOUNT_DIR}/exec-daemon/tools/origin.part.'* > '${MOUNT_DIR}/exec-daemon/tools/origin'"
    sudo chmod +x "${MOUNT_DIR}/exec-daemon/tools/origin"
  fi

  if [ -f "${MOUNT_DIR}/exec-daemon/exec-daemon" ]; then
    sudo chmod +x "${MOUNT_DIR}/exec-daemon/exec-daemon"
  fi
  if [ -f "${MOUNT_DIR}/exec-daemon/rg" ]; then
    sudo chmod +x "${MOUNT_DIR}/exec-daemon/rg"
  fi
  if [ -f "${MOUNT_DIR}/exec-daemon/gh" ]; then
    sudo chmod +x "${MOUNT_DIR}/exec-daemon/gh"
  fi
fi

if [ -d "${ROOT_DIR}/home-box" ]; then
  echo ">>> Injecting entire home-box/ tree to /home/box/..."
  sudo mkdir -p "${MOUNT_DIR}/home/box"
  sudo cp -a "${ROOT_DIR}/home-box/." "${MOUNT_DIR}/home/box/"
  for item in "${ROOT_DIR}/home-box"/* "${ROOT_DIR}/home-box"/.*; do
    basename_item="$(basename "${item}")"
    if [ "${basename_item}" != "." ] && [ "${basename_item}" != ".." ] && [ -e "${item}" ]; then
      sudo cp -a "${item}" "${MOUNT_DIR}/home/box/"
    fi
  done
  if [ -d "${ROOT_DIR}/home-box/frostfire-host" ]; then
    sudo cp -r "${ROOT_DIR}/home-box/frostfire-host/"* "${MOUNT_DIR}/home/box/frostfire-host/"
    sudo ln -sfn /home/box/frostfire-host "${MOUNT_DIR}/home/box/sand-host"
  fi
fi

# Ensure /workspace exists for agent tasks
sudo mkdir -p "${MOUNT_DIR}/workspace"

if [ -d "${ROOT_DIR}/usr-share-backgrounds" ]; then
  echo ">>> Injecting wallpaper backgrounds..."
  sudo mkdir -p "${MOUNT_DIR}/usr/share/backgrounds"
  sudo cp -r "${ROOT_DIR}/usr-share-backgrounds/"* "${MOUNT_DIR}/usr/share/backgrounds/"
  sudo chmod 644 "${MOUNT_DIR}/usr/share/backgrounds/"*
fi

echo ">>> Injecting Chrome policies and native messaging hosts..."
if [ -d "${ROOT_DIR}/etc-policies/native-messaging-hosts" ]; then
  sudo mkdir -p "${MOUNT_DIR}/etc/opt/chrome/native-messaging-hosts" "${MOUNT_DIR}/etc/chromium/native-messaging-hosts"
  sudo cp -r "${ROOT_DIR}/etc-policies/native-messaging-hosts/"* "${MOUNT_DIR}/etc/opt/chrome/native-messaging-hosts/"
  sudo cp -r "${ROOT_DIR}/etc-policies/native-messaging-hosts/"* "${MOUNT_DIR}/etc/chromium/native-messaging-hosts/"
  sudo chmod 644 "${MOUNT_DIR}/etc/opt/chrome/native-messaging-hosts/"* "${MOUNT_DIR}/etc/chromium/native-messaging-hosts/"*
fi

if [ -d "${ROOT_DIR}/etc-policies/policies/managed" ]; then
  sudo mkdir -p "${MOUNT_DIR}/etc/opt/chrome/policies/managed" "${MOUNT_DIR}/etc/chromium/policies/managed"
  sudo cp -r "${ROOT_DIR}/etc-policies/policies/managed/"* "${MOUNT_DIR}/etc/opt/chrome/policies/managed/"
  sudo cp -r "${ROOT_DIR}/etc-policies/policies/managed/"* "${MOUNT_DIR}/etc/chromium/policies/managed/"
  sudo chmod 644 "${MOUNT_DIR}/etc/opt/chrome/policies/managed/"* "${MOUNT_DIR}/etc/chromium/policies/managed/"*
fi

echo ">>> Installing and enabling /etc/systemd/system/frostfire-box.service..."
sudo tee "${MOUNT_DIR}/etc/systemd/system/frostfire-box.service" > /dev/null << 'EOF'
[Unit]
Description=Frostfire MicroVM Autonomous Agent & Desktop Supervisor
After=network-online.target dbus.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/workspace
Environment=HOME=/root
Environment=SAND_USER_NON_ROOT=1
ExecStart=/usr/local/bin/start-frostfire-box
Restart=always
RestartSec=3
StandardOutput=journal+console
StandardError=journal+console

[Install]
WantedBy=multi-user.target
Alias=frostfire.service
EOF
sudo chmod 644 "${MOUNT_DIR}/etc/systemd/system/frostfire-box.service"

sudo mkdir -p "${MOUNT_DIR}/etc/systemd/system/multi-user.target.wants"
sudo ln -sf /etc/systemd/system/frostfire-box.service "${MOUNT_DIR}/etc/systemd/system/multi-user.target.wants/frostfire-box.service"
sudo ln -sf /etc/systemd/system/frostfire-box.service "${MOUNT_DIR}/etc/systemd/system/frostfire.service"
sudo chroot "${MOUNT_DIR}" systemctl enable frostfire-box.service 2>/dev/null || true

echo ">>> Setting ownership for /home/box, /exec-daemon, and /workspace..."
sudo chroot "${MOUNT_DIR}" chown -R box:box /home/box /exec-daemon /workspace

echo ">>> Finalizing and unmounting rootfs appliance..."
sudo rm -f "${MOUNT_DIR}/usr/sbin/policy-rc.d"

for mp in "${MOUNT_DIR}/dev/pts" "${MOUNT_DIR}/dev" "${MOUNT_DIR}/sys" "${MOUNT_DIR}/proc"; do
  if mountpoint -q "${mp}" 2>/dev/null; then
    sudo umount "${mp}" 2>/dev/null || sudo umount -l "${mp}" 2>/dev/null || true
  fi
done

sudo sync

if mountpoint -q "${MOUNT_DIR}" 2>/dev/null; then
  sudo umount "${MOUNT_DIR}" 2>/dev/null || sudo umount -l "${MOUNT_DIR}" 2>/dev/null || true
fi

sudo rm -rf "${MOUNT_DIR}" 2>/dev/null || true
trap - EXIT ERR INT TERM

echo ">>> Rootfs appliance build completed successfully: ${ROOTFS_IMG}"
