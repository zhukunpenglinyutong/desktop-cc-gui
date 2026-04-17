use super::*;
use serde_json::json;
use tokio::sync::broadcast::error::TryRecvError;

fn test_workspace_path() -> PathBuf {
    std::env::temp_dir().join("mossx-claude-test-workspace")
}

#[test]
fn build_command_uses_session_id_for_new_conversation_without_continue() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut params = SendMessageParams::default();
    params.text = "hello".to_string();
    params.continue_session = false;
    params.session_id = Some("11111111-1111-4111-8111-111111111111".to_string());

    let command = session.build_command(&params, false);
    let args: Vec<String> = command
        .as_std()
        .get_args()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect();

    assert!(args.windows(2).any(|window| {
        window[0] == "--session-id" && window[1] == "11111111-1111-4111-8111-111111111111"
    }));
    assert!(!args
        .iter()
        .any(|arg| arg == "--continue" || arg == "--resume"));
}

#[test]
fn build_command_uses_resume_when_continue_session_is_enabled() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut params = SendMessageParams::default();
    params.text = "hello".to_string();
    params.continue_session = true;
    params.session_id = Some("22222222-2222-4222-8222-222222222222".to_string());

    let command = session.build_command(&params, false);
    let args: Vec<String> = command
        .as_std()
        .get_args()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect();

    assert!(args.windows(2).any(|window| {
        window[0] == "--resume" && window[1] == "22222222-2222-4222-8222-222222222222"
    }));
    assert!(!args.iter().any(|arg| arg == "--session-id"));
}

#[tokio::test]
async fn session_manager_get_or_create() {
    let manager = ClaudeSessionManager::new();
    let workspace_path = std::env::temp_dir().join("mossx-claude-session-ws1");

    let session1 = manager
        .get_or_create_session("ws-1", workspace_path.as_path())
        .await;
    let session2 = manager
        .get_or_create_session("ws-1", workspace_path.as_path())
        .await;

    // Should return the same session
    assert_eq!(session1.workspace_id, session2.workspace_id);
}

#[test]
fn emit_error_broadcasts_turn_scoped_event() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut receiver = session.subscribe();

    session.emit_error("turn-a", "boom".to_string());

    let received = receiver.try_recv().expect("expected one error event");
    assert_eq!(received.turn_id, "turn-a");
    match received.event {
        EngineEvent::TurnError { error, .. } => assert_eq!(error, "boom"),
        other => panic!("unexpected event: {:?}", other),
    }
    assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
}

#[test]
fn prompt_too_long_detection_matches_common_variants() {
    assert!(ClaudeSession::is_prompt_too_long_error(
        "Prompt is too long"
    ));
    assert!(ClaudeSession::is_prompt_too_long_error(
        "Maximum context length exceeded for this model"
    ));
    assert!(!ClaudeSession::is_prompt_too_long_error(
        "API Error: All providers unavailable"
    ));
}

#[test]
fn prompt_too_long_marker_roundtrip() {
    let marked = ClaudeSession::mark_retryable_prompt_too_long_error("Prompt is too long");
    assert!(marked.starts_with(RETRYABLE_PROMPT_TOO_LONG_PREFIX));
    assert_eq!(
        ClaudeSession::extract_retryable_prompt_too_long_error(&marked),
        Some("Prompt is too long".to_string())
    );
    assert_eq!(
        ClaudeSession::clear_retryable_prompt_too_long_marker(marked),
        "Prompt is too long".to_string()
    );
}

#[test]
fn extract_text_from_content_concatenates_fragmented_blocks() {
    let content = json!([
        {"type": "text", "text": "你"},
        {"type": "text", "text": "好！我"},
        {"type": "text", "text": "是"},
        {"type": "text", "text": "Antigravity"}
    ]);

    let text = extract_text_from_content(&content);
    assert_eq!(text.as_deref(), Some("你好！我是Antigravity"));
}

#[test]
fn convert_event_prefers_combined_text_when_thinking_and_text_coexist() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut receiver = session.subscribe();

    let event = json!({
        "type": "assistant",
        "message": {
            "content": [
                {"type": "thinking", "thinking": "先想一下"},
                {"type": "text", "text": "你"},
                {"type": "text", "text": "好"}
            ]
        }
    });

    let converted = session.convert_event("turn-a", &event);
    match converted {
        Some(EngineEvent::TextDelta { text, .. }) => assert_eq!(text, "你好"),
        other => panic!("expected text delta, got {:?}", other),
    }

    let reasoning_event = receiver
        .try_recv()
        .expect("expected reasoning delta to be emitted");
    assert_eq!(reasoning_event.turn_id, "turn-a");
    match reasoning_event.event {
        EngineEvent::ReasoningDelta { text, .. } => assert_eq!(text, "先想一下"),
        other => panic!("expected reasoning delta, got {:?}", other),
    }
    assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
}

#[test]
fn convert_event_supports_reasoning_block_alias() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);

    let event = json!({
        "type": "assistant",
        "message": {
            "content": [
                {"type": "reasoning", "reasoning": "先分析约束条件"}
            ]
        }
    });

    let converted = session.convert_event("turn-a", &event);
    match converted {
        Some(EngineEvent::ReasoningDelta { text, .. }) => {
            assert_eq!(text, "先分析约束条件")
        }
        other => panic!("expected reasoning delta, got {:?}", other),
    }
}

#[test]
fn convert_event_supports_assistant_message_delta_aliases() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);

    let event = json!({
        "type": "assistant_message_delta",
        "delta": "stream chunk",
    });

    let converted = session.convert_event("turn-a", &event);
    match converted {
        Some(EngineEvent::TextDelta { text, .. }) => assert_eq!(text, "stream chunk"),
        other => panic!("expected text delta, got {:?}", other),
    }
}

#[test]
fn convert_event_maps_system_compacting_to_raw() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let event = json!({
        "type": "system",
        "subtype": "compacting",
        "usage_percent": 95,
    });

    let converted = session.convert_event("turn-a", &event);
    match converted {
        Some(EngineEvent::Raw { engine, data, .. }) => {
            assert!(matches!(engine, EngineType::Claude));
            assert_eq!(data["subtype"], Value::String("compacting".to_string()));
        }
        other => panic!("expected raw compaction signal, got {:?}", other),
    }
}

#[test]
fn convert_event_maps_system_compact_boundary_to_raw() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let event = json!({
        "type": "system",
        "event": "compact_boundary",
    });

    let converted = session.convert_event("turn-a", &event);
    match converted {
        Some(EngineEvent::Raw { engine, data, .. }) => {
            assert!(matches!(engine, EngineType::Claude));
            assert_eq!(data["event"], Value::String("compact_boundary".to_string()));
        }
        other => panic!("expected raw compact boundary signal, got {:?}", other),
    }
}

#[test]
fn convert_event_supports_message_snapshot_aliases() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);

    let first = json!({
        "type": "assistant_message",
        "message": {
            "content": [
                {"type": "text", "text": "你好"},
            ]
        }
    });
    let second = json!({
        "type": "assistant_message",
        "message": {
            "content": [
                {"type": "text", "text": "你好，世界"},
            ]
        }
    });

    match session.convert_event("turn-a", &first) {
        Some(EngineEvent::TextDelta { text, .. }) => assert_eq!(text, "你好"),
        other => panic!("expected first text delta, got {:?}", other),
    }
    match session.convert_event("turn-a", &second) {
        Some(EngineEvent::TextDelta { text, .. }) => assert_eq!(text, "，世界"),
        other => panic!("expected second text delta, got {:?}", other),
    }
}

