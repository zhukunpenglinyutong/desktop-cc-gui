use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tokio::time::timeout;

use super::{config, pick_model_from_model_list_response};
use crate::local_usage;
use crate::shared::codex_core;
use crate::state::AppState;
use crate::types::LocalUsageSessionSummary;

const LIST_THREADS_LIVE_TIMEOUT_MS: u64 = 1_500;
const UNIFIED_CODEX_CURSOR_PREFIX: &str = "codex-unified:";
const UNIFIED_CODEX_MAX_THREADS: usize = 5_000;
const UNIFIED_CODEX_MAX_PAGES: usize = 200;
const UNIFIED_CODEX_PAGE_SIZE: u32 = 200;
const LOCAL_SESSION_SCAN_UNAVAILABLE_PARTIAL_SOURCE: &str = "local-session-scan-unavailable";
const CODEX_BACKGROUND_HELPER_PROMPT_PREFIXES: &[&str] = &[
    "Generate a concise title for a coding chat thread from the first user message.",
    "You create concise run metadata for a coding task.",
    "You are generating OpenSpec project context.",
    "## Memory Writing Agent: Phase 2",
    "Memory Writing Agent: Phase 2",
];

static WORKSPACE_CODEX_SESSION_ID_CACHE: OnceLock<Mutex<HashMap<String, HashSet<String>>>> =
    OnceLock::new();

pub(crate) fn build_thread_list_empty_response() -> Value {
    json!({
        "result": {
            "data": [],
            "nextCursor": null
        }
    })
}

fn workspace_codex_session_id_cache() -> &'static Mutex<HashMap<String, HashSet<String>>> {
    WORKSPACE_CODEX_SESSION_ID_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn parse_unified_codex_cursor(cursor: Option<&str>) -> usize {
    let Some(cursor) = cursor.map(str::trim).filter(|value| !value.is_empty()) else {
        return 0;
    };
    cursor
        .strip_prefix(UNIFIED_CODEX_CURSOR_PREFIX)
        .unwrap_or(cursor)
        .parse::<usize>()
        .unwrap_or(0)
}

fn build_unified_codex_cursor(offset: usize) -> Value {
    Value::String(format!("{UNIFIED_CODEX_CURSOR_PREFIX}{offset}"))
}

