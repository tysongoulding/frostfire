#!/usr/bin/env bash
# Build script: compiles Dockerfile.rootfs and exports it into a bootable ext4 disk image.
# Usage: ./build-rootfs.sh [output_image_path] [disk_size_gb]

set -euo pipefail

OUTPUT_IMG="${1:-rootfs.ext4}"
DISK_SIZE_GB="${2:-8}"
TMP_CONTAINER="frostfire-rootfs-export-$$"

echo "=== 1. Building Docker Rootfs Image ==="
docker build -f Dockerfile.rootfs -t frostfire-microvm-rootfs:latest .

echo "=== 2. Creating Sparse ext4 Disk Image (${DISK_SIZE_GB} GB) ==="
fallocate -l "${DISK_SIZE_GB}G" "${OUTPUT_IMG}"
mkfs.ext4 -F -b 4096 "${OUTPUT_IMG}"

echo "=== 3. Exporting Container Filesystem to ext4 ==="
MOUNT_DIR="$(mktemp -d)"
sudo mount -o loop "${OUTPUT_IMG}" "${MOUNT_DIR}"

docker create --name "${TMP_CONTAINER}" frostfire-microvm-rootfs:latest
docker export "${TMP_CONTAINER}" | sudo tar -x -C "${MOUNT_DIR}"
docker rm "${TMP_CONTAINER}"

echo "=== 4. Unmounting and Finalizing ==="
sudo umount "${MOUNT_DIR}"
rm -rf "${MOUNT_DIR}"

e2fsck -fy "${OUTPUT_IMG}" || true
echo "[✓] Bootable Firecracker rootfs ready at ${OUTPUT_IMG}"
