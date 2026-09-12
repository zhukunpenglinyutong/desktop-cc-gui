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
//! resolve, so it is deliberately not a source. Remaining
//! engines are filled by the frontend from the configured provider channels
//! instead.

mod claude;
mod codex;
mod grok;
mod kimi;
mod pi;

/// Claude launch-time model resolution: picker alias → the custom id its
/// ANTHROPIC_DEFAULT_<FAMILY>_MODEL override maps to (pass-through when
/// unmapped), so the request carries the model the picker displayed even
/// when the CLI build skips its own env remap.
pub(crate) fn resolve_claude_launch_model(selector: &str) -> String {
    claude::resolve_launch_model(selector)
}

use serde::Serialize;

/// Catalog probe budget; with extension boot skipped the call lands in ~1s,
/// this is pure slow-machine headroom.
const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// Run one catalog probe (`bin args…`) under the shared budget; stdout as
/// lossy UTF-8 on success. `probe` names the subcommand in error messages
/// ("models --json").
pub(super) async fn run_probe(bin: &str, args: &[&str], probe: &str) -> Result<String, String> {
    let mut cmd = super::command_for_binary(bin);
    for arg in args {
        cmd.arg(arg);
    }
    // A timed-out probe must not outlive its budget: kill_on_drop kills the
    // child with the handle instead of leaking a half-finished CLI.
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    super::hide_console(&mut cmd);
    let output = tokio::time::timeout(PROBE_TIMEOUT, cmd.output())
        .await
        .map_err(|_| format!("{bin} {probe} timed out"))?
        .map_err(|e| format!("failed to run {bin}: {e}"))?;
    if !output.status.success() {
        return Err(format!("{bin} {probe} exited with {}", output.status));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
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
}

impl EngineCatalog {
    fn authoritative(models: Vec<EngineModel>) -> Self {
        Self {
            models,
            authoritative: true,
        }
    }
}

#[tauri::command]
pub async fn list_engine_models(engine: String) -> Result<EngineCatalog, String> {
    match engine.as_str() {
        "codex" => Ok(codex_catalog().await),
        "kimi" => Ok(kimi_catalog().await),
        "grok" => Ok(grok_catalog()),
        "claude" => Ok(claude_catalog()),
        "pi" | "omp" => Ok(pi_family_catalog(&engine).await),
        "dsh" => dsh_catalog().await,
        // Unknown engine: no CLI-sourced catalog — the frontend fills the
        // picker from the configured provider channels.
        _ => Ok(EngineCatalog::authoritative(Vec::new())),
    }
}

/// DSH has no CLI-side catalog: the model list lives on the running host
/// (`session/modelCatalog` RPC — 0.1.2 removed `llm.models`), grouped by
/// provider with `default` carrying the host's current model. Never spawns
/// the host — a down host is an error so the frontend keeps whatever catalog
/// it already has instead of blanking the picker.
async fn dsh_catalog() -> Result<EngineCatalog, String> {
    let settings = crate::settings::read_settings().unwrap_or_default();
    let origin = crate::dsh_host::configured_origin(&settings);
    let catalog = crate::dsh_host::host_call(&origin, "session/modelCatalog", serde_json::json!({}))
        .await
        .map_err(|_| format!("DSH host 未运行（{origin}）。在设置 → DeepSeek Harness 里启动后再试。"))?;
    Ok(EngineCatalog::authoritative(flatten_llm_models(
        &catalog,
        catalog.get("default"),
    )))
}

/// `session/modelCatalog` value `{groups: [{id, name, models: [{id, name,
/// description, default}]}], default: {provider, model}}` → flat catalog
/// entries with `provider/model` selector ids. The host's current model
/// (`default`) or the group-marked default leads.
fn flatten_llm_models(catalog: &serde_json::Value, describe: Option<&serde_json::Value>) -> Vec<EngineModel> {
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
            if default_id.is_none() && model.get("default").and_then(serde_json::Value::as_bool) == Some(true) {
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

async fn codex_catalog() -> EngineCatalog {
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, "codex");
    if let Ok(models) = codex::run_codex_debug_models(&bin).await {
        if !models.is_empty() {
            return EngineCatalog::authoritative(with_default_first(
                models,
                codex::codex_config_model(),
            ));
        }
    }
    EngineCatalog::authoritative(codex::codex_config_model().into_iter().collect())
}

async fn kimi_catalog() -> EngineCatalog {
    // The CLI's own registry is ground truth for `-m` aliases; the
    // config's [models.*] tables are the offline equivalent (same alias
    // semantics), then the CLI's configured default as a single-entry
    // fallback. No relay probe: `kimi -m` takes aliases, not raw API ids.
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, "kimi");
    if let Ok(models) = kimi::run_kimi_provider_list(&bin).await {
        if !models.is_empty() {
            return EngineCatalog::authoritative(with_default_first(
                models,
                kimi::kimi_default_model(),
            ));
        }
    }
    let local = kimi::kimi_local_models();
    if !local.is_empty() {
        return EngineCatalog::authoritative(local);
    }
    EngineCatalog::authoritative(kimi::kimi_default_model().into_iter().collect())
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

async fn pi_family_catalog(engine: &str) -> EngineCatalog {
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = super::engine_bin(&settings, engine);
    let configured = pi::configured_models(engine).unwrap_or_default();
    if let Ok(models) = pi::run_models_json(&bin).await {
        if !models.is_empty() {
            return EngineCatalog::authoritative(pi::merge_configured_models(models, configured));
        }
    }
    // Fresh binaries skip extension boot; old ones fall back to a bare run.
    for extra in [&["--no-extensions"][..], &[][..]] {
        if let Ok(models) = pi::run_list_models(&bin, extra).await {
            if !models.is_empty() {
                return EngineCatalog::authoritative(pi::merge_configured_models(
                    models,
                    configured,
                ));
            }
        }
    }
    // A missing/broken CLI is not an error here: the picker falls back to
    // provider-config models.
    EngineCatalog::authoritative(configured)
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
fn with_default_first(models: Vec<EngineModel>, default: Option<EngineModel>) -> Vec<EngineModel> {
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
}
