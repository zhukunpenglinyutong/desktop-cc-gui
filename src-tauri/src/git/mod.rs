use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use git2::{BranchType, DiffOptions, Oid, Repository, Sort, Status, StatusOptions};
use serde::Deserialize;
use serde_json::json;
use tauri::State;
use tokio::time::{timeout, Duration};

use crate::git_utils::{
    checkout_branch, commit_to_entry, diff_patch_to_string, diff_stats_for_path, image_mime_type,
    list_git_roots as scan_git_roots, parse_github_repo, resolve_git_root,
};
use crate::state::AppState;
use crate::types::{
    BranchInfo, GitBranchCompareCommitSets, GitBranchListItem, GitCommitDetails, GitCommitDiff,
    GitBranchUpdateResult, GitCommitFileChange, GitFileDiff, GitFileStatus, GitHistoryCommit,
    GitHistoryResponse, GitHubIssue, GitHubIssuesResponse, GitHubPullRequest,
    GitHubPullRequestComment, GitHubPullRequestDiff, GitHubPullRequestsResponse, GitLogResponse,
    GitPrExistingPullRequest, GitPrWorkflowDefaults, GitPrWorkflowResult,
    GitPrWorkflowStage, GitPushPreviewResponse,
};
use crate::utils::{git_env_path, normalize_git_path, resolve_git_binary};
use validation::validate_local_branch_name;

mod validation;

const INDEX_SKIP_WORKTREE_FLAG: u16 = 0x4000;
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_COMMIT_DIFF_LINES: usize = 10_000;
const GIT_COMMAND_TIMEOUT_SECS: u64 = 120;
const PR_RANGE_MAX_CHANGED_FILES: usize = 240;
const PR_RANGE_SUSPICIOUS_THRESHOLD: usize = 32;
const GIT_STATUS_DIFF_STATS_FILE_LIMIT: usize = 120;
const GIT_STATUS_DIFF_STATS_MAX_FILE_BYTES: u64 = 256 * 1024;
const GIT_DIFF_PREVIEW_MAX_FILES: usize = 200;
const GIT_DIFF_PREVIEW_MAX_TOTAL_BYTES: usize = 2 * 1024 * 1024;
const GIT_DIFF_PREVIEW_MAX_BYTES_PER_FILE: usize = 256 * 1024;
const GIT_DIFF_PREVIEW_MAX_LINES_PER_FILE: usize = 2_500;
const GIT_DIFF_PREVIEW_SKIP_FILE_SIZE_BYTES: u64 = 1024 * 1024;

fn trim_lowercase(input: Option<String>) -> Option<String> {
    input
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase())
}

fn trim_optional(input: Option<String>) -> Option<String> {
    input
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn is_branch_used_by_worktree_error(raw: &str) -> bool {
    let message = raw.to_lowercase();
    message.contains("cannot delete branch") && message.contains("used by worktree at")
}

fn extract_worktree_path_from_delete_error(raw: &str) -> Option<String> {
    let marker = "used by worktree at '";
    let start = raw.find(marker)?;
    let tail = &raw[start + marker.len()..];
    let end = tail.find('\'')?;
    let path = tail[..end].trim();
    if path.is_empty() {
        return None;
    }
    Some(path.to_string())
}

fn build_delete_branch_worktree_error(branch_name: &str, raw: &str) -> String {
    if let Some(path) = extract_worktree_path_from_delete_error(raw) {
        return format!(
            "Cannot delete branch '{branch_name}' because it is currently used by worktree at '{path}'. Switch that worktree to another branch or remove that worktree, then retry."
        );
    }
    format!(
        "Cannot delete branch '{branch_name}' because it is currently used by another worktree. Switch that worktree to another branch or remove that worktree, then retry."
    )
}

fn truncate_diff_lines(content: &str, max_lines: usize) -> (String, usize, bool) {
    if max_lines == 0 {
        return (String::new(), 0, false);
    }
    let mut lines = content.lines();
    let mut kept = Vec::new();
    let mut total = 0usize;
    let mut truncated = false;
    for line in lines.by_ref() {
        total += 1;
        if total <= max_lines {
            kept.push(line);
        } else {
            truncated = true;
        }
    }
    (kept.join("\n"), total, truncated || total > max_lines)
}

fn normalize_guard_path(path: &str) -> String {
    path.replace('\\', "/").to_ascii_lowercase()
}

fn is_heavy_diff_path(path: &str) -> bool {
    let normalized = normalize_guard_path(path);
    let segments: Vec<&str> = normalized
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    let file_name = segments.last().copied().unwrap_or(normalized.as_str());

    if matches!(
        file_name,
        "pnpm-lock.yaml"
            | "package-lock.json"
            | "yarn.lock"
            | "bun.lockb"
            | "cargo.lock"
            | "pipfile.lock"
            | "poetry.lock"
            | "composer.lock"
    ) {
        return true;
    }

    if file_name.ends_with(".lock")
        || file_name.ends_with(".min.js")
        || file_name.ends_with(".bundle.js")
    {
        return true;
    }

    segments.iter().any(|segment| {
        matches!(
            *segment,
            "node_modules"
                | ".pnpm"
                | ".pnpm-store"
                | ".next"
                | "dist"
                | "build"
                | "coverage"
                | "release-artifacts"
        )
    })
}

fn is_large_worktree_file(repo_root: &Path, path: &str, limit_bytes: u64) -> bool {
    let candidate = repo_root.join(path);
    match fs::metadata(candidate) {
        Ok(metadata) => metadata.is_file() && metadata.len() > limit_bytes,
        Err(_) => false,
    }
}

fn should_skip_diff_stats(repo_root: &Path, path: &str) -> bool {
    is_heavy_diff_path(path)
        || is_large_worktree_file(repo_root, path, GIT_STATUS_DIFF_STATS_MAX_FILE_BYTES)
}

fn utf8_safe_prefix(input: &str, max_bytes: usize) -> &str {
    if input.len() <= max_bytes {
        return input;
    }
    let mut end = max_bytes;
    while end > 0 && !input.is_char_boundary(end) {
        end -= 1;
    }
    &input[..end]
}

fn truncate_diff_preview(content: String, max_lines: usize, max_bytes: usize) -> String {
    let (mut trimmed, _total_lines, line_truncated) = truncate_diff_lines(&content, max_lines);
    let mut truncated = line_truncated;

    if trimmed.len() > max_bytes {
        let safe_prefix = utf8_safe_prefix(&trimmed, max_bytes).to_string();
        trimmed = safe_prefix;
        truncated = true;
    }

    if truncated {
        trimmed.push_str("\n\n[diff truncated for performance]");
    }

    trimmed
}

fn collect_commit_refs_map(repo: &Repository) -> HashMap<Oid, Vec<String>> {
    let mut map: HashMap<Oid, Vec<String>> = HashMap::new();
    let references = match repo.references() {
        Ok(references) => references,
        Err(_) => return map,
    };
    for reference in references.flatten() {
        let oid = match reference.target() {
            Some(oid) => oid,
            None => continue,
        };
        let name = reference
            .shorthand()
            .or_else(|| reference.name())
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }
        map.entry(oid).or_default().push(name);
    }
    for values in map.values_mut() {
        values.sort();
        values.dedup();
    }
    map
}

