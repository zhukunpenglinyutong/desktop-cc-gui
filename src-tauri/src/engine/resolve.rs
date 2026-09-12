//! CLI binary resolution and spawnable-command construction.
//!
//! Ported from the reference desktop-cc-gui's `backend/app_server_cli.rs`,
//! trimmed to the engine-spawn use case. Three Windows realities drive the
//! design:
//!
//! - A GUI process inherits the registry PATH snapshot, which often predates
//!   the user's Node/npm install (or misses nvm/fnm/scoop shims entirely), so
//!   `which` alone can't find npm-global CLIs. We probe a list of well-known
//!   install dirs plus `npm config get prefix`.
//! - npm global bins ship three files: an extensionless POSIX shim, a `.cmd`
//!   wrapper, and a `.ps1` wrapper. CreateProcess matches the exact filename
//!   before PATHEXT and cannot run batch files, so `Command::new("claude")`
//!   or a path to the shim fails with os error 193. We prefer the `.cmd`
//!   variant and wrap batch files in `cmd /c` (`.ps1` in `powershell -File`).
//! - macOS has neither problem (the shim is a real shebang script, and
//!   `adopt_login_shell_path` fixes PATH), so the Unix side stays a thin
//!   pass-through.

use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};

use tokio::process::Command;

/// `npm config get prefix` probing is a blocking spawn; a process-level cache
/// (30s TTL) keeps repeated detection rounds from re-probing. Worst-case
/// staleness after a fresh CLI install is one TTL.
const RESOLUTION_CACHE_TTL: Duration = Duration::from_secs(30);

static EXTRA_SEARCH_PATHS_CACHE: StdMutex<Option<(Vec<PathBuf>, Instant)>> = StdMutex::new(None);

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| paths_equal(existing, &path)) {
        paths.push(path);
    }
}

/// Compare paths (case-insensitive on Windows).
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

// ── npm global prefix discovery ─────────────────────────────────────────────

/// npm's global bin dir from a `npm config get prefix` value: the prefix
/// itself on Windows, `<prefix>/bin` on Unix.
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

/// std-Command flavour of the batch wrapper, for the blocking npm probe.
fn build_std_command_for_binary(bin: &Path) -> std::process::Command {
    #[cfg(windows)]
    if let Some((program, leading)) = windows_wrapper(&bin.to_string_lossy()) {
        let mut command = std::process::Command::new(program);
        command.args(leading);
        return command;
    }
    std::process::Command::new(bin)
}

fn discover_npm_global_bin_dir(seed_paths: &[PathBuf]) -> Option<PathBuf> {
    let joined_paths = std::env::join_paths(seed_paths.iter()).ok()?;
    let cwd = std::env::current_dir().ok()?;
    let npm_bin = which::which_in("npm", Some(&joined_paths), &cwd)
        .ok()
        .or_else(|| which::which("npm").ok())?;

    let mut command = build_std_command_for_binary(&npm_bin);
    command.env("PATH", &joined_paths);
    command.args(["config", "get", "prefix"]);
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    resolve_npm_global_bin_dir_from_prefix(stdout.as_ref())
}

// ── extra search paths ──────────────────────────────────────────────────────

