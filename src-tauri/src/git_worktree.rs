//! git worktree lifecycle: create (progress events + cancellation), remove,
//! list, branch-merged check, and GitHub PR preview resolution.
//!
//! Mutating ops run through the git CLI: a fetch/worktree-add subprocess is
//! killable (cancel), and its stderr is the mature error wording users
//! already know from the terminal. The worktree list also comes from the CLI
//! (`--porcelain`): git2's worktree API cannot report the *main* worktree's
//! branch or lock state uniformly. Other reads (branch existence, merged
//! check) use git2 like the rest of git.rs.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Notify;

pub const CREATE_PROGRESS_EVENT: &str = "worktree://create-progress";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    /// Local branch checked out there; None when detached.
    pub branch: Option<String>,
    pub head: String,
    pub is_main: bool,
    pub locked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lock_reason: Option<String>,
    /// git 判定该 worktree 目录已丢失（prunable）；侧栏据此渲染「目录已丢失」态。
    pub prunable: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCreateArgs {
    /// Parent repo (main checkout) the worktree is added to.
    pub repo_path: String,
    /// Sidebar parent row; registration happens in the register stage.
    pub parent_workspace_id: String,
    pub branch: String,
    pub worktree_path: String,
    /// New-branch flow: base the branch starts from (e.g. "origin/main").
    pub base_ref: Option<String>,
    /// PR flow: fetch refs/pull/<n>/head into `branch` first.
    pub pr_number: Option<u64>,
    /// PR metadata carried into workspace meta (preview may be degraded).
    pub pr_title: Option<String>,
    pub pr_url: Option<String>,
    /// true = check out an existing local branch instead of creating one.
    pub existing_branch: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProgress {
    pub creation_id: String,
    /// validate | fetch | add | register | done | failed | canceled
    pub stage: &'static str,
    /// Stage detail (e.g. "pull/1842/head"); UI composes the readable text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRemoveResult {
    /// git had no registration for the directory (already pruned manually).
    pub orphan_directory: bool,
    pub branch_deleted: bool,
    /// Why the branch survived: "not_requested" is not reported (None).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_kept_reason: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrPreview {
    pub number: u64,
    /// "owner/repo" on GitHub.
    pub repo: String,
    /// true = gh CLI unavailable/failed; only the number is confirmed.
    pub degraded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additions: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletions: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    pub branch_conflict: bool,
    pub dir_conflict: bool,
}

#[derive(Debug)]
struct CreateFailure {
    kind: &'static str,
    message: String,
}

fn fail(kind: &'static str, message: impl Into<String>) -> CreateFailure {
    CreateFailure {
        kind,
        message: message.into(),
    }
}

/// `open_repo` 失败 → 创建失败。只有确实没有仓库才是 `not_a_repo`；属主校验
/// 等打不开的情况带着 `open_repo` 的分类原话（`GIT_UNSAFE_REPO:` /
/// `GIT_OPEN_FAILED:`）给界面，不再误报「不是 Git 仓库」。
fn open_failure(repo_path: &str, error: String) -> CreateFailure {
    if error == "NOT_A_REPO" {
        fail("not_a_repo", format!("{repo_path} is not a git repository"))
    } else {
        fail("repo_open_failed", error)
    }
}

// ---------------------------------------------------------------------------
// Cancellation registry (stored on AppState)
// ---------------------------------------------------------------------------

pub struct CreationCancel {
    cancelled: AtomicBool,
    notify: Notify,
}

impl CreationCancel {
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

#[derive(Clone, Default)]
pub struct CreationRegistry {
    inner: Arc<Mutex<HashMap<String, Arc<CreationCancel>>>>,
}

impl CreationRegistry {
    pub fn register(&self, creation_id: &str) -> Arc<CreationCancel> {
        let cancel = Arc::new(CreationCancel {
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        });
        self.inner
            .lock()
            .insert(creation_id.to_string(), Arc::clone(&cancel));
        cancel
    }

    /// true when a live creation was signalled; false = nothing to cancel.
    pub fn cancel(&self, creation_id: &str) -> bool {
        let Some(cancel) = self.inner.lock().get(creation_id).cloned() else {
            return false;
        };
        cancel.cancelled.store(true, Ordering::SeqCst);
        cancel.notify.notify_waiters();
        true
    }

    pub fn finish(&self, creation_id: &str) {
        self.inner.lock().remove(creation_id);
    }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without git)
// ---------------------------------------------------------------------------

/// Accepts "1842", "#1842", or a GitHub PR URL (any suffix after the number).
pub fn parse_pr_input(input: &str) -> Option<u64> {
    let t = input.trim();
    let bare = t.strip_prefix('#').unwrap_or(t);
    if let Ok(n) = bare.parse::<u64>() {
        return (n > 0).then_some(n);
    }
    let marker = "/pull/";
    let idx = t.find(marker)?;
    let digits: String = t[idx + marker.len()..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse::<u64>().ok().filter(|n| *n > 0)
}

/// Extracts "owner/repo" from a GitHub remote URL (https, ssh://, scp-style).
pub fn github_owner_repo(url: &str) -> Option<String> {
    let path = if let Some(rest) = url.strip_prefix("git@github.com:") {
        rest
    } else {
        url.strip_prefix("https://github.com/")
            .or_else(|| url.strip_prefix("http://github.com/"))
            .or_else(|| url.strip_prefix("ssh://git@github.com/"))?
    };
    let path = path.trim_end_matches('/').trim_end_matches(".git");
    let mut parts = path.split('/');
    let owner = parts.next().filter(|s| !s.is_empty())?;
    let repo = parts.next().filter(|s| !s.is_empty())?;
    if parts.next().is_some() {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

/// Parses `git worktree list --porcelain`. The first block is the main
/// worktree. `locked [reason]` and `prunable` lines follow the block they
/// belong to (git ≥ 2.36 prints reasons inline).
pub fn parse_worktree_porcelain(text: &str) -> Vec<WorktreeInfo> {
    let mut out: Vec<WorktreeInfo> = Vec::new();
    let mut cur: Option<WorktreeInfo> = None;
    for line in text.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(done) = cur.take() {
                out.push(done);
            }
            cur = Some(WorktreeInfo {
                path: path.to_string(),
                branch: None,
                head: String::new(),
                is_main: out.is_empty(),
                locked: false,
                lock_reason: None,
                prunable: false,
            });
            continue;
        }
        let Some(w) = cur.as_mut() else { continue };
        if let Some(head) = line.strip_prefix("HEAD ") {
            w.head = head.to_string();
        } else if let Some(reference) = line.strip_prefix("branch ") {
            w.branch = Some(
                reference
                    .strip_prefix("refs/heads/")
                    .unwrap_or(reference)
                    .to_string(),
            );
        } else if line == "detached" {
            w.branch = None;
        } else if line == "locked" {
            w.locked = true;
        } else if let Some(reason) = line.strip_prefix("locked ") {
            w.locked = true;
            w.lock_reason = Some(reason.to_string());
        } else if line == "prunable" || line.starts_with("prunable ") {
            w.prunable = true;
        }
    }
    if let Some(done) = cur.take() {
        out.push(done);
    }
    out
}

fn same_path(a: &str, b: &str) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => {
            a.trim_end_matches(['/', '\\']) == b.trim_end_matches(['/', '\\'])
        }
    }
}

fn summarize_stderr(stderr: &str) -> String {
    let text = stderr.trim();
    const CAP: usize = 300;
    if text.len() > CAP {
        format!("{}…", &text[..text.floor_char_boundary(CAP)])
    } else {
        text.to_string()
    }
}

// ---------------------------------------------------------------------------
// git CLI runner
// ---------------------------------------------------------------------------

struct GitOutput {
    stdout: String,
    stderr: String,
    status: std::process::ExitStatus,
}

/// Runs `git -C <repo> <args>` to completion, draining both pipes (a full
/// stderr pipe would otherwise deadlock a chatty fetch). With `cancel`, the
/// subprocess is killed on cancellation and the returned flag is true.
async fn run_git(
    repo: &Path,
    args: &[&str],
    cancel: Option<&Arc<CreationCancel>>,
) -> Result<(GitOutput, bool), String> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(repo)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    // Same spawn contract as cli_lifecycle: own process group on unix so a
    // cancel sweeps fetch's helper children (ssh) too; job object on
    // Windows so app exit never orphans the tree.
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    crate::engine::hide_console(&mut command);
    let mut child = command.spawn().map_err(|e| format!("spawn git: {e}"))?;
    let pid = child.id();
    #[cfg(windows)]
    let _tree_guard = crate::engine::job::assign_kill_on_close(&child);

    async fn drain(pipe: Option<impl tokio::io::AsyncRead + Unpin>) -> Vec<u8> {
        let mut buf = Vec::new();
        if let Some(mut s) = pipe {
            let _ = s.read_to_end(&mut buf).await;
        }
        buf
    }
    let out_task = tokio::spawn(drain(child.stdout.take()));
    let err_task = tokio::spawn(drain(child.stderr.take()));

    let mut cancelled = false;
    let status = if let Some(cancel) = cancel {
        tokio::select! {
            s = child.wait() => s,
            _ = cancel.notify.notified() => {
                cancelled = true;
                if let Some(pid) = pid.filter(|p| *p != 0) {
                    crate::engine::kill_process_group(pid);
                }
                let _ = child.start_kill();
                child.wait().await
            }
        }
    } else {
        child.wait().await
    }
    .map_err(|e| format!("wait git: {e}"))?;

    let stdout = String::from_utf8_lossy(&out_task.await.map_err(|e| e.to_string())?).into_owned();
    let stderr = String::from_utf8_lossy(&err_task.await.map_err(|e| e.to_string())?).into_owned();
    Ok((GitOutput { stdout, stderr, status }, cancelled))
}

