//! Open the workspace folder in an external app (VS Code / Cursor / IntelliJ)
//! or reveal it in the OS file manager.
//!
//! Lean port of the legacy `workspaces/open_app.rs`: the preset catalog was
//! trimmed to the four curated header targets, but user-added programs and
//! their OS icon extraction are back (the header menu's "add program" flow).

use std::path::PathBuf;

use std::process::Stdio;

#[cfg(target_os = "macos")]
use base64::Engine as _;
#[cfg(target_os = "macos")]
use std::path::Path;
#[cfg(target_os = "macos")]
use std::process::Command;
#[cfg(target_os = "macos")]
use std::time::{SystemTime, UNIX_EPOCH};

/// Expand a leading `~` and reject empty paths.
pub(crate) fn expand_user_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".to_string());
    }
    if trimmed == "~" {
        return dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string());
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
        return Ok(home.join(rest));
    }
    Ok(PathBuf::from(trimmed))
}

/// Trim whitespace and one layer of wrapping quotes; empty → None.
fn normalize_target_value(value: Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .map(|trimmed| {
            if trimmed.len() >= 2 {
                let double = trimmed.starts_with('"') && trimmed.ends_with('"');
                let single = trimmed.starts_with('\'') && trimmed.ends_with('\'');
                if double || single {
                    return trimmed[1..trimmed.len() - 1].trim();
                }
            }
            trimmed
        })
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn format_exit_detail(code: Option<i32>) -> String {
    code.map(|value| format!("exit code {value}"))
        .unwrap_or_else(|| "terminated by signal".to_string())
}

/// CLI binaries the backend will spawn for "open with" (non-macOS).
/// Anything else is rejected: `app` comes over IPC and a free-form value
/// would be arbitrary command execution.
#[cfg(not(target_os = "macos"))]
const ALLOWED_CLI_BINS: &[&str] = &[
    "code",
    "code-insiders",
    "codium",
    "cursor",
    "idea",
    "idea64",
    "webstorm",
    "subl",
    "zed",
    "atom",
];

/// App names accepted for `open -a` on macOS (exact match after trimming).
#[cfg(target_os = "macos")]
const ALLOWED_MACOS_APPS: &[&str] = &[
    "Visual Studio Code",
    "Visual Studio Code - Insiders",
    "Cursor",
    "IntelliJ IDEA",
    "WebStorm",
    "Sublime Text",
    "Zed",
    "Xcode",
    "Finder",
];

/// Command names / install paths to try for an app, first match wins.
/// `open -a` resolves app bundles on macOS; elsewhere we need a real binary.
/// Returns None when the requested app is not whitelisted.
#[cfg(not(target_os = "macos"))]
fn open_app_command_candidates(app: &str) -> Option<Vec<String>> {
    let trimmed = app.trim();
    // Friendly aliases resolve onto the whitelisted binary names.
    let lowered = trimmed.to_ascii_lowercase();
    let mapped = match lowered.as_str() {
        "visual studio code" | "vs code" | "vscode" => "code",
        "intellij idea" | "intellij" => "idea",
        other => other,
    };
    if !ALLOWED_CLI_BINS.contains(&mapped) {
        return None;
    }
    let mut candidates = vec![mapped.to_string()];
    let mut push = |candidate: String| {
        if !candidate.is_empty()
            && !candidates
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(&candidate))
        {
            candidates.push(candidate);
        }
    };
    match mapped {
        "code" => {
            push("code-insiders".to_string());
            #[cfg(target_os = "windows")]
            for (env, rel) in [
                ("LOCALAPPDATA", "Programs\\Microsoft VS Code\\Code.exe"),
                ("PROGRAMFILES", "Microsoft VS Code\\Code.exe"),
                ("PROGRAMFILES(X86)", "Microsoft VS Code\\Code.exe"),
            ] {
                if let Some(base) = std::env::var_os(env) {
                    let path = PathBuf::from(base).join(rel);
                    if path.is_file() {
                        push(path.to_string_lossy().to_string());
                    }
                }
            }
        }
        "cursor" => {
            #[cfg(target_os = "windows")]
            for (env, rel) in [
                ("LOCALAPPDATA", "Programs\\Cursor\\Cursor.exe"),
                ("PROGRAMFILES", "Cursor\\Cursor.exe"),
            ] {
                if let Some(base) = std::env::var_os(env) {
                    let path = PathBuf::from(base).join(rel);
                    if path.is_file() {
                        push(path.to_string_lossy().to_string());
                    }
                }
            }
        }
        "idea" => {
            #[cfg(target_os = "windows")]
            push("idea64".to_string());
        }
        _ => {}
    }
    Some(candidates)
}

