use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Catalog discovery for the composer's `/` picker (ported from
/// desktop-cc-gui's claude_commands.rs, extended past the two Claude
/// scopes to the global skill roots of the other CLIs the app drives:
/// Codex, the cross-agent `~/.agents`, and Codex plugins). Two entry
/// kinds share the one trigger and stay distinct via `kind`:
///
/// - commands: `.claude/commands/**/*.md` — the CLI expands `/name args`
///   itself when the prompt is sent;
/// - skills: `skills/<name>/SKILL.md` under each scanned root — likewise
///   invoked as `/name` by the CLI.
///
/// Markdown stays on disk; only the metadata the menu renders crosses IPC.

/// What a `/` picker entry is: a custom slash command (markdown under
/// `commands/`) or a skill (a `SKILL.md` directory under `skills/`). The
/// two are never interchangeable in the menu — icons, badges and section
/// grouping key off this field.
#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SlashEntryKind {
    Command,
    Skill,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SlashCommandEntry {
    /// Slash-less name; commands join directory segments with `:`
    /// (`.claude/commands/aimax/plan.md` → `aimax:plan`), skills use the
    /// SKILL.md directory name.
    pub name: String,
    pub description: Option<String>,
    pub argument_hint: Option<String>,
    /// "workspace" (project `.claude/`) or "global" (CLI home).
    pub source: String,
    pub kind: SlashEntryKind,
}

fn sanitize_meta_value(value: &str) -> Option<String> {
    let mut val = value.trim().to_string();
    if val.len() >= 2 {
        let bytes = val.as_bytes();
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            val = val[1..val.len().saturating_sub(1)].to_string();
        }
    }
    let trimmed = val.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn parse_meta_line(line: &str, description: &mut Option<String>, argument_hint: &mut Option<String>) {
    let Some((key, value)) = line.split_once(':') else {
        return;
    };
    let key = key.trim().to_ascii_lowercase();
    let value = sanitize_meta_value(value);
    match key.as_str() {
        "description" => {
            if let Some(value) = value {
                *description = Some(value);
            }
        }
        "argument-hint" | "argument_hint" | "argumenthint" => {
            if let Some(value) = value {
                *argument_hint = Some(value);
            }
        }
        _ => {}
    }
}

