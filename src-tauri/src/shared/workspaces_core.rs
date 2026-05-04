use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::Mutex;
use tokio::time::Duration;

use crate::backend::app_server::WorkspaceSession;
use crate::codex::args::resolve_workspace_codex_args;
use crate::codex::home::resolve_workspace_codex_home;
use crate::runtime::RuntimeAcquireDisposition;
use crate::shared::workspace_snapshot::resolve_workspace_and_parent;
use crate::storage::{write_workspaces, write_workspaces_preserving_existing};
use crate::types::{
    AppSettings, WorkspaceEntry, WorkspaceInfo, WorkspaceKind, WorkspaceSettings, WorktreeInfo,
    WorktreeSetupStatus,
};
use uuid::Uuid;

pub(crate) const WORKTREE_SETUP_MARKERS_DIR: &str = "worktree-setup";
pub(crate) const WORKTREE_SETUP_MARKER_EXT: &str = "ran";
const WORKTREE_VALIDATION_ERROR_PREFIX: &str = "VALIDATION_ERROR";
const LEGACY_BRAND_WORKSPACE_NAMES: &[&str] = &["codemoss", "ccgui"];
const CURRENT_BRAND_WORKSPACE_NAME: &str = "ccgui";
const SESSION_HEALTH_PROBE_TIMEOUT_SECS: u64 = 3;

pub(crate) fn normalize_setup_script(script: Option<String>) -> Option<String> {
    match script {
        Some(value) if value.trim().is_empty() => None,
        Some(value) => Some(value),
        None => None,
    }
}

pub(crate) fn worktree_setup_marker_path(data_dir: &PathBuf, workspace_id: &str) -> PathBuf {
    data_dir
        .join(WORKTREE_SETUP_MARKERS_DIR)
        .join(format!("{workspace_id}.{WORKTREE_SETUP_MARKER_EXT}"))
}

pub(crate) fn is_workspace_path_dir_core(path: &str) -> bool {
    PathBuf::from(path).is_dir()
}

pub(crate) fn normalize_workspace_display_name(name: &str, path: &str) -> String {
    let path_name = Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if LEGACY_BRAND_WORKSPACE_NAMES
        .iter()
        .any(|legacy| name.eq_ignore_ascii_case(legacy) || path_name.eq_ignore_ascii_case(legacy))
    {
        return CURRENT_BRAND_WORKSPACE_NAME.to_string();
    }
    name.to_string()
}

pub(crate) fn workspace_name_from_path(path: &str) -> String {
    let derived = Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Workspace");
    normalize_workspace_display_name(derived, path)
}

pub(crate) fn ensure_workspace_path_dir_core(path: &str) -> Result<(), String> {
    let target = PathBuf::from(path);
    if target.is_dir() {
        return Ok(());
    }
    if target.exists() {
        return Err("Workspace path exists but is not a folder.".to_string());
    }
    std::fs::create_dir_all(&target)
        .map_err(|err| format!("Failed to create workspace folder: {err}"))?;
    Ok(())
}

pub(crate) async fn list_workspaces_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
) -> Vec<WorkspaceInfo> {
    let workspaces = workspaces.lock().await;
    let sessions = sessions.lock().await;
    let mut result = Vec::new();
    for entry in workspaces.values() {
        // Engines using local CLI sessions (Claude/Gemini/OpenCode) are always connected.
        // Codex requires a persistent app-server process tracked in sessions.
        let connected = if workspace_requires_persistent_session(entry) {
            sessions.contains_key(&entry.id)
        } else {
            true
        };
        let name = normalize_workspace_display_name(&entry.name, &entry.path);

        result.push(WorkspaceInfo {
            id: entry.id.clone(),
            name,
            path: entry.path.clone(),
            codex_bin: entry.codex_bin.clone(),
            connected,
            kind: entry.kind.clone(),
            parent_id: entry.parent_id.clone(),
            worktree: entry.worktree.clone(),
            settings: entry.settings.clone(),
        });
    }
    sort_workspaces(&mut result);
    result
}

pub(crate) fn workspace_requires_persistent_session(entry: &WorkspaceEntry) -> bool {
    entry
        .settings
        .engine_type
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("codex"))
        .unwrap_or(false)
}

pub(crate) async fn restart_all_connected_sessions_core<F, Fut>(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    app_settings: &Mutex<AppSettings>,
    runtime_manager: Option<&Arc<crate::runtime::RuntimeManager>>,
    spawn_session: F,
) -> Result<(), String>
where
    F: Fn(WorkspaceEntry, Option<String>, Option<String>, Option<PathBuf>) -> Fut + Copy,
    Fut: Future<Output = Result<Arc<WorkspaceSession>, String>>,
{
    let entries = {
        let workspaces = workspaces.lock().await;
        let sessions = sessions.lock().await;
        workspaces
            .values()
            .filter(|entry| sessions.contains_key(&entry.id))
            .cloned()
            .collect::<Vec<_>>()
    };
    if entries.is_empty() {
        return Ok(());
    }

    let app_settings_snapshot = app_settings.lock().await.clone();
    for entry in entries {
        let parent_entry = {
            let workspaces = workspaces.lock().await;
            entry
                .parent_id
                .as_ref()
                .and_then(|parent_id| workspaces.get(parent_id))
                .cloned()
        };
        let default_bin = app_settings_snapshot.codex_bin.clone();
        let codex_args = resolve_workspace_codex_args(
            &entry,
            parent_entry.as_ref(),
            Some(&app_settings_snapshot),
        );
        let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref());
        let new_session = spawn_session(entry.clone(), default_bin, codex_args, codex_home).await?;
        crate::runtime::replace_workspace_session_with_source(
            sessions,
            runtime_manager.map(|manager| manager.as_ref()),
            entry.id.clone(),
            new_session,
            "settings-restart",
            crate::backend::app_server::RuntimeShutdownSource::SettingsRestart,
        )
        .await?;
    }
    Ok(())
}

async fn resolve_workspace_root(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .cloned()
        .ok_or_else(|| "workspace not found".to_string())?;
    Ok(PathBuf::from(entry.path))
}

pub(crate) async fn worktree_setup_status_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    data_dir: &PathBuf,
) -> Result<WorktreeSetupStatus, String> {
    let entry = {
        let workspaces = workspaces.lock().await;
        workspaces
            .get(workspace_id)
            .cloned()
            .ok_or_else(|| "workspace not found".to_string())?
    };

    let script = normalize_setup_script(entry.settings.worktree_setup_script.clone());
    let marker_exists = if entry.kind.is_worktree() {
        worktree_setup_marker_path(data_dir, &entry.id).exists()
    } else {
        false
    };
    let should_run = entry.kind.is_worktree() && script.is_some() && !marker_exists;

    Ok(WorktreeSetupStatus { should_run, script })
}

