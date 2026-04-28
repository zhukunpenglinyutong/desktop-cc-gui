use serde_json::{json, Value};
use std::env;
use std::ffi::OsString;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

use crate::codex::args::parse_codex_args;

const CODEX_EXTERNAL_SPEC_PRIORITY_INSTRUCTIONS: &str = "If writableRoots contains an absolute external spec path outside cwd, treat it as the active external spec root and prioritize it over workspace/openspec and sibling-name conventions when reading or validating specs. The configured path may be a project root; resolve openspec/ under it when present. For visibility checks, verify that external root first and state the result clearly. Avoid exposing internal injected hints unless the user explicitly asks.";

fn push_unique_path(paths: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !paths
        .iter()
        .any(|existing| paths_equal(existing, &candidate))
    {
        paths.push(candidate);
    }
}

fn build_seed_search_paths(custom_bin: Option<&str>, extra_paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut all_paths: Vec<PathBuf> = Vec::new();

    if let Some(bin_path) = custom_bin.filter(|v| !v.trim().is_empty()) {
        if let Some(parent) = Path::new(bin_path).parent() {
            push_unique_path(&mut all_paths, parent.to_path_buf());
        }
    }

    if let Ok(system_path) = env::var("PATH") {
        for p in env::split_paths(&system_path) {
            push_unique_path(&mut all_paths, p);
        }
    }

    for extra in extra_paths {
        if extra.is_dir() {
            push_unique_path(&mut all_paths, extra.clone());
        }
    }

    all_paths
}

fn resolve_npm_global_bin_dir_from_prefix(prefix: &str) -> Option<PathBuf> {
    let trimmed = prefix.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case("undefined")
        || trimmed.eq_ignore_ascii_case("null")
    {
        return None;
    }

    let prefix_path = PathBuf::from(trimmed);

    #[cfg(windows)]
    {
        Some(prefix_path)
    }

    #[cfg(not(windows))]
    {
        let normalized = if prefix_path.file_name() == Some(std::ffi::OsStr::new("bin")) {
            prefix_path
        } else {
            prefix_path.join("bin")
        };
        Some(normalized)
    }
}

fn discover_npm_global_bin_dir_from_npm(
    seed_paths: &[PathBuf],
    npm_bin_override: Option<&Path>,
) -> Option<PathBuf> {
    let joined_paths = env::join_paths(seed_paths.iter()).ok()?;
    let cwd = env::current_dir().ok()?;
    let npm_bin = npm_bin_override.map(PathBuf::from).or_else(|| {
        which::which_in("npm", Some(&joined_paths), &cwd)
            .ok()
            .or_else(|| which::which("npm").ok())
    })?;

    let mut command = build_std_command_for_binary(&npm_bin);
    command.env("PATH", &joined_paths);
    command.arg("config");
    command.arg("get");
    command.arg("prefix");
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::null());

    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    resolve_npm_global_bin_dir_from_prefix(stdout.as_ref())
}

fn build_std_command_for_binary(bin: &Path) -> std::process::Command {
    #[cfg(windows)]
    {
        let bin_lower = bin.to_string_lossy().to_ascii_lowercase();
        if bin_lower.ends_with(".cmd") || bin_lower.ends_with(".bat") {
            let mut command = crate::utils::std_command("cmd");
            command.arg("/c");
            command.arg(bin);
            return command;
        }
    }

    crate::utils::std_command(bin)
}

fn discover_npm_global_bin_dir(seed_paths: &[PathBuf]) -> Option<PathBuf> {
    if let Some(env_prefix) = env::var_os("NPM_CONFIG_PREFIX")
        .and_then(|value| value.into_string().ok())
        .and_then(|value| resolve_npm_global_bin_dir_from_prefix(&value))
    {
        return Some(env_prefix);
    }

    discover_npm_global_bin_dir_from_npm(seed_paths, None)
}

