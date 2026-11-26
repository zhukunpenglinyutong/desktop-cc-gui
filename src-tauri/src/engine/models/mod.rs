//! Per-engine model catalog for the composer's model picker.
//!
//! Only the pi family (pi/omp) exposes a machine-readable catalog. Probe
//! chain, first success wins:
//!   1. `<bin> models --json` — richest shape (selector, display name,
//!      context window); omp-native, older pi may lack it.
//!   2. `<bin> --list-models --no-extensions` — fixed-width table
//!      `provider  model  ctx  max-out  thinking  images`; extensions slow
//!      the probe by ~10x (upstream evidence), so skip their boot.
//!   3. `<bin> --list-models` — bare retry for binaries that reject the flag.
//! Codex ships its catalog inside the binary: `codex debug models` renders
//! it as JSON (the picker's entries are the ones with `visibility: "list"`).
//! Fallback when the probe fails (old binary): the CLI's own config names
//! the active model — top-level `model = "…"` in $CODEX_HOME/config.toml.
//! Claude runs entirely on the CLI's own configuration: the catalog is
//! the built-in aliases `claude --model` resolves (the /model menu's
//! entries) in menu order; the configured default from ~/.claude/settings.json is named
//! in the "default" row's subtitle, and each alias names the concrete model
//! id the CLI binary's embedded registry resolves it to. No
//! relay probe: the /model menu is built into the CLI binary. The app's
//! provider channels never feed
//! it. Kimi keeps its own
//! provider registry — `kimi provider list --json` is the authoritative
//! selector catalog (and, offline, the `[models.*]` tables in
//! $KIMI_CODE_HOME/config.toml — `kimi -m` takes aliases, not relay ids).
//! Grok's `-m` resolves `[model.<alias>]` sections (or
//! built-in names), never relay API ids, so its catalog is the `[model.*]`
//! tables in $GROK_HOME/config.toml with `[models].default` leading — the
//! same entries the CLI's own /model menu lists. The CLI-maintained
//! models_cache.json holds the relay's /v1/models ids, which `-m` cannot
//! resolve, so it is deliberately not a source. agy is `agy models` TSV
//! (`id<TAB>name`). OpenCode lists `provider/model` ids via `opencode
//! models` (ANSI table), with a generated fallback catalog when the probe
//! cannot run. Qoder has no list subcommand: its catalog only exists on the
//! ACP session/new result, so a temp-dir handshake probes it on demand and
//! caches the last success. Remaining engines are filled by the frontend
//! from the configured provider channels instead.

mod agy;
mod claude;
mod codebuddy;
mod codex;
mod grok;
mod kimi;
mod minimax;
mod opencode;
mod pi;
mod qoder;
mod wsl;

/// Claude launch-time model resolution: picker alias → the custom id its
/// ANTHROPIC_DEFAULT_<FAMILY>_MODEL override maps to (pass-through when
/// unmapped), so the request carries the model the picker displayed even
/// when the CLI build skips its own env remap.
pub(crate) fn resolve_claude_launch_model(selector: &str) -> String {
    claude::resolve_launch_model(selector)
}

pub(crate) fn claude_comparison_model(
    selector: &str,
    bin: &str,
    channel_env: Option<&std::collections::HashMap<String, String>>,
    workspace: &std::path::Path,
    remote: bool,
) -> Option<String> {
    let path = if remote {
        None
    } else {
        super::resolve::find_cli_binary("claude", Some(bin))
    };
    claude::comparison_model(selector, path.as_deref(), channel_env, workspace, remote)
}

use serde::Serialize;
use std::future::Future;

/// Catalog probe budget; with extension boot skipped the call lands in ~1s,
/// this is pure slow-machine headroom.
const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum ProbeError {
    /// Subprocess exceeded `PROBE_TIMEOUT` and was terminated: callers must NOT
    /// chain fallback probes back-to-back, which multiplies startup contention.
    Timeout(String),
    /// Spawn error, non-zero exit, or unparseable output (e.g. an older binary
    /// that lacks a newer subcommand/flag): safe to try a compatibility fallback.
    Failed(String),
}

impl ProbeError {
    pub(super) fn into_message(self) -> String {
        match self {
            Self::Timeout(msg) | Self::Failed(msg) => msg,
        }
    }
}

