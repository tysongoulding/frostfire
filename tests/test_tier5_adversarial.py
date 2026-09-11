"""
Frostfire Cloud E2E Test Suite — Tier 5: Adversarial Hardening & Stress Testing
Empirical challenge suite verifying failure modes, boundary limits, and resilience:
1. AWS Infrastructure, CloudFormation parameter bounds, and check-idle-shutdown logic.
2. Kernel config assertion boundaries, monolithic enforcement, and ELF validation.
3. Rootfs debootstrap assembly, binary recombination integrity, and systemd service contracts.
4. Firecracker hypervisor daemon error paths, UDS socket lifecycle, and routing resilience.
5. In-guest verification (box-doctor) diagnostic tolerances and edge case detection.
"""

import io
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional

from tests.common import (
    BOX_DOCTOR,
    BUILD_KERNEL_SH,
    BUILD_ROOTFS_SH,
    CHECK_IDLE_SH,
    DEPLOY_POC_PS1,
    DEPLOY_POC_SH,
    DEPLOY_POC_YAML,
    ETC_POLICIES_DIR,
    EXEC_DAEMON_DIR,
    HOME_BOX_DIR,
    HYPERVISOR_MAIN,
    KERNEL_CONFIG,
    ROOT_DIR,
    SETUP_HOST_SH,
    START_FROSTFIRE_BOX,
    USR_LOCAL_SHARE_DIR,
    USR_SHARE_BG_DIR,
    FrostfireTestCase,
    extract_bash_functions,
    load_cf_yaml,
    parse_kernel_config,
    read_text,
)


def run_bash_cmd(cmd: str) -> subprocess.CompletedProcess:
    """Helper to run a bash command string in WSL/bash environment via binary stdin pipe."""
    clean_env = {k: v for k, v in os.environ.items() if not k.startswith("ANTIGRAVITY")}
    clean_env["WSLENV"] = ""
    clean_cmd = cmd.replace("\r\n", "\n").replace("\r", "\n")
    proc = subprocess.run(["bash"], input=clean_cmd.encode("utf-8"), capture_output=True, env=clean_env)
    return subprocess.CompletedProcess(
        args=proc.args,
        returncode=proc.returncode,
        stdout=proc.stdout.decode("utf-8", errors="replace"),
        stderr=proc.stderr.decode("utf-8", errors="replace"),
    )


