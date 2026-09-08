# Investigation Report: Network Bridge Isolation & Security Invariant Enforcement (Milestone 3 / Feature F13)

**Author**: `explorer_m3_1` (Teamwork Explorer)  
**Target Milestone**: Milestone 3 (AWS Production Infra & Network Isolation)  
**Feature**: F13 — Isolated Network Bridge  
**Date**: 2026-09-08  

---

## 1. Executive Summary

A comprehensive investigation was conducted into the microVM networking implementation across the `frostfire-cloud` codebase. The audit revealed that the current hypervisor provisioning scripts (`cloud/microvm/host-setup.sh` and `deploy/aws/firecracker-hypervisor.yaml`) actively install `iptables` NAT `MASQUERADE` and permit bidirectional packet forwarding between microVM TAP interfaces and the hypervisor host's WAN interface.

These rules directly violate the foundational security invariant codified in `AGENTS.md`:
> *"MicroVM Isolation: MicroVM instances run on isolated bridge networks (`172.16.x.0/24`). Never bridge unauthenticated guest networks to the public internet."*

This report documents the exact lines of code responsible for the violation, analyzes the resultant threat vectors (direct public WAN egress, AWS IMDS credential exfiltration, and cross-tenant lateral movement), provides drop-in replacement configurations for both scripts, and details automated verification methods across static CI gates, Rust test harnesses, and host-level network inspection.

---

## 2. Codebase Audit of Existing Network & iptables Setup

### 2.1 `cloud/microvm/host-setup.sh`

In `cloud/microvm/host-setup.sh`, lines 26–62 configure host networking, TAP devices, and firewall rules:

```bash
# Line 26-28:
echo "=== 3. Setting Up Vanilla TAP Networking & iptables NAT ==="
# Enable IPv4 forwarding
sudo sysctl -w net.ipv4.ip_forward=1 > /dev/null

# Line 31:
PRIMARY_IFACE="$(ip -o route get 1.1.1.1 | awk '{print $5}')"

# Lines 33-43:
setup_tap() {
  local TAP_NAME="$1"
  local HOST_IP="$2"

  if ! ip link show "${TAP_NAME}" > /dev/null 2>&1; then
    sudo ip tuntap add dev "${TAP_NAME}" mode tap user "${USER}"
    sudo ip addr add "${HOST_IP}/24" dev "${TAP_NAME}"
    sudo ip link set dev "${TAP_NAME}" up
    echo "[+] Configured ${TAP_NAME} with host IP ${HOST_IP}/24"
  fi
}

# Lines 45-48:
# 3 TAP interfaces for 3 microVMs (User 1, User 2, User 3)
setup_tap "tap0" "172.16.0.1"
setup_tap "tap1" "172.16.1.1"
setup_tap "tap2" "172.16.2.1"

# Lines 50-60 (CRITICAL VIOLATION):
# NAT MASQUERADE for outbound internet traffic
sudo iptables -t nat -C POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE 2>/dev/null || \
  sudo iptables -t nat -A POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE

sudo iptables -C FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
  sudo iptables -A FORWARD -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

for TAP in tap0 tap1 tap2; do
  sudo iptables -C FORWARD -i "${TAP}" -o "${PRIMARY_IFACE}" -j ACCEPT 2>/dev/null || \
    sudo iptables -A FORWARD -i "${TAP}" -o "${PRIMARY_IFACE}" -j ACCEPT
done

# Line 62:
echo "[✓] Host networking initialized: tap0, tap1, tap2 routed via ${PRIMARY_IFACE} with NAT."
```

#### Observations:
1. **Line 28**: Globally enables IPv4 packet forwarding (`net.ipv4.ip_forward=1`).
2. **Lines 51–52**: Adds a NAT MASQUERADE target on `${PRIMARY_IFACE}` in the `POSTROUTING` chain of table `nat`.
3. **Lines 57–60**: Explicitly loops over `tap0`, `tap1`, `tap2` and installs `-A FORWARD -i "${TAP}" -o "${PRIMARY_IFACE}" -j ACCEPT`.

### 2.2 `deploy/aws/firecracker-hypervisor.yaml`

In `deploy/aws/firecracker-hypervisor.yaml`, within the EC2 bare-metal hypervisor `UserData` script (lines 261–269):

```yaml
          # 4. Configure Networking & Bridge for MicroVM Tap Interfaces
          mkdir -p /var/lib/frostfire /var/run/frostfire
          sysctl -w net.ipv4.ip_forward=1
          echo "net.ipv4.ip_forward = 1" >> /etc/sysctl.d/99-frostfire.conf

          # Setup bridge and NAT rule
          PRIMARY_IFACE=$(ip -4 route show default | awk '{print $5}' | head -n1)
          iptables -t nat -A POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE || true
```

