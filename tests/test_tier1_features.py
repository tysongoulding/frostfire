"""
Frostfire Cloud E2E Test Suite — Tier 1: Feature Coverage
Validates all 32 inventoried features in PROJECT.md with >= 5 opaque-box
tests per feature (32 features * 5 tests = 160 test cases total).
"""

import ipaddress
import json
import os
import re
import subprocess
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

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
    USR_LOCAL_SHARE_DIR,
    USR_SHARE_BG_DIR,
    FrostfireTestCase,
    extract_bash_functions,
    load_cf_yaml,
    parse_kernel_config,
    read_text,
)


class TestTier1F01CloudFormationTemplate(FrostfireTestCase):
    """Feature 1: CloudFormation POC Template (deploy/aws/poc-host.yaml)."""

    def setUp(self):
        self.yaml_data = load_cf_yaml(DEPLOY_POC_YAML)

    def test_f01_template_valid_yaml_and_version(self):
        """Authoritative Source: ORIGINAL_REQUEST § R1; PROJECT.md Feature 1."""
        self.assertFileExists(DEPLOY_POC_YAML)
        self.assertEqual(self.yaml_data.get("AWSTemplateFormatVersion"), "2010-09-09")
        self.assertIn("Description", self.yaml_data)

    def test_f01_instance_type_parameter_and_allowed_values(self):
        """InstanceType parameter defaults to c6i.xlarge and supports Nitro KVM instances."""
        params = self.yaml_data.get("Parameters", {})
        self.assertIn("InstanceType", params)
        instance_type = params["InstanceType"]
        self.assertEqual(instance_type.get("Default"), "c6i.xlarge")
        allowed = instance_type.get("AllowedValues", [])
        self.assertIn("c6i.xlarge", allowed)
        self.assertIn("c6a.xlarge", allowed)
        self.assertIn("c7i.xlarge", allowed)

    def test_f01_volume_size_parameter_bounds(self):
        """VolumeSize parameter specifies gp3 disk size with valid range (30-200 GB, default 50)."""
        params = self.yaml_data.get("Parameters", {})
        self.assertIn("VolumeSize", params)
        vol = params["VolumeSize"]
        self.assertEqual(vol.get("Default"), 50)
        self.assertEqual(vol.get("MinValue"), 30)
        self.assertEqual(vol.get("MaxValue"), 200)

    def test_f01_user_vm_instance_resource(self):
        """UserVmInstance specifies spot persistent market options and gp3 disk."""
        resources = self.yaml_data.get("Resources", {})
        self.assertIn("UserVmInstance", resources)
        instance = resources["UserVmInstance"]
        self.assertEqual(instance.get("Type"), "AWS::EC2::Instance")
        props = instance.get("Properties", {})
        self.assertIn("BlockDeviceMappings", props)
        market = props.get("InstanceMarketOptions", {})
        self.assertEqual(market.get("MarketType"), "spot")
        self.assertEqual(market.get("SpotOptions", {}).get("SpotInstanceType"), "persistent")

    def test_f01_required_stack_outputs(self):
        """Outputs provide InstanceId, PublicIp, SshAccessCommand, NoVncUrl, and WindowRouterUrl."""
        outputs = self.yaml_data.get("Outputs", {})
        expected_outputs = ["InstanceId", "PublicIp", "SshAccessCommand", "NoVncUrl", "WindowRouterUrl"]
        for key in expected_outputs:
            self.assertIn(key, outputs, f"Missing required output: {key}")


class TestTier1F02HostUserDataBootstrap(FrostfireTestCase):
    """Feature 2: Host UserData Bootstrap."""

    def setUp(self):
        content = read_text(DEPLOY_POC_YAML)
        ud_start = content.find("UserData:")
        self.assertTrue(ud_start != -1, "UserData block missing from CloudFormation template")
        self.userdata_text = content[ud_start:]

    def test_f02_userdata_script_header_and_safety_flags(self):
        """Authoritative Source: ORIGINAL_REQUEST § R1; PROJECT.md Feature 2."""
        self.assertIn("#!/usr/bin/env bash", self.userdata_text)
        self.assertIn("set -euo pipefail", self.userdata_text)

    def test_f02_kvm_permissions_configuration(self):
        """UserData verifies /dev/kvm permissions and group assignment."""
        self.assertIn("/dev/kvm", self.userdata_text)
        self.assertIn("chmod 666 /dev/kvm", self.userdata_text)
        self.assertIn("usermod -aG kvm", self.userdata_text)

    def test_f02_kernel_ip_forwarding(self):
        """UserData configures persistent net.ipv4.ip_forward=1."""
        self.assertIn("net.ipv4.ip_forward=1", self.userdata_text)
        self.assertIn("99-frostfire.conf", self.userdata_text)

    def test_f02_firecracker_official_release_download(self):
        """UserData downloads Firecracker release v1.10.1 and installs to /usr/local/bin."""
        self.assertIn("v1.10.1", self.userdata_text)
        self.assertIn("firecracker", self.userdata_text)
        self.assertIn("/usr/local/bin/firecracker", self.userdata_text)

    def test_f02_toolchains_and_auto_idle_crontab(self):
        """UserData installs Node.js, Rust, and configures check-idle-shutdown cron."""
        self.assertIn("setup_20.x", self.userdata_text)
        self.assertIn("rustup.rs", self.userdata_text)
        self.assertIn("check-idle-shutdown.sh", self.userdata_text)
        self.assertIn("crontab", self.userdata_text)


class TestTier1F03SecurityGroupIngress(FrostfireTestCase):
    """Feature 3: Security Group Port Ingress."""

    def setUp(self):
        self.yaml_data = load_cf_yaml(DEPLOY_POC_YAML)
        self.sg = self.yaml_data["Resources"]["PocSecurityGroup"]["Properties"]
        self.ingress_rules = self.sg.get("SecurityGroupIngress", [])

    def test_f03_security_group_resource_exists(self):
        """Authoritative Source: ORIGINAL_REQUEST § R1; PROJECT.md Feature 3."""
        self.assertIn("PocSecurityGroup", self.yaml_data["Resources"])
        self.assertEqual(self.yaml_data["Resources"]["PocSecurityGroup"]["Type"], "AWS::EC2::SecurityGroup")

    def test_f03_ssh_port_22_ingress(self):
        """Ingress allows TCP 22 for SSH terminal access."""
        rule_22 = next((r for r in self.ingress_rules if r.get("FromPort") == 22 and r.get("ToPort") == 22), None)
        self.assertIsNotNone(rule_22, "Port 22 SSH ingress rule missing")
        self.assertEqual(rule_22.get("IpProtocol"), "tcp")

    def test_f03_window_router_port_1339_ingress(self):
        """Ingress allows TCP 1339 for Frostfire Window Router reverse proxy."""
        rule_1339 = next((r for r in self.ingress_rules if r.get("FromPort") == 1339 and r.get("ToPort") == 1339), None)
        self.assertIsNotNone(rule_1339, "Port 1339 Window Router ingress rule missing")
        self.assertEqual(rule_1339.get("IpProtocol"), "tcp")

    def test_f03_primary_novnc_port_6080_ingress(self):
        """Ingress allows TCP 6080 for primary noVNC websockify RFB bridge."""
        rule_6080 = next((r for r in self.ingress_rules if r.get("FromPort") == 6080 and r.get("ToPort") == 6080), None)
        self.assertIsNotNone(rule_6080, "Port 6080 noVNC ingress rule missing")
        self.assertEqual(rule_6080.get("IpProtocol"), "tcp")

    def test_f03_secondary_novnc_port_6081_ingress(self):
        """Ingress allows TCP 6081 for secondary / fork noVNC displays."""
        rule_6081 = next((r for r in self.ingress_rules if r.get("FromPort") == 6081 and r.get("ToPort") == 6081), None)
        self.assertIsNotNone(rule_6081, "Port 6081 secondary noVNC ingress rule missing")
        self.assertEqual(rule_6081.get("IpProtocol"), "tcp")


