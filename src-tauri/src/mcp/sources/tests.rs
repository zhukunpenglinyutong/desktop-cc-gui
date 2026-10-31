//! `sources` 的单元测试（读取/写入/路径解析）。所有用例都用临时 HOME 或
//! 临时目录，不读写真实用户配置。

use super::read::{read_dsh_profile, read_json_source, read_toml_source};
use super::write::{set_json_enabled, write_enabled};
use crate::mcp::config::file_hash;
use std::path::{Path, PathBuf};

use super::*;

/// 测试期间的 scratch HOME：持全 crate 共享的 HOME 串行锁，并在 Windows 上
/// 同时指向 USERPROFILE（engine_home 的测试回落两者都读）。此前不持锁时，
/// 并发改 HOME 的测试会把这里的 grok home 解析到别的 scratch 目录。
struct HomeGuard {
    _lock: parking_lot::MutexGuard<'static, ()>,
    home: Option<std::ffi::OsString>,
    profile: Option<std::ffi::OsString>,
}
impl HomeGuard {
    fn new(home: &Path) -> Self {
        let lock = crate::paths::HOME_ENV_LOCK.lock();
        let previous_home = std::env::var_os("HOME");
        let previous_profile = std::env::var_os("USERPROFILE");
        std::env::set_var("HOME", home);
        std::env::set_var("USERPROFILE", home);
        Self {
            _lock: lock,
            home: previous_home,
            profile: previous_profile,
        }
    }
}
impl Drop for HomeGuard {
    fn drop(&mut self) {
        match self.home.take() {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        match self.profile.take() {
            Some(value) => std::env::set_var("USERPROFILE", value),
            None => std::env::remove_var("USERPROFILE"),
        }
    }
}

struct Scratch(PathBuf);
impl Scratch {
    fn new(tag: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "ccgui-mcp-sources-{}-{tag}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn source(id: &str) -> &'static Source {
    SOURCES.iter().find(|source| source.id == id).unwrap()
}

#[test]
fn every_declared_source_is_registered_and_consistent() {
    for entry in SOURCES {
        let spec = source_spec(entry.id).expect("registered");
        assert_eq!(spec.engine, entry.engine);
        assert_eq!(spec.writable, entry.writable);
        if entry.writable {
            assert!(entry.readonly_reason_code.is_empty());
        } else {
            assert!(!entry.readonly_reason_code.is_empty());
        }
    }
    // 没有 `disabled_mcp_servers` 之类跨文件语义的来源才开放写入。
    assert!(source("grok_user").writable);
    assert!(!source("grok_project").writable);
}

#[test]
fn kimi_json_entries_read_transport_state_and_redact_url() {
    let scratch = Scratch::new("kimi");
    let path = scratch.path().join("mcp.json");
    std::fs::write(
        &path,
        r#"{"mcpServers":{"alpha":{"command":"npx","args":["-y","pkg"],"env":{"API_KEY":"secret"}},
            "remote":{"url":"https://example.com/mcp?token=abc&x=1","headers":{"Authorization":"Bearer x"}},
            "off":{"command":"uvx","enabled":false}}}"#,
    )
    .unwrap();
    let entries = read_json_source(source("kimi_user"), &path).unwrap();
    assert_eq!(entries.len(), 3);
    let alpha = entries.iter().find(|entry| entry.name == "alpha").unwrap();
    assert!(alpha.enabled);
    assert_eq!(alpha.args_count, 2);
    assert_eq!(alpha.env_keys, vec!["API_KEY"]);
    assert!(!alpha.writable);
    assert_eq!(
        alpha.readonly_reason_code.as_deref(),
        Some(REASON_UNVERIFIED_WRITE)
    );
    let remote = entries.iter().find(|entry| entry.name == "remote").unwrap();
    assert_eq!(
        remote.url.as_deref(),
        Some("https://example.com/mcp?token=***&x=1")
    );
    assert_eq!(remote.header_keys, vec!["Authorization"]);
    let off = entries.iter().find(|entry| entry.name == "off").unwrap();
    assert!(!off.enabled);
}

