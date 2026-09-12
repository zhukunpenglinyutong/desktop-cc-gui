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
//! cookie per-origin in `~/.ccgui-next/dsh-host-credentials.json`. A host
//! that answers with 401 is alive but credential-locked: local listeners are
//! stopped so we can respawn with our own token chain (credentials are ours
//! to manage), remote origins can't be adopted.
//!
//! Ownership rule: only hosts we spawned are tracked in [`DshHostState`] and
//! killed (app exit / dsh_host_stop). A pre-existing host answering describe
//! is adopted and never killed — except via dsh_host_stop's local-listener
//! termination, which only ever targets loopback addresses.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

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
}

impl Drop for Spawned {
    fn drop(&mut self) {
        if let Some(pid) = self.child.id() {
            crate::engine::kill_process_group(pid);
        }
        let _ = self.child.start_kill();
    }
}

impl DshHostState {
    /// Kill only the host child we spawned (window Destroyed). Adopted hosts
    /// are never tracked, so they survive us by construction.
    pub fn kill_spawned(&self) {
        let mut guard = lock(&self.spawned);
        // Drop of Spawned kills the process group.
        guard.take();
    }

    fn spawned_origin(&self) -> Option<String> {
        lock(&self.spawned)
            .as_ref()
            .map(|spawned| spawned.origin.clone())
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
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

fn http_client() -> &'static reqwest::Client {
    static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
        reqwest::Client::builder()
            .connect_timeout(DESCRIBE_CONNECT_TIMEOUT)
            .timeout(DESCRIBE_TOTAL_TIMEOUT)
            .build()
            .expect("reqwest client")
    });
    &CLIENT
}

/// Redirect-disabling client for the token exchange: the host answers
/// `GET /?token=…` with 303 + set-cookie, and following the redirect would
/// drop the header we need.
fn exchange_client() -> &'static reqwest::Client {
    static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
        reqwest::Client::builder()
            .connect_timeout(DESCRIBE_CONNECT_TIMEOUT)
            .timeout(DESCRIBE_TOTAL_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("reqwest client")
    });
    &CLIENT
}

/// Token → cookie: `GET {origin}/?token=…` without redirects; 303 +
/// set-cookie yields the `name=value` pair (first attribute, before `;`).
async fn exchange_token(origin: &str, token: &str) -> Option<String> {
    let response = exchange_client()
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
    load_credentials(origin).map(|credentials| credentials.cookie)
}

/// One HTTP round-trip: `POST {origin}/api/{method}` with the client-request
/// envelope (0.1.2 wraps call args in `payload.args`) and the stored auth
/// cookie, returning `(HTTP status, parsed envelope)`. Transport failures map
/// to Err; a non-JSON body yields `Value::Null` with its status intact so
/// callers can classify auth failures.
async fn host_post(origin: &str, method: &str, args: Value) -> Result<(u16, Value), String> {
    let mut request = http_client()
        .post(format!("{origin}/api/{method}"))
        .header(reqwest::header::CONTENT_TYPE, "application/json");
    if let Some(cookie) = load_credentials(origin).map(|c| c.cookie) {
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
    let (status, envelope) = host_post(origin, method, args).await?;
    if status == 401 {
        return Err(format!(
            "{method} 未授权（401）：host 凭据缺失或已失效，请在设置里重新启动 DSH host。"
        ));
    }
    if envelope.get("type").and_then(Value::as_str) != Some("server-response") {
        return Err(format!("{method} 响应格式不正确（非 server-response）"));
    }
    let result = envelope.get("result").cloned().unwrap_or(Value::Null);
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(result.get("value").cloned().unwrap_or(Value::Null));
    }
    let message = result
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("未知错误");
    Err(format!("{method} 被拒绝：{message}"))
}

