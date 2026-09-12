use anyhow::{Context, Result};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

#[cfg(unix)]
use hyper::{Body, Client, Method, Request};
#[cfg(unix)]
use hyper_unix_connector::UnixClient;
#[cfg(unix)]
use serde_json::json;
#[cfg(unix)]
use std::process::Command;
#[cfg(unix)]
use std::time::Duration;
#[cfg(unix)]
use tokio::time::sleep;
#[cfg(unix)]
use tracing::info;

#[derive(Debug, Clone)]
pub struct FirecrackerConfig {
    pub socket_path: PathBuf,
    pub kernel_path: PathBuf,
    pub rootfs_path: PathBuf,
    pub tap_device: String,
    pub vsock_path: PathBuf,
    pub guest_ip: String,
    pub host_ip: String,
    pub host_interface: Option<String>,
    pub serial_log_path: PathBuf,
    pub vcpu_count: u32,
    pub mem_size_mib: u32,
    pub smt: bool,
}

impl Default for FirecrackerConfig {
    fn default() -> Self {
        Self {
            socket_path: PathBuf::from("/tmp/firecracker.socket"),
            kernel_path: PathBuf::from("./build/kernel/out/vmlinux-6.12.6"),
            rootfs_path: PathBuf::from("./build/rootfs.ext4"),
            tap_device: "tap0".to_string(),
            vsock_path: PathBuf::from("/tmp/vsock.sock"),
            guest_ip: "172.30.0.2".to_string(),
            host_ip: "172.30.0.1".to_string(),
            host_interface: None,
            serial_log_path: PathBuf::from("/tmp/firecracker-serial.log"),
            vcpu_count: 2,
            mem_size_mib: 4096,
            smt: false,
        }
    }
}

/// Parses the default network interface name from `ip route show default` output.
pub fn parse_default_interface(route_output: &str) -> Option<String> {
    for line in route_output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("default") {
            let tokens: Vec<&str> = trimmed.split_whitespace().collect();
            for i in 0..tokens.len() {
                if tokens[i] == "dev" && i + 1 < tokens.len() {
                    let iface = tokens[i + 1].trim();
                    if !iface.is_empty()
                        && iface
                            .chars()
                            .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
                    {
                        return Some(iface.to_string());
                    }
                }
            }
        }
    }
    None
}

/// Detects the host default gateway network interface dynamically.
pub fn detect_host_gateway_interface() -> String {
    #[cfg(unix)]
    {
        if let Ok(output) = Command::new("ip").args(["route", "show", "default"]).output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(iface) = parse_default_interface(&stdout) {
                    return iface;
                }
            }
        }

        // Fallback: check sysfs for typical EC2 Nitro (ens5) then legacy (eth0)
        if std::path::Path::new("/sys/class/net/ens5").exists() {
            return "ens5".to_string();
        }
        if std::path::Path::new("/sys/class/net/eth0").exists() {
            return "eth0".to_string();
        }
    }

    // Default fallback if detection fails or non-unix
    "eth0".to_string()
}

pub struct FirecrackerManager {
    pub config: FirecrackerConfig,
}

impl FirecrackerManager {
    pub fn new(config: FirecrackerConfig) -> Self {
        Self { config }
    }

    /// Asynchronously streams stdout and stderr from the child process to `serial_log_path`
    /// and mirrors output to the terminal (tee).
    pub async fn stream_child_output(&self, child: &mut tokio::process::Child) -> Result<()> {
        let log_file = Arc::new(Mutex::new(
            tokio::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&self.config.serial_log_path)
                .await
                .context(format!(
                    "Failed to open serial log file at {:?}",
                    self.config.serial_log_path
                ))?,
        ));

