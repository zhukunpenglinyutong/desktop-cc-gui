import { memo } from "react";
import { useTranslation } from "react-i18next";
import Construction from "lucide-react/dist/esm/icons/construction";
import PanelRightClose from "lucide-react/dist/esm/icons/panel-right-close";
import PanelRightOpen from "lucide-react/dist/esm/icons/panel-right-open";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import type { SidebarToggleProps } from "../../layout/components/SidebarToggleControls";

type MainHeaderActionsProps = {
  isCompact: boolean;
  rightPanelCollapsed: boolean;
  sidebarToggleProps: SidebarToggleProps;
  showRuntimeConsoleButton?: boolean;
  isRuntimeConsoleVisible?: boolean;
  onToggleRuntimeConsole?: () => void;
  showTerminalButton?: boolean;
  isTerminalOpen?: boolean;
  onToggleTerminal?: () => void;
};

export const MainHeaderActions = memo(function MainHeaderActions({
  isCompact,
  rightPanelCollapsed,
  sidebarToggleProps,
  showRuntimeConsoleButton = false,
  isRuntimeConsoleVisible = false,
  onToggleRuntimeConsole,
  showTerminalButton = false,
  isTerminalOpen = false,
  onToggleTerminal,
}: MainHeaderActionsProps) {
  const { t } = useTranslation();
  const { rightPanelAvailable = true, onCollapseRightPanel, onExpandRightPanel } =
    sidebarToggleProps;

  const canToggleRuntimeConsole =
    showRuntimeConsoleButton && Boolean(onToggleRuntimeConsole);
  const canToggleTerminal = showTerminalButton && Boolean(onToggleTerminal);

  if (isCompact || (!rightPanelAvailable && !canToggleRuntimeConsole && !canToggleTerminal)) {
    return null;
  }

  const isCollapsed = rightPanelCollapsed;
  const labelKey = isCollapsed ? "sidebar.showGitSidebar" : "sidebar.hideGitSidebar";

  return (
    <>
      {canToggleRuntimeConsole && (
        <button
          type="button"
          className={`ghost main-header-action${isRuntimeConsoleVisible ? " is-active" : ""}`}
          onClick={() => onToggleRuntimeConsole?.()}
          data-tauri-drag-region="false"
          aria-label={t("files.openRunConsole")}
          title={t("files.openRunConsole")}
        >
          <Construction size={14} aria-hidden />
        </button>
      )}
      {canToggleTerminal && (
        <button
          type="button"
          className={`ghost main-header-action${isTerminalOpen ? " is-active" : ""}`}
          onClick={() => onToggleTerminal?.()}
          data-tauri-drag-region="false"
          aria-label={t("common.toggleTerminalPanel")}
          title={t("common.toggleTerminalPanel")}
        >
          <TerminalSquare size={14} aria-hidden />
        </button>
      )}
      {rightPanelAvailable && (
        <button
          type="button"
          className="ghost main-header-action"
          onClick={isCollapsed ? onExpandRightPanel : onCollapseRightPanel}
          data-tauri-drag-region="false"
          aria-label={t(labelKey)}
          title={t(labelKey)}
        >
          {isCollapsed ? (
            <PanelRightOpen size={14} aria-hidden />
          ) : (
            <PanelRightClose size={14} aria-hidden />
          )}
        </button>
      )}
    </>
  );
});
