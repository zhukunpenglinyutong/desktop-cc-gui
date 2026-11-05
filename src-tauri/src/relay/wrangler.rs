//! Private, pinned official Node/Wrangler runtime used only for browser OAuth.
//! No shell, global install, user CLI configuration, keyring, or raw CLI logs.

use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use fs2::FileExt;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::watch;

const NODE_VERSION: &str = "22.23.4";
const WRANGLER_VERSION: &str = "4.157.0";
const OAUTH_CLIENT_ID: &str = "54d11594-84e4-41aa-b438-e81b8fa78ee7";
const OAUTH_SCOPES: [&str; 3] = ["account:read", "user:read", "workers_scripts:write"];
const READY_MARKER: &str = "node=22.23.4\nwrangler=4.157.0\n";
const MAX_DOWNLOAD: u64 = 128 * 1024 * 1024;
const MAX_EXTRACT: u64 = 512 * 1024 * 1024;
const MAX_ENTRIES: usize = 100_000;
const MAX_OUTPUT: usize = 64 * 1024;
const CANCELLED: &str = "Cloudflare 登录已取消";
const TOKEN_ERROR: &str = "无法读取本次 Cloudflare 登录授权，请重新登录";
const ARCHIVE_ERROR: &str = "Node 运行时压缩包不安全或已损坏";

/// Deliberately neither Debug nor Serialize: this token never leaves the backend.
pub(super) struct WranglerAuth {
    pub(super) token: String,
    launch: LaunchContext,
    _credentials: OwnedDirectory,
}

impl WranglerAuth {
    pub(super) async fn cleanup(mut self) {
        self.token.clear();
        logout_owned(&self.launch).await;
        // The owned directory guard removes only this run, never the tool cache.
    }
}

pub(super) async fn login(
    mut cancel: watch::Receiver<bool>,
    progress: impl Fn(&'static str),
    open_url: impl Fn(&str) -> Result<(), String> + Sync,
) -> Result<WranglerAuth, String> {
    check_cancel(&cancel)?;
    progress("preparing");
    let tools = crate::paths::app_home().join("relay-tools");
    private_dir(&tools)?;
    let tools = dunce::canonicalize(&tools).map_err(|_| "无法访问私有登录工具目录")?;
    let credentials = OwnedDirectory::create(&tools, "auth")?;
    let runtime = prepare_runtime(&tools, &credentials.path, &mut cancel).await?;
    let launch = LaunchContext::new(runtime, &credentials.path)?;
    check_cancel(&cancel)?;
    progress("authorizing");
    let result = async {
        let mut command = launch.wrangler();
        command.args(["login", "--browser=false", "--use-keyring=false", "--scopes"]);
        command.args(OAUTH_SCOPES);
        run_child(command, &mut cancel, Duration::from_secs(180), Some(&open_url)).await?;
        check_cancel(&cancel)?;
        let mut command = launch.wrangler();
        command.args(["auth", "token", "--json"]);
        let output = run_child(command, &mut cancel, Duration::from_secs(45), None).await?;
        let token = parse_oauth_token(&output)?;
        check_cancel(&cancel)?;
        Ok(token)
    }.await;
    match result {
        Ok(token) => Ok(WranglerAuth { token, launch, _credentials: credentials }),
        Err(error) => {
            // A cancel may race with the callback writing its credentials.
            logout_owned(&launch).await;
            Err(error)
        }
    }
}

async fn logout_owned(launch: &LaunchContext) {
    if !launch.root.join("home/.wrangler/config/default.toml").is_file() {
        return;
    }
    let (_keep_alive, mut cancel) = watch::channel(false);
    let mut command = launch.wrangler();
    command.arg("logout");
    if run_child(command, &mut cancel, Duration::from_secs(15), None).await.is_err() {
        // Revoke is best-effort offline; local credentials are still removed.
        eprintln!("[relay login] Temporary OAuth logout did not complete; removing local credentials");
    }
}

struct OwnedDirectory {
    path: PathBuf,
}

impl OwnedDirectory {
    fn create(parent: &Path, prefix: &str) -> Result<Self, String> {
        let path = parent.join(format!(".{prefix}-{}", uuid::Uuid::new_v4()));
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&path).map_err(|_| "无法创建私有登录目录")?;
        Ok(Self { path })
    }
}

impl Drop for OwnedDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn private_dir(path: &Path) -> Result<(), String> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(|_| "无法创建私有登录目录".into())
}

struct Runtime {
    root: PathBuf,
    node: PathBuf,
    npm: PathBuf,
    wrangler: PathBuf,
}

impl Runtime {
    fn at(root: &Path) -> Self {
        let (node, npm) = if cfg!(windows) {
            ("node/node.exe", "node/node_modules/npm/bin/npm-cli.js")
        } else {
            ("node/bin/node", "node/lib/node_modules/npm/bin/npm-cli.js")
        };
        Self {
            root: root.to_owned(),
            node: root.join(node),
            npm: root.join(npm),
            wrangler: root.join("wrangler/node_modules/wrangler/wrangler-dist/cli.js"),
        }
    }

