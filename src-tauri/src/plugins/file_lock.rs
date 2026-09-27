//! Kernel-owned advisory locks on persistent sidecar files.
//!
//! Never unlink a sidecar: replacing its inode would let a new caller lock a
//! different file while another process still owns the previous lock.

use std::fs::{self, File, OpenOptions};
use std::path::Path;

pub(super) struct FileLock {
    _file: File,
}

pub(super) fn exclusive(path: &Path) -> Result<FileLock, String> {
    let parent = path.parent().ok_or_else(|| format!("lock has no parent: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Open the reparse point itself so it can be rejected, not followed.
        // Readers/writers may share the sidecar; deletion must never race it.
        options.custom_flags(0x0020_0000).share_mode(0x0000_0003);
    }
    let file = options.open(path).map_err(|e| format!("open lock {}: {e}", path.display()))?;
    let metadata = file.metadata().map_err(|e| format!("stat lock {}: {e}", path.display()))?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(format!("lock is a reparse point: {}", path.display()));
        }
    }
    if !metadata.is_file() {
        return Err(format!("lock is not a regular file: {}", path.display()));
    }
    fs2::FileExt::lock_exclusive(&file).map_err(|e| format!("lock {}: {e}", path.display()))?;
    // Closing the handle releases the lock, including on panic/process exit.
    Ok(FileLock { _file: file })
}
