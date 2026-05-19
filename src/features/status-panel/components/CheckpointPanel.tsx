import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import X from "lucide-react/dist/esm/icons/x";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert";
import GitCommitHorizontal from "lucide-react/dist/esm/icons/git-commit-horizontal";
import type { TFunction } from "i18next";
import { WorkspaceEditableDiffReviewSurface } from "../../git/components/WorkspaceEditableDiffReviewSurface";
import type { CodeAnnotationBridgeProps } from "../../code-annotations/types";
import { FileIcon } from "../../messages/components/toolBlocks/FileIcon";
import { resolveWorkspaceRelativePath } from "../../../utils/workspacePaths";
import type { GitFileStatus } from "../../../types";
import type {
  CheckpointAction,
  CheckpointMessageToken,
  CheckpointValidationKind,
  CheckpointViewModel,
  FileChangeSummary,
} from "../types";
import { resolveCheckpointValidationProfile } from "../utils/checkpoint";
import { CheckpointCommitDialog } from "./CheckpointCommitDialog";
import { FileChangesList } from "./FileChangesList";
import { PolicyDecisionAuditPanel } from "./audit/PolicyDecisionAuditPanel";

interface CheckpointPanelProps extends CodeAnnotationBridgeProps {
  checkpoint: CheckpointViewModel;
  compact?: boolean;
  fileChanges: FileChangeSummary[];
  totalAdditions: number;
  totalDeletions: number;
  onOpenDiffPath?: (path: string) => void;
  onOpenFilePath?: (path: string) => void;
  onAfterSelect?: () => void;
  workspaceId?: string | null;
  workspacePath?: string | null;
  onRefreshGitStatus?: (() => void) | null;
  commitMessage?: string;
  commitMessageLoading?: boolean;
  commitMessageError?: string | null;
  onCommitMessageChange?: (value: string) => void;
  onGenerateCommitMessage?: (
    language?: "zh" | "en",
    engine?: "codex" | "claude" | "gemini" | "opencode",
    selectedPaths?: string[],
  ) => void | Promise<void>;
  onCommit?: (selectedPaths?: string[]) => void | Promise<void>;
  commitLoading?: boolean;
  commitError?: string | null;
  stagedFiles?: GitFileStatus[];
  unstagedFiles?: GitFileStatus[];
  onExpandToDock?: () => void;
}

const VERDICT_ICON = {
  running: Loader2,
  blocked: CircleAlert,
  needs_review: TriangleAlert,
  ready: ShieldCheck,
} as const;

