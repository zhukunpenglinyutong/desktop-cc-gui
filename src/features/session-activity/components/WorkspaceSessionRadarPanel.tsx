import BellDot from "lucide-react/dist/esm/icons/bell-dot";
import CheckCheck from "lucide-react/dist/esm/icons/check-check";
import CalendarDays from "lucide-react/dist/esm/icons/calendar-days";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SessionRadarEntry } from "../hooks/useSessionRadarFeed";
import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";
import { EngineIcon } from "../../engine/components/EngineIcon";

type WorkspaceSessionRadarPanelProps = {
  runningSessions: SessionRadarEntry[];
  recentCompletedSessions: SessionRadarEntry[];
  onSelectThread: (workspaceId: string, threadId: string) => void;
};

const RADAR_READ_STATE_KEY = "sessionRadar.readStateById";
const RADAR_DATE_COLLAPSE_STATE_KEY = "sessionRadar.collapsedDateGroups";
const RADAR_STORE_NAME = "leida";

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

function formatDateKey(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function WorkspaceSessionRadarPanel({
  runningSessions,
  recentCompletedSessions,
  onSelectThread,
}: WorkspaceSessionRadarPanelProps) {
  const { t } = useTranslation();
  const [readStateById, setReadStateById] = useState<Record<string, number>>(
    () => getClientStoreSync<Record<string, number>>(RADAR_STORE_NAME, RADAR_READ_STATE_KEY) ?? {},
  );
  const [collapsedDateGroups, setCollapsedDateGroups] = useState<Record<string, boolean>>(
    () =>
      getClientStoreSync<Record<string, boolean>>(RADAR_STORE_NAME, RADAR_DATE_COLLAPSE_STATE_KEY) ??
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
      writeClientStoreValue(RADAR_STORE_NAME, RADAR_READ_STATE_KEY, next, { immediate: true });
      return next;
    });
  };

  const resolveEngine = (entry: SessionRadarEntry): "codex" | "claude" | "opencode" => {
    const normalizedEngine = entry.engine.toUpperCase();
    if (normalizedEngine === "CLAUDE") {
      return "claude";
    }
    if (normalizedEngine === "OPENCODE") {
      return "opencode";
    }
    return "codex";
  };

  const renderReadMarkerIcon = (isUnreadRecent: boolean) =>
    isUnreadRecent ? <BellDot size={11} aria-hidden /> : <CheckCheck size={11} aria-hidden />;

  const renderSection = (
    sectionTitle: string,
    emptyCopyKey: "activityPanel.radar.emptyRunning" | "activityPanel.radar.emptyRecent",
    entries: SessionRadarEntry[],
  ) => (
    <section className="session-activity-radar-section">
      <header className="session-activity-radar-section-header">
        <span>{sectionTitle}</span>
      </header>
      {entries.length === 0 ? (
        <div className="session-activity-radar-empty">{t(emptyCopyKey)}</div>
      ) : (
        <div className="session-activity-radar-list">
          {entries.map((entry) => {
            const completedAt = entry.completedAt ?? entry.updatedAt;
            const readAt = readStateById[entry.id] ?? 0;
            const isUnreadRecent = !entry.isProcessing && completedAt > readAt;
            return (
              <button
                key={entry.id}
                type="button"
                className={`session-activity-radar-row${entry.isProcessing ? " is-running" : ""}${
                  isUnreadRecent ? " is-unread" : ""
                }`}
                onClick={() => {
                  markEntryAsRead(entry);
                  onSelectThread(entry.workspaceId, entry.threadId);
                }}
                title={entry.threadName}
              >
                {!entry.isProcessing ? (
                  <span
                    className={`session-activity-radar-corner-badge${
                      isUnreadRecent ? " is-unread" : " is-read"
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
                <span className="session-activity-radar-row-main">
                  <span className="session-activity-radar-row-meta-line">
                    <span
                      className={`session-activity-radar-engine-icon${
                        entry.isProcessing ? " is-running" : ""
                      }`}
                      aria-label={entry.engine}
                      title={entry.engine}
                    >
                      <EngineIcon engine={resolveEngine(entry)} size={13} />
                    </span>
                    <span className="session-activity-radar-workspace">{entry.workspaceName}</span>
                    <span>
                      {t("activityPanel.radar.startedAt")}{" "}
                      {entry.startedAt ? formatActivityTime(entry.startedAt) : t("activityPanel.radar.timeUnknown")}
                    </span>
                    <span>
                      {t("activityPanel.radar.endedAt")}{" "}
                      {entry.completedAt ? formatActivityTime(entry.completedAt) : t("activityPanel.status.running")}
                    </span>
                    <span>
                      {t("activityPanel.radar.totalDuration")} {formatDuration(entry.durationMs, t)}
                    </span>
                  </span>
                  <span className="session-activity-radar-row-title">{entry.threadName}</span>
                  <span className="session-activity-radar-row-preview">
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
      <section className="session-activity-radar-section">
        <header className="session-activity-radar-section-header">
          <span>{sectionTitle}</span>
        </header>
        {entries.length === 0 ? (
          <div className="session-activity-radar-empty">{t("activityPanel.radar.emptyRecent")}</div>
        ) : (
          <div className="session-activity-radar-list">
            {groupEntries.map(([dateKey, group]) => {
              const isCollapsed = collapsedDateGroups[dateKey] ?? true;
              return (
                <div key={dateKey} className="session-activity-radar-date-group">
                  <button
                    type="button"
                    className="session-activity-radar-date-toggle"
                    onClick={() => {
                      setCollapsedDateGroups((current) => {
                        const next = { ...current, [dateKey]: !isCollapsed };
                        writeClientStoreValue(
                          RADAR_STORE_NAME,
                          RADAR_DATE_COLLAPSE_STATE_KEY,
                          next,
                          { immediate: true },
                        );
                        return next;
                      })
                    }}
                  >
                    <span className="session-activity-radar-date-toggle-left">
                      <CalendarDays size={14} aria-hidden />
                      {isCollapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                      <span>{dateKey}</span>
                    </span>
                    <span className="session-activity-radar-date-toggle-count">{group.length}</span>
                  </button>
                  {!isCollapsed ? (
                    <div className="session-activity-radar-date-group-list">
                      {group.map((entry) => {
                        const completedAt = entry.completedAt ?? entry.updatedAt;
                        const readAt = readStateById[entry.id] ?? 0;
                        const isUnreadRecent = completedAt > readAt;
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            className={`session-activity-radar-row${isUnreadRecent ? " is-unread" : ""}`}
                            onClick={() => {
                              markEntryAsRead(entry);
                              onSelectThread(entry.workspaceId, entry.threadId);
                            }}
                            title={entry.threadName}
                          >
                            <span
                              className={`session-activity-radar-corner-badge${
                                isUnreadRecent ? " is-unread" : " is-read"
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
                            <span className="session-activity-radar-row-main">
                              <span className="session-activity-radar-row-meta-line">
                                <span
                                  className="session-activity-radar-engine-icon"
                                  aria-label={entry.engine}
                                  title={entry.engine}
                                >
                                  <EngineIcon engine={resolveEngine(entry)} size={13} />
                                </span>
                                <span className="session-activity-radar-workspace">{entry.workspaceName}</span>
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
                                  {t("activityPanel.radar.totalDuration")} {formatDuration(entry.durationMs, t)}
                                </span>
                              </span>
                              <span className="session-activity-radar-row-title">{entry.threadName}</span>
                              <span className="session-activity-radar-row-preview">
                                {entry.preview || t("activityPanel.commandPendingSummary")}
                              </span>
                            </span>
                          </button>
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
    <div className="session-activity-panel">
      <div className="session-activity-header">
        <div className="session-activity-title-group">
          <div className="session-activity-heading-row">
            <div className="session-activity-title-row">
              <span>{t("activityPanel.radar.modeWorkspaceRadar")}</span>
            </div>
          </div>
        </div>
        <div className="session-activity-summary">{headerSummary}</div>
      </div>
      <div className="session-activity-radar">
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
