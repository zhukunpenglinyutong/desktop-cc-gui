use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use git2::Repository;
use ignore::WalkBuilder;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

use crate::text_encoding::decode_text_bytes;
use crate::utils::normalize_git_path;

fn should_always_skip(name: &str) -> bool {
    name == ".git"
}

fn is_special_dependency_dir_name(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".pnpm-store"
            | ".yarn"
            | "bower_components"
            | "vendor"
            | ".venv"
            | "venv"
            | "env"
            | "__pypackages__"
            | "Pods"
            | "Carthage"
            | ".m2"
            | ".ivy2"
            | ".cargo"
    )
}

fn is_special_build_artifact_dir_name(name: &str) -> bool {
    matches!(
        name,
        "target"
            | "dist"
            | "build"
            | "out"
            | "coverage"
            | ".next"
            | ".nuxt"
            | ".svelte-kit"
            | ".angular"
            | ".parcel-cache"
            | ".turbo"
            | ".cache"
            | ".gradle"
            | "CMakeFiles"
            | "bin"
            | "obj"
            | "__pycache__"
            | ".pytest_cache"
            | ".mypy_cache"
            | ".tox"
            | ".dart_tool"
    ) || name.starts_with("cmake-build-")
}

fn is_special_directory_path(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .map(|name| {
            is_special_dependency_dir_name(name) || is_special_build_artifact_dir_name(name)
        })
        .unwrap_or(false)
}

fn normalized_relative_to_pathbuf(normalized: &str) -> PathBuf {
    let mut path = PathBuf::new();
    for segment in normalized.split('/') {
        if !segment.is_empty() {
            path.push(segment);
        }
    }
    path
}

fn normalize_workspace_relative_path(path: &str) -> Result<String, String> {
    let normalized = path.trim().replace('\\', "/");
    let trimmed = normalized.trim_matches('/');
    if trimmed.is_empty() {
        return Err("Path cannot be empty.".to_string());
    }
    let relative = Path::new(trimmed);
    for component in relative.components() {
        match component {
            Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_)
            | Component::CurDir => {
                return Err("Invalid path.".to_string());
            }
            Component::Normal(_) => {}
        }
    }
    if trimmed == ".git"
        || trimmed.starts_with(".git/")
        || trimmed.contains("/.git/")
        || trimmed.ends_with("/.git")
    {
        return Err("Cannot access .git directory.".to_string());
    }
    Ok(trimmed.to_string())
}

fn sort_and_dedup_workspace_lists(
    files: &mut Vec<String>,
    directories: &mut Vec<String>,
    gitignored_files: &mut Vec<String>,
    gitignored_directories: &mut Vec<String>,
) {
    files.sort();
    files.dedup();
    directories.sort();
    directories.dedup();
    gitignored_files.sort();
    gitignored_files.dedup();
    gitignored_directories.sort();
    gitignored_directories.dedup();
}

