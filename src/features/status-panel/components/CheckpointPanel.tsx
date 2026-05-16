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

// ─── CheckpointPanel inline Tailwind class constants ───
const CP_SECTION_CLASS =
  "sp-checkpoint-section flex flex-col gap-1 px-2.5 py-[5px] rounded-[9px] border border-(--border-subtle) [background:color-mix(in_srgb,var(--surface-card)_92%,transparent)]";

const CP_SECTION_SUMMARY_LINE_CLASS = "sp-checkpoint-section--summary-line gap-1.5 min-h-0";

const CP_HERO_ROW_CLASS =
  "sp-checkpoint-hero-row flex items-center gap-[7px] min-w-0";

const CP_HERO_COPY_CLASS =
  "sp-checkpoint-hero-copy min-w-0 flex-1 flex items-center gap-2 max-[720px]:items-start max-[720px]:flex-col max-[720px]:gap-0.5";

const CP_HERO_ICON_CLASS =
  "sp-checkpoint-hero-icon w-5 h-5 inline-flex items-center justify-center rounded-md [background:color-mix(in_srgb,var(--surface-item)_88%,transparent)] text-(--text-strong) shrink-0";

const CP_KICKER_CLASS =
  "sp-checkpoint-kicker flex-none text-[var(--sp-checkpoint-label-size)] font-bold tracking-wide text-(--text-faint) leading-tight text-left";

const CP_HEADLINE_ROW_CLASS =
  "sp-checkpoint-headline-row flex items-center gap-1.5 min-w-0";

const CP_HEADLINE_CLASS =
  "sp-checkpoint-headline text-[var(--sp-checkpoint-emphasis-size)] leading-[1.12] font-semibold text-(--text-strong) min-w-0 whitespace-nowrap";

const CP_SUMMARY_CLASS =
  "sp-checkpoint-summary m-0 text-[var(--sp-checkpoint-copy-size)] leading-[1.18] text-(--text-muted) overflow-hidden text-ellipsis whitespace-nowrap min-w-0";

const CP_BADGE_BASE_CLASS =
  "sp-checkpoint-badge shrink-0 inline-flex items-center justify-center px-[7px] py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase [background:color-mix(in_srgb,var(--surface-item)_88%,transparent)]";

const CP_BADGE_COLOR_CLASS: Record<CheckpointViewModel["verdict"], string> = {
  running: "sp-checkpoint-badge-running text-[#61afef]",
  blocked: "sp-checkpoint-badge-blocked text-[#ff8b72]",
  needs_review: "sp-checkpoint-badge-needs_review text-[#ffaf55]",
  ready: "sp-checkpoint-badge-ready text-[#89d185]",
};

const CP_NOTICE_STRIP_CLASS =
  "sp-checkpoint-notice-strip flex items-center gap-2 min-w-0 px-2 py-1.5 rounded-lg border [border-color:color-mix(in_srgb,#ff8b72_28%,var(--border-subtle))] [background:color-mix(in_srgb,#ff8b72_10%,var(--surface-item))]";

const CP_NOTICE_COPY_CLASS =
  "sp-checkpoint-notice-copy flex-1 min-w-0 overflow-x-auto overflow-y-hidden whitespace-nowrap [scrollbar-width:thin] text-[var(--sp-checkpoint-copy-size)] leading-tight text-(--text-muted)";

const CP_NOTICE_DISMISS_CLASS =
  "sp-checkpoint-notice-dismiss flex-none inline-flex items-center justify-center w-6 h-6 p-0 border border-(--border-subtle) rounded-md [background:color-mix(in_srgb,var(--surface-card)_88%,transparent)] text-(--text-muted) cursor-pointer hover:bg-(--surface-hover) hover:text-(--text-strong)";

const CP_EVIDENCE_COMPACT_CLASS =
  "sp-checkpoint-evidence-compact grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-y-1 gap-x-2.5 min-h-9.5 py-px rounded-lg bg-transparent";

const CP_INLINE_HEADING_CLASS =
  "sp-checkpoint-inline-heading inline-flex items-center gap-1.5 min-w-0 flex-none flex-nowrap [.sp-checkpoint-section--summary-line_&]:grid [.sp-checkpoint-section--summary-line_&]:grid-cols-[auto_minmax(0,1fr)] [.sp-checkpoint-section--summary-line_&]:items-start [.sp-checkpoint-section--summary-line_&]:gap-2";

const CP_SECTION_TITLE_CLASS =
  "sp-checkpoint-section-title flex-none text-[var(--sp-checkpoint-label-size)] font-bold tracking-wide text-(--text-faint) leading-tight text-left";

const CP_VALIDATION_STRIP_CLASS =
  "sp-checkpoint-validation-strip flex flex-col gap-1 min-w-0 max-[720px]:basis-full";

