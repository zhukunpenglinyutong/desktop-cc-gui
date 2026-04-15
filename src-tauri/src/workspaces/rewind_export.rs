use chrono::{Local, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, State};

use crate::app_paths;
use crate::remote_backend;
use crate::state::AppState;

static REWIND_EXPORT_FILE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RewindExportFileEntry {
    pub(crate) path: String,
    #[serde(default)]
    pub(crate) status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RewindExportResult {
    pub(crate) output_path: String,
    pub(crate) files_path: String,
    pub(crate) manifest_path: String,
    pub(crate) export_id: String,
    pub(crate) file_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RewindExportManifestEntry {
    source_path: String,
    stored_path: Option<String>,
    source_missing: bool,
    change_status: Option<String>,
    is_deleted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RewindExportManifest {
    schema_version: u32,
    engine: String,
    session_id: String,
    target_message_id: String,
    export_id: String,
    conversation_label: String,
    exported_at: String,
    workspace_root: String,
    files_dir: String,
    file_count: usize,
    files: Vec<RewindExportManifestEntry>,
}

fn sanitize_rewind_export_segment(value: &str, fallback: &str) -> String {
    let mut result = String::new();
    let mut previous_dash = false;
    for ch in value.trim().chars() {
        let next = if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            Some(ch)
        } else if ch.is_alphanumeric() {
            Some(ch)
        } else if ch.is_whitespace() || matches!(ch, '.' | ',' | '，' | '。' | '/' | '\\') {
            Some('-')
        } else {
            None
        };

        let Some(normalized) = next else {
            continue;
        };
        if normalized == '-' {
            if previous_dash || result.is_empty() {
                continue;
            }
            previous_dash = true;
            result.push('-');
            continue;
        }
        previous_dash = false;
        result.push(normalized);
    }
    let trimmed = result.trim_matches('-').trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn validate_rewind_export_engine(engine: &str) -> Result<&str, String> {
    match engine.trim() {
        "claude" | "codex" | "gemini" => Ok(engine.trim()),
        _ => Err("Unsupported rewind export engine.".to_string()),
    }
}

fn normalize_rewind_relative_source_path(path: &str) -> Result<PathBuf, String> {
    let normalized = path.trim().replace('\\', "/");
    let trimmed = normalized.trim_matches('/');
    if trimmed.is_empty() {
        return Err("File path cannot be empty.".to_string());
    }
    let relative = Path::new(trimmed);
    let mut output = PathBuf::new();
    for component in relative.components() {
        match component {
            Component::Normal(segment) => output.push(segment),
            Component::CurDir
            | Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => return Err("Invalid rewind file path.".to_string()),
        }
    }
    Ok(output)
}

fn decode_rewind_file_uri_component(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err("Invalid rewind file URI.".to_string());
            }
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3])
                .map_err(|_| "Invalid rewind file URI.".to_string())?;
            let value =
                u8::from_str_radix(hex, 16).map_err(|_| "Invalid rewind file URI.".to_string())?;
            decoded.push(value);
            index += 3;
            continue;
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(decoded).map_err(|_| "Invalid rewind file URI.".to_string())
}

fn parse_rewind_file_uri_path(path: &str) -> Result<Option<PathBuf>, String> {
    let trimmed = path.trim();
    if !trimmed.to_ascii_lowercase().starts_with("file://") {
        return Ok(None);
    }
    let without_scheme = &trimmed["file://".len()..];
    let (raw_host, raw_path) = match without_scheme.find('/') {
        Some(index) => (&without_scheme[..index], &without_scheme[index..]),
        None => (without_scheme, ""),
    };
    let host = decode_rewind_file_uri_component(raw_host)?;
    let pathname = decode_rewind_file_uri_component(raw_path)?;
    if pathname.is_empty() && host.is_empty() {
        return Err("Invalid rewind file URI.".to_string());
    }
    if host.is_empty() || host.eq_ignore_ascii_case("localhost") {
        if pathname.starts_with('/')
            && pathname.len() > 3
            && pathname.as_bytes()[2] == b':'
            && pathname.as_bytes()[3] == b'/'
            && pathname.as_bytes()[1].is_ascii_alphabetic()
        {
            return Ok(Some(PathBuf::from(&pathname[1..])));
        }
        return Ok(Some(PathBuf::from(pathname)));
    }
    Ok(Some(PathBuf::from(format!("//{host}{pathname}"))))
}

