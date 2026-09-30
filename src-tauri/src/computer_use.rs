//! Computer use: let an agent see and operate this machine.
//!
//! Three layers in one module:
//! - OS permission status + System Settings deep links. macOS (TCC) is the
//!   only platform that gates us; on Windows/Linux the driver works as-is
//!   and the status reports "no OS grant required".
//! - A screenshot/input driver (xcap + enigo) shared by the MCP tools below.
//! - An stdio MCP server (the `--computer-use-mcp` process mode) that engine
//!   CLIs spawn as a child; the model drives the machine through its tools.
//!
//! Fail-closed: every screenshot requires Screen Recording, every input
//! action requires Accessibility, and a missing grant returns an error that
//! tells the model to send the user to Settings → Computer Use. Tool names
//! and schemas are our own; the action vocabulary follows the de-facto
//! computer-use convention (screenshot pixels as the coordinate space).

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use serde::Serialize;
use xcap::Monitor;

/// Emitted when the armed global Esc fires; the frontend interrupts the
/// active computer-use run in response.
pub const ESCAPE_EVENT: &str = "computeruse://escape";

// ==================== OS permission status ====================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub accessibility: bool,
    pub screen_recording: bool,
    /// False on platforms with no OS-level grant flow: the UI shows
    /// "no permission needed" instead of misleading un-granted rows.
    pub os_permissions_required: bool,
}

#[cfg(target_os = "macos")]
mod tcc {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        pub fn AXIsProcessTrusted() -> bool;
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub fn CGPreflightScreenCaptureAccess() -> bool;
    }
}

pub fn accessibility_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { tcc::AXIsProcessTrusted() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

pub fn screen_recording_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { tcc::CGPreflightScreenCaptureAccess() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

pub fn permission_status() -> PermissionStatus {
    PermissionStatus {
        accessibility: accessibility_granted(),
        screen_recording: screen_recording_granted(),
        os_permissions_required: cfg!(target_os = "macos"),
    }
}

fn require_accessibility() -> Result<(), String> {
    if accessibility_granted() {
        Ok(())
    } else {
        Err("Accessibility permission is not granted to this app. Tell the user to enable it in CC GUI → Settings → Computer Use.".into())
    }
}

fn require_screen_recording() -> Result<(), String> {
    if screen_recording_granted() {
        Ok(())
    } else {
        Err("Screen Recording permission is not granted to this app. Tell the user to enable it in CC GUI → Settings → Computer Use.".into())
    }
}

#[tauri::command]
pub fn computer_use_permission_status() -> PermissionStatus {
    permission_status()
}

#[tauri::command]
pub fn computer_use_open_permission_settings(kind: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let url = match kind.as_str() {
            "accessibility" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
            "screenRecording" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
            }
            other => return Err(format!("unknown permission pane: {other}")),
        };
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("open System Settings: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = kind;
        Err("OS permission grants are only needed on macOS".into())
    }
}

// ==================== Esc-to-stop ====================

static ESC_ARMED: AtomicBool = AtomicBool::new(false);

pub fn esc_armed() -> bool {
    ESC_ARMED.load(Ordering::SeqCst)
}

/// Arm/disarm the global Esc-to-stop while a computer-use run is active.
/// Registration failure only loses the convenience hotkey (e.g. the OS
/// refused without Accessibility) — it never blocks the run itself.
#[tauri::command]
pub fn computer_use_set_active(app: tauri::AppHandle, active: bool) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    ESC_ARMED.store(active, Ordering::SeqCst);
    let shortcut = "Escape"
        .parse::<Shortcut>()
        .map_err(|e| format!("parse Escape shortcut: {e}"))?;
    let gs = app.global_shortcut();
    if active {
        let _ = gs.register(shortcut);
    } else {
        let _ = gs.unregister(shortcut);
    }
    Ok(())
}

/// Drop the armed state and the global registration (window teardown).
pub fn disarm_esc(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    ESC_ARMED.store(false, Ordering::SeqCst);
    if let Ok(shortcut) = "Escape".parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}
// ==================== omp MCP injection ====================

/// omp discovers MCP servers only from fixed files (mcp.json / .mcp.json /
/// .omp/mcp.json / ~/.omp/agent/mcp.json — there is no launch flag), so an
/// omp send merge-writes the workspace's `.omp/mcp.json` and restores it when
/// the run ends. The journal survives a crash mid-run: the next app start
/// restores every recorded injection (sweep_mcp_injections).
///
/// The machinery is generic on purpose: computer use and the per-bot memory
/// tool both ride it, and a run may inject both (one file, two entries, two
/// journal refs). omp 的本机驱动在 WSL 远端跑不了，调用方负责拒绝。
pub const MCP_SERVER_NAME: &str = "ccgui-computer";
const MCP_SCHEMA_URL: &str = "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json";

/// One app-served MCP entry to merge into the workspace file. `command` is
/// this app's own binary; `args`/`env` are what that child needs to know
/// (which mode to serve, which bot it acts for).
#[derive(Debug, Clone)]
pub struct McpServerSpec {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// The computer-use driver's spec: `--computer-use-mcp`, plus the overlay
/// control channel when the main app is running (absent in tests).
pub fn computer_use_spec() -> Result<McpServerSpec, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("resolve own exe for computer use: {e}"))?;
    let mut env = Vec::new();
    if let (Some(base), Some(token)) = (
        crate::cu_overlay::control_base(),
        crate::cu_overlay::control_token(),
    ) {
        env.push(("CCGUI_CU_CONTROL".to_string(), base));
        env.push(("CCGUI_CU_TOKEN".to_string(), token));
    }
    Ok(McpServerSpec {
        name: MCP_SERVER_NAME.to_string(),
        command: exe.to_string_lossy().into_owned(),
        args: vec!["--computer-use-mcp".to_string()],
        env,
    })
}

/// The `mcpServers` entry for claude's inline `--mcp-config` JSON.
pub fn mcp_server_json(spec: &McpServerSpec) -> serde_json::Value {
    let mut server = serde_json::json!({
        "command": spec.command,
        "args": spec.args,
    });
    if !spec.env.is_empty() {
        server["env"] = serde_json::Value::Object(
            spec.env
                .iter()
                .map(|(key, value)| (key.clone(), serde_json::Value::String(value.clone())))
                .collect(),
        );
    }
    server
}

/// Handle restoring every entry one run injected into a workspace file.
#[derive(Debug, Clone)]
pub struct McpRestore {
    refs: Vec<RestoreRef>,
}

#[derive(Debug, Clone)]
struct RestoreRef {
    path: PathBuf,
    /// We created the file (vs. merged into the user's): a final restore
    /// deletes it when nothing but the skeleton remains.
    created_file: bool,
    server: String,
}

