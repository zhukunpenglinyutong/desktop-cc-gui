#[allow(dead_code)]
#[path = "../app_paths.rs"]
mod app_paths;
#[allow(dead_code)]
#[path = "../backend/mod.rs"]
mod backend;
#[path = "../codex/args.rs"]
mod codex_args;
#[path = "../codex/collaboration_policy.rs"]
mod codex_collaboration_policy;
#[path = "../codex/config.rs"]
mod codex_config;
#[path = "../codex/home.rs"]
mod codex_home;
#[path = "../codex/thread_mode_state.rs"]
mod codex_thread_mode_state;
#[path = "cc_gui_daemon/daemon_state.rs"]
mod daemon_state;
#[path = "cc_gui_daemon/engine_bridge.rs"]
mod engine;
#[path = "../files/io.rs"]
mod file_io;
#[path = "../files/ops.rs"]
mod file_ops;
#[path = "../files/policy.rs"]
mod file_policy;
#[path = "../git_utils.rs"]
mod git_utils;
// `local_usage.rs` is shared with the desktop Tauri app and references
// `crate::state::AppState` in command wrappers. The daemon only reuses the
// workspace-backed filesystem helpers, so a minimal stub keeps the shared
// module compilable here without pulling the full desktop app state graph.
mod state {
    use std::collections::HashMap;
    use tokio::sync::Mutex;

    use crate::types::WorkspaceEntry;

    pub(crate) struct AppState {
        pub(crate) workspaces: Mutex<HashMap<String, WorkspaceEntry>>,
    }
}
#[path = "../local_usage.rs"]
mod local_usage;
#[path = "../rules.rs"]
mod rules;
#[path = "../shared/mod.rs"]
mod shared;
#[path = "../storage.rs"]
mod storage;
#[path = "../text_encoding.rs"]
mod text_encoding;
#[allow(dead_code)]
#[path = "../types.rs"]
mod types;
#[path = "../utils.rs"]
mod utils;
#[path = "cc_gui_daemon/web_service_runtime.rs"]
mod web_service_runtime;
#[path = "../workspaces/settings.rs"]
mod workspace_settings;

// Provide feature-style module paths for shared cores when compiled in the daemon.
mod codex {
    pub(crate) type WorkspaceSession = crate::backend::app_server::WorkspaceSession;
    pub(crate) mod args {
        pub(crate) use crate::codex_args::*;
    }
    pub(crate) mod config {
        pub(crate) use crate::codex_config::*;
    }
    pub(crate) mod home {
        pub(crate) use crate::codex_home::*;
    }
    pub(crate) mod collaboration_policy {
        pub(crate) use crate::codex_collaboration_policy::*;
    }
    pub(crate) mod thread_mode_state {
        pub(crate) use crate::codex_thread_mode_state::*;
    }
}

mod files {
    pub(crate) mod io {
        pub(crate) use crate::file_io::*;
    }
    pub(crate) mod ops {
        pub(crate) use crate::file_ops::*;
    }
    pub(crate) mod policy {
        pub(crate) use crate::file_policy::*;
    }
}

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs::File;
use std::io::Read;
use std::net::SocketAddr;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use ignore::WalkBuilder;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command;
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};
use uuid::Uuid;

use backend::app_server::{spawn_workspace_session, WorkspaceSession};
use backend::events::{AppServerEvent, EventSink, TerminalOutput};
use shared::{
    codex_core, files_core, git_core, proxy_core, settings_core, thread_titles_core,
    workspaces_core, worktree_core,
};
use storage::{read_settings, read_workspaces};
use text_encoding::decode_text_bytes;
use types::{
    AppSettings, BranchInfo, GitBranchCompareCommitSets, GitBranchListItem, GitCommitDetails,
    GitCommitDiff, GitCommitFileChange, GitFileDiff, GitFileStatus, GitHistoryCommit,
    GitHistoryResponse, GitHubIssue, GitHubIssuesResponse, GitHubPullRequest,
    GitHubPullRequestComment, GitHubPullRequestDiff, GitHubPullRequestsResponse, GitLogEntry,
    GitLogResponse, GitPrWorkflowDefaults, GitPrWorkflowResult, GitPrWorkflowStage,
    GitPushPreviewResponse, WorkspaceEntry, WorkspaceInfo, WorkspaceSettings, WorktreeSetupStatus,
};
use web_service_runtime::WebServiceRuntime;
use workspace_settings::apply_workspace_settings_update;

const DEFAULT_LISTEN_ADDR: &str = "127.0.0.1:4732";
const EVENT_FORWARDER_TIMEOUT_SECS: u64 = 30 * 60;
const GEMINI_POST_COMPLETION_REASONING_GRACE_MS: u64 = 8_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenCodeSessionEntry {
    session_id: String,
    title: String,
    updated_label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_at: Option<i64>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum GeminiRenderLane {
    Text,
    Reasoning,
    Tool,
    Other,
}

impl Default for GeminiRenderLane {
    fn default() -> Self {
        Self::Other
    }
}

#[derive(Default)]
struct GeminiRenderRoutingState {
    last_render_lane: GeminiRenderLane,
    text_run_index: usize,
    reasoning_run_index: usize,
    active_text_item_id: Option<String>,
    active_reasoning_item_id: Option<String>,
    saw_text_delta: bool,
}

fn next_gemini_routed_item_id(
    state: &mut GeminiRenderRoutingState,
    render_lane: GeminiRenderLane,
    base_item_id: &str,
) -> String {
    if matches!(render_lane, GeminiRenderLane::Text)
        && (state.last_render_lane != GeminiRenderLane::Text || state.active_text_item_id.is_none())
    {
        state.text_run_index += 1;
        let text_item_id = if state.text_run_index == 1 {
            base_item_id.to_string()
        } else {
            format!("{base_item_id}:text-{}", state.text_run_index)
        };
        state.active_text_item_id = Some(text_item_id);
    }

    if matches!(render_lane, GeminiRenderLane::Reasoning)
        && (state.last_render_lane != GeminiRenderLane::Reasoning
            || state.active_reasoning_item_id.is_none())
    {
        state.reasoning_run_index += 1;
        state.active_reasoning_item_id = Some(format!(
            "{base_item_id}:reasoning-seg-{}",
            state.reasoning_run_index
        ));
    }

    let routed_item_id = match render_lane {
        GeminiRenderLane::Text => state
            .active_text_item_id
            .clone()
            .unwrap_or_else(|| base_item_id.to_string()),
        GeminiRenderLane::Reasoning => state
            .active_reasoning_item_id
            .clone()
            .unwrap_or_else(|| base_item_id.to_string()),
        GeminiRenderLane::Tool | GeminiRenderLane::Other => base_item_id.to_string(),
    };

    if !matches!(render_lane, GeminiRenderLane::Other) {
        state.last_render_lane = render_lane;
        if !matches!(render_lane, GeminiRenderLane::Reasoning) {
            state.active_reasoning_item_id = None;
        }
        if !matches!(render_lane, GeminiRenderLane::Text) {
            state.active_text_item_id = None;
        }
    }

    routed_item_id
}

fn spawn_with_client(
    event_sink: DaemonEventSink,
    client_version: String,
    entry: WorkspaceEntry,
    default_bin: Option<String>,
    codex_args: Option<String>,
    codex_home: Option<PathBuf>,
) -> impl std::future::Future<Output = Result<Arc<WorkspaceSession>, String>> {
    spawn_workspace_session(
        entry,
        default_bin,
        codex_args,
        codex_home,
        client_version,
        event_sink,
    )
}

#[derive(Clone)]
struct DaemonEventSink {
    tx: broadcast::Sender<DaemonEvent>,
}

#[derive(Clone)]
enum DaemonEvent {
    AppServer(AppServerEvent),
    #[allow(dead_code)]
    TerminalOutput(TerminalOutput),
}

impl EventSink for DaemonEventSink {
    fn emit_app_server_event(&self, event: AppServerEvent) {
        let _ = self.tx.send(DaemonEvent::AppServer(event));
    }

    fn emit_terminal_output(&self, event: TerminalOutput) {
        let _ = self.tx.send(DaemonEvent::TerminalOutput(event));
    }
}

struct DaemonConfig {
    listen: SocketAddr,
    token: Option<String>,
    data_dir: PathBuf,
}

struct DaemonState {
    data_dir: PathBuf,
    workspaces: Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    storage_path: PathBuf,
    settings_path: PathBuf,
    app_settings: Mutex<AppSettings>,
    codex_runtime_reload_lock: Mutex<()>,
    web_service_runtime: Mutex<WebServiceRuntime>,
    event_sink: DaemonEventSink,
    codex_login_cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
    engine_manager: engine::EngineManager,
    active_engine: Mutex<engine::EngineType>,
}

#[derive(Serialize, Deserialize)]
struct WorkspaceFileResponse {
    content: String,
    truncated: bool,
}

#[derive(Serialize, Deserialize)]
struct WorkspaceFilesResponse {
    files: Vec<String>,
    directories: Vec<String>,
    #[serde(default)]
    gitignored_files: Vec<String>,
    #[serde(default)]
    gitignored_directories: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct ExternalSpecFileResponse {
    exists: bool,
    content: String,
    truncated: bool,
}

fn should_always_skip(name: &str) -> bool {
    name == ".git"
}

fn normalize_git_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn is_special_dependency_dir_name(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".pnpm-store"
            | ".yarn"
            | "bower_components"
            | "vendor"
            | ".venv"
            | "venv"
            | "env"
            | "__pypackages__"
            | "Pods"
            | "Carthage"
            | ".m2"
            | ".ivy2"
            | ".cargo"
    )
}

fn is_special_build_artifact_dir_name(name: &str) -> bool {
    matches!(
        name,
        "target"
            | "dist"
            | "build"
            | "out"
            | "coverage"
            | ".next"
            | ".nuxt"
            | ".svelte-kit"
            | ".angular"
            | ".parcel-cache"
            | ".turbo"
            | ".cache"
            | ".gradle"
            | "CMakeFiles"
            | "bin"
            | "obj"
            | "__pycache__"
            | ".pytest_cache"
            | ".mypy_cache"
            | ".tox"
            | ".dart_tool"
    ) || name.starts_with("cmake-build-")
}

fn is_special_directory_path(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .map(|name| {
            is_special_dependency_dir_name(name) || is_special_build_artifact_dir_name(name)
        })
        .unwrap_or(false)
}

fn normalized_relative_to_pathbuf(normalized: &str) -> PathBuf {
    let mut path = PathBuf::new();
    for segment in normalized.split('/') {
        if !segment.is_empty() {
            path.push(segment);
        }
    }
    path
}

fn normalize_workspace_relative_directory_path(path: &str) -> Result<String, String> {
    let normalized = path.trim().replace('\\', "/");
    let trimmed = normalized.trim_matches('/');
    if trimmed.is_empty() {
        return Err("Directory path cannot be empty.".to_string());
    }
    let relative = Path::new(trimmed);
    for component in relative.components() {
        match component {
            Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_)
            | Component::CurDir => {
                return Err("Invalid directory path.".to_string());
            }
            Component::Normal(_) => {}
        }
    }
    if trimmed == ".git"
        || trimmed.starts_with(".git/")
        || trimmed.contains("/.git/")
        || trimmed.ends_with("/.git")
    {
        return Err("Cannot access .git directory.".to_string());
    }
    Ok(trimmed.to_string())
}

