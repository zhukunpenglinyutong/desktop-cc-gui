pub mod claude;
pub mod codex;
pub mod dsh;
pub mod grok;
pub mod images;
pub mod kimi;
pub mod models;
pub mod pi_family;
pub mod pi_family_auth;
pub mod resolve;

pub(crate) use resolve::command_for_binary;

use crate::event_sink;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdout, Command};
use tokio::sync::Mutex as TokioMutex;

/// Windows pops a visible console window for every console-subsystem child a
/// GUI process spawns (engine CLIs are node/.cmd shims, so every probe and
/// run flashes one). Suppress it — the child's stdio is piped, the console
/// would be useless anyway.
#[cfg(windows)]
pub(crate) fn hide_console(command: &mut Command) {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

pub struct SendRequest {
    pub session_id: Option<String>,
    pub workspace: PathBuf,
    pub prompt: String,
    pub images: Vec<String>,
    pub model: Option<String>,
    /// Reasoning effort ("low" | "medium" | "high" | "xhigh" | "max"); engines without an
    /// effort knob ignore it, engines with a narrower knob clamp.
    pub effort: Option<String>,
    /// Permission mode ("auto" | "manual" | "plan" | "bypass"); each engine
    /// resolves it against the modes it can actually honor at spawn (see
    /// `Engine::resolve_permission`).
    pub permission: Option<String>,
}

pub struct BuiltCommand {
    pub command: Command,
    /// Written to stdin after spawn; stdin is then closed.
    pub stdin_payload: Option<String>,
    /// Temp files to remove once the process exits.
    pub cleanup_files: Vec<PathBuf>,
    /// Session id assigned before spawn (grok `-s <uuid>`).
    pub preassigned_session_id: Option<String>,
}

#[derive(Debug)]
pub enum EngineEvent {
    Delta(String),
    /// Reasoning/thinking delta (append).
    Thinking(String),
    /// A completed message block (role, text). `path` carries the target
    /// file of a tool call (read/edit/write/...) so the UI can render a
    /// file chip; None for everything else.
    Message {
        role: String,
        text: String,
        path: Option<String>,
    },
    /// Native session id became known.
    SessionId(String),
    /// Token usage snapshot from the engine.
    Usage(Value),
    /// Engine-reported error.
    Error(String),
    /// Non-terminal engine notice (e.g. an upstream 429 the CLI is
    /// retrying): surfaced to the UI, but the turn is still running.
    Warn(String),
    /// Turn finished successfully.
    Done {
        session_id: Option<String>,
        usage: Option<Value>,
    },
}

/// First path-like argument of a tool call (`read`/`edit`/`write` use
/// `path`, claude's tools use `file_path`). Returns None for tools whose
/// args carry no file target (e.g. bash `command`). Glob patterns are kept
/// as-is; the UI decides whether the string is chip-worthy.
pub(crate) fn tool_path_arg(args: &Value) -> Option<String> {
    ["path", "file_path", "filePath"]
        .iter()
        .filter_map(|key| args.get(key).and_then(Value::as_str))
        .map(|s| s.trim())
        .find(|s| !s.is_empty())
        .map(|s| s.to_string())
}

pub trait Engine: Send + Sync {
    fn id(&self) -> &'static str;
    fn build_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String>;
    /// Parse one NDJSON stdout line into zero or more events.
    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>);
    /// Whether this engine accepts image attachments.
    fn supports_images(&self) -> bool;
    /// Permission modes this engine can honor at spawn ("auto" | "manual" |
    /// "plan" | "bypass"). These are one-shot headless launches that cannot
    /// ask mid-turn, so most engines support only a subset; the UI greys out
    /// the rest rather than promising a mode the CLI would silently ignore.
    fn supported_permissions(&self) -> &'static [&'static str] {
        &["auto"]
    }
    /// Effective mode for one send: the requested mode when this engine
    /// supports it, otherwise the engine's first supported mode.
    fn resolve_permission(&self, requested: Option<&str>) -> &'static str {
        let supported = self.supported_permissions();
        requested
            .and_then(|mode| supported.iter().copied().find(|m| *m == mode))
            .unwrap_or(supported[0])
    }
}

