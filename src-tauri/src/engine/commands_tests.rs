use super::{
    build_provider_prefill_query, delete_opencode_session_files,
    delete_opencode_session_from_datastore, extract_turn_result_text,
    is_likely_foreign_model_for_gemini, is_likely_legacy_claude_model_id,
    is_valid_claude_model_for_passthrough, merge_opencode_agents, next_gemini_routed_item_id,
    normalize_provider_key, opencode_data_candidate_roots, opencode_session_candidate_paths,
    parse_imported_session_id, parse_json_value, parse_opencode_agent_list,
    parse_opencode_auth_providers, parse_opencode_debug_config_agents,
    parse_opencode_help_commands, parse_opencode_mcp_servers, parse_opencode_session_list,
    parse_opencode_updated_at, provider_keys_match, EngineConfig, GeminiRenderLane,
    GeminiRenderRoutingState, OpenCodeAgentEntry,
};
use chrono::{Local, TimeZone};
use rusqlite::{params, Connection};
use serde_json::json;
use std::path::PathBuf;

#[test]
fn extract_turn_result_text_supports_nested_payload() {
    let payload = json!({
        "result": {
            "response": {
                "content": [
                    { "text": "hello" },
                    { "text": "world" }
                ]
            }
        }
    });
    let text = extract_turn_result_text(Some(&payload));
    assert_eq!(text.as_deref(), Some("hello\nworld"));
}

#[test]
fn extract_turn_result_text_prefers_top_level_text() {
    let payload = json!({
        "text": "final answer",
        "result": { "text": "ignored" }
    });
    let text = extract_turn_result_text(Some(&payload));
    assert_eq!(text.as_deref(), Some("final answer"));
}

#[test]
fn gemini_model_guard_rejects_foreign_engine_defaults() {
    assert!(is_likely_foreign_model_for_gemini("claude-sonnet-4-6"));
    assert!(is_likely_foreign_model_for_gemini("openai/gpt-5.3-codex"));
    assert!(is_likely_foreign_model_for_gemini("gpt-5.1"));
}

#[test]
fn gemini_model_guard_allows_gemini_and_custom_aliases() {
    assert!(!is_likely_foreign_model_for_gemini("gemini-2.5-pro"));
    assert!(!is_likely_foreign_model_for_gemini(
        "[L]gemini-3-pro-preview"
    ));
    assert!(!is_likely_foreign_model_for_gemini("123"));
}

#[test]
fn gemini_routing_segments_text_and_reasoning_runs() {
    let base_item_id = "gemini-item-1";
    let mut state = GeminiRenderRoutingState::default();

    let text_1 = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Text, base_item_id);
    let text_1_cont = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Text, base_item_id);
    let reasoning_1 =
        next_gemini_routed_item_id(&mut state, GeminiRenderLane::Reasoning, base_item_id);
    let reasoning_1_cont =
        next_gemini_routed_item_id(&mut state, GeminiRenderLane::Reasoning, base_item_id);
    let text_2 = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Text, base_item_id);
    let text_2_cont = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Text, base_item_id);
    let _tool = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Tool, base_item_id);
    let reasoning_2 =
        next_gemini_routed_item_id(&mut state, GeminiRenderLane::Reasoning, base_item_id);

    assert_eq!(text_1, "gemini-item-1");
    assert_eq!(text_1_cont, "gemini-item-1");
    assert_eq!(reasoning_1, "gemini-item-1:reasoning-seg-1");
    assert_eq!(reasoning_1_cont, "gemini-item-1:reasoning-seg-1");
    assert_eq!(text_2, "gemini-item-1:text-2");
    assert_eq!(text_2_cont, "gemini-item-1:text-2");
    assert_eq!(reasoning_2, "gemini-item-1:reasoning-seg-2");
}