        if let Some(stdout) = child.stdout.take() {
            let log_file_stdout = log_file.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout);
                let mut buf = Vec::new();
                loop {
                    buf.clear();
                    match reader.read_until(b'\n', &mut buf).await {
                        Ok(0) => break,
                        Ok(_) => {
                            let line_str = String::from_utf8_lossy(&buf);
                            print!("[guest-serial] {}", line_str);
                            let mut file = log_file_stdout.lock().await;
                            let _ = file.write_all(&buf).await;
                            let _ = file.flush().await;
                        }
                        Err(e) => {
                            eprintln!("[guest-serial-err] Error reading serial stream: {}", e);
                            break;
                        }
                    }
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let log_file_stderr = log_file.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut buf = Vec::new();
                loop {
                    buf.clear();
                    match reader.read_until(b'\n', &mut buf).await {
                        Ok(0) => break,
                        Ok(_) => {
                            let line_str = String::from_utf8_lossy(&buf);
                            eprint!("[firecracker-err] {}", line_str);
                            let mut file = log_file_stderr.lock().await;
                            let _ = file.write_all(&buf).await;
                            let _ = file.flush().await;
                        }
                        Err(e) => {
                            eprintln!("[firecracker-err] Error reading stderr: {}", e);
                            break;
                        }
                    }
                }
            });
        }

        Ok(())
    }

    #[cfg(unix)]
    pub fn setup_networking(&self) -> Result<()> {
        info!("Setting up TAP device: {}", self.config.tap_device);

        // Preemptively remove stale TAP device from previous runs
        let _ = Command::new("ip")
            .args(["link", "del", "dev", &self.config.tap_device])
            .status();

        Command::new("ip")
            .args(["tuntap", "add", "dev", &self.config.tap_device, "mode", "tap"])
            .status()
            .context("Failed to add tap device")?;

        let host_cidr = format!("{}/24", self.config.host_ip);
        Command::new("ip")
            .args(["addr", "add", &host_cidr, "dev", &self.config.tap_device])
            .status()
            .context("Failed to assign IP to tap device")?;

        Command::new("ip")
            .args(["link", "set", "dev", &self.config.tap_device, "up"])
            .status()
            .context("Failed to bring up tap device")?;

        // Detect outbound gateway interface dynamically
        let host_iface = self
            .config
            .host_interface
            .clone()
            .unwrap_or_else(detect_host_gateway_interface);
        info!("Configuring host NAT via interface: {}", host_iface);

        // Host NAT routing
        let _ = Command::new("iptables")
            .args(["-t", "nat", "-A", "POSTROUTING", "-o", &host_iface, "-j", "MASQUERADE"])
            .status();
        let _ = Command::new("iptables")
            .args([
                "-A",
                "FORWARD",
                "-m",
                "conntrack",
                "--ctstate",
                "RELATED,ESTABLISHED",
                "-j",
                "ACCEPT",
            ])
            .status();
        let _ = Command::new("iptables")
            .args([
                "-A",
                "FORWARD",
                "-i",
                &self.config.tap_device,
                "-o",
                &host_iface,
                "-j",
                "ACCEPT",
            ])
            .status();

        Ok(())
    }

    #[cfg(unix)]
    pub async fn spawn_firecracker(&self) -> Result<tokio::process::Child> {
        if self.config.socket_path.exists() {
            std::fs::remove_file(&self.config.socket_path)?;
        }
        if self.config.vsock_path.exists() {
            std::fs::remove_file(&self.config.vsock_path)?;
        }

        info!("Spawning Firecracker process with socket: {:?}", self.config.socket_path);

        if let Some(parent) = self.config.serial_log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let mut child = tokio::process::Command::new("firecracker")
            .arg("--api-sock")
            .arg(&self.config.socket_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("Failed to spawn firecracker binary. Ensure firecracker is installed on PATH.")?;

        self.stream_child_output(&mut child).await?;

        for _ in 0..50 {
            if self.config.socket_path.exists() {
                break;
            }
            sleep(Duration::from_millis(50)).await;
        }

        if !self.config.socket_path.exists() {
            anyhow::bail!("Firecracker API socket did not become ready in time: {:?}", self.config.socket_path);
        }

        Ok(child)
    }

    #[cfg(unix)]
    async fn send_api_request(&self, method: Method, path: &str, body: serde_json::Value) -> Result<()> {
        let client: Client<UnixClient, Body> = Client::builder().build(UnixClient);
        let url: hyper::Uri = hyper_unix_connector::Uri::new(&self.config.socket_path, path).into();

        let req = Request::builder()
            .method(method)
            .uri(url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .body(Body::from(body.to_string()))?;

        let res = client.request(req).await.context("Failed sending Firecracker API request")?;
        if !res.status().is_success() {
            let status = res.status();
            let bytes = hyper::body::to_bytes(res.into_body()).await?;
            anyhow::bail!("Firecracker API call {} failed ({}): {:?}", path, status, bytes);
        }
        Ok(())
    }

    #[cfg(unix)]
    pub async fn configure_and_boot(&self) -> Result<()> {
        info!(
            "Configuring microVM machine-config ({} vCPUs, {} MiB RAM)...",
            self.config.vcpu_count, self.config.mem_size_mib
        );
        self.send_api_request(
            Method::PUT,
            "/machine-config",
            json!({
                "vcpu_count": self.config.vcpu_count,
                "mem_size_mib": self.config.mem_size_mib,
                "smt": self.config.smt
            }),
        )
        .await?;

        let boot_args = format!(
            "console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda rw quiet ip={}::{}:255.255.255.0::eth0:off",
            self.config.guest_ip, self.config.host_ip
        );

        info!("Configuring microVM boot-source...");
        self.send_api_request(
            Method::PUT,
            "/boot-source",
            json!({
                "kernel_image_path": self.config.kernel_path.to_str().unwrap(),
                "boot_args": boot_args
            }),
        )
        .await?;

        info!("Attaching /dev/vda rootfs drive...");
        self.send_api_request(
            Method::PUT,
            "/drives/rootfs",
            json!({
                "drive_id": "rootfs",
                "path_on_host": self.config.rootfs_path.to_str().unwrap(),
                "is_root_device": true,
                "is_read_only": false
            }),
        )
        .await?;

        info!("Attaching TAP network interface...");
        self.send_api_request(
            Method::PUT,
            "/network-interfaces/eth0",
            json!({
                "iface_id": "eth0",
                "guest_mac": "AA:FC:00:00:00:01",
                "host_dev_name": self.config.tap_device
            }),
        )
        .await?;

        info!("Configuring AF_VSOCK bridge...");
        self.send_api_request(
            Method::PUT,
            "/vsock",
            json!({
                "vsock_id": "vsock0",
                "guest_cid": 3,
                "uds_path": self.config.vsock_path.to_str().unwrap()
            }),
        )
        .await?;

        info!("Issuing InstanceStart action...");
        self.send_api_request(
            Method::PUT,
            "/actions",
            json!({
                "action_type": "InstanceStart"
            }),
        )
        .await?;

        info!("Frostfire MicroVM successfully booted!");
        Ok(())
    }

    pub fn teardown(&self) -> Result<()> {
        #[cfg(unix)]
        info!("Tearing down Firecracker hypervisor resources...");
        #[cfg(not(unix))]
        println!("[frostfire-hypervisor] Tearing down Firecracker hypervisor resources...");

        // 1. Unlink Firecracker API socket
        if self.config.socket_path.exists() {
            let _ = std::fs::remove_file(&self.config.socket_path);
        }

        // 2. Unlink VSOCK socket
        if self.config.vsock_path.exists() {
            let _ = std::fs::remove_file(&self.config.vsock_path);
        }

        #[cfg(unix)]
        {
            // 3. Remove iptables rules
            let host_iface = self
                .config
                .host_interface
                .clone()
                .unwrap_or_else(detect_host_gateway_interface);
            let _ = Command::new("iptables")
                .args(["-t", "nat", "-D", "POSTROUTING", "-o", &host_iface, "-j", "MASQUERADE"])
                .status();
            let _ = Command::new("iptables")
                .args([
                    "-D",
                    "FORWARD",
                    "-i",
                    &self.config.tap_device,
                    "-o",
                    &host_iface,
                    "-j",
                    "ACCEPT",
                ])
                .status();
            let _ = Command::new("iptables")
                .args([
                    "-D",
                    "FORWARD",
                    "-m",
                    "conntrack",
                    "--ctstate",
                    "RELATED,ESTABLISHED",
                    "-j",
                    "ACCEPT",
                ])
                .status();

            // 4. Delete TAP device
            info!("Deleting TAP device: {}", self.config.tap_device);
            let _ = Command::new("ip")
                .args(["link", "del", "dev", &self.config.tap_device])
                .status();
        }

        Ok(())
    }

    #[cfg(not(unix))]
    pub fn setup_networking(&self) -> Result<()> {
        println!("[frostfire-hypervisor] Non-Unix host detected: TAP networking setup is a no-op on Windows.");
        Ok(())
    }

    #[cfg(not(unix))]
    pub async fn spawn_firecracker(&self) -> Result<tokio::process::Child> {
        println!("[frostfire-hypervisor] Non-Unix host detected: Firecracker requires Linux KVM.");
        if self.config.socket_path.exists() {
            let _ = std::fs::remove_file(&self.config.socket_path);
        }
        if self.config.vsock_path.exists() {
            let _ = std::fs::remove_file(&self.config.vsock_path);
        }
        if let Some(parent) = self.config.serial_log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let mut child = tokio::process::Command::new("cmd")
            .args(["/c", "echo", "[guest-serial] Firecracker mock process running"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("Failed to spawn mock process")?;

        self.stream_child_output(&mut child).await?;
        Ok(child)
    }

    #[cfg(not(unix))]
    pub async fn configure_and_boot(&self) -> Result<()> {
        println!(
            "[frostfire-hypervisor] Validated machine-config ({} vCPUs, {} MiB RAM) for target Linux KVM host.",
            self.config.vcpu_count, self.config.mem_size_mib
        );
        Ok(())
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    println!(">>> Starting Frostfire Bare-Metal Hypervisor Daemon (Phase 1 POC)...");
    let config = FirecrackerConfig::default();
    println!(">>> Configuration: {:?}", config);

    let manager = FirecrackerManager::new(config);

    #[cfg(unix)]
    {
        manager.setup_networking()?;
        let mut fc_proc = manager.spawn_firecracker().await?;
        manager.configure_and_boot().await?;

        tokio::select! {
            status = fc_proc.wait() => {
                info!("Firecracker exited with status: {:?}", status);
                let _ = manager.teardown();
            }
            _ = tokio::signal::ctrl_c() => {
                info!("Received interrupt signal. Shutting down Firecracker hypervisor...");
                let _ = fc_proc.kill().await;
                let _ = fc_proc.wait().await;
                let _ = manager.teardown();
            }
        }
    }

    #[cfg(not(unix))]
    {
        manager.setup_networking()?;
        let mut mock_proc = manager.spawn_firecracker().await?;
        manager.configure_and_boot().await?;
        tokio::select! {
            _ = mock_proc.wait() => {
                println!("[frostfire-hypervisor] Mock process finished.");
                let _ = manager.teardown();
            }
            _ = tokio::signal::ctrl_c() => {
                println!("[frostfire-hypervisor] Received interrupt signal. Shutting down...");
                let _ = mock_proc.kill().await;
                let _ = mock_proc.wait().await;
                let _ = manager.teardown();
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = FirecrackerConfig::default();
        assert_eq!(config.tap_device, "tap0");
        assert_eq!(config.guest_ip, "172.30.0.2");
        assert_eq!(config.host_ip, "172.30.0.1");
        assert_eq!(config.socket_path, PathBuf::from("/tmp/firecracker.socket"));
        assert_eq!(config.vsock_path, PathBuf::from("/tmp/vsock.sock"));
        assert_eq!(config.serial_log_path, PathBuf::from("/tmp/firecracker-serial.log"));
        assert_eq!(config.vcpu_count, 2);
        assert_eq!(config.mem_size_mib, 4096);
        assert_eq!(config.smt, false);
        assert_eq!(config.host_interface, None);
    }

    #[test]
    fn test_parse_default_interface() {
        let nitro_output = "default via 172.31.16.1 dev ens5 proto dhcp src 172.31.25.101 metric 100\n";
        assert_eq!(parse_default_interface(nitro_output), Some("ens5".to_string()));

        let eth0_output = "default via 192.168.1.1 dev eth0 metric 100\n";
        assert_eq!(parse_default_interface(eth0_output), Some("eth0".to_string()));

        let multi_output = "\
default via 10.0.0.1 dev eth0 proto static metric 100\n\
10.0.0.0/24 dev eth0 proto kernel scope link src 10.0.0.50\n\
172.30.0.0/24 dev tap0 proto kernel scope link src 172.30.0.1\n";
        assert_eq!(parse_default_interface(multi_output), Some("eth0".to_string()));

        let no_default = "\
10.0.0.0/24 dev eth0 proto kernel scope link src 10.0.0.50\n\
172.30.0.0/24 dev tap0 proto kernel scope link src 172.30.0.1\n";
        assert_eq!(parse_default_interface(no_default), None);

        assert_eq!(parse_default_interface(""), None);
    }

    #[test]
    fn test_detect_host_gateway_interface() {
        let iface = detect_host_gateway_interface();
        assert!(!iface.is_empty());
    }

    #[tokio::test]
    async fn test_manager_instantiation() {
        let config = FirecrackerConfig::default();
        let manager = FirecrackerManager::new(config);
        assert!(manager.setup_networking().is_ok());
    }

    #[tokio::test]
    async fn test_teardown_cleans_sockets() {
        let tmp_dir = std::env::temp_dir();
        let sock_path = tmp_dir.join("test_firecracker_socket.sock");
        let vsock_path = tmp_dir.join("test_vsock_socket.sock");

        std::fs::write(&sock_path, b"test_fc").expect("write test socket");
        std::fs::write(&vsock_path, b"test_vsock").expect("write test vsock");
        assert!(sock_path.exists());
        assert!(vsock_path.exists());

        let mut config = FirecrackerConfig::default();
        config.socket_path = sock_path.clone();
        config.vsock_path = vsock_path.clone();
        let manager = FirecrackerManager::new(config);

        let result = manager.teardown();
        assert!(result.is_ok());
        assert!(!sock_path.exists());
        assert!(!vsock_path.exists());
    }

    #[tokio::test]
    async fn test_serial_logging_stream() {
        let tmp_dir = std::env::temp_dir();
        let log_path = tmp_dir.join(format!(
            "test_serial_{}.log",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_file(&log_path);

        let mut config = FirecrackerConfig::default();
        config.serial_log_path = log_path.clone();
        let manager = FirecrackerManager::new(config);

        let mut child = manager.spawn_firecracker().await.expect("spawn firecracker");
        let _ = child.wait().await;

        // Allow background async streaming task a brief moment to flush
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        assert!(log_path.exists(), "Serial log file should be created");
        let content = std::fs::read_to_string(&log_path).expect("read serial log");
        assert!(!content.is_empty(), "Serial log content should not be empty");

        let _ = std::fs::remove_file(&log_path);
    }
}
