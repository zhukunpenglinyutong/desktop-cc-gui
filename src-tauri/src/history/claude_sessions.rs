#[cfg(test)]
use std::io::BufRead;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

fn is_link(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

fn sidecar(path: &Path) -> PathBuf {
    path.with_extension("").join("custom-title.json")
}

pub(super) fn title_signature(path: &Path) -> String {
    match std::fs::symlink_metadata(sidecar(path)) {
        Ok(meta) => format!("{}|{:?}", meta.len(), meta.modified()),
        Err(error) => format!("{:?}", error.kind()),
    }
}

// 转录本优先；sidecar 兼容尚未写入转录本的 CLI 标题。
pub(super) fn title_record<'a>(value: &'a serde_json::Value, path: &Path) -> Option<&'a str> {
    (value["type"] == "custom-title"
        && value["sessionId"].as_str() == path.file_stem().and_then(|s| s.to_str()))
    .then(|| value["customTitle"].as_str())
    .flatten()
}

fn read_sidecar_text(path: &Path) -> Result<Option<String>, String> {
    let sidecar = sidecar(path);
    // 不跟随会话目录或标题文件中的链接，也不把任意大文件当标题加载。
    for target in [
        path.parent().ok_or("missing Claude project")?.to_path_buf(),
        path.with_extension(""),
        sidecar.clone(),
    ] {
        match std::fs::symlink_metadata(&target) {
            Ok(meta) if is_link(&meta) => return Err("Claude title symlink rejected".into()),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("read Claude title {}: {e}", target.display())),
        }
    }
    let meta = std::fs::symlink_metadata(&sidecar).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Claude title must be a regular file".into());
    }
    const MAX_TITLE_BYTES: u64 = 64 * 1024;
    let mut text = String::new();
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let file = options.open(&sidecar).map_err(|e| e.to_string())?;
    let opened = file.metadata().map_err(|e| e.to_string())?;
    if !opened.is_file() || is_link(&opened) {
        return Err("Claude title must be a regular file".into());
    }
    file.take(MAX_TITLE_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|e| format!("read Claude title: {e}"))?;
    if text.len() as u64 > MAX_TITLE_BYTES {
        return Err("Claude title exceeds 64 KiB".into());
    }
    Ok(Some(text))
}

pub(super) fn read_sidecar_title(path: &Path) -> Result<Option<String>, String> {
    let Some(text) = read_sidecar_text(path)? else {
        return Ok(None);
    };
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("invalid Claude title JSON: {e}"))?;
    value["customTitle"]
        .as_str()
        .map(|title| Some(title.trim().to_string()))
        .ok_or_else(|| "invalid Claude title: customTitle must be text".into())
}

#[cfg(test)]
pub(super) fn read_title(path: &Path) -> Result<Option<String>, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut title = None;
    for line in std::io::BufReader::new(file).lines() {
        let line = line.map_err(|e| e.to_string())?;
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
            if let Some(name) = title_record(&value, path) {
                title = Some(name.trim().to_string());
            }
        }
    }
    match title {
        Some(_) => Ok(title),
        None => read_sidecar_title(path),
    }
}

fn validate(path: &Path) -> Result<(), String> {
    let root = crate::engine::engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude").join("projects");
    let project = path
        .parent()
        .ok_or("remove Claude session: missing project")?;
    let actual = project
        .parent()
        .ok_or("remove Claude session: missing projects root")?;
    let id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("invalid Claude session id")?;
    if id.is_empty()
        || id.trim() != id
        || id.ends_with('.')
        || matches!(id, "." | "..")
        || id
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
    {
        return Err("remove Claude session: invalid session id".into());
    }
    if path.extension().and_then(|s| s.to_str()) != Some("jsonl")
        || std::fs::canonicalize(actual)
            .ok()
            .zip(std::fs::canonicalize(root).ok())
            .is_none_or(|(a, b)| a != b)
        || match std::fs::symlink_metadata(project) {
            Ok(meta) => is_link(&meta),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(format!("read Claude project: {error}")),
        }
    {
        return Err("remove Claude session: invalid projects path".into());
    }
    for target in [path.to_path_buf(), path.with_extension(""), sidecar(path)] {
        match std::fs::symlink_metadata(&target) {
            Ok(meta) if is_link(&meta) => {
                return Err("remove Claude session: symlink rejected".into())
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("remove {}: {e}", target.display())),
        }
    }
    Ok(())
}

