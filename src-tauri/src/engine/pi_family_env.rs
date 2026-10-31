//! 为 GUI 拉起的 PI/OMP 补充登录 shell 中的密钥，只读取当前引擎的配置。
//!
//! PI 使用 `$NAME` / `${NAME}` 模板（`$$` 转义）；OMP 的 providers.*.apiKey
//! 使用裸变量名，`!` 命令和字面量由 OMP 自己处理。配置和用户 rc 文件均不改写。
//! 状态：收集引用 → 跳过进程或命令已有项 → 复用未过期正值 → 按名字探测缺项。
//! 未找到、失败和超时不缓存；正值最多缓存 5 秒，换密钥无需重启应用。
//! 只注入本次子进程，不记录值。WSL 由调用方跳过，本机环境不跨 ssh。

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::process::Command;

use super::shell_env::{
    env_has_non_empty_value, is_valid_env_name, login_probe, resolve_from_shell, Probe,
};

const CACHE_TTL: Duration = Duration::from_secs(5);
static CACHE: Mutex<SessionCache> = Mutex::new(SessionCache {
    fingerprint: String::new(),
    values: BTreeMap::new(),
});

#[derive(Default)]
struct SessionCache {
    fingerprint: String,
    values: BTreeMap<String, (Instant, String)>,
}

impl SessionCache {
    fn cached_value(&self, fingerprint: &str, key: &str) -> Option<&str> {
        if self.fingerprint != fingerprint {
            return None;
        }
        self.values.get(key).and_then(|(stored_at, value)| {
            (stored_at.elapsed() < CACHE_TTL).then_some(value.as_str())
        })
    }

    fn store(&mut self, fingerprint: &str, values: &BTreeMap<String, String>) {
        // 不记录“问过但没找到”：用户补上 export 后，下次发送必须重新探测。
        // 每个正值单独计时，新增变量不能延长旧密钥的寿命。
        if self.fingerprint != fingerprint {
            self.fingerprint = fingerprint.to_string();
            self.values.clear();
        }
        self.values
            .retain(|_, (stored_at, _)| stored_at.elapsed() < CACHE_TTL);
        let now = Instant::now();
        for (key, value) in values {
            if !value.is_empty() {
                self.values.insert(key.clone(), (now, value.clone()));
            }
        }
    }
}

pub(crate) async fn apply(command: &mut Command, engine: &str) {
    let Some(path) = config_source(engine) else {
        return;
    };
    let text = tokio::fs::read_to_string(path).await.unwrap_or_default();
    let Some(probe) = login_probe() else {
        return;
    };
    inject_from_probe_cached(command, engine, &text, &probe, &CACHE).await;
}

