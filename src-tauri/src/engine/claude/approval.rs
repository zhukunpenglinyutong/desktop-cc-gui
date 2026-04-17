use super::*;
use std::path::{Component, Path, PathBuf};

pub(super) const SYNTHETIC_APPROVAL_RESUME_MARKER_PREFIX: &str = "<ccgui-approval-resume>";
pub(super) const SYNTHETIC_APPROVAL_RESUME_MARKER_SUFFIX: &str = "</ccgui-approval-resume>";
const MAX_CLAUDE_APPROVAL_FILE_BYTES: usize = 400_000;
const CLAUDE_FILE_PATH_KEYS: &[&str] = &[
    "file_path",
    "filePath",
    "filepath",
    "path",
    "target_file",
    "targetFile",
    "filename",
    "file",
    "notebook_path",
    "notebookPath",
];
const CLAUDE_FILE_CONTENT_KEYS: &[&str] = &["content", "text", "new_string", "newString"];

#[derive(Clone, Copy)]
pub(super) enum ClaudeModeBlockedKind {
    RequestUserInput,
    FileChange,
    CommandExecution,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum LocalClaudeFileApprovalAction {
    Write {
        relative_path: String,
        content: String,
    },
    TouchFile {
        relative_path: String,
    },
    Edit {
        relative_path: String,
        old_string: String,
        new_string: String,
    },
    MultiEdit {
        relative_path: String,
        edits: Vec<LocalClaudeStructuredEdit>,
    },
    CreateDirectory {
        relative_path: String,
    },
    DeletePath {
        relative_path: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LocalClaudeStructuredEdit {
    old_string: String,
    new_string: String,
    replace_all: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum LocalClaudeFileCommand {
    Remove { path: String },
    MakeDirectory { path: String },
    Touch { path: String },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct SyntheticApprovalSummaryEntry {
    pub(super) summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) kind: Option<String>,
    pub(super) status: String,
}

pub(super) fn format_synthetic_approval_completion_text(
    entries: &[SyntheticApprovalSummaryEntry],
) -> Option<String> {
    let filtered: Vec<&str> = entries
        .iter()
        .map(|entry| entry.summary.as_str())
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .collect();
    match filtered.len() {
        0 => None,
        1 => Some(filtered[0].to_string()),
        _ => Some(format!(
            "Completed approved operations:\n{}",
            filtered
                .iter()
                .map(|entry| format!("- {entry}"))
                .collect::<Vec<String>>()
                .join("\n")
        )),
    }
}

fn format_synthetic_approval_resume_marker(
    entries: &[SyntheticApprovalSummaryEntry],
) -> Option<String> {
    if entries.is_empty() {
        return None;
    }
    serde_json::to_string(entries).ok().map(|payload| {
        format!(
            "{SYNTHETIC_APPROVAL_RESUME_MARKER_PREFIX}{payload}{SYNTHETIC_APPROVAL_RESUME_MARKER_SUFFIX}"
        )
    })
}

pub(super) fn format_synthetic_approval_resume_message(
    entries: &[SyntheticApprovalSummaryEntry],
) -> String {
    let summary = format_synthetic_approval_completion_text(entries)
        .unwrap_or_else(|| "Approval handling finished.".to_string());
    match format_synthetic_approval_resume_marker(entries) {
        Some(marker) => format!(
            "{marker}\n{summary}\nPlease continue from the current workspace state and finish the original task."
        ),
        None => format!(
            "{}\nPlease continue from the current workspace state and finish the original task.",
            summary
        ),
    }
}

pub(super) fn looks_like_claude_permission_denial_message(message: &str) -> bool {
    let normalized_message = message.trim().to_ascii_lowercase();
    if normalized_message.is_empty() {
        return false;
    }

    normalized_message.contains("requires approval")
        || normalized_message.contains("requested permissions")
        || normalized_message.contains("haven't granted it yet")
        || normalized_message.contains("have not granted it yet")
        || normalized_message.contains("permission denied")
        || normalized_message.contains("requires permission")
        || normalized_message.contains("blocked for security")
        || normalized_message.contains("blocked. for security")
        || normalized_message.contains("allowed working directories")
        || normalized_message.contains("may only write to files")
}

fn normalize_claude_tool_name_for_blocked_classification(tool_name: &str) -> String {
    tool_name
        .trim()
        .to_ascii_lowercase()
        .replace(['_', '-', ' '], "")
}

pub(super) fn classify_claude_mode_blocked_tool(tool_name: &str) -> Option<ClaudeModeBlockedKind> {
    let normalized = normalize_claude_tool_name_for_blocked_classification(tool_name);
    if normalized.is_empty() {
        return None;
    }
    if normalized == "askuserquestion" {
        return Some(ClaudeModeBlockedKind::RequestUserInput);
    }
    if normalized.contains("bash")
        || normalized.contains("exec")
        || normalized.contains("command")
        || normalized.contains("shell")
        || normalized.contains("terminal")
        || normalized.contains("stdin")
        || normalized.contains("native")
        || normalized == "run"
    {
        return Some(ClaudeModeBlockedKind::CommandExecution);
    }
    if normalized == "edit"
        || normalized == "multiedit"
        || normalized == "write"
        || normalized == "rewrite"
        || normalized == "createfile"
        || normalized == "createdirectory"
        || normalized == "delete"
        || normalized == "deletefile"
        || normalized == "remove"
        || normalized == "removefile"
        || normalized == "unlink"
        || normalized == "notebookedit"
    {
        return Some(ClaudeModeBlockedKind::FileChange);
    }
    None
}

pub(super) fn normalize_claude_request_id_key(request_id: &Value) -> Option<String> {
    match request_id {
        Value::String(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn normalize_claude_tool_name_for_local_apply(tool_name: &str) -> String {
    tool_name
        .trim()
        .to_ascii_lowercase()
        .replace(['_', '-', ' '], "")
}

fn extract_first_non_empty_string(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| {
        object
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|candidate| !candidate.is_empty())
            .map(ToString::to_string)
    })
}

fn extract_first_bool(value: &Value, keys: &[&str]) -> Option<bool> {
    let object = value.as_object()?;
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_bool))
}

pub(super) fn extract_claude_command_string(value: &Value) -> Option<String> {
    extract_first_non_empty_string(
        value,
        &["command", "cmd", "shell_command", "shellCommand", "script"],
    )
}

fn shell_split_simple(command: &str) -> Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut chars = command.chars().peekable();

    while let Some(ch) = chars.next() {
        if let Some(active_quote) = quote {
            if active_quote == '"' && ch == '\\' {
                if let Some(next) = chars.next() {
                    current.push(next);
                } else {
                    current.push('\\');
                }
                continue;
            }
            if ch == active_quote {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }

        match ch {
            '\'' | '"' => quote = Some(ch),
            '\\' => {
                let Some(&next) = chars.peek() else {
                    current.push('\\');
                    continue;
                };
                if next.is_whitespace() || matches!(next, '\'' | '"' | '\\') {
                    current.push(chars.next().unwrap_or(next));
                } else {
                    current.push('\\');
                }
            }
            ' ' | '\t' | '\n' | '\r' => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }

    if quote.is_some() {
        return Err("Command contains an unterminated quote.".to_string());
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    Ok(tokens)
}

fn command_contains_shell_control(command: &str) -> bool {
    command.contains(';')
        || command.contains('|')
        || command.contains('&')
        || command.contains('>')
        || command.contains('<')
        || command.contains('`')
        || command.contains("$(")
        || command.contains("${")
}

fn parse_single_path_file_command(command: &str) -> Option<LocalClaudeFileCommand> {
    if command_contains_shell_control(command) {
        return None;
    }
    let tokens = shell_split_simple(command).ok()?;
    let (program, args) = tokens.split_first()?;
    let normalized_program = program
        .rsplit('/')
        .next()
        .unwrap_or(program)
        .trim()
        .to_ascii_lowercase();

    let mut paths = Vec::new();
    let mut end_of_options = false;
    for arg in args {
        if !end_of_options && arg == "--" {
            end_of_options = true;
            continue;
        }
        if !end_of_options && arg.starts_with('-') {
            match normalized_program.as_str() {
                "rm" if matches!(arg.as_str(), "-f" | "-r" | "-rf" | "-fr") => continue,
                "mkdir" if arg == "-p" => continue,
                _ => return None,
            }
        }
        paths.push(arg.clone());
    }

    if paths.len() != 1 {
        return None;
    }
    let path = paths.remove(0);
    match normalized_program.as_str() {
        "rm" | "unlink" | "rmdir" => Some(LocalClaudeFileCommand::Remove { path }),
        "mkdir" => Some(LocalClaudeFileCommand::MakeDirectory { path }),
        "touch" => Some(LocalClaudeFileCommand::Touch { path }),
        _ => None,
    }
}

pub(super) fn command_can_apply_as_local_file_action(command: &str) -> bool {
    parse_single_path_file_command(command).is_some()
}

fn collect_claude_multiedit_operations(
    value: &Value,
    operations: &mut Vec<LocalClaudeStructuredEdit>,
) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_claude_multiedit_operations(item, operations);
            }
        }
        Value::Object(object) => {
            if let Some(old_string) =
                extract_first_non_empty_string(value, &["old_string", "oldString"])
            {
                operations.push(LocalClaudeStructuredEdit {
                    old_string,
                    new_string: extract_first_non_empty_string(value, &["new_string", "newString"])
                        .unwrap_or_default(),
                    replace_all: extract_first_bool(value, &["replace_all", "replaceAll"])
                        .unwrap_or(false),
                });
            }

            for key in ["edits", "changes", "input", "arguments"] {
                if let Some(nested) = object.get(key) {
                    collect_claude_multiedit_operations(nested, operations);
                }
            }
        }
        _ => {}
    }
}

fn extract_claude_multiedit_operations(value: &Value) -> Vec<LocalClaudeStructuredEdit> {
    let mut operations = Vec::new();
    collect_claude_multiedit_operations(value, &mut operations);
    operations
}

fn normalize_claude_raw_path(raw_path: &str) -> String {
    raw_path.trim().replace('\\', "/")
}

fn resolve_absolute_candidate_against_existing_ancestor(
    candidate: &Path,
) -> Result<PathBuf, String> {
    if candidate.exists() {
        let metadata = std::fs::symlink_metadata(candidate)
            .map_err(|error| format!("Failed to read approval path metadata: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Ok(candidate.to_path_buf());
        }
    }
    let mut existing_ancestor = Some(candidate);
    while let Some(path) = existing_ancestor {
        if path.exists() {
            let canonical_existing = path
                .canonicalize()
                .map_err(|error| format!("Failed to resolve approval path: {error}"))?;
            let suffix = candidate
                .strip_prefix(path)
                .map_err(|_| "Claude approval path is invalid.".to_string())?;
            return Ok(canonical_existing.join(suffix));
        }
        existing_ancestor = path.parent();
    }
    Err("Claude approval path is invalid.".to_string())
}

pub(super) fn normalize_claude_workspace_relative_path(path: &Path) -> Result<String, String> {
    let mut segments = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => {
                let value = segment.to_string_lossy().trim().to_string();
                if value.is_empty() {
                    return Err("Claude approval path is invalid.".to_string());
                }
                segments.push(value);
            }
            Component::CurDir
            | Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => {
                return Err("Claude approval path is invalid.".to_string());
            }
        }
    }

