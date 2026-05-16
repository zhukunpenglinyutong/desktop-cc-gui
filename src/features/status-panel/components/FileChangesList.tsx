import { memo } from "react";
import { useTranslation } from "react-i18next";
import FileStack from "lucide-react/dist/esm/icons/file-stack";
import GitCompareArrows from "lucide-react/dist/esm/icons/git-compare-arrows";
import type { FileChangeSummary } from "../types";
import { FileIcon } from "../../messages/components/toolBlocks/FileIcon";

interface FileChangesListProps {
  fileChanges: FileChangeSummary[];
  totalAdditions: number;
  totalDeletions: number;
  onOpenFilePath?: (path: string) => void;
  onOpenDiffPath?: (path: string) => void;
  onOpenTotalDiff?: () => void;
  onAfterSelect?: () => void;
}

const FILE_BADGE_CLASS_BY_STATUS: Record<FileChangeSummary["status"], string> = {
  A: "sp-file-added [background:color-mix(in_srgb,var(--status-success,#78ebbe)_18%,transparent)] [color:color-mix(in_srgb,var(--status-success,#78ebbe)_88%,var(--text-emphasis,#ffffff)_12%)]",
  D: "sp-file-deleted [background:color-mix(in_srgb,var(--status-error,#ff6e6e)_18%,transparent)] [color:color-mix(in_srgb,var(--status-error,#ff6e6e)_88%,var(--text-emphasis,#ffffff)_12%)]",
  R: "sp-file-renamed [background:color-mix(in_srgb,var(--status-warning,#ffaf55)_18%,transparent)] [color:color-mix(in_srgb,var(--status-warning,#ffaf55)_82%,var(--text-emphasis,#ffffff)_18%)]",
  M: "sp-file-modified [background:color-mix(in_srgb,var(--text-accent,#7a9dcc)_18%,transparent)] [color:color-mix(in_srgb,var(--text-accent,#7a9dcc)_92%,var(--text-strong,#ffffff)_8%)]",
};

const FILE_BADGE_BASE_CLASS =
  "text-[10px] font-bold px-[5px] py-px rounded shrink-0 font-mono";

const DIFF_ACTION_CLASS =
  "sp-file-diff-action inline-flex items-center justify-center w-6.5 h-6.5 shrink-0 border border-transparent rounded-lg bg-transparent text-(--text-muted) cursor-pointer transition-colors hover:enabled:border-(--border-subtle) hover:enabled:bg-(--surface-item) hover:enabled:text-(--text-strong) disabled:cursor-not-allowed disabled:opacity-40";

export const FileChangesList = memo(function FileChangesList({
  fileChanges,
  totalAdditions,
  totalDeletions,
  onOpenFilePath,
  onOpenDiffPath,
  onOpenTotalDiff,
  onAfterSelect,
}: FileChangesListProps) {
  const { t } = useTranslation();
  if (fileChanges.length === 0) {
    return (
      <div className="sp-empty p-4 text-center text-(--text-faint) text-xs">
        {t("statusPanel.emptyFileChanges")}
      </div>
    );
  }
  return (
    <div className="sp-file-list flex flex-col gap-1">
      <div className="sp-file-summary flex items-center justify-between gap-2 pb-0.5 border-0 bg-transparent">
        <span className="sp-file-summary-label inline-flex items-center gap-2 text-[10px] font-bold tracking-wider text-(--text-faint) font-mono">
          <span>{t("statusPanel.checkpoint.keyChanges.files")}</span>
          <span className="sp-file-summary-count font-[inherit] tracking-normal text-(--text-muted)">
            {t("statusPanel.checkpoint.evidence.filesChangedValue", { count: fileChanges.length })}
          </span>
        </span>
        <span className="sp-file-summary-actions inline-flex items-center gap-2 min-w-0">
          <span className="sp-file-stats inline-flex items-center gap-1.5 shrink-0 text-[11px] tabular-nums font-mono">
            <span className="sp-file-add text-[#89d185] font-semibold">+{totalAdditions}</span>
            <span className="sp-file-del text-[#d19a66] font-semibold">-{totalDeletions}</span>
          </span>
          <button
            type="button"
            className={`${DIFF_ACTION_CLASS} sp-file-summary-diff-action w-6 h-6`}
            aria-label={t("statusPanel.checkpoint.actions.reviewDiff")}
            title={t("statusPanel.checkpoint.actions.reviewDiff")}
            disabled={!onOpenTotalDiff}
            onClick={(event) => {
              event.stopPropagation();
              onOpenTotalDiff?.();
            }}
          >
            <FileStack
              size={16}
              strokeWidth={2.25}
              aria-hidden
              className="sp-file-diff-action-icon block shrink-0 text-current [stroke:currentColor] fill-none"
            />
          </button>
        </span>
      </div>
      {fileChanges.map((file) => (
        <div
          key={file.filePath}
          className="sp-file-item flex items-center gap-2 px-1.5 py-1 rounded-lg transition-colors hover:bg-(--surface-hover)"
        >
          <button
            type="button"
            className={`sp-file-main inline-flex items-center gap-2 flex-1 min-w-0 border-0 bg-transparent px-0.5 py-px text-inherit text-left${
              onOpenFilePath
                ? " is-clickable cursor-pointer hover:[&_.sp-file-name]:underline hover:[&_.sp-file-name]:text-(--color-link,var(--message-link-color))"
                : ""
            }`}
            title={file.filePath}
            onClick={(event) => {
              event.stopPropagation();
              if (!onOpenFilePath) {
                return;
              }
              onOpenFilePath(file.filePath);
              onAfterSelect?.();
            }}
          >
            <span className={`sp-file-badge ${FILE_BADGE_BASE_CLASS} ${FILE_BADGE_CLASS_BY_STATUS[file.status]}`}>
              {file.status}
            </span>
            <FileIcon fileName={file.fileName} size={14} />
            <span className="sp-file-name text-xs text-(--text-strong) overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1">
              {file.fileName}
            </span>
          </button>
          <span className="sp-file-stats inline-flex items-center gap-1.5 shrink-0 text-[11px] tabular-nums font-mono">
            <span className="sp-file-add text-[#89d185] font-semibold">+{file.additions}</span>
            <span className="sp-file-del text-[#d19a66] font-semibold">-{file.deletions}</span>
          </span>
          <button
            type="button"
            className={DIFF_ACTION_CLASS}
            aria-label={t("git.previewModalAction")}
            title={t("git.previewModalAction")}
            disabled={!onOpenDiffPath}
            onClick={(event) => {
              event.stopPropagation();
              if (!onOpenDiffPath) {
                return;
              }
              onOpenDiffPath(file.filePath);
              onAfterSelect?.();
            }}
          >
            <GitCompareArrows
              size={16}
              strokeWidth={2.25}
              aria-hidden
              className="sp-file-diff-action-icon block shrink-0 text-current [stroke:currentColor] fill-none"
            />
          </button>
        </div>
      ))}
    </div>
  );
});