fn open_repository_at_root(repo_root: &Path) -> Result<Repository, String> {
    Repository::open_ext(
        repo_root,
        git2::RepositoryOpenFlags::NO_SEARCH,
        std::iter::empty::<&Path>(),
    )
    .map_err(|e| e.to_string())
}

fn paginate_history_commits(
    commits: Vec<GitHistoryCommit>,
    offset: usize,
    limit: usize,
) -> (Vec<GitHistoryCommit>, usize, bool) {
    let total = commits.len();
    let page: Vec<GitHistoryCommit> = commits.into_iter().skip(offset).take(limit).collect();
    let has_more = offset.saturating_add(page.len()) < total;
    (page, total, has_more)
}

fn resolve_ref_to_oid(repo: &Repository, reference: &str) -> Result<Oid, String> {
    let trimmed = reference.trim();
    if trimmed.is_empty() {
        return Err("Branch name cannot be empty.".to_string());
    }
    let local_ref = format!("refs/heads/{trimmed}");
    if let Ok(oid) = repo.refname_to_id(&local_ref) {
        return Ok(oid);
    }
    let remote_ref = format!("refs/remotes/{trimmed}");
    if let Ok(oid) = repo.refname_to_id(&remote_ref) {
        return Ok(oid);
    }
    repo.revparse_single(trimmed)
        .map(|object| object.id())
        .map_err(|_| format!("Branch or ref not found: {trimmed}"))
}

fn commit_to_history_commit(
    commit: &git2::Commit<'_>,
    refs_map: &HashMap<Oid, Vec<String>>,
) -> GitHistoryCommit {
    let oid = commit.id();
    let sha = oid.to_string();
    let short_sha: String = sha.chars().take(7).collect();
    let summary = commit.summary().unwrap_or("").to_string();
    let message = commit.message().unwrap_or("").to_string();
    let author = commit.author().name().unwrap_or("").to_string();
    let author_email = commit.author().email().unwrap_or("").to_string();
    let timestamp = commit.time().seconds();
    let parents = commit
        .parents()
        .map(|parent| parent.id().to_string())
        .collect();
    let refs = refs_map.get(&oid).cloned().unwrap_or_default();
    GitHistoryCommit {
        sha,
        short_sha,
        summary,
        message,
        author,
        author_email,
        timestamp,
        parents,
        refs,
    }
}

fn collect_unique_commits(
    repo: &Repository,
    include_ref: &str,
    exclude_ref: &str,
    refs_map: &HashMap<Oid, Vec<String>>,
    limit: usize,
) -> Result<Vec<GitHistoryCommit>, String> {
    let include_oid = resolve_ref_to_oid(repo, include_ref)?;
    let exclude_oid = resolve_ref_to_oid(repo, exclude_ref)?;
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk
        .set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .map_err(|e| e.to_string())?;
    revwalk.push(include_oid).map_err(|e| e.to_string())?;
    revwalk.hide(exclude_oid).map_err(|e| e.to_string())?;

    let mut commits = Vec::new();
    for oid_result in revwalk.take(limit) {
        let oid = oid_result.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        commits.push(commit_to_history_commit(&commit, refs_map));
    }
    Ok(commits)
}

fn parse_remote_branch(name: &str) -> Option<(String, String)> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }
    let without_prefix = trimmed
        .strip_prefix("refs/remotes/")
        .or_else(|| trimmed.strip_prefix("remotes/"))
        .unwrap_or(trimmed);
    let mut parts = without_prefix.splitn(2, '/');
    let remote = parts.next()?.trim();
    let branch = parts.next()?.trim();
    if remote.is_empty() || branch.is_empty() {
        return None;
    }
    Some((remote.to_string(), branch.to_string()))
}

fn encode_image_base64(data: &[u8]) -> Option<String> {
    if data.len() > MAX_IMAGE_BYTES {
        return None;
    }
    Some(STANDARD.encode(data))
}

fn blob_to_base64(blob: git2::Blob) -> Option<String> {
    if blob.size() > MAX_IMAGE_BYTES {
        return None;
    }
    encode_image_base64(blob.content())
}

fn read_image_base64(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > MAX_IMAGE_BYTES as u64 {
        return None;
    }
    let data = fs::read(path).ok()?;
    encode_image_base64(&data)
}

async fn run_git_command(repo_root: &Path, args: &[&str]) -> Result<(), String> {
    let git_bin = resolve_git_binary().map_err(|e| format!("Failed to run git: {e}"))?;
    let mut command = crate::utils::async_command(git_bin);
    command
        .args(args)
        .current_dir(repo_root)
        .env("PATH", git_env_path())
        // Force non-interactive git in GUI context so pull/fetch does not hang on hidden prompts.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = match timeout(
        Duration::from_secs(GIT_COMMAND_TIMEOUT_SECS),
        command.output(),
    )
    .await
    {
        Ok(result) => result.map_err(|e| format!("Failed to run git: {e}"))?,
        Err(_) => {
            let command_name = args.join(" ");
            return Err(format!(
                "Git command timed out after {GIT_COMMAND_TIMEOUT_SECS}s: git {command_name}. Check network/authentication and retry."
            ));
        }
    };

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    if detail.is_empty() {
        return Err("Git command failed.".to_string());
    }
    Err(detail.to_string())
}

