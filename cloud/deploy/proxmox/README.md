# Frostfire Central Cloud Gateway (Area 2) on Proxmox VE

This directory contains turnkey deployment automation and guides for running the **Frostfire Central Cloud Gateway (Area 2)** on a **Proxmox Virtual Environment (PVE)** hypervisor.

```
                  ┌─────────────────────────────────────────────────────────┐
                  │                 Proxmox VE Hypervisor                   │
                  │                                                         │
                  │   ┌─────────────────────────────────────────────────┐   │
                  │   │   Debian 12 LXC Container (CT 250)              │   │
                  │   │   - CPU: 2 Cores | RAM: 2048 MB | Disk: 16 GB   │   │
                  │   │   - Systemd Service: frostfire-gateway.service   │   │
                  │   │                                                 │   │
                  │   │   [frostfire-gateway daemon]                    │   │
                  │   │   ├── Port 50051: gRPC OpenTunnel Reverse Broker│   │
                  │   │   ├── Port 8080:  HTTP REST & Management API    │   │
                  │   │   │               - GET  /health & /status      │   │
                  │   │   │               - POST /v1/webhooks/stripe    │   │
                  │   │   │               - POST /v1/license/verify     │   │
                  │   │   │               - GET  /v1/tunnels            │   │
                  │   │   ├── SQLite Storage: /var/lib/frostfire/       │   │
                  │   │   └── Ed25519 Authority: Token minting & verify│   │
                  │   └─────────────────────────▲───────────────────────┘   │
                  └─────────────────────────────┼───────────────────────────┘
                                                │
                 ┌──────────────────────────────┴────────────────────────────┐
                 │                                                           │
      gRPC / TLS 1.3 OpenTunnel                               HTTP REST / Management
  (x-frostfire-window-owner token)                           (Bearer <license_jwt>)
                 │                                                           │
  ┌──────────────┴──────────────┐                             ┌──────────────┴──────────────┐
  │ MicroVM Execution Node      │                             │ Tauri Desktop Application   │
  │ - frostfire-daemon          │                             │ - Usage & Billing Settings  │
  │ - Outbound reverse stream   │                             │ - License Activation        │
  └─────────────────────────────┘                             └─────────────────────────────┘
```

---

## Quick Start: Option 1 — Automated 1-Step LXC Deployment (Recommended)

Run this command directly on your **Proxmox VE Node Shell** (via PVE Web GUI -> Node -> Shell, or via SSH as root):

```bash
curl -fsSL https://raw.githubusercontent.com/tysongoulding/frostfire/production/cloud/deploy/proxmox/create-gateway-lxc.sh | bash
```

Or clone the repository and run locally on the Proxmox host:

```bash
git clone https://github.com/tysongoulding/frostfire.git
cd frostfire/cloud/deploy/proxmox
chmod +x create-gateway-lxc.sh install-gateway.sh
./create-gateway-lxc.sh
```

### What this script does:
1. Verifies Proxmox VE host environment and auto-detects container storage (`local-lvm`, `local-zfs`, or `local`).
2. Checks for or downloads the official Debian 12 Bookworm LXC template.
3. Provisions an unprivileged LXC container (`CT 250`, 2 vCPUs, 2048 MB RAM, 16 GB disk) with nesting enabled (`features: nesting=1,keyctl=1`).
4. Configures networking (`vmbr0`, DHCP or static).
5. Boots the container and executes `install-gateway.sh` directly inside the guest.
6. Configures, enables, and starts `frostfire-gateway.service`.
7. Verifies health via `http://<container_ip>:8080/health`.

---

## Option 2 — Manual Installation on Existing LXC or VM

If you already have a Debian 12 or Ubuntu 22.04/24.04 container or virtual machine on Proxmox:

1. SSH into the container/VM as `root`:
   ```bash
   ssh root@<your-proxmox-vm-ip>
   ```

2. Download and run the turnkey installer:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/tysongoulding/frostfire/production/cloud/deploy/proxmox/install-gateway.sh | bash
   ```

3. Check service status:
   ```bash
   systemctl status frostfire-gateway
   ```

---

## Configuration & Environment Variables

The gateway service reads configuration from `/etc/frostfire/gateway.env`:

| Variable | Default | Description |
|---|---|---|
| `GATEWAY_PORT` | `50051` | Tonic gRPC port for the `OpenTunnel` reverse stream broker. |
| `HTTP_PORT` | `8080` | HTTP port for REST management, Stripe webhooks, and health checks. |
| `BIND_ADDR` | `0.0.0.0` | Bind IP address for all listeners. |
| `SQLITE_PATH` | `/var/lib/frostfire/accounts.db` | Path to persistent SQLite accounts and Stripe webhook ledger. |
| `ENVIRONMENT` | `proxmox-poc` | Deployment environment tag. |
| `FROSTFIRE_WINDOW_OWNER_TOKEN` | *(empty)* | Optional master window token for constant-time MicroVM tunnel authentication. |
| `RUST_LOG` | `info,frostfire_gateway=debug` | Log verbosity filter. |

After modifying `/etc/frostfire/gateway.env`, restart the service:
```bash
systemctl restart frostfire-gateway
```

---

## Proxmox Firewall & Port Forwarding

If your Proxmox VE node is behind a NAT router or firewall, open or forward these ports to the container's IP:

| Port | Protocol | Usage | Recommendation |
|---|---|---|---|
| `50051` | TCP | gRPC OpenTunnel Broker | Expose to MicroVM execution nodes (or over WireGuard/Tailscale) |
| `8080` | TCP | HTTP REST & Stripe Webhook | Expose to Tauri desktop clients & Stripe webhook endpoint |

### Proxmox Host Port Forwarding (NAT / iptables)
If your container uses an internal private IP on `vmbr0` (e.g. `10.10.10.250`) and you want to forward ports from the Proxmox host IP:

```bash
# Add to /etc/network/interfaces under vmbr0 or run directly:
iptables -t nat -A PREROUTING -i vmbr0 -p tcp --dport 50051 -j DNAT --to-destination 10.10.10.250:50051
iptables -t nat -A PREROUTING -i vmbr0 -p tcp --dport 8080 -j DNAT --to-destination 10.10.10.250:8080
```

---

## Verification & API Endpoints

### 1. Health Check
```bash
curl -s http://<gateway_ip>:8080/health | jq .
```
Response:
```json
{
  "status": "healthy",
  "version": "0.3.0",
  "uptime_seconds": 42,
  "active_tunnels": 0,
  "total_accounts": 1,
  "environment": "proxmox-poc",
  "hypervisor_mode": "proxmox-ve"
}
```

### 2. Verify License Token
```bash
curl -X POST http://<gateway_ip>:8080/v1/license/verify \
  -H "Content-Type: application/json" \
  -d '{"token":"<your_license_jwt>"}'
```

### 3. List Connected MicroVM Reverse Tunnels
```bash
curl -s http://<gateway_ip>:8080/v1/tunnels | jq .
```

---

## Operations & Maintenance

- **View Live Logs**:
  ```bash
  journalctl -u frostfire-gateway -f
  ```
- **Restart Gateway**:
  ```bash
  systemctl restart frostfire-gateway
  ```
- **Stop Gateway**:
  ```bash
  systemctl stop frostfire-gateway
  ```
- **Database & Keys Backup**:
  Back up `/var/lib/frostfire/` (contains `accounts.db` and keys):
  ```bash
  tar -czvf frostfire-gateway-backup.tar.gz /var/lib/frostfire /etc/frostfire
  ```
