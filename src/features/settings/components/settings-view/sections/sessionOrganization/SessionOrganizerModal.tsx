import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import Archive from "lucide-react/dist/esm/icons/archive";
import FolderInput from "lucide-react/dist/esm/icons/folder-input";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Undo2 from "lucide-react/dist/esm/icons/undo-2";
import X from "lucide-react/dist/esm/icons/x";
import type { WorkspaceSessionCatalogEntry } from "../../../../../../services/tauri/sessionManagement";
import { SessionOrganizationView } from "./SessionOrganizationView";

type SessionOrganizerModalProps = {
  workspaceId: string;
  workspacePath?: string | null;
  workspaceLabel: string;
  entries: WorkspaceSessionCatalogEntry[];
  selectedIds: Record<string, true>;
  selectedCount: number;
  deleteArmed: boolean;
  isMutating: boolean;
  isMovingToFolder: boolean;
  locale: string;
  onClose: () => void;
  onToggleSelection: (selectionKey: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
  onOpenMovePicker: () => void;
  onOpenSessionInMainWindow?: (entry: WorkspaceSessionCatalogEntry) => void;
  onCatalogMutated?: () => void;
};

const PRIMARY_BUTTON_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.375rem",
  padding: "0.375rem 0.75rem",
  borderRadius: "6px",
  border: "1px solid var(--border, rgba(0,0,0,0.14))",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  fontSize: "0.8125rem",
  cursor: "pointer",
} as const;

const DANGER_BUTTON_STYLE = {
  ...PRIMARY_BUTTON_STYLE,
  border: "1px solid var(--destructive, #c0392b)",
  color: "var(--destructive, #c0392b)",
} as const;

export function SessionOrganizerModal({
  workspaceId,
  workspacePath,
  workspaceLabel,
  entries,
  selectedIds,
  selectedCount,
  deleteArmed,
  isMutating,
  isMovingToFolder,
  locale,
  onClose,
  onToggleSelection,
  onSelectAll,
  onClearSelection,
  onArchive,
  onUnarchive,
  onDelete,
  onOpenMovePicker,
  onOpenSessionInMainWindow,
  onCatalogMutated,
}: SessionOrganizerModalProps) {
  const { t } = useTranslation();
  const busy = isMutating || isMovingToFolder;
  const canBatch = selectedCount > 0 && !busy;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      data-testid="session-organizer-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1050,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-organizer-modal-title"
        data-testid="session-organizer-modal"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(1280px, 92vw)",
          height: "min(820px, 88vh)",
          background: "var(--background, #fff)",
          color: "inherit",
          borderRadius: "12px",
          boxShadow: "0 16px 48px rgba(0,0,0,0.32)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "0.875rem 1rem",
            borderBottom: "1px solid var(--border, rgba(0,0,0,0.1))",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "0.75rem",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2
              id="session-organizer-modal-title"
              style={{
                margin: 0,
                fontSize: "1rem",
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              data-testid="session-organizer-modal-title"
            >
              {t("settings.sessionOrganizerModalTitle", {
                workspace: workspaceLabel,
              })}
            </h2>
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.75rem",
                color: "var(--muted-foreground, rgba(0,0,0,0.55))",
              }}
            >
              {t("settings.sessionOrganizerModalSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t("settings.sessionOrganizerCloseAria")}
            data-testid="session-organizer-modal-close"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "2rem",
              height: "2rem",
              borderRadius: "8px",
              border: "1px solid transparent",
              background: "transparent",
              color: "inherit",
              cursor: busy ? "not-allowed" : "pointer",
              flexShrink: 0,
            }}
          >
            <X size={16} aria-hidden />
          </button>
        </header>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            padding: "0.75rem 1rem",
            overflow: "hidden",
          }}
        >
          <SessionOrganizationView
            workspaceId={workspaceId}
            workspacePath={workspacePath}
            entries={entries}
            selectedIds={selectedIds}
            onToggleSelection={onToggleSelection}
            onOpenSessionInMainWindow={onOpenSessionInMainWindow}
            onCatalogMutated={onCatalogMutated}
            locale={locale}
          />
        </div>
        <footer
          style={{
            padding: "0.625rem 1rem",
            borderTop: "1px solid var(--border, rgba(0,0,0,0.1))",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          <span
            data-testid="session-organizer-modal-selected-count"
            style={{ fontSize: "0.8125rem" }}
          >
            {t("settings.projectSessionSelectedCount", { count: selectedCount })}
          </span>
          <button
            type="button"
            onClick={onSelectAll}
            disabled={busy || entries.length === 0}
            data-testid="session-organizer-modal-select-all"
            style={PRIMARY_BUTTON_STYLE}
          >
            {t("settings.projectSessionSelectAll")}
          </button>
          <button
            type="button"
            onClick={onClearSelection}
            disabled={busy || selectedCount === 0}
            data-testid="session-organizer-modal-clear-selection"
            style={PRIMARY_BUTTON_STYLE}
          >
            {t("settings.projectSessionClearSelection")}
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onOpenMovePicker}
            disabled={!canBatch}
            data-testid="session-organizer-modal-move"
            style={PRIMARY_BUTTON_STYLE}
          >
            <FolderInput size={14} aria-hidden />
            {t("settings.sessionOrganizationMoveToFolderButton")}
          </button>
          <button
            type="button"
            onClick={onArchive}
            disabled={!canBatch}
            data-testid="session-organizer-modal-archive"
            style={PRIMARY_BUTTON_STYLE}
          >
            <Archive size={14} aria-hidden />
            {t("settings.sessionManagementArchiveSelected")}
          </button>
          <button
            type="button"
            onClick={onUnarchive}
            disabled={!canBatch}
            data-testid="session-organizer-modal-unarchive"
            style={PRIMARY_BUTTON_STYLE}
          >
            <Undo2 size={14} aria-hidden />
            {t("settings.sessionManagementUnarchiveSelected")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={!canBatch}
            data-testid="session-organizer-modal-delete"
            style={DANGER_BUTTON_STYLE}
          >
            <Trash2 size={14} aria-hidden />
            {deleteArmed
              ? t("settings.projectSessionConfirmDeleteSelected", {
                  count: selectedCount,
                })
              : t("settings.projectSessionDeleteSelected")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
