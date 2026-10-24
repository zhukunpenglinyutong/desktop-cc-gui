//! Identity-bound editing of complete native CLI session sources.

mod agy;
mod opencode;

use base64::Engine as _;
use serde::Serialize;
use serde_json::Value;
use std::fs::{File, Metadata, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const MAX_SESSION_DOCUMENT_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFileDocument {
    pub path: String,
    pub name: String,
    pub text: String,
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty()
        || session_id.trim() != session_id
        || matches!(session_id, "." | "..")
        || session_id.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
    {
        return Err("invalid native session id".into());
    }
    Ok(())
}

fn validate_engine(engine: &str) -> Result<(), String> {
    match engine {
        "claude" | "codex" | "pi" | "omp" | "qoder" | "qoder-cn" | "kimi"
        | "grok" | "minimax" | "dsh" | "opencode" | "agy" => Ok(()),
        _ => Err(format!("unsupported native session engine: {engine}")),
    }
}

fn check_document_size(size: u64) -> Result<(), String> {
    if size > MAX_SESSION_DOCUMENT_BYTES {
        return Err("native session document exceeds the complete-document limit (64 MiB); no editable prefix was returned".into());
    }
    Ok(())
}

fn bounded_utf8(bytes: Vec<u8>) -> Result<String, String> {
    check_document_size(bytes.len() as u64)?;
    String::from_utf8(bytes).map_err(|e| format!("native session is not valid UTF-8: {e}"))
}

fn regular_source(path: &Path) -> Result<Metadata, String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|e| format!("native source {} is unavailable: {e}", path.display()))?;
    if !metadata.file_type().is_file() {
        return Err(format!("native source must be an existing regular file, not a symlink: {}", path.display()));
    }
    // Do not let a replaced ancestor redirect the registered source elsewhere.
    for ancestor in path.ancestors().skip(1).filter(|p| !p.as_os_str().is_empty()) {
        let metadata = std::fs::symlink_metadata(ancestor)
            .map_err(|e| format!("native source directory {} is unavailable: {e}", ancestor.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("native source directory is a symlink: {}", ancestor.display()));
        }
    }
    Ok(metadata)
}

fn physical_source(engine: &str, session_id: &str, path: &Path) -> Result<PathBuf, String> {
    if engine == "opencode" {
        if let Some((physical, stored_id)) = super::split_opencode_db_path(path) {
            if stored_id != session_id {
                return Err("OpenCode source address belongs to a different session".into());
            }
            return Ok(physical);
        }
    }
    Ok(path.to_path_buf())
}

fn validate_source_shape(engine: &str, session_id: &str, path: &Path) -> Result<(), String> {
    let name = path.file_name().and_then(|name| name.to_str())
        .ok_or_else(|| "native source has no valid filename".to_string())?;
    let valid = match engine {
        "claude" | "qoder" | "qoder-cn" => name == format!("{session_id}.jsonl"),
        "dsh" => super::discovery::dsh_log_generation(name).is_some(),
        "grok" => name == "chat_history.jsonl"
            && path.parent().and_then(Path::file_name).and_then(|name| name.to_str()) == Some(session_id),
        "kimi" => name == "wire.jsonl",
        "minimax" => name == "messages.jsonl",
        "agy" => name == format!("{session_id}.db"),
        "opencode" => super::split_opencode_db_path(path).is_some() || name == format!("{session_id}.json"),
        // Timestamped OMP and Codex filenames are legitimate: their metadata
        // rows, not a guessed UUID-only filename, carry the session identity.
        "codex" | "pi" | "omp" => path.extension().and_then(|extension| extension.to_str()) == Some("jsonl"),
        _ => false,
    };
    if !valid { return Err(format!("native source path does not match {engine}/{session_id}")); }
    if engine == "kimi" { validate_kimi_path(path)?; }
    Ok(())
}

fn validate_kimi_path(path: &Path) -> Result<(), String> {
    if path.parent().and_then(Path::file_name).and_then(|name| name.to_str()) != Some("main")
        || path.parent().and_then(Path::parent).and_then(Path::file_name).and_then(|name| name.to_str()) != Some("agents") {
        return Err("Kimi native transcript must be agents/main/wire.jsonl".into());
    }
    Ok(())
}

fn source_name(engine: &str, path: &Path, session_id: &str) -> Result<String, String> {
    let native = path.file_name().and_then(|name| name.to_str())
        .ok_or_else(|| "native source has no valid filename".to_string())?;
    match engine {
        "agy" | "opencode" => Ok(format!("{session_id}.json")),
        "dsh" => native.strip_suffix(".zstd").map(str::to_string)
            .ok_or_else(|| "DSH source is not a native .jsonl.zstd transcript".to_string()),
        _ => Ok(native.to_string()),
    }
}

fn read_native_text(engine: &str, path: &Path) -> Result<String, String> {
    let metadata = regular_source(path)?;
    check_document_size(metadata.len())?;
    let file = File::open(path).map_err(|e| format!("read native source {}: {e}", path.display()))?;
    let mut bytes = if engine == "dsh" { Vec::new() } else { Vec::with_capacity(metadata.len() as usize) };
    if engine == "dsh" {
        let decoder = zstd::stream::read::Decoder::new(file)
            .map_err(|e| format!("decode native DSH source {}: {e}", path.display()))?;
        decoder.take(MAX_SESSION_DOCUMENT_BYTES + 1).read_to_end(&mut bytes)
            .map_err(|e| format!("decode native DSH source {}: {e}", path.display()))?;
    } else {
        file.take(MAX_SESSION_DOCUMENT_BYTES + 1).read_to_end(&mut bytes)
            .map_err(|e| format!("read native source {}: {e}", path.display()))?;
    }
    if !same_source(&metadata, &regular_source(path)?) {
        return Err("native source changed during read; reload the selected session".into());
    }
    bounded_utf8(bytes)
}

