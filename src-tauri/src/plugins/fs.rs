//! Plugin-directory filesystem work: one source-tree walk feeding size
//! validation, progress, and the copy; the staging/backup install
//! transaction; and the manifest+record merge into PluginInfo.

use std::path::{Path, PathBuf};

use super::manifest::{manifest_path, validate_manifest, PluginManifest};
use super::state::{mutate_record, read_state, write_state, PluginInfo, PluginRecord, STATE_LOCK};

/// Hard per-file size cap, enforced both at install validation and on reads.
// Local installs get a generous 16MB sanity cap: it exists to catch picking
// the wrong directory (a folder of videos must not hang the loader), not to
// police bundle size — real dashboards (react + motion + charts, single-file
// ESM) legitimately run multi-MB. Marketplace CI enforces the stricter
// 512KB-warning / 2MB hygiene rule for community submissions (plan §6.1).
pub(crate) const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

/// Directories that are never plugin bundle content: a bundle is plain files
/// (manifest.json / main.js / styles.css + assets), and recursing into a dev
/// checkout's dependencies or VCS data would dominate install time and trip
/// the per-file size cap on files the runtime never loads.
fn skip_dir(name: &std::ffi::OsStr) -> bool {
    name == "node_modules" || name == ".git"
}

fn walk_files(root: &Path, dir: &Path, out: &mut Vec<(PathBuf, u64)>) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| format!("read {}: {e}", dir.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            if !skip_dir(&entry.file_name()) {
                walk_files(root, &path, out)?;
            }
        } else if file_type.is_file() {
            let size = entry.metadata().map_err(|e| e.to_string())?.len();
            out.push((path.strip_prefix(root).unwrap_or(&path).to_path_buf(), size));
        }
        // Symlinks and other special files are dropped: a plugin bundle is
        // plain files, and following links would escape confinement.
    }
    Ok(())
}

/// One recursive listing of a plugin source tree: (path relative to `root`,
/// byte size) for every regular file, respecting skip_dir. Install walks
/// exactly once — manifest size validation, the progress denominator, and
/// the copy all consume this list.
pub(crate) fn collect_files(root: &Path) -> Result<Vec<(PathBuf, u64)>, String> {
    let mut files = Vec::new();
    walk_files(root, root, &mut files)?;
    Ok(files)
}

/// Copy the files collect_files listed into `to`, invoking `on_file` with
/// each file's size as it lands (the install progress callback).
pub(crate) fn copy_files(
    from: &Path,
    files: &[(PathBuf, u64)],
    to: &Path,
    on_file: &mut dyn FnMut(u64),
) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| format!("mkdir {}: {e}", to.display()))?;
    for (rel, size) in files {
        let target = to.join(rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
        std::fs::copy(from.join(rel), &target)
            .map_err(|e| format!("copy {}: {e}", target.display()))?;
        on_file(*size);
    }
    Ok(())
}

pub(crate) fn remove_dir_if_exists(path: &Path) -> Result<(), String> {
    if path.exists() {
        std::fs::remove_dir_all(path).map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    Ok(())
}

/// Crash-window self-heal + litter sweep at the top of install_from. A crash
/// between the swap's two renames leaves the previous install parked at
/// `.backup-<id>` with no target: rename it back. Whatever else remains — an
/// abandoned staging copy, or a backup whose swap actually finished — is
/// stale and removed unconditionally (not only when a previous install
/// exists).
fn heal_crash_window(staging: &Path, backup: &Path, target: &Path) -> Result<(), String> {
    if !target.exists() && backup.exists() {
        std::fs::rename(backup, target)
            .map_err(|e| format!("rename {}: {e}", backup.display()))?;
    }
    remove_dir_if_exists(staging)?;
    remove_dir_if_exists(backup)
}

/// Merge a state record with the on-disk manifest (when the directory
/// exists) into the frontend-facing view.
pub(crate) fn info_for(plugins_dir: &Path, id: &str, record: &PluginRecord) -> PluginInfo {
    let manifest = manifest_path(&plugins_dir.join(id))
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str::<PluginManifest>(&content).ok());
    let mut info = PluginInfo {
        id: id.to_string(),
        name: id.to_string(),
        version: record.version.clone(),
        description: String::new(),
        author: String::new(),
        tier: String::new(),
        source: record.source.clone(),
        enabled: record.enabled,
        quarantined: record.quarantined,
        last_error: record.last_error.clone(),
        permissions: record.permissions.clone(),
        installed_at: record.installed_at,
        min_app_version: None,
    };
    if let Some(manifest) = manifest {
        info.name = manifest.name;
        if !manifest.version.is_empty() {
            info.version = manifest.version;
        }
        info.description = manifest.description;
        info.author = manifest.author;
        info.tier = manifest.tier;
        info.min_app_version = manifest.min_app_version;
    }
    info
}

