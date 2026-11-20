//! Live per-run activity facts for the run-status "what is happening now"
//! panel.
//!
//! The streamed events already tell the UI *what* the model produced; they do
//! not tell it *when the CLI last said anything*, whether a response stream is
//! open with nothing visible yet (a thinking block with omitted display), or
//! why a retry happened. This module records those facts as a side effect of
//! the reader's own dispatch, and the frontend pulls a snapshot through
//! `run_activity` — once a second, and only while the panel is open — so the
//! hot streaming path gains a map lookup per event and no extra IPC traffic.
//!
//! Entries are keyed by run id, created on first observation and dropped
//! when the run's reader context goes away ([`end`]). A hard cap evicts the
//! least recently touched entry, so a leaked run can never grow the map.

use super::events::EngineEvent;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

const MAX_RUNS: usize = 128;
const MAX_RETRIES: usize = 20;
const MAX_TOOLS: usize = 32;
const MAX_DETAIL_CHARS: usize = 160;
const MAX_MESSAGE_CHARS: usize = 400;

static RUNS: LazyLock<Mutex<HashMap<String, RunActivity>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// A tool call the engine announced and has not reported a result for yet.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolActivity {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub since_ms: i64,
    /// Short human hint from the arguments (command, description, path).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// One provider retry the CLI announced during this run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryActivity {
    pub at_ms: i64,
    pub attempt: u64,
    pub max: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    /// network | rate_limit | overloaded | server | auth | client | unknown
    pub category: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunActivity {
    pub run_id: String,
    pub engine: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub started_at_ms: i64,
    /// Last raw line the CLI wrote to stdout, parsed or not (process engines
    /// only; host-transport engines leave it unset).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_output_at_ms: Option<i64>,
    /// Last engine event the host understood, and its coarse kind.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_event_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_event: Option<&'static str>,
    /// A model response stream is open (engine-reported start marker).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_since_ms: Option<i64>,
    /// First content of the open response arrived (delta/thinking/block).
    pub response_has_output: bool,
    /// Content block of the open response: thinking | text | tool_input | other.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_since_ms: Option<i64>,
    pub tools: Vec<ToolActivity>,
    pub retries: Vec<RetryActivity>,
    /// Inside a provider-retry backoff right now.
    pub retrying: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compacting_since_ms: Option<i64>,
    /// A question card is waiting for the user's answer.
    pub awaiting_user: bool,
    /// Background tasks the CLI reported as still running.
    pub background_tasks: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_warn: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_warn_at_ms: Option<i64>,
    /// Snapshot time on the host clock, so elapsed values need no second
    /// clock on the consumer side.
    pub now_ms: i64,
    #[serde(skip)]
    touched_ms: i64,
}

impl RunActivity {
    fn new(run_id: &str, engine: &str, now: i64) -> Self {
        Self {
            run_id: run_id.to_string(),
            engine: engine.to_string(),
            pid: None,
            started_at_ms: now,
            last_output_at_ms: None,
            last_event_at_ms: None,
            last_event: None,
            response_since_ms: None,
            response_has_output: false,
            block: None,
            block_since_ms: None,
            tools: Vec::new(),
            retries: Vec::new(),
            retrying: false,
            compacting_since_ms: None,
            awaiting_user: false,
            background_tasks: 0,
            last_warn: None,
            last_warn_at_ms: None,
            now_ms: now,
            touched_ms: now,
        }
    }

    fn event(&mut self, kind: &'static str, now: i64) {
        self.last_event = Some(kind);
        self.last_event_at_ms = Some(now);
    }

    fn content(&mut self, kind: &'static str, now: i64) {
        self.event(kind, now);
        self.response_has_output = true;
        // A content event means the re-issued request succeeded.
        self.retrying = false;
    }