async fn inject_from_probe_cached(
    command: &mut Command,
    engine: &str,
    text: &str,
    probe: &Probe,
    cache: &Mutex<SessionCache>,
) {
    let refs = collect_refs(engine, text);
    let missing: Vec<_> = refs
        .into_iter()
        .filter(|key| !env_has_non_empty_value(command, key))
        .collect();
    if missing.is_empty() {
        return;
    }
    let fingerprint = texts_fingerprint(&[engine, text, &probe.program.to_string_lossy()]);
    // 在 await 前取得本次快照；其他并发发送即使切换配置，也不能抹掉本次结果。
    // 锁不跨 await 持有；缓存不可用时仍可直接探测并注入。
    let mut values = cache
        .lock()
        .ok()
        .map(|cache| {
            missing
                .iter()
                .filter_map(|key| {
                    cache
                        .cached_value(&fingerprint, key)
                        .map(|value| (key.clone(), value.to_string()))
                })
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    let unresolved: Vec<_> = missing
        .into_iter()
        .filter(|key| !values.contains_key(key))
        .collect();
    if !unresolved.is_empty() {
        if let Some(resolved) = resolve_from_shell(probe, &unresolved).await {
            if let Ok(mut cache) = cache.lock() {
                cache.store(&fingerprint, &resolved);
            }
            values.extend(resolved);
        }
    }
    for (key, value) in values {
        if !value.is_empty() && !env_has_non_empty_value(command, &key) {
            command.env(key, value);
        }
    }
}

fn collect_refs(engine: &str, text: &str) -> BTreeSet<String> {
    match engine {
        "omp" => collect_omp_env_refs(text),
        "pi" => {
            let Ok(value) = super::pi_family_auth::validate_models_config_text("pi", text) else {
                return BTreeSet::new();
            };
            let mut refs = BTreeSet::new();
            collect_pi_value_refs(&value, &mut refs);
            refs
        }
        _ => BTreeSet::new(),
    }
}

fn collect_pi_value_refs(value: &serde_json::Value, refs: &mut BTreeSet<String>) {
    // 先解析配置再扫描字符串，避免注释、JSON 转义或相邻字段干扰模板边界。
    match value {
        serde_json::Value::String(text) => refs.extend(collect_env_refs(text)),
        serde_json::Value::Array(items) => {
            for item in items {
                collect_pi_value_refs(item, refs);
            }
        }
        serde_json::Value::Object(items) => {
            for item in items.values() {
                collect_pi_value_refs(item, refs);
            }
        }
        _ => {}
    }
}

fn collect_omp_env_refs(text: &str) -> BTreeSet<String> {
    let Ok(value) = super::pi_family_auth::validate_models_config_text("omp", text) else {
        return BTreeSet::new();
    };
    value
        .get("providers")
        .and_then(serde_json::Value::as_object)
        .into_iter()
        .flat_map(|providers| providers.values())
        .filter_map(|provider| provider.get("apiKey"))
        .filter_map(serde_json::Value::as_str)
        // OMP 把整个字符串当变量名；不 trim、不展开 $，也不执行 ! 命令。
        .filter(|key| is_valid_env_name(key))
        .map(ToOwned::to_owned)
        .collect()
}

fn collect_env_refs(text: &str) -> BTreeSet<String> {
    if text.starts_with('!') {
        return BTreeSet::new(); // 命令由 PI 自己执行，不把其中的 shell 表达式当模板。
    }
    let chars: Vec<char> = text.chars().collect();
    let mut refs = BTreeSet::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '$' {
            index += 1;
            continue;
        }
        index += 1;
        if matches!(chars.get(index), Some('$' | '!')) {
            index += 1; // PI 的 $$ / $! 分别转义为字面量 $ / !。
            continue;
        }
        if chars.get(index) == Some(&'{') {
            if let Some(relative_end) = chars[index + 1..].iter().position(|ch| *ch == '}') {
                let end = index + 1 + relative_end;
                let name: String = chars[index + 1..end].iter().collect();
                if is_valid_env_name(&name) {
                    refs.insert(name);
                }
                // 有闭合括号时，PI 将整个无效模板视为字面量，不能探测其嵌套 $。
                index = end + 1;
            }
            // 未闭合时仅消费 $；继续扫描，不能吞掉后面的合法引用。
            continue;
        }
        let start = index;
        while index < chars.len() && (chars[index] == '_' || chars[index].is_ascii_alphanumeric()) {
            index += 1;
        }
        let name: String = chars[start..index].iter().collect();
        if is_valid_env_name(&name) {
            refs.insert(name);
        }
        // 非括号写法只消费合法名字，因此 $KEY-suffix 仍会收集 KEY。
    }
    refs
}

fn config_source(engine: &str) -> Option<PathBuf> {
    let file = match engine {
        "pi" => "models.json",
        "omp" => "models.yml",
        _ => return None,
    };
    Some(super::pi_family_auth::agent_dir(engine).ok()?.join(file))
}

fn texts_fingerprint(texts: &[&str]) -> String {
    // FNV-1a：引擎、配置内容和 shell 路径共同隔离缓存，不存明文配置。
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

#[cfg(all(test, unix))]
#[path = "pi_family_env_smoke.rs"]
mod smoke_tests;

#[cfg(test)]
mod tests {
    use super::super::shell_env::env_name_eq;
    use super::*;

    fn command_env(command: &Command, key: &str) -> Option<String> {
        command.as_std().get_envs().find_map(|(name, value)| {
            if !env_name_eq(name, key) {
                return None;
            }
            value.map(|item| item.to_string_lossy().into_owned())
        })
    }

    #[cfg(unix)]
    fn bash_probe(extra_env: Vec<(String, String)>) -> Probe {
        Probe {
            program: PathBuf::from("/bin/bash"),
            login: false,
            extra_env,
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn shell_value_is_injected_when_process_lacks_it() {
        let key = "CCGUI_PI_ENV_FIXTURE";
        assert!(std::env::var_os(key).is_none());
        let mut command = Command::new("pi");
        inject_from_probe_cached(
            &mut command,
            "pi",
            r#"{"providers":{"grok":{"apiKey":"$CCGUI_PI_ENV_FIXTURE"}}}"#,
            &bash_probe(vec![(key.to_string(), "from-login-shell".to_string())]),
            &Mutex::new(SessionCache::default()),
        )
        .await;
        assert_eq!(
            command_env(&command, key).as_deref(),
            Some("from-login-shell")
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn explicit_child_env_is_not_replaced() {
        let key = "CCGUI_PI_ENV_EXPLICIT";
        for explicit in [Some("channel-key"), Some(""), None] {
            let mut command = Command::new("pi");
            match explicit {
                Some(value) => {
                    command.env(key, value);
                }
                None => {
                    command.env_remove(key);
                }
            }
            inject_from_probe_cached(
                &mut command,
                "pi",
                r#"{"apiKey":"$CCGUI_PI_ENV_EXPLICIT"}"#,
                &bash_probe(vec![(key.to_string(), "from-login-shell".to_string())]),
                &Mutex::new(SessionCache::default()),
            )
            .await;
            assert_eq!(command_env(&command, key).as_deref(), explicit);
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn empty_shell_value_is_not_injected() {
        let key = "CCGUI_PI_ENV_EMPTY";
        let mut command = Command::new("pi");
        inject_from_probe_cached(
            &mut command,
            "pi",
            r#"{"apiKey":"$CCGUI_PI_ENV_EMPTY"}"#,
            &bash_probe(vec![(key.to_string(), String::new())]),
            &Mutex::new(SessionCache::default()),
        )
        .await;
        assert_eq!(command_env(&command, key), None);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn missing_key_is_reprobed_after_user_exports_it() {
        let key = "CCGUI_PI_ENV_LATE_EXPORT";
        let text = r#"{"apiKey":"$CCGUI_PI_ENV_LATE_EXPORT"}"#;
        let cache = Mutex::new(SessionCache::default());
        let mut first = Command::new("pi");
        inject_from_probe_cached(&mut first, "pi", text, &bash_probe(Vec::new()), &cache).await;
        assert_eq!(command_env(&first, key), None);
        let mut second = Command::new("pi");
        inject_from_probe_cached(
            &mut second,
            "pi",
            text,
            &bash_probe(vec![(key.to_string(), "exported-later".to_string())]),
            &cache,
        )
        .await;
        assert_eq!(command_env(&second, key).as_deref(), Some("exported-later"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn omp_bare_api_key_is_injected() {
        let key = "CCGUI_OMP_ENV_BARE";
        let text = "providers:\n  relay:\n    apiKey: CCGUI_OMP_ENV_BARE\n    models:\n      - id: grok-4\n";
        let mut command = Command::new("omp");
        inject_from_probe_cached(
            &mut command,
            "omp",
            text,
            &bash_probe(vec![(key.to_string(), "from-omp-shell".to_string())]),
            &Mutex::new(SessionCache::default()),
        )
        .await;
        assert_eq!(
            command_env(&command, key).as_deref(),
            Some("from-omp-shell")
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cached_key_is_refreshed_after_ttl_and_removed_values_are_not_reused() {
        let key = "CCGUI_PI_ENV_ROTATED";
        let text = r#"{"apiKey":"$CCGUI_PI_ENV_ROTATED"}"#;
        let cache = Mutex::new(SessionCache::default());
        let mut first = Command::new("pi");
        inject_from_probe_cached(
            &mut first,
            "pi",
            text,
            &bash_probe(vec![(key.into(), "old-key".into())]),
            &cache,
        )
        .await;
        assert_eq!(command_env(&first, key).as_deref(), Some("old-key"));
        // 只推进缓存时间，不 sleep、不改全局进程环境，确保并行测试相互独立。
        cache.lock().unwrap().values.get_mut(key).unwrap().0 = Instant::now() - CACHE_TTL;
        let mut second = Command::new("pi");
        inject_from_probe_cached(
            &mut second,
            "pi",
            text,
            &bash_probe(vec![(key.into(), "new-key".into())]),
            &cache,
        )
        .await;
        assert_eq!(command_env(&second, key).as_deref(), Some("new-key"));
        cache.lock().unwrap().values.get_mut(key).unwrap().0 = Instant::now() - CACHE_TTL;
        let mut third = Command::new("pi");
        inject_from_probe_cached(&mut third, "pi", text, &bash_probe(Vec::new()), &cache).await;
        assert_eq!(command_env(&third, key), None);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn positive_cache_is_reused_and_config_changes_invalidate_it() {
        let key = "CCGUI_PI_ENV_CACHED";
        let text = r#"{"apiKey":"$CCGUI_PI_ENV_CACHED"}"#;
        let cache = Mutex::new(SessionCache::default());
        for (config, shell_value, expected) in [
            (text, "one", "one"),
            (text, "two", "one"),
            (r#"{"apiKey":"${CCGUI_PI_ENV_CACHED}"}"#, "two", "two"),
        ] {
            let mut command = Command::new("pi");
            inject_from_probe_cached(
                &mut command,
                "pi",
                config,
                &bash_probe(vec![(key.into(), shell_value.into())]),
                &cache,
            )
            .await;
            assert_eq!(command_env(&command, key).as_deref(), Some(expected));
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn failed_probe_is_retried() {
        let key = "CCGUI_PI_ENV_RETRY";
        let text = r#"{"apiKey":"$CCGUI_PI_ENV_RETRY"}"#;
        let cache = Mutex::new(SessionCache::default());
        let mut probe = bash_probe(Vec::new());
        probe.program = PathBuf::from("/nonexistent/ccgui-test-shell");
        let mut first = Command::new("pi");
        inject_from_probe_cached(&mut first, "pi", text, &probe, &cache).await;
        assert_eq!(command_env(&first, key), None);
        let mut second = Command::new("pi");
        inject_from_probe_cached(
            &mut second,
            "pi",
            text,
            &bash_probe(vec![(key.into(), "retried".into())]),
            &cache,
        )
        .await;
        assert_eq!(command_env(&second, key).as_deref(), Some("retried"));
    }

    #[test]
    fn pi_suffix_is_an_env_ref() {
        assert!(collect_env_refs("$CCH_GROK-suffix").contains("CCH_GROK"));
    }

    #[test]
    fn pi_escaped_dollar_is_not_an_env_ref() {
        assert!(!collect_env_refs("$$CCH_GROK").contains("CCH_GROK"));
        assert!(collect_env_refs("$$$CCH_GROK").contains("CCH_GROK"));
    }

    #[test]
    fn pi_malformed_brace_does_not_swallow_later_refs() {
        assert!(collect_env_refs("${oops $CCH_GROK").contains("CCH_GROK"));
        assert!(collect_refs("pi", r#"{"a":"${oops","apiKey":"$CCH_GROK"}"#).contains("CCH_GROK"));
    }

    #[test]
    fn pi_invalid_braced_literal_does_not_resolve_nested_refs() {
        assert!(collect_env_refs("${bad$NESTED}").is_empty());
        assert_eq!(
            collect_env_refs("${bad-name} $VALID"),
            BTreeSet::from(["VALID".into()])
        );
        assert!(collect_env_refs("!echo $COMMAND_KEY").is_empty());
    }

    #[test]
    fn pi_refs_are_parsed_from_config_strings() {
        let refs = collect_refs(
            "pi",
            r#"{
            // $COMMENT_KEY must not be injected
            "apiKey": "$CCH_GROK", "headers": {"X": "${CCH_API_KEY}", "Y": "\u0024ESCAPED_KEY"},
            "invalid": "$1NO", "escaped": "$$LITERAL"
        }"#,
        );
        assert_eq!(
            refs,
            BTreeSet::from([
                "CCH_GROK".into(),
                "CCH_API_KEY".into(),
                "ESCAPED_KEY".into()
            ])
        );
    }

    #[test]
    fn omp_only_collects_provider_api_key_names() {
        let yaml = "providers:\n  relay:\n    apiKey: CCH_GROK\n    headers:\n      X: HEADER_NAME\n    models:\n      - id: grok-4\n  command:\n    apiKey: '!echo COMMAND_KEY'\n  dollar:\n    apiKey: $DOLLAR_KEY\n  braced:\n    apiKey: ${BRACED_KEY}\n  literal:\n    apiKey: sk-literal\n  spaced:\n    apiKey: ' PADDED_KEY '\n";
        assert_eq!(
            collect_omp_env_refs(yaml),
            BTreeSet::from(["CCH_GROK".into()])
        );
        assert!(collect_omp_env_refs("providers: [invalid]").is_empty());
    }

    #[test]
    fn engines_use_their_own_source_and_parser() {
        assert_eq!(
            config_source("pi").unwrap().file_name().unwrap(),
            "models.json"
        );
        assert_eq!(
            config_source("omp").unwrap().file_name().unwrap(),
            "models.yml"
        );
        assert!(config_source("codex").is_none());
        let pi = r#"{"providers":{"relay":{"apiKey":"$PI_ONLY"}}}"#;
        assert_eq!(collect_refs("pi", pi), BTreeSet::from(["PI_ONLY".into()]));
        assert!(collect_refs("omp", pi).is_empty());
        let omp = "providers:\n  relay:\n    apiKey: OMP_ONLY\n";
        assert_eq!(
            collect_refs("omp", omp),
            BTreeSet::from(["OMP_ONLY".into()])
        );
        assert!(collect_refs("pi", omp).is_empty());
    }
}