    fn ready(&self) -> bool {
        [self.node.as_path(), self.npm.as_path(), self.wrangler.as_path()].into_iter()
            .all(|path| std::fs::symlink_metadata(path).is_ok_and(|m| m.is_file()))
            && std::fs::read(self.root.join(".ready")).is_ok_and(|m| m == READY_MARKER.as_bytes())
    }
}

struct LaunchContext {
    runtime: Runtime,
    root: PathBuf,
    env: Vec<(OsString, OsString)>,
}

impl LaunchContext {
    fn new(runtime: Runtime, root: &Path) -> Result<Self, String> {
        for directory in ["home/.wrangler", "work", "config", "cache", "data", "state", "tmp", "appdata", "localappdata", "logs"] {
            private_dir(&root.join(directory))?;
        }
        for (path, content) in [("user.npmrc", ""), ("global.npmrc", ""), ("work/.env", ""), ("work/wrangler.json", "{}"), ("work/package.json", "{\"private\":true}")] {
            std::fs::write(root.join(path), content).map_err(|_| "无法初始化私有登录配置")?;
        }
        let env = isolated_environment(std::env::vars_os(), root, runtime.node.parent().ok_or("Node 运行时路径无效")?);
        Ok(Self { runtime, root: root.to_owned(), env })
    }

    fn node(&self) -> Command {
        // These are exact verified native Node paths, never cmd/pwsh or a shell installer.
        let mut command = Command::new(&self.runtime.node);
        command.env_clear().envs(self.env.iter().map(|(k, v)| (k, v)))
            .current_dir(self.root.join("work"))
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);
        #[cfg(windows)]
        crate::engine::hide_console(&mut command);
        command
    }

    fn wrangler(&self) -> Command {
        let mut command = self.node();
        command.arg("--no-warnings").arg(&self.runtime.wrangler)
            .arg("--config").arg(self.root.join("work/wrangler.json"))
            .arg("--env-file").arg(self.root.join("work/.env"))
            .arg("--install-skills=false");
        command
    }
}

fn isolated_environment(
    inherited: impl IntoIterator<Item = (OsString, OsString)>,
    root: &Path,
    node_bin: &Path,
) -> Vec<(OsString, OsString)> {
    // An allowlist also excludes future Wrangler overrides, inherited npm auth,
    // NODE_OPTIONS/NODE_PATH, BROWSER, preload hooks, and workspace configuration.
    // Corporate proxies and CA certificates keep working without weakening TLS.
    let mut env: Vec<_> = inherited.into_iter().filter(|(key, _)| {
        matches!(key.to_string_lossy().to_ascii_uppercase().as_str(),
            "SYSTEMROOT" | "WINDIR" | "SYSTEMDRIVE" | "LANG" | "LC_ALL" | "LC_CTYPE" | "TZ"
            | "HTTP_PROXY" | "HTTPS_PROXY" | "ALL_PROXY" | "NO_PROXY"
            | "NODE_EXTRA_CA_CERTS" | "SSL_CERT_FILE" | "SSL_CERT_DIR"
            | "NPM_CONFIG_PROXY" | "NPM_CONFIG_HTTPS_PROXY" | "NPM_CONFIG_NOPROXY" | "NPM_CONFIG_CAFILE")
    }).collect();
    for (key, relative) in [
        ("HOME", "home"), ("USERPROFILE", "home"), ("APPDATA", "appdata"),
        ("LOCALAPPDATA", "localappdata"), ("XDG_CONFIG_HOME", "config"),
        ("XDG_CACHE_HOME", "cache"), ("XDG_DATA_HOME", "data"), ("XDG_STATE_HOME", "state"),
        ("TMPDIR", "tmp"), ("TMP", "tmp"), ("TEMP", "tmp"),
        ("NPM_CONFIG_USERCONFIG", "user.npmrc"), ("NPM_CONFIG_GLOBALCONFIG", "global.npmrc"),
        ("NPM_CONFIG_CACHE", "cache/npm"), ("NPM_CONFIG_PREFIX", "npm-prefix"),
        ("WRANGLER_LOG_PATH", "logs"),
    ] {
        env.push((key.into(), root.join(relative).into_os_string()));
    }
    env.push(("PATH".into(), node_bin.as_os_str().to_owned()));
    for (key, value) in [
        ("CLOUDFLARE_AUTH_USE_KEYRING", "false"), ("WRANGLER_WRITE_LOGS", "false"),
        ("WRANGLER_SEND_METRICS", "false"), ("WRANGLER_SEND_ERROR_REPORTS", "false"),
        ("WRANGLER_LOG_SANITIZE", "true"), ("WRANGLER_NO_SKILLS_UPDATE_PROMPTS", "true"),
        ("NPM_CONFIG_UPDATE_NOTIFIER", "false"), ("NPM_CONFIG_IGNORE_SCRIPTS", "true"),
        ("NPM_CONFIG_REGISTRY", "https://registry.npmjs.org/"),
        ("CI", "true"), ("NO_COLOR", "1"), ("FORCE_COLOR", "0"),
    ] {
        env.push((key.into(), value.into()));
    }
    env
}

struct NodeArchive {
    platform: &'static str,
    sha256: &'static str,
    zip: bool,
}

