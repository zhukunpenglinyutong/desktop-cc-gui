import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import X from "lucide-react/dist/esm/icons/x";
import {
  buildWorkspaceSessionFolderMoveTargets,
  type WorkspaceSessionFolderMoveTarget,
} from "../../../../../app/utils/workspaceSessionFolders";
import {
  listWorkspaceSessionFolders,
  type WorkspaceSessionFolder,
} from "../../../../../../services/tauri/sessionManagement";

type MoveToFolderPickerProps = {
  workspaceId: string;
  selectedCount: number;
  onClose: () => void;
  onApply: (folderId: string | null) => Promise<void> | void;
};

type PendingSelection =
  | { kind: "none" }
  | { kind: "target"; folderId: string | null };

export function MoveToFolderPicker({
  workspaceId,
  selectedCount,
  onClose,
  onApply,
}: MoveToFolderPickerProps) {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<WorkspaceSessionFolder[]>([]);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection>({
    kind: "none",
  });
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setFolderError(null);
    listWorkspaceSessionFolders(workspaceId)
      .then((tree) => {
        if (cancelled) return;
        setFolders(tree.folders);
        setIsLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setFolderError(
          error instanceof Error ? error.message : String(error),
        );
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isApplying) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isApplying, onClose]);

  const targets: WorkspaceSessionFolderMoveTarget[] = useMemo(
    () =>
      buildWorkspaceSessionFolderMoveTargets({
        folders,
        rootLabel: t("settings.sessionOrganizationMoveToFolderUnfileLabel"),
      }),
    [folders, t],
  );

  const handleApply = async () => {
    if (pendingSelection.kind !== "target" || isApplying) {
      return;
    }
    setIsApplying(true);
    try {
      await onApply(pendingSelection.folderId);
    } finally {
      setIsApplying(false);
    }
  };

  if (typeof document === "undefined") {
    return null;
  }

  const hasTargetSelected = pendingSelection.kind === "target";
  const effectiveTargetId =
    hasTargetSelected ? pendingSelection.folderId : "__unselected__";

  return createPortal(
    <div
      className="session-organization-move-picker-backdrop"
      data-testid="session-organization-move-picker-backdrop"
      role="presentation"
      onClick={() => {
        if (!isApplying) {
          onClose();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-organization-move-picker-title"
        className="session-organization-move-picker"
        data-testid="session-organization-move-picker"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(480px, 90vw)",
          maxHeight: "min(560px, 80vh)",
          background: "var(--background, #fff)",
          color: "inherit",
          borderRadius: "10px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 12px 36px rgba(0,0,0,0.25)",
        }}
      >
        <header
          style={{
            padding: "0.75rem 1rem",
            borderBottom: "1px solid var(--border, rgba(0,0,0,0.1))",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
          }}
        >
          <h3
            id="session-organization-move-picker-title"
            style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}
          >
            {t("settings.sessionOrganizationMoveToFolderTitle", {
              count: selectedCount,
            })}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isApplying}
            aria-label={t("settings.sessionOrganizationMoveToFolderCloseAria")}
            data-testid="session-organization-move-picker-close"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "1.75rem",
              height: "1.75rem",
              borderRadius: "6px",
              border: "1px solid transparent",
              background: "transparent",
              cursor: isApplying ? "not-allowed" : "pointer",
            }}
          >
            <X size={14} aria-hidden />
          </button>
        </header>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "0.5rem",
          }}
        >
          {isLoading ? (
            <div
              data-testid="session-organization-move-picker-loading"
              style={{ padding: "0.75rem" }}
            >
              {t("settings.sessionOrganizationMoveToFolderLoading")}
            </div>
          ) : folderError ? (
            <div
              role="alert"
              data-testid="session-organization-move-picker-error"
              style={{ padding: "0.75rem", color: "var(--destructive, #c0392b)" }}
            >
              {folderError}
            </div>
          ) : targets.length <= 1 && folders.length === 0 ? (
            <div
              data-testid="session-organization-move-picker-empty"
              style={{ padding: "0.75rem" }}
            >
              {t("settings.sessionOrganizationMoveToFolderEmpty")}
            </div>
          ) : (
            <ul
              role="listbox"
              aria-label={t("settings.sessionOrganizationMoveToFolderListAria")}
              data-testid="session-organization-move-picker-list"
              style={{ listStyle: "none", padding: 0, margin: 0 }}
            >
              {targets.map((target) => {
                const key = target.folderId ?? "__unfile__";
                const isSelected =
                  hasTargetSelected && effectiveTargetId === target.folderId;
                return (
                  <li key={key} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-testid={`session-organization-move-picker-target-${key}`}
                      onClick={() =>
                        setPendingSelection({
                          kind: "target",
                          folderId: target.folderId,
                        })
                      }
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "0.5rem 0.75rem",
                        background: isSelected
                          ? "var(--accent, rgba(0,0,0,0.06))"
                          : "transparent",
                        border: "1px solid transparent",
                        borderRadius: "6px",
                        cursor: "pointer",
                        font: "inherit",
                        color: "inherit",
                      }}
                    >
                      {target.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <footer
          style={{
            padding: "0.5rem 0.75rem",
            borderTop: "1px solid var(--border, rgba(0,0,0,0.1))",
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isApplying}
            data-testid="session-organization-move-picker-cancel"
            style={{
              padding: "0.375rem 0.875rem",
              borderRadius: "6px",
              border: "1px solid var(--border, rgba(0,0,0,0.15))",
              background: "transparent",
              cursor: isApplying ? "not-allowed" : "pointer",
            }}
          >
            {t("settings.sessionOrganizationMoveToFolderCancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={!hasTargetSelected || isApplying}
            data-testid="session-organization-move-picker-apply"
            style={{
              padding: "0.375rem 0.875rem",
              borderRadius: "6px",
              border: "1px solid var(--primary, #2563eb)",
              background:
                hasTargetSelected && !isApplying
                  ? "var(--primary, #2563eb)"
                  : "transparent",
              color:
                hasTargetSelected && !isApplying
                  ? "var(--primary-foreground, #fff)"
                  : "inherit",
              cursor:
                hasTargetSelected && !isApplying ? "pointer" : "not-allowed",
              opacity: hasTargetSelected && !isApplying ? 1 : 0.6,
            }}
          >
            {isApplying
              ? t("settings.sessionOrganizationMoveToFolderApplying")
              : t("settings.sessionOrganizationMoveToFolderApply")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