fn default_server_name() -> String {
    MCP_SERVER_NAME.to_string()
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct InjectionRecord {
    path: PathBuf,
    created_file: bool,
    /// Concurrent runs in one workspace share one injection per server.
    count: u32,
    /// Which entry this ref counts. Records written before the memory tool
    /// existed carry no field and are computer-use injections.
    #[serde(default = "default_server_name")]
    server: String,
}

static JOURNAL_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

fn injections_path() -> PathBuf {
    crate::paths::app_home().join("computer-use-injections.json")
}

fn journal_read() -> Vec<InjectionRecord> {
    std::fs::read_to_string(injections_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn journal_write(records: &[InjectionRecord]) {
    let path = injections_path();
    let Ok(json) = serde_json::to_string_pretty(records) else {
        return;
    };
    // The app home exists in production (ensure_dirs at startup); tests and
    // odd environments get it created on demand.
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("tmp");
    if std::fs::write(&tmp, json).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

/// Merge our MCP entries into the workspace's `.omp/mcp.json`. One spec per
/// server; entries the user's own file already names are skipped (the user's
/// entry always wins, and nothing then needs restoring). Returns None when
/// this call injected nothing.
pub fn inject_workspace_mcp(
    workspace: &Path,
    specs: &[McpServerSpec],
) -> Result<Option<McpRestore>, String> {
    if specs.is_empty() {
        return Ok(None);
    }
    let _guard = JOURNAL_LOCK.lock();
    let path = workspace.join(".omp").join("mcp.json");
    let mut records = journal_read();
    let mut refs = Vec::new();
    let mut doc: Option<serde_json::Value> = None;
    for spec in specs {
        // Already injected by a concurrent run in this workspace: just take a
        // reference; the file write happened on the first inject.
        if let Some(record) = records
            .iter_mut()
            .find(|r| r.path == path && r.server == spec.name)
        {
            record.count += 1;
            refs.push(RestoreRef {
                path: path.clone(),
                created_file: record.created_file,
                server: spec.name.clone(),
            });
            continue;
        }
        // A file an earlier inject created stays "ours" for deletion even
        // when this second entry found it already on disk.
        let created_file = records
            .iter()
            .find(|r| r.path == path)
            .map(|r| r.created_file)
            .unwrap_or(!path.exists());
        if doc.is_none() {
            doc = Some(load_workspace_doc(&path)?);
        }
        let servers = doc
            .as_mut()
            .expect("the doc was loaded above")
            .get_mut("mcpServers")
            .and_then(serde_json::Value::as_object_mut)
            .ok_or_else(|| format!("{}: mcpServers is not an object", path.display()))?;
        if servers.contains_key(&spec.name) {
            continue;
        }
        let mut server = serde_json::json!({
            "type": "stdio",
            "command": spec.command,
            "args": spec.args,
        });
        if !spec.env.is_empty() {
            server["env"] = serde_json::Value::Object(
                spec.env
                    .iter()
                    .map(|(key, value)| (key.clone(), serde_json::Value::String(value.clone())))
                    .collect(),
            );
        }
        servers.insert(spec.name.clone(), server);
        records.push(InjectionRecord {
            path: path.clone(),
            created_file,
            count: 1,
            server: spec.name.clone(),
        });
        refs.push(RestoreRef {
            path: path.clone(),
            created_file,
            server: spec.name.clone(),
        });
    }
    if refs.is_empty() {
        return Ok(None);
    }
    if let Some(doc) = doc {
        if refs.iter().any(|r| r.created_file) {
            let parent = path.parent().unwrap();
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        let tmp = path.with_extension("json.ccgui-tmp");
        let json = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
        std::fs::write(&tmp, json).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        std::fs::rename(&tmp, &path).map_err(|e| format!("replace {}: {e}", path.display()))?;
    }
    journal_write(&records);
    Ok(Some(McpRestore { refs }))
}

/// 文件在就合并（哪怕是本次运行早先创建的），不在才用骨架。`created_file`
/// 只决定恢复时删不删文件，不参与读取——第二轮注入拿到的是同一份已合并的
/// 文档，不会把上一轮写进去的条目覆盖掉。
fn load_workspace_doc(path: &Path) -> Result<serde_json::Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({ "$schema": MCP_SCHEMA_URL, "mcpServers": {} }));
    }
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("parse {}: {e}", path.display()))
}

impl McpRestore {
    /// Release this run's references; the last holder of an entry removes it
    /// from the workspace file (deleting the file when we created it and
    /// nothing but the skeleton remains).
    pub fn restore(&self) {
        let _guard = JOURNAL_LOCK.lock();
        let mut records = journal_read();
        for reference in &self.refs {
            if let Some(record) = records
                .iter_mut()
                .find(|r| r.path == reference.path && r.server == reference.server)
            {
                record.count = record.count.saturating_sub(1);
                if record.count > 0 {
                    continue;
                }
            }
            records.retain(|r| !(r.path == reference.path && r.server == reference.server));
            // Delete the file only when no other run still refs this path;
            // otherwise just drop our entry and keep the rest.
            let delete_when_empty = reference.created_file
                && !records.iter().any(|r| r.path == reference.path);
            remove_server_entry(
                &reference.path,
                std::slice::from_ref(&reference.server),
                delete_when_empty,
            );
        }
        journal_write(&records);
    }
}

fn remove_server_entry(path: &Path, servers_to_remove: &[String], delete_when_empty: bool) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    let Ok(mut doc) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    let Some(servers) = doc
        .get_mut("mcpServers")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return;
    };
    for server in servers_to_remove {
        servers.remove(server);
    }
    // A file we created goes away once it carries nothing but the skeleton;
    // the user's file keeps everything else it ever had, edits included.
    let skeleton_only = servers.is_empty()
        && doc
            .as_object()
            .map(|o| o.keys().all(|k| k == "$schema" || k == "mcpServers"))
            .unwrap_or(false);
    if delete_when_empty && skeleton_only {
        let _ = std::fs::remove_file(path);
        // The .omp dir we created for it goes too; non-empty is a no-op.
        if let Some(parent) = path.parent() {
            let _ = std::fs::remove_dir(parent);
        }
        return;
    }
    if let Ok(json) = serde_json::to_string_pretty(&doc) {
        let tmp = path.with_extension("json.ccgui-tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, path);
        }
    }
}

/// Crash recovery: the app died between inject and restore, so every
/// journaled workspace file still carries our entries. Restore them all at
/// startup; runs never outlive the app, so none can still be active.
pub fn sweep_mcp_injections() {
    let _guard = JOURNAL_LOCK.lock();
    let records = journal_read();
    let mut by_path: Vec<(PathBuf, bool, Vec<String>)> = Vec::new();
    for record in &records {
        match by_path.iter_mut().find(|(path, _, _)| *path == record.path) {
            Some((_, created_file, servers)) => {
                *created_file = *created_file || record.created_file;
                servers.push(record.server.clone());
            }
            None => by_path.push((
                record.path.clone(),
                record.created_file,
                vec![record.server.clone()],
            )),
        }
    }
    for (path, created_file, servers) in &by_path {
        remove_server_entry(path, servers, *created_file);
    }
    journal_write(&[]);
}

