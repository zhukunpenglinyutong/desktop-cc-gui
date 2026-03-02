use std::sync::Mutex;
use tauri::webview::WebviewWindowBuilder;
#[cfg(not(target_os = "macos"))]
use tauri::RunEvent;
use tauri::{Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri::{RunEvent, WindowEvent};

/// Stores paths that were passed to the app on launch (via drag-drop or CLI)
/// Frontend can retrieve these paths after it's ready
static PENDING_OPEN_PATHS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Get and clear any pending paths that were passed to the app on launch
#[tauri::command]
fn get_pending_open_paths() -> Vec<String> {
    let mut paths = PENDING_OPEN_PATHS.lock().unwrap();
    std::mem::take(&mut *paths)
}

mod backend;
mod agents;
mod claude_commands;
mod client_storage;
mod code_intel;
mod codex;
mod dictation;
mod engine;
mod event_sink;
mod files;
mod git;
mod git_utils;
mod input_history;
mod local_usage;
mod menu;
mod project_memory;
mod prompts;
mod remote_backend;
mod rules;
mod settings;
mod shared;
mod skills;
mod state;
mod storage;
mod terminal;
mod types;
mod utils;
mod vendors;
mod window;
mod workspaces;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        // Avoid WebKit compositing issues on NVIDIA Linux setups (GBM buffer errors).
        if std::env::var_os("__NV_PRIME_RENDER_OFFLOAD").is_none() {
            std::env::set_var("__NV_PRIME_RENDER_OFFLOAD", "1");
        }
    }

    let builder = tauri::Builder::default()
        .enable_macos_default_menu(false)
        .manage(menu::MenuItemRegistry::<tauri::Wry>::default())
        .menu(menu::build_menu)
        .on_menu_event(menu::handle_menu_event)
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            #[cfg(target_os = "macos")]
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let state = state::AppState::load(&app.handle());
            app.manage(state);
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_notification::init())?;
            }

            // Create the main window programmatically so we can register on_navigation
            // to intercept external URLs (e.g. links inside iframes) and open them
            // in the system browser instead of navigating the webview.
            let mut win_builder =
                WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                    .title("MossX")
                    .inner_size(1300.0, 800.0)
                    .min_inner_size(800.0, 600.0)
                    .devtools(true);

            #[cfg(target_os = "windows")]
            {
                win_builder = win_builder.drag_and_drop(true).decorations(false);
            }

            #[cfg(target_os = "macos")]
            {
                win_builder = win_builder
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true)
                    .transparent(false);
            }

            win_builder = win_builder.on_navigation(|url: &tauri::Url| {
                let scheme = url.scheme();
                let host = url.host_str().unwrap_or("");

                // Allow tauri internal protocol
                if scheme == "tauri" || scheme == "asset" {
                    return true;
                }

                // Allow localhost (dev server + memory iframe)
                // Windows uses http://tauri.localhost/ as the internal webview origin
                if host == "localhost" || host == "127.0.0.1" || host == "tauri.localhost" {
                    return true;
                }

                // External URL → open in system browser, block webview navigation
                if scheme == "http" || scheme == "https" {
                    let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    return false;
                }

                true
            });

            let window = win_builder.build()?;

            // Hide the menu bar on Windows while keeping accelerator shortcuts active.
            #[cfg(target_os = "windows")]
            {
                let _ = window.hide_menu();
            }

            // Suppress unused variable warning on non-Windows
            let _ = &window;

            Ok(())
        });

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    let app = builder
        // .plugin(tauri_plugin_liquid_glass::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            // Settings
            settings::get_app_settings,
            settings::update_app_settings,
            settings::get_codex_config_path,
            // Agents
            agents::agent_list,
            agents::agent_add,
            agents::agent_update,
            agents::agent_delete,
            agents::agent_get_selected,
            agents::agent_set_selected,
            agents::agent_export,
            agents::agent_import_preview,
            agents::agent_import_apply,
            // Files
            files::file_read,
            files::file_write,
            code_intel::code_intel_definition,
            code_intel::code_intel_references,
            // Menu
            menu::menu_set_accelerators,
            menu::menu_update_labels,
            // Engine management
            engine::detect_engines,
            engine::get_active_engine,
            engine::switch_engine,
            engine::get_engine_status,
            engine::get_all_engine_statuses,
            engine::set_engine_config,
            engine::get_engine_config,
            engine::is_engine_available,
            engine::get_available_engines,
            engine::get_engine_models,
            engine::opencode_commands_list,
            engine::opencode_agents_list,
            engine::opencode_session_list,
            engine::opencode_delete_session,
            engine::opencode_stats,
            engine::opencode_export_session,
            engine::opencode_import_session,
            engine::opencode_share_session,
            engine::opencode_mcp_status,
            engine::opencode_provider_catalog,
            engine::opencode_provider_connect,
            engine::opencode_provider_health,
            engine::opencode_mcp_toggle,
            engine::opencode_status_snapshot,
            engine::opencode_lsp_diagnostics,
            engine::opencode_lsp_symbols,
            engine::opencode_lsp_document_symbols,
            engine::opencode_lsp_definition,
            engine::opencode_lsp_references,
            engine::engine_send_message,
            engine::engine_send_message_sync,
            engine::engine_interrupt,
            engine::list_claude_sessions,
            engine::load_claude_session,
            engine::fork_claude_session,
            engine::delete_claude_session,
            // Codex
            codex::get_config_model,
            codex::codex_doctor,
            codex::start_thread,
            codex::send_user_message,
            codex::turn_interrupt,
            codex::start_review,
            codex::respond_to_server_request,
            codex::remember_approval_rule,
            codex::get_commit_message_prompt,
            codex::generate_commit_message,
            codex::list_thread_titles,
            codex::set_thread_title,
            codex::rename_thread_title_key,
            codex::generate_thread_title,
            codex::generate_run_metadata,
            codex::resume_thread,
            codex::fork_thread,
            codex::list_threads,
            codex::list_mcp_server_status,
            codex::archive_thread,
            codex::collaboration_mode_list,
            codex::model_list,
            codex::account_rate_limits,
            codex::account_read,
            codex::codex_login,
            codex::codex_login_cancel,
            codex::skills_list,
            // Workspaces
            workspaces::list_workspaces,
            workspaces::is_workspace_path_dir,
            workspaces::add_workspace,
            workspaces::add_clone,
            workspaces::add_worktree,
            workspaces::worktree_setup_status,
            workspaces::worktree_setup_mark_ran,
            workspaces::remove_workspace,
            workspaces::remove_worktree,
            workspaces::rename_worktree,
            workspaces::rename_worktree_upstream,
            workspaces::apply_worktree_changes,
            workspaces::update_workspace_settings,
            workspaces::update_workspace_codex_bin,
            workspaces::connect_workspace,
            workspaces::list_workspace_files,
            workspaces::list_external_spec_tree,
            workspaces::read_workspace_file,
            workspaces::read_external_spec_file,
            workspaces::write_workspace_file,
            workspaces::write_external_spec_file,
            workspaces::trash_workspace_item,
            workspaces::copy_workspace_item,
            workspaces::run_workspace_command,
            workspaces::run_spec_command,
            workspaces::open_workspace_in,
            workspaces::get_open_app_icon,
            // Git
            git::get_git_status,
            git::list_git_roots,
            git::get_git_diffs,
            git::get_git_file_full_diff,
            git::get_git_log,
            git::get_git_commit_history,
            git::get_git_commit_details,
            git::get_git_push_preview,
            git::resolve_git_commit_ref,
            git::get_git_commit_diff,
            git::get_git_remote,
            git::get_git_pr_workflow_defaults,
            git::create_git_pr_workflow,
            git::stage_git_file,
            git::stage_git_all,
            git::unstage_git_file,
            git::revert_git_file,
            git::revert_git_all,
            git::commit_git,
            git::push_git,
            git::pull_git,
            git::sync_git,
            git::git_pull,
            git::git_push,
            git::git_sync,
            git::git_fetch,
            git::cherry_pick_commit,
            git::revert_commit,
            git::reset_git_commit,
            git::get_github_issues,
            git::get_github_pull_requests,
            git::get_github_pull_request_diff,
            git::get_github_pull_request_comments,
            git::list_git_branches,
            git::checkout_git_branch,
            git::create_git_branch,
            git::create_git_branch_from_branch,
            git::create_git_branch_from_commit,
            git::delete_git_branch,
            git::rename_git_branch,
            git::merge_git_branch,
            git::rebase_git_branch,
            git::get_git_branch_compare_commits,
            git::get_git_branch_diff_between_branches,
            git::get_git_branch_file_diff_between_branches,
            git::get_git_worktree_diff_against_branch,
            git::get_git_worktree_file_diff_against_branch,
            // Prompts
            claude_commands::claude_commands_list,
            prompts::prompts_list,
            prompts::prompts_create,
            prompts::prompts_update,
            prompts::prompts_delete,
            prompts::prompts_move,
            prompts::prompts_workspace_dir,
            prompts::prompts_global_dir,
            // Project memory
            project_memory::project_memory_get_settings,
            project_memory::project_memory_update_settings,
            project_memory::project_memory_list,
            project_memory::project_memory_get,
            project_memory::project_memory_create,
            project_memory::project_memory_update,
            project_memory::project_memory_delete,
            project_memory::project_memory_capture_auto,
            // Terminal
            terminal::terminal_open,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            // Dictation
            dictation::dictation_model_status,
            dictation::dictation_download_model,
            dictation::dictation_cancel_download,
            dictation::dictation_remove_model,
            dictation::dictation_start,
            dictation::dictation_request_permission,
            dictation::dictation_stop,
            dictation::dictation_cancel,
            // Local usage
            local_usage::local_usage_snapshot,
            // Client storage
            client_storage::client_store_read,
            client_storage::client_store_write,
            client_storage::client_panel_lock_password_read,
            client_storage::client_panel_lock_password_write,
            // Input history
            input_history::input_history_read,
            input_history::input_history_record,
            input_history::input_history_delete,
            input_history::input_history_clear,
            // Vendors
            vendors::vendor_get_claude_providers,
            vendors::vendor_add_claude_provider,
            vendors::vendor_update_claude_provider,
            vendors::vendor_delete_claude_provider,
            vendors::vendor_switch_claude_provider,
            vendors::vendor_get_claude_always_thinking_enabled,
            vendors::vendor_set_claude_always_thinking_enabled,
            vendors::vendor_get_codex_providers,
            vendors::vendor_add_codex_provider,
            vendors::vendor_update_codex_provider,
            vendors::vendor_delete_codex_provider,
            vendors::vendor_switch_codex_provider,
            // Open paths
            get_pending_open_paths
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        match &event {
            RunEvent::Reopen { .. } => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            RunEvent::Opened { urls } => {
                // Handle files/folders dropped on the app icon (macOS)
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|url| {
                        if url.scheme() == "file" {
                            url.to_file_path()
                                .ok()
                                .map(|p| p.to_string_lossy().into_owned())
                        } else {
                            None
                        }
                    })
                    .collect();
                if !paths.is_empty() {
                    // Store paths for frontend to retrieve later (in case event is missed)
                    if let Ok(mut pending) = PENDING_OPEN_PATHS.lock() {
                        pending.extend(paths.clone());
                    }
                    // Also try to emit event immediately (for when app is already running)
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("open-paths", paths);
                    }
                }
            }
            _ => {}
        }

        #[cfg(not(target_os = "macos"))]
        if let RunEvent::Ready = event {
            #[cfg(target_os = "windows")]
            if let Some(window) = app_handle.get_webview_window("main") {
                // Re-apply frameless mode after startup to avoid any state-restore override.
                let _ = window.set_decorations(false);
            }

            // Handle command line arguments (Windows/Linux)
            let args: Vec<String> = std::env::args().skip(1).collect();
            let paths: Vec<String> = args
                .into_iter()
                .filter(|arg| !arg.starts_with('-') && std::path::Path::new(arg).exists())
                .collect();
            if !paths.is_empty() {
                // Store paths for frontend to retrieve later
                if let Ok(mut pending) = PENDING_OPEN_PATHS.lock() {
                    pending.extend(paths.clone());
                }
                // Also try to emit event
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("open-paths", paths);
                }
            }
        }

        // Clean up active AI processes on app exit to prevent orphaned CLI processes
        if let RunEvent::ExitRequested { .. } = &event {
            let state = app_handle.state::<state::AppState>();
            let manager = &state.engine_manager;
            tauri::async_runtime::block_on(async {
                manager.claude_manager.interrupt_all().await;
            });
        }
    });
}
