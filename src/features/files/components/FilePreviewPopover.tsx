import { useMemo } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import X from "lucide-react/dist/esm/icons/x";
import { highlightLine, languageFromPath } from "../../../utils/syntax";
import { OpenAppMenu } from "../../app/components/OpenAppMenu";
import type { OpenAppTarget } from "../../../types";

type FilePreviewPopoverProps = {
  path: string;
  absolutePath: string;
  content: string;
  truncated: boolean;
  previewKind?: "text" | "image";
  imageSrc?: string | null;
  openTargets: OpenAppTarget[];
  openAppIconById: Record<string, string>;
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
  selection: { start: number; end: number } | null;
  onSelectLine: (index: number, event: MouseEvent<HTMLButtonElement>) => void;
  onLineMouseDown?: (index: number, event: MouseEvent<HTMLButtonElement>) => void;
  onLineMouseEnter?: (index: number, event: MouseEvent<HTMLButtonElement>) => void;
  onLineMouseUp?: (index: number, event: MouseEvent<HTMLButtonElement>) => void;
  onClearSelection: () => void;
  onAddSelection: () => void;
  onClose: () => void;
  selectionHints?: string[];
  style?: CSSProperties;
  isLoading?: boolean;
  error?: string | null;
};

export function FilePreviewPopover({
  path,
  absolutePath,
  content,
  truncated,
  previewKind = "text",
  imageSrc = null,
  openTargets,
  openAppIconById,
  selectedOpenAppId,
  onSelectOpenAppId,
  selection,
  onSelectLine,
  onLineMouseDown,
  onLineMouseEnter,
  onLineMouseUp,
  onClearSelection,
  onAddSelection,
  onClose,
  selectionHints = [],
  style,
  isLoading = false,
  error = null,
}: FilePreviewPopoverProps) {
  const { t } = useTranslation();
  const isImagePreview = previewKind === "image";
  const lines = useMemo(
    () => (isImagePreview ? [] : content.split("\n")),
    [content, isImagePreview],
  );
  const language = useMemo(() => languageFromPath(path), [path]);
  const selectionLabel = selection
    ? `Lines ${selection.start + 1}-${selection.end + 1}`
    : isImagePreview
      ? t("files.imagePreview")
      : t("files.noSelection");
  const highlightedLines = useMemo(
    () =>
      isImagePreview
        ? []
        : lines.map((line) => {
            const html = highlightLine(line, language);
            return html || "&nbsp;";
          }),
    [lines, language, isImagePreview],
  );

  return (
    <div
      className="file-preview-popover popover-surface rounded-xl p-3 flex flex-col gap-2.5 z-30 relative"
      style={style}
    >
      <div className="file-preview-header flex items-center justify-between gap-3">
        <div className="file-preview-title flex items-center gap-2 min-w-0">
          <span className="file-preview-path text-xs text-(--text-strong) whitespace-nowrap overflow-hidden text-ellipsis">{path}</span>
          {truncated && (
            <span className="file-preview-warning text-[10px] uppercase tracking-[0.08em] text-(--text-faint)">Truncated</span>
          )}
        </div>
        <button
          type="button"
          className="icon-button file-preview-close p-1"
          onClick={onClose}
          aria-label="Close preview"
          title="Close preview"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
      {isLoading ? (
        <div className="file-preview-status text-xs text-(--text-faint)">Loading file...</div>
      ) : error ? (
        <div className="file-preview-status file-preview-error text-xs text-(--text-danger,#f87171)">{error}</div>
      ) : isImagePreview ? (
        <div className="file-preview-body file-preview-body--image flex flex-col gap-3 min-h-0 max-h-[70vh]">
          <div className="file-preview-toolbar flex items-center justify-between gap-3 text-[11px] text-(--text-faint)">
            <span className="file-preview-selection">{selectionLabel}</span>
            <div className="file-preview-actions flex items-center gap-1.5">
              <OpenAppMenu
                path={absolutePath}
                openTargets={openTargets}
                selectedOpenAppId={selectedOpenAppId}
                onSelectOpenAppId={onSelectOpenAppId}
                iconById={openAppIconById}
              />
            </div>
          </div>
          {imageSrc ? (
            <div className="file-preview-image flex items-center justify-center p-3 rounded-[10px] bg-(--surface-command) overflow-auto max-h-[60vh] [&>img]:max-w-full [&>img]:max-h-[58vh] [&>img]:object-contain [&>img]:rounded-lg [&>img]:shadow-[0_12px_30px_rgba(0,0,0,0.25)]">
              <img src={imageSrc} alt={path} />
            </div>
          ) : (
            <div className="file-preview-status file-preview-error text-xs text-(--text-danger,#f87171)">
              Image preview unavailable.
            </div>
          )}
        </div>
      ) : (
        <div className="file-preview-body flex flex-col gap-2 min-h-0 max-h-[70vh]">
          <div className="file-preview-toolbar flex items-center justify-between gap-3 text-[11px] text-(--text-faint)">
            <div className="file-preview-selection-group flex flex-col gap-0.5 min-w-0">
              <span className="file-preview-selection">{selectionLabel}</span>
              {selectionHints.length > 0 ? (
                <div className="file-preview-hints flex flex-wrap gap-2 text-[10px] text-(--text-fainter)" aria-label="Selection hints">
                  {selectionHints.map((hint) => (
                    <span key={hint} className="file-preview-hint whitespace-nowrap">
                      {hint}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="file-preview-actions flex items-center gap-1.5">
              <OpenAppMenu
                path={absolutePath}
                openTargets={openTargets}
                selectedOpenAppId={selectedOpenAppId}
                onSelectOpenAppId={onSelectOpenAppId}
                iconById={openAppIconById}
              />
              <button
                type="button"
                className="ghost file-preview-action inline-flex items-center py-1.5 px-3 min-h-[30px] text-xs leading-[1.2] rounded-[10px]"
                onClick={onClearSelection}
                disabled={!selection}
              >
                {t("files.clearSelection")}
              </button>
              <button
                type="button"
                className="primary file-preview-action file-preview-action--add inline-flex items-center py-1.5 px-3 min-h-[30px] text-xs leading-[1.2] rounded-[10px] bg-(--surface-active) text-(--text-strong) border border-(--border-accent) shadow-[0_8px_18px_rgba(0,0,0,0.25)] hover:enabled:-translate-y-px hover:enabled:shadow-[0_10px_20px_rgba(0,0,0,0.3)]"
                onClick={onAddSelection}
                disabled={!selection}
              >
                {t("files.addToChat")}
              </button>
            </div>
          </div>
          <div
            className="file-preview-lines flex flex-col gap-0 overflow-auto rounded-lg bg-(--surface-command) py-1.5 px-0 text-(--text-quiet) whitespace-pre"
            style={{
              fontFamily: "var(--code-font-family)",
              fontSize: "var(--code-font-size, 11px)",
              fontWeight: "var(--code-font-weight, 400)" as unknown as number,
              lineHeight: "var(--code-line-height, 1.28)",
            }}
            role="list"
          >
            {lines.map((_, index) => {
              const html = highlightedLines[index] ?? "&nbsp;";
              const isSelected =
                selection &&
                index >= selection.start &&
                index <= selection.end;
              const isStart = isSelected && selection?.start === index;
              const isEnd = isSelected && selection?.end === index;
              return (
                <button
                  key={`line-${index}`}
                  type="button"
                  className={`file-preview-line grid grid-cols-[52px_1fr] gap-2.5 items-start py-0.5 px-2.5 min-w-full w-max border border-transparent rounded-none bg-transparent text-left cursor-pointer transition-none transform-none shadow-none outline-none${
                    isSelected ? " is-selected bg-[color-mix(in_srgb,var(--surface-active)_65%,transparent)] shadow-[inset_3px_0_0_var(--border-accent)] hover:bg-[color-mix(in_srgb,var(--surface-active)_65%,transparent)]" : " hover:bg-[color-mix(in_srgb,var(--surface-active)_45%,transparent)]"
                  }${isStart ? " is-start" : ""}${isEnd ? " is-end" : ""}`}
                  style={{
                    fontFamily: "var(--code-font-family)",
                    fontSize: "var(--code-font-size, 11px)",
                    fontWeight: "var(--code-font-weight, 400)" as unknown as number,
                    lineHeight: "var(--code-line-height, 1.28)",
                  }}
                  onClick={(event) => onSelectLine(index, event)}
                  onMouseDown={(event) => onLineMouseDown?.(index, event)}
                  onMouseEnter={(event) => onLineMouseEnter?.(index, event)}
                  onMouseUp={(event) => onLineMouseUp?.(index, event)}
                >
                  <span className="file-preview-line-number text-(--text-fainter) text-right [font-variant-numeric:tabular-nums]">{index + 1}</span>
                  <span
                    className="file-preview-line-text min-w-0 wrap-break-word [word-break:break-word]"
                    dangerouslySetInnerHTML={{ __html: html || "&nbsp;" }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
