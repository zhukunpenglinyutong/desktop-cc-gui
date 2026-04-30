use super::*;

fn open_repository_at_root(repo_root: &Path) -> Result<git2::Repository, String> {
    git2::Repository::open_ext(
        repo_root,
        git2::RepositoryOpenFlags::NO_SEARCH,
        std::iter::empty::<&Path>(),
    )
    .map_err(|error| error.to_string())
}

fn status_for_index(status: git2::Status) -> Option<&'static str> {
    if status.contains(git2::Status::INDEX_NEW) {
        Some("A")
    } else if status.contains(git2::Status::INDEX_MODIFIED) {
        Some("M")
    } else if status.contains(git2::Status::INDEX_DELETED) {
        Some("D")
    } else if status.contains(git2::Status::INDEX_RENAMED) {
        Some("R")
    } else if status.contains(git2::Status::INDEX_TYPECHANGE) {
        Some("T")
    } else {
        None
    }
}

fn status_for_workdir(status: git2::Status) -> Option<&'static str> {
    if status.contains(git2::Status::WT_NEW) {
        Some("A")
    } else if status.contains(git2::Status::WT_MODIFIED) {
        Some("M")
    } else if status.contains(git2::Status::WT_DELETED) {
        Some("D")
    } else if status.contains(git2::Status::WT_RENAMED) {
        Some("R")
    } else if status.contains(git2::Status::WT_TYPECHANGE) {
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

fn trim_optional(value: Option<String>) -> Option<String> {
    value
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
}

fn normalize_local_branch_ref(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("refs/heads/")
        .trim()
        .to_string()
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

fn normalize_epoch_seconds(value: i64) -> i64 {
    if value.unsigned_abs() >= 1_000_000_000_000 {
        value / 1000
    } else {
        value
    }
}

fn truncate_lines(content: String, max_lines: usize) -> (String, usize, bool) {
    if max_lines == 0 {
        return (String::new(), 0, false);
    }
    let mut total_lines = 0usize;
    let mut kept_lines = Vec::new();
    let mut truncated = false;
    for line in content.lines() {
        total_lines += 1;
        if total_lines <= max_lines {
            kept_lines.push(line);
        } else {
            truncated = true;
        }
    }
    (kept_lines.join("\n"), total_lines, truncated)
}

fn first_line_or_empty(content: &str) -> String {
    content.lines().next().unwrap_or("").trim().to_string()
}

fn csv_values(input: Option<String>) -> Vec<String> {
    trim_optional(input)
        .map(|raw| {
            raw.split(',')
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn parse_repo_owner(repo: &str) -> Option<String> {
    repo.split('/').next().map(str::trim).and_then(|entry| {
        if entry.is_empty() {
            None
        } else {
            Some(entry.to_string())
        }
    })
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

const BRANCH_UPDATE_STATUS_SUCCESS: &str = "success";
const BRANCH_UPDATE_STATUS_NO_OP: &str = "no-op";
const BRANCH_UPDATE_STATUS_BLOCKED: &str = "blocked";
const BRANCH_UPDATE_REASON_ALREADY_UP_TO_DATE: &str = "already_up_to_date";
const BRANCH_UPDATE_REASON_AHEAD_ONLY: &str = "ahead_only";
const BRANCH_UPDATE_REASON_NO_UPSTREAM: &str = "no_upstream";
const BRANCH_UPDATE_REASON_DIVERGED: &str = "diverged";
const BRANCH_UPDATE_REASON_OCCUPIED_WORKTREE: &str = "occupied_worktree";
const BRANCH_UPDATE_REASON_STALE_REF: &str = "stale_ref";

struct LocalBranchUpdateState {
    branch_name: String,
    is_current: bool,
    local_oid: git2::Oid,
    upstream_name: Option<String>,
    upstream_remote: Option<String>,
    upstream_oid: Option<git2::Oid>,
    ahead: usize,
    behind: usize,
}

fn branch_update_result(
    branch_name: &str,
    status: &str,
    reason: Option<&str>,
    message: String,
    worktree_path: Option<String>,
) -> GitBranchUpdateResult {
    GitBranchUpdateResult {
        branch: branch_name.to_string(),
        status: status.to_string(),
        reason: reason.map(ToOwned::to_owned),
        message,
        worktree_path,
    }
}

fn no_upstream_branch_update_result(branch_name: &str) -> GitBranchUpdateResult {
    branch_update_result(
        branch_name,
        BRANCH_UPDATE_STATUS_BLOCKED,
        Some(BRANCH_UPDATE_REASON_NO_UPSTREAM),
        format!("Branch '{branch_name}' has no upstream tracking branch configured."),
        None,
    )
}

fn branch_update_has_upstream(state: &LocalBranchUpdateState) -> bool {
    matches!(state.upstream_name.as_deref(), Some(name) if !name.trim().is_empty())
        && matches!(state.upstream_remote.as_deref(), Some(name) if !name.trim().is_empty())
        && state.upstream_oid.is_some()
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

fn load_local_branch_update_state(
    repo_root: &Path,
    branch_name: &str,
) -> Result<LocalBranchUpdateState, String> {
    let normalized_branch = normalize_local_branch_ref(branch_name);
    if normalized_branch.is_empty() {
        return Err("Branch name cannot be empty.".to_string());
    }

    let repo = open_repository_at_root(repo_root)?;
    let branch = repo
        .find_branch(normalized_branch.as_str(), git2::BranchType::Local)
        .map_err(|_| format!("Branch not found: {normalized_branch}"))?;
    let local_oid = branch
        .get()
        .target()
        .ok_or_else(|| format!("Branch '{normalized_branch}' does not point to a commit."))?;

    let mut ahead = 0usize;
    let mut behind = 0usize;
    let mut upstream_name = None;
    let mut upstream_remote = None;
    let mut upstream_oid = None;
    if let Ok(upstream_branch) = branch.upstream() {
        let upstream_ref = upstream_branch.get();
        upstream_name = upstream_ref
            .shorthand()
            .map(|name| name.to_string())
            .or_else(|| upstream_ref.name().map(|name| name.to_string()));
        upstream_remote = upstream_name
            .as_deref()
            .and_then(parse_remote_branch)
            .map(|(remote, _)| remote);
        upstream_oid = upstream_ref.target();
        if let Some(target_oid) = upstream_oid {
            if let Ok((ahead_count, behind_count)) = repo.graph_ahead_behind(local_oid, target_oid)
            {
                ahead = ahead_count;
                behind = behind_count;
            }
        }
    }

    Ok(LocalBranchUpdateState {
        branch_name: normalized_branch.clone(),
        is_current: current_local_branch(repo_root)?.as_deref() == Some(normalized_branch.as_str()),
        local_oid,
        upstream_name,
        upstream_remote,
        upstream_oid,
        ahead,
        behind,
    })
}

fn normalize_compare_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase()
}

async fn find_branch_worktree_path(
    repo_root: &Path,
    branch_name: &str,
) -> Result<Option<String>, String> {
    let output = git_core::run_git_command(
        &repo_root.to_path_buf(),
        &["worktree", "list", "--porcelain"],
    )
    .await?;
    let target_ref = format!("refs/heads/{branch_name}");
    let repo_root_normalized = normalize_compare_path(repo_root);
    let mut current_path: Option<String> = None;
    let mut current_branch: Option<String> = None;

    for line in output.lines().chain(std::iter::once("")) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if current_branch.as_deref() == Some(target_ref.as_str()) {
                if let Some(path) = current_path.as_ref() {
                    if normalize_compare_path(Path::new(path)) != repo_root_normalized {
                        return Ok(Some(path.clone()));
                    }
                }
            }
            current_path = None;
            current_branch = None;
            continue;
        }
        if let Some(path) = trimmed.strip_prefix("worktree ") {
            current_path = Some(path.trim().to_string());
            continue;
        }
        if let Some(branch_ref) = trimmed.strip_prefix("branch ") {
            current_branch = Some(branch_ref.trim().to_string());
        }
    }

    Ok(None)
}

fn is_stale_update_ref_error(raw: &str, branch_name: &str) -> bool {
    let normalized = raw.to_lowercase();
    normalized.contains("cannot lock ref")
        && normalized.contains(&format!("refs/heads/{}", branch_name).to_lowercase())
        && normalized.contains("expected")
}

async fn update_non_current_local_branch(
    repo_root: &Path,
    branch_name: &str,
) -> Result<GitBranchUpdateResult, String> {
    let initial_state = load_local_branch_update_state(repo_root, branch_name)?;
    let upstream_name = match initial_state.upstream_name.as_deref() {
        Some(name) if !name.trim().is_empty() => name.to_string(),
        _ => {
            return Ok(no_upstream_branch_update_result(
                initial_state.branch_name.as_str(),
            ))
        }
    };
    let upstream_remote = match initial_state.upstream_remote.as_deref() {
        Some(name) if !name.trim().is_empty() => name.to_string(),
        _ => {
            return Ok(no_upstream_branch_update_result(
                initial_state.branch_name.as_str(),
            ))
        }
    };

    git_core::run_git_command(
        &repo_root.to_path_buf(),
        &["fetch", upstream_remote.as_str()],
    )
    .await?;

    if let Some(worktree_path) =
        find_branch_worktree_path(repo_root, initial_state.branch_name.as_str()).await?
    {
        return Ok(branch_update_result(
            initial_state.branch_name.as_str(),
            BRANCH_UPDATE_STATUS_BLOCKED,
            Some(BRANCH_UPDATE_REASON_OCCUPIED_WORKTREE),
            format!(
                "Branch '{}' is currently used by worktree at '{}'.",
                initial_state.branch_name, worktree_path
            ),
            Some(worktree_path),
        ));
    }

    let refreshed_state =
        load_local_branch_update_state(repo_root, initial_state.branch_name.as_str())?;
    let upstream_oid = match refreshed_state.upstream_oid {
        Some(oid) => oid,
        None => {
            return Ok(no_upstream_branch_update_result(
                refreshed_state.branch_name.as_str(),
            ))
        }
    };

    if refreshed_state.local_oid == upstream_oid || refreshed_state.behind == 0 {
        if refreshed_state.ahead > 0 {
            return Ok(branch_update_result(
                refreshed_state.branch_name.as_str(),
                BRANCH_UPDATE_STATUS_NO_OP,
                Some(BRANCH_UPDATE_REASON_AHEAD_ONLY),
                format!(
                    "Branch '{}' is ahead of upstream '{}'; no background update is required.",
                    refreshed_state.branch_name, upstream_name
                ),
                None,
            ));
        }
        return Ok(branch_update_result(
            refreshed_state.branch_name.as_str(),
            BRANCH_UPDATE_STATUS_NO_OP,
            Some(BRANCH_UPDATE_REASON_ALREADY_UP_TO_DATE),
            format!(
                "Branch '{}' is already up to date with '{}'.",
                refreshed_state.branch_name, upstream_name
            ),
            None,
        ));
    }

    if refreshed_state.ahead > 0 && refreshed_state.behind > 0 {
        return Ok(branch_update_result(
            refreshed_state.branch_name.as_str(),
            BRANCH_UPDATE_STATUS_BLOCKED,
            Some(BRANCH_UPDATE_REASON_DIVERGED),
            format!(
                "Branch '{}' has diverged from upstream '{}'. Checkout the branch and resolve it manually.",
                refreshed_state.branch_name, upstream_name
            ),
            None,
        ));
    }

    let target_ref = format!("refs/heads/{}", refreshed_state.branch_name);
    let args_owned = vec![
        "update-ref".to_string(),
        target_ref,
        upstream_oid.to_string(),
        refreshed_state.local_oid.to_string(),
    ];
    let arg_refs = args_owned.iter().map(String::as_str).collect::<Vec<_>>();
    if let Err(error) = git_core::run_git_command(&repo_root.to_path_buf(), &arg_refs).await {
        if load_local_branch_update_state(repo_root, refreshed_state.branch_name.as_str())
            .map(|latest_state| latest_state.local_oid != refreshed_state.local_oid)
            .unwrap_or(false)
        {
            return Ok(branch_update_result(
                refreshed_state.branch_name.as_str(),
                BRANCH_UPDATE_STATUS_BLOCKED,
                Some(BRANCH_UPDATE_REASON_STALE_REF),
                format!(
                    "Branch '{}' changed while updating. Refresh branch state and retry.",
                    refreshed_state.branch_name
                ),
                None,
            ));
        }
        if is_stale_update_ref_error(&error, refreshed_state.branch_name.as_str()) {
            return Ok(branch_update_result(
                refreshed_state.branch_name.as_str(),
                BRANCH_UPDATE_STATUS_BLOCKED,
                Some(BRANCH_UPDATE_REASON_STALE_REF),
                format!(
                    "Branch '{}' changed while updating. Refresh branch state and retry.",
                    refreshed_state.branch_name
                ),
                None,
            ));
        }
        return Err(format!(
            "failed to update branch '{}': {error}",
            refreshed_state.branch_name
        ));
    }

    let verified_state =
        load_local_branch_update_state(repo_root, refreshed_state.branch_name.as_str())?;
    if verified_state.local_oid != upstream_oid {
        return Err(format!(
            "failed to verify updated branch '{}': expected {}, found {}",
            verified_state.branch_name, upstream_oid, verified_state.local_oid
        ));
    }

    Ok(branch_update_result(
        verified_state.branch_name.as_str(),
        BRANCH_UPDATE_STATUS_SUCCESS,
        None,
        format!(
            "Updated branch '{}' to upstream '{}'.",
            verified_state.branch_name, upstream_name
        ),
        None,
    ))
}

fn parse_git_error_detail(stdout: &[u8], stderr: &[u8], fallback: &str) -> String {
    let stderr = String::from_utf8_lossy(stderr);
    let stdout = String::from_utf8_lossy(stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    if detail.is_empty() {
        fallback.to_string()
    } else {
        detail.to_string()
    }
}

fn extract_pr_url(stdout: &str) -> Option<String> {
    stdout
        .split_whitespace()
        .find(|entry| entry.starts_with("https://github.com/") && entry.contains("/pull/"))
        .map(ToOwned::to_owned)
}

fn extract_pr_number(pr_url: &str) -> Option<u64> {
    pr_url
        .trim_end_matches('/')
        .split('/')
        .next_back()
        .and_then(|value| value.parse::<u64>().ok())
}

fn parse_pr_diff_text(diff_text: &str) -> Vec<GitHubPullRequestDiff> {
    let mut results = Vec::<GitHubPullRequestDiff>::new();
    let mut current_path = String::new();
    let mut current_status = "M".to_string();
    let mut current_chunks = Vec::<String>::new();

    let flush = |path: &str,
                 status: &str,
                 chunks: &mut Vec<String>,
                 out: &mut Vec<GitHubPullRequestDiff>| {
        if path.is_empty() {
            chunks.clear();
            return;
        }
        let diff = chunks.join("\n");
        out.push(GitHubPullRequestDiff {
            path: normalize_git_path(path),
            status: status.to_string(),
            diff,
        });
        chunks.clear();
    };

    for raw_line in diff_text.lines() {
        if let Some(path) = raw_line.strip_prefix("diff --git a/") {
            flush(
                &current_path,
                &current_status,
                &mut current_chunks,
                &mut results,
            );
            let path = path.split(" b/").next().unwrap_or(path).trim().to_string();
            current_path = path;
            current_status = "M".to_string();
            continue;
        }
        if raw_line.starts_with("new file mode ") {
            current_status = "A".to_string();
        } else if raw_line.starts_with("deleted file mode ") {
            current_status = "D".to_string();
        } else if raw_line.starts_with("similarity index ") {
            current_status = "R".to_string();
        }
        current_chunks.push(raw_line.to_string());
    }
    flush(
        &current_path,
        &current_status,
        &mut current_chunks,
        &mut results,
    );
    results
}

fn parse_patch_diff_entries(diff_text: &str) -> Vec<GitCommitDiff> {
    let mut results = Vec::<GitCommitDiff>::new();
    let mut current_path = String::new();
    let mut current_status = "M".to_string();
    let mut current_chunks = Vec::<String>::new();

    let flush =
        |path: &str, status: &str, chunks: &mut Vec<String>, out: &mut Vec<GitCommitDiff>| {
            if path.is_empty() {
                chunks.clear();
                return;
            }
            out.push(GitCommitDiff {
                path: normalize_git_path(path),
                status: status.to_string(),
                diff: chunks.join("\n"),
                is_binary: false,
                is_image: false,
                old_image_data: None,
                new_image_data: None,
                old_image_mime: None,
                new_image_mime: None,
            });
            chunks.clear();
        };

    for raw_line in diff_text.lines() {
        if let Some(path) = raw_line.strip_prefix("diff --git a/") {
            flush(
                &current_path,
                &current_status,
                &mut current_chunks,
                &mut results,
            );
            let path = path.split(" b/").next().unwrap_or(path).trim().to_string();
            current_path = path;
            current_status = "M".to_string();
            continue;
        }
        if raw_line.starts_with("new file mode ") {
            current_status = "A".to_string();
        } else if raw_line.starts_with("deleted file mode ") {
            current_status = "D".to_string();
        } else if raw_line.starts_with("similarity index ") {
            current_status = "R".to_string();
        }
        current_chunks.push(raw_line.to_string());
    }
    flush(
        &current_path,
        &current_status,
        &mut current_chunks,
        &mut results,
    );
    results
}

fn infer_remote_head_branch(repo: &git2::Repository, remote_name: &str) -> Option<String> {
    let remote_head_ref = format!("refs/remotes/{remote_name}/HEAD");
    let reference = repo.find_reference(&remote_head_ref).ok()?;
    let target = reference.symbolic_target()?;
    target
        .strip_prefix(&format!("refs/remotes/{remote_name}/"))
        .map(|value| value.to_string())
}

impl DaemonState {
    async fn workspace_entry(&self, workspace_id: &str) -> Result<WorkspaceEntry, String> {
        let workspaces = self.workspaces.lock().await;
        workspaces
            .get(workspace_id)
            .cloned()
            .ok_or_else(|| "workspace not found".to_string())
    }

    async fn git_repo_root(&self, workspace_id: &str) -> Result<PathBuf, String> {
        let entry = self.workspace_entry(workspace_id).await?;
        crate::git_utils::resolve_git_root(&entry)
    }

    pub(crate) async fn list_git_roots(
        &self,
        workspace_id: String,
        depth: Option<usize>,
    ) -> Result<Vec<String>, String> {
        let entry = self.workspace_entry(&workspace_id).await?;
        let root = PathBuf::from(entry.path);
        let depth = depth.unwrap_or(2).clamp(1, 6);
        Ok(crate::git_utils::list_git_roots(&root, depth, 200))
    }

    pub(crate) async fn get_git_status(&self, workspace_id: String) -> Result<Value, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo = open_repository_at_root(&repo_root)?;
        let branch_name = repo
            .head()
            .ok()
            .and_then(|head| head.shorthand().map(|name| name.to_string()))
            .unwrap_or_else(|| "unknown".to_string());

        let mut options = git2::StatusOptions::new();
        options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .renames_head_to_index(true)
            .renames_index_to_workdir(true)
            .include_ignored(false);

        let statuses = repo
            .statuses(Some(&mut options))
            .map_err(|error| error.to_string())?;

        let mut files = Vec::<GitFileStatus>::new();
        let mut staged_files = Vec::<GitFileStatus>::new();
        let mut unstaged_files = Vec::<GitFileStatus>::new();

        for status_entry in statuses.iter() {
            let Some(path) = status_entry.path() else {
                continue;
            };
            if path.is_empty() {
                continue;
            }
            let status = status_entry.status();
            let normalized_path = normalize_git_path(path);

            let index_status = status_for_index(status);
            let workdir_status = status_for_workdir(status);
            if let Some(stage) = index_status {
                staged_files.push(GitFileStatus {
                    path: normalized_path.clone(),
                    status: stage.to_string(),
                    additions: 0,
                    deletions: 0,
                });
            }
            if let Some(stage) = workdir_status {
                unstaged_files.push(GitFileStatus {
                    path: normalized_path.clone(),
                    status: stage.to_string(),
                    additions: 0,
                    deletions: 0,
                });
            }
            if index_status.is_some() || workdir_status.is_some() {
                files.push(GitFileStatus {
                    path: normalized_path,
                    status: workdir_status.or(index_status).unwrap_or("--").to_string(),
                    additions: 0,
                    deletions: 0,
                });
            }
        }

        Ok(json!({
            "branchName": branch_name,
            "files": files,
            "stagedFiles": staged_files,
            "unstagedFiles": unstaged_files,
            "totalAdditions": 0,
            "totalDeletions": 0,
        }))
    }

    pub(crate) async fn get_git_diffs(
        &self,
        workspace_id: String,
    ) -> Result<Vec<GitFileDiff>, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        tokio::task::spawn_blocking(move || {
            let repo = open_repository_at_root(&repo_root)?;
            let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());

            let mut options = git2::DiffOptions::new();
            options
                .include_untracked(true)
                .recurse_untracked_dirs(true)
                .show_untracked_content(true);

            let diff = match head_tree.as_ref() {
                Some(tree) => repo
                    .diff_tree_to_workdir_with_index(Some(tree), Some(&mut options))
                    .map_err(|error| error.to_string())?,
                None => repo
                    .diff_tree_to_workdir_with_index(None, Some(&mut options))
                    .map_err(|error| error.to_string())?,
            };

            let mut results = Vec::new();
            for (index, delta) in diff.deltas().enumerate() {
                let path = delta.new_file().path().or_else(|| delta.old_file().path());
                let Some(path) = path else {
                    continue;
                };
                let normalized_path = normalize_git_path(&path.to_string_lossy());
                let patch =
                    git2::Patch::from_diff(&diff, index).map_err(|error| error.to_string())?;
                if let Some(mut patch) = patch {
                    let content =
                        crate::git_utils::diff_patch_to_string(&mut patch).unwrap_or_default();
                    if content.trim().is_empty() {
                        continue;
                    }
                    results.push(GitFileDiff {
                        path: normalized_path,
                        diff: content,
                        is_binary: false,
                        is_image: false,
                        old_image_data: None,
                        new_image_data: None,
                        old_image_mime: None,
                        new_image_mime: None,
                    });
                } else {
                    results.push(GitFileDiff {
                        path: normalized_path,
                        diff: String::new(),
                        is_binary: true,
                        is_image: false,
                        old_image_data: None,
                        new_image_data: None,
                        old_image_mime: None,
                        new_image_mime: None,
                    });
                }
            }
            Ok(results)
        })
        .await
        .map_err(|error| error.to_string())?
    }

    pub(crate) async fn get_git_file_full_diff(
        &self,
        workspace_id: String,
        path: String,
    ) -> Result<String, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let trimmed_path = path.trim();
        if trimmed_path.is_empty() {
            return Err("path is required".to_string());
        }
        let diff_head =
            git_core::run_git_diff(&repo_root, &["diff", "HEAD", "--", trimmed_path]).await;
        let mut content = match diff_head {
            Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
            Err(_) => String::new(),
        };
        if content.trim().is_empty() {
            if let Ok(bytes) =
                git_core::run_git_diff(&repo_root, &["diff", "--", trimmed_path]).await
            {
                content = String::from_utf8_lossy(&bytes).to_string();
            }
            if let Ok(bytes) =
                git_core::run_git_diff(&repo_root, &["diff", "--cached", "--", trimmed_path]).await
            {
                let staged = String::from_utf8_lossy(&bytes).to_string();
                if !staged.trim().is_empty() {
                    if !content.trim().is_empty() {
                        content.push_str("\n\n");
                    }
                    content.push_str(&staged);
                }
            }
        }
        Ok(content)
    }

    pub(crate) async fn get_git_log(
        &self,
        workspace_id: String,
        limit: Option<usize>,
    ) -> Result<GitLogResponse, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo = open_repository_at_root(&repo_root)?;
        let head = repo
            .head()
            .map_err(|error| error.to_string())?
            .target()
            .ok_or_else(|| "HEAD does not point to a commit".to_string())?;
        let limit = limit.unwrap_or(40).clamp(1, 400);
        let mut revwalk = repo.revwalk().map_err(|error| error.to_string())?;
        revwalk
            .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
            .map_err(|error| error.to_string())?;
        revwalk.push(head).map_err(|error| error.to_string())?;
        let mut entries = Vec::<GitLogEntry>::new();
        for oid_result in revwalk.take(limit) {
            let oid = oid_result.map_err(|error| error.to_string())?;
            let commit = repo.find_commit(oid).map_err(|error| error.to_string())?;
            entries.push(crate::git_utils::commit_to_entry(commit));
        }
        Ok(GitLogResponse {
            total: entries.len(),
            entries,
            ahead: 0,
            behind: 0,
            ahead_entries: Vec::new(),
            behind_entries: Vec::new(),
            upstream: None,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn get_git_commit_history(
        &self,
        workspace_id: String,
        branch: Option<String>,
        query: Option<String>,
        author: Option<String>,
        date_from: Option<i64>,
        date_to: Option<i64>,
        snapshot_id: Option<String>,
        offset: usize,
        limit: usize,
    ) -> Result<GitHistoryResponse, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo = open_repository_at_root(&repo_root)?;
        let query = trim_optional(query).map(|entry| entry.to_lowercase());
        let author = trim_optional(author).map(|entry| entry.to_lowercase());
        let date_from = date_from.map(normalize_epoch_seconds);
        let date_to = date_to.map(normalize_epoch_seconds);
        let offset = offset.min(50_000);
        let limit = limit.clamp(1, 500);

        let mut revwalk = repo.revwalk().map_err(|error| error.to_string())?;
        revwalk
            .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
            .map_err(|error| error.to_string())?;

        if let Some(branch_name) = trim_optional(branch) {
            let normalized = normalize_local_branch_ref(&branch_name);
            let local_ref = format!("refs/heads/{normalized}");
            if revwalk.push_ref(&local_ref).is_err() && revwalk.push_ref(&branch_name).is_err() {
                return Err(format!("Branch or ref not found: {branch_name}"));
            }
        } else if let Some(head) = repo.head().ok().and_then(|value| value.target()) {
            revwalk.push(head).map_err(|error| error.to_string())?;
        } else {
            return Err("HEAD does not point to a commit".to_string());
        }

        let mut filtered = Vec::<GitHistoryCommit>::new();
        for oid_result in revwalk {
            let oid = oid_result.map_err(|error| error.to_string())?;
            let commit = repo.find_commit(oid).map_err(|error| error.to_string())?;
            let timestamp = commit.time().seconds();
            if let Some(lower_bound) = date_from {
                if timestamp < lower_bound {
                    continue;
                }
            }
            if let Some(upper_bound) = date_to {
                if timestamp > upper_bound {
                    continue;
                }
            }

            let summary = commit.summary().unwrap_or("").to_string();
            let message = commit.message().unwrap_or("").to_string();
            let author_name = commit.author().name().unwrap_or("").to_string();
            let author_email = commit.author().email().unwrap_or("").to_string();
            let searchable = format!(
                "{}\n{}\n{}\n{}",
                summary.to_lowercase(),
                message.to_lowercase(),
                author_name.to_lowercase(),
                author_email.to_lowercase()
            );
            if let Some(ref query_text) = query {
                if !searchable.contains(query_text) && !oid.to_string().contains(query_text) {
                    continue;
                }
            }
            if let Some(ref author_text) = author {
                let haystack = format!(
                    "{} {}",
                    author_name.to_lowercase(),
                    author_email.to_lowercase()
                );
                if !haystack.contains(author_text) {
                    continue;
                }
            }
            let sha = oid.to_string();
            let short_sha = sha.chars().take(7).collect::<String>();
            let parents = commit
                .parents()
                .map(|parent| parent.id().to_string())
                .collect();
            filtered.push(GitHistoryCommit {
                sha,
                short_sha,
                summary,
                message,
                author: author_name,
                author_email,
                timestamp,
                parents,
                refs: Vec::new(),
            });
        }

        let total = filtered.len();
        let commits: Vec<GitHistoryCommit> =
            filtered.into_iter().skip(offset).take(limit).collect();
        let has_more = offset.saturating_add(commits.len()) < total;
        let snapshot_id = trim_optional(snapshot_id).unwrap_or_else(|| Uuid::new_v4().to_string());
        Ok(GitHistoryResponse {
            snapshot_id,
            total,
            offset,
            limit,
            has_more,
            commits,
        })
    }

    pub(crate) async fn resolve_git_commit_ref(
        &self,
        workspace_id: String,
        target: String,
    ) -> Result<String, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let normalized = target.trim();
        if normalized.is_empty() {
            return Err("target is required".to_string());
        }
        let output = git_core::run_git_command(
            &repo_root,
            &["rev-parse", "--verify", &format!("{normalized}^{{commit}}")],
        )
        .await?;
        Ok(first_line_or_empty(&output))
    }

    pub(crate) async fn get_git_commit_details(
        &self,
        workspace_id: String,
        commit_hash: String,
        max_diff_lines: usize,
    ) -> Result<GitCommitDetails, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo = open_repository_at_root(&repo_root)?;
        let target = commit_hash.trim();
        if target.is_empty() {
            return Err("commit hash is required".to_string());
        }
        let object = repo
            .revparse_single(target)
            .map_err(|error| error.to_string())?;
        let commit = object.peel_to_commit().map_err(|error| error.to_string())?;
        let tree = commit.tree().map_err(|error| error.to_string())?;
        let parent_tree = if commit.parent_count() > 0 {
            Some(
                commit
                    .parent(0)
                    .map_err(|error| error.to_string())?
                    .tree()
                    .map_err(|error| error.to_string())?,
            )
        } else {
            None
        };
        let mut options = git2::DiffOptions::new();
        let diff = repo
            .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut options))
            .map_err(|error| error.to_string())?;

        let mut files = Vec::<GitCommitFileChange>::new();
        let mut total_additions = 0i64;
        let mut total_deletions = 0i64;
        for (index, delta) in diff.deltas().enumerate() {
            let old_path = delta
                .old_file()
                .path()
                .map(|path| normalize_git_path(&path.to_string_lossy()));
            let new_path = delta
                .new_file()
                .path()
                .map(|path| normalize_git_path(&path.to_string_lossy()));
            let display_path = new_path
                .clone()
                .or_else(|| old_path.clone())
                .unwrap_or_default();
            if display_path.is_empty() {
                continue;
            }
            let status = status_for_delta(delta.status()).to_string();
            let patch = git2::Patch::from_diff(&diff, index).map_err(|error| error.to_string())?;
            if let Some(mut patch) = patch {
                let raw_content =
                    crate::git_utils::diff_patch_to_string(&mut patch).unwrap_or_default();
                let (diff_content, line_count, truncated) =
                    truncate_lines(raw_content, max_diff_lines.max(1));
                let (_, additions, deletions) = patch.line_stats().unwrap_or((0, 0, 0));
                total_additions += additions as i64;
                total_deletions += deletions as i64;
                files.push(GitCommitFileChange {
                    path: display_path,
                    old_path: old_path
                        .filter(|value| *value != new_path.clone().unwrap_or_default()),
                    status,
                    additions: additions as i64,
                    deletions: deletions as i64,
                    is_binary: false,
                    is_image: false,
                    diff: diff_content,
                    line_count,
                    truncated,
                });
            } else {
                files.push(GitCommitFileChange {
                    path: display_path,
                    old_path: old_path
                        .filter(|value| *value != new_path.clone().unwrap_or_default()),
                    status,
                    additions: 0,
                    deletions: 0,
                    is_binary: true,
                    is_image: false,
                    diff: String::new(),
                    line_count: 0,
                    truncated: false,
                });
            }
        }

        let author_signature = commit.author();
        let committer_signature = commit.committer();
        let parents = commit
            .parents()
            .map(|parent| parent.id().to_string())
            .collect();
        let details = GitCommitDetails {
            sha: commit.id().to_string(),
            summary: commit.summary().unwrap_or("").to_string(),
            message: commit.message().unwrap_or("").to_string(),
            author: author_signature.name().unwrap_or("").to_string(),
            author_email: author_signature.email().unwrap_or("").to_string(),
            committer: committer_signature.name().unwrap_or("").to_string(),
            committer_email: committer_signature.email().unwrap_or("").to_string(),
            author_time: author_signature.when().seconds(),
            commit_time: committer_signature.when().seconds(),
            parents,
            files,
            total_additions,
            total_deletions,
        };
        Ok(details)
    }

    pub(crate) async fn get_git_commit_diff(
        &self,
        workspace_id: String,
        sha: String,
        path: Option<String>,
        context_lines: Option<usize>,
    ) -> Result<Vec<GitCommitDiff>, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo = open_repository_at_root(&repo_root)?;
        let target = sha.trim();
        if target.is_empty() {
            return Err("sha is required".to_string());
        }
        let object = repo
            .revparse_single(target)
            .map_err(|error| error.to_string())?;
        let commit = object.peel_to_commit().map_err(|error| error.to_string())?;
        let tree = commit.tree().map_err(|error| error.to_string())?;
        let parent_tree = if commit.parent_count() > 0 {
            Some(
                commit
                    .parent(0)
                    .map_err(|error| error.to_string())?
                    .tree()
                    .map_err(|error| error.to_string())?,
            )
        } else {
            None
        };
        let mut options = git2::DiffOptions::new();
        if let Some(lines) = context_lines {
            options.context_lines(lines as u32);
        }
        if let Some(path_filter) = trim_optional(path) {
            options.pathspec(path_filter);
        }
        let diff = repo
            .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut options))
            .map_err(|error| error.to_string())?;

        let mut files = Vec::<GitCommitDiff>::new();
        for (index, delta) in diff.deltas().enumerate() {
            let display_path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|path| normalize_git_path(&path.to_string_lossy()))
                .unwrap_or_default();
            if display_path.is_empty() {
                continue;
            }
            let status = status_for_delta(delta.status()).to_string();
            let patch = git2::Patch::from_diff(&diff, index).map_err(|error| error.to_string())?;
            if let Some(mut patch) = patch {
                let content =
                    crate::git_utils::diff_patch_to_string(&mut patch).unwrap_or_default();
                files.push(GitCommitDiff {
                    path: display_path,
                    status,
                    diff: content,
                    is_binary: false,
                    is_image: false,
                    old_image_data: None,
                    new_image_data: None,
                    old_image_mime: None,
                    new_image_mime: None,
                });
            } else {
                files.push(GitCommitDiff {
                    path: display_path,
                    status,
                    diff: String::new(),
                    is_binary: true,
                    is_image: false,
                    old_image_data: None,
                    new_image_data: None,
                    old_image_mime: None,
                    new_image_mime: None,
                });
            }
        }
        Ok(files)
    }

    pub(crate) async fn get_git_remote(
        &self,
        workspace_id: String,
    ) -> Result<Option<String>, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        match git_core::run_git_command(&repo_root, &["remote", "get-url", "origin"]).await {
            Ok(value) => {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(trimmed))
                }
            }
            Err(_) => Ok(None),
        }
    }

    pub(crate) async fn stage_git_file(
        &self,
        workspace_id: String,
        path: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let path = path.trim();
        if path.is_empty() {
            return Err("path is required".to_string());
        }
        git_core::run_git_command(&repo_root, &["add", "-A", "--", path]).await?;
        Ok(())
    }

    pub(crate) async fn stage_git_all(&self, workspace_id: String) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        git_core::run_git_command(&repo_root, &["add", "-A"]).await?;
        Ok(())
    }

    pub(crate) async fn unstage_git_file(
        &self,
        workspace_id: String,
        path: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let path = path.trim();
        if path.is_empty() {
            return Err("path is required".to_string());
        }
        git_core::run_git_command(&repo_root, &["restore", "--staged", "--", path]).await?;
        Ok(())
    }

    pub(crate) async fn revert_git_file(
        &self,
        workspace_id: String,
        path: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let path = path.trim();
        if path.is_empty() {
            return Err("path is required".to_string());
        }
        if git_core::run_git_command(
            &repo_root,
            &["restore", "--staged", "--worktree", "--", path],
        )
        .await
        .is_err()
        {
            git_core::run_git_command(&repo_root, &["clean", "-f", "--", path]).await?;
        }
        Ok(())
    }

    pub(crate) async fn revert_git_all(&self, workspace_id: String) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        git_core::run_git_command(
            &repo_root,
            &["restore", "--staged", "--worktree", "--", "."],
        )
        .await?;
        git_core::run_git_command(&repo_root, &["clean", "-f", "-d"]).await?;
        Ok(())
    }

    pub(crate) async fn commit_git(
        &self,
        workspace_id: String,
        message: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let message = message.trim();
        if message.is_empty() {
            return Err("message is required".to_string());
        }
        git_core::run_git_command(&repo_root, &["commit", "-m", message]).await?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn push_git(
        &self,
        workspace_id: String,
        remote: Option<String>,
        branch: Option<String>,
        force_with_lease: Option<bool>,
        push_tags: Option<bool>,
        run_hooks: Option<bool>,
        push_to_gerrit: Option<bool>,
        topic: Option<String>,
        reviewers: Option<String>,
        cc: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let mut args = vec!["push".to_string()];
        if !run_hooks.unwrap_or(true) {
            args.push("--no-verify".to_string());
        }
        if force_with_lease.unwrap_or(false) {
            args.push("--force-with-lease".to_string());
        }
        if push_tags.unwrap_or(false) {
            args.push("--follow-tags".to_string());
        }

        let target_remote = trim_optional(remote);
        let target_branch = trim_optional(branch).map(|value| normalize_local_branch_ref(&value));
        if push_to_gerrit.unwrap_or(false) {
            let remote_name = target_remote.unwrap_or_else(|| "origin".to_string());
            let branch_name = if let Some(branch_name) = target_branch {
                Some(branch_name)
            } else {
                git_core::run_git_command(&repo_root, &["branch", "--show-current"])
                    .await
                    .ok()
                    .and_then(|raw| trim_optional(Some(raw)))
            }
            .ok_or_else(|| "Branch is required for Gerrit push.".to_string())?;
            let mut refspec = format!("HEAD:refs/for/{branch_name}");
            let mut params = Vec::new();
            if let Some(topic_name) = trim_optional(topic) {
                params.push(format!("topic={topic_name}"));
            }
            for reviewer in csv_values(reviewers) {
                params.push(format!("r={reviewer}"));
            }
            for cc_member in csv_values(cc) {
                params.push(format!("cc={cc_member}"));
            }
            if !params.is_empty() {
                refspec.push('%');
                refspec.push_str(&params.join(","));
            }
            args.push(remote_name);
            args.push(refspec);
        } else {
            if let Some(remote_name) = target_remote {
                args.push(remote_name);
            }
            if let Some(branch_name) = target_branch {
                args.push(format!("HEAD:{branch_name}"));
            }
        }

        git_core::run_git_command_owned(repo_root, args).await?;
        Ok(())
    }

    pub(crate) async fn pull_git(
        &self,
        workspace_id: String,
        remote: Option<String>,
        branch: Option<String>,
        strategy: Option<String>,
        no_commit: Option<bool>,
        no_verify: Option<bool>,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let mut args = vec!["pull".to_string()];
        if let Some(strategy_flag) = trim_optional(strategy) {
            match strategy_flag.as_str() {
                "--rebase" | "--ff-only" | "--no-ff" | "--squash" => args.push(strategy_flag),
                _ => return Err("Unsupported pull strategy option.".to_string()),
            }
        }
        if no_commit.unwrap_or(false) {
            args.push("--no-commit".to_string());
        }
        if no_verify.unwrap_or(false) {
            args.push("--no-verify".to_string());
        }
        if let Some(remote_name) = trim_optional(remote) {
            args.push(remote_name);
            if let Some(branch_name) = trim_optional(branch) {
                args.push(normalize_local_branch_ref(&branch_name));
            }
        } else if let Some(branch_name) = trim_optional(branch) {
            args.push("origin".to_string());
            args.push(normalize_local_branch_ref(&branch_name));
        }
        git_core::run_git_command_owned(repo_root, args).await?;
        Ok(())
    }

    pub(crate) async fn sync_git(&self, workspace_id: String) -> Result<(), String> {
        self.pull_git(workspace_id.clone(), None, None, None, None, None)
            .await?;
        self.push_git(
            workspace_id,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await?;
        Ok(())
    }

    pub(crate) async fn git_pull(&self, workspace_id: String) -> Result<(), String> {
        self.pull_git(workspace_id, None, None, None, None, None)
            .await
    }

    pub(crate) async fn git_push(&self, workspace_id: String) -> Result<(), String> {
        self.push_git(
            workspace_id,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
    }

    pub(crate) async fn git_sync(&self, workspace_id: String) -> Result<(), String> {
        self.sync_git(workspace_id).await
    }

    pub(crate) async fn git_fetch(
        &self,
        workspace_id: String,
        remote: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        if let Some(remote_name) = trim_optional(remote) {
            git_core::run_git_command(&repo_root, &["fetch", remote_name.as_str()]).await?;
        } else {
            git_core::run_git_command(&repo_root, &["fetch", "--all"]).await?;
        }
        Ok(())
    }

    pub(crate) async fn update_git_branch(
        &self,
        workspace_id: String,
        branch_name: String,
    ) -> Result<GitBranchUpdateResult, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let normalized_branch = normalize_local_branch_ref(&branch_name);
        if normalized_branch.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }

        let branch_state = load_local_branch_update_state(&repo_root, normalized_branch.as_str())?;
        if !branch_update_has_upstream(&branch_state) {
            return Ok(no_upstream_branch_update_result(
                branch_state.branch_name.as_str(),
            ));
        }
        if branch_state.is_current {
            self.pull_git(workspace_id, None, None, None, None, None)
                .await?;
            return Ok(branch_update_result(
                branch_state.branch_name.as_str(),
                BRANCH_UPDATE_STATUS_SUCCESS,
                None,
                format!("Updated current branch '{}'.", branch_state.branch_name),
                None,
            ));
        }

        update_non_current_local_branch(&repo_root, branch_state.branch_name.as_str()).await
    }

    pub(crate) async fn cherry_pick_commit(
        &self,
        workspace_id: String,
        commit_hash: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let commit_hash = commit_hash.trim();
        if commit_hash.is_empty() {
            return Err("commit hash is required".to_string());
        }
        git_core::run_git_command(&repo_root, &["cherry-pick", commit_hash]).await?;
        Ok(())
    }

    pub(crate) async fn revert_commit(
        &self,
        workspace_id: String,
        commit_hash: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let commit_hash = commit_hash.trim();
        if commit_hash.is_empty() {
            return Err("commit hash is required".to_string());
        }
        git_core::run_git_command(&repo_root, &["revert", "--no-edit", commit_hash]).await?;
        Ok(())
    }

    pub(crate) async fn reset_git_commit(
        &self,
        workspace_id: String,
        commit_hash: String,
        mode: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let commit_hash = commit_hash.trim();
        if commit_hash.is_empty() {
            return Err("commit hash is required".to_string());
        }
        let mode_flag = match mode.trim().to_ascii_lowercase().as_str() {
            "soft" => "--soft",
            "hard" => "--hard",
            "keep" => "--keep",
            _ => "--mixed",
        };
        git_core::run_git_command(&repo_root, &["reset", mode_flag, commit_hash]).await?;
        Ok(())
    }

    pub(crate) async fn list_git_branches(&self, workspace_id: String) -> Result<Value, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo = open_repository_at_root(&repo_root)?;
        let current_branch = repo
            .head()
            .ok()
            .filter(|head| head.is_branch())
            .and_then(|head| head.shorthand().map(|name| name.to_string()));

        let mut branches = Vec::<BranchInfo>::new();
        let mut local_branches = Vec::<GitBranchListItem>::new();
        let local_refs = repo
            .branches(Some(git2::BranchType::Local))
            .map_err(|error| error.to_string())?;
        for branch_result in local_refs {
            let (branch, _) = branch_result.map_err(|error| error.to_string())?;
            let name = branch.name().ok().flatten().unwrap_or("").to_string();
            if name.is_empty() {
                continue;
            }
            let local_oid = branch.get().target();
            let last_commit = local_oid
                .and_then(|oid| repo.find_commit(oid).ok())
                .map(|commit| commit.time().seconds())
                .unwrap_or(0);
            let mut ahead = 0usize;
            let mut behind = 0usize;
            let mut upstream = None;
            if let Ok(upstream_branch) = branch.upstream() {
                let upstream_ref = upstream_branch.get();
                upstream = upstream_ref
                    .shorthand()
                    .map(|name| name.to_string())
                    .or_else(|| upstream_ref.name().map(|name| name.to_string()));
                if let (Some(local_oid), Some(upstream_oid)) = (local_oid, upstream_ref.target()) {
                    if let Ok((ahead_count, behind_count)) =
                        repo.graph_ahead_behind(local_oid, upstream_oid)
                    {
                        ahead = ahead_count;
                        behind = behind_count;
                    }
                }
            }

            branches.push(BranchInfo {
                name: name.clone(),
                last_commit,
            });
            local_branches.push(GitBranchListItem {
                name: name.clone(),
                is_current: current_branch.as_deref() == Some(name.as_str()),
                is_remote: false,
                remote: None,
                last_commit,
                head_sha: local_oid.map(|oid| oid.to_string()),
                ahead,
                behind,
                upstream,
            });
        }
        branches.sort_by(|left, right| right.last_commit.cmp(&left.last_commit));
        local_branches.sort_by(|left, right| left.name.cmp(&right.name));

        let mut remote_branches = Vec::<GitBranchListItem>::new();
        let remote_refs = repo
            .branches(Some(git2::BranchType::Remote))
            .map_err(|error| error.to_string())?;
        for branch_result in remote_refs {
            let (branch, _) = branch_result.map_err(|error| error.to_string())?;
            let name = branch.name().ok().flatten().unwrap_or("").to_string();
            if name.is_empty() || name.ends_with("/HEAD") {
                continue;
            }
            let (remote, _) =
                parse_remote_branch(&name).unwrap_or_else(|| ("origin".to_string(), name.clone()));
            let last_commit = branch
                .get()
                .target()
                .and_then(|oid| repo.find_commit(oid).ok())
                .map(|commit| commit.time().seconds())
                .unwrap_or(0);
            remote_branches.push(GitBranchListItem {
                name,
                is_current: false,
                is_remote: true,
                remote: Some(remote),
                last_commit,
                head_sha: branch.get().target().map(|oid| oid.to_string()),
                ahead: 0,
                behind: 0,
                upstream: None,
            });
        }
        remote_branches.sort_by(|left, right| left.name.cmp(&right.name));

        Ok(json!({
            "branches": branches,
            "localBranches": local_branches,
            "remoteBranches": remote_branches,
            "currentBranch": current_branch
        }))
    }

    pub(crate) async fn checkout_git_branch(
        &self,
        workspace_id: String,
        name: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }
        match git_core::run_git_command(&repo_root, &["checkout", trimmed]).await {
            Ok(_) => Ok(()),
            Err(first_error) => {
                if trimmed.contains('/') {
                    let local = trimmed.split('/').next_back().unwrap_or(trimmed);
                    git_core::run_git_command(
                        &repo_root,
                        &["checkout", "-b", local, "--track", trimmed],
                    )
                    .await
                    .map(|_| ())
                    .map_err(|_| first_error)
                } else {
                    Err(first_error)
                }
            }
        }
    }

    pub(crate) async fn create_git_branch(
        &self,
        workspace_id: String,
        name: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let name = normalize_local_branch_ref(&name);
        if name.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }
        git_core::run_git_command(&repo_root, &["checkout", "-b", &name]).await?;
        Ok(())
    }

    pub(crate) async fn create_git_branch_from_branch(
        &self,
        workspace_id: String,
        name: String,
        source_branch: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let name = normalize_local_branch_ref(&name);
        let source_branch = source_branch.trim().to_string();
        if name.is_empty() || source_branch.is_empty() {
            return Err("Branch name and source branch are required.".to_string());
        }
        git_core::run_git_command(
            &repo_root,
            &["checkout", "-b", &name, source_branch.as_str()],
        )
        .await?;
        Ok(())
    }

    pub(crate) async fn create_git_branch_from_commit(
        &self,
        workspace_id: String,
        name: String,
        commit_hash: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let name = normalize_local_branch_ref(&name);
        let commit_hash = commit_hash.trim().to_string();
        if name.is_empty() || commit_hash.is_empty() {
            return Err("Branch name and commit hash are required.".to_string());
        }
        git_core::run_git_command(&repo_root, &["checkout", "-b", &name, commit_hash.as_str()])
            .await?;
        Ok(())
    }

    pub(crate) async fn delete_git_branch(
        &self,
        workspace_id: String,
        name: String,
        force: Option<bool>,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let name = normalize_local_branch_ref(&name);
        if name.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }
        let flag = if force.unwrap_or(false) { "-D" } else { "-d" };
        git_core::run_git_command(&repo_root, &["branch", flag, &name]).await?;
        Ok(())
    }

    pub(crate) async fn rename_git_branch(
        &self,
        workspace_id: String,
        old_name: String,
        new_name: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let old_name = normalize_local_branch_ref(&old_name);
        let new_name = normalize_local_branch_ref(&new_name);
        if old_name.is_empty() || new_name.is_empty() {
            return Err("Both old and new branch names are required.".to_string());
        }
        git_core::run_git_command(&repo_root, &["branch", "-m", &old_name, &new_name]).await?;
        Ok(())
    }

    pub(crate) async fn merge_git_branch(
        &self,
        workspace_id: String,
        name: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let branch_name = name.trim();
        if branch_name.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }
        git_core::run_git_command(&repo_root, &["merge", branch_name]).await?;
        Ok(())
    }

    pub(crate) async fn rebase_git_branch(
        &self,
        workspace_id: String,
        onto_branch: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let branch_name = onto_branch.trim();
        if branch_name.is_empty() {
            return Err("Target branch cannot be empty.".to_string());
        }
        git_core::run_git_command(&repo_root, &["rebase", branch_name]).await?;
        Ok(())
    }

    pub(crate) async fn get_git_push_preview(
        &self,
        workspace_id: String,
        remote: String,
        branch: String,
        limit: Option<usize>,
    ) -> Result<GitPushPreviewResponse, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let target_remote = remote.trim();
        if target_remote.is_empty() {
            return Err("Remote is required for push preview.".to_string());
        }
        let normalized_target_branch = normalize_remote_target_branch(target_remote, &branch);
        if normalized_target_branch.is_empty() {
            return Err("Target branch is required for push preview.".to_string());
        }
        let repo = open_repository_at_root(&repo_root)?;
        let source_oid = repo
            .head()
            .ok()
            .and_then(|head| head.target())
            .ok_or_else(|| "HEAD does not point to a commit.".to_string())?;
        let source_branch = git_core::run_git_command(&repo_root, &["branch", "--show-current"])
            .await
            .ok()
            .and_then(|value| trim_optional(Some(value)))
            .unwrap_or_else(|| "HEAD".to_string());
        let target_ref = format!("refs/remotes/{target_remote}/{normalized_target_branch}");
        let target_oid = repo.refname_to_id(&target_ref).ok();

        let max_items = limit.unwrap_or(120).clamp(1, 500);
        let mut revwalk = repo.revwalk().map_err(|error| error.to_string())?;
        revwalk
            .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
            .map_err(|error| error.to_string())?;
        revwalk
            .push(source_oid)
            .map_err(|error| error.to_string())?;
        if let Some(oid) = target_oid {
            revwalk.hide(oid).map_err(|error| error.to_string())?;
        }

        let mut commits = Vec::<GitHistoryCommit>::new();
        let mut has_more = false;
        for oid_result in revwalk {
            if commits.len() >= max_items {
                has_more = true;
                break;
            }
            let oid = oid_result.map_err(|error| error.to_string())?;
            let commit = repo.find_commit(oid).map_err(|error| error.to_string())?;
            let sha = commit.id().to_string();
            commits.push(GitHistoryCommit {
                short_sha: sha.chars().take(7).collect(),
                sha,
                summary: commit.summary().unwrap_or("").to_string(),
                message: commit.message().unwrap_or("").to_string(),
                author: commit.author().name().unwrap_or("").to_string(),
                author_email: commit.author().email().unwrap_or("").to_string(),
                timestamp: commit.time().seconds(),
                parents: commit
                    .parents()
                    .map(|parent| parent.id().to_string())
                    .collect(),
                refs: Vec::new(),
            });
        }

        Ok(GitPushPreviewResponse {
            source_branch,
            target_remote: target_remote.to_string(),
            target_branch: normalized_target_branch,
            target_ref,
            target_found: target_oid.is_some(),
            has_more,
            commits,
        })
    }

    pub(crate) async fn get_git_pr_workflow_defaults(
        &self,
        workspace_id: String,
    ) -> Result<GitPrWorkflowDefaults, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo = open_repository_at_root(&repo_root)?;
        let head_branch = git_core::run_git_command(&repo_root, &["branch", "--show-current"])
            .await
            .ok()
            .and_then(|value| trim_optional(Some(value)))
            .unwrap_or_default();
        let origin_repo = git_core::run_git_command(&repo_root, &["remote", "get-url", "origin"])
            .await
            .ok()
            .and_then(|url| crate::git_utils::parse_github_repo(&url));
        let upstream_repo =
            git_core::run_git_command(&repo_root, &["remote", "get-url", "upstream"])
                .await
                .ok()
                .and_then(|url| crate::git_utils::parse_github_repo(&url))
                .or(origin_repo.clone())
                .unwrap_or_default();
        let base_branch = infer_remote_head_branch(&repo, "upstream")
            .or_else(|| infer_remote_head_branch(&repo, "origin"))
            .unwrap_or_else(|| "main".to_string());
        let head_owner = origin_repo
            .as_ref()
            .and_then(|repo_name| parse_repo_owner(repo_name))
            .or_else(|| parse_repo_owner(&upstream_repo))
            .unwrap_or_default();
        let title = repo
            .head()
            .ok()
            .and_then(|head| head.peel_to_commit().ok())
            .and_then(|commit| {
                commit
                    .summary()
                    .map(str::trim)
                    .filter(|summary| !summary.is_empty())
                    .map(ToOwned::to_owned)
            })
            .unwrap_or_else(|| format!("chore(git): create pr for {head_branch}"));
        let body = format!(
            "## Summary\n- Compare `{head_branch}` against `{base_branch}`\n\n## Validation\n- [ ] Local checks passed"
        );
        let comment_body = parse_repo_owner(&upstream_repo)
            .map(|owner| format!("@{owner} 麻烦审批，已完成验证。"))
            .unwrap_or_else(|| "@maintainer 麻烦审批，已完成验证。".to_string());
        let disabled_reason = if head_branch.trim().is_empty() {
            Some("Current branch is unavailable (detached HEAD or no local branch).".to_string())
        } else if upstream_repo.trim().is_empty() {
            Some("No GitHub remote detected. Configure upstream/origin remote first.".to_string())
        } else if head_owner.trim().is_empty() {
            Some("Cannot infer fork owner from origin remote URL.".to_string())
        } else {
            None
        };
        Ok(GitPrWorkflowDefaults {
            upstream_repo,
            base_branch,
            head_owner,
            head_branch,
            title,
            body,
            comment_body,
            can_create: disabled_reason.is_none(),
            disabled_reason,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn create_git_pr_workflow(
        &self,
        workspace_id: String,
        upstream_repo: String,
        base_branch: String,
        head_owner: String,
        head_branch: String,
        title: String,
        body: Option<String>,
        comment_after_create: Option<bool>,
        comment_body: Option<String>,
    ) -> Result<GitPrWorkflowResult, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let upstream_repo = upstream_repo.trim().to_string();
        let base_branch = base_branch.trim().to_string();
        let head_owner = head_owner.trim().to_string();
        let head_branch = head_branch.trim().to_string();
        let title = title.trim().to_string();
        if upstream_repo.is_empty()
            || base_branch.is_empty()
            || head_owner.is_empty()
            || head_branch.is_empty()
            || title.is_empty()
        {
            return Err("Missing required PR workflow fields.".to_string());
        }

        let body_text = trim_optional(body).unwrap_or_else(|| "".to_string());
        let head_ref = format!("{head_owner}:{head_branch}");
        let mut args = vec![
            "pr".to_string(),
            "create".to_string(),
            "--repo".to_string(),
            upstream_repo.clone(),
            "--base".to_string(),
            base_branch.clone(),
            "--head".to_string(),
            head_ref.clone(),
            "--title".to_string(),
            title.clone(),
        ];
        if body_text.is_empty() {
            args.push("--fill".to_string());
        } else {
            args.push("--body".to_string());
            args.push(body_text.clone());
        }
        let output = crate::utils::async_command("gh")
            .args(args.iter().map(String::as_str))
            .current_dir(&repo_root)
            .output()
            .await
            .map_err(|error| format!("Failed to run gh: {error}"))?;

        if !output.status.success() {
            let detail = parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "GitHub CLI command failed.",
            );
            return Ok(GitPrWorkflowResult {
                ok: false,
                status: "failed".to_string(),
                message: detail.clone(),
                error_category: Some("gh_pr_create".to_string()),
                next_action_hint: Some("Check gh auth/repo permissions, then retry.".to_string()),
                pr_url: None,
                pr_number: None,
                existing_pr: None,
                retry_command: Some(format!(
                    "gh pr create --repo {} --base {} --head {} --title {:?}",
                    upstream_repo, base_branch, head_ref, title
                )),
                stages: vec![GitPrWorkflowStage {
                    key: "create-pr".to_string(),
                    status: "failed".to_string(),
                    detail: "Create pull request".to_string(),
                    command: Some("gh pr create".to_string()),
                    stdout: Some(String::from_utf8_lossy(&output.stdout).to_string()),
                    stderr: Some(String::from_utf8_lossy(&output.stderr).to_string()),
                }],
            });
        }

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let mut stages = vec![GitPrWorkflowStage {
            key: "create-pr".to_string(),
            status: "ok".to_string(),
            detail: "Create pull request".to_string(),
            command: Some("gh pr create".to_string()),
            stdout: Some(stdout.clone()),
            stderr: Some(String::from_utf8_lossy(&output.stderr).to_string()),
        }];

        let pr_url = extract_pr_url(&stdout);
        let pr_number = pr_url.as_deref().and_then(extract_pr_number);

        if comment_after_create.unwrap_or(false) {
            if let (Some(number), Some(comment_text)) = (pr_number, trim_optional(comment_body)) {
                let comment_output = crate::utils::async_command("gh")
                    .args([
                        "pr",
                        "comment",
                        &number.to_string(),
                        "--repo",
                        &upstream_repo,
                        "--body",
                        &comment_text,
                    ])
                    .current_dir(&repo_root)
                    .output()
                    .await
                    .map_err(|error| format!("Failed to run gh: {error}"))?;
                let comment_ok = comment_output.status.success();
                stages.push(GitPrWorkflowStage {
                    key: "comment".to_string(),
                    status: if comment_ok {
                        "ok".to_string()
                    } else {
                        "failed".to_string()
                    },
                    detail: "Comment on pull request".to_string(),
                    command: Some("gh pr comment".to_string()),
                    stdout: Some(String::from_utf8_lossy(&comment_output.stdout).to_string()),
                    stderr: Some(String::from_utf8_lossy(&comment_output.stderr).to_string()),
                });
            }
        }

        Ok(GitPrWorkflowResult {
            ok: true,
            status: "ok".to_string(),
            message: "Pull request created.".to_string(),
            error_category: None,
            next_action_hint: None,
            pr_url,
            pr_number,
            existing_pr: None,
            retry_command: None,
            stages,
        })
    }

    pub(crate) async fn get_github_issues(
        &self,
        workspace_id: String,
    ) -> Result<GitHubIssuesResponse, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo_name = git_core::run_git_command(&repo_root, &["remote", "get-url", "origin"])
            .await
            .ok()
            .and_then(|url| crate::git_utils::parse_github_repo(&url))
            .ok_or_else(|| "Unable to resolve GitHub repository from origin remote.".to_string())?;
        let output = crate::utils::async_command("gh")
            .args([
                "issue",
                "list",
                "--repo",
                &repo_name,
                "--limit",
                "50",
                "--json",
                "number,title,url,updatedAt",
            ])
            .current_dir(&repo_root)
            .output()
            .await
            .map_err(|error| format!("Failed to run gh: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "GitHub CLI command failed.",
            ));
        }
        let issues: Vec<GitHubIssue> =
            serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
        Ok(GitHubIssuesResponse {
            total: issues.len(),
            issues,
        })
    }

    pub(crate) async fn get_github_pull_requests(
        &self,
        workspace_id: String,
    ) -> Result<GitHubPullRequestsResponse, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo_name = git_core::run_git_command(&repo_root, &["remote", "get-url", "origin"])
            .await
            .ok()
            .and_then(|url| crate::git_utils::parse_github_repo(&url))
            .ok_or_else(|| "Unable to resolve GitHub repository from origin remote.".to_string())?;
        let output = crate::utils::async_command("gh")
            .args([
                "pr",
                "list",
                "--repo",
                &repo_name,
                "--state",
                "open",
                "--limit",
                "50",
                "--json",
                "number,title,url,updatedAt,createdAt,body,headRefName,baseRefName,isDraft,author",
            ])
            .current_dir(&repo_root)
            .output()
            .await
            .map_err(|error| format!("Failed to run gh: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "GitHub CLI command failed.",
            ));
        }
        let pull_requests: Vec<GitHubPullRequest> =
            serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
        Ok(GitHubPullRequestsResponse {
            total: pull_requests.len(),
            pull_requests,
        })
    }

    pub(crate) async fn get_github_pull_request_diff(
        &self,
        workspace_id: String,
        pr_number: u64,
    ) -> Result<Vec<GitHubPullRequestDiff>, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo_name = git_core::run_git_command(&repo_root, &["remote", "get-url", "origin"])
            .await
            .ok()
            .and_then(|url| crate::git_utils::parse_github_repo(&url))
            .ok_or_else(|| "Unable to resolve GitHub repository from origin remote.".to_string())?;
        let output = crate::utils::async_command("gh")
            .args([
                "pr",
                "diff",
                &pr_number.to_string(),
                "--repo",
                &repo_name,
                "--color",
                "never",
            ])
            .current_dir(&repo_root)
            .output()
            .await
            .map_err(|error| format!("Failed to run gh: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "GitHub CLI command failed.",
            ));
        }
        Ok(parse_pr_diff_text(&String::from_utf8_lossy(&output.stdout)))
    }

    pub(crate) async fn get_github_pull_request_comments(
        &self,
        workspace_id: String,
        pr_number: u64,
    ) -> Result<Vec<GitHubPullRequestComment>, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo_name = git_core::run_git_command(&repo_root, &["remote", "get-url", "origin"])
            .await
            .ok()
            .and_then(|url| crate::git_utils::parse_github_repo(&url))
            .ok_or_else(|| "Unable to resolve GitHub repository from origin remote.".to_string())?;
        let comments_endpoint =
            format!("/repos/{repo_name}/issues/{pr_number}/comments?per_page=30");
        let jq_filter = r#"[.[] | {id, body, createdAt: .created_at, url: .html_url, author: (if .user then {login: .user.login} else null end)}]"#;
        let output = crate::utils::async_command("gh")
            .args(["api", &comments_endpoint, "--jq", jq_filter])
            .current_dir(&repo_root)
            .output()
            .await
            .map_err(|error| format!("Failed to run gh: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "GitHub CLI command failed.",
            ));
        }
        let comments: Vec<GitHubPullRequestComment> =
            serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
        Ok(comments)
    }

    pub(crate) async fn get_git_branch_compare_commits(
        &self,
        workspace_id: String,
        target_branch: String,
        current_branch: String,
        limit: Option<usize>,
    ) -> Result<GitBranchCompareCommitSets, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let target_branch = target_branch.trim().to_string();
        let current_branch = current_branch.trim().to_string();
        if target_branch.is_empty() || current_branch.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }
        if target_branch == current_branch {
            return Ok(GitBranchCompareCommitSets {
                target_only_commits: Vec::new(),
                current_only_commits: Vec::new(),
            });
        }
        let max_items = limit.unwrap_or(200).clamp(1, 500);
        let target_only_raw = git_core::run_git_command(
            &repo_root,
            &[
                "log",
                "--format=%H%x1f%an%x1f%ae%x1f%ct%x1f%s%x1f%B%x1e",
                &format!("{target_branch}"),
                &format!("^{current_branch}"),
                "-n",
                &max_items.to_string(),
            ],
        )
        .await
        .unwrap_or_default();
        let current_only_raw = git_core::run_git_command(
            &repo_root,
            &[
                "log",
                "--format=%H%x1f%an%x1f%ae%x1f%ct%x1f%s%x1f%B%x1e",
                &format!("{current_branch}"),
                &format!("^{target_branch}"),
                "-n",
                &max_items.to_string(),
            ],
        )
        .await
        .unwrap_or_default();

        let parse_commits = |raw: &str| -> Vec<GitHistoryCommit> {
            raw.split('\x1e')
                .filter_map(|record| {
                    let record = record.trim();
                    if record.is_empty() {
                        return None;
                    }
                    let mut parts = record.split('\x1f');
                    let sha = parts.next()?.trim().to_string();
                    let author = parts.next().unwrap_or("").trim().to_string();
                    let author_email = parts.next().unwrap_or("").trim().to_string();
                    let timestamp = parts
                        .next()
                        .and_then(|v| v.trim().parse::<i64>().ok())
                        .unwrap_or(0);
                    let summary = parts.next().unwrap_or("").trim().to_string();
                    let message = parts.next().unwrap_or("").trim().to_string();
                    Some(GitHistoryCommit {
                        short_sha: sha.chars().take(7).collect(),
                        sha,
                        summary,
                        message,
                        author,
                        author_email,
                        timestamp,
                        parents: Vec::new(),
                        refs: Vec::new(),
                    })
                })
                .collect()
        };
        Ok(GitBranchCompareCommitSets {
            target_only_commits: parse_commits(&target_only_raw),
            current_only_commits: parse_commits(&current_only_raw),
        })
    }

    pub(crate) async fn get_git_branch_diff_between_branches(
        &self,
        workspace_id: String,
        from_branch: String,
        to_branch: String,
    ) -> Result<Vec<GitCommitDiff>, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let from_branch = from_branch.trim().to_string();
        let to_branch = to_branch.trim().to_string();
        if from_branch.is_empty() || to_branch.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }
        if from_branch == to_branch {
            return Ok(Vec::new());
        }
        let output = crate::utils::async_command(
            crate::utils::resolve_git_binary()
                .map_err(|error| format!("Failed to run git: {error}"))?,
        )
        .args([
            "diff",
            "--name-status",
            "--find-renames",
            from_branch.as_str(),
            to_branch.as_str(),
        ])
        .current_dir(&repo_root)
        .env("PATH", crate::utils::git_env_path())
        .output()
        .await
        .map_err(|error| format!("Failed to run git: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "Git diff command failed.",
            ));
        }
        let mut results = Vec::<GitCommitDiff>::new();
        for raw_line in String::from_utf8_lossy(&output.stdout).lines() {
            let line = raw_line.trim();
            if line.is_empty() {
                continue;
            }
            let mut parts = line.split('\t');
            let raw_status = parts.next().unwrap_or("").trim();
            if raw_status.is_empty() {
                continue;
            }
            let status = raw_status.chars().next().unwrap_or('M').to_string();
            let path = if raw_status.starts_with('R') || raw_status.starts_with('C') {
                parts.nth(1)
            } else {
                parts.next()
            };
            let Some(path) = path else {
                continue;
            };
            if path.trim().is_empty() {
                continue;
            }
            results.push(GitCommitDiff {
                path: normalize_git_path(path),
                status,
                diff: String::new(),
                is_binary: false,
                is_image: false,
                old_image_data: None,
                new_image_data: None,
                old_image_mime: None,
                new_image_mime: None,
            });
        }
        Ok(results)
    }

    pub(crate) async fn get_git_branch_file_diff_between_branches(
        &self,
        workspace_id: String,
        from_branch: String,
        to_branch: String,
        path: String,
    ) -> Result<GitCommitDiff, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let from_branch = from_branch.trim().to_string();
        let to_branch = to_branch.trim().to_string();
        let normalized_path = normalize_git_path(&path);
        if from_branch.is_empty() || to_branch.is_empty() || normalized_path.trim().is_empty() {
            return Err("Invalid branch or path.".to_string());
        }
        let output = crate::utils::async_command(
            crate::utils::resolve_git_binary()
                .map_err(|error| format!("Failed to run git: {error}"))?,
        )
        .args([
            "diff",
            "--no-color",
            "--find-renames",
            from_branch.as_str(),
            to_branch.as_str(),
            "--",
            normalized_path.as_str(),
        ])
        .current_dir(&repo_root)
        .env("PATH", crate::utils::git_env_path())
        .output()
        .await
        .map_err(|error| format!("Failed to run git: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "Git diff command failed.",
            ));
        }
        let mut entries = parse_patch_diff_entries(&String::from_utf8_lossy(&output.stdout));
        if let Some(entry) = entries.pop() {
            return Ok(entry);
        }
        Ok(GitCommitDiff {
            path: normalized_path,
            status: "M".to_string(),
            diff: String::new(),
            is_binary: false,
            is_image: false,
            old_image_data: None,
            new_image_data: None,
            old_image_mime: None,
            new_image_mime: None,
        })
    }

    pub(crate) async fn get_git_worktree_diff_against_branch(
        &self,
        workspace_id: String,
        branch: String,
    ) -> Result<Vec<GitCommitDiff>, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let branch_name = branch.trim().to_string();
        if branch_name.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }
        let output = crate::utils::async_command(
            crate::utils::resolve_git_binary()
                .map_err(|error| format!("Failed to run git: {error}"))?,
        )
        .args([
            "diff",
            "--name-status",
            "--find-renames",
            branch_name.as_str(),
        ])
        .current_dir(&repo_root)
        .env("PATH", crate::utils::git_env_path())
        .output()
        .await
        .map_err(|error| format!("Failed to run git: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "Git diff command failed.",
            ));
        }
        let mut results = Vec::<GitCommitDiff>::new();
        for raw_line in String::from_utf8_lossy(&output.stdout).lines() {
            let line = raw_line.trim();
            if line.is_empty() {
                continue;
            }
            let mut parts = line.split('\t');
            let raw_status = parts.next().unwrap_or("").trim();
            if raw_status.is_empty() {
                continue;
            }
            let status = raw_status.chars().next().unwrap_or('M').to_string();
            let path = if raw_status.starts_with('R') || raw_status.starts_with('C') {
                parts.nth(1)
            } else {
                parts.next()
            };
            let Some(path) = path else {
                continue;
            };
            if path.trim().is_empty() {
                continue;
            }
            results.push(GitCommitDiff {
                path: normalize_git_path(path),
                status,
                diff: String::new(),
                is_binary: false,
                is_image: false,
                old_image_data: None,
                new_image_data: None,
                old_image_mime: None,
                new_image_mime: None,
            });
        }
        Ok(results)
    }

    pub(crate) async fn get_git_worktree_file_diff_against_branch(
        &self,
        workspace_id: String,
        branch: String,
        path: String,
    ) -> Result<GitCommitDiff, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let branch_name = branch.trim().to_string();
        let normalized_path = normalize_git_path(&path);
        if branch_name.is_empty() || normalized_path.trim().is_empty() {
            return Err("Invalid branch or path.".to_string());
        }
        let output = crate::utils::async_command(
            crate::utils::resolve_git_binary()
                .map_err(|error| format!("Failed to run git: {error}"))?,
        )
        .args([
            "diff",
            "--no-color",
            "--find-renames",
            branch_name.as_str(),
            "--",
            normalized_path.as_str(),
        ])
        .current_dir(&repo_root)
        .env("PATH", crate::utils::git_env_path())
        .output()
        .await
        .map_err(|error| format!("Failed to run git: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "Git diff command failed.",
            ));
        }
        let mut entries = parse_patch_diff_entries(&String::from_utf8_lossy(&output.stdout));
        if let Some(entry) = entries.pop() {
            return Ok(entry);
        }
        Ok(GitCommitDiff {
            path: normalized_path,
            status: "M".to_string(),
            diff: String::new(),
            is_binary: false,
            is_image: false,
            old_image_data: None,
            new_image_data: None,
            old_image_mime: None,
            new_image_mime: None,
        })
    }
}
