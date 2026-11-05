//! Leases distinguish an abandoned one-shot profile from another live app.
//! The sweep lock is persistent: unlinking it would split its lock identity.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

use fs2::FileExt;
use parking_lot::Mutex;

const LEASE_FILE: &str = ".lease-v1";
const LEASE_MARKER: &[u8] = b"ccgui-relay-auth-lease-v1\n";
const LOCK_WAIT: Duration = Duration::from_secs(5);
static PROCESS_GATE: Mutex<()> = Mutex::new(());

pub(super) struct AuthDirectory {
    pub(super) path: PathBuf,
    lease: Option<File>,
    cleaned: bool,
}

#[derive(Default)]
pub(super) struct SweepReport {
    removed: usize,
    active: usize,
    warnings: Vec<String>,
}

impl SweepReport {
    pub(super) fn report(&self) {
        if self.removed != 0 {
            eprintln!("[relay login] Removed {} abandoned local auth directories; remote OAuth revocation was not attempted", self.removed);
        }
        for warning in &self.warnings { eprintln!("[relay login] {warning}"); }
    }
}

impl AuthDirectory {
    pub(super) fn create(root: &Path) -> Result<Self, String> {
        let _process = PROCESS_GATE.try_lock_for(LOCK_WAIT).ok_or("Timed out serializing auth storage")?;
        let _gate = lock_root(root)?;
        sweep_locked(root)?.report();
        let path = root.join(format!(".auth-{}", uuid::Uuid::new_v4()));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&path).map_err(|error| format!("Create private auth directory: {error}"))?;
        let result = (|| {
            // No marker, configuration, or child process exists until the ACL
            // succeeds. An ACL failure can leave only an empty directory.
            secure_directory(&path)?;
            let mut lease = open_regular(&path.join(LEASE_FILE), true)?;
            FileExt::try_lock_exclusive(&lease).map_err(|error| format!("Lock new auth lease: {error}"))?;
            lease.write_all(LEASE_MARKER).and_then(|()| lease.sync_all())
                .map_err(|error| format!("Write auth lease marker: {error}"))?;
            Ok(Self { path: path.clone(), lease: Some(lease), cleaned: false })
        })();
        if result.is_err() {
            // Nothing secret has been written. Do not recursively follow an
            // unexpected entry even on this initialization failure path.
            if let Err(error) = validate_tree(&path).and_then(|()| remove_tree(&path, false)) {
                eprintln!("[relay login] Failed to remove uninitialized {}: {error}", path.display());
            }
        }
        result
    }
    #[cfg(unix)]
    pub(super) fn inherit_lease(&self, command: &mut std::process::Command) -> Result<(), String> {
        use std::os::fd::AsRawFd;
        use std::os::unix::process::CommandExt;

        // try_clone atomically duplicates with CLOEXEC and shares the locked
        // open-file-description (not a second flock on the same path). Keep
        // the duplicate owned by this command until fork/spawn completes.
        let lease = self.lease.as_ref().ok_or("Auth writer has no owned lease")?
            .try_clone().map_err(|error| format!("Duplicate auth writer lease: {error}"))?;
        unsafe {
            command.pre_exec(move || {
                // Only this post-fork child's descriptor becomes inheritable.
                // Never toggle CLOEXEC in the multithreaded parent or unlock:
                // SIGKILL of the app must not release a live writer's lease.
                let fd = lease.as_raw_fd();
                let flags = libc::fcntl(fd, libc::F_GETFD);
                if flags == -1 || libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        Ok(())
    }


    pub(super) fn remove(mut self) -> Result<(), String> {
        let result = self.remove_inner();
        // Report once to the caller; on failure its marked directory remains
        // recoverable by the next sweep after this handle closes.
        self.cleaned = true;
        result.map_err(|error| format!("{}: {error}", self.path.display()))
    }

    fn remove_inner(&mut self) -> Result<(), String> {
        let root = self.path.parent().ok_or("Auth directory has no parent")?;
        let _process = PROCESS_GATE.try_lock_for(LOCK_WAIT).ok_or("Timed out serializing auth cleanup")?;
        let _gate = lock_root(root)?;
        validate_tree(&self.path)?;
        let lease = self.lease.as_mut().ok_or("Auth cleanup has no owned lease")?;
        validate_marker(lease)?;
        // Keep the lease while removing all other entries. In particular an
        // access-denied error leaves a valid marker for crash recovery.
        remove_tree(&self.path, true)?;
        drop(self.lease.take());
        fs::remove_file(self.path.join(LEASE_FILE)).map_err(|error| format!("Remove auth lease marker: {error}"))?;
        fs::remove_dir(&self.path).map_err(|error| format!("Remove auth directory {}: {error}", self.path.display()))
    }
}

impl Drop for AuthDirectory {
    fn drop(&mut self) {
        if !self.cleaned {
            if let Err(error) = self.remove_inner() {
                eprintln!("[relay login] Local credentials may remain at {}: {error}", self.path.display());
            }
        }
    }
}

pub(super) fn sweep(root: &Path) -> Result<SweepReport, String> {
    let _process = PROCESS_GATE.try_lock_for(LOCK_WAIT).ok_or("Timed out serializing auth sweep")?;
    let _gate = lock_root(root)?;
    sweep_locked(root)
}

fn sweep_locked(root: &Path) -> Result<SweepReport, String> {
    let mut report = SweepReport::default();
    for entry in fs::read_dir(root).map_err(|error| format!("Read auth storage: {error}"))? {
        let entry = entry.map_err(|error| format!("Read auth storage entry: {error}"))?;
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|name| name.strip_prefix(".auth-")) else { continue; };
        if uuid::Uuid::parse_str(id).is_err() { continue; }
        let path = entry.path();
        let result = (|| {
            check_directory(&path)?;
            let marker = path.join(LEASE_FILE);
            if fs::symlink_metadata(&marker).is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound) {
                return Err("unmarked legacy auth directory retained: an older live owner cannot be ruled out".to_string());
            }
            let mut lease = open_regular(&marker, false)?;
            match FileExt::try_lock_exclusive(&lease) {
                Err(error) if contended(&error) => { report.active += 1; return Ok(()); }
                Err(error) => return Err(format!("Lock auth lease: {error}")),
                Ok(()) => {}
            }
            validate_marker(&mut lease)?;
            validate_tree(&path)?;
            remove_tree(&path, true)?;
            // The global gate makes closing/removing the marker atomic with
            // respect to new creators and sweepers, including other processes.
            drop(lease);
            fs::remove_file(&marker).map_err(|error| format!("Remove stale auth marker: {error}"))?;
            fs::remove_dir(&path).map_err(|error| format!("Remove stale auth directory: {error}"))?;
            report.removed += 1;
            Ok(())
        })();
        if let Err(error) = result {
            report.warnings.push(format!("Retained {}: {error}", path.display()));
        }
    }
    Ok(report)
}

