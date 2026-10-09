use base64::Engine as _;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;

const MAX_READ_BYTES: usize = 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
const MAX_SEARCH_RESULTS: usize = 200;
/// @-mention file index: bounds the walk on monster trees (the gitignore
/// filter drops build output, the cap is the last line of defense).
const MAX_INDEX_ENTRIES: usize = 20_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub kind: String, // "text" | "image" | "binary"
    pub text: Option<String>,
    pub data_url: Option<String>,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub text: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIndexEntry {
    /// Workspace-relative path, "/" separators (the frontend re-joins it
    /// with the root — absolute paths would double the IPC payload).
    pub rel: String,
    pub is_dir: bool,
}

fn mtime_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Canonicalize an existing path; for a not-yet-created file, canonicalize
/// its parent and re-append the file name (one level covers write/rename
/// targets, whose parent directories exist in practice).
pub(crate) fn canonicalize_lenient(path: &Path) -> Result<PathBuf, String> {
    if let Ok(resolved) = std::fs::canonicalize(path) {
        return Ok(resolved);
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| format!("cannot resolve {}", path.display()))?;
    let base = std::fs::canonicalize(parent)
        .map_err(|e| format!("cannot resolve {}: {e}", parent.display()))?;
    let name = path
        .file_name()
        .ok_or_else(|| format!("cannot resolve {}", path.display()))?;
    Ok(base.join(name))
}

/// Workspace roots, user-granted directories and the pasted-images sandbox
/// are the only trees the file commands may touch: `path` comes over IPC and
/// would otherwise be an arbitrary-filesystem primitive.
fn allowed_roots(db: &crate::db::Db) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = db
        .all_workspace_root_paths()
        .unwrap_or_default()
        .iter()
        .chain(db.granted_roots().unwrap_or_default().iter())
        .filter_map(|w| canonicalize_lenient(Path::new(w)).ok())
        .collect();
    let pasted = crate::engine::images::pasted_images_dir();
    if let Ok(resolved) = canonicalize_lenient(&pasted) {
        roots.push(resolved);
    }
    roots
}

pub(crate) fn ensure_allowed(path: &str, db: &crate::db::Db) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("empty path".to_string());
    }
    let resolved = canonicalize_lenient(Path::new(trimmed))?;
    let roots = allowed_roots(db);
    if roots.iter().any(|root| resolved.starts_with(root)) {
        Ok(resolved)
    } else {
        Err(format!(
            "path is outside the registered workspaces: {trimmed}"
        ))
    }
}

/// Windows `canonicalize` returns verbatim paths (`\\?\C:\...`); strip the
/// prefix so granted roots are stored and displayed in normal form.
/// Comparisons re-canonicalize both sides, so stripping is lossless here.
fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => path,
    }
}

/// The directory a grant for `path` would cover: the path itself when it is
/// a directory, otherwise its parent (granting a single file would not cover
/// its siblings, which is never what the file-tree user wants).
fn grant_dir_for(path: &str) -> Result<PathBuf, String> {
    let resolved = canonicalize_lenient(Path::new(path.trim()))?;
    let dir = if resolved.is_dir() {
        resolved
    } else {
        resolved
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .ok_or_else(|| format!("cannot resolve {path}"))?
            .to_path_buf()
    };
    Ok(strip_verbatim_prefix(dir))
}

/// Resolve the directory a `grant_root` call would cover — the confirm
/// dialog shows this so the user sees the real scope before approving.
/// Pure: no mutation.
#[tauri::command]
pub fn grant_scope(path: String) -> Result<String, String> {
    Ok(grant_dir_for(&path)?.to_string_lossy().to_string())
}

/// Persist a user-approved directory as an allowed root for every file
/// command. Desktop-only by design: the web-access bridge must not widen
/// the filesystem boundary from a remote client, so web.rs has no route
/// for this command.
#[tauri::command]
pub fn grant_root(db: tauri::State<'_, Arc<crate::db::Db>>, path: String) -> Result<(), String> {
    let dir = grant_dir_for(&path)?;
    db.add_granted_root(&dir.to_string_lossy())
}

#[tauri::command]
pub fn list_granted_roots(db: tauri::State<'_, Arc<crate::db::Db>>) -> Result<Vec<String>, String> {
    db.granted_roots()
}

