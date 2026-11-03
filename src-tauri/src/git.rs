use git2::{Repository, StatusOptions};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileEntry {
    pub path: String,
    pub status: String, // "modified" | "added" | "deleted" | "renamed" | "typechange"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additions: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletions: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub staged: Vec<GitFileEntry>,
    pub unstaged: Vec<GitFileEntry>,
    pub untracked: Vec<GitFileEntry>,
    /// Commits the branch is ahead of / behind its upstream; `None` when the
    /// branch has no upstream (or HEAD is detached/unborn).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behind: Option<usize>,
}

/// Compact status for a directory that is itself a Git worktree root,
/// rendered inline in the file tree. Unlike `GitStatus` it carries no file
/// paths or diff stats — only the branch plus change counts.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySummary {
    pub path: String,
    pub branch: String,
    pub changed: usize,
    pub untracked: usize,
}

#[derive(Debug, Clone)]
pub struct WorkspaceVcsMetadata {
    pub git_branch: Option<String>,
    pub git_head: Option<String>,
    pub dirty: bool,
}

/// Small read-only VCS summary used by the generic workspace metadata API.
pub fn workspace_vcs_metadata(path: &Path) -> Option<WorkspaceVcsMetadata> {
    let repo = Repository::discover(path).ok()?;
    let head = repo.head().ok();
    // A detached HEAD's shorthand is the literal "HEAD" — that is not a
    // branch name, and plugins key per-branch state off this field.
    let git_branch = head
        .as_ref()
        .filter(|_| !repo.head_detached().unwrap_or(false))
        .and_then(|head| head.shorthand().map(str::to_owned));
    let git_head = head.as_ref().and_then(|head| head.target()).map(|oid| oid.to_string());
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    // Unknown is not clean: a failed status read must not report a spotless
    // worktree. Conservative dirty=true only makes a plugin refresh more.
    let dirty = repo.statuses(Some(&mut opts)).map(|statuses| !statuses.is_empty()).unwrap_or(true);
    Some(WorkspaceVcsMetadata { git_branch, git_head, dirty })
}

/// Open `path` only when that directory is itself a worktree root. Standard
/// worktrees have a `.git` directory; linked worktrees carry a `.git` file.
/// The cheap `.git` existence guard avoids `Repository::discover` walking up
/// and mislabeling every ordinary folder under the workspace repo. The
/// canonicalized comparison then rejects a parent repo opened through a
/// stale/odd `.git` layout.
fn open_exact_repo(path: &std::path::Path) -> Option<Repository> {
    if !path.join(".git").exists() {
        return None;
    }
    let repo = Repository::open(path).ok()?;
    let workdir = repo.workdir()?;
    let expected = std::fs::canonicalize(path).ok()?;
    let actual = std::fs::canonicalize(workdir).ok()?;
    (actual == expected).then_some(repo)
}

fn exact_repository_summary(path: &std::path::Path) -> Option<RepositorySummary> {
    repository_summary_cached(path, &mut TreeSnapshots::new(true))
}

fn repository_summary_cached(
    path: &Path,
    snapshots: &mut TreeSnapshots,
) -> Option<RepositorySummary> {
    let repo = open_exact_repo(path)?;
    let branch = repo
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(str::to_string))
        .unwrap_or_else(|| "HEAD".to_string());
    let statuses = snapshots.get(&repo)?;
    // Paths can appear both staged and worktree-modified; count each file
    // once per bucket so `M1` means one modified file, not one diff.
    let mut changed = std::collections::HashSet::new();
    let mut untracked = std::collections::HashSet::new();
    for (file, status) in statuses {
        if status.contains(git2::Status::WT_NEW) && !status.contains(git2::Status::INDEX_NEW) {
            untracked.insert(file.clone());
        } else {
            changed.insert(file.clone());
        }
    }
    Some(RepositorySummary {
        path: path.to_string_lossy().into_owned(),
        branch,
        changed: changed.len(),
        untracked: untracked.len(),
    })
}

/// Sync body of `git_repository_summaries`: one batch answers one loaded
/// tree level, so a status walk per candidate stays off the IPC thread.
fn repository_summaries_blocking(paths: Vec<String>) -> Vec<RepositorySummary> {
    paths
        .iter()
        .filter_map(|path| exact_repository_summary(std::path::Path::new(path)))
        .collect()
}

#[tauri::command]
pub async fn git_repository_summaries(paths: Vec<String>) -> Vec<RepositorySummary> {
    tauri::async_runtime::spawn_blocking(move || repository_summaries_blocking(paths))
        .await
        .unwrap_or_default()
}

/// Directory names never descended into while discovering repositories:
/// build output and dependency trees hold vendored copies of themselves
/// (`node_modules/...`, `target/...`) that would otherwise turn a shallow
/// scan into a full-disk walk.
const DISCOVERY_SKIP_DIRS: [&str; 11] = [
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "target",
    "build",
    "dist",
    ".idea",
    ".gradle",
    ".next",
    "vendor",
];
/// Depth limit for the workspace-root walk. Real layouts nest at most a few
/// directories deep; deeper hits are build output, not projects.
const DISCOVERY_MAX_DEPTH: usize = 6;
/// Repository cap: the frontend renders one section per repo, so a huge
/// monorepo tree must degrade into "some repos" rather than an unbounded walk.
const DISCOVERY_MAX_REPOS: usize = 64;

/// Recursive descent collecting worktree roots. Depth and count are enforced
/// here rather than by the caller so both the command and the tests share one
/// implementation. Symlinks are skipped: a linked worktree/mirror subtree
/// would loop or duplicate the whole scan.
fn collect_repository_candidates(
    dir: &Path,
    depth: usize,
    max_depth: usize,
    max_repos: usize,
    out: &mut Vec<std::path::PathBuf>,
) {
    if depth > max_depth || out.len() >= max_repos {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= max_repos {
            return;
        }
        let path = entry.path();
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }
        let name = entry.file_name();
        if DISCOVERY_SKIP_DIRS.contains(&name.to_string_lossy().as_ref()) {
            continue;
        }
        if open_exact_repo(&path).is_some() {
            out.push(path.clone());
        }
        collect_repository_candidates(&path, depth + 1, max_depth, max_repos, out);
    }
}

/// Every repository root under `root`, `root` itself included when it is one.
/// Sorted by path so the frontend's sections stay stable across refreshes.
fn discover_repository_roots(
    root: &Path,
    max_depth: usize,
    max_repos: usize,
) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if open_exact_repo(root).is_some() {
        out.push(root.to_path_buf());
    } else if let Some(ancestor) = containing_repository_root(root) {
        // The workspace may be one project inside a larger repository (the
        // common \"open a subfolder of a monorepo\" case). `open_exact_repo`
        // deliberately does not walk up, so discover the containing worktree
        // here and keep its absolute root.
        out.push(ancestor);
    }
    collect_repository_candidates(root, 1, max_depth, max_repos, &mut out);
    out.sort();
    out.dedup();
    out
}

/// Nearest repository whose worktree contains `root`, when `root` is not
/// itself that worktree. Used only for the ancestor case above.
fn containing_repository_root(root: &Path) -> Option<std::path::PathBuf> {
    let repo = Repository::discover(root).ok()?;
    let workdir = repo.workdir()?;
    let actual = std::fs::canonicalize(workdir).ok()?;
    let expected = std::fs::canonicalize(root).ok()?;
    (actual != expected).then_some(workdir.to_path_buf())
}

/// Summaries for discovered roots, sharing one `TreeSnapshots` batch: the
/// status walk per repo is the expensive part, and a multi-project workspace
/// repeats it for every project.
fn repository_summaries_for_roots(roots: &[std::path::PathBuf]) -> Vec<RepositorySummary> {
    let mut snapshots = TreeSnapshots::new(true);
    roots
        .iter()
        .filter_map(|path| repository_summary_cached(path, &mut snapshots))
        .collect()
}

/// Sync body of `git_discover_repositories`: directory walk plus one status
/// walk per repo, both far too heavy for the IPC main thread.
fn discover_repositories_blocking(root: String) -> Vec<RepositorySummary> {
    let roots = discover_repository_roots(Path::new(&root), DISCOVERY_MAX_DEPTH, DISCOVERY_MAX_REPOS);
    repository_summaries_for_roots(&roots)
}

/// All repositories under a workspace root, so the changes panel can list
/// every project instead of only the one the file tree happens to have
/// selected.
#[tauri::command]
pub async fn git_discover_repositories(root: String) -> Vec<RepositorySummary> {
    tauri::async_runtime::spawn_blocking(move || discover_repositories_blocking(root))
        .await
        .unwrap_or_default()
}
/// Sidebar row icon source: the GitHub account behind a workspace's `origin`
/// remote. Only github.com remotes resolve — a local-only repo, a GitLab /
/// Gitee remote, or a missing origin is omitted so the row keeps its folder
/// icon instead of showing a guessed avatar.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOwner {
    pub path: String,
    pub login: String,
}

/// Sync body of `git_workspace_owners`. `Repository::discover` matches
/// `git_status`: a workspace opened on a repo subdirectory still counts.
fn workspace_owners_blocking(paths: Vec<String>) -> Vec<WorkspaceOwner> {
    paths
        .into_iter()
        .filter_map(|path| {
            let repo = Repository::discover(&path).ok()?;
            let url = repo.find_remote("origin").ok()?.url()?.to_string();
            let slug = crate::git_worktree::github_owner_repo(&url)?;
            let login = slug.split('/').next()?.to_string();
            Some(WorkspaceOwner { path, login })
        })
        .collect()
}

#[tauri::command]
pub async fn git_workspace_owners(paths: Vec<String>) -> Vec<WorkspaceOwner> {
    tauri::async_runtime::spawn_blocking(move || workspace_owners_blocking(paths))
        .await
        .unwrap_or_default()
}

/// Bulk colors for one loaded tree level. Two sources, merged:
/// 1. The repo *containing* the listed directory (any depth — the workspace
///    root itself, an ancestor, or none). Status paths are repo-relative, so
///    they are re-based onto the listed dir before matching; that way both a
///    root-level listing and a subdirectory listing inside one repo work.
/// 2. Each listed directory that is itself a nested repo root: its own
///    status decides its color, because the enclosing repo usually only sees
///    the whole subtree as one entry (or nothing at all when the workspace
///    root is not a repository).
pub fn file_tree_colors(path: &str, files: &[String]) -> HashMap<String, &'static str> {
    file_tree_colors_cached(path, files, &mut TreeSnapshots::new(false))
}

fn file_tree_colors_cached(
    path: &str,
    files: &[String],
    snapshots: &mut TreeSnapshots,
) -> HashMap<String, &'static str> {
    let listed = Path::new(path);
    let mut out: HashMap<String, &'static str> = HashMap::new();
    // O(1) membership for the two hot loops below (status entries × files).
    let file_set: std::collections::HashSet<&str> = files.iter().map(String::as_str).collect();

    let mut prefix = String::new();
    if let Ok(repo) = Repository::discover(listed) {
        let walk_ok = (|| {
            let workdir = repo.workdir()?;
            let listed_c = std::fs::canonicalize(listed).ok()?;
            let root_c = std::fs::canonicalize(workdir).ok()?;
            let rel = listed_c.strip_prefix(&root_c).ok()?;
            prefix = rel.to_string_lossy().replace('\\', "/");
            let statuses = snapshots.get(&repo)?;
            let with_prefix = if prefix.is_empty() {
                None
            } else {
                Some(format!("{prefix}/"))
            };
            for (raw, status) in statuses {
                // A trailing slash marks a collapsed untracked DIRECTORY —
                // strip it so the directory itself (and its ancestors) can
                // light up green.
                let file = raw.strip_suffix('/').unwrap_or(raw);
                // Re-base onto the listed directory: entries elsewhere in the
                // repo are irrelevant at this level.
                let rel_file = match &with_prefix {
                    Some(p) => match file.strip_prefix(p.as_str()) {
                        Some(r) => r,
                        None => continue,
                    },
                    None => file,
                };
                // INDEX_NEW is "added" (staged but never committed) — the
                // worktree side is a plain untracked file, so it paints as
                // untracked.
                let color = if status.intersects(git2::Status::INDEX_NEW | git2::Status::WT_NEW) {
                    "untracked"
                } else {
                    "modified"
                };
                // Direct hits at this level (files, or the collapsed
                // untracked dir itself)…
                if file_set.contains(rel_file) {
                    out.insert(rel_file.to_string(), color);
                }
                // …and parent propagation: a folder inherits the state of
                // anything under it, so parents light up without expanding.
                // Modified (uncommitted) wins over untracked when a folder
                // holds both kinds.
                let mut dir = Path::new(rel_file);
                while let Some(parent) = dir.parent() {
                    if parent.as_os_str().is_empty() {
                        break;
                    }
                    let key = parent.to_string_lossy().into_owned();
                    if file_set.contains(key.as_str()) {
                        let next = match out.get(&key).copied() {
                            Some("modified") => "modified",
                            _ => color,
                        };
                        out.insert(key, next);
                    }
                    dir = parent;
                }
            }
            Some(())
        })();
        let _ = walk_ok;
    }

    // Repo-root directories among the requested names paint blue — the tree
    // marks repository boundaries (nested repos like `CialloAssist` next to
    // plain folders like `ai-client-integration`), independent of their own
    // dirty state: the branch badge already carries that.
    for name in files {
        let dir = listed.join(name);
        if open_exact_repo(&dir).is_some() {
            out.insert(name.clone(), "repository");
        }
    }
    out
}