fn contended(error: &std::io::Error) -> bool {
    error.raw_os_error() == fs2::lock_contended_error().raw_os_error()
}

fn check_ancestors(root: &Path) -> Result<(), String> {
    // Reject traversal rather than canonicalizing a substituted tools root.
    let mut current = PathBuf::new();
    if !root.is_absolute() { return Err("Auth storage root must be absolute".into()); }
    for component in root.components() {
        if matches!(component, Component::ParentDir | Component::CurDir) {
            return Err("Auth storage root contains traversal".into());
        }
        current.push(component);
        if matches!(component, Component::Normal(_)) { check_directory(&current)?; }
    }
    Ok(())
}

fn lock_root(root: &Path) -> Result<File, String> {
    check_ancestors(root)?;
    let gate = open_regular(&root.join(".auth-sweep.lock"), true)?;
    let deadline = Instant::now() + LOCK_WAIT;
    loop {
        match FileExt::try_lock_exclusive(&gate) {
            Ok(()) => return Ok(gate),
            Err(error) if contended(&error) && Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(error) => return Err(format!("Lock auth storage: {error}")),
        }
    }
}

fn open_regular(path: &Path, create: bool) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(create).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000).share_mode(0x0000_0003);
    }
    let file = options.open(path).map_err(|error| format!("Open auth lock {}: {error}", path.display()))?;
    let metadata = file.metadata().map_err(|error| format!("Inspect auth lock: {error}"))?;
    if unsafe_entry(&metadata) || !metadata.is_file() { return Err("Auth lock is not a regular non-link file".into()); }
    Ok(file)
}

