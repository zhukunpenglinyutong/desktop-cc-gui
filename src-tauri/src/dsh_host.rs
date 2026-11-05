//! DeepSeek Harness (DSH) local-host maintenance: probe/adopt/spawn/stop the
//! `dsh web` server. CLI version/update lives in [`crate::cli_lifecycle`].
//!
//! Wire protocol (0.1.2+ typert gateway, verified against tmd-cli's cli-dsh):
//! `POST {origin}/api/<namespace>/<method>` with
//! `{type:"client-request",rpcId,method,payload:{args}}` →
//! `{type:"server-response",rpcId,result:{ok:true,value}|{ok:false,error}}`.
//!
//! BrowserAuth (0.1.2+): every RPC requires the signed `dsh-auth-*` cookie.
//! Credential chain: the spawned host prints a one-time launch token
//! (`dsh web: http://…/?token=…`) on its output; we capture it, exchange it
//! via `GET /?token=…` (303 + set-cookie, no redirects), and persist the
//! cookie per-origin in `~/.ccgui-next/dsh-host-credentials.json`. The cookie
//! rides only on requests to the origin of the child this run spawned
//! ([`TRUSTED_ORIGIN`]); anything else answering on the port never sees it.
//!
//! Ownership rule: only the `dsh web` child we spawned is tracked in
//! [`DshHostState`], restarted and killed (app exit / dsh_host_stop). A host
//! answering describe without our credentials is adopted as-is; anything else
//! on the port — a 401, a different HTTP service — is reported as "port
//! occupied" and left running. CC GUI never looks up and kills whatever
//! listens on a port: v1.2.0 did (`netstat` + `taskkill /T /F`, `lsof` +
//! `kill -KILL`) on every launch and took down other apps' services on 3080.

use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Child;
use tokio::time::{sleep, Instant};

use crate::engine::{command_for_binary, resolve};
use crate::settings::AppSettings;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 3080;
const DESCRIBE_METHOD: &str = "settings/describe";
const DESCRIBE_CONNECT_TIMEOUT: Duration = Duration::from_millis(800);
const DESCRIBE_TOTAL_TIMEOUT: Duration = Duration::from_secs(3);
const SPAWN_POLL_INTERVAL: Duration = Duration::from_millis(250);
/// Windows npm shims chain through cmd → node and cold-start noticeably
/// slower; give the spawn readiness poll extra headroom there.
#[cfg(windows)]
const SPAWN_READY_TIMEOUT: Duration = Duration::from_secs(45);
#[cfg(not(windows))]
const SPAWN_READY_TIMEOUT: Duration = Duration::from_secs(20);
/// Bytes of spawned-host stdout+stderr kept for error reporting.
const RING_CAP: usize = 8192;
/// Per-process stdout+stderr log files of spawned hosts, under the app home:
/// `~/.ccgui-next/dsh-host-logs/dsh-host-<epoch>.log`. The in-memory ring above
/// dies with the process, and a host that is killed mid-turn (app exit tears
/// down its kill-on-close job, `dsh_host_stop`, or an outside kill) leaves no
/// other trace of why a turn was cut — which is exactly the case this file
/// exists for. The newest `LOG_KEEP_RUNS` files survive; older runs are dropped
/// on the next spawn.
const LOG_DIR: &str = "dsh-host-logs";
/// Rotate one log file at this size so a wedged or chatty host cannot grow it
/// without bound. The rotated copy keeps the last window before rotation.
const LOG_MAX_BYTES: u64 = 4 * 1024 * 1024;
const LOG_KEEP_SUFFIX: &str = ".1";
/// Per-run logs kept on disk, newest first by the epoch in the file name; older
/// runs are dropped on the next spawn. One log per spawn means a crash-restart
/// loop would otherwise only ever grow the directory. A run holds at most
/// `2 * LOG_MAX_BYTES` (the file plus its `.1`), so the directory stays under
/// `(LOG_KEEP_RUNS + 1) * 8 MB` — 72 MB here — while still keeping the last few
/// spawns a diagnosis wants to compare.
const LOG_KEEP_RUNS: usize = 8;
/// Launch-token exchange retries while the host finishes binding its
/// listener: the token line can land before the HTTP server answers.
const TOKEN_EXCHANGE_ATTEMPTS: usize = 6;
const TOKEN_EXCHANGE_RETRY_INTERVAL: Duration = Duration::from_millis(400);
/// Readiness-loop cadence for re-exchanging a stored token while probes
/// keep coming back 401.
const TOKEN_REEXCHANGE_INTERVAL: Duration = Duration::from_secs(1);
// ==================== State ====================

/// Managed inside AppState; holds the spawned host child, if any.
#[derive(Default)]
pub struct DshHostState {
    spawned: Mutex<Option<Spawned>>,
    /// Serializes ensure (adopt-or-spawn) so autostart and a manual start
    /// never race each other into two spawns of the same port.
    ensure: tokio::sync::Mutex<()>,
}

struct Spawned {
    child: Child,
    origin: String,
    /// Kill-on-close job guard (Windows): conversation shells (pwsh.exe)
    /// spawned by host sessions can orphan before the taskkill /T walk ever
    /// sees them; dropping this guard closes the job and the kernel sweeps
    /// every surviving member. Field order matters: the guard is declared
    /// last so it drops after `Drop::drop` kills the host, sweeping any
    /// grandchild that escaped the tree walk.
    #[cfg(windows)]
    _tree_guard: Option<std::sync::Arc<crate::engine::job::KillOnCloseJob>>,
}

impl Drop for Spawned {
    fn drop(&mut self) {
        distrust_origin(&self.origin);
        if let Some(pid) = self.child.id() {
            crate::engine::kill_process_group(pid);
        }
        let _ = self.child.start_kill();
    }
}

impl DshHostState {
    /// Kill only the host child we spawned (window Destroyed, stop, restart).
    /// Adopted hosts are never tracked, so they survive us by construction.
    /// Returns whether there was a child to kill.
    pub fn kill_spawned(&self) -> bool {
        let mut guard = lock(&self.spawned);
        // Drop of Spawned kills the process group.
        guard.take().is_some()
    }

    /// Forget a tracked child that has already exited, so a dead child is
    /// neither treated as ours nor keeps the cookie trusted.
    fn reap_exited(&self) {
        let mut guard = lock(&self.spawned);
        let exited = guard
            .as_mut()
            .is_some_and(|spawned| !matches!(spawned.child.try_wait(), Ok(None)));
        if exited {
            guard.take();
        }
    }