#[tauri::command]
pub async fn git_file_colors(
    path: String,
    files: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        file_tree_colors(&path, &files)
            .into_iter()
            .map(|(file, color)| (file, color.to_string()))
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
}

struct TreeSnapshots {
    statuses: HashMap<std::path::PathBuf, Option<Vec<(String, git2::Status)>>>,
    recurse_untracked_dirs: bool,
    #[cfg(test)]
    scans: usize,
}

impl TreeSnapshots {
    fn new(recurse_untracked_dirs: bool) -> Self {
        Self {
            statuses: HashMap::new(),
            recurse_untracked_dirs,
            #[cfg(test)]
            scans: 0,
        }
    }

    fn get(&mut self, repo: &Repository) -> Option<&Vec<(String, git2::Status)>> {
        let key = std::fs::canonicalize(repo.path()).ok()?;
        self.statuses
            .entry(key)
            .or_insert_with(|| {
                #[cfg(test)]
                {
                    self.scans += 1;
                }
                let mut opts = StatusOptions::new();
                opts.include_untracked(true)
                    .recurse_untracked_dirs(self.recurse_untracked_dirs);
                // Sparse checkouts hide unmaterialized paths from the tree:
                // same skip-worktree filter as `git_status`.
                let index = repo.index().ok();
                repo.statuses(Some(&mut opts)).ok().map(|statuses| {
                    statuses
                        .iter()
                        .filter_map(|entry| {
                            let path = entry.path().filter(|path| !path.is_empty())?;
                            if is_skip_worktree(index.as_ref(), path) {
                                return None;
                            }
                            Some((path.to_string(), entry.status()))
                        })
                        .collect()
                })
            })
            .as_ref()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTreeLevel {
    pub path: String,
    pub files: Vec<String>,
    pub directories: Vec<String>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTreeStatus {
    pub repositories: Vec<RepositorySummary>,
    pub file_colors: HashMap<String, HashMap<String, String>>,
}

fn tree_status_blocking(levels: Vec<GitTreeLevel>, snapshots: &mut TreeSnapshots) -> GitTreeStatus {
    let mut result = GitTreeStatus::default();
    let mut roots = std::collections::HashSet::new();
    for level in levels {
        let colors = file_tree_colors_cached(&level.path, &level.files, snapshots);
        result.file_colors.insert(
            level.path.clone(),
            colors
                .into_iter()
                .map(|(name, color)| (name, color.to_string()))
                .collect(),
        );
        let paths = std::iter::once(std::path::PathBuf::from(&level.path)).chain(
            level
                .directories
                .iter()
                .map(|name| Path::new(&level.path).join(name)),
        );
        for path in paths {
            if roots.insert(path.clone()) {
                if let Some(summary) = repository_summary_cached(&path, snapshots) {
                    result.repositories.push(summary);
                }
            }
        }
    }
    result
}

#[tauri::command]
pub async fn git_tree_status(levels: Vec<GitTreeLevel>) -> Result<GitTreeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tree_status_blocking(levels, &mut TreeSnapshots::new(true))
    })
    .await
    .map_err(|error| error.to_string())
}

/// Crate-visible so sibling modules (commit-message generation) resolve
/// "any path inside a repository" through the same entry as the commands.
pub(crate) fn open_repo(path: &str) -> Result<Repository, String> {
    Repository::discover(path).map_err(map_open_repo_error)
}

/// libgit2 打开仓库失败的分类。
///
/// 旧实现把**所有**错误都报成 `NOT_A_REPO`：Windows 上常见的「所有权不受
/// 信任」（仓库由其它用户/管理员创建）、路径过长、仓库损坏、无权限等，
/// 在界面上全部被误报成「不是 Git 仓库」，用户无法判断真正原因。
/// 这里按错误类型分流：确实不是仓库才给 `NOT_A_REPO`（前端据此显示空态），
/// 其余错误保留可操作的具体信息。
fn map_open_repo_error(error: git2::Error) -> String {
    if error.code() == git2::ErrorCode::NotFound {
        return "NOT_A_REPO".to_string();
    }
    let message = error.message().trim().to_string();
    // libgit2 的属主校验以 GIT_EOWNER 失败（git2 的 `ErrorCode::Owner`）；
    // 提示语只作兜底，措辞变了也不会退回成通用失败。
    if error.code() == git2::ErrorCode::Owner
        || message.to_lowercase().contains("not owned by current user")
    {
        return format!("GIT_UNSAFE_REPO:{message}");
    }
    format!("GIT_OPEN_FAILED:{message}")
}

fn status_label(status: git2::Status) -> &'static str {
    if status.contains(git2::Status::WT_DELETED) || status.contains(git2::Status::INDEX_DELETED) {
        "deleted"
    } else if status.contains(git2::Status::WT_RENAMED)
        || status.contains(git2::Status::INDEX_RENAMED)
    {
        "renamed"
    } else if status.contains(git2::Status::WT_NEW) || status.contains(git2::Status::INDEX_NEW) {
        "added"
    } else if status.contains(git2::Status::WT_TYPECHANGE)
        || status.contains(git2::Status::INDEX_TYPECHANGE)
    {
        "typechange"
    } else {
        "modified"
    }
}

/// Aggregate per-file (+additions, -deletions) from one diff. Binary deltas
/// emit no line callbacks, so they stay at the (0, 0) seeded by the delta cb.
fn diff_line_counts(diff: &mut git2::Diff) -> HashMap<String, (usize, usize)> {
    use std::cell::RefCell;
    let counts = RefCell::new(HashMap::<String, (usize, usize)>::new());
    let file = RefCell::new(String::new());
    if let Err(e) = diff.foreach(
        &mut |delta, _| {
            let path = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            counts.borrow_mut().entry(path.clone()).or_insert((0, 0));
            *file.borrow_mut() = path;
            true
        },
        None,
        None,
        Some(&mut |_, _, line| {
            let mut counts = counts.borrow_mut();
            let Some(entry) = counts.get_mut(file.borrow().as_str()) else {
                return true;
            };
            match line.origin() {
                '+' => entry.0 += 1,
                '-' => entry.1 += 1,
                _ => {}
            }
            true
        }),
    ) {
        eprintln!("[git] diff line-count walk failed: {e}");
    }
    counts.into_inner()
}

const MAX_UNTRACKED_BYTES: usize = 1024 * 1024;
const MAX_UNTRACKED_LINES: usize = 100_000;

/// Exact (+lines, 0) for regular untracked text within 1 MiB and 100k lines.
/// Unsupported files and exceeded budgets leave the optional stats unknown.
fn count_untracked_lines(repo: &Repository, file: &str) -> Option<(usize, usize)> {
    let full = repo.workdir()?.join(file);
    let metadata = std::fs::symlink_metadata(&full).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_UNTRACKED_BYTES as u64 {
        return None;
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
    }
    let reader = options.open(full).ok()?;
    let metadata = reader.metadata().ok()?;
    if !metadata.is_file() || metadata.len() > MAX_UNTRACKED_BYTES as u64 {
        return None;
    }
    count_untracked_reader(reader)
}

fn count_untracked_reader(mut reader: impl std::io::Read) -> Option<(usize, usize)> {
    let mut bytes_read = 0usize;
    let mut lines = 0usize;
    let mut last_byte: Option<u8> = None;
    let mut chunk = [0u8; 16 * 1024];
    loop {
        let read_limit = chunk.len().min(MAX_UNTRACKED_BYTES + 1 - bytes_read);
        match reader.read(&mut chunk[..read_limit]) {
            Ok(0) => break,
            Ok(n) => {
                bytes_read += n;
                if bytes_read > MAX_UNTRACKED_BYTES || chunk[..n].contains(&0) {
                    return None;
                }
                lines += chunk[..n].iter().filter(|b| **b == b'\n').count();
                last_byte = Some(chunk[n - 1]);
                if lines > MAX_UNTRACKED_LINES {
                    return None;
                }
            }
            Err(_) => return None,
        }
    }
    if last_byte.is_some_and(|b| b != b'\n') {
        lines += 1;
    }
    (lines <= MAX_UNTRACKED_LINES).then_some((lines, 0))
}

/// libgit2 `GIT_INDEX_ENTRY_SKIP_WORKTREE` (1 << 14): the entry is tracked
/// but intentionally absent from the working tree (sparse checkout). The
/// git2 bindings do not expose the constant; status filtering and worktree
/// creation both need it.
pub(crate) const INDEX_ENTRY_SKIP_WORKTREE: u16 = 1 << 14;

/// True when the index marks `path` skip-worktree: tracked but intentionally
/// absent from the working tree (sparse checkout), so never a user change.
fn is_skip_worktree(index: Option<&git2::Index>, path: &str) -> bool {
    index
        .and_then(|index| index.get_path(Path::new(path), 0))
        .is_some_and(|entry| entry.flags_extended & INDEX_ENTRY_SKIP_WORKTREE != 0)
}

/// Bucket status entries into staged/unstaged/untracked file lists.
fn collect_status_entries(
    index: &git2::Index,
    statuses: &git2::Statuses,
) -> (Vec<GitFileEntry>, Vec<GitFileEntry>, Vec<GitFileEntry>) {
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();
    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        if path.is_empty() {
            continue;
        }
        let status = entry.status();
        // Sparse checkouts keep unmaterialized paths in the index with the
        // skip-worktree bit set. libgit2's status walk ignores the bit and
        // reports those paths as worktree-deleted; they are not user edits,
        // so the worktree-side buckets must drop them.
        let skip_worktree = status.intersects(
            git2::Status::WT_MODIFIED
                | git2::Status::WT_DELETED
                | git2::Status::WT_TYPECHANGE
                | git2::Status::WT_RENAMED,
        ) && is_skip_worktree(Some(index), &path);
        if status.contains(git2::Status::WT_NEW) && !status.intersects(git2::Status::INDEX_NEW) {
            untracked.push(GitFileEntry {
                path,
                status: "added".to_string(),
                additions: None,
                deletions: None,
            });
            continue;
        }
        if status.intersects(
            git2::Status::INDEX_NEW
                | git2::Status::INDEX_MODIFIED
                | git2::Status::INDEX_DELETED
                | git2::Status::INDEX_RENAMED
                | git2::Status::INDEX_TYPECHANGE,
        ) {
            staged.push(GitFileEntry {
                path: path.clone(),
                status: status_label(status).to_string(),
                additions: None,
                deletions: None,
            });
        }
        if !skip_worktree
            && status.intersects(
                git2::Status::WT_MODIFIED
                    | git2::Status::WT_DELETED
                    | git2::Status::WT_TYPECHANGE
                    | git2::Status::WT_RENAMED,
            )
        {
            unstaged.push(GitFileEntry {
                path,
                status: status_label(status).to_string(),
                additions: None,
                deletions: None,
            });
        }
    }
    (staged, unstaged, untracked)
}

/// Fill per-file (+/-) stats from one staged + one unstaged diff, and line
/// counts for untracked files straight off disk.
fn fill_line_stats(
    repo: &Repository,
    staged: &mut [GitFileEntry],
    unstaged: &mut [GitFileEntry],
    untracked: &mut [GitFileEntry],
) {
    let head_tree = repo.head().and_then(|h| h.peel_to_tree()).ok();
    let staged_counts = repo
        .diff_tree_to_index(head_tree.as_ref(), None, None)
        .map(|mut d| diff_line_counts(&mut d))
        .unwrap_or_default();
    let unstaged_counts = repo
        .diff_index_to_workdir(None, None)
        .map(|mut d| diff_line_counts(&mut d))
        .unwrap_or_default();
    for entry in staged.iter_mut() {
        if let Some(&(a, d)) = staged_counts.get(&entry.path) {
            entry.additions = Some(a);
            entry.deletions = Some(d);
        }
    }
    for entry in unstaged.iter_mut() {
        if let Some(&(a, d)) = unstaged_counts.get(&entry.path) {
            entry.additions = Some(a);
            entry.deletions = Some(d);
        }
    }
    for entry in untracked.iter_mut() {
        if let Some((a, d)) = count_untracked_lines(repo, &entry.path) {
            entry.additions = Some(a);
            entry.deletions = Some(d);
        }
    }
}

/// Ahead/behind counts vs the branch's upstream. Cheap: two ref lookups plus
/// one commit-graph walk. Returns `None` when there is no upstream to compare
/// against — the UI hides the indicator rather than showing a misleading 0/0.
fn ahead_behind(repo: &Repository) -> Option<(usize, usize)> {
    let head = repo.head().ok()?;
    let local_oid = head.target()?;
    let upstream_name = repo.branch_upstream_name(head.name()?).ok()?;
    let upstream_ref = repo.find_reference(upstream_name.as_str()?).ok()?;
    let upstream_oid = upstream_ref.target()?;
    repo.graph_ahead_behind(local_oid, upstream_oid).ok()
}