#[test]
fn agy_and_qoder_use_inverted_disabled_flag() {
    let scratch = Scratch::new("agy");
    let path = scratch.path().join("mcp_config.json");
    std::fs::write(
        &path,
        r#"{"mcpServers":{"on":{"command":"node","serverUrl":"https://x/mcp"},"off":{"command":"node","disabled":true}}}"#,
    )
    .unwrap();
    let entries = read_json_source(source("agy_project"), &path).unwrap();
    assert!(entries.iter().find(|entry| entry.name == "on").unwrap().enabled);
    assert!(!entries.iter().find(|entry| entry.name == "off").unwrap().enabled);
    assert_eq!(entries[0].format, "json");
    assert_eq!(entries[0].engine, "agy");
}

#[test]
fn opencode_command_array_becomes_command_plus_args() {
    let scratch = Scratch::new("opencode");
    let path = scratch.path().join("opencode.json");
    std::fs::write(
        &path,
        r#"{"mcp":{"web":{"type":"remote","url":"https://mcp.exa.ai/mcp","enabled":false},
            "local":{"type":"local","command":["npx","-y","pkg"],"environment":{"TOKEN":"x"}}}}"#,
    )
    .unwrap();
    let entries = read_json_source(source("opencode_project"), &path).unwrap();
    let local = entries.iter().find(|entry| entry.name == "local").unwrap();
    assert_eq!(local.command.as_deref(), Some("npx"));
    assert_eq!(local.args_count, 2);
    assert_eq!(local.env_keys, vec!["TOKEN"]);
    let web = entries.iter().find(|entry| entry.name == "web").unwrap();
    assert!(!web.enabled);
    assert_eq!(web.transport.as_deref(), Some("remote"));
}

#[test]
fn opencode_toggle_writes_enabled_and_round_trips() {
    let scratch = Scratch::new("opencode-write");
    let path = scratch.path().join("opencode.json");
    let original = "{\n  \"$schema\": \"https://opencode.ai/config.json\",\n  \"mcp\": {\n    \"local\": {\n      \"type\": \"local\",\n      \"command\": [\"npx\"]\n    }\n  }\n}\n";
    std::fs::write(&path, original).unwrap();
    let version = file_hash(original.as_bytes());
    set_json_enabled(source("opencode_project"), &path, "local", false, &version).unwrap();
    let raw = std::fs::read_to_string(&path).unwrap();
    assert!(raw.contains("\"$schema\""));
    let entries = read_json_source(source("opencode_project"), &path).unwrap();
    assert!(!entries[0].enabled);

    let version = file_hash(raw.as_bytes());
    set_json_enabled(
        source("opencode_project"),
        &path,
        "local",
        true,
        &version,
    )
    .unwrap();
    assert!(read_json_source(source("opencode_project"), &path).unwrap()[0].enabled);

    // 版本冲突拒绝写入；未知服务 not_found。
    let error =
        set_json_enabled(source("opencode_project"), &path, "local", false, "stale").unwrap_err();
    assert_eq!(error.code, "conflict");
    let raw = std::fs::read_to_string(&path).unwrap();
    let version = file_hash(raw.as_bytes());
    let error = set_json_enabled(
        source("opencode_project"),
        &path,
        "ghost",
        false,
        &version,
    )
    .unwrap_err();
    assert_eq!(error.code, "not_found");
}