pub(crate) async fn worktree_setup_mark_ran_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    data_dir: &PathBuf,
) -> Result<(), String> {
    let entry = {
        let workspaces = workspaces.lock().await;
        workspaces
            .get(workspace_id)
            .cloned()
            .ok_or_else(|| "workspace not found".to_string())?
    };
    if !entry.kind.is_worktree() {
        return Err("Not a worktree workspace.".to_string());
    }
    let marker_path = worktree_setup_marker_path(data_dir, &entry.id);
    if let Some(parent) = marker_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to prepare worktree marker directory: {err}"))?;
    }
    let ran_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    std::fs::write(&marker_path, format!("ran_at={ran_at}\n"))
        .map_err(|err| format!("Failed to write worktree setup marker: {err}"))?;
    Ok(())
}

pub(crate) async fn add_workspace_core<F, Fut>(
    path: String,
    codex_bin: Option<String>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    app_settings: &Mutex<AppSettings>,
    storage_path: &PathBuf,
    spawn_session: F,
) -> Result<WorkspaceInfo, String>
where
    F: Fn(WorkspaceEntry, Option<String>, Option<String>, Option<PathBuf>) -> Fut,
    Fut: Future<Output = Result<Arc<WorkspaceSession>, String>>,
{
    if !PathBuf::from(&path).is_dir() {
        return Err("Workspace path must be a folder.".to_string());
    }

    let name = workspace_name_from_path(&path);
    let entry = WorkspaceEntry {
        id: Uuid::new_v4().to_string(),
        name: name.clone(),
        path: path.clone(),
        codex_bin,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings: WorkspaceSettings::default(),
    };

    let (default_bin, codex_args) = {
        let settings = app_settings.lock().await;
        (
            settings.codex_bin.clone(),
            resolve_workspace_codex_args(&entry, None, Some(&settings)),
        )
    };
    let codex_home = resolve_workspace_codex_home(&entry, None);
    let session = spawn_session(entry.clone(), default_bin, codex_args, codex_home).await?;

    if let Err(error) = {
        let mut workspaces = workspaces.lock().await;
        workspaces.insert(entry.id.clone(), entry.clone());
        let list: Vec<_> = workspaces.values().cloned().collect();
        let merged = write_workspaces_preserving_existing(storage_path, &list)?;
        *workspaces = merged
            .into_iter()
            .map(|workspace| (workspace.id.clone(), workspace))
            .collect();
        Ok::<(), String>(())
    } {
        {
            let mut workspaces = workspaces.lock().await;
            workspaces.remove(&entry.id);
        }
        let _ = crate::runtime::terminate_workspace_session(session, None).await;
        return Err(error);
    }

    crate::runtime::replace_workspace_session(
        sessions,
        None,
        entry.id.clone(),
        session,
        "workspace-add",
    )
    .await?;

    Ok(WorkspaceInfo {
        id: entry.id,
        name: entry.name,
        path: entry.path,
        codex_bin: entry.codex_bin,
        connected: true,
        kind: entry.kind,
        parent_id: entry.parent_id,
        worktree: entry.worktree,
        settings: entry.settings,
    })
}

pub(crate) fn run_git_command_unit<F, Fut>(
    repo_path: &PathBuf,
    args: &[&str],
    run_git_command: F,
) -> impl Future<Output = Result<(), String>>
where
    F: Fn(PathBuf, Vec<String>) -> Fut,
    Fut: Future<Output = Result<String, String>>,
{
    // Own the inputs so the returned future does not borrow temporary references.
    let repo_path = repo_path.clone();
    let args_owned = args
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    async move {
        run_git_command(repo_path, args_owned)
            .await
            .map(|_output| ())
    }
}

fn validation_error(message: impl AsRef<str>) -> String {
    format!("{WORKTREE_VALIDATION_ERROR_PREFIX}: {}", message.as_ref())
}

fn validate_local_branch_name_for_worktree(name: &str) -> Result<(), String> {
    let full_ref = format!("refs/heads/{name}");
    if git2::Reference::is_valid_name(&full_ref) {
        Ok(())
    } else {
        Err(format!("Invalid branch name: {name}"))
    }
}

fn resolve_base_ref_to_commit(repo_path: &PathBuf, base_ref: &str) -> Result<String, String> {
    let repo = git2::Repository::open(repo_path)
        .map_err(|err| format!("Failed to open repository: {err}"))?;
    let object = repo
        .revparse_single(base_ref)
        .map_err(|_| format!("Base ref not found: {base_ref}"))?;
    let commit = object
        .peel_to_commit()
        .map_err(|_| format!("Base ref is not a commit: {base_ref}"))?;
    Ok(commit.id().to_string())
}

pub(crate) async fn add_worktree_core<
    FSpawn,
    FutSpawn,
    FSanitize,
    FUniquePath,
    FBranchExists,
    FutBranchExists,
    FFindRemoteTracking,
    FutFindRemoteTracking,
    FRunGit,
    FutRunGit,