fn node_archive() -> Result<NodeArchive, String> {
    // Pinned from https://nodejs.org/dist/v22.23.4/SHASUMS256.txt.
    // A compromised download cannot substitute a new checksum response.
    let (platform, sha256) = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => ("win-x64", "cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20"),
        ("windows", "aarch64") => ("win-arm64", "a8b8cd79cbbb3062435f449591d98dd63730bbbf30ce2d7cc3a6376c236cb111"),
        ("macos", "x86_64") => ("darwin-x64", "efcc2b0db6f94bf53eddb038fe2b370277a042bd29e4f19b8f8e23598795b819"),
        ("macos", "aarch64") => ("darwin-arm64", "c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428"),
        ("linux", "x86_64") if cfg!(target_env = "musl") => ("linux-x64-musl", "63189402eaa222aabf51b4983e512592131cd2d4a9efc3ad9bf291fe74e3e4de"),
        ("linux", "x86_64") => ("linux-x64", "b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406"),
        ("linux", "aarch64") if !cfg!(target_env = "musl") => ("linux-arm64", "f7a1e486dbc8b286847815b477d4fb5e9fb963ed4489c3e1588853d685f589f9"),
        _ => return Err("当前系统暂不支持私有 Node 登录运行时，请使用 API Token 部署".into()),
    };
    Ok(NodeArchive { platform, sha256, zip: cfg!(windows) })
}

async fn prepare_runtime(tools: &Path, auth_root: &Path, cancel: &mut watch::Receiver<bool>) -> Result<Runtime, String> {
    let archive = node_archive()?;
    let cache = tools.join(format!("node-{NODE_VERSION}-wrangler-{WRANGLER_VERSION}-{}", archive.platform));
    let lock = OpenOptions::new().read(true).write(true).create(true).truncate(false)
        .open(tools.join(".install.lock")).map_err(|_| "无法锁定私有工具缓存")?;
    let lock_deadline = tokio::time::Instant::now() + Duration::from_secs(600);
    loop {
        check_cancel(cancel)?;
        if tokio::time::Instant::now() >= lock_deadline {
            return Err("等待私有工具缓存超时，请稍后重试".into());
        }
        match FileExt::try_lock_exclusive(&lock) {
            Ok(()) => break,
            Err(error) if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
                tokio::select! {
                    _ = cancelled(cancel) => return Err(CANCELLED.into()),
                    _ = tokio::time::sleep(Duration::from_millis(100)) => {}
                }
            }
            Err(_) => return Err("无法锁定私有工具缓存".into()),
        }
    }
    let runtime = Runtime::at(&cache);
    if runtime.ready() {
        return Ok(runtime);
    }
    if cache.exists() {
        std::fs::remove_dir_all(&cache).map_err(|_| "无法替换损坏的私有工具缓存")?;
    }
    let staging = OwnedDirectory::create(tools, "prepare")?;
    let archive_path = staging.path.join("node.archive");
    let archive_root = format!("node-v{NODE_VERSION}-{}", archive.platform);
    let extension = if archive.zip { "zip" } else { "tar.gz" };
    let url = format!("https://nodejs.org/dist/v{NODE_VERSION}/{archive_root}.{extension}");
    download_node(&url, &archive_path, archive.sha256, cancel).await?;
    let node_dir = staging.path.join("node");
    private_dir(&node_dir)?;
    let extract_cancel = cancel.clone();
    let extract_path = archive_path.clone();
    // Transfer ownership into the blocking worker: dropping the async caller
    // cannot delete a directory that extraction is still writing into.
    let staging = tokio::task::spawn_blocking(move || {
        extract_node(&extract_path, &node_dir, &archive_root, archive.zip, &extract_cancel)?;
        Ok::<_, String>(staging)
    }).await.map_err(|_| "Node 运行时解压失败")??;
    check_cancel(cancel)?;
    std::fs::remove_file(&archive_path).map_err(|_| "无法清理 Node 下载文件")?;
    let install_dir = staging.path.join("wrangler");
    private_dir(&install_dir)?;
    std::fs::write(install_dir.join("package.json"), "{\"private\":true}")
        .map_err(|_| "无法初始化 Wrangler 安装目录")?;
    let launch = LaunchContext::new(Runtime::at(&staging.path), auth_root)?;
    let mut command = launch.node();
    command.arg(&launch.runtime.npm).arg("install")
        .arg("--prefix").arg(&install_dir).current_dir(&install_dir)
        .args(["--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", "--save-exact", "--registry=https://registry.npmjs.org/"])
        .arg(format!("wrangler@{WRANGLER_VERSION}"));
    run_child(command, cancel, Duration::from_secs(300), None).await
        .map_err(|e| if e == CANCELLED { e } else { "无法安装私有 Wrangler，请检查网络或代理设置后重试".into() })?;
    if cfg!(all(windows, target_arch = "aarch64")) {
        install_windows_arm_workerd(&launch, &install_dir, cancel).await?;
    }
    let mut command = launch.wrangler();
    command.arg("--version");
    let output = run_child(command, cancel, Duration::from_secs(30), None).await?;
    if std::str::from_utf8(&output).ok().map(str::trim) != Some(WRANGLER_VERSION) {
        return Err("Wrangler 版本校验失败".into());
    }
    check_cancel(cancel)?;
    std::fs::write(staging.path.join(".ready"), READY_MARKER).map_err(|_| "无法保存私有工具缓存")?;
    // Same-filesystem rename publishes a complete version, never partial files.
    std::fs::rename(&staging.path, &cache).map_err(|_| "无法发布私有工具缓存")?;
    Ok(Runtime::at(&cache))
}

