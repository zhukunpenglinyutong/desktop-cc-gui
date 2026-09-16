use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// Sidebar workspace group (工作区二级分类): an ordered named bucket that
/// workspaces are assigned into. Same shape as the legacy app's
/// `settings.json` `workspaceGroups` so imported groups round-trip
/// losslessly; the assignment itself lives on the workspace row (`group_id`
/// column, mirroring the legacy per-workspace `settings.groupId`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub sort_order: Option<i64>,
    /// Legacy "clone copies" target folder; the new app has no such feature,
    /// but the field is kept so imported groups survive a round-trip.
    #[serde(default)]
    pub copies_folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_theme")]
    pub theme: String,
    /// Windows 标题栏样式："native"（系统原生）| "mac"（仿 mac 自绘标题栏 +
    /// 三色按钮）。仅 Windows 生效；macOS 固定系统原生红绿灯（Overlay）。
    /// 窗口在启动时按此值创建，改动需重启应用。
    #[serde(default = "default_titlebar")]
    pub titlebar: String,
    /// Sidebar workspace groups, ordered by `sortOrder` (fallback: name).
    #[serde(default)]
    pub workspace_groups: Vec<WorkspaceGroup>,
    /// Workspace id -> user-chosen alias shown in the sidebar instead of the
    /// folder name; workspaces missing here display their directory name.
    #[serde(default)]
    pub workspace_aliases: HashMap<String, String>,
    /// Ids of workspaces hidden from the sidebar into the collapsible
    /// 已归档 section; the record and its sessions stay intact.
    #[serde(default)]
    pub archived_workspaces: Vec<String>,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub default_models: HashMap<String, String>,
    /// Per-engine user-added custom model ids, merged into the chat model
    /// picker alongside the CLI's catalog (设置 → CLI → 自定义模型).
    #[serde(default)]
    pub custom_models: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub default_efforts: HashMap<String, String>,
    /// Per-app OMP OpenAI tier override; None preserves native CLI settings.
    #[serde(default)]
    pub omp_openai_service_tier: Option<String>,
    /// Per-app Codex Fast override (`service_tier`); None preserves ~/.codex.
    #[serde(default)]
    pub codex_service_tier: Option<String>,
    /// Codex config/session home (`CODEX_HOME`). None keeps ~/.codex, or a
    /// CODEX_HOME already present in the process environment at launch.
    #[serde(default)]
    pub codex_home: Option<String>,
    /// Require a pairing key before the bridge serves a browser (设置 → 远程
    /// 访问 → 启用授权). Off by default: on the LAN the token URL is enough.
    #[serde(default)]
    pub web_auth_enabled: bool,
    /// 8-character pairing key, generated when the switch is turned on.
    #[serde(default)]
    pub web_auth_key: Option<String>,
    /// Worker base URL for the outbound relay (设置 → 远程访问 → 外网访问),
    /// e.g. https://ccgui-relay.<account>.workers.dev.
    #[serde(default)]
    pub web_relay_url: Option<String>,
    /// Shared key the relay worker checks.
    #[serde(default)]
    pub web_relay_key: Option<String>,
    /// Relay switch position, remembered across launches: the tunnel is what
    /// keeps the machine reachable unattended, so an app relaunch restores it.
    #[serde(default)]
    pub web_relay_on: Option<bool>,
    /// Max sessions shown per workspace in the sidebar before collapsing
    /// behind a "show more" row.
    #[serde(default = "default_sidebar_thread_limit")]
    pub sidebar_thread_limit: u32,
    /// Composer send gesture: "enter" (Enter sends, Shift+Enter newline) or
    /// "cmdEnter" (Cmd/Ctrl+Enter sends, Enter newline).
    #[serde(default = "default_composer_send_shortcut")]
    pub composer_send_shortcut: String,
    /// Keyboard shortcuts (快捷键), format "cmd+ctrl+alt+shift+key" lowercase;
    /// None = unbound. Defaults mirror src/features/shortcuts/actions.ts.
    #[serde(default = "default_new_session_shortcut")]
    pub new_session_shortcut: Option<String>,
    /// None = platform default (mac ctrl+c, win ctrl+shift+c), resolved
    /// frontend-side via getDefaultInterruptShortcut().
    #[serde(default)]
    pub interrupt_shortcut: Option<String>,
    #[serde(default = "default_command_palette_shortcut")]
    pub command_palette_shortcut: Option<String>,
    #[serde(default = "default_sidebar_search_shortcut")]
    pub sidebar_search_shortcut: Option<String>,
    #[serde(default = "default_toggle_terminal_shortcut")]
    pub toggle_terminal_shortcut: Option<String>,
    #[serde(default = "default_toggle_sidebar_shortcut")]
    pub toggle_sidebar_shortcut: Option<String>,
    #[serde(default = "default_toggle_side_panel_shortcut")]
    pub toggle_side_panel_shortcut: Option<String>,
    #[serde(default = "default_save_file_shortcut")]
    pub save_file_shortcut: Option<String>,
    #[serde(default = "default_open_settings_shortcut")]
    pub open_settings_shortcut: Option<String>,
    #[serde(default = "default_increase_ui_scale_shortcut")]
    pub increase_ui_scale_shortcut: Option<String>,
    #[serde(default = "default_decrease_ui_scale_shortcut")]
    pub decrease_ui_scale_shortcut: Option<String>,
    #[serde(default = "default_reset_ui_scale_shortcut")]
    pub reset_ui_scale_shortcut: Option<String>,
    /// Thinking-process row behavior once its thinking stream settles:
    /// None/Some(true) = auto-fold (default), Some(false) = stay expanded
    /// until the user folds it (设置 → 通用 → 行为 → 思考过程).
    #[serde(default)]
    pub thinking_auto_collapse: Option<bool>,
    /// Terminal shell override; None/empty = auto-detect from $SHELL/COMSPEC.
    /// Validated with the same spawn-target rules as bin overrides.
    #[serde(default)]
    pub terminal_shell_path: Option<String>,
    /// DeepSeek Harness host address; None/empty = 127.0.0.1.
    #[serde(default)]
    pub dsh_host: Option<String>,
    /// DeepSeek Harness host port; None/0 = 3080.
    #[serde(default)]
    pub dsh_port: Option<u16>,
    /// Auto-start the DSH host at app launch; None = on (`!= Some(false)`).
    #[serde(default)]
    pub dsh_auto_start: Option<bool>,
    /// Global network proxy switch; applied to this process's env so spawned
    /// children (engine CLIs, terminals, dsh host) inherit it.
    #[serde(default)]
    pub system_proxy_enabled: bool,
    /// Proxy URL (http/https/socks5); None/empty = unset.
    #[serde(default)]
    pub system_proxy_url: Option<String>,
    /// Per-engine binary overrides. flatten keeps the legacy flat shape
    /// (`"claudeBin": …`) the frontend depends on; keys stay camelCase and
    /// unknown extra fields round-trip untouched.
    #[serde(flatten)]
    pub bin_overrides: HashMap<String, Value>,
}