    fn spawned_origin(&self) -> Option<String> {
        lock(&self.spawned)
            .as_ref()
            .map(|spawned| spawned.origin.clone())
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Origin of the `dsh web` child this run spawned: set right after the spawn
/// (its readiness probes need the cookie) and cleared when the child is
/// dropped or the spawn fails. The stored BrowserAuth cookie is attached only
/// for this origin, so another program on the port — or one squatting it
/// while the host is down — never receives a credential for the real host.
static TRUSTED_ORIGIN: Mutex<Option<String>> = Mutex::new(None);

fn origin_trusted(origin: &str) -> bool {
    lock(&TRUSTED_ORIGIN).as_deref() == Some(origin)
}

fn distrust_origin(origin: &str) {
    let mut trusted = lock(&TRUSTED_ORIGIN);
    if trusted.as_deref() == Some(origin) {
        *trusted = None;
    }
}

/// Trust for a spawn still proving itself: dropped without `keep()` (any
/// early return from the readiness loop) it withdraws the trust again.
struct PendingTrust {
    origin: String,
    kept: bool,
}

impl PendingTrust {
    fn grant(origin: &str) -> Self {
        *lock(&TRUSTED_ORIGIN) = Some(origin.to_string());
        Self {
            origin: origin.to_string(),
            kept: false,
        }
    }

    /// Hand the trust over to the tracked [`Spawned`] (its drop withdraws it).
    fn keep(mut self) {
        self.kept = true;
    }

    /// Withdraw early, before probing a port our child no longer answers on.
    fn withdraw(&self) {
        distrust_origin(&self.origin);
    }
}

impl Drop for PendingTrust {
    fn drop(&mut self) {
        if !self.kept {
            distrust_origin(&self.origin);
        }
    }
}

// ==================== Config / status ====================

struct HostConfig {
    host: String,
    port: u16,
    origin: String,
    auto_start: bool,
}

impl HostConfig {
    fn from(settings: &AppSettings) -> Self {
        let host = settings
            .dsh_host
            .as_deref()
            .map(str::trim)
            .filter(|h| !h.is_empty())
            .unwrap_or(DEFAULT_HOST)
            .to_string();
        let port = settings.dsh_port.filter(|p| *p > 0).unwrap_or(DEFAULT_PORT);
        let origin = format!("http://{host}:{port}");
        let auto_start = settings.dsh_auto_start != Some(false);
        Self {
            host,
            port,
            origin,
            auto_start,
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DshHostStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub host: String,
    pub port: u16,
    pub origin: String,
    pub auto_start: bool,
    pub running: bool,
    /// "spawned" when the answering host is our child, "adopted" when it
    /// predates us; null when nothing is running.
    pub ownership: Option<&'static str>,
    /// Normalized describe view (provider/model from the
    /// `agent-default-model` namespace) for the settings card.
    pub describe: Option<Value>,
    /// Web UI entry with the persisted launch token, when we hold one —
    /// BrowserAuth gates the web UI the same way it gates RPC.
    pub web_url: Option<String>,
    /// Set only when the host is not running and the probe produced an error.
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OkResult {
    pub ok: bool,
}
// ==================== Credentials store ====================

#[derive(Serialize, Deserialize, Clone)]
struct HostCredentials {
    cookie: String,
    launch_token: String,
}

/// Per-origin credential file: `{"<origin>": {"cookie", "launchToken"}}`.
/// Keyed by origin because the cookie's BrowserAuth signature is bound to
/// the host:port authority — an origin change invalidates it by construction.
fn credentials_path() -> PathBuf {
    crate::paths::app_home().join("dsh-host-credentials.json")
}

fn load_credentials(origin: &str) -> Option<HostCredentials> {
    let text = std::fs::read_to_string(credentials_path()).ok()?;
    let map: BTreeMap<String, HostCredentials> = serde_json::from_str(&text).ok()?;
    map.get(origin).cloned()
}

fn store_credentials(origin: &str, credentials: HostCredentials) {
    let mut map: BTreeMap<String, HostCredentials> = std::fs::read_to_string(credentials_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    map.insert(origin.to_string(), credentials);
    match serde_json::to_string_pretty(&map) {
        Ok(content) => {
            if let Err(error) = crate::settings::atomic_write(&credentials_path(), &content) {
                eprintln!("[dsh] persisting host credentials failed: {error}");
            }
        }
        Err(error) => eprintln!("[dsh] serializing host credentials failed: {error}"),
    }
}

// ==================== Launch token ====================

/// Scan one line of host output for the one-time launch token the 0.1.2 host
/// prints (`dsh web: http://…/?token=<A-Za-z0-9_-]>`). Hand-rolled needle
/// scan — the token alphabet is URL-safe, no regex crate involved.
fn extract_launch_token(line: &str) -> Option<String> {
    const NEEDLE: &str = "token=";
    let bytes = line.as_bytes();
    let mut from = 0;
    while let Some(rel) = line[from..].find(NEEDLE) {
        let at = from + rel;
        from = at + NEEDLE.len();
        // A real launch token sits in a query string: "?token=" / "&token=".
        if at > 0 && !matches!(bytes[at - 1], b'?' | b'&') {
            continue;
        }
        let rest = &line[from..];
        let end = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-'))
            .unwrap_or(rest.len());
        if end > 0 {
            return Some(rest[..end].to_string());
        }
    }
    None
}

/// Launched once per spawn: watches the child's output for the launch token
/// and swaps it for the auth cookie on first sight.
struct TokenCapture {
    origin: String,
    /// Last launch token seen in the child's output, kept so the readiness
    /// loop can re-exchange it if the one-shot capture raced the listener.
    token: Mutex<Option<String>>,
    /// Guards against double exchange while an attempt (with its retries) is
    /// still in flight; reset if the exchange failed so a later line can
    /// retrigger.
    busy: AtomicBool,
}

impl TokenCapture {
    async fn capture(self: &Arc<Self>, line: &str) {
        if self.busy.swap(true, Ordering::Relaxed) {
            return;
        }
        let Some(token) = extract_launch_token(line) else {
            self.busy.store(false, Ordering::Relaxed);
            return;
        };
        *lock(&self.token) = Some(token);
        self.exchange_until_stored().await;
    }

    /// One re-exchange of the stored token; the readiness loop calls this
    /// while probes keep coming back 401. No-op when no token has been seen
    /// yet or an exchange is already in flight.
    async fn reexchange_stored(self: &Arc<Self>) {
        if self.busy.swap(true, Ordering::Relaxed) {
            return;
        }
        if lock(&self.token).is_none() {
            self.busy.store(false, Ordering::Relaxed);
            return;
        }
        self.exchange_until_stored().await;
    }

    /// Exchange the stored token (with retries against a host that may still
    /// be binding) and persist the credentials. Resets `busy` on failure so a
    /// later line / loop tick can retry.
    async fn exchange_until_stored(self: &Arc<Self>) {
        let token = lock(&self.token).clone();
        let Some(token) = token else {
            self.busy.store(false, Ordering::Relaxed);
            return;
        };
        for _ in 0..TOKEN_EXCHANGE_ATTEMPTS {
            if let Some(cookie) = exchange_token(&self.origin, &token).await {
                store_credentials(
                    &self.origin,
                    HostCredentials {
                        cookie,
                        launch_token: token,
                    },
                );
                return;
            }
            sleep(TOKEN_EXCHANGE_RETRY_INTERVAL).await;
        }
        eprintln!("[dsh] launch token exchange failed; keeping probe-driven fallback");
        self.busy.store(false, Ordering::Relaxed);
    }
}

// ==================== Probes ====================

/// RPC client for the DSH host, split by origin locality.
///
/// Local origins never ride a proxy: the host runs on this machine, and
/// letting the configured network proxy reroute a loopback dial turned a
/// dead host into proxy chatter — every failed catalog probe surfaced as a
/// refused proxied connection. Remote origins keep reqwest's default
/// env-proxy behaviour so they stay reachable through a configured proxy.
fn http_client(origin: &str) -> &'static reqwest::Client {
    static LOCAL: LazyLock<reqwest::Client> = LazyLock::new(|| {
        reqwest::Client::builder()
            .connect_timeout(DESCRIBE_CONNECT_TIMEOUT)
            .timeout(DESCRIBE_TOTAL_TIMEOUT)
            .no_proxy()
            .build()
            .expect("reqwest client")
    });
    static REMOTE: LazyLock<reqwest::Client> = LazyLock::new(|| {
        reqwest::Client::builder()
            .connect_timeout(DESCRIBE_CONNECT_TIMEOUT)
            .timeout(DESCRIBE_TOTAL_TIMEOUT)
            .build()
            .expect("reqwest client")
    });
    if origin_is_local(origin) {
        &LOCAL
    } else {
        &REMOTE
    }
}

/// Redirect-disabling client for the token exchange (same locality split as
/// [`http_client`]): the host answers `GET /?token=…` with 303 + set-cookie,
/// and following the redirect would drop the header we need.
fn exchange_client(origin: &str) -> &'static reqwest::Client {
    static LOCAL: LazyLock<reqwest::Client> = LazyLock::new(|| {
        reqwest::Client::builder()
            .connect_timeout(DESCRIBE_CONNECT_TIMEOUT)
            .timeout(DESCRIBE_TOTAL_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .build()
            .expect("reqwest client")
    });
    static REMOTE: LazyLock<reqwest::Client> = LazyLock::new(|| {
        reqwest::Client::builder()
            .connect_timeout(DESCRIBE_CONNECT_TIMEOUT)
            .timeout(DESCRIBE_TOTAL_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("reqwest client")
    });
    if origin_is_local(origin) {
        &LOCAL
    } else {
        &REMOTE
    }
}

/// Token → cookie: `GET {origin}/?token=…` without redirects; 303 +
/// set-cookie yields the `name=value` pair (first attribute, before `;`).
async fn exchange_token(origin: &str, token: &str) -> Option<String> {
    let response = exchange_client(origin)
        .get(format!("{origin}/?token={token}"))
        .send()
        .await
        .ok()?;
    if response.status() != reqwest::StatusCode::SEE_OTHER {
        return None;
    }
    let raw = response
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .next()?
        .to_str()
        .ok()?;
    let pair = raw.split(';').next()?.trim();
    (!pair.is_empty()).then(|| pair.to_string())
}

/// Configured `http://host:port` origin for the DSH host.
pub(crate) fn configured_origin(settings: &AppSettings) -> String {
    HostConfig::from(settings).origin
}

/// The persisted BrowserAuth cookie for `origin`, when this app holds one.
/// Host-session RPC (chat turns) rides the same credential chain as the
/// probes: cookie captured from the launch token, keyed by origin.
pub(crate) fn host_cookie(origin: &str) -> Option<String> {
    if !origin_trusted(origin) {
        return None;
    }
    load_credentials(origin).map(|credentials| credentials.cookie)
}

/// One HTTP round-trip: `POST {origin}/api/{method}` with the client-request
/// envelope (0.1.2 wraps call args in `payload.args`) and the stored auth
/// cookie, returning `(HTTP status, parsed envelope)`. Transport failures map
/// to Err; a non-JSON body yields `Value::Null` with its status intact so
/// callers can classify auth failures.
async fn host_post(origin: &str, method: &str, args: Value) -> Result<(u16, Value), String> {
    let mut request = http_client(origin)
        .post(format!("{origin}/api/{method}"))
        .header(reqwest::header::CONTENT_TYPE, "application/json");
    if let Some(cookie) = host_cookie(origin) {
        request = request.header(reqwest::header::COOKIE, cookie);
    }
    let body = json!({
        "type": "client-request",
        "rpcId": uuid::Uuid::new_v4().to_string(),
        "method": method,
        "payload": { "args": args },
    });
    let response = request
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("无法连接 {origin}（{e}）"))?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|e| format!("{method} 响应读取失败（{e}）"))?;
    Ok((status, serde_json::from_str(&text).unwrap_or(Value::Null)))
}

/// One unary RPC round-trip, returning the server-response `result.value`.
pub(crate) async fn host_call(origin: &str, method: &str, args: Value) -> Result<Value, String> {
    host_call_rpc(origin, method, args)
        .await
        .map_err(|error| error.message)
}

/// RPC refusal with the gateway's structured error kept intact, so callers
/// can classify on `code`/`details.reason` (e.g. the image-admission
/// leftover refusal) instead of parsing a flattened message. `message`
/// carries the same flattened text `host_call` reports; transport-level
/// failures (401, non-envelope) use synthetic codes.
pub(crate) struct HostRpcError {
    pub code: String,
    pub message: String,
    pub details: Value,
}

/// One unary RPC round-trip, returning the server-response `result.value`.
pub(crate) async fn host_call_rpc(
    origin: &str,
    method: &str,
    args: Value,
) -> Result<Value, HostRpcError> {
    let flattened = match host_post(origin, method, args).await {
        Ok(pair) => pair,
        Err(message) => {
            return Err(HostRpcError {
                code: "transport".to_string(),
                message,
                details: Value::Null,
            })
        }
    };
    let (status, envelope) = flattened;
    if status == 401 {
        return Err(HostRpcError {
            code: "unauthorized".to_string(),
            message: format!(
                "{method} 未授权（401）：host 凭据缺失或已失效，请在设置里重新启动 DSH host。"
            ),
            details: Value::Null,
        });
    }
    if envelope.get("type").and_then(Value::as_str) != Some("server-response") {
        return Err(HostRpcError {
            code: "bad-envelope".to_string(),
            message: format!("{method} 响应格式不正确（非 server-response）"),
            details: Value::Null,
        });
    }
    let result = envelope.get("result").cloned().unwrap_or(Value::Null);
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(result.get("value").cloned().unwrap_or(Value::Null));
    }
    let error = result.get("error").cloned().unwrap_or(Value::Null);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("未知错误");
    Err(HostRpcError {
        code: error
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        message: format!("{method} 被拒绝：{message}"),
        details: error.get("details").cloned().unwrap_or(Value::Null),
    })
}

/// Liveness classification for the describe probe. `Unauthorized` means the
/// host is up but rejects our credentials — distinct from down, and the
/// adopt/respawn decision hinges on it (0.1.2 BrowserAuth semantics).
pub(crate) enum ProbeOutcome {
    Live(Value),
    Unauthorized,
    /// Something answered HTTP but is not a usable DSH host (non-envelope
    /// body, refused describe): the port is taken, not free.
    Answered(String),
    /// Nothing reachable (connect / transport failure).
    Down(String),
}

impl ProbeOutcome {
    fn is_live(&self) -> bool {
        matches!(self, ProbeOutcome::Live(_))
    }
}

/// One `settings/describe` round-trip against `origin` (0.1.2 removed
/// host.describe; provider/model live under the `agent-default-model`
/// namespace of the returned value).
pub(crate) async fn probe_describe(origin: &str) -> ProbeOutcome {
    let (status, envelope) = match host_post(origin, DESCRIBE_METHOD, json!({})).await {
        Ok(pair) => pair,
        Err(e) => return ProbeOutcome::Down(e),
    };
    if status == 401 {
        return ProbeOutcome::Unauthorized;
    }
    if envelope.get("type").and_then(Value::as_str) != Some("server-response") {
        return ProbeOutcome::Answered(format!("describe 响应格式不正确（HTTP {status}）"));
    }
    let result = envelope.get("result").cloned().unwrap_or(Value::Null);
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        return ProbeOutcome::Live(result.get("value").cloned().unwrap_or(Value::Null));
    }
    let message = result
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("未知错误");
    ProbeOutcome::Answered(format!("describe 被拒绝：{message}"))
}

/// What ensure does with the port, given the probe and whether the answering
/// side can be our own tracked child. Only our child is ever restarted:
/// anything else that answers is reported as occupied and left running.
#[derive(Debug, PartialEq)]
enum EnsureAction {
    Adopt,
    Spawn,
    RestartOwn,
    Occupied(String),
}

fn ensure_action(probe: &ProbeOutcome, ours: bool) -> EnsureAction {
    match probe {
        ProbeOutcome::Live(_) => EnsureAction::Adopt,
        _ if ours => EnsureAction::RestartOwn,
        ProbeOutcome::Down(_) => EnsureAction::Spawn,
        ProbeOutcome::Unauthorized => EnsureAction::Occupied("HTTP 401".to_string()),
        ProbeOutcome::Answered(detail) => EnsureAction::Occupied(detail.clone()),
    }
}

fn occupied_message(port: u16, detail: &str) -> String {
    format!(
        "端口 {port} 已被其他程序占用（{detail}）。CC GUI 只会结束自己启动的 dsh web，不会关闭其他程序；请先关闭占用该端口的程序，或在设置里改用其他端口。"
    )
}

/// Autostart only when the user can actually be running DSH from CC GUI:
/// the switch is on, the engine is enabled in CLI 管理 and a `dsh` binary
/// resolves. Otherwise the port is not touched at all — no probe, no spawn.
pub(crate) fn autostart_allowed(settings: &AppSettings) -> bool {
    should_autostart(
        settings.dsh_auto_start,
        crate::config::ensure_engine_enabled("dsh").is_ok(),
        dsh_installed(settings),
    )
}

fn should_autostart(switch: Option<bool>, engine_enabled: bool, installed: bool) -> bool {
    switch != Some(false) && engine_enabled && installed
}

fn dsh_installed(settings: &AppSettings) -> bool {
    let bin = dsh_bin(settings);
    let path = Path::new(&bin);
    path.is_absolute() && path.is_file()
}

/// 0.1.2 describe value → the flat `{provider, model}` view the settings
/// card renders: both live under
/// `namespaces[ns="agent-default-model"].value`.
fn normalize_describe(value: &Value) -> Value {
    let entry = value
        .get("namespaces")
        .and_then(Value::as_array)
        .and_then(|namespaces| {
            namespaces.iter().find(|entry| {
                entry.get("ns").and_then(Value::as_str) == Some("agent-default-model")
            })
        });
    let inner = entry.and_then(|entry| entry.get("value")).cloned();
    let mut view = Map::new();
    for key in ["provider", "model"] {
        if let Some(text) = inner
            .as_ref()
            .and_then(|inner| inner.get(key))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            view.insert(key.to_string(), Value::String(text.to_string()));
        }
    }
    Value::Object(view)
}

/// `dsh` binary: settings `dshBin` override (validated) else PATH resolution.
fn dsh_bin(settings: &AppSettings) -> String {
    if let Some(custom) = settings.bin_override("dsh") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            match crate::settings::validate_bin_override(trimmed) {
                Ok(path) => return resolve::resolve_launchable_cli_binary(&path.to_string_lossy()),
                Err(reason) => {
                    eprintln!("[dsh] ignoring invalid dsh bin override: {reason}");
                }
            }
        }
    }
    resolve::resolve_launchable_cli_binary("dsh")
}