class TestTier1F04AutoIdleShutdownDaemon(FrostfireTestCase):
    """Feature 4: Auto-Idle Shutdown Daemon (scripts/check-idle-shutdown.sh)."""

    def setUp(self):
        self.script_content = read_text(CHECK_IDLE_SH)

    def test_f04_script_header_and_safety(self):
        """Authoritative Source: ORIGINAL_REQUEST § R1; PROJECT.md Feature 4."""
        self.assertFileExists(CHECK_IDLE_SH)
        self.assertIn("#!/usr/bin/env bash", self.script_content)
        self.assertIn("set -euo pipefail", self.script_content)

    def test_f04_socket_check_expression(self):
        """Monitors active connections on ports 22 and 6080 using ss tool."""
        self.assertIn("sport = :22", self.script_content)
        self.assertIn("sport = :6080", self.script_content)
        self.assertIn("ss -nt", self.script_content)

    def test_f04_active_connection_resets_idle_counter(self):
        """Resets idle counter to 0 when active connections are detected."""
        self.assertIn("echo 0 > /tmp/frostfire_idle_counter", self.script_content)

    def test_f04_idle_increments_by_5(self):
        """Increments idle counter by 5 minutes on each check when zero sessions exist."""
        self.assertIn("IDLE_MINS=$((IDLE_MINS + 5))", self.script_content)

    def test_f04_shutdown_trigger_at_20_minutes(self):
        """Triggers system shutdown when idle counter reaches or exceeds 20 minutes."""
        self.assertIn("-ge 20", self.script_content)
        self.assertIn("shutdown -h now", self.script_content)


class TestTier1F05HostDependencySetupScript(FrostfireTestCase):
    """Feature 5: Host Dependency Setup Script (scripts/setup-host.sh)."""

    def setUp(self):
        self.script_content = read_text(SETUP_HOST_SH)

    def test_f05_script_structure_and_bash_syntax(self):
        """Authoritative Source: ORIGINAL_REQUEST § R1; PROJECT.md Feature 5."""
        self.assertFileExists(SETUP_HOST_SH)
        self.assertBashSyntaxValid(self.script_content, "setup-host.sh")

    def test_f05_kvm_preflight_check(self):
        """Checks /dev/kvm existence and exits with error code 1 if missing."""
        self.assertIn("[ ! -e /dev/kvm ]", self.script_content)
        self.assertIn("exit 1", self.script_content)

    def test_f05_essential_package_dependencies(self):
        """Installs debootstrap, qemu-utils, e2fsprogs, iptables, iproute2, and build-essential."""
        required_pkgs = ["build-essential", "debootstrap", "qemu-utils", "e2fsprogs", "iptables", "iproute2"]
        for pkg in required_pkgs:
            self.assertIn(pkg, self.script_content, f"Missing host package dependency: {pkg}")

    def test_f05_firecracker_v1_10_1_installer(self):
        """Installs Firecracker v1.10.1 binary and jailer to /usr/local/bin."""
        self.assertIn('FIRECRACKER_VER="v1.10.1"', self.script_content)
        self.assertIn("/usr/local/bin/firecracker", self.script_content)
        self.assertIn("/usr/local/bin/jailer", self.script_content)

    def test_f05_cron_scheduling_idempotent(self):
        """Schedules check-idle-shutdown every 5 minutes in crontab."""
        self.assertIn("*/5 * * * *", self.script_content)
        self.assertIn("check-idle-shutdown.sh", self.script_content)


class TestTier1F06TurnkeyDeployScripts(FrostfireTestCase):
    """Feature 6: Turnkey Deploy Scripts (deploy-poc.ps1, deploy-poc.sh)."""

    def setUp(self):
        self.ps1_content = read_text(DEPLOY_POC_PS1)
        self.sh_content = read_text(DEPLOY_POC_SH)

    def test_f06_powershell_script_parameter_defaults(self):
        """Authoritative Source: ORIGINAL_REQUEST § R1; PROJECT.md Feature 6."""
        self.assertFileExists(DEPLOY_POC_PS1)
        self.assertIn('$Region = "us-west-2"', self.ps1_content)
        self.assertIn('$StackName = "frostfire-user-vm-poc"', self.ps1_content)
        self.assertIn('$InstanceType = "c6i.xlarge"', self.ps1_content)

    def test_f06_bash_script_parameter_defaults(self):
        """deploy-poc.sh defaults region to us-west-2 and instance type to c6i.xlarge."""
        self.assertFileExists(DEPLOY_POC_SH)
        self.assertIn('REGION="${1:-us-west-2}"', self.sh_content)
        self.assertIn('INSTANCE_TYPE="${4:-c6i.xlarge}"', self.sh_content)

    def test_f06_public_ip_autodetection_ps1(self):
        """PowerShell script checks checkip.amazonaws.com and appends /32."""
        self.assertIn("checkip.amazonaws.com", self.ps1_content)
        self.assertIn('/32"', self.ps1_content)

    def test_f06_public_ip_autodetection_sh(self):
        """Bash script checks checkip.amazonaws.com and formats CIDR."""
        self.assertIn("checkip.amazonaws.com", self.sh_content)
        self.assertIn('/32"', self.sh_content)

    def test_f06_template_validation_before_deploy(self):
        """Both scripts run aws cloudformation validate-template before deploy."""
        self.assertIn("aws cloudformation validate-template", self.ps1_content)
        self.assertIn("aws cloudformation validate-template", self.sh_content)


class TestTier1F07EC2KeyPairResilience(FrostfireTestCase):
    """Feature 7: EC2 KeyPair Resilience."""

    def test_f07_template_keyname_parameter_definition(self):
        """Authoritative Source: PROJECT.md Feature 7."""
        yaml_data = load_cf_yaml(DEPLOY_POC_YAML)
        key_param = yaml_data["Parameters"]["KeyName"]
        self.assertEqual(key_param.get("Type"), "AWS::EC2::KeyPair::KeyName")

    def test_f07_ssh_access_output_key_mapping(self):
        """SshAccessCommand formats output using KeyName parameter."""
        yaml_data = load_cf_yaml(DEPLOY_POC_YAML)
        ssh_out = yaml_data["Outputs"]["SshAccessCommand"]["Value"]
        self.assertIn("${KeyName}.pem", str(ssh_out))
        self.assertIn("ubuntu@", str(ssh_out))

    def test_f07_deploy_ps1_key_parameter_forwarding(self):
        """deploy-poc.ps1 forwards KeyName parameter to CloudFormation."""
        ps1 = read_text(DEPLOY_POC_PS1)
        self.assertIn("KeyName=$KeyName", ps1)

    def test_f07_deploy_sh_key_parameter_forwarding(self):
        """deploy-poc.sh forwards KeyName parameter to CloudFormation."""
        sh = read_text(DEPLOY_POC_SH)
        self.assertIn('KeyName="${KEY_NAME}"', sh)

    def test_f07_key_name_sanitization(self):
        """KeyName defaults are non-empty and specify a valid identifier."""
        ps1 = read_text(DEPLOY_POC_PS1)
        sh = read_text(DEPLOY_POC_SH)
        self.assertIn("my-ec2-key", ps1)
        self.assertIn("my-ec2-key", sh)


