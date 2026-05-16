import type {
  CompositionEvent,
  FormEvent,
  KeyboardEvent,
  MutableRefObject,
  MouseEvent,
  RefObject,
  SyntheticEvent,
} from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import CodeMirror, {
  type ReactCodeMirrorProps,
  type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { FileDocumentPreview } from "./FileDocumentPreview";
import { FileMarkdownPreview } from "./FileMarkdownPreview";
import { FilePdfPreview } from "./FilePdfPreview";
import { FileStructuredPreview } from "./FileStructuredPreview";
import { FileTabularPreview } from "./FileTabularPreview";
import type { FilePreviewPayload } from "../hooks/useFilePreviewPayload";
import type { FileViewSurface } from "../utils/fileViewSurface";
import type {
  CodeAnnotationLineRange,
  CodeAnnotationSelection,
} from "../../code-annotations/types";

type FileViewBodyProps = {
  filePath: string;
  imageSrc: string | null;
  imageInfo: { width: number; height: number; sizeBytes: number | null } | null;
  handleImageLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
  handleImageError: () => void;
  imageLoadError: string | null;
  error: string | null;
  isLoading: boolean;
  previewPayload: FilePreviewPayload | null;
  previewPayloadLoading: boolean;
  previewPayloadError: string | null;
  viewSurface: FileViewSurface;
  content: string;
  setContent: (value: string) => void;
  cmRef: RefObject<ReactCodeMirrorRef | null>;
  handleCodeMirrorCreate: NonNullable<ReactCodeMirrorProps["onCreateEditor"]>;
  onActiveFileLineRangeChange?: (range: { startLine: number; endLine: number } | null) => void;
  onPreviewAnnotationStart?: (lineRange: CodeAnnotationLineRange) => void;
  onEditorAnnotationStart?: () => void;
  editorAnnotationLineRange?: CodeAnnotationLineRange | null;
  annotationDraft?: {
    lineRange: CodeAnnotationLineRange;
    source: "file-preview-mode" | "file-edit-mode";
    body: string;
  } | null;
  codeAnnotations?: CodeAnnotationSelection[];
  onRemoveCodeAnnotation?: (annotationId: string) => void;
  onAnnotationDraftBodyChange?: (body: string) => void;
  onAnnotationDraftCancel?: () => void;
  onAnnotationDraftConfirm?: (bodyOverride?: string) => void;
  lastReportedLineRangeRef: MutableRefObject<string>;
  editorExtensions: ReactCodeMirrorProps["extensions"];
  editorTheme: ReactCodeMirrorProps["theme"];
  highlightedLines: string[];
  lines: string[];
  gitAddedLineNumberSet: Set<number>;
  gitModifiedLineNumberSet: Set<number>;
  formatFileSize: (bytes: number) => string;
  t: (key: string) => string;
};

type PreviewLineSelection = {
  start: number;
  end: number;
};

type AnnotationDraftSelection = {
  draftKey: string;
  start: number;
  end: number;
};

function formatAnnotationLineLabel(lineRange: CodeAnnotationLineRange) {
  return lineRange.startLine === lineRange.endLine
    ? `L${lineRange.startLine}`
    : `L${lineRange.startLine}-L${lineRange.endLine}`;
}

function InlineAnnotationDraft({
  draft,
  t,
  onBodyChange,
  onSelectionChange,
  selectionSnapshot,
  onCancel,
  onConfirm,
}: {
  draft: {
    lineRange: CodeAnnotationLineRange;
    body: string;
  };
  t: (key: string) => string;
  onBodyChange?: (body: string) => void;
  onSelectionChange?: (selection: AnnotationDraftSelection) => void;
  selectionSnapshot?: AnnotationDraftSelection | null;
  onCancel?: () => void;
  onConfirm?: (body: string) => void;
}) {
  const draftKey = useMemo(
    () => `${draft.lineRange.startLine}:${draft.lineRange.endLine}`,
    [draft.lineRange.endLine, draft.lineRange.startLine],
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const localBodyRef = useRef(draft.body);
  const selectionRef = useRef<AnnotationDraftSelection | null>(null);
  const isComposingRef = useRef(false);
  const lastDraftKeyRef = useRef(draftKey);
  const focusedDraftKeyRef = useRef<string | null>(null);
  const updateSubmitDisabled = useCallback((body: string) => {
    const submitButton = submitButtonRef.current;
    if (!submitButton) {
      return;
    }
    const isDisabled = !body.trim();
    submitButton.setAttribute("aria-disabled", String(isDisabled));
    submitButton.classList.toggle("is-disabled", isDisabled);
  }, []);
  const syncDraftBody = useCallback(
    (body: string, options: { notifyParent: boolean }) => {
      localBodyRef.current = body;
      updateSubmitDisabled(body);
      if (options.notifyParent) {
        onBodyChange?.(body);
      }
    },
    [onBodyChange, updateSubmitDisabled],
  );
  const recordSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    selectionRef.current = {
      draftKey,
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
    onSelectionChange?.(selectionRef.current);
  }, [draftKey, onSelectionChange]);

  useEffect(() => {
    if (draftKey === lastDraftKeyRef.current) {
      return;
    }
    lastDraftKeyRef.current = draftKey;
    focusedDraftKeyRef.current = null;
    selectionRef.current = null;
    localBodyRef.current = draft.body;
    if (textareaRef.current && textareaRef.current.value !== draft.body) {
      textareaRef.current.value = draft.body;
    }
    updateSubmitDisabled(draft.body);
  }, [draft.body, draftKey, updateSubmitDisabled]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const activeElement = document.activeElement;
    const shouldRestoreFocus =
      activeElement === textarea ||
      activeElement === document.body ||
      activeElement === null;
    if (!shouldRestoreFocus) {
      updateSubmitDisabled(textarea.value);
      return;
    }
    const snapshotForDraft =
      selectionSnapshot?.draftKey === draftKey ? selectionSnapshot : null;
    if (focusedDraftKeyRef.current === draftKey && !snapshotForDraft) {
      return;
    }
    focusedDraftKeyRef.current = draftKey;
    textarea.focus();
    const nextSelection =
      selectionRef.current?.draftKey === draftKey
        ? selectionRef.current
        : snapshotForDraft ?? {
          start: textarea.value.length,
      end: textarea.value.length,
        };
    textarea.setSelectionRange(nextSelection.start, nextSelection.end);
    updateSubmitDisabled(textarea.value);
  }, [draftKey, selectionSnapshot, updateSubmitDisabled]);

  const stopDraftEvent = useCallback((event: SyntheticEvent) => {
    event.stopPropagation();
  }, []);
  const handleDraftInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      event.stopPropagation();
      syncDraftBody(event.currentTarget.value, {
        notifyParent: !isComposingRef.current,
      });
      recordSelection();
    },
    [recordSelection, syncDraftBody],
  );
  const handleCompositionStart = useCallback(
    (event: CompositionEvent<HTMLTextAreaElement>) => {
      event.stopPropagation();
      isComposingRef.current = true;
    },
    [],
  );
  const handleCompositionEnd = useCallback(
    (event: CompositionEvent<HTMLTextAreaElement>) => {
      event.stopPropagation();
      isComposingRef.current = false;
      syncDraftBody(event.currentTarget.value, { notifyParent: true });
      recordSelection();
    },
    [recordSelection, syncDraftBody],
  );
  const handleDraftKeyUp = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      event.stopPropagation();
      recordSelection();
    },
    [recordSelection],
  );

  return (
    <div
      className="fvp-annotation-draft fvp-annotation-draft-inline col-start-2 mt-1.5 mb-2 mr-2.5 min-w-0 max-w-full whitespace-normal p-2.5 rounded-[10px] border border-[color-mix(in_srgb,#2563eb_34%,var(--border-subtle))] bg-[color-mix(in_srgb,#2563eb_7%,var(--surface-elevated))] shadow-[0_10px_24px_color-mix(in_srgb,#000_12%,transparent)]"
      role="region"
      aria-label={t("files.annotationDraft")}
      onMouseDown={stopDraftEvent}
      onMouseUp={stopDraftEvent}
      onClick={stopDraftEvent}
      onKeyDown={stopDraftEvent}
    >
      <div className="fvp-annotation-draft-head mb-2 flex items-center justify-between gap-2 text-[11px] font-bold text-[var(--text-strong)]">
        <span className="fvp-annotation-title inline-flex items-center gap-1.5 min-w-0 [&_.codicon]:text-[#2563eb] [&_.codicon]:text-[13px]">
          <span className="codicon codicon-comment-discussion" aria-hidden />
          {t("files.annotationDraft")}
        </span>
        <code>{formatAnnotationLineLabel(draft.lineRange)}</code>
      </div>
      <textarea
        ref={textareaRef}
        className="fvp-annotation-draft-input box-border w-full max-w-full min-w-0 min-h-[58px] resize-y rounded-lg border border-[var(--border-subtle)] p-2 bg-[var(--surface-panel)] text-[var(--text-strong)] font-[inherit]"
        defaultValue={draft.body}
        onChange={handleDraftInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onClick={recordSelection}
        onKeyUp={handleDraftKeyUp}
        onMouseUp={recordSelection}
        onSelect={recordSelection}
        placeholder={t("files.annotationPlaceholder")}
      />
      <div className="fvp-annotation-draft-actions mt-2 flex items-center justify-end gap-2">
        <button type="button" className="ghost fvp-action-btn inline-flex items-center gap-[3px] px-1.5 py-[3px] text-[10px] rounded-lg whitespace-nowrap" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button
          ref={submitButtonRef}
          type="button"
          className="fvp-annotation-submit rounded-full px-3 py-[5px] bg-[#2563eb] text-white border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => {
            const body = textareaRef.current?.value ?? localBodyRef.current;
            if (!body.trim()) {
              return;
            }
            onConfirm?.(body);
          }}
          aria-disabled={!draft.body.trim()}
        >
          {t("files.annotationSubmit")}
        </button>
      </div>
    </div>
  );
}

