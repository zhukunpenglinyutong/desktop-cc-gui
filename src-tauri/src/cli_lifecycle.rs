//! Managed-CLI lifecycle behind the CLI 管理 settings header: local version
//! probe (`<bin> --version`), npm registry latest probe, and one-click
//! install/update. Generalizes the retired dsh-only dsh_cli_version /
//! dsh_cli_update pair to every engine.
//!
//! npm installs run inside the app with streamed output. Official installer
//! scripts (claude / codex native channel) are never run as a hidden child:
//! the plan carries the exact line the dialog types into the built-in
//! terminal, where the user watches it and can interrupt it.
//!
//! Probes run on explicit request only (settings page open, refresh button)
//! — never on a timer: `npm view` is a network call and every probe spawns
//! processes, so polling would keep the machine awake for nothing.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::task::JoinHandle;
use tokio::time::timeout;

use crate::engine::{command_for_binary, resolve};
use crate::event_sink::{BroadcastEmit, EventSink, CLI_UPDATE_PROGRESS_EVENT};
use crate::AppState;

const CLI_VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const NPM_VIEW_TIMEOUT: Duration = Duration::from_secs(15);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(420);
/// Bytes of installer output quoted back in a failure error.
const ERROR_TAIL_CAP: usize = 2048;
/// Chars per streamed output line; minified progress-bar lines would
/// otherwise flood the IPC channel in one event.
const PROGRESS_LINE_CAP: usize = 1000;
/// Per-stream capture cap for run_capture/run_streaming. Callers need the
/// first line (version probes) or a failure tail — both fit in a few KB,
/// and normal npm output stays well under this. Without a cap a chatty or
/// stuck installer buffered unboundedly for up to INSTALL_TIMEOUT.
const CAPTURE_CAP_BYTES: usize = 1024 * 1024;

/// npm-distributed engines → registry package. Grok / agy ship via their own
/// installer scripts (no npm distribution), so they get a local-version probe
/// only — no latest probe and no install/update action.
fn npm_package(engine: &str) -> Option<&'static str> {
    match engine {
        "claude" => Some("@anthropic-ai/claude-code"),
        "kimi" => Some("@moonshot-ai/kimi-code"),
        "codex" => Some("@openai/codex"),
        "pi" => Some("@earendil-works/pi-coding-agent"),
        "omp" => Some("@oh-my-pi/pi-coding-agent"),
        "dsh" => Some("@deepseek-ai/dsh"),
        "opencode" => Some("opencode-ai"),
        _ => None,
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CliVersionStatus {
    pub engine: String,
    pub installed: bool,
    pub local_version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    /// How the install/update button acts: "npm" | "native"; null when the
    /// engine has no lifecycle action (grok).
    pub update_kind: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub ok: bool,
    pub version: Option<String>,
}
/// What the one-click install dialog shows before the user confirms:
/// the exact command plus a copy-paste fallback for manual runs.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliUpdatePlan {
    pub engine: String,
    /// "install" | "update"
    pub action: &'static str,
    /// "npm" | "native" | "none"
    pub kind: &'static str,
    pub command: Vec<String>,
    pub manual_command: String,
    /// Set when the run happens in the built-in terminal (official installer
    /// scripts): the exact line the app types there, completion marker
    /// included. npm runs stay in the app (`cli_update`) and leave this null.
    pub terminal_command: Option<String>,
    pub can_run: bool,
    pub blockers: Vec<String>,
    pub platform: &'static str,
}

fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

/// Claude Code / Codex ship both as npm packages and as native installer
/// builds; pushing an npm global install onto a native install would shadow
/// it with a second binary. The npm copy is either inside a node_modules tree
/// (unix: the bin symlink resolves into it) or an npm global shim sitting next
/// to one (Windows: `%APPDATA%\npm\<cli>.cmd` beside
/// `%APPDATA%\npm\node_modules\<package>`). Not installed → "native" (the
/// official installer is the default path).
fn native_or_npm_kind(engine: &str, bin: &str) -> &'static str {
    let resolved = std::fs::canonicalize(bin)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| bin.to_string());
    if resolved.contains("node_modules") || beside_npm_package(engine, bin) {
        "npm"
    } else {
        "native"
    }
}

