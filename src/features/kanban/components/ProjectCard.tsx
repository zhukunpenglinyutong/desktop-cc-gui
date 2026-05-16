import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import type { WorkspaceInfo } from "../../../types";

type ProjectCardProps = {
  workspace: WorkspaceInfo;
  taskCount: number;
  onSelect: () => void;
};

/** Shorten absolute path: replace home dir with ~ */
function shortenPath(fullPath: string): string {
  const home =
    typeof window !== "undefined"
      ? (window as unknown as Record<string, unknown>).__HOME_DIR__
      : undefined;
  if (typeof home === "string" && fullPath.startsWith(home)) {
    return "~" + fullPath.slice(home.length);
  }
  // Fallback: try common macOS/Linux home prefix
  const match = fullPath.match(/^\/Users\/[^/]+\/(.+)$/);
  if (match) return "~/" + match[1];
  return fullPath;
}

export function ProjectCard({
  workspace,
  taskCount,
  onSelect,
}: ProjectCardProps) {
  const { t } = useTranslation();
  const displayPath = useMemo(
    () => shortenPath(workspace.path),
    [workspace.path],
  );

  return (
    <div
      className="kanban-project-card bg-[var(--bg-primary,#fff)] border border-[var(--border-color,#e5e5e5)] rounded-[10px] p-4 cursor-pointer transition-[border-color,box-shadow] duration-150 overflow-hidden min-w-0 hover:border-[var(--border-hover,#ccc)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
      onClick={onSelect}
    >
      <div className="kanban-project-card-header flex items-center justify-between mb-3">
        <FolderOpen size={18} className="kanban-project-card-icon" />
        <span className="kanban-project-card-name text-[15px] font-semibold text-[var(--text-primary,#111)] overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">
          {workspace.name}
        </span>
      </div>
      <div className="kanban-project-card-footer flex flex-col gap-2 text-xs text-[var(--text-tertiary,#999)] min-w-0">
        <span
          className="kanban-project-card-path overflow-hidden text-ellipsis whitespace-nowrap min-w-0"
          title={workspace.path}
        >
          {displayPath}
        </span>
        {taskCount > 0 && (
          <span className="kanban-project-card-count inline-flex items-center self-start py-0.5 px-2 text-[11px] font-medium text-[var(--text-secondary,#666)] bg-[var(--bg-secondary,#f5f5f5)] rounded whitespace-nowrap shrink-0">
            {t("kanban.projects.taskCount", { count: taskCount })}
          </span>
        )}
      </div>
    </div>
  );
}