fn looks_like_windows_absolute_path(path: &str) -> bool {
    let trimmed = path.trim();
    if trimmed.len() >= 3 {
        let bytes = trimmed.as_bytes();
        if bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/')
        {
            return true;
        }
    }
    trimmed.starts_with("\\\\") || trimmed.starts_with("//")
}

fn is_explicit_absolute_rewind_path(path: &str) -> bool {
    Path::new(path.trim()).is_absolute()
        || looks_like_windows_absolute_path(path)
        || path.trim().to_ascii_lowercase().starts_with("file://")
}

fn resolve_rewind_source_path(
    canonical_workspace_root: &Path,
    raw_path: &str,
) -> Result<PathBuf, String> {
    if let Some(file_uri_path) = parse_rewind_file_uri_path(raw_path)? {
        return Ok(file_uri_path);
    }
    if Path::new(raw_path).is_absolute() || looks_like_windows_absolute_path(raw_path) {
        return Ok(PathBuf::from(raw_path));
    }
    Ok(canonical_workspace_root.join(normalize_rewind_relative_source_path(raw_path)?))
}

fn absolute_path_to_export_relative(path: &Path) -> PathBuf {
    let mut relative = PathBuf::from("external");
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => {
                let value = prefix.as_os_str().to_string_lossy().replace(':', "");
                relative.push(sanitize_rewind_export_segment(&value, "drive"));
            }
            Component::RootDir => {}
            Component::Normal(segment) => relative.push(segment),
            Component::CurDir | Component::ParentDir => {}
        }
    }
    relative
}

fn build_rewind_export_root(
    app_home: &Path,
    engine: &str,
    export_date: &str,
    session_id: &str,
    export_id: &str,
) -> PathBuf {
    let session_segment = sanitize_rewind_export_segment(session_id, "session");
    app_home
        .join("chat-diff")
        .join(engine)
        .join(export_date)
        .join(session_segment)
        .join(export_id)
}

fn build_rewind_export_files_dir(export_root: &Path) -> PathBuf {
    export_root.join("files")
}

fn build_rewind_export_manifest_path(export_root: &Path) -> PathBuf {
    export_root.join("manifest.json")
}

fn build_rewind_export_id(target_message_id: &str) -> String {
    sanitize_rewind_export_segment(target_message_id, "target")
}

fn resolve_rewind_destination_relative(
    canonical_workspace_root: &Path,
    source_path: &Path,
    raw_path: &str,
) -> Result<PathBuf, String> {
    if let Ok(stripped) = source_path.strip_prefix(canonical_workspace_root) {
        return Ok(stripped.to_path_buf());
    }
    if is_explicit_absolute_rewind_path(raw_path) {
        return Ok(absolute_path_to_export_relative(source_path));
    }
    normalize_rewind_relative_source_path(raw_path)
}

fn normalize_rewind_change_status(raw_status: Option<&str>) -> Option<&'static str> {
    let normalized = raw_status?.trim();
    if normalized.is_empty() {
        return None;
    }
    match normalized.to_ascii_lowercase().as_str() {
        "a" | "add" | "added" => Some("A"),
        "d" | "delete" | "deleted" | "remove" | "removed" => Some("D"),
        "r" | "rename" | "renamed" => Some("R"),
        "m" | "modify" | "modified" | "update" | "updated" => Some("M"),
        _ => None,
    }
}

fn try_read_deleted_file_from_git_head(
    canonical_workspace_root: &Path,
    source_path: &Path,
) -> Result<Option<(Vec<u8>, PathBuf, String)>, String> {
    let repo = match git2::Repository::discover(canonical_workspace_root) {
        Ok(repo) => repo,
        Err(_) => return Ok(None),
    };
    let repo_root = match repo.workdir() {
        Some(path) => path.to_path_buf(),
        None => return Ok(None),
    };
    let canonical_repo_root = repo_root
        .canonicalize()
        .unwrap_or_else(|_| repo_root.clone());
    let source_candidate = if source_path.is_absolute() {
        source_path.to_path_buf()
    } else {
        canonical_workspace_root.join(source_path)
    };
    let relative_to_repo = match source_candidate.strip_prefix(&canonical_repo_root) {
        Ok(relative) => relative.to_path_buf(),
        Err(_) => return Ok(None),
    };

    let head_tree = match repo.head().ok().and_then(|head| head.peel_to_tree().ok()) {
        Some(tree) => tree,
        None => return Ok(None),
    };
    let entry = match head_tree.get_path(&relative_to_repo) {
        Ok(entry) => entry,
        Err(_) => return Ok(None),
    };
    let blob = match repo.find_blob(entry.id()) {
        Ok(blob) => blob,
        Err(_) => return Ok(None),
    };
    Ok(Some((
        blob.content().to_vec(),
        relative_to_repo.clone(),
        canonical_repo_root
            .join(relative_to_repo)
            .to_string_lossy()
            .to_string(),
    )))
}