/// `bin` is an npm global shim: its directory holds `node_modules/<package>`.
fn beside_npm_package(engine: &str, bin: &str) -> bool {
    let Some(package) = npm_package(engine) else {
        return false;
    };
    // Only an absolute shim path has a real install directory; a bare name
    // would resolve `node_modules` against the app's working directory.
    let path = std::path::Path::new(bin);
    path.is_absolute()
        && path
            .parent()
            .is_some_and(|dir| dir.join("node_modules").join(package).is_dir())
}

fn update_kind(engine: &str, bin: &str) -> Option<&'static str> {
    if engine == "claude" || engine == "codex" {
        return Some(native_or_npm_kind(engine, bin));
    }
    npm_package(engine).map(|_| "npm")
}

/// Where a planned install runs: npm installs stream inside the app's
/// dialog; the official installer scripts are typed into the built-in
/// terminal, where the user sees the command and its output and can Ctrl+C.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RunLocation {
    App,
    Terminal,
}

fn run_location(kind: &str) -> Option<RunLocation> {
    match kind {
        "npm" => Some(RunLocation::App),
        "native" => Some(RunLocation::Terminal),
        _ => None,
    }
}

pub(crate) struct CliProbe {
    pub(crate) installed: bool,
    pub(crate) version: Option<String>,
}

/// `<bin> --version`: first non-empty stdout line, 10s cap. A spawn failure
/// means not installed; a successful run with no version line still counts
/// as installed (we just have nothing to display).
pub(crate) async fn probe_local_version(bin: &str) -> CliProbe {
    let mut command = command_for_binary(bin);
    command.arg("--version");
    let output = match run_capture(&mut command, CLI_VERSION_TIMEOUT).await {
        Ok(output) => output,
        Err(_) => {
            return CliProbe {
                installed: false,
                version: None,
            }
        }
    };
    let version = output
        .stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string);
    CliProbe {
        installed: true,
        version,
    }
}

