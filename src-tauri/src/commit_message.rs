//! AI commit-message generation: turn one repository's pending changes into
//! a Conventional Commits message, using the same channel configuration the
//! chat engines launch with.
//!
//! The prompt only ever carries repository state (status codes + diff text),
//! never credentials: the api key rides a request header, and every error
//! path below reports status/parse failures without echoing it.
//!
//! Channel → HTTP is defined exactly once, in `memory::review`
//! (`resolve_wire` / `call_channel`): Claude alias mapping, credential
//! priority, the `wire_api = "responses"` branch, and the dual Anthropic
//! auth headers all live there, so this module cannot drift from what the
//! chat path does.

use crate::config;
use crate::memory::review::{call_channel, resolve_wire, Wire};
use crate::provider_files::channel_field;

/// Patch text budget. The diff is only a hint for the model — the message
/// must stay cheap to produce, and a huge patch would both blow the context
/// window and stall the request for no gain.
const MAX_DIFF_CHARS: usize = 24_000;
const DIFF_TRUNCATION_NOTE: &str = "… diff truncated …";
/// Per-file cap for untracked content: large enough to show what a new file
/// is, small enough that a few fresh files cannot crowd out the tracked
/// diff. Binary or oversized files still list by path only.
const MAX_UNTRACKED_FILE_CHARS: usize = 4_096;
/// Model output budget: a commit message is a subject plus at most a short
/// body, so anything longer is the model rambling.
const MAX_MESSAGE_CHARS: usize = 500;

/// A channel resolved to everything one chat call needs.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ResolvedChannel {
    pub engine: String,
    pub wire: Wire,
}

/// HTTP credentials come from a configured channel; the official CLI config
/// has none, so generation only works once the user configures a channel.
pub(crate) const NO_CHANNEL_ERROR: &str =
    "未找到可用渠道：请在设置 → 渠道管理中为某个引擎配置渠道（baseUrl + apiKey + model）";

/// The first channel whose config yields both an endpoint and a credential,
/// scanning `config::ENGINES` in order so repeated calls agree. `engine`
/// restricts the scan to one engine; unknown ids fail loudly instead of
/// silently rerouting the request to another engine's channel, and an
/// explicit engine with no usable channel reports *why* instead of falling
/// through to a third party the user is not using.
pub(crate) fn first_usable_channel(engine_filter: Option<&str>) -> Result<ResolvedChannel, String> {
    let explicit = engine_filter.is_some();
    let candidates: Vec<&str> = match engine_filter {
        Some(engine) if config::ENGINES.contains(&engine) => vec![engine],
        Some(engine) => return Err(format!("未知的引擎：{engine}")),
        None => config::ENGINES.iter().copied().collect(),
    };
    let mut first_failure: Option<String> = None;
    for engine in candidates {
        // A disabled engine, or a section that cannot be read, is a normal
        // state of *some* engine - not a reason to fail the whole scan. Skip
        // it and keep looking, so a user who disabled one engine still gets a
        // message from another. An explicit request fails loudly instead.
        let provider = match config::resolve_provider(engine, None) {
            Ok(Some(provider)) => provider,
            Ok(None) if explicit => {
                // Official configs resolve to `None`: no HTTP credential.
                return Err(format!(
                    "引擎 {engine} 未配置渠道：请在设置 → 渠道管理中为它配置渠道（baseUrl + apiKey + model）"
                ));
            }
            Ok(None) => continue,
            Err(error) if explicit => return Err(format!("引擎 {engine} 不可用：{error}")),
            Err(_) => continue,
        };
        // No live session backs this call, so the channel's own configured
        // model takes the session-model slot: for Claude that also routes
        // opus/sonnet-style UI aliases through resolve_claude_channel_model
        // (relays reject the bare alias as an unknown model).
        let configured_model = channel_field(engine, &provider, "model");
        match resolve_wire(engine, &provider, configured_model.as_deref()) {
            Ok(wire) => {
                return Ok(ResolvedChannel {
                    engine: engine.to_string(),
                    wire,
                })
            }
            Err(reason) if explicit => {
                return Err(format!("引擎 {engine} 的渠道不可用：{reason}"))
            }
            Err(reason) => {
                first_failure.get_or_insert_with(|| format!("{engine}: {reason}"));
            }
        }
    }
    Err(match first_failure {
        Some(reason) => format!("{NO_CHANNEL_ERROR}（{reason}）"),
        None => NO_CHANNEL_ERROR.to_string(),
    })
}

// ==================== Repository context ====================

/// Which changes the message describes. Staged wins because `git_commit`
/// commits the index — describing the worktree instead would produce a
/// message about changes the commit does not contain. `Selected` is the
/// commit button's actual plan: exactly the checked paths, staged or not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DiffScope {
    Staged,
    Worktree,
    Selected,
}

fn staged_bucket(status: git2::Status) -> bool {
    status.intersects(
        git2::Status::INDEX_NEW
            | git2::Status::INDEX_MODIFIED
            | git2::Status::INDEX_DELETED
            | git2::Status::INDEX_RENAMED
            | git2::Status::INDEX_TYPECHANGE,
    )
}

fn worktree_bucket(status: git2::Status) -> bool {
    status.intersects(
        git2::Status::WT_MODIFIED
            | git2::Status::WT_DELETED
            | git2::Status::WT_TYPECHANGE
            | git2::Status::WT_RENAMED,
    )
}

fn untracked_only(status: git2::Status) -> bool {
    status.contains(git2::Status::WT_NEW) && !status.intersects(git2::Status::INDEX_NEW)
}

