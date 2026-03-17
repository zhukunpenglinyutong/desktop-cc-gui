use chrono::{DateTime, Duration, Local, TimeZone, Utc};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use tokio::sync::Mutex;
use tokio::time::timeout;

use crate::codex::home::{resolve_default_codex_home, resolve_workspace_codex_home};
use crate::state::AppState;
use crate::types::{
    LocalUsageDailyUsage, LocalUsageDay, LocalUsageModel, LocalUsageModelUsage,
    LocalUsageSessionSummary, LocalUsageSnapshot, LocalUsageStatistics, LocalUsageTotals,
    LocalUsageTrends, LocalUsageUsageData, LocalUsageWeekData, LocalUsageWeeklyComparison,
    WorkspaceEntry,
};

#[derive(Default, Clone, Copy)]
struct DailyTotals {
    input: i64,
    cached: i64,
    output: i64,
    agent_ms: i64,
    agent_runs: i64,
}

#[derive(Default, Clone, Copy)]
struct UsageTotals {
    input: i64,
    cached: i64,
    output: i64,
}

const MAX_ACTIVITY_GAP_MS: i64 = 2 * 60 * 1000;
const USAGE_LIMIT_SESSIONS: usize = 200;

#[derive(Default, Clone, Copy)]
struct CostRates {
    input: f64,
    output: f64,
    cache_write: f64,
    cache_read: f64,
}

#[tauri::command]
pub(crate) async fn local_usage_snapshot(
    days: Option<u32>,
    workspace_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<LocalUsageSnapshot, String> {
    let days = days.unwrap_or(30).clamp(1, 90);
    let workspace_path = workspace_path.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    });
    let sessions_roots = {
        let workspaces = state.workspaces.lock().await;
        resolve_sessions_roots(&workspaces, workspace_path.as_deref())
    };
    let snapshot = tokio::task::spawn_blocking(move || {
        scan_local_usage(days, workspace_path.as_deref(), &sessions_roots)
    })
    .await
    .map_err(|err| err.to_string())??;
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn local_usage_statistics(
    scope: Option<String>,
    provider: Option<String>,
    date_range: Option<String>,
    workspace_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<LocalUsageStatistics, String> {
    let scope = scope.unwrap_or_else(|| "current".to_string());
    let provider = provider.unwrap_or_else(|| "claude".to_string());
    let date_range = date_range.unwrap_or_else(|| "7d".to_string());
    let workspace_path = workspace_path.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    });
    let filter_workspace = if scope == "current" {
        workspace_path
    } else {
        None
    };
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let cutoff_time = match date_range.as_str() {
        "7d" => now_ms - 7 * 24 * 60 * 60 * 1000,
        "30d" => now_ms - 30 * 24 * 60 * 60 * 1000,
        _ => 0,
    };
    let project_path = if scope == "all" {
        "all".to_string()
    } else if let Some(path) = filter_workspace.as_ref() {
        path.to_string_lossy().to_string()
    } else {
        "current".to_string()
    };
    let project_name = if scope == "all" {
        "All Projects".to_string()
    } else if let Some(path) = filter_workspace.as_ref() {
        path.file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("Current Project")
            .to_string()
    } else {
        "Current Project".to_string()
    };

    let sessions_roots = {
        let workspaces = state.workspaces.lock().await;
        resolve_sessions_roots(&workspaces, filter_workspace.as_deref())
    };
    let statistics = tokio::task::spawn_blocking(move || {
        scan_local_usage_statistics(
            &provider,
            filter_workspace.as_deref(),
            &sessions_roots,
            cutoff_time,
            project_path,
            project_name,
            now_ms,
        )
    })
    .await
    .map_err(|err| err.to_string())??;

    Ok(statistics)
}

pub(crate) async fn list_codex_session_summaries_for_workspace(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    limit: usize,
) -> Result<(String, Vec<LocalUsageSessionSummary>), String> {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return Err("workspace_id is required".to_string());
    }
    let capped_limit = limit.clamp(1, 200);
    let (workspace_path_str, workspace_path, sessions_roots) = {
        let workspaces = workspaces.lock().await;
        let entry = workspaces
            .get(workspace_id)
            .ok_or_else(|| "workspace not found".to_string())?;
        let workspace_path = PathBuf::from(&entry.path);
        let sessions_roots = resolve_sessions_roots(&workspaces, Some(workspace_path.as_path()));
        (entry.path.clone(), workspace_path, sessions_roots)
    };
    let sessions = timeout(
        std::time::Duration::from_millis(1_500),
        tokio::task::spawn_blocking(move || {
            let mut summaries =
                scan_codex_session_summaries(Some(workspace_path.as_path()), &sessions_roots)?;
            if summaries.len() > capped_limit {
                summaries.truncate(capped_limit);
            }
            Ok::<Vec<LocalUsageSessionSummary>, String>(summaries)
        }),
    )
    .await
    .map_err(|_| "local codex session fallback timed out".to_string())?
    .map_err(|err| err.to_string())??;

    Ok((workspace_path_str, sessions))
}

#[tauri::command]
pub(crate) async fn load_codex_session(
    workspace_id: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_id = workspace_id.trim().to_string();
    let session_id = session_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id is required".to_string());
    }
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }
    if session_id.contains('/') || session_id.contains('\\') || session_id.contains("..") {
        return Err("invalid session_id".to_string());
    }

    let (workspace_path, sessions_roots) = {
        let workspaces = state.workspaces.lock().await;
        let entry = workspaces
            .get(&workspace_id)
            .ok_or_else(|| "workspace not found".to_string())?;
        let workspace_path = PathBuf::from(&entry.path);
        let sessions_roots = resolve_sessions_roots(&workspaces, Some(workspace_path.as_path()));
        (workspace_path, sessions_roots)
    };

    let session_id_for_load = session_id.clone();
    let entries = tokio::task::spawn_blocking(move || {
        load_codex_session_entries(
            session_id_for_load.as_str(),
            workspace_path.as_path(),
            &sessions_roots,
        )
    })
    .await
    .map_err(|err| err.to_string())??;

    Ok(json!({
        "sessionId": session_id,
        "entries": entries,
    }))
}

fn load_codex_session_entries(
    session_id: &str,
    workspace_path: &Path,
    sessions_roots: &[PathBuf],
) -> Result<Vec<Value>, String> {
    let session_path = find_codex_session_file(session_id, workspace_path, sessions_roots)?;
    let file = File::open(&session_path).map_err(|err| {
        format!(
            "failed to open codex session file {}: {}",
            session_path.display(),
            err
        )
    })?;
    let reader = BufReader::new(file);
    let mut entries = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|err| err.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(&line).map_err(|err| {
            format!(
                "failed to parse codex session entry {}: {}",
                session_path.display(),
                err
            )
        })?;
        entries.push(value);
    }
    Ok(entries)
}

fn find_codex_session_file(
    session_id: &str,
    workspace_path: &Path,
    sessions_roots: &[PathBuf],
) -> Result<PathBuf, String> {
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    for root in sessions_roots {
        collect_jsonl_files(root, &mut files, &mut seen);
    }

    let mut unknown_candidates = Vec::new();
    for path in files {
        if !codex_session_file_matches_session_id(&path, session_id)? {
            continue;
        }
        match codex_session_file_matches_workspace(&path, workspace_path)? {
            Some(true) => return Ok(path),
            Some(false) => continue,
            None => unknown_candidates.push(path),
        }
    }

    unknown_candidates
        .into_iter()
        .next()
        .ok_or_else(|| format!("codex session file not found for session {}", session_id))
}

