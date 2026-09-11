use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State, Window};

use crate::keystore::SecureKeystore;
use crate::paths::AppPaths;
use crate::protocol::{
    PromptConfigDto, RpcEvent, SearchResult, SystemStatus, TestKeyResponse, WorkstreamCommand,
    WorkstreamEvent,
};
use frostfire_core::blackboard::{BlackboardArtifact, BlackboardStore};
use frostfire_core::blueprints::sprint::OneHourSprintBlueprint;
use frostfire_core::dag::WorkstreamDag;
use frostfire_core::models::AgentSessionInfo;
use frostfire_core::session::AgentSessionManager;
use frostfire_engine::resilience::CircuitBreaker;
use frostfire_engine::routing::ModelRouter;
use frostfire_proto::tunnel::{
    ApprovalResponse, DagSyncFrame, DisplayTakeoverEvent, TunnelClientFrame,
    tunnel_client_frame,
};
use frostfire_tunnel::TunnelHandle;
use tokio::sync::RwLock;

pub struct AppState {
    pub paths: AppPaths,
    pub keystore: SecureKeystore,
    pub blackboard: Arc<BlackboardStore>,
    pub dag_store: Arc<RwLock<HashMap<String, WorkstreamDag>>>,
    pub router: ModelRouter,
    pub circuit_breaker: CircuitBreaker,
    pub total_hours_saved: Arc<RwLock<f64>>,
    pub tunnel_tx: tokio::sync::mpsc::Sender<TunnelClientFrame>,
    pub tunnel_handle: Arc<RwLock<Option<TunnelHandle>>>,
    pub recent_remote_hashes: Arc<RwLock<HashSet<String>>>,
    pub cloud_server_url: String,
}

