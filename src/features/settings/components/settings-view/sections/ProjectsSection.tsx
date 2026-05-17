import type { Dispatch, SetStateAction } from "react";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import GripVertical from "lucide-react/dist/esm/icons/grip-vertical";
import MoreHorizontal from "lucide-react/dist/esm/icons/more-horizontal";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Plus from "lucide-react/dist/esm/icons/plus";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { WorkspaceGroup, WorkspaceInfo } from "@/types";
import { isDefaultWorkspacePath } from "@/features/workspaces/utils/defaultWorkspace";

type GroupedWorkspace = {
  id: string | null;
  name: string;
  workspaces: WorkspaceInfo[];
};

type ProjectsSectionProps = {
  active: boolean;
  t: (key: string) => string;
  createGroupOpen: boolean;
  setCreateGroupOpen: (open: boolean) => void;
  newGroupName: string;
  setNewGroupName: (name: string) => void;
  canCreateGroup: boolean;
  handleCreateGroup: () => Promise<void>;
  groupError: string | null;
  workspaceGroups: WorkspaceGroup[];
  handleDragEnd: (result: DropResult) => void;
  renamingGroupId: string | null;
  setRenamingGroupId: (id: string | null) => void;
  groupDrafts: Record<string, string>;
  setGroupDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  handleRenameGroup: (group: WorkspaceGroup) => Promise<void>;
  handleChooseGroupCopiesFolder: (group: WorkspaceGroup) => Promise<void>;
  handleClearGroupCopiesFolder: (group: WorkspaceGroup) => Promise<void>;
  handleDeleteGroup: (group: WorkspaceGroup) => Promise<void>;
  groupedWorkspaces: GroupedWorkspace[];
  onAssignWorkspaceGroup: (
    workspaceId: string,
    groupId: string | null,
  ) => Promise<boolean | null>;
  ungroupedLabel: string;
  onMoveWorkspace: (id: string, direction: "up" | "down") => void;
  onDeleteWorkspace: (id: string) => void;
};

