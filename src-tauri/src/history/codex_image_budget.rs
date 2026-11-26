//! Keep Codex's persisted tool-result images below the provider request limit.
//!
//! Codex records every `view_image` result as a base64 data URL and resumes a
//! thread by replaying that rollout. Its context accounting charges a fixed
//! 7 KB per resized image, so a long image-edit session can contain tens of
//! megabytes while the context meter still looks healthy. Providers with a
//! request-body cap (DeepSeek's `/responses` is one) then reject the entire
//! turn with HTTP 413 before Codex compacts.
//!
//! Before a Codex thread is resumed, old tool-result images are re-encoded as
//! bounded JPEGs. The newest images stay byte-for-byte intact so an active
//! edit still sees its source; older screenshots remain visible in history but
//! no longer consume the whole request budget.

use base64::Engine as _;
use serde_json::Value;
use std::io::Cursor;
use std::path::Path;

const MAX_REQUEST_IMAGE_CHARS: usize = 20 * 1024 * 1024;
const RETAINED_IMAGE_CHARS: usize = 8 * 1024 * 1024;
const RETAINED_IMAGE_COUNT: usize = 6;
const STALE_MAX_EDGE: u32 = 896;
const STALE_JPEG_QUALITY: u8 = 80;
const STALE_JPEG_TARGET_BYTES: usize = 256 * 1024;

#[derive(Clone, Copy)]
struct ImageBudget {
    max_chars: usize,
    retained_chars: usize,
    retained_count: usize,
    max_edge: u32,
    quality: u8,
}

const DEFAULT_BUDGET: ImageBudget = ImageBudget {
    max_chars: MAX_REQUEST_IMAGE_CHARS,
    retained_chars: RETAINED_IMAGE_CHARS,
    retained_count: RETAINED_IMAGE_COUNT,
    max_edge: STALE_MAX_EDGE,
    quality: STALE_JPEG_QUALITY,
};

/// Shrink the rollout for one Codex thread when its inline tool images exceed
/// the request budget. A missing/under-budget rollout is left untouched.
pub(crate) fn limit_rollout(session_id: Option<&str>) -> Result<(), String> {
    let Some(session_id) = session_id.filter(|id| !id.trim().is_empty()) else {
        return Ok(());
    };
    let home = crate::engine::codex_home();
    let Some(path) = crate::engine::codex_usage::rollout_path(&home, session_id) else {
        return Ok(());
    };
    shrink_file(&path, DEFAULT_BUDGET)?;
    Ok(())
}

fn split_line(segment: &str) -> (&str, &str) {
    if let Some(body) = segment.strip_suffix("\r\n") {
        (body, "\r\n")
    } else if let Some(body) = segment.strip_suffix('\n') {
        (body, "\n")
    } else {
        (segment, "")
    }
}

fn visit_image_urls(value: &mut Value, visit: &mut impl FnMut(&mut String)) -> usize {
    match value {
        Value::Array(items) => items
            .iter_mut()
            .map(|item| visit_image_urls(item, visit))
            .sum(),
        Value::Object(map) => {
            if map.get("type").and_then(Value::as_str) == Some("input_image") {
                if let Some(Value::String(url)) = map.get_mut("image_url") {
                    if url.starts_with("data:") {
                        visit(url);
                        return 1;
                    }
                    return 0;
                }
            }
            map.values_mut()
                .map(|item| visit_image_urls(item, visit))
                .sum()
        }
        _ => 0,
    }
}

fn visit_tool_output_images(line: &mut Value, visit: &mut impl FnMut(&mut String)) -> usize {
    let Some(payload) = line.get_mut("payload").and_then(Value::as_object_mut) else {
        return 0;
    };
    if !matches!(
        payload.get("type").and_then(Value::as_str),
        Some("function_call_output" | "custom_tool_call_output")
    ) {
        return 0;
    }
    payload
        .get_mut("output")
        .map(|output| visit_image_urls(output, visit))
        .unwrap_or(0)
}

fn count_tool_images(text: &str) -> Result<Vec<usize>, String> {
    let mut sizes = Vec::new();
    for segment in text.split_inclusive('\n') {
        if !segment.contains("data:") {
            continue;
        }
        let (body, _) = split_line(segment);
        if body.trim().is_empty() {
            continue;
        }
        let Ok(mut line) = serde_json::from_str::<Value>(body) else {
            continue;
        };
        visit_tool_output_images(&mut line, &mut |url| sizes.push(url.len()));
    }
    Ok(sizes)
}

