pub mod claude;
pub mod codex;
mod codex_provider_env;
mod codex_usage;
pub mod dsh;
mod dsh_session;
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
use std::path::{Path, PathBuf};
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
    /// Reasoning effort ("low" | "medium" | "high" | "xhigh" | "max" | "ultra"); engines without an
    /// effort knob ignore it, engines with a narrower knob clamp.
    pub effort: Option<String>,
    /// OpenAI service tier override (OMP `--service-tier` / Codex `-c service_tier`),
    /// independent of reasoning effort.
    pub service_tier: Option<String>,
    /// Permission mode ("auto" | "manual" | "plan" | "bypass"); each engine
    /// resolves it against the modes it can actually honor at spawn (see
    /// `Engine::resolve_permission`).
    pub permission: Option<String>,
    /// User-granted extra directories (db `granted_roots`); claude launches
    /// pass them as `--add-dir` so reads outside the workspace stop hitting
    /// headless permission denials. Engines without an equivalent flag
    /// ignore them.
    pub additional_dirs: Vec<String>,
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
    /// Streaming text delta (append).
    Delta(String),
    /// Reasoning/thinking delta (append).
    Thinking(String),
    /// A completed message block (role, text). `path` carries the target
    /// file of a tool call (read/edit/write/...) so the UI can render a
    /// file chip; None for everything else. `args` is the tool-call payload
    /// (pretty-printed in the timeline). `patch` updates the oldest
    /// still-incomplete tool row of the same name (claude streams args
    /// after the name-only start).
    Message {
        role: String,
        text: String,
        path: Option<String>,
        /// Todo-list snapshot/patch from a todo tool call (claude TodoWrite,
        /// omp todo op); feeds the run-status strip's task pill.
        todos: Option<TodosPayload>,
        args: Option<Value>,
        result: Option<Value>,
        patch: bool,
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
    /// A tool call was denied by the CLI's permission system (headless mode
    /// cannot prompt). `path` is the denied absolute path when the denial
    /// text or tool input carries one — the UI offers a directory grant for
    /// it; `tool` is the denied tool name when known.
    PermissionDenied {
        tool: Option<String>,
        path: Option<String>,
        message: String,
    },
    /// Turn finished successfully.
    Done {
        session_id: Option<String>,
        usage: Option<Value>,
    },
    /// Actual model ID emitted by the engine or resolved at launch.
    Model(String),
}

/// One todo entry carried to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct TodoItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub content: String,
    pub status: String,
}

/// `replace: true` is a full snapshot of the todo list; `false` is a patch
/// the frontend applies by matching on `content`.
#[derive(Debug, Clone, Serialize)]
pub struct TodosPayload {
    pub items: Vec<TodoItem>,
    pub replace: bool,
}

/// Drop empty / null payloads so the UI does not render a blank args panel.
/// JSON-encoded strings (OpenAI-style `function.arguments`) are parsed first.
pub(crate) fn parse_tool_args_value(value: &Value) -> Option<Value> {
    match value {
        Value::Null => None,
        Value::Object(map) if map.is_empty() => None,
        Value::Array(items) if items.is_empty() => None,
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                return None;
            }
            match serde_json::from_str::<Value>(trimmed) {
                Ok(parsed) => parse_tool_args_value(&parsed).or_else(|| Some(Value::String(trimmed.to_string()))),
                Err(_) => Some(Value::String(trimmed.to_string())),
            }
        }
        other => Some(other.clone()),
    }
}

/// Tool-call start: name plus parsed args (path / todos derived from args).
pub(crate) fn tool_call_message(name: impl Into<String>, args: Option<&Value>) -> EngineEvent {
    let name = name.into();
    let args = args.and_then(parse_tool_args_value);
    let todos = args.as_ref().and_then(parse_todo_args);
    EngineEvent::Message {
        role: "tool".to_string(),
        text: name,
        path: args.as_ref().and_then(tool_path_arg),
        todos,
        args,
        result: None,
        patch: false,
    }
}

/// Same as [`tool_call_message`] but patches the matching in-flight tool row.
pub(crate) fn tool_call_patch(name: impl Into<String>, args: Option<&Value>) -> EngineEvent {
    match tool_call_message(name, args) {
        EngineEvent::Message {
            role,
            text,
            path,
            todos,
            args,
            ..
        } => EngineEvent::Message {
            role,
            text,
            path,
            todos,
            args,
            result: None,
            patch: true,
        },
        other => other,
    }
}

/// Patches execution result onto the matching in-flight tool row.
pub(crate) fn tool_result_patch(name: impl Into<String>, result: Option<&Value>) -> EngineEvent {
    EngineEvent::Message {
        role: "tool".to_string(),
        text: name.into(),
        path: None,
        todos: None,
        args: None,
        result: result.cloned(),
        patch: true,
    }
}

