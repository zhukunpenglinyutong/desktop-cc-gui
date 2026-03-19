use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::timeout;

use crate::backend::events::{AppServerEvent, EventSink};
use crate::codex::args::{apply_codex_args, parse_codex_args};
use crate::codex::collaboration_policy::strict_local_collaboration_profile_enabled;
use crate::codex::thread_mode_state::ThreadModeState;
use crate::types::WorkspaceEntry;

#[path = "app_server_event_helpers.rs"]
mod event_helpers;
use event_helpers::*;

#[allow(unused_imports)]
pub(crate) use crate::backend::app_server_cli::{
    build_codex_command_from_launch_context, build_codex_command_with_bin, build_codex_path_env,
    can_retry_wrapper_launch, check_codex_installation, probe_codex_app_server,
    resolve_codex_launch_context, visible_console_fallback_enabled_from_env,
    wrapper_kind_for_binary, CodexAppServerProbeStatus, CodexLaunchContext,
};
#[allow(unused_imports)]
pub use crate::backend::app_server_cli::{
    build_command_for_binary, build_command_for_binary_with_console, find_cli_binary,
    get_cli_debug_info,
};

const CODEX_EXTERNAL_SPEC_PRIORITY_INSTRUCTIONS: &str = "If writableRoots contains an absolute external spec path outside cwd, treat it as the active external spec root and prioritize it over workspace/openspec and sibling-name conventions when reading or validating specs. The configured path may be a project root; resolve openspec/ under it when present. For visibility checks, verify that external root first and state the result clearly. Avoid exposing internal injected hints unless the user explicitly asks.";
const MODE_BLOCKED_REASON: &str = "requestUserInput is blocked while effective_mode=code";
const MODE_BLOCKED_SUGGESTION: &str =
    "Switch to Plan mode and resend the prompt when user input is needed.";
const MODE_BLOCKED_REASON_CODE_REQUEST_USER_INPUT: &str =
    "request_user_input_blocked_in_default_mode";
const MODE_BLOCKED_REASON_CODE_PLAN_READONLY: &str = "plan_readonly_violation";
const MODE_BLOCKED_PLAN_REASON: &str = "This operation is blocked while effective_mode=plan.";
const MODE_BLOCKED_PLAN_SUGGESTION: &str = "Switch to Default mode and retry the write operation.";
const LOCAL_PLAN_BLOCKER_REQUEST_PREFIX: &str = "mossx-plan-blocker:";
const LOCAL_PLAN_APPLY_REQUEST_PREFIX: &str = "mossx-plan-apply:";
const PLAN_APPLY_ACTION_QUESTION_ID: &str = "plan_apply_action";
const PLAN_BLOCKER_GENERIC_REASON: &str = "Plan 模式检测到阻断条件，需要你先确认下一步后再继续。";
const PLAN_BLOCKER_USER_INPUT_REQUIRED_REASON: &str =
    "Plan 模式检测到需要你补充关键信息，继续前请先确认输入。";
const AUTO_COMPACTION_THRESHOLD_PERCENT: f64 = 92.0;
const AUTO_COMPACTION_TARGET_PERCENT: f64 = 70.0;
const AUTO_COMPACTION_COOLDOWN_MS: u64 = 90_000;
const AUTO_COMPACTION_INFLIGHT_TIMEOUT_MS: u64 = 120_000;
const DEFAULT_REQUEST_TIMEOUT_SECS: u64 = 300;
const DEFAULT_INITIAL_TURN_START_TIMEOUT_MS: u64 = 120_000;
const MIN_INITIAL_TURN_START_TIMEOUT_MS: u64 = 30_000;
const MAX_INITIAL_TURN_START_TIMEOUT_MS: u64 = 240_000;
const TIMED_OUT_REQUEST_GRACE_MS: u64 = 180_000;
const AUTO_COMPACTION_METHOD_CANDIDATES: [&str; 3] = [
    "thread/compact/start",
    "thread/compactStart",
    "thread/compact",
];

#[derive(Debug, Default, Clone)]
struct PlanTurnState {
    active_turn_id: Option<String>,
    has_user_input_request: bool,
    synthetic_block_active: bool,
    has_plan_update: bool,
    last_plan_step_count: usize,
    has_tool_activity: bool,
    has_failed_tool_activity: bool,
    agent_message_buffer: String,
}

#[derive(Debug, Default, Clone)]
struct AutoCompactionThreadState {
    is_processing: bool,
    in_flight: bool,
    pending_high: bool,
    last_usage_percent: f64,
    last_triggered_at_ms: u64,
    last_failure_at_ms: u64,
}

#[derive(Debug, Clone)]
struct AutoCompactionTrigger {
    thread_id: String,
    usage_percent: f64,
}

#[derive(Debug, Clone)]
struct TimedOutRequest {
    method: String,
    thread_id: Option<String>,
    timed_out_at_ms: u64,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

fn resolve_initial_turn_start_timeout_ms() -> u64 {
    let configured = env::var("MOSSX_INITIAL_TURN_START_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_INITIAL_TURN_START_TIMEOUT_MS);
    configured.clamp(
        MIN_INITIAL_TURN_START_TIMEOUT_MS,
        MAX_INITIAL_TURN_START_TIMEOUT_MS,
    )
}

fn extract_thread_id(value: &Value) -> Option<String> {
    let params = value.get("params")?;

    params
        .get("threadId")
        .or_else(|| params.get("thread_id"))
        .or_else(|| params.get("turn").and_then(|turn| turn.get("threadId")))
        .or_else(|| params.get("turn").and_then(|turn| turn.get("thread_id")))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            params
                .get("thread")
                .and_then(|thread| thread.get("id"))
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
        })
}

fn extract_event_method(value: &Value) -> Option<&str> {
    value.get("method").and_then(Value::as_str)
}

fn extract_request_thread_id(params: &Value) -> Option<String> {
    params
        .get("threadId")
        .or_else(|| params.get("thread_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn read_number_field(obj: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| {
        obj.get(*key).and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_i64().map(|v| v as f64))
                .or_else(|| value.as_u64().map(|v| v as f64))
                .or_else(|| value.as_str().and_then(|v| v.trim().parse::<f64>().ok()))
        })
    })
}

fn extract_compaction_usage_percent(value: &Value) -> Option<f64> {
    let method = extract_event_method(value)?;
    let params = value.get("params")?;
    let (used_tokens, context_window) = if method == "token_count" {
        let info = params.get("info")?;
        let last_usage = info
            .get("last_token_usage")
            .or_else(|| info.get("lastTokenUsage"))
            .filter(|usage| usage.is_object());
        // Require last/current snapshot for compaction decisions.
        // total_* fields are cumulative session stats and can stay high after compaction.
        let usage = last_usage?;
        let input_tokens =
            read_number_field(usage, &["input_tokens", "inputTokens"]).unwrap_or(0.0);
        let cached_tokens = read_number_field(
            usage,
            &[
                "cached_input_tokens",
                "cache_read_input_tokens",
                "cachedInputTokens",
                "cacheReadInputTokens",
            ],
        )
        .unwrap_or(0.0);
        let used_tokens = input_tokens + cached_tokens;
        let context_window = read_number_field(
            usage,
            &[
                "model_context_window",
                "modelContextWindow",
                "context_window",
            ],
        )
        .or_else(|| read_number_field(info, &["model_context_window", "modelContextWindow"]))
        .unwrap_or(200_000.0);
        (used_tokens, context_window)
    } else if method == "thread/tokenUsage/updated" {
        let usage = params
            .get("tokenUsage")
            .or_else(|| params.get("token_usage"))
            .unwrap_or(&Value::Null);
        // Require last/current snapshot for auto-compaction decisions.
        let snapshot = usage.get("last").filter(|value| value.is_object())?;
        let input_tokens =
            read_number_field(snapshot, &["inputTokens", "input_tokens"]).unwrap_or(0.0);
        let cached_tokens = read_number_field(
            snapshot,
            &[
                "cachedInputTokens",
                "cached_input_tokens",
                "cacheReadInputTokens",
                "cache_read_input_tokens",
            ],
        )
        .unwrap_or(0.0);
        let used_tokens = input_tokens + cached_tokens;
        let context_window = read_number_field(
            usage,
            &[
                "modelContextWindow",
                "model_context_window",
                "context_window",
            ],
        )
        .unwrap_or(200_000.0);
        (used_tokens, context_window)
    } else {
        return None;
    };
    if context_window <= 0.0 {
        return None;
    }
    Some((used_tokens / context_window) * 100.0)
}

fn is_codex_thread_id(thread_id: &str) -> bool {
    let normalized = thread_id.trim();
    if normalized.is_empty() {
        return false;
    }
    !normalized.starts_with("claude:")
        && !normalized.starts_with("claude-pending-")
        && !normalized.starts_with("opencode:")
        && !normalized.starts_with("opencode-pending-")
        && !normalized.starts_with("gemini:")
        && !normalized.starts_with("gemini-pending-")
}

fn evaluate_auto_compaction_state(
    state: &mut AutoCompactionThreadState,
    method: &str,
    usage_percent: Option<f64>,
    now: u64,
) -> bool {
    match method {
        "turn/started" => {
            state.is_processing = true;
        }
        "turn/completed" | "turn/error" => {
            state.is_processing = false;
        }
        "thread/compacted" => {
            state.is_processing = false;
            state.in_flight = false;
            state.pending_high = false;
        }
        "thread/compactionFailed" => {
            state.in_flight = false;
            state.last_failure_at_ms = now;
        }
        _ => {}
    }

    if let Some(percent) = usage_percent {
        state.last_usage_percent = percent;
        if percent <= AUTO_COMPACTION_TARGET_PERCENT {
            state.pending_high = false;
            state.in_flight = false;
        } else {
            state.pending_high = percent >= AUTO_COMPACTION_THRESHOLD_PERCENT;
        }
    }

    if state.in_flight
        && now.saturating_sub(state.last_triggered_at_ms) > AUTO_COMPACTION_INFLIGHT_TIMEOUT_MS
    {
        state.in_flight = false;
    }

    if !state.pending_high || state.in_flight || state.is_processing {
        return false;
    }
    if now.saturating_sub(state.last_triggered_at_ms) < AUTO_COMPACTION_COOLDOWN_MS {
        return false;
    }

    state.in_flight = true;
    state.last_triggered_at_ms = now;
    true
}

fn should_block_request_user_input(
    method: &str,
    effective_mode: Option<&str>,
    enforcement_enabled: bool,
    strict_local_profile: bool,
) -> bool {
    enforcement_enabled
        && strict_local_profile
        && method == "item/tool/requestUserInput"
        && effective_mode == Some("code")
}