fn action_paths_for_file(repo_root: &Path, path: &str) -> Vec<String> {
    let target = normalize_git_path(path).trim().to_string();
    if target.is_empty() {
        return Vec::new();
    }

    let repo = match open_repository_at_root(repo_root) {
        Ok(repo) => repo,
        Err(_) => return vec![target],
    };

    let mut status_options = StatusOptions::new();
    status_options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true)
        .include_ignored(false);

    let statuses = match repo.statuses(Some(&mut status_options)) {
        Ok(statuses) => statuses,
        Err(_) => return vec![target],
    };

    for entry in statuses.iter() {
        let status = entry.status();
        if !(status.contains(Status::WT_RENAMED) || status.contains(Status::INDEX_RENAMED)) {
            continue;
        }
        let delta = entry.index_to_workdir().or_else(|| entry.head_to_index());
        let Some(delta) = delta else {
            continue;
        };
        let (Some(old_path), Some(new_path)) = (delta.old_file().path(), delta.new_file().path())
        else {
            continue;
        };
        let old_path = normalize_git_path(old_path.to_string_lossy().as_ref());
        let new_path = normalize_git_path(new_path.to_string_lossy().as_ref());
        if old_path != target && new_path != target {
            continue;
        }
        if old_path == new_path || new_path.is_empty() {
            return vec![target];
        }
        let mut result = Vec::new();
        if !old_path.is_empty() {
            result.push(old_path);
        }
        if !new_path.is_empty() && !result.contains(&new_path) {
            result.push(new_path);
        }
        return if result.is_empty() {
            vec![target]
        } else {
            result
        };
    }

    vec![target]
}

fn parse_upstream_ref(name: &str) -> Option<(String, String)> {
    let trimmed = name.strip_prefix("refs/remotes/").unwrap_or(name);
    let mut parts = trimmed.splitn(2, '/');
    let remote = parts.next()?;
    let branch = parts.next()?;
    if remote.is_empty() || branch.is_empty() {
        return None;
    }
    Some((remote.to_string(), branch.to_string()))
}

fn normalize_local_branch_ref(raw: &str) -> String {
    raw.trim()
        .trim_start_matches("refs/heads/")
        .trim()
        .to_string()
}

fn normalize_remote_target_branch(remote: &str, raw: &str) -> String {
    let trimmed = raw.trim();
    let without_refs = trimmed
        .strip_prefix("refs/remotes/")
        .or_else(|| trimmed.strip_prefix("remotes/"))
        .unwrap_or(trimmed);
    let remote_prefix = format!("{remote}/");
    without_refs
        .strip_prefix(&remote_prefix)
        .unwrap_or(without_refs)
        .trim()
        .to_string()
}

fn upstream_remote_and_branch(repo_root: &Path) -> Result<Option<(String, String)>, String> {
    let repo = open_repository_at_root(repo_root)?;
    let head = match repo.head() {
        Ok(head) => head,
        Err(_) => return Ok(None),
    };
    if !head.is_branch() {
        return Ok(None);
    }
    let branch_name = match head.shorthand() {
        Some(name) => name,
        None => return Ok(None),
    };
    let branch = repo
        .find_branch(branch_name, BranchType::Local)
        .map_err(|e| e.to_string())?;
    let upstream_branch = match branch.upstream() {
        Ok(upstream) => upstream,
        Err(_) => return Ok(None),
    };
    let upstream_ref = upstream_branch.get();
    let upstream_name = upstream_ref.name().or_else(|| upstream_ref.shorthand());
    Ok(upstream_name.and_then(parse_upstream_ref))
}

fn current_local_branch(repo_root: &Path) -> Result<Option<String>, String> {
    let repo = open_repository_at_root(repo_root)?;
    let head = match repo.head() {
        Ok(head) => head,
        Err(_) => return Ok(None),
    };
    if !head.is_branch() {
        return Ok(None);
    }
    Ok(head
        .shorthand()
        .map(normalize_local_branch_ref)
        .filter(|name| !name.is_empty()))
}