#[tauri::command]
pub fn revoke_granted_root(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
) -> Result<(), String> {
    db.remove_granted_root(path.trim())
}

#[tauri::command]
pub fn list_dir(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
) -> Result<Vec<DirEntry>, String> {
    let dir = ensure_allowed(&path, &db)?;
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("read {}: {e}", dir.display()))?;
    let mut out: Vec<DirEntry> = entries
        .flatten()
        .map(|entry| {
            let meta = entry.metadata().ok();
            DirEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                is_dir: meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                mtime_ms: meta.as_ref().map(mtime_ms).unwrap_or(0),
            }
        })
        .collect();
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    Ok(out)
}

fn is_image(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico"
    )
}

fn image_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "image/png",
    }
}

/// Sync body of `read_file`; the command wrapper runs it off the main
/// thread via spawn_blocking (a 1MB read must not stall IPC).
fn read_file_blocking(db: &crate::db::Db, path: &str) -> Result<FileContent, String> {
    let file = ensure_allowed(path, db)?;
    let meta = std::fs::metadata(&file).map_err(|e| format!("stat {}: {e}", file.display()))?;
    if is_image(&file) {
        if meta.len() > MAX_IMAGE_BYTES as u64 {
            return Err("image exceeds 5MB preview limit".to_string());
        }
        let bytes = std::fs::read(&file).map_err(|e| format!("read {}: {e}", file.display()))?;
        let data_url = format!(
            "data:{};base64,{}",
            image_mime(&file),
            base64::engine::general_purpose::STANDARD.encode(bytes)
        );
        return Ok(FileContent {
            kind: "image".to_string(),
            text: None,
            data_url: Some(data_url),
            truncated: false,
        });
    }
    let mut bytes = Vec::new();
    {
        use std::io::Read;
        let f = std::fs::File::open(&file).map_err(|e| format!("open {}: {e}", file.display()))?;
        let mut limited = f.take((MAX_READ_BYTES + 1) as u64);
        limited
            .read_to_end(&mut bytes)
            .map_err(|e| format!("read {}: {e}", file.display()))?;
    }
    let truncated = bytes.len() > MAX_READ_BYTES;
    if truncated {
        bytes.truncate(MAX_READ_BYTES);
    }
    // Binary detection: NUL in the first 8KB.
    if bytes[..bytes.len().min(8192)].contains(&0) {
        return Ok(FileContent {
            kind: "binary".to_string(),
            text: None,
            data_url: None,
            truncated: false,
        });
    }
    Ok(FileContent {
        kind: "text".to_string(),
        text: Some(String::from_utf8_lossy(&bytes).to_string()),
        data_url: None,
        truncated,
    })
}

#[tauri::command]
pub async fn read_file(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
) -> Result<FileContent, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || read_file_blocking(&db, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn write_file(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
    content: String,
) -> Result<(), String> {
    let file = ensure_allowed(&path, &db)?;
    std::fs::write(&file, content).map_err(|e| format!("write {}: {e}", file.display()))
}

#[tauri::command]
pub fn create_dir(db: tauri::State<'_, Arc<crate::db::Db>>, path: String) -> Result<(), String> {
    let dir = ensure_allowed(&path, &db)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))
}
/// "New file" from the tree context menu: `create_new` fails instead of
/// clobbering when the name is taken (write_file overwrites by design).
#[tauri::command]
pub fn create_file(db: tauri::State<'_, Arc<crate::db::Db>>, path: String) -> Result<(), String> {
    let file = ensure_allowed(&path, &db)?;
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file)
        .map(|_| ())
        .map_err(|e| format!("create {}: {e}", file.display()))
}

#[tauri::command]
pub fn rename_item(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    from: String,
    to: String,
) -> Result<(), String> {
    let src = ensure_allowed(&from, &db)?;
    let dst = ensure_allowed(&to, &db)?;
    std::fs::rename(&src, &dst)
        .map_err(|e| format!("rename {} -> {}: {e}", src.display(), dst.display()))
}

