//! GUI 引擎共用的登录 shell 环境探测。只查询配置点名的合法变量，值不进日志。
//! 名字作为独立位置参数传递，不拼进 shell 代码；超时丢弃时终止探测进程。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

const FRAME_START_PREFIX: &str = "__CCGUI_ENV_START__";
const FRAME_END_PREFIX: &str = "__CCGUI_ENV_END__";
const RESOLUTION_TIMEOUT: Duration = Duration::from_secs(5);
const SHELL_SCRIPT: &str = r#"
for key in "$@"; do
  printf '%s%s\n' "__CCGUI_ENV_START__" "$key"
  value=$(/usr/bin/printenv -- "$key" 2>/dev/null || true)
  printf '%s\n' "$value"
  printf '%s%s\n' "__CCGUI_ENV_END__" "$key"
done
"#;

pub(super) struct Probe {
    pub program: PathBuf,
    pub login: bool,
    pub extra_env: Vec<(String, String)>,
}

pub(super) fn login_probe() -> Option<Probe> {
    allowed_shell().map(|program| Probe {
        program,
        login: true,
        extra_env: Vec::new(),
    })
}

fn allowed_shell() -> Option<PathBuf> {
    if let Some(shell) = std::env::var_os("SHELL") {
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

pub(super) fn is_valid_env_name(value: &str) -> bool {
    !value.is_empty()
        && value.chars().enumerate().all(|(index, ch)| {
            (index == 0 && (ch == '_' || ch.is_ascii_alphabetic()))
                || (index > 0 && (ch == '_' || ch.is_ascii_alphanumeric()))
        })
}

pub(super) fn env_name_eq(name: &std::ffi::OsStr, key: &str) -> bool {
    if cfg!(windows) {
        name.to_string_lossy().eq_ignore_ascii_case(key)
    } else {
        name == key
    }
}

pub(super) fn env_has_non_empty_value(command: &Command, key: &str) -> bool {
    // 显式赋值、空值和移除都属于本次启动的决定，不用登录 shell 的值覆盖。
    command
        .as_std()
        .get_envs()
        .any(|(name, _)| env_name_eq(name, key))
        || std::env::var_os(key).is_some_and(|value| !value.is_empty())
}

pub(super) async fn resolve_from_shell(
    probe: &Probe,
    keys: &[String],
) -> Option<BTreeMap<String, String>> {
    if keys.iter().any(|key| !is_valid_env_name(key)) {
        return None;
    }
    if keys.is_empty() {
        return Some(BTreeMap::new());
    }
    let mut command = Command::new(&probe.program);
    if probe.login {
        command.arg("-l").arg("-i");
    }
    command
        .arg("-c")
        .arg(SHELL_SCRIPT)
        .arg("ccgui-env")
        .args(keys)
        .envs(probe.extra_env.iter().cloned())
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let output = timeout(RESOLUTION_TIMEOUT, command.output())
        .await
        .ok()?
        .ok()?;
    // 启动失败、rc 提前退出或超时均不提供结果，调用方可在下次发送时重试。
    if !output.status.success() {
        return None;
    }
    Some(parse_framed_values(&output.stdout, keys))
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
    fn parses_multiple_framed_values_without_prefix_collisions() {
        let keys = vec!["FOO".to_string(), "FOO2".to_string(), "EMPTY".to_string()];
        let stdout = format!(
            "noise\n{FRAME_START_PREFIX}FOO\none\n{FRAME_END_PREFIX}FOO\n\
             {FRAME_START_PREFIX}FOO2\ntwo\n{FRAME_END_PREFIX}FOO2\n\
             {FRAME_START_PREFIX}EMPTY\n\n{FRAME_END_PREFIX}EMPTY\n"
        );
        let values = parse_framed_values(stdout.as_bytes(), &keys);
        assert_eq!(values.get("FOO").map(String::as_str), Some("one"));
        assert_eq!(values.get("FOO2").map(String::as_str), Some("two"));
        assert!(!values.contains_key("EMPTY"));
    }

    #[test]
    fn rejects_injection_like_names_and_unapproved_shells() {
        assert!(!is_valid_env_name("OPENAI_API_KEY; touch /tmp/pwned"));
        assert!(!is_valid_env_name("1INVALID"));
        assert!(is_valid_env_name("CUSTOM_RELAY_TOKEN"));
        assert!(allowlisted_shell(Path::new("bash")).is_none());
        assert!(allowlisted_shell(Path::new("/bin/sh")).is_none());
    }

    #[test]
    fn explicit_child_values_empty_values_and_removals_are_preserved() {
        let key = "CCGUI_TEST_SHELL_ENV_EXPLICIT";
        let mut command = Command::new("engine");
        command.env(key, "channel-key");
        assert!(env_has_non_empty_value(&command, key));
        command.env(key, "");
        assert!(env_has_non_empty_value(&command, key));
        command.env_remove(key);
        assert!(env_has_non_empty_value(&command, key));
    }
}