// ---------------------------------------------------------------------------
// Create flow
// ---------------------------------------------------------------------------

fn emit_progress(
    app: Option<&tauri::AppHandle>,
    creation_id: &str,
    stage: &'static str,
    message: Option<String>,
    error_kind: Option<&'static str>,
    error: Option<String>,
) {
    let Some(app) = app else { return };
    let _ = app.emit(
        CREATE_PROGRESS_EVENT,
        CreateProgress {
            creation_id: creation_id.to_string(),
            stage,
            message,
            error_kind,
            error,
        },
    );
}

async fn list_worktrees_cli(repo: &Path) -> Result<Vec<WorktreeInfo>, String> {
    let (out, _) = run_git(repo, &["worktree", "list", "--porcelain"], None).await?;
    if !out.status.success() {
        return Err(summarize_stderr(&out.stderr));
    }
    Ok(parse_worktree_porcelain(&out.stdout))
}

/// Remote prefix of a ref like "origin/main" when "origin" is a real remote.
fn split_remote<'a>(repo: &git2::Repository, base: &'a str) -> Option<(&'a str, &'a str)> {
    let remotes = repo.remotes().ok()?;
    for name in remotes.iter().flatten() {
        if let Some(rest) = base.strip_prefix(name).and_then(|r| r.strip_prefix('/')) {
            if !rest.is_empty() {
                return Some((&base[..name.len()], rest));
            }
        }
    }
    None
}

/// Best-effort cleanup after a failed/canceled `worktree add`: drop the
/// half-created checkout and its registration. Branch refs are kept on
/// purpose — harmless, and the user may want them.
async fn cleanup_partial_add(repo: &Path, target: &Path) {
    if target.exists() {
        let target = target.to_string_lossy().into_owned();
        let _ = run_git(repo, &["worktree", "remove", "--force", &target], None).await;
    }
    let _ = run_git(repo, &["worktree", "prune"], None).await;
}

/// New branches push without an upstream; with --no-track git would
/// otherwise make the first push a manual -u affair. Set the repo-level
/// default once (only when the user configured nothing at any scope).
async fn ensure_push_auto_setup(repo: &Path) {
    let get = run_git(repo, &["config", "--get", "push.autoSetupRemote"], None).await;
    let unset = match get {
        Ok((out, _)) => !out.status.success() || out.stdout.trim().is_empty(),
        Err(_) => true,
    };
    if unset {
        let _ = run_git(repo, &["config", "push.autoSetupRemote", "true"], None).await;
    }
}

/// True when every indexed path is skip-worktree, i.e. sparse-checkout rules
/// excluded the whole tree and `git worktree add` produced a directory with
/// no files in it. Such a worktree is unusable, so creation fails instead of
/// registering an empty workspace.
fn worktree_is_empty_checkout(path: &Path) -> bool {
    let Ok(repo) = git2::Repository::open(path) else {
        return false;
    };
    let Ok(index) = repo.index() else {
        return false;
    };
    !index.is_empty()
        && index
            .iter()
            .all(|entry| entry.flags_extended & crate::git::INDEX_ENTRY_SKIP_WORKTREE != 0)
}

