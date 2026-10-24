import { useTranslation } from "react-i18next";
import Eye from "lucide-react/dist/esm/icons/eye";
import PencilLine from "lucide-react/dist/esm/icons/pencil-line";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Save from "lucide-react/dist/esm/icons/save";
import Search from "lucide-react/dist/esm/icons/search";
import WrapText from "lucide-react/dist/esm/icons/wrap-text";
import { ActionFeedbackIcon, type ActionFeedback } from "@/components/base/action-feedback";
import { Button } from "@/components/base/buttons/button";
import type { EditorViewMode } from "./editor-view-mode";
import { cx } from "@/utils/cx";

export function FileEditorHeader({
  path,
  name,
  dirty,
  readOnly,
  canPreview,
  isMarkdown,
  isHtml,
  viewMode,
  onViewModeChange,
  reloadFeedback,
  onReloadPreview,
  saving,
  onSave,
  searchOpen,
  onToggleSearch,
  wordWrap,
  onToggleWordWrap,
}: {
  path: string;
  name: string;
  dirty: boolean;
  readOnly: boolean;
  /** File kinds with a rendered preview (Markdown anywhere, HTML on desktop)
   *  get the 编辑 / 预览 toggle. */
  canPreview: boolean;
  /** Markdown preview additionally owns the find-bar toggle (⌘F). */
  isMarkdown: boolean;
  /** HTML preview owns the reload button. */
  isHtml: boolean;
  viewMode: EditorViewMode;
  onViewModeChange: (mode: EditorViewMode) => void;
  reloadFeedback: ActionFeedback;
  onReloadPreview: () => void;
  saving: boolean;
  onSave: () => void;
  /** Markdown preview find bar visibility / toggle (⌘F). */
  searchOpen: boolean;
  onToggleSearch: () => void;
  wordWrap: boolean;
  onToggleWordWrap: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-button-default px-3">
      <span className="truncate text-body-medium text-text-primary" title={path}>
        {name}
      </span>
      {dirty && (
        <span className="shrink-0 rounded-sm bg-badge-neutral-background px-1.5 py-0.5 text-caption-1-medium text-text-secondary">
          {t("files.unsavedChanges")}
        </span>
      )}
      {readOnly && (
        <span className="shrink-0 text-caption-1-regular text-text-tertiary">
          {t("files.fileTruncated")}
        </span>
      )}
      <div className="flex-1" />
      {isHtml && viewMode === "preview" && (
        <button
          type="button"
          onClick={onReloadPreview}
          disabled={reloadFeedback === "running"}
          aria-label={t("common.refresh")}
          title={t("common.refresh")}
          className="flex h-6 shrink-0 items-center justify-center rounded-lg border border-border-button-default px-2 text-text-tertiary transition-colors duration-150 ease hover:text-text-primary"
        >
          <ActionFeedbackIcon
            icon={RefreshCw}
            feedback={reloadFeedback}
            spin
            iconClassName="size-3.5"
          />
        </button>
      )}
      {isMarkdown && viewMode === "preview" && (
        <button
          type="button"
          onClick={onToggleSearch}
          aria-label={t("files.markdown.searchToggle")}
          title={t("files.markdown.searchToggle")}
          aria-pressed={searchOpen}
          className={cx(
            "flex h-6 shrink-0 items-center justify-center rounded-lg border border-border-button-default px-2 transition-colors duration-150 ease",
            searchOpen
              ? "bg-background-tertiary-default text-text-primary"
              : "text-text-tertiary hover:text-text-primary",
          )}
        >
          <Search className="size-3.5" aria-hidden />
        </button>
      )}
      {canPreview && (
        <div className="flex shrink-0 items-center rounded-lg border border-border-button-default">
          <button
            type="button"
            onClick={() => onViewModeChange("edit")}
            className={cx(
              "flex h-6 items-center gap-1 rounded-l-lg px-2 text-caption-1-medium",
              viewMode === "edit"
                ? "bg-background-tertiary-default text-text-primary"
                : "text-text-tertiary hover:text-text-primary",
            )}
          >
            <PencilLine className="size-3" aria-hidden />
            {t("files.editMode")}
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange("preview")}
            className={cx(
              "flex h-6 items-center gap-1 rounded-r-lg px-2 text-caption-1-medium",
              viewMode === "preview"
                ? "bg-background-tertiary-default text-text-primary"
                : "text-text-tertiary hover:text-text-primary",
            )}
          >
            <Eye className="size-3" aria-hidden />
            {t("files.preview")}
          </button>
        </div>
      )}
      {viewMode === "edit" && (
        <Button
          variant="secondary"
          size="xs"
          iconOnly
          leadingIcon={WrapText}
          aria-label={t("files.wordWrap")}
          title={t("files.wordWrap")}
          aria-pressed={wordWrap}
          className={wordWrap ? "bg-background-tertiary-default text-text-primary" : "text-text-tertiary"}
          onClick={onToggleWordWrap}
        />
      )}
      {!readOnly && (
        <Button
          variant="secondary"
          size="xs"
          leadingIcon={Save}
          disabled={!dirty || saving}
          onClick={() => void onSave()}
        >
          {t("files.saveFile")}
        </Button>
      )}
    </div>
  );
}