#[test]
fn parse_claude_stream_json_line_supports_data_prefix() {
    let parsed = parse_claude_stream_json_line(
        "data: {\"type\":\"assistant_message_delta\",\"delta\":\"ok\"}",
    )
    .expect("expected parser to accept data: prefix");
    assert_eq!(
        parsed.get("type").and_then(|value| value.as_str()),
        Some("assistant_message_delta"),
    );
}

#[test]
fn convert_stream_event_supports_reasoning_delta_alias() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);

    let event = json!({
        "type": "stream_event",
        "event": {
            "type": "content_block_delta",
            "delta": {
                "type": "reasoning_delta",
                "reasoning": "先看日志，再定位根因"
            }
        }
    });

    let converted = session.convert_event("turn-a", &event);
    match converted {
        Some(EngineEvent::ReasoningDelta { text, .. }) => {
            assert_eq!(text, "先看日志，再定位根因")
        }
        other => panic!("expected reasoning delta, got {:?}", other),
    }
}

#[test]
fn convert_stream_event_maps_tool_result_text_delta_to_tool_output_delta() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.cache_tool_name("tool-1", "Bash");
    session.cache_tool_block_index("turn-a", 7, "tool-1");

    let event = json!({
        "type": "stream_event",
        "event": {
            "type": "content_block_delta",
            "index": 7,
            "delta": {
                "type": "text_delta",
                "text": "total 12\n"
            }
        }
    });

    let converted = session.convert_event("turn-a", &event);
    match converted {
        Some(EngineEvent::ToolOutputDelta {
            tool_id,
            tool_name,
            delta,
            ..
        }) => {
            assert_eq!(tool_id, "tool-1");
            assert_eq!(tool_name.as_deref(), Some("Bash"));
            assert_eq!(delta, "total 12");
        }
        other => panic!("expected tool output delta, got {:?}", other),
    }
}

#[test]
fn convert_stream_event_caches_tool_result_block_index_before_text_deltas() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.cache_tool_name("tool-42", "Bash");
    session.register_pending_tool("turn-a", "tool-42", "Bash", None);

    let start_event = json!({
        "type": "stream_event",
        "event": {
            "type": "content_block_start",
            "index": 11,
            "content_block": {
                "type": "tool_result",
                "tool_use_id": "tool-42"
            }
        }
    });
    assert!(session.convert_event("turn-a", &start_event).is_none());

    let delta_event = json!({
        "type": "stream_event",
        "event": {
            "type": "content_block_delta",
            "index": 11,
            "delta": {
                "type": "text_delta",
                "text": "README.md\n"
            }
        }
    });

    let converted = session.convert_event("turn-a", &delta_event);
    match converted {
        Some(EngineEvent::ToolOutputDelta { tool_id, delta, .. }) => {
            assert_eq!(tool_id, "tool-42");
            assert_eq!(delta, "README.md");
        }
        other => panic!("expected tool output delta, got {:?}", other),
    }
}

#[test]
fn convert_stream_event_emits_tool_completed_for_tool_result_delta() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.cache_tool_name("tool-55", "Edit");
    session.register_pending_tool("turn-a", "tool-55", "Edit", None);

    let event = json!({
        "type": "stream_event",
        "event": {
            "type": "content_block_delta",
            "index": 5,
            "delta": {
                "type": "tool_result",
                "tool_use_id": "tool-55",
                "content": [{"type": "text", "text": "updated file\n"}]
            }
        }
    });

    let converted = session.convert_event("turn-a", &event);
    match converted {
        Some(EngineEvent::ToolCompleted {
            tool_id,
            tool_name,
            output,
            error,
            ..
        }) => {
            assert_eq!(tool_id, "tool-55");
            assert_eq!(tool_name.as_deref(), Some("Edit"));
            assert_eq!(output, Some(Value::String("updated file".to_string())));
            assert_eq!(error, None);
        }
        other => panic!("expected tool completed, got {:?}", other),
    }
}

#[test]
fn build_tool_completed_embeds_cached_input_with_output() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.cache_tool_name("tool-input", "Bash");
    session.cache_tool_input_value(
        "tool-input",
        &json!({
            "command": "pwd",
            "cwd": "/repo",
        }),
    );

    let converted = session.build_tool_completed("tool-input", Some("/repo".to_string()), false);
    match converted {
        Some(EngineEvent::ToolCompleted {
            output: Some(Value::Object(payload)),
            ..
        }) => {
            assert_eq!(
                payload.get("_output"),
                Some(&Value::String("/repo".to_string()))
            );
            assert_eq!(
                payload.get("_input").and_then(|value| value.get("command")),
                Some(&Value::String("pwd".to_string()))
            );
        }
        other => panic!("expected embedded output payload, got {:?}", other),
    }
}

#[test]
fn extract_tool_result_text_reads_preview_and_loaded_entries() {
    let preview = json!({
        "preview": "settings.local.json"
    });
    assert_eq!(
        extract_tool_result_text(&preview),
        Some("settings.local.json".to_string())
    );

    let loaded = json!({
        "loaded": [
            "/repo/README.md",
            "/repo/package.json"
        ]
    });
    assert_eq!(
        extract_tool_result_text(&loaded),
        Some("/repo/README.md\n/repo/package.json".to_string())
    );
}

#[test]
fn extract_tool_result_text_reads_nested_error_message() {
    let nested_error = json!({
        "error": {
            "message": "Bash requires approval before running this command"
        }
    });

    assert_eq!(
        extract_tool_result_text(&nested_error),
        Some("Bash requires approval before running this command".to_string())
    );
}

#[test]
fn convert_stream_event_falls_back_to_latest_pending_tool_when_result_lacks_identifiers() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.cache_tool_name("tool-latest", "Bash");
    session.register_pending_tool("turn-a", "tool-latest", "Bash", None);

    let start_event = json!({
        "type": "stream_event",
        "event": {
            "type": "content_block_start",
            "index": 12,
            "content_block": {
                "type": "tool_result"
            }
        }
    });
    assert!(session.convert_event("turn-a", &start_event).is_none());

    let delta_event = json!({
        "type": "stream_event",
        "event": {
            "type": "content_block_delta",
            "index": 12,
            "delta": {
                "type": "text_delta",
                "text": "README.md\n"
            }
        }
    });

    let converted = session.convert_event("turn-a", &delta_event);
    match converted {
        Some(EngineEvent::ToolOutputDelta { tool_id, delta, .. }) => {
            assert_eq!(tool_id, "tool-latest");
            assert_eq!(delta, "README.md");
        }
        other => panic!("expected tool output delta, got {:?}", other),
    }
}

#[test]
fn convert_event_reads_transcript_style_tool_output_payload() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.cache_tool_name("tool-99", "bash");
    session.register_pending_tool("turn-a", "tool-99", "bash", None);

    let event = json!({
        "type": "tool_result",
        "tool_use_id": "tool-99",
        "tool_output": {
            "output": "commit-a\ncommit-b\n",
            "exit": 0
        }
    });

    let converted = session.convert_event("turn-a", &event);
    match converted {
        Some(EngineEvent::ToolCompleted {
            tool_id,
            tool_name,
            output,
            error,
            ..
        }) => {
            assert_eq!(tool_id, "tool-99");
            assert_eq!(tool_name.as_deref(), Some("bash"));
            assert_eq!(
                output,
                Some(Value::String("commit-a\ncommit-b".to_string()))
            );
            assert_eq!(error, None);
        }
        other => panic!("expected tool completed, got {:?}", other),
    }
}