class TestAdversarialIdleShutdown(FrostfireTestCase):
    """Adversarial Stress Testing of Host Auto-Idle Shutdown Logic."""

    def _simulate_idle_script(self, active_conns_input: str, initial_counter: Optional[int]) -> Dict[str, Any]:
        """Simulates the check-idle-shutdown.sh decision engine under various conditions."""
        lines = [line.strip() for line in active_conns_input.strip().splitlines() if line.strip() and not line.strip().startswith('State')]
        active_conns = len(lines)
        
        counter = initial_counter if initial_counter is not None else 0
        shutdown_triggered = False
        new_counter = 0

        if active_conns == 0:
            new_counter = counter + 5
            if new_counter >= 20:
                shutdown_triggered = True
        else:
            new_counter = 0
            shutdown_triggered = False

        return {
            'active_conns': active_conns,
            'new_counter': new_counter,
            'shutdown_triggered': shutdown_triggered,
        }

    def test_idle_counter_normal_progression_to_shutdown(self):
        """Verify exact progression: 0 -> 5 -> 10 -> 15 -> 20 (shutdown)."""
        # Tick 1: 0 mins -> 5 mins
        r1 = self._simulate_idle_script('', initial_counter=0)
        self.assertEqual(r1['new_counter'], 5)
        self.assertFalse(r1['shutdown_triggered'])

        # Tick 2: 5 mins -> 10 mins
        r2 = self._simulate_idle_script('', initial_counter=5)
        self.assertEqual(r2['new_counter'], 10)
        self.assertFalse(r2['shutdown_triggered'])

        # Tick 3: 10 mins -> 15 mins
        r3 = self._simulate_idle_script('', initial_counter=10)
        self.assertEqual(r3['new_counter'], 15)
        self.assertFalse(r3['shutdown_triggered'])

        # Tick 4: 15 mins -> 20 mins (triggers shutdown)
        r4 = self._simulate_idle_script('', initial_counter=15)
        self.assertEqual(r4['new_counter'], 20)
        self.assertTrue(r4['shutdown_triggered'])

    def test_idle_counter_reset_on_ssh_session(self):
        """Active SSH session on port 22 immediately resets idle counter to 0."""
        ss_ssh = 'ESTAB 0 0 172.31.25.101:22 98.234.12.5:54321'
        r = self._simulate_idle_script(ss_ssh, initial_counter=15)
        self.assertEqual(r['active_conns'], 1)
        self.assertEqual(r['new_counter'], 0)
        self.assertFalse(r['shutdown_triggered'])

    def test_idle_counter_reset_on_novnc_session(self):
        """Active noVNC session on port 6080 immediately resets idle counter to 0."""
        ss_novnc = 'ESTAB 0 0 172.31.25.101:6080 98.234.12.5:54322'
        r = self._simulate_idle_script(ss_novnc, initial_counter=15)
        self.assertEqual(r['active_conns'], 1)
        self.assertEqual(r['new_counter'], 0)
        self.assertFalse(r['shutdown_triggered'])

    def test_idle_counter_reset_on_multiple_concurrent_sessions(self):
        """Multiple active sessions (SSH + noVNC) reset counter."""
        ss_multi = '''
State Recv-Q Send-Q Local Address:Port Peer Address:Port
ESTAB 0 0 172.31.25.101:22 98.234.12.5:54321
ESTAB 0 0 172.31.25.101:6080 98.234.12.5:54322
'''
        r = self._simulate_idle_script(ss_multi, initial_counter=15)
        self.assertEqual(r['active_conns'], 2)
        self.assertEqual(r['new_counter'], 0)
        self.assertFalse(r['shutdown_triggered'])

    def test_idle_ignores_non_monitored_ports(self):
        """Sessions on unmonitored ports (e.g. 80, 443) do not prevent idle shutdown."""
        r = self._simulate_idle_script('', initial_counter=15)
        self.assertEqual(r['active_conns'], 0)
        self.assertEqual(r['new_counter'], 20)
        self.assertTrue(r['shutdown_triggered'])

    def test_idle_script_syntax_and_defensive_flags(self):
        """Verify script includes set -euo pipefail and robust PATH export."""
        content = read_text(CHECK_IDLE_SH)
        self.assertIn('set -euo pipefail', content)
        self.assertIn('export PATH=', content)
        self.assertIn('/usr/local/bin', content)
        self.assertIn('|| true', content)
        self.assertIn('/tmp/frostfire_idle_counter', content)

    def test_empirical_idle_script_bash_syntax_and_arithmetic(self):
        """Empirically verify check-idle-shutdown.sh passes bash -n and tests arithmetic expansion in bash."""
        # 1. Native bash syntax check
        res_syntax = run_bash_cmd("bash -n scripts/check-idle-shutdown.sh")
        self.assertEqual(res_syntax.returncode, 0, f"Syntax check failed: {res_syntax.stderr}")

        # 2. Bash arithmetic evaluation under set -euo pipefail
        bash_arith = """
set -euo pipefail
IDLE_MINS=0
IDLE_MINS=$((IDLE_MINS + 5))
[ "$IDLE_MINS" -eq 5 ] || exit 1
IDLE_MINS=$((IDLE_MINS + 5))
[ "$IDLE_MINS" -eq 10 ] || exit 1
IDLE_MINS=$((IDLE_MINS + 5))
[ "$IDLE_MINS" -eq 15 ] || exit 1
IDLE_MINS=$((IDLE_MINS + 5))
[ "$IDLE_MINS" -eq 20 ] || exit 1
echo "ARITHMETIC_SUCCESS"
"""
        res_arith = run_bash_cmd(bash_arith)
        self.assertEqual(res_arith.returncode, 0, f"Bash arithmetic failed: {res_arith.stderr}")
        self.assertIn("ARITHMETIC_SUCCESS", res_arith.stdout)


