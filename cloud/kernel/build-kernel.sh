#!/usr/bin/env bash
set -euo pipefail

# Frostfire Monolithic Linux 6.12 Kernel Build Pipeline for Firecracker
# Produces an uncompressed monolithic ELF binary (vmlinux) with CONFIG_MODULES=n
# and all required VirtIO, filesystem, cgroup v2, namespace, entropy, and networking drivers in-tree.

KERNEL_VER="${KERNEL_VER:-6.12.6}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KERNEL_CONFIG="${ROOT_DIR}/kernel/kernel.config"
WORKDIR="${ROOT_DIR}/build/kernel"
OUT_DIR="${ROOT_DIR}/build/kernel/out"
VMLINUX_OUT="${OUT_DIR}/vmlinux-${KERNEL_VER}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Frostfire Monolithic Kernel Build Pipeline (Linux ${KERNEL_VER})

Options:
  --config-only     Extract kernel source, merge kernel.config, and verify .config assertions only
  --verify-binary   Run post-compilation binary verification assertions on existing vmlinux
  -h, --help        Show this help message and exit

Default (no arguments):
  Execute the complete pipeline: download, extract, configure, verify config,
  compile monolithic vmlinux, copy to ${VMLINUX_OUT}, and run binary verification assertions.
EOF
}

verify_kernel_config() {
  local config_file="$1"
  echo "============================================================"
  echo ">>> Verifying Kernel Configuration Assertions: ${config_file}"
  echo "============================================================"

  if [ ! -f "${config_file}" ]; then
    echo "[-] FAILED ASSERTION: Configuration file not found: ${config_file}" >&2
    return 1
  fi

  # Assertion 1: Pure monolithic build — module support must be strictly disabled
  if grep -q '^CONFIG_MODULES=y' "${config_file}"; then
    echo "[-] FAILED ASSERTION: CONFIG_MODULES=y is enabled! Kernel must be monolithic." >&2
    return 1
  fi
  if ! grep -q '# CONFIG_MODULES is not set' "${config_file}" && ! grep -q '^CONFIG_MODULES=n' "${config_file}"; then
    echo "[-] FAILED ASSERTION: CONFIG_MODULES is not disabled in ${config_file}!" >&2
    return 1
  fi
  echo "[+] Assertion Passed: CONFIG_MODULES is disabled (monolithic)."

  # Assertion 2: All required static in-tree driver and subsystem symbols
  local required_symbols=(
    # Core Architecture & KVM
    CONFIG_64BIT
    CONFIG_X86_64
    CONFIG_SMP
    CONFIG_KVM_GUEST
    # VirtIO Drivers (MMIO & PCI)
    CONFIG_VIRTIO
    CONFIG_VIRTIO_PCI
    CONFIG_VIRTIO_MMIO
    CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES
    CONFIG_VIRTIO_BLK
    CONFIG_VIRTIO_NET
    CONFIG_VIRTIO_VSOCK
    CONFIG_VSOCKETS
    CONFIG_VIRTIO_CONSOLE
    CONFIG_VIRTIO_BALLOON
    # Serial Console & PTY
    CONFIG_SERIAL_8250
    CONFIG_SERIAL_8250_CONSOLE
    CONFIG_PRINTK
    CONFIG_TTY
    CONFIG_UNIX98_PTYS
    # Filesystems
    CONFIG_EXT4_FS
    CONFIG_EXT4_FS_POSIX_ACL
    CONFIG_EXT4_FS_SECURITY
    CONFIG_OVERLAY_FS
    CONFIG_FUSE_FS
    CONFIG_DEVTMPFS
    CONFIG_DEVTMPFS_MOUNT
    # Networking & IP Bootline Autoconfig
    CONFIG_NET
    CONFIG_INET
    CONFIG_IP_PNP
    CONFIG_IP_PNP_DHCP
    CONFIG_IP_PNP_BOOTP
    # Cgroups v2 & Scheduler
    CONFIG_CGROUPS
    CONFIG_CGROUP_SCHED
    CONFIG_FAIR_GROUP_SCHED
    CONFIG_CFS_BANDWIDTH
    CONFIG_CGROUP_PIDS
    CONFIG_MEMCG
    CONFIG_CPUSETS
    # Namespaces
    CONFIG_NAMESPACES
    CONFIG_USER_NS
    CONFIG_NET_NS
    CONFIG_PID_NS
    CONFIG_IPC_NS
    CONFIG_UTS_NS
    CONFIG_CGROUP_NS
    # Hardware RNG & Entropy
    CONFIG_HW_RANDOM
    CONFIG_HW_RANDOM_VIRTIO
    CONFIG_RANDOM_TRUST_CPU
    # Security & Seccomp
    CONFIG_SECURITY
    CONFIG_SECCOMP
    CONFIG_SECCOMP_FILTER
  )

  local missing_count=0
  for sym in "${required_symbols[@]}"; do
    if ! grep -q "^${sym}=y" "${config_file}"; then
      echo "[-] FAILED ASSERTION: Required symbol '${sym}=y' is missing in ${config_file}!" >&2
      missing_count=$((missing_count + 1))
    fi
  done

  if [ "${missing_count}" -ne 0 ]; then
    echo "[-] Configuration assertion failure: ${missing_count} required symbol(s) missing or inactive." >&2
    return 1
  fi

  echo "[+] Assertion Passed: All ${#required_symbols[@]} required static configuration symbols verified active (=y)."
  return 0
}