/// `git status --short`-style file list for one scope, sorted so the prompt
/// is stable across clicks. Untracked paths are listed by name only — their
/// content is not part of either diff and would swamp the budget.
fn status_short_lines(repo: &git2::Repository, scope: DiffScope) -> Result<String, String> {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = Vec::new();
    for entry in statuses.iter() {
        let Some(path) = entry.path().filter(|path| !path.is_empty()) else {
            continue;
        };
        let status = entry.status();
        match scope {
            DiffScope::Staged if staged_bucket(status) => {
                lines.push(format!("{} {}", code_for(status), path))
            }
            DiffScope::Worktree if untracked_only(status) => {
                lines.push(format!("?? {path}"))
            }
            DiffScope::Worktree if worktree_bucket(status) => {
                lines.push(format!("{} {}", code_for(status), path))
            }
            _ => {}
        }
    }
    lines.sort();
    Ok(lines.join("\n"))
}

/// Two-letter `git status --short` index/worktree code. The commit-message
/// prompt shows the file list in that familiar shape.
fn code_for(status: git2::Status) -> String {
    let staged = if status.intersects(git2::Status::INDEX_NEW) {
        "A"
    } else if status.intersects(git2::Status::INDEX_DELETED) {
        "D"
    } else if status.intersects(
        git2::Status::INDEX_RENAMED | git2::Status::INDEX_TYPECHANGE,
    ) {
        "R"
    } else if status.intersects(git2::Status::INDEX_MODIFIED) {
        "M"
    } else {
        " "
    };
    let worktree = if untracked_only(status) {
        "?"
    } else if status.intersects(git2::Status::WT_NEW) {
        "A"
    } else if status.intersects(git2::Status::WT_DELETED) {
        "D"
    } else if status.intersects(git2::Status::WT_RENAMED) {
        "R"
    } else if status.intersects(
        git2::Status::WT_TYPECHANGE | git2::Status::WT_MODIFIED,
    ) {
        "M"
    } else {
        " "
    };
    format!("{staged}{worktree}")
}

/// Pick the scope: staged when the index has content, otherwise the
/// worktree — so the generate button stays useful before anything is staged.
pub(crate) fn choose_scope(repo: &git2::Repository) -> Result<DiffScope, String> {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(false);
    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
    Ok(if statuses.iter().any(|entry| staged_bucket(entry.status())) {
        DiffScope::Staged
    } else {
        DiffScope::Worktree
    })
}

/// Append `chunk` to `text` within MAX_DIFF_CHARS. Returns false once the
/// budget is exhausted, which is the caller's stop signal. The cut lands on a
/// char boundary: the budget counts chars, and slicing mid-character would
/// panic.
fn push_capped(text: &mut String, chunk: &str) -> bool {
    let room = MAX_DIFF_CHARS.saturating_sub(text.len());
    if room == 0 {
        return false;
    }
    let mut take = chunk.len().min(room);
    while take > 0 && !chunk.is_char_boundary(take) {
        take -= 1;
    }
    text.push_str(&chunk[..take]);
    take == chunk.len()
}

/// The patch character for a diff line. git2 hands back the line body with
/// the origin stripped, so without this the model receives file content with
/// no sign of what was added or removed.
fn origin_marker(origin: char) -> &'static str {
    match origin {
        // `=`/`>`/`<` mark a missing trailing newline and carry no content of
        // their own, so they read as context.
        ' ' | '=' | '>' | '<' => " ",
        '+' => "+",
        '-' => "-",
        // Headers and the binary notice already arrive complete.
        _ => "",
    }
}

/// Append the patch within MAX_DIFF_CHARS. The returned flag reports whether
/// the budget stopped the print early — the caller appends the truncation
/// note so the model knows the view is partial.
fn append_patch(diff: &git2::Diff, text: &mut String) -> Result<bool, String> {
    let mut truncated = false;
    let result = diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let marker = origin_marker(line.origin());
        if !push_capped(text, marker) {
            truncated = true;
            return false;
        }
        let content = line.content();
        if !push_capped(text, std::str::from_utf8(content).unwrap_or("")) {
            truncated = true;
            return false;
        }
        true
    });
    match result {
        Ok(()) => Ok(truncated),
        // Our own stop: git2 maps the `false` return to GIT_EUSER.
        Err(e) if truncated && e.code() == git2::ErrorCode::User => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

/// Render the diff for one scope as patch text within MAX_DIFF_CHARS. The
/// flag reports truncation, so the caller can mark the cut for the model.
fn render_diff(repo: &git2::Repository, scope: DiffScope) -> Result<(String, bool), String> {
    let mut text = String::new();
    let mut truncated;
    let mut opts = git2::DiffOptions::new();
    // libgit2 emits no context lines by default, which strips the +/- markers
    // and hands the model file content with no sign of what changed. Three
    // context lines is what `git diff` shows, so the prompt reads like a
    // normal diff and stays interpretable.
    opts.context_lines(3);
    match scope {
        DiffScope::Staged => {
            // An unborn HEAD has no tree; diffing against None compares the
            // index to the empty tree, i.e. exactly the initial commit.
            let head_tree = repo.head().and_then(|head| head.peel_to_tree()).ok();
            let diff = repo
                .diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
                .map_err(|e| e.to_string())?;
            truncated = append_patch(&diff, &mut text)?;
        }
        DiffScope::Worktree => {
            let diff = repo
                .diff_index_to_workdir(None, Some(&mut opts))
                .map_err(|e| e.to_string())?;
            truncated = append_patch(&diff, &mut text)?;
            let untracked: Vec<String> = status_short_lines(repo, scope)?
                .lines()
                .filter(|line| line.starts_with("?? "))
                .map(|line| line[3..].to_string())
                .collect();
            truncated |= append_untracked_files(repo.workdir(), &mut text, &untracked);
        }
        // build_context routes Selected to selected_context, which renders
        // via render_selected_diff against the exact commit content.
        DiffScope::Selected => unreachable!("selected scope renders via render_selected_diff"),
    }
    Ok((text, truncated))
}

/// Untracked files: a small UTF-8 regular file gets its content as `+` lines,
/// like a new-file patch, so a commit whose whole point is "add these files"
/// leaves the model more than a file name to describe. Binary, unreadable,
/// oversized, symlinked, or non-regular files stay path-only, and everything
/// shares the one MAX_DIFF_CHARS budget with the tracked diff. Returns true
/// when the budget cut the listing short.
fn append_untracked_files(
    workdir: Option<&std::path::Path>,
    text: &mut String,
    paths: &[String],
) -> bool {
    if paths.is_empty() {
        return false;
    }
    if !text.is_empty() && !text.ends_with('\n') {
        push_capped(text, "\n");
    }
    if !push_capped(text, "Untracked files (small text files include content):\n") {
        return true;
    }
    let mut truncated = false;
    'files: for path in paths {
        if !push_capped(text, &format!("?? {path}\n")) {
            truncated = true;
            break;
        }
        let content = workdir.and_then(|dir| read_untracked_text(dir, path));
        let Some(content) = content else {
            continue;
        };
        for line in content.lines() {
            if !push_capped(text, "+") || !push_capped(text, line) || !push_capped(text, "\n") {
                truncated = true;
                break 'files;
            }
        }
    }
    truncated
}