#### Observations:
1. **Lines 263–264**: Enables and persists `net.ipv4.ip_forward = 1`.
2. **Line 268**: Executes `iptables -t nat -A POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE || true`.
3. **Omission**: Omits TAP interface provisioning entirely in UserData and configures zero ingress/egress boundaries.

---

## 3. Deep Threat Analysis & Invariant Violation

The presence of NAT MASQUERADE and WAN forwarding directly violates multiple core architectural mandates:

| Document | Section | Mandate | Current Status |
|----------|---------|---------|----------------|
| `AGENTS.md` | Invariants (Line 15) | *"MicroVM Isolation: MicroVM instances run on isolated bridge networks (`172.16.x.0/24`). Never bridge unauthenticated guest networks to the public internet."* | **VIOLATED** |
| `ORIGINAL_REQUEST.md` | §R3 (Line 31) | *"Isolated point-to-point network tap topology (`172.16.x.0/24` bridge) preventing unauthenticated guest microVMs from accessing external networks directly."* | **VIOLATED** |
| `ORIGINAL_REQUEST.md` | Acceptance Criteria (Line 41) | *"MicroVM network bridges strictly enforce isolated subnets (`172.16.x.0/24`) without unauthorized direct public egress."* | **VIOLATED** |
| `PROJECT.md` | Interface Contracts (§MicroVM Host & Guest Isolation) | *"Forwarding of guest TAP packets to public WAN interface is FORBIDDEN. No `iptables -t nat -A POSTROUTING -o <WAN> -j MASQUERADE` for TAP subnets. MicroVM guest egress is strictly outbound-only via the reverse tunnel to `frostfire-gateway`."* | **VIOLATED** |

### Threat Vectors Introduced by the Current Configuration

1. **Unconstrained Direct Public Egress**:
   - When an unauthenticated or compromised microVM guest transmits packets destined for arbitrary external IPv4 addresses (e.g. `8.8.8.8` or malicious command-and-control servers), the Linux kernel on the host forwards those packets via `FORWARD -i tapX -o ${PRIMARY_IFACE} -j ACCEPT`.
   - In the NAT `POSTROUTING` table, `MASQUERADE` substitutes the guest's `172.16.x.2` source IP with the hypervisor host's public AWS Elastic IP.
   - External servers receive packets originating from the AWS customer's own public IP, exposing the infrastructure to abuse reports, blacklisting, and unmonitored data exfiltration.

2. **Bypass of `frostfire-gateway` Ingress / Audit Gating**:
   - In the Frostfire architecture, external agent interactions are strictly restricted to bidirectional gRPC frames routed over `OpenTunnel` to `frostfire-gateway` (authenticated via `x-sand-window-owner` with constant-time validation).
   - Direct WAN access allows agents to circumvent all tool filtering, MCP proxy approvals, and security auditing.

3. **Cloud Infrastructure Compromise via AWS IMDS (`169.254.169.254`)**:
   - On AWS EC2 instances, the Instance Metadata Service is reachable at link-local address `169.254.169.254`.
   - Under `net.ipv4.ip_forward=1` without explicit destination filtering, guest microVMs can send requests to `http://169.254.169.254/latest/meta-data/iam/security-credentials/`.
   - If IMDSv1 is enabled or if IMDSv2 token retrieval routes over the host interface, guest workloads could harvest the hypervisor's IAM role credentials (`PocInstanceRole`), escalating privileges across the user's AWS cloud account.

4. **Cross-Tenant Lateral Movement**:
   - The current setup relies on individual TAP subnets (`172.16.0.0/24`, `172.16.1.0/24`, `172.16.2.0/24`). However, because `ip_forward=1` is active and the host knows the routes to all three interfaces, Tenant 0 (`tap0`) can transmit packets to Tenant 1 (`tap1`) or Tenant 2 (`tap2`) through the host kernel unless inter-interface forwarding is explicitly blocked.
   - An attacker in VM 0 could connect to VM 1's X11 server (port 6000+), VNC server (5901), Chrome remote debugging port (9222), or in-VM executor (port 3000).

---

## 4. Exact Replacement iptables & Network Bridge Configuration

### 4.1 Architectural Design

1. **Subnet Topology**:
   - Point-to-point TAP interfaces:
     - `tap0`: Host Gateway `172.16.0.1/24`, Guest VM `172.16.0.2/24` (Subnet `172.16.0.0/24`)
     - `tap1`: Host Gateway `172.16.1.1/24`, Guest VM `172.16.1.2/24` (Subnet `172.16.1.0/24`)
     - `tap2`: Host Gateway `172.16.2.1/24`, Guest VM `172.16.2.2/24` (Subnet `172.16.2.0/24`)