/// Branch label for the status header. An unborn HEAD (fresh `git init`, no
/// commit yet) fails `repo.head()` but still points at its branch
/// symbolically — show that name rather than a bare "HEAD".
fn head_branch_label(repo: &Repository) -> String {
    if let Some(name) = repo.head().ok().and_then(|h| h.shorthand().map(str::to_string)) {
        return name;
    }
    repo.find_reference("HEAD")
        .ok()
        .and_then(|head| {
            head.symbolic_target()
                .and_then(|target| target.strip_prefix("refs/heads/"))
                .map(str::to_string)
        })
        .unwrap_or_else(|| "HEAD".to_string())
}

/// Sync body of `git_status` — libgit2 walks can touch thousands of files,
/// far too heavy for the IPC main thread.
fn git_status_blocking(path: &str) -> Result<GitStatus, String> {
    let repo = open_repo(path)?;
    let branch = head_branch_label(&repo);
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let index = repo.index().map_err(|e| e.to_string())?;
    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
    let (mut staged, mut unstaged, mut untracked) = collect_status_entries(&index, &statuses);
    fill_line_stats(&repo, &mut staged, &mut unstaged, &mut untracked);
    let (ahead, behind) = ahead_behind(&repo).unzip();
    Ok(GitStatus {
        branch,
        staged,
        unstaged,
        untracked,
        ahead,
        behind,
    })
}

#[tauri::command]
pub async fn git_status(path: String) -> Result<GitStatus, String> {
    tauri::async_runtime::spawn_blocking(move || git_status_blocking(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Hard cap on the patch text handed to the frontend — with untracked content
/// included, an arbitrarily large new file (build artifact, log) would
/// otherwise be expanded into a full-content patch crossing IPC, while the
/// frontend only ever renders the first DIFF_TRUNCATE_LINES lines.
const MAX_DIFF_PATCH_BYTES: usize = 2 * 1024 * 1024;
/// Appended when MAX_DIFF_PATCH_BYTES cuts the patch short, so the preview
/// shows an explicit boundary instead of silently ending mid-file.
const DIFF_TRUNCATED_MARKER: &str = "[... diff truncated: file too large to preview ...]\n";

/// Sync body of `git_diff` — with untracked content included, a large new
/// file turns into a full-content patch; far too heavy for the IPC main
/// thread, same rationale as `git_status_blocking`.
fn git_diff_blocking(path: &str, file: &str, staged: bool) -> Result<String, String> {
    let repo = open_repo(path)?;
    let mut opts = git2::DiffOptions::new();
    opts.pathspec(file);
    if !staged {
        // Worktree diffs exclude untracked files by default. Include their
        // content so a newly created file produces a real patch for preview.
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true);
    }
    let diff = if staged {
        let head_tree = repo.head().and_then(|h| h.peel_to_tree()).ok();
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))
    }
    .map_err(|e| e.to_string())?;
    let mut text = String::new();
    let mut truncated = false;
    let print_result = diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let content = line.content();
        if text.len() + content.len() + 1 > MAX_DIFF_PATCH_BYTES {
            truncated = true;
            return false;
        }
        let origin = line.origin();
        if origin == '+' || origin == '-' || origin == ' ' {
            text.push(origin);
        }
        text.push_str(std::str::from_utf8(content).unwrap_or(""));
        true
    });
    match print_result {
        Ok(()) => {}
        // Our own truncation stop: git2 maps a `false` callback to GIT_EUSER.
        Err(e) if truncated && e.code() == git2::ErrorCode::User => {}
        Err(e) => return Err(e.to_string()),
    }
    if truncated {
        if !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(DIFF_TRUNCATED_MARKER);
    }
    Ok(text)
}

#[tauri::command]
pub async fn git_diff(path: String, file: String, staged: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_diff_blocking(&path, &file, staged))
        .await
        .map_err(|e| e.to_string())?
}

/// Index and ref writers used to queue on the IPC main thread. Off it, two
/// clicks in the changes panel (stage while an unstage is in flight) overlap,
/// and libgit2 fails the loser with "the index is locked". One gate per
/// repository path queues them instead; separate worktrees keep separate
/// gates because each has its own index.
fn repo_write_gate(path: &str) -> std::sync::Arc<parking_lot::Mutex<()>> {
    static GATES: std::sync::OnceLock<
        parking_lot::Mutex<HashMap<std::path::PathBuf, std::sync::Arc<parking_lot::Mutex<()>>>>,
    > = std::sync::OnceLock::new();
    let key = std::fs::canonicalize(path).unwrap_or_else(|_| std::path::PathBuf::from(path));
    let mut gates = GATES.get_or_init(Default::default).lock();
    std::sync::Arc::clone(gates.entry(key).or_default())
}

fn git_stage_blocking(path: &str, files: &[String]) -> Result<(), String> {
    let gate = repo_write_gate(path);
    let _queued = gate.lock();
    let repo = open_repo(path)?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    for file in files {
        let file_path = std::path::Path::new(file);
        if repo
            .workdir()
            .map(|w| w.join(file_path))
            .map(|p| p.exists())
            .unwrap_or(false)
        {
            index.add_path(file_path).map_err(|e| e.to_string())?;
        } else {
            index.remove_path(file_path).map_err(|e| e.to_string())?;
        }
    }
    index.write().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_stage(path: String, files: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_stage_blocking(&path, &files))
        .await
        .map_err(|e| e.to_string())?
}

fn git_unstage_blocking(path: &str, files: &[String]) -> Result<(), String> {
    let gate = repo_write_gate(path);
    let _queued = gate.lock();
    let repo = open_repo(path)?;
    let head = repo.head().and_then(|h| h.peel_to_commit());
    let mut index = repo.index().map_err(|e| e.to_string())?;
    match head {
        Ok(commit) => {
            let tree = commit.tree().map_err(|e| e.to_string())?;
            for file in files {
                let file_path = std::path::Path::new(file);
                match tree.get_path(file_path) {
                    Ok(entry) => {
                        index
                            .add(&git2::IndexEntry {
                                ctime: git2::IndexTime::new(0, 0),
                                mtime: git2::IndexTime::new(0, 0),
                                dev: 0,
                                ino: 0,
                                mode: entry.filemode() as u32,
                                uid: 0,
                                gid: 0,
                                file_size: 0,
                                id: entry.id(),
                                flags: 0,
                                flags_extended: 0,
                                path: file.as_bytes().to_vec(),
                            })
                            .map_err(|e| e.to_string())?;
                    }
                    Err(_) => {
                        // Not in HEAD: staged-new file -> remove from index.
                        let _ = index.remove_path(file_path);
                    }
                }
            }
        }
        Err(_) => {
            // No HEAD yet: clearing the index for these files un-stages them.
            for file in files {
                let _ = index.remove_path(std::path::Path::new(file));
            }
        }
    }
    index.write().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_unstage(path: String, files: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_unstage_blocking(&path, &files))
        .await
        .map_err(|e| e.to_string())?
}

/// Discard worktree changes (the panel's 撤销更改), matching
/// `git restore --worktree` + `git clean -f`: a path present in the index
/// restores from the index — so hunks already staged survive — while an
/// untracked path is deleted from disk. Staged deletions (in HEAD, removed
/// from the index) are not offered discard in the UI; here they are a no-op.
pub(crate) fn git_discard_blocking(path: &str, files: &[String]) -> Result<(), String> {
    let gate = repo_write_gate(path);
    let _queued = gate.lock();
    let repo = open_repo(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| "bare repository".to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    for file in files {
        let file_path = Path::new(file);
        if index.get_path(file_path, 0).is_some() {
            let mut checkout = git2::build::CheckoutBuilder::new();
            checkout.path(file).force();
            repo.checkout_index(Some(&mut index), Some(&mut checkout))
                .map_err(|e| e.to_string())?;
        } else {
            let abs = workdir.join(file_path);
            if abs.is_dir() {
                std::fs::remove_dir_all(&abs).map_err(|e| e.to_string())?;
            } else if abs.exists() {
                std::fs::remove_file(&abs).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn git_discard(path: String, files: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_discard_blocking(&path, &files))
        .await
        .map_err(|e| e.to_string())?
}

fn git_commit_blocking(path: &str, message: &str) -> Result<String, String> {
    let gate = repo_write_gate(path);
    let _queued = gate.lock();
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("empty commit message".to_string());
    }
    let repo = open_repo(path)?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;
    let sig = repo
        .signature()
        .map_err(|e| format!("git identity not configured (user.name/user.email): {e}"))?;
    let parent = repo.head().and_then(|h| h.peel_to_commit()).ok();
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, trimmed, &tree, &parents)
        .map_err(|e| e.to_string())?;
    Ok(oid.to_string())
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_commit_blocking(&path, &message))
        .await
        .map_err(|e| e.to_string())?
}
/// Push/pull run over the network; credential failures should read as
/// actionable guidance, not a libgit2 error dump.
fn map_remote_error(e: git2::Error) -> String {
    let message = e.message().to_string();
    let lower = message.to_lowercase();
    if e.code() == git2::ErrorCode::Auth
        || lower.contains("auth")
        || lower.contains("permission denied")
        || lower.contains("publickey")
        || lower.contains("credentials")
    {
        return format!(
            "git authentication failed: check your credentials / SSH key configuration ({message})"
        );
    }
    message
}
/// Credentials for network remotes, resolved the way the git CLI resolves
/// them: gitconfig credential helpers first (HTTPS: osxkeychain / manager /
/// store…), then ssh-agent. Without this callback libgit2 fails every
/// auth-required remote with "remote authentication required but no callback
/// set".
fn remote_callbacks(config: git2::Config) -> git2::RemoteCallbacks<'static> {
    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(move |url, username_from_url, allowed| {
        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            if let Ok(cred) = git2::Cred::credential_helper(&config, url, username_from_url) {
                return Ok(cred);
            }
        }
        if allowed.contains(git2::CredentialType::SSH_KEY) {
            let username = username_from_url.unwrap_or("git");
            if let Ok(cred) = git2::Cred::ssh_key_from_agent(username) {
                return Ok(cred);
            }
        }
        // Do not fall back to Cred::default(): its DEFAULT credtype never
        // intersects the allowed set, git2-rs maps that to GIT_PASSTHROUGH,
        // and libgit2 then reports the misleading "authentication required
        // but no callback set". Fail with an actionable message instead.
        Err(git2::Error::from_str(&format!(
            "no usable credentials for {url}: configure a git credential helper (HTTPS) or add your key to ssh-agent (SSH)"
        )))
    });
    callbacks
}

/// Config used to resolve remote credentials. libgit2 only reads
/// `/etc/gitconfig` as the system config, but Apple git (Command Line Tools)
/// keeps its system config — including `credential.helper osxkeychain` —
/// under the CLT directory. Append it at system level so credential helper
/// discovery matches the git CLI; without it HTTPS push/pull on a stock
/// macOS machine finds no helper and fails authentication.
fn remote_config(repo: &Repository) -> Result<git2::Config, String> {
    let mut config = repo.config().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        const APPLE_SYSTEM_CONFIG: &str =
            "/Library/Developer/CommandLineTools/usr/share/git-core/gitconfig";
        let path = Path::new(APPLE_SYSTEM_CONFIG);
        // The System level slot is taken once /etc/gitconfig exists; only
        // fill it from Apple's file when libgit2 found no system config.
        if path.exists() && !Path::new("/etc/gitconfig").exists() {
            config
                .add_file(path, git2::ConfigLevel::System, false)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(config)
}

/// Return the canonical `.git`-suffixed form of an http(s) remote URL.
///
/// GitLab and Gitea serve a `.git`-less `<host>/<owner>/<repo>` http URL with a
/// 301 to the `.git` path. The git CLI follows that transparently, but libgit2
/// (1.9.x) does not: it re-requests the original URL until GIT_HTTP_REPLAY_MAX
/// and then fails with "too many redirects or authentication replays" — before
/// any credential callback runs. Spelled with `.git` there is no redirect and
/// the request authenticates normally. Returns `None` for anything already
/// canonical, non-http(s), or ambiguous (trailing slash, query, fragment).
fn add_dot_git(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return None;
    }
    // Only a bare path is safe to rewrite; a query or fragment means this is
    // not a plain repository URL.
    if rest.contains('?') || rest.contains('#') {
        return None;
    }
    // Split the authority from the path at the first '/'. The GitLab/Gitea
    // repository path is `<owner>/<repo>` (nested groups add more segments),
    // so the path must contain a slash; a bare `<host>/<repo>` is ambiguous.
    let (authority, path) = rest.trim_end_matches('/').split_once('/')?;
    if authority.is_empty() || !path.contains('/') || path.ends_with(".git") {
        return None;
    }
    Some(format!("{scheme}://{authority}/{path}.git"))
}

/// Temporarily rewrites the `origin` remote's http(s) URL(s) to their canonical
/// `.git` form for the duration of one network operation, restoring the
/// originals on drop. See [`add_dot_git`] for why. Scoped to a single
/// fetch/push so a pull or push that fails mid-way still leaves the user's
/// config untouched.
struct CanonicalRemoteUrl {
    /// `<repo>/.git/config`, reopened on drop because `git2::Config` is not
    /// `Clone` and the fetch path consumes its own config handle.
    config_path: std::path::PathBuf,
    /// `(key, original value)` pairs to put back verbatim.
    saved: Vec<(String, String)>,
}

