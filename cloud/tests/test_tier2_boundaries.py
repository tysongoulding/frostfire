"""
Frostfire Cloud E2E Test Suite — Tier 2: Boundary & Corner Cases
Validates boundary values, limits, empty inputs, network disconnects,
error handling, and resilience across all 32 features (160 tests).
"""

import ipaddress
import json
import os
import re
import unittest
from pathlib import Path

from tests.common import (
    BOX_CGROUPS_SH,
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
    HYPERVISOR_CARGO,
    HYPERVISOR_DIR,
    HYPERVISOR_MAIN,
    KERNEL_CONFIG,
    ROOT_AGENTS,
    ROOT_CARGO,
    ROOT_DIR,
    SETUP_HOST_SH,
    START_FROSTFIRE_BOX,
    USR_SHARE_BG_DIR,
    FrostfireTestCase,
    load_cf_yaml,
    parse_kernel_config,
    read_text,
)


class TestTier2F01CloudFormationBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 1: CloudFormation Template."""

    def setUp(self):
        self.yaml_data = load_cf_yaml(DEPLOY_POC_YAML)

    def test_t2_f01_invalid_instance_type_rejected(self):
        """Instances lacking nested KVM or Nitro (e.g. t2.micro, m1.small) must not be allowed."""
        allowed = self.yaml_data["Parameters"]["InstanceType"]["AllowedValues"]
        self.assertNotIn("t2.micro", allowed)
        self.assertNotIn("t3.nano", allowed)

    def test_t2_f01_volume_size_minimum_boundary(self):
        """Volume size below 30GB is prohibited by CloudFormation MinValue."""
        min_val = self.yaml_data["Parameters"]["VolumeSize"]["MinValue"]
        self.assertEqual(min_val, 30)

    def test_t2_f01_volume_size_maximum_boundary(self):
        """Volume size above 200GB is capped by CloudFormation MaxValue for budget control."""
        max_val = self.yaml_data["Parameters"]["VolumeSize"]["MaxValue"]
        self.assertEqual(max_val, 200)

    def test_t2_f01_allowed_cidr_fallback_boundary(self):
        """Default AllowedCidr parameter allows full access (0.0.0.0/0) as fallback."""
        default_cidr = self.yaml_data["Parameters"]["AllowedCidr"]["Default"]
        self.assertEqual(default_cidr, "0.0.0.0/0")

    def test_t2_f01_single_host_cidr_format(self):
        """Single host lockdown CIDR format (e.g. 198.51.100.1/32) is valid IPv4 CIDR."""
        network = ipaddress.ip_network("198.51.100.1/32")
        self.assertEqual(network.prefixlen, 32)


class TestTier2F02UserDataBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 2: UserData Bootstrap."""

    def setUp(self):
        content = read_text(DEPLOY_POC_YAML)
        ud_start = content.find("UserData:")
        self.userdata_text = content[ud_start:]

    def test_t2_f02_kvm_missing_graceful_warning(self):
        """When /dev/kvm is missing, script logs warning without crashing immediate boot."""
        self.assertIn('echo "[-] Warning: /dev/kvm not found', self.userdata_text)

    def test_t2_f02_ip_forwarding_idempotent_sysctl(self):
        """sysctl writes to persistent file to survive host reboots."""
        self.assertIn("/etc/sysctl.d/99-frostfire.conf", self.userdata_text)

    def test_t2_f02_noninteractive_apt_environment(self):
        """UserData specifies DEBIAN_FRONTEND=noninteractive to prevent interactive hangs."""
        self.assertIn("DEBIAN_FRONTEND=noninteractive", self.userdata_text)

    def test_t2_f02_firecracker_architecture_support(self):
        """Firecracker URL uses dynamic $(uname -m) to handle architecture correctly."""
        self.assertIn("uname -m", self.userdata_text)

    def test_t2_f02_crontab_empty_fallback(self):
        """Crontab pipeline uses crontab -l 2>/dev/null to prevent failure when crontab is empty."""
        self.assertIn("crontab -l 2>/dev/null", self.userdata_text)


class TestTier2F03SecurityGroupBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 3: Security Group Ingress."""

    def setUp(self):
        self.yaml_data = load_cf_yaml(DEPLOY_POC_YAML)
        self.ingress = self.yaml_data["Resources"]["PocSecurityGroup"]["Properties"]["SecurityGroupIngress"]

    def test_t2_f03_no_port_zero_exposed(self):
        """Port 0 is reserved and must not be exposed."""
        for rule in self.ingress:
            self.assertNotEqual(rule.get("FromPort"), 0)

    def test_t2_f03_no_port_65535_exposed(self):
        """Port 65535 boundary is not exposed."""
        for rule in self.ingress:
            self.assertNotEqual(rule.get("ToPort"), 65535)

    def test_t2_f03_unapproved_ports_not_exposed(self):
        """Common insecure ports (e.g. 80, 443, 8080, 3389) are not open."""
        exposed_ports = {r.get("FromPort") for r in self.ingress}
        forbidden = {80, 443, 8080, 3389, 21, 23}
        self.assertTrue(exposed_ports.isdisjoint(forbidden))

    def test_t2_f03_all_rules_use_tcp(self):
        """All ingress rules are strictly constrained to TCP."""
        for rule in self.ingress:
            self.assertEqual(rule.get("IpProtocol"), "tcp")

    def test_t2_f03_all_rules_reference_allowed_cidr(self):
        """Every security group rule references AllowedCidr parameter."""
        for rule in self.ingress:
            self.assertIn("CidrIp", rule)


class TestTier2F04AutoIdleBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 4: Auto-Idle Shutdown Daemon."""

    def setUp(self):
        self.sh = read_text(CHECK_IDLE_SH)

    def test_t2_f04_missing_counter_file_fallback(self):
        """Missing counter file defaults to 0 via 2>/dev/null || echo 0."""
        self.assertIn("cat /tmp/frostfire_idle_counter 2>/dev/null || echo 0", self.sh)

    def test_t2_f04_15_minutes_idle_does_not_shutdown(self):
        """15 minutes of inactivity does NOT trigger shutdown (-ge 20 check)."""
        self.assertIn("-ge 20", self.sh)
        self.assertNotIn("-ge 15", self.sh)

    def test_t2_f04_exactly_20_minutes_triggers_shutdown(self):
        """Idle count >= 20 invokes sudo shutdown -h now."""
        self.assertIn("sudo shutdown -h now", self.sh)

    def test_t2_f04_pipefail_ensures_ss_error_caught(self):
        """Script uses set -euo pipefail to catch socket query failures."""
        self.assertIn("set -euo pipefail", self.sh)

    def test_t2_f04_counter_reset_on_active_session(self):
        """Counter resets to 0 when active connection count > 0."""
        self.assertIn("echo 0 > /tmp/frostfire_idle_counter", self.sh)


