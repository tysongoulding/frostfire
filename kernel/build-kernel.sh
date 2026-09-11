#!/usr/bin/env bash
set -euo pipefail

# Frostfire Monolithic Kernel Build Pipeline (Linux 6.12 for Firecracker)
KERNEL_VER="6.12.6"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="${ROOT_DIR}/build/kernel"
OUT_DIR="${ROOT_DIR}/build/kernel/out"

mkdir -p "${WORKDIR}" "${OUT_DIR}"
cd "${WORKDIR}"

if [ ! -f "linux-${KERNEL_VER}.tar.xz" ]; then
  echo ">>> Downloading Linux kernel ${KERNEL_VER}..."
  curl -LO "https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-${KERNEL_VER}.tar.xz"
  echo ">>> Extracting kernel source..."
  tar -xf "linux-${KERNEL_VER}.tar.xz"
fi

cd "linux-${KERNEL_VER}"

echo ">>> Generating base defconfig..."
make defconfig

echo ">>> Applying monolithic Firecracker kernel parameters (CONFIG_MODULES=n)..."
scripts/config --disable CONFIG_MODULES
scripts/config --enable CONFIG_KVM_GUEST
scripts/config --enable CONFIG_VIRTIO
scripts/config --enable CONFIG_VIRTIO_PCI
scripts/config --enable CONFIG_VIRTIO_MMIO
scripts/config --enable CONFIG_VIRTIO_BALLOON
scripts/config --enable CONFIG_VIRTIO_BLK
scripts/config --enable CONFIG_VIRTIO_NET
scripts/config --enable CONFIG_VIRTIO_VSOCK
scripts/config --enable CONFIG_VSOCKETS
scripts/config --enable CONFIG_VIRTIO_CONSOLE
scripts/config --enable CONFIG_SERIAL_8250
scripts/config --enable CONFIG_SERIAL_8250_CONSOLE
scripts/config --enable CONFIG_EXT4_FS
scripts/config --enable CONFIG_OVERLAY_FS
scripts/config --enable CONFIG_FUSE_FS
scripts/config --enable CONFIG_NET_9P
scripts/config --enable CONFIG_NET_9P_VIRTIO
scripts/config --enable CONFIG_CGROUPS
scripts/config --enable CONFIG_CGROUP_CPUACCT
scripts/config --enable CONFIG_CGROUP_DEVICE
scripts/config --enable CONFIG_CGROUP_FREEZER
scripts/config --enable CONFIG_CGROUP_SCHED
scripts/config --enable CONFIG_CPUSETS
scripts/config --enable CONFIG_MEMCG
scripts/config --enable CONFIG_NAMESPACES
scripts/config --enable CONFIG_USER_NS
scripts/config --enable CONFIG_NET_NS
scripts/config --enable CONFIG_PID_NS
scripts/config --enable CONFIG_IPC_NS
scripts/config --enable CONFIG_UTS_NS
scripts/config --enable CONFIG_SECURITY
scripts/config --enable CONFIG_SECCOMP
scripts/config --enable CONFIG_SECCOMP_FILTER

make olddefconfig

echo ">>> Compiling monolithic vmlinux across $(nproc) cores..."
make -j"$(nproc)" vmlinux

cp vmlinux "${OUT_DIR}/vmlinux-${KERNEL_VER}"
echo ">>> Kernel compilation complete: ${OUT_DIR}/vmlinux-${KERNEL_VER}"