fn sort_and_truncate_named_entries<T>(entries: &mut Vec<(String, T)>, max_entries: usize) {
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    if entries.len() > max_entries {
        entries.truncate(max_entries);
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct WorkspaceFilesResponse {
    pub(crate) files: Vec<String>,
    pub(crate) directories: Vec<String>,
    #[serde(default)]
    pub(crate) gitignored_files: Vec<String>,
    #[serde(default)]
    pub(crate) gitignored_directories: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorkspaceTextSearchMatch {
    pub(crate) line: usize,
    pub(crate) column: usize,
    pub(crate) end_column: usize,
    pub(crate) preview: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorkspaceTextSearchFileResult {
    pub(crate) path: String,
    pub(crate) match_count: usize,
    pub(crate) matches: Vec<WorkspaceTextSearchMatch>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorkspaceTextSearchResponse {
    pub(crate) files: Vec<WorkspaceTextSearchFileResult>,
    pub(crate) file_count: usize,
    pub(crate) match_count: usize,
    pub(crate) limit_hit: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct WorkspaceTextSearchOptions {
    pub(crate) case_sensitive: bool,
    pub(crate) whole_word: bool,
    pub(crate) is_regex: bool,
    pub(crate) include_pattern: Option<String>,
    pub(crate) exclude_pattern: Option<String>,
}

const MAX_SEARCH_MATCHES: usize = 1_000;
const MAX_SEARCH_FILE_BYTES: u64 = 1_024 * 1_024;
const MAX_PREVIEW_CHARS: usize = 180;
const WORKSPACE_SCAN_ENTRY_BUDGET: usize = 30_000;
const WORKSPACE_SCAN_TIME_BUDGET: Duration = Duration::from_millis(1_200);
const WORKSPACE_DIRECTORY_SCAN_BUDGET_MULTIPLIER: usize = 8;

fn workspace_scan_budget_reached(started_at: Instant, scanned_entries: usize) -> bool {
    scanned_entries >= WORKSPACE_SCAN_ENTRY_BUDGET
        || started_at.elapsed() >= WORKSPACE_SCAN_TIME_BUDGET
}

fn compile_search_regex(
    query: &str,
    options: &WorkspaceTextSearchOptions,
) -> Result<Regex, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("Search query cannot be empty.".to_string());
    }
    let pattern = if options.is_regex {
        trimmed.to_string()
    } else {
        regex::escape(trimmed)
    };
    let pattern = if options.whole_word {
        format!(r"\b(?:{})\b", pattern)
    } else {
        pattern
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        .build()
        .map_err(|error| format!("Invalid search pattern: {error}"))
}

fn split_glob_patterns(input: Option<&str>) -> Vec<String> {
    input
        .unwrap_or_default()
        .split([',', '\n'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn glob_pattern_to_regex(pattern: &str) -> Result<Regex, String> {
    let normalized = pattern
        .replace('\\', "/")
        .trim()
        .trim_matches('/')
        .to_string();
    if normalized.is_empty() {
        return Err("Glob pattern cannot be empty.".to_string());
    }
    let mut regex_source = String::from("^");
    let chars: Vec<char> = normalized.chars().collect();
    let mut index = 0usize;
    while index < chars.len() {
        let current = chars[index];
        if current == '*' {
            let has_double = chars.get(index + 1).copied() == Some('*');
            if has_double {
                regex_source.push_str(".*");
                index += 2;
                continue;
            }
            regex_source.push_str("[^/]*");
            index += 1;
            continue;
        }
        if current == '?' {
            regex_source.push_str("[^/]");
            index += 1;
            continue;
        }
        if matches!(
            current,
            '.' | '+' | '(' | ')' | '|' | '^' | '$' | '{' | '}' | '[' | ']' | '\\'
        ) {
            regex_source.push('\\');
        }
        regex_source.push(current);
        index += 1;
    }
    regex_source.push('$');
    Regex::new(&regex_source).map_err(|error| format!("Invalid glob pattern `{pattern}`: {error}"))
}

fn compile_glob_patterns(input: Option<&str>) -> Result<Vec<Regex>, String> {
    split_glob_patterns(input)
        .into_iter()
        .map(|pattern| glob_pattern_to_regex(&pattern))
        .collect()
}

fn path_matches_patterns(path: &str, patterns: &[Regex]) -> bool {
    patterns.iter().any(|pattern| pattern.is_match(path))
}

fn build_preview(line: &str, start: usize, end: usize) -> String {
    let chars: Vec<char> = line.chars().collect();
    if chars.len() <= MAX_PREVIEW_CHARS {
        return line.trim().to_string();
    }
    let start_char = line[..start].chars().count();
    let end_char = line[..end].chars().count();
    let context = MAX_PREVIEW_CHARS / 2;
    let slice_start = start_char.saturating_sub(context / 2);
    let slice_end = (end_char + context).min(chars.len());
    let mut preview = chars[slice_start..slice_end].iter().collect::<String>();
    if slice_start > 0 {
        preview = format!("…{preview}");
    }
    if slice_end < chars.len() {
        preview.push('…');
    }
    preview.trim().to_string()
}

pub(crate) fn search_workspace_text_inner(
    root: &PathBuf,
    query: &str,
    options: &WorkspaceTextSearchOptions,
) -> Result<WorkspaceTextSearchResponse, String> {
    let regex = compile_search_regex(query, options)?;
    let include_patterns = compile_glob_patterns(options.include_pattern.as_deref())?;
    let exclude_patterns = compile_glob_patterns(options.exclude_pattern.as_deref())?;
    let root_for_filter = root.clone();
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .follow_links(false)
        .require_git(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .filter_entry(move |entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                if should_always_skip(&name) {
                    return false;
                }
                if let Ok(rel_path) = entry.path().strip_prefix(&root_for_filter) {
                    let normalized = normalize_git_path(&rel_path.to_string_lossy());
                    if !normalized.is_empty() && is_special_directory_path(&normalized) {
                        return false;
                    }
                }
            }
            name != ".DS_Store"
        })
        .build();

    let mut files = Vec::new();
    let mut total_files = 0usize;
    let mut total_matches = 0usize;
    let mut limit_hit = false;

    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if !entry.file_type().is_some_and(|ft| ft.is_file()) {
            continue;
        }
        let rel_path = match entry.path().strip_prefix(root) {
            Ok(path) => path,
            Err(_) => continue,
        };
        let normalized = normalize_git_path(&rel_path.to_string_lossy());
        if normalized.is_empty() {
            continue;
        }
        if !include_patterns.is_empty() && !path_matches_patterns(&normalized, &include_patterns) {
            continue;
        }
        if !exclude_patterns.is_empty() && path_matches_patterns(&normalized, &exclude_patterns) {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.len() > MAX_SEARCH_FILE_BYTES {
            continue;
        }
        let bytes = match std::fs::read(entry.path()) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        if bytes.contains(&0) {
            continue;
        }
        let content = String::from_utf8_lossy(&bytes);
        let mut file_matches = Vec::new();
        let mut file_match_count = 0usize;
        for (line_index, line) in content.lines().enumerate() {
            for capture in regex.find_iter(line) {
                file_match_count += 1;
                total_matches += 1;
                if file_matches.len() < 50 {
                    file_matches.push(WorkspaceTextSearchMatch {
                        line: line_index + 1,
                        column: line[..capture.start()].chars().count() + 1,
                        end_column: line[..capture.end()].chars().count() + 1,
                        preview: build_preview(line, capture.start(), capture.end()),
                    });
                }
                if total_matches >= MAX_SEARCH_MATCHES {
                    limit_hit = true;
                    break;
                }
            }
            if limit_hit {
                break;
            }
        }
        if file_match_count > 0 {
            total_files += 1;
            files.push(WorkspaceTextSearchFileResult {
                path: normalized,
                match_count: file_match_count,
                matches: file_matches,
            });
        }
        if limit_hit {
            break;
        }
    }

    Ok(WorkspaceTextSearchResponse {
        files,
        file_count: total_files,
        match_count: total_matches,
        limit_hit,
    })
}

pub(crate) fn list_workspace_files_inner(
    root: &PathBuf,
    max_files: usize,
) -> WorkspaceFilesResponse {
    let scan_started_at = Instant::now();
    let mut scanned_entries = 0usize;
    let max_directories = max_files.saturating_mul(2).max(1_000);
    let mut files = Vec::new();
    let mut directories = Vec::new();
    let mut gitignored_files = Vec::new();
    let mut gitignored_directories = Vec::new();
    let pruned_special_directories: Arc<Mutex<HashSet<String>>> =
        Arc::new(Mutex::new(HashSet::new()));

    // Always open the repo so we can tag gitignored files for dimmed styling.
    let repo = Repository::open(root).ok();

    // Seed root-level entries first so the file tree always reflects the real workspace root
    // even when deep traversal later hits the max file cap.
    if let Ok(entries) = std::fs::read_dir(root) {
        let mut root_entries = entries
            .filter_map(|entry| {
                if workspace_scan_budget_reached(scan_started_at, scanned_entries) {
                    return None;
                }
                scanned_entries += 1;
                entry.ok()
            })
            .collect::<Vec<_>>();
        root_entries.sort_by(|a, b| {
            a.file_name()
                .to_string_lossy()
                .cmp(&b.file_name().to_string_lossy())
        });
        for entry in root_entries {
            if workspace_scan_budget_reached(scan_started_at, scanned_entries) {
                break;
            }
            let path = entry.path();
            let rel_path = match path.strip_prefix(root) {
                Ok(path) => path,
                Err(_) => continue,
            };
            let normalized = normalize_git_path(&rel_path.to_string_lossy());
            if normalized.is_empty() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            let is_ignored = repo
                .as_ref()
                .and_then(|r| r.status_should_ignore(rel_path).ok())
                .unwrap_or(false);
            if file_type.is_dir() {
                if should_always_skip(&name) {
                    continue;
                }
                if directories.len() >= max_directories {
                    continue;
                }
                directories.push(normalized.clone());
                if is_ignored {
                    gitignored_directories.push(normalized);
                }
            } else if file_type.is_file() {
                if name == ".DS_Store" {
                    continue;
                }
                files.push(normalized.clone());
                if is_ignored {
                    gitignored_files.push(normalized);
                }
                if files.len() >= max_files {
                    sort_and_dedup_workspace_lists(
                        &mut files,
                        &mut directories,
                        &mut gitignored_files,
                        &mut gitignored_directories,
                    );
                    return WorkspaceFilesResponse {
                        files,
                        directories,
                        gitignored_files,
                        gitignored_directories,
                    };
                }
            }
        }
    }

    let root_for_filter = root.clone();
    let pruned_special_directories_for_filter = Arc::clone(&pruned_special_directories);
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .follow_links(false)
        .require_git(false)
        .git_ignore(false)
        .filter_entry(move |entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                if should_always_skip(&name) {
                    return false;
                }
                if let Ok(rel_path) = entry.path().strip_prefix(&root_for_filter) {
                    let normalized = normalize_git_path(&rel_path.to_string_lossy());
                    if !normalized.is_empty() && is_special_directory_path(&normalized) {
                        if let Ok(mut special_dirs) = pruned_special_directories_for_filter.lock() {
                            special_dirs.insert(normalized);
                        }
                        return false;
                    }
                }
                return true;
            }
            // Skip OS metadata files
            name != ".DS_Store"
        })
        .build();

    for entry in walker {
        if workspace_scan_budget_reached(scan_started_at, scanned_entries) {
            break;
        }
        scanned_entries += 1;
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if entry.depth() <= 1 {
            continue;
        }
        if let Ok(rel_path) = entry.path().strip_prefix(root) {
            let normalized = normalize_git_path(&rel_path.to_string_lossy());
            if normalized.is_empty() {
                continue;
            }
            let is_ignored = repo
                .as_ref()
                .and_then(|r| r.status_should_ignore(rel_path).ok())
                .unwrap_or(false);
            if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                if directories.len() >= max_directories {
                    continue;
                }
                directories.push(normalized.clone());
                if is_ignored {
                    gitignored_directories.push(normalized);
                }
            } else if entry.file_type().is_some_and(|ft| ft.is_file()) {
                files.push(normalized.clone());
                if is_ignored {
                    gitignored_files.push(normalized);
                }
                if files.len() >= max_files {
                    break;
                }
            }
        }
    }

    if let Ok(special_dirs) = pruned_special_directories.lock() {
        for normalized in special_dirs.iter() {
            directories.push(normalized.clone());
            let relative_path = normalized_relative_to_pathbuf(normalized);
            let is_ignored = repo
                .as_ref()
                .and_then(|r| r.status_should_ignore(&relative_path).ok())
                .unwrap_or(false);
            if is_ignored {
                gitignored_directories.push(normalized.clone());
            }
        }
    }

    sort_and_dedup_workspace_lists(
        &mut files,
        &mut directories,
        &mut gitignored_files,
        &mut gitignored_directories,
    );
    WorkspaceFilesResponse {
        files,
        directories,
        gitignored_files,
        gitignored_directories,
    }
}

pub(crate) fn list_workspace_directory_children_inner(
    root: &PathBuf,
    directory_path: &str,
    max_entries: usize,
) -> Result<WorkspaceFilesResponse, String> {
    let normalized_path = normalize_workspace_relative_path(directory_path)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve workspace root: {err}"))?;
    let candidate = canonical_root.join(normalized_relative_to_pathbuf(&normalized_path));
    let canonical_path = candidate
        .canonicalize()
        .map_err(|err| format!("Failed to resolve directory path: {err}"))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Invalid directory path.".to_string());
    }
    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read directory metadata: {err}"))?;
    if !metadata.is_dir() {
        return Err("Path is not a directory.".to_string());
    }

    let repo = Repository::open(&canonical_root).ok();
    let mut files = Vec::new();
    let mut directories = Vec::new();
    let mut gitignored_files = Vec::new();
    let mut gitignored_directories = Vec::new();

    let entries = std::fs::read_dir(&canonical_path)
        .map_err(|err| format!("Failed to read directory: {err}"))?;
    let scan_started_at = Instant::now();
    let max_scanned_entries = max_entries
        .saturating_mul(WORKSPACE_DIRECTORY_SCAN_BUDGET_MULTIPLIER)
        .max(max_entries);
    let mut sorted_entries = Vec::new();
    for entry in entries {
        if scan_started_at.elapsed() >= WORKSPACE_SCAN_TIME_BUDGET {
            break;
        }
        if sorted_entries.len() >= max_scanned_entries {
            break;
        }
        if let Ok(entry) = entry {
            sorted_entries.push((entry.file_name().to_string_lossy().to_string(), entry));
        }
    }
    sort_and_truncate_named_entries(&mut sorted_entries, max_scanned_entries);

    for (_, entry) in sorted_entries {
        let path = entry.path();
        let rel_path = match path.strip_prefix(&canonical_root) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let normalized = normalize_git_path(&rel_path.to_string_lossy());
        if normalized.is_empty() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let is_ignored = repo
            .as_ref()
            .and_then(|r| r.status_should_ignore(rel_path).ok())
            .unwrap_or(false);

        if file_type.is_dir() {
            if should_always_skip(&name) {
                continue;
            }
            directories.push(normalized.clone());
            if is_ignored {
                gitignored_directories.push(normalized);
            }
        } else if file_type.is_file() {
            if name == ".DS_Store" {
                continue;
            }
            files.push(normalized.clone());
            if is_ignored {
                gitignored_files.push(normalized);
            }
        }

        if files.len() + directories.len() >= max_entries {
            break;
        }
    }

    sort_and_dedup_workspace_lists(
        &mut files,
        &mut directories,
        &mut gitignored_files,
        &mut gitignored_directories,
    );
    Ok(WorkspaceFilesResponse {
        files,
        directories,
        gitignored_files,
        gitignored_directories,
    })
}

const MAX_WORKSPACE_FILE_BYTES: u64 = 400_000;

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct WorkspaceFileResponse {
    content: String,
    truncated: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct ExternalSpecFileResponse {
    pub(crate) exists: bool,
    pub(crate) content: String,
    pub(crate) truncated: bool,
}

fn normalize_external_spec_root(spec_root: &str) -> Result<PathBuf, String> {
    let trimmed = spec_root.trim();
    if trimmed.is_empty() {
        return Err("Spec root cannot be empty.".to_string());
    }
    let root = PathBuf::from(trimmed);
    if !root.is_absolute() {
        return Err("Spec root must be an absolute path.".to_string());
    }
    let canonical = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve custom spec root: {err}"))?;
    if !canonical.is_dir() {
        return Err("Custom spec root is not a directory.".to_string());
    }
    Ok(canonical)
}

struct ResolvedExternalSpecRoot {
    root: PathBuf,
    exists: bool,
}

fn resolve_external_spec_root(spec_root: &str) -> Result<ResolvedExternalSpecRoot, String> {
    let custom_root = normalize_external_spec_root(spec_root)?;
    let file_name = custom_root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if file_name.eq_ignore_ascii_case("openspec") {
        return Ok(ResolvedExternalSpecRoot {
            root: custom_root,
            exists: true,
        });
    }

    let nested = custom_root.join("openspec");
    if nested.is_dir() {
        let canonical_nested = nested
            .canonicalize()
            .map_err(|err| format!("Failed to resolve custom spec root: {err}"))?;
        return Ok(ResolvedExternalSpecRoot {
            root: canonical_nested,
            exists: true,
        });
    }

    // Backward compatibility: older clients may pass the openspec root directly
    // even if directory name is not literally `openspec`.
    let legacy_root = custom_root.join("changes").is_dir() && custom_root.join("specs").is_dir();
    if legacy_root {
        return Ok(ResolvedExternalSpecRoot {
            root: custom_root,
            exists: true,
        });
    }

    Ok(ResolvedExternalSpecRoot {
        root: nested,
        exists: false,
    })
}

fn resolve_external_spec_logical_path(
    spec_root: &Path,
    logical_path: &str,
) -> Result<PathBuf, String> {
    let normalized = logical_path.trim().replace('\\', "/");
    if normalized == "openspec" {
        return Ok(spec_root.to_path_buf());
    }
    if !normalized.starts_with("openspec/") {
        return Err("External spec path must be under openspec/.".to_string());
    }
    let suffix = normalized["openspec/".len()..].trim();
    if suffix.is_empty() {
        return Ok(spec_root.to_path_buf());
    }
    let relative = Path::new(suffix);
    for component in relative.components() {
        match component {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Invalid external spec path.".to_string());
            }
            _ => {}
        }
    }
    Ok(spec_root.join(relative))
}

pub(crate) fn list_external_spec_tree_inner(
    spec_root: &str,
    max_files: usize,
) -> Result<WorkspaceFilesResponse, String> {
    let resolved = resolve_external_spec_root(spec_root)?;
    let mut files = Vec::new();
    let mut directories = vec!["openspec".to_string()];
    if !resolved.exists {
        return Ok(WorkspaceFilesResponse {
            files,
            directories,
            gitignored_files: Vec::new(),
            gitignored_directories: Vec::new(),
        });
    }
    let root = resolved.root;

    let walker = WalkBuilder::new(&root)
        .hidden(false)
        .follow_links(false)
        .require_git(false)
        .git_ignore(false)
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                return !should_always_skip(&name);
            }
            name != ".DS_Store"
        })
        .build();

    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let rel_path = match entry.path().strip_prefix(&root) {
            Ok(path) => path,
            Err(_) => continue,
        };
        let normalized = normalize_git_path(&rel_path.to_string_lossy());
        if normalized.is_empty() {
            continue;
        }
        let logical = format!("openspec/{normalized}");
        if entry.file_type().is_some_and(|ft| ft.is_dir()) {
            directories.push(logical);
        } else if entry.file_type().is_some_and(|ft| ft.is_file()) {
            files.push(logical);
            if files.len() >= max_files {
                break;
            }
        }
    }

    files.sort();
    files.dedup();
    directories.sort();
    directories.dedup();
    Ok(WorkspaceFilesResponse {
        files,
        directories,
        gitignored_files: Vec::new(),
        gitignored_directories: Vec::new(),
    })
}