fn codex_session_file_matches_session_id(path: &Path, session_id: &str) -> Result<bool, String> {
    let normalized_session_id = session_id.trim();
    if normalized_session_id.is_empty() {
        return Ok(false);
    }

    let file_stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim();
    if file_stem == normalized_session_id
        || file_stem.ends_with(&format!("-{normalized_session_id}"))
    {
        return Ok(true);
    }

    let file = File::open(path).map_err(|err| {
        format!(
            "failed to open codex session file {}: {}",
            path.display(),
            err
        )
    })?;
    let reader = BufReader::new(file);
    for line in reader.lines() {
        let line = line.map_err(|err| err.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let entry_type = value
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if entry_type != "session_meta" {
            continue;
        }
        let payload = value.get("payload").and_then(|value| value.as_object());
        let payload_id = payload
            .and_then(|payload| payload.get("id"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim();
        return Ok(payload_id == normalized_session_id);
    }

    Ok(false)
}

fn codex_session_file_matches_workspace(
    path: &Path,
    workspace_path: &Path,
) -> Result<Option<bool>, String> {
    let file = File::open(path).map_err(|err| {
        format!(
            "failed to open codex session file {}: {}",
            path.display(),
            err
        )
    })?;
    let reader = BufReader::new(file);

    for line in reader.lines() {
        let line = line.map_err(|err| err.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let entry_type = value
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if entry_type != "session_meta" && entry_type != "turn_context" {
            continue;
        }
        let Some(cwd) = extract_cwd(&value) else {
            continue;
        };
        return Ok(Some(path_matches_workspace(&cwd, workspace_path)));
    }

    Ok(None)
}

fn scan_local_usage_statistics(
    provider: &str,
    workspace_path: Option<&Path>,
    sessions_roots: &[PathBuf],
    cutoff_time: i64,
    project_path: String,
    project_name: String,
    now_ms: i64,
) -> Result<LocalUsageStatistics, String> {
    let mut sessions = if provider == "codex" {
        scan_codex_session_summaries(workspace_path, sessions_roots)?
    } else {
        scan_claude_session_summaries(workspace_path)?
    };

    if cutoff_time > 0 {
        sessions.retain(|session| session.timestamp >= cutoff_time);
    }
    sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    if provider != "codex" && sessions.len() > USAGE_LIMIT_SESSIONS {
        sessions.truncate(USAGE_LIMIT_SESSIONS);
    }

    Ok(build_usage_statistics(
        project_path,
        project_name,
        sessions,
        now_ms,
    ))
}

fn scan_local_usage(
    days: u32,
    workspace_path: Option<&Path>,
    sessions_roots: &[PathBuf],
) -> Result<LocalUsageSnapshot, String> {
    scan_local_usage_core(days, workspace_path, sessions_roots, true)
}

fn scan_local_usage_core(
    days: u32,
    workspace_path: Option<&Path>,
    sessions_roots: &[PathBuf],
    include_claude: bool,
) -> Result<LocalUsageSnapshot, String> {
    let updated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let day_keys = make_day_keys(days);
    let mut daily: HashMap<String, DailyTotals> = day_keys
        .iter()
        .map(|key| (key.clone(), DailyTotals::default()))
        .collect();
    let mut model_totals: HashMap<String, i64> = HashMap::new();

    // Scan Codex sessions
    for root in sessions_roots {
        for day_key in &day_keys {
            let day_dir = day_dir_for_key(root, day_key);
            if !day_dir.exists() {
                continue;
            }
            let entries = match std::fs::read_dir(&day_dir) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                    continue;
                }
                scan_file(&path, &mut daily, &mut model_totals, workspace_path)?;
            }
        }
    }

    // Also scan Claude Code projects
    if include_claude {
        scan_claude_projects(&day_keys, &mut daily, &mut model_totals, workspace_path)?;
    }

    Ok(build_snapshot(updated_at, day_keys, daily, model_totals))
}

fn build_snapshot(
    updated_at: i64,
    day_keys: Vec<String>,
    daily: HashMap<String, DailyTotals>,
    model_totals: HashMap<String, i64>,
) -> LocalUsageSnapshot {
    let mut days: Vec<LocalUsageDay> = Vec::with_capacity(day_keys.len());
    let mut total_tokens = 0;

    for day_key in &day_keys {
        let totals = daily.get(day_key).copied().unwrap_or_default();
        let total = totals.input + totals.output;
        total_tokens += total;
        days.push(LocalUsageDay {
            day: day_key.clone(),
            input_tokens: totals.input,
            cached_input_tokens: totals.cached,
            output_tokens: totals.output,
            total_tokens: total,
            agent_time_ms: totals.agent_ms,
            agent_runs: totals.agent_runs,
        });
    }

    let last7 = days.iter().rev().take(7).cloned().collect::<Vec<_>>();
    let last7_tokens: i64 = last7.iter().map(|day| day.total_tokens).sum();
    let last7_input: i64 = last7.iter().map(|day| day.input_tokens).sum();
    let last7_cached: i64 = last7.iter().map(|day| day.cached_input_tokens).sum();

    let average_daily_tokens = if last7.is_empty() {
        0
    } else {
        ((last7_tokens as f64) / (last7.len() as f64)).round() as i64
    };

    let cache_hit_rate_percent = if last7_input > 0 {
        ((last7_cached as f64) / (last7_input as f64) * 1000.0).round() / 10.0
    } else {
        0.0
    };

    let peak = days
        .iter()
        .max_by_key(|day| day.total_tokens)
        .filter(|day| day.total_tokens > 0);
    let peak_day = peak.map(|day| day.day.clone());
    let peak_day_tokens = peak.map(|day| day.total_tokens).unwrap_or(0);

    let mut top_models: Vec<LocalUsageModel> = model_totals
        .into_iter()
        .filter(|(model, tokens)| model != "unknown" && *tokens > 0)
        .map(|(model, tokens)| LocalUsageModel {
            model,
            tokens,
            share_percent: if total_tokens > 0 {
                ((tokens as f64) / (total_tokens as f64) * 1000.0).round() / 10.0
            } else {
                0.0
            },
        })
        .collect();
    top_models.sort_by(|a, b| b.tokens.cmp(&a.tokens));
    top_models.truncate(4);

    LocalUsageSnapshot {
        updated_at,
        days,
        totals: LocalUsageTotals {
            last7_days_tokens: last7_tokens,
            last30_days_tokens: total_tokens,
            average_daily_tokens,
            cache_hit_rate_percent,
            peak_day,
            peak_day_tokens,
        },
        top_models,
    }
}

fn build_usage_statistics(
    project_path: String,
    project_name: String,
    sessions: Vec<LocalUsageSessionSummary>,
    now_ms: i64,
) -> LocalUsageStatistics {
    let mut total_usage = LocalUsageUsageData::default();
    let mut estimated_cost = 0.0;
    let mut daily_map: HashMap<String, LocalUsageDailyUsage> = HashMap::new();
    let mut model_map: HashMap<String, LocalUsageModelUsage> = HashMap::new();
    let one_week_ago = now_ms - 7 * 24 * 60 * 60 * 1000;
    let two_weeks_ago = now_ms - 14 * 24 * 60 * 60 * 1000;
    let mut current_week = LocalUsageWeekData::default();
    let mut last_week = LocalUsageWeekData::default();

    for session in &sessions {
        add_usage(&mut total_usage, &session.usage);
        estimated_cost += session.cost;

        let day_key =
            day_key_for_timestamp_ms(session.timestamp).unwrap_or_else(|| "1970-01-01".to_string());
        let daily = daily_map
            .entry(day_key.clone())
            .or_insert_with(|| LocalUsageDailyUsage {
                date: day_key.clone(),
                ..LocalUsageDailyUsage::default()
            });
        daily.sessions += 1;
        daily.cost += session.cost;
        add_usage(&mut daily.usage, &session.usage);
        if !daily
            .models_used
            .iter()
            .any(|model| model == &session.model)
        {
            daily.models_used.push(session.model.clone());
        }

        let model_usage =
            model_map
                .entry(session.model.clone())
                .or_insert_with(|| LocalUsageModelUsage {
                    model: session.model.clone(),
                    ..LocalUsageModelUsage::default()
                });
        model_usage.session_count += 1;
        model_usage.total_cost += session.cost;
        model_usage.total_tokens += session.usage.total_tokens;
        model_usage.input_tokens += session.usage.input_tokens;
        model_usage.output_tokens += session.usage.output_tokens;
        model_usage.cache_creation_tokens += session.usage.cache_write_tokens;
        model_usage.cache_read_tokens += session.usage.cache_read_tokens;

        if session.timestamp >= one_week_ago {
            current_week.sessions += 1;
            current_week.cost += session.cost;
            current_week.tokens += session.usage.total_tokens;
        } else if session.timestamp >= two_weeks_ago {
            last_week.sessions += 1;
            last_week.cost += session.cost;
            last_week.tokens += session.usage.total_tokens;
        }
    }

    total_usage.total_tokens = total_usage.input_tokens
        + total_usage.output_tokens
        + total_usage.cache_write_tokens
        + total_usage.cache_read_tokens;

    let mut daily_usage: Vec<LocalUsageDailyUsage> = daily_map.into_values().collect();
    daily_usage.sort_by(|a, b| a.date.cmp(&b.date));
    let mut by_model: Vec<LocalUsageModelUsage> = model_map.into_values().collect();
    by_model.sort_by(|a, b| b.total_cost.total_cmp(&a.total_cost));

    LocalUsageStatistics {
        project_path,
        project_name,
        total_sessions: sessions.len() as i64,
        total_usage,
        estimated_cost,
        sessions,
        daily_usage,
        weekly_comparison: LocalUsageWeeklyComparison {
            current_week: current_week.clone(),
            last_week: last_week.clone(),
            trends: LocalUsageTrends {
                sessions: calculate_trend(current_week.sessions as f64, last_week.sessions as f64),
                cost: calculate_trend(current_week.cost, last_week.cost),
                tokens: calculate_trend(current_week.tokens as f64, last_week.tokens as f64),
            },
        },
        by_model,
        last_updated: now_ms,
    }
}

fn calculate_trend(current: f64, last: f64) -> f64 {
    if last == 0.0 {
        return 0.0;
    }
    ((current - last) / last) * 100.0
}

fn add_usage(target: &mut LocalUsageUsageData, usage: &LocalUsageUsageData) {
    target.input_tokens += usage.input_tokens;
    target.output_tokens += usage.output_tokens;
    target.cache_write_tokens += usage.cache_write_tokens;
    target.cache_read_tokens += usage.cache_read_tokens;
    target.total_tokens += usage.total_tokens;
}

fn calculate_usage_cost(usage: &LocalUsageUsageData, rates: CostRates) -> f64 {
    let input_cost = (usage.input_tokens as f64 / 1_000_000.0) * rates.input;
    let output_cost = (usage.output_tokens as f64 / 1_000_000.0) * rates.output;
    let cache_write_cost = (usage.cache_write_tokens as f64 / 1_000_000.0) * rates.cache_write;
    let cache_read_cost = (usage.cache_read_tokens as f64 / 1_000_000.0) * rates.cache_read;
    input_cost + output_cost + cache_write_cost + cache_read_cost
}

fn codex_cost_rates() -> CostRates {
    CostRates {
        input: 3.0,
        output: 15.0,
        cache_write: 0.0,
        cache_read: 0.30,
    }
}

fn claude_cost_rates(model: &str) -> CostRates {
    let model_lower = model.to_lowercase();
    if model_lower.contains("opus-4") || model_lower.contains("claude-opus-4") {
        return CostRates {
            input: 15.0,
            output: 75.0,
            cache_write: 18.75,
            cache_read: 1.50,
        };
    }
    if model_lower.contains("haiku-4") || model_lower.contains("claude-haiku-4") {
        return CostRates {
            input: 0.8,
            output: 4.0,
            cache_write: 1.0,
            cache_read: 0.08,
        };
    }
    CostRates {
        input: 3.0,
        output: 15.0,
        cache_write: 3.75,
        cache_read: 0.30,
    }
}

fn scan_codex_session_summaries(
    workspace_path: Option<&Path>,
    sessions_roots: &[PathBuf],
) -> Result<Vec<LocalUsageSessionSummary>, String> {
    let mut files = Vec::new();
    let mut seen_files = HashSet::new();
    for root in sessions_roots {
        collect_jsonl_files(root, &mut files, &mut seen_files);
    }

    let mut sessions = Vec::new();
    for file in files {
        if let Some(summary) = parse_codex_session_summary(&file, workspace_path)? {
            sessions.push(summary);
        }
    }
    sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(sessions)
}

fn collect_jsonl_files(root: &Path, output: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>) {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, output, seen);
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        if seen.insert(path.clone()) {
            output.push(path);
        }
    }
}