/// Well-known CLI install locations on Windows. GUI processes frequently hold
/// a stale PATH, so these are checked directly instead of trusting the env.
#[cfg(any(windows, test))]
fn build_windows_extra_search_paths(
    appdata: Option<&Path>,
    user_profile: Option<&Path>,
    local_app_data: Option<&Path>,
    program_files: Option<&Path>,
    program_files_x86: Option<&Path>,
) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();

    if let Some(appdata) = appdata {
        // npm -g default prefix on Windows (%APPDATA%\npm).
        paths.push(appdata.join("npm"));
    }
    if let Some(user_profile) = user_profile {
        // Fallback: npm global install path via USERPROFILE.
        paths.push(user_profile.join("AppData\\Roaming\\npm"));
        paths.push(user_profile.join(".local\\bin"));
        paths.push(user_profile.join(".codex-cli\\bin"));
        paths.push(user_profile.join(".local\\share\\mise\\shims"));
        // Hermes ships dsh as a Node-global bin, same layout as ~/.hermes/node/bin.
        paths.push(user_profile.join(".hermes\\node"));
        paths.push(user_profile.join(".hermes\\node\\bin"));
        paths.push(user_profile.join(".omp\\bin"));
        paths.push(user_profile.join(".cargo\\bin"));
        paths.push(user_profile.join(".bun\\bin"));
        // Scoop shims + the active Node prefix (npm -g often lands here).
        paths.push(user_profile.join("scoop\\shims"));
        paths.push(user_profile.join("scoop\\apps\\nodejs\\current"));
        paths.push(user_profile.join("scoop\\apps\\nodejs-lts\\current"));
        paths.push(user_profile.join("scoop\\persist\\nodejs"));
        paths.push(user_profile.join("scoop\\persist\\nodejs\\bin"));
        // fnm (Fast Node Manager).
        let fnm_root = user_profile.join("AppData\\Local\\fnm\\node-versions");
        if let Ok(entries) = std::fs::read_dir(&fnm_root) {
            for entry in entries.flatten() {
                let bin_path = entry.path().join("installation");
                if bin_path.is_dir() {
                    paths.push(bin_path);
                }
            }
        }
        // nvm-windows.
        let nvm_root = user_profile.join("AppData\\Roaming\\nvm");
        if let Ok(entries) = std::fs::read_dir(&nvm_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir()
                    && path
                        .file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with('v'))
                {
                    paths.push(path);
                }
            }
        }
    }
    if let Some(local_app_data) = local_app_data {
        paths.push(local_app_data.join("Volta\\bin"));
        paths.push(local_app_data.join("pnpm"));
        paths.push(local_app_data.join("mise\\shims"));
        let fnm_multishells = local_app_data.join("fnm_multishells");
        if let Ok(entries) = std::fs::read_dir(&fnm_multishells) {
            for entry in entries.flatten() {
                let candidate = entry.path();
                if candidate.is_dir() {
                    paths.push(candidate);
                }
            }
        }
        // User-scoped Node.js installs (common when not installed to Program Files).
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
    if let Some(program_files) = program_files {
        paths.push(program_files.join("nodejs"));
    }
    if let Some(program_files_x86) = program_files_x86 {
        paths.push(program_files_x86.join("nodejs"));
    }

    paths
}

/// Well-known CLI install locations on Unix. `adopt_login_shell_path` already
/// imports the login shell's PATH; these are the static fallbacks for
/// detection paths that run before/independent of it.
#[cfg(not(windows))]
fn build_unix_extra_search_paths() -> Vec<PathBuf> {
    let mut paths = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ];
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".local/bin"));
        paths.push(home.join(".codex-cli/bin"));
        paths.push(home.join(".local/share/mise/shims"));
        paths.push(home.join(".cargo/bin"));
        paths.push(home.join(".bun/bin"));
        paths.push(home.join(".volta/bin"));
        paths.push(home.join(".omp/bin"));
    }
    paths
}

fn get_extra_search_paths() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        let appdata = std::env::var("APPDATA").ok();
        let user_profile = std::env::var("USERPROFILE").ok();
        let local_app_data = std::env::var("LOCALAPPDATA").ok();
        let program_files = std::env::var("ProgramFiles").ok();
        let program_files_x86 = std::env::var("ProgramFiles(x86)").ok();
        paths.extend(build_windows_extra_search_paths(
            appdata.as_deref().map(Path::new),
            user_profile.as_deref().map(Path::new),
            local_app_data.as_deref().map(Path::new),
            program_files.as_deref().map(Path::new),
            program_files_x86.as_deref().map(Path::new),
        ));
    }
    #[cfg(not(windows))]
    {
        paths.extend(build_unix_extra_search_paths());
    }

    if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        if !codex_home.trim().is_empty() {
            push_unique_path(&mut paths, PathBuf::from(codex_home.trim()).join("bin"));
        }
    }

    for prefix_key in ["NPM_CONFIG_PREFIX", "npm_config_prefix"] {
        if let Some(env_prefix) = std::env::var_os(prefix_key)
            .and_then(|value| value.into_string().ok())
            .and_then(|value| resolve_npm_global_bin_dir_from_prefix(&value))
        {
            push_unique_path(&mut paths, env_prefix);
        }
    }

    let seed_paths = build_seed_search_paths(None, &paths);
    if let Some(npm_global_bin) = discover_npm_global_bin_dir(&seed_paths) {
        push_unique_path(&mut paths, npm_global_bin);
    }

    paths
}

fn cached_extra_search_paths() -> Vec<PathBuf> {
    if let Ok(guard) = EXTRA_SEARCH_PATHS_CACHE.try_lock() {
        if let Some((paths, cached_at)) = guard.as_ref() {
            if cached_at.elapsed() <= RESOLUTION_CACHE_TTL {
                return paths.clone();
            }
        }
    }
    let paths = get_extra_search_paths();
    if let Ok(mut guard) = EXTRA_SEARCH_PATHS_CACHE.lock() {
        *guard = Some((paths.clone(), Instant::now()));
    }
    paths
}