pub fn engine_by_id(id: &str) -> Option<Box<dyn Engine>> {
    match id {
        "claude" => Some(Box::new(claude::ClaudeEngine)),
        "kimi" => Some(Box::new(kimi::KimiEngine)),
        "grok" => Some(Box::new(grok::GrokEngine)),
        "codex" => Some(Box::new(codex::CodexEngine)),
        "pi" => Some(Box::new(pi_family::pi())),
        "omp" => Some(Box::new(pi_family::omp())),
        "dsh" => Some(Box::new(dsh::DshEngine)),
        _ => None,
    }
}

/// Engine home dir: `$ENV_KEY` (with `~` expansion, as the CLIs resolve it)
/// when set and non-empty, else `~/<default_dir>`.
pub(crate) fn engine_home(env_key: Option<&str>, default_dir: &str) -> PathBuf {
    if let Some(key) = env_key {
        if let Some(value) = std::env::var_os(key).filter(|v| !v.is_empty()) {
            let text = value.to_string_lossy();
            if let Ok(expanded) = crate::open_app::expand_user_path(&text) {
                return expanded;
            }
            return PathBuf::from(value);
        }
    }
    dirs::home_dir().unwrap_or_default().join(default_dir)
}

/// A leading '-' would parse as a flag (pi also treats '@' as a file
/// reference): prefix a space so the prompt stays positional text.
pub(crate) fn safe_prompt_arg(prompt: &str) -> String {
    if prompt.starts_with('-') || prompt.starts_with('@') {
        format!(" {prompt}")
    } else {
        prompt.to_string()
    }
}

/// Push a `SessionId` event from a JSON string field; blank values are ignored.
/// Engines disagree on the key (`session_id` / `thread_id` / `id`).
pub(crate) fn push_session_id(value: &Value, key: &str, out: &mut Vec<EngineEvent>) {
    if let Some(id) = value.get(key).and_then(Value::as_str) {
        if !id.trim().is_empty() {
            out.push(EngineEvent::SessionId(id.trim().to_string()));
        }
    }
}

// ==================== Process registry ====================

/// Live engine child processes keyed by session key (native session id once
/// known, otherwise the run id). Drop kills everything synchronously.
pub struct ChildEntry {
    pub child: Arc<TokioMutex<Child>>,
    pub pid: u32,
    /// The run id this entry started under; after a rekey the map key is the
    /// native session id, but the frontend may still cancel by run id.
    pub run_id: String,
    /// Set by `kill()`: a user-initiated stop is not an error — at EOF the
    /// runner commits the partial turn as done instead of pushing a bogus
    /// "exited with status …" error.
    pub killed: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Default)]
pub struct ProcessRegistry(pub Mutex<HashMap<String, ChildEntry>>);

/// Two concurrent runs of one session must never evict each other's entries:
/// an evicted child leaks (no key routes an interrupt to it).
impl ProcessRegistry {
    fn insert(&self, key: String, entry: ChildEntry) {
        if let Ok(mut map) = self.0.lock() {
            map.insert(key, entry);
        }
    }

    fn len(&self) -> usize {
        self.0.lock().map(|map| map.len()).unwrap_or(0)
    }

    /// Move an entry to the native-session key once known. A colliding target
    /// key belongs to another live run — keep both instead of overwriting.
    fn rekey(&self, from: &str, to: String) {
        if from == to {
            return;
        }
        if let Ok(mut map) = self.0.lock() {
            if map.contains_key(&to) {
                return;
            }
            if let Some(entry) = map.remove(from) {
                map.insert(to, entry);
            }
        }
    }

    /// Remove only if the entry is still the same child (pid match): a run
    /// that lost its session key to nothing must not evict another run's
    /// entry that now lives under that key.
    fn remove_if_pid(&self, key: &str, pid: u32) {
        if let Ok(mut map) = self.0.lock() {
            if map.get(key).map(|entry| entry.pid) == Some(pid) {
                map.remove(key);
            }
        }
    }

