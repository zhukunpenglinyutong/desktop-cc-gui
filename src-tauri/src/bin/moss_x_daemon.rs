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
#[path = "../files/io.rs"]
mod file_io;
#[path = "../files/ops.rs"]
mod file_ops;
#[path = "../files/policy.rs"]
mod file_policy;
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
#[path = "../workspaces/settings.rs"]
mod workspace_settings;

// Provide feature-style module paths for shared cores when compiled in the daemon.
mod codex {
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
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};

use backend::app_server::{spawn_workspace_session, WorkspaceSession};
use backend::events::{AppServerEvent, EventSink, TerminalOutput};
use shared::{
    codex_core, files_core, git_core, proxy_core, settings_core, thread_titles_core,
    workspaces_core, worktree_core,
};
use storage::{read_settings, read_workspaces};
use text_encoding::decode_text_bytes;
use types::{AppSettings, WorkspaceEntry, WorkspaceInfo, WorkspaceSettings, WorktreeSetupStatus};
use workspace_settings::apply_workspace_settings_update;

const DEFAULT_LISTEN_ADDR: &str = "127.0.0.1:4732";

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
    event_sink: DaemonEventSink,
    codex_login_cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
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

impl DaemonState {
    fn load(config: &DaemonConfig, event_sink: DaemonEventSink) -> Self {
        let storage_path = config.data_dir.join("workspaces.json");
        let settings_path = config.data_dir.join("settings.json");
        let workspaces = read_workspaces(&storage_path).unwrap_or_default();
        let app_settings = read_settings(&settings_path).unwrap_or_default();
        if let Err(error) = proxy_core::apply_app_proxy_settings(&app_settings) {
            eprintln!("[proxy] failed to apply persisted proxy settings: {error}");
        }
        Self {
            data_dir: config.data_dir.clone(),
            workspaces: Mutex::new(workspaces),
            sessions: Mutex::new(HashMap::new()),
            storage_path,
            settings_path,
            app_settings: Mutex::new(app_settings),
            event_sink,
            codex_login_cancels: Mutex::new(HashMap::new()),
        }
    }

    async fn list_workspaces(&self) -> Vec<WorkspaceInfo> {
        workspaces_core::list_workspaces_core(&self.workspaces, &self.sessions).await
    }

    async fn is_workspace_path_dir(&self, path: String) -> bool {
        workspaces_core::is_workspace_path_dir_core(&path)
    }

    async fn ensure_workspace_path_dir(&self, path: String) -> Result<(), String> {
        workspaces_core::ensure_workspace_path_dir_core(&path)
    }

    async fn add_workspace(
        &self,
        path: String,
        codex_bin: Option<String>,
        client_version: String,
    ) -> Result<WorkspaceInfo, String> {
        let client_version = client_version.clone();
        workspaces_core::add_workspace_core(
            path,
            codex_bin,
            &self.workspaces,
            &self.sessions,
            &self.app_settings,
            &self.storage_path,
            move |entry, default_bin, codex_args, codex_home| {
                spawn_with_client(
                    self.event_sink.clone(),
                    client_version.clone(),
                    entry,
                    default_bin,
                    codex_args,
                    codex_home,
                )
            },
        )
        .await
    }

    async fn add_worktree(
        &self,
        parent_id: String,
        branch: String,
        base_ref: Option<String>,
        publish_to_origin: bool,
        client_version: String,
    ) -> Result<WorkspaceInfo, String> {
        let client_version = client_version.clone();
        workspaces_core::add_worktree_core(
            parent_id,
            branch,
            base_ref,
            publish_to_origin,
            &self.data_dir,
            &self.workspaces,
            &self.sessions,
            &self.app_settings,
            &self.storage_path,
            |value| worktree_core::sanitize_worktree_name(value),
            |root, name| worktree_core::unique_worktree_path_strict(root, name),
            |root, branch_name| {
                let root = root.clone();
                let branch_name = branch_name.to_string();
                async move { git_core::git_branch_exists(&root, &branch_name).await }
            },
            Some(|root: &PathBuf, branch_name: &str| {
                let root = root.clone();
                let branch_name = branch_name.to_string();
                async move { git_core::git_find_remote_tracking_branch_local(&root, &branch_name).await }
            }),
            |root, args| {
                workspaces_core::run_git_command_unit(root, args, git_core::run_git_command_owned)
            },
            move |entry, default_bin, codex_args, codex_home| {
                spawn_with_client(
                    self.event_sink.clone(),
                    client_version.clone(),
                    entry,
                    default_bin,
                    codex_args,
                    codex_home,
                )
            },
        )
        .await
    }

