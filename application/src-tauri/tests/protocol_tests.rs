use frostfire_os_lib::protocol::{WorkstreamCommand, WorkstreamEvent};

#[test]
fn test_protocol_command_serialization() {
    let cmd = WorkstreamCommand::LaunchWorkstream {
        blueprint_id: "sprint-1hour".to_string(),
        workstream_name: "Q3 Sprint".to_string(),
        params: serde_json::json!({"lead": "pm_1"}),
    };

    let json = serde_json::to_string(&cmd).unwrap();
    assert!(json.contains("launch_workstream"));
    assert!(json.contains("blueprint_id"));
    assert!(json.contains("workstream_name"));

    let deserialized: WorkstreamCommand = serde_json::from_str(&json).unwrap();
    match deserialized {
        WorkstreamCommand::LaunchWorkstream { blueprint_id, .. } => {
            assert_eq!(blueprint_id, "sprint-1hour");
        }
        _ => panic!("Wrong variant deserialized"),
    }
}

#[test]
fn test_protocol_event_serialization() {
    let event = WorkstreamEvent::ArtifactPublished {
        uri: "blackboard://ws1/team1/agent1/doc@v1".to_string(),
        title: "Test Plan".to_string(),
        author: "agent1".to_string(),
        version: 1,
        size_bytes: 1024,
    };

    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("artifact_published"));
    assert!(json.contains("size_bytes"));
    assert!(json.contains("author"));

    let deserialized: WorkstreamEvent = serde_json::from_str(&json).unwrap();
    match deserialized {
        WorkstreamEvent::ArtifactPublished { version, .. } => {
            assert_eq!(version, 1);
        }
        _ => panic!("Wrong variant deserialized"),
    }
}

#[test]
fn test_window_config() {
    let conf = r##"{
        "title": "FrostfireOS",
        "theme": "Dark",
        "backgroundColor": "#0d1117"
    }"##;
    let win: tauri::utils::config::WindowConfig = serde_json::from_str(conf).unwrap();
    assert_eq!(win.theme, Some(tauri::Theme::Dark));
    assert_eq!(win.background_color, Some(tauri::window::Color(13, 17, 23, 255)));
}

#[test]
fn test_test_key_response_contract() {
    use frostfire_os_lib::protocol::TestKeyResponse;
    let res = TestKeyResponse {
        success: true,
        latency_ms: 120,
        message: "Google Gemini Verified (200)".to_string(),
        models: vec!["gemini-2.5-flash".to_string(), "gemini-2.0-flash".to_string()],
    };
    let json = serde_json::to_string(&res).unwrap();
    assert!(json.contains("success"));
    assert!(json.contains("latency_ms"));
    assert!(json.contains("message"));
    assert!(json.contains("models"));
    assert!(json.contains("gemini-2.5-flash"));
}


#[test]
fn test_rpc_event_contract() {
    use frostfire_os_lib::protocol::RpcEvent;
    let ev = RpcEvent::TextChunk {
        content: "Hello Gemini".to_string(),
    };
    let json = serde_json::to_string(&ev).unwrap();
    assert!(json.contains("\"type\":\"text_chunk\""));
    assert!(json.contains("\"content\":\"Hello Gemini\""));
}

#[tokio::test]
async fn test_oauth_port_range_binding() {
    use frostfire_os_lib::oauth::OAuthLoopback;
    let res = OAuthLoopback::bind_in_range(8989, 8995).await;
    assert!(res.is_ok());
    let (_loopback, listener, port) = res.unwrap();
    assert!(port >= 8989 && port <= 8995);
    drop(listener);
}

#[tokio::test]
async fn test_models_cache_read_write() {
    let temp_dir = std::env::temp_dir().join(format!("frostfire_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    let _ = tokio::fs::create_dir_all(&temp_dir).await;

    let models = vec!["gemini-2.5-flash".to_string(), "gemini-3.1-pro-preview".to_string()];
    frostfire_os_lib::commands::save_provider_models_to_cache(&temp_dir, "gemini", &models).await;

    let cached = frostfire_os_lib::commands::read_provider_models_from_cache(&temp_dir, "gemini").await;
    assert!(cached.is_some());
    let cached_models = cached.unwrap();
    assert_eq!(cached_models.len(), 2);
    assert_eq!(cached_models[0], "gemini-2.5-flash");

    let all = frostfire_os_lib::commands::read_all_models_from_cache(&temp_dir).await;
    assert!(all.contains_key("gemini"));
    assert_eq!(all["gemini"].len(), 2);

    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
}

#[test]
fn test_web_search_protocol_and_intent() {
    use frostfire_os_lib::protocol::{SearchResult, WorkstreamCommand};
    use frostfire_os_lib::commands::is_search_intent;

    // Test SearchResult serialization
    let res = SearchResult {
        title: "Playwright Testing".to_string(),
        snippet: "Fast and reliable end-to-end testing".to_string(),
        url: "https://playwright.dev".to_string(),
    };
    let json = serde_json::to_string(&res).unwrap();
    assert!(json.contains("Playwright Testing"));
    assert!(json.contains("https://playwright.dev"));

    // Test WebSearch command variant
    let cmd = WorkstreamCommand::WebSearch {
        query: "playwright e2e".to_string(),
    };
    let cmd_json = serde_json::to_string(&cmd).unwrap();
    assert!(cmd_json.contains("web_search"));
    assert!(cmd_json.contains("playwright e2e"));

    // Test search intent detection
    assert!(is_search_intent("/search rust lang"));
    assert!(is_search_intent("/browser nextjs"));
    assert!(is_search_intent("please search the internet for playwright"));
    assert!(is_search_intent("Search the web for react 19"));
    assert!(is_search_intent("search for kubernetes"));
    assert!(!is_search_intent("write a rust function to parse json"));
}


