//! OS clipboard file lists.
//!
//! Copying files in Finder / Explorer puts file references on the clipboard,
//! but a paste into the webview only surfaces opaque `File` blobs — the
//! absolute paths never reach JavaScript. The chat composer asks the host
//! after such a paste so copied files route exactly like dropped ones
//! (`@path` mentions for files, the attachment pipeline for images).
//!
//! The same bridge carries the file tree's Copy/Paste: the menu writes the
//! item here so Finder / Explorer can paste the real file, and reads it back
//! so a copy made in another app can be pasted into the tree.

/// Absolute paths of the files on the general clipboard, in pasteboard
/// order. Empty when the clipboard holds no file (plain text, a screenshot's
/// raw bytes, an image editor's internal data, ...).
///
/// Runs on the command's thread; Tauri executes synchronous commands on the
/// main thread, which is what the AppKit pasteboard wants.
#[tauri::command]
pub fn clipboard_file_paths() -> Vec<String> {
    os_file_paths()
}

/// Replace the general clipboard with a file list, so another app's paste
/// inserts the actual items (Explorer / Finder semantics, not a path string).
///
/// The renderer may only name paths here: the write exposes nothing back to
/// it, and a path that does not exist is dropped instead of being put on the
/// clipboard as a dangling reference.
#[tauri::command]
pub fn clipboard_set_file_paths(paths: Vec<String>) -> Result<(), String> {
    let existing: Vec<String> = paths
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty() && std::path::Path::new(path).exists())
        .collect();
    if existing.is_empty() {
        return Err("no existing path to put on the clipboard".to_string());
    }
    platform::set_file_paths(&existing)
}

