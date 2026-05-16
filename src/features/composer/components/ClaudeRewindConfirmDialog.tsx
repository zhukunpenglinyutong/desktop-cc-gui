import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { ExportRewindFilesResult } from "../../../services/tauri";
import { parseDiff, type ParsedDiffLine } from "../../../utils/diff";
import { languageFromPath } from "../../../utils/syntax";
import FileIcon from "../../../components/FileIcon";
import type { OperationFileChangeSummary } from "../../operation-facts/operationFacts";
import { DiffBlock } from "../../git/components/DiffBlock";
import type { RewindMode } from "../../threads/utils/rewindMode";

export type RewindPreviewState = {
  targetMessageId: string;
  preview: string;
  engine: "claude" | "codex" | "gemini";
  sessionId: string | null;
  conversationLabel: string;
  removedUserMessageCount: number;
  removedAssistantMessageCount: number;
  removedToolCallCount: number;
  affectedFiles: OperationFileChangeSummary[];
};

export type ClaudeRewindPreviewState = RewindPreviewState;

type RewindConfirmDialogProps = {
  preview: RewindPreviewState | null;
  isBusy?: boolean;
  rewindMode?: RewindMode;
  shouldShowAffectedFiles?: boolean;
  onRewindModeChange?: (value: RewindMode) => void;
  onOpenDiffPath?: (path: string) => void;
  onStoreChanges?: (
    preview: RewindPreviewState,
  ) => Promise<ExportRewindFilesResult>;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

type ClaudeRewindConfirmDialogProps = RewindConfirmDialogProps;

function formatFileStatusLabel(
  t: ReturnType<typeof useTranslation>["t"],
  status: OperationFileChangeSummary["status"],
) {
  switch (status) {
    case "A":
      return t("git.fileAdded");
    case "D":
      return t("git.fileDeleted");
    case "R":
      return t("git.fileRenamed");
    default:
      return t("git.fileModified");
  }
}

const PREVIEW_CONTEXT_RADIUS = 1;

function normalizeRewindDisplayPath(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/");
}

function toRewindDisplayDedupeKey(filePath: string): string {
  const normalizedPath = normalizeRewindDisplayPath(filePath);
  if (!normalizedPath) {
    return "";
  }
  if (
    normalizedPath.includes("\\") ||
    /^[A-Za-z]:\//.test(normalizedPath) ||
    /^\/\/[^/]+\/[^/]+/.test(normalizedPath)
  ) {
    return normalizedPath.toLowerCase();
  }
  return normalizedPath;
}

function isLikelySameDisplayFile(
  leftPath: string,
  rightPath: string,
  leftFileName: string,
  rightFileName: string,
): boolean {
  if (leftFileName !== rightFileName) {
    return false;
  }
  const normalizedLeft = normalizeRewindDisplayPath(leftPath);
  const normalizedRight = normalizeRewindDisplayPath(rightPath);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return (
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`)
  );
}

function resolvePreferredReviewStatus(
  current: OperationFileChangeSummary["status"],
  incoming: OperationFileChangeSummary["status"],
): OperationFileChangeSummary["status"] {
  const priority: Record<OperationFileChangeSummary["status"], number> = {
    D: 4,
    R: 3,
    A: 2,
    M: 1,
  };
  return priority[incoming] > priority[current] ? incoming : current;
}

function mergeReviewFileSummaries(
  current: OperationFileChangeSummary,
  incoming: OperationFileChangeSummary,
): OperationFileChangeSummary {
  const shouldPreferIncomingPath =
    !current.filePath.trim() ||
    (incoming.filePath.trim().length > 0 &&
      incoming.filePath.length > current.filePath.length);
  const currentDiff = current.diff?.trim() ?? "";
  const incomingDiff = incoming.diff?.trim() ?? "";

  return {
    ...current,
    ...(shouldPreferIncomingPath
      ? {
          filePath: incoming.filePath,
          fileName: incoming.fileName,
        }
      : {}),
    status: resolvePreferredReviewStatus(current.status, incoming.status),
    additions: Math.max(current.additions, incoming.additions),
    deletions: Math.max(current.deletions, incoming.deletions),
    diff: incomingDiff.length > currentDiff.length ? incoming.diff : current.diff,
  };
}

function dedupeReviewFiles(
  files: OperationFileChangeSummary[],
): OperationFileChangeSummary[] {
  const deduped: OperationFileChangeSummary[] = [];
  const indexByKey = new Map<string, number>();
  for (const file of files) {
    const exactKey = toRewindDisplayDedupeKey(file.filePath);
    const exactIndex = exactKey.length > 0 ? indexByKey.get(exactKey) ?? -1 : -1;
    if (exactIndex >= 0) {
      deduped[exactIndex] = mergeReviewFileSummaries(
        deduped[exactIndex]!,
        file,
      );
      continue;
    }
    const fuzzyIndex = deduped.findIndex((entry) =>
      isLikelySameDisplayFile(
        entry.filePath,
        file.filePath,
        entry.fileName,
        file.fileName,
      ),
    );
    if (fuzzyIndex >= 0) {
      deduped[fuzzyIndex] = mergeReviewFileSummaries(deduped[fuzzyIndex]!, file);
      if (exactKey.length > 0) {
        indexByKey.set(exactKey, fuzzyIndex);
      }
      continue;
    }
    deduped.push(file);
    if (exactKey.length > 0) {
      indexByKey.set(exactKey, deduped.length - 1);
    }
  }
  return deduped;
}

function resolveRewindEngineLabel(engine: RewindPreviewState["engine"]): string {
  if (engine === "codex") {
    return "Codex CLI";
  }
  if (engine === "gemini") {
    return "Gemini CLI";
  }
  return "Claude Code";
}

function buildCompactPreviewLines(diff?: string): ParsedDiffLine[] | null {
  if (!diff?.trim()) {
    return null;
  }

  const contentLines = parseDiff(diff).filter(
    (line) => line.type !== "meta" && line.type !== "hunk",
  );
  if (contentLines.length === 0) {
    return [];
  }

  const changedLineIndices = contentLines.flatMap((line, index) =>
    line.type === "add" || line.type === "del" ? [index] : [],
  );
  if (changedLineIndices.length === 0) {
    return contentLines;
  }

  const visibleLineIndices = new Set<number>();
  for (const changedLineIndex of changedLineIndices) {
    const start = Math.max(0, changedLineIndex - PREVIEW_CONTEXT_RADIUS);
    const end = Math.min(
      contentLines.length - 1,
      changedLineIndex + PREVIEW_CONTEXT_RADIUS,
    );
    for (let cursor = start; cursor <= end; cursor += 1) {
      visibleLineIndices.add(cursor);
    }
  }

  const compactLines: ParsedDiffLine[] = [];
  let lastVisibleIndex = -1;
  for (let index = 0; index < contentLines.length; index += 1) {
    if (!visibleLineIndices.has(index)) {
      continue;
    }
    if (lastVisibleIndex >= 0 && index - lastVisibleIndex > 1) {
      compactLines.push({
        type: "context",
        oldLine: null,
        newLine: null,
        text: "…",
      });
    }
    compactLines.push(contentLines[index] as ParsedDiffLine);
    lastVisibleIndex = index;
  }

  return compactLines;
}

export function ClaudeRewindConfirmDialog({
  preview,
  isBusy = false,
  rewindMode = "messages-and-files",
  shouldShowAffectedFiles = true,
  onRewindModeChange,
  onOpenDiffPath: _onOpenDiffPath,
  onStoreChanges,
  onCancel,
  onConfirm,
}: ClaudeRewindConfirmDialogProps) {
  const { t } = useTranslation();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [isFullDiffOpen, setIsFullDiffOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] =
    useState<ExportRewindFilesResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const reviewFiles = useMemo(() => {
    if (!preview) {
      return [];
    }
    return dedupeReviewFiles(preview.affectedFiles);
  }, [preview]);

  const selectedFile = useMemo(() => {
    if (!preview || reviewFiles.length === 0) {
      return null;
    }
    return (
      reviewFiles.find(
        (file) => file.filePath === selectedFilePath,
      ) ??
      reviewFiles[0] ??
      null
    );
  }, [preview, reviewFiles, selectedFilePath]);

  const selectedPreviewLines = useMemo(
    () => buildCompactPreviewLines(selectedFile?.diff),
    [selectedFile?.diff],
  );
  const selectedDiffLanguage = useMemo(
    () => languageFromPath(selectedFile?.filePath),
    [selectedFile?.filePath],
  );
  const selectedFullDiffLines = useMemo(
    () => parseDiff(selectedFile?.diff ?? ""),
    [selectedFile?.diff],
  );
  const hasStructuredFullDiff = selectedFullDiffLines.length > 0;
  const showMessageImpact = rewindMode !== "files-only";
  const showFileReview = rewindMode !== "messages-only" && shouldShowAffectedFiles;
  const impactCards = [
    {
      key: "messages",
      value: preview?.removedUserMessageCount ?? 0,
      label: t("rewind.impactUserMessages"),
    },
    {
      key: "assistant",
      value: preview?.removedAssistantMessageCount ?? 0,
      label: t("rewind.impactAssistantMessages"),
    },
    {
      key: "tools",
      value: preview?.removedToolCallCount ?? 0,
      label: t("rewind.impactToolCalls"),
    },
    ...(shouldShowAffectedFiles
      ? [
          {
            key: "files",
            value: reviewFiles.length,
            label: t("rewind.impactFiles"),
          },
        ]
      : []),
  ];

  useEffect(() => {
    if (!preview || isBusy) {
      return;
    }
    cancelButtonRef.current?.focus();
  }, [isBusy, preview]);

  useEffect(() => {
    if (!preview) {
      setSelectedFilePath(null);
      setIsFullDiffOpen(false);
      setExportResult(null);
      setExportError(null);
      return;
    }
    const fallbackPath = reviewFiles[0]?.filePath ?? null;
    setSelectedFilePath((current) => {
      if (
        current &&
        reviewFiles.some((file) => file.filePath === current)
      ) {
        return current;
      }
      return fallbackPath;
    });
    setIsFullDiffOpen(false);
    setExportResult(null);
    setExportError(null);
  }, [preview, reviewFiles]);

  useEffect(() => {
    if (!preview) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusy && !isExporting) {
        event.preventDefault();
        if (isFullDiffOpen) {
          setIsFullDiffOpen(false);
          return;
        }
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBusy, isExporting, isFullDiffOpen, onCancel, preview]);

  if (!preview) {
    return null;
  }

  const handleStoreChanges = async () => {
    if (!onStoreChanges || isExporting) {
      return;
    }
    setIsExporting(true);
    setExportError(null);
    setExportResult(null);
    try {
      const result = await onStoreChanges(preview);
      setExportResult(result);
    } catch (error) {
      setExportError(
        (error instanceof Error ? error.message : String(error)) ||
          t("rewind.storeFailed"),
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleRevealStoredChanges = async () => {
    if (!exportResult?.outputPath) {
      return;
    }
    try {
      await revealItemInDir(exportResult.outputPath);
    } catch (error) {
      setExportError(
        (error instanceof Error ? error.message : String(error)) ||
          t("rewind.storeRevealFailed"),
      );
    }
  };

  return (
    <div
      className="claude-rewind-modal fixed inset-0 z-[58] flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="claude-rewind-dialog-title"
      aria-describedby="claude-rewind-dialog-description"
      data-testid="claude-rewind-dialog"
    >
      <div
        className="claude-rewind-modal-backdrop absolute inset-0 bg-[rgb(8_12_20/0.68)] backdrop-blur-md"
        onClick={() => {
          if (!isBusy && !isExporting) {
            onCancel();
          }
        }}
      />
      <div
        className="claude-rewind-modal-card relative flex max-h-[calc(100vh-24px)] w-[min(1540px,calc(100vw-12px))] flex-col overflow-hidden rounded-3xl border border-[color-mix(in_srgb,var(--border-stronger),transparent_12%)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-popover,var(--surface-card))_96%,#0b1220_4%),color-mix(in_srgb,var(--surface-card)_92%,#0b1220_8%))] shadow-[0_28px_80px_rgba(0,0,0,0.42),0_0_0_1px_color-mix(in_srgb,#2563eb_10%,transparent)] max-sm:w-full max-sm:rounded-[20px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="claude-rewind-modal-header flex flex-col gap-2.5 border-b border-[color-mix(in_srgb,var(--border-subtle)_80%,transparent)] px-6 pt-5 pb-4 max-sm:px-4">
          <div className="claude-rewind-modal-heading flex flex-col gap-1.5">
            <div className="claude-rewind-modal-heading-main flex flex-wrap items-center gap-2.5">
              <div className="claude-rewind-modal-kicker inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,#2563eb_48%,transparent)] bg-[color-mix(in_srgb,#2563eb_28%,transparent)] px-2.5 py-[5px] text-[11px] font-bold uppercase tracking-[0.1em] text-[#dbeafe]">
                {resolveRewindEngineLabel(preview.engine)}
              </div>
              <h3
                id="claude-rewind-dialog-title"
                className="m-0 text-3xl font-bold leading-[1.08] text-[var(--text-strong)] max-sm:text-2xl"
              >
                {t("rewind.dialogTitle", {
                  engine: resolveRewindEngineLabel(preview.engine),
                })}
              </h3>
            </div>
            <p
              id="claude-rewind-dialog-description"
              className="m-0 text-sm leading-[1.45] text-[var(--text-muted)]"
            >
              {t("rewind.dialogDescription")}
            </p>
          </div>
        </div>

        <div className="claude-rewind-modal-body flex flex-col gap-[18px] overflow-y-auto px-6 pt-[22px] pb-2.5 max-sm:px-4">
          <section className="claude-rewind-modal-section flex flex-col gap-3">
            <div className="claude-rewind-modal-section-label text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {t("rewind.targetSectionTitle")}
            </div>
            <div className="claude-rewind-modal-target-card flex flex-col gap-2.5 rounded-[18px] border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-card)_92%,transparent),color-mix(in_srgb,var(--surface-elevated,var(--surface-card))_88%,transparent))] px-[18px] py-4">
              <div className="claude-rewind-modal-target-label text-xs text-[var(--text-faint)]">
                {t("rewind.targetMessageLabel")}
              </div>
              <div className="claude-rewind-modal-target-preview whitespace-pre-wrap break-words text-[15px] leading-[1.65] text-[var(--text-strong)]">
                {preview.preview}
              </div>
            </div>
          </section>

          <section className="claude-rewind-modal-section flex flex-col gap-3">
            <div className="claude-rewind-modal-section-label text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {t("rewind.workspaceRestoreSectionTitle")}
            </div>
            <div
              className="claude-rewind-modal-mode-list grid grid-cols-3 gap-2.5 max-md:grid-cols-1"
              role="radiogroup"
              data-testid="claude-rewind-mode-list"
            >
              {(
                [
                  {
                    mode: "messages-and-files" as const,
                    title: t("rewind.modeMessagesAndFilesLabel"),
                    hint: t("rewind.modeMessagesAndFilesHint"),
                  },
                  {
                    mode: "messages-only" as const,
                    title: t("rewind.modeMessagesOnlyLabel"),
                    hint: t("rewind.modeMessagesOnlyHint"),
                  },
                  {
                    mode: "files-only" as const,
                    title: t("rewind.modeFilesOnlyLabel"),
                    hint: t("rewind.modeFilesOnlyHint"),
                  },
                ] satisfies Array<{
                  mode: RewindMode;
                  title: string;
                  hint: string;
                }>
              ).map((option) => {
                const isModeSelected = rewindMode === option.mode;
                return (
                  <label
                    key={option.mode}
                    className={`claude-rewind-modal-mode-option relative flex min-h-14 cursor-pointer items-center justify-center gap-2.5 rounded-[14px] border bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-card)_92%,transparent),color-mix(in_srgb,var(--surface-elevated,var(--surface-card))_88%,transparent))] px-3.5 py-3 ${isModeSelected ? "is-selected border-[rgba(37,99,235,0.42)] shadow-[inset_0_0_0_1px_rgba(37,99,235,0.16)]" : "border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)]"}`}
                  >
                    <input
                      type="radio"
                      name="claude-rewind-mode"
                      value={option.mode}
                      checked={rewindMode === option.mode}
                      onChange={() => {
                        onRewindModeChange?.(option.mode);
                      }}
                      disabled={isBusy || isExporting}
                      className="claude-rewind-modal-mode-input peer pointer-events-none absolute h-px w-px opacity-0"
                      data-testid={`claude-rewind-mode-${option.mode}`}
                    />
                    <span
                      className="claude-rewind-modal-mode-indicator relative inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--border-subtle),transparent_6%)] bg-[color-mix(in_srgb,var(--surface-card-muted),#0f172a_28%)] transition-[background-color,border-color] duration-[180ms] ease-in peer-checked:border-[rgba(37,99,235,0.56)] peer-checked:bg-[rgba(37,99,235,0.35)] peer-disabled:opacity-[0.72] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color-mix(in_srgb,#60a5fa_82%,transparent)]"
                      aria-hidden
                    >
                      <span
                        className={`claude-rewind-modal-mode-indicator-dot absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#dbeafe] transition-[transform,background-color] duration-[180ms] ease-in ${isModeSelected ? "scale-100" : "scale-0"}`}
                      />
                    </span>
                    <span className="claude-rewind-modal-mode-copy flex min-w-0 flex-col gap-0.5 peer-disabled:opacity-[0.72]">
                      <span className="claude-rewind-modal-mode-title text-[13px] font-bold leading-[1.25] text-[var(--text-strong)]">
                        {option.title}
                      </span>
                      <span
                        className="claude-rewind-modal-mode-hint hidden"
                        aria-hidden="true"
                      >
                        {option.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          {showMessageImpact ? (
            <section
              className="claude-rewind-modal-section flex flex-col gap-3"
              data-testid="claude-rewind-message-impact-section"
            >
              <div className="claude-rewind-modal-section-label text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                {t("rewind.impactSectionTitle")}
              </div>
              <div
                className="claude-rewind-modal-impact-grid grid grid-cols-4 gap-3 max-md:grid-cols-2 max-sm:grid-cols-1"
                data-impact-count={impactCards.length}
              >
                {impactCards.map((card) => (
                  <article
                    key={card.key}
                    className="claude-rewind-modal-impact-card flex min-h-[92px] flex-col gap-1.5 rounded-[18px] border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-card)_92%,transparent),color-mix(in_srgb,var(--surface-elevated,var(--surface-card))_88%,transparent))] p-4"
                  >
                    <span className="claude-rewind-modal-impact-value text-[28px] font-extrabold leading-none text-[var(--text-strong)]">
                      {card.value}
                    </span>
                    <span className="claude-rewind-modal-impact-label text-xs leading-[1.5] text-[var(--text-muted)]">
                      {card.label}
                    </span>
                  </article>
                ))}
              </div>
              <div className="claude-rewind-modal-impact-note rounded-[18px] border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-card)_92%,transparent),color-mix(in_srgb,var(--surface-elevated,var(--surface-card))_88%,transparent))] px-4 py-3.5">
                <p className="m-0 text-[13px] leading-[1.65] text-[color-mix(in_srgb,#fb923c_72%,var(--text-muted))]">
                  {t("rewind.impactSummary")}
                </p>
                <p className="m-0 text-[13px] leading-[1.65] text-[color-mix(in_srgb,#fb923c_72%,var(--text-muted))]">
                  {t("rewind.impactFollowUp")}
                </p>
              </div>
            </section>
          ) : null}

          {showFileReview ? (
            <section
              className="claude-rewind-modal-section flex flex-col gap-3"
              data-testid="claude-rewind-file-review-section"
            >
              <div className="claude-rewind-modal-section-label text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                {t("rewind.filesSectionTitle")}
              </div>
              {reviewFiles.length > 0 ? (
                <div className="claude-rewind-modal-review-layout grid min-h-[360px] grid-cols-[minmax(280px,0.52fr)_minmax(0,2.28fr)] gap-3 max-md:grid-cols-1">
                  <div className="claude-rewind-modal-file-rail flex min-w-0 flex-col overflow-hidden rounded-[18px] border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-card)_92%,transparent),color-mix(in_srgb,var(--surface-elevated,var(--surface-card))_88%,transparent))]">
                    <div className="claude-rewind-modal-file-rail-header flex items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] px-4 pb-3 pt-3.5 text-xs font-bold uppercase tracking-[0.08em] text-[var(--text-faint)]">
                      <span>{t("rewind.filesRailTitle")}</span>
                      <span className="claude-rewind-modal-file-rail-count inline-flex h-6 min-w-7 items-center justify-center rounded-full bg-[color-mix(in_srgb,#2563eb_20%,transparent)] px-2 text-[#dbeafe]">
                        {reviewFiles.length}
                      </span>
                    </div>
                    <div className="claude-rewind-modal-file-rail-list flex min-h-0 max-h-[min(58vh,560px)] flex-col gap-1.5 overflow-y-auto p-2 max-md:max-h-[260px]">
                      {reviewFiles.map((file) => {
                        const isSelected =
                          file.filePath === selectedFile?.filePath;
                        const statusKey = file.status.toLowerCase();
                        const statusColor =
                          statusKey === "a"
                            ? "text-[#22c55e]"
                            : statusKey === "m"
                              ? "text-[#60a5fa]"
                              : statusKey === "d"
                                ? "text-[#f87171]"
                                : statusKey === "r"
                                  ? "text-[#c084fc]"
                                  : "text-[var(--text-muted)]";
                        return (
                          <button
                            key={file.filePath}
                            type="button"
                            className={`claude-rewind-modal-file-item grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left font-[inherit] text-[inherit] transition-[border-color,background-color,transform] duration-[140ms] ease-in hover:border-[color-mix(in_srgb,#2563eb_28%,var(--border-subtle))] hover:bg-[color-mix(in_srgb,var(--surface-elevated,var(--surface-card))_92%,transparent)] max-sm:grid-cols-[auto_minmax(0,1fr)] ${isSelected ? "is-selected -translate-y-px border border-[color-mix(in_srgb,#2563eb_42%,transparent)] bg-[color-mix(in_srgb,#2563eb_10%,var(--surface-card))] shadow-[inset_0_0_0_1px_color-mix(in_srgb,#2563eb_18%,transparent)]" : "border border-[color-mix(in_srgb,var(--border-subtle)_70%,transparent)] bg-[color-mix(in_srgb,var(--surface-card)_82%,transparent)]"}`}
                            onClick={() => {
                              setSelectedFilePath(file.filePath);
                              setExportError(null);
                            }}
                            data-testid={`claude-rewind-file-${file.fileName}`}
                          >
                            <span
                              className="claude-rewind-modal-file-icon inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center"
                              aria-hidden
                            >
                              <FileIcon filePath={file.filePath} />
                            </span>
                            <span className="claude-rewind-modal-file-main flex min-w-0 flex-col gap-0.5">
                              <span className="claude-rewind-modal-file-title-row flex min-w-0 items-center gap-2">
                                <span
                                  className="claude-rewind-modal-file-name min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-bold text-[var(--text-strong)]"
                                  title={file.filePath}
                                >
                                  {file.fileName}
                                </span>
                                <span
                                  className={`claude-rewind-modal-file-status-text is-${statusKey} inline-flex items-center whitespace-nowrap text-[11px] font-bold ${statusColor}`}
                                >
                                  {formatFileStatusLabel(t, file.status)}
                                </span>
                              </span>
                            </span>
                            <span className="claude-rewind-modal-file-stats inline-flex items-center gap-2 whitespace-nowrap text-xs font-bold max-sm:col-start-2 max-sm:justify-self-start">
                              <span className="is-add text-[#22c55e]">
                                +{file.additions}
                              </span>
                              <span className="is-del text-[#f87171]">
                                -{file.deletions}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="claude-rewind-modal-diff-panel flex min-h-[320px] min-w-0 flex-col overflow-hidden rounded-[18px] border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-card)_92%,transparent),color-mix(in_srgb,var(--surface-elevated,var(--surface-card))_88%,transparent))]">
                    {selectedFile ? (
                      <>
                        <div className="claude-rewind-modal-diff-header flex items-start justify-between gap-4 border-b border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] px-4 pb-3 pt-3.5 max-md:flex-col max-md:items-stretch">
                          <div className="claude-rewind-modal-diff-heading flex min-w-0 flex-col gap-2.5">
                            <div className="claude-rewind-modal-diff-title-row flex items-start gap-3">
                              <span
                                className="claude-rewind-modal-file-icon inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center"
                                aria-hidden
                              >
                                <FileIcon filePath={selectedFile.filePath} />
                              </span>
                              <div className="claude-rewind-modal-diff-title-group flex min-w-0 flex-col gap-0.5">
                                <strong
                                  className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] text-[var(--text-strong)]"
                                  title={selectedFile.filePath}
                                >
                                  {selectedFile.fileName}
                                </strong>
                                <code className="break-words text-xs text-[var(--text-faint)]">
                                  {selectedFile.filePath}
                                </code>
                              </div>
                            </div>
                            <div className="claude-rewind-modal-diff-meta inline-flex flex-wrap items-center gap-3 text-xs font-bold text-[var(--text-muted)]">
                              <span
                                className={`claude-rewind-modal-file-status-text is-${selectedFile.status.toLowerCase()} inline-flex items-center whitespace-nowrap text-[11px] font-bold ${
                                  selectedFile.status === "A"
                                    ? "text-[#22c55e]"
                                    : selectedFile.status === "M"
                                      ? "text-[#60a5fa]"
                                      : selectedFile.status === "D"
                                        ? "text-[#f87171]"
                                        : selectedFile.status === "R"
                                          ? "text-[#c084fc]"
                                          : "text-[var(--text-muted)]"
                                }`}
                              >
                                {formatFileStatusLabel(t, selectedFile.status)}
                              </span>
                              <span className="is-add text-[#22c55e]">
                                +{selectedFile.additions}
                              </span>
                              <span className="is-del text-[#f87171]">
                                -{selectedFile.deletions}
                              </span>
                            </div>
                          </div>
                          <div className="claude-rewind-modal-diff-actions inline-flex items-center gap-2">
                            <button
                              type="button"
                              className="ghost claude-rewind-modal-inline-button min-h-[34px] rounded-[10px]"
                              onClick={() => setIsFullDiffOpen(true)}
                              data-testid="claude-rewind-open-diff-button"
                            >
                              {t("rewind.openDiffAction")}
                            </button>
                          </div>
                        </div>
                        {selectedPreviewLines ? (
                          <div
                            className="claude-rewind-modal-diff-content min-h-0 overflow-auto pb-2.5 pt-2"
                            data-testid="claude-rewind-diff-preview"
                          >
                            <div className="diff-viewer-output diff-viewer-output-flat claude-rewind-modal-diff-theme">
                              <div
                                className="diffs-container"
                                data-diff-style="unified"
                              >
                                <DiffBlock
                                  diff={selectedFile.diff ?? ""}
                                  language={selectedDiffLanguage}
                                  diffStyle="unified"
                                  showLineNumbers
                                  showHunkHeaders={false}
                                  parsedLines={selectedPreviewLines}
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="claude-rewind-modal-empty rounded-2xl border border-dashed border-[color-mix(in_srgb,var(--border-subtle)_80%,transparent)] bg-[color-mix(in_srgb,var(--surface-card)_78%,transparent)] px-4 py-3.5 text-xs leading-[1.6] text-[var(--text-faint)]">
                            {t("rewind.diffEmpty")}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="claude-rewind-modal-empty rounded-2xl border border-dashed border-[color-mix(in_srgb,var(--border-subtle)_80%,transparent)] bg-[color-mix(in_srgb,var(--surface-card)_78%,transparent)] px-4 py-3.5 text-xs leading-[1.6] text-[var(--text-faint)]">
                        {t("rewind.filesEmpty")}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="claude-rewind-modal-empty rounded-2xl border border-dashed border-[color-mix(in_srgb,var(--border-subtle)_80%,transparent)] bg-[color-mix(in_srgb,var(--surface-card)_78%,transparent)] px-4 py-3.5 text-xs leading-[1.6] text-[var(--text-faint)]">
                  {t("rewind.filesEmpty")}
                </div>
              )}
              <div className="claude-rewind-modal-files-hint text-xs leading-[1.6] text-[var(--text-faint)]">
                {t("rewind.filesHint")}
              </div>
            </section>
          ) : null}
        </div>

        <div className="claude-rewind-modal-actions flex items-center justify-between gap-3.5 border-t border-[color-mix(in_srgb,var(--border-subtle)_80%,transparent)] bg-[color-mix(in_srgb,var(--surface-card)_94%,transparent)] px-6 pb-[22px] pt-[18px] max-sm:flex-col max-sm:items-stretch">
          {(exportResult || exportError) && (
            <div
              className={`claude-rewind-modal-store-feedback claude-rewind-modal-store-feedback--inline mr-3.5 flex min-w-0 flex-1 flex-col gap-2 rounded-[14px] border px-3.5 py-3 text-xs leading-[1.6] max-sm:mr-0 max-sm:w-full ${exportError ? "is-error border-[color-mix(in_srgb,#ef4444_32%,transparent)] bg-[color-mix(in_srgb,var(--surface-card)_78%,transparent)] text-[#fca5a5]" : "is-success border-[color-mix(in_srgb,#22c55e_36%,transparent)] bg-[color-mix(in_srgb,#22c55e_10%,var(--surface-card))] text-[var(--text-muted)]"}`}
              role="status"
              aria-live="polite"
              data-testid="claude-rewind-store-feedback"
            >
              {exportError ? (
                <span>{exportError}</span>
              ) : (
                <>
                  <div className="claude-rewind-modal-store-feedback-copy min-w-0">
                    <span className="claude-rewind-modal-store-feedback-title text-[13px] font-bold text-[var(--text-strong)]">
                      {t("rewind.storeSuccessTitle", {
                        count: exportResult?.fileCount ?? 0,
                      })}
                    </span>
                    <span>{t("rewind.storeSuccessPrefix")}</span>
                    <code className="block break-words text-[var(--text-strong)]">
                      {exportResult?.outputPath ?? ""}
                    </code>
                  </div>
                  <div className="claude-rewind-modal-store-feedback-actions flex justify-start">
                    <button
                      type="button"
                      className="ghost claude-rewind-modal-inline-button min-h-[34px] rounded-[10px]"
                      onClick={() => {
                        void handleRevealStoredChanges();
                      }}
                      data-testid="claude-rewind-reveal-store-button"
                    >
                      {t("rewind.storeRevealAction")}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <div className="claude-rewind-modal-actions-primary flex flex-none justify-end gap-2.5 max-sm:w-full max-sm:flex-col-reverse">
            <button
              type="button"
              className="ghost claude-rewind-modal-button min-h-[38px] min-w-32 rounded-[12px] max-sm:w-full"
              onClick={handleStoreChanges}
              disabled={
                isBusy ||
                isExporting ||
                !onStoreChanges ||
                preview.affectedFiles.length === 0
              }
              data-testid="claude-rewind-store-button"
            >
              {isExporting
                ? t("rewind.storeActionBusy")
                : t("rewind.storeAction")}
            </button>
            <button
              ref={cancelButtonRef}
              type="button"
              className="ghost claude-rewind-modal-button min-h-[38px] min-w-32 rounded-[12px] max-sm:w-full"
              onClick={onCancel}
              disabled={isBusy || isExporting}
              data-testid="claude-rewind-cancel-button"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="primary claude-rewind-modal-button claude-rewind-modal-button--confirm min-h-[38px] min-w-32 rounded-[12px] border border-[color-mix(in_srgb,#2563eb,transparent_18%)] bg-[linear-gradient(180deg,#2563eb_0%,#1d4ed8_100%)] text-[#eef4ff] shadow-[0_12px_24px_rgba(37,99,235,0.24)] disabled:shadow-none max-sm:w-full"
              onClick={() => {
                void onConfirm();
              }}
              disabled={isBusy || isExporting}
              data-testid="claude-rewind-confirm-button"
            >
              {isBusy
                ? t("rewind.confirmActionBusy")
                : t("rewind.confirmAction")}
            </button>
          </div>
        </div>

        {isFullDiffOpen && selectedFile ? (
          <div
            className="claude-rewind-modal-full-diff-overlay absolute inset-0 z-[5] flex items-stretch justify-center bg-[rgb(6_10_18/0.72)] p-[18px] backdrop-blur-[10px] max-sm:p-3"
            role="presentation"
            onClick={() => setIsFullDiffOpen(false)}
            data-testid="claude-rewind-full-diff-overlay"
          >
            <div
              className="claude-rewind-modal-full-diff-card flex h-full w-[min(1440px,100%)] flex-col overflow-hidden rounded-[20px] border border-[color-mix(in_srgb,var(--border-stronger)_82%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-popover,var(--surface-card))_98%,#0b1220_2%),color-mix(in_srgb,var(--surface-card)_92%,#0b1220_8%))] shadow-[0_24px_72px_rgba(0,0,0,0.42)]"
              role="dialog"
              aria-modal="true"
              aria-label={selectedFile.filePath}
              onClick={(event) => event.stopPropagation()}
              data-testid="claude-rewind-full-diff-dialog"
            >
              <div className="claude-rewind-modal-full-diff-header flex items-start justify-between gap-4 border-b border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] px-5 pb-3.5 pt-[18px] max-md:flex-col max-md:items-stretch">
                <div className="claude-rewind-modal-diff-title-row flex items-start gap-3">
                  <span
                    className="claude-rewind-modal-file-icon inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center"
                    aria-hidden
                  >
                    <FileIcon filePath={selectedFile.filePath} />
                  </span>
                  <div className="claude-rewind-modal-diff-title-group flex min-w-0 flex-col gap-0.5">
                    <strong
                      className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] text-[var(--text-strong)]"
                      title={selectedFile.filePath}
                    >
                      {selectedFile.fileName}
                    </strong>
                    <code className="break-words text-xs text-[var(--text-faint)]">
                      {selectedFile.filePath}
                    </code>
                  </div>
                </div>
                <div className="claude-rewind-modal-full-diff-actions inline-flex flex-wrap items-center justify-end gap-2.5">
                  <span
                    className={`claude-rewind-modal-file-status-text is-${selectedFile.status.toLowerCase()} inline-flex items-center whitespace-nowrap text-[11px] font-bold ${
                      selectedFile.status === "A"
                        ? "text-[#22c55e]"
                        : selectedFile.status === "M"
                          ? "text-[#60a5fa]"
                          : selectedFile.status === "D"
                            ? "text-[#f87171]"
                            : selectedFile.status === "R"
                              ? "text-[#c084fc]"
                              : "text-[var(--text-muted)]"
                    }`}
                  >
                    {formatFileStatusLabel(t, selectedFile.status)}
                  </span>
                  <span className="claude-rewind-modal-diff-meta inline-flex flex-wrap items-center gap-3 text-xs font-bold text-[var(--text-muted)]">
                    <span className="is-add text-[#22c55e]">
                      +{selectedFile.additions}
                    </span>
                    <span className="is-del text-[#f87171]">
                      -{selectedFile.deletions}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="ghost claude-rewind-modal-inline-button min-h-[34px] rounded-[10px]"
                    onClick={() => setIsFullDiffOpen(false)}
                    data-testid="claude-rewind-full-diff-close-button"
                  >
                    {t("common.close")}
                  </button>
                </div>
              </div>

              <div className="claude-rewind-modal-full-diff-body min-h-0 flex-1 overflow-auto">
                {selectedFile.diff?.trim() ? (
                  hasStructuredFullDiff ? (
                    <div className="claude-rewind-modal-full-diff-content pb-3.5 pt-2.5">
                      <div className="diff-viewer-output diff-viewer-output-flat claude-rewind-modal-diff-theme claude-rewind-modal-full-diff-theme">
                        <div
                          className="diffs-container"
                          data-diff-style="unified"
                        >
                          <DiffBlock
                            diff={selectedFile.diff}
                            language={selectedDiffLanguage}
                            diffStyle="unified"
                            showLineNumbers
                            showHunkHeaders
                            parsedLines={selectedFullDiffLines}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <pre
                      className="claude-rewind-modal-full-diff-raw m-0 whitespace-pre-wrap break-words px-5 pb-[22px] pt-[18px] font-[inherit] text-[var(--text-strong)]"
                      data-testid="claude-rewind-full-diff-raw"
                    >
                      {selectedFile.diff}
                    </pre>
                  )
                ) : (
                  <div className="claude-rewind-modal-empty rounded-2xl border border-dashed border-[color-mix(in_srgb,var(--border-subtle)_80%,transparent)] bg-[color-mix(in_srgb,var(--surface-card)_78%,transparent)] px-4 py-3.5 text-xs leading-[1.6] text-[var(--text-faint)]">
                    {t("rewind.diffEmpty")}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
