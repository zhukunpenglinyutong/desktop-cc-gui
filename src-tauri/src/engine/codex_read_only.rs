use super::{BuiltCommand, SendRequest};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub(super) const PERMISSION: &str = "plugin-read-only";
pub(super) struct StagedHomeGuard(pub Vec<PathBuf>);

impl Drop for StagedHomeGuard {
    fn drop(&mut self) {
        super::cleanup_staged_files(&self.0);
    }
}

const DISABLED_FEATURES: &[&str] = &[
    "apps",
    "plugins",
    "remote_plugin",
    "hooks",
    "code_mode",
    "code_mode_only",
    "code_mode_host",
    "code_mode_prewarm",
    "multi_agent",
    "multi_agent_v2",
    "guardianv2",
    "guardian_ext",
    "shell_snapshot",
    "shell_snapshot_v2",
    "shell_zsh_fork",
    "unified_exec_zsh_fork",
    "browser_use",
    "computer_use",
    "in_app_browser",
    "in_app_local_automation",
    "memories",
    "skill_mcp_dependency_install",
    "tool_suggest",
    "recommended_plugins",
    "workspace_dependencies",
    "image_generation",
    "artifact",
    "remote_control",
    "standalone_web_search",
];

pub(super) fn requested(req: &SendRequest) -> bool {
    req.permission.as_deref() == Some(PERMISSION)
}

pub(super) fn fresh_plugin_session(
    engine: &str,
    read_only: Option<bool>,
    session: Option<String>,
) -> Option<String> {
    if engine == "codex" && read_only == Some(true) {
        None
    } else {
        session
    }
}

pub(super) fn stage(
    req: &SendRequest,
    built: &mut BuiltCommand,
    native_home: &Path,
    staging_root: &Path,
) -> Result<(), String> {
    if !cfg!(target_os = "macos") || req.session_id.is_some() || req.computer_use == Some(true) {
        return Err("Codex read-only planning currently requires a fresh local macOS session without computer use".into());
    }
    let workspace = std::fs::canonicalize(&req.workspace)
        .map_err(|_| "Codex read-only workspace must be an existing local directory")?;
    if !workspace.is_dir() {
        return Err("Codex read-only workspace must be a directory".into());
    }
    let native_config = match std::fs::read_to_string(native_home.join("config.toml")) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(_) => return Err("Cannot read native Codex provider configuration".into()),
    };
    let config: toml::Table = toml::from_str(&native_config)
        .map_err(|_| "Invalid native Codex provider configuration")?;
    if config
        .get("cli_auth_credentials_store")
        .and_then(toml::Value::as_str)
        == Some("keyring")
    {
        return Err(
            "Isolated Codex read-only planning does not support keyring-only authentication".into(),
        );
    }
    super::codex::apply_channel(
        &mut built.command,
        &json!({"settingsConfig":{"config":native_config}}),
        &Default::default(),
        req,
    )?;
    std::fs::create_dir_all(staging_root)
        .map_err(|_| "Cannot create Codex planning staging root")?;
    if std::fs::symlink_metadata(staging_root)
        .map_err(|_| "Cannot inspect Codex staging root")?
        .file_type()
        .is_symlink()
    {
        return Err("Codex planning staging root must not be a symlink".into());
    }
    let directory = staging_root.join(uuid::Uuid::new_v4().simple().to_string());
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(&directory)
        .map_err(|_| "Cannot create private Codex planning home")?;
    let result = (|| {
        std::fs::write(
            directory.join("config.toml"),
            "cli_auth_credentials_store = \"file\"\n",
        )
        .map_err(|_| "Cannot initialize private Codex planning home")?;
        let auth = native_home.join("auth.json");
        if auth.is_file() {
            #[cfg(unix)]
            std::os::unix::fs::symlink(
                std::fs::canonicalize(auth).map_err(|_| "Cannot resolve Codex auth file")?,
                directory.join("auth.json"),
            )
            .map_err(|_| "Cannot reference Codex authentication in private planning home")?;
        }
        built.command.env("CODEX_HOME", &directory);
        for name in DISABLED_FEATURES {
            built
                .command
                .args(["-c", &format!("features.{name}=false")]);
        }
        for value in [
            "notify=[]",
            "allow_login_shell=false",
            "sandbox_mode=\"read-only\"",
            "approval_policy=\"never\"",
            "web_search=\"disabled\"",
            "project_root_markers=[]",
        ] {
            built.command.args(["-c", value]);
        }
        let workspace_key = toml::Value::String(workspace.to_string_lossy().into_owned());
        built.command.args([
            "-c",
            &format!("projects.{workspace_key}.trust_level=\"untrusted\""),
        ]);
        Ok(())
    })();
    if result.is_err() {
        super::cleanup_staged_files(&[directory]);
    } else {
        built.cleanup_files.push(directory);
    }
    result
}

