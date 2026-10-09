use super::{
    command_for_binary, images, safe_prompt_arg, BuiltCommand, Engine, EngineEvent, SendRequest,
    Transport,
};
use serde_json::Value;

pub struct GrokEngine;

/// Grok rewrites config.toml during startup; GROK_CONFIG_PATH is only an
/// overlay. Isolate its writable home, but keep transcripts in the native home.
pub(super) fn isolate_channel(
    built: &mut BuiltCommand,
    provider: &Value,
    req: &SendRequest,
) -> Result<(), String> {
    stage_channel(
        built,
        provider,
        req.model.as_deref(),
        &super::engine_home(Some("GROK_HOME"), ".grok"),
        &crate::paths::app_home().join("grok-staging"),
    )
}

fn stage_channel(
    built: &mut BuiltCommand,
    provider: &Value,
    model: Option<&str>,
    native_home: &std::path::Path,
    directory: &std::path::Path,
) -> Result<(), String> {
    let config = native_home.join("config.toml");
    let base = match std::fs::read_to_string(&config) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("read {}: {e}", config.display())),
    };
    let env = crate::provider_files::channel_env("grok", provider)?;
    let content = crate::provider_files::render_grok(&base, provider)?;
    let mut doc: toml::Value = toml::from_str(&content).map_err(|_| "Invalid Grok config TOML")?;
    let model = model
        .or_else(|| env.get("GROK_MODEL").map(String::as_str))
        .or_else(|| doc.get("models")?.get("default")?.as_str())
        .map(str::to_owned);
    if let Some(model) = model {
        let root = doc.as_table_mut().ok_or("Grok config must be a table")?;
        root.entry("models")
            .or_insert_with(|| toml::Value::Table(Default::default()))
            .as_table_mut()
            .ok_or("Grok models must be a table")?
            .insert("default".into(), toml::Value::String(model.clone()));
        let table = root
            .entry("model")
            .or_insert_with(|| toml::Value::Table(Default::default()))
            .as_table_mut()
            .ok_or("Grok model must be a table")?
            .entry(model.clone())
            .or_insert_with(|| toml::Value::Table(Default::default()))
            .as_table_mut()
            .ok_or("Grok model entry must be a table")?;
        table.insert("model".into(), toml::Value::String(model));
        // Per-model routing/credentials outrank global env and native auth.
        if let Some(base) = env.get("GROK_MODELS_BASE_URL") {
            table.insert("base_url".into(), toml::Value::String(base.clone()));
        }
        if let Some(key) = env
            .get("XAI_API_KEY")
            .or_else(|| env.get("GROK_CODE_XAI_API_KEY"))
        {
            table.remove("env_key");
            table.insert("api_key".into(), toml::Value::String(key.clone()));
        }
    }
    let content = toml::to_string(&doc).map_err(|_| "Cannot serialize Grok channel config")?;
    std::fs::create_dir_all(directory).map_err(|e| format!("create grok staging dir: {e}"))?;
    let directory = directory.join(format!("grok-channel-{}", uuid::Uuid::new_v4()));
    #[allow(unused_mut)]
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(&directory)
        .map_err(|e| format!("create private grok home: {e}"))?;
    built.cleanup_files.push(directory.clone());
    // Copy configuration inputs, including managed policy and user extensions.
    // Never link these: CLI writes must stay private. Exclude runtime caches.
    // Symlinks are skipped, not followed: a link could point at sensitive
    // paths outside the native config tree, and copied contents would strand
    // in the private staging dir.
    if native_home.exists() {
        for entry in std::fs::read_dir(native_home).map_err(|e| format!("read grok home: {e}"))? {
            let entry = entry.map_err(|e| format!("read grok home entry: {e}"))?;
            let file_type = entry
                .file_type()
                .map_err(|e| format!("read grok home entry type: {e}"))?;
            if file_type.is_symlink() {
                continue;
            }
            let name = entry.file_name();
            let name_text = name.to_string_lossy();
            if (file_type.is_file() && !name_text.ends_with(".lock"))
                || ["skills", "agents", "rules", "hooks", "plugins", "memory"]
                    .contains(&name_text.as_ref())
            {
                copy_config_input(&entry.path(), &directory.join(name), &mut Vec::new())
                    .map_err(|e| format!("copy grok configuration input: {e}"))?;
            }
        }
    }
    std::fs::write(directory.join("config.toml"), content)
        .map_err(|e| format!("write grok channel config: {e}"))?;
    let sessions = native_home.join("sessions");
    std::fs::create_dir_all(&sessions).map_err(|e| format!("create grok sessions dir: {e}"))?;
    link_sessions(&sessions, &directory.join("sessions"))
        .map_err(|e| format!("link grok session history: {e}"))?;
    built.command.env("GROK_HOME", directory);
    // An inherited GROK_CONFIG/GROK_CONFIG_PATH would override GROK_HOME
    // inside the CLI and silently un-isolate the channel — the probe tests
    // had to remove them explicitly because a shell can legitimately export
    // them. Strip them on the production path too.
    built.command.env_remove("GROK_CONFIG");
    built.command.env_remove("GROK_CONFIG_PATH");
    Ok(())
}