fn parse_codex_session_summary(
    path: &Path,
    workspace_path: Option<&Path>,
) -> Result<Option<LocalUsageSessionSummary>, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return Ok(None),
    };
    let reader = BufReader::new(file);
    let mut usage = LocalUsageUsageData::default();
    let mut summary: Option<String> = None;
    let mut model: Option<String> = None;
    let mut first_timestamp = 0_i64;
    let mut previous_totals: Option<UsageTotals> = None;
    let mut match_known = workspace_path.is_none();
    let mut matches_workspace = workspace_path.is_none();

    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => continue,
        };
        if line.len() > 512_000 {
            continue;
        }

        let value = match serde_json::from_str::<Value>(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if first_timestamp == 0 {
            first_timestamp = read_timestamp_ms(&value).unwrap_or(0);
        }

        let entry_type = value
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("");

        if entry_type == "session_meta" || entry_type == "turn_context" {
            if let Some(cwd) = extract_cwd(&value) {
                if let Some(filter) = workspace_path {
                    matches_workspace = path_matches_workspace(&cwd, filter);
                    match_known = true;
                    if !matches_workspace {
                        break;
                    }
                }
            }
        }

        if entry_type == "turn_context" {
            if model.is_none() {
                model = extract_model_from_turn_context(&value);
            }
            continue;
        }

        if !matches_workspace {
            if match_known {
                break;
            }
            continue;
        }

        if workspace_path.is_some() && !match_known {
            continue;
        }

        if summary.is_none() && entry_type == "event_msg" {
            if let Some(payload) = value.get("payload").and_then(|payload| payload.as_object()) {
                let payload_type = payload
                    .get("type")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                if payload_type == "user_message" {
                    if let Some(message) = payload.get("message").and_then(|value| value.as_str()) {
                        summary = truncate_summary(message);
                    }
                }
            }
        }

        if !(entry_type == "event_msg" || entry_type.is_empty()) {
            continue;
        }
        let payload = value.get("payload").and_then(|value| value.as_object());
        let payload_type = payload
            .and_then(|payload| payload.get("type"))
            .and_then(|value| value.as_str());
        if payload_type != Some("token_count") {
            continue;
        }

        let info = payload
            .and_then(|payload| payload.get("info"))
            .and_then(|value| value.as_object());
        let (input, cached, output, used_total) = if let Some(info) = info {
            if let Some(total) = find_usage_map(info, &["total_token_usage", "totalTokenUsage"]) {
                (
                    read_i64(total, &["input_tokens", "inputTokens"]),
                    read_i64(
                        total,
                        &[
                            "cached_input_tokens",
                            "cache_read_input_tokens",
                            "cachedInputTokens",
                            "cacheReadInputTokens",
                        ],
                    ),
                    read_i64(total, &["output_tokens", "outputTokens"]),
                    true,
                )
            } else if let Some(last) = find_usage_map(info, &["last_token_usage", "lastTokenUsage"])
            {
                (
                    read_i64(last, &["input_tokens", "inputTokens"]),
                    read_i64(
                        last,
                        &[
                            "cached_input_tokens",
                            "cache_read_input_tokens",
                            "cachedInputTokens",
                            "cacheReadInputTokens",
                        ],
                    ),
                    read_i64(last, &["output_tokens", "outputTokens"]),
                    false,
                )
            } else {
                continue;
            }
        } else {
            continue;
        };

        let mut delta = UsageTotals {
            input,
            cached,
            output,
        };
        if used_total {
            let prev = previous_totals.unwrap_or_default();
            delta = UsageTotals {
                input: (input - prev.input).max(0),
                cached: (cached - prev.cached).max(0),
                output: (output - prev.output).max(0),
            };
            previous_totals = Some(UsageTotals {
                input,
                cached,
                output,
            });
        } else {
            let mut next = previous_totals.unwrap_or_default();
            next.input += delta.input;
            next.cached += delta.cached;
            next.output += delta.output;
            previous_totals = Some(next);
        }

        if delta.input == 0 && delta.cached == 0 && delta.output == 0 {
            continue;
        }

        usage.input_tokens += delta.input.max(0);
        usage.output_tokens += delta.output.max(0);
        usage.cache_read_tokens += delta.cached.max(0);
        if model.is_none() {
            model = extract_model_from_token_count(&value);
        }
    }

    if workspace_path.is_some() && !matches_workspace {
        return Ok(None);
    }

    usage.total_tokens = usage.input_tokens
        + usage.output_tokens
        + usage.cache_write_tokens
        + usage.cache_read_tokens;

    if summary.is_none() && usage.total_tokens == 0 {
        return Ok(None);
    }

    let session_id = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let model = model.unwrap_or_else(|| "gpt-5.1".to_string());
    let cost = calculate_usage_cost(&usage, codex_cost_rates());
    let timestamp = if first_timestamp > 0 {
        first_timestamp
    } else {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    };

    Ok(Some(LocalUsageSessionSummary {
        session_id,
        timestamp,
        model,
        usage,
        cost,
        summary,
    }))
}