fn validate_marker(lease: &mut File) -> Result<(), String> {
    lease.rewind().map_err(|error| format!("Read auth lease marker: {error}"))?;
    let mut marker = [0u8; LEASE_MARKER.len() + 1];
    let mut reader = lease.take(marker.len() as u64);
    let mut length = 0;
    while length < marker.len() {
        let count = reader.read(&mut marker[length..]).map_err(|error| format!("Read auth lease marker: {error}"))?;
        if count == 0 { break; }
        length += count;
    }
    if &marker[..length] != LEASE_MARKER { return Err("Unknown auth lease marker; retained without deletion".into()); }
    Ok(())
}

fn unsafe_entry(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 { return true; }
    }
    metadata.file_type().is_symlink()
}

pub(super) fn check_directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| format!("Inspect auth directory {}: {error}", path.display()))?;
    if unsafe_entry(&metadata) || !metadata.is_dir() { return Err(format!("Unsafe link/reparse or non-directory: {}", path.display())); }
    Ok(())
}

pub(super) fn validate_credentials(path: &Path) -> Result<(), String> {
    check_ancestors(path)?;
    validate_tree(path)
}

fn validate_tree(path: &Path) -> Result<(), String> {
    check_directory(path)?;
    for entry in fs::read_dir(path).map_err(|error| format!("Inspect auth contents: {error}"))? {
        let path = entry.map_err(|error| format!("Inspect auth entry: {error}"))?.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| format!("Inspect auth entry: {error}"))?;
        if unsafe_entry(&metadata) { return Err(format!("Unsafe link/reparse entry: {}", path.display())); }
        if metadata.is_dir() { validate_tree(&path)?; }
        else if !metadata.is_file() { return Err("Non-regular auth entry retained".into()); }
    }
    Ok(())
}

fn remove_tree(path: &Path, keep_marker: bool) -> Result<(), String> {
    check_directory(path)?;
    for entry in fs::read_dir(path).map_err(|error| format!("Read auth cleanup entries: {error}"))? {
        let entry = entry.map_err(|error| format!("Read auth cleanup entry: {error}"))?;
        if keep_marker && entry.file_name() == LEASE_FILE { continue; }
        let entry_path = entry.path();
        let metadata = fs::symlink_metadata(&entry_path).map_err(|error| format!("Inspect auth cleanup entry: {error}"))?;
        if unsafe_entry(&metadata) { return Err("Unsafe link/reparse entry during auth cleanup".into()); }
        if metadata.is_dir() { remove_tree(&entry_path, false)?; }
        else { fs::remove_file(&entry_path).map_err(|error| format!("Remove auth file: {error}"))?; }
    }
    if !keep_marker { fs::remove_dir(path).map_err(|error| format!("Remove auth directory: {error}"))?; }
    Ok(())
}