fn export_rewind_files_inner(
    workspace_root: &Path,
    app_home: &Path,
    engine: &str,
    session_id: &str,
    target_message_id: &str,
    conversation_label: &str,
    files: &[RewindExportFileEntry],
) -> Result<RewindExportResult, String> {
    let _guard = REWIND_EXPORT_FILE_LOCK
        .lock()
        .map_err(|_| "Failed to acquire rewind export file lock.".to_string())?;
    let normalized_engine = validate_rewind_export_engine(engine)?;
    let normalized_session_id = session_id.trim();
    if normalized_session_id.is_empty() {
        return Err("Session ID is required for rewind export.".to_string());
    }
    let normalized_target_message_id = target_message_id.trim();
    if normalized_target_message_id.is_empty() {
        return Err("Target message ID is required for rewind export.".to_string());
    }
    if files.is_empty() {
        return Err("At least one file is required for rewind export.".to_string());
    }

    let canonical_workspace_root = workspace_root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve workspace root: {err}"))?;
    let export_date = Local::now().format("%Y-%m-%d").to_string();
    let export_id = build_rewind_export_id(normalized_target_message_id);
    let export_root = build_rewind_export_root(
        app_home,
        normalized_engine,
        &export_date,
        normalized_session_id,
        &export_id,
    );
    if export_root.exists() {
        std::fs::remove_dir_all(&export_root)
            .map_err(|err| format!("Failed to replace rewind export directory: {err}"))?;
    }
    let files_root = build_rewind_export_files_dir(&export_root);
    std::fs::create_dir_all(&files_root)
        .map_err(|err| format!("Failed to create rewind export directory: {err}"))?;

    let mut manifest_files = Vec::with_capacity(files.len());
    for file in files {
        let raw_path = file.path.trim();
        if raw_path.is_empty() {
            return Err("Encountered empty rewind file path.".to_string());
        }
        let change_status = normalize_rewind_change_status(file.status.as_deref())
            .map(std::string::ToString::to_string);

        let source_path = resolve_rewind_source_path(&canonical_workspace_root, raw_path)?;
        let canonical_source = match source_path.canonicalize() {
            Ok(path) => path,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                let is_deleted = change_status.as_deref() == Some("D");
                if is_deleted {
                    if let Some((bytes, _repo_relative_path, canonical_from_git)) =
                        try_read_deleted_file_from_git_head(
                            &canonical_workspace_root,
                            &source_path,
                        )?
                    {
                        let destination_relative = resolve_rewind_destination_relative(
                            &canonical_workspace_root,
                            &source_path,
                            raw_path,
                        )?;
                        let stored_relative = PathBuf::from("files").join(&destination_relative);
                        let destination_path = export_root.join(&stored_relative);
                        if let Some(parent) = destination_path.parent() {
                            std::fs::create_dir_all(parent).map_err(|err| {
                                format!("Failed to create rewind export parent directory: {err}")
                            })?;
                        }
                        std::fs::write(&destination_path, bytes).map_err(|err| {
                            format!(
                                "Failed to export rewind file '{raw_path}' from git head: {err}"
                            )
                        })?;
                        manifest_files.push(RewindExportManifestEntry {
                            source_path: canonical_from_git,
                            stored_path: Some(stored_relative.to_string_lossy().replace('\\', "/")),
                            source_missing: true,
                            change_status: change_status.clone(),
                            is_deleted: true,
                        });
                        continue;
                    }
                }
                manifest_files.push(RewindExportManifestEntry {
                    source_path: source_path.to_string_lossy().to_string(),
                    stored_path: None,
                    source_missing: true,
                    change_status: change_status.clone(),
                    is_deleted,
                });
                continue;
            }
            Err(err) => {
                return Err(format!(
                    "Failed to resolve rewind source file '{raw_path}': {err}"
                ));
            }
        };
        let metadata = match std::fs::metadata(&canonical_source) {
            Ok(value) => value,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                let is_deleted = change_status.as_deref() == Some("D");
                if is_deleted {
                    if let Some((bytes, _repo_relative_path, canonical_from_git)) =
                        try_read_deleted_file_from_git_head(
                            &canonical_workspace_root,
                            &canonical_source,
                        )?
                    {
                        let destination_relative = resolve_rewind_destination_relative(
                            &canonical_workspace_root,
                            &canonical_source,
                            raw_path,
                        )?;
                        let stored_relative = PathBuf::from("files").join(&destination_relative);
                        let destination_path = export_root.join(&stored_relative);
                        if let Some(parent) = destination_path.parent() {
                            std::fs::create_dir_all(parent).map_err(|err| {
                                format!("Failed to create rewind export parent directory: {err}")
                            })?;
                        }
                        std::fs::write(&destination_path, bytes).map_err(|err| {
                            format!(
                                "Failed to export rewind file '{raw_path}' from git head: {err}"
                            )
                        })?;
                        manifest_files.push(RewindExportManifestEntry {
                            source_path: canonical_from_git,
                            stored_path: Some(stored_relative.to_string_lossy().replace('\\', "/")),
                            source_missing: true,
                            change_status: change_status.clone(),
                            is_deleted: true,
                        });
                        continue;
                    }
                }
                manifest_files.push(RewindExportManifestEntry {
                    source_path: canonical_source.to_string_lossy().to_string(),
                    stored_path: None,
                    source_missing: true,
                    change_status: change_status.clone(),
                    is_deleted,
                });
                continue;
            }
            Err(err) => {
                return Err(format!(
                    "Failed to read rewind source metadata '{raw_path}': {err}"
                ));
            }
        };
        if !metadata.is_file() {
            return Err(format!("Rewind source is not a file: {raw_path}"));
        }

        let destination_relative = resolve_rewind_destination_relative(
            &canonical_workspace_root,
            &canonical_source,
            raw_path,
        )?;
        let stored_relative = PathBuf::from("files").join(&destination_relative);
        let destination_path = export_root.join(&stored_relative);
        if let Some(parent) = destination_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create rewind export parent directory: {err}"))?;
        }
        std::fs::copy(&canonical_source, &destination_path)
            .map_err(|err| format!("Failed to export rewind file '{raw_path}': {err}"))?;
        manifest_files.push(RewindExportManifestEntry {
            source_path: canonical_source.to_string_lossy().to_string(),
            stored_path: Some(stored_relative.to_string_lossy().replace('\\', "/")),
            source_missing: false,
            change_status,
            is_deleted: false,
        });
    }

    let manifest_path = build_rewind_export_manifest_path(&export_root);
    let manifest = RewindExportManifest {
        schema_version: 2,
        engine: normalized_engine.to_string(),
        session_id: normalized_session_id.to_string(),
        target_message_id: normalized_target_message_id.to_string(),
        export_id: export_id.clone(),
        conversation_label: conversation_label.trim().to_string(),
        exported_at: Utc::now().to_rfc3339(),
        workspace_root: canonical_workspace_root.to_string_lossy().to_string(),
        files_dir: "files".to_string(),
        file_count: manifest_files.len(),
        files: manifest_files,
    };
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|err| format!("Failed to serialize rewind export manifest: {err}"))?;
    std::fs::write(&manifest_path, manifest_json)
        .map_err(|err| format!("Failed to write rewind export manifest: {err}"))?;

    Ok(RewindExportResult {
        output_path: export_root.to_string_lossy().to_string(),
        files_path: files_root.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        export_id,
        file_count: manifest.file_count,
    })
}