fn sort_and_dedup_workspace_lists(
    files: &mut Vec<String>,
    directories: &mut Vec<String>,
    gitignored_files: &mut Vec<String>,
    gitignored_directories: &mut Vec<String>,
) {
    files.sort();
    files.dedup();
    directories.sort();
    directories.dedup();
    gitignored_files.sort();
    gitignored_files.dedup();
    gitignored_directories.sort();
    gitignored_directories.dedup();
}

fn sort_and_truncate_named_entries<T>(entries: &mut Vec<(String, T)>, max_entries: usize) {
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    if entries.len() > max_entries {
        entries.truncate(max_entries);
    }
}

const WORKSPACE_SCAN_ENTRY_BUDGET: usize = 30_000;
const WORKSPACE_SCAN_TIME_BUDGET: Duration = Duration::from_millis(1_200);
const WORKSPACE_DIRECTORY_SCAN_BUDGET_MULTIPLIER: usize = 8;

fn workspace_scan_budget_reached(started_at: Instant, scanned_entries: usize) -> bool {
    scanned_entries >= WORKSPACE_SCAN_ENTRY_BUDGET
        || started_at.elapsed() >= WORKSPACE_SCAN_TIME_BUDGET
}

fn normalize_external_spec_root(spec_root: &str) -> Result<PathBuf, String> {
    let trimmed = spec_root.trim();
    if trimmed.is_empty() {
        return Err("Spec root cannot be empty.".to_string());
    }
    let root = PathBuf::from(trimmed);
    if !root.is_absolute() {
        return Err("Spec root must be an absolute path.".to_string());
    }
    let canonical = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve custom spec root: {err}"))?;
    if !canonical.is_dir() {
        return Err("Custom spec root is not a directory.".to_string());
    }
    Ok(canonical)
}

struct ResolvedExternalSpecRoot {
    root: PathBuf,
    exists: bool,
}

fn resolve_external_spec_root(spec_root: &str) -> Result<ResolvedExternalSpecRoot, String> {
    let custom_root = normalize_external_spec_root(spec_root)?;
    let file_name = custom_root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if file_name.eq_ignore_ascii_case("openspec") {
        return Ok(ResolvedExternalSpecRoot {
            root: custom_root,
            exists: true,
        });
    }

    let nested = custom_root.join("openspec");
    if nested.is_dir() {
        let canonical_nested = nested
            .canonicalize()
            .map_err(|err| format!("Failed to resolve custom spec root: {err}"))?;
        return Ok(ResolvedExternalSpecRoot {
            root: canonical_nested,
            exists: true,
        });
    }

    let legacy_root = custom_root.join("changes").is_dir() && custom_root.join("specs").is_dir();
    if legacy_root {
        return Ok(ResolvedExternalSpecRoot {
            root: custom_root,
            exists: true,
        });
    }

    Ok(ResolvedExternalSpecRoot {
        root: nested,
        exists: false,
    })
}

fn resolve_external_spec_logical_path(
    spec_root: &Path,
    logical_path: &str,
) -> Result<PathBuf, String> {
    let normalized = logical_path.trim().replace('\\', "/");
    if normalized == "openspec" {
        return Ok(spec_root.to_path_buf());
    }
    if !normalized.starts_with("openspec/") {
        return Err("External spec path must be under openspec/.".to_string());
    }
    let suffix = normalized["openspec/".len()..].trim();
    if suffix.is_empty() {
        return Ok(spec_root.to_path_buf());
    }
    let relative = Path::new(suffix);
    for component in relative.components() {
        match component {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Invalid external spec path.".to_string());
            }
            _ => {}
        }
    }
    Ok(spec_root.join(relative))
}

fn list_external_spec_tree_inner(
    spec_root: &str,
    max_files: usize,
) -> Result<WorkspaceFilesResponse, String> {
    // Keep external spec probing bounded; this path can run before first reply.
    const EXTERNAL_SPEC_TREE_MAX_FILES: usize = 8_000;
    let resolved = resolve_external_spec_root(spec_root)?;
    let effective_max_files = max_files.min(EXTERNAL_SPEC_TREE_MAX_FILES).max(1);
    let max_directories = effective_max_files.saturating_mul(2).max(1_000);
    let scan_started_at = Instant::now();
    let mut scanned_entries = 0usize;
    let mut files = Vec::new();
    let mut directories = vec!["openspec".to_string()];
    if !resolved.exists {
        return Ok(WorkspaceFilesResponse {
            files,
            directories,
            gitignored_files: Vec::new(),
            gitignored_directories: Vec::new(),
        });
    }
    let root = resolved.root;

    let walker = WalkBuilder::new(&root)
        .hidden(false)
        .follow_links(false)
        .require_git(false)
        .git_ignore(false)
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                return !should_always_skip(&name);
            }
            name != ".DS_Store"
        })
        .build();

    for entry in walker {
        if workspace_scan_budget_reached(scan_started_at, scanned_entries) {
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        scanned_entries = scanned_entries.saturating_add(1);
        let rel_path = match entry.path().strip_prefix(&root) {
            Ok(path) => path,
            Err(_) => continue,
        };
        let normalized = normalize_git_path(&rel_path.to_string_lossy());
        if normalized.is_empty() {
            continue;
        }
        let logical = format!("openspec/{normalized}");
        if entry.file_type().is_some_and(|ft| ft.is_dir()) {
            if directories.len() < max_directories {
                directories.push(logical);
            }
        } else if entry.file_type().is_some_and(|ft| ft.is_file()) {
            files.push(logical);
            if files.len() >= effective_max_files {
                break;
            }
        }
    }

    files.sort();
    files.dedup();
    directories.sort();
    directories.dedup();
    Ok(WorkspaceFilesResponse {
        files,
        directories,
        gitignored_files: Vec::new(),
        gitignored_directories: Vec::new(),
    })
}

fn list_workspace_files_inner(root: &PathBuf, max_files: usize) -> WorkspaceFilesResponse {
    let scan_started_at = Instant::now();
    let mut scanned_entries = 0usize;
    let max_directories = max_files.saturating_mul(2).max(1_000);
    let mut files = Vec::new();
    let mut directories = Vec::new();
    let mut gitignored_files = Vec::new();
    let mut gitignored_directories = Vec::new();
    let pruned_special_directories: Arc<StdMutex<HashSet<String>>> =
        Arc::new(StdMutex::new(HashSet::new()));

    let repo = git2::Repository::open(root).ok();

    if let Ok(entries) = std::fs::read_dir(root) {
        let mut root_entries = entries
            .filter_map(|entry| {
                if workspace_scan_budget_reached(scan_started_at, scanned_entries) {
                    return None;
                }
                scanned_entries += 1;
                entry.ok()
            })
            .collect::<Vec<_>>();
        root_entries.sort_by(|a, b| {
            a.file_name()
                .to_string_lossy()
                .cmp(&b.file_name().to_string_lossy())
        });
        for entry in root_entries {
            if workspace_scan_budget_reached(scan_started_at, scanned_entries) {
                break;
            }
            let path = entry.path();
            let rel_path = match path.strip_prefix(root) {
                Ok(path) => path,
                Err(_) => continue,
            };
            let normalized = normalize_git_path(&rel_path.to_string_lossy());
            if normalized.is_empty() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            let is_ignored = repo
                .as_ref()
                .and_then(|r| r.status_should_ignore(rel_path).ok())
                .unwrap_or(false);
            if file_type.is_dir() {
                if should_always_skip(&name) {
                    continue;
                }
                if directories.len() >= max_directories {
                    continue;
                }
                directories.push(normalized.clone());
                if is_ignored {
                    gitignored_directories.push(normalized);
                }
            } else if file_type.is_file() {
                if name == ".DS_Store" {
                    continue;
                }
                files.push(normalized.clone());
                if is_ignored {
                    gitignored_files.push(normalized);
                }
                if files.len() >= max_files {
                    sort_and_dedup_workspace_lists(
                        &mut files,
                        &mut directories,
                        &mut gitignored_files,
                        &mut gitignored_directories,
                    );
                    return WorkspaceFilesResponse {
                        files,
                        directories,
                        gitignored_files,
                        gitignored_directories,
                    };
                }
            }
        }
    }

    let root_for_filter = root.clone();
    let pruned_special_directories_for_filter = Arc::clone(&pruned_special_directories);
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .follow_links(false)
        .require_git(false)
        .git_ignore(false)
        .filter_entry(move |entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                if should_always_skip(&name) {
                    return false;
                }
                if let Ok(rel_path) = entry.path().strip_prefix(&root_for_filter) {
                    let normalized = normalize_git_path(&rel_path.to_string_lossy());
                    if !normalized.is_empty() && is_special_directory_path(&normalized) {
                        if let Ok(mut special_dirs) = pruned_special_directories_for_filter.lock() {
                            special_dirs.insert(normalized);
                        }
                        return false;
                    }
                }
                return true;
            }
            // Skip OS metadata files
            name != ".DS_Store"
        })
        .build();

    for entry in walker {
        if workspace_scan_budget_reached(scan_started_at, scanned_entries) {
            break;
        }
        scanned_entries += 1;
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if entry.depth() <= 1 {
            continue;
        }
        if let Ok(rel_path) = entry.path().strip_prefix(root) {
            let normalized = normalize_git_path(&rel_path.to_string_lossy());
            if normalized.is_empty() {
                continue;
            }
            let is_ignored = repo
                .as_ref()
                .and_then(|r| r.status_should_ignore(rel_path).ok())
                .unwrap_or(false);
            if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                if directories.len() >= max_directories {
                    continue;
                }
                directories.push(normalized.clone());
                if is_ignored {
                    gitignored_directories.push(normalized);
                }
            } else if entry.file_type().is_some_and(|ft| ft.is_file()) {
                files.push(normalized.clone());
                if is_ignored {
                    gitignored_files.push(normalized);
                }
                if files.len() >= max_files {
                    break;
                }
            }
        }
    }

    if let Ok(special_dirs) = pruned_special_directories.lock() {
        for normalized in special_dirs.iter() {
            directories.push(normalized.clone());
            let relative_path = normalized_relative_to_pathbuf(normalized);
            let is_ignored = repo
                .as_ref()
                .and_then(|r| r.status_should_ignore(&relative_path).ok())
                .unwrap_or(false);
            if is_ignored {
                gitignored_directories.push(normalized.clone());
            }
        }
    }

    sort_and_dedup_workspace_lists(
        &mut files,
        &mut directories,
        &mut gitignored_files,
        &mut gitignored_directories,
    );
    WorkspaceFilesResponse {
        files,
        directories,
        gitignored_files,
        gitignored_directories,
    }
}