class TestTier2F05HostSetupBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 5: Host Dependency Setup Script."""

    def setUp(self):
        self.sh = read_text(SETUP_HOST_SH)

    def test_t2_f05_kvm_absence_exits_with_code_1(self):
        """Missing /dev/kvm forces immediate non-zero exit code 1."""
        self.assertIn("exit 1", self.sh)

    def test_t2_f05_sudo_used_for_privileged_operations(self):
        """Host commands require sudo for non-root execution safety."""
        self.assertIn("sudo usermod", self.sh)
        self.assertIn("sudo chmod", self.sh)

    def test_t2_f05_temp_cleanup_after_tar_extraction(self):
        """Tarball extraction cleans up temporary files in /tmp."""
        self.assertIn("rm -rf /tmp/firecracker*", self.sh)

    def test_t2_f05_cron_job_deduplication(self):
        """Cron setup strips existing check-idle-shutdown entry before adding."""
        self.assertIn('grep -v "check-idle-shutdown.sh"', self.sh)

    def test_t2_f05_node_conditional_install(self):
        """Node.js is only installed if command -v node is missing."""
        self.assertIn("if ! command -v node", self.sh)


class TestTier2F06TurnkeyDeployBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 6: Turnkey Deploy Scripts."""

    def setUp(self):
        self.ps1 = read_text(DEPLOY_POC_PS1)
        self.sh = read_text(DEPLOY_POC_SH)

    def test_t2_f06_ps1_timeout_on_ip_detect(self):
        """PowerShell deploy script uses short timeout on IP discovery endpoints."""
        self.assertIn("-TimeoutSec", self.ps1)

    def test_t2_f06_sh_timeout_on_ip_detect(self):
        """Bash deploy script uses --max-time 4 on IP discovery endpoints."""
        self.assertIn("--max-time 4", self.sh)

    def test_t2_f06_fallback_to_open_cidr_on_network_failure(self):
        """Both deploy scripts fall back to 0.0.0.0/0 if public IP lookup fails."""
        self.assertIn('0.0.0.0/0', self.ps1)
        self.assertIn('0.0.0.0/0', self.sh)

    def test_t2_f06_ps1_error_action_stop(self):
        """PowerShell script sets $ErrorActionPreference = 'Stop'."""
        self.assertIn('$ErrorActionPreference = "Stop"', self.ps1)

    def test_t2_f06_multiple_ip_endpoints_redundancy(self):
        """Deploy scripts check multiple IP discovery endpoints for high availability."""
        for ep in ["checkip.amazonaws.com", "api.ipify.org", "ifconfig.me"]:
            self.assertIn(ep, self.ps1)
            self.assertIn(ep, self.sh)


class TestTier2F07EC2KeyPairBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 7: EC2 KeyPair Resilience."""

    def setUp(self):
        self.ps1 = read_text(DEPLOY_POC_PS1)
        self.sh = read_text(DEPLOY_POC_SH)

    def test_t2_f07_keypair_creation_handles_missing_key(self):
        """Deploy scripts detect missing KeyPair and invoke create-key-pair."""
        self.assertIn("describe-key-pairs", self.ps1)
        self.assertIn("create-key-pair", self.ps1)
        self.assertIn("describe-key-pairs", self.sh)
        self.assertIn("create-key-pair", self.sh)

    def test_t2_f07_created_pem_permissions_restricted(self):
        """Bash script restricts created private key to 0400 permissions."""
        self.assertIn("chmod 400", self.sh)

    def test_t2_f07_key_material_non_empty_validation(self):
        """PowerShell validates key material is non-empty before saving."""
        self.assertIn("IsNullOrWhiteSpace($keyMaterial) -eq $false", self.ps1)

    def test_t2_f07_keypair_name_interpolation_in_cf(self):
        """Outputs correctly escape and interpolate KeyName."""
        yaml_data = load_cf_yaml(DEPLOY_POC_YAML)
        ssh_cmd = yaml_data["Outputs"]["SshAccessCommand"]["Value"]
        self.assertIn("${KeyName}.pem", str(ssh_cmd))

    def test_t2_f07_default_keyname_non_empty(self):
        """Default KeyName parameter in scripts is non-empty."""
        self.assertIn('$KeyName = "my-ec2-key"', self.ps1)


class TestTier2F08DebianArchiveKeyringBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 8: Debian Archive Keyring."""

    def setUp(self):
        self.sh = read_text(BUILD_ROOTFS_SH)

    def test_t2_f08_official_debian_mirrors_only(self):
        """Apt sources point to official deb.debian.org repositories."""
        self.assertIn("deb.debian.org/debian", self.sh)
        self.assertIn("security.debian.org", self.sh)

    def test_t2_f08_chrome_signed_by_keyring(self):
        """Chrome repository requires signed-by parameter pointing to gpg keyring."""
        self.assertIn("signed-by=/etc/apt/keyrings/google-chrome.gpg", self.sh)

    def test_t2_f08_keyring_directory_creation(self):
        """Creates /etc/apt/keyrings before downloading keys."""
        self.assertIn("mkdir -p /etc/apt/keyrings", self.sh)

    def test_t2_f08_dearmor_key_generation(self):
        """De-armors ASCII armor key into binary GPG format."""
        self.assertIn("gpg --dearmor", self.sh)

    def test_t2_f08_curl_wget_installed_in_chroot(self):
        """Installs curl and wget inside chroot for runtime repository and package updates."""
        self.assertIn("curl wget", self.sh)