/// Latest published version: `npm view <package> version`.
async fn probe_latest_version(package: &str) -> Option<String> {
    let npm = resolve::resolve_launchable_cli_binary("npm");
    let mut command = command_for_binary(&npm);
    command.args(["view", package, "version"]);
    let output = run_capture(&mut command, NPM_VIEW_TIMEOUT).await.ok()?;
    output
        .stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn checked_engine(engine: &str) -> Result<String, String> {
    let trimmed = engine.trim();
    if crate::config::ENGINES.contains(&trimmed) {
        Ok(trimmed.to_string())
    } else {
        Err(format!("未知引擎：{engine}"))
    }
}

#[tauri::command]
pub async fn cli_version_status(engine: String) -> Result<CliVersionStatus, String> {
    let engine = checked_engine(&engine)?;
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = crate::engine::engine_bin(&settings, &engine);
    let package = npm_package(&engine);
    // Local probe and registry probe are independent — run them concurrently
    // so the header waits on the slower of the two, not the sum.
    let (local, latest) = tokio::join!(probe_local_version(&bin), async move {
        match package {
            Some(package) => probe_latest_version(package).await,
            None => None,
        }
    });
    let update_available = match (
        local.version.as_deref().and_then(parse_version),
        latest.as_deref().and_then(parse_version),
    ) {
        (Some(local), Some(latest)) => latest > local,
        _ => false,
    };
    Ok(CliVersionStatus {
        update_kind: update_kind(&engine, &bin),
        engine,
        installed: local.installed,
        local_version: local.version,
        latest_version: latest,
        update_available,
    })
}

/// Execution plan for the confirm dialog: same argv the run uses, so the
/// preview can never drift from what actually executes.
#[tauri::command]
pub async fn cli_update_plan(engine: String) -> Result<CliUpdatePlan, String> {
    let engine = checked_engine(&engine)?;
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = crate::engine::engine_bin(&settings, &engine);
    let installed = probe_local_version(&bin).await.installed;
    let kind = update_kind(&engine, &bin);
    let (command, manual_command, terminal_command, blockers) = match kind {
        Some("npm") => {
            let package = npm_package(&engine).expect("npm kind implies package");
            let (program, args) = npm_install_argv(package);
            let command: Vec<String> = std::iter::once(program).chain(args).collect();
            let manual = command.join(" ");
            (command, manual, None, Vec::new())
        }
        Some("native") => {
            let shell = shell_kind(&crate::terminal::resolve_shell_path());
            let line = native_terminal_line(&engine, shell, cfg!(windows));
            (
                vec![line.clone()],
                native_manual_command(&engine, cfg!(windows)),
                Some(line),
                Vec::new(),
            )
        }
        _ => (
            Vec::new(),
            String::new(),
            None,
            vec![format!("{engine} 不支持一键安装/更新。")],
        ),
    };
    Ok(CliUpdatePlan {
        action: if installed { "update" } else { "install" },
        kind: kind.unwrap_or("none"),
        can_run: blockers.is_empty(),
        manual_command,
        command,
        terminal_command,
        blockers,
        engine,
        platform: platform_name(),
    })
}

#[tauri::command]
pub async fn cli_update(
    engine: String,
    run_id: String,
    state: State<'_, AppState>,
) -> Result<UpdateResult, String> {
    let engine = checked_engine(&engine)?;
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = crate::engine::engine_bin(&settings, &engine);
    let reporter = ProgressReporter::new(state.emitters.clone(), run_id, engine.clone());
    let kind = update_kind(&engine, &bin).unwrap_or("none");
    match run_location(kind) {
        Some(RunLocation::App) => {
            let package = npm_package(&engine).expect("npm kind implies package");
            run_npm_install(package, &reporter).await?;
        }
        // Never run the official installer as a hidden child of the app:
        // the dialog types its terminal_command into the built-in terminal.
        Some(RunLocation::Terminal) => {
            return Err(format!(
                "{engine} 的官方安装脚本会在内置终端中运行，请在安装对话框里点「在终端中运行」。"
            ))
        }
        None => return Err(format!("{engine} 不支持一键安装/更新。")),
    }
    // Fresh local version after the install.
    let probe = probe_local_version(&bin).await;
    Ok(UpdateResult {
        ok: true,
        version: probe.version,
    })
}

/// npm global install argv, shared by the plan preview and the run so the
/// dialog always shows exactly what will execute.
fn npm_install_argv(package: &str) -> (String, Vec<String>) {
    let npm = resolve::resolve_launchable_cli_binary("npm");
    let args = vec![
        "install".to_string(),
        "-g".to_string(),
        "--maxsockets=1".to_string(),
        "--fetch-retries=5".to_string(),
        "--no-audit".to_string(),
        "--no-fund".to_string(),
        format!("{package}@latest"),
    ];
    (npm, args)
}

/// Printed after a terminal install finishes, followed by its exit code
/// (`0` = success). Mirrored in src/features/settings/cliInstallTerminal.ts;
/// the typed line itself never contains this marker followed by a digit, so
/// the echo of the command cannot be mistaken for completion.
const CLI_DONE_MARKER: &str = "__CCGUI_CLI_DONE__";

/// The shell that owns the built-in terminal, for typing a line it accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShellKind {
    Posix,
    Fish,
    PowerShell,
    Cmd,
    Other,
}

fn shell_kind(shell_path: &str) -> ShellKind {
    let name = shell_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match name.strip_suffix(".exe").unwrap_or(&name) {
        "sh" | "bash" | "zsh" | "ksh" | "dash" | "ash" => ShellKind::Posix,
        "fish" => ShellKind::Fish,
        "pwsh" | "powershell" => ShellKind::PowerShell,
        "cmd" => ShellKind::Cmd,
        _ => ShellKind::Other,
    }
}

/// Official installer script URLs: (POSIX `.sh`, Windows `.ps1`). Both
/// handle fresh installs and in-place updates; Codex's updates
/// `~/.local/bin/codex` (or `$CODEX_INSTALL_DIR`) instead of an npm copy.
fn installer_urls(engine: &str) -> (&'static str, &'static str) {
    if engine == "codex" {
        (
            "https://chatgpt.com/codex/install.sh",
            "https://chatgpt.com/codex/install.ps1",
        )
    } else {
        ("https://claude.ai/install.sh", "https://claude.ai/install.ps1")
    }
}

/// The official one-liner for copy-paste (no completion marker).
fn native_manual_command(engine: &str, windows: bool) -> String {
    let (sh, ps1) = installer_urls(engine);
    if windows {
        format!("irm {ps1} | iex")
    } else {
        format!("curl -fsSL {sh} | bash")
    }
}

/// `%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, resolved
/// here so the typed line never depends on command lookup.
fn windows_powershell_path() -> String {
    let root = std::env::var("SystemRoot")
        .ok()
        .filter(|root| !root.trim().is_empty())
        .unwrap_or_else(|| "C:\\Windows".to_string());
    format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", root.trim_end_matches('\\'))
}