fn split_csv_values(input: Option<String>) -> Vec<String> {
    trim_optional(input)
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn build_gerrit_push_suffix(
    topic: Option<String>,
    reviewers: Option<String>,
    cc: Option<String>,
) -> String {
    let mut params = Vec::new();
    if let Some(topic_name) = trim_optional(topic) {
        params.push(format!("topic={topic_name}"));
    }
    for reviewer in split_csv_values(reviewers) {
        params.push(format!("r={reviewer}"));
    }
    for cc_member in split_csv_values(cc) {
        params.push(format!("cc={cc_member}"));
    }
    params.join(",")
}

async fn push_with_upstream(repo_root: &Path) -> Result<(), String> {
    let upstream = upstream_remote_and_branch(repo_root)?;
    if let Some((remote, branch)) = upstream {
        let refspec = format!("HEAD:{branch}");
        return run_git_command(repo_root, &["push", remote.as_str(), refspec.as_str()]).await;
    }
    run_git_command(repo_root, &["push"]).await
}

async fn push_with_options(
    repo_root: &Path,
    remote: Option<String>,
    branch: Option<String>,
    force_with_lease: bool,
    push_tags: bool,
    run_hooks: bool,
    push_to_gerrit: bool,
    topic: Option<String>,
    reviewers: Option<String>,
    cc: Option<String>,
) -> Result<(), String> {
    let mut args = vec!["push".to_string()];
    if !run_hooks {
        args.push("--no-verify".to_string());
    }
    if force_with_lease {
        args.push("--force-with-lease".to_string());
    }
    if push_tags {
        args.push("--follow-tags".to_string());
    }

    let explicit_remote = trim_optional(remote);
    let explicit_branch = trim_optional(branch)
        .map(|value| normalize_local_branch_ref(&value))
        .filter(|value| !value.is_empty());
    let current_branch = current_local_branch(repo_root)?;
    let target_branch = explicit_branch.or(current_branch);

    if push_to_gerrit {
        let target_remote = explicit_remote
            .or_else(|| {
                upstream_remote_and_branch(repo_root)
                    .ok()
                    .flatten()
                    .map(|(name, _)| name)
            })
            .unwrap_or_else(|| "origin".to_string());
        let target_branch =
            target_branch.ok_or_else(|| "Branch is required for Gerrit push.".to_string())?;

        let mut refspec = format!("HEAD:refs/for/{target_branch}");
        let suffix = build_gerrit_push_suffix(topic, reviewers, cc);
        if !suffix.is_empty() {
            refspec.push('%');
            refspec.push_str(&suffix);
        }
        args.push(target_remote);
        args.push(refspec);
        let command: Vec<&str> = args.iter().map(String::as_str).collect();
        return run_git_command(repo_root, &command).await;
    }

    if explicit_remote.is_none() && target_branch.is_none() {
        if !force_with_lease && !push_tags && run_hooks {
            return push_with_upstream(repo_root).await;
        }
        let command: Vec<&str> = args.iter().map(String::as_str).collect();
        return run_git_command(repo_root, &command).await;
    }

    let target_remote = explicit_remote
        .or_else(|| {
            upstream_remote_and_branch(repo_root)
                .ok()
                .flatten()
                .map(|(name, _)| name)
        })
        .unwrap_or_else(|| "origin".to_string());
    args.push(target_remote);
    if let Some(target_branch) = target_branch {
        args.push(format!("HEAD:{target_branch}"));
    }

    let command: Vec<&str> = args.iter().map(String::as_str).collect();
    run_git_command(repo_root, &command).await
}

fn status_for_index(status: Status) -> Option<&'static str> {
    if status.contains(Status::INDEX_NEW) {
        Some("A")
    } else if status.contains(Status::INDEX_MODIFIED) {
        Some("M")
    } else if status.contains(Status::INDEX_DELETED) {
        Some("D")
    } else if status.contains(Status::INDEX_RENAMED) {
        Some("R")
    } else if status.contains(Status::INDEX_TYPECHANGE) {
        Some("T")
    } else {
        None
    }
}

fn status_for_workdir(status: Status) -> Option<&'static str> {
    if status.contains(Status::WT_NEW) {
        Some("A")
    } else if status.contains(Status::WT_MODIFIED) {
        Some("M")
    } else if status.contains(Status::WT_DELETED) {
        Some("D")
    } else if status.contains(Status::WT_RENAMED) {
        Some("R")
    } else if status.contains(Status::WT_TYPECHANGE) {
        Some("T")
    } else {
        None
    }
}

fn status_for_delta(status: git2::Delta) -> &'static str {
    match status {
        git2::Delta::Added => "A",
        git2::Delta::Modified => "M",
        git2::Delta::Deleted => "D",
        git2::Delta::Renamed => "R",
        git2::Delta::Typechange => "T",
        _ => "M",
    }
}

fn build_combined_diff(diff: &git2::Diff) -> String {
    let mut combined_diff = String::new();
    for (index, delta) in diff.deltas().enumerate() {
        let path = delta.new_file().path().or_else(|| delta.old_file().path());
        let Some(path) = path else {
            continue;
        };
        let patch = match git2::Patch::from_diff(diff, index) {
            Ok(patch) => patch,
            Err(_) => continue,
        };
        let Some(mut patch) = patch else {
            continue;
        };
        let content = match diff_patch_to_string(&mut patch) {
            Ok(content) => content,
            Err(_) => continue,
        };
        if content.trim().is_empty() {
            continue;
        }
        if !combined_diff.is_empty() {
            combined_diff.push_str("\n\n");
        }
        combined_diff.push_str(&format!("=== {} ===\n", path.display()));
        combined_diff.push_str(&content);
    }
    combined_diff
}

fn collect_workspace_diff(repo_root: &Path) -> Result<String, String> {
    let repo = open_repository_at_root(repo_root)?;
    let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());

    let mut options = DiffOptions::new();
    let index = repo.index().map_err(|e| e.to_string())?;
    let diff = match head_tree.as_ref() {
        Some(tree) => repo
            .diff_tree_to_index(Some(tree), Some(&index), Some(&mut options))
            .map_err(|e| e.to_string())?,
        None => repo
            .diff_tree_to_index(None, Some(&index), Some(&mut options))
            .map_err(|e| e.to_string())?,
    };
    let combined_diff = build_combined_diff(&diff);
    if !combined_diff.trim().is_empty() {
        return Ok(combined_diff);
    }

    let mut options = DiffOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true);
    let diff = match head_tree.as_ref() {
        Some(tree) => repo
            .diff_tree_to_workdir_with_index(Some(tree), Some(&mut options))
            .map_err(|e| e.to_string())?,
        None => repo
            .diff_tree_to_workdir_with_index(None, Some(&mut options))
            .map_err(|e| e.to_string())?,
    };
    Ok(build_combined_diff(&diff))
}

fn github_repo_from_path(path: &Path) -> Result<String, String> {
    let repo = open_repository_at_root(path)?;
    let remotes = repo.remotes().map_err(|e| e.to_string())?;
    let name = if remotes.iter().any(|remote| remote == Some("origin")) {
        "origin".to_string()
    } else {
        remotes.iter().flatten().next().unwrap_or("").to_string()
    };
    if name.is_empty() {
        return Err("No git remote configured.".to_string());
    }
    let remote = repo.find_remote(&name).map_err(|e| e.to_string())?;
    let remote_url = remote.url().ok_or("Remote has no URL configured.")?;
    parse_github_repo(remote_url).ok_or("Remote is not a GitHub repository.".to_string())
}