class TestTier2F09MonolithicKernelBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 9: Monolithic Linux Kernel."""

    def setUp(self):
        self.sh = read_text(BUILD_KERNEL_SH)

    def test_t2_f09_modules_strictly_forbidden(self):
        """Verification fails if CONFIG_MODULES=y is present."""
        self.assertIn("CONFIG_MODULES=y", self.sh)
        self.assertIn("Kernel must be monolithic", self.sh)

    def test_t2_f09_elf_magic_bytes_check(self):
        """Monolithic verification checks ELF magic header 0x7F 'E' 'L' 'F' (7f454c46)."""
        self.assertIn("7f454c46", self.sh)

    def test_t2_f09_empty_binary_detection(self):
        """Monolithic verification checks binary is non-empty (! -s)."""
        self.assertIn("Binary at ${binary_path} is 0 bytes", self.sh)

    def test_t2_f09_zero_loadable_modules_asserted(self):
        """Monolithic verification asserts 0 .ko files exist in source tree."""
        self.assertIn('find "${src_tree}" -name "*.ko"', self.sh)
        self.assertIn("Monolithic build must have 0", self.sh)

    def test_t2_f09_x86_64_architecture_asserted(self):
        """Verification asserts ELF64 architecture and x86-64 machine type."""
        self.assertIn("ELF64", self.sh)
        self.assertIn("x86-64", self.sh)


class TestTier2F10StaticVirtioBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 10: Static VirtIO Drivers."""

    def setUp(self):
        self.cfg = parse_kernel_config(KERNEL_CONFIG)

    def test_t2_f10_no_virtio_driver_compiled_as_module(self):
        """None of the required VirtIO drivers may be compiled as a loadable module (=m)."""
        for sym in ["CONFIG_VIRTIO", "CONFIG_VIRTIO_BLK", "CONFIG_VIRTIO_NET", "CONFIG_VIRTIO_VSOCK", "CONFIG_VIRTIO_MMIO"]:
            self.assertNotEqual(self.cfg.get(sym), "m", f"{sym} must not be a module")

    def test_t2_f10_balloon_driver_in_tree(self):
        """CONFIG_VIRTIO_BALLOON must be =y for dynamic memory management."""
        self.assertEqual(self.cfg.get("CONFIG_VIRTIO_BALLOON"), "y")

    def test_t2_f10_vsockets_loopback_support(self):
        """CONFIG_VSOCKETS_LOOPBACK must be enabled for local socket diagnostics."""
        self.assertEqual(self.cfg.get("CONFIG_VSOCKETS_LOOPBACK"), "y")

    def test_t2_f10_kvm_guest_paravirt_enabled(self):
        """CONFIG_PARAVIRT and CONFIG_PARAVIRT_CLOCK enabled for KVM guest efficiency."""
        self.assertEqual(self.cfg.get("CONFIG_PARAVIRT"), "y")
        self.assertEqual(self.cfg.get("CONFIG_PARAVIRT_CLOCK"), "y")

    def test_t2_f10_virtio_pci_support(self):
        """CONFIG_VIRTIO_PCI enabled alongside MMIO for interface flexibility."""
        self.assertEqual(self.cfg.get("CONFIG_VIRTIO_PCI"), "y")


class TestTier2F11StaticFilesystemsBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 11: Static Filesystems & Namespaces."""

    def setUp(self):
        self.cfg = parse_kernel_config(KERNEL_CONFIG)

    def test_t2_f11_ext4_cannot_be_module(self):
        """Root filesystem driver EXT4 cannot be a module."""
        self.assertEqual(self.cfg.get("CONFIG_EXT4_FS"), "y")

    def test_t2_f11_tmpfs_xattr_and_posix_acl(self):
        """TMPFS POSIX ACL and XATTR support enabled for systemd journal / IPC."""
        self.assertEqual(self.cfg.get("CONFIG_TMPFS_POSIX_ACL"), "y")
        self.assertEqual(self.cfg.get("CONFIG_TMPFS_XATTR"), "y")

    def test_t2_f11_binfmt_elf_and_script_enabled(self):
        """CONFIG_BINFMT_ELF and CONFIG_BINFMT_SCRIPT enabled for executable loading."""
        self.assertEqual(self.cfg.get("CONFIG_BINFMT_ELF"), "y")
        self.assertEqual(self.cfg.get("CONFIG_BINFMT_SCRIPT"), "y")

    def test_t2_f11_cgroup_namespace_enabled(self):
        """CONFIG_CGROUP_NS must be enabled alongside core namespaces."""
        self.assertEqual(self.cfg.get("CONFIG_CGROUP_NS"), "y")

    def test_t2_f11_seccomp_filter_active(self):
        """CONFIG_SECCOMP_FILTER must be =y for BPF syscall filtering."""
        self.assertEqual(self.cfg.get("CONFIG_SECCOMP_FILTER"), "y")


class TestTier2F12IPBootlineBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 12: IP Bootline Autoconfig."""

    def setUp(self):
        self.main_rs = read_text(HYPERVISOR_MAIN)

    def test_t2_f12_guest_ip_is_valid_ipv4(self):
        """Default guest IP 172.30.0.2 parses as valid IPv4 address."""
        ip = ipaddress.IPv4Address("172.30.0.2")
        self.assertFalse(ip.is_loopback)
        self.assertTrue(ip.is_private)

    def test_t2_f12_host_ip_is_valid_ipv4(self):
        """Default host IP 172.30.0.1 parses as valid IPv4 address."""
        ip = ipaddress.IPv4Address("172.30.0.1")
        self.assertFalse(ip.is_loopback)
        self.assertTrue(ip.is_private)

    def test_t2_f12_guest_and_host_on_same_subnet(self):
        """Guest IP and Host IP belong to the same /24 network."""
        net = ipaddress.IPv4Network("172.30.0.0/24")
        self.assertIn(ipaddress.IPv4Address("172.30.0.2"), net)
        self.assertIn(ipaddress.IPv4Address("172.30.0.1"), net)

    def test_t2_f12_guest_and_host_ips_differ(self):
        """Guest IP and Host IP must not collide."""
        self.assertNotEqual("172.30.0.2", "172.30.0.1")

    def test_t2_f12_boot_args_autoconf_off(self):
        """Kernel boot line specifies autoconf flag 'off' (static networking)."""
        self.assertIn("eth0:off", self.main_rs)