/// The exact line typed into the built-in terminal: the official installer
/// for this platform, in the terminal shell's syntax, followed by a marker
/// carrying the exit code. Visible and interruptible on purpose — the old
/// hidden `powershell -ExecutionPolicy Bypass -Command "irm … | iex"` child
/// of the GUI is a download-and-execute pattern endpoint security flags.
fn native_terminal_line(engine: &str, shell: ShellKind, windows: bool) -> String {
    let (sh, ps1) = installer_urls(engine);
    let marker = CLI_DONE_MARKER;
    let ps_status = format!("\"{marker}$(if ($?) {{ 0 }} else {{ 1 }})\"");
    if windows {
        // The terminal opens in the workspace, and cmd resolves a bare name
        // from the current directory before PATH: `powershell` could run a
        // repo-planted powershell.bat. Always spell out the system binary.
        let exe = windows_powershell_path();
        let args = format!("-NoProfile -Command \"irm {ps1} | iex\"");
        let quoted_backslash = format!("\"{exe}\" {args}");
        let quoted_slash = format!("'{}' {args}", exe.replace('\\', "/"));
        // cmd expands %errorlevel% before the line runs, so branch on the
        // result instead; `^_` keeps the typed text from matching the marker.
        let cmd_marker = &marker[..marker.len() - 1];
        match shell {
            ShellKind::PowerShell => format!("irm {ps1} | iex; {ps_status}"),
            ShellKind::Cmd => format!(
                "{quoted_backslash} && echo {cmd_marker}^_0 || echo {cmd_marker}^_1"
            ),
            ShellKind::Posix => format!("{quoted_slash}; echo \"{marker}$?\""),
            ShellKind::Fish => format!("{quoted_slash}; echo \"{marker}$status\""),
            ShellKind::Other => quoted_backslash,
        }
    } else {
        let official = format!("curl -fsSL {sh} | bash");
        // pipefail in an explicit bash: a failed download must not read as
        // success (a pipe reports its last command), and the user's own
        // interactive shell options stay untouched.
        let checked = format!("bash -c 'set -o pipefail; {official}'");
        match shell {
            ShellKind::Posix => format!("{checked}; echo \"{marker}$?\""),
            ShellKind::Fish => format!("{checked}; echo \"{marker}$status\""),
            ShellKind::PowerShell => format!("{checked}; {ps_status}"),
            ShellKind::Cmd | ShellKind::Other => official,
        }
    }
}

async fn run_npm_install(package: &str, reporter: &ProgressReporter) -> Result<(), String> {
    let (npm, args) = npm_install_argv(package);
    let mut command = command_for_binary(&npm);
    command.args(&args);
    let output = run_streaming(&mut command, INSTALL_TIMEOUT, reporter)
        .await
        .map_err(|e| format!("无法运行 npm（{npm}）：{e}"))?;
    if output.timed_out {
        return Err("npm 安装超时（420 秒），请检查网络后重试。".to_string());
    }
    if !output.status.map(|s| s.success()).unwrap_or(false) {
        let combined = format!("{}\n{}", output.stdout, output.stderr);
        let tail = tail(&combined, ERROR_TAIL_CAP);
        return Err(format!(
            "npm 安装失败。{}",
            if tail.is_empty() {
                "无输出。".to_string()
            } else {
                format!("输出末尾：{tail}")
            }
        ));
    }
    Ok(())
}

// ==================== Progress streaming ====================

/// Per-run reporter: streams installer output lines to the frontend as
/// batched `cli://update-progress` events (32ms/64KB, same as terminal
/// output), so the dialog renders the install as it happens. The `run_id`
/// scopes events to one confirmed run; the frontend ignores anything else.
#[derive(Clone)]
struct ProgressReporter {
    sink: Arc<EventSink>,
    run_id: Arc<str>,
    engine: Arc<str>,
}

impl ProgressReporter {
    fn new(emitters: Arc<BroadcastEmit>, run_id: String, engine: String) -> Self {
        Self {
            sink: EventSink::with_name(emitters, CLI_UPDATE_PROGRESS_EVENT),
            run_id: run_id.into(),
            engine: engine.into(),
        }
    }

