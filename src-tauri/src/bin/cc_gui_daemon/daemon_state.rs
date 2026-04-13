use super::*;

mod git;

fn is_valid_claude_model_for_passthrough(model: &str) -> bool {
    let trimmed = model.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return false;
    }
    trimmed.chars().all(|ch| {
        ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':' | '/' | '[' | ']')
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CodexRuntimeReloadResult {
    status: String,
    stage: String,
    restarted_sessions: usize,
    message: Option<String>,
}

impl DaemonState {
    fn allowed_external_skill_roots(
        &self,
        workspaces: &HashMap<String, WorkspaceEntry>,
        workspace_id: &str,
    ) -> Result<Vec<PathBuf>, String> {
        let entry = workspaces
            .get(workspace_id)
            .ok_or_else(|| format!("Workspace not found: {workspace_id}"))?;
        let parent_entry = entry
            .parent_id
            .as_ref()
            .and_then(|parent_id| workspaces.get(parent_id));

        let mut roots = vec![
            self.data_dir
                .join("workspaces")
                .join(&entry.id)
                .join("skills"),
            PathBuf::from(&entry.path).join(".claude").join("skills"),
            PathBuf::from(&entry.path).join(".codex").join("skills"),
            PathBuf::from(&entry.path).join(".gemini").join("skills"),
            PathBuf::from(&entry.path).join(".agents").join("skills"),
        ];

        if let Some(home) = dirs::home_dir() {
            roots.push(home.join(".claude").join("skills"));
            roots.push(home.join(".gemini").join("skills"));
            roots.push(home.join(".agents").join("skills"));
        }

        if let Some(codex_home) = codex::home::resolve_workspace_codex_home(entry, parent_entry)
            .or_else(codex::home::resolve_default_codex_home)
        {
            roots.push(codex_home.join("skills"));
        }

        roots.sort();
        roots.dedup();
        Ok(roots)
    }

    pub(super) fn load(config: &DaemonConfig, event_sink: DaemonEventSink) -> Self {
        let storage_path = config.data_dir.join("workspaces.json");
        let settings_path = config.data_dir.join("settings.json");
        let workspaces = read_workspaces(&storage_path).unwrap_or_default();
        let app_settings = read_settings(&settings_path).unwrap_or_default();
        let active_engine = parse_engine_type_string(app_settings.default_engine.as_deref())
            .unwrap_or(engine::EngineType::Codex);
        let web_service_runtime = WebServiceRuntime::new(
            config.listen.to_string(),
            config.token.clone(),
            app_settings.web_service_port,
        );
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
            codex_runtime_reload_lock: Mutex::new(()),
            web_service_runtime: Mutex::new(web_service_runtime),
            event_sink,
            codex_login_cancels: Mutex::new(HashMap::new()),
            engine_manager: engine::EngineManager::new(),
            active_engine: Mutex::new(active_engine),
        }
    }

    pub(super) async fn list_workspaces(&self) -> Vec<WorkspaceInfo> {
        workspaces_core::list_workspaces_core(&self.workspaces, &self.sessions).await
    }

    pub(super) async fn is_workspace_path_dir(&self, path: String) -> bool {
        workspaces_core::is_workspace_path_dir_core(&path)
    }

    pub(super) async fn ensure_workspace_path_dir(&self, path: String) -> Result<(), String> {
        workspaces_core::ensure_workspace_path_dir_core(&path)
    }

    pub(super) async fn add_workspace(
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

    pub(super) async fn add_worktree(
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

    pub(super) async fn worktree_setup_status(
        &self,
        workspace_id: String,
    ) -> Result<WorktreeSetupStatus, String> {
        workspaces_core::worktree_setup_status_core(&self.workspaces, &workspace_id, &self.data_dir)
            .await
    }

    pub(super) async fn worktree_setup_mark_ran(&self, workspace_id: String) -> Result<(), String> {
        workspaces_core::worktree_setup_mark_ran_core(
            &self.workspaces,
            &workspace_id,
            &self.data_dir,
        )
        .await
    }

    pub(super) async fn remove_workspace(&self, id: String) -> Result<(), String> {
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

    pub(super) async fn remove_worktree(&self, id: String) -> Result<(), String> {
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

    pub(super) async fn rename_worktree(
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

    pub(super) async fn rename_worktree_upstream(
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

    pub(super) async fn update_workspace_settings(
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

    pub(super) async fn update_workspace_codex_bin(
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

    pub(super) async fn connect_workspace(
        &self,
        id: String,
        client_version: String,
    ) -> Result<(), String> {
        {
            let sessions = self.sessions.lock().await;
            if sessions.contains_key(&id) {
                return Ok(());
            }
        }

        let active_engine = *self.active_engine.lock().await;
        {
            let workspaces = self.workspaces.lock().await;
            let entry = workspaces
                .get(&id)
                .ok_or_else(|| "workspace not found".to_string())?;
            let should_connect_for_active_codex = active_engine == engine::EngineType::Codex;
            if !workspaces_core::workspace_requires_persistent_session(entry)
                && !should_connect_for_active_codex
            {
                // Claude/Gemini/OpenCode do not require a persistent workspace session
                // unless the currently active engine is Codex.
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

    pub(super) async fn get_app_settings(&self) -> AppSettings {
        settings_core::get_app_settings_core(&self.app_settings).await
    }

    pub(super) async fn update_app_settings(
        &self,
        settings: AppSettings,
    ) -> Result<AppSettings, String> {
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
        {
            let mut web_service_runtime = self.web_service_runtime.lock().await;
            web_service_runtime.set_default_port(updated.web_service_port);
        }
        if let Some(engine) = parse_engine_type_string(updated.default_engine.as_deref()) {
            let mut active = self.active_engine.lock().await;
            *active = engine;
        }
        Ok(updated)
    }

    pub(super) async fn reload_codex_runtime_config(
        &self,
    ) -> Result<CodexRuntimeReloadResult, String> {
        let _reload_guard = self.codex_runtime_reload_lock.lock().await;
        let restarted_sessions = {
            let sessions = self.sessions.lock().await;
            sessions.len()
        };
        if restarted_sessions == 0 {
            return Ok(CodexRuntimeReloadResult {
                status: "applied".to_string(),
                stage: "noop".to_string(),
                restarted_sessions: 0,
                message: Some("No connected Codex sessions to reload.".to_string()),
            });
        }

        let client_version = env!("CARGO_PKG_VERSION").to_string();
        settings_core::restart_codex_sessions_for_app_settings_change_core(
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
        .await?;

        Ok(CodexRuntimeReloadResult {
            status: "applied".to_string(),
            stage: "swapped".to_string(),
            restarted_sessions,
            message: None,
        })
    }

    pub(super) async fn sync_engine_configs(&self) {
        let settings = self.app_settings.lock().await.clone();
        self.engine_manager
            .set_engine_config(
                engine::EngineType::Claude,
                engine::EngineConfig {
                    bin_path: settings.claude_bin.clone(),
                    home_dir: None,
                    custom_args: None,
                    default_model: None,
                },
            )
            .await;
        self.engine_manager
            .set_engine_config(
                engine::EngineType::Codex,
                engine::EngineConfig {
                    bin_path: settings.codex_bin.clone(),
                    home_dir: None,
                    custom_args: settings.codex_args.clone(),
                    default_model: None,
                },
            )
            .await;
    }

    pub(super) async fn detect_engines(&self) -> Vec<engine::EngineStatus> {
        self.sync_engine_configs().await;
        self.engine_manager.detect_engines().await
    }

    pub(super) async fn get_active_engine(&self) -> engine::EngineType {
        *self.active_engine.lock().await
    }

    pub(super) async fn switch_engine(
        &self,
        engine_type: engine::EngineType,
    ) -> Result<(), String> {
        self.sync_engine_configs().await;
        let statuses = self.engine_manager.detect_engines().await;
        let installed = statuses
            .iter()
            .find(|entry| entry.engine_type == engine_type)
            .map(|entry| entry.installed)
            .unwrap_or(false);
        if !installed {
            return Err(format!("{:?} is not installed", engine_type));
        }
        {
            let mut active = self.active_engine.lock().await;
            *active = engine_type;
        }
        self.engine_manager.set_active_engine(engine_type).await?;
        Ok(())
    }

    pub(super) async fn get_engine_status(
        &self,
        engine_type: engine::EngineType,
    ) -> Option<engine::EngineStatus> {
        self.sync_engine_configs().await;
        let statuses = self.engine_manager.detect_engines().await;
        statuses
            .into_iter()
            .find(|entry| entry.engine_type == engine_type)
    }

    pub(super) async fn get_engine_models(
        &self,
        engine_type: engine::EngineType,
    ) -> Vec<engine::ModelInfo> {
        self.get_engine_status(engine_type)
            .await
            .map(|status| status.models)
            .unwrap_or_default()
    }

    pub(super) async fn workspace_path_for_engine(
        &self,
        workspace_id: &str,
    ) -> Result<PathBuf, String> {
        let workspaces = self.workspaces.lock().await;
        workspaces
            .get(workspace_id)
            .map(|entry| PathBuf::from(&entry.path))
            .ok_or_else(|| "Workspace not found".to_string())
    }

    pub(super) async fn engine_send_message(
        &self,
        workspace_id: String,
        text: String,
        engine: Option<engine::EngineType>,
        model: Option<String>,
        effort: Option<String>,
        access_mode: Option<String>,
        images: Option<Vec<String>>,
        continue_session: bool,
        thread_id: Option<String>,
        session_id: Option<String>,
        agent: Option<String>,
        variant: Option<String>,
        custom_spec_root: Option<String>,
    ) -> Result<Value, String> {
        self.sync_engine_configs().await;
        let active_engine = self.get_active_engine().await;
        let effective_engine = engine.unwrap_or(active_engine);
        let normalized_custom_spec_root = normalize_custom_spec_root(custom_spec_root);

        match effective_engine {
            engine::EngineType::Codex => {
                let target_thread_id = thread_id.ok_or_else(|| {
                    "threadId is required for codex engine_send_message".to_string()
                })?;
                self.send_user_message(
                    workspace_id,
                    target_thread_id,
                    text,
                    model,
                    effort,
                    access_mode,
                    images,
                    None,
                    None,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine::EngineType::Claude => {
                let workspace_path = self.workspace_path_for_engine(&workspace_id).await?;
                let session = self
                    .engine_manager
                    .get_claude_session(&workspace_id, &workspace_path)
                    .await;
                let has_images = images
                    .as_ref()
                    .is_some_and(|entries| entries.iter().any(|entry| !entry.trim().is_empty()));
                let continue_session_for_send = continue_session;
                let resolved_session_id = if continue_session {
                    if session_id.is_some() {
                        session_id
                    } else {
                        session.get_session_id().await
                    }
                } else {
                    Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
                };

                let sanitized_model = model
                    .as_ref()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .and_then(|value| {
                        if is_valid_claude_model_for_passthrough(value) {
                            Some(value.to_string())
                        } else {
                            None
                        }
                    });
                if model.is_some() && sanitized_model.is_none() {
                    eprintln!(
                        "[engine_send_message] dropped invalid claude model={:?}, fallback to default",
                        model
                    );
                }

                let response_session_id = resolved_session_id.clone();
                let params = engine::SendMessageParams {
                    text,
                    model: sanitized_model,
                    effort,
                    access_mode,
                    images,
                    continue_session: continue_session_for_send,
                    session_id: resolved_session_id,
                    agent: None,
                    variant: None,
                    collaboration_mode: None,
                    custom_spec_root: normalized_custom_spec_root.clone(),
                };

                let turn_id = format!("claude-turn-{}", uuid::Uuid::new_v4());
                let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
                let item_id = format!("claude-item-{}", uuid::Uuid::new_v4());

                let mut receiver = session.subscribe();
                let event_sink = self.event_sink.clone();
                let mut current_thread_id = thread_id.clone();
                let item_id_clone = item_id.clone();
                let turn_id_for_forwarder = turn_id.clone();
                let mut accumulated_agent_text = String::new();
                tokio::spawn(async move {
                    let deadline = tokio::time::Instant::now()
                        + std::time::Duration::from_secs(EVENT_FORWARDER_TIMEOUT_SECS);
                    loop {
                        let recv_result = tokio::time::timeout_at(deadline, receiver.recv()).await;
                        let turn_event = match recv_result {
                            Ok(Ok(event)) => event,
                            Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
                            Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => {
                                continue;
                            }
                            Err(_) => break,
                        };
                        if turn_event.turn_id != turn_id_for_forwarder {
                            continue;
                        }

                        let event = turn_event.event;
                        let is_terminal = event.is_terminal();

                        if let engine::events::EngineEvent::TextDelta { text, .. } = &event {
                            accumulated_agent_text.push_str(text);
                        }

                        if let engine::events::EngineEvent::TurnCompleted { result, .. } = &event {
                            let fallback_text =
                                extract_turn_result_text(result.as_ref()).unwrap_or_default();
                            let completed_text = if accumulated_agent_text.trim().is_empty() {
                                fallback_text
                            } else {
                                accumulated_agent_text.clone()
                            };
                            if !completed_text.trim().is_empty() {
                                event_sink.emit_app_server_event(AppServerEvent {
                                    workspace_id: event.workspace_id().to_string(),
                                    message: json!({
                                        "method": "item/completed",
                                        "params": {
                                            "threadId": &current_thread_id,
                                            "item": {
                                                "id": &item_id_clone,
                                                "type": "agentMessage",
                                                "text": completed_text,
                                                "status": "completed",
                                            }
                                        }
                                    }),
                                });
                            }
                        }

                        if let Some(payload) = engine::events::engine_event_to_app_server_event(
                            &event,
                            &current_thread_id,
                            &item_id_clone,
                        ) {
                            event_sink.emit_app_server_event(payload);
                        }

                        if let engine::events::EngineEvent::SessionStarted {
                            session_id,
                            engine,
                            ..
                        } = &event
                        {
                            if !session_id.is_empty() && session_id != "pending" {
                                match engine {
                                    engine::EngineType::Claude => {
                                        current_thread_id = format!("claude:{}", session_id);
                                    }
                                    engine::EngineType::OpenCode => {
                                        current_thread_id = format!("opencode:{}", session_id);
                                    }
                                    engine::EngineType::Gemini => {
                                        current_thread_id = format!("gemini:{}", session_id);
                                    }
                                    engine::EngineType::Codex => {}
                                }
                            }
                        }

                        if is_terminal {
                            break;
                        }
                    }
                });

                let session_clone = session.clone();
                let turn_id_clone = turn_id.clone();
                tokio::spawn(async move {
                    let send_result = if has_images {
                        session_clone.send_message(params, &turn_id_clone).await
                    } else {
                        session_clone
                            .send_message_with_auto_compact_retry(params, &turn_id_clone)
                            .await
                    };
                    if let Err(error) = send_result {
                        eprintln!("Claude send_message failed: {error}");
                    }
                });

                Ok(json!({
                    "engine": "claude",
                    "sessionId": response_session_id.clone(),
                    "result": {
                        "sessionId": response_session_id,
                        "turn": {
                            "id": turn_id,
                            "status": "started",
                        }
                    },
                    "turn": {
                        "id": turn_id,
                        "status": "started",
                    }
                }))
            }
            engine::EngineType::OpenCode => {
                let workspace_path = self.workspace_path_for_engine(&workspace_id).await?;
                let session = self
                    .engine_manager
                    .get_or_create_opencode_session(&workspace_id, &workspace_path)
                    .await;
                let resolved_session_id = if continue_session {
                    if session_id.is_some() {
                        session_id
                    } else {
                        session.get_session_id().await
                    }
                } else {
                    Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
                };
                let sanitized_model = model
                    .as_ref()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .and_then(|value| {
                        if is_likely_legacy_claude_model_id(value) {
                            None
                        } else {
                            Some(value.to_string())
                        }
                    });
                if model.is_some() && sanitized_model.is_none() {
                    eprintln!(
                        "[engine_send_message] dropped invalid opencode model={:?}, fallback to default",
                        model
                    );
                }
                let model_for_send =
                    sanitized_model.or_else(|| Some("openai/gpt-5.3-codex".to_string()));
                let params = engine::SendMessageParams {
                    text,
                    model: model_for_send,
                    effort,
                    access_mode,
                    images,
                    continue_session,
                    session_id: resolved_session_id,
                    agent,
                    variant,
                    collaboration_mode: None,
                    custom_spec_root: normalized_custom_spec_root.clone(),
                };

                let turn_id = format!("opencode-turn-{}", uuid::Uuid::new_v4());
                let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
                let item_id = format!("opencode-item-{}", uuid::Uuid::new_v4());

                let mut receiver = session.subscribe();
                let event_sink = self.event_sink.clone();
                let mut current_thread_id = thread_id.clone();
                let item_id_clone = item_id.clone();
                let turn_id_for_forwarder = turn_id.clone();
                tokio::spawn(async move {
                    let deadline = tokio::time::Instant::now()
                        + std::time::Duration::from_secs(EVENT_FORWARDER_TIMEOUT_SECS);
                    loop {
                        let recv_result = tokio::time::timeout_at(deadline, receiver.recv()).await;
                        let turn_event = match recv_result {
                            Ok(Ok(event)) => event,
                            Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
                            Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => {
                                continue;
                            }
                            Err(_) => break,
                        };
                        if turn_event.turn_id != turn_id_for_forwarder {
                            continue;
                        }

                        let event = turn_event.event;
                        let is_terminal = event.is_terminal();

                        if let Some(payload) = engine::events::engine_event_to_app_server_event(
                            &event,
                            &current_thread_id,
                            &item_id_clone,
                        ) {
                            event_sink.emit_app_server_event(payload);
                        }

                        if let engine::events::EngineEvent::SessionStarted {
                            session_id,
                            engine,
                            ..
                        } = &event
                        {
                            if !session_id.is_empty()
                                && session_id != "pending"
                                && matches!(engine, engine::EngineType::OpenCode)
                            {
                                current_thread_id = format!("opencode:{}", session_id);
                            }
                        }

                        if is_terminal {
                            break;
                        }
                    }
                });

                let session_clone = session.clone();
                let turn_id_clone = turn_id.clone();
                tokio::spawn(async move {
                    if let Err(error) = session_clone.send_message(params, &turn_id_clone).await {
                        eprintln!("OpenCode send_message failed: {error}");
                        session_clone.emit_error(&turn_id_clone, error);
                    }
                });

                Ok(json!({
                    "engine": "opencode",
                    "result": {
                        "turn": {
                            "id": turn_id,
                            "status": "started",
                        }
                    },
                    "turn": {
                        "id": turn_id,
                        "status": "started",
                    }
                }))
            }
            engine::EngineType::Gemini => {
                let workspace_path = self.workspace_path_for_engine(&workspace_id).await?;
                let session = self
                    .engine_manager
                    .get_or_create_gemini_session(&workspace_id, &workspace_path)
                    .await;
                let resolved_session_id = if continue_session {
                    if session_id.is_some() {
                        session_id
                    } else {
                        session.get_session_id().await
                    }
                } else {
                    Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
                };
                let sanitized_model = model
                    .as_ref()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .and_then(|value| {
                        if is_likely_foreign_model_for_gemini(value) {
                            None
                        } else {
                            Some(value.to_string())
                        }
                    });
                if model.is_some() && sanitized_model.is_none() {
                    eprintln!(
                        "[engine_send_message] dropped invalid gemini model={:?}, fallback to default",
                        model
                    );
                }

                let params = engine::SendMessageParams {
                    text,
                    model: sanitized_model,
                    effort,
                    access_mode,
                    images,
                    continue_session,
                    session_id: resolved_session_id,
                    agent: None,
                    variant: None,
                    collaboration_mode: None,
                    custom_spec_root: normalized_custom_spec_root.clone(),
                };

                let turn_id = format!("gemini-turn-{}", uuid::Uuid::new_v4());
                let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
                let item_id = format!("gemini-item-{}", uuid::Uuid::new_v4());

                let mut receiver = session.subscribe();
                let event_sink = self.event_sink.clone();
                let mut current_thread_id = thread_id.clone();
                let item_id_clone = item_id.clone();
                let turn_id_for_forwarder = turn_id.clone();
                let mut accumulated_agent_text = String::new();
                tokio::spawn(async move {
                    let deadline = tokio::time::Instant::now()
                        + std::time::Duration::from_secs(EVENT_FORWARDER_TIMEOUT_SECS);
                    let mut render_state = GeminiRenderRoutingState::default();
                    let mut post_completion_grace_deadline: Option<tokio::time::Instant> = None;
                    loop {
                        let active_deadline = post_completion_grace_deadline
                            .map(|grace| if grace < deadline { grace } else { deadline })
                            .unwrap_or(deadline);
                        let recv_result =
                            tokio::time::timeout_at(active_deadline, receiver.recv()).await;
                        let turn_event = match recv_result {
                            Ok(Ok(event)) => event,
                            Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
                            Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => {
                                continue;
                            }
                            Err(_) => break,
                        };
                        if turn_event.turn_id != turn_id_for_forwarder {
                            continue;
                        }

                        let event = turn_event.event;
                        let is_terminal = event.is_terminal();
                        let render_lane = match &event {
                            engine::events::EngineEvent::TextDelta { .. } => GeminiRenderLane::Text,
                            engine::events::EngineEvent::ReasoningDelta { .. } => {
                                GeminiRenderLane::Reasoning
                            }
                            engine::events::EngineEvent::ToolStarted { .. }
                            | engine::events::EngineEvent::ToolCompleted { .. }
                            | engine::events::EngineEvent::ToolInputUpdated { .. }
                            | engine::events::EngineEvent::ToolOutputDelta { .. } => {
                                GeminiRenderLane::Tool
                            }
                            _ => GeminiRenderLane::Other,
                        };
                        let routed_item_id = next_gemini_routed_item_id(
                            &mut render_state,
                            render_lane,
                            &item_id_clone,
                        );

                        if let engine::events::EngineEvent::TextDelta { text, .. } = &event {
                            render_state.saw_text_delta = true;
                            accumulated_agent_text.push_str(text);
                        }

                        if let engine::events::EngineEvent::TurnCompleted { result, .. } = &event {
                            let fallback_text =
                                extract_turn_result_text(result.as_ref()).unwrap_or_default();
                            let completed_text = if accumulated_agent_text.trim().is_empty() {
                                fallback_text
                            } else {
                                accumulated_agent_text.clone()
                            };
                            if !completed_text.trim().is_empty() && !render_state.saw_text_delta {
                                event_sink.emit_app_server_event(AppServerEvent {
                                    workspace_id: event.workspace_id().to_string(),
                                    message: json!({
                                        "method": "item/completed",
                                        "params": {
                                            "threadId": &current_thread_id,
                                            "item": {
                                                "id": &routed_item_id,
                                                "type": "agentMessage",
                                                "text": completed_text,
                                                "status": "completed",
                                            }
                                        }
                                    }),
                                });
                            }
                        }

                        if let Some(payload) = engine::events::engine_event_to_app_server_event(
                            &event,
                            &current_thread_id,
                            &routed_item_id,
                        ) {
                            event_sink.emit_app_server_event(payload);
                        }

                        if let engine::events::EngineEvent::SessionStarted {
                            session_id,
                            engine,
                            ..
                        } = &event
                        {
                            if !session_id.is_empty()
                                && session_id != "pending"
                                && matches!(engine, engine::EngineType::Gemini)
                            {
                                current_thread_id = format!("gemini:{}", session_id);
                            }
                        }

                        if is_terminal {
                            if matches!(event, engine::events::EngineEvent::TurnCompleted { .. }) {
                                post_completion_grace_deadline = Some(
                                    tokio::time::Instant::now()
                                        + std::time::Duration::from_millis(
                                            GEMINI_POST_COMPLETION_REASONING_GRACE_MS,
                                        ),
                                );
                                continue;
                            }
                            break;
                        }
                    }
                });

                let session_clone = session.clone();
                let turn_id_clone = turn_id.clone();
                tokio::spawn(async move {
                    if let Err(error) = session_clone.send_message(params, &turn_id_clone).await {
                        eprintln!("Gemini send_message failed: {error}");
                    }
                });

                Ok(json!({
                    "engine": "gemini",
                    "result": {
                        "turn": {
                            "id": turn_id,
                            "status": "started",
                        }
                    },
                    "turn": {
                        "id": turn_id,
                        "status": "started",
                    }
                }))
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn engine_send_message_sync(
        &self,
        workspace_id: String,
        text: String,
        engine: Option<engine::EngineType>,
        model: Option<String>,
        effort: Option<String>,
        access_mode: Option<String>,
        images: Option<Vec<String>>,
        continue_session: bool,
        session_id: Option<String>,
        agent: Option<String>,
        variant: Option<String>,
        custom_spec_root: Option<String>,
    ) -> Result<Value, String> {
        self.sync_engine_configs().await;
        if text.trim().is_empty() {
            return Err("Prompt text cannot be empty".to_string());
        }
        let active_engine = self.get_active_engine().await;
        let effective_engine = engine.unwrap_or(active_engine);
        let normalized_custom_spec_root = normalize_custom_spec_root(custom_spec_root);

        match effective_engine {
            engine::EngineType::Codex => Err(
                "engine_send_message_sync for codex is not supported in daemon mode".to_string(),
            ),
            engine::EngineType::Claude => {
                let workspace_path = self.workspace_path_for_engine(&workspace_id).await?;
                let session = self
                    .engine_manager
                    .get_claude_session(&workspace_id, &workspace_path)
                    .await;
                let has_images = images
                    .as_ref()
                    .is_some_and(|entries| entries.iter().any(|entry| !entry.trim().is_empty()));
                let continue_session_for_send = continue_session;
                let resolved_session_id = if session_id.is_some() {
                    session_id
                } else if continue_session {
                    session.get_session_id().await
                } else {
                    None
                };
                let sanitized_model = model
                    .as_ref()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .and_then(|value| {
                        if is_valid_claude_model_for_passthrough(value) {
                            Some(value.to_string())
                        } else {
                            None
                        }
                    });
                let response_session_id = resolved_session_id.clone();
                let params = engine::SendMessageParams {
                    text,
                    model: sanitized_model,
                    effort,
                    access_mode,
                    images,
                    continue_session: continue_session_for_send,
                    session_id: resolved_session_id,
                    agent: None,
                    variant: None,
                    collaboration_mode: None,
                    custom_spec_root: normalized_custom_spec_root.clone(),
                };
                let turn_id = format!("claude-sync-{}", uuid::Uuid::new_v4());
                let response = tokio::time::timeout(std::time::Duration::from_secs(900), async {
                    if has_images {
                        session.send_message(params, &turn_id).await
                    } else {
                        session
                            .send_message_with_auto_compact_retry(params, &turn_id)
                            .await
                    }
                })
                .await
                .map_err(|_| "Claude response timed out".to_string())??;
                Ok(json!({
                    "engine": "claude",
                    "sessionId": response_session_id,
                    "text": response,
                }))
            }
            engine::EngineType::OpenCode => {
                let workspace_path = self.workspace_path_for_engine(&workspace_id).await?;
                let session = self
                    .engine_manager
                    .get_or_create_opencode_session(&workspace_id, &workspace_path)
                    .await;
                let resolved_session_id = if continue_session {
                    if session_id.is_some() {
                        session_id
                    } else {
                        session.get_session_id().await
                    }
                } else {
                    Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
                };
                let sanitized_model = model
                    .as_ref()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .and_then(|value| {
                        if is_likely_legacy_claude_model_id(value) {
                            None
                        } else {
                            Some(value.to_string())
                        }
                    });
                let model_for_send =
                    sanitized_model.or_else(|| Some("openai/gpt-5.3-codex".to_string()));
                let params = engine::SendMessageParams {
                    text,
                    model: model_for_send,
                    effort,
                    access_mode,
                    images,
                    continue_session,
                    session_id: resolved_session_id,
                    agent,
                    variant,
                    collaboration_mode: None,
                    custom_spec_root: normalized_custom_spec_root.clone(),
                };
                let turn_id = format!("opencode-sync-{}", uuid::Uuid::new_v4());
                let response = tokio::time::timeout(
                    std::time::Duration::from_secs(900),
                    session.send_message(params, &turn_id),
                )
                .await
                .map_err(|_| "OpenCode response timed out".to_string())??;
                Ok(json!({
                    "engine": "opencode",
                    "text": response,
                }))
            }
            engine::EngineType::Gemini => {
                let workspace_path = self.workspace_path_for_engine(&workspace_id).await?;
                let session = self
                    .engine_manager
                    .get_or_create_gemini_session(&workspace_id, &workspace_path)
                    .await;
                let resolved_session_id = if continue_session {
                    if session_id.is_some() {
                        session_id
                    } else {
                        session.get_session_id().await
                    }
                } else {
                    Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
                };
                let sanitized_model = model
                    .as_ref()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .and_then(|value| {
                        if is_likely_foreign_model_for_gemini(value) {
                            None
                        } else {
                            Some(value.to_string())
                        }
                    });
                let params = engine::SendMessageParams {
                    text,
                    model: sanitized_model,
                    effort,
                    access_mode,
                    images,
                    continue_session,
                    session_id: resolved_session_id,
                    agent: None,
                    variant: None,
                    collaboration_mode: None,
                    custom_spec_root: normalized_custom_spec_root.clone(),
                };
                let turn_id = format!("gemini-sync-{}", uuid::Uuid::new_v4());
                let response = tokio::time::timeout(
                    std::time::Duration::from_secs(900),
                    session.send_message(params, &turn_id),
                )
                .await
                .map_err(|_| "Gemini response timed out".to_string())??;
                Ok(json!({
                    "engine": "gemini",
                    "text": response,
                }))
            }
        }
    }

    pub(super) async fn engine_interrupt(&self, workspace_id: String) -> Result<(), String> {
        self.sync_engine_configs().await;
        let active_engine = self.get_active_engine().await;
        match active_engine {
            engine::EngineType::Claude => {
                if let Some(session) = self
                    .engine_manager
                    .claude_manager
                    .get_session(&workspace_id)
                    .await
                {
                    session.interrupt().await?;
                }
                Ok(())
            }
            engine::EngineType::Codex => Ok(()),
            engine::EngineType::OpenCode => {
                if let Some(session) = self
                    .engine_manager
                    .get_opencode_session(&workspace_id)
                    .await
                {
                    session.interrupt().await?;
                }
                Ok(())
            }
            engine::EngineType::Gemini => {
                if let Some(session) = self.engine_manager.get_gemini_session(&workspace_id).await {
                    session.interrupt().await?;
                }
                Ok(())
            }
        }
    }

    pub(super) async fn engine_interrupt_turn(
        &self,
        workspace_id: String,
        turn_id: String,
        engine: Option<engine::EngineType>,
    ) -> Result<(), String> {
        self.sync_engine_configs().await;
        let active_engine = self.get_active_engine().await;
        let target_engine = engine.unwrap_or(active_engine);
        match target_engine {
            engine::EngineType::Claude => {
                if let Some(session) = self
                    .engine_manager
                    .claude_manager
                    .get_session(&workspace_id)
                    .await
                {
                    session.interrupt_turn(&turn_id).await?;
                }
                Ok(())
            }
            engine::EngineType::Codex => Ok(()),
            engine::EngineType::OpenCode => {
                if let Some(session) = self
                    .engine_manager
                    .get_opencode_session(&workspace_id)
                    .await
                {
                    session.interrupt_turn(&turn_id).await?;
                }
                Ok(())
            }
            engine::EngineType::Gemini => {
                if let Some(session) = self.engine_manager.get_gemini_session(&workspace_id).await {
                    session.interrupt_turn(&turn_id).await?;
                }
                Ok(())
            }
        }
    }

    pub(super) async fn start_web_server(
        &self,
        port: Option<u16>,
        token: Option<String>,
    ) -> Result<Value, String> {
        let fallback_port = {
            let settings = self.app_settings.lock().await;
            settings.web_service_port
        };
        let mut web_service_runtime = self.web_service_runtime.lock().await;
        let status = web_service_runtime
            .start(port.or(Some(fallback_port)), token)
            .await?;
        serde_json::to_value(status).map_err(|err| err.to_string())
    }

    pub(super) async fn stop_web_server(&self) -> Result<Value, String> {
        let mut web_service_runtime = self.web_service_runtime.lock().await;
        let status = web_service_runtime.stop().await;
        serde_json::to_value(status).map_err(|err| err.to_string())
    }

    pub(super) async fn get_web_server_status(&self) -> Result<Value, String> {
        let mut web_service_runtime = self.web_service_runtime.lock().await;
        let status = web_service_runtime.status();
        serde_json::to_value(status).map_err(|err| err.to_string())
    }

    pub(super) async fn list_workspace_files(
        &self,
        workspace_id: String,
    ) -> Result<WorkspaceFilesResponse, String> {
        workspaces_core::list_workspace_files_core(&self.workspaces, &workspace_id, |root| {
            list_workspace_files_inner(root, 12_000)
        })
        .await
    }

    pub(super) async fn list_workspace_directory_children(
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

    pub(super) async fn list_external_absolute_directory_children(
        &self,
        workspace_id: String,
        path: String,
    ) -> Result<WorkspaceFilesResponse, String> {
        let allowed_roots = {
            let workspaces = self.workspaces.lock().await;
            self.allowed_external_skill_roots(&workspaces, &workspace_id)?
        };
        list_external_absolute_directory_children_inner(&path, &allowed_roots, 2_000)
    }

    pub(super) async fn read_workspace_file(
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

    pub(super) async fn list_external_spec_tree(
        &self,
        workspace_id: String,
        spec_root: String,
    ) -> Result<WorkspaceFilesResponse, String> {
        const MAX_EXTERNAL_SPEC_TREE_FILES: usize = 8_000;
        {
            let workspaces = self.workspaces.lock().await;
            if !workspaces.contains_key(&workspace_id) {
                return Err(format!("Workspace not found: {workspace_id}"));
            }
        }
        list_external_spec_tree_inner(&spec_root, MAX_EXTERNAL_SPEC_TREE_FILES)
    }

    pub(super) async fn read_external_spec_file(
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

    pub(super) async fn read_external_absolute_file(
        &self,
        workspace_id: String,
        path: String,
    ) -> Result<WorkspaceFileResponse, String> {
        let allowed_roots = {
            let workspaces = self.workspaces.lock().await;
            self.allowed_external_skill_roots(&workspaces, &workspace_id)?
        };
        read_external_absolute_file_inner(&path, &allowed_roots)
    }

    pub(super) async fn write_external_spec_file(
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

    pub(super) async fn write_external_absolute_file(
        &self,
        workspace_id: String,
        path: String,
        content: String,
    ) -> Result<(), String> {
        let allowed_roots = {
            let workspaces = self.workspaces.lock().await;
            self.allowed_external_skill_roots(&workspaces, &workspace_id)?
        };
        write_external_absolute_file_inner(&path, &allowed_roots, &content)
    }

    pub(super) async fn file_read(
        &self,
        scope: file_policy::FileScope,
        kind: file_policy::FileKind,
        workspace_id: Option<String>,
    ) -> Result<file_io::TextFileResponse, String> {
        files_core::file_read_core(&self.workspaces, scope, kind, workspace_id).await
    }

    pub(super) async fn file_write(
        &self,
        scope: file_policy::FileScope,
        kind: file_policy::FileKind,
        workspace_id: Option<String>,
        content: String,
    ) -> Result<(), String> {
        files_core::file_write_core(&self.workspaces, scope, kind, workspace_id, content).await
    }

    pub(super) async fn start_thread(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::start_thread_core(&self.sessions, workspace_id, None).await
    }

    pub(super) async fn resume_thread(
        &self,
        workspace_id: String,
        thread_id: String,
    ) -> Result<Value, String> {
        codex_core::resume_thread_core(&self.sessions, workspace_id, thread_id).await
    }

    pub(super) async fn fork_thread(
        &self,
        workspace_id: String,
        thread_id: String,
    ) -> Result<Value, String> {
        codex_core::fork_thread_core(&self.sessions, workspace_id, thread_id).await
    }

    pub(super) async fn list_threads(
        &self,
        workspace_id: String,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, String> {
        codex_core::list_threads_core(&self.sessions, workspace_id, cursor, limit).await
    }

    pub(super) async fn opencode_session_list(
        &self,
        workspace_id: String,
    ) -> Result<Vec<OpenCodeSessionEntry>, String> {
        let workspace_path = {
            let workspaces = self.workspaces.lock().await;
            workspaces
                .get(&workspace_id)
                .map(|workspace| PathBuf::from(&workspace.path))
                .ok_or_else(|| "Workspace not found".to_string())?
        };
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::OpenCode)
            .await;
        let mut cmd = build_opencode_command(config.as_ref());
        cmd.current_dir(workspace_path);
        cmd.arg("session");
        cmd.arg("list");
        let output = cmd
            .output()
            .await
            .map_err(|error| format!("Failed to execute opencode session list: {error}"))?;
        if !output.status.success() {
            let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
            return Err(format!("opencode session list failed: {}", stderr.trim()));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(parse_opencode_session_list(&stdout))
    }

    pub(super) async fn list_claude_sessions(
        &self,
        workspace_path: String,
        limit: Option<usize>,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let sessions = engine::claude_history::list_claude_sessions(&path, limit).await?;
        serde_json::to_value(sessions).map_err(|error| error.to_string())
    }

    pub(super) async fn load_claude_session(
        &self,
        workspace_path: String,
        session_id: String,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let result = engine::claude_history::load_claude_session(&path, &session_id).await?;
        serde_json::to_value(result).map_err(|error| error.to_string())
    }

    pub(super) async fn fork_claude_session_from_message(
        &self,
        workspace_path: String,
        session_id: String,
        message_id: String,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let forked_session_id = engine::claude_history::fork_claude_session_from_message(
            &path,
            &session_id,
            &message_id,
        )
        .await?;
        Ok(json!({
            "thread": {
                "id": format!("claude:{}", forked_session_id)
            },
            "sessionId": forked_session_id
        }))
    }

    pub(super) async fn list_gemini_sessions(
        &self,
        workspace_path: String,
        limit: Option<usize>,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Gemini)
            .await;
        let sessions = engine::gemini_history::list_gemini_sessions(
            &path,
            limit,
            config.as_ref().and_then(|item| item.home_dir.as_deref()),
        )
        .await?;
        serde_json::to_value(sessions).map_err(|error| error.to_string())
    }

    pub(super) async fn load_gemini_session(
        &self,
        workspace_path: String,
        session_id: String,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Gemini)
            .await;
        let result = engine::gemini_history::load_gemini_session(
            &path,
            &session_id,
            config.as_ref().and_then(|item| item.home_dir.as_deref()),
        )
        .await?;
        serde_json::to_value(result).map_err(|error| error.to_string())
    }

    pub(super) async fn list_mcp_server_status(
        &self,
        workspace_id: String,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, String> {
        codex_core::list_mcp_server_status_core(&self.sessions, workspace_id, cursor, limit).await
    }

    pub(super) async fn archive_thread(
        &self,
        workspace_id: String,
        thread_id: String,
    ) -> Result<Value, String> {
        codex_core::archive_thread_core(&self.sessions, workspace_id, thread_id).await
    }

    pub(super) async fn delete_codex_session(
        &self,
        workspace_id: String,
        session_id: String,
    ) -> Result<Value, String> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err("session_id is required".to_string());
        }

        let archive_result = codex_core::archive_thread_core(
            &self.sessions,
            workspace_id.clone(),
            normalized_session_id.clone(),
        )
        .await;
        if let Err(error) = &archive_result {
            log::debug!(
                "[daemon delete_codex_session] Best-effort archive skipped for workspace {} session {}: {}",
                workspace_id,
                normalized_session_id,
                error
            );
        }

        let deleted_count = local_usage::delete_codex_session_for_workspace(
            &self.workspaces,
            &workspace_id,
            &normalized_session_id,
        )
        .await?;

        let session = {
            let sessions = self.sessions.lock().await;
            sessions.get(&workspace_id).cloned()
        };
        if let Some(session) = session {
            session
                .clear_thread_effective_mode(&normalized_session_id)
                .await;
        }

        Ok(json!({
            "deleted": deleted_count > 0,
            "deletedCount": deleted_count,
            "method": "filesystem",
            "archivedBeforeDelete": archive_result.is_ok(),
        }))
    }

    pub(super) async fn send_user_message(
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

    pub(super) async fn turn_interrupt(
        &self,
        workspace_id: String,
        thread_id: String,
        turn_id: String,
    ) -> Result<Value, String> {
        codex_core::turn_interrupt_core(&self.sessions, workspace_id, thread_id, turn_id).await
    }

    pub(super) async fn thread_compact(
        &self,
        workspace_id: String,
        thread_id: String,
    ) -> Result<Value, String> {
        codex_core::thread_compact_core(&self.sessions, workspace_id, thread_id).await
    }

    pub(super) async fn start_review(
        &self,
        workspace_id: String,
        thread_id: String,
        target: Value,
        delivery: Option<String>,
    ) -> Result<Value, String> {
        codex_core::start_review_core(&self.sessions, workspace_id, thread_id, target, delivery)
            .await
    }

    pub(super) async fn model_list(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::model_list_core(&self.sessions, workspace_id).await
    }

    pub(super) async fn collaboration_mode_list(
        &self,
        workspace_id: String,
    ) -> Result<Value, String> {
        codex_core::collaboration_mode_list_core(&self.sessions, workspace_id).await
    }

    pub(super) async fn account_rate_limits(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::account_rate_limits_core(&self.sessions, workspace_id).await
    }

    pub(super) async fn account_read(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::account_read_core(&self.sessions, &self.workspaces, workspace_id).await
    }

    pub(super) async fn codex_login(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::codex_login_core(
            &self.workspaces,
            &self.app_settings,
            &self.codex_login_cancels,
            workspace_id,
        )
        .await
    }

    pub(super) async fn codex_login_cancel(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::codex_login_cancel_core(&self.codex_login_cancels, workspace_id).await
    }

    pub(super) async fn skills_list(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::skills_list_core(&self.sessions, workspace_id).await
    }

    pub(super) async fn list_thread_titles(
        &self,
        workspace_id: String,
    ) -> Result<HashMap<String, String>, String> {
        thread_titles_core::list_thread_titles_core(&self.workspaces, workspace_id).await
    }

    pub(super) async fn set_thread_title(
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

    pub(super) async fn rename_thread_title_key(
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

    pub(super) async fn generate_thread_title(
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

    pub(super) async fn respond_to_server_request(
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

    pub(super) async fn remember_approval_rule(
        &self,
        workspace_id: String,
        command: Vec<String>,
    ) -> Result<Value, String> {
        codex_core::remember_approval_rule_core(&self.workspaces, workspace_id, command).await
    }

    pub(super) async fn get_config_model(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::get_config_model_core(&self.workspaces, workspace_id).await
    }
}