// Metadata identities are native facts, not editable conversation text. Other
// fields (including unknown CLI fields) remain byte-for-byte as the user saves.
fn validate_native_content(engine: &str, session_id: &str, content: &str) -> Result<Option<Value>, String> {
    check_document_size(content.len() as u64)?;
    let expected = match engine {
        "codex" => Some("session_meta"),
        "pi" | "omp" | "dsh" => Some("session"),
        _ => None,
    };
    let mut identity = None;
    let mut rows = 0;
    for (index, line) in content.lines().enumerate() {
        if line.trim().is_empty() { continue; }
        let value: Value = serde_json::from_str(line)
            .map_err(|e| format!("invalid native JSONL on line {}: {e}", index + 1))?;
        if !value.is_object() {
            return Err(format!("native JSONL line {} must be an object", index + 1));
        }
        rows += 1;
        if expected.is_some() && value.get("type").and_then(Value::as_str) == expected {
            let metadata = if engine == "codex" { &value["payload"] } else { &value };
            if metadata.get("id").and_then(Value::as_str) != Some(session_id) {
                return Err("native session metadata id does not match the selected session".into());
            }
            if metadata.get("cwd").and_then(Value::as_str).is_none_or(|cwd| cwd.trim().is_empty()) {
                return Err("native session metadata is missing its workspace identity".into());
            }
            let candidate = serde_json::json!({"id": metadata["id"], "cwd": metadata["cwd"]});
            if identity.as_ref().is_some_and(|old| old != &candidate) {
                return Err("native source contains conflicting session metadata".into());
            }
            identity = Some(candidate);
        }
        if matches!(engine, "claude" | "qoder" | "qoder-cn") {
            for key in ["sessionId", "session_id", "sessionID"] {
                if let Some(id) = value.get(key) {
                    if id.as_str() != Some(session_id) {
                        return Err(format!("native {key} on line {} belongs to a different session", index + 1));
                    }
                    identity = Some(serde_json::json!({"id": session_id}));
                }
            }
        }
    }
    if rows == 0 || (expected.is_some() && identity.is_none()) {
        return Err("native transcript is empty or missing its required session metadata".into());
    }
    Ok(identity)
}

fn validate_native_edit(engine: &str, session_id: &str, original: &str, content: &str) -> Result<(), String> {
    let original_identity = validate_native_content(engine, session_id, original)?;
    let edited_identity = validate_native_content(engine, session_id, content)?;
    if original_identity != edited_identity {
        return Err("native session identity/workspace metadata cannot be changed or removed".into());
    }
    Ok(())
}

fn read_local(db: &crate::db::Db, engine: &str, session_id: &str) -> Result<SessionFileDocument, String> {
    validate_engine(engine)?;
    validate_session_id(session_id)?;
    let source = super::reader::session_file_path(db, engine, session_id)?;
    validate_source_shape(engine, session_id, &source)?;
    let physical = physical_source(engine, session_id, &source)?;
    regular_source(&physical)?;
    let text = match engine {
        "opencode" => opencode::read(&source, session_id)?,
        "agy" => agy::read(&source, session_id)?,
        _ => {
            let text = read_native_text(engine, &source)?;
            validate_native_content(engine, session_id, &text)?;
            text
        }
    };
    check_document_size(text.len() as u64)?;
    Ok(SessionFileDocument {
        name: source_name(engine, &physical, session_id)?,
        path: physical.to_string_lossy().into_owned(),
        text,
    })
}

#[cfg(test)]
fn write_local(db: &crate::db::Db, engine: &str, session_id: &str, content: &str) -> Result<(), String> {
    validate_engine(engine)?;
    validate_session_id(session_id)?;
    check_document_size(content.len() as u64)?;
    let source = local_source(db, engine, session_id)?;
    write_local_source(engine, session_id, &source, content.to_owned()).map(|_| ())
}

fn local_source(db: &crate::db::Db, engine: &str, session_id: &str) -> Result<PathBuf, String> {
    let source = super::reader::session_file_path(db, engine, session_id)?;
    validate_source_shape(engine, session_id, &source)?;
    Ok(source)
}

fn write_local_document(db: &crate::db::Db, engine: &str, session_id: &str, content: String)
    -> Result<SessionFileDocument, String> {
    let source = local_source(db, engine, session_id)?;
    let physical = physical_source(engine, session_id, &source)?;
    let name = source_name(engine, &physical, session_id)?;
    let text = write_local_source(engine, session_id, &source, content)?;
    Ok(SessionFileDocument { path: physical.to_string_lossy().into_owned(), name, text })
}

fn write_local_source(engine: &str, session_id: &str, source: &Path, content: String) -> Result<String, String> {
    let physical = physical_source(engine, session_id, source)?;
    let metadata = regular_source(&physical)?;
    if metadata.permissions().readonly() {
        return Err(format!("native source is read-only: {}", physical.display()));
    }
    match engine {
        "opencode" => opencode::write(source, session_id, &content),
        "agy" => agy::write(source, session_id, &content),
        _ => {
            let original = read_native_text(engine, source)?;
            validate_native_edit(engine, session_id, &original, &content)?;
            if engine == "dsh" {
                let bytes = zstd::stream::encode_all(content.as_bytes(), 3)
                    .map_err(|e| format!("compress native DSH transcript: {e}"))?;
                check_document_size(bytes.len() as u64)?;
                atomic_write_existing_checked(source, &bytes, &metadata)?;
            } else {
                atomic_write_existing_checked(source, content.as_bytes(), &metadata)?;
            }
            Ok(content)
        }
    }
}

fn same_source(before: &Metadata, after: &Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != after.dev() || before.ino() != after.ino() { return false; }
    }
    before.len() == after.len()
        && before.modified().ok() == after.modified().ok()
        && before.created().ok() == after.created().ok()
}

/// Replaces only an existing source with a fully flushed same-directory file.
/// Windows ReplaceFile preserves the existing file's DACL, unlike a fresh rename.
pub(super) fn atomic_write_existing(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let original = regular_source(path)?;
    atomic_write_existing_checked(path, bytes, &original)
}