async fn install_windows_arm_workerd(
    launch: &LaunchContext,
    install_dir: &Path,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    // workerd uses its x64 binary on Windows ARM64. npm omits that optional
    // package for ARM64 Node; normally postinstall fetches it. Keep scripts off
    // and install only the exact dependency declared by the pinned package.
    const PACKAGE: &str = "@cloudflare/workerd-windows-64";
    let modules = install_dir.join("node_modules");
    let metadata: serde_json::Value = serde_json::from_slice(
        &std::fs::read(modules.join("workerd/package.json"))
            .map_err(|_| "无法读取 workerd 依赖版本")?,
    ).map_err(|_| "workerd 依赖信息无效")?;
    let version = metadata["optionalDependencies"][PACKAGE].as_str()
        .filter(|version| version.split('.').count() == 3
            && version.split('.').all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit())))
        .ok_or("workerd Windows 依赖版本无效")?;
    let staging = OwnedDirectory::create(install_dir, "workerd")?;
    std::fs::write(staging.path.join("package.json"), "{\"private\":true}")
        .map_err(|_| "无法准备 workerd Windows 依赖")?;
    let mut command = launch.node();
    command.arg(&launch.runtime.npm).arg("install")
        .arg("--prefix").arg(&staging.path).current_dir(&staging.path)
        .args(["--cpu=x64", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", "--save-exact", "--registry=https://registry.npmjs.org/"])
        .arg(format!("{PACKAGE}@{version}"));
    run_child(command, cancel, Duration::from_secs(180), None).await?;
    check_cancel(cancel)?;
    let package = staging.path.join("node_modules").join(PACKAGE);
    if !package.join("bin/workerd.exe").is_file() {
        return Err("workerd Windows 依赖缺少运行文件".into());
    }
    private_dir(&modules.join("@cloudflare"))?;
    std::fs::rename(package, modules.join(PACKAGE))
        .map_err(|_| "无法安装 workerd Windows 依赖".into())
}

async fn download_node(url: &str, path: &Path, expected: &str, cancel: &mut watch::Receiver<bool>) -> Result<(), String> {
    let download = async {
        let client = reqwest::Client::builder().https_only(true)
            .connect_timeout(Duration::from_secs(30)).timeout(Duration::from_secs(180))
            .build().map_err(|_| "无法初始化 Node 下载")?;
        let response = client.get(url).send().await.map_err(|_| "Node 下载失败，请检查网络或代理设置")?;
        if !response.status().is_success() || response.content_length().is_some_and(|n| n > MAX_DOWNLOAD) {
            return Err("Node 下载响应无效".into());
        }
        let mut output = tokio::fs::OpenOptions::new().write(true).create_new(true).open(path).await
            .map_err(|_| "无法保存 Node 下载文件")?;
        let mut stream = response.bytes_stream();
        let mut digest = Sha256::new();
        let mut size = 0u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "Node 下载中断，请重试")?;
            size += chunk.len() as u64;
            if size > MAX_DOWNLOAD {
                return Err("Node 下载文件超过安全限制".into());
            }
            digest.update(&chunk);
            output.write_all(&chunk).await.map_err(|_| "无法保存 Node 下载文件")?;
        }
        output.flush().await.map_err(|_| "无法保存 Node 下载文件")?;
        verify_digest(&digest.finalize(), expected)
    };
    tokio::select! {
        _ = cancelled(cancel) => Err(CANCELLED.into()),
        result = download => result,
    }
}

fn verify_digest(digest: &[u8], expected: &str) -> Result<(), String> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    if digest.len() != 32 || expected.len() != 64 || !digest.iter().enumerate().all(|(i, byte)| {
        expected.as_bytes()[i * 2] == HEX[(byte >> 4) as usize]
            && expected.as_bytes()[i * 2 + 1] == HEX[(byte & 15) as usize]
    }) {
        return Err("Node 下载文件 SHA-256 校验失败，请重试".into());
    }
    Ok(())
}

fn archive_relative(name: &str, root: &str) -> Result<PathBuf, String> {
    let name = name.strip_suffix('/').unwrap_or(name);
    let mut parts = name.split('/');
    if parts.next() != Some(root) {
        return Err(ARCHIVE_ERROR.into());
    }
    let mut relative = PathBuf::new();
    for part in parts {
        let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        let device = matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || base.strip_prefix("COM").or_else(|| base.strip_prefix("LPT"))
                .is_some_and(|n| n.len() == 1 && matches!(n.as_bytes()[0], b'1'..=b'9'));
        if part.is_empty() || part == "." || part == ".." || part.ends_with(['.', ' '])
            || part.chars().any(|c| c.is_control() || matches!(c, '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*')) || device {
            return Err(ARCHIVE_ERROR.into());
        }
        relative.push(part);
    }
    Ok(relative)
}

