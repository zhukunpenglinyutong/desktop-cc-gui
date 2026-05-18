import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import FilePlus from "lucide-react/dist/esm/icons/file-plus";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import LayoutDashboard from "lucide-react/dist/esm/icons/layout-dashboard";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";

type FileTreeRootActionsProps = {
  canTrashSelectedNode: boolean;
  isSpecHubActive?: boolean;
  selectedParentFolder: string | null;
  onOpenDetachedExplorer?: (initialFilePath?: string | null) => void;
  detachedInitialFilePath?: string | null;
  onOpenNewFile: (parentFolder: string | null) => void;
  onOpenNewFolder: (parentFolder: string | null) => void;
  onRefreshFiles?: () => void;
  onTrashSelected: () => void;
  onOpenSpecHub?: () => void;
  showDetachedExplorerAction?: boolean;
  showSpecHubAction?: boolean;
};

export function FileTreeRootActions({
  canTrashSelectedNode,
  isSpecHubActive = false,
  selectedParentFolder,
  onOpenDetachedExplorer,
  detachedInitialFilePath,
  onOpenNewFile,
  onOpenNewFolder,
  onRefreshFiles,
  onTrashSelected,
  onOpenSpecHub,
  showDetachedExplorerAction = false,
  showSpecHubAction = true,
}: FileTreeRootActionsProps) {
  const { t } = useTranslation();
  const [spinningAction, setSpinningAction] = useState<string | null>(null);
  const spinTimerRef = useRef<number | null>(null);
  const spinRafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (spinTimerRef.current !== null) {
        window.clearTimeout(spinTimerRef.current);
      }
      if (spinRafRef.current !== null) {
        window.cancelAnimationFrame(spinRafRef.current);
      }
    };
  }, []);

  const triggerActionWithSpin = useCallback((actionId: string, action: () => void) => {
    if (spinTimerRef.current !== null) {
      window.clearTimeout(spinTimerRef.current);
      spinTimerRef.current = null;
    }
    if (spinRafRef.current !== null) {
      window.cancelAnimationFrame(spinRafRef.current);
      spinRafRef.current = null;
    }

    // Reset first so repeated clicks on the same action can replay animation reliably.
    setSpinningAction(null);
    spinRafRef.current = window.requestAnimationFrame(() => {
      spinRafRef.current = null;
      setSpinningAction(actionId);
      spinTimerRef.current = window.setTimeout(() => {
        setSpinningAction((current) => (current === actionId ? null : current));
        spinTimerRef.current = null;
      }, 420);
    });

    try {
      action();
    } catch (error) {
      console.error("[file-tree-root-actions] action handler failed", error);
    }
  }, []);

  const actionClassName = (actionId: string, extra = "") =>
    `coss-file-tree-root-action inline-flex !size-6 items-center justify-center !rounded-sm !border-0 !bg-background/90 !p-0 !text-xs !font-normal text-muted-foreground/80 !shadow-none backdrop-blur-sm !transition-colors hover:bg-[color-mix(in_srgb,var(--background)_92%,var(--foreground)_8%)] hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 [&_svg]:!size-3.5 [&_svg]:stroke-[1.8]${spinningAction === actionId ? " is-spinning [&>svg]:animate-spin" : ""}${extra ? ` ${extra}` : ""}`;

  return (
    <div className="coss-file-tree-root-actions inline-flex flex-none items-center gap-1">
      {showDetachedExplorerAction ? (
        <button
          type="button"
          className={actionClassName("detached")}
          onClick={() =>
            triggerActionWithSpin("detached", () => onOpenDetachedExplorer?.(detachedInitialFilePath))
          }
          disabled={!onOpenDetachedExplorer}
          aria-label={t("files.openDetachedExplorer")}
          title={t("files.openDetachedExplorer")}
        >
          <ExternalLink aria-hidden />
        </button>
      ) : null}
      {showSpecHubAction ? (
        <button
          type="button"
          className={actionClassName(
            "spec-hub",
            isSpecHubActive ? "is-active bg-accent text-accent-foreground" : "",
          )}
          onClick={() => triggerActionWithSpin("spec-hub", () => onOpenSpecHub?.())}
          disabled={!onOpenSpecHub}
          aria-label={t("sidebar.specHub")}
          title={t("sidebar.specHub")}
        >
          <LayoutDashboard aria-hidden />
        </button>
      ) : null}
      <button
        type="button"
        className={actionClassName("new-file")}
        onClick={() =>
          triggerActionWithSpin("new-file", () => onOpenNewFile(selectedParentFolder))
        }
        aria-label={t("files.newFile")}
        title={t("files.newFile")}
      >
        <FilePlus aria-hidden />
      </button>
      <button
        type="button"
        className={actionClassName("new-folder")}
        onClick={() =>
          triggerActionWithSpin("new-folder", () => onOpenNewFolder(selectedParentFolder))
        }
        aria-label={t("files.newFolder")}
        title={t("files.newFolder")}
      >
        <FolderPlus aria-hidden />
      </button>
      <button
        type="button"
        className={actionClassName("refresh")}
        onClick={() => triggerActionWithSpin("refresh", () => onRefreshFiles?.())}
        disabled={!onRefreshFiles}
        aria-label={t("files.refreshFiles")}
        title={t("files.refreshFiles")}
      >
        <RefreshCw aria-hidden />
      </button>
      <button
        type="button"
        className={actionClassName(
          "trash",
          "coss-file-tree-root-action-danger text-destructive hover:text-destructive",
        )}
        onClick={() => triggerActionWithSpin("trash", onTrashSelected)}
        disabled={!canTrashSelectedNode}
        aria-label={t("files.deleteItem")}
        title={t("files.deleteItem")}
      >
        <Trash2 aria-hidden />
      </button>
    </div>
  );
}
