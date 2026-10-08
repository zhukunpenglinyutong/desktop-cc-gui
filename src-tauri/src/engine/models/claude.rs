//! Claude's catalog comes from the CLI's own configuration, not the app's
//! provider channels: `claude --model` resolves the built-in aliases the
//! /model menu lists, and the CLI's configured default lives in
//! ~/.claude/settings.json (settings.local.json overrides it). The concrete
//! model id each alias resolves to is read from the registry the CLI embeds
//! in its own binary, so the picker names the real model instead of the
//! bare family name. No relay probe: the /model menu is built into the CLI
//! binary, so a channel's /v1/models would list ids the CLI never offers.

use std::path::PathBuf;

use super::EngineModel;
/// The model registry the CLI embeds in its binary (native build or cli.js
/// bundle alike): per-family alias defaults (`aliases.<family>.default`),
/// the `best` alias used when nothing is configured, and each model's
/// human display name. Extracted from raw bytes; the JS object survives
/// bundling verbatim.
#[derive(Clone, Debug, Default)]
pub(super) struct EmbeddedRegistry {
    /// alias family → resolved first-party model id ("opus" → "claude-opus-5").
    alias_defaults: std::collections::HashMap<String, String>,
    provider_defaults: std::collections::HashMap<(String, String), String>,
    /// model id → human name ("claude-opus-5" → "Opus 5").
    display_names: std::collections::HashMap<String, String>,
    /// The CLI's built-in default alias when no model is configured.
    best: Option<String>,
}

impl EmbeddedRegistry {
    /// "Opus 5 · claude-opus-5" for a known selector (alias or id, with or
    /// without the [1m] suffix); the selector verbatim when the registry
    /// can't resolve it.
    fn display_line(&self, selector: &str) -> String {
        let bare = selector.strip_suffix("[1m]").unwrap_or(selector);
        let id = self
            .alias_defaults
            .get(bare)
            .map(String::as_str)
            .unwrap_or(bare);
        match self.display_names.get(id) {
            Some(name) => format!("{name} · {id}"),
            None => id.to_string(),
        }
    }
}

