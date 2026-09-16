use super::{
    command_for_binary, images, push_session_id, tool_call_message, tool_call_patch, BuiltCommand,
    Engine, EngineEvent, SendRequest,
};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;

pub struct ClaudeEngine {
    /// Per-block partial JSON for tool_use inputs. Streamed as
    /// `input_json_delta` after a name-only `content_block_start`.
    pending_tool_json: Mutex<HashMap<u64, PendingTool>>,
    /// tool_use id -> tool name, recorded at `content_block_start` so a
    /// later `tool_result` (user message) can be attributed to its call.
    tool_names: Mutex<HashMap<String, String>>,
    /// Post-compaction remaining context tokens from `compact_boundary` event,
    /// used to report accurate post-compaction usage instead of the turn's billing usage.
    compact_post_tokens: Mutex<Option<i64>>,
}

struct PendingTool {
    name: String,
    json: String,
}

impl ClaudeEngine {
    pub fn new() -> Self {
        Self {
            pending_tool_json: Mutex::new(HashMap::new()),
            tool_names: Mutex::new(HashMap::new()),
            compact_post_tokens: Mutex::new(None),
        }
    }
}

impl Engine for ClaudeEngine {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn supports_images(&self) -> bool {
        true
    }
    fn supported_permissions(&self) -> &'static [&'static str] {
        &["auto", "manual", "plan", "bypass"]
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
        // Headless -p cannot prompt mid-turn: "manual" maps onto claude's
        // default mode, where approval-needing tools are denied and the
        // agent is told to work around them (honest degrade, no fake ask).
        match self.resolve_permission(req.permission.as_deref()) {
            "bypass" => {
                cmd.arg("--dangerously-skip-permissions");
            }
            mode => {
                cmd.arg("--permission-mode");
                cmd.arg(match mode {
                    "manual" => "default",
                    "plan" => "plan",
                    _ => "acceptEdits",
                });
                if mode == "auto" {
                    // acceptEdits pre-approves file edits only; WebSearch and
                    // WebFetch still ask, and headless -p cannot prompt, so
                    // the CLI would deny every web call outright. Pre-approve
                    // the two read-only network tools in auto mode.
                    cmd.arg("--allowedTools");
                    cmd.arg("WebSearch");
                    cmd.arg("WebFetch");
                }
            }
        }
        if let Some(model) = req.model.as_deref() {
            cmd.arg("--model");
            // Launch with the id the picker names: family aliases resolve
            // through their ANTHROPIC_DEFAULT_<FAMILY>_MODEL override here,
            // so relay setups don't depend on the CLI's own alias remap.
            cmd.arg(super::models::resolve_claude_launch_model(model));
        }
        // Claude Code has no effort flag; the thinking budget env var is the
        // effort knob. "low" stays at the CLI default (no forced thinking).
        match req.effort.as_deref() {
            Some("medium") => {
                cmd.env("MAX_THINKING_TOKENS", "16384");
            }
            Some("high") => {
                cmd.env("MAX_THINKING_TOKENS", "65536");
            }
            Some("xhigh") => {
                cmd.env("MAX_THINKING_TOKENS", "131072");
            }
            Some("max") => {
                cmd.env("MAX_THINKING_TOKENS", "262144");
            }
            _ => {}
        }
        // Granted directories ride every launch: the CLI cannot expand its
        // allowed-dirs mid-process, and each send is a fresh process anyway,
        // so a grant approved mid-conversation takes effect on the next send.
        let mut seen_dirs = std::collections::HashSet::new();
        for dir in &req.additional_dirs {
            let dir = dir.trim();
            if dir.is_empty() || dir == req.workspace.to_string_lossy() || !seen_dirs.insert(dir.to_string()) {
                continue;
            }
            cmd.arg("--add-dir");
            cmd.arg(dir);
        }
        if let Some(session_id) = req.session_id.as_deref() {
            cmd.arg("--resume");
            cmd.arg(session_id);
        }
        let stdin_payload = images::claude_stdin_message(&req.prompt, &req.images, &req.workspace)?;
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: Some(stdin_payload),
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        })
    }

    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
        match event_type {
            "system" => {
                push_session_id(&value, "session_id", out);
                let subtype = value.get("subtype").and_then(Value::as_str);
                if subtype == Some("api_retry") {
                    // Live progress, not an error: the CLI backs off for
                    // minutes (10 attempts, 30s+ delays) and then continues.
                    // The run status line shows "重试中 x/y"; the detail
                    // rides along for its tooltip.
                    out.push(EngineEvent::Retry {
                        attempt: value.get("attempt").and_then(Value::as_u64).unwrap_or(0),
                        max: value
                            .get("max_retries")
                            .and_then(Value::as_u64)
                            .unwrap_or(0),
                        message: format_api_retry(&value),
                    });
                } else if subtype == Some("compact_boundary") {
                    if let Some(post_tokens) = value
                        .get("compactMetadata")
                        .and_then(|m| m.get("postTokens").or_else(|| m.get("post_tokens")))
                        .and_then(Value::as_i64)
                    {
                        if let Ok(mut lock) = self.compact_post_tokens.lock() {
                            *lock = Some(post_tokens);
                        }
                        let usage_obj = serde_json::json!({
                            "input_tokens": post_tokens,
                            "total_tokens": post_tokens,
                        });
                        out.push(EngineEvent::Usage(usage_obj));
                    }
                }
            }
            "stream_event" => {
                parse_stream_event(&self.pending_tool_json, &self.tool_names, &value, out)
            }
            "assistant" => {
                // Full message snapshot; used as session-id and actual model source.
                push_session_id(&value, "session_id", out);
                if let Some(model) = value
                    .get("message")
                    .and_then(|m| m.get("model"))
                    .or_else(|| value.get("model"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    out.push(EngineEvent::Model(model.to_string()));
                }
            }
            "user" => {
                // tool_result blocks carry permission denials as is_error
                // text (headless cannot prompt). Surface them so the UI can
                // offer a directory grant instead of letting the model
                // narrate a terminal prompt that does not exist.
                for text in tool_result_error_texts(&value) {
                    if looks_like_permission_denial(&text) {
                        out.push(EngineEvent::PermissionDenied {
                            tool: None,
                            path: extract_absolute_path(&text),
                            message: text,
                        });
                    }
                }
                // Tool result output emitted in response to tool_use. The
                // tool name is resolved from the tool_use_id recorded at
                // content_block_start, so the result patch lands on the
                // matching row even when tool calls run in parallel.
                if let Some(content) = value
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(Value::as_array)
                {
                    for block in content {
                        if block.get("type").and_then(Value::as_str) == Some("tool_result") {
                            // Error blocks are surfaced as permission denials
                            // above (or narrated by the model); denial-shaped
                            // text without is_error stays silent for the same
                            // reason. Keep both out of the timeline panel to
                            // avoid double-reporting.
                            if block
                                .get("is_error")
                                .and_then(Value::as_bool)
                                .unwrap_or(false)
                                || looks_like_permission_denial(&tool_result_block_text(block))
                            {
                                continue;
                            }
                            let res = value.get("toolUseResult").or_else(|| block.get("content"));
                            let name = block
                                .get("tool_use_id")
                                .and_then(Value::as_str)
                                .and_then(|id| {
                                    self.tool_names
                                        .lock()
                                        .ok()
                                        .and_then(|map| map.get(id).cloned())
                                })
                                .unwrap_or_default();
                            out.push(super::tool_result_patch(name, res));
                        }
                    }
                }
            }
            "result" => {
                // Structured fallback: the final result lists every denial
                // of the turn. The frontend dedupes against the tool_result
                // signal above (same path), so double-reporting is harmless.
                if let Some(denials) = value.get("permission_denials").and_then(Value::as_array) {
                    for denial in denials {
                        let tool = denial
                            .get("tool_name")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|t| !t.is_empty())
                            .map(str::to_string);
                        let path = denial.get("tool_input").and_then(super::tool_path_arg);
                        if tool.is_some() || path.is_some() {
                            out.push(EngineEvent::PermissionDenied {
                                tool,
                                path,
                                message: String::new(),
                            });
                        }
                    }
                }
                let session_id = value
                    .get("session_id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string);
                let raw_usage = value.get("usage").cloned();
                let usage = if let Ok(mut lock) = self.compact_post_tokens.lock() {
                    match lock.take() {
                        Some(post_tokens) => Some(compact_usage(post_tokens, raw_usage.as_ref())),
                        None => raw_usage,
                    }
                } else {
                    raw_usage
                }
                .map(|usage| attach_reported_context_window(usage, &value));
                let is_error = value
                    .get("is_error")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let subtype = value.get("subtype").and_then(Value::as_str).unwrap_or("");
                if is_error || subtype.starts_with("error") {
                    let message = value
                        .get("result")
                        .and_then(Value::as_str)
                        .unwrap_or("claude turn failed")
                        .to_string();
                    out.push(EngineEvent::Error(message));
                } else {
                    out.push(EngineEvent::Done { session_id, usage });
                }
            }
            _ => {}
        }
    }
}