    /// Kill one entry (pid-reuse guarded). Returns false when the child was
    /// already reaped — nothing left to signal.
    fn kill_entry(pid: u32, child: &Arc<TokioMutex<tokio::process::Child>>, killed: &Arc<std::sync::atomic::AtomicBool>) -> bool {
        killed.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Ok(mut guard) = child.try_lock() {
            // Pid-reuse guard: a reaped child's pid may already belong to
            // someone else — never signal a group we no longer own.
            match guard.try_wait() {
                Ok(Some(_)) => false,
                _ => {
                    kill_process_group(pid);
                    let _ = guard.start_kill();
                    true
                }
            }
        } else {
            // The runner holds the lock only while reaping post-EOF; that
            // window is tiny and the kill flag already settles the turn.
            kill_process_group(pid);
            true
        }
    }

    /// Kill **every** entry matching `key`: the map key (native session id or
    /// run id) and the recorded run id both match. One session resumed into
    /// several parallel runs must all die on a single stop, or the survivors
    /// keep streaming and fight the next run over the session file.
    pub fn kill(&self, key: &str) -> bool {
        let entries: Vec<(u32, Arc<TokioMutex<tokio::process::Child>>, Arc<std::sync::atomic::AtomicBool>)> =
            match self.0.lock() {
                Ok(map) => map
                    .iter()
                    .filter(|(k, e)| *k == key || e.run_id == key)
                    .map(|(_, e)| (e.pid, Arc::clone(&e.child), Arc::clone(&e.killed)))
                    .collect(),
                Err(_) => Vec::new(),
            };
        if entries.is_empty() {
            return false;
        }
        entries
            .iter()
            .any(|(pid, child, killed)| Self::kill_entry(*pid, child, killed))
    }

    pub fn kill_all(&self) {
        // Blocking lock on the teardown path: skipping children because the
        // lock was briefly contended would leak engine processes.
        let entries: Vec<ChildEntry> = match self.0.lock() {
            Ok(mut map) => map.drain().map(|(_, e)| e).collect(),
            Err(poisoned) => poisoned.into_inner().drain().map(|(_, e)| e).collect(),
        };
        for entry in entries {
            kill_process_group(entry.pid);
            if let Ok(mut guard) = entry.child.try_lock() {
                let _ = guard.start_kill();
            }
        }
    }
}

impl Drop for ProcessRegistry {
    fn drop(&mut self) {
        // &mut self makes locking unnecessary; poisoning must not skip the
        // kill sweep either (a panicked run leaves live children).
        let map = self.0.get_mut().unwrap_or_else(|e| e.into_inner());
        for (_, entry) in map.drain() {
            kill_process_group(entry.pid);
            if let Ok(mut guard) = entry.child.try_lock() {
                let _ = guard.start_kill();
            }
        }
    }
}
/// SIGKILL the child's whole process group (spawn used `process_group(0)`,
/// so pgid == pid). Grandchildren holding the stdout pipe die too, which is
/// what lets the reader task observe EOF and drain the registry.
#[cfg(unix)]
pub(crate) fn kill_process_group(pid: u32) {
    // SAFETY: kill with a negated pgid signals the group; no memory touched.
    unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
}

/// Windows has no process groups; npm CLIs spawn as `cmd /c x.cmd`, so the
/// real CLI is a grandchild. Killing only the direct child (start_kill)
/// orphans node — the turn keeps streaming and burning API calls, and its
/// inherited stdout pipe never reaches EOF. `taskkill /T /F` takes the
/// whole tree down. Fire-and-forget: the callers' start_kill still handles
/// the direct child synchronously.
#[cfg(not(unix))]
pub(crate) fn kill_process_group(pid: u32) {
    let mut command = std::process::Command::new("taskkill");
    command
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = command.spawn();
}