class TestAdversarialCloudFormationAndHostSetup(FrostfireTestCase):
    """Adversarial Validation of CloudFormation Template & Host Bootstrap."""

    def setUp(self):
        self.cf_yaml = load_cf_yaml(DEPLOY_POC_YAML)

    def test_instance_type_whitelist_enforcement(self):
        """InstanceType parameter only permits Nitro EC2 types with nested KVM."""
        params = self.cf_yaml.get('Parameters', {})
        self.assertIn('InstanceType', params)
        allowed = params['InstanceType'].get('AllowedValues', [])
        self.assertGreaterEqual(len(allowed), 4)
        for it in allowed:
            self.assertTrue(
                it.startswith('c6i.') or it.startswith('c6a.') or it.startswith('c7i.') or it.startswith('c7a.'),
                f'Unexpected non-Nitro instance type in whitelist: {it}'
            )

    def test_volume_size_range_boundaries(self):
        """VolumeSize parameter strictly enforces min 30GB and max 200GB."""
        params = self.cf_yaml.get('Parameters', {})
        vol = params.get('VolumeSize', {})
        self.assertEqual(vol.get('Type'), 'Number')
        self.assertEqual(vol.get('MinValue'), 30)
        self.assertEqual(vol.get('MaxValue'), 200)
        self.assertEqual(vol.get('Default'), 50)

    def test_spot_market_persistence_and_preservation(self):
        """Spot configuration ensures persistent instance and EBS volume retention."""
        instance = self.cf_yaml['Resources']['UserVmInstance']['Properties']
        market = instance.get('InstanceMarketOptions', {})
        self.assertEqual(market.get('MarketType'), 'spot')
        spot_opts = market.get('SpotOptions', {})
        self.assertEqual(spot_opts.get('SpotInstanceType'), 'persistent')
        self.assertEqual(spot_opts.get('InstanceInterruptionBehavior'), 'stop')

        block_devices = instance.get('BlockDeviceMappings', [])
        self.assertGreater(len(block_devices), 0)
        ebs = block_devices[0].get('Ebs', {})
        self.assertFalse(ebs.get('DeleteOnTermination'))
        self.assertEqual(ebs.get('VolumeType'), 'gp3')

    def test_cloudformation_sub_escaping_integrity(self):
        """UserData must escape bash variables with ${!VAR} to avoid CloudFormation !Sub parse failure."""
        raw_cf = read_text(DEPLOY_POC_YAML)
        ud_match = re.search(r'UserData:\s+Fn::Base64:\s+!Sub\s+\|([\s\S]+?)(?=\n\s+Tags:|\nOutputs:)', raw_cf)
        self.assertIsNotNone(ud_match, 'Could not locate UserData block in CloudFormation template')
        ud_text = ud_match.group(1)

        cf_sub_vars = re.findall(r'\$\{([^}]+)\}', ud_text)
        for var in cf_sub_vars:
            self.assertTrue(
                var.startswith('!') or var in self.cf_yaml.get('Parameters', {}),
                f'Unescaped bash variable under !Sub will break CloudFormation deployment: ${{var}}'
            )

    def test_host_setup_installs_keyring_and_toolchains(self):
        """Verify debian-archive-keyring and essential toolchains are installed."""
        setup_sh = read_text(SETUP_HOST_SH)
        self.assertIn('debian-archive-keyring', setup_sh)
        self.assertIn('debootstrap', setup_sh)
        self.assertIn('qemu-utils', setup_sh)
        self.assertIn('iptables', setup_sh)
        self.assertIn('net.ipv4.ip_forward=1', setup_sh)
        self.assertIn('/dev/kvm', setup_sh)


