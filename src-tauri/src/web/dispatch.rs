use serde::Deserialize;
use serde_json::Value;
use tauri::Manager;

use super::{web_access_status, web_device_approve, web_device_revoke, web_devices};

// ==================== Command dispatch ====================

#[derive(Deserialize)]
struct RelayArgs {
    url: String,
    key: String,
}

#[derive(Deserialize)]
struct RelayDeployPackArgs {
    path: String,
    key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelayDeployArgs {
    token: String,
    /// Absent for user tokens, which can list their accounts; required in
    /// practice for account-owned ones (`cfat_…`).
    #[serde(default)]
    account_id: Option<String>,
}

#[derive(Deserialize)]
struct DeviceIdArgs {
    id: String,
}

#[derive(Deserialize)]
struct DiagnosticsEnabledArgs {
    enabled: bool,
}

fn parse_args<T: serde::de::DeserializeOwned>(raw: &Value) -> Result<T, String> {
    serde_json::from_value(raw.clone()).map_err(|e| format!("invalid args: {e}"))
}

fn ser<T: serde::Serialize>(r: Result<T, String>) -> Result<Value, String> {
    r.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineIdArgs {
    engine: String,
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginReadFileArgs {
    id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginReadArtworkArgs {
    id: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginIdArgs {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginStorageGetArgs {
    id: String,
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginAssetIdArgs {
    plugin_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginAssetPathArgs {
    plugin_id: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginAssetRevokeArgs {
    plugin_id: String,
    grant_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertProviderArgs {
    engine: String,
    id: String,
    json: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReorderProvidersArgs {
    engine: String,
    ids: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetEngineEnabledArgs {
    engine: String,
    enabled: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HashArgs {
    hash: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportCcSwitchFromPathArgs {
    path: String,
    engine: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchProviderModelsArgs {
    base_url: String,
    #[serde(default)]
    api_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSettingsArgs {
    settings: crate::settings::AppSettings,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMessageArgs {
    run_id: Option<String>,
    engine: String,
    workspace_path: String,
    session_id: Option<String>,
    prompt: String,
    #[serde(default)]
    prompt_contributions: Vec<crate::engine::PromptContribution>,
    image_paths: Option<Vec<String>>,
    model: Option<String>,
    effort: Option<String>,
    permission: Option<String>,
    provider_id: Option<String>,
    /// Desktop-only feature; default keeps older web clients compatible.
    #[serde(default)]
    computer_use: Option<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionIdArgs {
    session_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnswerQuestionArgs {
    session_id: String,
    request_id: String,
    /// Question text → chosen label(s); `None` is the user's skip/dismiss.
    #[serde(default)]
    answers: Option<Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineArgs {
    engine: String,
    workspace: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfficialConfigWriteArgs {
    engine: String,
    files: Vec<crate::provider_files::OfficialConfigDraft>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavePastedImageArgs {
    data_base64: String,
    extension: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathsArgs {
    paths: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadSessionPageArgs {
    engine: String,
    session_id: String,
    limit: Option<usize>,
    before_seq: Option<i64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadRemoteSessionPageArgs {
    workspace_path: String,
    engine: String,
    session_id: String,
    remote_path: String,
    limit: Option<usize>,
    before_seq: Option<i64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteRemoteSessionArgs {
    workspace_path: String,
    engine: String,
    session_id: String,
    remote_path: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageSummaryArgs {
    days: u32,
    tz_offset_minutes: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageRecordArgs {
    entry: crate::usage::UsageEntry,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineSessionArgs {
    engine: String,
    session_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordAcceptedFrameArgs {
    engine: String,
    session_id: String,
    frame: String,
    workspace_path: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveSessionArgs {
    session: crate::history::SessionMeta,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PinSessionArgs {
    engine: String,
    session_id: String,
    pinned: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameSessionArgs {
    engine: String,
    session_id: String,
    title: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RememberModelArgs {
    engine: String,
    session_id: String,
    model: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RememberEffortArgs {
    engine: String,
    session_id: String,
    effort: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RememberProviderArgs {
    engine: String,
    session_id: String,
    provider_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathArgs {
    path: String,
    /// Optional workspace meta passthrough (plugin workspaces.add keeps
    /// transport descriptions alive on the web runtime too).
    meta: Option<serde_json::Value>,
    /// Optional worktree registration (host UI: 新建/恢复 worktree 子工作区).
    kind: Option<String>,
    parent_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileIndexArgs {
    path: String,
    /// Optional: include gitignored entries (chat file-link fallback).
    #[serde(default)]
    include_ignored: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginAddWorkspaceArgs {
    plugin_id: String,
    path: String,
    meta: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdsArgs {
    ids: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdArgs {
    id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentAddArgs {
    name: String,
    prompt: Option<String>,
    icon: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentUpdateArgs {
    id: String,
    name: Option<String>,
    prompt: Option<String>,
    icon: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocaleArgs {
    locale: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuiltInAgentIdArgs {
    agent_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuiltInAgentEnabledArgs {
    agent_id: String,
    enabled: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuiltInAgentDivisionEnabledArgs {
    division_id: String,
    enabled: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptsCreateArgs {
    path: String,
    scope: String,
    name: String,
    description: Option<String>,
    argument_hint: Option<String>,
    content: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptPathArgs {
    path: String,
    prompt_path: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptUpdateArgs {
    path: String,
    prompt_path: String,
    updates: crate::prompts::PromptUpdates,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptMoveArgs {
    path: String,
    prompt_path: String,
    scope: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetWorkspaceGroupArgs {
    id: String,
    group_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteFileArgs {
    path: String,
    content: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameItemArgs {
    from: String,
    to: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PasteItemArgs {
    source: String,
    target_dir: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchTextArgs {
    path: String,
    query: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchMessagesArgs {
    query: String,
    limit: Option<u32>,
    offset: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitDiffArgs {
    path: String,
    file: String,
    staged: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitFilesArgs {
    path: String,
    files: Vec<String>,
}
#[derive(Deserialize)]
struct GitTreeArgs {
    levels: Vec<crate::git::GitTreeLevel>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCommitArgs {
    path: String,
    message: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCheckoutArgs {
    path: String,
    branch: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCreateBranchArgs {
    path: String,
    name: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenWorkspaceArgs {
    path: String,
    app: Option<String>,
    #[serde(default)]
    args: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenCustomProgramArgs {
    executable_path: String,
    path: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetProgramIconArgs {
    executable_path: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOpenArgs {
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalWriteArgs {
    id: String,
    data: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalResizeArgs {
    id: String,
    cols: u16,
    rows: u16,
}

/// Routes a bridge invoke to the same command functions the Tauri handler
/// uses. Sync commands run inline: the heaviest (git diff, config writes) are
/// milliseconds-scale, and the per-invoke tokio task keeps the read loop
/// unblocked. Commands that genuinely need a thread pool already
/// spawn_blocking internally (git_status, read_file, search_text…).
pub(super) async fn dispatch(
    app: &tauri::AppHandle,
    cmd: &str,
    raw: Value,
) -> Result<Value, String> {
    match cmd {
        // config
        "get_cli_config" => ser(crate::config::get_cli_config()),
        "upsert_provider" => {
            let a: UpsertProviderArgs = parse_args(&raw)?;
            ser(crate::config::upsert_provider(
                app.state(),
                a.engine,
                a.id,
                a.json,
            ))
        }
        "delete_provider" => {
            let a: EngineIdArgs = parse_args(&raw)?;
            ser(crate::config::delete_provider(app.state(), a.engine, a.id))
        }
        "set_current_provider" => {
            let a: EngineIdArgs = parse_args(&raw)?;
            ser(crate::config::set_current_provider(
                app.state(),
                a.engine,
                a.id,
            ))
        }
        "provider_file_paths" => {
            let a: EngineArgs = parse_args(&raw)?;
            ser(Ok::<_, String>(crate::provider_files::provider_file_paths(
                a.engine,
            )))
        }
        "official_config_read" => {
            let a: EngineArgs = parse_args(&raw)?;
            ser(crate::provider_files::official_config_read(a.engine))
        }
        "official_config_write" => {
            let a: OfficialConfigWriteArgs = parse_args(&raw)?;
            ser(crate::provider_files::official_config_write(
                app.state(),
                a.engine,
                a.files,
            ))
        }
        "reorder_providers" => {
            let a: ReorderProvidersArgs = parse_args(&raw)?;
            ser(crate::config::reorder_providers(
                app.state(),
                a.engine,
                a.ids,
            ))
        }
        "set_engine_enabled" => {
            let a: SetEngineEnabledArgs = parse_args(&raw)?;
            ser(crate::config::set_engine_enabled(
                app.state(),
                a.engine,
                a.enabled,
            ))
        }
        // cc-switch interop
        "check_cc_switch" => ser(crate::cc_switch::check_cc_switch().await),
        "dismiss_cc_switch" => {
            let a: HashArgs = parse_args(&raw)?;
            ser(crate::cc_switch::dismiss_cc_switch(a.hash))
        }
        "import_cc_switch" => {
            let a: EngineArgs = parse_args(&raw)?;
            ser(crate::cc_switch::import_cc_switch(app.state(), a.engine))
        }
        "import_cc_switch_from_path" => {
            let a: ImportCcSwitchFromPathArgs = parse_args(&raw)?;
            ser(crate::cc_switch::import_cc_switch_from_path(
                app.state(),
                a.path,
                a.engine,
            ))
        }
        "fetch_provider_models" => {
            let a: FetchProviderModelsArgs = parse_args(&raw)?;
            ser(crate::provider_models::fetch_provider_models(a.base_url, a.api_key).await)
        }
        // settings
        "get_app_settings" => ser(crate::settings::get_app_settings()),
        "update_app_settings" => {
            let a: UpdateSettingsArgs = parse_args(&raw)?;
            ser(crate::settings::update_app_settings(
                app.clone(),
                a.settings,
            ))
        }
        // engine
        "send_message" => {
            let a: SendMessageArgs = parse_args(&raw)?;
            ser(crate::engine::send_message(
                app.state(),
                a.engine,
                a.workspace_path,
                a.session_id,
                a.prompt,
                a.prompt_contributions,
                a.image_paths,
                a.model,
                a.effort,
                a.permission,
                a.provider_id,
                a.run_id,
                a.computer_use,
            )
            .await)
        }
        "interrupt_session" => {
            let a: SessionIdArgs = parse_args(&raw)?;
            ser(crate::engine::interrupt_session(app.state(), a.session_id).await)
        }
        // The remote UI renders the same AskUserQuestion card as the desktop
        // (events already reach it); without this case its 提交/忽略 buttons
        // failed with `unknown command: answer_question`.
        "answer_question" => {
            let a: AnswerQuestionArgs = parse_args(&raw)?;
            ser(
                crate::engine::answer_question(app.state(), a.session_id, a.request_id, a.answers)
                    .await,
            )
        }
        "list_engines" => ser(crate::engine::list_engines().await),
        "list_engine_models" => {
            let a: EngineArgs = parse_args(&raw)?;
            ser(crate::engine::models::list_engine_models(app.state(), a.engine, a.workspace).await)
        }
        "save_pasted_image" => {
            let a: SavePastedImageArgs = parse_args(&raw)?;
            ser(crate::engine::images::save_pasted_image(
                a.data_base64,
                a.extension,
            ))
        }
        "import_attachments" => {
            let a: PathsArgs = parse_args(&raw)?;
            ser(crate::engine::images::import_attachments(a.paths))
        }
        // history
        "list_sessions" => ser(crate::history::reader::list_sessions(app.state())),
        "list_archived_sessions" => {
            ser(crate::history::reader::list_archived_sessions(app.state()))
        }
        "archive_session" => {
            let a: ArchiveSessionArgs = parse_args(&raw)?;
            ser(crate::history::reader::archive_session(
                app.state(),
                a.session,
            ))
        }
        "restore_session" => {
            let a: EngineSessionArgs = parse_args(&raw)?;
            ser(crate::history::reader::restore_session(
                app.state(),
                a.engine,
                a.session_id,
            ))
        }
        // Usage ledger: the mobile/web client renders the same page, so the
        // bridge must route it like every other settings surface.
        "usage_summary" => {
            let a: UsageSummaryArgs = parse_args(&raw)?;
            ser(crate::usage::usage_summary(
                app.state(),
                a.days,
                a.tz_offset_minutes,
            ))
        }
        "usage_record" => {
            let a: UsageRecordArgs = parse_args(&raw)?;
            ser(crate::usage::usage_record(
                app.clone(),
                app.state(),
                a.entry,
            ))
        }
        "usage_clear" => ser(crate::usage::usage_clear(app.state())),
        "load_session_page" => {
            let a: LoadSessionPageArgs = parse_args(&raw)?;
            ser(crate::history::reader::load_session_page(
                app.state(),
                a.engine,
                a.session_id,
                a.limit,
                a.before_seq,
            )
            .await)
        }
        "load_remote_session_page" => {
            let a: LoadRemoteSessionPageArgs = parse_args(&raw)?;
            ser(crate::history::reader::load_remote_session_page(
                app.state(),
                a.workspace_path,
                a.engine,
                a.session_id,
                a.remote_path,
                a.limit,
                a.before_seq,
            )
            .await)
        }
        "delete_session" => {
            let a: EngineSessionArgs = parse_args(&raw)?;
            ser(crate::history::reader::delete_session(app.state(), a.engine, a.session_id).await)
        }
        "delete_remote_session" => {
            let a: DeleteRemoteSessionArgs = parse_args(&raw)?;
            ser(crate::history::reader::delete_remote_session(
                app.state(),
                a.workspace_path,
                a.engine,
                a.session_id,
                a.remote_path,
            )
            .await)
        }
        "pin_session" => {
            let a: PinSessionArgs = parse_args(&raw)?;
            ser(crate::history::reader::pin_session(
                app.state(),
                a.engine,
                a.session_id,
                a.pinned,
            ))
        }
        "rename_session" => {
            let a: RenameSessionArgs = parse_args(&raw)?;
            ser(crate::history::reader::rename_session(
                app.state(),
                a.engine,
                a.session_id,
                a.title,
            ))
        }
        "remember_session_model" => {
            let a: RememberModelArgs = parse_args(&raw)?;
            ser(crate::history::reader::remember_session_model(
                app.state(),
                a.engine,
                a.session_id,
                a.model,
            ))
        }
        "add_workspace" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::history::reader::add_workspace(
                app.state(),
                a.path,
                a.meta,
                a.kind,
                a.parent_id,
            ))
        }
        "plugin_add_workspace" => {
            let a: PluginAddWorkspaceArgs = parse_args(&raw)?;
            ser(
                crate::plugin_caps::plugin_add_workspace(app.state(), a.plugin_id, a.path, a.meta)
                    .await,
            )
        }
        "remember_session_effort" => {
            let a: RememberEffortArgs = parse_args(&raw)?;
            ser(crate::history::reader::remember_session_effort(
                app.state(),
                a.engine,
                a.session_id,
                a.effort,
            ))
        }
        "remember_session_provider" => {
            let a: RememberProviderArgs = parse_args(&raw)?;
            ser(crate::history::reader::remember_session_provider(
                app.state(),
                a.engine,
                a.session_id,
                a.provider_id,
            ))
        }
        "rescan_sessions" => {
            crate::history::reader::rescan_sessions(app.state());
            Ok(Value::Null)
        }
        "record_accepted_internal_frame" => {
            let a: RecordAcceptedFrameArgs = parse_args(&raw)?;
            ser(crate::history::reader::record_accepted_internal_frame(
                app.state(),
                a.engine,
                a.session_id,
                a.frame,
                a.workspace_path,
            )
            .await)
        }
        "list_workspaces" => ser(crate::history::reader::list_workspaces(app.state())),
        "reorder_workspaces" => {
            let a: IdsArgs = parse_args(&raw)?;
            ser(crate::history::reader::reorder_workspaces(
                app.state(),
                a.ids,
            ))
        }
        "remove_workspace" => {
            let a: IdArgs = parse_args(&raw)?;
            ser(crate::history::reader::remove_workspace(app.state(), a.id))
        }
        "set_workspace_group" => {
            let a: SetWorkspaceGroupArgs = parse_args(&raw)?;
            ser(crate::history::reader::set_workspace_group(
                app.state(),
                a.id,
                a.group_id,
            ))
        }
        // files
        "list_dir" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::files::list_dir(app.state(), a.path))
        }
        "read_file" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::files::read_file(app.state(), a.path).await)
        }
        "write_file" => {
            let a: WriteFileArgs = parse_args(&raw)?;
            ser(crate::files::write_file(app.state(), a.path, a.content))
        }
        "create_dir" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::files::create_dir(app.state(), a.path))
        }
        "create_file" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::files::create_file(app.state(), a.path))
        }
        "rename_item" => {
            let a: RenameItemArgs = parse_args(&raw)?;
            ser(crate::files::rename_item(app.state(), a.from, a.to))
        }
        "trash_item" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::files::trash_item(app.state(), a.path))
        }
        "duplicate_item" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::files::duplicate_item(app.state(), a.path))
        }
        "paste_item" => {
            let a: PasteItemArgs = parse_args(&raw)?;
            ser(crate::files::paste_item(
                app.state(),
                a.source,
                a.target_dir,
            ))
        }
        "search_text" => {
            let a: SearchTextArgs = parse_args(&raw)?;
            ser(crate::files::search_text(app.state(), a.path, a.query).await)
        }
        "search_messages" => {
            let a: SearchMessagesArgs = parse_args(&raw)?;
            ser(
                crate::history::search::search_messages(app.state(), a.query, a.limit, a.offset)
                    .await,
            )
        }
        "list_file_index" => {
            let a: FileIndexArgs = parse_args(&raw)?;
            ser(crate::files::list_file_index(app.state(), a.path, a.include_ignored).await)
        }
        "list_slash_commands" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::slash_commands::list_slash_commands(app.state(), a.path).await)
        }
        // agents & prompts (composer `#`/`!` pickers)
        "agent_list" => ser(crate::agents::agent_list().await),
        "agent_add" => {
            let a: AgentAddArgs = parse_args(&raw)?;
            ser(crate::agents::agent_add(a.name, a.prompt, a.icon).await)
        }
        "agent_update" => {
            let a: AgentUpdateArgs = parse_args(&raw)?;
            ser(crate::agents::agent_update(a.id, a.name, a.prompt, a.icon).await)
        }
        "agent_delete" => {
            let a: IdArgs = parse_args(&raw)?;
            ser(crate::agents::agent_delete(a.id).await)
        }
        // built-in agent catalog (agency-agents pack)
        "list_built_in_agents" => {
            let a: LocaleArgs = parse_args(&raw)?;
            ser(crate::agent_catalog::list_built_in_agents(a.locale, app.clone()).await)
        }
        "set_built_in_agent_enabled" => {
            let a: BuiltInAgentEnabledArgs = parse_args(&raw)?;
            ser(crate::agent_catalog::set_built_in_agent_enabled(
                a.agent_id,
                a.enabled,
                app.clone(),
            )
            .await)
        }
        "set_built_in_agent_division_enabled" => {
            let a: BuiltInAgentDivisionEnabledArgs = parse_args(&raw)?;
            ser(crate::agent_catalog::set_built_in_agent_division_enabled(
                a.division_id,
                a.enabled,
                app.clone(),
            )
            .await)
        }
        "get_built_in_agent_prompt" => {
            let a: BuiltInAgentIdArgs = parse_args(&raw)?;
            ser(crate::agent_catalog::get_built_in_agent_prompt(a.agent_id, app.clone()).await)
        }
        "resolve_enabled_built_in_agent" => {
            let a: BuiltInAgentIdArgs = parse_args(&raw)?;
            ser(crate::agent_catalog::resolve_enabled_built_in_agent(a.agent_id, app.clone()).await)
        }
        "prompts_list" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::prompts::prompts_list(app.state(), a.path).await)
        }
        "prompts_dirs" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::prompts::prompts_dirs(app.state(), a.path).await)
        }
        "prompts_create" => {
            let a: PromptsCreateArgs = parse_args(&raw)?;
            ser(crate::prompts::prompts_create(
                app.state(),
                a.path,
                a.scope,
                a.name,
                a.description,
                a.argument_hint,
                a.content,
            )
            .await)
        }
        "prompts_update" => {
            let a: PromptUpdateArgs = parse_args(&raw)?;
            ser(crate::prompts::prompts_update(app.state(), a.path, a.prompt_path, a.updates).await)
        }
        "prompts_delete" => {
            let a: PromptPathArgs = parse_args(&raw)?;
            ser(crate::prompts::prompts_delete(app.state(), a.path, a.prompt_path).await)
        }
        "prompts_move" => {
            let a: PromptMoveArgs = parse_args(&raw)?;
            ser(crate::prompts::prompts_move(app.state(), a.path, a.prompt_path, a.scope).await)
        }
        // NB: grant_scope/grant_root/revoke_granted_root are intentionally
        // absent — remote clients must not widen the filesystem boundary.
        // git
        "git_status" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::git::git_status(a.path).await)
        }
        "git_repository_summaries" => {
            let a: PathsArgs = parse_args(&raw)?;
            ser(Ok(crate::git::git_repository_summaries(a.paths).await))
        }
        "git_file_colors" => {
            let a: GitFilesArgs = parse_args(&raw)?;
            ser(crate::git::git_file_colors(a.path, a.files).await)
        }
        "git_tree_status" => {
            let a: GitTreeArgs = parse_args(&raw)?;
            ser(crate::git::git_tree_status(a.levels).await)
        }
        "git_diff" => {
            let a: GitDiffArgs = parse_args(&raw)?;
            ser(crate::git::git_diff(a.path, a.file, a.staged).await)
        }
        "git_stage" => {
            let a: GitFilesArgs = parse_args(&raw)?;
            ser(crate::git::git_stage(a.path, a.files))
        }
        "git_unstage" => {
            let a: GitFilesArgs = parse_args(&raw)?;
            ser(crate::git::git_unstage(a.path, a.files))
        }
        // Same shared changes panel as the desktop, so the remote client's
        // 「撤销更改」 must route too (it falls through to unknown otherwise).
        "git_discard" => {
            let a: GitFilesArgs = parse_args(&raw)?;
            ser(crate::git::git_discard(a.path, a.files))
        }
        "git_commit" => {
            let a: GitCommitArgs = parse_args(&raw)?;
            ser(crate::git::git_commit(a.path, a.message))
        }
        "git_push" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::git::git_push(a.path).await)
        }
        "git_pull" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::git::git_pull(a.path).await)
        }
        "git_branches" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::git::git_branches(a.path))
        }
        "git_checkout" => {
            let a: GitCheckoutArgs = parse_args(&raw)?;
            ser(crate::git::git_checkout(a.path, a.branch))
        }
        "git_create_branch" => {
            let a: GitCreateBranchArgs = parse_args(&raw)?;
            ser(crate::git::git_create_branch(a.path, a.name))
        }
        // open-app
        "open_workspace_in" => {
            let a: OpenWorkspaceArgs = parse_args(&raw)?;
            ser(crate::open_app::open_workspace_in(a.path, a.app, a.args).await)
        }
        "open_custom_program" => {
            let a: OpenCustomProgramArgs = parse_args(&raw)?;
            ser(crate::open_app::open_custom_program(a.executable_path, a.path).await)
        }
        "get_program_icon" => {
            let a: GetProgramIconArgs = parse_args(&raw)?;
            ser(crate::open_app::get_program_icon(a.executable_path).await)
        }
        "reveal_in_file_manager" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::open_app::reveal_in_file_manager(a.path).await)
        }
        // terminal
        "terminal_open" => {
            let a: TerminalOpenArgs = parse_args(&raw)?;
            ser(crate::terminal::terminal_open(a.id, a.cwd, a.cols, a.rows, app.state()).await)
        }
        "terminal_write" => {
            let a: TerminalWriteArgs = parse_args(&raw)?;
            ser(crate::terminal::terminal_write(a.id, a.data, app.state()).await)
        }
        "terminal_resize" => {
            let a: TerminalResizeArgs = parse_args(&raw)?;
            ser(crate::terminal::terminal_resize(a.id, a.cols, a.rows, app.state()).await)
        }
        "terminal_close" => {
            let a: IdArgs = parse_args(&raw)?;
            ser(crate::terminal::terminal_close(a.id, app.state()).await)
        }
        // metrics
        "app_metrics" => ser(crate::metrics::app_metrics(app.state())),
        "performance_diagnostics" => ser(crate::metrics::performance_diagnostics(app.state())),
        "performance_diagnostics_enabled" => {
            ser(crate::metrics::performance_diagnostics_enabled(app.state()))
        }
        "performance_diagnostics_set_enabled" => {
            let args: DiagnosticsEnabledArgs = parse_args(&raw)?;
            ser(crate::metrics::performance_diagnostics_set_enabled(
                args.enabled,
                app.state(),
                app.state(),
            ))
        }
        // web access: phones may read status; start/stop stay desktop-only.
        "web_access_status" => ser(Ok(web_access_status(app.clone()))),
        // The relay has no bootstrap problem (unlike the bridge, which cannot
        // start itself over itself), so an approved device may manage it too.
        "web_relay_status" => ser(Ok(crate::relay::web_relay_status(app.clone()))),
        "web_relay_start" => {
            let a: RelayArgs = parse_args(&raw)?;
            ser(crate::relay::web_relay_start(app.clone(), a.url, a.key).await)
        }
        "web_relay_stop" => ser(crate::relay::web_relay_stop(app.clone())),
        "relay_deploy_pack" => {
            let a: RelayDeployPackArgs = parse_args(&raw)?;
            ser(crate::relay::relay_deploy_pack(a.path, a.key))
        }
        "relay_deploy" => {
            let a: RelayDeployArgs = parse_args(&raw)?;
            ser(crate::relay::relay_deploy(a.token, a.account_id).await)
        }
        // Device approval is the one management action a phone may take: it
        // is already device-scoped, and the desktop page would otherwise be
        // the only way to approve a browser the user is holding.
        "web_devices" => ser(web_devices(app.clone())),
        "web_device_approve" => {
            let a: DeviceIdArgs = parse_args(&raw)?;
            ser(web_device_approve(app.clone(), a.id))
        }
        "web_device_revoke" => {
            let a: DeviceIdArgs = parse_args(&raw)?;
            ser(web_device_revoke(app.clone(), a.id))
        }
        // plugins (plan §9 risk table ruling): read-only commands ride the
        // bridge so web clients render plugin UI; install/uninstall/enable/
        // storage writes stay desktop-only and fall through to unknown.
        "plugin_list" => ser(crate::plugins::plugin_list(app.state()).await),
        "plugin_read_artwork" => {
            let a: PluginReadArtworkArgs = parse_args(&raw)?;
            ser(crate::plugins::plugin_read_artwork(a.id, a.path))
        }
        "plugin_read_file" => {
            let a: PluginReadFileArgs = parse_args(&raw)?;
            ser(crate::plugins::plugin_read_file(a.id, a.name))
        }
        "plugin_storage_get" => {
            let a: PluginStorageGetArgs = parse_args(&raw)?;
            ser(crate::plugins::plugin_storage_get(app.state(), a.id, a.key))
        }
        // Asset capabilities use the same authenticated bridge and the same
        // backend permission gates as desktop; they grant no general file
        // access, so unlike document-storage writes they are routed here.
        "plugin_asset_grant_directory" => {
            let a: PluginAssetPathArgs = parse_args(&raw)?;
            ser(crate::plugins::assets::plugin_asset_grant_directory(a.plugin_id, a.path).await)
        }
        "plugin_asset_list_directories" => {
            let a: PluginAssetIdArgs = parse_args(&raw)?;
            ser(crate::plugins::assets::plugin_asset_list_directories(a.plugin_id))
        }
        "plugin_asset_revoke_directory" => {
            let a: PluginAssetRevokeArgs = parse_args(&raw)?;
            ser(crate::plugins::assets::plugin_asset_revoke_directory(a.plugin_id, a.grant_id))
        }
        "plugin_reveal_path" => {
            let a: PluginAssetPathArgs = parse_args(&raw)?;
            ser(crate::plugins::assets::plugin_reveal_path(a.plugin_id, a.path).await)
        }
        // Marketplace browsing is read-only too, so the web client renders
        // the market page; plugin_install_from_marketplace stays desktop-only.
        "plugin_fetch_index" => ser(crate::plugins::market::plugin_fetch_index(false).await),
        "plugin_fetch_market_readme" => {
            let a: PluginIdArgs = parse_args(&raw)?;
            ser(crate::plugins::market::plugin_fetch_market_readme(a.id).await)
        }
        "plugin_check_updates" => ser(crate::plugins::market::plugin_check_updates().await),
        _ => Err(format!("unknown command: {cmd}")),
    }
}