pub(crate) fn read_external_spec_file_inner(
    spec_root: &str,
    logical_path: &str,
) -> Result<ExternalSpecFileResponse, String> {
    let resolved = resolve_external_spec_root(spec_root)?;
    if !resolved.exists {
        return Ok(ExternalSpecFileResponse {
            exists: false,
            content: String::new(),
            truncated: false,
        });
    }
    let root = resolved.root;
    let candidate = resolve_external_spec_logical_path(&root, logical_path)?;
    if !candidate.exists() {
        return Ok(ExternalSpecFileResponse {
            exists: false,
            content: String::new(),
            truncated: false,
        });
    }
    let canonical_path = candidate
        .canonicalize()
        .map_err(|err| format!("Failed to resolve external spec file: {err}"))?;
    if !canonical_path.starts_with(&root) {
        return Err("Invalid external spec file path.".to_string());
    }
    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read external spec file metadata: {err}"))?;
    if !metadata.is_file() {
        return Ok(ExternalSpecFileResponse {
            exists: false,
            content: String::new(),
            truncated: false,
        });
    }

    let file = File::open(&canonical_path)
        .map_err(|err| format!("Failed to open external spec file: {err}"))?;
    let mut buffer = Vec::new();
    file.take(MAX_WORKSPACE_FILE_BYTES + 1)
        .read_to_end(&mut buffer)
        .map_err(|err| format!("Failed to read external spec file: {err}"))?;

    let truncated = buffer.len() > MAX_WORKSPACE_FILE_BYTES as usize;
    if truncated {
        buffer.truncate(MAX_WORKSPACE_FILE_BYTES as usize);
    }
    let content = decode_text_bytes(&buffer, "External spec file")?;
    Ok(ExternalSpecFileResponse {
        exists: true,
        content,
        truncated,
    })
}