    /// phase: "started" | "stdout" | "stderr" | "finished"
    fn emit(&self, phase: &'static str, line: Option<String>, exit_ok: Option<bool>) {
        self.sink.push(serde_json::json!({
            "runId": self.run_id,
            "engine": self.engine,
            "phase": phase,
            "line": line,
            "exitOk": exit_ok,
        }));
    }

    fn flush(&self) {
        self.sink.flush();
    }
}

// ==================== Shared process helpers ====================

/// Run a short-lived command to completion with a timeout, capturing all of
/// stdout/stderr. The child gets its own process group (unix) so a timeout
/// kill takes grandchildren (npm's cmd/node chain) down too.
struct ProcOutput {
    status: Option<std::process::ExitStatus>,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

async fn run_capture(command: &mut Command, limit: Duration) -> Result<ProcOutput, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    crate::engine::hide_console(command);
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    // Kill-on-close job (Windows): the taskkill timeout path only walks a
    // live tree, so a grandchild orphaned before it ran would escape; the
    // job sweeps members whenever this guard drops — timeout or completion.
    #[cfg(windows)]
    let _tree_guard = crate::engine::job::assign_kill_on_close(&child);
    let stdout = child.stdout.take().map(spawn_read_all);
    let stderr = child.stderr.take().map(spawn_read_all);
    let (status, timed_out) = match timeout(limit, child.wait()).await {
        Ok(Ok(status)) => (Some(status), false),
        Ok(Err(e)) => return Err(e.to_string()),
        Err(_) => {
            if let Some(pid) = pid {
                crate::engine::kill_process_group(pid);
            }
            let _ = child.start_kill();
            let _ = child.wait().await;
            (None, true)
        }
    };
    // Settle sweep (unix): the group is empty on a clean exit (ESRCH); what
    // remains is a grandchild the probed CLI orphaned — kill it now.
    #[cfg(unix)]
    if let Some(pid) = pid.filter(|p| *p != 0) {
        crate::engine::kill_process_group(pid);
    }
    let stdout = match stdout {
        Some(handle) => handle.await.unwrap_or_default(),
        None => String::new(),
    };
    let stderr = match stderr {
        Some(handle) => handle.await.unwrap_or_default(),
        None => String::new(),
    };
    Ok(ProcOutput {
        status,
        stdout,
        stderr,
        timed_out,
    })
}

fn spawn_read_all<R: AsyncRead + Unpin + Send + 'static>(pipe: R) -> JoinHandle<String> {
    tokio::spawn(async move {
        // Keep the first CAPTURE_CAP_BYTES + 1 bytes, then drain the rest
        // to a sink so the child never blocks on a full pipe (same
        // pattern as plugin_caps::read_stream_capped).
        let mut taken = pipe.take((CAPTURE_CAP_BYTES + 1) as u64);
        let mut bytes = Vec::new();
        let _ = taken.read_to_end(&mut bytes).await;
        let _ = tokio::io::copy(&mut taken.into_inner(), &mut tokio::io::sink()).await;
        String::from_utf8_lossy(&bytes).into_owned()
    })
}
/// Like `run_capture`, but each output line is also pushed to the progress
/// reporter as it arrives. The full text is still captured for failure
/// tails, so error reporting is unchanged.
async fn run_streaming(
    command: &mut Command,
    limit: Duration,
    reporter: &ProgressReporter,
) -> Result<ProcOutput, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    crate::engine::hide_console(command);
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    // Same kill-on-close job rationale as run_capture above.
    #[cfg(windows)]
    let _tree_guard = crate::engine::job::assign_kill_on_close(&child);
    reporter.emit("started", None, None);
    let stdout = child
        .stdout
        .take()
        .map(|pipe| spawn_read_lines(pipe, reporter.clone(), "stdout"));
    let stderr = child
        .stderr
        .take()
        .map(|pipe| spawn_read_lines(pipe, reporter.clone(), "stderr"));
    let (status, timed_out) = match timeout(limit, child.wait()).await {
        Ok(Ok(status)) => (Some(status), false),
        Ok(Err(e)) => return Err(e.to_string()),
        Err(_) => {
            if let Some(pid) = pid {
                crate::engine::kill_process_group(pid);
            }
            let _ = child.start_kill();
            let _ = child.wait().await;
            (None, true)
        }
    };
    // Same unix settle sweep as run_capture above.
    #[cfg(unix)]
    if let Some(pid) = pid.filter(|p| *p != 0) {
        crate::engine::kill_process_group(pid);
    }
    let stdout = match stdout {
        Some(handle) => handle.await.unwrap_or_default(),
        None => String::new(),
    };
    let stderr = match stderr {
        Some(handle) => handle.await.unwrap_or_default(),
        None => String::new(),
    };
    reporter.emit("finished", None, status.map(|s| s.success()));
    reporter.flush();
    Ok(ProcOutput {
        status,
        stdout,
        stderr,
        timed_out,
    })
}

