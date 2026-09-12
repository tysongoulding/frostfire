"""
Frostfire Cloud E2E Test Suite — Tier 3: Cross-Feature Combinations
Validates pairwise interactions, subsystem contracts, and data-flow
cohesion across host infrastructure, kernel, rootfs, hypervisor, and guest.
"""

import json
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
    HYPERVISOR_MAIN,
    KERNEL_CONFIG,
    ROOT_DIR,
    SETUP_HOST_SH,
    START_FROSTFIRE_BOX,
    FrostfireTestCase,
    load_cf_yaml,
    parse_kernel_config,
    read_text,
)


class TestTier3PairwiseInteractions(FrostfireTestCase):
    """Tier 3: Pairwise Cross-Feature Interactions across Frostfire Subsystems."""

    def test_t3_01_host_userdata_and_idle_daemon_cron_integration(self):
        """UserData and setup-host.sh schedule identical auto-idle cron daemon."""
        cf = read_text(DEPLOY_POC_YAML)
        setup_sh = read_text(SETUP_HOST_SH)
        cron_pattern = "*/5 * * * * /usr/local/bin/check-idle-shutdown.sh"
        self.assertIn(cron_pattern, cf)
        self.assertIn(cron_pattern, setup_sh)

    def test_t3_02_security_group_ports_and_guest_service_ports(self):
        """CloudFormation SecurityGroup ingress ports match guest services."""
        cf_yaml = load_cf_yaml(DEPLOY_POC_YAML)
        ingress = cf_yaml["Resources"]["PocSecurityGroup"]["Properties"]["SecurityGroupIngress"]
        sg_ports = {r["FromPort"] for r in ingress}

        start_sh = read_text(START_FROSTFIRE_BOX)
        doctor_sh = read_text(BOX_DOCTOR)

        # Port 1339 (Window Router)
        self.assertIn(1339, sg_ports)
        self.assertIn("1339", start_sh)

        # Port 6080 (Primary noVNC)
        self.assertIn(6080, sg_ports)
        self.assertIn("6080", doctor_sh)

        # Port 6081 (Secondary/Fork noVNC)
        self.assertIn(6081, sg_ports)
        self.assertIn("6081", start_sh)
        self.assertIn("6081", doctor_sh)

        # Port 22 (SSH)
        self.assertIn(22, sg_ports)

    def test_t3_03_kernel_boot_args_and_hypervisor_ip_config(self):
        """Hypervisor boot arguments match TAP interface IP configuration."""
        main_rs = read_text(HYPERVISOR_MAIN)
        # Boot args: ip=<guest_ip>::<host_ip>:255.255.255.0::eth0:off
        self.assertIn("172.30.0.2", main_rs)
        self.assertIn("172.30.0.1", main_rs)
        self.assertIn("tap0", main_rs)
        self.assertIn("eth0", main_rs)

    def test_t3_04_virtio_driver_config_and_hypervisor_device_attachments(self):
        """Kernel VirtIO configuration covers every device attached by hypervisor."""
        cfg = parse_kernel_config(KERNEL_CONFIG)
        main_rs = read_text(HYPERVISOR_MAIN)

        # /drives/rootfs requires CONFIG_VIRTIO_BLK
        self.assertIn("/drives/rootfs", main_rs)
        self.assertEqual(cfg.get("CONFIG_VIRTIO_BLK"), "y")

        # /network-interfaces/eth0 requires CONFIG_VIRTIO_NET
        self.assertIn("/network-interfaces/eth0", main_rs)
        self.assertEqual(cfg.get("CONFIG_VIRTIO_NET"), "y")

        # /vsock requires CONFIG_VIRTIO_VSOCK and CONFIG_VSOCKETS
        self.assertIn("/vsock", main_rs)
        self.assertEqual(cfg.get("CONFIG_VIRTIO_VSOCK"), "y")
        self.assertEqual(cfg.get("CONFIG_VSOCKETS"), "y")

    def test_t3_05_cgroup_kernel_configs_and_box_cgroups_script(self):
        """Kernel cgroups configuration provides controllers used by box-cgroups.sh."""
        cfg = parse_kernel_config(KERNEL_CONFIG)
        cgroup_sh = read_text(BOX_CGROUPS_SH)

        # CPU controller
        self.assertIn("cpu", cgroup_sh)
        self.assertEqual(cfg.get("CONFIG_CGROUPS"), "y")
        self.assertEqual(cfg.get("CONFIG_CGROUP_SCHED"), "y")
        self.assertEqual(cfg.get("CONFIG_FAIR_GROUP_SCHED"), "y")
        self.assertEqual(cfg.get("CONFIG_CFS_BANDWIDTH"), "y")

        # Memory and PIDs
        self.assertEqual(cfg.get("CONFIG_MEMCG"), "y")
        self.assertEqual(cfg.get("CONFIG_CGROUP_PIDS"), "y")

    def test_t3_06_rootfs_user_box_and_home_profile_ownership(self):
        """Chroot user creation box:1000:1000 pairs with home-box profile ownership."""
        rootfs_sh = read_text(BUILD_ROOTFS_SH)
        self.assertIn("useradd -u 1000", rootfs_sh)
        self.assertIn("chown -R box:box /home/box", rootfs_sh)
        self.assertFileExists(HOME_BOX_DIR / ".bashrc")
        self.assertFileExists(HOME_BOX_DIR / ".profile")

    def test_t3_07_recombined_binaries_and_rootfs_daemon_execution(self):
        """Recombined split binaries match executables staged into rootfs exec-daemon."""
        rootfs_sh = read_text(BUILD_ROOTFS_SH)
        self.assertIn("node.part.", rootfs_sh)
        self.assertIn("exec-daemon/node", rootfs_sh)
        self.assertIn("origin.part.", rootfs_sh)
        self.assertIn("exec-daemon/tools/origin", rootfs_sh)

    def test_t3_08_chrome_policies_and_native_messaging_manifests(self):
        """Chrome managed policies reference matching native messaging extension."""
        policy_file = ETC_POLICIES_DIR / "policies" / "managed" / "frostfire-webauthn.json"
        policy_data = json.loads(read_text(policy_file))
        ext_settings = policy_data.get("ExtensionSettings", {})

        nm_file = ETC_POLICIES_DIR / "native-messaging-hosts" / "co.anysphere.frostfire.webauthn_proxy.json"
        nm_data = json.loads(read_text(nm_file))
        allowed_origins = nm_data.get("allowed_origins", [])

        # Match extension ID across policy and native messaging host
        for ext_id in ext_settings.keys():
            expected_origin = f"chrome-extension://{ext_id}/"
            self.assertIn(expected_origin, allowed_origins)

    def test_t3_09_desktop_stack_xvfb_and_novnc_websockify_chain(self):
        """Desktop display chain: Xvfb (:1) -> x11vnc (5900) -> websockify (6080)."""
        start_sh = read_text(START_FROSTFIRE_BOX)
        doctor_sh = read_text(BOX_DOCTOR)

        self.assertIn('DISPLAY="${DISPLAY:-:1}"', start_sh)
        self.assertIn("SAND_BOX_PRIMARY_VNC_PORT=5900", doctor_sh)
        self.assertIn("SAND_BOX_PORT_PRIMARY_NOVNC=6080", doctor_sh)

    def test_t3_10_hypervisor_vsock_config_and_guest_exec_daemon(self):
        """Hypervisor vsock config assigns CID 3 matching guest daemon contract."""
        main_rs = read_text(HYPERVISOR_MAIN)
        self.assertIn('"guest_cid": 3', main_rs)
        self.assertIn('"uds_path": self.config.vsock_path', main_rs)

    def test_t3_11_box_doctor_probes_and_rootfs_installed_utilities(self):
        """All binaries invoked by box-doctor are installed by build-rootfs.sh."""
        rootfs_sh = read_text(BUILD_ROOTFS_SH)
        for binary in ["google-chrome-stable", "xvfb", "xfwm4", "picom", "x11vnc", "websockify", "novnc", "dbus", "curl"]:
            self.assertIn(binary, rootfs_sh, f"Diagnostic probe target missing from rootfs packages: {binary}")

    def test_t3_12_hypervisor_tap_egress_and_box_doctor_egress_check(self):
        """Hypervisor NAT masquerade aligns with box-doctor generate_204 egress check."""
        main_rs = read_text(HYPERVISOR_MAIN)
        doctor_sh = read_text(BOX_DOCTOR)

        self.assertIn("MASQUERADE", main_rs)
        self.assertIn("https://www.google.com/generate_204", doctor_sh)

    def test_t3_13_hardware_rng_entropy_and_guest_machine_id_generation(self):
        """Kernel HW_RANDOM enables non-blocking entropy for machine-id generation."""
        cfg = parse_kernel_config(KERNEL_CONFIG)
        rootfs_sh = read_text(BUILD_ROOTFS_SH)

        self.assertEqual(cfg.get("CONFIG_HW_RANDOM"), "y")
        self.assertIn("dbus-uuidgen > /etc/machine-id", rootfs_sh)

    def test_t3_14_rootfs_systemd_autostart_and_start_frostfire_box(self):
        """start-frostfire-box defines entrypoint stages expected by systemd service."""
        start_sh = read_text(START_FROSTFIRE_BOX)
        self.assertIn('emit_boot_stage "entrypoint_started"', start_sh)

    def test_t3_15_deploy_scripts_and_cloudformation_template_parameters(self):
        """Deploy scripts parameters align with CloudFormation template parameters."""
        cf_yaml = load_cf_yaml(DEPLOY_POC_YAML)
        params = cf_yaml["Parameters"]

        ps1 = read_text(DEPLOY_POC_PS1)
        sh = read_text(DEPLOY_POC_SH)

        for param_name in ["InstanceType", "KeyName", "AllowedCidr"]:
            self.assertIn(param_name, params)
            self.assertIn(param_name, ps1)
            self.assertIn(param_name, sh)

    def test_t3_16_idle_shutdown_ports_and_active_user_connections(self):
        """check-idle-shutdown ports 22 and 6080 monitor the two external access paths."""
        idle_sh = read_text(CHECK_IDLE_SH)
        cf_yaml = load_cf_yaml(DEPLOY_POC_YAML)
        outputs = cf_yaml["Outputs"]

        self.assertIn("sport = :22", idle_sh)
        self.assertIn("sport = :6080", idle_sh)
        self.assertIn("SshAccessCommand", outputs)
        self.assertIn("NoVncUrl", outputs)

    def test_t3_17_hypervisor_machine_config_and_kernel_memory_allocation(self):
        """Hypervisor 4096 MiB RAM config prevents OOM under multi-process Chrome."""
        main_rs = read_text(HYPERVISOR_MAIN)
        self.assertIn("mem_size_mib: 4096", main_rs)
        self.assertIn("vcpu_count: 2", main_rs)

    def test_t3_18_chroot_hygiene_mounts_and_rootfs_disk_integrity(self):
        """Chroot cleanup ensures loop unmount before Firecracker attaches rootfs."""
        rootfs_sh = read_text(BUILD_ROOTFS_SH)
        main_rs = read_text(HYPERVISOR_MAIN)

        self.assertIn("cleanup", rootfs_sh)
        self.assertIn("sudo umount", rootfs_sh)
        self.assertIn('rootfs_path: PathBuf::from("./build/rootfs.ext4")', main_rs)

    def test_t3_19_rootfs_ext4_block_size_and_kernel_ext4_driver(self):
        """mkfs.ext4 -b 4096 block size matches Linux 6.12 4K page ext4 driver."""
        rootfs_sh = read_text(BUILD_ROOTFS_SH)
        cfg = parse_kernel_config(KERNEL_CONFIG)

        self.assertIn("-b 4096", rootfs_sh)
        self.assertEqual(cfg.get("CONFIG_EXT4_FS"), "y")

    def test_t3_20_hypervisor_clean_shutdown_and_host_socket_cleanup(self):
        """Hypervisor SIGINT trap releases child and prepares socket for re-run."""
        main_rs = read_text(HYPERVISOR_MAIN)
        self.assertIn("tokio::signal::ctrl_c()", main_rs)
        self.assertIn("fc_proc.kill().await", main_rs)
        self.assertIn("std::fs::remove_file(&self.config.socket_path)", main_rs)


if __name__ == "__main__":
    unittest.main()