    if segments.is_empty() {
        return Err("Claude approval path is empty.".to_string());
    }

    let normalized = segments.join("/");
    if normalized == ".git"
        || normalized.starts_with(".git/")
        || normalized.contains("/.git/")
        || normalized.ends_with("/.git")
    {
        return Err("Cannot write inside .git directory.".to_string());
    }

    Ok(normalized)
}

fn ensure_workspace_path_within_root(
    candidate: &Path,
    canonical_root: &Path,
) -> Result<(), String> {
    if !candidate.starts_with(canonical_root) {
        return Err("Invalid path outside workspace root.".to_string());
    }
    Ok(())
}

fn ensure_existing_workspace_target_within_root(
    candidate: &Path,
    canonical_root: &Path,
) -> Result<PathBuf, String> {
    let metadata = std::fs::symlink_metadata(candidate)
        .map_err(|error| format!("Failed to read path metadata: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("Claude approval preview cannot modify symlink targets.".to_string());
    }
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|error| format!("Failed to resolve approval path: {error}"))?;
    ensure_workspace_path_within_root(&canonical_candidate, canonical_root)?;
    Ok(canonical_candidate)
}

fn write_claude_approved_workspace_file(
    workspace_root: &Path,
    relative_path: &str,
    content: &str,
) -> Result<(), String> {
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace root: {error}"))?;
    let candidate = canonical_root.join(relative_path);
    ensure_workspace_path_within_root(&candidate, &canonical_root)?;
    if candidate.exists() {
        ensure_existing_workspace_target_within_root(&candidate, &canonical_root)?;
    }

    if content.len() > MAX_CLAUDE_APPROVAL_FILE_BYTES {
        return Err("File content exceeds maximum allowed size".to_string());
    }

    if let Some(parent) = candidate.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create parent directories: {error}"))?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|error| format!("Failed to resolve parent directory: {error}"))?;
        ensure_workspace_path_within_root(&canonical_parent, &canonical_root)?;
    }

    std::fs::write(&candidate, content).map_err(|error| format!("Failed to write file: {error}"))
}