/// Run one catalog probe (`bin args…`) under the shared budget; stdout as
/// lossy UTF-8 on success. `probe` names the subcommand in error messages
/// ("models --json").
pub(super) async fn run_probe_detailed(
    bin: &str,
    args: &[&str],
    probe: &str,
) -> Result<String, ProbeError> {
    let mut cmd = super::command_for_binary(bin);
    for arg in args {
        cmd.arg(arg);
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // A timed-out probe must not outlive its budget: kill_on_drop kills the
        // direct child handle, and the job/process-group guard below sweeps any
        // grandchildren (Windows `.cmd` shims / Bun native workers).
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    #[cfg(windows)]
    super::hide_console(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| ProbeError::Failed(format!("failed to run {bin}: {e}")))?;
    let pid = child.id();
    #[cfg(windows)]
    let tree_guard = super::job::assign_kill_on_close(&child);
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let stdout_task = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut buf = Vec::new();
        if let Some(mut s) = stdout_pipe {
            let _ = s.read_to_end(&mut buf).await;
        }
        buf
    });
    let stderr_task = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut buf = Vec::new();
        if let Some(mut s) = stderr_pipe {
            let _ = s.read_to_end(&mut buf).await;
        }
        buf
    });
    let status = match tokio::time::timeout(PROBE_TIMEOUT, child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(e)) => return Err(ProbeError::Failed(format!("failed to run {bin}: {e}"))),
        Err(_) => {
            // Tear down the whole process tree BEFORE dropping `child`
            // (whose `kill_on_drop` terminates only the direct child): on
            // Windows without a Job Object, `taskkill /T` must walk the tree
            // while the root pid is still alive (see registry::kill_process_group).
            #[cfg(unix)]
            if let Some(pid) = pid {
                super::kill_process_group(pid);
            }
            #[cfg(windows)]
            {
                let had_job = tree_guard.is_some();
                drop(tree_guard);
                if !had_job {
                    if let Some(pid) = pid {
                        let _ = tokio::task::spawn_blocking(move || super::kill_process_group(pid))
                            .await;
                    }
                }
            }
            let _ = child.start_kill();
            stdout_task.abort();
            stderr_task.abort();
            return Err(ProbeError::Timeout(format!("{bin} {probe} timed out")));
        }
    };
    let stdout_bytes = stdout_task.await.unwrap_or_default();
    let _ = stderr_task.await;
    if !status.success() {
        return Err(ProbeError::Failed(format!(
            "{bin} {probe} exited with {status}"
        )));
    }
    Ok(String::from_utf8_lossy(&stdout_bytes).to_string())
}


