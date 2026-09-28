//! Channel env injection, official-file editing, and safe retirement of old
//! file-materialization backups. Switches never materialize a new channel.
//!
//! Switching a channel stores the id in our config (`section.current`) and
//! applies process-scoped channel env/config to that send. Native CLI files
//! (`~/.claude/settings.json`, `~/.codex/config.toml`, …) stay the official
//! configuration: concurrent sessions of the same engine can run different
//! channels without clobbering each other, and `--resume` still finds history
//! in the CLI's real home.
//!
//! OpenCode and Qoder keep their native configuration and authentication;
//! these engines declare no file targets for channel switching.
//!
//! Legacy renderers identify old managed content before one-time restoration.
//! Unknown edits stop migration; the original and pre-migration files survive.

use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use toml_edit::{value, DocumentMut, Item, Table};

use crate::config::{DISABLED_PROVIDER_ID, LEGACY_LOCAL_CONFIG_TOML_ID, LOCAL_PROVIDER_ID};

/// Legacy writer retained only to build migration regression fixtures.
/// `provider` is `None` for the pseudo ids (官方配置 / 停用).
#[cfg(test)]
fn apply(engine: &str, id: &str, provider: Option<&Value>) -> Result<(), String> {
    if id == DISABLED_PROVIDER_ID {
        // 停用 gates sending only; the CLI's files stay as they are.
        return Ok(());
    }
    let targets = targets(engine);
    if id == LOCAL_PROVIDER_ID || id == LEGACY_LOCAL_CONFIG_TOML_ID || id.is_empty() {
        for target in &targets {
            restore(target)?;
        }
        return Ok(());
    }
    let provider = provider.ok_or_else(|| format!("provider {id} not found for {engine}"))?;
    match engine {
        "claude" => apply_claude(&targets[0], provider),
        "codex" => apply_codex(&targets[0], &targets[1], provider),
        "kimi" => apply_kimi(&targets[0], provider),
        "grok" => apply_grok(&targets[0], provider),
        // pi/omp/dsh/agy/opencode/qoder/qoder-cn providers are display-only (see the
        // module header for why opencode/qoder declare no file target).
        _ => Ok(()),
    }
}

// ── File targets & backups ──────────────────────────────────────────────────

struct Target {
    path: PathBuf,
    backup: PathBuf,
}

/// Native files exposed by the official editor, with legacy backup paths.
fn targets(engine: &str) -> Vec<Target> {
    let home = |env_key: Option<&str>, default: &str| crate::engine::engine_home(env_key, default);
    let backup_dir = crate::paths::app_home()
        .join("provider-backups")
        .join(engine);
    let target = |path: PathBuf, name: &str| Target {
        path,
        backup: backup_dir.join(name),
    };
    match engine {
        "claude" => vec![target(
            home(Some("CLAUDE_CONFIG_DIR"), ".claude").join("settings.json"),
            "settings.json",
        )],
        "codex" => {
            let home = crate::engine::codex_home();
            vec![
                target(home.join("config.toml"), "config.toml"),
                target(home.join("auth.json"), "auth.json"),
            ]
        }
        "kimi" => vec![target(
            home(Some("KIMI_CODE_HOME"), ".kimi-code").join("config.toml"),
            "config.toml",
        )],
        "grok" => vec![target(
            home(Some("GROK_HOME"), ".grok").join("config.toml"),
            "config.toml",
        )],
        "agy" => vec![target(
            crate::engine::agy::agy_home().join("settings.json"),
            "settings.json",
        )],
        _ => Vec::new(),
    }
}

fn absent_marker(backup: &Path) -> PathBuf {
    backup.with_extension("absent")
}

/// Retire the old file-materialization state before its provider records can
/// change. Only an identified legacy rendering is restored. All originals
/// and the pre-migration live files remain available for recovery.
pub(crate) fn migrate_legacy(
    engine: &str,
    section: &crate::config::ProviderSection,
) -> Result<(), String> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    migrate_targets(engine, section, &targets(engine))
}

fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read {}: {e}", path.display())),
    }
}

fn migrate_targets(
    engine: &str,
    section: &crate::config::ProviderSection,
    targets: &[Target],
) -> Result<(), String> {
    let mut plans = Vec::new();
    for target in targets {
        let marker = target.backup.with_extension("migrated");
        // Once retired, this backup must never be applied to a subsequently
        // selected CLI home. The marker keeps the old path for recovery only.
        if read_optional(&marker)?.is_some() {
            continue;
        }
        let original = read_optional(&target.backup)?;
        if original.is_none() && !absent_marker(&target.backup).exists() {
            continue;
        }
        let live = read_optional(&target.path)?;
        let mut restore_original = false;
        if live != original {
            let base = original
                .as_deref()
                .unwrap_or(if file_format(&target.path) == "json" {
                    "{}"
                } else {
                    ""
                });
            for provider in section.providers.values() {
                let rendered = match engine {
                    "claude" => render_claude(base, provider),
                    "codex"
                        if target
                            .path
                            .file_name()
                            .is_some_and(|name| name == "auth.json") =>
                    {
                        render_codex_auth(base, provider)
                    }
                    "codex" => render_codex(base, provider),
                    "kimi" => render_kimi(base, provider),
                    "grok" => render_grok(base, provider),
                    _ => continue,
                };
                if let (Some(live), Ok(expected)) = (live.as_deref(), rendered) {
                    // JSON property order was not stable in the old writer.
                    // For TOML require exact bytes, including user comments.
                    restore_original = if file_format(&target.path) == "json" {
                        let actual = serde_json::from_str::<Value>(live);
                        let expected = serde_json::from_str::<Value>(&expected);
                        matches!((actual, expected), (Ok(a), Ok(b)) if a == b)
                    } else {
                        live == expected
                    };
                }
                if restore_original {
                    break;
                }
            }
            let current = if section.current.as_deref() == Some(DISABLED_PROVIDER_ID) {
                section.disabled_from.as_deref()
            } else {
                section.current.as_deref()
            };
            let official = matches!(
                current,
                None | Some("") | Some(LOCAL_PROVIDER_ID) | Some(LEGACY_LOCAL_CONFIG_TOML_ID)
            );
            if !restore_original && !official {
                return Err(format!(
                    "CCGUI_PROVIDER_MIGRATION_CONFLICT:{}",
                    serde_json::json!({
                        "path": target.path.to_string_lossy(),
                        "backup": target.backup.to_string_lossy(),
                    })
                ));
            }
        }
        plans.push((target, marker, live, original, restore_original));
    }
    // Validate the whole engine (including Codex auth) before any restore.
    for (target, marker, live, original, restore_original) in plans {
        if read_optional(&target.path)? != live {
            return Err(format!(
                "{} changed during provider migration; retry",
                target.path.display()
            ));
        }
        if restore_original {
            if let Some(live) = live.as_deref() {
                let archive = target.backup.with_extension("pre-migration");
                // Never overwrite an earlier recovery copy after a failed run.
                if !archive.exists() {
                    crate::settings::atomic_write(&archive, live)?;
                }
            }
            if let Some(original) = original.as_deref() {
                crate::settings::atomic_write(&target.path, original)?;
            } else if target.path.exists() {
                std::fs::remove_file(&target.path)
                    .map_err(|e| format!("remove {}: {e}", target.path.display()))?;
            }
        }
        crate::settings::atomic_write(&marker, &target.path.to_string_lossy())?;
    }
    Ok(())
}
/// Native config files of `engine` (the 官方配置 editor's pane list). Empty for
/// engines whose official state lives in auth stores (pi/omp/dsh).
#[tauri::command]
pub fn provider_file_paths(engine: String) -> Vec<String> {
    targets(&engine)
        .iter()
        .map(|t| t.path.display().to_string())
        .collect()
}

