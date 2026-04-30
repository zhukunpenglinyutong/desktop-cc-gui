use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::engine;
use crate::local_usage;
use crate::shared::codex_core;
use crate::state::AppState;
use crate::storage::{read_json_file, write_json_file};
use crate::types::WorkspaceEntry;

const SESSION_CATALOG_DEFAULT_LIMIT: usize = 50;
const SESSION_CATALOG_MAX_LIMIT: usize = 200;
const SESSION_CATALOG_ARCHIVE_TIMEOUT_MS: u64 = 1_500;
const SESSION_CATALOG_CURSOR_PREFIX: &str = "offset:";
const SESSION_CATALOG_PARTIAL_CODEX: &str = "codex-history-unavailable";
const SESSION_CATALOG_PARTIAL_CLAUDE: &str = "claude-history-unavailable";
const SESSION_CATALOG_PARTIAL_GEMINI: &str = "gemini-history-unavailable";
const SESSION_CATALOG_PARTIAL_OPENCODE: &str = "opencode-history-unavailable";
const SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID: &str = "__global_unassigned__";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionCatalogEntry {
    pub(crate) session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) canonical_session_id: Option<String>,
    pub(crate) workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) workspace_label: Option<String>,
    pub(crate) engine: String,
    pub(crate) title: String,
    pub(crate) updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) archived_at: Option<i64>,
    pub(crate) thread_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) attribution_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) attribution_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) attribution_confidence: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) matched_workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) matched_workspace_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionCatalogQuery {
    #[serde(default)]
    pub(crate) keyword: Option<String>,
    #[serde(default)]
    pub(crate) engine: Option<String>,
    #[serde(default)]
    pub(crate) status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionCatalogPage {
    pub(crate) data: Vec<WorkspaceSessionCatalogEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) next_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) partial_source: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum WorkspaceSessionProjectionScopeKind {
    Project,
    Worktree,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionProjectionSummary {
    pub(crate) scope_kind: WorkspaceSessionProjectionScopeKind,
    pub(crate) owner_workspace_ids: Vec<String>,
    pub(crate) active_total: usize,
    pub(crate) archived_total: usize,
    pub(crate) all_total: usize,
    pub(crate) filtered_total: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) partial_sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionBatchMutationResult {
    pub(crate) session_id: String,
    pub(crate) ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) archived_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionBatchMutationResponse {
    pub(crate) results: Vec<WorkspaceSessionBatchMutationResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSessionCatalogMetadata {
    #[serde(default)]
    archived_at_by_session_id: HashMap<String, i64>,
}

#[derive(Debug, Clone)]
struct WorkspaceScopeCatalogData {
    scope_kind: WorkspaceSessionProjectionScopeKind,
    owner_workspace_ids: Vec<String>,
    entries: Vec<WorkspaceSessionCatalogEntry>,
    partial_sources: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SessionCatalogCountSummary {
    active_total: usize,
    archived_total: usize,
    all_total: usize,
    filtered_total: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionCatalogStatusFilter {
    Active,
    Archived,
    All,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionCatalogAttributionStatus {
    StrictMatch,
    InferredRelated,
    Unassigned,
}

impl SessionCatalogAttributionStatus {
    fn as_str(self) -> &'static str {
        match self {
            SessionCatalogAttributionStatus::StrictMatch => "strict-match",
            SessionCatalogAttributionStatus::InferredRelated => "inferred-related",
            SessionCatalogAttributionStatus::Unassigned => "unassigned",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionCatalogAttributionReason {
    SharedWorktreeFamily,
    SharedGitRoot,
    ParentScope,
}

impl SessionCatalogAttributionReason {
    fn as_str(self) -> &'static str {
        match self {
            SessionCatalogAttributionReason::SharedWorktreeFamily => "shared-worktree-family",
            SessionCatalogAttributionReason::SharedGitRoot => "shared-git-root",
            SessionCatalogAttributionReason::ParentScope => "parent-scope",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionCatalogAttributionConfidence {
    High,
    Medium,
}

impl SessionCatalogAttributionConfidence {
    fn as_str(self) -> &'static str {
        match self {
            SessionCatalogAttributionConfidence::High => "high",
            SessionCatalogAttributionConfidence::Medium => "medium",
        }
    }
}

#[derive(Debug, Clone)]
struct SessionCatalogAttribution {
    status: SessionCatalogAttributionStatus,
    reason: Option<SessionCatalogAttributionReason>,
    confidence: Option<SessionCatalogAttributionConfidence>,
    matched_workspace_id: Option<String>,
    matched_workspace_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SessionCatalogIdentity {
    Codex { session_id: String },
    Claude { session_id: String },
    Gemini { session_id: String },
    OpenCode { session_id: String },
    Shared { session_id: String },
}

#[tauri::command]
pub(crate) async fn list_workspace_sessions(
    workspace_id: String,
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    list_workspace_sessions_core(
        &state.workspaces,
        &state.sessions,
        &state.engine_manager,
        state.storage_path.as_path(),
        workspace_id,
        query,
        cursor,
        limit,
    )
    .await
}

#[tauri::command]
pub(crate) async fn list_global_codex_sessions(
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    list_global_codex_sessions_core(
        &state.workspaces,
        state.storage_path.as_path(),
        query,
        cursor,
        limit,
    )
    .await
}

#[tauri::command]
pub(crate) async fn list_project_related_codex_sessions(
    workspace_id: String,
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    list_project_related_codex_sessions_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id,
        query,
        cursor,
        limit,
    )
    .await
}

#[tauri::command]
pub(crate) async fn get_workspace_session_projection_summary(
    workspace_id: String,
    query: Option<WorkspaceSessionCatalogQuery>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionProjectionSummary, String> {
    get_workspace_session_projection_summary_core(
        &state.workspaces,
        &state.engine_manager,
        state.storage_path.as_path(),
        workspace_id,
        query,
    )
    .await
}

#[tauri::command]
pub(crate) async fn archive_workspace_sessions(
    workspace_id: String,
    session_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    archive_workspace_sessions_core(
        &state.workspaces,
        &state.sessions,
        state.storage_path.as_path(),
        workspace_id,
        session_ids,
    )
    .await
}

#[tauri::command]
pub(crate) async fn unarchive_workspace_sessions(
    workspace_id: String,
    session_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    unarchive_workspace_sessions_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id,
        session_ids,
    )
    .await
}

#[tauri::command]
pub(crate) async fn delete_workspace_sessions(
    workspace_id: String,
    session_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    delete_workspace_sessions_core(
        &state.workspaces,
        &state.sessions,
        &state.engine_manager,
        state.storage_path.as_path(),
        workspace_id,
        session_ids,
    )
    .await
}

pub(crate) async fn list_workspace_sessions_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    _sessions: &Mutex<HashMap<String, std::sync::Arc<crate::codex::WorkspaceSession>>>,
    engine_manager: &engine::EngineManager,
    storage_path: &Path,
    workspace_id: String,
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    let scope_catalog =
        build_workspace_scope_catalog_data(workspaces, engine_manager, storage_path, &workspace_id)
            .await?;
    Ok(build_catalog_page(
        scope_catalog.entries,
        query.unwrap_or_default(),
        cursor,
        limit,
        join_partial_sources(scope_catalog.partial_sources),
    ))
}

pub(crate) async fn get_workspace_session_projection_summary_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    engine_manager: &engine::EngineManager,
    storage_path: &Path,
    workspace_id: String,
    query: Option<WorkspaceSessionCatalogQuery>,
) -> Result<WorkspaceSessionProjectionSummary, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    let scope_catalog =
        build_workspace_scope_catalog_data(workspaces, engine_manager, storage_path, &workspace_id)
            .await?;
    let normalized_query = query.unwrap_or_default();
    let counts = build_catalog_count_summary(&scope_catalog.entries, &normalized_query);
    Ok(WorkspaceSessionProjectionSummary {
        scope_kind: scope_catalog.scope_kind,
        owner_workspace_ids: scope_catalog.owner_workspace_ids,
        active_total: counts.active_total,
        archived_total: counts.archived_total,
        all_total: counts.all_total,
        filtered_total: counts.filtered_total,
        partial_sources: scope_catalog.partial_sources,
    })
}

pub(crate) async fn list_global_codex_sessions_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    let entries = build_global_codex_catalog_entries(workspaces, storage_path).await?;

    Ok(build_catalog_page(
        entries,
        query.unwrap_or_default(),
        cursor,
        limit,
        None,
    ))
}

pub(crate) async fn list_project_related_codex_sessions_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    let workspaces_snapshot = workspaces.lock().await.clone();
    let selected_workspace = workspaces_snapshot
        .get(&workspace_id)
        .cloned()
        .ok_or_else(|| "workspace not found".to_string())?;
    let workspace_scope = catalog_workspace_scope(workspaces, &workspace_id).await?;
    let strict_scope_ids = workspace_scope
        .iter()
        .map(|workspace| workspace.id.clone())
        .collect::<HashSet<_>>();

    let related_entries = build_global_codex_catalog_entries(workspaces, storage_path)
        .await?
        .into_iter()
        .filter_map(|entry| {
            if strict_scope_ids.contains(&entry.workspace_id) {
                return None;
            }
            let attribution = infer_related_attribution_for_workspace(
                &workspaces_snapshot,
                &selected_workspace,
                &entry,
            )?;
            if attribution.status != SessionCatalogAttributionStatus::InferredRelated {
                return None;
            }
            Some(apply_attribution_to_entry(entry, attribution))
        })
        .collect::<Vec<_>>();

    Ok(build_catalog_page(
        related_entries,
        query.unwrap_or_default(),
        cursor,
        limit,
        None,
    ))
}

async fn catalog_workspace_scope(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<Vec<WorkspaceEntry>, String> {
    let workspaces = workspaces.lock().await;
    let selected = workspaces
        .get(workspace_id)
        .cloned()
        .ok_or_else(|| "workspace not found".to_string())?;
    if selected.kind.is_worktree() {
        return Ok(vec![selected]);
    }

    let mut scoped = vec![selected.clone()];
    let mut children: Vec<WorkspaceEntry> = workspaces
        .values()
        .filter(|entry| entry.parent_id.as_deref() == Some(workspace_id))
        .cloned()
        .collect();
    children.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.id.cmp(&right.id))
    });
    scoped.extend(children);
    Ok(scoped)
}

pub(crate) async fn archive_workspace_sessions_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, std::sync::Arc<crate::codex::WorkspaceSession>>>,
    storage_path: &Path,
    workspace_id: String,
    session_ids: Vec<String>,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    let _workspace_path = workspace_path_for_id(workspaces, &workspace_id).await?;
    let mut metadata = read_catalog_metadata(storage_path, &workspace_id)?;
    let archived_at = now_millis();
    let mut results = Vec::new();

    for session_id in normalize_session_ids(session_ids)? {
        match parse_catalog_identity(&session_id) {
            SessionCatalogIdentity::Shared { .. } => {
                results.push(batch_error(
                    session_id,
                    "UNSUPPORTED_SHARED_SESSION",
                    "Shared sessions are not supported in phase-one archive management",
                ));
            }
            SessionCatalogIdentity::Codex { session_id: raw_id } => {
                let _ = codex_core::archive_thread_best_effort_core(
                    sessions,
                    workspace_id.clone(),
                    raw_id,
                    Duration::from_millis(SESSION_CATALOG_ARCHIVE_TIMEOUT_MS),
                )
                .await;
                metadata
                    .archived_at_by_session_id
                    .insert(session_id.clone(), archived_at);
                results.push(batch_success(session_id, Some(archived_at)));
            }
            _ => {
                metadata
                    .archived_at_by_session_id
                    .insert(session_id.clone(), archived_at);
                results.push(batch_success(session_id, Some(archived_at)));
            }
        }
    }

    write_catalog_metadata(storage_path, &workspace_id, &metadata)?;
    Ok(WorkspaceSessionBatchMutationResponse { results })
}