fn extract_node(path: &Path, destination: &Path, root: &str, is_zip: bool, cancel: &watch::Receiver<bool>) -> Result<(), String> {
    let file = File::open(path).map_err(|_| ARCHIVE_ERROR)?;
    let mut total = 0u64;
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    if is_zip {
        let mut archive = zip::ZipArchive::new(file).map_err(|_| ARCHIVE_ERROR)?;
        if archive.len() > MAX_ENTRIES {
            return Err(ARCHIVE_ERROR.into());
        }
        for index in 0..archive.len() {
            check_extraction(cancel, deadline)?;
            let mut entry = archive.by_index(index).map_err(|_| ARCHIVE_ERROR)?;
            let relative = archive_relative(entry.name(), root)?;
            let mode = entry.unix_mode().unwrap_or(0o600);
            if mode & 0o170000 == 0o120000 {
                // No links are materialized. Node/npm are invoked at regular-file paths.
                continue;
            }
            if entry.is_dir() {
                private_dir(&destination.join(relative))?;
            } else {
                let size = entry.size();
                total = total.checked_add(size).ok_or(ARCHIVE_ERROR)?;
                if total > MAX_EXTRACT || relative.as_os_str().is_empty() {
                    return Err(ARCHIVE_ERROR.into());
                }
                extract_file(&mut entry, &destination.join(relative), mode, size, cancel, deadline)?;
            }
        }
    } else {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(file));
        for (index, entry) in archive.entries().map_err(|_| ARCHIVE_ERROR)?.enumerate() {
            check_extraction(cancel, deadline)?;
            if index >= MAX_ENTRIES {
                return Err(ARCHIVE_ERROR.into());
            }
            let mut entry = entry.map_err(|_| ARCHIVE_ERROR)?;
            let path_bytes = entry.path_bytes();
            let relative = archive_relative(std::str::from_utf8(&path_bytes).map_err(|_| ARCHIVE_ERROR)?, root)?;
            let kind = entry.header().entry_type();
            if kind.is_symlink() || kind.is_hard_link() {
                continue;
            }
            if kind.is_dir() {
                private_dir(&destination.join(relative))?;
            } else if kind.is_file() {
                let size = entry.size();
                total = total.checked_add(size).ok_or(ARCHIVE_ERROR)?;
                if total > MAX_EXTRACT || relative.as_os_str().is_empty() {
                    return Err(ARCHIVE_ERROR.into());
                }
                let mode = entry.header().mode().map_err(|_| ARCHIVE_ERROR)?;
                extract_file(&mut entry, &destination.join(relative), mode, size, cancel, deadline)?;
            } else {
                return Err(ARCHIVE_ERROR.into());
            }
        }
    }
    Ok(())
}

fn check_extraction(cancel: &watch::Receiver<bool>, deadline: std::time::Instant) -> Result<(), String> {
    check_cancel(cancel)?;
    if std::time::Instant::now() >= deadline {
        return Err("Node 运行时解压超时".into());
    }
    Ok(())
}

fn extract_file(input: &mut impl Read, destination: &Path, mode: u32, mut remaining: u64, cancel: &watch::Receiver<bool>, deadline: std::time::Instant) -> Result<(), String> {
    check_extraction(cancel, deadline)?;
    private_dir(destination.parent().ok_or(ARCHIVE_ERROR)?)?;
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(if mode & 0o111 != 0 { 0o700 } else { 0o600 });
    }
    #[cfg(not(unix))]
    let _ = mode;
    let mut output = options.open(destination).map_err(|_| ARCHIVE_ERROR)?;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        check_extraction(cancel, deadline)?;
        let count = input.read(&mut buffer).map_err(|_| ARCHIVE_ERROR)?;
        if count == 0 {
            return if remaining == 0 { Ok(()) } else { Err(ARCHIVE_ERROR.into()) };
        }
        remaining = remaining.checked_sub(count as u64).ok_or(ARCHIVE_ERROR)?;
        output.write_all(&buffer[..count]).map_err(|_| ARCHIVE_ERROR)?;
    }
}

struct OwnedChild {
    child: Child,
    #[cfg(unix)]
    pid: u32,
    #[cfg(windows)]
    job: Option<std::sync::Arc<crate::engine::job::KillOnCloseJob>>,
}

impl OwnedChild {
    fn stop_tree(&mut self) {
        #[cfg(unix)]
        if self.pid != 0 {
            crate::engine::kill_process_group(self.pid);
            self.pid = 0;
        }
        #[cfg(windows)]
        drop(self.job.take());
    }
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        self.stop_tree();
        let _ = self.child.start_kill();
    }
}