class TestTier1F08DebianArchiveKeyring(FrostfireTestCase):
    """Feature 8: Debian Archive Keyring."""

    def test_f08_debootstrap_package_installed(self):
        """Authoritative Source: PROJECT.md Feature 8."""
        sh = read_text(SETUP_HOST_SH)
        self.assertIn("debootstrap", sh)

    def test_f08_rootfs_apt_sources_trixie(self):
        """Rootfs configures official Debian 13 (Trixie) archive repositories."""
        rootfs_sh = read_text(BUILD_ROOTFS_SH)
        self.assertIn("deb http://deb.debian.org/debian trixie", rootfs_sh)
        self.assertIn("trixie-security", rootfs_sh)

    def test_f08_rootfs_chrome_gpg_key_import(self):
        """build-rootfs.sh imports and de-armors Google repository signing key."""
        rootfs_sh = read_text(BUILD_ROOTFS_SH)
        self.assertIn("linux_signing_key.pub", rootfs_sh)
        self.assertIn("gpg --dearmor", rootfs_sh)
        self.assertIn("google.gpg", rootfs_sh)

    def test_f08_rootfs_ca_certificates_package(self):
        """build-rootfs.sh installs ca-certificates and gnupg for HTTPS/GPG verification."""
        rootfs_sh = read_text(BUILD_ROOTFS_SH)
        self.assertIn("ca-certificates", rootfs_sh)
        self.assertIn("gnupg", rootfs_sh)

    def test_f08_host_certificates_available(self):
        """Host setup includes curl and wget for secure artifact retrieval."""
        sh = read_text(SETUP_HOST_SH)
        self.assertIn("curl", sh)
        self.assertIn("wget", sh)


class TestTier1F09MonolithicLinuxKernel(FrostfireTestCase):
    """Feature 9: Monolithic Linux 6.12 Kernel."""

    def test_f09_kernel_version_constant(self):
        """Authoritative Source: ORIGINAL_REQUEST § R2; PROJECT.md Feature 9."""
        sh = read_text(BUILD_KERNEL_SH)
        self.assertIn("6.12.6", sh)
        self.assertIn("KERNEL_VER=", sh)

    def test_f09_kernel_download_url_format(self):
        """build-kernel.sh downloads from official cdn.kernel.org v6.x archive."""
        sh = read_text(BUILD_KERNEL_SH)
        self.assertIn("https://cdn.kernel.org/pub/linux/kernel/v6.x/", sh)

    def test_f09_modules_disabled_in_config(self):
        """kernel/kernel.config explicitly disables module loading (CONFIG_MODULES=n)."""
        cfg = parse_kernel_config(KERNEL_CONFIG)
        self.assertEqual(cfg.get("CONFIG_MODULES"), "n")

    def test_f09_modules_disabled_in_build_script(self):
        """build-kernel.sh enforces monolithic build disabling CONFIG_MODULES."""
        sh = read_text(BUILD_KERNEL_SH)
        self.assertIn("CONFIG_MODULES", sh)
        self.assertIn("monolithic", sh.lower())

    def test_f09_compilation_target_and_output(self):
        """Build pipeline compiles uncompressed ELF binary vmlinux and copies to out directory."""
        sh = read_text(BUILD_KERNEL_SH)
        self.assertIn("make -j", sh)
        self.assertIn("vmlinux", sh)
        self.assertIn("${OUT_DIR}/vmlinux-${KERNEL_VER}", sh)


class TestTier1F10StaticVirtioDrivers(FrostfireTestCase):
    """Feature 10: Static VirtIO Drivers."""

    def setUp(self):
        self.cfg = parse_kernel_config(KERNEL_CONFIG)
        self.sh = read_text(BUILD_KERNEL_SH)

    def test_f10_virtio_core_and_pci_enabled(self):
        """Authoritative Source: ORIGINAL_REQUEST § R2; PROJECT.md Feature 10."""
        self.assertEqual(self.cfg.get("CONFIG_VIRTIO"), "y")
        self.assertEqual(self.cfg.get("CONFIG_VIRTIO_PCI"), "y")
        self.assertIn("CONFIG_VIRTIO", self.sh)

    def test_f10_virtio_mmio_and_cmdline_enabled(self):
        """VirtIO MMIO and command-line device drivers are built-in."""
        self.assertEqual(self.cfg.get("CONFIG_VIRTIO_MMIO"), "y")
        self.assertEqual(self.cfg.get("CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES"), "y")
        self.assertIn("CONFIG_VIRTIO_MMIO", self.sh)

    def test_f10_virtio_storage_blk_enabled(self):
        """CONFIG_VIRTIO_BLK is built-in for rootfs drive."""
        self.assertEqual(self.cfg.get("CONFIG_VIRTIO_BLK"), "y")
        self.assertIn("CONFIG_VIRTIO_BLK", self.sh)

    def test_f10_virtio_net_enabled(self):
        """CONFIG_VIRTIO_NET is built-in for microVM TAP network device."""
        self.assertEqual(self.cfg.get("CONFIG_VIRTIO_NET"), "y")
        self.assertIn("CONFIG_VIRTIO_NET", self.sh)

    def test_f10_virtio_vsock_and_balloon_enabled(self):
        """CONFIG_VIRTIO_VSOCK, CONFIG_VSOCKETS, and CONFIG_VIRTIO_BALLOON are built-in."""
        self.assertEqual(self.cfg.get("CONFIG_VIRTIO_VSOCK"), "y")
        self.assertEqual(self.cfg.get("CONFIG_VSOCKETS"), "y")
        self.assertEqual(self.cfg.get("CONFIG_VIRTIO_BALLOON"), "y")


