import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import X from "lucide-react/dist/esm/icons/x";
import type { GitHubPullRequest, GitHubPullRequestComment } from "../../../types";
import { getGitFileFullDiff } from "../../../services/tauri";
import { formatRelativeTime } from "../../../utils/time";
import { Markdown } from "../../messages/components/Markdown";
import { ImageDiffCard } from "./ImageDiffCard";
import { DiffBlock } from "./DiffBlock";
import { parseDiff } from "../../../utils/diff";
import { languageFromPath } from "../../../utils/syntax";
import type {
  CodeAnnotationDraftInput,
  CodeAnnotationLineRange,
  CodeAnnotationSource,
  CodeAnnotationSelection,
} from "../../code-annotations/types";
import {
  formatCodeAnnotationLineRange,
  isSameCodeAnnotationPath,
} from "../../code-annotations/utils/codeAnnotations";

type GitDiffViewerItem = {
  path: string;
  status: string;
  diff: string;
  isImage?: boolean;
  oldImageData?: string | null;
  newImageData?: string | null;
  oldImageMime?: string | null;
  newImageMime?: string | null;
};

type GitDiffViewerProps = {
  workspaceId?: string | null;
  diffs: GitDiffViewerItem[];
  listView?: "flat" | "tree";
  stickyHeaderMode?: "full" | "controls-only";
  embeddedAnchorVariant?: "default" | "modal-pager";
  showContentModeControls?: boolean;
  headerControlsTarget?: HTMLElement | null;
  onRequestClose?: (() => void) | null;
  fullDiffLoader?: ((path: string) => Promise<string>) | null;
  fullDiffSourceKey?: string | null;
  selectedPath: string | null;
  scrollRequestId?: number;
  isLoading: boolean;
  error: string | null;
  diffStyle?: "split" | "unified";
  pullRequest?: GitHubPullRequest | null;
  pullRequestComments?: GitHubPullRequestComment[];
  pullRequestCommentsLoading?: boolean;
  pullRequestCommentsError?: string | null;
  onActivePathChange?: (path: string) => void;
  onDiffStyleChange?: (style: "split" | "unified") => void;
  onOpenFile?: (path: string) => void;
  onCreateCodeAnnotation?: (annotation: CodeAnnotationDraftInput) => void;
  onRemoveCodeAnnotation?: (annotationId: string) => void;
  codeAnnotations?: CodeAnnotationSelection[];
  codeAnnotationSurface?: Extract<
    CodeAnnotationSource,
    "embedded-diff-view" | "modal-diff-view"
  >;
};