/// YAML-ish frontmatter between `---` fences. Only the fields the menu
/// renders are read; a `name:` override is honored by the caller via
/// `name_override`. Unterminated frontmatter means the file has none.
fn parse_command_frontmatter(
    content: &str,
) -> (Option<String>, Option<String>, Option<String>) {
    let mut segments = content.split_inclusive('\n');
    let Some(first_segment) = segments.next() else {
        return (None, None, None);
    };
    if first_segment.trim_end_matches(['\r', '\n']).trim() != "---" {
        return (None, None, None);
    }
    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut argument_hint: Option<String> = None;
    for segment in segments {
        let line = segment.trim_end_matches(['\r', '\n']);
        let trimmed = line.trim();
        if trimmed == "---" {
            return (name, description, argument_hint);
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        // `name` is parsed inline (not via parse_meta_line) so the file can
        // override the path-derived command name.
        if let Some((key, value)) = trimmed.split_once(':') {
            if key.trim().eq_ignore_ascii_case("name") {
                if let Some(value) = sanitize_meta_value(value) {
                    name = Some(value);
                }
                continue;
            }
        }
        parse_meta_line(trimmed, &mut description, &mut argument_hint);
    }
    (None, None, None)
}

/// Path-derived command name: workspace-relative segments join with `:`,
/// the file stem is the last segment, README files are documentation, not
/// commands.
fn derive_command_name(path: &Path, root: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let mut parts: Vec<String> = relative
        .components()
        .filter_map(|component| component.as_os_str().to_str().map(|value| value.to_string()))
        .collect();
    if parts.is_empty() {
        return None;
    }
    let file_name = parts.pop()?;
    let stem = Path::new(&file_name).file_stem().and_then(|value| value.to_str())?;
    if stem.eq_ignore_ascii_case("readme") {
        return None;
    }
    parts.push(stem.to_string());
    Some(parts.join(":"))
}

fn discover_commands_in(dir: &Path, root: &Path, source: &str) -> Vec<SlashCommandEntry> {
    let mut out: Vec<SlashCommandEntry> = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_dir = std::fs::metadata(&path).map(|m| m.is_dir()).unwrap_or(false);
        if is_dir {
            out.extend(discover_commands_in(&path, root, source));
            continue;
        }
        let is_md = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_md {
            continue;
        }
        if path
            .file_stem()
            .and_then(|value| value.to_str())
            .map(|stem| stem.eq_ignore_ascii_case("readme"))
            .unwrap_or(false)
        {
            continue;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let (name, description, argument_hint) = parse_command_frontmatter(&content);
        let resolved = name.or_else(|| derive_command_name(&path, root));
        let Some(resolved) = resolved else {
            continue;
        };
        let normalized = resolved.trim().trim_start_matches('/').to_string();
        if normalized.is_empty() {
            continue;
        }
        out.push(SlashCommandEntry {
            name: normalized,
            description,
            argument_hint,
            source: source.to_string(),
            kind: SlashEntryKind::Command,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Merge source lists in priority order: the first source defining a
/// (lowercase) name wins, so workspace entries shadow global ones. Applied
/// per kind — a command and a skill may share a name without shadowing
/// each other.
fn merge_entries_by_priority(sources: Vec<Vec<SlashCommandEntry>>) -> Vec<SlashCommandEntry> {
    let mut merged: Vec<SlashCommandEntry> = Vec::new();
    let mut seen_names: HashSet<String> = HashSet::new();
    for source in sources {
        for entry in source {
            if seen_names.insert(entry.name.to_ascii_lowercase()) {
                merged.push(entry);
            }
        }
    }
    merged.sort_by(|a, b| a.name.cmp(&b.name));
    merged
}

/// Command directories in priority order: the workspace's `.claude/commands`
/// first, then the CLI config home's `commands` (honors CLAUDE_CONFIG_DIR —
/// the same root the history scanner reads).
fn commands_dirs(workspace_root: &Path) -> Vec<(PathBuf, &'static str)> {
    let mut dirs: Vec<(PathBuf, &'static str)> = Vec::new();
    let workspace_dir = workspace_root.join(".claude").join("commands");
    if workspace_dir.is_dir() {
        dirs.push((workspace_dir, "workspace"));
    }
    let global_dir = crate::engine::engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude").join("commands");
    if global_dir.is_dir() {
        dirs.push((global_dir, "global"));
    }
    dirs
}

/// Skill directories in priority order: the workspace's `.claude/skills`
/// first, then the global homes of every CLI the picker can drive —
/// Claude (`$CLAUDE_CONFIG_DIR/skills`), Codex (`$CODEX_HOME/skills` plus
/// its built-in `.system` tree), the cross-agent `~/.agents/skills`, and
/// Codex plugin-bundled skills under `$CODEX_HOME/plugins/cache`. `is_dir`
/// follows symlinks, so cc-switch-managed links inside these roots resolve.
fn skills_dirs(workspace_root: &Path) -> Vec<(PathBuf, &'static str)> {
    let mut dirs: Vec<(PathBuf, &'static str)> = Vec::new();
    let workspace_dir = workspace_root.join(".claude").join("skills");
    if workspace_dir.is_dir() {
        dirs.push((workspace_dir, "workspace"));
    }
    let claude_global =
        crate::engine::engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude").join("skills");
    if claude_global.is_dir() {
        dirs.push((claude_global, "global"));
    }
    let codex_home = crate::engine::codex_home();
    let codex_skills = codex_home.join("skills");
    // `.system` holds Codex's built-in skills one level deeper than the
    // personal ones; both are global scope.
    for dir in [codex_skills, codex_home.join("skills").join(".system")] {
        if dir.is_dir() {
            dirs.push((dir, "global"));
        }
    }
    let agents_dir = crate::engine::engine_home(None, ".agents").join("skills");
    if agents_dir.is_dir() {
        dirs.push((agents_dir, "global"));
    }
    dirs.extend(codex_plugin_skills_dirs(&codex_home));
    dirs
}

/// Codex plugin skills: each plugin ships a `skills/` directory inside its
/// version dir under `plugins/cache`, and the nesting between `cache` and
/// the version dir isn't fixed — walk the tree (bounded) and collect every
/// `skills` directory found.
fn codex_plugin_skills_dirs(codex_home: &Path) -> Vec<(PathBuf, &'static str)> {
    let cache = codex_home.join("plugins").join("cache");
    let mut out: Vec<(PathBuf, &'static str)> = Vec::new();
    let mut stack = vec![(cache, 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        if depth > 8 {
            continue;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let is_dir = std::fs::metadata(&path)
                .map(|meta| meta.is_dir())
                .unwrap_or(false);
            if !is_dir {
                continue;
            }
            if entry.file_name() == "skills" {
                out.push((path, "plugin"));
            } else {
                stack.push((path, depth + 1));
            }
        }
    }
    out.sort();
    out
}

/// Discover skills directly under a skills dir: each child directory with
/// a `SKILL.md` is one skill. Name comes from the frontmatter `name:`
/// override, else the directory name; description from frontmatter. Skills
/// take no argument hint — the CLI resolves the body itself.
fn discover_skills_in(dir: &Path, source: &str) -> Vec<SlashCommandEntry> {
    let mut out: Vec<SlashCommandEntry> = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let skill_dir = entry.path();
        let is_dir = std::fs::metadata(&skill_dir).map(|m| m.is_dir()).unwrap_or(false);
        if !is_dir {
            continue;
        }
        let manifest = skill_dir.join("SKILL.md");
        let content = match std::fs::read_to_string(&manifest) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let (name, description, _argument_hint) = parse_command_frontmatter(&content);
        let resolved = name.or_else(|| {
            skill_dir
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.to_string())
        });
        let Some(resolved) = resolved else {
            continue;
        };
        let normalized = resolved.trim().trim_start_matches('/').to_string();
        if normalized.is_empty() {
            continue;
        }
        out.push(SlashCommandEntry {
            name: normalized,
            description,
            argument_hint: None,
            source: source.to_string(),
            kind: SlashEntryKind::Skill,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn list_slash_commands_blocking(
    db: &crate::db::Db,
    path: &str,
) -> Result<Vec<SlashCommandEntry>, String> {
    let root = crate::files::ensure_allowed(path, db)?;
    let command_sources = commands_dirs(&root)
        .iter()
        .map(|(dir, source)| discover_commands_in(dir, dir, source))
        .collect();
    let skill_sources = skills_dirs(&root)
        .iter()
        .map(|(dir, source)| discover_skills_in(dir, source))
        .collect();
    // Commands first, skills after: the menu groups by kind in catalog
    // order, and per-kind merging keeps a same-named command and skill
    // from shadowing each other.
    let mut merged = merge_entries_by_priority(command_sources);
    merged.extend(merge_entries_by_priority(skill_sources));
    Ok(merged)
}

#[tauri::command]
pub async fn list_slash_commands(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
) -> Result<Vec<SlashCommandEntry>, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || list_slash_commands_blocking(&db, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccgui-slash-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn derives_namespaced_names_from_directories() {
        let root = scratch_dir("derive");
        let nested = root.join("aimax");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("plan.md"), "# Plan\n").unwrap();
        fs::write(root.join("commit.md"), "# Commit\n").unwrap();
        fs::write(root.join("README.md"), "docs, not a command").unwrap();
        fs::write(root.join("notes.txt"), "not markdown").unwrap();

        let entries = discover_commands_in(&root, &root, "workspace");
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["aimax:plan", "commit"]);
    }

    #[test]
    fn frontmatter_overrides_name_and_carries_description() {
        let root = scratch_dir("frontmatter");
        fs::write(
            root.join("x.md"),
            "---\nname: custom:run\ndescription: \"运行流程\"\nargument-hint: [target]\n---\nbody\n",
        )
        .unwrap();
        let entries = discover_commands_in(&root, &root, "global");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "custom:run");
        assert_eq!(entries[0].description.as_deref(), Some("运行流程"));
        assert_eq!(entries[0].argument_hint.as_deref(), Some("[target]"));
    }

    #[test]
    fn workspace_shadows_global_on_name_collision() {
        let merged = merge_entries_by_priority(vec![
            vec![SlashCommandEntry {
                name: "plan".into(),
                description: Some("workspace".into()),
                argument_hint: None,
                source: "workspace".into(),
                kind: SlashEntryKind::Command,
            }],
            vec![SlashCommandEntry {
                name: "Plan".into(),
                description: Some("global".into()),
                argument_hint: None,
                source: "global".into(),
                kind: SlashEntryKind::Command,
            }],
        ]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].description.as_deref(), Some("workspace"));
    }

    #[test]
    fn discovers_skills_from_skill_md_directories() {
        let root = scratch_dir("skills");
        let review = root.join("code-review");
        fs::create_dir_all(&review).unwrap();
        fs::write(
            review.join("SKILL.md"),
            "---\ndescription: \"审查代码\"\n---\nbody\n",
        )
        .unwrap();
        let named = root.join("renamed");
        fs::create_dir_all(&named).unwrap();
        fs::write(named.join("SKILL.md"), "---\nname: custom-skill\n---\n").unwrap();
        let no_manifest = root.join("no-manifest");
        fs::create_dir_all(&no_manifest).unwrap();
        fs::write(root.join("loose.md"), "not a skill dir").unwrap();

        let entries = discover_skills_in(&root, "workspace");
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["code-review", "custom-skill"]);
        assert!(entries.iter().all(|e| e.kind == SlashEntryKind::Skill));
        assert_eq!(entries[0].description.as_deref(), Some("审查代码"));
        assert!(entries.iter().all(|e| e.argument_hint.is_none()));
    }

    #[test]
    fn collects_plugin_skills_dirs_at_any_nesting() {
        let root = scratch_dir("plugin-cache");
        let cache = root.join("plugins").join("cache");
        // Two layouts seen in the wild: cache/<plugin>/<version>/skills and
        // cache/<marketplace>/<plugin>/<version>/skills.
        let flat = cache.join("gsd").join("1.2.0").join("skills");
        let nested = cache.join("market").join("aimax").join("0.3.1").join("skills");
        fs::create_dir_all(&flat).unwrap();
        fs::create_dir_all(&nested).unwrap();
        // A `skills` file (not dir) and a version dir without skills are ignored.
        fs::write(cache.join("gsd").join("skills"), "not a dir").unwrap();
        fs::create_dir_all(cache.join("empty").join("9.9.9")).unwrap();

        let dirs = codex_plugin_skills_dirs(&root);
        let paths: Vec<&Path> = dirs.iter().map(|(p, _)| p.as_path()).collect();
        assert_eq!(paths, vec![flat.as_path(), nested.as_path()]);
        assert!(dirs.iter().all(|(_, source)| *source == "plugin"));
        assert!(codex_plugin_skills_dirs(&root.join("missing")).is_empty());
    }
}