>(
    parent_id: String,
    branch: String,
    base_ref: Option<String>,
    publish_to_origin: bool,
    data_dir: &PathBuf,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    app_settings: &Mutex<AppSettings>,
    storage_path: &PathBuf,
    sanitize_worktree_name: FSanitize,
    unique_worktree_path: FUniquePath,
    git_branch_exists: FBranchExists,
    git_find_remote_tracking_branch: Option<FFindRemoteTracking>,
    run_git_command: FRunGit,
    spawn_session: FSpawn,
) -> Result<WorkspaceInfo, String>
where
    FSpawn: Fn(WorkspaceEntry, Option<String>, Option<String>, Option<PathBuf>) -> FutSpawn,
    FutSpawn: Future<Output = Result<Arc<WorkspaceSession>, String>>,
    FSanitize: Fn(&str) -> String,
    FUniquePath: Fn(&PathBuf, &str) -> Result<PathBuf, String>,
    FBranchExists: Fn(&PathBuf, &str) -> FutBranchExists,
    FutBranchExists: Future<Output = Result<bool, String>>,
    FFindRemoteTracking: Fn(&PathBuf, &str) -> FutFindRemoteTracking,
    FutFindRemoteTracking: Future<Output = Result<Option<String>, String>>,
    FRunGit: Fn(&PathBuf, &[&str]) -> FutRunGit,
    FutRunGit: Future<Output = Result<(), String>>,
{
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        return Err(validation_error("Branch name is required."));
    }
    if let Err(message) = validate_local_branch_name_for_worktree(&branch) {
        return Err(validation_error(message));
    }

    let base_ref = base_ref
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| validation_error("baseRef is required."))?;

    let repo_path = {
        let workspaces = workspaces.lock().await;
        let parent = workspaces
            .get(&parent_id)
            .cloned()
            .ok_or_else(|| "parent workspace not found".to_string())?;
        PathBuf::from(parent.path)
    };
    let base_commit = match resolve_base_ref_to_commit(&repo_path, &base_ref) {
        Ok(commit) => commit,
        Err(message) => return Err(validation_error(message)),
    };

    let parent_entry = {
        let workspaces = workspaces.lock().await;
        workspaces
            .get(&parent_id)
            .cloned()
            .ok_or_else(|| "parent workspace not found".to_string())?
    };

    if parent_entry.kind.is_worktree() {
        return Err("Cannot create a worktree from another worktree.".to_string());
    }

    let worktree_root = data_dir.join("worktrees").join(&parent_entry.id);
    std::fs::create_dir_all(&worktree_root)
        .map_err(|err| format!("Failed to create worktree directory: {err}"))?;

    let safe_name = sanitize_worktree_name(&branch);
    let preferred_worktree_path = worktree_root.join(&safe_name);
    if preferred_worktree_path.exists() {
        return Err(validation_error(format!(
            "Worktree path conflict: {}",
            preferred_worktree_path.display()
        )));
    }
    let worktree_path = unique_worktree_path(&worktree_root, &safe_name)?;
    if worktree_path != preferred_worktree_path {
        return Err(validation_error(format!(
            "Worktree path conflict: {}",
            preferred_worktree_path.display()
        )));
    }
    let worktree_path_string = worktree_path.to_string_lossy().to_string();

    let branch_exists = git_branch_exists(&repo_path, &branch).await?;
    if branch_exists {
        run_git_command(
            &repo_path,
            &["worktree", "add", &worktree_path_string, &branch],
        )
        .await?;
    } else {
        run_git_command(
            &repo_path,
            &[
                "worktree",
                "add",
                "-b",
                &branch,
                &worktree_path_string,
                &base_commit,
            ],
        )
        .await?;
    }

    let mut tracking: Option<String> = None;
    let mut publish_error: Option<String> = None;
    let mut publish_retry_command: Option<String> = None;
    if publish_to_origin {
        if let Err(error) = run_git_command(&repo_path, &["push", "-u", "origin", &branch]).await {
            publish_error = Some(error);
            publish_retry_command = Some(format!(
                "git -C \"{}\" push -u origin {}",
                repo_path.display(),
                branch
            ));
        } else {
            tracking = Some(format!("origin/{branch}"));
        }
    } else if let Some(find_remote_tracking) = git_find_remote_tracking_branch {
        tracking = find_remote_tracking(&repo_path, &branch).await?;
    }

    let entry = WorkspaceEntry {
        id: Uuid::new_v4().to_string(),
        name: branch.clone(),
        path: worktree_path_string,
        codex_bin: parent_entry.codex_bin.clone(),
        kind: WorkspaceKind::Worktree,
        parent_id: Some(parent_entry.id.clone()),
        worktree: Some(WorktreeInfo {
            branch,
            base_ref: Some(base_ref),
            base_commit: Some(base_commit),
            tracking,
            publish_error,
            publish_retry_command,
        }),
        settings: WorkspaceSettings {
            worktree_setup_script: normalize_setup_script(
                parent_entry.settings.worktree_setup_script.clone(),
            ),
            ..WorkspaceSettings::default()
        },
    };

    let (default_bin, codex_args) = {
        let settings = app_settings.lock().await;
        (
            settings.codex_bin.clone(),
            resolve_workspace_codex_args(&entry, Some(&parent_entry), Some(&settings)),
        )
    };
    let codex_home = resolve_workspace_codex_home(&entry, Some(&parent_entry));
    let session = spawn_session(entry.clone(), default_bin, codex_args, codex_home).await?;

    {
        let mut workspaces = workspaces.lock().await;
        workspaces.insert(entry.id.clone(), entry.clone());
        let list: Vec<_> = workspaces.values().cloned().collect();
        let merged = write_workspaces_preserving_existing(storage_path, &list)?;
        *workspaces = merged
            .into_iter()
            .map(|workspace| (workspace.id.clone(), workspace))
            .collect();
    }

    crate::runtime::replace_workspace_session(
        sessions,
        None,
        entry.id.clone(),
        session,
        "worktree-add",
    )
    .await?;

    Ok(WorkspaceInfo {
        id: entry.id,
        name: entry.name,
        path: entry.path,
        codex_bin: entry.codex_bin,
        connected: true,
        kind: entry.kind,
        parent_id: entry.parent_id,
        worktree: entry.worktree,
        settings: entry.settings,
    })
}

pub(crate) async fn connect_workspace_core<F, Fut>(
    workspace_id: String,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    app_settings: &Mutex<AppSettings>,
    runtime_manager: Option<&Arc<crate::runtime::RuntimeManager>>,
    recovery_source: &str,
    automatic_recovery: bool,
    spawn_session: F,
) -> Result<(), String>
where
    F: Fn(WorkspaceEntry, Option<String>, Option<String>, Option<PathBuf>) -> Fut,
    Fut: Future<Output = Result<Arc<WorkspaceSession>, String>>,
{
    let (entry, parent_entry) = resolve_workspace_and_parent(workspaces, &workspace_id).await?;
    loop {
        let existing_session = {
            let sessions = sessions.lock().await;
            sessions.get(&workspace_id).cloned()
        };
        if let Some(session) = existing_session {
            match session
                .probe_health(Duration::from_secs(SESSION_HEALTH_PROBE_TIMEOUT_SECS))
                .await
            {
                Ok(()) => {
                    if let Some(runtime_manager) = runtime_manager {
                        runtime_manager
                            .touch("codex", &workspace_id, "connect")
                            .await;
                    }
                    return Ok(());
                }
                Err(error) => {
                    log::warn!(
                        "[connect_workspace_core] stale session detected for workspace {}: {}",
                        workspace_id,
                        error
                    );
                    if let Some(runtime_manager) = runtime_manager {
                        runtime_manager
                            .note_probe_failure(
                                "codex",
                                &workspace_id,
                                recovery_source,
                                "stale existing session failed health probe during connect",
                            )
                            .await;
                    }
                    disconnect_workspace_session_core(sessions, runtime_manager, &workspace_id)
                        .await;
                    if let Some(runtime_manager) = runtime_manager {
                        if automatic_recovery {
                            if let Err(quarantine_error) = runtime_manager
                                .record_recovery_failure_with_backoff(
                                    "codex",
                                    &workspace_id,
                                    recovery_source,
                                    "stale existing session failed health probe during connect",
                                )
                                .await
                            {
                                return Err(quarantine_error);
                            }
                        }
                        continue;
                    }
                }
            }
        }

        let acquire_token = if let Some(runtime_manager) = runtime_manager {
            match runtime_manager
                .begin_runtime_acquire_or_retry(
                    "codex",
                    &workspace_id,
                    recovery_source,
                    automatic_recovery,
                    "timed out waiting for concurrent runtime acquire during connect",
                )
                .await
            {
                Ok(RuntimeAcquireDisposition::Leader(token)) => Some(token),
                Ok(RuntimeAcquireDisposition::Retry) => continue,
                Err(error) => return Err(error),
            }
        } else {
            None
        };

        if let Some(runtime_manager) = runtime_manager {
            runtime_manager
                .record_starting(&entry, "codex", recovery_source)
                .await;
        }
        let (default_bin, codex_args) = {
            let settings = app_settings.lock().await;
            (
                settings.codex_bin.clone(),
                resolve_workspace_codex_args(&entry, parent_entry.as_ref(), Some(&settings)),
            )
        };
        let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref());
        let spawn_result = spawn_session(entry.clone(), default_bin, codex_args, codex_home).await;
        let session = match spawn_result {
            Ok(created_session) => created_session,
            Err(error) => {
                if let Some(runtime_manager) = runtime_manager {
                    runtime_manager
                        .record_failure(&entry, "codex", recovery_source, error.clone())
                        .await;
                    runtime_manager
                        .finish_runtime_acquire(
                            acquire_token
                                .as_ref()
                                .expect("runtime acquire token must exist when manager exists"),
                        )
                        .await;
                    if automatic_recovery {
                        if let Err(quarantine_error) = runtime_manager
                            .record_recovery_failure_with_backoff(
                                "codex",
                                &workspace_id,
                                recovery_source,
                                error.as_str(),
                            )
                            .await
                        {
                            return Err(quarantine_error);
                        }
                        continue;
                    }
                    return Err(error);
                }
                return Err(error);
            }
        };
        if let Some(runtime_manager) = runtime_manager {
            session.attach_runtime_manager(runtime_manager.clone());
        }
        let replace_result = crate::runtime::replace_workspace_session(
            sessions,
            runtime_manager.map(|manager| manager.as_ref()),
            entry.id.clone(),
            session,
            recovery_source,
        )
        .await;
        if let Some(runtime_manager) = runtime_manager {
            runtime_manager
                .finish_runtime_acquire(
                    acquire_token
                        .as_ref()
                        .expect("runtime acquire token must exist when manager exists"),
                )
                .await;
            if replace_result.is_ok() {
                runtime_manager
                    .record_recovery_success("codex", &workspace_id)
                    .await;
                return replace_result;
            }
            if let Err(error) = &replace_result {
                if automatic_recovery {
                    if let Err(quarantine_error) = runtime_manager
                        .record_recovery_failure_with_backoff(
                            "codex",
                            &workspace_id,
                            recovery_source,
                            error.as_str(),
                        )
                        .await
                    {
                        return Err(quarantine_error);
                    }
                    continue;
                }
                return replace_result;
            }
        }
        return replace_result;
    }
}

