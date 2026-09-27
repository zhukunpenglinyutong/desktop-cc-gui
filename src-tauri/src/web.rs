//! LAN web access: serves the built frontend over HTTP and bridges the full
//! Tauri command/event surface over a token-authenticated WebSocket, so the
//! same UI can run in a phone browser against the desktop backend.
//!
//! Security model: the bridge exposes terminal shells and file read/write, so
//! every start generates a fresh random token; the WS handshake and the /file
//! route reject anything without it. The token rides in the URL (?token=…)
//! because <img> tags cannot set auth headers.

use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;

use parking_lot::Mutex;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{ConnectInfo, Query, State as AxumState, WebSocketUpgrade};
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Manager;
use tokio::sync::{broadcast, mpsc, oneshot, watch};
use uuid::Uuid;

use crate::event_sink::Emit;

mod dispatch;

use self::dispatch::dispatch;

/// Managed inside AppState; holds the running server, if any.
#[derive(Default)]
pub struct WebAccessState {
    inner: Mutex<Option<Running>>,
    transition: tokio::sync::Mutex<()>,
}

impl WebAccessState {
    /// Where the relay should dial (127.0.0.1:<port>) and the token its
    /// public URL carries, when the bridge is running.
    pub fn bridge_target(&self) -> Option<(u16, String)> {
        self.inner
            .lock()
            .as_ref()
            .map(|running| (running.info.port, running.info.token.clone()))
    }

    fn take_if_token(&self, token: &str) -> Option<Running> {
        let mut guard = self.inner.lock();
        if guard
            .as_ref()
            .is_some_and(|running| running.info.token == token)
        {
            guard.take()
        } else {
            None
        }
    }

    pub(crate) async fn lock_transition(&self) -> WebAccessTransition<'_> {
        WebAccessTransition {
            _guard: self.transition.lock().await,
        }
    }
}

pub(crate) struct WebAccessTransition<'a> {
    _guard: tokio::sync::MutexGuard<'a, ()>,
}

impl WebAccessTransition<'_> {
    pub(crate) async fn ensure(
        &self,
        app: tauri::AppHandle,
    ) -> Result<(WebAccessInfo, bool), String> {
        ensure_web_access_locked(app).await
    }

    pub(crate) fn stop_if_token(&self, app: &tauri::AppHandle, token: &str) {
        let state = app.state::<crate::AppState>();
        if let Some(running) = state.web.take_if_token(token) {
            stop_running(&state, running);
        }
    }
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

/// A browser that reached the bridge. Rows are created by the request itself;
/// `approved_at` is what lets it through, and only the desktop can set it.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebDevice {
    pub id: String,
    pub user_agent: String,
    pub created_at: i64,
    pub last_seen_at: i64,
    pub approved_at: Option<i64>,
    /// Name the user gave this device; empty falls back to the user agent.
    pub name: Option<String>,
}

/// A relayed socket is the only thing that means "someone is driving this
/// machine from outside": LAN browsers and the desktop's own UI are local, and
/// the relay being connected on its own says nothing — the tunnel idles open.
static REMOTE_SESSIONS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Tells the UI to show the 远程控制中 badge the moment the first remote
/// socket arrives, and to drop it when the last one leaves.
fn notify_remote(app: &tauri::AppHandle, active: bool) {
    use crate::event_sink::Emit;
    let payload = serde_json::json!({ "active": active }).to_string();
    let _ = app
        .state::<crate::AppState>()
        .emitters
        .emit_json("web://remote", &payload);
}

/// Counts one remote socket: increments on the way in, decrements (and fires
/// the event on the 0→1 / 1→0 edges) on the way out, whatever path it takes.
struct RemoteSession {
    app: tauri::AppHandle,
    counted: bool,
}

impl RemoteSession {
    fn enter(app: &tauri::AppHandle, relayed: bool) -> Self {
        let counted = relayed;
        if counted {
            let now = REMOTE_SESSIONS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if now == 0 {
                notify_remote(app, true);
            }
        }
        Self {
            app: app.clone(),
            counted,
        }
    }
}

impl Drop for RemoteSession {
    fn drop(&mut self) {
        if !self.counted {
            return;
        }
        if REMOTE_SESSIONS.fetch_sub(1, std::sync::atomic::Ordering::SeqCst) == 1 {
            notify_remote(&self.app, false);
        }
    }
}