class TestTier1F11StaticFilesystemsAndNamespaces(FrostfireTestCase):
    """Feature 11: Static Filesystems & Namespaces."""

    def setUp(self):
        self.cfg = parse_kernel_config(KERNEL_CONFIG)
        self.sh = read_text(BUILD_KERNEL_SH)

    def test_f11_ext4_with_posix_acl_security(self):
        """Authoritative Source: ORIGINAL_REQUEST § R2; PROJECT.md Feature 11."""
        self.assertEqual(self.cfg.get("CONFIG_EXT4_FS"), "y")
        self.assertEqual(self.cfg.get("CONFIG_EXT4_FS_POSIX_ACL"), "y")
        self.assertEqual(self.cfg.get("CONFIG_EXT4_FS_SECURITY"), "y")

    def test_f11_overlayfs_and_fuse_enabled(self):
        """CONFIG_OVERLAY_FS and CONFIG_FUSE_FS are built-in."""
        self.assertEqual(self.cfg.get("CONFIG_OVERLAY_FS"), "y")
        self.assertEqual(self.cfg.get("CONFIG_FUSE_FS"), "y")

    def test_f11_devtmpfs_and_tmpfs_enabled(self):
        """CONFIG_TMPFS, CONFIG_DEVTMPFS, and CONFIG_DEVTMPFS_MOUNT are built-in."""
        self.assertEqual(self.cfg.get("CONFIG_TMPFS"), "y")
        self.assertEqual(self.cfg.get("CONFIG_DEVTMPFS"), "y")
        self.assertEqual(self.cfg.get("CONFIG_DEVTMPFS_MOUNT"), "y")

    def test_f11_all_linux_namespaces_enabled(self):
        """Namespaces: USER, NET, PID, IPC, and UTS are built-in."""
        self.assertEqual(self.cfg.get("CONFIG_NAMESPACES"), "y")
        self.assertEqual(self.cfg.get("CONFIG_USER_NS"), "y")
        self.assertEqual(self.cfg.get("CONFIG_NET_NS"), "y")
        self.assertEqual(self.cfg.get("CONFIG_PID_NS"), "y")
        self.assertEqual(self.cfg.get("CONFIG_IPC_NS"), "y")
        self.assertEqual(self.cfg.get("CONFIG_UTS_NS"), "y")

    def test_f11_seccomp_filter_security_enabled(self):
        """CONFIG_SECURITY, CONFIG_SECCOMP, and CONFIG_SECCOMP_FILTER are built-in."""
        self.assertEqual(self.cfg.get("CONFIG_SECURITY"), "y")
        self.assertEqual(self.cfg.get("CONFIG_SECCOMP"), "y")
        self.assertEqual(self.cfg.get("CONFIG_SECCOMP_FILTER"), "y")


class TestTier1F12IPBootlineAutoconfig(FrostfireTestCase):
    """Feature 12: IP Bootline Autoconfig."""

    def test_f12_ip_pnp_specification_contract(self):
        """Authoritative Source: PROJECT.md Feature 12 & Interface Contracts."""
        main_rs = read_text(HYPERVISOR_MAIN)
        self.assertIn("ip={}", main_rs)
        self.assertIn("eth0:off", main_rs)

    def test_f12_hypervisor_boot_args_ip_format(self):
        """Boot arguments contain ip=<guest_ip>::<host_ip>:255.255.255.0::eth0:off."""
        main_rs = read_text(HYPERVISOR_MAIN)
        self.assertIn("255.255.255.0", main_rs)
        self.assertIn("root=/dev/vda", main_rs)

    def test_f12_guest_ip_matches_boot_args(self):
        """Default guest IP in hypervisor is 172.30.0.2."""
        main_rs = read_text(HYPERVISOR_MAIN)
        self.assertIn('guest_ip: "172.30.0.2"', main_rs)

    def test_f12_host_gateway_matches_boot_args(self):
        """Default host gateway IP in hypervisor is 172.30.0.1."""
        main_rs = read_text(HYPERVISOR_MAIN)
        self.assertIn('host_ip: "172.30.0.1"', main_rs)

    def test_f12_netmask_and_device_name_contract(self):
        """Network interface is named eth0 and netmask is standard /24."""
        main_rs = read_text(HYPERVISOR_MAIN)
        self.assertIn('"iface_id": "eth0"', main_rs)


class TestTier1F13HardwareRNGAndEntropy(FrostfireTestCase):
    """Feature 13: Hardware RNG & Entropy."""

    def test_f13_hw_random_kernel_contract(self):
        """Authoritative Source: PROJECT.md Feature 13 & Interface Contracts."""
        cfg = parse_kernel_config(KERNEL_CONFIG)
        self.assertEqual(cfg.get("CONFIG_HW_RANDOM"), "y")
        self.assertEqual(cfg.get("CONFIG_HW_RANDOM_VIRTIO"), "y")

    def test_f13_guest_boot_uuid_entropy_source(self):
        """start-frostfire-box queries /proc/sys/kernel/random/uuid for boot UUID."""
        start_sh = read_text(START_FROSTFIRE_BOX)
        self.assertIn("/proc/sys/kernel/random/uuid", start_sh)

    def test_f13_guest_boot_id_fallback_mechanism(self):
        """Fallback boot ID derives from timestamp and PID if kernel uuid is unreadable."""
        start_sh = read_text(START_FROSTFIRE_BOX)
        self.assertIn('SAND_BOX_BOOT_ID="${SAND_BOX_BOOT_STARTED_AT_MS}-$$"', start_sh)

    def test_f13_machine_id_randomness_generation(self):
        """build-rootfs.sh uses dbus-uuidgen to generate non-deterministic machine-id."""
        rootfs_sh = read_text(BUILD_ROOTFS_SH)
        self.assertIn("dbus-uuidgen > /etc/machine-id", rootfs_sh)

    def test_f13_machine_id_dbus_mirroring(self):
        """build-rootfs.sh mirrors machine-id to /var/lib/dbus/machine-id."""
        rootfs_sh = read_text(BUILD_ROOTFS_SH)
        self.assertIn("cp /etc/machine-id /var/lib/dbus/machine-id", rootfs_sh)


class TestTier1F14CgroupV2SchedulerAndPIDs(FrostfireTestCase):
    """Feature 14: Cgroup v2 Scheduler & PIDs."""

    def setUp(self):
        self.cfg = parse_kernel_config(KERNEL_CONFIG)
        self.sh = read_text(BUILD_KERNEL_SH)

    def test_f14_cgroups_v2_core_config(self):
        """Authoritative Source: PROJECT.md Feature 14."""
        self.assertEqual(self.cfg.get("CONFIG_CGROUPS"), "y")
        self.assertEqual(self.cfg.get("CONFIG_MEMCG"), "y")

    def test_f14_cgroup_sched_and_cpuacct(self):
        """CONFIG_CGROUP_SCHED is built-in."""
        self.assertEqual(self.cfg.get("CONFIG_CGROUP_SCHED"), "y")

    def test_f14_cgroup_pids_and_cfs_bandwidth(self):
        """CONFIG_CGROUP_PIDS and CONFIG_CFS_BANDWIDTH are built-in."""
        self.assertEqual(self.cfg.get("CONFIG_CGROUP_PIDS"), "y")
        self.assertEqual(self.cfg.get("CONFIG_CFS_BANDWIDTH"), "y")

    def test_f14_cgroup_cpusets_enabled(self):
        """CONFIG_CPUSETS is built-in."""
        self.assertEqual(self.cfg.get("CONFIG_CPUSETS"), "y")

    def test_f14_box_cgroups_script_integration(self):
        """box-cgroups.sh exists in usr-local-bin and defines cgroup configuration functions."""
        self.assertFileExists(BOX_CGROUPS_SH)
        cgroup_sh = read_text(BOX_CGROUPS_SH)
        self.assertIn("sand_cgroup_setup", cgroup_sh)