pub(crate) async fn disconnect_workspace_session_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    runtime_manager: Option<&Arc<crate::runtime::RuntimeManager>>,
    id: &str,
) {
    if let Some(runtime_manager) = runtime_manager {
        let _ = crate::runtime::stop_workspace_session(sessions, runtime_manager, id).await;
        return;
    }
    if let Some(session) = sessions.lock().await.remove(id) {
        let _ = crate::runtime::terminate_workspace_session(session, None).await;
    }
}

pub(crate) async fn remove_workspace_core<FRunGit, FutRunGit, FIsMissing, FRemoveDirAll>(
    id: String,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    storage_path: &PathBuf,
    run_git_command: FRunGit,
    is_missing_worktree_error: FIsMissing,
    remove_dir_all: FRemoveDirAll,
    require_all_children_removed_to_remove_parent: bool,
    continue_on_child_error: bool,
) -> Result<(), String>
where
    FRunGit: Fn(&PathBuf, &[&str]) -> FutRunGit,
    FutRunGit: Future<Output = Result<(), String>>,
    FIsMissing: Fn(&str) -> bool,
    FRemoveDirAll: Fn(&PathBuf) -> Result<(), String>,
{
    let (entry, child_worktrees) = {
        let workspaces = workspaces.lock().await;
        let entry = workspaces
            .get(&id)
            .cloned()
            .ok_or_else(|| "workspace not found".to_string())?;
        if entry.kind.is_worktree() {
            return Err("Use remove_worktree for worktree agents.".to_string());
        }
        let children = workspaces
            .values()
            .filter(|workspace| workspace.parent_id.as_deref() == Some(&id))
            .cloned()
            .collect::<Vec<_>>();
        (entry, children)
    };

    let repo_path = PathBuf::from(&entry.path);
    let mut removed_child_ids = Vec::new();
    let mut failures: Vec<(String, String)> = Vec::new();

    for child in &child_worktrees {
        let child_path = PathBuf::from(&child.path);
        if child_path.exists() {
            if let Err(error) =
                run_git_command(&repo_path, &["worktree", "remove", "--force", &child.path]).await
            {
                if is_missing_worktree_error(&error) {
                    if child_path.exists() {
                        if let Err(fs_error) = remove_dir_all(&child_path) {
                            if continue_on_child_error {
                                failures.push((child.id.clone(), fs_error));
                                continue;
                            }
                            return Err(fs_error);
                        }
                    }
                } else {
                    if continue_on_child_error {
                        failures.push((child.id.clone(), error));
                        continue;
                    }
                    return Err(error);
                }
            }
        }

        disconnect_workspace_session_core(sessions, None, &child.id).await;
        removed_child_ids.push(child.id.clone());
    }

    let _ = run_git_command(&repo_path, &["worktree", "prune", "--expire", "now"]).await;

    let mut ids_to_remove = removed_child_ids;
    if failures.is_empty() || !require_all_children_removed_to_remove_parent {
        disconnect_workspace_session_core(sessions, None, &id).await;
        ids_to_remove.push(id.clone());
    }

    {
        let mut workspaces = workspaces.lock().await;
        for workspace_id in ids_to_remove {
            workspaces.remove(&workspace_id);
        }
        let list: Vec<_> = workspaces.values().cloned().collect();
        write_workspaces(storage_path, &list)?;
    }

    if failures.is_empty() {
        return Ok(());
    }

    if require_all_children_removed_to_remove_parent {
        let mut message =
            "Failed to remove one or more worktrees; parent workspace was not removed.".to_string();
        for (child_id, error) in failures {
            message.push_str(&format!("\n- {child_id}: {error}"));
        }
        return Err(message);
    }

    Ok(())
}

pub(crate) async fn remove_worktree_core<FRunGit, FutRunGit, FIsMissing, FRemoveDirAll>(
    id: String,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    storage_path: &PathBuf,
    run_git_command: FRunGit,
    is_missing_worktree_error: FIsMissing,
    remove_dir_all: FRemoveDirAll,
) -> Result<(), String>
where
    FRunGit: Fn(&PathBuf, &[&str]) -> FutRunGit,
    FutRunGit: Future<Output = Result<(), String>>,
    FIsMissing: Fn(&str) -> bool,
    FRemoveDirAll: Fn(&PathBuf) -> Result<(), String>,
{
    let (entry, parent) = {
        let workspaces = workspaces.lock().await;
        let entry = workspaces
            .get(&id)
            .cloned()
            .ok_or_else(|| "workspace not found".to_string())?;
        if !entry.kind.is_worktree() {
            return Err("Not a worktree workspace.".to_string());
        }
        let parent_id = entry
            .parent_id
            .clone()
            .ok_or_else(|| "worktree parent not found".to_string())?;
        let parent = workspaces
            .get(&parent_id)
            .cloned()
            .ok_or_else(|| "worktree parent not found".to_string())?;
        (entry, parent)
    };

    let parent_path = PathBuf::from(&parent.path);
    let entry_path = PathBuf::from(&entry.path);
    if entry_path.exists() {
        if let Err(error) = run_git_command(
            &parent_path,
            &["worktree", "remove", "--force", &entry.path],
        )
        .await
        {
            if is_missing_worktree_error(&error) {
                if entry_path.exists() {
                    remove_dir_all(&entry_path)?;
                }
            } else {
                return Err(error);
            }
        }
    }
    let _ = run_git_command(&parent_path, &["worktree", "prune", "--expire", "now"]).await;

    disconnect_workspace_session_core(sessions, None, &entry.id).await;

    {
        let mut workspaces = workspaces.lock().await;
        workspaces.remove(&entry.id);
        let list: Vec<_> = workspaces.values().cloned().collect();
        write_workspaces(storage_path, &list)?;
    }

    Ok(())
}