// ==================== Driver: displays & screenshots ====================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub id: u32,
    pub name: String,
    /// Origin in the global logical (point) coordinate space.
    pub x: i32,
    pub y: i32,
    /// Physical pixel size.
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub primary: bool,
}

fn display_info_of(monitor: &Monitor) -> DisplayInfo {
    DisplayInfo {
        id: monitor.id().unwrap_or(0),
        name: monitor.friendly_name().unwrap_or_default(),
        x: monitor.x().unwrap_or(0),
        y: monitor.y().unwrap_or(0),
        width: monitor.width().unwrap_or(0),
        height: monitor.height().unwrap_or(0),
        scale: monitor.scale_factor().unwrap_or(1.0) as f64,
        primary: monitor.is_primary().unwrap_or(false),
    }
}

fn pick_display(display_id: Option<u32>) -> Result<(Monitor, DisplayInfo), String> {
    let monitors = Monitor::all().map_err(|e| format!("list monitors: {e}"))?;
    let picked = match display_id {
        Some(id) => monitors
            .into_iter()
            .find(|m| m.id().unwrap_or(0) == id)
            .ok_or_else(|| format!("no display with id {id}"))?,
        None => monitors
            .into_iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .or_else(|| Monitor::all().ok()?.into_iter().next())
            .ok_or_else(|| "no display found".to_string())?,
    };
    let info = display_info_of(&picked);
    Ok((picked, info))
}

/// Long-edge cap for frames sent to the model: large enough to read UI text,
/// small enough to stay inside vision-token budgets.
const MAX_FRAME_EDGE: u32 = 1568;

/// Encoded-frame pixel dimensions for a display. Deterministic, so action
/// coordinates map back with the same math without re-capturing.
pub(crate) fn frame_dims(display: &DisplayInfo) -> (u32, u32) {
    let (w, h) = (display.width.max(1), display.height.max(1));
    let shrink = MAX_FRAME_EDGE as f64 / w.max(h) as f64;
    if shrink < 1.0 {
        (
            ((w as f64 * shrink).round() as u32).max(1),
            ((h as f64 * shrink).round() as u32).max(1),
        )
    } else {
        (w, h)
    }
}

/// Map a point in screenshot-image pixels to global logical points (the
/// coordinate space enigo injects in): image px → display physical px →
/// logical points via the scale factor, offset by the display origin.
pub(crate) fn frame_to_logical(
    x: f64,
    y: f64,
    frame_w: u32,
    frame_h: u32,
    display: &DisplayInfo,
) -> (i32, i32) {
    let phys_x = x * display.width as f64 / frame_w.max(1) as f64;
    let phys_y = y * display.height as f64 / frame_h.max(1) as f64;
    let scale = if display.scale > 0.0 {
        display.scale
    } else {
        1.0
    };
    (
        display.x + (phys_x / scale).round() as i32,
        display.y + (phys_y / scale).round() as i32,
    )
}

pub struct CapturedFrame {
    pub jpeg_b64: String,
    pub width: u32,
    pub height: u32,
    pub display: DisplayInfo,
}

fn capture_frame(display_id: Option<u32>) -> Result<CapturedFrame, String> {
    let (monitor, info) = pick_display(display_id)?;
    let raw = monitor
        .capture_image()
        .map_err(|e| format!("capture display: {e}"))?;
    let (fw, fh) = frame_dims(&info);
    let resized = if (raw.width(), raw.height()) != (fw, fh) {
        image::imageops::resize(&raw, fw, fh, image::imageops::FilterType::Triangle)
    } else {
        raw
    };
    // JPEG (no alpha) keeps vision payloads small; quality 78 is plenty for
    // UI text the model has to read.
    let rgb = image::DynamicImage::ImageRgba8(resized).to_rgb8();
    let mut buf = Cursor::new(Vec::new());
    rgb.write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(
        &mut buf, 78,
    ))
    .map_err(|e| format!("encode screenshot: {e}"))?;
    Ok(CapturedFrame {
        jpeg_b64: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            buf.into_inner(),
        ),
        width: fw,
        height: fh,
        display: info,
    })
}

// ==================== Driver: input ====================

fn new_enigo() -> Result<Enigo, String> {
    Enigo::new(&Settings::default()).map_err(|e| format!("init input driver: {e}"))
}
// ---- Virtual cursor reporting (MCP child → main app) ----

fn control_client() -> Option<(reqwest::blocking::Client, String, String)> {
    static CLIENT: std::sync::OnceLock<reqwest::blocking::Client> = std::sync::OnceLock::new();
    let base = std::env::var("CCGUI_CU_CONTROL").ok()?;
    let token = std::env::var("CCGUI_CU_TOKEN").ok()?;
    Some((
        CLIENT.get_or_init(reqwest::blocking::Client::new).clone(),
        base,
        token,
    ))
}

/// Tell the main app's overlay where the next action lands. Fire-and-forget:
/// loopback is sub-millisecond and a dead channel must never fail an action.
pub(crate) fn notify_cursor(x: i32, y: i32) {
    let Some((client, base, token)) = control_client() else {
        return;
    };
    let _ = client
        .post(format!("{base}/cursor"))
        .bearer_auth(token)
        .json(&serde_json::json!({ "x": x, "y": y }))
        .timeout(Duration::from_millis(250))
        .send();
}

/// Session brackets from the MCP child: show the pointer on initialize,
/// hide it when stdin closes (the engine run is over).
pub(crate) fn notify_session(active: bool) {
    let Some((client, base, token)) = control_client() else {
        return;
    };
    let _ = client
        .post(format!("{base}/session"))
        .bearer_auth(token)
        .json(&serde_json::json!({ "active": active }))
        .timeout(Duration::from_millis(250))
        .send();
}

fn logical_point(x: f64, y: f64, display_id: Option<u32>) -> Result<(i32, i32), String> {
    let (_, info) = pick_display(display_id)?;
    let (fw, fh) = frame_dims(&info);
    let point = frame_to_logical(x, y, fw, fh, &info);
    notify_cursor(point.0, point.1);
    Ok(point)
}

fn action_move(x: f64, y: f64, display_id: Option<u32>) -> Result<String, String> {
    require_accessibility()?;
    let (lx, ly) = logical_point(x, y, display_id)?;
    new_enigo()?
        .move_mouse(lx, ly, Coordinate::Abs)
        .map_err(|e| format!("move mouse: {e}"))?;
    Ok(format!("Mouse moved to ({lx}, {ly})."))
}

