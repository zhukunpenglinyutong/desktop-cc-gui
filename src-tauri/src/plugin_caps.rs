//! Generic plugin capability egress: the host-side grant checks for the
//! `network:` and `exec:` manifest permissions. Each command re-reads
//! plugins.json and checks the plugin's declared grants before doing
//! anything.
//!
//! Trust model (aligned with src/features/plugins/runtime/hardening.ts):
//! plugin JS runs in the main webview, where the __TAURI_INTERNALS__
//! wrapping is best-effort — a malicious plugin could invoke these commands
//! directly with a forged plugin_id. The checks here are therefore the
//! DX/accident gate and the surface marketplace review audits; the hard
//! boundary is install-time review, quarantine/uninstall, and lifecycle
//! tracking, not anything enforceable in-process.
//!
//! Grant syntax (shape-validated at install time in plugins/manifest.rs via
//! [`is_valid_network_grant`]/[`is_valid_exec_grant`];
//! packages/plugin-sdk/spec/permissions.json is the single source of truth —
//! the SDK, this module's spec-vector tests, and the template's
//! validate-manifest.mjs all run its vectors):
//! - `network:<host>`            any port
//! - `network:<host>:<port>`     single port
//! - `network:<host>:<a>-<b>`    inclusive port range
//!   host = `[A-Za-z0-9.-]+`, exact match, case-insensitive, no wildcards,
//!   and a grant for a domain never implies its subdomains. `network:none`
//!   is a base permission (KNOWN_PERMISSIONS) and grants nothing.
//! - `exec:<bin>`  bare binary name (`^[A-Za-z0-9._-]+$`, no path
//!   separators), exact match. Resolution goes through
//!   `engine::resolve::find_cli_binary` (PATH + well-known install dirs,
//!   Windows shim upgrades).
//!
//! `plugin_exec_spawn` additionally takes a `lifecycle` argument. The
//! default, `"detached"`, drops the child handle on purpose so the process
//! outlives the host (usage-stats' tokentracker service depends on that
//! fire-and-forget semantic — do not change it). `"plugin"` instead
//! registers the handle in TRACKED_CHILDREN under the plugin id, and the
//! host kills those processes when the plugin is disabled or uninstalled
//! (plugins.rs hooks), when `plugin_exec_kill` runs, or when the app exits
//! (lib.rs window-destroyed hook).

use serde::Serialize;
use std::collections::HashMap;
#[cfg(windows)]
use std::sync::Arc;
use std::sync::LazyLock;
use std::time::Duration;

use parking_lot::Mutex;

use crate::engine::resolve::{command_for_binary, find_cli_binary};

const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Response body cap for plugin_http_request (returned as text; JSON not
/// required).
const MAX_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;
/// Per-stream capture cap for plugin_exec_run.
const MAX_OUTPUT_BYTES: usize = 64 * 1024;
const DEFAULT_EXEC_TIMEOUT_MS: u64 = 30_000;
const MAX_EXEC_TIMEOUT_MS: u64 = 300_000;
/// One shared client for plugin_http_request: building one per call wasted
/// a connection pool per request.
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .timeout(HTTP_REQUEST_TIMEOUT)
        .build()
        .expect("HTTP client builds from static config")
});

// ── grant parsing / matching ────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PortSpec {
    Any,
    Single(u16),
    Range(u16, u16),
}

fn parse_port_spec(part: &str) -> Option<PortSpec> {
    // Ports are 1..=65535 (0 is not a usable service port; u16 parse already
    // rejects >65535) — mirrors the SDK's networkGrantAllows.
    let parse_port = |s: &str| -> Option<u16> { s.parse::<u16>().ok().filter(|p| *p > 0) };
    if let Some((a, b)) = part.split_once('-') {
        let a = parse_port(a)?;
        let b = parse_port(b)?;
        if a > b {
            return None;
        }
        Some(PortSpec::Range(a, b))
    } else {
        Some(PortSpec::Single(parse_port(part)?))
    }
}

fn is_valid_host(host: &str) -> bool {
    !host.is_empty()
        && host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
}

fn is_valid_bin_name(bin: &str) -> bool {
    !bin.is_empty()
        && bin
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
}

/// Parse `network:<host>[:<port>|<a>-<b>]` into (lowercased host, ports).
/// `network:none` is a base permission handled by KNOWN_PERMISSIONS and
/// deliberately never parses as a grant here.
fn parse_network_grant(permission: &str) -> Option<(String, PortSpec)> {
    let rest = permission.strip_prefix("network:")?;
    if rest == "none" {
        return None;
    }
    // The host charset excludes ':', so the first ':' cleanly separates it
    // from the port part.
    let (host, ports) = match rest.split_once(':') {
        Some((host, port_part)) => (host, parse_port_spec(port_part)?),
        None => (rest, PortSpec::Any),
    };
    if !is_valid_host(host) {
        return None;
    }
    Some((host.to_ascii_lowercase(), ports))
}

