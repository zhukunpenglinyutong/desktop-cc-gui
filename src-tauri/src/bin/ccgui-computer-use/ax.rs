//! Accessibility-tree state for computer use (macOS): a text snapshot of the
//! frontmost app's controls — role, label, frame, supported actions — with
//! stable refs the model can press or fill directly. For a large class of
//! tasks this replaces the screenshot round-trip entirely: the tree is a few
//! KB of text instead of a vision token payload, and the model reads it far
//! faster.
//!
//! Pure FFI over ApplicationServices (AX) and CoreFoundation; no extra
//! crates. Everything is a no-op error on other platforms — the MCP tools
//! stay registered everywhere and report the platform limit honestly.

// Everything but the error stubs is macOS FFI.
#[cfg(target_os = "macos")]
use std::ffi::{c_void, CString};
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(target_os = "macos")]
use parking_lot::Mutex;

// ==================== CF / AX FFI ====================

#[cfg(target_os = "macos")]
#[allow(non_snake_case, non_camel_case_types)]
mod ffi {
    use super::*;

    pub type CFTypeRef = *const c_void;
    pub type CFStringRef = *const c_void;
    pub type CFArrayRef = *const c_void;
    pub type AXUIElementRef = *mut c_void;
    pub type AXValueRef = *const c_void;
    pub type AXError = i32;
    pub const AX_SUCCESS: AXError = 0;
    pub const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    pub const AX_VALUE_TYPE_CGPOINT: u32 = 1;
    pub const AX_VALUE_TYPE_CGSIZE: u32 = 2;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct CGPoint {
        pub x: f64,
        pub y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct CGSize {
        pub width: f64,
        pub height: f64,
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub fn CFStringCreateWithCString(
            alloc: *const c_void,
            cstr: *const std::ffi::c_char,
            encoding: u32,
        ) -> CFStringRef;
        pub fn CFStringGetCStringPtr(string: CFStringRef, encoding: u32)
            -> *const std::ffi::c_char;
        pub fn CFStringGetCString(
            string: CFStringRef,
            buffer: *mut std::ffi::c_char,
            buffer_size: isize,
            encoding: u32,
        ) -> bool;
        pub fn CFArrayGetCount(array: CFArrayRef) -> isize;
        pub fn CFArrayGetValueAtIndex(array: CFArrayRef, index: isize) -> *const c_void;
        pub fn CFBooleanGetValue(boolean: CFTypeRef) -> bool;
        pub fn CFRetain(value: CFTypeRef) -> CFTypeRef;
        pub fn CFRelease(value: CFTypeRef);
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        pub fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        pub fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        pub fn AXUIElementSetAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: CFTypeRef,
        ) -> AXError;
        pub fn AXUIElementPerformAction(element: AXUIElementRef, action: CFStringRef) -> AXError;
        pub fn AXUIElementGetPid(element: AXUIElementRef, pid: *mut i32) -> AXError;
        pub fn AXValueGetValue(value: AXValueRef, value_type: u32, out: *mut c_void) -> bool;
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::ffi::*;
    use super::*;

    /// A retained AX element handle. Send/Sync is safe here: the handles are
    /// only touched from the MCP server's single-threaded runtime, and CF
    /// ref-counting is atomic.
    struct RawElement(AXUIElementRef);
    unsafe impl Send for RawElement {}
    unsafe impl Sync for RawElement {}
    impl Drop for RawElement {
        fn drop(&mut self) {
            unsafe { CFRelease(self.0 as CFTypeRef) }
        }
    }

    pub struct AxNode {
        element: RawElement,
        actions: &'static [&'static str],
    }

    pub struct AxState {
        pub id: String,
        nodes: Vec<AxNode>,
    }

    static CURRENT: Mutex<Option<AxState>> = Mutex::new(None);
    static STATE_SEQ: AtomicU64 = AtomicU64::new(0);

    fn cfstring(text: &str) -> CFStringRef {
        let cstr = CString::new(text).unwrap_or_else(|_| CString::new("").unwrap());
        unsafe {
            CFStringCreateWithCString(std::ptr::null(), cstr.as_ptr(), K_CF_STRING_ENCODING_UTF8)
        }
    }

    fn release(value: CFTypeRef) {
        if !value.is_null() {
            unsafe { CFRelease(value) }
        }
    }