pub(super) async fn run_probe(bin: &str, args: &[&str], probe: &str) -> Result<String, String> {
    run_probe_detailed(bin, args, probe)
        .await
        .map_err(ProbeError::into_message)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineModel {
    /// Selector accepted by `--model` ("provider/model").
    pub id: String,
    /// Display name when the catalog carries one (JSON probe only).
    pub name: Option<String>,
    /// Secondary line under the name (e.g. "Custom Opus model"), mirroring
    /// the CLI's own /model menu descriptions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub provider: String,
    /// Context window parsed from the table ("131.1K" -> 131_100).
    pub context_window: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineCatalog {
    pub models: Vec<EngineModel>,
    /// True when `models` is exactly what the CLI's model flag resolves
    /// (config/registry/binary-derived). A stored pick outside it cannot
    /// run, so the frontend resets it to the leading entry.
    pub authoritative: bool,
    /// True when the catalog was produced for a remote workspace (WSL
    /// distro): the frontend must NOT merge local provider/custom models
    /// into it — only the distro CLI's own list is runnable there.
    #[serde(default)]
    pub remote: bool,
}

impl EngineCatalog {
    fn authoritative(models: Vec<EngineModel>) -> Self {
        Self {
            models,
            authoritative: true,
            remote: false,
        }
    }

    /// Catalog sourced from inside a remote workspace; even when empty it
    /// suppresses the frontend's local-config fallback.
    fn authoritative_remote(models: Vec<EngineModel>) -> Self {
        Self {
            models,
            authoritative: true,
            remote: true,
        }
    }
}

/// Process-wide cache for local engine model catalogs: switching to another
/// local workspace triggers a workspace-context probe, and without this cache
/// every unseen local workspace would respawn every enabled CLI binary at once.
/// Engines without a config-file fingerprint keep a 2-minute TTL so manual
/// config edits surface promptly; pi/omp carry a models-file fingerprint that
/// invalidates immediately on edit and therefore hold a 10-minute TTL.
const LOCAL_CATALOG_TTL: std::time::Duration = std::time::Duration::from_secs(120);
const PI_FAMILY_LOCAL_CATALOG_TTL: std::time::Duration = std::time::Duration::from_secs(600);
/// Cooldown after a probe timeout/failure: prevents back-to-back callers from
/// spawning another wave of probes while the CLI / SQLite cache is contended.
const LOCAL_CATALOG_FAILURE_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(60);
type ConfigStamp = Option<(u64, Option<std::time::SystemTime>)>;

struct CachedLocalCatalog {
    cache_key: String,
    config_stamp: ConfigStamp,
    catalog: EngineCatalog,
    cached_at: std::time::Instant,
    ttl: std::time::Duration,
    from_probe: bool,
}

static LOCAL_CATALOG_CACHE: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, CachedLocalCatalog>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

/// Per-engine single-flight lock: concurrent `list_engine_models` / plugin
/// catalog calls on a cold or expired cache coalesce onto one CLI spawn instead
/// of launching N parallel `omp.exe` processes that fight over SQLite locks.
static INFLIGHT_LOCAL_PROBES: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<tokio::sync::Mutex<()>>>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

fn engine_probe_lock(engine: &str) -> std::sync::Arc<tokio::sync::Mutex<()>> {
    let mut guard = INFLIGHT_LOCAL_PROBES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    guard
        .entry(engine.to_string())
        .or_insert_with(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

fn local_catalog_cache_key(settings: &crate::settings::AppSettings, engine: &str, bin: &str) -> String {
    if engine == "dsh" {
        format!("{bin}@{}", crate::dsh_host::configured_origin(settings))
    } else {
        bin.to_string()
    }
}

fn engine_config_stamp(engine: &str) -> ConfigStamp {
    let file = match engine {
        "pi" => "models.json",
        "omp" => "models.yml",
        _ => return None,
    };
    let path = super::pi_family_auth::agent_dir(engine).ok()?.join(file);
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.len(), meta.modified().ok()))
}

fn read_cached_local_catalog(engine: &str, cache_key: &str) -> Option<EngineCatalog> {
    let stamp = engine_config_stamp(engine);
    let guard = LOCAL_CATALOG_CACHE.lock().ok()?;
    let entry = guard.get(engine)?;
    if entry.cache_key == cache_key
        && entry.config_stamp == stamp
        && entry.cached_at.elapsed() < entry.ttl
    {
        Some(entry.catalog.clone())
    } else {
        None
    }
}

/// The last catalog a real probe produced for this binary and config, kept
/// past its TTL: a timed-out re-probe serves it instead of blanking the picker.
fn read_last_good_local_catalog(engine: &str, cache_key: &str) -> Option<EngineCatalog> {
    let stamp = engine_config_stamp(engine);
    let guard = LOCAL_CATALOG_CACHE.lock().ok()?;
    let entry = guard.get(engine)?;
    if entry.from_probe && entry.cache_key == cache_key && entry.config_stamp == stamp {
        Some(entry.catalog.clone())
    } else {
        None
    }
}

fn write_cached_local_catalog_with_meta(
    engine: &str,
    cache_key: String,
    config_stamp: ConfigStamp,
    catalog: &EngineCatalog,
    ttl: std::time::Duration,
    from_probe: bool,
) {
    if let Ok(mut guard) = LOCAL_CATALOG_CACHE.lock() {
        guard.insert(
            engine.to_string(),
            CachedLocalCatalog {
                cache_key,
                config_stamp,
                catalog: catalog.clone(),
                cached_at: std::time::Instant::now(),
                ttl,
                from_probe,
            },
        );
    }
}

#[cfg(test)]
fn write_cached_local_catalog(engine: &str, cache_key: String, catalog: &EngineCatalog) {
    let stamp = engine_config_stamp(engine);
    write_cached_local_catalog_with_meta(engine, cache_key, stamp, catalog, LOCAL_CATALOG_TTL, true);
}

/// One local catalog probe outcome: `ttl: None` leaves the cache untouched
/// (a fallback catalog must not pin itself; the next call retries the CLI).
struct ProbedCatalog {
    catalog: EngineCatalog,
    ttl: Option<std::time::Duration>,
    from_probe: bool,
}

async fn resolve_local_catalog_with<F, Fut>(
    engine: &str,
    cache_key: &str,
    force: bool,
    probe: F,
) -> Result<EngineCatalog, String>
where
    F: FnOnce(Option<EngineCatalog>) -> Fut,
    Fut: Future<Output = Result<ProbedCatalog, String>>,
{
    if !force {
        if let Some(cached) = read_cached_local_catalog(engine, cache_key) {
            return Ok(cached);
        }
    }
    let probe_lock = engine_probe_lock(engine);
    let _probe_guard = probe_lock.lock().await;
    if !force {
        if let Some(cached) = read_cached_local_catalog(engine, cache_key) {
            return Ok(cached);
        }
    }
    // Capture the config fingerprint BEFORE running the probe: if the user
    // saves models.yml/models.json while the probe is in flight, tagging the
    // stale result with the pre-probe stamp ensures the next read sees the
    // mismatch and immediately re-probes instead of caching stale data.
    let pre_probe_stamp = engine_config_stamp(engine);
    let last_good = read_last_good_local_catalog(engine, cache_key);
    let had_last_good = last_good.is_some();
    let probed = probe(last_good).await?;
    if let Some(ttl) = probed.ttl {
        write_cached_local_catalog_with_meta(
            engine,
            cache_key.to_string(),
            pre_probe_stamp,
            &probed.catalog,
            ttl,
            probed.from_probe || had_last_good,
        );
    }
    Ok(probed.catalog)
}
#[tauri::command]
pub async fn list_engine_models(
    state: tauri::State<'_, crate::AppState>,
    engine: String,
    workspace: Option<String>,
    force: Option<bool>,
) -> Result<EngineCatalog, String> {
    // 停用 (设置 → CLI 管理) gates the catalog too: every branch below either
    // runs the engine's CLI here or asks the distro to (`opencode models`,
    // `mcode acp`, …), and a user who turned the engine off must not see it
    // launched — the chat picker and the plugin agent catalog already hide
    // disabled engines, so no consumer needs this answer. Same contract as the
    // send path (config::ensure_engine_enabled).
    crate::config::ensure_engine_enabled(&engine)?;
    // WSL 工作区:模型目录必须来自发行版内的 CLI(探针 bin),不是本机。
    if let Some(ws) = workspace.as_deref() {
        if let Some(transport) =
            crate::engine::wsl_transport::transport_for_workspace(&state.db, ws)
        {
            match engine.as_str() {
                "pi" | "omp" => {
                    return Ok(wsl::pi_family_catalog_remote(engine.as_str(), &transport).await);
                }
                "codex" => {
                    return Ok(wsl::codex_catalog_remote(&transport).await);
                }
                "kimi" => {
                    return Ok(wsl::kimi_catalog_remote(&transport).await);
                }
                "claude" => {
                    return Ok(wsl::claude_catalog_remote(&transport).await);
                }
                // 其余引擎暂无远程 catalog 命令形态(grok/dsh/agy 等
                // 是本机推导):空目录 + remote 旗标,前端不掺本机配置 ——
                // 发行版里的 CLI 用自己配置里的默认模型。
                _ => return Ok(EngineCatalog::authoritative_remote(Vec::new())),
            }
        }
    }
    // Settings read + binary resolution touch the filesystem: keep them off
    // the async worker.
    let (bin_key, cache_key) = {
        let engine_for_bin = engine.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let settings = crate::settings::read_settings().unwrap_or_default();
            let bin = super::engine_bin(&settings, &engine_for_bin);
            let key = local_catalog_cache_key(&settings, &engine_for_bin, &bin);
            (bin, key)
        })
        .await
        .map_err(|e| format!("engine bin lookup failed: {e}"))?
    };
    let force = force.unwrap_or(false);
    let engine_ref = engine.as_str();
    let bin_ref = bin_key.as_str();
    // Non-pi engines cache only an authoritative/probed result for the base
    // TTL; a fallback catalog is returned uncached so the next call retries.
    let cached = |(catalog, cacheable): (EngineCatalog, bool)| ProbedCatalog {
        catalog,
        ttl: cacheable.then_some(LOCAL_CATALOG_TTL),
        from_probe: cacheable,
    };
    let authoritative = |catalog: EngineCatalog| {
        let cacheable = catalog.authoritative;
        cached((catalog, cacheable))
    };
    resolve_local_catalog_with(engine_ref, &cache_key, force, |last_good| async move {
        Ok(match engine_ref {
            "codex" => cached(codex_catalog().await),
            "kimi" => cached(kimi_catalog().await),
            "grok" => cached((grok_catalog(), true)),
            "claude" => cached((claude_catalog(), true)),
            // pi/omp invalidate on a models-file edit (config stamp), so a
            // probed catalog holds the long TTL; a failed or timed-out probe
            // is cached for a short cooldown so callers do not respawn the
            // CLI back-to-back while it is contended.
            "pi" | "omp" => {
                let (catalog, probed) = pi_family_catalog(engine_ref, bin_ref, last_good).await;
                ProbedCatalog {
                    catalog,
                    ttl: Some(if probed {
                        PI_FAMILY_LOCAL_CATALOG_TTL
                    } else {
                        LOCAL_CATALOG_FAILURE_COOLDOWN
                    }),
                    from_probe: probed,
                }
            }
            "dsh" => cached((dsh_catalog().await?, true)),
            "agy" => authoritative(agy_catalog().await),
            "opencode" => cached(opencode_catalog().await),
            "qoder" => cached((qoder_catalog("qoder").await?, true)),
            "qoder-cn" => cached((qoder_catalog("qoder-cn").await?, true)),
            // MiniMax's catalog comes from a live `mcode acp` probe (the /model
            // menu only exists on the session handshake), cached last-success;
            // a failed probe falls back to the static stock list.
            "minimax" => authoritative(minimax::minimax_catalog(bin_ref).await),
            "codebuddy" => authoritative(codebuddy::codebuddy_catalog(bin_ref).await),
            // Unknown engine: no CLI-sourced catalog — the frontend fills the
            // picker from the configured provider channels.
            _ => cached((EngineCatalog::authoritative(Vec::new()), false)),
        })
    })
    .await
}

