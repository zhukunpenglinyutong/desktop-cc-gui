//! Single-instance long-lived `omp --mode acp` daemon manager and turn driver.
//!
//! Instead of spawning a fresh `omp.exe` per send (paying a 5-20s native
//! addon + CLI + model registry + MCP cold start each time) or parking a
//! single-session `rpc-ui` process that breaks on every new chat, session
//! switch, or model switch, one host-owned `omp --mode acp` process serves
//! concurrent sessions across all local workspaces:
//! - `initialize` runs once per daemon lifetime (~1.4s on idle host).
//! - `session/new` / `session/resume` creates or attaches a session inside the
//!   running daemon (`resume` skips history replay; already-loaded sessions
//!   return immediately).
//! - `session/set_config_option` switches `model` and `thinking` in-place
//!   (~60-350ms) without respawning.
//! - `session/prompt` runs turns concurrently across distinct sessions; Stop
//!   sends `session/cancel` for only that session without tearing down the
//!   daemon or sibling turns.
//! - `session/close` releases per-session memory when a tab closes or before
//!   reloading an externally edited session file.
//! - Config/env drift (`models.yml`, `config.yml`, `settings.json`, `mcp.json`,
//!   `--auto-approve`, `--service-tier`, proxy or resolved env) rotates the
//!   daemon gracefully: the old instance enters draining state and exits once
//!   its in-flight turns settle; new sends immediately use a fresh daemon.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use serde_json::{json, Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::{mpsc, oneshot, Mutex as TokioMutex};
use tokio::time::timeout;

use crate::engine::pi_family::omp_acp::{
    elicitation_form_declared, extract_session_id, handle_session_update, omp_initialize_params,
    prompt_blocks, prompt_usage, session_dir_name, terminal_message, TurnView,
};
use crate::engine::pi_family::CONFIRM_YES_LABEL;
use crate::engine::qoder_session::{
    answer_agent_request, encode_ndjson, jsonrpc_error_response, jsonrpc_id_key,
    jsonrpc_notification, jsonrpc_request, jsonrpc_result_response, parse_acp_line, AcpLine,
    AcpRpcError, JSONRPC_INTERNAL_ERROR, KILL_POLL, SESSION_NEW_TIMEOUT,
};
use crate::engine::{
    command_for_binary, kill_process_group, spawn_stderr_capture, BuiltCommand, EngineEvent,
    SendRequest, TurnCore, TurnState, VirtualRunGuard,
};

const DAEMON_INIT_TIMEOUT: Duration = Duration::from_secs(45);
const SESSION_RESUME_TIMEOUT: Duration = Duration::from_secs(45);
const CONFIG_OPTION_TIMEOUT: Duration = Duration::from_secs(20);
const SESSION_CLOSE_TIMEOUT: Duration = Duration::from_secs(5);
const CANCEL_SETTLE_TIMEOUT: Duration = Duration::from_secs(2);
const ELICITATION_METHOD: &str = "elicitation/create";

const PROXY_ENV_KEYS: [&str; 8] = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
];

const CONFIG_STAMP_FILES: [&str; 4] = ["models.yml", "config.yml", "settings.json", "mcp.json"];

type FileStamp = (u64, Option<SystemTime>);

/// Eligibility gate: normal local OMP sends run on the shared ACP daemon.
/// Plan approval (`omp_acp`), WSL, computer-use, memory-bot, tool-constrained
/// runs, and workspace `.omp/mcp.json` on-demand injections keep their isolated
/// single-run transports.
pub(crate) fn should_use_daemon(
    engine: &str,
    req: &SendRequest,
    built: &BuiltCommand,
    wsl: bool,
) -> bool {
    engine == "omp"
        && !wsl
        && !super::pi_family::acp_plan_requested(req)
        && req.computer_use != Some(true)
        && req.memory_bot.is_none()
        && req.allowed_tools.is_none()
        && !req.no_tools
        && built.mcp_restore.is_none()
        && built.cleanup_files.is_empty()
}

/// Launch specification & fingerprint for an `omp --mode acp` daemon instance.
/// Any change here triggers graceful rotation (draining old daemon, spawning
/// a fresh one for new sends).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct OmpDaemonSpec {
    pub(crate) bin: String,
    pub(crate) auto_approve: bool,
    pub(crate) service_tier: Option<String>,
    pub(crate) extra_env: BTreeMap<String, String>,
    pub(crate) search_path: Option<String>,
    pub(crate) proxy_env: BTreeMap<String, String>,
    pub(crate) config_stamps: Vec<Option<FileStamp>>,
}

impl OmpDaemonSpec {
    pub(crate) fn from_launch(
        bin: String,
        req: &SendRequest,
        command: &tokio::process::Command,
        search_path: Option<String>,
    ) -> Result<Self, String> {
        let auto_approve = req.permission.as_deref() == Some("bypass");
        let service_tier = if req.model.as_deref().is_some_and(|m| {
            m.strip_prefix("openai-codex/")
                .is_some_and(|id| !id.is_empty())
        }) {
            match req.service_tier.as_deref() {
                Some(tier @ ("default" | "priority")) => Some(tier.to_string()),
                Some(_) => return Err("Invalid OMP OpenAI service tier".to_string()),
                None => None,
            }
        } else {
            None
        };
        let mut extra_env = BTreeMap::new();
        for (key, value) in command.as_std().get_envs() {
            let Some(key_str) = key.to_str() else {
                continue;
            };
            if key_str == "CCGUI_SERVED_MODEL_FILE" {
                continue;
            }
            if let Some(val) = value.and_then(|v| v.to_str()) {
                extra_env.insert(key_str.to_string(), val.to_string());
            }
        }
        Ok(Self {
            bin,
            auto_approve,
            service_tier,
            extra_env,
            search_path,
            proxy_env: current_proxy_env(),
            config_stamps: omp_config_stamps(),
        })
    }
}

fn current_proxy_env() -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for key in PROXY_ENV_KEYS {
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() {
                map.insert(key.to_string(), value);
            }
        }
    }
    map
}

fn omp_config_stamps() -> Vec<Option<FileStamp>> {
    let Ok(dir) = super::pi_family_auth::agent_dir("omp") else {
        return vec![None; CONFIG_STAMP_FILES.len()];
    };
    CONFIG_STAMP_FILES
        .iter()
        .map(|name| file_stamp(&dir.join(name)))
        .collect()
}

fn file_stamp(path: &Path) -> Option<FileStamp> {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.len(), meta.modified().ok()))
}

// ==================== Daemon state & lifecycle ====================

#[derive(Default)]
struct DaemonHolder {
    current: Option<Arc<OmpDaemonClient>>,
    draining: Vec<Arc<OmpDaemonClient>>,
}