fn action_click(
    button: Button,
    label: &str,
    x: Option<f64>,
    y: Option<f64>,
    times: u32,
    display_id: Option<u32>,
) -> Result<String, String> {
    require_accessibility()?;
    let mut enigo = new_enigo()?;
    if let (Some(x), Some(y)) = (x, y) {
        let (lx, ly) = logical_point(x, y, display_id)?;
        enigo
            .move_mouse(lx, ly, Coordinate::Abs)
            .map_err(|e| format!("move mouse: {e}"))?;
    }
    for _ in 0..times.max(1) {
        enigo
            .button(button, Direction::Click)
            .map_err(|e| format!("click: {e}"))?;
    }
    Ok(format!("{label} click ×{} done.", times.max(1)))
}

fn action_drag(
    from_x: f64,
    from_y: f64,
    to_x: f64,
    to_y: f64,
    display_id: Option<u32>,
) -> Result<String, String> {
    require_accessibility()?;
    let (sx, sy) = logical_point(from_x, from_y, display_id)?;
    let (ex, ey) = logical_point(to_x, to_y, display_id)?;
    let mut enigo = new_enigo()?;
    enigo
        .move_mouse(sx, sy, Coordinate::Abs)
        .map_err(|e| format!("move mouse: {e}"))?;
    enigo
        .button(Button::Left, Direction::Press)
        .map_err(|e| format!("press button: {e}"))?;
    // Interpolate so drop targets that highlight under a moving cursor
    // (lists, canvases) see a natural drag instead of a teleport.
    const STEPS: i32 = 16;
    for step in 1..=STEPS {
        let nx = sx + (ex - sx) * step / STEPS;
        let ny = sy + (ey - sy) * step / STEPS;
        if enigo.move_mouse(nx, ny, Coordinate::Abs).is_err() {
            break;
        }
        std::thread::sleep(Duration::from_millis(8));
    }
    enigo
        .button(Button::Left, Direction::Release)
        .map_err(|e| format!("release button: {e}"))?;
    Ok(format!("Dragged from ({sx}, {sy}) to ({ex}, {ey})."))
}

fn action_scroll(
    x: Option<f64>,
    y: Option<f64>,
    delta_x: i32,
    delta_y: i32,
    display_id: Option<u32>,
) -> Result<String, String> {
    require_accessibility()?;
    let mut enigo = new_enigo()?;
    if let (Some(x), Some(y)) = (x, y) {
        let (lx, ly) = logical_point(x, y, display_id)?;
        enigo
            .move_mouse(lx, ly, Coordinate::Abs)
            .map_err(|e| format!("move mouse: {e}"))?;
    }
    // enigo scrolls up/right for positive values; the tool's deltas follow
    // the wheel convention (positive y = scroll content down).
    let dy = -delta_y.clamp(-20, 20);
    let dx = delta_x.clamp(-20, 20);
    if dy != 0 {
        enigo
            .scroll(dy, Axis::Vertical)
            .map_err(|e| format!("scroll: {e}"))?;
    }
    if dx != 0 {
        enigo
            .scroll(dx, Axis::Horizontal)
            .map_err(|e| format!("scroll: {e}"))?;
    }
    Ok(format!("Scrolled by ({delta_x}, {delta_y})."))
}

/// Cap so a runaway tool call cannot dump a novel into a focused field.
const MAX_TYPE_CHARS: usize = 4096;

fn action_type(text: &str) -> Result<String, String> {
    require_accessibility()?;
    if let Ok(enigo) = new_enigo() {
        if let Ok((x, y)) = enigo.location() {
            notify_cursor(x, y);
        }
    }
    if text.chars().count() > MAX_TYPE_CHARS {
        return Err(format!(
            "text too long (max {MAX_TYPE_CHARS} chars); split it into multiple type calls"
        ));
    }
    new_enigo()?
        .text(text)
        .map_err(|e| format!("type text: {e}"))?;
    Ok(format!("Typed {} chars.", text.chars().count()))
}

fn named_key(name: &str) -> Option<Key> {
    let key = match name {
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "esc" | "escape" => Key::Escape,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "space" => Key::Space,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "capslock" => Key::CapsLock,
        "cmd" | "command" | "meta" | "super" | "win" => Key::Meta,
        "ctrl" | "control" => Key::Control,
        "alt" | "option" => Key::Alt,
        "shift" => Key::Shift,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        single => {
            let mut chars = single.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => Key::Unicode(c),
                _ => return None,
            }
        }
    };
    Some(key)
}

/// Parse "cmd+shift+t" into held modifiers + the final key. A lone modifier
/// name ("alt") is itself a pressable key.
pub(crate) fn parse_key_chord(chord: &str) -> Result<(Vec<Key>, Key), String> {
    let parts: Vec<&str> = chord
        .split('+')
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();
    let (last, head) = parts
        .split_last()
        .ok_or_else(|| "empty key chord".to_string())?;
    let mut modifiers = Vec::new();
    for part in head {
        match part.to_ascii_lowercase().as_str() {
            "cmd" | "command" | "meta" | "super" | "win" => modifiers.push(Key::Meta),
            "ctrl" | "control" => modifiers.push(Key::Control),
            "alt" | "option" => modifiers.push(Key::Alt),
            "shift" => modifiers.push(Key::Shift),
            other => {
                return Err(format!(
                    "'{other}' is not a modifier; only cmd/ctrl/alt/shift may precede the final key"
                ))
            }
        }
    }
    let key =
        named_key(&last.to_ascii_lowercase()).ok_or_else(|| format!("unknown key '{last}'"))?;
    Ok((modifiers, key))
}

fn action_key(chord: &str) -> Result<String, String> {
    require_accessibility()?;
    if let Ok(enigo) = new_enigo() {
        if let Ok((x, y)) = enigo.location() {
            notify_cursor(x, y);
        }
    }
    let (modifiers, key) = parse_key_chord(chord)?;
    let mut enigo = new_enigo()?;
    for modifier in &modifiers {
        enigo
            .key(*modifier, Direction::Press)
            .map_err(|e| format!("press modifier: {e}"))?;
    }
    let result = enigo.key(key, Direction::Click);
    for modifier in modifiers.iter().rev() {
        let _ = enigo.key(*modifier, Direction::Release);
    }
    result.map_err(|e| format!("press key: {e}"))?;
    Ok(format!("Pressed {chord}."))
}

// ==================== MCP server ====================

pub mod mcp {
    use super::*;
    use rmcp::handler::server::wrapper::Parameters;
    use rmcp::model::{
        CallToolResult, ContentBlock, ErrorData as McpError, Implementation, ServerCapabilities,
        ServerConfig,
    };
    use rmcp::{schemars, tool, tool_handler, tool_router, ServerHandler, ServiceExt};

    fn tool_error(message: String) -> McpError {
        McpError::internal_error(message, None)
    }

