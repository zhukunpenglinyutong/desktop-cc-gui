//! Computer use: let an agent see and operate this machine — the main app's
//! half.
//!
//! The screenshot/input driver and its stdio MCP server are a separate
//! binary, `ccgui-computer-use` (src/bin/ccgui-computer-use), installed next
//! to this executable. Engine CLIs spawn it only for a send the user started
//! with computer use, so this always-running process never links screen
//! capture or input injection. What stays here:
//! - OS permission status + System Settings deep links. macOS (TCC) is the
//!   only platform that gates us; on Windows/Linux the driver works as-is
//!   and the status reports "no OS grant required".
//! - Esc-to-stop while a run is active.
//! - The helper's launch spec and the omp workspace MCP injection.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

/// Emitted when the armed global Esc fires; the frontend interrupts the
/// active computer-use run in response.
pub const ESCAPE_EVENT: &str = "computeruse://escape";

// ==================== OS permission status ====================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub accessibility: bool,
    pub screen_recording: bool,
    /// False on platforms with no OS-level grant flow: the UI shows
    /// "no permission needed" instead of misleading un-granted rows.
    pub os_permissions_required: bool,
}

#[cfg(target_os = "macos")]
mod tcc {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        pub fn AXIsProcessTrusted() -> bool;
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub fn CGPreflightScreenCaptureAccess() -> bool;
    }
}

pub fn accessibility_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { tcc::AXIsProcessTrusted() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

pub fn screen_recording_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { tcc::CGPreflightScreenCaptureAccess() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

pub fn permission_status() -> PermissionStatus {
    PermissionStatus {
        accessibility: accessibility_granted(),
        screen_recording: screen_recording_granted(),
        os_permissions_required: cfg!(target_os = "macos"),
    }
}

#[tauri::command]
pub fn computer_use_permission_status() -> PermissionStatus {
    permission_status()
}

#[tauri::command]
pub fn computer_use_open_permission_settings(kind: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let url = match kind.as_str() {
            "accessibility" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
            "screenRecording" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
            }
            other => return Err(format!("unknown permission pane: {other}")),
        };
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("open System Settings: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = kind;
        Err("OS permission grants are only needed on macOS".into())
    }
}

// ==================== Esc-to-stop ====================

static ESC_ARMED: AtomicBool = AtomicBool::new(false);

pub fn esc_armed() -> bool {
    ESC_ARMED.load(Ordering::SeqCst)
}

/// Arm/disarm the global Esc-to-stop while a computer-use run is active.
/// Registration failure only loses the convenience hotkey (e.g. the OS
/// refused without Accessibility) — it never blocks the run itself.
#[tauri::command]
pub fn computer_use_set_active(app: tauri::AppHandle, active: bool) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    ESC_ARMED.store(active, Ordering::SeqCst);
    let shortcut = "Escape"
        .parse::<Shortcut>()
        .map_err(|e| format!("parse Escape shortcut: {e}"))?;
    let gs = app.global_shortcut();
    if active {
        let _ = gs.register(shortcut);
    } else {
        let _ = gs.unregister(shortcut);
    }
    Ok(())
}