#[test]
fn omp_toggle_writes_the_enabled_field_and_round_trips() {
    // OMP 原生 mcp.json：`enabled: false` 就是 `/mcp disable` 写的停用字段。
    let scratch = Scratch::new("omp-write");
    let path = scratch.path().join("mcp.json");
    let original = "{\n  \"mcpServers\": {\n    \"rea\": {\n      \"command\": \"cmd.exe\",\n      \"args\": [\"/c\", \"rea\"]\n    }\n  }\n}\n";
    std::fs::write(&path, original).unwrap();
    assert!(source("omp_user").writable);
    assert!(source("omp_project").writable);
    set_json_enabled(source("omp_user"), &path, "rea", false, &file_hash(original.as_bytes())).unwrap();
    let raw = std::fs::read_to_string(&path).unwrap();
    let entries = read_json_source(source("omp_user"), &path).unwrap();
    assert!(!entries[0].enabled);
    let written: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(written["mcpServers"]["rea"]["enabled"], serde_json::json!(false));
    // 其余字段原样保留。
    assert_eq!(written["mcpServers"]["rea"]["command"], "cmd.exe");
    set_json_enabled(source("omp_user"), &path, "rea", true, &file_hash(raw.as_bytes())).unwrap();
    let entries = read_json_source(source("omp_user"), &path).unwrap();
    assert!(entries[0].enabled);
}

#[test]
fn grok_disabled_list_and_enabled_field_combine_for_both_scopes() {
    let scratch = Scratch::new("grok");
    let home = scratch.path().join("home");
    std::fs::create_dir_all(home.join(".grok")).unwrap();
    let _home = HomeGuard::new(&home);
    let user_path = home.join(".grok").join("config.toml");
    std::fs::write(
        &user_path,
        "disabled_mcp_servers = [\"beta\"]\n\n[mcp_servers.alpha]\ncommand = \"npx\"\n\n[mcp_servers.beta]\ncommand = \"uvx\"\nenabled = false\n",
    )
    .unwrap();
    let entries = read_toml_source(source("grok_user"), &user_path).unwrap();
    assert!(entries.iter().find(|entry| entry.name == "alpha").unwrap().enabled);
    assert!(!entries.iter().find(|entry| entry.name == "beta").unwrap().enabled);
    assert_eq!(entries[0].format, "toml");

    // 项目级同名服务同样受用户停用列表影响。
    let workspace = scratch.path().join("ws");
    std::fs::create_dir_all(workspace.join(".grok")).unwrap();
    let project_path = workspace.join(".grok").join("config.toml");
    std::fs::write(&project_path, "[mcp_servers.beta]\nurl = \"https://x/mcp\"\n").unwrap();
    let project = read_toml_source(source("grok_project"), &project_path).unwrap();
    assert!(!project[0].enabled);
    assert!(!source("grok_project").writable);
}

#[test]
fn grok_toggle_updates_field_and_keeps_comments() {
    let scratch = Scratch::new("grok-write");
    let home = scratch.path().join("home");
    std::fs::create_dir_all(home.join(".grok")).unwrap();
    let _home = HomeGuard::new(&home);
    let path = home.join(".grok").join("config.toml");
    let original = "# keep\n[mcp_servers.alpha]\ncommand = \"npx\"\n\n[other]\nvalue = 1\n";
    std::fs::write(&path, original).unwrap();
    let version = file_hash(original.as_bytes());
    let entry = write_enabled("grok_user", "alpha", false, &version, None).unwrap();
    assert!(!entry.enabled);
    let raw = std::fs::read_to_string(&path).unwrap();
    assert!(raw.contains("# keep"));
    assert!(raw.contains("[other]"));
    assert!(raw.contains("disabled_mcp_servers"));
    assert!(raw.contains("enabled = false"));

    let version = file_hash(raw.as_bytes());
    let entry = write_enabled("grok_user", "alpha", true, &version, None).unwrap();
    assert!(entry.enabled);
    let raw = std::fs::read_to_string(&path).unwrap();
    assert!(!raw.contains("disabled_mcp_servers"));
    assert!(raw.contains("enabled = true"));
}

#[test]
fn readonly_sources_refuse_writes() {
    let error = write_enabled("kimi_user", "alpha", false, "", None).unwrap_err();
    assert_eq!(error.code, "readonly");
    let error = write_enabled("dsh_profile", "alpha", false, "", None).unwrap_err();
    assert_eq!(error.code, "readonly");
}