export function ProjectsSection({
  active,
  t,
  createGroupOpen,
  setCreateGroupOpen,
  newGroupName,
  setNewGroupName,
  canCreateGroup,
  handleCreateGroup,
  groupError,
  workspaceGroups,
  handleDragEnd,
  renamingGroupId,
  setRenamingGroupId,
  groupDrafts,
  setGroupDrafts,
  handleRenameGroup,
  handleChooseGroupCopiesFolder,
  handleClearGroupCopiesFolder,
  handleDeleteGroup,
  groupedWorkspaces,
  onAssignWorkspaceGroup,
  ungroupedLabel,
  onMoveWorkspace,
  onDeleteWorkspace,
}: ProjectsSectionProps) {
  if (!active) {
    return null;
  }

  const visibleGroupedWorkspaces = groupedWorkspaces
    .map((group) => ({
      ...group,
      workspaces: group.workspaces.filter(
        (workspace) => !isDefaultWorkspacePath(workspace.path),
      ),
    }))
    .filter((group) => group.workspaces.length > 0);
  const visibleProjectsCount = visibleGroupedWorkspaces.reduce(
    (total, group) => total + group.workspaces.length,
    0,
  );

  return (
    <section className="settings-section w-full max-w-[980px]">
      <div className="settings-section-title text-[15px] font-semibold text-(--text-strong) mb-1">{t("settings.projectsTitle")}</div>
      <div className="settings-section-subtitle text-xs text-(--text-subtle) mb-4">
        {t("settings.projectsDescription")}
      </div>
      <div className="settings-subsection-header">
        <div className="settings-subsection-title">{t("settings.groupsTitle")}</div>
        <Popover open={createGroupOpen} onOpenChange={setCreateGroupOpen}>
          <PopoverTrigger asChild>
            <button
              className="ghost icon-button"
              aria-label={t("settings.addGroupButton")}
            >
              <Plus aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="p-3">
            <div className="settings-popover-content flex flex-col gap-2 w-65">
              <div className="settings-field-label">
                {t("settings.newGroupPlaceholder")}
              </div>
              <input
                className="settings-input settings-input--compact"
                value={newGroupName}
                autoFocus
                placeholder={t("settings.newGroupPlaceholder")}
                onChange={(event) => setNewGroupName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canCreateGroup) {
                    event.preventDefault();
                    void handleCreateGroup();
                  }
                }}
              />
              <div className="settings-popover-actions flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCreateGroupOpen(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  disabled={!canCreateGroup}
                  onClick={() => {
                    void handleCreateGroup();
                  }}
                >
                  {t("common.create")}
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <div className="settings-subsection-subtitle">
        {t("settings.groupsDescription")}
      </div>
      <div className="settings-groups flex flex-col gap-2.5">
        {groupError && <div className="settings-group-error text-[11px] text-(--status-error)">{groupError}</div>}
        {workspaceGroups.length > 0 ? (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="settings-group-list">
              {(provided) => (
                <div
                  className="settings-group-list flex flex-col border border-(--border-muted) rounded-lg overflow-hidden"
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                >
                  {workspaceGroups.map((group, index) => (
                    <Draggable
                      key={group.id}
                      draggableId={group.id}
                      index={index}
                    >
                      {(draggableProvided, snapshot) => (
                        <div
                          ref={draggableProvided.innerRef}
                          {...draggableProvided.draggableProps}
                          className={`settings-group-row flex items-center gap-2 px-2 py-1.5 min-h-9 transition-colors bg-(--surface-card) ${
                            snapshot.isDragging ? "is-dragging" : ""
                          }`}
                          style={draggableProvided.draggableProps.style}
                        >
                          <span
                            className="settings-group-drag-handle flex items-center justify-center text-(--text-faint) cursor-grab shrink-0 w-5"
                            {...draggableProvided.dragHandleProps}
                          >
                            <GripVertical aria-hidden />
                          </span>

                          <div className="settings-group-name flex-1 min-w-0">
                            {renamingGroupId === group.id ? (
                              <input
                                className="settings-input settings-input--compact"
                                value={groupDrafts[group.id] ?? group.name}
                                autoFocus
                                onChange={(event) =>
                                  setGroupDrafts((prev) => ({
                                    ...prev,
                                    [group.id]: event.target.value,
                                  }))
                                }
                                onBlur={() => {
                                  void handleRenameGroup(group);
                                  setRenamingGroupId(null);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void handleRenameGroup(group);
                                    setRenamingGroupId(null);
                                  }
                                  if (event.key === "Escape") {
                                    setGroupDrafts((prev) => ({
                                      ...prev,
                                      [group.id]: group.name,
                                    }));
                                    setRenamingGroupId(null);
                                  }
                                }}
                              />
                            ) : (
                              <span
                                className="settings-group-name-text block text-[13px] text-(--text-strong) whitespace-nowrap overflow-hidden text-ellipsis cursor-default select-none py-0.5 px-1 rounded"
                                onDoubleClick={() => setRenamingGroupId(group.id)}
                              >
                                {group.name}
                              </span>
                            )}
                          </div>

                          {group.copiesFolder && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <span className="settings-group-folder-indicator flex items-center justify-center text-(--text-faint) shrink-0">
                                    <FolderOpen aria-hidden />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p>{group.copiesFolder}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="ghost icon-button"
                                aria-label={t("settings.groupMoreActions")}
                              >
                                <MoreHorizontal aria-hidden />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem
                                onSelect={() => setRenamingGroupId(group.id)}
                              >
                                <Pencil aria-hidden />
                                {t("settings.renameGroup")}
                              </DropdownMenuItem>

                              <DropdownMenuSeparator />

                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                  <FolderOpen aria-hidden />
                                  {t("settings.copiesFolder")}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      void handleChooseGroupCopiesFolder(group);
                                    }}
                                  >
                                    {t("settings.chooseEllipsis")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      void handleClearGroupCopiesFolder(group);
                                    }}
                                    disabled={!group.copiesFolder}
                                  >
                                    {t("settings.clear")}
                                  </DropdownMenuItem>
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>

                              <DropdownMenuSeparator />

                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => {
                                  void handleDeleteGroup(group);
                                }}
                              >
                                <Trash2 aria-hidden />
                                {t("settings.deleteGroupAction")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        ) : (
          <div className="settings-empty">{t("settings.noGroupsYet")}</div>
        )}
      </div>
      <div className="settings-subsection-title">{t("settings.projectsSubsectionTitle")}</div>
      <div className="settings-subsection-subtitle">
        {t("settings.projectsSubsectionDescription")}
      </div>
      <div className="settings-projects flex flex-col gap-2.5">
        {visibleGroupedWorkspaces.map((group) => (
          <div key={group.id ?? "ungrouped"} className="settings-project-group flex flex-col gap-2.5">
            <div className="settings-project-group-label uppercase text-[11px] tracking-[0.08em] text-(--text-faint) pl-1">{group.name}</div>
            {group.workspaces.map((workspace, index) => {
              const groupValue =
                workspaceGroups.some(
                  (entry) => entry.id === workspace.settings.groupId,
                )
                  ? workspace.settings.groupId ?? ""
                  : "";
              return (
                <div key={workspace.id} className="settings-project-row flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl bg-(--surface-card) border border-(--border-muted)">
                  <div className="settings-project-info flex flex-col gap-1 min-w-0">
                    <div className="settings-project-name text-[13px] font-semibold text-(--text-strong)">{workspace.name}</div>
                    <div className="settings-project-path text-[11px] text-(--text-subtle) whitespace-nowrap overflow-hidden text-ellipsis">{workspace.path}</div>
                  </div>
                  <div className="settings-project-actions inline-flex gap-1.5">
                    <select
                      className="settings-select settings-select--compact"
                      value={groupValue}
                      onChange={(event) => {
                        const nextGroupId = event.target.value || null;
                        void onAssignWorkspaceGroup(
                          workspace.id,
                          nextGroupId,
                        );
                      }}
                    >
                      <option value="">{ungroupedLabel}</option>
                      {workspaceGroups.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="ghost icon-button"
                      onClick={() => onMoveWorkspace(workspace.id, "up")}
                      disabled={index === 0}
                      aria-label={t("settings.moveProjectUp")}
                    >
                      <ChevronUp aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="ghost icon-button"
                      onClick={() => onMoveWorkspace(workspace.id, "down")}
                      disabled={index === group.workspaces.length - 1}
                      aria-label={t("settings.moveProjectDown")}
                    >
                      <ChevronDown aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="ghost icon-button"
                      onClick={() => onDeleteWorkspace(workspace.id)}
                      aria-label={t("settings.deleteProject")}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {visibleProjectsCount === 0 && (
          <div className="settings-empty">{t("settings.noProjectsYet")}</div>
        )}
      </div>
    </section>
  );
}