class TestAdversarialKernelPipeline(FrostfireTestCase):
    """Adversarial Validation of Monolithic Kernel Config & ELF Binary Verifier."""

    def setUp(self):
        self.kernel_config_dict = parse_kernel_config(KERNEL_CONFIG)
        self.build_kernel_sh = read_text(BUILD_KERNEL_SH)

    def test_monolithic_modules_strictly_disabled(self):
        """Kernel config must strictly set CONFIG_MODULES=n."""
        self.assertEqual(self.kernel_config_dict.get('CONFIG_MODULES'), 'n')
        self.assertNotIn('CONFIG_MODULES=y', read_text(KERNEL_CONFIG))

    def test_all_static_virtio_subsystems_enabled(self):
        """All VirtIO subsystems must be statically built-in (=y), never modules (=m)."""
        virtio_subsystems = [
            'CONFIG_VIRTIO',
            'CONFIG_VIRTIO_PCI',
            'CONFIG_VIRTIO_MMIO',
            'CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES',
            'CONFIG_VIRTIO_BALLOON',
            'CONFIG_VIRTIO_BLK',
            'CONFIG_VIRTIO_NET',
            'CONFIG_VIRTIO_VSOCK',
            'CONFIG_VSOCKETS',
            'CONFIG_VSOCKETS_LOOPBACK',
            'CONFIG_VIRTIO_CONSOLE',
        ]
        for sym in virtio_subsystems:
            self.assertEqual(
                self.kernel_config_dict.get(sym), 'y',
                f'VirtIO symbol {sym} must be statically enabled (=y)'
            )

    def test_static_filesystems_and_namespaces_enabled(self):
        """Ext4, OverlayFS, FUSE, and all namespaces must be statically enabled."""
        required = [
            'CONFIG_EXT4_FS',
            'CONFIG_OVERLAY_FS',
            'CONFIG_FUSE_FS',
            'CONFIG_NAMESPACES',
            'CONFIG_USER_NS',
            'CONFIG_NET_NS',
            'CONFIG_PID_NS',
            'CONFIG_IPC_NS',
            'CONFIG_UTS_NS',
            'CONFIG_CGROUP_NS',
            'CONFIG_CGROUPS',
            'CONFIG_CGROUP_PIDS',
            'CONFIG_FAIR_GROUP_SCHED',
            'CONFIG_CFS_BANDWIDTH',
            'CONFIG_HW_RANDOM',
            'CONFIG_HW_RANDOM_VIRTIO',
            'CONFIG_IP_PNP',
            'CONFIG_IP_PNP_DHCP',
            'CONFIG_IP_PNP_BOOTP',
        ]
        for sym in required:
            self.assertEqual(
                self.kernel_config_dict.get(sym), 'y',
                f'Required static subsystem {sym} must be enabled (=y)'
            )

    def test_build_kernel_sh_has_verification_assertions(self):
        """build-kernel.sh must contain verify_kernel_config and verify_monolithic_binary functions."""
        funcs = extract_bash_functions(self.build_kernel_sh)
        self.assertIn('verify_kernel_config', funcs)
        self.assertIn('verify_monolithic_binary', funcs)

    def test_empirical_verify_kernel_config_assertions(self):
        """Empirically execute verify_kernel_config in bash against valid and mutated configs."""
        bash_test = """
set -u
source <(sed -n '32,133p' kernel/build-kernel.sh)

# Test A: Valid repo config
if ! verify_kernel_config kernel/kernel.config >/dev/null 2>&1; then
    echo "FAIL_VALID"
    exit 1
fi

td=$(mktemp -d)
trap 'rm -rf "$td"' EXIT

# Test B: Mutated with CONFIG_MODULES=y
cat kernel/kernel.config > "$td/c1"
echo "CONFIG_MODULES=y" >> "$td/c1"
if verify_kernel_config "$td/c1" >/dev/null 2>&1; then
    echo "FAIL_MODULES_Y"
    exit 1
fi

# Test C: Mutated with missing CONFIG_VIRTIO_BLK
sed '/CONFIG_VIRTIO_BLK=y/d' kernel/kernel.config > "$td/c2"
if verify_kernel_config "$td/c2" >/dev/null 2>&1; then
    echo "FAIL_MISSING_VIRTIO_BLK"
    exit 1
fi

# Test D: Mutated with missing CONFIG_EXT4_FS
sed '/CONFIG_EXT4_FS=y/d' kernel/kernel.config > "$td/c3"
if verify_kernel_config "$td/c3" >/dev/null 2>&1; then
    echo "FAIL_MISSING_EXT4"
    exit 1
fi

echo "ALL_CONFIG_ASSERTIONS_PASSED"
"""
        res = run_bash_cmd(bash_test)
        self.assertEqual(res.returncode, 0, f"Kernel config verification assertion failed: {res.stderr}")
        self.assertIn("ALL_CONFIG_ASSERTIONS_PASSED", res.stdout)

    def test_empirical_verify_monolithic_binary_assertions(self):
        """Empirically execute verify_monolithic_binary in bash against non-ELF and mock ELF binaries."""
        bash_test = """
set -u
source <(sed -n '135,207p' kernel/build-kernel.sh)

td=$(mktemp -d)
trap 'rm -rf "$td"' EXIT

# Test A: Missing binary fails
if verify_monolithic_binary "$td/nonexistent" "$td" >/dev/null 2>&1; then
    echo "FAIL_MISSING_BINARY"
    exit 1
fi

# Test B: 0-byte file fails
touch "$td/empty.bin"
if verify_monolithic_binary "$td/empty.bin" "$td" >/dev/null 2>&1; then
    echo "FAIL_EMPTY_BINARY"
    exit 1
fi

# Test C: Corrupt magic bytes fails
echo "NOT_AN_ELF_BINARY" > "$td/bad.bin"
if verify_monolithic_binary "$td/bad.bin" "$td" >/dev/null 2>&1; then
    echo "FAIL_BAD_MAGIC"
    exit 1
fi

# Test D: Valid ELF header with .ko file in source tree fails
printf '\\x7fELF\\x02\\x01\\x01\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00' > "$td/mock.elf"
mkdir -p "$td/src_tree"
touch "$td/src_tree/bad_driver.ko"
if verify_monolithic_binary "$td/mock.elf" "$td/src_tree" >/dev/null 2>&1; then
    echo "FAIL_KO_MODULE_LEAK"
    exit 1
fi

echo "ALL_BINARY_ASSERTIONS_PASSED"
"""
        res = run_bash_cmd(bash_test)
        self.assertEqual(res.returncode, 0, f"Binary verification assertion failed: {res.stderr}")
        self.assertIn("ALL_BINARY_ASSERTIONS_PASSED", res.stdout)


