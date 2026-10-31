use super::{
    claude::ClaudeEngine, command_for_binary, images, BuiltCommand, Engine, EngineEvent,
    SendRequest,
};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeBuddyAccountStatus {
    pub logged_in: bool,
    /// The probed credential service names are guesses (the CLI's exact
    /// Keychain/Credential Manager/keyring names are not publicly
    /// documented), so a negative probe is "unknown", not "logged out".
    /// Only a positive probe is conclusive.
    pub detection: &'static str,
}

/// CodeBuddy stores CLI credentials in the OS credential manager per its
/// official IAM docs (macOS Keychain, Windows Credential Manager, Linux
/// keyring) — not in plain files under `~/.codebuddy`. Probing guessed
/// filenames there misreported both directions: a successful terminal
/// `/login` still showed "not logged in", while a stale/IDE-side file showed
/// "logged in". Probe the real stores read-only, existence only, and never
/// read secret values; the result is a bare boolean.
fn cli_credentials_present() -> bool {
    #[cfg(target_os = "macos")]
    {
        // `security find-generic-password` without `-w` reports existence
        // only and never prints the secret. The exact service name is not
        // publicly documented, so probe the plausible candidates.
        ["codebuddy", "CodeBuddy", "com.tencent.codebuddy"]
            .iter()
            .any(|service| {
                let mut cmd = std::process::Command::new("security");
                cmd.args(["find-generic-password", "-s", service]);
                run_probe_command(cmd)
                    .map(|out| out.status.success())
                    .unwrap_or(false)
            })
    }
    #[cfg(target_os = "windows")]
    {
        // `cmdkey /list` prints target names of stored credentials, never
        // secrets.
        let mut cmd = std::process::Command::new("cmdkey");
        cmd.arg("/list");
        run_probe_command(cmd)
            .map(|out| {
                String::from_utf8_lossy(&out.stdout)
                    .to_lowercase()
                    .contains("codebuddy")
            })
            .unwrap_or(false)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // `secret-tool search` exits non-zero when nothing matches; without
        // `--unlock` it prints item attributes only, never the secret.
        let mut cmd = std::process::Command::new("secret-tool");
        cmd.args(["search", "service", "codebuddy"]);
        run_probe_command(cmd)
            .map(|out| out.status.success())
            .unwrap_or(false)
    }
}

/// Credential-store tools can block indefinitely (locked keyring, missing
/// session D-Bus, unlock prompt), and the settings page re-probes on every
/// window focus. Every probe therefore runs under a hard deadline: poll the
/// child and kill it once the budget is spent, so the IPC call always settles
/// and blocked probes cannot pile up.
const ACCOUNT_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(1500);

fn run_probe_command(mut cmd: std::process::Command) -> Option<std::process::Output> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // cmdkey is console-subsystem: without this flag every focus-triggered
        // probe flashes a console window (same fix as engine::hide_console).
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    let mut child = cmd.spawn().ok()?;
    let deadline = std::time::Instant::now() + ACCOUNT_PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

pub fn check_codebuddy_account_status() -> CodeBuddyAccountStatus {
    let logged_in = cli_credentials_present();
    CodeBuddyAccountStatus {
        logged_in,
        // The probed service names are guesses: a hit proves "logged in",
        // a miss only means "not found under the names we tried".
        detection: if logged_in { "found" } else { "unknown" },
        ..Default::default()
    }
}

/// The settings page re-probes on every window focus, and each probe spawns
/// up to three credential-store processes. Cache the result briefly: login
/// state changes on a minutes scale, not a focus-Event scale. An explicit
/// refresh passes `force`, because the one action that must re-probe (right
/// after `/login`) would otherwise receive the pre-login cached answer.
const ACCOUNT_STATUS_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(30);

#[tauri::command]
pub async fn codebuddy_account_status(
    force: Option<bool>,
) -> Result<CodeBuddyAccountStatus, String> {
    static CACHE: tokio::sync::Mutex<Option<(std::time::Instant, CodeBuddyAccountStatus)>> =
        tokio::sync::Mutex::const_new(None);
    // Held across the probe so concurrent focus events share one probe set
    // (single flight) instead of each spawning the full set after a miss.
    let mut cache = CACHE.lock().await;
    if !force.unwrap_or(false) {
        if let Some((at, status)) = cache.as_ref() {
            if at.elapsed() < ACCOUNT_STATUS_CACHE_TTL {
                return Ok(status.clone());
            }
        }
    }
    // The probes spawn child processes; keep them off the async runtime.
    let status = tokio::task::spawn_blocking(check_codebuddy_account_status)
        .await
        .map_err(|e| format!("codebuddy account probe: {e}"))?;
    *cache = Some((std::time::Instant::now(), status.clone()));
    Ok(status)
}