2. **NAT Table Policy**:
   - Completely eliminate all `MASQUERADE` and `SNAT` targets for `172.16.0.0/16` and TAP interfaces.
3. **Filter Table — `FORWARD` Chain**:
   - Explicitly `DROP` all traffic from `tap+` to `${PRIMARY_IFACE}`.
   - Explicitly `DROP` all traffic from `${PRIMARY_IFACE}` to `tap+`.
   - Explicitly `DROP` all traffic between TAP interfaces (`tap+` to `tap+`) for cross-tenant isolation.
   - Explicitly `DROP` all forwarded traffic originating from `172.16.0.0/16`.
   - Explicitly `DROP` all forwarded traffic destined to `169.254.169.254/32` (AWS IMDS).
4. **Filter Table — `INPUT` Chain**:
   - Explicitly `DROP` any traffic from `tap+` destined to `169.254.169.254/32`.
   - Allow guest traffic on `tap${i}` targeting its host gateway `172.16.${i}.1` only (for reverse-tunnel gRPC on port 50051, local display proxies, etc.).
   - Explicitly `DROP` any guest traffic on `tap${i}` targeting any other host IP address.

### 4.2 Replacement Code: `cloud/microvm/host-setup.sh`

Replace lines 50–63 in `cloud/microvm/host-setup.sh` with the following:

```bash
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
```

### 4.3 Replacement Code: `deploy/aws/firecracker-hypervisor.yaml`

Replace lines 261–269 in `deploy/aws/firecracker-hypervisor.yaml` with the following:

```yaml
          # 4. Configure Isolated MicroVM TAP Networking (172.16.x.0/24)
          mkdir -p /var/lib/frostfire /var/run/frostfire
          PRIMARY_IFACE=$(ip -4 route show default | awk '{print $5}' | head -n1)

          # Provision point-to-point TAP interfaces for microVMs
          for i in 0 1 2; do
            TAP="tap${i}"
            HOST_IP="172.16.${i}.1"
            if ! ip link show "${TAP}" >/dev/null 2>&1; then
              ip tuntap add dev "${TAP}" mode tap user ubuntu
              ip addr add "${HOST_IP}/24" dev "${TAP}"
              ip link set dev "${TAP}" up
            fi
          done

          # MicroVM Isolation Invariant: FORBID NAT MASQUERADE and direct WAN forwarding
          iptables -t nat -D POSTROUTING -o "${PRIMARY_IFACE}" -j MASQUERADE 2>/dev/null || true
          iptables -t nat -D POSTROUTING -s 172.16.0.0/16 -j MASQUERADE 2>/dev/null || true
          iptables -t nat -A POSTROUTING -s 172.16.0.0/16 -j RETURN

          # Drop all WAN forwarding to and from TAP devices
          iptables -A FORWARD -i tap+ -o "${PRIMARY_IFACE}" -j DROP
          iptables -A FORWARD -i "${PRIMARY_IFACE}" -o tap+ -j DROP
          iptables -A FORWARD -i tap+ -o tap+ -j DROP
          iptables -A FORWARD -s 172.16.0.0/16 -j DROP
          iptables -A FORWARD -d 169.254.169.254/32 -j DROP
          iptables -I INPUT 1 -i tap+ -d 169.254.169.254/32 -j DROP

          for i in 0 1 2; do
            iptables -A INPUT -i "tap${i}" -d "172.16.${i}.1" -j ACCEPT
            iptables -A INPUT -i "tap${i}" ! -d "172.16.${i}.1" -j DROP
          done
```

---

## 5. Automated Verification Checks

To verify this invariant independently, a three-tier validation strategy is established:

### 5.1 Rust Test Suite Verification (Tiers 1–4)

The codebase already contains opaque-box tests validating the invariant model:

- **`tests/e2e/src/harness.rs`**:
  ```rust
  impl NetworkBridgeSpec {
      pub fn for_tap(index: usize) -> Self {
          Self {
              tap_name: format!("tap{}", index),
              host_ip: format!("172.16.{}.1", index),
              guest_ip: format!("172.16.{}.2", index),
              subnet_cidr: format!("172.16.{}.0/24", index),
              allow_nat_masquerade: false,
              allow_wan_forwarding: false,
          }
      }

      pub fn satisfies_isolation_invariants(&self) -> bool {
          !self.allow_nat_masquerade && !self.allow_wan_forwarding && self.host_ip.starts_with("172.16.")
      }
  }
  ```
