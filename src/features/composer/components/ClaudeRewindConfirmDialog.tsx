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
      className="claude-rewind-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="claude-rewind-dialog-title"
      aria-describedby="claude-rewind-dialog-description"
      data-testid="claude-rewind-dialog"
    >
      <div
        className="claude-rewind-modal-backdrop"
        onClick={() => {
          if (!isBusy && !isExporting) {
            onCancel();
          }
        }}
      />
      <div
        className="claude-rewind-modal-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="claude-rewind-modal-header">
          <div className="claude-rewind-modal-heading">
            <div className="claude-rewind-modal-heading-main">
              <div className="claude-rewind-modal-kicker">
                {resolveRewindEngineLabel(preview.engine)}
              </div>
              <h3 id="claude-rewind-dialog-title">
                {t("rewind.dialogTitle", {
                  engine: resolveRewindEngineLabel(preview.engine),
                })}
              </h3>
            </div>
            <p id="claude-rewind-dialog-description">
              {t("rewind.dialogDescription")}
            </p>
          </div>
        </div>

        <div className="claude-rewind-modal-body">
          <section className="claude-rewind-modal-section">
            <div className="claude-rewind-modal-section-label">
              {t("rewind.targetSectionTitle")}
            </div>
            <div className="claude-rewind-modal-target-card">
              <div className="claude-rewind-modal-target-label">
                {t("rewind.targetMessageLabel")}
              </div>
              <div className="claude-rewind-modal-target-preview">
                {preview.preview}
              </div>
            </div>
          </section>

          <section className="claude-rewind-modal-section">
            <div className="claude-rewind-modal-section-label">
              {t("rewind.workspaceRestoreSectionTitle")}
            </div>
            <div
              className="claude-rewind-modal-mode-list"
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
              ).map((option) => (
                <label
                  key={option.mode}
                  className={`claude-rewind-modal-mode-option${rewindMode === option.mode ? " is-selected" : ""}`}
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
                    className="claude-rewind-modal-mode-input"
                    data-testid={`claude-rewind-mode-${option.mode}`}
                  />
                  <span className="claude-rewind-modal-mode-indicator" aria-hidden>
                    <span className="claude-rewind-modal-mode-indicator-dot" />
                  </span>
                  <span className="claude-rewind-modal-mode-copy">
                    <span className="claude-rewind-modal-mode-title">
                      {option.title}
                    </span>
                    <span
                      className="claude-rewind-modal-mode-hint"
                      aria-hidden="true"
                    >
                      {option.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {showMessageImpact ? (
            <section
              className="claude-rewind-modal-section"
              data-testid="claude-rewind-message-impact-section"
            >
              <div className="claude-rewind-modal-section-label">
                {t("rewind.impactSectionTitle")}
              </div>
              <div
                className="claude-rewind-modal-impact-grid"
                data-impact-count={impactCards.length}
              >
                {impactCards.map((card) => (
                  <article
                    key={card.key}
                    className="claude-rewind-modal-impact-card"
                  >
                    <span className="claude-rewind-modal-impact-value">
                      {card.value}
                    </span>
                    <span className="claude-rewind-modal-impact-label">
                      {card.label}
                    </span>
                  </article>
                ))}
              </div>
              <div className="claude-rewind-modal-impact-note">
                <p>{t("rewind.impactSummary")}</p>
                <p>{t("rewind.impactFollowUp")}</p>
              </div>
            </section>
          ) : null}

          {showFileReview ? (
            <section
              className="claude-rewind-modal-section"
              data-testid="claude-rewind-file-review-section"
            >
              <div className="claude-rewind-modal-section-label">
                {t("rewind.filesSectionTitle")}
              </div>
              {reviewFiles.length > 0 ? (
                <div className="claude-rewind-modal-review-layout">
                  <div className="claude-rewind-modal-file-rail">
                    <div className="claude-rewind-modal-file-rail-header">
                      <span>{t("rewind.filesRailTitle")}</span>
                      <span className="claude-rewind-modal-file-rail-count">
                        {reviewFiles.length}
                      </span>
                    </div>
                    <div className="claude-rewind-modal-file-rail-list">
                      {reviewFiles.map((file) => {
                        const isSelected =
                          file.filePath === selectedFile?.filePath;
                        return (
                          <button
                            key={file.filePath}
                            type="button"
                            className={`claude-rewind-modal-file-item${isSelected ? " is-selected" : ""}`}
                            onClick={() => {
                              setSelectedFilePath(file.filePath);
                              setExportError(null);
                            }}
                            data-testid={`claude-rewind-file-${file.fileName}`}
                          >
                            <span
                              className="claude-rewind-modal-file-icon"
                              aria-hidden
                            >
                              <FileIcon filePath={file.filePath} />
                            </span>
                            <span className="claude-rewind-modal-file-main">
                              <span className="claude-rewind-modal-file-title-row">
                                <span
                                  className="claude-rewind-modal-file-name"
                                  title={file.filePath}
                                >
                                  {file.fileName}
                                </span>
                                <span
                                  className={`claude-rewind-modal-file-status-text is-${file.status.toLowerCase()}`}
                                >
                                  {formatFileStatusLabel(t, file.status)}
                                </span>
                              </span>
                            </span>
                            <span className="claude-rewind-modal-file-stats">
                              <span className="is-add">+{file.additions}</span>
                              <span className="is-del">-{file.deletions}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="claude-rewind-modal-diff-panel">
                    {selectedFile ? (
                      <>
                        <div className="claude-rewind-modal-diff-header">
                          <div className="claude-rewind-modal-diff-heading">
                            <div className="claude-rewind-modal-diff-title-row">
                              <span
                                className="claude-rewind-modal-file-icon"
                                aria-hidden
                              >
                                <FileIcon filePath={selectedFile.filePath} />
                              </span>
                              <div className="claude-rewind-modal-diff-title-group">
                                <strong title={selectedFile.filePath}>
                                  {selectedFile.fileName}
                                </strong>
                                <code>{selectedFile.filePath}</code>
                              </div>
                            </div>
                            <div className="claude-rewind-modal-diff-meta">
                              <span
                                className={`claude-rewind-modal-file-status-text is-${selectedFile.status.toLowerCase()}`}
                              >
                                {formatFileStatusLabel(t, selectedFile.status)}
                              </span>
                              <span className="is-add">
                                +{selectedFile.additions}
                              </span>
                              <span className="is-del">
                                -{selectedFile.deletions}
                              </span>
                            </div>
                          </div>
                          <div className="claude-rewind-modal-diff-actions">
                            <button
                              type="button"
                              className="ghost claude-rewind-modal-inline-button"
                              onClick={() => setIsFullDiffOpen(true)}
                              data-testid="claude-rewind-open-diff-button"
                            >
                              {t("rewind.openDiffAction")}
                            </button>
                          </div>
                        </div>
                        {selectedPreviewLines ? (
                          <div
                            className="claude-rewind-modal-diff-content"
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
                          <div className="claude-rewind-modal-empty">
                            {t("rewind.diffEmpty")}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="claude-rewind-modal-empty">
                        {t("rewind.filesEmpty")}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="claude-rewind-modal-empty">
                  {t("rewind.filesEmpty")}
                </div>
              )}
              <div className="claude-rewind-modal-files-hint">
                {t("rewind.filesHint")}
              </div>
            </section>
          ) : null}
        </div>

        <div className="claude-rewind-modal-actions">
          {(exportResult || exportError) && (
            <div
              className={`claude-rewind-modal-store-feedback claude-rewind-modal-store-feedback--inline${exportError ? " is-error" : " is-success"}`}
              role="status"
              aria-live="polite"
              data-testid="claude-rewind-store-feedback"
            >
              {exportError ? (
                <span>{exportError}</span>
              ) : (
                <>
                  <div className="claude-rewind-modal-store-feedback-copy">
                    <span className="claude-rewind-modal-store-feedback-title">
                      {t("rewind.storeSuccessTitle", {
                        count: exportResult?.fileCount ?? 0,
                      })}
                    </span>
                    <span>{t("rewind.storeSuccessPrefix")}</span>
                    <code>{exportResult?.outputPath ?? ""}</code>
                  </div>
                  <div className="claude-rewind-modal-store-feedback-actions">
                    <button
                      type="button"
                      className="ghost claude-rewind-modal-inline-button"
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
          <div className="claude-rewind-modal-actions-primary">
            <button
              type="button"
              className="ghost claude-rewind-modal-button"
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
              className="ghost claude-rewind-modal-button"
              onClick={onCancel}
              disabled={isBusy || isExporting}
              data-testid="claude-rewind-cancel-button"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="primary claude-rewind-modal-button claude-rewind-modal-button--confirm"
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
            className="claude-rewind-modal-full-diff-overlay"
            role="presentation"
            onClick={() => setIsFullDiffOpen(false)}
            data-testid="claude-rewind-full-diff-overlay"
          >
            <div
              className="claude-rewind-modal-full-diff-card"
              role="dialog"
              aria-modal="true"
              aria-label={selectedFile.filePath}
              onClick={(event) => event.stopPropagation()}
              data-testid="claude-rewind-full-diff-dialog"
            >
              <div className="claude-rewind-modal-full-diff-header">
                <div className="claude-rewind-modal-diff-title-row">
                  <span className="claude-rewind-modal-file-icon" aria-hidden>
                    <FileIcon filePath={selectedFile.filePath} />
                  </span>
                  <div className="claude-rewind-modal-diff-title-group">
                    <strong title={selectedFile.filePath}>
                      {selectedFile.fileName}
                    </strong>
                    <code>{selectedFile.filePath}</code>
                  </div>
                </div>
                <div className="claude-rewind-modal-full-diff-actions">
                  <span
                    className={`claude-rewind-modal-file-status-text is-${selectedFile.status.toLowerCase()}`}
                  >
                    {formatFileStatusLabel(t, selectedFile.status)}
                  </span>
                  <span className="claude-rewind-modal-diff-meta">
                    <span className="is-add">+{selectedFile.additions}</span>
                    <span className="is-del">-{selectedFile.deletions}</span>
                  </span>
                  <button
                    type="button"
                    className="ghost claude-rewind-modal-inline-button"
                    onClick={() => setIsFullDiffOpen(false)}
                    data-testid="claude-rewind-full-diff-close-button"
                  >
                    {t("common.close")}
                  </button>
                </div>
              </div>

              <div className="claude-rewind-modal-full-diff-body">
                {selectedFile.diff?.trim() ? (
                  hasStructuredFullDiff ? (
                    <div className="claude-rewind-modal-full-diff-content">
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
                      className="claude-rewind-modal-full-diff-raw"
                      data-testid="claude-rewind-full-diff-raw"
                    >
                      {selectedFile.diff}
                    </pre>
                  )
                ) : (
                  <div className="claude-rewind-modal-empty">
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
