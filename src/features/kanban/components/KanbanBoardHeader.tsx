import { useTranslation } from "react-i18next";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import Search from "lucide-react/dist/esm/icons/search";
import CornerUpLeft from "lucide-react/dist/esm/icons/corner-up-left";
import PanelRight from "lucide-react/dist/esm/icons/panel-right";
import { useState, useRef, useEffect, useMemo } from "react";
import type { AppMode, WorkspaceInfo } from "../../../types";
import type { KanbanPanel } from "../types";
import { KanbanModeToggle } from "./KanbanModeToggle";

type KanbanBoardHeaderProps = {
  workspace: WorkspaceInfo;
  workspaces: WorkspaceInfo[];
  panel: KanbanPanel;
  panels: KanbanPanel[];
  onBack: () => void;
  onAppModeChange: (mode: AppMode) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectPanel: (panelId: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  showGitPanel: boolean;
  onToggleGitPanel: () => void;
};

export function KanbanBoardHeader({
  workspace,
  workspaces,
  panel,
  panels,
  onBack,
  onAppModeChange,
  onSelectWorkspace,
  onSelectPanel,
  searchQuery,
  onSearchChange,
  showGitPanel,
  onToggleGitPanel,
}: KanbanBoardHeaderProps) {
  const { t } = useTranslation();
  const [backMenuOpen, setBackMenuOpen] = useState(false);
  const backMenuRef = useRef<HTMLDivElement | null>(null);
  const [panelMenuOpen, setPanelMenuOpen] = useState(false);
  const [panelQuery, setPanelQuery] = useState("");
  const panelMenuRef = useRef<HTMLDivElement | null>(null);

  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [wsQuery, setWsQuery] = useState("");
  const wsMenuRef = useRef<HTMLDivElement | null>(null);

  const showPanelMenu = panels.length > 1;
  const showWsMenu = workspaces.length > 1;

  const trimmedQuery = panelQuery.trim().toLowerCase();
  const filteredPanels = useMemo(() => {
    if (trimmedQuery.length === 0) return panels;
    return panels.filter((p) =>
      p.name.toLowerCase().includes(trimmedQuery)
    );
  }, [panels, trimmedQuery]);

  const trimmedWsQuery = wsQuery.trim().toLowerCase();
  const filteredWorkspaces = useMemo(() => {
    if (trimmedWsQuery.length === 0) return workspaces;
    return workspaces.filter((w) =>
      w.name.toLowerCase().includes(trimmedWsQuery)
    );
  }, [workspaces, trimmedWsQuery]);

  const handleSelectPanel = (panelId: string) => {
    onSelectPanel(panelId);
    setPanelMenuOpen(false);
    setPanelQuery("");
  };

  const handleSelectWorkspace = (workspaceId: string) => {
    onSelectWorkspace(workspaceId);
    setWsMenuOpen(false);
    setWsQuery("");
  };

  const handleBackToPanels = () => {
    setBackMenuOpen(false);
    onBack();
  };

  const handleBackToChat = () => {
    setBackMenuOpen(false);
    onAppModeChange("chat");
  };

  useEffect(() => {
    if (!backMenuOpen) return;
    const handleClick = (event: Event) => {
      const target = event.target as Node;
      if (!(backMenuRef.current?.contains(target) ?? false)) {
        setBackMenuOpen(false);
      }
    };
    const outsidePressEvent = "PointerEvent" in window ? "pointerdown" : "mousedown";
    window.addEventListener(outsidePressEvent, handleClick);
    return () => window.removeEventListener(outsidePressEvent, handleClick);
  }, [backMenuOpen]);

  useEffect(() => {
    if (!panelMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!(panelMenuRef.current?.contains(target) ?? false)) {
        setPanelMenuOpen(false);
        setPanelQuery("");
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [panelMenuOpen]);

  useEffect(() => {
    if (!wsMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!(wsMenuRef.current?.contains(target) ?? false)) {
        setWsMenuOpen(false);
        setWsQuery("");
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [wsMenuOpen]);

  return (
    <div className="kanban-board-header">
      <div className="kanban-board-header-left">
        <KanbanModeToggle appMode="kanban" onAppModeChange={onAppModeChange} />
        <div className="kanban-back-menu relative" ref={backMenuRef}>
          <button
            type="button"
            className={`kanban-back-menu-trigger inline-flex items-center gap-1.5 bg-transparent border border-transparent text-[var(--text-secondary,#666)] text-[13px] font-medium cursor-pointer px-2.5 h-7 rounded-md transition-[background,color,border-color] duration-150 hover:bg-[var(--bg-tertiary,#f0f0f0)] hover:text-[var(--text-primary,#111)]${
              backMenuOpen
                ? " border-[var(--border-color,#e5e5e5)] bg-[var(--bg-secondary,#f8f8f8)] text-[var(--text-primary,#111)]"
                : ""
            }`}
            onClick={() => setBackMenuOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={backMenuOpen}
            aria-label={t("kanban.board.backActions")}
          >
            <ArrowLeft size={16} />
            <span>{t("kanban.board.back")}</span>
          </button>
          {backMenuOpen && (
            <div
              className="kanban-back-menu-list popover-surface absolute top-[calc(100%+6px)] left-0 min-w-[156px] z-[11] rounded-[10px] p-1.5 flex flex-col gap-1"
              role="menu"
            >
              <button
                type="button"
                className="kanban-back-menu-item inline-flex items-center gap-1.5 w-full border-none rounded-lg bg-transparent text-[var(--text-secondary,#666)] text-[13px] text-left py-1.5 px-2 cursor-pointer hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary,#111)]"
                onClick={handleBackToPanels}
                role="menuitem"
              >
                <ArrowLeft size={14} />
                <span>{t("kanban.board.backToPanels")}</span>
              </button>
              <button
                type="button"
                className="kanban-back-menu-item inline-flex items-center gap-1.5 w-full border-none rounded-lg bg-transparent text-[var(--text-secondary,#666)] text-[13px] text-left py-1.5 px-2 cursor-pointer hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary,#111)]"
                onClick={handleBackToChat}
                role="menuitem"
              >
                <CornerUpLeft size={14} />
                <span>{t("kanban.board.backToChat")}</span>
              </button>
            </div>
          )}
        </div>
        {showWsMenu ? (
          <div className="kanban-project-menu relative inline-flex items-center min-w-0" ref={wsMenuRef}>
            <button
              type="button"
              className="kanban-project-button inline-flex items-center gap-1 bg-transparent border-none cursor-pointer py-0.5 px-1 rounded-md min-w-0 hover:bg-[var(--surface-control-hover)]"
              onClick={() => setWsMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={wsMenuOpen}
            >
              <span className="kanban-breadcrumb-workspace">{workspace.name}</span>
              <span className="kanban-project-caret text-[var(--text-faint)] text-xs shrink-0 leading-none" aria-hidden>
                ›
              </span>
            </button>
            {wsMenuOpen && (
              <div
                className="kanban-project-dropdown popover-surface absolute top-[calc(100%+6px)] left-0 min-w-[220px] max-w-[320px] max-h-[360px] z-10 rounded-[10px] p-1.5 flex flex-col gap-1 overflow-hidden"
                role="menu"
              >
                <div className="project-search">
                  <input
                    value={wsQuery}
                    onChange={(e) => setWsQuery(e.target.value)}
                    placeholder={t("kanban.workspace.searchWorkspaces")}
                    className="branch-input"
                    autoFocus
                    aria-label={t("kanban.workspace.searchWorkspaces")}
                  />
                </div>
                <div className="project-list" role="none">
                  {filteredWorkspaces.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      className={`project-item${
                        w.id === workspace.id ? " is-active" : ""
                      }`}
                      onClick={() => handleSelectWorkspace(w.id)}
                      role="menuitem"
                    >
                      {w.name}
                    </button>
                  ))}
                  {filteredWorkspaces.length === 0 && (
                    <div className="project-empty">
                      {t("kanban.workspace.noWorkspacesFound")}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <span className="kanban-breadcrumb-workspace">{workspace.name}</span>
        )}
        <span className="kanban-breadcrumb-sep" aria-hidden>›</span>
        {showPanelMenu ? (
          <div className="kanban-project-menu relative inline-flex items-center min-w-0" ref={panelMenuRef}>
            <button
              type="button"
              className="kanban-project-button inline-flex items-center gap-1 bg-transparent border-none cursor-pointer py-0.5 px-1 rounded-md min-w-0 hover:bg-[var(--surface-control-hover)]"
              onClick={() => setPanelMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={panelMenuOpen}
            >
              <h2 className="kanban-board-title">{panel.name}</h2>
              <span className="kanban-project-caret text-[var(--text-faint)] text-xs shrink-0 leading-none" aria-hidden>
                ›
              </span>
            </button>
            {panelMenuOpen && (
              <div
                className="kanban-project-dropdown popover-surface absolute top-[calc(100%+6px)] left-0 min-w-[220px] max-w-[320px] max-h-[360px] z-10 rounded-[10px] p-1.5 flex flex-col gap-1 overflow-hidden"
                role="menu"
              >
                <div className="project-search">
                  <input
                    value={panelQuery}
                    onChange={(e) => setPanelQuery(e.target.value)}
                    placeholder={t("kanban.panel.searchPanels")}
                    className="branch-input"
                    autoFocus
                    aria-label={t("kanban.panel.searchPanels")}
                  />
                </div>
                <div className="project-list" role="none">
                  {filteredPanels.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`project-item${
                        p.id === panel.id ? " is-active" : ""
                      }`}
                      onClick={() => handleSelectPanel(p.id)}
                      role="menuitem"
                    >
                      {p.name}
                    </button>
                  ))}
                  {filteredPanels.length === 0 && (
                    <div className="project-empty">
                      {t("kanban.panel.noPanelsFound")}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <h2 className="kanban-board-title">{panel.name}</h2>
        )}
      </div>
      <div className="kanban-board-header-center">
        <div className="kanban-search-box">
          <Search size={15} className="kanban-search-icon" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("kanban.board.searchPlaceholder")}
            className="kanban-search-input"
          />
        </div>
      </div>
      <div className="kanban-board-header-right">
        <button
          className={`kanban-icon-btn${showGitPanel ? " is-active" : ""}`}
          onClick={onToggleGitPanel}
          aria-label={t("kanban.board.toggleGitPanel")}
          aria-pressed={showGitPanel}
          data-tauri-drag-region="false"
        >
          <PanelRight size={18} />
        </button>
      </div>
    </div>
  );
}
