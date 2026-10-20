//! AI commit-message generation: turn one repository's pending changes into
//! a Conventional Commits message, using the same channel configuration the
//! chat engines launch with.
//!
//! The prompt only ever carries repository state (status codes + diff text),
//! never credentials: the api key rides a request header, and every error
//! path below reports status/parse failures without echoing it.

use crate::config;
use crate::provider_files::channel_field;
use serde_json::{json, Value};
use std::time::Duration;

/// Patch text budget. The diff is only a hint for the model — the message
/// must stay cheap to produce, and a huge patch would both blow the context
/// window and stall the request for no gain.
const MAX_DIFF_CHARS: usize = 24_000;
const DIFF_TRUNCATION_NOTE: &str = "… diff truncated …";
/// Model output budget: a commit message is a subject plus at most a short
/// body, so anything longer is the model rambling.
const MAX_MESSAGE_CHARS: usize = 500;

/// A channel resolved to everything one chat call needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedChannel {
    pub engine: String,
    pub base_url: String,
    pub api_key: String,
    pub model: Option<String>,
}

/// HTTP credentials come from a configured channel; the official CLI config
/// has none, so generation only works once the user configures a channel.
pub(crate) const NO_CHANNEL_ERROR: &str =
    "未找到可用渠道：请在设置 → 渠道管理中为某个引擎配置渠道（baseUrl + apiKey）";

/// Which wire shape an engine speaks. Claude relays answer Anthropic
/// Messages; everything else is OpenAI-compatible, so one branch covers the
/// remaining engines instead of a per-engine match that would rot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ApiShape {
    Anthropic,
    OpenAi,
}

pub(crate) fn api_shape(engine: &str) -> ApiShape {
    if engine == "claude" {
        ApiShape::Anthropic
    } else {
        ApiShape::OpenAi
    }
}

/// The first channel whose config yields both an endpoint and a credential,
/// scanning `config::ENGINES` in order so repeated calls agree. `engine`
/// restricts the scan to one engine; unknown ids fail loudly instead of
/// silently rerouting the request to another engine's channel.
pub(crate) fn first_usable_channel(engine_filter: Option<&str>) -> Result<ResolvedChannel, String> {
    let candidates: Vec<&str> = match engine_filter {
        Some(engine) if config::ENGINES.contains(&engine) => vec![engine],
        Some(engine) => return Err(format!("未知的引擎：{engine}")),
        None => config::ENGINES.iter().copied().collect(),
    };
    for engine in candidates {
        // A disabled engine, or a section that cannot be read, is a normal
        // state of *some* engine - not a reason to fail the whole scan. Skip
        // it and keep looking, so a user who disabled one engine still gets a
        // message from another.
        let Ok(Some(provider)) = config::resolve_provider(engine, None) else {
            continue;
        };
        // Official configs resolve to `None`: no HTTP credential to borrow.
        let (Some(base_url), Some(api_key)) = (
            channel_field(engine, &provider, "baseUrl"),
            channel_field(engine, &provider, "apiKey"),
        ) else {
            continue;
        };
        return Ok(ResolvedChannel {
            engine: engine.to_string(),
            base_url,
            api_key,
            model: channel_field(engine, &provider, "model"),
        });
    }
    Err(NO_CHANNEL_ERROR.to_string())
}

/// Join a channel's base URL with an endpoint path, tolerating a base that
/// already carries the API version (`…/v1`): appending blindly yields the
/// `/v1/v1/messages` no relay serves.
pub(crate) fn join_endpoint(base_url: &str, suffix: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if !suffix.is_empty() && base.ends_with(suffix) {
        return base.to_string();
    }
    if base.ends_with("/v1") && suffix.starts_with("/v1/") {
        return format!("{}{}", &base[..base.len() - 3], suffix);
    }
    format!("{base}{suffix}")
}

/// The endpoint one chat request goes to, with the same `/v1` normalization.
pub(crate) fn chat_endpoint(channel: &ResolvedChannel) -> String {
    match api_shape(&channel.engine) {
        ApiShape::Anthropic => join_endpoint(&channel.base_url, "/v1/messages"),
        ApiShape::OpenAi => join_endpoint(&channel.base_url, "/v1/chat/completions"),
    }
}

// ==================== Repository context ====================

/// Which changes the message describes. Staged wins because `git_commit`
/// commits the index — describing the worktree instead would produce a
/// message about changes the commit does not contain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DiffScope {
    Staged,
    Worktree,
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