impl CanonicalRemoteUrl {
    fn new(repo: &Repository) -> Result<Self, String> {
        let mut config = repo.config().map_err(|e| e.to_string())?;
        let mut saved = Vec::new();
        for key in ["remote.origin.url", "remote.origin.pushurl"] {
            let Ok(original) = config.get_string(key) else {
                continue;
            };
            let Some(fixed) = add_dot_git(&original) else {
                continue;
            };
            if config.set_str(key, &fixed).is_ok() {
                saved.push((key.to_string(), original));
            }
        }
        Ok(Self {
            config_path: repo.path().join("config"),
            saved,
        })
    }
}

impl Drop for CanonicalRemoteUrl {
    fn drop(&mut self) {
        if self.saved.is_empty() {
            return;
        }
        let Ok(mut config) = git2::Config::open(&self.config_path) else {
            return;
        };
        for (key, original) in &self.saved {
            let _ = config.set_str(key, original);
        }
    }
}

fn push_options(config: git2::Config) -> git2::PushOptions<'static> {
    let mut opts = git2::PushOptions::new();
    opts.remote_callbacks(remote_callbacks(config));
    opts
}

fn fetch_options(config: git2::Config) -> git2::FetchOptions<'static> {
    let mut opts = git2::FetchOptions::new();
    opts.remote_callbacks(remote_callbacks(config));
    opts
}

#[tauri::command]
pub async fn git_push(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = open_repo(&path)?;
        let branch = current_branch_name(&repo)?;
        // Rewrite a `.git`-less http remote to its canonical form before the
        // remote handle caches the URL; the guard restores it on drop.
        let _canonical = CanonicalRemoteUrl::new(&repo)?;
        let mut remote = repo
            .find_remote("origin")
            .map_err(|e| format!("no origin remote: {e}"))?;
        let config = remote_config(&repo)?;
        let mut opts = push_options(config);
        remote
            .push(
                &[format!("refs/heads/{branch}:refs/heads/{branch}")],
                Some(&mut opts),
            )
            .map_err(map_remote_error)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Files the fast-forward would touch that also carry local modifications —
/// the conflict list for a safe (non-force) checkout failure.
fn ff_conflicting_files(repo: &Repository, target: git2::Oid) -> Vec<String> {
    let Ok(head_tree) = repo.head().and_then(|h| h.peel_to_tree()) else {
        return Vec::new();
    };
    let Ok(target_commit) = repo.find_commit(target) else {
        return Vec::new();
    };
    let Ok(target_tree) = target_commit.tree() else {
        return Vec::new();
    };
    let Ok(touched) = repo.diff_tree_to_tree(Some(&head_tree), Some(&target_tree), None) else {
        return Vec::new();
    };
    let mut touched_paths = std::collections::HashSet::new();
    let _ = touched.foreach(
        &mut |delta, _| {
            for p in [delta.old_file().path(), delta.new_file().path()]
                .into_iter()
                .flatten()
            {
                touched_paths.insert(p.to_string_lossy().into_owned());
            }
            true
        },
        None,
        None,
        None,
    );
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let Ok(statuses) = repo.statuses(Some(&mut opts)) else {
        return Vec::new();
    };
    statuses
        .iter()
        .filter_map(|s| s.path().map(str::to_string))
        .filter(|p| touched_paths.contains(p))
        .collect()
}

/// Sync body of `git_pull` (network fetch + merge analysis).
fn git_pull_blocking(path: &str) -> Result<(), String> {
    let repo = open_repo(path)?;
    let branch = current_branch_name(&repo)?;
    // See git_push: normalize a `.git`-less http remote before find_remote
    // caches the URL; the guard restores the original on drop.
    let _canonical = CanonicalRemoteUrl::new(&repo)?;
    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("no origin remote: {e}"))?;
    let config = remote_config(&repo)?;
    let mut opts = fetch_options(config);
    remote
        .fetch(std::slice::from_ref(&branch), Some(&mut opts), None)
        .map_err(map_remote_error)?;
    let fetch_head = repo
        .find_reference("FETCH_HEAD")
        .map_err(|e| e.to_string())?;
    let fetch_commit = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(|e| e.to_string())?;
    let (analysis, _) = repo
        .merge_analysis(&[&fetch_commit])
        .map_err(|e| e.to_string())?;
    if analysis.is_up_to_date() {
        return Ok(());
    }
    if analysis.is_fast_forward() {
        let refname = format!("refs/heads/{branch}");
        let mut reference = repo.find_reference(&refname).map_err(|e| e.to_string())?;
        // Safe checkout (no force): a fast-forward must never clobber
        // uncommitted local edits — report the conflicting files instead.
        // Keep HEAD at the old tree until checkout succeeds, otherwise local
        // edits are compared against the new commit and the index is stranded.
        let target = repo
            .find_commit(fetch_commit.id())
            .map_err(|e| e.to_string())?;
        let mut checkout = git2::build::CheckoutBuilder::new();
        checkout.safe();
        if let Err(e) = repo.checkout_tree(target.as_object(), Some(&mut checkout)) {
            let conflicts = ff_conflicting_files(&repo, fetch_commit.id());
            return Err(if conflicts.is_empty() {
                format!("fast-forward checkout failed: {e}")
            } else {
                format!(
                    "pull would overwrite uncommitted changes in: {}",
                    conflicts.join(", ")
                )
            });
        }
        reference
            .set_target(fetch_commit.id(), "fast-forward")
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err("pull requires a merge; not supported in v1".to_string())
}

#[tauri::command]
pub async fn git_pull(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_pull_blocking(&path))
        .await
        .map_err(|e| e.to_string())?
}

fn current_branch_name(repo: &Repository) -> Result<String, String> {
    repo.head()
        .ok()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand().map(str::to_string))
        .ok_or_else(|| "detached HEAD".to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    /// Remote-tracking branch (`origin/<name>`). Checkout materializes the
    /// local tracking branch instead of detaching HEAD.
    pub is_remote: bool,
}