fn build_seed_search_paths(custom_bin: Option<&str>, extra_paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut all_paths: Vec<PathBuf> = Vec::new();

    if let Some(bin_path) = custom_bin.filter(|v| !v.trim().is_empty()) {
        if let Some(parent) = Path::new(bin_path)
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            push_unique_path(&mut all_paths, parent.to_path_buf());
        }
    }
    if let Ok(system_path) = std::env::var("PATH") {
        for p in std::env::split_paths(&system_path) {
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

fn build_search_paths(custom_bin: Option<&str>) -> std::ffi::OsString {
    let all_paths = build_seed_search_paths(custom_bin, &cached_extra_search_paths());
    std::env::join_paths(all_paths).unwrap_or_default()
}

// ── shim upgrade + batch wrapper ────────────────────────────────────────────

/// Prefer an executable variant (`.cmd`/`.exe`/…) over a same-named
/// extensionless POSIX shim in the same directory.
#[cfg(any(windows, test))]
fn prefer_windows_executable_variant(path: PathBuf) -> PathBuf {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    if matches!(
        ext.as_deref(),
        Some("cmd") | Some("exe") | Some("bat") | Some("com") | Some("ps1")
    ) {
        return path;
    }
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return path;
    };
    let Some(parent) = path.parent() else {
        return path;
    };
    for preferred_ext in ["cmd", "exe", "bat", "com", "ps1"] {
        let candidate = parent.join(format!("{file_name}.{preferred_ext}"));
        if candidate.exists() {
            return candidate;
        }
    }
    path
}

fn upgrade_executable_variant(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        prefer_windows_executable_variant(path)
    }
    #[cfg(not(windows))]
    {
        path
    }
}

/// The (program, leading args) a batch wrapper needs, or None for binaries
/// CreateProcess can launch directly. Test-gated so the mapping is exercised
/// on every platform.
#[cfg(any(windows, test))]
fn windows_wrapper(bin: &str) -> Option<(&'static str, Vec<String>)> {
    let trimmed = bin.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower.ends_with(".cmd") || lower.ends_with(".bat") {
        Some(("cmd", vec!["/c".to_string(), trimmed.to_string()]))
    } else if lower.ends_with(".ps1") {
        Some((
            "powershell",
            vec![
                "-NoProfile".to_string(),
                "-ExecutionPolicy".to_string(),
                "Bypass".to_string(),
                "-File".to_string(),
                trimmed.to_string(),
            ],
        ))
    } else {
        None
    }
}

/// A spawnable command for `bin`. On Windows, `.cmd`/`.bat` wrappers run via
/// `cmd /c` and `.ps1` via `powershell -File`; everything else (and all of
/// Unix) spawns directly. Args are appended by the caller afterwards.
pub(crate) fn command_for_binary(bin: &str) -> Command {
    #[cfg(windows)]
    if let Some((program, leading)) = windows_wrapper(bin) {
        let mut cmd = Command::new(program);
        cmd.args(leading);
        return cmd;
    }
    Command::new(bin)
}

// ── public resolution entry points ──────────────────────────────────────────

/// Strip the `\\?\` verbatim prefix Windows `canonicalize` produces (the
/// settings validator canonicalizes bin overrides) — cmd.exe cannot parse
/// verbatim paths, so a wrapped spawn would fail on them. UNC shares keep
/// their prefix (stripping would change the path's meaning).
fn strip_verbatim(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        if !stripped.starts_with(r"UNC\") {
            return PathBuf::from(stripped);
        }
    }
    path
}