// ── 官方配置 editing ────────────────────────────────────────────────────────

/// One editable file of an engine's 官方配置 (the CLI's own config), one pane
/// of the edit dialog.
#[derive(Debug, Clone, serde::Serialize)]
pub struct OfficialConfigFile {
    /// Absolute path — the pane label, and the write-back key.
    pub path: String,
    /// Editor language mode, derived from the extension.
    pub format: &'static str,
    /// Live file content; "" when absent (`exists` distinguishes).
    pub content: String,
    pub exists: bool,
}

/// Editable draft of one official file, matched back to a declared target by
/// exact path so the client can never name an arbitrary file.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct OfficialConfigDraft {
    pub path: String,
    pub content: String,
}

fn file_format(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("toml") => "toml",
        _ => "json",
    }
}

/// Files of the engine's 官方配置, in pane order. Empty for engines without
/// a native config file (pi/omp/dsh — their official state lives in auth
/// stores edited by their own sections).
#[tauri::command]
pub fn official_config_read(engine: String) -> Result<Vec<OfficialConfigFile>, String> {
    let config = crate::config::read_config()?;
    let section = config
        .section(&engine)
        .ok_or_else(|| format!("unknown engine: {engine}"))?;
    migrate_legacy(&engine, section)?;
    targets(&engine)
        .iter()
        .map(|t| {
            let content = match std::fs::read_to_string(&t.path) {
                Ok(content) => Ok(content),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
                Err(e) => Err(format!("read {}: {e}", t.path.display())),
            }?;
            Ok(OfficialConfigFile {
                path: t.path.display().to_string(),
                format: file_format(&t.path),
                content,
                exists: t.path.exists(),
            })
        })
        .collect()
}

/// Overwrite 官方配置 files. Native files stay the official configuration
/// (channels inject env at spawn and never rewrite them), so editing is
/// always allowed. Everything is validated before any write.
#[tauri::command]
pub fn official_config_write(
    store: tauri::State<'_, crate::config::ConfigStore>,
    engine: String,
    files: Vec<OfficialConfigDraft>,
) -> Result<(), String> {
    let _guard = store.0.lock().map_err(|e| e.to_string())?;
    let config = crate::config::read_config()?;
    let section = config
        .section(&engine)
        .ok_or_else(|| format!("unknown engine: {engine}"))?;
    let targets = targets(&engine);
    if targets.is_empty() {
        return Err(format!("engine {engine} has no editable official config"));
    }
    for draft in &files {
        let target = targets
            .iter()
            .find(|t| t.path.display().to_string() == draft.path)
            .ok_or_else(|| format!("{} is not an official config file of {engine}", draft.path))?;
        validate_official(target, &draft.content)?;
    }
    migrate_legacy(&engine, section)?;
    for draft in &files {
        let target = targets
            .iter()
            .find(|t| t.path.display().to_string() == draft.path)
            .expect("validated above");
        write_official(target, &draft.content)?;
    }
    Ok(())
}

fn validate_official(target: &Target, content: &str) -> Result<(), String> {
    match file_format(&target.path) {
        "toml" => {
            content
                .parse::<DocumentMut>()
                .map_err(|e| format!("invalid TOML in {}: {e}", target.path.display()))?;
        }
        _ => {
            let value: Value = serde_json::from_str(content)
                .map_err(|e| format!("invalid JSON in {}: {e}", target.path.display()))?;
            if !value.is_object() {
                return Err(format!("{} must be a JSON object", target.path.display()));
            }
        }
    }
    Ok(())
}

fn write_official(target: &Target, content: &str) -> Result<(), String> {
    if let Some(dir) = target.path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    }
    // Legacy snapshots are recovery material, never an editor write target.
    crate::settings::atomic_write(&target.path, content)
}

/// Snapshot the file before the first managed write. An existing backup wins
/// (it is the pre-cc-gui original); a missing file is recorded with an
/// `.absent` marker so restore can remove what we created.
#[cfg(test)]
fn snapshot_once(target: &Target) -> Result<(), String> {
    if target.backup.exists() || absent_marker(&target.backup).exists() {
        return Ok(());
    }
    let dir = target
        .backup
        .parent()
        .ok_or_else(|| "backup path has no parent".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    if target.path.exists() {
        std::fs::copy(&target.path, &target.backup)
            .map_err(|e| format!("backup {}: {e}", target.path.display()))?;
    } else {
        std::fs::write(absent_marker(&target.backup), "")
            .map_err(|e| format!("mark {} absent: {e}", target.path.display()))?;
    }
    Ok(())
}

/// 官方配置: put the pre-cc-gui file back. No backup and no marker means we
/// never managed the file — leave it alone.
#[cfg(test)]
fn restore(target: &Target) -> Result<(), String> {
    if target.backup.exists() {
        let content = std::fs::read_to_string(&target.backup)
            .map_err(|e| format!("read backup {}: {e}", target.backup.display()))?;
        crate::settings::atomic_write(&target.path, &content)?;
    } else if absent_marker(&target.backup).exists() && target.path.exists() {
        std::fs::remove_file(&target.path)
            .map_err(|e| format!("remove {}: {e}", target.path.display()))?;
    }
    Ok(())
}

/// Content to patch: the pristine backup when we already manage the file
/// (managed keys never accumulate), else the live file, else `default`.
#[cfg(test)]
fn base_content(target: &Target, default: &str) -> Result<String, String> {
    let source = if target.backup.exists() {
        &target.backup
    } else {
        &target.path
    };
    match std::fs::read_to_string(source) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(default.to_string()),
        Err(e) => Err(format!("read {}: {e}", source.display())),
    }
}

// ── Channel value extraction ────────────────────────────────────────────────