pub(crate) fn git_branches_blocking(path: &str) -> Result<Vec<BranchInfo>, String> {
    let repo = open_repo(path)?;
    // No is_current flag: consumers compare against the live status branch —
    // a cached flag here goes stale on external (CLI) checkouts.
    let mut out = Vec::new();
    // Locals first, then remote-tracking branches. A branch that only exists
    // on the remote (e.g. right after a fetch) must still be listed: hiding
    // it made the picker unable to find what the CLI/VSCode can see.
    for branch_type in [git2::BranchType::Local, git2::BranchType::Remote] {
        let branches = repo
            .branches(Some(branch_type))
            .map_err(|e| e.to_string())?;
        for branch in branches.flatten() {
            let (b, _) = branch;
            // `refs/remotes/origin/HEAD` is a symbolic alias for the remote
            // default branch, not a checkout target; listing it would offer a
            // dead row (`git_branch_set_upstream` on a phantom `HEAD` too).
            if b.get().target().is_none() {
                continue;
            }
            if let Ok(Some(name)) = b.name() {
                out.push(BranchInfo {
                    name: name.to_string(),
                    is_remote: branch_type == git2::BranchType::Remote,
                });
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn git_branches(path: String) -> Result<Vec<BranchInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || git_branches_blocking(&path))
        .await
        .map_err(|e| e.to_string())?
}
/// Local branch name git creates for `origin/release/1.0`: the remote name
/// (the longest configured one that prefix-matches — remote names may contain
/// slashes) is stripped, the rest is the local name.
fn local_name_for_remote_branch(repo: &Repository, remote_shorthand: &str) -> Option<String> {
    let remotes = repo.remotes().ok()?;
    let remote = remotes
        .iter()
        .flatten()
        .filter(|name| {
            remote_shorthand.starts_with(*name)
                && remote_shorthand.as_bytes().get(name.len()) == Some(&b'/')
        })
        .max_by_key(|name| name.len())?;
    Some(remote_shorthand[remote.len() + 1..].to_string())
}

/// `git checkout <remote>/<branch>` semantics: switch to the local branch of
/// the same short name — creating it, tracking the remote, when absent. An
/// existing local branch wins untouched: it may hold local commits, so the
/// remote tip must never be forced onto it.
fn checkout_remote_branch(
    repo: &Repository,
    remote_shorthand: &str,
    remote: &git2::Branch<'_>,
) -> Result<(), String> {
    // Symbolic refs (origin/HEAD) have no target of their own and no local
    // branch to materialize.
    if remote.get().target().is_none() {
        return Err(format!("{remote_shorthand} is not a branch"));
    }
    let target = remote
        .get()
        .peel_to_commit()
        .map_err(|e| e.to_string())?;
    let local_name = local_name_for_remote_branch(repo, remote_shorthand)
        .ok_or_else(|| format!("no remote matches {remote_shorthand}"))?;
    let (mut local, created) = match repo.find_branch(&local_name, git2::BranchType::Local) {
        Ok(existing) => (existing, false),
        Err(_) => (
            repo.branch(&local_name, &target, false)
                .map_err(|e| e.to_string())?,
            true,
        ),
    };
    // Check out the branch actually being switched to: for an existing local
    // branch that is its own tip, not the remote's — the remote tip may lack
    // local commits, and checking it out would leave the worktree inconsistent
    // with HEAD.
    let checkout_commit = local.get().peel_to_commit().map_err(|e| e.to_string())?;
    if let Err(e) = repo.checkout_tree(checkout_commit.as_object(), None) {
        // The checkout failed (e.g. uncommitted edits in the way) and HEAD
        // stays put: drop the just-created branch instead of stranding it.
        if created {
            let _ = local.delete();
        }
        return Err(e.to_string());
    }
    if created {
        // Track only after a successful checkout: nothing to clean out of the
        // config when the branch above was deleted.
        local
            .set_upstream(Some(remote_shorthand))
            .map_err(|e| e.to_string())?;
    }
    repo.set_head(&format!("refs/heads/{local_name}"))
        .map_err(|e| e.to_string())
}

pub(crate) fn git_checkout_blocking(path: &str, branch: &str) -> Result<(), String> {
    let gate = repo_write_gate(path);
    let _queued = gate.lock();
    let repo = open_repo(path)?;
    // A remote-tracking branch never receives HEAD directly (that would
    // detach it): it is materialized as a local tracking branch instead.
    // A same-named local branch wins, matching `git checkout` resolution.
    if repo.find_branch(branch, git2::BranchType::Local).is_err() {
        if let Ok(remote) = repo.find_branch(branch, git2::BranchType::Remote) {
            return checkout_remote_branch(&repo, branch, &remote);
        }
    }
    let (object, reference) = repo
        .revparse_ext(branch)
        .map_err(|e| format!("unknown branch {branch}: {e}"))?;
    repo.checkout_tree(&object, None)
        .map_err(|e| e.to_string())?;
    match reference {
        Some(r) => repo
            .set_head(r.name().ok_or("invalid ref name")?)
            .map_err(|e| e.to_string()),
        None => repo
            .set_head_detached(object.id())
            .map_err(|e| e.to_string()),
    }
}

/// `git init` for a workspace the changes panel reported as NOT_A_REPO. The
/// initial branch follows the user's `init.defaultBranch`, like the CLI.
/// Unlike the other git commands this creates a repository where none
/// exists, so it keeps to the registered workspaces like the file tree's
/// create commands — the remote bridge routes here too.
#[tauri::command]
pub fn git_init(
    db: tauri::State<'_, std::sync::Arc<crate::db::Db>>,
    path: String,
) -> Result<(), String> {
    crate::files::ensure_allowed(&path, &db)?;
    init_repository(&path)
}

fn init_repository(path: &str) -> Result<(), String> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    match Repository::discover(dir) {
        // The panel's NOT_A_REPO can be stale (`git init` ran in a terminal
        // meanwhile); a nested repository would hide the outer one's changes.
        Ok(_) => return Ok(()),
        // Anything but "none found" — e.g. libgit2's ownership check on a
        // repository cloned by another account — may hide one above us.
        Err(e) if e.code() != git2::ErrorCode::NotFound => return Err(e.message().to_string()),
        Err(_) => {}
    }
    let mut opts = git2::RepositoryInitOptions::new();
    opts.mkdir(false).mkpath(false).no_reinit(true);
    Repository::init_opts(dir, &opts)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_checkout(path: String, branch: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_checkout_blocking(&path, &branch))
        .await
        .map_err(|e| e.to_string())?
}

fn git_create_branch_blocking(path: &str, name: &str) -> Result<(), String> {
    let gate = repo_write_gate(path);
    let _queued = gate.lock();
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("empty branch name".to_string());
    }
    let repo = open_repo(path)?;
    let head = repo
        .head()
        .and_then(|h| h.peel_to_commit())
        .map_err(|e| e.to_string())?;
    let branch = repo
        .branch(trimmed, &head, false)
        .map_err(|e| e.to_string())?;
    let refname = format!(
        "refs/heads/{}",
        branch.name().map_err(|e| e.to_string())?.unwrap_or(trimmed)
    );
    let object = head.as_object().clone();
    repo.checkout_tree(&object, None)
        .map_err(|e| e.to_string())?;
    repo.set_head(&refname).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_create_branch(path: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || git_create_branch_blocking(&path, &name))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("ccgui-next-git-summary-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn add_dot_git_canonicalizes_bare_http_paths() {
        assert_eq!(
            add_dot_git("http://host:8000/owner/repo").as_deref(),
            Some("http://host:8000/owner/repo.git")
        );
        assert_eq!(
            add_dot_git("https://host/owner/repo/").as_deref(),
            Some("https://host/owner/repo.git")
        );
    }

    #[test]
    fn add_dot_git_leaves_other_urls_untouched() {
        // Already canonical, non-http, scp-like, or not a repo path.
        for url in [
            "http://host/owner/repo.git",
            "git@host:owner/repo.git",
            "ssh://host/owner/repo",
            "http://host/repo",
            "http://host/owner/repo?x=1",
            "http://host/owner/repo#frag",
        ] {
            assert_eq!(add_dot_git(url), None, "should not rewrite {url}");
        }
    }

    #[test]
    fn canonical_remote_url_rewrites_and_restores() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        repo.remote("origin", "http://host:8000/owner/repo").unwrap();

        {
            let _guard = CanonicalRemoteUrl::new(&repo).unwrap();
            // The handle must observe the canonicalized URL for the fetch/push.
            let remote = repo.find_remote("origin").unwrap();
            assert_eq!(remote.url(), Some("http://host:8000/owner/repo.git"));
        } // guard drops here

        // Drop restores the user's configured URL verbatim.
        let remote = repo.find_remote("origin").unwrap();
        assert_eq!(remote.url(), Some("http://host:8000/owner/repo"));
    }

    #[test]
    fn workspace_owners_resolve_github_origin_from_repo_subdirs() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        repo.remote("origin", "git@github.com:owner/repo.git").unwrap();
        let subdir = scratch.0.join("src");
        std::fs::create_dir_all(&subdir).unwrap();
        let path = subdir.to_string_lossy().into_owned();

        let owners = workspace_owners_blocking(vec![path.clone()]);

        assert_eq!(owners, vec![WorkspaceOwner { path, login: "owner".to_string() }]);
    }

    #[test]
    fn workspace_owners_skip_non_github_and_non_repo_paths() {
        let scratch = Scratch::new();
        let gitlab = scratch.0.join("gitlab");
        let plain = scratch.0.join("plain");
        std::fs::create_dir_all(&gitlab).unwrap();
        std::fs::create_dir_all(&plain).unwrap();
        let repo = Repository::init(&gitlab).unwrap();
        repo.remote("origin", "https://gitlab.com/owner/repo.git").unwrap();
        let no_origin = scratch.0.join("no-origin");
        Repository::init(&no_origin).unwrap();

        // No origin, non-GitHub origin, and a plain directory all stay
        // unlabeled — the sidebar keeps its folder icon for each.
        let owners = workspace_owners_blocking(vec![
            no_origin.to_string_lossy().into_owned(),
            gitlab.to_string_lossy().into_owned(),
            plain.to_string_lossy().into_owned(),
        ]);

        assert!(owners.is_empty());
    }

    #[test]
    fn untracked_line_count_rejects_over_budget_single_line() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        std::fs::write(scratch.0.join("long.txt"), vec![b'x'; 1024 * 1024 + 1]).unwrap();
        assert_eq!(count_untracked_lines(&repo, "long.txt"), None);
    }

    #[test]
    fn untracked_line_count_accepts_exact_byte_budget() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        let mut content = vec![b'x'; 1024 * 1024];
        std::fs::write(scratch.0.join("exact.txt"), &content).unwrap();
        assert_eq!(count_untracked_lines(&repo, "exact.txt"), Some((1, 0)));
        *content.last_mut().unwrap() = b'\n';
        std::fs::write(scratch.0.join("exact.txt"), content).unwrap();
        assert_eq!(count_untracked_lines(&repo, "exact.txt"), Some((1, 0)));
    }

    #[test]
    fn untracked_line_count_preserves_text_and_newline_semantics() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        for (content, expected) in [
            ("", 0),
            ("中文🙂", 1),
            ("第一行\n第二行", 2),
            ("第一行\n第二行\n", 2),
            ("\n", 1),
            ("\n\n", 2),
            ("one\r\ntwo\r\n", 2),
        ] {
            std::fs::write(scratch.0.join("text.txt"), content).unwrap();
            assert_eq!(
                count_untracked_lines(&repo, "text.txt"),
                Some((expected, 0)),
                "{content:?}"
            );
        }
    }

    #[test]
    fn untracked_line_count_rejects_binary_even_after_first_chunk() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        let mut content = vec![b'x'; 20 * 1024];
        content.push(0);
        std::fs::write(scratch.0.join("binary.dat"), content).unwrap();
        assert_eq!(count_untracked_lines(&repo, "binary.dat"), None);
    }

    #[test]
    fn untracked_line_count_does_not_report_a_truncated_line_total() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        for (content, expected) in [
            ("\n".repeat(100_000), Some((100_000, 0))),
            ("\n".repeat(100_001), None),
            (format!("{}tail", "\n".repeat(100_000)), None),
        ] {
            std::fs::write(scratch.0.join("lines.txt"), content).unwrap();
            assert_eq!(count_untracked_lines(&repo, "lines.txt"), expected);
        }
    }

    #[cfg(unix)]
    #[test]
    fn untracked_line_count_rejects_non_regular_targets() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        std::os::unix::fs::symlink("/dev/null", scratch.0.join("device")).unwrap();
        assert_eq!(count_untracked_lines(&repo, "device"), None);
        std::fs::create_dir(scratch.0.join("directory")).unwrap();
        assert_eq!(count_untracked_lines(&repo, "directory"), None);
    }

    #[test]
    fn untracked_line_count_stops_when_file_grows_during_read() {
        use std::io::{Read, Write};

        struct GrowingFile {
            reader: std::fs::File,
            writer: Option<std::fs::File>,
            bytes_read: usize,
        }

        impl Read for GrowingFile {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                let read = self.reader.read(buffer)?;
                self.bytes_read += read;
                if let Some(mut writer) = self.writer.take() {
                    writer.write_all(&vec![b'x'; 1024 * 1024])?;
                }
                Ok(read)
            }
        }

        let scratch = Scratch::new();
        let path = scratch.0.join("growing.txt");
        std::fs::write(&path, vec![b'x'; 16 * 1024]).unwrap();
        let mut reader = GrowingFile {
            reader: std::fs::File::open(&path).unwrap(),
            writer: Some(
                std::fs::OpenOptions::new()
                    .append(true)
                    .open(&path)
                    .unwrap(),
            ),
            bytes_read: 0,
        };
        assert_eq!(reader.reader.metadata().unwrap().len(), 16 * 1024);
        assert_eq!(
            count_untracked_reader(&mut reader),
            None,
            "read {} bytes",
            reader.bytes_read
        );
        assert_eq!(reader.bytes_read, 1024 * 1024 + 1);
        assert!(std::fs::metadata(path).unwrap().len() > 1024 * 1024);
    }

    #[cfg(unix)]
    #[test]
    fn untracked_line_count_rejects_fifo_without_opening_it() {
        use std::os::unix::ffi::OsStrExt;

        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        let path = std::ffi::CString::new(scratch.0.join("pipe").as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
        assert_eq!(count_untracked_lines(&repo, "pipe"), None);
    }

    #[test]
    fn untracked_line_count_leaves_optional_stats_unknown_when_skipped() {
        let scratch = Scratch::new();
        Repository::init(&scratch.0).unwrap();
        std::fs::write(scratch.0.join("large.txt"), vec![b'x'; 1024 * 1024 + 1]).unwrap();
        std::fs::write(scratch.0.join("binary.dat"), b"binary\0data").unwrap();
        std::fs::write(scratch.0.join("empty.txt"), b"").unwrap();
        let status = git_status_blocking(scratch.0.to_str().unwrap()).unwrap();
        assert_eq!(status.untracked.len(), 3);
        for entry in status.untracked {
            let expected = if entry.path == "empty.txt" {
                Some(0)
            } else {
                None
            };
            assert_eq!(entry.additions, expected, "{}", entry.path);
            assert_eq!(entry.deletions, expected, "{}", entry.path);
        }
    }

    #[test]
    fn status_ignores_skip_worktree_paths() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "sparse.txt", "index only\n");

        // Sparse checkout state: tracked in the index, marked skip-worktree,
        // absent from the working tree. Not a user edit.
        std::fs::remove_file(scratch.0.join("sparse.txt")).unwrap();
        let mut index = repo.index().unwrap();
        let mut entry = index.get_path(Path::new("sparse.txt"), 0).unwrap();
        entry.flags_extended |= INDEX_ENTRY_SKIP_WORKTREE;
        index.add(&entry).unwrap();
        index.write().unwrap();

        let status = git_status_blocking(scratch.0.to_str().unwrap()).unwrap();
        assert!(status.staged.is_empty(), "status={status:?}");
        assert!(status.unstaged.is_empty(), "status={status:?}");
        assert!(status.untracked.is_empty(), "status={status:?}");

        // The file tree's repo summary and colors share the same snapshot.
        let summary = exact_repository_summary(&scratch.0).unwrap();
        assert_eq!(summary.changed, 0);
    }

    #[test]
    fn status_still_reports_a_real_worktree_deletion() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "gone.txt", "deleted for real\n");
        std::fs::remove_file(scratch.0.join("gone.txt")).unwrap();

        let status = git_status_blocking(scratch.0.to_str().unwrap()).unwrap();
        assert_eq!(status.unstaged.len(), 1, "status={status:?}");
        assert_eq!(status.unstaged[0].path, "gone.txt");
        assert_eq!(status.unstaged[0].deletions, Some(1));
    }

    fn tree_level(path: &Path, files: &[&str], directories: &[&str]) -> GitTreeLevel {
        GitTreeLevel {
            path: path.to_string_lossy().into_owned(),
            files: files.iter().map(|name| name.to_string()).collect(),
            directories: directories.iter().map(|name| name.to_string()).collect(),
        }
    }

    #[test]
    fn legacy_colors_keep_untracked_directories_collapsed() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "tracked.txt", "clean\n");
        let untracked = scratch.0.join("untracked");
        std::fs::create_dir(&untracked).unwrap();
        std::fs::write(untracked.join("new.txt"), "new\n").unwrap();

        let root_colors = file_tree_colors(scratch.0.to_str().unwrap(), &["untracked".to_string()]);
        assert_eq!(root_colors.get("untracked"), Some(&"untracked"));
        let child_colors = file_tree_colors(untracked.to_str().unwrap(), &["new.txt".to_string()]);
        assert!(
            child_colors.is_empty(),
            "legacy scan must not expand untracked directories"
        );
    }

    #[test]
    fn legacy_color_command_returns_the_lightweight_result_asynchronously() {
        let scratch = Scratch::new();
        let nested = scratch.0.join("nested");
        Repository::init(&nested).unwrap();
        let colors = tauri::async_runtime::block_on(git_file_colors(
            scratch.0.to_string_lossy().into_owned(),
            vec!["nested".to_string(), "plain.txt".to_string()],
        ))
        .unwrap();
        assert_eq!(colors.get("nested").map(String::as_str), Some("repository"));
        assert!(!colors.contains_key("plain.txt"));
    }

    #[test]
    fn tree_batch_scans_each_repository_once_and_refreshes_without_ttl() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        std::fs::create_dir_all(scratch.0.join("sub/deep")).unwrap();
        commit_file(&repo, "sub/tracked.txt", "clean\n");
        std::fs::write(scratch.0.join("sub/tracked.txt"), "dirty\n").unwrap();
        std::fs::write(scratch.0.join("sub/deep/new.txt"), "new\n").unwrap();
        let levels = || {
            vec![
                tree_level(&scratch.0, &["sub"], &["sub"]),
                tree_level(&scratch.0.join("sub"), &["tracked.txt", "deep"], &["deep"]),
                tree_level(&scratch.0.join("sub/deep"), &["new.txt"], &[]),
            ]
        };
        let mut snapshots = TreeSnapshots::new(true);
        let result = tree_status_blocking(levels(), &mut snapshots);
        assert_eq!(snapshots.scans, 1);
        assert_eq!(result.repositories.len(), 1);
        assert_eq!(result.repositories[0].changed, 1);
        assert_eq!(result.repositories[0].untracked, 1);
        assert_eq!(
            result.file_colors[&scratch.0.to_string_lossy().into_owned()]["sub"],
            "modified"
        );
        assert_eq!(
            result.file_colors[&scratch.0.join("sub/deep").to_string_lossy().into_owned()]
                ["new.txt"],
            "untracked"
        );

        std::fs::write(scratch.0.join("sub/tracked.txt"), "clean\n").unwrap();
        std::fs::remove_file(scratch.0.join("sub/deep/new.txt")).unwrap();
        let mut snapshots = TreeSnapshots::new(true);
        let refreshed = tree_status_blocking(levels(), &mut snapshots);
        assert_eq!(snapshots.scans, 1);
        assert_eq!(refreshed.repositories[0].changed, 0);
        assert_eq!(refreshed.repositories[0].untracked, 0);
        assert!(refreshed.file_colors.values().all(HashMap::is_empty));
    }

    #[test]
    fn tree_batch_preserves_nested_repositories_and_non_repository_levels() {
        let scratch = Scratch::new();
        let outer = scratch.0.join("outer");
        let inner = outer.join("inner");
        let plain = scratch.0.join("plain");
        std::fs::create_dir(&plain).unwrap();
        let repo = Repository::init(&outer).unwrap();
        commit_file(&repo, "tracked.txt", "clean\n");
        let nested = Repository::init(&inner).unwrap();
        commit_file(&nested, "nested.txt", "clean\n");
        std::fs::write(inner.join("nested.txt"), "dirty\n").unwrap();
        let mut snapshots = TreeSnapshots::new(true);
        let result = tree_status_blocking(
            vec![
                tree_level(&scratch.0, &["outer", "plain"], &["outer", "plain"]),
                tree_level(&outer, &["inner", "tracked.txt"], &["inner"]),
                tree_level(&inner, &["nested.txt"], &[]),
                tree_level(&plain, &["unknown.txt"], &[]),
            ],
            &mut snapshots,
        );
        assert_eq!(snapshots.scans, 2);
        assert_eq!(result.repositories.len(), 2);
        assert_eq!(
            result.file_colors[&scratch.0.to_string_lossy().into_owned()]["outer"],
            "repository"
        );
        assert_eq!(
            result.file_colors[&outer.to_string_lossy().into_owned()]["inner"],
            "repository"
        );
        assert_eq!(
            result.file_colors[&inner.to_string_lossy().into_owned()]["nested.txt"],
            "modified"
        );
        assert!(result.file_colors[&plain.to_string_lossy().into_owned()].is_empty());
        assert!(
            !result.file_colors[&scratch.0.to_string_lossy().into_owned()].contains_key("plain")
        );
    }
    #[test]
    fn diff_includes_untracked_file_content() {
        let scratch = Scratch::new();
        Repository::init(&scratch.0).unwrap();
        std::fs::write(scratch.0.join("new.txt"), "hello\n").unwrap();
        // Regression: worktree diffs used to return empty for untracked files.
        let unstaged = git_diff_blocking(scratch.0.to_str().unwrap(), "new.txt", false).unwrap();
        assert!(unstaged.contains("+hello"), "unstaged patch: {unstaged}");
        let staged = git_diff_blocking(scratch.0.to_str().unwrap(), "new.txt", true).unwrap();
        assert!(
            !staged.contains("+hello"),
            "staged must not leak untracked: {staged}"
        );
    }

    #[test]
    fn binary_untracked_file_shows_marker_not_content() {
        let scratch = Scratch::new();
        Repository::init(&scratch.0).unwrap();
        let mut data = vec![0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff, 0xfe];
        data.extend(std::iter::repeat(0u8).take(64));
        std::fs::write(scratch.0.join("bin.dat"), &data).unwrap();
        let text = git_diff_blocking(scratch.0.to_str().unwrap(), "bin.dat", false).unwrap();
        assert!(
            text.contains("Binary files /dev/null and b/bin.dat differ"),
            "binary patch shows libgit2 marker: {text}"
        );
    }

    #[test]
    fn diff_is_capped_with_explicit_truncation_marker() {
        let scratch = Scratch::new();
        Repository::init(&scratch.0).unwrap();
        let line = "x".repeat(1024);
        let mut content = String::new();
        while content.len() <= MAX_DIFF_PATCH_BYTES {
            content.push_str(&line);
            content.push('\n');
        }
        std::fs::write(scratch.0.join("big.log"), &content).unwrap();
        let text = git_diff_blocking(scratch.0.to_str().unwrap(), "big.log", false).unwrap();
        assert!(
            text.contains(DIFF_TRUNCATED_MARKER),
            "marker in: {} bytes",
            text.len()
        );
        assert!(
            text.len() <= MAX_DIFF_PATCH_BYTES + DIFF_TRUNCATED_MARKER.len() + 1,
            "output bounded: {} bytes",
            text.len()
        );
    }

    #[test]
    fn discovery_includes_the_root_repository_itself() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "a.txt", "a\n");
        let roots = discover_repository_roots(&scratch.0, DISCOVERY_MAX_DEPTH, DISCOVERY_MAX_REPOS);
        assert_eq!(roots, vec![scratch.0.clone()]);
    }

    #[test]
    fn discovery_includes_the_containing_repository_of_a_workspace_subfolder() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "root.txt", "root\n");
        let workspace = scratch.0.join("apps/web");
        let nested = workspace.join("lib");
        std::fs::create_dir_all(&nested).unwrap();
        Repository::init(&nested).unwrap();

        let roots = discover_repository_roots(&workspace, DISCOVERY_MAX_DEPTH, DISCOVERY_MAX_REPOS);
        assert_eq!(roots, vec![scratch.0.clone(), nested]);
    }

    #[test]
    fn discovery_finds_nested_projects_under_a_plain_root() {
        let scratch = Scratch::new();
        let alpha = scratch.0.join("alpha");
        let beta = scratch.0.join("group/beta");
        let plain = scratch.0.join("plain");
        std::fs::create_dir_all(&alpha).unwrap();
        std::fs::create_dir_all(&beta).unwrap();
        std::fs::create_dir_all(&plain).unwrap();
        Repository::init(&alpha).unwrap();
        Repository::init(&beta).unwrap();

        let roots = discover_repository_roots(&scratch.0, DISCOVERY_MAX_DEPTH, DISCOVERY_MAX_REPOS);
        // Sorted ascending, non-repo directories excluded.
        assert_eq!(roots, vec![alpha, beta]);
    }

    #[test]
    fn discovery_skips_build_and_dependency_directories() {
        let scratch = Scratch::new();
        let real = scratch.0.join("real");
        let vendored = scratch.0.join("node_modules/dep");
        let output = scratch.0.join("target/pkg");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::create_dir_all(&vendored).unwrap();
        std::fs::create_dir_all(&output).unwrap();
        Repository::init(&real).unwrap();
        Repository::init(&vendored).unwrap();
        Repository::init(&output).unwrap();

        let roots = discover_repository_roots(&scratch.0, DISCOVERY_MAX_DEPTH, DISCOVERY_MAX_REPOS);
        assert_eq!(roots, vec![real]);
    }

    #[test]
    fn discovery_stops_at_the_depth_limit() {
        let scratch = Scratch::new();
        let shallow = scratch.0.join("a/b");
        let deep = scratch.0.join("a/b/c/d/e");
        std::fs::create_dir_all(&shallow).unwrap();
        std::fs::create_dir_all(&deep).unwrap();
        Repository::init(&shallow).unwrap();
        Repository::init(&deep).unwrap();

        // `shallow` sits at depth 2 (root -> a -> b); `deep` at depth 5.
        let roots = discover_repository_roots(&scratch.0, 2, DISCOVERY_MAX_REPOS);
        assert_eq!(roots, vec![shallow.clone()]);
        let roots = discover_repository_roots(&scratch.0, DISCOVERY_MAX_DEPTH, DISCOVERY_MAX_REPOS);
        assert_eq!(roots, vec![shallow, deep]);
    }

    #[test]
    fn discovery_caps_the_number_of_repositories() {
        let scratch = Scratch::new();
        for i in 0..6 {
            let dir = scratch.0.join(format!("p{i}"));
            std::fs::create_dir_all(&dir).unwrap();
            Repository::init(&dir).unwrap();
        }
        let roots = discover_repository_roots(&scratch.0, DISCOVERY_MAX_DEPTH, 3);
        assert_eq!(roots.len(), 3);
    }

    #[test]
    fn discovery_summaries_report_per_repo_changes() {
        let scratch = Scratch::new();
        let dirty = scratch.0.join("dirty");
        let clean = scratch.0.join("clean");
        std::fs::create_dir_all(&dirty).unwrap();
        std::fs::create_dir_all(&clean).unwrap();
        let repo = Repository::init(&dirty).unwrap();
        commit_file(&repo, "a.txt", "a\n");
        let clean_repo = Repository::init(&clean).unwrap();
        commit_file(&clean_repo, "b.txt", "b\n");
        std::fs::write(dirty.join("a.txt"), "changed\n").unwrap();
        std::fs::write(dirty.join("fresh.txt"), "new\n").unwrap();

        let roots = discover_repository_roots(&scratch.0, DISCOVERY_MAX_DEPTH, DISCOVERY_MAX_REPOS);
        let summaries = repository_summaries_for_roots(&roots);
        assert_eq!(summaries.len(), 2);
        let dirty_summary = summaries
            .iter()
            .find(|summary| summary.path == dirty.to_string_lossy())
            .unwrap();
        assert_eq!(dirty_summary.changed, 1);
        assert_eq!(dirty_summary.untracked, 1);
        let clean_summary = summaries
            .iter()
            .find(|summary| summary.path == clean.to_string_lossy())
            .unwrap();
        assert_eq!(clean_summary.changed, 0);
        assert_eq!(clean_summary.untracked, 0);
    }

    #[test]
    fn discovery_summaries_match_a_real_three_project_workspace() {
        // Reproduces the reported scenario end to end: a plain folder that is
        // not itself a repository, holding three independent projects, one of
        // them clean. A hand-built scratch cannot catch a path-shape mistake
        // in the status read, which is exactly what the panel consumes.
        let scratch = Scratch::new();
        for name in ["api", "web", "docs"] {
            let repo = Repository::init(scratch.0.join(name)).unwrap();
            commit_file(&repo, &format!("{name}.txt"), "hello\n");
        }
        // api: staged change only.
        std::fs::write(scratch.0.join("api/api.txt"), "staged\n").unwrap();
        let api = Repository::open(scratch.0.join("api")).unwrap();
        let mut index = api.index().unwrap();
        index.add_path(Path::new("api.txt")).unwrap();
        index.write().unwrap();
        // web: unstaged change plus an untracked file. docs stays clean.
        std::fs::write(scratch.0.join("web/web.txt"), "unstaged\n").unwrap();
        std::fs::write(scratch.0.join("web/new.txt"), "brand new\n").unwrap();

        let summaries = discover_repositories_blocking(scratch.0.to_string_lossy().into_owned());

        // The workspace root is not a repository, so it gets no summary of
        // its own - only the three nested projects.
        assert_eq!(
            summaries.iter().map(|s| s.path.as_str()).collect::<Vec<_>>(),
            vec![
                scratch.0.join("api").to_string_lossy().into_owned(),
                scratch.0.join("docs").to_string_lossy().into_owned(),
                scratch.0.join("web").to_string_lossy().into_owned(),
            ],
            "every project is listed, ordered by path"
        );

        let by_name = |name: &str| {
            let hit = summaries
                .iter()
                .find(|s| s.path.ends_with(name))
                .unwrap_or_else(|| panic!("missing summary for {name}"));
            (hit.changed, hit.untracked)
        };
        // A staged file counts toward `changed`; an untracked one counts
        // toward `untracked` and not toward `changed`.
        assert_eq!(by_name("api"), (1, 0), "api is staged-only");
        assert_eq!(by_name("web"), (1, 1), "web is unstaged + untracked");
        assert_eq!(by_name("docs"), (0, 0), "docs is clean");
        // The section header shows the branch before live status lands, so
        // every summary must carry one. Not compared to a literal: the
        // default branch name follows the machine's git config.
        for s in &summaries {
            assert!(!s.branch.is_empty(), "{} reports a branch", s.path);
        }
    }

    #[test]
    fn discover_blocking_returns_nothing_for_a_missing_root() {
        let missing = std::env::temp_dir().join(format!("ccgui-missing-{}", uuid::Uuid::new_v4()));
        assert!(discover_repositories_blocking(missing.to_string_lossy().into_owned()).is_empty());
    }

    fn commit_file(repo: &Repository, relative: &str, content: &str) {
        let workdir = repo.workdir().unwrap();
        std::fs::write(workdir.join(relative), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(relative)).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = git2::Signature::now("test", "test@example.com").unwrap();
        let parent = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            "init",
            &tree,
            &parents,
        )
        .unwrap();
    }

    /// Index writes used to queue on the IPC main thread. Off it, two clicks
    /// in the changes panel (stage while an unstage is in flight) overlap,
    /// and libgit2 fails the loser with "the index is locked". Both must land.
    #[test]
    fn overlapping_index_writes_on_one_repo_both_land() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        {
            // A larger index widens the read-modify-write window.
            let mut index = repo.index().unwrap();
            for i in 0..2000 {
                let relative = format!("f{i}.txt");
                std::fs::write(scratch.0.join(&relative), format!("{i}\n")).unwrap();
                index.add_path(Path::new(&relative)).unwrap();
            }
            index.write().unwrap();
        }
        commit_file(&repo, "a.txt", "base\n");
        commit_file(&repo, "b.txt", "base\n");
        let path = scratch.0.to_string_lossy().into_owned();

        for round in 0..10 {
            std::fs::write(scratch.0.join("a.txt"), format!("a{round}\n")).unwrap();
            std::fs::write(scratch.0.join("b.txt"), format!("b{round}\n")).unwrap();
            let start = std::sync::Arc::new(std::sync::Barrier::new(2));
            let stage = |file: &'static str| {
                let path = path.clone();
                let start = std::sync::Arc::clone(&start);
                std::thread::spawn(move || {
                    start.wait();
                    git_stage_blocking(&path, &[file.to_string()])
                })
            };
            let (a, b) = (stage("a.txt"), stage("b.txt"));
            a.join().unwrap().expect("staging a.txt");
            b.join().unwrap().expect("staging b.txt");

            let index = Repository::open(&scratch.0).unwrap().index().unwrap();
            let head = repo.head().unwrap().peel_to_tree().unwrap();
            for file in ["a.txt", "b.txt"] {
                assert_ne!(
                    index.get_path(Path::new(file), 0).unwrap().id,
                    head.get_path(Path::new(file)).unwrap().id(),
                    "{file} staged in round {round}"
                );
            }
            git_unstage_blocking(&path, &["a.txt".to_string(), "b.txt".to_string()]).unwrap();
        }
    }

    /// Clone with the initial checkout skipped, pin `core.autocrlf=false`, then
    /// check out. The CI Windows runner's global `core.autocrlf=true` otherwise
    /// rewrites the LF blobs to CRLF during clone, so a never-touched file reads
    /// dirty against its LF blob — which blocks the fast-forward that must
    /// preserve unrelated local edits.
    fn clone_lf(origin_url: &str, into: &Path) -> Repository {
        let mut builder = git2::build::RepoBuilder::new();
        // Empty CheckoutBuilder = GIT_CHECKOUT_NONE: no worktree bytes are
        // written until autocrlf is pinned off just below.
        builder.with_checkout(git2::build::CheckoutBuilder::new());
        let repo = builder.clone(origin_url, into).unwrap();
        repo.config().unwrap().set_bool("core.autocrlf", false).unwrap();
        let mut checkout = git2::build::CheckoutBuilder::new();
        checkout.force();
        repo.checkout_head(Some(&mut checkout)).unwrap();
        repo
    }

    #[test]
    fn pull_conflict_preserves_head_index_and_worktree() {
        for staged in [false, true] {
            let scratch = Scratch::new();
            let origin_path = scratch.0.join("origin");
            let origin = Repository::init(&origin_path).unwrap();
            commit_file(&origin, "shared.txt", "base\n");
            let local_path = scratch.0.join("local");
            let local = clone_lf(origin_path.to_str().unwrap(), &local_path);
            let old_head = local.head().unwrap().target().unwrap();
            std::fs::write(local_path.join("shared.txt"), "local\n").unwrap();
            if staged {
                let mut index = local.index().unwrap();
                index.add_path(Path::new("shared.txt")).unwrap();
                index.write().unwrap();
            }
            let old_index = local.index().unwrap().write_tree().unwrap();
            commit_file(&origin, "shared.txt", "remote\n");
            let error = git_pull_blocking(local_path.to_str().unwrap()).unwrap_err();
            assert_eq!(local.head().unwrap().target(), Some(old_head), "{error}");
            assert_eq!(local.index().unwrap().write_tree().unwrap(), old_index);
            assert_eq!(
                std::fs::read_to_string(local_path.join("shared.txt")).unwrap(),
                "local\n"
            );
            assert!(error.contains("shared.txt"), "{error}");
        }
    }

    /// HTTPS push/pull on stock macOS relies on `credential.helper
    /// osxkeychain`, which lives in Apple's CLT system gitconfig — a path
    /// libgit2 does not read on its own. `remote_config` must surface it.
    #[cfg(target_os = "macos")]
    #[test]
    fn remote_config_resolves_apple_system_credential_helper() {
        let apple = Path::new("/Library/Developer/CommandLineTools/usr/share/git-core/gitconfig");
        if !apple.exists() || Path::new("/etc/gitconfig").exists() {
            // No Apple system config on this machine; nothing to resolve.
            return;
        }
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        let config = remote_config(&repo).unwrap();
        let helper = config
            .get_string("credential.helper")
            .expect("credential.helper from Apple's system gitconfig must be visible");
        assert!(!helper.trim().is_empty());
    }

    #[test]
    fn pull_fast_forward_preserves_unrelated_local_changes() {
        let scratch = Scratch::new();
        let origin_path = scratch.0.join("origin");
        let origin = Repository::init(&origin_path).unwrap();
        commit_file(&origin, "shared.txt", "base\n");
        commit_file(&origin, "local.txt", "base\n");
        let local_path = scratch.0.join("local");
        let local = clone_lf(origin_path.to_str().unwrap(), &local_path);
        std::fs::write(local_path.join("local.txt"), "staged\n").unwrap();
        let mut index = local.index().unwrap();
        index.add_path(Path::new("local.txt")).unwrap();
        index.write().unwrap();
        let staged_blob = index.get_path(Path::new("local.txt"), 0).unwrap().id;
        std::fs::write(local_path.join("local.txt"), "unstaged\n").unwrap();
        std::fs::write(local_path.join("new.txt"), "untracked\n").unwrap();
        commit_file(&origin, "shared.txt", "remote\n");
        git_pull_blocking(local_path.to_str().unwrap()).unwrap();
        assert_eq!(
            local.head().unwrap().target(),
            origin.head().unwrap().target()
        );
        assert_eq!(
            std::fs::read_to_string(local_path.join("shared.txt")).unwrap(),
            "remote\n"
        );
        assert_eq!(
            std::fs::read_to_string(local_path.join("local.txt")).unwrap(),
            "unstaged\n"
        );
        assert_eq!(
            std::fs::read_to_string(local_path.join("new.txt")).unwrap(),
            "untracked\n"
        );
        assert_eq!(
            local
                .index()
                .unwrap()
                .get_path(Path::new("local.txt"), 0)
                .unwrap()
                .id,
            staged_blob
        );
        git_pull_blocking(local_path.to_str().unwrap()).unwrap();
    }

    #[test]
    fn ordinary_subdirectory_of_a_repo_is_not_a_repository() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "tracked.txt", "clean\n");
        let plain = scratch.0.join("plain");
        std::fs::create_dir(&plain).unwrap();

        assert!(exact_repository_summary(&plain).is_none());
        assert!(exact_repository_summary(&scratch.0).is_some());
    }

    #[test]
    fn summary_counts_changes_and_untracked_once() {
        let scratch = Scratch::new();
        let nested = scratch.0.join("nested");
        let repo = Repository::init(&nested).unwrap();
        commit_file(&repo, "tracked.txt", "clean\n");
        // Same file modified in the index and the worktree counts once.
        std::fs::write(nested.join("tracked.txt"), "staged\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("tracked.txt")).unwrap();
        index.write().unwrap();
        std::fs::write(nested.join("tracked.txt"), "changed again\n").unwrap();
        std::fs::write(nested.join("untracked.txt"), "new\n").unwrap();

        let summary = exact_repository_summary(&nested).unwrap();
        assert_eq!(summary.branch, repo.head().unwrap().shorthand().unwrap());
        assert_eq!(summary.changed, 1);
        assert_eq!(summary.untracked, 1);
    }

    #[test]
    fn batch_keeps_only_exact_roots_and_clean_status() {
        let scratch = Scratch::new();
        let repo_root = scratch.0.join("repo");
        let repo = Repository::init(&repo_root).unwrap();
        commit_file(&repo, "tracked.txt", "clean\n");
        let plain = scratch.0.join("plain");
        std::fs::create_dir(&plain).unwrap();

        let summaries = repository_summaries_blocking(vec![
            plain.to_string_lossy().into_owned(),
            repo_root.to_string_lossy().into_owned(),
        ]);

        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].path, repo_root.to_string_lossy().into_owned());
        assert_eq!(summaries[0].changed, 0);
        assert_eq!(summaries[0].untracked, 0);
    }

    #[test]
    fn file_colors_distinguish_untracked_from_modified() {
        let scratch = Scratch::new();
        let repo_root = scratch.0.join("repo");
        let repo = Repository::init(&repo_root).unwrap();
        commit_file(&repo, "clean.txt", "clean\n");
        commit_file(&repo, "modified.txt", "clean\n");
        std::fs::write(repo_root.join("modified.txt"), "dirty\n").unwrap();
        std::fs::write(repo_root.join("untracked.txt"), "new\n").unwrap();

        let colors = file_tree_colors(
            &repo_root.to_string_lossy(),
            &[
                "clean.txt".to_string(),
                "modified.txt".to_string(),
                "untracked.txt".to_string(),
            ],
        );

        assert_eq!(colors.get("clean.txt"), None, "colors={colors:?}");
        assert_eq!(
            colors.get("modified.txt"),
            Some(&"modified"),
            "colors={colors:?}"
        );
        assert_eq!(
            colors.get("untracked.txt"),
            Some(&"untracked"),
            "colors={colors:?}"
        );
    }

    #[test]
    fn file_colors_are_empty_outside_an_exact_repo() {
        let scratch = Scratch::new();
        let child = scratch.0.join("plain");
        std::fs::create_dir(&child).unwrap();

        let colors = file_tree_colors(&child.to_string_lossy(), &["whatever.txt".to_string()]);

        assert!(colors.is_empty());
    }

    #[test]
    fn folders_inherit_the_dirty_state_of_their_children() {
        let scratch = Scratch::new();
        let repo_root = scratch.0.join("repo");
        let repo = Repository::init(&repo_root).unwrap();
        commit_file(&repo, "clean.txt", "clean\n");
        std::fs::create_dir_all(repo_root.join("sub/deep")).unwrap();
        std::fs::write(repo_root.join("sub/deep/new.txt"), "x\n").unwrap();
        std::fs::create_dir_all(repo_root.join("mixed")).unwrap();
        commit_file(&repo, "mixed/tracked.txt", "clean\n");
        std::fs::write(repo_root.join("mixed/tracked.txt"), "dirty\n").unwrap();
        std::fs::write(repo_root.join("mixed/extra.txt"), "new\n").unwrap();
        std::fs::create_dir(repo_root.join("edited")).unwrap();
        commit_file(&repo, "edited/file.txt", "clean\n");
        std::fs::write(repo_root.join("edited/file.txt"), "dirty\n").unwrap();

        let colors = file_tree_colors(
            &repo_root.to_string_lossy(),
            &[
                "clean.txt".to_string(),
                "sub".to_string(),
                "mixed".to_string(),
                "edited".to_string(),
            ],
        );

        // Spec: folders propagate their children's state — untracked-only
        // → untracked (green), any modified → modified (orange).
        assert_eq!(colors.get("clean.txt"), None, "colors={colors:?}");
        assert_eq!(colors.get("sub"), Some(&"untracked"), "colors={colors:?}");
        assert_eq!(colors.get("mixed"), Some(&"modified"), "colors={colors:?}");
        assert_eq!(colors.get("edited"), Some(&"modified"), "colors={colors:?}");
    }

    #[test]
    fn colors_work_for_a_subdirectory_listing_inside_a_repo() {
        let scratch = Scratch::new();
        let repo_root = scratch.0.join("repo");
        let repo = Repository::init(&repo_root).unwrap();
        std::fs::create_dir_all(repo_root.join("pkg")).unwrap();
        commit_file(&repo, "top.txt", "clean\n");
        commit_file(&repo, "pkg/kept.txt", "clean\n");
        commit_file(&repo, "pkg/inner.txt", "clean\n");
        std::fs::write(repo_root.join("pkg/inner.txt"), "dirty\n").unwrap();
        std::fs::create_dir_all(repo_root.join("pkg/newdir")).unwrap();
        std::fs::write(repo_root.join("pkg/newdir/f.txt"), "x\n").unwrap();

        // Listing `pkg` (a plain subdir): paths are relative to `pkg`.
        let colors = file_tree_colors(
            &repo_root.join("pkg").to_string_lossy(),
            &[
                "kept.txt".to_string(),
                "inner.txt".to_string(),
                "newdir".to_string(),
            ],
        );

        assert_eq!(colors.get("kept.txt"), None, "colors={colors:?}");
        assert_eq!(
            colors.get("inner.txt"),
            Some(&"modified"),
            "colors={colors:?}"
        );
        // An untracked directory lights up green (collapsed `newdir/` entry).
        assert_eq!(
            colors.get("newdir"),
            Some(&"untracked"),
            "colors={colors:?}"
        );
    }

    #[test]
    fn nested_repo_folder_colors_from_its_own_status() {
        // The user's layout: a NON-repo workspace root whose subfolder is a
        // nested repo with changes — the folder name must still light up.
        let scratch = Scratch::new();
        let workspace = scratch.0.join("ws");
        let nested = workspace.join("Project").join("inner-repo");
        std::fs::create_dir_all(&nested).unwrap();
        let repo = Repository::init(&nested).unwrap();
        commit_file(&repo, "tracked.txt", "clean\n");
        std::fs::write(nested.join("tracked.txt"), "dirty\n").unwrap();
        std::fs::write(nested.join("fresh.txt"), "new\n").unwrap();

        let colors = file_tree_colors(
            &workspace.join("Project").to_string_lossy(),
            &["inner-repo".to_string()],
        );

        // Repo roots are blue regardless of their internal state.
        assert_eq!(
            colors.get("inner-repo"),
            Some(&"repository"),
            "colors={colors:?}"
        );
    }

    #[test]
    fn status_reports_ahead_behind_vs_upstream() {
        let scratch = Scratch::new();
        let origin_path = scratch.0.join("origin");
        let origin = Repository::init(&origin_path).unwrap();
        commit_file(&origin, "a.txt", "a\n");

        let local_path = scratch.0.join("local");
        let local = Repository::clone(origin_path.to_str().unwrap(), &local_path).unwrap();

        // One local-only commit → ahead 1; one origin-only commit → behind 1
        // once the local repo has fetched it.
        commit_file(&local, "b.txt", "b\n");
        commit_file(&origin, "c.txt", "c\n");
        local
            .find_remote("origin")
            .unwrap()
            .fetch(&["refs/heads/*:refs/remotes/origin/*"], None, None)
            .unwrap();

        let status = git_status_blocking(local_path.to_str().unwrap()).unwrap();
        assert_eq!(status.ahead, Some(1), "status={status:?}");
        assert_eq!(status.behind, Some(1), "status={status:?}");
    }

    #[test]
    fn status_omits_ahead_behind_without_upstream() {
        let scratch = Scratch::new();
        let repo_path = scratch.0.join("plain");
        let repo = Repository::init(&repo_path).unwrap();
        commit_file(&repo, "a.txt", "a\n");

        let status = git_status_blocking(repo_path.to_str().unwrap()).unwrap();
        assert_eq!(status.ahead, None, "status={status:?}");
        assert_eq!(status.behind, None, "status={status:?}");
    }

    #[test]
    fn init_turns_a_plain_directory_into_a_repository() {
        let scratch = Scratch::new();
        std::fs::write(scratch.0.join("a.txt"), "a\n").unwrap();
        let path = scratch.0.to_string_lossy().into_owned();
        assert_eq!(git_status_blocking(&path).unwrap_err(), "NOT_A_REPO");

        init_repository(&path).unwrap();

        let status = git_status_blocking(&path).unwrap();
        let untracked: Vec<_> = status.untracked.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(untracked, vec!["a.txt"]);
    }

    #[test]
    fn status_names_the_unborn_branch_of_a_fresh_repository() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        // Whatever init.defaultBranch the machine has, the label must be
        // that branch rather than the bare "HEAD" an unborn head reads as.
        let expected = repo
            .find_reference("HEAD")
            .unwrap()
            .symbolic_target()
            .and_then(|target| target.strip_prefix("refs/heads/"))
            .unwrap()
            .to_string();

        let status = git_status_blocking(scratch.0.to_str().unwrap()).unwrap();

        assert_eq!(status.branch, expected);
        assert_ne!(status.branch, "HEAD");
    }

    #[test]
    fn init_inside_an_existing_repository_leaves_it_alone() {
        let scratch = Scratch::new();
        Repository::init(&scratch.0).unwrap();
        let nested = scratch.0.join("sub");
        std::fs::create_dir_all(&nested).unwrap();

        init_repository(nested.to_str().unwrap()).unwrap();

        // A stale NOT_A_REPO must not nest a second repository that would
        // hide the outer one's changes under `sub/`.
        assert!(!nested.join(".git").exists());
    }

    #[test]
    fn init_never_creates_a_missing_directory() {
        let scratch = Scratch::new();
        let missing = scratch.0.join("gone");

        assert!(init_repository(missing.to_str().unwrap()).is_err());
        assert!(!missing.exists());
    }

    #[test]
    fn branches_list_locals_then_remote_tracking_skipping_origin_head() {
        let scratch = Scratch::new();
        let origin_path = scratch.0.join("origin");
        let origin = Repository::init(&origin_path).unwrap();
        commit_file(&origin, "a.txt", "a\n");
        let head = origin.head().unwrap().peel_to_commit().unwrap();
        origin.branch("v1.0.9", &head, false).unwrap();

        let local_path = scratch.0.join("local");
        let local = Repository::clone(origin_path.to_str().unwrap(), &local_path).unwrap();
        // A fetched remote HEAD alias: a symbolic ref with no target of its
        // own must not surface as a dead picker row.
        let remote_head = format!(
            "refs/remotes/origin/{}",
            origin.head().unwrap().shorthand().unwrap()
        );
        local
            .reference_symbolic("refs/remotes/origin/HEAD", &remote_head, true, "test")
            .unwrap();

        let branches = git_branches_blocking(local_path.to_str().unwrap()).unwrap();
        let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
        assert!(names.contains(&"origin/v1.0.9"), "names={names:?}");
        assert!(!names.contains(&"origin/HEAD"), "names={names:?}");
        let local_count = branches.iter().filter(|b| !b.is_remote).count();
        assert!(local_count > 0, "names={names:?}");
        assert!(
            branches[..local_count].iter().all(|b| !b.is_remote),
            "locals must come first: {names:?}"
        );
        assert!(
            branches[local_count..].iter().all(|b| b.is_remote),
            "names={names:?}"
        );
    }

    #[test]
    fn checkout_remote_branch_creates_local_tracking_branch() {
        let scratch = Scratch::new();
        let origin_path = scratch.0.join("origin");
        let origin = Repository::init(&origin_path).unwrap();
        commit_file(&origin, "a.txt", "a\n");
        let head = origin.head().unwrap().peel_to_commit().unwrap();
        origin.branch("v1.0.9", &head, false).unwrap();

        let local_path = scratch.0.join("local");
        let local = Repository::clone(origin_path.to_str().unwrap(), &local_path).unwrap();

        git_checkout_blocking(local_path.to_str().unwrap(), "origin/v1.0.9").unwrap();

        let head_ref = local.head().unwrap();
        assert_eq!(head_ref.shorthand(), Some("v1.0.9"));
        assert_eq!(head_ref.target(), Some(head.id()));
        let branch = local.find_branch("v1.0.9", git2::BranchType::Local).unwrap();
        assert_eq!(
            branch.upstream().unwrap().name().unwrap(),
            Some("origin/v1.0.9")
        );
        // Tracking makes ahead/behind visible (0/0) instead of hidden.
        let status = git_status_blocking(local_path.to_str().unwrap()).unwrap();
        assert_eq!((status.ahead, status.behind), (Some(0), Some(0)), "{status:?}");
    }

    #[test]
    fn checkout_remote_branch_keeps_existing_local_branch() {
        let scratch = Scratch::new();
        let origin_path = scratch.0.join("origin");
        let origin = Repository::init(&origin_path).unwrap();
        commit_file(&origin, "a.txt", "a\n");
        let base = origin.head().unwrap().peel_to_commit().unwrap();
        origin.branch("feature", &base, false).unwrap();

        let local_path = scratch.0.join("local");
        let local = Repository::clone(origin_path.to_str().unwrap(), &local_path).unwrap();
        // Local `feature` carries a commit the remote does not have: checking
        // out `origin/feature` must switch to it, never reset it to the tip.
        local
            .branch(
                "feature",
                &local.head().unwrap().peel_to_commit().unwrap(),
                false,
            )
            .unwrap();
        local.set_head("refs/heads/feature").unwrap();
        commit_file(&local, "local.txt", "local\n");
        let local_tip = local.head().unwrap().target().unwrap();
        assert_ne!(local_tip, base.id());

        git_checkout_blocking(local_path.to_str().unwrap(), "origin/feature").unwrap();

        assert_eq!(local.head().unwrap().target(), Some(local_tip));
        assert!(local_path.join("local.txt").exists());
        // Only switched: no upstream was invented for the existing branch.
        let branch = local.find_branch("feature", git2::BranchType::Local).unwrap();
        assert!(branch.upstream().is_err());
    }

    #[test]
    fn discard_restores_worktree_from_index_preserving_staged_hunks() {
        for (autocrlf, expected) in [(false, "staged\n"), (true, "staged\r\n")] {
            let scratch = Scratch::new();
            let repo = Repository::init(&scratch.0).unwrap();
            repo.config()
                .unwrap()
                .set_bool("core.autocrlf", autocrlf)
                .unwrap();
            repo.config().unwrap().set_str("core.eol", "lf").unwrap();
            commit_file(&repo, "a.txt", "base\n");
            std::fs::write(scratch.0.join("a.txt"), "staged\n").unwrap();
            {
                let mut index = repo.index().unwrap();
                index.add_path(Path::new("a.txt")).unwrap();
                index.write().unwrap();
            }
            let staged_blob = repo
                .index()
                .unwrap()
                .get_path(Path::new("a.txt"), 0)
                .unwrap()
                .id;
            std::fs::write(scratch.0.join("a.txt"), "unstaged\n").unwrap();

            git_discard_blocking(scratch.0.to_str().unwrap(), &["a.txt".to_string()]).unwrap();

            assert_eq!(
                std::fs::read_to_string(scratch.0.join("a.txt")).unwrap(),
                expected
            );
            assert_eq!(
                repo.index()
                    .unwrap()
                    .get_path(Path::new("a.txt"), 0)
                    .unwrap()
                    .id,
                staged_blob
            );
            assert_eq!(repo.find_blob(staged_blob).unwrap().content(), b"staged\n");
        }
    }

    #[test]
    fn discard_restores_unstaged_deletion() {
        for (autocrlf, expected) in [(false, "keep\n"), (true, "keep\r\n")] {
            let scratch = Scratch::new();
            let repo = Repository::init(&scratch.0).unwrap();
            repo.config()
                .unwrap()
                .set_bool("core.autocrlf", autocrlf)
                .unwrap();
            repo.config().unwrap().set_str("core.eol", "lf").unwrap();
            commit_file(&repo, "a.txt", "keep\n");
            let staged_tree = repo.index().unwrap().write_tree().unwrap();
            std::fs::remove_file(scratch.0.join("a.txt")).unwrap();

            git_discard_blocking(scratch.0.to_str().unwrap(), &["a.txt".to_string()]).unwrap();

            assert_eq!(
                std::fs::read_to_string(scratch.0.join("a.txt")).unwrap(),
                expected
            );
            assert_eq!(repo.index().unwrap().write_tree().unwrap(), staged_tree);
        }
    }

    #[test]
    fn discard_keeps_staged_new_file_content() {
        for (autocrlf, expected) in [(false, "fresh\n"), (true, "fresh\r\n")] {
            let scratch = Scratch::new();
            let repo = Repository::init(&scratch.0).unwrap();
            repo.config()
                .unwrap()
                .set_bool("core.autocrlf", autocrlf)
                .unwrap();
            repo.config().unwrap().set_str("core.eol", "lf").unwrap();
            commit_file(&repo, "base.txt", "base\n");
            std::fs::write(scratch.0.join("new.txt"), "fresh\n").unwrap();
            {
                let mut index = repo.index().unwrap();
                index.add_path(Path::new("new.txt")).unwrap();
                index.write().unwrap();
            }
            let staged_tree = repo.index().unwrap().write_tree().unwrap();

            git_discard_blocking(scratch.0.to_str().unwrap(), &["new.txt".to_string()]).unwrap();

            assert_eq!(
                std::fs::read_to_string(scratch.0.join("new.txt")).unwrap(),
                expected
            );
            assert_eq!(repo.index().unwrap().write_tree().unwrap(), staged_tree);
        }
    }

    #[test]
    fn discard_removes_untracked_file() {
        let scratch = Scratch::new();
        let repo = Repository::init(&scratch.0).unwrap();
        commit_file(&repo, "a.txt", "a\n");
        std::fs::create_dir_all(scratch.0.join("sub")).unwrap();
        std::fs::write(scratch.0.join("sub/new.txt"), "x\n").unwrap();

        git_discard_blocking(scratch.0.to_str().unwrap(), &["sub/new.txt".to_string()]).unwrap();

        assert!(!scratch.0.join("sub/new.txt").exists());
        assert_eq!(
            std::fs::read_to_string(scratch.0.join("a.txt")).unwrap(),
            "a\n"
        );
    }
    #[test]
    fn open_repo_error_mapping_keeps_real_causes() {
        assert_eq!(
            map_open_repo_error(git2::Error::new(
                git2::ErrorCode::NotFound,
                git2::ErrorClass::Repository,
                "could not find repository"
            )),
            "NOT_A_REPO"
        );
        // libgit2 的属主校验失败：GIT_EOWNER + GIT_ERROR_CONFIG（repository.c
        // validate_ownership）。按错误码判定，不依赖提示语措辞。
        assert_eq!(
            map_open_repo_error(git2::Error::new(
                git2::ErrorCode::Owner,
                git2::ErrorClass::Config,
                "repository path 'C:/x' is owned by someone else"
            )),
            "GIT_UNSAFE_REPO:repository path 'C:/x' is owned by someone else"
        );
        // 错误码丢失时（例如经过别的包装）仍按 libgit2 的提示语兜底。
        assert!(
            map_open_repo_error(git2::Error::new(
                git2::ErrorCode::GenericError,
                git2::ErrorClass::Os,
                "repository path 'C:/x' is not owned by current user"
            ))
            .starts_with("GIT_UNSAFE_REPO:")
        );
        assert!(
            map_open_repo_error(git2::Error::new(
                git2::ErrorCode::GenericError,
                git2::ErrorClass::Os,
                "path too long"
            ))
            .starts_with("GIT_OPEN_FAILED:")
        );
    }

    #[test]
    fn open_repo_non_repo_is_not_a_repo() {
        let scratch = Scratch::new();
        match open_repo(scratch.0.to_str().unwrap()) {
            Err(error) => assert_eq!(error, "NOT_A_REPO"),
            Ok(_) => panic!("plain directory should not open as a repository"),
        }
    }

    /// 中文/空格路径不应被误判为「不是仓库」。
    #[test]
    fn open_repo_supports_unicode_paths() {
        let scratch = Scratch::new();
        let path = scratch.0.join("中文 目录");
        let repo = Repository::init(&path).unwrap();
        commit_file(&repo, "a.txt", "a\n");
        let opened = open_repo(path.to_str().unwrap()).expect("unicode path opens");
        assert!(opened.workdir().is_some());
    }
}