/// Persistent stdout+stderr sink for one spawned host process, one file per
/// run so the last window before a host disappears survives the process. Writes
/// are best-effort: a logging failure must never break host management, so an
/// unopenable file only disables the sink.
struct HostLog {
    path: PathBuf,
    file: Mutex<Option<File>>,
    /// Bytes written to `path`. Every access happens while `file`'s lock is
    /// held — that is what makes the over-budget check and the rotation atomic
    /// with respect to a second drain. Keep both inside the lock; `Relaxed` is
    /// sufficient only because the lock serializes all of them.
    written: AtomicU64,
}

impl HostLog {
    /// Log path for a run spawned at `now`, or `None` when the clock predates
    /// the epoch (in which case the spawn path skips the sink entirely).
    fn path_for(home: &Path, now: SystemTime) -> Option<PathBuf> {
        let epoch = now.duration_since(UNIX_EPOCH).ok()?.as_secs();
        Some(home.join(LOG_DIR).join(run_log_name(epoch)))
    }

    /// Open the sink at `path`, creating the directory on the way. Existing
    /// files of the same name (same-second respawn) are appended to.
    fn open(path: PathBuf) -> Arc<Self> {
        let file = path
            .parent()
            .map(std::fs::create_dir_all)
            .transpose()
            .ok()
            .flatten()
            .and_then(|()| {
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)
                    .ok()
            });
        if file.is_none() {
            eprintln!("[dsh] host log disabled (cannot open {})", path.display());
        }
        let written = file
            .as_ref()
            .and_then(|file| file.metadata().ok())
            .map(|meta| meta.len())
            .unwrap_or(0);
        Arc::new(Self {
            path,
            file: Mutex::new(file),
            written: AtomicU64::new(written),
        })
    }

    /// Open the sink for a run spawned now, or `None` when it cannot be named.
    fn for_new_run() -> Option<Arc<Self>> {
        Self::for_new_run_at(&crate::paths::app_home(), SystemTime::now())
    }

    /// `for_new_run` with an injectable home and clock (tests drive a temp one).
    ///
    /// Pruning runs before the file is created, so it can never look at the run
    /// it is about to start — nor at a file a backwards clock would judge oldest
    /// and delete while we are writing into it.
    ///
    /// Boundary this does not cover: two respawns inside the same second share
    /// one file name, so two sinks with two separate locks can still rotate over
    /// each other. `ensure` is serialized and the 401 retry path waits 600 ms, so
    /// it stays a boundary rather than something worth a process-wide registry.
    fn for_new_run_at(home: &Path, now: SystemTime) -> Option<Arc<Self>> {
        let path = Self::path_for(home, now)?;
        if let Some(dir) = path.parent() {
            Self::prune_old_runs(dir, LOG_KEEP_RUNS);
        }
        Some(Self::open(path))
    }

    /// Remove all but the newest `keep` run logs in `dir`, `.1` rotations with
    /// them. Ordered by the epoch in the file name, not mtime: appends move
    /// mtime and any copy or restore rewrites it, while the name records the
    /// spawn this file exists for. Failures are ignored — a log we cannot delete
    /// (a viewer holding it open on Windows) must never fail a spawn.
    ///
    /// A run started before a clock jump backwards can be judged oldest and
    /// deleted while it is still writing. On Windows the open handle usually
    /// makes that delete fail silently, and the cost is bounded either way: the
    /// sink stays usable and the file is retried on the next spawn.
    fn prune_old_runs(dir: &Path, keep: usize) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return; // no directory yet (first run) or unreadable: nothing to prune
        };
        let mut runs: Vec<(u64, PathBuf)> = entries
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                Some((run_log_epoch(entry.file_name().to_str()?)?, path))
            })
            .collect();
        runs.sort_unstable_by(|a, b| b.0.cmp(&a.0)); // newest first
        for (_, path) in runs.into_iter().skip(keep) {
            // A dropped run's rotated sibling belongs to it; a kept run's stays.
            let _ = std::fs::remove_file(rotated_path(&path));
            let _ = std::fs::remove_file(&path);
        }
    }

    /// Append one drained line, rotating first when the file is over budget.
    fn line(&self, line: &str) {
        self.line_capped(line, LOG_MAX_BYTES);
    }

    /// `line` with an explicit rotation budget (tests drive a small one).
    ///
    /// The over-budget check sits **inside** the write lock: stdout and stderr
    /// drain through two independent tasks into this one sink, so a check taken
    /// outside the lock let both rotate — the second archived the fresh empty
    /// file over `.1`, and the retained window (the only trace a killed host
    /// leaves) was gone. Deciding and rotating under one lock makes every
    /// rotation cost exactly one written window.
    fn line_capped(&self, line: &str, max_bytes: u64) {
        let mut guard = lock(&self.file);
        if self.written.load(Ordering::Relaxed) > max_bytes {
            self.rotate_locked(&mut guard);
        }
        let Some(file) = guard.as_mut() else {
            return;
        };
        if file.write_all(line.as_bytes()).is_err() || file.flush().is_err() {
            // A full or removed volume disables the sink rather than retrying
            // every line for the lifetime of the host.
            eprintln!("[dsh] host log write failed; sink disabled");
            *guard = None;
            return;
        }
        self.written
            .fetch_add(line.len() as u64, Ordering::Relaxed);
    }

    /// Move the current file aside as `<path>.1` (replacing the previous
    /// rotation) and continue in a fresh one. The caller already holds the write
    /// lock — that is what stops a second drain from rotating the file this one
    /// just created.
    fn rotate_locked(&self, guard: &mut Option<File>) {
        *guard = None;
        let _ = std::fs::rename(&self.path, rotated_path(&self.path));
        *guard = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .ok();
        self.written.store(0, Ordering::Relaxed);
    }
}

