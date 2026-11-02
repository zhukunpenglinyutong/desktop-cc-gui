use base64::Engine as _;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
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
    /// Git ignores this entry (`.gitignore` / info/exclude / global excludes,
    /// and `.git` itself); see `git_ignore.rs`. Omitted when false.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub ignored: bool,
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

/// Canonicalize a path that may not exist yet: resolve its nearest existing
/// ancestor and re-append the missing names (an agent's write target, and so
/// its grant request, can sit under directories nobody has created yet).
/// Only truly absent components are re-appended: a dangling symlink resolves
/// nowhere, and its lexical tail would escape the root being checked.
pub(crate) fn canonicalize_lenient(path: &Path) -> Result<PathBuf, String> {
    match std::fs::canonicalize(path) {
        Ok(resolved) => return Ok(resolved),
        Err(e)
            if e.kind() != std::io::ErrorKind::NotFound
                || std::fs::symlink_metadata(path).is_ok() =>
        {
            return Err(format!("cannot resolve {}: {e}", path.display()));
        }
        Err(_) => {}
    }
    let unresolved = || format!("cannot resolve {}", path.display());
    // `..` outside the verified prefix is not something we may reproduce
    // lexically: whether a hop over a missing directory still resolves
    // depends on the platform's path parser (Unix fails component-wise,
    // Windows' Win32 layer collapses `..` before touching the filesystem),
    // so the result would diverge per OS. Refuse instead of guessing.
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(unresolved());
    }
    // `file_name` is None for a trailing `..`, which cannot be resolved
    // lexically once the directory before it is missing.
    let name = path.file_name().ok_or_else(unresolved)?;
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(unresolved)?;
    Ok(canonicalize_lenient(parent)?.join(name))
}

/// Workspace roots, user-granted directories and the pasted-images sandbox
/// are the only trees the file commands may touch: `path` comes over IPC and
/// would otherwise be an arbitrary-filesystem primitive.
fn allowed_roots(db: &crate::db::Db) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = db
        .workspace_paths()
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
    // No trim: a trailing-space filename is a real, distinct path. Only a
    // whitespace-only input is rejected as empty.
    if path.trim().is_empty() {
        return Err("empty path".to_string());
    }
    let resolved = canonicalize_lenient(Path::new(path))?;
    let roots = allowed_roots(db);
    if roots.iter().any(|root| resolved.starts_with(root)) {
        Ok(resolved)
    } else {
        Err(format!("path is outside the registered workspaces: {path}"))
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
    let resolved = canonicalize_lenient(Path::new(path))?;
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
pub async fn grant_root(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
) -> Result<(), String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || grant_root_in(&db, &path))
        .await
        .map_err(|e| e.to_string())?
}

fn grant_root_in(db: &crate::db::Db, path: &str) -> Result<(), String> {
    let dir = grant_dir_for(path)?;
    // A grant for a file the agent has yet to write can name a directory
    // that does not exist. Engines skip missing extra roots and the agent
    // cannot create one outside its allowed dirs, so create it here or the
    // approved grant never takes effect.
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    db.add_granted_root(&dir.to_string_lossy())
}

#[tauri::command]
pub fn list_granted_roots(db: tauri::State<'_, Arc<crate::db::Db>>) -> Result<Vec<String>, String> {
    db.granted_roots()
}

#[tauri::command]
pub async fn revoke_granted_root(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
) -> Result<(), String> {
    let db = Arc::clone(&db);
    tauri::async_runtime::spawn_blocking(move || db.remove_granted_root(path.trim()))
        .await
        .map_err(|e| e.to_string())?
}

/// Sync body of `list_dir`; the command wrapper runs it off the main thread
/// because the ignore check opens the enclosing Git repository.
///
/// `git_ignore_root` opts into the per-entry `ignored` flag: the file tree
/// passes its root, which bounds how far ignore state is inherited (see
/// `git_ignore.rs`). Other callers only need names and skip the Git work.
fn list_dir_blocking(
    db: &crate::db::Db,
    path: &str,
    git_ignore_root: Option<&str>,
) -> Result<Vec<DirEntry>, String> {
    let dir = ensure_allowed(path, db)?;
    let ignore_root = git_ignore_root
        .map(|root| ensure_allowed(root, db))
        .transpose()?;
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("read {}: {e}", dir.display()))?;
    let raw: Vec<(String, Option<std::fs::Metadata>)> = entries
        .flatten()
        .map(|entry| {
            (
                entry.file_name().to_string_lossy().to_string(),
                entry.metadata().ok(),
            )
        })
        .collect();
    let is_dir = |meta: &Option<std::fs::Metadata>| meta.as_ref().is_some_and(|m| m.is_dir());
    let ignored = match &ignore_root {
        Some(root) => crate::git_ignore::ignored_names(
            &dir,
            root,
            raw.iter().map(|(name, meta)| (name.as_str(), is_dir(meta))),
        ),
        None => Default::default(),
    };
    let mut out: Vec<DirEntry> = raw
        .into_iter()
        .map(|(name, meta)| DirEntry {
            is_dir: is_dir(&meta),
            size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            mtime_ms: meta.as_ref().map(mtime_ms).unwrap_or(0),
            ignored: ignored.contains(&name),
            name,
        })
        .collect();
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    Ok(out)
}