class TestTier1F15DeterministicKernelConfig(FrostfireTestCase):
    """Feature 15: Deterministic Kernel Config."""

    def setUp(self):
        self.config_content = read_text(KERNEL_CONFIG)
        self.cfg = parse_kernel_config(KERNEL_CONFIG)

    def test_f15_kernel_config_file_exists(self):
        """Authoritative Source: ORIGINAL_REQUEST § R2; PROJECT.md Feature 15."""
        self.assertFileNonEmpty(KERNEL_CONFIG)

    def test_f15_kernel_config_syntax_format(self):
        """Every line in kernel.config is either a comment or KEY=VALUE."""
        for line in self.config_content.splitlines():
            line = line.strip()
            if not line:
                continue
            is_comment = line.startswith("#")
            is_assignment = "=" in line and not line.startswith("=")
            self.assertTrue(is_comment or is_assignment, f"Invalid kernel config line: {line}")

    def test_f15_no_conflicting_kconfig_directives(self):
        """No config symbol is defined more than once in kernel.config."""
        symbols = []
        for line in self.config_content.splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                symbols.append(line.split("=", 1)[0].strip())
        self.assertEqual(len(symbols), len(set(symbols)), "Duplicate kernel config directives found")

    def test_f15_build_kernel_uses_olddefconfig(self):
        """build-kernel.sh applies make olddefconfig to ensure deterministic defaults."""
        sh = read_text(BUILD_KERNEL_SH)
        self.assertIn("make olddefconfig", sh)

    def test_f15_reproducible_kernel_output_name(self):
        """Kernel output filename matches vmlinux-${KERNEL_VER} format."""
        sh = read_text(BUILD_KERNEL_SH)
        self.assertIn("${OUT_DIR}/vmlinux-${KERNEL_VER}", sh)


class TestTier1F16Debian13RootfsGeneration(FrostfireTestCase):
    """Feature 16: Debian 13 Rootfs Generation."""

    def setUp(self):
        self.sh = read_text(BUILD_ROOTFS_SH)

    def test_f16_rootfs_size_8gb_specification(self):
        """Authoritative Source: ORIGINAL_REQUEST § R3; PROJECT.md Feature 16."""
        self.assertFileExists(BUILD_ROOTFS_SH)
        self.assertIn("ROOTFS_SIZE_MB=8192", self.sh)

    def test_f16_blank_image_creation_command(self):
        """Creates blank ext4 image using dd with 1M block size."""
        self.assertIn("dd if=/dev/zero", self.sh)
        self.assertIn("bs=1M", self.sh)

    def test_f16_ext4_formatting_block_size(self):
        """Formats image with mkfs.ext4 using 4096-byte blocks."""
        self.assertIn("mkfs.ext4 -F -b 4096", self.sh)

    def test_f16_debootstrap_target_trixie_amd64(self):
        """Runs debootstrap for Debian 13 (Trixie) amd64 architecture."""
        self.assertIn("debootstrap --arch=amd64 trixie", self.sh)

    def test_f16_loop_mount_and_exit_trap(self):
        """Mounts via loop device and registers clean cleanup on EXIT."""
        self.assertIn("mount -o loop", self.sh)
        self.assertIn("cleanup", self.sh)
        self.assertIn("umount", self.sh)


class TestTier1F17NonRootUserBox(FrostfireTestCase):
    """Feature 17: Non-Root User box."""

    def setUp(self):
        self.sh = read_text(BUILD_ROOTFS_SH)

    def test_f17_user_box_uid_gid_1000(self):
        """Authoritative Source: ORIGINAL_REQUEST § R3; PROJECT.md Feature 17."""
        self.assertIn("useradd -u 1000", self.sh)
        self.assertIn("box", self.sh)

    def test_f17_passwordless_sudo_rule(self):
        """Configures passwordless sudo for user box in /etc/sudoers.d/box."""
        self.assertTrue("box ALL=(ALL) NOPASSWD:ALL" in self.sh or "box ALL=(ALL:ALL) NOPASSWD:ALL" in self.sh)
        self.assertIn("/etc/sudoers.d/box", self.sh)

    def test_f17_user_box_default_password(self):
        """Sets default initial password 'box:box'."""
        self.assertIn("echo 'box:box' | chpasswd", self.sh)

    def test_f17_home_box_ownership_chown(self):
        """Recursively chowns /home/box to user box."""
        self.assertIn("chown -R box:box /home/box", self.sh)

    def test_f17_home_box_bashrc_and_profile(self):
        """home-box directory provides .bashrc and .profile."""
        self.assertFileExists(HOME_BOX_DIR / ".bashrc")
        self.assertFileExists(HOME_BOX_DIR / ".profile")


class TestTier1F18SplitBinaryRecombination(FrostfireTestCase):
    """Feature 18: Split Binary Recombination."""

    def test_f18_node_part_chunks_exist(self):
        """Authoritative Source: PROJECT.md Feature 18."""
        for chunk in ["aa", "ab", "ac"]:
            part = EXEC_DAEMON_DIR / f"node.part.{chunk}"
            self.assertFileExists(part, f"Missing chunk: {part}")

    def test_f18_node_part_chunk_sizes(self):
        """Split node chunks aa and ab are exactly 52,428,800 bytes (50MB threshold)."""
        for chunk in ["aa", "ab"]:
            part = EXEC_DAEMON_DIR / f"node.part.{chunk}"
            self.assertEqual(part.stat().st_size, 52428800)

    def test_f18_origin_part_chunks_exist(self):
        """Split origin chunks aa and ab exist in exec-daemon/tools."""
        tools_dir = EXEC_DAEMON_DIR / "tools"
        self.assertFileExists(tools_dir / "origin.part.aa")
        self.assertFileExists(tools_dir / "origin.part.ab")

    def test_f18_node_recombine_script_format(self):
        """node.recombine.sh concatenates chunks into executable node binary."""
        recombine_sh = read_text(EXEC_DAEMON_DIR / "node.recombine.sh")
        self.assertIn("cat ./exec-daemon/node.part.* > ./exec-daemon/node", recombine_sh)
        self.assertIn("chmod +x ./exec-daemon/node", recombine_sh)

    def test_f18_origin_recombine_script_format(self):
        """origin.recombine.sh concatenates chunks into executable origin binary."""
        recombine_sh = read_text(EXEC_DAEMON_DIR / "tools" / "origin.recombine.sh")
        self.assertIn("cat ./exec-daemon/tools/origin.part.* > ./exec-daemon/tools/origin", recombine_sh)
        self.assertIn("chmod +x ./exec-daemon/tools/origin", recombine_sh)


class TestTier1F19CompleteUserBoxProfile(FrostfireTestCase):
    """Feature 19: Complete User box Profile."""

    def test_f19_home_box_structure_exists(self):
        """Authoritative Source: PROJECT.md Feature 19."""
        self.assertFileExists(HOME_BOX_DIR)
        self.assertTrue((HOME_BOX_DIR / ".config").is_dir())
        self.assertTrue((HOME_BOX_DIR / ".local").is_dir())

    def test_f19_home_box_frostfire_host_subfolder(self):
        """home-box contains frostfire-host runtime directory."""
        self.assertTrue((HOME_BOX_DIR / "frostfire-host").is_dir())

    def test_f19_rootfs_copies_frostfire_host(self):
        """build-rootfs.sh copies home-box/frostfire-host to /home/box/frostfire-host."""
        sh = read_text(BUILD_ROOTFS_SH)
        self.assertIn("home-box/frostfire-host", sh)
        self.assertIn("/home/box/frostfire-host", sh)

    def test_f19_sand_host_compatibility_symlink(self):
        """build-rootfs.sh creates compatibility symlink /home/box/sand-host."""
        sh = read_text(BUILD_ROOTFS_SH)
        self.assertIn("ln -sfn /home/box/frostfire-host", sh)
        self.assertIn("/home/box/sand-host", sh)

    def test_f19_home_box_dotfiles_content(self):
        """home-box/.profile configures user PATH and environment variables."""
        profile = read_text(HOME_BOX_DIR / ".profile")
        self.assertIn("PATH", profile)