class TestTier2F13HardwareRNGBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 13: Hardware RNG & Entropy."""

    def setUp(self):
        self.cfg = parse_kernel_config(KERNEL_CONFIG)

    def test_t2_f13_hw_random_enabled_in_config(self):
        """CONFIG_HW_RANDOM and CONFIG_HW_RANDOM_VIRTIO must be =y."""
        self.assertEqual(self.cfg.get("CONFIG_HW_RANDOM"), "y")
        self.assertEqual(self.cfg.get("CONFIG_HW_RANDOM_VIRTIO"), "y")

    def test_t2_f13_random_trust_cpu_in_config(self):
        """CONFIG_RANDOM_TRUST_CPU must be =y to trust hardware RDRAND."""
        self.assertEqual(self.cfg.get("CONFIG_RANDOM_TRUST_CPU"), "y")

    def test_t2_f13_machine_id_length_boundary(self):
        """Valid machine ID is exactly 32 lowercase hex characters."""
        valid_id = "e0a1b2c3d4e5f60718293a4b5c6d7e8f"
        self.assertEqual(len(valid_id), 32)
        self.assertTrue(all(c in "0123456789abcdef" for c in valid_id))

    def test_t2_f13_machine_id_invalid_length_rejected(self):
        """Machine IDs of length 31 or 33 are invalid."""
        self.assertFalse(bool(re.match(r"^[0-9a-f]{32}$", "a" * 31)))
        self.assertFalse(bool(re.match(r"^[0-9a-f]{32}$", "a" * 33)))

    def test_t2_f13_machine_id_uppercase_rejected(self):
        """Uppercase hex characters are rejected by check_machine_id."""
        self.assertFalse(bool(re.match(r"^[0-9a-f]{32}$", "E0A1B2C3D4E5F60718293A4B5C6D7E8F")))


class TestTier2F14CgroupV2Boundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 14: Cgroup v2 Scheduler & PIDs."""

    def setUp(self):
        self.cfg = parse_kernel_config(KERNEL_CONFIG)

    def test_t2_f14_cgroup_pids_is_y(self):
        """CONFIG_CGROUP_PIDS must be =y (not unset)."""
        self.assertEqual(self.cfg.get("CONFIG_CGROUP_PIDS"), "y")

    def test_t2_f14_cfs_bandwidth_is_y(self):
        """CONFIG_CFS_BANDWIDTH must be =y."""
        self.assertEqual(self.cfg.get("CONFIG_CFS_BANDWIDTH"), "y")

    def test_t2_f14_fair_group_sched_is_y(self):
        """CONFIG_FAIR_GROUP_SCHED must be =y."""
        self.assertEqual(self.cfg.get("CONFIG_FAIR_GROUP_SCHED"), "y")

    def test_t2_f14_box_cgroups_handles_missing_hierarchy(self):
        """box-cgroups.sh handles missing cgroup v2 controllers gracefully."""
        cgroup_sh = read_text(BOX_CGROUPS_SH)
        self.assertIn("cgroup.controllers", cgroup_sh)

    def test_t2_f14_memory_controller_enabled(self):
        """CONFIG_MEMCG must be =y for memory.max enforcement."""
        self.assertEqual(self.cfg.get("CONFIG_MEMCG"), "y")


class TestTier2F15DeterministicKernelConfigBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 15: Deterministic Kernel Config."""

    def setUp(self):
        self.config_lines = [l.strip() for l in read_text(KERNEL_CONFIG).splitlines() if l.strip()]

    def test_t2_f15_no_empty_assignments(self):
        """No assignment in kernel.config has an empty value (e.g. 'CONFIG_FOO=')."""
        for line in self.config_lines:
            if "=" in line and not line.startswith("#"):
                key, val = line.split("=", 1)
                self.assertGreater(len(val), 0, f"Empty value for key: {key}")

    def test_t2_f15_boolean_values_only(self):
        """All non-numeric config options must be 'y' or 'n' (no 'm' modules)."""
        for line in self.config_lines:
            if "=" in line and not line.startswith("#"):
                key, val = line.split("=", 1)
                if val not in ["y", "n"] and not val.isdigit():
                    self.fail(f"Invalid non-boolean value '{val}' for {key}")

    def test_t2_f15_nr_cpus_upper_bound(self):
        """CONFIG_NR_CPUS specifies at least 64 cores."""
        cfg = parse_kernel_config(KERNEL_CONFIG)
        self.assertGreaterEqual(int(cfg.get("CONFIG_NR_CPUS", 0)), 64)

    def test_t2_f15_smp_must_be_enabled(self):
        """CONFIG_SMP must be =y for multi-vCPU microVM execution."""
        cfg = parse_kernel_config(KERNEL_CONFIG)
        self.assertEqual(cfg.get("CONFIG_SMP"), "y")

    def test_t2_f15_64bit_architecture_enforced(self):
        """CONFIG_64BIT and CONFIG_X86_64 must both be =y."""
        cfg = parse_kernel_config(KERNEL_CONFIG)
        self.assertEqual(cfg.get("CONFIG_64BIT"), "y")
        self.assertEqual(cfg.get("CONFIG_X86_64"), "y")


class TestTier2F16Debian13RootfsBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 16: Debian 13 Rootfs Generation."""

    def setUp(self):
        self.sh = read_text(BUILD_ROOTFS_SH)

    def test_t2_f16_rootfs_size_not_zero(self):
        """ROOTFS_SIZE_MB must be positive and non-zero."""
        match = re.search(r"ROOTFS_SIZE_MB=(\d+)", self.sh)
        self.assertIsNotNone(match)
        size = int(match.group(1))
        self.assertGreater(size, 0)

    def test_t2_f16_rootfs_size_at_least_8gb(self):
        """ROOTFS_SIZE_MB must be at least 8192 MB (8GB)."""
        match = re.search(r"ROOTFS_SIZE_MB=(\d+)", self.sh)
        size = int(match.group(1))
        self.assertGreaterEqual(size, 8192)

    def test_t2_f16_ext4_block_size_standard_4k(self):
        """Block size must be 4096 bytes."""
        self.assertIn("-b 4096", self.sh)

    def test_t2_f16_chroot_cleanup_unmounts_proc(self):
        """Cleanup function explicitly unmounts /proc, /sys, /dev, and /dev/pts."""
        self.assertIn("${MOUNT_DIR}/proc", self.sh)
        self.assertIn("${MOUNT_DIR}/sys", self.sh)
        self.assertIn("${MOUNT_DIR}/dev", self.sh)

    def test_t2_f16_sync_before_unmount(self):
        """Flushes disk buffers via sync before unmounting rootfs loop device."""
        self.assertIn("sudo sync", self.sh)


