//! Generic per-plugin document storage.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};


#[derive(Debug, Clone)]
pub(crate) struct StorageRoots {
    pub(crate) data: PathBuf,
    pub(crate) program: PathBuf,
}

impl StorageRoots {
    fn system() -> Result<Self, String> {
        Ok(Self {
            data: crate::paths::app_home(),
            program: crate::paths::program_dir()?,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StorageLocationKind {
    Data,
    Program,
    Custom,
}

impl StorageLocationKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Data => "data",
            Self::Program => "program",
            Self::Custom => "custom",
        }
    }

    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "data" => Ok(Self::Data),
            "program" => Ok(Self::Program),
            "custom" => Ok(Self::Custom),
            _ => Err(format!("unknown storage location: {value}")),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct StorageLocationSelection {
    pub(crate) kind: StorageLocationKind,
    pub(crate) path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedStorageLocation {
    pub kind: StorageLocationKind,
    pub display_path: String,
    pub writable: bool,
    #[serde(skip)]
    root: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredText {
    pub content: String,
    pub version: String,
}

fn version_of(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    if value.is_empty()
        || value.contains('\\')
        || value.contains("//")
        || value.contains(':')
        || value.contains('\0')
        || value.split('/').any(|part| matches!(part, "" | "." | ".."))
    {
        return Err(format!("unsafe relative path: {value:?}"));
    }
    let path = Path::new(value);
    if path.is_absolute() {
        return Err(format!("absolute path is forbidden: {value}"));
    }
    for component in path.components() {
        let Component::Normal(name) = component else {
            return Err(format!("unsafe relative path: {value:?}"));
        };
        let name = name.to_string_lossy();
        let stem = name.split('.').next().unwrap_or("");
        let reserved = matches!(stem.to_ascii_uppercase().as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || stem.get(..3).is_some_and(|prefix| {
                matches!(prefix.to_ascii_uppercase().as_str(), "COM" | "LPT")
                    && stem.as_bytes().get(3).is_some_and(|digit| matches!(digit, b'1'..=b'9'))
            });
        if name.ends_with('.') || name.ends_with(' ') || reserved {
            return Err(format!("unsafe relative path: {value:?}"));
        }
    }
    Ok(path.to_path_buf())
}

fn safe_prefix(value: Option<&str>) -> Result<Option<PathBuf>, String> {
    match value {
        None | Some("") => Ok(None),
        Some(value) => safe_relative_path(value).map(Some),
    }
}

fn authorize(state_path: &Path, id: &str) -> Result<(), String> {
    super::manifest::require_valid_id(id)?;
    let state = super::state::read_state(state_path)?;
    let record = state
        .plugins
        .get(id)
        .ok_or_else(|| format!("{id}: plugin is not installed"))?;
    if !record.enabled {
        return Err(format!("{id}: plugin is disabled"));
    }
    if record.quarantined {
        return Err(format!("{id}: plugin is quarantined"));
    }
    if !record.permissions.iter().any(|p| p == "plugin.storage") {
        return Err(format!("{id}: missing plugin.storage permission"));
    }
    Ok(())
}

fn selected_base(
    state_path: &Path,
    roots: &StorageRoots,
    id: &str,
) -> Result<(StorageLocationKind, PathBuf), String> {
    let state = super::state::read_state(state_path)?;
    match state.document_storage.get(id) {
        None => Ok((StorageLocationKind::Data, roots.data.clone())),
        Some(selection) => {
            let kind = StorageLocationKind::parse(&selection.kind)?;
            let base = match kind {
                StorageLocationKind::Data => roots.data.clone(),
                StorageLocationKind::Program => roots.program.clone(),
                StorageLocationKind::Custom => selection
                    .custom_path
                    .as_ref()
                    .map(PathBuf::from)
                    .ok_or_else(|| format!("{id}: custom storage path is missing"))?,
            };
            Ok((kind, base))
        }
    }
}

fn plugin_root(base: &Path, id: &str) -> PathBuf {
    base.join("plugin-data").join(id)
}
// A stable sibling of the document root survives document replacement,
// location migration and uninstall. Different host state files still open
// the same kernel lock when their selected physical root is shared.
fn document_lock_path(base: &Path, id: &str) -> Result<PathBuf, String> {
    let parent = base.join("plugin-data");
    fs::create_dir_all(&parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    let parent = dunce::canonicalize(&parent)
        .map_err(|e| format!("canonicalize {}: {e}", parent.display()))?;
    Ok(parent.join(format!(".{id}.documents.lock")))
}

fn lock_document_root(base: &Path, id: &str) -> Result<super::file_lock::FileLock, String> {
    super::file_lock::exclusive(&document_lock_path(base, id)?)
}

fn lock_migration_roots(
    old: &Path,
    new: &Path,
    id: &str,
) -> Result<(super::file_lock::FileLock, Option<super::file_lock::FileLock>), String> {
    let mut first = document_lock_path(old, id)?;
    let mut second = document_lock_path(new, id)?;
    // Canonical parent paths collapse junction/symlink aliases; Windows
    // ordering must also collapse case aliases to prevent AB/BA deadlocks.
    let key = |path: &Path| {
        let path = path.to_string_lossy().into_owned();
        if cfg!(windows) { path.to_lowercase() } else { path }
    };
    let first_key = key(&first);
    let second_key = key(&second);
    if first_key == second_key {
        return Ok((super::file_lock::exclusive(&first)?, None));
    }
    if first_key > second_key {
        std::mem::swap(&mut first, &mut second);
    }
    let first = super::file_lock::exclusive(&first)?;
    let second = super::file_lock::exclusive(&second)?;
    Ok((first, Some(second)))
}


fn is_existing_base_writable(base: &Path) -> bool {
    if !base.is_dir() {
        return false;
    }
    let probe = base.join(format!(".ccgui-write-probe-{}", uuid::Uuid::new_v4()));
    match OpenOptions::new().write(true).create_new(true).open(&probe) {
        Ok(file) => {
            drop(file);
            fs::remove_file(probe).is_ok()
        }
        Err(_) => false,
    }
}

fn probe_writable(base: &Path) -> Result<(), String> {
    if base.exists() && !base.is_dir() {
        return Err(format!("{}: not a directory", base.display()));
    }
    fs::create_dir_all(base).map_err(|e| format!("mkdir {}: {e}", base.display()))?;
    let probe = base.join(format!(".ccgui-write-probe-{}", uuid::Uuid::new_v4()));
    let result = OpenOptions::new().write(true).create_new(true).open(&probe);
    match result {
        Ok(file) => {
            drop(file);
            fs::remove_file(&probe).map_err(|e| format!("remove {}: {e}", probe.display()))
        }
        Err(error) => Err(format!("{} is not writable: {error}", base.display())),
    }
}

fn get_location_at(
    state_path: &Path,
    roots: &StorageRoots,
    id: &str,
) -> Result<ResolvedStorageLocation, String> {
    let _state_guard = super::state::lock_state(state_path)?;
    authorize(state_path, id)?;
    let (kind, base) = selected_base(state_path, roots, id)?;
    let root = plugin_root(&base, id);
    Ok(ResolvedStorageLocation {
        kind,
        display_path: root.to_string_lossy().into_owned(),
        writable: is_existing_base_writable(&base),
        root: root.to_string_lossy().into_owned(),
    })
}

pub(crate) fn select_location_at(
    state_path: &Path,
    roots: &StorageRoots,
    id: &str,
    selection: StorageLocationSelection,
) -> Result<ResolvedStorageLocation, String> {
    select_location_at_with_writer(state_path, roots, id, selection, super::state::write_state)
}

fn select_location_at_with_writer(
    state_path: &Path,
    roots: &StorageRoots,
    id: &str,
    selection: StorageLocationSelection,
    write_state: impl FnOnce(&Path, &super::state::PluginsState) -> Result<(), String>,
) -> Result<ResolvedStorageLocation, String> {
    let _state_guard = super::state::lock_state(state_path)?;
    authorize(state_path, id)?;
    let new_base = resolve_selection_base(roots, &selection)?;
    probe_writable(&new_base)?;

    let mut state = super::state::read_state(state_path)?;
    let old_base = base_from_state(&state, roots, id)?;
    let old_root = plugin_root(&old_base, id);
    let new_root = plugin_root(&new_base, id);

    if roots_are_equivalent(&old_base, &new_base, id) {
        set_selection(&mut state, id, &selection, &new_base);
        write_state(state_path, &state)?;
        return resolved_location(selection.kind, new_root);
    }
    let _root_guards = lock_migration_roots(&old_base, &new_base, id)?;


    if old_root.exists() {
        scan_for_reparse_points(&old_root)?;
    }
    if new_root.exists() {
        scan_for_reparse_points(&new_root)?;
    }

    let old_exists = old_root.exists();
    let target_exists = new_root.exists();
    let target_empty = target_exists && tree_is_empty(&new_root)?;
    let target_identical = old_exists
        && target_exists
        && !target_empty
        && trees_are_identical(&old_root, &new_root)?;
    if target_exists && !target_empty && !target_identical {
        return Err(format!(
            "storage migration conflict: target {} contains a different document tree",
            new_root.display()
        ));
    }

    let transaction_id = uuid::Uuid::new_v4();
    let old_hidden = sibling_transaction_path(&old_root, "old", transaction_id);
    let target_saved = sibling_transaction_path(&new_root, "target", transaction_id);
    let target_staged = sibling_transaction_path(&new_root, "stage", transaction_id);
    let needs_install = old_exists && !target_identical;

    if needs_install {
        let target_parent = new_root
            .parent()
            .ok_or_else(|| format!("{} has no parent", new_root.display()))?;
        fs::create_dir_all(target_parent)
            .map_err(|e| format!("mkdir {}: {e}", target_parent.display()))?;
        if let Err(error) = copy_tree(&old_root, &target_staged) {
            remove_tree_if_exists(&target_staged);
            return Err(error);
        }
    }

    let mut old_is_hidden = false;
    let mut target_is_saved = false;
    let mut target_is_installed = false;
    let migration_result = (|| {
        if old_exists {
            fs::rename(&old_root, &old_hidden)
                .map_err(|e| format!("hide {}: {e}", old_root.display()))?;
            old_is_hidden = true;
        }
        if needs_install {
            if target_exists {
                fs::rename(&new_root, &target_saved)
                    .map_err(|e| format!("stage existing target {}: {e}", new_root.display()))?;
                target_is_saved = true;
            }
            fs::rename(&target_staged, &new_root)
                .map_err(|e| format!("install target {}: {e}", new_root.display()))?;
            target_is_installed = true;
        }
        set_selection(&mut state, id, &selection, &new_base);
        write_state(state_path, &state)
    })();

    if let Err(error) = migration_result {
        let mut rollback_errors = Vec::new();
        if target_is_installed {
            if let Err(rollback) = fs::rename(&new_root, &target_staged) {
                rollback_errors.push(format!("remove installed target: {rollback}"));
            }
        }
        if target_is_saved {
            if let Err(rollback) = fs::rename(&target_saved, &new_root) {
                rollback_errors.push(format!("restore target: {rollback}"));
            }
        }
        if old_is_hidden {
            if let Err(rollback) = fs::rename(&old_hidden, &old_root) {
                rollback_errors.push(format!("restore old root: {rollback}"));
            }
        }
        remove_tree_if_exists(&target_staged);
        let rollback = if rollback_errors.is_empty() {
            String::new()
        } else {
            format!("; rollback failed: {}", rollback_errors.join("; "))
        };
        return Err(format!("{error}{rollback}"));
    }

    remove_tree_if_exists(&old_hidden);
    remove_tree_if_exists(&target_saved);
    remove_tree_if_exists(&target_staged);
    resolved_location(selection.kind, new_root)
}

fn resolve_selection_base(
    roots: &StorageRoots,
    selection: &StorageLocationSelection,
) -> Result<PathBuf, String> {
    match selection.kind {
        StorageLocationKind::Data => Ok(roots.data.clone()),
        StorageLocationKind::Program => Ok(roots.program.clone()),
        StorageLocationKind::Custom => {
            let path = selection.path.as_deref().unwrap_or("").trim();
            if path.is_empty() {
                return Err("customPath is required for custom storage".into());
            }
            let path = PathBuf::from(path);
            if !path.is_absolute() {
                return Err("customPath must be absolute".into());
            }
            Ok(path)
        }
    }
}

fn base_from_state(
    state: &super::state::PluginsState,
    roots: &StorageRoots,
    id: &str,
) -> Result<PathBuf, String> {
    let Some(selection) = state.document_storage.get(id) else {
        return Ok(roots.data.clone());
    };
    match StorageLocationKind::parse(&selection.kind)? {
        StorageLocationKind::Data => Ok(roots.data.clone()),
        StorageLocationKind::Program => Ok(roots.program.clone()),
        StorageLocationKind::Custom => selection
            .custom_path
            .as_ref()
            .map(PathBuf::from)
            .ok_or_else(|| format!("{id}: custom storage path is missing")),
    }
}

fn set_selection(
    state: &mut super::state::PluginsState,
    id: &str,
    selection: &StorageLocationSelection,
    base: &Path,
) {
    state.document_storage.insert(
        id.to_string(),
        super::state::DocumentStorageSelection {
            kind: selection.kind.as_str().into(),
            custom_path: (selection.kind == StorageLocationKind::Custom)
                .then(|| base.to_string_lossy().into_owned()),
        },
    );
}

fn resolved_location(
    kind: StorageLocationKind,
    root: PathBuf,
) -> Result<ResolvedStorageLocation, String> {
    Ok(ResolvedStorageLocation {
        kind,
        display_path: root.to_string_lossy().into_owned(),
        writable: true,
        root: root.to_string_lossy().into_owned(),
    })
}

fn roots_are_equivalent(old_base: &Path, new_base: &Path, id: &str) -> bool {
    if plugin_root(old_base, id) == plugin_root(new_base, id) {
        return true;
    }
    match (fs::canonicalize(old_base), fs::canonicalize(new_base)) {
        (Ok(old), Ok(new)) => plugin_root(&old, id) == plugin_root(&new, id),
        _ => false,
    }
}

fn sibling_transaction_path(root: &Path, label: &str, id: uuid::Uuid) -> PathBuf {
    root.with_file_name(format!(
        ".{}.ccgui-{label}-{id}",
        root.file_name().and_then(|name| name.to_str()).unwrap_or("plugin")
    ))
}

fn tree_is_empty(root: &Path) -> Result<bool, String> {
    Ok(fs::read_dir(root)
        .map_err(|e| format!("list {}: {e}", root.display()))?
        .next()
        .is_none())
}

fn trees_are_identical(left: &Path, right: &Path) -> Result<bool, String> {
    let left_meta = fs::symlink_metadata(left).map_err(|e| format!("stat {}: {e}", left.display()))?;
    let right_meta = fs::symlink_metadata(right).map_err(|e| format!("stat {}: {e}", right.display()))?;
    if left_meta.is_dir() != right_meta.is_dir() || left_meta.is_file() != right_meta.is_file() {
        return Ok(false);
    }
    if left_meta.is_file() {
        if left_meta.len() != right_meta.len() {
            return Ok(false);
        }
        return files_are_identical(left, right);
    }
    let mut left_entries = fs::read_dir(left)
        .map_err(|e| format!("list {}: {e}", left.display()))?
        .map(|entry| entry.map(|entry| entry.file_name()).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    let mut right_entries = fs::read_dir(right)
        .map_err(|e| format!("list {}: {e}", right.display()))?
        .map(|entry| entry.map(|entry| entry.file_name()).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    left_entries.sort();
    right_entries.sort();
    if left_entries != right_entries {
        return Ok(false);
    }
    for name in left_entries {
        if !trees_are_identical(&left.join(&name), &right.join(name))? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn files_are_identical(left: &Path, right: &Path) -> Result<bool, String> {
    let mut left = File::open(left).map_err(|e| e.to_string())?;
    let mut right = File::open(right).map_err(|e| e.to_string())?;
    let mut left_buffer = [0_u8; 8192];
    let mut right_buffer = [0_u8; 8192];
    loop {
        let left_read = left.read(&mut left_buffer).map_err(|e| e.to_string())?;
        let right_read = right.read(&mut right_buffer).map_err(|e| e.to_string())?;
        if left_read != right_read || left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    if is_reparse_point(source)? {
        return Err(format!("refusing storage migration: {} is a reparse point", source.display()));
    }
    let metadata = fs::symlink_metadata(source).map_err(|e| format!("stat {}: {e}", source.display()))?;
    if metadata.is_dir() {
        fs::create_dir(destination).map_err(|e| format!("mkdir {}: {e}", destination.display()))?;
        for entry in fs::read_dir(source).map_err(|e| format!("list {}: {e}", source.display()))? {
            let entry = entry.map_err(|e| e.to_string())?;
            copy_tree(&entry.path(), &destination.join(entry.file_name()))?;
        }
        return Ok(());
    }
    if !metadata.is_file() {
        return Err(format!("refusing storage migration: unsupported file type at {}", source.display()));
    }
    fs::copy(source, destination)
        .map(|_| ())
        .map_err(|e| format!("copy {} to {}: {e}", source.display(), destination.display()))
}

fn remove_tree_if_exists(path: &Path) {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => {
            let _ = fs::remove_dir_all(path);
        }
        Ok(_) => {
            let _ = fs::remove_file(path);
        }
        Err(_) => {}
    }
}

/// Windows marks junctions, symlinks and other mount points with the reparse
/// attribute, and `FileType::is_symlink` alone does not catch junctions.
fn is_reparse_point(path: &Path) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("stat {}: {error}", path.display())),
    };
    if metadata.file_type().is_symlink() {
        return Ok(true);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt; // FILE_ATTRIBUTE_REPARSE_POINT
        if metadata.file_attributes() & 0x400 != 0 {
            return Ok(true);
        }
    }
    Ok(false)
}

/// TOCTOU-hardened confinement: walk every existing component of `target`
/// under `root`, refusing reparse points (symlink/junction) and anything
/// whose canonical form leaves the canonical root. This runs again right
/// before each mutating operation, because a check performed once can be
/// raced by swapping a directory for a junction. A residual race remains for
/// the final component-to-syscall window; closing it needs handle-relative
/// opens, which is out of scope for this hardening pass.
///
/// `root` itself is not trusted either: the walk starts at the volume/share
/// prefix and descends through every ancestor of `root` (the last of which is
/// `root`), so a junction *above* the root cannot be followed before its
/// reparse attribute is discovered. Asset grants rely on this: they call
/// `confine_to_root(path, path)` to reject a path whose own ancestry leaves
/// the namespace it appears to live in.
pub(super) fn confine_to_root(root: &Path, target: &Path) -> Result<(), String> {
    let relative = target
        .strip_prefix(root)
        .map_err(|_| format!("path escapes plugin storage: {}", target.display()))?;
    let mut cursor = PathBuf::with_capacity(target.as_os_str().len());
    for component in root.components() {
        cursor.push(component);
        if !matches!(component, Component::Prefix(_)) && is_reparse_point(&cursor)? {
            return Err(format!("path crosses a reparse point: {}", cursor.display()));
        }
    }
    let canonical_root =
        fs::canonicalize(root).map_err(|e| format!("canonicalize {}: {e}", root.display()))?;
    for component in relative.components() {
        cursor.push(component);
        if is_reparse_point(&cursor)? {
            return Err(format!("path crosses a reparse point: {}", cursor.display()));
        }
        if !cursor.exists() {
            return Ok(()); // the rest of the path does not exist yet
        }
        let resolved = fs::canonicalize(&cursor)
            .map_err(|e| format!("canonicalize {}: {e}", cursor.display()))?;
        if !resolved.starts_with(&canonical_root) {
            return Err(format!("path escapes plugin storage: {}", cursor.display()));
        }
    }
    Ok(())
}

fn backup_path(target: &Path) -> PathBuf {
    target.with_file_name(format!(
        "{}.bak",
        target.file_name().and_then(|n| n.to_str()).unwrap_or("document")
    ))
}

fn checked_target(root: &Path, relative: &str, create_parents: bool) -> Result<PathBuf, String> {
    let relative = safe_relative_path(relative)?;
    if create_parents {
        fs::create_dir_all(root).map_err(|e| format!("mkdir {}: {e}", root.display()))?;
    }
    if !root.exists() {
        return Ok(root.join(relative));
    }
    let target = root.join(&relative);
    confine_to_root(root, &target)?;
    if create_parents {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
    }
    Ok(target)
}


fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("read {}: {error}", path.display())),
    }
}
fn read_text_at(
    state_path: &Path,
    roots: &StorageRoots,
    id: &str,
    relative: &str,
) -> Result<Option<StoredText>, String> {
    let _state_guard = super::state::lock_state(state_path)?;
    authorize(state_path, id)?;
    let (_, base) = selected_base(state_path, roots, id)?;
    let _root_guard = lock_document_root(&base, id)?;
    let target = checked_target(&plugin_root(&base, id), relative, false)?;
    let Some(bytes) = read_bytes(&target)? else { return Ok(None) };
    let version = version_of(&bytes);
    let content = String::from_utf8(bytes)
        .map_err(|e| format!("{} is not UTF-8: {e}", target.display()))?;
    Ok(Some(StoredText { content, version }))
}

fn current_version(path: &Path) -> Result<Option<String>, String> {
    read_bytes(path).map(|bytes| bytes.map(|bytes| version_of(&bytes)))
}

pub(crate) fn write_text_at(
    state_path: &Path,
    roots: &StorageRoots,
    id: &str,
    relative: &str,
    content: &str,
    expected_version: Option<String>,
) -> Result<WriteResult, String> {
    let _state_guard = super::state::lock_state(state_path)?;
    authorize(state_path, id)?;
    let (_, base) = selected_base(state_path, roots, id)?;
    let _root_guard = lock_document_root(&base, id)?;
    let root = plugin_root(&base, id);
    let target = checked_target(&root, relative, true)?;
    let current = current_version(&target)?;
    if current != expected_version {
        return Ok(WriteResult::Conflict { current_version: current });
    }

    let tmp = target.with_file_name(format!(
        ".{}.{}.tmp",
        target.file_name().and_then(|n| n.to_str()).unwrap_or("document"),
        uuid::Uuid::new_v4()
    ));
    // Re-validate immediately before mutating: the parent chain may have been
    // swapped for a junction since `checked_target` ran.
    confine_to_root(&root, &target)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .map_err(|e| format!("write {}: {e}", tmp.display()))?;
    file.write_all(content.as_bytes())
        .and_then(|_| file.flush())
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("flush {}: {e}", tmp.display()))?;
    drop(file);

    let backup = backup_path(&target);
    if target.exists() {
        if backup.exists() {
            fs::remove_file(&backup).map_err(|e| format!("remove {}: {e}", backup.display()))?;
        }
        fs::rename(&target, &backup)
            .map_err(|e| format!("backup {}: {e}", target.display()))?;
    }
    if let Err(error) = fs::rename(&tmp, &target) {
        if backup.exists() && !target.exists() {
            let _ = fs::rename(&backup, &target);
        }
        let _ = fs::remove_file(&tmp);
        return Err(format!("replace {}: {error}", target.display()));
    }
    if let Some(parent) = target.parent() {
        if let Ok(directory) = File::open(parent) {
            let _ = directory.sync_all();
        }
    }
    Ok(WriteResult::Written { version: version_of(content.as_bytes()) })
}

fn list_at(
    state_path: &Path,
    roots: &StorageRoots,
    id: &str,
    prefix: Option<&str>,
) -> Result<Vec<String>, String> {
    let _state_guard = super::state::lock_state(state_path)?;
    authorize(state_path, id)?;
    let (_, base) = selected_base(state_path, roots, id)?;
    let _root_guard = lock_document_root(&base, id)?;
    let root = plugin_root(&base, id);
    let prefix = safe_prefix(prefix)?;
    let start = prefix.as_ref().map_or_else(|| root.clone(), |prefix| root.join(prefix));
    if is_reparse_point(&start)? {
        return Err(format!("path crosses a reparse point: {}", start.display()));
    }
    if !start.exists() {
        return Ok(Vec::new());
    }
    let canonical_root = fs::canonicalize(&root)
        .map_err(|e| format!("canonicalize {}: {e}", root.display()))?;
    let mut stack = vec![start];
    let mut output = Vec::new();
    while let Some(dir) = stack.pop() {
        if is_reparse_point(&dir)? {
            return Err(format!("path crosses a reparse point: {}", dir.display()));
        }
        let canonical = fs::canonicalize(&dir)
            .map_err(|e| format!("canonicalize {}: {e}", dir.display()))?;
        if !canonical.starts_with(&canonical_root) {
            return Err(format!("path escapes plugin storage: {}", dir.display()));
        }
        if canonical.is_file() {
            let relative = dir.strip_prefix(&root).map_err(|e| e.to_string())?;
            output.push(relative.to_string_lossy().replace('\\', "/"));
            continue;
        }
        for entry in fs::read_dir(&dir).map_err(|e| format!("list {}: {e}", dir.display()))? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.extension().and_then(|x| x.to_str()) == Some("tmp") {
                continue;
            }
            stack.push(path);
        }
    }
    output.sort();
    Ok(output)
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum WriteResult {
    Written { version: String },
    Conflict { current_version: Option<String> },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum RemoveResult {
    Removed,
    Conflict { current_version: Option<String> },
}

#[tauri::command]
pub async fn plugin_document_storage_get_location(
    plugin_id: String,
) -> Result<ResolvedStorageLocation, String> {
    tauri::async_runtime::spawn_blocking(move || {
        get_location_at(&super::state::state_path(), &StorageRoots::system()?, &plugin_id)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugin_document_storage_select_location(
    plugin_id: String,
    kind: StorageLocationKind,
    custom_path: Option<String>,
) -> Result<ResolvedStorageLocation, String> {
    tauri::async_runtime::spawn_blocking(move || {
        select_location_at(
            &super::state::state_path(),
            &StorageRoots::system()?,
            &plugin_id,
            StorageLocationSelection { kind, path: custom_path },
        )
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugin_document_storage_read_text(
    plugin_id: String,
    relative_path: String,
) -> Result<Option<StoredText>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_text_at(
            &super::state::state_path(),
            &StorageRoots::system()?,
            &plugin_id,
            &relative_path,
        )
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugin_document_storage_write_text_atomic(
    plugin_id: String,
    relative_path: String,
    content: String,
    expected_version: Option<String>,
) -> Result<WriteResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_text_at(
            &super::state::state_path(),
            &StorageRoots::system()?,
            &plugin_id,
            &relative_path,
            &content,
            expected_version,
        )
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugin_document_storage_remove(
    plugin_id: String,
    relative_path: String,
    expected_version: Option<String>,
) -> Result<RemoveResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        remove_with_version_at(
            &super::state::state_path(),
            &StorageRoots::system()?,
            &plugin_id,
            &relative_path,
            expected_version.as_deref(),
        )
    }).await.map_err(|e| e.to_string())?
}

fn remove_with_version_at(
    state_path: &Path,
    roots: &StorageRoots,
    plugin_id: &str,
    relative_path: &str,
    expected_version: Option<&str>,
) -> Result<RemoveResult, String> {
    let _state_guard = super::state::lock_state(state_path)?;
    authorize(state_path, plugin_id)?;
    let (_, base) = selected_base(state_path, roots, plugin_id)?;
    let _root_guard = lock_document_root(&base, plugin_id)?;
    let root = plugin_root(&base, plugin_id);
    let target = checked_target(&root, relative_path, false)?;
    // Confine before reading through the path: a junction planted under the
    // root must fail here rather than be read or unlinked.
    if root.exists() {
        confine_to_root(&root, &target)?;
    }
    let current = current_version(&target)?;
    if let Some(expected) = expected_version {
        if current.as_deref() != Some(expected) {
            return Ok(RemoveResult::Conflict { current_version: current });
        }
    }
    // Re-validate immediately before mutating (TOCTOU: the parent chain may
    // have become a junction since `checked_target` ran).
    if root.exists() {
        confine_to_root(&root, &target)?;
    }
    match fs::remove_file(&target) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("remove {}: {error}", target.display())),
    }
    // The rolling backup must never outlive the document it backs up: leaving
    // it behind would let a later read resurrect removed content.
    let backup = backup_path(&target);
    match fs::remove_file(&backup) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("remove {}: {error}", backup.display())),
    }
    Ok(RemoveResult::Removed)
}

#[tauri::command]
pub async fn plugin_document_storage_list(
    plugin_id: String,
    prefix: Option<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        list_at(
            &super::state::state_path(),
            &StorageRoots::system()?,
            &plugin_id,
            prefix.as_deref(),
        )
    }).await.map_err(|e| e.to_string())?
}

/// The document root a plugin's resources resolve against, following the
/// current location selection. Asset reads need the path without taking the
/// uninstall document lock, so this is deliberately lock-free: callers
/// re-resolve it after reading to detect a location switch mid-read.
pub(super) fn document_root_at(
    state_path: &Path,
    id: &str,
    roots: Option<&StorageRoots>,
) -> Result<PathBuf, String> {
    super::manifest::require_valid_id(id)?;
    let system_roots;
    let roots = match roots {
        Some(roots) => roots,
        None => {
            system_roots = StorageRoots::system()?;
            &system_roots
        }
    };
    let (_, base) = selected_base(state_path, roots, id)?;
    Ok(plugin_root(&base, id))
}

/// Held by uninstall from its preflight through state persistence. The caller
/// must acquire the state lock before this physical document-root lock.
pub(crate) struct DocumentsGuard {
    root: PathBuf,
    _lock: super::file_lock::FileLock,
}

pub(crate) fn lock_documents_at(
    state_path: &Path,
    id: &str,
    roots: Option<&StorageRoots>,
) -> Result<DocumentsGuard, String> {
    super::manifest::require_valid_id(id)?;
    let system_roots;
    let roots = match roots {
        Some(roots) => roots,
        None => {
            system_roots = StorageRoots::system()?;
            &system_roots
        }
    };
    let (_, base) = selected_base(state_path, roots, id)?;
    let lock = lock_document_root(&base, id)?;
    Ok(DocumentsGuard { root: plugin_root(&base, id), _lock: lock })
}

pub(crate) fn assert_documents_deletable(guard: &DocumentsGuard) -> Result<(), String> {
    scan_for_reparse_points(&guard.root)
}

pub(crate) fn delete_plugin_documents(guard: &DocumentsGuard) -> Result<(), String> {
    assert_documents_deletable(guard)?;
    match fs::remove_dir_all(&guard.root) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("remove {}: {error}", guard.root.display())),
    }
}