#[test]
fn dsh_profile_entries_come_from_plugin_instances() {
    let scratch = Scratch::new("dsh");
    let path = scratch.path().join("cordis.patch.yml");
    std::fs::write(
        &path,
        "\
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: x
- id: other
  name: 'something-else'
- id: group
  insert:
    - id: mcp-web
      name: '@deepseek-ai/dsh-mcp-client'
      disabled: true
      config:
        serverName: web
        transport: streamable-http
        url: https://mcp.example.com/mcp
        headers:
          Authorization: Bearer x
",
    )
    .unwrap();
    let entries = read_dsh_profile(&path).unwrap();
    assert_eq!(entries.len(), 2);
    let github = entries.iter().find(|entry| entry.name == "github").unwrap();
    assert!(github.enabled);
    assert_eq!(github.command.as_deref(), Some("npx"));
    assert_eq!(github.args_count, 2);
    assert_eq!(github.env_keys, vec!["GITHUB_TOKEN"]);
    assert_eq!(github.readonly_reason_code.as_deref(), Some(REASON_DSH_PLUGIN));
    let web = entries.iter().find(|entry| entry.name == "web").unwrap();
    assert!(!web.enabled);
    assert_eq!(web.transport.as_deref(), Some("streamable-http"));
    assert_eq!(web.header_keys, vec!["Authorization"]);
}

#[test]
fn jsonc_sources_parse_comments_and_stay_readonly() {
    let scratch = Scratch::new("jsonc");
    let path = scratch.path().join("opencode.jsonc");
    std::fs::write(
        &path,
        r#"{
  // 全局配置
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "local": {
      /* 本地服务 */
      "type": "local",
      "command": ["npx", "-y", "pkg"],
    },
  },
}
"#
    )
    .unwrap();
    let entries = read_json_source(source("opencode_user"), &path).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].command.as_deref(), Some("npx"));
    assert_eq!(entries[0].args_count, 2);
    // 注释会丢，所以 JSONC 一律按只读降级（来源本身可写也不开）。
    assert!(!entries[0].writable);
    assert_eq!(
        entries[0].readonly_reason_code.as_deref(),
        Some(REASON_JSONC_READONLY)
    );
    assert!(source("opencode_user").writable);
    let error = set_json_enabled(source("opencode_user"), &path, "local", false, "").unwrap_err();
    assert_eq!(error.code, "readonly");
    // 原文件未被改写（注释还在）。
    assert!(std::fs::read_to_string(&path).unwrap().contains("全局配置"));
}

#[test]
fn malformed_files_surface_a_source_error_not_a_panic() {
    let scratch = Scratch::new("broken");
    let json_path = scratch.path().join("dsh.json");
    std::fs::write(&json_path, "{not json").unwrap();
    assert!(read_json_source(source("kimi_user"), &json_path).is_err());
    let yaml_path = scratch.path().join("cordis.yml");
    std::fs::write(&yaml_path, "a: [unclosed").unwrap();
    assert!(read_dsh_profile(&yaml_path).is_err());
}

#[test]
fn candidate_paths_follow_cli_homes() {
    let scratch = Scratch::new("paths");
    let _home = HomeGuard::new(scratch.path());
    std::env::set_var("KIMI_CODE_HOME", scratch.path().join("kimi"));
    std::env::set_var("OMP_CODING_AGENT_DIR", scratch.path().join("omp"));
    let kimi = candidate_paths("kimi_user", None);
    assert_eq!(kimi[0], scratch.path().join("kimi").join("mcp.json"));
    let omp = candidate_paths("omp_user", None);
    assert_eq!(omp[0], scratch.path().join("omp").join("mcp.json"));
    std::env::remove_var("KIMI_CODE_HOME");
    std::env::remove_var("OMP_CODING_AGENT_DIR");
    let project = candidate_paths("kimi_local", Some("/ws"));
    assert_eq!(project[0], Path::new("/ws/.kimi-code/mcp.json"));
    assert!(candidate_paths("kimi_local", None).is_empty());
}
