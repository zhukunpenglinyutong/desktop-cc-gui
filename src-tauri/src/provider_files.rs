//! Materialize provider channels into each CLI's native config files.
//!
//! Switching a channel (`set_current_provider`) writes the channel into the
//! CLI's own configuration instead of injecting env vars at spawn time:
//!
//! | engine | file(s) | what is written |
//! |--------|---------|-----------------|
//! | claude | `$CLAUDE_CONFIG_DIR/settings.json` (`~/.claude`) | channel env merged into the top-level `env` block (cc-switch `settingsConfig` keys merged alongside) |
//! | codex  | `$CODEX_HOME/config.toml` + `auth.json` (`~/.codex`) | `model`/`model_provider`/`model_providers` (or a cc-switch verbatim config's managed keys), `OPENAI_API_KEY` |
//! | kimi   | `$KIMI_CODE_HOME/config.toml` (`~/.kimi-code`) | `[providers."ccgui"]` (type `openai`), `[models."ccgui"]`, `default_model` |
//! | grok   | `$GROK_HOME/config.toml` (`~/.grok`) | `[endpoints]` base URLs, `[models].default`, `[model."<alias>"].api_key` |
//!
//! pi/omp/dsh keep providers display-only: applying them is a no-op.
//!
//! Backup discipline: before the first managed write to a file, the original
//! is snapshotted under `app_home()/provider-backups/<engine>/` (an `.absent`
//! marker records "the file did not exist"). Every apply rewrites from the
//! snapshot, so managed keys never accumulate across switches, and the
//! 官方配置 pseudo-provider restores the snapshot — the CLI's own file exactly
//! as it was before cc-gui managed it. TOML files are patched with toml_edit
//! so user comments and formatting survive.

use serde_json::Value;
use std::path::{Path, PathBuf};
use toml_edit::{value, DocumentMut, Item, Table};

use crate::config::{DISABLED_PROVIDER_ID, LEGACY_LOCAL_CONFIG_TOML_ID, LOCAL_PROVIDER_ID};

/// Entry point: make the CLI's native config reflect `id`/`provider`.
/// `provider` is `None` for the pseudo ids (官方配置 / 停用).
pub fn apply(engine: &str, id: &str, provider: Option<&Value>) -> Result<(), String> {
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
        // pi/omp/dsh providers are display-only.
        _ => Ok(()),
    }
}

// ── File targets & backups ──────────────────────────────────────────────────

struct Target {
    path: PathBuf,
    backup: PathBuf,
}

/// Native config files an engine's channel writes to, with their backup
/// paths. Engines without writable provider config return an empty list.
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
        _ => Vec::new(),
    }
}

fn absent_marker(backup: &Path) -> PathBuf {
    backup.with_extension("absent")
}
/// Native config files a channel switch on `engine` would rewrite, shown in
/// the UI's switch confirmation so the user can back them up first. Empty for
/// engines whose providers are display-only (pi/omp/dsh).
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

/// True when the engine's native files currently hold the official (CLI's
/// own) configuration: never managed, restored, or parked on 停用 straight
/// from the official state. Only then is editing them safe — while a channel
/// is current the files carry cc-gui's managed patch and the official
/// original sits in the backup snapshot.
fn official_files_active(section: &crate::config::ProviderSection) -> bool {
    fn is_official(id: Option<&str>) -> bool {
        matches!(
            id,
            None | Some("") | Some(LOCAL_PROVIDER_ID) | Some(LEGACY_LOCAL_CONFIG_TOML_ID)
        )
    }
    match section.current.as_deref() {
        Some(DISABLED_PROVIDER_ID) => is_official(section.disabled_from.as_deref()),
        current => is_official(current),
    }
}

