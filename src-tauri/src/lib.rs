pub mod config;
pub mod db;
pub mod engine;
pub mod event_sink;
pub mod files;
pub mod git;
pub mod history;
pub mod paths;
pub mod metrics;
pub mod open_app;
pub mod settings;
pub mod terminal;
pub mod web;

use std::sync::Arc;
use tauri::Manager;

pub struct AppState {
    pub db: Arc<db::Db>,
    pub sink: Arc<event_sink::EventSink>,
    pub terminal_sink: Arc<event_sink::EventSink>,
    /// Webview + any attached web-access broadcasters (web.rs).
    pub emitters: Arc<event_sink::BroadcastEmit>,
    pub terminals: terminal::TerminalRegistry,
    pub processes: Arc<engine::ProcessRegistry>,
    pub config_store: config::ConfigStore,
    pub web: web::WebAccessState,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    paths::ensure_dirs().expect("failed to create app home");
    engine::images::sweep_pasted_images();
    config::import_legacy_config_once();
    // A .app launched from Finder/Launchpad gets the launchd PATH
    // (/usr/bin:/bin:…), so `which::which` can't see CLIs installed via
    // homebrew/npm/nvm and every engine greys out. Adopt the login shell's
    // PATH before any detection/spawn runs.
    adopt_login_shell_path();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db = Arc::new(db::Db::open().expect("failed to open app db"));
            // files.rs commands inject State<'_, Arc<db::Db>> for workspace
            // confinement, so the Arc itself must be managed alongside.
            app.manage(Arc::clone(&db));
            let emitters = event_sink::BroadcastEmit::new(Arc::new(app.handle().clone()));
            let state = AppState {
                db,
                sink: event_sink::EventSink::new(emitters.clone()),
                terminal_sink: event_sink::EventSink::with_name(
                    emitters.clone(),
                    terminal::TERMINAL_OUTPUT_EVENT,
                ),
                emitters,
                terminals: terminal::TerminalRegistry::default(),
                processes: Arc::new(engine::ProcessRegistry::default()),
                config_store: config::ConfigStore::default(),
                web: web::WebAccessState::default(),
            };
            // Clone what the initial scan needs before state moves into manage.
            let scan_db = Arc::clone(&state.db);
            let scan_sink = Arc::clone(&state.sink);
            app.manage(state);
            app.manage(metrics::MetricsState::new());
            // Initial history scan, non-blocking.
            history::scanner::spawn_scan(scan_db, scan_sink);
            // Dev convenience: `CCGUI_WEB_AUTOSTART=1 pnpm dev` starts the LAN
            // bridge at launch and prints the URL, so the web build can be
            // exercised without clicking the settings toggle.
            #[cfg(debug_assertions)]
            if std::env::var_os("CCGUI_WEB_AUTOSTART").is_some() {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    match web::web_access_start(handle).await {
                        Ok(info) => println!("[web] dev autostart: {}", info.url),
                        Err(error) => eprintln!("[web] autostart failed: {error}"),
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<AppState>() {
                    state.processes.kill_all();
                    tauri::async_runtime::block_on(terminal::kill_all(&state.terminals));
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // config
            config::get_cli_config,
            config::upsert_provider,
            config::delete_provider,
            config::set_current_provider,
            config::reorder_providers,
            // settings
            settings::get_app_settings,
            settings::update_app_settings,
            // engine
            engine::send_message,
            engine::interrupt_session,
            engine::list_engines,
            engine::models::list_engine_models,
            engine::images::save_pasted_image,
            engine::images::import_attachments,
            // history
            history::reader::list_sessions,
            history::reader::load_session_page,
            history::reader::delete_session,
            history::reader::pin_session,
            history::reader::rename_session,
            history::reader::rescan_sessions,
            history::reader::list_workspaces,
            history::reader::add_workspace,
            history::reader::reorder_workspaces,
            history::reader::remove_workspace,
            // files
            files::list_dir,
            files::read_file,
            files::write_file,
            files::create_dir,
            files::rename_item,
            files::trash_item,
            files::search_text,
            // git
            git::git_status,
            git::git_diff,
            git::git_stage,
            git::git_unstage,
            git::git_commit,
            git::git_push,
            git::git_pull,
            git::git_branches,
            git::git_checkout,
            git::git_create_branch,
            // open-app
            open_app::open_workspace_in,
            open_app::reveal_in_file_manager,
            // terminal
            terminal::terminal_open,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            // metrics
            metrics::app_metrics,
            // web access
            web::web_access_start,
            web::web_access_stop,
            web::web_access_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
/// Probe the user's login+interactive shell for its PATH and install it into
/// this process. `-l` sources .zprofile (homebrew), `-i` sources .zshrc
/// (nvm/volta/npm-global). No-op on failure: detection simply falls back to
/// the inherited PATH.
///
/// Interactive rc files can block on network fetches or keychain prompts, so
/// the probe is capped at 3s — a hung login shell must never stall startup.
#[cfg(unix)]
fn adopt_login_shell_path() {
    const MARKER: &str = "__OMP_GUI_PATH__";
    const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let script = format!("echo '{MARKER}'\"$PATH\"");
    let Ok(mut child) = std::process::Command::new(&shell)
        .args(["-l", "-i", "-c", &script])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
    else {
        return;
    };
    let Some(mut stdout) = child.stdout.take() else {
        let _ = child.kill();
        return;
    };
    // read_to_string ends at pipe EOF, i.e. exactly when the shell exits
    // (rc files backgrounding nothing sane). A helper thread keeps the read
    // off this startup path so the timeout below stays in charge.
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        use std::io::Read;
        let mut out = String::new();
        let _ = stdout.read_to_string(&mut out);
        let _ = tx.send(out);
    });
    let Ok(stdout) = rx.recv_timeout(TIMEOUT) else {
        let _ = child.kill();
        let _ = child.wait();
        return;
    };
    if !child.wait().map(|s| s.success()).unwrap_or(false) {
        return;
    }
    // Shell rc files may print noise; only the marked line is authoritative.
    for line in stdout.lines().rev() {
        if let Some(path) = line.trim().strip_prefix(MARKER) {
            if !path.is_empty() {
                std::env::set_var("PATH", path);
            }
            return;
        }
    }
}

#[cfg(not(unix))]
fn adopt_login_shell_path() {}
