import { memo, useCallback, useMemo, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import Link2 from "lucide-react/dist/esm/icons/link-2";
import Plus from "lucide-react/dist/esm/icons/plus";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Unlink2 from "lucide-react/dist/esm/icons/unlink-2";
import { ActionFeedbackIcon, useRunningFeedback } from "@/components/base/action-feedback";
import { cx } from "@/utils/cx";
import type { DirEntry, FileTreeColor, RepositorySummary } from "@/lib/ipc";
import { getFileTreeIconSvg } from "./fileIcons";
import { useFilesStore } from "./store";

export interface VisibleNode extends DirEntry {
  path: string;
  depth: number;
  expanded: boolean;
  loading: boolean;
  /** Compact git status when this directory is itself a repo root. */
  repository?: RepositorySummary;
  /** Git-state name color: file states + blue for repo-root rows. */
  color?: FileTreeColor;
}

/** Tooltip/aria text for a repo badge: `branch ✓` or `branch M<n> ?<n>`. */
function repositoryLabel(repo: RepositorySummary): string {
  return repo.changed + repo.untracked === 0
    ? `${repo.branch} ✓`
    : `${repo.branch}${repo.changed > 0 ? ` M${repo.changed}` : ""}${repo.untracked > 0 ? ` ?${repo.untracked}` : ""}`;
}

/** Root-row hover action: re-read the whole tree from disk. Feedback is
 *  store-driven (not click-driven): a refresh can be started by a git action
 *  or a directory-error retry too, and this button must spin for those. Rows
 *  re-render on every store update, so the subscription lives in this small
 *  child that only the root row mounts. */
function TreeRootRefreshButton() {
  const { t } = useTranslation();
  const refreshing = useFilesStore((s) => s.refreshing);
  const feedback = useRunningFeedback(refreshing);
  return (
    <button
      type="button"
      aria-label={t("common.refresh")}
      title={t("common.refresh")}
      disabled={refreshing}
      onClick={(e) => {
        e.stopPropagation();
        void useFilesStore.getState().refreshTree();
      }}
      className="hidden size-5 shrink-0 cursor-pointer items-center justify-center rounded text-foreground-icon-tertiary hover:bg-background-primary-active hover:text-text-primary group-hover:flex focus-visible:flex disabled:opacity-50"
    >
      <ActionFeedbackIcon
        icon={RefreshCw}
        feedback={feedback}
        iconClassName="size-3.5"
        spin
      />
    </button>
  );
}

interface TreeRowProps {
  node: VisibleNode;
  selected: boolean;
  /** Workspace-root row: carries the tree-wide refresh (hover-revealed). */
  isRoot: boolean;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onSelectDir: (path: string) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>, node: VisibleNode) => void;
  /** Hover "+": stage an @path mention in the active chat's composer. */
  onMention: (path: string) => void;
  mentionLabel: string;
}