/// Fold the CLI's reported context window into a turn's usage.
///
/// Claude's `result` line carries the window per model under `modelUsage`
/// (`{ "<model>": { contextWindow, maxOutputTokens, … } }`); it never sends
/// `model_context_window`, which is the key the rest of the app reads. Without
/// this, every Claude turn fell through to the UI's assumed 200k — wrong for
/// the 1M `[1m]` variants, and unverifiable for the rest.
///
/// A turn can name several models (a subagent on a cheap model, background
/// work). The one that actually ran the turn is the one with the most tokens,
/// so its window wins; entries without a usable window are ignored.
fn attach_reported_context_window(mut usage: Value, source: &Value) -> Value {
    if usage.get("model_context_window").is_some() {
        return usage;
    }
    let Some(models) = source.get("modelUsage").and_then(Value::as_object) else {
        return usage;
    };
    let busiest = models
        .values()
        .filter_map(|model| {
            let window = model.get("contextWindow").and_then(Value::as_i64)?;
            if window <= 0 {
                return None;
            }
            let tokens: i64 = ["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens"]
                .iter()
                .filter_map(|key| model.get(*key).and_then(Value::as_i64))
                .sum();
            Some((tokens, window))
        })
        .max_by_key(|(tokens, _)| *tokens);
    let Some((_, window)) = busiest else {
        return usage;
    };
    if let Some(object) = usage.as_object_mut() {
        object.insert("model_context_window".to_string(), Value::from(window));
    }
    usage
}

