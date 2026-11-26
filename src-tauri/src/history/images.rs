//! Session-history images are stored outside the IPC payload.
//!
//! Native transcripts keep images as base64 data URLs. A page of history that
//! carried those strings re-sent every byte over IPC / WebSocket and made a
//! normal reconnect look like a failed request. The parser now writes each
//! image once into a content-addressed store and keeps only a short
//! `ccgui-image:<sha>.<ext>` reference in the message. The renderer asks for a
//! thumbnail (or the original on click) through `load_session_image`.
//! Stored images are content-addressed but not garbage-collected yet: deleting
//! a session leaves its referenced images in the app home for a later cleanup.

use base64::Engine as _;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

pub(crate) const PREFIX: &str = "ccgui-image:";
/// A data URL we could not turn into a reference. Keeping this marker lets the
/// UI show its usual unavailable-image chip instead of silently dropping a
/// message's only attachment.
pub(crate) const UNAVAILABLE: &str = "ccgui-image:unavailable";

const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const THUMB_EDGE: u32 = 512;
const MAX_EXT_LEN: usize = 8;

fn store_root() -> PathBuf {
    #[cfg(test)]
    {
        std::env::temp_dir().join("ccgui-next-session-images-test")
    }
    #[cfg(not(test))]
    {
        crate::paths::app_home().join("session-images")
    }
}

fn parse_data_url(raw: &str) -> Option<(&str, &str)> {
    let rest = raw.strip_prefix("data:")?;
    let (meta, payload) = rest.split_once(',')?;
    let mut parts = meta.split(';');
    let mime = parts.next()?.trim();
    if !mime.starts_with("image/") || !parts.any(|part| part.eq_ignore_ascii_case("base64")) {
        return None;
    }
    Some((mime, payload))
}

/// Browsers tolerate wrapped and unpadded base64 in a data URL. Mirror that
/// before persisting history images so a transcript that rendered before this
/// change does not turn into an unavailable chip.
fn decode_payload(payload: &str) -> Option<Vec<u8>> {
    let mut clean: String = payload.chars().filter(|c| !c.is_whitespace()).collect();
    let remainder = clean.len() % 4;
    if remainder == 1 {
        return None;
    }
    if remainder != 0 {
        clean.extend(std::iter::repeat('=').take(4 - remainder));
    }
    base64::engine::general_purpose::STANDARD
        .decode(clean.as_bytes())
        .ok()
}

fn mime_extension(mime: &str) -> &'static str {
    match mime.to_ascii_lowercase().as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico",
        "image/svg+xml" => "svg",
        "image/avif" => "avif",
        "image/apng" => "apng",
        _ => "img",
    }
}

fn extension_mime(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "apng" => "image/apng",
        _ => "application/octet-stream",
    }
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_ext(ext: &str) -> bool {
    !ext.is_empty()
        && ext.len() <= MAX_EXT_LEN
        && ext.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

/// Split a reference into its digest and extension without trusting either.
pub(crate) fn parse_ref(reference: &str) -> Option<(&str, &str)> {
    let rest = reference.strip_prefix(PREFIX)?;
    let (hash, ext) = rest.split_once('.')?;
    (valid_hash(hash) && valid_ext(ext)).then_some((hash, ext))
}

pub(crate) fn is_ref(value: &str) -> bool {
    value.starts_with(PREFIX)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if path.exists() {
        return Ok(());
    }
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "image path has no parent")
    })?;
    std::fs::create_dir_all(parent)?;
    let tmp = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, bytes)?;
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(_) if path.exists() => {
            let _ = std::fs::remove_file(&tmp);
            Ok(())
        }
        Err(error) => {
            let _ = std::fs::remove_file(&tmp);
            Err(error)
        }
    }
}

/// Persist bytes under `root` and return the short reference. The digest is
/// the content address, so the same image repeated across turns is stored
/// once.
fn store_in(root: &Path, mime: &str, bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return None;
    }
    let ext = mime_extension(mime);
    let hash = format!("{:x}", Sha256::digest(bytes));
    let path = root.join(format!("{hash}.{ext}"));
    if !path.exists() {
        write_atomic(&path, bytes).ok()?;
    }
    Some(format!("{PREFIX}{hash}.{ext}"))
}

fn externalize_bytes(mime: &str, bytes: &[u8]) -> String {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return UNAVAILABLE.to_string();
    }
    store_in(&store_root(), mime, bytes).unwrap_or_else(|| UNAVAILABLE.to_string())
}

/// Convert one data URL into a reference. Non-image strings are left alone;
/// a malformed or oversized image becomes [`UNAVAILABLE`] rather than leaking
/// its payload into the history page.
pub(crate) fn externalize(raw: &str) -> Option<String> {
    let (mime, payload) = parse_data_url(raw)?;
    let Some(bytes) = decode_payload(payload) else {
        // A data URL we cannot decode is still an image payload as far as the
        // page is concerned: dropping it (rather than leaving the string
        // untouched) is what keeps malformed megabytes out of the history.
        return Some(UNAVAILABLE.to_string());
    };
    Some(externalize_bytes(mime, &bytes))
}

