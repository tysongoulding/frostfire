#!/usr/bin/env bash
# ==============================================================================
# Frostfire Central Gateway — In-Guest Turnkey Installer for Proxmox (LXC / VM)
# ==============================================================================
# Installs system dependencies, Rust toolchain, builds & configures the standalone
# frostfire-gateway daemon, provisions systemd service, and verifies health.
# ==============================================================================

set -euo pipefail

# Visual styling
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}>>> Frostfire Central Cloud Gateway — Proxmox Installer     ${NC}"
echo -e "${CYAN}============================================================${NC}"

# Ensure root privileges
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[!] This installer must be run as root (or via sudo).${NC}"
    exit 1
fi

export DEBIAN_FRONTEND=noninteractive

# Configuration variables (overridable via environment)
GATEWAY_PORT="${GATEWAY_PORT:-50051}"
HTTP_PORT="${HTTP_PORT:-8080}"
BIND_ADDR="${BIND_ADDR:-0.0.0.0}"
INSTALL_DIR="/opt/frostfire/gateway"
DATA_DIR="/var/lib/frostfire"
CONFIG_DIR="/etc/frostfire"
LOG_DIR="/var/log/frostfire"
ENVIRONMENT="${ENVIRONMENT:-proxmox-poc}"
WINDOW_OWNER_TOKEN="${FROSTFIRE_WINDOW_OWNER_TOKEN:-}"

# 1. Update and install system dependencies
echo -e "${YELLOW}[1/6] Installing system packages and build toolchain...${NC}"
apt-get update -y
apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    wget \
    jq \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    sqlite3 \
    ufw

# 2. Provision dedicated system user and directories
echo -e "${YELLOW}[2/6] Configuring directories and system permissions...${NC}"
if ! id -u frostfire >/dev/null 2>&1; then
    useradd -r -s /usr/sbin/nologin -d "$DATA_DIR" -m frostfire
    echo "[+] Created dedicated system user: frostfire"
fi

mkdir -p "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR" "$INSTALL_DIR"
chown -R frostfire:frostfire "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR" "$INSTALL_DIR"
chmod 750 "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR"

# 3. Install or compile frostfire-gateway binary
echo -e "${YELLOW}[3/6] Installing frostfire-gateway binary...${NC}"
if [ -f "/usr/local/bin/frostfire-gateway" ]; then
    echo "[+] Found existing binary at /usr/local/bin/frostfire-gateway"
elif [ -f "./target/release/frostfire-gateway" ]; then
    echo "[+] Copying release binary from local target..."
    install -m 755 ./target/release/frostfire-gateway /usr/local/bin/frostfire-gateway
else
    echo "[*] Building frostfire-gateway from source..."
    # Ensure Rust toolchain is available
    if ! command -v cargo >/dev/null 2>&1; then
        echo "[*] Installing Rust toolchain (rustup)..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
        source "$HOME/.cargo/env" || export PATH="$HOME/.cargo/bin:$PATH"
    fi

    # If repository source is present in current or parent directory, build it
    if [ -f "Cargo.toml" ] && grep -q "frostfire-gateway" Cargo.toml; then
        cargo build --release -p frostfire-gateway
        install -m 755 ./target/release/frostfire-gateway /usr/local/bin/frostfire-gateway
    elif [ -d "/usr/src/frostfire" ]; then
        cd /usr/src/frostfire
        cargo build --release -p frostfire-gateway
        install -m 755 ./target/release/frostfire-gateway /usr/local/bin/frostfire-gateway
    else
        echo "[*] Cloning Frostfire repository..."
        TMP_SRC=$(mktemp -d)
        git clone --depth 1 https://github.com/tysongoulding/frostfire.git "$TMP_SRC"
        cd "$TMP_SRC"
        cargo build --release -p frostfire-gateway
        install -m 755 ./target/release/frostfire-gateway /usr/local/bin/frostfire-gateway
        rm -rf "$TMP_SRC"
    fi