fn atomic_write_existing_checked(path: &Path, bytes: &[u8], original: &Metadata) -> Result<(), String> {
    check_document_size(bytes.len() as u64)?;
    let current = regular_source(path)?;
    if !same_source(original, &current) {
        return Err("native source changed while preparing save; reload it before editing again".into());
    }
    if original.permissions().readonly() {
        return Err(format!("native source is read-only: {}", path.display()));
    }
    let source = File::open(path).map_err(|e| format!("open native source security metadata: {e}"))?;
    if !same_source(original, &source.metadata().map_err(|e| format!("inspect native source: {e}"))?) {
        return Err("native source changed before security metadata snapshot".into());
    }
    let parent = path.parent().ok_or_else(|| "native source has no parent directory".to_string())?;
    let temp = parent.join(format!(".ccgui-session-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut staged = options.open(&temp).map_err(|e| format!("stage native source: {e}"))?;
        staged.write_all(bytes).map_err(|e| format!("write staged native source: {e}"))?;
        preserve_source_permissions(&source, &staged)?;
        staged.sync_all().map_err(|e| format!("flush staged native source: {e}"))?;
        drop(staged);
        let current = regular_source(path)?;
        if current.permissions().readonly() || !same_source(original, &current) {
            return Err("native source changed while saving; reload it before editing again".into());
        }
        replace_existing(&temp, path).map_err(|e| format!("replace native source {}: {e}", path.display()))
    })();
    if result.is_err() { let _ = std::fs::remove_file(&temp); }
    result
}

/// Preserve access-control semantics, not only mode bits (which can be an ACL
/// mask). Failure aborts before replacing the source instead of broadening access.
pub(super) fn preserve_source_permissions(source: &File, staged: &File) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        use std::os::unix::fs::MetadataExt;
        let original = source.metadata().map_err(|e| format!("inspect native security metadata: {e}"))?;
        let target = staged.metadata().map_err(|e| format!("inspect staged security metadata: {e}"))?;
        if target.uid() != original.uid() || target.gid() != original.gid() {
            if unsafe { libc::fchown(staged.as_raw_fd(), original.uid(), original.gid()) } != 0 {
                return Err(format!("preserve native ownership: {}", std::io::Error::last_os_error()));
            }
        }
        #[cfg(target_os = "linux")]
        {
            let acl = linux_access_acl(source)?;
            let name = b"system.posix_acl_access\0";
            let result = match &acl {
                Some(bytes) => unsafe { libc::fsetxattr(staged.as_raw_fd(), name.as_ptr().cast(), bytes.as_ptr().cast(), bytes.len(), 0) },
                None => unsafe { libc::fremovexattr(staged.as_raw_fd(), name.as_ptr().cast()) },
            };
            if result != 0 && !(acl.is_none() && std::io::Error::last_os_error().raw_os_error() == Some(libc::ENODATA)) {
                return Err(format!("preserve native access ACL: {}", std::io::Error::last_os_error()));
            }
            staged.set_permissions(original.permissions()).map_err(|e| format!("preserve native mode: {e}"))?;
            if linux_access_acl(staged)? != acl || linux_access_acl(source)? != acl {
                return Err("native access ACL changed or could not be preserved".into());
            }
            return Ok(());
        }
        #[cfg(target_os = "macos")]
        {
            // fcopyfile SECURITY copies ownership/mode and the native extended
            // ACL, never the data. No chmod follows and clears its ACL mask.
            if unsafe { libc::fcopyfile(source.as_raw_fd(), staged.as_raw_fd(), std::ptr::null_mut(), libc::COPYFILE_SECURITY) } != 0 {
                return Err(format!("preserve native security metadata: {}", std::io::Error::last_os_error()));
            }
            return Ok(());
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        return Err("native ACL-preserving replacement is unsupported on this platform".into());
    }
    #[cfg(not(unix))]
    staged.set_permissions(source.metadata().map_err(|e| format!("inspect native permissions: {e}"))?.permissions())
        .map_err(|e| format!("preserve native permissions: {e}"))
}

#[cfg(target_os = "linux")]
fn linux_access_acl(source: &File) -> Result<Option<Vec<u8>>, String> {
    use std::os::fd::AsRawFd;
    let name = b"system.posix_acl_access\0";
    let size = unsafe { libc::fgetxattr(source.as_raw_fd(), name.as_ptr().cast(), std::ptr::null_mut(), 0) };
    if size < 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ENODATA) { return Ok(None); }
        return Err(format!("read native access ACL: {error}"));
    }
    if size > 64 * 1024 { return Err("native access ACL exceeds safe metadata limit".into()); }
    let mut bytes = vec![0; size as usize];
    let read = unsafe { libc::fgetxattr(source.as_raw_fd(), name.as_ptr().cast(), bytes.as_mut_ptr().cast(), bytes.len()) };
    if read != size { return Err("native access ACL changed during snapshot".into()); }
    Ok(Some(bytes))
}

#[cfg(not(windows))]
pub(super) fn replace_existing(temp: &Path, path: &Path) -> std::io::Result<()> {
    std::fs::rename(temp, path)
}

#[cfg(windows)]
pub(super) fn replace_existing(temp: &Path, path: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn ReplaceFileW(replaced: *const u16, replacement: *const u16, backup: *const u16,
            flags: u32, exclude: *mut std::ffi::c_void, reserved: *mut std::ffi::c_void) -> i32;
    }
    let parent = path.parent().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "native source has no parent"))?;
    let backup = parent.join(format!(".ccgui-original-{}.bak", uuid::Uuid::new_v4()));
    let backup_wide: Vec<u16> = backup.as_os_str().encode_wide().chain(Some(0)).collect();
    let replaced: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let replacement: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let succeeded = unsafe { ReplaceFileW(replaced.as_ptr(), replacement.as_ptr(), backup_wide.as_ptr(),
        0, std::ptr::null_mut(), std::ptr::null_mut()) };
    if succeeded == 0 {
        return Err(recover_windows_replacement_failure(path, &backup, std::io::Error::last_os_error()));
    }
    // A retained original is safer than making a successful commit look failed
    // (which could cause the caller to retry a stale edit). Cleanup is best-effort.
    let _ = std::fs::remove_file(&backup);
    Ok(())
}

