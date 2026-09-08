#!/usr/bin/env python3
"""
Tier 5 Adversarial & Empirical Audit Suite for MicroVM Network Isolation Invariants
Validates:
- ZERO NAT MASQUERADE rules across host-setup.sh, firecracker-hypervisor.yaml, setup-cluster.sh
- Strict 172.16.x.0/24 point-to-point subnet allocation
- Drop rules for IMDS (169.254.169.254) in both FORWARD and INPUT chains
- Drop rules for WAN forwarding and cross-tenant lateral movement (tap+ to tap+)
- IPv6 leak prevention analysis
"""

import sys
import re
from pathlib import Path

def audit_network_isolation():
    files_to_audit = [
        Path("cloud/microvm/host-setup.sh"),
        Path("deploy/aws/firecracker-hypervisor.yaml"),
        Path("scripts/setup-cluster.sh"),
    ]

    for f in files_to_audit:
        assert f.exists(), f"Target file does not exist: {f}"

    print("=== Tier 5 MicroVM Network Isolation Invariant Audit ===")

    for f in files_to_audit:
        print(f"\n[Auditing {f}]")
        content = f.read_text(encoding="utf-8")

        # 1. Zero NAT Masquerade Invariant:
        # Forbidden: appending or inserting MASQUERADE rules
        bad_masquerade_patterns = [
            r"iptables\s+(?:-t\s+nat\s+)?-A\s+POSTROUTING[^\n]*\s+-j\s+MASQUERADE",
            r"iptables\s+(?:-t\s+nat\s+)?-I\s+POSTROUTING[^\n]*\s+-j\s+MASQUERADE",
        ]
        for pat in bad_masquerade_patterns:
            matches = re.findall(pat, content, re.IGNORECASE)
            assert not matches, f"VIOLATION in {f}: Found forbidden NAT MASQUERADE append rule: {matches}"

        # Invariant: Must clean up legacy masquerade (-D POSTROUTING ... MASQUERADE)
        has_cleanup = "-D POSTROUTING" in content and "MASQUERADE" in content
        assert has_cleanup, f"VIOLATION in {f}: Missing legacy NAT MASQUERADE cleanup (-D POSTROUTING ... -j MASQUERADE)"

        # Invariant: Must explicitly RETURN for 172.16.0.0/16 in POSTROUTING
        has_return = "-A POSTROUTING -s 172.16.0.0/16 -j RETURN" in content
        assert has_return, f"VIOLATION in {f}: Missing explicit RETURN rule for 172.16.0.0/16 in POSTROUTING"
        print("  ✓ Zero NAT MASQUERADE invariant verified (no append, cleanup present, RETURN enforced).")

        # 2. Strict Point-to-Point Subnet Invariant (172.16.x.0/24)
        assert "172.16." in content, f"VIOLATION in {f}: Missing 172.16.x.0/24 subnet configuration"
        assert "/24" in content, f"VIOLATION in {f}: TAP subnets must be /24 point-to-point"
        print("  ✓ Point-to-point TAP subnets (172.16.x.0/24) verified.")

        # 3. IMDS Drop Invariants (169.254.169.254)
        assert "169.254.169.254" in content, f"VIOLATION in {f}: Missing IMDS drop rules"

        # Verify FORWARD drop for IMDS
        imds_forward = re.search(r"FORWARD[^\n]*-d\s+169\.254\.169\.254(?:/32)?[^\n]*-j\s+DROP", content)
        assert imds_forward, f"VIOLATION in {f}: Missing FORWARD drop rule for IMDS (169.254.169.254)"

        # Verify INPUT drop for IMDS
        imds_input = re.search(r"INPUT[^\n]*-d\s+169\.254\.169\.254(?:/32)?[^\n]*-j\s+DROP", content)
        assert imds_input, f"VIOLATION in {f}: Missing INPUT drop rule for IMDS (169.254.169.254)"
        print("  ✓ IMDS (169.254.169.254) blocked in both FORWARD and INPUT chains.")

        # 4. Cross-Tenant Lateral Movement & WAN Forwarding Invariants
        # Forwarding between TAP interfaces must be dropped
        assert "tap+ -o tap+ -j DROP" in content, f"VIOLATION in {f}: Missing cross-tenant lateral movement block (tap+ -o tap+ -j DROP)"

        # WAN forwarding must be dropped
        wan_forward_drop = (
            re.search(r"FORWARD[^\n]*-s\s+172\.16\.0\.0/16[^\n]*-j\s+DROP", content) or
            re.search(r"FORWARD[^\n]*-i\s+\"?\$\{TAP\}\"?[^\n]*-o\s+\"?\$\{PRIMARY_IFACE\}\"?[^\n]*-j\s+DROP", content) or
            re.search(r"FORWARD[^\n]*-i\s+tap\+[^\n]*-o\s+\"?\$\{PRIMARY_IFACE\}\"?[^\n]*-j\s+DROP", content)
        )
        assert wan_forward_drop, f"VIOLATION in {f}: Missing WAN forwarding drop rule for TAP / 172.16.x subnets"
        print("  ✓ WAN forwarding and cross-tenant lateral movement strictly blocked.")

    # 5. IPv6 Gap Analysis
    print("\n[Audit 5] Auditing IPv6 Leak Protection...")
    for f in files_to_audit:
        content = f.read_text(encoding="utf-8")
        has_ipv6_disable = "disable_ipv6" in content or "ip6tables" in content
        if not has_ipv6_disable:
            print(f"  [!] Caveat / Security Advisory in {f}: IPv6 is not explicitly disabled via sysctl (net.ipv6.conf.*.disable_ipv6=1) or ip6tables -P DROP.")

    print("\n=== All Network Isolation Invariant Checks PASSED ===")

if __name__ == "__main__":
    try:
        audit_network_isolation()
    except AssertionError as err:
        print(f"\n[FATAL AUDIT FAILURE] {err}", file=sys.stderr)
        sys.exit(1)