/// `<file>.1`: where a rotation parks the previous window. Rotation and pruning
/// share it, so changing the name shape cannot leave rotated copies behind.
fn rotated_path(path: &Path) -> PathBuf {
    path.with_extension(format!(
        "{}{LOG_KEEP_SUFFIX}",
        path.extension().and_then(|ext| ext.to_str()).unwrap_or("log")
    ))
}

/// Run-log file name (`dsh-host-<epoch>.log`) and the parse back to its spawn
/// epoch: naming and pruning share one judgement so they cannot drift apart.
fn run_log_name(epoch: u64) -> String {
    format!("dsh-host-{epoch}.log")
}

fn run_log_epoch(name: &str) -> Option<u64> {
    name.strip_prefix("dsh-host-")?
        .strip_suffix(".log")?
        .parse()
        .ok()
}

/// 一行 host 输出在落盘前是否要脱敏：启动令牌行换成固定标记。识别器复用
/// `extract_launch_token`（同一份判据），不新增解析规则——令牌能换取 host 的
/// auth cookie，而内存 ring 随进程消失，落盘会让凭据留在磁盘上。
fn loggable_line(line: &str) -> &str {
    if extract_launch_token(line).is_some() {
        "=== [redacted] launch token line ===\n"
    } else {
        line
    }
}