#[cfg(not(target_os = "macos"))]
fn open_with_app_candidates(
    app: &str,
    args: &[String],
    path: &str,
    target_label: &str,
) -> Result<(), String> {
    let Some(candidates) = open_app_command_candidates(app) else {
        return Err(format!(
            "Failed to open app ({target_label}): app is not allowed"
        ));
    };
    let mut last_not_found: Option<std::io::Error> = None;
    for candidate in candidates {
        let mut cmd = std::process::Command::new(&candidate);
        cmd.args(args).arg(path);
        // Editor candidates can be console apps (.cmd shims); don't pop a
        // console window for them.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::null());
        match cmd.spawn() {
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                last_not_found = Some(error);
            }
            Err(error) => {
                return Err(format!("Failed to open app ({target_label}): {error}"));
            }
        }
    }
    let detail = last_not_found
        .map(|error| error.to_string())
        .unwrap_or_else(|| "program not found".to_string());
    Err(format!("Failed to open app ({target_label}): {detail}"))
}

/// Open a folder (or file) in an external application by name.
#[tauri::command]
pub(crate) async fn open_workspace_in(
    path: String,
    app: Option<String>,
    args: Vec<String>,
) -> Result<(), String> {
    let app = normalize_target_value(app).ok_or_else(|| "Missing app".to_string())?;
    let target_label = format!("app `{app}`");

    #[cfg(target_os = "macos")]
    {
        if !ALLOWED_MACOS_APPS.contains(&app.as_str()) {
            return Err(format!(
                "Failed to open app ({target_label}): app is not allowed"
            ));
        }
        let mut cmd = tokio::process::Command::new("open");
        cmd.arg("-a").arg(&app).arg(&path);
        if !args.is_empty() {
            cmd.arg("--args").args(&args);
        }
        let status = cmd
            .status()
            .await
            .map_err(|error| format!("Failed to open app ({target_label}): {error}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!(
            "Failed to open app ({target_label} returned {}).",
            format_exit_detail(status.code())
        ));
    }

    #[cfg(not(target_os = "macos"))]
    {
        open_with_app_candidates(&app, &args, &path, &target_label)
    }
}

/// Open a folder (or file) in a user-picked custom program.
///
/// Unlike `open_workspace_in` this takes an absolute executable path from the
/// header menu's "add program" flow and spawns it directly — no whitelist.
/// That is still not arbitrary command execution: the path must exist on
/// disk, and nothing shell-like is ever parsed (no `sh -c`, no splitting).
#[tauri::command]
pub(crate) async fn open_custom_program(
    executable_path: String,
    path: String,
) -> Result<(), String> {
    let expanded = expand_user_path(&executable_path)?;
    let expanded = std::fs::canonicalize(&expanded)
        .map_err(|error| format!("Failed to resolve executable `{executable_path}`: {error}"))?;
    if !expanded.is_file() {
        return Err(format!(
            "Failed to open custom program: `{}` is not a file",
            expanded.to_string_lossy()
        ));
    }
    let target_label = format!("program `{}`", expanded.to_string_lossy());

    #[cfg(target_os = "macos")]
    {
        // `open <path>` launches a .app bundle; for a bare binary it opens the
        // containing folder, so bare binaries go through spawn directly.
        let is_bundle = expanded.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("app"));
        if is_bundle {
            let status = tokio::process::Command::new("open")
                .arg(&expanded)
                .arg(&path)
                .status()
                .await
                .map_err(|error| format!("Failed to open app ({target_label}): {error}"))?;
            if status.success() {
                return Ok(());
            }
            return Err(format!(
                "Failed to open app ({target_label} returned {}).",
                format_exit_detail(status.code())
            ));
        }
    }

    let mut cmd = std::process::Command::new(&expanded);
    cmd.arg(&path);
    // The custom program is typically a GUI app; don't pop a console window.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    cmd.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!("Failed to open app ({target_label}): program not found")
        } else {
            format!("Failed to open app ({target_label}): {error}")
        }
    })?;
    Ok(())
}

/// Extract a program's OS icon as a PNG data URL (for the header menu rows).
///
/// Windows: the shell's associated icon for the executable.
/// macOS: the icon inside the `.app` bundle when the path points at one.
/// Linux: not implemented — returns None, and the UI falls back to a letter.
#[tauri::command]
pub(crate) async fn get_program_icon(executable_path: String) -> Result<Option<String>, String> {
    let trimmed = executable_path.trim().to_string();
    if trimmed.is_empty() {
        return Ok(None);
    }
    tokio::task::spawn_blocking(move || program_icon_sync(&trimmed))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
fn program_icon_sync(path: &str) -> Option<String> {
    let path_buf = PathBuf::from(path);
    if !path_buf.is_file() {
        return None;
    }
    // PowerShell single-quoted literal: a quote is escaped by doubling it.
    let escaped = path.replace('\'', "''");
    let script = format!(
        r#"
Add-Type -AssemblyName System.Drawing
$path = '{escaped}'
if (-not (Test-Path -LiteralPath $path)) {{ exit 1 }}
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
if ($null -eq $icon) {{ exit 2 }}
$bmp = $icon.ToBitmap()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[Convert]::ToBase64String($ms.ToArray())
"#
    );
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let encoded = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if encoded.is_empty() {
        return None;
    }
    Some(format!("data:image/png;base64,{encoded}"))
}

/// Walk up from `path` to the enclosing `.app` bundle, if any.
#[cfg(target_os = "macos")]
fn find_app_bundle(path: &Path) -> Option<PathBuf> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        let is_bundle = candidate
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("app"));
        if is_bundle {
            return Some(candidate.to_path_buf());
        }
        current = candidate.parent();
    }
    None
}