pub(crate) async fn unarchive_workspace_sessions_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
    session_ids: Vec<String>,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    let _workspace_path = workspace_path_for_id(workspaces, &workspace_id).await?;
    let mut metadata = read_catalog_metadata(storage_path, &workspace_id)?;
    let mut results = Vec::new();

    for session_id in normalize_session_ids(session_ids)? {
        if metadata
            .archived_at_by_session_id
            .remove(&session_id)
            .is_some()
        {
            results.push(batch_success(session_id, None));
        } else {
            results.push(batch_error(
                session_id,
                "NOT_ARCHIVED",
                "Session is not archived",
            ));
        }
    }

    write_catalog_metadata(storage_path, &workspace_id, &metadata)?;
    Ok(WorkspaceSessionBatchMutationResponse { results })
}

pub(crate) async fn delete_workspace_sessions_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, std::sync::Arc<crate::codex::WorkspaceSession>>>,
    engine_manager: &engine::EngineManager,
    storage_path: &Path,
    workspace_id: String,
    session_ids: Vec<String>,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    let workspace_path = workspace_path_for_id(workspaces, &workspace_id).await?;
    let mut metadata = read_catalog_metadata(storage_path, &workspace_id)?;
    let normalized_session_ids = normalize_session_ids(session_ids)?;
    let ordered_session_ids = normalized_session_ids.clone();
    let mut results = Vec::new();

    let mut codex_session_ids = Vec::new();
    let mut other_identities = Vec::new();

    for session_id in normalized_session_ids {
        match parse_catalog_identity(&session_id) {
            SessionCatalogIdentity::Codex { session_id: raw_id } => {
                codex_session_ids.push((session_id, raw_id));
            }
            identity => other_identities.push((session_id, identity)),
        }
    }

    let mut results_by_session_id: HashMap<String, WorkspaceSessionBatchMutationResult> =
        HashMap::new();

    if !codex_session_ids.is_empty() {
        let raw_ids: Vec<String> = codex_session_ids
            .iter()
            .map(|(_, raw_id)| raw_id.clone())
            .collect();
        let delete_results =
            local_usage::delete_codex_sessions_for_workspace(workspaces, &workspace_id, &raw_ids)
                .await?;
        let results_by_raw_id: HashMap<_, _> = delete_results
            .into_iter()
            .map(|result| (result.session_id.clone(), result))
            .collect();

        for (session_id, raw_id) in codex_session_ids {
            match results_by_raw_id.get(&raw_id) {
                Some(result) if result.deleted => {
                    metadata.archived_at_by_session_id.remove(&session_id);
                    results_by_session_id
                        .insert(session_id.clone(), batch_success(session_id, None));
                }
                Some(result)
                    if result
                        .error
                        .as_deref()
                        .map(should_settle_delete_as_success)
                        .unwrap_or(false) =>
                {
                    metadata.archived_at_by_session_id.remove(&session_id);
                    results_by_session_id
                        .insert(session_id.clone(), batch_success(session_id, None));
                }
                Some(result) => {
                    results_by_session_id.insert(
                        session_id.clone(),
                        batch_error(
                            session_id,
                            "DELETE_FAILED",
                            result
                                .error
                                .as_deref()
                                .unwrap_or("Failed to delete Codex session"),
                        ),
                    );
                }
                None => {
                    results_by_session_id.insert(
                        session_id.clone(),
                        batch_error(session_id, "DELETE_FAILED", "Missing Codex delete result"),
                    );
                }
            }
        }
    }

    let gemini_home_dir = engine_manager
        .get_engine_config(engine::EngineType::Gemini)
        .await
        .and_then(|item| item.home_dir);
    let mut async_delete_handles: Vec<(String, JoinHandle<Result<(), String>>)> = Vec::new();

    for (session_id, identity) in other_identities {
        match identity {
            SessionCatalogIdentity::Claude { session_id: raw_id } => {
                let workspace_path = workspace_path.clone();
                let session_id_for_handle = session_id.clone();
                let handle = tokio::spawn(async move {
                    engine::claude_history::delete_claude_session(&workspace_path, &raw_id)
                        .await
                        .map(|_| ())
                });
                async_delete_handles.push((session_id_for_handle, handle));
            }
            SessionCatalogIdentity::Gemini { session_id: raw_id } => {
                let workspace_path = workspace_path.clone();
                let gemini_home_dir = gemini_home_dir.clone();
                let session_id_for_handle = session_id.clone();
                let handle = tokio::spawn(async move {
                    engine::gemini_history::delete_gemini_session(
                        &workspace_path,
                        &raw_id,
                        gemini_home_dir.as_deref(),
                    )
                    .await
                });
                async_delete_handles.push((session_id_for_handle, handle));
            }
            SessionCatalogIdentity::OpenCode { session_id: raw_id } => {
                let deletion = engine::commands::opencode_delete_session_core(
                    workspaces,
                    engine_manager,
                    &workspace_id,
                    &raw_id,
                )
                .await
                .map(|_| ());
                match deletion {
                    Ok(()) => {
                        metadata.archived_at_by_session_id.remove(&session_id);
                        results_by_session_id
                            .insert(session_id.clone(), batch_success(session_id, None));
                    }
                    Err(error) => {
                        if should_settle_delete_as_success(&error) {
                            metadata.archived_at_by_session_id.remove(&session_id);
                            results_by_session_id
                                .insert(session_id.clone(), batch_success(session_id, None));
                        } else {
                            results_by_session_id.insert(
                                session_id.clone(),
                                batch_error(session_id, "DELETE_FAILED", &error),
                            );
                        }
                    }
                }
            }
            SessionCatalogIdentity::Shared { .. } => {
                results_by_session_id.insert(
                    session_id.clone(),
                    batch_error(
                        session_id,
                        "DELETE_FAILED",
                        "Shared sessions are not supported in phase-one delete management",
                    ),
                );
            }
            SessionCatalogIdentity::Codex { .. } => unreachable!(),
        }
    }

    for (session_id, handle) in async_delete_handles {
        match handle.await {
            Ok(Ok(())) => {
                metadata.archived_at_by_session_id.remove(&session_id);
                results_by_session_id.insert(session_id.clone(), batch_success(session_id, None));
            }
            Ok(Err(error)) => {
                if should_settle_delete_as_success(&error) {
                    metadata.archived_at_by_session_id.remove(&session_id);
                    results_by_session_id
                        .insert(session_id.clone(), batch_success(session_id, None));
                } else {
                    results_by_session_id.insert(
                        session_id.clone(),
                        batch_error(session_id, "DELETE_FAILED", &error),
                    );
                }
            }
            Err(error) => {
                log::warn!(
                    "[session_management.delete_workspace_sessions] async delete task join error for workspace {}: {}",
                    workspace_id,
                    error
                );
                results_by_session_id.insert(
                    session_id.clone(),
                    batch_error(session_id, "DELETE_FAILED", "Async delete task join error"),
                );
            }
        }
    }

    for session_id in ordered_session_ids {
        if let Some(result) = results_by_session_id.remove(&session_id) {
            results.push(result);
        }
    }

    write_catalog_metadata(storage_path, &workspace_id, &metadata)?;
    let _ = sessions;
    Ok(WorkspaceSessionBatchMutationResponse { results })
}