/// Drain a long-lived child's stream into the last-RING_CAP-bytes ring,
/// feeding each line to the launch-token capture when one is attached and to
/// the per-run log file when one could be opened.
fn spawn_ring_drain<R: AsyncRead + Unpin + Send + 'static>(
    pipe: R,
    buf: Arc<Mutex<String>>,
    capture: Option<Arc<TokenCapture>>,
    log: Option<Arc<HostLog>>,
) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(pipe);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if let Some(log) = &log {
                        log.line(loggable_line(&line));
                    }
                    {
                        let mut guard = lock(&buf);
                        guard.push_str(&line);
                        if guard.len() > RING_CAP {
                            let mut start = guard.len() - RING_CAP;
                            while !guard.is_char_boundary(start) {
                                start += 1;
                            }
                            guard.drain(..start);
                        }
                    }
                    if let Some(capture) = &capture {
                        capture.capture(&line).await;
                    }
                }
            }
        }
    });
}

fn ring_snapshot(buf: &Mutex<String>) -> String {
    lock(buf).trim().to_string()
}

// ==================== ensure (adopt-or-spawn) ====================

/// Adopt a host that already answers, restart our own child when it stopped
/// answering, otherwise spawn `dsh web` and wait for readiness. Anything else
/// holding the port is reported, never killed. Used by dsh_host_start, chat
/// turns and the gated setup autostart.
pub(crate) async fn ensure_host(
    host_state: &DshHostState,
    settings: &AppSettings,
) -> Result<(), String> {
    let _serialize = host_state.ensure.lock().await;
    let cfg = HostConfig::from(settings);

    host_state.reap_exited();
    let ours = host_state.spawned_origin().as_deref() == Some(cfg.origin.as_str());
    match ensure_action(&probe_describe(&cfg.origin).await, ours) {
        EnsureAction::Adopt => return Ok(()),
        EnsureAction::Occupied(detail) => return Err(occupied_message(cfg.port, &detail)),
        EnsureAction::RestartOwn => {
            host_state.kill_spawned();
            sleep(Duration::from_millis(600)).await;
        }
        EnsureAction::Spawn => {}
    }

    let bin = dsh_bin(settings);
    let mut command = command_for_binary(&bin);
    command
        .arg("web")
        .arg("--host")
        .arg(&cfg.host)
        .arg("--port")
        .arg(cfg.port.to_string())
        // The GUI talks to the host over HTTP itself; opening a browser tab
        // on every app launch is pure noise.
        .arg("--no-open");
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    crate::engine::hide_console(&mut command);
    let mut child = command.spawn().map_err(|e| {
        format!("无法启动 dsh web（{bin}）：{e}。请确认已安装 @deepseek-ai/dsh，或检查自定义路径。")
    })?;
    // The readiness probes below need our cookie; any early return withdraws
    // the trust again, success hands it to the tracked child.
    let trust = PendingTrust::grant(&cfg.origin);
    // Kill-on-close job (Windows): same orphan class as engine runs — host
    // sessions' grandchildren escape every tree walk once their parent exits.
    #[cfg(windows)]
    let tree_guard = crate::engine::job::assign_kill_on_close(&child);
    let output = Arc::new(Mutex::new(String::new()));
    let capture = Arc::new(TokenCapture {
        origin: cfg.origin.clone(),
        token: Mutex::new(None),
        busy: AtomicBool::new(false),
    });
    // One log file per spawned process: a host killed mid-turn leaves the
    // in-memory ring empty, so the reason has to be on disk before it dies.
    let log = HostLog::for_new_run();
    if let Some(log) = &log {
        log.line(&format!(
            "=== dsh web spawn: origin={} bin={} pid={} ===\n",
            cfg.origin,
            bin,
            child.id().unwrap_or(0)
        ));
    }
    if let Some(stdout) = child.stdout.take() {
        spawn_ring_drain(
            stdout,
            Arc::clone(&output),
            Some(Arc::clone(&capture)),
            log.clone(),
        );
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_ring_drain(
            stderr,
            Arc::clone(&output),
            Some(Arc::clone(&capture)),
            log.clone(),
        );
    }
    // Reported on spawn failure so the log can be found without guessing.
    let log_path = log.as_ref().map(|log| log.path.clone());

    let deadline = Instant::now() + SPAWN_READY_TIMEOUT;
    let mut last_unauthorized = false;
    let mut next_reexchange = Instant::now();
    loop {
        let probe = probe_describe(&cfg.origin).await;
        if probe.is_live() {
            *lock(&host_state.spawned) = Some(Spawned {
                child,
                origin: cfg.origin.clone(),
                #[cfg(windows)]
                _tree_guard: tree_guard,
            });
            trust.keep();
            return Ok(());
        }
        // 401 with the token already seen: the one-shot capture may have
        // raced the listener — keep re-exchanging until the deadline.
        if matches!(probe, ProbeOutcome::Unauthorized) {
            last_unauthorized = true;
            if Instant::now() >= next_reexchange {
                next_reexchange = Instant::now() + TOKEN_REEXCHANGE_INTERVAL;
                capture.reexchange_stored().await;
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                // Spawn race: our child died but another host now answers.
                // It is not ours, so it never gets our cookie: adopt it only
                // when it answers without one.
                trust.withdraw();
                if probe_describe(&cfg.origin).await.is_live() {
                    return Ok(());
                }
                let tail = ring_snapshot(&output);
                return Err(format!(
                    "dsh web 启动后立即退出（{status}）。{}{}",
                    if tail.is_empty() {
                        "无输出。".to_string()
                    } else {
                        format!("输出：{tail}")
                    },
                    match &log_path {
                        Some(path) => format!("（完整输出见 {}）", path.display()),
                        None => String::new(),
                    }
                ));
            }
            Ok(None) => {}
            Err(e) => {
                let _ = child.start_kill();
                return Err(format!("dsh web 状态检查失败：{e}"));
            }
        }
        if Instant::now() >= deadline {
            // Our child never became ready: stop it first, then see whether
            // some other host took the port meanwhile (adopted only when it
            // answers without our cookie).
            let _ = child.start_kill();
            trust.withdraw();
            if probe_describe(&cfg.origin).await.is_live() {
                return Ok(());
            }
            let tail = ring_snapshot(&output);
            if last_unauthorized {
                return Err(format!(
                    "dsh host 已在 {} 应答但凭据未被接受（401），等待 {} 秒未就绪。{}",
                    cfg.origin,
                    SPAWN_READY_TIMEOUT.as_secs(),
                    if tail.is_empty() {
                        "输出里未见 launch token。".to_string()
                    } else {
                        format!("输出：{tail}")
                    }
                ));
            }
            return Err(format!(
                "等待 dsh host 就绪超时（{} 秒，{}）。{}",
                SPAWN_READY_TIMEOUT.as_secs(),
                cfg.origin,
                if tail.is_empty() {
                    String::new()
                } else {
                    format!("输出：{tail}")
                }
            ));
        }
        sleep(SPAWN_POLL_INTERVAL).await;
    }
}