/// DSH has no CLI-side catalog: the model list lives on the running host
/// (`session/modelCatalog` RPC — 0.1.2 removed `llm.models`), grouped by
/// provider with `default` carrying the host's current model. Never spawns
/// the host — a down host is an error so the frontend keeps whatever catalog
/// it already has instead of blanking the picker.
async fn agy_catalog() -> EngineCatalog {
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, "agy");
    agy::agy_catalog(&bin).await
}

async fn opencode_catalog() -> (EngineCatalog, bool) {
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, "opencode");
    opencode::opencode_catalog(&bin).await
}

async fn qoder_catalog(engine: &'static str) -> Result<EngineCatalog, String> {
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, engine);
    qoder::qoder_catalog(engine, &bin).await
}

async fn dsh_catalog() -> Result<EngineCatalog, String> {
    let settings = crate::settings::read_settings().unwrap_or_default();
    let origin = crate::dsh_host::configured_origin(&settings);
    let catalog =
        crate::dsh_host::host_call(&origin, "session/modelCatalog", serde_json::json!({}))
            .await
            .map_err(|_| {
                format!("DSH host 未运行（{origin}）。在设置 → DeepSeek Harness 里启动后再试。")
            })?;
    Ok(EngineCatalog::authoritative(flatten_llm_models(
        &catalog,
        catalog.get("default"),
    )))
}