/// Host-wide state for the managed single-instance `omp --mode acp` daemon.
#[derive(Default)]
pub struct OmpDaemonState {
    holder: Mutex<DaemonHolder>,
    /// Serializes spawn/rotation so concurrent sends or prewarms share one
    /// daemon cold start. Never held while running turns or session RPCs.
    ensure: TokioMutex<()>,
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl OmpDaemonState {
    /// Return the live daemon matching `spec`, spawning or gracefully rotating
    /// when none is alive or the launch fingerprint drifted.
    pub(crate) async fn ensure_daemon(
        &self,
        spec: &OmpDaemonSpec,
    ) -> Result<Arc<OmpDaemonClient>, String> {
        if let Some(client) = self.matching_live_client(spec) {
            return Ok(client);
        }
        let _guard = self.ensure.lock().await;
        if let Some(client) = self.matching_live_client(spec) {
            return Ok(client);
        }

        // Retire any mismatched or dead previous daemon before spawning.
        let retired = {
            let mut holder = lock_unpoisoned(&self.holder);
            holder.draining.retain(|client| client.is_alive());
            holder.current.take()
        };
        if let Some(old) = retired {
            old.mark_draining();
            if old.active_turn_count() == 0 {
                old.shutdown_sync();
            } else if old.is_alive() {
                lock_unpoisoned(&self.holder).draining.push(old);
            }
        }

        let client = OmpDaemonClient::spawn_and_initialize(spec.clone()).await?;
        lock_unpoisoned(&self.holder).current = Some(Arc::clone(&client));
        Ok(client)
    }

    fn matching_live_client(&self, spec: &OmpDaemonSpec) -> Option<Arc<OmpDaemonClient>> {
        let holder = lock_unpoisoned(&self.holder);
        let client = holder.current.as_ref()?;
        (client.is_alive() && client.spec == *spec).then(|| Arc::clone(client))
    }

    /// Write a JSON-RPC elicitation reply to the exact daemon instance that
    /// issued the question (even if that daemon is currently draining after a
    /// config rotation). We intentionally never attach the shared daemon stdin
    /// to `ProcessRegistry::set_stdin`, because `TurnCore::dispatch(Done)` calls
    /// `close_stdin` on turn completion.
    pub(crate) async fn write_elicitation_reply(
        &self,
        parked: &Value,
        frame: &Value,
    ) -> Result<(), String> {
        let daemon_id = parked
            .get("daemonId")
            .and_then(Value::as_u64)
            .ok_or_else(|| "OMP ACP elicitation context missing daemonId".to_string())?;
        let target = {
            let holder = lock_unpoisoned(&self.holder);
            holder
                .current
                .iter()
                .chain(holder.draining.iter())
                .find(|client| client.daemon_id == daemon_id && client.is_alive())
                .cloned()
        }
        .ok_or_else(|| "OMP ACP daemon for this question is no longer running".to_string())?;
        target.write_frame(frame).await
    }

    /// Close a loaded session inside the daemon (tab closed or file edited)
    /// without disturbing the daemon or any active turn.
    pub(crate) async fn close_session(&self, session_id: &str) {
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return;
        }
        let clients = {
            let holder = lock_unpoisoned(&self.holder);
            let mut list = Vec::new();
            if let Some(client) = &holder.current {
                if client.is_alive() {
                    list.push(Arc::clone(client));
                }
            }
            for client in &holder.draining {
                if client.is_alive() {
                    list.push(Arc::clone(client));
                }
            }
            list
        };
        for client in clients {
            client.close_idle_session(session_id).await;
        }
    }

    /// Kill every daemon we spawned (app exit).
    pub fn kill_spawned(&self) {
        let clients = {
            let mut holder = lock_unpoisoned(&self.holder);
            let mut list = Vec::new();
            if let Some(client) = holder.current.take() {
                list.push(client);
            }
            list.extend(holder.draining.drain(..));
            list
        };
        for client in clients {
            client.shutdown_sync();
        }
    }

    /// Background prewarm: ensures the daemon is running and, when an existing
    /// `session_id` is supplied, pre-loads it via `session/resume` so the next
    /// user send starts immediately.
    pub(crate) async fn prewarm(
        &self,
        spec: &OmpDaemonSpec,
        workspace: &Path,
        session_id: Option<&str>,
        model: Option<&str>,
        effort: Option<&str>,
    ) -> Result<(), String> {
        let client = self.ensure_daemon(spec).await?;
        let Some(sid) = session_id.map(str::trim).filter(|s| !s.is_empty()) else {
            return Ok(());
        };
        // Never race a session that already has an active turn running.
        if client.has_active_turn(sid) {
            return Ok(());
        }
        let meta = client.ensure_session_resumed(sid, workspace).await?;
        if !client.has_active_turn(sid) {
            let _ = client
                .apply_session_options(sid, &meta, model, effort)
                .await;
        }
        Ok(())
    }
}

// ==================== Multiplexed ACP daemon client ====================

enum DaemonSessionEvent {
    Update(Value),
    AgentRequest {
        id: Value,
        method: String,
        params: Value,
    },
}

#[derive(Clone, Debug)]
struct LoadedSessionMeta {
    workspace: PathBuf,
    current_model: Option<String>,
    current_effort: Option<String>,
    available_models: Vec<String>,
    session_file: Option<PathBuf>,
    session_file_stamp: Option<FileStamp>,
}

static NEXT_DAEMON_ID: AtomicU64 = AtomicU64::new(1);

pub(crate) struct OmpDaemonClient {
    daemon_id: u64,
    spec: OmpDaemonSpec,
    stdin: Arc<TokioMutex<Option<ChildStdin>>>,
    child: Mutex<Option<Child>>,
    pid: u32,
    #[cfg(windows)]
    tree_guard: Mutex<Option<Arc<crate::engine::job::KillOnCloseJob>>>,
    stderr_buf: Arc<Mutex<String>>,
    next_id: AtomicU64,
    pending_rpcs: Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, AcpRpcError>>>>>,
    active_turns: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<DaemonSessionEvent>>>>,
    loaded_sessions: Mutex<HashMap<String, LoadedSessionMeta>>,
    /// Per-session setup lock so concurrent prewarm + send on the same session
    /// share one `session/resume` instead of duplicating it.
    setup_locks: Mutex<HashMap<String, Arc<TokioMutex<()>>>>,
    active_turn_count: AtomicUsize,
    draining: AtomicBool,
    alive: Arc<AtomicBool>,
    reader_abort: Mutex<Option<tokio::task::AbortHandle>>,
}