#[test]
fn gemini_routing_does_not_split_on_other_lane_events() {
    let base_item_id = "gemini-item-2";
    let mut state = GeminiRenderRoutingState::default();

    let text_1 = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Text, base_item_id);
    let _other = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Other, base_item_id);
    let text_1_after_other =
        next_gemini_routed_item_id(&mut state, GeminiRenderLane::Text, base_item_id);

    assert_eq!(text_1, "gemini-item-2");
    assert_eq!(text_1_after_other, "gemini-item-2");
}

#[test]
fn opencode_model_guard_rejects_legacy_claude_ids() {
    assert!(is_likely_legacy_claude_model_id("claude-sonnet-4-6"));
    assert!(is_likely_legacy_claude_model_id("Claude-Haiku-4-5"));
}

#[test]
fn opencode_model_guard_allows_provider_scoped_models() {
    assert!(!is_likely_legacy_claude_model_id("openai/gpt-5.3-codex"));
    assert!(!is_likely_legacy_claude_model_id("google/gemini-2.5-pro"));
    assert!(!is_likely_legacy_claude_model_id("123"));
}

#[test]
fn claude_model_passthrough_accepts_custom_model_ids() {
    assert!(is_valid_claude_model_for_passthrough("GLM-5.1"));
    assert!(is_valid_claude_model_for_passthrough(
        "anthropic/claude-sonnet-4-6"
    ));
    assert!(is_valid_claude_model_for_passthrough("cxn_test.model-v1"));
    assert!(is_valid_claude_model_for_passthrough("claude-opus-4-6[1m]"));
}

#[test]
fn claude_model_passthrough_rejects_invalid_ids() {
    assert!(!is_valid_claude_model_for_passthrough(""));
    assert!(!is_valid_claude_model_for_passthrough(
        "bad model with spaces"
    ));
    assert!(!is_valid_claude_model_for_passthrough("bad\nmodel"));
    assert!(!is_valid_claude_model_for_passthrough("bad\tmodel"));
    assert!(!is_valid_claude_model_for_passthrough(&"a".repeat(129)));
}

#[test]
fn parse_opencode_commands_from_help() {
    let help = r#"
Commands:
  opencode run [message..]     run opencode with a message
  opencode agent               manage agents

Options:
  -h, --help                   show help
"#;
    let commands = parse_opencode_help_commands(help);
    assert!(commands.iter().any(|entry| entry.name == "run"));
    assert!(commands.iter().any(|entry| entry.name == "agent"));
}

#[test]
fn parse_opencode_agents_from_list() {
    let output = r#"
build (primary)
reviewer
"#;
    let agents = parse_opencode_agent_list(output);
    assert!(agents
        .iter()
        .any(|entry| entry.id == "build" && entry.is_primary));
    assert!(agents
        .iter()
        .any(|entry| entry.id == "reviewer" && !entry.is_primary));
}

#[test]
fn parse_opencode_agents_ignores_json_like_noise() {
    let output = r#"
build (primary)
}
},
{
"#;
    let agents = parse_opencode_agent_list(output);
    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0].id, "build");
}

#[test]
fn parse_opencode_debug_config_agents_extracts_all_agent_ids() {
    let output = r#"
{
  "agent": {
    "build": { "mode": "primary", "description": "Build things" },
    "prometheus": { "mode": "all" },
    "hephaestus": { "mode": "primary" },
    "oracle": { "mode": "subagent", "description": "Read-only consultant" }
  }
}
"#;
    let agents = parse_opencode_debug_config_agents(output);
    assert!(agents
        .iter()
        .any(|entry| entry.id == "build" && entry.is_primary));
    assert!(agents
        .iter()
        .any(|entry| entry.id == "prometheus" && !entry.is_primary));
    assert!(agents
        .iter()
        .any(|entry| entry.id == "hephaestus" && entry.is_primary));
    assert!(agents
        .iter()
        .any(|entry| entry.id == "oracle" && !entry.is_primary));
}