/// `session/modelCatalog` value `{groups: [{id, name, models: [{id, name,
/// description, default}]}], default: {provider, model}}` → flat catalog
/// entries with `provider/model` selector ids. The host's current model
/// (`default`) or the group-marked default leads.
fn flatten_llm_models(
    catalog: &serde_json::Value,
    describe: Option<&serde_json::Value>,
) -> Vec<EngineModel> {
    let current = describe.and_then(|value| {
        let provider = value.get("provider")?.as_str()?.trim();
        let model = value.get("model")?.as_str()?.trim();
        if provider.is_empty() || model.is_empty() {
            return None;
        }
        Some(format!("{provider}/{model}"))
    });
    let mut models = Vec::new();
    let mut default_id = current;
    for group in catalog
        .get("groups")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
    {
        let provider = group
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown")
            .trim();
        for model in group
            .get("models")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
        {
            let model_id = model
                .get("id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .trim();
            if provider.is_empty() || model_id.is_empty() {
                continue;
            }
            let id = format!("{provider}/{model_id}");
            if default_id.is_none()
                && model.get("default").and_then(serde_json::Value::as_bool) == Some(true)
            {
                default_id = Some(id.clone());
            }
            models.push(EngineModel {
                id,
                name: model
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|name| !name.is_empty() && *name != model_id)
                    .map(str::to_string),
                description: model
                    .get("description")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .map(str::to_string),
                provider: provider.to_string(),
                context_window: None,
            });
        }
    }
    // The frontend auto-selects the leading entry when nothing is pinned:
    // make it the host's current (or the catalog's default) model.
    if let Some(default_id) = default_id {
        if let Some(index) = models.iter().position(|model| model.id == default_id) {
            models.rotate_left(index);
        }
    }
    models
}

async fn codex_catalog() -> (EngineCatalog, bool) {
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, "codex");
    if let Ok(mut models) = codex::run_codex_debug_models(&bin).await {
        if !models.is_empty() {
            let configured = codex::codex_config_model();
            // The explicit CLI setting overrides its catalog default (e.g.
            // a configured 1M window). max_context_window alone is capability,
            // not the window this request actually uses.
            if let Some(window) = configured.as_ref().and_then(|model| model.context_window) {
                for model in &mut models {
                    model.context_window = Some(window);
                }
            }
            return (
                EngineCatalog::authoritative(with_default_first(models, configured)),
                true,
            );
        }
    }
    (
        EngineCatalog::authoritative(codex::codex_config_model().into_iter().collect()),
        false,
    )
}

async fn kimi_catalog() -> (EngineCatalog, bool) {
    // The CLI's own registry is ground truth for `-m` aliases; the
    // config's [models.*] tables are the offline equivalent (same alias
    // semantics), then the CLI's configured default as a single-entry
    // fallback. No relay probe: `kimi -m` takes aliases, not raw API ids.
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, "kimi");
    if let Ok(models) = kimi::run_kimi_provider_list(&bin).await {
        if !models.is_empty() {
            return (
                EngineCatalog::authoritative(with_default_first(
                    models,
                    kimi::kimi_default_model(),
                )),
                true,
            );
        }
    }
    let local = kimi::kimi_local_models();
    if !local.is_empty() {
        return (EngineCatalog::authoritative(local), false);
    }
    (
        EngineCatalog::authoritative(kimi::kimi_default_model().into_iter().collect()),
        false,
    )
}

