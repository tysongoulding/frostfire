#!/usr/bin/env bash
# ==============================================================================
# Frostfire Central Gateway — Proxmox VE Host-Level LXC Provisioner
# ==============================================================================
# Run this script directly on your Proxmox VE node shell (via web GUI or SSH)
# to automatically provision a dedicated, lightweight Debian 12 LXC container,
# install the Central Gateway, and launch the systemd service.
# ==============================================================================

set -euo pipefail

# Visual styling
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}${BOLD}>>> Frostfire Central Gateway — Proxmox VE LXC Provisioner${NC}"
echo -e "${CYAN}============================================================${NC}"

# Verify Proxmox VE host environment
if ! command -v pveversion >/dev/null 2>&1; then
    echo -e "${RED}[!] Error: This script must be executed directly on a Proxmox VE host.${NC}"
    echo -e "    If you are running inside a VM or container, run 'install-gateway.sh' instead."
    exit 1
fi

PVE_VER=$(pveversion)
echo -e "[+] Detected Proxmox VE: ${GREEN}${PVE_VER}${NC}"

# Detect or prompt configuration parameters
DEFAULT_ID=$(pvesh get /cluster/nextid 2>/dev/null || echo "250")
CT_ID="${CT_ID:-$DEFAULT_ID}"
CT_NAME="${CT_NAME:-frostfire-gateway}"
CT_CORES="${CT_CORES:-2}"
CT_RAM="${CT_RAM:-2048}"
CT_SWAP="${CT_SWAP:-512}"
CT_DISK="${CT_DISK:-16}"
NET_BRIDGE="${NET_BRIDGE:-vmbr0}"
NET_IP="${NET_IP:-dhcp}"
NET_GW="${NET_GW:-}"

# Detect primary container storage pool
STORAGE_POOL="${STORAGE_POOL:-}"
if [ -z "$STORAGE_POOL" ]; then
    for pool in "local-lvm" "local-zfs" "local"; do
        if pvesm status -storage "$pool" >/dev/null 2>&1; then
            STORAGE_POOL="$pool"
            break
        fi
    done
fi

if [ -z "$STORAGE_POOL" ]; then
    echo -e "${RED}[!] Error: Could not automatically determine a valid Proxmox storage pool.${NC}"
    echo -e "    Please specify STORAGE_POOL=your_pool_name when running."
    exit 1
fi

echo -e "[+] Target Container ID:      ${GREEN}${CT_ID}${NC}"
echo -e "[+] Container Hostname:       ${GREEN}${CT_NAME}${NC}"
echo -e "[+] CPU Cores / RAM:          ${GREEN}${CT_CORES} vCPUs / ${CT_RAM} MB RAM${NC}"
echo -e "[+] Storage Pool / Root Disk: ${GREEN}${STORAGE_POOL} (${CT_DISK} GB)${NC}"
echo -e "[+] Bridge / Network:         ${GREEN}${NET_BRIDGE} (${NET_IP})${NC}"

# 1. Download or verify Debian 12 standard template
echo -e "\n${YELLOW}[1/4] Checking Debian 12 container template...${NC}"
TEMPLATE_STORAGE="local"
pveam update >/dev/null 2>&1 || true

DEBIAN_TEMPLATE=$(pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -o 'debian-12-standard_.*_amd64.tar.zst' | sort -V | tail -n1 || true)

if [ -z "$DEBIAN_TEMPLATE" ]; then
    echo -e "[*] Template not found locally. Downloading Debian 12 standard template..."
    AVAILABLE_TEMPLATE=$(pveam available | grep -o 'debian-12-standard_.*_amd64.tar.zst' | sort -V | tail -n1)
    if [ -z "$AVAILABLE_TEMPLATE" ]; then
        echo -e "${RED}[!] Failed to locate a Debian 12 template in Proxmox appliance repository.${NC}"
        exit 1
    fi
    pveam download "$TEMPLATE_STORAGE" "$AVAILABLE_TEMPLATE"
    DEBIAN_TEMPLATE="$AVAILABLE_TEMPLATE"
fi

TEMPLATE_PATH="${TEMPLATE_STORAGE}:vztmpl/${DEBIAN_TEMPLATE}"
echo -e "[+] Using template: ${GREEN}${TEMPLATE_PATH}${NC}"