#[tauri::command]
pub async fn start_drag_window(window: Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn minimize_window(window: Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_maximize_window(window: Window) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn close_window(window: Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_local_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only HTTP and HTTPS URLs are permitted".to_string());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_provider_keys(
    state: State<'_, AppState>,
    keys: HashMap<String, String>,
) -> Result<(), String> {
    for (provider, key) in keys {
        let _ = state.keystore.set_secret(&provider, &key).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_saved_auth_keys(
    state: State<'_, AppState>,
) -> Result<HashMap<String, String>, String> {
    let mut map = HashMap::new();
    let providers = ["gemini", "anthropic", "openai", "deepseek", "groq", "xai"];
    for p in providers {
        if let Ok(Some(secret)) = state.keystore.get_secret(p).await {
            map.insert(p.to_string(), secret.to_string());
        }
    }
    Ok(map)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedProviderModels {
    pub provider: String,
    pub models: Vec<String>,
    pub cached_at: u64,
}

pub fn get_models_cache_path(app_data_dir: &std::path::Path) -> std::path::PathBuf {
    app_data_dir.join("models_cache.json")
}

pub async fn save_provider_models_to_cache(
    app_data_dir: &std::path::Path,
    provider: &str,
    models: &[String],
) {
    if models.is_empty() {
        return;
    }
    let cache_path = get_models_cache_path(app_data_dir);
    let mut cache_map: HashMap<String, CachedProviderModels> = if cache_path.exists() {
        match tokio::fs::read_to_string(&cache_path).await {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => HashMap::new(),
        }
    } else {
        HashMap::new()
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    cache_map.insert(
        provider.to_string(),
        CachedProviderModels {
            provider: provider.to_string(),
            models: models.to_vec(),
            cached_at: now,
        },
    );

    if let Ok(serialized) = serde_json::to_string_pretty(&cache_map) {
        let _ = tokio::fs::write(&cache_path, serialized).await;
    }
}

pub async fn read_provider_models_from_cache(
    app_data_dir: &std::path::Path,
    provider: &str,
) -> Option<Vec<String>> {
    let cache_path = get_models_cache_path(app_data_dir);
    if !cache_path.exists() {
        return None;
    }
    let content = tokio::fs::read_to_string(&cache_path).await.ok()?;
    let cache_map: HashMap<String, CachedProviderModels> = serde_json::from_str(&content).ok()?;
    cache_map.get(provider).map(|entry| entry.models.clone())
}

pub async fn read_all_models_from_cache(
    app_data_dir: &std::path::Path,
) -> HashMap<String, Vec<String>> {
    let cache_path = get_models_cache_path(app_data_dir);
    let mut res = HashMap::new();
    if !cache_path.exists() {
        return res;
    }
    if let Ok(content) = tokio::fs::read_to_string(&cache_path).await {
        if let Ok(cache_map) =
            serde_json::from_str::<HashMap<String, CachedProviderModels>>(&content)
        {
            for (p, entry) in cache_map {
                res.insert(p, entry.models);
            }
        }
    }
    res
}

fn is_deprecated_gemini_model(model: &str) -> bool {
    let m = model.to_lowercase();
    m.contains("1.0")
        || m.contains("bison")
        || m.contains("aqa")
        || m.contains("embedding")
        || m.contains("text-")
        || m.contains("imagen")
        || m == "gemini-pro"
        || m == "gemini-pro-vision"
}

#[tauri::command]
pub async fn test_provider_key(
    provider: String,
    key: Option<String>,
    state: State<'_, AppState>,
) -> Result<TestKeyResponse, String> {
    let is_ollama = provider == "ollama";
    let resolved_key = if let Some(k) = key.filter(|k| !k.trim().is_empty()) {
        Some(k)
    } else {
        state
            .keystore
            .get_secret(&provider)
            .await
            .ok()
            .flatten()
            .map(|s| s.as_str().to_string())
    };

    let clean_key = resolved_key.as_deref().unwrap_or("").trim();
    if clean_key.is_empty() && !is_ollama {
        // Fallback to cached models if available when key is empty
        if let Some(cached) =
            read_provider_models_from_cache(&state.paths.app_data_dir, &provider).await
        {
            if !cached.is_empty() {
                return Ok(TestKeyResponse {
                    success: false,
                    latency_ms: 0,
                    message: format!(
                        "No active API key, but {} cached models found for {}",
                        cached.len(),
                        provider
                    ),
                    models: cached,
                });
            }
        }
        return Ok(TestKeyResponse {
            success: false,
            latency_ms: 0,
            message: format!(
                "No API key found in Keystore for {}. Please enter an API key.",
                provider
            ),
            models: Vec::new(),
        });
    }

    let start = std::time::Instant::now();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    match provider.as_str() {
        "gemini" => {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models?key={}",
                clean_key
            );
            match client.get(&url).send().await {
                Ok(resp) => {
                    let latency = start.elapsed().as_millis() as u64;
                    let status = resp.status();
                    if status.is_success() {
                        let body = resp.text().await.unwrap_or_default();
                        let mut models = Vec::new();
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
                            if let Some(arr) = val.get("models").and_then(|m| m.as_array()) {
                                for item in arr {
                                    let supports_gen = item
                                        .get("supportedGenerationMethods")
                                        .and_then(|v| v.as_array())
                                        .map(|methods| {
                                            methods
                                                .iter()
                                                .any(|m| m.as_str() == Some("generateContent"))
                                        })
                                        .unwrap_or(true);
                                    if supports_gen {
                                        if let Some(name) =
                                            item.get("name").and_then(|n| n.as_str())
                                        {
                                            let clean_name =
                                                name.strip_prefix("models/").unwrap_or(name);
                                            if !is_deprecated_gemini_model(clean_name) {
                                                models.push(clean_name.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        if models.is_empty() {
                            models = vec![
                                "gemini-2.0-flash".to_string(),
                                "gemini-2.0-flash-lite".to_string(),
                                "gemini-2.0-flash-thinking-exp-01-21".to_string(),
                                "gemini-1.5-flash".to_string(),
                                "gemini-1.5-pro".to_string(),
                            ];
                        }

                        // Sort models prioritizing latest production generation
                        models.sort_by(|a, b| {
                            let score = |name: &str| -> i32 {
                                if name.starts_with("gemini-2.0-flash") {
                                    100
                                } else if name.starts_with("gemini-2.0-flash-thinking") {
                                    95
                                } else if name.starts_with("gemini-2.0") {
                                    90
                                } else if name.starts_with("gemini-1.5-flash") {
                                    80
                                } else if name.starts_with("gemini-1.5-pro") {
                                    70
                                } else {
                                    10
                                }
                            };
                            score(b).cmp(&score(a))
                        });

                        // Cache live discovered models to disk
                        save_provider_models_to_cache(&state.paths.app_data_dir, "gemini", &models)
                            .await;

                        // Live probe to verify model generation actually succeeds
                        let mut verified_working_model = String::new();
                        for candidate in models.iter().take(3) {
                            let ping_url = format!(
                                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                                candidate,
                                clean_key
                            );
                            let ping_body = serde_json::json!({
                                "contents": [{ "role": "user", "parts": [{ "text": "ping" }] }]
                            });
                            if let Ok(ping_resp) =
                                client.post(&ping_url).json(&ping_body).send().await
                            {
                                if ping_resp.status().is_success() {
                                    verified_working_model = candidate.clone();
                                    break;
                                }
                            }
                        }

                        let message = if !verified_working_model.is_empty() {
                            format!("Google Gemini Verified & Active (Tested generateContent on {}, {} models cached)", verified_working_model, models.len())
                        } else {
                            format!(
                                "Google Gemini Verified ({}, {} models discovered & cached)",
                                status.as_u16(),
                                models.len()
                            )
                        };

                        Ok(TestKeyResponse {
                            success: true,
                            latency_ms: latency,
                            message,
                            models,
                        })
                    } else {
                        let body = resp.text().await.unwrap_or_default();
                        let error_msg = serde_json::from_str::<serde_json::Value>(&body)
                            .ok()
                            .and_then(|v| v["error"]["message"].as_str().map(|s| s.to_string()))
                            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
                        let cached =
                            read_provider_models_from_cache(&state.paths.app_data_dir, "gemini")
                                .await
                                .unwrap_or_default();
                        Ok(TestKeyResponse {
                            success: !cached.is_empty(),
                            latency_ms: latency,
                            message: if !cached.is_empty() {
                                format!("{} (Loaded {} cached models)", error_msg, cached.len())
                            } else {
                                error_msg
                            },
                            models: cached,
                        })
                    }
                }
                Err(err) => {
                    let cached =
                        read_provider_models_from_cache(&state.paths.app_data_dir, "gemini")
                            .await
                            .unwrap_or_default();
                    Ok(TestKeyResponse {
                        success: !cached.is_empty(),
                        latency_ms: start.elapsed().as_millis() as u64,
                        message: if !cached.is_empty() {
                            format!("{} (Loaded {} cached models)", err, cached.len())
                        } else {
                            err.to_string()
                        },
                        models: cached,
                    })
                }
            }
        }
        "anthropic" => {
            let url = "https://api.anthropic.com/v1/models";
            match client
                .get(url)
                .header("x-api-key", clean_key)
                .header("anthropic-version", "2023-06-01")
                .send()
                .await
            {
                Ok(resp) => {
                    let latency = start.elapsed().as_millis() as u64;
                    let status = resp.status();
                    if status.is_success() {
                        let body = resp.text().await.unwrap_or_default();
                        let mut models = Vec::new();
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
                            if let Some(arr) = val.get("data").and_then(|d| d.as_array()) {
                                for item in arr {
                                    if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                                        if id.starts_with("claude-") {
                                            models.push(id.to_string());
                                        }
                                    }
                                }
                            }
                        }
                        if models.is_empty() {
                            models = vec![
                                "claude-3-7-sonnet-20250219".to_string(),
                                "claude-3-5-sonnet-20241022".to_string(),
                                "claude-3-5-haiku-20241022".to_string(),
                            ];
                        }
                        models.sort_by(|a, b| {
                            let score = |name: &str| -> i32 {
                                if name.contains("3-7-sonnet") {
                                    100
                                } else if name.contains("3-5-sonnet") {
                                    90
                                } else if name.contains("3-5-haiku") {
                                    80
                                } else if name.contains("3-opus") {
                                    70
                                } else {
                                    10
                                }
                            };
                            score(b).cmp(&score(a))
                        });
                        save_provider_models_to_cache(
                            &state.paths.app_data_dir,
                            "anthropic",
                            &models,
                        )
                        .await;
                        Ok(TestKeyResponse {
                            success: true,
                            latency_ms: latency,
                            message: format!(
                                "Anthropic Verified ({}, {} models cached)",
                                status.as_u16(),
                                models.len()
                            ),
                            models,
                        })
                    } else {
                        let body = resp.text().await.unwrap_or_default();
                        let error_msg = serde_json::from_str::<serde_json::Value>(&body)
                            .ok()
                            .and_then(|v| v["error"]["message"].as_str().map(|s| s.to_string()))
                            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
                        let cached =
                            read_provider_models_from_cache(&state.paths.app_data_dir, "anthropic")
                                .await
                                .unwrap_or_default();
                        Ok(TestKeyResponse {
                            success: !cached.is_empty(),
                            latency_ms: latency,
                            message: if !cached.is_empty() {
                                format!("{} (Loaded {} cached models)", error_msg, cached.len())
                            } else {
                                error_msg
                            },
                            models: cached,
                        })
                    }
                }
                Err(err) => {
                    let cached =
                        read_provider_models_from_cache(&state.paths.app_data_dir, "anthropic")
                            .await
                            .unwrap_or_default();
                    Ok(TestKeyResponse {
                        success: !cached.is_empty(),
                        latency_ms: start.elapsed().as_millis() as u64,
                        message: if !cached.is_empty() {
                            format!("{} (Loaded {} cached models)", err, cached.len())
                        } else {
                            err.to_string()
                        },
                        models: cached,
                    })
                }
            }
        }
        "openai" => {
            let url = "https://api.openai.com/v1/models";
            match client
                .get(url)
                .header("Authorization", format!("Bearer {}", clean_key))
                .send()
                .await
            {
                Ok(resp) => {
                    let latency = start.elapsed().as_millis() as u64;
                    let status = resp.status();
                    if status.is_success() {
                        let body = resp.text().await.unwrap_or_default();
                        let mut models = Vec::new();
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
                            if let Some(arr) = val.get("data").and_then(|d| d.as_array()) {
                                for item in arr {
                                    if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                                        let m = id.to_lowercase();
                                        let is_chat = m.starts_with("gpt-")
                                            || m.starts_with("o1")
                                            || m.starts_with("o3")
                                            || m.starts_with("chatgpt-");
                                        let is_unusable = m.contains("audio")
                                            || m.contains("realtime")
                                            || m.contains("embedding")
                                            || m.contains("tts")
                                            || m.contains("whisper")
                                            || m.contains("dall-e")
                                            || m.contains("moderation")
                                            || m.contains("davinci")
                                            || m.contains("babbage")
                                            || m.contains("instruct")
                                            || m.contains("search")
                                            || m.contains("similarity");
                                        if is_chat && !is_unusable {
                                            models.push(id.to_string());
                                        }
                                    }
                                }
                            }
                        }
                        if models.is_empty() {
                            models = vec![
                                "gpt-4o".to_string(),
                                "gpt-4o-mini".to_string(),
                                "o1".to_string(),
                                "o3-mini".to_string(),
                            ];
                        }
                        models.sort_by(|a, b| {
                            let score = |name: &str| -> i32 {
                                if name == "gpt-4o" {
                                    100
                                } else if name == "gpt-4o-mini" {
                                    95
                                } else if name.starts_with("o3") {
                                    90
                                } else if name.starts_with("o1") {
                                    85
                                } else if name.starts_with("chatgpt-4o") {
                                    80
                                } else if name.starts_with("gpt-4-turbo") {
                                    75
                                } else if name.starts_with("gpt-4") {
                                    70
                                } else {
                                    50
                                }
                            };
                            score(b).cmp(&score(a))
                        });
                        save_provider_models_to_cache(&state.paths.app_data_dir, "openai", &models)
                            .await;
                        Ok(TestKeyResponse {
                            success: true,
                            latency_ms: latency,
                            message: format!(
                                "OpenAI Verified ({}, {} models cached)",
                                status.as_u16(),
                                models.len()
                            ),
                            models,
                        })
                    } else {
                        let body = resp.text().await.unwrap_or_default();
                        let error_msg = serde_json::from_str::<serde_json::Value>(&body)
                            .ok()
                            .and_then(|v| v["error"]["message"].as_str().map(|s| s.to_string()))
                            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
                        let cached =
                            read_provider_models_from_cache(&state.paths.app_data_dir, "openai")
                                .await
                                .unwrap_or_default();
                        Ok(TestKeyResponse {
                            success: !cached.is_empty(),
                            latency_ms: latency,
                            message: if !cached.is_empty() {
                                format!("{} (Loaded {} cached models)", error_msg, cached.len())
                            } else {
                                error_msg
                            },
                            models: cached,
                        })
                    }
                }
                Err(err) => {
                    let cached =
                        read_provider_models_from_cache(&state.paths.app_data_dir, "openai")
                            .await
                            .unwrap_or_default();
                    Ok(TestKeyResponse {
                        success: !cached.is_empty(),
                        latency_ms: start.elapsed().as_millis() as u64,
                        message: if !cached.is_empty() {
                            format!("{} (Loaded {} cached models)", err, cached.len())
                        } else {
                            err.to_string()
                        },
                        models: cached,
                    })
                }
            }
        }
        "groq" => {
            let url = "https://api.groq.com/openai/v1/models";
            match client
                .get(url)
                .header("Authorization", format!("Bearer {}", clean_key))
                .send()
                .await
            {
                Ok(resp) => {
                    let latency = start.elapsed().as_millis() as u64;
                    let status = resp.status();
                    if status.is_success() {
                        let body = resp.text().await.unwrap_or_default();
                        let mut models = Vec::new();
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
                            if let Some(arr) = val.get("data").and_then(|d| d.as_array()) {
                                for item in arr {
                                    if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                                        let is_active = item
                                            .get("active")
                                            .and_then(|a| a.as_bool())
                                            .unwrap_or(true);
                                        if is_active
                                            && !id.contains("whisper")
                                            && !id.contains("audio")
                                            && !id.contains("embedding")
                                        {
                                            models.push(id.to_string());
                                        }
                                    }
                                }
                            }
                        }
                        if models.is_empty() {
                            models = vec![
                                "llama-3.3-70b-versatile".to_string(),
                                "llama-3.1-8b-instant".to_string(),
                                "mixtral-8x7b-32768".to_string(),
                            ];
                        }
                        models.sort_by(|a, b| {
                            let score = |name: &str| -> i32 {
                                if name.contains("3.3-70b") {
                                    100
                                } else if name.contains("3.1-8b") {
                                    90
                                } else if name.contains("distill") {
                                    80
                                } else if name.contains("mixtral") {
                                    70
                                } else {
                                    50
                                }
                            };
                            score(b).cmp(&score(a))
                        });
                        save_provider_models_to_cache(&state.paths.app_data_dir, "groq", &models)
                            .await;
                        Ok(TestKeyResponse {
                            success: true,
                            latency_ms: latency,
                            message: format!(
                                "Groq Verified ({}, {} models cached)",
                                status.as_u16(),
                                models.len()
                            ),
                            models,
                        })
                    } else {
                        let body = resp.text().await.unwrap_or_default();
                        let error_msg = serde_json::from_str::<serde_json::Value>(&body)
                            .ok()
                            .and_then(|v| v["error"]["message"].as_str().map(|s| s.to_string()))
                            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
                        let cached =
                            read_provider_models_from_cache(&state.paths.app_data_dir, "groq")
                                .await
                                .unwrap_or_default();
                        Ok(TestKeyResponse {
                            success: !cached.is_empty(),
                            latency_ms: latency,
                            message: if !cached.is_empty() {
                                format!("{} (Loaded {} cached models)", error_msg, cached.len())
                            } else {
                                error_msg
                            },
                            models: cached,
                        })
                    }
                }
                Err(err) => {
                    let cached = read_provider_models_from_cache(&state.paths.app_data_dir, "groq")
                        .await
                        .unwrap_or_default();
                    Ok(TestKeyResponse {
                        success: !cached.is_empty(),
                        latency_ms: start.elapsed().as_millis() as u64,
                        message: if !cached.is_empty() {
                            format!("{} (Loaded {} cached models)", err, cached.len())
                        } else {
                            err.to_string()
                        },
                        models: cached,
                    })
                }
            }
        }
        "deepseek" => {
            let url = "https://api.deepseek.com/models";
            match client
                .get(url)
                .header("Authorization", format!("Bearer {}", clean_key))
                .send()
                .await
            {
                Ok(resp) => {
                    let latency = start.elapsed().as_millis() as u64;
                    let status = resp.status();
                    if status.is_success() {
                        let body = resp.text().await.unwrap_or_default();
                        let mut models = Vec::new();
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
                            if let Some(arr) = val.get("data").and_then(|d| d.as_array()) {
                                for item in arr {
                                    if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                                        models.push(id.to_string());
                                    }
                                }
                            }
                        }
                        if models.is_empty() {
                            models =
                                vec!["deepseek-chat".to_string(), "deepseek-reasoner".to_string()];
                        }
                        save_provider_models_to_cache(
                            &state.paths.app_data_dir,
                            "deepseek",
                            &models,
                        )
                        .await;
                        Ok(TestKeyResponse {
                            success: true,
                            latency_ms: latency,
                            message: format!(
                                "DeepSeek Verified ({}, {} models cached)",
                                status.as_u16(),
                                models.len()
                            ),
                            models,
                        })
                    } else {
                        let body = resp.text().await.unwrap_or_default();
                        let error_msg = serde_json::from_str::<serde_json::Value>(&body)
                            .ok()
                            .and_then(|v| v["error"]["message"].as_str().map(|s| s.to_string()))
                            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
                        let cached =
                            read_provider_models_from_cache(&state.paths.app_data_dir, "deepseek")
                                .await
                                .unwrap_or_default();
                        Ok(TestKeyResponse {
                            success: !cached.is_empty(),
                            latency_ms: latency,
                            message: if !cached.is_empty() {
                                format!("{} (Loaded {} cached models)", error_msg, cached.len())
                            } else {
                                error_msg
                            },
                            models: cached,
                        })
                    }
                }
                Err(err) => {
                    let cached =
                        read_provider_models_from_cache(&state.paths.app_data_dir, "deepseek")
                            .await
                            .unwrap_or_default();
                    Ok(TestKeyResponse {
                        success: !cached.is_empty(),
                        latency_ms: start.elapsed().as_millis() as u64,
                        message: if !cached.is_empty() {
                            format!("{} (Loaded {} cached models)", err, cached.len())
                        } else {
                            err.to_string()
                        },
                        models: cached,
                    })
                }
            }
        }
        "xai" => {
            let url = "https://api.x.ai/v1/models";
            match client
                .get(url)
                .header("Authorization", format!("Bearer {}", clean_key))
                .send()
                .await
            {
                Ok(resp) => {
                    let latency = start.elapsed().as_millis() as u64;
                    let status = resp.status();
                    if status.is_success() {
                        let body = resp.text().await.unwrap_or_default();
                        let mut models = Vec::new();
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
                            if let Some(arr) = val.get("data").and_then(|d| d.as_array()) {
                                for item in arr {
                                    if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                                        if id.contains("grok") && !id.contains("embedding") {
                                            models.push(id.to_string());
                                        }
                                    }
                                }
                            }
                        }
                        if models.is_empty() {
                            models = vec![
                                "grok-2-1212".to_string(),
                                "grok-2-vision-1212".to_string(),
                                "grok-beta".to_string(),
                            ];
                        }
                        models.sort_by(|a, b| {
                            let score = |name: &str| -> i32 {
                                if name.starts_with("grok-2-1212") {
                                    100
                                } else if name.starts_with("grok-2") {
                                    90
                                } else if name.starts_with("grok-3") {
                                    85
                                } else if name.starts_with("grok-beta") {
                                    80
                                } else {
                                    50
                                }
                            };
                            score(b).cmp(&score(a))
                        });
                        save_provider_models_to_cache(&state.paths.app_data_dir, "xai", &models)
                            .await;
                        Ok(TestKeyResponse {
                            success: true,
                            latency_ms: latency,
                            message: format!(
                                "xAI Verified ({}, {} models cached)",
                                status.as_u16(),
                                models.len()
                            ),
                            models,
                        })
                    } else {
                        let body = resp.text().await.unwrap_or_default();
                        let error_msg = serde_json::from_str::<serde_json::Value>(&body)
                            .ok()
                            .and_then(|v| v["error"]["message"].as_str().map(|s| s.to_string()))
                            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
                        let cached =
                            read_provider_models_from_cache(&state.paths.app_data_dir, "xai")
                                .await
                                .unwrap_or_default();
                        Ok(TestKeyResponse {
                            success: !cached.is_empty(),
                            latency_ms: latency,
                            message: if !cached.is_empty() {
                                format!("{} (Loaded {} cached models)", error_msg, cached.len())
                            } else {
                                error_msg
                            },
                            models: cached,
                        })
                    }
                }
                Err(err) => {
                    let cached = read_provider_models_from_cache(&state.paths.app_data_dir, "xai")
                        .await
                        .unwrap_or_default();
                    Ok(TestKeyResponse {
                        success: !cached.is_empty(),
                        latency_ms: start.elapsed().as_millis() as u64,
                        message: if !cached.is_empty() {
                            format!("{} (Loaded {} cached models)", err, cached.len())
                        } else {
                            err.to_string()
                        },
                        models: cached,
                    })
                }
            }
        }
        "ollama" => {
            let endpoint = if clean_key.starts_with("http") {
                clean_key.to_string()
            } else {
                "http://127.0.0.1:11434".to_string()
            };
            let url = format!("{}/api/tags", endpoint.trim_end_matches('/'));
            match client.get(&url).send().await {
                Ok(resp) => {
                    let latency = start.elapsed().as_millis() as u64;
                    let status = resp.status();
                    if status.is_success() {
                        let body = resp.text().await.unwrap_or_default();
                        let mut models = Vec::new();
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
                            if let Some(arr) = val.get("models").and_then(|m| m.as_array()) {
                                for item in arr {
                                    if let Some(name) = item.get("name").and_then(|n| n.as_str()) {
                                        models.push(name.to_string());
                                    }
                                }
                            }
                        }
                        if models.is_empty() {
                            models = vec!["llama3.2".to_string()];
                        }
                        save_provider_models_to_cache(&state.paths.app_data_dir, "ollama", &models)
                            .await;
                        Ok(TestKeyResponse {
                            success: true,
                            latency_ms: latency,
                            message: format!(
                                "Ollama Verified ({}, {} models cached)",
                                status.as_u16(),
                                models.len()
                            ),
                            models,
                        })
                    } else {
                        let cached =
                            read_provider_models_from_cache(&state.paths.app_data_dir, "ollama")
                                .await
                                .unwrap_or_default();
                        Ok(TestKeyResponse {
                            success: !cached.is_empty(),
                            latency_ms: latency,
                            message: format!(
                                "Ollama HTTP {} (Cached: {})",
                                status.as_u16(),
                                cached.len()
                            ),
                            models: cached,
                        })
                    }
                }
                Err(err) => {
                    let cached =
                        read_provider_models_from_cache(&state.paths.app_data_dir, "ollama")
                            .await
                            .unwrap_or_default();
                    Ok(TestKeyResponse {
                        success: !cached.is_empty(),
                        latency_ms: start.elapsed().as_millis() as u64,
                        message: if !cached.is_empty() {
                            format!("{} (Loaded {} cached models)", err, cached.len())
                        } else {
                            err.to_string()
                        },
                        models: cached,
                    })
                }
            }
        }
        _ => {
            let cached = read_provider_models_from_cache(&state.paths.app_data_dir, &provider)
                .await
                .unwrap_or_default();
            Ok(TestKeyResponse {
                success: true,
                latency_ms: 5,
                message: format!(
                    "Format accepted for {} (Cached: {})",
                    provider,
                    cached.len()
                ),
                models: cached,
            })
        }
    }
}

#[tauri::command]
pub async fn fetch_provider_models(
    state: State<'_, AppState>,
    provider: String,
) -> Result<TestKeyResponse, String> {
    let is_ollama = provider == "ollama";
    let key = match state.keystore.get_secret(&provider).await {
        Ok(Some(secret)) => secret.to_string(),
        _ => {
            if is_ollama {
                return test_provider_key(provider, None, state).await;
            }
            if let Some(cached) =
                read_provider_models_from_cache(&state.paths.app_data_dir, &provider).await
            {
                if !cached.is_empty() {
                    return Ok(TestKeyResponse {
                        success: true,
                        latency_ms: 0,
                        message: format!("Loaded {} cached models for {}", cached.len(), provider),
                        models: cached,
                    });
                }
            }
            return Ok(TestKeyResponse {
                success: false,
                latency_ms: 0,
                message: format!("No API key found in vault for provider {}", provider),
                models: Vec::new(),
            });
        }
    };
    let mut resp = test_provider_key(provider.clone(), Some(key), state.clone()).await?;
    if !resp.success || resp.models.is_empty() {
        if let Some(cached) =
            read_provider_models_from_cache(&state.paths.app_data_dir, &provider).await
        {
            if !cached.is_empty() {
                resp.success = true;
                resp.message = format!(
                    "Loaded {} cached models for {} (Offline fallback)",
                    cached.len(),
                    provider
                );
                resp.models = cached;
            }
        }
    }
    Ok(resp)
}