fn append_patch(diff: &git2::Diff, text: &mut String) -> Result<(), String> {
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
        Ok(()) => Ok(()),
        // Our own stop: git2 maps the `false` return to GIT_EUSER.
        Err(e) if truncated && e.code() == git2::ErrorCode::User => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Render the diff for one scope as patch text within MAX_DIFF_CHARS.
fn render_diff(repo: &git2::Repository, scope: DiffScope) -> Result<String, String> {
    let mut text = String::new();
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
            append_patch(&diff, &mut text)?;
        }
        DiffScope::Worktree => {
            let diff = repo
                .diff_index_to_workdir(None, Some(&mut opts))
                .map_err(|e| e.to_string())?;
            append_patch(&diff, &mut text)?;
            let untracked: Vec<String> = status_short_lines(repo, scope)?
                .lines()
                .filter(|line| line.starts_with("?? "))
                .map(str::to_string)
                .collect();
            if !untracked.is_empty() {
                if !text.is_empty() && !text.ends_with('\n') {
                    push_capped(&mut text, "\n");
                }
                push_capped(&mut text, "Untracked files (path only):\n");
                for line in untracked {
                    if !push_capped(&mut text, &format!("  {line}\n")) {
                        break;
                    }
                }
            }
        }
    }
    Ok(text)
}

/// Mark a diff cut short, so the model is told the view is partial instead
/// of silently assuming it saw everything.
pub(crate) fn cap_diff_text(diff: &str) -> String {
    let mut capped = String::new();
    if push_capped(&mut capped, diff) {
        return capped;
    }
    if !capped.is_empty() && !capped.ends_with('\n') {
        capped.push('\n');
    }
    capped.push_str(DIFF_TRUNCATION_NOTE);
    capped
}

/// Repository context: the file list plus the diff for the chosen scope.
#[derive(Debug)]
pub(crate) struct CommitContext {
    pub scope: DiffScope,
    pub files: String,
    pub diff: String,
}

pub(crate) fn build_context(repo: &git2::Repository) -> Result<CommitContext, String> {
    let scope = choose_scope(repo)?;
    let files = status_short_lines(repo, scope)?;
    if files.trim().is_empty() {
        return Err("没有可提交的变更".to_string());
    }
    let diff = cap_diff_text(&render_diff(repo, scope)?);
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

/// Text out of an Anthropic Messages reply: `content` blocks of type text.
/// Non-text blocks (thinking, tool use) are skipped rather than stringified.
pub(crate) fn extract_anthropic_text(body: &Value) -> Option<String> {
    let blocks = body.get("content")?.as_array()?;
    let mut out = String::new();
    for block in blocks {
        if block.get("type").and_then(Value::as_str) == Some("text") {
            if let Some(text) = block.get("text").and_then(Value::as_str) {
                out.push_str(text);
            }
        }
    }
    (!out.trim().is_empty()).then_some(out)
}

/// Text out of an OpenAI chat completion reply.
pub(crate) fn extract_openai_text(body: &Value) -> Option<String> {
    let text = body
        .get("choices")?
        .get(0)?
        .get("message")?
        .get("content")?
        .as_str()?;
    (!text.trim().is_empty()).then(|| text.to_string())
}

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

/// First model id out of the shapes a relay's model list answers (`data[].id`,
/// a bare array, `models[].id`) — the same shapes `provider_models` parses
/// for the provider dialog, kept local so this module needs no new surface
/// there.
pub(crate) fn first_model_id(value: &Value) -> Option<String> {
    let items = value
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| value.as_array())
        .or_else(|| value.get("models").and_then(Value::as_array))?;
    items.iter().find_map(|item| {
        let candidate = match item {
            Value::String(id) => Some(id.as_str()),
            Value::Object(map) => map.get("id").and_then(Value::as_str),
            _ => None,
        };
        candidate
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_string)
    })
}