// ==================== stderr redaction ====================

/// Engine stderr can echo the channel credentials from the CLI's own config files; redact credential
/// shapes before the tail is shown to the user in an error banner.
fn redact_secrets(text: &str) -> String {
    use std::sync::LazyLock;
    static PATTERNS: LazyLock<Vec<regex::Regex>> = LazyLock::new(|| {
        [
            r"(?i)sk-[A-Za-z0-9_-]+",
            r"(?i)bearer\s+\S+",
            r"(?i)api[_-]?key\s*[=:]\s*\S+",
            r"(?i)token\s*[=:]\s*\S+",
        ]
        .iter()
        .filter_map(|p| regex::Regex::new(p).ok())
        .collect()
    });
    let mut out = text.to_string();
    for pattern in PATTERNS.iter() {
        out = pattern.replace_all(&out, "***").into_owned();
    }
    out
}

// ==================== Commands ====================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub run_id: String,
    pub session_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub id: String,
    pub available: bool,
    /// False when the user disabled this CLI in settings; the UI hides it
    /// from pickers and history lists rather than erroring on launch.
    pub enabled: bool,
    pub supports_images: bool,
    /// Permission modes the engine honors at spawn; drives the composer
    /// picker's disabled options.
    pub permissions: Vec<String>,
}

fn engine_bin(settings: &crate::settings::AppSettings, engine_id: &str) -> String {
    if let Some(custom) = settings.bin_override(engine_id) {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            // Defense in depth: settings write validates too, but the file
            // may have been hand-edited since.
            match crate::settings::validate_bin_override(trimmed) {
                Ok(path) => {
                    return resolve::resolve_launchable_cli_binary(&path.to_string_lossy())
                }
                Err(reason) => {
                    eprintln!("[engine] ignoring invalid {engine_id} bin override: {reason}");
                }
            }
        }
    }
    resolve::resolve_launchable_cli_binary(engine_id)
}

#[tauri::command]
pub fn list_engines() -> Vec<EngineInfo> {
    let settings = crate::settings::read_settings().unwrap_or_default();
    let config = crate::config::read_config().unwrap_or_default();
    crate::config::ENGINES
        .iter()
        .map(|id| {
            let engine = engine_by_id(id).expect("known engine");
            let available = match settings.bin_override(id) {
                Some(custom) if !custom.trim().is_empty() => {
                    crate::settings::validate_bin_override(custom).is_ok()
                }
                _ => resolve::find_cli_binary(id, None).is_some(),
            };
            EngineInfo {
                id: id.to_string(),
                available,
                enabled: config.section(id).and_then(|s| s.current.as_deref())
                    != Some(crate::config::DISABLED_PROVIDER_ID),
                supports_images: engine.supports_images(),
                permissions: engine
                    .supported_permissions()
                    .iter()
                    .map(|m| m.to_string())
                    .collect(),
            }
        })
        .collect()
}

/// Concurrent engine runs; past this the machine thrashes and the registry
/// fan-out makes interrupts unreliable anyway.
const MAX_CONCURRENT_RUNS: usize = 16;

/// Resolved launch parameters for one send: request, binary, built command.
struct Launch {
    req: SendRequest,
    bin: String,
    built: BuiltCommand,
    engine_impl: Box<dyn Engine>,
}