#[allow(dead_code)]
fn thread_list_response_entries(response: &Value) -> Vec<Value> {
    response
        .get("result")
        .and_then(|result| result.get("data"))
        .or_else(|| response.get("data"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

#[allow(dead_code)]
fn thread_list_response_next_cursor(response: &Value) -> Option<Value> {
    response
        .get("result")
        .and_then(|result| {
            result
                .get("nextCursor")
                .or_else(|| result.get("next_cursor"))
                .cloned()
        })
        .or_else(|| {
            response
                .get("nextCursor")
                .or_else(|| response.get("next_cursor"))
                .cloned()
        })
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
}

fn build_thread_source_label(source: Option<&str>, provider: Option<&str>) -> Option<String> {
    let source = normalize_optional_string(source);
    let provider = normalize_optional_string(provider);
    match (source, provider) {
        (Some(source), Some(provider)) => Some(format!("{source}/{provider}")),
        (Some(source), None) => Some(source),
        (None, Some(provider)) => Some(provider),
        (None, None) => None,
    }
}

fn thread_entry_has_non_empty_string(entry: &Map<String, Value>, key: &str) -> bool {
    entry
        .get(key)
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn ensure_thread_entry_workspace_cwd(entry: &mut Map<String, Value>, workspace_path: &str) {
    if workspace_path.trim().is_empty() || thread_entry_has_non_empty_string(entry, "cwd") {
        return;
    }
    entry.insert("cwd".to_string(), Value::String(workspace_path.to_string()));
}

fn is_codex_background_helper_text(value: &str) -> bool {
    let preview = value.trim();
    if preview.is_empty() {
        return false;
    }
    if CODEX_BACKGROUND_HELPER_PROMPT_PREFIXES
        .iter()
        .any(|prefix| preview.starts_with(prefix))
    {
        return true;
    }
    let lower = preview.to_ascii_lowercase();
    let starts_with_memory_agent_header =
        lower.starts_with("## memory writing agent:") || lower.starts_with("memory writing agent:");
    starts_with_memory_agent_header
        && (lower.contains("consolidation") || lower.contains("phase 2"))
}

fn is_codex_background_helper_thread_entry(entry: &Value) -> bool {
    ["preview", "title", "name"].iter().any(|key| {
        entry
            .get(*key)
            .and_then(Value::as_str)
            .map(is_codex_background_helper_text)
            .unwrap_or(false)
    })
}

fn is_codex_background_helper_session(session: &LocalUsageSessionSummary) -> bool {
    session
        .summary
        .as_deref()
        .map(is_codex_background_helper_text)
        .unwrap_or(false)
}

fn collect_codex_background_helper_session_identifiers(
    local_sessions: &[LocalUsageSessionSummary],
) -> HashSet<String> {
    local_sessions
        .iter()
        .filter(|session| is_codex_background_helper_session(session))
        .flat_map(codex_session_identifier_candidates)
        .collect()
}

#[allow(dead_code)]
fn thread_entry_id(entry: &Value) -> Option<String> {
    normalize_optional_string(entry.get("id").and_then(Value::as_str))
}

#[allow(dead_code)]
fn thread_entry_timestamp(entry: &Value) -> i64 {
    entry
        .get("updatedAt")
        .or_else(|| entry.get("updated_at"))
        .and_then(Value::as_i64)
        .or_else(|| {
            entry
                .get("createdAt")
                .or_else(|| entry.get("created_at"))
                .and_then(Value::as_i64)
        })
        .unwrap_or(0)
        .max(0)
}

pub(crate) fn build_local_codex_session_preview(summary: Option<String>, model: String) -> String {
    let preview = summary
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    preview.unwrap_or_else(|| format!("Codex session ({model})"))
}

fn build_local_codex_thread_entry(
    workspace_path: &str,
    session: &LocalUsageSessionSummary,
) -> Value {
    let preview = build_local_codex_session_preview(session.summary.clone(), session.model.clone());
    let title = preview.clone();
    let source = normalize_optional_string(session.source.as_deref());
    let provider = normalize_optional_string(session.provider.as_deref());
    let source_label = build_thread_source_label(source.as_deref(), provider.as_deref());
    json!({
        "id": session.session_id,
        "preview": preview,
        "title": title,
        "cwd": workspace_path,
        "createdAt": session.timestamp,
        "updatedAt": session.timestamp,
        "sizeBytes": session.file_size_bytes,
        "localFallback": true,
        "source": source,
        "provider": provider,
        "sourceLabel": source_label
    })
}

pub(crate) fn codex_session_identifier_candidates(
    session: &LocalUsageSessionSummary,
) -> Vec<String> {
    let mut ids = Vec::new();
    let canonical = session.session_id.trim();
    if !canonical.is_empty() {
        ids.push(canonical.to_string());
    }
    for alias in &session.session_id_aliases {
        let normalized = alias.trim();
        if normalized.is_empty() || ids.iter().any(|existing| existing == normalized) {
            continue;
        }
        ids.push(normalized.to_string());
    }
    ids
}

fn collect_codex_session_identifiers(
    local_sessions: &[LocalUsageSessionSummary],
) -> HashSet<String> {
    local_sessions
        .iter()
        .filter(|session| !is_codex_background_helper_session(session))
        .flat_map(codex_session_identifier_candidates)
        .collect()
}

fn cache_workspace_session_identifiers(workspace_id: &str, session_ids: &HashSet<String>) {
    let mut cache = workspace_codex_session_id_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if session_ids.is_empty() {
        cache.remove(workspace_id);
        return;
    }
    cache.insert(workspace_id.to_string(), session_ids.clone());
}

fn read_cached_workspace_session_identifiers(workspace_id: &str) -> HashSet<String> {
    workspace_codex_session_id_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(workspace_id)
        .cloned()
        .unwrap_or_default()
}

#[allow(dead_code)]
pub(crate) fn merge_unified_codex_thread_entries(
    mut live_entries: Vec<Value>,
    local_sessions: &[LocalUsageSessionSummary],
    workspace_session_ids: &HashSet<String>,
    workspace_path: &str,
    requested_limit: usize,
) -> Vec<Value> {
    let mut merged_entries: Vec<Value> = Vec::new();
    let mut id_to_index: HashMap<String, usize> = HashMap::new();
    let background_helper_session_ids =
        collect_codex_background_helper_session_identifiers(local_sessions);

    for entry in live_entries.drain(..) {
        let Some(id) = thread_entry_id(&entry) else {
            continue;
        };
        if background_helper_session_ids.contains(&id)
            || is_codex_background_helper_thread_entry(&entry)
        {
            continue;
        }
        let mut entry = entry;
        if let Some(existing) = entry.as_object_mut() {
            if workspace_session_ids.contains(&id) {
                ensure_thread_entry_workspace_cwd(existing, workspace_path);
            }
        }
        if let Some(existing_index) = id_to_index.get(&id).copied() {
            let existing_timestamp = thread_entry_timestamp(&merged_entries[existing_index]);
            let candidate_timestamp = thread_entry_timestamp(&entry);
            if candidate_timestamp > existing_timestamp {
                merged_entries[existing_index] = entry;
            }
            continue;
        }
        let next_index = merged_entries.len();
        id_to_index.insert(id, next_index);
        merged_entries.push(entry);
    }

    for session in local_sessions {
        if is_codex_background_helper_session(session) {
            continue;
        }
        let local_entry = build_local_codex_thread_entry(workspace_path, session);
        let ids = codex_session_identifier_candidates(session);
        let Some(_) = ids.first() else {
            continue;
        };
        let existing_index = ids
            .iter()
            .find_map(|candidate| id_to_index.get(candidate).copied());
        if let Some(existing_index) = existing_index {
            if let (Some(existing), Some(local)) = (
                merged_entries[existing_index].as_object_mut(),
                local_entry.as_object(),
            ) {
                let existing_updated = existing
                    .get("updatedAt")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    .max(0);
                let local_updated = local
                    .get("updatedAt")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    .max(0);
                if local_updated > existing_updated {
                    existing.insert("updatedAt".to_string(), json!(local_updated));
                    existing.insert("createdAt".to_string(), json!(local_updated));
                }
                let should_replace_source = existing
                    .get("source")
                    .and_then(Value::as_str)
                    .map(|value| value.eq_ignore_ascii_case("vscode"))
                    .unwrap_or(false)
                    && local
                        .get("source")
                        .and_then(Value::as_str)
                        .map(|value| !value.eq_ignore_ascii_case("vscode"))
                        .unwrap_or(false);
                if should_replace_source {
                    if let Some(value) = local.get("source") {
                        existing.insert("source".to_string(), value.clone());
                    }
                    if let Some(value) = local.get("sourceLabel") {
                        existing.insert("sourceLabel".to_string(), value.clone());
                    }
                }
                if let Some(value) = local.get("sizeBytes").filter(|value| !value.is_null()) {
                    existing.insert("sizeBytes".to_string(), value.clone());
                }
                ensure_thread_entry_workspace_cwd(existing, workspace_path);
                for key in ["source", "provider", "sourceLabel"] {
                    let missing = match existing.get(key) {
                        None => true,
                        Some(value) => {
                            if value.is_null() {
                                true
                            } else {
                                value.as_str().map(str::is_empty).unwrap_or(false)
                            }
                        }
                    };
                    if missing {
                        if let Some(value) = local.get(key) {
                            existing.insert(key.to_string(), value.clone());
                        }
                    }
                }
            }
            continue;
        }
        let next_index = merged_entries.len();
        for candidate in ids {
            id_to_index.insert(candidate, next_index);
        }
        merged_entries.push(local_entry);
    }

    merged_entries.sort_by(|left, right| {
        let left_timestamp = thread_entry_timestamp(left);
        let right_timestamp = thread_entry_timestamp(right);
        right_timestamp
            .cmp(&left_timestamp)
            .then_with(|| thread_entry_id(left).cmp(&thread_entry_id(right)))
    });
    if merged_entries.len() > requested_limit {
        merged_entries.truncate(requested_limit);
    }
    merged_entries
}

#[allow(dead_code)]
fn build_unified_codex_thread_response(
    data: Vec<Value>,
    next_cursor: Option<Value>,
    partial_source: Option<&str>,
) -> Value {
    let cursor_value = next_cursor.unwrap_or(Value::Null);
    let mut result = json!({
        "result": {
            "data": data,
            "nextCursor": cursor_value
        }
    });
    if let (Some(partial_source), Some(result_map)) = (
        partial_source,
        result.get_mut("result").and_then(Value::as_object_mut),
    ) {
        result_map.insert(
            "partialSource".to_string(),
            Value::String(partial_source.to_string()),
        );
    }
    result
}

async fn resolve_workspace_path(state: &AppState, workspace_id: &str) -> Result<String, String> {
    let workspaces = state.workspaces.lock().await;
    workspaces
        .get(workspace_id)
        .map(|entry| entry.path.clone())
        .ok_or_else(|| "workspace not found".to_string())
}

async fn load_all_live_codex_thread_entries(
    state: &AppState,
    workspace_id: &str,
) -> Result<Vec<Value>, String> {
    let mut all_entries = Vec::new();
    let mut cursor: Option<String> = None;
    let mut pages_fetched: usize = 0;

    loop {
        pages_fetched += 1;
        let response = match timeout(
            Duration::from_millis(LIST_THREADS_LIVE_TIMEOUT_MS),
            codex_core::list_threads_core(
                &state.sessions,
                workspace_id.to_string(),
                cursor.clone(),
                Some(UNIFIED_CODEX_PAGE_SIZE),
            ),
        )
        .await
        {
            Ok(Ok(response)) => response,
            Ok(Err(error)) => {
                if all_entries.is_empty() {
                    return Err(error);
                }
                log::warn!(
                    "[list_threads] Partial live Codex list for workspace {} after {} pages: {}",
                    workspace_id,
                    pages_fetched.saturating_sub(1),
                    error
                );
                break;
            }
            Err(_) => {
                let timeout_message = format!(
                    "live thread/list timed out after {}ms",
                    LIST_THREADS_LIVE_TIMEOUT_MS
                );
                if all_entries.is_empty() {
                    return Err(timeout_message);
                }
                log::warn!(
                    "[list_threads] Partial live Codex list for workspace {} after {} pages: {}",
                    workspace_id,
                    pages_fetched.saturating_sub(1),
                    timeout_message
                );
                break;
            }
        };

        all_entries.extend(thread_list_response_entries(&response));
        if all_entries.len() >= UNIFIED_CODEX_MAX_THREADS {
            break;
        }

        let next_cursor = thread_list_response_next_cursor(&response)
            .and_then(|value| value.as_str().map(ToString::to_string));
        let Some(next_cursor) = next_cursor.filter(|value| !value.trim().is_empty()) else {
            break;
        };
        if pages_fetched >= UNIFIED_CODEX_MAX_PAGES {
            log::warn!(
                "[list_threads] Reached live Codex page cap for workspace {}",
                workspace_id
            );
            break;
        }
        cursor = Some(next_cursor);
    }

    Ok(all_entries)
}

pub(crate) async fn build_unified_codex_thread_page(
    state: &AppState,
    workspace_id: &str,
    cursor: Option<String>,
    limit: Option<u32>,
    live_enabled: bool,
) -> Result<Value, String> {
    let requested_limit = limit.unwrap_or(50).clamp(1, 200) as usize;
    let page_offset = parse_unified_codex_cursor(cursor.as_deref());
    let workspace_path = resolve_workspace_path(state, workspace_id).await?;

    let live_entries = if live_enabled {
        load_all_live_codex_thread_entries(state, workspace_id).await?
    } else {
        Vec::new()
    };

    let (local_sessions, workspace_session_ids, partial_source): (
        Vec<LocalUsageSessionSummary>,
        HashSet<String>,
        Option<&str>,
    ) = match load_local_codex_session_summaries(state, workspace_id, usize::MAX).await {
        Ok((_, sessions)) => {
            let session_ids = collect_codex_session_identifiers(&sessions);
            cache_workspace_session_identifiers(workspace_id, &session_ids);
            (sessions, session_ids, None)
        }
        Err(error) => {
            log::debug!(
                "[list_threads] Local Codex session scan unavailable for {}: {}",
                workspace_id,
                error
            );
            let cached_ids = read_cached_workspace_session_identifiers(workspace_id);
            if !cached_ids.is_empty() {
                log::debug!(
                    "[list_threads] Reusing {} cached Codex session ids for workspace {}",
                    cached_ids.len(),
                    workspace_id
                );
            }
            (
                Vec::new(),
                cached_ids,
                Some(LOCAL_SESSION_SCAN_UNAVAILABLE_PARTIAL_SOURCE),
            )
        }
    };

    let merged_entries = merge_unified_codex_thread_entries(
        live_entries,
        &local_sessions,
        &workspace_session_ids,
        &workspace_path,
        UNIFIED_CODEX_MAX_THREADS,
    );

    if merged_entries.is_empty() {
        return Ok(build_thread_list_empty_response());
    }

    let data: Vec<Value> = merged_entries
        .iter()
        .skip(page_offset)
        .take(requested_limit)
        .cloned()
        .collect();
    let next_cursor = if page_offset + data.len() < merged_entries.len() {
        Some(build_unified_codex_cursor(page_offset + data.len()))
    } else {
        None
    };
    Ok(build_unified_codex_thread_response(
        data,
        next_cursor,
        partial_source,
    ))
}

async fn load_local_codex_session_summaries(
    state: &AppState,
    workspace_id: &str,
    requested_limit: usize,
) -> Result<(String, Vec<LocalUsageSessionSummary>), String> {
    local_usage::list_codex_session_summaries_for_workspace(
        &state.workspaces,
        workspace_id,
        requested_limit,
    )
    .await
}

pub(crate) async fn resolve_workspace_config_model(
    state: &AppState,
    workspace_id: &str,
) -> Option<String> {
    let (entry, parent_entry) = {
        let workspaces = state.workspaces.lock().await;
        let entry = workspaces.get(workspace_id).cloned()?;
        let parent_entry = entry
            .parent_id
            .as_ref()
            .and_then(|pid| workspaces.get(pid).cloned());
        (entry, parent_entry)
    };
    let codex_home = super::resolve_workspace_codex_home(&entry, parent_entry.as_ref());
    super::normalize_model_id(config::read_config_model(codex_home).ok().flatten())
}

pub(crate) async fn resolve_workspace_fallback_model(
    state: &AppState,
    workspace_id: &str,
) -> Option<String> {
    let from_config = resolve_workspace_config_model(state, workspace_id).await;
    if from_config.is_some() {
        return from_config;
    }
    let model_list = codex_core::model_list_core(&state.sessions, workspace_id.to_string())
        .await
        .ok();
    model_list
        .as_ref()
        .and_then(pick_model_from_model_list_response)
}