pub(crate) fn write_external_spec_file_inner(
    spec_root: &str,
    logical_path: &str,
    content: &str,
) -> Result<(), String> {
    if content.len() > MAX_WORKSPACE_FILE_BYTES as usize {
        return Err("File content exceeds maximum allowed size".to_string());
    }
    let resolved = resolve_external_spec_root(spec_root)?;
    let root = resolved.root;
    let candidate = resolve_external_spec_logical_path(&root, logical_path)?;
    if candidate == root {
        return Err("Cannot write to external spec root directory directly.".to_string());
    }

    let normalized = logical_path.replace('\\', "/");
    if normalized == ".git"
        || normalized.starts_with(".git/")
        || normalized.contains("/.git/")
        || normalized.ends_with("/.git")
    {
        return Err("Cannot write to .git directory".to_string());
    }

    if let Some(parent) = candidate.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create external spec parent directory: {err}"))?;
        let canonical_root = root
            .canonicalize()
            .map_err(|err| format!("Failed to resolve external spec root: {err}"))?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|err| format!("Failed to resolve external spec parent directory: {err}"))?;
        if !canonical_parent.starts_with(&canonical_root) {
            return Err("Invalid external spec file path.".to_string());
        }
    } else {
        return Err("Invalid external spec file path.".to_string());
    }

    std::fs::write(&candidate, content)
        .map_err(|err| format!("Failed to write external spec file: {err}"))?;
    Ok(())
}