/// Host-side read used by file commands: the clipboard is the source of
/// truth for "paste", and its paths must never travel through the renderer
/// (that would turn a paste command into an arbitrary-filesystem read).
pub(crate) fn os_file_paths() -> Vec<String> {
    platform::file_paths()
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::ClassType;
    use objc2_app_kit::{NSPasteboard, NSPasteboardWriting};
    use objc2_foundation::{NSArray, NSString, NSURL};

    type Writing = ProtocolObject<dyn NSPasteboardWriting>;

    pub(super) fn file_paths() -> Vec<String> {
        let pasteboard = NSPasteboard::generalPasteboard();
        read_file_urls(&pasteboard)
    }

    pub(super) fn set_file_paths(paths: &[String]) -> Result<(), String> {
        write_file_urls(&NSPasteboard::generalPasteboard(), paths)
    }

    /// Replace `pasteboard`'s contents with file URLs (Finder's own paste
    /// flavour for a copied item). A plain-text path would paste as text in
    /// editors, so it is not written alongside.
    pub(super) fn write_file_urls(
        pasteboard: &NSPasteboard,
        paths: &[String],
    ) -> Result<(), String> {
        pasteboard.clearContents();
        let objects: Vec<Retained<Writing>> = paths
            .iter()
            .map(|path| {
                let url = NSURL::fileURLWithPath(&NSString::from_str(path));
                ProtocolObject::from_retained(url)
            })
            .collect();
        if pasteboard.writeObjects(&NSArray::from_retained_slice(&objects)) {
            Ok(())
        } else {
            Err("the system refused the clipboard write".to_string())
        }
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
    use windows::core::BOOL;
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, POINT};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
        OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::CF_HDROP;
    use windows::Win32::UI::Shell::{DragQueryFileW, DROPFILES, HDROP};

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

    pub(super) fn set_file_paths(paths: &[String]) -> Result<(), String> {
        // SAFETY: every pointer below comes from one GlobalAlloc block, which
        // is either handed to the system by SetClipboardData or freed here.
        unsafe {
            let handle = alloc_hdrop(paths)?;
            if let Err(e) = OpenClipboard(None) {
                let _ = GlobalFree(Some(handle));
                return Err(format!("cannot open the clipboard: {e}"));
            }
            if let Err(e) = EmptyClipboard() {
                let _ = CloseClipboard();
                let _ = GlobalFree(Some(handle));
                return Err(format!("cannot clear the clipboard: {e}"));
            }
            let written = SetClipboardData(u32::from(CF_HDROP.0), Some(HANDLE(handle.0)));
            let _ = CloseClipboard();
            match written {
                // Past a successful SetClipboardData the system owns the
                // block; freeing it here would corrupt the clipboard.
                Ok(_) => Ok(()),
                Err(e) => {
                    let _ = GlobalFree(Some(handle));
                    Err(format!("cannot set the clipboard: {e}"))
                }
            }
        }
    }

    /// A moveable `DROPFILES` block: header, then the paths as a
    /// double-NUL-terminated UTF-16 list (`fWide`), which is exactly what
    /// Explorer puts on the clipboard for a copied file.
    unsafe fn alloc_hdrop(paths: &[String]) -> Result<HGLOBAL, String> {
        let payload = hdrop_bytes(paths);
        let handle = GlobalAlloc(GMEM_MOVEABLE, payload.len())
            .map_err(|e| format!("cannot allocate the clipboard payload: {e}"))?;
        let base = GlobalLock(handle);
        if base.is_null() {
            let _ = GlobalFree(Some(handle));
            return Err("cannot lock the clipboard payload".to_string());
        }
        std::ptr::copy_nonoverlapping(payload.as_ptr(), base.cast::<u8>(), payload.len());
        let _ = GlobalUnlock(handle);
        Ok(handle)
    }

    /// `DROPFILES` header plus the double-NUL-terminated UTF-16 path list.
    pub(super) fn hdrop_bytes(paths: &[String]) -> Vec<u8> {
        let mut names: Vec<u16> = Vec::new();
        for path in paths {
            names.extend(path.encode_utf16());
            names.push(0);
        }
        // Empty list terminator; also keeps the block non-empty for no paths.
        names.push(0);

        let header = DROPFILES {
            pFiles: std::mem::size_of::<DROPFILES>() as u32,
            pt: POINT { x: 0, y: 0 },
            fNC: BOOL(0),
            fWide: BOOL(1),
        };
        let mut payload = Vec::with_capacity(std::mem::size_of::<DROPFILES>() + names.len() * 2);
        // SAFETY: `DROPFILES` is a plain data struct (integers and a POINT);
        // reinterpreting it as bytes copies exactly its initialized size.
        payload.extend_from_slice(unsafe {
            std::slice::from_raw_parts(
                (&header as *const DROPFILES).cast::<u8>(),
                std::mem::size_of::<DROPFILES>(),
            )
        });
        // SAFETY: every `u16` in `names` is initialized.
        payload.extend_from_slice(unsafe {
            std::slice::from_raw_parts(names.as_ptr().cast::<u8>(), names.len() * 2)
        });
        payload
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

    /// Writing a file list needs the same GTK/X11 selection stack the read
    /// path does not have; the in-app clipboard still carries the item, so
    /// Copy/Paste inside the tree keeps working and only the OS round trip
    /// is unavailable.
    pub(super) fn set_file_paths(_paths: &[String]) -> Result<(), String> {
        Err("this platform has no native file clipboard bridge".to_string())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::platform::{read_file_urls, write_file_urls};
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

    /// The write path the file tree's Copy uses: what Finder reads back is
    /// the file list, in order, with spaces intact.
    #[test]
    fn writes_file_urls_that_read_back() {
        let pasteboard = NSPasteboard::pasteboardWithUniqueName();
        let paths = vec![
            "/tmp/notes with space.md".to_string(),
            "/tmp/pic.png".to_string(),
        ];
        write_file_urls(&pasteboard, &paths).expect("write file urls");
        assert_eq!(read_file_urls(&pasteboard), paths);
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

#[cfg(all(test, target_os = "windows"))]
mod windows_tests {
    use super::platform::hdrop_bytes;
    use windows::Win32::UI::Shell::DROPFILES;

    /// What Explorer reads back: the header points past itself and flags
    /// wide chars, then the paths form one double-NUL-terminated list.
    #[test]
    fn dropfiles_block_is_a_wide_double_null_list() {
        let paths = vec![
            r"C:\work\notes.md".to_string(),
            r"C:\work\a b.txt".to_string(),
        ];
        let payload = hdrop_bytes(&paths);

        // SAFETY: the first `size_of::<DROPFILES>()` bytes are exactly the
        // header `hdrop_bytes` wrote. `DROPFILES` is `repr(packed)`, so its
        // fields are copied out before asserting (no unaligned references).
        let header = unsafe { std::ptr::read_unaligned(payload.as_ptr().cast::<DROPFILES>()) };
        let header_len = std::mem::size_of::<DROPFILES>();
        let files_offset = header.pFiles;
        let f_nc = header.fNC;
        let f_wide = header.fWide;
        assert_eq!(files_offset as usize, header_len);
        assert_eq!(f_nc.0, 0);
        assert_eq!(f_wide.0, 1);

        let wide: Vec<u16> = payload[header_len..]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        let mut expected: Vec<u16> = Vec::new();
        for path in &paths {
            expected.extend(path.encode_utf16());
            expected.push(0);
        }
        expected.push(0);
        assert_eq!(wide, expected);
    }
}