/// Usage snapshot for a compacted turn. Occupancy is the post-compaction
/// remainder (`post_tokens`), not the turn's billing input, but the turn's
/// output still enters the context afterwards and the reported context
/// window is carried over so the breakdown keeps its segments and scale
/// (total = post_tokens + output_tokens).
fn compact_usage(post_tokens: i64, raw: Option<&Value>) -> Value {
    let output = raw
        .and_then(|u| u.get("output_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let mut usage = serde_json::json!({
        "input_tokens": post_tokens,
        "output_tokens": output,
        "total_tokens": post_tokens + output,
    });
    if let (Some(raw), Some(obj)) = (raw, usage.as_object_mut()) {
        if let Some(window) = raw.get("model_context_window") {
            obj.insert("model_context_window".to_string(), window.clone());
        }
    }
    usage
}

/// Phrases the CLI uses when a tool call is denied by the permission
/// system in headless mode (matched case-insensitively against the
/// tool_result error text).
const DENIAL_PHRASES: &[&str] = &[
    "requested permissions",
    "haven't granted it yet",
    "have not granted it yet",
    "requires approval",
    "requires permission",
    "permission denied",
    "blocked for security",
    "blocked. for security",
    "allowed working directories",
    "may only write to files",
    "outside the allowed",
    "outside workspace",
];