fn default_theme() -> String {
    "system".to_string()
}
fn default_titlebar() -> String {
    "native".to_string()
}
fn default_sidebar_thread_limit() -> u32 {
    5
}

fn default_composer_send_shortcut() -> String {
    "enter".to_string()
}

fn default_new_session_shortcut() -> Option<String> {
    Some("cmd+n".to_string())
}
fn default_command_palette_shortcut() -> Option<String> {
    Some("cmd+k".to_string())
}
fn default_sidebar_search_shortcut() -> Option<String> {
    Some("cmd+l".to_string())
}
fn default_toggle_terminal_shortcut() -> Option<String> {
    Some("cmd+j".to_string())
}
fn default_toggle_sidebar_shortcut() -> Option<String> {
    Some("cmd+b".to_string())
}
fn default_toggle_side_panel_shortcut() -> Option<String> {
    Some("cmd+shift+e".to_string())
}
fn default_save_file_shortcut() -> Option<String> {
    Some("cmd+s".to_string())
}
fn default_open_settings_shortcut() -> Option<String> {
    Some("cmd+,".to_string())
}
fn default_increase_ui_scale_shortcut() -> Option<String> {
    Some("cmd+=".to_string())
}
fn default_decrease_ui_scale_shortcut() -> Option<String> {
    Some("cmd+-".to_string())
}
fn default_reset_ui_scale_shortcut() -> Option<String> {
    Some("cmd+0".to_string())
}

fn default_language() -> String {
    "zh".to_string()
}

/// Random 8-character pairing key: no vowels and no look-alikes, so it can
/// be read out loud and typed on a phone without ambiguity.
pub fn generate_pair_key() -> String {
    const ALPHABET: &[u8] = b"23456789BCDFGHJKLMNPQRSTVWXZ";
    let mut out = String::with_capacity(8);
    for _ in 0..8 {
        out.push(ALPHABET[uuid::Uuid::new_v4().as_bytes()[0] as usize % ALPHABET.len()] as char);
    }
    out
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            titlebar: default_titlebar(),
            workspace_groups: Vec::new(),
            workspace_aliases: HashMap::new(),
            archived_workspaces: Vec::new(),
            web_auth_enabled: false,
            web_auth_key: None,
            web_relay_url: None,
            web_relay_key: None,
            web_relay_on: None,
            language: default_language(),
            default_models: HashMap::new(),
            custom_models: HashMap::new(),
            default_efforts: HashMap::new(),
            omp_openai_service_tier: None,
            codex_service_tier: None,
            codex_home: None,
            sidebar_thread_limit: default_sidebar_thread_limit(),
            composer_send_shortcut: default_composer_send_shortcut(),
            new_session_shortcut: default_new_session_shortcut(),
            interrupt_shortcut: None,
            command_palette_shortcut: default_command_palette_shortcut(),
            sidebar_search_shortcut: default_sidebar_search_shortcut(),
            toggle_terminal_shortcut: default_toggle_terminal_shortcut(),
            toggle_sidebar_shortcut: default_toggle_sidebar_shortcut(),
            toggle_side_panel_shortcut: default_toggle_side_panel_shortcut(),
            save_file_shortcut: default_save_file_shortcut(),
            open_settings_shortcut: default_open_settings_shortcut(),
            increase_ui_scale_shortcut: default_increase_ui_scale_shortcut(),
            decrease_ui_scale_shortcut: default_decrease_ui_scale_shortcut(),
            reset_ui_scale_shortcut: default_reset_ui_scale_shortcut(),
            thinking_auto_collapse: None,
            terminal_shell_path: None,
            dsh_host: None,
            dsh_port: None,
            dsh_auto_start: None,
            system_proxy_enabled: false,
            system_proxy_url: None,
            bin_overrides: HashMap::new(),
        }
    }
}

