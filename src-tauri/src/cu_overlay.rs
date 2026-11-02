//! Virtual cursor overlay: a small transparent always-on-top window showing
//! a blue pointer while a computer-use run drives the machine, so the user
//! can see where the agent is about to act.
//!
//! The driver lives in the `ccgui-computer-use` helper process (spawned by
//! the engine CLI), so action targets arrive here over a loopback control
//! channel: 127.0.0.1 only, per-launch bearer token, and the port/token are
//! handed to the child through the MCP server entry's env.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use axum::response::IntoResponse;
use parking_lot::Mutex;
use serde::Deserialize;
use tauri::Manager;

const OVERLAY_LABEL: &str = "cu-cursor";
const OVERLAY_SIZE: f64 = 64.0;
/// Pointer tip inside the 64px window (see public/cursor.html).
const CURSOR_HOTSPOT: (f64, f64) = (22.0, 17.0);
/// Glide feel: fast but capped, so far jumps read as motion, not teleport.
const GLIDE_PX_PER_SEC: f64 = 2000.0;
const GLIDE_MAX_SECS: f64 = 0.5;
/// Crash safety: a child that dies without its session-end POST leaves no
/// ghost cursor behind.
const IDLE_HIDE_SECS: u64 = 30;

pub struct OverlayManager {
    token: String,
    port: u16,
    inner: Mutex<OverlayInner>,
}

struct OverlayInner {
    visible: bool,
    pos: (f64, f64),
    target: (f64, f64),
    /// Bumped on every new target/hide; stale glide tasks cancel themselves.
    generation: u64,
    last_event: Instant,
}

static MANAGER: OnceLock<OverlayManager> = OnceLock::new();
/// The production app handle, used for window ops. Absent in tests, where
/// the control channel still runs (window ops become no-ops).
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Base URL the MCP child posts cursor/session events to (None before init,
/// e.g. unit tests — env is then simply omitted from MCP server entries).
pub fn control_base() -> Option<String> {
    MANAGER
        .get()
        .map(|m| format!("http://127.0.0.1:{}", m.port))
}

pub fn control_token() -> Option<String> {
    MANAGER.get().map(|m| m.token.clone())
}

#[derive(Deserialize)]
struct SessionPayload {
    active: bool,
}

#[derive(Deserialize)]
struct CursorPayload {
    x: f64,
    y: f64,
}

pub fn init(app: &tauri::AppHandle) -> Result<(), String> {
    let _ = APP.set(app.clone());
    start_server()
}

fn start_server() -> Result<(), String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("bind cursor control channel: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("cursor control channel addr: {e}"))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("cursor control channel nonblocking: {e}"))?;
    let token = uuid::Uuid::new_v4().to_string();
    let manager = OverlayManager {
        token: token.clone(),
        port,
        inner: Mutex::new(OverlayInner {
            visible: false,
            pos: (0.0, 0.0),
            target: (0.0, 0.0),
            generation: 0,
            last_event: Instant::now(),
        }),
    };
    let _ = MANAGER.set(manager);

    let expected = token;
    let router = axum::Router::new()
        .route("/session", axum::routing::post(session_handler))
        .route("/cursor", axum::routing::post(cursor_handler))
        .layer(axum::middleware::from_fn(
            move |req: axum::extract::Request, next: axum::middleware::Next| {
                let expected = expected.clone();
                async move {
                    let ok = req
                        .headers()
                        .get(axum::http::header::AUTHORIZATION)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.strip_prefix("Bearer "))
                        .is_some_and(|presented| presented == expected);
                    if ok {
                        next.run(req).await
                    } else {
                        axum::http::StatusCode::UNAUTHORIZED.into_response()
                    }
                }
            },
        ));
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => {
                let _ = axum::serve(listener, router).await;
            }
            Err(error) => eprintln!("[cu-overlay] control channel failed: {error}"),
        }
    });

    // Idle watchdog: no cursor/session event for IDLE_HIDE_SECS → the child
    // is gone; take the pointer off the screen.
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            let Some(manager) = MANAGER.get() else { return };
            let idle_too_long = {
                let inner = manager.inner.lock();
                inner.visible && inner.last_event.elapsed() > Duration::from_secs(IDLE_HIDE_SECS)
            };
            if idle_too_long {
                hide();
            }
        }
    });
    Ok(())
}

async fn session_handler(
    axum::Json(payload): axum::Json<SessionPayload>,
) -> axum::http::StatusCode {
    if !payload.active {
        hide();
    }
    axum::http::StatusCode::OK
}

async fn cursor_handler(axum::Json(payload): axum::Json<CursorPayload>) -> axum::http::StatusCode {
    show_at(payload.x, payload.y);
    axum::http::StatusCode::OK
}

/// Run a window op on the main thread. AppKit aborts the whole app when a
/// window is created or moved off it — and the control-channel handlers that
/// drive the overlay all live on tokio threads (this was the crash behind
/// "no blue cursor": the first cursor event killed the app).
fn on_main<F>(op: F)
where
    F: FnOnce() + Send + 'static,
{
    let Some(app) = APP.get() else { return };
    let _ = app.run_on_main_thread(op);
}