// Copy configuration inputs as private files. Symlinks are skipped (the
// caller's top-level loop filters them, and nested ones stop here): a link
// could point at sensitive paths outside the native tree. Directory cycles
// are rejected rather than linked back into the native configuration tree.
fn copy_config_input(
    source: &std::path::Path,
    target: &std::path::Path,
    ancestors: &mut Vec<std::path::PathBuf>,
) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(source)?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_dir() {
        let canonical = source.canonicalize()?;
        if ancestors.contains(&canonical) {
            return Err(std::io::Error::other(
                "cycle in Grok configuration directories",
            ));
        }
        ancestors.push(canonical);
        std::fs::create_dir(target)?;
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            copy_config_input(&entry.path(), &target.join(entry.file_name()), ancestors)?;
        }
        ancestors.pop();
    } else {
        std::fs::copy(source, target)?;
    }
    Ok(())
}

fn link_sessions(source: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, target)
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Junctions work without the symlink privilege. Pass paths as env values,
        // never interpolate user paths into PowerShell source.
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command",
                "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path $env:CCGUI_GROK_LINK -Target $env:CCGUI_GROK_SESSIONS | Out-Null"])
            .env("CCGUI_GROK_LINK", target)
            .env("CCGUI_GROK_SESSIONS", dunce::canonicalize(source)?)
            .creation_flags(0x0800_0000)
            .output()?;
        if output.status.success() {
            Ok(())
        } else {
            Err(std::io::Error::other(
                String::from_utf8_lossy(&output.stderr).into_owned(),
            ))
        }
    }
}

