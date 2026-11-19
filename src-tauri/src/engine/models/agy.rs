use super::{run_probe, EngineModel};

/// Offline fallback when the probe cannot run (binary missing, not signed in,
/// network, timeout): the built-in list agy 1.5.x itself prints when it cannot
/// fetch the account catalog, so every row still resolves under `--model`.
/// The live probe always wins when it returns rows.
const FALLBACK: &[(&str, &str)] = &[
    ("gemini-3.8-flash-high", "Gemini 3.8 Flash (High)"),
    ("gemini-3.8-flash-medium", "Gemini 3.8 Flash (Medium)"),
    ("gemini-3.8-flash-low", "Gemini 3.8 Flash (Low)"),
    ("claude-sonnet-4-6", "Claude Sonnet 4.6 (Thinking)"),
    ("claude-opus-4-6-thinking", "Claude Opus 4.6 (Thinking)"),
    ("gpt-oss-120b-medium", "GPT-OSS 120B (Medium)"),
];

pub(super) async fn agy_catalog(bin: &str) -> super::EngineCatalog {
    if let Ok(stdout) = run_probe(bin, &["models"], "models").await {
        let models = parse_agy_models_tsv(&stdout);
        if !models.is_empty() {
            return super::EngineCatalog::authoritative(models);
        }
    }
    // Not authoritative: the account may serve more (Gemini 4), so a stored
    // pick outside this list must survive instead of being reset to row one.
    super::EngineCatalog {
        models: fallback_models(),
        authoritative: false,
        remote: false,
    }
}

/// `agy models` prints a status line then `id<TAB>Display Name` rows.
/// There is no `--json` flag on 1.2.x.
pub fn parse_agy_models_tsv(stdout: &str) -> Vec<EngineModel> {
    let mut models = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() || !line.contains('\t') {
            continue;
        }
        let mut parts = line.splitn(2, '\t');
        let Some(id) = parts.next().map(str::trim).filter(|id| !id.is_empty()) else {
            continue;
        };
        if id.contains(' ') || !seen.insert(id.to_string()) {
            continue;
        }
        let name = parts
            .next()
            .map(str::trim)
            .filter(|name| !name.is_empty() && *name != id)
            .map(str::to_string);
        models.push(EngineModel {
            id: id.to_string(),
            name,
            description: None,
            provider: provider_of(id).to_string(),
            context_window: None,
        });
    }
    models
}

fn fallback_models() -> Vec<EngineModel> {
    FALLBACK
        .iter()
        .map(|(id, name)| EngineModel {
            id: (*id).to_string(),
            name: Some((*name).to_string()),
            description: None,
            provider: provider_of(id).to_string(),
            context_window: None,
        })
        .collect()
}

fn provider_of(id: &str) -> &'static str {
    let lower = id.to_ascii_lowercase();
    if lower.starts_with("claude") {
        "anthropic"
    } else if lower.starts_with("gpt") || lower.starts_with("o1") || lower.starts_with("o3") {
        "openai"
    } else {
        "google"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tsv_and_skips_status_line() {
        let stdout = "\
Fetching available models...
gemini-3.8-flash-high\tGemini 3.8 Flash (High)
gemini-3.1-pro-low\tGemini 3.1 Pro (Low)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)
";
        let models = parse_agy_models_tsv(stdout);
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "gemini-3.8-flash-high",
                "gemini-3.1-pro-low",
                "claude-sonnet-4-6"
            ]
        );
        assert_eq!(models[0].name.as_deref(), Some("Gemini 3.8 Flash (High)"));
        assert_eq!(models[0].provider, "google");
        assert_eq!(models[2].provider, "anthropic");
    }

    // Issue #1530: a failed probe showed the stale 1.2.x list as authoritative,
    // which reset a stored Gemini 4 pick to the first fallback row.
    #[tokio::test]
    async fn failed_probe_falls_back_without_resetting_picks() {
        let catalog = agy_catalog("/nonexistent/ccgui-test/agy").await;
        assert!(!catalog.authoritative);
        assert!(!catalog.models.is_empty());
        assert!(catalog
            .models
            .iter()
            .all(|m| !m.id.starts_with("gemini-3.1-pro")));
    }

    #[test]
    fn ignores_blank_and_duplicate_rows() {
        let stdout = "\n\nid-a\tName A\nid-a\tName A again\n";
        let models = parse_agy_models_tsv(stdout);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "id-a");
    }
}