    /// Apply one engine event. Kept free of the global lock so it is unit
    /// testable on a plain value.
    fn apply(&mut self, event: &EngineEvent, now: i64) {
        self.touched_ms = now;
        match event {
            EngineEvent::Delta(_) => {
                self.content("text", now);
            }
            EngineEvent::Thinking(_) => {
                self.content("thinking", now);
            }
            EngineEvent::Generation { active: true } => {
                self.response_since_ms = Some(now);
                self.response_has_output = false;
                self.block = None;
                self.block_since_ms = None;
                self.event("response_start", now);
            }
            EngineEvent::Generation { active: false } => {
                self.response_since_ms = None;
                self.block = None;
                self.block_since_ms = None;
                self.event("response_end", now);
            }
            EngineEvent::Block { kind: Some(kind) } => {
                self.block = Some(kind);
                self.block_since_ms = Some(now);
                self.content("block", now);
            }
            EngineEvent::Block { kind: None } => {
                self.block = None;
                self.block_since_ms = None;
                self.event("block_end", now);
            }
            EngineEvent::Message {
                role,
                text,
                args,
                result,
                patch,
                tool_call_id,
                ..
            } => {
                if role == "tool" {
                    if result.is_some() {
                        self.finish_tool(tool_call_id.as_deref(), text);
                        self.content("tool_result", now);
                    } else if *patch {
                        self.patch_tool(tool_call_id.as_deref(), text, args.as_ref());
                        self.content("tool_call", now);
                    } else {
                        self.start_tool(tool_call_id.as_deref(), text, args.as_ref(), now);
                        self.content("tool_call", now);
                    }
                } else {
                    self.content("message", now);
                }
            }
            EngineEvent::Usage(_) => self.event("usage", now),
            EngineEvent::Retry {
                attempt,
                max,
                message,
            } => {
                self.event("retry", now);
                if *attempt == 0 {
                    self.retrying = false;
                    return;
                }
                self.retrying = true;
                // The response that failed is over; the next one opens anew.
                self.response_since_ms = None;
                self.block = None;
                self.block_since_ms = None;
                let (status, category) = classify_retry(message);
                self.retries.push(RetryActivity {
                    at_ms: now,
                    attempt: *attempt,
                    max: *max,
                    status,
                    category,
                    message: truncate(message, MAX_MESSAGE_CHARS),
                });
                if self.retries.len() > MAX_RETRIES {
                    let excess = self.retries.len() - MAX_RETRIES;
                    self.retries.drain(..excess);
                }
            }
            EngineEvent::Warn(message) => {
                self.event("warn", now);
                self.last_warn = Some(truncate(message, MAX_MESSAGE_CHARS));
                self.last_warn_at_ms = Some(now);
            }
            EngineEvent::Compaction { active, .. } => {
                self.event("compaction", now);
                self.compacting_since_ms = if *active { Some(now) } else { None };
            }
            EngineEvent::Question { .. } => {
                self.event("question", now);
                self.awaiting_user = true;
            }
            EngineEvent::QuestionSettled { .. } => {
                self.event("question_settled", now);
                self.awaiting_user = false;
            }
            EngineEvent::BackgroundTasks { pending } => {
                self.background_tasks = *pending;
            }
            EngineEvent::Done { .. } => {
                self.event("done", now);
                self.response_since_ms = None;
                self.block = None;
                self.block_since_ms = None;
                self.retrying = false;
                self.compacting_since_ms = None;
                self.awaiting_user = false;
                self.tools.clear();
            }
            EngineEvent::Error(_) => {
                self.event("error", now);
                self.retrying = false;
            }
            // Session bookkeeping, model reports, plan/permission frames:
            // the CLI spoke, but none of it changes what the run is doing.
            _ => self.event("other", now),
        }
    }

    fn start_tool(&mut self, id: Option<&str>, name: &str, args: Option<&Value>, now: i64) {
        if let Some(id) = id {
            if let Some(tool) = self.tools.iter_mut().find(|t| t.id.as_deref() == Some(id)) {
                if let Some(detail) = args.and_then(tool_detail) {
                    tool.detail = Some(detail);
                }
                return;
            }
        }
        self.tools.push(ToolActivity {
            id: id.map(str::to_string),
            name: name.to_string(),
            since_ms: now,
            detail: args.and_then(tool_detail),
        });
        if self.tools.len() > MAX_TOOLS {
            self.tools.remove(0);
        }
    }

