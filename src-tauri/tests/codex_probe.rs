//! Codex adapter probe: drives the REAL send_message + run_reader pipeline
//! (tokio select + 500ms usage-tail poll) against a fake `codex` CLI that
//! mimics `codex exec --json` output, to check the turn always settles with a
//! `done` event - including when the final agent_message is a very long line
//! that spans multiple pipe reads (the select tick can land mid-line).
//!
//! The fake CLI is placed in `%APPDATA%\npm`, the FIRST extra search path
//! `resolve::find_cli_binary` probes on Windows (before PATH), so the real
//! codex install is never consulted. APPDATA/USERPROFILE/LOCALAPPDATA are
//! redirected into the temp home so no real user state is touched.
//!
//! No Tauri app is built: the state is constructed directly and the sink
//! writes into a capturing `Emit`. `tauri::test::mock_builder` links the GUI
//! crates into the test exe, which then fails to load on Windows without a
//! comctl32 v6 manifest (0xc0000139) - the app exe gets one from tauri-build,
//! a bare `cargo test` binary does not.
//!
//! Windows-only: the fake CLI is a .cmd shim resolved via the %APPDATA%\npm
//! probe path, which does not exist on unix — there the real codex install
//! would be spawned instead. The whole target is gated accordingly.
#![cfg(target_os = "windows")]

use ccgui_next_lib::db::Db;
use ccgui_next_lib::engine::{self, ProcessRegistry};
use ccgui_next_lib::event_sink::{BroadcastEmit, Emit, EventSink, ENGINE_EVENT_NAME};
use ccgui_next_lib::AppState;
use serde_json::Value;
use std::sync::{Arc, Mutex};

static ENV_LOCK: Mutex<()> = Mutex::new(());

/// Collects the batched `engine://event` payloads the reader emits.
struct Capture(Mutex<Vec<Value>>);

impl Emit for Capture {
    fn emit_json(&self, name: &str, raw_json: &str) {
        if name != ENGINE_EVENT_NAME {
            return;
        }
        if let Ok(batch) = serde_json::from_str::<Vec<Value>>(raw_json) {
            self.0.lock().unwrap().extend(batch);
        }
    }
}

fn temp_home(tag: &str) -> std::path::PathBuf {
    let dir =
        std::env::temp_dir().join(format!("ccgui-codex-probe-{}-{}", tag, std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Redirect the known-folder env vars so Windows extra search paths and the
/// npm-prefix probe all resolve inside `home` (the fake codex.cmd then wins
/// the binary resolution). Restores nothing - each test uses its own temp
/// home and the guard is process-lifetime anyway.
fn redirect_env(home: &std::path::Path) {
    std::env::set_var("HOME", home);
    std::env::set_var("APPDATA", home.join("appdata"));
    std::env::set_var("USERPROFILE", home.join("profile"));
    std::env::set_var("LOCALAPPDATA", home.join("localappdata"));
    ccgui_next_lib::engine::resolve::clear_search_paths_cache();
}

/// Fake codex CLI: `%APPDATA%\npm\codex.cmd` running a Node script that reads
/// the prompt from stdin and emits codex-exec-style NDJSON, then exits.
fn write_fake_codex(home: &std::path::Path) {
    let bin_dir = home.join("appdata").join("npm");
    std::fs::create_dir_all(&bin_dir).unwrap();
    let cmd = bin_dir.join("codex.cmd");
    std::fs::write(&cmd, "@echo off\r\nnode \"%~dp0fake-codex.js\" %*\r\n").unwrap();
    let js = bin_dir.join("fake-codex.js");
    // Scenario via env: the test process sets it per run. The script reads
    // all of stdin (prompt), then writes the NDJSON events. In the "long"
    // scenario the final agent_message is ~400KB written in small chunks
    // with delays, so the reader's 500ms poll tick lands mid-line.
    std::fs::write(
        &js,
        r#"const process = require("process");
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (prompt += c));
process.stdin.on("end", () => {
  const scenario = process.env.CODEX_PROBE_SCENARIO || "normal";
  const out = (s) => process.stdout.write(s + "\n");
  if (scenario === "early-error") {
    out(JSON.stringify({ type: "turn.failed", error: { message: "failed before thread started" } }));
    return;
  }
  out(JSON.stringify({ type: "thread.started", thread_id: "thread-probe-1" }));
  if (scenario === "long") {
    // A very long agent_message line, delivered in chunks with pauses so a
    // 500ms poll tick lands mid-line.
    const body = "LONG-ANSWER-START|" + "x".repeat(400 * 1024) + "|LONG-ANSWER-END";
    const payload = JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: body } });
    let i = 0;
    const step = 8192;
    const finish = () => {
      out(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 2 } }));
      setTimeout(() => process.exit(0), 50);
    };
    const writeNext = () => {
      if (i < payload.length) {
        const chunk = payload.slice(i, i + step);
        i += step;
        process.stdout.write(chunk);
        setTimeout(writeNext, 8);
      } else {
        out("");
        finish();
      }
    };
    writeNext();
    return;
  }
  out(JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "hello from fake codex" } }));
  out(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 2 } }));
  setTimeout(() => process.exit(0), 50);
});
"#,
    )
    .unwrap();
}