pub(crate) fn read_workspace_file_inner(
    root: &PathBuf,
    relative_path: &str,
) -> Result<WorkspaceFileResponse, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve workspace root: {err}"))?;
    let candidate = canonical_root.join(relative_path);
    let canonical_path = candidate
        .canonicalize()
        .map_err(|err| format!("Failed to open file: {err}"))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Invalid file path".to_string());
    }
    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read file metadata: {err}"))?;
    if !metadata.is_file() {
        return Err("Path is not a file".to_string());
    }

    let file = File::open(&canonical_path).map_err(|err| format!("Failed to open file: {err}"))?;
    let mut buffer = Vec::new();
    file.take(MAX_WORKSPACE_FILE_BYTES + 1)
        .read_to_end(&mut buffer)
        .map_err(|err| format!("Failed to read file: {err}"))?;

    let truncated = buffer.len() > MAX_WORKSPACE_FILE_BYTES as usize;
    if truncated {
        buffer.truncate(MAX_WORKSPACE_FILE_BYTES as usize);
    }

    let content = decode_text_bytes(&buffer, "File")?;
    Ok(WorkspaceFileResponse { content, truncated })
}

pub(crate) fn write_workspace_file_inner(
    root: &PathBuf,
    relative_path: &str,
    content: &str,
) -> Result<(), String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve workspace root: {err}"))?;
    let candidate = canonical_root.join(relative_path);

    // Ensure the parent directory exists so we can canonicalize safely.
    if let Some(parent) = candidate.parent() {
        let canonical_parent = parent
            .canonicalize()
            .map_err(|err| format!("Failed to resolve parent directory: {err}"))?;
        if !canonical_parent.starts_with(&canonical_root) {
            return Err("Invalid file path".to_string());
        }
    }

    // Block writes into .git directories.
    let normalized = relative_path.replace('\\', "/");
    if normalized == ".git"
        || normalized.starts_with(".git/")
        || normalized.contains("/.git/")
        || normalized.contains("/.git")
    {
        return Err("Cannot write to .git directory".to_string());
    }

    if content.len() > MAX_WORKSPACE_FILE_BYTES as usize {
        return Err("File content exceeds maximum allowed size".to_string());
    }

    std::fs::write(&candidate, content).map_err(|err| format!("Failed to write file: {err}"))?;
    Ok(())
}