verify_monolithic_binary() {
  local binary_path="$1"
  local src_tree="${2:-.}"
  echo "============================================================"
  echo ">>> Verifying Monolithic Binary Assertions: ${binary_path}"
  echo "============================================================"

  # Assertion 1: Output binary existence and non-empty size
  if [ ! -f "${binary_path}" ]; then
    echo "[-] FAILED ASSERTION: Binary does not exist at ${binary_path}!" >&2
    return 1
  fi
  if [ ! -s "${binary_path}" ]; then
    echo "[-] FAILED ASSERTION: Binary at ${binary_path} is 0 bytes!" >&2
    return 1
  fi
  echo "[+] Assertion Passed: Binary exists and is non-empty."

  # Assertion 2: ELF Magic header (7F 45 4C 46)
  local magic_bytes
  magic_bytes="$(od -An -N 4 -t x1 "${binary_path}" 2>/dev/null | tr -d ' \n\r\t')"
  if [ "${magic_bytes}" != "7f454c46" ]; then
    echo "[-] FAILED ASSERTION: Binary lacks ELF magic header (got '${magic_bytes}', expected '7f454c46')!" >&2
    return 1
  fi
  echo "[+] Assertion Passed: Valid ELF magic header confirmed (0x7F 'E' 'L' 'F')."

  # Assertion 3: ELF 64-bit architecture validation via file utility
  if command -v file >/dev/null 2>&1; then
    local file_type
    file_type="$(file -b "${binary_path}")"
    echo "[+] File inspection: ${file_type}"
    if ! echo "${file_type}" | grep -q "ELF 64-bit"; then
      echo "[-] FAILED ASSERTION: ${binary_path} is not an ELF 64-bit binary!" >&2
      exit 1
    fi
    echo "[+] Assertion Passed: ELF 64-bit format confirmed by file utility."
  fi

  # Assertion 4: Machine architecture validation via readelf
  if command -v readelf >/dev/null 2>&1; then
    local elf_class elf_machine
    elf_class="$(readelf -h "${binary_path}" 2>/dev/null | awk '/Class:/ {print $2}')"
    elf_machine="$(readelf -h "${binary_path}" 2>/dev/null | awk -F: '/Machine:/ {gsub(/^[ \t]+/, "", $2); print $2}')"
    if [ "${elf_class}" != "ELF64" ]; then
      echo "[-] FAILED ASSERTION: readelf reports class '${elf_class}' (expected 'ELF64')!" >&2
      return 1
    fi
    if ! echo "${elf_machine}" | grep -qiE "(x86-64|x86_64|Advanced Micro Devices)"; then
      echo "[-] FAILED ASSERTION: readelf reports machine '${elf_machine}' (expected x86-64)!" >&2
      return 1
    fi
    echo "[+] Assertion Passed: readelf verified ELF64 architecture (${elf_machine})."
  fi

  # Assertion 5: Monolithic assertion — zero loadable kernel modules (.ko)
  if [ -d "${src_tree}" ]; then
    local ko_count
    ko_count="$(find "${src_tree}" -name "*.ko" 2>/dev/null | wc -l || echo 0)"
    if [ "${ko_count}" -ne 0 ]; then
      echo "[-] FAILED ASSERTION: Found ${ko_count} loadable kernel module(s) (.ko)! Monolithic build must have 0." >&2
      return 1
    fi
    echo "[+] Assertion Passed: Monolithic build verified (0 loadable kernel modules generated)."
  fi

  local bin_size
  bin_size="$(wc -c < "${binary_path}" | tr -d ' ')"
  echo "============================================================"
  echo ">>> Binary Verification Succeeded: ${binary_path} (${bin_size} bytes)"
  echo "============================================================"
  return 0
}