#[test]
fn merge_opencode_agents_adds_plugin_agents_and_preserves_primary_flags() {
    let base = vec![OpenCodeAgentEntry {
        id: "build".to_string(),
        description: None,
        is_primary: true,
    }];
    let supplemental = vec![
        OpenCodeAgentEntry {
            id: "prometheus".to_string(),
            description: Some("planner".to_string()),
            is_primary: false,
        },
        OpenCodeAgentEntry {
            id: "build".to_string(),
            description: Some("builder".to_string()),
            is_primary: false,
        },
    ];
    let merged = merge_opencode_agents(base, supplemental);
    assert!(merged.iter().any(|entry| entry.id == "prometheus"));
    assert!(merged
        .iter()
        .any(|entry| entry.id == "build" && entry.is_primary));
    let build = merged
        .iter()
        .find(|entry| entry.id == "build")
        .expect("build should exist");
    assert_eq!(build.description.as_deref(), Some("builder"));
}

#[test]
fn parse_imported_session_id_from_output() {
    let output = "Imported session: ses_12345abc\nExporting session: ses_12345abc";
    assert_eq!(
        parse_imported_session_id(output),
        Some("ses_12345abc".to_string())
    );
}

#[test]
fn parse_json_value_accepts_valid_json() {
    let parsed = parse_json_value("{\"ok\":true,\"items\":[]}");
    assert_eq!(parsed, Some(json!({ "ok": true, "items": [] })));
}

#[test]
fn parse_opencode_auth_list_providers() {
    let output = r#"
┌  Credentials ~/.local/share/opencode/auth.json
│
●  OpenAI oauth
│
●  MiniMax Coding Plan (minimaxi.com) api
│
└  2 credentials
"#;
    let providers = parse_opencode_auth_providers(output);
    assert!(providers.iter().any(|item| item == "openai"));
    assert!(providers.iter().any(|item| item == "minimax coding plan"));
}

#[test]
fn parse_opencode_mcp_servers_empty() {
    let output = r#"
┌  MCP Servers
│
▲  No MCP servers configured
│
└  Add servers with: opencode mcp add
"#;
    let servers = parse_opencode_mcp_servers(output);
    assert!(servers.is_empty());
}

#[test]
fn parse_opencode_session_list_rows() {
    let output = r#"
Session ID                      Title                                            Updated
────────────────────────────────────────────────────────────────────────────────────────
ses_3aab47663ffegTpCFd6UN8ri40  Health check 3 status review                     11:27 AM · 2/13/2026
ses_3aaf6e47cffesEP8ro2EePcJAQ  New session - 2026-02-13T02:24:24.582Z           10:24 AM · 2/13/2026
"#;
    let entries = parse_opencode_session_list(output);
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].session_id, "ses_3aab47663ffegTpCFd6UN8ri40");
    assert_eq!(entries[0].title, "Health check 3 status review");
    assert!(entries[0].updated_at.is_some());
}

#[test]
fn parse_opencode_updated_at_with_date_and_time() {
    let now = Local
        .with_ymd_and_hms(2026, 2, 15, 0, 0, 0)
        .single()
        .expect("valid now");
    let parsed =
        parse_opencode_updated_at("11:27 AM · 2/13/2026", now).expect("updated_at should parse");
    let expected = Local
        .with_ymd_and_hms(2026, 2, 13, 11, 27, 0)
        .single()
        .expect("valid expected")
        .timestamp_millis();
    assert_eq!(parsed, expected);
}

#[test]
fn normalize_provider_key_handles_hyphen_and_spaces() {
    let left = normalize_provider_key("minimax-cn-coding-plan");
    let right = normalize_provider_key("MiniMax Coding Plan");
    assert_ne!(left, right);
    assert!(provider_keys_match(
        "minimax-cn-coding-plan",
        "MiniMax Coding Plan"
    ));
}

#[test]
fn build_provider_prefill_query_uses_search_keywords() {
    assert_eq!(
        build_provider_prefill_query("minimax-cn-coding-plan"),
        Some("minimax".to_string())
    );
    assert_eq!(
        build_provider_prefill_query("z-ai"),
        Some("zhipu".to_string())
    );
    assert_eq!(
        build_provider_prefill_query("openai"),
        Some("openai".to_string())
    );
}

