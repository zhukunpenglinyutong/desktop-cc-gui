//! MiniMax Code CLI (`mcode`). Local workspaces drive the `mcode acp`
//! transport (`minimax_acp`); this module holds the engine adapter and the
//! WSL fallback child that speaks the headless exec protocol
//! (https://agent.minimax.cn/docs/cli/automation).

use super::{
    command_for_binary, images, BuiltCommand, Engine, EngineEvent, SendRequest, Transport,
};
use serde_json::Value;

pub struct MiniMaxEngine;

/// WSL fallback: one `mcode exec --output-format stream-json` child per turn.
/// Headless runs cannot answer interactive asks, so the ask-backed modes
/// (manual, plan) refuse here exactly like kimi's plan mode does — the local
/// ACP transport is the only host that can honor them.
fn build_exec_command(req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
    let resolved = MiniMaxEngine.resolve_permission(req.permission.as_deref());
    if resolved == "manual" || resolved == "plan" {
        return Err(
            "MiniMax manual/plan modes require the local ACP transport; remote workspaces only support auto/bypass"
                .into(),
        );
    }
    let mut cmd = command_for_binary(bin);
    cmd.arg("exec").arg("--output-format").arg("stream-json");
    cmd.arg("--permission").arg(match resolved {
        "bypass" => "full",
        _ => "smart",
    });
    if let Some(model) = req
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
    {
        cmd.arg("--model").arg(model);
    }
    if let Some(effort) = req
        .effort
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty())
    {
        cmd.arg("--effort").arg(effort);
    }
    if let Some(session_id) = req.session_id.as_deref() {
        cmd.arg("--session").arg(session_id);
    }
    for raw in &req.images {
        if let Some(path) = images::absolutize_image_path(raw, &req.workspace) {
            cmd.arg("--file").arg(path);
        }
    }
    cmd.arg(super::safe_prompt_arg(&req.prompt));
    Ok(BuiltCommand {
        command: cmd,
        stdin_payload: None,
        keep_stdin_open: false,
        cleanup_files: Vec::new(),
        mcp_restore: None,
        preassigned_session_id: None,
    })
}

impl Engine for MiniMaxEngine {
    fn id(&self) -> &'static str {
        "minimax"
    }

    fn drives_own_transport(&self) -> bool {
        true
    }

    fn transport_for(&self, wsl: bool) -> Transport {
        if wsl {
            Transport::Child
        } else {
            Transport::Own
        }
    }

    fn host_command(&self, _req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut command = command_for_binary(bin);
        command.arg("acp");
        Ok(BuiltCommand {
            command,
            stdin_payload: None,
            keep_stdin_open: true,
            cleanup_files: Vec::new(),
            mcp_restore: None,
            preassigned_session_id: None,
        })
    }

    fn build_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        build_exec_command(req, bin)
    }

    fn supports_images(&self) -> bool {
        // ACP prompt blocks carry base64 images; the exec fallback attaches
        // absolute paths via --file.
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }
    fn supported_permissions(&self) -> &'static [&'static str] {
        &["auto", "manual", "plan", "bypass"]
    }

    /// Headless exec stream-json (live-verified on mcode 0.5.1, docs at
    /// https://agent.minimax.cn/docs/cli/automation): every line shares the
    /// envelope {schemaVersion, sequence, timestampMs, runId, sessionId,
    /// turnId, type, …}. session.started/session.resumed report the native
    /// session id; turn.completed carries the usage; turn/exec completion
    /// settles via the reader's EOF drain. `item.started`/`item.updated`
    /// stream `contentDelta` fragments which are ignored here — the
    /// completed item repeats the full content and parse_line has no state
    /// to dedupe it, so the WSL fallback renders whole items (the local ACP
    /// transport streams character-level). Unknown events are ignored — the
    /// docs promise forward-compat additions.
    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return;
        };
        match value.get("type").and_then(Value::as_str) {
            Some("session.started") | Some("session.resumed") => {
                super::push_session_id(&value, "sessionId", out);
            }
            Some("turn.failed") => {
                let message = value
                    .get("error")
                    .map(|error| {
                        error
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("MiniMax turn failed")
                    })
                    .unwrap_or("MiniMax turn failed");
                out.push(EngineEvent::Error(message.to_string()));
            }
            Some("turn.completed") | Some("exec.completed") => {
                if let Some(usage) = normalize_exec_usage(value.get("usage")) {
                    out.push(EngineEvent::Usage(usage));
                }
            }
            Some("item.completed") => {
                out.extend(item_events(value.get("item").unwrap_or(&Value::Null)));
            }
            _ => {}
        }
    }
}

