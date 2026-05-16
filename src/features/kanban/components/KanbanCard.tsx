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
import ArrowRightLeft from "lucide-react/dist/esm/icons/arrow-right-left";
import Ban from "lucide-react/dist/esm/icons/ban";
import CalendarCheck2 from "lucide-react/dist/esm/icons/calendar-check-2";
import CalendarClock from "lucide-react/dist/esm/icons/calendar-clock";
import Link2 from "lucide-react/dist/esm/icons/link-2";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import MoreHorizontal from "lucide-react/dist/esm/icons/more-horizontal";
import Pause from "lucide-react/dist/esm/icons/pause";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Play from "lucide-react/dist/esm/icons/play";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import X from "lucide-react/dist/esm/icons/x";
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

// Keyframes for kanban-card animations — no Tailwind equivalent, kept as <style> block at component level.
const KANBAN_CARD_STYLES = `
  @keyframes kanban-hint-fade-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes kanban-spin {
    to { transform: rotate(360deg); }
  }
  .kanban-spin { animation: kanban-spin 0.8s linear infinite; }
  .kanban-card-spinner { animation: kanban-spin 0.8s linear infinite; }
  .kanban-card-drag-hint { animation: kanban-hint-fade-in 0.15s ease-out; }
`;

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
    const scrollOptions = { capture: true, passive: true } as const;
    window.addEventListener("resize", evaluateMenuPlacement);
    window.addEventListener("scroll", evaluateMenuPlacement, scrollOptions);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", evaluateMenuPlacement);
      window.removeEventListener("scroll", evaluateMenuPlacement, scrollOptions);
    };
  }, [menuOpen]);

  useEffect(() => {
    return () => {
      if (dragHintTimerRef.current) clearTimeout(dragHintTimerRef.current);
    };
  }, []);

  return (
    <>
      <style>{KANBAN_CARD_STYLES}</style>
      <Draggable draggableId={task.id} index={index}>
        {(provided, snapshot) => (
          <div
            className={`kanban-card px-5 py-4 m-0 cursor-pointer transition-[background] duration-[120ms] border-b border-[color:var(--border-color,#f0f0f0)] relative bg-transparent last:border-b-[1px] last:border-b-[color:var(--border-color,#f0f0f0)] hover:bg-[color:var(--bg-tertiary,#fafafa)]${snapshot.isDragging ? " is-dragging bg-[color:var(--bg-primary,#fff)] shadow-[0_8px_24px_rgba(0,0,0,0.12)] rounded-[4px] border-b-transparent" : ""}${isSelected ? " is-selected bg-[color:var(--surface-active,#1e2a38)]" : ""}`}
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
              <div className="kanban-card-drag-hint text-xs text-[color:var(--text-secondary,#888)] bg-[color:var(--bg-secondary,#f5f5f5)] rounded-[4px] px-2.5 py-1.5 mb-1.5 leading-[1.4]">
                {todoDragHintText}
              </div>
            )}
            <div className="kanban-card-header flex items-start gap-2">
              <span
                className="kanban-card-engine flex items-center shrink-0 mt-0.5 opacity-65 transition-opacity duration-150 group-hover:opacity-100"
                title={ENGINE_NAMES[task.engineType] ?? task.engineType}
              >
                <EngineIcon engine={task.engineType} size={15} />
              </span>
              <span className="kanban-card-title text-sm font-semibold text-[color:var(--text-primary,#1a1a1a)] leading-[1.4] break-words flex-1 min-w-0 [-webkit-line-clamp:4] [-webkit-box-orient:vertical] [display:-webkit-box] overflow-hidden">{task.title}</span>
              <div className="kanban-card-menu relative shrink-0 -mt-0.5" ref={menuRef}>
                <button
                  className="kanban-icon-btn kanban-card-menu-btn flex items-center justify-center w-7 h-7 p-0 border-none bg-transparent rounded-[6px] cursor-pointer text-[color:var(--text-secondary,#666)] transition-[background,color] duration-150 opacity-40 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen((prev) => !prev);
                  }}
                  aria-label={t("kanban.task.menu")}
                >
                  <MoreHorizontal size={16} />
                </button>
                {menuOpen && (
                  <div className={`kanban-dropdown-menu absolute top-full right-0 z-[100] min-w-[140px] bg-[color:var(--surface-popover,var(--bg-primary,#fff))] border border-[color:var(--border-strong,var(--border-color,#e5e5e5))] rounded-lg shadow-[0_10px_26px_rgba(0,0,0,0.22)] p-1${menuPlacement === "up" ? " is-dropup !top-auto !bottom-full" : ""}`}>
                    {task.status === "todo" && onEdit && (
                      <button
                        className="kanban-dropdown-item flex items-center gap-2 w-full px-2.5 py-2 border-none bg-transparent rounded-[6px] text-[13px] text-[color:var(--text-primary,#111)] cursor-pointer text-left hover:bg-[color:var(--bg-tertiary,#f0f0f0)]"
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
                        className="kanban-dropdown-item flex items-center gap-2 w-full px-2.5 py-2 border-none bg-transparent rounded-[6px] text-[13px] text-[color:var(--text-primary,#111)] cursor-pointer text-left hover:bg-[color:var(--bg-tertiary,#f0f0f0)]"
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
                        className="kanban-dropdown-item flex items-center gap-2 w-full px-2.5 py-2 border-none bg-transparent rounded-[6px] text-[13px] text-[color:var(--text-primary,#111)] cursor-pointer text-left hover:bg-[color:var(--bg-tertiary,#f0f0f0)]"
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
                      className="kanban-dropdown-item kanban-dropdown-item-danger flex items-center gap-2 w-full px-2.5 py-2 border-none bg-transparent rounded-[6px] text-[13px] text-[#dc2626] cursor-pointer text-left hover:bg-[#fef2f2]"
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
              <p className="kanban-card-desc text-[13px] text-[color:var(--text-tertiary,#aaa)] mt-1.5 mb-0 leading-[1.6] break-words [-webkit-line-clamp:4] [-webkit-box-orient:vertical] [display:-webkit-box] overflow-hidden">{task.description}</p>
            )}
            {(scheduleDescriptor || showChainMeta || showExecutionTimeRange) && (
              <div className="kanban-card-meta mt-2 flex flex-col gap-1.5">
                <div className="kanban-card-meta-row flex flex-wrap gap-1.5">
                  {scheduleDescriptor === "once" && (
                    <span className="kanban-card-badge is-schedule inline-flex items-center rounded-[6px] px-[7px] py-px text-[10px] leading-[1.25] font-semibold text-[color-mix(in_srgb,#1d4ed8_72%,var(--text-secondary,#4b5563))] bg-transparent border border-[color-mix(in_srgb,#2563eb_36%,var(--border-color,#dbe3ee))]">
                      <CalendarClock size={12} className="kanban-card-badge-icon mr-[3px] shrink-0" />
                      {t("kanban.task.schedule.onceBadge")}
                    </span>
                  )}
                  {scheduleDescriptor === "recurring" && recurringBadgeLabelKey && (
                    <span className="kanban-card-badge is-schedule inline-flex items-center rounded-[6px] px-[7px] py-px text-[10px] leading-[1.25] font-semibold text-[color-mix(in_srgb,#1d4ed8_72%,var(--text-secondary,#4b5563))] bg-transparent border border-[color-mix(in_srgb,#2563eb_36%,var(--border-color,#dbe3ee))]">
                      {task.status === "inprogress" ? (
                        <Loader2 size={12} className="kanban-card-badge-icon kanban-spin mr-[3px] shrink-0" />
                      ) : task.status === "todo" ? (
                        <CalendarClock size={12} className="kanban-card-badge-icon mr-[3px] shrink-0" />
                      ) : (
                        <CalendarCheck2 size={12} className="kanban-card-badge-icon mr-[3px] shrink-0" />
                      )}
                      {t(recurringBadgeLabelKey)}
                    </span>
                  )}
                  {scheduleDescriptor === "once_overdue" && (
                    <span className="kanban-card-badge is-schedule kanban-card-badge-warn inline-flex items-center rounded-[6px] px-[7px] py-px text-[10px] leading-[1.25] font-semibold text-[#9a3412] bg-transparent border border-[#fdba74]">
                      {t("kanban.task.schedule.onceOverdueBadge")}
                    </span>
                  )}
                  {onceSchedule?.runAt && (
                    <span className="kanban-card-badge is-time inline-flex items-center rounded-[6px] px-[7px] py-px text-[10px] leading-[1.25] font-semibold text-[color-mix(in_srgb,#334155_74%,var(--text-secondary,#4b5563))] bg-transparent border border-[color-mix(in_srgb,#94a3b8_32%,var(--border-color,#dbe3ee))]">
                      {t("kanban.task.detail.runAt", { time: formatRunAt(onceSchedule.runAt) ?? "-" })}
                    </span>
                  )}
                  {recurringSchedule && (
                    <span className="kanban-card-badge is-interval inline-flex items-center rounded-[6px] px-[7px] py-px text-[10px] leading-[1.25] font-semibold text-[color-mix(in_srgb,#0f766e_70%,var(--text-secondary,#4b5563))] bg-transparent border border-[color-mix(in_srgb,#14b8a6_34%,var(--border-color,#dbe3ee))]">
                      {t("kanban.task.detail.every", {
                        interval: recurringSchedule.interval ?? 1,
                        unit: t(`kanban.task.schedule.${recurringSchedule.unit ?? "days"}`),
                      })}
                    </span>
                  )}
                  {recurringSchedule?.recurringExecutionMode === "same_thread" && (
                    <span className="kanban-card-badge is-mode inline-flex items-center rounded-[6px] px-[7px] py-px text-[10px] leading-[1.25] font-semibold text-[color-mix(in_srgb,#6d28d9_72%,var(--text-secondary,#4b5563))] bg-transparent border border-[color-mix(in_srgb,#8b5cf6_34%,var(--border-color,#dbe3ee))]">{t("kanban.task.detail.sameThread")}</span>
                  )}
                  {recurringSchedule?.recurringExecutionMode === "new_thread" && (
                    <span className="kanban-card-badge is-mode inline-flex items-center rounded-[6px] px-[7px] py-px text-[10px] leading-[1.25] font-semibold text-[color-mix(in_srgb,#6d28d9_72%,var(--text-secondary,#4b5563))] bg-transparent border border-[color-mix(in_srgb,#8b5cf6_34%,var(--border-color,#dbe3ee))]">{t("kanban.task.detail.newThread")}</span>
                  )}
                  {showChainMeta && (
                    <span className="kanban-card-badge is-chain inline-flex items-center rounded-[6px] px-[7px] py-px text-[10px] leading-[1.25] font-semibold text-[color-mix(in_srgb,#9a3412_72%,var(--text-secondary,#4b5563))] bg-transparent border border-[color-mix(in_srgb,#f97316_34%,var(--border-color,#dbe3ee))]">
                      <Link2 size={12} className="kanban-card-badge-icon mr-[3px] shrink-0" />
                      {chainBadgeLabel}
                    </span>
                  )}
                  {recurringRunIndex !== null && !showChainMeta && (
                    <span className="kanban-card-badge is-chain inline-flex items-center rounded-[6px] px-[7px] py-px text-[10px] leading-[1.25] font-semibold text-[color-mix(in_srgb,#9a3412_72%,var(--text-secondary,#4b5563))] bg-transparent border border-[color-mix(in_srgb,#f97316_34%,var(--border-color,#dbe3ee))]">
                      <Link2 size={12} className="kanban-card-badge-icon mr-[3px] shrink-0" />
                      {t("kanban.task.detail.chainOrder", { order: recurringRunIndex })}
                    </span>
                  )}
                  {recurringSchedule?.recurringExecutionMode === "new_thread" && (
                    <span className="kanban-card-badge is-result inline-flex items-center rounded-[6px] px-[7px] py-px text-[10px] leading-[1.25] font-semibold text-[color-mix(in_srgb,#6d28d9_72%,var(--text-secondary,#4b5563))] bg-transparent border border-[color-mix(in_srgb,#8b5cf6_34%,var(--border-color,#dbe3ee))]">
                      {recurringSchedule.newThreadResultMode === "none"
                        ? (
                          <>
                            <ArrowRightLeft size={12} className="kanban-card-badge-icon mr-[3px] shrink-0" />
                            {t("kanban.task.detail.resultBlocked")}
                          </>
                        )
                        : (
                          <>
                            <ArrowRightLeft size={12} className="kanban-card-badge-icon mr-[3px] shrink-0" />
                            {t("kanban.task.detail.resultPassed")}
                          </>
                        )}
                    </span>
                  )}
                  {placeGroupCodeInPrimary && chainGroupCodeLabel && (showChainMeta || isRecurringTask) && (
                    <span className="kanban-card-badge is-chain-code inline-flex items-center rounded-[6px] px-[7px] py-px text-[10px] leading-[1.25] font-semibold bg-transparent" style={chainGroupBadgeStyle}>
                      {chainGroupCodeLabel}
                    </span>
                  )}
                </div>
                {(hasSecondaryMetaSignals || (!placeGroupCodeInPrimary && chainGroupCodeLabel)) && (
                  <div className="kanban-card-meta-row is-secondary flex flex-wrap gap-1.5 mt-0">
                    {hasCountdownBadge && (
                      <span className="kanban-card-badge is-countdown inline-flex items-center rounded-[6px] px-[7px] py-px text-[10px] leading-[1.25] font-semibold text-[color-mix(in_srgb,#0f766e_70%,var(--text-secondary,#4b5563))] bg-transparent border border-[color-mix(in_srgb,#14b8a6_34%,var(--border-color,#dbe3ee))]">
                        {t("kanban.task.detail.countdown", {
                          time: frozenPausedCountdownText ?? countdownText,
                        })}
                      </span>
                    )}
                    {hasTimeRangeBadge && (
                      <span className="kanban-card-badge is-timestamp inline-flex items-center rounded-[6px] px-[7px] py-px text-[10px] leading-[1.25] font-semibold text-[color-mix(in_srgb,#334155_74%,var(--text-secondary,#4b5563))] bg-transparent border border-[color-mix(in_srgb,#94a3b8_32%,var(--border-color,#dbe3ee))]">
                        {executionTimeRangeLabel}
                      </span>
                    )}
                    {recurringRoundsLabel && (
                      <span className="kanban-card-badge is-sequence inline-flex items-center rounded-[6px] px-[7px] py-px text-[10px] leading-[1.25] font-semibold text-[color-mix(in_srgb,#9a3412_72%,var(--text-secondary,#4b5563))] bg-transparent border border-[color-mix(in_srgb,#f97316_34%,var(--border-color,#dbe3ee))]">
                        {recurringRoundsLabel}
                      </span>
                    )}
                    {!placeGroupCodeInPrimary && chainGroupCodeLabel && (showChainMeta || isRecurringTask) && (
                      <span className="kanban-card-badge is-chain-code inline-flex items-center rounded-[6px] px-[7px] py-px text-[10px] leading-[1.25] font-semibold bg-transparent" style={chainGroupBadgeStyle}>
                        {chainGroupCodeLabel}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
            {shouldShowBlockedReason && (
              <div className="kanban-card-blocked-reason flex items-start gap-1.5 mt-2 text-[11px] leading-[1.4] text-[#b45309] bg-[#fffbeb] border border-[#fcd34d] rounded-[6px] px-2 py-1.5">
                <span className="kanban-card-blocked-reason-text flex-1 min-w-0">
                  {t("kanban.task.blocked", { reason: normalizedBlockedReason })}
                </span>
                <button
                  type="button"
                  className="kanban-card-blocked-reason-close border-none bg-transparent text-inherit w-4 h-4 p-0 mt-px rounded-[3px] inline-flex items-center justify-center cursor-pointer shrink-0 hover:bg-[color-mix(in_srgb,#f59e0b_18%,transparent)] focus-visible:outline focus-visible:outline-[1px] focus-visible:outline-[color-mix(in_srgb,#d97706_72%,#fff)] focus-visible:outline-offset-[1px]"
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
                className={`kanban-card-run-summary grid gap-1 mt-2 px-2.5 py-2 border rounded-[10px]${
                  latestRunSurface.severity === "active"
                    ? " kanban-card-run-summary--active border-[color-mix(in_srgb,#2563eb_38%,var(--border-subtle,#334155))] bg-[color-mix(in_srgb,#2563eb_12%,var(--surface-card-muted,#181a22))]"
                    : latestRunSurface.severity === "attention"
                    ? " kanban-card-run-summary--attention border-[color-mix(in_srgb,var(--status-warning,#f59e0b)_40%,var(--border-subtle,#334155))] bg-[color-mix(in_srgb,var(--status-warning,#f59e0b)_12%,var(--surface-card-muted,#181a22))]"
                    : latestRunSurface.severity === "danger"
                    ? " kanban-card-run-summary--danger border-[color-mix(in_srgb,var(--status-error,#ef4444)_40%,var(--border-subtle,#334155))] bg-[color-mix(in_srgb,var(--status-error,#ef4444)_12%,var(--surface-card-muted,#181a22))]"
                    : latestRunSurface.severity === "success"
                    ? " kanban-card-run-summary--success border-[color-mix(in_srgb,var(--status-success,#22c55e)_40%,var(--border-subtle,#334155))] bg-[color-mix(in_srgb,var(--status-success,#22c55e)_12%,var(--surface-card-muted,#181a22))]"
                    : " border-[color-mix(in_srgb,var(--border-subtle,#334155)_82%,transparent)] bg-[color-mix(in_srgb,var(--surface-card-muted,#181a22)_92%,transparent)]"
                }`}
                aria-label={t("kanban.task.latestRunSummary.ariaLabel")}
              >
                <div className="kanban-card-run-summary__topline flex items-center justify-between gap-2">
                  <span className="kanban-card-run-summary__status text-[11px] text-[color:var(--text-strong,#e5e7eb)] font-bold">
                    {t(`taskCenter.status.${task.latestRunSummary.status}`)}
                  </span>
                  <span className="kanban-card-run-summary__time text-[11px] text-[color:var(--text-muted,#cbd5e1)] [font-variant-numeric:tabular-nums]">
                    {formatMonthDayTime(task.latestRunSummary.updatedAt) ?? "-"}
                  </span>
                </div>
                {latestRunSummaryText ? (
                  <div className="kanban-card-run-summary__body text-[color:var(--text-strong,#e5e7eb)] text-xs leading-[1.45]">{latestRunSummaryText}</div>
                ) : null}
                <div className="kanban-card-run-summary__hint text-[11px] text-[color:var(--text-muted,#cbd5e1)] leading-[1.4]">
                  {t(latestRunSurface.hintKey)}
                </div>
              </div>
            ) : null}
            {isProcessing && (
              <div className="kanban-card-status-row flex items-center gap-1.5 mt-2">
                <span className="kanban-card-spinner w-3 h-3 border-[1.5px] border-[color:var(--border-color,#e5e5e5)] border-t-[color:var(--accent-color,#3b82f6)] rounded-full shrink-0" />
                <span className="kanban-card-processing-text text-xs text-[color:var(--accent-color,#3b82f6)] font-medium">
                  {t("kanban.task.processing")}
                </span>
                {elapsed && (
                  <span className="kanban-card-elapsed text-[11px] text-[color:var(--text-secondary,#888)] ml-auto [font-variant-numeric:tabular-nums]">{elapsed}</span>
                )}
              </div>
            )}
          </div>
        )}
      </Draggable>
    </>
  );
}