fn truncate_summary(text: &str) -> Option<String> {
    let cleaned = text.replace('\n', " ").trim().to_string();
    if cleaned.is_empty() {
        return None;
    }
    let limit = 45;
    let truncated = if cleaned.chars().count() > limit {
        format!("{}...", cleaned.chars().take(limit).collect::<String>())
    } else {
        cleaned
    };
    Some(truncated)
}

fn scan_claude_session_summaries(
    workspace_path: Option<&Path>,
) -> Result<Vec<LocalUsageSessionSummary>, String> {
    let projects_dir = match claude_projects_dir() {
        Some(dir) if dir.exists() => dir,
        _ => return Ok(Vec::new()),
    };
    let mut sessions = Vec::new();

    if let Some(workspace_path) = workspace_path {
        let encoded = encode_claude_project_path(&workspace_path.to_string_lossy());
        let project_dir = projects_dir.join(encoded);
        if project_dir.exists() {
            scan_claude_project_summaries(&project_dir, &mut sessions)?;
        }
        sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        return Ok(sessions);
    }

    let entries = match fs::read_dir(&projects_dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_claude_project_summaries(&path, &mut sessions)?;
        }
    }
    sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(sessions)
}

fn scan_claude_project_summaries(
    project_dir: &Path,
    sessions: &mut Vec<LocalUsageSessionSummary>,
) -> Result<(), String> {
    let entries = match fs::read_dir(project_dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !name.ends_with(".jsonl") || name.starts_with("agent-") {
            continue;
        }
        if let Some(summary) = parse_claude_session_summary(&path)? {
            sessions.push(summary);
        }
    }
    Ok(())
}

fn parse_claude_session_summary(path: &Path) -> Result<Option<LocalUsageSessionSummary>, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return Ok(None),
    };
    let reader = BufReader::new(file);
    let mut usage = LocalUsageUsageData::default();
    let mut total_cost = 0.0;
    let mut model = "unknown".to_string();
    let mut first_timestamp = 0_i64;
    let mut summary: Option<String> = None;

    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => continue,
        };
        if line.len() > 512_000 {
            continue;
        }

        let value = match serde_json::from_str::<Value>(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if first_timestamp == 0 {
            first_timestamp = read_claude_timestamp(&value).unwrap_or(0);
        }

        let entry_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if summary.is_none() && entry_type == "summary" {
            if let Some(text) = value.get("summary").and_then(|v| v.as_str()) {
                summary = truncate_summary(text);
            }
        }
        if entry_type != "assistant" {
            continue;
        }

        let Some(message) = value.get("message").and_then(|v| v.as_object()) else {
            continue;
        };
        let message_model = message.get("model").and_then(|v| v.as_str());
        if model == "unknown" {
            if let Some(message_model) = message_model {
                model = message_model.to_string();
            }
        }

        let Some(usage_map) = message.get("usage").and_then(|v| v.as_object()) else {
            continue;
        };
        let input_tokens = read_i64(usage_map, &["input_tokens"]);
        let output_tokens = read_i64(usage_map, &["output_tokens"]);
        let cache_write_tokens = read_i64(usage_map, &["cache_creation_input_tokens"]);
        let cache_read_tokens = read_i64(usage_map, &["cache_read_input_tokens"]);
        if input_tokens == 0
            && output_tokens == 0
            && cache_write_tokens == 0
            && cache_read_tokens == 0
        {
            continue;
        }

        let message_usage = LocalUsageUsageData {
            input_tokens,
            output_tokens,
            cache_write_tokens,
            cache_read_tokens,
            total_tokens: input_tokens + output_tokens + cache_write_tokens + cache_read_tokens,
        };
        add_usage(&mut usage, &message_usage);

        let pricing_model = message_model.unwrap_or(model.as_str());
        total_cost += calculate_usage_cost(&message_usage, claude_cost_rates(pricing_model));
    }

    usage.total_tokens = usage.input_tokens
        + usage.output_tokens
        + usage.cache_write_tokens
        + usage.cache_read_tokens;
    if usage.total_tokens == 0 {
        return Ok(None);
    }

    let session_id = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let timestamp = if first_timestamp > 0 {
        first_timestamp
    } else {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    };

    Ok(Some(LocalUsageSessionSummary {
        session_id,
        timestamp,
        model,
        usage,
        cost: total_cost,
        summary,
    }))
}