# Main execution flow
MODE="full"
if [ $# -gt 0 ]; then
  case "$1" in
    --config-only)
      MODE="config-only"
      ;;
    --verify-binary)
      TARGET_BIN="${2:-${VMLINUX_OUT}}"
      verify_monolithic_binary "${TARGET_BIN}" "${WORKDIR}/linux-${KERNEL_VER}"
      exit $?
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[-] Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
fi

# Step 1: Validate kernel configuration template exists
if [ ! -f "${KERNEL_CONFIG}" ]; then
  echo "[-] ERROR: Deterministic kernel configuration template not found at ${KERNEL_CONFIG}!" >&2
  exit 1
fi
echo "[+] Using deterministic kernel configuration template: ${KERNEL_CONFIG}"

# Step 2: Prepare workspace directories
mkdir -p "${WORKDIR}" "${OUT_DIR}"
cd "${WORKDIR}"

# Step 3: Fetch and extract Linux kernel source
TARBALL="linux-${KERNEL_VER}.tar.xz"
SOURCE_DIR="linux-${KERNEL_VER}"

if [ ! -f "${TARBALL}" ]; then
  echo ">>> Downloading Linux kernel ${KERNEL_VER}..."
  curl -fSL "https://cdn.kernel.org/pub/linux/kernel/v6.x/${TARBALL}" -o "${TARBALL}"
fi

if [ ! -d "${SOURCE_DIR}" ]; then
  echo ">>> Extracting kernel source..."
  tar -xf "${TARBALL}"
fi

cd "${SOURCE_DIR}"

# Step 4: Apply base defconfig and merge deterministic template
echo ">>> Generating x86_64 base defconfig..."
make defconfig

echo ">>> Merging deterministic Firecracker configuration from ${KERNEL_CONFIG}..."
if [ -f "scripts/kconfig/merge_config.sh" ]; then
  chmod +x scripts/kconfig/merge_config.sh
  scripts/kconfig/merge_config.sh -m .config "${KERNEL_CONFIG}"
else
  cat "${KERNEL_CONFIG}" >> .config
fi

# Enforce modules disabled in canonical Kconfig format
if [ -f "scripts/config" ]; then
  chmod +x scripts/config
  scripts/config --disable CONFIG_MODULES
fi

echo ">>> Reconciling configuration dependencies (make olddefconfig)..."
make olddefconfig

# Step 5: Verify configuration assertions
verify_kernel_config .config

if [ "${MODE}" = "config-only" ]; then
  echo ">>> Config-only verification successful. Exiting without compilation."
  exit 0
fi

# Step 6: Compile monolithic vmlinux
NPROC="$(nproc 2>/dev/null || echo 4)"
echo ">>> Compiling monolithic vmlinux across ${NPROC} cores..."
make -j"${NPROC}" vmlinux

if [ ! -f "vmlinux" ]; then
  echo "[-] ERROR: Compilation finished but vmlinux binary was not produced!" >&2
  exit 1
fi

echo ">>> Copying vmlinux to target output: ${VMLINUX_OUT}..."
cp vmlinux "${VMLINUX_OUT}"

# Step 7: Post-compilation binary verification assertions
verify_monolithic_binary "${VMLINUX_OUT}" "."

echo "============================================================"
echo ">>> Frostfire Monolithic Linux 6.12 Kernel Build Complete!"
echo ">>> Binary Output: ${VMLINUX_OUT}"
echo "============================================================"