/// One terminal exec item → engine events. Live shapes: `{type:
/// "agent_message", content}`, `{type:"reasoning", content}`, `{type:
/// "tool_call", toolCall:{name, arguments…}}`.
fn item_events(item: &Value) -> Vec<EngineEvent> {
    let kind = item.get("type").and_then(Value::as_str).unwrap_or("");
    let content = item
        .get("content")
        .and_then(Value::as_str)
        .filter(|content| !content.trim().is_empty());
    match kind {
        "agent_message" => content
            .map(|content| vec![super::assistant_message(content.to_string())])
            .unwrap_or_default(),
        "reasoning" => content
            .map(|content| vec![EngineEvent::Thinking(content.to_string())])
            .unwrap_or_default(),
        "tool_call" => {
            let call = item.get("toolCall").unwrap_or(&Value::Null);
            match call.get("name").and_then(Value::as_str) {
                Some(name) => {
                    let args = call.get("arguments").or_else(|| call.get("input"));
                    vec![super::tool_call_message(name, args)]
                }
                None => Vec::new(),
            }
        }
        _ => Vec::new(),
    }
}

/// The exec result's usage block (`input`/`output`/`totalTokens` per the
/// docs) projected onto the camelCase keys the frontend's usage parser
/// reads. Absent or shapeless usage yields None.
fn normalize_exec_usage(usage: Option<&Value>) -> Option<Value> {
    let usage = usage?;
    let object = usage.as_object()?;
    let mut normalized = serde_json::Map::new();
    let grab = |keys: &[&str]| {
        keys.iter().find_map(|key| {
            object
                .get(*key)
                .and_then(Value::as_u64)
        })
    };
    if let Some(total) = grab(&["totalTokens", "total"]) {
        normalized.insert("totalTokens".to_string(), Value::from(total));
    }
    if let Some(input) = grab(&["inputTokens", "input"]) {
        normalized.insert("inputTokens".to_string(), Value::from(input));
    }
    if let Some(output) = grab(&["outputTokens", "output"]) {
        normalized.insert("outputTokens".to_string(), Value::from(output));
    }
    if normalized.is_empty() {
        None
    } else {
        Some(Value::Object(normalized))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> SendRequest {
        SendRequest {
            session_id: None,
            workspace: std::env::temp_dir(),
            prompt: "run the tests".into(),
            images: vec![],
            model: Some("minimax/MiniMax-M2.7".into()),
            effort: Some("medium".into()),
            service_tier: None,
            permission: Some("auto".into()),
            additional_dirs: vec![],
            provider_id: None,
            computer_use: None,
            allowed_tools: None,
        }
    }

    fn argv(built: &BuiltCommand) -> Vec<String> {
        built
            .command
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn local_transport_is_acp_and_wsl_falls_back_to_exec() {
        assert!(MiniMaxEngine.transport_for(false) == Transport::Own);
        assert!(MiniMaxEngine.transport_for(true) == Transport::Child);
        let built = MiniMaxEngine.host_command(&request(), "mcode").unwrap();
        assert_eq!(argv(&built), ["acp"]);
        assert!(built.keep_stdin_open);
    }

    #[test]
    fn exec_command_maps_permission_model_effort_and_session() {
        let mut req = request();
        req.session_id = Some("mvs_session".into());
        let built = MiniMaxEngine.build_command(&req, "mcode").unwrap();
        let args = argv(&built);
        let flag = |flag: &str| {
            args.iter()
                .position(|a| a == flag)
                .map(|i| args[i + 1].clone())
        };
        assert_eq!(args[0], "exec");
        assert_eq!(args[1], "--output-format");
        assert_eq!(flag("--output-format").as_deref(), Some("stream-json"));
        assert_eq!(flag("--permission").as_deref(), Some("smart"));
        assert_eq!(flag("--model").as_deref(), Some("minimax/MiniMax-M2.7"));
        assert_eq!(flag("--effort").as_deref(), Some("medium"));
        assert_eq!(flag("--session").as_deref(), Some("mvs_session"));
        assert_eq!(args.last().map(String::as_str), Some("run the tests"));

        req.permission = Some("bypass".into());
        let built = MiniMaxEngine.build_command(&req, "mcode").unwrap();
        assert_eq!(
            argv(&built)
                .windows(2)
                .find(|pair| pair[0] == "--permission")
                .map(|pair| pair[1].clone())
                .as_deref(),
            Some("full")
        );
    }

    #[test]
    fn ask_backed_modes_refuse_the_headless_child() {
        let mut req = request();
        req.permission = Some("manual".into());
        assert!(MiniMaxEngine.build_command(&req, "mcode").is_err());
        req.permission = Some("plan".into());
        assert!(MiniMaxEngine.build_command(&req, "mcode").is_err());
        // Supported on the ACP transport, so the capability stays advertised.
        assert_eq!(
            MiniMaxEngine.resolve_permission(Some("manual")),
            "manual"
        );
    }

    #[test]
    fn stream_json_lines_project_to_engine_events() {
        let mut out = Vec::new();
        MiniMaxEngine.parse_line(
            r#"{"schemaVersion":1,"sequence":1,"type":"exec.started","runId":"r","sessionId":"mvs_a","turnId":"t"}"#,
            &mut out,
        );
        assert!(out.is_empty());

        MiniMaxEngine.parse_line(
            r#"{"schemaVersion":1,"sequence":2,"type":"session.started","sessionId":"mvs_a"}"#,
            &mut out,
        );
        MiniMaxEngine.parse_line(
            r#"{"schemaVersion":1,"sequence":3,"type":"session.resumed","sessionId":"mvs_b"}"#,
            &mut out,
        );
        assert!(matches!(&out[..], [EngineEvent::SessionId(a), EngineEvent::SessionId(b)] if a == "mvs_a" && b == "mvs_b"));

        out.clear();
        // Live shapes: contentDelta streams on started/updated (ignored —
        // the completed item repeats the full content), items spell
        // agent_message/reasoning/tool_call.
        MiniMaxEngine.parse_line(
            r#"{"schemaVersion":1,"sequence":4,"type":"item.started","item":{"id":"t:message","type":"agent_message","contentDelta":"好"}}"#,
            &mut out,
        );
        MiniMaxEngine.parse_line(
            r#"{"schemaVersion":1,"sequence":5,"type":"item.completed","item":{"id":"t:reasoning","type":"reasoning","content":"想一下"}}"#,
            &mut out,
        );
        MiniMaxEngine.parse_line(
            r#"{"schemaVersion":1,"sequence":6,"type":"item.completed","item":{"id":"t:message","type":"agent_message","content":"好的"}}"#,
            &mut out,
        );
        MiniMaxEngine.parse_line(
            r#"{"schemaVersion":1,"sequence":7,"type":"item.completed","item":{"id":"t:tool","type":"tool_call","toolCall":{"name":"read_file","arguments":{"path":"/tmp/a"}}}}"#,
            &mut out,
        );
        MiniMaxEngine.parse_line("not json at all", &mut out);
        assert_eq!(out.len(), 3);
        assert!(matches!(&out[0], EngineEvent::Thinking(text) if text == "想一下"));
        assert!(matches!(&out[1], EngineEvent::Message { text, .. } if text == "好的"));
        assert!(matches!(&out[2], EngineEvent::Message { .. }));

        out.clear();
        MiniMaxEngine.parse_line(
            r#"{"schemaVersion":1,"sequence":8,"type":"turn.completed","usage":{"inputTokens":10,"outputTokens":5,"totalTokens":15}}"#,
            &mut out,
        );
        MiniMaxEngine.parse_line(
            r#"{"schemaVersion":1,"sequence":9,"type":"turn.failed","error":{"message":"boom"}}"#,
            &mut out,
        );
        assert_eq!(out.len(), 2);
        assert!(matches!(&out[0], EngineEvent::Usage(_)));
        assert!(matches!(&out[1], EngineEvent::Error(message) if message == "boom"));
    }

    #[test]
    fn exec_usage_normalizes_live_and_documented_keys() {
        // Live turn.completed shape (camelCase).
        let usage = normalize_exec_usage(Some(
            &serde_json::json!({"inputTokens": 10, "outputTokens": 5, "totalTokens": 15}),
        ))
        .unwrap();
        assert_eq!(
            usage,
            serde_json::json!({"totalTokens": 15, "inputTokens": 10, "outputTokens": 5})
        );
        // Documented ExecResult shape (snake-ish input/output + totalTokens).
        let usage = normalize_exec_usage(Some(
            &serde_json::json!({"input": 10, "output": 5, "totalTokens": 15}),
        ))
        .unwrap();
        assert_eq!(usage["inputTokens"], serde_json::json!(10));
        assert!(normalize_exec_usage(Some(&serde_json::json!({}))).is_none());
        assert!(normalize_exec_usage(None).is_none());
    }
}
