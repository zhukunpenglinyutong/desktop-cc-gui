use super::{
    claude::ClaudeEngine, command_for_binary, images, BuiltCommand, Engine, EngineEvent,
    SendRequest,
};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeBuddyAccountStatus {
    pub logged_in: bool,
    pub uid: Option<String>,
    pub display_name: Option<String>,
    pub enterprise_name: Option<String>,
}

fn status_from_account(account: &serde_json::Value) -> CodeBuddyAccountStatus {
    let uid = account.get("uid").and_then(|v| v.as_str()).map(str::to_string);
    let display_name = account
        .get("displayName")
        .or_else(|| account.get("enterpriseUserName"))
        .or_else(|| account.get("nickname"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let enterprise_name = account
        .get("enterpriseName")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    CodeBuddyAccountStatus {
        logged_in: true,
        uid,
        display_name,
        enterprise_name,
    }
}

pub fn check_codebuddy_account_status() -> CodeBuddyAccountStatus {
    let mut candidates = Vec::new();

    #[cfg(windows)]
    if let Ok(appdata) = std::env::var("LOCALAPPDATA") {
        candidates.push(
            std::path::PathBuf::from(appdata)
                .join("CodeBuddyExtension")
                .join("Data")
                .join("Public")
                .join("auth")
                .join("Tencent-Cloud.coding-copilot.info"),
        );
    }

    if let Some(home) = dirs::home_dir() {
        candidates.push(
            home.join("Library")
                .join("Application Support")
                .join("CodeBuddyExtension")
                .join("Data")
                .join("Public")
                .join("auth")
                .join("Tencent-Cloud.coding-copilot.info"),
        );
        candidates.push(
            home.join(".local")
                .join("share")
                .join("CodeBuddyExtension")
                .join("Data")
                .join("Public")
                .join("auth")
                .join("Tencent-Cloud.coding-copilot.info"),
        );
    }

    for path in candidates {
        if path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(account) = val.get("account") {
                        return status_from_account(account);
                    }
                }
            }
        }
    }

    // CLI credential store: `codebuddy /login` in a terminal writes under the
    // CLI's own config dir, not into the IDE extension directory above, so
    // probing only the extension file would keep showing "not logged in"
    // after a successful CLI login. Probe the credential filenames used by
    // Claude-Code-compatible CLIs.
    let cli_home = super::engine_home(Some("CODEBUDDY_CONFIG_DIR"), ".codebuddy");
    for name in [".credentials.json", "credentials.json", "auth.json"] {
        let path = cli_home.join(name);
        if !path.is_file() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) else {
            continue;
        };
        if let Some(account) = val.get("account") {
            return status_from_account(account);
        }
        let has_token = ["accessToken", "access_token", "idToken", "id_token", "token"]
            .iter()
            .any(|key| match val.get(*key).and_then(|v| v.as_str()) {
                Some(token) => !token.is_empty(),
                None => false,
            });
        if has_token {
            return CodeBuddyAccountStatus {
                logged_in: true,
                ..Default::default()
            };
        }
    }

    CodeBuddyAccountStatus::default()
}

#[tauri::command]
pub async fn codebuddy_account_status() -> Result<CodeBuddyAccountStatus, String> {
    Ok(check_codebuddy_account_status())
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

    fn supported_permissions(&self) -> &'static [&'static str] {
        &["auto", "manual", "plan", "bypass"]
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
            cmd.arg("--mcp-config");
            cmd.arg(config.to_string());
        }

        if let Some(tools) = req.allowed_tools.as_deref() {
            cmd.arg("--permission-mode");
            cmd.arg("plan");
            cmd.arg("--allowedTools");
            for tool in tools {
                cmd.arg(tool);
            }
            for tool in &preapproved {
                cmd.arg(*tool);
            }
            cmd.arg("--disallowedTools");
            for tool in ["Bash", "Edit", "Write", "NotebookEdit", "Task"] {
                if !tools.iter().any(|allowed| allowed == tool) {
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
                    cmd.arg(match mode {
                        "manual" => "default",
                        "plan" => "plan",
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

        let stdin_payload = images::claude_stdin_message(&req.prompt, &req.images, &req.workspace)?;
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: Some(stdin_payload),
            keep_stdin_open: true,
            cleanup_files: Vec::new(),
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

    #[test]
    fn engine_metadata_and_capabilities() {
        let engine = CodeBuddyEngine::new();
        assert_eq!(engine.id(), "codebuddy");
        assert!(engine.supports_images());
        assert!(engine.supports_effort());
        assert!(engine.supports_tool_constraints());
        assert_eq!(
            engine.supported_permissions(),
            &["auto", "manual", "plan", "bypass"]
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
        assert!(debug.contains("acceptEdits"));
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
    fn parse_line_delegates_to_claude_parser() {
        let engine = CodeBuddyEngine::new();
        let mut out = Vec::new();
        let sample = r#"{"type":"assistant","uuid":"u1","session_id":"s1","message":{"id":"m1","content":[{"type":"text","text":"hello world"}],"model":"custom:kimi-k3","role":"assistant"}}"#;
        engine.parse_line(sample, &mut out);
        assert_eq!(out.len(), 1);
        match &out[0] {
            EngineEvent::Message { role, text, .. } => {
                assert_eq!(role, "assistant");
                assert_eq!(text, "hello world");
            }
            other => panic!("expected EngineEvent::Message, got {other:?}"),
        }
    }
}