/// Install-time shape check for `network:` permissions (plugins.rs).
pub(crate) fn is_valid_network_grant(permission: &str) -> bool {
    parse_network_grant(permission).is_some()
}

/// Install-time shape check for `exec:` permissions (plugins.rs).
pub(crate) fn is_valid_exec_grant(permission: &str) -> bool {
    permission
        .strip_prefix("exec:")
        .is_some_and(is_valid_bin_name)
}

/// Does any `network:` grant cover `host` (exact, case-insensitive) at
/// `port`? A grant without a port covers any port; single-port and range
/// grants need an exact/in-range match.
pub(crate) fn network_grant_allows(grants: &[String], host: &str, port: Option<u16>) -> bool {
    let host = host.to_ascii_lowercase();
    grants.iter().any(|grant| {
        let Some((grant_host, ports)) = parse_network_grant(grant) else {
            return false;
        };
        grant_host == host
            && match ports {
                PortSpec::Any => true,
                PortSpec::Single(p) => port == Some(p),
                PortSpec::Range(a, b) => port.is_some_and(|p| (a..=b).contains(&p)),
            }
    })
}

/// Does any `exec:` grant name exactly `bin`?
pub(crate) fn exec_grant_allows(grants: &[String], bin: &str) -> bool {
    grants
        .iter()
        .any(|grant| grant.strip_prefix("exec:") == Some(bin))
}

// ── server-side gates ───────────────────────────────────────────────────────

fn require_enabled(plugin_id: &str, enabled: bool) -> Result<(), String> {
    if enabled {
        Ok(())
    } else {
        Err(format!("{plugin_id}: plugin is disabled"))
    }
}

fn require_network_grant(
    grants: &[String],
    plugin_id: &str,
    host: &str,
    port: Option<u16>,
) -> Result<(), String> {
    if network_grant_allows(grants, host, port) {
        Ok(())
    } else {
        Err(format!(
            "{plugin_id}: missing network grant for {host}:{}",
            port.map(|p| p.to_string()).unwrap_or_else(|| "*".to_string())
        ))
    }
}

fn require_exec_grant(grants: &[String], plugin_id: &str, bin: &str) -> Result<(), String> {
    if exec_grant_allows(grants, bin) {
        Ok(())
    } else {
        Err(format!("{plugin_id}: missing exec grant exec:{bin}"))
    }
}

/// Shared gate for all three commands: the plugin must be installed and
/// enabled; its declared permissions come back for the caller's grant check.
fn load_grants(plugin_id: &str) -> Result<Vec<String>, String> {
    let (enabled, permissions) = crate::plugins::plugin_enabled_permissions(plugin_id)?;
    require_enabled(plugin_id, enabled)?;
    Ok(permissions)
}

/// Shape + grant + resolution for both exec commands. Returns the resolved
/// binary path string for `command_for_binary`.
fn resolve_granted_bin(plugin_id: &str, grants: &[String], bin: &str) -> Result<String, String> {
    if !is_valid_bin_name(bin) {
        return Err(format!("{plugin_id}: invalid binary name {bin:?}"));
    }
    require_exec_grant(grants, plugin_id, bin)?;
    let path = find_cli_binary(bin, None)
        .ok_or_else(|| format!("{plugin_id}: binary not found on PATH: {bin}"))?;
    Ok(path.to_string_lossy().to_string())
}

// ── lifecycle-tracked children ──────────────────────────────────────────────

/// How a spawned child relates to the host's lifetime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Lifecycle {
    /// Fire-and-forget: the handle is dropped and the process outlives the
    /// host. The default, and the only behavior detached services may rely
    /// on (see module docs).
    Detached,
    /// Host-managed: the handle is registered under the plugin id and killed
    /// on disable/uninstall/plugin_exec_kill/app exit.
    Plugin,
}

fn parse_lifecycle(plugin_id: &str, lifecycle: Option<&str>) -> Result<Lifecycle, String> {
    match lifecycle {
        None | Some("detached") => Ok(Lifecycle::Detached),
        Some("plugin") => Ok(Lifecycle::Plugin),
        Some(other) => Err(format!(
            "{plugin_id}: invalid lifecycle {other:?} (expected \"detached\" or \"plugin\")"
        )),
    }
}