#[tauri::command]
pub fn trash_item(db: tauri::State<'_, Arc<crate::db::Db>>, path: String) -> Result<(), String> {
    let target = ensure_allowed(&path, &db)?;
    trash::delete(&target).map_err(|e| format!("trash {}: {e}", target.display()))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOpResult {
    pub path: String,
    pub is_dir: bool,
}

/// Finder-style copy naming: `name copy`, `name copy 2`, …; files keep
/// their extension (`name copy.txt`).
fn copy_destination_name(source: &Path, is_dir: bool, counter: u32) -> Result<String, String> {
    let name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("invalid source name {}", source.display()))?;
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let extension = source.extension().and_then(|e| e.to_str());
    let suffix = if counter == 0 {
        " copy".to_string()
    } else {
        format!(" copy {counter}")
    };
    Ok(match (is_dir, extension) {
        (false, Some(ext)) => format!("{stem}{suffix}.{ext}"),
        _ => format!("{stem}{suffix}"),
    })
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("mkdir {}: {e}", dst.display()))?;
    let entries = std::fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read entry in {}: {e}", src.display()))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let file_type = std::fs::symlink_metadata(&src_path)
            .map_err(|e| format!("stat {}: {e}", src_path.display()))?
            .file_type();
        if file_type.is_symlink() {
            return Err(format!("cannot copy symlink {}", src_path.display()));
        }
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("copy {}: {e}", src_path.display()))?;
        }
    }
    Ok(())
}

/// Copy `source` into `target_dir`, picking a collision-free destination
/// (`prefer_original_name` keeps the plain name when it is free — paste;
/// duplicates always take the " copy" suffix). Returns the destination.
fn copy_item_into_dir(
    source: &Path,
    is_dir: bool,
    target_dir: &Path,
    prefer_original_name: bool,
) -> Result<PathBuf, String> {
    if is_dir && target_dir.starts_with(source) {
        return Err("cannot paste a folder into itself or its descendant".to_string());
    }
    let source_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("invalid source name {}", source.display()))?;
    let mut destination = target_dir.join(source_name);
    if !prefer_original_name || destination.exists() {
        destination = (0..=999u32)
            .map(|counter| copy_destination_name(source, is_dir, counter))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|name| target_dir.join(name))
            .find(|candidate| !candidate.exists())
            .ok_or_else(|| "too many copies exist".to_string())?;
    }
    if is_dir {
        copy_dir_recursive(source, &destination)?;
    } else {
        std::fs::copy(source, &destination)
            .map_err(|e| format!("copy {}: {e}", source.display()))?;
    }
    Ok(destination)
}

#[tauri::command]
pub fn duplicate_item(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
) -> Result<FileOpResult, String> {
    let source = ensure_allowed(&path, &db)?;
    let meta = std::fs::symlink_metadata(&source)
        .map_err(|e| format!("stat {}: {e}", source.display()))?;
    if meta.file_type().is_symlink() {
        return Err(format!("cannot copy symlink {}", source.display()));
    }
    let parent = source
        .parent()
        .ok_or_else(|| format!("invalid path {}", source.display()))?;
    let destination = copy_item_into_dir(&source, meta.is_dir(), parent, false)?;
    Ok(FileOpResult {
        path: destination.to_string_lossy().into_owned(),
        is_dir: meta.is_dir(),
    })
}

#[tauri::command]
pub fn paste_item(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    source: String,
    target_dir: String,
) -> Result<FileOpResult, String> {
    let source = ensure_allowed(&source, &db)?;
    let dir = ensure_allowed(&target_dir, &db)?;
    if !dir.is_dir() {
        return Err(format!("{} is not a directory", dir.display()));
    }
    let meta = std::fs::symlink_metadata(&source)
        .map_err(|e| format!("stat {}: {e}", source.display()))?;
    if meta.file_type().is_symlink() {
        return Err(format!("cannot copy symlink {}", source.display()));
    }
    let destination = copy_item_into_dir(&source, meta.is_dir(), &dir, true)?;
    Ok(FileOpResult {
        path: destination.to_string_lossy().into_owned(),
        is_dir: meta.is_dir(),
    })
}

/// Case-insensitive substring check. ASCII haystack+needle take an
/// allocation-free fast path; Unicode input falls back to `to_lowercase`
/// to preserve the old case-folding semantics exactly.
fn contains_case_insensitive(line: &str, needle_lower: &str) -> bool {
    if line.is_ascii() && needle_lower.is_ascii() {
        line.as_bytes()
            .windows(needle_lower.len())
            .any(|w| w.eq_ignore_ascii_case(needle_lower.as_bytes()))
    } else {
        line.to_lowercase().contains(needle_lower)
    }
}