/// Provider-selection env keys a codebuddy channel owns outright once a
/// channel drives the launch. Like the claude adapter (claude_channel.rs),
/// they are masked with empty strings in the `--settings` overlay so a stale
/// key/endpoint in the user's native settings.json cannot silently override
/// the channel: CodeBuddy applies settings.json `env` on top of the inherited
/// process environment, and `--settings` has the CLI's highest precedence.
const CHANNEL_SETTINGS_ENV_KEYS: &[&str] = &[
    "CODEBUDDY_BASE_URL",
    "CODEBUDDY_API_KEY",
    "CODEBUDDY_MODEL",
    "CODEBUDDY_INTERNET_ENVIRONMENT",
];

/// Route a selected channel through a `--settings <path>` overlay (highest
/// precedence) instead of relying on the inherited process env alone, which
/// native settings.json would otherwise beat.
///
/// The overlay carries CODEBUDDY_API_KEY, so it is staged in a private
/// 0600 file (mirroring claude_channel::stage) rather than inlined on argv —
/// an inline JSON would expose the key to `ps`, /proc/<pid>/cmdline, and
/// diagnostic collectors for the process's whole lifetime. The file is
/// removed via cleanup_files once the child exits.
pub(super) fn apply_channel(
    built: &mut BuiltCommand,
    env: &std::collections::HashMap<String, String>,
    model: Option<&str>,
    directory: &std::path::Path,
) -> Result<(), String> {
    let mut overlay = serde_json::Map::new();
    for key in CHANNEL_SETTINGS_ENV_KEYS {
        overlay.insert(key.to_string(), serde_json::Value::String(String::new()));
    }
    for (key, value) in env {
        overlay.insert(key.clone(), serde_json::Value::String(value.clone()));
    }
    let mut settings = serde_json::json!({ "env": overlay });
    // A stale top-level `model` in the user's native settings.json survives a
    // `--settings` merge (that is exactly how models/codebuddy.rs reads the
    // configured default). Mirror the selected model, or the channel's own
    // CODEBUDDY_MODEL when no request model was selected, into the overlay.
    let model = model
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .or_else(|| {
            env.get("CODEBUDDY_MODEL")
                .map(String::as_str)
                .map(str::trim)
                .filter(|m| !m.is_empty())
        });
    if let Some(model) = model {
        settings["model"] = serde_json::Value::String(model.to_string());
    }
    stage_overlay(built, &settings, directory)
}

fn stage_overlay(
    built: &mut BuiltCommand,
    settings: &serde_json::Value,
    directory: &std::path::Path,
) -> Result<(), String> {
    let path = stage_private_json(directory, "channel", settings)?;
    built.cleanup_files.push(path.clone());
    built.command.arg("--settings").arg(path);
    Ok(())
}

/// Stage a JSON document in a private 0600 file for argv flags that would
/// otherwise expose credentials (`--settings`, `--mcp-config`) to `ps` /
/// `/proc/<pid>/cmdline for the child's whole lifetime.
fn stage_private_json(
    directory: &std::path::Path,
    prefix: &str,
    value: &serde_json::Value,
) -> Result<std::path::PathBuf, String> {
    stage_private_json_with_writer(directory, prefix, value, |file, content| {
        use std::io::Write;
        file.write_all(content)
    })
}

