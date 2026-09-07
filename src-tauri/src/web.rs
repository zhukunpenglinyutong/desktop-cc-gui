//! LAN web access: serves the built frontend over HTTP and bridges the full
//! Tauri command/event surface over a token-authenticated WebSocket, so the
//! same UI can run in a phone browser against the desktop backend.
//!
//! Security model: the bridge exposes terminal shells and file read/write, so
//! every start generates a fresh random token; the WS handshake and the /file
//! route reject anything without it. The token rides in the URL (?token=…)
//! because <img> tags cannot set auth headers.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use axum::extract::{Query, State as AxumState, WebSocketUpgrade};
use axum::extract::ws::{Message, WebSocket};
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Manager;
use tokio::sync::{broadcast, mpsc, oneshot, watch};
use uuid::Uuid;

use crate::event_sink::Emit;

/// Managed inside AppState; holds the running server, if any.
#[derive(Default)]
pub struct WebAccessState {
    inner: Mutex<Option<Running>>,
}

struct Running {
    info: WebAccessInfo,
    emit_id: u64,
    shutdown: Option<oneshot::Sender<()>>,
    stop_watch: watch::Sender<bool>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebAccessInfo {
    pub url: String,
    pub port: u16,
    pub token: String,
    pub lan_ip: String,
}

#[tauri::command]
pub async fn web_access_start(app: tauri::AppHandle) -> Result<WebAccessInfo, String> {
    let state = app.state::<crate::AppState>();
    {
        let guard = state.web.inner.lock().map_err(|e| e.to_string())?;
        if let Some(running) = guard.as_ref() {
            return Ok(running.info.clone());
        }
    }

    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    // Lagging receivers drop events rather than back-pressuring the app.
    let (events_tx, _) = broadcast::channel::<String>(512);
    let emit_id = state
        .emitters
        .add(Arc::new(WsEmit { tx: events_tx.clone() }));
    let (stop_watch, _) = watch::channel(false);
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::UNSPECIFIED, 0))
        .await
        .map_err(|e| format!("bind: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local_addr: {e}"))?
        .port();

    let ctx = WebCtx {
        app: app.clone(),
        token: token.clone().into(),
        events: events_tx,
        stop: stop_watch.subscribe(),
    };
    let router = build_router(ctx);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    let lan_ip = lan_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    let info = WebAccessInfo {
        url: format!("http://{lan_ip}:{port}/?token={token}"),
        port,
        token,
        lan_ip,
    };
    let mut guard = state.web.inner.lock().map_err(|e| e.to_string())?;
    *guard = Some(Running {
        info: info.clone(),
        emit_id,
        shutdown: Some(shutdown_tx),
        stop_watch,
    });
    Ok(info)
}

#[tauri::command]
pub fn web_access_stop(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<crate::AppState>();
    let mut guard = state.web.inner.lock().map_err(|e| e.to_string())?;
    if let Some(mut running) = guard.take() {
        // Close live sockets first (watch), then stop accepting (oneshot).
        let _ = running.stop_watch.send(true);
        if let Some(shutdown) = running.shutdown.take() {
            let _ = shutdown.send(());
        }
        state.emitters.remove(running.emit_id);
    }
    Ok(())
}

#[tauri::command]
pub fn web_access_status(app: tauri::AppHandle) -> Option<WebAccessInfo> {
    let state = app.state::<crate::AppState>();
    let guard = state.web.inner.lock().ok()?;
    guard.as_ref().map(|r| r.info.clone())
}

// ==================== Server ====================

#[derive(Clone)]
struct WebCtx {
    app: tauri::AppHandle,
    token: Arc<str>,
    events: broadcast::Sender<String>,
    stop: watch::Receiver<bool>,
}

fn build_router(ctx: WebCtx) -> Router {
    Router::new()
        .route("/ws", get(ws_handler))
        .route("/file", get(file_handler))
        .fallback(get(static_handler))
        .with_state(ctx)
}

/// Pushes the sink event stream into the broadcast channel as WS frames.
struct WsEmit {
    tx: broadcast::Sender<String>,
}

impl Emit for WsEmit {
    fn emit_json(&self, name: &str, raw_json: &str) {
        let Ok(name) = serde_json::to_string(name) else {
            return;
        };
        let _ = self
            .tx
            .send(format!("{{\"type\":\"event\",\"name\":{name},\"payload\":{raw_json}}}"));
    }
}

