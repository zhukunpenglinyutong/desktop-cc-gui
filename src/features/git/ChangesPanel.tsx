import { memo, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Plus from "lucide-react/dist/esm/icons/plus";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Minus from "lucide-react/dist/esm/icons/minus";
import { Focusable } from "react-aria-components";
import { Tooltip, TooltipContent } from "@/components/base/tooltip/tooltip";
import { type GitFileEntry, type GitStatus } from "@/lib/ipc";
import { errorText } from "@/lib/errors";
import { cx } from "@/utils/cx";
import { useGitStore } from "./store";
import { ChangesPanelHeader } from "./ChangesPanelHeader";
import { CommitFooter } from "./CommitFooter";

export function ChangesPanel({
  workspacePath,
  className,
}: {
  workspacePath: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const status = useGitStore((s) => s.statusByWorkspace[workspacePath]);
  const notRepo = useGitStore((s) => s.notRepoByWorkspace[workspacePath]);
  const refreshError = useGitStore((s) => s.errorByWorkspace[workspacePath]);
  const branches = useGitStore((s) => s.branchesByWorkspace[workspacePath]);

  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, true>>({});
  const [commitMsg, setCommitMsg] = useState("");

  useEffect(() => {
    void useGitStore.getState().refresh(workspacePath);
    void useGitStore.getState().loadBranches(workspacePath);
  }, [workspacePath]);

  /** Runs a mutating action: tracks busy state, surfaces errors inline. */
  const run = useCallback((key: string, action: () => Promise<unknown>) => {
    setPending((p) => ({ ...p, [key]: true }));
    setActionError(null);
    void action()
      .catch((err: unknown) => setActionError(errorText(err)))
      .finally(() => {
        setPending((p) => {
          const next = { ...p };
          delete next[key];
          return next;
        });
      });
  }, []);
  /** Dismiss the header error: the failed action's error, else the store's
   * last refresh failure. */
  const dismissError = useCallback(() => {
    setActionError(null);
    useGitStore.getState().clearError(workspacePath);
  }, [workspacePath]);

  const stage = useCallback(
    (files: string[]) =>
      run("stage", () => useGitStore.getState().stage(workspacePath, files)),
    [run, workspacePath],
  );
  const unstage = useCallback(
    (files: string[]) =>
      run("unstage", () => useGitStore.getState().unstage(workspacePath, files)),
    [run, workspacePath],
  );
  const stageOne = useCallback((file: string) => stage([file]), [stage]);
  const unstageOne = useCallback((file: string) => unstage([file]), [unstage]);
  // File rows open the diff in the center area, where it has room.
  const openStagedDiff = useCallback(
    (file: string) =>
      useGitStore.getState().openDiff(workspacePath, { file, staged: true }),
    [workspacePath],
  );
  const openUnstagedDiff = useCallback(
    (file: string) =>
      useGitStore.getState().openDiff(workspacePath, { file, staged: false }),
    [workspacePath],
  );

  const header = (
    <ChangesPanelHeader
      workspacePath={workspacePath}
      notRepo={notRepo}
      branch={status?.branch}
      ahead={status?.ahead}
      behind={status?.behind}
      branches={branches}
      pending={pending}
      error={actionError ?? refreshError}
      run={run}
      onDismissError={dismissError}
    />
  );

  if (notRepo) {
    return (
      <aside className={cx("flex h-full flex-col bg-background-primary-default", className)}>
        {header}
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-center text-body-medium text-text-tertiary">
            {t("git.notARepo")}
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className={cx("flex h-full flex-col bg-background-primary-default", className)}>
      {header}
      <div className="flex-1 overflow-y-auto">
        {!status ? (
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-body-medium text-text-tertiary">{t("common.loading")}</p>
          </div>
        ) : status.staged.length + status.unstaged.length + status.untracked.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-body-medium text-text-tertiary">{t("git.noChanges")}</p>
          </div>
        ) : (
          <>
            <ChangesSummary status={status} />
            <GroupSection
              title={t("git.staged")}
              entries={status.staged}
              groupActionLabel={t("git.unstageAll")}
              onGroupAction={unstage}
              rowActionLabel={t("git.unstage")}
              rowActionKind="unstage"
              onRowAction={unstageOne}
              onOpen={openStagedDiff}
              actionBusy={pending.unstage === true}
            />
            <GroupSection
              title={t("git.unstaged")}
              entries={status.unstaged}
              groupActionLabel={t("git.stageAll")}
              onGroupAction={stage}
              rowActionLabel={t("git.stage")}
              rowActionKind="stage"
              onRowAction={stageOne}
              onOpen={openUnstagedDiff}
              actionBusy={pending.stage === true}
            />
            <GroupSection
              title={t("git.untracked")}
              entries={status.untracked}
              groupActionLabel={t("git.stageAll")}
              onGroupAction={stage}
              rowActionLabel={t("git.stage")}
              rowActionKind="stage"
              onRowAction={stageOne}
              onOpen={openUnstagedDiff}
              actionBusy={pending.stage === true}
              isNew
            />
          </>
        )}
      </div>
      <CommitFooter
        workspacePath={workspacePath}
        stagedCount={status?.staged.length ?? 0}
        busy={pending.commit === true}
        commitMsg={commitMsg}
        onCommitMsgChange={setCommitMsg}
        run={run}
      />
    </aside>
  );
}

/* -------------------------------------------------------------------------- */

function ChangesSummary({ status }: { status: GitStatus }) {
  const { t } = useTranslation();
  const all = [...status.staged, ...status.unstaged, ...status.untracked];
  const adds = all.reduce((n, f) => n + (f.additions ?? 0), 0);
  const dels = all.reduce((n, f) => n + (f.deletions ?? 0), 0);
  return (
    <div className="sticky top-0 flex items-center gap-1.5 border-b border-separator-border bg-background-primary-default px-3 py-2">
      <span className="text-body-medium text-text-primary">
        {all.length} {t("git.uncommittedChanges")}
      </span>
      <span className="text-xs text-state-success-text">+{adds}</span>
      <span className="text-xs text-text-error-primary">−{dels}</span>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  M: "text-status-yellow-text",
  A: "text-state-success-text",
  D: "text-text-error-primary",
  R: "text-status-purple-text",
  C: "text-status-blue-text",
};

interface GroupSectionProps {
  title: string;
  entries: GitFileEntry[];
  groupActionLabel: string;
  onGroupAction: (files: string[]) => void;
  rowActionLabel: string;
  rowActionKind: "stage" | "unstage";
  onRowAction: (file: string) => void;
  onOpen: (file: string) => void;
  actionBusy: boolean;
  isNew?: boolean;
}

const GroupSection = memo(function GroupSection({
  title,
  entries,
  groupActionLabel,
  onGroupAction,
  rowActionLabel,
  rowActionKind,
  onRowAction,
  onOpen,
  actionBusy,
  isNew = false,
}: GroupSectionProps) {
  const [open, setOpen] = useState(true);
  if (entries.length === 0) return null;
  return (
    <section>
      <div
        className={cx(
          "sticky top-0 flex items-center gap-1 bg-background-secondary-default px-3 py-1.5",
          "border-b border-separator-border",
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown aria-hidden className="size-4 text-foreground-icon-tertiary" />
          ) : (
            <ChevronRight aria-hidden className="size-4 text-foreground-icon-tertiary" />
          )}
          <span className="text-body-medium text-text-secondary">{title}</span>
          <span className="text-xs text-text-tertiary">{entries.length}</span>
        </button>
        <button
          type="button"
          disabled={actionBusy}
          onClick={() => onGroupAction(entries.map((f) => f.path))}
          className={cx(
            "shrink-0 rounded px-1.5 py-0.5 text-xs text-text-secondary",
            "hover:bg-background-tertiary-hover disabled:text-text-disabled",
          )}
        >
          {groupActionLabel}
        </button>
      </div>
      {open && (
        <ul>
          {entries.map((entry) => (
            <FileRow
              key={entry.path}
              entry={entry}
              actionLabel={rowActionLabel}
              actionKind={rowActionKind}
              onAction={onRowAction}
              onOpen={onOpen}
              actionBusy={actionBusy}
              isNew={isNew}
            />
          ))}
        </ul>
      )}
    </section>
  );
});

interface FileRowProps {
  entry: GitFileEntry;
  actionLabel: string;
  actionKind: "stage" | "unstage";
  /** Untracked group: show the "New" badge like the template panel. */
  isNew?: boolean;
  onAction: (path: string) => void;
  onOpen: (path: string) => void;
  actionBusy: boolean;
}

const FileRow = memo(function FileRow({
  entry,
  actionLabel,
  actionKind,
  isNew = false,
  onAction,
  onOpen,
  actionBusy,
}: FileRowProps) {
  const { t } = useTranslation();
  const raw = entry.status.replace("?", "").trim().charAt(0).toUpperCase();
  const letter = raw.length > 0 ? raw : "?";
  const sepIdx = Math.max(entry.path.lastIndexOf("/"), entry.path.lastIndexOf("\\"));
  const dirPart = sepIdx > 0 ? entry.path.slice(0, sepIdx + 1) : "";
  const filePart = sepIdx >= 0 ? entry.path.slice(sepIdx + 1) : entry.path;
  return (
    <li className="group flex items-center gap-2 px-3 py-1 hover:bg-background-secondary-hover">
      <span
        className={cx(
          "w-4 shrink-0 text-center font-mono text-xs",
          STATUS_COLOR[letter] ?? "text-text-tertiary",
        )}
      >
        {letter}
      </span>
      <Tooltip>
        <Focusable>
          <button
            type="button"
            onClick={() => onOpen(entry.path)}
            className="flex min-w-0 flex-1 items-baseline text-left font-mono text-xs"
          >
            {/* Directory truncates from the left (…/foo/bar) so the filename
                — the most important part — is always fully visible; the tooltip
                below shows the full path on hover. */}
            {dirPart && (
              <span dir="rtl" className="min-w-0 truncate text-left text-text-tertiary">
                <bdo dir="ltr">{dirPart}</bdo>
              </span>
            )}
            <span className="shrink-0 text-text-primary">{filePart}</span>
          </button>
        </Focusable>
        <TooltipContent className="break-all font-mono">{entry.path}</TooltipContent>
      </Tooltip>
      {entry.additions !== undefined && (
        <span className="shrink-0 text-xs text-state-success-text">+{entry.additions}</span>
      )}
      {entry.deletions !== undefined && entry.deletions > 0 && (
        <span className="shrink-0 text-xs text-text-error-primary">−{entry.deletions}</span>
      )}
      {isNew && (
        <span className="shrink-0 rounded-sm bg-background-tertiary-default px-1 py-px text-caption-1-medium text-text-secondary">
          {t("git.newFile")}
        </span>
      )}
      <button
        type="button"
        disabled={actionBusy}
        onClick={() => onAction(entry.path)}
        aria-label={actionLabel}
        title={actionLabel}
        className={cx(
          "shrink-0 rounded p-0.5 text-foreground-icon-secondary opacity-0",
          // Reveal on row hover AND on keyboard focus (same contract as the
          // file-tree mention button).
          "group-hover:opacity-100 focus-visible:opacity-100 hover:bg-background-tertiary-hover",
          "disabled:text-foreground-icon-disabled",
        )}
      >
        {actionKind === "stage" ? (
          <Plus aria-hidden className="size-4" />
        ) : (
          <Minus aria-hidden className="size-4" />
        )}
      </button>
    </li>
  );
});
