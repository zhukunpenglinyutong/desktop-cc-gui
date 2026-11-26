use super::{run_probe, EngineModel};

/// Offline fallback matching the reference's generated catalog (verified
/// 2026-07) when `opencode models` cannot run (binary missing / network).
/// The live probe always wins when it returns rows. `opencode/big-pickle`
/// leads: it is the CLI's own free default.
const FALLBACK: &[(&str, &str)] = &[
    ("opencode/big-pickle", "Big Pickle"),
    ("opencode/deepseek-v4-flash-free", "DeepSeek V4 Flash Free"),
    ("opencode/laguna-s-2.1-free", "Laguna S 2.1 Free"),
    ("opencode/ling-3.0-flash-free", "Ling 3.0 Flash Free"),
    ("opencode/mimo-v2.5-free", "MiMo V2.5 Free"),
    ("opencode/nemotron-3-ultra-free", "Nemotron 3 Ultra Free"),
    ("opencode/north-mini-code-free", "North Mini Code Free"),
    ("anthropic/claude-fable-5", "Claude Fable 5"),
    ("anthropic/claude-haiku-4-5", "Claude Haiku 4.5"),
    ("anthropic/claude-opus-4-5", "Claude Opus 4.5"),
    ("anthropic/claude-opus-4-6", "Claude Opus 4.6"),
    ("anthropic/claude-opus-4-7", "Claude Opus 4.7"),
    ("anthropic/claude-opus-4-8", "Claude Opus 4.8"),
    ("anthropic/claude-opus-5", "Claude Opus 5"),
    ("anthropic/claude-sonnet-4-5", "Claude Sonnet 4.5"),
    ("anthropic/claude-sonnet-4-6", "Claude Sonnet 4.6"),
    ("anthropic/claude-sonnet-5", "Claude Sonnet 5"),
];

pub(super) async fn opencode_catalog(bin: &str) -> (super::EngineCatalog, bool) {
    if let Ok(stdout) = run_probe(bin, &["models"], "models").await {
        let models = parse_models_output(&stdout);
        if !models.is_empty() {
            return (super::EngineCatalog::authoritative(models), true);
        }
    }
    (super::EngineCatalog::authoritative(fallback_models()), false)
}

/// `opencode models` prints one `provider/model` id per line (plus ANSI
/// styling and possible chatter). There is no `--json` flag.
pub fn parse_models_output(stdout: &str) -> Vec<EngineModel> {
    let clean = strip_ansi_codes(stdout);
    let mut models: Vec<EngineModel> = clean
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(|line| line.split_whitespace().find(|token| token.contains('/')))
        .map(|full_id| {
            let (provider, model_id) = full_id.split_once('/').unwrap_or(("opencode", full_id));
            EngineModel {
                id: full_id.to_string(),
                name: Some(format_model_name(provider, model_id)),
                description: None,
                provider: provider.to_string(),
                context_window: None,
            }
        })
        .collect();
    // The frontend auto-selects the leading entry when nothing is pinned:
    // lead with the CLI's preferred default.
    let default_index = models
        .iter()
        .position(|m| m.id == "openai/gpt-5.3-codex")
        .or_else(|| models.iter().position(|m| m.id.starts_with("openai/")))
        .unwrap_or(0);
    if !models.is_empty() && default_index > 0 {
        let entry = models.remove(default_index);
        models.insert(0, entry);
    }
    models
}

fn strip_ansi_codes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if let Some('[') = chars.peek().copied() {
                let _ = chars.next();
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
                continue;
            }
        }
        out.push(ch);
    }
    out
}

fn format_model_name(provider: &str, model_id: &str) -> String {
    let provider_name = match provider {
        "openai" => "OpenAI",
        "opencode" => "OpenCode",
        _ => provider,
    };
    let model_name = model_id
        .split('-')
        .map(|part| {
            if part.chars().all(|c| c.is_ascii_digit()) {
                part.to_string()
            } else {
                let mut chars = part.chars();
                match chars.next() {
                    Some(first) => {
                        let mut chunk = first.to_uppercase().to_string();
                        chunk.push_str(chars.as_str());
                        chunk
                    }
                    None => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join("-");
    format!("{provider_name}/{model_name}")
}

fn fallback_models() -> Vec<EngineModel> {
    FALLBACK
        .iter()
        .map(|(id, name)| EngineModel {
            id: (*id).to_string(),
            name: Some((*name).to_string()),
            description: None,
            provider: id
                .split_once('/')
                .map(|(p, _)| p)
                .unwrap_or("opencode")
                .to_string(),
            context_window: None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ids_through_ansi_and_chatter() {
        let stdout = "\
\u{1b}[32mLoading models...\u{1b}[0m
opencode/big-pickle
anthropic/claude-sonnet-5 \u{1b}[90m(default)\u{1b}[0m
not-a-model-line
openai/gpt-5.3-codex
";
        let models = parse_models_output(stdout);
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        // gpt-5.3-codex is promoted to the front as the preferred default.
        assert_eq!(
            ids,
            vec![
                "openai/gpt-5.3-codex",
                "opencode/big-pickle",
                "anthropic/claude-sonnet-5",
            ]
        );
        assert_eq!(models[1].name.as_deref(), Some("OpenCode/Big-Pickle"));
        assert_eq!(models[1].provider, "opencode");
        assert_eq!(models[2].provider, "anthropic");
    }

    #[test]
    fn fallback_leads_with_the_cli_default() {
        let models = fallback_models();
        assert_eq!(models[0].id, "opencode/big-pickle");
        assert!(models.iter().all(|m| m.id.contains('/')));
    }
}