pub(super) fn validate_version(response: &Value) -> Result<(), String> {
    let version = response
        .get("userAgent")
        .and_then(Value::as_str)
        .and_then(|agent| agent.split_once('/'))
        .and_then(|(_, suffix)| suffix.split_whitespace().next());
    if version != Some("0.154.0") {
        return Err("Codex read-only planning requires audited Codex 0.154.0; refusing an unverified version".into());
    }
    Ok(())
}

pub(super) fn validate_config(response: &Value, isolated_home: &Path) -> Result<(), String> {
    let config = response
        .get("config")
        .ok_or("Missing isolated Codex config")?;
    if !config
        .get("mcp_servers")
        .and_then(Value::as_object)
        .is_some_and(|servers| servers.is_empty())
    {
        return Err("Isolated Codex planning refuses inherited MCP servers".into());
    }
    for feature in DISABLED_FEATURES {
        if config
            .get("features")
            .and_then(|features| features.get(*feature))
            != Some(&json!(false))
        {
            return Err(format!(
                "Codex planning cannot verify features.{feature} is disabled"
            ));
        }
    }
    for (field, expected) in [
        ("notify", json!([])),
        ("allow_login_shell", json!(false)),
        ("sandbox_mode", json!("read-only")),
        ("approval_policy", json!("never")),
        ("web_search", json!("disabled")),
        ("project_root_markers", json!([])),
    ] {
        if config.get(field) != Some(&expected) {
            return Err(format!("Codex planning cannot verify {field}"));
        }
    }
    let layers = response
        .get("layers")
        .and_then(Value::as_array)
        .ok_or("Missing Codex config layers")?;
    for layer in layers {
        let kind = layer.pointer("/name/type").and_then(Value::as_str);
        let allowed = match kind {
            Some("sessionFlags") => true,
            Some("user") => layer
                .pointer("/name/file")
                .and_then(Value::as_str)
                .is_some_and(|file| {
                    Path::new(file) == isolated_home.join("config.toml")
                        && no_exec_policy(Path::new(file))
                }),
            Some("project") => layer
                .get("disabledReason")
                .and_then(Value::as_str)
                .is_some_and(|reason| !reason.is_empty()),
            Some("system") => {
                layer
                    .get("config")
                    .and_then(Value::as_object)
                    .is_some_and(|config| config.is_empty())
                    && layer
                        .pointer("/name/file")
                        .and_then(Value::as_str)
                        .is_some_and(|file| no_exec_policy(Path::new(file)))
            }
            _ => false,
        };
        if !allowed {
            return Err(
                "Codex planning refuses active external or managed configuration layers".into(),
            );
        }
    }
    Ok(())
}

