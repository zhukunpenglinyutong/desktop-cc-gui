import { useState } from "react";
import { useTranslation } from "react-i18next";
import FolderGit2 from "lucide-react/dist/esm/icons/folder-git-2";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { cx } from "@/utils/cx";
import { Collapsible } from "@/components/application/collapsible/collapsible";
import { useGitStore } from "./store";

/** Trailing folder name of a repository path, on either path separator. */
export function repoDisplayName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Use the newest successful snapshot, scoped to this workspace's scan. */
function useRepoCounts(workspacePath: string, repoPath: string) {
  const status = useGitStore((s) => s.statusByWorkspace[repoPath]);
  const summary = useGitStore((s) => s.reposByWorkspace[workspacePath]?.find((repo) => repo.path === repoPath));
  const statusRevision = useGitStore((s) => s.statusRevisionByWorkspace[repoPath] ?? 0);
  const summaryRevision = useGitStore((s) => s.reposRevisionByWorkspace[workspacePath] ?? 0);
  if (!status && !summary) return undefined;
  const currentStatus = status && (!summary || statusRevision >= summaryRevision) ? status : undefined;
  const changed = currentStatus
    ? currentStatus.staged.length + currentStatus.unstaged.length
    : (summary?.changed ?? 0);
  const untracked = currentStatus ? currentStatus.untracked.length : (summary?.untracked ?? 0);
  return {
    changed,
    untracked,
    total: changed + untracked,
    branch: currentStatus?.branch ?? summary?.branch ?? "",
    ahead: currentStatus?.ahead,
    behind: currentStatus?.behind,
  };
}

/**
 * One repository's block in the multi-project changes view: name, branch,
 * ahead/behind and change counts, folding that repository's whole panel
 * (groups + commit box) in and out. The panel mounts on first expansion and
 * stays mounted to preserve drafts and pending actions. The
 * caller picks `defaultOpen` to keep clean projects folded instead of
 * firing one status walk per project on first open. A repository with
 * changes opens itself regardless of the hint, and a folded section stays
 * listed: a clean branch is information, and a list that shrinks is what
 * makes users hunt for where a project went.
 *
 * `defaultOpen` is a hint, not a rule: the effective open flag folds the
 * user's own collapse over the hint, so an explicit toggle always wins.
 */
export function RepoSection({
  workspacePath,
  repoPath,
  defaultOpen = true,
  children,
}: {
  workspacePath: string;
  repoPath: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const counts = useRepoCounts(workspacePath, repoPath);
  const ahead = counts?.ahead;
  const behind = counts?.behind;
  const dirty = counts !== undefined && counts.total > 0;
  const open = userOpen ?? (defaultOpen || dirty);
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
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
          {counts?.branch ?? ""}
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
      <div aria-hidden={!open} {...(!open ? { inert: "" } : {})}>
        <Collapsible open={open} seconds={0.2} className="motion-reduce:!transition-none">
          {mounted ? <div className="flex flex-col">{children}</div> : null}
        </Collapsible>
      </div>
    </section>
  );
}