pub(crate) fn create_workspace_directory_inner(
    root: &PathBuf,
    relative_path: &str,
) -> Result<(), String> {
    let normalized_path = normalize_workspace_relative_path(relative_path)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve workspace root: {err}"))?;
    let candidate = canonical_root.join(normalized_relative_to_pathbuf(&normalized_path));

    // Ensure the parent directory exists and resolves inside workspace root.
    if let Some(parent) = candidate.parent() {
        let canonical_parent = parent
            .canonicalize()
            .map_err(|err| format!("Failed to resolve parent directory: {err}"))?;
        if !canonical_parent.starts_with(&canonical_root) {
            return Err("Invalid directory path".to_string());
        }
    }

    if candidate.exists() {
        let metadata = std::fs::metadata(&candidate)
            .map_err(|err| format!("Failed to read path metadata: {err}"))?;
        if metadata.is_dir() {
            return Ok(());
        }
        return Err("Path already exists and is not a directory.".to_string());
    }

    std::fs::create_dir(&candidate).map_err(|err| format!("Failed to create directory: {err}"))?;
    Ok(())
}

pub(crate) fn trash_workspace_item_inner(
    root: &PathBuf,
    relative_path: &str,
) -> Result<(), String> {
    let normalized_path = normalize_workspace_relative_path(relative_path)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve workspace root: {err}"))?;
    let candidate = canonical_root.join(normalized_relative_to_pathbuf(&normalized_path));
    let canonical_path = candidate
        .canonicalize()
        .map_err(|err| format!("Failed to resolve path: {err}"))?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err("Invalid file path".to_string());
    }

    if !canonical_path.exists() {
        return Err("Path does not exist".to_string());
    }

    trash::delete(&canonical_path).map_err(|err| format!("Failed to move to trash: {err}"))?;

    Ok(())
}

