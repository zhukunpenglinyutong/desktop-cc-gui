import BellDot from "lucide-react/dist/esm/icons/bell-dot";
import CheckCheck from "lucide-react/dist/esm/icons/check-check";
import CalendarDays from "lucide-react/dist/esm/icons/calendar-days";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import type { MouseEvent } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SessionRadarEntry } from "../hooks/useSessionRadarFeed";
import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";
import { EngineIcon } from "../../engine/components/EngineIcon";
import { deleteSessionRadarHistoryEntries } from "../utils/sessionRadarHistoryManagement";
import {
  RADAR_STORE_NAME,
  SESSION_RADAR_COLLAPSED_DATE_GROUPS_KEY,
  SESSION_RADAR_READ_STATE_KEY,
} from "../utils/sessionRadarPersistence";

type WorkspaceSessionRadarPanelProps = {
  runningSessions: SessionRadarEntry[];
  recentCompletedSessions: SessionRadarEntry[];
  onSelectThread: (workspaceId: string, threadId: string) => void;
};

type RadarDeleteIconButtonProps = {
  className: string;
  ariaLabel: string;
  title: string;
  disabled: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  iconSize: number;
};

const WORKSPACE_ACCENT_PALETTE = [
  "#c2410c",
  "#d97706",
  "#ca8a04",
  "#a16207",
  "#b45309",
  "#9a3412",
  "#be123c",
  "#a21caf",
  "#7c2d12",
  "#78350f",
];

function formatActivityTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function formatDuration(durationMs: number | null, t: ReturnType<typeof useTranslation>["t"]) {
  if (durationMs == null) {
    return t("activityPanel.radar.durationUnknown");
  }
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${restSeconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${restSeconds}s`;
  }
  return `${restSeconds}s`;
}

function resolveDurationToneClass(durationMs: number | null) {
  if (durationMs == null) {
    return "is-unknown";
  }
  const totalMinutes = durationMs / (60 * 1000);
  if (totalMinutes < 1) {
    return "is-seconds";
  }
  if (totalMinutes <= 5) {
    return "is-lt-5m";
  }
  if (totalMinutes <= 10) {
    return "is-lt-10m";
  }
  if (totalMinutes <= 20) {
    return "is-lt-20m";
  }
  if (totalMinutes <= 30) {
    return "is-lt-30m";
  }
  return "is-gt-30m";
}

function resolveDurationToneTailwind(durationMs: number | null) {
  if (durationMs == null) {
    return "text-[color-mix(in_srgb,var(--text-muted)_92%,transparent)]";
  }
  const totalMinutes = durationMs / (60 * 1000);
  if (totalMinutes < 1) {
    return "text-[color-mix(in_srgb,#10b981_84%,var(--text-strong))]";
  }
  if (totalMinutes <= 5) {
    return "text-[color-mix(in_srgb,#22c55e_86%,var(--text-strong))]";
  }
  if (totalMinutes <= 10) {
    return "text-[color-mix(in_srgb,#f59e0b_86%,var(--text-strong))]";
  }
  if (totalMinutes <= 20) {
    return "text-[color-mix(in_srgb,#f97316_88%,var(--text-strong))]";
  }
  if (totalMinutes <= 30) {
    return "text-[color-mix(in_srgb,#ef4444_90%,var(--text-strong))]";
  }
  return "text-[color-mix(in_srgb,#be123c_92%,var(--text-strong))]";
}

function formatDateKey(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveWorkspaceAccent(workspaceSeed: string) {
  if (!workspaceSeed) {
    return WORKSPACE_ACCENT_PALETTE[0];
  }
  let hash = 0;
  for (let index = 0; index < workspaceSeed.length; index += 1) {
    hash = (hash * 31 + workspaceSeed.charCodeAt(index)) | 0;
  }
  const paletteIndex = Math.abs(hash) % WORKSPACE_ACCENT_PALETTE.length;
  return WORKSPACE_ACCENT_PALETTE[paletteIndex];
}

function RadarDeleteIconButton({
  className,
  ariaLabel,
  title,
  disabled,
  onClick,
  iconSize,
}: RadarDeleteIconButtonProps) {
  const isDateGroup = className.includes("is-date-group");
  const isEntry = className.includes("is-entry");
  return (
    <button
      type="button"
      className={`session-activity-radar-delete-icon-button ${className} p-0 border-none rounded-full inline-flex items-center justify-center bg-transparent text-[color-mix(in_srgb,var(--status-error,#ef4444)_82%,#ffd1d1)] dark:text-[color-mix(in_srgb,var(--status-error,#ef4444)_82%,#ffd1d1)] transition-[background-color,color,transform] duration-[140ms] ease-linear [&_svg]:[stroke-width:2.2] enabled:hover:bg-transparent enabled:hover:text-[#ffe4e6] focus-visible:outline focus-visible:outline-1 focus-visible:[outline-color:color-mix(in_srgb,var(--status-error,#ef4444)_86%,#ffffff)] focus-visible:[outline-offset:1px] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none [:root[data-theme=light]_&]:text-[#dc2626] [:root[data-theme=light]_&:hover:not(:disabled)]:text-[#b91c1c]${
        isDateGroup
          ? " w-6 h-6 absolute right-2 top-1/2 -translate-y-1/2 enabled:hover:translate-y-[calc(-50%-0.5px)]"
          : ""
      }${isEntry ? " w-5 h-5" : ""}${!isDateGroup && !isEntry ? " enabled:hover:-translate-y-px" : ""}`}
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
    >
      <Trash2 size={iconSize} aria-hidden />
    </button>
  );
}

export function WorkspaceSessionRadarPanel({
  runningSessions,
  recentCompletedSessions,
  onSelectThread,
}: WorkspaceSessionRadarPanelProps) {
  const { t } = useTranslation();
  const [previewExpandedById, setPreviewExpandedById] = useState<Record<string, boolean>>({});
  const [deletingEntryIds, setDeletingEntryIds] = useState<Record<string, boolean>>({});
  const [readStateById, setReadStateById] = useState<Record<string, number>>(
    () =>
      getClientStoreSync<Record<string, number>>(RADAR_STORE_NAME, SESSION_RADAR_READ_STATE_KEY) ??
      {},
  );
  const [collapsedDateGroups, setCollapsedDateGroups] = useState<Record<string, boolean>>(
    () =>
      getClientStoreSync<Record<string, boolean>>(
        RADAR_STORE_NAME,
        SESSION_RADAR_COLLAPSED_DATE_GROUPS_KEY,
      ) ??
      {},
  );
  const headerSummary = useMemo(
    () =>
      [
        t("activityPanel.radar.runningSection", { count: runningSessions.length }),
        t("activityPanel.radar.recentSection", { count: recentCompletedSessions.length }),
      ].join(" · "),
    [recentCompletedSessions.length, runningSessions.length, t],
  );

  const markEntryAsRead = (entry: SessionRadarEntry) => {
    if (entry.isProcessing) {
      return;
    }
    setReadStateById((current) => {
      const next = { ...current, [entry.id]: Date.now() };
      writeClientStoreValue(RADAR_STORE_NAME, SESSION_RADAR_READ_STATE_KEY, next, {
        immediate: true,
      });
      return next;
    });
  };

  const resolveEngine = (entry: SessionRadarEntry): "codex" | "claude" | "gemini" | "opencode" => {
    const normalizedEngine = entry.engine.toUpperCase();
    if (normalizedEngine === "CLAUDE") {
      return "claude";
    }
    if (normalizedEngine === "GEMINI") {
      return "gemini";
    }
    if (normalizedEngine === "OPENCODE") {
      return "opencode";
    }
    return "codex";
  };

  const renderReadMarkerIcon = (isUnreadRecent: boolean) =>
    isUnreadRecent ? <BellDot size={11} aria-hidden /> : <CheckCheck size={11} aria-hidden />;

  const deleteRecentEntries = (entries: SessionRadarEntry[]) => {
    const dedupedTargets = new Map<
      string,
      {
        id: string;
        completedAt: number;
      }
    >();
    for (const entry of entries) {
      dedupedTargets.set(entry.id, {
        id: entry.id,
        completedAt: entry.completedAt ?? entry.updatedAt,
      });
    }
    if (dedupedTargets.size === 0) {
      return;
    }
    const targetIds = Array.from(dedupedTargets.keys());
    if (targetIds.some((entryId) => deletingEntryIds[entryId])) {
      return;
    }
    setDeletingEntryIds((current) => {
      const next = { ...current };
      targetIds.forEach((entryId) => {
        next[entryId] = true;
      });
      return next;
    });
    try {
      const result = deleteSessionRadarHistoryEntries(Array.from(dedupedTargets.values()));
      if (result.succeededEntryIds.length > 0) {
        const succeededIdSet = new Set(result.succeededEntryIds);
        setPreviewExpandedById((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([entryId]) => !succeededIdSet.has(entryId)),
          ),
        );
        setReadStateById((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([entryId]) => !succeededIdSet.has(entryId)),
          ),
        );
      }
    } finally {
      setDeletingEntryIds((current) => {
        const next = { ...current };
        targetIds.forEach((entryId) => {
          delete next[entryId];
        });
        return next;
      });
    }
  };

  const togglePreviewAndSelectThread = (entry: SessionRadarEntry) => {
    markEntryAsRead(entry);
    setPreviewExpandedById((current) => {
      const nextExpanded = !current[entry.id];
      return { ...current, [entry.id]: nextExpanded };
    });
    onSelectThread(entry.workspaceId, entry.threadId);
  };

  const handleDeleteRecentEntry = (event: MouseEvent<HTMLButtonElement>, entry: SessionRadarEntry) => {
    event.preventDefault();
    event.stopPropagation();
    deleteRecentEntries([entry]);
  };

  const handleDeleteDateGroupEntries = (
    event: MouseEvent<HTMLButtonElement>,
    groupEntries: SessionRadarEntry[],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    deleteRecentEntries(groupEntries);
  };

  const handleRecentRowActionsClick = (event: MouseEvent<HTMLSpanElement>, entry: SessionRadarEntry) => {
    const clickTarget = event.target as HTMLElement | null;
    if (clickTarget?.closest(".session-activity-radar-delete-icon-button")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    togglePreviewAndSelectThread(entry);
  };

  const renderSection = (
    sectionTitle: string,
    emptyCopyKey: "activityPanel.radar.emptyRunning" | "activityPanel.radar.emptyRecent",
    entries: SessionRadarEntry[],
  ) => (
    <section className="session-activity-radar-section flex flex-col gap-2">
      <header className="session-activity-radar-section-header inline-flex items-center justify-between text-[11px] font-bold text-(--text-muted) tracking-[0.015em]">
        <span>{sectionTitle}</span>
      </header>
      {entries.length === 0 ? (
        <div className="session-activity-radar-empty text-[12px] text-(--text-faint) py-2 px-0.5">{t(emptyCopyKey)}</div>
      ) : (
        <div className="session-activity-radar-list flex flex-col gap-1.5">
          {entries.map((entry) => {
            const completedAt = entry.completedAt ?? entry.updatedAt;
            const readAt = readStateById[entry.id] ?? 0;
            const isUnreadRecent = !entry.isProcessing && completedAt > readAt;
            const isPreviewExpanded = Boolean(previewExpandedById[entry.id]);
            return (
              <button
                key={entry.id}
                type="button"
                className={`session-activity-radar-row relative w-full flex items-start gap-0 border rounded-lg [background:color-mix(in_srgb,var(--surface-card)_64%,transparent)] text-(--text-strong) py-2 px-[9px] text-left ${
                  entry.isProcessing
                    ? "is-running border-[color-mix(in_srgb,#10b981_38%,var(--border-subtle))]"
                    : "border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)]"
                } hover:border-[color-mix(in_srgb,var(--border-strong)_64%,transparent)] hover:[background:color-mix(in_srgb,var(--surface-hover)_72%,transparent)]${
                  isUnreadRecent ? " is-unread border-[color-mix(in_srgb,var(--status-info,#3b82f6)_48%,var(--border-subtle))] [box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--status-info,#3b82f6)_24%,transparent)]" : ""
                }${isPreviewExpanded ? " is-preview-expanded" : ""}`}
                onClick={() => togglePreviewAndSelectThread(entry)}
                aria-expanded={previewExpandedById[entry.id] ? true : false}
                aria-label={entry.threadName}
              >
                {!entry.isProcessing ? (
                  <span
                    className={`session-activity-radar-corner-badge absolute top-2 right-2 min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center text-[11px] font-bold leading-none tracking-[0.01em] ${
                      isUnreadRecent
                        ? "is-unread text-[color-mix(in_srgb,#fb923c_82%,#ffffff)] bg-[color-mix(in_srgb,#fb923c_30%,transparent)] border-none [box-shadow:0_0_0_0_color-mix(in_srgb,#fb923c_0%,transparent)] [animation:session-radar-unread-breathe_1.95s_ease-in-out_infinite,session-radar-unread-flash_1.15s_steps(2,end)_infinite] [&_svg]:[animation:session-radar-unread-icon-breathe_1.95s_ease-in-out_infinite] motion-reduce:animate-none motion-reduce:[&_svg]:animate-none [:root[data-theme=light]_&]:text-[#1d4ed8] [:root[data-theme=light]_&]:bg-[color-mix(in_srgb,#2563eb_22%,#ffffff)] [:root[data-theme=light]_&]:border-transparent"
                        : "is-read text-[color-mix(in_srgb,#34d399_80%,#ffffff)] bg-transparent border-none shadow-none [:root[data-theme=light]_&]:text-[#047857]"
                    }`}
                    aria-label={
                      isUnreadRecent
                        ? t("activityPanel.radar.unreadMark")
                        : t("activityPanel.radar.readMark")
                    }
                    title={
                      isUnreadRecent
                        ? t("activityPanel.radar.unreadMark")
                        : t("activityPanel.radar.readMark")
                    }
                  >
                    {renderReadMarkerIcon(isUnreadRecent)}
                  </span>
                ) : null}
                <span className={`session-activity-radar-row-main min-w-0 flex-1 grid ${isPreviewExpanded ? "grid-rows-[auto_1fr] gap-y-0.5" : "grid-rows-[auto_0fr] gap-y-0"} transition-[grid-template-rows,row-gap] duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)]`}>
                  <span className="session-activity-radar-row-meta-line block min-w-0 pr-[34px] whitespace-nowrap overflow-hidden text-ellipsis text-[10px] text-(--text-muted) [&>span]:mr-2 [&>span]:align-middle [&>span:last-child]:mr-0">
                    <span
                      className={`session-activity-radar-engine-icon w-4 h-4 inline-flex items-center justify-center text-(--text-faint)${
                        entry.isProcessing ? " is-running !text-[#10b981] [animation:session-radar-engine-spin_0.95s_linear_infinite]" : ""
                      }`}
                      aria-label={entry.engine}
                      title={entry.engine}
                    >
                      <EngineIcon engine={resolveEngine(entry)} size={13} />
                    </span>
                    <span
                      className="session-activity-radar-workspace font-[760] text-[12px] leading-[1.2]"
                      style={{ color: resolveWorkspaceAccent(entry.workspaceId || entry.workspaceName) }}
                    >
                      {entry.workspaceName}
                    </span>
                    <span>
                      {t("activityPanel.radar.startedAt")}{" "}
                      {entry.startedAt ? formatActivityTime(entry.startedAt) : t("activityPanel.radar.timeUnknown")}
                    </span>
                    {!entry.isProcessing ? (
                      <>
                        <span>
                          {t("activityPanel.radar.endedAt")}{" "}
                          {entry.completedAt ? formatActivityTime(entry.completedAt) : t("activityPanel.status.running")}
                        </span>
                        <span>
                          {t("activityPanel.radar.totalDuration")}{" "}
                          <span
                            className={`session-activity-radar-duration font-[680] ${resolveDurationToneClass(entry.durationMs)} ${resolveDurationToneTailwind(entry.durationMs)}`}
                          >
                            {formatDuration(entry.durationMs, t)}
                          </span>
                        </span>
                      </>
                    ) : null}
                  </span>
                  <span className={`session-activity-radar-row-preview text-[11px] text-(--text-faint) pl-[22px] whitespace-pre-wrap [overflow-wrap:anywhere] break-words overflow-hidden min-h-0 [scrollbar-gutter:stable] transition-[opacity,transform] duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
                    isPreviewExpanded
                      ? "max-h-[min(42vh,420px)] overflow-y-auto opacity-100 translate-y-0"
                      : "max-h-none opacity-0 -translate-y-1"
                  }`}>
                    {entry.preview || t("activityPanel.commandPendingSummary")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );

  const renderRecentSection = (
    sectionTitle: string,
    entries: SessionRadarEntry[],
  ) => {
    const groups = new Map<string, SessionRadarEntry[]>();
    for (const entry of entries) {
      const dateKey = formatDateKey(entry.completedAt ?? entry.updatedAt);
      const existing = groups.get(dateKey);
      if (existing) {
        existing.push(entry);
      } else {
        groups.set(dateKey, [entry]);
      }
    }
    const groupEntries = Array.from(groups.entries()).sort((left, right) =>
      right[0].localeCompare(left[0]),
    );

    return (
      <section className="session-activity-radar-section flex flex-col gap-2">
        <header className="session-activity-radar-section-header inline-flex items-center justify-between text-[11px] font-bold text-(--text-muted) tracking-[0.015em]">
          <span>{sectionTitle}</span>
        </header>
        {entries.length === 0 ? (
          <div className="session-activity-radar-empty text-[12px] text-(--text-faint) py-2 px-0.5">{t("activityPanel.radar.emptyRecent")}</div>
        ) : (
          <div className="session-activity-radar-list flex flex-col gap-1.5">
            {groupEntries.map(([dateKey, group]) => {
              const isCollapsed = collapsedDateGroups[dateKey] ?? true;
              const isDeletingDateGroup = group.some((entry) => Boolean(deletingEntryIds[entry.id]));
              const deleteDateGroupLabel = t("activityPanel.radar.deleteDateGroupEntries", {
                date: dateKey,
                count: group.length,
              });
              return (
                <div key={dateKey} className="session-activity-radar-date-group flex flex-col gap-2">
                  <div className="session-activity-radar-date-group-header relative">
                    <button
                      type="button"
                      className="session-activity-radar-date-toggle w-full min-h-9 border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] rounded-xl [background:color-mix(in_srgb,var(--surface-card)_66%,transparent)] text-(--text-strong) pr-[42px] pl-3 inline-flex items-center justify-between hover:[background:color-mix(in_srgb,var(--surface-hover)_72%,transparent)] hover:border-[color-mix(in_srgb,var(--border-strong)_64%,transparent)]"
                      onClick={() => {
                        setCollapsedDateGroups((current) => {
                          const next = { ...current, [dateKey]: !isCollapsed };
                          writeClientStoreValue(
                            RADAR_STORE_NAME,
                            SESSION_RADAR_COLLAPSED_DATE_GROUPS_KEY,
                            next,
                            { immediate: true },
                          );
                          if (!isCollapsed) {
                            setPreviewExpandedById((expandedCurrent) => {
                              const expandedNext = { ...expandedCurrent };
                              for (const entry of group) {
                                delete expandedNext[entry.id];
                              }
                              return expandedNext;
                            });
                          }
                          return next;
                        })
                      }}
                    >
                      <span className="session-activity-radar-date-toggle-left inline-flex items-center gap-2 text-[12px] font-bold">
                        <CalendarDays size={14} aria-hidden />
                        {isCollapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                        <span>{dateKey}</span>
                      </span>
                      <span className="session-activity-radar-date-toggle-count min-w-0 h-auto p-0 rounded-none inline-flex items-center justify-end text-right text-[12px] font-bold text-(--text-muted) bg-transparent border-none">{group.length}</span>
                    </button>
                    <RadarDeleteIconButton
                      className="session-activity-radar-date-group-delete-button is-date-group"
                      onClick={(event) => handleDeleteDateGroupEntries(event, group)}
                      ariaLabel={deleteDateGroupLabel}
                      title={deleteDateGroupLabel}
                      disabled={isDeletingDateGroup}
                      iconSize={12}
                    />
                  </div>
                  {!isCollapsed ? (
                    <div className="session-activity-radar-date-group-list flex flex-col gap-1.5">
                      {group.map((entry) => {
                        const completedAt = entry.completedAt ?? entry.updatedAt;
                        const readAt = readStateById[entry.id] ?? 0;
                        const isUnreadRecent = completedAt > readAt;
                        const showDeleteAction = !isUnreadRecent;
                        const isDeletingRecentEntry = Boolean(deletingEntryIds[entry.id]);
                        const isPreviewExpanded = Boolean(previewExpandedById[entry.id]);
                        return (
                          <div key={entry.id} className="session-activity-radar-row-shell relative">
                            <button
                              type="button"
                              className={`session-activity-radar-row relative w-full flex items-start gap-0 border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] rounded-lg [background:color-mix(in_srgb,var(--surface-card)_64%,transparent)] text-(--text-strong) py-2 px-[9px] text-left hover:border-[color-mix(in_srgb,var(--border-strong)_64%,transparent)] hover:[background:color-mix(in_srgb,var(--surface-hover)_72%,transparent)]${showDeleteAction ? " has-delete-action [&_.session-activity-radar-row-meta-line]:pr-[82px]" : ""}${isUnreadRecent ? " is-unread border-[color-mix(in_srgb,var(--status-info,#3b82f6)_48%,var(--border-subtle))] [box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--status-info,#3b82f6)_24%,transparent)]" : ""}${
                                isPreviewExpanded ? " is-preview-expanded" : ""
                              }`}
                              onClick={() => togglePreviewAndSelectThread(entry)}
                              aria-expanded={previewExpandedById[entry.id] ? true : false}
                              aria-label={entry.threadName}
                            >
                              <span className={`session-activity-radar-row-main min-w-0 flex-1 grid ${isPreviewExpanded ? "grid-rows-[auto_1fr] gap-y-0.5" : "grid-rows-[auto_0fr] gap-y-0"} transition-[grid-template-rows,row-gap] duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)]`}>
                                <span className="session-activity-radar-row-meta-line block min-w-0 pr-[34px] whitespace-nowrap overflow-hidden text-ellipsis text-[10px] text-(--text-muted) [&>span]:mr-2 [&>span]:align-middle [&>span:last-child]:mr-0">
                                  <span
                                    className="session-activity-radar-engine-icon w-4 h-4 inline-flex items-center justify-center text-(--text-faint)"
                                    aria-label={entry.engine}
                                    title={entry.engine}
                                  >
                                    <EngineIcon engine={resolveEngine(entry)} size={13} />
                                  </span>
                                  <span
                                    className="session-activity-radar-workspace font-[760] text-[12px] leading-[1.2]"
                                    style={{ color: resolveWorkspaceAccent(entry.workspaceId || entry.workspaceName) }}
                                  >
                                    {entry.workspaceName}
                                  </span>
                                  <span>
                                    {t("activityPanel.radar.startedAt")}{" "}
                                    {entry.startedAt
                                      ? formatActivityTime(entry.startedAt)
                                      : t("activityPanel.radar.timeUnknown")}
                                  </span>
                                  <span>
                                    {t("activityPanel.radar.endedAt")}{" "}
                                    {entry.completedAt
                                      ? formatActivityTime(entry.completedAt)
                                      : t("activityPanel.status.running")}
                                  </span>
                                  <span>
                                    {t("activityPanel.radar.totalDuration")}{" "}
                                    <span
                                      className={`session-activity-radar-duration font-[680] ${resolveDurationToneClass(entry.durationMs)} ${resolveDurationToneTailwind(entry.durationMs)}`}
                                    >
                                      {formatDuration(entry.durationMs, t)}
                                    </span>
                                  </span>
                                </span>
                                <span className={`session-activity-radar-row-preview text-[11px] text-(--text-faint) pl-[22px] whitespace-pre-wrap [overflow-wrap:anywhere] break-words overflow-hidden min-h-0 [scrollbar-gutter:stable] transition-[opacity,transform] duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
                                  isPreviewExpanded
                                    ? "max-h-[min(42vh,420px)] overflow-y-auto opacity-100 translate-y-0"
                                    : "max-h-none opacity-0 -translate-y-1"
                                }`}>
                                  {entry.preview || t("activityPanel.commandPendingSummary")}
                                </span>
                              </span>
                            </button>
                            <span
                              className="session-activity-radar-row-actions absolute top-2 right-2 inline-flex items-center gap-1.5 [&_.session-activity-radar-corner-badge]:!static"
                              onClick={(event) => handleRecentRowActionsClick(event, entry)}
                            >
                              <span
                                className={`session-activity-radar-corner-badge min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center text-[11px] font-bold leading-none tracking-[0.01em] ${
                                  isUnreadRecent
                                    ? "is-unread text-[color-mix(in_srgb,#fb923c_82%,#ffffff)] bg-[color-mix(in_srgb,#fb923c_30%,transparent)] border-none [box-shadow:0_0_0_0_color-mix(in_srgb,#fb923c_0%,transparent)] [animation:session-radar-unread-breathe_1.95s_ease-in-out_infinite,session-radar-unread-flash_1.15s_steps(2,end)_infinite] [&_svg]:[animation:session-radar-unread-icon-breathe_1.95s_ease-in-out_infinite] motion-reduce:animate-none motion-reduce:[&_svg]:animate-none [:root[data-theme=light]_&]:text-[#1d4ed8] [:root[data-theme=light]_&]:bg-[color-mix(in_srgb,#2563eb_22%,#ffffff)] [:root[data-theme=light]_&]:border-transparent"
                                    : "is-read text-[color-mix(in_srgb,#34d399_80%,#ffffff)] bg-transparent border-none shadow-none [:root[data-theme=light]_&]:text-[#047857]"
                                }`}
                                aria-label={
                                  isUnreadRecent
                                    ? t("activityPanel.radar.unreadMark")
                                    : t("activityPanel.radar.readMark")
                                }
                                title={
                                  isUnreadRecent
                                    ? t("activityPanel.radar.unreadMark")
                                    : t("activityPanel.radar.readMark")
                                }
                              >
                                {renderReadMarkerIcon(isUnreadRecent)}
                              </span>
                              {showDeleteAction ? (
                                <RadarDeleteIconButton
                                  className="session-activity-radar-delete-button is-entry"
                                  onClick={(event) => handleDeleteRecentEntry(event, entry)}
                                  ariaLabel={t("activityPanel.radar.deleteHistoryEntry", { name: entry.threadName })}
                                  title={t("activityPanel.radar.deleteHistoryEntry", { name: entry.threadName })}
                                  disabled={isDeletingRecentEntry}
                                  iconSize={11}
                                />
                              ) : null}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="session-activity-panel flex flex-col min-h-0 h-full bg-(--surface-right-panel) [background:color-mix(in_srgb,var(--surface-right-panel,transparent)_92%,transparent)]">
      <div className="session-activity-header relative z-[2] overflow-visible flex items-center justify-between gap-3 px-3.5 pt-3 pb-2.5 border-b border-border">
        <div className="session-activity-title-group flex items-center gap-3.5 flex-[1_1_auto] min-w-0 overflow-visible">
          <div className="session-activity-heading-row relative flex items-center gap-2.5 min-w-0 overflow-visible">
            <div className="session-activity-title-row inline-flex items-center gap-2 text-[13px] font-semibold text-(--text-strong)">
              <span>{t("activityPanel.radar.modeWorkspaceRadar")}</span>
            </div>
          </div>
        </div>
        <div className="session-activity-summary inline-flex items-center justify-end flex-[0_1_auto] min-w-0 max-w-full text-[11px] text-(--text-muted) [font-variant-numeric:tabular-nums] whitespace-nowrap overflow-hidden text-ellipsis">{headerSummary}</div>
      </div>
      <div className="session-activity-radar flex flex-col gap-3.5 px-3.5 pt-3 pb-4 overflow-y-auto">
        {renderSection(
          t("activityPanel.radar.runningSection", { count: runningSessions.length }),
          "activityPanel.radar.emptyRunning",
          runningSessions,
        )}
        {renderRecentSection(
          t("activityPanel.radar.recentSection", { count: recentCompletedSessions.length }),
          recentCompletedSessions,
        )}
      </div>
    </div>
  );
}