#[cfg(windows)]
fn recover_windows_replacement_failure(path: &Path, backup: &Path, failure: std::io::Error) -> std::io::Error {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileW(existing: *const u16, destination: *const u16) -> i32;
    }
    let code = failure.raw_os_error();
    // 1177 leaves the original under the explicit backup name. Restore only
    // into an absent destination; MoveFileW never overwrites a new native file.
    // 1176 with a backup retains the original name. Other failures retain both
    // names per Win32, but still preserve any unexpected backup for recovery.
    let mut recovery = String::new();
    if std::fs::symlink_metadata(backup).is_ok() {
        match std::fs::symlink_metadata(path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let from: Vec<u16> = backup.as_os_str().encode_wide().chain(Some(0)).collect();
                let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
                if unsafe { MoveFileW(from.as_ptr(), to.as_ptr()) } != 0 {
                    recovery = "; original source restored".into();
                } else {
                    recovery = format!("; restoration failed: {}; original preserved at {}", std::io::Error::last_os_error(), backup.display());
                }
            }
            _ => recovery = format!("; original preserved at {}; destination was not overwritten", backup.display()),
        }
    } else if code == Some(1177) {
        recovery = format!("; original backup could not be inspected at {}; reload/check the source before retrying", backup.display());
    }
    std::io::Error::new(failure.kind(), format!("Windows native replacement failed ({code:?}): {failure}{recovery}"))
}

fn validate_remote_path(engine: &str, session_id: &str, path: &str) -> Result<(), String> {
    validate_engine(engine)?;
    validate_session_id(session_id)?;
    if matches!(engine, "agy" | "opencode") {
        return Err(format!("remote native {engine} database editing is unsupported by the workspace transport"));
    }
    if !super::reader::is_plausible_remote_session_path(engine, path) {
        return Err(format!("invalid remote native session path: {path}"));
    }
    validate_source_shape(engine, session_id, Path::new(path))?;
    Ok(())
}

fn remote_transport(db: &crate::db::Db, workspace: Option<&str>, engine: &str, session_id: &str,
    path: &str) -> Result<crate::engine::wsl_transport::WslTransport, String> {
    validate_remote_path(engine, session_id, path)?;
    let workspace = workspace.filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "remote native session editing requires its registered workspace".to_string())?;
    crate::engine::wsl_transport::transport_for_workspace(db, workspace)
        .ok_or_else(|| format!("workspace {workspace} has no registered remote transport"))
}

// realpath -s normalizes dot/repeated separators without following symlinks;
// comparing it with realpath -e excludes ancestor symlinks as well as the leaf.
fn remote_source_guard(quoted: &str) -> String {
    format!("src={quoted}\n[ -f \"$src\" ] && [ ! -L \"$src\" ] && [ -r \"$src\" ] || {{ echo 'native source missing or unreadable' >&2; exit 3; }}\n\
        resolved=$(realpath -e -- \"$src\") && lexical=$(realpath -ms -- \"$src\") || exit 3\n\
        [ \"$resolved\" = \"$lexical\" ] || {{ echo 'native source symlink boundary rejected' >&2; exit 3; }}\n\
        sz=$(stat -c %s -- \"$src\") || exit 3\n\
        [ \"$sz\" -le {MAX_SESSION_DOCUMENT_BYTES} ] || {{ echo 'native source exceeds 64 MiB' >&2; exit 4; }}\n")
}

async fn read_remote_source(transport: &crate::engine::wsl_transport::WslTransport, engine: &str,
    session_id: &str, path: &str) -> Result<(String, String), String> {
    let quoted = crate::engine::wsl_transport::sh_quote(path);
    let script = format!("set -e\nset -o pipefail\n{}\nsignature=$(stat -c '%d:%i:%s:%y:%z' -- \"$src\") || exit 3\n\
        printf '%s\\n' \"$signature\"\ndd if=\"$src\" bs=65536 count=1025 status=none | base64 -w0\n\
        [ \"$(stat -c '%d:%i:%s:%y:%z' -- \"$src\")\" = \"$signature\" ] || {{ echo 'native source changed during read' >&2; exit 5; }}",
        remote_source_guard(&quoted));
    let raw = crate::engine::wsl_transport::run_script_output(transport, &script).await?;
    let (signature, encoded) = raw.split_once('\n')
        .ok_or_else(|| "remote native source response is incomplete".to_string())?;
    let signature = signature.trim_end_matches('\r').to_string();
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded.trim())
        .map_err(|e| format!("decode remote native source: {e}"))?;
    check_document_size(bytes.len() as u64)?;
    let text = if engine == "dsh" {
        let decoder = zstd::stream::read::Decoder::new(bytes.as_slice())
            .map_err(|e| format!("decode remote native DSH source: {e}"))?;
        let mut decoded = Vec::new();
        decoder.take(MAX_SESSION_DOCUMENT_BYTES + 1).read_to_end(&mut decoded)
            .map_err(|e| format!("decode remote native DSH source: {e}"))?;
        bounded_utf8(decoded)?
    } else { bounded_utf8(bytes)? };
    validate_native_content(engine, session_id, &text)?;
    Ok((text, signature))
}

fn remote_write_script(engine: &str, session_id: &str, path: &str, content: &str,
    signature: &str) -> Result<String, String> {
    validate_remote_path(engine, session_id, path)?;
    validate_native_content(engine, session_id, content)?;
    let bytes;
    let payload = if engine == "dsh" {
        bytes = zstd::stream::encode_all(content.as_bytes(), 3)
            .map_err(|e| format!("compress remote native DSH source: {e}"))?;
        bytes.as_slice()
    } else { content.as_bytes() };
    check_document_size(payload.len() as u64)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(payload);
    let quoted = crate::engine::wsl_transport::sh_quote(path);
    let signature = crate::engine::wsl_transport::sh_quote(signature);
    Ok(format!("set -e\numask 077\n{}\n\
        expected={signature}\n[ \"$(stat -c '%d:%i:%s:%y:%z' -- \"$src\")\" = \"$expected\" ] || {{ echo 'native source changed before save; reload it' >&2; exit 5; }}\n\
        [ -w \"$src\" ] || {{ echo 'native source is read-only' >&2; exit 3; }}\n\
        dir=$(dirname -- \"$src\")\ntmp=$(mktemp -- \"$dir/.ccgui-session.XXXXXXXX\")\n\
        trap 'rm -f -- \"$tmp\"' EXIT\nbase64 -d > \"$tmp\" <<'CCGUI_SESSION_PAYLOAD'\n{encoded}\nCCGUI_SESSION_PAYLOAD\n\
        cp --attributes-only --preserve=mode,ownership -- \"$src\" \"$tmp\"\nsync -f -- \"$tmp\"\n\
        [ -f \"$src\" ] && [ ! -L \"$src\" ] && [ \"$(stat -c '%d:%i:%s:%y:%z' -- \"$src\")\" = \"$expected\" ] || {{ echo 'native source changed during save' >&2; exit 5; }}\n\
        [ \"$(realpath -e -- \"$src\")\" = \"$lexical\" ] || exit 5\n\
        mv -fT -- \"$tmp\" \"$src\"\ntrap - EXIT",
        remote_source_guard(&quoted)))
}