/// Liveness classification for the describe probe. `Unauthorized` means the
/// host is up but rejects our credentials — distinct from down, and the
/// adopt/respawn decision hinges on it (0.1.2 BrowserAuth semantics).
pub(crate) enum ProbeOutcome {
    Live(Value),
    Unauthorized,
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
        return ProbeOutcome::Down(format!("describe 响应格式不正确（HTTP {status}）"));
    }
    let result = envelope.get("result").cloned().unwrap_or(Value::Null);
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        return ProbeOutcome::Live(result.get("value").cloned().unwrap_or(Value::Null));
    }
    let message = result
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("未知错误");
    ProbeOutcome::Down(format!("describe 被拒绝：{message}"))
}

/// Anything that answers owns the port — live or credential-locked. Only the
/// unix stop path escalates on a still-answering listener.
#[cfg(unix)]
async fn host_alive(origin: &str) -> bool {
    !matches!(probe_describe(origin).await, ProbeOutcome::Down(_))
}

/// 0.1.2 describe value → the flat `{provider, model}` view the settings
/// card renders: both live under
/// `namespaces[ns="agent-default-model"].value`.
fn normalize_describe(value: &Value) -> Value {
    let entry = value
        .get("namespaces")
        .and_then(Value::as_array)
        .and_then(|namespaces| {
            namespaces
                .iter()
                .find(|entry| entry.get("ns").and_then(Value::as_str) == Some("agent-default-model"))
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
                Ok(path) => {
                    return resolve::resolve_launchable_cli_binary(&path.to_string_lossy())
                }
                Err(reason) => {
                    eprintln!("[dsh] ignoring invalid dsh bin override: {reason}");
                }
            }
        }
    }
    resolve::resolve_launchable_cli_binary("dsh")
}

/// Drain a long-lived child's stream into the last-RING_CAP-bytes ring,
/// feeding each line to the launch-token capture when one is attached.
fn spawn_ring_drain<R: AsyncRead + Unpin + Send + 'static>(
    pipe: R,
    buf: Arc<Mutex<String>>,
    capture: Option<Arc<TokenCapture>>,
) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(pipe);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
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

