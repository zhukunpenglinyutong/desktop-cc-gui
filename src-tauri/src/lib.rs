use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::utils::config::BackgroundThrottlingPolicy;
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

mod agents;
mod app_paths;
mod backend;
mod claude_commands;
mod client_storage;
mod code_intel;
mod codex;
mod command_registry;
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
mod runtime_log;
mod settings;
mod shared;
mod shared_sessions;
mod skills;
mod startup_guard;
mod state;
mod storage;
mod terminal;
mod text_encoding;
mod types;
mod utils;
mod vendors;
mod web_service;
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

    #[cfg(target_os = "windows")]
    {
        match startup_guard::prepare_launch() {
            Ok(decision) => {
                if decision.enable_webview2_compat_mode {
                    startup_guard::apply_webview2_compat_env();
                    log::warn!(
                        "WebView2 compatibility mode enabled after {} consecutive unready launches",
                        decision.consecutive_unready_launches
                    );
                }
                if decision.enable_webview2_gpu_fallback {
                    startup_guard::apply_webview2_gpu_fallback_env();
                    log::warn!(
                        "WebView2 GPU fallback enabled after {} consecutive unready launches",
                        decision.consecutive_unready_launches
                    );
                }
            }
            Err(error) => {
                log::warn!("Failed to prepare startup guard: {error}");
            }
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
            if let Err(error) = app_paths::app_home_dir() {
                log::warn!("Failed to prepare ccgui home directory: {error}");
            }
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
                    .title("ccgui")
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
                    .background_throttling(BackgroundThrottlingPolicy::Disabled)
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
        .invoke_handler(command_registry::invoke_handler())
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
                crate::terminal::cleanup_all_terminal_sessions(&state).await;
            });
        }
    });
}
