import type { AppMode } from "../../../types";
import { KanbanModeToggle } from "../../kanban/components/KanbanModeToggle";

type SidebarHeaderProps = {
  onSelectHome: () => void;
  onAddWorkspace: () => void;
  onToggleSearch: () => void;
  isSearchOpen: boolean;
  appMode: AppMode;
  onAppModeChange: (mode: AppMode) => void;
};

export function SidebarHeader({
  onSelectHome: _onSelectHome,
  onAddWorkspace: _onAddWorkspace,
  onToggleSearch: _onToggleSearch,
  isSearchOpen: _isSearchOpen,
  appMode,
  onAppModeChange,
}: SidebarHeaderProps) {
  return (
    <div className="sidebar-header flex items-center gap-2 px-2 pt-3 pb-1 mb-0 [-webkit-app-region:no-drag]">
      <div className="sidebar-header-actions flex items-center gap-1.5 w-full">
        <KanbanModeToggle
          appMode={appMode}
          onAppModeChange={onAppModeChange}
        />
      </div>
    </div>
  );
}