fn batch_success(
    session_id: String,
    archived_at: Option<i64>,
) -> WorkspaceSessionBatchMutationResult {
    WorkspaceSessionBatchMutationResult {
        session_id,
        ok: true,
        archived_at,
        error: None,
        code: None,
    }
}

fn batch_error(session_id: String, code: &str, error: &str) -> WorkspaceSessionBatchMutationResult {
    WorkspaceSessionBatchMutationResult {
        session_id,
        ok: false,
        archived_at: None,
        error: Some(error.to_string()),
        code: Some(code.to_string()),
    }
}

fn should_settle_delete_as_success(error: &str) -> bool {
    let normalized = error.trim().to_ascii_lowercase();
    if normalized.contains("invalid claude session id")
        || normalized.contains("invalid gemini session id")
        || normalized.contains("invalid opencode session id")
    {
        return false;
    }
    normalized.contains("session file not found")
        || normalized.contains("session not found")
        || normalized.contains("thread not found")
}

fn normalize_workspace_id(workspace_id: &str) -> Result<String, String> {
    let normalized = workspace_id.trim();
    if normalized.is_empty() {
        return Err("workspace_id is required".to_string());
    }
    Ok(normalized.to_string())
}

fn normalize_session_ids(session_ids: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for session_id in session_ids {
        let trimmed = session_id.trim();
        if trimmed.is_empty() {
            return Err("session_ids must not contain empty values".to_string());
        }
        if is_invalid_session_path_segment(trimmed) {
            return Err("invalid session_id".to_string());
        }
        if seen.insert(trimmed.to_string()) {
            normalized.push(trimmed.to_string());
        }
    }
    Ok(normalized)
}

fn is_invalid_session_path_segment(session_id: &str) -> bool {
    session_id == "."
        || session_id.contains('/')
        || session_id.contains('\\')
        || session_id.contains("..")
}

async fn workspace_path_for_id(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    let workspaces = workspaces.lock().await;
    workspaces
        .get(workspace_id)
        .map(|entry| PathBuf::from(&entry.path))
        .ok_or_else(|| "workspace not found".to_string())
}

fn build_catalog_entry_dedupe_key(entry: &WorkspaceSessionCatalogEntry) -> String {
    format!(
        "{}::{}::{}",
        entry.engine, entry.workspace_id, entry.session_id
    )
}

fn should_replace_global_entry(
    current: &WorkspaceSessionCatalogEntry,
    candidate: &WorkspaceSessionCatalogEntry,
) -> bool {
    let current_resolved = current.workspace_id != SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID;
    let candidate_resolved = candidate.workspace_id != SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID;
    if current_resolved != candidate_resolved {
        return candidate_resolved;
    }
    candidate.updated_at > current.updated_at
}