fn no_exec_policy(config_file: &Path) -> bool {
    if !config_file.is_absolute() {
        return false;
    }
    config_file.parent().is_some_and(|parent| {
        matches!(std::fs::symlink_metadata(parent.join("rules")), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
    })
}

pub(super) fn validate_thread(response: &Value) -> Result<(), String> {
    if response.get("approvalPolicy") != Some(&json!("never"))
        || response.pointer("/sandbox/type") != Some(&json!("readOnly"))
        || response.pointer("/sandbox/networkAccess") != Some(&json!(false))
    {
        return Err(
            "Codex did not confirm read-only sandbox with network disabled and approvals never"
                .into(),
        );
    }
    Ok(())
}

pub(super) fn isolated_home(command: &tokio::process::Command) -> Result<PathBuf, String> {
    command
        .as_std()
        .get_envs()
        .find(|(key, _)| *key == "CODEX_HOME")
        .and_then(|(_, value)| value)
        .map(PathBuf::from)
        .ok_or_else(|| "Codex read-only launch has no isolated home".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn private_home_guard_cleans_on_abort_without_deleting_referenced_auth() {
        let root =
            std::env::temp_dir().join(format!("ccgui-codex-cleanup-{}", uuid::Uuid::new_v4()));
        let private = root.join("private");
        std::fs::create_dir_all(&private).unwrap();
        let auth = root.join("auth.json");
        std::fs::write(&auth, "test credential").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&auth, private.join("auth.json")).unwrap();
        let guard = StagedHomeGuard(vec![private.clone()]);
        let task = tokio::spawn(async move {
            let _guard = guard;
            std::future::pending::<()>().await;
        });
        tokio::task::yield_now().await;
        task.abort();
        assert!(task.await.is_err());
        assert!(!private.exists());
        assert_eq!(std::fs::read_to_string(auth).unwrap(), "test credential");
        std::fs::remove_dir_all(root).unwrap();
    }

    fn safe_config() -> Value {
        let mut features = serde_json::Map::new();
        for name in DISABLED_FEATURES {
            features.insert((*name).into(), json!(false));
        }
        json!({"config":{"mcp_servers":{},"features":features,"notify":[],"allow_login_shell":false,"sandbox_mode":"read-only","approval_policy":"never","web_search":"disabled","project_root_markers":[]},"layers":[{"name":{"type":"sessionFlags"},"config":{}}]})
    }

    #[test]
    fn rejects_unaudited_versions_and_unconfirmed_sandbox() {
        assert!(validate_version(&json!({"userAgent":"ccgui/0.154.0 (Mac OS)"})).is_ok());
        // The app-server handshake keeps the CLI's native identity.
        assert!(validate_version(&json!({"userAgent":"codex_cli_rs/0.154.0 (Mac OS 15.5.0; arm64) unknown"})).is_ok());
        assert!(validate_version(&json!({"userAgent":"Codex Desktop/0.154.0 (Mac OS)"})).is_ok());
        for version in [
            "ccgui/0.153.0 x",
            "ccgui/0.155.0 x",
            "ccgui/0.154.0-dev x",
            "",
        ] {
            assert!(validate_version(&json!({"userAgent":version})).is_err());
        }
        assert!(validate_thread(
            &json!({"approvalPolicy":"never","sandbox":{"type":"readOnly","networkAccess":false}})
        )
        .is_ok());
        for sandbox in [
            json!({"type":"workspaceWrite"}),
            json!({"type":"readOnly","networkAccess":true}),
            Value::Null,
        ] {
            assert!(validate_thread(&json!({"approvalPolicy":"never","sandbox":sandbox})).is_err());
        }
    }

    #[test]
    fn plugin_planning_discards_codex_native_history_but_preserves_other_callers() {
        assert_eq!(
            fresh_plugin_session("codex", Some(true), Some("old-session".into())),
            None
        );
        for (engine, read_only) in [("codex", None), ("codex", Some(false)), ("pi", Some(true))] {
            assert_eq!(
                fresh_plugin_session(engine, read_only, Some("old-session".into())),
                Some("old-session".into())
            );
        }
    }

    #[test]
    fn rejects_external_tools_hooks_and_active_config_layers() {
        assert!(
            validate_config(&safe_config(), std::path::Path::new("/private/plan-home")).is_ok()
        );
        for (field, value) in [
            ("mcp_servers", json!({"inherited":{"enabled":true}})),
            ("notify", json!(["sh", "evil"])),
            ("allow_login_shell", json!(true)),
        ] {
            let mut config = safe_config();
            config["config"][field] = value;
            assert!(validate_config(&config, std::path::Path::new("/private/plan-home")).is_err());
        }
        for feature in DISABLED_FEATURES {
            let mut config = safe_config();
            config["config"]["features"][*feature] = json!(true);
            assert!(
                validate_config(&config, std::path::Path::new("/private/plan-home")).is_err(),
                "{feature}"
            );
        }
        for source in ["project", "system", "mdm", "cloud", "unknown"] {
            let mut config = safe_config();
            config["layers"] = json!([{"name":{"type":source},"config":{"hooks":{}}}]);
            assert!(validate_config(&config, std::path::Path::new("/private/plan-home")).is_err());
        }
    }

    #[test]
    fn empty_system_config_does_not_hide_sandbox_bypass_rules() {
        let root =
            std::env::temp_dir().join(format!("ccgui-codex-policy-{}", uuid::Uuid::new_v4()));
        let _guard = StagedHomeGuard(vec![root.clone()]);
        std::fs::create_dir_all(&root).unwrap();
        let mut config = safe_config();
        config["layers"] =
            json!([{"name":{"type":"system","file":root.join("config.toml")},"config":{}}]);
        assert!(validate_config(&config, Path::new("/private/plan-home")).is_ok());
        std::fs::create_dir_all(root.join("rules")).unwrap();
        std::fs::write(
            root.join("rules/default.rules"),
            "prefix_rule(pattern=[\"touch\"], decision=\"allow\")",
        )
        .unwrap();
        assert!(validate_config(&config, Path::new("/private/plan-home")).is_err());
    }
}