async fn status_snapshot(host_state: &DshHostState, settings: &AppSettings) -> DshHostStatus {
    let cfg = HostConfig::from(settings);
    let bin = dsh_bin(settings);
    let (cli, probe) = tokio::join!(
        crate::cli_lifecycle::probe_local_version(&bin),
        probe_describe(&cfg.origin)
    );
    let running = probe.is_live();
    let ownership = if running {
        Some(
            if host_state.spawned_origin().as_deref() == Some(cfg.origin.as_str()) {
                "spawned"
            } else {
                "adopted"
            },
        )
    } else {
        None
    };
    let ours = host_state.spawned_origin().as_deref() == Some(cfg.origin.as_str());
    let (describe, error) = match probe {
        ProbeOutcome::Live(value) => (Some(normalize_describe(&value)), None),
        // Our own child lost its credentials: 立即启动 restarts it.
        ProbeOutcome::Unauthorized if ours => (
            None,
            Some(
                "host 已运行但凭据无效（401）。点「立即启动」重新拉起，凭据会随之更新。"
                    .to_string(),
            ),
        ),
        ProbeOutcome::Unauthorized => (None, Some(occupied_message(cfg.port, "HTTP 401"))),
        ProbeOutcome::Answered(detail) => (None, Some(occupied_message(cfg.port, &detail))),
        ProbeOutcome::Down(error) => (None, Some(error)),
    };
    let web_url = compose_web_url(
        &cfg.origin,
        origin_trusted(&cfg.origin),
        load_credentials(&cfg.origin),
    );
    DshHostStatus {
        installed: cli.installed,
        version: cli.version,
        host: cfg.host,
        port: cfg.port,
        origin: cfg.origin.clone(),
        auto_start: cfg.auto_start,
        running,
        ownership,
        describe,
        web_url,
        error,
    }
}

/// The "open in browser" link carries the launch token, which the host trades
/// for its auth cookie: only offer it for the `dsh web` this run spawned
/// (same rule as the cookie), never for whatever else answers on the port.
fn compose_web_url(
    origin: &str,
    trusted: bool,
    credentials: Option<HostCredentials>,
) -> Option<String> {
    if !trusted {
        return None;
    }
    credentials.map(|credentials| format!("{origin}/?token={}", credentials.launch_token))
}

// ==================== Commands ====================

#[tauri::command]
pub async fn dsh_host_status(
    state: tauri::State<'_, crate::AppState>,
) -> Result<DshHostStatus, String> {
    let settings = crate::settings::read_settings().unwrap_or_default();
    Ok(status_snapshot(&state.dsh_host, &settings).await)
}

#[tauri::command]
pub async fn dsh_host_start(
    state: tauri::State<'_, crate::AppState>,
) -> Result<DshHostStatus, String> {
    let settings = crate::settings::read_settings().unwrap_or_default();
    ensure_host(&state.dsh_host, &settings).await?;
    Ok(status_snapshot(&state.dsh_host, &settings).await)
}

#[tauri::command]
pub async fn dsh_host_stop(state: tauri::State<'_, crate::AppState>) -> Result<OkResult, String> {
    let settings = crate::settings::read_settings().unwrap_or_default();
    let cfg = HostConfig::from(&settings);
    // Only our own child is ever stopped. Whatever else answers on the port
    // (a host the user started, another app) is reported, never killed.
    let had_child = state.dsh_host.kill_spawned();
    for _ in 0..STOP_SETTLE_ATTEMPTS {
        if matches!(probe_describe(&cfg.origin).await, ProbeOutcome::Down(_)) {
            return Ok(OkResult { ok: true });
        }
        sleep(STOP_SETTLE_INTERVAL).await;
    }
    Err(if had_child {
        format!(
            "已结束 CC GUI 启动的 dsh web，但端口 {} 仍有程序在应答。CC GUI 不会结束不是它启动的进程，请手动关闭占用该端口的程序。",
            cfg.port
        )
    } else {
        format!(
            "端口 {} 上的 DSH host 不是由 CC GUI 启动的，CC GUI 不会结束它。请在启动它的终端或程序里关闭。",
            cfg.port
        )
    })
}

/// After killing our child, how long stop waits for its port to go quiet
/// before reporting that something else still answers there.
const STOP_SETTLE_ATTEMPTS: usize = 8;
const STOP_SETTLE_INTERVAL: Duration = Duration::from_millis(250);

// ==================== Locality ====================

fn is_local_host(host: &str) -> bool {
    matches!(
        host.trim().to_ascii_lowercase().as_str(),
        "127.0.0.1" | "localhost" | "::1" | "0.0.0.0" | "[::1]" | "[::]"
    )
}

/// True when a configured `http(s)://host[:port]` origin points at this
/// machine (see [`is_local_host`]).
fn origin_is_local(origin: &str) -> bool {
    let lowered = origin.trim().to_ascii_lowercase();
    let authority = lowered
        .strip_prefix("http://")
        .or_else(|| lowered.strip_prefix("https://"))
        .unwrap_or(lowered.as_str());
    let authority = authority.split(['/', '?', '#']).next().unwrap_or("");
    // Stripping `:port` must leave `[::1]` intact when no port is present.
    let host = match authority.rsplit_once(':') {
        Some((head, tail)) if !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit()) => head,
        _ => authority,
    };
    is_local_host(host)
}

#[cfg(test)]
mod tests {
    #[test]
    fn web_url_with_the_launch_token_is_only_offered_for_our_own_host() {
        let credentials = || {
            Some(super::HostCredentials {
                cookie: "c".into(),
                launch_token: "tok".into(),
            })
        };
        let origin = "http://127.0.0.1:3080";
        assert_eq!(
            super::compose_web_url(origin, true, credentials()).as_deref(),
            Some("http://127.0.0.1:3080/?token=tok")
        );
        // Something else on the port must never be handed the token.
        assert_eq!(super::compose_web_url(origin, false, credentials()), None);
        assert_eq!(super::compose_web_url(origin, true, None), None);
    }

    use super::*;
    use serde_json::json;

    #[test]
    fn autostart_needs_the_switch_the_enabled_engine_and_a_binary() {
        assert!(should_autostart(None, true, true));
        assert!(should_autostart(Some(true), true, true));
        assert!(!should_autostart(Some(false), true, true), "switch off");
        assert!(!should_autostart(None, false, true), "engine disabled in CLI 管理");
        assert!(!should_autostart(None, true, false), "dsh not installed");
    }

