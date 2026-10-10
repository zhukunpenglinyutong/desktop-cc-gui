//! OS clipboard file lists.
//!
//! Copying files in Finder / Explorer puts file references on the clipboard,
//! but a paste into the webview only surfaces opaque `File` blobs — the
//! absolute paths never reach JavaScript. The chat composer asks the host
//! after such a paste so copied files route exactly like dropped ones
//! (`@path` mentions for files, the attachment pipeline for images).

/// Absolute paths of the files on the general clipboard, in pasteboard
/// order. Empty when the clipboard holds no file (plain text, a screenshot's
/// raw bytes, an image editor's internal data, ...).
///
/// Runs on the command's thread; Tauri executes synchronous commands on the
/// main thread, which is what the AppKit pasteboard wants.
#[tauri::command]
pub fn clipboard_file_paths() -> Vec<String> {
    platform::file_paths()
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2::ClassType;
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSArray, NSURL};

    pub(super) fn file_paths() -> Vec<String> {
        let pasteboard = NSPasteboard::generalPasteboard();
        read_file_urls(&pasteboard)
    }

    /// File URLs on `pasteboard`, as absolute paths. Non-file URLs (a copied
    /// link sits on the same class) and promised items with no path drop out.
    pub(super) fn read_file_urls(pasteboard: &NSPasteboard) -> Vec<String> {
        let classes = NSArray::from_slice(&[NSURL::class()]);
        // SAFETY: `classes` holds Objective-C classes; `None` asks for the
        // default options, whose typed `Option<&NSDictionary<..>>` slot only
        // exists to describe the default.
        let objects = unsafe { pasteboard.readObjectsForClasses_options(&classes, None) };
        let Some(objects) = objects else {
            return Vec::new();
        };
        let mut paths = Vec::new();
        for object in objects.iter() {
            let Some(url) = object.downcast_ref::<NSURL>() else {
                continue;
            };
            if !url.isFileURL() {
                continue;
            }
            let Some(path) = url.path() else {
                continue;
            };
            let path = path.to_string();
            if !path.is_empty() {
                paths.push(path);
            }
        }
        paths
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows::Win32::System::Ole::CF_HDROP;
    use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

    pub(super) fn file_paths() -> Vec<String> {
        // SAFETY: the clipboard is opened for the shortest possible window
        // and closed on every path; a concurrent owner just means this read
        // returns nothing instead of blocking.
        unsafe {
            if OpenClipboard(None).is_err() {
                return Vec::new();
            }
            let paths = read_hdrop();
            let _ = CloseClipboard();
            paths
        }
    }

    unsafe fn read_hdrop() -> Vec<String> {
        if IsClipboardFormatAvailable(u32::from(CF_HDROP.0)).is_err() {
            return Vec::new();
        }
        let Ok(handle) = GetClipboardData(u32::from(CF_HDROP.0)) else {
            return Vec::new();
        };
        let drop = HDROP(handle.0);
        // `0xFFFFFFFF` asks for the file count, not a name.
        let count = DragQueryFileW(drop, u32::MAX, None);
        let mut paths = Vec::with_capacity(count as usize);
        for index in 0..count {
            let len = DragQueryFileW(drop, index, None);
            if len == 0 {
                continue;
            }
            let mut buf = vec![0u16; len as usize + 1];
            let written = DragQueryFileW(drop, index, Some(&mut buf));
            buf.truncate(written as usize);
            paths.push(String::from_utf16_lossy(&buf));
        }
        paths
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    /// Linux clipboard file lists would need the GTK/X11 selection stack,
    /// which this app does not link against; the browser side sees file URLs
    /// via `text/uri-list` there, and the composer falls back to that.
    pub(super) fn file_paths() -> Vec<String> {
        Vec::new()
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::platform::read_file_urls;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPasteboard, NSPasteboardWriting};
    use objc2_foundation::{NSArray, NSString, NSURL};

    type Writing = ProtocolObject<dyn NSPasteboardWriting>;

    /// A private pasteboard keeps the test off the user's clipboard.
    fn write_test_pasteboard(file_paths: &[&str], web_url: Option<&str>) -> Retained<NSPasteboard> {
        let pasteboard = NSPasteboard::pasteboardWithUniqueName();
        pasteboard.clearContents();
        let mut objects: Vec<Retained<Writing>> = file_paths
            .iter()
            .map(|path| {
                let url = NSURL::fileURLWithPath(&NSString::from_str(path));
                ProtocolObject::from_retained(url)
            })
            .collect();
        if let Some(url) = web_url {
            let url = NSURL::URLWithString(&NSString::from_str(url)).expect("valid url");
            objects.push(ProtocolObject::from_retained(url));
        }
        pasteboard.writeObjects(&NSArray::from_retained_slice(&objects));
        pasteboard
    }

    #[test]
    fn reads_file_urls_in_order() {
        let pasteboard = write_test_pasteboard(
            &["/tmp/notes with space.md", "/tmp/pic.png"],
            None,
        );
        assert_eq!(
            read_file_urls(&pasteboard),
            vec![
                "/tmp/notes with space.md".to_string(),
                "/tmp/pic.png".to_string()
            ]
        );
    }

    #[test]
    fn ignores_web_urls() {
        let pasteboard = write_test_pasteboard(&["/tmp/keep.txt"], Some("https://example.com/a"));
        assert_eq!(read_file_urls(&pasteboard), vec!["/tmp/keep.txt".to_string()]);
    }

    #[test]
    fn text_clipboard_has_no_files() {
        let pasteboard = NSPasteboard::pasteboardWithUniqueName();
        pasteboard.clearContents();
        let text = NSString::from_str("just text");
        pasteboard.writeObjects(&NSArray::from_retained_slice(&[ProtocolObject::from_retained(
            text,
        )]));
        assert!(read_file_urls(&pasteboard).is_empty());
    }
}
