use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use crate::app_paths;

static FILE_LOCK: Mutex<()> = Mutex::new(());

static MARKDOWN_IMAGE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"!\[([^\]]*)\]\([^)]+\)").expect("valid markdown image regex"));
static MARKDOWN_LINK_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[([^\]]+)\]\([^)]+\)").expect("valid markdown link regex"));
static MARKDOWN_PREFIX_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s{0,3}(?:#{1,6}|\>|\-|\*|\+|\d+\.)\s*").expect("valid markdown prefix regex")
});
static MULTISPACE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s+").expect("valid multispace regex"));
const MAX_NOTE_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteCardAttachment {
    pub id: String,
    pub file_name: String,
    pub content_type: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteCardPreviewAttachment {
    pub id: String,
    pub file_name: String,
    pub content_type: String,
    pub absolute_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceNoteCard {
    pub id: String,
    pub workspace_id: String,
    pub workspace_name: Option<String>,
    pub workspace_path: Option<String>,
    pub project_name: String,
    pub title: String,
    pub body_markdown: String,
    pub plain_text_excerpt: String,
    pub attachments: Vec<NoteCardAttachment>,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceNoteCardSummary {
    pub id: String,
    pub title: String,
    pub plain_text_excerpt: String,
    pub updated_at: i64,
    pub created_at: i64,
    pub archived_at: Option<i64>,
    pub archived: bool,
    pub image_count: usize,
    pub preview_attachments: Vec<NoteCardPreviewAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceNoteCardListResult {
    pub items: Vec<WorkspaceNoteCardSummary>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateWorkspaceNoteCardInput {
    pub workspace_id: String,
    pub workspace_name: Option<String>,
    pub workspace_path: Option<String>,
    pub title: Option<String>,
    pub body_markdown: String,
    pub attachment_inputs: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateWorkspaceNoteCardInput {
    pub workspace_name: Option<String>,
    pub workspace_path: Option<String>,
    pub title: Option<String>,
    pub body_markdown: Option<String>,
    pub attachment_inputs: Option<Vec<String>>,
}

fn with_file_lock<T>(op: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = FILE_LOCK
        .lock()
        .map_err(|error| format!("note card file lock poisoned: {error}"))?;
    op()
}

fn storage_dir() -> Result<PathBuf, String> {
    app_paths::note_card_dir()
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn derive_project_name(
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
    workspace_path: Option<&str>,
) -> String {
    let from_path = workspace_path
        .and_then(|value| Path::new(value).file_name())
        .and_then(OsStr::to_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let candidate = from_path
        .or_else(|| {
            workspace_name
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .or_else(|| {
            workspace_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .unwrap_or("workspace");
    let sanitized = candidate
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else if matches!(character, '-' | '_' | ' ') {
                '-'
            } else {
                '-'
            }
        })
        .collect::<String>();
    let collapsed = sanitized
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if collapsed.is_empty() {
        "workspace".to_string()
    } else {
        collapsed
    }
}

fn project_dir_path(
    base: &Path,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
    workspace_path: Option<&str>,
) -> PathBuf {
    base.join(derive_project_name(
        workspace_id,
        workspace_name,
        workspace_path,
    ))
}

fn active_collection_dir(project_dir: &Path) -> PathBuf {
    project_dir.join("active")
}

fn archive_collection_dir(project_dir: &Path) -> PathBuf {
    project_dir.join("archive")
}

fn assets_root_dir(project_dir: &Path) -> PathBuf {
    project_dir.join("assets")
}

fn note_asset_dir(project_dir: &Path, note_id: &str) -> PathBuf {
    assets_root_dir(project_dir).join(note_id)
}

fn note_file_path(project_dir: &Path, note_id: &str, archived: bool) -> PathBuf {
    let collection_dir = if archived {
        archive_collection_dir(project_dir)
    } else {
        active_collection_dir(project_dir)
    };
    collection_dir.join(format!("{note_id}.json"))
}

fn ensure_project_dirs(project_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(active_collection_dir(project_dir))
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(archive_collection_dir(project_dir))
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(assets_root_dir(project_dir)).map_err(|error| error.to_string())?;
    Ok(())
}

fn write_string_atomically(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("Storage path has no parent: {}", path.display()))?;
    let filename = path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| format!("Storage path has invalid filename: {}", path.display()))?;
    let temp_path = parent.join(format!(".{filename}.{}.tmp", uuid::Uuid::new_v4()));
    let mut temp_file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| error.to_string())?;
    temp_file
        .write_all(content.as_bytes())
        .map_err(|error| error.to_string())?;
    temp_file.sync_all().map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    if path.exists() {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }

    if let Err(error) = std::fs::rename(&temp_path, path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error.to_string());
    }
    Ok(())
}

fn write_note_card(path: &Path, note: &WorkspaceNoteCard) -> Result<(), String> {
    let payload = serde_json::to_string_pretty(note).map_err(|error| error.to_string())?;
    write_string_atomically(path, &payload)
}

fn read_note_card(
    path: &Path,
    project_dir: &Path,
    archived: bool,
) -> Result<WorkspaceNoteCard, String> {
    let raw = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut note: WorkspaceNoteCard =
        serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    note.attachments = note
        .attachments
        .into_iter()
        .map(|attachment| hydrate_attachment_path(project_dir, &note.id, attachment))
        .collect();
    if archived && note.archived_at.is_none() {
        note.archived_at = Some(note.updated_at);
    }
    Ok(note)
}

fn hydrate_attachment_path(
    project_dir: &Path,
    note_id: &str,
    mut attachment: NoteCardAttachment,
) -> NoteCardAttachment {
    attachment.relative_path =
        sanitize_attachment_relative_path(&attachment.relative_path, Some(&attachment.file_name));
    attachment.absolute_path = note_asset_dir(project_dir, note_id)
        .join(&attachment.relative_path)
        .to_string_lossy()
        .to_string();
    attachment
}

fn strip_markdown_to_plain_text(markdown: &str) -> String {
    let without_images = MARKDOWN_IMAGE_REGEX.replace_all(markdown, "$1");
    let without_links = MARKDOWN_LINK_REGEX.replace_all(&without_images, "$1");
    let without_prefix = MARKDOWN_PREFIX_REGEX.replace_all(&without_links, "");
    MULTISPACE_REGEX
        .replace_all(
            &without_prefix
                .replace("```", " ")
                .replace('`', " ")
                .replace('*', " ")
                .replace('_', " ")
                .replace('~', " "),
            " ",
        )
        .trim()
        .to_string()
}

fn clamp_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn build_plain_text_excerpt(markdown: &str) -> String {
    let plain_text = strip_markdown_to_plain_text(markdown);
    if plain_text.is_empty() {
        String::new()
    } else {
        clamp_chars(&plain_text, 180)
    }
}

fn resolve_note_title(explicit_title: Option<&str>, body_markdown: &str) -> String {
    if let Some(title) = explicit_title
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return clamp_chars(title, 100);
    }
    let plain_text = strip_markdown_to_plain_text(body_markdown);
    if let Some(first_line) = plain_text
        .lines()
        .map(str::trim)
        .find(|value| !value.is_empty())
    {
        return clamp_chars(first_line, 100);
    }
    format!("Note {}", Utc::now().format("%Y-%m-%d %H:%M"))
}

fn summarize_note(note: &WorkspaceNoteCard, archived: bool) -> WorkspaceNoteCardSummary {
    WorkspaceNoteCardSummary {
        id: note.id.clone(),
        title: note.title.clone(),
        plain_text_excerpt: note.plain_text_excerpt.clone(),
        updated_at: note.updated_at,
        created_at: note.created_at,
        archived_at: note.archived_at,
        archived,
        image_count: note.attachments.len(),
        preview_attachments: note
            .attachments
            .iter()
            .take(3)
            .map(|attachment| NoteCardPreviewAttachment {
                id: attachment.id.clone(),
                file_name: attachment.file_name.clone(),
                content_type: attachment.content_type.clone(),
                absolute_path: attachment.absolute_path.clone(),
            })
            .collect(),
    }
}

fn content_type_from_extension(extension: &str) -> Option<&'static str> {
    match extension.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "svg" => Some("image/svg+xml"),
        "tif" | "tiff" => Some("image/tiff"),
        _ => None,
    }
}

fn extension_from_content_type(content_type: &str) -> &'static str {
    match content_type {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        "image/tiff" => "tiff",
        _ => "img",
    }
}

fn sanitize_filename(value: &str, fallback_extension: Option<&str>) -> String {
    let raw = Path::new(value)
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or(value)
        .trim();
    let sanitized = raw
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let collapsed = sanitized
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if !collapsed.is_empty() && collapsed != "." && collapsed != ".." {
        return collapsed;
    }
    let extension_suffix = fallback_extension
        .map(|extension| format!(".{extension}"))
        .unwrap_or_default();
    format!("image{extension_suffix}")
}

fn normalize_attachment_path_key(value: &str) -> String {
    let trimmed = value.trim();
    let without_file_scheme = if let Some(rest) = trimmed.strip_prefix("file://localhost/") {
        if rest.starts_with('/') {
            rest.to_string()
        } else {
            format!("/{rest}")
        }
    } else if let Some(rest) = trimmed.strip_prefix("file://") {
        if rest.starts_with('/') {
            rest.to_string()
        } else {
            format!("/{rest}")
        }
    } else if let Some(rest) = trimmed.strip_prefix("asset://localhost/") {
        if rest.starts_with('/') {
            rest.to_string()
        } else {
            format!("/{rest}")
        }
    } else {
        trimmed.to_string()
    };
    let normalized = without_file_scheme.replace('\\', "/");
    if normalized.len() >= 3 {
        let bytes = normalized.as_bytes();
        if bytes[0] == b'/' && bytes[2] == b':' && bytes[1].is_ascii_alphabetic() {
            return normalized[1..].to_ascii_lowercase();
        }
    }
    if normalized.len() >= 2 {
        let bytes = normalized.as_bytes();
        if bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
            return normalized.to_ascii_lowercase();
        }
    }
    normalized
}

fn sanitize_attachment_relative_path(value: &str, fallback_file_name: Option<&str>) -> String {
    let normalized = normalize_attachment_path_key(value);
    let candidate = normalized
        .split('/')
        .rev()
        .map(str::trim)
        .find(|segment| !segment.is_empty() && *segment != "." && *segment != "..")
        .unwrap_or_default();
    let fallback = fallback_file_name.unwrap_or("image");
    if !candidate.is_empty() {
        sanitize_filename(candidate, None)
    } else {
        sanitize_filename(fallback, None)
    }
}

fn looks_like_absolute_attachment_input(value: &str) -> bool {
    let normalized = normalize_attachment_path_key(value);
    normalized.starts_with('/')
        || normalized.starts_with("//")
        || normalized.starts_with("file://")
        || normalized
            .as_bytes()
            .get(1)
            .zip(normalized.as_bytes().get(2))
            .map(|(colon, slash)| *colon == b':' && matches!(*slash, b'/' | b'\\'))
            .unwrap_or(false)
}

fn parse_data_url(value: &str) -> Result<(String, Vec<u8>), String> {
    if !value.starts_with("data:") {
        return Err("Attachment is not a data URL".to_string());
    }
    let Some((header, payload)) = value.split_once(',') else {
        return Err("Malformed data URL".to_string());
    };
    if !header.contains(";base64") {
        return Err("Only base64 data URLs are supported".to_string());
    }
    let content_type = header
        .trim_start_matches("data:")
        .split(';')
        .next()
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .unwrap_or("image/png")
        .to_string();
    if !content_type.starts_with("image/") {
        return Err("Only image note attachments are supported".to_string());
    }
    let bytes = BASE64_STANDARD
        .decode(payload.trim())
        .map_err(|error| error.to_string())?;
    if bytes.len() > MAX_NOTE_ATTACHMENT_BYTES {
        return Err(format!(
            "Image attachment is too large (max {} bytes).",
            MAX_NOTE_ATTACHMENT_BYTES
        ));
    }
    Ok((content_type, bytes))
}

fn match_existing_attachment<'a>(
    value: &str,
    existing_by_key: &'a HashMap<String, NoteCardAttachment>,
) -> Option<NoteCardAttachment> {
    let normalized = normalize_attachment_path_key(value);
    if let Some(attachment) = existing_by_key.get(&normalized) {
        return Some(attachment.clone());
    }
    if looks_like_absolute_attachment_input(value) {
        return None;
    }
    let relative_key = sanitize_attachment_relative_path(value, None);
    existing_by_key.get(&relative_key).cloned()
}