fn list_workspace_directory_children_inner(
    root: &PathBuf,
    directory_path: &str,
    max_entries: usize,
) -> Result<WorkspaceFilesResponse, String> {
    let normalized_path = normalize_workspace_relative_directory_path(directory_path)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve workspace root: {err}"))?;
    let candidate = canonical_root.join(normalized_relative_to_pathbuf(&normalized_path));
    let canonical_path = candidate
        .canonicalize()
        .map_err(|err| format!("Failed to resolve directory path: {err}"))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Invalid directory path.".to_string());
    }
    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read directory metadata: {err}"))?;
    if !metadata.is_dir() {
        return Err("Path is not a directory.".to_string());
    }

    let repo = git2::Repository::open(&canonical_root).ok();
    let mut files = Vec::new();
    let mut directories = Vec::new();
    let mut gitignored_files = Vec::new();
    let mut gitignored_directories = Vec::new();

    let entries = std::fs::read_dir(&canonical_path)
        .map_err(|err| format!("Failed to read directory: {err}"))?;
    let scan_started_at = Instant::now();
    let max_scanned_entries = max_entries
        .saturating_mul(WORKSPACE_DIRECTORY_SCAN_BUDGET_MULTIPLIER)
        .max(max_entries);
    let mut sorted_entries = Vec::new();
    for entry in entries {
        if scan_started_at.elapsed() >= WORKSPACE_SCAN_TIME_BUDGET {
            break;
        }
        if sorted_entries.len() >= max_scanned_entries {
            break;
        }
        if let Ok(entry) = entry {
            sorted_entries.push((entry.file_name().to_string_lossy().to_string(), entry));
        }
    }
    sort_and_truncate_named_entries(&mut sorted_entries, max_scanned_entries);

    for (_, entry) in sorted_entries {
        let path = entry.path();
        let rel_path = match path.strip_prefix(&canonical_root) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let normalized = normalize_git_path(&rel_path.to_string_lossy());
        if normalized.is_empty() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let is_ignored = repo
            .as_ref()
            .and_then(|r| r.status_should_ignore(rel_path).ok())
            .unwrap_or(false);

        if file_type.is_dir() {
            if should_always_skip(&name) {
                continue;
            }
            directories.push(normalized.clone());
            if is_ignored {
                gitignored_directories.push(normalized);
            }
        } else if file_type.is_file() {
            if name == ".DS_Store" {
                continue;
            }
            files.push(normalized.clone());
            if is_ignored {
                gitignored_files.push(normalized);
            }
        }

        if files.len() + directories.len() >= max_entries {
            break;
        }
    }

    sort_and_dedup_workspace_lists(
        &mut files,
        &mut directories,
        &mut gitignored_files,
        &mut gitignored_directories,
    );
    Ok(WorkspaceFilesResponse {
        files,
        directories,
        gitignored_files,
        gitignored_directories,
    })
}

fn list_external_absolute_directory_children_inner(
    absolute_directory_path: &str,
    allowed_roots: &[PathBuf],
    max_entries: usize,
) -> Result<WorkspaceFilesResponse, String> {
    let canonical_path = resolve_allowed_external_absolute_path(
        absolute_directory_path,
        allowed_roots,
        "directory",
        "Invalid directory path.",
    )?;

    let entries = std::fs::read_dir(&canonical_path)
        .map_err(|err| format!("Failed to read directory: {err}"))?;
    let scan_started_at = Instant::now();
    let max_scanned_entries = max_entries
        .saturating_mul(WORKSPACE_DIRECTORY_SCAN_BUDGET_MULTIPLIER)
        .max(max_entries);
    let mut sorted_entries = Vec::new();
    for entry in entries {
        if scan_started_at.elapsed() >= WORKSPACE_SCAN_TIME_BUDGET {
            break;
        }
        if sorted_entries.len() >= max_scanned_entries {
            break;
        }
        if let Ok(entry) = entry {
            sorted_entries.push((entry.file_name().to_string_lossy().to_string(), entry));
        }
    }
    sort_and_truncate_named_entries(&mut sorted_entries, max_scanned_entries);

    let mut files = Vec::new();
    let mut directories = Vec::new();
    for (name, entry) in sorted_entries {
        let path = entry.path();
        let normalized = normalize_git_path(&path.to_string_lossy());
        if normalized.is_empty() {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if file_type.is_dir() {
            if should_always_skip(&name) {
                continue;
            }
            directories.push(normalized);
        } else if file_type.is_file() {
            if name == ".DS_Store" {
                continue;
            }
            files.push(normalized);
        }

        if files.len() + directories.len() >= max_entries {
            break;
        }
    }

    files.sort();
    files.dedup();
    directories.sort();
    directories.dedup();
    Ok(WorkspaceFilesResponse {
        files,
        directories,
        gitignored_files: Vec::new(),
        gitignored_directories: Vec::new(),
    })
}

const MAX_WORKSPACE_FILE_BYTES: u64 = 400_000;

fn read_external_spec_file_inner(
    spec_root: &str,
    logical_path: &str,
) -> Result<ExternalSpecFileResponse, String> {
    let resolved = resolve_external_spec_root(spec_root)?;
    if !resolved.exists {
        return Ok(ExternalSpecFileResponse {
            exists: false,
            content: String::new(),
            truncated: false,
        });
    }
    let root = resolved.root;
    let candidate = resolve_external_spec_logical_path(&root, logical_path)?;
    if !candidate.exists() {
        return Ok(ExternalSpecFileResponse {
            exists: false,
            content: String::new(),
            truncated: false,
        });
    }

    let canonical_path = candidate
        .canonicalize()
        .map_err(|err| format!("Failed to resolve external spec file: {err}"))?;
    if !canonical_path.starts_with(&root) {
        return Err("Invalid external spec file path.".to_string());
    }
    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read external spec file metadata: {err}"))?;
    if !metadata.is_file() {
        return Ok(ExternalSpecFileResponse {
            exists: false,
            content: String::new(),
            truncated: false,
        });
    }

    let file = File::open(&canonical_path)
        .map_err(|err| format!("Failed to open external spec file: {err}"))?;
    let mut buffer = Vec::new();
    file.take(MAX_WORKSPACE_FILE_BYTES + 1)
        .read_to_end(&mut buffer)
        .map_err(|err| format!("Failed to read external spec file: {err}"))?;

    let truncated = buffer.len() > MAX_WORKSPACE_FILE_BYTES as usize;
    if truncated {
        buffer.truncate(MAX_WORKSPACE_FILE_BYTES as usize);
    }
    let content = decode_text_bytes(&buffer, "External spec file")?;
    Ok(ExternalSpecFileResponse {
        exists: true,
        content,
        truncated,
    })
}

fn write_external_spec_file_inner(
    spec_root: &str,
    logical_path: &str,
    content: &str,
) -> Result<(), String> {
    if content.len() > MAX_WORKSPACE_FILE_BYTES as usize {
        return Err("File content exceeds maximum allowed size".to_string());
    }
    let resolved = resolve_external_spec_root(spec_root)?;
    let root = resolved.root;
    let candidate = resolve_external_spec_logical_path(&root, logical_path)?;
    if candidate == root {
        return Err("Cannot write to external spec root directory directly.".to_string());
    }

    let normalized = logical_path.replace('\\', "/");
    if normalized == ".git"
        || normalized.starts_with(".git/")
        || normalized.contains("/.git/")
        || normalized.ends_with("/.git")
    {
        return Err("Cannot write to .git directory".to_string());
    }

    if let Some(parent) = candidate.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create external spec parent directory: {err}"))?;
        let canonical_root = root
            .canonicalize()
            .map_err(|err| format!("Failed to resolve external spec root: {err}"))?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|err| format!("Failed to resolve external spec parent directory: {err}"))?;
        if !canonical_parent.starts_with(&canonical_root) {
            return Err("Invalid external spec file path.".to_string());
        }
    } else {
        return Err("Invalid external spec file path.".to_string());
    }

    std::fs::write(&candidate, content)
        .map_err(|err| format!("Failed to write external spec file: {err}"))?;
    Ok(())
}