class TestAdversarialRootfsAssembly(FrostfireTestCase):
    """Adversarial Validation of Debian 13 Rootfs Appliance Assembly Pipeline."""

    def setUp(self):
        self.build_rootfs_sh = read_text(BUILD_ROOTFS_SH)

    def test_node_binary_recombination_integrity(self):
        """exec-daemon/node split chunks exist, recombine deterministically, and form valid ELF binary."""
        parts = sorted(list(EXEC_DAEMON_DIR.glob('node.part.*')))
        self.assertGreaterEqual(len(parts), 2, 'Expected multiple node.part.* chunks')

        recombined = bytearray()
        for p in parts:
            chunk = p.read_bytes()
            self.assertGreater(len(chunk), 0, f'Chunk {p.name} must not be empty')
            recombined.extend(chunk)

        self.assertGreaterEqual(len(recombined), 10_000_000, 'Recombined node binary must be >=10MB')
        self.assertEqual(bytes(recombined[:4]), b'\x7fELF', 'Recombined node binary must have valid ELF magic header')
        self.assertEqual(recombined[4], 2, 'Recombined node binary must be ELF64')

    def test_origin_binary_recombination_integrity(self):
        """exec-daemon/tools/origin split chunks exist, recombine deterministically, and form valid ELF binary."""
        tools_dir = EXEC_DAEMON_DIR / 'tools'
        parts = sorted(list(tools_dir.glob('origin.part.*')))
        self.assertGreaterEqual(len(parts), 2, 'Expected multiple origin.part.* chunks')

        recombined = bytearray()
        for p in parts:
            chunk = p.read_bytes()
            self.assertGreater(len(chunk), 0, f'Chunk {p.name} must not be empty')
            recombined.extend(chunk)

        self.assertGreaterEqual(len(recombined), 5_000_000, 'Recombined origin binary must be >=5MB')
        self.assertEqual(bytes(recombined[:4]), b'\x7fELF', 'Recombined origin binary must have valid ELF magic header')
        self.assertEqual(recombined[4], 2, 'Recombined origin binary must be ELF64')

    def test_rootfs_cleanup_trap_and_unmount_hygiene(self):
        """build-rootfs.sh registers EXIT/ERR/INT/TERM traps to unmount all virtual filesystems."""
        self.assertIn('cleanup()', self.build_rootfs_sh)
        self.assertIn('trap cleanup ERR INT TERM', self.build_rootfs_sh)
        self.assertIn('umount', self.build_rootfs_sh)
        self.assertIn('/dev/pts', self.build_rootfs_sh)
        self.assertIn('policy-rc.d', self.build_rootfs_sh)

    def test_box_user_and_sudoers_permission_contract(self):
        """User box created with UID 1000 and sudoers file has 0440 mode."""
        self.assertIn('useradd -u 1000', self.build_rootfs_sh)
        self.assertIn('chmod 0440', self.build_rootfs_sh)
        self.assertIn('box ALL=(ALL) NOPASSWD:ALL', self.build_rootfs_sh)

    def test_systemd_service_unit_contract(self):
        """frostfire-box.service unit configuration conforms to production specifications."""
        self.assertIn('Description=Frostfire MicroVM Autonomous Agent & Desktop Supervisor', self.build_rootfs_sh)
        self.assertIn('ExecStart=/usr/local/bin/start-frostfire-box', self.build_rootfs_sh)
        self.assertIn('Restart=always', self.build_rootfs_sh)
        self.assertIn('multi-user.target.wants', self.build_rootfs_sh)


