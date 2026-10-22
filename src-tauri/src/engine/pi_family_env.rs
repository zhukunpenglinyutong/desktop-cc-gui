//! GUI 拉起的 PI/OMP 看不到用户写在 shell profile 里的密钥变量。
//!
//! `models.json` / `models.yml` 只存 `$NAME` / `${NAME}`。拉起前按名字向登录交互
//! shell 要值，注入这次子进程。不改配置，不解析 rc 文本，不写 launchd，也不把
//! 整个 shell 环境倒进来。omp 再拉起的 PI 默认继承这份环境。
//!
//! 状态：配置出名字 → 进程或命令行里已有的跳过 → 登录 shell 按名字取值 →
//! 按配置文本指纹缓存，内容没变就不再起 zsh → 只注入非空值，不覆盖已显式设置的项。
//! 探测超时或失败则保持原样，让 PI 自己报 No API key found，不卡住启动。值不进日志。

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

const FRAME_START_PREFIX: &str = "__CCGUI_PI_ENV_START__";
const FRAME_END_PREFIX: &str = "__CCGUI_PI_ENV_END__";
const RESOLUTION_TIMEOUT: Duration = Duration::from_secs(5);
const SHELL_SCRIPT: &str = r#"
for key in "$@"; do
  printf '%s%s\n' "__CCGUI_PI_ENV_START__" "$key"
  value=$(/usr/bin/printenv -- "$key" 2>/dev/null || true)
  printf '%s\n' "$value"
  printf '%s%s\n' "__CCGUI_PI_ENV_END__" "$key"
done
"#;

static CACHE: Mutex<SessionCache> = Mutex::new(SessionCache {
    fingerprint: String::new(),
    probed: BTreeSet::new(),
    values: BTreeMap::new(),
});

#[derive(Clone)]
struct SessionCache {
    fingerprint: String,
    probed: BTreeSet<String>,
    values: BTreeMap<String, String>,
}

impl SessionCache {
    fn unresolved(&self, fingerprint: &str, keys: &[String]) -> Vec<String> {
        if self.fingerprint != fingerprint {
            return keys.to_vec();
        }
        keys.iter()
            .filter(|key| !self.probed.contains(key.as_str()))
            .cloned()
            .collect()
    }

    fn cached_value(&self, fingerprint: &str, key: &str) -> Option<&str> {
        if self.fingerprint != fingerprint {
            return None;
        }
        self.values.get(key).map(String::as_str)
    }

    fn store(&mut self, fingerprint: &str, probed: &[String], values: &BTreeMap<String, String>) {
        // 配置文件一变，旧探测结果作废。同一指纹下补上这次问过的名字，
        // 包括 shell 里没有的名字，避免每发一条消息都再起一次 zsh。
        if self.fingerprint != fingerprint {
            self.fingerprint = fingerprint.to_string();
            self.probed.clear();
            self.values.clear();
        }
        self.probed.extend(probed.iter().cloned());
        for (key, value) in values {
            if value.is_empty() {
                self.values.remove(key);
            } else {
                self.values.insert(key.clone(), value.clone());
            }
        }
    }
}

struct Probe {
    program: PathBuf,
    login: bool,
    extra_env: Vec<(String, String)>,
}

/// 桌面端拉起 PI/OMP 前调用。WSL 不走这里：本机环境过不了 ssh。
pub(crate) async fn apply(command: &mut Command) {
    let sources = config_sources();
    let texts = read_sources(&sources).await;
    let borrowed: Vec<&str> = texts.iter().map(String::as_str).collect();
    let fingerprint = texts_fingerprint(&borrowed);
    let probe = match login_probe() {
        Some(probe) => probe,
        None => return,
    };
    inject_from_probe_cached(command, &borrowed, &fingerprint, &probe).await;
}

