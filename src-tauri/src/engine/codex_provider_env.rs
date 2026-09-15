//! Resolve provider-scoped environment variables for GUI-launched Codex.
//!
//! Finder/Dock launches do not necessarily inherit the user's interactive
//! shell environment. Codex providers name their credential variable through
//! `model_providers.*.env_key`; resolve only those validated names and inject
//! missing values into the Codex child process.

use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

const FRAME_START_PREFIX: &str = "__CCGUI_CODEX_ENV_START__";
const FRAME_END_PREFIX: &str = "__CCGUI_CODEX_ENV_END__";
const RESOLUTION_TIMEOUT: Duration = Duration::from_secs(5);
const SHELL_SCRIPT: &str = r#"
for key in "$@"; do
  printf '%s%s\n' "__CCGUI_CODEX_ENV_START__" "$key"
  value=$(/usr/bin/printenv -- "$key" 2>/dev/null || true)
  printf '%s\n' "$value"
  printf '%s%s\n' "__CCGUI_CODEX_ENV_END__" "$key"
done
"#;

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
    let Some(resolved) = resolve_from_login_shell(&missing).await else {
        return;
    };
    for (key, value) in resolved {
        command.env(key, value);
    }
}

fn env_has_non_empty_value(command: &Command, key: &str) -> bool {
    // Explicit values (including empty/removal) belong to this launch. Never
    // replace them with a credential from another account's login shell.
    command.as_std().get_envs().any(|(name, _)| {
        if cfg!(windows) {
            name.to_string_lossy().eq_ignore_ascii_case(key)
        } else {
            name == key
        }
    }) || env::var_os(key).is_some_and(|value| !value.is_empty())
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

fn is_valid_env_name(value: &str) -> bool {
    !value.is_empty()
        && value.chars().enumerate().all(|(index, ch)| {
            (index == 0 && (ch == '_' || ch.is_ascii_alphabetic()))
                || (index > 0 && (ch == '_' || ch.is_ascii_alphanumeric()))
        })
}

async fn resolve_from_login_shell(keys: &[String]) -> Option<BTreeMap<String, String>> {
    let shell = allowed_shell()?;
    let mut command = Command::new(shell);
    command
        .arg("-l")
        .arg("-i")
        .arg("-c")
        .arg(SHELL_SCRIPT)
        .arg("ccgui")
        .args(keys);
    let output = timeout(RESOLUTION_TIMEOUT, command.output())
        .await
        .ok()?
        .ok()?;
    Some(parse_framed_values(&output.stdout, keys))
}

fn allowed_shell() -> Option<PathBuf> {
    if let Some(shell) = env::var_os("SHELL") {
        return allowlisted_shell(Path::new(&shell)).map(Path::to_path_buf);
    }
    let default = if cfg!(target_os = "macos") {
        Path::new("/bin/zsh")
    } else {
        Path::new("/bin/bash")
    };
    default.exists().then(|| default.to_path_buf())
}

fn allowlisted_shell(path: &Path) -> Option<&Path> {
    let name = path.file_name()?.to_str()?;
    ((name == "zsh" || name == "bash") && path.is_absolute()).then_some(path)
}

fn parse_framed_values(stdout: &[u8], keys: &[String]) -> BTreeMap<String, String> {
    let text = String::from_utf8_lossy(stdout);
    let mut values = BTreeMap::new();
    for key in keys {
        let start_marker = format!("{FRAME_START_PREFIX}{key}\n");
        let end_marker = format!("{FRAME_END_PREFIX}{key}\n");
        let Some(start) = text.find(&start_marker) else {
            continue;
        };
        let value_start = start + start_marker.len();
        let Some(end) = text[value_start..].find(&end_marker) else {
            continue;
        };
        let value = text[value_start..value_start + end].trim();
        if !value.is_empty() {
            values.insert(key.clone(), value.to_string());
        }
    }
    values
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
    fn parses_multiple_framed_values_without_prefix_collisions() {
        let keys = vec!["FOO".to_string(), "FOO2".to_string()];
        let stdout = format!(
            "noise\n{FRAME_START_PREFIX}FOO\none\n{FRAME_END_PREFIX}FOO\n\
             {FRAME_START_PREFIX}FOO2\ntwo\n{FRAME_END_PREFIX}FOO2\n"
        );
        let values = parse_framed_values(stdout.as_bytes(), &keys);
        assert_eq!(values.get("FOO").map(String::as_str), Some("one"));
        assert_eq!(values.get("FOO2").map(String::as_str), Some("two"));
    }

    #[test]
    fn rejects_injection_like_names() {
        assert!(!is_valid_env_name("OPENAI_API_KEY; touch /tmp/pwned"));
        assert!(!is_valid_env_name("1INVALID"));
        assert!(is_valid_env_name("CUSTOM_RELAY_TOKEN"));
    }
}