fn looks_like_permission_denial(message: &str) -> bool {
    let normalized = message.trim().to_ascii_lowercase();
    !normalized.is_empty() && DENIAL_PHRASES.iter().any(|p| normalized.contains(p))
}

/// First absolute-path-looking token in free text: Windows `C:\…` / `C:/…`
/// or POSIX `/…`, with surrounding quotes and punctuation trimmed.
fn extract_absolute_path(text: &str) -> Option<String> {
    for token in text.split_whitespace() {
        let cleaned = token.trim_matches(|c: char| {
            matches!(c, '"' | '\'' | '`' | ',' | ';' | ')' | '(' | '[' | ']' | '{' | '}' | '.')
        });
        let bytes = cleaned.as_bytes();
        if cleaned.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/')
        {
            return Some(cleaned.to_string());
        }
        if cleaned.starts_with('/') && cleaned.len() > 1 {
            return Some(cleaned.to_string());
        }
    }
    None
}

/// Text payload of a single tool_result block: plain string or joined text
/// parts.
fn tool_result_block_text(block: &Value) -> String {
    match block.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter(|p| p.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Error texts of tool_result blocks in a "user" stream line. Content may be
/// a plain string or an array of text blocks.
fn tool_result_error_texts(value: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let Some(content) = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    else {
        return out;
    };
    for block in content {
        if block.get("type").and_then(Value::as_str) != Some("tool_result") {
            continue;
        }
        if !block.get("is_error").and_then(Value::as_bool).unwrap_or(false) {
            continue;
        }
        let text = tool_result_block_text(block);
        let text = text.trim().chars().take(500).collect::<String>();
        if !text.is_empty() {
            out.push(text);
        }
    }
    out
}

/// Human-readable line for a `system/api_retry` event.
fn format_api_retry(value: &Value) -> String {
    let attempt = value.get("attempt").and_then(Value::as_u64).unwrap_or(0);
    let max = value.get("max_retries").and_then(Value::as_u64).unwrap_or(0);
    let delay_ms = value.get("retry_delay_ms").and_then(Value::as_u64).unwrap_or(0);
    let detail = value
        .get("error")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|e| !e.is_empty() && *e != "unknown");
    let mut msg = match value.get("error_status").and_then(Value::as_u64) {
        Some(code) => format!("API error (HTTP {code})"),
        None => match detail {
            Some(detail) => format!("API error: {detail}"),
            None => "API error".to_string(),
        },
    };
    msg.push_str(&format!(
        "; retrying ({attempt}/{max}) in {:.1}s",
        delay_ms as f64 / 1000.0
    ));
    msg
}

/// Anthropic SSE wrapped events (requires --include-partial-messages).
fn parse_stream_event(
    pending: &Mutex<HashMap<u64, PendingTool>>,
    tool_names: &Mutex<HashMap<String, String>>,
    value: &Value,
    out: &mut Vec<EngineEvent>,
) {
    let Some(event) = value.get("event") else {
        return;
    };
    match event.get("type").and_then(Value::as_str) {
        Some("content_block_delta") => parse_content_block_delta(pending, event, out),
        // Tool calls surface at block start with `input: {}`; the real
        // arguments stream in as `input_json_delta` and flush on stop.
        Some("content_block_start") => parse_content_block_start(pending, tool_names, event, out),
        Some("content_block_stop") => parse_content_block_stop(pending, event, out),
        _ => {}
    }
}

fn parse_content_block_delta(
    pending: &Mutex<HashMap<u64, PendingTool>>,
    event: &Value,
    out: &mut Vec<EngineEvent>,
) {
    let Some(delta) = event.get("delta") else {
        return;
    };
    match delta.get("type").and_then(Value::as_str) {
        Some("text_delta") | Some("thinking_delta") => {
            let is_thinking = delta.get("type").and_then(Value::as_str) == Some("thinking_delta");
            let key = if is_thinking { "thinking" } else { "text" };
            let Some(text) = delta.get(key).and_then(Value::as_str) else {
                return;
            };
            if text.is_empty() {
                return;
            }
            if is_thinking {
                out.push(EngineEvent::Thinking(text.to_string()));
            } else {
                out.push(EngineEvent::Delta(text.to_string()));
            }
        }
        Some("input_json_delta") => {
            let Some(partial) = delta.get("partial_json").and_then(Value::as_str) else {
                return;
            };
            if partial.is_empty() {
                return;
            }
            let Some(index) = event.get("index").and_then(Value::as_u64) else {
                return;
            };
            if let Ok(mut map) = pending.lock() {
                if let Some(tool) = map.get_mut(&index) {
                    tool.json.push_str(partial);
                }
            }
        }
        _ => {}
    }
}

fn parse_content_block_start(
    pending: &Mutex<HashMap<u64, PendingTool>>,
    tool_names: &Mutex<HashMap<String, String>>,
    event: &Value,
    out: &mut Vec<EngineEvent>,
) {
    let Some(block) = event.get("content_block") else {
        return;
    };
    if block.get("type").and_then(Value::as_str) != Some("tool_use") {
        return;
    }
    let name = block
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("tool")
        .to_string();
    let input = block.get("input");
    if let Some(id) = block.get("id").and_then(Value::as_str) {
        if let Ok(mut map) = tool_names.lock() {
            map.insert(id.to_string(), name.clone());
        }
    }
    if let Some(index) = event.get("index").and_then(Value::as_u64) {
        if let Ok(mut map) = pending.lock() {
            map.insert(
                index,
                PendingTool {
                    name: name.clone(),
                    json: String::new(),
                },
            );
        }
    }
    // Name-only start so the timeline can show the tool immediately; args
    // patch in when the JSON stream completes (or if input is already full).
    out.push(tool_call_message(name, input));
}

fn parse_content_block_stop(
    pending: &Mutex<HashMap<u64, PendingTool>>,
    event: &Value,
    out: &mut Vec<EngineEvent>,
) {
    let Some(index) = event.get("index").and_then(Value::as_u64) else {
        return;
    };
    let Some(tool) = pending.lock().ok().and_then(|mut map| map.remove(&index)) else {
        return;
    };
    let trimmed = tool.json.trim();
    if trimmed.is_empty() {
        return;
    }
    let Ok(args) = serde_json::from_str::<Value>(trimmed) else {
        return;
    };
    out.push(tool_call_patch(tool.name, Some(&args)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_use_block_start_emits_tool_message() {
        let line = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 1,
                "content_block": { "type": "tool_use", "id": "toolu_1", "name": "Bash", "input": {} }
            }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert_eq!(out.len(), 1);
        match &out[0] {
            EngineEvent::Message { role, text, args, .. } => {
                assert_eq!(role, "tool");
                assert_eq!(text, "Bash");
                assert!(args.is_none());
            }
            _ => panic!("expected tool message"),
        }
    }

    #[test]
    fn tool_use_input_json_delta_patches_args() {
        let engine = ClaudeEngine::new();
        let start = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 1,
                "content_block": { "type": "tool_use", "id": "toolu_1", "name": "Read", "input": {} }
            }
        })
        .to_string();
        let delta = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 1,
                "delta": { "type": "input_json_delta", "partial_json": "{\"file_path\":\"src/a.ts\"}" }
            }
        })
        .to_string();
        let stop = serde_json::json!({
            "type": "stream_event",
            "event": { "type": "content_block_stop", "index": 1 }
        })
        .to_string();
        let mut out = Vec::new();
        engine.parse_line(&start, &mut out);
        engine.parse_line(&delta, &mut out);
        assert_eq!(out.len(), 1);
        out.clear();
        engine.parse_line(&stop, &mut out);
        assert_eq!(out.len(), 1);
        match &out[0] {
            EngineEvent::Message {
                text,
                path,
                args,
                patch,
                ..
            } => {
                assert_eq!(text, "Read");
                assert_eq!(path.as_deref(), Some("src/a.ts"));
                assert_eq!(args, &Some(serde_json::json!({"file_path": "src/a.ts"})));
                assert!(*patch);
            }
            _ => panic!("expected patched tool message"),
        }
    }

    #[test]
    fn tool_result_is_attributed_via_tool_use_id() {
        let engine = ClaudeEngine::new();
        let start = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 0,
                "content_block": { "type": "tool_use", "id": "toolu_1", "name": "Bash", "input": {} }
            }
        })
        .to_string();
        let user = serde_json::json!({
            "type": "user",
            "message": {
                "content": [
                    { "type": "tool_result", "tool_use_id": "toolu_1", "content": "On branch main" }
                ]
            }
        })
        .to_string();
        let mut out = Vec::new();
        engine.parse_line(&start, &mut out);
        out.clear();
        engine.parse_line(&user, &mut out);
        let patch = out
            .iter()
            .find(|e| {
                matches!(
                    e,
                    EngineEvent::Message {
                        patch: true,
                        result: Some(_),
                        ..
                    }
                )
            })
            .expect("expected a tool result patch");
        match patch {
            EngineEvent::Message {
                text,
                result,
                patch,
                ..
            } => {
                assert_eq!(text, "Bash");
                assert_eq!(result, &Some(serde_json::json!("On branch main")));
                assert!(*patch);
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn api_retry_system_event_reports_progress_without_settling() {
        let line = serde_json::json!({
            "type": "system",
            "subtype": "api_retry",
            "attempt": 3,
            "max_retries": 10,
            "retry_delay_ms": 9560,
            "error_status": 529,
            "error": "overloaded",
            "session_id": "s-1"
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert_eq!(out.len(), 2);
        match &out[1] {
            EngineEvent::Retry {
                attempt,
                max,
                message,
            } => {
                assert_eq!((*attempt, *max), (3, 10));
                assert!(message.contains("529"), "{message}");
                assert!(message.contains("9.6s"), "{message}");
            }
            other => panic!("expected retry progress, got {other:?}"),
        }
    }

    #[test]
    fn api_retry_without_status_falls_back_to_error_text() {
        let line = serde_json::json!({
            "type": "system",
            "subtype": "api_retry",
            "attempt": 1,
            "max_retries": 10,
            "retry_delay_ms": 1000,
            "error_status": null,
            "error": "unknown"
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Retry { message, .. } => {
                assert!(message.starts_with("API error;"), "{message}")
            }
            other => panic!("expected retry progress, got {other:?}"),
        }
    }

    #[test]
    fn text_block_start_emits_nothing() {
        let line = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 0,
                "content_block": { "type": "text", "text": "" }
            }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert!(out.is_empty());
    }

    #[test]
    fn tool_result_permission_denial_surfaces_path() {
        let line = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "toolu_1",
                    "is_error": true,
                    "content": [{
                        "type": "text",
                        "text": "Claude requested permissions to read from C:\\dev\\frontend, but you haven't granted it yet."
                    }]
                }]
            }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert_eq!(out.len(), 1);
        match &out[0] {
            EngineEvent::PermissionDenied {
                tool,
                path,
                message,
            } => {
                assert_eq!(*tool, None);
                assert_eq!(path.as_deref(), Some(r"C:\dev\frontend"));
                assert!(message.contains("requested permissions"));
            }
            _ => panic!("expected permission denial"),
        }
    }

    #[test]
    fn tool_result_non_error_and_non_denial_stay_silent() {
        for (is_error, text) in [
            (false, "Claude requested permissions to read from /etc, but you haven't granted it yet."),
            (true, "file not found: /tmp/missing.txt"),
        ] {
            let line = serde_json::json!({
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": "toolu_1",
                        "is_error": is_error,
                        "content": text
                    }]
                }
            })
            .to_string();
            let mut out = Vec::new();
            ClaudeEngine::new().parse_line(&line, &mut out);
            assert!(out.is_empty(), "is_error={is_error} text={text}");
        }
    }

    #[test]
    fn result_permission_denials_emit_structured_events() {
        let line = serde_json::json!({
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "session_id": "s-1",
            "permission_denials": [{
                "tool_name": "Read",
                "tool_use_id": "toolu_1",
                "tool_input": { "file_path": "/Users/x/secrets/key.pem" }
            }]
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert_eq!(out.len(), 2);
        match &out[0] {
            EngineEvent::PermissionDenied { tool, path, .. } => {
                assert_eq!(tool.as_deref(), Some("Read"));
                assert_eq!(path.as_deref(), Some("/Users/x/secrets/key.pem"));
            }
            _ => panic!("expected permission denial"),
        }
        assert!(matches!(out[1], EngineEvent::Done { .. }));
    }

    #[test]
    fn extract_absolute_path_handles_windows_and_posix() {
        assert_eq!(
            extract_absolute_path("read from C:\\dev\\proj, but"),
            Some(r"C:\dev\proj".to_string())
        );
        assert_eq!(
            extract_absolute_path("write to \"/etc/hosts\"."),
            Some("/etc/hosts".to_string())
        );
        assert_eq!(extract_absolute_path("no path here"), None);
    }

    fn compact_result_line() -> String {
        serde_json::json!({
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "session_id": "s-1",
            "usage": {
                "input_tokens": 30190,
                "output_tokens": 1200,
                "total_tokens": 31390,
                "model_context_window": 200000
            }
        })
        .to_string()
    }

    #[test]
    fn compact_boundary_emits_usage_and_overrides_turn_result_once() {
        let engine = ClaudeEngine::new();
        let boundary = serde_json::json!({
            "type": "system",
            "subtype": "compact_boundary",
            "compactMetadata": { "preTokens": 30190, "postTokens": 8038, "durationMs": 4207 }
        })
        .to_string();
        let mut out = Vec::new();
        engine.parse_line(&boundary, &mut out);
        assert_eq!(out.len(), 1);
        match &out[0] {
            EngineEvent::Usage(usage) => {
                assert_eq!(usage["input_tokens"], 8038);
                assert_eq!(usage["total_tokens"], 8038);
            }
            _ => panic!("expected usage event"),
        }

        // The following result's billing usage is replaced by the
        // post-compaction occupancy, keeping output and the context window.
        let mut out = Vec::new();
        engine.parse_line(&compact_result_line(), &mut out);
        match &out[0] {
            EngineEvent::Done { usage, .. } => {
                let usage = usage.as_ref().expect("usage");
                assert_eq!(usage["input_tokens"], 8038);
                assert_eq!(usage["output_tokens"], 1200);
                assert_eq!(usage["total_tokens"], 8038 + 1200);
                assert_eq!(usage["model_context_window"], 200000);
            }
            _ => panic!("expected done event"),
        }

        // Single-shot: the next turn without a boundary keeps billing usage.
        let mut out = Vec::new();
        engine.parse_line(&compact_result_line(), &mut out);
        match &out[0] {
            EngineEvent::Done { usage, .. } => {
                assert_eq!(usage.as_ref().expect("usage")["input_tokens"], 30190);
            }
            _ => panic!("expected done event"),
        }
    }

    #[test]
    fn result_without_compact_boundary_keeps_billing_usage() {
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&compact_result_line(), &mut out);
        match &out[0] {
            EngineEvent::Done { usage, .. } => {
                let usage = usage.as_ref().expect("usage");
                assert_eq!(usage["input_tokens"], 30190);
                assert_eq!(usage["total_tokens"], 31390);
            }
            _ => panic!("expected done event"),
        }
    }

    #[test]
    fn compact_boundary_without_metadata_stays_silent() {
        let line = serde_json::json!({
            "type": "system",
            "subtype": "compact_boundary"
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert!(out.is_empty());
    }

    /// The UI's context gauge divided by a hardcoded 200k because nothing
    /// read the window the CLI reports per model. The result line carries it
    /// under `modelUsage`; the model that did the work is the busiest one, so
    /// a cheap subagent's window must not win a mixed turn.
    #[test]
    fn result_reports_the_window_of_the_model_that_did_the_work() {
        let line = serde_json::json!({
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "session_id": "s-1",
            "usage": { "input_tokens": 900000, "output_tokens": 2000, "total_tokens": 902000 },
            "modelUsage": {
                "claude-haiku-4-5": {
                    "inputTokens": 300, "outputTokens": 40, "contextWindow": 200000
                },
                "claude-opus-5[1m]": {
                    "inputTokens": 880000, "outputTokens": 1250, "contextWindow": 1000000
                }
            }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Done { usage, .. } => {
                let usage = usage.as_ref().expect("usage");
                assert_eq!(usage["model_context_window"], 1_000_000);
                // The billing figures stay the CLI's own.
                assert_eq!(usage["input_tokens"], 900000);
            }
            _ => panic!("expected done event"),
        }
    }

    /// Nothing usable reported ⇒ no key at all, so the UI keeps its own
    /// explicit fallback instead of this layer inventing a number.
    #[test]
    fn result_without_a_reported_window_adds_nothing() {
        for models in [None, Some(serde_json::json!({})), Some(serde_json::json!({
            "m": { "inputTokens": 10, "contextWindow": 0 }
        }))] {
            let mut value = serde_json::json!({
                "type": "result",
                "subtype": "success",
                "is_error": false,
                "session_id": "s-1",
                "usage": { "input_tokens": 10, "output_tokens": 1, "total_tokens": 11 }
            });
            if let Some(models) = models {
                value["modelUsage"] = models;
            }
            let mut out = Vec::new();
            ClaudeEngine::new().parse_line(&value.to_string(), &mut out);
            match &out[0] {
                EngineEvent::Done { usage, .. } => {
                    assert!(usage.as_ref().expect("usage").get("model_context_window").is_none());
                }
                _ => panic!("expected done event"),
            }
        }
    }

    /// An explicitly reported window is the more specific statement and must
    /// survive the per-model map.
    #[test]
    fn explicit_context_window_beats_the_model_map() {
        let line = serde_json::json!({
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "session_id": "s-1",
            "usage": {
                "input_tokens": 10, "output_tokens": 1, "total_tokens": 11,
                "model_context_window": 500000
            },
            "modelUsage": { "m": { "inputTokens": 10, "contextWindow": 200000 } }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Done { usage, .. } => {
                assert_eq!(usage.as_ref().expect("usage")["model_context_window"], 500000);
            }
            _ => panic!("expected done event"),
        }
    }

    /// A compacted turn's usage is rebuilt from the boundary, so the window
    /// has to be re-attached there too — that path dropped it before.
    #[test]
    fn compacted_turn_keeps_the_reported_window() {
        let engine = ClaudeEngine::new();
        let boundary = serde_json::json!({
            "type": "system",
            "subtype": "compact_boundary",
            "compactMetadata": { "preTokens": 900000, "postTokens": 40000, "durationMs": 1000 }
        })
        .to_string();
        let mut out = Vec::new();
        engine.parse_line(&boundary, &mut out);

        let result = serde_json::json!({
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "session_id": "s-1",
            "usage": { "input_tokens": 900000, "output_tokens": 50, "total_tokens": 900050 },
            "modelUsage": { "claude-opus-5[1m]": { "inputTokens": 900000, "contextWindow": 1000000 } }
        })
        .to_string();
        let mut out = Vec::new();
        engine.parse_line(&result, &mut out);
        match &out[0] {
            EngineEvent::Done { usage, .. } => {
                let usage = usage.as_ref().expect("usage");
                assert_eq!(usage["input_tokens"], 40000);
                assert_eq!(usage["model_context_window"], 1_000_000);
            }
            _ => panic!("expected done event"),
        }
    }
}
