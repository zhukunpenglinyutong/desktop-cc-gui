import { useCallback, useMemo, useState, type ReactNode, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { DragDropContext } from "@hello-pangea/dnd";
import type { DropResult } from "@hello-pangea/dnd";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import X from "lucide-react/dist/esm/icons/x";
import type { AppMode, EngineStatus, EngineType, WorkspaceInfo } from "../../../types";
import type {
  KanbanTaskChain,
  KanbanTaskSchedule,
  KanbanColumnDef,
  KanbanPanel,
  KanbanTask,
  KanbanTaskStatus,
} from "../types";
import { KanbanBoardHeader } from "./KanbanBoardHeader";
import { KanbanColumn } from "./KanbanColumn";
import { TaskCreateModal } from "./TaskCreateModal";
import { describeSchedule } from "../utils/scheduling";
import { formatKanbanBlockedReason } from "../utils/blockedReason";
import { chainPositionOfTask, resolveChainedDragBlockedReason } from "../utils/chaining";

type CreateTaskInput = {
  workspaceId: string;
  panelId: string;
  title: string;
  description: string;
  engineType: EngineType;
  modelId: string | null;
  branchName: string;
  images: string[];
  autoStart: boolean;
  schedule?: KanbanTaskSchedule;
  chain?: KanbanTaskChain;
};

type RecurringGroupDescriptor = {
  signature: string;
  seriesId: string | null;
};

function resolveRecurringGroupKey(descriptor: RecurringGroupDescriptor): string {
  return descriptor.seriesId
    ? `recurring:${descriptor.seriesId}`
    : `recurring:sig:${descriptor.signature}`;
}

function hashGroupSeed(seed: string): number {
  let hash = 0;
  for (const ch of seed) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function resolveRecurringGroupCode(seed: string): string {
  return `${(hashGroupSeed(seed) % 900) + 100}`;
}

function resolveRecurringGroupDescriptor(task: KanbanTask): RecurringGroupDescriptor | null {
  const schedule = task.schedule;
  if (
    schedule?.mode !== "recurring" ||
    schedule.recurringExecutionMode !== "new_thread"
  ) {
    return null;
  }
  const signature = [
    task.workspaceId,
    task.panelId,
    task.title,
    String(schedule.interval ?? 1),
    schedule.unit ?? "days",
    schedule.newThreadResultMode ?? "pass",
  ].join("|");
  const seriesId =
    typeof schedule.seriesId === "string" && schedule.seriesId.trim().length > 0
      ? schedule.seriesId.trim()
      : null;
  return { signature, seriesId };
}

function resolveUpstreamRecurringGroupCode(
  allTasksById: Map<string, KanbanTask>,
  task: KanbanTask,
): string | null {
  if (!task.chain?.previousTaskId) {
    return null;
  }
  const upstreamTask = allTasksById.get(task.chain.previousTaskId);
  if (!upstreamTask) {
    return null;
  }
  const recurringDescriptor = resolveRecurringGroupDescriptor(upstreamTask);
  if (!recurringDescriptor) {
    return null;
  }
  const recurringGroupKey = resolveRecurringGroupKey(recurringDescriptor);
  return resolveRecurringGroupCode(recurringGroupKey);
}

function resolveTaskChainGroupId(allTasks: KanbanTask[], task: KanbanTask): string | null {
  if (task.chain?.groupId) {
    return task.chain.groupId;
  }
  return (
    allTasks.find((entry) => entry.chain?.previousTaskId === task.id)?.chain?.groupId ??
    null
  );
}

function resolveRecurringRunIndex(task: KanbanTask): number | null {
  const schedule = task.schedule;
  if (schedule?.mode !== "recurring" || schedule.recurringExecutionMode !== "new_thread") {
    return null;
  }
  const completedRounds = Math.max(0, schedule.completedRounds ?? 0);
  if (task.status === "testing" || task.status === "done") {
    return Math.max(1, completedRounds);
  }
  return completedRounds + 1;
}

function resolveTaskSerialOrder(allTasks: KanbanTask[], task: KanbanTask): number | null {
  const chainGroupId = resolveTaskChainGroupId(allTasks, task);
  if (chainGroupId) {
    return chainPositionOfTask(allTasks, task.id);
  }
  return resolveRecurringRunIndex(task);
}

function sortTasksForColumnDisplay(columnTasks: KanbanTask[], allTasks: KanbanTask[]): KanbanTask[] {
  if (columnTasks.length <= 1) {
    return columnTasks.slice();
  }

  const chainGroupByTaskId = new Map<string, string>();
  const allTasksById = new Map(allTasks.map((task) => [task.id, task]));
  const chainGroupTaskCountById = new Map<string, number>();
  for (const task of allTasks) {
    if (!task.chain?.groupId) {
      continue;
    }
    chainGroupByTaskId.set(task.id, task.chain.groupId);
    if (task.chain.previousTaskId) {
      chainGroupByTaskId.set(task.chain.previousTaskId, task.chain.groupId);
    }
  }
  for (const task of columnTasks) {
    const chainGroupId = task.chain?.groupId ?? chainGroupByTaskId.get(task.id);
    if (!chainGroupId) {
      continue;
    }
    chainGroupTaskCountById.set(chainGroupId, (chainGroupTaskCountById.get(chainGroupId) ?? 0) + 1);
  }

  const recurringDescriptors = new Map<string, RecurringGroupDescriptor>();
  const recurringSeriesBySignature = new Map<string, Set<string>>();
  for (const task of columnTasks) {
    const descriptor = resolveRecurringGroupDescriptor(task);
    if (!descriptor) {
      continue;
    }
    recurringDescriptors.set(task.id, descriptor);
    if (descriptor.seriesId) {
      const current = recurringSeriesBySignature.get(descriptor.signature) ?? new Set<string>();
      current.add(descriptor.seriesId);
      recurringSeriesBySignature.set(descriptor.signature, current);
    }
  }

  const taskGroupKeyByTaskId = new Map<string, string>();
  const groupedTaskIdsByKey = new Map<string, string[]>();
  for (const task of columnTasks) {
    const recurringDescriptor = recurringDescriptors.get(task.id);
    if (recurringDescriptor) {
      const signatureSeries = recurringSeriesBySignature.get(recurringDescriptor.signature);
      const hasSingleSeries = (signatureSeries?.size ?? 0) === 1;
      const preferredSeriesId =
        recurringDescriptor.seriesId ??
        (hasSingleSeries ? Array.from(signatureSeries as Set<string>)[0] : null);
      const recurringGroupKey = preferredSeriesId
        ? `recurring:${preferredSeriesId}`
        : resolveRecurringGroupKey(recurringDescriptor);
      taskGroupKeyByTaskId.set(task.id, recurringGroupKey);
      groupedTaskIdsByKey.set(recurringGroupKey, [
        ...(groupedTaskIdsByKey.get(recurringGroupKey) ?? []),
        task.id,
      ]);
      continue;
    }

    const chainGroupId = task.chain?.groupId ?? chainGroupByTaskId.get(task.id);
    const chainGroupTaskCount = chainGroupId ? (chainGroupTaskCountById.get(chainGroupId) ?? 0) : 0;
    if (chainGroupId && chainGroupTaskCount >= 2) {
      const chainGroupKey = `chain:${chainGroupId}`;
      taskGroupKeyByTaskId.set(task.id, chainGroupKey);
      groupedTaskIdsByKey.set(chainGroupKey, [
        ...(groupedTaskIdsByKey.get(chainGroupKey) ?? []),
        task.id,
      ]);
      continue;
    }

    const chainOrderIndex = chainPositionOfTask(allTasks, task.id);
    const upstreamRecurringGroupCode = resolveUpstreamRecurringGroupCode(allTasksById, task);
    if (
      upstreamRecurringGroupCode &&
      Number.isFinite(chainOrderIndex) &&
      chainOrderIndex > 1
    ) {
      const recurringTriggeredChainGroupKey =
        `chain-upstream-scheduler:${upstreamRecurringGroupCode}:step:${Math.floor(chainOrderIndex)}`;
      taskGroupKeyByTaskId.set(task.id, recurringTriggeredChainGroupKey);
      groupedTaskIdsByKey.set(recurringTriggeredChainGroupKey, [
        ...(groupedTaskIdsByKey.get(recurringTriggeredChainGroupKey) ?? []),
        task.id,
      ]);
      continue;
    }

    if (!chainGroupId) {
      continue;
    }
    const chainGroupKey = `chain:${chainGroupId}`;
    taskGroupKeyByTaskId.set(task.id, chainGroupKey);
    groupedTaskIdsByKey.set(chainGroupKey, [
      ...(groupedTaskIdsByKey.get(chainGroupKey) ?? []),
      task.id,
    ]);
  }

  const groupedTaskIdsSet = new Set<string>();
  const groupedTaskOrder: KanbanTask[] = [];
  const resolvedGroupOrder = new Set<string>();
  const tasksById = new Map(columnTasks.map((task) => [task.id, task]));
  for (const task of columnTasks) {
    const groupKey = taskGroupKeyByTaskId.get(task.id);
    if (!groupKey || resolvedGroupOrder.has(groupKey)) {
      continue;
    }
    const groupTaskIds = groupedTaskIdsByKey.get(groupKey) ?? [];
    if (groupTaskIds.length < 2) {
      continue;
    }
    resolvedGroupOrder.add(groupKey);
    const groupTasks = groupTaskIds
      .map((taskId) => tasksById.get(taskId))
      .filter((entry): entry is KanbanTask => Boolean(entry));
    groupTasks.sort((a, b) => {
      const serialA = resolveTaskSerialOrder(allTasks, a);
      const serialB = resolveTaskSerialOrder(allTasks, b);
      if (serialA !== null && serialB !== null && serialA !== serialB) {
        return serialA - serialB;
      }
      if (serialA !== null && serialB === null) {
        return -1;
      }
      if (serialA === null && serialB !== null) {
        return 1;
      }
      return a.sortOrder - b.sortOrder;
    });
    for (const groupedTask of groupTasks) {
      groupedTaskIdsSet.add(groupedTask.id);
      groupedTaskOrder.push(groupedTask);
    }
  }

  const singleTasks = columnTasks.filter((task) => !groupedTaskIdsSet.has(task.id));
  return [...groupedTaskOrder, ...singleTasks];
}

type KanbanBoardProps = {
  workspace: WorkspaceInfo;
  workspaces: WorkspaceInfo[];
  panel: KanbanPanel;
  panels: KanbanPanel[];
  tasks: KanbanTask[];
  columns: KanbanColumnDef[];
  onBack: () => void;
  onCreateTask: (input: CreateTaskInput) => KanbanTask;
  onUpdateTask: (taskId: string, changes: Partial<KanbanTask>) => void;
  onDeleteTask: (taskId: string) => void;
  onReorderTask: (
    taskId: string,
    newStatus: KanbanTaskStatus,
    newSortOrder: number
  ) => void;
  onAppModeChange: (mode: AppMode) => void;
  engineStatuses: EngineStatus[];
  conversationNode: ReactNode | null;
  selectedTaskId: string | null;
  taskProcessingMap: Record<string, { isProcessing: boolean; startedAt: number | null }>;
  onSelectTask: (task: KanbanTask) => void;
  onCloseConversation: () => void;
  onDragToInProgress: (task: KanbanTask) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectPanel: (panelId: string) => void;
  kanbanConversationWidth?: number;
  onKanbanConversationResizeStart?: (event: MouseEvent<HTMLDivElement>) => void;
  gitPanelNode: ReactNode | null;
  terminalOpen?: boolean;
  onToggleTerminal?: () => void;
};

export function KanbanBoard({
  workspace,
  workspaces,
  panel,
  panels,
  tasks,
  columns,
  onBack,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onReorderTask,
  onAppModeChange,
  engineStatuses,
  conversationNode,
  selectedTaskId,
  taskProcessingMap,
  onSelectTask,
  onCloseConversation,
  onDragToInProgress,
  onSelectWorkspace,
  onSelectPanel,
  kanbanConversationWidth,
  onKanbanConversationResizeStart,
  gitPanelNode,
  terminalOpen = false,
  onToggleTerminal,
}: KanbanBoardProps) {
  const { t } = useTranslation();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createDefaultStatus, setCreateDefaultStatus] =
    useState<KanbanTaskStatus>("todo");
  const [editingTask, setEditingTask] = useState<KanbanTask | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [visibleTaskIdsByColumn, setVisibleTaskIdsByColumn] =
    useState<Partial<Record<KanbanTaskStatus, string[]>>>({});

  const handleToggleGitPanel = useCallback(() => {
    setShowGitPanel((prev) => !prev);
  }, []);

  const selectedTask = selectedTaskId
    ? tasks.find((t) => t.id === selectedTaskId) ?? null
    : null;
  const selectedTaskSchedule = selectedTask ? describeSchedule(selectedTask.schedule) : null;
  const selectedTaskBlockedReason = selectedTask
    ? formatKanbanBlockedReason(
        t,
        selectedTask.chain?.blockedReason ?? selectedTask.execution?.blockedReason ?? null,
      )
    : null;

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0) return tasks;
    return tasks.filter(
      (task) =>
        task.title.toLowerCase().includes(q) ||
        task.description.toLowerCase().includes(q)
    );
  }, [tasks, searchQuery]);

  const tasksByColumn = useMemo(() => {
    const map: Record<KanbanTaskStatus, KanbanTask[]> = {
      todo: [],
      inprogress: [],
      testing: [],
      done: [],
    };
    for (const task of filteredTasks) {
      if (map[task.status]) {
        map[task.status].push(task);
      }
    }
    for (const key of Object.keys(map) as KanbanTaskStatus[]) {
      map[key].sort((a, b) => a.sortOrder - b.sortOrder);
      map[key] = sortTasksForColumnDisplay(map[key], tasks);
    }
    return map;
  }, [filteredTasks, tasks]);

  const handleVisibleTaskIdsChange = useCallback(
    (columnId: KanbanTaskStatus, visibleTaskIds: string[]) => {
      setVisibleTaskIdsByColumn((prev) => {
        const previous = prev[columnId];
        if (
          previous &&
          previous.length === visibleTaskIds.length &&
          previous.every((taskId, idx) => taskId === visibleTaskIds[idx])
        ) {
          return prev;
        }
        return {
          ...prev,
          [columnId]: visibleTaskIds,
        };
      });
    },
    [],
  );

  const handleBulkMoveGroup = useCallback(
    (
      taskIds: string[],
      sourceStatus: KanbanTaskStatus,
      destinationStatus: KanbanTaskStatus,
    ) => {
      if (sourceStatus !== "testing" || destinationStatus !== "done" || taskIds.length === 0) {
        return;
      }

      const taskById = new Map(tasks.map((task) => [task.id, task]));
      const groupTasks = taskIds
        .map((taskId) => taskById.get(taskId))
        .filter(
          (task): task is KanbanTask =>
            typeof task !== "undefined" && task.status === sourceStatus,
        );
      if (groupTasks.length === 0) {
        return;
      }

      let nextSortOrder = tasksByColumn[destinationStatus].reduce(
        (max, task) => Math.max(max, task.sortOrder),
        0,
      );
      for (const task of groupTasks) {
        nextSortOrder += 1000;
        onReorderTask(task.id, destinationStatus, nextSortOrder);
      }
    },
    [onReorderTask, tasks, tasksByColumn],
  );

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { source, destination, draggableId } = result;
      if (!destination) return;
      if (
        source.droppableId === destination.droppableId &&
        source.index === destination.index
      ) {
        return;
      }

      const sourceStatus = source.droppableId as KanbanTaskStatus;
      const destStatus = destination.droppableId as KanbanTaskStatus;
      const draggedTask = tasks.find((task) => task.id === draggableId);
      if (!draggedTask) {
        return;
      }

      const chainGroupByTaskId = new Map<string, string>();
      for (const task of tasks) {
        if (!task.chain?.groupId) {
          continue;
        }
        chainGroupByTaskId.set(task.id, task.chain.groupId);
        if (task.chain.previousTaskId) {
          chainGroupByTaskId.set(task.chain.previousTaskId, task.chain.groupId);
        }
      }
      const resolveTaskGroupId = (taskId: string): string | null => {
        return chainGroupByTaskId.get(taskId) ?? null;
      };
      const draggedGroupId = resolveTaskGroupId(draggedTask.id);
      const isTaskInChain = Boolean(draggedGroupId);
      const isChainHead = isTaskInChain && !draggedTask.chain?.previousTaskId;

      const chainedDragBlockedReason =
        sourceStatus !== destStatus
          ? resolveChainedDragBlockedReason(draggedTask, sourceStatus, destStatus, {
              isTaskInChain,
            })
          : null;
      if (chainedDragBlockedReason) {
        onUpdateTask(draggedTask.id, {
          chain: {
            ...(draggedTask.chain ?? {
              groupId: resolveTaskGroupId(draggedTask.id) ?? draggedTask.id,
              previousTaskId: null,
            }),
            blockedReason: chainedDragBlockedReason,
          },
          execution: {
            ...(draggedTask.execution ?? {}),
            lastSource: "drag",
            blockedReason: chainedDragBlockedReason,
          },
        });
        return;
      }
      const tasksById = new Map(tasks.map((task) => [task.id, task]));
      const resolveVisibleTaskIds = (
        status: KanbanTaskStatus,
        options?: {
          excludeTaskId?: string;
        },
      ): string[] => {
        const columnTasks = tasksByColumn[status];
        const columnTaskIds = new Set(columnTasks.map((task) => task.id));
        const configuredTaskIds = visibleTaskIdsByColumn[status];
        const baseTaskIds =
          configuredTaskIds !== undefined
            ? configuredTaskIds.filter((taskId) => columnTaskIds.has(taskId))
            : columnTasks.map((task) => task.id);
        if (!options?.excludeTaskId) {
          return baseTaskIds;
        }
        return baseTaskIds.filter((taskId) => taskId !== options.excludeTaskId);
      };

      const visibleDestinationTaskIds = resolveVisibleTaskIds(destStatus, {
        excludeTaskId: sourceStatus === destStatus ? draggedTask.id : undefined,
      });
      const beforeTaskId =
        destination.index > 0 ? (visibleDestinationTaskIds[destination.index - 1] ?? null) : null;
      const afterTaskId =
        destination.index < visibleDestinationTaskIds.length
          ? (visibleDestinationTaskIds[destination.index] ?? null)
          : null;
      const beforeTask = beforeTaskId ? (tasksById.get(beforeTaskId) ?? null) : null;
      const afterTask = afterTaskId ? (tasksById.get(afterTaskId) ?? null) : null;
      const beforeGroupId = beforeTask ? resolveTaskGroupId(beforeTask.id) : null;
      const afterGroupId = afterTask ? resolveTaskGroupId(afterTask.id) : null;
      const slotGroupId =
        beforeGroupId && afterGroupId && beforeGroupId === afterGroupId
          ? beforeGroupId
          : null;
      if (slotGroupId && draggedGroupId !== slotGroupId) {
        onUpdateTask(draggedTask.id, {
          execution: {
            ...(draggedTask.execution ?? {}),
            lastSource: "drag",
            blockedReason: "drag_into_chain_group_blocked",
          },
        });
        return;
      }

      const destTasks = [...tasksByColumn[destStatus]];
      const existingDestinationIndex = destTasks.findIndex((task) => task.id === draggableId);
      if (existingDestinationIndex >= 0) {
        destTasks.splice(existingDestinationIndex, 1);
      }
      let destinationInsertIndex = destTasks.length;
      if (afterTaskId) {
        const afterIndex = destTasks.findIndex((task) => task.id === afterTaskId);
        if (afterIndex >= 0) {
          destinationInsertIndex = afterIndex;
        }
      } else if (beforeTaskId) {
        const beforeIndex = destTasks.findIndex((task) => task.id === beforeTaskId);
        if (beforeIndex >= 0) {
          destinationInsertIndex = beforeIndex + 1;
        }
      }
      destTasks.splice(destinationInsertIndex, 0, draggedTask);

      destTasks.forEach((task, idx) => {
        const newSortOrder = (idx + 1) * 1000;
        if (task.id === draggableId) {
          onReorderTask(task.id, destStatus, newSortOrder);
        } else if (task.sortOrder !== newSortOrder) {
          onReorderTask(task.id, task.status, newSortOrder);
        }
      });

      // Auto-execute when dragging to "inprogress" from another column
      if (destStatus === "inprogress" && sourceStatus !== "inprogress") {
        if (sourceStatus === "testing" && isChainHead && draggedGroupId) {
          const downstreamTasks = tasks
            .filter(
              (task) => task.id !== draggedTask.id && resolveTaskGroupId(task.id) === draggedGroupId,
            )
            .slice()
            .sort(
              (a, b) => chainPositionOfTask(tasks, a.id) - chainPositionOfTask(tasks, b.id),
            );
          const downstreamTaskIds = new Set(downstreamTasks.map((task) => task.id));
          const todoTasksExcludingDownstream = tasksByColumn.todo.filter(
            (task) => task.id !== draggedTask.id && !downstreamTaskIds.has(task.id),
          );
          const maxTodoSortOrder = todoTasksExcludingDownstream.reduce(
            (max, task) => Math.max(max, task.sortOrder),
            0,
          );
          let nextTodoSortOrder = maxTodoSortOrder + 1000;
          for (const downstreamTask of downstreamTasks) {
            if (downstreamTask.status !== "todo") {
              onReorderTask(downstreamTask.id, "todo", nextTodoSortOrder);
              nextTodoSortOrder += 1000;
            }
            onUpdateTask(downstreamTask.id, {
              chain: {
                ...(downstreamTask.chain ?? {
                  groupId: draggedGroupId,
                  previousTaskId: null,
                }),
                blockedReason: "chain_requires_head_trigger",
              },
              execution: {
                ...(downstreamTask.execution ?? {}),
                lastSource: "drag",
                blockedReason: "chain_requires_head_trigger",
                startedAt: null,
                finishedAt: null,
              },
            });
          }
        }
        onDragToInProgress(draggedTask);
      }
    },
    [tasksByColumn, tasks, onReorderTask, onDragToInProgress, onUpdateTask, visibleTaskIdsByColumn]
  );

  const handleOpenCreate = (status: KanbanTaskStatus = "todo") => {
    setEditingTask(null);
    setCreateDefaultStatus(status);
    setCreateModalOpen(true);
  };

  const handleCreateTask = (input: CreateTaskInput) => {
    onCreateTask(input);
    setCreateModalOpen(false);
  };

  const handleEditTask = useCallback((task: KanbanTask) => {
    setEditingTask(task);
    setCreateModalOpen(true);
  }, []);

  const handleUpdateTask = useCallback(
    (taskId: string, changes: Partial<KanbanTask>) => {
      onUpdateTask(taskId, changes);
      setEditingTask(null);
      setCreateModalOpen(false);
    },
    [onUpdateTask]
  );

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      if (taskId === selectedTaskId) {
        onCloseConversation();
      }
      onDeleteTask(taskId);
    },
    [selectedTaskId, onCloseConversation, onDeleteTask]
  );

  const handleCancelOrBlockTask = useCallback(
    (task: KanbanTask) => {
      const activeSchedule = task.schedule && task.schedule.mode !== "manual"
        ? task.schedule
        : null;
      const nextExecution = {
        ...(task.execution ?? {}),
        lastSource: "manual" as const,
        lock: null,
        blockedReason: activeSchedule ? "manual_cancelled" : "manual_blocked",
      };
      if (activeSchedule) {
        onUpdateTask(task.id, {
          schedule: {
            ...activeSchedule,
            mode: "manual",
            nextRunAt: null,
            overdue: false,
          },
          execution: nextExecution,
        });
        return;
      }
      onUpdateTask(task.id, {
        execution: nextExecution,
      });
    },
    [onUpdateTask],
  );

  const handleToggleSchedulePausedTask = useCallback(
    (task: KanbanTask) => {
      const schedule = task.schedule;
      if (!schedule || schedule.mode === "manual") {
        return;
      }
      const now = Date.now();
      if (schedule.paused) {
        const resumeRemainingMs = Math.max(
          0,
          schedule.pausedRemainingMs ??
            (typeof schedule.nextRunAt === "number" ? schedule.nextRunAt - now : 0),
        );
        const resumedNextRunAt = now + resumeRemainingMs;
        onUpdateTask(task.id, {
          schedule: {
            ...schedule,
            paused: false,
            pausedRemainingMs: null,
            overdue: false,
            nextRunAt: resumedNextRunAt,
          },
          execution: {
            ...(task.execution ?? {}),
            blockedReason: null,
          },
        });
        return;
      }

      const pauseRemainingMs =
        typeof schedule.nextRunAt === "number"
          ? Math.max(0, schedule.nextRunAt - now)
          : 0;
      onUpdateTask(task.id, {
        schedule: {
          ...schedule,
          paused: true,
          pausedRemainingMs: pauseRemainingMs,
        },
        execution: {
          ...(task.execution ?? {}),
          blockedReason: null,
        },
      });
    },
    [onUpdateTask],
  );

  return (
    <div className="kanban-board flex flex-col h-full overflow-hidden bg-[color:var(--bg-primary,#fff)]">
      <KanbanBoardHeader
        workspace={workspace}
        workspaces={workspaces}
        panel={panel}
        panels={panels}
        onBack={onBack}
        onAppModeChange={onAppModeChange}
        onSelectWorkspace={onSelectWorkspace}
        onSelectPanel={onSelectPanel}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showGitPanel={showGitPanel}
        onToggleGitPanel={handleToggleGitPanel}
      />
      <div className="kanban-board-body flex flex-1 overflow-hidden">
        <div className="kanban-board-columns-area flex-1 overflow-x-auto min-w-0">
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="kanban-columns flex gap-0 flex-1 overflow-x-auto h-full">
              {columns.map((col) => (
                <KanbanColumn
                  key={col.id}
                  column={col}
                  tasks={tasksByColumn[col.id]}
                  allTasks={tasks}
                  selectedTaskId={selectedTaskId}
                  taskProcessingMap={taskProcessingMap}
                  onAddTask={() => handleOpenCreate(col.id)}
                  onDeleteTask={handleDeleteTask}
                  onToggleSchedulePausedTask={handleToggleSchedulePausedTask}
                  onCancelOrBlockTask={handleCancelOrBlockTask}
                  onSelectTask={onSelectTask}
                  onEditTask={col.id === "todo" ? handleEditTask : undefined}
                  onVisibleTaskIdsChange={handleVisibleTaskIdsChange}
                  onBulkMoveGroup={handleBulkMoveGroup}
                />
              ))}
            </div>
          </DragDropContext>
        </div>

        {selectedTask && conversationNode && (
          <div
            className="kanban-conversation-panel min-w-[340px] max-w-[800px] border-l border-[color:var(--border-color,#e5e5e5)] flex flex-col bg-[color:var(--bg-primary,#fff)] overflow-hidden relative"
            style={{ width: kanbanConversationWidth ? `${kanbanConversationWidth}px` : undefined }}
          >
            {onKanbanConversationResizeStart && (
              <div
                className="kanban-conversation-resizer absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 bg-transparent transition-[background] duration-150 hover:bg-[color:var(--accent-primary,var(--surface-hover))] active:bg-[color:var(--accent-primary,var(--surface-active))]"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize conversation panel"
                onMouseDown={onKanbanConversationResizeStart}
              />
            )}
            <div className="kanban-conversation-header flex items-center justify-between px-4 py-2.5 border-b border-[color:var(--border-color,#e5e5e5)] gap-2 shrink-0">
              <div className="kanban-conversation-header-main flex-1 min-w-0 flex flex-col gap-1.5">
                <span className="kanban-conversation-title text-sm font-semibold text-[color:var(--text-primary,#111)] overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">
                  {selectedTask.title}
                </span>
                {(selectedTaskSchedule || selectedTask.chain?.previousTaskId || selectedTaskBlockedReason) && (
                  <div className="kanban-conversation-meta-row flex flex-wrap gap-1.5">
                    {selectedTaskSchedule === "once" && (
                      <span className="kanban-conversation-meta-badge inline-flex items-center rounded-full border border-[color:var(--border-color,#dbe3ee)] bg-[color:var(--bg-secondary,#eef2f7)] text-[color:var(--text-secondary,#4b5563)] px-2 py-px text-[10px] leading-[1.5] max-w-[220px] whitespace-nowrap overflow-hidden text-ellipsis">
                        {t("kanban.task.schedule.onceBadge")}
                      </span>
                    )}
                    {selectedTaskSchedule === "recurring" && (
                      <span className="kanban-conversation-meta-badge inline-flex items-center rounded-full border border-[color:var(--border-color,#dbe3ee)] bg-[color:var(--bg-secondary,#eef2f7)] text-[color:var(--text-secondary,#4b5563)] px-2 py-px text-[10px] leading-[1.5] max-w-[220px] whitespace-nowrap overflow-hidden text-ellipsis">
                        {t("kanban.task.schedule.recurringBadge")}
                      </span>
                    )}
                    {selectedTaskSchedule === "once_overdue" && (
                      <span className="kanban-conversation-meta-badge kanban-conversation-meta-badge-warn inline-flex items-center rounded-full border border-[#fcd34d] bg-[#fffbeb] text-[#92400e] px-2 py-px text-[10px] leading-[1.5] max-w-[220px] whitespace-nowrap overflow-hidden text-ellipsis">
                        {t("kanban.task.schedule.onceOverdueBadge")}
                      </span>
                    )}
                    {selectedTask.chain?.previousTaskId && (
                      <span className="kanban-conversation-meta-badge inline-flex items-center rounded-full border border-[color:var(--border-color,#dbe3ee)] bg-[color:var(--bg-secondary,#eef2f7)] text-[color:var(--text-secondary,#4b5563)] px-2 py-px text-[10px] leading-[1.5] max-w-[220px] whitespace-nowrap overflow-hidden text-ellipsis">
                        {t("kanban.task.chain.badge")}
                      </span>
                    )}
                    {selectedTaskBlockedReason && (
                      <span className="kanban-conversation-meta-badge kanban-conversation-meta-badge-warn inline-flex items-center rounded-full border border-[#fcd34d] bg-[#fffbeb] text-[#92400e] px-2 py-px text-[10px] leading-[1.5] max-w-[220px] whitespace-nowrap overflow-hidden text-ellipsis">
                        {t("kanban.task.blocked", { reason: selectedTaskBlockedReason })}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <button
                className="kanban-icon-btn flex items-center justify-center w-7 h-7 p-0 border-none bg-transparent rounded-[6px] cursor-pointer text-[color:var(--text-secondary,#666)] transition-[background,color] duration-150 hover:bg-[color:var(--bg-tertiary,#f0f0f0)] hover:text-[color:var(--text-primary,#111)]"
                onClick={onCloseConversation}
                aria-label={t("kanban.conversation.close")}
              >
                <X size={16} />
              </button>
            </div>
            <div className="kanban-conversation-body flex-1 flex flex-col overflow-hidden">
              {conversationNode}
            </div>
          </div>
        )}

        {showGitPanel && gitPanelNode && (
          <div className="kanban-git-panel min-w-[300px] max-w-[420px] w-[360px] border-l border-[color:var(--border-color,#e5e5e5)] flex flex-col bg-[color:var(--bg-primary,#fff)] overflow-hidden relative shrink-0 [&>*]:h-full [&>*]:border-none">
            {gitPanelNode}
          </div>
        )}
      </div>

      {onToggleTerminal && (
        <div className="kanban-terminal-bar flex items-center justify-end px-4 py-1.5 border-t border-[color:var(--border-color,#e5e5e5)] shrink-0">
          <button
            className={`kanban-terminal-btn inline-flex items-center gap-1.5 px-2.5 py-1 border-none bg-transparent rounded-[6px] cursor-pointer text-[color:var(--text-tertiary,#999)] text-xs font-medium transition-[background,color] duration-150 hover:bg-[color:var(--bg-tertiary,#f0f0f0)] hover:text-[color:var(--text-secondary,#666)]${terminalOpen ? " is-active text-[color:var(--accent-color,#3b82f6)]" : ""}`}
            type="button"
            onClick={onToggleTerminal}
            aria-label={t("common.terminal")}
          >
            <Terminal size={14} aria-hidden />
            <span>{t("common.terminal")}</span>
          </button>
        </div>
      )}

      <TaskCreateModal
        isOpen={createModalOpen}
        workspaceId={workspace.path}
        workspaceBackendId={workspace.id}
        panelId={panel.id}
        defaultStatus={createDefaultStatus}
        engineStatuses={engineStatuses}
        onSubmit={handleCreateTask}
        onCancel={() => {
          setCreateModalOpen(false);
          setEditingTask(null);
        }}
        availableTasks={tasks}
        editingTask={editingTask ?? undefined}
        onUpdate={handleUpdateTask}
      />
    </div>
  );
}