#[test]
fn convert_event_matches_transcript_style_tool_result_without_tool_use_id() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let tool_input = json!({
        "command": "git log --oneline -10",
        "description": "查看最近提交"
    });
    session.cache_tool_name("tool-bash-1", "bash");
    session.register_pending_tool("turn-a", "tool-bash-1", "bash", Some(&tool_input));

    let event = json!({
        "type": "tool_result",
        "tool_name": "bash",
        "tool_input": {
            "command": "git log --oneline -10",
            "description": "查看最近提交"
        },
        "tool_output": {
            "output": "commit-a\ncommit-b\n",
            "exit": 0
        }
    });

    let converted = session.convert_event("turn-a", &event);
    match converted {
        Some(EngineEvent::ToolCompleted {
            tool_id,
            tool_name,
            output,
            error,
            ..
        }) => {
            assert_eq!(tool_id, "tool-bash-1");
            assert_eq!(tool_name.as_deref(), Some("bash"));
            assert_eq!(
                output,
                Some(Value::String("commit-a\ncommit-b".to_string()))
            );
            assert_eq!(error, None);
        }
        other => panic!("expected tool completed, got {:?}", other),
    }
}

#[test]
fn convert_event_reads_project_jsonl_user_tool_result_content() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.cache_tool_name("tool-user-1", "Bash");
    session.register_pending_tool("turn-a", "tool-user-1", "Bash", None);

    let event = json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": "tool-user-1",
                "content": "/repo\n",
                "is_error": false
            }]
        }
    });

    let converted = session.convert_event("turn-a", &event);
    match converted {
        Some(EngineEvent::ToolCompleted {
            tool_id,
            tool_name,
            output,
            error,
            ..
        }) => {
            assert_eq!(tool_id, "tool-user-1");
            assert_eq!(tool_name.as_deref(), Some("Bash"));
            assert_eq!(output, Some(Value::String("/repo".to_string())));
            assert_eq!(error, None);
        }
        other => panic!("expected tool completed, got {:?}", other),
    }
}

#[test]
fn convert_event_preserves_read_input_for_project_jsonl_user_tool_result() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);

    let start_event = json!({
        "type": "assistant",
        "message": {
            "content": [{
                "type": "tool_use",
                "id": "read-tool-1",
                "name": "Read",
                "input": {
                    "file_path": "/repo/README.md"
                }
            }]
        }
    });

    match session.convert_event("turn-a", &start_event) {
        Some(EngineEvent::ToolStarted { tool_id, input, .. }) => {
            assert_eq!(tool_id, "read-tool-1");
            assert_eq!(
                input.as_ref().and_then(|value| value.get("file_path")),
                Some(&Value::String("/repo/README.md".to_string()))
            );
        }
        other => panic!("expected tool started, got {:?}", other),
    }

    let completed_event = json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": "read-tool-1",
                "content": "     1→hello world\n"
            }]
        }
    });

    match session.convert_event("turn-a", &completed_event) {
        Some(EngineEvent::ToolCompleted {
            tool_id,
            output: Some(Value::Object(payload)),
            ..
        }) => {
            assert_eq!(tool_id, "read-tool-1");
            assert_eq!(
                payload
                    .get("_input")
                    .and_then(|value| value.get("file_path")),
                Some(&Value::String("/repo/README.md".to_string()))
            );
            assert_eq!(
                payload.get("_output"),
                Some(&Value::String("1→hello world".to_string()))
            );
        }
        other => panic!("expected embedded read payload, got {:?}", other),
    }
}

#[test]
fn convert_event_reads_project_jsonl_user_tool_result_stdout_fallback() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.cache_tool_name("tool-user-stdout", "Bash");
    session.register_pending_tool("turn-a", "tool-user-stdout", "Bash", None);

    let event = json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": "tool-user-stdout",
                "content": "",
                "is_error": false
            }]
        },
        "toolUseResult": {
            "stdout": "total 32\n-rw-r--r-- README.md\n",
            "stderr": ""
        }
    });

    let converted = session.convert_event("turn-a", &event);
    match converted {
        Some(EngineEvent::ToolCompleted {
            tool_id,
            tool_name,
            output,
            error,
            ..
        }) => {
            assert_eq!(tool_id, "tool-user-stdout");
            assert_eq!(tool_name.as_deref(), Some("Bash"));
            assert_eq!(
                output,
                Some(Value::String("total 32\n-rw-r--r-- README.md".to_string()))
            );
            assert_eq!(error, None);
        }
        other => panic!("expected tool completed, got {:?}", other),
    }
}

#[test]
fn convert_event_emits_synthetic_file_change_approval_request_for_claude_permission_error() {
    let demo_file_path = std::env::temp_dir().join("demo.txt");
    let demo_file_path_str = demo_file_path.to_string_lossy().to_string();
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut receiver = session.subscribe();

    session.cache_tool_name("tool-write-1", "Write");
    session.cache_tool_input_value(
        "tool-write-1",
        &json!({
            "file_path": demo_file_path_str.clone(),
            "content": "hello"
        }),
    );
    session.register_pending_tool("turn-a", "tool-write-1", "Write", None);

    let event = json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": "tool-write-1",
                "content": format!(
                    "Claude requested permissions to write to {}, but you haven't granted it yet.",
                    demo_file_path.display()
                ),
                "is_error": true
            }]
        }
    });

    let converted = session.convert_event("turn-a", &event);
    let approval = receiver
        .try_recv()
        .expect("expected approval request event");
    match approval.event {
        EngineEvent::ApprovalRequest {
            request_id,
            tool_name,
            input,
            ..
        } => {
            assert_eq!(request_id, Value::String("tool-write-1".to_string()));
            assert_eq!(tool_name, "Write");
            assert_eq!(
                input.as_ref().and_then(|value| value.get("file_path")),
                Some(&Value::String(demo_file_path_str))
            );
        }
        other => panic!("expected approval request, got {:?}", other),
    }

    assert!(converted.is_none());
}

#[test]
fn convert_event_emits_synthetic_file_change_approval_request_for_generic_permission_denial() {
    let demo_dir_path = std::env::temp_dir().join("demo-dir");
    let demo_dir_path_str = demo_dir_path.to_string_lossy().to_string();
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut receiver = session.subscribe();

    session.cache_tool_name("tool-mkdir-1", "CreateDirectory");
    session.cache_tool_input_value(
        "tool-mkdir-1",
        &json!({
            "path": demo_dir_path_str.clone()
        }),
    );
    session.register_pending_tool("turn-a", "tool-mkdir-1", "CreateDirectory", None);

    let event = json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": "tool-mkdir-1",
                "content": "Permission denied while waiting for approval.",
                "is_error": true
            }]
        }
    });

    let converted = session.convert_event("turn-a", &event);
    let approval = receiver
        .try_recv()
        .expect("expected approval request event");
    match approval.event {
        EngineEvent::ApprovalRequest {
            request_id,
            tool_name,
            input,
            ..
        } => {
            assert_eq!(request_id, Value::String("tool-mkdir-1".to_string()));
            assert_eq!(tool_name, "CreateDirectory");
            assert_eq!(
                input.as_ref().and_then(|value| value.get("path")),
                Some(&Value::String(demo_dir_path_str))
            );
        }
        other => panic!("expected approval request, got {:?}", other),
    }

    assert!(converted.is_none());
}