impl OmpDaemonClient {
    async fn spawn_and_initialize(spec: OmpDaemonSpec) -> Result<Arc<Self>, String> {
        let mut command = command_for_binary(&spec.bin);
        command.args(["--mode", "acp"]);
        if spec.auto_approve {
            command.arg("--auto-approve");
        }
        if let Some(tier) = spec.service_tier.as_deref() {
            command.args(["--service-tier", tier]);
        }
        if let Some(path) = spec.search_path.as_deref() {
            command.env("PATH", path);
        }
        for (key, value) in &spec.extra_env {
            command.env(key, value);
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);
        #[cfg(windows)]
        crate::engine::hide_console(&mut command);

        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to spawn OMP ACP daemon ({}): {error}", spec.bin))?;
        let pid = child.id().unwrap_or(0);
        #[cfg(windows)]
        let tree_guard = crate::engine::job::assign_kill_on_close(&child);

        let (stdin, stdout, stderr) =
            match (child.stdin.take(), child.stdout.take(), child.stderr.take()) {
                (Some(stdin), Some(stdout), Some(stderr)) => (stdin, stdout, stderr),
                _ => {
                    let _ = child.start_kill();
                    return Err("OMP ACP daemon missing stdio pipe after spawn".to_string());
                }
            };

        let stdin = Arc::new(TokioMutex::new(Some(stdin)));
        let stderr_buf = spawn_stderr_capture(stderr);
        let pending_rpcs: Arc<
            Mutex<HashMap<String, oneshot::Sender<Result<Value, AcpRpcError>>>>,
        > = Arc::new(Mutex::new(HashMap::new()));
        let active_turns: Arc<
            Mutex<HashMap<String, mpsc::UnboundedSender<DaemonSessionEvent>>>,
        > = Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));

        let client = Arc::new(Self {
            daemon_id: NEXT_DAEMON_ID.fetch_add(1, Ordering::Relaxed),
            spec,
            stdin: Arc::clone(&stdin),
            child: Mutex::new(Some(child)),
            pid,
            #[cfg(windows)]
            tree_guard: Mutex::new(tree_guard),
            stderr_buf: Arc::clone(&stderr_buf),
            next_id: AtomicU64::new(1),
            pending_rpcs: Arc::clone(&pending_rpcs),
            active_turns: Arc::clone(&active_turns),
            loaded_sessions: Mutex::new(HashMap::new()),
            setup_locks: Mutex::new(HashMap::new()),
            active_turn_count: AtomicUsize::new(0),
            draining: AtomicBool::new(false),
            alive: Arc::clone(&alive),
            reader_abort: Mutex::new(None),
        });

        let reader_handle = tokio::spawn(run_daemon_reader(
            stdout,
            stdin,
            pending_rpcs,
            active_turns,
            alive,
            stderr_buf,
        ));
        *lock_unpoisoned(&client.reader_abort) = Some(reader_handle.abort_handle());

        // Initialize handshake once per daemon lifetime.
        let init = omp_initialize_params();
        if !elicitation_form_declared(&init) {
            client.shutdown_sync();
            return Err(
                "OMP ACP 守护进程握手缺少 clientCapabilities.elicitation.form 声明".to_string(),
            );
        }
        if let Err(error) = client.rpc_call("initialize", init, Some(DAEMON_INIT_TIMEOUT)).await {
            let message = terminal_message(error, &client.stderr_buf);
            client.shutdown_sync();
            return Err(format!("OMP ACP 守护进程初始化失败: {message}"));
        }
        Ok(client)
    }

    pub(crate) fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn mark_draining(&self) {
        self.draining.store(true, Ordering::SeqCst);
    }

    fn is_draining(&self) -> bool {
        self.draining.load(Ordering::SeqCst)
    }

    fn active_turn_count(&self) -> usize {
        self.active_turn_count.load(Ordering::SeqCst)
    }

    fn has_active_turn(&self, session_id: &str) -> bool {
        lock_unpoisoned(&self.active_turns).contains_key(session_id)
    }

    fn session_setup_lock(&self, session_id: &str) -> Arc<TokioMutex<()>> {
        let mut locks = lock_unpoisoned(&self.setup_locks);
        Arc::clone(
            locks
                .entry(session_id.to_string())
                .or_insert_with(|| Arc::new(TokioMutex::new(()))),
        )
    }

    async fn write_frame(&self, value: &Value) -> Result<(), String> {
        let bytes = encode_ndjson(value)?;
        let mut guard = self.stdin.lock().await;
        let handle = guard
            .as_mut()
            .ok_or_else(|| "OMP ACP daemon stdin is closed".to_string())?;
        handle
            .write_all(&bytes)
            .await
            .map_err(|error| format!("failed to write OMP ACP daemon request: {error}"))?;
        handle
            .flush()
            .await
            .map_err(|error| format!("failed to flush OMP ACP daemon request: {error}"))?;
        Ok(())
    }

    /// Send a JSON-RPC request and register a oneshot receiver for its reply.
    async fn start_rpc(
        &self,
        method: &str,
        params: Value,
    ) -> Result<(String, oneshot::Receiver<Result<Value, AcpRpcError>>), String> {
        if !self.is_alive() {
            return Err(terminal_message(
                "OMP ACP daemon is not running".to_string(),
                &self.stderr_buf,
            ));
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let id_key = id.to_string();
        let (tx, rx) = oneshot::channel();
        lock_unpoisoned(&self.pending_rpcs).insert(id_key.clone(), tx);
        let frame = jsonrpc_request(id, method, params);
        if let Err(error) = self.write_frame(&frame).await {
            lock_unpoisoned(&self.pending_rpcs).remove(&id_key);
            return Err(error);
        }
        Ok((id_key, rx))
    }

    fn cancel_pending_rpc(&self, id_key: &str) {
        lock_unpoisoned(&self.pending_rpcs).remove(id_key);
    }

    async fn rpc_call(
        &self,
        method: &str,
        params: Value,
        deadline: Option<Duration>,
    ) -> Result<Value, String> {
        let (id_key, rx) = self.start_rpc(method, params).await?;
        let response = match deadline {
            Some(dur) => match timeout(dur, rx).await {
                Ok(res) => res,
                Err(_) => {
                    self.cancel_pending_rpc(&id_key);
                    return Err(format!("OMP ACP {method} timed out after {}s", dur.as_secs()));
                }
            },
            None => rx.await,
        };
        match response {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(rpc_err)) => Err(format!("rpc:{}:{}", rpc_err.code, rpc_err.message)),
            Err(_) => Err(terminal_message(
                format!("OMP ACP daemon closed during {method}"),
                &self.stderr_buf,
            )),
        }
    }

    async fn send_cancel(&self, session_id: &str) {
        let frame = jsonrpc_notification("session/cancel", json!({ "sessionId": session_id }));
        let _ = self.write_frame(&frame).await;
    }

    async fn create_session(&self, workspace: &Path) -> Result<(String, LoadedSessionMeta), String> {
        let cwd = workspace.to_string_lossy().to_string();
        let mcp_servers = load_user_omp_mcp_servers();
        let result = self
            .rpc_call(
                "session/new",
                json!({ "cwd": cwd, "mcpServers": mcp_servers }),
                Some(SESSION_NEW_TIMEOUT),
            )
            .await?;
        let session_id = extract_session_id(&result)
            .ok_or_else(|| "OMP session/new 未返回 sessionId".to_string())?;
        let meta = build_loaded_meta(workspace, &session_id, &result);
        lock_unpoisoned(&self.loaded_sessions).insert(session_id.clone(), meta.clone());
        Ok((session_id, meta))
    }

    async fn ensure_session_resumed(
        &self,
        session_id: &str,
        workspace: &Path,
    ) -> Result<LoadedSessionMeta, String> {
        let lock = self.session_setup_lock(session_id);
        let _guard = lock.lock().await;

        let cached = lock_unpoisoned(&self.loaded_sessions).get(session_id).cloned();
        if let Some(meta) = cached {
            let same_workspace = meta.workspace == workspace;
            let file_unchanged = match (&meta.session_file, &meta.session_file_stamp) {
                (Some(path), Some(expected)) => file_stamp(path).as_ref() == Some(expected),
                _ => true,
            };
            if same_workspace && file_unchanged {
                return Ok(meta);
            }
            // Workspace changed or file was modified externally: evict from
            // OMP's in-memory map before resuming so disk state is reloaded.
            let _ = self
                .rpc_call(
                    "session/close",
                    json!({ "sessionId": session_id }),
                    Some(SESSION_CLOSE_TIMEOUT),
                )
                .await;
            lock_unpoisoned(&self.loaded_sessions).remove(session_id);
        }

        let cwd = workspace.to_string_lossy().to_string();
        let mcp_servers = load_user_omp_mcp_servers();
        let result = self
            .rpc_call(
                "session/resume",
                json!({ "sessionId": session_id, "cwd": cwd, "mcpServers": mcp_servers }),
                Some(SESSION_RESUME_TIMEOUT),
            )
            .await?;
        let meta = build_loaded_meta(workspace, session_id, &result);
        lock_unpoisoned(&self.loaded_sessions).insert(session_id.to_string(), meta.clone());
        Ok(meta)
    }

    async fn apply_session_options(
        &self,
        session_id: &str,
        meta: &LoadedSessionMeta,
        requested_model: Option<&str>,
        requested_effort: Option<&str>,
    ) -> Result<(Option<String>, Option<String>), String> {
        let mut current_model = meta.current_model.clone();
        let mut current_effort = meta.current_effort.clone();

        if let Some(model) = requested_model.map(str::trim).filter(|v| !v.is_empty()) {
            let resolved = resolve_model_value(model, &meta.available_models);
            if current_model.as_deref() != Some(resolved.as_str()) {
                let res = self
                    .rpc_call(
                        "session/set_config_option",
                        json!({
                            "sessionId": session_id,
                            "configId": "model",
                            "value": resolved,
                        }),
                        Some(CONFIG_OPTION_TIMEOUT),
                    )
                    .await
                    .map_err(|error| format!("OMP 应用选定模型 `{model}` 失败: {error}"))?;
                current_model = parse_config_current(&res, "model").or(Some(resolved));
                if let Some(entry) = lock_unpoisoned(&self.loaded_sessions).get_mut(session_id) {
                    entry.current_model = current_model.clone();
                    let refreshed = parse_available_models(&res);
                    if !refreshed.is_empty() {
                        entry.available_models = refreshed;
                    }
                }
            }
        }

        if let Some(effort) = requested_effort.map(str::trim).filter(|v| !v.is_empty()) {
            if current_effort.as_deref() != Some(effort) {
                let res = self
                    .rpc_call(
                        "session/set_config_option",
                        json!({
                            "sessionId": session_id,
                            "configId": "thinking",
                            "value": effort,
                        }),
                        Some(CONFIG_OPTION_TIMEOUT),
                    )
                    .await
                    .map_err(|error| format!("OMP 应用推理强度 `{effort}` 失败: {error}"))?;
                current_effort =
                    parse_config_current(&res, "thinking").or_else(|| Some(effort.to_string()));
                if let Some(entry) = lock_unpoisoned(&self.loaded_sessions).get_mut(session_id) {
                    entry.current_effort = current_effort.clone();
                }
            }
        }

        Ok((current_model, current_effort))
    }

    fn refresh_session_file_stamp(&self, session_id: &str, workspace: &Path) {
        let mut sessions = lock_unpoisoned(&self.loaded_sessions);
        let Some(entry) = sessions.get_mut(session_id) else {
            return;
        };
        if entry.session_file.is_none() {
            entry.session_file = locate_session_file(workspace, session_id);
        }
        entry.session_file_stamp = entry.session_file.as_deref().and_then(file_stamp);
    }

    async fn close_idle_session(&self, session_id: &str) {
        if self.has_active_turn(session_id) {
            return;
        }
        let lock = self.session_setup_lock(session_id);
        let _guard = lock.lock().await;
        if self.has_active_turn(session_id) {
            return;
        }
        let had = lock_unpoisoned(&self.loaded_sessions)
            .remove(session_id)
            .is_some();
        if had && self.is_alive() {
            let _ = self
                .rpc_call(
                    "session/close",
                    json!({ "sessionId": session_id }),
                    Some(SESSION_CLOSE_TIMEOUT),
                )
                .await;
        }
        lock_unpoisoned(&self.setup_locks).remove(session_id);
    }

    fn shutdown_sync(&self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Ok(mut guard) = self.stdin.try_lock() {
            *guard = None;
        }
        if let Some(abort) = lock_unpoisoned(&self.reader_abort).take() {
            abort.abort();
        }
        if let Some(mut child) = lock_unpoisoned(&self.child).take() {
            if self.pid > 0 {
                kill_process_group(self.pid);
            }
            let _ = child.start_kill();
        }
        #[cfg(windows)]
        {
            *lock_unpoisoned(&self.tree_guard) = None;
        }
        // Wake any remaining waiters so nothing hangs on shutdown.
        let mut pending = lock_unpoisoned(&self.pending_rpcs);
        for (_, tx) in pending.drain() {
            let _ = tx.send(Err(AcpRpcError {
                code: JSONRPC_INTERNAL_ERROR,
                message: "OMP ACP daemon stopped".to_string(),
            }));
        }
        lock_unpoisoned(&self.active_turns).clear();
    }
}