#[derive(Deserialize)]
struct TokenQuery {
    token: String,
}

async fn ws_handler(
    AxumState(ctx): AxumState<WebCtx>,
    Query(q): Query<TokenQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    if q.token != *ctx.token {
        return StatusCode::FORBIDDEN.into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(ctx, socket))
}

#[derive(Deserialize)]
struct InvokeReq {
    #[serde(rename = "type")]
    kind: String,
    id: Value,
    cmd: String,
    #[serde(default)]
    args: Value,
}

async fn handle_socket(ctx: WebCtx, socket: WebSocket) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let hello = json!({"type": "hello", "version": env!("CARGO_PKG_VERSION")}).to_string();
    if ws_tx.send(Message::Text(hello.into())).await.is_err() {
        return;
    }

    // Outbound: invoke responses (mpsc) + broadcast events, merged.
    let (out_tx, mut out_rx) = mpsc::channel::<String>(256);
    let mut events_rx = ctx.events.subscribe();
    let mut stop_writer = ctx.stop.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                msg = out_rx.recv() => match msg {
                    Some(m) => if ws_tx.send(Message::Text(m.into())).await.is_err() { break },
                    None => break,
                },
                ev = events_rx.recv() => match ev {
                    Ok(m) => if ws_tx.send(Message::Text(m.into())).await.is_err() { break },
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                },
                _ = stop_writer.changed() => break,
            }
        }
    });

    // Inbound: each invoke runs in its own task — long-running commands
    // (send_message) must not stall the read loop or other requests.
    let mut stop_reader = ctx.stop.clone();
    loop {
        tokio::select! {
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let Ok(req) = serde_json::from_str::<InvokeReq>(&text) else { continue };
                        if req.kind != "invoke" { continue; }
                        let app = ctx.app.clone();
                        let out = out_tx.clone();
                        tokio::spawn(async move {
                            let frame = match dispatch(&app, &req.cmd, req.args).await {
                                Ok(payload) => json!({"type": "response", "id": req.id, "ok": true, "payload": payload}),
                                Err(error) => json!({"type": "response", "id": req.id, "ok": false, "error": error}),
                            };
                            let _ = out.send(frame.to_string()).await;
                        });
                    }
                    // Ping/pong handled by tungstenite; ignore the rest.
                    Some(Ok(_)) => {}
                    Some(Err(_)) | None => break,
                }
            }
            _ = stop_reader.changed() => break,
        }
    }
}

// ==================== Static frontend ====================

/// Release builds embed dist/ so the shipped .app is self-contained. Debug
/// builds read dist/ from disk instead: include_dir does not track its inputs,
/// so an embedded copy would silently go stale across `pnpm build` runs.
#[cfg(not(debug_assertions))]
static DIST: include_dir::Dir<'_> = include_dir::include_dir!("$CARGO_MANIFEST_DIR/../dist");

fn load_static(rel: &str) -> Option<(Vec<u8>, &'static str)> {
    if rel.split('/').any(|seg| seg == "..") {
        return None;
    }
    let mime = content_type(rel);
    #[cfg(debug_assertions)]
    {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
        let canon = std::fs::canonicalize(root.join(rel)).ok()?;
        if !canon.starts_with(std::fs::canonicalize(&root).ok()?) {
            return None;
        }
        let bytes = std::fs::read(canon).ok()?;
        Some((bytes, mime))
    }
    #[cfg(not(debug_assertions))]
    {
        let file = DIST.get_file(rel)?;
        Some((file.contents().to_vec(), mime))
    }
}

async fn static_handler(uri: Uri) -> Response {
    let rel = uri.path().trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    // SPA fallback: unknown paths still get the app shell.
    match load_static(rel).or_else(|| load_static("index.html")) {
        Some((bytes, mime)) => ([(header::CONTENT_TYPE, mime)], bytes).into_response(),
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            "frontend not built — run `pnpm build` first",
        )
            .into_response(),
    }
}