fn touch_claude_approved_workspace_file(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<(), String> {
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace root: {error}"))?;
    let candidate = canonical_root.join(relative_path);
    ensure_workspace_path_within_root(&candidate, &canonical_root)?;
    if candidate.exists() {
        ensure_existing_workspace_target_within_root(&candidate, &canonical_root)?;
    }

    if let Some(parent) = candidate.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create parent directories: {error}"))?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|error| format!("Failed to resolve parent directory: {error}"))?;
        ensure_workspace_path_within_root(&canonical_parent, &canonical_root)?;
    }

    if candidate.exists() {
        return Ok(());
    }

    std::fs::write(&candidate, "").map_err(|error| format!("Failed to create file: {error}"))
}

fn create_claude_approved_workspace_directory(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<(), String> {
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace root: {error}"))?;
    let candidate = canonical_root.join(relative_path);
    ensure_workspace_path_within_root(&candidate, &canonical_root)?;

    if candidate.exists() {
        let canonical_candidate =
            ensure_existing_workspace_target_within_root(&candidate, &canonical_root)?;
        let metadata = std::fs::metadata(&canonical_candidate)
            .map_err(|error| format!("Failed to read path metadata: {error}"))?;
        if metadata.is_dir() {
            return Ok(());
        }
        return Err("Path already exists and is not a directory.".to_string());
    }

    std::fs::create_dir_all(&candidate)
        .map_err(|error| format!("Failed to create directory: {error}"))?;
    let canonical_dir = candidate
        .canonicalize()
        .map_err(|error| format!("Failed to resolve created directory: {error}"))?;
    ensure_workspace_path_within_root(&canonical_dir, &canonical_root)
}

fn edit_claude_approved_workspace_file(
    workspace_root: &Path,
    relative_path: &str,
    old_string: &str,
    new_string: &str,
) -> Result<(), String> {
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace root: {error}"))?;
    let candidate = canonical_root.join(relative_path);
    let canonical_candidate =
        ensure_existing_workspace_target_within_root(&candidate, &canonical_root)?;

    let current = std::fs::read_to_string(&canonical_candidate)
        .map_err(|error| format!("Failed to read file for edit approval: {error}"))?;
    if old_string.is_empty() {
        return Err("Claude Edit approval is missing old_string.".to_string());
    }
    if !current.contains(old_string) {
        return Err(format!(
            "Claude Edit approval could not find expected content in {relative_path}."
        ));
    }

    let updated = current.replacen(old_string, new_string, 1);
    std::fs::write(&canonical_candidate, updated)
        .map_err(|error| format!("Failed to write edited file: {error}"))
}

fn apply_claude_structured_edits_to_workspace_file(
    workspace_root: &Path,
    relative_path: &str,
    edits: &[LocalClaudeStructuredEdit],
) -> Result<(), String> {
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace root: {error}"))?;
    let candidate = canonical_root.join(relative_path);
    let canonical_candidate =
        ensure_existing_workspace_target_within_root(&candidate, &canonical_root)?;

    if edits.is_empty() {
        return Err("Claude MultiEdit approval did not include any edits.".to_string());
    }

    let mut current = std::fs::read_to_string(&canonical_candidate)
        .map_err(|error| format!("Failed to read file for multi-edit approval: {error}"))?;
    for edit in edits {
        if edit.old_string.is_empty() {
            return Err("Claude MultiEdit approval is missing old_string.".to_string());
        }
        if !current.contains(&edit.old_string) {
            return Err(format!(
                "Claude MultiEdit approval could not find expected content in {relative_path}."
            ));
        }
        current = if edit.replace_all {
            current.replace(&edit.old_string, &edit.new_string)
        } else {
            current.replacen(&edit.old_string, &edit.new_string, 1)
        };
    }

    std::fs::write(&canonical_candidate, current)
        .map_err(|error| format!("Failed to write multi-edited file: {error}"))
}

fn delete_claude_approved_workspace_path(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<(), String> {
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace root: {error}"))?;
    let candidate = canonical_root.join(relative_path);
    ensure_workspace_path_within_root(&candidate, &canonical_root)?;

    match std::fs::symlink_metadata(&candidate) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err("Claude approval preview cannot modify symlink targets.".to_string());
            }
            let canonical_candidate =
                ensure_existing_workspace_target_within_root(&candidate, &canonical_root)?;
            if metadata.is_dir() {
                std::fs::remove_dir_all(&canonical_candidate)
                    .map_err(|error| format!("Failed to delete directory: {error}"))?;
            } else {
                std::fs::remove_file(&canonical_candidate)
                    .map_err(|error| format!("Failed to delete file: {error}"))?;
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to read delete target metadata: {error}")),
    }
}

impl ClaudeSession {
    pub(super) fn push_synthetic_approval_summary(
        &self,
        turn_id: &str,
        entry: SyntheticApprovalSummaryEntry,
    ) {
        let trimmed = entry.summary.trim();
        if trimmed.is_empty() {
            return;
        }
        if let Ok(mut entries) = self.synthetic_approval_summaries_by_turn.lock() {
            entries
                .entry(turn_id.to_string())
                .or_default()
                .push(SyntheticApprovalSummaryEntry {
                    summary: trimmed.to_string(),
                    ..entry
                });
        }
    }

    pub(super) fn take_synthetic_approval_entries(
        &self,
        turn_id: &str,
    ) -> Vec<SyntheticApprovalSummaryEntry> {
        self.synthetic_approval_summaries_by_turn
            .lock()
            .ok()
            .and_then(|mut entries| entries.remove(turn_id))
            .unwrap_or_default()
    }

    fn summarize_non_file_approval(
        &self,
        summary: String,
        accepted: bool,
    ) -> SyntheticApprovalSummaryEntry {
        SyntheticApprovalSummaryEntry {
            summary,
            path: None,
            kind: None,
            status: if accepted {
                "completed".to_string()
            } else {
                "failed".to_string()
            },
        }
    }

    pub(super) fn store_approval_resume_message(&self, turn_id: &str, message: String) {
        if let Ok(mut messages) = self.approval_resume_message_by_turn.lock() {
            messages.insert(turn_id.to_string(), message);
        }
        if let Ok(notifies) = self.approval_notify_by_turn.lock() {
            if let Some(notify) = notifies.get(turn_id) {
                notify.notify_waiters();
            }
        }
    }

    pub(super) fn has_approval_resume_waiter_for_turn(&self, turn_id: &str) -> bool {
        self.approval_notify_by_turn
            .lock()
            .ok()
            .map(|notifies| notifies.contains_key(turn_id))
            .unwrap_or(false)
    }

    pub(super) fn finalize_synthetic_approval_turn(&self, turn_id: &str, result: Value) {
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnCompleted {
                workspace_id: self.workspace_id.clone(),
                result: Some(result),
            },
        );
        self.clear_turn_ephemeral_state(turn_id);
    }

    pub fn has_pending_approval_request(&self, request_id: &Value) -> bool {
        let Some(request_key) = normalize_claude_request_id_key(request_id) else {
            return false;
        };
        self.pending_approval_requests
            .lock()
            .ok()
            .map(|pending| pending.contains_key(&request_key))
            .unwrap_or(false)
    }

    pub(super) fn has_pending_approval_request_for_turn(&self, turn_id: &str) -> bool {
        self.pending_approval_requests
            .lock()
            .ok()
            .map(|pending| pending.values().any(|value| value == turn_id))
            .unwrap_or(false)
    }

    fn pending_approval_request_count_for_turn(&self, turn_id: &str) -> usize {
        self.pending_approval_requests
            .lock()
            .ok()
            .map(|pending| pending.values().filter(|value| *value == turn_id).count())
            .unwrap_or(0)
    }

    fn resolve_workspace_relative_tool_path(&self, raw_path: &str) -> Result<String, String> {
        let normalized_raw_path = normalize_claude_raw_path(raw_path);
        if normalized_raw_path.is_empty() {
            return Err("Claude approval path is empty.".to_string());
        }

        let candidate = PathBuf::from(&normalized_raw_path);
        if candidate.is_absolute() {
            let configured_root = self.workspace_path.clone();
            let canonical_root = configured_root
                .canonicalize()
                .map_err(|error| format!("Failed to resolve workspace root: {error}"))?;
            let normalized_absolute_candidate =
                resolve_absolute_candidate_against_existing_ancestor(&candidate)?;
            let relative = normalized_absolute_candidate
                .strip_prefix(&canonical_root)
                .or_else(|_| normalized_absolute_candidate.strip_prefix(&configured_root))
                .map_err(|_| {
                    format!(
                        "Claude approval path is outside workspace: {}",
                        candidate.display()
                    )
                })?;
            return normalize_claude_workspace_relative_path(relative);
        }

        normalize_claude_workspace_relative_path(&candidate)
    }

    fn resolve_local_file_approval_action(
        &self,
        tool_id: &str,
    ) -> Result<LocalClaudeFileApprovalAction, String> {
        let tool_name = self.peek_tool_name(tool_id).ok_or_else(|| {
            format!("Missing Claude tool metadata for approval request: {tool_id}")
        })?;
        let input = self
            .peek_tool_input_value(tool_id)
            .ok_or_else(|| format!("Missing Claude tool input for approval request: {tool_id}"))?;
        let normalized_tool_name = normalize_claude_tool_name_for_local_apply(&tool_name);

        match normalized_tool_name.as_str() {
            "bash" | "shell" | "shellcommand" | "nativecommand" | "run" | "exec"
            | "execcommand" => {
                let command = extract_claude_command_string(&input).ok_or_else(|| {
                    format!("Claude approval tool `{tool_name}` did not include a command.")
                })?;
                let file_command = parse_single_path_file_command(&command).ok_or_else(|| {
                    format!(
                        "Claude approval command `{command}` is not a supported single-file operation."
                    )
                })?;
                match file_command {
                    LocalClaudeFileCommand::Remove { path } => {
                        let relative_path = self.resolve_workspace_relative_tool_path(&path)?;
                        Ok(LocalClaudeFileApprovalAction::DeletePath { relative_path })
                    }
                    LocalClaudeFileCommand::MakeDirectory { path } => {
                        let relative_path = self.resolve_workspace_relative_tool_path(&path)?;
                        Ok(LocalClaudeFileApprovalAction::CreateDirectory { relative_path })
                    }
                    LocalClaudeFileCommand::Touch { path } => {
                        let relative_path = self.resolve_workspace_relative_tool_path(&path)?;
                        Ok(LocalClaudeFileApprovalAction::TouchFile { relative_path })
                    }
                }
            }
            "write" | "writefile" | "createfile" | "rewrite" => {
                let raw_path = extract_first_non_empty_string(&input, CLAUDE_FILE_PATH_KEYS)
                    .ok_or_else(|| {
                        format!("Claude approval tool `{tool_name}` did not include a path.")
                    })?;
                let relative_path = self.resolve_workspace_relative_tool_path(&raw_path)?;
                let content =
                    extract_first_non_empty_string(&input, CLAUDE_FILE_CONTENT_KEYS).unwrap_or_default();
                Ok(LocalClaudeFileApprovalAction::Write {
                    relative_path,
                    content,
                })
            }
            "edit" => {
                let raw_path = extract_first_non_empty_string(&input, CLAUDE_FILE_PATH_KEYS)
                    .ok_or_else(|| {
                        format!("Claude approval tool `{tool_name}` did not include a path.")
                    })?;
                let relative_path = self.resolve_workspace_relative_tool_path(&raw_path)?;
                let old_string =
                    extract_first_non_empty_string(&input, &["old_string", "oldString"])
                        .ok_or_else(|| {
                            format!(
                                "Claude approval tool `{tool_name}` did not include old_string."
                            )
                        })?;
                let new_string =
                    extract_first_non_empty_string(&input, &["new_string", "newString"])
                        .unwrap_or_default();
                Ok(LocalClaudeFileApprovalAction::Edit {
                    relative_path,
                    old_string,
                    new_string,
                })
            }
            "multiedit" => {
                let raw_path = extract_first_non_empty_string(&input, CLAUDE_FILE_PATH_KEYS)
                    .ok_or_else(|| {
                        format!("Claude approval tool `{tool_name}` did not include a path.")
                    })?;
                let relative_path = self.resolve_workspace_relative_tool_path(&raw_path)?;
                let edits = extract_claude_multiedit_operations(&input);
                if edits.is_empty() {
                    return Err(format!(
                        "Claude approval tool `{tool_name}` did not include structured edits."
                    ));
                }
                Ok(LocalClaudeFileApprovalAction::MultiEdit {
                    relative_path,
                    edits,
                })
            }
            "createdirectory" => {
                let raw_path = extract_first_non_empty_string(&input, CLAUDE_FILE_PATH_KEYS)
                    .ok_or_else(|| {
                        format!("Claude approval tool `{tool_name}` did not include a path.")
                    })?;
                let relative_path = self.resolve_workspace_relative_tool_path(&raw_path)?;
                Ok(LocalClaudeFileApprovalAction::CreateDirectory {
                    relative_path,
                })
            }
            "delete" | "deletefile" | "remove" | "removefile" | "unlink" => {
                let raw_path = extract_first_non_empty_string(&input, CLAUDE_FILE_PATH_KEYS)
                    .ok_or_else(|| {
                        format!("Claude approval tool `{tool_name}` did not include a path.")
                    })?;
                let relative_path = self.resolve_workspace_relative_tool_path(&raw_path)?;
                Ok(LocalClaudeFileApprovalAction::DeletePath { relative_path })
            }
            _ => Err(format!(
                "Claude preview approval currently supports Write/CreateFile/CreateDirectory/Edit/MultiEdit/Delete/Rewrite. Tool `{tool_name}` is not supported yet."
            )),
        }
    }

    fn apply_local_file_approval(
        &self,
        tool_id: &str,
    ) -> Result<SyntheticApprovalSummaryEntry, String> {
        match self.resolve_local_file_approval_action(tool_id)? {
            LocalClaudeFileApprovalAction::Write {
                relative_path,
                content,
            } => {
                let target_path = self.workspace_path.join(&relative_path);
                let existed_before_write = target_path.exists();
                write_claude_approved_workspace_file(
                    &self.workspace_path,
                    &relative_path,
                    &content,
                )?;
                Ok(SyntheticApprovalSummaryEntry {
                    summary: if existed_before_write {
                        format!("Approved and updated {relative_path}")
                    } else {
                        format!("Approved and wrote {relative_path}")
                    },
                    path: Some(relative_path),
                    kind: Some(
                        if existed_before_write {
                            "modified"
                        } else {
                            "add"
                        }
                        .to_string(),
                    ),
                    status: "completed".to_string(),
                })
            }
            LocalClaudeFileApprovalAction::TouchFile { relative_path } => {
                let target_path = self.workspace_path.join(&relative_path);
                let existed_before_touch = target_path.exists();
                touch_claude_approved_workspace_file(&self.workspace_path, &relative_path)?;
                Ok(SyntheticApprovalSummaryEntry {
                    summary: if existed_before_touch {
                        format!("Approved and touched {relative_path}")
                    } else {
                        format!("Approved and created {relative_path}")
                    },
                    path: Some(relative_path),
                    kind: Some(
                        if existed_before_touch {
                            "modified"
                        } else {
                            "add"
                        }
                        .to_string(),
                    ),
                    status: "completed".to_string(),
                })
            }
            LocalClaudeFileApprovalAction::Edit {
                relative_path,
                old_string,
                new_string,
            } => {
                edit_claude_approved_workspace_file(
                    &self.workspace_path,
                    &relative_path,
                    &old_string,
                    &new_string,
                )?;
                Ok(SyntheticApprovalSummaryEntry {
                    summary: format!("Approved and updated {relative_path}"),
                    path: Some(relative_path),
                    kind: Some("modified".to_string()),
                    status: "completed".to_string(),
                })
            }
            LocalClaudeFileApprovalAction::MultiEdit {
                relative_path,
                edits,
            } => {
                apply_claude_structured_edits_to_workspace_file(
                    &self.workspace_path,
                    &relative_path,
                    &edits,
                )?;
                Ok(SyntheticApprovalSummaryEntry {
                    summary: format!("Approved and updated {relative_path}"),
                    path: Some(relative_path),
                    kind: Some("modified".to_string()),
                    status: "completed".to_string(),
                })
            }
            LocalClaudeFileApprovalAction::CreateDirectory { relative_path } => {
                create_claude_approved_workspace_directory(&self.workspace_path, &relative_path)?;
                Ok(SyntheticApprovalSummaryEntry {
                    summary: format!("Approved and created directory {relative_path}"),
                    path: Some(relative_path),
                    kind: Some("add".to_string()),
                    status: "completed".to_string(),
                })
            }
            LocalClaudeFileApprovalAction::DeletePath { relative_path } => {
                delete_claude_approved_workspace_path(&self.workspace_path, &relative_path)?;
                Ok(SyntheticApprovalSummaryEntry {
                    summary: format!("Approved and deleted {relative_path}"),
                    path: Some(relative_path),
                    kind: Some("delete".to_string()),
                    status: "completed".to_string(),
                })
            }
        }
    }

    pub async fn respond_to_approval_request(
        &self,
        request_id: Value,
        result: Value,
    ) -> Result<(), String> {
        let Some(request_key) = normalize_claude_request_id_key(&request_id) else {
            return Err("invalid request_id for Claude approval".to_string());
        };
        let decision = match result {
            Value::String(value) => value.trim().to_ascii_lowercase(),
            Value::Object(map) => map
                .get("decision")
                .and_then(Value::as_str)
                .map(|value| value.trim().to_ascii_lowercase())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "invalid result for Claude approval".to_string())?,
            _ => return Err("invalid result for Claude approval".to_string()),
        };
        if decision != "accept" && decision != "decline" {
            return Err(format!("unsupported Claude approval result: {decision}"));
        }

        let Some(turn_id) = self
            .pending_approval_requests
            .lock()
            .map_err(|_| "pending_approval_requests lock poisoned".to_string())?
            .remove(&request_key)
        else {
            return Err(format!(
                "unknown request_id for Claude approval: {request_key}"
            ));
        };

        let tool_name = self.peek_tool_name(&request_key).unwrap_or_default();
        let is_file_change = matches!(
            classify_claude_mode_blocked_tool(&tool_name),
            Some(ClaudeModeBlockedKind::FileChange)
        ) || self
            .resolve_local_file_approval_action(&request_key)
            .is_ok();

        if !is_file_change {
            let summary = if decision == "accept" {
                "Approval acknowledged. The blocked request was not executed automatically; retry after changing Claude mode or permissions.".to_string()
            } else {
                "Blocked request was declined in the approval dialog.".to_string()
            };
            let error = if decision == "decline" {
                Some(summary.clone())
            } else {
                None
            };
            self.emit_tool_completion(&turn_id, &request_key, Some(summary.clone()), error);
            self.push_synthetic_approval_summary(
                &turn_id,
                self.summarize_non_file_approval(summary.clone(), decision == "accept"),
            );
            log::info!(
                "[claude] synthetic approval request acknowledged (request_id={}, result={})",
                request_key,
                decision
            );
            if self.pending_approval_request_count_for_turn(&turn_id) == 0 {
                let approval_entries = self.take_synthetic_approval_entries(&turn_id);
                let aggregated_summary =
                    format_synthetic_approval_completion_text(&approval_entries)
                        .unwrap_or_else(|| summary.trim().to_string());
                if self.has_approval_resume_waiter_for_turn(&turn_id) {
                    let resume_message =
                        format_synthetic_approval_resume_message(&approval_entries);
                    self.store_approval_resume_message(&turn_id, resume_message);
                } else {
                    self.finalize_synthetic_approval_turn(
                        &turn_id,
                        json!({
                            "syntheticApprovalResolved": true,
                            "approved": decision == "accept",
                            "text": aggregated_summary,
                        }),
                    );
                }
            }
            return Ok(());
        }

        if decision == "decline" {
            let message = "File change was declined in the approval dialog.".to_string();
            self.emit_tool_completion(
                &turn_id,
                &request_key,
                Some(message.clone()),
                Some(message.clone()),
            );
            self.push_synthetic_approval_summary(
                &turn_id,
                SyntheticApprovalSummaryEntry {
                    summary: message.clone(),
                    path: None,
                    kind: None,
                    status: "failed".to_string(),
                },
            );
            if self.pending_approval_request_count_for_turn(&turn_id) == 0 {
                let approval_entries = self.take_synthetic_approval_entries(&turn_id);
                let aggregated_summary =
                    format_synthetic_approval_completion_text(&approval_entries)
                        .unwrap_or_else(|| message.trim().to_string());
                if self.has_approval_resume_waiter_for_turn(&turn_id) {
                    let resume_message =
                        format_synthetic_approval_resume_message(&approval_entries);
                    self.store_approval_resume_message(&turn_id, resume_message);
                } else {
                    self.finalize_synthetic_approval_turn(
                        &turn_id,
                        json!({
                            "syntheticApprovalResolved": true,
                            "approved": false,
                            "text": aggregated_summary,
                        }),
                    );
                }
            }
            return Ok(());
        }

        let completion_result = match self.apply_local_file_approval(&request_key) {
            Ok(entry) => {
                self.emit_tool_completion(
                    &turn_id,
                    &request_key,
                    Some(entry.summary.clone()),
                    None,
                );
                self.push_synthetic_approval_summary(&turn_id, entry.clone());
                entry
            }
            Err(error) => {
                log::warn!(
                    "[claude] failed to apply approved file change locally (request_id={}): {}",
                    request_key,
                    error
                );
                self.emit_tool_completion(
                    &turn_id,
                    &request_key,
                    Some(error.clone()),
                    Some(error.clone()),
                );
                let entry = SyntheticApprovalSummaryEntry {
                    summary: error.clone(),
                    path: None,
                    kind: None,
                    status: "failed".to_string(),
                };
                self.push_synthetic_approval_summary(&turn_id, entry.clone());
                entry
            }
        };
        if self.pending_approval_request_count_for_turn(&turn_id) == 0 {
            let approval_entries = self.take_synthetic_approval_entries(&turn_id);
            let aggregated_summary = format_synthetic_approval_completion_text(&approval_entries)
                .unwrap_or_else(|| completion_result.summary.trim().to_string());
            if self.has_approval_resume_waiter_for_turn(&turn_id) {
                let resume_message = format_synthetic_approval_resume_message(&approval_entries);
                self.store_approval_resume_message(&turn_id, resume_message);
            } else {
                self.finalize_synthetic_approval_turn(
                    &turn_id,
                    json!({
                        "syntheticApprovalResolved": true,
                        "approved": decision == "accept",
                        "text": aggregated_summary,
                    }),
                );
            }
        }
        Ok(())
    }
}