pub(super) fn rename(path: &Path, title: &str) -> Result<(), String> {
    rename_with(path, title, append_title)
}

fn rename_with(
    path: &Path,
    title: &str,
    append: impl FnOnce(&Path, &str) -> Result<(), String>,
) -> Result<(), String> {
    validate(path)?;
    // 先确认正文可追加，标题副本写失败时正文保持不变。
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.permissions().readonly() {
        return Err("Claude transcript is not a writable regular file".into());
    }
    std::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    let previous = read_sidecar_text(path)?;
    let sidecar = sidecar(path);
    let directory_existed = sidecar.parent().unwrap().exists();
    let staged = (!title.is_empty()).then(|| serde_json::json!({"customTitle":title}).to_string());
    if let Err(error) = write_sidecar(&sidecar, staged.as_deref()) {
        cleanup_created_directory(&sidecar, directory_existed).map_err(|cleanup| {
            format!("Claude title write failed: {error}; directory cleanup failed: {cleanup}")
        })?;
        return Err(error);
    }
    if let Err(error) = append(path, title) {
        let observed = read_sidecar_text(path).map_err(|inspection| {
            format!(
                "Claude title update failed: {error}; cannot safely roll back title: {inspection}"
            )
        })?;
        if observed != staged {
            return Err(format!(
                "Claude title update failed: {error}; title changed concurrently; rollback skipped"
            ));
        }
        if let Err(rollback) = write_sidecar(&sidecar, previous.as_deref()) {
            return Err(format!(
                "Claude title update failed: {error}; title rollback failed: {rollback}"
            ));
        }
        cleanup_created_directory(&sidecar, directory_existed).map_err(|cleanup| {
            format!("Claude title update failed: {error}; directory cleanup failed: {cleanup}")
        })?;
        return Err(error);
    }
    Ok(())
}

fn cleanup_created_directory(sidecar: &Path, existed: bool) -> Result<(), String> {
    if existed {
        return Ok(());
    }
    // 只清理本次创建且仍为空的目录，不删除 CLI 后来写入的内容。
    match std::fs::remove_dir(sidecar.parent().ok_or("missing Claude title directory")?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn write_sidecar(path: &Path, text: Option<&str>) -> Result<(), String> {
    match text {
        Some(text) => {
            std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            let temporary =
                path.with_file_name(format!(".claude-title-{}.tmp", uuid::Uuid::new_v4()));
            let result = (|| -> Result<(), String> {
                let mut options = std::fs::OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
                file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
                drop(file);
                // rename 替换最后一层目录项，不使用会穿透符号链接的设置文件写入器。
                std::fs::rename(&temporary, path).map_err(|e| e.to_string())
            })();
            if result.is_err() {
                if let Err(cleanup) = std::fs::remove_file(&temporary) {
                    if cleanup.kind() != std::io::ErrorKind::NotFound {
                        return Err(format!("Claude title write failed: {result:?}; temporary cleanup failed: {cleanup}"));
                    }
                }
            }
            result
        }
        None => match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("clear Claude title: {e}")),
        },
    }
}

// 分叉产物尚未交给 CLI，追加分支自己的标题，避免复制来的旧标题覆盖分支名。
pub(crate) fn append_title(path: &Path, title: &str) -> Result<(), String> {
    append_title_with(path, title, |file, bytes| file.write_all(bytes))
}