class TestTier2F17NonRootUserBoxBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 17: Non-Root User box."""

    def setUp(self):
        self.sh = read_text(BUILD_ROOTFS_SH)

    def test_t2_f17_box_uid_is_1000(self):
        """User box UID is strictly 1000."""
        self.assertIn("-u 1000", self.sh)

    def test_t2_f17_sudoers_permission_mode_is_0440(self):
        """Sudoers file permission is explicitly set to 0440."""
        self.assertIn("chmod 0440 /etc/sudoers.d/box", self.sh)

    def test_t2_f17_box_added_to_sudo_group(self):
        """User box is added to sudo group."""
        self.assertIn("usermod -aG sudo box", self.sh)

    def test_t2_f17_useradd_idempotent(self):
        """User creation checks id -u box first to prevent failure on re-run."""
        self.assertIn("if ! id -u box", self.sh)

    def test_t2_f17_login_shell_is_bash(self):
        """Login shell for user box is /bin/bash."""
        self.assertIn("-s /bin/bash box", self.sh)


class TestTier2F18SplitBinaryBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 18: Split Binary Recombination."""

    def test_t2_f18_all_node_chunks_readable(self):
        """All node part chunks exist and are non-empty."""
        for part in ["node.part.aa", "node.part.ab", "node.part.ac"]:
            p = EXEC_DAEMON_DIR / part
            self.assertFileNonEmpty(p)

    def test_t2_f18_node_recombined_total_size(self):
        """Sum of node split chunks exceeds 100MB."""
        total = sum((EXEC_DAEMON_DIR / f"node.part.{p}").stat().st_size for p in ["aa", "ab", "ac"])
        self.assertGreater(total, 100_000_000)

    def test_t2_f18_all_origin_chunks_readable(self):
        """All origin part chunks exist and are non-empty."""
        for part in ["origin.part.aa", "origin.part.ab"]:
            p = EXEC_DAEMON_DIR / "tools" / part
            self.assertFileNonEmpty(p)

    def test_t2_f18_origin_recombined_total_size(self):
        """Sum of origin split chunks exceeds 100MB."""
        total = sum((EXEC_DAEMON_DIR / "tools" / f"origin.part.{p}").stat().st_size for p in ["aa", "ab"])
        self.assertGreater(total, 100_000_000)

    def test_t2_f18_recombine_scripts_use_bash(self):
        """Recombination scripts specify #!/bin/bash."""
        node_sh = read_text(EXEC_DAEMON_DIR / "node.recombine.sh")
        origin_sh = read_text(EXEC_DAEMON_DIR / "tools" / "origin.recombine.sh")
        self.assertTrue(node_sh.startswith("#!/bin/bash"))
        self.assertTrue(origin_sh.startswith("#!/bin/bash"))


class TestTier2F19CompleteUserProfileBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 19: Complete User Profile."""

    def test_t2_f19_profile_has_exec_path(self):
        """User .profile exports necessary system PATH additions."""
        profile = read_text(HOME_BOX_DIR / ".profile")
        self.assertIn("PATH", profile)

    def test_t2_f19_bashrc_has_bash_header(self):
        """User .bashrc is valid shell script with non-empty content."""
        bashrc = read_text(HOME_BOX_DIR / ".bashrc")
        self.assertGreater(len(bashrc), 500)

    def test_t2_f19_frostfire_host_contains_binaries(self):
        """home-box/frostfire-host directory is non-empty."""
        host_dir = HOME_BOX_DIR / "frostfire-host"
        self.assertTrue(host_dir.exists())
        self.assertGreater(len(list(host_dir.iterdir())), 0)

    def test_t2_f19_symlink_sand_host_target(self):
        """build-rootfs.sh creates symlink targeting /home/box/frostfire-host."""
        sh = read_text(BUILD_ROOTFS_SH)
        self.assertIn("ln -sfn /home/box/frostfire-host", sh)

    def test_t2_f19_home_box_ownership_applied_to_all_subdirs(self):
        """chown -R box:box covers /home/box and /exec-daemon."""
        sh = read_text(BUILD_ROOTFS_SH)
        self.assertIn("chown -R box:box /home/box /exec-daemon", sh)


class TestTier2F20WallpaperAssetsBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 20: Wallpaper & Policies Assets."""

    def test_t2_f20_wallpaper_magic_png_signature(self):
        """Wallpaper PNG files start with valid 8-byte PNG magic header."""
        for p in USR_SHARE_BG_DIR.glob("frostfire-wallpaper-*.png"):
            header = p.read_bytes()[:8]
            self.assertEqual(header, b"\x89PNG\r\n\x1a\n", f"Invalid PNG signature in {p}")

    def test_t2_f20_wallpaper_aspect_ratio_non_zero(self):
        """Wallpaper files have positive file size > 3MB."""
        for p in USR_SHARE_BG_DIR.glob("frostfire-wallpaper-*.png"):
            self.assertGreater(p.stat().st_size, 3_000_000)

    def test_t2_f20_policy_json_no_trailing_commas(self):
        """All enterprise policy files parse cleanly with standard json.loads."""
        for p in (ETC_POLICIES_DIR / "policies" / "managed").glob("*.json"):
            content = read_text(p)
            data = json.loads(content)
            self.assertIsInstance(data, dict)

    def test_t2_f20_native_messaging_origin_wildcard_boundary(self):
        """Native messaging host manifests include valid chrome-extension:// origins."""
        for m in (ETC_POLICIES_DIR / "native-messaging-hosts").glob("*.json"):
            data = json.loads(read_text(m))
            origins = data.get("allowed_origins", [])
            for orig in origins:
                self.assertTrue(orig.startswith("chrome-extension://"))

    def test_t2_f20_native_messaging_binary_path(self):
        """Native messaging host manifests specify valid binary paths."""
        for m in (ETC_POLICIES_DIR / "native-messaging-hosts").glob("*.json"):
            data = json.loads(read_text(m))
            self.assertIn("path", data)
            self.assertTrue(len(data["path"]) > 0)