/// Uninstall deletion refuses any tree that contains (or is) a reparse point:
/// on Windows `remove_dir_all` on a junction reaches outside the plugin root,
/// so this scan runs before anything is removed.
fn scan_for_reparse_points(root: &Path) -> Result<(), String> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if is_reparse_point(&dir)? {
            return Err(format!(
                "refusing to delete {}: it is a reparse point",
                dir.display()
            ));
        }
        if !dir.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&dir).map_err(|e| format!("list {}: {e}", dir.display()))? {
            stack.push(entry.map_err(|e| e.to_string())?.path());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::*;
    use crate::plugins::test_support::Scratch;

    fn enabled_state(path: &Path, id: &str) {
        let mut state = crate::plugins::state::PluginsState::default();
        let mut record = crate::plugins::state::PluginRecord::fresh("test", 1);
        record.permissions = vec!["plugin.storage".into()];
        state.plugins.insert(id.into(), record);
        crate::plugins::state::write_state(path, &state).unwrap();
    }

    fn roots(scratch: &Scratch) -> StorageRoots {
        StorageRoots {
            data: scratch.path("data"),
            program: scratch.path("program"),
        }
    }

    #[test]
    fn path_table_rejects_escape_and_accepts_safe_nested_paths() {
        assert_eq!(safe_relative_path("one/two.txt").unwrap(), PathBuf::from("one/two.txt"));
        for bad in ["", ".", "..", "../x", "x/../y", "/absolute", "x\\y", "x//y", "x/./y", "x/"] {
            assert!(safe_relative_path(bad).is_err(), "accepted {bad:?}");
        }
    }

    #[test]
    fn gates_require_installed_enabled_clean_and_permissioned_plugin() {
        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        let id = "vendor.plugin";
        enabled_state(&state_path, id);
        assert!(authorize(&state_path, id).is_ok());

        let mut state = crate::plugins::state::read_state(&state_path).unwrap();
        state.plugins.get_mut(id).unwrap().enabled = false;
        crate::plugins::state::write_state(&state_path, &state).unwrap();
        assert!(authorize(&state_path, id).unwrap_err().contains("disabled"));

        state.plugins.get_mut(id).unwrap().enabled = true;
        state.plugins.get_mut(id).unwrap().quarantined = true;
        crate::plugins::state::write_state(&state_path, &state).unwrap();
        assert!(authorize(&state_path, id).unwrap_err().contains("quarantined"));

        state.plugins.get_mut(id).unwrap().quarantined = false;
        state.plugins.get_mut(id).unwrap().permissions.clear();
        crate::plugins::state::write_state(&state_path, &state).unwrap();
        assert!(authorize(&state_path, id).unwrap_err().contains("plugin.storage"));
    }

    #[test]
    fn roots_are_lazy_and_location_table_is_plugin_isolated() {
        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        enabled_state(&state_path, "vendor.one");
        let roots = roots(&scratch);
        assert_eq!(get_location_at(&state_path, &roots, "vendor.one").unwrap().kind, StorageLocationKind::Data);
        assert!(!roots.data.exists());

        let selected = select_location_at(
            &state_path,
            &roots,
            "vendor.one",
            StorageLocationSelection { kind: StorageLocationKind::Custom, path: Some(scratch.path("chosen").to_string_lossy().into()) },
        ).unwrap();
        assert_eq!(PathBuf::from(selected.root), scratch.path("chosen").join("plugin-data").join("vendor.one"));
        assert!(scratch.path("chosen").is_dir());
        assert!(!scratch.path("chosen/plugin-data/vendor.one").exists());
    }

    #[test]
    fn selecting_custom_moves_the_existing_document_tree() {
        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        let id = "vendor.plugin";
        enabled_state(&state_path, id);
        let roots = roots(&scratch);
        write_text_at(&state_path, &roots, id, "state/nested/doc.json", "document", None)
            .unwrap();
        let old_root = plugin_root(&roots.data, id);
        let custom = scratch.path("custom");

        let selected = select_location_at(
            &state_path,
            &roots,
            id,
            StorageLocationSelection {
                kind: StorageLocationKind::Custom,
                path: Some(custom.to_string_lossy().into_owned()),
            },
        )
        .unwrap();

        let new_root = plugin_root(&custom, id);
        assert_eq!(PathBuf::from(selected.root), new_root);
        assert_eq!(std::fs::read_to_string(new_root.join("state/nested/doc.json")).unwrap(), "document");
        assert!(!old_root.exists(), "old canonical root remained visible");
    }

    #[test]
    fn non_identical_target_conflicts_without_mutating_either_root_or_selection() {
        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        let id = "vendor.plugin";
        enabled_state(&state_path, id);
        let roots = roots(&scratch);
        write_text_at(&state_path, &roots, id, "doc", "old", None).unwrap();
        let old_root = plugin_root(&roots.data, id);
        let custom = scratch.path("custom");
        let target_root = plugin_root(&custom, id);
        std::fs::create_dir_all(&target_root).unwrap();
        std::fs::write(target_root.join("doc"), "different").unwrap();

        let error = select_location_at(
            &state_path,
            &roots,
            id,
            StorageLocationSelection {
                kind: StorageLocationKind::Custom,
                path: Some(custom.to_string_lossy().into_owned()),
            },
        )
        .unwrap_err();

        assert!(error.contains("conflict"), "unexpected error: {error}");
        assert_eq!(get_location_at(&state_path, &roots, id).unwrap().kind, StorageLocationKind::Data);
        assert_eq!(std::fs::read_to_string(old_root.join("doc")).unwrap(), "old");
        assert_eq!(std::fs::read_to_string(target_root.join("doc")).unwrap(), "different");
    }

    #[test]
    fn identical_existing_target_is_accepted() {
        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        let id = "vendor.plugin";
        enabled_state(&state_path, id);
        let roots = roots(&scratch);
        write_text_at(&state_path, &roots, id, "nested/doc", "same", None).unwrap();
        let old_root = plugin_root(&roots.data, id);
        let custom = scratch.path("custom");
        let target_root = plugin_root(&custom, id);
        std::fs::create_dir_all(target_root.join("nested")).unwrap();
        std::fs::write(target_root.join("nested/doc"), "same").unwrap();

        select_location_at(
            &state_path,
            &roots,
            id,
            StorageLocationSelection {
                kind: StorageLocationKind::Custom,
                path: Some(custom.to_string_lossy().into_owned()),
            },
        )
        .unwrap();

        assert_eq!(get_location_at(&state_path, &roots, id).unwrap().kind, StorageLocationKind::Custom);
        assert_eq!(std::fs::read_to_string(target_root.join("nested/doc")).unwrap(), "same");
        assert!(!old_root.exists());
    }

    #[test]
    fn state_write_failure_restores_each_old_selection_and_canonical_root() {
        for old_kind in [
            StorageLocationKind::Data,
            StorageLocationKind::Program,
            StorageLocationKind::Custom,
        ] {
            let scratch = Scratch::new();
            let state_path = scratch.path("plugins.json");
            let id = "vendor.plugin";
            enabled_state(&state_path, id);
            let roots = roots(&scratch);
            let old_custom = scratch.path("old-custom");
            if old_kind != StorageLocationKind::Data {
                select_location_at(
                    &state_path,
                    &roots,
                    id,
                    StorageLocationSelection {
                        kind: old_kind,
                        path: (old_kind == StorageLocationKind::Custom)
                            .then(|| old_custom.to_string_lossy().into_owned()),
                    },
                )
                .unwrap();
            }
            write_text_at(&state_path, &roots, id, "doc", "preserve", None).unwrap();
            let old_base = match old_kind {
                StorageLocationKind::Data => roots.data.clone(),
                StorageLocationKind::Program => roots.program.clone(),
                StorageLocationKind::Custom => old_custom,
            };
            let old_root = plugin_root(&old_base, id);
            let new_base = scratch.path("new-custom");
            std::fs::create_dir_all(plugin_root(&new_base, id)).unwrap();

            let error = select_location_at_with_writer(
                &state_path,
                &roots,
                id,
                StorageLocationSelection {
                    kind: StorageLocationKind::Custom,
                    path: Some(new_base.to_string_lossy().into_owned()),
                },
                |_, _| Err("simulated state write failure".into()),
            )
            .unwrap_err();

            assert!(error.contains("simulated state write failure"));
            let selected = get_location_at(&state_path, &roots, id).unwrap();
            assert_eq!(selected.kind, old_kind);
            assert_eq!(PathBuf::from(selected.root), old_root);
            assert_eq!(std::fs::read_to_string(old_root.join("doc")).unwrap(), "preserve");
            let restored_target = plugin_root(&new_base, id);
            assert!(restored_target.is_dir());
            assert!(std::fs::read_dir(restored_target).unwrap().next().is_none());
        }
    }

    #[test]
    fn writes_and_removes_wait_for_location_migration() {
        use std::sync::mpsc;
        use std::time::Duration;

        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        let id = "vendor.plugin";
        enabled_state(&state_path, id);
        let roots = roots(&scratch);
        write_text_at(&state_path, &roots, id, "remove", "old", None).unwrap();
        let old_root = plugin_root(&roots.data, id);
        let custom = scratch.path("custom");
        let target_root = plugin_root(&custom, id);
        let (persist_entered_tx, persist_entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let migration_state = state_path.clone();
        let migration_roots = roots.clone();
        let migration_custom = custom.clone();
        let migration = std::thread::spawn(move || {
            select_location_at_with_writer(
                &migration_state,
                &migration_roots,
                id,
                StorageLocationSelection {
                    kind: StorageLocationKind::Custom,
                    path: Some(migration_custom.to_string_lossy().into_owned()),
                },
                |path, state| {
                    persist_entered_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    super::super::state::write_state(path, state)
                },
            )
        });
        persist_entered_rx.recv().unwrap();

        let (started_tx, started_rx) = mpsc::channel();
        let (finished_tx, finished_rx) = mpsc::channel();
        let write_state = state_path.clone();
        let write_roots = roots.clone();
        let write_finished = finished_tx.clone();
        let writer = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            let result = write_text_at(&write_state, &write_roots, id, "written", "new", None);
            write_finished.send(()).unwrap();
            result
        });
        started_rx.recv().unwrap();
        assert!(finished_rx.recv_timeout(Duration::from_millis(100)).is_err());

        let (remove_started_tx, remove_started_rx) = mpsc::channel();
        let remove_state = state_path.clone();
        let remove_roots = roots.clone();
        let remover = std::thread::spawn(move || {
            remove_started_tx.send(()).unwrap();
            let result = remove_with_version_at(&remove_state, &remove_roots, id, "remove", None);
            finished_tx.send(()).unwrap();
            result
        });
        remove_started_rx.recv().unwrap();
        assert!(finished_rx.recv_timeout(Duration::from_millis(100)).is_err());

        release_tx.send(()).unwrap();
        migration.join().unwrap().unwrap();
        writer.join().unwrap().unwrap();
        assert!(matches!(remover.join().unwrap().unwrap(), RemoveResult::Removed));
        assert!(!old_root.exists());
        assert_eq!(std::fs::read_to_string(target_root.join("written")).unwrap(), "new");
        assert!(!target_root.join("remove").exists());
    }

    #[test]
    fn location_migration_refuses_reparse_content() {
        use crate::plugins::test_support::create_dir_link;

        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        let id = "vendor.plugin";
        enabled_state(&state_path, id);
        let roots = roots(&scratch);
        let old_root = plugin_root(&roots.data, id);
        std::fs::create_dir_all(&old_root).unwrap();
        let outside = scratch.path("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("keep"), "keep").unwrap();
        assert!(create_dir_link(&old_root.join("link"), &outside));

        let error = select_location_at(
            &state_path,
            &roots,
            id,
            StorageLocationSelection {
                kind: StorageLocationKind::Custom,
                path: Some(scratch.path("custom").to_string_lossy().into_owned()),
            },
        )
        .unwrap_err();

        assert!(error.contains("reparse point"), "unexpected error: {error}");
        assert_eq!(get_location_at(&state_path, &roots, id).unwrap().kind, StorageLocationKind::Data);
        assert!(old_root.exists());
        assert_eq!(std::fs::read_to_string(outside.join("keep")).unwrap(), "keep");
    }

    #[test]
    fn atomic_write_is_cas_and_keeps_rolling_backup() {
        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        let id = "vendor.plugin";
        enabled_state(&state_path, id);
        let roots = roots(&scratch);

        let WriteResult::Written { version: first } = write_text_at(&state_path, &roots, id, "state/doc.json", "one", None).unwrap() else { panic!("initial write conflicted") };
        assert_eq!(read_text_at(&state_path, &roots, id, "state/doc.json").unwrap().unwrap().content, "one");
        let WriteResult::Written { version: second } = write_text_at(&state_path, &roots, id, "state/doc.json", "two", Some(first.clone())).unwrap() else { panic!("fresh write conflicted") };
        assert_ne!(first, second);
        let root = roots.data.join("plugin-data").join(id);
        assert_eq!(std::fs::read_to_string(root.join("state/doc.json.bak")).unwrap(), "one");

        let conflict = write_text_at(&state_path, &roots, id, "state/doc.json", "stale", Some(first)).unwrap();
        assert!(matches!(conflict, WriteResult::Conflict { current_version: Some(version) } if version == second));
        assert_eq!(std::fs::read_to_string(root.join("state/doc.json")).unwrap(), "two");
    }

    #[test]
    fn concurrent_writers_have_one_winner_and_one_conflict() {
        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        let id = "vendor.plugin";
        enabled_state(&state_path, id);
        let roots = roots(&scratch);
        let WriteResult::Written { version: initial } = write_text_at(&state_path, &roots, id, "doc", "zero", None).unwrap() else { panic!("initial write conflicted") };
        let a_state = state_path.clone();
        let b_state = state_path.clone();
        let a_roots = roots.clone();
        let b_roots = roots.clone();
        let version_a = initial.clone();
        let version_b = initial;
        let a = std::thread::spawn(move || write_text_at(&a_state, &a_roots, id, "doc", "a", Some(version_a)));
        let b = std::thread::spawn(move || write_text_at(&b_state, &b_roots, id, "doc", "b", Some(version_b)));
        let results = [a.join().unwrap(), b.join().unwrap()];
        assert_eq!(results.iter().filter(|r| matches!(r, Ok(WriteResult::Written { .. }))).count(), 1);
        assert_eq!(results.iter().filter(|r| matches!(r, Ok(WriteResult::Conflict { .. }))).count(), 1);
    }

    #[test]
    fn custom_location_and_file_listing_are_plugin_isolated() {
        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        enabled_state(&state_path, "vendor.one");
        let mut state = crate::plugins::state::read_state(&state_path).unwrap();
        let mut second = crate::plugins::state::PluginRecord::fresh("test", 1);
        second.permissions = vec!["plugin.storage".into()];
        state.plugins.insert("vendor.two".into(), second);
        crate::plugins::state::write_state(&state_path, &state).unwrap();
        let roots = roots(&scratch);
        let custom = scratch.path("custom");
        for id in ["vendor.one", "vendor.two"] {
            select_location_at(&state_path, &roots, id, StorageLocationSelection { kind: StorageLocationKind::Custom, path: Some(custom.to_string_lossy().into()) }).unwrap();
        }
        write_text_at(&state_path, &roots, "vendor.one", "shared/file", "one", None).unwrap();
        write_text_at(&state_path, &roots, "vendor.two", "shared/file", "two", None).unwrap();
        assert_eq!(read_text_at(&state_path, &roots, "vendor.one", "shared/file").unwrap().unwrap().content, "one");
        assert_eq!(list_at(&state_path, &roots, "vendor.one", Some("shared")).unwrap(), vec!["shared/file"]);
        remove_with_version_at(&state_path, &roots, "vendor.one", "shared/file", None).unwrap();
        assert!(read_text_at(&state_path, &roots, "vendor.one", "shared/file").unwrap().is_none());
        assert_eq!(read_text_at(&state_path, &roots, "vendor.two", "shared/file").unwrap().unwrap().content, "two");
    }

    #[test]
    fn invalid_or_unwritable_selection_never_falls_back() {
        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        enabled_state(&state_path, "vendor.plugin");
        let roots = roots(&scratch);
        let file = scratch.path("not-a-directory");
        std::fs::write(&file, "x").unwrap();
        let result = select_location_at(&state_path, &roots, "vendor.plugin", StorageLocationSelection { kind: StorageLocationKind::Custom, path: Some(file.to_string_lossy().into()) });
        assert!(result.is_err());
        assert_eq!(get_location_at(&state_path, &roots, "vendor.plugin").unwrap().kind, StorageLocationKind::Data);
        assert!(!roots.data.exists());
    }

    #[test]
    fn remove_honors_optional_cas() {
        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        let id = "vendor.plugin";
        enabled_state(&state_path, id);
        let roots = roots(&scratch);
        let WriteResult::Written { version } = write_text_at(&state_path, &roots, id, "doc", "one", None).unwrap() else { panic!("initial write conflicted") };
        let conflict = remove_with_version_at(&state_path, &roots, id, "doc", Some("stale")).unwrap();
        assert!(matches!(conflict, RemoveResult::Conflict { current_version: Some(_) }));
        assert!(read_text_at(&state_path, &roots, id, "doc").unwrap().is_some());
        let removed = remove_with_version_at(&state_path, &roots, id, "doc", Some(&version)).unwrap();
        assert!(matches!(removed, RemoveResult::Removed));
        assert!(read_text_at(&state_path, &roots, id, "doc").unwrap().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected() {
        use std::os::unix::fs::symlink;
        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        let id = "vendor.plugin";
        enabled_state(&state_path, id);
        let roots = roots(&scratch);
        let root = roots.data.join("plugin-data").join(id);
        std::fs::create_dir_all(&root).unwrap();
        let outside = scratch.path("outside");
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("link")).unwrap();
        assert!(write_text_at(&state_path, &roots, id, "link/escape", "bad", None).is_err());
        assert!(!outside.join("escape").exists());
    }

    /// H8b: removing a document must take its rolling `.bak` with it, and a
    /// rejected CAS must leave both files untouched.
    #[test]
    fn remove_also_deletes_the_rolling_backup() {
        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        let id = "vendor.plugin";
        enabled_state(&state_path, id);
        let roots = roots(&scratch);
        let root = roots.data.join("plugin-data").join(id);
        let WriteResult::Written { version: first } = write_text_at(&state_path, &roots, id, "state/doc.json", "one", None).unwrap() else { panic!("initial write conflicted") };
        let WriteResult::Written { version: second } = write_text_at(
            &state_path, &roots, id, "state/doc.json", "two", Some(first),
        ).unwrap() else { panic!("fresh write conflicted") };
        assert!(root.join("state/doc.json.bak").exists());

        let conflict =
            remove_with_version_at(&state_path, &roots, id, "state/doc.json", Some("stale")).unwrap();
        assert!(matches!(conflict, RemoveResult::Conflict { .. }));
        assert!(root.join("state/doc.json").exists());
        assert!(root.join("state/doc.json.bak").exists());

        let removed =
            remove_with_version_at(&state_path, &roots, id, "state/doc.json", Some(&second))
                .unwrap();
        assert!(matches!(removed, RemoveResult::Removed));
        assert!(!root.join("state/doc.json").exists());
        assert!(!root.join("state/doc.json.bak").exists(), "backup survived removal");
        assert!(list_at(&state_path, &roots, id, None).unwrap().is_empty());

        // Removing an already-gone document is a no-op, not a resurrection.
        let again = remove_with_version_at(&state_path, &roots, id, "state/doc.json", None).unwrap();
        assert!(matches!(again, RemoveResult::Removed));
        assert!(read_text_at(&state_path, &roots, id, "state/doc.json").unwrap().is_none());
    }

    /// H11: a reparse point inside the root is refused by every operation,
    /// and nothing outside the root is ever touched.
    #[test]
    fn reparse_point_inside_the_root_is_refused_everywhere() {
        use crate::plugins::test_support::create_dir_link;
        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        let id = "vendor.plugin";
        enabled_state(&state_path, id);
        let roots = roots(&scratch);
        let root = roots.data.join("plugin-data").join(id);
        std::fs::create_dir_all(&root).unwrap();
        let outside = scratch.path("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("escape"), "secret").unwrap();
        assert!(create_dir_link(&root.join("link"), &outside), "could not create a directory link");

        let error = write_text_at(&state_path, &roots, id, "link/escape", "bad", None).unwrap_err();
        assert!(error.contains("reparse point"), "unexpected: {error}");
        assert_eq!(std::fs::read_to_string(outside.join("escape")).unwrap(), "secret");
        assert!(!outside.join("escape.bak").exists());

        assert!(read_text_at(&state_path, &roots, id, "link/escape").is_err());
        assert!(list_at(&state_path, &roots, id, None).is_err());
        assert!(remove_with_version_at(&state_path, &roots, id, "link/escape", None).is_err());
        assert!(remove_with_version_at(&state_path, &roots, id, "link", None).is_err());
        assert_eq!(std::fs::read_to_string(outside.join("escape")).unwrap(), "secret");
    }

    /// H11: uninstall deletion must scan for reparse points and refuse before
    /// removing anything.
    #[test]
    fn uninstall_deletion_refuses_to_cross_a_reparse_point() {
        use crate::plugins::test_support::create_dir_link;
        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        let id = "vendor.plugin";
        enabled_state(&state_path, id);
        let roots = roots(&scratch);
        let root = roots.data.join("plugin-data").join(id);
        write_text_at(&state_path, &roots, id, "state/doc.json", "one", None).unwrap();
        let outside = scratch.path("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("keep"), "keep").unwrap();
        assert!(create_dir_link(&root.join("escape"), &outside), "could not create a directory link");

        let guard = lock_documents_at(&state_path, id, Some(&roots)).unwrap();
        let error = delete_plugin_documents(&guard).unwrap_err();
        assert!(error.contains("reparse point"), "unexpected: {error}");
        assert!(root.join("state/doc.json").exists(), "documents were removed anyway");
        assert!(outside.join("keep").exists());
    }
}

#[cfg(test)]
#[path = "storage_process_tests.rs"]
mod process_tests;
