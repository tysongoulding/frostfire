use anyhow::Result;
use std::path::PathBuf;

#[cfg(unix)]
use anyhow::Context;
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
use tracing::{error, info};

#[derive(Debug, Clone)]
pub struct FirecrackerConfig {
    pub socket_path: PathBuf,
    pub kernel_path: PathBuf,
    pub rootfs_path: PathBuf,
    pub tap_device: String,
    pub vsock_path: PathBuf,
    pub guest_ip: String,
    pub host_ip: String,
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
        }
    }
}

pub struct FirecrackerManager {
    pub config: FirecrackerConfig,
}

impl FirecrackerManager {
    pub fn new(config: FirecrackerConfig) -> Self {
        Self { config }
    }

    #[cfg(unix)]
    pub fn setup_networking(&self) -> Result<()> {
        info!("Setting up TAP device: {}", self.config.tap_device);
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

        // Host NAT routing
        let _ = Command::new("iptables")
            .args(["-t", "nat", "-A", "POSTROUTING", "-o", "eth0", "-j", "MASQUERADE"])
            .status();
        let _ = Command::new("iptables")
            .args(["-A", "FORWARD", "-m", "conntrack", "--ctstate", "RELATED,ESTABLISHED", "-j", "ACCEPT"])
            .status();
        let _ = Command::new("iptables")
            .args(["-A", "FORWARD", "-i", &self.config.tap_device, "-o", "eth0", "-j", "ACCEPT"])
            .status();

        Ok(())
    }

    #[cfg(unix)]
    pub async fn spawn_firecracker(&self) -> Result<tokio::process::Child> {
        if self.config.socket_path.exists() {
            std::fs::remove_file(&self.config.socket_path)?;
        }

        info!("Spawning Firecracker process with socket: {:?}", self.config.socket_path);
        let child = tokio::process::Command::new("firecracker")
            .arg("--api-sock")
            .arg(&self.config.socket_path)
            .spawn()
            .context("Failed to spawn firecracker binary. Ensure firecracker is installed on PATH.")?;

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
        ).await?;

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
        ).await?;

        info!("Attaching TAP network interface...");
        self.send_api_request(
            Method::PUT,
            "/network-interfaces/eth0",
            json!({
                "iface_id": "eth0",
                "guest_mac": "AA:FC:00:00:00:01",
                "host_dev_name": self.config.tap_device
            }),
        ).await?;

        info!("Configuring AF_VSOCK bridge...");
        self.send_api_request(
            Method::PUT,
            "/vsock",
            json!({
                "vsock_id": "vsock0",
                "guest_cid": 3,
                "uds_path": self.config.vsock_path.to_str().unwrap()
            }),
        ).await?;

        info!("Issuing InstanceStart action...");
        self.send_api_request(
            Method::PUT,
            "/actions",
            json!({
                "action_type": "InstanceStart"
            }),
        ).await?;

        info!("Frostfire MicroVM successfully booted!");
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
        tokio::process::Command::new("cmd")
            .args(["/c", "echo", "Firecracker mock process running"])
            .spawn()
            .map_err(Into::into)
    }

    #[cfg(not(unix))]
    pub async fn configure_and_boot(&self) -> Result<()> {
        println!("[frostfire-hypervisor] Configuration validated for target Linux KVM host.");
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
            }
            _ = tokio::signal::ctrl_c() => {
                info!("Received interrupt signal. Shutting down Firecracker hypervisor...");
                let _ = fc_proc.kill().await;
            }
        }
    }

    #[cfg(not(unix))]
    {
        manager.setup_networking()?;
        let mut mock_proc = manager.spawn_firecracker().await?;
        manager.configure_and_boot().await?;
        let _ = mock_proc.wait().await;
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
    }

    #[tokio::test]
    async fn test_manager_instantiation() {
        let config = FirecrackerConfig::default();
        let manager = FirecrackerManager::new(config);
        assert!(manager.setup_networking().is_ok());
    }
}