pub(crate) async fn rename_worktree_core<
    FSpawn,
    FutSpawn,
    FResolveGitRoot,
    FUniqueBranch,
    FutUniqueBranch,
    FSanitize,
    FUniqueRenamePath,
    FRunGit,
    FutRunGit,
>(
    id: String,
    branch: String,
    data_dir: &PathBuf,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    app_settings: &Mutex<AppSettings>,
    storage_path: &PathBuf,
    resolve_git_root: FResolveGitRoot,
    unique_branch_name: FUniqueBranch,
    sanitize_worktree_name: FSanitize,
    unique_worktree_path_for_rename: FUniqueRenamePath,
    run_git_command: FRunGit,
    spawn_session: FSpawn,
) -> Result<WorkspaceInfo, String>
where
    FSpawn: Fn(WorkspaceEntry, Option<String>, Option<String>, Option<PathBuf>) -> FutSpawn,
    FutSpawn: Future<Output = Result<Arc<WorkspaceSession>, String>>,
    FResolveGitRoot: Fn(&WorkspaceEntry) -> Result<PathBuf, String>,
    FUniqueBranch: Fn(&PathBuf, &str) -> FutUniqueBranch,
    FutUniqueBranch: Future<Output = Result<String, String>>,
    FSanitize: Fn(&str) -> String,
    FUniqueRenamePath: Fn(&PathBuf, &str, &PathBuf) -> Result<PathBuf, String>,
    FRunGit: Fn(&PathBuf, &[&str]) -> FutRunGit,
    FutRunGit: Future<Output = Result<(), String>>,
{
    let trimmed = branch.trim();
    if trimmed.is_empty() {
        return Err("Branch name is required.".to_string());
    }

    let (entry, parent) = {
        let workspaces = workspaces.lock().await;
        let entry = workspaces
            .get(&id)
            .cloned()
            .ok_or_else(|| "workspace not found".to_string())?;
        if !entry.kind.is_worktree() {
            return Err("Not a worktree workspace.".to_string());
        }
        let parent_id = entry
            .parent_id
            .clone()
            .ok_or_else(|| "worktree parent not found".to_string())?;
        let parent = workspaces
            .get(&parent_id)
            .cloned()
            .ok_or_else(|| "worktree parent not found".to_string())?;
        (entry, parent)
    };

    let old_branch = entry
        .worktree
        .as_ref()
        .map(|worktree| worktree.branch.clone())
        .ok_or_else(|| "worktree metadata missing".to_string())?;
    if old_branch == trimmed {
        return Err("Branch name is unchanged.".to_string());
    }

    let parent_root = resolve_git_root(&parent)?;
    let final_branch = unique_branch_name(&parent_root, trimmed).await?;
    if final_branch == old_branch {
        return Err("Branch name is unchanged.".to_string());
    }

    run_git_command(&parent_root, &["branch", "-m", &old_branch, &final_branch]).await?;

    let worktree_root = data_dir.join("worktrees").join(&parent.id);
    std::fs::create_dir_all(&worktree_root)
        .map_err(|err| format!("Failed to create worktree directory: {err}"))?;

    let safe_name = sanitize_worktree_name(&final_branch);
    let current_path = PathBuf::from(&entry.path);
    let next_path = unique_worktree_path_for_rename(&worktree_root, &safe_name, &current_path)?;
    let next_path_string = next_path.to_string_lossy().to_string();
    if next_path_string != entry.path {
        if let Err(error) = run_git_command(
            &parent_root,
            &["worktree", "move", &entry.path, &next_path_string],
        )
        .await
        {
            let _ =
                run_git_command(&parent_root, &["branch", "-m", &final_branch, &old_branch]).await;
            return Err(error);
        }
    }

    let (entry_snapshot, list) = {
        let mut workspaces = workspaces.lock().await;
        let entry = match workspaces.get_mut(&id) {
            Some(entry) => entry,
            None => return Err("workspace not found".to_string()),
        };
        entry.name = final_branch.clone();
        entry.path = next_path_string.clone();
        match entry.worktree.as_mut() {
            Some(worktree) => {
                worktree.branch = final_branch.clone();
            }
            None => {
                entry.worktree = Some(WorktreeInfo {
                    branch: final_branch.clone(),
                    base_ref: None,
                    base_commit: None,
                    tracking: None,
                    publish_error: None,
                    publish_retry_command: None,
                });
            }
        }
        let snapshot = entry.clone();
        let list: Vec<_> = workspaces.values().cloned().collect();
        (snapshot, list)
    };
    write_workspaces(storage_path, &list)?;

    let was_connected = sessions.lock().await.contains_key(&entry_snapshot.id);
    if was_connected {
        disconnect_workspace_session_core(sessions, None, &entry_snapshot.id).await;
        let (default_bin, codex_args) = {
            let settings = app_settings.lock().await;
            (
                settings.codex_bin.clone(),
                resolve_workspace_codex_args(&entry_snapshot, Some(&parent), Some(&settings)),
            )
        };
        let codex_home = resolve_workspace_codex_home(&entry_snapshot, Some(&parent));
        match spawn_session(entry_snapshot.clone(), default_bin, codex_args, codex_home).await {
            Ok(session) => {
                sessions
                    .lock()
                    .await
                    .insert(entry_snapshot.id.clone(), session);
            }
            Err(error) => {
                eprintln!(
                    "rename_worktree: respawn failed for {} after rename: {error}",
                    entry_snapshot.id
                );
            }
        }
    }

    let connected = sessions.lock().await.contains_key(&entry_snapshot.id);
    Ok(WorkspaceInfo {
        id: entry_snapshot.id,
        name: entry_snapshot.name,
        path: entry_snapshot.path,
        codex_bin: entry_snapshot.codex_bin,
        connected,
        kind: entry_snapshot.kind,
        parent_id: entry_snapshot.parent_id,
        worktree: entry_snapshot.worktree,
        settings: entry_snapshot.settings,
    })
}

pub(crate) async fn rename_worktree_upstream_core<
    FResolveGitRoot,
    FBranchExists,
    FutBranchExists,
    FFindRemote,
    FutFindRemote,
    FRemoteExists,
    FutRemoteExists,
    FRemoteBranchExists,
    FutRemoteBranchExists,
    FRunGit,
    FutRunGit,
