import { useState } from "react";
import { useTranslation } from "react-i18next";
import FolderGit2 from "lucide-react/dist/esm/icons/folder-git-2";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { cx } from "@/utils/cx";
import { useGitStore } from "./store";

/** Trailing folder name of a repository path, on either path separator. */
export function repoDisplayName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Per-repository change counts shown in the section header: live status once
 *  it lands, the discovery summary before that, undefined while both are
 *  still in flight. */
function useRepoCounts(repoPath: string) {
  const status = useGitStore((s) => s.statusByWorkspace[repoPath]);
  const summary = useGitStore((s) => {
    const status_ = s.statusByWorkspace[repoPath];
    if (status_) return undefined;
    for (const list of Object.values(s.reposByWorkspace)) {
      const hit = list?.find((repo) => repo.path === repoPath);
      if (hit) return hit;
    }
    return undefined;
  });
  if (!status && !summary) return undefined;
  const changed = status
    ? status.staged.length + status.unstaged.length
    : (summary?.changed ?? 0);
  const untracked = status ? status.untracked.length : (summary?.untracked ?? 0);
  return {
    changed,
    untracked,
    total: changed + untracked,
    branch: status?.branch ?? summary?.branch ?? "",
  };
}

/**
 * One repository's block in the multi-project changes view: name, branch,
 * ahead/behind and change counts, folding that repository's whole panel
 * (groups + commit box) in and out. Repositories with nothing changed stay
 * visible and open too — a clean branch is information, and a list that
 * shrinks is what makes users hunt for where a project went. Only an
 * explicit toggle folds a section.
 *
 * `defaultOpen` is a hint, not a rule: the effective open flag folds the
 * user's own collapse over the hint, so an explicit toggle always wins.
 */
export function RepoSection({
  repoPath,
  defaultOpen = true,
  children,
}: {
  repoPath: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const branch = useGitStore((s) => s.statusByWorkspace[repoPath]?.branch);
  const ahead = useGitStore((s) => s.statusByWorkspace[repoPath]?.ahead);
  const behind = useGitStore((s) => s.statusByWorkspace[repoPath]?.behind);
  const counts = useRepoCounts(repoPath);
  const dirty = counts !== undefined && counts.total > 0;
  const open = userOpen ?? (defaultOpen || dirty);
  return (
    <section className="border-b border-separator-border last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
        className="flex w-full items-center gap-1.5 bg-background-secondary-default px-3 py-2 text-left hover:bg-background-secondary-hover"
      >
        {open ? (
          <ChevronDown aria-hidden className="size-4 shrink-0 text-foreground-icon-tertiary" />
        ) : (
          <ChevronRight aria-hidden className="size-4 shrink-0 text-foreground-icon-tertiary" />
        )}
        <FolderGit2 aria-hidden className="size-4 shrink-0 text-foreground-icon-secondary" />
        <span className="min-w-0 truncate text-body-medium text-text-primary">
          {repoDisplayName(repoPath)}
        </span>
        <span className="min-w-0 truncate text-caption-1-regular text-text-tertiary">
          {branch ?? counts?.branch ?? ""}
        </span>
        {ahead !== undefined && behind !== undefined && (ahead > 0 || behind > 0) && (
          <span className="shrink-0 text-caption-1-regular text-text-tertiary">
            ↑{ahead} ↓{behind}
          </span>
        )}
        <span
          className={cx(
            "ml-auto shrink-0 text-xs tabular-nums",
            dirty ? "text-status-yellow-text" : "text-state-success-text",
          )}
        >
          {counts === undefined ? (
            "…"
          ) : dirty ? (
            <span className="flex items-center gap-1.5">
              <span className="text-status-yellow-text">M{counts.changed}</span>
              <span className="text-state-success-text">U{counts.untracked}</span>
            </span>
          ) : (
            t("git.clean")
          )}
        </span>
      </button>
      {open && <div className="flex flex-col">{children}</div>}
    </section>
  );
}