/// Loader/hook/hijack env keys a stored channel must never write into a
/// CLI's environment: they hand code execution or traffic interception to
/// whoever wrote the config file. Prefix families (DYLD_/LD_, GIT_CONFIG_KEY/
/// VALUE) are matched by prefix, the rest exactly; comparison is
/// case-insensitive because launchd/cmd env casing varies.
///
/// Beyond loader hooks: PATH hijacks the CLI's spawned git/rg children;
/// the proxy + NODE_EXTRA_CA_CERTS combo MITMs the CLI's HTTPS traffic;
/// GIT_CONFIG_* / GIT_TEMPLATE_DIR / GIT_EXEC_PATH turn the app's own git
/// calls into code execution; EDITOR/GIT_PAGER run when the CLI pages or
/// opens an editor.
fn is_blocked_env_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    if upper.starts_with("DYLD_")
        || upper.starts_with("LD_")
        || upper.starts_with("GIT_CONFIG_KEY_")
        || upper.starts_with("GIT_CONFIG_VALUE_")
    {
        return true;
    }
    matches!(
        upper.as_str(),
        "NODE_OPTIONS"
            | "NODE_REPL_EXTERNAL_MODULE"
            | "NODE_EXTRA_CA_CERTS"
            | "BASH_ENV"
            | "ENV"
            | "SHELLOPTS"
            | "PYTHONSTARTUP"
            | "PYTHONINSPECT"
            | "PYTHONPATH"
            | "RUBYOPT"
            | "PERL5OPT"
            | "PATH"
            | "HTTP_PROXY"
            | "HTTPS_PROXY"
            | "ALL_PROXY"
            | "GIT_SSH"
            | "GIT_SSH_COMMAND"
            | "GIT_CONFIG_GLOBAL"
            | "GIT_CONFIG_SYSTEM"
            | "GIT_CONFIG_COUNT"
            | "GIT_TEMPLATE_DIR"
            | "GIT_EXEC_PATH"
            | "SSH_ASKPASS"
            | "PROMPT_COMMAND"
            | "EDITOR"
            | "GIT_PAGER"
            | "PAGER"
            | "IFS"
    )
}

/// Static baseUrl/apiKey/model -> env var mapping per engine: the env keys a
/// cc-switch-imported channel carries its convention fields under, and (for
/// claude) the keys written into settings.json.
fn env_mapping(engine: &str) -> [(&'static str, &'static str); 3] {
    match engine {
        "claude" => [
            ("baseUrl", "ANTHROPIC_BASE_URL"),
            ("apiKey", "ANTHROPIC_AUTH_TOKEN"),
            ("model", "ANTHROPIC_MODEL"),
        ],
        "kimi" => [
            ("baseUrl", "KIMI_BASE_URL"),
            ("apiKey", "KIMI_API_KEY"),
            ("model", "KIMI_MODEL_NAME"),
        ],
        "grok" => [
            ("baseUrl", "GROK_BASE_URL"),
            ("apiKey", "GROK_API_KEY"),
            ("model", "GROK_MODEL"),
        ],
        // codex reads OpenAI-compatible env for its default provider.
        "codex" => [
            ("baseUrl", "OPENAI_BASE_URL"),
            ("apiKey", "OPENAI_API_KEY"),
            ("model", ""),
        ],
        _ => [("baseUrl", ""), ("apiKey", ""), ("model", "")],
    }
}

fn non_empty_str(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// A channel's raw env maps: cc-switch's `settingsConfig.env` first (the
/// legacy claude/grok shape), then the flat `env` escape hatch.
fn channel_env_maps(
    provider: &Value,
) -> impl Iterator<Item = &serde_json::Map<String, Value>> + '_ {
    [
        provider.get("settingsConfig").and_then(|s| s.get("env")),
        provider.get("env"),
    ]
    .into_iter()
    .flatten()
    .filter_map(Value::as_object)
}

/// One convention field (baseUrl/apiKey/model): the flat field wins, then
/// the engine's env key inside the raw env maps.
fn channel_field(engine: &str, provider: &Value, field: &str) -> Option<String> {
    if let Some(v) = non_empty_str(provider.get(field)) {
        return Some(v);
    }
    let (_, var) = env_mapping(engine).into_iter().find(|(f, _)| *f == field)?;
    if var.is_empty() {
        return None;
    }
    channel_env_maps(provider).find_map(|map| non_empty_str(map.get(var)))
}

/// Channel env for spawn injection (and leftover file-materialize helpers):
/// raw env maps first (blocked keys and empties refused), convention fields
/// only where raw env has no value — raw env wins.
///
/// Codex additionally lifts `settingsConfig.auth.OPENAI_API_KEY` when the
/// convention `apiKey` / env maps have none: that is how cc-switch stores
/// the credential that used to land in `auth.json`.
pub(crate) fn channel_env(
    engine: &str,
    provider: &Value,
) -> Result<HashMap<String, String>, String> {
    let mut out: HashMap<String, String> = HashMap::new();
    let mut seen = HashSet::new();
    for map in channel_env_maps(provider) {
        for (key, val) in map {
            if seen.contains(key) || is_blocked_env_key(key) {
                if is_blocked_env_key(key) {
                    eprintln!("[provider_files] refusing to inject blocked env key: {key}");
                }
                continue;
            }
            let scalar = match val {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                _ => continue,
            };
            if scalar.trim().is_empty() {
                continue;
            }
            seen.insert(key.clone());
            out.insert(key.clone(), scalar);
        }
    }
    for (field, var) in env_mapping(engine) {
        if var.is_empty() || seen.contains(var) {
            continue;
        }
        if let Some(v) = channel_field(engine, provider, field) {
            seen.insert(var.to_string());
            out.insert(var.to_string(), v);
        }
    }
    if engine == "codex" && !seen.contains("OPENAI_API_KEY") {
        if let Some(key) = non_empty_str(
            provider
                .get("settingsConfig")
                .and_then(|s| s.get("auth"))
                .and_then(|a| a.get("OPENAI_API_KEY")),
        ) {
            out.insert("OPENAI_API_KEY".to_string(), key);
        }
    }
    if engine == "grok" {
        // GROK_BASE_URL/API_KEY were our stored channel aliases, not native
        // CLI variables. Translate them, preserving explicit native env.
        if let Some(base) = out.remove("GROK_BASE_URL") {
            let base = base.trim_end_matches('/');
            for key in [
                "GROK_MODELS_BASE_URL",
                "GROK_XAI_API_BASE_URL",
                "GROK_CLI_CHAT_PROXY_BASE_URL",
            ] {
                out.entry(key.into()).or_insert_with(|| base.to_string());
            }
            out.entry("GROK_MODELS_LIST_URL".into())
                .or_insert_with(|| format!("{base}/models"));
        }
        if let Some(key) = out.remove("GROK_API_KEY") {
            out.entry("XAI_API_KEY".into()).or_insert(key);
        }
    }
    Ok(out)
}

// ── claude: settings.json ───────────────────────────────────────────────────

#[cfg(test)]
fn apply_claude(target: &Target, provider: &Value) -> Result<(), String> {
    snapshot_once(target)?;
    let base = base_content(target, "{}")?;
    crate::settings::atomic_write(&target.path, &render_claude(&base, provider)?)
}

fn render_claude(base: &str, provider: &Value) -> Result<String, String> {
    let mut doc: Value =
        serde_json::from_str(base).map_err(|_| "Invalid legacy Claude settings JSON")?;
    if !doc.is_object() {
        return Err("Legacy Claude settings root is not a JSON object".into());
    }
    // Provider-selection keys in the base are residue from whatever managed
    // the file before cc-gui (another provider switcher captured in the
    // snapshot). A channel owns them outright: strip them so a polluted
    // snapshot can't resurrect foreign endpoints/credentials/model mappings
    // on every apply. The 官方配置 restore path is untouched — it still
    // returns the snapshot byte-for-byte.
    if let Some(env) = doc.get_mut("env").and_then(Value::as_object_mut) {
        for key in CLAUDE_MANAGED_ENV_KEYS {
            env.remove(key);
        }
        if env.is_empty() {
            doc.as_object_mut().unwrap().remove("env");
        }
    }
    // cc-switch channels carry a full settingsConfig: merge its top-level
    // keys (env deep-merged below), keeping the user's unrelated settings.
    if let Some(sc) = provider.get("settingsConfig").and_then(Value::as_object) {
        for (key, val) in sc {
            if key != "env" {
                doc[key] = val.clone();
            }
        }
    }
    let env = channel_env("claude", provider)?;
    if !env.is_empty() {
        if !doc.get("env").is_some_and(Value::is_object) {
            doc["env"] = Value::Object(serde_json::Map::new());
        }
        for (key, val) in env {
            doc["env"][key] = Value::String(val);
        }
    }
    serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())
}

