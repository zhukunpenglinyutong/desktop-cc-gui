//! The screenshot/input driver shared by the MCP tools (mcp.rs): display
//! enumeration and capture (xcap), mouse/keyboard injection (enigo), and the
//! overlay control client that tells the main app where each action lands.
//!
//! Fail-closed: every screenshot requires Screen Recording, every input
//! action requires Accessibility, and a missing grant returns an error that
//! tells the model to send the user to Settings → Computer Use.

use std::io::Cursor;
use std::time::Duration;

use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use serde::Serialize;
use xcap::Monitor;

// ==================== OS permission preflight ====================

// Same TCC preflight the main app reports in Settings → Computer Use
// (computer_use.rs there). Grants follow the responsible process — the
// CC GUI app that launched the engine CLI that spawned this helper.
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

fn accessibility_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { tcc::AXIsProcessTrusted() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

pub(crate) fn screen_recording_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { tcc::CGPreflightScreenCaptureAccess() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

pub(crate) fn require_accessibility() -> Result<(), String> {
    if accessibility_granted() {
        Ok(())
    } else {
        Err("Accessibility permission is not granted to this app. Tell the user to enable it in CC GUI → Settings → Computer Use.".into())
    }
}

pub(crate) fn require_screen_recording() -> Result<(), String> {
    if screen_recording_granted() {
        Ok(())
    } else {
        Err("Screen Recording permission is not granted to this app. Tell the user to enable it in CC GUI → Settings → Computer Use.".into())
    }
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

pub(crate) fn display_info_of(monitor: &Monitor) -> DisplayInfo {
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

pub(crate) fn capture_frame(display_id: Option<u32>) -> Result<CapturedFrame, String> {
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

pub(crate) fn action_move(x: f64, y: f64, display_id: Option<u32>) -> Result<String, String> {
    require_accessibility()?;
    let (lx, ly) = logical_point(x, y, display_id)?;
    new_enigo()?
        .move_mouse(lx, ly, Coordinate::Abs)
        .map_err(|e| format!("move mouse: {e}"))?;
    Ok(format!("Mouse moved to ({lx}, {ly})."))
}

pub(crate) fn action_click(
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

pub(crate) fn action_drag(
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

pub(crate) fn action_scroll(
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

pub(crate) fn action_type(text: &str) -> Result<String, String> {
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

pub(crate) fn action_key(chord: &str) -> Result<String, String> {
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
}
