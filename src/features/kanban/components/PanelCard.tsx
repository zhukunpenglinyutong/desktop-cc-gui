import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import MoreHorizontal from "lucide-react/dist/esm/icons/more-horizontal";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import type { KanbanPanel, KanbanTask, KanbanTaskStatus } from "../types";

type PanelCardProps = {
  panel: KanbanPanel;
  tasks: KanbanTask[];
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
};

const STATUS_COLORS: Record<KanbanTaskStatus, string> = {
  todo: "#1a1a1a",
  inprogress: "#3b82f6",
  testing: "#f59e0b",
  done: "#22c55e",
};

export function PanelCard({
  panel,
  tasks,
  onSelect,
  onRename,
  onDelete,
}: PanelCardProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(panel.name);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const statusCounts: Record<KanbanTaskStatus, number> = {
    todo: 0,
    inprogress: 0,
    testing: 0,
    done: 0,
  };
  for (const task of tasks) {
    if (statusCounts[task.status] !== undefined) {
      statusCounts[task.status] += 1;
    }
  }

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renaming]);

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== panel.name) {
      onRename(trimmed);
    }
    setRenaming(false);
  };

  const handleCardClick = () => {
    if (!renaming) {
      onSelect();
    }
  };

  return (
    <div className="kanban-panel-card bg-[color:var(--bg-primary,#fff)] border border-[color:var(--border-color,#e5e5e5)] rounded-[10px] p-4 cursor-pointer transition-[border-color,box-shadow] duration-150 hover:border-[color:var(--border-hover,#ccc)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]" onClick={handleCardClick}>
      <div className="kanban-panel-card-header flex items-center gap-2 mb-3">
        <LayoutGrid size={18} className="kanban-panel-card-icon text-[color:var(--text-secondary,#666)] shrink-0" />
        {renaming ? (
          <input
            ref={renameRef}
            className="kanban-panel-rename-input text-[15px] font-semibold text-[color:var(--text-primary,#111)] bg-[color:var(--bg-secondary,#f8f8f8)] border border-[color:var(--accent-color,#3b82f6)] rounded px-1.5 py-0.5 flex-1 min-w-0 outline-none"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
              if (e.key === "Escape") setRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="kanban-panel-card-name text-[15px] font-semibold text-[color:var(--text-primary,#111)] overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">{panel.name}</span>
        )}
        <div className="kanban-panel-card-menu relative shrink-0 ml-auto" ref={menuRef}>
          <button
            className="kanban-icon-btn flex items-center justify-center w-7 h-7 p-0 border-none bg-transparent rounded-[6px] cursor-pointer text-[color:var(--text-secondary,#666)] transition-[background,color] duration-150 hover:bg-[color:var(--bg-tertiary,#f0f0f0)] hover:text-[color:var(--text-primary,#111)]"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((prev) => !prev);
            }}
            aria-label={t("kanban.panel.menu")}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div className="kanban-dropdown-menu absolute top-full right-0 z-[100] min-w-[140px] bg-[color:var(--surface-popover,var(--bg-primary,#fff))] border border-[color:var(--border-strong,var(--border-color,#e5e5e5))] rounded-lg shadow-[0_10px_26px_rgba(0,0,0,0.22)] p-1">
              <button
                className="kanban-dropdown-item flex items-center gap-2 w-full px-2.5 py-2 border-none bg-transparent rounded-[6px] text-[13px] text-[color:var(--text-primary,#111)] cursor-pointer text-left hover:bg-[color:var(--bg-tertiary,#f0f0f0)]"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  setRenameValue(panel.name);
                  setRenaming(true);
                }}
              >
                <Pencil size={14} />
                {t("kanban.panel.rename")}
              </button>
              <button
                className="kanban-dropdown-item kanban-dropdown-item-danger flex items-center gap-2 w-full px-2.5 py-2 border-none bg-transparent rounded-[6px] text-[13px] text-[#dc2626] cursor-pointer text-left hover:bg-[#fef2f2]"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onDelete();
                }}
              >
                <Trash2 size={14} />
                {t("kanban.panel.delete")}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="kanban-panel-card-stats flex flex-wrap gap-x-3 gap-y-2 mb-3">
        {(["todo", "inprogress", "testing", "done"] as KanbanTaskStatus[]).map(
          (status) =>
            statusCounts[status] > 0 && (
              <span key={status} className="kanban-panel-stat inline-flex items-center gap-1 text-xs text-[color:var(--text-secondary,#666)]">
                <span
                  className="kanban-panel-stat-dot w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: STATUS_COLORS[status] }}
                />
                {t(`kanban.columns.${status}`)} {statusCounts[status]}
              </span>
            )
        )}
      </div>
      <div className="kanban-panel-card-footer text-xs text-[color:var(--text-tertiary,#999)]">
        <span className="kanban-panel-card-count text-[color:var(--text-secondary,#666)]">
          {t("kanban.projects.taskCount", { count: tasks.length })}
        </span>
      </div>
    </div>
  );
}
