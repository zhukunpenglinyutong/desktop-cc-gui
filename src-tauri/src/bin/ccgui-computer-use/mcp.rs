//! The stdio MCP server engine CLIs spawn as a child; the model drives the
//! machine through its tools. Tool names and schemas are our own; the action
//! vocabulary follows the de-facto computer-use convention (screenshot pixels
//! as the coordinate space).

use std::time::Duration;

use enigo::Button;
use xcap::Monitor;

use crate::driver::{
    action_click, action_drag, action_key, action_move, action_scroll, action_type,
    capture_frame, display_info_of, require_accessibility, require_screen_recording,
    screen_recording_granted, DisplayInfo,
};
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
        let text = crate::ax::app_state().map_err(tool_error)?;
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
            crate::ax::press(&params.state, params.ref_id).map_err(tool_error)?;
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
            crate::ax::set_value(&params.state, params.ref_id, &params.value)
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
        crate::driver::notify_session(true);
        let result = server
            .waiting()
            .await
            .map_err(|e| format!("MCP serve: {e}"));
        crate::driver::notify_session(false);
        result.map(|_| ())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let actions: Vec<SequenceAction> = batch
            .into_iter()
            .map(serde_json::from_value)
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(actions.len(), 5);
        // 未知动作类型在参数校验阶段就被拒绝。
        assert!(serde_json::from_value::<SequenceAction>(
            serde_json::json!({"type":"explode","x":1.0,"y":2.0})
        )
        .is_err());
        // Wait 步不需要任何 OS 权限,可真实执行。
        assert!(run_sequence_step(&SequenceAction::Wait { ms: 1 }, None).is_ok());
    }
}