fn prepare_launch(
    engine: &str,
    workspace_path: &str,
    session_id: Option<String>,
    prompt: String,
    image_paths: Option<Vec<String>>,
    model: Option<String>,
    effort: Option<String>,
    permission: Option<String>,
) -> Result<Launch, String> {
    let engine_impl = engine_by_id(engine).ok_or_else(|| format!("unknown engine: {engine}"))?;
    // Channels live in each CLI's native config file (provider_files); the
    // only launch-time gate left is the 停用 pseudo-provider.
    crate::config::ensure_engine_enabled(engine)?;
    let settings = crate::settings::read_settings().unwrap_or_default();
    let model = model
        .filter(|m| !m.trim().is_empty())
        .or_else(|| settings.default_models.get(engine).cloned())
        .filter(|m| !m.trim().is_empty());
    let effort = effort
        .filter(|e| !e.trim().is_empty())
        .or_else(|| settings.default_efforts.get(engine).cloned())
        .filter(|e| !e.trim().is_empty());
    let req = SendRequest {
        session_id: session_id.filter(|s| !s.trim().is_empty()),
        workspace: PathBuf::from(workspace_path),
        prompt,
        images: image_paths.unwrap_or_default(),
        model,
        effort,
        permission: permission.filter(|p| !p.trim().is_empty()),
    };
    let bin = engine_bin(&settings, engine);
    let built = engine_impl.build_command(&req, &bin)?;
    Ok(Launch {
        req,
        bin,
        built,
        engine_impl,
    })
}

/// Stdin payload writer: engines consuming stream-json stdin get the payload
/// then EOF (drop closes the pipe).
fn spawn_stdin_writer(child: &mut Child, payload: Option<String>) {
    let Some(payload) = payload else {
        return;
    };
    if let Some(mut stdin) = child.stdin.take() {
        tokio::spawn(async move {
            let _ = stdin.write_all(payload.as_bytes()).await;
            let _ = stdin.write_all(b"\n").await;
            // drop closes stdin -> EOF
        });
    }
}

/// Stderr capture ring: keeps the last 4KB for the error banner.
fn spawn_stderr_capture(stderr: ChildStderr) -> Arc<Mutex<String>> {
    let buf = Arc::new(Mutex::new(String::new()));
    let target = Arc::clone(&buf);
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let mut guard = match target.lock() {
                        Ok(g) => g,
                        Err(p) => p.into_inner(),
                    };
                    guard.push_str(&line);
                    if guard.len() > 4096 {
                        let keep = guard.len() - 4096;
                        guard.drain(..keep);
                    }
                }
            }
        }
    });
    buf
}

/// Mutable per-run streaming state shared by the reader loop's dispatch.
struct TurnState {
    seq: u64,
    native_session_id: Option<String>,
    saw_done: bool,
    saw_error: bool,
    saw_any_output: bool,
}

impl TurnState {
    fn new(preassigned: Option<String>) -> Self {
        Self {
            seq: 0,
            native_session_id: preassigned,
            saw_done: false,
            saw_error: false,
            saw_any_output: false,
        }
    }

    fn push(
        &mut self,
        sink: &Arc<event_sink::EventSink>,
        run_id: &str,
        engine_id: &str,
        kind: &str,
        data: Value,
    ) {
        self.seq += 1;
        sink.push(serde_json::json!({
            "runId": run_id,
            "sessionId": self.native_session_id,
            "engine": engine_id,
            "seq": self.seq,
            "kind": kind,
            "data": data,
        }));
    }
}

/// Everything the stdout reader task needs (moved in at spawn).
struct RunContext {
    sink: Arc<event_sink::EventSink>,
    registry: Arc<ProcessRegistry>,
    engine_impl: Box<dyn Engine>,
    engine_id: String,
    run_id: String,
    pid: u32,
    /// Session id fixed before spawn (grok `-s`); seeds TurnState.
    preassigned_session_id: Option<String>,
    child: Arc<TokioMutex<Child>>,
    killed: Arc<std::sync::atomic::AtomicBool>,
    cleanup_files: Vec<PathBuf>,
    stderr_buf: Arc<Mutex<String>>,
}

impl RunContext {
    /// Adopt a native session id: rekey the registry entry (no overwrite) and
    /// remember it for subsequent event payloads.
    fn adopt_session_id(&self, state: &mut TurnState, id: &str, announce: bool) {
        if state.native_session_id.as_deref() == Some(id) {
            return;
        }
        state.native_session_id = Some(id.to_string());
        self.registry.rekey(&self.run_id, id.to_string());
        if announce {
            state.push(
                &self.sink,
                &self.run_id,
                &self.engine_id,
                "session",
                Value::String(id.to_string()),
            );
        }
    }