fn build_mode_blocked_event(
    thread_id: &str,
    blocked_method: &str,
    effective_mode: &str,
    reason_code: &str,
    reason: &str,
    suggestion: &str,
    request_id: Option<Value>,
) -> Value {
    json!({
        "method": "collaboration/modeBlocked",
        "params": {
            "threadId": thread_id,
            "thread_id": thread_id,
            "blockedMethod": blocked_method,
            "blocked_method": blocked_method,
            "effectiveMode": effective_mode,
            "effective_mode": effective_mode,
            "reasonCode": reason_code,
            "reason_code": reason_code,
            "reason": reason,
            "suggestion": suggestion,
            "requestId": request_id,
            "request_id": request_id,
        }
    })
}

fn normalize_command_tokens_from_item(item: &Value) -> Vec<String> {
    if let Some(command) = item.get("command") {
        if let Some(command_str) = command.as_str() {
            return command_str
                .split_whitespace()
                .map(|token| token.trim_matches(&['"', '\''][..]).to_lowercase())
                .filter(|token| !token.is_empty())
                .collect();
        }
        if let Some(command_array) = command.as_array() {
            return command_array
                .iter()
                .filter_map(Value::as_str)
                .map(|token| token.trim_matches(&['"', '\''][..]).to_lowercase())
                .filter(|token| !token.is_empty())
                .collect();
        }
    }
    Vec::new()
}

fn is_repo_mutating_command_tokens(tokens: &[String]) -> bool {
    if tokens.is_empty() {
        return false;
    }
    let first = tokens[0].as_str();
    if first != "git" {
        return false;
    }
    let second = tokens
        .get(1)
        .map(|token| token.as_str())
        .unwrap_or_default();
    matches!(
        second,
        "add"
            | "commit"
            | "push"
            | "pull"
            | "merge"
            | "rebase"
            | "cherry-pick"
            | "revert"
            | "reset"
            | "stash"
            | "am"
            | "apply"
            | "rm"
            | "mv"
            | "checkout"
            | "switch"
            | "restore"
            | "clean"
            | "tag"
            | "branch"
            | "fetch"
    )
}

