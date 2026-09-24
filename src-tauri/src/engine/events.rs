//! Engine event types and tool-call/todo payload parsing shared by every
//! engine adapter (claude, kimi, codex, omp, ...).

use serde::Serialize;
use serde_json::Value;

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
    /// it; `tool` is the denied tool name when known.
    PermissionDenied {
        tool: Option<String>,
        path: Option<String>,
        message: String,
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
    /// Turn finished successfully.
    Done {
        session_id: Option<String>,
        usage: Option<Value>,
    },
    /// Actual model ID emitted by the engine or resolved at launch.
    Model(String),
    /// Reasoning effort level requested at launch, then the level the engine actually reported.
    Effort(String),
    /// MCP servers the CLI reported as loaded for this session (claude
    /// `system/init`): `(name, status)` pairs plus the session's tool names
    /// (used to attribute `mcp__<server>__<tool>` tools back to their server).
    /// Consumed by the MCP settings page's runtime section; not streamed to
    /// the chat UI.
    McpServers {
        servers: Vec<(String, Option<String>)>,
        tools: Vec<String>,
    },
    /// A background task started inside the run (claude `system/task_started`):
    /// a Workflow, a Task-tool subagent, or a background shell. Non-terminal:
    /// these frames also arrive after the turn's done, while the task runs.
    TaskStarted {
        id: String,
        task_type: String,
        description: String,
        subagent_type: Option<String>,
        is_backgrounded: Option<bool>,
        spawn_depth: Option<u64>,
        workflow_name: Option<String>,
    },
    /// Live progress for one task (`system/task_progress`). The description is
    /// what the task is doing right now: a workflow reports "<phase>: <agent>",
    /// a subagent its current tool activity ("Running Wait 590 seconds").
    TaskProgress {
        id: String,
        description: Option<String>,
        last_tool: Option<String>,
        usage: Option<Value>,
    },
    /// One task reached a terminal status (`system/task_notification`):
    /// completed | failed | stopped.
    TaskNotification { id: String, status: String },
    /// The full set of live background tasks (`system/background_tasks_changed`).
    /// REPLACE semantics: consumers swap their set for this payload, so a
    /// missed start/stop edge cannot wedge a stale running indicator.
    TasksChanged { tasks: Vec<TaskSummary> },
}
/// One live background task, as the CLI's level-signal frame reports it.
#[derive(Debug, Clone)]
pub struct TaskSummary {
    pub id: String,
    pub task_type: String,
    pub description: String,
    pub ambient: bool,
}
/// One todo entry carried to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct TodoItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub content: String,
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
/// Tool-call start: name plus parsed args (path / todos derived from args).
pub(crate) fn tool_call_message(name: impl Into<String>, args: Option<&Value>) -> EngineEvent {
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
    }
}
/// Same as [`tool_call_message`] but patches the matching in-flight tool row.
pub(crate) fn tool_call_patch(name: impl Into<String>, args: Option<&Value>) -> EngineEvent {
    match tool_call_message(name, args) {
        EngineEvent::Message {
            role,
            text,
            path,
            todos,
            args,
            ..
        } => EngineEvent::Message {
            role,
            text,
            path,
            todos,
            args,
            result: None,
            patch: true,
        },
        other => other,
    }
}
/// Todo state echoed by the todo tool's own result (`details.phases`).
///
/// This is the authoritative snapshot: omp answers every todo call (init,
/// start, done, block, append, view) with the complete post-op list, where
/// each phase carries its tasks and their current status. Reading it avoids
/// two live-path gaps at once — the start event carries no `args` for this
/// tool, and `done`/`block` may name a PHASE instead of one task, which a
/// task-keyed patch could never apply. `replace: true` because the payload
/// is a full list, not a delta.
pub(crate) fn parse_todo_result(result: &Value) -> Option<TodosPayload> {
    let phases = result
        .get("details")
        .and_then(|d| d.get("phases"))
        .and_then(Value::as_array)?;
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
/// tool's result carries the full list (`details.phases`), so it doubles as
/// an authoritative todo snapshot — the live path's only reliable source for
/// this tool (see [`parse_todo_result`]).
pub(crate) fn tool_result_patch(name: impl Into<String>, result: Option<&Value>) -> EngineEvent {
    let todos = result.and_then(parse_todo_result);
    EngineEvent::Message {
        role: "tool".to_string(),
        text: name.into(),
        path: None,
        todos,
        args: None,
        result: result.cloned(),
        patch: true,
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

    // TaskUpdate tool call support: MUST have `taskId`
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
            let status = todo_status(args.get("status").and_then(Value::as_str));
            let detail = args.get("description").or_else(|| args.get("detail")).and_then(Value::as_str).map(str::to_string);
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
        match tool_call_patch("Read", Some(&json!({"file_path": "src/a.ts"}))) {
            EngineEvent::Message { patch, .. } => assert!(patch),
            _ => panic!("expected patch"),
        }
    }
}