impl AppSettings {
    pub fn bin_override(&self, engine: &str) -> Option<&str> {
        self.bin_overrides
            .get(&bin_override_key(engine))
            .and_then(Value::as_str)
    }
}

/// Settings key for an engine's bin override: `{engine}Bin` in camelCase,
/// so hyphenated engine ids read the key the frontend actually writes
/// ("qoder-cn" → `qoderCnBin`, not `qoder-cnBin`).
fn bin_override_key(engine: &str) -> String {
    let mut key = String::with_capacity(engine.len() + 3);
    let mut uppercase_next = false;
    for ch in engine.chars() {
        if ch == '-' {
            uppercase_next = true;
        } else if std::mem::take(&mut uppercase_next) {
            key.extend(ch.to_uppercase());
        } else {
            key.push(ch);
        }
    }
    key.push_str("Bin");
    key
}

/// A bin override is a spawn target, so it must be a stable absolute path —
/// canonicalizable and outside temp dirs (a redirected /tmp path is the
/// classic local privilege-escalation plant).
pub(crate) fn validate_bin_override(value: &str) -> Result<std::path::PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("empty path".to_string());
    }
    let path = std::path::PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(format!("{trimmed}: not an absolute path"));
    }
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("{}: cannot resolve ({e})", path.display()))?;
    reject_temp_root(&canonical, "binaries")?;
    Ok(canonical)
}

const TEMP_ROOTS: &[&str] = &[
    "/tmp",
    "/var/folders",
    "/private/tmp",
    "/private/var/folders",
];

fn reject_temp_root(path: &std::path::Path, kind: &str) -> Result<(), String> {
    for root in TEMP_ROOTS {
        if path.starts_with(root) {
            return Err(format!(
                "{}: {kind} under {root} are not allowed",
                path.display()
            ));
        }
    }
    Ok(())
}

/// Codex home override: absolute directory (may not exist yet). `~` is
/// expanded. Same temp-dir refusal as bin overrides.
fn validate_home_override(value: &str) -> Result<std::path::PathBuf, String> {
    let expanded = crate::open_app::expand_user_path(value.trim())?;
    if !expanded.is_absolute() {
        return Err(format!("{}: not an absolute path", expanded.display()));
    }
    if expanded.exists() && !expanded.is_dir() {
        return Err(format!("{}: not a directory", expanded.display()));
    }
    let check = if expanded.exists() {
        std::fs::canonicalize(&expanded).unwrap_or_else(|_| expanded.clone())
    } else {
        expanded.clone()
    };
    reject_temp_root(&check, "homes")?;
    Ok(expanded)
}

/// Push `settings.codex_home` into this process's `CODEX_HOME` so every
/// existing `engine_home(Some("CODEX_HOME"), ".codex")` call site — official
/// config, history, skills, catalog probes, and spawned `codex` — sees the
/// same directory. Clearing the setting only unsets an env we previously
/// applied, so a launch-time `CODEX_HOME` survives.
pub(crate) fn apply_codex_home(settings: &AppSettings) {
    static APPLIED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if let Some(home) = settings
        .codex_home
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if let Ok(expanded) = validate_home_override(home) {
            std::env::set_var("CODEX_HOME", expanded);
            APPLIED.store(true, std::sync::atomic::Ordering::Relaxed);
            return;
        }
    }
    if APPLIED.swap(false, std::sync::atomic::Ordering::Relaxed) {
        std::env::remove_var("CODEX_HOME");
    }
}

pub fn read_settings() -> Result<AppSettings, String> {
    let path = crate::paths::settings_path();
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    if content.trim().is_empty() {
        return Ok(AppSettings::default());
    }
    serde_json::from_str(&content).map_err(|e| format!("parse {}: {e}", path.display()))
}

/// Write-then-rename so a crash mid-write never leaves a truncated file that
/// the next read would reject as corrupt.
pub(crate) fn atomic_write(path: &std::path::Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, content).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename {}: {e}", path.display()))
}

