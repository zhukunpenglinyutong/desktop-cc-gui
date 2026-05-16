import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import { Droppable } from "@hello-pangea/dnd";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import Plus from "lucide-react/dist/esm/icons/plus";
import type { KanbanColumnDef, KanbanTask, KanbanTaskStatus } from "../types";
import { KanbanCard } from "./KanbanCard";

type KanbanColumnProps = {
  column: KanbanColumnDef;
  tasks: KanbanTask[];
  allTasks: KanbanTask[];
  selectedTaskId: string | null;
  taskProcessingMap: Record<string, { isProcessing: boolean; startedAt: number | null }>;
  onAddTask: () => void;
  onDeleteTask: (taskId: string) => void;
  onToggleSchedulePausedTask: (task: KanbanTask) => void;
  onCancelOrBlockTask: (task: KanbanTask) => void;
  onSelectTask: (task: KanbanTask) => void;
  onEditTask?: (task: KanbanTask) => void;
  onVisibleTaskIdsChange?: (columnId: KanbanTaskStatus, taskIds: string[]) => void;
  onBulkMoveGroup?: (
    taskIds: string[],
    sourceColumnId: KanbanTaskStatus,
    destinationColumnId: KanbanTaskStatus,
  ) => void;
};

type TaskGroupKind = "recurring" | "chain";

type TaskGroupMeta = {
  key: string;
  kind: TaskGroupKind;
  groupId: string | null;
  groupCode: string | null;
  groupBadgeStyle: CSSProperties;
  count: number;
};

type TaskGroupRef = {
  key: string;
  kind: TaskGroupKind;
};

type TaskRenderBlock =
  | { type: "single"; task: KanbanTask }
  | { type: "group"; meta: TaskGroupMeta; tasks: KanbanTask[] };

type RecurringGroupDescriptor = {
  signature: string;
  seriesId: string | null;
};

const GROUP_VISIBLE_TASKS_INITIAL_LIMIT = 30;
const GROUP_VISIBLE_TASKS_STEP = 30;

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

function resolveRecurringGroupKey(descriptor: RecurringGroupDescriptor): string {
  return descriptor.seriesId
    ? `recurring:${descriptor.seriesId}`
    : `recurring:sig:${descriptor.signature}`;
}