/// Assistant snapshot with no tool metadata.
pub(crate) fn assistant_message(text: String) -> EngineEvent {
    EngineEvent::Message {
        role: "assistant".to_string(),
        text,
        path: None,
        todos: None,
        args: None,
        result: None,
        patch: false,
    }
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

/// Parse a tool call's args into a todo-list payload. Two shapes: claude's
/// TodoWrite (`todos` array, a full snapshot) and the omp harness todo
/// protocol (`op` + task/list, mostly patches). None when the args carry
/// no todo data.
pub(crate) fn parse_todo_args(args: &Value) -> Option<TodosPayload> {
    // Normal tools (e.g. Bash, Edit, Read, Write) carry command or file_path;
    // their description must NEVER be mistaken for a Todo item.
    if args.get("command").is_some()
        || args.get("file_path").is_some()
        || args.get("filePath").is_some()
        || args.get("pattern").is_some()
    {
        return None;
    }

    let pending_item = |content: &str| TodoItem {
        id: None,
        content: content.to_string(),
        status: "pending".to_string(),
    };
    // `list` phases, each with an `items` string array, flattened.
    let phase_items = |args: &Value| -> Vec<TodoItem> {
        args.get("list")
            .and_then(Value::as_array)
            .map(|phases| {
                phases
                    .iter()
                    .filter_map(|phase| phase.get("items").and_then(Value::as_array))
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(pending_item)
                    .collect()
            })
            .unwrap_or_default()
    };
    if let Some(todos) = args.get("todos").and_then(Value::as_array) {
        let items = todos
            .iter()
            .filter_map(|entry| {
                let content = ["content", "text", "title", "task", "subject"]
                    .iter()
                    .filter_map(|key| entry.get(key).and_then(Value::as_str))
                    .map(|s| s.trim())
                    .find(|s| !s.is_empty())?;
                let status = match entry.get("status").and_then(Value::as_str).unwrap_or("") {
                    "in_progress" | "running" | "active" => "active",
                    "completed" | "complete" | "done" => "complete",
                    "blocked" => "blocked",
                    _ => "pending",
                };
                let id = entry
                    .get("id")
                    .or_else(|| entry.get("taskId"))
                    .and_then(Value::as_str)
                    .map(|s| s.to_string());
                Some(TodoItem {
                    id,
                    content: content.to_string(),
                    status: status.to_string(),
                })
            })
            .collect();
        return Some(TodosPayload {
            items,
            replace: true,
        });
    }

    // TaskCreate tool call support: MUST have explicit `subject` (never fallback to tool description)
    if let Some(subject) = args
        .get("subject")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if args.get("taskId").is_none() && args.get("op").is_none() {
            let status = match args.get("status").and_then(Value::as_str).unwrap_or("") {
                "in_progress" | "running" | "active" => "active",
                "completed" | "complete" | "done" => "complete",
                "blocked" => "blocked",
                _ => "pending",
            };
            return Some(TodosPayload {
                items: vec![TodoItem {
                    id: None,
                    content: subject.to_string(),
                    status: status.to_string(),
                }],
                replace: false,
            });
        }
    }

    // TaskUpdate tool call support: MUST have `taskId`
    if let Some(task_id) = args
        .get("taskId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let content = args
            .get("subject")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("");
        let status = match args.get("status").and_then(Value::as_str).unwrap_or("") {
            "in_progress" | "running" | "active" => "active",
            "completed" | "complete" | "done" => "complete",
            "blocked" => "blocked",
            "deleted" => "dropped",
            _ => "pending",
        };
        return Some(TodosPayload {
            items: vec![TodoItem {
                id: Some(task_id.to_string()),
                content: content.to_string(),
                status: status.to_string(),
            }],
            replace: false,
        });
    }

    let op = args.get("op").and_then(Value::as_str)?;
    match op {
        "init" => Some(TodosPayload {
            items: phase_items(args),
            replace: true,
        }),
        "append" => {
            let items = match args.get("items").and_then(Value::as_array) {
                Some(items) => items.iter().filter_map(Value::as_str).map(pending_item).collect(),
                None => phase_items(args),
            };
            Some(TodosPayload {
                items,
                replace: false,
            })
        }
        "start" | "done" | "block" | "unblock" | "drop" => {
            let task = args.get("task").and_then(Value::as_str)?;
            let status = match op {
                "start" => "active",
                "done" => "complete",
                "block" => "blocked",
                "unblock" => "pending",
                _ => "dropped",
            };
            Some(TodosPayload {
                items: vec![TodoItem {
                    id: None,
                    content: task.to_string(),
                    status: status.to_string(),
                }],
                replace: false,
            })
        }
        "rm" | "clear" => Some(TodosPayload {
            items: Vec::new(),
            replace: true,
        }),
        _ => None,
    }
}

pub trait Engine: Send + Sync {
    fn id(&self) -> &'static str;
    fn build_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String>;
    /// Parse one NDJSON stdout line into zero or more events.
    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>);
    /// True when the engine drives its own transport (e.g. a host WS session)
    /// instead of spawning a child process. send_message routes these to a
    /// virtual run: no spawn, no pid — the registry entry carries only the
    /// abort handle, and the transport task settles the turn itself.
    fn drives_own_transport(&self) -> bool {
        false
    }
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
        "claude" => Some(Box::new(claude::ClaudeEngine::new())),
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
    fallback_home().join(default_dir)
}

/// Codex config/session home. Settings override wins in production so CLI
/// 管理's directory is what history, official config, and `codex exec` all
/// read — not a leftover `~/.codex` default. Tests keep using `CODEX_HOME`
/// / `HOME/.codex` so HomeGuard scratch dirs stay isolated.
pub(crate) fn codex_home() -> PathBuf {
    #[cfg(not(test))]
    if let Some(path) = settings_codex_home() {
        return path;
    }
    engine_home(Some("CODEX_HOME"), ".codex")
}

#[cfg(not(test))]
fn settings_codex_home() -> Option<PathBuf> {
    let custom = crate::settings::read_settings().ok()?.codex_home?;
    let trimmed = custom.trim();
    if trimmed.is_empty() {
        return None;
    }
    crate::open_app::expand_user_path(trimmed).ok()
}