fn read_workspace_file_inner(
    root: &PathBuf,
    relative_path: &str,
) -> Result<WorkspaceFileResponse, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve workspace root: {err}"))?;
    let candidate = canonical_root.join(relative_path);
    let canonical_path = candidate
        .canonicalize()
        .map_err(|err| format!("Failed to open file: {err}"))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Invalid file path".to_string());
    }
    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read file metadata: {err}"))?;
    if !metadata.is_file() {
        return Err("Path is not a file".to_string());
    }

    let file = File::open(&canonical_path).map_err(|err| format!("Failed to open file: {err}"))?;
    let mut buffer = Vec::new();
    file.take(MAX_WORKSPACE_FILE_BYTES + 1)
        .read_to_end(&mut buffer)
        .map_err(|err| format!("Failed to read file: {err}"))?;

    let truncated = buffer.len() > MAX_WORKSPACE_FILE_BYTES as usize;
    if truncated {
        buffer.truncate(MAX_WORKSPACE_FILE_BYTES as usize);
    }

    let content = decode_text_bytes(&buffer, "File")?;
    Ok(WorkspaceFileResponse { content, truncated })
}

fn read_external_absolute_file_inner(
    absolute_path: &str,
    allowed_roots: &[PathBuf],
) -> Result<WorkspaceFileResponse, String> {
    let canonical_path = resolve_allowed_external_absolute_path(
        absolute_path,
        allowed_roots,
        "file",
        "Invalid file path",
    )?;

    let file = File::open(&canonical_path).map_err(|err| format!("Failed to open file: {err}"))?;
    let mut buffer = Vec::new();
    file.take(MAX_WORKSPACE_FILE_BYTES + 1)
        .read_to_end(&mut buffer)
        .map_err(|err| format!("Failed to read file: {err}"))?;

    let truncated = buffer.len() > MAX_WORKSPACE_FILE_BYTES as usize;
    if truncated {
        buffer.truncate(MAX_WORKSPACE_FILE_BYTES as usize);
    }

    let content = decode_text_bytes(&buffer, "File")?;
    Ok(WorkspaceFileResponse { content, truncated })
}

fn write_external_absolute_file_inner(
    absolute_path: &str,
    allowed_roots: &[PathBuf],
    content: &str,
) -> Result<(), String> {
    if content.len() > MAX_WORKSPACE_FILE_BYTES as usize {
        return Err("File content exceeds maximum allowed size".to_string());
    }

    let canonical_path = resolve_allowed_external_absolute_path(
        absolute_path,
        allowed_roots,
        "file",
        "Invalid file path",
    )?;

    std::fs::write(&canonical_path, content)
        .map_err(|err| format!("Failed to write file: {err}"))?;
    Ok(())
}

fn resolve_allowed_external_absolute_path(
    absolute_path: &str,
    allowed_roots: &[PathBuf],
    expected_kind: &str,
    invalid_path_message: &str,
) -> Result<PathBuf, String> {
    let trimmed = absolute_path.trim();
    if trimmed.is_empty() {
        return Err(invalid_path_message.to_string());
    }

    let raw_path = PathBuf::from(trimmed);
    if !raw_path.is_absolute() {
        return Err(invalid_path_message.to_string());
    }

    let canonical_path = raw_path
        .canonicalize()
        .map_err(|err| format!("Failed to open file: {err}"))?;

    let mut within_allowed_root = false;
    for root in allowed_roots {
        if let Ok(canonical_root) = root.canonicalize() {
            if canonical_path.starts_with(&canonical_root) {
                within_allowed_root = true;
                break;
            }
        }
    }
    if !within_allowed_root {
        return Err("Path is not within allowed directories.".to_string());
    }

    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read file metadata: {err}"))?;
    let kind_matches = match expected_kind {
        "file" => metadata.is_file(),
        "directory" => metadata.is_dir(),
        _ => false,
    };
    if !kind_matches {
        return Err(format!("Path is not a {expected_kind}."));
    }
    Ok(canonical_path)
}

fn default_data_dir() -> PathBuf {
    if cfg!(windows) {
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            let trimmed = local_app_data.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed).join("cc_gui_daemon");
            }
        }
    }

    if let Ok(xdg) = env::var("XDG_DATA_HOME") {
        let trimmed = xdg.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("cc_gui_daemon");
        }
    }
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".local")
        .join("share")
        .join("cc_gui_daemon")
}

fn usage() -> String {
    format!(
        "\
USAGE:\n  cc_gui_daemon [--listen <addr>] [--data-dir <path>] [--token <token> | --insecure-no-auth]\n\n\
OPTIONS:\n  --listen <addr>        Bind address (default: {DEFAULT_LISTEN_ADDR})\n  --data-dir <path>      Data dir holding workspaces.json/settings.json\n  --token <token>        Shared token required by clients\n  --insecure-no-auth      Disable auth (dev only)\n  -h, --help             Show this help\n"
    )
}

fn parse_args() -> Result<DaemonConfig, String> {
    let mut listen = DEFAULT_LISTEN_ADDR
        .parse::<SocketAddr>()
        .map_err(|err| err.to_string())?;
    let mut token = env::var("CC_GUI_DAEMON_TOKEN")
        .ok()
        .or_else(|| env::var("MOSS_X_DAEMON_TOKEN").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let mut insecure_no_auth = false;
    let mut data_dir: Option<PathBuf> = None;

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => {
                print!("{}", usage());
                std::process::exit(0);
            }
            "--listen" => {
                let value = args.next().ok_or("--listen requires a value")?;
                listen = value.parse::<SocketAddr>().map_err(|err| err.to_string())?;
            }
            "--token" => {
                let value = args.next().ok_or("--token requires a value")?;
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    return Err("--token requires a non-empty value".to_string());
                }
                token = Some(trimmed.to_string());
            }
            "--data-dir" => {
                let value = args.next().ok_or("--data-dir requires a value")?;
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    return Err("--data-dir requires a non-empty value".to_string());
                }
                data_dir = Some(PathBuf::from(trimmed));
            }
            "--insecure-no-auth" => {
                insecure_no_auth = true;
                token = None;
            }
            _ => return Err(format!("Unknown argument: {arg}")),
        }
    }

    if token.is_none() && !insecure_no_auth {
        return Err(
            "Missing --token (or set CC_GUI_DAEMON_TOKEN). Use --insecure-no-auth for local dev only."
                .to_string(),
        );
    }

    Ok(DaemonConfig {
        listen,
        token,
        data_dir: data_dir.unwrap_or_else(default_data_dir),
    })
}

fn build_error_response(id: Option<u64>, message: &str) -> Option<String> {
    let id = id?;
    Some(
        serde_json::to_string(&json!({
            "id": id,
            "error": { "message": message }
        }))
        .unwrap_or_else(|_| {
            "{\"id\":0,\"error\":{\"message\":\"serialization failed\"}}".to_string()
        }),
    )
}

fn build_result_response(id: Option<u64>, result: Value) -> Option<String> {
    let id = id?;
    Some(
        serde_json::to_string(&json!({ "id": id, "result": result })).unwrap_or_else(|_| {
            "{\"id\":0,\"error\":{\"message\":\"serialization failed\"}}".to_string()
        }),
    )
}

fn build_event_notification(event: DaemonEvent) -> Option<String> {
    let payload = match event {
        DaemonEvent::AppServer(payload) => json!({
            "method": "app-server-event",
            "params": payload,
        }),
        DaemonEvent::TerminalOutput(payload) => json!({
            "method": "terminal-output",
            "params": payload,
        }),
    };
    serde_json::to_string(&payload).ok()
}

fn parse_auth_token(params: &Value) -> Option<String> {
    match params {
        Value::String(value) => Some(value.clone()),
        Value::Object(map) => map
            .get("token")
            .and_then(|value| value.as_str())
            .map(|v| v.to_string()),
        _ => None,
    }
}

fn parse_string(value: &Value, key: &str) -> Result<String, String> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
            .ok_or_else(|| format!("missing or invalid `{key}`")),
        _ => Err(format!("missing `{key}`")),
    }
}

fn parse_optional_string(value: &Value, key: &str) -> Option<String> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(|value| value.as_str())
            .map(|v| v.to_string()),
        _ => None,
    }
}

fn parse_optional_u32(value: &Value, key: &str) -> Option<u32> {
    match value {
        Value::Object(map) => map.get(key).and_then(|value| value.as_u64()).and_then(|v| {
            if v > u32::MAX as u64 {
                None
            } else {
                Some(v as u32)
            }
        }),
        _ => None,
    }
}

fn parse_optional_u64(value: &Value, key: &str) -> Option<u64> {
    match value {
        Value::Object(map) => map.get(key).and_then(|value| value.as_u64()),
        _ => None,
    }
}

fn parse_optional_usize(value: &Value, key: &str) -> Option<usize> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(|value| value.as_u64())
            .and_then(|raw| {
                if raw > usize::MAX as u64 {
                    None
                } else {
                    Some(raw as usize)
                }
            }),
        _ => None,
    }
}

fn parse_optional_i64(value: &Value, key: &str) -> Option<i64> {
    match value {
        Value::Object(map) => map.get(key).and_then(|entry| match entry {
            Value::Number(number) => {
                if let Some(signed) = number.as_i64() {
                    return Some(signed);
                }
                number.as_u64().and_then(|unsigned| {
                    if unsigned > i64::MAX as u64 {
                        None
                    } else {
                        Some(unsigned as i64)
                    }
                })
            }
            _ => None,
        }),
        _ => None,
    }
}