fn parse_patch_diff_entries(diff: &str) -> Vec<GitCommitDiff> {
    let mut entries = Vec::new();
    let mut current_lines: Vec<&str> = Vec::new();
    let mut current_old_path: Option<String> = None;
    let mut current_new_path: Option<String> = None;
    let mut current_status: Option<String> = None;

    let finalize = |lines: &Vec<&str>,
                    old_path: &Option<String>,
                    new_path: &Option<String>,
                    status: &Option<String>,
                    results: &mut Vec<GitCommitDiff>| {
        if lines.is_empty() {
            return;
        }
        let diff_text = lines.join("\n");
        if diff_text.trim().is_empty() {
            return;
        }
        let status_value = status.clone().unwrap_or_else(|| "M".to_string());
        let path = if status_value == "D" {
            old_path.clone().unwrap_or_default()
        } else {
            new_path
                .clone()
                .or_else(|| old_path.clone())
                .unwrap_or_default()
        };
        if path.is_empty() {
            return;
        }
        results.push(GitCommitDiff {
            path: normalize_git_path(&path),
            status: status_value,
            diff: diff_text,
            is_binary: false,
            is_image: false,
            old_image_data: None,
            new_image_data: None,
            old_image_mime: None,
            new_image_mime: None,
        });
    };

    for line in diff.lines() {
        if line.starts_with("diff --git ") {
            finalize(
                &current_lines,
                &current_old_path,
                &current_new_path,
                &current_status,
                &mut entries,
            );
            current_lines = vec![line];
            current_old_path = None;
            current_new_path = None;
            current_status = None;

            let rest = line.trim_start_matches("diff --git ").trim();
            let mut parts = rest.split_whitespace();
            let old_part = parts.next().unwrap_or("").trim_start_matches("a/");
            let new_part = parts.next().unwrap_or("").trim_start_matches("b/");
            if !old_part.is_empty() {
                current_old_path = Some(old_part.to_string());
            }
            if !new_part.is_empty() {
                current_new_path = Some(new_part.to_string());
            }
            continue;
        }
        if line.starts_with("new file mode ") {
            current_status = Some("A".to_string());
        } else if line.starts_with("deleted file mode ") {
            current_status = Some("D".to_string());
        } else if line.starts_with("rename from ") {
            current_status = Some("R".to_string());
            let path = line.trim_start_matches("rename from ").trim();
            if !path.is_empty() {
                current_old_path = Some(path.to_string());
            }
        } else if line.starts_with("rename to ") {
            current_status = Some("R".to_string());
            let path = line.trim_start_matches("rename to ").trim();
            if !path.is_empty() {
                current_new_path = Some(path.to_string());
            }
        }
        current_lines.push(line);
    }

    finalize(
        &current_lines,
        &current_old_path,
        &current_new_path,
        &current_status,
        &mut entries,
    );

    entries
}

fn parse_pr_diff(diff: &str) -> Vec<GitHubPullRequestDiff> {
    parse_patch_diff_entries(diff)
        .into_iter()
        .map(|entry| GitHubPullRequestDiff {
            path: entry.path,
            status: entry.status,
            diff: entry.diff,
        })
        .collect()
}

#[derive(Debug)]
struct TokenIsolatedCommandOutput {
    success: bool,
    command: String,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Deserialize)]