#[cfg(test)]
mod channel_tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn built() -> BuiltCommand {
        BuiltCommand {
            command: tokio::process::Command::new("grok"),
            stdin_payload: None,
            keep_stdin_open: false,
            cleanup_files: Vec::new(),
            mcp_restore: None,
            preassigned_session_id: None,
        }
    }

    fn env_path(built: &BuiltCommand, key: &str) -> PathBuf {
        built
            .command
            .as_std()
            .get_envs()
            .find(|(name, _)| *name == key)
            .and_then(|(_, value)| value)
            .map(PathBuf::from)
            .unwrap()
    }

    #[test]
    fn concurrent_channels_isolate_cli_config_saves_and_keep_native_files() {
        let directory =
            std::env::temp_dir().join(format!("ccgui-grok-channel-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let config = directory.join("config.toml");
        let auth = directory.join("auth.json");
        let original = "# keep this comment\n[models]\ndefault = \"native-model\"\n[model.selected-model]\napi_key = \"old-key\"\nenv_key = \"OLD_KEY\"\nbase_url = \"https://old.example\"\ncontext_window = 200000\n";
        std::fs::write(&config, original).unwrap();
        std::fs::write(&auth, "native-auth").unwrap();
        std::fs::create_dir_all(directory.join("sessions")).unwrap();
        std::fs::write(directory.join("sessions/keep.jsonl"), "history").unwrap();
        std::fs::write(directory.join("requirements.toml"), "policy = true").unwrap();
        let mut a = built();
        let mut b = built();
        for (built, key, base) in [
            (&mut a, "key-a", "https://a.example"),
            (&mut b, "key-b", "https://b.example"),
        ] {
            let provider =
                serde_json::json!({"apiKey":key,"baseUrl":base,"model":"channel-default"});
            stage_channel(
                built,
                &provider,
                Some("selected-model"),
                &directory,
                &directory.join("staging"),
            )
            .unwrap();
            let staged_path = env_path(built, "GROK_HOME").join("config.toml");
            assert_ne!(staged_path, config);
            let staged: toml::Value =
                toml::from_str(&std::fs::read_to_string(&staged_path).unwrap()).unwrap();
            assert_eq!(staged["models"]["default"].as_str(), Some("selected-model"));
            assert_eq!(
                staged["model"]["selected-model"]["api_key"].as_str(),
                Some(key)
            );
            assert_eq!(
                staged["model"]["selected-model"]["base_url"].as_str(),
                Some(base)
            );
            assert!(staged["model"]["selected-model"].get("env_key").is_none());
            assert_eq!(
                staged["model"]["selected-model"]["context_window"].as_integer(),
                Some(200000)
            );
            assert_eq!(staged["endpoints"]["models_base_url"].as_str(), Some(base));
            assert_eq!(
                std::fs::read_to_string(env_path(built, "GROK_HOME").join("auth.json")).unwrap(),
                "native-auth"
            );
            let home = env_path(built, "GROK_HOME");
            assert_eq!(
                std::fs::read_to_string(home.join("requirements.toml")).unwrap(),
                "policy = true"
            );
            assert_eq!(
                std::fs::read_to_string(home.join("sessions/keep.jsonl")).unwrap(),
                "history"
            );
            std::fs::write(home.join("sessions/new.jsonl"), "new history").unwrap();
            // Simulate the CLI persisting credentials and leaving a sidecar.
            std::fs::write(&staged_path, "rewritten by CLI").unwrap();
            std::fs::write(
                env_path(built, "GROK_HOME").join("auth.json"),
                "updated-auth",
            )
            .unwrap();
            std::fs::write(staged_path.with_extension("tmp"), "temporary secret").unwrap();
        }
        let a_path = env_path(&a, "GROK_HOME").join("config.toml");
        let b_path = env_path(&b, "GROK_HOME").join("config.toml");
        assert_ne!(a_path, b_path);
        super::super::cleanup_staged_files(&a.cleanup_files);
        assert!(!a_path.parent().unwrap().exists());
        assert!(b_path.exists());
        super::super::cleanup_staged_files(&b.cleanup_files);
        assert_eq!(
            std::fs::read_to_string(directory.join("sessions/keep.jsonl")).unwrap(),
            "history"
        );
        assert_eq!(
            std::fs::read_to_string(directory.join("sessions/new.jsonl")).unwrap(),
            "new history"
        );
        assert_eq!(std::fs::read_to_string(config).unwrap(), original);
        assert_eq!(std::fs::read_to_string(auth).unwrap(), "native-auth");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[ignore = "requires CCGUI_TEST_GROK_BIN pointing to an installed Grok CLI"]
    fn installed_grok_uses_channel_without_rewriting_native_config() {
        let binary = std::env::var("CCGUI_TEST_GROK_BIN").expect("set CCGUI_TEST_GROK_BIN");
        let directory =
            std::env::temp_dir().join(format!("ccgui-grok-probe-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let original = "# native comment\n[models]\ndefault = \"native-model\"\n[features]\nremote_fetch = false\n";
        std::fs::write(directory.join("config.toml"), original).unwrap();
        std::fs::write(directory.join("auth.json"), "{}").unwrap();
        let mut built = built();
        built.command = tokio::process::Command::new(binary);
        let provider = serde_json::json!({"model":"probe-model", "apiKey":"fake-probe-key", "baseUrl":"http://127.0.0.1:1"});
        for (key, value) in crate::provider_files::channel_env("grok", &provider).unwrap() {
            built.command.env(key, value);
        }
        stage_channel(
            &mut built,
            &provider,
            None,
            &directory,
            &directory.join("staging"),
        )
        .unwrap();
        built
            .command
            .args(["models"])
            .current_dir(&directory)
            .env("GROK_DISABLE_AUTOUPDATER", "1")
            .env_remove("GROK_CONFIG")
            .env_remove("GROK_CONFIG_PATH");
        let output = built.command.as_std_mut().output().unwrap();
        super::super::cleanup_staged_files(&built.cleanup_files);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("Default model: probe-model"));
        assert_eq!(
            std::fs::read_to_string(directory.join("config.toml")).unwrap(),
            original
        );
        assert_eq!(
            std::fs::read_to_string(directory.join("auth.json")).unwrap(),
            "{}"
        );
        assert!(directory.join("sessions").is_dir());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn staging_never_follows_symlinks_outside_the_native_home() {
        let directory =
            std::env::temp_dir().join(format!("ccgui-grok-symlink-test-{}", uuid::Uuid::new_v4()));
        let outside = directory.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();
        let native = directory.join("native");
        std::fs::create_dir_all(native.join("skills")).unwrap();
        std::fs::write(native.join("skills/real.txt"), "real").unwrap();
        std::fs::write(native.join("config.toml"), "[models]\ndefault = \"m\"\n").unwrap();
        std::os::unix::fs::symlink(outside.join("secret.txt"), native.join("linked-secret"))
            .unwrap();
        std::os::unix::fs::symlink(&outside, native.join("skills/linked-dir")).unwrap();
        let mut built = built();
        stage_channel(
            &mut built,
            &serde_json::json!({}),
            None,
            &native,
            &directory.join("staging"),
        )
        .unwrap();
        let home = env_path(&built, "GROK_HOME");
        assert!(!home.join("linked-secret").exists());
        assert!(!home.join("skills/linked-dir").exists());
        assert_eq!(
            std::fs::read_to_string(home.join("skills/real.txt")).unwrap(),
            "real"
        );
        super::super::cleanup_staged_files(&built.cleanup_files);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn invalid_native_config_fails_before_staging() {
        let directory =
            std::env::temp_dir().join(format!("ccgui-grok-invalid-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let config = directory.join("config.toml");
        std::fs::write(&config, "endpoints = 1").unwrap();
        let mut built = built();
        assert!(stage_channel(
            &mut built,
            &serde_json::json!({}),
            None,
            &directory,
            &directory.join("staging")
        )
        .is_err());
        assert!(built.cleanup_files.is_empty());
        assert!(!Path::new(&directory.join("staging")).exists());
        assert_eq!(std::fs::read_to_string(config).unwrap(), "endpoints = 1");
        std::fs::remove_dir_all(directory).unwrap();
    }
}

/// 提取并规范化上下文窗口字段，确保前端可以识别
fn attach_context_window(mut usage: Value) -> Value {
    // 如果已经有标准字段，直接返回
    if usage.get("model_context_window").is_some() {
        return usage;
    }

    // 尝试从多种可能的字段名中提取窗口大小
    let window = usage
        .get("context_window")
        .or_else(|| usage.get("contextWindow"))
        .or_else(|| usage.get("model_context_window"))
        .and_then(|v| {
            // 支持数字或字符串格式（如 "1M"）
            match v {
                Value::Number(n) => n.as_i64(),
                Value::String(s) => {
                    let s = s.trim();
                    // 支持 "1M", "1000k" 等格式
                    if let Some(captures) = regex::Regex::new(r"^(\d+(?:\.\d+)?)\s*([kKmM]?)$")
                        .ok()
                        .and_then(|re| re.captures(s))
                    {
                        let num: f64 = captures.get(1)?.as_str().parse().ok()?;
                        let multiplier = match captures.get(2)?.as_str().to_lowercase().as_str() {
                            "k" => 1000.0,
                            "m" => 1_000_000.0,
                            _ => 1.0,
                        };
                        Some((num * multiplier) as i64)
                    } else {
                        s.parse().ok()
                    }
                }
                _ => None,
            }
        });

    // 如果找到窗口大小，附加到标准字段名
    if let Some(w) = window {
        if w > 0 {
            if let Some(obj) = usage.as_object_mut() {
                obj.insert("model_context_window".to_string(), Value::Number(w.into()));
            }
        }
    }

    usage
}

impl Engine for GrokEngine {
    fn id(&self) -> &'static str {
        "grok"
    }

    /// grok's native harness is ACP: `grok agent … stdio` speaks ndjson
    /// JSON-RPC over the same pipes the app owns, so the model's question tool
    /// has a channel (`_x.ai/ask_user_question`) that the one-shot headless
    /// launch never had — there it answered the user's questions itself.
    fn drives_own_transport(&self) -> bool {
        true
    }

    /// A remote workspace keeps the CLI child path: the ACP driver spawns the
    /// CLI locally and has no ssh path into the distro.
    fn transport_for(&self, wsl: bool) -> Transport {
        if wsl {
            Transport::Child
        } else {
            Transport::Own
        }
    }

    /// The command the ACP driver spawns, carrying the same model/effort and
    /// auto-approval intent as the headless launch. The ACP session id comes
    /// from the CLI (`session/new`), so there is nothing to preassign.
    fn host_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        cmd.arg("agent");
        // Same reason as the headless launch: an approval prompt nobody can
        // answer must never block the turn.
        cmd.arg("--always-approve");
        if let Some(model) = req.model.as_deref() {
            cmd.arg("-m");
            cmd.arg(model);
        }
        if let Some(effort) = req
            .effort
            .as_deref()
            .map(str::trim)
            .filter(|e| !e.is_empty())
        {
            cmd.arg("--effort");
            cmd.arg(effort);
        }
        cmd.arg("stdio");
        // Grok 0.2.x has no --no-auto-update flag; disable via env.
        cmd.env("GROK_DISABLE_AUTOUPDATER", "1");
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: None,
            // The driver writes answers for parked questions to this pipe for
            // the life of the session, so it stays open.
            keep_stdin_open: true,
            cleanup_files: Vec::new(),
            mcp_restore: None,
            preassigned_session_id: None,
        })
    }

    fn supports_images(&self) -> bool {
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }
    fn supported_permissions(&self) -> &'static [&'static str] {
        &["bypass"]
    }

    /// Grok ACP 的人工计划审批走 x.ai/toggle_plan_mode 进入、
    /// x.ai/exit_plan_mode 扩展方法等待(1.0.40 二进制 strings 取证:方法名、
    /// planFileContent/planFileUri/executePlan 字段名、awaiting_plan_approval
    /// 状态与 resume re-park 均可确认)。但 P5 取证无法从二进制还原
    /// ExitPlanModeExtResponse(2 字段)的字段名与批准/修改/放弃编码,也无法
    /// 确认 toggle_plan_mode 进入计划模式的参数编码——没有实机抓报文就接线
    /// 等于编造审批回复,故保持 Unavailable(fail-closed)。当前
    /// supported_permissions 只有 bypass:显式 plan 请求若放行会被静默
    /// 映射成 bypassPermissions——那是最坏的降级,必须受控拒绝。
    fn plan_approval(&self) -> super::plan_review::PlanApproval {
        super::plan_review::PlanApproval::Unavailable {
            reason: "Grok plan review rides ACP x.ai/toggle_plan_mode + x.ai/exit_plan_mode (1.0.40 binary strings), but the ExitPlanModeExtResponse schema is not recoverable from the binary: its 2 field names (decision discriminant and feedback text) and the approve/revise/abandon encoding are unknown, and toggle_plan_mode's enter-plan-mode params encoding is unverified; wiring it without a live frame capture would fabricate the approval reply, and today a plan request would silently degrade to bypassPermissions",
        }
    }

    fn build_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        cmd.arg("--output-format");
        cmd.arg("streaming-json");
        // The only verified headless behavior: without --always-approve the CLI
        // would block on an approval prompt nobody can answer.
        cmd.arg("--always-approve");
        if let Some(model) = req.model.as_deref() {
            cmd.arg("-m");
            cmd.arg(model);
        }
        if let Some(effort) = req
            .effort
            .as_deref()
            .map(str::trim)
            .filter(|e| !e.is_empty())
        {
            cmd.arg("--effort");
            cmd.arg(effort);
        }
        // `-s` creates a NEW session with a caller-chosen UUID and errors if it
        // already exists; `-r` resumes. Never both.
        let preassigned = match req.session_id.as_deref() {
            Some(existing) => {
                cmd.arg("-r");
                cmd.arg(existing);
                Some(existing.to_string())
            }
            None => {
                let id = uuid::Uuid::new_v4().to_string();
                cmd.arg("-s");
                cmd.arg(&id);
                Some(id)
            }
        };

        let mut cleanup_files = Vec::new();
        match images::grok_prompt_json(&req.prompt, &req.images, &req.workspace)? {
            Some(prompt_json) => {
                // Staging file so base64 payloads never hit ARG_MAX.
                let dir = crate::paths::app_home().join("grok-staging");
                std::fs::create_dir_all(&dir)
                    .map_err(|e| format!("create grok staging dir: {e}"))?;
                let path = dir.join(format!("grok-prompt-{}.json", uuid::Uuid::new_v4()));
                std::fs::write(&path, prompt_json)
                    .map_err(|e| format!("write grok prompt file: {e}"))?;
                cmd.arg("--prompt-file");
                cmd.arg(&path);
                cleanup_files.push(path);
            }
            None => {
                cmd.arg("-p");
                cmd.arg(safe_prompt_arg(&req.prompt));
            }
        }
        // Grok 0.2.x has no --no-auto-update flag; disable via env.
        cmd.env("GROK_DISABLE_AUTOUPDATER", "1");
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: None,
            keep_stdin_open: false,
            cleanup_files,
            mcp_restore: None,
            preassigned_session_id: preassigned,
        })
    }

    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
        match event_type {
            "text" => {
                if let Some(text) = value.get("data").and_then(Value::as_str) {
                    if !text.is_empty() {
                        out.push(EngineEvent::Delta(text.to_string()));
                    }
                }
            }
            "thought" => {
                if let Some(text) = value.get("data").and_then(Value::as_str) {
                    if !text.is_empty() {
                        out.push(EngineEvent::Thinking(text.to_string()));
                    }
                }
            }
            "end" => {
                let session_id = value
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string);
                let usage = value
                    .get("usage")
                    .cloned()
                    .map(|u| attach_context_window(u));
                out.push(EngineEvent::Done { session_id, usage });
            }
            "error" => {
                let message = value
                    .get("message")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("grok error")
                    .to_string();
                out.push(EngineEvent::Error(message));
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn build_command_passes_effort_flag() {
        let req = SendRequest {
            session_id: Some("s1".into()),
            prompt: "hi".into(),
            prompt_contributions: vec![],
            native_compact: false,
            images: vec![],
            workspace: PathBuf::from("/tmp"),
            model: Some("grok-3".into()),
            effort: Some("high".into()),
            service_tier: None,
            permission: None,
            additional_dirs: vec![],
            provider_id: None,
            computer_use: None,
            memory_bot: None,
            allowed_tools: None,
            auto_compact_threshold_tokens: None,
        };
        let built = GrokEngine.build_command(&req, "grok").unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.windows(2).any(|w| w == ["--effort", "high"]));
    }
}