fn parse_catalog_identity(session_id: &str) -> SessionCatalogIdentity {
    if let Some(raw_id) = session_id.strip_prefix("claude:") {
        return SessionCatalogIdentity::Claude {
            session_id: raw_id.to_string(),
        };
    }
    if let Some(raw_id) = session_id.strip_prefix("gemini:") {
        return SessionCatalogIdentity::Gemini {
            session_id: raw_id.to_string(),
        };
    }
    if let Some(raw_id) = session_id.strip_prefix("opencode:") {
        return SessionCatalogIdentity::OpenCode {
            session_id: raw_id.to_string(),
        };
    }
    if let Some(raw_id) = session_id.strip_prefix("shared:") {
        return SessionCatalogIdentity::Shared {
            session_id: raw_id.to_string(),
        };
    }
    SessionCatalogIdentity::Codex {
        session_id: session_id.to_string(),
    }
}

fn catalog_metadata_path(storage_path: &Path, workspace_id: &str) -> Result<PathBuf, String> {
    let data_dir = storage_path
        .parent()
        .ok_or_else(|| format!("storage path has no parent: {}", storage_path.display()))?;
    Ok(data_dir
        .join("session-management")
        .join("workspaces")
        .join(format!("{workspace_id}.json")))
}

fn read_catalog_metadata(
    storage_path: &Path,
    workspace_id: &str,
) -> Result<WorkspaceSessionCatalogMetadata, String> {
    let path = catalog_metadata_path(storage_path, workspace_id)?;
    Ok(read_json_file::<WorkspaceSessionCatalogMetadata>(&path)?.unwrap_or_default())
}

fn read_catalog_metadata_for_scope(
    storage_path: &Path,
    workspaces: &[WorkspaceEntry],
) -> Result<HashMap<String, WorkspaceSessionCatalogMetadata>, String> {
    let mut metadata_by_workspace_id = HashMap::new();
    for workspace in workspaces {
        metadata_by_workspace_id.insert(
            workspace.id.clone(),
            read_catalog_metadata(storage_path, &workspace.id)?,
        );
    }
    Ok(metadata_by_workspace_id)
}

fn write_catalog_metadata(
    storage_path: &Path,
    workspace_id: &str,
    metadata: &WorkspaceSessionCatalogMetadata,
) -> Result<(), String> {
    let path = catalog_metadata_path(storage_path, workspace_id)?;
    write_json_file(&path, metadata)
}

fn parse_status_filter(value: Option<&str>) -> SessionCatalogStatusFilter {
    match value
        .map(str::trim)
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "archived" => SessionCatalogStatusFilter::Archived,
        "all" => SessionCatalogStatusFilter::All,
        _ => SessionCatalogStatusFilter::Active,
    }
}

fn parse_catalog_cursor(cursor: Option<&str>) -> usize {
    let Some(raw_cursor) = cursor.map(str::trim).filter(|value| !value.is_empty()) else {
        return 0;
    };
    if let Some(raw_offset) = raw_cursor.strip_prefix(SESSION_CATALOG_CURSOR_PREFIX) {
        return raw_offset.parse::<usize>().unwrap_or(0);
    }
    raw_cursor.parse::<usize>().unwrap_or(0)
}

fn build_catalog_cursor(offset: usize) -> String {
    format!("{SESSION_CATALOG_CURSOR_PREFIX}{offset}")
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as i64
}

fn join_partial_sources(partial_sources: Vec<String>) -> Option<String> {
    let deduped = normalize_partial_sources(partial_sources);
    if deduped.is_empty() {
        None
    } else {
        Some(deduped.join(","))
    }
}

fn normalize_partial_sources(partial_sources: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for partial_source in partial_sources {
        let normalized = partial_source.trim();
        if normalized.is_empty() {
            continue;
        }
        if seen.insert(normalized.to_string()) {
            deduped.push(normalized.to_string());
        }
    }
    deduped
}

async fn build_global_codex_catalog_entries(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
) -> Result<Vec<WorkspaceSessionCatalogEntry>, String> {
    let global_summaries =
        local_usage::list_global_codex_session_summaries(workspaces, usize::MAX).await?;
    let workspaces_snapshot = workspaces.lock().await.clone();
    let metadata_by_workspace_id = read_catalog_metadata_for_scope(
        storage_path,
        &workspaces_snapshot.values().cloned().collect::<Vec<_>>(),
    )?;

    let mut deduped = HashMap::<String, WorkspaceSessionCatalogEntry>::new();
    for summary in global_summaries {
        let entry = build_global_codex_catalog_entry(
            &summary,
            &workspaces_snapshot,
            &metadata_by_workspace_id,
        );
        let dedupe_key = format!("{}::{}", entry.engine, entry.session_id);
        match deduped.get(&dedupe_key) {
            Some(existing) if !should_replace_global_entry(existing, &entry) => {}
            _ => {
                deduped.insert(dedupe_key, entry);
            }
        }
    }

    Ok(deduped.into_values().collect())
}

fn build_global_codex_catalog_entry(
    summary: &crate::types::LocalUsageSessionSummary,
    workspaces_snapshot: &HashMap<String, WorkspaceEntry>,
    metadata_by_workspace_id: &HashMap<String, WorkspaceSessionCatalogMetadata>,
) -> WorkspaceSessionCatalogEntry {
    let owner_workspace = local_usage::find_best_matching_workspace_for_cwd(
        workspaces_snapshot,
        summary.cwd.as_deref(),
    );
    let workspace_id = owner_workspace
        .map(|workspace| workspace.id.clone())
        .unwrap_or_else(|| SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID.to_string());
    let workspace_label = owner_workspace.map(|workspace| workspace.name.clone());
    let archived_at = owner_workspace.and_then(|workspace| {
        metadata_by_workspace_id
            .get(&workspace.id)
            .and_then(|metadata| metadata.archived_at_by_session_id.get(&summary.session_id))
            .copied()
    });
    let source_label = build_source_label(summary.source.as_deref(), summary.provider.as_deref());
    let attribution_status = if owner_workspace.is_some() {
        Some(
            SessionCatalogAttributionStatus::StrictMatch
                .as_str()
                .to_string(),
        )
    } else {
        Some(
            SessionCatalogAttributionStatus::Unassigned
                .as_str()
                .to_string(),
        )
    };

    WorkspaceSessionCatalogEntry {
        session_id: summary.session_id.clone(),
        canonical_session_id: Some(summary.session_id.clone()),
        workspace_id,
        workspace_label,
        engine: "codex".to_string(),
        title: summary
            .summary
            .clone()
            .unwrap_or_else(|| "Codex Session".to_string()),
        updated_at: summary.timestamp.max(0),
        archived_at,
        thread_kind: "native".to_string(),
        source: summary.source.clone(),
        source_label,
        size_bytes: summary.file_size_bytes,
        cwd: summary.cwd.clone(),
        attribution_status,
        attribution_reason: None,
        attribution_confidence: None,
        matched_workspace_id: owner_workspace.map(|workspace| workspace.id.clone()),
        matched_workspace_label: owner_workspace.map(|workspace| workspace.name.clone()),
    }
}

fn apply_attribution_to_entry(
    mut entry: WorkspaceSessionCatalogEntry,
    attribution: SessionCatalogAttribution,
) -> WorkspaceSessionCatalogEntry {
    entry.attribution_status = Some(attribution.status.as_str().to_string());
    entry.attribution_reason = attribution.reason.map(|reason| reason.as_str().to_string());
    entry.attribution_confidence = attribution
        .confidence
        .map(|confidence| confidence.as_str().to_string());
    entry.matched_workspace_id = attribution.matched_workspace_id;
    entry.matched_workspace_label = attribution.matched_workspace_label;
    entry
}