# 2. Check if CT_ID already exists
if pct status "$CT_ID" >/dev/null 2>&1; then
    echo -e "${RED}[!] Container ID ${CT_ID} already exists.${NC}"
    echo -e "    Destroy it with 'pct destroy ${CT_ID} --purge' or choose another ID via CT_ID=<id>."
    exit 1
fi

# 3. Create LXC Container
echo -e "\n${YELLOW}[2/4] Creating LXC container ${CT_ID} (${CT_NAME})...${NC}"
NET_CONF="name=eth0,bridge=${NET_BRIDGE},ip=${NET_IP}"
if [ -n "$NET_GW" ] && [ "$NET_IP" != "dhcp" ]; then
    NET_CONF="${NET_CONF},gw=${NET_GW}"
fi

pct create "$CT_ID" "$TEMPLATE_PATH" \
    --hostname "$CT_NAME" \
    --cores "$CT_CORES" \
    --memory "$CT_RAM" \
    --swap "$CT_SWAP" \
    --rootfs "${STORAGE_POOL}:${CT_DISK}" \
    --net0 "$NET_CONF" \
    --ostype debian \
    --unprivileged 1 \
    --features nesting=1,keyctl=1 \
    --onboot 1 \
    --start 0

echo -e "[+] Container ${CT_ID} created successfully."

# 4. Start Container and wait for networking
echo -e "\n${YELLOW}[3/4] Starting container ${CT_ID} and awaiting network...${NC}"
pct start "$CT_ID"

# Wait for IP address assignment
CONTAINER_IP=""
echo -n "[*] Waiting for container IP address..."
for i in $(seq 1 20); do
    sleep 1
    echo -n "."
    CONTAINER_IP=$(pct exec "$CT_ID" -- ip -4 addr show eth0 2>/dev/null | grep inet | awk '{print $2}' | cut -d/ -f1 | head -n1 || true)
    if [ -n "$CONTAINER_IP" ]; then
        break
    fi
done
echo ""

if [ -z "$CONTAINER_IP" ]; then
    echo -e "${YELLOW}[!] Warning: Could not detect container IP address automatically.${NC}"
    CONTAINER_IP="<container_ip>"
else
    echo -e "[+] Container acquired IP: ${GREEN}${CONTAINER_IP}${NC}"
fi

# 5. Transfer and execute in-guest install script
echo -e "\n${YELLOW}[4/4] Installing Frostfire Central Gateway inside container ${CT_ID}...${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER_SRC="${SCRIPT_DIR}/install-gateway.sh"

if [ -f "$INSTALLER_SRC" ]; then
    pct push "$CT_ID" "$INSTALLER_SRC" /tmp/install-gateway.sh
else
    # Fallback to downloading directly inside container
    pct exec "$CT_ID" -- curl -fsSL "https://raw.githubusercontent.com/tysongoulding/frostfire/production/cloud/deploy/proxmox/install-gateway.sh" -o /tmp/install-gateway.sh
fi

pct exec "$CT_ID" -- chmod +x /tmp/install-gateway.sh
pct exec "$CT_ID" -- bash /tmp/install-gateway.sh

echo -e "\n${GREEN}============================================================${NC}"
echo -e "${GREEN}${BOLD}>>> Frostfire Central Gateway LXC Deployment Complete!     ${NC}"
echo -e "${GREEN}============================================================${NC}"
echo -e "Container Details:"
echo -e "  • Container ID:        ${BOLD}${CT_ID}${NC}"
echo -e "  • IP Address:          ${BOLD}${CONTAINER_IP}${NC}"
echo -e "  • HTTP Management:     ${BOLD}http://${CONTAINER_IP}:8080/health${NC}"
echo -e "  • gRPC OpenTunnel:     ${BOLD}http://${CONTAINER_IP}:50051${NC}"
echo ""
echo -e "Console Access:"
echo -e "  • Enter container:     ${CYAN}pct enter ${CT_ID}${NC}"
echo -e "  • Check service:       ${CYAN}pct exec ${CT_ID} -- systemctl status frostfire-gateway${NC}"
echo -e "  • Stream live logs:    ${CYAN}pct exec ${CT_ID} -- journalctl -u frostfire-gateway -f${NC}"
echo -e "${GREEN}============================================================${NC}"
