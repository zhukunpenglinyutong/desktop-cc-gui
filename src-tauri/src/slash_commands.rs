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

pub(crate) fn sanitize_meta_value(value: &str) -> Option<String> {
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

pub(crate) fn parse_meta_line(
    line: &str,
    description: &mut Option<String>,
    argument_hint: &mut Option<String>,
) {
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
fn parse_command_frontmatter(content: &str) -> (Option<String>, Option<String>, Option<String>) {
    let mut segments = content.split_inclusive('\n').peekable();
    let Some(first_segment) = segments.next() else {
        return (None, None, None);
    };
    if first_segment.trim_end_matches(['\r', '\n']).trim() != "---" {
        return (None, None, None);
    }
    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut argument_hint: Option<String> = None;
    while let Some(segment) = segments.next() {
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
            let key = key.trim().to_ascii_lowercase();
            let raw_val = value.trim();
            if key == "name" {
                if let Some(value) = sanitize_meta_value(raw_val) {
                    name = Some(value);
                }
                continue;
            } else if key == "description" {
                if matches!(raw_val, ">" | "|" | ">+" | ">-" | "|+" | "|-") {
                    let mut collected: Vec<String> = Vec::new();
                    while let Some(peeked) = segments.peek() {
                        let peek_line = peeked.trim_end_matches(['\r', '\n']);
                        let peek_trimmed = peek_line.trim();
                        if peek_trimmed == "---" {
                            break;
                        }
                        if peek_trimmed.is_empty() {
                            segments.next();
                            continue;
                        }
                        if peek_line.starts_with(' ') || peek_line.starts_with('\t') {
                            collected.push(peek_trimmed.to_string());
                            segments.next();
                        } else {
                            break;
                        }
                    }
                    if !collected.is_empty() {
                        let is_literal = raw_val.starts_with('|');
                        let separator = if is_literal { "\n" } else { " " };
                        description = Some(collected.join(separator));
                    }
                    continue;
                }
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
        .filter_map(|component| {
            component
                .as_os_str()
                .to_str()
                .map(|value| value.to_string())
        })
        .collect();
    if parts.is_empty() {
        return None;
    }
    let file_name = parts.pop()?;
    let stem = Path::new(&file_name)
        .file_stem()
        .and_then(|value| value.to_str())?;
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
        let is_dir = std::fs::metadata(&path)
            .map(|m| m.is_dir())
            .unwrap_or(false);
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

/// Candidate workspace-relative directories for commands, in priority order:
/// Claude (`.claude/commands`), Agents (`.agents/commands`), Codex (`.codex/commands`),
/// pi/omp (`.agent/commands`), and generic hidden/visible `commands` directories.
const WORKSPACE_COMMAND_SUBPATHS: &[&[&str]] = &[
    &[".claude", "commands"],
    &[".agents", "commands"],
    &[".codex", "commands"],
    &[".agent", "commands"],
    &[".commands"],
    &["commands"],
];

/// Candidate workspace-relative directories for skills, in priority order:
/// - Claude Code (`.claude/skills`)
/// - Codex CLI and Open Agent standard (`.agents/skills`)
/// - Codex (`.codex/skills`)
/// - Project hidden skills (`.skills`)
/// - Project visible skills (`skills`)
/// - pi / omp (`.agent/skills`)
/// - Cursor (`.cursor/skills`)
/// - GitHub Copilot (`.github/skills`)
const WORKSPACE_SKILL_SUBPATHS: &[&[&str]] = &[
    &[".claude", "skills"],
    &[".agents", "skills"],
    &[".codex", "skills"],
    &[".skills"],
    &["skills"],
    &[".agent", "skills"],
    &[".cursor", "skills"],
    &[".github", "skills"],
];

/// Command directories in priority order: workspace-relative candidate directories
/// first, then global homes for Claude, Agents, and Codex. Deduplicates paths that
/// resolve to the same canonical directory.
fn commands_dirs(workspace_root: &Path) -> Vec<(PathBuf, &'static str)> {
    let mut dirs: Vec<(PathBuf, &'static str)> = Vec::new();
    let mut seen_paths: HashSet<PathBuf> = HashSet::new();

    for parts in WORKSPACE_COMMAND_SUBPATHS {
        let mut dir = workspace_root.to_path_buf();
        for part in *parts {
            dir.push(part);
        }
        if dir.is_dir() {
            let canonical = dir.canonicalize().unwrap_or_else(|_| dir.clone());
            if seen_paths.insert(canonical) {
                dirs.push((dir, "workspace"));
            }
        }
    }

    let claude_global =
        crate::engine::engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude").join("commands");
    if claude_global.is_dir() {
        let canonical = claude_global.canonicalize().unwrap_or_else(|_| claude_global.clone());
        if seen_paths.insert(canonical) {
            dirs.push((claude_global, "global"));
        }
    }
    let agents_global = crate::engine::engine_home(None, ".agents").join("commands");
    if agents_global.is_dir() {
        let canonical = agents_global.canonicalize().unwrap_or_else(|_| agents_global.clone());
        if seen_paths.insert(canonical) {
            dirs.push((agents_global, "global"));
        }
    }
    let codex_global = crate::engine::codex_home().join("commands");
    if codex_global.is_dir() {
        let canonical = codex_global.canonicalize().unwrap_or_else(|_| codex_global.clone());
        if seen_paths.insert(canonical) {
            dirs.push((codex_global, "global"));
        }
    }
    dirs
}

/// Skill directories in priority order: workspace-relative candidate directories
/// first (Claude, Codex, Open Agent standard, root skills, pi/omp, cursor, copilot),
/// then the global homes of every CLI the picker can drive —
/// Claude (`$CLAUDE_CONFIG_DIR/skills`), Codex (`$CODEX_HOME/skills` including
/// its built-in `.system` tree discovered via bounded recursion), the cross-agent `~/.agents/skills`, and
/// Codex plugin-bundled skills under `$CODEX_HOME/plugins/cache`. `is_dir`
/// follows symlinks, so cc-switch-managed links inside these roots resolve.
fn skills_dirs(workspace_root: &Path) -> Vec<(PathBuf, &'static str)> {
    let mut dirs: Vec<(PathBuf, &'static str)> = Vec::new();
    let mut seen_paths: HashSet<PathBuf> = HashSet::new();

    for parts in WORKSPACE_SKILL_SUBPATHS {
        let mut dir = workspace_root.to_path_buf();
        for part in *parts {
            dir.push(part);
        }
        if dir.is_dir() {
            let canonical = dir.canonicalize().unwrap_or_else(|_| dir.clone());
            if seen_paths.insert(canonical) {
                dirs.push((dir, "workspace"));
            }
        }
    }

    let claude_global =
        crate::engine::engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude").join("skills");
    if claude_global.is_dir() {
        let canonical = claude_global.canonicalize().unwrap_or_else(|_| claude_global.clone());
        if seen_paths.insert(canonical) {
            dirs.push((claude_global, "global"));
        }
    }
    let codex_home = crate::engine::codex_home();
    let codex_skills = codex_home.join("skills");
    // `.system` built-in skills are discovered via bounded recursion
    // inside `codex_skills`, avoiding a duplicate explicit scan pass.
    if codex_skills.is_dir() {
        let canonical = codex_skills.canonicalize().unwrap_or_else(|_| codex_skills.clone());
        if seen_paths.insert(canonical) {
            dirs.push((codex_skills, "global"));
        }
    }
    let agents_dir = crate::engine::engine_home(None, ".agents").join("skills");
    if agents_dir.is_dir() {
        let canonical = agents_dir.canonicalize().unwrap_or_else(|_| agents_dir.clone());
        if seen_paths.insert(canonical) {
            dirs.push((agents_dir, "global"));
        }
    }
    for (plugin_dir, source) in codex_plugin_skills_dirs(&codex_home) {
        let canonical = plugin_dir.canonicalize().unwrap_or_else(|_| plugin_dir.clone());
        if seen_paths.insert(canonical) {
            dirs.push((plugin_dir, source));
        }
    }
    dirs
}

/// Codex plugin skills: each plugin ships a `skills/` directory inside its
/// version dir under `plugins/cache`, and the nesting between `cache` and
/// the version dir isn't fixed — walk the tree (bounded) and collect every
/// `skills` directory found. Shared with the Skills hub page so the two
/// surfaces never disagree about which plugin skills exist.
pub(crate) fn codex_plugin_skills_dirs(codex_home: &Path) -> Vec<(PathBuf, &'static str)> {
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
/// a `SKILL.md` (or `skill.md`) is one skill. Category directories without
/// a manifest are recursed boundedly (depth <= 3). Name comes from frontmatter
/// `name:` override, else directory name; description from frontmatter.
fn discover_skills_in(dir: &Path, source: &str) -> Vec<SlashCommandEntry> {
    let mut out: Vec<SlashCommandEntry> = Vec::new();
    discover_skills_in_internal(dir, source, 0, &mut out);
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn discover_skills_in_internal(
    dir: &Path,
    source: &str,
    depth: usize,
    out: &mut Vec<SlashCommandEntry>,
) {
    if depth > 3 {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_dir = std::fs::metadata(&path)
            .map(|m| m.is_dir())
            .unwrap_or(false);
        if !is_dir {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        // Skip hidden directories (except .system used by Codex) and non-skill trees.
        if (file_name.starts_with('.') && file_name != ".system")
            || file_name == "node_modules"
            || file_name == "target"
        {
            continue;
        }
        let manifest = if path.join("SKILL.md").is_file() {
            Some(path.join("SKILL.md"))
        } else if path.join("skill.md").is_file() {
            Some(path.join("skill.md"))
        } else {
            None
        };
        if let Some(manifest_path) = manifest {
            let content = match std::fs::read_to_string(&manifest_path) {
                Ok(content) => content,
                Err(_) => continue,
            };
            let (name, description, _argument_hint) = parse_command_frontmatter(&content);
            let resolved = name.unwrap_or_else(|| file_name.to_string());
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
        } else {
            // Recurse into subdirectories (e.g. category subfolders like engineering/...)
            discover_skills_in_internal(&path, source, depth + 1, out);
        }
    }
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
    fn bundled_creator_skill_is_discoverable_by_the_picker() {
        // 内置插件开发 skill：随应用分发（src-tauri/resources/skills，由
        // creator_skill.rs 装进各引擎的 skills 根）。这里用选择器自己的解析
        // 器读它——frontmatter 写坏等于 `/ccgui-plugin-creator` 从未存在，
        // 而那是用户可见功能，必须在仓库里就能拦住。
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("skills");
        let entries = discover_skills_in(&root, "bundled");
        let entry = entries
            .iter()
            .find(|e| e.name == "ccgui-plugin-creator")
            .expect("bundled creator skill must be discoverable");
        assert!(
            entry.kind == SlashEntryKind::Skill,
            "bundled creator skill must be a skill entry"
        );
        let description = entry.description.as_deref().unwrap_or_default();
        assert!(
            description.contains("插件"),
            "description drives skill triggering; got {description:?}"
        );
    }

    #[test]
    fn collects_plugin_skills_dirs_at_any_nesting() {
        let root = scratch_dir("plugin-cache");
        let cache = root.join("plugins").join("cache");
        // Two layouts seen in the wild: cache/<plugin>/<version>/skills and
        // cache/<marketplace>/<plugin>/<version>/skills.
        let flat = cache.join("gsd").join("1.2.0").join("skills");
        let nested = cache
            .join("market")
            .join("aimax")
            .join("0.3.1")
            .join("skills");
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

    #[test]
    fn parses_multiline_block_scalar_description() {
        let content = "---\nname: lint-fix\ndescription: >\n  Fixes lint errors in codebase.\n  Do not use for general review.\n---\nbody\n";
        let (name, description, hint) = parse_command_frontmatter(content);
        assert_eq!(name.as_deref(), Some("lint-fix"));
        assert_eq!(
            description.as_deref(),
            Some("Fixes lint errors in codebase. Do not use for general review.")
        );
        assert_eq!(hint, None);
    }

    #[test]
    fn parses_literal_block_scalar_description() {
        let content = "---\nname: multi-step\ndescription: |\n  Step 1: analyze\n  Step 2: execute\n---\nbody\n";
        let (name, description, hint) = parse_command_frontmatter(content);
        assert_eq!(name.as_deref(), Some("multi-step"));
        assert_eq!(
            description.as_deref(),
            Some("Step 1: analyze\nStep 2: execute")
        );
        assert_eq!(hint, None);
    }

    #[test]
    fn discovers_system_skills_via_recursion_without_duplicate_io() {
        let root = scratch_dir("codex-skills");
        let sys_skill = root.join(".system").join("analytics-template");
        fs::create_dir_all(&sys_skill).unwrap();
        fs::write(
            sys_skill.join("SKILL.md"),
            "---\ndescription: \"System analytics skill\"\n---\n",
        )
        .unwrap();

        let entries = discover_skills_in(&root, "global");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "analytics-template");
        assert_eq!(entries[0].source, "global");
    }

    #[test]
    fn discovers_workspace_skills_across_candidate_subpaths() {
        let ws = scratch_dir("ws-skills");
        // 1. .agents/skills (Codex CLI / Open Agent standard)
        let agent_skill = ws.join(".agents").join("skills").join("agent-worker");
        fs::create_dir_all(&agent_skill).unwrap();
        fs::write(
            agent_skill.join("SKILL.md"),
            "---\ndescription: \"agent worker skill\"\n---\n",
        )
        .unwrap();

        // 2. .codex/skills with lowercase skill.md
        let codex_skill = ws.join(".codex").join("skills").join("codex-worker");
        fs::create_dir_all(&codex_skill).unwrap();
        fs::write(
            codex_skill.join("skill.md"),
            "---\ndescription: \"codex worker skill\"\n---\n",
        )
        .unwrap();

        // 3. .skills
        let hidden_skill = ws.join(".skills").join("hidden-worker");
        fs::create_dir_all(&hidden_skill).unwrap();
        fs::write(hidden_skill.join("SKILL.md"), "---\n---\n").unwrap();

        // 4. skills (project visible root)
        let visible_skill = ws.join("skills").join("visible-worker");
        fs::create_dir_all(&visible_skill).unwrap();
        fs::write(visible_skill.join("SKILL.md"), "---\n---\n").unwrap();

        let dirs = skills_dirs(&ws);
        let ws_dirs: Vec<&Path> = dirs
            .iter()
            .filter(|(_, s)| *s == "workspace")
            .map(|(p, _)| p.as_path())
            .collect();
        assert_eq!(ws_dirs.len(), 4);

        let mut discovered = Vec::new();
        for (dir, source) in &dirs {
            if *source == "workspace" {
                discovered.extend(discover_skills_in(dir, source));
            }
        }
        let names: Vec<&str> = discovered.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"agent-worker"));
        assert!(names.contains(&"codex-worker"));
        assert!(names.contains(&"hidden-worker"));
        assert!(names.contains(&"visible-worker"));
        assert!(discovered.iter().all(|e| e.source == "workspace"));
    }

    #[test]
    fn discovers_nested_category_skills() {
        let root = scratch_dir("nested-skills");
        let nested = root.join("analytics").join("dashboard");
        fs::create_dir_all(&nested).unwrap();
        fs::write(
            nested.join("SKILL.md"),
            "---\ndescription: \"Analytics dashboard template\"\n---\n",
        )
        .unwrap();

        let entries = discover_skills_in(&root, "workspace");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "dashboard");
        assert_eq!(
            entries[0].description.as_deref(),
            Some("Analytics dashboard template")
        );
    }

    #[test]
    fn discovers_workspace_commands_across_candidate_subpaths() {
        let ws = scratch_dir("ws-commands");
        let agents_cmd = ws.join(".agents").join("commands");
        let codex_cmd = ws.join(".codex").join("commands");
        fs::create_dir_all(&agents_cmd).unwrap();
        fs::create_dir_all(&codex_cmd).unwrap();
        fs::write(agents_cmd.join("agent-deploy.md"), "# Deploy\n").unwrap();
        fs::write(codex_cmd.join("codex-test.md"), "# Test\n").unwrap();

        let dirs = commands_dirs(&ws);
        let ws_dirs: Vec<&Path> = dirs
            .iter()
            .filter(|(_, s)| *s == "workspace")
            .map(|(p, _)| p.as_path())
            .collect();
        assert_eq!(ws_dirs.len(), 2);

        let mut discovered = Vec::new();
        for (dir, source) in &dirs {
            if *source == "workspace" {
                discovered.extend(discover_commands_in(dir, dir, source));
            }
        }
        let names: Vec<&str> = discovered.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"agent-deploy"));
        assert!(names.contains(&"codex-test"));
    }
}