- **`tests/e2e/tests/tier1_feature_coverage.rs`**:
  - `test_f13_microvm_bridge_subnet_172_16_x_0`: Verifies `172.16.x.0/24` subnet assignment.
  - `test_f13_host_and_guest_ip_allocations`: Confirms host `.1` and guest `.2`.
  - `test_f13_nat_masquerade_forbidden_invariant`: Enforces `allow_nat_masquerade == false`.
  - `test_f13_wan_forwarding_forbidden_invariant`: Enforces `allow_wan_forwarding == false`.
  - `test_f13_outbound_only_reverse_tunnel_rule`: Validates outbound-only reverse-tunnel path.
- **`tests/e2e/tests/tier2_boundary_corner.rs`**:
  - `test_f13_b1_broadcast_ip_allocation_rejected`: Rejects `.255`.
  - `test_f13_b2_host_ip_collision_rejected`: Rejects `.1` for guests.
  - `test_f13_b3_subnet_boundary_host_254`: Validates max host `.254`.
  - `test_f13_b4_spoofed_public_ip_egress_blocking`: Blocks `8.8.8.8` and `1.1.1.1`.
  - `test_f13_b5_ipv6_leak_prevention_on_bridge`: Blocks IPv6 link-local bypass.
- **`tests/e2e/tests/tier4_real_world.rs`**:
  - Validates cross-tenant subnet separation (`172.16.0.0/24` vs `172.16.1.0/24`) and confirms neither bridge allows public WAN forwarding or NAT masquerade.

### 5.2 CI Static Lint & Codebase Invariant Gate

Add an automated check to CI (`cargo test` or shell lint gate):

```bash
# Verify no NAT MASQUERADE exists in microvm host scripts or deployment templates
! grep -E "iptables.*-j MASQUERADE" cloud/microvm/host-setup.sh deploy/aws/firecracker-hypervisor.yaml

# Verify no FORWARD ACCEPT to WAN interface
! grep -E "FORWARD.*-j ACCEPT" cloud/microvm/host-setup.sh | grep -v "RELATED,ESTABLISHED"

# Verify explicit DROP rules exist for TAP forwarding
grep -E "FORWARD.*-i.*tap.*-j DROP" cloud/microvm/host-setup.sh
grep -E "FORWARD.*-i tap\+ -o tap\+ -j DROP" cloud/microvm/host-setup.sh
```

### 5.3 Live Hypervisor Host Verification Commands

On an active Linux hypervisor host, execute:

```bash
# 1. Verify NAT POSTROUTING table has 0 MASQUERADE rules for tap interfaces
sudo iptables -t nat -S POSTROUTING | grep MASQUERADE
# Must return exit code 1 (no lines matched)

# 2. Verify FORWARD chain explicitly drops tap to WAN and cross-tap traffic
sudo iptables -S FORWARD | grep -E "DROP"
# Expected matches:
# -A FORWARD -i tap0 -o ens5 -j DROP
# -A FORWARD -i tap+ -o tap+ -j DROP
# -A FORWARD -s 172.16.0.0/16 -j DROP
# -A FORWARD -d 169.254.169.254/32 -j DROP

# 3. Verify TAP interfaces are UP with 172.16.x.1/24
ip -4 addr show tap0 | grep "inet 172.16.0.1/24"
ip -4 addr show tap1 | grep "inet 172.16.1.1/24"
ip -4 addr show tap2 | grep "inet 172.16.2.1/24"

# 4. Guest MicroVM Outbound Isolation Simulation (from within guest microVM namespace)
# Outbound ping to public internet MUST fail:
ping -c 1 -W 2 8.8.8.8
# Outbound HTTP to public internet MUST fail:
curl --connect-timeout 2 http://1.1.1.1
# Access to AWS IMDS metadata MUST fail:
curl --connect-timeout 2 http://169.254.169.254/latest/meta-data/
# Legitimate communication to host reverse-tunnel gateway MUST succeed:
curl --connect-timeout 2 http://172.16.0.1:50051
```

---

## 6. Implementation Plan for Implementer Agent

When the implementer agent executes Milestone 3:
1. Update `cloud/microvm/host-setup.sh` with the replacement rules from Section 4.2.
2. Update `deploy/aws/firecracker-hypervisor.yaml` with the replacement rules from Section 4.3.
3. Add static assertions to `tests/e2e/tests/tier1_feature_coverage.rs` verifying that `host-setup.sh` and `firecracker-hypervisor.yaml` do not contain `-j MASQUERADE`.
4. Run `cargo test --workspace` to ensure all 58 existing unit/integration tests continue passing with 0 warnings.
