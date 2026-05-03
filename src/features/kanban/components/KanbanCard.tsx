import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import { Draggable } from "@hello-pangea/dnd";
import {
  ArrowRightLeft,
  Ban,
  CalendarCheck2,
  CalendarClock,
  Link2,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Trash2,
  X,
} from "lucide-react";
import type { KanbanTask, KanbanTaskStatus } from "../types";
import type { EngineType } from "../../../types";
import { EngineIcon } from "../../engine/components/EngineIcon";
import { describeSchedule } from "../utils/scheduling";
import { formatKanbanBlockedReason } from "../utils/blockedReason";
import { describeTaskRunSurface } from "../../tasks/utils/taskRunSurface";

type KanbanCardProps = {
  task: KanbanTask;
  index: number;
  chainGroupCode?: string | null;
  chainGroupCodePrefix?: "#" | "$";
  chainGroupBadgeStyle?: CSSProperties;
  chainOrderIndex?: number | null;
  isSelected?: boolean;
  isProcessing?: boolean;
  processingStartedAt?: number | null;
  onSelect: () => void;
  onDelete: () => void;
  onEdit?: () => void;
  onCancelOrBlock?: () => void;
  onToggleSchedulePaused?: () => void;
};

const ENGINE_NAMES: Record<EngineType, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
};

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h ${remainMinutes.toString().padStart(2, "0")}m`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatMonthDayTime(timestamp: number | null | undefined): string | null {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return null;
  }
  const date = new Date(timestamp);
  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(
    date.getMinutes(),
  )}:${pad2(date.getSeconds())}`;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function resolveRecurringBadgeLabelKey(status: KanbanTaskStatus): string {
  if (status === "todo") {
    return "kanban.task.schedule.schedulerBadge";
  }
  if (status === "inprogress") {
    return "kanban.task.schedule.runningBadge";
  }
  return "kanban.task.schedule.scheduledBadge";
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

export function KanbanCard({
  task,
  index,
  chainGroupCode = null,
  chainGroupCodePrefix = "#",
  chainGroupBadgeStyle,
  chainOrderIndex = null,
  isSelected,
  isProcessing,
  processingStartedAt,
  onSelect,
  onDelete,
  onEdit,
  onCancelOrBlock,
  onToggleSchedulePaused,
}: KanbanCardProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<"down" | "up">("down");
  const [showDragHint, setShowDragHint] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dragHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [elapsed, setElapsed] = useState("");
  const [countdownText, setCountdownText] = useState<string | null>(null);
  const [dismissedBlockedReason, setDismissedBlockedReason] = useState<string | null>(null);
  const scheduleDescriptor = describeSchedule(task.schedule);
  const isChainedTask = Boolean(task.chain?.previousTaskId);
  const rawBlockedReason = task.chain?.blockedReason ?? task.execution?.blockedReason ?? null;
  const chainHeadTriggerHintText =
    typeof chainOrderIndex === "number" &&
    Number.isFinite(chainOrderIndex) &&
    chainOrderIndex > 1
      ? t("kanban.task.blockedReason.chainRequiresHeadTriggerWithOrder", {
          headOrder: 1,
          currentOrder: chainOrderIndex,
        })
      : t("kanban.task.blockedReason.chainRequiresHeadTrigger");
  const blockedReason =
    rawBlockedReason === "chain_requires_head_trigger"
      ? chainHeadTriggerHintText
      : formatKanbanBlockedReason(t, rawBlockedReason);
  const normalizedBlockedReason = blockedReason?.trim() ?? "";
  const hasBlockedReason = normalizedBlockedReason.length > 0;
  const shouldShowBlockedReason =
    hasBlockedReason && dismissedBlockedReason !== normalizedBlockedReason;
  const recurringSchedule = task.schedule?.mode === "recurring" ? task.schedule : null;
  const onceSchedule = task.schedule?.mode === "once" ? task.schedule : null;
  const latestRunSurface = task.latestRunSummary ? describeTaskRunSurface(task.latestRunSummary) : null;
  const latestRunSummaryText =
    latestRunSurface &&
    (task.latestRunSummary?.status === "blocked" ||
      task.latestRunSummary?.status === "failed" ||
      task.latestRunSummary?.status === "waiting_input")
      ? latestRunSurface.summary
      : null;
  const hasActiveSchedule = Boolean(task.schedule && task.schedule.mode !== "manual");
  const isSchedulePaused = Boolean(task.schedule?.paused);
  const recurringRunIndex = resolveRecurringRunIndex(task);
  const showExecutionTimeRange = task.status === "testing" || task.status === "done";
  const executionStartedAt = task.execution?.startedAt ?? processingStartedAt ?? null;
  const executionFinishedAt = task.execution?.finishedAt ?? null;
  const hasExecutionTimeData =
    typeof executionStartedAt === "number" || typeof executionFinishedAt === "number";
  const recurringBadgeLabelKey =
    recurringSchedule ? resolveRecurringBadgeLabelKey(task.status) : null;
  const isRecurringTask = Boolean(recurringSchedule);
  const showChainMeta = Boolean(
    task.chain?.groupId ||
      isChainedTask ||
      (typeof chainOrderIndex === "number" && Number.isFinite(chainOrderIndex)),
  );
  const executionTimeRangeLabel = t("kanban.task.detail.timeRange", {
    start: formatMonthDayTime(executionStartedAt) ?? "-",
    end: formatMonthDayTime(executionFinishedAt) ?? "-",
  });
  const chainGroupCodeLabel = chainGroupCode
    ? chainGroupCodePrefix === "#" &&
      typeof chainOrderIndex === "number" &&
      Number.isFinite(chainOrderIndex) &&
      chainOrderIndex === 1
      ? `#${chainGroupCode}-(首)`
      : `${chainGroupCodePrefix}${chainGroupCode}`
    : null;
  const chainBadgeLabel =
    typeof chainOrderIndex === "number" && Number.isFinite(chainOrderIndex)
      ? t("kanban.task.detail.chainOrder", { order: chainOrderIndex })
      : t("kanban.task.chain.badge");
  const recurringCountdownTarget =
    task.status === "todo" &&
    recurringSchedule &&
    !isSchedulePaused &&
    typeof recurringSchedule.nextRunAt === "number"
      ? recurringSchedule.nextRunAt
      : null;
  const frozenPausedCountdownText =
    task.status === "todo" &&
    recurringSchedule &&
    isSchedulePaused &&
    typeof recurringSchedule.pausedRemainingMs === "number"
      ? formatCountdown(recurringSchedule.pausedRemainingMs)
      : null;
  const recurringRoundsLabel =
    recurringSchedule?.recurringExecutionMode === "same_thread" &&
    recurringSchedule.maxRounds
      ? t("kanban.task.detail.rounds", {
          current: recurringSchedule.completedRounds ?? 0,
          max: recurringSchedule.maxRounds,
        })
      : null;
  const hasCountdownBadge = Boolean(frozenPausedCountdownText || countdownText);
  const hasTimeRangeBadge = showExecutionTimeRange && hasExecutionTimeData;
  const hasSecondaryMetaSignals =
    hasCountdownBadge || hasTimeRangeBadge || Boolean(recurringRoundsLabel);
  const placeGroupCodeInPrimary = Boolean(chainGroupCodeLabel) && !hasSecondaryMetaSignals;
  const todoDragHintText =
    task.status === "todo" && isChainedTask
      ? chainHeadTriggerHintText
      : t("kanban.task.dragToStart");

  const formatRunAt = useCallback((timestamp: number | null | undefined): string | null => {
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
      return null;
    }
    return new Intl.DateTimeFormat(undefined, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(timestamp);
  }, []);

  const updateElapsed = useCallback(() => {
    if (isProcessing && processingStartedAt) {
      setElapsed(formatElapsed(Date.now() - processingStartedAt));
    }
  }, [isProcessing, processingStartedAt]);

  const updateCountdown = useCallback(() => {
    if (typeof recurringCountdownTarget !== "number") {
      setCountdownText(null);
      return;
    }
    setCountdownText(formatCountdown(recurringCountdownTarget - Date.now()));
  }, [recurringCountdownTarget]);

  useEffect(() => {
    if (!isProcessing || !processingStartedAt) {
      setElapsed("");
      return;
    }
    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [isProcessing, processingStartedAt, updateElapsed]);

  useEffect(() => {
    if (typeof recurringCountdownTarget !== "number") {
      setCountdownText(null);
      return;
    }
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [recurringCountdownTarget, updateCountdown]);

  useEffect(() => {
    if (!hasBlockedReason) {
      setDismissedBlockedReason(null);
      return;
    }
    if (dismissedBlockedReason && dismissedBlockedReason !== normalizedBlockedReason) {
      setDismissedBlockedReason(null);
    }
  }, [dismissedBlockedReason, hasBlockedReason, normalizedBlockedReason]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPlacement("down");
      return;
    }

    const evaluateMenuPlacement = () => {
      const container = menuRef.current;
      if (!container) {
        return;
      }
      const trigger = container.querySelector(".kanban-card-menu-btn") as HTMLElement | null;
      const menu = container.querySelector(".kanban-dropdown-menu") as HTMLElement | null;
      if (!trigger || !menu) {
        return;
      }
      const triggerRect = trigger.getBoundingClientRect();
      const menuHeight = Math.max(menu.offsetHeight, 160);
      const viewportPadding = 12;
      const menuGap = 4;
      const spaceBelow = window.innerHeight - triggerRect.bottom - viewportPadding;
      const spaceAbove = triggerRect.top - viewportPadding;
      const shouldDropUp =
        spaceBelow < menuHeight + menuGap && spaceAbove > spaceBelow;
      setMenuPlacement(shouldDropUp ? "up" : "down");
    };

    const rafId = window.requestAnimationFrame(evaluateMenuPlacement);
    window.addEventListener("resize", evaluateMenuPlacement);
    window.addEventListener("scroll", evaluateMenuPlacement, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", evaluateMenuPlacement);
      window.removeEventListener("scroll", evaluateMenuPlacement, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    return () => {
      if (dragHintTimerRef.current) clearTimeout(dragHintTimerRef.current);
    };
  }, []);

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          className={`kanban-card${snapshot.isDragging ? " is-dragging" : ""}${isSelected ? " is-selected" : ""}`}
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => {
            if (task.status === "todo") {
              setShowDragHint(true);
              if (dragHintTimerRef.current) clearTimeout(dragHintTimerRef.current);
              dragHintTimerRef.current = setTimeout(() => setShowDragHint(false), 3000);
            } else {
              onSelect();
            }
          }}
        >
          {showDragHint && task.status === "todo" && (
            <div className="kanban-card-drag-hint">
              {todoDragHintText}
            </div>
          )}
          <div className="kanban-card-header">
            <span
              className="kanban-card-engine"
              title={ENGINE_NAMES[task.engineType] ?? task.engineType}
            >
              <EngineIcon engine={task.engineType} size={15} />
            </span>
            <span className="kanban-card-title">{task.title}</span>
            <div className="kanban-card-menu" ref={menuRef}>
              <button
                className="kanban-icon-btn kanban-card-menu-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((prev) => !prev);
                }}
                aria-label={t("kanban.task.menu")}
              >
                <MoreHorizontal size={16} />
              </button>
              {menuOpen && (
                <div className={`kanban-dropdown-menu${menuPlacement === "up" ? " is-dropup" : ""}`}>
                  {task.status === "todo" && onEdit && (
                    <button
                      className="kanban-dropdown-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        onEdit();
                      }}
                    >
                      <Pencil size={14} />
                      {t("kanban.task.edit")}
                    </button>
                  )}
                  {task.status === "todo" && hasActiveSchedule && onToggleSchedulePaused && (
                    <button
                      className="kanban-dropdown-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        onToggleSchedulePaused();
                      }}
                    >
                      {isSchedulePaused ? <Play size={14} /> : <Pause size={14} />}
                      {isSchedulePaused
                        ? t("kanban.task.resumeSchedule")
                        : t("kanban.task.pauseSchedule")}
                    </button>
                  )}
                  {task.status === "todo" && hasActiveSchedule && onCancelOrBlock && (
                    <button
                      className="kanban-dropdown-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        onCancelOrBlock();
                      }}
                    >
                      <Ban size={14} />
                      {t("kanban.task.cancelSchedule")}
                    </button>
                  )}
                  <button
                    className="kanban-dropdown-item kanban-dropdown-item-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onDelete();
                    }}
                  >
                    <Trash2 size={14} />
                    {t("kanban.task.delete")}
                  </button>
                </div>
              )}
            </div>
          </div>
          {task.description && (
            <p className="kanban-card-desc">{task.description}</p>
          )}
          {(scheduleDescriptor || showChainMeta || showExecutionTimeRange) && (
            <div className="kanban-card-meta">
              <div className="kanban-card-meta-row">
                {scheduleDescriptor === "once" && (
                  <span className="kanban-card-badge is-schedule">
                    <CalendarClock size={12} className="kanban-card-badge-icon" />
                    {t("kanban.task.schedule.onceBadge")}
                  </span>
                )}
                {scheduleDescriptor === "recurring" && recurringBadgeLabelKey && (
                  <span className="kanban-card-badge is-schedule">
                    {task.status === "inprogress" ? (
                      <Loader2 size={12} className="kanban-card-badge-icon kanban-spin" />
                    ) : task.status === "todo" ? (
                      <CalendarClock size={12} className="kanban-card-badge-icon" />
                    ) : (
                      <CalendarCheck2 size={12} className="kanban-card-badge-icon" />
                    )}
                    {t(recurringBadgeLabelKey)}
                  </span>
                )}
                {scheduleDescriptor === "once_overdue" && (
                  <span className="kanban-card-badge is-schedule kanban-card-badge-warn">
                    {t("kanban.task.schedule.onceOverdueBadge")}
                  </span>
                )}
                {onceSchedule?.runAt && (
                  <span className="kanban-card-badge is-time">
                    {t("kanban.task.detail.runAt", { time: formatRunAt(onceSchedule.runAt) ?? "-" })}
                  </span>
                )}
                {recurringSchedule && (
                  <span className="kanban-card-badge is-interval">
                    {t("kanban.task.detail.every", {
                      interval: recurringSchedule.interval ?? 1,
                      unit: t(`kanban.task.schedule.${recurringSchedule.unit ?? "days"}`),
                    })}
                  </span>
                )}
                {recurringSchedule?.recurringExecutionMode === "same_thread" && (
                  <span className="kanban-card-badge is-mode">{t("kanban.task.detail.sameThread")}</span>
                )}
                {recurringSchedule?.recurringExecutionMode === "new_thread" && (
                  <span className="kanban-card-badge is-mode">{t("kanban.task.detail.newThread")}</span>
                )}
                {showChainMeta && (
                  <span className="kanban-card-badge is-chain">
                    <Link2 size={12} className="kanban-card-badge-icon" />
                    {chainBadgeLabel}
                  </span>
                )}
                {recurringRunIndex !== null && !showChainMeta && (
                  <span className="kanban-card-badge is-chain">
                    <Link2 size={12} className="kanban-card-badge-icon" />
                    {t("kanban.task.detail.chainOrder", { order: recurringRunIndex })}
                  </span>
                )}
                {recurringSchedule?.recurringExecutionMode === "new_thread" && (
                  <span className="kanban-card-badge is-result">
                    {recurringSchedule.newThreadResultMode === "none"
                      ? (
                        <>
                          <ArrowRightLeft size={12} className="kanban-card-badge-icon" />
                          {t("kanban.task.detail.resultBlocked")}
                        </>
                      )
                      : (
                        <>
                          <ArrowRightLeft size={12} className="kanban-card-badge-icon" />
                          {t("kanban.task.detail.resultPassed")}
                        </>
                      )}
                  </span>
                )}
                {placeGroupCodeInPrimary && chainGroupCodeLabel && (showChainMeta || isRecurringTask) && (
                  <span className="kanban-card-badge is-chain-code" style={chainGroupBadgeStyle}>
                    {chainGroupCodeLabel}
                  </span>
                )}
              </div>
              {(hasSecondaryMetaSignals || (!placeGroupCodeInPrimary && chainGroupCodeLabel)) && (
                <div className="kanban-card-meta-row is-secondary">
                  {hasCountdownBadge && (
                    <span className="kanban-card-badge is-countdown">
                      {t("kanban.task.detail.countdown", {
                        time: frozenPausedCountdownText ?? countdownText,
                      })}
                    </span>
                  )}
                  {hasTimeRangeBadge && (
                    <span className="kanban-card-badge is-timestamp">
                      {executionTimeRangeLabel}
                    </span>
                  )}
                  {recurringRoundsLabel && (
                    <span className="kanban-card-badge is-sequence">
                      {recurringRoundsLabel}
                    </span>
                  )}
                  {!placeGroupCodeInPrimary && chainGroupCodeLabel && (showChainMeta || isRecurringTask) && (
                    <span className="kanban-card-badge is-chain-code" style={chainGroupBadgeStyle}>
                      {chainGroupCodeLabel}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          {shouldShowBlockedReason && (
            <div className="kanban-card-blocked-reason">
              <span className="kanban-card-blocked-reason-text">
                {t("kanban.task.blocked", { reason: normalizedBlockedReason })}
              </span>
              <button
                type="button"
                className="kanban-card-blocked-reason-close"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setDismissedBlockedReason(normalizedBlockedReason);
                }}
                aria-label={t("kanban.conversation.close")}
                title={t("kanban.conversation.close")}
              >
                <X size={12} />
              </button>
            </div>
          )}
          {task.latestRunSummary && latestRunSurface ? (
            <div
              className={`kanban-card-run-summary kanban-card-run-summary--${latestRunSurface.severity}`}
              aria-label={t("kanban.task.latestRunSummary.ariaLabel")}
            >
              <div className="kanban-card-run-summary__topline">
                <span className="kanban-card-run-summary__status">
                  {t(`taskCenter.status.${task.latestRunSummary.status}`)}
                </span>
                <span className="kanban-card-run-summary__time">
                  {formatMonthDayTime(task.latestRunSummary.updatedAt) ?? "-"}
                </span>
              </div>
              {latestRunSummaryText ? (
                <div className="kanban-card-run-summary__body">{latestRunSummaryText}</div>
              ) : null}
              <div className="kanban-card-run-summary__hint">
                {t(latestRunSurface.hintKey)}
              </div>
            </div>
          ) : null}
          {isProcessing && (
            <div className="kanban-card-status-row">
              <span className="kanban-card-spinner" />
              <span className="kanban-card-processing-text">
                {t("kanban.task.processing")}
              </span>
              {elapsed && (
                <span className="kanban-card-elapsed">{elapsed}</span>
              )}
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
}