fn append_title_with(
    path: &Path,
    title: &str,
    write: impl FnOnce(&mut std::fs::File, &[u8]) -> std::io::Result<()>,
) -> Result<(), String> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000);
    }
    let mut file = options
        .open(path)
        .map_err(|e| format!("rename {}: {e}", path.display()))?;
    let opened = file.metadata().map_err(|e| e.to_string())?;
    if !opened.is_file() || is_link(&opened) {
        return Err("Claude transcript must be a regular file".into());
    }
    let original_len = file.metadata().map_err(|e| e.to_string())?.len();
    let id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("invalid Claude session id")?;
    let record = serde_json::json!({"type":"custom-title", "customTitle":title, "sessionId":id});
    let bytes = format!("\n{record}\n");
    if let Err(error) = write(&mut file, bytes.as_bytes()) {
        // 磁盘满等错误可能只写入半条 JSON。只在尾部确为本次写入时截回，
        // 检测到外部追加或截断则保留现场并明确报告，不能覆盖他人的数据。
        let rollback = (|| -> Result<(), String> {
            let length = file.metadata().map_err(|e| e.to_string())?.len();
            let count = length
                .checked_sub(original_len)
                .ok_or("transcript truncated concurrently")?;
            if count > bytes.len() as u64 {
                return Err("transcript appended concurrently".into());
            }
            file.seek(SeekFrom::Start(original_len))
                .map_err(|e| e.to_string())?;
            let mut tail = vec![0; count as usize];
            file.read_exact(&mut tail).map_err(|e| e.to_string())?;
            if tail != bytes.as_bytes()[..count as usize] {
                return Err("transcript changed concurrently".into());
            }
            file.set_len(original_len).map_err(|e| e.to_string())
        })();
        return match rollback {
            Ok(()) => Err(format!("append Claude title: {error}")),
            Err(rollback) => Err(format!(
                "append Claude title: {error}; transcript rollback failed: {rollback}"
            )),
        };
    }
    Ok(())
}