fn scan_file(
    path: &Path,
    daily: &mut HashMap<String, DailyTotals>,
    model_totals: &mut HashMap<String, i64>,
    workspace_path: Option<&Path>,
) -> Result<(), String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => {
            return Ok(());
        }
    };
    let reader = BufReader::new(file);
    let mut previous_totals: Option<UsageTotals> = None;
    let mut current_model: Option<String> = None;
    let mut last_activity_ms: Option<i64> = None;
    let mut seen_runs: HashSet<i64> = HashSet::new();
    let mut match_known = workspace_path.is_none();
    let mut matches_workspace = workspace_path.is_none();

    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => continue,
        };
        if line.len() > 512_000 {
            continue;
        }

        let value = match serde_json::from_str::<Value>(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let entry_type = value
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("");

        if entry_type == "session_meta" || entry_type == "turn_context" {
            if let Some(cwd) = extract_cwd(&value) {
                if let Some(filter) = workspace_path {
                    matches_workspace = path_matches_workspace(&cwd, filter);
                    match_known = true;
                    if !matches_workspace {
                        break;
                    }
                }
            }
        }

        if entry_type == "turn_context" {
            if let Some(model) = extract_model_from_turn_context(&value) {
                current_model = Some(model);
            }
            continue;
        }

        if entry_type == "session_meta" {
            continue;
        }

        if !matches_workspace {
            if match_known {
                break;
            }
            continue;
        }

        if !match_known {
            continue;
        }

        if entry_type == "event_msg" || entry_type.is_empty() {
            let payload = value.get("payload").and_then(|value| value.as_object());
            let payload_type = payload
                .and_then(|payload| payload.get("type"))
                .and_then(|value| value.as_str());

            if payload_type == Some("agent_message") {
                if let Some(timestamp_ms) = read_timestamp_ms(&value) {
                    if seen_runs.insert(timestamp_ms) {
                        if let Some(day_key) = day_key_for_timestamp_ms(timestamp_ms) {
                            if let Some(entry) = daily.get_mut(&day_key) {
                                entry.agent_runs += 1;
                            }
                        }
                    }
                    track_activity(daily, &mut last_activity_ms, timestamp_ms);
                }
                continue;
            }

            if payload_type == Some("agent_reasoning") {
                if let Some(timestamp_ms) = read_timestamp_ms(&value) {
                    track_activity(daily, &mut last_activity_ms, timestamp_ms);
                }
                continue;
            }

            if payload_type != Some("token_count") {
                continue;
            }

            let info = payload
                .and_then(|payload| payload.get("info"))
                .and_then(|v| v.as_object());
            let (input, cached, output, used_total) = if let Some(info) = info {
                if let Some(total) = find_usage_map(info, &["total_token_usage", "totalTokenUsage"])
                {
                    (
                        read_i64(total, &["input_tokens", "inputTokens"]),
                        read_i64(
                            total,
                            &[
                                "cached_input_tokens",
                                "cache_read_input_tokens",
                                "cachedInputTokens",
                                "cacheReadInputTokens",
                            ],
                        ),
                        read_i64(total, &["output_tokens", "outputTokens"]),
                        true,
                    )
                } else if let Some(last) =
                    find_usage_map(info, &["last_token_usage", "lastTokenUsage"])
                {
                    (
                        read_i64(last, &["input_tokens", "inputTokens"]),
                        read_i64(
                            last,
                            &[
                                "cached_input_tokens",
                                "cache_read_input_tokens",
                                "cachedInputTokens",
                                "cacheReadInputTokens",
                            ],
                        ),
                        read_i64(last, &["output_tokens", "outputTokens"]),
                        false,
                    )
                } else {
                    continue;
                }
            } else {
                continue;
            };

            let mut delta = UsageTotals {
                input,
                cached,
                output,
            };

            if used_total {
                let prev = previous_totals.unwrap_or_default();
                delta = UsageTotals {
                    input: (input - prev.input).max(0),
                    cached: (cached - prev.cached).max(0),
                    output: (output - prev.output).max(0),
                };
                previous_totals = Some(UsageTotals {
                    input,
                    cached,
                    output,
                });
            } else {
                // Some streams emit `last_token_usage` deltas between `total_token_usage` snapshots.
                // Treat those as already-counted to avoid double-counting when the next total arrives.
                let mut next = previous_totals.unwrap_or_default();
                next.input += delta.input;
                next.cached += delta.cached;
                next.output += delta.output;
                previous_totals = Some(next);
            }

            if delta.input == 0 && delta.cached == 0 && delta.output == 0 {
                continue;
            }

            let timestamp_ms = read_timestamp_ms(&value);
            if let Some(day_key) = timestamp_ms.and_then(|ms| day_key_for_timestamp_ms(ms)) {
                if let Some(entry) = daily.get_mut(&day_key) {
                    let cached = delta.cached.min(delta.input);
                    entry.input += delta.input;
                    entry.cached += cached;
                    entry.output += delta.output;

                    let model = current_model
                        .clone()
                        .or_else(|| extract_model_from_token_count(&value))
                        .unwrap_or_else(|| "unknown".to_string());
                    *model_totals.entry(model).or_insert(0) += delta.input + delta.output;
                }
            }

            if let Some(timestamp_ms) = timestamp_ms {
                track_activity(daily, &mut last_activity_ms, timestamp_ms);
            }
            continue;
        }

        if entry_type == "response_item" {
            let payload = value.get("payload").and_then(|value| value.as_object());
            let payload_type = payload
                .and_then(|payload| payload.get("type"))
                .and_then(|value| value.as_str());
            let role = payload
                .and_then(|payload| payload.get("role"))
                .and_then(|value| value.as_str())
                .unwrap_or("");

            if role == "assistant" {
                if let Some(timestamp_ms) = read_timestamp_ms(&value) {
                    if seen_runs.insert(timestamp_ms) {
                        if let Some(day_key) = day_key_for_timestamp_ms(timestamp_ms) {
                            if let Some(entry) = daily.get_mut(&day_key) {
                                entry.agent_runs += 1;
                            }
                        }
                    }
                    track_activity(daily, &mut last_activity_ms, timestamp_ms);
                }
            } else if payload_type != Some("message") {
                if let Some(timestamp_ms) = read_timestamp_ms(&value) {
                    track_activity(daily, &mut last_activity_ms, timestamp_ms);
                }
            }
        }
    }

    Ok(())
}

fn extract_model_from_turn_context(value: &Value) -> Option<String> {
    let payload = value.get("payload").and_then(|value| value.as_object())?;
    if let Some(model) = payload.get("model").and_then(|value| value.as_str()) {
        return Some(model.to_string());
    }
    let info = payload.get("info").and_then(|value| value.as_object())?;
    info.get("model")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

fn extract_model_from_token_count(value: &Value) -> Option<String> {
    let payload = value.get("payload").and_then(|value| value.as_object())?;
    let info = payload.get("info").and_then(|value| value.as_object());
    let model = info
        .and_then(|info| {
            info.get("model")
                .or_else(|| info.get("model_name"))
                .and_then(|value| value.as_str())
        })
        .or_else(|| payload.get("model").and_then(|value| value.as_str()))
        .or_else(|| value.get("model").and_then(|value| value.as_str()));
    model.map(|value| value.to_string())
}

fn find_usage_map<'a>(
    info: &'a serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<&'a serde_json::Map<String, Value>> {
    keys.iter()
        .find_map(|key| info.get(*key).and_then(|value| value.as_object()))
}

fn read_i64(map: &serde_json::Map<String, Value>, keys: &[&str]) -> i64 {
    keys.iter()
        .find_map(|key| map.get(*key))
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_f64().map(|value| value as i64))
        })
        .unwrap_or(0)
}