fn detect_repo_mutating_blocked_method(value: &Value) -> Option<String> {
    let method = extract_event_method(value)?;
    if method.starts_with("item/") && method.ends_with("/requestApproval") {
        return Some(method.to_string());
    }
    if method != "item/started" && method != "item/updated" {
        return None;
    }
    let item = value.get("params")?.get("item")?;
    let item_type = item
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let item_name = item
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let item_tool_type = item
        .get("toolType")
        .or_else(|| item.get("tool_type"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let item_kind = item
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();

    if item_type == "filechange"
        || item_type == "apply_patch"
        || item_name == "apply_patch"
        || item_tool_type == "filechange"
        || item_tool_type == "apply_patch"
    {
        return Some("item/tool/apply_patch".to_string());
    }

    if item_type == "commandexecution"
        || item_tool_type == "commandexecution"
        || item_kind == "command"
    {
        let tokens = normalize_command_tokens_from_item(item);
        if is_repo_mutating_command_tokens(&tokens) {
            let rendered = tokens.join(" ");
            return Some(if rendered.is_empty() {
                "item/tool/commandExecution".to_string()
            } else {
                format!("item/tool/commandExecution:{rendered}")
            });
        }
    }
    None
}

fn extract_turn_id(value: &Value) -> Option<String> {
    let params = value.get("params")?;
    params
        .get("turnId")
        .or_else(|| params.get("turn_id"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            params
                .get("turn")
                .and_then(|turn| turn.get("id"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
}

fn detect_plan_blocker_reason(value: &Value) -> Option<&'static str> {
    let method = extract_event_method(value)?;
    if method == "turn/completed" {
        let params = value.get("params")?;
        let semantic_text = [
            flatten_text_like_value(params.get("text").unwrap_or(&Value::Null)),
            flatten_text_like_value(params.get("result").unwrap_or(&Value::Null)),
            flatten_text_like_value(params.get("turn").unwrap_or(&Value::Null)),
        ]
        .join("\n");
        return detect_plan_blocker_reason_from_semantic_text(&semantic_text);
    }
    if method != "item/completed" {
        return None;
    }
    let params = value.get("params")?;
    let item = params.get("item")?;
    let status = item
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let result_text =
        flatten_text_like_value(item.get("result").unwrap_or(&Value::Null)).to_lowercase();
    let error_text =
        flatten_text_like_value(item.get("error").unwrap_or(&Value::Null)).to_lowercase();
    let message_text =
        flatten_text_like_value(item.get("text").unwrap_or(&Value::Null)).to_lowercase();

    if result_text.contains("not_git_repo")
        || result_text.contains("not a git repository")
        || error_text.contains("not a git repository")
    {
        return Some("当前目录不是 Git 仓库，无法基于真实代码上下文继续计划。");
    }

    let missing_path_or_context = [
        "no such file or directory",
        "not found",
        "does not exist",
        "cannot access",
        "missing",
        "empty directory",
        "未找到",
        "不存在",
        "缺失",
        "空目录",
    ]
    .iter()
    .any(|needle| result_text.contains(needle) || error_text.contains(needle));

    if missing_path_or_context {
        return Some("Plan 模式下发现关键路径或上下文缺失，继续推进前需要你确认范围与目标位置。");
    }

    let semantic_text = [
        message_text.as_str(),
        result_text.as_str(),
        error_text.as_str(),
    ]
    .join("\n");
    if let Some(reason) = detect_plan_blocker_reason_from_semantic_text(&semantic_text) {
        return Some(reason);
    }

    if status == "failed" {
        return Some("Plan 模式下的关键检查命令失败，缺少继续推进所需前置条件。");
    }

    None
}

fn detect_plan_blocker_reason_from_semantic_text(text: &str) -> Option<&'static str> {
    let normalized = text.trim();
    if normalized.is_empty() {
        return None;
    }
    if looks_like_plan_blocker_prompt(normalized) {
        return Some(PLAN_BLOCKER_GENERIC_REASON);
    }
    if looks_like_user_info_followup_prompt(normalized) {
        return Some(PLAN_BLOCKER_USER_INPUT_REQUIRED_REASON);
    }
    None
}

fn looks_like_executable_plan_text(text: &str) -> bool {
    let normalized = text.trim().to_lowercase();
    if normalized.is_empty() {
        return false;
    }
    let has_plan_and_tests = (normalized.contains("实施计划")
        || normalized.contains("执行计划")
        || normalized.contains("implementation plan"))
        && (normalized.contains("测试点")
            || normalized.contains("验证点")
            || normalized.contains("test cases")
            || normalized.contains("verification"));
    let structured_step_count = normalized
        .lines()
        .map(str::trim_start)
        .filter(|line| {
            let mut chars = line.chars();
            let first = chars.next();
            let second = chars.next();
            first.map(|c| c.is_ascii_digit()).unwrap_or(false) && second == Some('.')
                || line.starts_with("- ")
                || line.starts_with("* ")
                || line.starts_with("步骤")
        })
        .count();
    has_plan_and_tests || structured_step_count >= 3
}

fn extract_plan_step_count(value: &Value) -> usize {
    value
        .get("params")
        .and_then(|params| params.get("plan"))
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0)
}

fn is_tool_or_command_item(item: &Value) -> bool {
    let type_like = [
        item.get("kind").and_then(Value::as_str).unwrap_or_default(),
        item.get("type").and_then(Value::as_str).unwrap_or_default(),
        item.get("toolType")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        item.get("tool_type")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        item.get("name").and_then(Value::as_str).unwrap_or_default(),
    ]
    .join(" ")
    .to_lowercase();

    type_like.contains("tool")
        || type_like.contains("command")
        || type_like.contains("shell")
        || type_like.contains("terminal")
        || type_like.contains("run")
}

fn item_suggests_failure(item: &Value) -> bool {
    let status = item
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    if status == "failed" || status == "error" || status == "canceled" || status == "cancelled" {
        return true;
    }
    let result_text =
        flatten_text_like_value(item.get("result").unwrap_or(&Value::Null)).to_lowercase();
    let error_text =
        flatten_text_like_value(item.get("error").unwrap_or(&Value::Null)).to_lowercase();
    [
        "exit code",
        "non-zero",
        "command failed",
        "error:",
        "not found",
        "no such file or directory",
        "permission denied",
        "timed out",
        "failed",
    ]
    .iter()
    .any(|needle| result_text.contains(needle) || error_text.contains(needle))
}

fn flatten_text_like_value(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(v) => v.to_string(),
        Value::Number(v) => v.to_string(),
        Value::String(v) => v.clone(),
        Value::Array(values) => values
            .iter()
            .map(flatten_text_like_value)
            .filter(|part| !part.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(map) => map
            .values()
            .map(flatten_text_like_value)
            .filter(|part| !part.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

fn is_plan_blocker_stream_method(method: &str) -> bool {
    matches!(
        method,
        "item/agentMessage/delta"
            | "item/reasoning/textDelta"
            | "item/reasoning/delta"
            | "item/reasoning/summaryTextDelta"
    )
}

fn extract_stream_delta_text(value: &Value) -> Option<String> {
    let method = extract_event_method(value)?;
    if !is_plan_blocker_stream_method(method) {
        return None;
    }
    value
        .get("params")
        .and_then(|params| {
            params
                .get("delta")
                .or_else(|| params.get("text"))
                .or_else(|| params.get("summary"))
        })
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToString::to_string)
}

fn looks_like_plan_blocker_prompt(text: &str) -> bool {
    let normalized = text.trim().to_lowercase();
    if normalized.is_empty() {
        return false;
    }

    let blocker_markers = [
        "出现一个阻塞",
        "出现阻塞",
        "阻塞",
        "阻塞点",
        "卡住",
        "卡点",
        "受阻",
        "blocker",
        "阻断",
        "无法把计划",
        "无法将计划",
        "无法继续",
        "缺少前端源码",
        "没有 src",
        "无 src",
        "还没看到前端源码",
        "当前仓库只有",
        "only docs",
        "missing src",
        "no src",
        "not a git repository",
        "只有 .git",
        ".git 元数据",
        "几乎只有",
    ];
    let question_markers = [
        "先发一个选项问题",
        "先发一个选项",
        "先给你选项",
        "选项让你决定",
        "选项问题",
        "请你选择",
        "需要你确认",
        "等待你选择",
        "决定下一步",
        "先确认下一步",
        "继续前请先确认",
        "requestuserinput",
        "askuserquestion",
    ];
    let strong_context_gap_markers = [
        "没有可执行前端代码",
        "没有前端代码",
        "缺少前端代码",
        "缺少可分析的前端代码",
        "没有前端源码",
        "缺少前端源码",
        "missing src",
        "no src",
        "only docs",
        "not a git repository",
        "只有 .git",
        ".git 元数据",
        "几乎只有",
    ];
    let plan_progress_markers = [
        "计划",
        "规划",
        "落地",
        "实施",
        "下一步",
        "继续",
        "分析",
        "定位",
        "真实代码",
        "真实文件",
    ];
    let blocking_verbs = [
        "无法",
        "不能",
        "没有",
        "缺少",
        "未找到",
        "不存在",
        "还没看到",
    ];
    let structural_gap_hints = [
        "docs/",
        " docs ",
        "src/",
        " src ",
        "前端源码",
        "前端",
        "frontend",
        ".git",
        "元数据",
    ];
    let has_blocker_marker = blocker_markers
        .iter()
        .any(|needle| normalized.contains(needle));
    let has_question_marker = question_markers
        .iter()
        .any(|needle| normalized.contains(needle));
    let has_strong_context_gap_marker = strong_context_gap_markers
        .iter()
        .any(|needle| normalized.contains(needle));
    let has_plan_progress_marker = plan_progress_markers
        .iter()
        .any(|needle| normalized.contains(needle));
    let has_blocking_verb = blocking_verbs
        .iter()
        .any(|needle| normalized.contains(needle));
    let has_structural_gap_hint = structural_gap_hints
        .iter()
        .any(|needle| normalized.contains(needle));
    (has_blocker_marker && (has_question_marker || (has_blocking_verb && has_structural_gap_hint)))
        || (has_strong_context_gap_marker
            && has_blocking_verb
            && (has_plan_progress_marker || has_question_marker))
}

fn looks_like_user_info_followup_prompt(text: &str) -> bool {
    let normalized = text.trim().to_lowercase();
    if normalized.is_empty() {
        return false;
    }
    if looks_like_plan_blocker_prompt(&normalized) {
        return false;
    }

    let has_question = normalized.contains('?')
        || normalized.contains('？')
        || normalized.contains("请问")
        || normalized.contains("can you")
        || normalized.contains("could you")
        || normalized.contains("would you");
    let has_imperative_request =
        normalized.contains("请") || normalized.contains("麻烦") || normalized.contains("请把");
    let has_request_marker = [
        "请提供",
        "请告诉",
        "告诉我",
        "发我",
        "给我",
        "请补充",
        "需要你",
        "我还不知道",
        "还不清楚",
        "无法确定",
        "please provide",
        "i need",
        "need your",
        "share your",
        "provide your",
    ]
    .iter()
    .any(|needle| normalized.contains(needle));
    let has_user_reference = normalized.contains("你")
        || normalized.contains("你的")
        || normalized.contains("you")
        || normalized.contains("your");

    (has_question || has_imperative_request) && has_request_marker && has_user_reference
}

fn is_repo_path_blocker_reason(reason: &str) -> bool {
    let normalized = reason.trim().to_lowercase();
    ["路径", "目录", "仓库", "git", "上下文", "context"]
        .iter()
        .any(|needle| normalized.contains(needle))
}

fn build_plan_blocker_question(reason: &str) -> String {
    if is_repo_path_blocker_reason(reason) {
        format!("{reason} 为避免误判路径，我需要你先确认下一步：")
    } else {
        format!("{reason} 我会在收到你的选择后继续：")
    }
}

fn build_plan_blocker_options(reason: &str) -> Vec<Value> {
    if is_repo_path_blocker_reason(reason) {
        vec![
            json!({
                "label": "提供正确仓库路径 (Recommended)",
                "description": "切换到真实代码仓后，我会基于仓库现状输出计划。"
            }),
            json!({
                "label": "就在当前目录继续",
                "description": "按当前目录继续，仅输出通用方案并明确假设边界。"
            }),
            json!({
                "label": "仅做设计阶段",
                "description": "不依赖仓库结构，只给高层设计和任务拆分。"
            }),
        ]
    } else {
        vec![
            json!({
                "label": "直接补充关键信息 (Recommended)",
                "description": "我将按你补充的信息继续当前任务。"
            }),
            json!({
                "label": "先给可选输入格式",
                "description": "我先给你可填写模板，你确认后再继续。"
            }),
            json!({
                "label": "先按通用假设继续",
                "description": "我会标注假设边界并继续规划。"
            }),
        ]
    }
}

fn build_plan_blocker_user_input_event(
    thread_id: &str,
    turn_id: Option<&str>,
    request_id: &str,
    reason: &str,
) -> Value {
    let question = build_plan_blocker_question(reason);
    let options = build_plan_blocker_options(reason);
    json!({
        "method": "item/tool/requestUserInput",
        "id": request_id,
        "params": {
            "threadId": thread_id,
            "thread_id": thread_id,
            "turnId": turn_id.unwrap_or(""),
            "turn_id": turn_id.unwrap_or(""),
            "itemId": format!("plan-blocker-{request_id}"),
            "item_id": format!("plan-blocker-{request_id}"),
            "questions": [{
                "id": "plan_blocker_resolution",
                "header": "Plan 模式阻断",
                "question": question,
                "options": options
            }]
        }
    })
}

fn build_plan_apply_user_input_event(
    thread_id: &str,
    turn_id: Option<&str>,
    request_id: &str,
) -> Value {
    json!({
        "method": "item/tool/requestUserInput",
        "id": request_id,
        "params": {
            "threadId": thread_id,
            "thread_id": thread_id,
            "turnId": turn_id.unwrap_or(""),
            "turn_id": turn_id.unwrap_or(""),
            "itemId": format!("plan-apply-{request_id}"),
            "item_id": format!("plan-apply-{request_id}"),
            "questions": [{
                "id": PLAN_APPLY_ACTION_QUESTION_ID,
                "header": "Implement this plan?",
                "question": "Implement this plan?",
                "options": [
                    {
                        "label": "Yes, implement this plan (Recommended)",
                        "description": "Switch to Default and start coding."
                    },
                    {
                        "label": "No, stay in Plan mode",
                        "description": "Continue planning with the model."
                    }
                ]
            }]
        }
    })
}

fn codex_args_override_instructions(codex_args: Option<&str>) -> bool {
    let Ok(args) = parse_codex_args(codex_args) else {
        return false;
    };
    let mut iter = args.iter().peekable();
    while let Some(arg) = iter.next() {
        if arg.starts_with("developer_instructions=") || arg.starts_with("instructions=") {
            return true;
        }
        if arg == "-c" || arg == "--config" {
            if let Some(next) = iter.peek() {
                let key = next.split('=').next().unwrap_or_default().trim();
                if key == "developer_instructions" || key == "instructions" {
                    return true;
                }
            }
        }
    }
    false
}

fn encode_toml_string(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");
    format!("\"{escaped}\"")
}

fn codex_external_spec_priority_config_arg() -> String {
    format!(
        "developer_instructions={}",
        encode_toml_string(CODEX_EXTERNAL_SPEC_PRIORITY_INSTRUCTIONS)
    )
}

pub(crate) struct WorkspaceSession {
    pub(crate) entry: WorkspaceEntry,
    pub(crate) child: Mutex<Child>,
    pub(crate) stdin: Mutex<ChildStdin>,
    pub(crate) pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    timed_out_requests: Mutex<HashMap<u64, TimedOutRequest>>,
    pub(crate) next_id: AtomicU64,
    /// Callbacks for background threads - events for these threadIds are sent through the channel
    pub(crate) background_thread_callbacks: Mutex<HashMap<String, mpsc::UnboundedSender<Value>>>,
    pub(crate) thread_mode_state: ThreadModeState,
    pub(crate) mode_enforcement_enabled: AtomicBool,
    pub(crate) collaboration_mode_supported: AtomicBool,
    plan_turn_state: Mutex<HashMap<String, PlanTurnState>>,
    auto_compaction_state: Mutex<HashMap<String, AutoCompactionThreadState>>,
    local_user_input_requests: Mutex<HashMap<String, String>>,
    local_request_seq: AtomicU64,
}

impl WorkspaceSession {
    async fn record_timed_out_request(&self, id: u64, method: &str, thread_id: Option<String>) {
        let now = now_millis();
        let mut timed_out_requests = self.timed_out_requests.lock().await;
        timed_out_requests.retain(|_, request| {
            now.saturating_sub(request.timed_out_at_ms) <= TIMED_OUT_REQUEST_GRACE_MS
        });
        timed_out_requests.insert(
            id,
            TimedOutRequest {
                method: method.to_string(),
                thread_id,
                timed_out_at_ms: now,
            },
        );
    }

    async fn take_timed_out_request(&self, id: u64) -> Option<TimedOutRequest> {
        let now = now_millis();
        let mut timed_out_requests = self.timed_out_requests.lock().await;
        timed_out_requests.retain(|_, request| {
            now.saturating_sub(request.timed_out_at_ms) <= TIMED_OUT_REQUEST_GRACE_MS
        });
        timed_out_requests.remove(&id)
    }

    async fn write_message(&self, value: Value) -> Result<(), String> {
        let mut stdin = self.stdin.lock().await;
        let mut line = serde_json::to_string(&value).map_err(|e| e.to_string())?;
        line.push('\n');
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| e.to_string())
    }

    pub(crate) async fn send_request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.send_request_with_timeout(
            method,
            params,
            Duration::from_secs(DEFAULT_REQUEST_TIMEOUT_SECS),
        )
        .await
    }

    pub(crate) async fn send_request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout_duration: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        self.write_message(json!({ "id": id, "method": method, "params": params }))
            .await?;
        // Add timeout to prevent pending entries from leaking forever
        // when the child process crashes without sending a response.
        match timeout(timeout_duration, rx).await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(_)) => {
                self.pending.lock().await.remove(&id);
                Err("request canceled".to_string())
            }
            Err(_) => {
                self.pending.lock().await.remove(&id);
                self.record_timed_out_request(id, method, extract_request_thread_id(&params))
                    .await;
                Err("request timed out".to_string())
            }
        }
    }

    pub(crate) fn initial_turn_start_timeout(&self) -> Duration {
        Duration::from_millis(resolve_initial_turn_start_timeout_ms())
    }

    pub(crate) async fn send_notification(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), String> {
        let value = if let Some(params) = params {
            json!({ "method": method, "params": params })
        } else {
            json!({ "method": method })
        };
        self.write_message(value).await
    }

    pub(crate) async fn send_response(&self, id: Value, result: Value) -> Result<(), String> {
        self.write_message(json!({ "id": id, "result": result }))
            .await
    }

    pub(crate) fn set_mode_enforcement_enabled(&self, enabled: bool) {
        self.mode_enforcement_enabled
            .store(enabled, Ordering::Relaxed);
    }

    pub(crate) fn mode_enforcement_enabled(&self) -> bool {
        self.mode_enforcement_enabled.load(Ordering::Relaxed)
    }

    pub(crate) fn set_collaboration_mode_supported(&self, supported: bool) {
        self.collaboration_mode_supported
            .store(supported, Ordering::Relaxed);
    }

    pub(crate) fn collaboration_mode_supported(&self) -> bool {
        self.collaboration_mode_supported.load(Ordering::Relaxed)
    }

    pub(crate) async fn get_thread_effective_mode(&self, thread_id: &str) -> Option<String> {
        self.thread_mode_state.get(thread_id).await
    }

    pub(crate) async fn set_thread_effective_mode(&self, thread_id: &str, mode: &str) {
        self.thread_mode_state
            .set(thread_id.to_string(), mode)
            .await;
    }

    pub(crate) async fn inherit_thread_effective_mode(
        &self,
        parent_thread_id: &str,
        child_thread_id: &str,
    ) -> Option<String> {
        self.thread_mode_state
            .inherit(parent_thread_id, child_thread_id)
            .await
    }

    pub(crate) async fn clear_thread_effective_mode(&self, thread_id: &str) {
        self.thread_mode_state.remove(thread_id).await;
        self.plan_turn_state.lock().await.remove(thread_id);
        self.auto_compaction_state.lock().await.remove(thread_id);
    }

    pub(crate) async fn consume_local_user_input_request(&self, request_id: &str) -> bool {
        self.local_user_input_requests
            .lock()
            .await
            .remove(request_id)
            .is_some()
    }

    async fn fire_and_forget_request(&self, method: &str, params: Value) -> Result<(), String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        self.write_message(json!({ "id": id, "method": method, "params": params }))
            .await
    }

    async fn try_interrupt_turn(&self, thread_id: &str, turn_id: &str) {
        if let Err(error) = self
            .fire_and_forget_request(
                "turn/interrupt",
                json!({
                    "threadId": thread_id,
                    "turnId": turn_id,
                }),
            )
            .await
        {
            log::warn!(
                "[collaboration_mode_enforcement] failed to interrupt plan turn thread_id={} turn_id={} error={}",
                thread_id,
                turn_id,
                error
            );
            return;
        }
        log::info!(
            "[collaboration_mode_enforcement] interrupt_sent thread_id={} turn_id={} reason=plan_blocker_user_input",
            thread_id,
            turn_id
        );
    }

    async fn evaluate_auto_compaction_trigger(
        &self,
        value: &Value,
    ) -> Option<AutoCompactionTrigger> {
        let method = extract_event_method(value)?;
        let thread_id = extract_thread_id(value)?;
        if !is_codex_thread_id(&thread_id) {
            return None;
        }
        let now = now_millis();
        let mut states = self.auto_compaction_state.lock().await;
        if matches!(method, "thread/archived" | "thread/closed") {
            states.remove(&thread_id);
            return None;
        }
        let state = states.entry(thread_id.clone()).or_default();
        let usage_percent = extract_compaction_usage_percent(value);
        if !evaluate_auto_compaction_state(state, method, usage_percent, now) {
            return None;
        }

        Some(AutoCompactionTrigger {
            thread_id,
            usage_percent: state
                .last_usage_percent
                .max(AUTO_COMPACTION_THRESHOLD_PERCENT),
        })
    }

    async fn mark_auto_compaction_failed(&self, thread_id: &str) {
        let now = now_millis();
        let mut states = self.auto_compaction_state.lock().await;
        let state = states.entry(thread_id.to_string()).or_default();
        state.in_flight = false;
        state.last_failure_at_ms = now;
    }

    async fn request_thread_auto_compaction(&self, thread_id: &str) -> Result<(), String> {
        let mut attempts = Vec::new();
        for method in AUTO_COMPACTION_METHOD_CANDIDATES {
            let params = json!({ "threadId": thread_id });
            match self.send_request(method, params).await {
                Ok(response) => {
                    if let Some(error) = response_error_message(&response) {
                        attempts.push(format!("{method}: {error}"));
                        continue;
                    }
                    log::info!(
                        "[codex_auto_compaction] started thread_id={} method={}",
                        thread_id,
                        method
                    );
                    return Ok(());
                }
                Err(error) => {
                    attempts.push(format!("{method}: {error}"));
                }
            }
        }
        Err(format!(
            "all compaction methods failed for thread {}: {}",
            thread_id,
            attempts.join(" | ")
        ))
    }

    async fn intercept_request_user_input_if_needed(&self, value: &Value) -> Option<Value> {
        let method = extract_event_method(value)?;
        if method != "item/tool/requestUserInput" {
            return None;
        }

        let thread_id = extract_thread_id(value)?;
        let effective_mode = self.get_thread_effective_mode(&thread_id).await;
        let strict_local_profile = strict_local_collaboration_profile_enabled();
        let block = should_block_request_user_input(
            method,
            effective_mode.as_deref(),
            self.mode_enforcement_enabled(),
            strict_local_profile,
        );
        if !block {
            log::debug!(
                "[collaboration_mode_enforcement] decision=pass thread_id={} effective_mode={} method={}",
                thread_id,
                effective_mode.unwrap_or_else(|| "unknown".to_string()),
                method
            );
            return None;
        }

        let request_id = value.get("id").cloned();
        if let Some(id) = request_id.clone() {
            if let Err(error) = self.send_response(id, json!({ "answers": {} })).await {
                log::warn!(
                    "[collaboration_mode_enforcement] failed to auto-respond blocked request thread_id={} error={}",
                    thread_id,
                    error
                );
            }
        }

        log::info!(
            "[collaboration_mode_enforcement] decision=blocked thread_id={} effective_mode=code method={}",
            thread_id,
            method
        );
        Some(build_mode_blocked_event(
            &thread_id,
            method,
            "code",
            MODE_BLOCKED_REASON_CODE_REQUEST_USER_INPUT,
            MODE_BLOCKED_REASON,
            MODE_BLOCKED_SUGGESTION,
            request_id,
        ))
    }

    async fn intercept_plan_repo_mutation_if_needed(&self, value: &Value) -> Option<Value> {
        if !self.mode_enforcement_enabled() || !strict_local_collaboration_profile_enabled() {
            return None;
        }
        let thread_id = extract_thread_id(value)?;
        let effective_mode = self.get_thread_effective_mode(&thread_id).await;
        if effective_mode.as_deref() != Some("plan") {
            return None;
        }
        let blocked_method = detect_repo_mutating_blocked_method(value)?;
        log::info!(
            "[collaboration_mode_enforcement] decision=blocked thread_id={} effective_mode=plan blocked_method={} reason={}",
            thread_id,
            blocked_method,
            MODE_BLOCKED_REASON_CODE_PLAN_READONLY
        );
        {
            let mut states = self.plan_turn_state.lock().await;
            let state = states.entry(thread_id.clone()).or_default();
            state.synthetic_block_active = true;
        }
        Some(build_mode_blocked_event(
            &thread_id,
            &blocked_method,
            "plan",
            MODE_BLOCKED_REASON_CODE_PLAN_READONLY,
            MODE_BLOCKED_PLAN_REASON,
            MODE_BLOCKED_PLAN_SUGGESTION,
            None,
        ))
    }

    async fn track_plan_turn_state(&self, value: &Value) {
        if !strict_local_collaboration_profile_enabled() {
            return;
        }
        let Some(thread_id) = extract_thread_id(value) else {
            return;
        };
        let Some(method) = extract_event_method(value) else {
            return;
        };
        let mut states = self.plan_turn_state.lock().await;
        match method {
            "turn/started" => {
                let state = states.entry(thread_id).or_default();
                state.active_turn_id = extract_turn_id(value);
                state.has_user_input_request = false;
                state.synthetic_block_active = false;
                state.has_plan_update = false;
                state.last_plan_step_count = 0;
                state.has_tool_activity = false;
                state.has_failed_tool_activity = false;
                state.agent_message_buffer.clear();
            }
            "item/started" | "item/updated" | "item/completed" => {
                let item = value
                    .get("params")
                    .and_then(|params| params.get("item"))
                    .cloned();
                if let Some(item) = item {
                    let state = states.entry(thread_id).or_default();
                    if state.active_turn_id.is_none() {
                        state.active_turn_id = extract_turn_id(value);
                    }
                    if is_tool_or_command_item(&item) {
                        state.has_tool_activity = true;
                        if item_suggests_failure(&item) {
                            state.has_failed_tool_activity = true;
                        }
                    }
                }
            }
            "item/tool/requestUserInput" => {
                let state = states.entry(thread_id).or_default();
                if state.active_turn_id.is_none() {
                    state.active_turn_id = extract_turn_id(value);
                }
                state.has_user_input_request = true;
            }
            method if is_plan_blocker_stream_method(method) => {
                let Some(delta) = extract_stream_delta_text(value) else {
                    return;
                };
                let state = states.entry(thread_id).or_default();
                state.agent_message_buffer.push_str(&delta);
                const PLAN_BLOCKER_BUFFER_MAX_CHARS: usize = 8000;
                if state.agent_message_buffer.len() > PLAN_BLOCKER_BUFFER_MAX_CHARS {
                    let keep_from = state
                        .agent_message_buffer
                        .char_indices()
                        .nth(
                            state
                                .agent_message_buffer
                                .chars()
                                .count()
                                .saturating_sub(PLAN_BLOCKER_BUFFER_MAX_CHARS / 2),
                        )
                        .map(|(index, _)| index)
                        .unwrap_or(0);
                    state.agent_message_buffer =
                        state.agent_message_buffer[keep_from..].to_string();
                }
            }
            "turn/planUpdated" | "turn/plan/updated" => {
                let state = states.entry(thread_id).or_default();
                if state.active_turn_id.is_none() {
                    state.active_turn_id = extract_turn_id(value);
                }
                state.has_plan_update = true;
                state.last_plan_step_count = extract_plan_step_count(value);
            }
            "turn/completed" | "turn/error" => {
                let state = states.entry(thread_id).or_default();
                if state.active_turn_id.is_none() {
                    state.active_turn_id = extract_turn_id(value);
                }
            }
            _ => {}
        }
    }

    async fn maybe_emit_plan_blocker_user_input(&self, value: &Value) -> Option<Value> {
        if !strict_local_collaboration_profile_enabled() {
            return None;
        }
        let thread_id = extract_thread_id(value)?;
        let effective_mode = self.get_thread_effective_mode(&thread_id).await;
        if effective_mode.as_deref() != Some("plan") {
            // Guard for edge cases where runtime mode tracking desyncs but
            // this turn is clearly producing plan updates.
            let has_plan_signal = {
                let states = self.plan_turn_state.lock().await;
                states
                    .get(&thread_id)
                    .map(|state| state.has_plan_update)
                    .unwrap_or(false)
            };
            if !has_plan_signal {
                return None;
            }
        }
        let method = extract_event_method(value)?;
        let reason = if is_plan_blocker_stream_method(method) {
            let aggregated = {
                let states = self.plan_turn_state.lock().await;
                states
                    .get(&thread_id)
                    .map(|state| state.agent_message_buffer.as_str())
                    .unwrap_or_default()
                    .to_string()
            };
            if !looks_like_plan_blocker_prompt(&aggregated) {
                return None;
            }
            PLAN_BLOCKER_GENERIC_REASON
        } else if method == "turn/completed" {
            if let Some(reason) = detect_plan_blocker_reason(value) {
                reason
            } else {
                let (
                    has_tool_activity,
                    has_failed_tool_activity,
                    last_plan_step_count,
                    buffered_text,
                ) = {
                    let states = self.plan_turn_state.lock().await;
                    let state = states.get(&thread_id);
                    (
                        state.map(|item| item.has_tool_activity).unwrap_or(false),
                        state
                            .map(|item| item.has_failed_tool_activity)
                            .unwrap_or(false),
                        state.map(|item| item.last_plan_step_count).unwrap_or(0),
                        state
                            .map(|item| item.agent_message_buffer.clone())
                            .unwrap_or_default(),
                    )
                };
                if let Some(reason) = detect_plan_blocker_reason_from_semantic_text(&buffered_text)
                {
                    reason
                } else {
                    log::info!(
                        "[collaboration_mode_enforcement][plan_blocker_probe] thread_id={} method=turn/completed has_tool_activity={} has_failed_tool_activity={} has_plan_update={} last_plan_step_count={} buffered_len={}",
                        thread_id,
                        has_tool_activity,
                        has_failed_tool_activity,
                        last_plan_step_count > 0,
                        last_plan_step_count,
                        buffered_text.chars().count(),
                    );
                    if last_plan_step_count > 0
                        || looks_like_executable_plan_text(&buffered_text)
                        || !has_tool_activity
                    {
                        return None;
                    }
                    if has_failed_tool_activity {
                        "Plan 模式关键检查失败，需要你先确认下一步后再继续。"
                    } else {
                        "Plan 模式未产出可执行计划，需要你先确认下一步后再继续。"
                    }
                }
            }
        } else {
            detect_plan_blocker_reason(value)?
        };
        let (already_asked, turn_id) = {
            let states = self.plan_turn_state.lock().await;
            let state = states.get(&thread_id);
            (
                state
                    .map(|item| item.has_user_input_request)
                    .unwrap_or(false),
                state.and_then(|item| item.active_turn_id.clone()),
            )
        };
        if already_asked {
            return None;
        }
        {
            let mut states = self.plan_turn_state.lock().await;
            let state = states.entry(thread_id.clone()).or_default();
            state.has_user_input_request = true;
            state.synthetic_block_active = true;
        }
        let sequence = self.local_request_seq.fetch_add(1, Ordering::SeqCst);
        let request_id = format!("{LOCAL_PLAN_BLOCKER_REQUEST_PREFIX}{sequence}");
        self.local_user_input_requests
            .lock()
            .await
            .insert(request_id.clone(), thread_id.clone());
        if let Some(current_turn_id) = turn_id.as_deref() {
            self.try_interrupt_turn(&thread_id, current_turn_id).await;
        }
        Some(build_plan_blocker_user_input_event(
            &thread_id,
            turn_id.as_deref(),
            &request_id,
            reason,
        ))
    }

    async fn should_suppress_after_synthetic_plan_block(&self, value: &Value) -> bool {
        if !strict_local_collaboration_profile_enabled() {
            return false;
        }
        let Some(thread_id) = extract_thread_id(value) else {
            return false;
        };
        let Some(method) = extract_event_method(value) else {
            return false;
        };
        let synthetic_block_active = {
            let states = self.plan_turn_state.lock().await;
            states
                .get(&thread_id)
                .map(|state| state.synthetic_block_active)
                .unwrap_or(false)
        };
        if !synthetic_block_active {
            return false;
        }
        if method == "item/tool/requestUserInput" {
            return false;
        }
        if method == "turn/error" {
            return true;
        }
        if method == "turn/completed" {
            return false;
        }
        method.starts_with("item/")
            || method == "processing/heartbeat"
            || method == "turn/planUpdated"
            || method == "turn/plan/updated"
    }

    async fn maybe_emit_plan_apply_user_input(&self, value: &Value) -> Option<Value> {
        if !strict_local_collaboration_profile_enabled() {
            return None;
        }
        let method = extract_event_method(value)?;
        if method != "turn/completed" {
            return None;
        }
        let thread_id = extract_thread_id(value)?;
        let effective_mode = self.get_thread_effective_mode(&thread_id).await;
        if effective_mode.as_deref() != Some("plan") {
            return None;
        }
        let (already_asked, has_plan_update, turn_id) = {
            let states = self.plan_turn_state.lock().await;
            let state = states.get(&thread_id);
            (
                state
                    .map(|item| item.has_user_input_request)
                    .unwrap_or(false),
                state.map(|item| item.has_plan_update).unwrap_or(false),
                state.and_then(|item| item.active_turn_id.clone()),
            )
        };
        if already_asked || !has_plan_update {
            return None;
        }
        {
            let mut states = self.plan_turn_state.lock().await;
            let state = states.entry(thread_id.clone()).or_default();
            state.has_user_input_request = true;
        }
        let sequence = self.local_request_seq.fetch_add(1, Ordering::SeqCst);
        let request_id = format!("{LOCAL_PLAN_APPLY_REQUEST_PREFIX}{sequence}");
        self.local_user_input_requests
            .lock()
            .await
            .insert(request_id.clone(), thread_id.clone());
        Some(build_plan_apply_user_input_event(
            &thread_id,
            turn_id.as_deref(),
            &request_id,
        ))
    }

    async fn clear_terminal_plan_turn_state(&self, thread_id: Option<&str>, method: Option<&str>) {
        if !matches!(method, Some("turn/completed") | Some("turn/error")) {
            return;
        }
        let Some(thread_id) = thread_id else {
            return;
        };
        self.plan_turn_state.lock().await.remove(thread_id);
    }
}