#[test]
fn synthetic_claude_command_denial_maps_to_mode_blocked_signal() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);

    session.cache_tool_name("tool-bash-1", "Bash");
    session.cache_tool_input_value(
        "tool-bash-1",
        &json!({
            "command": "tee demo.txt <<< hello",
            "description": "Create file using tee"
        }),
    );
    session.register_pending_tool("turn-a", "tool-bash-1", "Bash", None);

    let event = json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": "tool-bash-1",
                "content": "This command requires approval",
                "is_error": true
            }]
        }
    });

    let converted = session.convert_event("turn-a", &event);
    match converted {
        Some(EngineEvent::Raw { data, .. }) => {
            assert_eq!(
                data.get("blockedMethod").and_then(|value| value.as_str()),
                Some("item/commandExecution/requestApproval")
            );
            assert_eq!(
                data.get("reasonCode").and_then(|value| value.as_str()),
                Some("claude_command_execution_permission_denied")
            );
            assert_eq!(
                data.get("requestId").and_then(|value| value.as_str()),
                Some("tool-bash-1")
            );
        }
        other => panic!("expected raw mode-blocked signal, got {:?}", other),
    }
    assert!(!session.has_pending_approval_request(&Value::String("tool-bash-1".to_string())));
}

#[test]
fn synthetic_claude_rm_command_denial_emits_file_approval_request() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut receiver = session.subscribe();

    session.cache_tool_name("tool-bash-rm", "Bash");
    session.cache_tool_input_value(
        "tool-bash-rm",
        &json!({
            "command": "rm .specify目录结构说明.md",
            "description": "Delete a workspace file"
        }),
    );
    session.register_pending_tool("turn-rm", "tool-bash-rm", "Bash", None);

    let event = json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": "tool-bash-rm",
                "content": "rm command was blocked for security because it may only write to files in the allowed working directories.",
                "is_error": true
            }]
        }
    });

    let converted = session.convert_event("turn-rm", &event);
    assert!(converted.is_none());

    let approval = receiver
        .try_recv()
        .expect("expected approval request event");
    match approval.event {
        EngineEvent::ApprovalRequest {
            request_id,
            tool_name,
            input,
            ..
        } => {
            assert_eq!(request_id, Value::String("tool-bash-rm".to_string()));
            assert_eq!(tool_name, "Bash");
            assert_eq!(
                input.as_ref().and_then(|value| value.get("command")),
                Some(&Value::String("rm .specify目录结构说明.md".to_string()))
            );
        }
        other => panic!("expected approval request, got {:?}", other),
    }
}