/// Read a stream line by line, reporting each line (clipped to
/// PROGRESS_LINE_CAP chars) while capturing the full text. Invalid UTF-8
/// ends the read early — captured-so-far is still returned.
fn spawn_read_lines<R: AsyncRead + Unpin + Send + 'static>(
    pipe: R,
    reporter: ProgressReporter,
    stream: &'static str,
) -> JoinHandle<String> {
    tokio::spawn(async move {
        let mut lines = tokio::io::BufReader::new(pipe).lines();
        let mut captured = String::new();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    // Capture is capped; keep draining and reporting past the cap
                    // so the child never blocks on a full pipe.
                    if captured.len() + line.len() <= CAPTURE_CAP_BYTES {
                        captured.push_str(&line);
                        captured.push('\n');
                    }
                    let clipped = if line.chars().count() > PROGRESS_LINE_CAP {
                        line.chars().take(PROGRESS_LINE_CAP).collect()
                    } else {
                        line
                    };
                    reporter.emit(stream, Some(clipped), None);
                }
                Ok(None) | Err(_) => break,
            }
        }
        captured
    })
}

/// Last `cap` bytes of `text`, on a char boundary.
fn tail(text: &str, cap: usize) -> &str {
    if text.len() <= cap {
        return text.trim();
    }
    let mut start = text.len() - cap;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    text[start..].trim()
}

// ==================== Version compare ====================

/// Semver-ish tuple from the first digit-run in the text: "v1.2.3",
/// "2.1.228 (Claude Code)", "1.2" all parse; anything without digits → None.
fn parse_version(text: &str) -> Option<(u64, u64, u64)> {
    let text = text.trim();
    let start = text.find(|c: char| c.is_ascii_digit())?;
    let mut parts = text[start..].split('.');
    let major = leading_number(parts.next()?)?;
    let minor = parts.next().and_then(leading_number).unwrap_or(0);
    let patch = parts.next().and_then(leading_number).unwrap_or(0);
    Some((major, minor, patch))
}