/// Is anyone driving this machine from outside right now?
#[tauri::command]
pub fn remote_control_active() -> bool {
    REMOTE_SESSIONS.load(std::sync::atomic::Ordering::SeqCst) > 0
}

/// Tell every attached UI (webview and phones) that the device list moved.
/// Plain `app.emit` would only reach the webview: the bridge forwards what
/// goes through the sink.
pub fn notify_devices(app: &tauri::AppHandle) {
    app.state::<crate::AppState>()
        .emitters
        .emit_json("web://devices", "null");
}

#[tauri::command]
pub fn web_devices(app: tauri::AppHandle) -> Result<Vec<WebDevice>, String> {
    app.state::<crate::AppState>().db.web_devices()
}

/// Mint a fresh pairing key on demand — the same path the automatic rotation
/// takes (one-time use, then a timer). Desktop-only: a phone that could rotate
/// the key would lock every other device out.
#[tauri::command]
pub fn rotate_web_pair_key(app: tauri::AppHandle) -> Result<String, String> {
    crate::settings::rotate_web_auth_key(&app)?;
    Ok(crate::settings::get_app_settings()?
        .web_auth_key
        .unwrap_or_default())
}

/// Give a paired device a name the user will recognise in the list.
#[tauri::command]
pub fn web_device_rename(app: tauri::AppHandle, id: String, name: String) -> Result<bool, String> {
    let state = app.state::<crate::AppState>();
    let ok = state.db.web_device_set_name(&id, &name)?;
    notify_devices(&app);
    Ok(ok)
}

#[tauri::command]
pub fn web_device_revoke(app: tauri::AppHandle, id: String) -> Result<bool, String> {
    let state = app.state::<crate::AppState>();
    let ok = state.db.web_device_revoke(&id)?;
    notify_devices(&app);
    Ok(ok)
}

/// Let a paired device in. The pairing request created the row; this is the
/// only thing that flips it to approved, so a key without a human on the
/// desktop never grants access.
#[tauri::command]
pub fn web_device_approve(app: tauri::AppHandle, id: String) -> Result<bool, String> {
    let state = app.state::<crate::AppState>();
    let ok = state.db.web_device_approve(&id, now_ms())?;
    notify_devices(&app);
    Ok(ok)
}

#[tauri::command]
pub async fn web_access_start(app: tauri::AppHandle) -> Result<WebAccessInfo, String> {
    let state = app.state::<crate::AppState>();
    let transition = state.web.lock_transition().await;
    transition
        .ensure(app.clone())
        .await
        .map(|(info, _created)| info)
}

/// Ensure the bridge exists and report whether this invocation published it.
/// The ownership bit lets callers roll back only their own newly-created
/// bridge when a later operation fails.
async fn ensure_web_access_locked(app: tauri::AppHandle) -> Result<(WebAccessInfo, bool), String> {
    let state = app.state::<crate::AppState>();
    if let Some(running) = state.web.inner.lock().as_ref() {
        return Ok((running.info.clone(), false));
    }

    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    // Lagging receivers drop events rather than back-pressuring the app.
    let (events_tx, _) = broadcast::channel::<String>(512);
    let emit_id = state.emitters.add(Arc::new(WsEmit {
        tx: events_tx.clone(),
    }));
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
        // Connect info is what tells a genuine relay hop (loopback) from a LAN
        // browser that merely wrote the header — see `relayed`.
        let _ = axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
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
    let mut candidate = Some(Running {
        info: info.clone(),
        emit_id,
        shutdown: Some(shutdown_tx),
        stop_watch,
    });
    let existing = {
        let mut guard = state.web.inner.lock();
        if let Some(running) = guard.as_ref() {
            Some(running.info.clone())
        } else {
            *guard = candidate.take();
            None
        }
    };
    if let Some(existing) = existing {
        stop_running(&state, candidate.expect("unpublished bridge candidate"));
        Ok((existing, false))
    } else {
        Ok((info, true))
    }
}

fn stop_running(state: &crate::AppState, mut running: Running) {
    // Close live sockets first (watch), then stop accepting (oneshot).
    let _ = running.stop_watch.send(true);
    if let Some(shutdown) = running.shutdown.take() {
        let _ = shutdown.send(());
    }
    state.emitters.remove(running.emit_id);
}