fn retained_images(sizes: &[usize], budget: ImageBudget) -> usize {
    let mut count = 0;
    let mut bytes: usize = 0;
    for size in sizes.iter().rev() {
        if count >= budget.retained_count {
            break;
        }
        // Keep at least the current image and one predecessor for edit
        // comparisons, even when a single screenshot is unusually large.
        if count > 1 && bytes.saturating_add(*size) > budget.retained_chars {
            break;
        }
        bytes = bytes.saturating_add(*size);
        count += 1;
    }
    count
}

fn encode_jpeg(image: &image::DynamicImage, edge: u32, quality: u8) -> Option<Vec<u8>> {
    let prepared = image.thumbnail(edge, edge).to_rgb8();
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(Cursor::new(&mut bytes), quality)
        .encode_image(&prepared)
        .ok()?;
    (!bytes.is_empty()).then_some(bytes)
}

fn compress_data_url(raw: &str, budget: ImageBudget) -> Option<String> {
    let rest = raw.strip_prefix("data:")?;
    let (meta, payload) = rest.split_once(',')?;
    let mut parts = meta.split(';');
    let mime = parts.next()?;
    if !(mime.starts_with("image/") || mime == "application/octet-stream")
        || !parts.any(|part| part.eq_ignore_ascii_case("base64"))
    {
        return None;
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .ok()?;
    let image = image::load_from_memory(&decoded).ok()?;
    let mut best = encode_jpeg(&image, budget.max_edge, budget.quality)?;
    if best.len() > STALE_JPEG_TARGET_BYTES {
        best = encode_jpeg(&image, 640, 72).filter(|next| next.len() < best.len())?;
    }
    if best.len() > STALE_JPEG_TARGET_BYTES {
        best = encode_jpeg(&image, 512, 68).filter(|next| next.len() < best.len())?;
    }
    if best.len() >= payload.trim().len() {
        return None;
    }
    Some(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(best)
    ))
}

struct ShrinkReport {
    before_chars: usize,
    after_chars: usize,
    images: usize,
    compressed: usize,
}

fn rewrite_pass(text: &str, budget: ImageBudget) -> Result<Option<(String, ShrinkReport)>, String> {
    let sizes = count_tool_images(text)?;
    let before_chars = sizes.iter().copied().sum::<usize>();
    if before_chars <= budget.max_chars || sizes.len() <= 1 {
        return Ok(None);
    }
    let retained = retained_images(&sizes, budget);
    let compress_before = sizes.len().saturating_sub(retained);
    let mut output = String::with_capacity(text.len());
    let mut index = 0;
    let mut after_chars: usize = 0;
    let mut compressed = 0;

    for segment in text.split_inclusive('\n') {
        let (body, newline) = split_line(segment);
        if body.trim().is_empty() || !body.contains("data:") {
            output.push_str(segment);
            continue;
        }
        let Ok(mut line) = serde_json::from_str::<Value>(body) else {
            // Codex can leave a truncated final line after a hard kill. Keep
            // it byte-for-byte and shrink the lines that are still readable.
            output.push_str(segment);
            continue;
        };
        let mut changed = false;
        let visited = visit_tool_output_images(&mut line, &mut |url| {
            let current = index;
            index += 1;
            if current < compress_before {
                if let Some(smaller) = compress_data_url(url, budget) {
                    *url = smaller;
                    changed = true;
                    compressed += 1;
                }
            }
            after_chars = after_chars.saturating_add(url.len());
        });
        if visited == 0 {
            output.push_str(segment);
            continue;
        }
        if changed {
            output.push_str(
                &serde_json::to_string(&line)
                    .map_err(|error| format!("serialize Codex rollout line: {error}"))?,
            );
        } else {
            output.push_str(body);
        }
        output.push_str(newline);
    }
    if compressed == 0 {
        return Ok(None);
    }
    Ok(Some((
        output,
        ShrinkReport {
            before_chars,
            after_chars,
            images: sizes.len(),
            compressed,
        },
    )))
}

