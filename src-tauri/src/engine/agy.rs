use super::{
    command_for_binary, parse_tool_args_value, safe_prompt_arg, tool_call_message,
    tool_result_patch, BuiltCommand, Engine, EngineEvent, SendRequest,
};
use serde_json::Value;
use std::path::PathBuf;

/// Antigravity CLI (`agy`) home: `$ANTIGRAVITY_HOME` or `~/.gemini/antigravity-cli`.
pub(crate) fn agy_home() -> PathBuf {
    crate::engine::engine_home(Some("ANTIGRAVITY_HOME"), ".gemini/antigravity-cli")
}

pub struct AgyEngine;

/// 提取并规范化上下文窗口字段
fn attach_context_window(mut usage: Value) -> Value {
    if usage.get("model_context_window").is_some() {
        return usage;
    }

    let window = usage
        .get("context_window")
        .or_else(|| usage.get("contextWindow"))
        .or_else(|| usage.get("model_context_window"))
        .and_then(|v| match v {
            Value::Number(n) => n.as_i64(),
            Value::String(s) => s.parse().ok(),
            _ => None,
        })
        .filter(|&w| w > 0);

    if let Some(w) = window {
        if let Some(obj) = usage.as_object_mut() {
            obj.insert("model_context_window".to_string(), Value::Number(w.into()));
        }
    }

    usage
}

impl Engine for AgyEngine {
    fn id(&self) -> &'static str {
        "agy"
    }

    fn supports_images(&self) -> bool {
        false
    }
    fn supports_effort(&self) -> bool {
        true
    }

    fn supported_permissions(&self) -> &'static [&'static str] {
        &["auto", "plan", "bypass"]
    }

    fn build_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        cmd.arg("--output-format");
        cmd.arg("stream-json");
        // Print mode defaults to 5m; agent turns with tools routinely exceed that.
        cmd.arg("--print-timeout");
        cmd.arg("60m");
        cmd.arg("--disable-slash-commands");

        match self.resolve_permission(req.permission.as_deref()) {
            "bypass" => {
                cmd.arg("--dangerously-skip-permissions");
            }
            "plan" => {
                cmd.arg("--mode");
                cmd.arg("plan");
            }
            _ => {
                cmd.arg("--mode");
                cmd.arg("accept-edits");
            }
        }

        if let Some(model) = req
            .model
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty())
        {
            cmd.arg("--model");
            cmd.arg(model);
            if let Some(effort) = effort_flag(req.effort.as_deref(), model) {
                cmd.arg("--effort");
                cmd.arg(effort);
            }
        } else if let Some(effort) = effort_flag(req.effort.as_deref(), "") {
            cmd.arg("--effort");
            cmd.arg(effort);
        }

        // Print mode does not treat process cwd as the workspace; the working
        // directory must be registered explicitly via --add-dir.
        let mut seen_dirs = std::collections::HashSet::new();
        let workspace = req.workspace.to_string_lossy();
        if !workspace.is_empty() && seen_dirs.insert(workspace.to_string()) {
            cmd.arg("--add-dir");
            cmd.arg(req.workspace.as_os_str());
        }
        for dir in &req.additional_dirs {
            let dir = dir.trim();
            if dir.is_empty() || !seen_dirs.insert(dir.to_string()) {
                continue;
            }
            cmd.arg("--add-dir");
            cmd.arg(dir);
        }

        if let Some(session_id) = req
            .session_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            cmd.arg("--conversation");
            cmd.arg(session_id);
        }

        // `--print` is a string flag: the next token is the prompt. Keep it last
        // so a following option can never be swallowed as the prompt value.
        cmd.arg("--print");
        cmd.arg(safe_prompt_arg(&req.prompt));

        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: None,
            keep_stdin_open: false,
            cleanup_files: Vec::new(),
            mcp_restore: None,
            preassigned_session_id: None,
        })
    }

    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return;
        };
        match event_name(&value) {
            "init" => {
                push_conversation_id(nested(&value, "init"), out);
            }
            "step_update" => parse_step_update(nested(&value, "step_update"), out),
            "result" => parse_result(nested(&value, "result"), out),
            "error" => {
                let message = string_field(&value, "message")
                    .or_else(|| string_field(&value, "error"))
                    .unwrap_or("agy error")
                    .to_string();
                out.push(EngineEvent::Error(message));
            }
            _ => {}
        }
    }
}