fn grok_catalog() -> EngineCatalog {
    // No provider-channel probe here: `grok -m` resolves
    // `[model.<alias>]` sections or built-in names only, so relay API ids
    // would list entries the CLI cannot run. The frontend already merges
    // the app channel's configured model into the picker.
    EngineCatalog::authoritative(grok::grok_local_models())
}

fn claude_catalog() -> EngineCatalog {
    // CLI-sourced, and every entry is something `claude --model`
    // resolves — authoritative, so the frontend resets stale stored
    // picks (e.g. leftovers from the removed channel probe). The binary
    // path feeds the embedded-registry read (alias → concrete model id).
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, "claude");
    let bin_path = super::resolve::find_cli_binary("claude", Some(&bin));
    EngineCatalog::authoritative(claude::claude_models(bin_path.as_deref()))
}

enum PiCatalogStage {
    ModelsJson,
    ListModelsNoExtensions,
    ListModelsBare,
}

async fn pi_family_catalog_with<F, Fut>(
    configured: Vec<EngineModel>,
    last_good: Option<EngineCatalog>,
    mut run_stage: F,
) -> (EngineCatalog, bool)
where
    F: FnMut(PiCatalogStage) -> Fut,
    Fut: Future<Output = Result<Vec<EngineModel>, ProbeError>>,
{
    // Fresh binaries skip extension boot; old ones fall back to a bare run.
    for stage in [
        PiCatalogStage::ModelsJson,
        PiCatalogStage::ListModelsNoExtensions,
        PiCatalogStage::ListModelsBare,
    ] {
        match run_stage(stage).await {
            Ok(models) if !models.is_empty() => {
                return (
                    EngineCatalog::authoritative(pi::merge_configured_models(models, configured)),
                    true,
                );
            }
            // A timeout means the binary is slow/contended (e.g. cold startup or
            // SQLite lock wait), NOT that it lacks the subcommand. Chaining two
            // more `--list-models` spawns immediately would triple the storm.
            Err(ProbeError::Timeout(_)) => {
                return (
                    last_good.unwrap_or_else(|| EngineCatalog::authoritative(configured)),
                    false,
                );
            }
            Ok(_) | Err(ProbeError::Failed(_)) => {}
        }
    }
    // A missing/broken CLI is not an error here: the picker falls back to
    // provider-config models.
    (
        last_good.unwrap_or_else(|| EngineCatalog::authoritative(configured)),
        false,
    )
}

async fn pi_family_catalog(
    engine: &str,
    bin: &str,
    last_good: Option<EngineCatalog>,
) -> (EngineCatalog, bool) {
    let configured = pi::configured_models(engine).unwrap_or_default();
    pi_family_catalog_with(configured, last_good, |stage| async move {
        match stage {
            PiCatalogStage::ModelsJson => pi::run_models_json(bin).await,
            PiCatalogStage::ListModelsNoExtensions => {
                pi::run_list_models(bin, &["--no-extensions"]).await
            }
            PiCatalogStage::ListModelsBare => pi::run_list_models(bin, &[]).await,
        }
    })
    .await
}

/// Top-level `key = "…"` only: stop at the first `[table]` header so a
/// same-named key inside a table never leaks in. Handles both TOML string
/// quote styles and trailing comments; a full TOML parse is overkill for
/// one scalar.
fn parse_top_level_toml_string(content: &str, key: &str) -> Option<String> {
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            break;
        }
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };
        if name.trim() != key {
            continue;
        }
        let value = value.trim_start();
        for quote in ['"', '\''] {
            if let Some(rest) = value.strip_prefix(quote) {
                if let Some(end) = rest.find(quote) {
                    let model = rest[..end].trim();
                    if !model.is_empty() {
                        return Some(model.to_string());
                    }
                }
            }
        }
    }
    None
}

/// Single-entry catalog from one top-level TOML string key in
/// `<home>/config.toml` (codex `model`, kimi `default_model`).
pub(super) fn config_toml_model(
    home: &std::path::Path,
    key: &str,
    provider: &str,
) -> Option<EngineModel> {
    let content = std::fs::read_to_string(home.join("config.toml")).ok()?;
    let id = parse_top_level_toml_string(&content, key)?;
    Some(EngineModel {
        id,
        name: None,
        description: None,
        provider: provider.to_string(),
        context_window: None,
    })
}

/// Which entry keys feed each EngineModel field — the alias-table skeleton
/// is shared by grok and kimi, only these key names differ.
pub(super) struct AliasFields {
    /// First string-valued key wins; a label equal to the alias is dropped.
    pub name_keys: &'static [&'static str],
    pub context_keys: &'static [&'static str],
    /// Per-entry provider override; absent → the engine default.
    pub provider_key: Option<&'static str>,
}