async fn run_child(
    mut command: Command,
    cancel: &mut watch::Receiver<bool>,
    timeout: Duration,
    open_url: Option<&(dyn Fn(&str) -> Result<(), String> + Sync)>,
) -> Result<Vec<u8>, String> {
    check_cancel(cancel)?;
    let mut child = command.spawn().map_err(|_| "无法启动私有 Node/Wrangler 运行时")?;
    #[cfg(windows)]
    let job = match crate::engine::job::assign_kill_on_close(&child) {
        Some(job) => Some(job),
        None => {
            let _ = child.kill().await;
            return Err("无法为登录进程建立安全清理边界".into());
        }
    };
    let mut owned = OwnedChild {
        #[cfg(unix)]
        pid: child.id().ok_or("无法获取登录进程标识")?,
        child,
        #[cfg(windows)]
        job,
    };
    let result = async {
        let mut stdout = owned.child.stdout.take().ok_or("无法读取登录进程输出")?;
        let mut stderr = owned.child.stderr.take().ok_or("无法读取登录进程错误流")?;
        let mut out_buffer = [0u8; 8192];
        let mut err_buffer = [0u8; 8192];
        let mut output = Vec::new();
        let mut out_open = true;
        let mut err_open = true;
        let mut exit = None;
        let mut opened = false;
        let deadline = tokio::time::sleep(timeout);
        tokio::pin!(deadline);
        while exit.is_none() || out_open || err_open {
            tokio::select! {
                biased;
                _ = cancelled(cancel) => return Err(CANCELLED.into()),
                _ = &mut deadline => return Err("私有登录工具运行超时，请检查网络或关闭占用 localhost:8976 的其他登录后重试".into()),
                count = stdout.read(&mut out_buffer), if out_open => {
                    let count = count.map_err(|_| "无法读取登录进程输出")?;
                    out_open = count != 0;
                    append_capture(&mut output, &out_buffer[..count])?;
                    if !opened {
                        if let Some(open_url) = open_url {
                            if let Some(url) = authorization_url(&output)? {
                                open_url(&url).map_err(|_| "无法打开 Cloudflare 授权页面")?;
                                opened = true;
                            }
                        }
                    }
                }
                count = stderr.read(&mut err_buffer), if err_open => {
                    err_open = count.map_err(|_| "无法读取登录进程错误流")? != 0;
                    // Drain but never retain or log stderr; it can contain credentials.
                }
                status = owned.child.wait(), if exit.is_none() => {
                    exit = Some(status.map_err(|_| "无法等待登录进程退出")?);
                    owned.stop_tree();
                }
            }
        }
        if !exit.is_some_and(|status| status.success()) || (open_url.is_some() && !opened) {
            return Err("Cloudflare 登录工具未能完成操作，请检查网络、授权结果及 localhost:8976 端口后重试".into());
        }
        Ok(output)
    }.await;
    owned.stop_tree();
    let _ = owned.child.start_kill();
    let _ = tokio::time::timeout(Duration::from_secs(3), owned.child.wait()).await;
    result
}

fn append_capture(output: &mut Vec<u8>, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_OUTPUT.saturating_sub(output.len()) {
        return Err("登录工具输出超过安全限制".into());
    }
    output.extend_from_slice(bytes);
    Ok(())
}

fn authorization_url(output: &[u8]) -> Result<Option<String>, String> {
    const PREFIX: &str = "Visit this link to authenticate: ";
    let output = String::from_utf8_lossy(output);
    let Some(start) = output.find(PREFIX) else { return Ok(None); };
    let rest = &output[start + PREFIX.len()..];
    let Some(end) = rest.find('\n') else { return Ok(None); };
    let raw = rest[..end].trim();
    let url = reqwest::Url::parse(raw).map_err(|_| "Cloudflare 授权地址无效")?;
    let query: std::collections::HashMap<_, _> = url.query_pairs().collect();
    let value = |key: &str| query.get(key).map(|value| value.as_ref());
    let scopes = value("scope").unwrap_or("");
    let expected = ["account:read", "user:read", "workers_scripts:write", "offline_access"];
    let scopes_valid = scopes.split_whitespace().count() == expected.len()
        && expected.into_iter().all(|scope| scopes.split_whitespace().any(|actual| actual == scope));
    if url.scheme() != "https" || url.host_str() != Some("dash.cloudflare.com")
        || url.path() != "/oauth2/auth" || !url.username().is_empty() || url.password().is_some()
        || url.port().is_some() || url.fragment().is_some() || query.len() != 7 || url.query_pairs().count() != 7
        || value("response_type") != Some("code") || value("client_id") != Some(OAUTH_CLIENT_ID)
        || value("redirect_uri") != Some("http://localhost:8976/oauth/callback")
        || value("code_challenge_method") != Some("S256") || !scopes_valid
        || value("state").is_none_or(str::is_empty) || value("code_challenge").is_none_or(str::is_empty) {
        return Err("Cloudflare 授权地址未通过安全校验".into());
    }
    Ok(Some(url.into()))
}

fn parse_oauth_token(output: &[u8]) -> Result<String, String> {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Token {
        r#type: String,
        token: String,
    }
    let parsed: Token = serde_json::from_slice(output).map_err(|_| TOKEN_ERROR)?;
    if parsed.r#type != "oauth" || parsed.token.is_empty() || parsed.token.len() > 16 * 1024
        || !parsed.token.bytes().all(|b| b.is_ascii_graphic()) {
        return Err(TOKEN_ERROR.into());
    }
    Ok(parsed.token)
}

fn check_cancel(cancel: &watch::Receiver<bool>) -> Result<(), String> {
    if *cancel.borrow() || cancel.has_changed().is_err() {
        Err(CANCELLED.into())
    } else {
        Ok(())
    }
}