function InlineAnnotationMarker({
  annotation,
  t,
  onRemove,
}: {
  annotation: CodeAnnotationSelection;
  t: (key: string) => string;
  onRemove?: (annotationId: string) => void;
}) {
  return (
    <div className="fvp-annotation-marker col-start-2 mt-1.5 mb-2 mr-2.5 min-w-0 max-w-full whitespace-normal px-2.5 py-2 rounded-[10px] border border-[color-mix(in_srgb,#2563eb_24%,var(--border-subtle))] bg-[color-mix(in_srgb,#2563eb_5%,var(--surface-elevated))] text-[var(--text-muted)] [&_p]:m-0 [&_p]:text-[12px] [&_p]:leading-[1.45] [&_p]:text-[var(--text-muted)]" role="note">
      <div className="fvp-annotation-marker-head mb-1 flex items-center justify-between gap-2 text-[11px] font-bold text-[var(--text-strong)]">
        <span className="fvp-annotation-title inline-flex items-center gap-1.5 min-w-0 [&_.codicon]:text-[#2563eb] [&_.codicon]:text-[13px]">
          <span className="codicon codicon-comment-discussion" aria-hidden />
          {t("files.annotationDraft")}
        </span>
        <span className="fvp-annotation-marker-tools inline-flex items-center gap-1.5 min-w-0 shrink-0">
          <code>{formatAnnotationLineLabel(annotation.lineRange)}</code>
          {onRemove ? (
            <button
              type="button"
              className="fvp-annotation-remove inline-flex items-center justify-center w-5 h-5 border border-transparent rounded-full bg-transparent text-[var(--text-faint)] cursor-pointer hover:border-[color-mix(in_srgb,#2563eb_28%,var(--border-subtle))] hover:bg-[color-mix(in_srgb,#2563eb_8%,transparent)] hover:text-[var(--text-strong)]"
              onClick={() => onRemove(annotation.id)}
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
  );
}

export function FileViewBody({
  filePath,
  imageSrc,
  imageInfo,
  handleImageLoad,
  handleImageError,
  imageLoadError,
  error,
  isLoading,
  previewPayload,
  previewPayloadLoading,
  previewPayloadError,
  viewSurface,
  content,
  setContent,
  cmRef,
  handleCodeMirrorCreate,
  onActiveFileLineRangeChange,
  onPreviewAnnotationStart,
  onEditorAnnotationStart,
  editorAnnotationLineRange,
  annotationDraft = null,
  codeAnnotations = [],
  onRemoveCodeAnnotation,
  onAnnotationDraftBodyChange,
  onAnnotationDraftCancel,
  onAnnotationDraftConfirm,
  lastReportedLineRangeRef,
  editorExtensions,
  editorTheme,
  highlightedLines,
  lines,
  gitAddedLineNumberSet,
  gitModifiedLineNumberSet,
  formatFileSize,
  t,
}: FileViewBodyProps) {
  const [previewLineSelection, setPreviewLineSelection] =
    useState<PreviewLineSelection | null>(null);
  const [isPreviewDragSelecting, setIsPreviewDragSelecting] = useState(false);
  const previewDragAnchorRef = useRef<number | null>(null);
  const previewDragMovedRef = useRef(false);
  const annotationDraftSelectionRef = useRef<AnnotationDraftSelection | null>(null);
  const previewAnnotations = codeAnnotations.filter(
    (annotation) => annotation.source === "file-preview-mode",
  );
  const previewDraft =
    annotationDraft?.source === "file-preview-mode" ? annotationDraft : null;

  const selectPreviewLineRange = useCallback((anchor: number, lineNumber: number) => {
    setPreviewLineSelection({
      start: Math.min(anchor, lineNumber),
      end: Math.max(anchor, lineNumber),
    });
  }, []);

  const handlePreviewLineMouseDown = useCallback(
    (lineNumber: number, event: MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !onPreviewAnnotationStart) {
        return;
      }
      event.preventDefault();
      setIsPreviewDragSelecting(true);
      const anchor =
        event.shiftKey && previewLineSelection ? previewLineSelection.start : lineNumber;
      previewDragAnchorRef.current = anchor;
      previewDragMovedRef.current = false;
      selectPreviewLineRange(anchor, lineNumber);
    },
    [onPreviewAnnotationStart, previewLineSelection, selectPreviewLineRange],
  );

  const handlePreviewLineMouseEnter = useCallback(
    (lineNumber: number) => {
      if (!isPreviewDragSelecting) {
        return;
      }
      const anchor = previewDragAnchorRef.current;
      if (anchor === null) {
        return;
      }
      if (anchor !== lineNumber) {
        previewDragMovedRef.current = true;
      }
      selectPreviewLineRange(anchor, lineNumber);
    },
    [isPreviewDragSelecting, selectPreviewLineRange],
  );

  const handlePreviewLineMouseUp = useCallback(() => {
    if (!isPreviewDragSelecting) {
      return;
    }
    setIsPreviewDragSelecting(false);
    previewDragAnchorRef.current = null;
  }, [isPreviewDragSelecting]);

  const handlePreviewLineClick = useCallback(
    (lineNumber: number, event: MouseEvent<HTMLDivElement>) => {
      if (!onPreviewAnnotationStart) {
        return;
      }
      if (previewDragMovedRef.current) {
        previewDragMovedRef.current = false;
        return;
      }
      if (event.shiftKey && previewLineSelection) {
        selectPreviewLineRange(previewLineSelection.start, lineNumber);
        return;
      }
      setPreviewLineSelection({ start: lineNumber, end: lineNumber });
    },
    [onPreviewAnnotationStart, previewLineSelection, selectPreviewLineRange],
  );

  useEffect(() => {
    if (!isPreviewDragSelecting) {
      return;
    }
    const handleWindowMouseUp = () => {
      setIsPreviewDragSelecting(false);
      previewDragAnchorRef.current = null;
    };
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => window.removeEventListener("mouseup", handleWindowMouseUp);
  }, [isPreviewDragSelecting]);

  useEffect(() => {
    setPreviewLineSelection(null);
    setIsPreviewDragSelecting(false);
    previewDragAnchorRef.current = null;
    previewDragMovedRef.current = false;
  }, [filePath, viewSurface.kind]);

  if (isLoading) {
    return <div className="fvp-status p-6 text-[13px] text-[var(--text-muted)] text-center">{t("files.loadingFile")}</div>;
  }
  if (error) {
    return <div className="fvp-status fvp-error p-6 text-[13px] text-center text-[var(--text-danger,#f87171)]">{error}</div>;
  }

  if (viewSurface.kind === "image") {
    return (
      <div className="fvp-image-preview">
        {imageSrc ? (
          <div className="fvp-image-preview-inner">
            <img
              src={imageSrc}
              alt={filePath}
              className="fvp-image-preview-img"
              draggable={false}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
            {imageLoadError ? (
              <span className="fvp-image-info fvp-error text-[var(--text-danger,#f87171)]">{imageLoadError}</span>
            ) : imageInfo ? (
              <span className="fvp-image-info">
                {imageInfo.width > 0 && `${imageInfo.width} × ${imageInfo.height}`}
                {imageInfo.width > 0 && imageInfo.sizeBytes != null && " · "}
                {imageInfo.sizeBytes != null ? formatFileSize(imageInfo.sizeBytes) : null}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="fvp-status fvp-error p-6 text-[13px] text-center text-[var(--text-danger,#f87171)]">{t("files.imagePreview")}</div>
        )}
      </div>
    );
  }

  if (viewSurface.kind === "binary-unsupported") {
    return <div className="fvp-status p-6 text-[13px] text-[var(--text-muted)] text-center">{t("files.unsupportedFormat")}</div>;
  }

  if (viewSurface.kind === "pdf-preview") {
    return (
      <FilePdfPreview
        assetUrl={
          previewPayload?.kind === "file-handle" || previewPayload?.kind === "asset-url"
            ? previewPayload.assetUrl
            : null
        }
        isLoading={previewPayloadLoading}
        error={previewPayloadError}
        t={t}
      />
    );
  }

  if (viewSurface.kind === "tabular-preview") {
    return (
      <FileTabularPreview
        payload={previewPayload}
        isLoading={previewPayloadLoading}
        error={previewPayloadError}
        t={t}
      />
    );
  }

  if (viewSurface.kind === "document-preview") {
    return (
      <FileDocumentPreview
        payload={previewPayload}
        isLoading={previewPayloadLoading}
        error={previewPayloadError}
        t={t}
      />
    );
  }

  if (viewSurface.kind === "editor") {
    return (
      <div className="fvp-editor flex-1 flex flex-col min-h-0 min-w-0 w-full overflow-hidden">
        {editorAnnotationLineRange ? (
          <div className="fvp-annotation-toolbar sticky top-0 z-[5] flex items-center justify-end gap-2 px-2.5 py-1.5 bg-[color-mix(in_srgb,var(--surface-elevated)_92%,transparent)] border-b border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)]">
            <span>
              {editorAnnotationLineRange.startLine === editorAnnotationLineRange.endLine
                ? `L${editorAnnotationLineRange.startLine}`
                : `L${editorAnnotationLineRange.startLine}-L${editorAnnotationLineRange.endLine}`}
            </span>
            <button
              type="button"
              className="fvp-annotation-trigger px-2.5 py-[3px] text-[11px] rounded-full border border-[color-mix(in_srgb,#2563eb_42%,var(--border-subtle))] bg-[color-mix(in_srgb,#2563eb_10%,transparent)] text-[#2563eb] cursor-pointer"
              onClick={onEditorAnnotationStart}
            >
              {t("files.annotateForAi")}
            </button>
          </div>
        ) : null}
        <CodeMirror
          key={filePath}
          ref={cmRef}
          value={content}
          onChange={setContent}
          onCreateEditor={handleCodeMirrorCreate}
          onUpdate={(update) => {
            if (!update.selectionSet) {
              return;
            }
            const mainSelection = update.state.selection.main;
            const from = Math.min(mainSelection.from, mainSelection.to);
            const to = Math.max(mainSelection.from, mainSelection.to);
            const startLine = update.state.doc.lineAt(from).number;
            const endLine = update.state.doc.lineAt(to).number;
            const rangeKey = `${startLine}-${endLine}`;
            if (rangeKey === lastReportedLineRangeRef.current) {
              return;
            }
            lastReportedLineRangeRef.current = rangeKey;
            onActiveFileLineRangeChange?.({ startLine, endLine });
          }}
          extensions={editorExtensions}
          theme={editorTheme}
          className="fvp-cm"
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            bracketMatching: true,
            closeBrackets: true,
            highlightActiveLine: true,
            indentOnInput: true,
            tabSize: 2,
          }}
        />
      </div>
    );
  }

  if (viewSurface.kind === "markdown-preview") {
    return (
      <div className="fvp-preview-scroll">
        <FileMarkdownPreview
          key={filePath}
          value={content}
          className="fvp-file-markdown fvp-markdown-github"
          onAnnotationStart={onPreviewAnnotationStart}
          annotationDraft={previewDraft}
          annotations={previewAnnotations}
          renderAnnotationDraft={(draft) => (
            <InlineAnnotationDraft
              draft={draft}
              t={t}
              onBodyChange={onAnnotationDraftBodyChange}
              onSelectionChange={(selection) => {
                annotationDraftSelectionRef.current = selection;
              }}
              selectionSnapshot={annotationDraftSelectionRef.current}
              onCancel={onAnnotationDraftCancel}
              onConfirm={onAnnotationDraftConfirm}
            />
          )}
          renderAnnotationMarker={(annotation) => (
            <InlineAnnotationMarker
              annotation={annotation}
              t={t}
              onRemove={onRemoveCodeAnnotation}
            />
          )}
          annotationActionLabel={t("files.annotateForAi")}
        />
      </div>
    );
  }

  if (viewSurface.kind === "structured-preview") {
    return (
      <div className="fvp-preview-scroll">
        <FileStructuredPreview
          key={filePath}
          filePath={filePath}
          value={content}
          className="fvp-structured-preview"
        />
      </div>
    );
  }

  const previewSelectionLabel = previewLineSelection
    ? previewLineSelection.start === previewLineSelection.end
      ? `L${previewLineSelection.start}`
      : `L${previewLineSelection.start}-L${previewLineSelection.end}`
    : null;

  return (
    <div className="fvp-code-preview" role="list">
      {previewLineSelection && onPreviewAnnotationStart ? (
        <div className="fvp-preview-selection-toolbar sticky top-0 z-[3] flex items-center justify-end gap-2 px-2.5 py-[7px] border-b border-[color-mix(in_srgb,var(--border-accent)_28%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--surface-card)_94%,var(--surface-command))] text-[var(--text-muted)] text-[11px] [&>span]:mr-auto [&>span]:text-[var(--text-strong)] [&>span]:font-bold" role="group" aria-label={t("files.annotationSelectionToolbar")}>
          <span>{previewSelectionLabel}</span>
          <button
            type="button"
            className="ghost fvp-action-btn inline-flex items-center gap-[3px] px-1.5 py-[3px] text-[10px] rounded-lg whitespace-nowrap"
            onClick={() => setPreviewLineSelection(null)}
          >
            {t("files.clearSelection")}
          </button>
          <button
            type="button"
            className="fvp-annotation-trigger px-2.5 py-[3px] text-[11px] rounded-full border border-[color-mix(in_srgb,#2563eb_42%,var(--border-subtle))] bg-[color-mix(in_srgb,#2563eb_10%,transparent)] text-[#2563eb] cursor-pointer"
            onClick={() =>
              onPreviewAnnotationStart({
                startLine: previewLineSelection.start,
                endLine: previewLineSelection.end,
              })
            }
          >
            {t("files.annotateForAi")}
          </button>
        </div>
      ) : null}
      {lines.map((_, index) => {
        const html = highlightedLines[index] ?? "&nbsp;";
        const lineNumber = index + 1;
        const isGitAddedLine = gitAddedLineNumberSet.has(lineNumber);
        const isGitModifiedLine = gitModifiedLineNumberSet.has(lineNumber);
        const isSelected = Boolean(
          previewLineSelection &&
            lineNumber >= previewLineSelection.start &&
            lineNumber <= previewLineSelection.end,
        );
        const lineAnnotations = previewAnnotations.filter(
          (annotation) => annotation.lineRange.endLine === lineNumber,
        );
        const shouldRenderDraft = previewDraft?.lineRange.endLine === lineNumber;
        return (
          <div
            key={`line-${index}`}
            className={`fvp-code-line${isGitModifiedLine ? " is-git-modified" : isGitAddedLine ? " is-git-added" : ""}${
              isSelected ? " is-selected" : ""
            }`}
            role={onPreviewAnnotationStart ? "button" : undefined}
            tabIndex={onPreviewAnnotationStart ? 0 : undefined}
            aria-pressed={onPreviewAnnotationStart ? isSelected : undefined}
            onClick={(event) => handlePreviewLineClick(lineNumber, event)}
            onMouseDown={(event) => handlePreviewLineMouseDown(lineNumber, event)}
            onMouseEnter={() => handlePreviewLineMouseEnter(lineNumber)}
            onMouseUp={handlePreviewLineMouseUp}
          >
            <span className="fvp-line-number">
              {lineNumber}
              {onPreviewAnnotationStart ? (
                <button
                  type="button"
                  className="fvp-line-annotation-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onPreviewAnnotationStart({
                      startLine: lineNumber,
                      endLine: lineNumber,
                    });
                  }}
                  aria-label={`${t("files.annotateForAi")} L${lineNumber}`}
                  title={t("files.annotateForAi")}
                >
                  +
                </button>
              ) : null}
            </span>
            <span
              className="fvp-line-text"
              dangerouslySetInnerHTML={{ __html: html }}
            />
            {lineAnnotations.map((annotation) => (
              <InlineAnnotationMarker
                key={annotation.id}
                annotation={annotation}
                t={t}
                onRemove={onRemoveCodeAnnotation}
              />
            ))}
            {shouldRenderDraft ? (
              <InlineAnnotationDraft
                draft={previewDraft}
                t={t}
                onBodyChange={onAnnotationDraftBodyChange}
                onSelectionChange={(selection) => {
                  annotationDraftSelectionRef.current = selection;
                }}
                selectionSnapshot={annotationDraftSelectionRef.current}
                onCancel={onAnnotationDraftCancel}
                onConfirm={onAnnotationDraftConfirm}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