export const CheckpointPanel = memo(function CheckpointPanel({
  checkpoint,
  compact = false,
  fileChanges,
  totalAdditions,
  totalDeletions,
  onOpenDiffPath,
  onOpenFilePath,
  onAfterSelect,
  workspaceId = null,
  workspacePath = null,
  onRefreshGitStatus = null,
  commitMessage = "",
  commitMessageLoading = false,
  commitMessageError = null,
  onCommitMessageChange,
  onGenerateCommitMessage,
  onCommit,
  commitLoading = false,
  commitError = null,
  stagedFiles = [],
  unstagedFiles = [],
  onExpandToDock,
  onCreateCodeAnnotation,
  onRemoveCodeAnnotation,
  codeAnnotations,
}: CheckpointPanelProps) {
  const { t } = useTranslation();
  const [isDiffModalMaximized, setIsDiffModalMaximized] = useState(false);
  const [diffHeaderControlsTarget, setDiffHeaderControlsTarget] = useState<HTMLElement | null>(null);
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">("split");
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
  const [isNoticeDismissed, setIsNoticeDismissed] = useState(false);
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const wasCommitLoadingRef = useRef(false);
  const VerdictIcon = VERDICT_ICON[checkpoint.verdict];
  const displayFiles = fileChanges;
  const primaryDiffPath =
    fileChanges.find((entry) => entry.diff?.trim())?.filePath ?? fileChanges[0]?.filePath ?? null;
  const validationProfile = useMemo(
    () =>
      resolveCheckpointValidationProfile({
        commands: checkpoint.evidence.commands,
        fileChanges,
      }),
    [checkpoint.evidence.commands, fileChanges],
  );
  const visibleValidations = useMemo(
    () =>
      checkpoint.evidence.validations.filter(
        (entry) =>
          validationProfile.visibleKinds.includes(entry.kind) ||
          entry.status !== "not_observed" ||
          Boolean(entry.sourceId),
      ),
    [checkpoint.evidence.validations, validationProfile],
  );
  const missingValidationCommands = useMemo(
    () =>
      visibleValidations
        .filter((entry) => entry.status === "not_run")
        .map((entry) => ({
          kind: entry.kind,
          command: validationProfile.commands[entry.kind] ?? null,
        }))
        .filter((entry): entry is { kind: CheckpointValidationKind; command: string } =>
          Boolean(entry.command),
        ),
    [validationProfile, visibleValidations],
  );
  const hasMissingValidationWithoutCommand = visibleValidations.some(
    (entry) => entry.status === "not_run" && !validationProfile.commands[entry.kind],
  );
  const groupedValidations = useMemo(() => {
    const required = visibleValidations.filter((entry) =>
      validationProfile.requiredKinds.includes(entry.kind),
    );
    const optional = visibleValidations.filter(
      (entry) => !validationProfile.requiredKinds.includes(entry.kind),
    );
    return { required, optional };
  }, [visibleValidations, validationProfile]);
  const nextActionHintKey = resolveNextActionHintKey(
    checkpoint.verdict,
    missingValidationCommands.length > 0 || hasMissingValidationWithoutCommand,
  );
  const translatedRisks = useMemo(
    () =>
      checkpoint.risks.map((entry) => ({
        ...entry,
        translatedMessage: renderToken(t, entry.message),
      })),
    [checkpoint.risks, t],
  );
  const diffEntries = useMemo(
    () =>
      fileChanges
        .filter((entry) => entry.diff?.trim())
        .map((entry) => ({
          path: entry.filePath,
          status: entry.status,
          diff: entry.diff ?? "",
        })),
    [fileChanges],
  );
  const sidebarFiles = useMemo(
    () => fileChanges.filter((entry) => entry.diff?.trim() || entry.status === "A"),
    [fileChanges],
  );
  const activeDiffPath =
    selectedDiffPath && sidebarFiles.some((entry) => entry.filePath === selectedDiffPath)
      ? selectedDiffPath
      : diffEntries[0]?.path ??
        sidebarFiles.find((entry) => entry.status === "A")?.filePath ??
        sidebarFiles[0]?.filePath ??
        null;
  const activeDiffFile =
    sidebarFiles.find((entry) => entry.filePath === activeDiffPath) ?? null;
  const activeDiffEntry =
    diffEntries.find((entry) => entry.path === activeDiffPath) ?? null;
  const activeDiffGitPath = activeDiffFile
    ? resolveWorkspaceRelativePath(workspacePath, activeDiffFile.filePath)
    : null;
  const hasCommittableGitChanges =
    stagedFiles.length > 0 || unstagedFiles.length > 0 || fileChanges.length > 0;
  const visibleNextActions = useMemo(
    () =>
      buildVisibleNextActions({
        actions: checkpoint.nextActions,
        hasCommittableGitChanges,
        hasCommitHandler: Boolean(onCommit),
      }),
    [checkpoint.nextActions, hasCommittableGitChanges, onCommit],
  );
  const blockedNotice: CheckpointMessageToken | null =
    checkpoint.verdict === "blocked" ? checkpoint.summary : null;
  const inlineSummary: CheckpointMessageToken | null =
    checkpoint.verdict !== "blocked" ? checkpoint.summary : null;
  const shouldShowInlineSummary = Boolean(inlineSummary);
  const shouldShowBlockedNotice = Boolean(blockedNotice) && !isNoticeDismissed;
  const shouldSuppressValidationGuideForNeedsReview =
    checkpoint.verdict === "needs_review";
  const visiblePolicyAudit = checkpoint.policyAudit.filter(
    (entry) => entry.verdictContribution !== "no_contribution",
  );

  useEffect(() => {
    setIsNoticeDismissed(false);
  }, [blockedNotice, checkpoint.verdict]);

  useEffect(() => {
    if (!isCommitDialogOpen) {
      wasCommitLoadingRef.current = commitLoading;
      return;
    }
    if (wasCommitLoadingRef.current && !commitLoading && !commitError) {
      setIsCommitDialogOpen(false);
    }
    wasCommitLoadingRef.current = commitLoading;
  }, [commitError, commitLoading, isCommitDialogOpen]);

  const handleReviewDiff = () => {
    if (!primaryDiffPath) {
      return;
    }
    if (diffEntries.length > 0) {
      setSelectedDiffPath(primaryDiffPath);
      return;
    }
    if (onOpenDiffPath) {
      onOpenDiffPath(primaryDiffPath);
      onAfterSelect?.();
    }
  };

  return (
    <div className={`sp-checkpoint${compact ? " sp-checkpoint--compact" : ""}`}>
      <section
        className={`sp-checkpoint-section sp-checkpoint-section--hero sp-checkpoint-${checkpoint.verdict}`}
      >
        <div className="sp-checkpoint-hero-row">
          <div className="sp-checkpoint-hero-copy">
            <span className="sp-checkpoint-kicker">{t("statusPanel.checkpoint.verdictTitle")}</span>
            <div className="sp-checkpoint-headline-row">
              <span className="sp-checkpoint-hero-icon">
                <VerdictIcon size={16} className={checkpoint.verdict === "running" ? "is-spinning" : ""} />
              </span>
              <span className="sp-checkpoint-headline">{renderToken(t, checkpoint.headline)}</span>
            </div>
            {shouldShowInlineSummary && inlineSummary ? (
              <span className="sp-checkpoint-summary">{renderToken(t, inlineSummary)}</span>
            ) : null}
          </div>
          <span className={`sp-checkpoint-badge sp-checkpoint-badge-${checkpoint.verdict}`}>
            {t(`statusPanel.checkpoint.verdict.${checkpoint.verdict}`)}
          </span>
        </div>
      </section>

      {shouldShowBlockedNotice && blockedNotice ? (
        <section className="sp-checkpoint-section sp-checkpoint-section--notice">
          <div className="sp-checkpoint-notice-strip" role="status" aria-live="polite">
            <div className="sp-checkpoint-notice-copy">{renderToken(t, blockedNotice)}</div>
            <button
              type="button"
              className="sp-checkpoint-notice-dismiss"
              aria-label={t("common.close")}
              title={t("common.close")}
              onClick={() => setIsNoticeDismissed(true)}
            >
              <X size={14} />
            </button>
          </div>
        </section>
      ) : null}

      <section className="sp-checkpoint-section">
        <div className="sp-checkpoint-evidence-compact">
          <div className="sp-checkpoint-inline-heading">
            <span className="sp-checkpoint-section-title">{t("statusPanel.checkpoint.evidenceTitle")}</span>
          </div>
          <div
            className="sp-checkpoint-validation-strip"
            role="list"
            aria-label={t("statusPanel.checkpoint.evidence.validations")}
          >
            {groupedValidations.required.length > 0 ? (
              <div className="sp-checkpoint-validation-row">
                <span className="sp-checkpoint-validation-group-label">
                  {t("statusPanel.checkpoint.evidence.requiredValidations")}
                </span>
                {groupedValidations.required.map((entry) => (
                  <span key={entry.kind} className="sp-checkpoint-validation-chip" role="listitem">
                    <span>{t(`statusPanel.checkpoint.validations.${entry.kind}`)}</span>
                    <span className={`sp-checkpoint-validation-status is-${entry.status}`}>
                      {t(`statusPanel.checkpoint.validations.status.${entry.status}`)}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
            {groupedValidations.optional.length > 0 ? (
              <div className="sp-checkpoint-validation-row">
                <span className="sp-checkpoint-validation-group-label">
                  {t("statusPanel.checkpoint.evidence.optionalValidations")}
                </span>
                {groupedValidations.optional.map((entry) => (
                  <span key={entry.kind} className="sp-checkpoint-validation-chip" role="listitem">
                    <span>{t(`statusPanel.checkpoint.validations.${entry.kind}`)}</span>
                    <span className={`sp-checkpoint-validation-status is-${entry.status}`}>
                      {t(`statusPanel.checkpoint.validations.status.${entry.status}`)}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {(checkpoint.evidence.todos || checkpoint.evidence.subagents) ? (
            <div className="sp-checkpoint-evidence-summary-badges">
              {checkpoint.evidence.todos ? (
                <span className="sp-checkpoint-evidence-badge">
                  {t("statusPanel.checkpoint.evidence.tasks")} {checkpoint.evidence.todos.completed}/
                  {checkpoint.evidence.todos.total}
                </span>
              ) : null}
              {checkpoint.evidence.subagents ? (
                <span className="sp-checkpoint-evidence-badge">
                  {t("statusPanel.checkpoint.evidence.agents")} {checkpoint.evidence.subagents.completed}/
                  {checkpoint.evidence.subagents.total}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        {(missingValidationCommands.length > 0 || hasMissingValidationWithoutCommand) &&
        !shouldSuppressValidationGuideForNeedsReview ? (
          <div className="sp-checkpoint-validation-guide">
            <span className="sp-checkpoint-validation-guide-label">
              {t(
                missingValidationCommands.length > 0
                  ? "statusPanel.checkpoint.evidence.runMissing"
                  : "statusPanel.checkpoint.evidence.runMissingGeneric",
              )}
            </span>
            <div className="sp-checkpoint-validation-command-list">
              {missingValidationCommands.map((entry) => (
                <button
                  key={entry.kind}
                  type="button"
                  className="sp-checkpoint-validation-command"
                  title={t("workspace.copyCommand")}
                  onClick={() => copyTextToClipboard(entry.command)}
                >
                  {entry.command}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="sp-checkpoint-section">
        {!compact ? (
          <div className="sp-checkpoint-file-detail">
            <FileChangesList
              fileChanges={displayFiles}
              totalAdditions={totalAdditions}
              totalDeletions={totalDeletions}
              onOpenFilePath={onOpenFilePath}
              onOpenDiffPath={onOpenDiffPath}
              onOpenTotalDiff={primaryDiffPath ? handleReviewDiff : undefined}
              onAfterSelect={onAfterSelect}
            />
          </div>
        ) : null}
      </section>

      {!compact ? (
        <section className="sp-checkpoint-section sp-checkpoint-section--summary-line">
          <div className="sp-checkpoint-inline-heading">
            <span className="sp-checkpoint-section-title">{t("statusPanel.checkpoint.risksTitle")}</span>
            {translatedRisks.length === 0 ? (
              <span className="sp-checkpoint-empty-state">
                {t("statusPanel.checkpoint.risks.none")}
              </span>
            ) : null}
          </div>
          {translatedRisks.length > 0 ? (
            <ul className="sp-checkpoint-risk-list">
              {translatedRisks.map((entry) => (
                <li key={`${entry.code}:${entry.sourceId ?? "none"}`} className="sp-checkpoint-risk-item">
                  <span className={`sp-checkpoint-risk-severity is-${entry.severity}`}>
                    {t(`statusPanel.checkpoint.risks.severity.${entry.severity}`)}
                  </span>
                  <span>{entry.translatedMessage}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="sp-checkpoint-section sp-checkpoint-section--summary-line sp-checkpoint-section--next-action">
        <div className="sp-checkpoint-inline-heading">
          <span className="sp-checkpoint-section-title">{t("statusPanel.checkpoint.nextActionTitle")}</span>
          <span className="sp-checkpoint-action-hint">{t(nextActionHintKey)}</span>
        </div>
        {visibleNextActions.length > 0 ? (
          <div className="sp-checkpoint-action-row">
            {visibleNextActions.map((action) => (
              <button
                key={action.type}
                type="button"
                className={`sp-checkpoint-action${
                  action.type === "commit" ? " sp-checkpoint-action--commit" : ""
                }`}
                disabled={
                  !resolveActionEnabled(action, {
                    primaryDiffPath,
                    hasCommittableGitChanges,
                    hasCommitHandler: Boolean(onCommit),
                  })
                }
                onClick={
                  action.type === "commit" && onCommit
                    ? () => setIsCommitDialogOpen(true)
                    : action.type === "review_diff"
                      ? handleReviewDiff
                      : undefined
                }
              >
                {action.type === "commit" ? (
                  <GitCommitHorizontal size={14} strokeWidth={2.35} aria-hidden />
                ) : null}
                {renderToken(t, action.label)}
              </button>
            ))}
          </div>
        ) : null}
      </section>
      {!compact && visiblePolicyAudit.length > 0 ? (
        <PolicyDecisionAuditPanel policyAudit={visiblePolicyAudit} />
      ) : null}
      {compact ? (
        <section className="sp-checkpoint-section sp-checkpoint-section--summary-line">
          <button
            type="button"
            className="sp-checkpoint-action sp-checkpoint-action--expand"
            onClick={onExpandToDock}
          >
            {t("statusPanel.checkpoint.expandToDock")}
          </button>
        </section>
      ) : null}
      {isCommitDialogOpen && typeof document !== "undefined" ? createPortal(
        <CheckpointCommitDialog
          commitError={commitError}
          commitLoading={commitLoading}
          commitMessage={commitMessage}
          commitMessageError={commitMessageError}
          commitMessageLoading={commitMessageLoading}
          fileChanges={fileChanges}
          onClose={() => setIsCommitDialogOpen(false)}
          onCommit={onCommit}
          onCommitMessageChange={onCommitMessageChange}
          onGenerateCommitMessage={onGenerateCommitMessage}
          stagedFiles={stagedFiles}
          totalAdditions={totalAdditions}
          totalDeletions={totalDeletions}
          unstagedFiles={unstagedFiles}
          workspacePath={workspacePath}
        />,
        document.body,
      ) : null}
      {selectedDiffPath && activeDiffPath && activeDiffFile && activeDiffGitPath && typeof document !== "undefined"
        ? createPortal(
            <div
              className="git-history-diff-modal-overlay is-popup checkpoint-diff-modal-overlay"
              role="presentation"
              onClick={() => {
                setSelectedDiffPath(null);
                setIsDiffModalMaximized(false);
              }}
            >
              <div
                className={`git-history-diff-modal checkpoint-diff-modal${
                  isDiffModalMaximized ? " is-maximized" : ""
                }`}
                role="dialog"
                aria-modal="true"
                aria-label={activeDiffGitPath}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="git-history-diff-modal-header">
                  <div className="git-history-diff-modal-title">
                    <span className={`git-history-file-status git-status-${activeDiffFile.status.toLowerCase()}`}>
                      {activeDiffFile.status}
                    </span>
                    <span className="git-history-tree-icon is-file" aria-hidden>
                      <FileIcon fileName={activeDiffFile.fileName} />
                    </span>
                    <span className="git-history-diff-modal-path">{activeDiffGitPath}</span>
                    <span className="git-history-diff-modal-stats">
                      <span className="is-add">+{activeDiffFile.additions}</span>
                      <span className="is-sep">/</span>
                      <span className="is-del">-{activeDiffFile.deletions}</span>
                    </span>
                  </div>
                  <div className="git-history-diff-modal-actions" ref={setDiffHeaderControlsTarget}>
                    <button
                      type="button"
                      className="git-history-diff-modal-close"
                      onClick={() => setIsDiffModalMaximized((value) => !value)}
                      aria-label={isDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                      title={isDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                    >
                      <span className="git-history-diff-modal-close-glyph" aria-hidden>
                        {isDiffModalMaximized ? "❐" : "□"}
                      </span>
                    </button>
                  </div>
                </div>
                <div className="checkpoint-diff-modal-shell">
                  <div className="checkpoint-diff-viewer">
                    {activeDiffEntry ? (
                      <WorkspaceEditableDiffReviewSurface
                        workspaceId={workspaceId}
                        workspacePath={workspacePath}
                        gitStatusFiles={[
                          ...stagedFiles,
                          ...unstagedFiles,
                        ]}
                        files={[
                          {
                            filePath: activeDiffGitPath,
                            status: activeDiffFile.status,
                            additions: activeDiffFile.additions,
                            deletions: activeDiffFile.deletions,
                            diff: activeDiffEntry.diff,
                          },
                        ]}
                        selectedPath={activeDiffGitPath}
                        stickyHeaderMode="controls-only"
                        embeddedAnchorVariant="modal-pager"
                        toolbarLayout="inline-actions"
                        headerControlsTarget={diffHeaderControlsTarget}
                        fullDiffSourceKey={[
                          activeDiffGitPath,
                          activeDiffFile.status,
                          activeDiffFile.additions,
                          activeDiffFile.deletions,
                          activeDiffFile.diff ?? "",
                        ].join(":")}
                        diffStyle={diffStyle}
                        onDiffStyleChange={setDiffStyle}
                        onRequestClose={() => {
                          setSelectedDiffPath(null);
                          setIsDiffModalMaximized(false);
                        }}
                        focusSelectedFileOnly
                        allowEditing
                        onRequestGitStatusRefresh={onRefreshGitStatus}
                        onCreateCodeAnnotation={onCreateCodeAnnotation}
                        onRemoveCodeAnnotation={onRemoveCodeAnnotation}
                        codeAnnotations={codeAnnotations}
                        codeAnnotationSurface="modal-diff-view"
                      />
                    ) : (
                      <div className="checkpoint-diff-fallback">
                        <div className="checkpoint-diff-fallback-copy">
                          {activeDiffFile.status === "A"
                            ? t("git.diffUnavailable")
                            : t("git.diffUnavailable")}
                        </div>
                        {onOpenFilePath ? (
                          <button
                            type="button"
                            className="sp-checkpoint-action"
                            onClick={() => {
                              onOpenFilePath(activeDiffFile.filePath);
                              onAfterSelect?.();
                              setSelectedDiffPath(null);
                            }}
                          >
                            {t("common.openFile")}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                  <aside className="checkpoint-diff-sidebar">
                    <div className="checkpoint-diff-sidebar-title-row">
                      <div className="checkpoint-diff-sidebar-title">
                        {t("statusPanel.checkpoint.fileDetailsTitle")}
                      </div>
                      <div className="checkpoint-diff-sidebar-count">
                        {sidebarFiles.length}
                      </div>
                    </div>
                    <div className="checkpoint-diff-sidebar-list">
                      {sidebarFiles.map((file) => {
                        const selected = file.filePath === activeDiffPath;
                        return (
                          <button
                            key={file.filePath}
                            type="button"
                            className={`checkpoint-diff-sidebar-item${
                              selected ? " is-active" : ""
                            }`}
                            onClick={() => setSelectedDiffPath(file.filePath)}
                          >
                            <span className={`git-history-file-status git-status-${file.status.toLowerCase()}`}>
                              {file.status}
                            </span>
                            <span className="checkpoint-diff-sidebar-name">{file.fileName}</span>
                            <span className="checkpoint-diff-sidebar-stats">
                              <span className="is-add">+{file.additions}</span>
                              <span className="is-del">-{file.deletions}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </aside>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});

function resolveActionEnabled(
  action: CheckpointAction,
  context: {
    primaryDiffPath: string | null;
    hasCommittableGitChanges: boolean;
    hasCommitHandler: boolean;
  },
) {
  if (action.type === "commit") {
    return context.hasCommitHandler && context.hasCommittableGitChanges;
  }
  if (!action.enabled) {
    return false;
  }
  if (action.type === "review_diff") {
    return Boolean(context.primaryDiffPath);
  }
  return action.enabled;
}

function buildVisibleNextActions(input: {
  actions: CheckpointAction[];
  hasCommittableGitChanges: boolean;
  hasCommitHandler: boolean;
}): CheckpointAction[] {
  const withoutUnavailableCommit = input.actions.filter((action) => {
    if (action.type !== "commit") {
      return true;
    }
    return input.hasCommitHandler && input.hasCommittableGitChanges;
  });

  const hasCommitAction = withoutUnavailableCommit.some((action) => action.type === "commit");
  if (!hasCommitAction && input.hasCommitHandler && input.hasCommittableGitChanges) {
    return [
      ...withoutUnavailableCommit,
      {
        type: "commit",
        label: { key: "statusPanel.checkpoint.actions.commit" },
        enabled: true,
      },
    ];
  }
  return withoutUnavailableCommit;
}

function resolveNextActionHintKey(
  verdict: CheckpointViewModel["verdict"],
  hasMissingValidationCommands: boolean,
) {
  if (verdict === "needs_review") {
    return "statusPanel.checkpoint.actions.hint.needs_review";
  }
  if (hasMissingValidationCommands) {
    return "statusPanel.checkpoint.actions.hint.runMissingValidation";
  }
  return `statusPanel.checkpoint.actions.hint.${verdict}`;
}

function copyTextToClipboard(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }
  void navigator.clipboard.writeText(value);
}

function renderToken(t: TFunction, token: CheckpointMessageToken) {
  if ("text" in token) {
    return token.text;
  }
  return t(token.key, token.params as Record<string, string> | undefined);
}