pub(crate) async fn spawn_workspace_session<E: EventSink>(
    entry: WorkspaceEntry,
    default_codex_bin: Option<String>,
    codex_args: Option<String>,
    codex_home: Option<PathBuf>,
    client_version: String,
    event_sink: E,
) -> Result<Arc<WorkspaceSession>, String> {
    let codex_bin = entry
        .codex_bin
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or(default_codex_bin);
    let _ = check_codex_installation(codex_bin.clone()).await?;
    let launch_context = resolve_codex_launch_context(codex_bin.as_deref());

    let primary_result = spawn_workspace_session_once(
        entry.clone(),
        codex_args.clone(),
        codex_home.clone(),
        client_version.clone(),
        event_sink.clone(),
        &launch_context,
        true,
    )
    .await;
    match primary_result {
        Ok(session) => Ok(session),
        Err(primary_error) => {
            if !can_retry_wrapper_launch(&launch_context) {
                return Err(primary_error);
            }
            log::warn!(
                "[codex-wrapper-fallback] retrying workspace={} bin={} wrapper={} after primary failure: {}",
                entry.id,
                launch_context.resolved_bin,
                launch_context.wrapper_kind,
                primary_error
            );
            spawn_workspace_session_once(
                entry,
                codex_args,
                codex_home,
                client_version,
                event_sink,
                &launch_context,
                false,
            )
            .await
            .map_err(|retry_error| {
                format!(
                    "Primary wrapper launch failed: {primary_error}\nFallback retry failed: {retry_error}"
                )
            })
        }
    }
}