    async fn worktree_setup_status(
        &self,
        workspace_id: String,
    ) -> Result<WorktreeSetupStatus, String> {
        workspaces_core::worktree_setup_status_core(&self.workspaces, &workspace_id, &self.data_dir)
            .await
    }

    async fn worktree_setup_mark_ran(&self, workspace_id: String) -> Result<(), String> {
        workspaces_core::worktree_setup_mark_ran_core(
            &self.workspaces,
            &workspace_id,
            &self.data_dir,
        )
        .await
    }

    async fn remove_workspace(&self, id: String) -> Result<(), String> {
        workspaces_core::remove_workspace_core(
            id,
            &self.workspaces,
            &self.sessions,
            &self.storage_path,
            |root, args| {
                workspaces_core::run_git_command_unit(root, args, git_core::run_git_command_owned)
            },
            |error| git_core::is_missing_worktree_error(error),
            |path| {
                std::fs::remove_dir_all(path)
                    .map_err(|err| format!("Failed to remove worktree folder: {err}"))
            },
            true,
            true,
        )
        .await
    }

    async fn remove_worktree(&self, id: String) -> Result<(), String> {
        workspaces_core::remove_worktree_core(
            id,
            &self.workspaces,
            &self.sessions,
            &self.storage_path,
            |root, args| {
                workspaces_core::run_git_command_unit(root, args, git_core::run_git_command_owned)
            },
            |error| git_core::is_missing_worktree_error(error),
            |path| {
                std::fs::remove_dir_all(path)
                    .map_err(|err| format!("Failed to remove worktree folder: {err}"))
            },
        )
        .await
    }

    async fn rename_worktree(
        &self,
        id: String,
        branch: String,
        client_version: String,
    ) -> Result<WorkspaceInfo, String> {
        let client_version = client_version.clone();
        workspaces_core::rename_worktree_core(
            id,
            branch,
            &self.data_dir,
            &self.workspaces,
            &self.sessions,
            &self.app_settings,
            &self.storage_path,
            |entry| Ok(PathBuf::from(entry.path.clone())),
            |root, name| {
                let root = root.clone();
                let name = name.to_string();
                async move {
                    git_core::unique_branch_name_live(&root, &name, None)
                        .await
                        .map(|(branch_name, _was_suffixed)| branch_name)
                }
            },
            |value| worktree_core::sanitize_worktree_name(value),
            |root, name, current| {
                worktree_core::unique_worktree_path_for_rename(root, name, current)
            },
            |root, args| {
                workspaces_core::run_git_command_unit(root, args, git_core::run_git_command_owned)
            },
            move |entry, default_bin, codex_args, codex_home| {
                spawn_with_client(
                    self.event_sink.clone(),
                    client_version.clone(),
                    entry,
                    default_bin,
                    codex_args,
                    codex_home,
                )
            },
        )
        .await
    }

    async fn rename_worktree_upstream(
        &self,
        id: String,
        old_branch: String,
        new_branch: String,
    ) -> Result<(), String> {
        workspaces_core::rename_worktree_upstream_core(
            id,
            old_branch,
            new_branch,
            &self.workspaces,
            |entry| Ok(PathBuf::from(entry.path.clone())),
            |root, branch_name| {
                let root = root.clone();
                let branch_name = branch_name.to_string();
                async move { git_core::git_branch_exists(&root, &branch_name).await }
            },
            |root, branch_name| {
                let root = root.clone();
                let branch_name = branch_name.to_string();
                async move { git_core::git_find_remote_for_branch_live(&root, &branch_name).await }
            },
            |root, remote| {
                let root = root.clone();
                let remote = remote.to_string();
                async move { git_core::git_remote_exists(&root, &remote).await }
            },
            |root, remote, branch_name| {
                let root = root.clone();
                let remote = remote.to_string();
                let branch_name = branch_name.to_string();
                async move {
                    git_core::git_remote_branch_exists_live(&root, &remote, &branch_name).await
                }
            },
            |root, args| {
                workspaces_core::run_git_command_unit(root, args, git_core::run_git_command_owned)
            },
        )
        .await
    }