#[cfg(target_os = "macos")]
fn defaults_read(domain: &Path, key: &str) -> Option<String> {
    let output = Command::new("defaults")
        .arg("read")
        .arg(domain.as_os_str())
        .arg(key)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

#[cfg(target_os = "macos")]
fn resolve_icon_name(bundle_path: &Path) -> String {
    let info_domain = bundle_path.join("Contents/Info");
    defaults_read(&info_domain, "CFBundleIconFile")
        .or_else(|| defaults_read(&info_domain, "CFBundleIconName"))
        .unwrap_or_else(|| {
            bundle_path
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
                .unwrap_or_else(|| "AppIcon".to_string())
        })
}

#[cfg(target_os = "macos")]
fn resolve_icon_path(bundle_path: &Path, icon_name: &str) -> Option<PathBuf> {
    let resources_dir = bundle_path.join("Contents/Resources");
    if !resources_dir.exists() {
        return None;
    }
    let icon_path = PathBuf::from(icon_name);
    if icon_path.extension().is_some() {
        let direct = resources_dir.join(icon_path);
        if direct.exists() {
            return Some(direct);
        }
    }
    for candidate in [
        format!("{icon_name}.icns"),
        format!("{icon_name}.png"),
        "AppIcon.icns".to_string(),
        "AppIcon.png".to_string(),
        "app.icns".to_string(),
    ] {
        let path = resources_dir.join(candidate);
        if path.exists() {
            return Some(path);
        }
    }
    let lowered = icon_name.to_ascii_lowercase();
    if let Ok(entries) = std::fs::read_dir(resources_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let ext = path
                .extension()
                .map(|ext| ext.to_string_lossy().to_ascii_lowercase());
            if !matches!(ext.as_deref(), Some("icns" | "png")) {
                continue;
            }
            let stem = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            if stem == lowered {
                return Some(path);
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn icon_png_bytes(icon_path: &Path) -> Option<Vec<u8>> {
    let ext = icon_path
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase());
    if matches!(ext.as_deref(), Some("png")) {
        return std::fs::read(icon_path).ok();
    }
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let out_path = std::env::temp_dir().join(format!("ccgui-icon-{ts}.png"));
    let status = Command::new("sips")
        .args(["-s", "format", "png"])
        .arg(icon_path.as_os_str())
        .arg("--out")
        .arg(out_path.as_os_str())
        .status()
        .ok()?;
    if !status.success() {
        let _ = std::fs::remove_file(&out_path);
        return None;
    }
    let bytes = std::fs::read(&out_path).ok();
    let _ = std::fs::remove_file(&out_path);
    bytes
}

#[cfg(target_os = "macos")]
fn program_icon_sync(path: &str) -> Option<String> {
    let bundle = find_app_bundle(Path::new(path))?;
    let icon_name = resolve_icon_name(&bundle);
    let icon_path = resolve_icon_path(&bundle, &icon_name)?;
    let png_bytes = icon_png_bytes(&icon_path)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(png_bytes);
    Some(format!("data:image/png;base64,{encoded}"))
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn program_icon_sync(_path: &str) -> Option<String> {
    None
}

/// Reveal a local path in the OS file manager (Finder / Explorer / …).
///
/// Windows uses `explorer /select,…` rather than the opener plugin: the
/// plugin's SHOpenFolderAndSelectItems can fail with non-FILE_NOT_FOUND
/// HRESULTs that it silently swallows, which presents as "click does nothing".
#[tauri::command]
pub(crate) async fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let expanded = expand_user_path(&path)?;
    // dunce: strip the \\?\ prefix std::fs::canonicalize adds on Windows;
    // `explorer /select` cannot parse UNC-prefixed paths.
    let canonical = dunce::canonicalize(&expanded)
        .map_err(|error| format!("Failed to resolve path `{path}`: {error}"))?;

    #[cfg(target_os = "macos")]
    {
        let status = tokio::process::Command::new("open")
            .arg("-R")
            .arg(&canonical)
            .status()
            .await
            .map_err(|error| format!("Failed to reveal in Finder: {error}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!(
            "Failed to reveal in Finder ({}).",
            format_exit_detail(status.code())
        ));
    }

    #[cfg(target_os = "windows")]
    {
        // `spawn` (not `status`): explorer often exits non-zero on success.
        let path_str = canonical.to_string_lossy();
        std::process::Command::new("explorer")
            .arg(format!("/select,{path_str}"))
            .spawn()
            .map_err(|error| format!("Failed to open Explorer: {error}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        tauri_plugin_opener::reveal_item_in_dir(&canonical)
            .map_err(|error| format!("Failed to reveal in file manager: {error}"))
    }
}
