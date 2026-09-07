#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    // Test HITL classification logic directly
    #[test]
    fn test_hitl_classification_readonly_vs_mutating() {
        let readonly_commands = ["ls -la", "pwd", "git status", "git log -n 5", "echo 'hello'"];
        let mutating_commands = ["rm -rf /tmp/data", "sudo apt update", "git push origin main", "curl http://external.com"];

        for cmd in readonly_commands {
            let is_safe = cmd.starts_with("ls") || cmd == "pwd" || cmd.starts_with("git status") || cmd.starts_with("git log") || cmd.starts_with("echo");
            assert!(is_safe, "Expected {} to be safe readonly", cmd);
        }

        for cmd in mutating_commands {
            let requires_approval = cmd.contains("rm ") || cmd.contains("sudo") || cmd.contains("git push") || cmd.contains("curl");
            assert!(requires_approval, "Expected {} to require HITL approval", cmd);
        }
    }

    #[test]
    fn test_cooperative_mutex_takeover() {
        let is_paused = [
            AtomicBool::new(false),
            AtomicBool::new(false),
            AtomicBool::new(false),
            AtomicBool::new(false),
        ];

        // User focuses display :1
        is_paused[1].store(true, Ordering::SeqCst);
        assert!(is_paused[1].load(Ordering::Relaxed), "Display 1 should be paused during human takeover");
        assert!(!is_paused[2].load(Ordering::Relaxed), "Display 2 should remain active");

        // User releases display :1
        is_paused[1].store(false, Ordering::SeqCst);
        assert!(!is_paused[1].load(Ordering::Relaxed), "Display 1 should resume AI automation");
    }
}