/// Adopt the host if it already answers with valid credentials, otherwise
/// spawn `dsh web` and wait for readiness. Used by dsh_host_start and the
/// setup autostart task.
pub(crate) async fn ensure_host(
    host_state: &DshHostState,
    settings: &AppSettings,
) -> Result<(), String> {
    let _serialize = host_state.ensure.lock().await;
    let cfg = HostConfig::from(settings);

    // Fast path: a host answering with valid credentials is adopted as-is
    // (including our own still-live spawned child from an earlier start).
    if probe_describe(&cfg.origin).await.is_live() {
        return Ok(());
    }
    // BrowserAuth: a listener rejecting our cookie is alive but locked.
    // Local ports are ours to reclaim — stop the listener and spawn with our
    // own token chain; remote origins can't be adopted.
    if matches!(probe_describe(&cfg.origin).await, ProbeOutcome::Unauthorized) {
        if !is_local_host(&cfg.host) {
            return Err(format!(
                "DSH host 已在 {} 运行但缺少凭据（401）。远程 host 无法自动接管，请在设置里改用本机地址。",
                cfg.origin
            ));
        }
        terminate_local_listener(cfg.port, &cfg.origin).await?;
        sleep(Duration::from_millis(600)).await;
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
    let output = Arc::new(Mutex::new(String::new()));
    let capture = Arc::new(TokenCapture {
        origin: cfg.origin.clone(),
        token: Mutex::new(None),
        busy: AtomicBool::new(false),
    });
    if let Some(stdout) = child.stdout.take() {
        spawn_ring_drain(stdout, Arc::clone(&output), Some(Arc::clone(&capture)));
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_ring_drain(stderr, Arc::clone(&output), Some(Arc::clone(&capture)));
    }

    let deadline = Instant::now() + SPAWN_READY_TIMEOUT;
    let mut last_unauthorized = false;
    let mut next_reexchange = Instant::now();
    loop {
        let probe = probe_describe(&cfg.origin).await;
        if probe.is_live() {
            *lock(&host_state.spawned) = Some(Spawned {
                child,
                origin: cfg.origin.clone(),
            });
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
                // Spawn race: our child died but a credentialed host now
                // answers — adopt it instead of erroring.
                if probe_describe(&cfg.origin).await.is_live() {
                    return Ok(());
                }
                let tail = ring_snapshot(&output);
                return Err(format!(
                    "dsh web 启动后立即退出（{status}）。{}",
                    if tail.is_empty() {
                        "无输出。".to_string()
                    } else {
                        format!("输出：{tail}")
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
            // Spawn race on timeout: a credentialed host won the port
            // meanwhile.
            if probe_describe(&cfg.origin).await.is_live() {
                let _ = child.start_kill();
                return Ok(());
            }
            let tail = ring_snapshot(&output);
            let _ = child.start_kill();
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
    let (describe, error) = match probe {
        ProbeOutcome::Live(value) => (Some(normalize_describe(&value)), None),
        ProbeOutcome::Unauthorized => (
            None,
            Some("host 已运行但凭据无效（401）。点「立即启动」重新拉起，凭据会随之更新。".to_string()),
        ),
        ProbeOutcome::Down(error) => (None, Some(error)),
    };
    let web_url = load_credentials(&cfg.origin)
        .map(|credentials| format!("{}/?token={}", cfg.origin, credentials.launch_token));
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

// ==================== Commands ====================

#[tauri::command]
pub async fn dsh_host_status(state: tauri::State<'_, crate::AppState>) -> Result<DshHostStatus, String> {
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
    // Kill only our own spawned child first.
    state.dsh_host.kill_spawned();
    if !is_local_host(&cfg.host) {
        return Err("只能停止本机的 DSH host，远程地址不会被关闭。".to_string());
    }
    // Terminate whatever still listens — a credential-locked host owns the
    // port just as much as a healthy one, so liveness no longer gates this.
    terminate_local_listener(cfg.port, &cfg.origin).await?;
    Ok(OkResult { ok: true })
}

// ==================== Stop helpers ====================

fn is_local_host(host: &str) -> bool {
    matches!(
        host.trim().to_ascii_lowercase().as_str(),
        "127.0.0.1" | "localhost" | "::1" | "0.0.0.0" | "[::1]" | "[::]"
    )
}

/// Terminate whatever listens on `port`: SIGTERM, re-probe, SIGKILL if the
/// host still answers.
#[cfg(unix)]
async fn terminate_local_listener(port: u16, origin: &str) -> Result<(), String> {
    let output = std::process::Command::new("lsof")
        .arg("-n")
        .arg("-P")
        .arg("-t")
        .arg(format!("-iTCP:{port}"))
        .arg("-sTCP:LISTEN")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("检查端口 {port} 失败：{e}"))?;
    let pids: Vec<u32> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect();
    if pids.is_empty() {
        return Ok(());
    }
    for pid in &pids {
        let _ = std::process::Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status();
    }
    sleep(Duration::from_millis(500)).await;
    if host_alive(origin).await {
        for pid in &pids {
            let _ = std::process::Command::new("kill")
                .arg("-KILL")
                .arg(pid.to_string())
                .status();
        }
    }
    Ok(())
}

#[cfg(windows)]
async fn terminate_local_listener(port: u16, _origin: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut netstat = std::process::Command::new("netstat");
    netstat
        .args(["-ano", "-p", "tcp"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    let output = netstat
        .output()
        .map_err(|e| format!("检查端口 {port} 失败：{e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let needle = format!(":{port}");
    let mut pids = Vec::new();
    for line in stdout.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 || !cols[3].eq_ignore_ascii_case("LISTENING") {
            continue;
        }
        if cols[1].ends_with(&needle) {
            if let Ok(pid) = cols[4].parse::<u32>() {
                pids.push(pid);
            }
        }
    }
    for pid in pids {
        let mut taskkill = std::process::Command::new("taskkill");
        taskkill
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        let _ = taskkill.status();
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
async fn terminate_local_listener(_port: u16, _origin: &str) -> Result<(), String> {
    Err("当前平台不支持停止本机 DSH host。".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn launch_token_is_extracted_from_web_url_line() {
        let line = "dsh web: http://127.0.0.1:3080/?token=RmF6KLIdrmQlbogo4A_StSQsyzSCzn79Et8S0CVjpUE";
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