function resolveChainGroupCode(allTasks: KanbanTask[], groupId: string): string {
  const existingCode = allTasks.find(
    (task) => task.chain?.groupId === groupId && /^\d{3}$/.test(task.chain?.groupCode ?? ""),
  )?.chain?.groupCode;
  if (existingCode) {
    return existingCode;
  }

  // Stable fallback for legacy data without groupCode.
  let hash = 0;
  for (const ch of groupId) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return `${(hash % 900) + 100}`;
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

function resolveGroupBadgeStyle(seed: string): CSSProperties {
  const hue = hashGroupSeed(seed) % 360;
  return {
    ["--kanban-group-code-bg" as string]: `hsla(${hue}, 90%, 62%, 0.16)`,
    ["--kanban-group-code-border" as string]: `hsla(${hue}, 78%, 56%, 0.62)`,
    ["--kanban-group-code-text" as string]: `hsl(${hue}, 68%, 44%)`,
  };
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

function resolveTaskUpstreamRecurringGroup(
  allTasks: KanbanTask[],
  task: KanbanTask,
): { groupCode: string; groupBadgeStyle: CSSProperties } | null {
  const previousTaskId = task.chain?.previousTaskId;
  if (!previousTaskId) {
    return null;
  }
  const upstreamTask = allTasks.find((entry) => entry.id === previousTaskId);
  if (!upstreamTask) {
    return null;
  }
  const recurringDescriptor = resolveRecurringGroupDescriptor(upstreamTask);
  if (!recurringDescriptor) {
    return null;
  }
  const recurringGroupKey = recurringDescriptor.seriesId
    ? `recurring:${recurringDescriptor.seriesId}`
    : `recurring:sig:${recurringDescriptor.signature}`;
  return {
    groupCode: resolveRecurringGroupCode(recurringGroupKey),
    groupBadgeStyle: resolveGroupBadgeStyle(recurringGroupKey),
  };
}

function resolveTaskChainGroupId(
  allTasks: KanbanTask[],
  task: KanbanTask,
  chainGroupByTaskId?: Map<string, string>,
): string | null {
  if (task.chain?.groupId) {
    return task.chain.groupId;
  }
  if (chainGroupByTaskId) {
    return chainGroupByTaskId.get(task.id) ?? null;
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

function resolveTaskSerialOrder(
  tasks: KanbanTask[],
  task: KanbanTask,
  chainPositionByTaskId?: Map<string, number>,
  chainGroupByTaskId?: Map<string, string>,
): number | null {
  const chainGroupId = resolveTaskChainGroupId(tasks, task, chainGroupByTaskId);
  if (chainGroupId) {
    return chainPositionByTaskId?.get(task.id) ?? 1;
  }
  return resolveRecurringRunIndex(task);
}

export function KanbanColumn({
  column,
  tasks,
  allTasks,
  selectedTaskId,
  taskProcessingMap,
  onAddTask,
  onDeleteTask,
  onToggleSchedulePausedTask,
  onCancelOrBlockTask,
  onSelectTask,
  onEditTask,
  onVisibleTaskIdsChange,
  onBulkMoveGroup,
}: KanbanColumnProps) {
  const { t } = useTranslation();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [groupVisibleTaskLimits, setGroupVisibleTaskLimits] = useState<
    Record<string, number>
  >({});
  const [bulkConfirmState, setBulkConfirmState] = useState<{
    taskIds: string[];
    sourceStatus: KanbanTaskStatus;
    destinationStatus: KanbanTaskStatus;
    count: number;
  } | null>(null);

  const chainGroupByTaskId = useMemo(() => {
    const chainGroupMap = new Map<string, string>();
    for (const task of allTasks) {
      if (!task.chain?.groupId) {
        continue;
      }
      chainGroupMap.set(task.id, task.chain.groupId);
      if (task.chain.previousTaskId) {
        chainGroupMap.set(task.chain.previousTaskId, task.chain.groupId);
      }
    }
    return chainGroupMap;
  }, [allTasks]);

  const chainPositionByTaskId = useMemo(() => {
    const tasksById = new Map(allTasks.map((task) => [task.id, task]));
    const chainPositionMap = new Map<string, number>();
    const resolvingTaskIds = new Set<string>();

    const resolveChainPosition = (taskId: string): number => {
      const cached = chainPositionMap.get(taskId);
      if (typeof cached === "number") {
        return cached;
      }

      if (resolvingTaskIds.has(taskId)) {
        return 1;
      }
      resolvingTaskIds.add(taskId);
      const currentTask = tasksById.get(taskId);
      const previousId = currentTask?.chain?.previousTaskId;
      const position =
        previousId && previousId !== taskId
          ? resolveChainPosition(previousId) + 1
          : 1;
      resolvingTaskIds.delete(taskId);
      chainPositionMap.set(taskId, position);
      return position;
    };

    for (const task of allTasks) {
      if (task.chain?.groupId || task.chain?.previousTaskId || chainGroupByTaskId.has(task.id)) {
        resolveChainPosition(task.id);
      }
    }
    return chainPositionMap;
  }, [allTasks, chainGroupByTaskId]);

  const resolveVisibleGroupTaskCount = useCallback(
    (groupKey: string, totalTaskCount: number, isCollapsed: boolean): number => {
      if (isCollapsed) {
        return 0;
      }
      const configuredLimit = groupVisibleTaskLimits[groupKey];
      const visibleLimit =
        typeof configuredLimit === "number" && Number.isFinite(configuredLimit)
          ? Math.max(1, configuredLimit)
          : GROUP_VISIBLE_TASKS_INITIAL_LIMIT;
      return Math.min(totalTaskCount, visibleLimit);
    },
    [groupVisibleTaskLimits],
  );

  const handleToggleGroup = useCallback((groupKey: string, defaultCollapsed: boolean) => {
    setCollapsedGroups((prev) => {
      const nextCollapsed = !(prev[groupKey] ?? defaultCollapsed);
      if (!nextCollapsed) {
        setGroupVisibleTaskLimits((prevLimits) => {
          const existing = prevLimits[groupKey];
          if (typeof existing === "number" && existing > 0) {
            return prevLimits;
          }
          return {
            ...prevLimits,
            [groupKey]: GROUP_VISIBLE_TASKS_INITIAL_LIMIT,
          };
        });
      }
      return {
        ...prev,
        [groupKey]: nextCollapsed,
      };
    });
  }, []);

  const handleLoadMoreGroupTasks = useCallback((groupKey: string, totalTaskCount: number) => {
    setGroupVisibleTaskLimits((prev) => {
      const current =
        typeof prev[groupKey] === "number"
          ? prev[groupKey]
          : GROUP_VISIBLE_TASKS_INITIAL_LIMIT;
      const next = Math.min(totalTaskCount, current + GROUP_VISIBLE_TASKS_STEP);
      if (next === current) {
        return prev;
      }
      return {
        ...prev,
        [groupKey]: next,
      };
    });
  }, []);

  const renderBlocks = useMemo<TaskRenderBlock[]>(() => {
    const taskGroupByTaskId = new Map<string, TaskGroupRef>();
    const groupedTaskIdsByKey = new Map<string, string[]>();
    const groupedKindByKey = new Map<string, TaskGroupKind>();
    const allTasksById = new Map(allTasks.map((task) => [task.id, task]));
    const chainGroupTaskCountById = new Map<string, number>();
    for (const task of tasks) {
      const chainGroupId = task.chain?.groupId ?? chainGroupByTaskId.get(task.id);
      if (!chainGroupId) {
        continue;
      }
      chainGroupTaskCountById.set(
        chainGroupId,
        (chainGroupTaskCountById.get(chainGroupId) ?? 0) + 1,
      );
    }

    const recurringDescriptors = new Map<string, RecurringGroupDescriptor>();
    const recurringSeriesBySignature = new Map<string, Set<string>>();
    for (const task of tasks) {
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

    for (const task of tasks) {
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
        taskGroupByTaskId.set(task.id, { key: recurringGroupKey, kind: "recurring" });
        groupedKindByKey.set(recurringGroupKey, "recurring");
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
        taskGroupByTaskId.set(task.id, { key: chainGroupKey, kind: "chain" });
        groupedKindByKey.set(chainGroupKey, "chain");
        groupedTaskIdsByKey.set(chainGroupKey, [
          ...(groupedTaskIdsByKey.get(chainGroupKey) ?? []),
          task.id,
        ]);
        continue;
      }

      const chainOrderIndex = chainPositionByTaskId.get(task.id) ?? null;
      const upstreamRecurringGroupCode = resolveUpstreamRecurringGroupCode(allTasksById, task);
      if (
        upstreamRecurringGroupCode &&
        typeof chainOrderIndex === "number" &&
        Number.isFinite(chainOrderIndex) &&
        chainOrderIndex > 1
      ) {
        const recurringTriggeredChainGroupKey =
          `chain-upstream-scheduler:${upstreamRecurringGroupCode}:step:${Math.floor(chainOrderIndex)}`;
        taskGroupByTaskId.set(task.id, { key: recurringTriggeredChainGroupKey, kind: "chain" });
        groupedKindByKey.set(recurringTriggeredChainGroupKey, "chain");
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
      taskGroupByTaskId.set(task.id, { key: chainGroupKey, kind: "chain" });
      groupedKindByKey.set(chainGroupKey, "chain");
      groupedTaskIdsByKey.set(chainGroupKey, [
        ...(groupedTaskIdsByKey.get(chainGroupKey) ?? []),
        task.id,
      ]);
    }

    const groupMetaByKey = new Map<string, TaskGroupMeta>();
    for (const [groupKey, taskIds] of groupedTaskIdsByKey.entries()) {
      if (taskIds.length < 2) {
        continue;
      }
      const kind = groupedKindByKey.get(groupKey) ?? "chain";
      const isConcreteChainGroup = kind === "chain" && groupKey.startsWith("chain:");
      const concreteChainGroupId = isConcreteChainGroup
        ? groupKey.replace(/^chain:/, "")
        : null;
      groupMetaByKey.set(groupKey, {
        key: groupKey,
        kind,
        groupId: concreteChainGroupId,
        groupCode:
          kind === "chain"
            ? concreteChainGroupId
              ? resolveChainGroupCode(allTasks, concreteChainGroupId)
              : resolveRecurringGroupCode(groupKey)
            : resolveRecurringGroupCode(groupKey),
        groupBadgeStyle: resolveGroupBadgeStyle(groupKey),
        count: taskIds.length,
      });
    }

    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const groupedTasksByKey = new Map<string, KanbanTask[]>();
    for (const [groupKey, taskIds] of groupedTaskIdsByKey.entries()) {
      const groupedTasks = taskIds
        .map((taskId) => tasksById.get(taskId))
        .filter((task): task is KanbanTask => Boolean(task));
      groupedTasksByKey.set(groupKey, groupedTasks);
    }

    const consumedTaskIds = new Set<string>();
    const blocks: TaskRenderBlock[] = [];
    for (const task of tasks) {
      if (consumedTaskIds.has(task.id)) {
        continue;
      }
      const groupRef = taskGroupByTaskId.get(task.id);
      const groupMeta = groupRef ? groupMetaByKey.get(groupRef.key) : undefined;
      if (!groupMeta) {
        consumedTaskIds.add(task.id);
        blocks.push({ type: "single", task });
        continue;
      }

      const groupTasks = (groupedTasksByKey.get(groupMeta.key) ?? []).slice();
      groupTasks.sort((a, b) => {
        const serialA = resolveTaskSerialOrder(
          allTasks,
          a,
          chainPositionByTaskId,
          chainGroupByTaskId,
        );
        const serialB = resolveTaskSerialOrder(
          allTasks,
          b,
          chainPositionByTaskId,
          chainGroupByTaskId,
        );
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
        consumedTaskIds.add(groupedTask.id);
      }
      blocks.push({ type: "group", meta: groupMeta, tasks: groupTasks });
    }
    const groupedBlocks = blocks.filter(
      (block): block is Extract<TaskRenderBlock, { type: "group" }> =>
        block.type === "group",
    );
    const singleBlocks = blocks.filter(
      (block): block is Extract<TaskRenderBlock, { type: "single" }> =>
        block.type === "single",
    );
    return [...groupedBlocks, ...singleBlocks];
  }, [tasks, allTasks, chainGroupByTaskId, chainPositionByTaskId]);

  const visibleTaskIds = useMemo(() => {
    const ids: string[] = [];
    for (const block of renderBlocks) {
      if (block.type === "single") {
        ids.push(block.task.id);
        continue;
      }
      const defaultCollapsed = column.id === "testing" || column.id === "done";
      const isCollapsed = collapsedGroups[block.meta.key] ?? defaultCollapsed;
      if (!isCollapsed) {
        const visibleGroupTaskCount = resolveVisibleGroupTaskCount(
          block.meta.key,
          block.tasks.length,
          isCollapsed,
        );
        for (const task of block.tasks.slice(0, visibleGroupTaskCount)) {
          ids.push(task.id);
        }
      }
    }
    return ids;
  }, [column.id, collapsedGroups, renderBlocks, resolveVisibleGroupTaskCount]);

  useEffect(() => {
    if (!onVisibleTaskIdsChange) {
      return;
    }
    onVisibleTaskIdsChange(column.id, visibleTaskIds);
  }, [column.id, onVisibleTaskIdsChange, visibleTaskIds]);

  return (
    <div className="kanban-column flex-1 min-w-[240px] flex flex-col border-r border-[color:var(--border-color,#e8e8e8)] bg-[color:var(--bg-primary,#fff)] last:border-r-0">
      <div className="kanban-column-header flex items-center justify-between px-5 pt-3 pb-2.5 border-b border-[color:var(--border-color,#e8e8e8)]">
        <div className="kanban-column-header-left flex items-center gap-2.5">
          <span
            className="kanban-column-dot w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: column.color }}
          />
          <span className="kanban-column-name text-sm font-semibold text-[color:var(--text-primary,#1a1a1a)]">{t(column.labelKey)}</span>
          {tasks.length > 0 && (
            <span className="kanban-column-count text-[13px] font-normal text-[color:var(--text-tertiary,#999)] -ml-0.5">{tasks.length}</span>
          )}
        </div>
        {column.id === "todo" && (
          <button
            type="button"
            className="kanban-column-add-btn w-[22px] h-[22px] min-w-[22px] min-h-[22px] p-0 rounded-full border border-[color-mix(in_srgb,var(--accent-color,#3b82f6)_38%,transparent)] bg-[color-mix(in_srgb,var(--accent-color,#3b82f6)_9%,var(--bg-primary,#fff))] text-[color:var(--accent-color,#3b82f6)] inline-flex items-center justify-center cursor-pointer leading-none transition-[border-color,background,color,box-shadow] duration-150 hover:border-[color-mix(in_srgb,var(--accent-color,#3b82f6)_62%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent-color,#3b82f6)_14%,var(--bg-primary,#fff))] active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color-mix(in_srgb,var(--accent-color,#3b82f6)_42%,transparent)] focus-visible:outline-offset-2"
            onClick={onAddTask}
            aria-label={t("kanban.board.addTask")}
            title={t("kanban.board.addTask")}
          >
            <Plus size={13} strokeWidth={2.5} />
          </button>
        )}
      </div>
      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            className={`kanban-column-body flex-1 overflow-y-auto p-0 min-h-[60px] transition-[background] duration-150${snapshot.isDraggingOver ? " is-dragging-over bg-[color:var(--surface-hover,#212127)]" : ""}`}
            ref={provided.innerRef}
            {...provided.droppableProps}
          >
            {(() => {
              let draggableIndex = 0;
              return renderBlocks.map((block) => {
                if (block.type === "single") {
                  const task = block.task;
                  const chainGroupId = resolveTaskChainGroupId(allTasks, task, chainGroupByTaskId);
                  const chainGroupCode =
                    chainGroupId ? resolveChainGroupCode(allTasks, chainGroupId) : null;
                  const chainGroupBadgeStyle = chainGroupId
                    ? resolveGroupBadgeStyle(`chain:${chainGroupId}`)
                    : undefined;
                  const recurringDescriptor = resolveRecurringGroupDescriptor(task);
                  const recurringGroupKey = recurringDescriptor
                    ? recurringDescriptor.seriesId
                      ? `recurring:${recurringDescriptor.seriesId}`
                      : `recurring:sig:${recurringDescriptor.signature}`
                    : null;
                  const recurringGroupCode = recurringGroupKey
                    ? resolveRecurringGroupCode(recurringGroupKey)
                    : null;
                  const recurringGroupBadgeStyle = recurringGroupKey
                    ? resolveGroupBadgeStyle(recurringGroupKey)
                    : undefined;
                  const upstreamRecurringGroup = resolveTaskUpstreamRecurringGroup(allTasks, task);
                  const displayGroupCode =
                    recurringGroupCode ??
                    upstreamRecurringGroup?.groupCode ??
                    chainGroupCode;
                  const displayGroupCodePrefix =
                    recurringGroupCode || upstreamRecurringGroup ? "$" : "#";
                  const displayGroupBadgeStyle =
                    recurringGroupBadgeStyle ??
                    upstreamRecurringGroup?.groupBadgeStyle ??
                    chainGroupBadgeStyle;
                  const chainOrderIndex = chainGroupId
                    ? (chainPositionByTaskId.get(task.id) ?? 1)
                    : null;
                  const card = (
                    <KanbanCard
                      task={task}
                      index={draggableIndex}
                      chainGroupCode={displayGroupCode}
                      chainGroupCodePrefix={displayGroupCodePrefix}
                      chainGroupBadgeStyle={displayGroupBadgeStyle}
                      chainOrderIndex={chainOrderIndex}
                      isSelected={task.id === selectedTaskId}
                      isProcessing={taskProcessingMap[task.id]?.isProcessing ?? false}
                      processingStartedAt={taskProcessingMap[task.id]?.startedAt ?? null}
                      onSelect={() => onSelectTask(task)}
                      onDelete={() => onDeleteTask(task.id)}
                      onToggleSchedulePaused={() => onToggleSchedulePausedTask(task)}
                      onCancelOrBlock={() => onCancelOrBlockTask(task)}
                      onEdit={onEditTask ? () => onEditTask(task) : undefined}
                    />
                  );
                  draggableIndex += 1;
                  return <Fragment key={task.id}>{card}</Fragment>;
                }

                const { meta, tasks: groupedTasks } = block;
                const defaultCollapsed = column.id === "testing" || column.id === "done";
                const isCollapsed = collapsedGroups[meta.key] ?? defaultCollapsed;
                const visibleGroupTaskCount = resolveVisibleGroupTaskCount(
                  meta.key,
                  groupedTasks.length,
                  isCollapsed,
                );
                const visibleGroupedTasks = groupedTasks.slice(0, visibleGroupTaskCount);
                const hiddenGroupTaskCount = Math.max(0, groupedTasks.length - visibleGroupedTasks.length);
                const groupLabel =
                  meta.kind === "recurring"
                    ? t("kanban.task.group.recurring")
                    : t("kanban.task.group.chain");
                const groupTaskIds = groupedTasks.map((entry) => entry.id);
                const canBulkCompleteGroup = column.id === "testing" && groupTaskIds.length > 0;

                return (
                  <div
                    key={meta.key}
                    className={`kanban-task-group-panel border border-[color:var(--border-color,#dbe3ee)] rounded-none mb-0 mb-[10px] bg-[color:var(--surface-card,var(--bg-primary,#fff))] overflow-visible${meta.kind === "chain" ? " is-chain border-[#93c5fd] shadow-[inset_0_0_0_1px_rgba(59,130,246,0.12)]" : " is-recurring"}${isCollapsed ? " is-collapsed" : ""}`}
                  >
                    <div className="kanban-task-group-header border-b border-[color:var(--border-color,#e2e8f0)] bg-[color:var(--bg-primary,#fff)] text-[color:var(--text-muted,var(--text-secondary,#334155))] flex items-center gap-1.5 px-2 py-1.5 m-0">
                      <button
                        type="button"
                        className="kanban-task-group-toggle-btn min-w-0 flex-1 border-0 bg-transparent text-inherit rounded-none flex items-center gap-1.5 p-0 m-0 text-xs cursor-pointer text-left"
                        onClick={() => handleToggleGroup(meta.key, defaultCollapsed)}
                        aria-expanded={!isCollapsed}
                      >
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        <span className="kanban-task-group-title font-semibold">{groupLabel}</span>
                        {meta.groupCode && (
                          <span className="kanban-task-group-code text-[11px] px-1.5 py-px border border-[color:var(--kanban-group-code-border,#bfdbfe)] bg-[color:var(--kanban-group-code-bg,#eff6ff)] text-[color:var(--kanban-group-code-text,#1d4ed8)] rounded" style={meta.groupBadgeStyle}>
                            {meta.kind === "chain" ? `#${meta.groupCode}` : `$${meta.groupCode}`}
                          </span>
                        )}
                      </button>
                      {canBulkCompleteGroup && (
                        <button
                          type="button"
                          className="kanban-task-group-action-btn border border-[color:var(--border-color,#cbd5e1)] bg-[color:var(--bg-primary,#fff)] text-[color:var(--text-secondary,#475569)] rounded-[5px] w-5 h-5 inline-flex items-center justify-center p-0 cursor-pointer hover:border-[color:var(--border-hover,#94a3b8)] hover:text-[color:var(--text-primary,#1e293b)] hover:bg-[color:var(--bg-hover,#f8fafc)] active:translate-y-px"
                          aria-label={t("kanban.task.group.bulkComplete")}
                          title={t("kanban.task.group.bulkComplete")}
                          onClick={(event) => {
                            event.stopPropagation();
                            setBulkConfirmState({
                              taskIds: groupTaskIds,
                              sourceStatus: column.id,
                              destinationStatus: "done",
                              count: groupTaskIds.length,
                            });
                          }}
                        >
                          <Check size={13} />
                        </button>
                      )}
                      <span className="kanban-task-group-count ml-auto text-[11px] text-[color:var(--text-subtle,var(--text-tertiary,#64748b))]">
                        {t("kanban.task.group.count", { count: meta.count })}
                      </span>
                    </div>
                    {!isCollapsed && visibleGroupedTasks.map((task) => {
                      const taskChainGroupId = resolveTaskChainGroupId(
                        allTasks,
                        task,
                        chainGroupByTaskId,
                      );
                      const chainOrderIndex = taskChainGroupId
                        ? (chainPositionByTaskId.get(task.id) ?? 1)
                        : null;
                      const upstreamRecurringGroup = resolveTaskUpstreamRecurringGroup(allTasks, task);
                      const displayGroupCode =
                        upstreamRecurringGroup?.groupCode ??
                        meta.groupCode;
                      const displayGroupCodePrefix =
                        upstreamRecurringGroup || meta.kind === "recurring" ? "$" : "#";
                      const displayGroupBadgeStyle =
                        upstreamRecurringGroup?.groupBadgeStyle ??
                        meta.groupBadgeStyle;
                      const card = (
                        <KanbanCard
                          key={task.id}
                          task={task}
                          index={draggableIndex}
                          chainGroupCode={displayGroupCode}
                          chainGroupCodePrefix={displayGroupCodePrefix}
                          chainGroupBadgeStyle={displayGroupBadgeStyle}
                          chainOrderIndex={chainOrderIndex}
                          isSelected={task.id === selectedTaskId}
                          isProcessing={taskProcessingMap[task.id]?.isProcessing ?? false}
                          processingStartedAt={taskProcessingMap[task.id]?.startedAt ?? null}
                          onSelect={() => onSelectTask(task)}
                          onDelete={() => onDeleteTask(task.id)}
                          onToggleSchedulePaused={() => onToggleSchedulePausedTask(task)}
                          onCancelOrBlock={() => onCancelOrBlockTask(task)}
                          onEdit={onEditTask ? () => onEditTask(task) : undefined}
                        />
                      );
                      draggableIndex += 1;
                      return card;
                    })}
                    {!isCollapsed && hiddenGroupTaskCount > 0 && (
                      <div className="kanban-task-group-footer flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-2 border-t border-dashed border-[color:var(--border-color,#dbe3ee)]">
                        <button
                          type="button"
                          className="kanban-task-group-load-more border border-[color:var(--border-color,#dbe3ee)] bg-transparent text-[color:var(--text-secondary,#4b5563)] rounded-[6px] text-[11px] font-semibold leading-[1.2] px-2 py-0.5 cursor-pointer hover:bg-[color:var(--bg-hover,#f8fafc)] hover:border-[color:var(--border-hover,#cbd5e1)]"
                          onClick={() => handleLoadMoreGroupTasks(meta.key, groupedTasks.length)}
                        >
                          {t("kanban.task.group.loadMore", {
                            count: Math.min(GROUP_VISIBLE_TASKS_STEP, hiddenGroupTaskCount),
                          })}
                        </button>
                        <span className="kanban-task-group-remaining text-[11px] text-[color:var(--text-tertiary,#6b7280)] [font-variant-numeric:tabular-nums]">
                          {t("kanban.task.group.remaining", { count: hiddenGroupTaskCount })}
                        </span>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
      {bulkConfirmState && (
        <div
          className="kanban-group-bulk-confirm-overlay fixed inset-0 z-[1200] bg-[color-mix(in_srgb,#0f172a_28%,transparent)] backdrop-blur-sm flex items-center justify-center p-3"
          data-testid="kanban-group-bulk-confirm-overlay"
          onClick={() => setBulkConfirmState(null)}
        >
          <div
            className="kanban-group-bulk-confirm-dialog w-[320px] max-w-full bg-[color:var(--bg-primary,#fff)] border border-[color-mix(in_srgb,var(--border-color,#d1d5db)_78%,transparent)] rounded-xl shadow-[0_10px_24px_rgba(15,23,42,0.18)] p-3 flex flex-col gap-2.5"
            role="dialog"
            aria-modal="true"
            aria-label={t("kanban.task.group.bulkComplete")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="kanban-group-bulk-confirm-heading flex items-center justify-center gap-2">
              <span className="kanban-group-bulk-confirm-icon w-[22px] h-[22px] rounded-[6px] inline-flex items-center justify-center text-[color-mix(in_srgb,#d97706_72%,#92400e)] bg-[color-mix(in_srgb,#fef3c7_78%,#fffbeb)] border border-[color-mix(in_srgb,#f59e0b_34%,transparent)] shrink-0" aria-hidden="true">
                <CircleAlert size={14} />
              </span>
              <p className="kanban-group-bulk-confirm-text m-0 text-sm leading-[1.35] font-semibold text-center text-[color:var(--text-primary,#111827)]">
                {t("kanban.task.group.bulkCompleteConfirm", { count: bulkConfirmState.count })}
              </p>
            </div>
            <div className="kanban-group-bulk-confirm-actions grid [grid-template-columns:repeat(2,minmax(0,1fr))] gap-2">
              <button
                type="button"
                className="kanban-group-bulk-confirm-btn is-cancel h-[34px] rounded-lg border border-[color-mix(in_srgb,var(--border-color,#d1d5db)_86%,transparent)] text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer bg-[color-mix(in_srgb,var(--bg-secondary,#f3f4f6)_80%,#f8fafc)] text-[color-mix(in_srgb,var(--text-primary,#111827)_84%,#334155)]"
                onClick={() => setBulkConfirmState(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="kanban-group-bulk-confirm-btn is-confirm h-[34px] rounded-lg border border-transparent text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer bg-[color-mix(in_srgb,#2563eb_90%,#1d4ed8)] text-white"
                onClick={() => {
                  onBulkMoveGroup?.(
                    bulkConfirmState.taskIds,
                    bulkConfirmState.sourceStatus,
                    bulkConfirmState.destinationStatus,
                  );
                  setBulkConfirmState(null);
                }}
              >
                <Check size={14} aria-hidden="true" />
                {t("common.ok")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