fn parse_optional_port(value: &Value, key: &str) -> Result<Option<u16>, String> {
    let Some(raw) = parse_optional_u32(value, key) else {
        return Ok(None);
    };
    if raw > u16::MAX as u32 {
        return Err(format!("invalid `{key}`"));
    }
    Ok(Some(raw as u16))
}

fn parse_optional_bool(value: &Value, key: &str) -> Option<bool> {
    match value {
        Value::Object(map) => map.get(key).and_then(Value::as_bool),
        _ => None,
    }
}

fn parse_optional_string_array(value: &Value, key: &str) -> Option<Vec<String>> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(|value| value.to_string()))
                    .collect::<Vec<_>>()
            }),
        _ => None,
    }
}

fn parse_string_array(value: &Value, key: &str) -> Result<Vec<String>, String> {
    parse_optional_string_array(value, key).ok_or_else(|| format!("missing `{key}`"))
}

fn parse_optional_value(value: &Value, key: &str) -> Option<Value> {
    match value {
        Value::Object(map) => map.get(key).cloned(),
        _ => None,
    }
}

fn normalize_custom_spec_root(value: Option<String>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn extract_turn_result_text_internal(value: &Value, depth: usize) -> Option<String> {
    if depth > 4 {
        return None;
    }
    if let Some(text) = value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        return Some(text.to_string());
    }
    if let Some(array) = value.as_array() {
        let mut merged = String::new();
        for item in array {
            if let Some(text) = extract_turn_result_text_internal(item, depth + 1) {
                if !merged.is_empty() {
                    merged.push('\n');
                }
                merged.push_str(&text);
            }
        }
        return if merged.trim().is_empty() {
            None
        } else {
            Some(merged)
        };
    }
    if let Some(object) = value.as_object() {
        for key in [
            "text",
            "delta",
            "output_text",
            "outputText",
            "content",
            "message",
        ] {
            if let Some(text) = object
                .get(key)
                .and_then(|entry| entry.as_str())
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
            {
                return Some(text.to_string());
            }
        }
        for key in [
            "result", "response", "content", "message", "output", "data", "payload",
        ] {
            if let Some(entry) = object.get(key) {
                if let Some(text) = extract_turn_result_text_internal(entry, depth + 1) {
                    return Some(text);
                }
            }
        }
    }
    None
}

fn extract_turn_result_text(result: Option<&Value>) -> Option<String> {
    result.and_then(|value| extract_turn_result_text_internal(value, 0))
}

fn is_likely_foreign_model_for_gemini(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    if normalized.contains("gemini") {
        return false;
    }
    if normalized.starts_with("claude-") {
        return true;
    }
    if normalized.starts_with("gpt-") || normalized.contains("codex") {
        return true;
    }
    normalized.starts_with("openai/")
        || normalized.starts_with("anthropic/")
        || normalized.starts_with("x-ai/")
        || normalized.starts_with("openrouter/")
        || normalized.starts_with("deepseek/")
        || normalized.starts_with("qwen/")
        || normalized.starts_with("meta/")
        || normalized.starts_with("mistral/")
}

fn is_likely_legacy_claude_model_id(model: &str) -> bool {
    model.trim().to_ascii_lowercase().starts_with("claude-")
}

fn strip_ansi_codes(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if let Some('[') = chars.peek().copied() {
                let _ = chars.next();
                for next in chars.by_ref() {
                    if ('@'..='~').contains(&next) {
                        break;
                    }
                }
                continue;
            }
        }
        output.push(ch);
    }
    output
}

fn parse_opencode_session_list(stdout: &str) -> Vec<OpenCodeSessionEntry> {
    let clean = strip_ansi_codes(stdout);
    let mut entries = Vec::new();
    for raw in clean.lines() {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.starts_with("Session ID") || trimmed.starts_with('─') {
            continue;
        }
        let Some(session_id_end) = trimmed.find(char::is_whitespace) else {
            continue;
        };
        let session_id = trimmed[..session_id_end].trim();
        if session_id.is_empty() || !session_id.starts_with("ses_") {
            continue;
        }
        let rest = trimmed[session_id_end..].trim_start();
        if rest.is_empty() {
            continue;
        }
        let split_idx = rest.rfind("  ");
        let (title, updated_label) = if let Some(index) = split_idx {
            let title_text = rest[..index].trim();
            let updated_text = rest[index..].trim();
            (
                if title_text.is_empty() {
                    "Untitled"
                } else {
                    title_text
                },
                updated_text,
            )
        } else {
            (rest, "")
        };
        entries.push(OpenCodeSessionEntry {
            session_id: session_id.to_string(),
            title: title.to_string(),
            updated_label: updated_label.to_string(),
            updated_at: None,
        });
    }
    entries
}

fn resolve_opencode_bin(config: Option<&engine::EngineConfig>) -> String {
    if let Some(custom) = config.and_then(|entry| entry.bin_path.as_ref()) {
        return custom.clone();
    }
    backend::app_server::find_cli_binary("opencode", None)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "opencode".to_string())
}

fn build_opencode_command(config: Option<&engine::EngineConfig>) -> Command {
    let bin = resolve_opencode_bin(config);
    let mut command = backend::app_server::build_command_for_binary(&bin);
    if let Some(home_dir) = config.and_then(|entry| entry.home_dir.as_ref()) {
        command.env("OPENCODE_HOME", home_dir);
    }
    if let Some(args) = config.and_then(|entry| entry.custom_args.as_deref()) {
        for arg in args.split_whitespace() {
            if !arg.trim().is_empty() {
                command.arg(arg);
            }
        }
    }
    command
}

fn parse_engine_type_string(value: Option<&str>) -> Option<engine::EngineType> {
    let normalized = value?.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "claude" => Some(engine::EngineType::Claude),
        "codex" => Some(engine::EngineType::Codex),
        "gemini" => Some(engine::EngineType::Gemini),
        "opencode" => Some(engine::EngineType::OpenCode),
        _ => None,
    }
}