    async fn update_workspace_settings(
        &self,
        id: String,
        settings: WorkspaceSettings,
        client_version: String,
    ) -> Result<WorkspaceInfo, String> {
        let client_version = client_version.clone();
        workspaces_core::update_workspace_settings_core(
            id,
            settings,
            &self.workspaces,
            &self.sessions,
            &self.app_settings,
            &self.storage_path,
            |workspaces, workspace_id, next_settings| {
                apply_workspace_settings_update(workspaces, workspace_id, next_settings)
            },
            move |entry, default_bin, codex_args, codex_home| {
                spawn_with_client(
                    self.event_sink.clone(),
                    client_version.clone(),
                    entry,
                    default_bin,
                    codex_args,
                    codex_home,
                )
            },
        )
        .await
    }

    async fn update_workspace_codex_bin(
        &self,
        id: String,
        codex_bin: Option<String>,
    ) -> Result<WorkspaceInfo, String> {
        workspaces_core::update_workspace_codex_bin_core(
            id,
            codex_bin,
            &self.workspaces,
            &self.sessions,
            &self.storage_path,
        )
        .await
    }

    async fn connect_workspace(&self, id: String, client_version: String) -> Result<(), String> {
        {
            let sessions = self.sessions.lock().await;
            if sessions.contains_key(&id) {
                return Ok(());
            }
        }

        let client_version = client_version.clone();
        workspaces_core::connect_workspace_core(
            id,
            &self.workspaces,
            &self.sessions,
            &self.app_settings,
            move |entry, default_bin, codex_args, codex_home| {
                spawn_with_client(
                    self.event_sink.clone(),
                    client_version.clone(),
                    entry,
                    default_bin,
                    codex_args,
                    codex_home,
                )
            },
        )
        .await
    }

    async fn get_app_settings(&self) -> AppSettings {
        settings_core::get_app_settings_core(&self.app_settings).await
    }

    async fn update_app_settings(&self, settings: AppSettings) -> Result<AppSettings, String> {
        let previous = self.app_settings.lock().await.clone();
        let updated = settings_core::update_app_settings_core(
            settings,
            &self.app_settings,
            &self.settings_path,
        )
        .await?;
        let proxy_changed = previous.system_proxy_enabled != updated.system_proxy_enabled
            || previous.system_proxy_url != updated.system_proxy_url;
        if proxy_changed {
            let client_version = env!("CARGO_PKG_VERSION").to_string();
            if let Err(error) = settings_core::restart_codex_sessions_for_app_settings_change_core(
                &self.workspaces,
                &self.sessions,
                &self.app_settings,
                |entry, default_bin, codex_args, codex_home| {
                    spawn_with_client(
                        self.event_sink.clone(),
                        client_version.clone(),
                        entry,
                        default_bin,
                        codex_args,
                        codex_home,
                    )
                },
            )
            .await
            {
                let rollback_error = settings_core::restore_app_settings_core(
                    &previous,
                    &self.app_settings,
                    &self.settings_path,
                )
                .await
                .err();
                let message = match rollback_error {
                    Some(rollback_error) => {
                        format!("{error} (rollback failed: {rollback_error})")
                    }
                    None => error,
                };
                return Err(message);
            }
        }
        Ok(updated)
    }

    async fn list_workspace_files(
        &self,
        workspace_id: String,
    ) -> Result<WorkspaceFilesResponse, String> {
        workspaces_core::list_workspace_files_core(&self.workspaces, &workspace_id, |root| {
            list_workspace_files_inner(root, 12_000)
        })
        .await
    }

    async fn list_workspace_directory_children(
        &self,
        workspace_id: String,
        path: String,
    ) -> Result<WorkspaceFilesResponse, String> {
        workspaces_core::read_workspace_file_core(
            &self.workspaces,
            &workspace_id,
            &path,
            |root, rel_path| list_workspace_directory_children_inner(root, rel_path, 2_000),
        )
        .await
    }

    async fn read_workspace_file(
        &self,
        workspace_id: String,
        path: String,
    ) -> Result<WorkspaceFileResponse, String> {
        workspaces_core::read_workspace_file_core(
            &self.workspaces,
            &workspace_id,
            &path,
            |root, rel_path| read_workspace_file_inner(root, rel_path),
        )
        .await
    }