#[tauri::command]
pub async fn read_session_file(state: tauri::State<'_, crate::AppState>, engine: String,
    session_id: String, workspace_path: Option<String>, remote_path: Option<String>)
    -> Result<SessionFileDocument, String> {
    if let Some(remote_path) = remote_path {
        let transport = remote_transport(&state.db, workspace_path.as_deref(), &engine, &session_id, &remote_path)?;
        let (text, _) = read_remote_source(&transport, &engine, &session_id, &remote_path).await?;
        return Ok(SessionFileDocument {
            name: source_name(&engine, Path::new(&remote_path), &session_id)?,
            path: remote_path,
            text,
        });
    }
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || read_local(&db, &engine, &session_id))
        .await.map_err(|e| e.to_string())?
}

fn external_text_source(db: &crate::db::Db, engine: &str, session_id: &str) -> Result<PathBuf, String> {
    validate_engine(engine)?;
    validate_session_id(session_id)?;
    if matches!(engine, "dsh" | "opencode" | "agy") {
        return Err("native session uses compressed or database storage; use software supporting its format, not a text editor".into());
    }
    let source = local_source(db, engine, session_id)?;
    regular_source(&source)?;
    Ok(source)
}

#[tauri::command]
pub async fn open_session_file_in_default_editor(state: tauri::State<'_, crate::AppState>,
    engine: String, session_id: String) -> Result<(), String> {
    let db = Arc::clone(&state.db);
    let processes = Arc::clone(&state.processes);
    tauri::async_runtime::spawn_blocking(move || {
        let _edit = processes.begin_session_edit(&session_id)?;
        // Resolve the current registered source again. Never launch a stale UI
        // path or read the oversized transcript into memory just to open it.
        let source = external_text_source(&db, &engine, &session_id)?;
        crate::open_app::open_in_default_text_editor(&source)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_session_file(state: tauri::State<'_, crate::AppState>, engine: String,
    session_id: String, content: String, workspace_path: Option<String>, remote_path: Option<String>)
    -> Result<SessionFileDocument, String> {
    validate_engine(&engine)?;
    validate_session_id(&session_id)?;
    check_document_size(content.len() as u64)?;
    if let Some(remote_path) = remote_path {
        let transport = remote_transport(&state.db, workspace_path.as_deref(), &engine, &session_id, &remote_path)?;
        let (original, signature) = read_remote_source(&transport, &engine, &session_id, &remote_path).await?;
        validate_native_edit(&engine, &session_id, &original, &content)?;
        let script = remote_write_script(&engine, &session_id, &remote_path, &content, &signature)?;
        let _edit = state.processes.begin_session_edit(&session_id)?;
        let current = remote_transport(&state.db, workspace_path.as_deref(), &engine, &session_id, &remote_path)?;
        if current.host != transport.host || current.port != transport.port || current.user != transport.user
            || current.distro != transport.distro || current.control_path != transport.control_path
            || current.workspace != transport.workspace || current.engine_paths != transport.engine_paths {
            return Err("workspace remote transport changed during native session save".into());
        }
        let name = source_name(&engine, Path::new(&remote_path), &session_id)?;
        crate::engine::wsl_transport::run_script_output(&current, &script).await?;
        drop(_edit);
        return Ok(SessionFileDocument { name, path: remote_path, text: content });
    }
    let db = Arc::clone(&state.db);
    let processes = Arc::clone(&state.processes);
    tauri::async_runtime::spawn_blocking(move || {
        let _edit = processes.begin_session_edit(&session_id)?;
        // The per-session lease excludes starts without holding the global
        // process registry mutex during file I/O or database transactions.
        let result = write_local_document(&db, &engine, &session_id, content);
        drop(_edit);
        result
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let path = std::env::temp_dir().canonicalize().unwrap().join(format!("ccgui-session-edit-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn path(&self, name: &str) -> PathBuf { self.0.join(name) }
        fn db(&self) -> crate::db::Db { crate::db::Db::open_at(&self.path("app.db")).unwrap() }
    }
    impl Drop for Scratch {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    fn register(db: &crate::db::Db, engine: &str, sid: &str, path: &Path) {
        db.0.lock().execute(
            "INSERT INTO sessions(engine,session_id,workspace_path,file_path,file_size,file_mtime_ms,title) VALUES(?1,?2,'/fixture',?3,0,0,'fixture')",
            rusqlite::params![engine, sid, path.to_string_lossy()],
        ).unwrap();
    }

    fn omp_text(sid: &str, text: &str) -> String {
        format!("{}\n{}\n", serde_json::json!({"type":"session","id":sid,"cwd":"/fixture"}),
            serde_json::json!({"type":"message","message":{"role":"user","content":[{"type":"text","text":text}]}}))
    }

    #[test]
    fn raw_complete_document_over_one_mib_roundtrips_native_filename() {
        let scratch = Scratch::new();
        let db = scratch.db();
        let path = scratch.path("2026-10-22T12-00-00_sid-one.jsonl");
        let before = omp_text("sid-one", &"汉🦀".repeat(200_000));
        assert!(before.len() > 1024 * 1024);
        std::fs::write(&path, &before).unwrap();
        register(&db, "omp", "sid-one", &path);
        let document = read_local(&db, "omp", "sid-one").unwrap();
        assert_eq!(document.text, before);
        assert_eq!(document.name, "2026-10-22T12-00-00_sid-one.jsonl");
        assert_eq!(document.path, path.to_string_lossy());
        let after = omp_text("sid-one", &"changed\n汉🦀".repeat(100_000));
        let saved = write_local_document(&db, "omp", "sid-one", after).unwrap();
        let after = saved.text;
        assert_eq!(std::fs::read_to_string(&path).unwrap(), after);
        assert_eq!(read_local(&db, "omp", "sid-one").unwrap().text, after);
    }

    #[test]
    fn external_editor_resolves_oversized_registered_source_without_reading_a_prefix() {
        let scratch = Scratch::new();
        let db = scratch.db();
        let path = scratch.path("2026-10-22T12-00-00_sid-one.jsonl");
        let original = omp_text("sid-one", "汉🦀 original");
        std::fs::write(&path, &original).unwrap();
        let size = MAX_SESSION_DOCUMENT_BYTES + 1;
        OpenOptions::new().write(true).open(&path).unwrap().set_len(size).unwrap();
        register(&db, "omp", "sid-one", &path);
        assert!(read_local(&db, "omp", "sid-one").err().unwrap().contains("64 MiB"));
        assert_eq!(external_text_source(&db, "omp", "sid-one").unwrap(), path);
        assert_eq!(std::fs::metadata(&path).unwrap().len(), size);
        let mut prefix = vec![0; original.len()];
        File::open(&path).unwrap().read_exact(&mut prefix).unwrap();
        assert_eq!(prefix, original.as_bytes());
        assert!(external_text_source(&db, "codex", "sid-one").is_err());
        assert!(external_text_source(&db, "omp", "../sid-one").is_err());
        std::fs::remove_file(&path).unwrap();
        assert!(external_text_source(&db, "omp", "sid-one").is_err());
        assert!(!path.exists());
    }

    #[test]
    fn external_text_editor_rejects_compressed_and_database_storage() {
        let scratch = Scratch::new();
        let db = scratch.db();
        for engine in ["dsh", "opencode", "agy"] {
            assert!(external_text_source(&db, engine, "sid-one").unwrap_err().contains("not a text editor"));
        }
    }

    #[test]
    fn dsh_complete_document_recompresses_original_source() {
        let scratch = Scratch::new();
        let db = scratch.db();
        let path = scratch.path("session.v3.jsonl.zstd");
        let before = omp_text("sid-one", &"before".repeat(220_000));
        std::fs::write(&path, zstd::stream::encode_all(before.as_bytes(), 3).unwrap()).unwrap();
        register(&db, "dsh", "sid-one", &path);
        let document = read_local(&db, "dsh", "sid-one").unwrap();
        assert_eq!(document.name, "session.v3.jsonl");
        assert_eq!(document.text, before);
        assert_eq!(document.path, path.to_string_lossy());
        let after = omp_text("sid-one", "edited 汉🦀");
        write_local(&db, "dsh", "sid-one", &after).unwrap();
        assert_eq!(zstd::stream::decode_all(std::fs::File::open(&path).unwrap()).unwrap(), after.as_bytes());
    }

    #[test]
    fn missing_wrong_engine_invalid_id_never_create_source() {
        let scratch = Scratch::new();
        let db = scratch.db();
        let path = scratch.path("missing.jsonl");
        register(&db, "omp", "sid-one", &path);
        assert!(read_local(&db, "omp", "sid-one").is_err());
        assert!(write_local(&db, "omp", "sid-one", &omp_text("sid-one", "x")).is_err());
        assert!(!path.exists());
        assert!(read_local(&db, "codex", "sid-one").is_err());
        for sid in ["", "..", "../sid-one", "C:\\sid", "bad\u{1f}id", "bad\n"] {
            assert!(validate_session_id(sid).is_err(), "{sid:?}");
        }
        assert!(read_local(&db, "unknown", "sid-one").is_err());
    }

    #[test]
    fn corrupt_compressed_source_and_native_permissions_are_explicit_errors() {
        let scratch = Scratch::new();
        let db = scratch.db();
        let path = scratch.path("session.v3.jsonl.zstd");
        std::fs::write(&path, b"not a zstd frame").unwrap();
        register(&db, "dsh", "sid-one", &path);
        assert!(read_local(&db, "dsh", "sid-one").is_err());
        assert!(write_local(&db, "dsh", "sid-one", &omp_text("sid-one", "edit")).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"not a zstd frame");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn remote_script_writes_raw_and_compressed_actual_native_source() {
        use std::os::unix::fs::PermissionsExt;
        let scratch = Scratch::new();
        let dir = scratch.path(".omp/agent/sessions/a'b");
        std::fs::create_dir_all(&dir).unwrap();
        for engine in ["omp", "dsh"] {
            let path = dir.join(if engine == "dsh" { "session.v3.jsonl.zstd" } else { "timestamp_sid-one.jsonl" });
            let before = omp_text("sid-one", "before");
            let after = omp_text("sid-one", "edited 汉🦀 $(touch /tmp/ccgui-injected) ' ");
            let bytes = if engine == "dsh" { zstd::stream::encode_all(before.as_bytes(), 3).unwrap() } else { before.into_bytes() };
            std::fs::write(&path, bytes).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
            let stat = std::process::Command::new("stat").args(["-c", "%d:%i:%s:%y:%z", "--"]).arg(&path).output().unwrap();
            assert!(stat.status.success());
            let signature = String::from_utf8(stat.stdout).unwrap();
            let script = remote_write_script(engine, "sid-one", path.to_str().unwrap(), &after, signature.trim()).unwrap();
            let result = std::process::Command::new("bash").args(["-c", &script]).output().unwrap();
            assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
            assert_eq!(read_native_text(engine, &path).unwrap(), after);
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
            let stale = std::process::Command::new("bash").args(["-c", &script]).output().unwrap();
            assert!(!stale.status.success(), "a stale remote source signature must reject another write");
            std::fs::remove_file(&path).unwrap();
            let missing = std::process::Command::new("bash").args(["-c", &script]).output().unwrap();
            assert!(!missing.status.success());
            assert!(!path.exists());
        }
    }

    #[test]
    fn atomic_write_rejects_source_replaced_since_read() {
        let scratch = Scratch::new();
        let path = scratch.path("native.jsonl");
        std::fs::write(&path, b"original").unwrap();
        let original = regular_source(&path).unwrap();
        std::fs::write(&path, b"a new longer transcript").unwrap();
        assert!(atomic_write_existing_checked(&path, b"overwrite", &original).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"a new longer transcript");
    }

    #[test]
    fn active_session_and_launch_reservations_fail_closed() {
        let processes = crate::engine::ProcessRegistry::default();
        assert!(processes.begin_session_edit("sid-one").is_ok());
        let entry = crate::engine::ChildEntry {
            child: None, pid: crate::engine::next_virtual_pid(), run_id: "run-one".into(),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            reader_abort: Arc::new(std::sync::OnceLock::new()), stdin: None,
            questions: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            plans: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        };
        processes.0.lock().unwrap().insert("sid-one".into(), entry.clone());
        assert!(processes.begin_session_edit("sid-one").is_err());
        assert!(processes.begin_session_edit("sid-two").is_ok());
        processes.0.lock().unwrap().clear();
        let mut reservation = entry;
        reservation.pid = 0;
        processes.0.lock().unwrap().insert("launch-run".into(), reservation);
        assert!(processes.begin_session_edit("sid-two").is_err());
        // Release isolated virtual entries before registry teardown.
        processes.0.lock().unwrap().clear();
    }

    #[test]
    fn source_filename_identity_and_remote_database_boundaries() {
        assert!(validate_source_shape("claude", "one", Path::new("two.jsonl")).is_err());
        assert!(validate_source_shape("omp", "one", Path::new("2026_one.jsonl")).is_ok());
        assert!(validate_source_shape("dsh", "one", Path::new("session.v03.jsonl.zstd")).is_err());
        assert!(validate_remote_path("opencode", "one", "/home/dev/opencode.db").unwrap_err().contains("unsupported"));
        assert!(validate_remote_path("agy", "one", "/home/dev/conversations/one.db").unwrap_err().contains("unsupported"));
    }

    #[test]
    fn opencode_document_uses_physical_database_and_writes_only_selected_session() {
        let scratch = Scratch::new();
        let db = scratch.db();
        let physical = scratch.path("opencode.db");
        let native = rusqlite::Connection::open(&physical).unwrap();
        native.execute_batch("CREATE TABLE session(id TEXT PRIMARY KEY,directory TEXT,title TEXT);
            CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,data TEXT);
            CREATE TABLE part(id TEXT PRIMARY KEY,message_id TEXT,session_id TEXT,time_created INTEGER,data TEXT);
            INSERT INTO session VALUES('ses_one','/fixture','first'),('ses_other','/other','other');
            INSERT INTO message VALUES('msg_one','ses_one',1,'{\"role\":\"user\"}'),('msg_other','ses_other',2,'{\"role\":\"user\"}');
            INSERT INTO part VALUES('prt_one','msg_one','ses_one',1,'{\"type\":\"text\",\"text\":\"before\",\"unknown\":42}'),
                ('prt_other','msg_other','ses_other',2,'{\"type\":\"text\",\"text\":\"untouched\"}');").unwrap();
        let source = super::super::opencode_db_session_path(&physical, "ses_one");
        register(&db, "opencode", "ses_one", &source);
        let document = read_local(&db, "opencode", "ses_one").unwrap();
        assert_eq!(document.path, physical.to_string_lossy());
        assert_eq!(document.name, "ses_one.json");
        let mut view: Value = serde_json::from_str(&document.text).unwrap();
        view["messages"][0]["parts"][0]["data"]["text"] = serde_json::json!("edited 汉🦀");
        write_local(&db, "opencode", "ses_one", &view.to_string()).unwrap();
        let selected: String = native.query_row("SELECT data FROM part WHERE id='prt_one'", [], |row| row.get(0)).unwrap();
        let selected: Value = serde_json::from_str(&selected).unwrap();
        assert_eq!(selected["text"], "edited 汉🦀");
        assert_eq!(selected["unknown"], 42);
        let unrelated: String = native.query_row("SELECT data FROM part WHERE id='prt_other'", [], |row| row.get(0)).unwrap();
        assert_eq!(unrelated, "{\"type\":\"text\",\"text\":\"untouched\"}");
    }

    #[test]
    fn native_identity_and_corrupt_json_are_rejected_without_writeback() {
        let scratch = Scratch::new();
        let db = scratch.db();
        let path = scratch.path("sid-one.jsonl");
        let before = omp_text("sid-one", "before");
        std::fs::write(&path, &before).unwrap();
        register(&db, "omp", "sid-one", &path);
        for invalid in [omp_text("sid-two", "wrong id"), "{broken\n".into(), "{\"type\":\"message\"}\n".into()] {
            assert!(write_local(&db, "omp", "sid-one", &invalid).is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
        }
        std::fs::write(&path, omp_text("sid-two", "stale source")).unwrap();
        assert!(read_local(&db, "omp", "sid-one").is_err());
    }

    #[test]
    fn complete_document_cap_rejects_raw_and_decompressed_prefixes() {
        let scratch = Scratch::new();
        let raw = scratch.path("oversized.jsonl");
        std::fs::File::create(&raw).unwrap().set_len(MAX_SESSION_DOCUMENT_BYTES + 1).unwrap();
        assert!(read_native_text("claude", &raw).unwrap_err().contains("64 MiB"));
        let compressed = scratch.path("session.jsonl.zstd");
        let mut encoder = zstd::stream::write::Encoder::new(std::fs::File::create(&compressed).unwrap(), 3).unwrap();
        let block = [b'a'; 64 * 1024];
        for _ in 0..1025 { encoder.write_all(&block).unwrap(); }
        encoder.finish().unwrap();
        assert!(read_native_text("dsh", &compressed).unwrap_err().contains("64 MiB"));
        assert!(bounded_utf8(vec![0xff]).is_err());
    }

    #[test]
    fn virtual_opencode_path_must_match_requested_session() {
        let scratch = Scratch::new();
        let path = super::super::opencode_db_session_path(&scratch.path("opencode.db"), "ses_other");
        assert!(physical_source("opencode", "ses_one", &path).is_err());
        assert_eq!(physical_source("opencode", "ses_other", &path).unwrap(), scratch.path("opencode.db"));
    }

    #[test]
    fn atomic_write_preserves_readonly_and_missing_sources() {
        let scratch = Scratch::new();
        let path = scratch.path("native.jsonl");
        assert!(atomic_write_existing(&path, b"new").is_err());
        assert!(!path.exists());
        std::fs::write(&path, b"before").unwrap();
        let original_permissions = std::fs::metadata(&path).unwrap().permissions();
        let mut readonly = original_permissions.clone();
        readonly.set_readonly(true);
        std::fs::set_permissions(&path, readonly).unwrap();
        assert!(atomic_write_existing(&path, b"after").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"before");
        std::fs::set_permissions(&path, original_permissions).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_preserves_private_permissions_and_rejects_symlink() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let scratch = Scratch::new();
        let source = scratch.path("private.jsonl");
        std::fs::write(&source, b"before").unwrap();
        std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o600)).unwrap();
        atomic_write_existing(&source, b"after").unwrap();
        assert_eq!(std::fs::metadata(&source).unwrap().permissions().mode() & 0o777, 0o600);
        let alias = scratch.path("alias.jsonl");
        symlink(&source, &alias).unwrap();
        assert!(atomic_write_existing(&alias, b"escape").is_err());
        assert_eq!(std::fs::read(&source).unwrap(), b"after");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn atomic_write_preserves_named_user_denial_not_only_acl_mask() {
        use std::os::fd::AsRawFd;
        use std::os::unix::fs::PermissionsExt;
        let scratch = Scratch::new();
        let path = scratch.path("acl.jsonl");
        std::fs::write(&path, b"before").unwrap();
        let file = File::open(&path).unwrap();
        // Linux POSIX ACL v2: owner rw; named user denied; group denied;
        // mask rw; other denied. chmod-only 0660 would grant group access.
        let mut acl = 2u32.to_le_bytes().to_vec();
        for (tag, permissions, id) in [(1u16, 6u16, u32::MAX), (2, 0, 12345), (4, 0, u32::MAX), (16, 6, u32::MAX), (32, 0, u32::MAX)] {
            acl.extend_from_slice(&tag.to_le_bytes());
            acl.extend_from_slice(&permissions.to_le_bytes());
            acl.extend_from_slice(&id.to_le_bytes());
        }
        assert_eq!(unsafe { libc::fsetxattr(file.as_raw_fd(), b"system.posix_acl_access\0".as_ptr().cast(), acl.as_ptr().cast(), acl.len(), 0) }, 0, "fixture filesystem must support access ACLs");
        assert_eq!(file.metadata().unwrap().permissions().mode() & 0o777, 0o660);
        let before = linux_access_acl(&file).unwrap().unwrap();
        atomic_write_existing(&path, b"after").unwrap();
        let saved = File::open(&path).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"after");
        assert_eq!(linux_access_acl(&saved).unwrap(), Some(before), "named-user/group denial must survive the displayed group mask");
        assert_eq!(saved.metadata().unwrap().permissions().mode() & 0o777, 0o660);
    }

    #[cfg(windows)]
    #[test]
    fn windows_failed_replace_keeps_original_and_recovers_backup_without_overwrite() {
        use std::os::windows::fs::OpenOptionsExt;
        let scratch = Scratch::new();
        let path = scratch.path("native.jsonl");
        let staged = scratch.path("staged.jsonl");
        std::fs::write(&path, b"original").unwrap();
        std::fs::write(&staged, b"edited").unwrap();
        let held = OpenOptions::new().read(true).share_mode(1).open(&path).unwrap();
        assert!(replace_existing(&staged, &path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        drop(held);
        let backup = scratch.path("original.bak");
        let failure = recover_windows_replacement_failure(&path, &backup, std::io::Error::from_raw_os_error(1176));
        assert!(failure.to_string().contains("1176"));
        assert_eq!(std::fs::read(&path).unwrap(), b"original", "1176 with backup retains the original filename");
        assert_eq!(std::fs::read(&staged).unwrap(), b"edited");
        assert!(!backup.exists());
        std::fs::rename(&path, &backup).unwrap();
        let failure = recover_windows_replacement_failure(&path, &backup, std::io::Error::from_raw_os_error(1177));
        assert!(failure.to_string().contains("original source restored"));
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        std::fs::write(&backup, b"preserved original").unwrap();
        let failure = recover_windows_replacement_failure(&path, &backup, std::io::Error::from_raw_os_error(1177));
        assert!(failure.to_string().contains("destination was not overwritten"));
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        assert_eq!(std::fs::read(&backup).unwrap(), b"preserved original");
        let failure = recover_windows_replacement_failure(&path, &backup, std::io::Error::from_raw_os_error(1176));
        assert!(failure.to_string().contains("destination was not overwritten"));
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        assert_eq!(std::fs::read(&backup).unwrap(), b"preserved original", "unexpected backup must never be deleted on failure");
        let absent = scratch.path("missing-parent/native.jsonl");
        let failure = recover_windows_replacement_failure(&absent, &backup, std::io::Error::from_raw_os_error(1177));
        assert!(failure.to_string().contains("restoration failed"));
        assert!(failure.to_string().contains(&backup.to_string_lossy().into_owned()));
        assert_eq!(std::fs::read(&backup).unwrap(), b"preserved original");
    }

    #[test]
    fn remote_identity_transport_and_shell_boundaries() {
        let scratch = Scratch::new();
        let db = scratch.db();
        let path = "/home/dev/.omp/agent/sessions/-fixture/2026_sid-one.jsonl";
        assert!(remote_transport(&db, Some("/unregistered"), "omp", "sid-one", path).is_err());
        assert!(remote_transport(&db, None, "omp", "sid-one", path).is_err());
        let meta = serde_json::json!({"wsl":{"host":"127.0.0.1","user":"fixture","distro":"Ubuntu","workspace":"/fixture"}});
        db.0.lock().execute("INSERT INTO workspaces(id,path,name,meta) VALUES('fixture','/registered','fixture',?1)", [meta.to_string()]).unwrap();
        let bound = remote_transport(&db, Some("/registered"), "omp", "sid-one", path).unwrap();
        assert_eq!(bound.host, "127.0.0.1");
        assert_eq!(bound.workspace.as_deref(), Some("/fixture"));
        assert!(validate_remote_path("omp", "sid-one", "/etc/escape.jsonl").is_err());
        assert!(validate_remote_path("omp", "sid-one", "/home/dev/.omp/agent/sessions/../escape.jsonl").is_err());
        assert!(remote_write_script("omp", "sid-one", path, &omp_text("sid-other", "x"), "old").is_err());
    }
}