#[tokio::test]
async fn synthetic_claude_file_approval_accept_writes_file_and_emits_completion() {
    let workspace_root =
        std::env::temp_dir().join(format!("mossx-claude-approval-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&workspace_root).expect("create temp workspace");
    let file_path = workspace_root.join("approved.txt");

    let session = ClaudeSession::new("test-workspace".to_string(), workspace_root.clone(), None);
    let mut receiver = session.subscribe();

    session.cache_tool_name("tool-write-accept", "Write");
    session.cache_tool_input_value(
        "tool-write-accept",
        &json!({
            "file_path": file_path.to_string_lossy(),
            "content": "hello approval"
        }),
    );
    session.register_pending_tool("turn-accept", "tool-write-accept", "Write", None);
    session
        .pending_approval_requests
        .lock()
        .expect("pending approvals lock")
        .insert("tool-write-accept".to_string(), "turn-accept".to_string());

    session
        .respond_to_approval_request(
            Value::String("tool-write-accept".to_string()),
            Value::String("accept".to_string()),
        )
        .await
        .expect("approval should succeed");

    let completion = receiver.try_recv().expect("expected tool completion event");
    match completion.event {
        EngineEvent::ToolCompleted {
            tool_id,
            tool_name,
            output,
            error,
            ..
        } => {
            assert_eq!(tool_id, "tool-write-accept");
            assert_eq!(tool_name.as_deref(), Some("Write"));
            assert_eq!(error, None);
            assert_eq!(
                output
                    .as_ref()
                    .and_then(|value| value.get("_output"))
                    .and_then(Value::as_str),
                Some("Approved and wrote approved.txt")
            );
        }
        other => panic!("expected tool completed event, got {:?}", other),
    }

    assert_eq!(
        std::fs::read_to_string(&file_path).expect("file should exist"),
        "hello approval"
    );
    let _ = std::fs::remove_dir_all(&workspace_root);
}

#[tokio::test]
async fn synthetic_claude_file_approval_decline_does_not_write_file() {
    let workspace_root =
        std::env::temp_dir().join(format!("mossx-claude-approval-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&workspace_root).expect("create temp workspace");
    let file_path = workspace_root.join("declined.txt");

    let session = ClaudeSession::new("test-workspace".to_string(), workspace_root.clone(), None);
    let mut receiver = session.subscribe();

    session.cache_tool_name("tool-write-decline", "Write");
    session.cache_tool_input_value(
        "tool-write-decline",
        &json!({
            "file_path": file_path.to_string_lossy(),
            "content": "should not exist"
        }),
    );
    session.register_pending_tool("turn-decline", "tool-write-decline", "Write", None);
    session
        .pending_approval_requests
        .lock()
        .expect("pending approvals lock")
        .insert("tool-write-decline".to_string(), "turn-decline".to_string());

    session
        .respond_to_approval_request(
            Value::String("tool-write-decline".to_string()),
            Value::String("decline".to_string()),
        )
        .await
        .expect("decline should succeed");

    let completion = receiver.try_recv().expect("expected tool completion event");
    match completion.event {
        EngineEvent::ToolCompleted {
            tool_id,
            output,
            error,
            ..
        } => {
            assert_eq!(tool_id, "tool-write-decline");
            assert_eq!(
                output
                    .as_ref()
                    .and_then(|value| value.get("_output"))
                    .and_then(Value::as_str),
                Some("File change was declined in the approval dialog.")
            );
            assert_eq!(
                error.as_deref(),
                Some("File change was declined in the approval dialog.")
            );
        }
        other => panic!("expected tool completed event, got {:?}", other),
    }

    assert!(!file_path.exists());
    let _ = std::fs::remove_dir_all(&workspace_root);
}

#[tokio::test]
async fn synthetic_claude_file_approval_accept_supports_object_decision_payload() {
    let workspace_root =
        std::env::temp_dir().join(format!("mossx-claude-approval-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&workspace_root).expect("create temp workspace");
    let file_path = workspace_root.join("object-decision.txt");

    let session = ClaudeSession::new("test-workspace".to_string(), workspace_root.clone(), None);

    session.cache_tool_name("tool-write-object", "Write");
    session.cache_tool_input_value(
        "tool-write-object",
        &json!({
            "file_path": file_path.to_string_lossy(),
            "content": "object payload"
        }),
    );
    session.register_pending_tool("turn-object", "tool-write-object", "Write", None);
    session
        .pending_approval_requests
        .lock()
        .expect("pending approvals lock")
        .insert("tool-write-object".to_string(), "turn-object".to_string());

    session
        .respond_to_approval_request(
            Value::String("tool-write-object".to_string()),
            json!({ "decision": "accept" }),
        )
        .await
        .expect("approval should accept object decision payload");

    assert_eq!(
        std::fs::read_to_string(&file_path).expect("file should exist"),
        "object payload"
    );
    let _ = std::fs::remove_dir_all(&workspace_root);
}

#[tokio::test]
async fn synthetic_claude_edit_approval_accept_replaces_expected_text() {
    let workspace_root =
        std::env::temp_dir().join(format!("mossx-claude-approval-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&workspace_root).expect("create temp workspace");
    let file_path = workspace_root.join("edit-target.txt");
    std::fs::write(&file_path, "hello old world").expect("seed file");

    let session = ClaudeSession::new("test-workspace".to_string(), workspace_root.clone(), None);

    session.cache_tool_name("tool-edit-accept", "Edit");
    session.cache_tool_input_value(
        "tool-edit-accept",
        &json!({
            "file_path": file_path.to_string_lossy(),
            "old_string": "old",
            "new_string": "new"
        }),
    );
    session.register_pending_tool("turn-edit", "tool-edit-accept", "Edit", None);
    session
        .pending_approval_requests
        .lock()
        .expect("pending approvals lock")
        .insert("tool-edit-accept".to_string(), "turn-edit".to_string());

    session
        .respond_to_approval_request(
            Value::String("tool-edit-accept".to_string()),
            Value::String("accept".to_string()),
        )
        .await
        .expect("edit approval should succeed");

    assert_eq!(
        std::fs::read_to_string(&file_path).expect("file should exist"),
        "hello new world"
    );
    let _ = std::fs::remove_dir_all(&workspace_root);
}

#[tokio::test]
async fn synthetic_claude_multiedit_approval_accept_applies_structured_edits() {
    let workspace_root =
        std::env::temp_dir().join(format!("mossx-claude-approval-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&workspace_root).expect("create temp workspace");
    let file_path = workspace_root.join("multiedit-target.txt");
    std::fs::write(&file_path, "alpha beta beta\ngamma").expect("seed file");

    let session = ClaudeSession::new("test-workspace".to_string(), workspace_root.clone(), None);

    session.cache_tool_name("tool-multiedit-accept", "MultiEdit");
    session.cache_tool_input_value(
        "tool-multiedit-accept",
        &json!({
            "file_path": file_path.to_string_lossy(),
            "edits": [
                {
                    "old_string": "beta",
                    "new_string": "delta",
                    "replace_all": true
                },
                {
                    "old_string": "gamma",
                    "new_string": "omega"
                }
            ]
        }),
    );
    session.register_pending_tool("turn-multiedit", "tool-multiedit-accept", "MultiEdit", None);
    session
        .pending_approval_requests
        .lock()
        .expect("pending approvals lock")
        .insert(
            "tool-multiedit-accept".to_string(),
            "turn-multiedit".to_string(),
        );

    session
        .respond_to_approval_request(
            Value::String("tool-multiedit-accept".to_string()),
            Value::String("accept".to_string()),
        )
        .await
        .expect("multiedit approval should succeed");

    assert_eq!(
        std::fs::read_to_string(&file_path).expect("file should exist"),
        "alpha delta delta\nomega"
    );
    let _ = std::fs::remove_dir_all(&workspace_root);
}

#[tokio::test]
async fn synthetic_claude_delete_approval_accept_removes_file() {
    let workspace_root =
        std::env::temp_dir().join(format!("mossx-claude-approval-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&workspace_root).expect("create temp workspace");
    let file_path = workspace_root.join("delete-target.txt");
    std::fs::write(&file_path, "remove me").expect("seed file");

    let session = ClaudeSession::new("test-workspace".to_string(), workspace_root.clone(), None);

    session.cache_tool_name("tool-delete-accept", "Delete");
    session.cache_tool_input_value(
        "tool-delete-accept",
        &json!({
            "file_path": file_path.to_string_lossy()
        }),
    );
    session.register_pending_tool("turn-delete", "tool-delete-accept", "Delete", None);
    session
        .pending_approval_requests
        .lock()
        .expect("pending approvals lock")
        .insert("tool-delete-accept".to_string(), "turn-delete".to_string());

    session
        .respond_to_approval_request(
            Value::String("tool-delete-accept".to_string()),
            Value::String("accept".to_string()),
        )
        .await
        .expect("delete approval should succeed");

    assert!(!file_path.exists());
    let _ = std::fs::remove_dir_all(&workspace_root);
}

#[tokio::test]
async fn synthetic_claude_rm_command_approval_accept_removes_file() {
    let workspace_root =
        std::env::temp_dir().join(format!("mossx-claude-approval-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&workspace_root).expect("create temp workspace");
    let file_path = workspace_root.join(".specify目录结构说明.md");
    std::fs::write(&file_path, "remove me").expect("seed file");

    let session = ClaudeSession::new("test-workspace".to_string(), workspace_root.clone(), None);

    session.cache_tool_name("tool-rm-accept", "Bash");
    session.cache_tool_input_value(
        "tool-rm-accept",
        &json!({
            "command": "rm .specify目录结构说明.md"
        }),
    );
    session.register_pending_tool("turn-rm", "tool-rm-accept", "Bash", None);
    session
        .pending_approval_requests
        .lock()
        .expect("pending approvals lock")
        .insert("tool-rm-accept".to_string(), "turn-rm".to_string());

    session
        .respond_to_approval_request(
            Value::String("tool-rm-accept".to_string()),
            Value::String("accept".to_string()),
        )
        .await
        .expect("rm approval should succeed");

    assert!(!file_path.exists(), "file should be removed");
    let _ = std::fs::remove_dir_all(&workspace_root);
}

#[tokio::test]
async fn synthetic_claude_file_approval_accept_emits_turn_completed_after_tool_completion() {
    let workspace_root =
        std::env::temp_dir().join(format!("mossx-claude-approval-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&workspace_root).expect("create temp workspace");
    let file_path = workspace_root.join("turn-finished.txt");

    let session = ClaudeSession::new("test-workspace".to_string(), workspace_root.clone(), None);
    let mut receiver = session.subscribe();

    session.cache_tool_name("tool-write-finish", "Write");
    session.cache_tool_input_value(
        "tool-write-finish",
        &json!({
            "file_path": file_path.to_string_lossy(),
            "content": "done"
        }),
    );
    session.register_pending_tool("turn-finish", "tool-write-finish", "Write", None);
    session
        .pending_approval_requests
        .lock()
        .expect("pending approvals lock")
        .insert("tool-write-finish".to_string(), "turn-finish".to_string());

    session
        .respond_to_approval_request(
            Value::String("tool-write-finish".to_string()),
            Value::String("accept".to_string()),
        )
        .await
        .expect("approval should succeed");

    let first = receiver.try_recv().expect("expected tool completion event");
    match first.event {
        EngineEvent::ToolCompleted { tool_id, .. } => {
            assert_eq!(tool_id, "tool-write-finish");
        }
        other => panic!("expected tool completed event, got {:?}", other),
    }

    let second = receiver.try_recv().expect("expected turn completed event");
    match second.event {
        EngineEvent::TurnCompleted { result, .. } => {
            assert_eq!(
                result
                    .as_ref()
                    .and_then(|value| value.get("syntheticApprovalResolved"))
                    .and_then(Value::as_bool),
                Some(true)
            );
            assert_eq!(
                result
                    .as_ref()
                    .and_then(|value| value.get("approved"))
                    .and_then(Value::as_bool),
                Some(true)
            );
        }
        other => panic!("expected turn completed event, got {:?}", other),
    }

    assert!(!session.has_pending_approval_request(&Value::String("tool-write-finish".to_string())));
    let _ = std::fs::remove_dir_all(&workspace_root);
}

#[tokio::test]
async fn synthetic_claude_multiple_file_approvals_only_finalize_after_last_one() {
    let workspace_root =
        std::env::temp_dir().join(format!("mossx-claude-approval-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&workspace_root).expect("create temp workspace");
    let first_file = workspace_root.join("first.txt");
    let second_file = workspace_root.join("second.txt");

    let session = ClaudeSession::new("test-workspace".to_string(), workspace_root.clone(), None);
    let mut receiver = session.subscribe();

    session.cache_tool_name("tool-write-first", "Write");
    session.cache_tool_input_value(
        "tool-write-first",
        &json!({
            "file_path": first_file.to_string_lossy(),
            "content": "one"
        }),
    );
    session.register_pending_tool("turn-multi", "tool-write-first", "Write", None);
    session
        .pending_approval_requests
        .lock()
        .expect("pending approvals lock")
        .insert("tool-write-first".to_string(), "turn-multi".to_string());

    session.cache_tool_name("tool-write-second", "Write");
    session.cache_tool_input_value(
        "tool-write-second",
        &json!({
            "file_path": second_file.to_string_lossy(),
            "content": "two"
        }),
    );
    session.register_pending_tool("turn-multi", "tool-write-second", "Write", None);
    session
        .pending_approval_requests
        .lock()
        .expect("pending approvals lock")
        .insert("tool-write-second".to_string(), "turn-multi".to_string());

    session
        .respond_to_approval_request(
            Value::String("tool-write-first".to_string()),
            Value::String("accept".to_string()),
        )
        .await
        .expect("first approval should succeed");

    let first_event = receiver.try_recv().expect("expected first tool completion");
    match first_event.event {
        EngineEvent::ToolCompleted { tool_id, .. } => {
            assert_eq!(tool_id, "tool-write-first");
        }
        other => panic!("expected first tool completed event, got {:?}", other),
    }
    assert!(receiver.try_recv().is_err());
    assert!(session.has_pending_approval_request(&Value::String("tool-write-second".to_string())));

    session
        .respond_to_approval_request(
            Value::String("tool-write-second".to_string()),
            Value::String("accept".to_string()),
        )
        .await
        .expect("second approval should succeed");

    let second_event = receiver
        .try_recv()
        .expect("expected second tool completion");
    match second_event.event {
        EngineEvent::ToolCompleted { tool_id, .. } => {
            assert_eq!(tool_id, "tool-write-second");
        }
        other => panic!("expected second tool completed event, got {:?}", other),
    }

    let final_event = receiver.try_recv().expect("expected final turn completion");
    match final_event.event {
        EngineEvent::TurnCompleted { result, .. } => {
            assert_eq!(
                result
                    .as_ref()
                    .and_then(|value| value.get("syntheticApprovalResolved"))
                    .and_then(Value::as_bool),
                Some(true)
            );
            let summary = result
                .as_ref()
                .and_then(|value| value.get("text"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            assert!(summary.contains("Approved and wrote first.txt"));
            assert!(summary.contains("Approved and wrote second.txt"));
        }
        other => panic!("expected turn completed event, got {:?}", other),
    }

    assert_eq!(
        std::fs::read_to_string(&first_file).expect("first file should exist"),
        "one"
    );
    assert_eq!(
        std::fs::read_to_string(&second_file).expect("second file should exist"),
        "two"
    );
    let _ = std::fs::remove_dir_all(&workspace_root);
}

#[test]
fn convert_event_matches_tool_result_without_id_or_name_to_latest_pending_tool() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.cache_tool_name("tool-fallback", "bash");
    session.register_pending_tool("turn-a", "tool-fallback", "bash", None);

    let event = json!({
        "type": "tool_result",
        "tool_output": {
            "output": "ok\n",
            "exit": 0
        }
    });

    let converted = session.convert_event("turn-a", &event);
    match converted {
        Some(EngineEvent::ToolCompleted {
            tool_id,
            tool_name,
            output,
            error,
            ..
        }) => {
            assert_eq!(tool_id, "tool-fallback");
            assert_eq!(tool_name.as_deref(), Some("bash"));
            assert_eq!(output, Some(Value::String("ok".to_string())));
            assert_eq!(error, None);
        }
        other => panic!("expected tool completed, got {:?}", other),
    }
}

#[test]
fn convert_event_maps_shell_command_permission_denial_to_mode_blocked() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);

    session.cache_tool_name("tool-shell-1", "ShellCommand");
    session.cache_tool_input_value(
        "tool-shell-1",
        &json!({
            "command": "echo hello > demo.txt",
        }),
    );
    session.register_pending_tool("turn-shell", "tool-shell-1", "ShellCommand", None);

    let event = json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": "tool-shell-1",
                "content": "This command was blocked for security because it may only write to files in the allowed working directories.",
                "is_error": true
            }]
        }
    });

    let converted = session.convert_event("turn-shell", &event);
    match converted {
        Some(EngineEvent::Raw { data, .. }) => {
            assert_eq!(
                data.get("blockedMethod").and_then(|value| value.as_str()),
                Some("item/commandExecution/requestApproval")
            );
            assert_eq!(
                data.get("reasonCode").and_then(|value| value.as_str()),
                Some("claude_command_execution_permission_denied")
            );
        }
        other => panic!("expected raw mode-blocked signal, got {:?}", other),
    }
}

#[test]
fn convert_event_maps_nested_tool_use_result_error_to_mode_blocked() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);

    session.cache_tool_name("tool-native-nested", "native_command");
    session.register_pending_tool(
        "turn-native-nested",
        "tool-native-nested",
        "native_command",
        Some(&json!({ "command": "mkdir protected" })),
    );

    let event = json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": "tool-native-nested",
                "content": ""
            }]
        },
        "toolUseResult": {
            "error": {
                "message": "Native command requires permission because it is blocked for security."
            }
        }
    });

    let converted = session.convert_event("turn-native-nested", &event);
    match converted {
        Some(EngineEvent::Raw { data, .. }) => {
            assert_eq!(
                data.get("blockedMethod").and_then(|value| value.as_str()),
                Some("item/commandExecution/requestApproval")
            );
            assert_eq!(
                data.get("reasonCode").and_then(|value| value.as_str()),
                Some("claude_command_execution_permission_denied")
            );
            assert_eq!(
                data.get("toolName").and_then(|value| value.as_str()),
                Some("native_command")
            );
        }
        other => panic!("expected raw mode-blocked signal, got {:?}", other),
    }
}

#[test]
fn convert_event_matches_most_recent_same_name_tool_when_input_missing() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.cache_tool_name("tool-bash-older", "bash");
    session.register_pending_tool(
        "turn-a",
        "tool-bash-older",
        "bash",
        Some(&json!({ "command": "pwd" })),
    );
    session.cache_tool_name("tool-bash-newer", "bash");
    session.register_pending_tool(
        "turn-a",
        "tool-bash-newer",
        "bash",
        Some(&json!({ "command": "find . -name \"*.py\"" })),
    );

    let event = json!({
        "type": "tool_result",
        "tool_name": "bash",
        "tool_output": {
            "output": "42\n",
            "exit": 0
        }
    });

    let converted = session.convert_event("turn-a", &event);
    match converted {
        Some(EngineEvent::ToolCompleted {
            tool_id, output, ..
        }) => {
            assert_eq!(tool_id, "tool-bash-newer");
            assert_eq!(output, Some(Value::String("42".to_string())));
        }
        other => panic!("expected tool completed, got {:?}", other),
    }
}

#[test]
fn build_mode_blocked_signal_from_error_maps_claude_ask_user_question_denial() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.register_pending_tool("turn-a", "tool-ask-1", "AskUserQuestion", None);

    let event = session
        .build_mode_blocked_signal_from_error("turn-a", "AskUserQuestion tool permission denied")
        .expect("expected mode blocked signal");

    match event {
        EngineEvent::Raw { data, .. } => {
            assert_eq!(
                data.get("blockedMethod").and_then(|value| value.as_str()),
                Some("item/tool/requestUserInput")
            );
            assert_eq!(
                data.get("requestId").and_then(|value| value.as_str()),
                Some("tool-ask-1")
            );
            assert_eq!(
                data.get("reasonCode").and_then(|value| value.as_str()),
                Some("claude_ask_user_question_permission_denied")
            );
        }
        other => panic!("expected raw mode-blocked signal, got {:?}", other),
    }
}

#[test]
fn build_mode_blocked_signal_from_error_maps_claude_file_change_denial_to_approval_request() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.register_pending_tool(
        "turn-a",
        "tool-edit-1",
        "Edit",
        Some(&json!({
            "file_path": "demo.txt",
            "content": "hello from fallback"
        })),
    );
    session.cache_tool_name("tool-edit-1", "Edit");
    session.cache_tool_input_value(
        "tool-edit-1",
        &json!({
            "file_path": "demo.txt",
            "content": "hello from fallback"
        }),
    );

    let event = session
        .build_mode_blocked_signal_from_error("turn-a", "Edit tool permission denied")
        .expect("expected approval request");

    match event {
        EngineEvent::ApprovalRequest {
            request_id,
            tool_name,
            input,
            message,
            ..
        } => {
            assert_eq!(
                request_id,
                Value::String("tool-edit-1".to_string())
            );
            assert_eq!(tool_name, "Edit");
            assert_eq!(
                input,
                Some(json!({
                    "file_path": "demo.txt",
                    "content": "hello from fallback"
                }))
            );
            assert_eq!(
                message.as_deref(),
                Some(
                    "Approve to let the GUI apply this file change locally. Preview currently supports structured file tools plus safe single-path file commands."
                )
            );
        }
        other => panic!("expected approval request, got {:?}", other),
    }
}

#[test]
fn build_mode_blocked_signal_from_error_maps_claude_command_denial() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.register_pending_tool("turn-a", "tool-bash-1", "Bash", None);

    let event = session
            .build_mode_blocked_signal_from_error(
                "turn-a",
                "Output redirection was blocked. For security, Claude Code may only write to files in the allowed working directories for this session.",
            )
            .expect("expected mode blocked signal");

    match event {
        EngineEvent::Raw { data, .. } => {
            assert_eq!(
                data.get("blockedMethod").and_then(|value| value.as_str()),
                Some("item/commandExecution/requestApproval")
            );
            assert_eq!(
                data.get("requestId").and_then(|value| value.as_str()),
                Some("tool-bash-1")
            );
            assert_eq!(
                data.get("reasonCode").and_then(|value| value.as_str()),
                Some("claude_command_execution_permission_denied")
            );
        }
        other => panic!("expected raw mode-blocked signal, got {:?}", other),
    }
}

#[test]
fn build_mode_blocked_signal_from_error_maps_native_command_denial() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.register_pending_tool("turn-a", "tool-native-1", "NativeCommand", None);

    let event = session
            .build_mode_blocked_signal_from_error(
                "turn-a",
                "Native command requires permission to access protected paths in the allowed working directories.",
            )
            .expect("expected mode blocked signal");

    match event {
        EngineEvent::Raw { data, .. } => {
            assert_eq!(
                data.get("blockedMethod").and_then(|value| value.as_str()),
                Some("item/commandExecution/requestApproval")
            );
            assert_eq!(
                data.get("requestId").and_then(|value| value.as_str()),
                Some("tool-native-1")
            );
            assert_eq!(
                data.get("toolName").and_then(|value| value.as_str()),
                Some("NativeCommand")
            );
        }
        other => panic!("expected raw mode-blocked signal, got {:?}", other),
    }
}