/// Build extra search paths for CLI tools (cross-platform)
fn get_extra_search_paths() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        // Windows-specific paths
        // Use APPDATA directly (most reliable for npm global)
        if let Ok(appdata) = env::var("APPDATA") {
            paths.push(Path::new(&appdata).join("npm"));
        }
        if let Ok(user_profile) = env::var("USERPROFILE") {
            let user_profile = Path::new(&user_profile);
            // Fallback: npm global install path via USERPROFILE
            paths.push(user_profile.join("AppData\\Roaming\\npm"));
            // Cargo bin
            paths.push(user_profile.join(".cargo\\bin"));
            // Bun
            paths.push(user_profile.join(".bun\\bin"));
            // fnm (Fast Node Manager)
            let fnm_root = user_profile.join("AppData\\Local\\fnm\\node-versions");
            if let Ok(entries) = std::fs::read_dir(&fnm_root) {
                for entry in entries.flatten() {
                    let bin_path = entry.path().join("installation");
                    if bin_path.is_dir() {
                        paths.push(bin_path);
                    }
                }
            }
            // nvm-windows
            let nvm_root = user_profile.join("AppData\\Roaming\\nvm");
            if let Ok(entries) = std::fs::read_dir(&nvm_root) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir()
                        && path
                            .file_name()
                            .map_or(false, |n| n.to_string_lossy().starts_with('v'))
                    {
                        paths.push(path);
                    }
                }
            }
        }
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            let local_app_data = Path::new(&local_app_data);
            // Volta
            paths.push(local_app_data.join("Volta\\bin"));
            // pnpm
            paths.push(local_app_data.join("pnpm"));
            // User-scoped Node.js installs (common on Windows when not installed to Program Files)
            let programs_root = local_app_data.join("Programs");
            if programs_root.is_dir() {
                paths.push(programs_root.join("nodejs"));
                if let Ok(entries) = std::fs::read_dir(&programs_root) {
                    for entry in entries.flatten() {
                        let candidate = entry.path();
                        if !candidate.is_dir() {
                            continue;
                        }
                        let folder_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                        if folder_name == "nodejs"
                            || folder_name.starts_with("node-v")
                            || folder_name.starts_with("nodejs-v")
                        {
                            paths.push(candidate);
                        }
                    }
                }
            }
        }
        if let Ok(program_files) = env::var("ProgramFiles") {
            paths.push(Path::new(&program_files).join("nodejs"));
        }
        if let Ok(program_files_x86) = env::var("ProgramFiles(x86)") {
            paths.push(Path::new(&program_files_x86).join("nodejs"));
        }
    }

    #[cfg(not(windows))]
    {
        // Unix-specific paths (macOS/Linux)
        paths.extend(vec![
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
            PathBuf::from("/usr/sbin"),
            PathBuf::from("/sbin"),
        ]);
        if let Ok(home) = env::var("HOME") {
            let home = Path::new(&home);
            paths.push(home.join(".local/bin"));
            paths.push(home.join(".local/share/mise/shims"));
            paths.push(home.join(".cargo/bin"));
            paths.push(home.join(".bun/bin"));
            paths.push(home.join(".volta/bin"));
            // nvm
            let nvm_root = home.join(".nvm/versions/node");
            if let Ok(entries) = std::fs::read_dir(nvm_root) {
                for entry in entries.flatten() {
                    let bin_path = entry.path().join("bin");
                    if bin_path.is_dir() {
                        paths.push(bin_path);
                    }
                }
            }
        }
    }

    let seed_paths = build_seed_search_paths(None, &paths);
    if let Some(npm_global_bin) = discover_npm_global_bin_dir(&seed_paths) {
        push_unique_path(&mut paths, npm_global_bin);
    }

    paths
}

/// Build combined search paths (system PATH + extra paths)
fn build_search_paths(custom_bin: Option<&str>) -> OsString {
    let all_paths = build_seed_search_paths(custom_bin, &get_extra_search_paths());
    env::join_paths(all_paths).unwrap_or_else(|_| OsString::from(""))
}

/// Compare paths (case-insensitive on Windows)
fn paths_equal(a: &Path, b: &Path) -> bool {
    #[cfg(windows)]
    {
        a.to_string_lossy()
            .eq_ignore_ascii_case(&b.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

/// Find a CLI binary using the `which` crate with extended search paths
/// On Windows, also directly checks for .cmd files in common locations
pub fn find_cli_binary(name: &str, custom_bin: Option<&str>) -> Option<PathBuf> {
    // If custom binary is specified, check if it exists
    if let Some(bin) = custom_bin.filter(|v| !v.trim().is_empty()) {
        let bin_path = Path::new(bin);
        if bin_path.exists() {
            #[cfg(windows)]
            {
                return Some(prefer_windows_executable_variant(bin_path.to_path_buf()));
            }
            #[cfg(not(windows))]
            {
                return Some(bin_path.to_path_buf());
            }
        }
    }

    // On Windows, directly check for .cmd files in known locations first
    // This is more reliable than relying on PATH/PATHEXT
    #[cfg(windows)]
    {
        let extensions = ["cmd", "exe", "bat", "com"];
        for search_path in get_extra_search_paths() {
            // Try with various extensions
            for ext in &extensions {
                let cmd_path = search_path.join(format!("{}.{}", name, ext));
                if cmd_path.exists() {
                    return Some(cmd_path);
                }
            }
        }
    }

    // Build extended search paths for which crate
    let search_paths = build_search_paths(custom_bin);

    // Use which crate to find the binary
    if let Some(cwd) = std::env::current_dir().ok() {
        if let Ok(found) = which::which_in(name, Some(&search_paths), &cwd) {
            #[cfg(windows)]
            {
                return Some(prefer_windows_executable_variant(found));
            }
            return Some(found);
        }
    }

    // Fallback: try standard which (uses system PATH only)
    #[cfg(windows)]
    {
        return which::which(name)
            .ok()
            .map(prefer_windows_executable_variant);
    }
    #[cfg(not(windows))]
    {
        which::which(name).ok()
    }
}

fn matching_custom_bin<'a>(custom_bin: Option<&'a str>, cli_name: &str) -> Option<&'a str> {
    let candidate = custom_bin?.trim();
    if candidate.is_empty() {
        return None;
    }

    let path = Path::new(candidate);
    let file_stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(candidate);

    if file_stem.eq_ignore_ascii_case(cli_name) {
        Some(candidate)
    } else {
        None
    }
}

#[cfg(windows)]
fn prefer_windows_executable_variant(path: PathBuf) -> PathBuf {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    if matches!(
        ext.as_deref(),
        Some("cmd") | Some("exe") | Some("bat") | Some("com")
    ) {
        return path;
    }

    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return path;
    };
    let Some(parent) = path.parent() else {
        return path;
    };

    for preferred_ext in ["cmd", "exe", "bat", "com"] {
        let candidate = parent.join(format!("{file_name}.{preferred_ext}"));
        if candidate.exists() {
            return candidate;
        }
    }

    path
}