fn stage_private_json_with_writer(
    directory: &std::path::Path,
    prefix: &str,
    value: &serde_json::Value,
    write: impl FnOnce(&mut std::fs::File, &[u8]) -> std::io::Result<()>,
) -> Result<std::path::PathBuf, String> {
    let content = serde_json::to_vec(value)
        .map_err(|_| format!("Cannot serialize CodeBuddy {prefix} settings"))?;
    std::fs::create_dir_all(directory)
        .map_err(|e| format!("create CodeBuddy staging directory: {e}"))?;
    let path = directory.join(format!("{prefix}-{}.json", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .map_err(|e| format!("create private CodeBuddy settings: {e}"))?;
    if let Err(error) = write(&mut file, &content) {
        // Close before removal so this also works on Windows. The original
        // write error is more useful than a best-effort cleanup error.
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err(format!("write private CodeBuddy settings: {error}"));
    }
    Ok(path)
}
pub struct CodeBuddyEngine {
    inner: ClaudeEngine,
}

impl CodeBuddyEngine {
    pub fn new() -> Self {
        Self {
            inner: ClaudeEngine::new(),
        }
    }
}

impl Engine for CodeBuddyEngine {
    fn id(&self) -> &'static str {
        "codebuddy"
    }

    fn supports_images(&self) -> bool {
        true
    }

    fn supports_effort(&self) -> bool {
        true
    }

    fn supports_computer_use(&self) -> bool {
        true
    }

    fn supports_memory(&self) -> bool {
        true
    }

    /// 同 Claude：私有文件经 `--mcp-config` 交给 CLI（提示词走 stdin，追加在
    /// 末尾不会被当成位置参数）。
    fn mount_on_demand(
        &self,
        built: &mut BuiltCommand,
        servers: &[crate::mcp::launch::OnDemandServer],
        _workspace: &std::path::Path,
    ) -> Result<(), String> {
        let path = crate::mcp::launch::stage_claude_config(servers, "codebuddy-staging")?;
        built.cleanup_files.push(path.clone());
        built.command.arg("--mcp-config").arg(path);
        Ok(())
    }

    fn supported_permissions(&self) -> &'static [&'static str] {
        // No "manual": CodeBuddy headless does not support
        // --permission-prompt-tool, so a mode that promises "ask every time"
        // would silently deny instead of asking. The picker greys out what
        // is not listed here and falls back to "auto".
        &["auto", "plan", "bypass"]
    }

    fn supports_tool_constraints(&self) -> bool {
        true
    }

    fn build_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        cmd.arg("-p");
        cmd.arg("--input-format");
        cmd.arg("stream-json");
        cmd.arg("--output-format");
        cmd.arg("stream-json");
        cmd.arg("--verbose");
        cmd.arg("--include-partial-messages");

        let mut preapproved: Vec<&str> = Vec::new();
        // Files staged for this child (private settings / MCP config); removed
        // once the child exits, and swept at startup if the app dies mid-run.
        let mut cleanup_files: Vec<std::path::PathBuf> = Vec::new();
        let allowed: Vec<&str> = req
            .allowed_tools
            .as_deref()
            .map(|tools| {
                tools
                    .iter()
                    .map(|t| t.trim())
                    .filter(|t| !t.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        if req.allowed_tools.is_some() && allowed.is_empty() {
            return Err("tool constraints must not be empty".to_string());
        }

        // MCP servers first: their pre-approved tool names must land in the
        // SAME --allowedTools emission as everything else — if the CLI treats
        // a repeated flag as last-wins, a second emission would clobber the
        // user's tool whitelist.
        let mut mcp_servers = serde_json::Map::new();
        if req.computer_use == Some(true) {
            let spec = crate::computer_use::computer_use_spec()?;
            mcp_servers.insert(spec.name.clone(), crate::computer_use::mcp_server_json(&spec));
            preapproved.push("mcp__ccgui-computer");
        }
        if let Some(bot_id) = req.memory_bot.as_deref() {
            let spec = crate::memory::mcp::bound_spec(bot_id)?;
            mcp_servers.insert(spec.name.clone(), crate::computer_use::mcp_server_json(&spec));
            preapproved.push("mcp__ccgui-memory");
        }
        if !mcp_servers.is_empty() {
            let config = serde_json::json!({ "mcpServers": mcp_servers });
            // The overlay control token (CCGUI_CU_TOKEN) rides the server's
            // `env`; inline JSON would expose it on argv for the child's whole
            // lifetime, so stage it in a private file like the channel overlay.
            let path = stage_private_json(
                &crate::paths::app_home().join("codebuddy-staging"),
                "mcp",
                &config,
            )?;
            cleanup_files.push(path.clone());
            cmd.arg("--mcp-config").arg(path);
        }

        if !allowed.is_empty() {
            cmd.arg("--permission-mode");
            cmd.arg("plan");
            // --allowedTools only pre-approves without prompting; it is not a
            // whitelist. The real tool-set restriction is --tools
            // (comma-separated): anything not listed is unavailable to the
            // model, including tools a future CLI version adds.
            cmd.arg("--tools");
            cmd.arg(
                allowed
                    .iter()
                    .copied()
                    .chain(preapproved.iter().copied())
                    .collect::<Vec<_>>()
                    .join(","),
            );
            cmd.arg("--allowedTools");
            for tool in &allowed {
                cmd.arg(*tool);
            }
            for tool in &preapproved {
                cmd.arg(*tool);
            }
            // Defense in depth on top of --tools: deny the known write/exec/
            // sub-agent tools explicitly so a read-only whitelist stays
            // read-only even if the whitelist flag is ignored.
            //
            // CodeBuddy names differ from Claude's: PowerShell is the shell
            // tool on Windows and Agent/Workflow/TeamCreate spawn sub-agents.
            // Deny both families so a read-only whitelist stays read-only
            // even when the user's settings.json permissions.allow lists them.
            let denied: Vec<&str> = [
                "Bash",
                "PowerShell",
                "Edit",
                "Write",
                "NotebookEdit",
                "Task",
                "Agent",
                "Workflow",
                "TeamCreate",
            ]
            .into_iter()
            .filter(|tool| !allowed.contains(tool))
            .collect();
            // Never emit a flag with zero values: the next flag would be
            // consumed as its argument.
            if !denied.is_empty() {
                cmd.arg("--disallowedTools");
                for tool in denied {
                    cmd.arg(tool);
                }
            }
        } else {
            match self.resolve_permission(req.permission.as_deref()) {
                "bypass" => {
                    cmd.arg("-y");
                }
                mode => {
                    cmd.arg("--permission-mode");
                    // "auto" maps to the CLI's own auto classifier (officially
                    // supported under -p). The old acceptEdits fallback only
                    // auto-approves file edits, so headless Bash/network calls
                    // had no one to approve them and were denied outright.
                    cmd.arg(match mode {
                        "plan" => "plan",
                        "auto" => "auto",
                        _ => "acceptEdits",
                    });
                    if mode == "auto" {
                        preapproved.extend(["WebSearch", "WebFetch"]);
                    }
                }
            }
            if !preapproved.is_empty() {
                cmd.arg("--allowedTools");
                for tool in preapproved {
                    cmd.arg(tool);
                }
            }
        }

        if let Some(model) = req.model.as_deref() {
            let trimmed = model.trim();
            if !trimmed.is_empty() {
                cmd.arg("--model");
                cmd.arg(trimmed);
            }
        }

        if let Some(effort) = req.effort.as_deref() {
            let trimmed = effort.trim();
            if !trimmed.is_empty() {
                cmd.arg("--effort");
                // The UI's top level is "ultra"; the CLI names it "max".
                // Other levels (low/medium/high/xhigh/max) pass through as-is:
                // an unsupported value fails loudly in the CLI's own error
                // output rather than being silently remapped to a wrong tier.
                cmd.arg(match trimmed {
                    "ultra" => "max",
                    other => other,
                });
            }
        }

        let mut seen_dirs = std::collections::HashSet::new();
        for dir in &req.additional_dirs {
            let dir = dir.trim();
            if dir.is_empty()
                || dir == req.workspace.to_string_lossy()
                || !seen_dirs.insert(dir.to_string())
            {
                continue;
            }
            cmd.arg("--add-dir");
            cmd.arg(dir);
        }

        if let Some(session_id) = req.session_id.as_deref() {
            cmd.arg("-r");
            cmd.arg(session_id);
        }

        let stdin_payload = images::claude_stdin_message(&req.prompt, &req.images, &req.workspace)
            .map_err(|error| {
                super::cleanup_staged_files(&cleanup_files);
                error
            })?;
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: Some(stdin_payload),
            keep_stdin_open: true,
            cleanup_files,
            mcp_restore: None,
            preassigned_session_id: None,
        })
    }

    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>) {
        self.inner.parse_line(line, out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn sample_req() -> SendRequest {
        SendRequest {
            session_id: None,
            workspace: PathBuf::from("D:\\ws"),
            prompt: "say hello".to_string(),
            prompt_contributions: Vec::new(),
            native_compact: false,
            images: Vec::new(),
            model: Some("hy4-preview".to_string()),
            effort: Some("high".to_string()),
            service_tier: None,
            permission: Some("auto".to_string()),
            additional_dirs: Vec::new(),
            provider_id: None,
            computer_use: None,
            memory_bot: None,
            allowed_tools: None,
        }
    }

    struct ScratchHome {
        dir: PathBuf,
        previous_home: Option<std::ffi::OsString>,
        previous_profile: Option<std::ffi::OsString>,
        _lock: parking_lot::MutexGuard<'static, ()>,
    }

    impl ScratchHome {
        fn new(tag: &str) -> Self {
            let lock = crate::paths::HOME_ENV_LOCK.lock();
            let dir = std::env::temp_dir().join(format!(
                "ccgui-codebuddy-{tag}-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            let previous_home = std::env::var_os("HOME");
            let previous_profile = std::env::var_os("USERPROFILE");
            std::env::set_var("HOME", &dir);
            std::env::set_var("USERPROFILE", &dir);
            Self {
                dir,
                previous_home,
                previous_profile,
                _lock: lock,
            }
        }
    }

    impl Drop for ScratchHome {
        fn drop(&mut self) {
            match &self.previous_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
            match &self.previous_profile {
                Some(value) => std::env::set_var("USERPROFILE", value),
                None => std::env::remove_var("USERPROFILE"),
            }
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn failed_private_json_write_removes_the_partial_file() {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-codebuddy-write-failure-{}",
            uuid::Uuid::new_v4()
        ));
        let result = stage_private_json_with_writer(
            &dir,
            "channel",
            &serde_json::json!({"env":{"CODEBUDDY_API_KEY":"secret"}}),
            |file, content| {
                use std::io::Write;
                file.write_all(&content[..content.len() / 2])?;
                Err(std::io::Error::new(
                    std::io::ErrorKind::WriteZero,
                    "injected write failure",
                ))
            },
        );
        assert!(result.unwrap_err().contains("injected write failure"));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn image_payload_failure_cleans_staged_mcp_config() {
        let home = ScratchHome::new("image-cleanup");
        let staging = home.dir.join(".ccgui-next/codebuddy-staging");
        let mut req = sample_req();
        req.computer_use = Some(true);
        req.images = vec!["data:image/png;base64,not-valid-base64".to_string()];

        let error = CodeBuddyEngine::new()
            .build_command(&req, "codebuddy")
            .err()
            .expect("an invalid image must fail command construction");
        assert!(error.contains("invalid base64"));
        assert_eq!(
            std::fs::read_dir(&staging).unwrap().count(),
            0,
            "the staged MCP config (including any overlay token) must not survive a failed launch"
        );
    }

    #[test]
    fn engine_metadata_and_capabilities() {
        let engine = CodeBuddyEngine::new();
        assert_eq!(engine.id(), "codebuddy");
        assert!(engine.supports_images());
        assert!(engine.supports_effort());
        assert!(engine.supports_computer_use());
        assert!(engine.supports_memory());
        assert!(engine.supports_tool_constraints());
        assert_eq!(
            engine.supported_permissions(),
            &["auto", "plan", "bypass"]
        );
    }

    #[test]
    fn build_command_flags() {
        let engine = CodeBuddyEngine::new();
        let mut req = sample_req();
        req.session_id = Some("sess-123".to_string());
        let built = engine.build_command(&req, "codebuddy").unwrap();
        let debug = format!("{:?}", built.command);
        assert!(debug.contains("-p"));
        assert!(debug.contains("--input-format"));
        assert!(debug.contains("stream-json"));
        assert!(debug.contains("--output-format"));
        assert!(debug.contains("--verbose"));
        assert!(debug.contains("--include-partial-messages"));
        assert!(debug.contains("--permission-mode"));
        assert!(debug.contains("auto"));
        assert!(debug.contains("--model"));
        assert!(debug.contains("hy4-preview"));
        assert!(debug.contains("--effort"));
        assert!(debug.contains("high"));
        assert!(debug.contains("-r"));
        assert!(debug.contains("sess-123"));
    }

    #[test]
    fn build_command_ultra_effort_maps_to_max() {
        let engine = CodeBuddyEngine::new();
        let mut req = sample_req();
        req.effort = Some("ultra".to_string());
        let built = engine.build_command(&req, "codebuddy").unwrap();
        let debug = format!("{:?}", built.command);
        assert!(debug.contains("--effort"));
        assert!(debug.contains("max"));
    }

    #[test]
    fn build_command_bypass_uses_dash_y() {
        let engine = CodeBuddyEngine::new();
        let mut req = sample_req();
        req.permission = Some("bypass".to_string());
        let built = engine.build_command(&req, "codebuddy").unwrap();
        let debug = format!("{:?}", built.command);
        assert!(debug.contains("-y"));
    }

    #[test]
    fn read_only_whitelist_denies_shell_and_subagent_tools() {
        let engine = CodeBuddyEngine::new();
        let args_of = |allowed: Vec<String>| {
            let mut req = sample_req();
            req.allowed_tools = Some(allowed);
            let built = engine.build_command(&req, "codebuddy").unwrap();
            built
                .command
                .as_std()
                .get_args()
                .map(|a| a.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        };

        let args = args_of(vec!["Read".to_string(), "Glob".to_string()]);
        // --tools is the real whitelist: exactly the allowed tools, and
        // nothing else (a comma-separated single argument).
        let whitelist = &args[args
            .iter()
            .position(|a| a == "--tools")
            .expect("--tools must be emitted")
            + 1];
        let listed: Vec<&str> = whitelist.split(',').collect();
        assert_eq!(listed, ["Read", "Glob"]);
        for tool in ["Bash", "Edit", "Write", "PowerShell"] {
            assert!(
                !listed.contains(&tool),
                "whitelist must not contain {tool}"
            );
        }

        let denied = &args[args
            .iter()
            .position(|a| a == "--disallowedTools")
            .expect("--disallowedTools must be emitted")
            + 1..];
        // CodeBuddy's own tool names: PowerShell is the shell tool on
        // Windows; Agent/Workflow/TeamCreate spawn sub-agents. A read-only
        // whitelist must deny both the Claude-named and CodeBuddy-named
        // write/exec/delegate tools.
        for tool in [
            "Bash",
            "PowerShell",
            "Edit",
            "Write",
            "NotebookEdit",
            "Task",
            "Agent",
            "Workflow",
            "TeamCreate",
        ] {
            assert!(
                denied.iter().any(|a| a == tool),
                "missing deny for {tool}"
            );
        }

        // An explicitly allowed tool must not also be denied.
        let args = args_of(vec!["Bash".to_string()]);
        let denied = &args[args
            .iter()
            .position(|a| a == "--disallowedTools")
            .unwrap()
            + 1..];
        assert!(!denied.iter().any(|a| a == "Bash"));
    }

    #[test]
    fn channel_env_rides_staged_settings_file_never_argv() {
        let mut built = BuiltCommand {
            command: tokio::process::Command::new("codebuddy"),
            stdin_payload: None,
            keep_stdin_open: false,
            cleanup_files: Vec::new(),
            mcp_restore: None,
            preassigned_session_id: None,
        };
        let env = std::collections::HashMap::from([
            (
                "CODEBUDDY_BASE_URL".to_string(),
                "https://copilot.tencent.com".to_string(),
            ),
            ("CODEBUDDY_API_KEY".to_string(), "sk-test".to_string()),
            (
                "CODEBUDDY_INTERNET_ENVIRONMENT".to_string(),
                "internal".to_string(),
            ),
        ]);
        let dir = std::env::temp_dir().join(format!(
            "ccgui-codebuddy-stage-{}",
            uuid::Uuid::new_v4()
        ));
        apply_channel(&mut built, &env, None, &dir).unwrap();
        let args: Vec<_> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args.len(), 2);
        assert_eq!(args[0], "--settings");
        // The API key must never appear on argv: ps, /proc/<pid>/cmdline and
        // diagnostic collectors would expose it for the child's lifetime.
        assert!(
            args.iter().all(|a| !a.contains("sk-test")),
            "api key leaked onto argv: {args:?}"
        );
        assert_eq!(built.cleanup_files.len(), 1);
        let staged_path = &built.cleanup_files[0];
        assert_eq!(args[1], staged_path.to_string_lossy());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(staged_path).unwrap().permissions().mode() & 0o777,
                0o600,
                "staged settings must be private"
            );
        }
        let staged: serde_json::Value =
            serde_json::from_slice(&std::fs::read(staged_path).unwrap()).unwrap();
        assert_eq!(
            staged["env"]["CODEBUDDY_BASE_URL"],
            "https://copilot.tencent.com"
        );
        assert_eq!(staged["env"]["CODEBUDDY_API_KEY"], "sk-test");
        assert_eq!(staged["env"]["CODEBUDDY_INTERNET_ENVIRONMENT"], "internal");
        // Convention keys the channel does not set are masked with empty
        // strings, so a stale native settings.json value cannot win over the
        // channel (--settings has the CLI's highest precedence).
        assert_eq!(staged["env"]["CODEBUDDY_MODEL"], "");
        super::super::cleanup_staged_files(&built.cleanup_files);
        assert!(!staged_path.exists());
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn channel_overlay_mirrors_selected_model() {
        let mut built = BuiltCommand {
            command: tokio::process::Command::new("codebuddy"),
            stdin_payload: None,
            keep_stdin_open: false,
            cleanup_files: Vec::new(),
            mcp_restore: None,
            preassigned_session_id: None,
        };
        let dir = std::env::temp_dir().join(format!(
            "ccgui-codebuddy-model-{}",
            uuid::Uuid::new_v4()
        ));
        apply_channel(
            &mut built,
            &std::collections::HashMap::new(),
            Some(" glm-5.3 "),
            &dir,
        )
        .unwrap();
        let staged_path = built.cleanup_files[0].clone();
        let staged: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&staged_path).unwrap()).unwrap();
        // A selected model must outrank a stale native settings.json `model`.
        assert_eq!(staged["model"], "glm-5.3");
        super::super::cleanup_staged_files(&built.cleanup_files);
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn tool_flags_never_dangle_when_every_deniable_tool_is_allowed() {
        let engine = CodeBuddyEngine::new();
        let mut req = sample_req();
        req.allowed_tools = Some(
            [
                "Bash",
                "PowerShell",
                "Edit",
                "Write",
                "NotebookEdit",
                "Task",
                "Agent",
                "Workflow",
                "TeamCreate",
            ]
            .into_iter()
            .map(str::to_string)
            .collect(),
        );
        let built = engine.build_command(&req, "codebuddy").unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert!(!args.iter().any(|a| a == "--disallowedTools"));
        for (index, arg) in args.iter().enumerate() {
            if matches!(
                arg.as_str(),
                "--tools"
                    | "--allowedTools"
                    | "--disallowedTools"
                    | "--model"
                    | "--effort"
                    | "--permission-mode"
            ) {
                let next = args
                    .get(index + 1)
                    .unwrap_or_else(|| panic!("{arg} has no value"));
                assert!(
                    !next.starts_with('-'),
                    "{arg} swallowed the next flag: {next}"
                );
            }
        }
    }

    #[test]
    fn blank_allowed_tools_are_rejected_fail_closed() {
        let engine = CodeBuddyEngine::new();
        let mut req = sample_req();
        req.allowed_tools = Some(vec!["  ".to_string(), String::new()]);
        let error = engine
            .build_command(&req, "codebuddy")
            .err()
            .expect("a present but empty tool whitelist must be rejected");
        assert_eq!(error, "tool constraints must not be empty");
    }

    #[test]
    fn parse_line_delegates_to_claude_parser() {
        let engine = CodeBuddyEngine::new();
        let mut out = Vec::new();
        let sample = r#"{"type":"assistant","uuid":"u1","session_id":"s1","message":{"id":"m1","content":[{"type":"text","text":"hello world"}],"model":"custom:kimi-k3","role":"assistant"}}"#;
        engine.parse_line(sample, &mut out);
        // An assistant snapshot surfaces the session id and the served model
        // (message text arrives via stream_event lines, not this snapshot).
        assert!(out
            .iter()
            .any(|e| matches!(e, EngineEvent::SessionId(id) if id == "s1")));
        assert!(out
            .iter()
            .any(|e| matches!(e, EngineEvent::Model(model) if model == "custom:kimi-k3")));
    }
}