    fn dispatch_event(&self, state: &mut TurnState, event: EngineEvent) {
        match event {
            EngineEvent::Delta(text) => state.push(
                &self.sink,
                &self.run_id,
                &self.engine_id,
                "delta",
                Value::String(text),
            ),
            EngineEvent::Thinking(text) => state.push(
                &self.sink,
                &self.run_id,
                &self.engine_id,
                "thinking",
                Value::String(text),
            ),
            EngineEvent::Message { role, text, path } => {
                let mut payload = serde_json::json!({ "role": role, "text": text });
                if let Some(path) = path {
                    payload["path"] = Value::String(path);
                }
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "message",
                    payload,
                )
            }
            EngineEvent::SessionId(id) => self.adopt_session_id(state, &id, true),
            EngineEvent::Usage(usage) => {
                state.push(&self.sink, &self.run_id, &self.engine_id, "usage", usage)
            }
            EngineEvent::Error(error) => {
                state.saw_error = true;
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "error",
                    Value::String(error),
                );
            }
            EngineEvent::Warn(error) => {
                // Not terminal: no saw_error — EOF settle still decides the
                // turn's fate if the CLI gives up after this notice.
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "warn",
                    Value::String(error),
                );
            }
            EngineEvent::Done { session_id, usage } => {
                state.saw_done = true;
                if let Some(id) = session_id {
                    self.adopt_session_id(state, &id, false);
                }
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "done",
                    serde_json::json!({ "usage": usage }),
                );
            }
        }
    }
}

/// Read NDJSON stdout until EOF, dispatch events, then settle the turn:
/// registry cleanup, temp-file cleanup, and the terminal done/error event.
async fn run_reader(stdout: ChildStdout, ctx: RunContext) {
    let mut state = TurnState::new(ctx.preassigned_session_id.clone());
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => break,
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        state.saw_any_output = true;
        let mut events = Vec::new();
        ctx.engine_impl.parse_line(trimmed, &mut events);
        for event in events {
            ctx.dispatch_event(&mut state, event);
        }
    }

    // Wait for exit
    let status = {
        let mut guard = ctx.child.lock().await;
        guard.wait().await.ok()
    };
    for path in &ctx.cleanup_files {
        let _ = std::fs::remove_file(path);
    }
    // omp writes some failures (upstream 403/5xx, quota exhaustion) to
    // stderr and then exits — sometimes cleanly, after a normal turn_end.
    // A non-empty stderr on a failed exit must reach the user even when a
    // done/error event already settled the turn; dropping it hides exactly
    // the errors the user cannot otherwise see.
    let stderr_tail = ctx
        .stderr_buf
        .lock()
        .map(|g| redact_secrets(g.trim()))
        .unwrap_or_default();
    let failed = status.map(|s| !s.success()).unwrap_or(true);
    if failed && !state.saw_error && !stderr_tail.is_empty() {
        state.push(
            &ctx.sink,
            &ctx.run_id,
            &ctx.engine_id,
            "warn",
            Value::String(format!("engine stderr: {stderr_tail}")),
        );
    }

    if !state.saw_done && !state.saw_error {
        let killed = ctx.killed.load(std::sync::atomic::Ordering::SeqCst);
        if killed {
            // User-initiated stop: commit whatever streamed so far as a
            // normal turn end — a SIGKILL'd child is not a failure.
            state.push(
                &ctx.sink,
                &ctx.run_id,
                &ctx.engine_id,
                "done",
                serde_json::json!({ "usage": null }),
            );
        } else if failed || !state.saw_any_output {
            let mut message = format!(
                "{} exited with status {}",
                ctx.engine_id,
                status
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "unknown".to_string())
            );
            if !stderr_tail.is_empty() {
                message.push_str(&format!(": {stderr_tail}"));
            }
            state.push(
                &ctx.sink,
                &ctx.run_id,
                &ctx.engine_id,
                "error",
                Value::String(message),
            );
        } else {
            // Clean EOF without an explicit done line (kimi).
            state.push(
                &ctx.sink,
                &ctx.run_id,
                &ctx.engine_id,
                "done",
                serde_json::json!({ "usage": null }),
            );
        }
    }
    ctx.sink.flush();
}

