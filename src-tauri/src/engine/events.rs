//! Engine event types and tool-call/todo payload parsing shared by every
//! engine adapter (claude, kimi, codex, omp, ...).

use serde::Serialize;
use serde_json::Value;
use super::plan_review::PlanReview;

#[derive(Debug)]
pub enum EngineEvent {
    /// Streaming text delta (append).
    Delta(String),
    /// Reasoning/thinking delta (append).
    Thinking(String),
    /// A completed message block (role, text). `path` carries the target
    /// file of a tool call (read/edit/write/...) so the UI can render a
    /// file chip; None for everything else. `args` is the tool-call payload
    /// (pretty-printed in the timeline). `patch` updates the oldest
    /// still-incomplete tool row of the same name (claude streams args
    /// after the name-only start).
    Message {
        role: String,
        text: String,
        path: Option<String>,
        /// Todo-list snapshot/patch from a todo tool call (claude TodoWrite,
        /// omp todo op); feeds the run-status strip's task pill.
        todos: Option<TodosPayload>,
        args: Option<Value>,
        result: Option<Value>,
        patch: bool,
        /// The engine's own id for this call, when it reports one. A result
        /// paired to its call by tool name alone mislabels parallel calls of
        /// the same tool; this is the key the frontend correlates on.
        tool_call_id: Option<String>,
    },
    /// Native session id became known.
    SessionId(String),
    /// Token usage snapshot from the engine.
    Usage(Value),
    /// Throughput accounting marker (never streamed to the UI): a model
    /// response's stream opened (`active: true`) or closed (`active: false`).
    /// `reader.rs` folds the spans into the next usage report's `genMs` wire
    /// field, which plugins use to compute generation speed.
    Generation { active: bool },
    /// Engine-reported error.
    Error(String),
    /// Non-terminal engine notice (e.g. an upstream 429 the CLI is
    /// retrying): surfaced to the UI, but the turn is still running.
    Warn(String),
    /// One model attempt ended, but the CLI may retry or compact next.
    /// Keep its outcome for EOF; unlike Error/Done, this never ends the run.
    AttemptEnd { error: Option<String> },
    /// The CLI is backing off before re-issuing a request (claude
    /// `system/api_retry`, omp `auto_retry_start`). Distinct from `Warn`
    /// because the UI shows it as live progress ("重试中 2/5") in the run
    /// status line rather than as an error banner; cleared by the next
    /// content event or by the turn settling.
    Retry {
        attempt: u64,
        /// The CLI's own retry budget; 0 when it does not report one.
        max: u64,
        /// Human-readable reason (HTTP status / provider message).
        message: String,
    },
    /// A tool call was denied by the CLI's permission system (headless mode
    /// cannot prompt). `path` is the denied absolute path when the denial
    /// text or tool input carries one — the UI offers a directory grant for
    /// it; `tool` is the denied tool name when known. `tool_use_id` names
    /// the denied call: Claude reports a denial mid-turn (tool_result) and
    /// again on the final result line, and the two copies can disagree on
    /// path and text, so the frontend matches them by this id.
    PermissionDenied {
        tool: Option<String>,
        path: Option<String>,
        message: String,
        tool_use_id: Option<String>,
    },
    /// The CLI is asking the user to choose (control protocol: `can_use_tool`
    /// for AskUserQuestion). `input` is the full tool input; the answer
    /// command sends it back with the user's choices merged in.
    Question {
        request_id: String,
        tool_use_id: Option<String>,
        input: Value,
    },
    /// A parked question no longer needs an answer (the CLI cancelled it or
    /// the run settled): the UI resolves the card without a choice.
    QuestionSettled { request_id: String },
    /// 计划草稿的流式预览:正文不完整,任何批准路径都必须拒绝。
    /// `replace` = 引擎给的是全量快照(如 ACP plan.entries),否则追加。
    PlanDraft {
        plan_id: String,
        text: String,
        replace: bool,
    },
    /// 完整计划到达并等待人工审批。`record` 是审批事实(落盘 + 下发);
    /// `context` 是不透明的原生回复上下文,只停在后端注册表,永不下发
    /// 前端(前端不能提交任意原生 RPC 方法、路径或审批 token)。
    PlanReviewReady {
        record: Box<PlanReview>,
        context: Value,
    },
    /// 一个计划版本不再可审批(被取代/过期/取消/已决策):卡片按 status
    /// 落定。与 QuestionSettled 同级,不复用——approve 不是问答字符串选项。
    PlanReviewSettled {
        plan_id: String,
        revision: i64,
        status: String,
    },
    /// Context compaction started/ended (omp `auto_compaction_start/end`,
    /// forwarded by rpc-ui). Not terminal: the turn keeps running after the
    /// summary swap. The UI shows a live "compacting" indicator; `reason`
    /// carries the CLI's trigger label when it reports one.
    Compaction {
        active: bool,
        reason: Option<String>,
    },
    /// pi rpc 模式的完全落定信号(omp 用 isTerminal agent_end;pi 的
    /// agent_end 没有 isTerminal,结果在 print 模式里本来到 EOF 才定论,而
    /// rpc 长驻进程没有 EOF)。语义等价 EOF 收尾:有未恢复的尝试错误按
    /// Error 落定,否则 Done —— 由 dispatch 侧读 TurnState 决定。
    AgentSettled,
    /// A control-protocol permission ask for any other tool. This client has
    /// no approval UI, so the runner denies it in place — the same net
    /// behavior as before the control protocol (headless cannot prompt).
    ControlPermissionDeny {
        request_id: String,
        tool_name: String,
    },
    /// An MCP `elicitation` control_request (the MCP server asked the user
    /// for form input or a confirmation). This client has no elicitation
    /// form, so the runner declines in place — the MCP tool call settles
    /// with a declined result instead of parking the turn forever.
    ElicitationDecline {
        request_id: String,
    },
    /// A control_request whose subtype this client does not implement.
    /// Every request must get exactly one response or the CLI parks on it
    /// forever (e.g. an MCP elicitation once hung the whole turn); the
    /// error reply mirrors the official SDK's fallback for unknown
    /// subtypes and lets the CLI surface the failure to its caller.
    ControlRequestError {
        request_id: String,
        subtype: String,
    },
    /// Turn finished successfully.
    Done {
        session_id: Option<String>,
        usage: Option<Value>,
    },
    /// Actual model ID emitted by the engine or resolved at launch.
    Model(String),
    /// Reasoning effort level requested at launch, then the level the engine actually reported.
    Effort(String),
    /// The selection this run was launched with — the model/effort this
    /// client asked the CLI to use, after channel remap. Dispatched at most
    /// once per run, before any output, so the response check has an
    /// unambiguous request side: a `model`/`effort` report is never mistaken
    /// for it, and vice versa. Absent sides stay `None` rather than echoing
    /// a default the CLI picked on its own.
    Launch {
        /// Some(None) explicitly marks an unresolved alias; None is legacy/direct comparison.
        comparison_model: Option<Option<String>>,
        model: Option<String>,
        effort: Option<String>,
        /// The stream can report a `Served` side for this run; a run that
        /// never can keeps the check hidden until evidence arrives.
        reports_served: bool,
    },
    /// What the response itself reported as running: the model named by the
    /// upstream message (claude's `assistant.message.model`), the serving
    /// model the runtime recovered from the response (pi's `upstreamModel`,
    /// a codex `model/rerouted` target), or an effort level echoed by the
    /// stream. Evidence only — emitted when the stream carries it, and never
    /// synthesized from the launch request, so an unreported side stays
    /// unknown instead of reading as a match.
    Served {
        model: Option<String>,
        effort: Option<String>,
    },
    /// MCP servers the CLI reported as loaded for this session (claude
    /// `system/init`): `(name, status)` pairs plus the session's tool names
    /// (used to attribute `mcp__<server>__<tool>` tools back to their server).
    /// Consumed by the MCP settings page's runtime section; not streamed to
    /// the chat UI.
    McpServers {
        servers: Vec<(String, Option<String>)>,
        tools: Vec<String>,
    },
    /// Number of background tasks (`run_in_background` Bash/agents) the CLI
    /// still has running. While non-zero, a `Done` is deferred: the CLI starts
    /// a follow-up turn on its own when the task finishes. Not streamed.
    BackgroundTasks { pending: usize },
}
/// One todo entry carried to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct TodoItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub content: String,
    /// Empty only on a patch that leaves the status as it is (a TaskUpdate
    /// that renames without naming a status); it is then left off the wire
    /// and the frontend keeps the item's current status.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl TodoItem {
    pub fn new(content: impl Into<String>, status: impl Into<String>) -> Self {
        Self {
            id: None,
            content: content.into(),
            status: status.into(),
            phase: None,
            reason: None,
            detail: None,
        }
    }
}
/// `replace: true` is a full snapshot of the todo list; `false` is a patch
/// the frontend applies by matching on `content`.
#[derive(Debug, Clone, Serialize)]
pub struct TodosPayload {
    pub items: Vec<TodoItem>,
    pub replace: bool,
}
/// Normalize a CLI's todo status onto the four the UI renders. Every CLI
/// spells these differently (claude `in_progress`, omp `running`/`active`,
/// `abandoned` for a dropped task), and a status the UI does not know reads
/// as "pending" - showing finished or abandoned work as still to do.
fn todo_status(raw: Option<&str>) -> &'static str {
    match raw.unwrap_or("") {
        "in_progress" | "running" | "active" => "active",
        "completed" | "complete" | "done" => "complete",
        "blocked" => "blocked",
        "dropped" | "cancelled" | "abandoned" | "deleted" => "dropped",
        _ => "pending",
    }
}
/// Drop empty / null payloads so the UI does not render a blank args panel.
/// JSON-encoded strings (OpenAI-style `function.arguments`) are parsed first.
pub(crate) fn parse_tool_args_value(value: &Value) -> Option<Value> {
    match value {
        Value::Null => None,
        Value::Object(map) if map.is_empty() => None,
        Value::Array(items) if items.is_empty() => None,
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                return None;
            }
            match serde_json::from_str::<Value>(trimmed) {
                Ok(parsed) => parse_tool_args_value(&parsed)
                    .or_else(|| Some(Value::String(trimmed.to_string()))),
                Err(_) => Some(Value::String(trimmed.to_string())),
            }
        }
        other => Some(other.clone()),
    }
}
/// Engines spell "no id" two ways: an absent field and an empty string. Both
/// mean unpaired, and the frontend only correlates on a non-blank id, so
/// normalize here instead of in every adapter.
fn tool_call_identity(id: Option<&str>) -> Option<String> {
    id.map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}