/// Drop the armed state and the global registration (window teardown).
pub fn disarm_esc(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    ESC_ARMED.store(false, Ordering::SeqCst);
    if let Ok(shortcut) = "Escape".parse::<Shortcut>() {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}
// ==================== omp MCP injection ====================

/// omp discovers MCP servers only from fixed files (mcp.json / .mcp.json /
/// .omp/mcp.json / ~/.omp/agent/mcp.json — there is no launch flag), so an
/// omp send merge-writes the workspace's `.omp/mcp.json` and restores it when
/// the run ends. The journal survives a crash mid-run: the next app start
/// restores every recorded injection (sweep_mcp_injections).
///
/// The machinery is generic on purpose: computer use and the per-bot memory
/// tool both ride it, and a run may inject both (one file, two entries, two
/// journal refs). omp 的本机驱动在 WSL 远端跑不了，调用方负责拒绝。
pub const MCP_SERVER_NAME: &str = "ccgui-computer";
const MCP_SCHEMA_URL: &str = "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json";

/// One app-served MCP entry to merge into the workspace file. `command` is
/// an app-shipped binary; `args`/`env` are what that child needs to know
/// (which mode to serve, which bot it acts for).
#[derive(Debug, Clone)]
pub struct McpServerSpec {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// File stem of the driver binary (src/bin/ccgui-computer-use). Cargo builds
/// it next to the main executable and the Tauri bundler installs every bin
/// target of this package side by side, so it is always a sibling.
pub const HELPER_BIN: &str = "ccgui-computer-use";

/// Pre-split argv flag that ran the driver inside the main executable. Kept
/// only as a forwarding shim (see `forward_to_helper`).
pub const LEGACY_MCP_FLAG: &str = "--computer-use-mcp";

fn helper_sibling_of(exe: &Path) -> Option<PathBuf> {
    Some(
        exe.parent()?
            .join(format!("{HELPER_BIN}{}", std::env::consts::EXE_SUFFIX)),
    )
}

/// The installed driver binary. A missing helper (partial install, a dev
/// build that never built the bin) fails the send up front with a reason the
/// user can act on, instead of an MCP server that silently never connects.
pub fn helper_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("resolve own exe for computer use: {e}"))?;
    let path = helper_sibling_of(&exe)
        .ok_or_else(|| format!("{}: executable has no parent directory", exe.display()))?;
    // Unit tests run from target/<profile>/deps where no bin is built; they
    // only check the spec's shape, never spawn it.
    #[cfg(not(test))]
    if !path.is_file() {
        return Err(format!(
            "computer use driver not found at {} — reinstall CC GUI to restore it",
            path.display()
        ));
    }
    Ok(path)
}

/// The computer-use driver's spec: the helper binary, plus the overlay
/// control channel when the main app is running (absent in tests).
pub fn computer_use_spec() -> Result<McpServerSpec, String> {
    let helper = helper_path()?;
    let mut env = Vec::new();
    if let (Some(base), Some(token)) = (
        crate::cu_overlay::control_base(),
        crate::cu_overlay::control_token(),
    ) {
        env.push(("CCGUI_CU_CONTROL".to_string(), base));
        env.push(("CCGUI_CU_TOKEN".to_string(), token));
    }
    Ok(McpServerSpec {
        name: MCP_SERVER_NAME.to_string(),
        command: helper.to_string_lossy().into_owned(),
        args: Vec::new(),
        env,
    })
}

/// `<main exe> --computer-use-mcp`: an engine config written before the
/// split (e.g. a crashed run's `.omp/mcp.json` before startup sweeps it) can
/// still launch this mode. Run the helper on the same stdio and env and pass
/// its exit code through — nothing in this process touches the screen or
/// input itself.
pub fn forward_to_helper() -> i32 {
    let helper = match helper_path() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("[computer-use] {error}");
            return 1;
        }
    };
    let mut command = std::process::Command::new(&helper);
    command
        .stdin(std::process::Stdio::inherit())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    match command.status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(error) => {
            eprintln!("[computer-use] start {}: {error}", helper.display());
            1
        }
    }
}

/// The `mcpServers` entry for claude's inline `--mcp-config` JSON.
pub fn mcp_server_json(spec: &McpServerSpec) -> serde_json::Value {
    let mut server = serde_json::json!({
        "command": spec.command,
        "args": spec.args,
    });
    if !spec.env.is_empty() {
        server["env"] = serde_json::Value::Object(
            spec.env
                .iter()
                .map(|(key, value)| (key.clone(), serde_json::Value::String(value.clone())))
                .collect(),
        );
    }
    server
}

/// Handle restoring every entry one run injected into a workspace file.
#[derive(Debug, Clone)]
pub struct McpRestore {
    refs: Vec<RestoreRef>,
}

#[derive(Debug, Clone)]
struct RestoreRef {
    path: PathBuf,
    /// We created the file (vs. merged into the user's): a final restore
    /// deletes it when nothing but the skeleton remains.
    created_file: bool,
    server: String,
}