/// Read an untracked path only when it is a regular file within the per-file
/// budget. `symlink_metadata` keeps a symlink from pulling a target outside
/// the worktree into the prompt, and the bounded read avoids loading a huge
/// file just to discard it.
fn read_untracked_text(workdir: &std::path::Path, path: &str) -> Option<String> {
    use std::io::Read;

    let full_path = workdir.join(path);
    let metadata = std::fs::symlink_metadata(&full_path).ok()?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_UNTRACKED_FILE_CHARS as u64 {
        return None;
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    let file = std::fs::File::open(&full_path).ok()?;
    file.take(MAX_UNTRACKED_FILE_CHARS as u64 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > MAX_UNTRACKED_FILE_CHARS {
        return None;
    }
    String::from_utf8(bytes).ok()
}

/// Mark a diff cut short, so the model is told the view is partial instead
/// of silently assuming it saw everything. The render step's truncation flag
/// is the only trustworthy signal: the text alone cannot tell "exactly full"
/// from "cut short", since renderers already stop at MAX_DIFF_CHARS.
fn with_truncation_note(mut text: String, truncated: bool) -> String {
    if !truncated {
        return text;
    }
    // Keep the note inside the budget: cut back to a char boundary that
    // leaves room for it.
    let mut room = MAX_DIFF_CHARS.saturating_sub(DIFF_TRUNCATION_NOTE.len());
    while room > 0 && !text.is_char_boundary(room) {
        room -= 1;
    }
    text.truncate(room);
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(DIFF_TRUNCATION_NOTE);
    text
}

/// Repository context: the file list plus the diff for the chosen scope.
#[derive(Debug)]
pub(crate) struct CommitContext {
    pub scope: DiffScope,
    pub files: String,
    pub diff: String,
}

/// Context for an explicit selection — exactly the paths the commit button
/// stages and commits, so the generated message never describes files the
/// commit leaves out (or misses files it picks up). The commit stages every
/// selected path first, so the content to describe is HEAD vs the worktree
/// (staged edits included), restricted to the selection.
fn selected_context(repo: &git2::Repository, paths: &[String]) -> Result<CommitContext, String> {
    let wanted: std::collections::HashSet<&str> =
        paths.iter().map(String::as_str).collect();
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = Vec::new();
    let mut tracked: Vec<String> = Vec::new();
    let mut untracked: Vec<String> = Vec::new();
    for entry in statuses.iter() {
        let Some(path) = entry.path().filter(|path| !path.is_empty()) else {
            continue;
        };
        if !wanted.contains(path) {
            continue;
        }
        if untracked_only(entry.status()) {
            untracked.push(path.to_string());
            lines.push(format!("?? {path}"));
        } else {
            tracked.push(path.to_string());
            lines.push(format!("{} {}", code_for(entry.status()), path));
        }
    }
    if lines.is_empty() {
        return Err("没有可提交的变更".to_string());
    }
    lines.sort();
    let (diff, truncated) = render_selected_diff(repo, &tracked, &untracked)?;
    let diff = with_truncation_note(diff, truncated);
    Ok(CommitContext {
        scope: DiffScope::Selected,
        files: lines.join("\n"),
        diff,
    })
}

/// Patch for the selected tracked paths: HEAD tree → workdir-with-index is
/// the exact content the commit will carry once the selected paths are
/// staged. Selected untracked files get the same treatment as the worktree
/// scope: small text content inline, the rest path-only.
fn render_selected_diff(
    repo: &git2::Repository,
    tracked: &[String],
    untracked: &[String],
) -> Result<(String, bool), String> {
    let mut text = String::new();
    let mut truncated = false;
    if !tracked.is_empty() {
        let mut opts = git2::DiffOptions::new();
        // Same three context lines as `git diff`, same rationale as
        // render_diff: without them the +/- markers vanish.
        // Checkbox paths are literal file names, not glob patterns (for
        // example a Next.js route named [id].tsx must not include i.tsx).
        opts.context_lines(3).disable_pathspec_match(true);
        for path in tracked {
            opts.pathspec(path);
        }
        // An unborn HEAD has no tree; diffing against None compares against
        // the empty tree, i.e. exactly the initial commit.
        let head_tree = repo.head().and_then(|head| head.peel_to_tree()).ok();
        let diff = repo
            .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut opts))
            .map_err(|e| e.to_string())?;
        truncated = append_patch(&diff, &mut text)?;
    }
    truncated |= append_untracked_files(repo.workdir(), &mut text, untracked);
    Ok((text, truncated))
}

