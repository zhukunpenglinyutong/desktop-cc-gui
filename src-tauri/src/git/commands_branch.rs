use super::*;

#[tauri::command]
pub(crate) async fn list_git_branches(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(&workspace_id)
        .ok_or("workspace not found")?
        .clone();
    let repo_root = resolve_git_root(&entry)?;
    let repo = open_repository_at_root(&repo_root)?;
    let current_branch = repo
        .head()
        .ok()
        .filter(|head| head.is_branch())
        .and_then(|head| head.shorthand().map(|name| name.to_string()));

    let mut legacy_branches = Vec::new();
    let mut local_branches = Vec::new();
    let refs = repo
        .branches(Some(BranchType::Local))
        .map_err(|e| e.to_string())?;
    for branch_result in refs {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
        let name = branch.name().ok().flatten().unwrap_or("").to_string();
        if name.is_empty() {
            continue;
        }
        let last_commit = branch
            .get()
            .target()
            .and_then(|oid| repo.find_commit(oid).ok())
            .map(|commit| commit.time().seconds())
            .unwrap_or(0);
        let local_oid = branch.get().target();
        let mut ahead = 0usize;
        let mut behind = 0usize;
        let mut upstream: Option<String> = None;
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
        legacy_branches.push(BranchInfo {
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
    legacy_branches.sort_by(|a, b| b.last_commit.cmp(&a.last_commit));
    local_branches.sort_by(|a, b| a.name.cmp(&b.name));

    let mut remote_branches = Vec::new();
    let remote_refs = repo
        .branches(Some(BranchType::Remote))
        .map_err(|e| e.to_string())?;
    for branch_result in remote_refs {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
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
    remote_branches.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(json!({
        "branches": legacy_branches,
        "localBranches": local_branches,
        "remoteBranches": remote_branches,
        "currentBranch": current_branch
    }))
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
        .find_branch(normalized_branch.as_str(), BranchType::Local)
        .map_err(|_| format!("Branch not found: {normalized_branch}"))?;
    let local_oid = branch
        .get()
        .target()
        .ok_or_else(|| format!("Branch '{normalized_branch}' does not point to a commit."))?;
    let current_branch = current_local_branch(repo_root)?;

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
            .and_then(parse_upstream_ref)
            .map(|(remote, _)| remote);
        upstream_oid = upstream_ref.target();
        if let Some(target_oid) = upstream_oid {
            if let Ok((ahead_count, behind_count)) = repo.graph_ahead_behind(local_oid, target_oid) {
                ahead = ahead_count;
                behind = behind_count;
            }
        }
    }

    Ok(LocalBranchUpdateState {
        branch_name: normalized_branch.clone(),
        is_current: current_branch.as_deref() == Some(normalized_branch.as_str()),
        local_oid,
        upstream_name,
        upstream_remote,
        upstream_oid,
        ahead,
        behind,
    })
}

fn normalize_compare_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").to_ascii_lowercase()
}

async fn find_branch_worktree_path(
    repo_root: &Path,
    branch_name: &str,
) -> Result<Option<String>, String> {
    let output = crate::shared::git_core::run_git_command(
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
            return Ok(branch_update_result(
                initial_state.branch_name.as_str(),
                BRANCH_UPDATE_STATUS_BLOCKED,
                Some(BRANCH_UPDATE_REASON_NO_UPSTREAM),
                format!(
                    "Branch '{}' has no upstream tracking branch configured.",
                    initial_state.branch_name
                ),
                None,
            ));
        }
    };
    let upstream_remote = match initial_state.upstream_remote.as_deref() {
        Some(name) if !name.trim().is_empty() => name.to_string(),
        _ => {
            return Ok(branch_update_result(
                initial_state.branch_name.as_str(),
                BRANCH_UPDATE_STATUS_BLOCKED,
                Some(BRANCH_UPDATE_REASON_NO_UPSTREAM),
                format!(
                    "Branch '{}' has no upstream tracking branch configured.",
                    initial_state.branch_name
                ),
                None,
            ));
        }
    };

    run_git_command(repo_root, &["fetch", upstream_remote.as_str()]).await?;

    if let Some(worktree_path) = find_branch_worktree_path(repo_root, initial_state.branch_name.as_str()).await? {
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

    let refreshed_state = load_local_branch_update_state(repo_root, initial_state.branch_name.as_str())?;
    let upstream_oid = match refreshed_state.upstream_oid {
        Some(oid) => oid,
        None => {
            return Ok(branch_update_result(
                refreshed_state.branch_name.as_str(),
                BRANCH_UPDATE_STATUS_BLOCKED,
                Some(BRANCH_UPDATE_REASON_NO_UPSTREAM),
                format!(
                    "Branch '{}' has no upstream tracking branch configured.",
                    refreshed_state.branch_name
                ),
                None,
            ));
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
    if let Err(error) = run_git_command(repo_root, &arg_refs).await {
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

    let verified_state = load_local_branch_update_state(repo_root, refreshed_state.branch_name.as_str())?;
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

#[tauri::command]
pub(crate) async fn update_git_branch(
    workspace_id: String,
    branch_name: String,
    state: State<'_, AppState>,
) -> Result<GitBranchUpdateResult, String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(&workspace_id)
        .ok_or("workspace not found")?
        .clone();
    drop(workspaces);

    let repo_root = resolve_git_root(&entry)?;
    let normalized_branch = normalize_local_branch_ref(&branch_name);
    if normalized_branch.is_empty() {
        return Err("Branch name cannot be empty.".to_string());
    }

    let branch_state = load_local_branch_update_state(&repo_root, normalized_branch.as_str())?;
    if branch_state.is_current {
        pull_git(
            workspace_id,
            None,
            None,
            None,
            None,
            None,
            state,
        )
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

fn has_uncommitted_changes(repo: &Repository) -> Result<bool, String> {
    let mut status_options = StatusOptions::new();
    status_options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);
    let statuses = repo
        .statuses(Some(&mut status_options))
        .map_err(|e| e.to_string())?;
    Ok(!statuses.is_empty())
}

fn ensure_checkout_precondition_clean(repo: &Repository) -> Result<(), String> {
    if has_uncommitted_changes(repo)? {
        return Err(
            "Working tree has uncommitted changes. Commit/stash/discard changes first.".to_string(),
        );
    }
    Ok(())
}

fn verify_checkout_postcondition(repo_root: &Path, expected_branch: &str) -> Result<(), String> {
    let expected_local_branch = normalize_local_branch_ref(expected_branch);
    let current_branch = current_local_branch(repo_root)?;
    let current_branch = current_branch.ok_or_else(|| {
        format!(
            "Checkout verification failed: expected current branch '{expected_local_branch}', but HEAD is detached."
        )
    })?;
    if current_branch != expected_local_branch {
        return Err(format!(
            "Checkout verification failed: expected current branch '{expected_local_branch}', but found '{current_branch}'."
        ));
    }

    let repo = open_repository_at_root(repo_root)?;
    if has_uncommitted_changes(&repo)? {
        return Err(
            "Working tree has uncommitted changes after checkout. Commit/stash/discard changes first."
                .to_string(),
        );
    }

    Ok(())
}

async fn checkout_existing_local_branch(repo_root: &Path, branch_name: &str) -> Result<(), String> {
    run_git_command(repo_root, &["checkout", branch_name]).await?;
    verify_checkout_postcondition(repo_root, branch_name)
}

async fn checkout_remote_branch_with_tracking(
    repo_root: &Path,
    remote_branch: &str,
    local_branch: &str,
) -> Result<(), String> {
    run_git_command(
        repo_root,
        &["checkout", "-b", local_branch, "--track", remote_branch],
    )
    .await?;
    verify_checkout_postcondition(repo_root, local_branch)
}

#[tauri::command]
pub(crate) async fn checkout_git_branch(
    workspace_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(&workspace_id)
        .ok_or("workspace not found")?
        .clone();
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Branch name cannot be empty.".to_string());
    }

    enum CheckoutTarget {
        ExistingLocal(String),
        CreateTrackingLocal {
            remote_branch: String,
            local_branch: String,
        },
        Missing,
    }

    let repo_root = resolve_git_root(&entry)?;
    let normalized_local_name = normalize_local_branch_ref(trimmed_name);
    let checkout_target = {
        let repo = open_repository_at_root(&repo_root)?;
        ensure_checkout_precondition_clean(&repo)?;

        if !normalized_local_name.is_empty()
            && repo
                .find_branch(normalized_local_name.as_str(), BranchType::Local)
                .is_ok()
        {
            CheckoutTarget::ExistingLocal(normalized_local_name)
        } else {
            let remote_ref = if trimmed_name.starts_with("refs/remotes/") {
                trimmed_name.to_string()
            } else {
                format!("refs/remotes/{trimmed_name}")
            };
            if repo.refname_to_id(&remote_ref).is_ok() {
                let local_name = trimmed_name.split('/').next_back().unwrap_or(trimmed_name);
                let valid_local_name = validate_local_branch_name(local_name)?;
                CheckoutTarget::CreateTrackingLocal {
                    remote_branch: trimmed_name.to_string(),
                    local_branch: valid_local_name,
                }
            } else {
                CheckoutTarget::Missing
            }
        }
    };

    match checkout_target {
        CheckoutTarget::ExistingLocal(local_branch) => {
            checkout_existing_local_branch(&repo_root, local_branch.as_str()).await
        }
        CheckoutTarget::CreateTrackingLocal {
            remote_branch,
            local_branch,
        } => {
            checkout_remote_branch_with_tracking(
                &repo_root,
                remote_branch.as_str(),
                local_branch.as_str(),
            )
            .await
        }
        CheckoutTarget::Missing => Err(format!("Branch not found: {trimmed_name}")),
    }
}

#[tauri::command]
pub(crate) async fn create_git_branch(
    workspace_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(&workspace_id)
        .ok_or("workspace not found")?
        .clone();
    let repo_root = resolve_git_root(&entry)?;
    let repo = open_repository_at_root(&repo_root)?;
    let valid_name = validate_local_branch_name(&name)?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let target = head.peel_to_commit().map_err(|e| e.to_string())?;
    repo.branch(&valid_name, &target, false)
        .map_err(|e| e.to_string())?;
    checkout_branch(&repo, &valid_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn create_git_branch_from_branch(
    workspace_id: String,
    name: String,
    source_branch: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(&workspace_id)
        .ok_or("workspace not found")?
        .clone();
    let repo_root = resolve_git_root(&entry)?;
    let repo = open_repository_at_root(&repo_root)?;
    let valid_name = validate_local_branch_name(&name)?;
    let source_name = source_branch.trim();
    if source_name.is_empty() {
        return Err("Source branch cannot be empty.".to_string());
    }

    let source_ref_candidates = if source_name.starts_with("refs/") {
        vec![source_name.to_string()]
    } else {
        vec![
            format!("refs/heads/{source_name}"),
            format!("refs/remotes/{source_name}"),
        ]
    };

    let mut target_commit = None;
    for source_ref in source_ref_candidates {
        if let Ok(reference) = repo.find_reference(&source_ref) {
            target_commit = Some(reference.peel_to_commit().map_err(|e| e.to_string())?);
            break;
        }
    }
    let target_commit =
        target_commit.ok_or_else(|| format!("Source branch not found: {source_name}"))?;

    repo.branch(&valid_name, &target_commit, false)
        .map_err(|e| e.to_string())?;
    checkout_branch(&repo, &valid_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn create_git_branch_from_commit(
    workspace_id: String,
    name: String,
    commit_hash: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(&workspace_id)
        .ok_or("workspace not found")?
        .clone();
    let repo_root = resolve_git_root(&entry)?;
    let repo = open_repository_at_root(&repo_root)?;
    let valid_name = validate_local_branch_name(&name)?;
    let oid = Oid::from_str(commit_hash.trim()).map_err(|e| e.to_string())?;
    let target = repo.find_commit(oid).map_err(|e| e.to_string())?;
    repo.branch(&valid_name, &target, false)
        .map_err(|e| e.to_string())?;
    checkout_branch(&repo, &valid_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn delete_git_branch(
    workspace_id: String,
    name: String,
    force: Option<bool>,
    remove_occupied_worktree: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(&workspace_id)
        .ok_or("workspace not found")?
        .clone();
    let repo_root = resolve_git_root(&entry)?;
    let branch_name = name.trim();
    if branch_name.is_empty() {
        return Err("Branch name cannot be empty.".to_string());
    }
    let force_delete = force.unwrap_or(false);
    let remove_worktree_on_force = remove_occupied_worktree.unwrap_or(false);
    let flag = if force_delete { "-D" } else { "-d" };
    match run_git_command(&repo_root, &["branch", flag, branch_name]).await {
        Ok(()) => Ok(()),
        Err(delete_error) => {
            if !is_branch_used_by_worktree_error(&delete_error) {
                return Err(delete_error);
            }
            // Try once to clean stale worktree metadata, then retry delete.
            let _ = run_git_command(&repo_root, &["worktree", "prune"]).await;
            match run_git_command(&repo_root, &["branch", flag, branch_name]).await {
                Ok(()) => Ok(()),
                Err(retry_error) => {
                    if force_delete && remove_worktree_on_force {
                        if let Some(occupied_path) =
                            extract_worktree_path_from_delete_error(&retry_error)
                        {
                            let _ = run_git_command(
                                &repo_root,
                                &["worktree", "remove", "--force", occupied_path.as_str()],
                            )
                            .await;
                            if run_git_command(&repo_root, &["branch", flag, branch_name])
                                .await
                                .is_ok()
                            {
                                return Ok(());
                            }
                        }
                    }
                    if is_branch_used_by_worktree_error(&retry_error) {
                        Err(build_delete_branch_worktree_error(
                            branch_name,
                            &retry_error,
                        ))
                    } else {
                        Err(retry_error)
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn rename_git_branch(
    workspace_id: String,
    old_name: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(&workspace_id)
        .ok_or("workspace not found")?
        .clone();
    let repo_root = resolve_git_root(&entry)?;
    let old_name = old_name.trim();
    let new_name = validate_local_branch_name(&new_name)?;
    if old_name.is_empty() {
        return Err("Old branch name cannot be empty.".to_string());
    }
    run_git_command(&repo_root, &["branch", "-m", old_name, &new_name]).await
}

#[tauri::command]
pub(crate) async fn merge_git_branch(
    workspace_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(&workspace_id)
        .ok_or("workspace not found")?
        .clone();
    let repo_root = resolve_git_root(&entry)?;
    let branch_name = name.trim();
    if branch_name.is_empty() {
        return Err("Branch name cannot be empty.".to_string());
    }
    run_git_command(&repo_root, &["merge", branch_name]).await
}

#[tauri::command]
pub(crate) async fn rebase_git_branch(
    workspace_id: String,
    onto_branch: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(&workspace_id)
        .ok_or("workspace not found")?
        .clone();
    let repo_root = resolve_git_root(&entry)?;
    let onto_branch_name = onto_branch.trim();
    if onto_branch_name.is_empty() {
        return Err("Branch name cannot be empty.".to_string());
    }
    run_git_command(&repo_root, &["rebase", onto_branch_name]).await
}

#[tauri::command]
pub(crate) async fn get_git_branch_compare_commits(
    workspace_id: String,
    target_branch: String,
    current_branch: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<GitBranchCompareCommitSets, String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(&workspace_id)
        .ok_or("workspace not found")?
        .clone();
    drop(workspaces);

    let repo_root = resolve_git_root(&entry)?;
    let target_branch_name = target_branch.trim().to_string();
    if target_branch_name.is_empty() {
        return Err("Target branch name cannot be empty.".to_string());
    }
    let current_branch_name = current_branch.trim().to_string();
    if current_branch_name.is_empty() {
        return Err("Current branch name cannot be empty.".to_string());
    }
    if target_branch_name == current_branch_name {
        return Ok(GitBranchCompareCommitSets {
            target_only_commits: Vec::new(),
            current_only_commits: Vec::new(),
        });
    }
    let max_items = limit.unwrap_or(200).clamp(1, 500);

    tokio::task::spawn_blocking(move || -> Result<GitBranchCompareCommitSets, String> {
        let repo = open_repository_at_root(&repo_root)?;
        let refs_map = collect_commit_refs_map(&repo);
        let target_only_commits = collect_unique_commits(
            &repo,
            target_branch_name.as_str(),
            current_branch_name.as_str(),
            &refs_map,
            max_items,
        )?;
        let current_only_commits = collect_unique_commits(
            &repo,
            current_branch_name.as_str(),
            target_branch_name.as_str(),
            &refs_map,
            max_items,
        )?;
        Ok(GitBranchCompareCommitSets {
            target_only_commits,
            current_only_commits,
        })
    })
    .await
    .map_err(|error| format!("Failed to collect branch compare commits: {error}"))?
}

#[tauri::command]
pub(crate) async fn get_git_branch_diff_between_branches(
    workspace_id: String,
    from_branch: String,
    to_branch: String,
    state: State<'_, AppState>,
) -> Result<Vec<GitCommitDiff>, String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(&workspace_id)
        .ok_or("workspace not found")?
        .clone();
    drop(workspaces);

    let repo_root = resolve_git_root(&entry)?;
    let from_branch_name = from_branch.trim().to_string();
    if from_branch_name.is_empty() {
        return Err("From branch name cannot be empty.".to_string());
    }
    let to_branch_name = to_branch.trim().to_string();
    if to_branch_name.is_empty() {
        return Err("To branch name cannot be empty.".to_string());
    }
    if from_branch_name == to_branch_name {
        return Ok(Vec::new());
    }

    let git_bin = resolve_git_binary().map_err(|e| format!("Failed to run git: {e}"))?;
    let output = crate::utils::async_command(git_bin)
        .args([
            "diff",
            "--name-status",
            "--find-renames",
            from_branch_name.as_str(),
            to_branch_name.as_str(),
        ])
        .current_dir(&repo_root)
        .env("PATH", git_env_path())
        .output()
        .await
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        if detail.is_empty() {
            return Err("Git diff command failed.".to_string());
        }
        return Err(detail.to_string());
    }

    let mut results = Vec::new();
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

#[tauri::command]
pub(crate) async fn get_git_branch_file_diff_between_branches(
    workspace_id: String,
    from_branch: String,
    to_branch: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<GitCommitDiff, String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(&workspace_id)
        .ok_or("workspace not found")?
        .clone();
    drop(workspaces);

    let repo_root = resolve_git_root(&entry)?;
    let from_branch_name = from_branch.trim().to_string();
    if from_branch_name.is_empty() {
        return Err("From branch name cannot be empty.".to_string());
    }
    let to_branch_name = to_branch.trim().to_string();
    if to_branch_name.is_empty() {
        return Err("To branch name cannot be empty.".to_string());
    }
    let normalized_path = normalize_git_path(&path);
    if normalized_path.trim().is_empty() {
        return Err("Path cannot be empty.".to_string());
    }

    let git_bin = resolve_git_binary().map_err(|e| format!("Failed to run git: {e}"))?;
    let output = crate::utils::async_command(git_bin)
        .args([
            "diff",
            "--no-color",
            "--find-renames",
            from_branch_name.as_str(),
            to_branch_name.as_str(),
            "--",
            normalized_path.as_str(),
        ])
        .current_dir(&repo_root)
        .env("PATH", git_env_path())
        .output()
        .await
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        if detail.is_empty() {
            return Err("Git diff command failed.".to_string());
        }
        return Err(detail.to_string());
    }

    let diff_text = String::from_utf8_lossy(&output.stdout);
    let mut entries = parse_patch_diff_entries(&diff_text);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use crate::types::{AppSettings, WorkspaceEntry, WorkspaceKind, WorkspaceSettings};

    fn create_temp_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("mossx-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn run_git_sync(current_dir: &Path, args: &[&str]) -> String {
        let git_bin = resolve_git_binary().expect("resolve git binary");
        let output = Command::new(git_bin)
            .args(args)
            .current_dir(current_dir)
            .env("PATH", git_env_path())
            .output()
            .expect("run git command");
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            panic!(
                "git {:?} failed: {}",
                args,
                if stderr.trim().is_empty() {
                    stdout.trim().to_string()
                } else {
                    stderr.trim().to_string()
                }
            );
        }
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn write_file(repo_root: &Path, relative_path: &str, content: &str) {
        let path = repo_root.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, content).expect("write file");
    }

    fn git_commit(repo_root: &Path, message: &str) {
        run_git_sync(repo_root, &["add", "-A"]);
        run_git_sync(
            repo_root,
            &[
                "-c",
                "user.name=Test User",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                message,
            ],
        );
    }

    fn checkout_tracked(repo_root: &Path, branch_name: &str) {
        run_git_sync(
            repo_root,
            &["checkout", "--track", &format!("origin/{branch_name}")],
        );
    }

    fn rev_parse(repo_root: &Path, git_ref: &str) -> String {
        run_git_sync(repo_root, &["rev-parse", git_ref])
    }

    fn test_workspace_entry(id: &str, repo_root: &Path) -> WorkspaceEntry {
        WorkspaceEntry {
            id: id.to_string(),
            name: id.to_string(),
            path: repo_root.to_string_lossy().to_string(),
            codex_bin: None,
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    fn build_test_app_state(id: &str, repo_root: &Path) -> crate::state::AppState {
        let data_dir = create_temp_dir("branch-update-app-state");
        let mut workspaces = std::collections::HashMap::new();
        workspaces.insert(id.to_string(), test_workspace_entry(id, repo_root));
        crate::state::AppState {
            workspaces: tokio::sync::Mutex::new(workspaces),
            sessions: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            terminal_sessions: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            runtime_log_sessions: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            remote_backend: tokio::sync::Mutex::new(None),
            storage_path: data_dir.join("workspaces.json"),
            settings_path: data_dir.join("settings.json"),
            app_settings: tokio::sync::Mutex::new(AppSettings::default()),
            codex_runtime_reload_lock: tokio::sync::Mutex::new(()),
            computer_use_activation_lock: tokio::sync::Mutex::new(()),
            computer_use_activation_verification: tokio::sync::Mutex::new(None),
            dictation: tokio::sync::Mutex::new(crate::dictation::DictationState::default()),
            codex_login_cancels: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            detached_external_change_runtime: tokio::sync::Mutex::new(
                crate::workspaces::DetachedExternalChangeRuntime::default(),
            ),
            runtime_manager: std::sync::Arc::new(crate::runtime::RuntimeManager::new(&data_dir)),
            engine_manager: crate::engine::EngineManager::new(),
        }
    }

    fn tauri_state<'a>(state: &'a crate::state::AppState) -> tauri::State<'a, crate::state::AppState> {
        // SAFETY: `tauri::State<'a, T>` in Tauri 2.x is a single-field newtype over `&'a T`.
        // This test-only helper constructs that wrapper without a full Tauri runtime.
        unsafe { std::mem::transmute::<&'a crate::state::AppState, tauri::State<'a, crate::state::AppState>>(state) }
    }

    fn setup_tracked_branch_fixture_with(
        label: &str,
        branch_name: &str,
    ) -> (PathBuf, PathBuf) {
        let base_dir = create_temp_dir(label);
        let remote_root = base_dir.join("remote.git");
        let local_root = base_dir.join("local");
        let writer_root = base_dir.join("writer");

        run_git_sync(
            base_dir.as_path(),
            &["init", "--bare", remote_root.to_string_lossy().as_ref()],
        );
        run_git_sync(
            base_dir.as_path(),
            &[
                "clone",
                remote_root.to_string_lossy().as_ref(),
                local_root.to_string_lossy().as_ref(),
            ],
        );

        run_git_sync(local_root.as_path(), &["checkout", "-b", "main"]);
        write_file(local_root.as_path(), "README.md", "base\n");
        git_commit(local_root.as_path(), "init main");
        run_git_sync(local_root.as_path(), &["push", "-u", "origin", "main"]);

        run_git_sync(local_root.as_path(), &["checkout", "-b", branch_name]);
        write_file(local_root.as_path(), "feature.txt", "feature base\n");
        git_commit(local_root.as_path(), "init feature");
        run_git_sync(
            local_root.as_path(),
            &["push", "-u", "origin", branch_name],
        );
        run_git_sync(local_root.as_path(), &["checkout", "main"]);

        run_git_sync(
            base_dir.as_path(),
            &[
                "clone",
                remote_root.to_string_lossy().as_ref(),
                writer_root.to_string_lossy().as_ref(),
            ],
        );
        checkout_tracked(writer_root.as_path(), branch_name);

        (local_root, writer_root)
    }

    fn setup_tracked_branch_fixture() -> (PathBuf, PathBuf) {
        setup_tracked_branch_fixture_with("branch-update-fixture", "feature/update-target")
    }

    #[tokio::test]
    async fn update_non_current_local_branch_fast_forwards_without_switching_head() {
        let (local_root, writer_root) = setup_tracked_branch_fixture();
        write_file(writer_root.as_path(), "feature.txt", "feature remote advance\n");
        git_commit(writer_root.as_path(), "advance remote feature");
        run_git_sync(writer_root.as_path(), &["push", "origin", "feature/update-target"]);

        let before_state =
            load_local_branch_update_state(local_root.as_path(), "feature/update-target")
                .expect("load local branch state");
        let result = update_non_current_local_branch(local_root.as_path(), "feature/update-target")
            .await
            .expect("update branch");

        assert_eq!(result.status, BRANCH_UPDATE_STATUS_SUCCESS);
        assert_eq!(
            current_local_branch(local_root.as_path()).expect("current branch"),
            Some("main".to_string())
        );
        let after_state =
            load_local_branch_update_state(local_root.as_path(), "feature/update-target")
                .expect("reload local branch state");
        assert_ne!(before_state.local_oid, after_state.local_oid);
        assert_eq!(after_state.behind, 0);
    }

    #[tokio::test]
    async fn update_non_current_local_branch_blocks_diverged_branch() {
        let (local_root, writer_root) = setup_tracked_branch_fixture();
        write_file(writer_root.as_path(), "feature.txt", "feature remote advance\n");
        git_commit(writer_root.as_path(), "advance remote feature");
        run_git_sync(writer_root.as_path(), &["push", "origin", "feature/update-target"]);

        run_git_sync(local_root.as_path(), &["checkout", "feature/update-target"]);
        write_file(local_root.as_path(), "local-only.txt", "local change\n");
        git_commit(local_root.as_path(), "local divergence");
        run_git_sync(local_root.as_path(), &["checkout", "main"]);

        let result = update_non_current_local_branch(local_root.as_path(), "feature/update-target")
            .await
            .expect("update branch");

        assert_eq!(result.status, BRANCH_UPDATE_STATUS_BLOCKED);
        assert_eq!(result.reason.as_deref(), Some(BRANCH_UPDATE_REASON_DIVERGED));
    }

    #[tokio::test]
    async fn update_non_current_local_branch_blocks_occupied_worktree() {
        let (local_root, _writer_root) = setup_tracked_branch_fixture();
        let occupied_root = local_root
            .parent()
            .expect("fixture parent")
            .join("occupied-worktree");
        run_git_sync(
            local_root.as_path(),
            &[
                "worktree",
                "add",
                occupied_root.to_string_lossy().as_ref(),
                "feature/update-target",
            ],
        );

        let result = update_non_current_local_branch(local_root.as_path(), "feature/update-target")
            .await
            .expect("update branch");

        assert_eq!(result.status, BRANCH_UPDATE_STATUS_BLOCKED);
        assert_eq!(
            result.reason.as_deref(),
            Some(BRANCH_UPDATE_REASON_OCCUPIED_WORKTREE)
        );
        let actual_path = result.worktree_path.as_deref().unwrap_or("");
        assert!(actual_path.ends_with("/occupied-worktree"));
    }

    #[tokio::test]
    async fn update_non_current_local_branch_returns_ahead_only_no_op() {
        let (local_root, _writer_root) = setup_tracked_branch_fixture();
        run_git_sync(local_root.as_path(), &["checkout", "feature/update-target"]);
        write_file(local_root.as_path(), "ahead-only.txt", "ahead only\n");
        git_commit(local_root.as_path(), "ahead only");
        run_git_sync(local_root.as_path(), &["checkout", "main"]);

        let result = update_non_current_local_branch(local_root.as_path(), "feature/update-target")
            .await
            .expect("update branch");

        assert_eq!(result.status, BRANCH_UPDATE_STATUS_NO_OP);
        assert_eq!(result.reason.as_deref(), Some(BRANCH_UPDATE_REASON_AHEAD_ONLY));
    }

    #[tokio::test]
    async fn update_non_current_local_branch_returns_already_up_to_date_no_op() {
        let (local_root, _writer_root) = setup_tracked_branch_fixture();

        let result = update_non_current_local_branch(local_root.as_path(), "feature/update-target")
            .await
            .expect("update branch");

        assert_eq!(result.status, BRANCH_UPDATE_STATUS_NO_OP);
        assert_eq!(
            result.reason.as_deref(),
            Some(BRANCH_UPDATE_REASON_ALREADY_UP_TO_DATE)
        );
    }

    #[tokio::test]
    async fn update_git_branch_updates_current_branch_via_pull_path() {
        let (local_root, writer_root) = setup_tracked_branch_fixture();
        run_git_sync(writer_root.as_path(), &["checkout", "main"]);
        write_file(writer_root.as_path(), "README.md", "main remote advance\n");
        git_commit(writer_root.as_path(), "advance remote main");
        run_git_sync(writer_root.as_path(), &["push", "origin", "main"]);

        let before_local_main = rev_parse(local_root.as_path(), "refs/heads/main");
        let expected_remote_main = rev_parse(writer_root.as_path(), "refs/heads/main");
        let app_state = build_test_app_state("ws-current-branch", local_root.as_path());

        let result = update_git_branch(
            "ws-current-branch".to_string(),
            "main".to_string(),
            tauri_state(&app_state),
        )
        .await
        .expect("update current branch");

        let after_local_main = rev_parse(local_root.as_path(), "refs/heads/main");
        assert_eq!(result.status, BRANCH_UPDATE_STATUS_SUCCESS);
        assert_eq!(before_local_main == after_local_main, false);
        assert_eq!(after_local_main, expected_remote_main);
        assert_eq!(
            current_local_branch(local_root.as_path()).expect("current branch"),
            Some("main".to_string())
        );
    }

    #[tokio::test]
    async fn update_non_current_local_branch_supports_space_paths_and_nested_branch_names() {
        let branch_name = "feature/nested-target";
        let (local_root, writer_root) = setup_tracked_branch_fixture_with(
            "branch update fixture with spaces",
            branch_name,
        );
        write_file(writer_root.as_path(), "feature.txt", "feature remote advance\n");
        git_commit(writer_root.as_path(), "advance nested remote feature");
        run_git_sync(writer_root.as_path(), &["push", "origin", branch_name]);

        let result = update_non_current_local_branch(local_root.as_path(), branch_name)
            .await
            .expect("update nested branch");

        assert_eq!(result.status, BRANCH_UPDATE_STATUS_SUCCESS);
        assert_eq!(
            current_local_branch(local_root.as_path()).expect("current branch"),
            Some("main".to_string())
        );
        assert_eq!(
            rev_parse(local_root.as_path(), &format!("refs/heads/{branch_name}")),
            rev_parse(local_root.as_path(), &format!("refs/remotes/origin/{branch_name}"))
        );
    }

    #[test]
    fn stale_update_ref_error_detection_matches_git_output() {
        let raw = "fatal: cannot lock ref 'refs/heads/feature/update-target': is at abcdef but expected 123456";
        assert!(is_stale_update_ref_error(raw, "feature/update-target"));
        assert!(!is_stale_update_ref_error(raw, "other-branch"));
    }
}

#[tauri::command]
pub(crate) async fn get_git_worktree_diff_against_branch(
    workspace_id: String,
    branch: String,
    state: State<'_, AppState>,
) -> Result<Vec<GitCommitDiff>, String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(&workspace_id)
        .ok_or("workspace not found")?
        .clone();
    drop(workspaces);

    let repo_root = resolve_git_root(&entry)?;
    let branch_name = branch.trim().to_string();
    if branch_name.is_empty() {
        return Err("Branch name cannot be empty.".to_string());
    }

    let git_bin = resolve_git_binary().map_err(|e| format!("Failed to run git: {e}"))?;
    let output = crate::utils::async_command(git_bin)
        .args([
            "diff",
            "--name-status",
            "--find-renames",
            branch_name.as_str(),
        ])
        .current_dir(&repo_root)
        .env("PATH", git_env_path())
        .output()
        .await
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        if detail.is_empty() {
            return Err("Git diff command failed.".to_string());
        }
        return Err(detail.to_string());
    }

    let mut results = Vec::new();
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

#[tauri::command]
pub(crate) async fn get_git_worktree_file_diff_against_branch(
    workspace_id: String,
    branch: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<GitCommitDiff, String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(&workspace_id)
        .ok_or("workspace not found")?
        .clone();
    drop(workspaces);

    let repo_root = resolve_git_root(&entry)?;
    let branch_name = branch.trim().to_string();
    if branch_name.is_empty() {
        return Err("Branch name cannot be empty.".to_string());
    }
    let normalized_path = normalize_git_path(&path);
    if normalized_path.trim().is_empty() {
        return Err("Path cannot be empty.".to_string());
    }

    let git_bin = resolve_git_binary().map_err(|e| format!("Failed to run git: {e}"))?;
    let output = crate::utils::async_command(git_bin)
        .args([
            "diff",
            "--no-color",
            "--find-renames",
            branch_name.as_str(),
            "--",
            normalized_path.as_str(),
        ])
        .current_dir(&repo_root)
        .env("PATH", git_env_path())
        .output()
        .await
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        if detail.is_empty() {
            return Err("Git diff command failed.".to_string());
        }
        return Err(detail.to_string());
    }

    let diff_text = String::from_utf8_lossy(&output.stdout);
    let mut entries = parse_patch_diff_entries(&diff_text);
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
