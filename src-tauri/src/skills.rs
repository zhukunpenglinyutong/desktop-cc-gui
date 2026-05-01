use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use tokio::task;

use crate::codex::home::{resolve_default_codex_home, resolve_workspace_codex_home};
use crate::state::AppState;
use crate::types::WorkspaceEntry;

/// Maximum file size to read (1 MB).
const MAX_SKILL_FILE_SIZE: u64 = 1_048_576;

/// Maximum number of lines to read for description extraction.
const MAX_FRONTMATTER_LINES: usize = 30;
const SKILL_SOURCE_WORKSPACE_MANAGED: &str = "workspace_managed";
const SKILL_SOURCE_PROJECT_CLAUDE: &str = "project_claude";
const SKILL_SOURCE_PROJECT_CODEX: &str = "project_codex";
const SKILL_SOURCE_PROJECT_AGENTS: &str = "project_agents";
const SKILL_SOURCE_PROJECT_GEMINI: &str = "project_gemini";
const SKILL_SOURCE_GLOBAL_CLAUDE: &str = "global_claude";
const SKILL_SOURCE_GLOBAL_CODEX: &str = "global_codex";
const SKILL_SOURCE_GLOBAL_AGENTS: &str = "global_agents";
const SKILL_SOURCE_GLOBAL_GEMINI: &str = "global_gemini";

#[derive(Serialize, Clone, Debug)]
pub(crate) struct SkillEntry {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) description: Option<String>,
}

/// Error type for skill scanning operations.
#[derive(Debug)]
pub(crate) enum SkillScanError {
    /// Workspace not found in state.
    WorkspaceNotFound(String),
    /// IO error reading a skills directory.
    Io(std::io::Error),
    /// tokio spawn_blocking join error.
    Join,
}

impl std::fmt::Display for SkillScanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SkillScanError::WorkspaceNotFound(id) => write!(f, "workspace not found: {}", id),
            SkillScanError::Io(err) => write!(f, "skill scan IO error: {}", err),
            SkillScanError::Join => write!(f, "skill scan task join failed"),
        }
    }
}

impl From<SkillScanError> for String {
    fn from(err: SkillScanError) -> String {
        err.to_string()
    }
}

fn resolve_codex_home_for_workspace(
    workspaces: &HashMap<String, WorkspaceEntry>,
    entry: &WorkspaceEntry,
) -> Option<PathBuf> {
    let parent_entry = entry
        .parent_id
        .as_ref()
        .and_then(|parent_id| workspaces.get(parent_id));
    resolve_workspace_codex_home(entry, parent_entry).or_else(resolve_default_codex_home)
}

fn default_skills_dir_for_workspace(
    workspaces: &HashMap<String, WorkspaceEntry>,
    entry: &WorkspaceEntry,
) -> Option<PathBuf> {
    resolve_codex_home_for_workspace(workspaces, entry).map(|home| home.join("skills"))
}

fn normalize_home_path(value: &str) -> Option<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed == "~" {
        return dirs::home_dir();
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        return dirs::home_dir().map(|home| home.join(rest));
    }
    if trimmed == "$HOME" || trimmed == "${HOME}" {
        return dirs::home_dir();
    }
    if let Some(rest) = trimmed.strip_prefix("$HOME/") {
        return dirs::home_dir().map(|home| home.join(rest));
    }
    if let Some(rest) = trimmed.strip_prefix("${HOME}/") {
        return dirs::home_dir().map(|home| home.join(rest));
    }
    Some(PathBuf::from(trimmed))
}

fn resolve_default_claude_home() -> Option<PathBuf> {
    if let Ok(value) = env::var("CLAUDE_HOME") {
        if let Some(path) = normalize_home_path(&value) {
            return Some(path);
        }
    }
    dirs::home_dir().map(|home| home.join(".claude"))
}

fn default_claude_skills_dir() -> Option<PathBuf> {
    resolve_default_claude_home().map(|home| home.join("skills"))
}

fn resolve_default_agents_home() -> Option<PathBuf> {
    if let Ok(value) = env::var("AGENTS_HOME") {
        if let Some(path) = normalize_home_path(&value) {
            return Some(path);
        }
    }
    dirs::home_dir().map(|home| home.join(".agents"))
}