/// Provider-selection env keys a claude channel owns outright once cc-gui
/// manages settings.json: endpoint, credentials, and model routing. The three
/// convention keys mirror env_mapping("claude"); ANTHROPIC_API_KEY is the
/// alternate credential key the dialog recognizes.
const CLAUDE_MANAGED_ENV_KEYS: [&str; 9] = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
];

// ── codex: config.toml + auth.json ──────────────────────────────────────────

/// Top-level scalars a cc-switch codex config manages. Everything else in
/// the user's config.toml (notify hooks, project trust, mcp_servers, …)
/// stays untouched.
const CODEX_MANAGED_SCALARS: [&str; 5] = [
    "model",
    "model_provider",
    "model_reasoning_effort",
    "preferred_auth_method",
    "disable_response_storage",
];

#[cfg(test)]
fn apply_codex(config: &Target, auth: &Target, provider: &Value) -> Result<(), String> {
    if codex_api_key(provider).is_some() {
        snapshot_once(auth)?;
        let base = base_content(auth, "{}")?;
        crate::settings::atomic_write(&auth.path, &render_codex_auth(&base, provider)?)?;
    }
    snapshot_once(config)?;
    let base = base_content(config, "")?;
    crate::settings::atomic_write(&config.path, &render_codex(&base, provider)?)
}

fn codex_api_key(provider: &Value) -> Option<String> {
    non_empty_str(provider.pointer("/settingsConfig/auth/OPENAI_API_KEY"))
        .or_else(|| channel_field("codex", provider, "apiKey"))
}

/// Minimal channel fields needed by the internal model-catalog service. This
/// type must never be serialized into a plugin DTO: endpoint and credential
/// values are used only to perform an explicitly requested refresh.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SafeProviderProbeConfig {
    pub name: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub configured_model: Option<String>,
}

pub(crate) fn safe_provider_probe_config(
    engine: &str,
    provider: &Value,
) -> SafeProviderProbeConfig {
    let name = non_empty_str(provider.get("name")).unwrap_or_else(|| "Provider".to_string());
    let configured_model = channel_field(engine, provider, "model").or_else(|| {
        if engine != "codex" {
            return None;
        }
        provider
            .pointer("/settingsConfig/config")
            .and_then(Value::as_str)
            .and_then(|text| text.parse::<DocumentMut>().ok())
            .and_then(|doc| doc.get("model").and_then(Item::as_str).map(str::to_string))
    });
    SafeProviderProbeConfig {
        name,
        base_url: channel_field(engine, provider, "baseUrl"),
        api_key: if engine == "codex" {
            codex_api_key(provider)
        } else {
            channel_field(engine, provider, "apiKey")
        },
        configured_model,
    }
}

fn render_codex_auth(base: &str, provider: &Value) -> Result<String, String> {
    if let Some(key) = codex_api_key(provider) {
        let mut doc: Value =
            serde_json::from_str(base).map_err(|_| "Invalid legacy Codex auth JSON")?;
        if !doc.is_object() {
            return Err("Legacy Codex auth root is not a JSON object".into());
        }
        doc["OPENAI_API_KEY"] = Value::String(key);
        return serde_json::to_string_pretty(&doc).map_err(|e| e.to_string());
    }
    Ok(base.to_string())
}

fn render_codex(base: &str, provider: &Value) -> Result<String, String> {
    let mut doc = base
        .parse::<DocumentMut>()
        .map_err(|_| "Invalid legacy Codex config TOML")?;
    if let Some(text) = provider
        .get("settingsConfig")
        .and_then(|s| s.get("config"))
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
    {
        // cc-switch channel: copy the keys it manages out of its verbatim
        // config.toml into the user's file.
        let src = text
            .parse::<DocumentMut>()
            .map_err(|e| format!("parse channel config.toml: {e}"))?;
        for key in CODEX_MANAGED_SCALARS {
            if let Some(item) = src.get(key) {
                doc[key] = item.clone();
            }
        }
        if let Some(providers) = src.get("model_providers") {
            doc["model_providers"] = providers.clone();
        }
    } else {
        if let Some(base_url) = channel_field("codex", provider, "baseUrl") {
            let name = non_empty_str(provider.get("name")).unwrap_or_else(|| "CC GUI".into());
            let mut table = existing_table(&doc, &["model_providers", "ccgui"])
                .unwrap_or_else(|| Item::Table(Table::new()));
            upsert_str(&mut table, "name", &name);
            upsert_str(&mut table, "base_url", &base_url);
            upsert_str(&mut table, "env_key", "OPENAI_API_KEY");
            upsert_table(&mut doc, &["model_providers", "ccgui"], table);
            doc["model_provider"] = value("ccgui");
        }
        if let Some(model) = channel_field("codex", provider, "model") {
            doc["model"] = value(model);
        }
    }
    Ok(doc.to_string())
}

// ── kimi: config.toml ───────────────────────────────────────────────────────

#[cfg(test)]
fn apply_kimi(target: &Target, provider: &Value) -> Result<(), String> {
    snapshot_once(target)?;
    let base = base_content(target, "")?;
    crate::settings::atomic_write(&target.path, &render_kimi(&base, provider)?)
}

fn render_kimi(base: &str, provider: &Value) -> Result<String, String> {
    let mut doc = base
        .parse::<DocumentMut>()
        .map_err(|_| "Invalid legacy Kimi config TOML")?;
    let base_url = channel_field("kimi", provider, "baseUrl");
    let api_key = channel_field("kimi", provider, "apiKey");
    let model = channel_field("kimi", provider, "model");
    let mut wrote_provider = false;
    if base_url.is_some() || api_key.is_some() {
        let mut table = existing_table(&doc, &["providers", "ccgui"])
            .unwrap_or_else(|| Item::Table(Table::new()));
        // kimi-cli defaults a missing type to "openai"; state it anyway.
        upsert_str(&mut table, "type", "openai");
        if let Some(v) = &base_url {
            upsert_str(&mut table, "base_url", v);
        }
        if let Some(v) = &api_key {
            upsert_str(&mut table, "api_key", v);
        }
        upsert_table(&mut doc, &["providers", "ccgui"], table);
        wrote_provider = true;
    }
    if let Some(model) = model {
        if wrote_provider {
            // Alias into our provider so base_url/api_key actually apply.
            let mut table = existing_table(&doc, &["models", "ccgui"])
                .unwrap_or_else(|| Item::Table(Table::new()));
            upsert_str(&mut table, "provider", "ccgui");
            upsert_str(&mut table, "model", &model);
            upsert_table(&mut doc, &["models", "ccgui"], table);
            doc["default_model"] = value("ccgui");
        } else {
            // No connection details: assume the user named an existing alias.
            doc["default_model"] = value(model);
        }
    }
    Ok(doc.to_string())
}