/// Tool-call start: name plus parsed args (path / todos derived from args).
pub(crate) fn tool_call_message(name: impl Into<String>, args: Option<&Value>) -> EngineEvent {
    tool_call_message_with_id(name, args, None)
}
/// Same as [`tool_call_message`], carrying the engine's id for the call.
pub(crate) fn tool_call_message_with_id(
    name: impl Into<String>,
    args: Option<&Value>,
    tool_call_id: Option<&str>,
) -> EngineEvent {
    let name = name.into();
    let args = args.and_then(parse_tool_args_value);
    let todos = args.as_ref().and_then(parse_todo_args);
    EngineEvent::Message {
        role: "tool".to_string(),
        text: name,
        path: args.as_ref().and_then(tool_path_arg),
        todos,
        args,
        result: None,
        patch: false,
        tool_call_id: tool_call_identity(tool_call_id),
    }
}
/// Patches the matching in-flight tool row, carrying the engine's id for the
/// call when it reports one.
pub(crate) fn tool_call_patch_with_id(
    name: impl Into<String>,
    args: Option<&Value>,
    tool_call_id: Option<&str>,
) -> EngineEvent {
    match tool_call_message_with_id(name, args, tool_call_id) {
        EngineEvent::Message {
            role,
            text,
            path,
            todos,
            args,
            tool_call_id,
            ..
        } => EngineEvent::Message {
            role,
            text,
            path,
            todos,
            args,
            result: None,
            patch: true,
            tool_call_id,
        },
        other => other,
    }
}
/// The id and subject a task-creation result names, in either shape it
/// arrives in: the live wire object (`{"task":{"id","subject"}}`) and the
/// transcript's own line ("Task #1 created successfully: …").
fn created_task(result: &Value) -> Option<(String, String)> {
    if let Some(text) = result.as_str() {
        // The transcript's line is exactly one line; multi-line text is tool
        // output that merely happens to start the same way.
        if text.contains('\n') {
            return None;
        }
        let rest = text.trim().strip_prefix("Task #")?;
        let (id, tail) = rest.split_once(" created successfully")?;
        let id = id.trim();
        // The CLI separates subject with ": " (and localizes the colon).
        let content = tail
            .trim_start_matches(&[':', '：'][..])
            .trim();
        if id.is_empty() || content.is_empty() {
            return None;
        }
        return Some((id.to_string(), content.to_string()));
    }
    let task = result.get("task")?;
    let id = task
        .get("id")
        .and_then(|value| match value {
            Value::String(s) => Some(s.trim().to_string()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
        .filter(|id| !id.is_empty())?;
    let content = task
        .get("subject")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|subject| !subject.is_empty())?;
    Some((id, content.to_string()))
}

/// Todo state echoed by the todo tool's own result.
///
/// Two shapes reach here. omp's `details.phases` is the authoritative
/// snapshot: omp answers every todo call (init, start, done, block, append,
/// view) with the complete post-op list, where each phase carries its tasks
/// and their current status. Reading it avoids two live-path gaps at once —
/// the start event carries no `args` for this tool, and `done`/`block` may
/// name a PHASE instead of one task, which a task-keyed patch could never
/// apply. `replace: true` because the payload is a full list, not a delta.
///
/// Claude Code's TaskCreate result is the other shape: it names the id the
/// CLI assigned, and every later TaskUpdate addresses that id. The call's
/// own args carry no id, so without this the created item can never be
/// matched by an update patch and the list stays "pending" for the rest of
/// the session. The payload is a patch (`replace: false`) carrying both the
/// id and the subject, so it lands on the row the args created. Only
/// TaskCreate's answer counts: TaskGet answers with the same envelope, and
/// reading it as a creation reset the task it read back to "pending".
pub(crate) fn parse_todo_result(tool: &str, result: &Value) -> Option<TodosPayload> {
    if let Some(phases) = result
        .get("details")
        .and_then(|d| d.get("phases"))
        .and_then(Value::as_array)
    {
        return phases_payload(phases);
    }
    if !is_task_create(tool) {
        return None;
    }
    created_task(result).map(|(id, content)| TodosPayload {
        items: vec![TodoItem {
            id: Some(id),
            content,
            status: "pending".to_string(),
            phase: None,
            reason: None,
            detail: None,
        }],
        replace: false,
    })
}

/// Claude Code's task-creation tool, matched the way the frontend names it.
fn is_task_create(tool: &str) -> bool {
    let tool = tool.to_ascii_lowercase();
    tool.contains("taskcreate") || tool.contains("task_create")
}

/// omp's per-phase task list flattened into one payload.
fn phases_payload(phases: &[Value]) -> Option<TodosPayload> {
    let mut items = Vec::new();
    for phase in phases {
        let phase_name = phase
            .get("name")
            .or_else(|| phase.get("phase"))
            .and_then(Value::as_str);
        let Some(tasks) = phase.get("tasks").and_then(Value::as_array) else {
            continue;
        };
        for task in tasks {
            let Some(content) = task
                .get("content")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
            else {
                continue;
            };
            let status = todo_status(task.get("status").and_then(Value::as_str));
            let phase = phase_name.or_else(|| task.get("phase").and_then(Value::as_str)).map(str::to_string);
            let reason = task.get("blocker").or_else(|| task.get("reason")).and_then(Value::as_str).map(str::to_string);
            let detail = task.get("detail").or_else(|| task.get("description")).and_then(Value::as_str).map(str::to_string);
            items.push(TodoItem {
                id: None,
                content: content.to_string(),
                status: status.to_string(),
                phase,
                reason,
                detail,
            });
        }
    }
    if items.is_empty() {
        return None;
    }
    Some(TodosPayload {
        items,
        replace: true,
    })
}
/// Patches execution result onto the matching in-flight tool row. A todo
/// tool's result can double as a todo fact — omp answers with the full list,
/// claude's TaskCreate with the id it assigned (see [`parse_todo_result`]).
pub(crate) fn tool_result_patch(name: impl Into<String>, result: Option<&Value>) -> EngineEvent {
    tool_result_patch_with_id(name, result, None)
}
/// Same as [`tool_result_patch`], carrying the id of the call it settles.
pub(crate) fn tool_result_patch_with_id(
    name: impl Into<String>,
    result: Option<&Value>,
    tool_call_id: Option<&str>,
) -> EngineEvent {
    let name = name.into();
    let todos = result.and_then(|result| parse_todo_result(&name, result));
    EngineEvent::Message {
        role: "tool".to_string(),
        text: name,
        path: None,
        todos,
        args: None,
        result: result.cloned(),
        patch: true,
        tool_call_id: tool_call_identity(tool_call_id),
    }
}
/// Assistant snapshot with no tool metadata.
pub(crate) fn assistant_message(text: String) -> EngineEvent {
    EngineEvent::Message {
        role: "assistant".to_string(),
        text,
        path: None,
        todos: None,
        args: None,
        result: None,
        patch: false,
        tool_call_id: None,
    }
}
/// First path-like argument of a tool call (`read`/`edit`/`write` use
/// `path`, claude's tools use `file_path`). Returns None for tools whose
/// args carry no file target (e.g. bash `command`). Glob patterns are kept
/// as-is; the UI decides whether the string is chip-worthy.
pub(crate) fn tool_path_arg(args: &Value) -> Option<String> {
    ["path", "file_path", "filePath"]
        .iter()
        .filter_map(|key| args.get(key).and_then(Value::as_str))
        .map(|s| s.trim())
        .find(|s| !s.is_empty())
        .map(|s| s.to_string())
}
/// Parse a tool call's args into a todo-list payload. Two shapes: claude's
/// TodoWrite (`todos` array, a full snapshot) and the omp harness todo
/// protocol (`op` + task/list, mostly patches). None when the args carry
/// no todo data.
pub(crate) fn parse_todo_args(args: &Value) -> Option<TodosPayload> {
    // Normal tools (e.g. Bash, Edit, Read, Write) carry command or file_path;
    // their description must NEVER be mistaken for a Todo item.
    if args.get("command").is_some()
        || args.get("file_path").is_some()
        || args.get("filePath").is_some()
        || args.get("pattern").is_some()
    {
        return None;
    }

    let pending_item = |content: &str| TodoItem::new(content, "pending");
    // `list` phases, each with an `items` string array, flattened.
    let phase_items = |args: &Value| -> Vec<TodoItem> {
        args.get("list")
            .and_then(Value::as_array)
            .map(|phases| {
                phases
                    .iter()
                    .flat_map(|phase| {
                        let phase_name = phase
                            .get("phase")
                            .or_else(|| phase.get("name"))
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        phase
                            .get("items")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_str)
                            .map(move |content| TodoItem {
                                id: None,
                                content: content.to_string(),
                                status: "pending".to_string(),
                                phase: phase_name.clone(),
                                reason: None,
                                detail: None,
                            })
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    if let Some(todos) = args.get("todos").and_then(Value::as_array) {
        let items = todos
            .iter()
            .filter_map(|entry| {
                let content = ["content", "text", "title", "task", "subject"]
                    .iter()
                    .filter_map(|key| entry.get(key).and_then(Value::as_str))
                    .map(|s| s.trim())
                    .find(|s| !s.is_empty())?;
                let status = todo_status(entry.get("status").and_then(Value::as_str));
                let id = entry
                    .get("id")
                    .or_else(|| entry.get("taskId"))
                    .and_then(Value::as_str)
                    .map(|s| s.to_string());
                Some(TodoItem {
                    id,
                    content: content.to_string(),
                    status: status.to_string(),
                    phase: entry.get("phase").and_then(Value::as_str).map(str::to_string),
                    reason: entry.get("reason").or_else(|| entry.get("blocker")).and_then(Value::as_str).map(str::to_string),
                    detail: entry.get("detail").or_else(|| entry.get("description")).and_then(Value::as_str).map(str::to_string),
                })
            })
            .collect();
        return Some(TodosPayload {
            items,
            replace: true,
        });
    }

    // TaskCreate tool call support: MUST have explicit `subject` (never fallback to tool description)
    if let Some(subject) = args
        .get("subject")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if args.get("taskId").is_none() && args.get("op").is_none() {
            let status = todo_status(args.get("status").and_then(Value::as_str));
            let detail = args.get("description").or_else(|| args.get("detail")).and_then(Value::as_str).map(str::to_string);
            return Some(TodosPayload {
                items: vec![TodoItem {
                    id: None,
                    content: subject.to_string(),
                    status: status.to_string(),
                    phase: None,
                    reason: None,
                    detail,
                }],
                replace: false,
            });
        }
    }

    // TaskUpdate tool call support: MUST have `taskId`. Only what the call
    // names is patched — a status it leaves out stays as it was. TaskGet
    // (a bare `taskId`) and owner/dependency-only updates change nothing the
    // list shows, so they are no patch at all.
    if args.get("op").is_none() {
        if let Some(task_id) = args
            .get("taskId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let content = args
                .get("subject")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("");
            let status = args
                .get("status")
                .and_then(Value::as_str)
                .map(|raw| todo_status(Some(raw)))
                .unwrap_or("");
            let detail = args.get("description").or_else(|| args.get("detail")).and_then(Value::as_str).map(str::to_string);
            if content.is_empty() && status.is_empty() && detail.is_none() {
                return None;
            }
            return Some(TodosPayload {
                items: vec![TodoItem {
                    id: Some(task_id.to_string()),
                    content: content.to_string(),
                    status: status.to_string(),
                    phase: None,
                    reason: None,
                    detail,
                }],
                replace: false,
            });
        }
    }

    let op = args.get("op").and_then(Value::as_str)?;
    match op {
        "init" => Some(TodosPayload {
            items: phase_items(args),
            replace: true,
        }),
        "append" => {
            let items = match args.get("items").and_then(Value::as_array) {
                Some(items) => items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(pending_item)
                    .collect(),
                None => phase_items(args),
            };
            Some(TodosPayload {
                items,
                replace: false,
            })
        }
        "start" | "done" | "block" | "unblock" | "drop" => {
            // `task` names ONE item. A phase-wide op names a `phase` instead
            // (the CLI pairs it with an empty `items` array) and must NOT be
            // emitted here: the frontend matches patches by `content`, so a
            // phase name would find no item and get APPENDED as a phantom
            // row. Phase-wide moves travel via the tool's own result
            // snapshot (`parse_todo_result`), which always carries the
            // complete post-op list.
            let task = args.get("task").and_then(Value::as_str)?;
            let status = match op {
                "start" => "active",
                "done" => "complete",
                "block" => "blocked",
                "unblock" => "pending",
                _ => "dropped",
            };
            let phase = args.get("phase").and_then(Value::as_str).map(str::to_string);
            let reason = args.get("reason").or_else(|| args.get("blocker")).and_then(Value::as_str).map(str::to_string);
            let detail = args.get("detail").or_else(|| args.get("i")).and_then(Value::as_str).map(str::to_string);
            Some(TodosPayload {
                items: vec![TodoItem {
                    id: None,
                    content: task.to_string(),
                    status: status.to_string(),
                    phase,
                    reason,
                    detail,
                }],
                replace: false,
            })
        }
        "rm" | "clear" => Some(TodosPayload {
            items: Vec::new(),
            replace: true,
        }),
        _ => None,
    }
}
/// A leading '-' would parse as a flag (pi also treats '@' as a file
/// reference): prefix a space so the prompt stays positional text.
pub(crate) fn safe_prompt_arg(prompt: &str) -> String {
    if prompt.starts_with('-') || prompt.starts_with('@') {
        format!(" {prompt}")
    } else {
        prompt.to_string()
    }
}
/// Push a `SessionId` event from a JSON string field; blank values are ignored.
/// Engines disagree on the key (`session_id` / `thread_id` / `id`).
pub(crate) fn push_session_id(value: &Value, key: &str, out: &mut Vec<EngineEvent>) {
    if let Some(id) = value.get(key).and_then(Value::as_str) {
        if !id.trim().is_empty() {
            out.push(EngineEvent::SessionId(id.trim().to_string()));
        }
    }
}
#[cfg(test)]
mod tool_args_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_tool_args_value_drops_empty_and_parses_strings() {
        assert_eq!(parse_tool_args_value(&Value::Null), None);
        assert_eq!(parse_tool_args_value(&json!({})), None);
        assert_eq!(parse_tool_args_value(&json!([])), None);
        assert_eq!(
            parse_tool_args_value(&json!("{\"path\":\"a.ts\"}")),
            Some(json!({"path": "a.ts"}))
        );
        assert_eq!(
            parse_tool_args_value(&json!({"file_path": "a.ts"})),
            Some(json!({"file_path": "a.ts"}))
        );
        assert_eq!(
            parse_tool_args_value(&json!("plain command")),
            Some(json!("plain command"))
        );
    }

    #[test]
    fn tool_call_message_extracts_path_and_marks_patch() {
        match tool_call_message("Read", Some(&json!({"file_path": "src/a.ts"}))) {
            EngineEvent::Message {
                path, args, patch, ..
            } => {
                assert_eq!(path.as_deref(), Some("src/a.ts"));
                assert_eq!(args, Some(json!({"file_path": "src/a.ts"})));
                assert!(!patch);
            }
            _ => panic!("expected tool message"),
        }
        match tool_call_patch_with_id("Read", Some(&json!({"file_path": "src/a.ts"})), None) {
            EngineEvent::Message { patch, .. } => assert!(patch),
            _ => panic!("expected patch"),
        }
    }

    /// Claude's TaskCreate answers with the id the CLI assigned; the call's
    /// args carry no id, so this result is the only place the id exists.
    #[test]
    fn created_task_result_carries_the_id_task_update_addresses() {
        // Live wire shape: the structured object the CLI streams back.
        let payload = parse_todo_result("TaskCreate", &json!({
            "task": {"id": "1", "subject": "编写 bili_app.py 网页版"}
        }))
        .expect("create envelope is a todo fact");
        assert!(!payload.replace);
        assert_eq!(payload.items.len(), 1);
        assert_eq!(payload.items[0].id.as_deref(), Some("1"));
        assert_eq!(payload.items[0].content, "编写 bili_app.py 网页版");
        assert_eq!(payload.items[0].status, "pending");

        // Transcript shape: the same fact as the CLI's own result line.
        let payload = parse_todo_result("TaskCreate", &json!("Task #12 created successfully: 樱花\"整季选集\"批量下载设计"))
            .expect("result line is a todo fact");
        assert_eq!(payload.items[0].id.as_deref(), Some("12"));
        assert_eq!(payload.items[0].content, "樱花\"整季选集\"批量下载设计");
    }

    /// Updates and unrelated tool output must not be mistaken for creations:
    /// a phantom "pending" row per update would inflate the task count.
    #[test]
    fn non_create_results_are_not_todos() {
        assert!(parse_todo_result("TaskUpdate", &json!({
            "success": true,
            "taskId": "13",
            "statusChange": {"from": "pending", "to": "in_progress"}
        }))
        .is_none());
        assert!(parse_todo_result("TaskUpdate", &json!("Updated task #13 status")).is_none());
        assert!(parse_todo_result("TaskCreate", &json!({"stdout": "Task #1 created successfully: x"})).is_none());
        assert!(parse_todo_result("TaskCreate", &json!("Task #1 created successfully: x\nextra line")).is_none());
    }

    /// TaskGet answers with the same `{task:{id,subject}}` envelope as
    /// TaskCreate (plus the task's status), and its args are a bare `taskId`.
    /// Reading a task changes nothing, so neither half may become a todo
    /// patch: as a "creation" it forced the task back to pending.
    #[test]
    fn task_get_is_not_a_todo_fact() {
        let envelope = json!({
            "task": {"id": "1", "subject": "A", "description": "",
                     "status": "completed", "blocks": [], "blockedBy": []}
        });
        assert!(parse_todo_result("TaskGet", &envelope).is_none());
        assert!(parse_todo_args(&json!({"taskId": "1"})).is_none());
        // Only TaskCreate's answer is a creation, whatever text another tool
        // happens to print.
        assert!(parse_todo_result("Bash", &json!("Task #1 created successfully: x")).is_none());
        assert!(parse_todo_result("", &json!({"task": {"id": "1", "subject": "A"}})).is_none());
    }

    /// A TaskUpdate that does not name a status leaves the status alone:
    /// renames and description edits patch only what they carry, and
    /// owner/dependency-only updates have nothing the list shows.
    #[test]
    fn status_less_task_update_keeps_the_status() {
        assert!(parse_todo_args(&json!({"taskId": "3", "addBlockedBy": ["1"]})).is_none());
        assert!(parse_todo_args(&json!({"taskId": "3", "owner": "researcher"})).is_none());

        let rename = parse_todo_args(&json!({"taskId": "12", "subject": "新标题"})).expect("rename patch");
        assert_eq!(rename.items[0].id.as_deref(), Some("12"));
        assert_eq!(rename.items[0].content, "新标题");
        let wire = serde_json::to_value(&rename).unwrap();
        assert!(wire["items"][0].get("status").is_none(), "unchanged status stays off the wire: {wire}");

        let done = parse_todo_args(&json!({"taskId": "12", "status": "completed"})).expect("status patch");
        assert_eq!(done.items[0].status, "complete");
        let wire = serde_json::to_value(&done).unwrap();
        assert_eq!(wire["items"][0]["status"], "complete");
    }

    /// omp still owns the `details.phases` shape; the created-task branch must
    /// not swallow it.
    #[test]
    fn phases_snapshot_still_wins_over_the_create_envelope() {
        let payload = parse_todo_result("todo", &json!({
            "details": {"phases": [{"name": "P1", "tasks": [{"content": "Task 1", "status": "completed"}]}]}
        }))
        .expect("phases payload");
        assert!(payload.replace);
        assert_eq!(payload.items[0].status, "complete");
    }
}