fn default_agents_skills_dir() -> Option<PathBuf> {
    resolve_default_agents_home().map(|home| home.join("skills"))
}

fn resolve_default_gemini_home() -> Option<PathBuf> {
    if let Ok(value) = env::var("GEMINI_HOME") {
        if let Some(path) = normalize_home_path(&value) {
            return Some(path);
        }
    }
    dirs::home_dir().map(|home| home.join(".gemini"))
}

fn default_gemini_skills_dir() -> Option<PathBuf> {
    resolve_default_gemini_home().map(|home| home.join("skills"))
}

fn workspace_skills_dir(state: &AppState, entry: &WorkspaceEntry) -> Result<PathBuf, String> {
    let data_dir = state
        .settings_path
        .parent()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| "Unable to resolve app data dir.".to_string())?;
    Ok(data_dir.join("workspaces").join(&entry.id).join("skills"))
}

fn project_claude_skills_dir(entry: &WorkspaceEntry) -> PathBuf {
    PathBuf::from(&entry.path).join(".claude").join("skills")
}

fn project_codex_skills_dir(entry: &WorkspaceEntry) -> PathBuf {
    PathBuf::from(&entry.path).join(".codex").join("skills")
}

fn project_agents_skills_dir(entry: &WorkspaceEntry) -> PathBuf {
    PathBuf::from(&entry.path).join(".agents").join("skills")
}

fn normalize_skill_name(name: &str) -> String {
    name.trim().to_ascii_lowercase()
}

fn is_global_source(source: &str) -> bool {
    source == SKILL_SOURCE_GLOBAL_CLAUDE
        || source == SKILL_SOURCE_GLOBAL_CODEX
        || source == SKILL_SOURCE_GLOBAL_AGENTS
        || source == SKILL_SOURCE_GLOBAL_GEMINI
}

/// Extract description from YAML frontmatter of a .md file.
/// Only reads the first MAX_FRONTMATTER_LINES lines using BufRead.
fn extract_description(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();

    let first_line = lines.next()?.ok()?;
    if first_line.trim() != "---" {
        return None;
    }

    let mut description: Option<String> = None;
    let mut lines_read = 1;

    for line_result in lines {
        if lines_read >= MAX_FRONTMATTER_LINES {
            break;
        }
        lines_read += 1;

        let line = match line_result {
            Ok(l) => l,
            Err(_) => break,
        };
        let trimmed = line.trim();

        if trimmed == "---" {
            return description;
        }

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if let Some((key, value)) = trimmed.split_once(':') {
            if key.trim().eq_ignore_ascii_case("description") {
                let mut val = value.trim().to_string();
                if val.len() >= 2 {
                    let bytes = val.as_bytes();
                    let first = bytes[0];
                    let last = bytes[bytes.len() - 1];
                    if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
                        val = val[1..val.len() - 1].to_string();
                    }
                }
                if matches!(val.as_str(), "|" | ">" | "|-" | ">-" | "|+" | ">+") {
                    continue;
                }
                if !val.is_empty() {
                    description = Some(val);
                }
            }
        }
    }

    // Frontmatter never closed
    None
}

