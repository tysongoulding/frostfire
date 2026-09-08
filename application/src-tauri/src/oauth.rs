use std::collections::HashMap;
use std::net::SocketAddr;
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

#[derive(Error, Debug)]
pub enum OAuthError {
    #[error("Failed to bind local loopback listener: {0}")]
    BindError(#[from] std::io::Error),
    #[error("OAuth authorization timed out")]
    Timeout,
    #[error("Invalid OAuth callback URL: {0}")]
    InvalidCallback(String),
    #[error("CSRF state mismatch")]
    StateMismatch,
    #[error("Authorization failed: {0}")]
    AuthFailed(String),
}

#[derive(Debug, Clone)]
pub struct PkceSession {
    pub provider: String,
    pub state: String,
    pub code_verifier: String,
    pub code_challenge: String,
}

impl PkceSession {
    pub fn new(provider: &str) -> Self {
        let state = uuid::Uuid::new_v4().to_string();
        let code_verifier = uuid::Uuid::new_v4().to_string() + &uuid::Uuid::new_v4().to_string();
        let code_challenge = code_verifier.clone(); // Basic or S256 challenge representation

        Self {
            provider: provider.to_string(),
            state,
            code_verifier,
            code_challenge,
        }
    }
}

pub struct OAuthLoopback {
    addr: SocketAddr,
}

impl Default for OAuthLoopback {
    fn default() -> Self {
        Self {
            addr: "127.0.0.1:8989".parse().unwrap(),
        }
    }
}

impl OAuthLoopback {
    pub fn new(addr: SocketAddr) -> Self {
        Self { addr }
    }

    /// Attempts to bind to an available port in the given inclusive range (e.g. 8989..=8995)
    pub async fn bind_in_range(
        start_port: u16,
        end_port: u16,
    ) -> Result<(Self, TcpListener, u16), OAuthError> {
        for port in start_port..=end_port {
            let addr_str = format!("127.0.0.1:{}", port);
            if let Ok(addr) = addr_str.parse::<SocketAddr>() {
                if let Ok(listener) = TcpListener::bind(addr).await {
                    return Ok((Self { addr }, listener, port));
                }
            }
        }
        Err(OAuthError::BindError(std::io::Error::new(
            std::io::ErrorKind::AddrInUse,
            format!(
                "All ports in range {}-{} are occupied",
                start_port, end_port
            ),
        )))
    }

    /// Listens on an already bound TcpListener for a single authorization callback
    pub async fn listen_on_listener(
        listener: TcpListener,
        expected_state: &str,
        timeout_duration: std::time::Duration,
    ) -> Result<String, OAuthError> {
        let (tx, rx) = oneshot::channel();
        let state_to_match = expected_state.to_string();

        let server_task = tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut buffer = [0u8; 4096];
                let n = stream.read(&mut buffer).await.unwrap_or(0);
                let request_str = String::from_utf8_lossy(&buffer[..n]);

                // Parse query parameters from "GET /oauth/callback?code=...&state=... HTTP/1.1"
                if let Some(first_line) = request_str.lines().next() {
                    let parts: Vec<&str> = first_line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        let path = parts[1];
                        if let Some(pos) = path.find('?') {
                            let query = &path[pos + 1..];
                            let params: HashMap<String, String> = query
                                .split('&')
                                .filter_map(|pair| {
                                    let mut kv = pair.split('=');
                                    let k = kv.next()?;
                                    let v = kv.next()?;
                                    Some((k.to_string(), v.to_string()))
                                })
                                .collect();

                            if let (Some(code), Some(state)) =
                                (params.get("code"), params.get("state"))
                            {
                                if state == &state_to_match {
                                    let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><body style='font-family:system-ui;background:#0d1117;color:#c9d1d9;text-align:center;padding:40px;'><h2 style='color:#58a6ff;'>FrostfireOS Authorization Successful!</h2><p>You can close this tab and return to FrostfireOS.</p><script>window.close();</script></body></html>";
                                    let _ = stream.write_all(response.as_bytes()).await;
                                    let _ = tx.send(Ok(code.clone()));
                                    return;
                                } else {
                                    let _ = tx.send(Err(OAuthError::StateMismatch));
                                    return;
                                }
                            }
                        }
                    }
                }
                let response = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html\r\n\r\n<html><body><h2>Authorization Failed</h2></body></html>";
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = tx.send(Err(OAuthError::InvalidCallback(
                    "Missing code or state".into(),
                )));
            }
        });

        match tokio::time::timeout(timeout_duration, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(OAuthError::AuthFailed("Channel closed prematurely".into())),
            Err(_) => {
                server_task.abort();
                Err(OAuthError::Timeout)
            }
        }
    }

    /// Listens for a single HTTP GET callback on 127.0.0.1:8989/oauth/callback
    pub async fn listen_for_code(
        &self,
        expected_state: &str,
        timeout_duration: std::time::Duration,
    ) -> Result<String, OAuthError> {
        let listener = TcpListener::bind(self.addr).await?;
        Self::listen_on_listener(listener, expected_state, timeout_duration).await
    }
}

pub const DEFAULT_GOOGLE_CLIENT_ID: &str =
    "1057421839841-frostfireos-desktop-local.apps.googleusercontent.com";
pub const DEFAULT_OPENAI_CLIENT_ID: &str = "frostfireos-desktop-pkce";
pub const DEFAULT_ATLASSIAN_CLIENT_ID: &str = "frostfireos-desktop-atlassian";

