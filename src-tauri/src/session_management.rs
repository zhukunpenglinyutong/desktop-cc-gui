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
use crate::storage::{read_json_file, with_storage_lock, write_string_atomically};
use crate::types::WorkspaceEntry;

const SESSION_CATALOG_DEFAULT_LIMIT: usize = 50;
const SESSION_CATALOG_MAX_LIMIT: usize = 200;
const SESSION_CATALOG_SCAN_LOOKAHEAD: usize = 1;
const SESSION_CATALOG_ARCHIVE_TIMEOUT_MS: u64 = 1_500;
const SESSION_CATALOG_CURSOR_PREFIX: &str = "offset:";
const SESSION_CATALOG_PARTIAL_CODEX: &str = "codex-history-unavailable";
const SESSION_CATALOG_PARTIAL_CLAUDE: &str = "claude-history-unavailable";
const SESSION_CATALOG_PARTIAL_GEMINI: &str = "gemini-history-unavailable";
const SESSION_CATALOG_PARTIAL_OPENCODE: &str = "opencode-history-unavailable";
const SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID: &str = "__global_unassigned__";
const SESSION_FOLDER_ROOT_ID: &str = "__root__";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionCatalogEntry {
    pub(crate) session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) canonical_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) parent_session_id: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) folder_id: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionFolder {
    pub(crate) id: String,
    pub(crate) workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) parent_id: Option<String>,
    pub(crate) name: String,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionFolderTree {
    pub(crate) workspace_id: String,
    pub(crate) folders: Vec<WorkspaceSessionFolder>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionFolderMutation {
    pub(crate) folder: WorkspaceSessionFolder,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionAssignmentResponse {
    pub(crate) session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) folder_id: Option<String>,
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
    #[serde(default)]
    folders: Vec<WorkspaceSessionFolder>,
    #[serde(default)]
    folder_id_by_session_id: HashMap<String, String>,
}

#[derive(Debug, Clone)]
struct WorkspaceScopeCatalogData {
    scope_kind: WorkspaceSessionProjectionScopeKind,
    owner_workspace_ids: Vec<String>,
    entries: Vec<WorkspaceSessionCatalogEntry>,
    partial_sources: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
enum SessionCatalogScanMode {
    Bounded(usize),
    Exhaustive,
}

impl SessionCatalogScanMode {
    fn limit(self) -> usize {
        match self {
            SessionCatalogScanMode::Bounded(limit) => limit,
            SessionCatalogScanMode::Exhaustive => usize::MAX,
        }
    }
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
    DirectWorkspacePath,
    DirectGitRoot,
    SharedWorktreeFamily,
    SharedGitRoot,
    ParentScope,
    UnassignedAmbiguous,
    UnassignedMissingEvidence,
}

impl SessionCatalogAttributionReason {
    fn as_str(self) -> &'static str {
        match self {
            SessionCatalogAttributionReason::DirectWorkspacePath => "direct-workspace-path",
            SessionCatalogAttributionReason::DirectGitRoot => "direct-git-root",
            SessionCatalogAttributionReason::SharedWorktreeFamily => "shared-worktree-family",
            SessionCatalogAttributionReason::SharedGitRoot => "shared-git-root",
            SessionCatalogAttributionReason::ParentScope => "parent-scope",
            SessionCatalogAttributionReason::UnassignedAmbiguous => "unassigned-ambiguous",
            SessionCatalogAttributionReason::UnassignedMissingEvidence => {
                "unassigned-missing-evidence"
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionCatalogAttributionConfidence {
    High,
    Medium,
    Low,
}

impl SessionCatalogAttributionConfidence {
    fn as_str(self) -> &'static str {
        match self {
            SessionCatalogAttributionConfidence::High => "high",
            SessionCatalogAttributionConfidence::Medium => "medium",
            SessionCatalogAttributionConfidence::Low => "low",
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

impl SessionCatalogIdentity {
    fn engine_name(&self) -> &'static str {
        match self {
            Self::Codex { .. } => "codex",
            Self::Claude { .. } => "claude",
            Self::Gemini { .. } => "gemini",
            Self::OpenCode { .. } => "opencode",
            Self::Shared { .. } => "shared",
        }
    }
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
        &state.engine_manager,
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

#[tauri::command]
pub(crate) async fn list_workspace_session_folders(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionFolderTree, String> {
    list_workspace_session_folders_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn create_workspace_session_folder(
    workspace_id: String,
    name: String,
    parent_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionFolderMutation, String> {
    create_workspace_session_folder_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id,
        name,
        parent_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn rename_workspace_session_folder(
    workspace_id: String,
    folder_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionFolderMutation, String> {
    rename_workspace_session_folder_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id,
        folder_id,
        name,
    )
    .await
}

#[tauri::command]
pub(crate) async fn move_workspace_session_folder(
    workspace_id: String,
    folder_id: String,
    parent_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionFolderMutation, String> {
    move_workspace_session_folder_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id,
        folder_id,
        parent_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn delete_workspace_session_folder(
    workspace_id: String,
    folder_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    delete_workspace_session_folder_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id,
        folder_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn assign_workspace_session_folder(
    workspace_id: String,
    session_id: String,
    folder_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WorkspaceSessionAssignmentResponse, String> {
    assign_workspace_session_folder_core(
        &state.workspaces,
        &state.engine_manager,
        state.storage_path.as_path(),
        workspace_id,
        session_id,
        folder_id,
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
    let normalized_query = query.unwrap_or_default();
    let scan_mode = build_catalog_scan_mode(&normalized_query, cursor.as_deref(), limit);
    let scope_catalog = build_workspace_scope_catalog_data(
        workspaces,
        engine_manager,
        storage_path,
        &workspace_id,
        scan_mode,
    )
    .await?;
    Ok(build_catalog_page(
        scope_catalog.entries,
        normalized_query,
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
    let scope_catalog = build_workspace_scope_catalog_data(
        workspaces,
        engine_manager,
        storage_path,
        &workspace_id,
        SessionCatalogScanMode::Exhaustive,
    )
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
    engine_manager: &engine::EngineManager,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    let normalized_query = query.unwrap_or_default();
    let scan_mode = build_catalog_scan_mode(&normalized_query, cursor.as_deref(), limit);
    let (entries, partial_sources) =
        build_global_engine_catalog_entries(engine_manager, workspaces, storage_path, scan_mode)
            .await?;

    Ok(build_catalog_page(
        entries,
        normalized_query,
        cursor,
        limit,
        join_partial_sources(partial_sources),
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

    let normalized_query = query.unwrap_or_default();
    let scan_mode = build_catalog_scan_mode(&normalized_query, cursor.as_deref(), limit);
    let related_entries = build_global_codex_catalog_entries(workspaces, storage_path, scan_mode)
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
        normalized_query,
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
    let archived_at = now_millis();
    let mut results = Vec::new();
    let mut archive_success_ids = Vec::new();

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
                archive_success_ids.push(session_id.clone());
                results.push(batch_success(session_id, Some(archived_at)));
            }
            _ => {
                archive_success_ids.push(session_id.clone());
                results.push(batch_success(session_id, Some(archived_at)));
            }
        }
    }

    if !archive_success_ids.is_empty() {
        with_catalog_metadata_mutation(storage_path, &workspace_id, |metadata| {
            for session_id in archive_success_ids {
                metadata
                    .archived_at_by_session_id
                    .insert(session_id, archived_at);
            }
            Ok(())
        })?;
    }
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
    let normalized_session_ids = normalize_session_ids(session_ids)?;
    let results = with_catalog_metadata_mutation(storage_path, &workspace_id, |metadata| {
        let mut results = Vec::new();
        for session_id in normalized_session_ids {
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
        Ok(results)
    })?;
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
    let normalized_session_ids = normalize_session_ids(session_ids)?;
    let ordered_session_ids = normalized_session_ids.clone();
    let mut results = Vec::new();
    let mut metadata_cleanup_ids = Vec::new();

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
                    metadata_cleanup_ids.push(session_id.clone());
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
                    metadata_cleanup_ids.push(session_id.clone());
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

    let claude_config = engine_manager
        .get_engine_config(engine::EngineType::Claude)
        .await;
    let gemini_home_dir = engine_manager
        .get_engine_config(engine::EngineType::Gemini)
        .await
        .and_then(|item| item.home_dir);
    let mut async_delete_handles: Vec<(String, JoinHandle<Result<(), String>>)> = Vec::new();

    for (session_id, identity) in other_identities {
        match identity {
            SessionCatalogIdentity::Claude { session_id: raw_id } => {
                let workspace_path = workspace_path.clone();
                let claude_config = claude_config.clone();
                let session_id_for_handle = session_id.clone();
                let handle = tokio::spawn(async move {
                    engine::claude_history::delete_claude_session_with_config(
                        &workspace_path,
                        &raw_id,
                        claude_config.as_ref(),
                    )
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
                        metadata_cleanup_ids.push(session_id.clone());
                        results_by_session_id
                            .insert(session_id.clone(), batch_success(session_id, None));
                    }
                    Err(error) => {
                        if should_settle_delete_as_success(&error) {
                            metadata_cleanup_ids.push(session_id.clone());
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
                metadata_cleanup_ids.push(session_id.clone());
                results_by_session_id.insert(session_id.clone(), batch_success(session_id, None));
            }
            Ok(Err(error)) => {
                if should_settle_delete_as_success(&error) {
                    metadata_cleanup_ids.push(session_id.clone());
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

    if !metadata_cleanup_ids.is_empty() {
        with_catalog_metadata_mutation(storage_path, &workspace_id, |metadata| {
            for session_id in metadata_cleanup_ids {
                metadata.archived_at_by_session_id.remove(&session_id);
                let engine = parse_catalog_identity(&session_id).engine_name();
                remove_folder_assignment_for_session(metadata, &session_id, engine);
            }
            Ok(())
        })?;
    }
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

fn normalize_folder_id(folder_id: &str) -> Result<String, String> {
    let normalized = folder_id.trim();
    if normalized.is_empty() {
        return Err("folder_id is required".to_string());
    }
    if normalized == SESSION_FOLDER_ROOT_ID || is_invalid_session_path_segment(normalized) {
        return Err("invalid folder_id".to_string());
    }
    Ok(normalized.to_string())
}

fn normalize_optional_folder_id(folder_id: Option<String>) -> Result<Option<String>, String> {
    match folder_id {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() || trimmed == SESSION_FOLDER_ROOT_ID {
                Ok(None)
            } else {
                Ok(Some(normalize_folder_id(trimmed)?))
            }
        }
        None => Ok(None),
    }
}

fn normalize_folder_name(name: &str) -> Result<String, String> {
    let normalized = name.trim();
    if normalized.is_empty() {
        return Err("folder name is required".to_string());
    }
    if normalized.len() > 120 {
        return Err("folder name is too long".to_string());
    }
    Ok(normalized.to_string())
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

pub(crate) fn read_workspace_session_folder_assignments(
    storage_path: &Path,
    workspace_id: &str,
) -> Result<HashMap<String, String>, String> {
    Ok(read_catalog_metadata(storage_path, workspace_id)?.folder_id_by_session_id)
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

fn write_catalog_metadata_unlocked(
    path: &Path,
    metadata: &WorkspaceSessionCatalogMetadata,
) -> Result<(), String> {
    let data = serde_json::to_string_pretty(metadata)
        .map_err(|error| format!("failed to serialize {}: {error}", path.display()))?;
    write_string_atomically(path, &data)
}

fn read_catalog_metadata_from_path(path: &Path) -> Result<WorkspaceSessionCatalogMetadata, String> {
    Ok(read_json_file::<WorkspaceSessionCatalogMetadata>(path)?.unwrap_or_default())
}

fn with_catalog_metadata_mutation<T>(
    storage_path: &Path,
    workspace_id: &str,
    mutation: impl FnOnce(&mut WorkspaceSessionCatalogMetadata) -> Result<T, String>,
) -> Result<T, String> {
    let path = catalog_metadata_path(storage_path, workspace_id)?;
    with_storage_lock(&path, || {
        let mut metadata = read_catalog_metadata_from_path(&path)?;
        let result = mutation(&mut metadata)?;
        write_catalog_metadata_unlocked(&path, &metadata)?;
        Ok(result)
    })
}

async fn ensure_workspace_exists(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<(), String> {
    let workspaces = workspaces.lock().await;
    if workspaces.contains_key(workspace_id) {
        Ok(())
    } else {
        Err("workspace not found".to_string())
    }
}

fn sort_workspace_session_folders(folders: &mut [WorkspaceSessionFolder]) {
    folders.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.created_at.cmp(&right.created_at))
            .then_with(|| left.id.cmp(&right.id))
    });
}

fn folder_exists(metadata: &WorkspaceSessionCatalogMetadata, folder_id: &str) -> bool {
    metadata.folders.iter().any(|folder| folder.id == folder_id)
}

fn folder_has_children_or_sessions(
    metadata: &WorkspaceSessionCatalogMetadata,
    folder_id: &str,
) -> bool {
    metadata
        .folders
        .iter()
        .any(|folder| folder.parent_id.as_deref() == Some(folder_id))
        || metadata
            .folder_id_by_session_id
            .values()
            .any(|assigned_folder_id| assigned_folder_id == folder_id)
}

fn would_create_folder_cycle(
    metadata: &WorkspaceSessionCatalogMetadata,
    folder_id: &str,
    parent_id: Option<&str>,
) -> bool {
    let Some(mut current_parent_id) = parent_id else {
        return false;
    };
    if current_parent_id == folder_id {
        return true;
    }

    let parent_by_id: HashMap<&str, Option<&str>> = metadata
        .folders
        .iter()
        .map(|folder| (folder.id.as_str(), folder.parent_id.as_deref()))
        .collect();

    let mut seen = HashSet::new();
    loop {
        if !seen.insert(current_parent_id) {
            return true;
        }
        if current_parent_id == folder_id {
            return true;
        }
        match parent_by_id.get(current_parent_id).copied().flatten() {
            Some(next_parent_id) => current_parent_id = next_parent_id,
            None => return false,
        }
    }
}

fn apply_folder_assignment(
    entry: &mut WorkspaceSessionCatalogEntry,
    metadata_by_workspace_id: &HashMap<String, WorkspaceSessionCatalogMetadata>,
) {
    entry.folder_id = metadata_by_workspace_id
        .get(&entry.workspace_id)
        .and_then(|metadata| {
            folder_assignment_for_session(metadata, &entry.session_id, &entry.engine)
        })
        .cloned();
}

fn apply_strict_attribution_owner(
    mut entry: WorkspaceSessionCatalogEntry,
    workspaces_snapshot: &HashMap<String, WorkspaceEntry>,
    metadata_by_workspace_id: &HashMap<String, WorkspaceSessionCatalogMetadata>,
) -> WorkspaceSessionCatalogEntry {
    let attribution = resolve_catalog_entry_attribution(workspaces_snapshot, &entry);
    if attribution.status == SessionCatalogAttributionStatus::StrictMatch {
        if let Some(matched_workspace_id) = attribution.matched_workspace_id.clone() {
            if let Some(matched_workspace) = workspaces_snapshot.get(&matched_workspace_id) {
                entry.workspace_id = matched_workspace.id.clone();
                entry.workspace_label = Some(matched_workspace.name.clone());
                entry.archived_at = metadata_by_workspace_id
                    .get(&matched_workspace.id)
                    .and_then(|metadata| metadata.archived_at_by_session_id.get(&entry.session_id))
                    .copied();
            }
        }
        entry = apply_attribution_to_entry(entry, attribution);
    }
    entry
}

fn folder_assignment_keys_for_session(session_id: &str, engine: &str) -> Vec<String> {
    let trimmed_session_id = session_id.trim();
    let normalized_engine = engine.trim().to_ascii_lowercase();
    let mut keys = Vec::new();
    if trimmed_session_id.is_empty() {
        return keys;
    }

    keys.push(trimmed_session_id.to_string());
    if normalized_engine == "codex" {
        if let Some(raw_session_id) = trimmed_session_id.strip_prefix("codex:") {
            if !raw_session_id.is_empty() {
                keys.push(raw_session_id.to_string());
            }
        } else {
            keys.push(format!("codex:{trimmed_session_id}"));
        }
    }
    keys.sort();
    keys.dedup();
    keys
}

fn folder_assignment_for_session<'a>(
    metadata: &'a WorkspaceSessionCatalogMetadata,
    session_id: &str,
    engine: &str,
) -> Option<&'a String> {
    folder_assignment_keys_for_session(session_id, engine)
        .into_iter()
        .find_map(|key| metadata.folder_id_by_session_id.get(&key))
}

fn remove_folder_assignment_for_session(
    metadata: &mut WorkspaceSessionCatalogMetadata,
    session_id: &str,
    engine: &str,
) {
    for key in folder_assignment_keys_for_session(session_id, engine) {
        metadata.folder_id_by_session_id.remove(&key);
    }
}

fn build_claude_attribution_scopes(
    workspace: &WorkspaceEntry,
) -> Vec<engine::claude_history::ClaudeSessionAttributionScope> {
    let mut scopes = Vec::new();
    let mut seen = HashSet::new();

    let workspace_path = PathBuf::from(&workspace.path);
    if seen.insert(workspace_path.to_string_lossy().to_string()) {
        scopes.push(
            engine::claude_history::ClaudeSessionAttributionScope::workspace_path(workspace_path),
        );
    }

    if let Some(git_root) = workspace
        .settings
        .git_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let git_root_path = PathBuf::from(git_root);
        if seen.insert(git_root_path.to_string_lossy().to_string()) {
            scopes.push(
                engine::claude_history::ClaudeSessionAttributionScope::git_root(git_root_path),
            );
        }
    }

    scopes
}

pub(crate) async fn list_workspace_session_folders_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
) -> Result<WorkspaceSessionFolderTree, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    let mut metadata = read_catalog_metadata(storage_path, &workspace_id)?;
    sort_workspace_session_folders(&mut metadata.folders);
    Ok(WorkspaceSessionFolderTree {
        workspace_id,
        folders: metadata.folders,
    })
}

pub(crate) async fn create_workspace_session_folder_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
    name: String,
    parent_id: Option<String>,
) -> Result<WorkspaceSessionFolderMutation, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    let name = normalize_folder_name(&name)?;
    let parent_id = normalize_optional_folder_id(parent_id)?;

    with_catalog_metadata_mutation(storage_path, &workspace_id, |metadata| {
        if let Some(parent_id) = parent_id.as_deref() {
            if !folder_exists(metadata, parent_id) {
                return Err("target folder not found".to_string());
            }
        }

        let now = now_millis();
        let folder = WorkspaceSessionFolder {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.clone(),
            parent_id,
            name,
            created_at: now,
            updated_at: now,
        };
        metadata.folders.push(folder.clone());
        sort_workspace_session_folders(&mut metadata.folders);
        Ok(WorkspaceSessionFolderMutation { folder })
    })
}

pub(crate) async fn rename_workspace_session_folder_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
    folder_id: String,
    name: String,
) -> Result<WorkspaceSessionFolderMutation, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    let folder_id = normalize_folder_id(&folder_id)?;
    let name = normalize_folder_name(&name)?;

    with_catalog_metadata_mutation(storage_path, &workspace_id, |metadata| {
        let folder = metadata
            .folders
            .iter_mut()
            .find(|folder| folder.id == folder_id)
            .ok_or_else(|| "folder not found".to_string())?;
        folder.name = name;
        folder.updated_at = now_millis();
        let updated = folder.clone();
        sort_workspace_session_folders(&mut metadata.folders);
        Ok(WorkspaceSessionFolderMutation { folder: updated })
    })
}

pub(crate) async fn move_workspace_session_folder_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
    folder_id: String,
    parent_id: Option<String>,
) -> Result<WorkspaceSessionFolderMutation, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    let folder_id = normalize_folder_id(&folder_id)?;
    let parent_id = normalize_optional_folder_id(parent_id)?;

    with_catalog_metadata_mutation(storage_path, &workspace_id, |metadata| {
        if !folder_exists(metadata, &folder_id) {
            return Err("folder not found".to_string());
        }
        if let Some(parent_id) = parent_id.as_deref() {
            if !folder_exists(metadata, parent_id) {
                return Err("target folder not found".to_string());
            }
        }
        if would_create_folder_cycle(metadata, &folder_id, parent_id.as_deref()) {
            return Err("folder tree cannot contain cycles".to_string());
        }

        let folder = metadata
            .folders
            .iter_mut()
            .find(|folder| folder.id == folder_id)
            .ok_or_else(|| "folder not found".to_string())?;
        folder.parent_id = parent_id;
        folder.updated_at = now_millis();
        let updated = folder.clone();
        sort_workspace_session_folders(&mut metadata.folders);
        Ok(WorkspaceSessionFolderMutation { folder: updated })
    })
}

pub(crate) async fn delete_workspace_session_folder_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: String,
    folder_id: String,
) -> Result<(), String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    let folder_id = normalize_folder_id(&folder_id)?;

    with_catalog_metadata_mutation(storage_path, &workspace_id, |metadata| {
        if !folder_exists(metadata, &folder_id) {
            return Err("folder not found".to_string());
        }
        if folder_has_children_or_sessions(metadata, &folder_id) {
            return Err("folder is not empty; move or clear its contents first".to_string());
        }
        metadata.folders.retain(|folder| folder.id != folder_id);
        Ok(())
    })
}

pub(crate) async fn assign_workspace_session_folder_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    engine_manager: &engine::EngineManager,
    storage_path: &Path,
    workspace_id: String,
    session_id: String,
    folder_id: Option<String>,
) -> Result<WorkspaceSessionAssignmentResponse, String> {
    let workspace_id = normalize_workspace_id(&workspace_id)?;
    ensure_workspace_exists(workspaces, &workspace_id).await?;
    let session_id = normalize_session_ids(vec![session_id])?
        .into_iter()
        .next()
        .ok_or_else(|| "session_id is required".to_string())?;
    let folder_id = normalize_optional_folder_id(folder_id)?;
    ensure_session_belongs_to_workspace_scope(
        workspaces,
        engine_manager,
        storage_path,
        &workspace_id,
        &session_id,
    )
    .await?;

    with_catalog_metadata_mutation(storage_path, &workspace_id, |metadata| {
        if let Some(folder_id) = folder_id.as_deref() {
            if !folder_exists(metadata, folder_id) {
                return Err("target folder not found".to_string());
            }
        }

        let session_engine = parse_catalog_identity(&session_id).engine_name();
        remove_folder_assignment_for_session(metadata, &session_id, session_engine);
        if let Some(folder_id) = folder_id.clone() {
            metadata
                .folder_id_by_session_id
                .insert(session_id.clone(), folder_id);
        }
        Ok(WorkspaceSessionAssignmentResponse {
            session_id,
            folder_id,
        })
    })
}

async fn ensure_session_belongs_to_workspace_scope(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    engine_manager: &engine::EngineManager,
    storage_path: &Path,
    workspace_id: &str,
    session_id: &str,
) -> Result<(), String> {
    let scope_catalog = build_workspace_scope_catalog_data(
        workspaces,
        engine_manager,
        storage_path,
        workspace_id,
        SessionCatalogScanMode::Exhaustive,
    )
    .await?;
    let session_engine = parse_catalog_identity(session_id).engine_name();
    if session_engine == "shared" {
        return Err("session does not belong to target workspace".to_string());
    }

    let belongs_to_scope = scope_catalog.entries.iter().any(|entry| {
        entry.engine == session_engine
            && entry.workspace_id != SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID
            && folder_assignment_keys_for_session(&entry.session_id, &entry.engine)
                .iter()
                .any(|key| key == session_id)
    });

    if belongs_to_scope {
        Ok(())
    } else {
        Err("session does not belong to target workspace".to_string())
    }
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

fn normalize_catalog_page_limit(limit: Option<u32>) -> usize {
    limit
        .unwrap_or(SESSION_CATALOG_DEFAULT_LIMIT as u32)
        .clamp(1, SESSION_CATALOG_MAX_LIMIT as u32) as usize
}

fn build_catalog_scan_limit(cursor: Option<&str>, limit: Option<u32>) -> usize {
    parse_catalog_cursor(cursor)
        .saturating_add(normalize_catalog_page_limit(limit))
        .saturating_add(SESSION_CATALOG_SCAN_LOOKAHEAD)
}

fn query_requires_exhaustive_scan(query: &WorkspaceSessionCatalogQuery) -> bool {
    let has_keyword = query
        .keyword
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    if has_keyword {
        return true;
    }
    parse_status_filter(query.status.as_deref()) != SessionCatalogStatusFilter::All
}

fn build_catalog_scan_mode(
    query: &WorkspaceSessionCatalogQuery,
    cursor: Option<&str>,
    limit: Option<u32>,
) -> SessionCatalogScanMode {
    if query_requires_exhaustive_scan(query) {
        SessionCatalogScanMode::Exhaustive
    } else {
        SessionCatalogScanMode::Bounded(build_catalog_scan_limit(cursor, limit))
    }
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
    scan_mode: SessionCatalogScanMode,
) -> Result<Vec<WorkspaceSessionCatalogEntry>, String> {
    let global_summaries =
        local_usage::list_global_codex_session_summaries(workspaces, scan_mode.limit()).await?;
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

async fn build_global_engine_catalog_entries(
    engine_manager: &engine::EngineManager,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    scan_mode: SessionCatalogScanMode,
) -> Result<(Vec<WorkspaceSessionCatalogEntry>, Vec<String>), String> {
    let workspaces_snapshot = workspaces.lock().await.clone();
    let workspace_entries = workspaces_snapshot.values().cloned().collect::<Vec<_>>();
    let metadata_by_workspace_id =
        read_catalog_metadata_for_scope(storage_path, &workspace_entries)?;
    let mut entries =
        build_global_codex_catalog_entries(workspaces, storage_path, scan_mode).await?;
    let mut partial_sources = Vec::new();
    let gemini_config = engine_manager
        .get_engine_config(engine::EngineType::Gemini)
        .await;
    let claude_config = engine_manager
        .get_engine_config(engine::EngineType::Claude)
        .await;

    for workspace in workspace_entries {
        let workspace_path = PathBuf::from(&workspace.path);
        match engine::claude_history::list_claude_sessions_for_attribution_scopes_with_config(
            &workspace_path,
            build_claude_attribution_scopes(&workspace),
            Some(scan_mode.limit()),
            claude_config.as_ref(),
        )
        .await
        {
            Ok(sessions) => {
                for session in sessions {
                    let session_id = format!("claude:{}", session.session_id);
                    let archived_at = metadata_by_workspace_id
                        .get(&workspace.id)
                        .and_then(|metadata| metadata.archived_at_by_session_id.get(&session_id))
                        .copied();
                    let mut entry = WorkspaceSessionCatalogEntry {
                        session_id,
                        canonical_session_id: Some(session.session_id),
                        parent_session_id: session
                            .parent_session_id
                            .as_ref()
                            .map(|parent_session_id| format!("claude:{}", parent_session_id)),
                        workspace_id: workspace.id.clone(),
                        workspace_label: Some(workspace.name.clone()),
                        engine: "claude".to_string(),
                        title: session.first_message,
                        updated_at: session.updated_at.max(0),
                        archived_at,
                        thread_kind: "native".to_string(),
                        source: None,
                        source_label: None,
                        size_bytes: session.file_size_bytes,
                        cwd: session.cwd,
                        attribution_status: session.attribution_status.or_else(|| {
                            Some(
                                SessionCatalogAttributionStatus::StrictMatch
                                    .as_str()
                                    .to_string(),
                            )
                        }),
                        attribution_reason: session.attribution_reason,
                        attribution_confidence: None,
                        matched_workspace_id: Some(workspace.id.clone()),
                        matched_workspace_label: Some(workspace.name.clone()),
                        folder_id: None,
                    };
                    entry = apply_strict_attribution_owner(
                        entry,
                        &workspaces_snapshot,
                        &metadata_by_workspace_id,
                    );
                    apply_folder_assignment(&mut entry, &metadata_by_workspace_id);
                    entries.push(entry);
                }
            }
            Err(error) => {
                log::warn!(
                    "[session_management.list_global_codex_sessions] claude history unavailable for workspace {}: {}",
                    workspace.id,
                    error
                );
                partial_sources.push(SESSION_CATALOG_PARTIAL_CLAUDE.to_string());
            }
        }

        match engine::gemini_history::list_gemini_sessions(
            &workspace_path,
            Some(scan_mode.limit()),
            gemini_config
                .as_ref()
                .and_then(|item| item.home_dir.as_deref()),
        )
        .await
        {
            Ok(sessions) => {
                for session in sessions {
                    let session_id = format!("gemini:{}", session.session_id);
                    let archived_at = metadata_by_workspace_id
                        .get(&workspace.id)
                        .and_then(|metadata| metadata.archived_at_by_session_id.get(&session_id))
                        .copied();
                    let mut entry = WorkspaceSessionCatalogEntry {
                        session_id,
                        canonical_session_id: session.canonical_session_id,
                        parent_session_id: None,
                        workspace_id: workspace.id.clone(),
                        workspace_label: Some(workspace.name.clone()),
                        engine: session.engine.unwrap_or_else(|| "gemini".to_string()),
                        title: session.first_message,
                        updated_at: session.updated_at.max(0),
                        archived_at,
                        thread_kind: "native".to_string(),
                        source: None,
                        source_label: None,
                        size_bytes: session.file_size_bytes,
                        cwd: None,
                        attribution_status: session.attribution_status.or_else(|| {
                            Some(
                                SessionCatalogAttributionStatus::StrictMatch
                                    .as_str()
                                    .to_string(),
                            )
                        }),
                        attribution_reason: None,
                        attribution_confidence: None,
                        matched_workspace_id: Some(workspace.id.clone()),
                        matched_workspace_label: Some(workspace.name.clone()),
                        folder_id: None,
                    };
                    apply_folder_assignment(&mut entry, &metadata_by_workspace_id);
                    entries.push(entry);
                }
            }
            Err(error) => {
                log::warn!(
                    "[session_management.list_global_codex_sessions] gemini history unavailable for workspace {}: {}",
                    workspace.id,
                    error
                );
                partial_sources.push(SESSION_CATALOG_PARTIAL_GEMINI.to_string());
            }
        }
    }

    let mut deduped = HashMap::<String, WorkspaceSessionCatalogEntry>::new();
    for entry in entries {
        let dedupe_key = format!("{}::{}", entry.engine, entry.session_id);
        match deduped.get(&dedupe_key) {
            Some(existing) if !should_replace_global_entry(existing, &entry) => {}
            _ => {
                deduped.insert(dedupe_key, entry);
            }
        }
    }

    Ok((
        deduped.into_values().collect(),
        normalize_partial_sources(partial_sources),
    ))
}

fn build_global_codex_catalog_entry(
    summary: &crate::types::LocalUsageSessionSummary,
    workspaces_snapshot: &HashMap<String, WorkspaceEntry>,
    metadata_by_workspace_id: &HashMap<String, WorkspaceSessionCatalogMetadata>,
) -> WorkspaceSessionCatalogEntry {
    let source_label = build_source_label(summary.source.as_deref(), summary.provider.as_deref());
    let unresolved_entry = WorkspaceSessionCatalogEntry {
        session_id: summary.session_id.clone(),
        canonical_session_id: Some(summary.session_id.clone()),
        parent_session_id: None,
        workspace_id: SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID.to_string(),
        workspace_label: None,
        engine: "codex".to_string(),
        title: summary
            .summary
            .clone()
            .unwrap_or_else(|| "Codex Session".to_string()),
        updated_at: summary.timestamp.max(0),
        archived_at: None,
        thread_kind: "native".to_string(),
        source: summary.source.clone(),
        source_label,
        size_bytes: summary.file_size_bytes,
        cwd: summary.cwd.clone(),
        attribution_status: None,
        attribution_reason: None,
        attribution_confidence: None,
        matched_workspace_id: None,
        matched_workspace_label: None,
        folder_id: None,
    };
    let attribution = resolve_catalog_entry_attribution(workspaces_snapshot, &unresolved_entry);
    let mut entry = apply_attribution_to_entry(unresolved_entry, attribution);
    if let Some(owner_workspace_id) = entry.matched_workspace_id.clone() {
        if let Some(owner_workspace) = workspaces_snapshot.get(&owner_workspace_id) {
            entry.workspace_id = owner_workspace.id.clone();
            entry.workspace_label = Some(owner_workspace.name.clone());
            entry.archived_at = metadata_by_workspace_id
                .get(&owner_workspace.id)
                .and_then(|metadata| metadata.archived_at_by_session_id.get(&summary.session_id))
                .copied();
        }
    }
    entry
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

fn resolve_catalog_entry_attribution(
    workspaces: &HashMap<String, WorkspaceEntry>,
    entry: &WorkspaceSessionCatalogEntry,
) -> SessionCatalogAttribution {
    if let Some(cwd) = entry.cwd.as_deref() {
        let matching_workspaces = workspaces
            .values()
            .filter(|workspace| {
                local_usage::path_matches_workspace(cwd, Path::new(&workspace.path))
            })
            .collect::<Vec<_>>();
        if let Some(workspace) = choose_longest_unique_workspace_match(matching_workspaces) {
            return SessionCatalogAttribution {
                status: SessionCatalogAttributionStatus::StrictMatch,
                reason: Some(SessionCatalogAttributionReason::DirectWorkspacePath),
                confidence: Some(SessionCatalogAttributionConfidence::High),
                matched_workspace_id: Some(workspace.id.clone()),
                matched_workspace_label: Some(workspace.name.clone()),
            };
        }

        let matching_git_root_workspaces = workspaces
            .values()
            .filter(|workspace| {
                workspace
                    .settings
                    .git_root
                    .as_deref()
                    .map(|git_root| local_usage::path_matches_workspace(cwd, Path::new(git_root)))
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        if let Some(workspace) = choose_longest_unique_workspace_match(matching_git_root_workspaces)
        {
            return SessionCatalogAttribution {
                status: SessionCatalogAttributionStatus::StrictMatch,
                reason: Some(SessionCatalogAttributionReason::DirectGitRoot),
                confidence: Some(SessionCatalogAttributionConfidence::High),
                matched_workspace_id: Some(workspace.id.clone()),
                matched_workspace_label: Some(workspace.name.clone()),
            };
        }

        return SessionCatalogAttribution {
            status: SessionCatalogAttributionStatus::Unassigned,
            reason: Some(SessionCatalogAttributionReason::UnassignedAmbiguous),
            confidence: Some(SessionCatalogAttributionConfidence::Low),
            matched_workspace_id: None,
            matched_workspace_label: None,
        };
    }

    SessionCatalogAttribution {
        status: SessionCatalogAttributionStatus::Unassigned,
        reason: Some(SessionCatalogAttributionReason::UnassignedMissingEvidence),
        confidence: Some(SessionCatalogAttributionConfidence::Low),
        matched_workspace_id: None,
        matched_workspace_label: None,
    }
}

fn choose_longest_unique_workspace_match(matches: Vec<&WorkspaceEntry>) -> Option<&WorkspaceEntry> {
    let max_len = matches.iter().map(|workspace| workspace.path.len()).max()?;
    let mut longest = matches
        .into_iter()
        .filter(|workspace| workspace.path.len() == max_len)
        .collect::<Vec<_>>();
    if longest.len() == 1 {
        longest.pop()
    } else {
        None
    }
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
    scan_mode: SessionCatalogScanMode,
) -> Result<WorkspaceScopeCatalogData, String> {
    let workspace_scope = catalog_workspace_scope(workspaces, workspace_id).await?;
    let workspaces_snapshot = workspaces.lock().await.clone();
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
    let claude_config = engine_manager
        .get_engine_config(engine::EngineType::Claude)
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
            scan_mode.limit(),
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
                    let mut entry = WorkspaceSessionCatalogEntry {
                        session_id,
                        canonical_session_id: Some(summary.session_id.clone()),
                        parent_session_id: None,
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
                        folder_id: None,
                    };
                    apply_folder_assignment(&mut entry, &metadata_by_workspace_id);
                    entry
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

        match engine::claude_history::list_claude_sessions_for_attribution_scopes_with_config(
            &owner_workspace_path,
            build_claude_attribution_scopes(workspace),
            Some(scan_mode.limit()),
            claude_config.as_ref(),
        )
        .await
        {
            Ok(claude_sessions) => {
                entries.extend(claude_sessions.into_iter().filter_map(|session| {
                    let session_id = format!("claude:{}", session.session_id);
                    let mut entry = WorkspaceSessionCatalogEntry {
                        archived_at: owner_metadata
                            .archived_at_by_session_id
                            .get(&session_id)
                            .copied(),
                        session_id,
                        canonical_session_id: Some(session.session_id.clone()),
                        parent_session_id: session
                            .parent_session_id
                            .as_ref()
                            .map(|parent_session_id| format!("claude:{}", parent_session_id)),
                        workspace_id: owner_workspace_id.clone(),
                        workspace_label: Some(workspace.name.clone()),
                        engine: "claude".to_string(),
                        title: session.first_message,
                        updated_at: session.updated_at.max(0),
                        thread_kind: "native".to_string(),
                        source: None,
                        source_label: None,
                        size_bytes: session.file_size_bytes,
                        cwd: session.cwd,
                        attribution_status: session.attribution_status.or_else(|| {
                            Some(
                                SessionCatalogAttributionStatus::StrictMatch
                                    .as_str()
                                    .to_string(),
                            )
                        }),
                        attribution_reason: session.attribution_reason,
                        attribution_confidence: None,
                        matched_workspace_id: Some(owner_workspace_id.clone()),
                        matched_workspace_label: Some(workspace.name.clone()),
                        folder_id: None,
                    };
                    entry = apply_strict_attribution_owner(
                        entry,
                        &workspaces_snapshot,
                        &metadata_by_workspace_id,
                    );
                    if !owner_workspace_ids.contains(&entry.workspace_id) {
                        return None;
                    }
                    apply_folder_assignment(&mut entry, &metadata_by_workspace_id);
                    Some(entry)
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
            Some(scan_mode.limit()),
            gemini_config
                .as_ref()
                .and_then(|item| item.home_dir.as_deref()),
        )
        .await
        {
            Ok(gemini_sessions) => {
                entries.extend(gemini_sessions.into_iter().map(|session| {
                    let session_id = format!("gemini:{}", session.session_id);
                    let mut entry = WorkspaceSessionCatalogEntry {
                        archived_at: owner_metadata
                            .archived_at_by_session_id
                            .get(&session_id)
                            .copied(),
                        session_id,
                        canonical_session_id: Some(session.session_id.clone()),
                        parent_session_id: None,
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
                        folder_id: None,
                    };
                    apply_folder_assignment(&mut entry, &metadata_by_workspace_id);
                    entry
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
                    let mut entry = WorkspaceSessionCatalogEntry {
                        archived_at: owner_metadata
                            .archived_at_by_session_id
                            .get(&session_id)
                            .copied(),
                        session_id,
                        canonical_session_id: Some(session.session_id.clone()),
                        parent_session_id: None,
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
                        folder_id: None,
                    };
                    apply_folder_assignment(&mut entry, &metadata_by_workspace_id);
                    entry
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
    include!("session_management_tests.rs");
}