fn infer_related_attribution_for_workspace(
    workspaces: &HashMap<String, WorkspaceEntry>,
    selected_workspace: &WorkspaceEntry,
    entry: &WorkspaceSessionCatalogEntry,
) -> Option<SessionCatalogAttribution> {
    let entry_cwd = entry.cwd.as_deref();
    let owner_workspace = workspaces.get(&entry.workspace_id);
    if let Some(owner_workspace) = owner_workspace {
        if is_same_workspace_family(selected_workspace, owner_workspace) {
            return Some(SessionCatalogAttribution {
                status: SessionCatalogAttributionStatus::InferredRelated,
                reason: Some(SessionCatalogAttributionReason::SharedWorktreeFamily),
                confidence: Some(SessionCatalogAttributionConfidence::High),
                matched_workspace_id: Some(selected_workspace.id.clone()),
                matched_workspace_label: Some(selected_workspace.name.clone()),
            });
        }
    }

    let cwd = entry_cwd?;
    if selected_workspace.kind.is_worktree() {
        if let Some(parent_workspace) = selected_workspace
            .parent_id
            .as_ref()
            .and_then(|parent_id| workspaces.get(parent_id))
        {
            if local_usage::path_matches_workspace(cwd, Path::new(&parent_workspace.path)) {
                let family_candidates = workspaces
                    .values()
                    .filter(|candidate| {
                        candidate.parent_id.as_deref() == Some(parent_workspace.id.as_str())
                    })
                    .count();
                if family_candidates <= 1 {
                    return Some(SessionCatalogAttribution {
                        status: SessionCatalogAttributionStatus::InferredRelated,
                        reason: Some(SessionCatalogAttributionReason::ParentScope),
                        confidence: Some(SessionCatalogAttributionConfidence::Medium),
                        matched_workspace_id: Some(selected_workspace.id.clone()),
                        matched_workspace_label: Some(selected_workspace.name.clone()),
                    });
                }
            }
        }
    }

    let selected_git_root = selected_workspace.settings.git_root.as_deref()?;
    if !local_usage::path_matches_workspace(cwd, Path::new(selected_git_root)) {
        return None;
    }
    let matching_git_root_families = workspaces
        .values()
        .filter(|candidate| {
            candidate
                .settings
                .git_root
                .as_deref()
                .map(|git_root| local_usage::path_matches_workspace(cwd, Path::new(git_root)))
                .unwrap_or(false)
        })
        .map(|candidate| workspace_family_key(candidate))
        .collect::<HashSet<_>>();
    if matching_git_root_families.len() != 1
        || !matching_git_root_families.contains(&workspace_family_key(selected_workspace))
    {
        return None;
    }

    Some(SessionCatalogAttribution {
        status: SessionCatalogAttributionStatus::InferredRelated,
        reason: Some(SessionCatalogAttributionReason::SharedGitRoot),
        confidence: Some(SessionCatalogAttributionConfidence::Medium),
        matched_workspace_id: Some(selected_workspace.id.clone()),
        matched_workspace_label: Some(selected_workspace.name.clone()),
    })
}

fn workspace_family_key(workspace: &WorkspaceEntry) -> String {
    if workspace.kind.is_worktree() {
        workspace
            .parent_id
            .clone()
            .unwrap_or_else(|| workspace.id.clone())
    } else {
        workspace.id.clone()
    }
}

fn is_same_workspace_family(left: &WorkspaceEntry, right: &WorkspaceEntry) -> bool {
    workspace_family_key(left) == workspace_family_key(right)
}

fn build_source_label(source: Option<&str>, provider: Option<&str>) -> Option<String> {
    match (
        source.map(str::trim).filter(|value| !value.is_empty()),
        provider.map(str::trim).filter(|value| !value.is_empty()),
    ) {
        (Some(source), Some(provider)) => Some(format!("{source}/{provider}")),
        (Some(source), None) => Some(source.to_string()),
        (None, Some(provider)) => Some(provider.to_string()),
        (None, None) => None,
    }
}

fn entry_matches_keyword(entry: &WorkspaceSessionCatalogEntry, keyword: &str) -> bool {
    let title = entry.title.to_lowercase();
    let session_id = entry.session_id.to_lowercase();
    let source = entry
        .source
        .as_deref()
        .map(str::to_lowercase)
        .unwrap_or_default();
    let source_label = entry
        .source_label
        .as_deref()
        .map(str::to_lowercase)
        .unwrap_or_default();
    let workspace_label = entry
        .workspace_label
        .as_deref()
        .map(str::to_lowercase)
        .unwrap_or_default();
    title.contains(keyword)
        || session_id.contains(keyword)
        || source.contains(keyword)
        || source_label.contains(keyword)
        || workspace_label.contains(keyword)
}

fn entry_matches_engine_and_keyword(
    entry: &WorkspaceSessionCatalogEntry,
    engine_filter: Option<&str>,
    keyword: Option<&str>,
) -> bool {
    if let Some(filter) = engine_filter {
        if entry.engine != filter {
            return false;
        }
    }
    if let Some(keyword) = keyword {
        return entry_matches_keyword(entry, keyword);
    }
    true
}

fn entry_matches_status(
    entry: &WorkspaceSessionCatalogEntry,
    status_filter: SessionCatalogStatusFilter,
) -> bool {
    match status_filter {
        SessionCatalogStatusFilter::Active => entry.archived_at.is_none(),
        SessionCatalogStatusFilter::Archived => entry.archived_at.is_some(),
        SessionCatalogStatusFilter::All => true,
    }
}

fn build_catalog_count_summary(
    entries: &[WorkspaceSessionCatalogEntry],
    query: &WorkspaceSessionCatalogQuery,
) -> SessionCatalogCountSummary {
    let status_filter = parse_status_filter(query.status.as_deref());
    let keyword = query
        .keyword
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase());
    let engine_filter = query
        .engine
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase());

    let mut counts = SessionCatalogCountSummary {
        active_total: 0,
        archived_total: 0,
        all_total: 0,
        filtered_total: 0,
    };

    for entry in entries {
        if !entry_matches_engine_and_keyword(entry, engine_filter.as_deref(), keyword.as_deref()) {
            continue;
        }
        counts.all_total += 1;
        if entry.archived_at.is_some() {
            counts.archived_total += 1;
        } else {
            counts.active_total += 1;
        }
        if entry_matches_status(entry, status_filter) {
            counts.filtered_total += 1;
        }
    }

    counts
}

fn build_catalog_page(
    entries: Vec<WorkspaceSessionCatalogEntry>,
    query: WorkspaceSessionCatalogQuery,
    cursor: Option<String>,
    limit: Option<u32>,
    partial_source: Option<String>,
) -> WorkspaceSessionCatalogPage {
    let status_filter = parse_status_filter(query.status.as_deref());
    let keyword = query
        .keyword
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase());
    let engine_filter = query
        .engine
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase());

    let mut filtered: Vec<WorkspaceSessionCatalogEntry> = entries
        .into_iter()
        .filter(|entry| {
            entry_matches_engine_and_keyword(entry, engine_filter.as_deref(), keyword.as_deref())
                && entry_matches_status(entry, status_filter)
        })
        .collect();

    filtered.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.session_id.cmp(&right.session_id))
            .then_with(|| left.workspace_id.cmp(&right.workspace_id))
    });

    let limit = limit
        .unwrap_or(SESSION_CATALOG_DEFAULT_LIMIT as u32)
        .clamp(1, SESSION_CATALOG_MAX_LIMIT as u32) as usize;
    let offset = parse_catalog_cursor(cursor.as_deref());
    let data: Vec<WorkspaceSessionCatalogEntry> =
        filtered.iter().skip(offset).take(limit).cloned().collect();
    let next_cursor = if offset + data.len() < filtered.len() {
        Some(build_catalog_cursor(offset + data.len()))
    } else {
        None
    };

    WorkspaceSessionCatalogPage {
        data,
        next_cursor,
        partial_source,
    }
}