// ── grok: config.toml ───────────────────────────────────────────────────────

#[cfg(test)]
fn apply_grok(target: &Target, provider: &Value) -> Result<(), String> {
    snapshot_once(target)?;
    let base = base_content(target, "")?;
    crate::settings::atomic_write(&target.path, &render_grok(&base, provider)?)
}

pub(crate) fn render_grok(base: &str, provider: &Value) -> Result<String, String> {
    let mut doc = base
        .parse::<DocumentMut>()
        .map_err(|_| "Invalid legacy Grok config TOML")?;
    for key in ["endpoints", "models", "model"] {
        if doc
            .get(key)
            .is_some_and(|item| item.as_table_like().is_none())
        {
            return Err(format!("Grok config {key} must be a table"));
        }
    }
    if let Some(base_url) = channel_field("grok", provider, "baseUrl") {
        let base_url = base_url.trim_end_matches('/').to_string();
        for key in [
            "models_base_url",
            "xai_api_base_url",
            "cli_chat_proxy_base_url",
        ] {
            doc["endpoints"][key] = value(base_url.clone());
        }
        doc["endpoints"]["models_list_url"] = value(format!("{base_url}/models"));
    }
    let api_key = channel_field("grok", provider, "apiKey");
    if let Some(model) = channel_field("grok", provider, "model") {
        doc["models"]["default"] = value(model.clone());
        let mut table = existing_table(&doc, &["model", model.as_str()])
            .unwrap_or_else(|| Item::Table(Table::new()));
        upsert_str(&mut table, "model", &model);
        // Grok keeps credentials per model table — the only place the CLI
        // reads an api_key from config.
        if let Some(key) = api_key {
            upsert_str(&mut table, "api_key", &key);
        }
        upsert_table(&mut doc, &["model", model.as_str()], table);
    }
    Ok(doc.to_string())
}

// ── toml_edit helpers ───────────────────────────────────────────────────────

/// Read-side indexing panics on a missing key; walk with `get` instead. The
/// returned table is a detached copy: mutate, then write back under the same
/// key (toml_edit's `as_table_like_mut` borrows would not outlive the later
/// document writes).
fn existing_table(doc: &DocumentMut, path: &[&str]) -> Option<Item> {
    let mut item = doc.as_item();
    for key in path {
        item = item.get(*key)?;
    }
    item.as_table_like().map(clone_table_like)
}

/// Insert `table` at `path`, creating missing parents as implicit tables so
/// only the leaf header renders. IndexMut assignment (`doc["a"]["b"] =
/// Item::Table(..)`) silently drops the child under an auto-created parent —
/// walk with or_insert + TableLike::insert instead.
fn upsert_table(doc: &mut DocumentMut, path: &[&str], table: Item) {
    let mut current = doc.as_item_mut();
    for key in &path[..path.len() - 1] {
        if current.get(*key).is_none() {
            // Indexing a missing key yields an Item::None sentinel that
            // silently swallows inserts; assignment is what materializes it.
            let mut t = Table::new();
            t.set_implicit(true);
            current[*key] = Item::Table(t);
        }
        current = &mut current[*key];
    }
    if let Some(parent) = current.as_table_like_mut() {
        parent.insert(path[path.len() - 1], table);
    }
}

fn clone_table_like(table: &dyn toml_edit::TableLike) -> Item {
    let mut copy = Table::new();
    for (key, item) in table.iter() {
        copy[key] = item.clone();
    }
    Item::Table(copy)
}