/// Parse the embedded registry out of the binary's raw bytes.
fn parse_registry(bytes: &[u8]) -> EmbeddedRegistry {
    use regex::bytes::Regex;
    let mut registry = EmbeddedRegistry::default();
    // Models array: `id:"claude-opus-5",family:"opus",display_name:"Opus 5"`.
    let models_re = Regex::new(r#"id:"([^"]+)",family:"[a-z]+",display_name:"([^"]+)""#).unwrap();
    for m in models_re.captures_iter(bytes) {
        registry.display_names.insert(
            String::from_utf8_lossy(&m[1]).into_owned(),
            String::from_utf8_lossy(&m[2]).into_owned(),
        );
    }
    // `aliases:{opus:{default:"claude-opus-5",per_provider:{…}},…}` followed
    // by `defaults:{…},best:"fable"` — one compact object, so bound the
    // window to keep unrelated `{default:"…"}` code from leaking in.
    let aliases_re = Regex::new(r"aliases:\{").unwrap();
    let family_re = Regex::new(r#"([a-z]+):\{default:"([^"]+)""#).unwrap();
    let provider_family_re =
        Regex::new(r#"([a-z]+):\{default:"[^"]+",per_provider:\{([^}]+)\}"#).unwrap();
    let provider_re = Regex::new(r#"([a-z]+):"([^"]+)""#).unwrap();
    let best_re = Regex::new(r#",best:"([^"]+)""#).unwrap();
    for m in aliases_re.find_iter(bytes) {
        let window = &bytes[m.start()..(m.start() + 2048).min(bytes.len())];
        for f in family_re.captures_iter(window) {
            registry.alias_defaults.insert(
                String::from_utf8_lossy(&f[1]).into_owned(),
                String::from_utf8_lossy(&f[2]).into_owned(),
            );
        }
        for family in provider_family_re.captures_iter(window) {
            for provider in provider_re.captures_iter(&family[2]) {
                registry.provider_defaults.insert(
                    (
                        String::from_utf8_lossy(&family[1]).into_owned(),
                        String::from_utf8_lossy(&provider[1]).into_owned(),
                    ),
                    String::from_utf8_lossy(&provider[2]).into_owned(),
                );
            }
        }
        if registry.best.is_none() {
            if let Some(b) = best_re.captures(window) {
                registry.best = Some(String::from_utf8_lossy(&b[1]).into_owned());
            }
        }
    }
    registry
}

/// Read the CLI binary's embedded registry, cached per binary content: the
/// picker re-queries on every open and the scan reads the whole binary.
/// None for shims/old builds without an extractable registry — the catalog
/// then degrades to bare family names.
fn embedded_registry(bin: &std::path::Path) -> Option<EmbeddedRegistry> {
    struct CacheEntry {
        len: u64,
        modified: Option<std::time::SystemTime>,
        registry: Option<EmbeddedRegistry>,
    }
    static CACHE: std::sync::LazyLock<parking_lot::Mutex<Option<CacheEntry>>> =
        std::sync::LazyLock::new(|| parking_lot::Mutex::new(None));
    let meta = std::fs::metadata(bin).ok()?;
    let (len, modified) = (meta.len(), meta.modified().ok());
    if let Some(entry) = CACHE.lock().as_ref() {
        if entry.len == len && entry.modified == modified {
            return entry.registry.clone();
        }
    }
    let registry = std::fs::read(bin)
        .ok()
        .map(|bytes| parse_registry(&bytes))
        .filter(|r| !r.alias_defaults.is_empty());
    *CACHE.lock() = Some(CacheEntry {
        len,
        modified,
        registry: registry.clone(),
    });
    registry
}

/// Selectors `claude --model` accepts out of the box — exactly the five rows
/// the CLI's own /model menu lists, in menu order (no [1m] variants, no
/// extra "configured" row). "fable" only exists on newer CLI builds — the
/// catalog is advisory, an unresolvable pick fails at launch with the CLI's
/// own error.
const CLI_ALIASES: &[(&str, &str)] = &[
    ("default", "Default"),
    ("opus", "Opus"),
    ("fable", "Fable"),
    ("sonnet", "Sonnet"),
    ("haiku", "Haiku"),
];

/// The CLI's config root: $CLAUDE_CONFIG_DIR when set, else ~/.claude.
fn claude_config_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    dirs::home_dir().expect("no home directory").join(".claude")
}

/// env keys that remap a built-in alias family to a custom model id,
/// mirroring the CLI's own /model menu ("Custom Opus model" rows).
const FAMILY_ENV_KEYS: &[(&str, &str, &str)] = &[
    // (alias family, env key, display name)
    ("opus", "ANTHROPIC_DEFAULT_OPUS_MODEL", "Opus"),
    ("sonnet", "ANTHROPIC_DEFAULT_SONNET_MODEL", "Sonnet"),
    ("haiku", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "Haiku"),
    ("fable", "ANTHROPIC_DEFAULT_FABLE_MODEL", "Fable"),
];

/// The CLI's model configuration from ~/.claude/settings.json, merged per
/// field with settings.local.json winning (the CLI's own precedence).
#[derive(Default)]
struct CliModelConfig {
    /// env.ANTHROPIC_MODEL — the CLI's effective default model id.
    env_model: Option<String>,
    /// Top-level `model` key (an alias like "opus" or a raw id).
    model_key: Option<String>,
    /// env.ANTHROPIC_DEFAULT_<FAMILY>_MODEL overrides, keyed by family.
    overrides: std::collections::HashMap<String, String>,
    provider_flags: std::collections::HashMap<String, String>,
}

impl CliModelConfig {
    /// The custom id a family alias resolves to, when overridden.
    fn override_for(&self, family: &str) -> Option<&str> {
        self.overrides.get(family).map(String::as_str)
    }

    /// The CLI's effective default model id: env.ANTHROPIC_MODEL beats the
    /// `model` key (the CLI applies settings env as real environment
    /// variables); a bare family alias there resolves through its override.
    fn resolved_default(&self) -> Option<String> {
        let raw = self.env_model.as_deref().or(self.model_key.as_deref())?;
        let family = raw.strip_suffix("[1m]").unwrap_or(raw);
        Some(self.override_for(family).unwrap_or(raw).to_string())
    }
}

fn read_cli_config() -> CliModelConfig {
    read_cli_config_from(&claude_config_dir())
}

/// The model id a picker selector actually runs, for launch: a family alias
/// resolves through its ANTHROPIC_DEFAULT_<FAMILY>_MODEL override, "default"
/// through the CLI's configured default; anything unmapped passes through
/// for the CLI to resolve itself. Relay setups depend on the env remap,
/// which some CLI builds/shims skip — launching with the id the picker
/// names makes the request match the display regardless.
pub(crate) fn resolve_launch_model(selector: &str) -> String {
    resolve_launch_model_from(&read_cli_config(), selector)
}

fn resolve_launch_model_from(config: &CliModelConfig, selector: &str) -> String {
    let bare = selector.strip_suffix("[1m]").unwrap_or(selector);
    if bare == "default" {
        return config
            .resolved_default()
            .unwrap_or_else(|| selector.to_string());
    }
    config
        .override_for(bare)
        .map(str::to_string)
        .unwrap_or_else(|| selector.to_string())
}

/// Resolve only the comparison evidence; keep the CLI's selector unchanged.
/// Remote binaries are not inferred from the host's registry.
pub(crate) fn comparison_model(
    selector: &str,
    bin: Option<&std::path::Path>,
    channel_env: Option<&std::collections::HashMap<String, String>>,
    workspace: &std::path::Path,
    remote: bool,
) -> Option<String> {
    let config = match channel_env {
        Some(env) => {
            let mut config = CliModelConfig::default();
            merge_settings_json(&mut config, &serde_json::json!({"env": env}).to_string());
            config
        }
        None if remote => CliModelConfig::default(),
        None => {
            let mut config = CliModelConfig::default();
            let env: std::collections::HashMap<_, _> = FAMILY_ENV_KEYS
                .iter()
                .map(|(_, key, _)| *key)
                .chain([
                    "ANTHROPIC_MODEL",
                    "CLAUDE_CODE_USE_BEDROCK",
                    "CLAUDE_CODE_USE_VERTEX",
                    "CLAUDE_CODE_USE_FOUNDRY",
                ])
                .filter_map(|key| std::env::var(key).ok().map(|value| (key, value)))
                .collect();
            merge_settings_json(&mut config, &serde_json::json!({"env": env}).to_string());
            for dir in [claude_config_dir(), workspace.join(".claude")] {
                for name in ["settings.json", "settings.local.json"] {
                    if let Ok(content) = std::fs::read_to_string(dir.join(name)) {
                        merge_settings_json(&mut config, &content);
                    }
                }
            }
            config
        }
    };
    let registry = if remote {
        None
    } else {
        bin.and_then(embedded_registry)
    };
    comparison_model_from(selector, &config, registry.as_ref())
}

fn comparison_model_from(
    selector: &str,
    config: &CliModelConfig,
    registry: Option<&EmbeddedRegistry>,
) -> Option<String> {
    let selector = if selector == "default" {
        config
            .resolved_default()
            .or_else(|| registry.and_then(|r| r.best.clone()))?
    } else {
        selector.to_string()
    };
    let bare = selector.strip_suffix("[1m]").unwrap_or(&selector);
    let mapped = config.override_for(bare).unwrap_or(bare);
    if !CLI_ALIASES.iter().any(|(alias, _)| *alias == mapped) {
        return Some(mapped.to_string());
    }
    let registry = registry?;
    let provider = [
        ("CLAUDE_CODE_USE_BEDROCK", "bedrock"),
        ("CLAUDE_CODE_USE_VERTEX", "vertex"),
        ("CLAUDE_CODE_USE_FOUNDRY", "foundry"),
    ]
    .into_iter()
    .find_map(|(key, provider)| {
        config
            .provider_flags
            .get(key)
            .filter(|value| value.as_str() == "1" || value.as_str() == "true")
            .map(|_| provider)
    });
    match provider {
        Some(provider) => registry
            .provider_defaults
            .get(&(mapped.to_string(), provider.to_string()))
            .cloned(),
        None => registry.alias_defaults.get(mapped).cloned(),
    }
}

fn read_cli_config_from(dir: &std::path::Path) -> CliModelConfig {
    let mut config = CliModelConfig::default();
    // User settings first so the local file overrides per field.
    for name in ["settings.json", "settings.local.json"] {
        if let Ok(content) = std::fs::read_to_string(dir.join(name)) {
            merge_settings_json(&mut config, &content);
        }
    }
    config
}

/// Per-field settings merge (settings.local.json wins), shared by the local
/// read and the remote (WSL distro) variant.
fn merge_settings_json(config: &mut CliModelConfig, content: &str) {
    let pick = |value: Option<&serde_json::Value>| {
        value
            .and_then(|m| m.as_str())
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .map(str::to_string)
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(content) else {
        return;
    };
    let env = v.get("env");
    for key in [
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
    ] {
        if let Some(value) = pick(env.and_then(|e| e.get(key))) {
            config.provider_flags.insert(key.to_string(), value);
        }
    }
    if let Some(m) = pick(env.and_then(|e| e.get("ANTHROPIC_MODEL"))) {
        config.env_model = Some(m);
    }
    if let Some(m) = pick(v.get("model")) {
        config.model_key = Some(m);
    }
    for (family, key, _) in FAMILY_ENV_KEYS {
        if let Some(m) = pick(env.and_then(|e| e.get(key))) {
            config.overrides.insert(family.to_string(), m);
        }
    }
}

/// Remote (WSL distro) catalog from the distro's `$CLAUDE_CONFIG_DIR`
/// settings contents (fetched via ssh by the caller). Aliases are CLI
/// built-ins; only the per-field overrides come from config, so the distro
/// settings reproduce its own /model menu.
pub(super) fn claude_models_remote(user_json: &str, local_json: &str) -> Vec<EngineModel> {
    let mut config = CliModelConfig::default();
    merge_settings_json(&mut config, user_json);
    merge_settings_json(&mut config, local_json);
    claude_models_from(config, None)
}

/// Claude's picker catalog: the CLI's built-in aliases, default row first.
/// Aliases remapped via ANTHROPIC_DEFAULT_<FAMILY>_MODEL display the custom
/// id as the name with the CLI menu's "Custom <Family> model" subtitle;
/// unremapped aliases name the concrete model the CLI's embedded registry
/// resolves them to, so the picker shows what a request actually runs.
pub(super) fn claude_models(bin: Option<&std::path::Path>) -> Vec<EngineModel> {
    claude_models_from(read_cli_config(), bin.and_then(embedded_registry).as_ref())
}

fn claude_models_from(
    config: CliModelConfig,
    registry: Option<&EmbeddedRegistry>,
) -> Vec<EngineModel> {
    // Nothing configured: the CLI runs the registry's `best` alias.
    let resolved_default = config
        .resolved_default()
        .or_else(|| registry.and_then(|r| r.best.clone()));
    CLI_ALIASES
        .iter()
        .map(|(id, name)| {
            let display = FAMILY_ENV_KEYS
                .iter()
                .find(|(f, _, _)| *f == *id)
                .map(|(_, _, d)| *d);
            let custom = config.override_for(id);
            let (name, description) = match (display, custom) {
                (Some(display), Some(custom)) => (
                    Some(custom.to_string()),
                    Some(format!("Custom {display} model")),
                ),
                _ if *id == "default" => (
                    Some(name.to_string()),
                    resolved_default.as_ref().map(|d| {
                        let line = registry
                            .map(|r| r.display_line(d))
                            .unwrap_or_else(|| d.clone());
                        format!("Use the default model (currently {line})")
                    }),
                ),
                _ => (
                    Some(name.to_string()),
                    registry.and_then(|r| {
                        r.alias_defaults
                            .get(*id)
                            .map(|model_id| r.display_line(model_id))
                    }),
                ),
            };
            EngineModel {
                id: id.to_string(),
                name,
                description,
                provider: "claude".to_string(),
                context_window: None,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aliases_cover_the_cli_model_menu() {
        let ids: Vec<&str> = CLI_ALIASES.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids, vec!["default", "opus", "fable", "sonnet", "haiku"]);
    }

    #[test]
    fn cli_config_local_overrides_user_per_field() {
        let dir = std::env::temp_dir().join(format!("ccgui-claude-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"model":"opus","env":{"ANTHROPIC_MODEL":"sonnet","ANTHROPIC_DEFAULT_OPUS_MODEL":"grok-4.5"}}"#,
        )
        .unwrap();
        std::fs::write(dir.join("settings.local.json"), r#"{"model":"haiku"}"#).unwrap();
        let config = read_cli_config_from(&dir);
        std::fs::remove_dir_all(&dir).ok();
        // Local `model` wins its field; the user file's env fields survive.
        assert_eq!(config.model_key.as_deref(), Some("haiku"));
        assert_eq!(config.env_model.as_deref(), Some("sonnet"));
        assert_eq!(config.override_for("opus"), Some("grok-4.5"));
        assert_eq!(config.override_for("sonnet"), None);
    }

    #[test]
    fn launch_model_resolves_overrides_and_passes_the_rest_through() {
        let dir = std::env::temp_dir().join(format!("ccgui-claude-test4-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"model":"opus","env":{"ANTHROPIC_DEFAULT_OPUS_MODEL":"gemini-3.8-flash"}}"#,
        )
        .unwrap();
        let config = read_cli_config_from(&dir);
        std::fs::remove_dir_all(&dir).ok();
        // Overridden alias → custom id (what the picker names it).
        assert_eq!(
            resolve_launch_model_from(&config, "opus"),
            "gemini-3.8-flash"
        );
        assert_eq!(
            resolve_launch_model_from(&config, "opus[1m]"),
            "gemini-3.8-flash"
        );
        // "default" → the CLI's configured default, override applied.
        assert_eq!(
            resolve_launch_model_from(&config, "default"),
            "gemini-3.8-flash"
        );
        // Unmapped aliases and raw ids pass through for the CLI to resolve.
        assert_eq!(resolve_launch_model_from(&config, "sonnet"), "sonnet");
        assert_eq!(
            resolve_launch_model_from(&config, "claude-opus-5"),
            "claude-opus-5"
        );
        // Nothing configured: "default" stays an alias for the CLI's `best`.
        assert_eq!(
            resolve_launch_model_from(&CliModelConfig::default(), "default"),
            "default"
        );
    }

    #[test]
    fn cli_config_reads_env_when_no_local_file() {
        let dir = std::env::temp_dir().join(format!("ccgui-claude-test2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"model":"opus","env":{"ANTHROPIC_MODEL":"k3"}}"#,
        )
        .unwrap();
        let config = read_cli_config_from(&dir);
        std::fs::remove_dir_all(&dir).ok();
        // env.ANTHROPIC_MODEL outranks the `model` key within one file.
        assert_eq!(config.resolved_default().as_deref(), Some("k3"));
    }

    #[test]
    fn catalog_labels_overridden_aliases_like_the_cli_menu() {
        let dir = std::env::temp_dir().join(format!("ccgui-claude-test3-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"model":"opus","env":{
                "ANTHROPIC_MODEL":"grok-4.5",
                "ANTHROPIC_DEFAULT_OPUS_MODEL":"grok-4.5",
                "ANTHROPIC_DEFAULT_SONNET_MODEL":"grok-4.5",
                "ANTHROPIC_DEFAULT_HAIKU_MODEL":"grok-4.5",
                "ANTHROPIC_DEFAULT_FABLE_MODEL":"grok-4.5"
            }}"#,
        )
        .unwrap();
        let config = read_cli_config_from(&dir);
        std::fs::remove_dir_all(&dir).ok();
        // The /model menu's main label is the resolved custom id, with the
        // "Custom <Family> model" subtitle the CLI shows.
        let models = claude_models_from(config, None);
        let by_id = |id: &str| models.iter().find(|m| m.id == id).unwrap();
        let opus = by_id("opus");
        assert_eq!(opus.name.as_deref(), Some("grok-4.5"));
        assert_eq!(opus.description.as_deref(), Some("Custom Opus model"));
        assert_eq!(
            by_id("fable").description.as_deref(),
            Some("Custom Fable model")
        );
        let default = by_id("default");
        assert_eq!(default.name.as_deref(), Some("Default"));
        assert_eq!(
            default.description.as_deref(),
            Some("Use the default model (currently grok-4.5)")
        );
        // Exactly the CLI menu's five rows, "default" first — no extra
        // "configured" row, no [1m] variants.
        assert_eq!(models.len(), 5);
        assert_eq!(models[0].id, "default");
    }

    #[test]
    fn resolved_default_maps_alias_through_override() {
        let config = CliModelConfig {
            provider_flags: Default::default(),
            env_model: None,
            model_key: Some("opus[1m]".to_string()),
            overrides: [("opus".to_string(), "grok-4.5".to_string())]
                .into_iter()
                .collect(),
        };
        assert_eq!(config.resolved_default().as_deref(), Some("grok-4.5"));
        // A raw id passes through untouched.
        let config = CliModelConfig {
            env_model: Some("k3".to_string()),
            ..CliModelConfig::default()
        };
        assert_eq!(config.resolved_default().as_deref(), Some("k3"));
    }

    /// A registry snippet shaped exactly like the CLI binary's embedded
    /// object: models array, then aliases/defaults/best.
    fn fake_registry() -> EmbeddedRegistry {
        parse_registry(
            br#"[{id:"claude-opus-4-5",family:"opus",display_name:"Opus 4.5"},{id:"claude-opus-5",family:"opus",display_name:"Opus 5"},{id:"claude-fable-5",family:"fable",display_name:"Fable 5"}],aliases:{opus:{default:"claude-opus-5",per_provider:{bedrock:"claude-opus-5",gateway:"claude-opus-4-7"}},fable:{default:"claude-fable-5"}},defaults:{},best:"fable",latest_per_family:{opus:"claude-opus-5"}});"#,
        )
    }

    #[test]
    fn comparison_resolves_aliases_overrides_and_provider_variants() {
        let registry = fake_registry();
        let mut config = CliModelConfig::default();
        assert_eq!(
            comparison_model_from("opus", &config, Some(&registry)).as_deref(),
            Some("claude-opus-5")
        );
        assert_eq!(
            comparison_model_from("opus[1m]", &config, Some(&registry)).as_deref(),
            Some("claude-opus-5")
        );
        assert_eq!(
            comparison_model_from("default", &config, Some(&registry)).as_deref(),
            Some("claude-fable-5")
        );
        merge_settings_json(&mut config, r#"{"env":{"CLAUDE_CODE_USE_BEDROCK":"1"}}"#);
        assert_eq!(
            comparison_model_from("opus", &config, Some(&registry)).as_deref(),
            Some("claude-opus-5")
        );
        merge_settings_json(
            &mut config,
            r#"{"env":{"CLAUDE_CODE_USE_BEDROCK":"0","CLAUDE_CODE_USE_VERTEX":"1"}}"#,
        );
        assert_eq!(
            comparison_model_from("opus", &config, Some(&registry)),
            None
        );
        merge_settings_json(
            &mut config,
            r#"{"model":"opus","env":{"ANTHROPIC_DEFAULT_OPUS_MODEL":"custom-opus"}}"#,
        );
        assert_eq!(
            comparison_model_from("opus", &config, Some(&registry)).as_deref(),
            Some("custom-opus")
        );
        assert_eq!(
            comparison_model_from("default", &config, None).as_deref(),
            Some("custom-opus")
        );
    }

    #[test]
    fn remote_comparison_uses_only_explicit_channel_mapping() {
        let empty = std::collections::HashMap::new();
        let workspace = std::path::Path::new("/unused");
        assert_eq!(comparison_model("opus", None, None, workspace, true), None);
        assert_eq!(
            comparison_model("opus", None, Some(&empty), workspace, true),
            None
        );
        let mapped = [("ANTHROPIC_DEFAULT_OPUS_MODEL".into(), "remote-opus".into())]
            .into_iter()
            .collect();
        assert_eq!(
            comparison_model("opus", None, Some(&mapped), workspace, true).as_deref(),
            Some("remote-opus")
        );
    }

    #[test]
    fn comparison_does_not_guess_aliases_without_a_registry() {
        let config = CliModelConfig::default();
        for selector in ["opus", "sonnet", "haiku", "fable", "default"] {
            assert_eq!(comparison_model_from(selector, &config, None), None);
        }
        assert_eq!(
            comparison_model_from("claude-opus-5-5", &config, None).as_deref(),
            Some("claude-opus-5-5")
        );
    }

    #[test]
    fn parse_registry_extracts_aliases_displays_and_best() {
        let registry = fake_registry();
        assert_eq!(
            registry.alias_defaults.get("opus").map(String::as_str),
            Some("claude-opus-5")
        );
        assert_eq!(
            registry.alias_defaults.get("fable").map(String::as_str),
            Some("claude-fable-5")
        );
        assert_eq!(
            registry
                .display_names
                .get("claude-opus-5")
                .map(String::as_str),
            Some("Opus 5")
        );
        assert_eq!(registry.best.as_deref(), Some("fable"));
        // Noise without the registry's shape contributes nothing.
        assert!(
            parse_registry(br#"aliases:Qn(N(),cyg()),foo:{default:32000}"#)
                .alias_defaults
                .is_empty()
        );
    }

    #[test]
    fn display_line_resolves_aliases_suffixes_and_unknowns() {
        let registry = fake_registry();
        assert_eq!(registry.display_line("opus"), "Opus 5 · claude-opus-5");
        assert_eq!(registry.display_line("opus[1m]"), "Opus 5 · claude-opus-5");
        // A raw id resolves to its display name; an unknown selector passes
        // through verbatim.
        assert_eq!(
            registry.display_line("claude-fable-5"),
            "Fable 5 · claude-fable-5"
        );
        assert_eq!(registry.display_line("k3"), "k3");
    }

    #[test]
    fn catalog_names_the_concrete_model_each_alias_runs() {
        let registry = fake_registry();
        let config = CliModelConfig {
            model_key: Some("opus".to_string()),
            ..CliModelConfig::default()
        };
        let models = claude_models_from(config, Some(&registry));
        let by_id = |id: &str| models.iter().find(|m| m.id == id).unwrap();
        assert_eq!(
            by_id("opus").description.as_deref(),
            Some("Opus 5 · claude-opus-5")
        );
        assert_eq!(
            by_id("default").description.as_deref(),
            Some("Use the default model (currently Opus 5 · claude-opus-5)")
        );
        // No registry entry (sonnet/haiku absent from the fake) → no
        // description, same as a CLI too old to embed one.
        assert_eq!(by_id("sonnet").description, None);
    }

    #[test]
    fn catalog_falls_back_to_registry_best_when_unconfigured() {
        let registry = fake_registry();
        let models = claude_models_from(CliModelConfig::default(), Some(&registry));
        let default = models.iter().find(|m| m.id == "default").unwrap();
        assert_eq!(
            default.description.as_deref(),
            Some("Use the default model (currently Fable 5 · claude-fable-5)")
        );
        // Without a registry an unconfigured default stays silent.
        let models = claude_models_from(CliModelConfig::default(), None);
        assert_eq!(models[0].description, None);
    }
}