/// `[<table>."<alias>"]` TOML tables → catalog entries, sorted by alias.
/// Callers extract the default first (their key shapes differ) and promote
/// it with `promote_default`.
pub(super) fn alias_table_catalog(
    root: &toml::Value,
    table: &str,
    default_provider: &str,
    fields: &AliasFields,
) -> Vec<EngineModel> {
    let mut models: Vec<EngineModel> = root
        .get(table)
        .and_then(toml::Value::as_table)
        .map(|table| {
            table
                .iter()
                .map(|(alias, entry)| {
                    let name = fields
                        .name_keys
                        .iter()
                        .find_map(|key| entry.get(key).and_then(toml::Value::as_str))
                        .map(str::trim)
                        .filter(|n| !n.is_empty() && *n != alias.as_str())
                        .map(str::to_string);
                    let provider = fields
                        .provider_key
                        .and_then(|key| entry.get(key).and_then(toml::Value::as_str))
                        .unwrap_or(default_provider)
                        .to_string();
                    let context_window = fields
                        .context_keys
                        .iter()
                        .find_map(|key| entry.get(key).and_then(toml::Value::as_integer))
                        .and_then(|n| u64::try_from(n).ok());
                    EngineModel {
                        id: alias.clone(),
                        name,
                        description: None,
                        provider,
                        context_window,
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models
}

/// Move the entry matching `default` to the front (in-place no-op when the
/// default is unknown or unlisted).
pub(super) fn promote_default(models: &mut Vec<EngineModel>, default: Option<&str>) {
    if let Some(default) = default {
        if let Some(index) = models.iter().position(|m| m.id == default) {
            let entry = models.remove(index);
            models.insert(0, entry);
        }
    }
}

/// The frontend auto-selects the first catalog entry when the user has no
/// stored pick, so the CLI's effective default leads: moved to the front
/// when already listed, prepended when the catalog doesn't name it.
pub(super) fn with_default_first(
    models: Vec<EngineModel>,
    default: Option<EngineModel>,
) -> Vec<EngineModel> {
    let Some(default) = default else {
        return models;
    };
    let mut models = models;
    match models.iter().position(|m| m.id == default.id) {
        Some(0) => models,
        Some(i) => {
            let entry = models.remove(i);
            models.insert(0, entry);
            models
        }
        None => {
            models.insert(0, default);
            models
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn top_level_model_stops_at_first_table() {
        let toml = "\
model_provider = \"OpenAI\"
model = \"gpt-5.6-sol\"   # active
review_model = 'gpt-5.6-mini'

[model_providers.OpenAI]
model = \"must-not-leak\"
";
        assert_eq!(
            parse_top_level_toml_string(toml, "model"),
            Some("gpt-5.6-sol".to_string())
        );
        assert_eq!(
            parse_top_level_toml_string("[features]\nmodel = \"x\"", "model"),
            None
        );
        assert_eq!(parse_top_level_toml_string("model = ''", "model"), None);
    }

    #[test]
    fn default_entry_leads_the_catalog() {
        let listed = vec![
            EngineModel {
                id: "a".to_string(),
                name: None,
                description: None,
                provider: "p".to_string(),
                context_window: None,
            },
            EngineModel {
                id: "b".to_string(),
                name: None,
                description: None,
                provider: "p".to_string(),
                context_window: None,
            },
        ];
        let default = || EngineModel {
            id: "b".to_string(),
            name: None,
            description: None,
            provider: "p".to_string(),
            context_window: None,
        };
        let ids: Vec<String> = with_default_first(listed.clone(), Some(default()))
            .into_iter()
            .map(|m| m.id)
            .collect();
        assert_eq!(ids, vec!["b", "a"]);
        // Absent from the catalog: prepended, not dropped.
        let absent = EngineModel {
            id: "z".to_string(),
            name: None,
            description: None,
            provider: "p".to_string(),
            context_window: None,
        };
        let ids: Vec<String> = with_default_first(listed.clone(), Some(absent))
            .into_iter()
            .map(|m| m.id)
            .collect();
        assert_eq!(ids, vec!["z", "a", "b"]);
        // No default known: order untouched.
        let ids: Vec<String> = with_default_first(listed, None)
            .into_iter()
            .map(|m| m.id)
            .collect();
        assert_eq!(ids, vec!["a", "b"]);
    }

    #[test]
    fn local_catalog_cache_reuses_within_ttl_and_invalidates_on_bin_change() {
        let engine = "__test_local_cache_engine__";
        let catalog = EngineCatalog::authoritative(vec![EngineModel {
            id: "m1".to_string(),
            name: None,
            description: None,
            provider: "p".to_string(),
            context_window: None,
        }]);
        write_cached_local_catalog(engine, "/bin/v1".to_string(), &catalog);
        let hit = read_cached_local_catalog(engine, "/bin/v1").expect("cache hit");
        assert_eq!(hit.models.len(), 1);
        assert_eq!(hit.models[0].id, "m1");
        assert!(read_cached_local_catalog(engine, "/bin/v2").is_none());
    }

    #[tokio::test]
    async fn local_catalog_single_flight_coalesces_concurrent_misses() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;
        let engine = "__test_single_flight_omp__";
        let calls = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(tokio::sync::Barrier::new(4));

        let mut handles = Vec::new();
        for _ in 0..4 {
            let calls = Arc::clone(&calls);
            let barrier = Arc::clone(&barrier);
            handles.push(tokio::spawn(async move {
                barrier.wait().await;
                resolve_local_catalog_with(engine, "/bin/omp", false, |_last_good| async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(std::time::Duration::from_millis(40)).await;
                    Ok(ProbedCatalog {
                        catalog: EngineCatalog::authoritative(vec![EngineModel {
                            id: "p/m1".to_string(),
                            name: None,
                            description: None,
                            provider: "p".to_string(),
                            context_window: None,
                        }]),
                        ttl: Some(LOCAL_CATALOG_TTL),
                        from_probe: true,
                    })
                })
                .await
                .unwrap()
            }));
        }
        for handle in handles {
            let catalog = handle.await.unwrap();
            assert_eq!(catalog.models.len(), 1);
            assert_eq!(catalog.models[0].id, "p/m1");
        }
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "concurrent misses must coalesce into a single CLI probe"
        );
    }

    #[tokio::test]
    async fn pi_family_catalog_stops_immediately_on_timeout_and_preserves_last_good() {
        let mut stages_called = Vec::new();
        let last_good = EngineCatalog::authoritative(vec![EngineModel {
            id: "cached/model".to_string(),
            name: None,
            description: None,
            provider: "cached".to_string(),
            context_window: None,
        }]);
        let (catalog, probed) = pi_family_catalog_with(Vec::new(), Some(last_good), |stage| {
            let name = match stage {
                PiCatalogStage::ModelsJson => "models-json",
                PiCatalogStage::ListModelsNoExtensions => "list-no-ext",
                PiCatalogStage::ListModelsBare => "list-bare",
            };
            stages_called.push(name);
            async move { Err(ProbeError::Timeout("omp models --json timed out".into())) }
        })
        .await;
        assert!(!probed);
        assert_eq!(
            stages_called,
            vec!["models-json"],
            "a timeout must not chain fallback --list-models spawns"
        );
        assert_eq!(catalog.models.len(), 1);
        assert_eq!(catalog.models[0].id, "cached/model");
    }

    #[tokio::test]
    async fn pi_family_catalog_falls_back_on_non_timeout_failure() {
        let mut stages_called = Vec::new();
        let (catalog, probed) = pi_family_catalog_with(Vec::new(), None, |stage| {
            let name = match stage {
                PiCatalogStage::ModelsJson => "models-json",
                PiCatalogStage::ListModelsNoExtensions => "list-no-ext",
                PiCatalogStage::ListModelsBare => "list-bare",
            };
            stages_called.push(name);
            async move {
                match stage {
                    PiCatalogStage::ModelsJson => {
                        Err(ProbeError::Failed("unknown subcommand models".into()))
                    }
                    PiCatalogStage::ListModelsNoExtensions => Ok(vec![EngineModel {
                        id: "legacy/m1".to_string(),
                        name: None,
                        description: None,
                        provider: "legacy".to_string(),
                        context_window: None,
                    }]),
                    PiCatalogStage::ListModelsBare => unreachable!("should have succeeded already"),
                }
            }
        })
        .await;
        assert!(probed);
        assert_eq!(stages_called, vec!["models-json", "list-no-ext"]);
        assert_eq!(catalog.models.len(), 1);
        assert_eq!(catalog.models[0].id, "legacy/m1");
    }

    #[test]
    fn pi_family_local_catalog_ttl_is_longer_than_unfingerprinted_engines() {
        assert_eq!(LOCAL_CATALOG_TTL, std::time::Duration::from_secs(120));
        assert_eq!(
            PI_FAMILY_LOCAL_CATALOG_TTL,
            std::time::Duration::from_secs(600)
        );
    }

    #[test]
    fn dsh_local_catalog_cache_key_tracks_configured_origin() {
        let mut settings = crate::settings::AppSettings::default();
        settings.dsh_host = Some("127.0.0.1".to_string());
        settings.dsh_port = Some(7777);
        let k1 = local_catalog_cache_key(&settings, "dsh", "dsh");
        settings.dsh_port = Some(8888);
        let k2 = local_catalog_cache_key(&settings, "dsh", "dsh");
        assert_ne!(k1, k2);
        assert_eq!(local_catalog_cache_key(&settings, "claude", "claude"), "claude");
    }
}