fn upsert_str(table: &mut Item, key: &str, val: &str) {
    if let Some(t) = table.as_table_like_mut() {
        t.insert(key, value(val));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn legacy_section(provider: Value) -> crate::config::ProviderSection {
        crate::config::ProviderSection {
            providers: serde_json::Map::from_iter([("channel".into(), provider)]),
            current: Some("channel".into()),
            disabled_from: None,
        }
    }

    #[test]
    fn legacy_migration_restores_once_and_preserves_both_recovery_files() {
        let provider = serde_json::json!({"baseUrl":"https://relay.example", "apiKey":"test-key", "model":"test-model"});
        let section = legacy_section(provider.clone());
        for (engine, filename, original) in [
            (
                "claude",
                "settings.json",
                "{\n  \"permissions\": {\"allow\": []}\n}\n",
            ),
            (
                "kimi",
                "config.toml",
                "# original settings\ndefault_model = \"user-model\"\n",
            ),
            (
                "grok",
                "config.toml",
                "# original settings\n[models]\ndefault = \"user-model\"\n",
            ),
        ] {
            let (dir, target) = fixture(engine, filename);
            std::fs::write(&target.path, original).unwrap();
            match engine {
                "claude" => apply_claude(&target, &provider),
                "kimi" => apply_kimi(&target, &provider),
                _ => apply_grok(&target, &provider),
            }
            .unwrap();
            let managed = std::fs::read_to_string(&target.path).unwrap();
            migrate_targets(engine, &section, std::slice::from_ref(&target)).unwrap();
            assert_eq!(std::fs::read_to_string(&target.path).unwrap(), original);
            assert_eq!(std::fs::read_to_string(&target.backup).unwrap(), original);
            assert_eq!(
                std::fs::read_to_string(target.backup.with_extension("pre-migration")).unwrap(),
                managed
            );
            let edited = format!("{original}\n");
            write_official(&target, &edited).unwrap();
            migrate_targets(engine, &section, std::slice::from_ref(&target)).unwrap();
            assert_eq!(std::fs::read_to_string(&target.path).unwrap(), edited);
            assert_eq!(std::fs::read_to_string(&target.backup).unwrap(), original);
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn legacy_migration_validates_codex_pair_before_restoring_and_can_retry() {
        let (dir, config) = fixture("migration-codex", "config.toml");
        let auth = Target {
            path: dir.join("auth.json"),
            backup: dir.join("backups/auth.json"),
        };
        let provider = serde_json::json!({"baseUrl":"https://relay.example", "apiKey":"new-key"});
        let section = legacy_section(provider.clone());
        std::fs::write(&config.path, "# original\nmodel = \"native\"\n").unwrap();
        std::fs::write(&auth.path, r#"{"OPENAI_API_KEY":"original-key"}"#).unwrap();
        apply_codex(&config, &auth, &provider).unwrap();
        let managed_config = std::fs::read_to_string(&config.path).unwrap();
        let managed_auth = std::fs::read_to_string(&auth.path).unwrap();
        std::fs::write(&auth.path, r#"{"OPENAI_API_KEY":"user-changed-key"}"#).unwrap();
        let targets = [config, auth];
        assert!(migrate_targets("codex", &section, &targets)
            .unwrap_err()
            .starts_with("CCGUI_PROVIDER_MIGRATION_CONFLICT:"));
        assert_eq!(
            std::fs::read_to_string(&targets[0].path).unwrap(),
            managed_config
        );
        assert!(!targets[0].backup.with_extension("migrated").exists());
        std::fs::write(&targets[1].path, managed_auth).unwrap();
        migrate_targets("codex", &section, &targets).unwrap();
        for target in &targets {
            assert_eq!(
                std::fs::read(&target.path).unwrap(),
                std::fs::read(&target.backup).unwrap()
            );
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn legacy_migration_handles_absent_original_and_disabled_channel() {
        let (dir, target) = fixture("migration-absent", "settings.json");
        let provider = serde_json::json!({"apiKey":"test-key"});
        apply_claude(&target, &provider).unwrap();
        let mut section = legacy_section(provider);
        section.current = Some(DISABLED_PROVIDER_ID.into());
        section.disabled_from = Some("channel".into());
        migrate_targets("claude", &section, std::slice::from_ref(&target)).unwrap();
        assert!(!target.path.exists());
        assert!(absent_marker(&target.backup).exists());
        assert!(target.backup.with_extension("pre-migration").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn retired_backup_never_restores_into_a_different_cli_home() {
        let (dir, target) = fixture("migration-new-home", "settings.json");
        let provider = serde_json::json!({"apiKey":"test-key"});
        apply_claude(&target, &provider).unwrap();
        let managed = std::fs::read_to_string(&target.path).unwrap();
        let section = legacy_section(provider);
        migrate_targets("claude", &section, std::slice::from_ref(&target)).unwrap();
        let other = Target {
            path: dir.join("other-settings.json"),
            backup: target.backup,
        };
        std::fs::write(&other.path, &managed).unwrap();
        migrate_targets("claude", &section, std::slice::from_ref(&other)).unwrap();
        assert_eq!(std::fs::read_to_string(&other.path).unwrap(), managed);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn legacy_migration_preserves_user_toml_edits() {
        let (dir, target) = fixture("migration-edited", "config.toml");
        let provider = serde_json::json!({"model":"channel-model"});
        std::fs::write(&target.path, "# original\n").unwrap();
        apply_kimi(&target, &provider).unwrap();
        let edited = format!(
            "{}\n# user's new comment\n",
            std::fs::read_to_string(&target.path).unwrap()
        );
        std::fs::write(&target.path, &edited).unwrap();
        assert!(migrate_targets(
            "kimi",
            &legacy_section(provider),
            std::slice::from_ref(&target)
        )
        .is_err());
        assert_eq!(std::fs::read_to_string(&target.path).unwrap(), edited);
        assert_eq!(
            std::fs::read_to_string(&target.backup).unwrap(),
            "# original\n"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn grok_channel_injects_native_endpoint_and_auth_names() {
        let p = serde_json::json!({"env": {
            "GROK_BASE_URL": "https://relay.example/v1/",
            "GROK_API_KEY": "dummy-key"
        }});
        let env = channel_env("grok", &p).unwrap();
        for key in [
            "GROK_MODELS_BASE_URL",
            "GROK_XAI_API_BASE_URL",
            "GROK_CLI_CHAT_PROXY_BASE_URL",
        ] {
            assert_eq!(
                env.get(key).map(String::as_str),
                Some("https://relay.example/v1")
            );
        }
        assert_eq!(
            env.get("GROK_MODELS_LIST_URL").map(String::as_str),
            Some("https://relay.example/v1/models")
        );
        assert_eq!(
            env.get("XAI_API_KEY").map(String::as_str),
            Some("dummy-key")
        );
        assert!(!env.contains_key("GROK_API_KEY"));
        assert!(!env.contains_key("GROK_BASE_URL"));
    }

    #[test]
    fn channel_env_raw_wins_convention_and_refuses_blocked_keys() {
        let p = serde_json::json!({
            "baseUrl": "https://flat.example",
            "apiKey": "sk-flat",
            "model": "flat-model",
            "settingsConfig": { "env": { "ANTHROPIC_BASE_URL": "https://raw.example" } },
            "env": { "ANTHROPIC_AUTH_TOKEN": "sk-raw" },
        });
        let env = channel_env("claude", &p).unwrap();
        assert_eq!(
            env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://raw.example")
        );
        assert_eq!(
            env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("sk-raw")
        );
        assert_eq!(
            env.get("ANTHROPIC_MODEL").map(String::as_str),
            Some("flat-model")
        );

        let blocked = serde_json::json!({ "env": {
            "NODE_OPTIONS": "--require ./x.js",
            "PATH": "/tmp/evil-bin:/usr/bin",
            "HTTPS_PROXY": "http://mitm.example:8080",
            "NODE_EXTRA_CA_CERTS": "/tmp/evil-ca.pem",
            "GIT_CONFIG_GLOBAL": "/tmp/evil-gitconfig",
            "GIT_CONFIG_KEY_0": "core.hooksPath",
            "EDITOR": "/tmp/evil-editor",
            "SAFE": "1"
        } });
        let env = channel_env("claude", &blocked).unwrap();
        for key in [
            "NODE_OPTIONS",
            "PATH",
            "HTTPS_PROXY",
            "NODE_EXTRA_CA_CERTS",
            "GIT_CONFIG_GLOBAL",
            "GIT_CONFIG_KEY_0",
            "EDITOR",
        ] {
            assert!(!env.contains_key(key), "{key} must never be injected");
        }
        assert_eq!(env.get("SAFE").map(String::as_str), Some("1"));
    }

    #[test]
    fn channel_env_codex_lifts_auth_json_key() {
        let p = serde_json::json!({
            "settingsConfig": { "auth": { "OPENAI_API_KEY": "sk-codex" } },
        });
        let env = channel_env("codex", &p).unwrap();
        assert_eq!(
            env.get("OPENAI_API_KEY").map(String::as_str),
            Some("sk-codex")
        );
    }

    #[test]
    fn validate_official_rejects_malformed_content() {
        let (_, json_target) = fixture("validate-json", "settings.json");
        let (_, toml_target) = fixture("validate-toml", "config.toml");
        assert!(validate_official(&json_target, r#"{"env":{}}"#).is_ok());
        assert!(validate_official(&json_target, "{not json").is_err());
        // Scalars/arrays parse as JSON but are not a usable settings file.
        assert!(validate_official(&json_target, "[1,2]").is_err());
        assert!(validate_official(&toml_target, "[providers]\nx=1").is_ok());
        assert!(validate_official(&toml_target, "key = = 1").is_err());
    }

    #[test]
    fn write_official_preserves_legacy_snapshot() {
        let (dir, target) = fixture("official-sync", "settings.json");
        std::fs::create_dir_all(target.backup.parent().unwrap()).unwrap();
        std::fs::write(&target.path, r#"{"a":1}"#).unwrap();
        std::fs::write(&target.backup, r#"{"a":1}"#).unwrap();
        write_official(&target, r#"{"a":2}"#).unwrap();
        assert_eq!(std::fs::read_to_string(&target.path).unwrap(), r#"{"a":2}"#);
        assert_eq!(
            std::fs::read_to_string(&target.backup).unwrap(),
            r#"{"a":1}"#
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_official_preserves_legacy_absent_marker() {
        let (dir, target) = fixture("official-absent", "settings.json");
        std::fs::create_dir_all(target.backup.parent().unwrap()).unwrap();
        std::fs::write(absent_marker(&target.backup), "").unwrap();
        write_official(&target, r#"{"b":1}"#).unwrap();
        assert!(absent_marker(&target.backup).exists());
        assert!(!target.backup.exists());
        assert_eq!(std::fs::read_to_string(&target.path).unwrap(), r#"{"b":1}"#);
        let _ = std::fs::remove_dir_all(&dir);
    }

    static SEQ: AtomicU32 = AtomicU32::new(0);

    /// Isolated (target, backup) pair in a fresh temp dir.
    fn fixture(name: &str, file: &str) -> (PathBuf, Target) {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-provider-files-{name}-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        (
            dir.clone(),
            Target {
                path: dir.join(file),
                backup: dir.join("backups").join(file),
            },
        )
    }

    fn channel(fields: &[(&str, &str)]) -> Value {
        fields
            .iter()
            .map(|(k, v)| (k.to_string(), Value::String(v.to_string())))
            .collect::<serde_json::Map<String, Value>>()
            .into()
    }

    #[test]
    fn claude_merges_env_and_preserves_unrelated_settings() {
        let (dir, target) = fixture("claude", "settings.json");
        std::fs::write(
            &target.path,
            r#"{"model":"opus","hooks":{"Stop":[]},"env":{"USER_KEY":"keep"}}"#,
        )
        .unwrap();
        let p = channel(&[
            ("baseUrl", "https://a.example"),
            ("apiKey", "sk-a"),
            ("model", "m-a"),
        ]);
        apply_claude(&target, &p).unwrap();
        let out: Value =
            serde_json::from_str(&std::fs::read_to_string(&target.path).unwrap()).unwrap();
        assert_eq!(out["model"], "opus");
        assert!(out["hooks"].is_object());
        assert_eq!(out["env"]["USER_KEY"], "keep");
        assert_eq!(out["env"]["ANTHROPIC_BASE_URL"], "https://a.example");
        assert_eq!(out["env"]["ANTHROPIC_AUTH_TOKEN"], "sk-a");
        assert_eq!(out["env"]["ANTHROPIC_MODEL"], "m-a");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn claude_second_switch_drops_first_channels_keys() {
        let (dir, target) = fixture("claude-switch", "settings.json");
        std::fs::write(&target.path, r#"{"env":{"USER_KEY":"keep"}}"#).unwrap();
        let a = channel(&[("baseUrl", "https://a.example")]);
        let b = channel(&[("baseUrl", "https://b.example"), ("model", "m-b")]);
        apply_claude(&target, &a).unwrap();
        apply_claude(&target, &b).unwrap();
        let out: Value =
            serde_json::from_str(&std::fs::read_to_string(&target.path).unwrap()).unwrap();
        assert_eq!(out["env"]["ANTHROPIC_BASE_URL"], "https://b.example");
        assert_eq!(out["env"]["ANTHROPIC_MODEL"], "m-b");
        assert_eq!(out["env"]["USER_KEY"], "keep");
        // A leftover from the first channel must not survive the second.
        let mut c = channel(&[("model", "m-c")]);
        c["settingsConfig"] = serde_json::json!({"env": {"EXTRA_A": "x"}});
        apply_claude(&target, &c).unwrap();
        let d = channel(&[("model", "m-d")]);
        apply_claude(&target, &d).unwrap();
        let out: Value =
            serde_json::from_str(&std::fs::read_to_string(&target.path).unwrap()).unwrap();
        assert!(out["env"].get("EXTRA_A").is_none());
        assert_eq!(out["env"]["ANTHROPIC_MODEL"], "m-d");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn claude_snapshot_provider_keys_are_not_resurrected() {
        let (dir, target) = fixture("claude-residue", "settings.json");
        // The pre-cc-gui file was last written by another provider manager:
        // its endpoint/credential/model-routing keys sit in the snapshot.
        let original = r#"{"model":"opus","env":{"USER_KEY":"keep","ANTHROPIC_BASE_URL":"https://old.example","ANTHROPIC_AUTH_TOKEN":"sk-old","ANTHROPIC_DEFAULT_OPUS_MODEL":"kimi-k3","ANTHROPIC_DEFAULT_SONNET_MODEL":"kimi-k3","ANTHROPIC_DEFAULT_HAIKU_MODEL":"kimi-k3","ANTHROPIC_DEFAULT_FABLE_MODEL":"kimi-k3","ANTHROPIC_SMALL_FAST_MODEL":"kimi-k3-mini"}}"#;
        std::fs::write(&target.path, original).unwrap();
        let p = channel(&[("baseUrl", "https://a.example"), ("apiKey", "sk-a")]);
        apply_claude(&target, &p).unwrap();
        let out: Value =
            serde_json::from_str(&std::fs::read_to_string(&target.path).unwrap()).unwrap();
        assert_eq!(out["env"]["USER_KEY"], "keep");
        assert_eq!(out["env"]["ANTHROPIC_BASE_URL"], "https://a.example");
        assert_eq!(out["env"]["ANTHROPIC_AUTH_TOKEN"], "sk-a");
        for key in [
            "ANTHROPIC_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "ANTHROPIC_DEFAULT_FABLE_MODEL",
            "ANTHROPIC_SMALL_FAST_MODEL",
        ] {
            assert!(out["env"].get(key).is_none(), "{key} must not survive");
        }
        // 官方配置 restore still returns the polluted original byte-for-byte.
        restore(&target).unwrap();
        assert_eq!(std::fs::read_to_string(&target.path).unwrap(), original);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn claude_strip_drops_emptied_env_object() {
        let (dir, target) = fixture("claude-strip-empty", "settings.json");
        std::fs::write(&target.path, r#"{"env":{"ANTHROPIC_MODEL":"m-old"}}"#).unwrap();
        apply_claude(&target, &channel(&[])).unwrap();
        let out: Value =
            serde_json::from_str(&std::fs::read_to_string(&target.path).unwrap()).unwrap();
        assert!(out.get("env").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn claude_blocked_env_keys_never_written() {
        let (dir, target) = fixture("claude-blocked", "settings.json");
        let mut p = channel(&[]);
        p["env"] = serde_json::json!({"DYLD_INSERT_LIBRARIES": "/evil.dylib", "OK": "1"});
        apply_claude(&target, &p).unwrap();
        let out: Value =
            serde_json::from_str(&std::fs::read_to_string(&target.path).unwrap()).unwrap();
        assert!(out["env"].get("DYLD_INSERT_LIBRARIES").is_none());
        assert_eq!(out["env"]["OK"], "1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn local_restores_backup_byte_for_byte() {
        let (dir, target) = fixture("restore", "settings.json");
        let original = r#"{"model":"opus","env":{"USER_KEY":"keep"}}"#;
        std::fs::write(&target.path, original).unwrap();
        let p = channel(&[("baseUrl", "https://a.example")]);
        apply_claude(&target, &p).unwrap();
        assert_ne!(std::fs::read_to_string(&target.path).unwrap(), original);
        restore(&target).unwrap();
        assert_eq!(std::fs::read_to_string(&target.path).unwrap(), original);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn restore_removes_file_we_created() {
        let (dir, target) = fixture("restore-absent", "settings.json");
        let p = channel(&[("baseUrl", "https://a.example")]);
        apply_claude(&target, &p).unwrap();
        assert!(target.path.exists());
        restore(&target).unwrap();
        assert!(!target.path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn codex_flat_channel_patches_toml_and_auth() {
        let (dir, config) = fixture("codex", "config.toml");
        let auth = Target {
            path: dir.join("auth.json"),
            backup: dir.join("backups").join("auth.json"),
        };
        std::fs::write(
            &config.path,
            "# user comment\nnotify = [\"x\"]\nmodel = \"gpt-old\"\n",
        )
        .unwrap();
        let p = channel(&[
            ("baseUrl", "https://c.example/v1"),
            ("apiKey", "sk-c"),
            ("model", "gpt-new"),
            ("name", "test"),
        ]);
        apply_codex(&config, &auth, &p).unwrap();
        let text = std::fs::read_to_string(&config.path).unwrap();
        assert!(text.contains("# user comment"), "comments survive: {text}");
        assert!(text.contains("notify"), "unrelated keys survive: {text}");
        let doc = text.parse::<DocumentMut>().unwrap();
        assert_eq!(doc["model"].as_str(), Some("gpt-new"));
        assert_eq!(doc["model_provider"].as_str(), Some("ccgui"));
        assert_eq!(
            doc["model_providers"]["ccgui"]["base_url"].as_str(),
            Some("https://c.example/v1")
        );
        assert_eq!(
            doc["model_providers"]["ccgui"]["env_key"].as_str(),
            Some("OPENAI_API_KEY")
        );
        let auth_doc: Value =
            serde_json::from_str(&std::fs::read_to_string(&auth.path).unwrap()).unwrap();
        assert_eq!(auth_doc["OPENAI_API_KEY"], "sk-c");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn codex_ccswitch_channel_copies_managed_keys_only() {
        let (dir, config) = fixture("codex-ccs", "config.toml");
        let auth = Target {
            path: dir.join("auth.json"),
            backup: dir.join("backups").join("auth.json"),
        };
        std::fs::write(&config.path, "notify = [\"x\"]\nmodel = \"gpt-old\"\n").unwrap();
        let p = serde_json::json!({
            "name": "ccs",
            "settingsConfig": {
                "auth": {"OPENAI_API_KEY": "sk-ccs"},
                "config": "model_provider = \"acme\"\nmodel = \"gpt-acme\"\nnotify = [\"evil\"]\n\n[model_providers.acme]\nbase_url = \"https://acme.example/v1\"\nenv_key = \"OPENAI_API_KEY\"\n"
            }
        });
        apply_codex(&config, &auth, &p).unwrap();
        let doc = std::fs::read_to_string(&config.path)
            .unwrap()
            .parse::<DocumentMut>()
            .unwrap();
        assert_eq!(doc["model"].as_str(), Some("gpt-acme"));
        assert_eq!(doc["model_provider"].as_str(), Some("acme"));
        assert_eq!(
            doc["model_providers"]["acme"]["base_url"].as_str(),
            Some("https://acme.example/v1")
        );
        // The user's notify survives; the channel's is not a managed key.
        assert_eq!(
            doc["notify"]
                .as_array()
                .unwrap()
                .iter()
                .next()
                .unwrap()
                .as_str(),
            Some("x")
        );
        let auth_doc: Value =
            serde_json::from_str(&std::fs::read_to_string(&auth.path).unwrap()).unwrap();
        assert_eq!(auth_doc["OPENAI_API_KEY"], "sk-ccs");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn kimi_writes_provider_alias_and_default() {
        let (dir, target) = fixture("kimi", "config.toml");
        std::fs::write(
            &target.path,
            "default_model = \"kimi-code/k3\"\n\n[[hooks]]\nevent = \"Stop\"\n",
        )
        .unwrap();
        let p = channel(&[
            ("baseUrl", "https://k.example/v1"),
            ("apiKey", "sk-k"),
            ("model", "k2"),
        ]);
        apply_kimi(&target, &p).unwrap();
        let text = std::fs::read_to_string(&target.path).unwrap();
        let doc = text.parse::<DocumentMut>().unwrap();
        assert_eq!(doc["default_model"].as_str(), Some("ccgui"));
        assert_eq!(doc["providers"]["ccgui"]["type"].as_str(), Some("openai"));
        assert_eq!(
            doc["providers"]["ccgui"]["base_url"].as_str(),
            Some("https://k.example/v1")
        );
        assert_eq!(doc["providers"]["ccgui"]["api_key"].as_str(), Some("sk-k"));
        assert_eq!(doc["models"]["ccgui"]["provider"].as_str(), Some("ccgui"));
        assert_eq!(doc["models"]["ccgui"]["model"].as_str(), Some("k2"));
        assert!(text.contains("[[hooks]]"), "user hooks survive: {text}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn kimi_model_only_sets_default_verbatim() {
        let (dir, target) = fixture("kimi-model", "config.toml");
        let p = channel(&[("model", "kimi-code/k3")]);
        apply_kimi(&target, &p).unwrap();
        let doc = std::fs::read_to_string(&target.path)
            .unwrap()
            .parse::<DocumentMut>()
            .unwrap();
        assert_eq!(doc["default_model"].as_str(), Some("kimi-code/k3"));
        assert!(doc.get("providers").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn grok_writes_endpoints_default_and_key() {
        let (dir, target) = fixture("grok", "config.toml");
        std::fs::write(
            &target.path,
            "[model.\"grok-4.6\"]\nname = \"Grok 4.6\"\ncontext_window = 200000\n",
        )
        .unwrap();
        let p = channel(&[
            ("baseUrl", "https://g.example/v1/"),
            ("apiKey", "sk-g"),
            ("model", "grok-4.6"),
        ]);
        apply_grok(&target, &p).unwrap();
        let doc = std::fs::read_to_string(&target.path)
            .unwrap()
            .parse::<DocumentMut>()
            .unwrap();
        assert_eq!(
            doc["endpoints"]["models_base_url"].as_str(),
            Some("https://g.example/v1")
        );
        assert_eq!(
            doc["endpoints"]["models_list_url"].as_str(),
            Some("https://g.example/v1/models")
        );
        assert_eq!(doc["models"]["default"].as_str(), Some("grok-4.6"));
        let table = &doc["model"]["grok-4.6"];
        assert_eq!(table["api_key"].as_str(), Some("sk-g"));
        // Pre-existing fields of the model table survive.
        assert_eq!(table["context_window"].as_integer(), Some(200000));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pseudo_ids_and_display_only_engines_touch_nothing() {
        let (dir, _t) = fixture("noop", "settings.json");
        let p = channel(&[("baseUrl", "https://x.example")]);
        apply("claude", DISABLED_PROVIDER_ID, Some(&p)).unwrap();
        assert!(dir.read_dir().unwrap().next().is_none());
        apply("pi", "some-id", Some(&p)).unwrap();
        assert!(dir.read_dir().unwrap().next().is_none());
        apply("agy", "some-id", Some(&p)).unwrap();
        assert!(dir.read_dir().unwrap().next().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