/// `--effort` only when the request names one and the model slug does not
/// already encode it (`gemini-3.8-flash-high`). The requested string is passed
/// through unchanged.
fn effort_flag<'a>(requested: Option<&'a str>, model: &str) -> Option<&'a str> {
    let effort = requested.map(str::trim).filter(|e| !e.is_empty())?;
    if model_encodes_effort(model) {
        return None;
    }
    Some(effort)
}

fn model_encodes_effort(model: &str) -> bool {
    let lower = model.to_ascii_lowercase();
    lower.ends_with("-high") || lower.ends_with("-medium") || lower.ends_with("-low")
}

fn event_name(value: &Value) -> &str {
    value
        .get("event")
        .or_else(|| value.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("")
}

/// `{"event":"init","init":{…}}` payload, or the object itself when flattened.
fn nested<'a>(value: &'a Value, key: &str) -> &'a Value {
    value.get(key).filter(|v| v.is_object()).unwrap_or(value)
}

fn string_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn push_conversation_id(value: &Value, out: &mut Vec<EngineEvent>) {
    if let Some(id) = string_field(value, "conversation_id") {
        out.push(EngineEvent::SessionId(id.to_string()));
    }
}

fn parse_step_update(step: &Value, out: &mut Vec<EngineEvent>) {
    if let Some(delta) = string_field(step, "text_delta") {
        out.push(EngineEvent::Delta(delta.to_string()));
    }
    let Some(tool) = step.get("tool_info").filter(|v| v.is_object()) else {
        return;
    };
    let name = string_field(tool, "name")
        .or_else(|| string_field(tool, "tool_name"))
        .or_else(|| string_field(tool, "canonical_name"))
        .unwrap_or("tool");
    let args = tool
        .get("parameters")
        .or_else(|| tool.get("args"))
        .or_else(|| tool.get("input"));
    if args.is_some() || tool.get("output").is_none() {
        out.push(tool_call_message(name, args));
    }
    if let Some(output) = tool.get("output") {
        if !output.is_null() {
            out.push(tool_result_patch(name, Some(output)));
        }
    }
}

