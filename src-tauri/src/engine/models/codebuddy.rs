use super::{run_probe, EngineCatalog, EngineModel};
use std::path::PathBuf;

pub(super) async fn codebuddy_catalog(bin: &str) -> EngineCatalog {
    let default_model = read_configured_default_model();

    // Live probe from the CLI binary
    if let Ok(stdout) = run_probe(bin, &["--help"], "help").await {
        let mut models = parse_help_models(&stdout);
        if !models.is_empty() {
            // Lead with the user's configured default model if present
            if let Some(def) = &default_model {
                if let Some(pos) = models.iter().position(|m| m.id == *def) {
                    let item = models.remove(pos);
                    models.insert(0, item);
                } else {
                    models.insert(
                        0,
                        EngineModel {
                            id: def.clone(),
                            name: Some(friendly_model_name(def)),
                            provider: infer_provider(def).to_string(),
                            description: None,
                            context_window: None,
                        },
                    );
                }
            }
            return EngineCatalog::authoritative(models);
        }
    }

    // Fallback if probe fails (e.g. CLI missing or timeout)
    EngineCatalog {
        models: fallback_catalog(default_model.as_deref()),
        authoritative: false,
        remote: false,
    }
}

fn codebuddy_config_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CODEBUDDY_CONFIG_DIR") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    // No home dir (some containers/service accounts): degrade to "no
    // configured default model" instead of panicking inside an IPC command.
    dirs::home_dir().map(|home| home.join(".codebuddy"))
}

fn read_configured_default_model() -> Option<String> {
    let dir = codebuddy_config_dir()?;
    for name in ["settings.local.json", "settings.json"] {
        if let Ok(content) = std::fs::read_to_string(dir.join(name)) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(m) = v
                    .get("model")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    return Some(m.to_string());
                }
                if let Some(m) = v
                    .pointer("/env/CODEBUDDY_MODEL")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    return Some(m.to_string());
                }
            }
        }
    }
    None
}

pub fn parse_help_models(text: &str) -> Vec<EngineModel> {
    let Some(start) = text.find("Currently supported: (") else {
        return Vec::new();
    };
    let after = &text[start + "Currently supported: (".len()..];
    let Some(end) = after.find(')') else {
        return Vec::new();
    };
    let list_str = &after[..end];

    let mut models = Vec::new();
    for raw in list_str.split(',') {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let id = trimmed.split('|').next().unwrap_or(trimmed).trim();
        let provider = infer_provider(id);
        let name = friendly_model_name(id);

        models.push(EngineModel {
            id: id.to_string(),
            name: Some(name),
            description: None,
            provider: provider.to_string(),
            context_window: None,
        });
    }
    models
}

fn infer_provider(id: &str) -> &'static str {
    let lower = id.to_lowercase();
    if lower.starts_with("hy") || lower.contains("hunyuan") {
        "hunyuan"
    } else if lower.contains("kimi") {
        "kimi"
    } else if lower.contains("deepseek") {
        "deepseek"
    } else if lower.contains("glm") || lower.contains("chatglm") {
        "chatglm"
    } else if lower.contains("minimax") {
        "minimax"
    } else if lower.contains("step") {
        "stepfun"
    } else {
        "codebuddy"
    }
}

fn friendly_model_name(id: &str) -> String {
    let bare = id.strip_prefix("custom:").unwrap_or(id);
    let bare = bare.split('/').last().unwrap_or(bare);
    match bare {
        "hy4-preview" => "Hunyuan 4 Preview".to_string(),
        "hy3" => "Hunyuan 3".to_string(),
        "hy3-x" => "Hunyuan 3X".to_string(),
        "step-5-preview" => "Step 5 Preview".to_string(),
        "space-bunny" => "Space Bunny".to_string(),
        "deepseek-v4-pro" => "DeepSeek V4 Pro".to_string(),
        "deepseek-v4.1-flash" => "DeepSeek V4.1 Flash".to_string(),
        "deepseek-flash" => "DeepSeek Flash".to_string(),
        "glm-5.3" => "GLM 5.3".to_string(),
        "glm-5.3-flash" => "GLM 5.3 Flash".to_string(),
        "glm-5.3-flashx" => "GLM 5.3 FlashX".to_string(),
        "glm-5.2" => "GLM 5.2".to_string(),
        "glm-5.1" => "GLM 5.1".to_string(),
        "glm-5v-turbo" => "GLM 5V Turbo".to_string(),
        "minimax-m3.1-flash" => "MiniMax M3.1 Flash".to_string(),
        "minimax-m3-pay" => "MiniMax M3".to_string(),
        "minimax-m2.7" => "MiniMax M2.7".to_string(),
        "kimi-k3" => "Kimi K3".to_string(),
        "kimi-k3-2" => "Kimi K3.2".to_string(),
        "kimi-k2.8-preview" => "Kimi K2.8 Preview".to_string(),
        "kimi-k2.7" => "Kimi K2.7".to_string(),
        "kimi-k2.6" => "Kimi K2.6".to_string(),
        "mimo-v2.6-pro" => "MiMo V2.6 Pro".to_string(),
        _ => bare.to_string(),
    }
}

fn fallback_catalog(default_model: Option<&str>) -> Vec<EngineModel> {
    let mut models = vec![
        EngineModel {
            id: "hy4-preview".to_string(),
            name: Some("Hunyuan 4 Preview".to_string()),
            provider: "hunyuan".to_string(),
            description: None,
            context_window: Some(256_000),
        },
        EngineModel {
            id: "hy3".to_string(),
            name: Some("Hunyuan 3".to_string()),
            provider: "hunyuan".to_string(),
            description: None,
            context_window: Some(128_000),
        },
        EngineModel {
            id: "deepseek-v4-pro".to_string(),
            name: Some("DeepSeek V4 Pro".to_string()),
            provider: "deepseek".to_string(),
            description: None,
            context_window: Some(128_000),
        },
        EngineModel {
            id: "glm-5.3".to_string(),
            name: Some("GLM 5.3".to_string()),
            provider: "chatglm".to_string(),
            description: None,
            context_window: Some(128_000),
        },
    ];
    if let Some(def) = default_model {
        if !models.iter().any(|m| m.id == def) {
            models.insert(
                0,
                EngineModel {
                    id: def.to_string(),
                    name: Some(friendly_model_name(def)),
                    provider: infer_provider(def).to_string(),
                    description: None,
                    context_window: None,
                },
            );
        }
    }
    models
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_help_models_extracts_real_models() {
        let help = r#"
  --model <model>  Model for the current session. Please provide the model ID. Currently supported: (custom:kimi-k3, hy4-preview, deepseek-v4-pro|deepseek-v4-pro)
"#;
        let models = parse_help_models(help);
        assert_eq!(models.len(), 3);
        assert_eq!(models[0].id, "custom:kimi-k3");
        assert_eq!(models[0].provider, "kimi");
        assert_eq!(models[0].name.as_deref(), Some("Kimi K3"));
        assert_eq!(models[1].id, "hy4-preview");
        assert_eq!(models[1].provider, "hunyuan");
        assert_eq!(models[1].name.as_deref(), Some("Hunyuan 4 Preview"));
        assert_eq!(models[2].id, "deepseek-v4-pro");
        assert_eq!(models[2].provider, "deepseek");
        assert_eq!(models[2].name.as_deref(), Some("DeepSeek V4 Pro"));
    }
}