>(
    id: String,
    old_branch: String,
    new_branch: String,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    resolve_git_root: FResolveGitRoot,
    git_branch_exists: FBranchExists,
    git_find_remote_for_branch: FFindRemote,
    git_remote_exists: FRemoteExists,
    git_remote_branch_exists: FRemoteBranchExists,
    run_git_command: FRunGit,
) -> Result<(), String>
where
    FResolveGitRoot: Fn(&WorkspaceEntry) -> Result<PathBuf, String>,
    FBranchExists: Fn(&PathBuf, &str) -> FutBranchExists,
    FutBranchExists: Future<Output = Result<bool, String>>,
    FFindRemote: Fn(&PathBuf, &str) -> FutFindRemote,
    FutFindRemote: Future<Output = Result<Option<String>, String>>,
    FRemoteExists: Fn(&PathBuf, &str) -> FutRemoteExists,
    FutRemoteExists: Future<Output = Result<bool, String>>,
    FRemoteBranchExists: Fn(&PathBuf, &str, &str) -> FutRemoteBranchExists,
    FutRemoteBranchExists: Future<Output = Result<bool, String>>,
    FRunGit: Fn(&PathBuf, &[&str]) -> FutRunGit,
    FutRunGit: Future<Output = Result<(), String>>,
{
    let old_branch = old_branch.trim().to_string();
    let new_branch = new_branch.trim().to_string();
    if old_branch.is_empty() || new_branch.is_empty() {
        return Err("Branch name is required.".to_string());
    }
    if old_branch == new_branch {
        return Err("Branch name is unchanged.".to_string());
    }

    let (_entry, parent) = {
        let workspaces = workspaces.lock().await;
        let entry = workspaces
            .get(&id)
            .cloned()
            .ok_or_else(|| "workspace not found".to_string())?;
        if !entry.kind.is_worktree() {
            return Err("Not a worktree workspace.".to_string());
        }
        let parent_id = entry
            .parent_id
            .clone()
            .ok_or_else(|| "worktree parent not found".to_string())?;
        let parent = workspaces
            .get(&parent_id)
            .cloned()
            .ok_or_else(|| "worktree parent not found".to_string())?;
        (entry, parent)
    };

    let parent_root = resolve_git_root(&parent)?;
    if !git_branch_exists(&parent_root, &new_branch).await? {
        return Err("Local branch not found.".to_string());
    }

    let remote_for_old = git_find_remote_for_branch(&parent_root, &old_branch).await?;
    let remote_name = match remote_for_old.as_ref() {
        Some(remote) => remote.clone(),
        None => {
            if git_remote_exists(&parent_root, "origin").await? {
                "origin".to_string()
            } else {
                return Err("No git remote configured for this worktree.".to_string());
            }
        }
    };

    if git_remote_branch_exists(&parent_root, &remote_name, &new_branch).await? {
        return Err("Remote branch already exists.".to_string());
    }

    if remote_for_old.is_some() {
        run_git_command(
            &parent_root,
            &["push", &remote_name, &format!("{new_branch}:{new_branch}")],
        )
        .await?;
        run_git_command(
            &parent_root,
            &["push", &remote_name, &format!(":{old_branch}")],
        )
        .await?;
    } else {
        run_git_command(&parent_root, &["push", &remote_name, &new_branch]).await?;
    }

    run_git_command(
        &parent_root,
        &[
            "branch",
            "--set-upstream-to",
            &format!("{remote_name}/{new_branch}"),
            &new_branch,
        ],
    )
    .await?;

    Ok(())
}

pub(crate) async fn update_workspace_settings_core<FApplySettings, FSpawn, FutSpawn>(
    id: String,
    mut settings: WorkspaceSettings,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    app_settings: &Mutex<AppSettings>,
    storage_path: &PathBuf,
    apply_settings_update: FApplySettings,
    spawn_session: FSpawn,
) -> Result<WorkspaceInfo, String>
where
    FApplySettings: Fn(
        &mut HashMap<String, WorkspaceEntry>,
        &str,
        WorkspaceSettings,
    ) -> Result<WorkspaceEntry, String>,
    FSpawn: Fn(WorkspaceEntry, Option<String>, Option<String>, Option<PathBuf>) -> FutSpawn,
    FutSpawn: Future<Output = Result<Arc<WorkspaceSession>, String>>,
{
    settings.worktree_setup_script = normalize_setup_script(settings.worktree_setup_script);

    let (
        previous_entry,
        entry_snapshot,
        parent_entry,
        previous_codex_home,
        previous_codex_args,
        previous_worktree_setup_script,
        child_entries,
    ) = {
        let mut workspaces = workspaces.lock().await;
        let previous_entry = workspaces
            .get(&id)
            .cloned()
            .ok_or_else(|| "workspace not found".to_string())?;
        let previous_codex_home = previous_entry.settings.codex_home.clone();
        let previous_codex_args = previous_entry.settings.codex_args.clone();
        let previous_worktree_setup_script = previous_entry.settings.worktree_setup_script.clone();
        let entry_snapshot = apply_settings_update(&mut workspaces, &id, settings)?;
        let parent_entry = entry_snapshot
            .parent_id
            .as_ref()
            .and_then(|parent_id| workspaces.get(parent_id))
            .cloned();
        let child_entries = workspaces
            .values()
            .filter(|entry| entry.parent_id.as_deref() == Some(&id))
            .cloned()
            .collect::<Vec<_>>();
        (
            previous_entry,
            entry_snapshot,
            parent_entry,
            previous_codex_home,
            previous_codex_args,
            previous_worktree_setup_script,
            child_entries,
        )
    };

    let codex_home_changed = previous_codex_home != entry_snapshot.settings.codex_home;
    let codex_args_changed = previous_codex_args != entry_snapshot.settings.codex_args;
    let worktree_setup_script_changed =
        previous_worktree_setup_script != entry_snapshot.settings.worktree_setup_script;
    let connected = sessions.lock().await.contains_key(&id);
    if connected && (codex_home_changed || codex_args_changed) {
        let rollback_entry = previous_entry.clone();
        let (default_bin, codex_args) = {
            let settings = app_settings.lock().await;
            (
                settings.codex_bin.clone(),
                resolve_workspace_codex_args(
                    &entry_snapshot,
                    parent_entry.as_ref(),
                    Some(&settings),
                ),
            )
        };
        let codex_home = resolve_workspace_codex_home(&entry_snapshot, parent_entry.as_ref());
        let new_session = match spawn_session(
            entry_snapshot.clone(),
            default_bin,
            codex_args,
            codex_home,
        )
        .await
        {
            Ok(session) => session,
            Err(error) => {
                let mut workspaces = workspaces.lock().await;
                workspaces.insert(rollback_entry.id.clone(), rollback_entry);
                return Err(error);
            }
        };
        crate::runtime::replace_workspace_session_with_source(
            sessions,
            None,
            entry_snapshot.id.clone(),
            new_session,
            "workspace-settings",
            crate::backend::app_server::RuntimeShutdownSource::SettingsRestart,
        )
        .await?;
    }
    if codex_home_changed || codex_args_changed {
        let app_settings_snapshot = app_settings.lock().await.clone();
        let default_bin = app_settings_snapshot.codex_bin.clone();
        for child in &child_entries {
            let connected = sessions.lock().await.contains_key(&child.id);
            if !connected {
                continue;
            }
            let previous_child_home = resolve_workspace_codex_home(child, Some(&previous_entry));
            let next_child_home = resolve_workspace_codex_home(child, Some(&entry_snapshot));
            let previous_child_args = resolve_workspace_codex_args(
                child,
                Some(&previous_entry),
                Some(&app_settings_snapshot),
            );
            let next_child_args = resolve_workspace_codex_args(
                child,
                Some(&entry_snapshot),
                Some(&app_settings_snapshot),
            );
            if previous_child_home == next_child_home && previous_child_args == next_child_args {
                continue;
            }
            let new_session = match spawn_session(
                child.clone(),
                default_bin.clone(),
                next_child_args,
                next_child_home,
            )
            .await
            {
                Ok(session) => session,
                Err(error) => {
                    eprintln!(
                        "update_workspace_settings: respawn failed for worktree {} after parent override change: {error}",
                        child.id
                    );
                    continue;
                }
            };
            crate::runtime::replace_workspace_session_with_source(
                sessions,
                None,
                child.id.clone(),
                new_session,
                "workspace-settings-child",
                crate::backend::app_server::RuntimeShutdownSource::SettingsRestart,
            )
            .await?;
        }
    }
    if worktree_setup_script_changed && !entry_snapshot.kind.is_worktree() {
        let child_ids = child_entries
            .iter()
            .map(|child| child.id.clone())
            .collect::<Vec<_>>();
        if !child_ids.is_empty() {
            let mut workspaces = workspaces.lock().await;
            for child_id in child_ids {
                if let Some(child) = workspaces.get_mut(&child_id) {
                    child.settings.worktree_setup_script =
                        entry_snapshot.settings.worktree_setup_script.clone();
                }
            }
        }
    }
    let list: Vec<_> = {
        let workspaces = workspaces.lock().await;
        workspaces.values().cloned().collect()
    };
    write_workspaces(storage_path, &list)?;
    Ok(WorkspaceInfo {
        id: entry_snapshot.id,
        name: entry_snapshot.name,
        path: entry_snapshot.path,
        codex_bin: entry_snapshot.codex_bin,
        connected,
        kind: entry_snapshot.kind,
        parent_id: entry_snapshot.parent_id,
        worktree: entry_snapshot.worktree,
        settings: entry_snapshot.settings,
    })
}

