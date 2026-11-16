//! In-app browser tabs. Each browser tab is a native child webview of the
//! main window, positioned over a React placeholder rect. The frontend owns
//! tab state (order, active tab, persistence); these commands own the native
//! webview lifecycle only, so a closed React tab can never leak a webview
//! (browser_close is called on tab close) and an inactive one never paints
//! over other surfaces (browser_set_visible on tab switch).

use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

/// Webview label prefix; the frontend id is appended verbatim. Keeping one
/// namespace lets us tell our children apart from the main webview.
const LABEL_PREFIX: &str = "browser-";

/// Navigation inside a browser webview: emitted with the new URL so the
/// address bar and tab label can follow real navigations.
pub const NAV_EVENT: &str = "browser-tab-nav";
/// Document title changes (fires on load and on SPA title updates).
pub const TITLE_EVENT: &str = "browser-tab-title";

fn label(id: &str) -> String {
    format!("{LABEL_PREFIX}{id}")
}
/// The embedded browser has no window to open into, so links that ask for
/// one (target=_blank anchors, _blank forms, window.open) are rerouted to
/// navigate the current tab instead of dying silently. Injected at document
/// start of every navigation; the click listener runs in the capture phase
/// so a page's own click handlers (e.g. Google rewriting result hrefs on
/// mousedown) have already settled, and its preventDefault keeps the
/// new-window request from ever reaching WKWebView.
const LINK_ROUTING_SCRIPT: &str = r#"
(() => {
  document.addEventListener('click', (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[target]') : null;
    if (!anchor) return;
    const target = anchor.getAttribute('target').toLowerCase();
    if (target !== '_blank' && target !== '_new') return;
    event.preventDefault();
    event.stopPropagation();
    window.location.href = anchor.href;
  }, true);
  document.addEventListener('submit', (event) => {
    const form = event.target;
    const target = (form.getAttribute('target') || '').toLowerCase();
    if (target === '_blank' || target === '_new') form.setAttribute('target', '_self');
  }, true);
  const open = window.open.bind(window);
  window.open = (url, target) => {
    if (url && (!target || target === '_blank' || target === '_new')) {
      window.location.href = url;
      return null;
    }
    return open(url, target);
  };
})();
"#;

/// Webview labels are global per app; keep ids to a safe alphabet so a
/// malformed id can never collide with another webview's label.
fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("invalid browser tab id: {id:?}"));
    }
    Ok(())
}

fn get_webview(app: &AppHandle, id: &str) -> Result<tauri::Webview, String> {
    app.get_webview(&label(id))
        .ok_or_else(|| format!("browser webview {id} not found"))
}

fn parse_url(raw: &str) -> Result<Url, String> {
    Url::parse(raw).map_err(|e| format!("invalid url {raw:?}: {e}"))
}

/// Create the child webview for a browser tab. Idempotent: re-creating an
/// existing id is a no-op so the React effect can retry after a failed
/// bounds sync without tearing the page down.
#[tauri::command]
pub async fn browser_create(
    window: tauri::Window,
    id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    // Tauri documents that Window::add_child deadlocks with WebView2 when it
    // runs on the synchronous IPC/main thread: the callback is created, but
    // controller initialization never finishes and the invoke never resolves.
    // Keep the IPC future off that thread so the native message pump can
    // complete the child webview.
    tauri::async_runtime::spawn_blocking(move || {
        create_browser_webview(window, &id, &url, x, y, width, height)
    })
    .await
    .map_err(|error| format!("failed to create browser webview task: {error}"))?
}

fn create_browser_webview(
    window: tauri::Window,
    id: &str,
    url: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    validate_id(id)?;
    let label = label(id);
    if window.get_webview(&label).is_some() {
        return Ok(());
    }
    let parsed = parse_url(url)?;
    let app = window.app_handle().clone();
    let nav_id = id.to_string();
    let title_id = id.to_string();
    let new_window_app = window.app_handle().clone();
    let new_window_label = label.clone();
    let builder = tauri::WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .focused(true)
        .zoom_hotkeys_enabled(true)
        .initialization_script(LINK_ROUTING_SCRIPT)
        .on_navigation(move |url| {
            let _ = app.emit(
                NAV_EVENT,
                serde_json::json!({ "id": nav_id, "url": url.to_string() }),
            );
            // Never veto: the frontend address bar is display-only.
            true
        })
        .on_document_title_changed(move |webview, title| {
            let _ = webview.app_handle().emit(
                TITLE_EVENT,
                serde_json::json!({ "id": title_id, "title": title }),
            );
        })
        // Fallback for whatever LINK_ROUTING_SCRIPT misses (named targets,
        // pages that bypass window.open): a denied new-window request
        // silently dies, so follow the link in this same webview instead —
        // history and the back button keep working. The handler gets no
        // source webview handle; look it up by label.
        .on_new_window(move |url, _features| {
            if let Some(webview) = new_window_app.get_webview(&new_window_label) {
                let _ = webview.navigate(url);
            }
            tauri::webview::NewWindowResponse::Deny
        });
    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width.max(1.0), height.max(1.0)),
        )
        .map_err(|e| format!("failed to create browser webview: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn browser_close(app: AppHandle, id: String) -> Result<(), String> {
    validate_id(&id)?;
    // Closing an already-closed tab is fine (React unmount races a tab
    // close from another entry point).
    if let Some(webview) = app.get_webview(&label(&id)) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, id: String, url: String) -> Result<(), String> {
    validate_id(&id)?;
    let parsed = parse_url(&url)?;
    get_webview(&app, &id)?
        .navigate(parsed)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_set_bounds(
    app: AppHandle,
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    validate_id(&id)?;
    get_webview(&app, &id)?
        .set_bounds(tauri::Rect {
            position: LogicalPosition::new(x, y).into(),
            size: LogicalSize::new(width.max(1.0), height.max(1.0)).into(),
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_set_visible(app: AppHandle, id: String, visible: bool) -> Result<(), String> {
    validate_id(&id)?;
    let webview = get_webview(&app, &id)?;
    if visible {
        webview.show().map_err(|e| e.to_string())
    } else {
        webview.hide().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn browser_go_back(app: AppHandle, id: String) -> Result<(), String> {
    validate_id(&id)?;
    get_webview(&app, &id)?
        .eval("history.back()")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_go_forward(app: AppHandle, id: String) -> Result<(), String> {
    validate_id(&id)?;
    get_webview(&app, &id)?
        .eval("history.forward()")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_reload(app: AppHandle, id: String) -> Result<(), String> {
    validate_id(&id)?;
    get_webview(&app, &id)?.reload().map_err(|e| e.to_string())
}

/// Current URL read straight from the native webview, so SPA pushState
/// navigations (which never fire on_navigation) still reach the address
/// bar. The frontend polls this only while the tab is active.
#[tauri::command]
pub fn browser_current_url(app: AppHandle, id: String) -> Result<Option<String>, String> {
    validate_id(&id)?;
    match app.get_webview(&label(&id)) {
        Some(webview) => webview
            .url()
            .map(|u| Some(u.to_string()))
            .map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::validate_id;

    #[test]
    fn id_validation_accepts_safe_alphabet() {
        assert!(validate_id("b1a2c3").is_ok());
        assert!(validate_id("tab-1_x").is_ok());
    }

    #[test]
    fn id_validation_rejects_label_escape() {
        assert!(validate_id("").is_err());
        assert!(validate_id("../main").is_err());
        assert!(validate_id("a b").is_err());
        assert!(validate_id(&"x".repeat(65)).is_err());
    }
}