async fn inject_from_probe_cached(
    command: &mut Command,
    texts: &[&str],
    fingerprint: &str,
    probe: &Probe,
) {
    let missing = missing_refs(command, texts);
    if missing.is_empty() {
        return;
    }
    let unresolved = cache_lock()
        .map(|cache| cache.unresolved(fingerprint, &missing))
        .unwrap_or_else(|| missing.clone());
    if !unresolved.is_empty() {
        if let Some(resolved) = resolve_from_shell(probe, &unresolved).await {
            if let Some(mut cache) = cache_lock() {
                cache.store(fingerprint, &unresolved, &resolved);
            } else {
                inject_map(command, &resolved);
                return;
            }
        }
    }
    let cached = cache_lock().map(|cache| {
        missing
            .iter()
            .filter_map(|key| {
                cache
                    .cached_value(fingerprint, key)
                    .map(|value| (key.clone(), value.to_string()))
            })
            .collect::<BTreeMap<_, _>>()
    });
    if let Some(cached) = cached {
        inject_map(command, &cached);
    }
}

#[cfg(test)]
async fn inject_from_probe(command: &mut Command, texts: &[&str], probe: &Probe) {
    let missing = missing_refs(command, texts);
    if missing.is_empty() {
        return;
    }
    let Some(resolved) = resolve_from_shell(probe, &missing).await else {
        return;
    };
    inject_map(command, &resolved);
}

fn missing_refs(command: &Command, texts: &[&str]) -> Vec<String> {
    let mut refs = BTreeSet::new();
    for text in texts {
        refs.extend(collect_env_refs(text));
    }
    refs.into_iter()
        .filter(|key| !env_has_non_empty_value(command, key))
        .collect()
}

fn inject_map(command: &mut Command, values: &BTreeMap<String, String>) {
    for (key, value) in values {
        if value.is_empty() || env_has_non_empty_value(command, key) {
            continue;
        }
        command.env(key, value);
    }
}

fn collect_env_refs(text: &str) -> BTreeSet<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut refs = BTreeSet::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '$' {
            index += 1;
            continue;
        }
        index += 1;
        if index < chars.len() && chars[index] == '{' {
            index += 1;
            let start = index;
            while index < chars.len() && chars[index] != '}' {
                index += 1;
            }
            let name: String = chars[start..index].iter().collect();
            if index < chars.len() && chars[index] == '}' && is_valid_env_name(&name) {
                refs.insert(name);
            }
            if index < chars.len() && chars[index] == '}' {
                index += 1;
            }
            continue;
        }
        let start = index;
        while index < chars.len() && is_env_char(chars[index], index == start) {
            index += 1;
        }
        // `$bad-name` 不是合法环境变量名，不能把前缀 `bad` 当成引用。
        if index < chars.len() && matches!(chars[index], '-' | '.') {
            while index < chars.len()
                && (chars[index].is_ascii_alphanumeric() || matches!(chars[index], '_' | '-' | '.'))
            {
                index += 1;
            }
            continue;
        }
        let name: String = chars[start..index].iter().collect();
        if is_valid_env_name(&name) {
            refs.insert(name);
        }
    }
    refs
}

fn is_env_char(ch: char, first: bool) -> bool {
    if first {
        ch == '_' || ch.is_ascii_alphabetic()
    } else {
        ch == '_' || ch.is_ascii_alphanumeric()
    }
}

fn is_valid_env_name(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    is_env_char(first, true) && chars.all(|ch| is_env_char(ch, false))
}

fn env_has_non_empty_value(command: &Command, key: &str) -> bool {
    // 命令上已经显式设置的项（包括清空）属于这次启动，不用 shell 里的值覆盖。
    command
        .as_std()
        .get_envs()
        .any(|(name, _)| env_name_eq(name, key))
        || std::env::var_os(key).is_some_and(|value| !value.is_empty())
}

fn env_name_eq(name: &std::ffi::OsStr, key: &str) -> bool {
    if cfg!(windows) {
        name.to_string_lossy().eq_ignore_ascii_case(key)
    } else {
        name == key
    }
}

fn config_sources() -> Vec<PathBuf> {
    ["pi", "omp"]
        .into_iter()
        .filter_map(|engine| {
            let dir = crate::engine::pi_family_auth::agent_dir(engine).ok()?;
            let file = if engine == "pi" {
                "models.json"
            } else {
                "models.yml"
            };
            Some(dir.join(file))
        })
        .collect()
}