    #[test]
    fn only_our_own_child_is_ever_restarted() {
        let live = ProbeOutcome::Live(json!({}));
        assert_eq!(ensure_action(&live, false), EnsureAction::Adopt);
        assert_eq!(ensure_action(&live, true), EnsureAction::Adopt);
        // Nothing listening: spawn, or replace our own hung child.
        let down = ProbeOutcome::Down("refused".into());
        assert_eq!(ensure_action(&down, false), EnsureAction::Spawn);
        assert_eq!(ensure_action(&down, true), EnsureAction::RestartOwn);
        // Something else answers (401, or not a DSH at all): never ours to
        // kill — report the port as occupied.
        for answered in [
            ProbeOutcome::Unauthorized,
            ProbeOutcome::Answered("HTTP 404".into()),
        ] {
            assert!(matches!(
                ensure_action(&answered, false),
                EnsureAction::Occupied(_)
            ));
            assert_eq!(ensure_action(&answered, true), EnsureAction::RestartOwn);
        }
    }

    /// Scratch HOME so stored credentials land in a temp app home.
    struct ScratchHome {
        dir: PathBuf,
        previous: Option<std::ffi::OsString>,
        _lock: parking_lot::MutexGuard<'static, ()>,
    }

    impl ScratchHome {
        fn new() -> Self {
            let lock = crate::paths::HOME_ENV_LOCK.lock();
            let dir = std::env::temp_dir().join(format!("ccgui-dsh-home-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(dir.join(".ccgui-next")).unwrap();
            let previous = std::env::var_os("HOME");
            std::env::set_var("HOME", &dir);
            Self {
                dir,
                previous,
                _lock: lock,
            }
        }
    }

    impl Drop for ScratchHome {
        fn drop(&mut self) {
            match &self.previous {
                Some(home) => std::env::set_var("HOME", home),
                None => std::env::remove_var("HOME"),
            }
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    /// Another program on the DSH port (401 for everyone): ensure must report
    /// the port as occupied, leave the program running, and never hand it the
    /// stored BrowserAuth cookie.
    #[tokio::test]
    async fn foreign_listener_is_reported_untouched_and_never_sees_the_cookie() {
        use std::sync::atomic::AtomicUsize;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let _home = ScratchHome::new();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let hits = Arc::new(AtomicUsize::new(0));
        let saw_cookie = Arc::new(AtomicBool::new(false));
        let (server_hits, server_cookie) = (Arc::clone(&hits), Arc::clone(&saw_cookie));
        let server = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else { return };
                let mut buf = vec![0u8; 8192];
                let n = socket.read(&mut buf).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_ascii_lowercase();
                server_hits.fetch_add(1, Ordering::SeqCst);
                if request.contains("\r\ncookie:") {
                    server_cookie.store(true, Ordering::SeqCst);
                }
                let _ = socket
                    .write_all(b"HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
                    .await;
            }
        });

        let origin = format!("http://127.0.0.1:{port}");
        store_credentials(
            &origin,
            HostCredentials {
                cookie: "dsh-auth-secret=1".into(),
                launch_token: "token".into(),
            },
        );
        assert!(load_credentials(&origin).is_some(), "credentials staged");
        let settings = AppSettings {
            dsh_host: Some("127.0.0.1".into()),
            dsh_port: Some(port),
            ..AppSettings::default()
        };
        let state = DshHostState::default();

        let error = ensure_host(&state, &settings).await.unwrap_err();
        assert!(error.contains("占用"), "{error}");
        assert!(hits.load(Ordering::SeqCst) > 0, "the port was probed");
        assert!(!saw_cookie.load(Ordering::SeqCst), "cookie leaked to a foreign listener");
        assert!(
            tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok(),
            "the foreign listener must keep running"
        );
        assert!(lock(&state.spawned).is_none(), "nothing was spawned");
        server.abort();
    }

    /// The per-run log name must sort by spawn time and stay inside the app
    /// home, so the surviving file of a killed host is findable by name.
    #[test]
    fn host_log_path_is_stamped_under_the_app_home() {
        let home = Path::new("C:\\home\\.ccgui-next");
        let path = HostLog::path_for(home, UNIX_EPOCH + Duration::from_secs(1_791_979_847))
            .expect("a post-epoch clock names a log");
        assert_eq!(
            path,
            home.join("dsh-host-logs").join("dsh-host-1791979847.log")
        );
        assert!(HostLog::path_for(home, UNIX_EPOCH - Duration::from_secs(1)).is_none());
    }

    /// Lines reach the file (flushed per line: a host killed right after
    /// writing must not lose its last words), and the budget rotates instead
    /// of growing without bound.
    #[test]
    fn host_log_appends_lines_and_rotates_over_budget() {
        let home = std::env::temp_dir().join(format!(
            "ccgui-next-host-log-test-{}",
            uuid::Uuid::new_v4()
        ));
        // One instant for both the name and the assertion: two `now()` calls
        // can straddle a second boundary and name different files.
        let now = SystemTime::now();
        let path = HostLog::path_for(&home, now).unwrap();
        let log = HostLog::open(path.clone());
        log.line_capped("first line\n", 32);
        log.line_capped("second line\n", 32);
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "first line\nsecond line\n"
        );
        // Over budget: the current file moves to `.1` and a fresh one starts.
        log.line_capped("third line that is long enough\n", 8);
        assert_eq!(
            std::fs::read_to_string(path.with_extension("log.1")).unwrap(),
            "first line\nsecond line\n"
        );
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "third line that is long enough\n"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// stdout 与 stderr 各跑一个 drain 任务（Tauri 的 tokio 是多线程 runtime，两者
    /// 真并发），而超预算判断原先在锁外：两个 drain 会各自认定「该轮转」，第二次轮转
    /// 把刚建好、几乎为空的文件改名覆盖 `.1`——正好毁掉这份日志唯一要留的「死前
    /// 窗口」。这里由测试线程先持锁，把交错逼到近似确定：两个线程都先穿过判断、再卡在
    /// 锁上（200ms 等待窗），解锁后旧实现几乎必然各轮转一次（修复后只会轮转一次）；
    /// 调度极不配合时旧实现可能侥幸通过，但修复后的实现在任何调度下都通过。
    #[test]
    fn host_log_rotates_once_when_two_drains_hit_the_budget() {
        let home = std::env::temp_dir().join(format!(
            "ccgui-next-host-log-race-{}",
            uuid::Uuid::new_v4()
        ));
        let path = HostLog::path_for(&home, SystemTime::now()).unwrap();
        let log = HostLog::open(path.clone());
        // Two lines take the file over the 16-byte budget.
        log.line_capped("first line\n", 16);
        log.line_capped("second line\n", 16);
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "first line\nsecond line\n"
        );

        let held = lock(&log.file);
        let entered = Arc::new(AtomicU64::new(0));
        let mut drains = Vec::new();
        for line in ["from stdout\n", "from stderr\n"] {
            let log = Arc::clone(&log);
            let entered = Arc::clone(&entered);
            drains.push(std::thread::spawn(move || {
                entered.fetch_add(1, Ordering::Relaxed);
                log.line_capped(line, 16);
            }));
        }
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while entered.load(Ordering::Relaxed) < 2 && std::time::Instant::now() < deadline {
            std::thread::yield_now();
        }
        std::thread::sleep(Duration::from_millis(200)); // let both park on the lock
        drop(held);
        for drain in drains {
            drain.join().unwrap();
        }

        // The window from before the budget was hit must survive as `.1`, and
        // both drains' lines must land in the fresh file.
        assert_eq!(
            std::fs::read_to_string(path.with_extension("log.1")).unwrap(),
            "first line\nsecond line\n"
        );
        let fresh = std::fs::read_to_string(&path).unwrap();
        assert!(fresh.contains("from stdout\n"), "{fresh}");
        assert!(fresh.contains("from stderr\n"), "{fresh}");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// 一次 spawn 一份日志、只轮转不回收：崩溃重启循环会把 dsh-host-logs 一直撑大。
    /// 按文件名里的 epoch（不是 mtime）保留最近 LOG_KEEP_RUNS 份，被淘汰那份的 `.1`
    /// 一起删，当前这轮与解析不出 epoch 的文件都不碰。
    #[test]
    fn host_log_prunes_older_runs_beyond_the_keep_count() {
        let home = std::env::temp_dir().join(format!(
            "ccgui-next-host-log-prune-{}",
            uuid::Uuid::new_v4()
        ));
        let dir = home.join(LOG_DIR);
        std::fs::create_dir_all(&dir).unwrap();
        let epochs: Vec<u64> = (0..LOG_KEEP_RUNS as u64 + 2)
            .map(|index| 1_791_979_000 + index)
            .collect();
        for epoch in &epochs {
            std::fs::write(dir.join(run_log_name(*epoch)), "line\n").unwrap();
        }
        // Rotations: the dropped run's `.1` goes with it, a kept run's stays.
        let oldest_rotation = dir.join(format!("{}{LOG_KEEP_SUFFIX}", run_log_name(epochs[0])));
        let newest_rotation = dir.join(format!(
            "{}{LOG_KEEP_SUFFIX}",
            run_log_name(epochs[epochs.len() - 1])
        ));
        std::fs::write(&oldest_rotation, "rotated\n").unwrap();
        std::fs::write(&newest_rotation, "rotated\n").unwrap();
        let stranger = dir.join("notes.txt");
        std::fs::write(&stranger, "keep me\n").unwrap();

        let now = UNIX_EPOCH + Duration::from_secs(1_791_979_847);
        let current = HostLog::for_new_run_at(&home, now).unwrap();

        assert!(current.path.exists());
        // The two oldest runs go; the third-oldest survives with its rotation.
        assert!(!dir.join(run_log_name(epochs[0])).exists());
        assert!(!oldest_rotation.exists());
        assert!(dir.join(run_log_name(epochs[2])).exists());
        assert!(newest_rotation.exists());
        assert!(stranger.exists());
        let runs = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|entry| run_log_epoch(&entry.file_name().to_string_lossy()).is_some())
            .count();
        assert_eq!(runs, LOG_KEEP_RUNS + 1); // keep + the run we just started
        let _ = std::fs::remove_dir_all(&home);
    }