/// Model id to call with. Codex channels routinely carry no `model` field, so
/// fall back to the channel's model list — the only other place an id exists.
async fn resolve_model(
    client: &reqwest::Client,
    channel: &ResolvedChannel,
) -> Result<String, String> {
    if let Some(model) = channel.model.clone() {
        return Ok(model);
    }
    let endpoint = join_endpoint(&channel.base_url, "/v1/models");
    let response = client
        .get(&endpoint)
        .header("Authorization", format!("Bearer {}", channel.api_key))
        .header("x-api-key", channel.api_key.as_str())
        .send()
        .await
        .map_err(|e| format!("渠道未配置 model，且获取模型列表失败：{e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("渠道未配置 model，且获取模型列表失败：HTTP {status}"));
    }
    let body = response
        .text()
        .await
        .map_err(|e| format!("渠道未配置 model，且获取模型列表失败：{e}"))?;
    let value: Value =
        serde_json::from_str(&body).map_err(|e| format!("获取模型列表失败：{e}"))?;
    first_model_id(&value).ok_or_else(|| {
        "渠道未配置 model，且模型列表为空：请在渠道设置中填写 model".to_string()
    })
}

/// Full reply handling for one API shape.
pub(crate) fn message_from_reply(shape: ApiShape, body: &Value) -> Result<String, String> {
    let raw = match shape {
        ApiShape::Anthropic => extract_anthropic_text(body),
        ApiShape::OpenAi => extract_openai_text(body),
    }
    .ok_or_else(|| "模型未返回提交信息".to_string())?;
    let cleaned = clean_message(&raw);
    if cleaned.is_empty() {
        return Err("模型未返回提交信息".to_string());
    }
    Ok(cleaned)
}

// ==================== Commands ====================

fn request_body(shape: ApiShape, model: &str, prompt: &str) -> Value {
    match shape {
        ApiShape::Anthropic => json!({
            "model": model,
            "max_tokens": 512,
            "messages": [{"role": "user", "content": prompt}],
        }),
        ApiShape::OpenAi => json!({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
        }),
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败：{e}"))
}

async fn generate_commit_message_impl(
    engine: Option<String>,
    path: String,
    locale: String,
) -> Result<String, String> {
    // Status + diff walks belong off the async runtime, same rationale as
    // `git_status_blocking`.
    let context = tauri::async_runtime::spawn_blocking(move || {
        let repo = crate::git::open_repo(&path)?;
        build_context(&repo)
    })
    .await
    .map_err(|e| e.to_string())??;

    let channel = first_usable_channel(engine.as_deref())?;
    let prompt = build_prompt(&context, &locale);
    let shape = api_shape(&channel.engine);

    let client = http_client()?;
    let model = resolve_model(&client, &channel).await?;
    let endpoint = chat_endpoint(&channel);
    let mut request = client
        .post(&endpoint)
        .json(&request_body(shape, &model, &prompt));
    request = match shape {
        ApiShape::Anthropic => request
            .header("x-api-key", channel.api_key.as_str())
            .header("anthropic-version", "2023-06-01"),
        ApiShape::OpenAi => request.header("Authorization", format!("Bearer {}", channel.api_key)),
    };
    let response = request
        .send()
        .await
        // A transport error never carries the request headers, so `e` is safe
        // to surface verbatim.
        .map_err(|e| format!("请求渠道失败：{e}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取渠道响应失败：{e}"))?;
    if !status.is_success() {
        // Relays sometimes echo the request (headers included) in the error
        // body: report the status alone so no credential reaches the UI.
        return Err(format!("渠道返回 HTTP {status}"));
    }
    let value: Value =
        serde_json::from_str(&body).map_err(|_| "渠道响应不是合法 JSON".to_string())?;
    message_from_reply(shape, &value)
}

/// Ask the configured channel for a commit message describing `path`'s pending
/// changes. Errors are short, actionable Chinese text; credentials never
/// appear in them.
#[tauri::command]
pub async fn git_generate_commit_message(
    engine: Option<String>,
    path: String,
    locale: String,
) -> Result<String, String> {
    generate_commit_message_impl(engine, path, locale).await
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn shape_follows_the_engine() {
        assert_eq!(api_shape("claude"), ApiShape::Anthropic);
        assert_eq!(api_shape("codex"), ApiShape::OpenAi);
        assert_eq!(api_shape("kimi"), ApiShape::OpenAi);
        assert_eq!(api_shape("grok"), ApiShape::OpenAi);
    }

    #[test]
    fn endpoint_join_avoids_doubling_the_api_version() {
        assert_eq!(
            join_endpoint("https://a.example/v1", "/v1/messages"),
            "https://a.example/v1/messages"
        );
        assert_eq!(
            join_endpoint("https://a.example/", "/v1/messages"),
            "https://a.example/v1/messages"
        );
        assert_eq!(
            join_endpoint("https://a.example/anthropic", "/v1/messages"),
            "https://a.example/anthropic/v1/messages"
        );
        // Already the full endpoint: nothing appended.
        assert_eq!(
            join_endpoint("https://a.example/v1/messages", "/v1/messages"),
            "https://a.example/v1/messages"
        );
    }

    #[test]
    fn chat_endpoint_follows_the_api_shape() {
        let claude = ResolvedChannel {
            engine: "claude".to_string(),
            base_url: "https://a.example/v1".to_string(),
            api_key: "sk-a".to_string(),
            model: Some("m".to_string()),
        };
        assert_eq!(chat_endpoint(&claude), "https://a.example/v1/messages");
        let codex = ResolvedChannel {
            engine: "codex".to_string(),
            ..claude
        };
        assert_eq!(
            chat_endpoint(&codex),
            "https://a.example/v1/chat/completions"
        );
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

        let context = build_context(&repo).unwrap();
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

        let context = build_context(&repo).unwrap();
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
    fn worktree_context_lists_untracked_paths_without_content() {
        let scratch = Scratch::new();
        let repo = git2::Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "a.txt", "a\n");
        std::fs::write(scratch.0.join("fresh.txt"), "brand new content\n").unwrap();
        std::fs::write(scratch.0.join("a.txt"), "a changed\n").unwrap();

        let context = build_context(&repo).unwrap();
        assert_eq!(context.scope, DiffScope::Worktree);
        assert!(context.files.contains("?? fresh.txt"));
        assert!(context.diff.contains("+a changed"), "diff was {:?}", context.diff);
        assert!(!context.diff.contains("brand new content"));
        assert!(context.diff.contains("Untracked files (path only)"));
        assert!(context.diff.contains("fresh.txt"));
    }

    #[test]
    fn context_without_changes_is_an_error() {
        let scratch = Scratch::new();
        let repo = git2::Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "a.txt", "a\n");
        assert_eq!(
            build_context(&repo).unwrap_err(),
            "没有可提交的变更"
        );
    }

    #[test]
    fn unborn_head_staged_diff_still_produces_a_patch() {
        let scratch = Scratch::new();
        let repo = git2::Repository::init(&scratch.0).unwrap();
        std::fs::write(scratch.0.join("first.txt"), "hello\n").unwrap();
        stage(&repo, "first.txt");

        let context = build_context(&repo).unwrap();
        assert_eq!(context.scope, DiffScope::Staged);
        assert!(context.diff.contains("+hello"));
    }

    #[test]
    fn diff_text_is_capped_with_a_visible_note() {
        let long = "x".repeat(MAX_DIFF_CHARS + 5_000);
        let capped = cap_diff_text(&long);
        assert!(capped.ends_with(DIFF_TRUNCATION_NOTE));
        assert!(capped.len() < long.len());
        // Short input passes through untouched.
        let short = "small diff\n";
        assert_eq!(cap_diff_text(short), short);
    }

    #[test]
    fn capping_a_multibyte_diff_never_panics() {
        // The budget is in bytes, so the cut can land mid-character — slicing
        // there would panic instead of truncating.
        let cjk = "提".repeat(MAX_DIFF_CHARS);
        let capped = cap_diff_text(&cjk);
        assert!(capped.ends_with(DIFF_TRUNCATION_NOTE));
        // 24_000 is not a multiple of 3, so alignment genuinely had to move.
        assert!(capped.len() <= MAX_DIFF_CHARS + DIFF_TRUNCATION_NOTE.len() + 1);
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
    fn anthropic_reply_joins_text_blocks() {
        let body = json!({
            "content": [
                {"type": "thinking", "text": "ignored"},
                {"type": "text", "text": "feat: add panel"},
            ]
        });
        assert_eq!(
            extract_anthropic_text(&body).as_deref(),
            Some("feat: add panel")
        );
        assert_eq!(extract_anthropic_text(&json!({"content": []})), None);
        assert_eq!(extract_anthropic_text(&json!({})), None);
    }

    #[test]
    fn openai_reply_reads_the_first_choice() {
        let body = json!({
            "choices": [{"message": {"role": "assistant", "content": "fix: guard"}}]
        });
        assert_eq!(extract_openai_text(&body).as_deref(), Some("fix: guard"));
        assert_eq!(extract_openai_text(&json!({"choices": []})), None);
        assert_eq!(
            extract_openai_text(&json!({"choices": [{"message": {"content": "  "}}]})),
            None
        );
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
    fn reply_handling_reports_an_empty_model_answer() {
        let anthropic = json!({"content": [{"type": "text", "text": "   "}]});
        assert_eq!(
            message_from_reply(ApiShape::Anthropic, &anthropic).unwrap_err(),
            "模型未返回提交信息"
        );
        let openai = json!({"choices": []});
        assert_eq!(
            message_from_reply(ApiShape::OpenAi, &openai).unwrap_err(),
            "模型未返回提交信息"
        );
        let good = json!({"content": [{"type": "text", "text": "```chore: init```"}]});
        assert_eq!(
            message_from_reply(ApiShape::Anthropic, &good).unwrap(),
            "chore: init"
        );
    }

    #[test]
    fn request_bodies_match_their_api_shape() {
        let channel = ResolvedChannel {
            engine: "claude".to_string(),
            base_url: "https://a.example".to_string(),
            api_key: "sk-secret".to_string(),
            model: Some("m".to_string()),
        };
        let model = channel.model.as_deref().unwrap();

        let anthropic = request_body(ApiShape::Anthropic, model, "p");
        assert_eq!(anthropic["model"], json!("m"));
        assert_eq!(anthropic["messages"][0]["content"], json!("p"));
        assert!(anthropic.get("max_tokens").is_some());

        let openai = request_body(ApiShape::OpenAi, model, "p");
        assert_eq!(openai["messages"][0]["role"], json!("user"));
        assert!(openai.get("max_tokens").is_none());

        // The credential lives in a header, never in the body.
        assert!(!openai.to_string().contains("sk-secret"));
        assert!(!anthropic.to_string().contains("sk-secret"));
    }

    #[test]
    fn model_fallback_takes_the_first_id_of_every_list_shape() {
        // OpenAI relay shape.
        assert_eq!(
            first_model_id(&json!({"data": [{"id": "gpt-5"}, {"id": "o3"}]})),
            Some("gpt-5".to_string())
        );
        // Bare array (some relays).
        assert_eq!(
            first_model_id(&json!(["kimi-k2", "other"])),
            Some("kimi-k2".to_string())
        );
        // Anthropic `models` shape.
        assert_eq!(
            first_model_id(&json!({"models": [{"id": "claude-x"}]})),
            Some("claude-x".to_string())
        );
        // Blank / unusable / empty lists fall through to the error path.
        assert_eq!(first_model_id(&json!({"data": [{"id": "  "}]})), None);
        assert_eq!(first_model_id(&json!({"data": [{"nope": 1}]})), None);
        assert_eq!(first_model_id(&json!({"data": []})), None);
        assert_eq!(first_model_id(&json!({})), None);
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

        fn seed(&self, current: Option<&str>, provider: Value) {
            let config_path = crate::paths::config_path();
            std::fs::create_dir_all(config_path.parent().unwrap()).unwrap();
            let document = if let Some(current) = current {
                json!({
                    "claude": {"providers": {"chan-a": provider}, "current": current}
                })
            } else {
                json!({"claude": {"providers": {"chan-a": provider}}})
            };
            std::fs::write(config_path, document.to_string()).unwrap();
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
        scratch.seed(None, json!({"baseUrl": "https://a.example", "apiKey": "sk-a"}));
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
            Some("chan-a"),
            json!({"baseUrl": "https://a.example/v1", "apiKey": "sk-a", "model": "m-a"}),
        );
        let channel = first_usable_channel(None).unwrap();
        assert_eq!(channel.engine, "claude");
        assert_eq!(channel.base_url, "https://a.example/v1");
        assert_eq!(channel.api_key, "sk-a");
        assert_eq!(channel.model.as_deref(), Some("m-a"));
        assert_eq!(chat_endpoint(&channel), "https://a.example/v1/messages");
    }

    #[test]
    fn channel_lookup_skips_channels_without_a_credential() {
        let scratch = HomeScratch::new();
        // Current channel has a base URL but no key: not usable, and there is
        // nothing else to fall back to.
        scratch.seed(Some("chan-a"), json!({"baseUrl": "https://a.example"}));
        assert_eq!(first_usable_channel(None).unwrap_err(), NO_CHANNEL_ERROR);
    }
}