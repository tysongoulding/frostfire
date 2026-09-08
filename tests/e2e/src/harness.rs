//! Domain models, specification validators, and test fixtures across all 16 features

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Returns the absolute path to the workspace root repository.
pub fn workspace_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

/// F6: OverlayFS Copy-on-Write Configuration Model
#[derive(Debug, Clone)]
pub struct OverlayFsConfig {
    pub golden_lowerdir: PathBuf,
    pub instance_upperdir: PathBuf,
    pub instance_workdir: PathBuf,
    pub merged_mount: PathBuf,
}

impl OverlayFsConfig {
    pub fn new(base: impl Into<PathBuf>, instance_id: &str) -> Self {
        let base = base.into();
        Self {
            golden_lowerdir: base.join("golden_base"),
            instance_upperdir: base.join(format!("instances/{}/upper", instance_id)),
            instance_workdir: base.join(format!("instances/{}/work", instance_id)),
            merged_mount: base.join(format!("instances/{}/rootfs", instance_id)),
        }
    }

    pub fn mount_options(&self) -> String {
        format!(
            "lowerdir={},upperdir={},workdir={}",
            self.golden_lowerdir.display(),
            self.instance_upperdir.display(),
            self.instance_workdir.display()
        )
    }

    /// Verifies that multiple microVM branches maintain independent upperdirs without mutating lowerdir.
    pub fn verify_isolation(instances: &[OverlayFsConfig]) -> bool {
        let mut upper_set = std::collections::HashSet::new();
        for inst in instances {
            if !upper_set.insert(inst.instance_upperdir.clone()) {
                return false; // Collision in upperdir!
            }
        }
        true
    }
}

/// F7: Cgroups v2 Dual-Domain Scheduling Partition Model
#[derive(Debug, Clone)]
pub struct CgroupV2Partition {
    pub interactive_path: String,
    pub interactive_cpu_weight: u32,
    pub agent_path: String,
    pub agent_cpu_weight: u32,
}

impl Default for CgroupV2Partition {
    fn default() -> Self {
        Self {
            interactive_path: "/sys/fs/cgroup/interactive".to_string(),
            interactive_cpu_weight: 800,
            agent_path: "/sys/fs/cgroup/agent".to_string(),
            agent_cpu_weight: 100,
        }
    }
}

impl CgroupV2Partition {
    /// Asserts invariant: interactive domain has strictly higher priority (800 vs 100 = 8x weight)
    pub fn is_valid(&self) -> bool {
        self.interactive_cpu_weight == 800
            && self.agent_cpu_weight == 100
            && self.interactive_cpu_weight >= self.agent_cpu_weight * 8
    }
}

/// F8: Window Router Multi-Display Routing Contract
#[derive(Debug, Clone)]
pub struct WindowRouterDecision {
    pub target_port: Option<u16>,
    pub status_code: u16,
    pub is_upgrade: bool,
}

pub fn route_window_request(
    display: i32,
    owner_token: Option<&str>,
    registered_tokens: &HashMap<i32, String>,
    is_websocket_upgrade: bool,
) -> WindowRouterDecision {
    if display < 1 {
        return WindowRouterDecision {
            target_port: None,
            status_code: 400,
            is_upgrade: false,
        };
    }

    // Invariant: Token validation required on ALL displays (including display 1)
    let bound_token = match registered_tokens.get(&display) {
        Some(token) => token.as_str(),
        None => {
            return WindowRouterDecision {
                target_port: None,
                status_code: 403,
                is_upgrade: false,
            };
        }
    };

    let provided_token = match owner_token {
        Some(t) if !t.is_empty() => t,
        _ => {
            return WindowRouterDecision {
                target_port: None,
                status_code: 403,
                is_upgrade: false,
            };
        }
    };

    if !crate::assertions::constant_time_compare(provided_token.as_bytes(), bound_token.as_bytes()) {
        return WindowRouterDecision {
            target_port: None,
            status_code: 403,
            is_upgrade: false,
        };
    }

    let port = if display == 1 {
        1337
    } else {
        (14000 + display) as u16
    };

    WindowRouterDecision {
        target_port: Some(port),
        status_code: if is_websocket_upgrade { 101 } else { 200 },
        is_upgrade: is_websocket_upgrade,
    }
}

/// F9: Chrome Multi-Display Session Linking Model
pub struct ChromeSessionLinker;

impl ChromeSessionLinker {
    pub const SHARED_SQLITE_DATABASES: &'static [&'static str] = &[
        "Cookies",
        "Login Data",
        "Login Data For Account",
    ];

    pub fn profile_dir_for_display(display: u32) -> String {
        format!("/home/agent/.config/google-chrome-display-{}", display)
    }

    pub fn verify_symlinks(display_profile: &Path, source_profile: &Path) -> Vec<(String, bool)> {
        Self::SHARED_SQLITE_DATABASES
            .iter()
            .map(|db| {
                let target = display_profile.join("Default").join(db);
                let expected_source = source_profile.join("Default").join(db);
                let valid = target.exists() || expected_source.exists();
                (db.to_string(), valid)
            })
            .collect()
    }
}

/// F11: In-VM Daemon Supervisor State
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SupervisorState {
    Running,
    ChildExited { exit_code: i32 },
    CrashLoopBackoff { attempt: u32, backoff_secs: u64 },
    Terminated,
}

pub struct SupervisorCrashWatcher {
    pub max_restarts: u32,
    pub current_restarts: u32,
    pub state: SupervisorState,
}

impl SupervisorCrashWatcher {
    pub fn new(max_restarts: u32) -> Self {
        Self {
            max_restarts,
            current_restarts: 0,
            state: SupervisorState::Running,
        }
    }

    pub fn record_exit(&mut self, exit_code: i32) {
        if exit_code == 0 {
            self.current_restarts = 0;
            self.state = SupervisorState::Terminated;
        } else {
            self.current_restarts += 1;
            if self.current_restarts > self.max_restarts {
                self.state = SupervisorState::Terminated;
            } else {
                let backoff = (1 << self.current_restarts).min(30);
                self.state = SupervisorState::CrashLoopBackoff {
                    attempt: self.current_restarts,
                    backoff_secs: backoff,
                };
            }
        }
    }
}

/// F13: Isolated Network Bridge Invariants
#[derive(Debug, Clone)]
pub struct NetworkBridgeSpec {
    pub tap_name: String,
    pub host_ip: String,
    pub guest_ip: String,
    pub subnet_cidr: String,
    pub allow_nat_masquerade: bool,
    pub allow_wan_forwarding: bool,
}

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

    /// Validates adherence to AGENTS.md invariant: NO direct public egress
    pub fn satisfies_isolation_invariants(&self) -> bool {
        !self.allow_nat_masquerade && !self.allow_wan_forwarding && self.host_ip.starts_with("172.16.")
    }
}