/// Sync body of `search_text` (recursive grep is far too heavy for the main
/// thread on large trees).
fn search_text_blocking(
    db: &crate::db::Db,
    path: &str,
    query: &str,
) -> Result<Vec<SearchHit>, String> {
    use std::io::BufRead;
    let root = ensure_allowed(path, db)?;
    let needle = query.trim().to_string();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let needle_lower = needle.to_lowercase();
    let mut hits = Vec::new();
    let mut stack = vec![root];
    while let Some(dir) = stack.pop() {
        if hits.len() >= MAX_SEARCH_RESULTS {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if hits.len() >= MAX_SEARCH_RESULTS {
                break;
            }
            let p = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.is_dir() {
                stack.push(p);
                continue;
            }
            if meta.len() > MAX_READ_BYTES as u64 * 4 {
                continue;
            }
            let Ok(file) = std::fs::File::open(&p) else {
                continue;
            };
            let reader = std::io::BufReader::new(file);
            for (index, line) in reader.lines().enumerate() {
                let Ok(line) = line else { break };
                if contains_case_insensitive(&line, &needle_lower) {
                    hits.push(SearchHit {
                        path: p.to_string_lossy().to_string(),
                        line: index + 1,
                        text: line.trim().chars().take(200).collect(),
                    });
                    if hits.len() >= MAX_SEARCH_RESULTS {
                        break;
                    }
                }
            }
        }
    }
    Ok(hits)
}