async fn build_workspace_scope_catalog_data(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    engine_manager: &engine::EngineManager,
    storage_path: &Path,
    workspace_id: &str,
) -> Result<WorkspaceScopeCatalogData, String> {
    let workspace_scope = catalog_workspace_scope(workspaces, workspace_id).await?;
    let metadata_by_workspace_id = read_catalog_metadata_for_scope(storage_path, &workspace_scope)?;
    let mut partial_sources = Vec::new();
    let mut entries = Vec::new();
    let scope_kind = workspace_scope
        .first()
        .map(|workspace| {
            if workspace.kind.is_worktree() {
                WorkspaceSessionProjectionScopeKind::Worktree
            } else {
                WorkspaceSessionProjectionScopeKind::Project
            }
        })
        .unwrap_or(WorkspaceSessionProjectionScopeKind::Project);
    let owner_workspace_ids = workspace_scope
        .iter()
        .map(|workspace| workspace.id.clone())
        .collect::<Vec<_>>();

    let gemini_config = engine_manager
        .get_engine_config(engine::EngineType::Gemini)
        .await;
    for workspace in &workspace_scope {
        let owner_workspace_id = workspace.id.clone();
        let owner_workspace_path = PathBuf::from(&workspace.path);
        let owner_metadata = metadata_by_workspace_id
            .get(&owner_workspace_id)
            .cloned()
            .unwrap_or_default();

        match local_usage::list_codex_session_summaries_for_workspace(
            workspaces,
            &owner_workspace_id,
            usize::MAX,
        )
        .await
        {
            Ok((_, sessions)) => {
                entries.extend(sessions.into_iter().map(|summary| {
                    let session_id = summary.session_id.clone();
                    let archived_at = owner_metadata
                        .archived_at_by_session_id
                        .get(&session_id)
                        .copied();
                    let source_label =
                        build_source_label(summary.source.as_deref(), summary.provider.as_deref());
                    WorkspaceSessionCatalogEntry {
                        session_id,
                        canonical_session_id: Some(summary.session_id.clone()),
                        workspace_id: owner_workspace_id.clone(),
                        workspace_label: Some(workspace.name.clone()),
                        engine: "codex".to_string(),
                        title: summary
                            .summary
                            .unwrap_or_else(|| "Codex Session".to_string()),
                        updated_at: summary.timestamp.max(0),
                        archived_at,
                        thread_kind: "native".to_string(),
                        source: summary.source,
                        source_label,
                        size_bytes: summary.file_size_bytes,
                        cwd: summary.cwd,
                        attribution_status: Some(
                            SessionCatalogAttributionStatus::StrictMatch
                                .as_str()
                                .to_string(),
                        ),
                        attribution_reason: None,
                        attribution_confidence: None,
                        matched_workspace_id: Some(owner_workspace_id.clone()),
                        matched_workspace_label: Some(workspace.name.clone()),
                    }
                }));
            }
            Err(error) => {
                log::warn!(
                    "[session_management.list_workspace_sessions] codex history unavailable for workspace {}: {}",
                    owner_workspace_id,
                    error
                );
                partial_sources.push(SESSION_CATALOG_PARTIAL_CODEX.to_string());
            }
        }

        match engine::claude_history::list_claude_sessions(&owner_workspace_path, None).await {
            Ok(claude_sessions) => {
                entries.extend(claude_sessions.into_iter().map(|session| {
                    let session_id = format!("claude:{}", session.session_id);
                    WorkspaceSessionCatalogEntry {
                        archived_at: owner_metadata
                            .archived_at_by_session_id
                            .get(&session_id)
                            .copied(),
                        session_id,
                        canonical_session_id: Some(session.session_id.clone()),
                        workspace_id: owner_workspace_id.clone(),
                        workspace_label: Some(workspace.name.clone()),
                        engine: "claude".to_string(),
                        title: session.first_message,
                        updated_at: session.updated_at.max(0),
                        thread_kind: "native".to_string(),
                        source: None,
                        source_label: None,
                        size_bytes: session.file_size_bytes,
                        cwd: None,
                        attribution_status: Some(
                            SessionCatalogAttributionStatus::StrictMatch
                                .as_str()
                                .to_string(),
                        ),
                        attribution_reason: None,
                        attribution_confidence: None,
                        matched_workspace_id: Some(owner_workspace_id.clone()),
                        matched_workspace_label: Some(workspace.name.clone()),
                    }
                }));
            }
            Err(error) => {
                log::warn!(
                    "[session_management.list_workspace_sessions] claude history unavailable for workspace {}: {}",
                    owner_workspace_id,
                    error
                );
                partial_sources.push(SESSION_CATALOG_PARTIAL_CLAUDE.to_string());
            }
        }

        match engine::gemini_history::list_gemini_sessions(
            &owner_workspace_path,
            None,
            gemini_config
                .as_ref()
                .and_then(|item| item.home_dir.as_deref()),
        )
        .await
        {
            Ok(gemini_sessions) => {
                entries.extend(gemini_sessions.into_iter().map(|session| {
                    let session_id = format!("gemini:{}", session.session_id);
                    WorkspaceSessionCatalogEntry {
                        archived_at: owner_metadata
                            .archived_at_by_session_id
                            .get(&session_id)
                            .copied(),
                        session_id,
                        canonical_session_id: Some(session.session_id.clone()),
                        workspace_id: owner_workspace_id.clone(),
                        workspace_label: Some(workspace.name.clone()),
                        engine: "gemini".to_string(),
                        title: session.first_message,
                        updated_at: session.updated_at.max(0),
                        thread_kind: "native".to_string(),
                        source: None,
                        source_label: None,
                        size_bytes: session.file_size_bytes,
                        cwd: None,
                        attribution_status: Some(
                            SessionCatalogAttributionStatus::StrictMatch
                                .as_str()
                                .to_string(),
                        ),
                        attribution_reason: None,
                        attribution_confidence: None,
                        matched_workspace_id: Some(owner_workspace_id.clone()),
                        matched_workspace_label: Some(workspace.name.clone()),
                    }
                }));
            }
            Err(error) => {
                log::warn!(
                    "[session_management.list_workspace_sessions] gemini history unavailable for workspace {}: {}",
                    owner_workspace_id,
                    error
                );
                partial_sources.push(SESSION_CATALOG_PARTIAL_GEMINI.to_string());
            }
        }

        match engine::commands::opencode_session_list_core(
            workspaces,
            engine_manager,
            &owner_workspace_id,
        )
        .await
        {
            Ok(opencode_sessions) => {
                entries.extend(opencode_sessions.into_iter().map(|session| {
                    let session_id = format!("opencode:{}", session.session_id);
                    WorkspaceSessionCatalogEntry {
                        archived_at: owner_metadata
                            .archived_at_by_session_id
                            .get(&session_id)
                            .copied(),
                        session_id,
                        canonical_session_id: Some(session.session_id.clone()),
                        workspace_id: owner_workspace_id.clone(),
                        workspace_label: Some(workspace.name.clone()),
                        engine: "opencode".to_string(),
                        title: session.title,
                        updated_at: session.updated_at.unwrap_or(0).max(0),
                        thread_kind: "native".to_string(),
                        source: None,
                        source_label: None,
                        size_bytes: None,
                        cwd: None,
                        attribution_status: Some(
                            SessionCatalogAttributionStatus::StrictMatch
                                .as_str()
                                .to_string(),
                        ),
                        attribution_reason: None,
                        attribution_confidence: None,
                        matched_workspace_id: Some(owner_workspace_id.clone()),
                        matched_workspace_label: Some(workspace.name.clone()),
                    }
                }));
            }
            Err(error) => {
                log::warn!(
                    "[session_management.list_workspace_sessions] opencode history unavailable for workspace {}: {}",
                    owner_workspace_id,
                    error
                );
                partial_sources.push(SESSION_CATALOG_PARTIAL_OPENCODE.to_string());
            }
        }
    }

    let mut deduped = Vec::new();
    let mut seen_ids = HashSet::new();
    for entry in entries {
        if !seen_ids.insert(build_catalog_entry_dedupe_key(&entry)) {
            continue;
        }
        deduped.push(entry);
    }

    Ok(WorkspaceScopeCatalogData {
        scope_kind,
        owner_workspace_ids,
        entries: deduped,
        partial_sources: normalize_partial_sources(partial_sources),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{WorkspaceKind, WorkspaceSettings, WorktreeInfo};
    use uuid::Uuid;

    fn workspace_entry(
        id: &str,
        name: &str,
        path: &str,
        kind: WorkspaceKind,
        parent_id: Option<&str>,
    ) -> WorkspaceEntry {
        WorkspaceEntry {
            id: id.to_string(),
            name: name.to_string(),
            path: path.to_string(),
            codex_bin: None,
            kind: kind.clone(),
            parent_id: parent_id.map(ToString::to_string),
            worktree: if kind.is_worktree() {
                Some(WorktreeInfo {
                    branch: "feature/test".to_string(),
                    base_ref: None,
                    base_commit: None,
                    tracking: None,
                    publish_error: None,
                    publish_retry_command: None,
                })
            } else {
                None
            },
            settings: WorkspaceSettings::default(),
        }
    }

    fn catalog_entry(
        session_id: &str,
        workspace_id: &str,
        workspace_label: Option<&str>,
        cwd: Option<&str>,
    ) -> WorkspaceSessionCatalogEntry {
        WorkspaceSessionCatalogEntry {
            session_id: session_id.to_string(),
            canonical_session_id: Some(session_id.to_string()),
            workspace_id: workspace_id.to_string(),
            workspace_label: workspace_label.map(ToString::to_string),
            engine: "codex".to_string(),
            title: "Example session".to_string(),
            updated_at: 1,
            archived_at: None,
            thread_kind: "native".to_string(),
            source: Some("cli".to_string()),
            source_label: Some("cli/codex".to_string()),
            size_bytes: None,
            cwd: cwd.map(ToString::to_string),
            attribution_status: None,
            attribution_reason: None,
            attribution_confidence: None,
            matched_workspace_id: None,
            matched_workspace_label: None,
        }
    }

    #[test]
    fn parses_prefixed_cursor() {
        assert_eq!(parse_catalog_cursor(Some("offset:25")), 25);
        assert_eq!(parse_catalog_cursor(Some("bad")), 0);
    }

    #[test]
    fn normalize_session_ids_rejects_invalid_path_like_values() {
        let error = normalize_session_ids(vec!["../escape".to_string()])
            .expect_err("path traversal session ids must be rejected");
        assert_eq!(error, "invalid session_id");

        let error = normalize_session_ids(vec!["claude:folder/session".to_string()])
            .expect_err("slash-containing session ids must be rejected");
        assert_eq!(error, "invalid session_id");

        let error = normalize_session_ids(vec![".".to_string()])
            .expect_err("current-directory session ids must be rejected");
        assert_eq!(error, "invalid session_id");
    }

    #[test]
    fn parses_catalog_identity_by_engine_prefix() {
        assert_eq!(
            parse_catalog_identity("claude:abc"),
            SessionCatalogIdentity::Claude {
                session_id: "abc".to_string()
            }
        );
        assert_eq!(
            parse_catalog_identity("plain-codex-id"),
            SessionCatalogIdentity::Codex {
                session_id: "plain-codex-id".to_string()
            }
        );
    }

    #[test]
    fn writes_and_reads_catalog_metadata_roundtrip() {
        let base = std::env::temp_dir().join(format!("session-catalog-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");

        let metadata = WorkspaceSessionCatalogMetadata {
            archived_at_by_session_id: HashMap::from([("claude:1".to_string(), 42_i64)]),
        };

        write_catalog_metadata(&storage_path, "ws-1", &metadata).expect("write metadata");
        let loaded = read_catalog_metadata(&storage_path, "ws-1").expect("read metadata");
        assert_eq!(
            loaded.archived_at_by_session_id.get("claude:1").copied(),
            Some(42)
        );

        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn keyword_match_includes_source_fields() {
        let entry = catalog_entry("codex:abc", "ws-1", None, None);

        assert!(entry_matches_keyword(&entry, "example"));
        assert!(entry_matches_keyword(&entry, "codex"));
        assert!(entry_matches_keyword(&entry, "cli/codex"));
    }

    #[test]
    fn missing_delete_errors_are_treated_as_settled_success() {
        assert!(should_settle_delete_as_success(
            "[SESSION_NOT_FOUND] Session file not found: stale-session"
        ));
        assert!(should_settle_delete_as_success(
            "thread not found: stale-thread"
        ));
        assert!(!should_settle_delete_as_success(
            "[SESSION_NOT_FOUND] Invalid OpenCode session id"
        ));
        assert!(!should_settle_delete_as_success("permission denied"));
        assert!(!should_settle_delete_as_success("workspace not connected"));
    }

    #[tokio::test]
    async fn catalog_workspace_scope_includes_child_worktrees_for_main_workspace() {
        let main = workspace_entry("main", "Main", "/tmp/main", WorkspaceKind::Main, None);
        let worktree_b = workspace_entry(
            "worktree-b",
            "B",
            "/tmp/worktree-b",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let worktree_a = workspace_entry(
            "worktree-a",
            "A",
            "/tmp/worktree-a",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let unrelated = workspace_entry("other", "Other", "/tmp/other", WorkspaceKind::Main, None);
        let workspaces = Mutex::new(HashMap::from([
            (main.id.clone(), main),
            (worktree_b.id.clone(), worktree_b),
            (worktree_a.id.clone(), worktree_a),
            (unrelated.id.clone(), unrelated),
        ]));

        let scope = catalog_workspace_scope(&workspaces, "main")
            .await
            .expect("resolve scope");

        let ids: Vec<_> = scope.into_iter().map(|entry| entry.id).collect();
        assert_eq!(ids, vec!["main", "worktree-a", "worktree-b"]);
    }

    #[tokio::test]
    async fn catalog_workspace_scope_keeps_worktree_selection_isolated() {
        let main = workspace_entry("main", "Main", "/tmp/main", WorkspaceKind::Main, None);
        let worktree = workspace_entry(
            "worktree-a",
            "A",
            "/tmp/worktree-a",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let sibling = workspace_entry(
            "worktree-b",
            "B",
            "/tmp/worktree-b",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let workspaces = Mutex::new(HashMap::from([
            (main.id.clone(), main),
            (worktree.id.clone(), worktree),
            (sibling.id.clone(), sibling),
        ]));

        let scope = catalog_workspace_scope(&workspaces, "worktree-a")
            .await
            .expect("resolve isolated scope");

        let ids: Vec<_> = scope.into_iter().map(|entry| entry.id).collect();
        assert_eq!(ids, vec!["worktree-a"]);
    }

    #[test]
    fn catalog_entry_dedupe_key_includes_workspace_identity() {
        let left = catalog_entry("shared-session", "main", None, None);
        let right = WorkspaceSessionCatalogEntry {
            workspace_id: "worktree-a".to_string(),
            ..left.clone()
        };

        assert_ne!(
            build_catalog_entry_dedupe_key(&left),
            build_catalog_entry_dedupe_key(&right)
        );
    }

    #[test]
    fn catalog_entry_dedupe_key_collapses_same_workspace_identity() {
        let left = catalog_entry("shared-session", "main", None, None);
        let right = WorkspaceSessionCatalogEntry {
            source: Some("override".to_string()),
            source_label: Some("override/codex".to_string()),
            updated_at: 2,
            ..left.clone()
        };

        assert_eq!(
            build_catalog_entry_dedupe_key(&left),
            build_catalog_entry_dedupe_key(&right)
        );
    }

    #[test]
    fn partial_source_join_dedupes_scope_failures_without_dropping_signal() {
        let partial_source = join_partial_sources(vec![
            SESSION_CATALOG_PARTIAL_CODEX.to_string(),
            SESSION_CATALOG_PARTIAL_GEMINI.to_string(),
            SESSION_CATALOG_PARTIAL_CODEX.to_string(),
        ]);

        assert_eq!(
            partial_source,
            Some("codex-history-unavailable,gemini-history-unavailable".to_string())
        );
    }

    #[test]
    fn projection_summary_counts_filtered_total_separately_from_status_buckets() {
        let mut active = catalog_entry("codex:active", "main", Some("Main"), None);
        active.engine = "codex".to_string();
        active.title = "Bugfix discussion".to_string();

        let mut archived = catalog_entry("claude:archived", "worktree-a", Some("Worktree"), None);
        archived.engine = "claude".to_string();
        archived.title = "Bugfix archive".to_string();
        archived.archived_at = Some(42);

        let mut other = catalog_entry("gemini:other", "main", Some("Main"), None);
        other.engine = "gemini".to_string();
        other.title = "Other topic".to_string();

        let counts = build_catalog_count_summary(
            &[active, archived, other],
            &WorkspaceSessionCatalogQuery {
                keyword: Some("bugfix".to_string()),
                engine: None,
                status: Some("active".to_string()),
            },
        );

        assert_eq!(
            counts,
            SessionCatalogCountSummary {
                active_total: 1,
                archived_total: 1,
                all_total: 2,
                filtered_total: 1,
            }
        );
    }

    #[test]
    fn normalize_partial_sources_preserves_first_seen_order() {
        let partial_sources = normalize_partial_sources(vec![
            SESSION_CATALOG_PARTIAL_GEMINI.to_string(),
            SESSION_CATALOG_PARTIAL_CODEX.to_string(),
            SESSION_CATALOG_PARTIAL_GEMINI.to_string(),
        ]);

        assert_eq!(
            partial_sources,
            vec![
                SESSION_CATALOG_PARTIAL_GEMINI.to_string(),
                SESSION_CATALOG_PARTIAL_CODEX.to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn catalog_workspace_scope_supports_windows_style_paths_without_changing_scope_ids() {
        let main = workspace_entry("main", "Main", r"C:\repo\main", WorkspaceKind::Main, None);
        let worktree = workspace_entry(
            "worktree-a",
            "Worktree A",
            r"C:\repo\main\.worktrees\a",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let unrelated = workspace_entry(
            "other",
            "Other",
            r"D:\repo\other",
            WorkspaceKind::Main,
            None,
        );
        let workspaces = Mutex::new(HashMap::from([
            (main.id.clone(), main),
            (worktree.id.clone(), worktree),
            (unrelated.id.clone(), unrelated),
        ]));

        let scope = catalog_workspace_scope(&workspaces, "main")
            .await
            .expect("resolve windows scope");

        let ids: Vec<_> = scope.into_iter().map(|entry| entry.id).collect();
        assert_eq!(ids, vec!["main", "worktree-a"]);
    }

    #[test]
    fn inferred_related_attribution_marks_same_worktree_family_as_high_confidence() {
        let main = workspace_entry("main", "Main", "/repo/main", WorkspaceKind::Main, None);
        let mut worktree_a = workspace_entry(
            "worktree-a",
            "A",
            "/repo/worktree-a",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let worktree_b = workspace_entry(
            "worktree-b",
            "B",
            "/repo/worktree-b",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        worktree_a.settings.git_root = Some("/repo".to_string());

        let workspaces = HashMap::from([
            (main.id.clone(), main),
            (worktree_a.id.clone(), worktree_a.clone()),
            (worktree_b.id.clone(), worktree_b.clone()),
        ]);
        let entry = catalog_entry("codex:1", "worktree-b", Some("B"), Some("/repo/worktree-b"));

        let attribution = infer_related_attribution_for_workspace(&workspaces, &worktree_a, &entry)
            .expect("related attribution");

        assert_eq!(
            attribution.status,
            SessionCatalogAttributionStatus::InferredRelated
        );
        assert_eq!(
            attribution.reason,
            Some(SessionCatalogAttributionReason::SharedWorktreeFamily)
        );
        assert_eq!(
            attribution.confidence,
            Some(SessionCatalogAttributionConfidence::High)
        );
    }

    #[test]
    fn inferred_related_attribution_uses_unique_git_root_match() {
        let mut main = workspace_entry("main", "Main", "/repo/main", WorkspaceKind::Main, None);
        main.settings.git_root = Some("/repo".to_string());
        let unrelated = workspace_entry("other", "Other", "/elsewhere", WorkspaceKind::Main, None);
        let workspaces = HashMap::from([
            (main.id.clone(), main.clone()),
            (unrelated.id.clone(), unrelated),
        ]);
        let entry = catalog_entry(
            "codex:2",
            SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID,
            None,
            Some("/repo/tools"),
        );

        let attribution = infer_related_attribution_for_workspace(&workspaces, &main, &entry)
            .expect("git root attribution");

        assert_eq!(
            attribution.reason,
            Some(SessionCatalogAttributionReason::SharedGitRoot)
        );
        assert_eq!(
            attribution.confidence,
            Some(SessionCatalogAttributionConfidence::Medium)
        );
    }

    #[test]
    fn inferred_related_attribution_keeps_ambiguous_git_root_unassigned() {
        let mut main_a = workspace_entry("main-a", "Main A", "/repo-a", WorkspaceKind::Main, None);
        main_a.settings.git_root = Some("/shared".to_string());
        let mut main_b = workspace_entry("main-b", "Main B", "/repo-b", WorkspaceKind::Main, None);
        main_b.settings.git_root = Some("/shared".to_string());
        let workspaces = HashMap::from([
            (main_a.id.clone(), main_a.clone()),
            (main_b.id.clone(), main_b),
        ]);
        let entry = catalog_entry(
            "codex:3",
            SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID,
            None,
            Some("/shared/tools"),
        );

        let attribution = infer_related_attribution_for_workspace(&workspaces, &main_a, &entry);

        assert!(attribution.is_none());
    }
}