/// Home dir for the default engine path. Production uses `dirs` (Known
/// Folder API on Windows); tests steer the fallback through HOME /
/// USERPROFILE env instead, because `dirs` ignores env on Windows and would
/// scan the real profile.
fn fallback_home() -> PathBuf {
    #[cfg(test)]
    {
        if let Some(home) = std::env::var_os("HOME").filter(|v| !v.is_empty()) {
            return PathBuf::from(home);
        }
        #[cfg(windows)]
        if let Some(profile) = std::env::var_os("USERPROFILE").filter(|v| !v.is_empty()) {
            return PathBuf::from(profile);
        }
    }
    dirs::home_dir().unwrap_or_default()
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
/// known, otherwise the run id). Drop kills everything synchronously. Clone
/// is a refcount bump: the registry keys the same child under BOTH keys —
/// its run id and its session id (preassigned at spawn, or adopted via
/// `rekey`) — so either route can interrupt it.
#[derive(Clone)]
pub struct ChildEntry {
    /// The child process. `None` for virtual runs (host-stream engines): the
    /// entry then only routes interrupt to the transport task via `killed` /
    /// `reader_abort`, and `pid` is a synthetic identity token (see
    /// `next_virtual_pid`), never a real process id.
    pub child: Option<Arc<TokioMutex<Child>>>,
    pub pid: u32,
    /// The run id this entry started under; after a rekey the map key is the
    /// native session id, but the frontend may still cancel by run id.
    pub run_id: String,
    /// Set by `kill()`: a user-initiated stop is not an error — at EOF the
    /// runner commits the partial turn as done instead of pushing a bogus
    /// "exited with status …" error.
    pub killed: Arc<std::sync::atomic::AtomicBool>,
    /// Abort handle for this run's detached stdout-reader task, set by
    /// send_message right after spawn (a OnceLock so registry insertion
    /// still happens before the task starts). A child that closed stdout
    /// but refuses to die would park the reader on `wait()` forever,
    /// pinning the registry/EventSink/engine Arcs it owns: kill() aborts
    /// the reader after a settle grace, kill_all() aborts immediately.
    pub reader_abort: Arc<std::sync::OnceLock<tokio::task::AbortHandle>>,
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

    /// Register a second lookup key for the same live child without
    /// replacing an unrelated concurrent run. A resumed session is keyed
    /// here at spawn: its id is preassigned, so the engine's own session
    /// announcement equals it and never triggers a rekey.
    fn insert_alias(&self, key: String, entry: ChildEntry) {
        if let Ok(mut map) = self.0.lock() {
            if !map.contains_key(&key) {
                map.insert(key, entry);
            }
        }
    }

    /// Copy the entry to the native-session key once known. The run_id key
    /// STAYS: the frontend interrupts by session id and by run id (a resume
    /// whose session-id announcement never arrives leaves run id as the only
    /// route), and a moving rekey closed exactly that path — the user hit
    /// Stop, the by-run-id lookup found nothing, and the CLI kept streaming.
    /// `kill` de-duplicates by pid: hitting both keys kills the tree once.
    /// A colliding target key belongs to another live run — never overwrite.
    fn rekey(&self, from: &str, to: String) {
        if from == to {
            return;
        }
        if let Ok(mut map) = self.0.lock() {
            if map.contains_key(&to) {
                return;
            }
            if let Some(entry) = map.get(from).cloned() {
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
    /// already reaped — nothing left to signal. Virtual runs (no child) only
    /// raise the killed flag: the transport task observes it on its next
    /// loop tick, cancels the host-side turn, and settles the turn itself.
    fn kill_entry(child: Option<&Arc<TokioMutex<tokio::process::Child>>>, pid: u32, killed: &Arc<std::sync::atomic::AtomicBool>) -> bool {
        killed.store(true, std::sync::atomic::Ordering::SeqCst);
        let Some(child) = child else {
            return true;
        };
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
        let mut entries: Vec<(u32, Option<Arc<TokioMutex<tokio::process::Child>>>, Arc<std::sync::atomic::AtomicBool>, Arc<std::sync::OnceLock<tokio::task::AbortHandle>>)> =
            match self.0.lock() {
                Ok(map) => {
                    let mut seen_pids = std::collections::HashSet::new();
                    map.iter()
                        .filter(|(k, e)| *k == key || e.run_id == key)
                        .filter(|(_, e)| seen_pids.insert(e.pid))
                        .map(|(_, e)| (e.pid, e.child.clone(), Arc::clone(&e.killed), Arc::clone(&e.reader_abort)))
                        .collect()
                }
                Err(_) => Vec::new(),
            };
        // The registry keys one child under BOTH its session id and run id
        // (rekey copies): de-duplicate by pid so one stop fires one
        // taskkill, not one per key.
        entries.sort_by_key(|(pid, _, _, _)| *pid);
        entries.dedup_by_key(|(pid, _, _, _)| *pid);
        // No Iterator::any here: it short-circuits on the first true, which
        // would leave every later parallel run alive — the exact bug this
        // aggregate kill exists to fix.
        let mut killed_any = false;
        for (pid, child, killed, _) in &entries {
            killed_any |= Self::kill_entry(child.as_ref(), *pid, killed);
        }
        // Backstop for a child that ignores SIGKILL (uninterruptible
        // sleep): its reader parks on wait() after EOF, pinning the Arcs it
        // owns. Abort it after a grace long enough for a healthy settle
        // (kill → EOF → wait → terminal event, milliseconds in practice) —
        // on an already-finished task abort is a no-op, so normal stop
        // semantics are unchanged. kill() only runs inside a runtime
        // (spawn_blocking callers), so tokio::spawn is safe here.
        for (_, _, _, reader_abort) in &entries {
            if let Some(handle) = reader_abort.get() {
                let handle = handle.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(READER_SETTLE_GRACE).await;
                    handle.abort();
                });
            }
        }
        killed_any
    }

    pub fn kill_all(&self) {
        // Blocking lock on the teardown path: skipping children because the
        // lock was briefly contended would leak engine processes.
        let mut entries: Vec<ChildEntry> = match self.0.lock() {
            Ok(mut map) => map.drain().map(|(_, e)| e).collect(),
            Err(poisoned) => poisoned.into_inner().drain().map(|(_, e)| e).collect(),
        };
        // rekey keys one child under BOTH its session id and run id:
        // de-duplicate by pid or the sweep signals the same process group
        // twice (a second, doomed taskkill on Windows).
        entries.sort_by_key(|e| e.pid);
        entries.dedup_by_key(|e| e.pid);
        for entry in entries {
            // Virtual runs own no process group; their task aborts below/via
            // the abort handle.
            if let Some(child) = entry.child.as_ref() {
                kill_process_group(entry.pid);
                if let Ok(mut guard) = child.try_lock() {
                    let _ = guard.start_kill();
                }
            }
            // Teardown: abort the reader outright so it drops its
            // registry/sink Arcs now instead of parking on wait() past
            // exit. Settle events would go nowhere anyway (the window is
            // being destroyed).
            if let Some(handle) = entry.reader_abort.get() {
                handle.abort();
            }
        }
    }
}

impl Drop for ProcessRegistry {
    fn drop(&mut self) {
        // &mut self makes locking unnecessary; poisoning must not skip the
        // kill sweep either (a panicked run leaves live children).
        let map = self.0.get_mut().unwrap_or_else(|e| e.into_inner());
        let mut entries: Vec<ChildEntry> = map.drain().map(|(_, e)| e).collect();
        // Same double-keying as kill_all: signal each process group once.
        entries.sort_by_key(|e| e.pid);
        entries.dedup_by_key(|e| e.pid);
        for entry in entries {
            // Virtual runs own no process group; their task aborts below/via
            // the abort handle.
            if let Some(child) = entry.child.as_ref() {
                kill_process_group(entry.pid);
                if let Ok(mut guard) = child.try_lock() {
                    let _ = guard.start_kill();
                }
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
/// real CLI (node/bun) is a grandchild. `taskkill /T /F` walks the tree from
/// the wrapper down.
///
/// This MUST complete before the caller terminates the direct child. It used
/// to be fire-and-forget, and `kill_entry`'s `start_kill()` killed the
/// wrapper first: by the time taskkill ran, its target pid was gone, the
/// tree walk found nothing, and the real CLI kept streaming as an orphan
/// (dangling ppid) long after the user pressed Stop. Waiting here is what
/// makes the stop button actually stop the engine.
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
    let Ok(mut killer) = command.spawn() else {
        return;
    };
    // Bounded: app teardown sweeps every child, and a wedged taskkill must
    // not hang the exit path. Normal completion is tens of milliseconds.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        match killer.try_wait() {
            Ok(Some(_)) | Err(_) => return,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    }
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

fn codex_bin_from_home(settings: &crate::settings::AppSettings) -> Option<String> {
    let home = settings.codex_home.as_deref()?.trim();
    if home.is_empty() {
        return None;
    }
    let expanded = crate::open_app::expand_user_path(home).ok()?;
    let candidate = expanded.join("bin").join("codex");
    candidate.exists().then(|| resolve::resolve_launchable_cli_binary(&candidate.to_string_lossy()))
}

pub(crate) fn engine_bin(settings: &crate::settings::AppSettings, engine_id: &str) -> String {
    if engine_id == "codex" {
        if let Some(from_home) = codex_bin_from_home(settings) {
            return from_home;
        }
    }
    if let Some(custom) = settings.bin_override(engine_id) {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            // Defense in depth: settings write validates too, but the file
            // may have been hand-edited since.
            match crate::settings::validate_bin_override(trimmed) {
                Ok(path) => return resolve::resolve_launchable_cli_binary(&path.to_string_lossy()),
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
                _ if *id == "codex" && codex_bin_from_home(&settings).is_some() => true,
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
/// Grace between a Stop kill and force-aborting the reader task. A healthy
/// settle (kill → EOF → wait → terminal event) finishes in milliseconds;
/// the abort only fires when a killed child still won't die and the reader
/// would otherwise park on `wait()` forever.
const READER_SETTLE_GRACE: std::time::Duration = std::time::Duration::from_secs(10);

/// Hard cap on one NDJSON line from an engine. Real events are kilobytes;
/// `BufReader::lines` has no limit, so a runaway engine writing without
/// newlines would buffer the line whole and OOM the host.
const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;

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
    additional_dirs: Vec<String>,
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
        service_tier: match engine {
            "omp" => settings.omp_openai_service_tier.clone(),
            "codex" => settings.codex_service_tier.clone(),
            _ => None,
        },
        permission: permission.filter(|p| !p.trim().is_empty()),
        // Cap defensively: the list lands on a command line, and a
        // hand-edited db should not produce an argv bomb.
        additional_dirs: additional_dirs
            .into_iter()
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty() && Path::new(d).is_absolute())
            .take(32)
            .collect(),
    };
    let bin = engine_bin(&settings, engine);
    // Host-stream engines never spawn: hand back a placeholder command so
    // prepare_launch stays shape-compatible; send_message branches to the
    // virtual path before anything would touch it.
    let built = if engine_impl.drives_own_transport() {
        BuiltCommand {
            command: Command::new("unused-virtual-engine"),
            stdin_payload: None,
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        }
    } else {
        engine_impl.build_command(&req, &bin)?
    };
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
    // NOTE: TurnState lives for the whole process (one run_reader per
    // spawn), so once saw_error is set every later Done in this process
    // is suppressed. That is correct for the current one-process-per-turn
    // engines (omp --print, codex exec); a future multi-turn-per-process
    // engine must reset this per turn instead.
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
    core: TurnCore,
    engine_impl: Box<dyn Engine>,
    pid: u32,
    /// Session id fixed before spawn (grok `-s`); seeds TurnState.
    preassigned_session_id: Option<String>,
    initial_model: Option<String>,
    child: Arc<TokioMutex<Child>>,
    killed: Arc<std::sync::atomic::AtomicBool>,
    cleanup_files: Vec<PathBuf>,
    stderr_buf: Arc<Mutex<String>>,
}

/// Event-routing core shared by process runs ([`RunContext`]) and virtual
/// host-stream runs ([`dsh_session::run_host_turn`]): the fields
/// `dispatch_event` needs to route engine events to the UI sink and keep the
/// registry's session aliasing in step.
pub(crate) struct TurnCore {
    pub(crate) sink: Arc<event_sink::EventSink>,
    pub(crate) registry: Arc<ProcessRegistry>,
    pub(crate) engine_id: String,
    pub(crate) run_id: String,
}

impl TurnCore {
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
            EngineEvent::Message {
                role,
                text,
                path,
                todos,
                args,
                result,
                patch,
            } => {
                let mut payload = serde_json::json!({ "role": role, "text": text });
                if let Some(path) = path {
                    payload["path"] = Value::String(path);
                }
                if let Some(todos) = todos {
                    if let Ok(value) = serde_json::to_value(todos) {
                        payload["todos"] = value;
                    }
                }
                if let Some(args) = args {
                    payload["args"] = args;
                }
                if let Some(result) = result {
                    payload["result"] = result;
                }
                if patch {
                    payload["patch"] = Value::Bool(true);
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
                // The turn failed terminally: the frontend settles (send
                // button back to idle) on this event, so a still-running
                // CLI process would keep burning tokens invisibly while the
                // UI claims the session ended. Kill the process tree now —
                // the killed flag makes the runner's EOF path a no-op
                // (saw_error already settled the turn) and the registry
                // entry drains as usual.
                //
                // Off the reader thread: the kill blocks on the Windows tree
                // walk, and stalling this task would also stall the stdout
                // drain it owns. saw_error already settled the turn, so
                // nothing here depends on the kill completing first.
                let registry = Arc::clone(&self.registry);
                let run_id = self.run_id.clone();
                tokio::task::spawn_blocking(move || registry.kill(&run_id));
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
            EngineEvent::PermissionDenied {
                tool,
                path,
                message,
            } => {
                // Not terminal either: the CLI works around the denial and
                // the turn continues — the UI offers the grant alongside.
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "permission_denied",
                    serde_json::json!({ "tool": tool, "path": path, "message": message }),
                );
            }
            EngineEvent::Model(model) => {
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "model",
                    Value::String(model),
                );
            }
            EngineEvent::Done { session_id, usage } => {
                // A Done after a terminal Error must never reach the UI: it
                // clears the error banner and flips a failed turn back to
                // "success" in the footer. Engines can emit both in one
                // flush (omp: turn_end error, then agent_end done).
                if state.saw_error {
                    return;
                }
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

impl RunContext {
    fn dispatch_event(&self, state: &mut TurnState, event: EngineEvent) {
        self.core.dispatch_event(state, event);
    }
}

/// One line read from the engine's stdout, size-capped.
enum LineRead {
    /// A complete line, newline terminator stripped (may be empty).
    Line(Vec<u8>),
    /// Clean EOF.
    Eof,
    /// No newline within MAX_LINE_BYTES: the run must be torn down.
    TooLong,
}

/// Cancellation-safe replacement for `BufReader::lines().next_line()` with a
/// hard byte cap: partial bytes live in the caller-owned `line`, and the
/// only await is `fill_buf`, so a `tokio::select!` tick landing mid-line
/// consumes and drops nothing — the property the old code relied on
/// `next_line` for (a cancelled `read_line` would lose the partial bytes).
async fn read_line_capped(
    reader: &mut BufReader<ChildStdout>,
    line: &mut Vec<u8>,
) -> std::io::Result<LineRead> {
    line.clear();
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok(if line.is_empty() {
                LineRead::Eof
            } else {
                // EOF mid-line: deliver the partial line, like next_line.
                LineRead::Line(std::mem::take(line))
            });
        }
        let end = available
            .iter()
            .position(|b| *b == b'\n')
            .unwrap_or(available.len());
        if line.len() + end > MAX_LINE_BYTES {
            return Ok(LineRead::TooLong);
        }
        line.extend_from_slice(&available[..end]);
        let has_newline = end < available.len();
        // Consume the newline too when present. No await between extend and
        // consume, so cancellation cannot split the pair.
        reader.consume(end + usize::from(has_newline));
        if has_newline {
            return Ok(LineRead::Line(std::mem::take(line)));
        }
    }
}

/// Read NDJSON stdout until EOF, dispatch events, then settle the turn:
/// registry cleanup, temp-file cleanup, and the terminal done/error event.
async fn run_reader(stdout: ChildStdout, ctx: RunContext) {
    let mut state = TurnState::new(ctx.preassigned_session_id.clone());
    if let Some(model) = ctx.initial_model.clone() {
        ctx.dispatch_event(&mut state, EngineEvent::Model(model));
    }
    // codex reports usage into its own session log instead of the stdout
    // stream (the stream only carries it with `turn.completed`), so a long
    // turn would otherwise show nothing until it ended. Poll that log
    // alongside the stream once the thread id is known. `read_line_capped`
    // is what makes the select safe: partial bytes stay in the caller-owned
    // buffer across polls, so a tick landing mid-line consumes and drops
    // nothing, and one runaway line can't grow without bound.
    let mut reader = BufReader::new(stdout);
    let mut line_buf = Vec::new();
    let is_codex = ctx.core.engine_id == "codex";
    let mut usage_tail: Option<codex_usage::UsageTail> = None;
    // Only the stream's own thread id (thread.started) may open the log: a
    // resumed run's preassigned id can name a thread the CLI is no longer
    // writing to, and tailing that file would miss this run's reports.
    let mut stream_session_id = false;
    // The CLI writes the rollout at thread start, so the open normally
    // succeeds on the first tick. Bound the retries anyway: each one walks
    // the whole `sessions/**` tree, and a run whose home is not the one being
    // written would walk it every tick for the length of the turn.
    let mut tail_attempts = 0u32;
    let mut poll = tokio::time::interval(std::time::Duration::from_millis(500));
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        let read = if is_codex {
            tokio::select! {
                line = read_line_capped(&mut reader, &mut line_buf) => line,
                _ = poll.tick() => {
                    if let Some(tail) = usage_tail.as_mut() {
                        for usage in tail.poll() {
                            ctx.dispatch_event(&mut state, EngineEvent::Usage(usage));
                        }
                    } else if stream_session_id && tail_attempts < 20 {
                        // The CLI creates the log a moment after the thread
                        // id arrives. Attempt every tick rather than backing
                        // off: the tail starts at the file's end, so any wait
                        // here is a window in which a record lands unread.
                        tail_attempts += 1;
                        usage_tail = state
                            .native_session_id
                            .as_deref()
                            .and_then(codex_usage::UsageTail::open);
                    }
                    continue;
                }
            }
        } else {
            read_line_capped(&mut reader, &mut line_buf).await
        };
        let line = match read {
            Ok(LineRead::Line(bytes)) => bytes,
            Ok(LineRead::Eof) => break,
            Ok(LineRead::TooLong) => {
                // A line this large is never a real event — the engine is
                // stuck writing garbage. Settle the turn as a terminal
                // error; dispatch also kills the process tree off-thread.
                ctx.dispatch_event(
                    &mut state,
                    EngineEvent::Error(format!(
                        "{} emitted a line over {} MiB without a newline; run terminated",
                        ctx.core.engine_id,
                        MAX_LINE_BYTES / (1024 * 1024),
                    )),
                );
                break;
            }
            Err(_) => break,
        };
        let text = String::from_utf8_lossy(&line);
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        state.saw_any_output = true;
        let mut events = Vec::new();
        ctx.engine_impl.parse_line(trimmed, &mut events);
        stream_session_id |= events
            .iter()
            .any(|event| matches!(event, EngineEvent::SessionId(_)));
        for event in events {
            ctx.dispatch_event(&mut state, event);
        }
    }

    // Last look at the session log: the final response's record may have
    // landed after the last poll tick.
    if let Some(tail) = usage_tail.as_mut() {
        for usage in tail.poll() {
            ctx.dispatch_event(&mut state, EngineEvent::Usage(usage));
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
    // Drain this run's registry entries: under the native session id after
    // rekey, and under the run id when the session id never arrived.
    if let Some(key) = state.native_session_id.clone() {
        ctx.core.registry.remove_if_pid(&key, ctx.pid);
    }
    ctx.core.registry.remove_if_pid(&ctx.core.run_id, ctx.pid);
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
            &ctx.core.sink,
            &ctx.core.run_id,
            &ctx.core.engine_id,
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
                &ctx.core.sink,
                &ctx.core.run_id,
                &ctx.core.engine_id,
                "done",
                serde_json::json!({ "usage": null }),
            );
        } else if failed || !state.saw_any_output {
            let mut message = format!(
                "{} exited with status {}",
                ctx.core.engine_id,
                status
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "unknown".to_string())
            );
            if !stderr_tail.is_empty() {
                message.push_str(&format!(": {stderr_tail}"));
            }
            state.push(
                &ctx.core.sink,
                &ctx.core.run_id,
                &ctx.core.engine_id,
                "error",
                Value::String(message),
            );
        } else {
            // Clean EOF without an explicit done line (kimi).
            state.push(
                &ctx.core.sink,
                &ctx.core.run_id,
                &ctx.core.engine_id,
                "done",
                serde_json::json!({ "usage": null }),
            );
        }
    }
    ctx.core.sink.flush();
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
        // Every user-granted directory rides along as a launch argument, so
        // a grant approved mid-conversation takes effect on the next send
        // (each send is a fresh process).
        state.db.granted_roots().unwrap_or_default(),
    )?;

    // Host-stream engines drive their own transport: no child process — the
    // registry entry only routes interrupts to the transport task.
    if launch.engine_impl.drives_own_transport() {
        return send_host_stream(state, launch, engine).await;
    }

    let mut command = launch.built.command;
    if engine == "codex" {
        codex_provider_env::apply(&mut command).await;
    }
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
    let reader_abort = Arc::new(std::sync::OnceLock::new());
    state.processes.insert(
        run_id.clone(),
        ChildEntry {
            child: Some(Arc::clone(&child)),
            pid,
            run_id: run_id.clone(),
            killed: Arc::clone(&killed),
            reader_abort: Arc::clone(&reader_abort),
        },
    );
    if let Some(session_id) = launch.built.preassigned_session_id.as_deref() {
        state.processes.insert_alias(
            session_id.to_string(),
            ChildEntry {
                child: Some(Arc::clone(&child)),
                pid,
                run_id: run_id.clone(),
                killed: Arc::clone(&killed),
                reader_abort: Arc::clone(&reader_abort),
            },
        );
    }

    let stderr_buf = spawn_stderr_capture(stderr);
    let initial_model = if engine == "claude" {
        launch
            .req
            .model
            .as_deref()
            .map(models::resolve_claude_launch_model)
            .or_else(|| Some(models::resolve_claude_launch_model("default")))
            .filter(|m| !m.is_empty())
    } else {
        launch.req.model.clone()
    };
    let ctx = RunContext {
        core: TurnCore {
            sink: Arc::clone(&state.sink),
            registry: Arc::clone(&state.processes),
            engine_id: engine.clone(),
            run_id: run_id.clone(),
        },
        engine_impl: launch.engine_impl,
        pid,
        preassigned_session_id: launch.built.preassigned_session_id.clone(),
        initial_model,
        child,
        killed,
        cleanup_files: launch.built.cleanup_files,
        stderr_buf,
    };
    let reader = tokio::spawn(run_reader(stdout, ctx));
    // Registration order is unchanged (entries land before the task can
    // settle); the OnceLock just hands kill()/kill_all() the handle.
    let _ = reader_abort.set(reader.abort_handle());

    Ok(SendResult {
        run_id,
        session_id: launch.built.preassigned_session_id,
    })
}

/// Synthetic registry identity for virtual (host-stream) runs: they own no
/// process, but the registry's dedup/remove paths are pid-keyed, so each run
/// gets a unique token well above any real pid. Never passed to an OS call.
fn next_virtual_pid() -> u32 {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(u32::MAX / 2);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// Virtual run path for engines that drive their own transport
/// ([`Engine::drives_own_transport`]): register a child-less entry whose
/// `killed` flag and abort handle route interrupts into the transport task,
/// then detach it. The task dispatches the same event kinds as `run_reader`
/// and settles the turn itself (done/error + registry cleanup).
async fn send_host_stream(
    state: tauri::State<'_, crate::AppState>,
    launch: Launch,
    engine: String,
) -> Result<SendResult, String> {
    let run_id = uuid::Uuid::new_v4().to_string();
    let pid = next_virtual_pid();
    let killed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let reader_abort = Arc::new(std::sync::OnceLock::new());
    let entry = ChildEntry {
        child: None,
        pid,
        run_id: run_id.clone(),
        killed: Arc::clone(&killed),
        reader_abort: Arc::clone(&reader_abort),
    };
    state.processes.insert(run_id.clone(), entry.clone());
    if let Some(session_id) = launch.req.session_id.as_deref() {
        // A resumed host session is keyed up front (same contract as grok's
        // preassigned id): interrupt by conversation session id must route.
        state.processes.insert_alias(session_id.to_string(), entry);
    }

    let core = TurnCore {
        sink: Arc::clone(&state.sink),
        registry: Arc::clone(&state.processes),
        engine_id: engine.clone(),
        run_id: run_id.clone(),
    };
    let resume_session_id = launch.req.session_id.clone();
    let task = tokio::spawn(dsh_session::run_host_turn(
        core,
        launch.req,
        state.dsh_host.clone(),
        killed,
        pid,
    ));
    let _ = reader_abort.set(task.abort_handle());
    Ok(SendResult {
        run_id,
        session_id: resume_session_id,
    })
}

/// Async + spawn_blocking: the kill waits for the Windows tree walk to
/// finish (see `kill_process_group`), and a synchronous command would hold
/// that wait on the UI thread — the app would visibly hitch on every Stop.
#[tauri::command]
pub async fn interrupt_session(
    state: tauri::State<'_, crate::AppState>,
    session_id: String,
) -> Result<bool, String> {
    let registry = Arc::clone(&state.processes);
    tauri::async_runtime::spawn_blocking(move || registry.kill(&session_id))
        .await
        .map_err(|e| e.to_string())
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
            service_tier: None,
            permission: permission.map(str::to_string),
            additional_dirs: Vec::new(),
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
    fn omp_fast_tier_is_explicit_and_independent_of_effort() {
        let mut request = req(None);
        request.model = Some("openai-codex/gpt-5.4".into());
        request.effort = Some("high".into());
        for tier in [None, Some("priority"), Some("default")] {
            request.service_tier = tier.map(str::to_string);
            let args = argv(&pi_family::omp(), &request);
            let actual = args
                .iter()
                .position(|a| a == "--service-tier")
                .map(|i| args[i + 1].as_str());
            assert_eq!(actual, tier);
            assert!(args.windows(2).any(|a| a == ["--thinking", "high"]));
        }
    }

    #[test]
    fn omp_fast_tier_does_not_leak_to_other_models_or_pi() {
        let mut request = req(None);
        request.service_tier = Some("priority".into());
        for model in [
            None,
            Some("anthropic/claude"),
            Some("google/gemini"),
            Some("gpt-5.4"),
            Some("openai/"),
            Some("openai/gpt-5.4"),
            Some("openai-codex/"),
            Some("custom/gpt-5.4"),
        ] {
            request.model = model.map(str::to_string);
            assert!(!argv(&pi_family::omp(), &request)
                .iter()
                .any(|a| a == "--service-tier"));
        }
        request.model = Some("openai-codex/gpt-5.4".into());
        assert!(!argv(&pi_family::pi(), &request)
            .iter()
            .any(|a| a == "--service-tier"));
        assert!(argv(&pi_family::omp(), &request)
            .iter()
            .any(|a| a == "--service-tier"));
        request.service_tier = Some("invalid".into());
        assert!(pi_family::omp()
            .build_command(&request, "fake-bin")
            .is_err());
    }

    #[test]
    fn omp_tier_settings_are_backward_compatible_and_roundtrip() {
        let mut settings: crate::settings::AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(settings.omp_openai_service_tier, None);
        for tier in [Some("priority"), Some("default"), None] {
            settings.omp_openai_service_tier = tier.map(str::to_string);
            let encoded = serde_json::to_string(&settings).unwrap();
            let decoded: crate::settings::AppSettings = serde_json::from_str(&encoded).unwrap();
            assert_eq!(decoded.omp_openai_service_tier.as_deref(), tier);
        }
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
        let e = claude::ClaudeEngine::new();
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
    fn codex_prompt_goes_through_stdin_not_argv() {
        // Windows resolves npm codex to a `.cmd` shim spawned via `cmd /c`;
        // cmd.exe cuts a multiline argument at the first newline, so only line
        // 1 ever reached the model. The prompt must ride stdin (`-`) verbatim.
        let e = codex::CodexEngine;
        let mut request = req(Some("auto"));
        request.prompt = "first line\nmodel = \"gpt-5\"\n%PATH%".to_string();
        let built = e.build_command(&request, "fake-bin").unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.contains(&"-".to_string()));
        assert!(!args.iter().any(|a| a.contains("first line")));
        assert_eq!(built.stdin_payload.as_deref(), Some(request.prompt.as_str()));

        let mut resume = req(Some("auto"));
        resume.session_id = Some("00000000-0000-0000-0000-000000000000".to_string());
        let built = e.build_command(&resume, "fake-bin").unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.contains(&"-".to_string()));
        assert_eq!(built.stdin_payload.as_deref(), Some("hi"));
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
    fn claude_passes_granted_dirs_as_add_dir() {
        let e = claude::ClaudeEngine::new();
        let mut r = req(Some("auto"));
        // Workspace itself, blanks and duplicates must not reach argv.
        r.additional_dirs = vec![
            "/data/shared".to_string(),
            "/tmp".to_string(),
            "   ".to_string(),
            "/data/shared".to_string(),
        ];
        let args = argv(&e, &r);
        let pairs: Vec<&[String]> = args
            .windows(2)
            .filter(|w| w[0] == "--add-dir")
            .collect();
        assert_eq!(pairs.len(), 1, "{args:?}");
        assert_eq!(pairs[0][1], "/data/shared");

        // Other engines have no equivalent flag: the field stays inert.
        let codex_args = argv(&codex::CodexEngine, &r);
        assert!(!codex_args.iter().any(|a| a == "--add-dir"));
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

#[cfg(test)]
mod registry_tests {
    use super::*;

    /// rekey must COPY (not move) so both the session-id and run-id keys
    /// route an interrupt to the same process. A resume whose
    /// thread.started never arrives leaves run id as the only route — a
    /// moving rekey leaked the child (user pressed Stop, nothing died).
    #[tokio::test]
    async fn rekey_keeps_both_keys_and_kill_routes_by_either() {
        let mut child = tokio::process::Command::new(if cfg!(windows) {
            "cmd"
        } else {
            "sh"
        })
        .args(if cfg!(windows) { ["/c", "ping -n 30 127.0.0.1"] } else { ["-c", "sleep 30"] })
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawn sleep child");
        let pid = child.id().unwrap_or(0);
        let entry = ChildEntry {
            child: Some(Arc::new(TokioMutex::new(child))),
            pid,
            run_id: "run-1".to_string(),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            reader_abort: Arc::new(std::sync::OnceLock::new()),
        };
        let registry = ProcessRegistry::default();
        registry.insert("run-1".to_string(), entry);

        // Simulate the engine adopting the native session id mid-run.
        registry.rekey("run-1", "session-9".to_string());

        // Both keys route to the same pid; killing by the RUN id (the
        // fallback route when the session announcement never arrived) must
        // still find it, and the session key must survive the by-run-id
        // kill so a second stop also lands (idempotent, pid-deduped).
        assert!(registry.kill("run-1"));
        // kill does not drain: both keys still map to the (now dying)
        // child, so a second stop via the session id still lands on the
        // same entry. Its boolean result is racy (the child may already be
        // reaped, in which case kill_entry reports false on a SUCCESSFUL
        // interrupt), so assert the routing — not the return value.
        assert_eq!(registry.len(), 2);
        let _ = registry.kill("session-9");

        // The registry drains the entry from both keys on exit.
        registry.remove_if_pid("session-9", pid);
        registry.remove_if_pid("run-1", pid);
        assert_eq!(registry.len(), 0);
    }

    /// A resumed session is registered under its preassigned id at spawn:
    /// the engine's own announcement of that same id equals it, so
    /// adopt_session_id early-returns and never rekeys. Without the alias a
    /// by-session-id Stop found nothing.
    #[tokio::test]
    async fn preassigned_session_alias_routes_stop_before_session_event() {
        let child = tokio::process::Command::new(if cfg!(windows) { "cmd" } else { "sh" })
            .args(if cfg!(windows) { ["/c", "ping -n 30 127.0.0.1"] } else { ["-c", "sleep 30"] })
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawn sleep child");
        let pid = child.id().unwrap_or(0);
        let entry = ChildEntry {
            child: Some(Arc::new(TokioMutex::new(child))),
            pid,
            run_id: "run-preassigned".to_string(),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            reader_abort: Arc::new(std::sync::OnceLock::new()),
        };
        let registry = ProcessRegistry::default();
        registry.insert("run-preassigned".to_string(), entry.clone());
        registry.insert_alias("session-preassigned".to_string(), entry);

        assert!(registry.kill("session-preassigned"));
        registry.remove_if_pid("session-preassigned", pid);
        registry.remove_if_pid("run-preassigned", pid);
        assert_eq!(registry.len(), 0);
    }

    /// The real Windows stop bug: engine CLIs run as `cmd /c shim.cmd` and
    /// the model process is a grandchild. Killing must take the WHOLE tree
    /// down synchronously — a fire-and-forget taskkill that raced the direct
    /// child's start_kill orphaned the grandchild (it kept streaming and
    /// burning tokens after the user pressed Stop). This spawns a cmd whose
    /// grandchild outlives it and asserts the grandchild is gone after kill.
    #[cfg(windows)]
    #[tokio::test]
    async fn kill_reaps_windows_grandchild_process_tree() {
        use std::collections::HashSet;
        use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

        let child = tokio::process::Command::new("cmd")
            .args(["/c", "ping -n 60 127.0.0.1 > NUL"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawn cmd child");
        let cmd_pid = child.id().unwrap_or(0);

        // Let cmd spawn its ping grandchild.
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        let mut sys = System::new();
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing(),
        );
        let grandchildren: Vec<Pid> = sys
            .processes()
            .iter()
            .filter(|(_, p)| p.parent() == Some(Pid::from_u32(cmd_pid)))
            .map(|(pid, _)| *pid)
            .collect();
        assert!(
            !grandchildren.is_empty(),
            "expected cmd to have spawned a ping grandchild"
        );

        let entry = ChildEntry {
            child: Some(Arc::new(TokioMutex::new(child))),
            pid: cmd_pid,
            run_id: "run-tree".to_string(),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            reader_abort: Arc::new(std::sync::OnceLock::new()),
        };
        let registry = ProcessRegistry::default();
        registry.insert("run-tree".to_string(), entry);
        assert!(registry.kill("run-tree"));

        // Poll: process teardown is observable only after the kernel reaps.
        let targets: HashSet<Pid> = grandchildren
            .iter()
            .copied()
            .chain(std::iter::once(Pid::from_u32(cmd_pid)))
            .collect();
        let mut alive = targets.clone();
        for _ in 0..50 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            sys.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing(),
            );
            alive.retain(|pid| sys.process(*pid).is_some());
            if alive.is_empty() {
                break;
            }
        }
        assert!(
            alive.is_empty(),
            "stop left process-tree survivors alive: {alive:?}"
        );
    }
}
#[cfg(test)]
mod tool_args_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_tool_args_value_drops_empty_and_parses_strings() {
        assert_eq!(parse_tool_args_value(&Value::Null), None);
        assert_eq!(parse_tool_args_value(&json!({})), None);
        assert_eq!(parse_tool_args_value(&json!([])), None);
        assert_eq!(
            parse_tool_args_value(&json!("{\"path\":\"a.ts\"}")),
            Some(json!({"path": "a.ts"}))
        );
        assert_eq!(
            parse_tool_args_value(&json!({"file_path": "a.ts"})),
            Some(json!({"file_path": "a.ts"}))
        );
        assert_eq!(
            parse_tool_args_value(&json!("plain command")),
            Some(json!("plain command"))
        );
    }

    #[test]
    fn tool_call_message_extracts_path_and_marks_patch() {
        match tool_call_message("Read", Some(&json!({"file_path": "src/a.ts"}))) {
            EngineEvent::Message {
                path, args, patch, ..
            } => {
                assert_eq!(path.as_deref(), Some("src/a.ts"));
                assert_eq!(args, Some(json!({"file_path": "src/a.ts"})));
                assert!(!patch);
            }
            _ => panic!("expected tool message"),
        }
        match tool_call_patch("Read", Some(&json!({"file_path": "src/a.ts"}))) {
            EngineEvent::Message { patch, .. } => assert!(patch),
            _ => panic!("expected patch"),
        }
    }
}

#[cfg(test)]
mod codex_home_bin_tests {
    use super::*;

    #[test]
    fn engine_bin_prefers_codex_home_bin() {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-codex-home-bin-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(dir.join("bin")).unwrap();
        let candidate = dir.join("bin").join("codex");
        std::fs::write(&candidate, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&candidate, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let mut settings = crate::settings::AppSettings::default();
        settings.codex_home = Some(dir.to_string_lossy().into_owned());
        let resolved = engine_bin(&settings, "codex");
        assert_eq!(PathBuf::from(&resolved), candidate);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