    /// Same as copy_attr but keeps the AXError so callers can tell "no such
    /// attribute" apart from "the API is not available to this process".
    fn copy_attr_result(element: AXUIElementRef, name: &str) -> Result<CFTypeRef, AXError> {
        let attr = cfstring(name);
        let mut value: CFTypeRef = std::ptr::null();
        let status = unsafe { AXUIElementCopyAttributeValue(element, attr, &mut value) };
        release(attr as CFTypeRef);
        if status != AX_SUCCESS {
            if std::env::var_os("CCGUI_AX_DEBUG").is_some() {
                eprintln!("[ax] copy_attr {name} failed: AXError {status}");
            }
            return Err(status);
        }
        Ok(value)
    }

    /// kAXErrorAPIDisabled: AXIsProcessTrusted can answer for a stale or
    /// parent identity while real AX calls are still refused — this is the
    /// check that cannot lie.
    const AX_ERROR_API_DISABLED: AXError = -25204;

    /// Copy an attribute; caller releases. Returns null on any error.
    fn copy_attr(element: AXUIElementRef, name: &str) -> CFTypeRef {
        copy_attr_result(element, name).unwrap_or(std::ptr::null())
    }

    fn string_attr(element: AXUIElementRef, name: &str) -> Option<String> {
        let value = copy_attr(element, name);
        if value.is_null() {
            return None;
        }
        let text = unsafe {
            let ptr = CFStringGetCStringPtr(value as CFStringRef, K_CF_STRING_ENCODING_UTF8);
            if !ptr.is_null() {
                Some(std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned())
            } else {
                let mut buffer = vec![0i8; 1024];
                if CFStringGetCString(
                    value as CFStringRef,
                    buffer.as_mut_ptr(),
                    buffer.len() as isize,
                    K_CF_STRING_ENCODING_UTF8,
                ) {
                    Some(
                        std::ffi::CStr::from_ptr(buffer.as_ptr())
                            .to_string_lossy()
                            .into_owned(),
                    )
                } else {
                    None
                }
            }
        };
        release(value);
        let text = text?.trim().to_string();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }

    fn bool_attr(element: AXUIElementRef, name: &str) -> bool {
        let value = copy_attr(element, name);
        if value.is_null() {
            return false;
        }
        let result = unsafe { CFBooleanGetValue(value) };
        release(value);
        result
    }

    fn point_attr(element: AXUIElementRef, name: &str) -> Option<(f64, f64)> {
        let value = copy_attr(element, name);
        if value.is_null() {
            return None;
        }
        let mut point = CGPoint::default();
        let ok = unsafe {
            AXValueGetValue(
                value as AXValueRef,
                AX_VALUE_TYPE_CGPOINT,
                &mut point as *mut CGPoint as *mut c_void,
            )
        };
        release(value);
        ok.then_some((point.x, point.y))
    }

    fn size_attr(element: AXUIElementRef, name: &str) -> Option<(f64, f64)> {
        let value = copy_attr(element, name);
        if value.is_null() {
            return None;
        }
        let mut size = CGSize::default();
        let ok = unsafe {
            AXValueGetValue(
                value as AXValueRef,
                AX_VALUE_TYPE_CGSIZE,
                &mut size as *mut CGSize as *mut c_void,
            )
        };
        release(value);
        ok.then_some((size.width, size.height))
    }

    fn children(element: AXUIElementRef) -> Vec<AXUIElementRef> {
        let array = copy_attr(element, "AXChildren");
        if array.is_null() {
            return Vec::new();
        }
        let count = unsafe { CFArrayGetCount(array as CFArrayRef) };
        let mut out = Vec::with_capacity(count.min(64) as usize);
        for index in 0..count {
            let child = unsafe { CFArrayGetValueAtIndex(array as CFArrayRef, index) };
            if !child.is_null() {
                out.push(child as AXUIElementRef);
            }
        }
        release(array);
        out
    }