pub(crate) async fn update_workspace_codex_bin_core(
    id: String,
    codex_bin: Option<String>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    storage_path: &PathBuf,
) -> Result<WorkspaceInfo, String> {
    let (entry_snapshot, list) = {
        let mut workspaces = workspaces.lock().await;
        let entry_snapshot = match workspaces.get_mut(&id) {
            Some(entry) => {
                entry.codex_bin = codex_bin.clone();
                entry.clone()
            }
            None => return Err("workspace not found".to_string()),
        };
        let list: Vec<_> = workspaces.values().cloned().collect();
        (entry_snapshot, list)
    };
    write_workspaces(storage_path, &list)?;

    let connected = sessions.lock().await.contains_key(&id);
    Ok(WorkspaceInfo {
        id: entry_snapshot.id,
        name: entry_snapshot.name,
        path: entry_snapshot.path,
        codex_bin: entry_snapshot.codex_bin,
        connected,
        kind: entry_snapshot.kind,
        parent_id: entry_snapshot.parent_id,
        worktree: entry_snapshot.worktree,
        settings: entry_snapshot.settings,
    })
}

pub(crate) async fn list_workspace_files_core<F, T>(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    list_files: F,
) -> Result<T, String>
where
    F: Fn(&PathBuf) -> T,
{
    let root = resolve_workspace_root(workspaces, workspace_id).await?;
    Ok(list_files(&root))
}

pub(crate) async fn read_workspace_file_core<F, T>(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    path: &str,
    read_file: F,
) -> Result<T, String>
where
    F: Fn(&PathBuf, &str) -> Result<T, String>,
{
    let root = resolve_workspace_root(workspaces, workspace_id).await?;
    read_file(&root, path)
}

pub(crate) async fn write_workspace_file_core<F>(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    path: &str,
    content: &str,
    write_file: F,
) -> Result<(), String>
where
    F: Fn(&PathBuf, &str, &str) -> Result<(), String>,
{
    let root = resolve_workspace_root(workspaces, workspace_id).await?;
    write_file(&root, path, content)
}

pub(crate) async fn create_workspace_directory_core<F>(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    path: &str,
    create_directory: F,
) -> Result<(), String>
where
    F: Fn(&PathBuf, &str) -> Result<(), String>,
{
    let root = resolve_workspace_root(workspaces, workspace_id).await?;
    create_directory(&root, path)
}

pub(crate) async fn trash_workspace_item_core<F>(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    path: &str,
    trash_item: F,
) -> Result<(), String>
where
    F: Fn(&PathBuf, &str) -> Result<(), String>,
{
    let root = resolve_workspace_root(workspaces, workspace_id).await?;
    trash_item(&root, path)
}

pub(crate) async fn copy_workspace_item_core<F>(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    path: &str,
    copy_item: F,
) -> Result<String, String>
where
    F: Fn(&PathBuf, &str) -> Result<String, String>,
{
    let root = resolve_workspace_root(workspaces, workspace_id).await?;
    copy_item(&root, path)
}

fn sort_workspaces(workspaces: &mut [WorkspaceInfo]) {
    workspaces.sort_by(|a, b| {
        let a_order = a.settings.sort_order.unwrap_or(u32::MAX);
        let b_order = b.settings.sort_order.unwrap_or(u32::MAX);
        if a_order != b_order {
            return a_order.cmp(&b_order);
        }
        a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id))
    });
}

#[cfg(test)]
mod tests {
    use super::{
        connect_workspace_core, list_workspaces_core, normalize_workspace_display_name,
        resolve_base_ref_to_commit, validate_local_branch_name_for_worktree,
        workspace_name_from_path, workspace_requires_persistent_session,
    };
    use crate::types::{AppSettings, WorkspaceEntry, WorkspaceKind, WorkspaceSettings};
    use git2::{Repository, Signature};
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::Mutex;
    use uuid::Uuid;