#[tauri::command]
pub async fn send_message(
    state: tauri::State<'_, crate::AppState>,
    engine: String,
    workspace_path: String,
    session_id: Option<String>,
    prompt: String,
    image_paths: Option<Vec<String>>,
    model: Option<String>,
    effort: Option<String>,
    permission: Option<String>,
) -> Result<SendResult, String> {
    if state.processes.len() >= MAX_CONCURRENT_RUNS {
        return Err(format!(
            "too many concurrent runs ({MAX_CONCURRENT_RUNS}); wait for one to finish"
        ));
    }
    let launch = prepare_launch(
        &engine,
        &workspace_path,
        session_id,
        prompt,
        image_paths,
        model,
        effort,
        permission,
    )?;

    let mut command = launch.built.command;
    command
        .stdin(if launch.built.stdin_payload.is_some() {
            std::process::Stdio::piped()
        } else {
            std::process::Stdio::null()
        })
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .current_dir(&launch.req.workspace);
    // Own process group so interrupt can kill the whole tree (grandchildren
    // inherit the stdout pipe and would otherwise block EOF forever).
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    hide_console(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            // Never strand the staging files build_command wrote (grok).
            for path in &launch.built.cleanup_files {
                let _ = std::fs::remove_file(path);
            }
            return Err(format!("failed to spawn {}: {error}", launch.bin));
        }
    };

    spawn_stdin_writer(&mut child, launch.built.stdin_payload);

    let run_id = uuid::Uuid::new_v4().to_string();
    let pid = child.id().unwrap_or(0);
    // Detach both pipes while we still own the child outright. A missing pipe
    // after spawn is fatal: kill the child so it cannot run unobserved and
    // unregistered.
    let (stdout, stderr) = {
        let pipes = child.stdout.take().zip(child.stderr.take());
        match pipes {
            Some(pair) => pair,
            None => {
                let _ = child.start_kill();
                for path in &launch.built.cleanup_files {
                    let _ = std::fs::remove_file(path);
                }
                return Err("missing stdout/stderr pipe after spawn".to_string());
            }
        }
    };
    let child = Arc::new(TokioMutex::new(child));
    let killed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    state.processes.insert(
        run_id.clone(),
        ChildEntry {
            child: Arc::clone(&child),
            pid,
            run_id: run_id.clone(),
            killed: Arc::clone(&killed),
        },
    );

    let stderr_buf = spawn_stderr_capture(stderr);
    let ctx = RunContext {
        sink: Arc::clone(&state.sink),
        registry: Arc::clone(&state.processes),
        engine_impl: launch.engine_impl,
        engine_id: engine.clone(),
        run_id: run_id.clone(),
        pid,
        preassigned_session_id: launch.built.preassigned_session_id.clone(),
        child,
        killed,
        cleanup_files: launch.built.cleanup_files,
        stderr_buf,
    };
    tokio::spawn(run_reader(stdout, ctx));

    Ok(SendResult {
        run_id,
        session_id: launch.built.preassigned_session_id,
    })
}

#[tauri::command]
pub fn interrupt_session(state: tauri::State<'_, crate::AppState>, session_id: String) -> bool {
    state.processes.kill(&session_id)
}

#[cfg(test)]
mod permission_tests {
    use super::*;

    fn req(permission: Option<&str>) -> SendRequest {
        SendRequest {
            session_id: None,
            workspace: PathBuf::from("/tmp"),
            prompt: "hi".to_string(),
            images: Vec::new(),
            model: None,
            effort: None,
            permission: permission.map(str::to_string),
        }
    }

    fn argv(engine: &dyn Engine, req: &SendRequest) -> Vec<String> {
        let built = engine.build_command(req, "fake-bin").unwrap();
        built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect()
    }