async fn spawn_workspace_session_once<E: EventSink>(
    entry: WorkspaceEntry,
    codex_args: Option<String>,
    codex_home: Option<PathBuf>,
    client_version: String,
    event_sink: E,
    launch_context: &CodexLaunchContext,
    hide_console: bool,
) -> Result<Arc<WorkspaceSession>, String> {
    let mut command = build_codex_command_from_launch_context(launch_context, hide_console);
    let skip_spec_hint_injection = codex_args_override_instructions(codex_args.as_deref());
    apply_codex_args(&mut command, codex_args.as_deref())?;
    if !skip_spec_hint_injection {
        command.arg("-c");
        command.arg(codex_external_spec_priority_config_arg());
    }
    command.current_dir(&entry.path);
    command.arg("app-server");
    if let Some(codex_home) = codex_home {
        command.env("CODEX_HOME", codex_home);
    }
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let stdin = child.stdin.take().ok_or("missing stdin")?;
    let stdout = child.stdout.take().ok_or("missing stdout")?;
    let stderr = child.stderr.take().ok_or("missing stderr")?;

    let session = Arc::new(WorkspaceSession {
        entry: entry.clone(),
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        pending: Mutex::new(HashMap::new()),
        timed_out_requests: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(1),
        background_thread_callbacks: Mutex::new(HashMap::new()),
        thread_mode_state: ThreadModeState::default(),
        mode_enforcement_enabled: AtomicBool::new(true),
        collaboration_mode_supported: AtomicBool::new(true),
        plan_turn_state: Mutex::new(HashMap::new()),
        auto_compaction_state: Mutex::new(HashMap::new()),
        local_user_input_requests: Mutex::new(HashMap::new()),
        local_request_seq: AtomicU64::new(1),
    });

    let session_clone = Arc::clone(&session);
    let workspace_id = entry.id.clone();
    let event_sink_clone = event_sink.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let mut value: Value = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(err) => {
                    let payload = AppServerEvent {
                        workspace_id: workspace_id.clone(),
                        message: json!({
                            "method": "codex/parseError",
                            "params": { "error": err.to_string(), "raw": line },
                        }),
                    };
                    event_sink_clone.emit_app_server_event(payload);
                    continue;
                }
            };
            if let Some(blocked_event) = session_clone
                .intercept_request_user_input_if_needed(&value)
                .await
            {
                value = blocked_event;
            }
            if let Some(blocked_event) = session_clone
                .intercept_plan_repo_mutation_if_needed(&value)
                .await
            {
                value = blocked_event;
            }
            session_clone.track_plan_turn_state(&value).await;
            let synthetic_plan_event = session_clone
                .maybe_emit_plan_blocker_user_input(&value)
                .await;
            let synthetic_plan_apply_event =
                session_clone.maybe_emit_plan_apply_user_input(&value).await;
            // Temporarily disable Codex auto-compaction; keep manual compaction only.
            let auto_compaction_trigger: Option<AutoCompactionTrigger> = None;
            if session_clone
                .should_suppress_after_synthetic_plan_block(&value)
                .await
            {
                let suppressed_thread_id = extract_thread_id(&value);
                let suppressed_method = extract_event_method(&value);
                session_clone
                    .clear_terminal_plan_turn_state(
                        suppressed_thread_id.as_deref(),
                        suppressed_method,
                    )
                    .await;
                continue;
            }

            // Parse the response ID flexibly: the app-server may return it as
            // u64, i64, or even a string representation of a number.
            let maybe_id = value.get("id").and_then(|id| {
                id.as_u64()
                    .or_else(|| id.as_i64().and_then(|i| u64::try_from(i).ok()))
                    .or_else(|| id.as_str().and_then(|s| s.parse::<u64>().ok()))
            });
            let has_method = value.get("method").is_some();
            let has_result_or_error = value.get("result").is_some() || value.get("error").is_some();
            let event_method = extract_event_method(&value).map(ToString::to_string);

            // Check if this event is for a background thread
            let thread_id = extract_thread_id(&value);

            if let Some(id) = maybe_id {
                if has_result_or_error {
                    if let Some(tx) = session_clone.pending.lock().await.remove(&id) {
                        let _ = tx.send(value);
                    } else if let Some(timed_out_request) =
                        session_clone.take_timed_out_request(id).await
                    {
                        if timed_out_request.method == "turn/start" {
                            let synthetic_event = if response_error_message(&value).is_some() {
                                build_late_turn_error_event(&value, &timed_out_request)
                            } else {
                                build_late_turn_started_event(&value)
                            };
                            if let Some(synthetic_event) = synthetic_event {
                                let payload = AppServerEvent {
                                    workspace_id: workspace_id.clone(),
                                    message: synthetic_event,
                                };
                                event_sink_clone.emit_app_server_event(payload);
                            }
                        }
                    }
                } else if has_method {
                    // Check for background thread callback
                    let mut sent_to_background = false;
                    if let Some(ref tid) = thread_id {
                        let callbacks = session_clone.background_thread_callbacks.lock().await;
                        if let Some(tx) = callbacks.get(tid) {
                            let _ = tx.send(value.clone());
                            sent_to_background = true;
                        }
                    }
                    // Don't emit to frontend if this is a background thread event
                    if !sent_to_background {
                        let payload = AppServerEvent {
                            workspace_id: workspace_id.clone(),
                            message: value,
                        };
                        event_sink_clone.emit_app_server_event(payload);
                    }
                } else if let Some(tx) = session_clone.pending.lock().await.remove(&id) {
                    let _ = tx.send(value);
                }
            } else if has_method {
                // Check for background thread callback
                let mut sent_to_background = false;
                if let Some(ref tid) = thread_id {
                    let callbacks = session_clone.background_thread_callbacks.lock().await;
                    if let Some(tx) = callbacks.get(tid) {
                        let _ = tx.send(value.clone());
                        sent_to_background = true;
                    }
                }
                // Don't emit to frontend if this is a background thread event
                if !sent_to_background {
                    let payload = AppServerEvent {
                        workspace_id: workspace_id.clone(),
                        message: value,
                    };
                    event_sink_clone.emit_app_server_event(payload);
                }
            }

            if let Some(trigger) = auto_compaction_trigger {
                let compacting_event =
                    build_thread_compacting_event(&trigger.thread_id, trigger.usage_percent);
                let extra_thread_id = extract_thread_id(&compacting_event);
                let mut sent_to_background = false;
                if let Some(ref tid) = extra_thread_id {
                    let callbacks = session_clone.background_thread_callbacks.lock().await;
                    if let Some(tx) = callbacks.get(tid) {
                        let _ = tx.send(compacting_event.clone());
                        sent_to_background = true;
                    }
                }
                if !sent_to_background {
                    let payload = AppServerEvent {
                        workspace_id: workspace_id.clone(),
                        message: compacting_event,
                    };
                    event_sink_clone.emit_app_server_event(payload);
                }

                let session_for_compaction = Arc::clone(&session_clone);
                let event_sink_for_compaction = event_sink_clone.clone();
                let workspace_id_for_compaction = workspace_id.clone();
                tokio::spawn(async move {
                    if let Err(error) = session_for_compaction
                        .request_thread_auto_compaction(&trigger.thread_id)
                        .await
                    {
                        log::warn!(
                            "[codex_auto_compaction] request failed thread_id={} error={}",
                            trigger.thread_id,
                            error
                        );
                        session_for_compaction
                            .mark_auto_compaction_failed(&trigger.thread_id)
                            .await;
                        let failed_event =
                            build_thread_compaction_failed_event(&trigger.thread_id, &error);
                        let extra_thread_id = extract_thread_id(&failed_event);
                        let mut sent_to_background = false;
                        if let Some(ref tid) = extra_thread_id {
                            let callbacks = session_for_compaction
                                .background_thread_callbacks
                                .lock()
                                .await;
                            if let Some(tx) = callbacks.get(tid) {
                                let _ = tx.send(failed_event.clone());
                                sent_to_background = true;
                            }
                        }
                        if !sent_to_background {
                            let payload = AppServerEvent {
                                workspace_id: workspace_id_for_compaction,
                                message: failed_event,
                            };
                            event_sink_for_compaction.emit_app_server_event(payload);
                        }
                    }
                });
            }

            if let Some(extra_event) = synthetic_plan_event {
                let extra_thread_id = extract_thread_id(&extra_event);
                let mut sent_to_background = false;
                if let Some(ref tid) = extra_thread_id {
                    let callbacks = session_clone.background_thread_callbacks.lock().await;
                    if let Some(tx) = callbacks.get(tid) {
                        let _ = tx.send(extra_event.clone());
                        sent_to_background = true;
                    }
                }
                if !sent_to_background {
                    let payload = AppServerEvent {
                        workspace_id: workspace_id.clone(),
                        message: extra_event,
                    };
                    event_sink_clone.emit_app_server_event(payload);
                }
            }
            if let Some(extra_event) = synthetic_plan_apply_event {
                let extra_thread_id = extract_thread_id(&extra_event);
                let mut sent_to_background = false;
                if let Some(ref tid) = extra_thread_id {
                    let callbacks = session_clone.background_thread_callbacks.lock().await;
                    if let Some(tx) = callbacks.get(tid) {
                        let _ = tx.send(extra_event.clone());
                        sent_to_background = true;
                    }
                }
                if !sent_to_background {
                    let payload = AppServerEvent {
                        workspace_id: workspace_id.clone(),
                        message: extra_event,
                    };
                    event_sink_clone.emit_app_server_event(payload);
                }
            }
            session_clone
                .clear_terminal_plan_turn_state(thread_id.as_deref(), event_method.as_deref())
                .await;
        }
    });

    let workspace_id = entry.id.clone();
    let event_sink_clone = event_sink.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let payload = AppServerEvent {
                workspace_id: workspace_id.clone(),
                message: json!({
                    "method": "codex/stderr",
                    "params": { "message": line },
                }),
            };
            event_sink_clone.emit_app_server_event(payload);
        }
    });

    let init_params = json!({
        "clientInfo": {
            "name": "mossx",
            "title": "MossX",
            "version": client_version
        },
        "capabilities": {
            // Plan mode collaboration and requestUserInput are experimental APIs in codex app-server.
            "experimentalApi": true
        },
    });
    let init_result = timeout(
        Duration::from_secs(15),
        session.send_request("initialize", init_params),
    )
    .await;
    let init_response = match init_result {
        Ok(response) => response,
        Err(_) => {
            let mut child = session.child.lock().await;
            let _ = child.kill().await;
            return Err(
                "Codex app-server did not respond to initialize. Check that `codex app-server` works in Terminal."
                    .to_string(),
            );
        }
    };
    if let Err(error) = init_response {
        let mut child = session.child.lock().await;
        let _ = child.kill().await;
        return Err(error);
    }
    session.send_notification("initialized", None).await?;

    let payload = AppServerEvent {
        workspace_id: entry.id.clone(),
        message: json!({
            "method": "codex/connected",
            "params": { "workspaceId": entry.id.clone() }
        }),
    };
    event_sink.emit_app_server_event(payload);

    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::{
        build_late_turn_error_event, build_late_turn_started_event, build_mode_blocked_event,
        build_plan_blocker_user_input_event, codex_args_override_instructions,
        codex_external_spec_priority_config_arg, detect_plan_blocker_reason,
        detect_repo_mutating_blocked_method, evaluate_auto_compaction_state,
        extract_compaction_usage_percent, extract_plan_step_count, extract_stream_delta_text,
        extract_thread_id, is_codex_thread_id, is_plan_blocker_stream_method,
        is_repo_mutating_command_tokens, looks_like_executable_plan_text,
        looks_like_plan_blocker_prompt, looks_like_user_info_followup_prompt,
        normalize_command_tokens_from_item, should_block_request_user_input,
        visible_console_fallback_enabled_from_env, wrapper_kind_for_binary,
        AutoCompactionThreadState, PlanTurnState, TimedOutRequest, MODE_BLOCKED_PLAN_REASON,
        MODE_BLOCKED_PLAN_SUGGESTION, MODE_BLOCKED_REASON, MODE_BLOCKED_REASON_CODE_PLAN_READONLY,
        MODE_BLOCKED_REASON_CODE_REQUEST_USER_INPUT, MODE_BLOCKED_SUGGESTION,
    };
    use serde_json::{json, Value};

    #[test]
    fn extract_thread_id_reads_camel_case() {
        let value = json!({ "params": { "threadId": "thread-123" } });
        assert_eq!(extract_thread_id(&value), Some("thread-123".to_string()));
    }

    #[test]
    fn extract_thread_id_reads_snake_case() {
        let value = json!({ "params": { "thread_id": "thread-456" } });
        assert_eq!(extract_thread_id(&value), Some("thread-456".to_string()));
    }

    #[test]
    fn extract_thread_id_reads_turn_nested_shape() {
        let value = json!({ "params": { "turn": { "threadId": "thread-turn-1" } } });
        assert_eq!(extract_thread_id(&value), Some("thread-turn-1".to_string()));
        let value = json!({ "params": { "turn": { "thread_id": "thread-turn-2" } } });
        assert_eq!(extract_thread_id(&value), Some("thread-turn-2".to_string()));
    }

    #[test]
    fn extract_thread_id_returns_none_when_missing() {
        let value = json!({ "params": {} });
        assert_eq!(extract_thread_id(&value), None);
    }

    #[test]
    fn extract_compaction_usage_percent_reads_token_count_last_payload() {
        let value = json!({
            "method": "token_count",
            "params": {
                "info": {
                    "last_token_usage": {
                        "input_tokens": 160000,
                        "cached_input_tokens": 40000,
                        "model_context_window": 200000
                    }
                }
            }
        });
        let percent = extract_compaction_usage_percent(&value).unwrap_or_default();
        assert!((percent - 100.0).abs() < 0.0001);
    }

    #[test]
    fn extract_compaction_usage_percent_returns_none_when_token_count_last_missing() {
        let value = json!({
            "method": "token_count",
            "params": {
                "info": {
                    "total_token_usage": {
                        "input_tokens": 160000,
                        "cached_input_tokens": 40000,
                        "model_context_window": 200000
                    }
                }
            }
        });
        assert!(extract_compaction_usage_percent(&value).is_none());
    }

    #[test]
    fn extract_compaction_usage_percent_prefers_last_token_count_snapshot() {
        let value = json!({
            "method": "token_count",
            "params": {
                "info": {
                    "total_token_usage": {
                        "input_tokens": 180000,
                        "cached_input_tokens": 0,
                        "model_context_window": 200000
                    },
                    "last_token_usage": {
                        "input_tokens": 20000,
                        "cached_input_tokens": 0,
                        "model_context_window": 200000
                    }
                }
            }
        });
        let percent = extract_compaction_usage_percent(&value).unwrap_or_default();
        assert!((percent - 10.0).abs() < 0.0001);
    }

    #[test]
    fn extract_compaction_usage_percent_reads_thread_last_usage_payload() {
        let value = json!({
            "method": "thread/tokenUsage/updated",
            "params": {
                "tokenUsage": {
                    "last": {
                        "inputTokens": 92000,
                        "cachedInputTokens": 0
                    },
                    "modelContextWindow": 100000
                }
            }
        });
        let percent = extract_compaction_usage_percent(&value).unwrap_or_default();
        assert!((percent - 92.0).abs() < 0.0001);
    }

    #[test]
    fn extract_compaction_usage_percent_returns_none_when_thread_last_missing() {
        let value = json!({
            "method": "thread/tokenUsage/updated",
            "params": {
                "tokenUsage": {
                    "total": {
                        "inputTokens": 92000,
                        "cachedInputTokens": 0
                    },
                    "modelContextWindow": 100000
                }
            }
        });
        assert!(extract_compaction_usage_percent(&value).is_none());
    }

    #[test]
    fn extract_compaction_usage_percent_prefers_thread_last_snapshot() {
        let value = json!({
            "method": "thread/tokenUsage/updated",
            "params": {
                "tokenUsage": {
                    "total": {
                        "inputTokens": 190000,
                        "cachedInputTokens": 0
                    },
                    "last": {
                        "inputTokens": 20000,
                        "cachedInputTokens": 0
                    },
                    "modelContextWindow": 200000
                }
            }
        });
        let percent = extract_compaction_usage_percent(&value).unwrap_or_default();
        assert!((percent - 10.0).abs() < 0.0001);
    }

    #[test]
    fn is_codex_thread_id_filters_non_codex_prefixes() {
        assert!(is_codex_thread_id("thread-1"));
        assert!(is_codex_thread_id("codex-abc"));
        assert!(!is_codex_thread_id("claude:session-1"));
        assert!(!is_codex_thread_id("claude-pending-1"));
        assert!(!is_codex_thread_id("opencode:session-1"));
        assert!(!is_codex_thread_id("gemini:session-1"));
        assert!(!is_codex_thread_id(""));
    }

    #[test]
    fn evaluate_auto_compaction_state_applies_processing_cooldown_and_trigger() {
        let mut state = AutoCompactionThreadState::default();

        assert!(!evaluate_auto_compaction_state(
            &mut state,
            "turn/started",
            Some(95.0),
            10_000,
        ));
        assert!(state.is_processing);
        assert!(!evaluate_auto_compaction_state(
            &mut state,
            "token_count",
            Some(95.0),
            20_000,
        ));
        assert!(!evaluate_auto_compaction_state(
            &mut state,
            "turn/completed",
            None,
            30_000,
        ));
        assert!(evaluate_auto_compaction_state(
            &mut state,
            "token_count",
            Some(95.0),
            100_000,
        ));
        assert!(state.in_flight);
        assert!(!evaluate_auto_compaction_state(
            &mut state,
            "token_count",
            Some(96.0),
            100_500,
        ));
        assert!(!evaluate_auto_compaction_state(
            &mut state,
            "thread/compacted",
            None,
            101_000,
        ));
        assert!(!evaluate_auto_compaction_state(
            &mut state,
            "token_count",
            Some(95.0),
            110_000,
        ));
        assert!(evaluate_auto_compaction_state(
            &mut state,
            "token_count",
            Some(95.0),
            200_000,
        ));
    }

    #[test]
    fn codex_args_override_instructions_detects_developer_instructions() {
        assert!(codex_args_override_instructions(Some(
            r#"-c developer_instructions="follow workspace policy""#
        )));
        assert!(codex_args_override_instructions(Some(
            r#"--config instructions="be concise""#
        )));
    }

    #[test]
    fn codex_args_override_instructions_ignores_unrelated_configs() {
        assert!(!codex_args_override_instructions(Some(
            r#"-c model="gpt-5.3-codex" --search"#
        )));
        assert!(!codex_args_override_instructions(None));
    }

    #[test]
    fn codex_external_spec_priority_config_arg_is_toml_quoted() {
        let arg = codex_external_spec_priority_config_arg();
        assert!(arg.starts_with("developer_instructions=\""));
        assert!(arg.ends_with('"'));
        assert!(arg.contains("writableRoots"));
    }

    #[test]
    fn build_late_turn_started_event_extracts_turn_identity() {
        let response = json!({
            "id": 9,
            "result": {
                "turn": {
                    "id": "turn-123",
                    "threadId": "thread-456"
                }
            }
        });

        let event = build_late_turn_started_event(&response).expect("late turn event");
        assert_eq!(
            event.get("method").and_then(Value::as_str),
            Some("turn/started")
        );
        assert_eq!(
            event
                .get("params")
                .and_then(|params| params.get("threadId"))
                .and_then(Value::as_str),
            Some("thread-456")
        );
        assert_eq!(
            event
                .get("params")
                .and_then(|params| params.get("turnId"))
                .and_then(Value::as_str),
            Some("turn-123")
        );
    }

    #[test]
    fn build_late_turn_error_event_extracts_thread_identity_and_message() {
        let response = json!({
            "id": 9,
            "error": {
                "message": "Upstream overloaded",
                "code": -32001
            }
        });
        let request = TimedOutRequest {
            method: "turn/start".to_string(),
            thread_id: Some("thread-456".to_string()),
            timed_out_at_ms: 0,
        };

        let event = build_late_turn_error_event(&response, &request).expect("late turn error");
        assert_eq!(
            event.get("method").and_then(Value::as_str),
            Some("turn/error")
        );
        assert_eq!(
            event
                .get("params")
                .and_then(|params| params.get("threadId"))
                .and_then(Value::as_str),
            Some("thread-456")
        );
        assert_eq!(
            event
                .get("params")
                .and_then(|params| params.get("error"))
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str),
            Some("Upstream overloaded")
        );
        assert_eq!(
            event
                .get("params")
                .and_then(|params| params.get("willRetry"))
                .and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn build_late_turn_error_event_reads_nested_result_error_message() {
        let response = json!({
            "id": 9,
            "result": {
                "error": {
                    "message": "Late nested failure",
                    "code": -32002
                }
            }
        });
        let request = TimedOutRequest {
            method: "turn/start".to_string(),
            thread_id: Some("thread-789".to_string()),
            timed_out_at_ms: 0,
        };

        let event = build_late_turn_error_event(&response, &request).expect("late turn error");
        assert_eq!(
            event.get("method").and_then(Value::as_str),
            Some("turn/error")
        );
        assert_eq!(
            event
                .get("params")
                .and_then(|params| params.get("threadId"))
                .and_then(Value::as_str),
            Some("thread-789")
        );
        assert_eq!(
            event
                .get("params")
                .and_then(|params| params.get("error"))
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str),
            Some("Late nested failure")
        );
    }

    #[test]
    fn wrapper_kind_for_binary_labels_windows_wrappers() {
        assert_eq!(wrapper_kind_for_binary("codex"), "direct");
        assert_eq!(wrapper_kind_for_binary("C:/bin/codex.cmd"), "cmd-wrapper");
        assert_eq!(wrapper_kind_for_binary("C:/bin/codex.bat"), "bat-wrapper");
    }

    #[test]
    fn should_block_request_user_input_only_for_code_mode_when_enabled() {
        assert!(should_block_request_user_input(
            "item/tool/requestUserInput",
            Some("code"),
            true,
            true,
        ));
        assert!(!should_block_request_user_input(
            "item/tool/requestUserInput",
            Some("plan"),
            true,
            true,
        ));
        assert!(!should_block_request_user_input(
            "item/tool/requestUserInput",
            Some("code"),
            false,
            true,
        ));
        assert!(!should_block_request_user_input(
            "item/updated",
            Some("code"),
            true,
            true,
        ));
        assert!(!should_block_request_user_input(
            "item/tool/requestUserInput",
            Some("code"),
            true,
            false,
        ));
    }

    #[test]
    fn build_mode_blocked_event_has_required_params() {
        let event = build_mode_blocked_event(
            "thread-1",
            "item/tool/requestUserInput",
            "code",
            MODE_BLOCKED_REASON_CODE_REQUEST_USER_INPUT,
            MODE_BLOCKED_REASON,
            MODE_BLOCKED_SUGGESTION,
            Some(json!(91)),
        );
        assert_eq!(event["method"], "collaboration/modeBlocked");
        assert_eq!(event["params"]["threadId"], "thread-1");
        assert_eq!(event["params"]["thread_id"], "thread-1");
        assert_eq!(
            event["params"]["blockedMethod"],
            "item/tool/requestUserInput"
        );
        assert_eq!(
            event["params"]["blocked_method"],
            "item/tool/requestUserInput"
        );
        assert_eq!(event["params"]["effectiveMode"], "code");
        assert_eq!(event["params"]["effective_mode"], "code");
        assert_eq!(
            event["params"]["reasonCode"],
            "request_user_input_blocked_in_default_mode"
        );
        assert_eq!(
            event["params"]["reason_code"],
            "request_user_input_blocked_in_default_mode"
        );
        assert_eq!(
            event["params"]["reason"],
            "requestUserInput is blocked while effective_mode=code"
        );
        assert_eq!(event["params"]["requestId"], 91);
        assert_eq!(event["params"]["request_id"], 91);
    }

    #[test]
    fn normalize_command_tokens_from_item_supports_string_and_array() {
        let string_item = json!({
            "command": "git push origin main"
        });
        assert_eq!(
            normalize_command_tokens_from_item(&string_item),
            vec!["git", "push", "origin", "main"]
        );
        let array_item = json!({
            "command": ["git", "commit", "-m", "msg"]
        });
        assert_eq!(
            normalize_command_tokens_from_item(&array_item),
            vec!["git", "commit", "-m", "msg"]
        );
    }

    #[test]
    fn is_repo_mutating_command_tokens_detects_git_write_actions() {
        assert!(is_repo_mutating_command_tokens(
            &["git", "push", "origin", "main"]
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        ));
        assert!(is_repo_mutating_command_tokens(
            &["git", "commit", "-m", "msg"]
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        ));
        assert!(!is_repo_mutating_command_tokens(
            &["git", "status"]
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        ));
        assert!(!is_repo_mutating_command_tokens(
            &["rg", "--files"]
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        ));
    }

    #[test]
    fn detect_repo_mutating_blocked_method_detects_apply_patch_and_git_push() {
        let patch_event = json!({
            "method": "item/started",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "id": "tool-1",
                    "type": "apply_patch"
                }
            }
        });
        assert_eq!(
            detect_repo_mutating_blocked_method(&patch_event),
            Some("item/tool/apply_patch".to_string())
        );

        let git_push_event = json!({
            "method": "item/started",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "id": "tool-2",
                    "type": "commandExecution",
                    "command": ["git", "push", "origin", "main"]
                }
            }
        });
        assert_eq!(
            detect_repo_mutating_blocked_method(&git_push_event),
            Some("item/tool/commandExecution:git push origin main".to_string())
        );

        let read_only_event = json!({
            "method": "item/started",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "id": "tool-3",
                    "type": "commandExecution",
                    "command": ["git", "status"]
                }
            }
        });
        assert_eq!(detect_repo_mutating_blocked_method(&read_only_event), None);
    }

    #[test]
    fn detect_repo_mutating_blocked_method_detects_item_request_approval_events() {
        let file_change_approval_event = json!({
            "method": "item/fileChange/requestApproval",
            "id": "req-1",
            "params": {
                "threadId": "thread-1"
            }
        });
        assert_eq!(
            detect_repo_mutating_blocked_method(&file_change_approval_event),
            Some("item/fileChange/requestApproval".to_string())
        );

        let command_approval_event = json!({
            "method": "item/commandExecution/requestApproval",
            "id": "req-2",
            "params": {
                "threadId": "thread-1"
            }
        });
        assert_eq!(
            detect_repo_mutating_blocked_method(&command_approval_event),
            Some("item/commandExecution/requestApproval".to_string())
        );
    }

    #[test]
    fn build_mode_blocked_event_for_plan_contains_standard_reason_code_and_suggestion() {
        let event = build_mode_blocked_event(
            "thread-plan-1",
            "item/tool/commandExecution:git push origin main",
            "plan",
            MODE_BLOCKED_REASON_CODE_PLAN_READONLY,
            MODE_BLOCKED_PLAN_REASON,
            MODE_BLOCKED_PLAN_SUGGESTION,
            None,
        );
        assert_eq!(event["method"], "collaboration/modeBlocked");
        assert_eq!(event["params"]["effectiveMode"], "plan");
        assert_eq!(event["params"]["reasonCode"], "plan_readonly_violation");
        assert_eq!(
            event["params"]["suggestion"],
            "Switch to Default mode and retry the write operation."
        );
    }

    #[test]
    fn detect_plan_blocker_reason_matches_not_git_repo_marker() {
        let event = json!({
            "method": "item/completed",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "status": "completed",
                    "result": "NOT_GIT_REPO"
                }
            }
        });
        assert_eq!(
            detect_plan_blocker_reason(&event),
            Some("当前目录不是 Git 仓库，无法基于真实代码上下文继续计划。")
        );
    }

    #[test]
    fn detect_plan_blocker_reason_matches_missing_context_marker() {
        let event = json!({
            "method": "item/completed",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "status": "completed",
                    "error": "No such file or directory: /tmp/not-found"
                }
            }
        });
        assert_eq!(
            detect_plan_blocker_reason(&event),
            Some("Plan 模式下发现关键路径或上下文缺失，继续推进前需要你确认范围与目标位置。")
        );
    }

    #[test]
    fn detect_plan_blocker_reason_matches_semantic_assistant_blocker_text() {
        let event = json!({
            "method": "item/completed",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "type": "agentMessage",
                    "status": "completed",
                    "text": "出现一个阻塞：当前仓库只有 docs/，没有 src/。我先发一个选项问题，等你选择后再继续。"
                }
            }
        });
        assert_eq!(
            detect_plan_blocker_reason(&event),
            Some("Plan 模式检测到阻断条件，需要你先确认下一步后再继续。")
        );
    }

    #[test]
    fn detect_plan_blocker_reason_matches_agent_delta_blocker_text() {
        let event = json!({
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": "thread-1",
                "delta": "出现一个阻塞：没有 src。需要你确认，我先发一个选项问题。"
            }
        });
        assert_eq!(detect_plan_blocker_reason(&event), None);
    }

    #[test]
    fn detect_plan_blocker_reason_matches_turn_completed_result_text() {
        let event = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "result": {
                    "summary": "当前仓库只有 docs/plans，还没看到前端源码，无法把计划精确落地。下一步先发一个选项问题。"
                }
            }
        });
        assert_eq!(
            detect_plan_blocker_reason(&event),
            Some("Plan 模式检测到阻断条件，需要你先确认下一步后再继续。")
        );
    }

    #[test]
    fn detect_plan_blocker_reason_matches_turn_completed_turn_payload_text() {
        let event = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "turn": {
                    "id": "turn-1",
                    "status": "completed",
                    "items": [{
                        "type": "agentMessage",
                        "text": "当前仓库只有 design.md，没有可执行前端代码文件，计划无法基于真实文件落地。先给你选项确认下一步。"
                    }]
                }
            }
        });
        assert_eq!(
            detect_plan_blocker_reason(&event),
            Some("Plan 模式检测到阻断条件，需要你先确认下一步后再继续。")
        );
    }

    #[test]
    fn detect_plan_blocker_reason_matches_turn_completed_followup_question_text() {
        let event = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "result": {
                    "summary": "我还不知道你的出生日期，所以现在算不出来。请把你的出生年月日发我，我可以继续。"
                }
            }
        });
        assert_eq!(
            detect_plan_blocker_reason(&event),
            Some("Plan 模式检测到需要你补充关键信息，继续前请先确认输入。")
        );
    }

    #[test]
    fn looks_like_plan_blocker_prompt_matches_docs_without_src_style() {
        let text = "我已确认仓库当前只有 docs/plans 下的一份规划文档，还没看到前端源码；下一步先按你的规范检查 .claude/.codex/openspec。";
        assert!(looks_like_plan_blocker_prompt(text));
    }

    #[test]
    fn looks_like_plan_blocker_prompt_matches_key_blocker_phrase_from_ui() {
        let text = "我定位到一个关键阻塞：仓库里目前只有 docs/plans/2026-03-02-csv-export.md，没有前端源码目录（如 src/），因此无法给出基于真实文件的落地计划。先发一个选项让你决定下一步。";
        assert!(looks_like_plan_blocker_prompt(text));
    }

    #[test]
    fn looks_like_plan_blocker_prompt_matches_git_metadata_without_frontend_text() {
        let text =
            "我刚定位到一个阻塞点：当前工作区几乎只有 .git 元数据，没有看到任何前端实现目录。";
        assert!(looks_like_plan_blocker_prompt(text));
    }

    #[test]
    fn looks_like_plan_blocker_prompt_matches_missing_frontend_without_blocker_word() {
        let text = "当前仓库只有 design.md，没有可执行前端代码文件，计划无法基于真实代码落地。";
        assert!(looks_like_plan_blocker_prompt(text));
    }

    #[test]
    fn looks_like_executable_plan_text_matches_structured_plan_content() {
        let text = "实施计划：\n1. 定位导出入口\n2. 补充 CSV 下载逻辑\n3. 增加回归测试\n测试点：验证导出文件头与空态处理";
        assert!(looks_like_executable_plan_text(text));
    }

    #[test]
    fn looks_like_executable_plan_text_rejects_blocker_only_text() {
        let text = "当前仓库只有 design.md，没有可执行前端代码文件。";
        assert!(!looks_like_executable_plan_text(text));
    }

    #[test]
    fn extract_plan_step_count_reads_plan_updated_payload() {
        let event = json!({
            "method": "turn/plan/updated",
            "params": {
                "threadId": "thread-1",
                "plan": [
                    { "step": "Inspect", "status": "in_progress" },
                    { "step": "Implement", "status": "pending" }
                ]
            }
        });
        assert_eq!(extract_plan_step_count(&event), 2);
    }

    #[test]
    fn is_plan_blocker_stream_method_matches_reasoning_variants() {
        assert!(is_plan_blocker_stream_method("item/agentMessage/delta"));
        assert!(is_plan_blocker_stream_method("item/reasoning/textDelta"));
        assert!(is_plan_blocker_stream_method("item/reasoning/delta"));
        assert!(is_plan_blocker_stream_method(
            "item/reasoning/summaryTextDelta"
        ));
        assert!(!is_plan_blocker_stream_method(
            "item/reasoning/summaryPartAdded"
        ));
    }

    #[test]
    fn extract_stream_delta_text_reads_reasoning_delta_payload() {
        let event = json!({
            "method": "item/reasoning/textDelta",
            "params": {
                "threadId": "thread-1",
                "itemId": "item-1",
                "delta": "我刚定位到一个阻塞点：当前工作区几乎只有 .git 元数据。"
            }
        });
        assert_eq!(
            extract_stream_delta_text(&event),
            Some("我刚定位到一个阻塞点：当前工作区几乎只有 .git 元数据。".to_string())
        );
    }

    #[test]
    fn looks_like_user_info_followup_prompt_matches_age_question() {
        let text = "我还不知道你的出生日期。请把你的出生年月日发我，我就能继续。";
        assert!(looks_like_user_info_followup_prompt(text));
    }

    #[test]
    fn build_plan_blocker_user_input_event_has_questions() {
        let event = build_plan_blocker_user_input_event(
            "thread-1",
            Some("turn-1"),
            "mossx-plan-blocker:1",
            "当前目录不是 Git 仓库，无法基于真实代码上下文继续计划。",
        );
        assert_eq!(event["method"], "item/tool/requestUserInput");
        assert_eq!(event["id"], "mossx-plan-blocker:1");
        assert_eq!(event["params"]["threadId"], "thread-1");
        assert_eq!(event["params"]["turnId"], "turn-1");
        assert_eq!(
            event["params"]["questions"][0]["id"],
            "plan_blocker_resolution"
        );
    }

    #[test]
    fn build_plan_blocker_user_input_event_uses_generic_options_for_non_repo_reason() {
        let event = build_plan_blocker_user_input_event(
            "thread-1",
            Some("turn-1"),
            "mossx-plan-blocker:2",
            "Plan 模式检测到需要你补充关键信息，继续前请先确认输入。",
        );
        assert_eq!(
            event["params"]["questions"][0]["options"][0]["label"],
            "直接补充关键信息 (Recommended)"
        );
    }

    #[test]
    fn plan_turn_state_default_has_no_synthetic_block() {
        let state = PlanTurnState::default();
        assert!(!state.synthetic_block_active);
        assert!(!state.has_user_input_request);
        assert!(state.active_turn_id.is_none());
    }

    #[test]
    fn visible_console_fallback_env_parser_accepts_supported_values() {
        assert!(visible_console_fallback_enabled_from_env(Some("1")));
        assert!(visible_console_fallback_enabled_from_env(Some("true")));
    }

    #[test]
    fn visible_console_fallback_env_parser_rejects_other_values() {
        assert!(!visible_console_fallback_enabled_from_env(None));
        assert!(!visible_console_fallback_enabled_from_env(Some("0")));
        assert!(!visible_console_fallback_enabled_from_env(Some("false")));
        assert!(!visible_console_fallback_enabled_from_env(Some("TRUE")));
        assert!(!visible_console_fallback_enabled_from_env(Some(" true ")));
    }
}