fn leading_number(text: &str) -> Option<u64> {
    let digits: String = text.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_extracts_first_digit_run() {
        assert_eq!(parse_version("2.1.228 (Claude Code)"), Some((2, 1, 228)));
        assert_eq!(parse_version("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("1.2"), Some((1, 2, 0)));
        assert_eq!(parse_version("no digits"), None);
    }

    #[test]
    fn npm_package_covers_every_npm_engine() {
        for engine in ["claude", "kimi", "codex", "pi", "omp", "dsh", "opencode"] {
            assert!(npm_package(engine).is_some(), "{engine} missing package");
        }
        assert_eq!(npm_package("grok"), None);
        assert_eq!(npm_package("agy"), None);
        // qodercli/qoderclicn ship via their own installer (like grok/agy):
        // no npm lifecycle.
        assert_eq!(npm_package("qoder"), None);
        assert_eq!(npm_package("qoder-cn"), None);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn run_streaming_emits_scoped_lines_then_finished() {
        use std::sync::Mutex as StdMutex;

        use crate::event_sink::Emit;

        struct Collector {
            raws: StdMutex<Vec<String>>,
        }
        impl Emit for Collector {
            fn emit_json(&self, _name: &str, raw_json: &str) {
                self.raws
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .push(raw_json.to_string());
            }
        }

        let collector = Arc::new(Collector {
            raws: StdMutex::new(Vec::new()),
        });
        let emitters = crate::event_sink::BroadcastEmit::new(collector.clone());
        let reporter = ProgressReporter::new(emitters, "run-test".to_string(), "kimi".to_string());
        let mut command = Command::new("bash");
        command.args(["-c", "printf 'out1\\nout2\\n'; printf 'err1\\n' >&2"]);

        let output = run_streaming(&mut command, Duration::from_secs(10), &reporter)
            .await
            .unwrap();

        // Captured text is unchanged from run_capture semantics.
        assert_eq!(output.stdout, "out1\nout2\n");
        assert_eq!(output.stderr, "err1\n");
        assert_eq!(output.status.map(|s| s.success()), Some(true));
        assert!(!output.timed_out);

        // The sink flushes events as JSON arrays; flatten them.
        let events: Vec<serde_json::Value> = collector
            .raws
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .flat_map(|raw| serde_json::from_str::<Vec<serde_json::Value>>(raw).unwrap())
            .collect();
        // Every event carries the run scope.
        assert!(events.iter().all(|e| e["runId"] == "run-test"));
        assert_eq!(events.first().unwrap()["phase"], "started");
        assert_eq!(events.last().unwrap()["phase"], "finished");
        assert_eq!(events.last().unwrap()["exitOk"], true);
        let lines: Vec<(&str, &str)> = events
            .iter()
            .filter(|e| e["phase"] == "stdout" || e["phase"] == "stderr")
            .map(|e| (e["phase"].as_str().unwrap(), e["line"].as_str().unwrap()))
            .collect();
        assert_eq!(
            lines,
            vec![("stdout", "out1"), ("stdout", "out2"), ("stderr", "err1")]
        );
    }

    /// Windows npm globals are `%APPDATA%\npm\<cli>.cmd` shims next to a
    /// `node_modules` tree; the shim path itself has no `node_modules` in it,
    /// so the old check pushed npm users onto the official-installer channel.
    #[test]
    fn npm_global_shims_are_the_npm_channel() {
        let root = std::env::temp_dir().join(format!("ccgui-npm-shim-{}", uuid::Uuid::new_v4()));
        let prefix = root.join("npm");
        std::fs::create_dir_all(prefix.join("node_modules/@anthropic-ai/claude-code")).unwrap();
        std::fs::create_dir_all(prefix.join("node_modules/@openai/codex")).unwrap();
        std::fs::write(prefix.join("claude.cmd"), "@echo off\r\n").unwrap();
        std::fs::write(prefix.join("codex.cmd"), "@echo off\r\n").unwrap();
        let standalone = root.join("bin");
        std::fs::create_dir_all(&standalone).unwrap();
        std::fs::write(standalone.join("claude.exe"), "").unwrap();

        let shim = |name: &str| prefix.join(name).to_string_lossy().into_owned();
        assert_eq!(update_kind("claude", &shim("claude.cmd")), Some("npm"));
        assert_eq!(update_kind("codex", &shim("codex.cmd")), Some("npm"));
        let exe = standalone.join("claude.exe").to_string_lossy().into_owned();
        assert_eq!(update_kind("claude", &exe), Some("native"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn terminal_shell_kinds_follow_the_shell_binary() {
        for (path, kind) in [
            ("/bin/zsh", ShellKind::Posix),
            ("/usr/local/bin/bash", ShellKind::Posix),
            ("C:\\Program Files\\Git\\bin\\bash.exe", ShellKind::Posix),
            ("/opt/homebrew/bin/fish", ShellKind::Fish),
            ("C:\\Windows\\System32\\cmd.exe", ShellKind::Cmd),
            ("C:\\Program Files\\PowerShell\\7\\pwsh.exe", ShellKind::PowerShell),
            ("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ShellKind::PowerShell),
            ("/usr/bin/nu", ShellKind::Other),
        ] {
            assert_eq!(shell_kind(path), kind, "{path}");
        }
    }

    /// The official installers now run where the user can see them — typed
    /// into the built-in terminal — never as a hidden `-ExecutionPolicy
    /// Bypass` PowerShell child of the GUI (a download-and-execute pattern
    /// endpoint security flags).
    #[test]
    fn native_installs_are_typed_into_the_terminal_without_bypass() {
        let done = regex::Regex::new(r"__CCGUI_CLI_DONE__\d").unwrap();
        for engine in ["claude", "codex"] {
            for (kind, windows) in [
                (ShellKind::Posix, false),
                (ShellKind::Fish, false),
                (ShellKind::PowerShell, false),
                (ShellKind::Cmd, true),
                (ShellKind::PowerShell, true),
                (ShellKind::Posix, true),
                (ShellKind::Other, false),
            ] {
                let line = native_terminal_line(engine, kind, windows);
                assert!(!line.contains("Bypass"), "{line}");
                assert!(!line.contains("ExecutionPolicy"), "{line}");
                assert!(!line.contains('\n') && !line.contains('\r'), "{line}");
                // The typed line itself must never look like a finished run.
                assert!(!done.is_match(&line), "{line}");
                let host = if engine == "codex" { "chatgpt.com/codex" } else { "claude.ai" };
                assert!(line.contains(host), "{line}");
            }
        }
        // pipefail inside an explicit bash: a failed download must not read
        // as success (the pipe's status is the last command's), and the
        // user's own interactive shell options stay untouched.
        assert_eq!(
            native_terminal_line("claude", ShellKind::Posix, false),
            "bash -c 'set -o pipefail; curl -fsSL https://claude.ai/install.sh | bash'; echo \"__CCGUI_CLI_DONE__$?\""
        );
        // The terminal opens in the workspace and cmd resolves commands from
        // the current directory first: a bare `powershell` would run a
        // repo-planted powershell.bat. Always the absolute system path.
        // SystemRoot varies in case (C:\\WINDOWS on many machines).
        let exe = windows_powershell_path();
        assert!(exe.ends_with("\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"), "{exe}");
        assert_eq!(
            native_terminal_line("claude", ShellKind::Cmd, true),
            format!("\"{exe}\" -NoProfile -Command \"irm https://claude.ai/install.ps1 | iex\" && echo __CCGUI_CLI_DONE_^_0 || echo __CCGUI_CLI_DONE_^_1")
        );
        assert_eq!(
            native_terminal_line("claude", ShellKind::Posix, true),
            format!("'{}' -NoProfile -Command \"irm https://claude.ai/install.ps1 | iex\"; echo \"__CCGUI_CLI_DONE__$?\"", exe.replace('\\', "/"))
        );
        for kind in [ShellKind::Cmd, ShellKind::Posix, ShellKind::Fish, ShellKind::Other] {
            let line = native_terminal_line("codex", kind, true);
            assert!(!line.starts_with("powershell"), "{line}");
        }
        assert_eq!(
            native_terminal_line("codex", ShellKind::PowerShell, true),
            "irm https://chatgpt.com/codex/install.ps1 | iex; \"__CCGUI_CLI_DONE__$(if ($?) { 0 } else { 1 })\""
        );
        // Unknown shells get the bare official command: no marker syntax to
        // get wrong, completion is then picked up when the tab closes.
        assert_eq!(
            native_terminal_line("claude", ShellKind::Other, false),
            "curl -fsSL https://claude.ai/install.sh | bash"
        );
    }

    /// A bare command name has no install directory: resolving
    /// `node_modules` against the app's working directory would let any
    /// folder named that way decide the channel.
    #[test]
    fn npm_shim_detection_ignores_relative_paths() {
        let base = std::path::PathBuf::from("target")
            .join(format!("npm-shim-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(base.join("node_modules").join("@anthropic-ai/claude-code")).unwrap();
        let relative = base.join("claude");
        assert!(!beside_npm_package("claude", &relative.to_string_lossy()));
        let absolute = std::fs::canonicalize(&base).unwrap().join("claude");
        assert!(beside_npm_package("claude", &absolute.to_string_lossy()));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn only_npm_runs_inside_the_app() {
        assert_eq!(run_location("npm"), Some(RunLocation::App));
        assert_eq!(run_location("native"), Some(RunLocation::Terminal));
        assert_eq!(run_location("none"), None);
    }

    #[test]
    fn update_kind_matches_distribution_channel() {
        // npm engines always update through npm, regardless of binary path.
        assert_eq!(update_kind("dsh", "/usr/local/bin/dsh"), Some("npm"));
        // grok has no lifecycle action.
        assert_eq!(update_kind("grok", "/usr/local/bin/grok"), None);
        assert_eq!(update_kind("agy", "/usr/local/bin/agy"), None);
        // claude / codex: a node_modules path means the npm distribution;
        // anything else uses the official standalone installer.
        assert_eq!(
            update_kind(
                "claude",
                "/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js"
            ),
            Some("npm")
        );
        assert_eq!(update_kind("codex", "/usr/local/bin/codex"), Some("native"));
        assert_eq!(
            update_kind(
                "codex",
                "/usr/local/lib/node_modules/@openai/codex/bin/codex.js"
            ),
            Some("npm")
        );
    }
}