#[test]
fn opencode_session_candidates_include_home_and_workspace() {
    let workspace = PathBuf::from("/tmp/workspace");
    let config = EngineConfig {
        home_dir: Some("/tmp/opencode-home".to_string()),
        ..Default::default()
    };

    let candidates = opencode_session_candidate_paths(&workspace, "ses_123", Some(&config));

    assert!(candidates
        .iter()
        .any(|path| path == &PathBuf::from("/tmp/opencode-home/sessions/ses_123")));
    assert!(candidates
        .iter()
        .any(|path| path == &workspace.join(".opencode").join("sessions").join("ses_123")));
}

#[test]
fn delete_opencode_session_files_rejects_invalid_session_id() {
    let workspace = PathBuf::from("/tmp/workspace");
    let result = delete_opencode_session_files(&workspace, "../bad-id", None);
    assert!(result.is_err());
    assert!(result
        .err()
        .unwrap_or_default()
        .contains("[SESSION_NOT_FOUND]"));
}

#[test]
fn delete_opencode_session_files_removes_workspace_fallback_path() {
    let base = std::env::temp_dir().join(format!(
        "moss-x-opencode-delete-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    let workspace = base.join("workspace");
    let target = workspace
        .join(".opencode")
        .join("sessions")
        .join("ses_test_for_delete");
    std::fs::create_dir_all(&target).expect("should create session directory");

    let result = delete_opencode_session_files(&workspace, "ses_test_for_delete", None);
    assert!(result.is_ok());
    assert!(!target.exists());

    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn opencode_data_candidate_roots_include_xdg_data_path() {
    let workspace = PathBuf::from("/tmp/workspace");
    let config = EngineConfig {
        home_dir: Some("/tmp/opencode-home".to_string()),
        ..Default::default()
    };

    let roots = opencode_data_candidate_roots(&workspace, Some(&config));

    assert!(roots
        .iter()
        .any(|path| path == &PathBuf::from("/tmp/opencode-home")));
    assert!(roots
        .iter()
        .any(|path| path == &workspace.join(".opencode")));
}

#[test]
fn delete_opencode_session_from_datastore_removes_session_and_storage_json() {
    let base = std::env::temp_dir().join(format!(
        "moss-x-opencode-datastore-delete-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&base).expect("should create temp base");
    let db_path = base.join("opencode.db");
    {
        let connection = Connection::open(&db_path).expect("should create sqlite database");
        connection
            .execute_batch(
                r#"
                    PRAGMA foreign_keys = ON;
                    CREATE TABLE session (
                        id TEXT PRIMARY KEY
                    );
                    INSERT INTO session (id) VALUES ('ses_test_for_datastore_delete');
                    "#,
            )
            .expect("should create session table and seed row");
    }

    let reminder_dir = base.join("storage").join("agent-usage-reminder");
    std::fs::create_dir_all(&reminder_dir).expect("should create storage subdir");
    let reminder_file = reminder_dir.join("ses_test_for_datastore_delete.json");
    std::fs::write(&reminder_file, "{}").expect("should write reminder file");

    let result = delete_opencode_session_from_datastore(&base, "ses_test_for_datastore_delete");
    assert!(result.is_ok());
    assert_eq!(result.ok(), Some(true));

    let remaining = Connection::open(&db_path)
        .expect("should reopen sqlite database")
        .query_row(
            "SELECT COUNT(*) FROM session WHERE id = ?1",
            params!["ses_test_for_datastore_delete"],
            |row| row.get::<_, i64>(0),
        )
        .expect("should count remaining rows");
    assert_eq!(remaining, 0);
    assert!(!reminder_file.exists());

    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn remote_claude_doctor_request_normalizes_explicit_bin() {
    let (method, params) = crate::codex::remote_claude_doctor_request(Some(
        "\\\\wsl$\\Ubuntu\\home\\demo\\claude".to_string(),
    ));

    assert_eq!(method, "claude_doctor");
    assert_eq!(params, json!({ "claudeBin": "/home/demo/claude" }));
}