    /// Text confirmation plus a fresh screenshot so the model immediately
    /// sees the action's effect — the loop is see → act → see.
    fn action_result(message: String, display_id: Option<u32>) -> Result<CallToolResult, McpError> {
        // Let the target UI settle before the follow-up frame.
        std::thread::sleep(Duration::from_millis(250));
        let mut blocks = vec![ContentBlock::text(message)];
        if screen_recording_granted() {
            match capture_frame(display_id) {
                Ok(frame) => {
                    blocks.push(ContentBlock::image(frame.jpeg_b64, "image/jpeg"));
                    blocks.push(ContentBlock::text(format!(
                        "Screen after the action ({}×{} px).",
                        frame.width, frame.height
                    )));
                }
                Err(error) => blocks.push(ContentBlock::text(format!(
                    "(follow-up screenshot failed: {error})"
                ))),
            }
        }
        Ok(CallToolResult::success(blocks))
    }

    #[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
    struct ScreenshotParams {
        /// Display id from `list_displays`; omit for the primary display.
        display_id: Option<u32>,
    }

    #[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
    struct PointParams {
        /// Horizontal position in screenshot pixels (0 = left edge).
        x: f64,
        /// Vertical position in screenshot pixels (0 = top edge).
        y: f64,
        /// Display id from `list_displays`; omit for the primary display.
        display_id: Option<u32>,
    }

    #[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
    struct OptionalPointParams {
        /// Click target in screenshot pixels; omit both to click in place.
        x: Option<f64>,
        /// Click target in screenshot pixels; omit both to click in place.
        y: Option<f64>,
        /// Display id from `list_displays`; omit for the primary display.
        display_id: Option<u32>,
    }

    #[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
    struct DragParams {
        /// Drag start, screenshot pixels.
        from_x: f64,
        /// Drag start, screenshot pixels.
        from_y: f64,
        /// Drag end, screenshot pixels.
        to_x: f64,
        /// Drag end, screenshot pixels.
        to_y: f64,
        /// Display id from `list_displays`; omit for the primary display.
        display_id: Option<u32>,
    }

    #[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
    struct ScrollParams {
        /// Where to hover while scrolling, screenshot pixels; omit both for
        /// the current cursor position.
        x: Option<f64>,
        /// Where to hover while scrolling, screenshot pixels.
        y: Option<f64>,
        /// Horizontal wheel notches; positive scrolls content right (max ±20).
        #[serde(default)]
        delta_x: i32,
        /// Vertical wheel notches; positive scrolls content down (max ±20).
        #[serde(default)]
        delta_y: i32,
        /// Display id from `list_displays`; omit for the primary display.
        display_id: Option<u32>,
    }

    #[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
    struct TypeParams {
        /// Text to type at the current focus, Unicode included (max 4096 chars).
        text: String,
        /// Display id used for the follow-up screenshot; omit for primary.
        display_id: Option<u32>,
    }

    #[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
    struct KeyParams {
        /// Key or chord: "enter", "tab", "esc", "f5", or modifiers joined
        /// with '+', e.g. "cmd+c", "ctrl+shift+t".
        key: String,
        /// Display id used for the follow-up screenshot; omit for primary.
        display_id: Option<u32>,
    }

    #[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
    struct WaitParams {
        /// Milliseconds to wait (max 10000).
        ms: u64,
    }
    #[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
    struct ElementRefParams {
        /// state_id from get_app_state (e.g. "s3"); a stale id is refused.
        state: String,
        /// Element ref from the tree — the number in brackets, e.g. [4].
        #[serde(rename = "ref")]
        ref_id: usize,
    }

    #[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
    struct SetValueParams {
        /// state_id from get_app_state (e.g. "s3"); a stale id is refused.
        state: String,
        /// Element ref from the tree — the number in brackets, e.g. [4].
        #[serde(rename = "ref")]
        ref_id: usize,
        /// The value to write into the field.
        value: String,
    }
    /// One step of a `sequence` call. Coordinates are screenshot pixels,
    /// same as the single-action tools.
    #[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
    #[serde(tag = "type", rename_all = "snake_case")]
    pub(crate) enum SequenceAction {
        /// Left-click at (x, y).
        LeftClick { x: f64, y: f64 },
        /// Right-click at (x, y).
        RightClick { x: f64, y: f64 },
        /// Double-click at (x, y).
        DoubleClick { x: f64, y: f64 },
        /// Move the cursor to (x, y).
        MouseMove { x: f64, y: f64 },
        /// Drag from one point to another.
        Drag {
            from_x: f64,
            from_y: f64,
            to_x: f64,
            to_y: f64,
        },
        /// Scroll at the current position; positive delta_y scrolls down.
        Scroll { delta_x: i32, delta_y: i32 },
        /// Type text at the current focus.
        Type { text: String },
        /// Press a key or chord, e.g. "enter", "cmd+v".
        Key { key: String },
        /// Wait for the UI to settle (max 10000 ms).
        Wait { ms: u64 },
    }

    #[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
    struct SequenceParams {
        /// Actions to execute in order (max 32). Stops at the first
        /// failure and reports which step failed.
        actions: Vec<SequenceAction>,
        /// Attach a screenshot after the last action (default true). Set
        /// false when the model already knows the expected end state and
        /// wants to skip the extra image.
        screenshot_after: Option<bool>,
        /// Display id from `list_displays`; omit for the primary display.
        display_id: Option<u32>,
    }

    /// Run one batch step; reuses the single-action implementations so
    /// validation and error text stay identical.
    pub(crate) fn run_sequence_step(
        action: &SequenceAction,
        display_id: Option<u32>,
    ) -> Result<String, String> {
        match action {
            SequenceAction::LeftClick { x, y } => {
                action_click(Button::Left, "Left", Some(*x), Some(*y), 1, display_id)
            }
            SequenceAction::RightClick { x, y } => {
                action_click(Button::Right, "Right", Some(*x), Some(*y), 1, display_id)
            }
            SequenceAction::DoubleClick { x, y } => {
                action_click(Button::Left, "Double", Some(*x), Some(*y), 2, display_id)
            }
            SequenceAction::MouseMove { x, y } => action_move(*x, *y, display_id),
            SequenceAction::Drag {
                from_x,
                from_y,
                to_x,
                to_y,
            } => action_drag(*from_x, *from_y, *to_x, *to_y, display_id),
            SequenceAction::Scroll { delta_x, delta_y } => {
                action_scroll(None, None, *delta_x, *delta_y, display_id)
            }
            SequenceAction::Type { text } => action_type(text),
            SequenceAction::Key { key } => action_key(key),
            SequenceAction::Wait { ms } => {
                let ms = (*ms).min(10_000);
                std::thread::sleep(Duration::from_millis(ms));
                Ok(format!("Waited {ms} ms."))
            }
        }
    }

    #[derive(Clone, Default)]
    struct ComputerUseServer;

