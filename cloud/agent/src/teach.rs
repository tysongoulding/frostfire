use std::path::Path;
use tracing::{info, warn};
use crate::models::ModelProviderClient;

pub struct TeachSessionManager {
    models: ModelProviderClient,
}

impl TeachSessionManager {
    pub fn new(models: ModelProviderClient) -> Self {
        Self { models }
    }

    /// Start a screen recording on display N
    pub async fn start_session(&self, display_number: u32, session_id: &str) -> anyhow::Result<String> {
        info!("🎬 [TeachSessionManager] Starting teach session {} on Display :{}", session_id, display_number);

        let script = "/usr/local/bin/teach-session-recorder";
        if Path::new(script).exists() {
            let output = tokio::process::Command::new(script)
                .arg("start")
                .arg(display_number.to_string())
                .arg(session_id)
                .output()
                .await?;

            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            Ok(stdout)
        } else {
            Ok(format!("Mock teach session {} started on Display :{}", session_id, display_number))
        }
    }

    /// Stop recording and compile SOP using Gemini Flash
    pub async fn stop_and_compile(
        &self,
        display_number: u32,
        session_id: &str,
    ) -> anyhow::Result<String> {
        info!("⏹️ [TeachSessionManager] Stopping teach session {} and compiling SOP", session_id);

        let script = "/usr/local/bin/teach-session-recorder";
        let session_dir = format!("/workspace/teach-sessions/teach-{}", session_id);

        if Path::new(script).exists() {
            let _ = tokio::process::Command::new(script)
                .arg("stop")
                .arg(display_number.to_string())
                .arg(session_id)
                .output()
                .await;
        }

        let video_path = format!("{}/demo.mp4", session_dir);
        let events_path = format!("{}/session-events.jsonl", session_dir);

        let events_data = tokio::fs::read_to_string(&events_path)
            .await
            .unwrap_or_else(|_| "[]".to_string());

        // Call Gemini Flash for SOP generation
        let sop_markdown = self.models.compile_sop_from_video(&video_path, &events_data).await?;

        // Write SOP.md to the session directory
        let sop_file = format!("{}/SOP.md", session_dir);
        if let Err(e) = tokio::fs::write(&sop_file, &sop_markdown).await {
            warn!("Could not write SOP to {}: {}", sop_file, e);
        }

        Ok(sop_markdown)
    }
}