    /// Element categories worth a ref. Everything else is still walked but
    /// contributes no line — grouping containers are noise to the model.
    fn actions_for(role: &str) -> Option<&'static [&'static str]> {
        match role {
            "AXButton" | "AXCheckBox" | "AXRadioButton" | "AXMenuItem" | "AXLink"
            | "AXPopUpButton" | "AXTab" | "AXSwitch" => Some(&["press"]),
            "AXTextField" | "AXTextArea" | "AXComboBox" => Some(&["set_value", "press"]),
            "AXSlider" | "AXStepper" => Some(&["set_value"]),
            "AXStaticText" => Some(&[]),
            _ => None,
        }
    }

    fn display_role(role: &str) -> &str {
        role.strip_prefix("AX").unwrap_or(role)
    }

    struct Walk<'a> {
        lines: Vec<String>,
        nodes: &'a mut Vec<AxNode>,
        /// Hard caps so a pathological tree (browser DOMs expose thousands
        /// of nodes) stays a fast, small read.
        budget: usize,
    }

    impl Walk<'_> {
        fn visit(&mut self, element: AXUIElementRef, depth: usize) {
            if self.nodes.len() + self.lines.len() >= self.budget || depth > 14 {
                return;
            }
            let Some(role) = string_attr(element, "AXRole") else {
                return;
            };
            if let Some(actions) = actions_for(&role) {
                if role == "AXStaticText" && string_attr(element, "AXValue").is_none() {
                    // Empty labels are pure layout noise.
                } else if bool_attr(element, "AXEnabled") || actions.is_empty() {
                    let title = string_attr(element, "AXTitle")
                        .or_else(|| string_attr(element, "AXDescription"))
                        .unwrap_or_default();
                    let value = string_attr(element, "AXValue").unwrap_or_default();
                    let (x, y) = point_attr(element, "AXPosition").unwrap_or((0.0, 0.0));
                    let (w, h) = size_attr(element, "AXSize").unwrap_or((0.0, 0.0));
                    let ref_id = self.nodes.len();
                    let mut line = format!(
                        "[{ref_id}] {} \"{title}\" @({x:.0},{y:.0}) {w:.0}x{h:.0}",
                        display_role(&role),
                    );
                    if !value.is_empty() && value != title {
                        line.push_str(&format!(" value=\"{value}\""));
                    }
                    if !actions.is_empty() {
                        line.push_str(&format!("  [{}]", actions.join(", ")));
                    }
                    // Retain a handle for press/set_value resolution.
                    unsafe { CFRetain(element as CFTypeRef) };
                    self.nodes.push(AxNode {
                        element: RawElement(element),
                        actions,
                    });
                    self.lines.push(line);
                }
            }
            for child in children(element) {
                self.visit(child, depth + 1);
            }
        }
    }

    fn focused_app_element() -> Result<(AXUIElementRef, i32), String> {
        let system = unsafe { AXUIElementCreateSystemWide() };
        if system.is_null() {
            return Err("AX system-wide element unavailable".into());
        }
        let app = match copy_attr_result(system, "AXFocusedApplication") {
            Ok(app) => app,
            Err(AX_ERROR_API_DISABLED) => {
                release(system as CFTypeRef);
                return Err(
                    "Accessibility API is disabled for this app (AXIsProcessTrusted may report a stale parent grant). Grant Accessibility to CC GUI in Settings → Computer Use."
                        .into(),
                );
            }
            Err(_) => {
                release(system as CFTypeRef);
                return Err("no focused application".into());
            }
        };
        release(system as CFTypeRef);
        let mut pid: i32 = 0;
        let status = unsafe { AXUIElementGetPid(app as AXUIElementRef, &mut pid) };
        if status != AX_SUCCESS {
            release(app);
            return Err("cannot resolve focused application pid".into());
        }
        Ok((app as AXUIElementRef, pid))
    }

    pub fn app_state() -> Result<String, String> {
        let (app, _pid) = focused_app_element()?;
        let app_name = string_attr(app, "AXTitle").unwrap_or_else(|| "unknown app".into());
        // Scope to the front window when the app exposes one; the whole app
        // tree otherwise (menu bar extras have no windows at all).
        let root = {
            let windows = copy_attr(app, "AXWindows");
            if windows.is_null() || unsafe { CFArrayGetCount(windows as CFArrayRef) } == 0 {
                app
            } else {
                let window = unsafe { CFArrayGetValueAtIndex(windows as CFArrayRef, 0) };
                release(windows);
                window as AXUIElementRef
            }
        };
        let window_title = if root == app {
            None
        } else {
            string_attr(root, "AXTitle")
        };
        let mut nodes: Vec<AxNode> = Vec::new();
        let mut walk = Walk {
            lines: Vec::new(),
            nodes: &mut nodes,
            budget: 400,
        };
        walk.visit(root, 0);
        let seq = STATE_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
        let id = format!("s{seq}");
        let mut text = format!("state_id: {id}\n{app_name}");
        if let Some(title) = window_title {
            text.push_str(&format!(" — \"{title}\""));
        }
        text.push_str(&format!(" — {} elements\n", walk.lines.len()));
        if walk.lines.is_empty() {
            text.push_str("(no actionable elements exposed — fall back to screenshot)\n");
        } else {
            text.push_str(&walk.lines.join("\n"));
            text.push('\n');
        }
        text.push_str(
            "Pass state_id back with refs; a ref from an older state is refused. \
             Prefer press/set_value over pixel clicks when the target has a ref.",
        );
        *CURRENT.lock() = Some(AxState {
            id: id.clone(),
            nodes,
        });
        // The front window element was borrowed from AXWindows / is the app
        // itself; only the app handle (a Copy) needs releasing.
        release(app as CFTypeRef);
        Ok(text)
    }

    fn resolve(
        state_id: &str,
        ref_id: usize,
    ) -> Result<(AXUIElementRef, &'static [&'static str]), String> {
        let guard = CURRENT.lock();
        let state = guard
            .as_ref()
            .ok_or_else(|| "no accessibility state yet: call get_app_state first".to_string())?;
        if state.id != state_id {
            return Err(format!(
                "stale state '{state_id}' (current '{}'): call get_app_state again — the UI changed",
                state.id
            ));
        }
        let node = state
            .nodes
            .get(ref_id)
            .ok_or_else(|| format!("no element [{ref_id}] in state '{state_id}'"))?;
        Ok((node.element.0, node.actions))
    }

    pub fn press(state_id: &str, ref_id: usize) -> Result<String, String> {
        let (element, actions) = resolve(state_id, ref_id)?;
        if !actions.contains(&"press") {
            return Err(format!(
                "element [{ref_id}] does not support press (supports: {})",
                actions.join(", ")
            ));
        }
        let (cx, cy) = match (
            point_attr(element, "AXPosition"),
            size_attr(element, "AXSize"),
        ) {
            (Some((x, y)), Some((w, h))) => (x + w / 2.0, y + h / 2.0),
            _ => (0.0, 0.0),
        };
        let action = cfstring("AXPress");
        let status = unsafe { AXUIElementPerformAction(element, action) };
        release(action as CFTypeRef);
        if status != AX_SUCCESS {
            return Err(format!(
                "AXPress failed (error {status}); fall back to a pixel click"
            ));
        }
        crate::driver::notify_cursor(cx as i32, cy as i32);
        Ok(format!(
            "Pressed element [{ref_id}] (center {cx:.0},{cy:.0})."
        ))
    }

    pub fn set_value(state_id: &str, ref_id: usize, value: &str) -> Result<String, String> {
        let (element, actions) = resolve(state_id, ref_id)?;
        if !actions.contains(&"set_value") {
            return Err(format!(
                "element [{ref_id}] does not support set_value (supports: {})",
                actions.join(", ")
            ));
        }
        let attr = cfstring("AXValue");
        let cf_value = cfstring(value);
        let status = unsafe { AXUIElementSetAttributeValue(element, attr, cf_value as CFTypeRef) };
        release(attr as CFTypeRef);
        release(cf_value as CFTypeRef);
        if status != AX_SUCCESS {
            return Err(format!(
                "set_value failed (error {status}); fall back to click + type_text"
            ));
        }
        Ok(format!(
            "Set element [{ref_id}] value ({} chars).",
            value.chars().count()
        ))
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    fn unsupported() -> String {
        "accessibility-tree state is macOS-only; use screenshot + pixel actions on this platform"
            .into()
    }
    pub fn app_state() -> Result<String, String> {
        Err(unsupported())
    }
    pub fn press(_state_id: &str, _ref_id: usize) -> Result<String, String> {
        Err(unsupported())
    }
    pub fn set_value(_state_id: &str, _ref_id: usize, _value: &str) -> Result<String, String> {
        Err(unsupported())
    }
}

pub use imp::{app_state, press, set_value};

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    /// Live smoke against whatever app is focused; needs Accessibility.
    /// Ignored by default: environment-dependent, run manually with
    /// `cargo test -- --ignored ax_tree_smoke`.
    #[test]
    #[ignore]
    fn ax_tree_smoke() {
        let text = app_state().expect("app_state");
        assert!(text.contains("state_id: s"));
        println!("{text}");
    }
}