/// A data URL can also arrive inside a larger string: a tool result may be a
/// JSON document or a log line that embeds one. Rewrite only the matching
/// span so the surrounding text survives, and leave the string untouched when
/// nothing valid is found (bytes that merely look like a URL must not be
/// destroyed).
fn externalize_embedded(text: &str) -> Option<String> {
    static URL: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(
            r"data:image(?:/|\\/)[A-Za-z0-9.+-]+(?:;[A-Za-z0-9._+-]+=[A-Za-z0-9._+-]+)*;base64,(?:[A-Za-z0-9+/=]|\\/)+",
        )
        .unwrap()
    });
    if !text.contains("data:image/") && !text.contains("data:image\\/") {
        return None;
    }
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    let mut changed = false;
    for found in URL.find_iter(text) {
        // JSON may escape every `/` in the URL as `\/`; decode the copy while
        // replacing the whole escaped span in the original text.
        let candidate = found.as_str().replace("\\/", "/");
        let Some(reference) = externalize(&candidate) else {
            continue;
        };
        out.push_str(&text[last..found.start()]);
        out.push_str(&reference);
        last = found.end();
        changed = true;
    }
    if !changed {
        return None;
    }
    out.push_str(&text[last..]);
    Some(out)
}

/// Claude/pi inline images keep the bytes in a structured block instead of a
/// data URL: `{type:"image", source:{type:"base64", media_type, data}}` (pi
/// also writes `{type:"image", mimeType, data}`). Replace the block with a
/// short reference so a tool result holding several screenshots cannot fill a
/// page on its own.
fn structured_image(map: &serde_json::Map<String, Value>) -> Option<String> {
    if map.get("type").and_then(Value::as_str) != Some("image") {
        return None;
    }
    let (mime, data) = match map.get("source") {
        Some(Value::Object(source))
            if source.get("type").and_then(Value::as_str) == Some("base64") =>
        {
            (
                source
                    .get("media_type")
                    .or_else(|| source.get("mime_type"))
                    .and_then(Value::as_str),
                source.get("data").and_then(Value::as_str),
            )
        }
        _ => (
            map.get("mimeType").and_then(Value::as_str),
            map.get("data").and_then(Value::as_str),
        ),
    };
    let (mime, data) = (mime?, data?);
    if !mime.starts_with("image/") || is_ref(data) {
        return None;
    }
    // A block that claims to be a base64 image but cannot be decoded is still
    // image payload as far as the page is concerned. Replace it with the
    // unavailable marker instead of leaving its bytes inline.
    let bytes = decode_payload(data).unwrap_or_default();
    Some(externalize_bytes(mime, &bytes))
}

/// Replace image data URLs anywhere in a tool result / argument tree.
pub(crate) fn externalize_value(value: &mut Value) {
    match value {
        Value::String(text) => {
            if let Some(reference) = externalize(text) {
                *text = reference;
            } else if let Some(rewritten) = externalize_embedded(text) {
                *text = rewritten;
            }
        }
        Value::Array(items) => {
            for item in items {
                externalize_value(item);
            }
        }
        Value::Object(map) => {
            if let Some(reference) = structured_image(map) {
                *value = serde_json::json!({ "type": "image", "ccguiImage": reference });
                return;
            }
            for item in map.values_mut() {
                externalize_value(item);
            }
        }
        _ => {}
    }
}

fn thumb_paths(root: &Path, hash: &str) -> (PathBuf, PathBuf) {
    let dir = root.join("thumbs");
    (
        dir.join(format!("{hash}-{THUMB_EDGE}.png")),
        dir.join(format!("{hash}-{THUMB_EDGE}.jpg")),
    )
}

fn thumb_bytes(
    root: &Path,
    hash: &str,
    full: &[u8],
    mime: &str,
) -> Option<(Vec<u8>, &'static str)> {
    let (png, jpg) = thumb_paths(root, hash);
    if let Ok(bytes) = std::fs::read(&png) {
        return Some((bytes, "image/png"));
    }
    if let Ok(bytes) = std::fs::read(&jpg) {
        return Some((bytes, "image/jpeg"));
    }
    let image = image::load_from_memory(full).ok()?;
    // SVG and other formats the decoder does not understand still render at
    // their natural size; no thumbnail is better than a broken one.
    if image.width() <= THUMB_EDGE && image.height() <= THUMB_EDGE && full.len() <= 256 * 1024 {
        return Some((full.to_vec(), mime_for_owned(mime)));
    }
    let thumb = image.thumbnail(THUMB_EDGE, THUMB_EDGE);
    let mut out = Vec::new();
    let (path, mime) = if image.has_alpha() {
        thumb
            .write_to(Cursor::new(&mut out), image::ImageFormat::Png)
            .ok()?;
        (png, "image/png")
    } else {
        let mut cursor = Cursor::new(&mut out);
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 80)
            .encode_image(&thumb)
            .ok()?;
        (jpg, "image/jpeg")
    };
    // A re-encode can be larger than a very well compressed source. The
    // dimension bound is what keeps a timeline thumbnail cheap to decode and
    // paint, so keep the resized bytes instead of falling back to the full
    // image here.
    if out.is_empty() {
        return Some((full.to_vec(), mime_for_owned(mime)));
    }
    write_atomic(&path, &out).ok()?;
    Some((out, mime))
}