export const TreeRow = memo(function TreeRow({
  node,
  selected,
  isRoot,
  onToggleDir,
  onOpenFile,
  onSelectDir,
  onContextMenu,
  onMention,
  mentionLabel,
}: TreeRowProps) {
  const { t } = useTranslation();
  const handleClick = useCallback(() => {
    // A dangling link has no target to open or expand — do nothing (the
    // "target missing" badge already explains why).
    if (node.linkBroken) return;
    if (node.isDir) {
      onSelectDir(node.path);
      onToggleDir(node.path);
    } else {
      onOpenFile(node.path);
    }
  }, [node.isDir, node.linkBroken, node.path, onToggleDir, onOpenFile, onSelectDir]);

  // Icon SVGs are static string constants; selection is a map/set lookup.
  const iconSvg = useMemo(
    () => getFileTreeIconSvg(node.name, node.isDir, node.expanded),
    [node.name, node.isDir, node.expanded],
  );

  return (
    <div
      onContextMenu={(e) => onContextMenu(e, node)}
      className={cx(
        "group flex h-7 w-full items-center rounded-md pr-1 text-body-medium",
        "hover:bg-background-primary-hover",
        selected
          ? "bg-background-primary-active text-text-primary"
          : "text-text-primary",
      )}
      style={{ paddingLeft: 14 + node.depth * 14 }}
    >
      <button
        type="button"
        onClick={handleClick}
        className="flex min-w-0 flex-1 items-center gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        title={node.path}
      >
        {node.loading ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-foreground-icon-tertiary" aria-hidden />
        ) : (
          <span
            className={cx(
              "size-4 shrink-0 [&>svg]:size-4",
              node.isDir
                ? "text-foreground-icon-secondary"
                : "text-foreground-icon-tertiary",
            )}
            aria-hidden
            dangerouslySetInnerHTML={{ __html: iconSvg }}
          />
        )}
        <span
          className={cx(
            // The folder/file name has display priority: it keeps its
            // natural width (truncating only when it alone overflows the
            // row), so the badge below yields space instead.
            "min-w-0 max-w-full shrink-0 truncate",
            // Spec: untracked files → green, modified files → orange, and
            // repo-root rows (workspace repo root + nested repos) → blue.
            // Plain folders never carry color.
            node.color === "untracked" && "text-status-green-text",
            node.color === "modified" && "text-text-warning-primary",
            node.color === "repository" && "text-status-blue-text",
          )}
        >
          {node.name}
        </span>
        {node.isLink ? (
          // Minimal link badge: a link icon (tooltip = real target), or a
          // struck-through icon with a "target missing" label for a dangling
          // link. `isLink`/`linkBroken` come from `list_dir`.
          <span
            className={cx(
              "ml-1.5 flex shrink-0 items-center gap-0.5 text-caption-1-medium",
              node.linkBroken ? "text-text-warning-primary" : "text-foreground-icon-tertiary",
            )}
            title={node.linkBroken ? t("files.linkBroken") : node.linkTarget ?? t("files.linkBadge")}
          >
            {node.linkBroken ? (
              <>
                <Unlink2 className="size-3" aria-hidden />
                <span>{t("files.linkBroken")}</span>
              </>
            ) : (
              <Link2 className="size-3" aria-hidden />
            )}
          </span>
        ) : null}
        {node.repository ? (
          <span
            className={cx(
              // The branch badge takes what's left; the branch name
              // truncates with an ellipsis (full text in the title tip) —
              // no horizontal scrolling, ever.
              "ml-2 flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-caption-1-medium",
              node.repository.changed + node.repository.untracked === 0
                ? "text-state-success-text"
                : "text-status-yellow-text",
            )}
            title={repositoryLabel(node.repository)}
            aria-label={repositoryLabel(node.repository)}
          >
            <span className="min-w-0 flex-1 truncate">{node.repository.branch}</span>
            {node.repository.changed + node.repository.untracked === 0 ? (
              <span className="shrink-0" aria-hidden>✓</span>
            ) : (
              <>
                {node.repository.changed > 0 && (
                  <span className="shrink-0 text-text-warning-primary" aria-hidden>M{node.repository.changed}</span>
                )}
                {node.repository.untracked > 0 && (
                  <span className="shrink-0 text-status-green-text" aria-hidden>?{node.repository.untracked}</span>
                )}
              </>
            )}
          </span>
        ) : null}
      </button>
      {isRoot && <TreeRootRefreshButton />}
      <button
        type="button"
        aria-label={mentionLabel}
        title={mentionLabel}
        onClick={(e) => {
          e.stopPropagation();
          onMention(node.path);
        }}
        className="ml-auto hidden size-5 shrink-0 cursor-pointer items-center justify-center rounded text-foreground-icon-tertiary hover:bg-background-primary-active hover:text-text-primary group-hover:flex focus-visible:flex"
      >
        <Plus className="size-3.5" aria-hidden />
      </button>
    </div>
  );
});