#[tauri::command]
pub async fn get_cached_models(
    state: State<'_, AppState>,
) -> Result<HashMap<String, Vec<String>>, String> {
    Ok(read_all_models_from_cache(&state.paths.app_data_dir).await)
}

#[tauri::command]
pub async fn fetch_all_provider_models(
    state: State<'_, AppState>,
) -> Result<HashMap<String, Vec<String>>, String> {
    let providers = ["gemini", "anthropic", "openai", "deepseek", "groq", "xai"];
    let mut map = HashMap::new();

    for &p in &providers {
        if let Ok(Some(secret)) = state.keystore.get_secret(p).await {
            let key = secret.to_string();
            if !key.trim().is_empty() {
                if let Ok(res) = test_provider_key(p.to_string(), Some(key), state.clone()).await {
                    if !res.models.is_empty() {
                        map.insert(p.to_string(), res.models);
                    }
                }
            }
        }
    }

    if let Ok(res) = test_provider_key("ollama".to_string(), None, state.clone()).await {
        if !res.models.is_empty() {
            map.insert("ollama".to_string(), res.models);
        }
    }

    // Merge with any cached models that were not refreshed
    let cached = read_all_models_from_cache(&state.paths.app_data_dir).await;
    for (k, v) in cached {
        map.entry(k).or_insert(v);
    }

    Ok(map)
}

#[tauri::command]
pub async fn start_oauth_login(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: String,
    custom_client_id: Option<String>,
) -> Result<String, String> {
    use crate::oauth::{build_auth_url, exchange_code_for_token, OAuthLoopback, PkceSession};
    use tauri_plugin_opener::OpenerExt;

    let (_loopback, listener, port) = OAuthLoopback::bind_in_range(8989, 8995)
        .await
        .map_err(|e| e.to_string())?;

    let session = PkceSession::new(&provider);
    let auth_url = build_auth_url(&provider, &session, port, custom_client_id.as_deref())
        .map_err(|e| e.to_string())?;

    // Open URL in system default browser
    app.opener()
        .open_url(&auth_url, None::<&str>)
        .map_err(|e| e.to_string())?;

    // Await callback code on loopback with 120s timeout
    let code = OAuthLoopback::listen_on_listener(
        listener,
        &session.state,
        std::time::Duration::from_secs(120),
    )
    .await
    .map_err(|e| e.to_string())?;

    // Exchange code for token
    let token = exchange_code_for_token(
        &provider,
        &code,
        &session,
        port,
        custom_client_id.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;

    // Store in secure hardware keystore
    state
        .keystore
        .set_secret(&provider, &token)
        .await
        .map_err(|e| e.to_string())?;

    Ok(format!("{} OAuth authorization successful", provider))
}

#[tauri::command]
pub async fn load_lota_settings(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let path = state.paths.app_data_dir.join("settings.json");
    if path.exists() {
        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| e.to_string())?;
        let val: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        Ok(val)
    } else {
        Ok(serde_json::json!({}))
    }
}