fn parse_engine_type(value: &Value, key: &str) -> Result<engine::EngineType, String> {
    let raw = parse_string(value, key)?;
    parse_engine_type_string(Some(raw.as_str())).ok_or_else(|| format!("invalid `{key}`"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileReadRequest {
    scope: file_policy::FileScope,
    kind: file_policy::FileKind,
    workspace_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileWriteRequest {
    scope: file_policy::FileScope,
    kind: file_policy::FileKind,
    workspace_id: Option<String>,
    content: String,
}

fn parse_file_read_request(params: &Value) -> Result<FileReadRequest, String> {
    serde_json::from_value(params.clone()).map_err(|err| err.to_string())
}

fn parse_file_write_request(params: &Value) -> Result<FileWriteRequest, String> {
    serde_json::from_value(params.clone()).map_err(|err| err.to_string())
}

async fn handle_rpc_request(
    state: &DaemonState,
    method: &str,
    params: Value,
    client_version: String,
) -> Result<Value, String> {
    match method {
        "ping" => Ok(json!({ "ok": true })),
        "list_workspaces" => {
            let workspaces = state.list_workspaces().await;
            serde_json::to_value(workspaces).map_err(|err| err.to_string())
        }
        "is_workspace_path_dir" => {
            let path = parse_string(&params, "path")?;
            let is_dir = state.is_workspace_path_dir(path).await;
            serde_json::to_value(is_dir).map_err(|err| err.to_string())
        }
        "ensure_workspace_path_dir" => {
            let path = parse_string(&params, "path")?;
            state.ensure_workspace_path_dir(path).await?;
            Ok(json!({ "ok": true }))
        }
        "add_workspace" => {
            let path = parse_string(&params, "path")?;
            let codex_bin = parse_optional_string(&params, "codex_bin");
            let workspace = state.add_workspace(path, codex_bin, client_version).await?;
            serde_json::to_value(workspace).map_err(|err| err.to_string())
        }
        "add_worktree" => {
            let parent_id = parse_string(&params, "parentId")?;
            let branch = parse_string(&params, "branch")?;
            let base_ref = parse_optional_string(&params, "baseRef");
            let publish_to_origin = parse_optional_bool(&params, "publishToOrigin").unwrap_or(true);
            let workspace = state
                .add_worktree(
                    parent_id,
                    branch,
                    base_ref,
                    publish_to_origin,
                    client_version,
                )
                .await?;
            serde_json::to_value(workspace).map_err(|err| err.to_string())
        }
        "worktree_setup_status" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let status = state.worktree_setup_status(workspace_id).await?;
            serde_json::to_value(status).map_err(|err| err.to_string())
        }
        "worktree_setup_mark_ran" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.worktree_setup_mark_ran(workspace_id).await?;
            Ok(json!({ "ok": true }))
        }
        "connect_workspace" => {
            let id = parse_string(&params, "id")?;
            state.connect_workspace(id, client_version).await?;
            Ok(json!({ "ok": true }))
        }
        "remove_workspace" => {
            let id = parse_string(&params, "id")?;
            state.remove_workspace(id).await?;
            Ok(json!({ "ok": true }))
        }
        "remove_worktree" => {
            let id = parse_string(&params, "id")?;
            state.remove_worktree(id).await?;
            Ok(json!({ "ok": true }))
        }
        "rename_worktree" => {
            let id = parse_string(&params, "id")?;
            let branch = parse_string(&params, "branch")?;
            let workspace = state.rename_worktree(id, branch, client_version).await?;
            serde_json::to_value(workspace).map_err(|err| err.to_string())
        }
        "rename_worktree_upstream" => {
            let id = parse_string(&params, "id")?;
            let old_branch = parse_string(&params, "oldBranch")?;
            let new_branch = parse_string(&params, "newBranch")?;
            state
                .rename_worktree_upstream(id, old_branch, new_branch)
                .await?;
            Ok(json!({ "ok": true }))
        }
        "update_workspace_settings" => {
            let id = parse_string(&params, "id")?;
            let settings_value = match params {
                Value::Object(map) => map.get("settings").cloned().unwrap_or(Value::Null),
                _ => Value::Null,
            };
            let settings: WorkspaceSettings =
                serde_json::from_value(settings_value).map_err(|err| err.to_string())?;
            let workspace = state
                .update_workspace_settings(id, settings, client_version)
                .await?;
            serde_json::to_value(workspace).map_err(|err| err.to_string())
        }
        "update_workspace_codex_bin" => {
            let id = parse_string(&params, "id")?;
            let codex_bin = parse_optional_string(&params, "codex_bin");
            let workspace = state.update_workspace_codex_bin(id, codex_bin).await?;
            serde_json::to_value(workspace).map_err(|err| err.to_string())
        }
        "list_workspace_files" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let files = state.list_workspace_files(workspace_id).await?;
            serde_json::to_value(files).map_err(|err| err.to_string())
        }
        "list_workspace_directory_children" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let path = parse_string(&params, "path")?;
            let files = state
                .list_workspace_directory_children(workspace_id, path)
                .await?;
            serde_json::to_value(files).map_err(|err| err.to_string())
        }
        "list_external_absolute_directory_children" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let path = parse_string(&params, "path")?;
            let files = state
                .list_external_absolute_directory_children(workspace_id, path)
                .await?;
            serde_json::to_value(files).map_err(|err| err.to_string())
        }
        "read_workspace_file" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let path = parse_string(&params, "path")?;
            let response = state.read_workspace_file(workspace_id, path).await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "list_external_spec_tree" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let spec_root = parse_string(&params, "specRoot")?;
            let tree = state
                .list_external_spec_tree(workspace_id, spec_root)
                .await?;
            serde_json::to_value(tree).map_err(|err| err.to_string())
        }
        "read_external_spec_file" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let spec_root = parse_string(&params, "specRoot")?;
            let path = parse_string(&params, "path")?;
            let response = state
                .read_external_spec_file(workspace_id, spec_root, path)
                .await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "read_external_absolute_file" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let path = parse_string(&params, "path")?;
            let response = state
                .read_external_absolute_file(workspace_id, path)
                .await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "write_external_spec_file" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let spec_root = parse_string(&params, "specRoot")?;
            let path = parse_string(&params, "path")?;
            let content = parse_string(&params, "content")?;
            state
                .write_external_spec_file(workspace_id, spec_root, path, content)
                .await?;
            serde_json::to_value(json!({ "ok": true })).map_err(|err| err.to_string())
        }
        "write_external_absolute_file" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let path = parse_string(&params, "path")?;
            let content = parse_string(&params, "content")?;
            state
                .write_external_absolute_file(workspace_id, path, content)
                .await?;
            serde_json::to_value(json!({ "ok": true })).map_err(|err| err.to_string())
        }
        "file_read" => {
            let request = parse_file_read_request(&params)?;
            let response = state
                .file_read(request.scope, request.kind, request.workspace_id)
                .await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "file_write" => {
            let request = parse_file_write_request(&params)?;
            state
                .file_write(
                    request.scope,
                    request.kind,
                    request.workspace_id,
                    request.content,
                )
                .await?;
            serde_json::to_value(json!({ "ok": true })).map_err(|err| err.to_string())
        }
        "get_git_status" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.get_git_status(workspace_id).await
        }
        "list_git_roots" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let depth = parse_optional_usize(&params, "depth");
            let roots = state.list_git_roots(workspace_id, depth).await?;
            serde_json::to_value(roots).map_err(|err| err.to_string())
        }
        "get_git_diffs" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let diffs = state.get_git_diffs(workspace_id).await?;
            serde_json::to_value(diffs).map_err(|err| err.to_string())
        }
        "get_git_file_full_diff" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let path = parse_string(&params, "path")?;
            let diff = state.get_git_file_full_diff(workspace_id, path).await?;
            Ok(Value::String(diff))
        }
        "get_git_log" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let limit = parse_optional_usize(&params, "limit");
            let response = state.get_git_log(workspace_id, limit).await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "get_git_commit_history" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let branch = parse_optional_string(&params, "branch");
            let query = parse_optional_string(&params, "query");
            let author = parse_optional_string(&params, "author");
            let date_from = parse_optional_i64(&params, "dateFrom");
            let date_to = parse_optional_i64(&params, "dateTo");
            let snapshot_id = parse_optional_string(&params, "snapshotId");
            let offset = parse_optional_usize(&params, "offset").unwrap_or(0);
            let limit = parse_optional_usize(&params, "limit").unwrap_or(100);
            let response = state
                .get_git_commit_history(
                    workspace_id,
                    branch,
                    query,
                    author,
                    date_from,
                    date_to,
                    snapshot_id,
                    offset,
                    limit,
                )
                .await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "get_git_push_preview" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let remote = parse_string(&params, "remote")?;
            let branch = parse_string(&params, "branch")?;
            let limit = parse_optional_usize(&params, "limit");
            let response = state
                .get_git_push_preview(workspace_id, remote, branch, limit)
                .await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "get_git_pr_workflow_defaults" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let response = state.get_git_pr_workflow_defaults(workspace_id).await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "create_git_pr_workflow" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let upstream_repo = parse_string(&params, "upstreamRepo")?;
            let base_branch = parse_string(&params, "baseBranch")?;
            let head_owner = parse_string(&params, "headOwner")?;
            let head_branch = parse_string(&params, "headBranch")?;
            let title = parse_string(&params, "title")?;
            let body = parse_optional_string(&params, "body");
            let comment_after_create = parse_optional_bool(&params, "commentAfterCreate");
            let comment_body = parse_optional_string(&params, "commentBody");
            let response = state
                .create_git_pr_workflow(
                    workspace_id,
                    upstream_repo,
                    base_branch,
                    head_owner,
                    head_branch,
                    title,
                    body,
                    comment_after_create,
                    comment_body,
                )
                .await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "resolve_git_commit_ref" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let target = parse_string(&params, "target")?;
            let resolved = state.resolve_git_commit_ref(workspace_id, target).await?;
            Ok(Value::String(resolved))
        }
        "get_git_commit_details" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let commit_hash = parse_string(&params, "commitHash")?;
            let max_diff_lines = parse_optional_usize(&params, "maxDiffLines").unwrap_or(10_000);
            let details = state
                .get_git_commit_details(workspace_id, commit_hash, max_diff_lines)
                .await?;
            serde_json::to_value(details).map_err(|err| err.to_string())
        }
        "get_git_commit_diff" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let sha = parse_string(&params, "sha")?;
            let path = parse_optional_string(&params, "path");
            let context_lines = parse_optional_usize(&params, "contextLines");
            let diff = state
                .get_git_commit_diff(workspace_id, sha, path, context_lines)
                .await?;
            serde_json::to_value(diff).map_err(|err| err.to_string())
        }
        "get_git_remote" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let remote = state.get_git_remote(workspace_id).await?;
            serde_json::to_value(remote).map_err(|err| err.to_string())
        }
        "stage_git_file" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let path = parse_string(&params, "path")?;
            state.stage_git_file(workspace_id, path).await?;
            Ok(json!({ "ok": true }))
        }
        "stage_git_all" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.stage_git_all(workspace_id).await?;
            Ok(json!({ "ok": true }))
        }
        "unstage_git_file" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let path = parse_string(&params, "path")?;
            state.unstage_git_file(workspace_id, path).await?;
            Ok(json!({ "ok": true }))
        }
        "revert_git_file" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let path = parse_string(&params, "path")?;
            state.revert_git_file(workspace_id, path).await?;
            Ok(json!({ "ok": true }))
        }
        "revert_git_all" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.revert_git_all(workspace_id).await?;
            Ok(json!({ "ok": true }))
        }
        "commit_git" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let message = parse_string(&params, "message")?;
            state.commit_git(workspace_id, message).await?;
            Ok(json!({ "ok": true }))
        }
        "push_git" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let remote = parse_optional_string(&params, "remote");
            let branch = parse_optional_string(&params, "branch");
            let force_with_lease = parse_optional_bool(&params, "forceWithLease");
            let push_tags = parse_optional_bool(&params, "pushTags");
            let run_hooks = parse_optional_bool(&params, "runHooks");
            let push_to_gerrit = parse_optional_bool(&params, "pushToGerrit");
            let topic = parse_optional_string(&params, "topic");
            let reviewers = parse_optional_string(&params, "reviewers");
            let cc = parse_optional_string(&params, "cc");
            state
                .push_git(
                    workspace_id,
                    remote,
                    branch,
                    force_with_lease,
                    push_tags,
                    run_hooks,
                    push_to_gerrit,
                    topic,
                    reviewers,
                    cc,
                )
                .await?;
            Ok(json!({ "ok": true }))
        }
        "pull_git" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let remote = parse_optional_string(&params, "remote");
            let branch = parse_optional_string(&params, "branch");
            let strategy = parse_optional_string(&params, "strategy");
            let no_commit = parse_optional_bool(&params, "noCommit");
            let no_verify = parse_optional_bool(&params, "noVerify");
            state
                .pull_git(workspace_id, remote, branch, strategy, no_commit, no_verify)
                .await?;
            Ok(json!({ "ok": true }))
        }
        "sync_git" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.sync_git(workspace_id).await?;
            Ok(json!({ "ok": true }))
        }
        "git_pull" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.git_pull(workspace_id).await?;
            Ok(json!({ "ok": true }))
        }
        "git_push" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.git_push(workspace_id).await?;
            Ok(json!({ "ok": true }))
        }
        "git_sync" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.git_sync(workspace_id).await?;
            Ok(json!({ "ok": true }))
        }
        "git_fetch" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let remote = parse_optional_string(&params, "remote");
            state.git_fetch(workspace_id, remote).await?;
            Ok(json!({ "ok": true }))
        }
        "cherry_pick_commit" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let commit_hash = parse_string(&params, "commitHash")?;
            state.cherry_pick_commit(workspace_id, commit_hash).await?;
            Ok(json!({ "ok": true }))
        }
        "revert_commit" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let commit_hash = parse_string(&params, "commitHash")?;
            state.revert_commit(workspace_id, commit_hash).await?;
            Ok(json!({ "ok": true }))
        }
        "reset_git_commit" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let commit_hash = parse_string(&params, "commitHash")?;
            let mode = parse_string(&params, "mode")?;
            state
                .reset_git_commit(workspace_id, commit_hash, mode)
                .await?;
            Ok(json!({ "ok": true }))
        }
        "get_github_issues" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let response = state.get_github_issues(workspace_id).await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "get_github_pull_requests" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let response = state.get_github_pull_requests(workspace_id).await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "get_github_pull_request_diff" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let pr_number = parse_optional_u64(&params, "prNumber")
                .ok_or_else(|| "missing or invalid `prNumber`".to_string())?;
            let response = state
                .get_github_pull_request_diff(workspace_id, pr_number)
                .await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "get_github_pull_request_comments" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let pr_number = parse_optional_u64(&params, "prNumber")
                .ok_or_else(|| "missing or invalid `prNumber`".to_string())?;
            let response = state
                .get_github_pull_request_comments(workspace_id, pr_number)
                .await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "list_git_branches" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.list_git_branches(workspace_id).await
        }
        "checkout_git_branch" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let name = parse_string(&params, "name")?;
            state.checkout_git_branch(workspace_id, name).await?;
            Ok(json!({ "ok": true }))
        }
        "create_git_branch" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let name = parse_string(&params, "name")?;
            state.create_git_branch(workspace_id, name).await?;
            Ok(json!({ "ok": true }))
        }
        "create_git_branch_from_branch" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let name = parse_string(&params, "name")?;
            let source_branch = parse_string(&params, "sourceBranch")?;
            state
                .create_git_branch_from_branch(workspace_id, name, source_branch)
                .await?;
            Ok(json!({ "ok": true }))
        }
        "create_git_branch_from_commit" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let name = parse_string(&params, "name")?;
            let commit_hash = parse_string(&params, "commitHash")?;
            state
                .create_git_branch_from_commit(workspace_id, name, commit_hash)
                .await?;
            Ok(json!({ "ok": true }))
        }
        "delete_git_branch" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let name = parse_string(&params, "name")?;
            let force = parse_optional_bool(&params, "force");
            state.delete_git_branch(workspace_id, name, force).await?;
            Ok(json!({ "ok": true }))
        }
        "rename_git_branch" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let old_name = parse_string(&params, "oldName")?;
            let new_name = parse_string(&params, "newName")?;
            state
                .rename_git_branch(workspace_id, old_name, new_name)
                .await?;
            Ok(json!({ "ok": true }))
        }
        "merge_git_branch" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let name = parse_string(&params, "name")?;
            state.merge_git_branch(workspace_id, name).await?;
            Ok(json!({ "ok": true }))
        }
        "rebase_git_branch" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let onto_branch = parse_string(&params, "ontoBranch")?;
            state.rebase_git_branch(workspace_id, onto_branch).await?;
            Ok(json!({ "ok": true }))
        }
        "get_git_branch_compare_commits" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let target_branch = parse_string(&params, "targetBranch")?;
            let current_branch = parse_string(&params, "currentBranch")?;
            let limit = parse_optional_usize(&params, "limit");
            let response = state
                .get_git_branch_compare_commits(workspace_id, target_branch, current_branch, limit)
                .await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "get_git_branch_diff_between_branches" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let from_branch = parse_string(&params, "fromBranch")?;
            let to_branch = parse_string(&params, "toBranch")?;
            let response = state
                .get_git_branch_diff_between_branches(workspace_id, from_branch, to_branch)
                .await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "get_git_branch_file_diff_between_branches" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let from_branch = parse_string(&params, "fromBranch")?;
            let to_branch = parse_string(&params, "toBranch")?;
            let path = parse_string(&params, "path")?;
            let response = state
                .get_git_branch_file_diff_between_branches(
                    workspace_id,
                    from_branch,
                    to_branch,
                    path,
                )
                .await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "get_git_worktree_diff_against_branch" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let branch = parse_string(&params, "branch")?;
            let response = state
                .get_git_worktree_diff_against_branch(workspace_id, branch)
                .await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "get_git_worktree_file_diff_against_branch" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let branch = parse_string(&params, "branch")?;
            let path = parse_string(&params, "path")?;
            let response = state
                .get_git_worktree_file_diff_against_branch(workspace_id, branch, path)
                .await?;
            serde_json::to_value(response).map_err(|err| err.to_string())
        }
        "get_app_settings" => {
            let settings = state.get_app_settings().await;
            serde_json::to_value(settings).map_err(|err| err.to_string())
        }
        "update_app_settings" => {
            let settings_value = match params {
                Value::Object(map) => map.get("settings").cloned().unwrap_or(Value::Null),
                _ => Value::Null,
            };
            let settings: AppSettings =
                serde_json::from_value(settings_value).map_err(|err| err.to_string())?;
            let updated = state.update_app_settings(settings).await?;
            serde_json::to_value(updated).map_err(|err| err.to_string())
        }
        "reload_codex_runtime_config" => {
            let result = state.reload_codex_runtime_config().await?;
            serde_json::to_value(result).map_err(|err| err.to_string())
        }
        "detect_engines" => {
            let statuses = state.detect_engines().await;
            serde_json::to_value(statuses).map_err(|err| err.to_string())
        }
        "get_active_engine" => {
            let active = state.get_active_engine().await;
            serde_json::to_value(active).map_err(|err| err.to_string())
        }
        "switch_engine" => {
            let engine_type = parse_engine_type(&params, "engineType")?;
            state.switch_engine(engine_type).await?;
            Ok(json!({ "ok": true }))
        }
        "get_engine_status" => {
            let engine_type = parse_engine_type(&params, "engineType")?;
            let status = state.get_engine_status(engine_type).await;
            serde_json::to_value(status).map_err(|err| err.to_string())
        }
        "get_engine_models" => {
            let engine_type = parse_engine_type(&params, "engineType")?;
            let models = state.get_engine_models(engine_type).await;
            serde_json::to_value(models).map_err(|err| err.to_string())
        }
        "engine_send_message" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let text = parse_string(&params, "text")?;
            let engine = parse_optional_string(&params, "engine")
                .as_deref()
                .and_then(|value| parse_engine_type_string(Some(value)));
            let model = parse_optional_string(&params, "model");
            let effort = parse_optional_string(&params, "effort");
            let access_mode = parse_optional_string(&params, "accessMode");
            let images = parse_optional_string_array(&params, "images");
            let continue_session = parse_optional_bool(&params, "continueSession").unwrap_or(false);
            let thread_id = parse_optional_string(&params, "threadId");
            let session_id = parse_optional_string(&params, "sessionId");
            let agent = parse_optional_string(&params, "agent");
            let variant = parse_optional_string(&params, "variant");
            let custom_spec_root = parse_optional_string(&params, "customSpecRoot");
            state
                .engine_send_message(
                    workspace_id,
                    text,
                    engine,
                    model,
                    effort,
                    access_mode,
                    images,
                    continue_session,
                    thread_id,
                    session_id,
                    agent,
                    variant,
                    custom_spec_root,
                )
                .await
        }
        "engine_send_message_sync" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let text = parse_string(&params, "text")?;
            let engine = parse_optional_string(&params, "engine")
                .as_deref()
                .and_then(|value| parse_engine_type_string(Some(value)));
            let model = parse_optional_string(&params, "model");
            let effort = parse_optional_string(&params, "effort");
            let access_mode = parse_optional_string(&params, "accessMode");
            let images = parse_optional_string_array(&params, "images");
            let continue_session = parse_optional_bool(&params, "continueSession").unwrap_or(false);
            let session_id = parse_optional_string(&params, "sessionId");
            let agent = parse_optional_string(&params, "agent");
            let variant = parse_optional_string(&params, "variant");
            let custom_spec_root = parse_optional_string(&params, "customSpecRoot");
            state
                .engine_send_message_sync(
                    workspace_id,
                    text,
                    engine,
                    model,
                    effort,
                    access_mode,
                    images,
                    continue_session,
                    session_id,
                    agent,
                    variant,
                    custom_spec_root,
                )
                .await
        }
        "engine_interrupt" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.engine_interrupt(workspace_id).await?;
            Ok(json!({ "ok": true }))
        }
        "engine_interrupt_turn" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let turn_id = parse_string(&params, "turnId")?;
            let engine = parse_optional_string(&params, "engine")
                .as_deref()
                .and_then(|value| parse_engine_type_string(Some(value)));
            state
                .engine_interrupt_turn(workspace_id, turn_id, engine)
                .await?;
            Ok(json!({ "ok": true }))
        }
        "start_web_server" => {
            let port = parse_optional_port(&params, "port")?;
            let token = parse_optional_string(&params, "token");
            state.start_web_server(port, token).await
        }
        "stop_web_server" => state.stop_web_server().await,
        "get_web_server_status" => state.get_web_server_status().await,
        "get_codex_config_path" => {
            let path = settings_core::get_codex_config_path_core()?;
            Ok(Value::String(path))
        }
        "get_config_model" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.get_config_model(workspace_id).await
        }
        "start_thread" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.start_thread(workspace_id).await
        }
        "list_claude_sessions" => {
            let workspace_path = parse_string(&params, "workspacePath")?;
            let limit = parse_optional_u32(&params, "limit").map(|value| value as usize);
            state.list_claude_sessions(workspace_path, limit).await
        }
        "load_claude_session" => {
            let workspace_path = parse_string(&params, "workspacePath")?;
            let session_id = parse_string(&params, "sessionId")?;
            state.load_claude_session(workspace_path, session_id).await
        }
        "fork_claude_session_from_message" => {
            let workspace_path = parse_string(&params, "workspacePath")?;
            let session_id = parse_string(&params, "sessionId")?;
            let message_id = parse_string(&params, "messageId")?;
            state
                .fork_claude_session_from_message(workspace_path, session_id, message_id)
                .await
        }
        "list_gemini_sessions" => {
            let workspace_path = parse_string(&params, "workspacePath")?;
            let limit = parse_optional_u32(&params, "limit").map(|value| value as usize);
            state.list_gemini_sessions(workspace_path, limit).await
        }
        "load_gemini_session" => {
            let workspace_path = parse_string(&params, "workspacePath")?;
            let session_id = parse_string(&params, "sessionId")?;
            state.load_gemini_session(workspace_path, session_id).await
        }
        "opencode_session_list" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let sessions = state.opencode_session_list(workspace_id).await?;
            serde_json::to_value(sessions).map_err(|err| err.to_string())
        }
        "resume_thread" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let thread_id = parse_string(&params, "threadId")?;
            state.resume_thread(workspace_id, thread_id).await
        }
        "fork_thread" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let thread_id = parse_string(&params, "threadId")?;
            state.fork_thread(workspace_id, thread_id).await
        }
        "list_threads" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let cursor = parse_optional_string(&params, "cursor");
            let limit = parse_optional_u32(&params, "limit");
            state.list_threads(workspace_id, cursor, limit).await
        }
        "list_mcp_server_status" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let cursor = parse_optional_string(&params, "cursor");
            let limit = parse_optional_u32(&params, "limit");
            state
                .list_mcp_server_status(workspace_id, cursor, limit)
                .await
        }
        "archive_thread" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let thread_id = parse_string(&params, "threadId")?;
            state.archive_thread(workspace_id, thread_id).await
        }
        "delete_codex_session" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let session_id = parse_string(&params, "sessionId")?;
            state.delete_codex_session(workspace_id, session_id).await
        }
        "send_user_message" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let thread_id = parse_string(&params, "threadId")?;
            let text = parse_string(&params, "text")?;
            let model = parse_optional_string(&params, "model");
            let effort = parse_optional_string(&params, "effort");
            let access_mode = parse_optional_string(&params, "accessMode");
            let images = parse_optional_string_array(&params, "images");
            let collaboration_mode = parse_optional_value(&params, "collaborationMode");
            let preferred_language = parse_optional_string(&params, "preferredLanguage");
            let custom_spec_root = parse_optional_string(&params, "customSpecRoot");
            state
                .send_user_message(
                    workspace_id,
                    thread_id,
                    text,
                    model,
                    effort,
                    access_mode,
                    images,
                    collaboration_mode,
                    preferred_language,
                    custom_spec_root,
                )
                .await
        }
        "turn_interrupt" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let thread_id = parse_string(&params, "threadId")?;
            let turn_id = parse_string(&params, "turnId")?;
            state.turn_interrupt(workspace_id, thread_id, turn_id).await
        }
        "thread_compact" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let thread_id = parse_string(&params, "threadId")?;
            state.thread_compact(workspace_id, thread_id).await
        }
        "start_review" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let thread_id = parse_string(&params, "threadId")?;
            let target = params
                .as_object()
                .and_then(|map| map.get("target"))
                .cloned()
                .ok_or("missing `target`")?;
            let delivery = parse_optional_string(&params, "delivery");
            state
                .start_review(workspace_id, thread_id, target, delivery)
                .await
        }
        "model_list" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.model_list(workspace_id).await
        }
        "collaboration_mode_list" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.collaboration_mode_list(workspace_id).await
        }
        "account_rate_limits" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.account_rate_limits(workspace_id).await
        }
        "account_read" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.account_read(workspace_id).await
        }
        "codex_login" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.codex_login(workspace_id).await
        }
        "codex_login_cancel" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.codex_login_cancel(workspace_id).await
        }
        "skills_list" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            state.skills_list(workspace_id).await
        }
        "list_thread_titles" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let titles = state.list_thread_titles(workspace_id).await?;
            serde_json::to_value(titles).map_err(|err| err.to_string())
        }
        "set_thread_title" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let thread_id = parse_string(&params, "threadId")?;
            let title = parse_string(&params, "title")?;
            let saved = state
                .set_thread_title(workspace_id, thread_id, title)
                .await?;
            Ok(Value::String(saved))
        }
        "rename_thread_title_key" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let old_thread_id = parse_string(&params, "oldThreadId")?;
            let new_thread_id = parse_string(&params, "newThreadId")?;
            state
                .rename_thread_title_key(workspace_id, old_thread_id, new_thread_id)
                .await?;
            Ok(json!({ "ok": true }))
        }
        "generate_thread_title" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let thread_id = parse_string(&params, "threadId")?;
            let user_message = parse_string(&params, "userMessage")?;
            let preferred_language = parse_optional_string(&params, "preferredLanguage");
            let generated = state
                .generate_thread_title(workspace_id, thread_id, user_message, preferred_language)
                .await?;
            Ok(Value::String(generated))
        }
        "respond_to_server_request" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let map = params.as_object().ok_or("missing requestId")?;
            let request_id = map
                .get("requestId")
                .cloned()
                .filter(|value| value.is_number() || value.is_string())
                .ok_or("missing requestId")?;
            let result = map.get("result").cloned().ok_or("missing `result`")?;
            state
                .respond_to_server_request(workspace_id, request_id, result)
                .await
        }
        "remember_approval_rule" => {
            let workspace_id = parse_string(&params, "workspaceId")?;
            let command = parse_string_array(&params, "command")?;
            state.remember_approval_rule(workspace_id, command).await
        }
        _ => Err(format!("unknown method: {method}")),
    }
}