    async fn list_external_spec_tree(
        &self,
        workspace_id: String,
        spec_root: String,
    ) -> Result<WorkspaceFilesResponse, String> {
        {
            let workspaces = self.workspaces.lock().await;
            if !workspaces.contains_key(&workspace_id) {
                return Err(format!("Workspace not found: {workspace_id}"));
            }
        }
        list_external_spec_tree_inner(&spec_root, usize::MAX)
    }

    async fn read_external_spec_file(
        &self,
        workspace_id: String,
        spec_root: String,
        path: String,
    ) -> Result<ExternalSpecFileResponse, String> {
        {
            let workspaces = self.workspaces.lock().await;
            if !workspaces.contains_key(&workspace_id) {
                return Err(format!("Workspace not found: {workspace_id}"));
            }
        }
        read_external_spec_file_inner(&spec_root, &path)
    }

    async fn write_external_spec_file(
        &self,
        workspace_id: String,
        spec_root: String,
        path: String,
        content: String,
    ) -> Result<(), String> {
        {
            let workspaces = self.workspaces.lock().await;
            if !workspaces.contains_key(&workspace_id) {
                return Err(format!("Workspace not found: {workspace_id}"));
            }
        }
        write_external_spec_file_inner(&spec_root, &path, &content)
    }

    async fn file_read(
        &self,
        scope: file_policy::FileScope,
        kind: file_policy::FileKind,
        workspace_id: Option<String>,
    ) -> Result<file_io::TextFileResponse, String> {
        files_core::file_read_core(&self.workspaces, scope, kind, workspace_id).await
    }

    async fn file_write(
        &self,
        scope: file_policy::FileScope,
        kind: file_policy::FileKind,
        workspace_id: Option<String>,
        content: String,
    ) -> Result<(), String> {
        files_core::file_write_core(&self.workspaces, scope, kind, workspace_id, content).await
    }

    async fn start_thread(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::start_thread_core(&self.sessions, workspace_id, None).await
    }

    async fn resume_thread(
        &self,
        workspace_id: String,
        thread_id: String,
    ) -> Result<Value, String> {
        codex_core::resume_thread_core(&self.sessions, workspace_id, thread_id).await
    }

    async fn fork_thread(&self, workspace_id: String, thread_id: String) -> Result<Value, String> {
        codex_core::fork_thread_core(&self.sessions, workspace_id, thread_id).await
    }