fn parse_result(result: &Value, out: &mut Vec<EngineEvent>) {
    push_conversation_id(result, out);
    let usage = result
        .get("usage")
        .and_then(parse_tool_args_value)
        .map(attach_context_window);
    if let Some(usage) = usage.clone() {
        out.push(EngineEvent::Usage(usage));
    }
    let status = string_field(result, "status").unwrap_or("");
    let ok = status.is_empty()
        || status.eq_ignore_ascii_case("success")
        || status.eq_ignore_ascii_case("ok");
    if !ok {
        let message = string_field(result, "error")
            .or_else(|| string_field(result, "message"))
            .unwrap_or(status)
            .to_string();
        out.push(EngineEvent::Error(message));
        return;
    }
    if let Some(error) = string_field(result, "error") {
        out.push(EngineEvent::Error(error.to_string()));
        return;
    }
    let session_id = string_field(result, "conversation_id").map(str::to_string);
    out.push(EngineEvent::Done { session_id, usage });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn req(permission: Option<&str>) -> SendRequest {
        SendRequest {
            session_id: None,
            workspace: PathBuf::from("/tmp/ws"),
            prompt: "hi".to_string(),
            prompt_contributions: Vec::new(),
            images: Vec::new(),
            model: None,
            effort: None,
            service_tier: None,
            permission: permission.map(str::to_string),
            additional_dirs: Vec::new(),
            provider_id: None,
            computer_use: None,
            allowed_tools: None,
        }
    }

    fn argv(req: &SendRequest) -> Vec<String> {
        let built = AgyEngine.build_command(req, "agy").unwrap();
        built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect()
    }

    fn events(line: &str) -> Vec<EngineEvent> {
        let mut out = Vec::new();
        AgyEngine.parse_line(line, &mut out);
        out
    }

    #[test]
    fn print_flag_is_last_and_owns_the_prompt() {
        let args = argv(&req(Some("auto")));
        assert_eq!(args[args.len() - 2], "--print");
        assert_eq!(args[args.len() - 1], "hi");
        assert!(args
            .windows(2)
            .any(|w| w == ["--output-format", "stream-json"]));
        assert!(args.windows(2).any(|w| w == ["--print-timeout", "60m"]));
        assert!(args.windows(2).any(|w| w == ["--mode", "accept-edits"]));
        assert!(args.windows(2).any(|w| w == ["--add-dir", "/tmp/ws"]));
        assert!(!args.contains(&"--dangerously-skip-permissions".to_string()));
    }

    #[test]
    fn maps_plan_and_bypass() {
        let plan = argv(&req(Some("plan")));
        assert!(plan.windows(2).any(|w| w == ["--mode", "plan"]));
        assert!(!plan.contains(&"--dangerously-skip-permissions".to_string()));

        let bypass = argv(&req(Some("bypass")));
        assert!(bypass.contains(&"--dangerously-skip-permissions".to_string()));
        assert!(!bypass.contains(&"--mode".to_string()));
    }

    #[test]
    fn resume_and_model_and_extra_dirs() {
        let mut request = req(Some("auto"));
        request.session_id = Some("45d30962-3fae-4b48-8de5-0ed0edf5b9cb".into());
        request.model = Some("gemini-3.8-flash-high".into());
        request.effort = Some("high".into());
        request.additional_dirs = vec!["/tmp/ws".into(), "/extra".into()];
        let args = argv(&request);
        assert!(args
            .windows(2)
            .any(|w| { w == ["--conversation", "45d30962-3fae-4b48-8de5-0ed0edf5b9cb"] }));
        assert!(args
            .windows(2)
            .any(|w| w == ["--model", "gemini-3.8-flash-high"]));
        // Slug already encodes effort — do not send a redundant flag.
        assert!(!args.contains(&"--effort".to_string()));
        assert_eq!(args.iter().filter(|a| *a == "--add-dir").count(), 2);
        assert!(args.windows(2).any(|w| w == ["--add-dir", "/extra"]));
    }

    #[test]
    fn effort_passed_when_slug_has_none() {
        let mut request = req(Some("auto"));
        request.model = Some("claude-sonnet-4-6".into());
        request.effort = Some("xhigh".into());
        let args = argv(&request);
        assert!(args.windows(2).any(|w| w == ["--effort", "xhigh"]));
    }

    #[test]
    fn parses_init_delta_tool_and_result() {
        let init = events(r#"{"event":"init","init":{"conversation_id":"abc-1"}}"#);
        match &init[..] {
            [EngineEvent::SessionId(id)] => assert_eq!(id, "abc-1"),
            other => panic!("unexpected init: {other:?}"),
        }

        let delta = events(
            r#"{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"Hello"}}"#,
        );
        match &delta[..] {
            [EngineEvent::Delta(text)] => assert_eq!(text, "Hello"),
            other => panic!("unexpected delta: {other:?}"),
        }

        let tool = events(
            r#"{"event":"step_update","step_update":{"step_type":"tool","tool_info":{"name":"read_file","parameters":{"path":"a.ts"},"output":"ok"}}}"#,
        );
        assert!(matches!(
            &tool[0],
            EngineEvent::Message { role, text, path, patch, .. }
                if role == "tool" && text == "read_file" && path.as_deref() == Some("a.ts") && !patch
        ));
        assert!(matches!(
            &tool[1],
            EngineEvent::Message {
                result: Some(_),
                patch: true,
                ..
            }
        ));

        let done = events(
            r#"{"event":"result","result":{"status":"SUCCESS","conversation_id":"abc-1","usage":{"input_tokens":3,"output_tokens":4}}}"#,
        );
        assert!(done
            .iter()
            .any(|e| matches!(e, EngineEvent::SessionId(id) if id == "abc-1")));
        assert!(done.iter().any(|e| matches!(e, EngineEvent::Usage(_))));
        assert!(done.iter().any(|e| matches!(
            e,
            EngineEvent::Done { session_id: Some(id), usage: Some(_) } if id == "abc-1"
        )));
    }

    #[test]
    fn result_error_status_is_terminal_error() {
        let ev = events(
            r#"{"event":"result","result":{"status":"ERROR","error":"RESOURCE_EXHAUSTED"}}"#,
        );
        match &ev[..] {
            [EngineEvent::Error(msg)] => assert_eq!(msg, "RESOURCE_EXHAUSTED"),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn older_ok_status_still_finishes() {
        let ev = events(r#"{"event":"result","result":{"status":"OK","conversation_id":"x"}}"#);
        assert!(ev.iter().any(|e| matches!(
            e,
            EngineEvent::Done { session_id: Some(id), .. } if id == "x"
        )));
    }
}
