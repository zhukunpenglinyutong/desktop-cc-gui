//! Resolve provider-scoped environment variables for GUI-launched Codex.
//!
//! Finder/Dock launches do not necessarily inherit the user's interactive
//! shell environment. Codex providers name their credential variable through
//! `model_providers.*.env_key`; resolve only those validated names and inject
//! missing values into the Codex child process.

use std::collections::BTreeSet;

use tokio::process::Command;

use super::shell_env::{
    env_has_non_empty_value, is_valid_env_name, login_probe, resolve_from_shell,
};

pub(crate) async fn apply(command: &mut Command) {
    let config_path = crate::engine::codex_home().join("config.toml");
    let contents = tokio::fs::read_to_string(config_path)
        .await
        .unwrap_or_default();
    let mut keys = collect_env_keys(&contents);
    // A channel can introduce an env_key via -c without changing config.toml.
    let args: Vec<_> = command.as_std().get_args().collect();
    for pair in args.windows(2) {
        if pair[0] == "-c" {
            keys.extend(collect_env_keys(&pair[1].to_string_lossy()));
        }
    }
    let missing: Vec<String> = keys
        .into_iter()
        .filter(|key| !env_has_non_empty_value(command, key))
        .collect();
    if missing.is_empty() {
        return;
    }
    let Some(probe) = login_probe() else {
        return;
    };
    let Some(resolved) = resolve_from_shell(&probe, &missing).await else {
        return;
    };
    for (key, value) in resolved {
        command.env(key, value);
    }
}

fn collect_env_keys(contents: &str) -> BTreeSet<String> {
    let Ok(value) = toml::from_str::<toml::Value>(contents) else {
        return BTreeSet::new();
    };
    value
        .get("model_providers")
        .and_then(toml::Value::as_table)
        .into_iter()
        .flat_map(|providers| providers.values())
        .filter_map(|provider| provider.get("env_key"))
        .filter_map(toml::Value::as_str)
        .map(str::trim)
        .filter(|key| is_valid_env_name(key))
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_credentials_never_replace_explicit_child_env() {
        let mut command = Command::new("codex");
        command.env("CCGUI_TEST_CHANNEL_KEY", "channel-key");
        assert!(env_has_non_empty_value(&command, "CCGUI_TEST_CHANNEL_KEY"));
        // An explicit removal is also intentional, not a missing inherited key.
        command.env_remove("CCGUI_TEST_CHANNEL_KEY");
        assert!(env_has_non_empty_value(&command, "CCGUI_TEST_CHANNEL_KEY"));
    }

    #[test]
    fn collects_only_valid_provider_env_keys() {
        let keys = collect_env_keys(
            r#"
[model_providers.a]
env_key = "OPENAI_API_KEY"
[model_providers.b]
env_key = "TEAM_OPENAI_KEY"
[model_providers.c]
env_key = "bad-name"
"#,
        );
        assert_eq!(
            keys.into_iter().collect::<Vec<_>>(),
            ["OPENAI_API_KEY", "TEAM_OPENAI_KEY"]
        );
    }

    #[test]
    fn rejects_injection_like_names() {
        assert!(!is_valid_env_name("OPENAI_API_KEY; touch /tmp/pwned"));
        assert!(!is_valid_env_name("1INVALID"));
        assert!(is_valid_env_name("CUSTOM_RELAY_TOKEN"));
    }
}