    #[tool_router]
    impl ComputerUseServer {
        #[tool(
            description = "Capture a screenshot of a display. Returns a JPEG image; every coordinate used by the other tools is in this image's pixels."
        )]
        fn screenshot(
            &self,
            Parameters(params): Parameters<ScreenshotParams>,
        ) -> Result<CallToolResult, McpError> {
            require_screen_recording().map_err(tool_error)?;
            let frame = capture_frame(params.display_id).map_err(tool_error)?;
            Ok(CallToolResult::success(vec![
                ContentBlock::image(frame.jpeg_b64, "image/jpeg"),
                ContentBlock::text(format!(
                    "Screenshot of display '{}' ({}×{} px image; {}×{} physical px, scale {}).",
                    frame.display.name,
                    frame.width,
                    frame.height,
                    frame.display.width,
                    frame.display.height,
                    frame.display.scale
                )),
            ]))
        }

        #[tool(description = "List connected displays with their ids, sizes and scale factors.")]
        fn list_displays(&self) -> Result<CallToolResult, McpError> {
            let monitors = Monitor::all().map_err(|e| tool_error(format!("list monitors: {e}")))?;
            let infos: Vec<DisplayInfo> = monitors.iter().map(display_info_of).collect();
            let text =
                serde_json::to_string_pretty(&infos).map_err(|e| tool_error(e.to_string()))?;
            Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
        }

        #[tool(description = "Move the mouse cursor to a point, in screenshot pixels.")]
        fn mouse_move(
            &self,
            Parameters(params): Parameters<PointParams>,
        ) -> Result<CallToolResult, McpError> {
            let message = action_move(params.x, params.y, params.display_id).map_err(tool_error)?;
            Ok(CallToolResult::success(vec![ContentBlock::text(message)]))
        }

        #[tool(
            description = "Left-click at a point (screenshot pixels), or at the current cursor position when x/y are omitted."
        )]
        fn left_click(
            &self,
            Parameters(params): Parameters<OptionalPointParams>,
        ) -> Result<CallToolResult, McpError> {
            let message = action_click(
                Button::Left,
                "Left",
                params.x,
                params.y,
                1,
                params.display_id,
            )
            .map_err(tool_error)?;
            action_result(message, params.display_id)
        }

        #[tool(
            description = "Right-click at a point (screenshot pixels), or at the current cursor position when x/y are omitted."
        )]
        fn right_click(
            &self,
            Parameters(params): Parameters<OptionalPointParams>,
        ) -> Result<CallToolResult, McpError> {
            let message = action_click(
                Button::Right,
                "Right",
                params.x,
                params.y,
                1,
                params.display_id,
            )
            .map_err(tool_error)?;
            action_result(message, params.display_id)
        }

        #[tool(
            description = "Middle-click at a point (screenshot pixels), or at the current cursor position when x/y are omitted."
        )]
        fn middle_click(
            &self,
            Parameters(params): Parameters<OptionalPointParams>,
        ) -> Result<CallToolResult, McpError> {
            let message = action_click(
                Button::Middle,
                "Middle",
                params.x,
                params.y,
                1,
                params.display_id,
            )
            .map_err(tool_error)?;
            action_result(message, params.display_id)
        }

        #[tool(
            description = "Double-click at a point (screenshot pixels), or at the current cursor position when x/y are omitted."
        )]
        fn double_click(
            &self,
            Parameters(params): Parameters<OptionalPointParams>,
        ) -> Result<CallToolResult, McpError> {
            let message = action_click(
                Button::Left,
                "Double",
                params.x,
                params.y,
                2,
                params.display_id,
            )
            .map_err(tool_error)?;
            action_result(message, params.display_id)
        }

        #[tool(
            description = "Drag with the left button from one point to another (screenshot pixels)."
        )]
        fn drag(
            &self,
            Parameters(params): Parameters<DragParams>,
        ) -> Result<CallToolResult, McpError> {
            let message = action_drag(
                params.from_x,
                params.from_y,
                params.to_x,
                params.to_y,
                params.display_id,
            )
            .map_err(tool_error)?;
            action_result(message, params.display_id)
        }

        #[tool(
            description = "Scroll the mouse wheel, optionally hovering a point first (screenshot pixels). Positive delta_y scrolls content down."
        )]
        fn scroll(
            &self,
            Parameters(params): Parameters<ScrollParams>,
        ) -> Result<CallToolResult, McpError> {
            let message = action_scroll(
                params.x,
                params.y,
                params.delta_x,
                params.delta_y,
                params.display_id,
            )
            .map_err(tool_error)?;
            action_result(message, params.display_id)
        }

        #[tool(
            description = "Type text at the current keyboard focus. Unicode (e.g. Chinese) is supported; this does not click anything first."
        )]
        fn type_text(
            &self,
            Parameters(params): Parameters<TypeParams>,
        ) -> Result<CallToolResult, McpError> {
            let message = action_type(&params.text).map_err(tool_error)?;
            action_result(message, params.display_id)
        }

        #[tool(
            description = "Press a key or key chord: \"enter\", \"tab\", \"esc\", \"backspace\", \"delete\", arrows, \"f1\"-\"f12\", or combos like \"cmd+c\", \"ctrl+shift+t\", \"alt+tab\"."
        )]
        fn press_key(
            &self,
            Parameters(params): Parameters<KeyParams>,
        ) -> Result<CallToolResult, McpError> {
            let message = action_key(&params.key).map_err(tool_error)?;
            action_result(message, params.display_id)
        }

        #[tool(
            description = "Read the frontmost app's accessibility tree (macOS only): a fast text snapshot of its controls — role, label, position, supported actions — with refs for press_element/set_element_value. MUCH cheaper and faster than a screenshot; try this FIRST for app interactions, and fall back to screenshot when the tree does not cover the target (canvas, custom-drawn UI)."
        )]
        fn get_app_state(&self) -> Result<CallToolResult, McpError> {
            require_accessibility().map_err(tool_error)?;
            let text = crate::computer_use_ax::app_state().map_err(tool_error)?;
            Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
        }

        #[tool(
            description = "Press (click) an accessibility element by ref from get_app_state. Precise and does not depend on pixel coordinates."
        )]
        fn press_element(
            &self,
            Parameters(params): Parameters<ElementRefParams>,
        ) -> Result<CallToolResult, McpError> {
            require_accessibility().map_err(tool_error)?;
            let message =
                crate::computer_use_ax::press(&params.state, params.ref_id).map_err(tool_error)?;
            action_result(message, None)
        }

        #[tool(
            description = "Set the value of a text-field element by ref from get_app_state. Writes the value directly — no focusing click, no typing; better than left_click + type_text whenever the field has a ref."
        )]
        fn set_element_value(
            &self,
            Parameters(params): Parameters<SetValueParams>,
        ) -> Result<CallToolResult, McpError> {
            require_accessibility().map_err(tool_error)?;
            let message =
                crate::computer_use_ax::set_value(&params.state, params.ref_id, &params.value)
                    .map_err(tool_error)?;
            action_result(message, None)
        }

        #[tool(
            description = "Wait for the UI to settle (e.g. after opening an app), then take a fresh screenshot."
        )]
        fn wait(
            &self,
            Parameters(params): Parameters<WaitParams>,
        ) -> Result<CallToolResult, McpError> {
            let ms = params.ms.min(10_000);
            std::thread::sleep(Duration::from_millis(ms));
            action_result(format!("Waited {ms} ms."), None)
        }
        #[tool(
            description = "Execute a batch of actions in one call (clicks, typing, keys, scrolls, drags, waits). Much faster than one tool call per action: the model plans several steps from a single screenshot, and only the final screenshot comes back. Stops at the first failing step."
        )]
        fn sequence(
            &self,
            Parameters(params): Parameters<SequenceParams>,
        ) -> Result<CallToolResult, McpError> {
            require_accessibility().map_err(tool_error)?;
            if params.actions.is_empty() {
                return Err(tool_error("actions must not be empty".into()));
            }
            if params.actions.len() > 32 {
                return Err(tool_error(
                    "too many actions (max 32); split the batch".into(),
                ));
            }
            let mut done = Vec::new();
            for (index, action) in params.actions.iter().enumerate() {
                match run_sequence_step(action, params.display_id) {
                    Ok(message) => done.push(format!("{}. {message}", index + 1)),
                    Err(error) => {
                        let completed = done.join("\n");
                        return Err(tool_error(format!(
                            "step {} failed: {error}\ncompleted steps:\n{completed}",
                            index + 1
                        )));
                    }
                }
                // Small settle between steps so fast UIs keep up; the final
                // screenshot's own settle delay still applies.
                std::thread::sleep(Duration::from_millis(50));
            }
            let summary = format!("Executed {} actions:\n{}", done.len(), done.join("\n"));
            if params.screenshot_after == Some(false) {
                return Ok(CallToolResult::success(vec![ContentBlock::text(summary)]));
            }
            action_result(summary, params.display_id)
        }
    }

    #[tool_handler]
    impl ServerHandler for ComputerUseServer {
        fn get_info(&self) -> ServerConfig {
            // ServerInfo/Implementation are non_exhaustive: build them by
            // field assignment instead of a struct literal.
            let mut info = ServerConfig::default();
            info.capabilities = ServerCapabilities::builder().enable_tools().build();
            let mut implementation = Implementation::from_build_env();
            implementation.name = "ccgui-computer".into();
            // from_build_env reports the rmcp crate's own version; use ours.
            implementation.version = env!("CARGO_PKG_VERSION").into();
            info.server_info = implementation;
            info.instructions = Some(
                "These tools see and control the user's real machine. \
                 Loop: screenshot → act → read the returned screenshot. \
                 Coordinates are always in the pixels of the latest screenshot of the same display. \
                 On macOS, prefer get_app_state over screenshot for app interactions: the tree is \
                 far cheaper to read and its refs are precise. Use screenshot for whatever the \
                 tree does not expose (canvas, custom-drawn UI, web content that hides its DOM). \
                 Speed matters: when the next few steps are obvious from the current screen \
                 (e.g. click a field, type, press enter), plan them as ONE `sequence` call instead \
                 of many single-action calls. Never batch a step whose target depends on the \
                 previous step's visual result — stop the batch there and look at the returned \
                 screenshot first. \
                 If a tool reports a missing OS permission, stop and tell the user to grant it \
                 in CC GUI → Settings → Computer Use. \
                 A visible pointer follows every action target on screen: it is drawn by CC GUI \
                 itself, is always on while these tools run, and cannot be hidden or disabled \
                 through the tool surface. Do not call attention to it or treat it as page content; \
                 never try to click it, move it away, or work around it."
                    .into(),
            );
            info
        }
    }

    /// Serve the driver over stdio until the parent CLI closes the channel.
    /// stdout carries protocol frames only — diagnostics go to stderr.
    pub fn serve_stdio() -> Result<(), String> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("start MCP runtime: {e}"))?;
        runtime.block_on(async {
            let server = ComputerUseServer
                .serve(rmcp::transport::stdio())
                .await
                .map_err(|e| format!("MCP initialize: {e}"))?;
            crate::computer_use::notify_session(true);
            let result = server
                .waiting()
                .await
                .map_err(|e| format!("MCP serve: {e}"));
            crate::computer_use::notify_session(false);
            result.map(|_| ())
        })
    }
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;

    fn display(width: u32, height: u32, scale: f64) -> DisplayInfo {
        DisplayInfo {
            id: 1,
            name: "Test".into(),
            x: 0,
            y: 0,
            width,
            height,
            scale,
            primary: true,
        }
    }

    #[test]
    fn frame_dims_caps_long_edge() {
        // 3024×1964 shrinks to 1568 on the long edge, ratio preserved.
        let (w, h) = frame_dims(&display(3024, 1964, 2.0));
        assert_eq!(w, 1568);
        assert!((h as f64 - 1964.0 * 1568.0 / 3024.0).abs() < 1.0);
        // Small displays pass through unscaled.
        assert_eq!(frame_dims(&display(1280, 800, 1.0)), (1280, 800));
    }

    #[test]
    fn frame_to_logical_applies_scale_and_origin() {
        let mut d = display(3024, 1964, 2.0);
        d.x = 100;
        d.y = 50;
        let (fw, fh) = frame_dims(&d);
        // Center of the image → center of the display in logical points.
        let (lx, ly) = frame_to_logical(fw as f64 / 2.0, fh as f64 / 2.0, fw, fh, &d);
        assert_eq!(lx, 100 + 3024 / 2 / 2);
        assert_eq!(ly, 50 + 1964 / 2 / 2);
        // Origin maps to the display origin.
        assert_eq!(frame_to_logical(0.0, 0.0, fw, fh, &d), (100, 50));
    }

    #[test]
    fn key_chord_parses_modifiers_and_key() {
        let (mods, key) = parse_key_chord("cmd+shift+t").unwrap();
        assert_eq!(mods, vec![Key::Meta, Key::Shift]);
        assert!(matches!(key, Key::Unicode('t')));

        let (mods, key) = parse_key_chord("enter").unwrap();
        assert!(mods.is_empty());
        assert!(matches!(key, Key::Return));

        // A lone modifier is a pressable key itself.
        let (mods, key) = parse_key_chord("alt").unwrap();
        assert!(mods.is_empty());
        assert!(matches!(key, Key::Alt));
    }

    #[test]
    fn key_chord_rejects_garbage() {
        assert!(parse_key_chord("").is_err());
        assert!(parse_key_chord("c+cmd").is_err());
        assert!(parse_key_chord("cmd+nosuchkey").is_err());
    }
    #[test]
    fn sequence_action_deserializes_tagged_batch() {
        let batch: Vec<serde_json::Value> = serde_json::from_str(
            r#"[
                {"type":"left_click","x":100.0,"y":200.0},
                {"type":"type","text":"你好"},
                {"type":"key","key":"cmd+enter"},
                {"type":"wait","ms":300},
                {"type":"drag","from_x":1.0,"from_y":2.0,"to_x":3.0,"to_y":4.0}
            ]"#,
        )
        .unwrap();
        let actions: Vec<mcp::SequenceAction> = batch
            .into_iter()
            .map(serde_json::from_value)
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(actions.len(), 5);
        // 未知动作类型在参数校验阶段就被拒绝。
        assert!(serde_json::from_value::<mcp::SequenceAction>(
            serde_json::json!({"type":"explode","x":1.0,"y":2.0})
        )
        .is_err());
        // Wait 步不需要任何 OS 权限,可真实执行。
        assert!(mcp::run_sequence_step(&mcp::SequenceAction::Wait { ms: 1 }, None).is_ok());
    }
    // ---- omp MCP injection ----

    fn steer_home(tag: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!("ccgui-cu-home-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        std::env::set_var("HOME", &home);
        home
    }

    fn temp_workspace(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccgui-cu-ws-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn mcp_json(workspace: &Path) -> serde_json::Value {
        serde_json::from_str(
            &std::fs::read_to_string(workspace.join(".omp").join("mcp.json")).unwrap(),
        )
        .unwrap()
    }

    /// 测试用的驱动 spec：不看本机 exe，只验证注入/恢复的账。
    fn test_spec() -> McpServerSpec {
        McpServerSpec {
            name: MCP_SERVER_NAME.to_string(),
            command: "/tmp/ccgui-test".to_string(),
            args: vec!["--computer-use-mcp".to_string()],
            env: Vec::new(),
        }
    }

    fn memory_spec() -> McpServerSpec {
        McpServerSpec {
            name: crate::memory::mcp::SERVER_NAME.to_string(),
            command: "/tmp/ccgui-test".to_string(),
            args: vec!["--memory-mcp".to_string()],
            env: Vec::new(),
        }
    }

    #[test]
    fn inject_creates_then_restore_deletes_workspace_file() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        steer_home("create");
        let ws = temp_workspace("create");
        let restore = inject_workspace_mcp(&ws, &[test_spec()])
            .unwrap()
            .expect("must inject");
        let doc = mcp_json(&ws);
        let server = &doc["mcpServers"][MCP_SERVER_NAME];
        assert_eq!(server["type"], "stdio");
        assert_eq!(server["args"], serde_json::json!(["--computer-use-mcp"]));
        restore.restore();
        assert!(!ws.join(".omp").join("mcp.json").exists());
        assert!(journal_read().is_empty());
    }

    #[test]
    fn inject_merges_and_restore_preserves_user_servers() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        steer_home("merge");
        let ws = temp_workspace("merge");
        std::fs::create_dir_all(ws.join(".omp")).unwrap();
        std::fs::write(
            ws.join(".omp").join("mcp.json"),
            r#"{"mcpServers":{"mine":{"type":"stdio","command":"user-tool"}}}"#,
        )
        .unwrap();
        let restore = inject_workspace_mcp(&ws, &[test_spec()])
            .unwrap()
            .expect("must inject");
        let doc = mcp_json(&ws);
        assert!(doc["mcpServers"].get("mine").is_some());
        assert!(doc["mcpServers"].get(MCP_SERVER_NAME).is_some());
        restore.restore();
        let doc = mcp_json(&ws);
        assert!(doc["mcpServers"].get("mine").is_some());
        assert!(doc["mcpServers"].get(MCP_SERVER_NAME).is_none());
    }

    #[test]
    fn user_defined_server_entry_wins_untouched() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        steer_home("win");
        let ws = temp_workspace("win");
        std::fs::create_dir_all(ws.join(".omp")).unwrap();
        let original = r#"{"mcpServers":{"ccgui-computer":{"type":"stdio","command":"mine"}}}"#;
        std::fs::write(ws.join(".omp").join("mcp.json"), original).unwrap();
        assert!(inject_workspace_mcp(&ws, &[test_spec()]).unwrap().is_none());
        assert_eq!(
            std::fs::read_to_string(ws.join(".omp").join("mcp.json")).unwrap(),
            original
        );
        assert!(journal_read().is_empty());
    }

    #[test]
    fn concurrent_runs_share_one_injection_by_refcount() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        steer_home("shared");
        let ws = temp_workspace("shared");
        let first = inject_workspace_mcp(&ws, &[test_spec()]).unwrap().unwrap();
        let second = inject_workspace_mcp(&ws, &[test_spec()]).unwrap().unwrap();
        // 两次注入只写一次文件、只留一条记录。
        assert_eq!(journal_read().len(), 1);
        first.restore();
        assert!(mcp_json(&ws)["mcpServers"].get(MCP_SERVER_NAME).is_some());
        second.restore();
        assert!(!ws.join(".omp").join("mcp.json").exists());
        assert!(journal_read().is_empty());
    }

    #[test]
    fn sweep_restores_crash_leftovers() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        steer_home("sweep");
        let ws = temp_workspace("sweep");
        let _restore = inject_workspace_mcp(&ws, &[test_spec()]).unwrap().unwrap();
        // 模拟崩溃:不 restore 直接扫尾。
        sweep_mcp_injections();
        assert!(!ws.join(".omp").join("mcp.json").exists());
        assert!(journal_read().is_empty());
    }

    #[test]
    fn two_tools_share_one_file_and_restore_independently() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        steer_home("two-tools");
        let ws = temp_workspace("two-tools");
        // 两个工具先后注入同一工作区文件：两个条目、两条记录，各自持有。
        let computer = inject_workspace_mcp(&ws, &[test_spec()]).unwrap().unwrap();
        let memory = inject_workspace_mcp(&ws, &[memory_spec()]).unwrap().unwrap();
        let doc = mcp_json(&ws);
        assert!(doc["mcpServers"].get(MCP_SERVER_NAME).is_some());
        assert!(doc["mcpServers"]
            .get(crate::memory::mcp::SERVER_NAME)
            .is_some());
        assert_eq!(journal_read().len(), 2);
        // 只恢复记忆那一个：文件还在，电脑操控条目不动。
        memory.restore();
        let doc = mcp_json(&ws);
        assert!(doc["mcpServers"].get(MCP_SERVER_NAME).is_some());
        assert!(doc["mcpServers"]
            .get(crate::memory::mcp::SERVER_NAME)
            .is_none());
        computer.restore();
        assert!(!ws.join(".omp").join("mcp.json").exists());
        assert!(journal_read().is_empty());
    }

    #[test]
    fn same_tool_twice_counts_as_one_entry() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        steer_home("two-runs");
        let ws = temp_workspace("two-runs");
        // 同一次运行同时挂电脑操控与记忆：一个文件两个条目、两条记录。
        let both = inject_workspace_mcp(&ws, &[test_spec(), memory_spec()])
            .unwrap()
            .expect("must inject");
        assert_eq!(journal_read().len(), 2);
        both.restore();
        assert!(!ws.join(".omp").join("mcp.json").exists());
        assert!(journal_read().is_empty());
    }
}