#[test]
fn convert_error_event_maps_command_permission_denial_to_mode_blocked() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.register_pending_tool("turn-error", "tool-exec-1", "ExecuteCommand", None);

    let event = json!({
        "type": "error",
        "error": {
            "message": "ExecuteCommand was blocked for security because it may only write to files in the allowed working directories."
        }
    });

    let converted = session.convert_event("turn-error", &event);
    match converted {
        Some(EngineEvent::Raw { data, .. }) => {
            assert_eq!(
                data.get("blockedMethod").and_then(|value| value.as_str()),
                Some("item/commandExecution/requestApproval")
            );
            assert_eq!(
                data.get("requestId").and_then(|value| value.as_str()),
                Some("tool-exec-1")
            );
            assert_eq!(
                data.get("toolName").and_then(|value| value.as_str()),
                Some("ExecuteCommand")
            );
        }
        other => panic!("expected raw mode-blocked signal, got {:?}", other),
    }
}

#[test]
fn convert_error_event_maps_string_permission_denial_to_mode_blocked() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.register_pending_tool("turn-error-string", "tool-shell-string", "Shell", None);

    let event = json!({
        "type": "error",
        "error": "Shell requires approval before running this command"
    });

    let converted = session.convert_event("turn-error-string", &event);
    match converted {
        Some(EngineEvent::Raw { data, .. }) => {
            assert_eq!(
                data.get("blockedMethod").and_then(|value| value.as_str()),
                Some("item/commandExecution/requestApproval")
            );
            assert_eq!(
                data.get("requestId").and_then(|value| value.as_str()),
                Some("tool-shell-string")
            );
        }
        other => panic!("expected raw mode-blocked signal, got {:?}", other),
    }
}