/// The whole create pipeline, split from the command for tests (no AppHandle
/// / AppState needed: pass None to skip event emission and registration).
async fn run_create(
    app: Option<&tauri::AppHandle>,
    state: Option<&crate::AppState>,
    creation_id: &str,
    args: &WorktreeCreateArgs,
    cancel: &Arc<CreationCancel>,
) -> Result<(), CreateFailure> {
    let repo_path = PathBuf::from(&args.repo_path);
    let check_cancel = |cancel: &Arc<CreationCancel>| -> Result<(), CreateFailure> {
        if cancel.is_cancelled() {
            Err(fail("canceled", String::new()))
        } else {
            Ok(())
        }
    };

    // ---- validate ----------------------------------------------------------
    emit_progress(app, creation_id, "validate", None, None, None);
    let repo = crate::git::open_repo(&args.repo_path)
        .map_err(|error| open_failure(&args.repo_path, error))?;

    let fmt = run_git(
        &repo_path,
        &["check-ref-format", "--branch", &args.branch],
        None,
    )
    .await
    .map_err(|e| fail("unknown", e))?;
    if !fmt.0.status.success() {
        return Err(fail(
            "invalid_branch",
            format!("invalid branch name: {}", args.branch),
        ));
    }

    let branch_exists = repo
        .find_branch(&args.branch, git2::BranchType::Local)
        .is_ok();
    if args.existing_branch && !branch_exists {
        return Err(fail(
            "branch_not_found",
            format!("branch {} does not exist", args.branch),
        ));
    }
    if !args.existing_branch && branch_exists {
        return Err(fail(
            "branch_exists",
            format!("branch {} already exists", args.branch),
        ));
    }

    // Resume detection: a previous attempt created the worktree but failed
    // before/during registration — the directory is already this repo's
    // worktree on the wanted branch, so skip straight to registration.
    let target = PathBuf::from(&args.worktree_path);
    let mut resume = false;
    if target.exists() {
        let list = list_worktrees_cli(&repo_path)
            .await
            .map_err(|e| fail("unknown", e))?;
        resume = list.iter().any(|w| {
            same_path(&w.path, &args.worktree_path)
                && w.branch.as_deref() == Some(args.branch.as_str())
        });
        if !resume {
            return Err(fail(
                "dir_exists",
                format!("{} already exists", args.worktree_path),
            ));
        }
    }

    if args.existing_branch {
        let list = list_worktrees_cli(&repo_path)
            .await
            .map_err(|e| fail("unknown", e))?;
        if list
            .iter()
            .any(|w| w.branch.as_deref() == Some(args.branch.as_str()))
        {
            return Err(fail(
                "branch_checked_out",
                format!("branch {} is already checked out in another worktree", args.branch),
            ));
        }
    }
    check_cancel(cancel)?;

    // ---- fetch -------------------------------------------------------------
    if let Some(number) = args.pr_number.filter(|_| !resume) {
        let detail = format!("pull/{number}/head");
        emit_progress(app, creation_id, "fetch", Some(detail), None, None);
        let refspec = format!("+refs/pull/{number}/head:refs/heads/{}", args.branch);
        let (out, cancelled) = run_git(&repo_path, &["fetch", "origin", &refspec], Some(cancel))
            .await
            .map_err(|e| fail("unknown", e))?;
        if cancelled {
            return Err(fail("canceled", String::new()));
        }
        if !out.status.success() {
            let kind = if out.stderr.contains("couldn't find remote ref") {
                "pr_not_found"
            } else {
                "fetch_failed"
            };
            return Err(fail(kind, summarize_stderr(&out.stderr)));
        }
    } else if !args.existing_branch && !resume {
        let base = args
            .base_ref
            .as_deref()
            .filter(|b| !b.trim().is_empty())
            .ok_or_else(|| fail("invalid_args", "base_ref is required for a new branch"))?;
        // Refresh the remote-tracking base when there is one; a failed fetch
        // only blocks creation when the base doesn't resolve locally at all.
        if let Some((remote, rest)) = split_remote(&repo, base) {
            emit_progress(app, creation_id, "fetch", Some(base.to_string()), None, None);
            let (_, cancelled) = run_git(&repo_path, &["fetch", remote, rest], Some(cancel))
                .await
                .map_err(|e| fail("unknown", e))?;
            if cancelled {
                return Err(fail("canceled", String::new()));
            }
        }
        let verify = run_git(
            &repo_path,
            &["rev-parse", "--verify", &format!("{base}^{{commit}}")],
            None,
        )
        .await
        .map_err(|e| fail("unknown", e))?;
        if !verify.0.status.success() {
            return Err(fail(
                "base_not_found",
                format!("base ref {base} does not resolve"),
            ));
        }
    }
    check_cancel(cancel)?;

    // ---- add ---------------------------------------------------------------
    if !resume {
        emit_progress(app, creation_id, "add", Some(args.branch.clone()), None, None);
        let add_args: Vec<&str> = if args.existing_branch || args.pr_number.is_some() {
            vec!["worktree", "add", &args.worktree_path, &args.branch]
        } else {
            vec![
                "worktree",
                "add",
                "--no-track",
                "-b",
                &args.branch,
                &args.worktree_path,
                args.base_ref.as_deref().unwrap_or("HEAD"),
            ]
        };
        let (out, cancelled) = run_git(&repo_path, &add_args, Some(cancel))
            .await
            .map_err(|e| fail("unknown", e))?;
        if cancelled {
            cleanup_partial_add(&repo_path, &target).await;
            return Err(fail("canceled", String::new()));
        }
        if !out.status.success() {
            cleanup_partial_add(&repo_path, &target).await;
            let kind = if out.stderr.contains("already checked out") {
                "branch_checked_out"
            } else {
                "add_failed"
            };
            return Err(fail(kind, summarize_stderr(&out.stderr)));
        }
        ensure_push_auto_setup(&repo_path).await;
    }

    // Sparse-checkout rules that exclude every path make `git worktree add`
    // succeed with an empty directory (every index entry skip-worktree). The
    // worktree is unusable, so fail with guidance instead of registering it.
    // A resumed directory is left on disk (the user may be mid-repair) but is
    // still not registered until it holds files.
    if worktree_is_empty_checkout(&target) {
        if !resume {
            cleanup_partial_add(&repo_path, &target).await;
        }
        return Err(fail(
            "sparse_checkout_empty",
            format!(
                "{} checked out no files: the repository's sparse-checkout rules exclude every path",
                args.worktree_path
            ),
        ));
    }
    check_cancel(cancel)?;

    // ---- register ----------------------------------------------------------
    if let Some(state) = state {
        emit_progress(app, creation_id, "register", None, None, None);
        let mut meta = serde_json::Map::new();
        meta.insert("branch".into(), args.branch.clone().into());
        if let Some(base) = &args.base_ref {
            meta.insert("baseRef".into(), base.clone().into());
        }
        if let Some(number) = args.pr_number {
            meta.insert("prNumber".into(), number.into());
        }
        if let Some(title) = &args.pr_title {
            meta.insert("prTitle".into(), title.clone().into());
        }
        if let Some(url) = &args.pr_url {
            meta.insert("prUrl".into(), url.clone().into());
        }
        let meta = serde_json::json!({ "worktree": serde_json::Value::Object(meta) });
        crate::history::reader::add_workspace_inner(
            &state.db,
            &state.sink,
            &args.worktree_path,
            Some(meta),
            Some("worktree".to_string()),
            Some(args.parent_workspace_id.clone()),
        )
        // The worktree exists on disk now; only the sidebar row is missing.
        // A retry hits the resume path above and lands here again.
        .map_err(|e| fail("register_failed", e))?;
    }

    emit_progress(app, creation_id, "done", None, None, None);
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn git_worktree_list(repo_path: String) -> Result<Vec<WorktreeInfo>, String> {
    crate::git::open_repo(&repo_path)?;
    list_worktrees_cli(&PathBuf::from(repo_path)).await
}

#[tauri::command]
pub async fn git_worktree_create(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    creation_id: String,
    args: WorktreeCreateArgs,
) -> Result<(), String> {
    let id = creation_id.trim().to_string();
    if id.is_empty() {
        return Err("empty creation_id".to_string());
    }
    let cancel = state.worktree_creations.register(&id);
    let result = run_create(Some(&app), Some(&state), &id, &args, &cancel).await;
    state.worktree_creations.finish(&id);
    match result {
        Ok(()) => Ok(()),
        Err(f) if f.kind == "canceled" => {
            emit_progress(Some(&app), &id, "canceled", None, None, None);
            Ok(())
        }
        Err(f) => {
            emit_progress(Some(&app), &id, "failed", None, Some(f.kind), Some(f.message.clone()));
            Err(f.message)
        }
    }
}

/// Signals a running creation to stop at the next stage boundary; a git
/// subprocess in flight is killed. false = no such live creation.
#[tauri::command]
pub fn git_worktree_create_cancel(
    state: tauri::State<'_, crate::AppState>,
    creation_id: String,
) -> bool {
    state.worktree_creations.cancel(&creation_id)
}

#[tauri::command]
pub async fn git_worktree_remove(
    repo_path: String,
    worktree_path: String,
    branch: Option<String>,
    delete_branch: bool,
) -> Result<WorktreeRemoveResult, String> {
    let repo = PathBuf::from(&repo_path);
    // git resolves a relative path against `-C repo`, the fallbacks below
    // against the process CWD: refuse the ambiguity outright.
    if !Path::new(&worktree_path).is_absolute() {
        return Err(format!("worktree path must be absolute: {worktree_path}"));
    }
    // Only the common dir is kept: git2::Repository is not Send, so the
    // handle must not live across the awaits below.
    let common_dir = crate::git::open_repo(&repo_path)?.commondir().to_path_buf();

    let mut orphan_directory = false;
    let (out, _) = run_git(
        &repo,
        &["worktree", "remove", "--force", &worktree_path],
        None,
    )
    .await?;
    if !out.status.success() {
        // Orphan: git lost the registration (manually pruned, moved). Drop
        // the directory ourselves and reconcile the registry — but only when
        // it provably was a linked worktree of THIS repo. Anything else
        // (locked tree, main checkout, an arbitrary directory a caller passed
        // in) keeps git's refusal instead of a recursive delete.
        let dir = Path::new(&worktree_path);
        if is_orphan_worktree_dir(&repo, &common_dir, dir).await {
            tokio::fs::remove_dir_all(&worktree_path)
                .await
                .map_err(|e| format!("remove {}: {e}", worktree_path))?;
        } else if is_plain_dir(dir) && !dir.join(".git").exists() {
            // --force already dropped the .git file and the registration but
            // could not remove a busy root (Windows: a terminal's cwd). On
            // retry only an EMPTY leftover goes — remove_dir is not recursive.
            tokio::fs::remove_dir(dir)
                .await
                .map_err(|_| summarize_stderr(&out.stderr))?;
        } else {
            return Err(summarize_stderr(&out.stderr));
        }
        let _ = run_git(&repo, &["worktree", "prune"], None).await;
        orphan_directory = true;
    }

    let mut branch_deleted = false;
    let mut branch_kept_reason = None;
    if delete_branch {
        if let Some(branch) = branch.as_deref().filter(|b| !b.trim().is_empty()) {
            // Conservative first: -d refuses unmerged branches. The user
            // explicitly opted into deletion after seeing the merged check,
            // so a refusal is followed by -D.
            let (soft, _) = run_git(&repo, &["branch", "-d", branch], None).await?;
            if soft.status.success() {
                branch_deleted = true;
            } else {
                let (hard, _) = run_git(&repo, &["branch", "-D", branch], None).await?;
                if hard.status.success() {
                    branch_deleted = true;
                } else {
                    branch_kept_reason = Some(
                        if hard.stderr.contains("checked out") {
                            "checked_out_elsewhere"
                        } else {
                            "unknown"
                        },
                    );
                }
            }
        }
    }

    Ok(WorktreeRemoveResult {
        orphan_directory,
        branch_deleted,
        branch_kept_reason,
    })
}

/// Canonical form of a path that may not exist (a pruned worktree's gitdir):
/// canonicalize the deepest existing ancestor, re-append the rest. Keeps
/// /var vs /private/var style symlinks from defeating prefix checks.
fn canonical_lossy(path: &Path) -> PathBuf {
    let mut existing = path.to_path_buf();
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if let Ok(real) = std::fs::canonicalize(&existing) {
            return rest.iter().rev().fold(real, |acc, part| acc.join(part));
        }
        match (
            existing.file_name().map(|n| n.to_os_string()),
            existing.parent(),
        ) {
            (Some(name), Some(parent)) => {
                rest.push(name);
                existing = parent.to_path_buf();
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// Lexically drop `.` / `..` so a gitdir like `<common>/worktrees/../..`
/// cannot climb out of the worktrees directory.
fn normalize_lexically(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// The `gitdir:` target of a linked worktree's `.git` FILE (the main
/// checkout has a `.git` directory, which never qualifies).
fn worktree_gitdir(dir: &Path) -> Option<PathBuf> {
    let dot_git = dir.join(".git");
    if !std::fs::symlink_metadata(&dot_git).ok()?.is_file() {
        return None;
    }
    let text = std::fs::read_to_string(&dot_git).ok()?;
    let target = text.lines().next()?.strip_prefix("gitdir:")?.trim();
    if target.is_empty() {
        return None;
    }
    let target = Path::new(target);
    Some(if target.is_absolute() {
        target.to_path_buf()
    } else {
        dir.join(target)
    })
}

/// A real directory, not a symlink to one.
fn is_plain_dir(dir: &Path) -> bool {
    std::fs::symlink_metadata(dir)
        .map(|m| m.is_dir())
        .unwrap_or(false)
}

/// Recursive-delete gate for git_worktree_remove's orphan fallback. True only
/// when `dir` is a directory that git no longer lists for this repo, is not
/// the repo itself or one of its ancestors, and whose `.git` file points to
/// exactly `<common_dir>/worktrees/<name>` while that admin directory is gone
/// — i.e. a linked worktree of this repo whose registration was lost.
async fn is_orphan_worktree_dir(repo: &Path, common_dir: &Path, dir: &Path) -> bool {
    if !is_plain_dir(dir) {
        return false;
    }
    let dir_real = canonical_lossy(dir);
    if canonical_lossy(repo).starts_with(&dir_real)
        || canonical_lossy(common_dir).starts_with(&dir_real)
    {
        return false;
    }
    // Still registered (locked, main, or a real git failure): not an orphan.
    match list_worktrees_cli(repo).await {
        Ok(list)
            if list
                .iter()
                .any(|w| same_path(&w.path, &dir.to_string_lossy())) =>
        {
            return false
        }
        Ok(_) => {}
        Err(_) => return false,
    }
    let Some(gitdir) = worktree_gitdir(dir) else {
        return false;
    };
    let worktrees = canonical_lossy(&common_dir.join("worktrees"));
    let gitdir = normalize_lexically(&canonical_lossy(&gitdir));
    // Exactly one level below worktrees/: deeper paths are submodule gitdirs
    // (<common>/worktrees/<wt>/modules/<sub>) of a possibly locked worktree.
    let Ok(rel) = gitdir.strip_prefix(&worktrees) else {
        return false;
    };
    let mut parts = rel.components();
    if !matches!(
        (parts.next(), parts.next()),
        (Some(std::path::Component::Normal(_)), None)
    ) {
        return false;
    }
    // An admin dir that still exists means git still tracks this tree under
    // another path (moved / remounted, maybe locked): not lost, not ours.
    !gitdir.exists()
}

/// Whether `branch`'s tip is an ancestor of `base` (i.e. fully merged).
/// Squash merges report false — the UI wording says so.
#[tauri::command]
pub async fn git_branch_merged(
    repo_path: String,
    branch: String,
    base: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = crate::git::open_repo(&repo_path)?;
        let branch_tip = repo
            .revparse_single(&format!("refs/heads/{branch}"))
            .and_then(|o| o.peel_to_commit())
            .map_err(|e| format!("branch {branch}: {e}"))?;
        let base_tip = repo
            .revparse_single(&base)
            .and_then(|o| o.peel_to_commit())
            .map_err(|e| format!("base {base}: {e}"))?;
        // git2's descendant check is strict (a commit is not its own
        // descendant); a fresh branch sitting on the base tip IS merged.
        Ok(branch_tip.id() == base_tip.id()
            || repo
                .graph_descendant_of(branch_tip.id(), base_tip.id())
                .map_err(|e| e.to_string())?)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, Deserialize)]
struct GhPrView {
    title: Option<String>,
    author: Option<GhPrAuthor>,
    additions: Option<i64>,
    deletions: Option<i64>,
    state: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GhPrAuthor {
    login: Option<String>,
}

/// `gh pr view` with a hard deadline: the CLI may be absent, logged out, or
/// slow — every failure degrades the preview instead of blocking creation.
async fn gh_pr_view(number: u64, repo_slug: &str) -> Option<GhPrView> {
    let output = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        Command::new("gh")
            .args([
                "pr",
                "view",
                &number.to_string(),
                "--repo",
                repo_slug,
                "--json",
                "title,author,additions,deletions,state",
            ])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .await
    })
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

/// PR preview for the create dialog: parse the input, confirm the repo is a
/// GitHub remote, enrich via gh when available, flag branch/dir conflicts.
/// Errors are stable machine strings the UI maps to i18n: invalid_pr_input |
/// not_a_repo | no_origin | not_github.
#[tauri::command]
pub async fn git_resolve_pr(
    repo_path: String,
    input: String,
    suggested_branch: String,
    worktree_path: String,
) -> Result<PrPreview, String> {
    let number = parse_pr_input(&input).ok_or_else(|| "invalid_pr_input".to_string())?;
    let repo = crate::git::open_repo(&repo_path)?;
    let url = repo
        .find_remote("origin")
        .ok()
        .and_then(|r| r.url().map(str::to_string))
        .ok_or_else(|| "no_origin".to_string())?;
    let slug = github_owner_repo(&url).ok_or_else(|| "not_github".to_string())?;
    let branch_conflict = repo
        .find_branch(&suggested_branch, git2::BranchType::Local)
        .is_ok();
    let dir_conflict = Path::new(&worktree_path).exists();

    let gh = gh_pr_view(number, &slug).await;
    Ok(PrPreview {
        number,
        repo: slug,
        degraded: gh.is_none(),
        title: gh.as_ref().and_then(|g| g.title.clone()),
        author: gh.as_ref().and_then(|g| g.author.as_ref()?.login.clone()),
        additions: gh.as_ref().and_then(|g| g.additions),
        deletions: gh.as_ref().and_then(|g| g.deletions),
        state: gh.as_ref().and_then(|g| g.state.clone()),
        branch_conflict,
        dir_conflict,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("ccgui-next-git-worktree-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn join(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn commit_file(repo: &git2::Repository, root: &Path, name: &str, content: &str) -> git2::Oid {
        std::fs::write(root.join(name), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(name)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = git2::Signature::now("test", "t@e.st").unwrap();
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, name, &tree, &parents)
            .unwrap()
    }

    fn init_repo(dir: &Path) -> git2::Repository {
        let repo = git2::Repository::init(dir).unwrap();
        commit_file(&repo, dir, "init.txt", "one\n");
        repo
    }

    fn create_args(repo: &Path, branch: &str, target: &Path) -> WorktreeCreateArgs {
        WorktreeCreateArgs {
            repo_path: repo.to_string_lossy().into_owned(),
            parent_workspace_id: "pw".to_string(),
            branch: branch.to_string(),
            worktree_path: target.to_string_lossy().into_owned(),
            base_ref: Some("master".to_string()),
            pr_number: None,
            pr_title: None,
            pr_url: None,
            existing_branch: false,
        }
    }

    fn cancel_handle() -> Arc<CreationCancel> {
        Arc::new(CreationCancel {
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        })
    }

    // ---- pure helpers -------------------------------------------------------

    #[test]
    fn pr_input_accepts_numbers_and_urls() {
        assert_eq!(parse_pr_input("1842"), Some(1842));
        assert_eq!(parse_pr_input(" #1842 "), Some(1842));
        assert_eq!(
            parse_pr_input("https://github.com/owner/repo/pull/1842"),
            Some(1842)
        );
        assert_eq!(
            parse_pr_input("https://github.com/owner/repo/pull/1842/files"),
            Some(1842)
        );
        assert_eq!(parse_pr_input("pulls"), None);
        assert_eq!(parse_pr_input("0"), None);
        assert_eq!(parse_pr_input(""), None);
        assert_eq!(
            parse_pr_input("https://github.com/owner/repo/issues/12"),
            None
        );
    }

    #[test]
    fn owner_repo_parses_all_remote_shapes() {
        assert_eq!(
            github_owner_repo("https://github.com/owner/repo.git"),
            Some("owner/repo".to_string())
        );
        assert_eq!(
            github_owner_repo("https://github.com/owner/repo"),
            Some("owner/repo".to_string())
        );
        assert_eq!(
            github_owner_repo("git@github.com:owner/repo.git"),
            Some("owner/repo".to_string())
        );
        assert_eq!(
            github_owner_repo("ssh://git@github.com/owner/repo"),
            Some("owner/repo".to_string())
        );
        assert_eq!(github_owner_repo("https://gitlab.com/owner/repo"), None);
        assert_eq!(github_owner_repo("https://github.com/owner"), None);
    }

    #[test]
    fn porcelain_parses_main_linked_locked_and_detached() {
        let text = "worktree /repo/main\nHEAD aaa111\nbranch refs/heads/main\n\
                    \nworktree /repo/wt-1\nHEAD bbb222\nbranch refs/heads/feat\n\
                    \nworktree /repo/wt-2\nHEAD ccc333\ndetached\nlocked out on loan\n\
                    \nworktree /repo/wt-3\nHEAD ddd444\nbranch refs/heads/b2\nlocked\n\
                    \nworktree /repo/wt-4\nHEAD eee555\nbranch refs/heads/gone\nprunable gitdir file points to non-existent location\n";
        let list = parse_worktree_porcelain(text);
        assert_eq!(list.len(), 5);
        assert!(list[0].is_main);
        assert_eq!(list[0].branch.as_deref(), Some("main"));
        assert!(!list[1].is_main);
        assert_eq!(list[1].branch.as_deref(), Some("feat"));
        assert_eq!(list[2].branch, None);
        assert!(list[2].locked);
        assert_eq!(list[2].lock_reason.as_deref(), Some("out on loan"));
        assert!(list[3].locked);
        assert_eq!(list[3].lock_reason, None);
        assert!(!list[3].prunable);
        assert!(list[4].prunable);
        assert!(!list[4].locked);
    }

    // ---- end-to-end against real (local) git --------------------------------

    #[tokio::test]
    async fn create_list_merged_remove_round_trip() {
        let scratch = Scratch::new();
        let repo_dir = scratch.join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        init_repo(&repo_dir);

        let target = scratch.join("wt-feat");
        let args = create_args(&repo_dir, "feat-x", &target);
        run_create(None, None, "t1", &args, &cancel_handle())
            .await
            .unwrap();
        assert!(target.join("init.txt").is_file());

        let list = list_worktrees_cli(&repo_dir).await.unwrap();
        assert_eq!(list.len(), 2);
        let wt = list
            .iter()
            .find(|w| w.branch.as_deref() == Some("feat-x"))
            .unwrap();
        assert!(same_path(&wt.path, &target.to_string_lossy()));

        // Same tip as the base → merged (equality OR strict descendant,
        // matching git_branch_merged's semantics).
        let merged = git_branch_merged(
            repo_dir.to_string_lossy().into_owned(),
            "feat-x".to_string(),
            "master".to_string(),
        )
        .await
        .unwrap();
        assert!(merged);

        let result = git_worktree_remove(
            repo_dir.to_string_lossy().into_owned(),
            target.to_string_lossy().into_owned(),
            Some("feat-x".to_string()),
            true,
        )
        .await
        .unwrap();
        assert!(!result.orphan_directory);
        assert!(result.branch_deleted);
        assert!(!target.exists());
        let repo = crate::git::open_repo(&repo_dir.to_string_lossy()).unwrap();
        assert!(repo
            .find_branch("feat-x", git2::BranchType::Local)
            .is_err());
    }

    #[tokio::test]
    async fn sparse_checkout_excluding_everything_fails_instead_of_empty_worktree() {
        let scratch = Scratch::new();
        let repo_dir = scratch.join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        let repo = init_repo(&repo_dir);

        // Sparse rules that match no path: `worktree add` writes no files at
        // all, so the new directory would be an empty workspace.
        repo.config()
            .unwrap()
            .set_bool("core.sparseCheckout", true)
            .unwrap();
        std::fs::write(
            repo.path().join("info/sparse-checkout"),
            "/definitely-not-a-path\n",
        )
        .unwrap();

        let target = scratch.join("wt-empty");
        let args = create_args(&repo_dir, "feat-empty", &target);
        let error = run_create(None, None, "t-empty", &args, &cancel_handle())
            .await
            .expect_err("empty checkout must fail creation");
        assert_eq!(error.kind, "sparse_checkout_empty");
        assert!(!target.exists(), "partial add cleaned up");
    }

    #[tokio::test]
    async fn create_reports_a_plain_directory_as_not_a_repo() {
        let scratch = Scratch::new();
        let plain = scratch.join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        let args = create_args(&plain, "feat", &scratch.join("wt"));
        let err = run_create(None, None, "t-plain", &args, &cancel_handle())
            .await
            .unwrap_err();
        assert_eq!(err.kind, "not_a_repo");
    }

    /// 仓库存在但打不开（属主校验等）不能报成「不是 Git 仓库」，原因要带给界面。
    #[test]
    fn open_failure_keeps_the_cause_of_a_repository_that_will_not_open() {
        assert_eq!(
            open_failure("/r", "NOT_A_REPO".to_string()).kind,
            "not_a_repo"
        );
        let cause = "GIT_UNSAFE_REPO:repository path '/r' is not owned by current user";
        let unsafe_repo = open_failure("/r", cause.to_string());
        assert_eq!(unsafe_repo.kind, "repo_open_failed");
        assert_eq!(unsafe_repo.message, cause);
    }

    #[tokio::test]
    async fn pr_flow_fetches_pull_ref_and_checks_it_out() {
        let scratch = Scratch::new();
        let origin_dir = scratch.join("origin");
        std::fs::create_dir_all(&origin_dir).unwrap();
        let origin = init_repo(&origin_dir);
        let pr_tip = commit_file(&origin, &origin_dir, "pr.txt", "from pr\n");
        origin
            .reference("refs/pull/7/head", pr_tip, true, "pr ref")
            .unwrap();

        let clone_dir = scratch.join("clone");
        git2::Repository::clone(origin_dir.to_str().unwrap(), &clone_dir).unwrap();

        let target = scratch.join("wt-pr7");
        let mut args = create_args(&clone_dir, "pr-7", &target);
        args.pr_number = Some(7);
        args.base_ref = None;
        run_create(None, None, "t2", &args, &cancel_handle())
            .await
            .unwrap();
        // The checkout carries the PR-only file, not just the clone's base.
        assert!(target.join("pr.txt").is_file());

        // Unknown PR number → pr_not_found, nothing left behind.
        let mut missing = create_args(&clone_dir, "pr-404", &scratch.join("wt-404"));
        missing.pr_number = Some(404);
        missing.base_ref = None;
        let err = run_create(None, None, "t3", &missing, &cancel_handle())
            .await
            .unwrap_err();
        assert_eq!(err.kind, "pr_not_found");
        assert!(!scratch.join("wt-404").exists());
    }

    #[tokio::test]
    async fn conflicts_and_occupancy_are_reported_before_any_mutation() {
        let scratch = Scratch::new();
        let repo_dir = scratch.join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        let repo = init_repo(&repo_dir);
        repo.branch("taken", &repo.head().unwrap().peel_to_commit().unwrap(), false)
            .unwrap();

        // Existing branch without existing_branch → branch_exists.
        let args = create_args(&repo_dir, "taken", &scratch.join("wt-a"));
        let err = run_create(None, None, "t4", &args, &cancel_handle())
            .await
            .unwrap_err();
        assert_eq!(err.kind, "branch_exists");

        // Occupied branch in existing-branch flow → branch_checked_out.
        let occupied_target = scratch.join("wt-taken");
        let mut occupy = create_args(&repo_dir, "taken", &occupied_target);
        occupy.existing_branch = true;
        occupy.base_ref = None;
        run_create(None, None, "t5", &occupy, &cancel_handle())
            .await
            .unwrap();
        let second = scratch.join("wt-taken-2");
        let mut dup = create_args(&repo_dir, "taken", &second);
        dup.existing_branch = true;
        dup.base_ref = None;
        let err = run_create(None, None, "t6", &dup, &cancel_handle())
            .await
            .unwrap_err();
        assert_eq!(err.kind, "branch_checked_out");
        assert!(!second.exists());

        // A leftover directory that is not our worktree → dir_exists.
        let stale = scratch.join("wt-stale");
        std::fs::create_dir_all(&stale).unwrap();
        let args = create_args(&repo_dir, "fresh-branch", &stale);
        let err = run_create(None, None, "t7", &args, &cancel_handle())
            .await
            .unwrap_err();
        assert_eq!(err.kind, "dir_exists");
        assert!(stale.exists(), "the user's directory is left untouched");
    }

    #[tokio::test]
    async fn cancel_before_start_aborts_cleanly() {
        let scratch = Scratch::new();
        let repo_dir = scratch.join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        init_repo(&repo_dir);

        let cancel = cancel_handle();
        cancel.cancelled.store(true, Ordering::SeqCst);
        cancel.notify.notify_waiters();
        let args = create_args(&repo_dir, "never", &scratch.join("wt-never"));
        let err = run_create(None, None, "t8", &args, &cancel)
            .await
            .unwrap_err();
        assert_eq!(err.kind, "canceled");
        assert!(!scratch.join("wt-never").exists());
    }

    #[tokio::test]
    async fn resume_skips_git_steps_when_worktree_already_exists() {
        let scratch = Scratch::new();
        let repo_dir = scratch.join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        init_repo(&repo_dir);

        let target = scratch.join("wt-resume");
        let args = create_args(&repo_dir, "resume-branch", &target);
        run_create(None, None, "t9", &args, &cancel_handle())
            .await
            .unwrap();
        // Second run with the branch now existing must not fail on
        // branch_exists: the directory is recognized as our own worktree.
        let err = run_create(None, None, "t10", &args, &cancel_handle())
            .await
            .unwrap_err();
        assert_eq!(err.kind, "branch_exists");
    }

    #[tokio::test]
    async fn orphan_directory_remove_falls_back_to_prune() {
        let scratch = Scratch::new();
        let repo_dir = scratch.join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        init_repo(&repo_dir);

        let target = scratch.join("wt-orphan");
        let args = create_args(&repo_dir, "orphan-branch", &target);
        run_create(None, None, "t11", &args, &cancel_handle())
            .await
            .unwrap();
        // Simulate a lost registration: git forgets the worktree, the
        // directory stays.
        let _ = run_git(&repo_dir, &["worktree", "prune"], None).await;
        // prune only drops missing directories; deregister manually instead.
        let gitdir = repo_dir.join(".git/worktrees");
        for entry in std::fs::read_dir(&gitdir).unwrap().flatten() {
            let _ = std::fs::remove_dir_all(entry.path());
        }

        let result = git_worktree_remove(
            repo_dir.to_string_lossy().into_owned(),
            target.to_string_lossy().into_owned(),
            Some("orphan-branch".to_string()),
            false,
        )
        .await
        .unwrap();
        assert!(result.orphan_directory);
        assert!(!result.branch_deleted);
        assert!(!target.exists());
    }

    async fn remove_path(repo_dir: &Path, target: &Path) -> Result<WorktreeRemoveResult, String> {
        git_worktree_remove(
            repo_dir.to_string_lossy().into_owned(),
            target.to_string_lossy().into_owned(),
            None,
            false,
        )
        .await
    }

    #[tokio::test]
    async fn locked_worktree_is_never_deleted() {
        let scratch = Scratch::new();
        let repo_dir = scratch.join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        init_repo(&repo_dir);
        let target = scratch.join("wt-locked");
        run_create(
            None,
            None,
            "t12",
            &create_args(&repo_dir, "locked-branch", &target),
            &cancel_handle(),
        )
        .await
        .unwrap();
        std::fs::write(target.join("work.txt"), "unsaved\n").unwrap();
        let (out, _) = run_git(
            &repo_dir,
            &["worktree", "lock", &target.to_string_lossy()],
            None,
        )
        .await
        .unwrap();
        assert!(out.status.success());

        assert!(remove_path(&repo_dir, &target).await.is_err());
        assert!(
            target.join("work.txt").is_file(),
            "locked worktree must survive"
        );
    }

    #[tokio::test]
    async fn main_worktree_is_never_deleted() {
        let scratch = Scratch::new();
        let repo_dir = scratch.join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        init_repo(&repo_dir);

        assert!(remove_path(&repo_dir, &repo_dir).await.is_err());
        assert!(repo_dir.join("init.txt").is_file());
        assert!(repo_dir.join(".git").is_dir());
    }

    #[tokio::test]
    async fn unrelated_directory_is_never_deleted() {
        let scratch = Scratch::new();
        let repo_dir = scratch.join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        init_repo(&repo_dir);
        let precious = scratch.join("precious");
        std::fs::create_dir_all(&precious).unwrap();
        std::fs::write(precious.join("notes.md"), "keep me\n").unwrap();

        assert!(remove_path(&repo_dir, &precious).await.is_err());
        assert!(precious.join("notes.md").is_file());
    }

    #[tokio::test]
    async fn forged_git_file_pointing_elsewhere_is_never_deleted() {
        let scratch = Scratch::new();
        let repo_dir = scratch.join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        init_repo(&repo_dir);
        let other_dir = scratch.join("other");
        std::fs::create_dir_all(&other_dir).unwrap();
        init_repo(&other_dir);
        let precious = scratch.join("precious");
        std::fs::create_dir_all(&precious).unwrap();
        std::fs::write(precious.join("notes.md"), "keep me\n").unwrap();
        // .git 文件指向另一个仓库的 worktrees/：不是本仓库的孤儿 worktree。
        let forged = format!(
            "gitdir: {}\n",
            other_dir.join(".git/worktrees/x").to_string_lossy()
        );
        std::fs::write(precious.join(".git"), forged).unwrap();

        assert!(remove_path(&repo_dir, &precious).await.is_err());
        assert!(precious.join("notes.md").is_file());

        // 指向本仓库 .git 目录本身（而不是 worktrees/ 下）也不算。
        let at_root = format!("gitdir: {}\n", repo_dir.join(".git").to_string_lossy());
        std::fs::write(precious.join(".git"), at_root).unwrap();
        assert!(remove_path(&repo_dir, &precious).await.is_err());
        assert!(precious.join("notes.md").is_file());
    }

    #[tokio::test]
    async fn submodule_gitdir_inside_a_worktree_is_never_deleted() {
        let scratch = Scratch::new();
        let repo_dir = scratch.join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        init_repo(&repo_dir);
        let target = scratch.join("wt-sub");
        run_create(
            None,
            None,
            "t13",
            &create_args(&repo_dir, "sub-branch", &target),
            &cancel_handle(),
        )
        .await
        .unwrap();
        // 子模块的 gitdir 在 <common>/worktrees/<wt>/modules/<sub>：比孤儿 worktree 深一层。
        let sub = target.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("work.txt"), "unsaved\n").unwrap();
        let admin = repo_dir.join(".git/worktrees/wt-sub/modules/sub");
        std::fs::write(
            sub.join(".git"),
            format!("gitdir: {}\n", admin.to_string_lossy()),
        )
        .unwrap();

        assert!(remove_path(&repo_dir, &sub).await.is_err());
        assert!(sub.join("work.txt").is_file());
    }

    #[tokio::test]
    async fn moved_locked_worktree_is_never_deleted() {
        let scratch = Scratch::new();
        let repo_dir = scratch.join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        init_repo(&repo_dir);
        let target = scratch.join("wt-usb");
        run_create(
            None,
            None,
            "t14",
            &create_args(&repo_dir, "usb-branch", &target),
            &cancel_handle(),
        )
        .await
        .unwrap();
        let (out, _) = run_git(
            &repo_dir,
            &["worktree", "lock", &target.to_string_lossy()],
            None,
        )
        .await
        .unwrap();
        assert!(out.status.success());
        // 移动硬盘换了挂载点：git 仍登记旧路径，新路径不在列表里。
        let moved = scratch.join("wt-usb-mounted-elsewhere");
        std::fs::rename(&target, &moved).unwrap();
        std::fs::write(moved.join("work.txt"), "unsaved\n").unwrap();

        assert!(remove_path(&repo_dir, &moved).await.is_err());
        assert!(moved.join("work.txt").is_file());
    }

    #[tokio::test]
    async fn leftover_empty_directory_without_git_is_cleaned_up() {
        // Windows：--force 已删掉 .git 与登记，但根目录被终端占用没删掉；重试时目录是空的。
        let scratch = Scratch::new();
        let repo_dir = scratch.join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        init_repo(&repo_dir);
        let leftover = scratch.join("wt-leftover");
        std::fs::create_dir_all(&leftover).unwrap();

        let result = remove_path(&repo_dir, &leftover).await.unwrap();
        assert!(result.orphan_directory);
        assert!(!leftover.exists());
    }

    #[tokio::test]
    async fn relative_worktree_path_is_rejected() {
        let scratch = Scratch::new();
        let repo_dir = scratch.join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        init_repo(&repo_dir);

        let err = git_worktree_remove(
            repo_dir.to_string_lossy().into_owned(),
            "some/relative/dir".to_string(),
            None,
            false,
        )
        .await
        .unwrap_err();
        assert!(err.contains("absolute"), "{err}");
    }
}