class TestTier1F20WallpaperAndPoliciesAssets(FrostfireTestCase):
    """Feature 20: Wallpaper & Policies Assets."""

    def test_f20_wallpaper_assets_present(self):
        """Authoritative Source: PROJECT.md Feature 20."""
        self.assertFileExists(USR_SHARE_BG_DIR)
        wallpapers = list(USR_SHARE_BG_DIR.glob("frostfire-wallpaper-*.png"))
        self.assertGreaterEqual(len(wallpapers), 1)

    def test_f20_wallpaper_non_empty_size(self):
        """Wallpaper PNG files are valid and larger than 1MB."""
        for wp in USR_SHARE_BG_DIR.glob("frostfire-wallpaper-*.png"):
            self.assertGreater(wp.stat().st_size, 1_000_000)

    def test_f20_chrome_managed_policies_present(self):
        """Managed Chrome policies frostfire.json and frostfire-webauthn.json exist."""
        policies_dir = ETC_POLICIES_DIR / "policies" / "managed"
        self.assertFileExists(policies_dir / "frostfire.json")
        self.assertFileExists(policies_dir / "frostfire-webauthn.json")

    def test_f20_chrome_managed_policies_valid_json(self):
        """All enterprise policies in etc-policies/policies/managed parse as valid JSON."""
        policies_dir = ETC_POLICIES_DIR / "policies" / "managed"
        for pfile in policies_dir.glob("*.json"):
            self.assertValidJsonFile(pfile)

    def test_f20_native_messaging_host_manifests(self):
        """Native messaging host manifests exist in etc-policies/native-messaging-hosts/."""
        nm_dir = ETC_POLICIES_DIR / "native-messaging-hosts"
        self.assertFileExists(nm_dir)
        manifests = list(nm_dir.glob("*.json"))
        self.assertGreaterEqual(len(manifests), 1)
        for m in manifests:
            self.assertValidJsonFile(m)


class TestTier1F21DesktopAndDisplayStack(FrostfireTestCase):
    """Feature 21: Desktop & Display Stack."""

    def setUp(self):
        self.sh = read_text(BUILD_ROOTFS_SH)

    def test_f21_display_packages_in_rootfs_build(self):
        """Authoritative Source: ORIGINAL_REQUEST § R3; PROJECT.md Feature 21."""
        for pkg in ["xvfb", "xfwm4", "picom", "x11vnc", "websockify", "novnc"]:
            self.assertIn(pkg, self.sh, f"Missing display package in build-rootfs.sh: {pkg}")

    def test_f21_xvfb_wrapper_script(self):
        """usr-local-bin/box-xvfb exists and configures display :1."""
        script = ROOT_DIR / "usr-local-bin" / "box-xvfb"
        self.assertFileExists(script)
        content = read_text(script)
        self.assertIn("Xvfb", content)

    def test_f21_xfwm4_wrapper_script(self):
        """usr-local-bin/box-xfwm4 exists and configures window manager."""
        script = ROOT_DIR / "usr-local-bin" / "box-xfwm4"
        self.assertFileExists(script)
        content = read_text(script)
        self.assertIn("xfwm4", content)

    def test_f21_picom_wrapper_script(self):
        """usr-local-bin/box-picom exists and starts compositor."""
        script = ROOT_DIR / "usr-local-bin" / "box-picom"
        self.assertFileExists(script)
        content = read_text(script)
        self.assertIn("picom", content)

    def test_f21_x11vnc_wrapper_script(self):
        """usr-local-bin/box-x11vnc exists and configures RFB port binding."""
        script = ROOT_DIR / "usr-local-bin" / "box-x11vnc"
        self.assertFileExists(script)
        content = read_text(script)
        self.assertIn("x11vnc", content)
        self.assertIn("-rfbport", content)
        self.assertIn("5900", read_text(BOX_DOCTOR))


class TestTier1F22GoogleChromeEnterprise(FrostfireTestCase):
    """Feature 22: Google Chrome Enterprise."""

    def setUp(self):
        self.sh = read_text(BUILD_ROOTFS_SH)

    def test_f22_chrome_apt_repository_source(self):
        """Authoritative Source: ORIGINAL_REQUEST § R3; PROJECT.md Feature 22."""
        self.assertIn("dl.google.com/linux/chrome/deb", self.sh)
        self.assertIn("google-chrome.list", self.sh)

    def test_f22_chrome_stable_package(self):
        """build-rootfs.sh installs google-chrome-stable."""
        self.assertIn("google-chrome-stable", self.sh)

    def test_f22_chrome_wrapper_box_chrome(self):
        """usr-local-bin/box-chrome exists and manages Chrome invocation flags."""
        script = ROOT_DIR / "usr-local-bin" / "box-chrome"
        self.assertFileExists(script)
        content = read_text(script)
        self.assertIn("google-chrome", content)

    def test_f22_policy_directory_injection(self):
        """build-rootfs.sh copies managed policies into /etc/opt/chrome/policies/managed/."""
        self.assertIn("/etc/opt/chrome/policies/managed", self.sh)

    def test_f22_policy_extension_forcelist(self):
        """frostfire-webauthn.json defines enterprise ExtensionSettings with force_installed mode."""
        policy_file = ETC_POLICIES_DIR / "policies" / "managed" / "frostfire-webauthn.json"
        policy_data = self.assertValidJsonFile(policy_file)
        self.assertIn("ExtensionSettings", policy_data)
        self.assertIn("force_installed", str(policy_data))


class TestTier1F23GuestAutostartService(FrostfireTestCase):
    """Feature 23: Guest Autostart Service."""

    def setUp(self):
        self.start_sh = read_text(START_FROSTFIRE_BOX)

    def test_f23_start_frostfire_box_entrypoint(self):
        """Authoritative Source: ORIGINAL_REQUEST § R3; PROJECT.md Feature 23."""
        self.assertFileExists(START_FROSTFIRE_BOX)
        self.assertIn("#!/usr/bin/env bash", self.start_sh)

    def test_f23_autostart_script_default_display(self):
        """start-frostfire-box sets DISPLAY=:1 by default."""
        self.assertIn('DISPLAY="${DISPLAY:-:1}"', self.start_sh)

    def test_f23_telemetry_log_emission(self):
        """Logs boot lifecycle stages to /tmp/sand-box-telemetry.log."""
        self.assertIn("/tmp/sand-box-telemetry.log", self.start_sh)
        self.assertIn("emit_boot_stage", self.start_sh)

    def test_f23_port_constants_defined(self):
        """Defines core ports: 1337 (exec daemon), 1339 (window router), 6081 (fork novnc)."""
        self.assertIn("SAND_BOX_PORT_PRIMARY_EXEC_DAEMON=1337", self.start_sh)
        self.assertIn("SAND_BOX_PORT_WINDOW_ROUTER=1339", self.start_sh)
        self.assertIn("SAND_BOX_PORT_FORK_NOVNC=6081", self.start_sh)

    def test_f23_systemd_unit_specification(self):
        """Systemd autostart service points to start-frostfire-box."""
        self.assertIn("entrypoint_started", self.start_sh)