/// Scan a single directory for .md skill files.
/// Returns Ok(vec) on success. Individual file failures are logged and skipped.
/// Directory not existing is Ok(empty), not an error.
fn discover_skills_in(dir: &Path, source: &str) -> Result<Vec<SkillEntry>, SkillScanError> {
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(dir).map_err(SkillScanError::Io)?;

    let mut out: Vec<SkillEntry> = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(err) => {
                log::warn!("Failed to read dir entry in {:?}: {}", dir, err);
                continue;
            }
        };

        let path = entry.path();

        let link_metadata = match fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(err) => {
                log::warn!("Failed to stat {:?}: {}", path, err);
                continue;
            }
        };
        let metadata = if link_metadata.file_type().is_symlink() {
            match fs::metadata(&path) {
                Ok(m) if m.is_dir() => m,
                Ok(_) => continue,
                Err(err) => {
                    log::warn!("Failed to resolve skill symlink {:?}: {}", path, err);
                    continue;
                }
            }
        } else {
            link_metadata
        };

        if metadata.is_dir() {
            let nested_skill_path = path.join("SKILL.md");
            let nested_metadata = match fs::symlink_metadata(&nested_skill_path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if nested_metadata.file_type().is_symlink() || !nested_metadata.is_file() {
                continue;
            }
            if nested_metadata.len() > MAX_SKILL_FILE_SIZE {
                log::warn!(
                    "Skipping oversized nested skill file {:?} ({} bytes)",
                    nested_skill_path,
                    nested_metadata.len()
                );
                continue;
            }
            let name = match path
                .file_name()
                .and_then(|s| s.to_str())
                .map(str::to_string)
            {
                Some(n) if !n.is_empty() => n,
                _ => continue,
            };
            let description = extract_description(&nested_skill_path);
            out.push(SkillEntry {
                name,
                path: nested_skill_path.to_string_lossy().to_string(),
                source: source.to_string(),
                description,
            });
            continue;
        }

        if !metadata.is_file() {
            continue;
        }

        if metadata.len() > MAX_SKILL_FILE_SIZE {
            log::warn!(
                "Skipping oversized skill file {:?} ({} bytes)",
                path,
                metadata.len()
            );
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

        let name = match path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_string)
        {
            Some(n) if !n.is_empty() => n,
            _ => continue,
        };

        let description = extract_description(&path);

        out.push(SkillEntry {
            name,
            path: path.to_string_lossy().to_string(),
            source: source.to_string(),
            description,
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

fn merge_skills_by_priority(sources: Vec<Vec<SkillEntry>>) -> Vec<SkillEntry> {
    let mut merged: Vec<SkillEntry> = Vec::new();
    let mut seen_names: HashSet<String> = HashSet::new();
    let mut seen_global_keys: HashSet<String> = HashSet::new();

    for source in sources {
        for skill in source {
            let normalized_name = normalize_skill_name(&skill.name);
            if is_global_source(&skill.source) {
                let global_key = format!("{}::{normalized_name}", skill.source);
                if seen_global_keys.contains(&global_key) {
                    continue;
                }
                seen_global_keys.insert(global_key);
            } else {
                if seen_names.contains(&normalized_name) {
                    continue;
                }
                seen_names.insert(normalized_name);
            }
            merged.push(skill);
        }
    }

    merged.sort_by(|a, b| a.name.cmp(&b.name));
    merged
}

/// Scan local skills directories for a specific workspace.
/// Priority order:
/// workspace-managed > project .claude > project .codex > project .agents >
/// global .claude > global .codex > global .agents.
pub(crate) async fn skills_list_local_for_workspace(
    state: &AppState,
    workspace_id: &str,
) -> Result<Vec<SkillEntry>, SkillScanError> {
    let (
        workspace_dir,
        project_claude_dir,
        project_codex_dir,
        project_agents_dir,
        project_gemini_dir,
        claude_global_dir,
        codex_global_dir,
        agents_global_dir,
        gemini_global_dir,
    ) = {
        let workspaces = state.workspaces.lock().await;
        let entry = workspaces
            .get(workspace_id)
            .ok_or_else(|| SkillScanError::WorkspaceNotFound(workspace_id.to_string()))?;
        let ws_dir = workspace_skills_dir(state, entry).ok();
        let project_claude_dir = project_claude_skills_dir(entry);
        let project_codex_dir = project_codex_skills_dir(entry);
        let project_agents_dir = project_agents_skills_dir(entry);
        let project_gemini_dir = PathBuf::from(&entry.path).join(".gemini").join("skills");
        let codex_dir = default_skills_dir_for_workspace(&workspaces, entry);
        let claude_dir = default_claude_skills_dir();
        let agents_dir = default_agents_skills_dir();
        let gemini_dir = default_gemini_skills_dir();
        (
            ws_dir,
            Some(project_claude_dir),
            Some(project_codex_dir),
            Some(project_agents_dir),
            Some(project_gemini_dir),
            claude_dir,
            codex_dir,
            agents_dir,
            gemini_dir,
        )
    };

    task::spawn_blocking(move || {
        let safe_discover = |dir: &Path, source: &str| -> Vec<SkillEntry> {
            match discover_skills_in(dir, source) {
                Ok(entries) => entries,
                Err(err) => {
                    log::warn!(
                        "Skill discovery failed in {:?} for source {}: {}",
                        dir,
                        source,
                        err
                    );
                    Vec::new()
                }
            }
        };

        let workspace_skills = match &workspace_dir {
            Some(dir) => safe_discover(dir, SKILL_SOURCE_WORKSPACE_MANAGED),
            None => Vec::new(),
        };
        let project_claude_skills = match &project_claude_dir {
            Some(dir) => safe_discover(dir, SKILL_SOURCE_PROJECT_CLAUDE),
            None => Vec::new(),
        };
        let project_codex_skills = match &project_codex_dir {
            Some(dir) => safe_discover(dir, SKILL_SOURCE_PROJECT_CODEX),
            None => Vec::new(),
        };
        let project_agents_skills = match &project_agents_dir {
            Some(dir) => safe_discover(dir, SKILL_SOURCE_PROJECT_AGENTS),
            None => Vec::new(),
        };
        let project_gemini_skills = match &project_gemini_dir {
            Some(dir) => safe_discover(dir, SKILL_SOURCE_PROJECT_GEMINI),
            None => Vec::new(),
        };

        let claude_skills = match &claude_global_dir {
            Some(dir) => safe_discover(dir, SKILL_SOURCE_GLOBAL_CLAUDE),
            None => Vec::new(),
        };

        let codex_skills = match &codex_global_dir {
            Some(dir) => safe_discover(dir, SKILL_SOURCE_GLOBAL_CODEX),
            None => Vec::new(),
        };
        let agents_skills = match &agents_global_dir {
            Some(dir) => safe_discover(dir, SKILL_SOURCE_GLOBAL_AGENTS),
            None => Vec::new(),
        };

        let gemini_skills = match &gemini_global_dir {
            Some(dir) => safe_discover(dir, SKILL_SOURCE_GLOBAL_GEMINI),
            None => Vec::new(),
        };

        Ok(merge_skills_by_priority(vec![
            workspace_skills,
            project_claude_skills,
            project_codex_skills,
            project_agents_skills,
            project_gemini_skills,
            claude_skills,
            codex_skills,
            agents_skills,
            gemini_skills,
        ]))
    })
    .await
    .map_err(|_| SkillScanError::Join)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn new_temp_dir(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time is before unix epoch")
            .as_nanos();
        let dir = env::temp_dir().join(format!("mossx-{prefix}-{nonce}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn discover_skills_supports_flat_and_one_level_nested_layouts() {
        let root = new_temp_dir("skills-discovery");
        let flat_skill = root.join("flat.md");
        fs::write(&flat_skill, "---\ndescription: flat skill\n---\nbody").expect("write flat");

        let nested_dir = root.join("nested-tool");
        fs::create_dir_all(&nested_dir).expect("create nested dir");
        fs::write(
            nested_dir.join("SKILL.md"),
            "---\ndescription: nested skill\n---\nbody",
        )
        .expect("write nested skill");

        let deep_dir = root.join("deep").join("inner");
        fs::create_dir_all(&deep_dir).expect("create deep dir");
        fs::write(deep_dir.join("SKILL.md"), "deep body").expect("write deep skill");

        let entries =
            discover_skills_in(&root, SKILL_SOURCE_WORKSPACE_MANAGED).expect("discover skills");
        let names: Vec<String> = entries.iter().map(|entry| entry.name.clone()).collect();

        assert!(names.contains(&"flat".to_string()));
        assert!(names.contains(&"nested-tool".to_string()));
        assert!(!names.contains(&"inner".to_string()));

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn discover_skills_follows_symlinked_skill_directories() {
        use std::os::unix::fs::symlink;

        let root = new_temp_dir("skills-symlink-discovery");
        let target_root = new_temp_dir("skills-symlink-target");
        let target_skill = target_root.join("brainstorming");
        fs::create_dir_all(&target_skill).expect("create target skill dir");
        fs::write(
            target_skill.join("SKILL.md"),
            "---\ndescription: symlinked skill\n---\nbody",
        )
        .expect("write symlinked skill");
        symlink(&target_skill, root.join("brainstorming")).expect("create skill symlink");

        let entries =
            discover_skills_in(&root, SKILL_SOURCE_GLOBAL_CLAUDE).expect("discover skills");

        let skill = entries
            .iter()
            .find(|entry| entry.name == "brainstorming")
            .expect("symlinked skill directory should be discovered");
        assert_eq!(skill.description.as_deref(), Some("symlinked skill"));
        assert!(skill.path.ends_with("brainstorming/SKILL.md"));

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(target_root);
    }

    #[test]
    fn merge_skills_by_priority_prefers_higher_priority_sources() {
        let workspace_skill = SkillEntry {
            name: "shared".to_string(),
            path: "/workspace/shared.md".to_string(),
            source: SKILL_SOURCE_WORKSPACE_MANAGED.to_string(),
            description: None,
        };
        let project_claude_skill = SkillEntry {
            name: "shared".to_string(),
            path: "/workspace/.claude/skills/shared.md".to_string(),
            source: SKILL_SOURCE_PROJECT_CLAUDE.to_string(),
            description: None,
        };
        let claude_skill = SkillEntry {
            name: "shared".to_string(),
            path: "/home/.claude/skills/shared.md".to_string(),
            source: SKILL_SOURCE_GLOBAL_CLAUDE.to_string(),
            description: None,
        };
        let codex_skill = SkillEntry {
            name: "shared".to_string(),
            path: "/home/.codex/skills/shared.md".to_string(),
            source: SKILL_SOURCE_GLOBAL_CODEX.to_string(),
            description: None,
        };
        let agents_skill = SkillEntry {
            name: "shared".to_string(),
            path: "/home/.agents/skills/shared.md".to_string(),
            source: SKILL_SOURCE_GLOBAL_AGENTS.to_string(),
            description: None,
        };

        let merged = merge_skills_by_priority(vec![
            vec![workspace_skill.clone()],
            vec![project_claude_skill],
            vec![claude_skill],
            vec![codex_skill],
            vec![agents_skill],
        ]);

        assert_eq!(merged.len(), 4);
        assert!(merged.iter().any(|entry| {
            entry.name == "shared"
                && entry.path == workspace_skill.path
                && entry.source == SKILL_SOURCE_WORKSPACE_MANAGED
        }));
        assert!(merged.iter().any(|entry| {
            entry.name == "shared"
                && entry.source == SKILL_SOURCE_GLOBAL_CLAUDE
                && entry.path == "/home/.claude/skills/shared.md"
        }));
        assert!(merged.iter().any(|entry| {
            entry.name == "shared"
                && entry.source == SKILL_SOURCE_GLOBAL_CODEX
                && entry.path == "/home/.codex/skills/shared.md"
        }));
        assert!(merged.iter().any(|entry| {
            entry.name == "shared"
                && entry.source == SKILL_SOURCE_GLOBAL_AGENTS
                && entry.path == "/home/.agents/skills/shared.md"
        }));
    }

    #[test]
    fn discover_skills_assigns_source_and_tolerates_missing_dir() {
        let missing = new_temp_dir("skills-missing").join("not-found");
        let missing_entries =
            discover_skills_in(&missing, SKILL_SOURCE_PROJECT_CLAUDE).expect("missing skills dir");
        assert!(missing_entries.is_empty());

        let root = new_temp_dir("skills-source");
        fs::write(
            root.join("tool.md"),
            "---\ndescription: project skill\n---\nbody",
        )
        .expect("write skill");

        let entries =
            discover_skills_in(&root, SKILL_SOURCE_PROJECT_CLAUDE).expect("discover skills");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "tool");
        assert_eq!(entries[0].source, SKILL_SOURCE_PROJECT_CLAUDE);
        assert_eq!(entries[0].description.as_deref(), Some("project skill"));

        let _ = fs::remove_dir_all(root);
    }
}