pub(crate) fn build_context(
    repo: &git2::Repository,
    selection: Option<&[String]>,
) -> Result<CommitContext, String> {
    if let Some(paths) = selection {
        return selected_context(repo, paths);
    }
    let scope = choose_scope(repo)?;
    let files = status_short_lines(repo, scope)?;
    if files.trim().is_empty() {
        return Err("没有可提交的变更".to_string());
    }
    let (diff, truncated) = render_diff(repo, scope)?;
    let diff = with_truncation_note(diff, truncated);
    Ok(CommitContext { scope, files, diff })
}

// ==================== Prompt ====================

/// Prompt language follows the UI locale: a Chinese user asking for a
/// message gets a Chinese one back.
pub(crate) fn prompt_language(locale: &str) -> &'static str {
    if locale.trim().to_ascii_lowercase().starts_with("zh") {
        "中文"
    } else {
        "English"
    }
}

fn scope_heading(scope: DiffScope) -> &'static str {
    match scope {
        DiffScope::Staged => "staged changes",
        DiffScope::Worktree => "unstaged and untracked changes",
        DiffScope::Selected => "selected changes",
    }
}

/// Build the model prompt. The format rules are strict because the reply is
/// pasted straight into the commit-message box: fences or preamble would have
/// to be stripped by the user.
pub(crate) fn build_prompt(context: &CommitContext, locale: &str) -> String {
    let heading = scope_heading(context.scope);
    let rules = if prompt_language(locale) == "中文" {
        "请用中文撰写。\n\
         格式要求：Conventional Commits 风格的标题行（形如 feat: 增加多项目变更面板），不超过 72 个字符。\n\
         只输出提交信息本身，不要代码块围栏、不要解释、不要前言。"
    } else {
        "Write the message in English.\n\
         Format: a Conventional Commits style subject line (at most 72 characters), \
         followed by a short body only when the change needs one.\n\
         Output the commit message only — no code fences, no explanation, no preamble."
    };
    format!(
        "You are writing a Git commit message for the {heading} below.\n\n\
         Changed files (git status --short):\n{files}\n\n\
         Diff of the {heading}:\n{diff}\n\n{rules}\n",
        files = context.files,
        diff = context.diff,
    )
}

// ==================== Response handling ====================

/// Strip a markdown fence the model wrapped its answer in, including the
/// optional info string (```` ```text ````) that would otherwise be mistaken
/// for the first line of the message.
fn strip_code_fence(text: &str) -> String {
    let trimmed = text.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return trimmed.to_string();
    };
    let rest = rest.trim_start_matches(['\r', '\n']);
    // Drop the info string: a single line with no newline-terminated text
    // before the closing fence is a language tag, not the message.
    let body = match rest.find('\n') {
        Some(newline) if !rest[..newline].contains(' ') => {
            rest[newline + 1..].trim_start_matches(['\r', '\n'])
        }
        _ => rest,
    };
    match body.rfind("```") {
        Some(end) => body[..end].trim_end().to_string(),
        None => body.trim_end().to_string(),
    }
}

fn strip_wrapping_quotes(text: &str) -> String {
    let mut out = text.trim().to_string();
    for _ in 0..2 {
        let unquoted = ['"', '\'', '\u{201C}']
            .into_iter()
            .find_map(|quote| {
                let closing = if quote == '\u{201C}' {
                    '\u{201D}'
                } else {
                    quote
                };
                let quoted = out.len()
                    > quote.len_utf8() + closing.len_utf8()
                    && out.starts_with(quote)
                    && out.ends_with(closing);
                quoted.then(|| {
                    out[quote.len_utf8()..out.len() - closing.len_utf8()]
                        .trim()
                        .to_string()
                })
            });
        match unquoted {
            Some(inner) => out = inner,
            None => break,
        }
    }
    out
}

/// Collapse the reply into the shape the commit box accepts: no fences, no
/// wrapping quotes, a subject line plus an optional body, capped length.
pub(crate) fn clean_message(raw: &str) -> String {
    let text = strip_wrapping_quotes(&strip_code_fence(raw));
    let mut lines = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());
    let Some(subject) = lines.next() else {
        return String::new();
    };
    // Body bullets are noise in a commit box: keep prose lines only.
    let body: Vec<&str> = lines
        .take_while(|line| !line.starts_with('-') && !line.starts_with('*'))
        .collect();

    let mut out = subject.to_string();
    if !body.is_empty() {
        out.push_str("\n\n");
        out.push_str(&body.join(" "));
    }
    if out.chars().count() <= MAX_MESSAGE_CHARS {
        return out;
    }
    // The ellipsis is part of the budget, so keep one char less: a message of
    // exactly MAX_MESSAGE_CHARS characters plus the marker would exceed it.
    let capped: String = out.chars().take(MAX_MESSAGE_CHARS - 1).collect();
    format!("{}…", capped.trim_end())
}

// ==================== Commands ====================

/// What the generate button produced, plus the channel it went through — the
/// UI shows the engine/host so a repo diff never leaves for a third party
/// the user did not see named.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedCommitMessage {
    pub message: String,
    pub engine: String,
    pub base_url: String,
}

/// Channel the generate button would use for one engine; feeds its tooltip.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitMessageChannel {
    pub engine: String,
    pub base_url: String,
}

async fn generate_commit_message_impl(
    engine: Option<String>,
    path: String,
    locale: String,
    files: Option<Vec<String>>,
) -> Result<GeneratedCommitMessage, String> {
    // Status + diff walks belong off the async runtime, same rationale as
    // `git_status_blocking`.
    let context = tauri::async_runtime::spawn_blocking(move || {
        let repo = crate::git::open_repo(&path)?;
        build_context(&repo, files.as_deref())
    })
    .await
    .map_err(|e| e.to_string())??;

    let channel = first_usable_channel(engine.as_deref())?;
    let prompt = build_prompt(&context, &locale);
    let raw = call_channel(&channel.wire, &prompt)
        .await
        .map_err(|e| format!("请求渠道失败：{e}"))?;
    let message = clean_message(&raw);
    if message.is_empty() {
        return Err("模型未返回提交信息".to_string());
    }
    Ok(GeneratedCommitMessage {
        message,
        engine: channel.engine,
        base_url: channel.wire.base_url,
    })
}