fn default_server_name() -> String {
    MCP_SERVER_NAME.to_string()
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct InjectionRecord {
    path: PathBuf,
    created_file: bool,
    /// Concurrent runs in one workspace share one injection per server.
    count: u32,
    /// Which entry this ref counts. Records written before the memory tool
    /// existed carry no field and are computer-use injections.
    #[serde(default = "default_server_name")]
    server: String,
}

static JOURNAL_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

fn injections_path() -> PathBuf {
    crate::paths::app_home().join("computer-use-injections.json")
}

fn journal_read() -> Vec<InjectionRecord> {
    std::fs::read_to_string(injections_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn journal_write(records: &[InjectionRecord]) {
    let path = injections_path();
    let Ok(json) = serde_json::to_string_pretty(records) else {
        return;
    };
    // The app home exists in production (ensure_dirs at startup); tests and
    // odd environments get it created on demand.
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("tmp");
    if std::fs::write(&tmp, json).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

/// Merge our MCP entries into the workspace's `.omp/mcp.json`. One spec per
/// server; entries the user's own file already names are skipped (the user's
/// entry always wins, and nothing then needs restoring). Returns None when
/// this call injected nothing.
pub fn inject_workspace_mcp(
    workspace: &Path,
    specs: &[McpServerSpec],
) -> Result<Option<McpRestore>, String> {
    if specs.is_empty() {
        return Ok(None);
    }
    let _guard = JOURNAL_LOCK.lock();
    let path = workspace.join(".omp").join("mcp.json");
    let mut records = journal_read();
    let mut refs = Vec::new();
    let mut doc: Option<serde_json::Value> = None;
    for spec in specs {
        // Already injected by a concurrent run in this workspace: just take a
        // reference; the file write happened on the first inject.
        if let Some(record) = records
            .iter_mut()
            .find(|r| r.path == path && r.server == spec.name)
        {
            record.count += 1;
            refs.push(RestoreRef {
                path: path.clone(),
                created_file: record.created_file,
                server: spec.name.clone(),
            });
            continue;
        }
        // A file an earlier inject created stays "ours" for deletion even
        // when this second entry found it already on disk.
        let created_file = records
            .iter()
            .find(|r| r.path == path)
            .map(|r| r.created_file)
            .unwrap_or(!path.exists());
        if doc.is_none() {
            doc = Some(load_workspace_doc(&path)?);
        }
        let servers = doc
            .as_mut()
            .expect("the doc was loaded above")
            .get_mut("mcpServers")
            .and_then(serde_json::Value::as_object_mut)
            .ok_or_else(|| format!("{}: mcpServers is not an object", path.display()))?;
        if servers.contains_key(&spec.name) {
            continue;
        }
        let mut server = serde_json::json!({
            "type": "stdio",
            "command": spec.command,
            "args": spec.args,
        });
        if !spec.env.is_empty() {
            server["env"] = serde_json::Value::Object(
                spec.env
                    .iter()
                    .map(|(key, value)| (key.clone(), serde_json::Value::String(value.clone())))
                    .collect(),
            );
        }
        servers.insert(spec.name.clone(), server);
        records.push(InjectionRecord {
            path: path.clone(),
            created_file,
            count: 1,
            server: spec.name.clone(),
        });
        refs.push(RestoreRef {
            path: path.clone(),
            created_file,
            server: spec.name.clone(),
        });
    }
    if refs.is_empty() {
        return Ok(None);
    }
    if let Some(doc) = doc {
        if refs.iter().any(|r| r.created_file) {
            let parent = path.parent().unwrap();
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        let tmp = path.with_extension("json.ccgui-tmp");
        let json = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
        std::fs::write(&tmp, json).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        std::fs::rename(&tmp, &path).map_err(|e| format!("replace {}: {e}", path.display()))?;
    }
    journal_write(&records);
    Ok(Some(McpRestore { refs }))
}

/// 文件在就合并（哪怕是本次运行早先创建的），不在才用骨架。`created_file`
/// 只决定恢复时删不删文件，不参与读取——第二轮注入拿到的是同一份已合并的
/// 文档，不会把上一轮写进去的条目覆盖掉。
fn load_workspace_doc(path: &Path) -> Result<serde_json::Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({ "$schema": MCP_SCHEMA_URL, "mcpServers": {} }));
    }
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("parse {}: {e}", path.display()))
}

impl McpRestore {
    /// Fold another injection of the same run into this handle, so one
    /// restore at run end releases both (按需 MCP 与计算机/记忆共用一次恢复).
    pub fn absorb(&mut self, other: McpRestore) {
        self.refs.extend(other.refs);
    }

    /// Release this run's references; the last holder of an entry removes it
    /// from the workspace file (deleting the file when we created it and
    /// nothing but the skeleton remains).
    pub fn restore(&self) {
        let _guard = JOURNAL_LOCK.lock();
        let mut records = journal_read();
        for reference in &self.refs {
            if let Some(record) = records
                .iter_mut()
                .find(|r| r.path == reference.path && r.server == reference.server)
            {
                record.count = record.count.saturating_sub(1);
                if record.count > 0 {
                    continue;
                }
            }
            records.retain(|r| !(r.path == reference.path && r.server == reference.server));
            // Delete the file only when no other run still refs this path;
            // otherwise just drop our entry and keep the rest.
            let delete_when_empty = reference.created_file
                && !records.iter().any(|r| r.path == reference.path);
            remove_server_entry(
                &reference.path,
                std::slice::from_ref(&reference.server),
                delete_when_empty,
            );
        }
        journal_write(&records);
    }
}

fn remove_server_entry(path: &Path, servers_to_remove: &[String], delete_when_empty: bool) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    let Ok(mut doc) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    let Some(servers) = doc
        .get_mut("mcpServers")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return;
    };
    for server in servers_to_remove {
        servers.remove(server);
    }
    // A file we created goes away once it carries nothing but the skeleton;
    // the user's file keeps everything else it ever had, edits included.
    let skeleton_only = servers.is_empty()
        && doc
            .as_object()
            .map(|o| o.keys().all(|k| k == "$schema" || k == "mcpServers"))
            .unwrap_or(false);
    if delete_when_empty && skeleton_only {
        let _ = std::fs::remove_file(path);
        // The .omp dir we created for it goes too; non-empty is a no-op.
        if let Some(parent) = path.parent() {
            let _ = std::fs::remove_dir(parent);
        }
        return;
    }
    if let Ok(json) = serde_json::to_string_pretty(&doc) {
        let tmp = path.with_extension("json.ccgui-tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, path);
        }
    }
}