    /// 首次运行（日志目录还不存在）不能因为「没有目录可清理」而出错：prune 早退，
    /// 建目录由 open 负责。
    #[test]
    fn first_run_without_a_log_directory_still_opens_the_sink() {
        let home = std::env::temp_dir().join(format!(
            "ccgui-next-host-log-first-{}",
            uuid::Uuid::new_v4()
        ));
        assert!(!home.join(LOG_DIR).exists(), "前提：目录还不存在");
        let now = SystemTime::now();
        let log = HostLog::for_new_run_at(&home, now).unwrap();
        log.line("first words\n");
        assert_eq!(std::fs::read_to_string(&log.path).unwrap(), "first words\n");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// 启动令牌能换取 host 的 auth cookie，因此**绝不能**进磁盘日志——这条是
    /// 发货不变量，不是可选优化（AGENTS.md：日志不输出凭据）。host 打印的形状
    /// 是 `dsh web: http://…/?token=<URL-safe>`。
    #[test]
    fn host_log_redacts_the_launch_token_line() {
        let token_line = "dsh web: http://127.0.0.1:3080/?token=AbC-123_xyz\n";
        assert_eq!(
            loggable_line(token_line),
            "=== [redacted] launch token line ===\n"
        );
        // 普通行原样保留，脱敏不能顺手吃掉诊断信息。
        let plain = "ready on http://127.0.0.1:3080\n";
        assert_eq!(loggable_line(plain), plain);
        // 只是提到 token 字样（不是查询参数）不算令牌，不该被替换。
        let mentions = "GET /?notoken=1&tokenish=2\n";
        assert_eq!(loggable_line(mentions), mentions);
    }

    /// 真实 drain 路径的唯一端到端断言：ring 必须留下启动令牌（就绪循环要从内存
    /// 里再取一次），而磁盘日志必须一个字节都拿不到它——宿主被中途杀掉时，日志
    /// 是唯一幸存的产物，它得能直接交给别人看。
    #[tokio::test]
    async fn ring_drain_keeps_the_token_in_memory_and_out_of_the_log() {
        use tokio::io::AsyncWriteExt;

        let home = std::env::temp_dir().join(format!(
            "ccgui-next-host-log-drain-{}",
            uuid::Uuid::new_v4()
        ));
        let path = HostLog::path_for(&home, SystemTime::now()).unwrap();
        let log = HostLog::open(path.clone());
        let buf = Arc::new(Mutex::new(String::new()));

        let (mut writer, reader) = tokio::io::duplex(4096);
        spawn_ring_drain(reader, buf.clone(), None, Some(log));
        writer
            .write_all(b"dsh web: http://127.0.0.1:3080/?token=AbC-123_xyz\n")
            .await
            .unwrap();
        writer
            .write_all(b"ready on http://127.0.0.1:3080\n")
            .await
            .unwrap();
        drop(writer); // EOF ends the drain loop.

        // Wait for the drain task to see EOF and flush the second line.
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut logged = String::new();
        loop {
            logged = std::fs::read_to_string(&path).unwrap_or_default();
            if logged.contains("ready on") || Instant::now() > deadline {
                break;
            }
            sleep(Duration::from_millis(10)).await;
        }

        let ring = ring_snapshot(&buf);
        assert!(ring.contains("token=AbC-123_xyz"), "{ring}");
        assert!(ring.contains("ready on"), "{ring}");
        assert!(logged.contains("ready on"), "{logged}");
        assert!(logged.contains("[redacted] launch token line"), "{logged}");
        assert!(!logged.contains("AbC-123_xyz"), "{logged}");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn origin_locality_is_detected_from_the_configured_origin() {
        for origin in [
            "http://127.0.0.1:3080",
            "http://localhost:3080",
            "http://0.0.0.0:3080",
            "http://[::1]:3080",
            "http://[::1]",
            "http://127.0.0.1",
            "https://LOCALHOST:3080",
            "http://127.0.0.1:3080/",
        ] {
            assert!(origin_is_local(origin), "{origin}");
        }
        for origin in [
            "https://dsh.example.com:3080",
            "http://192.168.1.10:3080",
            "http://[2001:db8::1]:3080",
        ] {
            assert!(!origin_is_local(origin), "{origin}");
        }
    }

    #[test]
    fn launch_token_is_extracted_from_web_url_line() {
        let line =
            "dsh web: http://127.0.0.1:3080/?token=RmF6KLIdrmQlbogo4A_StSQsyzSCzn79Et8S0CVjpUE";
        assert_eq!(
            extract_launch_token(line).as_deref(),
            Some("RmF6KLIdrmQlbogo4A_StSQsyzSCzn79Et8S0CVjpUE")
        );
    }

    #[test]
    fn launch_token_needs_query_prefix_and_stops_at_delimiter() {
        assert!(extract_launch_token("no token here").is_none());
        // "dsh web: …" without a query prefix is not a token occurrence.
        assert!(extract_launch_token("dsh web: http://127.0.0.1:3080/token=x").is_none());
        assert_eq!(
            extract_launch_token("GET /?token=abc-DEF_123 trailing").as_deref(),
            Some("abc-DEF_123")
        );
    }

    #[test]
    fn describe_namespace_is_normalized_to_flat_view() {
        let value = json!({
            "namespaces": [
                {"ns": "other", "value": {"provider": "x", "model": "y"}},
                {"ns": "agent-default-model", "value": {"provider": "deepseek", "model": "deepseek-chat"}},
            ]
        });
        assert_eq!(
            normalize_describe(&value),
            json!({"provider": "deepseek", "model": "deepseek-chat"})
        );
        assert_eq!(normalize_describe(&json!({})), json!({}));
    }
}
