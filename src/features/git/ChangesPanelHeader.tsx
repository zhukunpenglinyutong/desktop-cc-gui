import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Plus from "lucide-react/dist/esm/icons/plus";
import Search from "lucide-react/dist/esm/icons/search";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import CloudDownload from "lucide-react/dist/esm/icons/cloud-download";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import CloudUpload from "lucide-react/dist/esm/icons/cloud-upload";
import FolderTree from "lucide-react/dist/esm/icons/folder-tree";
import List from "lucide-react/dist/esm/icons/list";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { Button } from "@/components/base/buttons/button";
import { IconButton } from "@/components/base/buttons/icon-button";
import {
  Dropdown,
  DropdownDivider,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from "@/components/base/dropdown/dropdown";
import { type BranchInfo } from "@/lib/ipc";
import { cx } from "@/utils/cx";
import { useGitStore } from "./store";

interface ChangesPanelHeaderProps {
  workspacePath: string;
  /** Set when the panel follows the file tree's selection into a repository
   *  other than the workspace root: rendered as a badge so the user can see
   *  which repo stage/commit/pull/push will act on. */
  followedRepoPath?: string;
  notRepo: boolean;
  branch: string | undefined;
  /** Commits ahead of / behind the upstream; undefined hides the indicator. */
  ahead: number | undefined;
  behind: number | undefined;
  branches: BranchInfo[] | undefined;
  pending: Record<string, true>;
  /** First error to surface: a failed action, else the last refresh failure. */
  error: string | null;
  run: (key: string, action: () => Promise<unknown>) => void;
  onDismissError: () => void;
  viewMode?: "flat" | "tree";
  onToggleViewMode?: () => void;
}

/** Title row with refresh/pull/push, the branch picker, and the new-branch form. */
export function ChangesPanelHeader({
  workspacePath,
  followedRepoPath,
  notRepo,
  branch,
  ahead,
  behind,
  branches,
  pending,
  error,
  run,
  onDismissError,
  viewMode,
  onToggleViewMode,
}: ChangesPanelHeaderProps) {
  const { t } = useTranslation();
  const [branchOpen, setBranchOpen] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  // Spin → check → idle click feedback for refresh; check flash only for
  // pull/push (a spinning cloud reads as a glitch, not progress).
  const refreshAction = useActionFeedback({ spin: true });
  const pullAction = useActionFeedback();
  const pushAction = useActionFeedback();

  const handleRefresh = () => {
    if (refreshAction.feedback === "running") return;
    run("refresh", () =>
      // refresh() reports failure through store state instead of throwing.
      refreshAction.start(
        () => useGitStore.getState().refresh(workspacePath, true),
        () => {
          const state = useGitStore.getState();
          return (
            state.errorByWorkspace[workspacePath] != null ||
            state.notRepoByWorkspace[workspacePath] === true
          );
        },
      ),
    );
  };

  // Stale filter text must not survive into the next open.
  useEffect(() => {
    if (!branchOpen) setBranchQuery("");
  }, [branchOpen]);

  const filteredBranches = useMemo(() => {
    const q = branchQuery.trim().toLowerCase();
    return (branches ?? []).filter(
      (b) => q.length === 0 || b.name.toLowerCase().includes(q),
    );
  }, [branches, branchQuery]);

  return (
    <div className="flex flex-col gap-2 border-b border-separator-border px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-body-medium text-text-primary">{t("git.changes")}</span>
        {followedRepoPath && (
          <span
            className="max-w-32 truncate rounded-md bg-background-secondary-default px-1.5 py-0.5 text-caption-1-regular text-text-tertiary"
            title={followedRepoPath}
          >
            {followedRepoPath.split(/[\\/]/).filter(Boolean).at(-1) ?? followedRepoPath}
          </span>
        )}
        {ahead !== undefined && behind !== undefined && (
          <span className="text-xs text-text-tertiary">
            ↑{ahead} ↓{behind}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {onToggleViewMode && (
            <IconButton
              icon={viewMode === "tree" ? List : FolderTree}
              size="small"
              aria-label={viewMode === "tree" ? t("git.viewAsList") : t("git.viewAsTree")}
              title={viewMode === "tree" ? t("git.viewAsList") : t("git.viewAsTree")}
              onClick={onToggleViewMode}
            />
          )}
          <IconButton
            icon={RefreshCw}
            size="small"
            aria-label={t("common.refresh")}
            title={t("common.refresh")}
            disabled={pending.refresh === true}
            onClick={handleRefresh}
          >
            <ActionFeedbackIcon
              icon={RefreshCw}
              feedback={refreshAction.feedback}
              spin
            />
          </IconButton>
          <IconButton
            icon={CloudDownload}
            size="small"
            aria-label={t("git.pull")}
            title={t("git.pull")}
            disabled={notRepo || pending.pull === true}
            onClick={() =>
              run("pull", () =>
                pullAction.start(() => useGitStore.getState().pull(workspacePath)),
              )
            }
          >
            <ActionFeedbackIcon icon={CloudDownload} feedback={pullAction.feedback} />
          </IconButton>
          <IconButton
            icon={CloudUpload}
            size="small"
            aria-label={t("git.push")}
            title={t("git.push")}
            disabled={notRepo || pending.push === true}
            onClick={() =>
              run("push", () =>
                pushAction.start(() => useGitStore.getState().push(workspacePath)),
              )
            }
          >
            <ActionFeedbackIcon icon={CloudUpload} feedback={pushAction.feedback} />
          </IconButton>
        </div>
      </div>
      {!notRepo && (
        <div className="flex items-center gap-1">
          <Dropdown
            isOpen={branchOpen}
            onOpenChange={(open) => {
              setBranchOpen(open);
              // The cached list goes stale when branches change outside the
              // app (CLI checkout/switch); reload on every open.
              if (open) void useGitStore.getState().loadBranches(workspacePath);
            }}
          >
            <DropdownTrigger
              className={cx(
                "flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border-button-default",
                "px-2 text-body-medium text-text-primary shadow-xs",
                "hover:bg-background-secondary-hover",
              )}
            >
              <GitBranch
                aria-hidden
                className="size-4 shrink-0 text-foreground-icon-secondary"
              />
              <span className="truncate">{branch ?? "…"}</span>
              <ChevronDown
                aria-hidden
                className="ml-auto size-4 shrink-0 text-foreground-icon-tertiary"
              />
            </DropdownTrigger>
            <DropdownPopover aria-label={t("git.branch")} placement="bottom start" className="max-h-80!">
              {/* Single scroller: the popover itself, capped at 320px
                  (react-aria's inline viewport clamp would otherwise let it
                  grow to nearly full-window height, so the cap needs the
                  important modifier to win). Search and the new-branch footer
                  pin via sticky; the rows scroll between them. An inner
                  max-h scroll div nested badly here — in short windows the
                  clamped popover clipped the inner list and its scrollbar,
                  leaving the lower branches unreachable. */}
              <div className="sticky -top-2.5 z-10 -mx-2.5 -mt-2.5 bg-background-primary-default px-2.5 pt-2.5 pb-1">
                <div className="flex h-8 items-center gap-1.5 rounded-lg border border-border-button-default px-2">
                  <Search
                    aria-hidden
                    className="size-4 shrink-0 text-foreground-icon-secondary"
                  />
                  <input
                    autoFocus
                    value={branchQuery}
                    onChange={(e) => setBranchQuery(e.target.value)}
                    placeholder={t("git.searchBranches")}
                    className="min-w-0 flex-1 bg-transparent text-body-medium text-text-primary outline-none placeholder:text-text-placeholder"
                  />
                </div>
              </div>
              {filteredBranches.map((b) => (
                <DropdownItem
                  key={b.name}
                  selected={b.name === branch}
                  className="px-2 py-1.5"
                  onSelect={() => {
                    setBranchOpen(false);
                    // "Current" must come from the same source as the trigger
                    // label (status.branch): the cached list's isCurrent lags
                    // behind external checkouts and would no-op the click.
                    if (b.name !== branch) {
                      run("checkout", () =>
                        useGitStore.getState().checkout(workspacePath, b.name),
                      );
                    }
                  }}
                >
                  <span className="truncate text-body-medium text-text-primary">
                    {b.name}
                  </span>
                  {b.isRemote && (
                    <span className="ml-auto shrink-0 rounded-md bg-background-secondary-default px-1.5 py-0.5 text-caption-1-regular text-text-tertiary">
                      {t("git.remoteBranch")}
                    </span>
                  )}
                </DropdownItem>
              ))}
              {filteredBranches.length === 0 && (
                <span className="px-2 py-1.5 text-body-medium text-text-tertiary">
                  {t("git.noMatchingBranches")}
                </span>
              )}
              <div className="sticky -bottom-2.5 z-10 -mx-2.5 -mb-2.5 bg-background-primary-default px-2.5 pb-2.5">
                <DropdownDivider />
                <DropdownItem
                  className="px-2 py-1.5"
                  onSelect={() => {
                    setBranchOpen(false);
                    setCreatingBranch(true);
                  }}
                >
                  <Plus aria-hidden className="size-4 text-foreground-icon-secondary" />
                  <span className="text-body-medium text-text-primary">
                    {t("git.newBranch")}
                  </span>
                </DropdownItem>
              </div>
            </DropdownPopover>
          </Dropdown>
        </div>
      )}
      {creatingBranch && (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newBranchName.trim();
            if (name.length === 0 || pending.createBranch === true) return;
            run("createBranch", async () => {
              await useGitStore.getState().createBranch(workspacePath, name);
              setCreatingBranch(false);
              setNewBranchName("");
            });
          }}
        >
          <input
            autoFocus
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            placeholder={t("git.branchNamePlaceholder")}
            className={cx(
              "h-8 min-w-0 flex-1 rounded-lg border border-border-button-default px-2",
              "text-body-medium text-text-primary placeholder:text-text-placeholder",
              "outline-none focus:border-border-focus-ring",
            )}
          />
          <Button
            size="small"
            type="submit"
            disabled={newBranchName.trim().length === 0 || pending.createBranch === true}
          >
            {t("common.confirm")}
          </Button>
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              setCreatingBranch(false);
              setNewBranchName("");
            }}
          >
            {t("common.cancel")}
          </Button>
        </form>
      )}
      {error && (
        <div role="alert" className="flex items-center gap-2">
          <p className="min-w-0 flex-1 break-words text-xs text-text-error-primary">{error}</p>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onDismissError}
            className="shrink-0 cursor-pointer rounded p-0.5 text-text-error-primary hover:bg-background-tertiary-hover"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