async fn forward_events(
    mut rx: broadcast::Receiver<DaemonEvent>,
    out_tx_events: mpsc::UnboundedSender<String>,
) {
    loop {
        let event = match rx.recv().await {
            Ok(event) => event,
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
            Err(broadcast::error::RecvError::Closed) => break,
        };

        let Some(payload) = build_event_notification(event) else {
            continue;
        };

        if out_tx_events.send(payload).is_err() {
            break;
        }
    }
}

async fn handle_client(
    socket: TcpStream,
    config: Arc<DaemonConfig>,
    state: Arc<DaemonState>,
    events: broadcast::Sender<DaemonEvent>,
) {
    let (reader, mut writer) = socket.into_split();
    let mut lines = BufReader::new(reader).lines();

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    let write_task = tokio::spawn(async move {
        while let Some(message) = out_rx.recv().await {
            if writer.write_all(message.as_bytes()).await.is_err() {
                break;
            }
            if writer.write_all(b"\n").await.is_err() {
                break;
            }
        }
    });

    let mut authenticated = config.token.is_none();
    let mut events_task: Option<tokio::task::JoinHandle<()>> = None;

    if authenticated {
        let rx = events.subscribe();
        let out_tx_events = out_tx.clone();
        events_task = Some(tokio::spawn(forward_events(rx, out_tx_events)));
    }

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let message: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let id = message.get("id").and_then(|value| value.as_u64());
        let method = message
            .get("method")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        let params = message.get("params").cloned().unwrap_or(Value::Null);

        if !authenticated {
            if method != "auth" {
                if let Some(response) = build_error_response(id, "unauthorized") {
                    let _ = out_tx.send(response);
                }
                continue;
            }

            let expected = config.token.clone().unwrap_or_default();
            let provided = parse_auth_token(&params).unwrap_or_default();
            if expected != provided {
                if let Some(response) = build_error_response(id, "invalid token") {
                    let _ = out_tx.send(response);
                }
                continue;
            }

            authenticated = true;
            if let Some(response) = build_result_response(id, json!({ "ok": true })) {
                let _ = out_tx.send(response);
            }

            let rx = events.subscribe();
            let out_tx_events = out_tx.clone();
            events_task = Some(tokio::spawn(forward_events(rx, out_tx_events)));

            continue;
        }

        let client_version = format!("daemon-{}", env!("CARGO_PKG_VERSION"));
        let result = handle_rpc_request(&state, &method, params, client_version).await;
        let response = match result {
            Ok(result) => build_result_response(id, result),
            Err(message) => build_error_response(id, &message),
        };
        if let Some(response) = response {
            let _ = out_tx.send(response);
        }
    }

    drop(out_tx);
    if let Some(task) = events_task {
        task.abort();
    }
    write_task.abort();
}

fn main() {
    let config = match parse_args() {
        Ok(config) => config,
        Err(err) => {
            eprintln!("{err}\n\n{}", usage());
            std::process::exit(2);
        }
    };

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("failed to build tokio runtime");

    runtime.block_on(async move {
        let (events_tx, _events_rx) = broadcast::channel::<DaemonEvent>(2048);
        let event_sink = DaemonEventSink {
            tx: events_tx.clone(),
        };
        let state = Arc::new(DaemonState::load(&config, event_sink));
        let config = Arc::new(config);

        let listener = TcpListener::bind(config.listen)
            .await
            .unwrap_or_else(|err| panic!("failed to bind {}: {err}", config.listen));
        eprintln!(
            "cc_gui_daemon listening on {} (data dir: {})",
            config.listen,
            state
                .storage_path
                .parent()
                .unwrap_or(&state.storage_path)
                .display()
        );

        loop {
            match listener.accept().await {
                Ok((socket, _addr)) => {
                    let config = Arc::clone(&config);
                    let state = Arc::clone(&state);
                    let events = events_tx.clone();
                    tokio::spawn(async move {
                        handle_client(socket, config, state, events).await;
                    });
                }
                Err(_) => continue,
            }
        }
    });
}