fn mime_for_owned(mime: &str) -> &'static str {
    let ext = mime_extension(mime);
    extension_mime(ext)
}

fn load_from(root: &Path, reference: &str, full: bool) -> Result<String, String> {
    let (hash, ext) =
        parse_ref(reference).ok_or_else(|| "invalid session image reference".to_string())?;
    let path = root.join(format!("{hash}.{ext}"));
    let bytes = std::fs::read(&path).map_err(|_| "session image is unavailable".to_string())?;
    let mime = extension_mime(ext);
    let (bytes, mime) = if full {
        (bytes, mime)
    } else {
        thumb_bytes(root, hash, &bytes, mime)
            .map(|(thumb, thumb_mime)| (thumb, thumb_mime))
            .unwrap_or((bytes, mime))
    };
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn resolve_path(reference: &str) -> Result<(PathBuf, &str), String> {
    if reference == UNAVAILABLE {
        return Err("session image is unavailable".to_string());
    }
    let (hash, ext) =
        parse_ref(reference).ok_or_else(|| "invalid session image reference".to_string())?;
    let path = store_root().join(format!("{hash}.{ext}"));
    let metadata =
        std::fs::metadata(&path).map_err(|_| "session image is unavailable".to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_IMAGE_BYTES as u64 {
        return Err("session image is unavailable".to_string());
    }
    Ok((path, ext))
}

/// Absolute path of the original image, for engines that accept image files
/// instead of base64 content blocks.
pub(crate) fn original_path(reference: &str) -> Result<PathBuf, String> {
    resolve_path(reference).map(|(path, _)| path)
}

/// Read the original bytes of a stored image for prompt delivery. A queued or
/// history message holds only the short reference after a restart, so resending
/// it must resolve the reference back into the bytes every engine expects.
pub(crate) fn load_original(reference: &str) -> Result<(String, String), String> {
    let (path, ext) = resolve_path(reference)?;
    let bytes = std::fs::read(&path).map_err(|_| "session image is unavailable".to_string())?;
    Ok((
        extension_mime(ext).to_string(),
        base64::engine::general_purpose::STANDARD.encode(bytes),
    ))
}

/// Read a stored image for the UI. `full = false` returns a bounded thumbnail
/// used by the timeline; the lightbox asks for the original on click.
pub(crate) fn load(reference: &str, full: bool) -> Result<String, String> {
    load_from(&store_root(), reference, full)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-session-images-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = image::RgbImage::from_fn(width, height, |x, y| {
            image::Rgb([(x % 255) as u8, (y % 255) as u8, 128])
        });
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgb8(image)
            .write_to(Cursor::new(&mut bytes), image::ImageFormat::Png)
            .unwrap();
        bytes
    }

    #[test]
    fn stores_once_and_round_trips() {
        let root = scratch("round-trip");
        let bytes = png(4, 4);
        let first = store_in(&root, "image/png", &bytes).unwrap();
        let second = store_in(&root, "image/png", &bytes).unwrap();
        assert_eq!(first, second);
        assert!(parse_ref(&first).is_some());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        let data_url = load_from(&root, &first, true).unwrap();
        let payload = data_url.strip_prefix("data:image/png;base64,").unwrap();
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(payload)
                .unwrap(),
            bytes
        );
    }

    #[test]
    fn thumbnails_are_bounded_and_cached() {
        let root = scratch("thumb");
        let bytes = png(1200, 800);
        let reference = store_in(&root, "image/png", &bytes).unwrap();
        let thumb_url = load_from(&root, &reference, false).unwrap();
        // Opaque images are re-encoded as JPEG; transparent ones stay PNG.
        let (meta, payload) = thumb_url.split_once(',').expect("data URL");
        assert!(
            meta == "data:image/png;base64" || meta == "data:image/jpeg;base64",
            "unexpected thumbnail type: {meta}"
        );
        let thumb = base64::engine::general_purpose::STANDARD
            .decode(payload)
            .unwrap();
        let decoded = image::load_from_memory(&thumb).unwrap();
        assert!(decoded.width() <= THUMB_EDGE && decoded.height() <= THUMB_EDGE);
        assert!(decoded.width() * decoded.height() < 1200 * 800);
        let (png, jpg) = thumb_paths(&root, parse_ref(&reference).unwrap().0);
        assert!(png.exists() || jpg.exists());
        // The lightbox still gets the original pixels on demand.
        let full_url = load_from(&root, &reference, true).unwrap();
        let (_, full_payload) = full_url.split_once(',').unwrap();
        let full_bytes = base64::engine::general_purpose::STANDARD
            .decode(full_payload)
            .unwrap();
        let full_image = image::load_from_memory(&full_bytes).unwrap();
        assert_eq!((full_image.width(), full_image.height()), (1200, 800));
    }

    #[test]
    fn malformed_and_oversized_images_degrade_to_a_marker() {
        assert_eq!(
            externalize("data:image/png;base64,not-base64"),
            Some(UNAVAILABLE.to_string())
        );
        let mut structured = serde_json::json!({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": "not-base64"}
        });
        externalize_value(&mut structured);
        assert_eq!(structured["ccguiImage"], UNAVAILABLE);
        assert!(!structured.to_string().contains("not-base64"));
        let too_large = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(vec![0u8; MAX_IMAGE_BYTES + 1])
        );
        assert_eq!(externalize(&too_large), Some(UNAVAILABLE.to_string()));
    }

    #[test]
    fn wrapped_and_unpadded_base64_still_externalizes() {
        let bytes = png(4, 4);
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let unpadded = encoded.trim_end_matches('=');
        let wrapped = format!("{}\n  {}", &unpadded[..12], &unpadded[12..]);
        let reference = externalize(&format!("data:image/png;base64,{wrapped}")).unwrap();
        let (hash, ext) = parse_ref(&reference).expect("stored reference");
        assert_eq!(ext, "png");
        assert!(store_root().join(format!("{hash}.{ext}")).exists());
    }

    #[test]
    fn embedded_json_escaped_data_urls_are_externalized() {
        let rewritten =
            externalize_embedded("before data:image\\/png;base64,\\/\\/\\/\\/ after").unwrap();
        assert!(rewritten.starts_with("before ccgui-image:"), "{rewritten}");
        assert!(rewritten.ends_with(" after"), "{rewritten}");
        assert!(!rewritten.contains("data:image"), "{rewritten}");
        let reference = rewritten
            .strip_prefix("before ")
            .and_then(|rest| rest.strip_suffix(" after"))
            .unwrap();
        let (hash, ext) = parse_ref(reference).expect("stored reference");
        assert_eq!(ext, "png");
        assert!(store_root().join(format!("{hash}.{ext}")).exists());
    }

    #[test]
    fn references_cannot_escape_the_store() {
        assert!(parse_ref("ccgui-image:../../secret").is_none());
        assert!(parse_ref("ccgui-image:abcd.png").is_none());
        assert!(load_from(&scratch("traversal"), "ccgui-image:../../secret.png", true).is_err());
    }

    #[test]
    fn externalize_replaces_nested_tool_output_images() {
        let mut value = serde_json::json!({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": "aGk="}
        });
        externalize_value(&mut value);
        assert!(!value.to_string().contains("data:image"));
        assert!(value.to_string().contains(PREFIX));
    }

    #[test]
    fn structured_image_blocks_become_short_references() {
        let bytes = png(3, 3);
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let mut value = serde_json::json!([
            {
                "type": "tool_result",
                "content": [
                    {"type": "text", "text": "screenshot"},
                    {"type": "image", "source": {
                        "type": "base64", "media_type": "image/png", "data": encoded
                    }}
                ]
            }
        ]);
        externalize_value(&mut value);
        let rendered = value.to_string();
        assert!(
            !rendered.contains(&encoded),
            "raw base64 escaped: {rendered}"
        );
        let reference = value[0]["content"][1]["ccguiImage"].as_str().unwrap();
        let loaded = load(reference, true).unwrap();
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(loaded.strip_prefix("data:image/png;base64,").unwrap())
                .unwrap(),
            bytes
        );
        // Already externalized values are left alone, so a second pass over a
        // cached tree cannot turn the reference into "unavailable".
        let once = value.clone();
        externalize_value(&mut value);
        assert_eq!(value, once);
    }

    #[test]
    fn embedded_data_urls_keep_the_surrounding_text() {
        let mut value = serde_json::json!({
            "stdout": "before data:image/png;charset=utf-8;base64,aGk= after"
        });
        externalize_value(&mut value);
        let text = value["stdout"].as_str().unwrap();
        assert!(text.starts_with("before ccgui-image:"), "{text}");
        assert!(text.ends_with(" after"), "{text}");
        assert!(!text.contains("aGk="));
    }
}