/// Child handles from `plugin_exec_spawn` with `lifecycle: "plugin"`, keyed
/// by plugin id. Detached spawns never land here. Only children a plugin
/// spawned itself are reachable through its id, so no entry in this map can
/// ever be used to kill another plugin's (or the host's) processes.
struct TrackedChild {
    child: tokio::process::Child,
    /// Kill-on-close job guard (Windows): dropping the entry closes the job
    /// and the kernel sweeps grandchildren the start_kill tree walk missed.
    #[cfg(windows)]
    _tree_guard: Option<Arc<crate::engine::job::KillOnCloseJob>>,
}

static TRACKED_CHILDREN: LazyLock<Mutex<HashMap<String, Vec<TrackedChild>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn tracked_children() -> &'static Mutex<HashMap<String, Vec<TrackedChild>>> {
    &TRACKED_CHILDREN
}

pub(crate) fn register_tracked_child(plugin_id: &str, child: tokio::process::Child) {
    #[cfg(windows)]
    let tree_guard = crate::engine::job::assign_kill_on_close(&child);
    let mut registry = tracked_children().lock();
    let children = registry.entry(plugin_id.to_string()).or_default();
    // Prune dead handles before pushing: a plugin that respawns a child in
    // a loop would otherwise accumulate one entry per spawn until an
    // explicit kill/disable/uninstall/exit. try_wait reaps the zombie as a
    // side effect; an error means the handle can no longer be waited on, so
    // treat it as exited too. Pruning drops the entry — its job guard then
    // sweeps any orphaned grandchildren of that dead child.
    children.retain_mut(|entry| matches!(entry.child.try_wait(), Ok(None)));
    children.push(TrackedChild {
        child,
        #[cfg(windows)]
        _tree_guard: tree_guard,
    });
}

/// Remove every tracked child of `plugin_id` and SIGKILL each one, returning
/// how many were signalled. Uses start_kill (synchronous), so the same
/// helper serves the async plugin_exec_kill command and the sync
/// disable/uninstall/exit hooks; the tokio runtime reaps the orphans. Same
/// SIGKILL semantics as plugin_exec_run's kill_on_drop.
pub(crate) fn kill_tracked_children(plugin_id: &str) -> usize {
    let children = tracked_children()
        .lock()
        .remove(plugin_id)
        .unwrap_or_default();
    let killed = children.len();
    for mut entry in children {
        let _ = entry.child.start_kill();
        // Entry drops here: on Windows its job guard sweeps the whole tree.
    }
    killed
}

/// SIGKILL every tracked child of every plugin. Called from the lib.rs
/// window-destroyed hook so `lifecycle: "plugin"` services don't outlive
/// the host.
pub(crate) fn kill_all_tracked_children() {
    let mut registry = tracked_children()
        .lock();
    for (_, children) in registry.drain() {
        for mut entry in children {
            let _ = entry.child.start_kill();
        }
    }
}

/// Test-only stand-in for a plugin-spawned service: a process that stays
/// alive until killed.
#[cfg(test)]
pub(crate) fn spawn_test_sleeper() -> tokio::process::Child {
    #[cfg(unix)]
    let mut command = {
        let mut command = tokio::process::Command::new("sleep");
        command.arg("60");
        command
    };
    #[cfg(windows)]
    let mut command = {
        let mut command = tokio::process::Command::new("cmd");
        command.args(["/c", "ping", "-n", "60", "127.0.0.1"]);
        command
    };
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("sleeper spawn")
}