fn read_timestamp_ms(value: &Value) -> Option<i64> {
    let raw = value.get("timestamp")?;
    if let Some(text) = raw.as_str() {
        return DateTime::parse_from_rfc3339(text)
            .map(|value| value.timestamp_millis())
            .ok();
    }
    let numeric = raw
        .as_i64()
        .or_else(|| raw.as_f64().map(|value| value as i64))?;
    if numeric > 0 && numeric < 1_000_000_000_000 {
        return Some(numeric * 1000);
    }
    Some(numeric)
}

fn track_activity(
    daily: &mut HashMap<String, DailyTotals>,
    last_activity_ms: &mut Option<i64>,
    timestamp_ms: i64,
) {
    if let Some(prev_ms) = *last_activity_ms {
        let delta = timestamp_ms - prev_ms;
        if delta > 0 && delta <= MAX_ACTIVITY_GAP_MS {
            if let Some(day_key) = day_key_for_timestamp_ms(timestamp_ms) {
                if let Some(entry) = daily.get_mut(&day_key) {
                    entry.agent_ms += delta;
                }
            }
        }
    }
    *last_activity_ms = Some(timestamp_ms);
}

fn day_key_for_timestamp_ms(timestamp_ms: i64) -> Option<String> {
    let utc = Utc.timestamp_millis_opt(timestamp_ms).single()?;
    Some(utc.with_timezone(&Local).format("%Y-%m-%d").to_string())
}

fn extract_cwd(value: &Value) -> Option<String> {
    value
        .get("payload")
        .and_then(|payload| payload.get("cwd"))
        .and_then(|cwd| cwd.as_str())
        .map(|cwd| cwd.to_string())
}

#[cfg(windows)]
fn normalize_workspace_match_path(value: &str) -> String {
    value
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn path_matches_workspace(cwd: &str, workspace_path: &Path) -> bool {
    #[cfg(windows)]
    {
        let cwd_path = normalize_workspace_match_path(cwd);
        let workspace = normalize_workspace_match_path(&workspace_path.to_string_lossy());
        if cwd_path.is_empty() || workspace.is_empty() {
            return false;
        }
        if cwd_path == workspace {
            return true;
        }
        return cwd_path
            .strip_prefix(&workspace)
            .map(|rest| rest.starts_with('/'))
            .unwrap_or(false);
    }

    #[cfg(not(windows))]
    {
        let cwd_path = Path::new(cwd);
        cwd_path == workspace_path || cwd_path.starts_with(workspace_path)
    }
}

fn make_day_keys(days: u32) -> Vec<String> {
    let today = Local::now().date_naive();
    (0..days)
        .rev()
        .map(|offset| {
            let day = today - Duration::days(offset as i64);
            day.format("%Y-%m-%d").to_string()
        })
        .collect()
}

fn resolve_codex_sessions_root(codex_home_override: Option<PathBuf>) -> Option<PathBuf> {
    codex_home_override
        .or_else(resolve_default_codex_home)
        .map(|home| home.join("sessions"))
}

fn resolve_sessions_roots(
    workspaces: &HashMap<String, WorkspaceEntry>,
    workspace_path: Option<&Path>,
) -> Vec<PathBuf> {
    if let Some(workspace_path) = workspace_path {
        let codex_home_override =
            resolve_workspace_codex_home_for_path(workspaces, Some(workspace_path));
        return resolve_codex_sessions_root(codex_home_override)
            .into_iter()
            .collect();
    }

    let mut roots = Vec::new();
    let mut seen = HashSet::new();

    if let Some(root) = resolve_codex_sessions_root(None) {
        if seen.insert(root.clone()) {
            roots.push(root);
        }
    }

    for entry in workspaces.values() {
        let parent_entry = entry
            .parent_id
            .as_ref()
            .and_then(|parent_id| workspaces.get(parent_id));
        let Some(codex_home) = resolve_workspace_codex_home(entry, parent_entry) else {
            continue;
        };
        if let Some(root) = resolve_codex_sessions_root(Some(codex_home)) {
            if seen.insert(root.clone()) {
                roots.push(root);
            }
        }
    }

    roots
}

fn resolve_workspace_codex_home_for_path(
    workspaces: &HashMap<String, crate::types::WorkspaceEntry>,
    workspace_path: Option<&Path>,
) -> Option<PathBuf> {
    let workspace_path = workspace_path?;
    let entry = workspaces
        .values()
        .filter(|entry| {
            let entry_path = Path::new(&entry.path);
            workspace_path == entry_path || workspace_path.starts_with(entry_path)
        })
        .max_by_key(|entry| entry.path.len())?;

    let parent_entry = entry
        .parent_id
        .as_ref()
        .and_then(|parent_id| workspaces.get(parent_id));

    resolve_workspace_codex_home(entry, parent_entry)
}

fn day_dir_for_key(root: &Path, day_key: &str) -> PathBuf {
    let mut parts = day_key.split('-');
    let year = parts.next().unwrap_or("1970");
    let month = parts.next().unwrap_or("01");
    let day = parts.next().unwrap_or("01");
    root.join(year).join(month).join(day)
}

/// Get Claude Code projects directory (~/.claude/projects/)
fn claude_projects_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".claude").join("projects"))
}

/// Scan Claude Code session files for usage statistics.
/// Claude Code stores sessions in ~/.claude/projects/{encoded-path}/{session-id}.jsonl
fn scan_claude_projects(
    day_keys: &[String],
    daily: &mut HashMap<String, DailyTotals>,
    model_totals: &mut HashMap<String, i64>,
    workspace_path: Option<&Path>,
) -> Result<(), String> {
    let projects_dir = match claude_projects_dir() {
        Some(dir) if dir.exists() => dir,
        _ => return Ok(()),
    };

    // Convert day_keys to a set for quick lookup
    let day_set: HashSet<&str> = day_keys.iter().map(|s| s.as_str()).collect();

    // If workspace_path is specified, only scan that project's directory
    if let Some(workspace_path) = workspace_path {
        let encoded = encode_claude_project_path(&workspace_path.to_string_lossy());
        let project_dir = projects_dir.join(&encoded);
        if project_dir.exists() {
            scan_claude_project_dir(&project_dir, &day_set, daily, model_totals)?;
        }
        return Ok(());
    }

    // Otherwise, scan all project directories
    let entries = match std::fs::read_dir(&projects_dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_claude_project_dir(&path, &day_set, daily, model_totals)?;
        }
    }

    Ok(())
}

/// Encode a filesystem path to Claude's project directory name.
/// All non-alphanumeric characters (except hyphens) become hyphens.
fn encode_claude_project_path(path: &str) -> String {
    path.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Scan all JSONL files in a Claude project directory
fn scan_claude_project_dir(
    project_dir: &Path,
    day_set: &HashSet<&str>,
    daily: &mut HashMap<String, DailyTotals>,
    model_totals: &mut HashMap<String, i64>,
) -> Result<(), String> {
    let entries = match std::fs::read_dir(project_dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        // Only .jsonl files, skip agent-* subagent sessions
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                scan_claude_file(&path, day_set, daily, model_totals)?;
            }
        }
    }

    Ok(())
}