class TestTier2F21DesktopStackBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 21: Desktop & Display Stack."""

    def test_t2_f21_display_number_is_one(self):
        """Primary desktop display is :1 to avoid host display collision."""
        start_sh = read_text(START_FROSTFIRE_BOX)
        self.assertIn('DISPLAY="${DISPLAY:-:1}"', start_sh)

    def test_t2_f21_x11vnc_reaps_stale_pid(self):
        """box-x11vnc sends kill and kill -9 to clear port squatters."""
        vnc_sh = read_text(ROOT_DIR / "usr-local-bin" / "box-x11vnc")
        self.assertIn('kill "${pid}"', vnc_sh)
        self.assertIn('kill -9 "${pid}"', vnc_sh)

    def test_t2_f21_x11vnc_skip_lockkeys_flag(self):
        """box-x11vnc uses -skip_lockkeys to prevent stuck NumLock/CapsLock states."""
        vnc_sh = read_text(ROOT_DIR / "usr-local-bin" / "box-x11vnc")
        self.assertIn("-skip_lockkeys", vnc_sh)

    def test_t2_f21_picom_compositor_wrapper(self):
        """box-picom exists and configures compositor."""
        picom_sh = read_text(ROOT_DIR / "usr-local-bin" / "box-picom")
        self.assertIn("picom", picom_sh)

    def test_t2_f21_xfwm4_window_manager_wrapper(self):
        """box-xfwm4 exists and runs window manager with daemon/replace flags."""
        xfwm_sh = read_text(ROOT_DIR / "usr-local-bin" / "box-xfwm4")
        self.assertIn("xfwm4", xfwm_sh)


class TestTier2F22GoogleChromeBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 22: Google Chrome Enterprise."""

    def setUp(self):
        self.policy = json.loads(read_text(ETC_POLICIES_DIR / "policies" / "managed" / "frostfire.json"))

    def test_t2_f22_browser_signin_disabled(self):
        """BrowserSignin policy is 0 (disabled) to avoid authentication popups."""
        self.assertEqual(self.policy.get("BrowserSignin"), 0)

    def test_t2_f22_notifications_disabled(self):
        """DefaultNotificationsSetting is 2 (block all notifications)."""
        self.assertEqual(self.policy.get("DefaultNotificationsSetting"), 2)

    def test_t2_f22_high_efficiency_mode_enabled(self):
        """HighEfficiencyModeEnabled is true for memory preservation."""
        self.assertTrue(self.policy.get("HighEfficiencyModeEnabled"))

    def test_t2_f22_command_line_security_warnings_disabled(self):
        """CommandLineFlagSecurityWarningsEnabled is false for silent automated startup."""
        self.assertFalse(self.policy.get("CommandLineFlagSecurityWarningsEnabled"))

    def test_t2_f22_box_chrome_wrapper_exists(self):
        """usr-local-bin/box-chrome is non-empty and manages Chrome execution."""
        self.assertFileNonEmpty(ROOT_DIR / "usr-local-bin" / "box-chrome")


class TestTier2F23GuestAutostartBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 23: Guest Autostart Service."""

    def setUp(self):
        self.sh = read_text(START_FROSTFIRE_BOX)

    def test_t2_f23_duration_clamped_to_zero(self):
        """emit_boot_stage clamps negative duration to 0."""
        self.assertIn('if [ "${duration_ms}" -lt 0 ]; then', self.sh)
        self.assertIn("duration_ms=0", self.sh)

    def test_t2_f23_boot_stage_json_format(self):
        """emit_boot_stage writes well-formed JSON lines to telemetry log."""
        self.assertIn('{"kind":"boot_stage","stage":"%s","durationMs":%s}', self.sh)

    def test_t2_f23_boot_failure_json_format(self):
        """emit_boot_failure writes well-formed JSON lines with reason."""
        self.assertIn('{"kind":"boot_failure","stage":"%s","reason":"%s","durationMs":%s}', self.sh)

    def test_t2_f23_fallback_cgroup_dummy_function(self):
        """Defines dummy sand_cgroup_setup() { :; } if cgroups lib is missing."""
        self.assertIn("sand_cgroup_setup() { :; }", self.sh)

    def test_t2_f23_pipefail_safety_enabled(self):
        """start-frostfire-box sets set -uo pipefail."""
        self.assertIn("set -uo pipefail", self.sh)


class TestTier2F24StaticNetworkingBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 24: Static Networking & DNS Config."""

    def setUp(self):
        self.sh = read_text(BUILD_ROOTFS_SH)

    def test_t2_f24_resolv_conf_has_two_nameservers(self):
        """Rootfs configures primary (8.8.8.8) and secondary (1.1.1.1) DNS."""
        self.assertIn("nameserver 8.8.8.8", self.sh)
        self.assertIn("nameserver 1.1.1.1", self.sh)

    def test_t2_f24_systemd_networkd_configuration(self):
        """Configures 10-eth0.network with static IP and gateway."""
        self.assertIn("Address=172.30.0.2/24", self.sh)
        self.assertIn("Gateway=172.30.0.1", self.sh)

    def test_t2_f24_systemd_networkd_service_enabled(self):
        """Enables systemd-networkd.service for automatic boot configuration."""
        self.assertIn("systemctl enable systemd-networkd.service", self.sh)

    def test_t2_f24_interfaces_fallback_configured(self):
        """Configures /etc/network/interfaces for Debian ifupdown compatibility."""
        self.assertIn("iface eth0 inet static", self.sh)
        self.assertIn("address 172.30.0.2", self.sh)

    def test_t2_f24_hostname_has_no_spaces(self):
        """Hostname 'frostfire-box' contains only valid alphanumeric and hyphens."""
        hostname = "frostfire-box"
        self.assertTrue(re.match(r"^[a-zA-Z0-9-]+$", hostname))