    async fn list_threads(
        &self,
        workspace_id: String,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, String> {
        codex_core::list_threads_core(&self.sessions, workspace_id, cursor, limit).await
    }

    async fn list_mcp_server_status(
        &self,
        workspace_id: String,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, String> {
        codex_core::list_mcp_server_status_core(&self.sessions, workspace_id, cursor, limit).await
    }

    async fn archive_thread(
        &self,
        workspace_id: String,
        thread_id: String,
    ) -> Result<Value, String> {
        codex_core::archive_thread_core(&self.sessions, workspace_id, thread_id).await
    }

    async fn send_user_message(
        &self,
        workspace_id: String,
        thread_id: String,
        text: String,
        model: Option<String>,
        effort: Option<String>,
        access_mode: Option<String>,
        images: Option<Vec<String>>,
        collaboration_mode: Option<Value>,
        preferred_language: Option<String>,
        custom_spec_root: Option<String>,
    ) -> Result<Value, String> {
        let mode_enforcement_enabled = {
            let settings = self.app_settings.lock().await;
            settings.codex_mode_enforcement_enabled
        };
        codex_core::send_user_message_core(
            &self.sessions,
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
            mode_enforcement_enabled,
        )
        .await
    }

    async fn turn_interrupt(
        &self,
        workspace_id: String,
        thread_id: String,
        turn_id: String,
    ) -> Result<Value, String> {
        codex_core::turn_interrupt_core(&self.sessions, workspace_id, thread_id, turn_id).await
    }

    async fn thread_compact(
        &self,
        workspace_id: String,
        thread_id: String,
    ) -> Result<Value, String> {
        codex_core::thread_compact_core(&self.sessions, workspace_id, thread_id).await
    }

    async fn start_review(
        &self,
        workspace_id: String,
        thread_id: String,
        target: Value,
        delivery: Option<String>,
    ) -> Result<Value, String> {
        codex_core::start_review_core(&self.sessions, workspace_id, thread_id, target, delivery)
            .await
    }

    async fn model_list(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::model_list_core(&self.sessions, workspace_id).await
    }

    async fn collaboration_mode_list(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::collaboration_mode_list_core(&self.sessions, workspace_id).await
    }

    async fn account_rate_limits(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::account_rate_limits_core(&self.sessions, workspace_id).await
    }

    async fn account_read(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::account_read_core(&self.sessions, &self.workspaces, workspace_id).await
    }

    async fn codex_login(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::codex_login_core(
            &self.workspaces,
            &self.app_settings,
            &self.codex_login_cancels,
            workspace_id,
        )
        .await
    }

    async fn codex_login_cancel(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::codex_login_cancel_core(&self.codex_login_cancels, workspace_id).await
    }

    async fn skills_list(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::skills_list_core(&self.sessions, workspace_id).await
    }

    async fn list_thread_titles(
        &self,
        workspace_id: String,
    ) -> Result<HashMap<String, String>, String> {
        thread_titles_core::list_thread_titles_core(&self.workspaces, workspace_id).await
    }

    async fn set_thread_title(
        &self,
        workspace_id: String,
        thread_id: String,
        title: String,
    ) -> Result<String, String> {
        thread_titles_core::upsert_thread_title_core(
            &self.workspaces,
            workspace_id,
            thread_id,
            title,
        )
        .await
    }

    async fn rename_thread_title_key(
        &self,
        workspace_id: String,
        old_thread_id: String,
        new_thread_id: String,
    ) -> Result<(), String> {
        thread_titles_core::rename_thread_title_core(
            &self.workspaces,
            workspace_id,
            old_thread_id,
            new_thread_id,
        )
        .await
    }

    async fn generate_thread_title(
        &self,
        workspace_id: String,
        thread_id: String,
        user_message: String,
        preferred_language: Option<String>,
    ) -> Result<String, String> {
        let cleaned_message = user_message.trim().to_string();
        if cleaned_message.is_empty() {
            return Err("Message is required to generate title".to_string());
        }

        let language_instruction = match preferred_language
            .unwrap_or_else(|| "en".to_string())
            .trim()
            .to_lowercase()
            .as_str()
        {
            "zh" | "zh-cn" | "zh-hans" | "chinese" => "Output language: Simplified Chinese.",
            _ => "Output language: English.",
        };

        let session = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(&workspace_id)
                .ok_or("workspace not connected")?
                .clone()
        };

        let prompt = format!(
            "Generate a concise title for a coding chat thread from the first user message. \
Return only the title text, no quotes, no punctuation-only output, no markdown. \
Keep it between 3 and 8 words.\n\
{language_instruction}\n\nFirst user message:\n{cleaned_message}"
        );

        let helper_thread_result = session
            .send_request(
                "thread/start",
                json!({
                    "cwd": session.entry.path,
                    "approvalPolicy": "never"
                }),
            )
            .await?;

        if let Some(error) = helper_thread_result.get("error") {
            let message = error
                .get("message")
                .and_then(|value| value.as_str())
                .unwrap_or("Unknown error starting title thread");
            return Err(message.to_string());
        }

        let helper_thread_id = helper_thread_result
            .get("result")
            .and_then(|result| result.get("threadId"))
            .or_else(|| {
                helper_thread_result
                    .get("result")
                    .and_then(|result| result.get("thread"))
                    .and_then(|thread| thread.get("id"))
            })
            .or_else(|| helper_thread_result.get("threadId"))
            .or_else(|| {
                helper_thread_result
                    .get("thread")
                    .and_then(|thread| thread.get("id"))
            })
            .and_then(|value| value.as_str())
            .ok_or_else(|| {
                format!(
                    "Failed to get threadId from thread/start response: {:?}",
                    helper_thread_result
                )
            })?
            .to_string();

        let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
        {
            let mut callbacks = session.background_thread_callbacks.lock().await;
            callbacks.insert(helper_thread_id.clone(), tx);
        }

        let turn_start_result = session
            .send_request(
                "turn/start",
                json!({
                    "threadId": helper_thread_id,
                    "input": [{ "type": "text", "text": prompt }],
                    "cwd": session.entry.path,
                    "approvalPolicy": "never",
                    "sandboxPolicy": { "type": "readOnly" },
                }),
            )
            .await;

        let turn_start_result = match turn_start_result {
            Ok(value) => value,
            Err(error) => {
                {
                    let mut callbacks = session.background_thread_callbacks.lock().await;
                    callbacks.remove(&helper_thread_id);
                }
                let _ = session
                    .send_request(
                        "thread/archive",
                        json!({ "threadId": helper_thread_id.as_str() }),
                    )
                    .await;
                return Err(error);
            }
        };

        if let Some(error) = turn_start_result.get("error") {
            let message = error
                .get("message")
                .and_then(|value| value.as_str())
                .unwrap_or("Unknown error starting title generation turn")
                .to_string();
            {
                let mut callbacks = session.background_thread_callbacks.lock().await;
                callbacks.remove(&helper_thread_id);
            }
            let _ = session
                .send_request(
                    "thread/archive",
                    json!({ "threadId": helper_thread_id.as_str() }),
                )
                .await;
            return Err(message);
        }

        let mut generated = String::new();
        let collect_result = tokio::time::timeout(std::time::Duration::from_secs(30), async {
            while let Some(event) = rx.recv().await {
                let method = event
                    .get("method")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                match method {
                    "item/agentMessage/delta" => {
                        if let Some(delta) = event
                            .get("params")
                            .and_then(|params| params.get("delta"))
                            .and_then(|value| value.as_str())
                        {
                            generated.push_str(delta);
                        }
                    }
                    "turn/completed" => break,
                    "turn/error" => {
                        let message = event
                            .get("params")
                            .and_then(|params| params.get("error"))
                            .and_then(|value| value.as_str())
                            .unwrap_or("Unknown error during title generation");
                        return Err(message.to_string());
                    }
                    _ => {}
                }
            }
            Ok(())
        })
        .await;

        {
            let mut callbacks = session.background_thread_callbacks.lock().await;
            callbacks.remove(&helper_thread_id);
        }

        let _ = session
            .send_request("thread/archive", json!({ "threadId": helper_thread_id }))
            .await;

        match collect_result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => return Err(error),
            Err(_) => return Err("Timeout waiting for thread title generation".to_string()),
        }

        let normalized = generated
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .trim_matches('"')
            .to_string();
        if normalized.is_empty() {
            return Err("No thread title was generated".to_string());
        }

        thread_titles_core::upsert_thread_title_core(
            &self.workspaces,
            workspace_id,
            thread_id,
            normalized,
        )
        .await
    }