/// Scan a single Claude Code JSONL file for usage statistics.
/// Claude Code format has token info in message.usage and model in message.model
fn scan_claude_file(
    path: &Path,
    day_set: &HashSet<&str>,
    daily: &mut HashMap<String, DailyTotals>,
    model_totals: &mut HashMap<String, i64>,
) -> Result<(), String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return Ok(()),
    };
    let reader = BufReader::new(file);
    let mut last_activity_ms: Option<i64> = None;
    let mut seen_runs: HashSet<i64> = HashSet::new();

    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => continue,
        };
        if line.len() > 512_000 {
            continue;
        }

        let value = match serde_json::from_str::<Value>(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let entry_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");

        // Only process assistant messages which contain usage info
        if entry_type != "assistant" {
            // Track user messages for activity and agent runs
            if entry_type == "user" {
                if let Some(timestamp_ms) = read_claude_timestamp(&value) {
                    if let Some(day_key) = day_key_for_timestamp_ms(timestamp_ms) {
                        if day_set.contains(day_key.as_str()) {
                            track_activity(daily, &mut last_activity_ms, timestamp_ms);
                        }
                    }
                }
            }
            continue;
        }

        // Extract message object which contains model and usage
        let message = match value.get("message").and_then(|v| v.as_object()) {
            Some(msg) => msg,
            None => continue,
        };

        // Extract model name
        let model = message
            .get("model")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Extract usage info
        let usage = match message.get("usage").and_then(|v| v.as_object()) {
            Some(u) => u,
            None => continue,
        };

        // Read token counts - Claude Code uses input_tokens, output_tokens, cache_read_input_tokens
        let input_tokens = usage
            .get("input_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let output_tokens = usage
            .get("output_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let cache_read = usage
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let cache_creation = usage
            .get("cache_creation_input_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        // Skip if no meaningful usage
        if input_tokens == 0 && output_tokens == 0 {
            continue;
        }

        // Get timestamp and day key
        let timestamp_ms = match read_claude_timestamp(&value) {
            Some(ts) => ts,
            None => continue,
        };

        let day_key = match day_key_for_timestamp_ms(timestamp_ms) {
            Some(key) => key,
            None => continue,
        };

        // Only process if this day is in our range
        if !day_set.contains(day_key.as_str()) {
            continue;
        }

        // Update daily totals
        if let Some(entry) = daily.get_mut(&day_key) {
            entry.input += input_tokens;
            entry.cached += cache_read + cache_creation;
            entry.output += output_tokens;

            // Count as agent run
            if seen_runs.insert(timestamp_ms) {
                entry.agent_runs += 1;
            }
        }

        // Update model totals
        if let Some(model_name) = model {
            let tokens = input_tokens + output_tokens;
            *model_totals.entry(model_name).or_insert(0) += tokens;
        }

        track_activity(daily, &mut last_activity_ms, timestamp_ms);
    }

    Ok(())
}

/// Read timestamp from Claude Code format (ISO 8601 string)
fn read_claude_timestamp(value: &Value) -> Option<i64> {
    value
        .get("timestamp")
        .and_then(|v| v.as_str())
        .and_then(|ts| {
            DateTime::parse_from_rfc3339(ts)
                .ok()
                .map(|dt| dt.timestamp_millis())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{WorkspaceKind, WorkspaceSettings};
    use chrono::NaiveDateTime;
    use std::io::Write;
    use std::path::Path;
    use std::{fs, path::PathBuf};
    use uuid::Uuid;

    fn write_temp_jsonl(lines: &[&str]) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("mossx-local-usage-test-{}.jsonl", Uuid::new_v4()));
        let mut file = File::create(&path).expect("create temp jsonl");
        for line in lines {
            writeln!(file, "{line}").expect("write jsonl line");
        }
        path
    }

    fn make_temp_sessions_root() -> PathBuf {
        let mut root = std::env::temp_dir();
        root.push(format!("mossx-local-usage-root-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn write_session_file(root: &Path, day_key: &str, lines: &[String]) -> PathBuf {
        let day_dir = day_dir_for_key(root, day_key);
        fs::create_dir_all(&day_dir).expect("create day dir");
        let path = day_dir.join(format!("usage-{}.jsonl", Uuid::new_v4()));
        let mut file = File::create(&path).expect("create session jsonl");
        for line in lines {
            writeln!(file, "{line}").expect("write jsonl line");
        }
        path
    }

    fn write_named_session_file(
        root: &Path,
        day_key: &str,
        session_id: &str,
        lines: &[String],
    ) -> PathBuf {
        let day_dir = day_dir_for_key(root, day_key);
        fs::create_dir_all(&day_dir).expect("create day dir");
        let path = day_dir.join(format!("{session_id}.jsonl"));
        let mut file = File::create(&path).expect("create session jsonl");
        for line in lines {
            writeln!(file, "{line}").expect("write jsonl line");
        }
        path
    }

    #[test]
    fn scan_file_does_not_double_count_last_and_total_usage() {
        let day_key = "2026-01-19";
        let path = write_temp_jsonl(&[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#,
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#,
        ]);

        let mut daily: HashMap<String, DailyTotals> = HashMap::new();
        daily.insert(day_key.to_string(), DailyTotals::default());
        let mut model_totals: HashMap<String, i64> = HashMap::new();
        scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

        let totals = daily.get(day_key).copied().unwrap_or_default();
        assert_eq!(totals.input, 10);
        assert_eq!(totals.output, 5);
    }

    #[test]
    fn scan_file_counts_last_deltas_before_total_snapshot_once() {
        let day_key = "2026-01-19";
        let path = write_temp_jsonl(&[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#,
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":20,"cached_input_tokens":0,"output_tokens":10}}}}"#,
        ]);

        let mut daily: HashMap<String, DailyTotals> = HashMap::new();
        daily.insert(day_key.to_string(), DailyTotals::default());
        let mut model_totals: HashMap<String, i64> = HashMap::new();
        scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

        let totals = daily.get(day_key).copied().unwrap_or_default();
        assert_eq!(totals.input, 20);
        assert_eq!(totals.output, 10);
    }

    #[test]
    fn scan_file_does_not_double_count_last_between_total_snapshots() {
        let day_key = "2026-01-19";
        let path = write_temp_jsonl(&[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#,
            r#"{"timestamp":"2026-01-19T12:00:01.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":2,"cached_input_tokens":0,"output_tokens":1}}}}"#,
            r#"{"timestamp":"2026-01-19T12:00:02.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":12,"cached_input_tokens":0,"output_tokens":6}}}}"#,
        ]);

        let mut daily: HashMap<String, DailyTotals> = HashMap::new();
        daily.insert(day_key.to_string(), DailyTotals::default());
        let mut model_totals: HashMap<String, i64> = HashMap::new();
        scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

        let totals = daily.get(day_key).copied().unwrap_or_default();
        assert_eq!(totals.input, 12);
        assert_eq!(totals.output, 6);
    }

    #[test]
    fn scan_file_tracks_agent_time_from_activity() {
        let day_key = "2026-01-19";
        let path = write_temp_jsonl(&[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}}}"#,
            r#"{"timestamp":"2026-01-19T12:00:05.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2,"cached_input_tokens":0,"output_tokens":2}}}}"#,
        ]);

        let mut daily: HashMap<String, DailyTotals> = HashMap::new();
        daily.insert(day_key.to_string(), DailyTotals::default());
        let mut model_totals: HashMap<String, i64> = HashMap::new();
        scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

        let totals = daily.get(day_key).copied().unwrap_or_default();
        assert_eq!(totals.agent_ms, 5_000);
    }

    #[test]
    fn scan_file_counts_runs_from_assistant_messages() {
        let day_key = "2026-01-19";
        let path = write_temp_jsonl(&[
            r#"{"timestamp":"2026-01-19T12:00:05.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"a"}]}}"#,
            r#"{"timestamp":"2026-01-19T12:00:10.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"b"}]}}"#,
        ]);

        let mut daily: HashMap<String, DailyTotals> = HashMap::new();
        daily.insert(day_key.to_string(), DailyTotals::default());
        let mut model_totals: HashMap<String, i64> = HashMap::new();
        scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

        let totals = daily.get(day_key).copied().unwrap_or_default();
        assert_eq!(totals.agent_runs, 2);
    }

    #[test]
    fn scan_file_ignores_large_gaps_between_activity() {
        let day_key = "2026-01-19";
        let path = write_temp_jsonl(&[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}}}"#,
            r#"{"timestamp":"2026-01-19T12:10:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2,"cached_input_tokens":0,"output_tokens":2}}}}"#,
            r#"{"timestamp":"2026-01-19T12:10:10.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":3,"cached_input_tokens":0,"output_tokens":3}}}}"#,
        ]);

        let mut daily: HashMap<String, DailyTotals> = HashMap::new();
        daily.insert(day_key.to_string(), DailyTotals::default());
        let mut model_totals: HashMap<String, i64> = HashMap::new();
        scan_file(&path, &mut daily, &mut model_totals, None).expect("scan file");

        let totals = daily.get(day_key).copied().unwrap_or_default();
        assert_eq!(totals.agent_ms, 10_000);
    }

    #[test]
    fn scan_file_skips_workspace_mismatch() {
        let day_key = "2026-01-19";
        let path = write_temp_jsonl(&[
            r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/project-alpha"}}"#,
            r#"{"timestamp":"2026-01-19T12:00:10.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}}"#,
            r#"{"timestamp":"2026-01-19T12:00:12.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}}}"#,
        ]);

        let mut daily: HashMap<String, DailyTotals> = HashMap::new();
        daily.insert(day_key.to_string(), DailyTotals::default());
        let mut model_totals: HashMap<String, i64> = HashMap::new();
        scan_file(
            &path,
            &mut daily,
            &mut model_totals,
            Some(Path::new("/tmp/other-project")),
        )
        .expect("scan file");

        let totals = daily.get(day_key).copied().unwrap_or_default();
        assert_eq!(totals.agent_ms, 0);
        assert_eq!(totals.input, 0);
    }

    #[test]
    fn scan_local_usage_aggregates_multiple_session_roots() {
        let day_keys = make_day_keys(2);
        let day_key = day_keys
            .last()
            .cloned()
            .unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
        let naive =
            NaiveDateTime::parse_from_str(&format!("{day_key} 12:00:00"), "%Y-%m-%d %H:%M:%S")
                .expect("timestamp");
        let timestamp_ms = Local
            .from_local_datetime(&naive)
            .single()
            .expect("timestamp")
            .timestamp_millis();

        let root_a = make_temp_sessions_root();
        let root_b = make_temp_sessions_root();

        let line_a = format!(
            r#"{{"timestamp":{timestamp_ms},"payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":5,"cached_input_tokens":0,"output_tokens":2}}}}}}}}"#
        );
        let line_b = format!(
            r#"{{"timestamp":{timestamp_ms},"payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":3,"cached_input_tokens":0,"output_tokens":1}}}}}}}}"#
        );

        write_session_file(&root_a, &day_key, &[line_a]);
        write_session_file(&root_b, &day_key, &[line_b]);

        let snapshot =
            scan_local_usage_core(2, None, &[root_a, root_b], false).expect("scan usage");
        let day = snapshot
            .days
            .iter()
            .find(|entry| entry.day == day_key)
            .expect("day entry");

        assert_eq!(day.input_tokens, 8);
        assert_eq!(day.output_tokens, 3);
        assert_eq!(snapshot.totals.last30_days_tokens, 11);
    }

    #[test]
    fn resolve_sessions_roots_includes_workspace_overrides() {
        let mut workspaces = HashMap::new();
        let mut settings_a = WorkspaceSettings::default();
        settings_a.codex_home = Some(
            std::env::temp_dir()
                .join(format!("codex-home-a-{}", Uuid::new_v4()))
                .to_string_lossy()
                .to_string(),
        );
        let entry_a = WorkspaceEntry {
            id: "a".to_string(),
            name: "A".to_string(),
            path: "/tmp/project-a".to_string(),
            codex_bin: None,
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: settings_a,
        };
        let mut settings_b = WorkspaceSettings::default();
        settings_b.codex_home = Some(
            std::env::temp_dir()
                .join(format!("codex-home-b-{}", Uuid::new_v4()))
                .to_string_lossy()
                .to_string(),
        );
        let entry_b = WorkspaceEntry {
            id: "b".to_string(),
            name: "B".to_string(),
            path: "/tmp/project-b".to_string(),
            codex_bin: None,
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: settings_b,
        };
        workspaces.insert(entry_a.id.clone(), entry_a.clone());
        workspaces.insert(entry_b.id.clone(), entry_b.clone());

        let roots = resolve_sessions_roots(&workspaces, None);
        let expected_a = PathBuf::from(entry_a.settings.codex_home.unwrap()).join("sessions");
        let expected_b = PathBuf::from(entry_b.settings.codex_home.unwrap()).join("sessions");

        assert!(roots.iter().any(|root| root == &expected_a));
        assert!(roots.iter().any(|root| root == &expected_b));
    }

    #[test]
    fn load_codex_session_entries_reads_matching_workspace_session() {
        let root = make_temp_sessions_root();
        let day_key = "2026-01-19";
        let workspace_path = Path::new("/tmp/project-alpha");
        write_named_session_file(
            &root,
            day_key,
            "session-alpha",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/project-alpha"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:05.000Z","type":"response_item","payload":{"type":"reasoning","id":"reason-1","summary":"Inspect","content":"Inspect workspace"}}"#
                    .to_string(),
            ],
        );

        let entries = load_codex_session_entries("session-alpha", workspace_path, &[root])
            .expect("load session entries");

        assert_eq!(entries.len(), 2);
        assert_eq!(
            entries[0]["type"],
            Value::String("session_meta".to_string())
        );
        assert_eq!(
            entries[1]["payload"]["type"],
            Value::String("reasoning".to_string())
        );
    }

    #[test]
    fn load_codex_session_entries_matches_rollout_filename_by_session_meta_id() {
        let root = make_temp_sessions_root();
        let day_key = "2026-01-19";
        let workspace_path = Path::new("/tmp/project-alpha");
        write_named_session_file(
            &root,
            day_key,
            "rollout-2026-01-19T12-00-00-session-alpha",
            &[
                r#"{"timestamp":"2026-01-19T12:00:00.000Z","type":"session_meta","payload":{"id":"session-alpha","cwd":"/tmp/project-alpha"}}"#
                    .to_string(),
                r#"{"timestamp":"2026-01-19T12:00:05.000Z","type":"response_item","payload":{"type":"reasoning","id":"reason-1","summary":"Inspect","content":"Inspect workspace"}}"#
                    .to_string(),
            ],
        );

        let entries = load_codex_session_entries("session-alpha", workspace_path, &[root])
            .expect("load session entries");

        assert_eq!(entries.len(), 2);
        assert_eq!(
            entries[0]["payload"]["id"],
            Value::String("session-alpha".to_string())
        );
        assert_eq!(
            entries[1]["payload"]["type"],
            Value::String("reasoning".to_string())
        );
    }

    #[cfg(windows)]
    #[test]
    fn path_matches_workspace_handles_drive_case_and_separator_variants() {
        let workspace = Path::new("C:\\Users\\Chen\\project");
        assert!(path_matches_workspace("c:/users/chen/project", workspace));
        assert!(path_matches_workspace(
            "c:\\users\\chen\\project\\src",
            workspace
        ));
        assert!(!path_matches_workspace(
            "c:\\users\\chen\\project-other",
            workspace
        ));
    }
}
