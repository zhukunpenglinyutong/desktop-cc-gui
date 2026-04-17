#!/usr/bin/env python3
"""
Developer management utilities.

Provides:
    init_developer     - Initialize developer
    ensure_developer   - Ensure developer is initialized (exit if not)
    show_developer_info - Show developer information
"""

from __future__ import annotations

import os
import re
import sys
from datetime import datetime
from pathlib import Path

from .git import run_git
from .paths import (
    DIR_WORKFLOW,
    DIR_WORKSPACE,
    DIR_TASKS,
    FILE_DEVELOPER,
    FILE_JOURNAL_PREFIX,
    get_repo_root,
    get_developer,
    check_developer,
)


# =============================================================================
# Developer Initialization
# =============================================================================

def normalize_developer_name(name: str) -> str:
    """Normalize a human/git identity into a stable developer id."""
    normalized = re.sub(r"[^a-z0-9]+", "-", name.strip().lower())
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    return normalized


def _iter_workspace_names(repo_root: Path) -> list[str]:
    workspace_root = repo_root / DIR_WORKFLOW / DIR_WORKSPACE
    if not workspace_root.is_dir():
        return []
    return sorted(entry.name for entry in workspace_root.iterdir() if entry.is_dir())


def infer_developer_name(repo_root: Path | None = None) -> str | None:
    """Infer developer id from stable local signals."""
    if repo_root is None:
        repo_root = get_repo_root()

    existing = get_developer(repo_root)
    if existing:
        return existing

    workspace_names = _iter_workspace_names(repo_root)
    normalized_workspace = {
        normalize_developer_name(name): name for name in workspace_names
    }

    def _match_candidate(raw_value: str | None) -> str | None:
        if not raw_value:
            return None
        candidate = raw_value.strip()
        if not candidate:
            return None
        if candidate in workspace_names:
            return candidate
        normalized = normalize_developer_name(candidate)
        if not normalized:
            return None
        if normalized in normalized_workspace:
            return normalized_workspace[normalized]
        return normalized

    env_candidate = _match_candidate(os.getenv("TRELLIS_DEVELOPER"))
    if env_candidate:
        return env_candidate

    git_name_code, git_name_out, _ = run_git(
        ["config", "--get", "user.name"],
        cwd=repo_root,
    )
    if git_name_code == 0:
        git_name_candidate = _match_candidate(git_name_out)
        if git_name_candidate:
            return git_name_candidate

    git_email_code, git_email_out, _ = run_git(
        ["config", "--get", "user.email"],
        cwd=repo_root,
    )
    if git_email_code == 0:
        local_part = git_email_out.strip().split("@", 1)[0]
        git_email_candidate = _match_candidate(local_part)
        if git_email_candidate:
            return git_email_candidate

    if len(workspace_names) == 1:
        return workspace_names[0]

    return None


def ensure_developer_initialized(repo_root: Path | None = None) -> str | None:
    """Return current developer, auto-initializing `.trellis/.developer` when safe."""
    if repo_root is None:
        repo_root = get_repo_root()

    existing = get_developer(repo_root)
    if existing:
        return existing

    inferred = infer_developer_name(repo_root)
    if not inferred:
        return None

    if init_developer(inferred, repo_root):
        return inferred

    return get_developer(repo_root)

def init_developer(name: str, repo_root: Path | None = None) -> bool:
    """Initialize developer.

    Creates:
        - .trellis/.developer file with developer info
        - .trellis/workspace/<name>/ directory structure
        - Initial journal file and index.md

    Args:
        name: Developer name.
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        True on success, False on error.
    """
    if not name:
        print("Error: developer name is required", file=sys.stderr)
        return False

    if repo_root is None:
        repo_root = get_repo_root()

    dev_file = repo_root / DIR_WORKFLOW / FILE_DEVELOPER
    workspace_dir = repo_root / DIR_WORKFLOW / DIR_WORKSPACE / name

    # Create .developer file
    initialized_at = datetime.now().isoformat()
    try:
        dev_file.write_text(
            f"name={name}\ninitialized_at={initialized_at}\n",
            encoding="utf-8"
        )
    except (OSError, IOError) as e:
        print(f"Error: Failed to create .developer file: {e}", file=sys.stderr)
        return False

    # Create workspace directory structure
    try:
        workspace_dir.mkdir(parents=True, exist_ok=True)
    except (OSError, IOError) as e:
        print(f"Error: Failed to create workspace directory: {e}", file=sys.stderr)
        return False

    # Create initial journal file
    journal_file = workspace_dir / f"{FILE_JOURNAL_PREFIX}1.md"
    if not journal_file.exists():
        today = datetime.now().strftime("%Y-%m-%d")
        journal_content = f"""# Journal - {name} (Part 1)

> AI development session journal
> Started: {today}

---

"""
        try:
            journal_file.write_text(journal_content, encoding="utf-8")
        except (OSError, IOError) as e:
            print(f"Error: Failed to create journal file: {e}", file=sys.stderr)
            return False

    # Create index.md with markers for auto-update
    index_file = workspace_dir / "index.md"
    if not index_file.exists():
        index_content = f"""# Workspace Index - {name}

> Journal tracking for AI development sessions.

---

## Current Status

<!-- @@@auto:current-status -->
- **Active File**: `journal-1.md`
- **Total Sessions**: 0
- **Last Active**: -
<!-- @@@/auto:current-status -->

---

## Active Documents

<!-- @@@auto:active-documents -->
| File | Lines | Status |
|------|-------|--------|
| `journal-1.md` | ~0 | Active |
<!-- @@@/auto:active-documents -->

---

## Session History

<!-- @@@auto:session-history -->
| # | Date | Title | Commits | Branch |
|---|------|-------|---------|--------|
<!-- @@@/auto:session-history -->

---

## Notes

- Sessions are appended to journal files
- New journal file created when current exceeds 2000 lines
- Use `add_session.py` to record sessions
"""
        try:
            index_file.write_text(index_content, encoding="utf-8")
        except (OSError, IOError) as e:
            print(f"Error: Failed to create index.md: {e}", file=sys.stderr)
            return False

    print(f"Developer initialized: {name}")
    print(f"  .developer file: {dev_file}")
    print(f"  Workspace dir: {workspace_dir}")

    return True


def ensure_developer(repo_root: Path | None = None) -> None:
    """Ensure developer is initialized, exit if not.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    if not ensure_developer_initialized(repo_root):
        print("Error: Developer not initialized.", file=sys.stderr)
        print(f"Run: python3 ./{DIR_WORKFLOW}/scripts/init_developer.py <your-name>", file=sys.stderr)
        sys.exit(1)


def show_developer_info(repo_root: Path | None = None) -> None:
    """Show developer information.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    developer = get_developer(repo_root)

    if not developer:
        print("Developer: (not initialized)")
    else:
        print(f"Developer: {developer}")
        print(f"Workspace: {DIR_WORKFLOW}/{DIR_WORKSPACE}/{developer}/")
        print(f"Tasks: {DIR_WORKFLOW}/{DIR_TASKS}/")


# =============================================================================
# Main Entry (for testing)
# =============================================================================

if __name__ == "__main__":
    show_developer_info()
