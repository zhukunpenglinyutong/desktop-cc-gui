//! End-to-end send-path test: fake `claude` CLI on PATH emitting stream-json
//! NDJSON, real send_message command, real EventSink, events captured via
//! listen_global. Verifies the whole chain the UI depends on.

use ccgui_next_lib::config::ConfigStore;
use ccgui_next_lib::db::Db;
use ccgui_next_lib::engine::{self, ProcessRegistry};
use ccgui_next_lib::event_sink::{EventSink, ENGINE_EVENT_NAME};
use ccgui_next_lib::AppState;
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tauri::{Listener, Manager};
/// Tests mutate process-global HOME/PATH; serialize them. Holding the std
/// guard across awaits is intentional here (test serialization, no deadlock:
/// each test awaits only its own child processes).
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn temp_home(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("ccgui-send-test-{}-{}", tag, std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_fake_claude(dir: &std::path::Path) {
    let script = r#"#!/bin/sh
read -r line
echo '{"type":"system","subtype":"init","session_id":"fake-session-123"}'
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}}'
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"from fake"}}}'
echo '{"type":"result","subtype":"success","session_id":"fake-session-123","usage":{"input_tokens":10,"output_tokens":5}}'
"#;
    let path = dir.join("claude");
    std::fs::write(&path, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

fn build_app(
    home: &std::path::Path,
) -> (tauri::App<tauri::test::MockRuntime>, Arc<Mutex<Vec<Value>>>) {
    std::env::set_var("HOME", home);
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let state = AppState {
        db: Arc::new(Db::open_at(&home.join("app.db")).unwrap()),
        sink: EventSink::new(Arc::new(app.handle().clone())),
        terminal_sink: EventSink::with_name(
            Arc::new(app.handle().clone()),
            ccgui_next_lib::terminal::TERMINAL_OUTPUT_EVENT,
        ),
        plugin_sink: EventSink::with_name(
            Arc::new(app.handle().clone()),
            ccgui_next_lib::event_sink::PLUGIN_AGENT_EVENT_NAME,
        ),
        mission_sink: EventSink::with_name(
            Arc::new(app.handle().clone()),
            ccgui_next_lib::event_sink::MISSION_AGENT_EVENT_NAME,
        ),
        terminals: ccgui_next_lib::terminal::TerminalRegistry::default(),
        processes: Arc::new(ProcessRegistry::default()),
        emitters: ccgui_next_lib::event_sink::BroadcastEmit::new(Arc::new(app.handle().clone())),
        web: ccgui_next_lib::web::WebAccessState::default(),
        relay: ccgui_next_lib::relay::RelayState::default(),
        dsh_host: Arc::new(ccgui_next_lib::dsh_host::DshHostState::default()),
        opencode_server: std::sync::Arc::new(
            ccgui_next_lib::engine::opencode_server::OpencodeServerState::default(),
        ),
        worktree_creations: ccgui_next_lib::git_worktree::CreationRegistry::default(),
    };
    app.manage(state);
    app.manage(ConfigStore::default());

    let events: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&events);
    let handle = app.handle().clone();
    handle.listen_any(ENGINE_EVENT_NAME, move |event: tauri::Event| {
        if let Ok(batch) = serde_json::from_str::<Vec<Value>>(event.payload()) {
            captured.lock().unwrap().extend(batch);
        }
    });
    (app, events)
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn send_message_streams_events_end_to_end() {
    let _env_guard = ENV_LOCK.lock().unwrap();
    let home = temp_home("stream");
    let bin_dir = home.join("bin");
    std::fs::create_dir_all(&bin_dir).unwrap();
    write_fake_claude(&bin_dir);
    std::env::set_var("PATH", format!("{}:/usr/bin:/bin", bin_dir.display()));

    let workspace = home.join("ws");
    std::fs::create_dir_all(&workspace).unwrap();

    let (app, events) = build_app(&home);
    let state = app.state::<AppState>();

    let result = engine::send_message(
        state,
        "claude".to_string(),
        workspace.to_string_lossy().to_string(),
        None,
        "hi".to_string(),
        Vec::new(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .await
    .expect("send_message must succeed");
    assert!(!result.run_id.is_empty());

    // Wait for the done event (events are batched at 32ms).
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let kinds: Vec<String> = events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| e.get("kind").and_then(Value::as_str).map(str::to_string))
            .collect();
        if kinds.iter().any(|k| k == "done") {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "no done event within 5s"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let collected = events.lock().unwrap();
    let kinds: Vec<&str> = collected
        .iter()
        .filter_map(|e| e.get("kind").and_then(Value::as_str))
        .collect();
    assert!(
        kinds.contains(&"session"),
        "session event missing: {kinds:?}"
    );
    assert!(kinds.contains(&"delta"), "delta events missing: {kinds:?}");

    let session_event = collected
        .iter()
        .find(|e| e.get("kind").and_then(Value::as_str) == Some("session"))
        .unwrap();
    assert_eq!(
        session_event.get("data").and_then(Value::as_str),
        Some("fake-session-123")
    );
    let delta_text: String = collected
        .iter()
        .filter(|e| e.get("kind").and_then(Value::as_str) == Some("delta"))
        .filter_map(|e| e.get("data").and_then(Value::as_str).map(str::to_string))
        .collect();
    assert_eq!(delta_text, "Hello from fake");

    let done = collected
        .iter()
        .find(|e| e.get("kind").and_then(Value::as_str) == Some("done"))
        .unwrap();
    assert_eq!(
        done.get("sessionId").and_then(Value::as_str),
        Some("fake-session-123")
    );

    // Process registry drained after exit.
    assert!(app
        .state::<AppState>()
        .processes
        .0
        .lock()
        .unwrap()
        .is_empty());
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn interrupt_kills_running_child() {
    let _env_guard = ENV_LOCK.lock().unwrap();
    let home = temp_home("interrupt");
    let bin_dir = home.join("bin");
    std::fs::create_dir_all(&bin_dir).unwrap();
    // Fake engine that emits a session id then hangs forever.
    let script = r#"#!/bin/sh
read -r line
echo '{"type":"system","subtype":"init","session_id":"fake-hang-1"}'
sleep 60
"#;
    let path = bin_dir.join("claude");
    std::fs::write(&path, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    std::env::set_var("PATH", format!("{}:/usr/bin:/bin", bin_dir.display()));

    let workspace = home.join("ws");
    std::fs::create_dir_all(&workspace).unwrap();

    let (app, events) = build_app(&home);
    let state = app.state::<AppState>();
    engine::send_message(
        state,
        "claude".to_string(),
        workspace.to_string_lossy().to_string(),
        None,
        "hi".to_string(),
        Vec::new(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .await
    .unwrap();

    // Wait for the session event (child registered under native id).
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let seen = events
            .lock()
            .unwrap()
            .iter()
            .any(|e| e.get("kind").and_then(Value::as_str) == Some("session"));
        if seen {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "no session event within 5s"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let killed = engine::interrupt_session(app.state::<AppState>(), "fake-hang-1".to_string())
        .await
        .unwrap();
    assert!(killed, "interrupt must find and kill the child");

    // Child exits shortly after start_kill.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if app
            .state::<AppState>()
            .processes
            .0
            .lock()
            .unwrap()
            .is_empty()
        {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "child still registered after kill"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

/// The JS side invokes with camelCase args (`workspacePath`, `sessionId`,
/// `imagePaths`) against snake_case Rust params; this drives the real IPC
/// router to prove that contract plus the command's presence in the handler.
#[test]
fn ipc_send_message_accepts_camel_case_args() {
    let _env_guard = ENV_LOCK.lock().unwrap();
    let home = temp_home("ipc");
    let bin_dir = home.join("bin");
    std::fs::create_dir_all(&bin_dir).unwrap();
    write_fake_claude(&bin_dir);
    std::env::set_var("HOME", &home);
    std::env::set_var("PATH", format!("{}:/usr/bin:/bin", bin_dir.display()));
    let workspace = home.join("ws");
    std::fs::create_dir_all(&workspace).unwrap();

    let app = tauri::test::mock_builder()
        .invoke_handler(tauri::generate_handler![engine::send_message])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    app.manage(AppState {
        db: Arc::new(Db::open_at(&home.join("app.db")).unwrap()),
        sink: EventSink::new(Arc::new(app.handle().clone())),
        terminal_sink: EventSink::with_name(
            Arc::new(app.handle().clone()),
            ccgui_next_lib::terminal::TERMINAL_OUTPUT_EVENT,
        ),
        plugin_sink: EventSink::with_name(
            Arc::new(app.handle().clone()),
            ccgui_next_lib::event_sink::PLUGIN_AGENT_EVENT_NAME,
        ),
        mission_sink: EventSink::with_name(
            Arc::new(app.handle().clone()),
            ccgui_next_lib::event_sink::MISSION_AGENT_EVENT_NAME,
        ),
        terminals: ccgui_next_lib::terminal::TerminalRegistry::default(),
        processes: Arc::new(ProcessRegistry::default()),
        emitters: ccgui_next_lib::event_sink::BroadcastEmit::new(Arc::new(app.handle().clone())),
        web: ccgui_next_lib::web::WebAccessState::default(),
        relay: ccgui_next_lib::relay::RelayState::default(),
        dsh_host: Arc::new(ccgui_next_lib::dsh_host::DshHostState::default()),
        opencode_server: std::sync::Arc::new(
            ccgui_next_lib::engine::opencode_server::OpencodeServerState::default(),
        ),
        worktree_creations: ccgui_next_lib::git_worktree::CreationRegistry::default(),
    });
    app.manage(ConfigStore::default());
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();

    let res = tauri::test::get_ipc_response(
        &webview,
        tauri::webview::InvokeRequest {
            cmd: "send_message".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(serde_json::json!({
                "engine": "claude",
                "workspacePath": workspace.to_string_lossy(),
                "sessionId": null,
                "prompt": "hi",
                "promptContributions": [],
                "imagePaths": null,
                "model": null,
            })),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    );
    let body = res.unwrap_or_else(|e| panic!("IPC send_message failed: {e}"));
    let value = body.deserialize::<Value>().unwrap();
    let run_id = value.get("runId").and_then(Value::as_str).unwrap_or("");
    assert!(!run_id.is_empty(), "expected runId in response: {value}");
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn omp_send_uses_persisted_tier_and_model_without_touching_cli_config() {
    let _env_guard = ENV_LOCK.lock().unwrap();
    let home = temp_home("omp-tier");
    std::fs::create_dir_all(home.join(".ccgui-next")).unwrap();
    let bin_dir = home.join("bin");
    std::fs::create_dir_all(&bin_dir).unwrap();
    let script = bin_dir.join("omp");
    std::fs::write(
        &script,
        r#"#!/bin/sh
printf '%s\n' "$@" > omp-args.txt
echo '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"ok"}}'
echo '{"type":"agent_end"}'
"#,
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    std::env::set_var("PATH", format!("{}:/usr/bin:/bin", bin_dir.display()));
    let workspace = home.join("ws");
    std::fs::create_dir_all(&workspace).unwrap();
    let (app, events) = build_app(&home);
    let mut settings = ccgui_next_lib::settings::AppSettings::default();
    for (model, tier) in [
        ("openai-codex/gpt-5.4", Some("priority")),
        ("openai-codex/gpt-5.4", Some("default")),
        ("openai-codex/gpt-5.4", None),
        ("openai/gpt-5.4", Some("priority")),
        ("anthropic/claude", Some("priority")),
        ("google/gemini", Some("priority")),
        ("openai-codex/gpt-5.4", Some("priority")),
    ] {
        settings.default_models.insert("omp".into(), model.into());
        settings.omp_openai_service_tier = tier.map(str::to_string);
        ccgui_next_lib::settings::update_app_settings(app.handle().clone(), settings.clone())
            .unwrap();
        events.lock().unwrap().clear();
        engine::send_message(
            app.state(),
            "omp".into(),
            workspace.to_string_lossy().into(),
            None,
            "hi".into(),
            Vec::new(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            if events.lock().unwrap().iter().any(|e| e["kind"] == "done") {
                break;
            }
            assert!(std::time::Instant::now() < deadline, "OMP did not complete");
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        let text = std::fs::read_to_string(workspace.join("omp-args.txt")).unwrap();
        let args: Vec<_> = text.lines().collect();
        assert!(args.windows(2).any(|a| a == ["--model", model]));
        let actual = args
            .iter()
            .position(|a| *a == "--service-tier")
            .map(|i| args[i + 1]);
        let expected = if model.starts_with("openai-codex/") {
            tier
        } else {
            None
        };
        assert_eq!(actual, expected, "model {model}");
        assert!(events
            .lock()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "delta" && e["data"] == "ok"));
    }
    assert!(!home.join(".omp/agent/config.yml").exists());
}

/// Fake `codebuddy`: records the launch stdin frames, parks one
/// AskUserQuestion on `can_use_tool`, records the reply, then finishes with
/// the given result line.
#[cfg(unix)]
fn write_fake_codebuddy(dir: &std::path::Path, log: &std::path::Path, result: &Value) {
    let script = r##"#!/bin/sh
read -r l1; printf '%s\n' "$l1" > "__LOG__/1.json"
read -r l2; printf '%s\n' "$l2" > "__LOG__/2.json"
echo '{"type":"system","subtype":"init","session_id":"fake-cb-1"}'
echo '{"type":"control_request","request_id":"perm_1","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion","tool_use_id":"call_ask_1","input":__INPUT__}}'
read -r l3; printf '%s\n' "$l3" > "__LOG__/3.json"
echo '__RESULT__'
"##
    .replace("__LOG__", &log.display().to_string())
    .replace("__INPUT__", &codebuddy_ask_input().to_string())
    .replace("__RESULT__", &result.to_string());
    let path = dir.join("codebuddy");
    std::fs::write(&path, script).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

#[cfg(unix)]
fn codebuddy_ask_input() -> Value {
    serde_json::json!({
        "questions": [
            {"question": "Which color?", "header": "Color", "multiSelect": false,
             "options": [{"label": "Red", "description": "r"}, {"label": "Blue", "description": "b"}]},
            {"question": "Which pets?", "header": "Pets", "multiSelect": true,
             "options": [{"label": "Cat", "description": "c"}, {"label": "Dog", "description": "d"}]}
        ]
    })
}

/// One CodeBuddy turn through the real send → question → answer_question
/// chain; returns the captured events and the three stdin frames.
#[cfg(unix)]
async fn codebuddy_question_round(
    tag: &str,
    answers: Option<Value>,
    result: Value,
) -> (Vec<Value>, [Value; 3]) {
    let home = temp_home(tag);
    let bin_dir = home.join("bin");
    let log = home.join("log");
    std::fs::create_dir_all(&bin_dir).unwrap();
    std::fs::create_dir_all(&log).unwrap();
    write_fake_codebuddy(&bin_dir, &log, &result);
    std::env::set_var("PATH", format!("{}:/usr/bin:/bin", bin_dir.display()));
    let workspace = home.join("ws");
    std::fs::create_dir_all(&workspace).unwrap();
    let (app, events) = build_app(&home);
    let run_id = format!("run-{tag}");
    engine::send_message(
        app.state(),
        "codebuddy".into(),
        workspace.to_string_lossy().into(),
        None,
        "ask me".into(),
        Vec::new(),
        None,
        None,
        None,
        None,
        Some("auto".into()),
        None,
        Some(run_id.clone()),
        None,
        None,
    )
    .await
    .unwrap();
    let wait_for = |kind: &'static str| {
        let events = Arc::clone(&events);
        async move {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            loop {
                if let Some(event) = events
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|e| e["kind"] == kind)
                    .cloned()
                {
                    return event;
                }
                assert!(std::time::Instant::now() < deadline, "no {kind} event");
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        }
    };
    let question = wait_for("question").await;
    // The card renders the raw tool input, not the parked reply context.
    assert_eq!(question["data"]["input"], codebuddy_ask_input());
    assert_eq!(question["data"]["toolUseId"], "call_ask_1");
    engine::answer_question(
        app.state(),
        run_id,
        question["data"]["requestId"].as_str().unwrap().to_string(),
        answers,
    )
    .await
    .unwrap();
    wait_for("done").await;
    let frame = |n: u8| -> Value {
        let text = std::fs::read_to_string(log.join(format!("{n}.json"))).unwrap();
        serde_json::from_str(text.trim()).unwrap()
    };
    let captured = events.lock().unwrap().clone();
    (captured, [frame(1), frame(2), frame(3)])
}

/// CodeBuddy only offers AskUserQuestion to a stream-json host that declared
/// the capability in `initialize`, and reads replies as `{allowed,
/// updatedInput}` with string answers. A skip is its native `_action:
/// "skip_question"`; even if the CLI still reports the question in
/// `permission_denials`, no "permission required" card may appear.
#[cfg(unix)]
#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn codebuddy_question_card_round_trips_and_skip_is_not_a_denial() {
    let _env_guard = ENV_LOCK.lock().unwrap();
    let done = serde_json::json!({
        "type": "result", "subtype": "success", "is_error": false,
        "session_id": "fake-cb-1", "permission_denials": []
    });
    let (events, [init, user, reply]) = codebuddy_question_round(
        "codebuddy-answer",
        Some(serde_json::json!({"Which color?": "Red", "Which pets?": ["Cat", "Dog"]})),
        done,
    )
    .await;
    assert_eq!(init["type"], "control_request");
    assert_eq!(init["request"]["subtype"], "initialize");
    assert_eq!(init["request"]["hasPrompt"], true);
    assert_eq!(init["request"]["capabilities"]["askUserQuestion"], true);
    assert_eq!(user["type"], "user");
    assert_eq!(reply["type"], "control_response");
    assert_eq!(reply["response"]["request_id"], "perm_1");
    let mut expected = codebuddy_ask_input();
    expected["answers"] = serde_json::json!({"Which color?": "Red", "Which pets?": "Cat, Dog"});
    assert_eq!(
        reply["response"]["response"],
        serde_json::json!({"allowed": true, "tool_use_id": "call_ask_1", "updatedInput": expected})
    );
    assert!(!events.iter().any(|e| e["kind"] == "permission_denied"));

    let declined = serde_json::json!({
        "type": "result", "subtype": "success", "is_error": false,
        "session_id": "fake-cb-1",
        "permission_denials": [{
            "tool_name": "AskUserQuestion", "tool_use_id": "call_ask_1",
            "tool_input": codebuddy_ask_input()
        }]
    });
    let (events, [_, _, reply]) =
        codebuddy_question_round("codebuddy-skip", None, declined).await;
    let mut expected = codebuddy_ask_input();
    expected["answers"] = serde_json::json!({"_action": "skip_question"});
    assert_eq!(
        reply["response"]["response"],
        serde_json::json!({"allowed": true, "tool_use_id": "call_ask_1", "updatedInput": expected})
    );
    assert!(
        !events.iter().any(|e| e["kind"] == "permission_denied"),
        "a skipped question surfaced as a permission card"
    );
}