struct GhExistingPrEntry {
    number: u64,
    title: String,
    url: String,
    state: String,
    #[serde(rename = "headRefName")]
    head_ref_name: String,
    #[serde(rename = "baseRefName")]
    base_ref_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PrRangeGateDecision {
    Pass { changed_files: usize },
    Blocked { category: String, reason: String },
}

fn shell_escape_for_display(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    if value.chars().all(|ch| {
        ch.is_ascii_alphanumeric() || matches!(ch, '/' | '_' | '-' | '.' | ':' | '@' | '=')
    }) {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn build_token_isolated_command_display(program: &str, args: &[String]) -> String {
    let mut rendered = vec!["env -u GH_TOKEN -u GITHUB_TOKEN".to_string()];
    rendered.push(shell_escape_for_display(program));
    rendered.extend(args.iter().map(|value| shell_escape_for_display(value)));
    rendered.join(" ")
}

fn summarize_command_failure(output: &TokenIsolatedCommandOutput) -> String {
    let stderr = output.stderr.trim();
    if !stderr.is_empty() {
        return stderr.to_string();
    }
    let stdout = output.stdout.trim();
    if !stdout.is_empty() {
        return stdout.to_string();
    }
    "Command failed without stderr/stdout output.".to_string()
}

fn truncate_debug_text(raw: &str, max_len: usize) -> String {
    if raw.chars().count() <= max_len {
        return raw.to_string();
    }
    raw.chars().take(max_len).collect::<String>() + " ...[truncated]"
}

async fn run_token_isolated_command(
    repo_root: &Path,
    program: &str,
    args: &[String],
    extra_env: &[(&str, &str)],
) -> Result<TokenIsolatedCommandOutput, String> {
    let mut command = if program == "git" {
        crate::utils::async_command(
            resolve_git_binary().map_err(|e| format!("Failed to run git: {e}"))?,
        )
    } else {
        crate::utils::async_command(program)
    };
    command
        .args(args)
        .current_dir(repo_root)
        .env("PATH", git_env_path())
        .env_remove("GH_TOKEN")
        .env_remove("GITHUB_TOKEN")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in extra_env {
        command.env(key, value);
    }

    let output = match timeout(
        Duration::from_secs(GIT_COMMAND_TIMEOUT_SECS),
        command.output(),
    )
    .await
    {
        Ok(result) => result.map_err(|error| {
            if program == "gh" {
                format!("Failed to run gh command: {error}. Ensure GitHub CLI (gh) is installed.")
            } else {
                format!("Failed to run {program} command: {error}")
            }
        })?,
        Err(_) => {
            return Err(format!(
                "Command timed out after {GIT_COMMAND_TIMEOUT_SECS}s: {}",
                build_token_isolated_command_display(program, args)
            ));
        }
    };

    Ok(TokenIsolatedCommandOutput {
        success: output.status.success(),
        command: build_token_isolated_command_display(program, args),
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    })
}

fn is_http2_transport_error(raw: &str) -> bool {
    let normalized = raw.to_lowercase();
    normalized.contains("http2 framing layer")
        || normalized.contains("http/2 stream")
        || normalized.contains("stream 0 was not closed cleanly")
}

fn is_auth_related_error(raw: &str) -> bool {
    let normalized = raw.to_lowercase();
    normalized.contains("403")
        || normalized.contains("authentication failed")
        || normalized.contains("permission denied")
        || normalized.contains("resource not accessible by personal access token")
        || normalized.contains("requires authentication")
        || normalized.contains("not logged into any github hosts")
}

fn is_network_related_error(raw: &str) -> bool {
    let normalized = raw.to_lowercase();
    normalized.contains("failed to connect")
        || normalized.contains("could not resolve host")
        || normalized.contains("timed out")
        || normalized.contains("connection reset")
        || normalized.contains("network is unreachable")
}

fn parse_repo_owner(repo: &str) -> Option<String> {
    repo.split('/')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn resolve_remote_repo(repo: &Repository, remote_name: &str) -> Option<String> {
    let remote = repo.find_remote(remote_name).ok()?;
    let remote_url = remote.url()?;
    parse_github_repo(remote_url)
}

fn infer_remote_head_branch(repo: &Repository, remote_name: &str) -> Option<String> {
    let head_ref = format!("refs/remotes/{remote_name}/HEAD");
    let reference = repo.find_reference(&head_ref).ok()?;
    let symbolic_target = reference.symbolic_target()?;
    let prefix = format!("refs/remotes/{remote_name}/");
    symbolic_target
        .strip_prefix(prefix.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn default_pr_description(base_branch: &str, head_branch: &str) -> String {
    format!(
        "## 背景\n- 从 `{base_branch}` 合并到 `{head_branch}`。\n\n## 改动点\n- \n\n## 验证\n- [ ] npm run typecheck\n- [ ] npm run lint"
    )
}

fn build_workflow_stages() -> Vec<GitPrWorkflowStage> {
    vec![
        GitPrWorkflowStage {
            key: "precheck".to_string(),
            status: "pending".to_string(),
            detail: "Waiting for precheck.".to_string(),
            command: None,
            stdout: None,
            stderr: None,
        },
        GitPrWorkflowStage {
            key: "push".to_string(),
            status: "pending".to_string(),
            detail: "Waiting for push.".to_string(),
            command: None,
            stdout: None,
            stderr: None,
        },
        GitPrWorkflowStage {
            key: "create".to_string(),
            status: "pending".to_string(),
            detail: "Waiting for PR creation.".to_string(),
            command: None,
            stdout: None,
            stderr: None,
        },
        GitPrWorkflowStage {
            key: "comment".to_string(),
            status: "pending".to_string(),
            detail: "Waiting for optional comment.".to_string(),
            command: None,
            stdout: None,
            stderr: None,
        },
    ]
}

fn update_workflow_stage(
    stages: &mut [GitPrWorkflowStage],
    key: &str,
    status: &str,
    detail: String,
    command: Option<String>,
    stdout: Option<String>,
    stderr: Option<String>,
) {
    if let Some(stage) = stages.iter_mut().find(|entry| entry.key == key) {
        stage.status = status.to_string();
        stage.detail = detail;
        stage.command = command;
        stage.stdout = stdout;
        stage.stderr = stderr;
    }
}

fn stage_error_category_and_hint(stage_key: &str, raw: &str) -> (String, String) {
    if stage_key == "precheck" {
        if raw.to_lowercase().contains("gh") && raw.to_lowercase().contains("not found") {
            return (
                "gh-not-installed".to_string(),
                "Install GitHub CLI and run `gh auth login` first.".to_string(),
            );
        }
        if is_auth_related_error(raw) {
            return (
                "gh-auth-missing".to_string(),
                "Run `env -u GH_TOKEN -u GITHUB_TOKEN gh auth status -h github.com` and finish login.".to_string(),
            );
        }
        if raw.to_lowercase().contains("range gate") {
            return (
                "range-abnormal".to_string(),
                "Review changed files against upstream base, then re-run after rebasing/fixing scope.".to_string(),
            );
        }
    }
    if stage_key == "push" {
        if is_http2_transport_error(raw) {
            return (
                "push-http2".to_string(),
                "Retry with HTTP/1.1 fallback: `git -c http.version=HTTP/1.1 push ...`."
                    .to_string(),
            );
        }
        if is_auth_related_error(raw) {
            return (
                "push-auth".to_string(),
                "Verify fork push permission and run with token-isolated env (`env -u GH_TOKEN -u GITHUB_TOKEN`).".to_string(),
            );
        }
        if is_network_related_error(raw) {
            return (
                "push-network".to_string(),
                "Check network/proxy connectivity to github.com:443, then retry.".to_string(),
            );
        }
    }
    if stage_key == "create" {
        if is_auth_related_error(raw) {
            return (
                "create-pr-auth".to_string(),
                "Use `env -u GH_TOKEN -u GITHUB_TOKEN` and ensure `gh auth status` is healthy."
                    .to_string(),
            );
        }
        if is_network_related_error(raw) {
            return (
                "create-pr-network".to_string(),
                "Network seems unstable. Retry once after validating GitHub connectivity."
                    .to_string(),
            );
        }
    }
    (
        "unknown".to_string(),
        "Check stage stderr and retry.".to_string(),
    )
}

fn extract_pr_url(raw: &str) -> Option<String> {
    raw.split_whitespace()
        .find(|token| token.starts_with("https://") && token.contains("/pull/"))
        .map(|token| {
            token
                .trim()
                .trim_matches('\'')
                .trim_matches('"')
                .trim_end_matches('.')
                .to_string()
        })
}

fn extract_pr_number_from_url(url: &str) -> Option<u64> {
    let pull_segment = url.split("/pull/").nth(1)?;
    let number_text = pull_segment
        .split(['/', '?', '#'])
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    number_text.parse::<u64>().ok()
}

fn is_suspicious_range_path(path: &str) -> bool {
    let normalized = normalize_git_path(path).to_lowercase();
    normalized == "readme.md" || normalized == "readme.zh-cn.md" || normalized == "license"
}

fn evaluate_pr_range_gate(changed_paths: &[String]) -> PrRangeGateDecision {
    if changed_paths.is_empty() {
        return PrRangeGateDecision::Blocked {
            category: "range-empty".to_string(),
            reason: "Range gate blocked: `upstream/<base>...HEAD` has no changed files."
                .to_string(),
        };
    }
    if changed_paths.len() > PR_RANGE_MAX_CHANGED_FILES {
        return PrRangeGateDecision::Blocked {
            category: "range-too-large".to_string(),
            reason: format!(
                "Range gate blocked: {} changed files exceed threshold {}.",
                changed_paths.len(),
                PR_RANGE_MAX_CHANGED_FILES
            ),
        };
    }
    let suspicious_files = changed_paths
        .iter()
        .filter(|path| is_suspicious_range_path(path))
        .cloned()
        .collect::<Vec<_>>();
    if !suspicious_files.is_empty() && changed_paths.len() >= PR_RANGE_SUSPICIOUS_THRESHOLD {
        return PrRangeGateDecision::Blocked {
            category: "range-suspicious".to_string(),
            reason: format!(
                "Range gate blocked: suspicious root files detected ({}). Re-check branch base before creating PR.",
                suspicious_files.join(", ")
            ),
        };
    }
    PrRangeGateDecision::Pass {
        changed_files: changed_paths.len(),
    }
}

fn build_failed_pr_workflow_result(
    stages: Vec<GitPrWorkflowStage>,
    stage_key: &str,
    raw_error: String,
    retry_command: Option<String>,
) -> GitPrWorkflowResult {
    let (category, hint) = stage_error_category_and_hint(stage_key, &raw_error);
    GitPrWorkflowResult {
        ok: false,
        status: "failed".to_string(),
        message: raw_error,
        error_category: Some(category),
        next_action_hint: Some(hint),
        pr_url: None,
        pr_number: None,
        existing_pr: None,
        retry_command,
        stages,
    }
}

fn build_existing_pr_workflow_result(
    stages: Vec<GitPrWorkflowStage>,
    existing_pr: GitPrExistingPullRequest,
) -> GitPrWorkflowResult {
    GitPrWorkflowResult {
        ok: true,
        status: "existing".to_string(),
        message: format!(
            "Existing PR detected: #{} {}",
            existing_pr.number, existing_pr.title
        ),
        error_category: None,
        next_action_hint: Some(
            "Open the existing PR and continue updates on the same branch.".to_string(),
        ),
        pr_url: Some(existing_pr.url.clone()),
        pr_number: Some(existing_pr.number),
        existing_pr: Some(existing_pr),
        retry_command: None,
        stages,
    }
}

fn build_success_pr_workflow_result(
    stages: Vec<GitPrWorkflowStage>,
    pr_url: String,
    pr_number: Option<u64>,
    message: String,
) -> GitPrWorkflowResult {
    GitPrWorkflowResult {
        ok: true,
        status: "success".to_string(),
        message,
        error_category: None,
        next_action_hint: None,
        pr_url: Some(pr_url),
        pr_number,
        existing_pr: None,
        retry_command: None,
        stages,
    }
}

mod commands;
pub(crate) use commands::*;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use validation::validate_local_branch_name;

    fn create_temp_repo() -> (PathBuf, Repository) {
        let root = std::env::temp_dir().join(format!("moss-x-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp repo root");
        let repo = Repository::init(&root).expect("init repo");
        (root, repo)
    }

    async fn commit_all_with_message(repo_root: &Path, message: &str) {
        run_git_command(repo_root, &["add", "-A"])
            .await
            .expect("stage files");
        run_git_command(
            repo_root,
            &[
                "-c",
                "user.name=TestUser",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                message,
            ],
        )
        .await
        .expect("commit staged files");
    }

    fn assert_worktree_clean(repo_root: &Path) {
        let repo = open_repository_at_root(repo_root).expect("open repo");
        let mut status_options = StatusOptions::new();
        status_options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false);
        let statuses = repo
            .statuses(Some(&mut status_options))
            .expect("collect statuses");
        assert!(
            statuses.is_empty(),
            "expected clean worktree, found {} entries",
            statuses.len()
        );
    }

    #[tokio::test]
    async fn checkout_roundtrip_between_divergent_branches_stays_clean() {
        let (root, _repo) = create_temp_repo();

        fs::write(root.join("shared.txt"), "main base\n").expect("write initial main file");
        commit_all_with_message(&root, "init main").await;
        run_git_command(&root, &["branch", "-M", "main"])
            .await
            .expect("rename default branch to main");

        run_git_command(&root, &["checkout", "-b", "feature/divergent"])
            .await
            .expect("create feature branch");
        fs::remove_file(root.join("shared.txt")).expect("remove shared file on feature branch");
        fs::write(root.join("feature-only.txt"), "feature branch content\n")
            .expect("write feature-only file");
        commit_all_with_message(&root, "feature commit").await;

        run_git_command(&root, &["checkout", "main"])
            .await
            .expect("switch back to main");
        fs::write(root.join("shared.txt"), "main updated\n").expect("rewrite shared file on main");
        fs::write(root.join("main-only.txt"), "main branch content\n")
            .expect("write main-only file");
        commit_all_with_message(&root, "main commit").await;

        for target in ["feature/divergent", "main", "feature/divergent", "main"] {
            run_git_command(&root, &["checkout", target])
                .await
                .unwrap_or_else(|error| panic!("checkout {target} failed: {error}"));
            assert_worktree_clean(&root);
        }
    }

    #[test]
    fn collect_workspace_diff_prefers_staged_changes() {
        let (root, repo) = create_temp_repo();
        let file_path = root.join("staged.txt");
        fs::write(&file_path, "staged\n").expect("write staged file");
        let mut index = repo.index().expect("index");
        index.add_path(Path::new("staged.txt")).expect("add path");
        index.write().expect("write index");

        let diff = collect_workspace_diff(&root).expect("collect diff");
        assert!(diff.contains("staged.txt"));
        assert!(diff.contains("staged"));
    }

    #[test]
    fn collect_workspace_diff_falls_back_to_workdir() {
        let (root, _repo) = create_temp_repo();
        let file_path = root.join("unstaged.txt");
        fs::write(&file_path, "unstaged\n").expect("write unstaged file");

        let diff = collect_workspace_diff(&root).expect("collect diff");
        assert!(diff.contains("unstaged.txt"));
        assert!(diff.contains("unstaged"));
    }

    #[test]
    fn heavy_diff_path_guard_matches_lockfiles_and_generated_dirs() {
        assert!(is_heavy_diff_path("pnpm-lock.yaml"));
        assert!(is_heavy_diff_path(
            "packages/web/node_modules/lodash/index.js"
        ));
        assert!(is_heavy_diff_path("dist/main.bundle.js"));
        assert!(!is_heavy_diff_path("src/features/git/mod.rs"));
    }

    #[test]
    fn truncate_diff_preview_respects_line_and_byte_budgets() {
        let mut content = String::new();
        for _ in 0..20 {
            content.push_str("0123456789abcdef\n");
        }
        let trimmed = truncate_diff_preview(content, 4, 40);
        assert!(trimmed.contains("[diff truncated for performance]"));
        assert!(trimmed.lines().count() <= 6);
        assert!(trimmed.len() <= 80);
    }

    #[test]
    fn action_paths_for_file_expands_renames() {
        let (root, repo) = create_temp_repo();
        fs::write(root.join("a.txt"), "hello\n").expect("write file");

        let mut index = repo.index().expect("repo index");
        index.add_path(Path::new("a.txt")).expect("add path");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let sig = git2::Signature::now("Test", "test@example.com").expect("signature");
        repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
            .expect("commit");

        fs::rename(root.join("a.txt"), root.join("b.txt")).expect("rename file");

        // Stage the rename so libgit2 reports it as an INDEX_RENAMED entry.
        let mut index = repo.index().expect("repo index");
        index
            .remove_path(Path::new("a.txt"))
            .expect("remove old path");
        index.add_path(Path::new("b.txt")).expect("add new path");
        index.write().expect("write index");

        let paths = action_paths_for_file(&root, "b.txt");
        assert_eq!(paths, vec!["a.txt".to_string(), "b.txt".to_string()]);
    }

    #[test]
    fn open_repository_at_root_does_not_search_parent_directories() {
        let (root, _repo) = create_temp_repo();
        let nested = root.join("nested").join("non-repo");
        fs::create_dir_all(&nested).expect("create nested directory");

        let result = open_repository_at_root(&nested);
        assert!(result.is_err());
    }

    #[test]
    fn paginate_history_commits_respects_offset_and_limit() {
        let commits = (0..5)
            .map(|index| GitHistoryCommit {
                sha: format!("sha-{index}"),
                short_sha: format!("s{index}"),
                summary: format!("commit-{index}"),
                message: format!("message-{index}"),
                author: "tester".to_string(),
                author_email: "tester@example.com".to_string(),
                timestamp: 100 + index as i64,
                parents: Vec::new(),
                refs: Vec::new(),
            })
            .collect::<Vec<_>>();
        let (page, total, has_more) = paginate_history_commits(commits, 2, 2);
        assert_eq!(total, 5);
        assert_eq!(page.len(), 2);
        assert_eq!(page[0].sha, "sha-2");
        assert_eq!(page[1].sha, "sha-3");
        assert!(has_more);
    }

    #[test]
    fn validate_local_branch_name_allows_slash_and_rejects_invalid() {
        assert_eq!(
            validate_local_branch_name("feature/git-log").expect("valid branch"),
            "feature/git-log".to_string()
        );
        assert!(validate_local_branch_name("feature..broken").is_err());
    }

    #[test]
    fn detect_used_by_worktree_delete_error() {
        let message =
            "error: cannot delete branch 'feature/test' used by worktree at '/tmp/worktree'";
        assert!(is_branch_used_by_worktree_error(message));
        assert_eq!(
            extract_worktree_path_from_delete_error(message).as_deref(),
            Some("/tmp/worktree")
        );
    }

    #[test]
    fn build_actionable_used_by_worktree_error_with_path() {
        let message =
            "error: cannot delete branch 'feature/test' used by worktree at '/tmp/worktree'";
        let friendly = build_delete_branch_worktree_error("feature/test", message);
        assert!(friendly.contains("Switch that worktree to another branch"));
        assert!(friendly.contains("/tmp/worktree"));
    }

    #[test]
    fn token_isolated_command_display_includes_env_unset_prefix() {
        let rendered = build_token_isolated_command_display(
            "git",
            &[
                "push".to_string(),
                "-u".to_string(),
                "origin".to_string(),
                "HEAD:feature/a".to_string(),
            ],
        );
        assert!(rendered.starts_with("env -u GH_TOKEN -u GITHUB_TOKEN"));
        assert!(rendered.contains("git push -u origin HEAD:feature/a"));
    }

    #[test]
    fn detect_http2_transport_error_signature() {
        let message = "error: RPC failed; curl 16 Error in the HTTP2 framing layer";
        assert!(is_http2_transport_error(message));
    }

    #[test]
    fn parse_pr_number_from_url_works() {
        assert_eq!(
            extract_pr_number_from_url("https://github.com/a/b/pull/123"),
            Some(123)
        );
        assert_eq!(
            extract_pr_number_from_url("https://github.com/a/b/pull/456/files"),
            Some(456)
        );
        assert_eq!(
            extract_pr_number_from_url("https://github.com/a/b/issues/1"),
            None
        );
    }

    #[test]
    fn range_gate_blocks_oversized_changeset() {
        let paths = (0..(PR_RANGE_MAX_CHANGED_FILES + 1))
            .map(|index| format!("src/file-{index}.ts"))
            .collect::<Vec<_>>();
        let decision = evaluate_pr_range_gate(&paths);
        assert!(matches!(
            decision,
            PrRangeGateDecision::Blocked { category, .. } if category == "range-too-large"
        ));
    }

    #[test]
    fn range_gate_blocks_suspicious_root_files_when_scope_is_large() {
        let mut paths = (0..PR_RANGE_SUSPICIOUS_THRESHOLD)
            .map(|index| format!("src/file-{index}.ts"))
            .collect::<Vec<_>>();
        paths.push("README.md".to_string());
        let decision = evaluate_pr_range_gate(&paths);
        assert!(matches!(
            decision,
            PrRangeGateDecision::Blocked { category, .. } if category == "range-suspicious"
        ));
    }
}