    fn patch_tool(&mut self, id: Option<&str>, name: &str, args: Option<&Value>) {
        let Some(detail) = args.and_then(tool_detail) else {
            return;
        };
        if let Some(tool) = self.find_tool(id, name) {
            self.tools[tool].detail = Some(detail);
        }
    }

    fn finish_tool(&mut self, id: Option<&str>, name: &str) {
        if let Some(tool) = self.find_tool(id, name) {
            self.tools.remove(tool);
        }
    }

    /// The call this event settles: by the engine's id when it reports one,
    /// else the oldest open call of the same name (the frontend's own
    /// pairing rule for id-less engines).
    fn find_tool(&self, id: Option<&str>, name: &str) -> Option<usize> {
        if let Some(id) = id {
            if let Some(index) = self.tools.iter().position(|t| t.id.as_deref() == Some(id)) {
                return Some(index);
            }
        }
        self.tools.iter().position(|t| t.name == name)
    }
}

fn truncate(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max).collect();
    out.push('…');
    out
}

/// One-line hint from a tool's arguments: what the user would want to know
/// about a long-running call (which command, which subagent task, which file).
fn tool_detail(args: &Value) -> Option<String> {
    let obj = args.as_object()?;
    for key in [
        "description",
        "command",
        "cmd",
        "prompt",
        "file_path",
        "path",
        "filePath",
        "pattern",
        "query",
        "url",
    ] {
        if let Some(text) = obj.get(key).and_then(Value::as_str) {
            if let Some(line) = text.lines().map(str::trim).find(|l| !l.is_empty()) {
                return Some(truncate(line, MAX_DETAIL_CHARS));
            }
        }
        if let Some(parts) = obj.get(key).and_then(Value::as_array) {
            let joined = parts
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" ");
            if !joined.trim().is_empty() {
                return Some(truncate(&joined, MAX_DETAIL_CHARS));
            }
        }
    }
    None
}