#[tauri::command]
pub async fn web_access_stop(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<crate::AppState>();
    let _transition = state.web.lock_transition().await;
    if let Some(running) = state.web.inner.lock().take() {
        stop_running(&state, running);
    }
    Ok(())
}

#[tauri::command]
pub fn web_access_status(app: tauri::AppHandle) -> Option<WebAccessInfo> {
    let state = app.state::<crate::AppState>();
    let guard = state.web.inner.lock();
    guard.as_ref().map(|running| running.info.clone())
}

// ==================== Device gate ====================

/// Cookie carrying the device id. `HttpOnly`: it is the whole credential for an
/// approved device, and no script on any surface reads it. Lax rather than
/// `Secure`: the phone arrives by tapping a link, and the bridge is plain http
/// on the LAN, so `Secure` would never be sent at all.
const DEVICE_COOKIE: &str = "ccgui_device";
/// A device that keeps polling must not write to sqlite on every asset hit.
const TOUCH_INTERVAL_MS: i64 = 60_000;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn cookie_value(headers: &axum::http::HeaderMap) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';').find_map(|part| {
        let (name, value) = part.trim().split_once('=')?;
        (name == DEVICE_COOKIE && !value.is_empty()).then(|| value.to_string())
    })
}

fn user_agent(headers: &axum::http::HeaderMap) -> String {
    headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .chars()
        .take(200)
        .collect()
}

/// Did this request actually come through the relay? The desktop's relay
/// client is the only thing that dials the bridge on loopback and tags the hop
/// — so both have to hold. Trusting the header alone let any LAN browser claim
/// to be tunneled and skip the token, and the LAN is supposed to stay on
/// upstream's token-only model.
fn relayed(headers: &axum::http::HeaderMap, peer: SocketAddr) -> bool {
    peer.ip().is_loopback()
        && headers
            .get(crate::relay::VIA_HEADER)
            .is_some_and(|value| value == "relay")
}

/// Is the `?token=` still needed? On the LAN it always is (upstream's model) —
/// the token is what keeps a stranger on the same Wi-Fi out. Through the relay
/// the device approval is the credential and the phone URL deliberately carries
/// no token, so the token has no part to play there at all.
fn token_required(headers: &axum::http::HeaderMap, peer: SocketAddr) -> bool {
    !relayed(headers, peer)
}

/// Does this request have to pair first? The relay path answers to the device
/// list, not to the switch: an approved device walks straight in, and one that
/// is not approved gets the pairing page. The switch only decides whether that
/// page can lead anywhere — with it off there is nothing to pair with, and
/// `unlock_handler` says so.
fn needs_unlock(relayed: bool, device: Option<&WebDevice>) -> bool {
    relayed && !device.is_some_and(|d| d.approved_at.is_some())
}

/// What the request may do.
enum Gate {
    /// Device approved: serve normally, carrying its id for the WS tick.
    Allowed(String),
    /// Unknown or unapproved: this page instead of the app.
    Waiting(Response),
}

/// Every entry point asks this before doing work. On the LAN the token URL is
/// the whole story (upstream's model). Through the relay the device list is:
/// an approved device is served, an unknown one gets the pairing page.
fn gate(ctx: &WebCtx, headers: &axum::http::HeaderMap, peer: SocketAddr) -> Gate {
    let db = ctx.app.state::<crate::AppState>().db.clone();
    let relayed = relayed(headers, peer);
    let now = now_ms();
    let device = cookie_value(headers).and_then(|id| db.web_device_get(&id).ok().flatten());

    if !needs_unlock(relayed, device.as_ref()) {
        if let Some(device) = device.as_ref() {
            if now - device.last_seen_at >= TOUCH_INTERVAL_MS {
                let _ = db.web_device_touch(&device.id, "", now);
            }
        }
        return Gate::Allowed(device.map(|d| d.id).unwrap_or_default());
    }

    // A cookie that no longer resolves (revoked, or a fresh browser): mint a
    // new one so the unlock can name the device it approves.
    let (id, first_seen, stale) = match &device {
        Some(device) => (
            device.id.clone(),
            false,
            now - device.last_seen_at >= TOUCH_INTERVAL_MS,
        ),
        None => (Uuid::new_v4().simple().to_string(), true, false),
    };
    if stale {
        let _ = db.web_device_touch(&id, "", now);
    }
    // A row only exists once this browser submitted a correct key, so its
    // presence means "paired, waiting for the desktop to approve" — showing
    // the key form again would read as the pairing having failed.
    let html = match device {
        Some(_) => waiting_page(),
        None => unlock_page(None),
    };
    Gate::Waiting(unlock_response(html, &id, first_seen))
}