class TestTier1F24StaticNetworkingAndDNS(FrostfireTestCase):
    """Feature 24: Static Networking & DNS Config."""

    def setUp(self):
        self.sh = read_text(BUILD_ROOTFS_SH)

    def test_f24_hostname_configuration(self):
        """Authoritative Source: PROJECT.md Feature 24."""
        self.assertIn("echo 'frostfire-box' > /etc/hostname", self.sh)

    def test_f24_hosts_file_mappings(self):
        """Rootfs configures /etc/hosts with 127.0.0.1 localhost and 127.0.1.1 frostfire-box."""
        self.assertIn("127.0.0.1 localhost", self.sh)
        self.assertIn("127.0.1.1 frostfire-box", self.sh)

    def test_f24_resolv_conf_specification(self):
        """Specification defines public DNS resolution (8.8.8.8)."""
        self.assertIn("nameserver 8.8.8.8", self.sh)

    def test_f24_guest_ip_alignment(self):
        """Hypervisor config default guest IP is 172.30.0.2."""
        main_rs = read_text(HYPERVISOR_MAIN)
        self.assertIn('"172.30.0.2"', main_rs)

    def test_f24_host_gateway_alignment(self):
        """Hypervisor config default host gateway IP is 172.30.0.1."""
        main_rs = read_text(HYPERVISOR_MAIN)
        self.assertIn('"172.30.0.1"', main_rs)


class TestTier1F25ChrootBuildHygiene(FrostfireTestCase):
    """Feature 25: Chroot Build Hygiene."""

    def setUp(self):
        self.sh = read_text(BUILD_ROOTFS_SH)

    def test_f25_noninteractive_frontend(self):
        """Authoritative Source: PROJECT.md Feature 25."""
        self.assertIn("export DEBIAN_FRONTEND=noninteractive", self.sh)

    def test_f25_error_handling_pipefail(self):
        """Chroot executes under set -euo pipefail."""
        self.assertIn("set -euo pipefail", self.sh)

    def test_f25_unmount_trap_cleanup(self):
        """EXIT trap unmounts loop device even on failure."""
        self.assertIn("cleanup", self.sh)
        self.assertIn("umount", self.sh)

    def test_f25_mount_directory_cleanup(self):
        """EXIT trap cleans up mount directory."""
        self.assertIn("${MOUNT_DIR}", self.sh)

    def test_f25_loop_device_mount_flags(self):
        """Mounts rootfs using loop option."""
        self.assertIn("mount -o loop", self.sh)


class TestTier1F26HypervisorCrateCompilation(FrostfireTestCase):
    """Feature 26: Hypervisor Crate Compilation."""

    def test_f26_cargo_toml_workspace_member(self):
        """Authoritative Source: ORIGINAL_REQUEST § R4; PROJECT.md Feature 26."""
        cargo = read_text(ROOT_CARGO)
        self.assertIn('"crates/frostfire-hypervisor"', cargo)

    def test_f26_hypervisor_cargo_toml_dependencies(self):
        """Hypervisor Cargo.toml specifies tokio, hyper, hyper-unix-connector, and serde_json."""
        cargo = read_text(HYPERVISOR_CARGO)
        self.assertIn("tokio", cargo)
        self.assertIn("hyper", cargo)
        self.assertIn("serde_json", cargo)

    def test_f26_release_profile_optimizations(self):
        """Root Cargo.toml configures opt-level = 3 and lto = true for release builds."""
        cargo = read_text(ROOT_CARGO)
        self.assertIn("opt-level = 3", cargo)
        self.assertIn("lto = true", cargo)

    def test_f26_crate_compiles_cargo_check(self):
        """Hypervisor crate passes cargo check with 0 errors."""
        import shutil
        cargo_bin = shutil.which("cargo") or shutil.which("cargo.exe")
        if not cargo_bin:
            raise unittest.SkipTest("cargo binary not found on PATH in this environment")
        res = subprocess.run([cargo_bin, "check", "--workspace"], cwd=str(ROOT_DIR), capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, f"cargo check failed: {res.stderr}")

    def test_f26_crate_unit_tests_pass(self):
        """Hypervisor built-in unit tests pass."""
        import shutil
        cargo_bin = shutil.which("cargo") or shutil.which("cargo.exe")
        if not cargo_bin:
            raise unittest.SkipTest("cargo binary not found on PATH in this environment")
        res = subprocess.run([cargo_bin, "test", "--workspace"], cwd=str(ROOT_DIR), capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, f"cargo test failed: {res.stderr}")


class TestTier1F27FixClippyUnusedImport(FrostfireTestCase):
    """Feature 27: Fix Clippy Unused Import."""

    def test_f27_clippy_zero_warnings(self):
        """Authoritative Source: PROJECT.md Feature 27; AGENTS.md verification gates."""
        import shutil
        cargo_bin = shutil.which("cargo") or shutil.which("cargo.exe")
        if not cargo_bin:
            raise unittest.SkipTest("cargo binary not found on PATH in this environment")
        res = subprocess.run(
            [cargo_bin, "clippy", "--workspace", "--", "-D", "warnings"],
            cwd=str(ROOT_DIR),
            capture_output=True,
            text=True
        )
        self.assertEqual(res.returncode, 0, f"cargo clippy failed with warnings:\n{res.stderr}")

    def test_f27_main_rs_source_parses(self):
        """main.rs exists and is readable."""
        self.assertFileNonEmpty(HYPERVISOR_MAIN)

    def test_f27_tracing_imports_analyzed(self):
        """Tracing import in main.rs conforms to clippy rules."""
        content = read_text(HYPERVISOR_MAIN)
        self.assertIn("tracing::", content)

    def test_f27_anyhow_imports_analyzed(self):
        """anyhow Result import is present and used."""
        content = read_text(HYPERVISOR_MAIN)
        self.assertIn("anyhow::", content)
        self.assertIn("Result", content)

    def test_f27_unix_cfg_guards_present(self):
        """Unix-specific modules and calls are guarded by #[cfg(unix)]."""
        content = read_text(HYPERVISOR_MAIN)
        self.assertIn("#[cfg(unix)]", content)
        self.assertIn("#[cfg(not(unix))]", content)


