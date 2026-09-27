use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Custom prompts (提示词) for the composer `!` picker (ported from
/// desktop-cc-gui's prompts.rs, re-rooted: workspace scope now lives at
/// `<workspace>/.ccgui/prompts/*.md` and global scope at
/// `~/.ccgui-next/prompts/*.md`, next to the rest of this app's state).
/// Each prompt is a markdown file whose optional `---` frontmatter carries
/// `description` / `argument-hint`; the file stem is the prompt name and the
/// absolute path round-trips through the frontend as the update/delete key.

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomPromptEntry {
    /// File stem (`plan.md` → `plan`).
    pub name: String,
    /// Absolute file path; the frontend sends it back as `promptPath`.
    pub path: String,
    pub description: Option<String>,
    pub argument_hint: Option<String>,
    /// Markdown body without the frontmatter block.
    pub content: String,
    /// "workspace" or "global".
    pub scope: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptsDirs {
    pub workspace: String,
    pub global: String,
}

/// Partial edits for prompts_update: absent keys keep the stored value,
/// `Some("")` on description/argumentHint clears it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptUpdates {
    pub name: Option<String>,
    pub description: Option<String>,
    pub argument_hint: Option<String>,
    pub content: Option<String>,
}

fn workspace_prompts_dir(root: &Path) -> PathBuf {
    root.join(".ccgui").join("prompts")
}

fn global_prompts_dir() -> PathBuf {
    crate::paths::app_home().join("prompts")
}

/// Both scopes' directories for a workspace root, workspace first. The
/// workspace root itself must pass the same workspace/grant check the
/// file commands use, so a web client cannot point `path` at an arbitrary
/// directory.
fn prompt_roots(path: &str, db: &crate::db::Db) -> Result<Vec<(PathBuf, &'static str)>, String> {
    let root = crate::files::ensure_allowed(path, db)?;
    Ok(vec![
        (workspace_prompts_dir(&root), "workspace"),
        (global_prompts_dir(), "global"),
    ])
}

/// Every prompt_path mutation must resolve to a file inside one of the two
/// scope directories — canonicalized on both sides so `..` segments and
/// symlinked parents cannot escape.
fn ensure_within_roots(path: &Path, roots: &[(PathBuf, &'static str)]) -> Result<(), String> {
    let canonical = path
        .canonicalize()
        .map_err(|_| "Invalid prompt path.".to_string())?;
    for (root, _) in roots {
        if let Ok(canonical_root) = root.canonicalize() {
            if canonical.starts_with(&canonical_root) {
                return Ok(());
            }
        }
    }
    Err("Prompt path is not within allowed directories.".to_string())
}

fn scope_of(path: &Path, roots: &[(PathBuf, &'static str)]) -> Option<&'static str> {
    for (root, scope) in roots {
        if path.starts_with(root) {
            return Some(scope);
        }
    }
    None
}

#[cfg(unix)]
fn is_cross_device_error(err: &std::io::Error) -> bool {
    err.raw_os_error() == Some(libc::EXDEV)
}

#[cfg(not(unix))]
fn is_cross_device_error(_err: &std::io::Error) -> bool {
    false
}

fn move_file(src: &Path, dest: &Path) -> Result<(), String> {
    match fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(err) if is_cross_device_error(&err) => {
            fs::copy(src, dest).map_err(|err| err.to_string())?;
            fs::remove_file(src).map_err(|err| err.to_string())
        }
        Err(err) => Err(err.to_string()),
    }
}

/// `---`-fenced frontmatter + body, parsed with the same meta-line rules the
/// `/` picker uses (quote stripping, `argument-hint` aliases). Unterminated
/// frontmatter means the file has none and everything is body.
fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>, String) {
    let mut segments = content.split_inclusive('\n');
    let Some(first_segment) = segments.next() else {
        return (None, None, String::new());
    };
    if first_segment.trim_end_matches(['\r', '\n']).trim() != "---" {
        return (None, None, content.to_string());
    }
    let mut description: Option<String> = None;
    let mut argument_hint: Option<String> = None;
    let mut consumed = first_segment.len();
    for segment in segments {
        let line = segment.trim_end_matches(['\r', '\n']);
        let trimmed = line.trim();
        consumed += segment.len();
        if trimmed == "---" {
            let body = if consumed >= content.len() {
                String::new()
            } else {
                content[consumed..].to_string()
            };
            return (description, argument_hint, body);
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        crate::slash_commands::parse_meta_line(trimmed, &mut description, &mut argument_hint);
    }
    (None, None, content.to_string())
}

fn build_prompt_contents(
    description: Option<&str>,
    argument_hint: Option<&str>,
    content: &str,
) -> String {
    let description = description.map(str::trim).filter(|value| !value.is_empty());
    let argument_hint = argument_hint
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if description.is_none() && argument_hint.is_none() {
        return content.to_string();
    }
    let mut output = String::from("---\n");
    if let Some(description) = description {
        output.push_str(&format!(
            "description: \"{}\"\n",
            description.replace('"', "\\\"")
        ));
    }
    if let Some(argument_hint) = argument_hint {
        output.push_str(&format!(
            "argument-hint: \"{}\"\n",
            argument_hint.replace('"', "\\\"")
        ));
    }
    output.push_str("---\n");
    output.push_str(content);
    output
}

/// Prompt names become file stems, so whitespace and path separators are
/// rejected up front.
fn sanitize_prompt_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Prompt name is required.".to_string());
    }
    if trimmed.chars().any(|ch| ch.is_whitespace()) {
        return Err("Prompt name cannot include whitespace.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Prompt name cannot include path separators.".to_string());
    }
    Ok(trimmed.to_string())
}

fn read_prompt_entry(path: &Path, scope: &str) -> Option<CustomPromptEntry> {
    let name = path.file_stem()?.to_str()?.to_string();
    let raw = fs::read_to_string(path).ok()?;
    let (description, argument_hint, body) = parse_frontmatter(&raw);
    Some(CustomPromptEntry {
        name,
        path: path.to_string_lossy().to_string(),
        description,
        argument_hint,
        content: body,
        scope: scope.to_string(),
    })
}

fn discover_prompts_in(dir: &Path, scope: &str) -> Vec<CustomPromptEntry> {
    let mut out: Vec<CustomPromptEntry> = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_file = fs::metadata(&path).map(|m| m.is_file()).unwrap_or(false);
        let is_md = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_file || !is_md {
            continue;
        }
        if let Some(entry) = read_prompt_entry(&path, scope) {
            out.push(entry);
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn prompts_list_blocking(db: &crate::db::Db, path: &str) -> Result<Vec<CustomPromptEntry>, String> {
    let roots = prompt_roots(path, db)?;
    let mut out = Vec::new();
    for (dir, scope) in &roots {
        let _ = fs::create_dir_all(dir);
        // Workspace entries come first; both lists are name-sorted.
        out.extend(discover_prompts_in(dir, scope));
    }
    Ok(out)
}

fn prompts_dirs_blocking(db: &crate::db::Db, path: &str) -> Result<PromptsDirs, String> {
    let roots = prompt_roots(path, db)?;
    for (dir, _) in &roots {
        fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    }
    Ok(PromptsDirs {
        workspace: roots[0].0.to_string_lossy().to_string(),
        global: roots[1].0.to_string_lossy().to_string(),
    })
}

#[allow(clippy::too_many_arguments)]
fn prompts_create_blocking(
    db: &crate::db::Db,
    path: &str,
    scope: &str,
    name: &str,
    description: Option<String>,
    argument_hint: Option<String>,
    content: String,
) -> Result<CustomPromptEntry, String> {
    let name = sanitize_prompt_name(name)?;
    let roots = prompt_roots(path, db)?;
    let Some((dir, scope)) = roots.iter().find(|(_, s)| *s == scope) else {
        return Err("Invalid scope.".to_string());
    };
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    let target = dir.join(format!("{name}.md"));
    if target.exists() {
        return Err("Prompt already exists.".to_string());
    }
    let body = build_prompt_contents(description.as_deref(), argument_hint.as_deref(), &content);
    fs::write(&target, body).map_err(|err| err.to_string())?;
    Ok(CustomPromptEntry {
        name,
        path: target.to_string_lossy().to_string(),
        description: description
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        argument_hint: argument_hint
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        content,
        scope: scope.to_string(),
    })
}

fn prompts_update_blocking(
    db: &crate::db::Db,
    path: &str,
    prompt_path: &str,
    updates: PromptUpdates,
) -> Result<CustomPromptEntry, String> {
    let roots = prompt_roots(path, db)?;
    let target = PathBuf::from(prompt_path);
    if !target.exists() {
        return Err("Prompt not found.".to_string());
    }
    ensure_within_roots(&target, &roots)?;
    let raw = fs::read_to_string(&target).map_err(|err| err.to_string())?;
    let (old_description, old_argument_hint, old_body) = parse_frontmatter(&raw);
    let old_name = target
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("Invalid prompt path.".to_string())?
        .to_string();

    // Absent keys keep the stored value; Some("") on the meta fields clears
    // them through the trim-to-empty normalization below.
    let name = match updates.name {
        Some(name) => sanitize_prompt_name(&name)?,
        None => old_name,
    };
    let merge_meta = |update: Option<String>, old: Option<String>| -> Option<String> {
        match update {
            Some(value) => {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            }
            None => old,
        }
    };
    let description = merge_meta(updates.description, old_description);
    let argument_hint = merge_meta(updates.argument_hint, old_argument_hint);
    let content = updates.content.unwrap_or(old_body);

    let dir = target
        .parent()
        .ok_or("Unable to resolve prompt directory.".to_string())?;
    let next_path = dir.join(format!("{name}.md"));
    if next_path != target && next_path.exists() {
        return Err("Prompt with that name already exists.".to_string());
    }
    let body = build_prompt_contents(description.as_deref(), argument_hint.as_deref(), &content);
    fs::write(&next_path, body).map_err(|err| err.to_string())?;
    if next_path != target {
        fs::remove_file(&target).map_err(|err| err.to_string())?;
    }
    let scope = scope_of(&next_path, &roots)
        .ok_or("Prompt path is not within allowed directories.".to_string())?;
    Ok(CustomPromptEntry {
        name,
        path: next_path.to_string_lossy().to_string(),
        description,
        argument_hint,
        content,
        scope: scope.to_string(),
    })
}

fn prompts_delete_blocking(
    db: &crate::db::Db,
    path: &str,
    prompt_path: &str,
) -> Result<bool, String> {
    let roots = prompt_roots(path, db)?;
    let target = PathBuf::from(prompt_path);
    if !target.exists() {
        return Ok(false);
    }
    ensure_within_roots(&target, &roots)?;
    fs::remove_file(&target).map_err(|err| err.to_string())?;
    Ok(true)
}

fn prompts_move_blocking(
    db: &crate::db::Db,
    path: &str,
    prompt_path: &str,
    scope: &str,
) -> Result<CustomPromptEntry, String> {
    let roots = prompt_roots(path, db)?;
    let target = PathBuf::from(prompt_path);
    if !target.exists() {
        return Err("Prompt not found.".to_string());
    }
    ensure_within_roots(&target, &roots)?;
    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("Invalid prompt path.".to_string())?;
    let Some((dest_dir, dest_scope)) = roots.iter().find(|(_, s)| *s == scope) else {
        return Err("Invalid scope.".to_string());
    };
    let next_path = dest_dir.join(file_name);
    if next_path == target {
        return Err("Prompt is already in that scope.".to_string());
    }
    if next_path.exists() {
        return Err("Prompt with that name already exists.".to_string());
    }
    fs::create_dir_all(dest_dir).map_err(|err| err.to_string())?;
    move_file(&target, &next_path)?;
    read_prompt_entry(&next_path, dest_scope).ok_or("Moved prompt could not be read.".to_string())
}

#[tauri::command]
pub async fn prompts_list(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
) -> Result<Vec<CustomPromptEntry>, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || prompts_list_blocking(&db, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn prompts_dirs(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
) -> Result<PromptsDirs, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || prompts_dirs_blocking(&db, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn prompts_create(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
    scope: String,
    name: String,
    description: Option<String>,
    argument_hint: Option<String>,
    content: String,
) -> Result<CustomPromptEntry, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || {
        prompts_create_blocking(
            &db,
            &path,
            &scope,
            &name,
            description,
            argument_hint,
            content,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn prompts_update(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
    prompt_path: String,
    updates: PromptUpdates,
) -> Result<CustomPromptEntry, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || {
        prompts_update_blocking(&db, &path, &prompt_path, updates)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn prompts_delete(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
    prompt_path: String,
) -> Result<bool, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || prompts_delete_blocking(&db, &path, &prompt_path))
        .await
        .map_err(|e| e.to_string())?
}

// ---- Legacy import -------------------------------------------------------

/// Copy `*.md` files from `src` into `dest`, skipping names that already
/// exist (files already in the new app always win). A missing or unreadable
/// source dir is zero copies, not an error; `dest` is created lazily so no
/// `.ccgui` directory appears in projects that have nothing to import.
/// Individual copy failures are logged and skipped — one unreadable file
/// must not strand the rest of the import.
fn copy_prompt_files(src: &Path, dest: &Path) -> usize {
    let Ok(entries) = fs::read_dir(src) else {
        return 0;
    };
    let mut copied = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let is_md = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !path.is_file() || !is_md {
            continue;
        }
        let target = dest.join(entry.file_name());
        if target.exists() {
            continue;
        }
        match fs::create_dir_all(dest).and_then(|_| fs::copy(&path, &target).map(|_| ())) {
            Ok(()) => copied += 1,
            Err(err) => {
                eprintln!(
                    "[prompts] skipping {} during legacy import: {err}",
                    path.display()
                )
            }
        }
    }
    copied
}

/// The legacy workspace's codex-home override (`settings.codexHome`,
/// inherited from the parent entry): `~` expands against the home dir and
/// relative values resolve against the owning workspace's path — the same
/// rules the legacy resolver used. `None` when absent, or when it resolves
/// to the default home whose prompts the global copy already handles.
fn legacy_custom_codex_home(
    entry: &serde_json::Value,
    by_id: &std::collections::HashMap<&str, &serde_json::Value>,
    legacy_global_dir: &Path,
) -> Option<PathBuf> {
    let (raw, base) = match entry
        .pointer("/settings/codexHome")
        .and_then(serde_json::Value::as_str)
    {
        Some(value) => (
            value,
            entry.get("path").and_then(serde_json::Value::as_str)?,
        ),
        None => {
            let parent = entry
                .get("parentId")
                .and_then(serde_json::Value::as_str)
                .and_then(|id| by_id.get(id))?;
            (
                parent
                    .pointer("/settings/codexHome")
                    .and_then(serde_json::Value::as_str)?,
                parent.get("path").and_then(serde_json::Value::as_str)?,
            )
        }
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let expanded = if trimmed == "~" {
        crate::paths::home_dir()
    } else if let Some(rest) = trimmed.strip_prefix("~/") {
        crate::paths::home_dir().join(rest)
    } else {
        PathBuf::from(trimmed)
    };
    let resolved = if expanded.is_absolute() {
        expanded
    } else {
        PathBuf::from(base).join(expanded)
    };
    if legacy_global_dir.parent() == Some(resolved.as_path()) {
        return None;
    }
    Some(resolved)
}

/// One-time import of legacy desktop-cc-gui custom prompts. Two source
/// shapes:
/// - global: `<codex home>/prompts/*.md` — shared with the Codex CLI, so
///   files are COPIED (never moved) into the new global prompts dir;
/// - workspace: `<legacy app-data>/workspaces/<id>/prompts/*.md`, mapped to
///   `<workspace>/.ccgui/prompts` through the legacy workspaces.json id→path
///   list. The DB cannot provide that mapping: path conflicts during the
///   workspace import keep the new app's row id.
/// Worktree children (parentId) were skipped by the workspace import, but
/// their prompts still land in their own path's `.ccgui/prompts`, ready for
/// when the user re-adds them. Entries with a custom codex home also pull
/// that home's prompts into their workspace scope — that was their
/// per-workspace "global". Workspaces whose path no longer exists are
/// skipped. Guarded by a meta flag so deletions in the new app stick.
pub fn import_legacy_prompts_once(db: &crate::db::Db) -> Result<(), String> {
    import_legacy_prompts_from(
        db,
        &crate::paths::legacy_workspaces_path(),
        &crate::paths::legacy_app_data_dir(),
        &crate::paths::legacy_global_prompts_dir(),
        &global_prompts_dir(),
    )
}

fn import_legacy_prompts_from(
    db: &crate::db::Db,
    legacy_workspaces_path: &Path,
    legacy_app_data: &Path,
    legacy_global_dir: &Path,
    dest_global_dir: &Path,
) -> Result<(), String> {
    const FLAG: &str = "legacy_prompts_import_v1";
    {
        let conn = db.0.lock();
        let done = conn
            .query_row("SELECT value FROM meta WHERE key=?1", [FLAG], |r| {
                r.get::<_, String>(0)
            })
            .ok();
        if done.is_some() {
            return Ok(());
        }
    }

    copy_prompt_files(legacy_global_dir, dest_global_dir);

    if legacy_workspaces_path.is_file() {
        let content = std::fs::read_to_string(legacy_workspaces_path)
            .map_err(|e| format!("read {}: {e}", legacy_workspaces_path.display()))?;
        let legacy: Vec<serde_json::Value> = serde_json::from_str(&content)
            .map_err(|e| format!("parse {}: {e}", legacy_workspaces_path.display()))?;
        let by_id: std::collections::HashMap<&str, &serde_json::Value> = legacy
            .iter()
            .filter_map(|w| {
                w.get("id")
                    .and_then(serde_json::Value::as_str)
                    .map(|id| (id, w))
            })
            .collect();
        for w in &legacy {
            let Some(id) = w.get("id").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let Some(path) = w
                .get("path")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|p| !p.is_empty())
            else {
                continue;
            };
            let root = PathBuf::from(path);
            if !root.is_dir() {
                continue;
            }
            let dest = workspace_prompts_dir(&root);
            copy_prompt_files(
                &legacy_app_data.join("workspaces").join(id).join("prompts"),
                &dest,
            );
            if let Some(home) = legacy_custom_codex_home(w, &by_id, legacy_global_dir) {
                copy_prompt_files(&home.join("prompts"), &dest);
            }
        }
    }

    // Flag set even without legacy data (fresh machine): never re-probe.
    let conn = db.0.lock();
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES(?1, '1')",
        [FLAG],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn prompts_move(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
    prompt_path: String,
    scope: String,
) -> Result<CustomPromptEntry, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || {
        prompts_move_blocking(&db, &path, &prompt_path, &scope)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    // The workspace/global split is exercised through the raw helpers with
    // scratch dirs; prompt_roots' ensure_allowed check needs a live Db and
    // is covered by the desktop smoke path instead.

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccgui-prompts-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn scratch_roots(name: &str) -> (PathBuf, Vec<(PathBuf, &'static str)>) {
        let root = scratch_dir(name);
        let roots = vec![
            (workspace_prompts_dir(&root), "workspace"),
            (root.join("global"), "global"),
        ];
        for (dir, _) in &roots {
            fs::create_dir_all(dir).unwrap();
        }
        (root, roots)
    }

    #[test]
    fn frontmatter_parsing() {
        let (description, hint, body) = parse_frontmatter(
            "---\ndescription: \"计划流程\"\nargument-hint: [target]\n---\n正文\n",
        );
        assert_eq!(description.as_deref(), Some("计划流程"));
        assert_eq!(hint.as_deref(), Some("[target]"));
        assert_eq!(body, "正文\n");

        // No fence → whole file is body.
        let (description, hint, body) = parse_frontmatter("plain body\n");
        assert_eq!(description, None);
        assert_eq!(hint, None);
        assert_eq!(body, "plain body\n");

        // Unterminated fence → treated as body, meta discarded.
        let (description, _, body) = parse_frontmatter("---\ndescription: x\nnever closed\n");
        assert_eq!(description, None);
        assert_eq!(body, "---\ndescription: x\nnever closed\n");
    }

    #[test]
    fn prompt_name_validation() {
        assert!(sanitize_prompt_name("  ").is_err());
        assert!(sanitize_prompt_name("has space").is_err());
        assert!(sanitize_prompt_name("a/b").is_err());
        assert!(sanitize_prompt_name("a\\b").is_err());
        assert_eq!(sanitize_prompt_name(" plan ").unwrap(), "plan");
    }

    #[test]
    fn create_list_update_delete_move_round_trip() {
        let (_root, roots) = scratch_roots("roundtrip");
        let workspace_dir = roots[0].0.clone();
        let global_dir = roots[1].0.clone();

        // create (through the same helpers the command uses)
        let name = sanitize_prompt_name("plan").unwrap();
        let target = workspace_dir.join(format!("{name}.md"));
        let body = build_prompt_contents(Some("计划"), Some("[t]"), "正文\n");
        fs::write(&target, body).unwrap();

        let entries = discover_prompts_in(&workspace_dir, "workspace");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "plan");
        assert_eq!(entries[0].description.as_deref(), Some("计划"));
        assert_eq!(entries[0].argument_hint.as_deref(), Some("[t]"));
        assert_eq!(entries[0].content, "正文\n");

        // update = rewrite with merged meta + rename
        let renamed = workspace_dir.join("plan-v2.md");
        let body = build_prompt_contents(None, None, "新正文\n");
        fs::write(&renamed, body).unwrap();
        fs::remove_file(&target).unwrap();
        let entry = read_prompt_entry(&renamed, "workspace").unwrap();
        assert_eq!(entry.name, "plan-v2");
        assert_eq!(entry.description, None);
        assert_eq!(entry.content, "新正文\n");

        // move to global
        let dest = global_dir.join("plan-v2.md");
        move_file(&renamed, &dest).unwrap();
        assert!(!renamed.exists());
        let entry = read_prompt_entry(&dest, "global").unwrap();
        assert_eq!(entry.scope, "global");
        assert_eq!(entry.content, "新正文\n");

        // delete
        fs::remove_file(&dest).unwrap();
        assert!(discover_prompts_in(&global_dir, "global").is_empty());
    }

    #[test]
    fn rejects_paths_outside_prompt_roots() {
        let (root, roots) = scratch_roots("escape");
        let outside = root.join("outside.md");
        fs::write(&outside, "not a prompt").unwrap();
        assert!(ensure_within_roots(&outside, &roots).is_err());

        // `..` escaping the prompts dir is rejected after canonicalization.
        let escape = roots[0].0.join("..").join("outside.md");
        assert!(ensure_within_roots(&escape, &roots).is_err());

        // A real prompt inside the workspace dir passes.
        let inside = roots[0].0.join("ok.md");
        fs::write(&inside, "body").unwrap();
        assert!(ensure_within_roots(&inside, &roots).is_ok());
    }

    #[test]
    fn legacy_import_copies_global_workspace_and_custom_home_prompts() {
        let root = scratch_dir("legacy-import");
        let db = crate::db::Db::open_at(&root.join("app.db")).unwrap();

        // Legacy tree: default codex-home prompts, one workspace's prompts
        // under the old app-data dir, and a custom codex home for that
        // workspace.
        let legacy_global = root.join("legacy-global/prompts");
        let legacy_app_data = root.join("legacy-app-data");
        let project = root.join("project");
        let custom_home = root.join("custom-home");
        fs::create_dir_all(&legacy_global).unwrap();
        fs::create_dir_all(legacy_app_data.join("workspaces/w1/prompts")).unwrap();
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(custom_home.join("prompts")).unwrap();
        fs::write(legacy_global.join("g.md"), "global body").unwrap();
        fs::write(legacy_global.join("notes.txt"), "not a prompt").unwrap();
        fs::write(
            legacy_app_data.join("workspaces/w1/prompts/w.md"),
            "workspace body",
        )
        .unwrap();
        fs::write(custom_home.join("prompts/c.md"), "custom home body").unwrap();

        let workspaces_json = root.join("workspaces.json");
        // Serialize, never interpolate: a Windows path lands backslashes inside
        // the JSON string literal ("C:\Users\…" → invalid escape) and the
        // fixture fails to parse before the import under test even runs.
        fs::write(
            &workspaces_json,
            serde_json::to_vec(&serde_json::json!([
                {
                    "id": "w1",
                    "path": project,
                    "settings": {"codexHome": custom_home},
                },
                {"id": "gone", "path": root.join("missing")},
            ]))
            .unwrap(),
        )
        .unwrap();

        let dest_global = root.join("new-global");
        import_legacy_prompts_from(
            &db,
            &workspaces_json,
            &legacy_app_data,
            &legacy_global,
            &dest_global,
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(dest_global.join("g.md")).unwrap(),
            "global body"
        );
        assert!(
            !dest_global.join("notes.txt").exists(),
            "only *.md files are imported"
        );
        assert_eq!(
            fs::read_to_string(project.join(".ccgui/prompts/w.md")).unwrap(),
            "workspace body"
        );
        assert_eq!(
            fs::read_to_string(project.join(".ccgui/prompts/c.md")).unwrap(),
            "custom home body",
            "a custom codex home's prompts land in the workspace scope"
        );
        assert!(
            legacy_global.join("g.md").exists(),
            "copy, never move: the Codex CLI still reads the legacy dir"
        );
        assert!(
            !root.join("missing/.ccgui").exists(),
            "workspaces whose path is gone are skipped"
        );
    }

    #[test]
    fn legacy_prompt_import_runs_once_and_never_overwrites() {
        let root = scratch_dir("legacy-import-once");
        let db = crate::db::Db::open_at(&root.join("app.db")).unwrap();
        let legacy_global = root.join("legacy-global/prompts");
        fs::create_dir_all(&legacy_global).unwrap();
        fs::write(legacy_global.join("g.md"), "legacy").unwrap();
        let dest_global = root.join("new-global");
        fs::create_dir_all(&dest_global).unwrap();
        fs::write(dest_global.join("g.md"), "mine").unwrap();
        let workspaces_json = root.join("workspaces.json");
        fs::write(&workspaces_json, "[]").unwrap();

        import_legacy_prompts_from(
            &db,
            &workspaces_json,
            &root.join("app-data"),
            &legacy_global,
            &dest_global,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(dest_global.join("g.md")).unwrap(),
            "mine",
            "a name conflict keeps the new app's file"
        );

        fs::write(legacy_global.join("late.md"), "late").unwrap();
        import_legacy_prompts_from(
            &db,
            &workspaces_json,
            &root.join("app-data"),
            &legacy_global,
            &dest_global,
        )
        .unwrap();
        assert!(
            !dest_global.join("late.md").exists(),
            "the flagged import never re-runs"
        );
    }

    #[test]
    fn legacy_custom_codex_home_resolution_rules() {
        let global = PathBuf::from("/def/prompts");

        // Resolving to the default home → None (the global copy covers it).
        let entry =
            serde_json::json!({"id": "w", "path": "/repo", "settings": {"codexHome": "/def"}});
        let by_id = std::collections::HashMap::new();
        assert_eq!(legacy_custom_codex_home(&entry, &by_id, &global), None);

        // Relative values resolve against the owning workspace's path.
        let entry =
            serde_json::json!({"id": "w", "path": "/repo", "settings": {"codexHome": ".codex"}});
        assert_eq!(
            legacy_custom_codex_home(&entry, &by_id, &global),
            Some(PathBuf::from("/repo/.codex"))
        );

        // A worktree child inherits the parent's override, resolved against
        // the parent's path.
        let parent =
            serde_json::json!({"id": "p", "path": "/parent", "settings": {"codexHome": "ph"}});
        let child = serde_json::json!({"id": "c", "path": "/child", "parentId": "p"});
        let by_id: std::collections::HashMap<&str, &serde_json::Value> =
            [("p", &parent), ("c", &child)].into_iter().collect();
        assert_eq!(
            legacy_custom_codex_home(&child, &by_id, &global),
            Some(PathBuf::from("/parent/ph"))
        );

        // No override anywhere → None.
        let plain = serde_json::json!({"id": "x", "path": "/x"});
        assert_eq!(legacy_custom_codex_home(&plain, &by_id, &global), None);
    }
}