#[tauri::command]
pub async fn search_text(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
    query: String,
) -> Result<Vec<SearchHit>, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || search_text_blocking(&db, &path, &query))
        .await
        .map_err(|e| e.to_string())?
}
/// Sync body of `list_file_index`: full-tree walk for the composer's
/// @-mention picker. Gitignore-aware via the `ignore` crate (ripgrep's
/// walker): .gitignore/.git/info/exclude/global excludes are honored even
/// outside a git repo (require_git(false)); hidden files are skipped and
/// node_modules/target are dropped even when a repo forgot to ignore them.
///
/// `include_ignored` serves the chat file-link fallback: build outputs
/// (`release/`, `dist/`) are gitignored in most repos, so the normal index
/// can never see them. The flag turns the ignore filters off — the same
/// node_modules/target prunes (plus __pycache__) and the entry cap apply.
fn list_file_index_blocking(
    db: &crate::db::Db,
    path: &str,
    include_ignored: bool,
) -> Result<Vec<FileIndexEntry>, String> {
    let root = ensure_allowed(path, db)?;
    let mut out: Vec<FileIndexEntry> = Vec::new();
    let walker = ignore::WalkBuilder::new(&root)
        .hidden(true)
        .ignore(!include_ignored)
        .git_ignore(!include_ignored)
        .git_global(!include_ignored)
        .git_exclude(!include_ignored)
        .require_git(false)
        .follow_links(false)
        .filter_entry(move |e| {
            if !e.file_type().is_some_and(|t| t.is_dir()) {
                return true;
            }
            if e.file_name() == "node_modules" || e.file_name() == "target" {
                return false;
            }
            !(include_ignored && e.file_name() == "__pycache__")
        })
        .build();
    for entry in walker {
        let Ok(entry) = entry else { continue };
        let p = entry.path();
        if p == root {
            continue;
        }
        let rel = p
            .strip_prefix(&root)
            .unwrap_or(p)
            .to_string_lossy()
            .replace('\\', "/");
        out.push(FileIndexEntry {
            rel,
            is_dir: entry.file_type().is_some_and(|t| t.is_dir()),
        });
        if out.len() >= MAX_INDEX_ENTRIES {
            break;
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn list_file_index(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
    include_ignored: Option<bool>,
) -> Result<Vec<FileIndexEntry>, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || {
        list_file_index_blocking(&db, &path, include_ignored.unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let dir = std::env::temp_dir()
                .join(format!("ccgui-next-files-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn grant_root_widens_then_revoke_restores_confinement() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.0.join("test.db")).unwrap();
        let outside = Scratch::new();
        let file = outside.0.join("routing.json");
        std::fs::write(&file, b"{}").unwrap();
        let file_str = file.to_string_lossy().to_string();

        // Ungranted: the confinement error the frontend pattern-matches on.
        let err = ensure_allowed(&file_str, &db).unwrap_err();
        assert!(err.starts_with("path is outside the registered workspaces"));

        // grant_scope on a file resolves its parent directory.
        let dir = grant_dir_for(&file_str).unwrap();
        let want = strip_verbatim_prefix(std::fs::canonicalize(&outside.0).unwrap());
        assert_eq!(dir, want);

        // Granted: the file is admitted.
        db.add_granted_root(&dir.to_string_lossy()).unwrap();
        assert!(ensure_allowed(&file_str, &db).is_ok());

        // Revoked: rejection returns.
        db.remove_granted_root(&dir.to_string_lossy()).unwrap();
        let err = ensure_allowed(&file_str, &db).unwrap_err();
        assert!(err.starts_with("path is outside the registered workspaces"));
    }

    #[test]
    fn grant_scope_on_directory_grants_itself() {
        let outside = Scratch::new();
        let dir = grant_dir_for(&outside.0.to_string_lossy()).unwrap();
        let want = strip_verbatim_prefix(std::fs::canonicalize(&outside.0).unwrap());
        assert_eq!(dir, want);
    }

    #[test]
    fn index_sees_gitignored_build_output_only_when_asked() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.0.join("test.db")).unwrap();
        std::fs::write(scratch.0.join(".gitignore"), b"release/\n").unwrap();
        std::fs::create_dir_all(scratch.0.join("release")).unwrap();
        std::fs::write(scratch.0.join("release").join("app.exe"), b"x").unwrap();
        let root = scratch.0.to_string_lossy().to_string();
        db.add_granted_root(&root).unwrap();

        let filtered = list_file_index_blocking(&db, &root, false).unwrap();
        assert!(!filtered.iter().any(|e| e.rel == "release/app.exe"));
        let all = list_file_index_blocking(&db, &root, true).unwrap();
        assert!(all.iter().any(|e| e.rel == "release/app.exe"));
    }

    #[test]
    fn extra_workspace_root_enters_the_hard_boundary_and_is_writable() {
        let main = Scratch::new();
        let extra = Scratch::new();
        let db = crate::db::Db::open_at(&main.0.join("test.db")).unwrap();
        let main_path = main.0.to_string_lossy().to_string();
        let extra_path = extra.0.to_string_lossy().to_string();
        // `state.workspaces.add` derives the id from a UUID; for the test a
        // fixed id is enough so the send path's by-path lookup resolves.
        db.0.lock()
            .execute(
                "INSERT INTO workspaces(id, path, name) VALUES('w1', ?1, 'main')",
                [&main_path],
            )
            .unwrap();

        // Before registration the extra root is outside the boundary.
        let inside_extra = extra.0.join("notes.txt");
        let err = ensure_allowed(&inside_extra.to_string_lossy(), &db).unwrap_err();
        assert!(err.starts_with("path is outside the registered workspaces"));

        // Registering it as an 附加根 widens the boundary (main ∪ extra),
        // because allowed_roots now reads all_workspace_root_paths().
        db.add_workspace_root("w1", &extra_path).unwrap();
        let resolved = ensure_allowed(&inside_extra.to_string_lossy(), &db).unwrap();
        assert!(resolved.starts_with(std::fs::canonicalize(&extra.0).unwrap()));

        // 附加根与主目录读写对等: writing the file succeeds and round-trips.
        std::fs::write(&resolved, b"hello").unwrap();
        assert_eq!(std::fs::read(&resolved).unwrap(), b"hello");
        // The main directory stays writable too (no read-only regression).
        let inside_main = main.0.join("main.txt");
        std::fs::write(
            ensure_allowed(&inside_main.to_string_lossy(), &db).unwrap(),
            b"m",
        )
        .unwrap();

        // Removing the root restores confinement for the extra tree.
        db.remove_workspace_root("w1", &extra_path).unwrap();
        let err = ensure_allowed(&inside_extra.to_string_lossy(), &db).unwrap_err();
        assert!(err.starts_with("path is outside the registered workspaces"));
    }
}