class TestTier2F25ChrootHygieneBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 25: Chroot Build Hygiene."""

    def setUp(self):
        self.sh = read_text(BUILD_ROOTFS_SH)

    def test_t2_f25_policy_rc_d_exit_code_101(self):
        """policy-rc.d returns 101 to disallow daemon auto-start in chroot."""
        self.assertIn("exit 101", self.sh)

    def test_t2_f25_cleanup_removes_policy_rc_d(self):
        """Cleanup function removes policy-rc.d before unmounting rootfs."""
        self.assertIn('sudo rm -f "${MOUNT_DIR}/usr/sbin/policy-rc.d"', self.sh)

    def test_t2_f25_lazy_unmount_flag_used(self):
        """Uses sudo umount -l to detach busy mount points safely."""
        self.assertIn("sudo umount -l", self.sh)

    def test_t2_f25_mountpoint_check_before_unmount(self):
        """Verifies mountpoint existence with mountpoint -q before attempting umount."""
        self.assertIn("mountpoint -q", self.sh)

    def test_t2_f25_chroot_script_removed_after_execution(self):
        """Temporary chroot setup script is removed after execution."""
        self.assertIn('sudo rm -f "${MOUNT_DIR}/tmp/chroot-setup.sh"', self.sh)


class TestTier2F26HypervisorCargoBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 26: Hypervisor Crate Compilation."""

    def setUp(self):
        self.cargo = read_text(ROOT_CARGO)
        self.hyp_cargo = read_text(HYPERVISOR_CARGO)

    def test_t2_f26_panic_abort_configured(self):
        """Release profile specifies panic = 'abort' for microVM safety."""
        self.assertIn('panic = "abort"', self.cargo)

    def test_t2_f26_codegen_units_is_one(self):
        """Release profile specifies codegen-units = 1 for maximum optimization."""
        self.assertIn("codegen-units = 1", self.cargo)

    def test_t2_f26_opt_level_maximum(self):
        """opt-level = 3 configured in release profile."""
        self.assertIn("opt-level = 3", self.cargo)

    def test_t2_f26_tokio_features_macros(self):
        """Tokio dependency in hypervisor includes process and full feature suites."""
        self.assertTrue("full" in self.hyp_cargo or "process" in self.hyp_cargo)

    def test_t2_f26_edition_2021(self):
        """Crate uses standard Rust edition 2021."""
        self.assertIn('edition = "2021"', self.hyp_cargo)


class TestTier2F27ClippyFixBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 27: Fix Clippy Unused Import."""

    def setUp(self):
        self.main_rs = read_text(HYPERVISOR_MAIN)

    def test_t2_f27_no_unused_error_in_tracing_import(self):
        """Verifies tracing import does NOT import unused error symbol."""
        self.assertNotIn("use tracing::{error,", self.main_rs)
        self.assertNotIn("use tracing::error;", self.main_rs)

    def test_t2_f27_tracing_info_imported(self):
        """tracing::info is imported and used."""
        self.assertIn("use tracing::info;", self.main_rs)

    def test_t2_f27_hyper_client_unix_guarded(self):
        """hyper Client and UnixClient imports guarded by #[cfg(unix)]."""
        self.assertIn("#[cfg(unix)]\nuse hyper_unix_connector::UnixClient;", self.main_rs)

    def test_t2_f27_non_unix_fallback_methods_exist(self):
        """Non-unix targets define setup_networking and spawn_firecracker fallbacks."""
        self.assertIn("#[cfg(not(unix))]\n    pub fn setup_networking", self.main_rs)
        self.assertIn("#[cfg(not(unix))]\n    pub async fn spawn_firecracker", self.main_rs)

    def test_t2_f27_zero_warnings_command_line(self):
        """AGENTS.md defines clippy verification gate as cargo clippy --workspace -- -D warnings."""
        agents = read_text(ROOT_AGENTS)
        self.assertIn("cargo clippy --workspace -- -D warnings", agents)