fi

# 4. Generate environment configuration
echo -e "${YELLOW}[4/6] Provisioning environment configuration at ${CONFIG_DIR}/gateway.env...${NC}"
cat << EOF > "${CONFIG_DIR}/gateway.env"
RUST_LOG=info,frostfire_gateway=debug
GATEWAY_PORT=${GATEWAY_PORT}
HTTP_PORT=${HTTP_PORT}
BIND_ADDR=${BIND_ADDR}
SQLITE_PATH=${DATA_DIR}/accounts.db
ENVIRONMENT=${ENVIRONMENT}
FROSTFIRE_WINDOW_OWNER_TOKEN=${WINDOW_OWNER_TOKEN}
EOF
chown frostfire:frostfire "${CONFIG_DIR}/gateway.env"
chmod 640 "${CONFIG_DIR}/gateway.env"

# 5. Create and enable Systemd Service unit
echo -e "${YELLOW}[5/6] Creating systemd service unit /etc/systemd/system/frostfire-gateway.service...${NC}"
cat << 'EOF' > /etc/systemd/system/frostfire-gateway.service
[Unit]
Description=Frostfire Central Cloud Gateway (Area 2)
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=frostfire
Group=frostfire
WorkingDirectory=/var/lib/frostfire
EnvironmentFile=/etc/frostfire/gateway.env
ExecStart=/usr/local/bin/frostfire-gateway
Restart=always
RestartSec=3
LimitNOFILE=65535

# Security hardening
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now frostfire-gateway.service

# 6. Verify health check endpoint
echo -e "${YELLOW}[6/6] Verifying service health check...${NC}"
HEALTHY=0
for i in $(seq 1 15); do
    if curl -s -f "http://127.0.0.1:${HTTP_PORT}/health" >/tmp/gw_health.json 2>/dev/null; then
        HEALTHY=1
        break
    fi
    sleep 1
done

IP_ADDR=$(ip -4 addr show scope global | grep inet | awk '{print $2}' | cut -d/ -f1 | head -n1 || echo "127.0.0.1")

if [ "$HEALTHY" -eq 1 ]; then
    echo -e "${GREEN}============================================================${NC}"
    echo -e "${GREEN}>>> Frostfire Central Gateway is HEALTHY and RUNNING!       ${NC}"
    echo -e "${GREEN}============================================================${NC}"
    echo -e "Health response:"
    cat /tmp/gw_health.json | jq . || cat /tmp/gw_health.json
    echo ""
    echo -e "${CYAN}Endpoints:${NC}"
    echo -e "  • HTTP Health/Status:  http://${IP_ADDR}:${HTTP_PORT}/health"
    echo -e "  • HTTP Status:         http://${IP_ADDR}:${HTTP_PORT}/status"
    echo -e "  • gRPC OpenTunnel:     http://${IP_ADDR}:${GATEWAY_PORT}"
    echo -e "  • Stripe Webhooks:     http://${IP_ADDR}:${HTTP_PORT}/v1/webhooks/stripe"
    echo -e "  • Verify License:      http://${IP_ADDR}:${HTTP_PORT}/v1/license/verify"
    echo ""
    echo -e "${CYAN}Management Commands:${NC}"
    echo -e "  • View status:         systemctl status frostfire-gateway"
    echo -e "  • View live logs:      journalctl -u frostfire-gateway -f"
    echo -e "  • Restart service:     systemctl restart frostfire-gateway"
    echo -e "  • Configuration file:  ${CONFIG_DIR}/gateway.env"
    echo -e "  • SQLite database:     ${DATA_DIR}/accounts.db"
    echo -e "${GREEN}============================================================${NC}"
else
    echo -e "${RED}[!] Health check timed out. Showing service logs:${NC}"
    journalctl -u frostfire-gateway -n 30 --no-pager
    exit 1
fi
