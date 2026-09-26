//! Managed `opencode serve` lifecycle: probe the default port, adopt a
//! healthy server, else spawn our own on a free port and wait for health.
//!
//! The server is what makes the built-in `question` tool answerable: `run`
//! clients attach to it (`opencode run --attach`), question/permission asks
//! park server-side, and the GUI answers them over HTTP
//! (`POST /question/:requestID/reply`).
//!
//! Ownership rule mirrors dsh_host: only servers we spawned are tracked in
//! [`OpencodeServerState`] and killed on app exit; an adopted server (the
//! user's own `opencode serve`) is never touched.

use std::process::Stdio;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::process::Child;
use tokio::time::{sleep, Duration, Instant};

use crate::engine::{command_for_binary, resolve};

pub(crate) const DEFAULT_PORT: u16 = 4096;
const SPAWN_POLL_INTERVAL: Duration = Duration::from_millis(250);
const SPAWN_READY_TIMEOUT: Duration = Duration::from_secs(20);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Default)]
pub struct OpencodeServerState {
    /// Resolved origin once ensure succeeded (adopted or spawned).
    origin: Mutex<Option<String>>,
    /// The child we spawned; `None` when adopted.
    spawned: Mutex<Option<Child>>,
    /// Kill-on-close job owning the spawned tree. MUST live as long as the
    /// server itself: dropping it (e.g. as a local in `ensure_server`) makes
    /// the kernel sweep the freshly spawned tree the moment ensure returns,
    /// so the session POST that follows hits a dead port.
    #[cfg(windows)]
    job: Mutex<Option<Arc<crate::engine::job::KillOnCloseJob>>>,
    /// Serializes ensure so concurrent sends never spawn twice.
    ensure: tokio::sync::Mutex<()>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl OpencodeServerState {
    /// Kill only the server we spawned (app exit). Adopted servers survive.
    pub fn kill_spawned(&self) {
        let child = lock(&self.spawned).take();
        if let Some(mut child) = child {
            if let Some(pid) = child.id() {
                crate::engine::kill_process_group(pid);
            }
            let _ = child.start_kill();
        }
        // Release the job last: closing the last handle sweeps any survivor
        // of the tree, which is the same end state as the kills above.
        #[cfg(windows)]
        *lock(&self.job) = None;
        *lock(&self.origin) = None;
    }
}

/// `GET /global/health` — one healthy probe means an opencode server.
async fn healthy(origin: &str) -> bool {
    let Ok(client) = reqwest::Client::builder().timeout(HEALTH_TIMEOUT).build() else {
        return false;
    };
    let Ok(response) = client.get(format!("{origin}/global/health")).send().await else {
        return false;
    };
    response
        .json::<Value>()
        .await
        .map(|body| body.get("healthy").and_then(Value::as_bool) == Some(true))
        .unwrap_or(false)
}

/// A free loopback port for our own server (standard bind-drop race).
fn free_port() -> Result<u16, String> {
    std::net::TcpListener::bind("127.0.0.1:0")
        .map(|listener| listener.local_addr().map(|addr| addr.port()))
        .and_then(|r| r)
        .map_err(|e| format!("no free port for opencode serve: {e}"))
}

/// Ensure an opencode server answers and return its origin. Adopt a healthy
/// server on `probe_port` (the user's own, never killed by us); otherwise
/// spawn `opencode serve` on a free port and wait for health. The port is a
/// parameter so tests can adopt a mock server without fighting a real one.
pub(crate) async fn ensure_server(
    state: &OpencodeServerState,
    bin: &str,
    probe_port: u16,
) -> Result<String, String> {
    if let Some(origin) = lock(&state.origin).clone() {
        return Ok(origin);
    }
    let _serialize = state.ensure.lock().await;
    if let Some(origin) = lock(&state.origin).clone() {
        return Ok(origin);
    }

    let default_origin = format!("http://127.0.0.1:{probe_port}");
    if healthy(&default_origin).await {
        *lock(&state.origin) = Some(default_origin.clone());
        return Ok(default_origin);
    }

    let resolved = resolve::resolve_launchable_cli_binary(bin);
    let port = free_port()?;
    let origin = format!("http://127.0.0.1:{port}");
    let mut command = command_for_binary(&resolved);
    command
        .arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string());
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    crate::engine::hide_console(&mut command);
    let mut child = command.spawn().map_err(|e| {
        format!("无法启动 opencode serve（{resolved}）：{e}。请确认已安装 opencode。")
    })?;
    #[cfg(windows)]
    let tree_guard = crate::engine::job::assign_kill_on_close(&child);

    let deadline = Instant::now() + SPAWN_READY_TIMEOUT;
    loop {
        if healthy(&origin).await {
            *lock(&state.spawned) = Some(child);
            // Hand the job guard to the server state: it must outlive this
            // function. Dropping it here would sweep the tree immediately.
            #[cfg(windows)]
            *lock(&state.job) = tree_guard;
            *lock(&state.origin) = Some(origin.clone());
            return Ok(origin);
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(format!(
                    "opencode serve 启动后立即退出（{status}）。请检查 opencode 安装。"
                ));
            }
            Ok(None) => {}
            Err(e) => return Err(format!("opencode serve 状态异常:{e}")),
        }
        if Instant::now() >= deadline {
            if let Some(pid) = child.id() {
                crate::engine::kill_process_group(pid);
            }
            let _ = child.start_kill();
            return Err("opencode serve 启动超时(20s 未通过健康检查)".to_string());
        }
        sleep(SPAWN_POLL_INTERVAL).await;
    }
}

/// One POST against the server, `?directory=` routing included; errors carry
/// the server's message when it sends one.
pub(crate) async fn post(
    origin: &str,
    path: &str,
    directory: &str,
    body: Option<Value>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client
        .post(format!("{origin}{path}"))
        .query(&[("directory", directory)]);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|e| format!("{e}"))?;
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status();
    let detail = response
        .text()
        .await
        .unwrap_or_default()
        .trim()
        .chars()
        .take(200)
        .collect::<String>();
    Err(format!("opencode {path} 失败（{status}）: {detail}"))
}