/// Classify a provider retry from the CLI's own wording into the question
/// the user actually asks: is it my network, or is the service struggling?
/// Every engine words its retry differently (claude `API error (HTTP 529:
/// overloaded_error)`, codex `Reconnecting... 1/5 (stream disconnected …)`,
/// omp / opencode provider messages), so this reads the text rather than a
/// per-engine field. An HTTP status always wins over keywords: a status means
/// the request reached the service.
pub(crate) fn classify_retry(message: &str) -> (Option<u16>, &'static str) {
    static STATUS: LazyLock<Option<regex::Regex>> = LazyLock::new(|| {
        regex::Regex::new(r"(?i)\b(?:http|status(?:\s*code)?)[\s:=(]*([1-5]\d\d)\b").ok()
    });
    let status = STATUS
        .as_ref()
        .and_then(|re| re.captures(message))
        .and_then(|caps| caps.get(1))
        .and_then(|m| m.as_str().parse::<u16>().ok());
    if let Some(code) = status {
        let category = match code {
            429 => "rate_limit",
            529 => "overloaded",
            401 | 403 => "auth",
            500..=599 => {
                if contains_any(&message.to_lowercase(), &["overloaded"]) {
                    "overloaded"
                } else {
                    "server"
                }
            }
            _ => "client",
        };
        return (Some(code), category);
    }
    let lower = message.to_lowercase();
    let category = if contains_any(&lower, &["overloaded"]) {
        "overloaded"
    } else if contains_any(&lower, &["rate limit", "rate_limit", "too many requests", "quota"]) {
        "rate_limit"
    } else if contains_any(
        &lower,
        &["unauthorized", "authentication", "invalid api key", "invalid x-api-key", "forbidden"],
    ) {
        "auth"
    } else if contains_any(
        &lower,
        &[
            "internal server error",
            "api_error",
            "server error",
            "bad gateway",
            "service unavailable",
            "gateway timeout",
        ],
    ) {
        "server"
    } else if contains_any(
        &lower,
        &[
            "econnreset",
            "econnrefused",
            "etimedout",
            "enotfound",
            "eai_again",
            "enetunreach",
            "socket",
            "network",
            "connection",
            "disconnected",
            "timed out",
            "timeout",
            "fetch failed",
            "tls",
            "certificate",
            "dns",
            "stream",
            "reconnecting",
        ],
    ) {
        "network"
    } else {
        "unknown"
    };
    (None, category)
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

fn with_entry(run_id: &str, engine: &str, now: i64, f: impl FnOnce(&mut RunActivity)) {
    let Ok(mut runs) = RUNS.lock() else {
        return;
    };
    if let Some(entry) = runs.get_mut(run_id) {
        f(entry);
        return;
    }
    if runs.len() >= MAX_RUNS {
        if let Some(oldest) = runs
            .iter()
            .min_by_key(|(_, entry)| entry.touched_ms)
            .map(|(key, _)| key.clone())
        {
            runs.remove(&oldest);
        }
    }
    let mut entry = RunActivity::new(run_id, engine, now);
    f(&mut entry);
    runs.insert(run_id.to_string(), entry);
}

/// A process run started: record its pid (shown in the panel so the user can
/// find the CLI in their own process tools).
pub(crate) fn begin(run_id: &str, engine: &str, pid: u32) {
    let now = now_ms();
    with_entry(run_id, engine, now, |entry| {
        entry.pid = Some(pid);
        entry.touched_ms = now;
    });
}

/// The CLI wrote a stdout line (parsed or not).
pub(crate) fn output(run_id: &str, engine: &str) {
    let now = now_ms();
    with_entry(run_id, engine, now, |entry| {
        entry.last_output_at_ms = Some(now);
        entry.touched_ms = now;
    });
}

/// The reader dispatched an engine event for this run.
pub(crate) fn observe(run_id: &str, engine: &str, event: &EngineEvent) {
    let now = now_ms();
    with_entry(run_id, engine, now, |entry| entry.apply(event, now));
}

/// The run's reader context is gone: nothing will update this entry again.
pub(crate) fn end(run_id: &str) {
    if let Ok(mut runs) = RUNS.lock() {
        runs.remove(run_id);
    }
}

/// Snapshots of the runs among `run_ids` the host still tracks.
pub(crate) fn snapshot(run_ids: &[String]) -> Vec<RunActivity> {
    let now = now_ms();
    let Ok(runs) = RUNS.lock() else {
        return Vec::new();
    };
    run_ids
        .iter()
        .filter_map(|id| runs.get(id))
        .map(|entry| {
            let mut copy = entry.clone();
            copy.now_ms = now;
            copy
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::events::{tool_call_message_with_id, tool_call_patch_with_id, tool_result_patch_with_id};
    use serde_json::json;

    #[test]
    fn retry_classification_separates_network_from_service() {
        assert_eq!(classify_retry("API error (HTTP 529: overloaded_error); retrying (3/10) in 32.0s"), (Some(529), "overloaded"));
        assert_eq!(classify_retry("API error (HTTP 429); retrying (1/10) in 1.0s"), (Some(429), "rate_limit"));
        assert_eq!(classify_retry("API error (HTTP 502)"), (Some(502), "server"));
        assert_eq!(classify_retry("API error (HTTP 503: overloaded)"), (Some(503), "overloaded"));
        assert_eq!(classify_retry("API error (HTTP 401: authentication_error)"), (Some(401), "auth"));
        assert_eq!(classify_retry("API error: Connection error.; retrying (2/10) in 2.0s"), (None, "network"));
        assert_eq!(classify_retry("stream disconnected before completion: error sending request"), (None, "network"));
        assert_eq!(classify_retry("read ECONNRESET"), (None, "network"));
        assert_eq!(classify_retry("Request timed out"), (None, "network"));
        assert_eq!(classify_retry("Overloaded"), (None, "overloaded"));
        assert_eq!(classify_retry("rate limit exceeded"), (None, "rate_limit"));
        assert_eq!(classify_retry("Internal server error"), (None, "server"));
        assert_eq!(classify_retry(""), (None, "unknown"));
        // A bare number that is not a status must not be read as one.
        assert_eq!(classify_retry("retrying (500 ms)").0, None);
    }

    #[test]
    fn response_and_block_markers_track_silent_thinking() {
        let mut a = RunActivity::new("r", "claude", 0);
        a.apply(&EngineEvent::Generation { active: true }, 10);
        assert_eq!(a.response_since_ms, Some(10));
        assert!(!a.response_has_output, "an open response with nothing in it yet");
        a.apply(&EngineEvent::Block { kind: Some("thinking") }, 20);
        assert_eq!(a.block, Some("thinking"));
        assert_eq!(a.block_since_ms, Some(20));
        assert!(a.response_has_output);
        a.apply(&EngineEvent::Block { kind: None }, 30);
        assert_eq!(a.block, None);
        a.apply(&EngineEvent::Generation { active: false }, 40);
        assert_eq!(a.response_since_ms, None);
        assert_eq!(a.last_event, Some("response_end"));
        assert_eq!(a.last_event_at_ms, Some(40));
    }

    #[test]
    fn tools_open_on_call_get_detail_on_patch_and_close_on_result() {
        let mut a = RunActivity::new("r", "claude", 0);
        a.apply(&tool_call_message_with_id("Bash", Some(&json!({})), Some("t1")), 5);
        assert_eq!(a.tools.len(), 1);
        assert_eq!(a.tools[0].detail, None);
        a.apply(
            &tool_call_patch_with_id("Bash", Some(&json!({"command": "pnpm build\n--verbose"})), Some("t1")),
            6,
        );
        assert_eq!(a.tools[0].detail.as_deref(), Some("pnpm build"));
        assert_eq!(a.tools[0].since_ms, 5, "the call's start time survives its arg patch");
        a.apply(&tool_call_message_with_id("Read", Some(&json!({"file_path": "/a"})), Some("t2")), 7);
        a.apply(&tool_result_patch_with_id("Bash", Some(&json!("ok")), Some("t1")), 9);
        assert_eq!(a.tools.len(), 1);
        assert_eq!(a.tools[0].name, "Read");
        assert_eq!(a.last_event, Some("tool_result"));
    }

    #[test]
    fn retries_are_recorded_and_content_ends_the_backoff() {
        let mut a = RunActivity::new("r", "claude", 0);
        a.apply(&EngineEvent::Generation { active: true }, 1);
        a.apply(
            &EngineEvent::Retry { attempt: 2, max: 10, message: "API error (HTTP 529)".into() },
            2,
        );
        assert!(a.retrying);
        assert_eq!(a.response_since_ms, None, "the failed response is over");
        assert_eq!(a.retries.len(), 1);
        assert_eq!(a.retries[0].category, "overloaded");
        assert_eq!(a.retries[0].status, Some(529));
        a.apply(&EngineEvent::Delta("hi".into()), 3);
        assert!(!a.retrying);
        assert_eq!(a.retries.len(), 1, "history outlives the backoff");
        for attempt in 1..=30 {
            a.apply(&EngineEvent::Retry { attempt, max: 0, message: "socket".into() }, 4);
        }
        assert_eq!(a.retries.len(), MAX_RETRIES);
        assert_eq!(a.retries.last().map(|r| r.attempt), Some(30));
    }

    #[test]
    fn global_map_lifecycle_and_snapshot() {
        let id = "activity-test-run-lifecycle";
        begin(id, "claude", 4242);
        output(id, "claude");
        observe(id, "claude", &EngineEvent::Delta("x".into()));
        let snap = snapshot(&[id.to_string(), "activity-test-missing".to_string()]);
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].pid, Some(4242));
        assert!(snap[0].last_output_at_ms.is_some());
        assert_eq!(snap[0].last_event, Some("text"));
        let wire = serde_json::to_value(&snap[0]).unwrap();
        assert!(wire.get("lastOutputAtMs").is_some(), "camelCase wire shape");
        assert!(wire.get("touchedMs").is_none(), "internal field stays private");
        end(id);
        assert!(snapshot(&[id.to_string()]).is_empty());
    }
}