#[cfg(windows)]
fn secure_directory(path: &Path) -> Result<(), String> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Security::{
        AddAccessAllowedAceEx, GetTokenInformation, InitializeAcl, ACL, ACL_REVISION,
        CONTAINER_INHERIT_ACE, OBJECT_INHERIT_ACE, DACL_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION, TOKEN_QUERY, TOKEN_USER, TokenUser,
    };
    use windows::Win32::Security::Authorization::{SetSecurityInfo, SE_FILE_OBJECT};
    use windows::Win32::Storage::FileSystem::FILE_ALL_ACCESS;
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let directory = OpenOptions::new().access_mode(0x0004_0000 | 0x0002_0000 | 0x80)
        .custom_flags(0x0200_0000 | 0x0020_0000).share_mode(0x0000_0003).open(path)
        .map_err(|error| format!("Open private auth directory for DACL: {error}"))?;
    if unsafe_entry(&directory.metadata().map_err(|error| error.to_string())?) {
        return Err("Cannot secure an auth reparse point".into());
    }
    let mut token = HANDLE::default();
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }
        .map_err(|error| format!("Open auth user token: {error}"))?;
    let token = unsafe { OwnedHandle::from_raw_handle(token.0) };
    let mut user = [0usize; 128 / std::mem::size_of::<usize>()];
    let mut needed = 0;
    unsafe { GetTokenInformation(HANDLE(token.as_raw_handle()), TokenUser, Some(user.as_mut_ptr().cast()),
        std::mem::size_of_val(&user) as u32, &mut needed) }
        .map_err(|error| format!("Read auth user SID: {error}"))?;
    let sid = unsafe { (*user.as_ptr().cast::<TOKEN_USER>()).User.Sid };
    let mut storage = [0u32; 32];
    let acl = storage.as_mut_ptr().cast::<ACL>();
    unsafe {
        InitializeAcl(acl, std::mem::size_of_val(&storage) as u32, ACL_REVISION)
            .and_then(|()| AddAccessAllowedAceEx(acl, ACL_REVISION,
                OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE, FILE_ALL_ACCESS.0, sid))
    }.map_err(|error| format!("Create private auth DACL: {error}"))?;
    unsafe { SetSecurityInfo(HANDLE(directory.as_raw_handle()), SE_FILE_OBJECT,
        DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, None, None, Some(acl), None) }.ok()
        .map_err(|error| format!("Restrict private auth DACL: {error}"))
}

#[cfg(unix)]
fn secure_directory(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("Restrict private auth mode: {error}"))
}