fn content_type(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "pdf" => "application/pdf",
        "txt" | "md" => "text/plain; charset=utf-8",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

// ==================== /file (mirrors the Tauri asset protocol scope) ====================

#[derive(Deserialize)]
struct FileQuery {
    path: String,
    token: String,
}

async fn file_handler(AxumState(ctx): AxumState<WebCtx>, Query(q): Query<FileQuery>) -> Response {
    if q.token != *ctx.token {
        return StatusCode::FORBIDDEN.into_response();
    }
    match read_scoped_file(Path::new(&q.path)) {
        Some((bytes, mime)) => ([(header::CONTENT_TYPE, mime)], bytes).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Same scope as tauri.conf.json's assetProtocol: everything under $HOME
/// except the credential/app-data dirs. Canonicalized first so symlinks and
/// `..` cannot escape.
fn read_scoped_file(path: &Path) -> Option<(Vec<u8>, &'static str)> {
    const MAX_BYTES: u64 = 64 * 1024 * 1024;
    let canon = dunce::canonicalize(path).ok()?;
    if !canon.is_file() {
        return None;
    }
    let home = dirs::home_dir()?;
    if !canon.starts_with(&home) {
        return None;
    }
    for denied in [".ssh", ".aws", ".gnupg", ".ccgui-next"] {
        if canon.starts_with(home.join(denied)) {
            return None;
        }
    }
    if std::fs::metadata(&canon).ok()?.len() > MAX_BYTES {
        return None;
    }
    let bytes = std::fs::read(&canon).ok()?;
    let mime = content_type(&canon.to_string_lossy());
    Some((bytes, mime))
}

// ==================== Command dispatch ====================

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
struct UpdateSettingsArgs {
    settings: crate::settings::AppSettings,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMessageArgs {
    engine: String,
    workspace_path: String,
    session_id: Option<String>,
    prompt: String,
    image_paths: Option<Vec<String>>,
    model: Option<String>,
    effort: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionIdArgs {
    session_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineArgs {
    engine: String,
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
struct EngineSessionArgs {
    engine: String,
    session_id: String,
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
struct PathArgs {
    path: String,
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
struct SearchTextArgs {
    path: String,
    query: String,
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
async fn dispatch(app: &tauri::AppHandle, cmd: &str, raw: Value) -> Result<Value, String> {
    match cmd {
        // config
        "get_cli_config" => ser(crate::config::get_cli_config()),
        "upsert_provider" => {
            let a: UpsertProviderArgs = parse_args(&raw)?;
            ser(crate::config::upsert_provider(app.state(), a.engine, a.id, a.json))
        }
        "delete_provider" => {
            let a: EngineIdArgs = parse_args(&raw)?;
            ser(crate::config::delete_provider(app.state(), a.engine, a.id))
        }
        "set_current_provider" => {
            let a: EngineIdArgs = parse_args(&raw)?;
            ser(crate::config::set_current_provider(app.state(), a.engine, a.id))
        }
        "reorder_providers" => {
            let a: ReorderProvidersArgs = parse_args(&raw)?;
            ser(crate::config::reorder_providers(app.state(), a.engine, a.ids))
        }
        // settings
        "get_app_settings" => ser(crate::settings::get_app_settings()),
        "update_app_settings" => {
            let a: UpdateSettingsArgs = parse_args(&raw)?;
            ser(crate::settings::update_app_settings(a.settings))
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
                a.image_paths,
                a.model,
                a.effort,
            ).await)
        }
        "interrupt_session" => {
            let a: SessionIdArgs = parse_args(&raw)?;
            ser(Ok(crate::engine::interrupt_session(app.state(), a.session_id)))
        }
        "list_engines" => ser(Ok(crate::engine::list_engines())),
        "list_engine_models" => {
            let a: EngineArgs = parse_args(&raw)?;
            ser(crate::engine::models::list_engine_models(a.engine).await)
        }
        "save_pasted_image" => {
            let a: SavePastedImageArgs = parse_args(&raw)?;
            ser(crate::engine::images::save_pasted_image(a.data_base64, a.extension))
        }
        "import_attachments" => {
            let a: PathsArgs = parse_args(&raw)?;
            ser(crate::engine::images::import_attachments(a.paths))
        }
        // history
        "list_sessions" => ser(crate::history::reader::list_sessions(app.state())),
        "load_session_page" => {
            let a: LoadSessionPageArgs = parse_args(&raw)?;
            ser(crate::history::reader::load_session_page(
                app.state(),
                a.engine,
                a.session_id,
                a.limit,
                a.before_seq,
            ).await)
        }
        "delete_session" => {
            let a: EngineSessionArgs = parse_args(&raw)?;
            ser(crate::history::reader::delete_session(app.state(), a.engine, a.session_id).await)
        }
        "pin_session" => {
            let a: PinSessionArgs = parse_args(&raw)?;
            ser(crate::history::reader::pin_session(app.state(), a.engine, a.session_id, a.pinned))
        }
        "rename_session" => {
            let a: RenameSessionArgs = parse_args(&raw)?;
            ser(crate::history::reader::rename_session(app.state(), a.engine, a.session_id, a.title))
        }
        "rescan_sessions" => {
            crate::history::reader::rescan_sessions(app.state());
            Ok(Value::Null)
        }
        "list_workspaces" => ser(crate::history::reader::list_workspaces(app.state())),
        "add_workspace" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::history::reader::add_workspace(app.state(), a.path))
        }
        "reorder_workspaces" => {
            let a: IdsArgs = parse_args(&raw)?;
            ser(crate::history::reader::reorder_workspaces(app.state(), a.ids))
        }
        "remove_workspace" => {
            let a: IdArgs = parse_args(&raw)?;
            ser(crate::history::reader::remove_workspace(app.state(), a.id))
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
        "rename_item" => {
            let a: RenameItemArgs = parse_args(&raw)?;
            ser(crate::files::rename_item(app.state(), a.from, a.to))
        }
        "trash_item" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::files::trash_item(app.state(), a.path))
        }
        "search_text" => {
            let a: SearchTextArgs = parse_args(&raw)?;
            ser(crate::files::search_text(app.state(), a.path, a.query).await)
        }
        // git
        "git_status" => {
            let a: PathArgs = parse_args(&raw)?;
            ser(crate::git::git_status(a.path).await)
        }
        "git_diff" => {
            let a: GitDiffArgs = parse_args(&raw)?;
            ser(crate::git::git_diff(a.path, a.file, a.staged))
        }
        "git_stage" => {
            let a: GitFilesArgs = parse_args(&raw)?;
            ser(crate::git::git_stage(a.path, a.files))
        }
        "git_unstage" => {
            let a: GitFilesArgs = parse_args(&raw)?;
            ser(crate::git::git_unstage(a.path, a.files))
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
        // web access: phones may read status; start/stop stay desktop-only.
        "web_access_status" => ser(Ok(web_access_status(app.clone()))),
        _ => Err(format!("unknown command: {cmd}")),
    }
}

// ==================== Misc ====================

/// Best-effort LAN address for the QR/URL. Interface enumeration prefers
/// RFC1918 addresses: a phone on the same Wi-Fi can always reach those, while
/// full-tunnel VPNs (ClashX enhanced mode's 198.18.0.0/15, utun CGNAT) would
/// otherwise win the default-route heuristic below.
fn lan_ip() -> Option<String> {
    let ips = interface_ips();
    let pick = ips
        .iter()
        .find(|ip| ip.is_private())
        .or_else(|| {
            ips.iter()
                .find(|ip| !ip.is_loopback() && !ip.is_link_local() && !is_benchmark_range(ip))
        })
        .copied();
    if let Some(ip) = pick {
        return Some(ip.to_string());
    }
    // Fallback: a UDP "connect" picks the outbound interface without sending
    // a single packet.
    let socket = std::net::UdpSocket::bind((std::net::Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((std::net::Ipv4Addr::new(192, 0, 2, 1), 80)).ok()?;
    let ip = socket.local_addr().ok()?.ip();
    if ip.is_loopback() {
        None
    } else {
        Some(ip.to_string())
    }
}

/// 198.18.0.0/15 — reserved for benchmarks, hijacked by VPN fake interfaces.
fn is_benchmark_range(ip: &std::net::Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 198 && (o[1] & 0xFE) == 18
}

#[cfg(unix)]
fn interface_ips() -> Vec<std::net::Ipv4Addr> {
    use std::net::Ipv4Addr;
    unsafe {
        let mut addrs: *mut libc::ifaddrs = std::ptr::null_mut();
        if libc::getifaddrs(&mut addrs) != 0 {
            return Vec::new();
        }
        let mut out = Vec::new();
        let mut cur = addrs;
        while !cur.is_null() {
            let ifa = &*cur;
            let sa = ifa.ifa_addr;
            if !sa.is_null() && (*sa).sa_family == libc::AF_INET as libc::sa_family_t {
                let sin = sa as *const libc::sockaddr_in;
                out.push(Ipv4Addr::from(u32::from_be((*sin).sin_addr.s_addr)));
            }
            cur = ifa.ifa_next;
        }
        libc::freeifaddrs(addrs);
        out
    }
}

#[cfg(not(unix))]
fn interface_ips() -> Vec<std::net::Ipv4Addr> {
    Vec::new()
}
