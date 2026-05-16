import { useTranslation } from "react-i18next";
import Plus from "lucide-react/dist/esm/icons/plus";
import type { AppMode, WorkspaceInfo } from "../../../types";
import type { KanbanTask } from "../types";
import { ProjectCard } from "./ProjectCard";
import { KanbanModeToggle } from "./KanbanModeToggle";

type ProjectListProps = {
  workspaces: WorkspaceInfo[];
  tasks: KanbanTask[];
  onSelectWorkspace: (workspaceId: string) => void;
  onAddWorkspace: () => void;
  onAppModeChange: (mode: AppMode) => void;
};

export function ProjectList({
  workspaces,
  tasks,
  onSelectWorkspace,
  onAddWorkspace,
  onAppModeChange,
}: ProjectListProps) {
  const { t } = useTranslation();

  // Only show main workspaces (not worktrees)
  const mainWorkspaces = workspaces.filter((w) => w.kind !== "worktree");

  return (
    <div className="kanban-projects flex flex-col h-full overflow-hidden">
      <div className="kanban-projects-topbar flex items-center py-3 pr-6 pl-20 border-b border-[var(--border-color,#e5e5e5)] relative z-[3] [-webkit-app-region:drag] [&>*]:[-webkit-app-region:no-drag]">
        <KanbanModeToggle appMode="kanban" onAppModeChange={onAppModeChange} />
      </div>
      <div className="kanban-projects-content flex-1 overflow-y-auto py-8 px-10">
        <div className="kanban-projects-header flex items-start justify-between mb-6">
          <div>
            <h1 className="kanban-projects-title text-2xl font-bold m-0 mb-1 text-[var(--text-primary,#111)]">
              {t("kanban.projects.title")}
            </h1>
            <p className="kanban-projects-subtitle text-sm text-[var(--text-secondary,#666)] m-0">
              {t("kanban.projects.subtitle")}
            </p>
          </div>
          <button
            className="kanban-btn kanban-btn-primary"
            onClick={onAddWorkspace}
          >
            <Plus size={16} />
            {t("sidebar.addWorkspace")}
          </button>
        </div>

        {mainWorkspaces.length === 0 ? (
          <div className="kanban-empty">
            <p>{t("kanban.projects.empty")}</p>
            <button
              className="kanban-btn kanban-btn-primary"
              onClick={onAddWorkspace}
            >
              <Plus size={16} />
              {t("sidebar.addWorkspace")}
            </button>
          </div>
        ) : (
          <div className="kanban-projects-grid grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
            {mainWorkspaces.map((workspace) => (
              <ProjectCard
                key={workspace.id}
                workspace={workspace}
                taskCount={
                  tasks.filter((t) => t.workspaceId === workspace.path).length
                }
                onSelect={() => onSelectWorkspace(workspace.path)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