/// Crash recovery: the app died between inject and restore, so every
/// journaled workspace file still carries our entries. Restore them all at
/// startup; runs never outlive the app, so none can still be active.
pub fn sweep_mcp_injections() {
    let _guard = JOURNAL_LOCK.lock();
    let records = journal_read();
    let mut by_path: Vec<(PathBuf, bool, Vec<String>)> = Vec::new();
    for record in &records {
        match by_path.iter_mut().find(|(path, _, _)| *path == record.path) {
            Some((_, created_file, servers)) => {
                *created_file = *created_file || record.created_file;
                servers.push(record.server.clone());
            }
            None => by_path.push((
                record.path.clone(),
                record.created_file,
                vec![record.server.clone()],
            )),
        }
    }
    for (path, created_file, servers) in &by_path {
        remove_server_entry(path, servers, *created_file);
    }
    journal_write(&[]);
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;

    // ---- driver lives in its own binary ----

    #[test]
    fn driver_spec_launches_the_sibling_helper_binary() {
        let spec = computer_use_spec().unwrap();
        let command = PathBuf::from(&spec.command);
        assert_eq!(
            command.file_name().and_then(|n| n.to_str()),
            Some(format!("{HELPER_BIN}{}", std::env::consts::EXE_SUFFIX).as_str())
        );
        let exe = std::env::current_exe().unwrap();
        assert_eq!(command.parent(), exe.parent());
        // The helper serves exactly one mode: no flag, and never the legacy
        // main-exe flag that would route through this process again.
        assert!(spec.args.is_empty(), "{:?}", spec.args);
        assert_eq!(spec.name, MCP_SERVER_NAME);
    }

    #[test]
    fn helper_resolves_next_to_any_executable() {
        let exe = Path::new("/opt/CC GUI/ccgui-next");
        assert_eq!(
            helper_sibling_of(exe),
            Some(PathBuf::from(format!(
                "/opt/CC GUI/{HELPER_BIN}{}",
                std::env::consts::EXE_SUFFIX
            )))
        );
        assert_eq!(helper_sibling_of(Path::new("")), None);
    }

    /// Regression guard for the split: the screen-capture and input-injection
    /// crates may only be referenced by the helper binary (src/bin). Any use
    /// from the library would link them back into the always-running app.
    #[test]
    fn main_app_sources_never_reference_driver_crates() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let helper_dir = src.join("bin");
        let patterns: Vec<regex::Regex> = ["xcap", "enigo"]
            .iter()
            .flat_map(|krate| {
                [
                    format!(r"\b{krate}\s*::"),
                    format!(r"\buse\s+{krate}\b"),
                    format!(r"\bextern\s+crate\s+{krate}\b"),
                ]
            })
            .map(|pattern| regex::Regex::new(&pattern).unwrap())
            .collect();
        let mut offenders = Vec::new();
        let mut stack = vec![src];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    if path != helper_dir {
                        stack.push(path);
                    }
                    continue;
                }
                if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                    continue;
                }
                let text = std::fs::read_to_string(&path).unwrap();
                for (number, line) in text.lines().enumerate() {
                    if patterns.iter().any(|p| p.is_match(line)) {
                        offenders.push(format!("{}:{}: {line}", path.display(), number + 1));
                    }
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "driver crates referenced outside src/bin:\n{}",
            offenders.join("\n")
        );
    }

    // ---- omp MCP injection ----

    fn steer_home(tag: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!("ccgui-cu-home-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        std::env::set_var("HOME", &home);
        home
    }

    fn temp_workspace(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccgui-cu-ws-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn mcp_json(workspace: &Path) -> serde_json::Value {
        serde_json::from_str(
            &std::fs::read_to_string(workspace.join(".omp").join("mcp.json")).unwrap(),
        )
        .unwrap()
    }

    /// 测试用的驱动 spec：不看本机 exe，只验证注入/恢复的账。
    fn test_spec() -> McpServerSpec {
        McpServerSpec {
            name: MCP_SERVER_NAME.to_string(),
            command: "/tmp/ccgui-computer-use".to_string(),
            args: Vec::new(),
            env: Vec::new(),
        }
    }

    fn memory_spec() -> McpServerSpec {
        McpServerSpec {
            name: crate::memory::mcp::SERVER_NAME.to_string(),
            command: "/tmp/ccgui-test".to_string(),
            args: vec!["--memory-mcp".to_string()],
            env: Vec::new(),
        }
    }

    #[test]
    fn inject_creates_then_restore_deletes_workspace_file() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        steer_home("create");
        let ws = temp_workspace("create");
        let restore = inject_workspace_mcp(&ws, &[test_spec()])
            .unwrap()
            .expect("must inject");
        let doc = mcp_json(&ws);
        let server = &doc["mcpServers"][MCP_SERVER_NAME];
        assert_eq!(server["type"], "stdio");
        assert_eq!(server["command"], "/tmp/ccgui-computer-use");
        assert_eq!(server["args"], serde_json::json!([]));
        restore.restore();
        assert!(!ws.join(".omp").join("mcp.json").exists());
        assert!(journal_read().is_empty());
    }

    #[test]
    fn inject_merges_and_restore_preserves_user_servers() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        steer_home("merge");
        let ws = temp_workspace("merge");
        std::fs::create_dir_all(ws.join(".omp")).unwrap();
        std::fs::write(
            ws.join(".omp").join("mcp.json"),
            r#"{"mcpServers":{"mine":{"type":"stdio","command":"user-tool"}}}"#,
        )
        .unwrap();
        let restore = inject_workspace_mcp(&ws, &[test_spec()])
            .unwrap()
            .expect("must inject");
        let doc = mcp_json(&ws);
        assert!(doc["mcpServers"].get("mine").is_some());
        assert!(doc["mcpServers"].get(MCP_SERVER_NAME).is_some());
        restore.restore();
        let doc = mcp_json(&ws);
        assert!(doc["mcpServers"].get("mine").is_some());
        assert!(doc["mcpServers"].get(MCP_SERVER_NAME).is_none());
    }

    #[test]
    fn user_defined_server_entry_wins_untouched() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        steer_home("win");
        let ws = temp_workspace("win");
        std::fs::create_dir_all(ws.join(".omp")).unwrap();
        let original = r#"{"mcpServers":{"ccgui-computer":{"type":"stdio","command":"mine"}}}"#;
        std::fs::write(ws.join(".omp").join("mcp.json"), original).unwrap();
        assert!(inject_workspace_mcp(&ws, &[test_spec()]).unwrap().is_none());
        assert_eq!(
            std::fs::read_to_string(ws.join(".omp").join("mcp.json")).unwrap(),
            original
        );
        assert!(journal_read().is_empty());
    }

    #[test]
    fn concurrent_runs_share_one_injection_by_refcount() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        steer_home("shared");
        let ws = temp_workspace("shared");
        let first = inject_workspace_mcp(&ws, &[test_spec()]).unwrap().unwrap();
        let second = inject_workspace_mcp(&ws, &[test_spec()]).unwrap().unwrap();
        // 两次注入只写一次文件、只留一条记录。
        assert_eq!(journal_read().len(), 1);
        first.restore();
        assert!(mcp_json(&ws)["mcpServers"].get(MCP_SERVER_NAME).is_some());
        second.restore();
        assert!(!ws.join(".omp").join("mcp.json").exists());
        assert!(journal_read().is_empty());
    }

    #[test]
    fn sweep_restores_crash_leftovers() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        steer_home("sweep");
        let ws = temp_workspace("sweep");
        let _restore = inject_workspace_mcp(&ws, &[test_spec()]).unwrap().unwrap();
        // 模拟崩溃:不 restore 直接扫尾。
        sweep_mcp_injections();
        assert!(!ws.join(".omp").join("mcp.json").exists());
        assert!(journal_read().is_empty());
    }

    #[test]
    fn two_tools_share_one_file_and_restore_independently() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        steer_home("two-tools");
        let ws = temp_workspace("two-tools");
        // 两个工具先后注入同一工作区文件：两个条目、两条记录，各自持有。
        let computer = inject_workspace_mcp(&ws, &[test_spec()]).unwrap().unwrap();
        let memory = inject_workspace_mcp(&ws, &[memory_spec()]).unwrap().unwrap();
        let doc = mcp_json(&ws);
        assert!(doc["mcpServers"].get(MCP_SERVER_NAME).is_some());
        assert!(doc["mcpServers"]
            .get(crate::memory::mcp::SERVER_NAME)
            .is_some());
        assert_eq!(journal_read().len(), 2);
        // 只恢复记忆那一个：文件还在，电脑操控条目不动。
        memory.restore();
        let doc = mcp_json(&ws);
        assert!(doc["mcpServers"].get(MCP_SERVER_NAME).is_some());
        assert!(doc["mcpServers"]
            .get(crate::memory::mcp::SERVER_NAME)
            .is_none());
        computer.restore();
        assert!(!ws.join(".omp").join("mcp.json").exists());
        assert!(journal_read().is_empty());
    }

    #[test]
    fn same_tool_twice_counts_as_one_entry() {
        let _guard = crate::paths::HOME_ENV_LOCK.lock();
        steer_home("two-runs");
        let ws = temp_workspace("two-runs");
        // 同一次运行同时挂电脑操控与记忆：一个文件两个条目、两条记录。
        let both = inject_workspace_mcp(&ws, &[test_spec(), memory_spec()])
            .unwrap()
            .expect("must inject");
        assert_eq!(journal_read().len(), 2);
        both.restore();
        assert!(!ws.join(".omp").join("mcp.json").exists());
        assert!(journal_read().is_empty());
    }
}