// ── commands ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginHttpResponse {
    status: u16,
    body: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginExecRunResult {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginExecKillResult {
    killed: usize,
}

fn parse_http_method(method: &str) -> Result<reqwest::Method, String> {
    match method.trim().to_ascii_uppercase().as_str() {
        "GET" => Ok(reqwest::Method::GET),
        "POST" => Ok(reqwest::Method::POST),
        "PUT" => Ok(reqwest::Method::PUT),
        "PATCH" => Ok(reqwest::Method::PATCH),
        "DELETE" => Ok(reqwest::Method::DELETE),
        "HEAD" => Ok(reqwest::Method::HEAD),
        other => Err(format!("method not allowed: {other}")),
    }
}

/// Read a response body as text, enforcing the 8MB cap on both the declared
/// length and the bytes actually received.
async fn read_body_capped(mut response: reqwest::Response) -> Result<String, String> {
    let limit = MAX_RESPONSE_BODY_BYTES as u64;
    if response.content_length().is_some_and(|len| len > limit) {
        return Err("response body exceeds the 8MB limit".to_string());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Failed to read response body: {error}"))?
    {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BODY_BYTES {
            return Err("response body exceeds the 8MB limit".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Read one child stream with a hard memory bound: keep the first
/// MAX_OUTPUT_BYTES + 1 bytes, then drain (discard) the rest so the child
/// never blocks on a full pipe. wait_with_output buffered unboundedly, so a
/// chatty process could OOM the host before truncate_output ever ran.
async fn read_stream_capped(
    pipe: impl tokio::io::AsyncRead + Unpin,
) -> std::io::Result<Vec<u8>> {
    use tokio::io::AsyncReadExt;
    let mut taken = pipe.take((MAX_OUTPUT_BYTES + 1) as u64);
    let mut buf = Vec::new();
    taken.read_to_end(&mut buf).await?;
    tokio::io::copy(&mut taken.into_inner(), &mut tokio::io::sink()).await?;
    Ok(buf)
}

fn truncate_output(bytes: &[u8]) -> String {
    let slice = if bytes.len() > MAX_OUTPUT_BYTES {
        &bytes[..MAX_OUTPUT_BYTES]
    } else {
        bytes
    };
    String::from_utf8_lossy(slice).into_owned()
}

/// Proxied HTTP request for plugins (bypasses webview CORS). The URL's
/// host+port must be covered by one of the plugin's `network:` grants.
/// Non-2xx responses are NOT errors here — status and body are returned and
/// the plugin decides.
#[tauri::command]
pub(crate) async fn plugin_http_request(
    plugin_id: String,
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<PluginHttpResponse, String> {
    let grants = load_grants(&plugin_id)?;
    let method = parse_http_method(&method)?;
    let url = reqwest::Url::parse(url.trim())
        .map_err(|error| format!("{plugin_id}: invalid url: {error}"))?;
    match url.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("{plugin_id}: url scheme not allowed: {scheme}")),
    }
    let host = url
        .host_str()
        .ok_or_else(|| format!("{plugin_id}: url has no host"))?;
    let port = url.port_or_known_default();
    require_network_grant(&grants, &plugin_id, host, port)?;

    let client = &*HTTP_CLIENT;
    let mut request = client.request(method, url);
    if let Some(headers) = headers {
        for (name, value) in headers {
            let Ok(name) = reqwest::header::HeaderName::from_bytes(name.as_bytes()) else {
                continue;
            };
            let Ok(value) = reqwest::header::HeaderValue::from_str(&value) else {
                continue;
            };
            request = request.header(name, value);
        }
    }
    if let Some(body) = body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("{plugin_id}: request failed: {error}"))?;
    let status = response.status().as_u16();
    let body = read_body_capped(response).await?;
    Ok(PluginHttpResponse { status, body })
}

/// Grant gate for `plugin_add_workspace`, pure for tests: base permission
/// `host:workspace`; meta carrying a `wsl` key (remote execution steering)
/// additionally requires `host:workspace:remote`.
fn require_workspace_grants(
    grants: &[String],
    plugin_id: &str,
    meta: Option<&serde_json::Value>,
) -> Result<(), String> {
    if !grants.iter().any(|p| p == "host:workspace") {
        return Err(format!("{plugin_id}: missing permission host:workspace"));
    }
    if let Some(m) = meta {
        if m.as_object().is_some_and(|o| o.contains_key("wsl"))
            && !grants.iter().any(|p| p == "host:workspace:remote")
        {
            return Err(format!(
                "{plugin_id}: meta.wsl requires permission host:workspace:remote"
            ));
        }
    }
    Ok(())
}

/// Plugin-scoped workspace registration (SDK `ctx.workspaces.add`). Server-side
/// counterpart of the JS permission gate in runtime/context.ts — a plugin that
/// bypasses the webview gate (direct IPC from an async continuation, see
/// hardening.ts) still lands here. `meta` carrying a `wsl` key steers engine
/// traffic over ssh to a plugin-named host (出站 + 远程执行导向), so it
/// requires the separate `host:workspace:remote` grant; the general
/// `add_workspace` command refuses `wsl` meta outright.
#[tauri::command]
pub(crate) async fn plugin_add_workspace(
    state: tauri::State<'_, crate::AppState>,
    plugin_id: String,
    path: String,
    meta: Option<serde_json::Value>,
) -> Result<crate::history::reader::Workspace, String> {
    let grants = load_grants(&plugin_id)?;
    require_workspace_grants(&grants, &plugin_id, meta.as_ref())?;
    crate::history::reader::add_workspace_inner(&state, &path, meta)
}

/// Run a granted binary to completion, capturing stdout/stderr (64KB each).
/// `timeoutMs` defaults to 30s and is capped at 300s; a timed-out process is
/// killed (kill_on_drop) and reported as an error.
#[tauri::command]
pub(crate) async fn plugin_exec_run(
    plugin_id: String,
    bin: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<PluginExecRunResult, String> {
    let grants = load_grants(&plugin_id)?;
    let bin_path = resolve_granted_bin(&plugin_id, &grants, &bin)?;
    let timeout_ms = timeout_ms
        .unwrap_or(DEFAULT_EXEC_TIMEOUT_MS)
        .clamp(1, MAX_EXEC_TIMEOUT_MS);

    // tokio Commands are built from the std one so Windows .cmd/.bat
    // wrapping is identical in both worlds (same as engine::models probes).
    let mut command = tokio::process::Command::from(command_for_binary(&bin_path));
    command
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(env) = env {
        command.envs(env);
    }
    // Own process group (unix) so the timeout sweep below can take the
    // whole tree, not just the direct child.
    #[cfg(unix)]
    command.process_group(0);
    // Windows：别让控制台子进程弹出窗口/在 Windows Terminal 开选项卡（宿主其它 spawn 点
    // 都用了 hide_console，插件桥是唯一漏的；不加则插件每次 exec/spawn 都闪控制台）。
    #[cfg(windows)]
    crate::engine::hide_console(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("{plugin_id}: failed to start {bin}: {error}"))?;
    let child_pid = child.id();
    // Kill-on-close job (Windows): sweeps grandchildren whenever this guard
    // drops — including the timeout path, where kill_on_drop only reaches
    // the direct child and an orphaned grandchild would escape taskkill.
    #[cfg(windows)]
    let tree_guard = crate::engine::job::assign_kill_on_close(&child);
    // Bounded streaming reads of both pipes at once, then wait — all under
    // the same timeout; a timeout drops the child and kill_on_drop fires.
    let stdout_pipe = child.stdout.take().expect("stdout is piped");
    let stderr_pipe = child.stderr.take().expect("stderr is piped");
    let run = async move {
        let (stdout, stderr) = tokio::join!(
            read_stream_capped(stdout_pipe),
            read_stream_capped(stderr_pipe),
        );
        let status = child.wait().await;
        (stdout, stderr, status)
    };
    let (stdout, stderr, status) = match tokio::time::timeout(Duration::from_millis(timeout_ms), run).await {
        Ok(result) => result,
        Err(_) => {
            // The dropped run future kill_on_drop-kills the direct child;
            // sweep the tree it may have orphaned before dying.
            #[cfg(unix)]
            if let Some(pid) = child_pid.filter(|p| *p != 0) {
                crate::engine::kill_process_group(pid);
            }
            #[cfg(windows)]
            drop(tree_guard);
            return Err(format!("{plugin_id}: {bin} timed out after {timeout_ms}ms"));
        }
    };
    // Settle sweep (unix): the group is empty on a clean exit (ESRCH no-op);
    // anything left is an orphaned grandchild of the finished process.
    #[cfg(unix)]
    if let Some(pid) = child_pid.filter(|p| *p != 0) {
        crate::engine::kill_process_group(pid);
    }
    let stdout =
        stdout.map_err(|error| format!("{plugin_id}: failed to read {bin} stdout: {error}"))?;
    let stderr =
        stderr.map_err(|error| format!("{plugin_id}: failed to read {bin} stderr: {error}"))?;
    let status =
        status.map_err(|error| format!("{plugin_id}: failed to run {bin}: {error}"))?;

    Ok(PluginExecRunResult {
        code: status.code(),
        stdout: truncate_output(&stdout),
        stderr: truncate_output(&stderr),
    })
}

/// Spawn a granted binary. `lifecycle` defaults to "detached": the child
/// handle is dropped on purpose so the process keeps running after this
/// call and outlives the host. `lifecycle: "plugin"` registers the handle
/// under the plugin id instead, and the host kills the process when the
/// plugin is disabled or uninstalled, when plugin_exec_kill runs, or when
/// the app exits.
#[tauri::command]
pub(crate) async fn plugin_exec_spawn(
    plugin_id: String,
    bin: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
    lifecycle: Option<String>,
) -> Result<(), String> {
    let grants = load_grants(&plugin_id)?;
    let bin_path = resolve_granted_bin(&plugin_id, &grants, &bin)?;

    match parse_lifecycle(&plugin_id, lifecycle.as_deref())? {
        Lifecycle::Detached => {
            let mut command = command_for_binary(&bin_path);
            command
                .args(&args)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            if let Some(env) = env {
                command.envs(env);
            }
            #[cfg(windows)]
            crate::engine::hide_console(&mut command);
            command
                .spawn()
                .map_err(|error| format!("{plugin_id}: failed to start {bin}: {error}"))?;
        }
        Lifecycle::Plugin => {
            // tokio Command built from the std one, same as plugin_exec_run,
            // so Windows .cmd/.bat wrapping is identical in both worlds.
            let mut command = tokio::process::Command::from(command_for_binary(&bin_path));
            command
                .args(&args)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            if let Some(env) = env {
                command.envs(env);
            }
            #[cfg(windows)]
            crate::engine::hide_console(&mut command);
            let child = command
                .spawn()
                .map_err(|error| format!("{plugin_id}: failed to start {bin}: {error}"))?;
            register_tracked_child(&plugin_id, child);
        }
    }
    Ok(())
}

/// Kill every `lifecycle: "plugin"` child this plugin spawned and clear its
/// registry entry. Cleanup semantics: any installed plugin record may call
/// this — a disabled plugin must still be able to clean up its orphans —
/// and no exec: grant is required because a plugin can only ever reach its
/// own children.
#[tauri::command]
pub(crate) async fn plugin_exec_kill(plugin_id: String) -> Result<PluginExecKillResult, String> {
    crate::plugins::plugin_enabled_permissions(&plugin_id)?;
    Ok(PluginExecKillResult {
        killed: kill_tracked_children(&plugin_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grants(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }
    /// packages/plugin-sdk/spec/permissions.json — the single source of
    /// truth shared with the SDK and the template's validate-manifest.mjs;
    /// all three run the same vectors so drift fails here.
    const PERMISSIONS_SPEC: &str =
        include_str!("../../packages/plugin-sdk/spec/permissions.json");

    fn spec() -> serde_json::Value {
        serde_json::from_str(PERMISSIONS_SPEC).expect("permissions spec JSON is valid")
    }

    #[test]
    fn workspace_grants_gate() {
        let wsl_meta =
            serde_json::json!({"wsl": {"host": "10.0.0.2", "user": "d", "distro": "Ubuntu"}});
        let plain_meta = serde_json::json!({"note": "x"});
        // 无 host:workspace → 一律拒
        assert!(require_workspace_grants(&grants(&[]), "p", None).is_err());
        assert!(require_workspace_grants(&grants(&["host:session"]), "p", None).is_err());
        // 有 host:workspace → 无 meta / 非 wsl meta 放行
        let base = grants(&["host:workspace"]);
        assert!(require_workspace_grants(&base, "p", None).is_ok());
        assert!(require_workspace_grants(&base, "p", Some(&plain_meta)).is_ok());
        // wsl meta 必须另有 host:workspace:remote(出站 + 远程执行导向)
        assert!(require_workspace_grants(&base, "p", Some(&wsl_meta)).is_err());
        let remote = grants(&["host:workspace", "host:workspace:remote"]);
        assert!(require_workspace_grants(&remote, "p", Some(&wsl_meta)).is_ok());
    }

    #[test]
    fn network_grant_shapes_match_spec() {
        let spec = spec();
        let shapes = &spec["networkGrantShapes"];
        for valid in shapes["valid"].as_array().unwrap() {
            let permission = valid.as_str().unwrap();
            assert!(is_valid_network_grant(permission), "spec-valid: {permission}");
        }
        for invalid in shapes["invalid"].as_array().unwrap() {
            let permission = invalid.as_str().unwrap();
            assert!(!is_valid_network_grant(permission), "spec-invalid: {permission}");
        }
    }

    #[test]
    fn network_allow_vectors_match_spec() {
        let spec = spec();
        for (i, vector) in spec["networkAllow"].as_array().unwrap().iter().enumerate() {
            let grants: Vec<String> = vector["grants"]
                .as_array()
                .unwrap()
                .iter()
                .map(|g| g.as_str().unwrap().to_string())
                .collect();
            let url = vector["url"].as_str().unwrap();
            let expected = vector["allowed"].as_bool().unwrap();
            // The same gate plugin_http_request applies: parse the url,
            // scheme must be http/https, then host + port_or_known_default
            // against the grants.
            let allowed = reqwest::Url::parse(url)
                .ok()
                .filter(|u| matches!(u.scheme(), "http" | "https"))
                .and_then(|u| {
                    u.host_str()
                        .map(|host| network_grant_allows(&grants, host, u.port_or_known_default()))
                })
                .unwrap_or(false);
            assert_eq!(allowed, expected, "networkAllow[{i}]: {grants:?} vs {url}");
        }
    }

    #[test]
    fn exec_grant_shapes_match_spec() {
        let spec = spec();
        let shapes = &spec["execGrantShapes"];
        for valid in shapes["valid"].as_array().unwrap() {
            let permission = valid.as_str().unwrap();
            assert!(is_valid_exec_grant(permission), "spec-valid: {permission}");
        }
        for invalid in shapes["invalid"].as_array().unwrap() {
            let permission = invalid.as_str().unwrap();
            assert!(!is_valid_exec_grant(permission), "spec-invalid: {permission}");
        }
    }

    #[test]
    fn exec_allow_vectors_match_spec() {
        let spec = spec();
        for (i, vector) in spec["execAllow"].as_array().unwrap().iter().enumerate() {
            let grants: Vec<String> = vector["grants"]
                .as_array()
                .unwrap()
                .iter()
                .map(|g| g.as_str().unwrap().to_string())
                .collect();
            let bin = vector["bin"].as_str().unwrap();
            let expected = vector["allowed"].as_bool().unwrap();
            assert_eq!(
                exec_grant_allows(&grants, bin),
                expected,
                "execAllow[{i}]: {grants:?} vs {bin}"
            );
        }
    }

    #[test]
    fn network_grant_matches_host_case_insensitively() {
        let g = grants(&["network:Example.COM"]);
        assert!(network_grant_allows(&g, "example.com", Some(443)));
        assert!(network_grant_allows(&g, "EXAMPLE.COM", Some(443)));
        // Grant host is matched exactly, including its literal dots.
        assert!(!network_grant_allows(&g, "examplecom", Some(443)));
    }

    #[test]
    fn network_grant_without_port_allows_any_port() {
        let g = grants(&["network:127.0.0.1"]);
        assert!(network_grant_allows(&g, "127.0.0.1", Some(80)));
        assert!(network_grant_allows(&g, "127.0.0.1", Some(7680)));
        assert!(network_grant_allows(&g, "127.0.0.1", None));
    }

    #[test]
    fn network_grant_single_port_matches_exactly() {
        let g = grants(&["network:127.0.0.1:7680"]);
        assert!(network_grant_allows(&g, "127.0.0.1", Some(7680)));
        assert!(!network_grant_allows(&g, "127.0.0.1", Some(7681)));
        assert!(!network_grant_allows(&g, "127.0.0.1", None));
    }

    #[test]
    fn network_grant_port_range_is_inclusive() {
        let g = grants(&["network:127.0.0.1:7680-7690"]);
        assert!(network_grant_allows(&g, "127.0.0.1", Some(7680)));
        assert!(network_grant_allows(&g, "127.0.0.1", Some(7690)));
        assert!(network_grant_allows(&g, "127.0.0.1", Some(7685)));
        assert!(!network_grant_allows(&g, "127.0.0.1", Some(7679)));
        assert!(!network_grant_allows(&g, "127.0.0.1", Some(7691)));
    }

    #[test]
    fn network_grant_rejects_undeclared_and_spoofed_hosts() {
        let g = grants(&["network:example.com"]);
        // Undeclared host.
        assert!(!network_grant_allows(&g, "other.com", Some(443)));
        // Subdomains are never implied.
        assert!(!network_grant_allows(&g, "api.example.com", Some(443)));
        // Suffix spoofing.
        assert!(!network_grant_allows(&g, "example.com.evil.com", Some(443)));
        assert!(!network_grant_allows(&g, "notexample.com", Some(443)));
        // No grants at all.
        assert!(!network_grant_allows(&[], "example.com", Some(443)));
    }

    #[test]
    fn network_none_grants_nothing() {
        let g = grants(&["network:none"]);
        assert!(!network_grant_allows(&g, "none", Some(80)));
        assert!(!network_grant_allows(&g, "example.com", Some(80)));
    }

    #[test]
    fn network_grant_shape_validation() {
        assert!(is_valid_network_grant("network:127.0.0.1"));
        assert!(is_valid_network_grant("network:api.example.com:8443"));
        assert!(is_valid_network_grant("network:127.0.0.1:7680-7690"));
        assert!(!is_valid_network_grant("network:none")); // base permission, not a grant
        assert!(!is_valid_network_grant("network:"));
        assert!(!is_valid_network_grant("network:bad host"));
        assert!(!is_valid_network_grant("network:*.example.com"));
        assert!(!is_valid_network_grant("network:host:abc"));
        assert!(!is_valid_network_grant("network:host:99999")); // > u16
        assert!(!is_valid_network_grant("network:host:0")); // ports are 1..=65535
        assert!(!is_valid_network_grant("network:host:0-80"));
        assert!(!is_valid_network_grant("network:host:90-80")); // inverted range
        assert!(!is_valid_network_grant("network:host:1-2-3"));
        assert!(!is_valid_network_grant("network:host:"));
        assert!(!is_valid_network_grant("example.com")); // missing prefix
    }

    #[test]
    fn exec_grant_shape_validation() {
        assert!(is_valid_exec_grant("exec:npm"));
        assert!(is_valid_exec_grant("exec:tokentracker-cli"));
        assert!(is_valid_exec_grant("exec:tool_v2.1"));
        assert!(!is_valid_exec_grant("exec:"));
        assert!(!is_valid_exec_grant("exec:../evil"));
        assert!(!is_valid_exec_grant("exec:/bin/sh"));
        assert!(!is_valid_exec_grant("exec:a b"));
        assert!(!is_valid_exec_grant("exec:C:\\tool"));
        assert!(!is_valid_exec_grant("npm")); // missing prefix
    }

    #[test]
    fn exec_grant_matches_bin_exactly() {
        let g = grants(&["exec:npm"]);
        assert!(exec_grant_allows(&g, "npm"));
        assert!(!exec_grant_allows(&g, "npm2"));
        assert!(!exec_grant_allows(&g, "./npm"));
        assert!(!exec_grant_allows(&[], "npm"));
    }

    #[test]
    fn gate_errors_name_plugin_and_missing_grant() {
        let g = grants(&["storage"]);
        let error = require_network_grant(&g, "usage-stats", "127.0.0.1", Some(7680)).unwrap_err();
        assert!(error.contains("usage-stats"), "{error}");
        assert!(error.contains("127.0.0.1:7680"), "{error}");

        let error = require_exec_grant(&g, "usage-stats", "npm").unwrap_err();
        assert!(error.contains("usage-stats"), "{error}");
        assert!(error.contains("exec:npm"), "{error}");

        let error = require_enabled("usage-stats", false).unwrap_err();
        assert!(error.contains("usage-stats"), "{error}");
        assert!(error.contains("disabled"), "{error}");
        assert!(require_enabled("usage-stats", true).is_ok());
    }

    #[test]
    fn truncate_output_caps_at_64kb() {
        let small = b"hello";
        assert_eq!(truncate_output(small), "hello");
        let big = vec![b'a'; MAX_OUTPUT_BYTES + 10];
        assert_eq!(truncate_output(&big).len(), MAX_OUTPUT_BYTES);
    }
    #[test]
    fn lifecycle_defaults_to_detached() {
        // Default must stay detached: usage-stats' tokentracker service
        // relies on fire-and-forget spawns that outlive the host.
        assert_eq!(parse_lifecycle("p", None).unwrap(), Lifecycle::Detached);
        assert_eq!(
            parse_lifecycle("p", Some("detached")).unwrap(),
            Lifecycle::Detached
        );
        assert_eq!(
            parse_lifecycle("p", Some("plugin")).unwrap(),
            Lifecycle::Plugin
        );
    }

    #[test]
    fn lifecycle_rejects_unknown_values() {
        let error = parse_lifecycle("usage-stats", Some("forever")).unwrap_err();
        assert!(error.contains("usage-stats"), "{error}");
        assert!(error.contains("forever"), "{error}");
    }

    // One test for the whole registry: kill_all drains every plugin's entry,
    // so splitting these across tests would race under parallel test runs.
    #[tokio::test]
    async fn tracked_children_kill_semantics() {
        register_tracked_child("ccgui-test-lifecycle-a", spawn_test_sleeper());
        register_tracked_child("ccgui-test-lifecycle-a", spawn_test_sleeper());
        register_tracked_child("ccgui-test-lifecycle-b", spawn_test_sleeper());

        // Kills every child of the named plugin and reports the count.
        assert_eq!(kill_tracked_children("ccgui-test-lifecycle-a"), 2);
        // Registry entry is cleared; a second kill finds nothing.
        assert_eq!(kill_tracked_children("ccgui-test-lifecycle-a"), 0);
        // A plugin can never reach another plugin's children.
        assert!(tracked_children()
            .lock()
            .contains_key("ccgui-test-lifecycle-b"));
        assert_eq!(kill_tracked_children("ccgui-test-lifecycle-b"), 1);
        // Plugin that never spawned: nothing to kill, no error.
        assert_eq!(kill_tracked_children("ccgui-test-lifecycle-none"), 0);
        assert!(tracked_children().lock().is_empty());

        // kill_all (app-exit hook) drains every plugin's children at once.
        register_tracked_child("ccgui-test-lifecycle-x", spawn_test_sleeper());
        register_tracked_child("ccgui-test-lifecycle-y", spawn_test_sleeper());
        kill_all_tracked_children();
        assert!(tracked_children().lock().is_empty());
    }

    #[tokio::test]
    async fn plugin_exec_kill_requires_an_installed_record() {
        // Cleanup needs no exec: grant, but the plugin must exist — a random
        // id can never be in plugins.json.
        let error = plugin_exec_kill("ccgui-test-never-installed".to_string())
            .await
            .unwrap_err();
        assert!(error.contains("ccgui-test-never-installed"), "{error}");
    }
}