/// Find a CLI binary using the `which` crate over PATH + the well-known
/// install dirs. On Windows the known dirs are checked for `<name>.<ext>`
/// directly first (more reliable than PATH/PATHEXT), and any extensionless
/// shim result is upgraded to its executable variant.
pub(crate) fn find_cli_binary(name: &str, custom_bin: Option<&str>) -> Option<PathBuf> {
    if let Some(bin) = custom_bin.filter(|v| !v.trim().is_empty()) {
        let bin_path = Path::new(bin.trim());
        if bin_path.exists() {
            return Some(strip_verbatim(upgrade_executable_variant(bin_path.to_path_buf())));
        }
    }

    #[cfg(windows)]
    {
        for search_path in cached_extra_search_paths() {
            for ext in ["cmd", "exe", "bat", "com", "ps1"] {
                let candidate = search_path.join(format!("{name}.{ext}"));
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }

    let search_paths = build_search_paths(custom_bin);
    if let Ok(cwd) = std::env::current_dir() {
        if let Ok(found) = which::which_in(name, Some(&search_paths), &cwd) {
            return Some(upgrade_executable_variant(found));
        }
    }

    which::which(name).ok().map(upgrade_executable_variant)
}

/// Resolve a CLI name or path to something CreateProcess can actually launch:
/// existing paths get the shim upgrade, bare names go through
/// [`find_cli_binary`], and missing path-like inputs pass through untouched
/// (the spawn error names the path the user configured).
pub(crate) fn resolve_launchable_cli_binary(name_or_path: &str) -> String {
    let trimmed = name_or_path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let path = Path::new(trimmed);
    if path.exists() {
        return strip_verbatim(upgrade_executable_variant(path.to_path_buf()))
            .to_string_lossy()
            .into_owned();
    }
    let looks_like_path =
        path.is_absolute() || trimmed.contains('/') || trimmed.contains('\\');
    if looks_like_path {
        return trimmed.to_string();
    }
    find_cli_binary(trimmed, None)
        .map(|found| found.to_string_lossy().into_owned())
        .unwrap_or_else(|| trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn prefer_windows_executable_variant_prefers_cmd_over_posix_shim() {
        let root =
            std::env::temp_dir().join(format!("ccgui-posix-shim-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let posix_shim = root.join("dsh");
        let cmd_path = root.join("dsh.cmd");
        std::fs::write(&posix_shim, "#!/bin/sh\n").expect("write shim");
        std::fs::write(&cmd_path, "@echo off\n").expect("write cmd");

        assert_eq!(prefer_windows_executable_variant(posix_shim.clone()), cmd_path);
        // Already-executable variants and missing dirs pass through.
        assert_eq!(
            prefer_windows_executable_variant(cmd_path.clone()),
            cmd_path
        );
        let missing = PathBuf::from(r"C:\definitely\missing\dsh");
        assert_eq!(prefer_windows_executable_variant(missing.clone()), missing);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn windows_wrapper_maps_batch_and_ps1() {
        let (program, leading) = windows_wrapper(r"C:\npm\claude.cmd").unwrap();
        assert_eq!(program, "cmd");
        assert_eq!(leading, vec!["/c", r"C:\npm\claude.cmd"]);

        let (program, leading) = windows_wrapper(r"C:\npm\claude.BAT").unwrap();
        assert_eq!(program, "cmd");
        assert_eq!(leading[0], "/c");

        let (program, leading) = windows_wrapper(r"C:\npm\claude.ps1").unwrap();
        assert_eq!(program, "powershell");
        assert_eq!(
            leading,
            vec!["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", r"C:\npm\claude.ps1"]
        );

        assert!(windows_wrapper(r"C:\npm\claude.exe").is_none());
        assert!(windows_wrapper("/usr/local/bin/claude").is_none());
    }

    #[test]
    fn windows_extra_search_paths_cover_npm_global_dir() {
        let user_profile = Path::new(r"C:\Users\demo");
        let appdata = Path::new(r"C:\Users\demo\AppData\Roaming");
        let local_app_data = Path::new(r"C:\Users\demo\AppData\Local");
        let paths = build_windows_extra_search_paths(
            Some(appdata),
            Some(user_profile),
            Some(local_app_data),
            None,
            None,
        );
        let normalized: Vec<String> = paths
            .iter()
            .map(|path| path.to_string_lossy().replace('/', "\\"))
            .collect();
        for expected in [
            r"C:\Users\demo\AppData\Roaming\npm",
            r"C:\Users\demo\.local\bin",
            r"C:\Users\demo\scoop\shims",
        ] {
            assert!(
                normalized.iter().any(|p| p == expected),
                "missing {expected} in {normalized:?}"
            );
        }
    }

    #[test]
    fn strip_verbatim_drops_local_prefix_and_keeps_unc() {
        assert_eq!(
            strip_verbatim(PathBuf::from(r"\\?\C:\npm\claude.cmd")),
            PathBuf::from(r"C:\npm\claude.cmd")
        );
        let unc = PathBuf::from(r"\\?\UNC\server\share\claude.cmd");
        assert_eq!(strip_verbatim(unc.clone()), unc);
        let plain = PathBuf::from(r"C:\npm\claude.cmd");
        assert_eq!(strip_verbatim(plain.clone()), plain);
    }

    #[test]
    fn resolve_launchable_cli_binary_passthrough_rules() {
        assert_eq!(resolve_launchable_cli_binary(""), "");
        // Missing absolute paths stay as-is so the spawn error names them.
        let missing = if cfg!(windows) {
            r"C:\definitely\missing\claude.cmd"
        } else {
            "/definitely/missing/claude"
        };
        assert_eq!(resolve_launchable_cli_binary(missing), missing);
    }
}