#[tauri::command]
pub async fn list_dir(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
    git_ignore_root: Option<String>,
) -> Result<Vec<DirEntry>, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || {
        list_dir_blocking(&db, &path, git_ignore_root.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
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
pub async fn write_file(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
    content: String,
) -> Result<(), String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let file = ensure_allowed(&path, &db)?;
        std::fs::write(&file, content).map_err(|e| format!("write {}: {e}", file.display()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_dir(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
) -> Result<(), String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let dir = ensure_allowed(&path, &db)?;
        std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))
    })
    .await
    .map_err(|e| e.to_string())?
}
/// "New file" from the tree context menu: `create_new` fails instead of
/// clobbering when the name is taken (write_file overwrites by design).
#[tauri::command]
pub async fn create_file(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
) -> Result<(), String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let file = ensure_allowed(&path, &db)?;
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&file)
            .map(|_| ())
            .map_err(|e| format!("create {}: {e}", file.display()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rename_item(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    from: String,
    to: String,
) -> Result<(), String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let src = ensure_allowed(&from, &db)?;
        let dst = ensure_allowed(&to, &db)?;
        std::fs::rename(&src, &dst)
            .map_err(|e| format!("rename {} -> {}: {e}", src.display(), dst.display()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Move `path` to the OS trash in-process. On macOS the trash crate defaults
/// to asking Finder through `osascript`: an Automation permission prompt, and
/// an osascript → Finder process chain that endpoint security associates
/// with macOS stealers. NSFileManager's `trashItemAtURL` needs neither. The
/// trade-off: Finder's "Put Back" may be missing for these items; dragging
/// them out of the Trash still restores them.
pub(crate) fn move_to_trash(path: &Path) -> Result<(), trash::Error> {
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut context = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        context.set_delete_method(DeleteMethod::NsFileManager);
    }
    context.delete(path)
}

#[tauri::command]
pub async fn trash_item(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
) -> Result<(), String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let target = ensure_allowed(&path, &db)?;
        move_to_trash(&target).map_err(|e| format!("trash {}: {e}", target.display()))
    })
    .await
    .map_err(|e| e.to_string())?
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

fn copy_dir_recursive_with(
    src: &Path,
    dst: &Path,
    copy_file: &mut impl FnMut(&Path, &Path) -> Result<u64, String>,
) -> Result<(), String> {
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
            copy_dir_recursive_with(&src_path, &dst_path, copy_file)?;
        } else {
            copy_file(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

/// Copy `source` into `target_dir`, picking a collision-free destination
/// (`prefer_original_name` keeps the plain name when it is free — paste;
/// duplicates always take the " copy" suffix). Returns the destination.
fn copy_item_into_dir_with(
    source: &Path,
    is_dir: bool,
    target_dir: &Path,
    prefer_original_name: bool,
    copy_file: &mut impl FnMut(&Path, &Path) -> Result<u64, String>,
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
    // A unique staged name isolates concurrent copies; only this operation's
    // temporary item is ever cleaned up. It does not embed the source name:
    // a long name plus the suffix would exceed the 255-unit name limit and
    // fail a copy whose real destination fits.
    let temporary = target_dir.join(format!(".ccgui-copying-{}", uuid::Uuid::new_v4()));
    if is_dir {
        std::fs::create_dir(&temporary)
            .map_err(|error| format!("mkdir {}: {error}", temporary.display()))?;
    }
    let copy_result = if is_dir {
        copy_dir_recursive_with(source, &temporary, copy_file)
    } else {
        copy_file(source, &temporary).map(|_| ())
    };
    if let Err(error) = copy_result {
        return Err(remove_partial_copy(&temporary, is_dir, error));
    }
    if let Err(error) = publish_copy(&temporary, &destination) {
        let error = format!("rename {}: {error}", destination.display());
        return Err(remove_partial_copy(&temporary, is_dir, error));
    }
    Ok(destination)
}

/// Publish a complete staged item without replacing a destination that
/// appeared while it was being copied. All staging paths are siblings of the
/// destination, so the rename stays on one filesystem.
fn publish_copy(from: &Path, to: &Path) -> std::io::Result<()> {
    publish_copy_with(from, to, rename_exclusive)
}

/// Some filesystems have no exclusive rename: exFAT on macOS answers
/// `RENAME_EXCL` with ENOTSUP, and network or FUSE mounts on Linux may reject
/// `RENAME_NOREPLACE` with EINVAL. Duplicate and paste must keep working
/// there, so the fallback checks the destination and then renames; a
/// destination created in that narrow window can still be replaced, which is
/// the best such a filesystem offers.
fn publish_copy_with(
    from: &Path,
    to: &Path,
    exclusive: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> std::io::Result<()> {
    match exclusive(from, to) {
        Err(error) if exclusive_rename_unsupported(&error) => {
            if std::fs::symlink_metadata(to).is_ok() {
                return Err(std::io::Error::from(std::io::ErrorKind::AlreadyExists));
            }
            std::fs::rename(from, to)
        }
        result => result,
    }
}

#[cfg(unix)]
fn exclusive_rename_unsupported(error: &std::io::Error) -> bool {
    error.raw_os_error().is_some_and(|code| {
        [libc::ENOTSUP, libc::EOPNOTSUPP, libc::EINVAL, libc::ENOSYS].contains(&code)
    })
}

/// `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING` works on every Windows
/// filesystem, so there is nothing to fall back from.
#[cfg(windows)]
fn exclusive_rename_unsupported(_error: &std::io::Error) -> bool {
    false
}

/// `std`'s legacy limit for Windows paths: directory paths are capped at 248
/// UTF-16 units (260 for files) unless the `\\?\` prefix lifts the limit.
#[cfg(windows)]
const WINDOWS_LEGACY_MAX_PATH: usize = 248;

#[cfg(windows)]
fn rename_exclusive(from: &Path, to: &Path) -> std::io::Result<()> {
    use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVE_FILE_FLAGS};

    let from = wide_path(from)?;
    let to = wide_path(to)?;
    // Without MOVEFILE_REPLACE_EXISTING, MoveFileExW refuses to replace an
    // existing file; existing directories are rejected either way.
    unsafe {
        MoveFileExW(
            windows::core::PCWSTR(from.as_ptr()),
            windows::core::PCWSTR(to.as_ptr()),
            MOVE_FILE_FLAGS(0),
        )
    }
    .map_err(win32_io_error)
}

/// `MoveFileExW` gets the raw path, so it has neither the `\\?\` prefix nor
/// the normalization `std::fs` applies before every call: a path near
/// `MAX_PATH` fails with `ERROR_PATH_NOT_FOUND` even though each `std::fs`
/// step of the same copy succeeded. Paths past the legacy limit are therefore
/// made absolute by `GetFullPathNameW` — the verbatim prefix turns off `\..`
/// expansion, so the absolute form must come from the API — and get the
/// prefix; shorter absolute paths are passed through untouched.
#[cfg(windows)]
fn wide_path(path: &Path) -> std::io::Result<Vec<u16>> {
    use std::os::windows::ffi::OsStrExt;

    const SEP: u16 = b'\\' as u16;
    const ALT_SEP: u16 = b'/' as u16;
    const COLON: u16 = b':' as u16;
    const DOT: u16 = b'.' as u16;
    const QUERY: u16 = b'?' as u16;
    const VERBATIM: [u16; 4] = [SEP, SEP, QUERY, SEP];
    const NT: [u16; 4] = [SEP, QUERY, QUERY, SEP];
    const UNC: [u16; 8] = [
        SEP,
        SEP,
        QUERY,
        SEP,
        b'U' as u16,
        b'N' as u16,
        b'C' as u16,
        SEP,
    ];

    let wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    if wide.starts_with(&VERBATIM) || wide.starts_with(&NT) {
        return Ok(nul_terminated(wide));
    }
    let short_and_absolute = matches!(
        wide.as_slice(),
        [drive, COLON, SEP | ALT_SEP, ..] if *drive != SEP && *drive != ALT_SEP
    ) || matches!(wide.as_slice(), [SEP | ALT_SEP, SEP | ALT_SEP, ..]);
    if short_and_absolute && wide.len() < WINDOWS_LEGACY_MAX_PATH {
        return Ok(nul_terminated(wide));
    }

    let mut absolute = full_path(&wide)?;
    let prefix: &[u16] = match absolute.as_slice() {
        // C:\... => \\?\C:\...
        [_, COLON, SEP, ..] => &VERBATIM,
        // \\.\... => \\?\...
        [SEP, SEP, DOT, SEP, ..] => {
            absolute.drain(..4);
            &VERBATIM
        }
        // Already verbatim.
        [SEP, SEP, QUERY, SEP, ..] | [SEP, QUERY, QUERY, SEP, ..] => &[],
        // \\server\share => \\?\UNC\server\share
        [SEP, SEP, ..] => {
            absolute.drain(..2);
            &UNC
        }
        _ => &[],
    };
    let mut wide = Vec::with_capacity(prefix.len() + absolute.len() + 1);
    wide.extend_from_slice(prefix);
    wide.extend_from_slice(&absolute);
    wide.push(0);
    Ok(wide)
}

#[cfg(windows)]
fn nul_terminated(mut wide: Vec<u16>) -> Vec<u16> {
    wide.push(0);
    wide
}

/// Absolute, Windows-normalized form of `wide` (`/` becomes `\`, `.` and `..`
/// collapse). `GetFullPathNameW` reports the needed buffer size when the one
/// handed in is too small; a successful call returns the length without NUL.
#[cfg(windows)]
fn full_path(wide: &[u16]) -> std::io::Result<Vec<u16>> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetFullPathNameW;

    let input = nul_terminated(wide.to_vec());
    let mut buffer = vec![0u16; wide.len().max(WINDOWS_LEGACY_MAX_PATH)];
    loop {
        let len = unsafe {
            GetFullPathNameW(PCWSTR(input.as_ptr()), Some(&mut buffer[..]), None)
        } as usize;
        if len == 0 {
            return Err(std::io::Error::last_os_error());
        }
        if len < buffer.len() {
            buffer.truncate(len);
            return Ok(buffer);
        }
        buffer = vec![0u16; len];
    }
}

/// `MoveFileExW` reports Win32 failures as `HRESULT_FROM_WIN32`; unwrap them so
/// callers see the OS error code, kind and text `std::fs` would have produced.
#[cfg(windows)]
fn win32_io_error(error: windows::core::Error) -> std::io::Error {
    let code = error.code().0 as u32;
    match code & 0xFFFF_0000 {
        0x8007_0000 => std::io::Error::from_raw_os_error((code & 0xFFFF) as i32),
        _ => std::io::Error::other(error.to_string()),
    }
}

#[cfg(target_os = "macos")]
fn rename_exclusive(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let from = CString::new(from.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::other("copy path contains a NUL byte"))?;
    let to = CString::new(to.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::other("copy path contains a NUL byte"))?;
    // SAFETY: both NUL-terminated paths are alive for the call; RENAME_EXCL
    // asks the host filesystem to reject an existing destination atomically.
    if unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn rename_exclusive(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let from = CString::new(from.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::other("copy path contains a NUL byte"))?;
    let to = CString::new(to.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::other("copy path contains a NUL byte"))?;
    // SAFETY: AT_FDCWD resolves both relative paths against this process's
    // unchanged working directory. Absolute staging paths are used in practice.
    if unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    } == 0
    {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

fn remove_partial_copy(path: &Path, is_dir: bool, error: String) -> String {
    let cleanup = if is_dir {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    match cleanup {
        Ok(()) => error,
        // A copy may fail before creating its temporary file. There is no
        // partial item to report in that case.
        Err(cleanup_error) if cleanup_error.kind() == std::io::ErrorKind::NotFound => error,
        Err(cleanup_error) => format!(
            "{error}; partial copy remains at {}: {cleanup_error}",
            path.display()
        ),
    }
}

fn copy_item_into_dir(
    source: &Path,
    is_dir: bool,
    target_dir: &Path,
    prefer_original_name: bool,
) -> Result<PathBuf, String> {
    copy_item_into_dir_with(
        source,
        is_dir,
        target_dir,
        prefer_original_name,
        // std::fs::copy is what duplicate/paste used before staging: it keeps
        // mode bits, and on macOS clones on APFS (instant, no extra space)
        // keeping timestamps and extended attributes. The staged name is
        // unique, so the only file it can overwrite is the AppleDouble
        // `._name` sidecar macOS itself just wrote on a FAT / exFAT volume.
        &mut |source, destination| {
            std::fs::copy(source, destination)
                .map_err(|e| format!("copy {}: {e}", source.display()))
        },
    )
}

#[tauri::command]
pub async fn duplicate_item(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
) -> Result<FileOpResult, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn paste_item(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    source: String,
    target_dir: String,
) -> Result<FileOpResult, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Outcome of pasting the OS clipboard: items that landed, and the reason
/// each rejected one stayed behind (one bad entry must not lose the rest).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteClipboardResult {
    pub created: Vec<FileOpResult>,
    pub failed: Vec<String>,
}

/// Copy host-clipboard file references into `target_dir`.
///
/// The source paths are read from the OS clipboard **inside the host** and
/// never travel through IPC: a renderer-supplied "paste from anywhere" would
/// be an arbitrary-filesystem read once the copy lands inside a workspace
/// (where `read_file` is allowed). The destination is still confined to the
/// registered roots.
fn copy_clipboard_items_into(sources: &[String], target_dir: &Path) -> PasteClipboardResult {
    let mut created = Vec::new();
    let mut failed = Vec::new();
    for raw in sources {
        let original = Path::new(raw);
        let original_meta = match std::fs::symlink_metadata(original) {
            Ok(meta) => meta,
            Err(e) => {
                failed.push(format!("stat {}: {e}", original.display()));
                continue;
            }
        };
        if original_meta.file_type().is_symlink() {
            failed.push(format!("cannot copy symlink {}", original.display()));
            continue;
        }
        let source = match canonicalize_lenient(original) {
            Ok(source) => source,
            Err(e) => {
                failed.push(e);
                continue;
            }
        };
        let is_dir = match std::fs::metadata(&source) {
            Ok(meta) => meta.is_dir(),
            Err(e) => {
                failed.push(format!("stat {}: {e}", source.display()));
                continue;
            }
        };
        match copy_item_into_dir(&source, is_dir, target_dir, true) {
            Ok(destination) => created.push(FileOpResult {
                path: destination.to_string_lossy().into_owned(),
                is_dir,
            }),
            Err(e) => failed.push(e),
        }
    }
    PasteClipboardResult { created, failed }
}

/// Paste whatever file list the OS clipboard holds (a Finder / Explorer
/// copy). Empty `created` + empty `failed` means the clipboard carried no
/// file at all; the frontend then falls back to its own tree clipboard.
///
/// Only the clipboard read runs on the main thread. The copy, which can be a
/// whole folder from another volume, runs on a blocking worker like
/// `paste_item`, so the window keeps responding while it lasts.
#[tauri::command]
pub async fn paste_clipboard_items(
    app: tauri::AppHandle,
    db: tauri::State<'_, Arc<crate::db::Db>>,
    target_dir: String,
) -> Result<PasteClipboardResult, String> {
    let db = Arc::clone(db.inner());
    let dir = tauri::async_runtime::spawn_blocking(move || {
        let dir = ensure_allowed(&target_dir, &db)?;
        if !dir.is_dir() {
            return Err(format!("{} is not a directory", dir.display()));
        }
        Ok(dir)
    })
    .await
    .map_err(|e| e.to_string())??;
    let snapshot = crate::clipboard::os_file_snapshot_on_main_thread(&app).await?;
    tauri::async_runtime::spawn_blocking(move || copy_clipboard_items_into(&snapshot.paths, &dir))
        .await
        .map_err(|e| e.to_string())
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

    /// Every trash goes through `move_to_trash`: the trash crate's own
    /// `delete` defaults to an osascript → Finder chain on macOS.
    #[test]
    fn trash_calls_go_through_move_to_trash() {
        let needle = ["trash", "::delete("].concat();
        let mut offenders = Vec::new();
        let mut stack = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src")];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|ext| ext == "rs")
                    && std::fs::read_to_string(&path).unwrap().contains(&needle)
                {
                    offenders.push(path.display().to_string());
                }
            }
        }
        assert!(offenders.is_empty(), "direct trash deletes: {offenders:?}");
    }

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
    fn list_dir_flags_git_ignored_entries_and_omits_false() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.0.join("test.db")).unwrap();
        let workspace = Scratch::new();
        git2::Repository::init(&workspace.0).unwrap();
        std::fs::write(workspace.0.join(".gitignore"), "*.log\n").unwrap();
        std::fs::write(workspace.0.join("debug.log"), "").unwrap();
        std::fs::write(workspace.0.join("main.rs"), "").unwrap();
        let path = workspace.0.to_string_lossy().to_string();
        grant_root_in(&db, &path).unwrap();

        // Callers that only need names skip the Git work entirely.
        let plain = list_dir_blocking(&db, &path, None).unwrap();
        assert!(plain.iter().all(|e| !e.ignored));

        let entries = list_dir_blocking(&db, &path, Some(&path)).unwrap();
        let flag = |name: &str| entries.iter().find(|e| e.name == name).unwrap().ignored;
        assert!(flag(".git"));
        assert!(flag("debug.log"));
        assert!(!flag("main.rs"));
        assert!(!flag(".gitignore"));
        // Dirs still sort first; the flag does not reorder the listing.
        assert_eq!(entries[0].name, ".git");

        let json = serde_json::to_value(&entries).unwrap();
        let by_name = |name: &str| {
            json.as_array()
                .unwrap()
                .iter()
                .find(|e| e["name"] == name)
                .unwrap()
                .clone()
        };
        assert_eq!(by_name("debug.log")["ignored"], true);
        assert!(by_name("main.rs").get("ignored").is_none());
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

    /// A trailing space is a real part of the filename on Unix; the
    /// authorization entry points must resolve it verbatim instead of
    /// trimming it into the sibling file without the space.
    #[cfg(unix)]
    #[test]
    fn trailing_space_path_is_authorized_verbatim() {
        let scratch = Scratch::new();
        let plain = scratch.0.join("report");
        let spaced = scratch.0.join("report ");
        std::fs::write(&plain, b"plain").unwrap();
        std::fs::write(&spaced, b"spaced").unwrap();
        let db = crate::db::Db::open_at(&scratch.0.join("test.db")).unwrap();
        db.add_granted_root(&scratch.0.to_string_lossy()).unwrap();

        let resolved = ensure_allowed(&spaced.to_string_lossy(), &db).unwrap();
        assert_eq!(resolved, std::fs::canonicalize(&spaced).unwrap());

        let grant = grant_dir_for(&spaced.to_string_lossy()).unwrap();
        let want = strip_verbatim_prefix(std::fs::canonicalize(&scratch.0).unwrap());
        assert_eq!(grant, want);
    }

    #[test]
    fn clipboard_paste_copies_what_it_can_and_names_the_rest() {
        let source = Scratch::new();
        let destination = Scratch::new();
        let notes = source.0.join("notes.md");
        std::fs::write(&notes, b"hi").unwrap();
        std::fs::create_dir_all(source.0.join("assets")).unwrap();
        std::fs::write(source.0.join("assets").join("a.txt"), b"a").unwrap();
        let sources = vec![
            notes.to_string_lossy().to_string(),
            source.0.join("gone.md").to_string_lossy().to_string(),
            source.0.join("assets").to_string_lossy().to_string(),
        ];

        let result = copy_clipboard_items_into(&sources, &destination.0);
        assert_eq!(result.created.len(), 2);
        assert_eq!(result.failed.len(), 1);
        assert!(result.failed[0].contains("gone.md"));
        assert_eq!(
            std::fs::read(destination.0.join("notes.md")).unwrap(),
            b"hi"
        );
        assert!(destination.0.join("assets").join("a.txt").is_file());

        // Pasting the same item twice keeps the first copy intact.
        let again = copy_clipboard_items_into(&sources[..1], &destination.0);
        assert_eq!(again.created.len(), 1);
        assert!(again.created[0].path.ends_with("notes copy.md"));
        assert_eq!(
            std::fs::read(destination.0.join("notes.md")).unwrap(),
            b"hi"
        );
    }

    /// Regression: duplicate/paste must preserve permission bits — an
    /// executable script's copy has to stay executable (io::copy alone only
    /// moves bytes).
    #[cfg(unix)]
    #[test]
    fn copy_preserves_executable_bit() {
        use std::os::unix::fs::PermissionsExt;

        let source = Scratch::new();
        let destination = Scratch::new();
        let script = source.0.join("deploy.sh");
        std::fs::write(&script, b"#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o750)).unwrap();

        let copied = copy_item_into_dir(&script, false, &destination.0, true).unwrap();
        let mode = std::fs::metadata(&copied).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o750);
    }

    #[test]
    fn failed_directory_copy_leaves_no_destination_and_retry_keeps_its_name() {
        let source = Scratch::new();
        let destination = Scratch::new();
        let directory = source.0.join("assets");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("a.txt"), b"a").unwrap();
        std::fs::write(directory.join("b.txt"), b"b").unwrap();

        let mut copies = 0;
        let copied = copy_item_into_dir_with(
            &directory,
            true,
            &destination.0,
            true,
            &mut |source, destination| {
                copies += 1;
                if copies == 2 {
                    Err("injected copy failure after a completed file".to_string())
                } else {
                    std::fs::copy(source, destination).map_err(|error| error.to_string())
                }
            },
        );
        assert_eq!(copies, 2, "the failure must happen after a real file copy");
        assert!(copied.unwrap_err().contains("injected copy failure"));
        assert!(!destination.0.join("assets").exists());
        assert_eq!(std::fs::read_dir(&destination.0).unwrap().count(), 0);

        let retry = copy_item_into_dir(&directory, true, &destination.0, true).unwrap();
        assert_eq!(retry, destination.0.join("assets"));
        assert_eq!(std::fs::read(retry.join("a.txt")).unwrap(), b"a");
        assert_eq!(std::fs::read(retry.join("b.txt")).unwrap(), b"b");
    }

    #[test]
    fn a_file_created_during_copy_is_never_replaced() {
        let source = Scratch::new();
        let destination = Scratch::new();
        let file = source.0.join("notes.md");
        std::fs::write(&file, b"new copy").unwrap();
        let mut competing_file = None;

        let copied = copy_item_into_dir_with(
            &file,
            false,
            &destination.0,
            true,
            &mut |source, temporary| {
                let result = std::fs::copy(source, temporary).map_err(|error| error.to_string());
                let competing = destination.0.join("notes.md");
                std::fs::write(&competing, b"external").unwrap();
                competing_file = Some(competing);
                result
            },
        );

        assert!(copied.unwrap_err().contains("rename"));
        assert_eq!(std::fs::read(competing_file.unwrap()).unwrap(), b"external");
        assert_eq!(std::fs::read_dir(&destination.0).unwrap().count(), 1);
    }

    #[test]
    fn a_directory_created_during_copy_is_never_replaced() {
        let source = Scratch::new();
        let destination = Scratch::new();
        let directory = source.0.join("assets");
        std::fs::create_dir(&directory).unwrap();
        std::fs::write(directory.join("copy.txt"), b"copy").unwrap();

        let copied = copy_item_into_dir_with(
            &directory,
            true,
            &destination.0,
            true,
            &mut |source, temporary| {
                let result = std::fs::copy(source, temporary).map_err(|error| error.to_string());
                std::fs::create_dir(destination.0.join("assets")).unwrap();
                std::fs::write(
                    destination.0.join("assets").join("external.txt"),
                    b"external",
                )
                .unwrap();
                result
            },
        );

        assert!(copied.unwrap_err().contains("rename"));
        assert_eq!(
            std::fs::read(destination.0.join("assets").join("external.txt")).unwrap(),
            b"external"
        );
        assert!(!destination.0.join("assets").join("copy.txt").exists());
        assert_eq!(std::fs::read_dir(&destination.0).unwrap().count(), 1);
    }
    #[test]
    fn cleanup_failure_reports_the_staged_item_path() {
        let scratch = Scratch::new();
        let directory = scratch.0.join("incomplete");
        std::fs::create_dir(&directory).unwrap();

        let error = remove_partial_copy(&directory, false, "copy failed".to_string());

        assert!(error.starts_with("copy failed"));
        assert!(error.contains("partial copy remains at"));
        assert!(error.contains(&directory.to_string_lossy().to_string()));
        assert!(directory.is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn clipboard_paste_rejects_top_level_file_and_directory_symlinks() {
        use std::os::unix::fs::symlink;

        let source = Scratch::new();
        let destination = Scratch::new();
        std::fs::write(source.0.join("target.txt"), b"target").unwrap();
        std::fs::create_dir(source.0.join("target-dir")).unwrap();
        symlink(source.0.join("target.txt"), source.0.join("file-link")).unwrap();
        symlink(source.0.join("target-dir"), source.0.join("dir-link")).unwrap();
        let sources = ["file-link", "dir-link"]
            .map(|name| source.0.join(name).to_string_lossy().into_owned());

        let result = copy_clipboard_items_into(&sources, &destination.0);

        assert!(result.created.is_empty());
        assert_eq!(result.failed.len(), 2);
        assert!(result.failed.iter().all(|error| error.contains("symlink")));
        assert_eq!(std::fs::read_dir(&destination.0).unwrap().count(), 0);
    }

    /// exFAT on macOS answers `RENAME_EXCL` with ENOTSUP: the copy must
    /// still publish, and still refuse to replace an existing destination.
    #[cfg(unix)]
    #[test]
    fn unsupported_exclusive_rename_falls_back_without_replacing() {
        let scratch = Scratch::new();
        let unsupported =
            |_: &Path, _: &Path| Err(std::io::Error::from_raw_os_error(libc::ENOTSUP));
        let staged = scratch.0.join(".staged");
        let destination = scratch.0.join("notes.md");
        std::fs::write(&staged, b"copy").unwrap();

        publish_copy_with(&staged, &destination, unsupported).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), b"copy");
        assert!(!staged.exists());

        std::fs::write(&staged, b"second").unwrap();
        let error = publish_copy_with(&staged, &destination, unsupported).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read(&destination).unwrap(), b"copy");
        assert_eq!(std::fs::read(&staged).unwrap(), b"second");
    }

    #[cfg(unix)]
    #[test]
    fn other_exclusive_rename_errors_do_not_fall_back() {
        let scratch = Scratch::new();
        let staged = scratch.0.join(".staged");
        let destination = scratch.0.join("notes.md");
        std::fs::write(&staged, b"copy").unwrap();

        let error = publish_copy_with(&staged, &destination, |_, _| {
            Err(std::io::Error::from_raw_os_error(libc::EACCES))
        })
        .unwrap_err();
        assert_eq!(error.raw_os_error(), Some(libc::EACCES));
        assert!(!destination.exists());
        assert!(staged.exists());
    }

    /// The staged name must not grow with the source name: a 213-character
    /// name fits the 255 limit, its staged sibling must too. On Windows the
    /// temp dir alone makes the full path pass `MAX_PATH`, so this also pins
    /// that the publication rename handles long paths like `std::fs` does.
    #[test]
    fn long_names_paste_and_duplicate() {
        let source = Scratch::new();
        let destination = Scratch::new();
        let name = format!("{}.md", "a".repeat(210));
        let file = source.0.join(&name);
        std::fs::write(&file, b"hi").unwrap();

        let pasted = copy_item_into_dir(&file, false, &destination.0, true).unwrap();
        assert_eq!(pasted, destination.0.join(&name));
        let duplicated = copy_item_into_dir(&file, false, &source.0, false).unwrap();
        assert_eq!(std::fs::read(duplicated).unwrap(), b"hi");
    }

    /// Duplicate/paste keep the modification time like a file-manager copy
    /// (APFS clone / copyfile on macOS, CopyFileEx on Windows).
    #[cfg(any(target_os = "macos", windows))]
    #[test]
    fn copy_keeps_the_source_modification_time() {
        let source = Scratch::new();
        let destination = Scratch::new();
        let file = source.0.join("photo.txt");
        std::fs::write(&file, b"data").unwrap();
        let old = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_577_880_000);
        std::fs::File::options()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(old)
            .unwrap();

        let copied = copy_item_into_dir(&file, false, &destination.0, true).unwrap();
        assert_eq!(std::fs::metadata(copied).unwrap().modified().unwrap(), old);
    }

    #[test]
    fn grant_for_file_under_uncreated_dirs_creates_and_admits_them() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.0.join("test.db")).unwrap();
        let outside = Scratch::new();
        let file = outside.0.join("investigate").join("deeper").join("dump.sql");
        let file_str = file.to_string_lossy().to_string();

        // Two levels are missing: the scope is still the file's directory.
        let dir = grant_dir_for(&file_str).unwrap();
        let base = strip_verbatim_prefix(std::fs::canonicalize(&outside.0).unwrap());
        assert_eq!(dir, base.join("investigate").join("deeper"));

        // Granting creates it, so the engine sees a real root on next launch.
        grant_root_in(&db, &file_str).unwrap();
        assert!(dir.is_dir());
        assert!(ensure_allowed(&file_str, &db).is_ok());
    }

    #[test]
    fn lenient_canonicalize_rejects_parent_hop_past_missing_dir() {
        let outside = Scratch::new();
        let hop = outside.0.join("missing").join("..").join("x.txt");
        assert!(canonicalize_lenient(&hop).is_err());
        // Same rule when the hop pops a directory that does exist: only the
        // platform's path parser decides what `..` leaves behind, so the
        // tail after it may name a directory nobody created.
        std::fs::create_dir(outside.0.join("sub")).unwrap();
        let hop = outside.0.join("sub").join("..").join("missing").join("x.txt");
        assert!(canonicalize_lenient(&hop).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn lenient_canonicalize_refuses_dangling_symlink() {
        let workspace = Scratch::new();
        let elsewhere = Scratch::new();
        let link = workspace.0.join("link");
        std::os::unix::fs::symlink(elsewhere.0.join("not-yet"), &link).unwrap();
        // Lexically inside the workspace, but writes would follow the link out.
        assert!(canonicalize_lenient(&link.join("f.txt")).is_err());
        assert!(canonicalize_lenient(&link).is_err());
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
}