function normalizePatchName(name: string) {
  if (!name) {
    return name;
  }
  return name.replace(/^(?:a|b)\//, "");
}

type DiffCardProps = {
  entry: GitDiffViewerItem;
  diffText: string;
  isSelected: boolean;
  diffStyle: "split" | "unified";
  contentMode: "all" | "focused";
  onCreateCodeAnnotation?: (annotation: CodeAnnotationDraftInput) => void;
  onRemoveCodeAnnotation?: (annotationId: string) => void;
  codeAnnotations?: CodeAnnotationSelection[];
  codeAnnotationSurface: Extract<
    CodeAnnotationSource,
    "embedded-diff-view" | "modal-diff-view"
  >;
};

const DiffCard = memo(function DiffCard({
  entry,
  diffText,
  isSelected,
  diffStyle,
  contentMode,
  onCreateCodeAnnotation,
  onRemoveCodeAnnotation,
  codeAnnotations = [],
  codeAnnotationSurface,
}: DiffCardProps) {
  const { t } = useTranslation();
  const [annotationDraft, setAnnotationDraft] = useState<{
    lineRange: CodeAnnotationLineRange;
    body: string;
  } | null>(null);
  const [selectedDiffRange, setSelectedDiffRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const hasRenderableDiff = useMemo(
    () => parseDiff(diffText).length > 0,
    [diffText],
  );
  const parsedLines = useMemo(() => parseDiff(diffText), [diffText]);
  const normalizedEntryPath = normalizePatchName(entry.path);
  const visibleCodeAnnotations = useMemo(
    () =>
      codeAnnotations.filter(
        (annotation) =>
          isSameCodeAnnotationPath(annotation.path, normalizedEntryPath) &&
          annotation.source === codeAnnotationSurface,
      ),
    [codeAnnotationSurface, codeAnnotations, normalizedEntryPath],
  );
  const selectedAnnotationLineRange = useMemo(() => {
    if (!selectedDiffRange) {
      return null;
    }
    const selectedLines = parsedLines
      .slice(selectedDiffRange.start, selectedDiffRange.end + 1)
      .filter(
        (line) =>
          (line.type === "add" || line.type === "context") &&
          typeof line.newLine === "number",
      );
    if (selectedLines.length === 0) {
      return null;
    }
    const newLineNumbers = selectedLines.map((line) => line.newLine as number);
    return {
      startLine: Math.min(...newLineNumbers),
      endLine: Math.max(...newLineNumbers),
    };
  }, [parsedLines, selectedDiffRange]);
  const selectedDiffRangeLabel = selectedAnnotationLineRange
    ? selectedAnnotationLineRange.startLine === selectedAnnotationLineRange.endLine
      ? `L${selectedAnnotationLineRange.startLine}`
      : `L${selectedAnnotationLineRange.startLine}-L${selectedAnnotationLineRange.endLine}`
    : null;
  const canCreateCodeAnnotation = Boolean(onCreateCodeAnnotation);

  return (
      <div
        data-diff-path={entry.path}
        className={`diff-viewer-item ${isSelected ? "active" : ""}`}
      >
      <div className="diff-viewer-header">
        <span className="diff-viewer-status" data-status={entry.status}>
          {entry.status}
        </span>
        <span className="diff-viewer-path min-w-0 flex-1 text-(--text-emphasis) overflow-hidden text-ellipsis whitespace-nowrap">
          {normalizePatchName(entry.path)}
        </span>
      </div>
      {diffText.trim().length > 0 && hasRenderableDiff ? (
        <div className="diff-viewer-output diff-viewer-output-flat">
              <div className="diffs-container" data-diffs data-diff-style={diffStyle} data-content-mode={contentMode}>
            {selectedDiffRange && canCreateCodeAnnotation ? (
              <div className="diff-selection-toolbar" role="group" aria-label={t("files.annotationSelectionToolbar")}>
                <span>
                  {selectedDiffRangeLabel ?? t("files.annotationUnavailableForSelection")}
                </span>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setSelectedDiffRange(null)}
                >
                  {t("files.clearSelection")}
                </button>
                <button
                  type="button"
                  className="diff-annotation-submit"
                  onClick={() => {
                    if (!selectedAnnotationLineRange) {
                      return;
                    }
                    setAnnotationDraft({
                      lineRange: selectedAnnotationLineRange,
                      body: "",
                    });
                  }}
                  disabled={!selectedAnnotationLineRange}
                >
                  {t("files.annotateForAi")}
                </button>
              </div>
            ) : null}
            <DiffBlock
              diff={diffText}
              diffStyle={diffStyle}
              language={languageFromPath(entry.path)}
              showHunkHeaders={false}
              showLineNumbers
              parsedLines={parsedLines}
              selectedRange={selectedDiffRange}
              onLineSelect={canCreateCodeAnnotation ? (_line, index, event) => {
                if (event.shiftKey && selectedDiffRange) {
                  setSelectedDiffRange({
                    start: Math.min(selectedDiffRange.start, index),
                    end: Math.max(selectedDiffRange.start, index),
                  });
                  return;
                }
                setSelectedDiffRange({ start: index, end: index });
              } : undefined}
              onAnnotateLine={
                canCreateCodeAnnotation
                  ? (lineRange) => setAnnotationDraft({ lineRange, body: "" })
                  : undefined
              }
              annotationLabel={t("files.annotateForAi")}
              renderLineExtension={(line, _index, mode) => {
                if (mode === "old") {
                  return null;
                }
                if (
                  (line.type !== "add" && line.type !== "context") ||
                  typeof line.newLine !== "number"
                ) {
                  return null;
                }
                const lineAnnotations = visibleCodeAnnotations.filter(
                  (annotation) => annotation.lineRange.endLine === line.newLine,
                );
                const shouldRenderDraft =
                  annotationDraft?.lineRange.endLine === line.newLine;
                if (lineAnnotations.length === 0 && !shouldRenderDraft) {
                  return null;
                }
                return (
                  <>
                    {lineAnnotations.map((annotation) => (
                      <div key={annotation.id} className="diff-annotation-marker" role="note">
                        <div className="diff-annotation-marker-head">
                          <span className="diff-annotation-title">
                            <span className="codicon codicon-comment-discussion" aria-hidden />
                            {t("files.annotationDraft")}
                          </span>
                          <span className="diff-annotation-marker-tools">
                            <code>{formatCodeAnnotationLineRange(annotation.lineRange)}</code>
                            {onRemoveCodeAnnotation ? (
                              <button
                                type="button"
                                className="diff-annotation-remove"
                                onClick={() => onRemoveCodeAnnotation(annotation.id)}
                                title={t("files.annotationRemove")}
                                aria-label={t("files.annotationRemove")}
                              >
                                <span className="codicon codicon-close" aria-hidden />
                              </button>
                            ) : null}
                          </span>
                        </div>
                        <p>{annotation.body}</p>
                      </div>
                    ))}
                    {shouldRenderDraft ? (
                      <div className="diff-annotation-draft diff-annotation-draft-inline" role="region" aria-label={t("files.annotationDraft")}>
                        <div className="diff-annotation-draft-head">
                          <span className="diff-annotation-title">
                            <span className="codicon codicon-comment-discussion" aria-hidden />
                            {t("files.annotationDraft")}
                          </span>
                          <code>
                            {formatCodeAnnotationLineRange(annotationDraft.lineRange)}
                          </code>
                        </div>
                        <textarea
                          value={annotationDraft.body}
                          onChange={(event) => {
                            const nextBody = event.currentTarget.value;
                            setAnnotationDraft((current) =>
                              current ? { ...current, body: nextBody } : current,
                            );
                          }}
                          placeholder={t("files.annotationPlaceholder")}
                          autoFocus
                        />
                        <div className="diff-annotation-draft-actions">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => setAnnotationDraft(null)}
                          >
                            {t("common.cancel")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const body = annotationDraft.body.trim();
                              if (!body) {
                                return;
                              }
                              onCreateCodeAnnotation?.({
                                path: normalizedEntryPath,
                                lineRange: annotationDraft.lineRange,
                                body,
                                source: codeAnnotationSurface,
                              });
                              setAnnotationDraft(null);
                            }}
                            disabled={!annotationDraft.body.trim()}
                          >
                            {t("files.annotationSubmit")}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                );
              }}
            />
          </div>
        </div>
      ) : (
        <div className="diff-viewer-placeholder text-(--text-subtle) text-xs py-2">{t("git.diffUnavailable")}</div>
      )}
    </div>
  );
});

type PullRequestSummaryProps = {
  pullRequest: GitHubPullRequest;
  hasDiffs: boolean;
  diffStats: { additions: number; deletions: number };
  onJumpToFirstFile: () => void;
  pullRequestComments?: GitHubPullRequestComment[];
  pullRequestCommentsLoading: boolean;
  pullRequestCommentsError?: string | null;
};

const PullRequestSummary = memo(function PullRequestSummary({
  pullRequest,
  hasDiffs,
  diffStats,
  onJumpToFirstFile,
  pullRequestComments,
  pullRequestCommentsLoading,
  pullRequestCommentsError,
}: PullRequestSummaryProps) {
  const { t } = useTranslation();
  const prUpdatedLabel = pullRequest.updatedAt
    ? formatRelativeTime(new Date(pullRequest.updatedAt).getTime())
    : null;
  const prAuthor = pullRequest.author?.login ?? "unknown";
  const prBody = pullRequest.body?.trim() ?? "";
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(false);
  const sortedComments = useMemo(() => {
    if (!pullRequestComments?.length) {
      return [];
    }
    return [...pullRequestComments].sort((a, b) => {
      return (
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });
  }, [pullRequestComments]);
  const visibleCommentCount = 3;
  const visibleComments = isTimelineExpanded
    ? sortedComments
    : sortedComments.slice(-visibleCommentCount);
  const hiddenCommentCount = Math.max(
    0,
    sortedComments.length - visibleComments.length,
  );

  useEffect(() => {
    setIsTimelineExpanded(false);
  }, [pullRequest.number]);

  return (
    <section
      className="diff-viewer-pr mx-4 mt-3 mb-4 p-4 rounded-[14px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-strong)_84%,transparent)] shadow-[0_12px_30px_rgba(0,0,0,0.22)]"
      aria-label="Pull request summary"
    >
      <div className="diff-viewer-pr-header flex flex-col gap-2.5">
        <div className="diff-viewer-pr-header-row flex items-start justify-between gap-3">
          <div className="diff-viewer-pr-title flex flex-wrap gap-2 text-[18px] font-semibold text-[var(--text-strong)]">
            <span className="diff-viewer-pr-number text-[var(--text-faint)] tabular-nums">
              #{pullRequest.number}
            </span>
            <span className="diff-viewer-pr-title-text text-[var(--text-stronger)]">
              {pullRequest.title}
            </span>
          </div>
          {hasDiffs && (
            <button
              type="button"
              className="ghost diff-viewer-pr-jump inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] whitespace-nowrap"
              onClick={onJumpToFirstFile}
              aria-label={t("git.jumpToFirstFile")}
            >
              <span className="diff-viewer-pr-jump-add text-[#47d488] tabular-nums">
                +{diffStats.additions}
              </span>
              <span className="diff-viewer-pr-jump-sep text-[var(--text-faint)] tabular-nums">
                /
              </span>
              <span className="diff-viewer-pr-jump-del text-[#ff6b6b] tabular-nums">
                -{diffStats.deletions}
              </span>
            </button>
          )}
        </div>
        <div className="diff-viewer-pr-meta flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
          <span className="diff-viewer-pr-author font-semibold text-[var(--text-strong)]">
            @{prAuthor}
          </span>
          {prUpdatedLabel && (
            <>
              <span className="diff-viewer-pr-sep text-[var(--text-faint)]">·</span>
              <span>{prUpdatedLabel}</span>
            </>
          )}
          <span className="diff-viewer-pr-sep text-[var(--text-faint)]">·</span>
          <span className="diff-viewer-pr-branch font-[var(--code-font-family)] text-[var(--code-font-size,11px)] px-1.5 py-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-control)] text-[var(--text-quiet)]">
            {pullRequest.baseRefName} ← {pullRequest.headRefName}
          </span>
          {pullRequest.isDraft && (
            <span className="diff-viewer-pr-pill px-1.5 py-0.5 rounded-full border border-[#6a4a2a] bg-[#2e2418] text-[#f2994a] text-[11px] font-semibold uppercase">
              {t("git.draft")}
            </span>
          )}
        </div>
      </div>
      <div className="diff-viewer-pr-body mt-3 pt-3 border-t border-[var(--border-subtle)]">
        {prBody ? (
          <Markdown
            value={prBody}
            className="diff-viewer-pr-markdown markdown text-[13px] text-[var(--text-stronger)] [&_:where(h1,h2,h3,h4,h5,h6)]:mt-4 [&_:where(p,ul,ol,pre)]:mt-2.5"
          />
        ) : (
          <div className="diff-viewer-pr-empty text-[13px] text-[var(--text-muted)]">
            {t("git.noDescriptionProvided")}
          </div>
        )}
      </div>
      <div className="diff-viewer-pr-timeline mt-4 pt-3 border-t border-[var(--border-subtle)]">
        <div className="diff-viewer-pr-timeline-header flex flex-wrap items-center gap-2 mb-3 text-xs text-[var(--text-muted)]">
          <span className="diff-viewer-pr-timeline-title font-semibold text-[var(--text-strong)]">
            {t("git.activity")}
          </span>
          <span className="diff-viewer-pr-timeline-count tabular-nums">
            {sortedComments.length} {sortedComments.length === 1 ? t("git.comment") : t("git.comments")}
          </span>
          {hiddenCommentCount > 0 && (
            <button
              type="button"
              className="ghost diff-viewer-pr-timeline-button px-2.5 py-1 text-[11px]"
              onClick={() => setIsTimelineExpanded(true)}
            >
              {t("git.showAll")}
            </button>
          )}
          {isTimelineExpanded &&
            sortedComments.length > visibleCommentCount && (
              <button
                type="button"
                className="ghost diff-viewer-pr-timeline-button px-2.5 py-1 text-[11px]"
                onClick={() => setIsTimelineExpanded(false)}
              >
                {t("git.collapse")}
              </button>
            )}
        </div>
        <div className="diff-viewer-pr-timeline-list relative flex flex-col gap-3.5 pl-3.5 before:content-[''] before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-0.5 before:bg-[color-mix(in_srgb,var(--border-strong)_40%,transparent)]">
          {pullRequestCommentsLoading && (
            <div className="diff-viewer-pr-timeline-state pl-3 text-xs text-[var(--text-muted)]">
              {t("git.loadingComments")}
            </div>
          )}
          {pullRequestCommentsError && (
            <div className="diff-viewer-pr-timeline-state diff-viewer-pr-timeline-error pl-3 text-xs text-[var(--text-error,#ff8d8d)]">
              {pullRequestCommentsError}
            </div>
          )}
          {!pullRequestCommentsLoading &&
            !pullRequestCommentsError &&
            !sortedComments.length && (
              <div className="diff-viewer-pr-timeline-state pl-3 text-xs text-[var(--text-muted)]">
                {t("git.noCommentsYet")}
              </div>
            )}
          {hiddenCommentCount > 0 && !isTimelineExpanded && (
            <div className="diff-viewer-pr-timeline-divider pl-3 text-xs text-[var(--text-faint)]">
              {hiddenCommentCount} {hiddenCommentCount === 1 ? t("git.earlierComment") : t("git.earlierComments")}
            </div>
          )}
          {visibleComments.map((comment) => {
            const commentAuthor = comment.author?.login ?? "unknown";
            const commentTime = formatRelativeTime(
              new Date(comment.createdAt).getTime(),
            );
            return (
              <div
                key={comment.id}
                className="diff-viewer-pr-timeline-item relative flex gap-3"
              >
                <div className="diff-viewer-pr-timeline-marker relative z-[1] w-3 h-3 mt-[3px] rounded-full bg-[var(--surface-control)] border-2 border-[var(--border-strong)] shrink-0" />
                <div className="diff-viewer-pr-timeline-content flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-strong)_78%,transparent)]">
                  <div className="diff-viewer-pr-timeline-meta flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    <span className="diff-viewer-pr-timeline-author font-semibold text-[var(--text-strong)]">
                      @{commentAuthor}
                    </span>
                    <span className="diff-viewer-pr-sep text-[var(--text-faint)]">·</span>
                    <span>{commentTime}</span>
                  </div>
                  {comment.body.trim() ? (
                    <Markdown
                      value={comment.body}
                      className="diff-viewer-pr-comment markdown mt-2 text-[13px] text-[var(--text-stronger)] [&_:where(p,ul,ol,pre)]:mt-2"
                    />
                  ) : (
                    <div className="diff-viewer-pr-timeline-text mt-1.5 text-[13px] text-[var(--text-stronger)]">
                      {t("git.noCommentBody")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
});

export function GitDiffViewer({
  workspaceId = null,
  diffs,
  listView = "flat",
  stickyHeaderMode = "full",
  embeddedAnchorVariant = "default",
  showContentModeControls,
  headerControlsTarget = null,
  onRequestClose = null,
  fullDiffLoader = null,
  fullDiffSourceKey = null,
  selectedPath,
  scrollRequestId,
  isLoading,
  error,
  diffStyle = "split",
  pullRequest,
  pullRequestComments,
  pullRequestCommentsLoading = false,
  pullRequestCommentsError = null,
  onActivePathChange,
  onDiffStyleChange,
  onOpenFile: _onOpenFile,
  onCreateCodeAnnotation,
  onRemoveCodeAnnotation,
  codeAnnotations = [],
  codeAnnotationSurface = "embedded-diff-view",
}: GitDiffViewerProps) {
  const { t } = useTranslation();
  const [resolvedHeaderControlsTarget, setResolvedHeaderControlsTarget] = useState<HTMLElement | null>(null);
  const [fileContentModes, setFileContentModes] = useState<Record<string, "all" | "focused">>({});
  const [fullDiffByPath, setFullDiffByPath] = useState<Record<string, string>>({});
  const [loadingFullDiffByPath, setLoadingFullDiffByPath] = useState<Record<string, boolean>>({});
  const [fullDiffErrorByPath, setFullDiffErrorByPath] = useState<Record<string, string>>({});
  const [anchorCountByPath, setAnchorCountByPath] = useState<Record<string, number>>({});
  const [anchorIndexByPath, setAnchorIndexByPath] = useState<Record<string, number>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activePathRef = useRef<string | null>(null);
  const ignoreActivePathUntilRef = useRef<number>(0);
  const lastScrollRequestIdRef = useRef<number | null>(null);
  const onActivePathChangeRef = useRef(onActivePathChange);
  const rowResizeObserversRef = useRef(new Map<Element, ResizeObserver>());
  const rowNodesByPathRef = useRef(new Map<string, HTMLDivElement>());
  const hasActivePathHandler = Boolean(onActivePathChange);
  const effectiveDiffs = useMemo(() => {
    if (listView !== "tree") {
      return diffs;
    }
    if (!selectedPath) {
      return [];
    }
    return diffs.filter((entry) => entry.path === selectedPath);
  }, [diffs, listView, selectedPath]);
  const shouldShowContentModeControls = showContentModeControls ?? listView === "tree";
  const indexByPath = useMemo(() => {
    const map = new Map<string, number>();
    effectiveDiffs.forEach((entry, index) => {
      map.set(entry.path, index);
    });
    return map;
  }, [effectiveDiffs]);
  const rowVirtualizer = useVirtualizer({
    count: effectiveDiffs.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 260,
    overscan: 6,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const setRowRef = useCallback(
    (path: string) => (node: HTMLDivElement | null) => {
      const prevNode = rowNodesByPathRef.current.get(path);
      if (prevNode && prevNode !== node) {
        const prevObserver = rowResizeObserversRef.current.get(prevNode);
        if (prevObserver) {
          prevObserver.disconnect();
          rowResizeObserversRef.current.delete(prevNode);
        }
      }
      if (!node) {
        rowNodesByPathRef.current.delete(path);
        return;
      }
      rowNodesByPathRef.current.set(path, node);
      rowVirtualizer.measureElement(node);
      if (rowResizeObserversRef.current.has(node)) {
        return;
      }
      const observer = new ResizeObserver(() => {
        rowVirtualizer.measureElement(node);
      });
      observer.observe(node);
      rowResizeObserversRef.current.set(node, observer);
    },
    [rowVirtualizer],
  );
  const stickyEntry = useMemo(() => {
    if (!effectiveDiffs.length) {
      return null;
    }
    if (selectedPath) {
      const index = indexByPath.get(selectedPath);
      if (index !== undefined) {
        return effectiveDiffs[index];
      }
    }
    return effectiveDiffs[0];
  }, [effectiveDiffs, selectedPath, indexByPath]);

  useEffect(() => {
    if (!selectedPath || !scrollRequestId) {
      return;
    }
    if (lastScrollRequestIdRef.current === scrollRequestId) {
      return;
    }
    const index = indexByPath.get(selectedPath);
    if (index === undefined) {
      return;
    }
    ignoreActivePathUntilRef.current = Date.now() + 250;
    rowVirtualizer.scrollToIndex(index, { align: "start" });
    lastScrollRequestIdRef.current = scrollRequestId;
  }, [selectedPath, scrollRequestId, indexByPath, rowVirtualizer]);

  useEffect(() => {
    const observers = rowResizeObserversRef.current;
    return () => {
      for (const observer of observers.values()) {
        observer.disconnect();
      }
      observers.clear();
    };
  }, []);

  useEffect(() => {
    activePathRef.current = selectedPath;
  }, [selectedPath]);

  useEffect(() => {
    onActivePathChangeRef.current = onActivePathChange;
  }, [onActivePathChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasActivePathHandler) {
      return;
    }
    let frameId: number | null = null;

    const updateActivePath = () => {
      frameId = null;
      if (Date.now() < ignoreActivePathUntilRef.current) {
        return;
      }
      const items = rowVirtualizer.getVirtualItems();
      if (!items.length) {
        return;
      }
      const scrollTop = container.scrollTop;
      const canScroll = container.scrollHeight > container.clientHeight;
      const isAtBottom =
        canScroll &&
        scrollTop + container.clientHeight >= container.scrollHeight - 4;
      let nextPath: string | undefined;
      if (isAtBottom) {
        nextPath = effectiveDiffs[effectiveDiffs.length - 1]?.path;
      } else {
        const targetOffset = scrollTop + 8;
        let activeItem = items[0];
        for (const item of items) {
          if (item.start <= targetOffset) {
            activeItem = item;
          } else {
            break;
          }
        }
        if (activeItem) {
          nextPath = effectiveDiffs[activeItem.index]?.path;
        }
      }
      if (!nextPath || nextPath === activePathRef.current) {
        return;
      }
      activePathRef.current = nextPath;
      onActivePathChangeRef.current?.(nextPath);
    };

    const handleScroll = () => {
      if (frameId !== null) {
        return;
      }
      frameId = requestAnimationFrame(updateActivePath);
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      container.removeEventListener("scroll", handleScroll);
    };
  }, [effectiveDiffs, rowVirtualizer, hasActivePathHandler]);

  const diffStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const entry of effectiveDiffs) {
      const lines = entry.diff.split("\n");
      for (const line of lines) {
        if (!line) {
          continue;
        }
        if (
          line.startsWith("+++")
          || line.startsWith("---")
          || line.startsWith("diff --git")
          || line.startsWith("@@")
          || line.startsWith("index ")
          || line.startsWith("\\ No newline")
        ) {
          continue;
        }
        if (line.startsWith("+")) {
          additions += 1;
        } else if (line.startsWith("-")) {
          deletions += 1;
        }
      }
    }
    return { additions, deletions };
  }, [effectiveDiffs]);
  const handleScrollToFirstFile = useCallback(() => {
    if (!effectiveDiffs.length) {
      return;
    }
    const container = containerRef.current;
    const list = listRef.current;
    if (container && list) {
      const top = list.offsetTop;
      container.scrollTo({ top, behavior: "smooth" });
      return;
    }
    rowVirtualizer.scrollToIndex(0, { align: "start" });
  }, [effectiveDiffs.length, rowVirtualizer]);
  const handleFileContentModeChange = useCallback((path: string, mode: "all" | "focused") => {
    if (mode === "focused") {
      setLoadingFullDiffByPath((prev) => {
        if (!prev[path]) {
          return prev;
        }
        return { ...prev, [path]: false };
      });
    }
    setFileContentModes((prev) => {
      const current = prev[path] ?? "focused";
      if (current === mode) {
        return prev;
      }
      return { ...prev, [path]: mode };
    });
  }, []);

  useEffect(() => {
    setFullDiffByPath({});
    setLoadingFullDiffByPath({});
    setFullDiffErrorByPath({});
  }, [workspaceId, fullDiffSourceKey]);

  useEffect(() => {
    if (headerControlsTarget) {
      setResolvedHeaderControlsTarget(headerControlsTarget);
      return;
    }
    if (stickyHeaderMode !== "controls-only") {
      setResolvedHeaderControlsTarget(null);
      return;
    }
    let cancelled = false;
    let frameId: number | null = null;
    const resolveTarget = () => {
      if (cancelled) {
        return;
      }
      const modal = containerRef.current?.closest(".git-history-diff-modal");
      const target = modal?.querySelector<HTMLElement>(
        ".git-history-diff-modal-mode-controls, .git-history-diff-modal-actions",
      ) ?? null;
      if (target) {
        setResolvedHeaderControlsTarget(target);
        return;
      }
      frameId = requestAnimationFrame(resolveTarget);
    };
    resolveTarget();
    return () => {
      cancelled = true;
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [headerControlsTarget, stickyHeaderMode]);

  const loadFullDiff = useCallback((path: string) => {
    if (fullDiffLoader) {
      return fullDiffLoader(path);
    }
    if (!workspaceId) {
      return Promise.resolve("");
    }
    return getGitFileFullDiff(workspaceId, path);
  }, [fullDiffLoader, workspaceId]);

  const fullDiffTargetPath = useMemo(() => {
    if (!shouldShowContentModeControls) {
      return null;
    }
    const path = stickyEntry?.path ?? selectedPath;
    if (!path) {
      return null;
    }
    return (fileContentModes[path] ?? "focused") === "all" ? path : null;
  }, [fileContentModes, selectedPath, shouldShowContentModeControls, stickyEntry?.path]);

  const collectChangeAnchors = useCallback((path: string) => {
    const row = rowNodesByPathRef.current.get(path);
    if (!row) {
      return [] as HTMLElement[];
    }
    const diffContainers = row.querySelectorAll<HTMLElement>("diffs-container, .diffs-container");
    const roots: ParentNode[] = [row];
    for (const container of diffContainers) {
      if (container.shadowRoot) {
        roots.push(container.shadowRoot);
      }
    }
    const rawNodes: HTMLElement[] = [];
    for (const root of roots) {
      rawNodes.push(
        ...Array.from(
          root.querySelectorAll<HTMLElement>(
            "[data-line-type='change-addition'], [data-line-type='change-deletion']",
          ),
        ),
      );
    }
    const visible = rawNodes.filter((node) => node.offsetHeight > 0);
    if (visible.length === 0) {
      return [];
    }
    const normalized = visible
      .map((node) => {
        const lineRaw = node.getAttribute("data-line");
        const line = lineRaw ? Number.parseInt(lineRaw, 10) : Number.NaN;
        const top = node.getBoundingClientRect().top;
        return {
          node,
          line: Number.isFinite(line) ? line : null,
          top,
        };
      })
      .sort((a, b) => a.top - b.top);

    const anchors: HTMLElement[] = [];
    let lastLine: number | null = null;
    let lastTop: number | null = null;
    for (const item of normalized) {
      const topJump = lastTop == null ? true : Math.abs(item.top - lastTop) > 24;
      const lineJump = item.line == null || lastLine == null ? topJump : item.line > lastLine + 1;
      if (anchors.length === 0 || lineJump) {
        anchors.push(item.node);
      }
      if (item.line != null) {
        lastLine = item.line;
      }
      lastTop = item.top;
    }
    return anchors;
  }, []);

  const isStickyAllMode = useMemo(() => {
    if (!shouldShowContentModeControls || !stickyEntry) {
      return false;
    }
    return (fileContentModes[stickyEntry.path] ?? "focused") === "all";
  }, [fileContentModes, shouldShowContentModeControls, stickyEntry]);
  const showAnchorBar = !error && Boolean(stickyEntry) && isStickyAllMode;
  const showEmbeddedAnchorBar = showAnchorBar && stickyHeaderMode === "controls-only";
  const effectiveHeaderControlsTarget = headerControlsTarget ?? resolvedHeaderControlsTarget;
  const shouldRenderStickyHeader = Boolean(stickyEntry) && (!effectiveHeaderControlsTarget || stickyHeaderMode !== "controls-only");
  const anchorControls = stickyEntry ? (
    <div className="diff-viewer-anchor-inner">
      <button
        type="button"
        className="diff-viewer-anchor-btn"
        onClick={() => handleJumpChangeAnchor("prev")}
        disabled={!anchorCountByPath[stickyEntry.path]}
        title="上一个改动"
      >
        <ChevronUp size={13} aria-hidden />
      </button>
      <span className="diff-viewer-anchor-meta">
        {anchorCountByPath[stickyEntry.path]
          ? `${(anchorIndexByPath[stickyEntry.path] ?? 0) + 1}/${anchorCountByPath[stickyEntry.path]}`
          : "0/0"}
      </span>
      <button
        type="button"
        className="diff-viewer-anchor-btn"
        onClick={() => handleJumpChangeAnchor("next")}
        disabled={!anchorCountByPath[stickyEntry.path]}
        title="下一个改动"
      >
        <ChevronDown size={13} aria-hidden />
      </button>
    </div>
  ) : null;

  const refreshAnchorStats = useCallback((path: string) => {
    const anchors = collectChangeAnchors(path);
    setAnchorCountByPath((prev) => ({ ...prev, [path]: anchors.length }));
    setAnchorIndexByPath((prev) => {
      const current = prev[path] ?? 0;
      const next = anchors.length > 0 ? Math.min(current, anchors.length - 1) : 0;
      if (current === next && path in prev) {
        return prev;
      }
      return { ...prev, [path]: next };
    });
  }, [collectChangeAnchors]);

  useEffect(() => {
    if (!stickyEntry || !isStickyAllMode) {
      return;
    }
    const path = stickyEntry.path;
    const frame = requestAnimationFrame(() => {
      refreshAnchorStats(path);
    });
    const row = rowNodesByPathRef.current.get(path);
    if (!row) {
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    const observer = new MutationObserver(() => {
      refreshAnchorStats(path);
    });
    observer.observe(row, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [isStickyAllMode, stickyEntry, fullDiffByPath, diffStyle, refreshAnchorStats]);

  const handleJumpChangeAnchor = useCallback((direction: "prev" | "next") => {
    if (!stickyEntry) {
      return;
    }
    const path = stickyEntry.path;
    const anchors = collectChangeAnchors(path);
    setAnchorCountByPath((prev) => ({ ...prev, [path]: anchors.length }));
    if (anchors.length === 0) {
      setAnchorIndexByPath((prev) => ({ ...prev, [path]: 0 }));
      return;
    }
    const current = anchorIndexByPath[path] ?? 0;
    const next = direction === "next"
      ? (current + 1) % anchors.length
      : (current - 1 + anchors.length) % anchors.length;
    anchors[next]?.scrollIntoView({ behavior: "smooth", block: "center" });
    setAnchorCountByPath((prev) => ({ ...prev, [path]: anchors.length }));
    setAnchorIndexByPath((prev) => ({ ...prev, [path]: next }));
  }, [anchorIndexByPath, collectChangeAnchors, stickyEntry]);

  useEffect(() => {
    if (!fullDiffTargetPath) {
      return;
    }
    if (!fullDiffLoader && !workspaceId) {
      return;
    }
    let cancelled = false;
    setLoadingFullDiffByPath((prev) => ({ ...prev, [fullDiffTargetPath]: true }));
    void loadFullDiff(fullDiffTargetPath)
      .then((diffText) => {
        if (cancelled) {
          return;
        }
        setFullDiffErrorByPath((prev) => {
          if (!(fullDiffTargetPath in prev)) {
            return prev;
          }
          const next = { ...prev };
          delete next[fullDiffTargetPath];
          return next;
        });
        setFullDiffByPath((prev) => ({ ...prev, [fullDiffTargetPath]: diffText }));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setFullDiffErrorByPath((prev) => ({ ...prev, [fullDiffTargetPath]: message }));
        setFullDiffByPath((prev) => ({ ...prev, [fullDiffTargetPath]: "" }));
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setLoadingFullDiffByPath((prev) => ({ ...prev, [fullDiffTargetPath]: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [fullDiffLoader, fullDiffTargetPath, loadFullDiff, workspaceId]);

  return (
      <div
        className={`diff-viewer-frame ${showEmbeddedAnchorBar ? "has-embedded-anchor" : ""} ${
          embeddedAnchorVariant === "modal-pager" ? "is-anchor-modal-pager" : ""
        }`}
      >
        <div className="diff-viewer" ref={containerRef}>
          {stickyEntry && effectiveHeaderControlsTarget
            ? createPortal(
                <div className="diff-viewer-header-controls is-external">
                  <div className="diff-viewer-header-mode" role="group" aria-label={t("git.diffView")}>
                    <button
                      type="button"
                      className={`diff-viewer-header-mode-icon-button ${diffStyle === "split" ? "active" : ""}`}
                      onClick={() => onDiffStyleChange?.("split")}
                      aria-label={t("git.dualPanelDiff")}
                    >
                      <span className="diff-viewer-mode-glyph diff-viewer-mode-glyph-split" aria-hidden />
                      <span className="diff-viewer-mode-label">{t("git.dualPanelDiff")}</span>
                    </button>
                    <button
                      type="button"
                      className={`diff-viewer-header-mode-icon-button ${diffStyle === "unified" ? "active" : ""}`}
                      onClick={() => onDiffStyleChange?.("unified")}
                      aria-label={t("git.singleColumnDiff")}
                    >
                      <span className="diff-viewer-mode-glyph diff-viewer-mode-glyph-unified" aria-hidden />
                      <span className="diff-viewer-mode-label">{t("git.singleColumnDiff")}</span>
                    </button>
                  </div>
                  {shouldShowContentModeControls && (
                    <div className="diff-viewer-header-mode" role="group" aria-label={t("git.diffContentMode")}>
                      {(() => {
                        const activePath = stickyEntry.path;
                        const isAll = (fileContentModes[activePath] ?? "focused") === "all";
                        const isLoadingFull = Boolean(loadingFullDiffByPath[activePath]);
                        const hasFullDiff = Boolean(fullDiffByPath[activePath]?.trim());
                        const hasError = Boolean(fullDiffErrorByPath[activePath]);
                        const statusLabel = hasError
                          ? t("git.fullDiffStatusError")
                          : isLoadingFull
                            ? t("git.fullDiffStatusLoading")
                            : hasFullDiff
                              ? t("git.fullDiffStatusReady")
                              : t("git.fullDiffStatusEmpty");
                        const allLabel = isAll
                          ? `${t("git.viewAllContent")} (${statusLabel})`
                          : t("git.viewAllContent");
                        return (
                          <button
                            type="button"
                            className={`diff-viewer-header-mode-button ${(fileContentModes[stickyEntry.path] ?? "focused") === "all" ? "active" : ""}`}
                            onClick={() => handleFileContentModeChange(stickyEntry.path, "all")}
                            title={hasError ? fullDiffErrorByPath[activePath] : undefined}
                          >
                            <span className="diff-viewer-inline-mode-icon diff-viewer-inline-mode-icon-all" aria-hidden />
                            <span>{allLabel}</span>
                          </button>
                        );
                      })()}
                      <button
                        type="button"
                        className={`diff-viewer-header-mode-button ${(fileContentModes[stickyEntry.path] ?? "focused") === "focused" ? "active" : ""}`}
                        onClick={() => handleFileContentModeChange(stickyEntry.path, "focused")}
                      >
                        <span className="diff-viewer-inline-mode-icon diff-viewer-inline-mode-icon-focused" aria-hidden />
                        <span>{t("git.viewFocusedContent")}</span>
                      </button>
                    </div>
                  )}
                  {onRequestClose && (
                    <button
                      type="button"
                      className="diff-viewer-header-close-button"
                      onClick={onRequestClose}
                      aria-label={t("common.close")}
                      title={t("common.close")}
                    >
                      <X size={13} aria-hidden />
                    </button>
                  )}
                </div>,
                effectiveHeaderControlsTarget,
              )
            : null}
          {pullRequest && (
            <PullRequestSummary
              pullRequest={pullRequest}
              hasDiffs={effectiveDiffs.length > 0}
              diffStats={diffStats}
              onJumpToFirstFile={handleScrollToFirstFile}
              pullRequestComments={pullRequestComments}
              pullRequestCommentsLoading={pullRequestCommentsLoading}
              pullRequestCommentsError={pullRequestCommentsError}
            />
          )}
        {!error && stickyEntry && shouldRenderStickyHeader && (
          <div className="diff-viewer-sticky">
            <div className="diff-viewer-header diff-viewer-header-sticky">
              {stickyHeaderMode !== "controls-only" ? (
                <>
                  <span
                    className="diff-viewer-status"
                    data-status={stickyEntry.status}
                  >
                    {stickyEntry.status}
                  </span>
                  <span className="diff-viewer-path min-w-0 flex-1 text-(--text-emphasis) overflow-hidden text-ellipsis whitespace-nowrap">{stickyEntry.path}</span>
                </>
              ) : null}
              {!effectiveHeaderControlsTarget && (
                <div className="diff-viewer-header-controls">
                  <div className="diff-viewer-header-mode" role="group" aria-label={t("git.diffView")}>
                    <button
                      type="button"
                      className={`diff-viewer-header-mode-icon-button ${diffStyle === "split" ? "active" : ""}`}
                      onClick={() => onDiffStyleChange?.("split")}
                      aria-label={t("git.dualPanelDiff")}
                    >
                      <span className="diff-viewer-mode-glyph diff-viewer-mode-glyph-split" aria-hidden />
                      <span className="diff-viewer-mode-label">{t("git.dualPanelDiff")}</span>
                    </button>
                    <button
                      type="button"
                      className={`diff-viewer-header-mode-icon-button ${diffStyle === "unified" ? "active" : ""}`}
                      onClick={() => onDiffStyleChange?.("unified")}
                      aria-label={t("git.singleColumnDiff")}
                    >
                      <span className="diff-viewer-mode-glyph diff-viewer-mode-glyph-unified" aria-hidden />
                      <span className="diff-viewer-mode-label">{t("git.singleColumnDiff")}</span>
                    </button>
                  </div>
                  {shouldShowContentModeControls && (
                    <div className="diff-viewer-header-mode" role="group" aria-label={t("git.diffContentMode")}>
                      {(() => {
                        const activePath = stickyEntry.path;
                        const isAll = (fileContentModes[activePath] ?? "focused") === "all";
                        const isLoadingFull = Boolean(loadingFullDiffByPath[activePath]);
                        const hasFullDiff = Boolean(fullDiffByPath[activePath]?.trim());
                        const hasError = Boolean(fullDiffErrorByPath[activePath]);
                        const statusLabel = hasError
                          ? t("git.fullDiffStatusError")
                          : isLoadingFull
                            ? t("git.fullDiffStatusLoading")
                            : hasFullDiff
                              ? t("git.fullDiffStatusReady")
                              : t("git.fullDiffStatusEmpty");
                        const allLabel = isAll
                          ? `${t("git.viewAllContent")} (${statusLabel})`
                          : t("git.viewAllContent");
                        return (
                          <button
                            type="button"
                            className={`diff-viewer-header-mode-button ${(fileContentModes[stickyEntry.path] ?? "focused") === "all" ? "active" : ""}`}
                            onClick={() => handleFileContentModeChange(stickyEntry.path, "all")}
                            title={hasError ? fullDiffErrorByPath[activePath] : undefined}
                          >
                            <span className="diff-viewer-inline-mode-icon diff-viewer-inline-mode-icon-all" aria-hidden />
                            <span>{allLabel}</span>
                          </button>
                        );
                      })()}
                      <button
                        type="button"
                        className={`diff-viewer-header-mode-button ${(fileContentModes[stickyEntry.path] ?? "focused") === "focused" ? "active" : ""}`}
                        onClick={() => handleFileContentModeChange(stickyEntry.path, "focused")}
                      >
                        <span className="diff-viewer-inline-mode-icon diff-viewer-inline-mode-icon-focused" aria-hidden />
                        <span>{t("git.viewFocusedContent")}</span>
                      </button>
                    </div>
                  )}
                  {onRequestClose && (
                    <button
                      type="button"
                      className="diff-viewer-header-close-button"
                      onClick={onRequestClose}
                      aria-label={t("common.close")}
                      title={t("common.close")}
                    >
                      <X size={13} aria-hidden />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        {showAnchorBar && stickyEntry && !showEmbeddedAnchorBar && (
          <div
            className="diff-viewer-anchor-floating"
            role="group"
            aria-label="Change anchors"
          >
            {anchorControls}
          </div>
        )}
        {error && <div className="diff-viewer-empty text-(--text-subtle) text-xs py-2">{error}</div>}
        {!error && isLoading && effectiveDiffs.length > 0 && (
          <div className="diff-viewer-loading diff-viewer-loading-overlay">
            {t("git.refreshingDiff")}
          </div>
        )}
        {!error && !isLoading && !effectiveDiffs.length && (
          <div className="diff-viewer-empty text-(--text-subtle) text-xs py-2">
            {listView === "tree" ? t("git.selectFileToViewDiff") : t("git.noChangesDetected")}
          </div>
        )}
        {!error && effectiveDiffs.length > 0 && (
          <div
            className="diff-viewer-list relative w-full"
            ref={listRef}
            style={{
              height: rowVirtualizer.getTotalSize(),
            }}
          >
            {virtualItems.map((virtualRow) => {
              const entry = effectiveDiffs[virtualRow.index];
              if (!entry) {
                return null;
              }
              return (
                <div
                  key={entry.path}
                  className="diff-viewer-row absolute left-0 top-0 w-full pb-0 will-change-transform isolate"
                  data-index={virtualRow.index}
                  ref={setRowRef(entry.path)}
                  style={{
                    transform: `translate3d(0, ${virtualRow.start}px, 0)`,
                  }}
                >
                  {entry.isImage ? (
                    <ImageDiffCard
                      path={entry.path}
                      status={entry.status}
                      oldImageData={entry.oldImageData}
                      newImageData={entry.newImageData}
                      oldImageMime={entry.oldImageMime}
                      newImageMime={entry.newImageMime}
                      isSelected={entry.path === selectedPath}
                    />
                  ) : (
                    (() => {
                      const contentMode = fileContentModes[entry.path] ?? "focused";
                      const fullDiff = fullDiffByPath[entry.path];
                      const diffText = contentMode === "all" && fullDiff?.trim()
                        ? fullDiff
                        : entry.diff;
                      return (
                    <DiffCard
                      entry={entry}
                      diffText={diffText}
                      isSelected={entry.path === selectedPath}
                      diffStyle={diffStyle}
                      contentMode={contentMode}
                      onCreateCodeAnnotation={onCreateCodeAnnotation}
                      onRemoveCodeAnnotation={onRemoveCodeAnnotation}
                      codeAnnotations={codeAnnotations}
                      codeAnnotationSurface={codeAnnotationSurface}
                    />
                      );
                    })()
                  )}
                </div>
              );
            })}
          </div>
        )}
        </div>
        {showEmbeddedAnchorBar && stickyEntry && (
          <div className="diff-viewer-anchor-dock" role="group" aria-label="Change anchors">
            {anchorControls}
          </div>
        )}
        </div>
  );
}