async fn cancelled(cancel: &mut watch::Receiver<bool>) {
    loop {
        if *cancel.borrow() {
            return;
        }
        if cancel.changed().await.is_err() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_environment_drops_credentials_and_code_injection_but_keeps_proxies() {
        let inherited = [
            ("CLOUDFLARE_API_TOKEN", "secret"),
            ("CF_API_KEY", "secret"),
            ("CLOUDFLARE_AUTH_USE_KEYRING", "true"),
            ("WRANGLER_AUTH_URL", "https://example.invalid"),
            ("NODE_OPTIONS", "--require=untrusted.js"),
            ("NODE_PATH", "/untrusted"),
            ("BROWSER", "untrusted"),
            ("NPM_CONFIG_USERCONFIG", "/user/.npmrc"),
            ("HOME", "/user"),
            ("PATH", "/user/bin"),
            ("https_proxy", "http://proxy.invalid:8080"),
            ("NO_PROXY", "localhost,127.0.0.1"),
            ("NODE_EXTRA_CA_CERTS", "/certs/company.pem"),
        ];
        let root = std::env::temp_dir().join("ccgui-test-private-env");
        let node_bin = root.join("node");
        let env: std::collections::HashMap<_, _> = isolated_environment(
            inherited.into_iter().map(|(k, v)| (k.into(), v.into())),
            &root,
            &node_bin,
        ).into_iter().collect();
        for key in ["CLOUDFLARE_API_TOKEN", "CF_API_KEY", "WRANGLER_AUTH_URL", "NODE_OPTIONS", "NODE_PATH", "BROWSER"] {
            assert!(!env.contains_key(std::ffi::OsStr::new(key)), "{key}");
        }
        assert_eq!(env[std::ffi::OsStr::new("https_proxy")], "http://proxy.invalid:8080");
        assert_eq!(env[std::ffi::OsStr::new("NO_PROXY")], "localhost,127.0.0.1");
        assert_eq!(env[std::ffi::OsStr::new("NODE_EXTRA_CA_CERTS")], "/certs/company.pem");
        assert_eq!(env[std::ffi::OsStr::new("HOME")].as_os_str(), root.join("home").as_os_str());
        assert_eq!(env[std::ffi::OsStr::new("USERPROFILE")].as_os_str(), root.join("home").as_os_str());
        assert_eq!(env[std::ffi::OsStr::new("PATH")].as_os_str(), node_bin.as_os_str());
        assert_eq!(env[std::ffi::OsStr::new("CLOUDFLARE_AUTH_USE_KEYRING")], "false");
        assert_eq!(env[std::ffi::OsStr::new("WRANGLER_WRITE_LOGS")], "false");
        assert_ne!(env[std::ffi::OsStr::new("NPM_CONFIG_USERCONFIG")], env[std::ffi::OsStr::new("NPM_CONFIG_GLOBALCONFIG")]);
    }

    #[test]
    fn oauth_token_parser_requires_the_official_oauth_shape() {
        assert_eq!(parse_oauth_token(br#"{"type":"oauth","token":"owned-token_123"}"#).unwrap(), "owned-token_123");
        for invalid in [
            br#"{"type":"api_token","token":"inherited-secret"}"#.as_slice(),
            br#"{"type":"api_key","key":"secret","email":"user@example.invalid"}"#,
            br#"{"type":"oauth","token":""}"#,
            br#"{"type":"oauth","token":"line\nbreak"}"#,
            br#"{"type":"oauth","token":123}"#,
            br#"not json containing secret"#,
        ] {
            assert_eq!(parse_oauth_token(invalid).unwrap_err(), TOKEN_ERROR);
        }
    }

    #[test]
    fn archive_paths_never_escape_the_expected_root_on_any_platform() {
        assert_eq!(archive_relative("node-v-test/bin/node", "node-v-test").unwrap(), PathBuf::from("bin/node"));
        assert!(archive_relative("node-v-test/", "node-v-test").unwrap().as_os_str().is_empty());
        for path in [
            "../node-v-test/bin/node", "node-v-test/../outside", "/node-v-test/bin/node",
            "node-v-test/bin/../../outside", "node-v-test/bin\\..\\outside", "node-v-test/C:/outside",
            "other/bin/node", "node-v-test//node", "node-v-test/./node", "node-v-test/bin/node:stream",
            "node-v-test/bin/CON", "node-v-test/bin/trailing.", "node-v-test/bin/trailing ",
        ] {
            assert!(archive_relative(path, "node-v-test").is_err(), "{path}");
        }
    }

    #[test]
    fn checksum_mismatch_is_rejected_before_extraction() {
        let digest = sha2::Sha256::digest(b"official archive");
        assert!(verify_digest(&digest, &format!("{digest:x}")).is_ok());
        assert!(verify_digest(&digest, &"00".repeat(32)).is_err());
    }

    fn authorization_line() -> String {
        format!("Visit this link to authenticate: https://dash.cloudflare.com/oauth2/auth?response_type=code&client_id={OAUTH_CLIENT_ID}&redirect_uri=http%3A%2F%2Flocalhost%3A8976%2Foauth%2Fcallback&scope=account%3Aread%20user%3Aread%20workers_scripts%3Awrite%20offline_access&state=state123&code_challenge=challenge123&code_challenge_method=S256\n")
    }

    #[test]
    fn authorization_url_only_opens_the_expected_cloudflare_pkce_flow() {
        let line = authorization_line();
        assert!(authorization_url(line.as_bytes()).unwrap().unwrap().starts_with("https://dash.cloudflare.com/oauth2/auth?"));
        assert!(authorization_url(b"unrelated output\n").unwrap().is_none());
        assert!(authorization_url(line.trim_end().as_bytes()).unwrap().is_none());
        for invalid in [
            line.replace("dash.cloudflare.com", "dash.cloudflare.com.evil.invalid"),
            line.replace("https://", "http://"),
            line.replace("localhost%3A8976", "example.invalid%3A8976"),
            line.replace(OAUTH_CLIENT_ID, "untrusted-client"),
            line.replace("S256", "plain"),
            line.replace("workers_scripts%3Awrite", "workers%3Awrite"),
        ] {
            assert!(authorization_url(invalid.as_bytes()).is_err());
        }
    }

    #[test]
    fn bounded_capture_refuses_unbounded_child_output() {
        let mut capture = Vec::new();
        append_capture(&mut capture, b"small").unwrap();
        assert_eq!(capture, b"small");
        assert!(append_capture(&mut capture, &vec![b'x'; MAX_OUTPUT]).is_err());
        assert!(capture.len() <= MAX_OUTPUT);
    }

    #[test]
    fn zip_extraction_rejects_traversal_without_writing_outside() {
        use std::io::Write;
        let parent = OwnedDirectory::create(&std::env::temp_dir(), "ccgui-wrangler-test").unwrap();
        let archive_path = parent.path.join("node.zip");
        let file = std::fs::File::create(&archive_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("node-test/../escaped", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(b"untrusted").unwrap();
        zip.finish().unwrap();
        let destination = parent.path.join("out");
        private_dir(&destination).unwrap();
        let (_tx, cancel) = tokio::sync::watch::channel(false);
        assert!(extract_node(&archive_path, &destination, "node-test", true, &cancel).is_err());
        assert!(!parent.path.join("escaped").exists());
    }

    #[test]
    fn extraction_rejects_a_file_larger_than_its_declared_size() {
        let directory = OwnedDirectory::create(&std::env::temp_dir(), "ccgui-wrangler-size-test").unwrap();
        let (_tx, cancel) = watch::channel(false);
        let mut input = std::io::Cursor::new(b"longer than declared");
        assert!(extract_file(
            &mut input, &directory.path.join("file"), 0o600, 1, &cancel,
            std::time::Instant::now() + Duration::from_secs(1),
        ).is_err());
    }

    #[test]
    fn cancelled_extraction_writes_no_files() {
        let directory = OwnedDirectory::create(&std::env::temp_dir(), "ccgui-wrangler-cancel-test").unwrap();
        let (_tx, cancel) = watch::channel(true);
        let mut input = std::io::Cursor::new(b"content");
        let result = extract_file(
            &mut input, &directory.path.join("file"), 0o600, 7, &cancel,
            std::time::Instant::now() + Duration::from_secs(1),
        );
        assert_eq!(result.unwrap_err(), CANCELLED);
        assert!(!directory.path.join("file").exists());
    }

    #[cfg(unix)]
    #[test]
    fn owned_session_directory_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let directory = OwnedDirectory::create(&std::env::temp_dir(), "ccgui-wrangler-mode-test").unwrap();
        assert_eq!(std::fs::metadata(&directory.path).unwrap().permissions().mode() & 0o777, 0o700);
    }

    #[test]
    fn tar_extraction_keeps_regular_files_without_materializing_links() {
        let directory = OwnedDirectory::create(&std::env::temp_dir(), "ccgui-wrangler-tar-test").unwrap();
        let archive_path = directory.path.join("node.tar.gz");
        let compressed = flate2::write::GzEncoder::new(File::create(&archive_path).unwrap(), flate2::Compression::default());
        let mut archive = tar::Builder::new(compressed);
        let mut link = tar::Header::new_gnu();
        link.set_entry_type(tar::EntryType::Symlink);
        link.set_size(0);
        link.set_mode(0o777);
        link.set_link_name("../../outside").unwrap();
        link.set_cksum();
        archive.append_data(&mut link, "node-test/link", std::io::empty()).unwrap();
        let mut regular = tar::Header::new_gnu();
        regular.set_size(4);
        regular.set_mode(0o755);
        regular.set_cksum();
        archive.append_data(&mut regular, "node-test/bin/node", &b"node"[..]).unwrap();
        archive.into_inner().unwrap().finish().unwrap();
        let destination = directory.path.join("out");
        private_dir(&destination).unwrap();
        let (_tx, cancel) = watch::channel(false);
        extract_node(&archive_path, &destination, "node-test", false, &cancel).unwrap();
        assert_eq!(std::fs::read(destination.join("bin/node")).unwrap(), b"node");
        assert!(!destination.join("link").exists());
        assert!(!directory.path.join("outside").exists());
    }
}
