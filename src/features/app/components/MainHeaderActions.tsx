import { memo } from "react";
import { useTranslation } from "react-i18next";
import Construction from "lucide-react/dist/esm/icons/construction";
import Focus from "lucide-react/dist/esm/icons/focus";
import LayoutDashboard from "lucide-react/dist/esm/icons/layout-dashboard";
import BookOpen from "lucide-react/dist/esm/icons/book-open";
import PanelLeftClose from "lucide-react/dist/esm/icons/panel-left-close";
import PanelLeftOpen from "lucide-react/dist/esm/icons/panel-left-open";
import PanelRightClose from "lucide-react/dist/esm/icons/panel-right-close";
import PanelRightOpen from "lucide-react/dist/esm/icons/panel-right-open";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import { TooltipIconButton } from "../../../components/ui/tooltip-icon-button";
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
  showSoloButton?: boolean;
  isSoloMode?: boolean;
  onToggleSoloMode?: () => void;
  showSpecHubButton?: boolean;
  isSpecHubActive?: boolean;
  onOpenSpecHub?: () => void;
  showClientDocumentationButton?: boolean;
  onOpenClientDocumentation?: () => void;
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
  showSoloButton = false,
  isSoloMode = false,
  onToggleSoloMode,
  showSpecHubButton = false,
  isSpecHubActive = false,
  onOpenSpecHub,
  showClientDocumentationButton = false,
  onOpenClientDocumentation,
}: MainHeaderActionsProps) {
  const { t } = useTranslation();
  const {
    rightPanelAvailable = true,
    isLayoutSwapped = false,
    onCollapseRightPanel,
    onExpandRightPanel,
  } =
    sidebarToggleProps;

  const canToggleRuntimeConsole =
    showRuntimeConsoleButton && Boolean(onToggleRuntimeConsole);
  const canToggleTerminal = showTerminalButton && Boolean(onToggleTerminal);
  const canToggleSoloMode = showSoloButton && Boolean(onToggleSoloMode);
  const canToggleSpecHub = showSpecHubButton && Boolean(onOpenSpecHub);
  const canOpenClientDocumentation =
    showClientDocumentationButton && Boolean(onOpenClientDocumentation);

  if (
    isCompact ||
    (!rightPanelAvailable &&
      !canToggleRuntimeConsole &&
      !canToggleTerminal &&
      !canToggleSoloMode &&
      !canOpenClientDocumentation)
  ) {
    return null;
  }

  const isCollapsed = rightPanelCollapsed;
  const labelKey = isCollapsed ? "sidebar.showGitSidebar" : "sidebar.hideGitSidebar";

  return (
    <>
      {canToggleRuntimeConsole && (
        <TooltipIconButton
          className={`ghost main-header-action p-1.5 rounded-lg inline-flex items-center justify-center${isRuntimeConsoleVisible ? " is-active" : ""}`}
          onClick={() => onToggleRuntimeConsole?.()}
          data-tauri-drag-region="false"
          label={t("files.openRunConsole")}
        >
          <Construction size={14} aria-hidden />
        </TooltipIconButton>
      )}
      {canToggleTerminal && (
        <TooltipIconButton
          className={`ghost main-header-action${isTerminalOpen ? " is-active" : ""}`}
          onClick={() => onToggleTerminal?.()}
          data-tauri-drag-region="false"
          label={t("common.toggleTerminalPanel")}
        >
          <TerminalSquare size={14} aria-hidden />
        </TooltipIconButton>
      )}
      {canToggleSoloMode && (
        <TooltipIconButton
          className={`ghost main-header-action${isSoloMode ? " is-active" : ""}`}
          onClick={() => onToggleSoloMode?.()}
          data-tauri-drag-region="false"
          label={t(isSoloMode ? "sidebar.exitSoloMode" : "sidebar.enterSoloMode")}
        >
          <Focus size={14} aria-hidden />
        </TooltipIconButton>
      )}
      {canToggleSpecHub && (
        <TooltipIconButton
          className={`ghost main-header-action${isSpecHubActive ? " is-active" : ""}`}
          onClick={() => onOpenSpecHub?.()}
          data-tauri-drag-region="false"
          label={t("sidebar.specHub")}
        >
          <LayoutDashboard size={14} aria-hidden />
        </TooltipIconButton>
      )}
      {canOpenClientDocumentation && (
        <TooltipIconButton
          className="ghost main-header-action"
          onClick={() => onOpenClientDocumentation?.()}
          data-tauri-drag-region="false"
          label={t("clientDocumentation.open")}
        >
          <BookOpen size={14} aria-hidden />
        </TooltipIconButton>
      )}
      {rightPanelAvailable && !isSoloMode && (
        <TooltipIconButton
          className="ghost main-header-action"
          onClick={isCollapsed ? onExpandRightPanel : onCollapseRightPanel}
          data-tauri-drag-region="false"
          label={t(labelKey)}
        >
          {isCollapsed ? (
            isLayoutSwapped ? <PanelLeftOpen size={14} aria-hidden /> : <PanelRightOpen size={14} aria-hidden />
          ) : (
            isLayoutSwapped ? <PanelLeftClose size={14} aria-hidden /> : <PanelRightClose size={14} aria-hidden />
          )}
        </TooltipIconButton>
      )}
    </>
  );
});