fn ensure_window() -> Result<(), String> {
    let app = APP.get().ok_or("overlay has no app handle (test mode)")?;
    if app.get_webview_window(OVERLAY_LABEL).is_some() {
        return Ok(());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let app_handle = app.clone();
    app.run_on_main_thread(move || {
        let result = tauri::WebviewWindowBuilder::new(
            &app_handle,
            OVERLAY_LABEL,
            tauri::WebviewUrl::App("cursor.html".into()),
        )
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .inner_size(OVERLAY_SIZE, OVERLAY_SIZE)
        .visible(false)
        .build()
        .map(|win| {
            // Click-through: the overlay must never intercept the agent's
            // (or the user's) clicks at the target it hovers over.
            let _ = win.set_ignore_cursor_events(true);
        })
        .map_err(|e| format!("create cursor overlay: {e}"));
        let _ = tx.send(result);
    })
    .map_err(|e| format!("dispatch overlay creation to main thread: {e}"))?;
    rx.recv()
        .map_err(|_| "overlay creation result channel dropped".to_string())?
}

fn show_at(x: f64, y: f64) {
    let Some(manager) = MANAGER.get() else { return };
    if let Err(error) = ensure_window() {
        eprintln!("[cu-overlay] {error}");
        return;
    }
    let Some(app) = APP.get() else { return };
    let Some(win) = app.get_webview_window(OVERLAY_LABEL) else {
        return;
    };
    let target = (x - CURSOR_HOTSPOT.0, y - CURSOR_HOTSPOT.1);
    let (first_show, generation) = {
        let mut inner = manager.inner.lock();
        let first_show = !inner.visible;
        inner.visible = true;
        inner.target = target;
        inner.generation += 1;
        inner.last_event = Instant::now();
        if first_show {
            inner.pos = target;
        }
        (first_show, inner.generation)
    };
    if first_show {
        on_main(move || {
            let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                target.0, target.1,
            )));
            let _ = win.show();
        });
        return;
    }
    let win_show = win.clone();
    on_main(move || {
        let _ = win_show.show();
    });
    tauri::async_runtime::spawn(async move {
        loop {
            let (from, to, current) = {
                let inner = manager.inner.lock();
                (inner.pos, inner.target, inner.generation)
            };
            if current != generation {
                return; // superseded by a newer target or a hide
            }
            let dx = to.0 - from.0;
            let dy = to.1 - from.1;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < 1.0 {
                let win_final = win.clone();
                on_main(move || {
                    let _ = win_final.set_position(tauri::Position::Logical(
                        tauri::LogicalPosition::new(to.0, to.1),
                    ));
                });
                manager.inner.lock().pos = to;
                return;
            }
            // Ease-out step: fraction of the remaining distance per frame,
            // duration capped like cc-haha's glide (~2000px/s, max 0.5s).
            let total = (dist / GLIDE_PX_PER_SEC).min(GLIDE_MAX_SECS);
            let dt = 1.0 / 60.0;
            let frac = (dt / total).min(1.0);
            let next = (from.0 + dx * frac, from.1 + dy * frac);
            let win_step = win.clone();
            on_main(move || {
                let _ = win_step.set_position(tauri::Position::Logical(
                    tauri::LogicalPosition::new(next.0, next.1),
                ));
            });
            manager.inner.lock().pos = next;
            tokio::time::sleep(Duration::from_secs_f64(dt)).await;
        }
    });
}

fn hide() {
    let Some(manager) = MANAGER.get() else { return };
    {
        let mut inner = manager.inner.lock();
        inner.visible = false;
        inner.generation += 1;
    }
    if let Some(app) = APP.get() {
        if let Some(win) = app.get_webview_window(OVERLAY_LABEL) {
            on_main(move || {
                let _ = win.hide();
            });
        }
    }
}

/// Window teardown: the overlay dies with the main window. Hiding was not
/// enough — Tauri exits when the last window is *destroyed*, so a hidden
/// overlay kept the process (and its already-swept engine children) alive
/// windowless after a confirmed quit. Drop the armed state too so a future
/// main window starts clean.
pub fn shutdown() {
    let Some(manager) = MANAGER.get() else { return };
    {
        let mut inner = manager.inner.lock();
        inner.visible = false;
        inner.generation += 1;
    }
    if let Some(app) = APP.get() {
        if let Some(win) = app.get_webview_window(OVERLAY_LABEL) {
            on_main(move || {
                let _ = win.destroy();
            });
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    /// The control channel takes the MCP child's word for where the pointer
    /// goes — the bearer token is the only thing standing between that and
    /// any loopback process moving a fake cursor onto the user's screen.
    #[test]
    fn control_channel_requires_the_per_launch_token() {
        start_server().expect("start overlay control channel");
        let base = control_base().expect("control base after init");
        let token = control_token().expect("token after init");
        let client = reqwest::blocking::Client::new();
        let post = |path: &str, auth: Option<&str>| {
            let request = client
                .post(format!("{base}{path}"))
                .json(&serde_json::json!({ "x": 10.0, "y": 20.0, "active": false }));
            let request = match auth {
                Some(token) => request.bearer_auth(token),
                None => request,
            };
            request.send().unwrap().status()
        };
        assert_eq!(post("/cursor", None), 401);
        assert_eq!(post("/cursor", Some("wrong-token")), 401);
        assert_eq!(post("/session", None), 401);
        assert_eq!(post("/cursor", Some(&token)), 200);
        assert_eq!(post("/session", Some(&token)), 200);
    }
}