pub(crate) fn build_codex_path_env(codex_bin: Option<&str>) -> Option<String> {
    let paths = build_search_paths(codex_bin);
    let path_str = paths.to_string_lossy().to_string();
    if path_str.is_empty() {
        None
    } else {
        Some(path_str)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct CodexLaunchContext {
    pub(crate) resolved_bin: String,
    pub(crate) wrapper_kind: &'static str,
    pub(crate) path_env: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct CodexAppServerProbeStatus {
    pub(crate) ok: bool,
    pub(crate) status: String,
    pub(crate) details: Option<String>,
    pub(crate) fallback_retried: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CodexAppServerLaunchOptions {
    pub(crate) hide_console: bool,
    pub(crate) inject_internal_spec_hint: bool,
}

impl CodexAppServerLaunchOptions {
    pub(crate) fn primary() -> Self {
        Self {
            hide_console: true,
            inject_internal_spec_hint: true,
        }
    }

    pub(crate) fn wrapper_compatibility_retry() -> Self {
        Self {
            hide_console: !wrapper_visible_console_retry_requested(),
            inject_internal_spec_hint: false,
        }
    }
}

fn resolve_codex_binary(codex_bin: Option<&str>) -> String {
    if let Some(custom) = codex_bin {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    find_cli_binary("codex", None)
        .or_else(|| find_cli_binary("claude", None))
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "codex".to_string())
}

pub(crate) fn resolve_codex_launch_context(codex_bin: Option<&str>) -> CodexLaunchContext {
    let resolved_bin = resolve_codex_binary(codex_bin);
    CodexLaunchContext {
        wrapper_kind: wrapper_kind_for_binary(&resolved_bin),
        path_env: build_codex_path_env(codex_bin),
        resolved_bin,
    }
}

pub(crate) fn wrapper_kind_for_binary(bin: &str) -> &'static str {
    let normalized = bin.trim().to_ascii_lowercase();
    if normalized.ends_with(".cmd") {
        "cmd-wrapper"
    } else if normalized.ends_with(".bat") {
        "bat-wrapper"
    } else {
        "direct"
    }
}

#[allow(dead_code)]
pub(crate) fn launch_context_uses_command_wrapper(launch_context: &CodexLaunchContext) -> bool {
    launch_context.wrapper_kind != "direct"
}

fn codex_args_contain_instruction_override(args: &[String]) -> bool {
    let mut iter = args.iter().peekable();
    while let Some(arg) = iter.next() {
        if arg.starts_with("developer_instructions=") || arg.starts_with("instructions=") {
            return true;
        }
        if let Some(value) = arg.strip_prefix("--config=") {
            let key = value.split('=').next().unwrap_or_default().trim();
            if key == "developer_instructions" || key == "instructions" {
                return true;
            }
        }
        if arg == "-c" || arg == "--config" {
            if let Some(next) = iter.peek() {
                let key = next.split('=').next().unwrap_or_default().trim();
                if key == "developer_instructions" || key == "instructions" {
                    return true;
                }
            }
        }
    }
    false
}

#[allow(dead_code)]
pub(crate) fn codex_args_override_instructions(codex_args: Option<&str>) -> bool {
    let Ok(args) = parse_codex_args(codex_args) else {
        return false;
    };
    codex_args_contain_instruction_override(&args)
}

fn encode_toml_string(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");
    format!("\"{escaped}\"")
}

pub(crate) fn codex_external_spec_priority_config_arg() -> String {
    format!(
        "developer_instructions={}",
        encode_toml_string(CODEX_EXTERNAL_SPEC_PRIORITY_INSTRUCTIONS)
    )
}

pub(crate) fn build_codex_app_server_args(
    codex_args: Option<&str>,
    options: CodexAppServerLaunchOptions,
) -> Result<Vec<String>, String> {
    let mut args = parse_codex_args(codex_args)?;
    if options.inject_internal_spec_hint && !codex_args_contain_instruction_override(&args) {
        args.push("-c".to_string());
        args.push(codex_external_spec_priority_config_arg());
    }
    args.push("app-server".to_string());
    Ok(args)
}

pub(crate) fn apply_codex_app_server_args(
    command: &mut Command,
    codex_args: Option<&str>,
    options: CodexAppServerLaunchOptions,
) -> Result<(), String> {
    command.args(build_codex_app_server_args(codex_args, options)?);
    Ok(())
}

#[cfg(windows)]
fn proxy_env_snapshot() -> serde_json::Map<String, Value> {
    [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "no_proxy",
    ]
    .into_iter()
    .map(|key| (key.to_string(), json!(env::var(key).ok())))
    .collect()
}

#[cfg(not(windows))]
fn proxy_env_snapshot() -> serde_json::Map<String, Value> {
    serde_json::Map::new()
}

/// Get debug information for CLI detection (useful for troubleshooting on Windows)
pub fn get_cli_debug_info(custom_bin: Option<&str>) -> serde_json::Value {
    let mut debug = serde_json::Map::new();
    let launch_context = resolve_codex_launch_context(custom_bin);

    // Platform info
    debug.insert("platform".to_string(), json!(std::env::consts::OS));
    debug.insert("arch".to_string(), json!(std::env::consts::ARCH));
    debug.insert(
        "resolvedBinaryPath".to_string(),
        json!(launch_context.resolved_bin),
    );
    debug.insert(
        "wrapperKind".to_string(),
        json!(launch_context.wrapper_kind),
    );
    debug.insert("pathEnvUsed".to_string(), json!(launch_context.path_env));
    debug.insert(
        "proxyEnvSnapshot".to_string(),
        Value::Object(proxy_env_snapshot()),
    );

    // Environment variables (Windows-specific)
    let env_vars: Vec<(&str, Option<String>)> = vec![
        ("PATH", env::var("PATH").ok()),
        ("USERPROFILE", env::var("USERPROFILE").ok()),
        ("APPDATA", env::var("APPDATA").ok()),
        ("LOCALAPPDATA", env::var("LOCALAPPDATA").ok()),
        ("ProgramFiles", env::var("ProgramFiles").ok()),
        ("HOME", env::var("HOME").ok()),
    ];
    let env_info: serde_json::Map<String, serde_json::Value> = env_vars
        .into_iter()
        .map(|(k, v)| (k.to_string(), json!(v)))
        .collect();
    debug.insert("envVars".to_string(), json!(env_info));

    // Extra search paths and their existence
    let extra_paths = get_extra_search_paths();
    let extra_paths_info: Vec<serde_json::Value> = extra_paths
        .iter()
        .map(|p| {
            // Also check if CLI files exist in this path
            let codex_cmd = p.join("codex.cmd");
            let claude_cmd = p.join("claude.cmd");
            json!({
                "path": p.to_string_lossy(),
                "exists": p.exists(),
                "isDir": p.is_dir(),
                "hasCodexCmd": codex_cmd.exists(),
                "hasClaudeCmd": claude_cmd.exists()
            })
        })
        .collect();
    debug.insert("extraSearchPaths".to_string(), json!(extra_paths_info));

    // Try to find claude and codex binaries
    let claude_found = find_cli_binary("claude", matching_custom_bin(custom_bin, "claude"));
    let codex_found = find_cli_binary("codex", matching_custom_bin(custom_bin, "codex"));
    debug.insert(
        "claudeFound".to_string(),
        json!(claude_found.map(|p| p.to_string_lossy().to_string())),
    );
    debug.insert(
        "codexFound".to_string(),
        json!(codex_found.map(|p| p.to_string_lossy().to_string())),
    );

    // Also try standard which without extra paths
    let claude_standard = which::which("claude").ok();
    let codex_standard = which::which("codex").ok();
    debug.insert(
        "claudeStandardWhich".to_string(),
        json!(claude_standard.map(|p| p.to_string_lossy().to_string())),
    );
    debug.insert(
        "codexStandardWhich".to_string(),
        json!(codex_standard.map(|p| p.to_string_lossy().to_string())),
    );

    // Custom binary info
    debug.insert("customBin".to_string(), json!(custom_bin));

    // Combined search paths
    let search_paths = build_search_paths(custom_bin);
    debug.insert(
        "combinedSearchPaths".to_string(),
        json!(search_paths.to_string_lossy()),
    );

    serde_json::Value::Object(debug)
}

/// Build a command that correctly handles .cmd files on Windows.
/// Uses CREATE_NO_WINDOW to prevent visible console windows.
pub fn build_command_for_binary_with_console(bin: &str, hide_console: bool) -> Command {
    #[cfg(windows)]
    {
        // On Windows, .cmd files need to be run through cmd.exe
        let bin_lower = bin.to_lowercase();
        if bin_lower.ends_with(".cmd") || bin_lower.ends_with(".bat") {
            let mut cmd = crate::utils::async_command_with_console_visibility("cmd", hide_console);
            cmd.arg("/c");
            cmd.arg(bin);
            return cmd;
        }
    }
    crate::utils::async_command_with_console_visibility(bin, hide_console)
}

pub fn build_command_for_binary(bin: &str) -> Command {
    build_command_for_binary_with_console(bin, true)
}

pub(crate) fn build_codex_command_from_launch_context(
    launch_context: &CodexLaunchContext,
    hide_console: bool,
) -> Command {
    let mut command =
        build_command_for_binary_with_console(&launch_context.resolved_bin, hide_console);
    if let Some(path_env) = &launch_context.path_env {
        command.env("PATH", path_env);
    }
    command
}

pub(crate) fn build_codex_command_with_bin(codex_bin: Option<String>) -> Command {
    let launch_context = resolve_codex_launch_context(codex_bin.as_deref());
    build_codex_command_from_launch_context(&launch_context, true)
}

/// Check if a specific CLI binary is available and return its version
pub(crate) async fn check_cli_binary(
    bin: &str,
    path_env: Option<String>,
) -> Result<Option<String>, String> {
    async fn run_cli_version_check_once(
        launch_context: &CodexLaunchContext,
        hide_console: bool,
    ) -> Result<Option<String>, String> {
        let mut command =
            build_command_for_binary_with_console(&launch_context.resolved_bin, hide_console);
        if let Some(path) = &launch_context.path_env {
            command.env("PATH", path);
        }
        command.arg("--version");
        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::piped());

        let output = match timeout(Duration::from_secs(5), command.output()).await {
            Ok(result) => match result {
                Ok(out) => out,
                Err(e) => {
                    if e.kind() == ErrorKind::NotFound {
                        return Err("not_found".to_string());
                    }
                    return Err(e.to_string());
                }
            },
            Err(_) => {
                return Err("timeout".to_string());
            }
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let detail = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            if detail.is_empty() {
                return Err("failed".to_string());
            }
            return Err(format!("failed: {detail}"));
        }

        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(if version.is_empty() {
            None
        } else {
            Some(version)
        })
    }

    async fn run_cli_help_check_once(
        launch_context: &CodexLaunchContext,
        hide_console: bool,
    ) -> Result<(), String> {
        let mut command =
            build_command_for_binary_with_console(&launch_context.resolved_bin, hide_console);
        if let Some(path) = &launch_context.path_env {
            command.env("PATH", path);
        }
        command.arg("--help");
        command.stdout(std::process::Stdio::null());
        command.stderr(std::process::Stdio::null());

        let output = match timeout(Duration::from_secs(5), command.output()).await {
            Ok(result) => match result {
                Ok(out) => out,
                Err(e) => {
                    if e.kind() == ErrorKind::NotFound {
                        return Err("not_found".to_string());
                    }
                    return Err(e.to_string());
                }
            },
            Err(_) => return Err("timeout".to_string()),
        };

        if output.status.success() {
            Ok(())
        } else {
            Err("failed".to_string())
        }
    }

    async fn run_cli_help_check(launch_context: &CodexLaunchContext) -> Result<(), String> {
        match run_cli_help_check_once(launch_context, true).await {
            Ok(()) => Ok(()),
            Err(primary_error) => {
                if !can_retry_wrapper_launch(launch_context) {
                    return Err(primary_error);
                }
                run_cli_help_check_once(launch_context, false)
                    .await
                    .map_err(|retry_error| {
                        format!(
                            "Primary wrapper launch failed: {primary_error}\nFallback retry failed: {retry_error}"
                        )
                    })
            }
        }
    }

    let mut launch_context = resolve_codex_launch_context(Some(bin));
    launch_context.path_env = path_env;

    match run_cli_version_check_once(&launch_context, true).await {
        Ok(version) => Ok(version),
        Err(primary_error) => {
            let version_retry_result = if can_retry_wrapper_launch(&launch_context) {
                run_cli_version_check_once(&launch_context, false)
                    .await
                    .map_err(|retry_error| {
                        format!(
                            "Primary wrapper launch failed: {primary_error}\nFallback retry failed: {retry_error}"
                        )
                    })
            } else {
                Err(primary_error)
            };

            match version_retry_result {
                Ok(version) => Ok(version),
                Err(version_error) => match run_cli_help_check(&launch_context).await {
                    Ok(()) => Ok(None),
                    Err(_) => Err(version_error),
                },
            }
        }
    }
}

#[allow(dead_code)]
pub(crate) fn visible_console_fallback_enabled_from_env(value: Option<&str>) -> bool {
    matches!(value, Some("1") | Some("true"))
}

fn wrapper_visible_console_retry_requested() -> bool {
    visible_console_fallback_enabled_from_env(env::var("CODEMOSS_SHOW_CONSOLE").ok().as_deref())
}

#[cfg(windows)]
fn allow_wrapper_visible_console_fallback() -> bool {
    wrapper_visible_console_retry_requested()
}

#[cfg(windows)]
pub(crate) fn can_retry_wrapper_launch(launch_context: &CodexLaunchContext) -> bool {
    launch_context_uses_command_wrapper(launch_context) && allow_wrapper_visible_console_fallback()
}

#[cfg(not(windows))]
pub(crate) fn can_retry_wrapper_launch(_launch_context: &CodexLaunchContext) -> bool {
    false
}

#[cfg(windows)]
pub(crate) fn can_retry_wrapper_compatibility_launch(launch_context: &CodexLaunchContext) -> bool {
    launch_context_uses_command_wrapper(launch_context)
}

#[cfg(not(windows))]
pub(crate) fn can_retry_wrapper_compatibility_launch(_launch_context: &CodexLaunchContext) -> bool {
    false
}

async fn run_codex_app_server_probe_once(
    launch_context: &CodexLaunchContext,
    codex_args: Option<&str>,
    options: CodexAppServerLaunchOptions,
) -> Result<(), String> {
    let mut command = build_codex_command_from_launch_context(launch_context, options.hide_console);
    apply_codex_app_server_args(&mut command, codex_args, options)?;
    command.arg("--help");
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    let output = match timeout(Duration::from_secs(5), command.output()).await {
        Ok(result) => result.map_err(|err| err.to_string())?,
        Err(_) => {
            return Err("Timed out while checking `codex app-server --help`.".to_string());
        }
    };

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    if detail.is_empty() {
        Err("`codex app-server --help` exited with a non-zero status.".to_string())
    } else {
        Err(detail.to_string())
    }
}

pub(crate) async fn probe_codex_app_server(
    codex_bin: Option<String>,
    codex_args: Option<&str>,
) -> Result<CodexAppServerProbeStatus, String> {
    let launch_context = resolve_codex_launch_context(codex_bin.as_deref());
    match run_codex_app_server_probe_once(
        &launch_context,
        codex_args,
        CodexAppServerLaunchOptions::primary(),
    )
    .await
    {
        Ok(()) => Ok(CodexAppServerProbeStatus {
            ok: true,
            status: "ok".to_string(),
            details: None,
            fallback_retried: false,
        }),
        Err(primary_error) => {
            if !can_retry_wrapper_compatibility_launch(&launch_context) {
                return Ok(CodexAppServerProbeStatus {
                    ok: false,
                    status: "failed".to_string(),
                    details: Some(primary_error),
                    fallback_retried: false,
                });
            }

            match run_codex_app_server_probe_once(
                &launch_context,
                codex_args,
                CodexAppServerLaunchOptions::wrapper_compatibility_retry(),
            )
            .await
            {
                Ok(()) => Ok(CodexAppServerProbeStatus {
                    ok: true,
                    status: "fallback-ok".to_string(),
                    details: Some(primary_error),
                    fallback_retried: true,
                }),
                Err(retry_error) => Ok(CodexAppServerProbeStatus {
                    ok: false,
                    status: "fallback-failed".to_string(),
                    details: Some(format!(
                        "Primary wrapper launch failed: {primary_error}\nFallback retry failed: {retry_error}"
                    )),
                    fallback_retried: true,
                }),
            }
        }
    }
}

pub(crate) async fn check_codex_installation(
    codex_bin: Option<String>,
) -> Result<Option<String>, String> {
    let path_env = build_codex_path_env(codex_bin.as_deref());

    // If user specified a custom binary path, use it directly
    if let Some(ref bin) = codex_bin {
        if !bin.trim().is_empty() {
            return match check_cli_binary(bin, path_env).await {
                Ok(version) => Ok(version),
                Err(e) if e == "not_found" => Err(format!(
                    "CLI not found at '{}'. Please check the path is correct.",
                    bin
                )),
                Err(e) if e == "timeout" => Err(format!(
                    "Timed out while checking CLI at '{}'. Make sure it runs in Terminal.",
                    bin
                )),
                Err(e) if e == "failed" => Err(format!(
                    "CLI at '{}' failed to start. Try running it in Terminal.",
                    bin
                )),
                Err(e) => Err(format!("CLI at '{}' failed: {}", bin, e)),
            };
        }
    }

    // Try to find Codex CLI first using our enhanced search (supports app-server)
    if let Some(codex_path) = find_cli_binary("codex", None) {
        let codex_bin = codex_path.to_string_lossy().to_string();
        if let Ok(version) = check_cli_binary(&codex_bin, path_env.clone()).await {
            return Ok(version);
        }
    }

    // Try Claude Code CLI as fallback using our enhanced search
    if let Some(claude_path) = find_cli_binary("claude", None) {
        let claude_bin = claude_path.to_string_lossy().to_string();
        if let Ok(version) = check_cli_binary(&claude_bin, path_env.clone()).await {
            return Ok(version);
        }
    }

    // Last resort: try simple command names (relies on PATH)
    let codex_result = check_cli_binary("codex", path_env.clone()).await;
    if let Ok(version) = codex_result {
        return Ok(version);
    }

    let claude_result = check_cli_binary("claude", path_env).await;
    if let Ok(version) = claude_result {
        return Ok(version);
    }

    // Both CLIs not found - return helpful error message
    Err(
        "CLI_NOT_FOUND: Neither Claude Code CLI nor Codex CLI was found. Please install one of them:\n\
         - Claude Code: npm install -g @anthropic-ai/claude-code\n\
         - Codex: npm install -g @openai/codex"
            .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn npm_prefix_resolution_uses_bin_on_unix() {
        #[cfg(not(windows))]
        {
            let resolved =
                resolve_npm_global_bin_dir_from_prefix("/Users/demo/.npm-global").unwrap();
            assert_eq!(resolved, PathBuf::from("/Users/demo/.npm-global/bin"));
        }
    }

    #[test]
    fn npm_prefix_resolution_ignores_empty_values() {
        assert!(resolve_npm_global_bin_dir_from_prefix("").is_none());
        assert!(resolve_npm_global_bin_dir_from_prefix("undefined").is_none());
        assert!(resolve_npm_global_bin_dir_from_prefix("null").is_none());
    }

    #[test]
    fn launch_context_uses_command_wrapper_only_for_cmd_or_bat() {
        let direct = CodexLaunchContext {
            resolved_bin: "codex".to_string(),
            wrapper_kind: wrapper_kind_for_binary("codex"),
            path_env: None,
        };
        let cmd_wrapper = CodexLaunchContext {
            resolved_bin: "C:/Users/demo/AppData/Roaming/npm/codex.cmd".to_string(),
            wrapper_kind: wrapper_kind_for_binary("C:/Users/demo/AppData/Roaming/npm/codex.cmd"),
            path_env: None,
        };
        let bat_wrapper = CodexLaunchContext {
            resolved_bin: "C:/tools/codex.bat".to_string(),
            wrapper_kind: wrapper_kind_for_binary("C:/tools/codex.bat"),
            path_env: None,
        };

        assert!(!launch_context_uses_command_wrapper(&direct));
        assert!(launch_context_uses_command_wrapper(&cmd_wrapper));
        assert!(launch_context_uses_command_wrapper(&bat_wrapper));
    }

    #[test]
    fn wrapper_compatibility_retry_is_platform_gated() {
        let direct = CodexLaunchContext {
            resolved_bin: "codex".to_string(),
            wrapper_kind: wrapper_kind_for_binary("codex"),
            path_env: None,
        };
        let cmd_wrapper = CodexLaunchContext {
            resolved_bin: "C:/Users/demo/AppData/Roaming/npm/codex.cmd".to_string(),
            wrapper_kind: wrapper_kind_for_binary("C:/Users/demo/AppData/Roaming/npm/codex.cmd"),
            path_env: None,
        };

        assert!(!can_retry_wrapper_compatibility_launch(&direct));
        #[cfg(windows)]
        assert!(can_retry_wrapper_compatibility_launch(&cmd_wrapper));
        #[cfg(not(windows))]
        assert!(!can_retry_wrapper_compatibility_launch(&cmd_wrapper));
    }

    #[test]
    fn app_server_primary_args_append_internal_spec_hint() {
        let args = build_codex_app_server_args(
            Some("--profile work"),
            CodexAppServerLaunchOptions::primary(),
        )
        .expect("build args");

        assert_eq!(args.first().map(String::as_str), Some("--profile"));
        assert_eq!(args.get(1).map(String::as_str), Some("work"));
        assert!(args.iter().any(|arg| arg == "-c"));
        assert!(args.iter().any(|arg| {
            arg.starts_with("developer_instructions=\"") && arg.contains("writableRoots")
        }));
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[test]
    fn app_server_primary_args_respect_user_instruction_override() {
        let args = build_codex_app_server_args(
            Some(r#"-c developer_instructions="follow workspace policy""#),
            CodexAppServerLaunchOptions::primary(),
        )
        .expect("build args");

        assert_eq!(args.iter().filter(|arg| arg.as_str() == "-c").count(), 1);
        assert!(!args.iter().any(|arg| arg.contains("writableRoots")));
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[test]
    fn app_server_wrapper_retry_args_skip_internal_spec_hint_but_keep_user_args() {
        let args = build_codex_app_server_args(
            Some("--profile work --sandbox read-only"),
            CodexAppServerLaunchOptions::wrapper_compatibility_retry(),
        )
        .expect("build args");

        assert_eq!(
            args,
            vec![
                "--profile".to_string(),
                "work".to_string(),
                "--sandbox".to_string(),
                "read-only".to_string(),
                "app-server".to_string(),
            ]
        );
    }

    #[cfg(unix)]
    fn write_unix_test_cli(script_body: &str) -> PathBuf {
        let unique = format!(
            "ccgui-cli-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let dir = env::temp_dir().join(unique);
        fs::create_dir_all(&dir).expect("create temp cli dir");
        let script_path = dir.join("codex-test-cli");
        fs::write(&script_path, script_body).expect("write temp cli script");
        let mut permissions = fs::metadata(&script_path)
            .expect("stat temp cli script")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script_path, permissions).expect("chmod temp cli script");
        script_path
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn check_cli_binary_accepts_help_fallback_when_version_fails() {
        let script_path = write_unix_test_cli(
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo 'broken version' >&2\n  exit 1\nfi\nif [ \"$1\" = \"--help\" ]; then\n  echo 'usage'\n  exit 0\nfi\nexit 1\n",
        );

        let result = check_cli_binary(script_path.to_string_lossy().as_ref(), None).await;
        assert_eq!(result.expect("help fallback should pass"), None);

        let _ = fs::remove_file(&script_path);
        let _ = fs::remove_dir_all(script_path.parent().unwrap_or(Path::new("")));
    }

    #[test]
    fn matching_custom_bin_only_applies_to_same_cli_name() {
        assert_eq!(
            matching_custom_bin(Some("/tmp/codex.cmd"), "codex"),
            Some("/tmp/codex.cmd")
        );
        assert_eq!(matching_custom_bin(Some("/tmp/codex.cmd"), "claude"), None);
        assert_eq!(
            matching_custom_bin(Some("/tmp/Claude"), "claude"),
            Some("/tmp/Claude")
        );
        assert_eq!(matching_custom_bin(Some(""), "claude"), None);
    }

    #[cfg(unix)]
    #[test]
    fn discover_npm_global_bin_dir_from_npm_uses_reported_prefix_and_finds_codex() {
        let unique = format!(
            "ccgui-npm-prefix-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let root = env::temp_dir().join(unique);
        let fake_npm = root.join("npm");
        let prefix_dir = root.join("custom-prefix");
        let prefix_bin = prefix_dir.join("bin");
        let codex_path = prefix_bin.join("codex");

        fs::create_dir_all(&prefix_bin).expect("create prefix/bin");

        {
            let mut npm_file = fs::File::create(&fake_npm).expect("create fake npm");
            writeln!(
                npm_file,
                "#!/bin/sh\nif [ \"$1\" = \"config\" ] && [ \"$2\" = \"get\" ] && [ \"$3\" = \"prefix\" ]; then\n  printf '{}\\n'\n  exit 0\nfi\nexit 1",
                prefix_dir.to_string_lossy()
            )
            .expect("write fake npm");
        }

        {
            let mut codex_file = fs::File::create(&codex_path).expect("create fake codex");
            writeln!(codex_file, "#!/bin/sh\nexit 0").expect("write fake codex");
        }

        for path in [&fake_npm, &codex_path] {
            let mut permissions = fs::metadata(path)
                .expect("stat fake executable")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).expect("chmod fake executable");
        }

        let resolved = discover_npm_global_bin_dir_from_npm(&[], Some(fake_npm.as_path()))
            .expect("resolve npm prefix");
        assert_eq!(resolved, prefix_bin);

        let joined_paths = env::join_paths([resolved.clone()]).expect("join search paths");
        let cwd = env::current_dir().expect("current dir");
        let found = which::which_in("codex", Some(&joined_paths), &cwd).expect("find codex");
        assert_eq!(found, codex_path);

        let _ = fs::remove_file(&fake_npm);
        let _ = fs::remove_file(&codex_path);
        let _ = fs::remove_dir_all(&root);
    }
}