    fn init_git_repo() -> PathBuf {
        let repo_path = std::env::temp_dir().join(format!("mossx-ws-core-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&repo_path).expect("create temp repo path");
        let repo = Repository::init(&repo_path).expect("init git repo");
        std::fs::write(repo_path.join("README.md"), "hello\n").expect("write fixture file");
        let mut index = repo.index().expect("open git index");
        index
            .add_path(Path::new("README.md"))
            .expect("add file to git index");
        let tree_id = index.write_tree().expect("write git tree");
        let tree = repo.find_tree(tree_id).expect("find git tree");
        let signature = Signature::now("ccgui", "test@ccgui.dev").expect("create signature");
        let commit_id = repo
            .commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .expect("commit initial tree");
        let commit = repo.find_commit(commit_id).expect("find committed object");
        repo.branch("main", &commit, true)
            .expect("create main branch");
        repo.set_head("refs/heads/main").expect("set head to main");
        repo_path
    }

    #[test]
    fn validate_local_branch_name_rejects_invalid_names() {
        assert!(validate_local_branch_name_for_worktree("feature/test").is_ok());
        assert!(validate_local_branch_name_for_worktree("feature invalid").is_err());
    }

    #[test]
    fn normalize_workspace_display_name_rebrands_legacy_name() {
        assert_eq!(
            normalize_workspace_display_name("codemoss", "/Users/test/Desktop/codemoss"),
            "ccgui"
        );
        assert_eq!(
            normalize_workspace_display_name("workspace", "/Users/test/Desktop/codemoss"),
            "ccgui"
        );
    }

    #[test]
    fn workspace_name_from_path_preserves_non_legacy_workspace_names() {
        assert_eq!(
            workspace_name_from_path("/Users/test/Desktop/ccgui"),
            "ccgui"
        );
        assert_eq!(
            workspace_name_from_path("/Users/test/Desktop/another-repo"),
            "another-repo"
        );
    }

    #[test]
    fn resolve_base_ref_to_commit_returns_commit_sha() {
        let repo_path = init_git_repo();
        let resolved = resolve_base_ref_to_commit(&repo_path, "main").expect("resolve main");
        assert_eq!(resolved.len(), 40);
    }

    #[test]
    fn resolve_base_ref_to_commit_rejects_missing_ref() {
        let repo_path = init_git_repo();
        let error = resolve_base_ref_to_commit(&repo_path, "missing/ref")
            .expect_err("missing ref should fail");
        assert!(error.contains("Base ref not found"));
    }

    fn workspace_entry(id: &str, engine_type: Option<&str>) -> WorkspaceEntry {
        let mut settings = WorkspaceSettings::default();
        settings.engine_type = engine_type.map(ToString::to_string);
        WorkspaceEntry {
            id: id.to_string(),
            name: id.to_string(),
            path: format!("/tmp/{id}"),
            codex_bin: None,
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings,
        }
    }

    #[test]
    fn workspace_requires_persistent_session_only_for_codex() {
        let codex = workspace_entry("ws-codex", Some("codex"));
        let claude = workspace_entry("ws-claude", Some("claude"));
        let gemini = workspace_entry("ws-gemini", Some("gemini"));
        let opencode = workspace_entry("ws-opencode", Some("opencode"));

        assert!(workspace_requires_persistent_session(&codex));
        assert!(!workspace_requires_persistent_session(&claude));
        assert!(!workspace_requires_persistent_session(&gemini));
        assert!(!workspace_requires_persistent_session(&opencode));
    }

    #[tokio::test]
    async fn list_workspaces_marks_non_persistent_engines_connected_without_sessions() {
        let mut workspace_map = HashMap::new();
        workspace_map.insert(
            "ws-gemini".to_string(),
            workspace_entry("ws-gemini", Some("gemini")),
        );
        workspace_map.insert(
            "ws-opencode".to_string(),
            workspace_entry("ws-opencode", Some("opencode")),
        );
        workspace_map.insert(
            "ws-codex".to_string(),
            workspace_entry("ws-codex", Some("codex")),
        );

        let workspaces = Mutex::new(workspace_map);
        let sessions: Mutex<HashMap<String, Arc<crate::backend::app_server::WorkspaceSession>>> =
            Mutex::new(HashMap::new());

        let rows = list_workspaces_core(&workspaces, &sessions).await;
        let by_id: HashMap<_, _> = rows.into_iter().map(|row| (row.id.clone(), row)).collect();

        assert!(by_id.get("ws-gemini").is_some_and(|row| row.connected));
        assert!(by_id.get("ws-opencode").is_some_and(|row| row.connected));
        assert!(by_id.get("ws-codex").is_some_and(|row| !row.connected));
    }

    #[tokio::test]
    async fn connect_workspace_without_runtime_manager_returns_spawn_error() {
        let mut workspace_map = HashMap::new();
        workspace_map.insert(
            "ws-codex".to_string(),
            workspace_entry("ws-codex", Some("codex")),
        );

        let workspaces = Mutex::new(workspace_map);
        let sessions: Mutex<HashMap<String, Arc<crate::backend::app_server::WorkspaceSession>>> =
            Mutex::new(HashMap::new());
        let app_settings = Mutex::new(AppSettings::default());

        let result = tokio::time::timeout(
            Duration::from_millis(100),
            connect_workspace_core(
                "ws-codex".to_string(),
                &workspaces,
                &sessions,
                &app_settings,
                None,
                "explicit-connect",
                false,
                |_entry, _default_bin, _codex_args, _codex_home| async {
                    Err("spawn failed".to_string())
                },
            ),
        )
        .await
        .expect("connect should not loop forever");

        assert_eq!(
            result.expect_err("spawn failure should surface"),
            "spawn failed"
        );
    }

    #[tokio::test]
    async fn explicit_connect_with_runtime_manager_does_not_loop_or_quarantine() {
        let mut workspace_map = HashMap::new();
        workspace_map.insert(
            "ws-codex".to_string(),
            workspace_entry("ws-codex", Some("codex")),
        );

        let workspaces = Mutex::new(workspace_map);
        let sessions: Mutex<HashMap<String, Arc<crate::backend::app_server::WorkspaceSession>>> =
            Mutex::new(HashMap::new());
        let app_settings = Mutex::new(AppSettings::default());
        let runtime_manager = Arc::new(crate::runtime::RuntimeManager::new(&std::env::temp_dir()));
        let spawn_attempts = Arc::new(AtomicUsize::new(0));

        let result = tokio::time::timeout(
            Duration::from_millis(100),
            connect_workspace_core(
                "ws-codex".to_string(),
                &workspaces,
                &sessions,
                &app_settings,
                Some(&runtime_manager),
                "explicit-connect",
                false,
                {
                    let spawn_attempts = Arc::clone(&spawn_attempts);
                    move |_entry, _default_bin, _codex_args, _codex_home| {
                        let spawn_attempts = Arc::clone(&spawn_attempts);
                        async move {
                            spawn_attempts.fetch_add(1, Ordering::SeqCst);
                            Err("spawn failed".to_string())
                        }
                    }
                },
            ),
        )
        .await
        .expect("explicit connect should fail fast without retry loop");

        assert_eq!(
            result.expect_err("spawn failure should surface"),
            "spawn failed"
        );
        assert_eq!(spawn_attempts.load(Ordering::SeqCst), 1);
        assert!(runtime_manager
            .recovery_quarantine_error("codex", "ws-codex")
            .await
            .is_none());
    }
}