/// Files of the engine's 官方配置, in pane order. Empty for engines without
/// a native config file (pi/omp/dsh — their official state lives in auth
/// stores edited by their own sections).
#[tauri::command]
pub fn official_config_read(engine: String) -> Result<Vec<OfficialConfigFile>, String> {
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

/// Overwrite 官方配置 files, gated on the official state being live (see
/// official_files_active). Everything is validated before any write; each
/// write then syncs the backup snapshot so a later channel switch patches
/// on top of the edited official and switching back restores exactly it.
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
    if !official_files_active(section) {
        return Err(format!(
            "{engine}: 官方配置 is editable only while it is the active configuration"
        ));
    }
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
    crate::settings::atomic_write(&target.path, content)?;
    let marker = absent_marker(&target.backup);
    if target.backup.exists() {
        crate::settings::atomic_write(&target.backup, content)?;
    } else if marker.exists() {
        // The file we created was deleted on restore; the user's edit makes
        // it real content now, so restore must write it back, not delete it.
        std::fs::remove_file(&marker).map_err(|e| format!("remove {}: {e}", marker.display()))?;
        crate::settings::atomic_write(&target.backup, content)?;
    }
    Ok(())
}

/// Snapshot the file before the first managed write. An existing backup wins
/// (it is the pre-cc-gui original); a missing file is recorded with an
/// `.absent` marker so restore can remove what we created.
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