#[cfg(not(any(unix, windows)))]
fn secure_directory(_path: &Path) -> Result<(), String> {
    Err("Private auth directories are unsupported on this platform".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("ccgui-auth-lease-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            Self(dunce::canonicalize(root).unwrap())
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn active_lease_is_retained_and_abandoned_lease_is_removed() {
        let scratch = Scratch::new();
        let active = AuthDirectory::create(&scratch.0).unwrap();
        let mut abandoned = AuthDirectory::create(&scratch.0).unwrap();
        let abandoned_path = abandoned.path.clone();
        std::fs::create_dir_all(abandoned_path.join("home/.wrangler/config")).unwrap();
        std::fs::write(abandoned_path.join("home/.wrangler/config/default.toml"), "fake credential").unwrap();
        // Simulate process death: the OS closes its lease without running Drop.
        drop(abandoned.lease.take());
        abandoned.cleaned = true;
        drop(abandoned);

        let report = sweep(&scratch.0).unwrap();
        assert_eq!(report.removed, 1);
        assert_eq!(report.active, 1);
        assert!(report.warnings.is_empty());
        assert!(active.path.is_dir());
        assert!(!abandoned_path.exists());
        active.remove().unwrap();
    }

    #[test]
    fn sweep_preserves_cache_siblings_and_unmarked_legacy_auth() {
        let scratch = Scratch::new();
        let legacy = scratch.0.join(format!(".auth-{}", uuid::Uuid::new_v4()));
        for path in [&legacy, &scratch.0.join("node-cache"), &scratch.0.join(".auth-not-a-uuid")] {
            std::fs::create_dir(path).unwrap();
            std::fs::write(path.join("keep"), "not owned by this lease format").unwrap();
        }
        let report = sweep(&scratch.0).unwrap();
        assert_eq!(report.removed, 0);
        assert!(report.warnings.iter().any(|warning| warning.contains("unmarked")));
        assert!(legacy.join("keep").is_file());
        assert!(scratch.0.join("node-cache/keep").is_file());
        assert!(scratch.0.join(".auth-not-a-uuid/keep").is_file());
    }

    #[test]
    fn cleanup_error_is_returned_and_marker_survives_for_recovery() {
        let scratch = Scratch::new();
        let mut owned = AuthDirectory::create(&scratch.0).unwrap();
        let path = owned.path.clone();
        // Mutate through the owning handle (Windows enforces the byte lock).
        let lease = owned.lease.as_mut().unwrap();
        lease.rewind().unwrap();
        lease.set_len(0).unwrap();
        lease.write_all(b"unknown format").unwrap();
        let error = owned.remove().unwrap_err();
        assert!(error.contains("marker"));
        assert!(path.join(LEASE_FILE).is_file());
        assert!(sweep(&scratch.0).unwrap().warnings.iter().any(|warning| warning.contains("marker")));
    }

    #[test]
    fn create_and_sweep_are_serialized_across_threads() {
        let scratch = Scratch::new();
        let root = scratch.0.clone();
        let creating = std::thread::spawn(move || AuthDirectory::create(&root).unwrap());
        sweep(&scratch.0).unwrap();
        let active = creating.join().unwrap();
        assert!(active.path.is_dir());
        assert_eq!(sweep(&scratch.0).unwrap().active, 1);
        active.remove().unwrap();
    }

    #[test]
    fn another_process_keeps_its_lease_until_process_death() {
        struct TestChild(std::process::Child);
        impl Drop for TestChild {
            fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); }
        }
        let scratch = Scratch::new();
        let mut child = TestChild(std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "relay::auth_storage::tests::lease_owner_subprocess", "--ignored"])
            .env("CCGUI_TEST_AUTH_LEASE_ROOT", &scratch.0)
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .spawn().unwrap());
        let deadline = Instant::now() + Duration::from_secs(10);
        while !scratch.0.join("ready").is_file() {
            assert!(child.0.try_wait().unwrap().is_none(), "lease owner exited before acquiring its lease");
            assert!(Instant::now() < deadline, "lease owner never became ready");
            std::thread::sleep(Duration::from_millis(20));
        }
        let report = sweep(&scratch.0).unwrap();
        assert_eq!(report.active, 1);
        assert_eq!(report.removed, 0);
        child.0.kill().unwrap();
        child.0.wait().unwrap();
        let report = sweep(&scratch.0).unwrap();
        assert_eq!(report.active, 0);
        assert_eq!(report.removed, 1);
        assert!(report.warnings.is_empty());
    }

    #[test]
    #[ignore = "subprocess entry point for another_process_keeps_its_lease_until_process_death"]
    fn lease_owner_subprocess() {
        let root = PathBuf::from(std::env::var_os("CCGUI_TEST_AUTH_LEASE_ROOT").unwrap());
        let owned = AuthDirectory::create(&root).unwrap();
        std::fs::write(owned.path.join("fake-credential"), "isolated test credential").unwrap();
        std::fs::write(root.join("ready"), "ready").unwrap();
        std::thread::sleep(Duration::from_secs(30));
        owned.remove().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn writer_retains_lease_after_owner_sigkill_until_writer_exit() {
        struct TestChild(std::process::Child);
        impl Drop for TestChild {
            fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); }
        }
        let scratch = Scratch::new();
        let mut owner = TestChild(std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "relay::auth_storage::tests::lease_owner_with_writer_subprocess", "--ignored"])
            .env("CCGUI_TEST_AUTH_LEASE_ROOT", &scratch.0)
            .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .spawn().unwrap());
        let deadline = Instant::now() + Duration::from_secs(10);
        while !scratch.0.join("writer-ready").is_file() {
            assert!(owner.0.try_wait().unwrap().is_none(), "owner exited before writer became ready");
            assert!(Instant::now() < deadline, "writer did not acquire inherited lease");
            std::thread::sleep(Duration::from_millis(20));
        }
        owner.0.kill().unwrap(); // SIGKILL: no destructor or child-tree cleanup.
        owner.0.wait().unwrap();
        let report = sweep(&scratch.0).unwrap();
        assert_eq!(report.active, 1, "live credential writer must retain the same lease");
        assert_eq!(report.removed, 0);
        std::fs::write(scratch.0.join("writer-release"), "finish").unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let report = sweep(&scratch.0).unwrap();
            assert!(report.warnings.is_empty());
            if report.removed == 1 { break; }
            assert!(Instant::now() < deadline, "writer lease did not close at process exit");
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(std::fs::read(scratch.0.join("writer-finished")).unwrap(), b"written after owner death");
    }

    #[cfg(unix)]
    #[test]
    #[ignore = "owner fixture for writer_retains_lease_after_owner_sigkill_until_writer_exit"]
    fn lease_owner_with_writer_subprocess() {
        use std::os::fd::AsRawFd;
        use std::os::unix::process::CommandExt;
        let root = PathBuf::from(std::env::var_os("CCGUI_TEST_AUTH_LEASE_ROOT").unwrap());
        let owned = AuthDirectory::create(&root).unwrap();
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command.args(["--exact", "relay::auth_storage::tests::lease_writer_subprocess", "--ignored"])
            .env("CCGUI_TEST_AUTH_LEASE_ROOT", &root)
            .env("CCGUI_TEST_AUTH_WRITER_DIR", &owned.path)
            .process_group(0).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        owned.inherit_lease(&mut command).unwrap();
        let mut writer = command.spawn().unwrap();
        drop(command);
        assert_ne!(unsafe { libc::fcntl(owned.lease.as_ref().unwrap().as_raw_fd(), libc::F_GETFD) } & libc::FD_CLOEXEC, 0);
        writer.wait().unwrap();
        owned.remove().unwrap();
    }

    #[cfg(unix)]
    #[test]
    #[ignore = "writer fixture for writer_retains_lease_after_owner_sigkill_until_writer_exit"]
    fn lease_writer_subprocess() {
        let root = PathBuf::from(std::env::var_os("CCGUI_TEST_AUTH_LEASE_ROOT").unwrap());
        let directory = PathBuf::from(std::env::var_os("CCGUI_TEST_AUTH_WRITER_DIR").unwrap());
        std::fs::write(root.join("writer-ready"), "ready").unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        while !root.join("writer-release").is_file() {
            if Instant::now() >= deadline { return; }
            std::thread::sleep(Duration::from_millis(20));
        }
        std::fs::write(directory.join("fake-credential"), "written after owner death").unwrap();
        std::fs::write(root.join("writer-finished"), "written after owner death").unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn failed_deletion_keeps_marker_and_recovers_on_next_sweep() {
        use std::os::windows::fs::OpenOptionsExt;
        let scratch = Scratch::new();
        let owned = AuthDirectory::create(&scratch.0).unwrap();
        let path = owned.path.clone();
        let credential = path.join("fake-credential");
        std::fs::write(&credential, "isolated test credential").unwrap();
        // A real sharing violation is stable across Rust versions; read-only
        // attributes may be ignored by newer remove_file implementations.
        let held = OpenOptions::new().read(true).share_mode(0x0000_0003)
            .open(&credential).unwrap();
        assert!(owned.remove().is_err());
        assert!(path.join(LEASE_FILE).is_file());
        drop(held);
        assert_eq!(sweep(&scratch.0).unwrap().removed, 1);
        assert!(!path.exists());
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn root_and_nested_symlinks_are_never_followed_or_removed() {
        let scratch = Scratch::new();
        let outside = Scratch::new();
        std::fs::write(outside.0.join("keep"), "outside").unwrap();
        let alias = scratch.0.join("alias");
        assert!(crate::plugins::test_support::create_dir_link(&alias, &outside.0));
        assert!(AuthDirectory::create(&alias).is_err());
        assert!(sweep(&alias).is_err());
        let mut owned = AuthDirectory::create(&scratch.0).unwrap();
        assert!(crate::plugins::test_support::create_dir_link(&owned.path.join("linked-home"), &outside.0));
        assert!(validate_credentials(&owned.path).is_err());
        drop(owned.lease.take());
        owned.cleaned = true;
        let report = sweep(&scratch.0).unwrap();
        assert_eq!(report.removed, 0);
        assert!(report.warnings.iter().any(|warning| warning.contains("link")));
        assert_eq!(std::fs::canonicalize(owned.path.join("linked-home")).unwrap(), std::fs::canonicalize(&outside.0).unwrap());
        assert_eq!(std::fs::read_to_string(outside.0.join("keep")).unwrap(), "outside");
    }

    #[cfg(unix)]
    #[test]
    fn auth_directory_is_private_before_credential_creation() {
        use std::os::unix::fs::PermissionsExt;
        let scratch = Scratch::new();
        let owned = AuthDirectory::create(&scratch.0).unwrap();
        assert_eq!(std::fs::metadata(&owned.path).unwrap().permissions().mode() & 0o777, 0o700);
        owned.remove().unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn child_credential_inherits_only_current_user_access() {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::Foundation::{HANDLE, HLOCAL, LocalFree};
        use windows::Win32::Security::{
            GetAce, EqualSid, GetTokenInformation, TOKEN_QUERY, TOKEN_USER, TokenUser,
            ACCESS_ALLOWED_ACE, DACL_SECURITY_INFORMATION, INHERITED_ACE, PSECURITY_DESCRIPTOR, PSID,
        };
        use windows::Win32::Security::Authorization::{GetSecurityInfo, SE_FILE_OBJECT};
        use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
        use std::os::windows::io::{FromRawHandle, OwnedHandle};

        let scratch = Scratch::new();
        let owned = AuthDirectory::create(&scratch.0).unwrap();
        std::fs::create_dir_all(owned.path.join("home/.wrangler/config")).unwrap();
        let file = File::create(owned.path.join("home/.wrangler/config/default.toml")).unwrap();
        let mut acl = std::ptr::null_mut();
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        unsafe { GetSecurityInfo(HANDLE(file.as_raw_handle()), SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION, None, None, Some(&mut acl), None, Some(&mut descriptor)) }.ok().unwrap();
        assert!(!acl.is_null());
        assert_eq!(unsafe { (*acl).AceCount }, 1);
        let mut ace = std::ptr::null_mut();
        unsafe { GetAce(acl, 0, &mut ace) }.unwrap();
        let ace = unsafe { &*ace.cast::<ACCESS_ALLOWED_ACE>() };
        assert_eq!(ace.Header.AceType, 0);
        assert_ne!(u32::from(ace.Header.AceFlags) & INHERITED_ACE.0, 0);
        let mut token = HANDLE::default();
        unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }.unwrap();
        let token = unsafe { OwnedHandle::from_raw_handle(token.0) };
        let mut user = [0usize; 128 / std::mem::size_of::<usize>()];
        let mut needed = 0;
        unsafe { GetTokenInformation(HANDLE(token.as_raw_handle()), TokenUser,
            Some(user.as_mut_ptr().cast()), std::mem::size_of_val(&user) as u32, &mut needed) }.unwrap();
        let sid = unsafe { (*user.as_ptr().cast::<TOKEN_USER>()).User.Sid };
        unsafe { EqualSid(PSID(std::ptr::addr_of!(ace.SidStart).cast_mut().cast()), sid) }.unwrap();
        unsafe { LocalFree(Some(HLOCAL(descriptor.0))) };
        drop(file);
        owned.remove().unwrap();
    }
}