fn texts_fingerprint(texts: &[&str]) -> String {
    // FNV-1a。配置文件很小，按内容失效，避免同一秒内改密钥仍命中旧缓存。
    let mut hash: u64 = 0xcbf29ce484222325;
    for text in texts {
        for byte in text.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

async fn read_sources(paths: &[PathBuf]) -> Vec<String> {
    let mut texts = Vec::new();
    for path in paths {
        match tokio::fs::read_to_string(path).await {
            Ok(text) => texts.push(text),
            Err(_) => texts.push(String::new()),
        }
    }
    texts
}

fn login_probe() -> Option<Probe> {
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

async fn resolve_from_shell(probe: &Probe, keys: &[String]) -> Option<BTreeMap<String, String>> {
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
        .arg("ccgui-pi-env")
        .args(keys)
        .envs(probe.extra_env.iter().cloned())
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let output = timeout(RESOLUTION_TIMEOUT, command.output())
        .await
        .ok()?
        .ok()?;
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

fn cache_lock() -> Option<std::sync::MutexGuard<'static, SessionCache>> {
    CACHE.lock().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command_env(command: &Command, key: &str) -> Option<String> {
        command.as_std().get_envs().find_map(|(name, value)| {
            if !env_name_eq(name, key) {
                return None;
            }
            value.map(|item| item.to_string_lossy().into_owned())
        })
    }

    fn bash_probe(extra_env: Vec<(String, String)>) -> Probe {
        Probe {
            program: PathBuf::from("/bin/bash"),
            login: false,
            extra_env,
        }
    }

    #[tokio::test]
    async fn shell_value_is_injected_when_process_lacks_it() {
        let key = "CCGUI_PI_ENV_FIXTURE";
        assert!(
            std::env::var_os(key).is_none(),
            "fixture key must not already be in the test process"
        );
        let mut command = Command::new("pi");
        let text = r#"{"providers":{"grok":{"apiKey":"$CCGUI_PI_ENV_FIXTURE"}}}"#;
        inject_from_probe(
            &mut command,
            &[text],
            &bash_probe(vec![(key.to_string(), "from-login-shell".to_string())]),
        )
        .await;
        assert_eq!(
            command_env(&command, key).as_deref(),
            Some("from-login-shell")
        );
    }

    #[tokio::test]
    async fn explicit_child_env_is_not_replaced() {
        let key = "CCGUI_PI_ENV_EXPLICIT";
        let mut command = Command::new("pi");
        command.env(key, "channel-key");
        inject_from_probe(
            &mut command,
            &[r#"{"apiKey":"$CCGUI_PI_ENV_EXPLICIT"}"#],
            &bash_probe(vec![(key.to_string(), "from-login-shell".to_string())]),
        )
        .await;
        assert_eq!(command_env(&command, key).as_deref(), Some("channel-key"));
    }

    #[tokio::test]
    async fn empty_shell_value_is_not_injected() {
        let key = "CCGUI_PI_ENV_EMPTY";
        let mut command = Command::new("pi");
        inject_from_probe(
            &mut command,
            &[r#"apiKey: $CCGUI_PI_ENV_EMPTY"#],
            &bash_probe(Vec::new()),
        )
        .await;
        assert_eq!(command_env(&command, key), None);
    }

    #[test]
    fn collects_dollar_and_braced_refs_only() {
        let refs = collect_env_refs(
            r#"
            { "apiKey": "$CCH_GROK", "headers": { "X": "${CCH_API_KEY}" } }
            bad: $bad-name
            num: $1NO
            "#,
        );
        assert!(refs.contains("CCH_GROK"));
        assert!(refs.contains("CCH_API_KEY"));
        assert!(!refs.contains("bad"));
        assert!(!refs.contains("1NO"));
        assert!(!refs.contains("bad-name"));
    }

    #[test]
    fn session_cache_reuses_a_probe_until_the_config_fingerprint_changes() {
        let mut cache = SessionCache {
            fingerprint: String::new(),
            probed: BTreeSet::new(),
            values: BTreeMap::new(),
        };
        let keys = vec!["CCH_GROK".to_string()];
        assert_eq!(cache.unresolved("fp-a", &keys), keys);
        let mut values = BTreeMap::new();
        values.insert("CCH_GROK".to_string(), "secret".to_string());
        cache.store("fp-a", &keys, &values);
        assert!(cache.unresolved("fp-a", &keys).is_empty());
        assert_eq!(cache.cached_value("fp-a", "CCH_GROK"), Some("secret"));
        assert_eq!(cache.unresolved("fp-b", &keys), keys);
    }
}
