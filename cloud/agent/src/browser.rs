use serde::{Deserialize, Serialize};
use tracing::{info, warn};

/// Chrome DevTools Protocol & OS Desktop automation controller
#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct BrowserController {
    http_client: reqwest::Client,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct CdpTarget {
    pub id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub target_type: String,
    pub url: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    pub websocket_debugger_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ScreenshotResult {
    pub display_number: u32,
    pub image_base64: String,
    pub current_url: String,
}

#[allow(dead_code)]
impl BrowserController {
    pub fn new() -> Self {
        Self {
            http_client: reqwest::Client::builder().build().unwrap_or_default(),
        }
    }

    /// Query active CDP targets for a given agent display (:1, :2, :3 -> ports 9223, 9224, 9225)
    pub async fn list_targets(&self, display_number: u32) -> anyhow::Result<Vec<CdpTarget>> {
        let port = 9222 + display_number;
        let url = format!("http://127.0.0.1:{}/json", port);

        let res = self.http_client.get(&url).send().await?;
        if res.status().is_success() {
            let targets: Vec<CdpTarget> = res.json().await?;
            Ok(targets)
        } else {
            Ok(vec![])
        }
    }

    /// Capture a desktop screenshot on the specified display using maim or import
    pub async fn capture_screenshot(&self, display_number: u32) -> anyhow::Result<ScreenshotResult> {
        info!("📸 [BrowserController] Capturing screenshot on Display :{}", display_number);

        // Check if Chrome has an active page
        let targets = self.list_targets(display_number).await.unwrap_or_default();
        let current_url = targets
            .iter()
            .find(|t| t.target_type == "page")
            .map(|t| t.url.clone())
            .unwrap_or_else(|| "desktop://default".to_string());

        // Use maim or xwd to grab the X11 screen buffer
        let output = tokio::process::Command::new("sh")
            .arg("-c")
            .arg(format!(
                "DISPLAY=:{}.0 maim -f png 2>/dev/null | base64 -w 0 || echo ''",
                display_number
            ))
            .output()
            .await;

        let base64_data = match output {
            Ok(out) if !out.stdout.is_empty() => {
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            }
            _ => {
                // Fallback mock 1x1 png or empty indicator
                warn!("maim not found or failed; returning placeholder screenshot");
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==".to_string()
            }
        };

        Ok(ScreenshotResult {
            display_number,
            image_base64: base64_data,
            current_url,
        })
    }

    /// Issue synthetic keyboard/mouse interaction via xdotool
    pub async fn send_desktop_input(
        &self,
        display_number: u32,
        action: &str,
        param: &str,
    ) -> anyhow::Result<()> {
        info!(
            "🖱️ [BrowserController] Sending input to Display :{} - {} ({})",
            display_number, action, param
        );

        let cmd = match action {
            "click" => format!("DISPLAY=:{}.0 xdotool click 1", display_number),
            "mousemove" => format!("DISPLAY=:{}.0 xdotool mousemove {}", display_number, param),
            "type" => format!("DISPLAY=:{}.0 xdotool type --delay 50 '{}'", display_number, param),
            "key" => format!("DISPLAY=:{}.0 xdotool key '{}'", display_number, param),
            _ => return Err(anyhow::anyhow!("Unknown desktop action: {}", action)),
        };

        let _ = tokio::process::Command::new("sh")
            .arg("-c")
            .arg(cmd)
            .output()
            .await?;

        Ok(())
    }
}