/// Loader/hook env keys a stored channel must never write into a CLI's
/// settings: they hand code execution to whoever wrote the config file.
/// Prefix families (DYLD_/LD_) are matched by prefix, the rest exactly;
/// comparison is case-insensitive because launchd/cmd env casing varies.
fn is_blocked_env_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    if upper.starts_with("DYLD_") || upper.starts_with("LD_") {
        return true;
    }
    matches!(
        upper.as_str(),
        "NODE_OPTIONS"
            | "NODE_REPL_EXTERNAL_MODULE"
            | "BASH_ENV"
            | "ENV"
            | "SHELLOPTS"
            | "PYTHONSTARTUP"
            | "PYTHONINSPECT"
            | "RUBYOPT"
            | "PERL5OPT"
            | "GIT_SSH_COMMAND"
            | "SSH_ASKPASS"
            | "PROMPT_COMMAND"
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

/// Claude settings.json env entries: raw env maps first (blocked keys and
/// empties refused), convention fields only where raw env has no value —
/// raw env wins, same precedence the old spawn-time injection used.
fn claude_channel_env(provider: &Value) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for map in channel_env_maps(provider) {
        for (key, val) in map {
            if seen.contains(key) || is_blocked_env_key(key) {
                if is_blocked_env_key(key) {
                    eprintln!("[provider_files] refusing to write blocked env key: {key}");
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
            out.push((key.clone(), scalar));
        }
    }
    for (field, var) in env_mapping("claude") {
        if var.is_empty() || seen.contains(var) {
            continue;
        }
        if let Some(v) = channel_field("claude", provider, field) {
            seen.insert(var.to_string());
            out.push((var.to_string(), v));
        }
    }
    out
}

// ── claude: settings.json ───────────────────────────────────────────────────

fn apply_claude(target: &Target, provider: &Value) -> Result<(), String> {
    snapshot_once(target)?;
    let base = base_content(target, "{}")?;
    let mut doc: Value =
        serde_json::from_str(&base).map_err(|e| format!("parse {}: {e}", target.path.display()))?;
    if !doc.is_object() {
        return Err(format!(
            "{}: root is not a JSON object",
            target.path.display()
        ));
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
    let env = claude_channel_env(provider);
    if !env.is_empty() {
        if !doc.get("env").is_some_and(Value::is_object) {
            doc["env"] = Value::Object(serde_json::Map::new());
        }
        for (key, val) in env {
            doc["env"][key] = Value::String(val);
        }
    }
    let content = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    crate::settings::atomic_write(&target.path, &content)
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

fn apply_codex(config: &Target, auth: &Target, provider: &Value) -> Result<(), String> {
    let api_key = non_empty_str(
        provider
            .get("settingsConfig")
            .and_then(|s| s.get("auth"))
            .and_then(|a| a.get("OPENAI_API_KEY")),
    )
    .or_else(|| channel_field("codex", provider, "apiKey"));
    if let Some(key) = api_key {
        snapshot_once(auth)?;
        let base = base_content(auth, "{}")?;
        let mut doc: Value = serde_json::from_str(&base)
            .map_err(|e| format!("parse {}: {e}", auth.path.display()))?;
        if !doc.is_object() {
            return Err(format!(
                "{}: root is not a JSON object",
                auth.path.display()
            ));
        }
        doc["OPENAI_API_KEY"] = Value::String(key);
        let content = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
        crate::settings::atomic_write(&auth.path, &content)?;
    }

    snapshot_once(config)?;
    let base = base_content(config, "")?;
    let mut doc = base
        .parse::<DocumentMut>()
        .map_err(|e| format!("parse {}: {e}", config.path.display()))?;
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
    crate::settings::atomic_write(&config.path, &doc.to_string())
}

// ── kimi: config.toml ───────────────────────────────────────────────────────

fn apply_kimi(target: &Target, provider: &Value) -> Result<(), String> {
    snapshot_once(target)?;
    let base = base_content(target, "")?;
    let mut doc = base
        .parse::<DocumentMut>()
        .map_err(|e| format!("parse {}: {e}", target.path.display()))?;
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
    crate::settings::atomic_write(&target.path, &doc.to_string())
}

// ── grok: config.toml ───────────────────────────────────────────────────────

fn apply_grok(target: &Target, provider: &Value) -> Result<(), String> {
    snapshot_once(target)?;
    let base = base_content(target, "")?;
    let mut doc = base
        .parse::<DocumentMut>()
        .map_err(|e| format!("parse {}: {e}", target.path.display()))?;
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
    crate::settings::atomic_write(&target.path, &doc.to_string())
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

    fn section(
        current: Option<&str>,
        disabled_from: Option<&str>,
    ) -> crate::config::ProviderSection {
        crate::config::ProviderSection {
            providers: Default::default(),
            current: current.map(str::to_string),
            disabled_from: disabled_from.map(str::to_string),
        }
    }

    #[test]
    fn official_files_active_truth_table() {
        // Never switched, or parked on an official pseudo id.
        assert!(official_files_active(&section(None, None)));
        assert!(official_files_active(&section(Some(LOCAL_PROVIDER_ID), None)));
        assert!(official_files_active(&section(Some(LEGACY_LOCAL_CONFIG_TOML_ID), None)));
        // A live channel means the files carry our managed patch.
        assert!(!official_files_active(&section(Some("chan-a"), None)));
        // 停用 preserves whatever was live when the switch flipped.
        assert!(official_files_active(&section(
            Some(DISABLED_PROVIDER_ID),
            Some(LOCAL_PROVIDER_ID)
        )));
        assert!(official_files_active(&section(Some(DISABLED_PROVIDER_ID), None)));
        assert!(!official_files_active(&section(
            Some(DISABLED_PROVIDER_ID),
            Some("chan-a")
        )));
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
    fn write_official_syncs_the_snapshot() {
        let (dir, target) = fixture("official-sync", "settings.json");
        std::fs::create_dir_all(target.backup.parent().unwrap()).unwrap();
        std::fs::write(&target.path, r#"{"a":1}"#).unwrap();
        std::fs::write(&target.backup, r#"{"a":1}"#).unwrap();
        write_official(&target, r#"{"a":2}"#).unwrap();
        // Live file and snapshot move together, so a later channel switch
        // patches on top of the edited official and restore returns to it.
        assert_eq!(std::fs::read_to_string(&target.path).unwrap(), r#"{"a":2}"#);
        assert_eq!(std::fs::read_to_string(&target.backup).unwrap(), r#"{"a":2}"#);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_official_upgrades_absent_marker_to_snapshot() {
        let (dir, target) = fixture("official-absent", "settings.json");
        std::fs::create_dir_all(target.backup.parent().unwrap()).unwrap();
        std::fs::write(absent_marker(&target.backup), "").unwrap();
        write_official(&target, r#"{"b":1}"#).unwrap();
        assert!(!absent_marker(&target.backup).exists());
        assert_eq!(std::fs::read_to_string(&target.backup).unwrap(), r#"{"b":1}"#);
        // A subsequent restore writes the new official back instead of
        // deleting the file.
        restore(&target).unwrap();
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
        let _ = std::fs::remove_dir_all(&dir);
    }
}