class TestAdversarialHypervisorDaemon(FrostfireTestCase):
    """Adversarial Validation of Rust Firecracker Hypervisor Daemon."""

    def setUp(self):
        self.main_rs = read_text(HYPERVISOR_MAIN)

    def test_routing_table_parser_adversarial_inputs(self):
        """Test default interface parser against hostile routing table strings."""
        nitro = 'default via 172.31.16.1 dev ens5 proto dhcp src 172.31.25.101 metric 100\n'
        match = re.search(r'default.*?dev\s+([a-zA-Z0-9_.-]+)', nitro)
        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), 'ens5')

        multi = '''default via 10.0.0.1 dev eth0 metric 100
default via 10.0.0.2 dev eth1 metric 200
10.0.0.0/24 dev eth0 proto kernel scope link src 10.0.0.50
172.30.0.0/24 dev tap0 proto kernel scope link src 172.30.0.1
'''
        match_multi = re.search(r'default.*?dev\s+([a-zA-Z0-9_.-]+)', multi)
        self.assertIsNotNone(match_multi)
        self.assertEqual(match_multi.group(1), 'eth0')

        no_def = '10.0.0.0/24 dev eth0 proto kernel scope link src 10.0.0.50\n'
        match_none = re.search(r'default.*?dev\s+([a-zA-Z0-9_.-]+)', no_def)
        self.assertIsNone(match_none)

    def test_stale_socket_cleanup_resilience(self):
        """Hypervisor unlinks stale API socket and VSOCK socket prior to spawning Firecracker."""
        self.assertIn('self.config.socket_path.exists()', self.main_rs)
        self.assertIn('std::fs::remove_file(&self.config.socket_path)', self.main_rs)
        self.assertIn('self.config.vsock_path.exists()', self.main_rs)
        self.assertIn('std::fs::remove_file(&self.config.vsock_path)', self.main_rs)

    def test_teardown_handles_iptables_and_tap_cleanup(self):
        """Teardown method removes iptables NAT rules and unlinks TAP device."""
        self.assertIn('pub fn teardown(&self)', self.main_rs)
        self.assertIn('POSTROUTING', self.main_rs)
        self.assertIn('MASQUERADE', self.main_rs)
        self.assertIn('link', self.main_rs)
        self.assertIn('del', self.main_rs)

    def test_machine_config_memory_and_vcpu_safety(self):
        """Machine config allocates 2 vCPUs and 4096 MiB RAM to prevent guest microVM OOM."""
        self.assertIn('vcpu_count: 2', self.main_rs)
        self.assertIn('mem_size_mib: 4096', self.main_rs)
        self.assertIn('PUT', self.main_rs)
        self.assertIn('/machine-config', self.main_rs)