const CP_VALIDATION_ROW_CLASS =
  "sp-checkpoint-validation-row flex items-baseline flex-wrap gap-1 gap-x-2.5 min-w-0";

const CP_VALIDATION_GROUP_LABEL_CLASS =
  "sp-checkpoint-validation-group-label inline-flex items-center min-w-14 font-bold text-(--text-muted) text-[var(--sp-checkpoint-copy-size)] leading-[1.15] whitespace-nowrap";

const CP_VALIDATION_CHIP_CLASS =
  "sp-checkpoint-validation-chip inline-flex items-baseline gap-1.5 flex-none text-[var(--sp-checkpoint-copy-size)] leading-[1.15] text-(--text-strong)";

const CP_VALIDATION_STATUS_CLASS =
  "sp-checkpoint-validation-status flex-none text-[9px] font-bold tracking-wider uppercase text-(--text-muted)";

const CP_VALIDATION_STATUS_COLOR_CLASS: Record<string, string> = {
  pass: "is-pass text-[#89d185]",
  fail: "is-fail text-[#ff6b6b]",
  running: "is-running text-[#61afef]",
  not_run: "is-not_run text-[#ffaf55]",
  not_observed: "is-not_observed text-[#ffaf55]",
};

const CP_EVIDENCE_SUMMARY_BADGES_CLASS =
  "sp-checkpoint-evidence-summary-badges flex flex-wrap justify-start items-center gap-1 flex-[0_1_auto] max-[720px]:justify-start";

const CP_EVIDENCE_BADGE_CLASS =
  "sp-checkpoint-evidence-badge inline-flex items-center gap-1 px-1.5 py-px rounded-full border border-(--border-subtle) text-[9px] font-semibold text-(--text-muted) [background:color-mix(in_srgb,var(--surface-card)_86%,transparent)]";

const CP_VALIDATION_GUIDE_CLASS =
  "sp-checkpoint-validation-guide flex items-center gap-2 min-w-0 pt-0.5";

const CP_VALIDATION_GUIDE_LABEL_CLASS =
  "sp-checkpoint-validation-guide-label flex-none text-[var(--sp-checkpoint-label-size)] font-bold text-(--text-faint)";

const CP_VALIDATION_COMMAND_LIST_CLASS =
  "sp-checkpoint-validation-command-list flex flex-wrap gap-1.5 min-w-0";

const CP_VALIDATION_COMMAND_CLASS =
  "sp-checkpoint-validation-command border border-(--border-subtle) rounded-[7px] [background:color-mix(in_srgb,var(--surface-item)_78%,transparent)] text-(--text-strong) text-[10px] font-mono px-1.5 py-0.5 cursor-pointer hover:bg-(--surface-hover)";

const CP_ACTION_HINT_CLASS =
  "sp-checkpoint-action-hint block w-full text-[var(--sp-checkpoint-copy-size)] leading-[1.25] text-(--text-muted) text-left";

const CP_ACTION_ROW_CLASS =
  "sp-checkpoint-action-row flex flex-wrap items-center justify-end gap-1.5";

const CP_ACTION_BASE_CLASS =
  "sp-checkpoint-action inline-flex items-center justify-center gap-1 border border-(--border-subtle) rounded-[7px] bg-transparent text-(--text-strong) text-xs leading-tight px-2 py-1 enabled:cursor-pointer enabled:hover:bg-(--surface-hover) disabled:cursor-not-allowed disabled:opacity-55";

const CP_ACTION_COMMIT_CLASS =
  "sp-checkpoint-action--commit gap-1.5 border-transparent bg-transparent text-(--text-strong) font-extrabold tracking-tight shadow-none enabled:hover:border-transparent enabled:hover:[background:color-mix(in_srgb,var(--text-strong)_8%,transparent)] enabled:hover:text-(--text-strong) disabled:opacity-100 disabled:border-transparent disabled:bg-transparent disabled:text-(--text-strong) disabled:shadow-none focus-visible:outline-2 focus-visible:[outline-color:color-mix(in_srgb,var(--accent,#2563eb)_58%,transparent)] focus-visible:outline-offset-2 [&_svg]:text-current";

const CP_RISK_LIST_CLASS =
  "sp-checkpoint-risk-list flex flex-col gap-1.5 m-0 p-0 list-none";

const CP_RISK_ITEM_CLASS =
  "sp-checkpoint-risk-item flex items-start justify-start gap-1.5 text-[var(--sp-checkpoint-copy-size)] text-(--text-strong)";

const CP_RISK_SEVERITY_CLASS =
  "sp-checkpoint-risk-severity flex-none text-[9px] font-bold tracking-wider uppercase text-(--text-muted)";