#[tauri::command]
pub(crate) async fn export_rewind_files(
    workspace_id: String,
    engine: String,
    session_id: String,
    target_message_id: String,
    conversation_label: String,
    files: Vec<RewindExportFileEntry>,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<RewindExportResult, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return Err("export_rewind_files is not supported in remote mode yet.".to_string());
    }

    let workspace_root = {
        let workspaces = state.workspaces.lock().await;
        let entry = workspaces
            .get(&workspace_id)
            .ok_or_else(|| format!("Workspace not found: {workspace_id}"))?;
        PathBuf::from(&entry.path)
    };
    let app_home = app_paths::app_home_dir()?;

    export_rewind_files_inner(
        &workspace_root,
        &app_home,
        &engine,
        &session_id,
        &target_message_id,
        &conversation_label,
        &files,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        build_rewind_export_root, export_rewind_files_inner, is_explicit_absolute_rewind_path,
        looks_like_windows_absolute_path, RewindExportFileEntry,
    };
    use uuid::Uuid;

    #[test]
    fn build_rewind_export_root_includes_engine_session_and_label() {
        let root = build_rewind_export_root(
            std::path::Path::new("/Users/demo/.ccgui"),
            "claude",
            "2026-04-13",
            "session-42",
            "user-42",
        );

        assert_eq!(
            root,
            std::path::Path::new("/Users/demo/.ccgui")
                .join("chat-diff")
                .join("claude")
                .join("2026-04-13")
                .join("session-42")
                .join("user-42")
        );
    }

    #[test]
    fn export_rewind_files_inner_copies_relative_workspace_files() {
        let base = std::env::temp_dir().join(format!("rewind-export-relative-{}", Uuid::new_v4()));
        let workspace_root = base.join("workspace");
        let app_home = base.join(".ccgui");
        let source_file = workspace_root.join("src/features/demo.ts");
        std::fs::create_dir_all(source_file.parent().expect("source parent"))
            .expect("create source parent");
        std::fs::write(&source_file, "export const demo = true;\n").expect("write source");

        let result = export_rewind_files_inner(
            &workspace_root,
            &app_home,
            "claude",
            "session-1",
            "user-1",
            "rewind preview",
            &[RewindExportFileEntry {
                path: "src/features/demo.ts".to_string(),
                status: Some("M".to_string()),
            }],
        )
        .expect("export rewind files");

        let export_root = std::path::PathBuf::from(&result.output_path);
        let exported_file = export_root.join("files/src/features/demo.ts");
        let manifest_path = std::path::PathBuf::from(&result.manifest_path);
        assert_eq!(result.file_count, 1);
        assert_eq!(result.export_id, "user-1");
        assert!(exported_file.exists());
        assert!(manifest_path.exists());
        assert_eq!(
            std::fs::read_to_string(exported_file).expect("read exported"),
            "export const demo = true;\n"
        );
        let manifest: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(manifest_path).expect("read manifest"))
                .expect("parse manifest");
        assert_eq!(manifest["engine"], "claude");
        assert_eq!(manifest["sessionId"], "session-1");
        assert_eq!(manifest["targetMessageId"], "user-1");
        assert_eq!(manifest["conversationLabel"], "rewind preview");
        assert_eq!(manifest["filesDir"], "files");
        assert_eq!(manifest["fileCount"], 1);
        assert_eq!(manifest["files"][0]["changeStatus"], "M");
        assert_eq!(manifest["files"][0]["isDeleted"], false);
        assert_eq!(
            manifest["files"][0]["storedPath"],
            "files/src/features/demo.ts"
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn export_rewind_files_inner_keeps_missing_source_file_in_manifest() {
        let base = std::env::temp_dir().join(format!("rewind-export-missing-{}", Uuid::new_v4()));
        let workspace_root = base.join("workspace");
        let app_home = base.join(".ccgui");
        std::fs::create_dir_all(&workspace_root).expect("create workspace root");

        let result = export_rewind_files_inner(
            &workspace_root,
            &app_home,
            "claude",
            "session-1",
            "user-1",
            "rewind preview",
            &[RewindExportFileEntry {
                path: "missing/file.ts".to_string(),
                status: Some("D".to_string()),
            }],
        )
        .expect("missing file should be tolerated");

        let manifest_path = std::path::PathBuf::from(&result.manifest_path);
        assert_eq!(result.file_count, 1);
        let manifest: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(manifest_path).expect("read manifest"))
                .expect("parse manifest");
        assert_eq!(manifest["fileCount"], 1);
        assert_eq!(manifest["files"][0]["sourceMissing"], true);
        assert_eq!(manifest["files"][0]["changeStatus"], "D");
        assert_eq!(manifest["files"][0]["isDeleted"], true);
        assert!(manifest["files"][0]["storedPath"].is_null());

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn export_rewind_files_inner_copies_existing_files_and_tolerates_missing_files() {
        let base = std::env::temp_dir().join(format!("rewind-export-mixed-{}", Uuid::new_v4()));
        let workspace_root = base.join("workspace");
        let app_home = base.join(".ccgui");
        let source_file = workspace_root.join("src/features/demo.ts");
        std::fs::create_dir_all(source_file.parent().expect("source parent"))
            .expect("create source parent");
        std::fs::write(&source_file, "export const demo = true;\n").expect("write source");

        let result = export_rewind_files_inner(
            &workspace_root,
            &app_home,
            "claude",
            "session-1",
            "user-1",
            "rewind preview",
            &[
                RewindExportFileEntry {
                    path: "src/features/demo.ts".to_string(),
                    status: Some("M".to_string()),
                },
                RewindExportFileEntry {
                    path: "missing/file.ts".to_string(),
                    status: Some("D".to_string()),
                },
            ],
        )
        .expect("mixed rewind export");

        let export_root = std::path::PathBuf::from(&result.output_path);
        let exported_file = export_root.join("files/src/features/demo.ts");
        let manifest_path = std::path::PathBuf::from(&result.manifest_path);
        assert_eq!(result.file_count, 2);
        assert!(exported_file.exists());
        let manifest: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(manifest_path).expect("read manifest"))
                .expect("parse manifest");
        assert_eq!(manifest["fileCount"], 2);
        assert_eq!(manifest["files"][0]["sourceMissing"], false);
        assert_eq!(manifest["files"][0]["changeStatus"], "M");
        assert_eq!(manifest["files"][0]["isDeleted"], false);
        assert_eq!(
            manifest["files"][0]["storedPath"],
            "files/src/features/demo.ts"
        );
        assert_eq!(manifest["files"][1]["sourceMissing"], true);
        assert_eq!(manifest["files"][1]["changeStatus"], "D");
        assert_eq!(manifest["files"][1]["isDeleted"], true);
        assert!(manifest["files"][1]["storedPath"].is_null());

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn export_rewind_files_inner_restores_deleted_tracked_file_from_git_head() {
        let base =
            std::env::temp_dir().join(format!("rewind-export-deleted-git-{}", Uuid::new_v4()));
        let workspace_root = base.join("workspace");
        let app_home = base.join(".ccgui");
        let deleted_file = workspace_root.join("src/spec/deleted.md");
        std::fs::create_dir_all(deleted_file.parent().expect("deleted parent"))
            .expect("create deleted parent");
        std::fs::write(&deleted_file, "# deleted from worktree\n").expect("write deleted file");

        let repo = git2::Repository::init(&workspace_root).expect("init repo");
        let mut index = repo.index().expect("open index");
        index
            .add_path(std::path::Path::new("src/spec/deleted.md"))
            .expect("add deleted file");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let signature = git2::Signature::now("Rewind Export Test", "rewind-export@test.local")
            .expect("signature");
        repo.commit(Some("HEAD"), &signature, &signature, "init", &tree, &[])
            .expect("commit");

        std::fs::remove_file(&deleted_file).expect("delete file from worktree");

        let result = export_rewind_files_inner(
            &workspace_root,
            &app_home,
            "claude",
            "session-1",
            "user-1",
            "rewind preview",
            &[RewindExportFileEntry {
                path: "src/spec/deleted.md".to_string(),
                status: Some("D".to_string()),
            }],
        )
        .expect("export rewind files");

        let export_root = std::path::PathBuf::from(&result.output_path);
        let exported_deleted_file = export_root.join("files/src/spec/deleted.md");
        let manifest_path = std::path::PathBuf::from(&result.manifest_path);
        assert!(exported_deleted_file.exists());
        assert_eq!(
            std::fs::read_to_string(&exported_deleted_file).expect("read deleted snapshot"),
            "# deleted from worktree\n"
        );

        let manifest: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(manifest_path).expect("read manifest"))
                .expect("parse manifest");
        assert_eq!(manifest["fileCount"], 1);
        assert_eq!(manifest["files"][0]["sourceMissing"], true);
        assert_eq!(manifest["files"][0]["changeStatus"], "D");
        assert_eq!(manifest["files"][0]["isDeleted"], true);
        assert_eq!(
            manifest["files"][0]["storedPath"],
            "files/src/spec/deleted.md"
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn export_rewind_files_inner_accepts_file_uri_sources() {
        let base = std::env::temp_dir().join(format!("rewind-export-uri-{}", Uuid::new_v4()));
        let workspace_root = base.join("workspace");
        let app_home = base.join(".ccgui");
        let external_root = base.join("external");
        let source_file = external_root.join("notes/demo file.ts");
        std::fs::create_dir_all(&workspace_root).expect("create workspace root");
        std::fs::create_dir_all(source_file.parent().expect("source parent"))
            .expect("create source parent");
        std::fs::write(&source_file, "export const fromUri = true;\n").expect("write source");

        let canonical_source = source_file.canonicalize().expect("canonical source");
        let source_uri = if cfg!(target_os = "windows") {
            let normalized = canonical_source.to_string_lossy().replace('\\', "/");
            format!("file:///{normalized}")
        } else {
            format!("file://{}", canonical_source.to_string_lossy())
        };

        let result = export_rewind_files_inner(
            &workspace_root,
            &app_home,
            "claude",
            "session-1",
            "user-1",
            "rewind preview",
            &[RewindExportFileEntry {
                path: source_uri,
                status: None,
            }],
        )
        .expect("export rewind files");

        let export_root = std::path::PathBuf::from(&result.output_path);
        let stored_path = export_root.join("files/external");
        assert!(stored_path.exists());

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn detects_cross_platform_absolute_rewind_paths() {
        assert!(looks_like_windows_absolute_path("C:/Users/demo/file.ts"));
        assert!(looks_like_windows_absolute_path("C:\\Users\\demo\\file.ts"));
        assert!(looks_like_windows_absolute_path(
            "\\\\server\\share\\file.ts"
        ));
        assert!(is_explicit_absolute_rewind_path(
            "file:///Users/demo/file.ts"
        ));
        assert!(!looks_like_windows_absolute_path("src/features/demo.ts"));
        assert!(!is_explicit_absolute_rewind_path("src/features/demo.ts"));
    }

    #[test]
    fn export_rewind_files_inner_overwrites_existing_snapshot_for_same_target() {
        let base = std::env::temp_dir().join(format!("rewind-export-stable-{}", Uuid::new_v4()));
        let workspace_root = base.join("workspace");
        let app_home = base.join(".ccgui");
        let first_file = workspace_root.join("src/features/demo.ts");
        let stale_file = workspace_root.join("src/features/stale.ts");
        std::fs::create_dir_all(first_file.parent().expect("source parent"))
            .expect("create source parent");
        std::fs::write(&first_file, "export const demo = 1;\n").expect("write first file");
        std::fs::write(&stale_file, "export const stale = true;\n").expect("write stale file");

        let first_result = export_rewind_files_inner(
            &workspace_root,
            &app_home,
            "claude",
            "session-1",
            "user-1",
            "rewind preview",
            &[
                RewindExportFileEntry {
                    path: "src/features/demo.ts".to_string(),
                    status: None,
                },
                RewindExportFileEntry {
                    path: "src/features/stale.ts".to_string(),
                    status: None,
                },
            ],
        )
        .expect("export first snapshot");

        std::fs::write(&first_file, "export const demo = 2;\n").expect("rewrite first file");

        let second_result = export_rewind_files_inner(
            &workspace_root,
            &app_home,
            "claude",
            "session-1",
            "user-1",
            "rewind preview",
            &[RewindExportFileEntry {
                path: "src/features/demo.ts".to_string(),
                status: None,
            }],
        )
        .expect("export second snapshot");

        assert_eq!(first_result.output_path, second_result.output_path);
        assert_eq!(first_result.export_id, second_result.export_id);

        let export_root = std::path::PathBuf::from(&second_result.output_path);
        let exported_first_file = export_root.join("files/src/features/demo.ts");
        let removed_stale_file = export_root.join("files/src/features/stale.ts");
        let manifest_path = export_root.join("manifest.json");
        assert_eq!(
            std::fs::read_to_string(exported_first_file).expect("read rewritten file"),
            "export const demo = 2;\n"
        );
        assert!(!removed_stale_file.exists());

        let manifest: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(manifest_path).expect("read manifest"))
                .expect("parse manifest");
        assert_eq!(manifest["fileCount"], 1);
        assert_eq!(
            manifest["files"].as_array().map(|items| items.len()),
            Some(1)
        );

        std::fs::remove_dir_all(&base).ok();
    }
}