fn rewrite(text: &str, budget: ImageBudget) -> Result<Option<(String, ShrinkReport)>, String> {
    let Some((mut output, mut report)) = rewrite_pass(text, budget)? else {
        return Ok(None);
    };
    // Screenshot-heavy sessions can exceed the budget even after every old
    // image was replaced: the retained originals are the ones doing it. Keep
    // only the newest original then, so a turn can still be sent at all.
    for retained_count in [1, 0] {
        if report.after_chars <= budget.max_chars {
            break;
        }
        let emergency = ImageBudget {
            retained_chars: 0,
            retained_count,
            max_edge: budget.max_edge.min(512),
            quality: budget.quality.min(68),
            ..budget
        };
        if let Some((tightened, tightened_report)) = rewrite_pass(&output, emergency)? {
            output = tightened;
            report.after_chars = tightened_report.after_chars;
            report.compressed += tightened_report.compressed;
        }
    }
    Ok(Some((output, report)))
}

fn shrink_file(path: &Path, budget: ImageBudget) -> Result<(), String> {
    let original = std::fs::read(path)
        .map_err(|error| format!("read Codex rollout {}: {error}", path.display()))?;
    let text = std::str::from_utf8(&original)
        .map_err(|error| format!("Codex rollout is not UTF-8: {error}"))?;
    let Some((rewritten, report)) = rewrite(text, budget)? else {
        return Ok(());
    };
    super::edit::preserve_backup(path, &original, super::edit::BackupName::Beside)?;
    super::edit::atomic_write_existing(path, rewritten.as_bytes())?;
    eprintln!(
        "[codex-image-budget] {}: {} tool images, {:.1} MiB -> {:.1} MiB ({} downscaled)",
        path.display(),
        report.images,
        report.before_chars as f64 / (1024.0 * 1024.0),
        report.after_chars as f64 / (1024.0 * 1024.0),
        report.compressed,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};
    use std::path::PathBuf;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-codex-image-budget-{tag}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(dir.join("sessions/2026/11/24")).unwrap();
        dir
    }

    fn noise_png(seed: u32, width: u32, height: u32) -> Vec<u8> {
        let image = RgbImage::from_fn(width, height, |x, y| {
            Rgb([
                ((x * 17 + y * 31 + seed * 13) % 256) as u8,
                ((x * 29 + y * 7 + seed * 47) % 256) as u8,
                ((x * 3 + y * 19 + seed * 61) % 256) as u8,
            ])
        });
        let mut png = Vec::new();
        image::DynamicImage::ImageRgb8(image)
            .write_to(Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        png
    }

    fn rollout(images: &[Vec<u8>]) -> String {
        images
            .iter()
            .enumerate()
            .map(|(index, png)| {
                serde_json::json!({
                    "timestamp": "2026-11-24T13:21:15.605Z",
                    "ordinal": index,
                    "type": "response_item",
                    "payload": {
                        "type": "function_call_output",
                        "id": format!("fco_{index}"),
                        "call_id": format!("call_{index}"),
                        "output": [{
                            "type": "input_image",
                            "image_url": format!(
                                "data:image/png;base64,{}",
                                base64::engine::general_purpose::STANDARD.encode(png)
                            ),
                            "detail": "high"
                        }]
                    }
                })
                .to_string()
            })
            .collect::<Vec<_>>()
            .join("\n")
            + "\n"
    }

    fn image_urls(text: &str) -> Vec<String> {
        text.lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .flat_map(|mut line| {
                let mut urls = Vec::new();
                visit_tool_output_images(&mut line, &mut |url| urls.push(url.clone()));
                urls
            })
            .collect()
    }

    #[test]
    fn old_images_are_downscaled_and_newest_stay_exact() {
        let dir = scratch("shrink");
        let path = dir.join("sessions/2026/11/24/rollout-2026-11-24T13-21-15-thread.jsonl");
        let original_images = (0..8)
            .map(|seed| noise_png(seed, 640, 480))
            .collect::<Vec<_>>();
        let original = rollout(&original_images);
        std::fs::write(&path, &original).unwrap();
        let original_urls = image_urls(&original);
        assert!(original_urls.iter().map(String::len).sum::<usize>() > 4 * 1024 * 1024);

        let budget = ImageBudget {
            max_chars: 4 * 1024 * 1024,
            retained_chars: 3_000_000,
            retained_count: 2,
            max_edge: 640,
            quality: 78,
        };
        shrink_file(&path, budget).unwrap();

        let rewritten = std::fs::read_to_string(&path).unwrap();
        let rewritten_urls = image_urls(&rewritten);
        assert_eq!(rewritten_urls.len(), original_urls.len());
        assert!(rewritten_urls.iter().map(String::len).sum::<usize>() < 4 * 1024 * 1024);
        assert!(rewritten_urls[6..]
            .iter()
            .zip(&original_urls[6..])
            .all(|(rewritten, original)| rewritten == original));
        assert!(rewritten_urls[..6]
            .iter()
            .all(|url| url.starts_with("data:image/jpeg;base64,")));
        for url in &rewritten_urls {
            let (_, payload) = url.split_once(',').unwrap();
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(payload)
                .unwrap();
            assert!(image::load_from_memory(&bytes).is_ok());
        }
        let backup =
            super::super::edit::backup_path(&path, super::super::edit::BackupName::Beside).unwrap();
        assert_eq!(std::fs::read(backup).unwrap(), original.as_bytes());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn under_budget_rollouts_are_not_modified() {
        let dir = scratch("small");
        let path = dir.join("sessions/2026/11/24/rollout-2026-11-24T13-21-15-small.jsonl");
        let original = rollout(&[noise_png(1, 8, 8), noise_png(2, 8, 8)]);
        std::fs::write(&path, &original).unwrap();

        shrink_file(&path, DEFAULT_BUDGET).unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        let backup =
            super::super::edit::backup_path(&path, super::super::edit::BackupName::Beside).unwrap();
        assert!(!backup.exists());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn retained_count_never_keeps_more_than_the_byte_budget() {
        let sizes = vec![1_000_000; 10];
        let budget = ImageBudget {
            retained_chars: 2_500_000,
            retained_count: 6,
            ..DEFAULT_BUDGET
        };
        assert_eq!(retained_images(&sizes, budget), 2);
        assert_eq!(retained_images(&sizes[..1], budget), 1);
    }

    #[test]
    fn malformed_lines_are_preserved_without_blocking_the_shrink() {
        let dir = scratch("broken-line");
        let path = dir.join("sessions/2026/11/24/rollout-2026-11-24T13-21-15-broken.jsonl");
        let images = (0..4)
            .map(|seed| noise_png(seed, 640, 480))
            .collect::<Vec<_>>();
        let mut original = rollout(&images);
        let broken = "{not json data:image/png;base64,AAAA";
        original.push_str(broken);
        original.push('\n');
        std::fs::write(&path, &original).unwrap();
        let budget = ImageBudget {
            max_chars: 2 * 1024 * 1024,
            retained_chars: 100,
            retained_count: 1,
            max_edge: 640,
            quality: 78,
        };
        shrink_file(&path, budget).unwrap();

        let rewritten = std::fs::read_to_string(&path).unwrap();
        assert!(rewritten.ends_with(&format!("{broken}\n")));
        assert!(
            image_urls(&rewritten)
                .iter()
                .map(String::len)
                .sum::<usize>()
                <= budget.max_chars
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn emergency_pass_tightens_when_retained_images_exceed_the_budget() {
        let dir = scratch("emergency");
        let path = dir.join("sessions/2026/11/24/rollout-2026-11-24T13-21-15-emergency.jsonl");
        let original = rollout(
            &(0..8)
                .map(|seed| noise_png(seed, 640, 480))
                .collect::<Vec<_>>(),
        );
        std::fs::write(&path, &original).unwrap();
        let budget = ImageBudget {
            max_chars: 2 * 1024 * 1024,
            retained_chars: 8 * 1024 * 1024,
            retained_count: 6,
            max_edge: 640,
            quality: 78,
        };
        shrink_file(&path, budget).unwrap();

        let rewritten = std::fs::read_to_string(&path).unwrap();
        assert!(
            image_urls(&rewritten)
                .iter()
                .map(String::len)
                .sum::<usize>()
                <= budget.max_chars
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    #[ignore = "manual real-session image payload check"]
    fn real_rollout_copy_stays_under_budget() {
        let path = std::env::var_os("CCGUI_CODEX_IMAGE_FIXTURE")
            .map(PathBuf::from)
            .expect("set CCGUI_CODEX_IMAGE_FIXTURE to a copied rollout");
        let before_text = std::fs::read_to_string(&path).unwrap();
        let before_chars = count_tool_images(&before_text)
            .unwrap()
            .iter()
            .sum::<usize>();
        assert!(before_chars > DEFAULT_BUDGET.max_chars);

        shrink_file(&path, DEFAULT_BUDGET).unwrap();

        let after_text = std::fs::read_to_string(&path).unwrap();
        let after_chars = count_tool_images(&after_text)
            .unwrap()
            .iter()
            .sum::<usize>();
        assert!(
            after_chars <= DEFAULT_BUDGET.max_chars,
            "{after_chars} chars remained after shrinking"
        );
    }
}
