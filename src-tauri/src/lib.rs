pub mod baidu_tongji;
pub mod cc_switch;
pub mod cli_lifecycle;
pub mod config;
pub mod db;
pub mod dsh_host;
pub mod engine;
pub mod event_sink;
pub mod files;
pub mod git;
pub mod history;
pub mod metrics;
pub mod open_app;
pub mod paths;
pub mod plugins;
pub mod plugin_caps;
pub mod proxy;
pub mod provider_files;
pub mod provider_models;
pub mod settings;
pub mod usage;
pub mod slash_commands;
pub mod terminal;
pub mod relay;
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
    pub web: web::WebAccessState,
    pub relay: relay::RelayState,
    pub dsh_host: std::sync::Arc<dsh_host::DshHostState>,
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
    // Apply the persisted network proxy to this process's env before any
    // engine/terminal spawn, so children inherit HTTP(S)_PROXY/ALL_PROXY.
    if let Ok(settings) = settings::read_settings() {
        if let Err(error) = proxy::apply_app_proxy_settings(&settings) {
            eprintln!("[proxy] failed to apply persisted proxy settings: {error}");
        }
        settings::apply_codex_home(&settings);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let db = Arc::new(db::Db::open().expect("failed to open app db"));
            if let Err(error) = db::import_legacy_workspaces_once(&db) {
                // Import failure must never block startup; the sidebar simply
                // starts empty and the user adds workspaces by hand.
                eprintln!("[db] legacy workspace import failed: {error}");
            }

            if let Err(error) = settings::import_legacy_groups_once(&db) {
                // Same non-fatal rule: groups stay unassigned and the user can
                // redo them in Settings → 工作区.
                eprintln!("[settings] legacy group import failed: {error}");
            }
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
                web: web::WebAccessState::default(),
                relay: relay::RelayState::default(),
                dsh_host: std::sync::Arc::new(dsh_host::DshHostState::default()),
            };
            // Clone what the initial scan needs before state moves into manage.
            let scan_db = Arc::clone(&state.db);
            let scan_sink = Arc::clone(&state.sink);
            app.manage(state);
            // Provider commands inject State<'_, ConfigStore> directly (not
            // via AppState), so the store must be managed as its own type —
            // otherwise every provider mutation panics with "state() called
            // before manage()".
            app.manage(config::ConfigStore::default());
            app.manage(metrics::MetricsState::new());
            app.manage(baidu_tongji::BaiduTongjiState::load());
            // Keep the pairing key from lingering: while the switch is on, a
            // fresh code is minted every ten minutes and broadcast.
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let mut interval =
                        tokio::time::interval(std::time::Duration::from_secs(600));
                    loop {
                        interval.tick().await;
                        let _ = crate::settings::rotate_web_auth_key(&handle);
                    }
                });
            }
            // Initial history scan, non-blocking.
            history::scanner::spawn_scan(scan_db, scan_sink);
            // DSH host autostart: adopt-or-spawn in the background when
            // enabled; failures are logged, never fatal to startup.
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let settings = settings::read_settings().unwrap_or_default();
                    if settings.dsh_auto_start == Some(false) {
                        return;
                    }
                    let state = handle.state::<AppState>();
                    if let Err(error) = dsh_host::ensure_host(&state.dsh_host, &settings).await {
                        eprintln!("[dsh] autostart failed: {error}");
                    }
                });
            }
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
                    state.dsh_host.kill_spawned();
                    plugin_caps::kill_all_tracked_children();
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
            provider_files::provider_file_paths,
            provider_files::official_config_read,
            provider_files::official_config_write,
            config::reorder_providers,
            config::set_engine_enabled,
            // cc-switch interop
            cc_switch::check_cc_switch,
            cc_switch::dismiss_cc_switch,
            cc_switch::import_cc_switch,
            cc_switch::import_cc_switch_from_path,
            provider_models::fetch_provider_models,
            // settings
            settings::get_app_settings,
            settings::update_app_settings,
            settings::set_window_theme,
            // plugins
            plugins::plugin_list,
            plugins::plugin_install_from_path,
            plugins::plugin_uninstall,
            plugins::plugin_set_enabled,
            plugins::plugin_quarantine,
            plugins::plugin_read_file,
            plugins::plugin_storage_get,
            plugins::plugin_storage_set,
            plugins::plugin_storage_delete,
            // engine
            engine::send_message,
            engine::interrupt_session,
            engine::list_engines,
            engine::models::list_engine_models,
            engine::pi_family_auth::pi_family_auth_list,
            engine::pi_family_auth::pi_family_auth_set_api_key,
            engine::pi_family_auth::pi_family_auth_delete_credential,
            engine::pi_family_auth::pi_family_models_config_read,
            engine::pi_family_auth::pi_family_models_config_write,
            engine::images::save_pasted_image,
            engine::images::import_attachments,
            // history
            history::reader::list_sessions,
            usage::usage_record,
            usage::usage_summary,
            usage::usage_clear,
            history::reader::load_session_page,
            history::reader::delete_session,
            history::reader::pin_session,
            history::reader::rename_session,
            history::reader::remember_session_model,
            history::reader::rescan_sessions,
            history::reader::list_workspaces,
            history::reader::add_workspace,
            history::reader::reorder_workspaces,
            history::reader::remove_workspace,
            history::reader::set_workspace_group,
            // files
            files::list_dir,
            files::read_file,
            files::write_file,
            files::create_dir,
            files::rename_item,
            files::trash_item,
            files::duplicate_item,
            files::paste_item,
            files::create_file,
            files::search_text,
            files::list_file_index,
            // composer `/` slash-command picker
            slash_commands::list_slash_commands,
            // On-demand directory grants (desktop-only — see grant_root).
            files::grant_scope,
            files::grant_root,
            files::list_granted_roots,
            files::revoke_granted_root,
            // git
            git::git_status,
            git::git_repository_summaries,
            git::git_file_colors,
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
            open_app::open_custom_program,
            open_app::get_program_icon,
            open_app::reveal_in_file_manager,
            // terminal
            terminal::terminal_open,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            // metrics
            metrics::app_metrics,
            // plugin capability egress (network:/exec: manifest grants)
            plugin_caps::plugin_http_request,
            plugin_caps::plugin_exec_run,
            plugin_caps::plugin_exec_spawn,
            plugin_caps::plugin_exec_kill,
            // web access
            web::web_access_start,
            web::web_access_stop,
            web::web_access_status,
            // Device rows: the bridge already dispatched these for phones,
            // but the desktop page invokes them over IPC too — without this
            // registration its list silently stayed empty.
            web::web_devices,
            web::web_device_approve,
            web::web_device_rename,
            web::web_device_revoke,
            // Key rotation stays desktop-only: a phone rotating it would lock
            // every other device out.
            web::rotate_web_pair_key,
            web::remote_control_active,
            relay::web_relay_start,
            relay::web_relay_stop,
            relay::web_relay_status,
            relay::relay_deploy_pack,
            relay::relay_deploy,
            // dsh host + managed-CLI lifecycle
            dsh_host::dsh_host_status,
            dsh_host::dsh_host_start,
            dsh_host::dsh_host_stop,
            cli_lifecycle::cli_version_status,
            cli_lifecycle::cli_update_plan,
            cli_lifecycle::cli_update,
            // baidu tongji (Linux-native transport; rejected elsewhere)
            baidu_tongji::load_baidu_tongji_script,
            baidu_tongji::send_baidu_tongji_beacon,
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