    #[test]
    fn unsupported_mode_falls_back_to_first_supported() {
        let codex = codex::CodexEngine;
        assert_eq!(codex.resolve_permission(Some("plan")), "auto");
        assert_eq!(codex.resolve_permission(Some("manual")), "manual");
        assert_eq!(codex.resolve_permission(None), "auto");
        let grok = grok::GrokEngine;
        assert_eq!(grok.resolve_permission(Some("auto")), "bypass");
    }

    #[test]
    fn claude_maps_modes_to_permission_flags() {
        let e = claude::ClaudeEngine;
        let auto = argv(&e, &req(Some("auto")));
        assert!(auto.contains(&"--permission-mode".to_string()));
        assert!(auto.contains(&"acceptEdits".to_string()));
        assert!(!auto.contains(&"--dangerously-skip-permissions".to_string()));

        let manual = argv(&e, &req(Some("manual")));
        assert!(manual.contains(&"default".to_string()));

        let plan = argv(&e, &req(Some("plan")));
        assert!(plan.contains(&"plan".to_string()));

        let bypass = argv(&e, &req(Some("bypass")));
        assert!(bypass.contains(&"--dangerously-skip-permissions".to_string()));
        assert!(!bypass.contains(&"--permission-mode".to_string()));
    }

    #[test]
    fn codex_maps_modes_to_sandbox_flags() {
        let e = codex::CodexEngine;
        let auto = argv(&e, &req(Some("auto")));
        assert!(auto.contains(&"sandbox_mode=\"workspace-write\"".to_string()));
        assert!(!auto.contains(&"--dangerously-bypass-approvals-and-sandbox".to_string()));

        let manual = argv(&e, &req(Some("manual")));
        assert!(manual.contains(&"sandbox_mode=\"read-only\"".to_string()));

        let bypass = argv(&e, &req(Some("bypass")));
        assert!(bypass.contains(&"--dangerously-bypass-approvals-and-sandbox".to_string()));
    }

    #[test]
    fn codex_resume_avoids_unsupported_sandbox_flag() {
        // `codex exec resume` rejects --sandbox (clap exit 2); the sandbox must
        // travel via -c sandbox_mode on both fresh and resumed sessions.
        let e = codex::CodexEngine;
        let mut resume = req(Some("manual"));
        resume.session_id = Some("00000000-0000-0000-0000-000000000000".to_string());
        let args = argv(&e, &resume);
        assert!(args.contains(&"resume".to_string()));
        assert!(!args.contains(&"--sandbox".to_string()));
        assert!(args.contains(&"sandbox_mode=\"read-only\"".to_string()));

        let fresh = argv(&e, &req(Some("auto")));
        assert!(!fresh.contains(&"--sandbox".to_string()));
        assert!(fresh.contains(&"sandbox_mode=\"workspace-write\"".to_string()));
    }

    #[test]
    fn kimi_maps_plan_and_bypass() {
        let e = kimi::KimiEngine;
        let auto = argv(&e, &req(Some("auto")));
        assert!(!auto.contains(&"--yolo".to_string()));
        assert!(!auto.contains(&"--plan".to_string()));

        let plan = argv(&e, &req(Some("plan")));
        assert!(plan.contains(&"--plan".to_string()));

        let bypass = argv(&e, &req(Some("bypass")));
        assert!(bypass.contains(&"--yolo".to_string()));

        // Manual is unsupported: falls back to auto (no flags).
        let manual = argv(&e, &req(Some("manual")));
        assert!(!manual.contains(&"--yolo".to_string()));
        assert!(!manual.contains(&"--plan".to_string()));
    }

    #[test]
    fn grok_always_approves_regardless_of_request() {
        let e = grok::GrokEngine;
        for mode in [
            Some("auto"),
            Some("manual"),
            Some("plan"),
            Some("bypass"),
            None,
        ] {
            assert!(argv(&e, &req(mode)).contains(&"--always-approve".to_string()));
        }
    }
}