/// Ask the configured channel for a commit message describing `path`'s pending
/// changes. `files` restricts the described set to the paths the commit
/// button would actually commit; `None` describes the index (or the worktree
/// when nothing is staged). Errors are short, actionable Chinese text;
/// credentials never appear in them.
#[tauri::command]
pub async fn git_generate_commit_message(
    engine: Option<String>,
    path: String,
    locale: String,
    files: Option<Vec<String>>,
) -> Result<GeneratedCommitMessage, String> {
    generate_commit_message_impl(engine, path, locale, files).await
}

/// Resolve the channel the generate button will use for `engine`, so its
/// tooltip can name the engine and host the repo diff would be sent to.
#[tauri::command]
pub fn git_commit_message_channel(engine: String) -> Result<CommitMessageChannel, String> {
    let channel = first_usable_channel(Some(&engine))?;
    Ok(CommitMessageChannel {
        engine: channel.engine,
        base_url: channel.wire.base_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::path::PathBuf;

    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "ccgui-next-commit-message-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn commit_file(repo: &git2::Repository, relative: &str, content: &str) {
        let workdir = repo.workdir().unwrap();
        std::fs::write(workdir.join(relative), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(relative)).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("t", "t@example.com").unwrap();
        // git2 wants a slice of borrowed commits, not owned ones.
        let parent = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
        let parents: Vec<&git2::Commit<'_>> = parent.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, "init\n", &tree, &parents)
            .unwrap();
    }

    fn stage(repo: &git2::Repository, relative: &str) {
        let mut index = repo.index().unwrap();
        let path = std::path::Path::new(relative);
        // A path that no longer exists on disk is a deletion, and add_path
        // rejects it outright.
        if repo.workdir().unwrap().join(relative).exists() {
            index.add_path(path).unwrap();
        } else {
            index.remove_path(path).unwrap();
        }
        index.write().unwrap();
    }

    #[test]
    fn scope_prefers_staged_and_falls_back_to_the_worktree() {
        let scratch = Scratch::new();
        let repo = git2::Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "tracked.txt", "one\n");
        // Nothing staged, one worktree edit -> worktree scope.
        std::fs::write(scratch.0.join("tracked.txt"), "two\n").unwrap();
        assert_eq!(choose_scope(&repo).unwrap(), DiffScope::Worktree);

        // Staging it switches scope to what `git_commit` would actually write.
        stage(&repo, "tracked.txt");
        assert_eq!(choose_scope(&repo).unwrap(), DiffScope::Staged);

        let context = build_context(&repo, None).unwrap();
        assert_eq!(context.scope, DiffScope::Staged);
        assert!(context.files.contains("tracked.txt"));
        assert!(context.diff.contains("+two"));
    }

    #[test]
    fn staged_context_ignores_unstaged_edits() {
        let scratch = Scratch::new();
        let repo = git2::Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "a.txt", "a\n");
        commit_file(&repo, "b.txt", "b\n");
        // Stage a real edit to a.txt; staging an unchanged file would leave
        // the index clean and there would be nothing staged to describe.
        std::fs::write(scratch.0.join("a.txt"), "a staged\n").unwrap();
        stage(&repo, "a.txt");
        std::fs::write(scratch.0.join("b.txt"), "changed\n").unwrap();

        let context = build_context(&repo, None).unwrap();
        assert_eq!(context.scope, DiffScope::Staged);
        assert!(context.files.contains("a.txt"));
        assert!(!context.files.contains("b.txt"));
    }

    #[test]
    fn status_codes_use_the_short_two_letter_form() {
        let scratch = Scratch::new();
        let repo = git2::Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "keep.txt", "k\n");
        commit_file(&repo, "edit.txt", "e\n");
        commit_file(&repo, "drop.txt", "d\n");
        // Each staged path must actually differ from HEAD, or the index is
        // clean and there is no status code to report.
        std::fs::write(scratch.0.join("edit.txt"), "e staged\n").unwrap();
        stage(&repo, "edit.txt");
        std::fs::remove_file(scratch.0.join("drop.txt")).unwrap();
        stage(&repo, "drop.txt");
        std::fs::write(scratch.0.join("fresh.txt"), "new\n").unwrap();

        let staged = status_short_lines(&repo, DiffScope::Staged).unwrap();
        assert!(staged.contains("M  edit.txt"), "staged list: {staged}");
        assert!(staged.contains("D  drop.txt"), "staged list: {staged}");
        assert!(!staged.contains("keep.txt"), "clean paths: {staged}");
        assert!(!staged.contains("fresh.txt"), "untracked: {staged}");

        // Now edit the worktree copy of a staged file: the staged column stays
        // `M` and the worktree column becomes `M`, i.e. `MM`.
        std::fs::write(scratch.0.join("edit.txt"), "edited again\n").unwrap();
        let staged = status_short_lines(&repo, DiffScope::Staged).unwrap();
        assert!(staged.contains("MM edit.txt"), "staged list: {staged}");

        // An unstaged edit to a committed file is worktree-only: ` M`.
        std::fs::write(scratch.0.join("keep.txt"), "k changed\n").unwrap();

        // Worktree scope reports both, and stays silent about the deletion
        // already staged and the untouched remainder.
        let worktree = status_short_lines(&repo, DiffScope::Worktree).unwrap();
        assert!(worktree.contains("MM edit.txt"), "worktree list: {worktree}");
        assert!(worktree.contains(" M keep.txt"), "worktree list: {worktree}");
        assert!(worktree.contains("?? fresh.txt"), "worktree list: {worktree}");
        assert!(!worktree.contains("drop.txt"), "worktree list: {worktree}");
    }

    #[test]
    fn worktree_context_includes_small_untracked_content() {
        let scratch = Scratch::new();
        let repo = git2::Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "a.txt", "a\n");
        std::fs::write(scratch.0.join("fresh.txt"), "brand new content\n").unwrap();
        // Oversized text and non-UTF-8 binary stay path-only: their content
        // would swamp the diff budget or read as garbage.
        std::fs::write(
            scratch.0.join("big.txt"),
            "oversized marker\n".repeat(MAX_UNTRACKED_FILE_CHARS / 8),
        )
        .unwrap();
        std::fs::write(scratch.0.join("bin.dat"), [0xff, 0xfe, 0x00, 0x01]).unwrap();
        std::fs::write(scratch.0.join("a.txt"), "a changed\n").unwrap();

        let context = build_context(&repo, None).unwrap();
        assert_eq!(context.scope, DiffScope::Worktree);
        assert!(context.files.contains("?? fresh.txt"));
        assert!(context.diff.contains("+a changed"), "diff was {:?}", context.diff);
        // A commit whose point is a new file must show that file's content.
        assert!(context.diff.contains("+brand new content"), "diff was {:?}", context.diff);
        assert!(context.diff.contains("?? big.txt"), "diff was {:?}", context.diff);
        assert!(!context.diff.contains("oversized marker"), "diff was {:?}", context.diff);
        assert!(context.diff.contains("?? bin.dat"), "diff was {:?}", context.diff);
        assert!(!context.diff.contains(DIFF_TRUNCATION_NOTE), "diff was {:?}", context.diff);
    }

    #[test]
    fn untracked_helper_skips_non_regular_paths() {
        let scratch = Scratch::new();
        std::fs::create_dir(scratch.0.join("folder")).unwrap();
        assert!(read_untracked_text(&scratch.0, "folder").is_none());
    }

    #[test]
    fn untracked_helper_skips_files_over_the_per_file_budget() {
        let scratch = Scratch::new();
        std::fs::write(
            scratch.0.join("big.txt"),
            "x".repeat(MAX_UNTRACKED_FILE_CHARS + 1),
        )
        .unwrap();
        assert!(read_untracked_text(&scratch.0, "big.txt").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn untracked_symlink_content_stays_out_of_the_prompt() {
        use std::os::unix::fs::symlink;

        let scratch = Scratch::new();
        let repo = git2::Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "a.txt", "a\n");
        let outside = Scratch::new();
        std::fs::write(outside.0.join("secret.txt"), "outside secret\n").unwrap();
        symlink(outside.0.join("secret.txt"), scratch.0.join("link.txt")).unwrap();
        std::fs::write(scratch.0.join("a.txt"), "a changed\n").unwrap();

        let context = build_context(&repo, None).unwrap();
        assert_eq!(context.scope, DiffScope::Worktree);
        assert!(context.files.contains("?? link.txt"), "files: {}", context.files);
        assert!(context.diff.contains("?? link.txt"), "diff: {}", context.diff);
        assert!(
            !context.diff.contains("outside secret"),
            "diff leaked symlink target: {}",
            context.diff
        );
    }

    #[test]
    fn context_without_changes_is_an_error() {
        let scratch = Scratch::new();
        let repo = git2::Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "a.txt", "a\n");
        assert_eq!(
            build_context(&repo, None).unwrap_err(),
            "没有可提交的变更"
        );
    }

    #[test]
    fn unborn_head_staged_diff_still_produces_a_patch() {
        let scratch = Scratch::new();
        let repo = git2::Repository::init(&scratch.0).unwrap();
        std::fs::write(scratch.0.join("first.txt"), "hello\n").unwrap();
        stage(&repo, "first.txt");

        let context = build_context(&repo, None).unwrap();
        assert_eq!(context.scope, DiffScope::Staged);
        assert!(context.diff.contains("+hello"));
    }

    #[test]
    fn oversized_diff_is_capped_with_a_visible_note() {
        let scratch = Scratch::new();
        let repo = git2::Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "base.txt", "base\n");
        // One staged file far past the budget: the prompt must say the diff
        // was cut, not silently describe a partial view.
        std::fs::write(
            scratch.0.join("huge.txt"),
            "x".repeat(MAX_DIFF_CHARS + 5_000),
        )
        .unwrap();
        stage(&repo, "huge.txt");

        let context = build_context(&repo, None).unwrap();
        assert_eq!(context.scope, DiffScope::Staged);
        assert!(
            context.diff.ends_with(DIFF_TRUNCATION_NOTE),
            "diff tail: {:?}",
            &context.diff[context.diff.len().saturating_sub(80)..]
        );
        assert!(context.diff.len() <= MAX_DIFF_CHARS + 1);

        // An ordinary diff stays untouched: no note, no clipping.
        let small = Scratch::new();
        let small_repo = git2::Repository::init(&small.0).unwrap();
        std::fs::write(small.0.join("a.txt"), "hello\n").unwrap();
        stage(&small_repo, "a.txt");
        let context = build_context(&small_repo, None).unwrap();
        assert!(context.diff.contains("+hello"));
        assert!(!context.diff.contains(DIFF_TRUNCATION_NOTE));
    }

    #[test]
    fn truncation_note_never_splits_a_multibyte_char() {
        // The budget is in bytes, so the cut can land mid-character — slicing
        // there would panic instead of truncating.
        let cjk = "提".repeat(MAX_DIFF_CHARS);
        let capped = with_truncation_note(cjk, true);
        assert!(capped.ends_with(DIFF_TRUNCATION_NOTE));
        // 24_000 is not a multiple of 3, so alignment genuinely had to move.
        assert!(capped.len() <= MAX_DIFF_CHARS + 1);
        let body = capped.strip_suffix(DIFF_TRUNCATION_NOTE).unwrap();
        assert!(body.chars().all(|c| c == '提' || c == '\n'));
    }

    #[test]
    fn prompt_language_follows_the_locale_prefix() {
        assert_eq!(prompt_language("zh-CN"), "中文");
        assert_eq!(prompt_language("zh"), "中文");
        assert_eq!(prompt_language(" ZH-tw "), "中文");
        assert_eq!(prompt_language("en-US"), "English");
        assert_eq!(prompt_language(""), "English");
    }

    #[test]
    fn prompt_carries_files_diff_and_language_rules() {
        let context = CommitContext {
            scope: DiffScope::Staged,
            files: "M  src/app.ts".to_string(),
            diff: "diff --git a/src/app.ts\n".to_string(),
        };
        let zh = build_prompt(&context, "zh-CN");
        assert!(zh.contains("M  src/app.ts"));
        assert!(zh.contains("diff --git a/src/app.ts"));
        assert!(zh.contains("请用中文撰写"));
        assert!(zh.contains("Conventional Commits"));

        let en = build_prompt(&context, "en-US");
        assert!(en.contains("Write the message in English"));
        assert!(!en.contains("请用中文撰写"));

        let worktree = CommitContext {
            scope: DiffScope::Worktree,
            files: "?? new.txt".to_string(),
            diff: "patch".to_string(),
        };
        assert!(build_prompt(&worktree, "en").contains("unstaged and untracked"));
    }

    #[test]
    fn cleaning_strips_fences_quotes_and_padding() {
        assert_eq!(
            clean_message("```\nfeat: add panel\n```"),
            "feat: add panel"
        );
        assert_eq!(clean_message("```text\nchore: init```"), "chore: init");
        assert_eq!(clean_message("  \"feat: add panel\"  "), "feat: add panel");
        assert_eq!(clean_message("\u{201C}fix: guard\u{201D}"), "fix: guard");
        assert_eq!(
            clean_message("feat: add panel\n\nadds per-repo sections\n- a\n- b"),
            "feat: add panel\n\nadds per-repo sections"
        );
        assert_eq!(clean_message("   \n  \n"), "");
    }

    #[test]
    fn cleaning_caps_the_length() {
        let long = "a".repeat(MAX_MESSAGE_CHARS + 100);
        let cleaned = clean_message(&long);
        assert!(cleaned.chars().count() <= MAX_MESSAGE_CHARS);
        assert!(cleaned.ends_with('…'));
        // Multi-byte input must not panic and stays within the char budget.
        let cjk = "提".repeat(MAX_MESSAGE_CHARS + 10);
        assert!(clean_message(&cjk).chars().count() <= MAX_MESSAGE_CHARS);
    }

    #[test]
    fn channel_lookup_rejects_an_unknown_engine() {
        let error = first_usable_channel(Some("not-an-engine")).unwrap_err();
        assert_eq!(error, "未知的引擎：not-an-engine");
    }

    /// A scratch HOME so `read_config` sees an empty config instead of the
    /// developer's real channels; shares the crate-wide HOME lock because
    /// these tests mutate process-global env.
    struct HomeScratch {
        dir: PathBuf,
        prev_home: Option<std::ffi::OsString>,
        prev_profile: Option<std::ffi::OsString>,
        _lock: parking_lot::MutexGuard<'static, ()>,
    }

    impl HomeScratch {
        fn new() -> Self {
            let lock = crate::paths::HOME_ENV_LOCK.lock();
            let dir = std::env::temp_dir()
                .join(format!("ccgui-next-commit-cfg-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            let prev_home = std::env::var_os("HOME");
            let prev_profile = std::env::var_os("USERPROFILE");
            std::env::set_var("HOME", &dir);
            std::env::set_var("USERPROFILE", &dir);
            Self {
                dir,
                prev_home,
                prev_profile,
                _lock: lock,
            }
        }

        fn seed(&self, engine: &str, current: Option<&str>, provider: Value) {
            let config_path = crate::paths::config_path();
            std::fs::create_dir_all(config_path.parent().unwrap()).unwrap();
            let section = if let Some(current) = current {
                json!({"providers": {"chan-a": provider}, "current": current})
            } else {
                json!({"providers": {"chan-a": provider}})
            };
            std::fs::write(config_path, json!({engine: section}).to_string()).unwrap();
        }
    }

    impl Drop for HomeScratch {
        fn drop(&mut self) {
            match &self.prev_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
            match &self.prev_profile {
                Some(value) => std::env::set_var("USERPROFILE", value),
                None => std::env::remove_var("USERPROFILE"),
            }
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn channel_lookup_without_any_channel_is_actionable() {
        let scratch = HomeScratch::new();
        scratch.seed(
            "claude",
            None,
            json!({"baseUrl": "https://a.example", "apiKey": "sk-a"}),
        );
        // No `current`: the section's official config applies, which has no
        // HTTP credential — the user must configure a channel.
        let error = first_usable_channel(None).unwrap_err();
        assert_eq!(error, NO_CHANNEL_ERROR);
        assert!(error.contains("baseUrl + apiKey"));
    }

    #[test]
    fn channel_lookup_reads_base_url_key_and_model() {
        let scratch = HomeScratch::new();
        scratch.seed(
            "claude",
            Some("chan-a"),
            json!({"baseUrl": "https://a.example/v1", "apiKey": "sk-a", "model": "m-a"}),
        );
        let channel = first_usable_channel(None).unwrap();
        assert_eq!(channel.engine, "claude");
        assert_eq!(channel.wire.kind, "anthropic");
        assert_eq!(channel.wire.base_url, "https://a.example/v1");
        assert_eq!(channel.wire.api_key, "sk-a");
        assert_eq!(channel.wire.model, "m-a");
    }

    #[test]
    fn claude_alias_model_maps_through_the_channel_slots() {
        let scratch = HomeScratch::new();
        // The UI's opus/sonnet aliases are not model ids; a relay answers
        // "unknown model" for them. The slot env carries the real id.
        scratch.seed(
            "claude",
            Some("chan-a"),
            json!({
                "baseUrl": "https://a.example/v1",
                "apiKey": "sk-a",
                "model": "opus",
                "settingsConfig": {"env": {"ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-1"}}
            }),
        );
        let channel = first_usable_channel(Some("claude")).unwrap();
        assert_eq!(channel.wire.model, "claude-opus-4-1");
    }

    #[test]
    fn codex_responses_channels_resolve_to_the_responses_wire() {
        let scratch = HomeScratch::new();
        scratch.seed(
            "codex",
            Some("chan-a"),
            json!({
                "baseUrl": "https://c.example",
                "apiKey": "sk-c",
                "model": "gpt-5",
                "configToml": "model_provider = \"chan-a\"\nwire_api = \"responses\""
            }),
        );
        let channel = first_usable_channel(Some("codex")).unwrap();
        assert_eq!(channel.wire.kind, "openai-responses");
        assert_eq!(channel.wire.model, "gpt-5");
    }

    #[test]
    fn channel_lookup_skips_channels_without_a_credential() {
        let scratch = HomeScratch::new();
        // Current channel has a base URL but no key: not usable, and there is
        // nothing else to fall back to. The scan report names the reason.
        scratch.seed("claude", Some("chan-a"), json!({"baseUrl": "https://a.example"}));
        let error = first_usable_channel(None).unwrap_err();
        assert!(error.starts_with("未找到可用渠道"), "error was: {error}");
        assert!(error.contains("no API key"), "error was: {error}");
    }

    #[test]
    fn explicit_engine_without_a_channel_fails_loudly() {
        let scratch = HomeScratch::new();
        scratch.seed(
            "claude",
            Some("chan-a"),
            json!({"baseUrl": "https://a.example", "apiKey": "sk-a", "model": "m-a"}),
        );
        // Kimi has no channel at all: asking for it must not silently reroute
        // to the configured Claude channel.
        let error = first_usable_channel(Some("kimi")).unwrap_err();
        assert!(error.contains("引擎 kimi"), "error was: {error}");
    }

    #[test]
    fn selected_scope_describes_exactly_the_checked_paths() {
        let scratch = Scratch::new();
        let repo = git2::Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "a.txt", "a\n");
        commit_file(&repo, "b.txt", "b\n");
        // Both staged; only a.txt is checked. The commit button would unstage
        // b.txt, so the message must not describe it.
        std::fs::write(scratch.0.join("a.txt"), "a staged\n").unwrap();
        std::fs::write(scratch.0.join("b.txt"), "b staged\n").unwrap();
        stage(&repo, "a.txt");
        stage(&repo, "b.txt");

        let context = build_context(&repo, Some(&["a.txt".to_string()])).unwrap();
        assert_eq!(context.scope, DiffScope::Selected);
        assert!(context.files.contains("a.txt"), "files: {}", context.files);
        assert!(!context.files.contains("b.txt"), "files: {}", context.files);
        assert!(context.diff.contains("+a staged"), "diff: {}", context.diff);
        assert!(!context.diff.contains("b staged"), "diff: {}", context.diff);
    }

    #[test]
    fn selected_scope_covers_checked_unstaged_and_untracked_files() {
        let scratch = Scratch::new();
        let repo = git2::Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "a.txt", "a\n");
        // Checked but not yet staged: the commit stages them first, so the
        // message must cover both — the worktree edit and the new file.
        std::fs::write(scratch.0.join("a.txt"), "a changed\n").unwrap();
        std::fs::write(scratch.0.join("fresh.txt"), "brand new content\n").unwrap();

        let selection = vec!["a.txt".to_string(), "fresh.txt".to_string()];
        let context = build_context(&repo, Some(&selection)).unwrap();
        assert_eq!(context.scope, DiffScope::Selected);
        assert!(context.files.contains("a.txt"), "files: {}", context.files);
        assert!(context.files.contains("?? fresh.txt"), "files: {}", context.files);
        assert!(context.diff.contains("+a changed"), "diff: {}", context.diff);
        // A small new file's content ships with the prompt — a commit that
        // only adds files is otherwise undescribable from paths alone.
        assert!(context.diff.contains("?? fresh.txt"), "diff: {}", context.diff);
        assert!(context.diff.contains("+brand new content"), "diff: {}", context.diff);
    }

    #[test]
    fn selected_scope_without_matching_paths_is_an_error() {
        let scratch = Scratch::new();
        let repo = git2::Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "a.txt", "a\n");
        assert_eq!(
            build_context(&repo, Some(&["gone.txt".to_string()])).unwrap_err(),
            "没有可提交的变更"
        );
    }

    #[test]
    fn selected_scope_treats_brackets_as_literal_path_characters() {
        let scratch = Scratch::new();
        let repo = git2::Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "[id].tsx", "route base\n");
        commit_file(&repo, "i.tsx", "other base\n");
        std::fs::write(scratch.0.join("[id].tsx"), "selected route change\n").unwrap();
        std::fs::write(scratch.0.join("i.tsx"), "unchecked content\n").unwrap();
        let context = build_context(&repo, Some(&["[id].tsx".to_string()])).unwrap();
        assert!(context.diff.contains("+selected route change"), "{}", context.diff);
        assert!(!context.diff.contains("unchecked content"), "{}", context.diff);
        assert!(!context.diff.contains("b/i.tsx"), "{}", context.diff);
    }
}