impl Drop for OmpDaemonClient {
    fn drop(&mut self) {
        self.shutdown_sync();
    }
}

/// RAII guard for one active turn on an [`OmpDaemonClient`]: always clears its
/// `active_turns` route, decrements `active_turn_count`, and shuts down a
/// draining daemon as soon as its last turn finishes.
struct ActiveTurnGuard {
    client: Arc<OmpDaemonClient>,
    session_id: String,
}

impl Drop for ActiveTurnGuard {
    fn drop(&mut self) {
        lock_unpoisoned(&self.client.active_turns).remove(&self.session_id);
        let remaining = self
            .client
            .active_turn_count
            .fetch_sub(1, Ordering::SeqCst)
            .saturating_sub(1);
        if remaining == 0 && self.client.is_draining() {
            self.client.shutdown_sync();
        }
    }
}

/// Single stdout multiplexer loop for one `omp --mode acp` daemon process.
async fn run_daemon_reader(
    stdout: ChildStdout,
    stdin: Arc<TokioMutex<Option<ChildStdin>>>,
    pending_rpcs: Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, AcpRpcError>>>>>,
    active_turns: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<DaemonSessionEvent>>>>,
    alive: Arc<AtomicBool>,
    stderr_buf: Arc<Mutex<String>>,
) {
    let mut reader = BufReader::new(stdout);
    let mut line_buf = Vec::new();
    loop {
        line_buf.clear();
        match reader.read_until(b'\n', &mut line_buf).await {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => break,
        }
        let line = String::from_utf8_lossy(&line_buf);
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        match parse_acp_line(&value) {
            AcpLine::Response { id, result, error } => {
                if let Some(key) = jsonrpc_id_key(&id) {
                    if let Some(tx) = lock_unpoisoned(&pending_rpcs).remove(&key) {
                        let outcome = match error {
                            Some(err) => Err(err),
                            None => Ok(result.unwrap_or(Value::Null)),
                        };
                        let _ = tx.send(outcome);
                    }
                }
            }
            AcpLine::Notification { method, params } if method == "session/update" => {
                if let Some(sid) = params.get("sessionId").and_then(Value::as_str) {
                    let sender = lock_unpoisoned(&active_turns).get(sid).cloned();
                    if let Some(tx) = sender {
                        let _ = tx.send(DaemonSessionEvent::Update(params));
                    }
                }
            }
            AcpLine::AgentRequest { id, method, params } => {
                let sid = params.get("sessionId").and_then(Value::as_str);
                let routed = sid
                    .and_then(|s| lock_unpoisoned(&active_turns).get(s).cloned())
                    .is_some_and(|tx| {
                        tx.send(DaemonSessionEvent::AgentRequest {
                            id: id.clone(),
                            method: method.clone(),
                            params: params.clone(),
                        })
                        .is_ok()
                    });
                if !routed {
                    // Orphaned request (session already cancelled/closed):
                    // reply immediately so the daemon never wedges.
                    let reply = if method == ELICITATION_METHOD {
                        jsonrpc_result_response(&id, json!({ "action": "cancel" }))
                    } else {
                        jsonrpc_error_response(
                            &id,
                            JSONRPC_INTERNAL_ERROR,
                            "no active turn owns this session request",
                        )
                    };
                    if let Ok(bytes) = encode_ndjson(&reply) {
                        let mut guard = stdin.lock().await;
                        if let Some(handle) = guard.as_mut() {
                            let _ = handle.write_all(&bytes).await;
                            let _ = handle.flush().await;
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // Daemon exited: mark dead, fail every pending RPC, and drop all active
    // session channels so every running turn settles promptly.
    alive.store(false, Ordering::SeqCst);
    let reason = terminal_message(
        "OMP ACP daemon exited unexpectedly".to_string(),
        &stderr_buf,
    );
    let mut pending = lock_unpoisoned(&pending_rpcs);
    for (_, tx) in pending.drain() {
        let _ = tx.send(Err(AcpRpcError {
            code: JSONRPC_INTERNAL_ERROR,
            message: reason.clone(),
        }));
    }
    lock_unpoisoned(&active_turns).clear();
}

// ==================== Turn execution ====================

/// Drive one normal OMP send on the shared [`OmpDaemonState`].
pub(crate) async fn run_daemon_turn(
    core: TurnCore,
    req: SendRequest,
    spec: OmpDaemonSpec,
    daemon_state: Arc<OmpDaemonState>,
    killed: Arc<AtomicBool>,
    virtual_pid: u32,
) {
    let mut state = TurnState::new(req.session_id.clone());
    let mut view = TurnView::default();
    let _registry_guard =
        VirtualRunGuard::new(Arc::clone(&core.registry), core.run_id.clone(), virtual_pid);

    let mut open_elicitations: Vec<(String, Value)> = Vec::new();
    let mut daemon_client: Option<Arc<OmpDaemonClient>> = None;

    let result = turn_inner(
        &core,
        &mut state,
        &mut view,
        &req,
        &spec,
        &daemon_state,
        &killed,
        &mut daemon_client,
        &mut open_elicitations,
    )
    .await;

    // Settle parked questions & plans; cancel any still-open CLI elicitations
    // so the long-lived OMP session never stays blocked after Stop or error.
    let mut still_pending_ids = std::collections::HashSet::new();
    for key in [state.native_session_id.clone(), Some(core.run_id.clone())]
        .into_iter()
        .flatten()
    {
        for request_id in core.registry.take_questions(&key) {
            still_pending_ids.insert(request_id.clone());
            core.dispatch_event(&mut state, EngineEvent::QuestionSettled { request_id });
        }
        crate::engine::reader::expire_parked_plans(&core, &mut state, &key);
    }
    if let Some(client) = &daemon_client {
        for (req_id, rpc_id) in open_elicitations {
            if still_pending_ids.contains(&req_id) {
                let cancel = jsonrpc_result_response(&rpc_id, json!({ "action": "cancel" }));
                let _ = client.write_frame(&cancel).await;
            }
        }
        if let Some(sid) = state.native_session_id.as_deref() {
            client.refresh_session_file_stamp(sid, &req.workspace);
        }
    }

    if let Err(error) = result {
        if !killed.load(Ordering::SeqCst) {
            let message = match &daemon_client {
                Some(client) => terminal_message(error, &client.stderr_buf),
                None => error,
            };
            core.dispatch_event(&mut state, EngineEvent::Error(message));
        }
    }
    if !state.saw_done && !state.saw_error {
        let usage = if killed.load(Ordering::SeqCst) {
            None
        } else {
            view.last_usage.clone()
        };
        let session_id = state.native_session_id.clone();
        core.dispatch_event(&mut state, EngineEvent::Done { session_id, usage });
    }
    core.registry.remove_if_pid(&core.run_id, virtual_pid);
    if let Some(session_id) = state.native_session_id.clone() {
        core.registry.remove_if_pid(&session_id, virtual_pid);
    }
    core.sink.flush();
}

#[allow(clippy::too_many_arguments)]
async fn turn_inner(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    spec: &OmpDaemonSpec,
    daemon_state: &Arc<OmpDaemonState>,
    killed: &Arc<AtomicBool>,
    daemon_out: &mut Option<Arc<OmpDaemonClient>>,
    open_elicitations: &mut Vec<(String, Value)>,
) -> Result<(), String> {
    if killed.load(Ordering::SeqCst) {
        return Ok(());
    }
    // Spawn daemon startup detached so Stop settles immediately while the
    // daemon finishes initializing in the background for the next send.
    let state_for_spawn = Arc::clone(daemon_state);
    let spec_for_spawn = spec.clone();
    let mut ensure_task =
        tokio::spawn(async move { state_for_spawn.ensure_daemon(&spec_for_spawn).await });
    let mut startup_tick = tokio::time::interval(KILL_POLL);
    startup_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let client = loop {
        tokio::select! {
            biased;
            res = &mut ensure_task => {
                break res.map_err(|e| format!("OMP ACP daemon startup task failed: {e}"))??;
            }
            _ = startup_tick.tick() => {
                if killed.load(Ordering::SeqCst) {
                    return Ok(());
                }
            }
        }
    };
    *daemon_out = Some(Arc::clone(&client));

    if killed.load(Ordering::SeqCst) {
        return Ok(());
    }

    let (session_id, meta) = match req.session_id.as_deref() {
        Some(existing) => {
            let meta = race_with_kill(
                client.ensure_session_resumed(existing, &req.workspace),
                killed,
            )
            .await?;
            let Some(meta) = meta else {
                return Ok(());
            };
            (existing.to_string(), meta)
        }
        None => {
            let created = race_with_kill(client.create_session(&req.workspace), killed).await?;
            let Some((sid, meta)) = created else {
                return Ok(());
            };
            core.dispatch_event(state, EngineEvent::SessionId(sid.clone()));
            (sid, meta)
        }
    };

    if killed.load(Ordering::SeqCst) {
        return Ok(());
    }

    let options = race_with_kill(
        client.apply_session_options(
            &session_id,
            &meta,
            req.model.as_deref(),
            req.effort.as_deref(),
        ),
        killed,
    )
    .await?;
    let Some((effective_model, effective_effort)) = options else {
        return Ok(());
    };
    if req.model.is_some() || req.effort.is_some() {
        core.dispatch_event(
            state,
            EngineEvent::Launch {
                comparison_model: None,
                model: req.model.clone(),
                effort: req.effort.clone(),
                reports_served: false,
            },
        );
    }
    if let Some(model) = effective_model {
        core.dispatch_event(state, EngineEvent::Model(model));
    }
    if let Some(effort) = effective_effort {
        core.dispatch_event(state, EngineEvent::Effort(effort));
    }

    let prompt_text = if req.native_compact && req.images.is_empty() {
        "/compact"
    } else {
        req.prompt.as_str()
    };
    let blocks = prompt_blocks(prompt_text, &req.images, &req.workspace)?;

    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    client.active_turn_count.fetch_add(1, Ordering::SeqCst);
    lock_unpoisoned(&client.active_turns).insert(session_id.clone(), event_tx);
    let _turn_guard = ActiveTurnGuard {
        client: Arc::clone(&client),
        session_id: session_id.clone(),
    };

    let (rpc_key, mut prompt_rx) = client
        .start_rpc(
            "session/prompt",
            json!({ "sessionId": session_id, "prompt": blocks }),
        )
        .await?;

    let mut cancel_sent = false;
    let mut cancel_deadline: Option<tokio::time::Instant> = None;
    let mut kill_tick = tokio::time::interval(KILL_POLL);
    kill_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    let prompt_result = loop {
        tokio::select! {
            biased;
            res = &mut prompt_rx => {
                // Drain any session/update notifications already queued before
                // the prompt response settled.
                while let Ok(ev) = event_rx.try_recv() {
                    if let DaemonSessionEvent::Update(params) = ev {
                        handle_session_update(core, state, view, &params);
                    }
                }
                break match res {
                    Ok(Ok(value)) => Ok(value),
                    Ok(Err(rpc_err)) => Err(format!("rpc:{}:{}", rpc_err.code, rpc_err.message)),
                    Err(_) => Err("OMP ACP daemon exited before turn finished".to_string()),
                };
            }
            maybe_ev = event_rx.recv() => {
                let Some(ev) = maybe_ev else {
                    client.cancel_pending_rpc(&rpc_key);
                    break Err("OMP ACP daemon stream closed mid-turn".to_string());
                };
                match ev {
                    DaemonSessionEvent::Update(params) => {
                        handle_session_update(core, state, view, &params);
                    }
                    DaemonSessionEvent::AgentRequest { id, method, params } => {
                        if method == ELICITATION_METHOD {
                            if let Some((request_id, mut input)) =
                                elicitation_to_question(&id, &params)
                            {
                                if let Some(ctx) = input
                                    .get_mut("ompAcpElicitation")
                                    .and_then(Value::as_object_mut)
                                {
                                    ctx.insert("daemonId".to_string(), json!(client.daemon_id));
                                }
                                open_elicitations.push((request_id.clone(), id));
                                core.dispatch_event(state, EngineEvent::Question {
                                    request_id,
                                    tool_use_id: None,
                                    input,
                                });
                            } else {
                                let cancel = jsonrpc_result_response(&id, json!({ "action": "cancel" }));
                                let _ = client.write_frame(&cancel).await;
                            }
                        } else {
                            let reply = answer_agent_request(&req.workspace, &id, &method, &params);
                            let _ = client.write_frame(&reply).await;
                        }
                    }
                }
            }
            _ = kill_tick.tick() => {
                if killed.load(Ordering::SeqCst) {
                    if !cancel_sent {
                        cancel_sent = true;
                        cancel_deadline = Some(tokio::time::Instant::now() + CANCEL_SETTLE_TIMEOUT);
                        client.send_cancel(&session_id).await;
                    } else if cancel_deadline.is_some_and(|d| tokio::time::Instant::now() >= d) {
                        client.cancel_pending_rpc(&rpc_key);
                        break Ok(Value::Null);
                    }
                }
            }
        }
    }?;

    if let Some(usage) = prompt_usage(&prompt_result, view.context_window) {
        view.last_usage = Some(usage.clone());
        core.dispatch_event(state, EngineEvent::Usage(usage));
    }
    Ok(())
}

/// Poll `killed` while awaiting a setup RPC so Stop settles immediately even
/// if `session/new` or `session/resume` takes several seconds.
async fn race_with_kill<F, T>(fut: F, killed: &AtomicBool) -> Result<Option<T>, String>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    tokio::pin!(fut);
    let mut tick = tokio::time::interval(KILL_POLL);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            biased;
            res = &mut fut => return res.map(Some),
            _ = tick.tick() => {
                if killed.load(Ordering::SeqCst) {
                    return Ok(None);
                }
            }
        }
    }
}

// ==================== Model & configOption helpers ====================

fn parse_config_current(result: &Value, config_id: &str) -> Option<String> {
    result
        .get("configOptions")
        .and_then(Value::as_array)?
        .iter()
        .find(|opt| opt.get("id").and_then(Value::as_str) == Some(config_id))
        .and_then(|opt| opt.get("currentValue"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_available_models(result: &Value) -> Vec<String> {
    result
        .get("configOptions")
        .and_then(Value::as_array)
        .and_then(|opts| {
            opts.iter()
                .find(|opt| opt.get("id").and_then(Value::as_str) == Some("model"))
        })
        .and_then(|opt| opt.get("options"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("value").and_then(Value::as_str).map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Resolve a requested model selector against the ACP session's advertised
/// `provider/modelId` list: exact match first, then bare `modelId` suffix
/// match (when user passes a model without provider prefix), else passthrough.
pub(crate) fn resolve_model_value(requested: &str, available: &[String]) -> String {
    if available.iter().any(|candidate| candidate == requested) {
        return requested.to_string();
    }
    if !requested.contains('/') {
        let suffix = format!("/{requested}");
        if let Some(matched) = available.iter().find(|candidate| candidate.ends_with(&suffix)) {
            return matched.clone();
        }
    }
    requested.to_string()
}

fn build_loaded_meta(workspace: &Path, session_id: &str, result: &Value) -> LoadedSessionMeta {
    let session_file = locate_session_file(workspace, session_id);
    let session_file_stamp = session_file.as_deref().and_then(file_stamp);
    LoadedSessionMeta {
        workspace: workspace.to_path_buf(),
        current_model: parse_config_current(result, "model"),
        current_effort: parse_config_current(result, "thinking"),
        available_models: parse_available_models(result),
        session_file,
        session_file_stamp,
    }
}

/// Read user-level `~/.omp/agent/mcp.json` and translate enabled servers into
/// ACP `mcpServers` entries (`session/new` and `session/resume`). OMP's ACP
/// mode hardcodes `enableMCP: false` internally and relies on the client to
/// supply MCP servers per session. Intentionally reads ONLY the user's own
/// config — never workspace `.omp/mcp.json` (untrusted repository content).
fn load_user_omp_mcp_servers() -> Vec<Value> {
    let Ok(dir) = super::pi_family_auth::agent_dir("omp") else {
        return Vec::new();
    };
    let Ok(raw) = std::fs::read_to_string(dir.join("mcp.json")) else {
        return Vec::new();
    };
    let Ok(root) = serde_json::from_str::<Value>(&raw) else {
        return Vec::new();
    };
    parse_omp_mcp_servers(&root)
}

/// Convert an OMP `mcp.json` document into ACP `mcpServers` JSON entries
/// matching OMP's `#We` transport adapter (`stdio`, `http`, `sse`).
pub(crate) fn parse_omp_mcp_servers(root: &Value) -> Vec<Value> {
    let Some(servers) = root.get("mcpServers").and_then(Value::as_object) else {
        return Vec::new();
    };
    let disabled: std::collections::HashSet<&str> = root
        .get("disabledServers")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let enabled_only: Option<std::collections::HashSet<&str>> = root
        .get("enabledServers")
        .and_then(Value::as_array)
        .filter(|arr| !arr.is_empty())
        .map(|arr| arr.iter().filter_map(Value::as_str).collect());

    let mut out = Vec::new();
    for (name, raw_spec) in servers {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let Some(spec) = raw_spec.as_object() else {
            continue;
        };
        if disabled.contains(name) {
            continue;
        }
        if let Some(allow) = &enabled_only {
            if !allow.contains(name) {
                continue;
            }
        }
        if spec.get("enabled").and_then(Value::as_bool) == Some(false) {
            continue;
        }
        if spec.get("disabled").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let explicit_type = spec
            .get("type")
            .or_else(|| spec.get("transport"))
            .and_then(Value::as_str)
            .map(|s| s.trim().to_ascii_lowercase());
        if let Some(command) = spec
            .get("command")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let args: Vec<Value> = spec
                .get("args")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(Value::as_str)
                        .map(|s| Value::String(s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let env = kv_pairs_from_object(spec.get("env"));
            out.push(json!({
                "name": name,
                "command": command,
                "args": args,
                "env": env,
            }));
            continue;
        }
        let Some(url) = spec
            .get("url")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let transport = match explicit_type.as_deref() {
            Some("sse") => "sse",
            Some("http" | "streamable-http" | "streamablehttp") | None => "http",
            _ => continue,
        };
        let headers = kv_pairs_from_object(spec.get("headers"));
        out.push(json!({
            "name": name,
            "type": transport,
            "url": url,
            "headers": headers,
        }));
    }
    out
}

fn kv_pairs_from_object(value: Option<&Value>) -> Vec<Value> {
    let Some(map) = value.and_then(Value::as_object) else {
        return Vec::new();
    };
    map.iter()
        .filter_map(|(k, v)| {
            let val = match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                _ => return None,
            };
            Some(json!({ "name": k, "value": val }))
        })
        .collect()
}

/// Best-effort lookup of `<agent_dir>/sessions/<encoded_cwd>/*_<session_id>.jsonl`
/// so external edits to a session file can invalidate the daemon's cached handle.
fn locate_session_file(workspace: &Path, session_id: &str) -> Option<PathBuf> {
    let agent_dir = super::pi_family_auth::agent_dir("omp").ok()?;
    let sessions_dir = agent_dir.join("sessions");
    let suffix = format!("_{session_id}.jsonl");
    let primary = session_dir_name(workspace);
    let canonical = std::fs::canonicalize(workspace).unwrap_or_else(|_| workspace.to_path_buf());
    let text = canonical.to_string_lossy();
    let stripped = text
        .strip_prefix(r"\\?\")
        .unwrap_or(&text)
        .trim_start_matches(['/', '\\']);
    let legacy = format!("--{}--", stripped.replace(['/', '\\', ':'], "-"));
    for dir_name in [primary, legacy] {
        let Ok(entries) = std::fs::read_dir(sessions_dir.join(&dir_name)) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_str().is_some_and(|n| n.ends_with(&suffix)) {
                return Some(entry.path());
            }
        }
    }
    None
}

// ==================== ACP elicitation <-> QuestionCard bridge ====================

const OTHER_SUFFIX: &str = "__other";

/// Project an OMP ACP `elicitation/create` (`mode: "form"`) request into a
/// CCGUI `EngineEvent::Question` payload + `ompAcpElicitation` answer context.
/// Covers OMP's `askDialog` (multi-question, single/multi-select + `__other`),
/// `select`, `confirm`, `input`/`editor`, and generic `formDialog`.
pub(crate) fn elicitation_to_question(rpc_id: &Value, params: &Value) -> Option<(String, Value)> {
    if params.get("mode").and_then(Value::as_str) != Some("form") {
        return None;
    }
    let props = params
        .get("requestedSchema")
        .and_then(|s| s.get("properties"))
        .and_then(Value::as_object)?;
    if props.is_empty() {
        return None;
    }
    let message = params
        .get("message")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");

    let mut primary_keys: Vec<String> = props
        .keys()
        .filter(|k| {
            if let Some(base) = k.strip_suffix(OTHER_SUFFIX) {
                !props.contains_key(base)
            } else {
                true
            }
        })
        .cloned()
        .collect();
    primary_keys.sort_by(|a, b| sort_field_key(a).cmp(&sort_field_key(b)));

    let mut questions = Vec::new();
    let mut fields = Vec::new();

    for key in primary_keys {
        let Some(prop) = props.get(&key) else {
            continue;
        };
        let other_key = {
            let candidate = format!("{key}{OTHER_SUFFIX}");
            props.contains_key(&candidate).then_some(candidate)
        };
        let prop_type = prop.get("type").and_then(Value::as_str).unwrap_or("string");
        let title = prop
            .get("title")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let description = prop
            .get("description")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty());

        let question_text = if key == "value" && !message.is_empty() {
            message.to_string()
        } else if let Some(t) = title {
            t.to_string()
        } else if !message.is_empty() {
            message.to_string()
        } else {
            key.clone()
        };
        let header = if key == "value" {
            "提问".to_string()
        } else {
            description.unwrap_or("提问").to_string()
        };

        if prop_type == "boolean" {
            questions.push(json!({
                "question": question_text,
                "header": header,
                "multiSelect": false,
                "options": [
                    { "label": CONFIRM_YES_LABEL },
                    { "label": "取消" },
                ],
            }));
            fields.push(json!({
                "key": key,
                "question": question_text,
                "kind": "boolean",
            }));
            continue;
        }

        if prop_type == "array" {
            let choices = extract_schema_choices(prop.get("items").unwrap_or(prop));
            let options = choices_to_options(&choices);
            questions.push(json!({
                "question": question_text,
                "header": header,
                "multiSelect": true,
                "options": options,
            }));
            fields.push(json!({
                "key": key,
                "otherKey": other_key,
                "question": question_text,
                "kind": "multi",
                "choices": choices,
            }));
            continue;
        }

        let choices = extract_schema_choices(prop);
        if !choices.is_empty() {
            let options = choices_to_options(&choices);
            questions.push(json!({
                "question": question_text,
                "header": header,
                "multiSelect": false,
                "options": options,
            }));
            fields.push(json!({
                "key": key,
                "otherKey": other_key,
                "question": question_text,
                "kind": "single",
                "choices": choices,
            }));
            continue;
        }

        let kind = if prop_type == "number" || prop_type == "integer" {
            "number"
        } else {
            "string"
        };
        questions.push(json!({
            "question": question_text,
            "header": header,
            "multiSelect": false,
            "options": [],
        }));
        fields.push(json!({
            "key": key,
            "otherKey": other_key,
            "question": question_text,
            "kind": kind,
        }));
    }

    if questions.is_empty() {
        return None;
    }

    let request_id = format!(
        "omp-acp-elicit-{}",
        jsonrpc_id_key(rpc_id).unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
    );
    let input = json!({
        "questions": questions,
        "ompAcpElicitation": {
            "rpcId": rpc_id,
            "fields": fields,
        }
    });
    Some((request_id, input))
}

fn sort_field_key(key: &str) -> (u8, usize, String) {
    if let Some(rest) = key.strip_prefix('q') {
        let base = rest.strip_suffix(OTHER_SUFFIX).unwrap_or(rest);
        if let Ok(index) = base.parse::<usize>() {
            return (0, index, key.to_string());
        }
    }
    (1, 0, key.to_string())
}

fn extract_schema_choices(schema: &Value) -> Vec<Value> {
    if let Some(items) = schema
        .get("oneOf")
        .or_else(|| schema.get("anyOf"))
        .and_then(Value::as_array)
    {
        return items
            .iter()
            .filter_map(|item| {
                let value = item.get("const").and_then(Value::as_str)?;
                let label = item
                    .get("title")
                    .and_then(Value::as_str)
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or(value);
                let description = item
                    .get("description")
                    .and_then(Value::as_str)
                    .filter(|s| !s.trim().is_empty());
                Some(json!({
                    "value": value,
                    "label": label,
                    "description": description,
                }))
            })
            .collect();
    }
    if let Some(items) = schema.get("enum").and_then(Value::as_array) {
        return items
            .iter()
            .filter_map(|item| {
                let value = item.as_str()?;
                Some(json!({ "value": value, "label": value }))
            })
            .collect();
    }
    Vec::new()
}

fn choices_to_options(choices: &[Value]) -> Vec<Value> {
    choices
        .iter()
        .filter_map(|choice| {
            let label = choice.get("label").and_then(Value::as_str)?;
            match choice.get("description").and_then(Value::as_str) {
                Some(desc) => Some(json!({ "label": label, "description": desc })),
                None => Some(json!({ "label": label })),
            }
        })
        .collect()
}

/// Build the JSON-RPC `CreateElicitationResponse` frame for a parked
/// `ompAcpElicitation` question card.
pub(crate) fn answer_frame(parked: &Value, answers: Option<&Value>) -> Result<Value, String> {
    let rpc_id = parked
        .get("rpcId")
        .filter(|id| !id.is_null())
        .ok_or_else(|| "OMP ACP elicitation context missing rpcId".to_string())?;
    let Some(answers) = answers else {
        return Ok(jsonrpc_result_response(rpc_id, json!({ "action": "cancel" })));
    };
    let answer_map = answers
        .as_object()
        .ok_or_else(|| "OMP ACP elicitation answers must be an object".to_string())?;
    let fields = parked
        .get("fields")
        .and_then(Value::as_array)
        .ok_or_else(|| "OMP ACP elicitation context missing fields".to_string())?;

    let mut content = Map::new();
    let single_field = fields.len() == 1;
    for field in fields {
        let key = field
            .get("key")
            .and_then(Value::as_str)
            .ok_or_else(|| "elicitation field missing key".to_string())?;
        let question = field
            .get("question")
            .and_then(Value::as_str)
            .unwrap_or(key);
        let kind = field
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("string");
        let other_key = field.get("otherKey").and_then(Value::as_str);
        let choices = field
            .get("choices")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        let raw_answer = answer_map
            .get(question)
            .or_else(|| single_field.then(|| answer_map.values().next()).flatten());
        let Some(raw_answer) = raw_answer else {
            continue;
        };

        match kind {
            "boolean" => {
                let text = answer_as_text(raw_answer);
                content.insert(key.to_string(), Value::Bool(text == CONFIRM_YES_LABEL));
            }
            "number" => {
                let text = answer_as_text(raw_answer);
                if let Ok(n) = text.trim().parse::<i64>() {
                    content.insert(key.to_string(), json!(n));
                } else if let Ok(n) = text.trim().parse::<f64>() {
                    content.insert(key.to_string(), json!(n));
                } else {
                    content.insert(key.to_string(), Value::String(text));
                }
            }
            "single" => {
                let text = answer_as_text(raw_answer);
                if let Some(matched) = match_choice(&choices, &text) {
                    content.insert(key.to_string(), Value::String(matched));
                } else if let Some(other) = other_key {
                    content.insert(other.to_string(), Value::String(text));
                } else {
                    content.insert(key.to_string(), Value::String(text));
                }
            }
            "multi" => {
                let items = match raw_answer {
                    Value::Array(arr) => arr
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect::<Vec<_>>(),
                    Value::String(s) if !s.trim().is_empty() => vec![s.clone()],
                    _ => Vec::new(),
                };
                let mut selected = Vec::new();
                let mut custom = Vec::new();
                for item in items {
                    if let Some(matched) = match_choice(&choices, &item) {
                        selected.push(Value::String(matched));
                    } else if !item.trim().is_empty() {
                        custom.push(item);
                    }
                }
                content.insert(key.to_string(), Value::Array(selected));
                if !custom.is_empty() {
                    if let Some(other) = other_key {
                        content.insert(other.to_string(), Value::String(custom.join(", ")));
                    }
                }
            }
            _ => {
                content.insert(key.to_string(), Value::String(answer_as_text(raw_answer)));
            }
        }
    }

    Ok(jsonrpc_result_response(
        rpc_id,
        json!({ "action": "accept", "content": content }),
    ))
}

fn answer_as_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(", "),
        other => other.to_string(),
    }
}

fn match_choice(choices: &[Value], text: &str) -> Option<String> {
    choices.iter().find_map(|choice| {
        let value = choice.get("value").and_then(Value::as_str)?;
        let label = choice.get("label").and_then(Value::as_str).unwrap_or(value);
        (text == label || text == value).then(|| value.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_req() -> SendRequest {
        SendRequest {
            session_id: None,
            workspace: PathBuf::from("/tmp/ws"),
            prompt: "hello".into(),
            prompt_contributions: Vec::new(),
            native_compact: false,
            images: Vec::new(),
            model: Some("prov/model-a".into()),
            effort: Some("high".into()),
            service_tier: None,
            permission: Some("auto".into()),
            additional_dirs: Vec::new(),
            provider_id: None,
            computer_use: None,
            memory_bot: None,
            allowed_tools: None,
            no_tools: false,
        }
    }

    fn empty_built() -> BuiltCommand {
        BuiltCommand {
            command: command_for_binary("omp"),
            stdin_payload: None,
            keep_stdin_open: false,
            cleanup_files: Vec::new(),
            mcp_restore: None,
            preassigned_session_id: None,
        }
    }

    #[test]
    fn should_use_daemon_gates_only_eligible_local_omp_sends() {
        let built = empty_built();
        assert!(should_use_daemon("omp", &sample_req(), &built, false));

        // Bypass and compact both run on the daemon.
        let mut bypass = sample_req();
        bypass.permission = Some("bypass".into());
        bypass.native_compact = true;
        assert!(should_use_daemon("omp", &bypass, &built, false));

        // Plan, WSL, computer_use, memory_bot, non-omp all stay off the daemon.
        assert!(!should_use_daemon("pi", &sample_req(), &built, false));
        assert!(!should_use_daemon("omp", &sample_req(), &built, true));

        let mut plan = sample_req();
        plan.permission = Some("plan".into());
        assert!(!should_use_daemon("omp", &plan, &built, false));

        let mut cu = sample_req();
        cu.computer_use = Some(true);
        assert!(!should_use_daemon("omp", &cu, &built, false));

        let mut mem = sample_req();
        mem.memory_bot = Some("bot-1".into());
        assert!(!should_use_daemon("omp", &mem, &built, false));
    }

    #[test]
    fn resolve_model_value_handles_exact_and_bare_ids() {
        let available = vec![
            "custom-1/gemini-4".to_string(),
            "custom-2/claude-4".to_string(),
        ];
        assert_eq!(
            resolve_model_value("custom-1/gemini-4", &available),
            "custom-1/gemini-4"
        );
        assert_eq!(
            resolve_model_value("claude-4", &available),
            "custom-2/claude-4"
        );
        assert_eq!(
            resolve_model_value("other/unknown", &available),
            "other/unknown"
        );
    }

    #[test]
    fn ask_dialog_elicitation_round_trips_single_multi_and_custom_other() {
        let params = json!({
            "mode": "form",
            "sessionId": "s-1",
            "message": "Answer 2 questions",
            "requestedSchema": {
                "type": "object",
                "properties": {
                    "q0": {
                        "type": "string",
                        "title": "选择数据库",
                        "description": "存储",
                        "oneOf": [
                            { "const": "SQLite", "title": "SQLite", "description": "单文件" },
                            { "const": "Postgres", "title": "Postgres" }
                        ]
                    },
                    "q0__other": { "type": "string", "title": "Other (type your own)" },
                    "q1": {
                        "type": "array",
                        "title": "启用的特性",
                        "items": {
                            "anyOf": [
                                { "const": "Cache", "title": "Cache" },
                                { "const": "Metrics", "title": "Metrics" }
                            ]
                        }
                    },
                    "q1__other": { "type": "string", "title": "Other (type your own)" }
                }
            }
        });
        let (req_id, input) = elicitation_to_question(&json!(42), &params).expect("question");
        assert_eq!(req_id, "omp-acp-elicit-42");
        assert_eq!(input["questions"].as_array().unwrap().len(), 2);
        assert_eq!(input["questions"][0]["question"], "选择数据库");
        assert_eq!(input["questions"][0]["multiSelect"], false);
        assert_eq!(input["questions"][1]["multiSelect"], true);

        let parked = &input["ompAcpElicitation"];
        // Custom answer for q0 routes to q0__other; mixed known + custom for q1 splits cleanly.
        let frame = answer_frame(
            parked,
            Some(&json!({
                "选择数据库": "DuckDB",
                "启用的特性": ["Cache", "Tracing"]
            })),
        )
        .unwrap();
        assert_eq!(frame["id"], json!(42));
        assert_eq!(frame["result"]["action"], json!("accept"));
        assert_eq!(frame["result"]["content"]["q0__other"], json!("DuckDB"));
        assert!(frame["result"]["content"].get("q0").is_none());
        assert_eq!(frame["result"]["content"]["q1"], json!(["Cache"]));
        assert_eq!(frame["result"]["content"]["q1__other"], json!("Tracing"));

        // Dismiss -> cancel.
        let dismissed = answer_frame(parked, None).unwrap();
        assert_eq!(dismissed["result"]["action"], json!("cancel"));
    }

    #[test]
    fn confirm_select_and_input_elicitations_map_to_value_field() {
        let confirm = json!({
            "mode": "form",
            "message": "继续执行吗？",
            "requestedSchema": {
                "type": "object",
                "properties": { "value": { "type": "boolean" } },
                "required": ["value"]
            }
        });
        let (_, input) = elicitation_to_question(&json!("c1"), &confirm).unwrap();
        let yes = answer_frame(
            &input["ompAcpElicitation"],
            Some(&json!({ "继续执行吗？": CONFIRM_YES_LABEL })),
        )
        .unwrap();
        assert_eq!(yes["result"]["content"]["value"], json!(true));
        let no = answer_frame(
            &input["ompAcpElicitation"],
            Some(&json!({ "继续执行吗？": "取消" })),
        )
        .unwrap();
        assert_eq!(no["result"]["content"]["value"], json!(false));

        let select = json!({
            "mode": "form",
            "message": "选一个",
            "requestedSchema": {
                "type": "object",
                "properties": { "value": { "type": "string", "enum": ["A", "B"] } },
                "required": ["value"]
            }
        });
        let (_, input) = elicitation_to_question(&json!(7), &select).unwrap();
        let picked = answer_frame(&input["ompAcpElicitation"], Some(&json!({ "选一个": "B" }))).unwrap();
        assert_eq!(picked["result"]["content"]["value"], json!("B"));
    }

    #[test]
    fn daemon_spec_captures_auto_approve_and_extra_env() {
        let mut req = sample_req();
        let mut cmd = command_for_binary("omp");
        cmd.env("CUSTOM_API_KEY", "secret");
        cmd.env("CCGUI_SERVED_MODEL_FILE", "/tmp/ignored.tsv");

        let spec_a = OmpDaemonSpec::from_launch("omp".into(), &req, &cmd, None).unwrap();
        assert!(!spec_a.auto_approve);
        assert_eq!(spec_a.extra_env.get("CUSTOM_API_KEY").map(String::as_str), Some("secret"));
        assert!(!spec_a.extra_env.contains_key("CCGUI_SERVED_MODEL_FILE"));

        req.permission = Some("bypass".into());
        let spec_b = OmpDaemonSpec::from_launch("omp".into(), &req, &cmd, None).unwrap();
        assert!(spec_b.auto_approve);
        assert_ne!(spec_a, spec_b);
    }

    #[test]
    fn parse_omp_mcp_servers_translates_stdio_http_sse_and_skips_disabled() {
        let doc = json!({
            "disabledServers": ["blocked"],
            "mcpServers": {
                "codegraph": {
                    "type": "stdio",
                    "command": "node",
                    "args": ["serve", "--mcp"],
                    "env": { "LOG": "info" }
                },
                "remote": {
                    "type": "http",
                    "url": "https://example.test/mcp",
                    "headers": { "Authorization": "Bearer x" }
                },
                "stream": {
                    "type": "sse",
                    "url": "https://example.test/sse"
                },
                "off_flag": {
                    "command": "node",
                    "enabled": false
                },
                "blocked": {
                    "command": "node"
                }
            }
        });
        let servers = parse_omp_mcp_servers(&doc);
        assert_eq!(servers.len(), 3);
        let cg = servers.iter().find(|s| s["name"] == "codegraph").unwrap();
        assert_eq!(cg["command"], "node");
        assert_eq!(cg["args"], json!(["serve", "--mcp"]));
        assert_eq!(cg["env"], json!([{ "name": "LOG", "value": "info" }]));
        let remote = servers.iter().find(|s| s["name"] == "remote").unwrap();
        assert_eq!(remote["type"], "http");
        assert_eq!(remote["url"], "https://example.test/mcp");
        assert_eq!(remote["headers"], json!([{ "name": "Authorization", "value": "Bearer x" }]));
        let stream = servers.iter().find(|s| s["name"] == "stream").unwrap();
        assert_eq!(stream["type"], "sse");
    }
}