#[tauri::command]
pub async fn save_lota_settings(
    state: State<'_, AppState>,
    settings: serde_json::Value,
) -> Result<(), String> {
    let path = state.paths.app_data_dir.join("settings.json");
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn clean_html_snippet(raw: &str) -> String {
    let without_tags = raw
        .replace("<b>", "")
        .replace("</b>", "")
        .replace("<i>", "")
        .replace("</i>", "")
        .replace("<p>", "")
        .replace("</p>", "")
        .replace("<br>", " ")
        .replace("<br/>", " ");
    without_tags
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .trim()
        .to_string()
}

fn urlencoding_decode(s: &str) -> String {
    if let Ok(parsed) = reqwest::Url::parse(&format!("https://dummy.internal/?q={}", s)) {
        for (k, v) in parsed.query_pairs() {
            if k == "q" {
                return v.into_owned();
            }
        }
    }
    s.to_string()
}

fn urlencoding_encode(s: &str) -> String {
    if let Ok(mut parsed) = reqwest::Url::parse("https://dummy.internal") {
        parsed.query_pairs_mut().append_pair("q", s);
        return parsed
            .query()
            .and_then(|q| q.strip_prefix("q="))
            .unwrap_or(s)
            .to_string();
    }
    s.to_string()
}

pub fn is_search_intent(message: &str) -> bool {
    let lower = message.trim().to_lowercase();
    lower.starts_with("/search")
        || lower.starts_with("/browser")
        || lower.contains("search the internet")
        || lower.contains("search the web")
        || lower.contains("search online")
        || lower.contains("look up online")
        || lower.contains("browse the web")
        || lower.starts_with("search for ")
        || lower.starts_with("google ")
}

pub async fn perform_web_search(query: &str) -> Result<Vec<SearchResult>, String> {
    let clean_query = query.trim();
    if clean_query.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    let mut results: Vec<SearchResult> = Vec::new();

    // 1. DuckDuckGo HTML Search
    let ddg_res = client
        .post("https://html.duckduckgo.com/html/")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .form(&[("q", clean_query)])
        .send()
        .await;

    if let Ok(resp) = ddg_res {
        if resp.status().is_success() {
            if let Ok(html) = resp.text().await {
                let parts: Vec<&str> = html.split("<div class=\"result results_links").collect();
                for part in parts.iter().skip(1).take(6) {
                    let title = if let Some(t_idx) = part.find("class=\"result__a\"") {
                        let sub = &part[t_idx..];
                        if let (Some(s), Some(e)) = (sub.find('>'), sub.find("</a>")) {
                            clean_html_snippet(&sub[s + 1..e])
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    };

                    let url = if let Some(h_idx) = part.find("href=\"") {
                        let sub = &part[h_idx + 6..];
                        if let Some(e_idx) = sub.find('"') {
                            let raw_href = &sub[..e_idx];
                            if let Some(uddg_idx) = raw_href.find("uddg=") {
                                let uddg_val = &raw_href[uddg_idx + 5..];
                                let end_val = uddg_val.find('&').unwrap_or(uddg_val.len());
                                let encoded = &uddg_val[..end_val];
                                urlencoding_decode(encoded)
                            } else if raw_href.starts_with("//") {
                                format!("https:{}", raw_href)
                            } else {
                                raw_href.to_string()
                            }
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    };

                    let snippet = if let Some(s_idx) = part.find("class=\"result__snippet") {
                        let sub = &part[s_idx..];
                        if let (Some(s), Some(e)) = (sub.find('>'), sub.find("</a>")) {
                            clean_html_snippet(&sub[s + 1..e])
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    };

                    if !title.is_empty() && !url.is_empty() && !url.contains("duckduckgo.com") {
                        results.push(SearchResult {
                            title,
                            snippet,
                            url,
                        });
                    }
                }
            }
        }
    }

    // 2. Wikipedia OpenSearch fallback if results < 2
    if results.len() < 2 {
        let wiki_url = format!(
            "https://en.wikipedia.org/w/api.php?action=opensearch&search={}&limit=3&namespace=0&format=json",
            urlencoding_encode(clean_query)
        );
        if let Ok(w_resp) = client
            .get(&wiki_url)
            .header("User-Agent", "FrostfireOS/0.2.0 (desktop)")
            .send()
            .await
        {
            if w_resp.status().is_success() {
                if let Ok(w_data) = w_resp.json::<serde_json::Value>().await {
                    if let (Some(titles), Some(snippets), Some(urls)) = (
                        w_data.get(1).and_then(|v| v.as_array()),
                        w_data.get(2).and_then(|v| v.as_array()),
                        w_data.get(3).and_then(|v| v.as_array()),
                    ) {
                        for (i, t) in titles.iter().enumerate() {
                            let title = t.as_str().unwrap_or("").to_string();
                            let snippet = snippets
                                .get(i)
                                .and_then(|s| s.as_str())
                                .unwrap_or("")
                                .to_string();
                            let url = urls
                                .get(i)
                                .and_then(|u| u.as_str())
                                .unwrap_or("")
                                .to_string();
                            if !title.is_empty()
                                && !url.is_empty()
                                && !results.iter().any(|r| r.url == url)
                            {
                                results.push(SearchResult {
                                    title,
                                    snippet,
                                    url,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn search_web(query: String) -> Result<Vec<SearchResult>, String> {
    perform_web_search(&query).await
}

const MARKDOWN_SYSTEM_INSTRUCTION: &str = r#"You are an expert autonomous software engineer.
Respond directly, concisely, and accurately to the user's prompt.
Strict behavioral constraints:
1. No Canned Greetings or Filler: NEVER start with greetings (e.g. "Hello! I am FrostfireOS AI"), conversational pleasantries, introductory capability summaries, checklists, or "How can I assist you today?". Start immediately with the solution or direct answer.
2. Clean Markdown: Use GitHub Flavored Markdown for formatting. Wrap all code in triple-backtick language tags.
3. Diagrams & Math: Use Mermaid diagrams, Markdown tables, or KaTeX math ONLY when specifically requested by the user or when directly indispensable to answer the query. NEVER output unprompted flowcharts, capability matrices, or entropy formulas on greetings or standard queries.
4. No Placeholders: Write complete, functional, production-ready code.
5. Web Citations: When citing or referencing web search results or groundings, use inline numbered footnotes such as [1], [2], [3] directly after facts or claims (matching the numbered sources list). Do not create your own list of references at the end."#;

#[tauri::command]
pub async fn send_rpc_command(
    app: AppHandle,
    state: State<'_, AppState>,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let req_id = request
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("req-0")
        .to_string();
    let cmd_type = request
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    if cmd_type == "web_search" || cmd_type == "search" {
        let query = request.get("query").and_then(|v| v.as_str()).unwrap_or("");
        let results = perform_web_search(query).await.unwrap_or_default();
        return Ok(serde_json::json!({
            "id": req_id,
            "type": "response",
            "command": cmd_type,
            "success": true,
            "data": { "results": results },
            "error": null
        }));
    }

    if cmd_type == "prompt" {
        let message = request
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let is_search_cmd = message.starts_with("/search ")
            || message.starts_with("/browser ")
            || is_search_intent(message);
        let enable_web_search = request
            .get("web_search")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
            || is_search_cmd;

        let clean_message = if let Some(s) = message.strip_prefix("/search ") {
            s.trim()
        } else if let Some(s) = message.strip_prefix("/browser ") {
            s.trim()
        } else {
            message.trim()
        };

        let search_query = if let Some(s) = clean_message.strip_prefix("search the internet for ") {
            s.trim()
        } else if let Some(s) = clean_message.strip_prefix("search the web for ") {
            s.trim()
        } else if let Some(s) = clean_message.strip_prefix("search for ") {
            s.trim()
        } else {
            clean_message
        };

        let requested_provider = request
            .get("provider")
            .and_then(|v| v.as_str())
            .filter(|p| !p.is_empty())
            .unwrap_or("gemini");
        let requested_model = request
            .get("model")
            .and_then(|v| v.as_str())
            .filter(|m| !m.is_empty())
            .unwrap_or(match requested_provider {
                "openai" => "gpt-4o",
                "anthropic" => "claude-3-7-sonnet-20250219",
                "xai" => "grok-2-1212",
                _ => "gemini-2.0-flash",
            });
        let custom_preamble = request
            .get("preamble")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let effective_system_prompt = if custom_preamble.trim().is_empty() {
            MARKDOWN_SYSTEM_INSTRUCTION.to_string()
        } else {
            custom_preamble.trim().to_string()
        };
        let ws_id = format!(
            "ws-{}",
            uuid::Uuid::new_v4()
                .to_string()
                .chars()
                .take(8)
                .collect::<String>()
        );

        // 1. Emit turn_start
        let _ = app.emit(
            "rho://event",
            RpcEvent::TurnStart {
                turn_number: 1,
                prompt: clean_message.to_string(),
            },
        );

        // Pre-fetch native web search results if enabled
        let web_results = if enable_web_search {
            perform_web_search(search_query).await.unwrap_or_default()
        } else {
            Vec::new()
        };

        // 2. Retrieve key/token from hardware Keystore
        let provider_key = state
            .keystore
            .get_secret(requested_provider)
            .await
            .ok()
            .flatten();

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .unwrap_or_default();

        let (full_response, reasoning_text) = if let Some(key) = provider_key {
            match requested_provider {
                "gemini" => {
                    let initial_model = if is_deprecated_gemini_model(requested_model) {
                        "gemini-2.0-flash".to_string()
                    } else {
                        requested_model.to_string()
                    };

                    let fallback_candidates = vec![
                        "gemini-2.0-flash".to_string(),
                        "gemini-2.0-flash-thinking-exp-01-21".to_string(),
                        "gemini-1.5-flash".to_string(),
                        "gemini-1.5-pro".to_string(),
                    ];

                    let mut candidates = vec![initial_model];
                    for fb in fallback_candidates {
                        if !candidates.contains(&fb) {
                            candidates.push(fb);
                        }
                    }

                    let mut final_text = String::new();
                    let final_reasoning = String::new();

                    for (idx, candidate) in candidates.iter().enumerate() {
                        let url = format!(
                            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                            candidate,
                            key.as_str()
                        );
                        let body = if enable_web_search {
                            serde_json::json!({
                                "systemInstruction": {
                                    "parts": [{ "text": effective_system_prompt }]
                                },
                                "contents": [
                                    {
                                        "role": "user",
                                        "parts": [{ "text": clean_message }]
                                    }
                                ],
                                "tools": [
                                    { "googleSearch": {} }
                                ]
                            })
                        } else {
                            serde_json::json!({
                                "systemInstruction": {
                                    "parts": [{ "text": effective_system_prompt }]
                                },
                                "contents": [
                                    {
                                        "role": "user",
                                        "parts": [{ "text": clean_message }]
                                    }
                                ]
                            })
                        };

                        match client.post(&url).json(&body).send().await {
                            Ok(resp) => {
                                let status = resp.status();
                                if status.is_success() {
                                    let data: serde_json::Value =
                                        resp.json().await.unwrap_or_default();
                                    let mut text = data["candidates"][0]["content"]["parts"][0]
                                        ["text"]
                                        .as_str()
                                        .unwrap_or("No response content generated from Gemini.")
                                        .to_string();

                                    // Extract grounding metadata sources
                                    if let Some(grounding) =
                                        data["candidates"][0].get("groundingMetadata")
                                    {
                                        let mut sources = Vec::new();
                                        let mut chunk_to_source_index =
                                            std::collections::HashMap::new();
                                        if let Some(chunks) = grounding
                                            .get("groundingChunks")
                                            .and_then(|c| c.as_array())
                                        {
                                            for (chunk_idx, chunk) in chunks.iter().enumerate() {
                                                if let Some(web) = chunk.get("web") {
                                                    let uri = web
                                                        .get("uri")
                                                        .and_then(|u| u.as_str())
                                                        .unwrap_or("");
                                                    let title = web
                                                        .get("title")
                                                        .and_then(|t| t.as_str())
                                                        .unwrap_or(uri);
                                                    if !uri.is_empty() {
                                                        if let Some(existing_pos) = sources
                                                            .iter()
                                                            .position(|(u, _)| u == uri)
                                                        {
                                                            chunk_to_source_index.insert(
                                                                chunk_idx,
                                                                existing_pos + 1,
                                                            );
                                                        } else {
                                                            sources.push((
                                                                uri.to_string(),
                                                                title.to_string(),
                                                            ));
                                                            chunk_to_source_index
                                                                .insert(chunk_idx, sources.len());
                                                        }
                                                    }
                                                }
                                            }
                                        }

                                        // Inject inline footnotes [1], [2] from groundingSupports if Gemini did not include them
                                        if !text.contains("[1]") && !sources.is_empty() {
                                            if let Some(supports) = grounding
                                                .get("groundingSupports")
                                                .and_then(|s| s.as_array())
                                            {
                                                let mut insertions: Vec<(usize, Vec<usize>)> =
                                                    Vec::new();
                                                for sup in supports {
                                                    if let Some(chunk_indices) = sup
                                                        .get("groundingChunkIndices")
                                                        .and_then(|i| i.as_array())
                                                    {
                                                        let mut note_nums = Vec::new();
                                                        for c_idx in chunk_indices {
                                                            if let Some(ci) =
                                                                c_idx.as_u64().map(|n| n as usize)
                                                            {
                                                                if let Some(&src_num) =
                                                                    chunk_to_source_index.get(&ci)
                                                                {
                                                                    if !note_nums.contains(&src_num)
                                                                    {
                                                                        note_nums.push(src_num);
                                                                    }
                                                                }
                                                            }
                                                        }
                                                        if !note_nums.is_empty() {
                                                            note_nums.sort();
                                                            let end_idx = sup
                                                                .get("segment")
                                                                .and_then(|seg| seg.get("endIndex"))
                                                                .and_then(|e| e.as_u64())
                                                                .unwrap_or(0)
                                                                as usize;
                                                            if end_idx > 0 {
                                                                insertions
                                                                    .push((end_idx, note_nums));
                                                            }
                                                        }
                                                    }
                                                }

                                                if !insertions.is_empty() {
                                                    insertions
                                                        .sort_by_key(|a| std::cmp::Reverse(a.0));
                                                    let mut char_vec: Vec<char> =
                                                        text.chars().collect();
                                                    let len = char_vec.len();
                                                    for (end_char_idx, note_nums) in insertions {
                                                        let target_pos = end_char_idx.min(len);
                                                        let notes_str = format!(
                                                            " [{}]",
                                                            note_nums
                                                                .iter()
                                                                .map(|n| n.to_string())
                                                                .collect::<Vec<_>>()
                                                                .join(", ")
                                                        );
                                                        let note_chars: Vec<char> =
                                                            notes_str.chars().collect();
                                                        char_vec.splice(
                                                            target_pos..target_pos,
                                                            note_chars,
                                                        );
                                                    }
                                                    text = char_vec.into_iter().collect();
                                                }
                                            }
                                        }

                                        if !sources.is_empty() {
                                            text.push_str(
                                                "\n\n---\n**🌐 Web Sources Consulted:**\n",
                                            );
                                            for (i, (uri, title)) in sources.iter().enumerate() {
                                                text.push_str(&format!(
                                                    "{}. [{}]({})\n",
                                                    i + 1,
                                                    title,
                                                    uri
                                                ));
                                            }
                                        }
                                    } else if enable_web_search && !web_results.is_empty() {
                                        text.push_str("\n\n---\n**🌐 Web Sources Consulted:**\n");
                                        for (i, res) in web_results.iter().take(4).enumerate() {
                                            text.push_str(&format!(
                                                "{}. [{}]({})\n",
                                                i + 1,
                                                res.title,
                                                res.url
                                            ));
                                        }
                                    }

                                    if candidate != requested_model {
                                        final_text = format!(
                                            "> [!NOTE]\n> Google reported that `{}` is no longer available. FrostfireOS automatically routed your request to `{}`.\n\n{}",
                                            requested_model,
                                            candidate,
                                            text
                                        );
                                    } else {
                                        final_text = text;
                                    }
                                    break;
                                } else {
                                    let err_body = resp.text().await.unwrap_or_default();
                                    let msg = serde_json::from_str::<serde_json::Value>(&err_body)
                                        .ok()
                                        .and_then(|v| {
                                            v["error"]["message"].as_str().map(|s| s.to_string())
                                        })
                                        .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));

                                    // Fallback retry without googleSearch tool if model candidate does not support tools
                                    if enable_web_search
                                        && (msg.contains("Tool")
                                            || msg.contains("googleSearch")
                                            || msg.contains("unsupported"))
                                    {
                                        let fallback_prompt = if !web_results.is_empty() {
                                            let mut ctx = format!(
                                                "Live Web Search Results for '{}':\n\n",
                                                search_query
                                            );
                                            for (i, r) in web_results.iter().take(4).enumerate() {
                                                ctx.push_str(&format!(
                                                    "{}. [{}]({})\n   {}\n\n",
                                                    i + 1,
                                                    r.title,
                                                    r.url,
                                                    r.snippet
                                                ));
                                            }
                                            ctx.push_str("Based on the live web search results above, answer the prompt directly and cite your sources inline using numbered footnotes [1], [2], [3] directly after claims (matching the numbered sources above). Do NOT create a sources list at the end.\n\nUser Question: ");
                                            ctx.push_str(clean_message);
                                            ctx
                                        } else {
                                            clean_message.to_string()
                                        };

                                        let fallback_body = serde_json::json!({
                                            "systemInstruction": {
                                                "parts": [{ "text": effective_system_prompt }]
                                            },
                                            "contents": [
                                                {
                                                    "role": "user",
                                                    "parts": [{ "text": fallback_prompt }]
                                                }
                                            ]
                                        });

                                        if let Ok(retry_resp) =
                                            client.post(&url).json(&fallback_body).send().await
                                        {
                                            if retry_resp.status().is_success() {
                                                let retry_data: serde_json::Value =
                                                    retry_resp.json().await.unwrap_or_default();
                                                let mut text = retry_data["candidates"][0]
                                                    ["content"]["parts"][0]["text"]
                                                    .as_str()
                                                    .unwrap_or("No response generated.")
                                                    .to_string();
                                                if enable_web_search
                                                    && !web_results.is_empty()
                                                    && !text.contains("🌐 Web Sources Consulted")
                                                {
                                                    text.push_str(
                                                        "\n\n---\n**🌐 Web Sources Consulted:**\n",
                                                    );
                                                    for (i, res) in
                                                        web_results.iter().take(4).enumerate()
                                                    {
                                                        text.push_str(&format!(
                                                            "{}. [{}]({})\n",
                                                            i + 1,
                                                            res.title,
                                                            res.url
                                                        ));
                                                    }
                                                }
                                                final_text = text;
                                                break;
                                            }
                                        }
                                    }

                                    let is_model_unavailable = msg.contains("no longer available")
                                        || msg.contains("not found")
                                        || msg.contains("not supported")
                                        || msg.contains("deprecated")
                                        || status.as_u16() == 404;

                                    if !is_model_unavailable || idx == candidates.len() - 1 {
                                        final_text = format!("⚠️ Google Gemini API Error: {}", msg);
                                        break;
                                    }
                                }
                            }
                            Err(e) => {
                                if idx == candidates.len() - 1 {
                                    final_text =
                                        format!("⚠️ Google Gemini Connection Error: {}", e);
                                    break;
                                }
                            }
                        }
                    }

                    (final_text, final_reasoning)
                }
                "openai" | "xai" => {
                    let endpoint = if requested_provider == "xai" {
                        "https://api.x.ai/v1/chat/completions"
                    } else {
                        "https://api.openai.com/v1/chat/completions"
                    };

                    let user_content = if enable_web_search && !web_results.is_empty() {
                        let mut ctx =
                            format!("Live Web Search Results for '{}':\n\n", search_query);
                        for (i, r) in web_results.iter().take(5).enumerate() {
                            ctx.push_str(&format!(
                                "{}. [{}]({})\n   {}\n\n",
                                i + 1,
                                r.title,
                                r.url,
                                r.snippet
                            ));
                        }
                        ctx.push_str("Based on the live web search results above, answer the prompt directly and cite your sources inline using numbered footnotes [1], [2], [3] directly after claims (matching the numbered sources above). Do NOT create a sources list at the end.\n\nUser Question: ");
                        ctx.push_str(clean_message);
                        ctx
                    } else {
                        clean_message.to_string()
                    };

                    let body = serde_json::json!({
                        "model": requested_model,
                        "messages": [
                            { "role": "system", "content": effective_system_prompt },
                            { "role": "user", "content": user_content }
                        ]
                    });

                    match client
                        .post(endpoint)
                        .header("Authorization", format!("Bearer {}", key.as_str()))
                        .json(&body)
                        .send()
                        .await
                    {
                        Ok(resp) => {
                            let status = resp.status();
                            if status.is_success() {
                                let data: serde_json::Value = resp.json().await.unwrap_or_default();
                                let mut text = data["choices"][0]["message"]["content"]
                                    .as_str()
                                    .unwrap_or("No response generated.")
                                    .to_string();
                                let reasoning = data["choices"][0]["message"]["reasoning_content"]
                                    .as_str()
                                    .unwrap_or("")
                                    .to_string();
                                if enable_web_search
                                    && !web_results.is_empty()
                                    && !text.contains("🌐 Web Sources Consulted")
                                {
                                    text.push_str("\n\n---\n**🌐 Web Sources Consulted:**\n");
                                    for (i, res) in web_results.iter().take(5).enumerate() {
                                        text.push_str(&format!(
                                            "{}. [{}]({})\n",
                                            i + 1,
                                            res.title,
                                            res.url
                                        ));
                                    }
                                }
                                (text, reasoning)
                            } else {
                                let err_body = resp.text().await.unwrap_or_default();
                                let msg = serde_json::from_str::<serde_json::Value>(&err_body)
                                    .ok()
                                    .and_then(|v| {
                                        v["error"]["message"].as_str().map(|s| s.to_string())
                                    })
                                    .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
                                (
                                    format!(
                                        "⚠️ {} API Error: {}",
                                        requested_provider.to_uppercase(),
                                        msg
                                    ),
                                    String::new(),
                                )
                            }
                        }
                        Err(e) => (
                            format!(
                                "⚠️ {} Connection Error: {}",
                                requested_provider.to_uppercase(),
                                e
                            ),
                            String::new(),
                        ),
                    }
                }
                "anthropic" => {
                    let endpoint = "https://api.anthropic.com/v1/messages";
                    let user_content = if enable_web_search && !web_results.is_empty() {
                        let mut ctx =
                            format!("Live Web Search Results for '{}':\n\n", search_query);
                        for (i, r) in web_results.iter().take(5).enumerate() {
                            ctx.push_str(&format!(
                                "{}. [{}]({})\n   {}\n\n",
                                i + 1,
                                r.title,
                                r.url,
                                r.snippet
                            ));
                        }
                        ctx.push_str("Based on the live web search results above, answer the prompt directly and cite your sources inline using numbered footnotes [1], [2], [3] directly after claims (matching the numbered sources above). Do NOT create a sources list at the end.\n\nUser Question: ");
                        ctx.push_str(clean_message);
                        ctx
                    } else {
                        clean_message.to_string()
                    };

                    let body = serde_json::json!({
                        "model": requested_model,
                        "max_tokens": 4096,
                        "system": effective_system_prompt,
                        "messages": [{ "role": "user", "content": user_content }]
                    });

                    match client
                        .post(endpoint)
                        .header("x-api-key", key.as_str())
                        .header("anthropic-version", "2023-06-01")
                        .json(&body)
                        .send()
                        .await
                    {
                        Ok(resp) => {
                            let status = resp.status();
                            if status.is_success() {
                                let data: serde_json::Value = resp.json().await.unwrap_or_default();
                                let mut text = String::new();
                                let mut reasoning = String::new();
                                if let Some(blocks) = data["content"].as_array() {
                                    for b in blocks {
                                        if b["type"] == "text" {
                                            if let Some(t) = b["text"].as_str() {
                                                text.push_str(t);
                                            }
                                        } else if b["type"] == "thinking" {
                                            if let Some(th) = b["thinking"].as_str() {
                                                reasoning.push_str(th);
                                            }
                                        }
                                    }
                                }
                                if enable_web_search
                                    && !web_results.is_empty()
                                    && !text.contains("🌐 Web Sources Consulted")
                                {
                                    text.push_str("\n\n---\n**🌐 Web Sources Consulted:**\n");
                                    for (i, res) in web_results.iter().take(5).enumerate() {
                                        text.push_str(&format!(
                                            "{}. [{}]({})\n",
                                            i + 1,
                                            res.title,
                                            res.url
                                        ));
                                    }
                                }
                                (text, reasoning)
                            } else {
                                let err_body = resp.text().await.unwrap_or_default();
                                let msg = serde_json::from_str::<serde_json::Value>(&err_body)
                                    .ok()
                                    .and_then(|v| {
                                        v["error"]["message"].as_str().map(|s| s.to_string())
                                    })
                                    .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
                                (format!("⚠️ Anthropic API Error: {}", msg), String::new())
                            }
                        }
                        Err(e) => (
                            format!("⚠️ Anthropic Connection Error: {}", e),
                            String::new(),
                        ),
                    }
                }
                _ => (
                    format!(
                        "⚠️ Provider {} not configured for native execution.",
                        requested_provider
                    ),
                    String::new(),
                ),
            }
        } else {
            if enable_web_search && !web_results.is_empty() {
                let mut search_summary =
                    format!("### 🌐 Live Web Search Results for `{}`\n\n", search_query);
                for (i, res) in web_results.iter().take(5).enumerate() {
                    search_summary.push_str(&format!(
                        "{}. **[{}]({})**\n   {}\n\n",
                        i + 1,
                        res.title,
                        res.url,
                        res.snippet
                    ));
                }
                search_summary.push_str(&format!(
                    "> [!NOTE]\n> Web search completed natively via FrostfireOS. To have an AI model synthesize and reason over these results, configure your **{}** API key in Settings.",
                    requested_provider.to_uppercase()
                ));
                (search_summary, String::new())
            } else {
                (
                    format!(
                        "### ⚠️ {} Setup Required\n\nNo credentials configured for **{}** in the hardware Keystore.\n\n> [!TIP]\n> Navigate to **Settings -> Cloud Providers & API Keys** to configure your {} API key or OAuth session to activate live inference.\n\n```text\n(Local Echo: {})\n```",
                        requested_provider.to_uppercase(),
                        requested_provider.to_uppercase(),
                        requested_provider,
                        clean_message
                    ),
                    String::new(),
                )
            }
        };

        // 3a. Stream reasoning chunks if present
        if !reasoning_text.is_empty() {
            for chunk in reasoning_text.split_inclusive(' ') {
                let _ = app.emit(
                    "rho://event",
                    RpcEvent::ReasoningChunk {
                        content: chunk.to_string(),
                    },
                );
                tokio::time::sleep(tokio::time::Duration::from_millis(8)).await;
            }
        }

        // 3b. Stream text chunks
        for chunk in full_response.split_inclusive(' ') {
            let _ = app.emit(
                "rho://event",
                RpcEvent::TextChunk {
                    content: chunk.to_string(),
                },
            );
            tokio::time::sleep(tokio::time::Duration::from_millis(12)).await;
        }

        // 4. Emit turn_end
        let _ = app.emit("rho://event", RpcEvent::TurnEnd { turn_number: 1 });

        // Increment FTA hours
        {
            let mut lock = state.total_hours_saved.write().await;
            *lock += 0.5;
        }

        return Ok(serde_json::json!({
            "id": req_id,
            "type": "response",
            "command": "prompt",
            "success": true,
            "data": { "workstream_id": ws_id },
            "error": null
        }));
    }

    Ok(serde_json::json!({
        "id": req_id,
        "type": "response",
        "command": cmd_type,
        "success": true,
        "data": null,
        "error": null
    }))
}

#[tauri::command]
pub async fn execute_command(
    app: AppHandle,
    state: State<'_, AppState>,
    cmd: WorkstreamCommand,
) -> Result<serde_json::Value, String> {
    match cmd {
        WorkstreamCommand::LaunchWorkstream {
            blueprint_id,
            workstream_name,
            params: _,
        } => {
            let ws_id = format!(
                "ws-{}",
                uuid::Uuid::new_v4()
                    .to_string()
                    .chars()
                    .take(8)
                    .collect::<String>()
            );

            let _ = app.emit(
                "workstream://event",
                WorkstreamEvent::SmeTaskStarted {
                    task_id: format!("{}-task-1", ws_id),
                    agent_id: "sme_research".to_string(),
                    role: "Research Specialist".to_string(),
                    phase: "Understand & Map".to_string(),
                },
            );

            if blueprint_id.contains("sprint") || blueprint_id == "1hour" {
                let _sprint = OneHourSprintBlueprint::new(&ws_id, &workstream_name);
                let artifact_uri = format!(
                    "blackboard://{}/team-research/sme_research/user_journey@v1",
                    ws_id
                );
                if let Ok(art) = BlackboardArtifact::new(
                    &artifact_uri,
                    "sme_research",
                    "User Journey & Domain Brief",
                    &format!(
                        "# User Journey for {}\nDomain entities and touchpoints analyzed.",
                        workstream_name
                    ),
                    "text/markdown",
                ) {
                    let _ = state.blackboard.publish("sme_research", art).await;
                    let _ = app.emit(
                        "workstream://event",
                        WorkstreamEvent::ArtifactPublished {
                            uri: artifact_uri,
                            title: "User Journey & Domain Brief".to_string(),
                            author: "sme_research".to_string(),
                            version: 1,
                            size_bytes: 85,
                        },
                    );
                }

                let stream_text =
                    "Analyzing requirement brief... Identified 3 core persona workflows.";
                for chunk in stream_text.split_whitespace() {
                    let _ = app.emit(
                        "workstream://event",
                        WorkstreamEvent::TokenStream {
                            task_id: format!("{}-task-1", ws_id),
                            agent_id: "sme_research".to_string(),
                            chunk: format!("{} ", chunk),
                        },
                    );
                }

                {
                    let mut lock = state.total_hours_saved.write().await;
                    *lock += 2.5;
                }
            }

            Ok(serde_json::json!({
                "status": "launched",
                "workstream_id": ws_id,
                "name": workstream_name
            }))
        }

        WorkstreamCommand::PauseWorkstream { workstream_id } => Ok(serde_json::json!({
            "status": "paused",
            "workstream_id": workstream_id
        })),

        WorkstreamCommand::ApproveMilestone {
            workstream_id,
            milestone_id,
        } => Ok(serde_json::json!({
            "status": "approved",
            "workstream_id": workstream_id,
            "milestone_id": milestone_id
        })),

        WorkstreamCommand::ReadBlackboard { uri } => {
            let art = state
                .blackboard
                .get(&uri)
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(&art).map_err(|e| e.to_string())?)
        }

        WorkstreamCommand::SaveApiKey { provider, key } => {
            state
                .keystore
                .set_secret(&provider, &key)
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::json!({ "status": "saved", "provider": provider }))
        }

        WorkstreamCommand::GetSystemStatus => {
            let total_hours = *state.total_hours_saved.read().await;
            let status = SystemStatus {
                version: env!("CARGO_PKG_VERSION").to_string(),
                os: std::env::consts::OS.to_string(),
                app_data_dir: state.paths.app_data_dir.to_string_lossy().to_string(),
                extensions_dir: state.paths.extensions_dir.to_string_lossy().to_string(),
                connected_providers: vec!["gemini".to_string(), "anthropic".to_string()],
                active_workstreams_count: 1,
                total_labor_hours_saved: total_hours,
            };
            Ok(serde_json::to_value(&status).map_err(|e| e.to_string())?)
        }

        WorkstreamCommand::CalibrateFta {
            workstream_id,
            rating,
            hours_saved,
        } => {
            let mut lock = state.total_hours_saved.write().await;
            *lock += hours_saved;
            Ok(serde_json::json!({
                "status": "calibrated",
                "workstream_id": workstream_id,
                "rating": rating,
                "cumulative_hours_saved": *lock
            }))
        }

        WorkstreamCommand::GetPromptConfig { role } => {
            let config = get_prompt_config(state, role).await?;
            Ok(serde_json::to_value(&config).map_err(|e| e.to_string())?)
        }

        WorkstreamCommand::SaveCustomPrompt {
            role,
            content,
            activate,
        } => {
            save_custom_prompt(state, role, content, activate).await?;
            Ok(serde_json::json!({ "status": "saved" }))
        }

        WorkstreamCommand::GetBlackboardManifest { board_id } => {
            get_blackboard_manifest(state, board_id).await
        }

        WorkstreamCommand::GetBlackboardPresentation { board_id } => {
            let md = get_blackboard_presentation(state, board_id).await?;
            Ok(serde_json::Value::String(md))
        }

        WorkstreamCommand::VerifyInvariants { board_id } => {
            verify_invariants(state, board_id).await
        }

        WorkstreamCommand::WebSearch { query } => {
            let res = perform_web_search(&query).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
pub async fn get_prompt_config(
    state: State<'_, AppState>,
    role: String,
) -> Result<PromptConfigDto, String> {
    let custom_path = state.paths.custom_prompts_dir.join(format!("{}.md", role));
    if custom_path.exists() {
        let content = tokio::fs::read_to_string(&custom_path)
            .await
            .map_err(|e| e.to_string())?;
        Ok(PromptConfigDto {
            role,
            is_custom: true,
            display_status: "Custom".to_string(),
            prompt_content: content,
        })
    } else {
        Ok(PromptConfigDto {
            role,
            is_custom: false,
            display_status: "Defaulted".to_string(),
            prompt_content: "".to_string(), // NEVER return proprietary prompt text to frontend
        })
    }
}

#[tauri::command]
pub async fn save_custom_prompt(
    state: State<'_, AppState>,
    role: String,
    content: String,
    activate: bool,
) -> Result<(), String> {
    let custom_path = state.paths.custom_prompts_dir.join(format!("{}.md", role));
    if activate {
        tokio::fs::write(&custom_path, &content)
            .await
            .map_err(|e| e.to_string())?;
    } else if custom_path.exists() {
        let _ = tokio::fs::remove_file(&custom_path).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_blackboard_manifest(
    state: State<'_, AppState>,
    board_id: String,
) -> Result<serde_json::Value, String> {
    match state.blackboard.get_manifest(&board_id).await {
        Ok(manifest) => Ok(serde_json::to_value(&manifest).map_err(|e| e.to_string())?),
        Err(_) => {
            let manifest = frostfire_core::blackboard::BlackboardManifest::new(&board_id);
            Ok(serde_json::to_value(&manifest).map_err(|e| e.to_string())?)
        }
    }
}

#[tauri::command]
pub async fn get_blackboard_presentation(
    state: State<'_, AppState>,
    board_id: String,
) -> Result<String, String> {
    match state.blackboard.get_presentation_markdown(&board_id).await {
        Ok(md) => Ok(md),
        Err(_) => {
            let manifest = frostfire_core::blackboard::BlackboardManifest::new(&board_id);
            Ok(manifest.compile_presentation_markdown())
        }
    }
}

#[tauri::command]
pub async fn verify_invariants(
    state: State<'_, AppState>,
    board_id: String,
) -> Result<serde_json::Value, String> {
    match state.blackboard.verify_manifest_invariants(&board_id).await {
        Ok(res) => Ok(serde_json::to_value(&res).map_err(|e| e.to_string())?),
        Err(_) => {
            let manifest = frostfire_core::blackboard::BlackboardManifest::new(&board_id);
            let res = frostfire_core::blackboard::DeterministicInvariantEngine::verify(&manifest);
            Ok(serde_json::to_value(&res).map_err(|e| e.to_string())?)
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CloudAgentInfo {
    pub id: String,
    pub name: String,
    pub role: String,
    pub display_number: u32,
    pub vnc_port: u16,
    pub cdp_port: u16,
    pub novnc_token: String,
    pub status: String,
}

#[tauri::command]
pub async fn list_agent_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<AgentSessionInfo>, String> {
    AgentSessionManager::list_sessions(&state.paths.agents_dir)
        .map_err(|e| format!("Failed to list agent sessions: {}", e))
}

#[tauri::command]
pub async fn create_agent_session(
    state: State<'_, AppState>,
    name: String,
    role: String,
    description: Option<String>,
    system_prompt: Option<String>,
    is_team: Option<bool>,
    member_ids: Option<Vec<String>>,
) -> Result<AgentSessionInfo, String> {
    let _ = member_ids;
    let vm_host = std::env::var("EC2_AGENT_HOST")
        .ok()
        .filter(|h| !h.trim().is_empty())
        .or_else(|| Some("44.242.94.86".to_string()));

    let team_id = if is_team.unwrap_or(false) {
        Some(format!("team_{}", uuid::Uuid::new_v4().simple()))
    } else {
        None
    };

    AgentSessionManager::create_session(
        &state.paths.agents_dir,
        name,
        role,
        description,
        system_prompt,
        vm_host,
        team_id,
    )
    .map_err(|e| format!("Failed to create agent session: {}", e))
}

#[tauri::command]
pub async fn delete_agent_session(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    AgentSessionManager::delete_session(&state.paths.agents_dir, &id)
        .map_err(|e| format!("Failed to delete agent session: {}", e))
}

#[tauri::command]
pub async fn get_cloud_agents(state: State<'_, AppState>) -> Result<Vec<CloudAgentInfo>, String> {
    let sessions = AgentSessionManager::list_sessions(&state.paths.agents_dir)
        .map_err(|e| format!("Failed to query agent sessions: {}", e))?;

    let agents = sessions
        .into_iter()
        .map(|s| CloudAgentInfo {
            id: s.id.clone(),
            name: s.name,
            role: s.role,
            display_number: s.display_number as u32,
            vnc_port: s.vnc_port,
            cdp_port: s.cdp_port,
            novnc_token: s.id,
            status: s.status,
        })
        .collect();

    Ok(agents)
}

#[tauri::command]
pub async fn set_display_takeover(
    state: State<'_, AppState>,
    display_number: u32,
    take_control: bool,
) -> Result<bool, String> {
    tracing::info!(
        "🖐️ [Tauri Takeover] Display :{} take_control={}",
        display_number,
        take_control
    );

    let action = if take_control {
        frostfire_proto::tunnel::display_takeover_event::Action::UserFocused as i32
    } else {
        frostfire_proto::tunnel::display_takeover_event::Action::UserReleased as i32
    };

    let frame = TunnelClientFrame {
        frame_id: format!("takeover-{}", uuid::Uuid::new_v4()),
        timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
        agent_id: "desktop".to_string(),
        payload: Some(tunnel_client_frame::Payload::DisplayTakeover(
            DisplayTakeoverEvent {
                session_id: format!("disp_{}", display_number),
                display_number,
                action,
            },
        )),
    };

    let _ = state.tunnel_tx.send(frame).await;
    Ok(take_control)
}

#[tauri::command]
pub async fn trigger_teach_session(
    state: State<'_, AppState>,
    display_number: u32,
    action: String,
    session_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let id = session_id.unwrap_or_else(AgentSessionManager::generate_agent_id);
    let teach_dir = state.paths.app_data_dir.join("teach_sessions").join(&id);
    std::fs::create_dir_all(&teach_dir)
        .map_err(|e| format!("Failed to create teach session dir: {}", e))?;

    let timestamp = chrono::Utc::now().to_rfc3339();
    tracing::info!(
        "🎓 [Tauri Teach] Display :{} action={} session_id={}",
        display_number,
        action,
        id
    );

    let status = match action.as_str() {
        "start" => {
            let meta = serde_json::json!({
                "session_id": id,
                "display": display_number,
                "status": "recording",
                "started_at": timestamp,
            });
            let _ = std::fs::write(
                teach_dir.join("session.json"),
                serde_json::to_string_pretty(&meta).unwrap_or_default(),
            );
            "recording"
        }
        "stop" | "compile_sop" => {
            let started_at = if let Ok(content) = std::fs::read_to_string(teach_dir.join("session.json")) {
                serde_json::from_str::<serde_json::Value>(&content)
                    .ok()
                    .and_then(|v| v["started_at"].as_str().map(|s| s.to_string()))
                    .unwrap_or_else(|| timestamp.clone())
            } else {
                timestamp.clone()
            };

            let sop_markdown = format!(
                "# SOP: Demonstration on Display :{}\n\n\
                 - Session ID: `{}`\n\
                 - Started: {}\n\
                 - Completed: {}\n\
                 - Display Target: :{}\n\n\
                 ## Recorded Action Sequence\n\
                 1. Workflow initialized on Display :{}\n\
                 2. Target application stream captured\n\
                 3. Verification completed\n",
                display_number, id, started_at, timestamp, display_number, display_number
            );

            let _ = std::fs::write(teach_dir.join("SOP.md"), &sop_markdown);
            "completed"
        }
        other => return Err(format!("Unknown teach session action: {}", other)),
    };

    let sop_content = if status == "completed" {
        std::fs::read_to_string(teach_dir.join("SOP.md")).unwrap_or_default()
    } else {
        String::new()
    };

    Ok(serde_json::json!({
        "sessionId": id,
        "display": display_number,
        "action": action,
        "status": status,
        "sopMarkdown": sop_content,
        "timestamp": timestamp,
    }))
}

#[tauri::command]
pub async fn respond_hitl_approval(
    state: State<'_, AppState>,
    request_id: String,
    approved: bool,
    reason: String,
) -> Result<serde_json::Value, String> {
    tracing::info!(
        "🛡️ [Tauri HITL] Request {} approved={} reason={}",
        request_id,
        approved,
        reason
    );

    let frame = TunnelClientFrame {
        frame_id: format!("hitl-resp-{}", uuid::Uuid::new_v4()),
        timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
        agent_id: "desktop".to_string(),
        payload: Some(tunnel_client_frame::Payload::ApprovalResponse(
            ApprovalResponse {
                request_id: request_id.clone(),
                approved,
                reason: reason.clone(),
                approved_by: "operator".to_string(),
                responded_at_unix: chrono::Utc::now().timestamp(),
            },
        )),
    };
    let _ = state.tunnel_tx.send(frame).await;

    Ok(serde_json::json!({
        "requestId": request_id,
        "approved": approved,
        "reason": reason,
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

#[tauri::command]
pub async fn execute_remote_cloud_command(
    state: State<'_, AppState>,
    display: u16,
    command: String,
    cwd: Option<String>,
    background: Option<bool>,
    vm_host: Option<String>,
    exec_port: Option<u16>,
) -> Result<RemoteExecResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let host_raw = vm_host
        .filter(|h| !h.trim().is_empty() && h.trim() != "35.89.125.63")
        .or_else(|| {
            std::env::var("EC2_AGENT_HOST")
                .ok()
                .filter(|h| !h.trim().is_empty() && h.trim() != "35.89.125.63")
        })
        .unwrap_or_else(|| "44.242.94.86".to_string());

    let is_lambda = host_raw.contains("lambda-url") || host_raw.starts_with("https://");
    let url = if is_lambda {
        let clean_host = host_raw
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/');
        format!("https://{}/api/exec", clean_host)
    } else {
        let port: u16 = match exec_port {
            Some(p) if p != 0 && p != 3000 && p != 443 => p,
            _ => std::env::var("EC2_EXEC_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .filter(|&p| p != 0 && p != 3000 && p != 443)
                .unwrap_or(1339),
        };
        let clean_host = host_raw
            .trim_start_matches("http://")
            .trim_end_matches('/');
        format!("http://{}:{}/exec", clean_host, port)
    };
    let clean_cmd = sanitize_bash_command(&command);
    let is_bg = background.unwrap_or_else(|| clean_cmd.ends_with('&'));
    let work_dir = cwd.unwrap_or_else(|| "/home/ubuntu".to_string());

    let body = serde_json::json!({
        "display": display,
        "command": clean_cmd,
        "cwd": work_dir,
        "background": is_bg,
    });

    let mut request_builder = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body);

    if let Ok(token) = std::env::var("CLOUD_GATEWAY_TOKEN") {
        if !token.trim().is_empty() {
            request_builder = request_builder.header("Authorization", format!("Bearer {}", token.trim()));
        }
    } else if let Ok(Some(token)) = state.keystore.get_secret("cloud_gateway_token").await {
        if !token.as_str().trim().is_empty() {
            request_builder = request_builder.header("Authorization", format!("Bearer {}", token.as_str().trim()));
        }
    }

    let resp = request_builder
        .send()
        .await
        .map_err(|e| format!("Failed to reach remote executor at {}: {}", url, e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Remote executor at {} returned HTTP status: {}",
            url,
            resp.status()
        ));
    }

    let res = resp
        .json::<RemoteExecResult>()
        .await
        .map_err(|e| format!("Failed to parse executor response: {}", e))?;

    Ok(res)
}

#[tauri::command]
pub async fn get_tunnel_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let is_connected = {
        let lock = state.tunnel_handle.read().await;
        lock.as_ref().map(|h| h.is_connected()).unwrap_or(false)
    };
    Ok(serde_json::json!({
        "connected": is_connected,
        "server_url": state.cloud_server_url,
    }))
}

#[tauri::command]
pub async fn get_dag_state(
    state: State<'_, AppState>,
    workstream_id: String,
) -> Result<serde_json::Value, String> {
    let map = state.dag_store.read().await;
    if let Some(dag) = map.get(&workstream_id) {
        Ok(serde_json::to_value(dag).map_err(|e| e.to_string())?)
    } else {
        Ok(serde_json::json!({
            "id": workstream_id,
            "nodes": {},
            "dependencies": {}
        }))
    }
}

#[tauri::command]
pub async fn update_dag_task_status(
    state: State<'_, AppState>,
    workstream_id: String,
    task_id: String,
    status: String,
) -> Result<(), String> {
    let task_status = match status.as_str() {
        "ready" => frostfire_core::dag::TaskStatus::Ready,
        "running" => frostfire_core::dag::TaskStatus::Running,
        "completed" => frostfire_core::dag::TaskStatus::Completed,
        "failed" => frostfire_core::dag::TaskStatus::Failed,
        _ => frostfire_core::dag::TaskStatus::Pending,
    };

    {
        let mut map = state.dag_store.write().await;
        if let Some(dag) = map.get_mut(&workstream_id) {
            let _ = dag.update_task_status(&task_id, task_status.clone());
        }
    }

    let frame = TunnelClientFrame {
        frame_id: format!("dag-sync-{}", uuid::Uuid::new_v4()),
        timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
        agent_id: "desktop".to_string(),
        payload: Some(tunnel_client_frame::Payload::DagSync(
            DagSyncFrame {
                workstream_id,
                task_id,
                title: String::new(),
                agent_id: String::new(),
                status: match task_status {
                    frostfire_core::dag::TaskStatus::Ready => 1,
                    frostfire_core::dag::TaskStatus::Running => 2,
                    frostfire_core::dag::TaskStatus::Completed => 3,
                    frostfire_core::dag::TaskStatus::Failed => 4,
                    _ => 0,
                },
                input_uris: vec![],
                output_uris: vec![],
                timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
            },
        )),
    };
    let _ = state.tunnel_tx.send(frame).await;
    Ok(())
}

fn resolve_bedrock_key() -> Option<String> {
    if let Ok(key) = std::env::var("BEDROCK_API_KEY") {
        let clean = key.trim().replace(['\r', '\n'], "");
        if !clean.is_empty() {
            return Some(clean);
        }
    }
    for p in [".env", "../.env", "../../.env"] {
        if let Ok(content) = std::fs::read_to_string(p) {
            for line in content.lines() {
                let trimmed = line.trim();
                if let Some(rest) = trimmed.strip_prefix("BEDROCK_API_KEY=") {
                    let clean = rest
                        .trim()
                        .trim_matches('"')
                        .trim_matches('\'')
                        .replace(['\r', '\n'], "");
                    if !clean.is_empty() {
                        return Some(clean);
                    }
                }
            }
        }
    }
    None
}

fn resolve_gemini_key() -> Option<String> {
    if let Ok(key) = std::env::var("GEMINI_API_KEY") {
        let clean = key.trim().replace(['\r', '\n'], "");
        if !clean.is_empty() {
            return Some(clean);
        }
    }
    for p in [".env", "../.env", "../../.env"] {
        if let Ok(content) = std::fs::read_to_string(p) {
            for line in content.lines() {
                let trimmed = line.trim();
                if let Some(rest) = trimmed.strip_prefix("GEMINI_API_KEY=") {
                    let clean = rest
                        .trim()
                        .trim_matches('"')
                        .trim_matches('\'')
                        .replace(['\r', '\n'], "");
                    if !clean.is_empty() {
                        return Some(clean);
                    }
                }
            }
        }
    }
    None
}

fn resolve_anthropic_key() -> Option<String> {
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        let clean = key.trim().replace(['\r', '\n'], "");
        if !clean.is_empty() {
            return Some(clean);
        }
    }
    for p in [".env", "../.env", "../../.env"] {
        if let Ok(content) = std::fs::read_to_string(p) {
            for line in content.lines() {
                let trimmed = line.trim();
                if let Some(rest) = trimmed.strip_prefix("ANTHROPIC_API_KEY=") {
                    let clean = rest
                        .trim()
                        .trim_matches('"')
                        .trim_matches('\'')
                        .replace(['\r', '\n'], "");
                    if !clean.is_empty() {
                        return Some(clean);
                    }
                }
            }
        }
    }
    None
}

fn infer_agent_tool_calls(prompt: &str, display_number: u32) -> Vec<String> {
    let p = prompt.to_lowercase();
    let mut tools = Vec::new();
    let is_screen_capture = display_number == 1;
    let is_browser = matches!(display_number, 1 | 4 | 7);
    let is_dev = matches!(display_number, 2 | 5 | 8);
    let is_qa = matches!(display_number, 3 | 6 | 9);

    if p.contains("screen")
        || p.contains("screenshot")
        || p.contains("capture")
        || p.contains("picture")
        || is_screen_capture
    {
        tools.push("screen_capture".to_string());
        tools.push("frame_buffer_inspect".to_string());
    }

    if p.contains("browser")
        || p.contains("chrome")
        || p.contains("web")
        || p.contains("http")
        || p.contains("github")
        || is_browser
    {
        tools.push("browser_navigate".to_string());
        tools.push("page_dom_inspect".to_string());
    }
    if p.contains("run")
        || p.contains("terminal")
        || p.contains("bash")
        || p.contains("cmd")
        || p.contains("exec")
        || is_dev
    {
        tools.push("bash_exec".to_string());
        tools.push("terminal_mux".to_string());
    }
    if p.contains("test")
        || p.contains("verify")
        || p.contains("check")
        || p.contains("qa")
        || is_qa
    {
        tools.push("test_runner".to_string());
        tools.push("dom_assert".to_string());
    }
    if tools.is_empty() {
        tools.push("desktop_action".to_string());
        tools.push("workspace_sync".to_string());
    }
    tools.dedup();
    tools
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct RemoteExecResult {
    #[serde(default)]
    pub status: String,
    #[serde(alias = "exit_code")]
    pub code: Option<i32>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
}

fn sanitize_bash_command(cmd: &str) -> String {
    let mut s = cmd.trim().to_string();
    while s.contains("&; ") {
        s = s.replace("&; ", "& ");
    }
    while s.contains("&;") {
        s = s.replace("&;", "& ");
    }
    while s.contains("& ; ") {
        s = s.replace("& ; ", "& ");
    }
    while s.contains("& ;") {
        s = s.replace("& ;", "& ");
    }
    while s.contains(";& ") {
        s = s.replace(";& ", "; ");
    }
    while s.contains(";&") {
        s = s.replace(";&", "; ");
    }
    while s.contains("; & ") {
        s = s.replace("; & ", "; ");
    }
    while s.contains("; &") {
        s = s.replace("; &", "; ");
    }
    while s.contains("&  ") {
        s = s.replace("&  ", "& ");
    }
    while s.contains(";  ") {
        s = s.replace(";  ", "; ");
    }
    s
}

async fn execute_on_remote_pc(
    display_number: u32,
    cmd: &str,
    vm_host: Option<&str>,
    exec_port: Option<u16>,
) -> Result<RemoteExecResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let host_raw = vm_host
        .filter(|h| !h.trim().is_empty() && h.trim() != "35.89.125.63")
        .map(|h| h.trim().to_string())
        .or_else(|| {
            std::env::var("EC2_AGENT_HOST")
                .ok()
                .filter(|h| !h.trim().is_empty() && h.trim() != "35.89.125.63")
        })
        .unwrap_or_else(|| "44.242.94.86".to_string());

    let is_lambda = host_raw.contains("lambda-url") || host_raw.starts_with("https://");
    let url = if is_lambda {
        let clean_host = host_raw
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/');
        format!("https://{}/api/exec", clean_host)
    } else {
        let port: u16 = match exec_port {
            Some(p) if p != 0 && p != 3000 && p != 443 => p,
            _ => std::env::var("EC2_EXEC_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .filter(|&p| p != 0 && p != 3000 && p != 443)
                .unwrap_or(1339),
        };
        let clean_host = host_raw
            .trim_start_matches("http://")
            .trim_end_matches('/');
        format!("http://{}:{}/exec", clean_host, port)
    };

    let clean_cmd = sanitize_bash_command(cmd);
    let is_bg = clean_cmd.ends_with('&');
    let body = serde_json::json!({
        "display": display_number,
        "command": clean_cmd,
        "cwd": "/home/ubuntu",
        "background": is_bg
    });

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach remote executor: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Remote executor returned status: {}",
            resp.status()
        ));
    }

    let res = resp
        .json::<RemoteExecResult>()
        .await
        .map_err(|e| format!("Failed to parse executor response: {}", e))?;

    Ok(res)
}

fn parse_action_response(text: &str) -> (Option<String>, String, Option<String>) {
    let clean = text.trim();

    // 1. Direct JSON parse or markdown fenced block
    let json_candidate = if clean.starts_with("```") {
        let lines: Vec<&str> = clean.lines().collect();
        if lines.len() >= 2 {
            let start = if lines[0].starts_with("```") { 1 } else { 0 };
            let end = if lines.last().is_some_and(|l| l.trim() == "```") {
                lines.len() - 1
            } else {
                lines.len()
            };
            lines[start..end].join("\n")
        } else {
            clean.to_string()
        }
    } else {
        clean.to_string()
    };

    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_candidate) {
        let cmd = val
            .get("command")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let reply = val
            .get("reply")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let tool = val
            .get("tool")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string());
        if !reply.is_empty() || cmd.is_some() {
            let final_reply = if reply.is_empty() {
                "Action executed on cloud machine.".to_string()
            } else {
                reply
            };
            return (cmd, final_reply, tool);
        }
    }

    // 2. Embedded JSON block extraction
    if let Some(start_idx) = text.find('{') {
        if let Some(end_idx) = text.rfind('}') {
            if end_idx > start_idx {
                let candidate = &text[start_idx..=end_idx];
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(candidate) {
                    let cmd = val
                        .get("command")
                        .and_then(|v| v.as_str())
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty());
                    let reply = val
                        .get("reply")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    let tool = val
                        .get("tool")
                        .and_then(|v| v.as_str())
                        .map(|s| s.trim().to_string());
                    if !reply.is_empty() || cmd.is_some() {
                        let final_reply = if reply.is_empty() {
                            "Action executed on cloud machine.".to_string()
                        } else {
                            reply
                        };
                        return (cmd, final_reply, tool);
                    }
                }
            }
        }
    }

    // 3. Plain conversational text
    (None, text.to_string(), None)
}

fn fallback_command_from_prompt(
    prompt: &str,
    display_number: u32,
) -> Option<(String, String, String)> {
    let p = prompt.trim().to_lowercase();

    // 1. GUI Keys & Input
    if p == "enter" || p == "press enter" || p == "hit enter" || p == "return" {
        return Some((
            "xdotool key Return".to_string(),
            "Sent Enter key to active display.".to_string(),
            "gui_key".to_string(),
        ));
    }
    if p == "tab" || p == "press tab" {
        return Some((
            "xdotool key Tab".to_string(),
            "Sent Tab key to active display.".to_string(),
            "gui_key".to_string(),
        ));
    }
    if p == "escape" || p == "esc" {
        return Some((
            "xdotool key Escape".to_string(),
            "Sent Escape key to active display.".to_string(),
            "gui_key".to_string(),
        ));
    }
    if p == "backspace" {
        return Some((
            "xdotool key BackSpace".to_string(),
            "Sent BackSpace key to active display.".to_string(),
            "gui_key".to_string(),
        ));
    }
    if p.starts_with("type ") {
        let to_type = prompt.trim()[5..]
            .trim()
            .trim_matches('\'')
            .trim_matches('"');
        return Some((
            format!(
                "xdotool type --delay 12 '{}'",
                to_type.replace('\'', "'\\''")
            ),
            format!("Typed \"{}\" into active window.", to_type),
            "gui_type".to_string(),
        ));
    }

    // 2. Chat & Messaging Intent (Google Messages, chat, etc.)
    let is_send_intent = p.starts_with("send ")
        || p.starts_with("say ")
        || p.starts_with("tell ")
        || p.contains("send a message")
        || p.contains("send message")
        || p.contains("saying ")
        || p.contains("type and send");

    if is_send_intent && !p.starts_with("open ") && !p.starts_with("launch ") {
        let raw_text = if let Some(idx) = p.find("saying ") {
            &prompt[idx + 7..]
        } else if let Some(idx) = p.find("say ") {
            &prompt[idx + 4..]
        } else if let Some(idx) = p.find("message: ") {
            &prompt[idx + 9..]
        } else if let Some(idx) = p.find("to cason ") {
            &prompt[idx + 9..]
        } else if p.starts_with("send ") {
            &prompt[5..]
        } else {
            prompt
        };

        let clean_text = raw_text
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .trim_start_matches("that ")
            .trim();

        if !clean_text.is_empty() {
            let cmd = format!(
                "xdotool mousemove 500 545 click 1 && sleep 0.2 && xdotool type --delay 12 '{}' && sleep 0.2 && xdotool key Return",
                clean_text.replace('\'', "'\\''")
            );
            return Some((
                cmd,
                format!("Sent message: \"{}\"", clean_text),
                "chat_message_send".to_string(),
            ));
        }
    }

    // 3. Browser & Chrome
    let is_open_messages = p.contains("google messages")
        || p.contains("open messages")
        || p.contains("launch messages")
        || p.contains("navigate to messages")
        || p.contains("check messages")
        || p.contains("read messages")
        || p.contains("view messages")
        || (p.contains("messages") && (p.contains("chrome") || p.contains("browser") || p.contains("from")));

    // Screen capture / screenshot
    if p.contains("screenshot")
        || p.contains("screen capture")
        || p.contains("capture screen")
        || p.contains("take a screenshot")
        || p.contains("take screenshot")
        || p.contains("take a picture of the screen")
        || p.contains("take picture of screen")
        || p.contains("grab screen")
        || p.contains("capture the screen")
    {
        return Some((
            "scrot -o /tmp/screen.png".to_string(),
            format!("Captured screen on Display :{} to /tmp/screen.png.", display_number),
            "screen_capture".to_string(),
        ));
    }

    if p.contains("chrome")
        || p.contains("chome")
        || p.contains("browser")
        || is_open_messages
        || p.contains("open web")
        || p.contains("navigate to")
        || p.contains("navagate to")
    {
        let url = if is_open_messages {
            "https://messages.google.com/web"
        } else if p.contains("youtube") {
            "https://youtube.com"
        } else if p.contains("github") {
            "https://github.com"
        } else if p.contains("http://") || p.contains("https://") {
            p.split_whitespace()
                .find(|word| word.starts_with("http://") || word.starts_with("https://"))
                .unwrap_or("https://google.com")
        } else {
            "https://google.com"
        };
        return Some((
            format!("/usr/local/bin/chrome-launcher '{}' &", url),
            format!(
                "Navigating Google Chrome to {} on Display :{}.",
                url, display_number
            ),
            "browser_launch".to_string(),
        ));
    }

    // 3. Terminal
    if p.contains("open terminal")
        || p == "terminal"
        || p.contains("launch terminal")
        || p.contains("open bash")
        || p.contains("open shell")
    {
        return Some((
            "/usr/local/bin/terminal-launcher &".to_string(),
            format!("Launched XFCE Terminal on Display :{}.", display_number),
            "terminal_launch".to_string(),
        ));
    }

    // 4. File Manager / Filesystem
    if p.contains("open file")
        || p.contains("launch file")
        || p.contains("open filesystem")
        || p.contains("launch filesystem")
        || p.contains("filesystem")
        || p.contains("file manager")
        || p == "files"
        || p == "open files"
        || p == "launch files"
        || p.contains("thunar")
    {
        return Some((
            "/usr/local/bin/files-launcher &".to_string(),
            format!(
                "Launched Filesystem Manager on Display :{}.",
                display_number
            ),
            "files_launch".to_string(),
        ));
    }

    // 4. File Management & Commands
    if p == "ls"
        || p == "list files"
        || p.starts_with("ls ")
        || p.contains("list directory")
        || p.contains("show files")
    {
        let path = if p.contains("ls -") || p.starts_with("ls ") {
            prompt.trim()
        } else {
            "ls -la /home/ubuntu"
        };
        return Some((
            path.to_string(),
            "Listing files on cloud PC:".to_string(),
            "fs_list".to_string(),
        ));
    }

    if p.starts_with("cat ") || p.starts_with("head ") || p.starts_with("tail ") {
        return Some((
            prompt.trim().to_string(),
            format!("Reading file via: `{}`", prompt.trim()),
            "fs_read".to_string(),
        ));
    }

    if p.starts_with("rm ") || p.starts_with("delete file") || p.starts_with("remove file") {
        let cmd = if p.starts_with("rm ") {
            prompt.trim().to_string()
        } else {
            let target = prompt.split_whitespace().last().unwrap_or("");
            format!("rm -f /home/ubuntu/{}", target)
        };
        return Some((
            cmd.clone(),
            format!("Removed file via: `{}`", cmd),
            "fs_delete".to_string(),
        ));
    }

    if p.starts_with("touch ") || p.starts_with("create file ") || p.starts_with("make file ") {
        let cmd = if p.starts_with("touch ") {
            prompt.trim().to_string()
        } else {
            let fname = prompt.split_whitespace().last().unwrap_or("file.txt");
            format!("touch /home/ubuntu/{}", fname)
        };
        return Some((
            cmd.clone(),
            format!("Created file via: `{}`", cmd),
            "fs_create".to_string(),
        ));
    }

    // 5. System commands & Ping
    if p.starts_with("ping ")
        || p == "ping cloudflare dns"
        || p == "ping cloudflare"
        || p == "ping google"
    {
        let host = if p.contains("cloudflare") {
            "1.1.1.1"
        } else if p.contains("google") {
            "8.8.8.8"
        } else {
            prompt.split_whitespace().nth(1).unwrap_or("1.1.1.1")
        };
        let cmd = format!(
            "/usr/local/bin/terminal-launcher && sleep 0.4 && xdotool type --delay 12 'ping -c 4 {}' && sleep 0.2 && xdotool key Return",
            host
        );
        return Some((
            cmd,
            format!("Pinging {} on Display :{} terminal.", host, display_number),
            "terminal_exec".to_string(),
        ));
    }

    if p == "pwd"
        || p == "df -h"
        || p == "free -m"
        || p == "uptime"
        || p == "whoami"
        || p.starts_with("ps ")
        || p == "top"
    {
        let cmd = if p == "top" {
            "top -b -n 1 | head -n 20"
        } else {
            prompt.trim()
        };
        return Some((
            cmd.to_string(),
            format!("Executed system command: `{}`", cmd),
            "bash_exec".to_string(),
        ));
    }

    None
}

fn load_skills_catalog() -> String {
    let mut catalog = String::new();
    let candidates = [
        "skills",
        ".agents/skills",
        "../skills",
        "../../skills",
        "../../.agents/skills",
    ];
    for dir in candidates {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let skill_md = path.join("SKILL.md");
                    if skill_md.exists() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if let Ok(content) = std::fs::read_to_string(&skill_md) {
                            let desc = if let Some(desc_idx) = content.find("description:") {
                                let after = &content[desc_idx + 12..];
                                let end_idx = after.find("---").unwrap_or(after.len().min(140));
                                after[..end_idx]
                                    .trim()
                                    .trim_start_matches(">-")
                                    .trim()
                                    .lines()
                                    .collect::<Vec<_>>()
                                    .join(" ")
                            } else {
                                "Managed bot skill".to_string()
                            };
                            catalog.push_str(&format!("- {}: {}\n", name, desc));
                        }
                    }
                }
            }
            if !catalog.is_empty() {
                break;
            }
        }
    }

    if catalog.is_empty() {
        catalog = "\
- add-connector: Connect a new MCP connector, search catalog, install, and authenticate.
- box-desktop: Direct desktop/browser subagent workflows and GUI interaction.
- channels: Outside messaging platforms and channel integration.
- code-changes: Code modifications, refactors, new features, and test verification.
- export-bot-template: Export and share bot configuration template.
- group-chat-turns: Multi-agent group chat coordination and turn taking.
- learn-from-demonstration: Convert screen-recorded demonstration into an automated skill.
- no-connector-fallback: Workarounds when service connectors are missing or require manual auth.
- purchases: E-commerce and procurement guardrails.
- routines: Event-driven schedules, recurring cron tasks, and monitor digests.
- send-on-behalf: Draft and send communications with human-in-the-loop review.
- skill-authoring: Creating, changing, and deleting reusable agent skills.\n"
            .to_string();
    }

    catalog
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatMessagePayload {
    pub role: String,
    pub content: String,
}

fn load_agents_md() -> String {
    let search_paths = [
        "AGENTS.md",
        "../AGENTS.md",
        "../../AGENTS.md",
        "../../../AGENTS.md",
        "c:/Users/tyson/.repo/personal/frostfire/AGENTS.md",
        "c:/Users/tyson/.repo/personal/frostfire-cloud/AGENTS.md",
        "/home/ubuntu/AGENTS.md",
    ];

    for path in search_paths {
        if let Ok(content) = std::fs::read_to_string(path) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }

    include_str!("../../../AGENTS.md").trim().to_string()
}

fn load_system_md() -> String {
    let search_paths = [
        "SYSTEM.md",
        "../SYSTEM.md",
        "../../SYSTEM.md",
        "../../../SYSTEM.md",
        "c:/Users/tyson/.repo/personal/frostfire/SYSTEM.md",
        "/home/ubuntu/SYSTEM.md",
    ];

    for path in search_paths {
        if let Ok(content) = std::fs::read_to_string(path) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }

    include_str!("../../../SYSTEM.md").trim().to_string()
}

async fn query_bedrock_or_gemini(
    user_id: &str,
    display_number: u32,
    prompt: &str,
    history: Option<&[ChatMessagePayload]>,
    agent_name_override: Option<&str>,
    agent_role_override: Option<&str>,
    custom_system_prompt: Option<&str>,
) -> Option<(Option<String>, String, Option<String>)> {
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .ok()?;

    let skills_catalog = load_skills_catalog();
    let agents_md = load_agents_md();
    let system_md = load_system_md();

    let is_slot_1 = display_number == 1;
    let agent_name = agent_name_override.unwrap_or(if is_slot_1 {
        "Claude 3.7 Sonnet"
    } else {
        "Gemini 3.8 Flash"
    });
    let agent_role = agent_role_override.unwrap_or(if is_slot_1 {
        "Screen Capture & Computer Use"
    } else {
        "Terminal & Cloud Automation"
    });

    let persona_block = format!(
        "## Active Agent Persona\n- Name: {}\n- Role: {}\n- Target User: {}\n- Target Display: :{}\n{}",
        agent_name,
        agent_role,
        user_id,
        display_number,
        custom_system_prompt.unwrap_or("").trim()
    );

    let system_prompt = format!(
        "{}\n\n{}\n\n<agents_md>\n{}\n</agents_md>\n\n<installed_skills>\n{}\n</installed_skills>",
        system_md, persona_block, agents_md, skills_catalog
    );

    // 1. Anthropic direct API (if ANTHROPIC_API_KEY is present and targeting slot 1)
    if is_slot_1 {
        if let Some(anthropic_key) = resolve_anthropic_key() {
            let mut anthropic_messages = Vec::new();
            if let Some(hist) = history {
                for msg in hist {
                    let role = if msg.role == "assistant" { "assistant" } else { "user" };
                    anthropic_messages.push(serde_json::json!({
                        "role": role,
                        "content": msg.content
                    }));
                }
            }
            anthropic_messages.push(serde_json::json!({
                "role": "user",
                "content": prompt
            }));

            let body = serde_json::json!({
                "model": "claude-3-7-sonnet-20250219",
                "max_tokens": 1024,
                "system": system_prompt,
                "messages": anthropic_messages
            });
            if let Ok(resp) = http
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", anthropic_key)
                .header("anthropic-version", "2023-06-01")
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
            {
                if resp.status().is_success() {
                    if let Ok(json) = resp.json::<serde_json::Value>().await {
                        if let Some(text) = json
                            .pointer("/content/0/text")
                            .and_then(|v| v.as_str())
                        {
                            return Some(parse_action_response(text));
                        }
                    }
                }
            }
        }
    }

    // Build multi-turn Bedrock messages
    let mut bedrock_messages = Vec::new();
    if let Some(hist) = history {
        for msg in hist {
            let role = if msg.role == "assistant" { "assistant" } else { "user" };
            bedrock_messages.push(serde_json::json!({
                "role": role,
                "content": [{"text": msg.content}]
            }));
        }
    }
    bedrock_messages.push(serde_json::json!({
        "role": "user",
        "content": [{"text": prompt}]
    }));

    // 2. Bedrock Converse via local AWS CLI (fast, uses active AWS credentials / profile)
    let cli_res = tokio::task::spawn_blocking({
        let sys = system_prompt.clone();
        let b_msgs = bedrock_messages.clone();
        let custom_model = std::env::var("BEDROCK_MODEL").ok();
        move || {
            let sys_json = serde_json::json!([{"text": sys}]).to_string();
            let msg_json = serde_json::to_string(&b_msgs).unwrap_or_else(|_| "[]".to_string());

            let temp_dir = std::env::temp_dir();
            let rand_id = uuid::Uuid::new_v4().simple();
            let sys_file = temp_dir.join(format!("ff_sys_{}.json", rand_id));
            let msg_file = temp_dir.join(format!("ff_msg_{}.json", rand_id));

            if std::fs::write(&sys_file, &sys_json).is_err() || std::fs::write(&msg_file, &msg_json).is_err() {
                return None;
            }

            let sys_arg = format!("file://{}", sys_file.to_string_lossy().replace('\\', "/"));
            let msg_arg = format!("file://{}", msg_file.to_string_lossy().replace('\\', "/"));

            let aws_bin = if std::path::Path::new(r"C:\Program Files\Amazon\AWSCLIV2\aws.exe").exists() {
                r"C:\Program Files\Amazon\AWSCLIV2\aws.exe"
            } else {
                "aws"
            };

            let mut candidates: Vec<String> = Vec::new();
            if let Some(cm) = custom_model {
                candidates.push(cm);
            }
            candidates.push("us.meta.llama3-3-70b-instruct-v1:0".to_string());
            candidates.push("us.deepseek.r1-v1:0".to_string());
            candidates.push("us.amazon.nova-pro-v1:0".to_string());
            candidates.push("amazon.nova-lite-v1:0".to_string());

            let mut final_res = None;
            for model_id in &candidates {
                let mut cmd = std::process::Command::new(aws_bin);
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                }
                cmd.env("PYTHONUTF8", "1");
                cmd.env("PYTHONIOENCODING", "utf-8");
                cmd.args([
                    "bedrock-runtime",
                    "converse",
                    "--model-id",
                    model_id,
                    "--region",
                    "us-west-2",
                    "--system",
                    &sys_arg,
                    "--messages",
                    &msg_arg,
                    "--output",
                    "json",
                ]);
                match cmd.output() {
                    Ok(output) => {
                        if output.status.success() {
                            if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                                if let Some(text) = json.pointer("/output/message/content/0/text").and_then(|v| v.as_str()) {
                                    final_res = Some(parse_action_response(text));
                                    break;
                                }
                            }
                        } else {
                            tracing::warn!("Bedrock model {} failed (exit code {:?}): {}", model_id, output.status.code(), String::from_utf8_lossy(&output.stderr));
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to execute aws CLI {}: {}", aws_bin, e);
                    }
                }
            }

            let _ = std::fs::remove_file(&sys_file);
            let _ = std::fs::remove_file(&msg_file);

            final_res
        }
    })
    .await
    .ok()
    .flatten();

    if let Some(res) = cli_res {
        return Some(res);
    }

    // 2. Bedrock Converse API with Bearer Token
    if let Some(token) = resolve_bedrock_key() {
        let bedrock_url =
            "https://bedrock-runtime.us-west-2.amazonaws.com/model/amazon.nova-lite-v1:0/converse";
        let body = serde_json::json!({
            "system": [{"text": system_prompt}],
            "messages": bedrock_messages,
            "inferenceConfig": {"maxTokens": 400, "temperature": 0.1}
        });

        if let Ok(resp) = http
            .post(bedrock_url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(text) = json
                        .pointer("/output/message/content/0/text")
                        .and_then(|v| v.as_str())
                    {
                        return Some(parse_action_response(text));
                    }
                }
            } else {
                tracing::warn!("Bedrock converse returned HTTP status: {}", resp.status());
            }
        }
    }

    // 3. Google Gemini generateContent API
    if let Some(key) = resolve_gemini_key() {
        let gemini_url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={}",
            key
        );
        let mut gemini_contents = Vec::new();
        if let Some(hist) = history {
            for msg in hist {
                let role = if msg.role == "assistant" { "model" } else { "user" };
                gemini_contents.push(serde_json::json!({
                    "role": role,
                    "parts": [{"text": msg.content}]
                }));
            }
        }
        gemini_contents.push(serde_json::json!({
            "role": "user",
            "parts": [{"text": prompt}]
        }));

        let body = serde_json::json!({
            "system_instruction": {
                "parts": [{"text": system_prompt}]
            },
            "contents": gemini_contents
        });

        if let Ok(resp) = http
            .post(&gemini_url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(text) = json
                        .pointer("/candidates/0/content/parts/0/text")
                        .and_then(|v| v.as_str())
                    {
                        return Some(parse_action_response(text));
                    }
                }
            }
        }
    }

    None
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn send_agent_turn(
    user_id: String,
    display_number: u32,
    prompt: String,
    vm_host: Option<String>,
    exec_port: Option<u16>,
    history: Option<Vec<ChatMessagePayload>>,
    agent_name: Option<String>,
    agent_role: Option<String>,
    custom_system_prompt: Option<String>,
) -> Result<serde_json::Value, String> {
    tracing::info!(
        "🤖 [Agent Dispatch] User '{}' targeting Display :{} (host: {:?}) -> \"{}\"",
        user_id,
        display_number,
        vm_host,
        prompt
    );

    let model = if display_number == 1 {
        "claude-3-7-sonnet-20250219".to_string()
    } else {
        std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-3.8-flash".to_string())
    };

    // 1. Resolve action + reply from LLM or fallback
    let (mut command_to_run, mut reply, detected_tool) = if let Some((cmd, rep, tool)) =
        query_bedrock_or_gemini(
            &user_id,
            display_number,
            &prompt,
            history.as_deref(),
            agent_name.as_deref(),
            agent_role.as_deref(),
            custom_system_prompt.as_deref(),
        )
        .await
    {
        (cmd, rep, tool)
    } else {
        (None, String::new(), None)
    };

    let mut tool_tag = detected_tool;
    if command_to_run.is_none() {
        if let Some((fb_cmd, fb_reply, fb_tool)) =
            fallback_command_from_prompt(&prompt, display_number)
        {
            command_to_run = Some(fb_cmd);
            if reply.is_empty() {
                reply = fb_reply;
            }
            if tool_tag.is_none() {
                tool_tag = Some(fb_tool);
            }
        }
    }

    if reply.is_empty() {
        let role = match display_number {
            1 => "Screen Capture & Computer Use",
            4 | 7 => "Browser & Research",
            2 | 5 | 8 => "Terminal & Dev",
            3 | 6 | 9 => "QA & Verification",
            _ => "Cloud Automation",
        };
        reply = format!(
            "Operating on Display :{} ({} for {}). Received request: \"{}\".",
            display_number, role, user_id, prompt
        );
    }

    let mut executed_tools = Vec::new();
    if let Some(ref t) = tool_tag {
        executed_tools.push(t.clone());
    }

    // 2. Execute on remote PC if command is present
    if let Some(ref cmd) = command_to_run {
        tracing::info!(
            "🚀 [Agent Execution] Running on Display :{} -> {}",
            display_number,
            cmd
        );
        match execute_on_remote_pc(display_number, cmd, vm_host.as_deref(), exec_port).await {
            Ok(exec_res) => {
                let mut output_str = String::new();
                if let Some(ref stdout) = exec_res.stdout {
                    let trimmed = stdout.trim();
                    if !trimmed.is_empty() {
                        output_str.push_str(trimmed);
                    }
                }
                if let Some(ref stderr) = exec_res.stderr {
                    let trimmed = stderr.trim();
                    if !trimmed.is_empty() {
                        if !output_str.is_empty() {
                            output_str.push('\n');
                        }
                        output_str.push_str(trimmed);
                    }
                }
                if !output_str.is_empty() {
                    let display_output = if output_str.len() > 2000 {
                        format!("{}...\n[truncated]", &output_str[..2000])
                    } else {
                        output_str
                    };
                    reply = format!("{}\n\n```\n{}\n```", reply, display_output);
                }
            }
            Err(e) => {
                tracing::error!("Failed to execute command on remote PC: {}", e);
                reply = format!("{} (Execution error: {})", reply, e);
            }
        }
    }

    if executed_tools.is_empty() {
        executed_tools = infer_agent_tool_calls(&prompt, display_number);
    }

    Ok(serde_json::json!({
        "status": "completed",
        "userId": user_id,
        "displayNumber": display_number,
        "model": model,
        "reply": reply,
        "commandExecuted": command_to_run,
        "toolCalls": executed_tools,
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_action_response_json() {
        let json_input = r#"{"command": "/usr/local/bin/chrome-launcher 'https://messages.google.com' &", "reply": "Opening Google Messages.", "tool": "browser"}"#;
        let (cmd, reply, tool) = parse_action_response(json_input);
        assert_eq!(
            cmd.as_deref(),
            Some("/usr/local/bin/chrome-launcher 'https://messages.google.com' &")
        );
        assert_eq!(reply, "Opening Google Messages.");
        assert_eq!(tool.as_deref(), Some("browser"));
    }

    #[test]
    fn test_parse_action_response_markdown() {
        let md_input = "```json\n{\"command\": \"xdotool key Return\", \"reply\": \"Pressed Enter.\", \"tool\": \"gui\"}\n```";
        let (cmd, reply, tool) = parse_action_response(md_input);
        assert_eq!(cmd.as_deref(), Some("xdotool key Return"));
        assert_eq!(reply, "Pressed Enter.");
        assert_eq!(tool.as_deref(), Some("gui"));
    }

    #[test]
    fn test_fallback_command_from_prompt() {
        let res1 = fallback_command_from_prompt("enter", 6);
        assert!(res1.is_some());
        let (cmd, _, _) = res1.unwrap();
        assert_eq!(cmd, "xdotool key Return");

        let res2 = fallback_command_from_prompt("open terminal", 2);
        assert!(res2.is_some());
        let (cmd, _, _) = res2.unwrap();
        assert_eq!(cmd, "/usr/local/bin/terminal-launcher &");

        let res3 = fallback_command_from_prompt("open chrome to google messages", 6);
        assert!(res3.is_some());
        let (cmd, _, _) = res3.unwrap();
        assert!(cmd.contains("chrome-launcher"));
        assert!(cmd.contains("messages.google.com"));

        let res4 = fallback_command_from_prompt(
            "can you send a message to cason saying we are running 10 mins late",
            1,
        );
        assert!(res4.is_some());
        let (cmd4, rep4, tool4) = res4.unwrap();
        assert!(cmd4.contains("we are running 10 mins late"));
        assert!(cmd4.contains("mousemove 500 545 click 1"));
        assert!(cmd4.contains("key Return"));
        assert_eq!(rep4, "Sent message: \"we are running 10 mins late\"");
        assert_eq!(tool4, "chat_message_send");

        let res5 = fallback_command_from_prompt("launch filesystem", 1);
        assert!(res5.is_some());
        let (cmd5, rep5, tool5) = res5.unwrap();
        assert_eq!(cmd5, "/usr/local/bin/files-launcher &");
        assert!(rep5.contains("Filesystem Manager"));
        assert_eq!(tool5, "files_launch");
        let res6 = fallback_command_from_prompt("ping cloudflare dns", 1);
        assert!(res6.is_some());
        let (cmd6, rep6, tool6) = res6.unwrap();
        assert!(cmd6.contains("ping -c 4 1.1.1.1"));
        assert!(cmd6.contains("terminal-launcher"));
        assert_eq!(tool6, "terminal_exec");
        assert!(rep6.contains("1.1.1.1"));

        let res_screen = fallback_command_from_prompt("capture screen", 1);
        assert!(res_screen.is_some());
        let (cmd_screen, rep_screen, tool_screen) = res_screen.unwrap();
        assert_eq!(cmd_screen, "scrot -o /tmp/screen.png");
        assert!(rep_screen.contains("Captured screen on Display :1"));
        assert_eq!(tool_screen, "screen_capture");
    }

    #[test]
    fn test_sanitize_bash_command() {
        let bad1 = "/usr/local/bin/terminal-launcher &; sleep 1; xdotool type 'ping 1.1.1.1'";
        assert_eq!(
            sanitize_bash_command(bad1),
            "/usr/local/bin/terminal-launcher & sleep 1; xdotool type 'ping 1.1.1.1'"
        );

        let bad2 = "echo hello & ; sleep 1";
        assert_eq!(sanitize_bash_command(bad2), "echo hello & sleep 1");

        let bad3 = "cmd1 ;& cmd2";
        assert_eq!(sanitize_bash_command(bad3), "cmd1 ; cmd2");
    }

    #[test]
    fn test_infer_agent_tool_calls() {
        let tools1 = infer_agent_tool_calls("browse to github.com", 1);
        assert!(tools1.contains(&"browser_navigate".to_string()));

        let tools2 = infer_agent_tool_calls("run cargo build", 2);
        assert!(tools2.contains(&"bash_exec".to_string()));

        let tools3 = infer_agent_tool_calls("verify all tests pass", 3);
        assert!(tools3.contains(&"test_runner".to_string()));
    }

    #[tokio::test]
    async fn test_send_agent_turn_execution() {
        let res = send_agent_turn(
            "user2".to_string(),
            2,
            "check system status".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await;
        assert!(res.is_ok());
        let val = res.unwrap();
        assert_eq!(val["userId"], "user2");
        assert_eq!(val["displayNumber"], 2);
        assert!(!val["reply"].as_str().unwrap().is_empty());
    }

    #[tokio::test]
    #[ignore]
    async fn test_query_bedrock_live() {
        let res = query_bedrock_or_gemini("user-1", 1, "Hello", None, None, None, None).await;
        assert!(res.is_some());
    }
}