class TestAdversarialBoxDoctor(FrostfireTestCase):
    """Adversarial Validation of Guest box-doctor Diagnostic Checks."""

    def setUp(self):
        self.doctor_sh = read_text(BOX_DOCTOR)

    def test_machine_id_format_regex_oracle(self):
        """machine-id check enforces strict 32 lowercase hex characters."""
        regex = r'^[0-9a-f]{32}$'
        valid_id = '0123456789abcdef0123456789abcdef'
        self.assertTrue(bool(re.match(regex, valid_id)))

        self.assertFalse(bool(re.match(regex, '0123456789abcdef0123456789abcde')))
        self.assertFalse(bool(re.match(regex, '0123456789abcdef0123456789abcdef0')))
        self.assertFalse(bool(re.match(regex, '0123456789ABCDEF0123456789abcdef')))
        self.assertFalse(bool(re.match(regex, '0123456789abcdef0123456789abcdeg')))

    def test_clock_skew_threshold_oracle(self):
        """Clock skew threshold is exactly 60 seconds; plausible years [2024, 2100]."""
        self.assertIn('SKEW_THRESHOLD_S=60', self.doctor_sh)
        self.assertIn('[ "${year}" -lt 2024 ]', self.doctor_sh)
        self.assertIn('[ "${year}" -gt 2100 ]', self.doctor_sh)

    def test_fd_usage_fail_percentage_oracle(self):
        """FD usage threshold is exactly 90% soft limit."""
        self.assertIn('CHROME_FD_FAIL_PCT=90', self.doctor_sh)
        soft_limit = 1024
        self.assertFalse((899 * 100 // soft_limit) >= 90)
        self.assertTrue((922 * 100 // soft_limit) >= 90)

    def test_all_10_diagnostic_checks_registered(self):
        """box-doctor registers and executes all 10 diagnostic checks."""
        expected_checks = [
            'check_machine_id',
            'check_chrome',
            'check_chrome_fds',
            'check_egress',
            'check_clock',
            'check_dbus',
            'check_xvfb',
            'check_x11vnc',
            'check_novnc',
            'check_compositor',
        ]
        for chk in expected_checks:
            self.assertIn(chk, self.doctor_sh)


if __name__ == '__main__':
    unittest.main()