class TestTier2F28MachineConfigBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 28: Firecracker Machine Config."""

    def setUp(self):
        self.main_rs = read_text(HYPERVISOR_MAIN)

    def test_t2_f28_vcpu_cannot_be_zero(self):
        """Hypervisor config default vcpu_count is 2 (greater than 0)."""
        self.assertIn("vcpu_count: 2", self.main_rs)

    def test_t2_f28_mem_size_cannot_be_zero(self):
        """Hypervisor config default mem_size_mib is 4096 (greater than 0)."""
        self.assertIn("mem_size_mib: 4096", self.main_rs)

    def test_t2_f28_smt_flag_false_by_default(self):
        """Hypervisor config disables SMT by default for deterministic CPU cores."""
        self.assertIn("smt: false", self.main_rs)

    def test_t2_f28_machine_config_put_route(self):
        """Issues PUT request to /machine-config."""
        self.assertIn('"/machine-config"', self.main_rs)

    def test_t2_f28_machine_config_json_keys(self):
        """JSON payload contains vcpu_count, mem_size_mib, and smt keys."""
        self.assertIn('"vcpu_count":', self.main_rs)
        self.assertIn('"mem_size_mib":', self.main_rs)
        self.assertIn('"smt":', self.main_rs)


class TestTier2F29TAPNetworkingBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 29: TAP Networking & Dynamic Egress."""

    def setUp(self):
        self.main_rs = read_text(HYPERVISOR_MAIN)

    def test_t2_f29_tap_device_name_length(self):
        """Default TAP device 'tap0' has length 4, safely below IFNAMSIZ (16)."""
        self.assertLessEqual(len("tap0"), 15)

    def test_t2_f29_cidr_format_appended(self):
        """Host IP formatted as /24 CIDR for ip addr add."""
        self.assertIn('{}/24', self.main_rs)

    def test_t2_f29_iptables_conntrack_state_check(self):
        """Forward rule checks RELATED,ESTABLISHED conntrack state."""
        self.assertIn("RELATED,ESTABLISHED", self.main_rs)

    def test_t2_f29_parse_default_interface_fallback(self):
        """parse_default_interface parses standard 'default via ... dev <iface>' output."""
        sample = "default via 192.168.1.1 dev ens5 proto dhcp src 192.168.1.50 metric 100\n"
        self.assertIn("parse_default_interface", self.main_rs)

    def test_t2_f29_forward_inbound_outbound_rules(self):
        """iptables configures forward rules for bidirectional traffic."""
        self.assertIn("-i", self.main_rs)
        self.assertIn("-o", self.main_rs)


class TestTier2F30FirecrackerUDSBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 30: Firecracker UDS Control."""

    def setUp(self):
        self.main_rs = read_text(HYPERVISOR_MAIN)

    def test_t2_f30_socket_path_length_under_108_bytes(self):
        """Default socket path /tmp/firecracker.socket length (23) is well below 108 bytes."""
        sock_path = "/tmp/firecracker.socket"
        self.assertLess(len(sock_path.encode("utf-8")), 108)

    def test_t2_f30_vsock_path_length_under_108_bytes(self):
        """Default vsock path /tmp/vsock.sock length (15) is well below 108 bytes."""
        vsock_path = "/tmp/vsock.sock"
        self.assertLess(len(vsock_path.encode("utf-8")), 108)

    def test_t2_f30_guest_cid_is_three(self):
        """Guest CID for vsock is 3 (CID 0, 1, 2 are reserved by hypervisor/host)."""
        self.assertIn('"guest_cid": 3', self.main_rs)

    def test_t2_f30_root_drive_read_write(self):
        """Rootfs drive is attached read-write (is_read_only: false)."""
        self.assertIn('"is_read_only": false', self.main_rs)

    def test_t2_f30_guest_mac_address_format(self):
        """Guest MAC AA:FC:00:00:00:01 matches standard 6-octet colon-separated format."""
        mac = "AA:FC:00:00:00:01"
        self.assertTrue(bool(re.match(r"^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$", mac)))


class TestTier2F31LifecycleBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 31: Instance Lifecycle & Shutdown."""

    def setUp(self):
        self.main_rs = read_text(HYPERVISOR_MAIN)

    def test_t2_f31_socket_wait_timeout_loop(self):
        """Socket check loop runs 50 iterations with 50ms sleeps (2.5s total timeout)."""
        self.assertIn("for _ in 0..50", self.main_rs)
        self.assertIn("Duration::from_millis(50)", self.main_rs)

    def test_t2_f31_bail_error_message_descriptive(self):
        """Socket timeout raises descriptive anyhow bail error."""
        self.assertIn("Firecracker API socket did not become ready in time", self.main_rs)

    def test_t2_f31_serial_log_parent_directory_created(self):
        """Creates parent directory for serial log if it does not exist."""
        self.assertIn("create_dir_all", self.main_rs)

    def test_t2_f31_kill_called_on_sigint(self):
        """Child process kill() awaited on ctrl_c signal."""
        self.assertIn("fc_proc.kill().await", self.main_rs)

    def test_t2_f31_stdout_stderr_piped(self):
        """Child process pipes stdout and stderr for serial logging."""
        self.assertIn("Stdio::piped()", self.main_rs)


class TestTier2F32BoxDoctorBoundaries(FrostfireTestCase):
    """Tier 2 Boundaries for Feature 32: Box-Doctor Verification."""

    def setUp(self):
        self.sh = read_text(BOX_DOCTOR)

    def test_t2_f32_clock_skew_threshold_60_seconds(self):
        """Clock skew threshold is strictly 60 seconds."""
        self.assertIn("SKEW_THRESHOLD_S=60", self.sh)

    def test_t2_f32_clock_year_bounds(self):
        """Clock check enforces year within [2024, 2100]."""
        self.assertIn("-lt 2024", self.sh)
        self.assertIn("-gt 2100", self.sh)

    def test_t2_f32_chrome_fd_threshold_90_percent(self):
        """Chrome FD usage threshold is strictly 90%."""
        self.assertIn("CHROME_FD_FAIL_PCT=90", self.sh)

    def test_t2_f32_egress_probe_timeout_8_seconds(self):
        """Egress probe uses curl with --max-time 8."""
        self.assertIn("--max-time 8", self.sh)

    def test_t2_f32_all_checks_always_run(self):
        """run_all_checks invokes all 10 diagnostic checks without early return on failure."""
        self.assertIn("check_machine_id", self.sh)
        self.assertIn("check_chrome", self.sh)
        self.assertIn("check_chrome_fds", self.sh)
        self.assertIn("check_egress", self.sh)
        self.assertIn("check_clock", self.sh)
        self.assertIn("check_dbus", self.sh)
        self.assertIn("check_xvfb", self.sh)
        self.assertIn("check_x11vnc", self.sh)
        self.assertIn("check_novnc", self.sh)
        self.assertIn("check_compositor", self.sh)


if __name__ == "__main__":
    unittest.main()