    async fn respond_to_server_request(
        &self,
        workspace_id: String,
        request_id: Value,
        result: Value,
    ) -> Result<Value, String> {
        codex_core::respond_to_server_request_core(
            &self.sessions,
            workspace_id,
            request_id,
            result,
        )
        .await?;
        Ok(json!({ "ok": true }))
    }

    async fn remember_approval_rule(
        &self,
        workspace_id: String,
        command: Vec<String>,
    ) -> Result<Value, String> {
        codex_core::remember_approval_rule_core(&self.workspaces, workspace_id, command).await
    }

    async fn get_config_model(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::get_config_model_core(&self.workspaces, workspace_id).await
    }
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
    let resolved = resolve_external_spec_root(spec_root)?;
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
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
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
            directories.push(logical);
        } else if entry.file_type().is_some_and(|ft| ft.is_file()) {
            files.push(logical);
            if files.len() >= max_files {
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

fn default_data_dir() -> PathBuf {
    if let Ok(xdg) = env::var("XDG_DATA_HOME") {
        let trimmed = xdg.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("moss-x-daemon");
        }
    }
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".local")
        .join("share")
        .join("moss-x-daemon")
}

fn usage() -> String {
    format!(
        "\
USAGE:\n  moss-x-daemon [--listen <addr>] [--data-dir <path>] [--token <token> | --insecure-no-auth]\n\n\
OPTIONS:\n  --listen <addr>        Bind address (default: {DEFAULT_LISTEN_ADDR})\n  --data-dir <path>      Data dir holding workspaces.json/settings.json\n  --token <token>        Shared token required by clients\n  --insecure-no-auth      Disable auth (dev only)\n  -h, --help             Show this help\n"
    )
}

fn parse_args() -> Result<DaemonConfig, String> {
    let mut listen = DEFAULT_LISTEN_ADDR
        .parse::<SocketAddr>()
        .map_err(|err| err.to_string())?;
    let mut token = env::var("MOSS_X_DAEMON_TOKEN")
        .ok()
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
            "Missing --token (or set MOSS_X_DAEMON_TOKEN). Use --insecure-no-auth for local dev only."
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
            "moss-x-daemon listening on {} (data dir: {})",
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