/// Key page: entered once per browser, then that browser is remembered.
fn unlock_page(error: Option<&str>) -> String {
    let message = match error {
        Some(text) => format!("<p class=\"err\">{text}</p>"),
        None => String::new(),
    };
    format!(
        r#"<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CC GUI 需要配对密钥</title>
<style>
:root{{color-scheme:dark}}
*{{box-sizing:border-box}}
body{{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
background:#141414;color:#ebebeb;font:15px/1.6 -apple-system,system-ui,"Segoe UI",sans-serif}}
.card{{width:320px;padding:26px 24px;border:1px solid #2c2c2c;border-radius:16px;background:#1b1b1b}}
h1{{margin:0 0 14px;font-size:17px;font-weight:600}}
code{{display:inline-block;margin:6px 0 2px;padding:4px 10px;border-radius:8px;
background:#242424;color:#a7e05f;font:600 16px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em}}
p{{margin:10px 0 0;color:#a3a3a3;font-size:13.5px}}
.err{{color:#ff7b72}}
input{{width:100%;margin:14px 0 10px;padding:10px 12px;border-radius:10px;border:1px solid #333;
background:#101010;color:#ebebeb;font:600 18px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;
letter-spacing:.16em;text-transform:uppercase;outline:none}}
input:focus{{border-color:#4b5563}}
button{{width:100%;padding:10px;border:0;border-radius:10px;background:#3b82f6;color:#fff;font-weight:600;font-size:15px}}
</style></head>
<body><div class="card">
<h1>输入配对密钥</h1>
<form method="post" action="/unlock">
<input name="key" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="8 位密钥" autofocus>
<button type="submit">配对</button>
</form>
{message}
<p>密钥在电脑上的「设置 → 远程访问」里显示：每串密钥只能配对一台设备，配对成功后自动更换。配对后还需在电脑上点一次「授权」，本设备才能进入。</p>
</div>
</body></html>"#
    )
}

/// Page shown after a correct pairing key, until the desktop approves the
/// device. It reloads itself, so the approval lands without the user doing
/// anything on the phone — and it must reload `/`, not the current URL: this
/// document is the answer to `POST /unlock`, so a bare refresh would ask for
/// that path again and drop the phone into the SPA's fallback.
fn waiting_page() -> String {
    r#"<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="2; url=/">
<title>CC GUI 等待授权</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
background:#141414;color:#ebebeb;font:15px/1.6 -apple-system,system-ui,"Segoe UI",sans-serif}
.card{width:320px;padding:26px 24px;border:1px solid #2c2c2c;border-radius:16px;background:#1b1b1b}
h1{margin:0 0 10px;font-size:17px;font-weight:600}
p{margin:10px 0 0;color:#a3a3a3;font-size:13.5px}
.dot{display:inline-block;width:8px;height:8px;margin-right:8px;border-radius:50%;
background:#a7e05f;animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.35}50%{opacity:1}}
</style></head>
<body><div class="card">
<h1><span class="dot"></span>等待电脑端授权</h1>
<p>密钥已提交。请在电脑的「设置 → 远程访问 → 授权访问」里找到这台设备，点「授权」。</p>
<p>授权后本页会自动进入，无需操作。</p>
</div>
</body></html>"#
        .to_string()
}

/// Page + cookie for a device that still has to unlock.
fn unlock_response(html: String, device: &str, set_cookie: bool) -> Response {
    let cookie =
        format!("{DEVICE_COOKIE}={device}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly");
    let mut builder = Response::builder()
        .status(StatusCode::FORBIDDEN)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8");
    if set_cookie && !device.is_empty() {
        builder = builder.header(header::SET_COOKIE, cookie);
    }
    builder
        .body(axum::body::Body::from(html))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// `POST /unlock`: spend the pairing key on this device and file a request the
/// desktop still has to approve.
async fn unlock_handler(
    AxumState(ctx): AxumState<WebCtx>,
    headers: axum::http::HeaderMap,
    body: String,
) -> Response {
    let db = ctx.app.state::<crate::AppState>().db.clone();
    let device = match cookie_value(&headers) {
        Some(id) => id,
        None => {
            return unlock_response(
                unlock_page(Some("浏览器没有拿到设备标识，请重新打开链接")),
                "",
                true,
            )
        }
    };
    let submitted = form_field(&body, "key").unwrap_or_default().to_uppercase();
    // Compare and rotate in one locked step, straight off disk: a cached read
    // is a second old at worst, and a second is long enough for two devices to
    // spend the same code. The switch being off (nothing to pair with) and a
    // wrong key are the same answer here — a caller that could tell them apart
    // would learn whether pairing is even possible.
    match crate::settings::consume_web_auth_key(&ctx.app, &submitted) {
        Ok(true) => {}
        Ok(false) => return unlock_response(unlock_page(Some("密钥不正确")), &device, false),
        Err(_) => {
            return unlock_response(
                unlock_page(Some("无法读取本机设置，请重试")),
                &device,
                false,
            )
        }
    }

    // The device is remembered but NOT approved — only the desktop's 授权 does
    // that, which is the whole point of the switch: holding the key alone never
    // lets a browser in.
    let _ = db.web_device_touch(&device, &user_agent(&headers), now_ms());
    notify_devices(&ctx.app);
    unlock_response(waiting_page(), &device, false)
}

/// `application/x-www-form-urlencoded` field lookup.
fn form_field(body: &str, name: &str) -> Option<String> {
    body.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == name).then(|| url_decode(value))
    })
}

fn url_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = String::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                if let Ok(byte) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                    out.push(byte as char);
                    i += 3;
                } else {
                    out.push('%');
                    i += 1;
                }
            }
            other => {
                out.push(other as char);
                i += 1;
            }
        }
    }
    out
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
        .route("/unlock", post(unlock_handler).get(unlock_get))
        .route("/ws", get(ws_handler))
        .route("/file", get(file_handler))
        .route("/plugin-asset/{*asset_path}", get(plugin_asset_handler).options(plugin_asset_handler))
        .fallback(get(static_handler))
        .with_state(ctx)
}

/// `GET /unlock` is what a phone asks for when it reloads the page the POST
/// landed on, or opens it again from history. Send it to the root: the gate
/// then decides between the pairing form, the waiting page and the app.
async fn unlock_get() -> Response {
    (StatusCode::SEE_OTHER, [(header::LOCATION, "/")], "").into_response()
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
        let _ = self.tx.send(format!(
            "{{\"type\":\"event\",\"name\":{name},\"payload\":{raw_json}}}"
        ));
    }
}

#[derive(Deserialize)]
struct TokenQuery {
    /// Optional on purpose: through the relay the URL carries no token at all
    /// (an approved device is the credential), and a required field makes the
    /// extractor answer 400 before the handler gets to decide. That 400 was
    /// what killed every relayed socket — the phone's `/ws` never came up, so
    /// the web UI rendered with no data in it.
    #[serde(default)]
    token: Option<String>,
}

async fn ws_handler(
    AxumState(ctx): AxumState<WebCtx>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(q): Query<TokenQuery>,
    headers: axum::http::HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    match gate(&ctx, &headers, peer) {
        Gate::Waiting(page) => return page,
        Gate::Allowed(device) => {
            let supplied = q.token.as_deref().unwrap_or_default();
            if token_required(&headers, peer) && supplied != &*ctx.token {
                return StatusCode::FORBIDDEN.into_response();
            }
            ws.on_upgrade(move |socket| handle_socket(ctx, socket, device, relayed(&headers, peer)))
        }
    }
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

async fn handle_socket(ctx: WebCtx, socket: WebSocket, device: String, remote: bool) {
    // Counted for as long as this socket lives, however it ends.
    let _remote_session = RemoteSession::enter(&ctx.app, remote);
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
    // Re-checked slowly: revoking a device must drop the sockets it already
    // holds, not just its next request.
    let mut approval = tokio::time::interval(std::time::Duration::from_secs(5));
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
            _ = approval.tick() => {
                // Approval outlives the switch — an approved device keeps its
                // socket with the switch off — so revocation is checked on the
                // same terms. An anonymous browser has no row to revoke.
                if device.is_empty() {
                    continue;
                }
                let approved = ctx
                    .app
                    .state::<crate::AppState>()
                    .db
                    .web_device_get(&device)
                    .ok()
                    .flatten()
                    .is_some_and(|d| d.approved_at.is_some());
                if !approved {
                    // Returning drops both halves: the writer task's channel
                    // closes with out_tx, so the socket goes with us.
                    break;
                }
            }
        }
    }
}

// ==================== Static frontend ====================

/// Static files resolve through Tauri's own embedded frontendDist (the same
/// bytes the webview loads), so dist/ is not duplicated in the binary by a
/// second embed. Dev builds fall back to reading dist/ from disk inside
/// Tauri, keeping the embedded copy from going stale across `pnpm build` runs.
fn load_static(app: &tauri::AppHandle, rel: &str) -> Option<(Vec<u8>, String)> {
    if rel.split('/').any(|seg| seg == "..") {
        return None;
    }
    let asset = app.asset_resolver().get(rel.to_string())?;
    Some((asset.bytes, asset.mime_type))
}

async fn static_handler(
    AxumState(ctx): AxumState<WebCtx>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    uri: Uri,
) -> Response {
    if let Gate::Waiting(page) = gate(&ctx, &headers, peer) {
        return page;
    }
    let rel = uri.path().trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    // SPA fallback: unknown paths still get the app shell.
    match load_static(&ctx.app, rel).or_else(|| load_static(&ctx.app, "index.html")) {
        Some((bytes, mime)) => ([(header::CONTENT_TYPE, mime)], bytes).into_response(),
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            "frontend not built — run `pnpm build` first",
        )
            .into_response(),
    }
}

pub(crate) fn content_type(path: &str) -> &'static str {
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
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

// ==================== /file (mirrors the Tauri asset protocol scope) ====================

#[derive(Deserialize)]
struct FileQuery {
    path: String,
    /// Optional for the same reason as `TokenQuery`: relayed requests carry no
    /// token, and a missing field here would 400 an image the phone is loading
    /// before the gate below could allow it.
    #[serde(default)]
    token: Option<String>,
}

async fn file_handler(
    AxumState(ctx): AxumState<WebCtx>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Query(q): Query<FileQuery>,
) -> Response {
    if let Gate::Waiting(page) = gate(&ctx, &headers, peer) {
        return page;
    }
    let supplied = q.token.as_deref().unwrap_or_default();
    if token_required(&headers, peer) && supplied != &*ctx.token {
        return StatusCode::FORBIDDEN.into_response();
    }
    match read_scoped_file(Path::new(&q.path)) {
        Some((bytes, mime)) => ([(header::CONTENT_TYPE, mime)], bytes).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn plugin_asset_handler(
    AxumState(ctx): AxumState<WebCtx>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    method: axum::http::Method,
    uri: Uri,
) -> Response {
    if let Gate::Waiting(page) = gate(&ctx, &headers, peer) {
        return page;
    }
    // Do not use Path: axum decodes that extractor, and a second decode in
    // the shared protocol would turn literal percent sequences into traversal.
    let Some((credential, asset_path)) = uri.path().strip_prefix("/plugin-asset/").and_then(|path| path.split_once('/')) else {
        return crate::plugins::asset_protocol::rejection(StatusCode::BAD_REQUEST).map(axum::body::Body::from);
    };
    if token_required(&headers, peer) && credential != &*ctx.token {
        return crate::plugins::asset_protocol::rejection(StatusCode::FORBIDDEN).map(axum::body::Body::from);
    }
    let prefix = format!("/plugin-asset/{credential}");
    let path = format!("/{asset_path}");
    crate::plugins::asset_protocol::handle(&method, &path, uri.query(), &prefix).await.map(axum::body::Body::from)
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
    socket
        .connect((std::net::Ipv4Addr::new(192, 0, 2, 1), 80))
        .ok()?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn device(approved_at: Option<i64>) -> WebDevice {
        WebDevice {
            id: "d".into(),
            user_agent: String::new(),
            created_at: 0,
            last_seen_at: 0,
            approved_at,
            name: None,
        }
    }

    #[test]
    fn conditional_bridge_take_never_removes_a_replacement() {
        let state = WebAccessState::default();
        let running = |token: &str| Running {
            info: WebAccessInfo {
                url: format!("http://127.0.0.1/?token={token}"),
                port: 1420,
                token: token.to_string(),
                lan_ip: "127.0.0.1".to_string(),
            },
            emit_id: 1,
            shutdown: None,
            stop_watch: watch::channel(false).0,
        };

        *state.inner.lock() = Some(running("new-owner"));
        assert!(state.take_if_token("old-owner").is_none());
        assert_eq!(state.bridge_target().unwrap().1, "new-owner");
        assert!(state.take_if_token("new-owner").is_some());
        assert!(state.bridge_target().is_none());
    }

    #[tokio::test]
    async fn bridge_candidate_cannot_be_adopted_before_its_owner_rolls_back() {
        let state = Arc::new(WebAccessState::default());
        *state.inner.lock() = Some(Running {
            info: WebAccessInfo {
                url: "http://127.0.0.1/?token=candidate".into(),
                port: 1420,
                token: "candidate".into(),
                lan_ip: "127.0.0.1".into(),
            },
            emit_id: 1,
            shutdown: None,
            stop_watch: watch::channel(false).0,
        });
        let owner = state.lock_transition().await;
        let contender_state = Arc::clone(&state);
        let contender = tokio::spawn(async move {
            let _transition = contender_state.lock_transition().await;
            contender_state.bridge_target()
        });

        tokio::task::yield_now().await;
        assert!(
            !contender.is_finished(),
            "the candidate is not adoptable yet"
        );
        assert!(state.take_if_token("candidate").is_some());
        drop(owner);

        assert_eq!(
            contender.await.unwrap(),
            None,
            "the later adopter sees the rolled-back state"
        );
    }

    /// The relay path answers to the device list, never to the switch: an
    /// approved device walks in with the switch off, and an unapproved one is
    /// asked to pair. The LAN keeps upstream's model (the token is the gate,
    /// so there is nothing to unlock there).
    #[test]
    fn gate_locks_the_relay_path_by_approval_not_by_the_switch() {
        assert!(
            !needs_unlock(false, None),
            "LAN keeps upstream's model: the token URL is enough"
        );
        assert!(
            !needs_unlock(false, Some(&device(None))),
            "a LAN browser is never asked to pair"
        );
        assert!(needs_unlock(true, None), "a relay device must pair first");
        assert!(
            needs_unlock(true, Some(&device(None))),
            "a relay device that never unlocked is still asked"
        );
        assert!(
            !needs_unlock(true, Some(&device(Some(42)))),
            "an approved device connects with the switch off as well"
        );
    }

    /// Through the relay the device approval is the credential and the phone
    /// URL carries no token, so the token is never asked for there — while a
    /// shipped URL must keep working on the LAN, switch or no switch.
    ///
    /// The peer address is half the test: only the desktop's own relay client
    /// dials the bridge on loopback, so a LAN browser writing the header
    /// itself must not be able to opt out of the token.
    #[test]
    fn token_is_waived_only_for_relayed_traffic() {
        let check = |headers: &axum::http::HeaderMap, peer: &str| {
            token_required(headers, format!("{peer}:1234").parse().unwrap())
        };
        // Relayed: no token, from the loopback peer the relay client dials from.
        assert!(!check(&relay_headers(), "127.0.0.1"));
        // Everything else still carries it — a LAN browser writing our own
        // header from a LAN address included.
        assert!(check(&axum::http::HeaderMap::new(), "127.0.0.1"));
        assert!(check(&axum::http::HeaderMap::new(), "192.168.1.6"));
        assert!(check(&relay_headers(), "192.168.1.6"));
    }

    fn relay_headers() -> axum::http::HeaderMap {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            crate::relay::VIA_HEADER,
            axum::http::HeaderValue::from_static("relay"),
        );
        headers
    }

    #[test]
    fn form_field_reads_the_posted_key() {
        assert_eq!(
            form_field("key=ABCD2345&other=1", "key").as_deref(),
            Some("ABCD2345")
        );
        assert_eq!(form_field("key=a+b%2C", "key").as_deref(), Some("a b,"));
        assert_eq!(form_field("other=1", "key"), None);
    }
}