/// Copy a file or directory within the workspace, appending " copy" (or " copy N")
/// to avoid name collisions.
pub(crate) fn copy_workspace_item_inner(
    root: &PathBuf,
    relative_path: &str,
) -> Result<String, String> {
    let normalized_path = normalize_workspace_relative_path(relative_path)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve workspace root: {err}"))?;
    let candidate = canonical_root.join(normalized_relative_to_pathbuf(&normalized_path));
    let canonical_path = candidate
        .canonicalize()
        .map_err(|err| format!("Failed to resolve path: {err}"))?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err("Invalid file path".to_string());
    }

    if !canonical_path.exists() {
        return Err("Path does not exist".to_string());
    }

    // Build destination path with " copy" suffix
    let parent = canonical_path
        .parent()
        .ok_or_else(|| "Invalid file path".to_string())?;

    let stem = canonical_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let ext = canonical_path.extension().and_then(|s| s.to_str());

    let mut dest;
    let mut counter = 0u32;
    loop {
        let suffix = if counter == 0 {
            " copy".to_string()
        } else {
            format!(" copy {counter}")
        };
        let new_name = if canonical_path.is_dir() {
            format!("{stem}{suffix}")
        } else if let Some(e) = ext {
            format!("{stem}{suffix}.{e}")
        } else {
            format!("{stem}{suffix}")
        };
        dest = parent.join(&new_name);
        if !dest.exists() {
            break;
        }
        counter += 1;
        if counter > 999 {
            return Err("Too many copies exist".to_string());
        }
    }

    if canonical_path.is_dir() {
        copy_dir_recursive(&canonical_path, &dest)?;
    } else {
        std::fs::copy(&canonical_path, &dest)
            .map_err(|err| format!("Failed to copy file: {err}"))?;
    }

    // Return the relative path of the new copy
    let new_relative = dest
        .strip_prefix(&canonical_root)
        .map_err(|_| "Failed to compute relative path".to_string())?;
    Ok(normalize_git_path(&new_relative.to_string_lossy()))
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|err| format!("Failed to create directory: {err}"))?;
    for entry in std::fs::read_dir(src).map_err(|err| format!("Failed to read directory: {err}"))? {
        let entry = entry.map_err(|err| format!("Failed to read entry: {err}"))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)
                .map_err(|err| format!("Failed to copy file: {err}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        compile_search_regex, create_workspace_directory_inner, is_special_directory_path,
        list_external_spec_tree_inner, list_workspace_directory_children_inner,
        list_workspace_files_inner,
        normalize_workspace_relative_path, read_external_spec_file_inner,
        read_workspace_file_inner, search_workspace_text_inner, sort_and_truncate_named_entries,
        WorkspaceTextSearchOptions,
    };
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use uuid::Uuid;

    #[test]
    fn special_directory_path_detection_supports_dependency_dirs() {
        assert!(is_special_directory_path("node_modules"));
        assert!(is_special_directory_path("apps/web/node_modules"));
        assert!(is_special_directory_path("tools/.pnpm-store"));
        assert!(is_special_directory_path("sdk/.m2"));
        assert!(is_special_directory_path("rust/.cargo"));
    }

    #[test]
    fn special_directory_path_detection_supports_build_dirs() {
        assert!(is_special_directory_path("target"));
        assert!(is_special_directory_path("packages/ui/dist"));
        assert!(is_special_directory_path("service/build"));
        assert!(is_special_directory_path("native/cmake-build-debug"));
        assert!(is_special_directory_path("cache/.turbo"));
    }

    #[test]
    fn special_directory_path_detection_does_not_match_source_or_docs() {
        assert!(!is_special_directory_path("src"));
        assert!(!is_special_directory_path("docs"));
        assert!(!is_special_directory_path("apps/web/src"));
    }

    #[test]
    fn normalize_workspace_relative_path_rejects_empty_or_escaped_inputs() {
        assert!(normalize_workspace_relative_path("").is_err());
        assert!(normalize_workspace_relative_path("/").is_err());
        assert!(normalize_workspace_relative_path("../outside").is_err());
        assert!(normalize_workspace_relative_path("./local").is_err());
        assert!(normalize_workspace_relative_path(".git/config").is_err());
    }

    #[test]
    fn normalize_workspace_relative_path_accepts_regular_relative_path() {
        assert_eq!(
            normalize_workspace_relative_path("src/main.ts").expect("valid relative path"),
            "src/main.ts".to_string()
        );
    }

    #[test]
    fn create_workspace_directory_creates_relative_directory() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock moved backwards")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("mossx-dir-create-{suffix}"));
        std::fs::create_dir_all(&root).expect("create root");

        create_workspace_directory_inner(&PathBuf::from(&root), "docs").expect("create docs");
        assert!(root.join("docs").is_dir());

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn compile_search_regex_respects_whole_word() {
        let regex = compile_search_regex(
            "code",
            &WorkspaceTextSearchOptions {
                case_sensitive: false,
                whole_word: true,
                is_regex: false,
                include_pattern: None,
                exclude_pattern: None,
            },
        )
        .expect("regex");

        assert!(regex.is_match("code"));
        assert!(!regex.is_match("codemoss"));
    }

    #[test]
    fn search_workspace_text_finds_matches_and_honors_include_pattern() {
        let root = std::env::temp_dir().join(format!("mossx-search-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).expect("create src dir");
        std::fs::write(
            root.join("src/main.ts"),
            "const codemoss = 1;\nconst code = 2;\n",
        )
        .expect("write main.ts");
        std::fs::write(root.join("README.md"), "codemoss docs\n").expect("write readme");

        let response = search_workspace_text_inner(
            &root,
            "codemoss",
            &WorkspaceTextSearchOptions {
                case_sensitive: false,
                whole_word: false,
                is_regex: false,
                include_pattern: Some("src/**".to_string()),
                exclude_pattern: None,
            },
        )
        .expect("search response");

        assert_eq!(response.file_count, 1);
        assert_eq!(response.match_count, 1);
        assert_eq!(response.files[0].path, "src/main.ts");
        assert_eq!(response.files[0].matches[0].line, 1);

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_workspace_files_keeps_scanning_files_when_directory_cap_reached() {
        let root = std::env::temp_dir().join(format!("mossx-files-cap-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create root");

        for index in 0..1_010usize {
            std::fs::create_dir_all(root.join(format!("a-dir-{index:04}")))
                .expect("create directory");
        }
        std::fs::write(root.join("z-last-file.ts"), "export const ok = true;\n")
            .expect("write test file");

        let response = list_workspace_files_inner(&root, 1);

        assert!(
            response.files.iter().any(|path| path == "z-last-file.ts"),
            "expected file scan to continue after directory cap"
        );
        assert!(
            response.directories.len() <= 1_000,
            "directory list should still honor cap"
        );

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn list_workspace_files_keeps_scanning_deep_files_when_directory_cap_reached() {
        let root = std::env::temp_dir().join(format!("mossx-files-deep-cap-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create root");

        for index in 0..1_010usize {
            std::fs::create_dir_all(root.join(format!("a-dir-{index:04}")))
                .expect("create directory");
        }
        let deep_dir = root.join("z-deep").join("nested");
        std::fs::create_dir_all(&deep_dir).expect("create deep dir");
        std::fs::write(deep_dir.join("hit.ts"), "export const deep = true;\n")
            .expect("write deep file");

        let response = list_workspace_files_inner(&root, 1);

        assert!(
            response
                .files
                .iter()
                .any(|path| path == "z-deep/nested/hit.ts"),
            "expected walker to keep scanning deep files after directory cap"
        );
        assert!(
            response.directories.len() <= 1_000,
            "directory list should still honor cap"
        );

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn sort_and_truncate_named_entries_sorts_before_truncating() {
        let mut entries = vec![
            ("z-item".to_string(), 1usize),
            ("m-item".to_string(), 2usize),
            ("a-item".to_string(), 3usize),
            ("b-item".to_string(), 4usize),
        ];

        sort_and_truncate_named_entries(&mut entries, 2);

        let names: Vec<String> = entries.into_iter().map(|(name, _)| name).collect();
        assert_eq!(names, vec!["a-item".to_string(), "b-item".to_string()]);
    }

    #[test]
    fn list_workspace_directory_children_returns_sorted_entries() {
        let root = std::env::temp_dir().join(format!("mossx-dir-children-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("bucket")).expect("create bucket dir");
        std::fs::write(root.join("bucket/z.ts"), "z\n").expect("write z");
        std::fs::write(root.join("bucket/a.ts"), "a\n").expect("write a");
        std::fs::write(root.join("bucket/m.ts"), "m\n").expect("write m");

        let response =
            list_workspace_directory_children_inner(&root, "bucket", 3).expect("list children");

        assert_eq!(
            response.files,
            vec![
                "bucket/a.ts".to_string(),
                "bucket/m.ts".to_string(),
                "bucket/z.ts".to_string()
            ]
        );

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn read_workspace_file_decodes_gb18030_text() {
        let root = std::env::temp_dir().join(format!("mossx-read-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("docs")).expect("create docs");
        let (encoded, _, had_errors) = encoding_rs::GB18030.encode("usb异常断开");
        assert!(!had_errors, "encode should succeed");
        std::fs::write(root.join("docs/main_lin_test.c"), encoded.as_ref()).expect("write file");

        let response = read_workspace_file_inner(&PathBuf::from(&root), "docs/main_lin_test.c")
            .expect("read file");

        assert_eq!(response.content, "usb异常断开");
        assert!(!response.truncated);

        std::fs::remove_dir_all(&root).expect("cleanup root");
    }

    #[test]
    fn read_external_spec_file_decodes_gb18030_text() {
        let project_root = std::env::temp_dir().join(format!("mossx-spec-{}", Uuid::new_v4()));
        let openspec_root = project_root.join("openspec");
        std::fs::create_dir_all(&openspec_root).expect("create spec root");
        let (encoded, _, had_errors) = encoding_rs::GB18030.encode("重新插拔usb会恢复");
        assert!(!had_errors, "encode should succeed");
        std::fs::write(openspec_root.join("legacy.c"), encoded.as_ref()).expect("write file");

        let response = read_external_spec_file_inner(
            project_root.to_str().expect("root path"),
            "openspec/legacy.c",
        )
        .expect("read file");

        assert!(response.exists);
        assert_eq!(response.content, "重新插拔usb会恢复");
        assert!(!response.truncated);

        std::fs::remove_dir_all(&project_root).expect("cleanup root");
    }

    #[test]
    fn read_external_spec_file_supports_direct_openspec_root_input() {
        let project_root =
            std::env::temp_dir().join(format!("mossx-openspec-direct-{}", Uuid::new_v4()));
        let openspec_root = project_root.join("openspec");
        std::fs::create_dir_all(&openspec_root).expect("create spec root");
        std::fs::write(openspec_root.join("project.md"), "# Project Context").expect("write file");

        let response = read_external_spec_file_inner(
            openspec_root.to_str().expect("root path"),
            "openspec/project.md",
        )
        .expect("read file");

        assert!(response.exists);
        assert_eq!(response.content, "# Project Context");

        std::fs::remove_dir_all(&project_root).expect("cleanup root");
    }

    #[test]
    fn list_external_spec_tree_returns_placeholder_when_project_root_has_no_openspec() {
        let project_root =
            std::env::temp_dir().join(format!("mossx-project-no-openspec-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&project_root).expect("create project root");
        std::fs::write(project_root.join("package.json"), "{}").expect("write project file");

        let response =
            list_external_spec_tree_inner(project_root.to_str().expect("root path"), 100)
                .expect("list tree");

        assert_eq!(response.files, Vec::<String>::new());
        assert_eq!(response.directories, vec!["openspec".to_string()]);

        std::fs::remove_dir_all(&project_root).expect("cleanup root");
    }
}