#[test]
fn build_mode_blocked_signal_from_error_ignores_non_permission_errors() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    session.register_pending_tool("turn-a", "tool-ask-1", "AskUserQuestion", None);

    assert!(session
        .build_mode_blocked_signal_from_error("turn-a", "tool timed out")
        .is_none());
}

#[test]
fn convert_event_avoids_duplicate_when_assistant_blocks_repeat_whole_message() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);

    let first = json!({
        "type": "assistant",
        "message": {
            "content": [
                {"type": "text", "text": "你好！很高兴见到你。\n\n有什么我可以帮你的吗"}
            ]
        }
    });
    let second = json!({
        "type": "assistant",
        "message": {
            "content": [
                {"type": "text", "text": "有什么我可以帮你的吗？"},
                {"type": "text", "text": "你好！很高兴见到你。\n\n有什么我可以帮你的吗？"}
            ]
        }
    });

    match session.convert_event("turn-a", &first) {
        Some(EngineEvent::TextDelta { text, .. }) => {
            assert_eq!(text, "你好！很高兴见到你。\n\n有什么我可以帮你的吗")
        }
        other => panic!("expected first text delta, got {:?}", other),
    }

    match session.convert_event("turn-a", &second) {
        Some(EngineEvent::TextDelta { text, .. }) => assert_eq!(text, "？"),
        other => panic!("expected punctuation-only delta, got {:?}", other),
    }
}

