//! Windows program icons through the shell API, encoded as PNG.
//!
//! This replaced a hidden `powershell -Command "Add-Type System.Drawing …
//! ToBase64String"` spawn per icon. Endpoint security reads a GUI app that
//! launches hidden PowerShell, loads System.Drawing and prints base64 as
//! screen-capture / exfiltration tooling; the shell API returns the same
//! associated icon in-process.

/// Largest icon edge accepted from the shell (guards the pixel buffer size).
#[cfg_attr(not(windows), allow(dead_code))]
const MAX_ICON_EDGE: u32 = 256;

/// Top-down 32bpp BGRA rows → RGBA. Icons that carry no alpha channel (every
/// alpha byte 0) take transparency from the AND mask read as 32bpp: a set
/// mask pixel (white) is transparent, anything else opaque.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn bgra_to_rgba(color: &[u8], mask: Option<&[u8]>) -> Vec<u8> {
    let has_alpha = color.chunks_exact(4).any(|pixel| pixel[3] != 0);
    color
        .chunks_exact(4)
        .enumerate()
        .flat_map(|(index, pixel)| {
            let alpha = if has_alpha {
                pixel[3]
            } else {
                match mask.and_then(|mask| mask.get(index * 4)) {
                    Some(&bit) if bit != 0 => 0,
                    _ => 255,
                }
            };
            [pixel[2], pixel[1], pixel[0], alpha]
        })
        .collect()
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn encode_png(width: u32, height: u32, rgba: Vec<u8>) -> Option<Vec<u8>> {
    let image = image::RgbaImage::from_raw(width, height, rgba)?;
    let mut out = std::io::Cursor::new(Vec::new());
    image.write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(out.into_inner())
}

/// The shell's associated (large) icon for `path` as PNG bytes — the same
/// icon `System.Drawing.Icon.ExtractAssociatedIcon` returned.
#[cfg(windows)]
pub(crate) fn program_icon_png(path: &std::path::Path) -> Option<Vec<u8>> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
    use windows::Win32::UI::WindowsAndMessaging::DestroyIcon;

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut info = SHFILEINFOW::default();
    // SHGetFileInfo requires COM on the calling thread (a spawn_blocking
    // worker). S_FALSE (already initialized) still needs its balancing
    // CoUninitialize; RPC_E_CHANGED_MODE (an MTA thread) must not get one.
    let com = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let found = unsafe {
        SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if com.is_ok() {
        unsafe { CoUninitialize() };
    }
    if found == 0 || info.hIcon.is_invalid() {
        return None;
    }
    let png = icon_to_png(info.hIcon);
    let _ = unsafe { DestroyIcon(info.hIcon) };
    png
}

#[cfg(windows)]
fn icon_to_png(icon: windows::Win32::UI::WindowsAndMessaging::HICON) -> Option<Vec<u8>> {
    use windows::Win32::Graphics::Gdi::{CreateCompatibleDC, DeleteDC, DeleteObject};
    use windows::Win32::UI::WindowsAndMessaging::{GetIconInfo, ICONINFO};

    let mut info = ICONINFO::default();
    unsafe { GetIconInfo(icon, &mut info) }.ok()?;
    // GetIconInfo hands back bitmap copies the caller owns: free them on
    // every path. A monochrome icon (no color bitmap) yields None and the UI
    // falls back to its letter avatar.
    let dc = unsafe { CreateCompatibleDC(None) };
    let png = if dc.is_invalid() || info.hbmColor.is_invalid() {
        None
    } else {
        dib_bgra(dc, info.hbmColor).and_then(|(width, height, color)| {
            let mask = (!info.hbmMask.is_invalid())
                .then(|| dib_bgra(dc, info.hbmMask))
                .flatten()
                .filter(|(w, h, _)| (*w, *h) == (width, height))
                .map(|(_, _, mask)| mask);
            encode_png(width, height, bgra_to_rgba(&color, mask.as_deref()))
        })
    };
    unsafe {
        if !dc.is_invalid() {
            let _ = DeleteDC(dc);
        }
        if !info.hbmColor.is_invalid() {
            let _ = DeleteObject(info.hbmColor.into());
        }
        if !info.hbmMask.is_invalid() {
            let _ = DeleteObject(info.hbmMask.into());
        }
    }
    png
}

/// Read a bitmap as top-down 32bpp BGRA rows.
#[cfg(windows)]
fn dib_bgra(
    dc: windows::Win32::Graphics::Gdi::HDC,
    bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
) -> Option<(u32, u32, Vec<u8>)> {
    use windows::Win32::Graphics::Gdi::{
        GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };

    let mut header = BITMAP::default();
    let read = unsafe {
        GetObjectW(
            bitmap.into(),
            std::mem::size_of::<BITMAP>() as i32,
            Some((&mut header as *mut BITMAP).cast()),
        )
    };
    if read == 0 || header.bmWidth <= 0 || header.bmHeight <= 0 {
        return None;
    }
    let (width, height) = (header.bmWidth as u32, header.bmHeight as u32);
    if width > MAX_ICON_EDGE || height > MAX_ICON_EDGE {
        return None;
    }
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            // Negative height: top-down rows, the order RgbaImage expects.
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let lines = unsafe {
        GetDIBits(
            dc,
            bitmap,
            0,
            height,
            Some(pixels.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    (lines == height as i32).then_some((width, height, pixels))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alpha_icons_keep_their_alpha_and_swap_channels() {
        let bgra = [10, 20, 30, 255, 1, 2, 3, 0];
        // A mask must not override a real alpha channel.
        let mask = [255, 255, 255, 0, 255, 255, 255, 0];
        assert_eq!(
            bgra_to_rgba(&bgra, Some(&mask)),
            vec![30, 20, 10, 255, 3, 2, 1, 0]
        );
    }

    #[test]
    fn alphaless_icons_take_transparency_from_the_mask() {
        let bgra = [10, 20, 30, 0, 1, 2, 3, 0];
        // Second pixel's mask is set (white) → transparent.
        let mask = [0, 0, 0, 0, 255, 255, 255, 0];
        assert_eq!(
            bgra_to_rgba(&bgra, Some(&mask)),
            vec![30, 20, 10, 255, 3, 2, 1, 0]
        );
    }

    #[test]
    fn alphaless_icons_without_a_mask_are_opaque() {
        assert_eq!(bgra_to_rgba(&[10, 20, 30, 0], None), vec![30, 20, 10, 255]);
    }

    #[test]
    fn encodes_a_png_and_rejects_a_short_buffer() {
        let png = encode_png(1, 1, vec![1, 2, 3, 4]).expect("png");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert!(encode_png(2, 2, vec![0; 4]).is_none());
    }
}