const CP_RISK_SEVERITY_COLOR_CLASS: Record<string, string> = {
  high: "is-high text-[#ff8b72]",
  medium: "is-medium text-[#ffaf55]",
  low: "is-low text-[#89d185]",
};

const CP_EMPTY_STATE_CLASS =
  "sp-checkpoint-empty-state text-[var(--sp-checkpoint-copy-size)] text-(--text-muted)";

// Scoped style for ::before separator on inline headings + sp-spin keyframes for is-spinning
const CP_SCOPED_STYLE = `
@keyframes sp-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.sp-checkpoint-inline-heading > :not(:first-child)::before {
  content: "·";
  margin-right: 6px;
  color: var(--text-faint);
}
.sp-checkpoint-inline-heading .sp-checkpoint-section-title + *::before {
  margin-left: 0;
}
.sp-checkpoint-section--summary-line .sp-checkpoint-inline-heading > :not(:first-child)::before {
  content: none;
  margin-right: 0;
}
`;

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
    <div
      className={`sp-checkpoint flex flex-col gap-1.5 [--sp-checkpoint-label-size:11px] [--sp-checkpoint-copy-size:11px] [--sp-checkpoint-emphasis-size:14px]${
        compact ? " sp-checkpoint--compact" : ""
      }`}
    >
      <style>{CP_SCOPED_STYLE}</style>
      <section
        className={`${CP_SECTION_CLASS} sp-checkpoint-section--hero sp-checkpoint-${checkpoint.verdict} [background:linear-gradient(180deg,color-mix(in_srgb,var(--surface-card)_94%,transparent),color-mix(in_srgb,var(--surface-item)_88%,transparent))]`}
      >
        <div className={CP_HERO_ROW_CLASS}>
          <div className={CP_HERO_COPY_CLASS}>
            <span className={CP_KICKER_CLASS}>{t("statusPanel.checkpoint.verdictTitle")}</span>
            <div className={CP_HEADLINE_ROW_CLASS}>
              <span className={CP_HERO_ICON_CLASS}>
                <VerdictIcon
                  size={16}
                  className={
                    checkpoint.verdict === "running"
                      ? "is-spinning animate-[sp-spin_1s_linear_infinite]"
                      : ""
                  }
                />
              </span>
              <span className={CP_HEADLINE_CLASS}>{renderToken(t, checkpoint.headline)}</span>
            </div>
            {shouldShowInlineSummary && inlineSummary ? (
              <span className={CP_SUMMARY_CLASS}>{renderToken(t, inlineSummary)}</span>
            ) : null}
          </div>
          <span className={`${CP_BADGE_BASE_CLASS} ${CP_BADGE_COLOR_CLASS[checkpoint.verdict]}`}>
            {t(`statusPanel.checkpoint.verdict.${checkpoint.verdict}`)}
          </span>
        </div>
      </section>

      {shouldShowBlockedNotice && blockedNotice ? (
        <section className={`${CP_SECTION_CLASS} sp-checkpoint-section--notice py-2`}>
          <div className={CP_NOTICE_STRIP_CLASS} role="status" aria-live="polite">
            <div className={CP_NOTICE_COPY_CLASS}>{renderToken(t, blockedNotice)}</div>
            <button
              type="button"
              className={CP_NOTICE_DISMISS_CLASS}
              aria-label={t("common.close")}
              title={t("common.close")}
              onClick={() => setIsNoticeDismissed(true)}
            >
              <X size={14} />
            </button>
          </div>
        </section>
      ) : null}

      <section className={CP_SECTION_CLASS}>
        <div className={CP_EVIDENCE_COMPACT_CLASS}>
          <div className={CP_INLINE_HEADING_CLASS}>
            <span className={CP_SECTION_TITLE_CLASS}>{t("statusPanel.checkpoint.evidenceTitle")}</span>
          </div>
          <div
            className={CP_VALIDATION_STRIP_CLASS}
            role="list"
            aria-label={t("statusPanel.checkpoint.evidence.validations")}
          >
            {groupedValidations.required.length > 0 ? (
              <div className={CP_VALIDATION_ROW_CLASS}>
                <span className={CP_VALIDATION_GROUP_LABEL_CLASS}>
                  {t("statusPanel.checkpoint.evidence.requiredValidations")}
                </span>
                {groupedValidations.required.map((entry) => (
                  <span key={entry.kind} className={CP_VALIDATION_CHIP_CLASS} role="listitem">
                    <span>{t(`statusPanel.checkpoint.validations.${entry.kind}`)}</span>
                    <span
                      className={`${CP_VALIDATION_STATUS_CLASS} ${CP_VALIDATION_STATUS_COLOR_CLASS[entry.status] ?? ""}`}
                    >
                      {t(`statusPanel.checkpoint.validations.status.${entry.status}`)}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
            {groupedValidations.optional.length > 0 ? (
              <div className={CP_VALIDATION_ROW_CLASS}>
                <span className={CP_VALIDATION_GROUP_LABEL_CLASS}>
                  {t("statusPanel.checkpoint.evidence.optionalValidations")}
                </span>
                {groupedValidations.optional.map((entry) => (
                  <span key={entry.kind} className={CP_VALIDATION_CHIP_CLASS} role="listitem">
                    <span>{t(`statusPanel.checkpoint.validations.${entry.kind}`)}</span>
                    <span
                      className={`${CP_VALIDATION_STATUS_CLASS} ${CP_VALIDATION_STATUS_COLOR_CLASS[entry.status] ?? ""}`}
                    >
                      {t(`statusPanel.checkpoint.validations.status.${entry.status}`)}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {(checkpoint.evidence.todos || checkpoint.evidence.subagents) ? (
            <div className={CP_EVIDENCE_SUMMARY_BADGES_CLASS}>
              {checkpoint.evidence.todos ? (
                <span className={CP_EVIDENCE_BADGE_CLASS}>
                  {t("statusPanel.checkpoint.evidence.tasks")} {checkpoint.evidence.todos.completed}/
                  {checkpoint.evidence.todos.total}
                </span>
              ) : null}
              {checkpoint.evidence.subagents ? (
                <span className={CP_EVIDENCE_BADGE_CLASS}>
                  {t("statusPanel.checkpoint.evidence.agents")} {checkpoint.evidence.subagents.completed}/
                  {checkpoint.evidence.subagents.total}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        {(missingValidationCommands.length > 0 || hasMissingValidationWithoutCommand) &&
        !shouldSuppressValidationGuideForNeedsReview ? (
          <div className={CP_VALIDATION_GUIDE_CLASS}>
            <span className={CP_VALIDATION_GUIDE_LABEL_CLASS}>
              {t(
                missingValidationCommands.length > 0
                  ? "statusPanel.checkpoint.evidence.runMissing"
                  : "statusPanel.checkpoint.evidence.runMissingGeneric",
              )}
            </span>
            <div className={CP_VALIDATION_COMMAND_LIST_CLASS}>
              {missingValidationCommands.map((entry) => (
                <button
                  key={entry.kind}
                  type="button"
                  className={CP_VALIDATION_COMMAND_CLASS}
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

      <section className={CP_SECTION_CLASS}>
        {!compact ? (
          <div className="sp-checkpoint-file-detail flex flex-col gap-[3px]">
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
        <section className={`${CP_SECTION_CLASS} ${CP_SECTION_SUMMARY_LINE_CLASS}`}>
          <div className={CP_INLINE_HEADING_CLASS}>
            <span className={CP_SECTION_TITLE_CLASS}>{t("statusPanel.checkpoint.risksTitle")}</span>
            {translatedRisks.length === 0 ? (
              <span className={CP_EMPTY_STATE_CLASS}>
                {t("statusPanel.checkpoint.risks.none")}
              </span>
            ) : null}
          </div>
          {translatedRisks.length > 0 ? (
            <ul className={CP_RISK_LIST_CLASS}>
              {translatedRisks.map((entry) => (
                <li
                  key={`${entry.code}:${entry.sourceId ?? "none"}`}
                  className={CP_RISK_ITEM_CLASS}
                >
                  <span
                    className={`${CP_RISK_SEVERITY_CLASS} ${CP_RISK_SEVERITY_COLOR_CLASS[entry.severity] ?? ""}`}
                  >
                    {t(`statusPanel.checkpoint.risks.severity.${entry.severity}`)}
                  </span>
                  <span>{entry.translatedMessage}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section
        className={`${CP_SECTION_CLASS} ${CP_SECTION_SUMMARY_LINE_CLASS} sp-checkpoint-section--next-action grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2`}
      >
        <div className={CP_INLINE_HEADING_CLASS}>
          <span className={CP_SECTION_TITLE_CLASS}>{t("statusPanel.checkpoint.nextActionTitle")}</span>
          <span className={CP_ACTION_HINT_CLASS}>{t(nextActionHintKey)}</span>
        </div>
        {visibleNextActions.length > 0 ? (
          <div className={CP_ACTION_ROW_CLASS}>
            {visibleNextActions.map((action) => (
              <button
                key={action.type}
                type="button"
                className={
                  action.type === "commit"
                    ? `${CP_ACTION_BASE_CLASS} ${CP_ACTION_COMMIT_CLASS}`
                    : CP_ACTION_BASE_CLASS
                }
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
      {compact ? (
        <section className={`${CP_SECTION_CLASS} ${CP_SECTION_SUMMARY_LINE_CLASS}`}>
          <button
            type="button"
            className={`${CP_ACTION_BASE_CLASS} sp-checkpoint-action--expand`}
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