fn build_state(home: &std::path::Path) -> (AppState, Arc<Capture>) {
    ccgui_next_lib::paths::ensure_dirs().unwrap();
    let capture = Arc::new(Capture(Mutex::new(Vec::new())));
    let emitter = Arc::clone(&capture) as Arc<dyn Emit>;
    let sink = EventSink::new(Arc::clone(&emitter));
    let state = AppState {
        db: Arc::new(Db::open_at(&home.join("app.db")).unwrap()),
        sink,
        terminal_sink: EventSink::with_name(
            Arc::clone(&emitter),
            ccgui_next_lib::terminal::TERMINAL_OUTPUT_EVENT,
        ),
        plugin_sink: EventSink::with_name(
            Arc::clone(&emitter),
            ccgui_next_lib::event_sink::PLUGIN_AGENT_EVENT_NAME,
        ),
        mission_sink: EventSink::with_name(
            Arc::clone(&emitter),
            ccgui_next_lib::event_sink::MISSION_AGENT_EVENT_NAME,
        ),
        terminals: ccgui_next_lib::terminal::TerminalRegistry::default(),
        processes: Arc::new(ProcessRegistry::default()),
        emitters: BroadcastEmit::new(emitter),
        web: ccgui_next_lib::web::WebAccessState::default(),
        relay: ccgui_next_lib::relay::RelayState::default(),
        dsh_host: Arc::new(ccgui_next_lib::dsh_host::DshHostState::default()),
        opencode_server: std::sync::Arc::new(
            ccgui_next_lib::engine::opencode_server::OpencodeServerState::default(),
        ),
        worktree_creations: ccgui_next_lib::git_worktree::CreationRegistry::default(),
    };
    (state, capture)
}

async fn send_codex_and_wait(
    state: &AppState,
    events: &Arc<Capture>,
    deadline_ms: u64,
) -> Vec<Value> {
    let workspace = std::env::temp_dir().join(format!("ccgui-codex-ws-{}", std::process::id()));
    std::fs::create_dir_all(&workspace).unwrap();
    let result = engine::send_message_inner(
        state,
        "codex".to_string(),
        workspace.to_string_lossy().to_string(),
        None,
        "hi".to_string(),
        Vec::new(),
        None,
        None,
        None,
        None,
        None,
        Some("run-client-probe".into()),
        None,
    )
    .await
    .expect("send_message must succeed");
    assert_eq!(result.run_id, "run-client-probe");

    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(deadline_ms);
    loop {
        let kinds: Vec<String> = events
            .0
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| e.get("kind").and_then(Value::as_str).map(str::to_string))
            .collect();
        if kinds.iter().any(|k| k == "done") || kinds.iter().any(|k| k == "error") {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "no done/error within {deadline_ms}ms; kinds={kinds:?}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let collected = events.0.lock().unwrap().clone();
    assert!(collected
        .iter()
        .all(|event| event["runId"] == "run-client-probe"));
    collected
}

fn collected_text(events: &[Value]) -> String {
    events
        .iter()
        .filter(|e| e.get("kind").and_then(Value::as_str) == Some("message"))
        .filter_map(|e| {
            e.get("data")
                .and_then(|d| d.get("text"))
                .and_then(Value::as_str)
        })
        .collect()
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn codex_error_before_session_id_keeps_the_client_run_id() {
    let _env_guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("early-error");
    redirect_env(&home);
    write_fake_codex(&home);
    std::env::set_var("CODEX_PROBE_SCENARIO", "early-error");
    let (state, events) = build_state(&home);
    let collected = send_codex_and_wait(&state, &events, 15_000).await;
    let error = collected.iter().find(|e| e["kind"] == "error").unwrap();
    assert!(error["sessionId"].is_null());
    assert_eq!(error["data"], "failed before thread started");
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn codex_normal_turn_settles_with_done() {
    let _env_guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("normal");
    redirect_env(&home);
    write_fake_codex(&home);
    std::env::set_var("CODEX_PROBE_SCENARIO", "normal");

    let (state, events) = build_state(&home);
    let collected = send_codex_and_wait(&state, &events, 15_000).await;
    let kinds: Vec<&str> = collected
        .iter()
        .filter_map(|e| e.get("kind").and_then(Value::as_str))
        .collect();
    assert!(
        kinds.contains(&"done"),
        "codex normal turn never settled: {kinds:?}"
    );
    let text = collected_text(&collected);
    assert!(
        text.contains("hello from fake codex"),
        "agent text missing: {text:?}"
    );
    // Registry drains after the run.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while state.processes.0.lock().unwrap().len() > 0 {
        assert!(std::time::Instant::now() < deadline, "registry not drained");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn codex_long_final_message_settles_and_keeps_text() {
    let _env_guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let home = temp_home("long");
    redirect_env(&home);
    write_fake_codex(&home);
    std::env::set_var("CODEX_PROBE_SCENARIO", "long");

    let (state, events) = build_state(&home);
    let collected = send_codex_and_wait(&state, &events, 20_000).await;
    let kinds: Vec<&str> = collected
        .iter()
        .filter_map(|e| e.get("kind").and_then(Value::as_str))
        .collect();
    assert!(
        kinds.contains(&"done"),
        "codex long turn never settled: {kinds:?}"
    );
    let text = collected_text(&collected);
    assert!(
        text.contains("LONG-ANSWER-START") && text.contains("LONG-ANSWER-END"),
        "long agent message corrupted/dropped: len={} head={:?}",
        text.len(),
        &text[..text.len().min(80)]
    );
}