#[test]
fn normalize_claude_workspace_relative_path_accepts_segmented_path() {
    let normalized =
        approval::normalize_claude_workspace_relative_path(Path::new("nested/path/demo.txt"))
            .expect("path should normalize");
    assert_eq!(normalized, "nested/path/demo.txt");
}

#[test]
fn command_can_apply_as_local_file_action_accepts_windows_style_path_and_cmd_alias() {
    assert!(approval::command_can_apply_as_local_file_action(
        r#"mkdir nested\windows\dir"#
    ));
    assert!(approval::command_can_apply_as_local_file_action(
        r#"touch nested\windows\file.txt"#
    ));
}

#[tokio::test]
async fn synthetic_claude_file_approval_accept_creates_missing_parent_directories() {
    let workspace_root =
        std::env::temp_dir().join(format!("mossx-claude-approval-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&workspace_root).expect("create temp workspace");
    let file_path = workspace_root
        .join("nested")
        .join("deep")
        .join("approved.txt");

    let session = ClaudeSession::new("test-workspace".to_string(), workspace_root.clone(), None);

    session.cache_tool_name("tool-write-nested", "Write");
    session.cache_tool_input_value(
        "tool-write-nested",
        &json!({
            "file_path": "nested\\deep\\approved.txt",
            "content": "nested approval"
        }),
    );
    session.register_pending_tool("turn-nested", "tool-write-nested", "Write", None);
    session
        .pending_approval_requests
        .lock()
        .expect("pending approvals lock")
        .insert("tool-write-nested".to_string(), "turn-nested".to_string());

    session
        .respond_to_approval_request(
            Value::String("tool-write-nested".to_string()),
            Value::String("accept".to_string()),
        )
        .await
        .expect("approval should create missing parent directories");

    assert_eq!(
        std::fs::read_to_string(&file_path).expect("file should exist"),
        "nested approval"
    );
    let _ = std::fs::remove_dir_all(&workspace_root);
}

#[tokio::test]
async fn synthetic_claude_file_approval_accepts_absolute_workspace_path() {
    let workspace_root =
        std::env::temp_dir().join(format!("mossx-claude-approval-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&workspace_root).expect("create temp workspace");
    let file_path = workspace_root.join("absolute-approved.txt");

    let session = ClaudeSession::new("test-workspace".to_string(), workspace_root.clone(), None);

    session.cache_tool_name("tool-write-absolute", "Write");
    session.cache_tool_input_value(
        "tool-write-absolute",
        &json!({
            "file_path": file_path.to_string_lossy().to_string(),
            "content": "absolute approval"
        }),
    );
    session.register_pending_tool("turn-absolute", "tool-write-absolute", "Write", None);
    session
        .pending_approval_requests
        .lock()
        .expect("pending approvals lock")
        .insert(
            "tool-write-absolute".to_string(),
            "turn-absolute".to_string(),
        );

    session
        .respond_to_approval_request(
            Value::String("tool-write-absolute".to_string()),
            Value::String("accept".to_string()),
        )
        .await
        .expect("absolute workspace path should resolve");

    assert_eq!(
        std::fs::read_to_string(&file_path).expect("file should exist"),
        "absolute approval"
    );
    let _ = std::fs::remove_dir_all(&workspace_root);
}

#[test]
fn convert_event_treats_cmd_alias_single_path_command_as_file_approval() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut receiver = session.subscribe();

    session.cache_tool_name("tool-bash-cmd", "Bash");
    session.cache_tool_input_value(
        "tool-bash-cmd",
        &json!({
            "cmd": r#"mkdir nested\windows\dir"#
        }),
    );
    session.register_pending_tool("turn-cmd", "tool-bash-cmd", "Bash", None);

    let event = json!({
        "type": "assistant",
        "message": {
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "tool-bash-cmd",
                    "is_error": true,
                    "content": "This command requires approval"
                }
            ]
        }
    });

    let converted = session.convert_event("turn-cmd", &event);
    assert!(converted.is_none());

    let approval = receiver
        .try_recv()
        .expect("expected approval request event");
    match approval.event {
        EngineEvent::ApprovalRequest {
            request_id,
            tool_name,
            input,
            ..
        } => {
            assert_eq!(request_id, Value::String("tool-bash-cmd".to_string()));
            assert_eq!(tool_name, "Bash");
            assert_eq!(
                input.as_ref().and_then(|value| value.get("cmd")),
                Some(&Value::String(r#"mkdir nested\windows\dir"#.to_string()))
            );
        }
        other => panic!("expected approval request, got {:?}", other),
    }
}

#[cfg(unix)]
#[tokio::test]
async fn synthetic_claude_file_approval_rejects_symlink_targets() {
    use std::os::unix::fs::symlink;

    let workspace_root =
        std::env::temp_dir().join(format!("mossx-claude-approval-{}", uuid::Uuid::new_v4()));
    let outside_root =
        std::env::temp_dir().join(format!("mossx-claude-outside-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&workspace_root).expect("create temp workspace");
    std::fs::create_dir_all(&outside_root).expect("create outside workspace");
    let outside_file = outside_root.join("outside.txt");
    std::fs::write(&outside_file, "outside").expect("seed outside file");
    let symlink_path = workspace_root.join("linked.txt");
    symlink(&outside_file, &symlink_path).expect("create symlink");

    let session = ClaudeSession::new("test-workspace".to_string(), workspace_root.clone(), None);
    let mut receiver = session.subscribe();

    session.cache_tool_name("tool-write-symlink", "Write");
    session.cache_tool_input_value(
        "tool-write-symlink",
        &json!({
            "file_path": symlink_path.to_string_lossy(),
            "content": "modified through symlink"
        }),
    );
    session.register_pending_tool("turn-symlink", "tool-write-symlink", "Write", None);
    session
        .pending_approval_requests
        .lock()
        .expect("pending approvals lock")
        .insert("tool-write-symlink".to_string(), "turn-symlink".to_string());

    session
        .respond_to_approval_request(
            Value::String("tool-write-symlink".to_string()),
            Value::String("accept".to_string()),
        )
        .await
        .expect("approval response should complete with tool error");

    let completion = receiver.try_recv().expect("expected tool completion event");
    match completion.event {
        EngineEvent::ToolCompleted { error, .. } => {
            assert_eq!(
                error.as_deref(),
                Some("Claude approval preview cannot modify symlink targets.")
            );
        }
        other => panic!("expected tool completed event, got {:?}", other),
    }

    assert_eq!(
        std::fs::read_to_string(&outside_file).expect("outside file should stay untouched"),
        "outside"
    );
    let _ = std::fs::remove_dir_all(&workspace_root);
    let _ = std::fs::remove_dir_all(&outside_root);
}

#[test]
fn looks_like_claude_runtime_error_detects_api_json_eof() {
    assert!(looks_like_claude_runtime_error(
        "API Error: Unexpected end of JSON input"
    ));
    assert!(looks_like_claude_runtime_error(
        "error: transport dropped unexpectedly"
    ));
}

#[test]
fn looks_like_claude_runtime_error_ignores_regular_output() {
    assert!(!looks_like_claude_runtime_error("你好，我继续给你方案"));
    assert!(!looks_like_claude_runtime_error("{\"type\":\"assistant\"}"));
}