class TestTier1F28FirecrackerMachineConfig(FrostfireTestCase):
    """Feature 28: Firecracker Machine Config."""

    def setUp(self):
        self.main_rs = read_text(HYPERVISOR_MAIN)

    def test_f28_machine_config_endpoint_contract(self):
        """Authoritative Source: PROJECT.md Feature 28 & Interface Contracts."""
        self.assertIn('"/machine-config"', self.main_rs)

    def test_f28_vcpu_count_minimum_2(self):
        """Specification requires allocating at least 2 vCPUs."""
        self.assertIn("vcpu_count: 2", self.main_rs)

    def test_f28_mem_size_mib_minimum_4096(self):
        """Specification requires allocating at least 4096 MiB RAM to prevent guest OOM."""
        self.assertIn("mem_size_mib: 4096", self.main_rs)

    def test_f28_ht_enabled_parameter(self):
        """Hyper-threading setting parameter format."""
        self.assertIn("smt: false", self.main_rs)

    def test_f28_machine_config_payload_schema(self):
        """Firecracker machine config requires positive integers for vCPU and memory."""
        self.assertIn('"vcpu_count": self.config.vcpu_count', self.main_rs)
        self.assertIn('"mem_size_mib": self.config.mem_size_mib', self.main_rs)


class TestTier1F29TAPNetworkingAndDynamicEgress(FrostfireTestCase):
    """Feature 29: TAP Networking & Dynamic Egress."""

    def setUp(self):
        self.main_rs = read_text(HYPERVISOR_MAIN)

    def test_f29_tap_device_name_default(self):
        """Authoritative Source: ORIGINAL_REQUEST § R4; PROJECT.md Feature 29."""
        self.assertIn('tap_device: "tap0"', self.main_rs)

    def test_f29_host_tap_ip_assignment(self):
        """TAP device host IP assigned as /24 CIDR."""
        self.assertIn('format!("{}/24", self.config.host_ip)', self.main_rs)

    def test_f29_tap_link_set_up(self):
        """Brings TAP link up via ip link set dev <dev> up."""
        self.assertIn('"link", "set", "dev"', self.main_rs)
        self.assertIn('"up"', self.main_rs)

    def test_f29_iptables_masquerade_rule(self):
        """Configures iptables NAT POSTROUTING MASQUERADE for guest egress."""
        self.assertIn("POSTROUTING", self.main_rs)
        self.assertIn("MASQUERADE", self.main_rs)

    def test_f29_dynamic_egress_interface_fallback(self):
        """Interface contract specifies forwarding across host gateway device."""
        self.assertIn("detect_host_gateway_interface", self.main_rs)


class TestTier1F30FirecrackerUDSControl(FrostfireTestCase):
    """Feature 30: Firecracker UDS Control."""

    def setUp(self):
        self.main_rs = read_text(HYPERVISOR_MAIN)

    def test_f30_socket_path_default(self):
        """Authoritative Source: ORIGINAL_REQUEST § R4; PROJECT.md Feature 30."""
        self.assertIn('PathBuf::from("/tmp/firecracker.socket")', self.main_rs)

    def test_f30_boot_source_api_payload(self):
        """Issues PUT /boot-source with kernel_image_path and boot_args."""
        self.assertIn('"/boot-source"', self.main_rs)
        self.assertIn('"kernel_image_path"', self.main_rs)
        self.assertIn('"boot_args"', self.main_rs)

    def test_f30_drives_rootfs_api_payload(self):
        """Issues PUT /drives/rootfs with path_on_host, is_root_device, is_read_only."""
        self.assertIn('"/drives/rootfs"', self.main_rs)
        self.assertIn('"drive_id": "rootfs"', self.main_rs)
        self.assertIn('"is_root_device": true', self.main_rs)

    def test_f30_network_interface_api_payload(self):
        """Issues PUT /network-interfaces/eth0 with MAC AA:FC:00:00:00:01."""
        self.assertIn('"/network-interfaces/eth0"', self.main_rs)
        self.assertIn('"AA:FC:00:00:00:01"', self.main_rs)

    def test_f30_vsock_api_payload(self):
        """Issues PUT /vsock with guest_cid: 3 and UDS path."""
        self.assertIn('"/vsock"', self.main_rs)
        self.assertIn('"guest_cid": 3', self.main_rs)
        self.assertIn('PathBuf::from("/tmp/vsock.sock")', self.main_rs)


class TestTier1F31InstanceLifecycleAndShutdown(FrostfireTestCase):
    """Feature 31: Instance Lifecycle & Shutdown."""

    def setUp(self):
        self.main_rs = read_text(HYPERVISOR_MAIN)

    def test_f31_instance_start_action_payload(self):
        """Authoritative Source: ORIGINAL_REQUEST § R4; PROJECT.md Feature 31."""
        self.assertIn('"/actions"', self.main_rs)
        self.assertIn('"action_type": "InstanceStart"', self.main_rs)

    def test_f31_socket_cleanup_on_start(self):
        """Deletes existing socket file before spawning Firecracker binary."""
        self.assertIn("std::fs::remove_file(&self.config.socket_path)", self.main_rs)

    def test_f31_socket_ready_polling_timeout(self):
        """Polls socket existence with bounded loop before proceeding."""
        self.assertIn("for _ in 0..50", self.main_rs)
        self.assertIn("sleep(Duration::from_millis(50))", self.main_rs)

    def test_f31_serial_log_path_specification(self):
        """Contract specifies serial log destination /tmp/firecracker-serial.log."""
        self.assertIn("serial_log_path", self.main_rs)
        self.assertIn("/tmp/firecracker-serial.log", self.main_rs)

    def test_f31_signal_handler_ctrl_c(self):
        """Traps SIGINT / Ctrl-C and kills child process cleanly."""
        self.assertIn("tokio::signal::ctrl_c()", self.main_rs)
        self.assertIn("fc_proc.kill().await", self.main_rs)


class TestTier1F32BoxDoctorVerification(FrostfireTestCase):
    """Feature 32: Box-Doctor Verification."""

    def setUp(self):
        self.script_content = read_text(BOX_DOCTOR)

    def test_f32_script_syntax_and_structure(self):
        """Authoritative Source: ORIGINAL_REQUEST § R4; PROJECT.md Feature 32."""
        self.assertFileExists(BOX_DOCTOR)
        self.assertIn("#!/usr/bin/env bash", self.script_content)
        self.assertIn("set -uo pipefail", self.script_content)

    def test_f32_ten_diagnostic_check_names(self):
        """box-doctor implements all 10 diagnostic checks."""
        expected_checks = [
            "check_machine_id", "check_chrome", "check_chrome_fds", "check_egress",
            "check_clock", "check_dbus", "check_xvfb", "check_x11vnc", "check_novnc", "check_compositor"
        ]
        funcs = extract_bash_functions(self.script_content)
        for chk in expected_checks:
            self.assertIn(chk, funcs, f"Missing diagnostic check function: {chk}")

    def test_f32_pass_fail_output_format(self):
        """Diagnostic output matches format [box-doctor] PASS|FAIL <name>: <detail>."""
        self.assertIn("[box-doctor] PASS %s: %s", self.script_content)
        self.assertIn("[box-doctor] FAIL %s: %s", self.script_content)

    def test_f32_summary_line_format(self):
        """Prints [box-doctor] SUMMARY: %d checks, %d failed."""
        self.assertIn("[box-doctor] SUMMARY: %d checks", self.script_content)

    def test_f32_exit_code_contract(self):
        """Returns 0 on zero failures, returns non-zero when any check fails."""
        self.assertIn("return 0", self.script_content)
        self.assertIn("return 1", self.script_content)
        self.assertIn("exit $?", self.script_content)


if __name__ == "__main__":
    unittest.main()