/// One-time import of the legacy app's sidebar groups. Group definitions
/// merge into our settings.json (matched by name; unseen legacy groups keep
/// their id and relative order, appended after existing entries), and each
/// already-imported workspace row picks up its legacy `settings.groupId`.
/// Assignments the user already made in the new app win (the `group_id IS
/// NULL` guard); any `workspaceGroupAssignments` written by interim builds is
/// absorbed into the workspaces table and the obsolete key stripped. Guarded
/// by a db meta flag; a fresh machine just records the flag.
pub fn import_legacy_groups_once(db: &crate::db::Db) -> Result<(), String> {
    {
        let conn = db.0.lock();
        let done = conn
            .query_row(
                "SELECT value FROM meta WHERE key='legacy_groups_import_v1'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok();
        if done.is_some() {
            return Ok(());
        }
    }
    {
        // Raw read-modify-write of settings.json: same write lock as every
        // other writer, so a concurrent persist cannot be overwritten.
        let _guard = settings_write_lock();
        import_legacy_groups_from(
            db,
            &crate::paths::settings_path(),
            &crate::paths::legacy_settings_path(),
            &crate::paths::legacy_workspaces_path(),
        )?;
    }
    let conn = db.0.lock();
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES('legacy_groups_import_v1', '1')",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn import_legacy_groups_from(
    db: &crate::db::Db,
    settings_path: &std::path::Path,
    legacy_settings_path: &std::path::Path,
    legacy_workspaces_path: &std::path::Path,
) -> Result<(), String> {
    let conn = db.0.lock();
    // Raw JSON on our side: unrelated keys survive untouched and the obsolete
    // assignments key can be stripped precisely.
    let mut root: Value = match std::fs::read_to_string(settings_path) {
        Ok(content) if !content.trim().is_empty() => serde_json::from_str(&content)
            .map_err(|e| format!("parse {}: {e}", settings_path.display()))?,
        _ => Value::Object(serde_json::Map::new()),
    };
    if !root.is_object() {
        return Err(format!("{}: not a JSON object", settings_path.display()));
    }

    let legacy_groups: Vec<Value> = std::fs::read_to_string(legacy_settings_path)
        .ok()
        .and_then(|c| serde_json::from_str::<Value>(&c).ok())
        .and_then(|v| v.get("workspaceGroups").and_then(Value::as_array).cloned())
        .unwrap_or_default();

    let mut groups: Vec<Value> = root
        .get("workspaceGroups")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut next_sort = groups
        .iter()
        .filter_map(|g| g.get("sortOrder").and_then(Value::as_i64))
        .max()
        .map(|m| m + 1)
        .unwrap_or(0);
    // Legacy group id -> our group id; a name collision adopts the existing
    // group's id so legacy assignments still resolve.
    let mut id_map: HashMap<String, String> = HashMap::new();
    let mut changed = false;
    for legacy in &legacy_groups {
        let Some(name) = legacy
            .get("name")
            .and_then(Value::as_str)
            .filter(|n| !n.trim().is_empty())
        else {
            continue;
        };
        let legacy_id = legacy.get("id").and_then(Value::as_str).unwrap_or("");
        if let Some(existing) = groups
            .iter()
            .find(|g| g.get("name").and_then(Value::as_str) == Some(name))
        {
            if !legacy_id.is_empty() {
                if let Some(new_id) = existing.get("id").and_then(Value::as_str) {
                    id_map.insert(legacy_id.to_string(), new_id.to_string());
                }
            }
            continue;
        }
        let new_id = if legacy_id.is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            legacy_id.to_string()
        };
        if !legacy_id.is_empty() {
            id_map.insert(legacy_id.to_string(), new_id.clone());
        }
        groups.push(serde_json::json!({
            "id": new_id,
            "name": name,
            "sortOrder": next_sort,
            "copiesFolder": legacy.get("copiesFolder").cloned().unwrap_or(Value::Null),
        }));
        next_sort += 1;
        changed = true;
    }

    let valid_ids: std::collections::HashSet<String> = groups
        .iter()
        .filter_map(|g| g.get("id").and_then(Value::as_str).map(str::to_string))
        .collect();
    // Interim builds stored assignments in settings.json; move them onto the
    // workspace rows (they reference workspace ids directly) and drop the key.
    let stale: Vec<(String, String)> = root
        .get("workspaceGroupAssignments")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .filter_map(|(ws_id, gid)| {
                    gid.as_str()
                        .filter(|g| valid_ids.contains(*g))
                        .map(|g| (ws_id.clone(), g.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    if root
        .as_object_mut()
        .and_then(|m| m.remove("workspaceGroupAssignments"))
        .is_some()
    {
        changed = true;
    }

    // Legacy workspaces.json is a bare array; path is the join key because a
    // path conflict during the workspace import keeps the new-app row id.
    let legacy_assignments: Vec<(String, String)> = std::fs::read_to_string(legacy_workspaces_path)
        .ok()
        .and_then(|c| serde_json::from_str::<Value>(&c).ok())
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|w| {
            let path = w.get("path").and_then(Value::as_str)?.trim();
            let gid = w.pointer("/settings/groupId").and_then(Value::as_str)?;
            let new_gid = id_map
                .get(gid)
                .cloned()
                .or_else(|| valid_ids.contains(gid).then(|| gid.to_string()))?;
            (!path.is_empty()).then(|| (path.to_string(), new_gid))
        })
        .collect();

    if !groups.is_empty() || root.get("workspaceGroups").is_some() {
        root["workspaceGroups"] = Value::Array(groups);
    }
    if changed {
        let content = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
        atomic_write(settings_path, &content)?;
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    // New-app explicit assignments first; legacy only fills what is still
    // ungrouped.
    for (ws_id, gid) in &stale {
        tx.execute(
            "UPDATE workspaces SET group_id=?2 WHERE id=?1 AND group_id IS NULL",
            rusqlite::params![ws_id, gid],
        )
        .map_err(|e| e.to_string())?;
    }
    for (path, gid) in &legacy_assignments {
        tx.execute(
            "UPDATE workspaces SET group_id=?2 WHERE path=?1 AND group_id IS NULL",
            rusqlite::params![path, gid],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

use tauri::Emitter;

#[tauri::command]
pub fn get_app_settings() -> Result<AppSettings, String> {
    read_settings()
}

#[tauri::command]
pub fn update_app_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    mut settings: AppSettings,
) -> Result<(), String> {
    let prev_home = read_settings().ok().and_then(|s| s.codex_home);
    let result = persist_settings(&mut settings);
    // Other surfaces (the composer's proxy toggle) follow along without
    // re-reading settings.json.
    let _ = app.emit("settings://changed", ());
    // persist_settings reports committed-with-warnings as Err; the home change
    // is already on disk by then, so gate on the value, not on result.
    if prev_home != settings.codex_home {
        use tauri::Manager;
        if let Some(state) = app.try_state::<crate::AppState>() {
            crate::history::scanner::spawn_scan(
                std::sync::Arc::clone(&state.db),
                std::sync::Arc::clone(&state.sink),
            );
        }
    }
    result
}

/// Validate + persist + apply. The public command keeps reporting rejected
/// fields as an error, even though the sanitized snapshot was committed.
pub fn persist_settings(settings: &mut AppSettings) -> Result<(), String> {
    let _guard = settings_write_lock();
    match persist_settings_committed(settings)? {
        Some(warning) => Err(warning),
        None => Ok(()),
    }
}

/// Persist a settings snapshot while distinguishing failures before the
/// atomic write from warnings produced after the sanitized snapshot commits.
///
/// Callers doing a read→modify→write must hold [`settings_write_lock`]
/// across the whole cycle; this function only performs the write half.
pub(crate) fn persist_settings_committed(
    settings: &mut AppSettings,
) -> Result<Option<String>, String> {
    let path = crate::paths::settings_path();
    persist_settings_to(settings, &path)
}

fn persist_settings_to(
    settings: &mut AppSettings,
    path: &std::path::Path,
) -> Result<Option<String>, String> {
    if settings
        .omp_openai_service_tier
        .as_deref()
        .is_some_and(|tier| !matches!(tier, "default" | "priority"))
    {
        return Err("Invalid OMP OpenAI service tier".to_string());
    }
    if settings
        .codex_service_tier
        .as_deref()
        .is_some_and(|tier| !matches!(tier, "default" | "priority"))
    {
        return Err("Invalid Codex service tier".to_string());
    }
    if settings.web_auth_enabled && settings.web_auth_key.is_none() {
        settings.web_auth_key = Some(generate_pair_key());
    } else if !settings.web_auth_enabled {
        settings.web_auth_key = None;
    }
    // Reject only the offending bin-override fields: the rest of the settings
    // still persist, and the warning names what was dropped.
    let mut rejected = Vec::new();
    settings.bin_overrides.retain(|key, value| {
        let Some(text) = value.as_str() else {
            return true; // non-string extras round-trip untouched
        };
        if !key.ends_with("Bin") || text.trim().is_empty() {
            return true;
        }
        match validate_bin_override(text) {
            Ok(_) => true,
            Err(reason) => {
                rejected.push(format!("{key}: {reason}"));
                false
            }
        }
    });
    // Same spawn-target validation as bin overrides; an invalid shell path is
    // dropped so a typo can never wedge every terminal spawn.
    if let Some(shell) = settings.terminal_shell_path.take() {
        let trimmed = shell.trim().to_string();
        if !trimmed.is_empty() {
            match validate_bin_override(&trimmed) {
                Ok(_) => settings.terminal_shell_path = Some(trimmed),
                Err(reason) => rejected.push(format!("terminalShellPath: {reason}")),
            }
        }
    }
    if let Some(home) = settings.codex_home.take() {
        let trimmed = home.trim().to_string();
        if !trimmed.is_empty() {
            match validate_home_override(&trimmed) {
                Ok(path) => settings.codex_home = Some(path.to_string_lossy().into_owned()),
                Err(reason) => rejected.push(format!("codexHome: {reason}")),
            }
        }
    }
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    // Reject before persisting: an invalid proxy URL must not be saved (the
    // frontend rolls its drafts back on this error).
    crate::proxy::validate_proxy_settings(&settings)?;
    atomic_write(path, &content)?;

    let mut warnings = Vec::new();
    if !rejected.is_empty() {
        warnings.push(format!("rejected settings: {}", rejected.join("; ")));
    }
    // The snapshot is already durable here. Keep any future apply failure in
    // the committed-warning channel rather than misreporting it as a rollback.
    if let Err(error) = crate::proxy::apply_app_proxy_settings(&settings) {
        warnings.push(error);
    }
    // Infallible: an invalid home was already rejected above, and a stale
    // value simply leaves CODEX_HOME untouched.
    apply_codex_home(settings);
    Ok((!warnings.is_empty()).then(|| warnings.join("; ")))
}

/// A submitted pairing key is accepted only when one is configured and the two
/// match, case-insensitively (the caller normalises the form field). The cases
/// that must never pass — no key configured, an empty submission, the
/// `--------` the UI shows while authorization is off — are pinned by a test.
pub(crate) fn pairing_key_matches(expected: &str, submitted: &str) -> bool {
    !expected.is_empty() && !submitted.is_empty() && submitted.eq_ignore_ascii_case(expected)
}

/// Serialises every read-modify-write of settings.json. Without it two
/// writers — a timed key rotation and a relay-switch persist, say — can each
/// read the other's pre-write snapshot and the later write silently drops the
/// earlier one's field. It also keeps the pairing key's compare-and-rotate
/// atomic: two devices posting the same code must not both be admitted.
static SETTINGS_WRITE_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

/// Hold across a full read→modify→persist of settings.json.
pub(crate) fn settings_write_lock() -> parking_lot::MutexGuard<'static, ()> {
    SETTINGS_WRITE_LOCK.lock()
}

/// Spend the pairing key on one device: rotates `settings` in place and
/// answers whether the browser may be admitted. Pure, so the property that
/// matters — a code opens exactly one pairing — is pinned by a test without a
/// running app; `consume_web_auth_key` adds the lock and the disk round-trip.
fn spend_pair_key(settings: &mut AppSettings, submitted: &str) -> bool {
    if !settings.web_auth_enabled {
        return false;
    }
    if !pairing_key_matches(
        settings.web_auth_key.as_deref().unwrap_or_default(),
        submitted,
    ) {
        return false;
    }
    settings.web_auth_key = Some(generate_pair_key());
    true
}

/// Spend the pairing key on one device: compare and rotate under a single
/// lock, so a code is good for exactly one pairing. `false` means the browser
/// must not be admitted — wrong key, or the switch is off and there is nothing
/// to pair with.
pub fn consume_web_auth_key(app: &tauri::AppHandle, submitted: &str) -> Result<bool, String> {
    let _guard = settings_write_lock();
    let mut settings = read_settings()?;
    if !spend_pair_key(&mut settings, submitted) {
        return Ok(false);
    }
    let warning = persist_settings_committed(&mut settings)?;
    announce_settings(app);
    if let Some(warning) = warning {
        eprintln!("[settings] pairing key committed with warning: {warning}");
    }
    Ok(true)
}

/// Rotate the pairing key (only when the switch is on) and tell every surface
/// that settings moved. Used on a timer and by the 换一个 button, so a code
/// never lingers even when nobody pairs with it.
pub fn rotate_web_auth_key(app: &tauri::AppHandle) -> Result<(), String> {
    let _guard = settings_write_lock();
    let mut settings = read_settings()?;
    if !settings.web_auth_enabled {
        return Ok(());
    }
    settings.web_auth_key = Some(generate_pair_key());
    let warning = persist_settings_committed(&mut settings)?;
    announce_settings(app);
    if let Some(warning) = warning {
        eprintln!("[settings] pairing key rotation committed with warning: {warning}");
    }
    Ok(())
}

/// Through the sink: the webview *and* every browser attached over the bridge
/// must see the new code, or a phone would keep showing one that is spent.
fn announce_settings(app: &tauri::AppHandle) {
    use crate::event_sink::Emit;
    use tauri::Manager;
    app.state::<crate::AppState>()
        .emitters
        .emit_json("settings://changed", "null");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bin_override_key_camel_cases_hyphenated_engine_ids() {
        assert_eq!(bin_override_key("claude"), "claudeBin");
        assert_eq!(bin_override_key("qoder"), "qoderBin");
        assert_eq!(bin_override_key("qoder-cn"), "qoderCnBin");
    }

    struct Scratch(std::path::PathBuf);

    impl Scratch {
        fn new() -> Self {
            let dir = std::env::temp_dir()
                .join(format!("ccgui-next-settings-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn path(&self, name: &str) -> std::path::PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn insert_workspace(db: &crate::db::Db, id: &str, path: &str) {
        let conn = db.0.lock();
        conn.execute(
            "INSERT INTO workspaces(id, path, name) VALUES(?1, ?2, ?3)",
            rusqlite::params![id, path, path.rsplit('/').next().unwrap_or(path)],
        )
        .unwrap();
    }

    fn group_of(db: &crate::db::Db, id: &str) -> Option<String> {
        let conn = db.0.lock();
        conn.query_row(
            "SELECT group_id FROM workspaces WHERE id=?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// Mirrors the real upgrade: the new app already has one user-made group
    /// with a stale settings-map assignment, the legacy app has three groups
    /// and per-workspace `settings.groupId` rows.
    #[test]
    fn legacy_group_import_merges_and_assigns() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.path("app.db")).unwrap();
        insert_workspace(&db, "ws-new", "/repos/desktop-cc-gui");
        insert_workspace(&db, "ws-jb", "/repos/jetbrains-cc-gui");
        insert_workspace(&db, "ws-free", "/repos/sub2api");

        std::fs::write(
            scratch.path("settings.json"),
            r#"{
                "theme": "system",
                "workspaceGroups": [{"id": "g-new", "name": "测试", "sortOrder": 0}],
                "workspaceGroupAssignments": {"ws-new": "g-new"},
                "claudeBin": null
            }"#,
        )
        .unwrap();
        std::fs::write(
            scratch.path("legacy-settings.json"),
            r#"{
                "workspaceGroups": [
                    {"id": "g-oss", "name": "开源项目", "sortOrder": 0, "copiesFolder": null},
                    {"id": "g-relay", "name": "中转站项目", "sortOrder": 1, "copiesFolder": "/copies"},
                    {"id": "g-knowledge", "name": "知识项目", "sortOrder": 2, "copiesFolder": null}
                ]
            }"#,
        )
        .unwrap();
        std::fs::write(
            scratch.path("legacy-workspaces.json"),
            r#"[
                {"path": "/repos/desktop-cc-gui", "settings": {"groupId": "g-oss"}},
                {"path": "/repos/jetbrains-cc-gui", "settings": {"groupId": "g-oss"}},
                {"path": "/repos/sub2api", "settings": {"groupId": "g-relay"}},
                {"path": "/repos/unknown", "settings": {"groupId": "g-dangling"}}
            ]"#,
        )
        .unwrap();

        import_legacy_groups_from(
            &db,
            &scratch.path("settings.json"),
            &scratch.path("legacy-settings.json"),
            &scratch.path("legacy-workspaces.json"),
        )
        .unwrap();

        let merged: Value =
            serde_json::from_str(&std::fs::read_to_string(scratch.path("settings.json")).unwrap())
                .unwrap();
        // Obsolete key stripped, unrelated keys preserved.
        assert!(merged.get("workspaceGroupAssignments").is_none());
        assert_eq!(merged.get("theme").and_then(Value::as_str), Some("system"));
        assert!(merged.get("claudeBin").is_some());
        let groups = merged
            .get("workspaceGroups")
            .and_then(Value::as_array)
            .unwrap();
        // Existing group untouched; legacy groups appended in legacy order,
        // keeping their ids and copiesFolder.
        assert_eq!(groups.len(), 4);
        assert_eq!(groups[0]["id"], "g-new");
        assert_eq!(groups[0]["sortOrder"], 0);
        assert_eq!(groups[1]["id"], "g-oss");
        assert_eq!(groups[1]["sortOrder"], 1);
        assert_eq!(groups[2]["id"], "g-relay");
        assert_eq!(groups[2]["copiesFolder"], "/copies");
        assert_eq!(groups[3]["id"], "g-knowledge");

        // The explicit new-app assignment wins over the legacy one; legacy
        // fills the rest; dangling group ids are skipped.
        assert_eq!(group_of(&db, "ws-new").as_deref(), Some("g-new"));
        assert_eq!(group_of(&db, "ws-jb").as_deref(), Some("g-oss"));
        assert_eq!(group_of(&db, "ws-free").as_deref(), Some("g-relay"));
    }

    /// A name collision adopts the existing group, and legacy assignments to
    /// it still resolve.
    #[test]
    fn legacy_group_import_dedupes_by_name() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.path("app.db")).unwrap();
        insert_workspace(&db, "ws-1", "/repos/a");
        std::fs::write(
            scratch.path("settings.json"),
            r#"{"workspaceGroups": [{"id": "g-existing", "name": "开源项目", "sortOrder": 0}]}"#,
        )
        .unwrap();
        std::fs::write(
            scratch.path("legacy-settings.json"),
            r#"{"workspaceGroups": [{"id": "g-legacy", "name": "开源项目", "sortOrder": 0}]}"#,
        )
        .unwrap();
        std::fs::write(
            scratch.path("legacy-workspaces.json"),
            r#"[{"path": "/repos/a", "settings": {"groupId": "g-legacy"}}]"#,
        )
        .unwrap();

        import_legacy_groups_from(
            &db,
            &scratch.path("settings.json"),
            &scratch.path("legacy-settings.json"),
            &scratch.path("legacy-workspaces.json"),
        )
        .unwrap();

        let merged: Value =
            serde_json::from_str(&std::fs::read_to_string(scratch.path("settings.json")).unwrap())
                .unwrap();
        assert_eq!(
            merged
                .get("workspaceGroups")
                .and_then(Value::as_array)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(group_of(&db, "ws-1").as_deref(), Some("g-existing"));
    }

    /// Fresh machine: no legacy files, no settings file — nothing is created.
    #[test]
    fn legacy_group_import_noop_without_legacy() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.path("app.db")).unwrap();
        import_legacy_groups_from(
            &db,
            &scratch.path("settings.json"),
            &scratch.path("missing-settings.json"),
            &scratch.path("missing-workspaces.json"),
        )
        .unwrap();
        assert!(!scratch.path("settings.json").exists());
    }

    #[test]
    fn committed_settings_warning_is_distinct_from_precommit_failure() {
        let scratch = Scratch::new();
        let path = scratch.path("settings.json");
        let missing_bin = scratch.path("missing-claude");
        let mut settings = AppSettings {
            web_relay_on: Some(true),
            web_relay_url: Some("https://relay.example".to_string()),
            web_relay_key: Some("SAVED_KEY".to_string()),
            ..AppSettings::default()
        };
        settings.bin_overrides.insert(
            "claudeBin".to_string(),
            Value::String(missing_bin.to_string_lossy().into_owned()),
        );

        let warning = persist_settings_to(&mut settings, &path)
            .expect("a rejected binary is a committed warning")
            .expect("the rejected field is reported");
        assert!(warning.contains("claudeBin"));
        let saved: AppSettings =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(!saved.bin_overrides.contains_key("claudeBin"));
        assert_eq!(
            crate::relay::autostart_target(&saved),
            Some(("https://relay.example".to_string(), "SAVED_KEY".to_string())),
            "the committed target and enabled switch survive the warning"
        );
    }

    #[test]
    fn titlebar_defaults_to_native_and_round_trips() {
        assert_eq!(AppSettings::default().titlebar, "native");
        let parsed: AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(
            parsed.titlebar, "native",
            "旧设置文件没有 titlebar 字段 → 视为 native，不能崩"
        );
        let mac: AppSettings = serde_json::from_str(r#"{"titlebar":"mac"}"#).unwrap();
        assert_eq!(mac.titlebar, "mac");
        assert!(serde_json::to_string(&mac).unwrap().contains("\"titlebar\":\"mac\""));
    }

    #[test]
    fn invalid_proxy_is_reported_before_settings_are_committed() {
        let scratch = Scratch::new();
        let path = scratch.path("settings.json");
        let mut settings = AppSettings {
            system_proxy_enabled: true,
            system_proxy_url: Some("file:///not-a-network-proxy".to_string()),
            ..AppSettings::default()
        };

        let error = persist_settings_to(&mut settings, &path).unwrap_err();
        assert!(error.contains("unsupported scheme"));
        assert!(
            !path.exists(),
            "pre-commit validation must not write settings"
        );
    }

    /// The key box shows `--------` while authorization is off; a placeholder
    /// (or an empty field, or no configured key at all) must never pair.
    #[test]
    fn pairing_key_rejects_placeholders() {
        assert!(pairing_key_matches("BCDF2345", "bcdf2345"));
        assert!(!pairing_key_matches("BCDF2345", "--------"));
        assert!(!pairing_key_matches("BCDF2345", ""));
        assert!(!pairing_key_matches("", "--------"));
        assert!(!pairing_key_matches("", ""));
        assert!(!pairing_key_matches("BCDF2345", "BCDF2346"));
    }

    #[test]
    fn home_override_expands_tilde_and_rejects_temp() {
        // Tilde expansion is race-safe to assert directly: parallel scanner
        // tests mutate HOME, so validating `~/...` here can spuriously hit
        // the temp-root rejection.
        let expanded = crate::open_app::expand_user_path("~/.codex-cli").unwrap();
        assert!(expanded.is_absolute());
        assert!(expanded.ends_with(".codex-cli"));

        // A fixed absolute path outside any temp root validates as-is.
        let ok = if cfg!(windows) {
            r"C:\ccgui-codex-home-probe"
        } else {
            "/opt/ccgui-codex-home-probe"
        };
        assert_eq!(validate_home_override(ok).unwrap(), std::path::PathBuf::from(ok));
        assert!(validate_home_override("/tmp/codex-home").is_err());
        assert!(validate_home_override("relative/codex").is_err());
    }

    /// The property the relay's whole gate rests on: a code opens exactly one
    /// pairing. The second device replaying the same string must be turned
    /// away, and the switch being off must admit nobody at all.
    #[test]
    fn a_pairing_key_is_spent_by_the_first_device() {
        let mut settings = AppSettings {
            web_auth_enabled: true,
            web_auth_key: Some("BCDF2345".to_string()),
            ..AppSettings::default()
        };

        assert!(
            spend_pair_key(&mut settings, "bcdf2345"),
            "the first device pairs"
        );
        let fresh = settings.web_auth_key.clone().unwrap();
        assert_ne!(fresh, "BCDF2345", "pairing mints a new code");
        assert!(
            !spend_pair_key(&mut settings, "BCDF2345"),
            "the spent code never pairs a second device"
        );
        assert_eq!(
            settings.web_auth_key.as_deref(),
            Some(fresh.as_str()),
            "a rejected attempt leaves the live code alone"
        );

        settings.web_auth_enabled = false;
        assert!(
            !spend_pair_key(&mut settings, &fresh),
            "with the switch off there is nothing to pair with"
        );
    }
}
#[tauri::command]
pub fn set_window_theme(
    app: tauri::AppHandle,
    dark: bool,
) -> Result<(), String> {
    // Only Windows consumes these; reference unconditionally so macOS/Linux
    // builds don't warn.
    let _ = (&app, dark);
    #[cfg(target_os = "windows")]
    {
        use tauri::{Manager, Theme};
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_theme(Some(if dark {
                Theme::Dark
            } else {
                Theme::Light
            }));
        }
    }
    Ok(())
}

/// 立即重启应用。用于「标题栏样式」这类在启动时按设置建窗、只能重启生效的选项。
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}