pub fn build_auth_url(
    provider: &str,
    session: &PkceSession,
    port: u16,
    custom_client_id: Option<&str>,
) -> Result<String, OAuthError> {
    let redirect_uri = format!("http://127.0.0.1:{}/oauth/callback", port);
    match provider {
        "google" => {
            let client_id = custom_client_id.unwrap_or(DEFAULT_GOOGLE_CLIENT_ID);
            let scope = "openid%20email%20https://www.googleapis.com/auth/generative-language";
            Ok(format!(
                "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=plain&access_type=offline&prompt=consent",
                client_id, redirect_uri, scope, session.state, session.code_challenge
            ))
        }
        "google-workspace" => {
            let client_id = custom_client_id.unwrap_or(DEFAULT_GOOGLE_CLIENT_ID);
            let scope = "openid%20email%20https://www.googleapis.com/auth/gmail.modify%20https://www.googleapis.com/auth/drive%20https://www.googleapis.com/auth/calendar%20https://www.googleapis.com/auth/documents%20https://www.googleapis.com/auth/spreadsheets%20https://www.googleapis.com/auth/presentations";
            Ok(format!(
                "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=plain&access_type=offline&prompt=consent",
                client_id, redirect_uri, scope, session.state, session.code_challenge
            ))
        }
        "openai" => {
            let client_id = custom_client_id.unwrap_or(DEFAULT_OPENAI_CLIENT_ID);
            let scope = "model.read%20model.request";
            Ok(format!(
                "https://auth.openai.com/authorize?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=plain",
                client_id, redirect_uri, scope, session.state, session.code_challenge
            ))
        }
        "atlassian" => {
            let client_id = custom_client_id.unwrap_or(DEFAULT_ATLASSIAN_CLIENT_ID);
            let scope = "read:jira-work%20write:jira-work%20read:confluence-content.all%20write:confluence-content%20offline_access";
            Ok(format!(
                "https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id={}&scope={}&redirect_uri={}&state={}&response_type=code&prompt=consent",
                client_id, scope, redirect_uri, session.state
            ))
        }
        _ => Err(OAuthError::AuthFailed(format!(
            "OAuth not supported for {}",
            provider
        ))),
    }
}

pub async fn exchange_code_for_token(
    provider: &str,
    code: &str,
    session: &PkceSession,
    port: u16,
    custom_client_id: Option<&str>,
) -> Result<String, OAuthError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| OAuthError::AuthFailed(e.to_string()))?;

    let redirect_uri = format!("http://127.0.0.1:{}/oauth/callback", port);

    match provider {
        "google" | "google-workspace" => {
            let client_id = custom_client_id.unwrap_or(DEFAULT_GOOGLE_CLIENT_ID);
            let params = [
                ("client_id", client_id),
                ("code", code),
                ("code_verifier", &session.code_verifier),
                ("grant_type", "authorization_code"),
                ("redirect_uri", &redirect_uri),
            ];

            let resp = client
                .post("https://oauth2.googleapis.com/token")
                .form(&params)
                .send()
                .await
                .map_err(|e| OAuthError::AuthFailed(e.to_string()))?;

            if resp.status().is_success() {
                let data: serde_json::Value = resp
                    .json()
                    .await
                    .map_err(|e| OAuthError::AuthFailed(e.to_string()))?;
                let token = data["access_token"]
                    .as_str()
                    .ok_or_else(|| OAuthError::AuthFailed("No access_token in response".into()))?;
                Ok(token.to_string())
            } else {
                let body = resp.text().await.unwrap_or_default();
                Err(OAuthError::AuthFailed(format!(
                    "Google token exchange failed: {}",
                    body
                )))
            }
        }
        "openai" => {
            let client_id = custom_client_id.unwrap_or(DEFAULT_OPENAI_CLIENT_ID);
            let params = [
                ("client_id", client_id),
                ("code", code),
                ("code_verifier", &session.code_verifier),
                ("grant_type", "authorization_code"),
                ("redirect_uri", &redirect_uri),
            ];

            let resp = client
                .post("https://auth.openai.com/oauth/token")
                .form(&params)
                .send()
                .await
                .map_err(|e| OAuthError::AuthFailed(e.to_string()))?;

            if resp.status().is_success() {
                let data: serde_json::Value = resp
                    .json()
                    .await
                    .map_err(|e| OAuthError::AuthFailed(e.to_string()))?;
                let token = data["access_token"]
                    .as_str()
                    .ok_or_else(|| OAuthError::AuthFailed("No access_token in response".into()))?;
                Ok(token.to_string())
            } else {
                let body = resp.text().await.unwrap_or_default();
                Err(OAuthError::AuthFailed(format!(
                    "OpenAI token exchange failed: {}",
                    body
                )))
            }
        }
        "atlassian" => {
            let client_id = custom_client_id.unwrap_or(DEFAULT_ATLASSIAN_CLIENT_ID);
            let params = [
                ("grant_type", "authorization_code"),
                ("client_id", client_id),
                ("code", code),
                ("redirect_uri", &redirect_uri),
                ("code_verifier", &session.code_verifier),
            ];

            let resp = client
                .post("https://auth.atlassian.com/oauth/token")
                .form(&params)
                .send()
                .await
                .map_err(|e| OAuthError::AuthFailed(e.to_string()))?;

            if resp.status().is_success() {
                let data: serde_json::Value = resp
                    .json()
                    .await
                    .map_err(|e| OAuthError::AuthFailed(e.to_string()))?;
                let token = data["access_token"]
                    .as_str()
                    .ok_or_else(|| OAuthError::AuthFailed("No access_token in response".into()))?;
                Ok(token.to_string())
            } else {
                let body = resp.text().await.unwrap_or_default();
                Err(OAuthError::AuthFailed(format!(
                    "Atlassian token exchange failed: {}",
                    body
                )))
            }
        }
        _ => Err(OAuthError::AuthFailed(format!(
            "OAuth exchange not supported for {}",
            provider
        ))),
    }
}