/// Install transaction (plan §4.4): copy into `.staging-<id>/` next to the
/// target, validate there, then swap with rename and roll the backup back in
/// on failure. Renames within one directory are atomic, so a crash leaves at
/// worst a stale `.staging-`/`.backup-` dir, never a half-copied plugin —
/// and the next install of the same id self-heals: if the target is missing
/// while its `.backup-<id>` survives, the crash hit between the two swap
/// renames, so the backup is renamed back before proceeding (see
/// heal_crash_window).
///
/// `source_kind` is the record's origin tag ("local" directory pick,
/// "marketplace" download, …) — the bits flow through the same transaction
/// regardless of where they came from.
pub(crate) fn install_from(
    plugins_dir: &Path,
    state_path: &Path,
    source: &Path,
    source_kind: &str,
    on_progress: impl Fn(crate::event_sink::InstallProgress),
) -> Result<PluginInfo, String> {
    if !source.is_dir() {
        return Err(format!("{}: not a directory", source.display()));
    }
    // One walk of the source tree: manifest size validation, the progress
    // denominator, and the copy all work from this list.
    let files = collect_files(source)?;
    // Validate the source first: the manifest id names the staging dir, and a
    // bad bundle must never touch the plugins directory.
    let manifest = validate_manifest(source, &files)?;
    let id = manifest.id.clone();

    std::fs::create_dir_all(plugins_dir)
        .map_err(|e| format!("mkdir {}: {e}", plugins_dir.display()))?;
    let staging = plugins_dir.join(format!(".staging-{id}"));
    let backup = plugins_dir.join(format!(".backup-{id}"));
    let target = plugins_dir.join(&id);
    heal_crash_window(&staging, &backup, &target)?;

    // Step 1: fresh staging copy. Same-fs temp means the later rename is atomic.
    // Self-throttled byte progress (~50 events per run, mirroring the history
    // scanner) so the manager UI can show how a large bundle is moving.
    let total: u64 = files.iter().map(|(_, size)| size).sum();
    let step = (total / 50).max(1);
    if total > 0 {
        on_progress(crate::event_sink::InstallProgress {
            done: 0,
            total,
            finished: false,
        });
    }
    let mut copied = 0u64;
    let mut next_emit = step;
    if let Err(error) = copy_files(source, &files, &staging, &mut |bytes: u64| {
        copied += bytes;
        if copied >= next_emit {
            next_emit = copied + step;
            on_progress(crate::event_sink::InstallProgress {
                done: copied,
                total,
                finished: false,
            });
        }
    }) {
        let _ = remove_dir_if_exists(&staging);
        return Err(error);
    }
    if total > 0 {
        on_progress(crate::event_sink::InstallProgress {
            done: copied,
            total,
            finished: true,
        });
    }

    // Step 2: swap. Existing install moves aside first so any failure before
    // the final rename can put it back untouched.
    let had_previous = target.exists();
    if had_previous {
        if let Err(error) = std::fs::rename(&target, &backup)
            .map_err(|e| format!("rename {}: {e}", target.display()))
        {
            let _ = remove_dir_if_exists(&staging);
            return Err(error);
        }
    }
    if let Err(e) = std::fs::rename(&staging, &target) {
        if had_previous {
            let _ = std::fs::rename(&backup, &target);
        }
        let _ = remove_dir_if_exists(&staging);
        return Err(format!("rename {}: {e}", staging.display()));
    }
    if had_previous {
        remove_dir_if_exists(&backup)?;
    }

    // Step 3: record. A reinstall keeps the original enabled flag and install
    // time; quarantine state and the stored error always reset on fresh bits.
    // STATE_LOCK covers this read→mutate→write only — the copy phase above
    // runs lock-free.
    let record = {
        let _guard = STATE_LOCK.lock();
        let mut state = read_state(state_path)?;
        let record = mutate_record(&mut state, &id, source_kind, |record| {
            record.version = manifest.version.clone();
            record.source = source_kind.to_string();
            record.permissions = manifest.permissions.clone();
            record.quarantined = false;
            record.last_error = None;
        });
        // Installing again revives the data: a pending tombstone must not
        // outlive the reinstall and purge the still-in-use KV rows.
        state.kv_tombstones.remove(&id);
        write_state(state_path, &state)?;
        record
    };

    Ok(info_for(plugins_dir, &id, &record))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::state::{read_state, update_record};
    use crate::plugins::test_support::{valid_manifest, write_plugin, Scratch};

    #[test]
    fn crash_window_self_heal_restores_backup_and_clears_litter() {
        let scratch = Scratch::new();
        let plugins_dir = scratch.path("plugins");
        let target = plugins_dir.join("my-plugin");
        let staging = plugins_dir.join(".staging-my-plugin");
        let backup = plugins_dir.join(".backup-my-plugin");

        // Crash between the swap renames: target gone, previous install
        // parked at the backup — it is renamed back.
        write_plugin(&backup, &valid_manifest("my-plugin"));
        heal_crash_window(&staging, &backup, &target).unwrap();
        assert!(target.join("manifest.json").is_file());
        assert!(!backup.exists());

        // Crash after the swap finished: both exist — the target wins and
        // the stale backup/staging litter is removed.
        write_plugin(
            &backup,
            r#"{"id":"my-plugin","name":"Old","version":"0.9.0","tier":"declarative"}"#,
        );
        std::fs::create_dir_all(&staging).unwrap();
        heal_crash_window(&staging, &backup, &target).unwrap();
        let manifest = std::fs::read_to_string(target.join("manifest.json")).unwrap();
        assert!(manifest.contains("\"version\":\"1.2.3\""), "{manifest}");
        assert!(!backup.exists());
        assert!(!staging.exists());
    }

    #[test]
    fn install_happy_path_swaps_in_new_version() {
        let scratch = Scratch::new();
        let plugins_dir = scratch.path("plugins");
        let state_path = scratch.path("plugins.json");

        let source = scratch.path("src-v1");
        write_plugin(&source, &valid_manifest("cool-plugin"));
        std::fs::write(source.join("main.js"), "v1").unwrap();

        let info = install_from(&plugins_dir, &state_path, &source, "local", |_| {}).unwrap();
        assert_eq!(info.id, "cool-plugin");
        assert_eq!(info.name, "Test");
        assert_eq!(info.version, "1.2.3");
        assert_eq!(info.source, "local");
        assert!(info.enabled);
        assert_eq!(info.permissions, vec!["storage", "ui:panel-tab"]);
        assert_eq!(
            std::fs::read_to_string(plugins_dir.join("cool-plugin/manifest.json")).unwrap(),
            std::fs::read_to_string(source.join("manifest.json")).unwrap()
        );
        // No transaction litter.
        assert!(!plugins_dir.join(".staging-cool-plugin").exists());
        assert!(!plugins_dir.join(".backup-cool-plugin").exists());

        // Disable, then reinstall v2 over it: enabled flag survives, the
        // version and bits are replaced.
        update_record(&state_path, "cool-plugin", |r| r.enabled = false).unwrap();
        let source_v2 = scratch.path("src-v2");
        write_plugin(
            &source_v2,
            r#"{"id":"cool-plugin","name":"Test","version":"2.0.0","tier":"declarative"}"#,
        );
        let info = install_from(&plugins_dir, &state_path, &source_v2, "local", |_| {}).unwrap();
        assert_eq!(info.version, "2.0.0");
        assert!(!info.enabled);
        assert!(!plugins_dir.join(".backup-cool-plugin").exists());
        assert_eq!(
            std::fs::read_to_string(plugins_dir.join("cool-plugin/manifest.json")).unwrap(),
            std::fs::read_to_string(source_v2.join("manifest.json")).unwrap()
        );
    }

    #[test]
    fn install_with_bad_manifest_leaves_no_trace() {
        let scratch = Scratch::new();
        let plugins_dir = scratch.path("plugins");
        let state_path = scratch.path("plugins.json");

        let source = scratch.path("bad-src");
        write_plugin(
            &source,
            r#"{"id":"bad plugin!","name":"T","version":"1.0.0","tier":"declarative"}"#,
        );
        let error = install_from(&plugins_dir, &state_path, &source, "local", |_| {}).unwrap_err();
        assert!(error.contains("invalid plugin id"));
        // Rollback: no target, no staging, no state record.
        assert!(!plugins_dir.exists() || std::fs::read_dir(&plugins_dir).unwrap().next().is_none());
        assert!(read_state(&state_path).unwrap().plugins.is_empty());
    }
}
