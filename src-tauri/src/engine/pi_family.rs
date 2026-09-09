use super::{
    command_for_binary, images, push_session_id, safe_prompt_arg, BuiltCommand, Engine,
    EngineEvent, SendRequest,
};
use serde_json::Value;

/// pi and omp are the same CLI protocol (omp is a fork of pi): identical
/// spawn args and NDJSON event stream, different binary + home dir.
pub struct PiFamilyEngine {
    pub id: &'static str,
    pub home_dir_name: &'static str, // ".pi" | ".omp"
}

pub fn pi() -> PiFamilyEngine {
    PiFamilyEngine {
        id: "pi",
        home_dir_name: ".pi",
    }
}

pub fn omp() -> PiFamilyEngine {
    PiFamilyEngine {
        id: "omp",
        home_dir_name: ".omp",
    }
}

impl Engine for PiFamilyEngine {
    fn id(&self) -> &'static str {
        self.id
    }

    fn supports_images(&self) -> bool {
        // Images go out as `@<path>` argv entries (the pi/omp print-mode file
        // reference contract); whether the configured provider admits image
        // content is provider-dependent, but the transport is supported.
        true
    }
    // Print mode runs tools without prompting and exposes no permission
    // flags: only "auto" is honest (the trait default).

    fn build_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        cmd.arg("--print");
        cmd.arg("--mode");
        cmd.arg("json");
        if let Some(model) = req.model.as_deref() {
            cmd.arg("--model");
            cmd.arg(model);
        }
        // Both accept the full level vocabulary: low…max.
        if let Some(effort) = req.effort.as_deref() {
            cmd.arg("--thinking");
            cmd.arg(effort);
        }
        if let Some(session_id) = req.session_id.as_deref() {
            if !session_id.starts_with('-') {
                // pi supports `--session-id <id>`; omp dropped it, resume goes
                // through `-r/--resume` (accepts an ID prefix).
                if self.id == "omp" {
                    cmd.arg("--resume");
                } else {
                    cmd.arg("--session-id");
                }
                cmd.arg(session_id);
            }
        }
        // Image attachments as `@<abs path>` file references ahead of the
        // prompt. data: URLs can't be file-referenced; the frontend's paste
        // flow already materializes blobs to files, so anything left is
        // skipped here rather than breaking argv.
        for raw in &req.images {
            if let Some(absolute) = images::absolutize_image_path(raw, &req.workspace) {
                cmd.arg(format!("@{}", absolute.display()));
            }
        }
        cmd.arg(safe_prompt_arg(&req.prompt));
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: None,
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        })
    }

    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>) {
        parse_pi_family_line(line, out);
    }
}

/// Shared NDJSON parser for pi and omp (`--mode json`).
fn parse_pi_family_line(line: &str, out: &mut Vec<EngineEvent>) {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return;
    };
    let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
    match event_type {
        "session" => {
            push_session_id(&value, "id", out);
        }
        "message_update" => {
            let Some(event) = value.get("assistantMessageEvent") else {
                return;
            };
            match event.get("type").and_then(Value::as_str) {
                Some("text_delta") => {
                    if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                        if !delta.is_empty() {
                            out.push(EngineEvent::Delta(delta.to_string()));
                        }
                    }
                }
                Some("thinking_delta") => {
                    if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                        if !delta.is_empty() {
                            out.push(EngineEvent::Thinking(delta.to_string()));
                        }
                    }
                }
                _ => {}
            }
        }
        "tool_execution_start" => {
            let name = value
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("tool");
            let intent = value.get("intent").and_then(Value::as_str);
            let path = value.get("args").and_then(super::tool_path_arg);
            out.push(EngineEvent::Message {
                role: "tool".to_string(),
                text: tool_label(name, intent),
                path,
            });
        }
        "message_end" => {
            if let Some(usage) = value
                .get("message")
                .and_then(|m| m.get("usage"))
                .filter(|u| !u.is_null())
            {
                out.push(EngineEvent::Usage(usage.clone()));
            }
            // A message-level error is one failed model call (e.g. an
            // upstream 429): the CLI retries and the turn continues, so this
            // is only a notice. turn_end/agent_end errors stay terminal.
            // omp shapes vary by version: `message.errorMessage`, top-level
            // `errorMessage`, and nested `error.message` / `message.error`.
            if let Some(error) = nested_error_text(&value, &["message"]) {
                out.push(EngineEvent::Warn(error));
            }
        }
        "turn_end" | "agent_end" => {
            if let Some(error) = nested_error_text(&value, &[]) {
                out.push(EngineEvent::Error(error));
            }
            // No terminal result event exists in this protocol; the runner
            // emits Done on clean EOF. agent_end still settles the turn.
            if event_type == "agent_end" {
                out.push(EngineEvent::Done {
                    session_id: None,
                    usage: None,
                });
            }
        }
        _ => {}
    }
}
/// Display label for a tool call: the human-readable intent when the CLI
/// provides one, prefixed with the tool name so the frontend's type
/// classification still sees the raw name token.
pub fn tool_label(name: &str, intent: Option<&str>) -> String {
    match intent {
        Some(intent) if !intent.trim().is_empty() && intent.trim() != name => {
            format!("{} · {}", name, intent.trim())
                .chars()
                .take(120)
                .collect()
        }
        _ => name.to_string(),
    }
}