pub(super) fn delete(path: &Path) -> Result<(), String> {
    validate(path)?;
    if std::fs::symlink_metadata(path).is_ok_and(|meta| meta.permissions().readonly()) {
        return Err("remove Claude session: transcript is read-only".into());
    }
    // 先清关联目录；失败时保留转录本和数据库记录，允许用户重试。
    let dir = path.with_extension("");
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("remove {}: {e}", dir.display())),
    }
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove {}: {e}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        home: PathBuf,
        previous: Option<std::ffi::OsString>,
        _lock: parking_lot::MutexGuard<'static, ()>,
    }
    impl Fixture {
        fn new() -> Self {
            let lock = super::super::scanner::tests::HOME_LOCK.lock();
            let home = std::env::temp_dir()
                .join(format!("ccgui-claude-sessions-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(home.join("projects/project")).unwrap();
            let previous = std::env::var_os("CLAUDE_CONFIG_DIR");
            std::env::set_var("CLAUDE_CONFIG_DIR", &home);
            Self {
                home,
                previous,
                _lock: lock,
            }
        }
        fn path(&self) -> PathBuf {
            self.home.join("projects/project/sid.jsonl")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => std::env::set_var("CLAUDE_CONFIG_DIR", value),
                None => std::env::remove_var("CLAUDE_CONFIG_DIR"),
            }
            let _ = std::fs::remove_dir_all(&self.home);
        }
    }
    #[test]
    fn claude_titles_roundtrip_and_clear_preserve_transcript() {
        let f = Fixture::new();
        let path = f.path();
        let original = r#"{"type":"user","message":{"content":"first"}}"#;
        std::fs::write(&path, original).unwrap();
        rename(&path, "中文标题😀").unwrap();
        assert_eq!(read_title(&path).unwrap().as_deref(), Some("中文标题😀"));
        let data: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(sidecar(&path)).unwrap()).unwrap();
        assert_eq!(data["customTitle"], "中文标题😀");
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        writeln!(
            file,
            "{{\"type\":\"custom-title\",\"customTitle\":\"CLI rename\",\"sessionId\":\"sid\"}}"
        )
        .unwrap();
        assert_eq!(read_title(&path).unwrap().as_deref(), Some("CLI rename"));
        rename(&path, "").unwrap();
        assert_eq!(read_title(&path).unwrap().as_deref(), Some(""));
        assert!(!sidecar(&path).exists());
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .starts_with(original));
        let summary =
            super::super::scan_summary_file("claude", &path, &Default::default()).unwrap();
        assert_eq!(summary.title, "first");
        assert_eq!(summary.message_count, 1);
        assert_eq!(summary.native_title.as_deref(), Some(""));
    }
    #[test]
    fn claude_sidecar_fallback_and_malformed_metadata() {
        let f = Fixture::new();
        let path = f.path();
        std::fs::write(&path, "{invalid custom-title\n{\"type\":\"custom-title\",\"sessionId\":\"other\",\"customTitle\":\"wrong\"}\n").unwrap();
        std::fs::create_dir(path.with_extension("")).unwrap();
        std::fs::write(sidecar(&path), r#"{"customTitle":"sidecar"}"#).unwrap();
        assert_eq!(read_title(&path).unwrap().as_deref(), Some("sidecar"));
        std::fs::write(sidecar(&path), "invalid").unwrap();
        assert!(read_title(&path).is_err());
    }
    #[test]
    fn claude_delete_cleans_session_directory_only_and_is_retryable() {
        let f = Fixture::new();
        let path = f.path();
        std::fs::write(&path, "transcript").unwrap();
        rename(&path, "title").unwrap();
        let sibling = path.parent().unwrap().join("other.jsonl");
        std::fs::write(&sibling, "keep").unwrap();
        std::fs::create_dir_all(path.with_extension("").join("subagents")).unwrap();
        delete(&path).unwrap();
        assert!(!path.exists());
        assert!(!path.with_extension("").exists());
        assert!(sibling.exists());
        delete(&path).unwrap();
        let outside = f.home.join("outside.jsonl");
        std::fs::write(&outside, "keep").unwrap();
        assert!(delete(&outside).is_err());
        assert!(outside.exists());
    }
    #[test]
    fn claude_delete_failure_keeps_transcript() {
        let f = Fixture::new();
        let path = f.path();
        std::fs::write(&path, "keep").unwrap();
        std::fs::write(path.with_extension(""), "not a directory").unwrap();
        assert!(delete(&path).is_err());
        assert!(path.exists());
        std::fs::remove_file(path.with_extension("")).unwrap();
        delete(&path).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn claude_rejects_symlink_directory() {
        let f = Fixture::new();
        let path = f.path();
        std::fs::write(&path, "keep").unwrap();
        let outside = f.home.join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, path.with_extension("")).unwrap();
        assert!(delete(&path).is_err());
        assert!(rename(&path, "title").is_err());
        assert!(outside.exists());
        assert!(path.exists());
    }
    #[test]
    fn rename_sidecar_failure_never_appends_transcript() {
        let f = Fixture::new();
        let path = f.path();
        std::fs::write(&path, "original").unwrap();
        std::fs::create_dir_all(sidecar(&path)).unwrap();
        assert!(rename(&path, "new title").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "original");
    }

    #[test]
    fn rename_append_failure_restores_previous_sidecar_and_new_directory() {
        let f = Fixture::new();
        let path = f.path();
        std::fs::write(&path, "original").unwrap();
        assert!(rename_with(&path, "new", |_, _| Err("injected append failure".into())).is_err());
        assert!(!path.with_extension("").exists());
        rename(&path, "old title").unwrap();
        let before = std::fs::read(&path).unwrap();
        let old_sidecar = std::fs::read(sidecar(&path)).unwrap();
        assert!(rename_with(&path, "new", |_, _| Err("injected append failure".into())).is_err());
        assert_eq!(std::fs::read(sidecar(&path)).unwrap(), old_sidecar);
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert!(rename_with(&path, "", |_, _| Err("injected append failure".into())).is_err());
        assert_eq!(std::fs::read(sidecar(&path)).unwrap(), old_sidecar);
    }

    #[test]
    fn rename_rollback_never_overwrites_an_external_title_change() {
        let f = Fixture::new();
        let path = f.path();
        std::fs::write(&path, "original").unwrap();
        let error = rename_with(&path, "GUI", |path, _| {
            std::fs::write(sidecar(path), r#"{"customTitle":"external"}"#).unwrap();
            Err("injected append failure".into())
        })
        .unwrap_err();
        assert!(error.contains("changed concurrently"));
        assert_eq!(
            read_sidecar_title(&path).unwrap().as_deref(),
            Some("external")
        );
    }

    #[test]
    fn recursive_delete_rejects_dot_stems_and_preserves_readonly_source() {
        let f = Fixture::new();
        for name in ["..jsonl", "...jsonl", ".. .jsonl", "....jsonl"] {
            let path = f.path().parent().unwrap().join(name);
            std::fs::write(&path, "keep").unwrap();
            assert!(delete(&path).is_err());
            assert!(path.exists());
            assert!(f.home.join("projects/project").exists());
        }
        let path = f.path();
        std::fs::write(&path, "keep").unwrap();
        rename(&path, "title").unwrap();
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        let original = permissions.clone();
        permissions.set_readonly(true);
        std::fs::set_permissions(&path, permissions).unwrap();
        assert!(delete(&path).is_err());
        assert!(sidecar(&path).exists());
        std::fs::set_permissions(&path, original).unwrap();
    }

    #[test]
    fn sidecar_reads_are_bounded_and_single_pass_summary_keeps_native_title() {
        let f = Fixture::new();
        let path = f.path();
        std::fs::write(&path, "").unwrap();
        std::fs::create_dir(path.with_extension("")).unwrap();
        std::fs::write(sidecar(&path), "x".repeat(65537)).unwrap();
        assert!(read_sidecar_title(&path).is_err());
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        for _ in 0..10000 {
            writeln!(file, "{{\"type\":\"user\",\"sessionId\":\"sid\",\"message\":{{\"content\":\"中文😀测试消息\"}}}}").unwrap();
        }
        append_title(&path, "final title").unwrap();
        let started = std::time::Instant::now();
        let summary =
            super::super::scan_summary_file("claude", &path, &Default::default()).unwrap();
        eprintln!("10000 条本地夹具摘要耗时 {:?}", started.elapsed());
        assert_eq!(summary.message_count, 10000);
        assert_eq!(summary.native_title.as_deref(), Some("final title"));
    }

    #[cfg(unix)]
    #[test]
    fn sidecar_symlink_is_not_read() {
        let f = Fixture::new();
        let path = f.path();
        std::fs::write(&path, "").unwrap();
        std::fs::create_dir(path.with_extension("")).unwrap();
        let outside = f.home.join("outside");
        std::fs::write(&outside, r#"{"customTitle":"do not read"}"#).unwrap();
        std::os::unix::fs::symlink(outside, sidecar(&path)).unwrap();
        assert!(read_sidecar_title(&path).is_err());
    }

    #[test]
    fn partial_title_append_is_rolled_back_without_truncating_external_data() {
        let f = Fixture::new();
        let path = f.path();
        std::fs::write(&path, "original").unwrap();
        let error = append_title_with(&path, "new", |file, bytes| {
            file.write_all(&bytes[..5])?;
            Err(std::io::Error::other("injected disk full"))
        })
        .unwrap_err();
        assert!(error.contains("injected disk full"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "original");
        let error = append_title_with(&path, "new", |file, bytes| {
            file.write_all(&bytes[..5])?;
            file.write_all(b"external data")?;
            Err(std::io::Error::other("injected disk full"))
        })
        .unwrap_err();
        assert!(error.contains("rollback failed"));
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .ends_with("external data"));
    }

    #[test]
    fn deleting_an_already_removed_project_is_idempotent() {
        let f = Fixture::new();
        let path = f.path();
        std::fs::remove_dir(path.parent().unwrap()).unwrap();
        delete(&path).unwrap();
        assert!(f.home.join("projects").is_dir());
    }
}