fn cleanup_stale_assets(
    asset_dir: &Path,
    keep_relative_paths: &HashSet<String>,
) -> Result<(), String> {
    if !asset_dir.exists() {
        return Ok(());
    }
    let entries = std::fs::read_dir(asset_dir).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let relative_name = entry.file_name().to_string_lossy().to_string();
        if keep_relative_paths.contains(&relative_name) {
            continue;
        }
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    let mut remaining_entries = std::fs::read_dir(asset_dir).map_err(|error| error.to_string())?;
    if remaining_entries.next().is_none() {
        std::fs::remove_dir(asset_dir).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn remove_note_assets(project_dir: &Path, note_id: &str) -> Result<(), String> {
    let asset_dir = note_asset_dir(project_dir, note_id);
    if !asset_dir.exists() {
        return Ok(());
    }
    if asset_dir.is_dir() {
        std::fs::remove_dir_all(&asset_dir).map_err(|error| error.to_string())?;
    } else {
        std::fs::remove_file(&asset_dir).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn delete_note_card_files(project_dir: &Path, note_id: &str) -> Result<bool, String> {
    let note_path = find_note_card_path_in_project_dir(project_dir, note_id)?.map(|(path, _)| path);
    let asset_dir = note_asset_dir(project_dir, note_id);
    if note_path.is_none() && !asset_dir.exists() {
        return Ok(false);
    }

    if let Some(path) = note_path {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }

    if asset_dir.exists() {
        remove_note_assets(project_dir, note_id)?;
    }

    Ok(true)
}

fn materialize_attachments(
    project_dir: &Path,
    note_id: &str,
    attachment_inputs: Option<Vec<String>>,
    existing_attachments: &[NoteCardAttachment],
) -> Result<Vec<NoteCardAttachment>, String> {
    let Some(inputs) = attachment_inputs else {
        return Ok(existing_attachments.to_vec());
    };

    let asset_dir = note_asset_dir(project_dir, note_id);
    if !inputs.is_empty() {
        std::fs::create_dir_all(&asset_dir).map_err(|error| error.to_string())?;
    }

    let mut existing_by_key = HashMap::new();
    for attachment in existing_attachments {
        existing_by_key.insert(
            normalize_attachment_path_key(&attachment.absolute_path),
            attachment.clone(),
        );
        let relative_key = sanitize_attachment_relative_path(
            &attachment.relative_path,
            Some(&attachment.file_name),
        );
        existing_by_key.insert(relative_key, attachment.clone());
    }

    let mut used_relative_paths = HashSet::new();
    let mut seen_input_keys = HashSet::new();
    let mut next_attachments = Vec::new();

    for raw_input in inputs {
        let input = raw_input.trim();
        if input.is_empty() {
            continue;
        }
        let input_key = normalize_attachment_path_key(input);
        if !seen_input_keys.insert(input_key) {
            continue;
        }

        if let Some(existing_attachment) = match_existing_attachment(input, &existing_by_key) {
            if used_relative_paths.contains(&existing_attachment.relative_path) {
                continue;
            }
            used_relative_paths.insert(existing_attachment.relative_path.clone());
            next_attachments.push(existing_attachment);
            continue;
        }

        let attachment_id = uuid::Uuid::new_v4().to_string();
        let (content_type, bytes, file_name) = if input.starts_with("data:") {
            let (resolved_content_type, decoded_bytes) = parse_data_url(input)?;
            let extension = extension_from_content_type(&resolved_content_type);
            (
                resolved_content_type,
                decoded_bytes,
                sanitize_filename(&format!("image.{extension}"), Some(extension)),
            )
        } else {
            let source_path = PathBuf::from(input);
            if !source_path.exists() {
                return Err(format!("Attachment source not found: {input}"));
            }
            let extension = source_path
                .extension()
                .and_then(OsStr::to_str)
                .unwrap_or_default()
                .to_string();
            let resolved_content_type = content_type_from_extension(&extension)
                .ok_or_else(|| format!("Unsupported image attachment: {input}"))?;
            let content_type = resolved_content_type.to_string();
            let bytes = std::fs::read(&source_path).map_err(|error| error.to_string())?;
            if bytes.len() > MAX_NOTE_ATTACHMENT_BYTES {
                return Err(format!(
                    "Image attachment is too large (max {} bytes).",
                    MAX_NOTE_ATTACHMENT_BYTES
                ));
            }
            let file_name = sanitize_filename(
                source_path
                    .file_name()
                    .and_then(OsStr::to_str)
                    .unwrap_or("image"),
                Some(extension_from_content_type(&content_type)),
            );
            (content_type, bytes, file_name)
        };

        let mut collision_index = 0usize;
        let relative_path = loop {
            let suffix = if collision_index == 0 {
                String::new()
            } else {
                format!("-{collision_index}")
            };
            let candidate = format!("{}{}-{file_name}", &attachment_id[..8], suffix);
            if !used_relative_paths.contains(&candidate) {
                break candidate;
            }
            collision_index = collision_index.saturating_add(1);
        };
        let destination_path = asset_dir.join(&relative_path);
        std::fs::write(&destination_path, &bytes).map_err(|error| error.to_string())?;
        used_relative_paths.insert(relative_path.clone());
        next_attachments.push(NoteCardAttachment {
            id: attachment_id,
            file_name,
            content_type,
            relative_path: relative_path.clone(),
            absolute_path: destination_path.to_string_lossy().to_string(),
            size_bytes: bytes.len() as u64,
        });
    }

    cleanup_stale_assets(&asset_dir, &used_relative_paths)?;
    Ok(next_attachments)
}

fn find_note_card_path_in_project_dir(
    project_dir: &Path,
    note_id: &str,
) -> Result<Option<(PathBuf, bool)>, String> {
    let active_path = note_file_path(project_dir, note_id, false);
    if active_path.exists() {
        return Ok(Some((active_path, false)));
    }
    let archive_path = note_file_path(project_dir, note_id, true);
    if archive_path.exists() {
        return Ok(Some((archive_path, true)));
    }
    Ok(None)
}

#[derive(Debug, Clone)]
struct NoteCardLocation {
    project_dir: PathBuf,
    note_path: PathBuf,
    archived: bool,
}

fn list_candidate_project_dirs(
    base: &Path,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
    workspace_path: Option<&str>,
) -> Result<Vec<PathBuf>, String> {
    let preferred = project_dir_path(base, workspace_id, workspace_name, workspace_path);
    let mut candidates = vec![preferred.clone()];
    if !base.exists() {
        return Ok(candidates);
    }
    let entries = std::fs::read_dir(base).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if !file_type.is_dir() {
            continue;
        }
        let path = entry.path();
        if path != preferred {
            candidates.push(path);
        }
    }
    Ok(candidates)
}

fn workspace_id_matches(note_workspace_id: &str, expected_workspace_id: Option<&str>) -> bool {
    let expected = expected_workspace_id.map(str::trim).unwrap_or_default();
    expected.is_empty()
        || note_workspace_id.trim().is_empty()
        || note_workspace_id.trim() == expected
}

fn resolve_note_card_location(
    base: &Path,
    note_id: &str,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
    workspace_path: Option<&str>,
) -> Result<Option<NoteCardLocation>, String> {
    let candidates =
        list_candidate_project_dirs(base, workspace_id, workspace_name, workspace_path)?;
    for project_dir in candidates {
        let Some((note_path, archived)) =
            find_note_card_path_in_project_dir(&project_dir, note_id)?
        else {
            continue;
        };
        match read_note_card(&note_path, &project_dir, archived) {
            Ok(note) => {
                if workspace_id_matches(&note.workspace_id, workspace_id) {
                    return Ok(Some(NoteCardLocation {
                        project_dir,
                        note_path,
                        archived,
                    }));
                }
            }
            Err(error) => {
                log::warn!(
                    "Failed to read candidate note card {} while resolving {}: {}",
                    note_path.display(),
                    note_id,
                    error
                );
            }
        }
    }
    Ok(None)
}

fn move_directory_contents(source: &Path, target: &Path) -> Result<(), String> {
    std::fs::create_dir_all(target).map_err(|error| error.to_string())?;
    let entries = std::fs::read_dir(source).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            move_directory_contents(&source_path, &target_path)?;
            std::fs::remove_dir(&source_path).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        std::fs::copy(&source_path, &target_path).map_err(|error| error.to_string())?;
        std::fs::remove_file(&source_path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn relocate_note_assets(
    source_project_dir: &Path,
    target_project_dir: &Path,
    note_id: &str,
) -> Result<(), String> {
    if source_project_dir == target_project_dir {
        return Ok(());
    }
    let source_asset_dir = note_asset_dir(source_project_dir, note_id);
    if !source_asset_dir.exists() {
        return Ok(());
    }
    let target_asset_dir = note_asset_dir(target_project_dir, note_id);
    if target_asset_dir.exists() {
        if target_asset_dir.is_dir() {
            std::fs::remove_dir_all(&target_asset_dir).map_err(|error| error.to_string())?;
        } else {
            std::fs::remove_file(&target_asset_dir).map_err(|error| error.to_string())?;
        }
    }
    if let Some(parent) = target_asset_dir.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if let Err(error) = std::fs::rename(&source_asset_dir, &target_asset_dir) {
        log::warn!(
            "Failed to rename note asset dir from {} to {}: {}. Falling back to copy.",
            source_asset_dir.display(),
            target_asset_dir.display(),
            error
        );
        move_directory_contents(&source_asset_dir, &target_asset_dir)?;
        std::fs::remove_dir_all(&source_asset_dir)
            .map_err(|remove_error| remove_error.to_string())?;
    }
    Ok(())
}

fn collect_workspace_note_summaries(
    base: &Path,
    workspace_id: Option<&str>,
    workspace_name: Option<&str>,
    workspace_path: Option<&str>,
    archived: bool,
    query: Option<&str>,
) -> Result<Vec<WorkspaceNoteCardSummary>, String> {
    let normalized_query = query.unwrap_or_default().trim().to_lowercase();
    let mut items_by_id: HashMap<String, WorkspaceNoteCardSummary> = HashMap::new();
    for project_dir in
        list_candidate_project_dirs(base, workspace_id, workspace_name, workspace_path)?
    {
        let collection_dir = if archived {
            archive_collection_dir(&project_dir)
        } else {
            active_collection_dir(&project_dir)
        };
        if !collection_dir.exists() {
            continue;
        }
        let entries = std::fs::read_dir(&collection_dir).map_err(|error| error.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if path.extension().and_then(OsStr::to_str) != Some("json") {
                continue;
            }
            match read_note_card(&path, &project_dir, archived) {
                Ok(note) => {
                    if !workspace_id_matches(&note.workspace_id, workspace_id) {
                        continue;
                    }
                    if !normalized_query.is_empty() {
                        let haystack = format!(
                            "{} {} {}",
                            note.title.to_lowercase(),
                            note.plain_text_excerpt.to_lowercase(),
                            strip_markdown_to_plain_text(&note.body_markdown).to_lowercase(),
                        );
                        if !haystack.contains(&normalized_query) {
                            continue;
                        }
                    }
                    let summary = summarize_note(&note, archived);
                    match items_by_id.get(&summary.id) {
                        Some(existing) if existing.updated_at >= summary.updated_at => {}
                        _ => {
                            items_by_id.insert(summary.id.clone(), summary);
                        }
                    }
                }
                Err(error) => {
                    log::warn!("Failed to read note card {}: {}", path.display(), error);
                }
            }
        }
    }
    Ok(items_by_id.into_values().collect())
}

#[cfg(test)]
fn read_collection_summaries(
    project_dir: &Path,
    archived: bool,
) -> Result<Vec<WorkspaceNoteCardSummary>, String> {
    let collection_dir = if archived {
        archive_collection_dir(project_dir)
    } else {
        active_collection_dir(project_dir)
    };
    if !collection_dir.exists() {
        return Ok(Vec::new());
    }
    let mut items = Vec::new();
    let entries = std::fs::read_dir(&collection_dir).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(OsStr::to_str) != Some("json") {
            continue;
        }
        match read_note_card(&path, project_dir, archived) {
            Ok(note) => items.push(summarize_note(&note, archived)),
            Err(error) => {
                log::warn!("Failed to read note card {}: {}", path.display(), error);
            }
        }
    }
    Ok(items)
}

#[tauri::command]
pub(crate) fn note_card_list(
    workspace_id: String,
    workspace_name: Option<String>,
    workspace_path: Option<String>,
    archived: bool,
    query: Option<String>,
    page: Option<usize>,
    page_size: Option<usize>,
) -> Result<WorkspaceNoteCardListResult, String> {
    with_file_lock(|| {
        let base = storage_dir()?;
        if !base.exists() {
            return Ok(WorkspaceNoteCardListResult {
                items: Vec::new(),
                total: 0,
            });
        }
        let normalized_query = query.as_deref().unwrap_or("").trim().to_lowercase();
        let mut items = collect_workspace_note_summaries(
            &base,
            Some(workspace_id.as_str()),
            workspace_name.as_deref(),
            workspace_path.as_deref(),
            archived,
            Some(normalized_query.as_str()),
        )?;
        items.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        let total = items.len();
        let page_index = page.unwrap_or(0);
        let page_limit = page_size.unwrap_or(100).clamp(1, 200);
        let start = page_index.saturating_mul(page_limit);
        let paged = if start >= items.len() {
            Vec::new()
        } else {
            let end = (start + page_limit).min(items.len());
            items[start..end].to_vec()
        };
        Ok(WorkspaceNoteCardListResult {
            items: paged,
            total,
        })
    })
}

#[tauri::command]
pub(crate) fn note_card_get(
    note_id: String,
    workspace_id: String,
    workspace_name: Option<String>,
    workspace_path: Option<String>,
) -> Result<Option<WorkspaceNoteCard>, String> {
    with_file_lock(|| {
        let base = storage_dir()?;
        let Some(location) = resolve_note_card_location(
            &base,
            &note_id,
            Some(workspace_id.as_str()),
            workspace_name.as_deref(),
            workspace_path.as_deref(),
        )?
        else {
            return Ok(None);
        };
        let mut note = read_note_card(
            &location.note_path,
            &location.project_dir,
            location.archived,
        )?;
        if note.workspace_id.trim().is_empty() {
            note.workspace_id = workspace_id;
        }
        Ok(Some(note))
    })
}

#[tauri::command]
pub(crate) fn note_card_create(
    input: CreateWorkspaceNoteCardInput,
) -> Result<WorkspaceNoteCard, String> {
    with_file_lock(|| {
        let base = storage_dir()?;
        let project_name = derive_project_name(
            Some(input.workspace_id.as_str()),
            input.workspace_name.as_deref(),
            input.workspace_path.as_deref(),
        );
        let project_dir = project_dir_path(
            &base,
            Some(input.workspace_id.as_str()),
            input.workspace_name.as_deref(),
            input.workspace_path.as_deref(),
        );
        ensure_project_dirs(&project_dir)?;
        let note_id = uuid::Uuid::new_v4().to_string();
        let body_markdown = input.body_markdown.trim().to_string();
        let attachments =
            materialize_attachments(&project_dir, &note_id, input.attachment_inputs.clone(), &[])?;
        let current_ms = now_ms();
        let note = WorkspaceNoteCard {
            id: note_id.clone(),
            workspace_id: input.workspace_id.clone(),
            workspace_name: input.workspace_name.clone(),
            workspace_path: input.workspace_path.clone(),
            project_name,
            title: resolve_note_title(input.title.as_deref(), &body_markdown),
            body_markdown: body_markdown.clone(),
            plain_text_excerpt: build_plain_text_excerpt(&body_markdown),
            attachments,
            created_at: current_ms,
            updated_at: current_ms,
            archived_at: None,
        };
        let path = note_file_path(&project_dir, &note_id, false);
        write_note_card(&path, &note)?;
        Ok(note)
    })
}

#[tauri::command]
pub(crate) fn note_card_update(
    note_id: String,
    workspace_id: String,
    patch: UpdateWorkspaceNoteCardInput,
) -> Result<WorkspaceNoteCard, String> {
    with_file_lock(|| {
        let base = storage_dir()?;
        let Some(location) = resolve_note_card_location(
            &base,
            &note_id,
            Some(workspace_id.as_str()),
            patch.workspace_name.as_deref(),
            patch.workspace_path.as_deref(),
        )?
        else {
            return Err("note card not found".to_string());
        };
        let mut note = read_note_card(
            &location.note_path,
            &location.project_dir,
            location.archived,
        )?;
        let next_workspace_name = if patch.workspace_name.is_some() {
            patch.workspace_name.clone()
        } else {
            note.workspace_name.clone()
        };
        let next_workspace_path = if patch.workspace_path.is_some() {
            patch.workspace_path.clone()
        } else {
            note.workspace_path.clone()
        };
        let target_project_dir = project_dir_path(
            &base,
            Some(workspace_id.as_str()),
            next_workspace_name.as_deref(),
            next_workspace_path.as_deref(),
        );
        ensure_project_dirs(&target_project_dir)?;
        let body_markdown = patch
            .body_markdown
            .clone()
            .unwrap_or_else(|| note.body_markdown.clone())
            .trim()
            .to_string();
        let attachments = materialize_attachments(
            &location.project_dir,
            &note.id,
            patch.attachment_inputs.clone(),
            &note.attachments,
        )?;
        note.workspace_id = workspace_id;
        note.workspace_name = next_workspace_name;
        note.workspace_path = next_workspace_path;
        note.project_name = derive_project_name(
            Some(note.workspace_id.as_str()),
            note.workspace_name.as_deref(),
            note.workspace_path.as_deref(),
        );
        note.title = resolve_note_title(
            patch.title.as_deref().or(Some(note.title.as_str())),
            &body_markdown,
        );
        note.body_markdown = body_markdown.clone();
        note.plain_text_excerpt = build_plain_text_excerpt(&body_markdown);
        note.attachments = attachments;
        note.updated_at = now_ms();
        relocate_note_assets(&location.project_dir, &target_project_dir, &note.id)?;
        note.attachments = note
            .attachments
            .into_iter()
            .map(|attachment| hydrate_attachment_path(&target_project_dir, &note.id, attachment))
            .collect();
        let target_note_path = note_file_path(&target_project_dir, &note.id, location.archived);
        write_note_card(&target_note_path, &note)?;
        if location.note_path != target_note_path && location.note_path.exists() {
            std::fs::remove_file(&location.note_path).map_err(|error| error.to_string())?;
        }
        Ok(note)
    })
}

#[tauri::command]
pub(crate) fn note_card_archive(
    note_id: String,
    workspace_id: String,
    workspace_name: Option<String>,
    workspace_path: Option<String>,
) -> Result<WorkspaceNoteCard, String> {
    with_file_lock(|| {
        let base = storage_dir()?;
        let Some(location) = resolve_note_card_location(
            &base,
            &note_id,
            Some(workspace_id.as_str()),
            workspace_name.as_deref(),
            workspace_path.as_deref(),
        )?
        else {
            return Err("note card not found in active collection".to_string());
        };
        if location.archived {
            return Err("note card not found in active collection".to_string());
        }
        let mut note = read_note_card(&location.note_path, &location.project_dir, false)?;
        note.updated_at = now_ms();
        note.archived_at = Some(note.updated_at);
        let archive_path = note_file_path(&location.project_dir, &note_id, true);
        write_note_card(&archive_path, &note)?;
        std::fs::remove_file(&location.note_path).map_err(|error| error.to_string())?;
        Ok(note)
    })
}

#[tauri::command]
pub(crate) fn note_card_restore(
    note_id: String,
    workspace_id: String,
    workspace_name: Option<String>,
    workspace_path: Option<String>,
) -> Result<WorkspaceNoteCard, String> {
    with_file_lock(|| {
        let base = storage_dir()?;
        let Some(location) = resolve_note_card_location(
            &base,
            &note_id,
            Some(workspace_id.as_str()),
            workspace_name.as_deref(),
            workspace_path.as_deref(),
        )?
        else {
            return Err("note card not found in archive collection".to_string());
        };
        if !location.archived {
            return Err("note card not found in archive collection".to_string());
        }
        let mut note = read_note_card(&location.note_path, &location.project_dir, true)?;
        note.updated_at = now_ms();
        note.archived_at = None;
        let active_path = note_file_path(&location.project_dir, &note_id, false);
        write_note_card(&active_path, &note)?;
        std::fs::remove_file(&location.note_path).map_err(|error| error.to_string())?;
        Ok(note)
    })
}

#[tauri::command]
pub(crate) fn note_card_delete(
    note_id: String,
    workspace_id: String,
    workspace_name: Option<String>,
    workspace_path: Option<String>,
) -> Result<(), String> {
    with_file_lock(|| {
        let base = storage_dir()?;
        let Some(location) = resolve_note_card_location(
            &base,
            &note_id,
            Some(workspace_id.as_str()),
            workspace_name.as_deref(),
            workspace_path.as_deref(),
        )?
        else {
            return Err("note card not found".to_string());
        };
        let deleted = delete_note_card_files(&location.project_dir, &note_id)?;
        if !deleted {
            return Err("note card not found".to_string());
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_project_dir(
        base: &Path,
        workspace_id: Option<&str>,
        workspace_name: Option<&str>,
        workspace_path: Option<&str>,
    ) -> PathBuf {
        project_dir_path(base, workspace_id, workspace_name, workspace_path)
    }

    #[test]
    fn derives_project_name_from_workspace_path_basename() {
        let derived = derive_project_name(
            Some("workspace-123"),
            Some("Alias Name"),
            Some("/tmp/My Fancy Repo"),
        );
        assert_eq!(derived, "my-fancy-repo");
    }

    #[test]
    fn derives_project_name_from_workspace_id_when_name_and_path_are_missing() {
        let derived = derive_project_name(Some("workspace-123"), None, None);
        assert_eq!(derived, "workspace-123");
    }

    #[test]
    fn create_archive_and_restore_note_card_roundtrip() {
        let base = std::env::temp_dir().join(format!("note-card-tests-{}", uuid::Uuid::new_v4()));
        let project_dir =
            test_project_dir(&base, Some("workspace-1"), Some("Repo"), Some("/tmp/repo"));
        ensure_project_dirs(&project_dir).expect("create project dirs");

        let created = {
            let note_id = uuid::Uuid::new_v4().to_string();
            let body_markdown = "## Idea\nhello world".to_string();
            let note = WorkspaceNoteCard {
                id: note_id.clone(),
                workspace_id: "workspace-1".to_string(),
                workspace_name: Some("Repo".to_string()),
                workspace_path: Some("/tmp/repo".to_string()),
                project_name: derive_project_name(
                    Some("workspace-1"),
                    Some("Repo"),
                    Some("/tmp/repo"),
                ),
                title: resolve_note_title(None, &body_markdown),
                body_markdown: body_markdown.clone(),
                plain_text_excerpt: build_plain_text_excerpt(&body_markdown),
                attachments: Vec::new(),
                created_at: now_ms(),
                updated_at: now_ms(),
                archived_at: None,
            };
            let path = note_file_path(&project_dir, &note_id, false);
            write_note_card(&path, &note).expect("write active note");
            note
        };

        let active_items = read_collection_summaries(&project_dir, false).expect("list active");
        assert_eq!(active_items.len(), 1);
        assert_eq!(active_items[0].title, created.title);

        let mut archived_note = read_note_card(
            &note_file_path(&project_dir, &created.id, false),
            &project_dir,
            false,
        )
        .expect("read note before archive");
        archived_note.archived_at = Some(now_ms());
        let archive_path = note_file_path(&project_dir, &created.id, true);
        write_note_card(&archive_path, &archived_note).expect("write archived note");
        std::fs::remove_file(note_file_path(&project_dir, &created.id, false))
            .expect("remove active note");

        let archived_items = read_collection_summaries(&project_dir, true).expect("list archive");
        assert_eq!(archived_items.len(), 1);
        assert!(archived_items[0].archived);

        let restored =
            read_note_card(&archive_path, &project_dir, true).expect("read archived note");
        assert_eq!(restored.id, created.id);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn summarize_note_includes_preview_attachments() {
        let note = WorkspaceNoteCard {
            id: "note-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            workspace_name: Some("Repo".to_string()),
            workspace_path: Some("/tmp/repo".to_string()),
            project_name: "repo".to_string(),
            title: "Preview note".to_string(),
            body_markdown: "body".to_string(),
            plain_text_excerpt: "body".to_string(),
            attachments: vec![
                NoteCardAttachment {
                    id: "attachment-1".to_string(),
                    file_name: "image-1.png".to_string(),
                    content_type: "image/png".to_string(),
                    relative_path: "image-1.png".to_string(),
                    absolute_path: "/tmp/repo/assets/note-1/image-1.png".to_string(),
                    size_bytes: 4,
                },
                NoteCardAttachment {
                    id: "attachment-2".to_string(),
                    file_name: "image-2.png".to_string(),
                    content_type: "image/png".to_string(),
                    relative_path: "image-2.png".to_string(),
                    absolute_path: "/tmp/repo/assets/note-1/image-2.png".to_string(),
                    size_bytes: 4,
                },
                NoteCardAttachment {
                    id: "attachment-3".to_string(),
                    file_name: "image-3.png".to_string(),
                    content_type: "image/png".to_string(),
                    relative_path: "image-3.png".to_string(),
                    absolute_path: "/tmp/repo/assets/note-1/image-3.png".to_string(),
                    size_bytes: 4,
                },
                NoteCardAttachment {
                    id: "attachment-4".to_string(),
                    file_name: "image-4.png".to_string(),
                    content_type: "image/png".to_string(),
                    relative_path: "image-4.png".to_string(),
                    absolute_path: "/tmp/repo/assets/note-1/image-4.png".to_string(),
                    size_bytes: 4,
                },
            ],
            created_at: now_ms(),
            updated_at: now_ms(),
            archived_at: None,
        };

        let summary = summarize_note(&note, false);
        assert_eq!(summary.image_count, 4);
        assert_eq!(summary.preview_attachments.len(), 3);
        assert_eq!(summary.preview_attachments[0].file_name, "image-1.png");
        assert_eq!(summary.preview_attachments[2].file_name, "image-3.png");
    }

    #[test]
    fn delete_note_card_removes_document_and_assets() {
        let base =
            std::env::temp_dir().join(format!("note-card-delete-tests-{}", uuid::Uuid::new_v4()));
        let project_dir =
            test_project_dir(&base, Some("workspace-1"), Some("Repo"), Some("/tmp/repo"));
        ensure_project_dirs(&project_dir).expect("create project dirs");

        let note_id = uuid::Uuid::new_v4().to_string();
        let note = WorkspaceNoteCard {
            id: note_id.clone(),
            workspace_id: "workspace-1".to_string(),
            workspace_name: Some("Repo".to_string()),
            workspace_path: Some("/tmp/repo".to_string()),
            project_name: derive_project_name(Some("workspace-1"), Some("Repo"), Some("/tmp/repo")),
            title: "Delete me".to_string(),
            body_markdown: "body".to_string(),
            plain_text_excerpt: "body".to_string(),
            attachments: vec![NoteCardAttachment {
                id: uuid::Uuid::new_v4().to_string(),
                file_name: "image.png".to_string(),
                content_type: "image/png".to_string(),
                relative_path: "preview-image.png".to_string(),
                absolute_path: note_asset_dir(&project_dir, &note_id)
                    .join("preview-image.png")
                    .to_string_lossy()
                    .to_string(),
                size_bytes: 4,
            }],
            created_at: now_ms(),
            updated_at: now_ms(),
            archived_at: None,
        };

        let note_path = note_file_path(&project_dir, &note_id, false);
        write_note_card(&note_path, &note).expect("write note");
        let asset_dir = note_asset_dir(&project_dir, &note_id);
        std::fs::create_dir_all(&asset_dir).expect("create asset dir");
        std::fs::write(asset_dir.join("preview-image.png"), b"test").expect("write image");

        let deleted = delete_note_card_files(&project_dir, &note_id).expect("delete note");
        assert!(deleted);
        assert!(!note_path.exists());
        assert!(!asset_dir.exists());

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn sanitize_attachment_path_stays_inside_note_asset_dir() {
        let base =
            std::env::temp_dir().join(format!("note-card-hydrate-tests-{}", uuid::Uuid::new_v4()));
        let project_dir =
            test_project_dir(&base, Some("workspace-1"), Some("Repo"), Some("/tmp/repo"));
        let hydrated = hydrate_attachment_path(
            &project_dir,
            "note-1",
            NoteCardAttachment {
                id: "attachment-1".to_string(),
                file_name: "image.png".to_string(),
                content_type: "image/png".to_string(),
                relative_path: "../../escape.png".to_string(),
                absolute_path: String::new(),
                size_bytes: 4,
            },
        );
        let asset_dir = note_asset_dir(&project_dir, "note-1");
        assert_eq!(hydrated.relative_path, "escape.png");
        assert!(Path::new(&hydrated.absolute_path).starts_with(&asset_dir));
    }

    #[test]
    fn resolve_note_card_location_falls_back_to_workspace_id_scan() {
        let base =
            std::env::temp_dir().join(format!("note-card-location-tests-{}", uuid::Uuid::new_v4()));
        let original_project_dir = test_project_dir(
            &base,
            Some("workspace-1"),
            Some("Repo"),
            Some("/tmp/original-repo"),
        );
        let renamed_project_dir = test_project_dir(
            &base,
            Some("workspace-1"),
            Some("Renamed Repo"),
            Some("/tmp/renamed-repo"),
        );
        ensure_project_dirs(&original_project_dir).expect("create original project dirs");
        ensure_project_dirs(&renamed_project_dir).expect("create renamed project dirs");

        let note_id = uuid::Uuid::new_v4().to_string();
        let note = WorkspaceNoteCard {
            id: note_id.clone(),
            workspace_id: "workspace-1".to_string(),
            workspace_name: Some("Repo".to_string()),
            workspace_path: Some("/tmp/original-repo".to_string()),
            project_name: derive_project_name(
                Some("workspace-1"),
                Some("Repo"),
                Some("/tmp/original-repo"),
            ),
            title: "Keep me".to_string(),
            body_markdown: "body".to_string(),
            plain_text_excerpt: "body".to_string(),
            attachments: Vec::new(),
            created_at: now_ms(),
            updated_at: now_ms(),
            archived_at: None,
        };
        let note_path = note_file_path(&original_project_dir, &note_id, false);
        write_note_card(&note_path, &note).expect("write original note");

        let located = resolve_note_card_location(
            &base,
            &note_id,
            Some("workspace-1"),
            Some("Renamed Repo"),
            Some("/tmp/renamed-repo"),
        )
        .expect("resolve note location")
        .expect("location exists");

        assert_eq!(located.project_dir, original_project_dir);
        assert_eq!(located.note_path, note_path);
        assert!(!located.archived);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn normalize_attachment_path_key_handles_file_and_asset_variants() {
        assert_eq!(
            normalize_attachment_path_key("file:///C:/Users/Test/Image.png"),
            "c:/users/test/image.png"
        );
        assert_eq!(
            normalize_attachment_path_key("asset://localhost//tmp/demo/image.png"),
            "/tmp/demo/image.png"
        );
    }

    #[test]
    fn materialize_attachments_skips_duplicate_existing_paths() {
        let base = std::env::temp_dir().join(format!(
            "note-card-attachment-dedupe-tests-{}",
            uuid::Uuid::new_v4()
        ));
        let project_dir =
            test_project_dir(&base, Some("workspace-1"), Some("Repo"), Some("/tmp/repo"));
        ensure_project_dirs(&project_dir).expect("create project dirs");
        let note_id = "note-1";
        let asset_dir = note_asset_dir(&project_dir, note_id);
        std::fs::create_dir_all(&asset_dir).expect("create asset dir");
        let existing_attachment = NoteCardAttachment {
            id: "attachment-1".to_string(),
            file_name: "image.png".to_string(),
            content_type: "image/png".to_string(),
            relative_path: "attachment-image.png".to_string(),
            absolute_path: asset_dir
                .join("attachment-image.png")
                .to_string_lossy()
                .to_string(),
            size_bytes: 4,
        };
        std::fs::write(&existing_attachment.absolute_path, b"test").expect("write image");

        let next = materialize_attachments(
            &project_dir,
            note_id,
            Some(vec![
                existing_attachment.absolute_path.clone(),
                existing_attachment.absolute_path.clone(),
            ]),
            &[existing_attachment.clone()],
        )
        .expect("materialize attachments");

        assert_eq!(next.len(), 1);
        assert_eq!(next[0].relative_path, existing_attachment.relative_path);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn collect_workspace_note_summaries_matches_full_body_query() {
        let base =
            std::env::temp_dir().join(format!("note-card-search-tests-{}", uuid::Uuid::new_v4()));
        let project_dir =
            test_project_dir(&base, Some("workspace-1"), Some("Repo"), Some("/tmp/repo"));
        ensure_project_dirs(&project_dir).expect("create project dirs");

        let long_prefix = "前缀内容".repeat(80);
        let body = format!("{long_prefix}\n\n深层关键词 body-keyword");
        let note = WorkspaceNoteCard {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: "workspace-1".to_string(),
            workspace_name: Some("Repo".to_string()),
            workspace_path: Some("/tmp/repo".to_string()),
            project_name: derive_project_name(Some("workspace-1"), Some("Repo"), Some("/tmp/repo")),
            title: "Search me".to_string(),
            body_markdown: body.clone(),
            plain_text_excerpt: build_plain_text_excerpt(&body),
            attachments: Vec::new(),
            created_at: now_ms(),
            updated_at: now_ms(),
            archived_at: None,
        };
        write_note_card(&note_file_path(&project_dir, &note.id, false), &note).expect("write note");

        let matched = collect_workspace_note_summaries(
            &base,
            Some("workspace-1"),
            Some("Repo"),
            Some("/tmp/repo"),
            false,
            Some("body-keyword"),
        )
        .expect("collect summaries");

        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0].id, note.id);

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn resolve_note_card_location_skips_corrupted_candidate_and_finds_valid_note() {
        let base = std::env::temp_dir().join(format!(
            "note-card-corrupted-location-tests-{}",
            uuid::Uuid::new_v4()
        ));
        let preferred_project_dir = test_project_dir(
            &base,
            Some("workspace-1"),
            Some("Renamed Repo"),
            Some("/tmp/renamed-repo"),
        );
        let fallback_project_dir =
            test_project_dir(&base, Some("workspace-1"), Some("Repo"), Some("/tmp/repo"));
        ensure_project_dirs(&preferred_project_dir).expect("create preferred project dirs");
        ensure_project_dirs(&fallback_project_dir).expect("create fallback project dirs");

        let note_id = uuid::Uuid::new_v4().to_string();
        std::fs::write(
            note_file_path(&preferred_project_dir, &note_id, false),
            "{ not-valid-json",
        )
        .expect("write corrupted preferred note");

        let valid_note = WorkspaceNoteCard {
            id: note_id.clone(),
            workspace_id: "workspace-1".to_string(),
            workspace_name: Some("Repo".to_string()),
            workspace_path: Some("/tmp/repo".to_string()),
            project_name: derive_project_name(Some("workspace-1"), Some("Repo"), Some("/tmp/repo")),
            title: "Valid".to_string(),
            body_markdown: "body".to_string(),
            plain_text_excerpt: "body".to_string(),
            attachments: Vec::new(),
            created_at: now_ms(),
            updated_at: now_ms(),
            archived_at: None,
        };
        let fallback_note_path = note_file_path(&fallback_project_dir, &note_id, false);
        write_note_card(&fallback_note_path, &valid_note).expect("write valid note");

        let located = resolve_note_card_location(
            &base,
            &note_id,
            Some("workspace-1"),
            Some("Renamed Repo"),
            Some("/tmp/renamed-repo"),
        )
        .expect("resolve note location")
        .expect("location exists");

        assert_eq!(located.project_dir, fallback_project_dir);
        assert_eq!(located.note_path, fallback_note_path);

        std::fs::remove_dir_all(&base).ok();
    }
}