/// Find the first non-empty error text across the shapes omp emits:
/// `<prefix>.errorMessage`, top-level `errorMessage`, `error.message`, and
/// `<prefix>.error` / `error.error` when they are plain strings. Returns the
/// trimmed text; None when the event carries no error.
fn nested_error_text(value: &Value, prefix: &[&str]) -> Option<String> {
    let mut candidates: Vec<Option<&str>> = Vec::new();
    for pre in prefix {
        candidates.push(
            value
                .get(*pre)
                .and_then(|m| m.get("errorMessage"))
                .and_then(Value::as_str),
        );
    }
    candidates.push(value.get("errorMessage").and_then(Value::as_str));
    candidates.push(value.get("error").and_then(|e| e.get("message")).and_then(Value::as_str));
    for pre in prefix {
        candidates.push(value.get(*pre).and_then(|m| m.get("error")).and_then(Value::as_str));
    }
    candidates
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|text| !text.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_execution_start_carries_args_path() {
        let line = serde_json::json!({
            "type": "tool_execution_start",
            "toolCallId": "tool_1",
            "toolName": "edit",
            "args": { "path": "src/app.tsx", "input": {} },
            "intent": "Adding chrome token"
        })
        .to_string();
        let mut out = Vec::new();
        parse_pi_family_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Message { role, text, path } => {
                assert_eq!(role, "tool");
                assert_eq!(text, "edit · Adding chrome token");
                assert_eq!(path.as_deref(), Some("src/app.tsx"));
            }
            _ => panic!("expected tool message"),
        }

        // bash-style args carry no path key -> None.
        let line = serde_json::json!({
            "type": "tool_execution_start",
            "toolCallId": "tool_2",
            "toolName": "bash",
            "args": { "command": "ls" }
        })
        .to_string();
        let mut out = Vec::new();
        parse_pi_family_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Message { path, .. } => assert_eq!(*path, None),
            _ => panic!("expected tool message"),
        }
    }

    #[test]
    fn message_end_extracts_nested_error_shapes_as_warn() {
        for line in [
            serde_json::json!({"type":"message_end","message":{"errorMessage":"upstream 429"}}),
            serde_json::json!({"type":"message_end","errorMessage":"top-level 429"}),
            serde_json::json!({"type":"message_end","error":{"message":"nested 429"}}),
            serde_json::json!({"type":"message_end","message":{"error":"message.error 429"}}),
        ] {
            let mut out = Vec::new();
            parse_pi_family_line(&line.to_string(), &mut out);
            match out.last() {
                Some(EngineEvent::Warn(text)) => assert!(text.contains("429"), "{line}"),
                other => panic!("expected Warn for {line}, got {other:?}"),
            }
        }
    }

    #[test]
    fn turn_end_extracts_error_from_all_shapes() {
        for line in [
            serde_json::json!({"type":"turn_end","errorMessage":"boom"}),
            serde_json::json!({"type":"turn_end","error":{"message":"nested boom"}}),
        ] {
            let mut out = Vec::new();
            parse_pi_family_line(&line.to_string(), &mut out);
            match out.first() {
                Some(EngineEvent::Error(text)) => assert!(text.contains("boom"), "{line}"),
                other => panic!("expected Error for {line}, got {other:?}"),
            }
        }
    }
}
