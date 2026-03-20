import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { EngineIcon } from "../../engine/components/EngineIcon";
import type { EngineType } from "../../../types";
import type { SessionRadarEntry } from "../../session-activity/hooks/useSessionRadarFeed";
import type {
  SessionRadarHistoryDeleteFailure,
  SessionRadarHistoryDeleteResult,
} from "../../session-activity/utils/sessionRadarHistoryManagement";

type SessionRadarHistoryManagementSectionProps = {
  entries: SessionRadarEntry[];
  onDeleteEntries: (entries: SessionRadarEntry[]) => Promise<SessionRadarHistoryDeleteResult>;
};

type NoticeState =
  | { kind: "success"; text: string }
  | { kind: "error"; text: string }
  | null;

function resolveEngineType(engine: string | undefined): EngineType {
  const normalized = engine?.trim().toLowerCase();
  if (normalized === "claude") {
    return "claude";
  }
  if (normalized === "opencode") {
    return "opencode";
  }
  return "codex";
}

function formatUpdatedAtDisplay(updatedAt: number, locale: string) {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  const now = new Date();
  const sameYear = now.getFullYear() === date.getFullYear();
  return new Intl.DateTimeFormat(locale || undefined, {
    year: sameYear ? undefined : "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function resolveFailureMessage(
  failure: SessionRadarHistoryDeleteFailure | undefined,
  t: (key: string) => string,
) {
  if (!failure) {
    return t("settings.radarHistoryDeleteUnknownReason");
  }
  if (failure.code === "NOT_FOUND") {
    return t("settings.radarHistoryDeleteNotFound");
  }
  return failure.message?.trim() || t("settings.radarHistoryDeleteUnknownReason");
}

export function SessionRadarHistoryManagementSection({
  entries,
  onDeleteEntries,
}: SessionRadarHistoryManagementSectionProps) {
  const { t, i18n } = useTranslation();
  const [selectedIds, setSelectedIds] = useState<Record<string, true>>({});
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [expanded, setExpanded] = useState(true);

  const orderedEntries = useMemo(
    () => [...entries].sort((left, right) => (right.completedAt ?? right.updatedAt) - (left.completedAt ?? left.updatedAt)),
    [entries],
  );
  const selectedCount = useMemo(() => Object.keys(selectedIds).length, [selectedIds]);
  const allSelected =
    orderedEntries.length > 0 && orderedEntries.every((entry) => Boolean(selectedIds[entry.id]));

  const clearSelection = useCallback(() => {
    setSelectedIds({});
    setDeleteArmed(false);
  }, []);

  const selectAll = useCallback(() => {
    if (isDeleting) {
      return;
    }
    const next: Record<string, true> = {};
    orderedEntries.forEach((entry) => {
      next[entry.id] = true;
    });
    setSelectedIds(next);
    setDeleteArmed(false);
  }, [isDeleting, orderedEntries]);

  const toggleSelection = useCallback(
    (entryId: string) => {
      if (isDeleting) {
        return;
      }
      setSelectedIds((previous) => {
        if (previous[entryId]) {
          const { [entryId]: _unused, ...rest } = previous;
          return rest;
        }
        return {
          ...previous,
          [entryId]: true,
        };
      });
      setDeleteArmed(false);
    },
    [isDeleting],
  );

  const handleDeleteSelected = useCallback(async () => {
    if (isDeleting || selectedCount === 0) {
      return;
    }
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }

    const selectedEntries = orderedEntries.filter((entry) => selectedIds[entry.id]);
    if (selectedEntries.length === 0) {
      setDeleteArmed(false);
      return;
    }

    setIsDeleting(true);
    setNotice(null);
    try {
      const result = await onDeleteEntries(selectedEntries);
      if (result.failed.length === 0) {
        setSelectedIds({});
        setNotice({
          kind: "success",
          text: t("settings.radarHistoryDeleteSuccess", {
            count: result.succeededEntryIds.length,
          }),
        });
      } else {
        const failedOnly: Record<string, true> = {};
        result.failed.forEach((entry) => {
          failedOnly[entry.id] = true;
        });
        setSelectedIds(failedOnly);
        setNotice({
          kind: "error",
          text: `${t("settings.radarHistoryDeletePartial", {
            succeeded: result.succeededEntryIds.length,
            failed: result.failed.length,
          })} ${resolveFailureMessage(result.failed[0], t)}`,
        });
      }
      setDeleteArmed(false);
    } finally {
      setIsDeleting(false);
    }
  }, [deleteArmed, isDeleting, onDeleteEntries, orderedEntries, selectedCount, selectedIds, t]);

  const deleteLabel = isDeleting
    ? t("settings.radarHistoryDeleting")
    : deleteArmed
      ? t("settings.radarHistoryConfirmDeleteSelected", { count: selectedCount })
      : t("settings.radarHistoryDeleteSelected");

  return (
    <section
      className={`settings-project-sessions${expanded ? " is-open" : ""}`}
      data-testid="settings-radar-history-management"
    >
      <button
        type="button"
        className={`settings-project-sessions-expand-btn${expanded ? " is-open" : ""}`}
        onClick={() => setExpanded((previous) => !previous)}
        aria-expanded={expanded}
        data-testid="settings-radar-history-expand-toggle"
      >
        {expanded ? (
          <ChevronDown className="settings-project-sessions-expand-icon" size={14} aria-hidden />
        ) : (
          <ChevronRight className="settings-project-sessions-expand-icon" size={14} aria-hidden />
        )}
        <span className="settings-project-sessions-expand-label">
          {t("settings.radarHistoryTitle")}
        </span>
        {expanded && orderedEntries.length > 0 && (
          <span className="settings-project-sessions-expand-count">({orderedEntries.length})</span>
        )}
      </button>

      {expanded ? (
        <>
          <div className="settings-project-sessions-header">
            <div className="settings-project-sessions-title-wrap">
              <p>{t("settings.radarHistoryDescription")}</p>
            </div>
          </div>

          <div className="settings-project-sessions-toolbar">
            <span className="settings-project-sessions-selected">
              {t("settings.radarHistorySelectedCount", { count: selectedCount })}
            </span>
            <button
              type="button"
              className="settings-project-sessions-btn"
              onClick={selectAll}
              disabled={allSelected || orderedEntries.length === 0 || isDeleting}
            >
              <span className="codicon codicon-check-all" aria-hidden />
              {t("settings.radarHistorySelectAll")}
            </button>
            <button
              type="button"
              className="settings-project-sessions-btn"
              onClick={clearSelection}
              disabled={selectedCount === 0 || isDeleting}
            >
              <span className="codicon codicon-clear-all" aria-hidden />
              {t("settings.radarHistoryClearSelection")}
            </button>
            <button
              type="button"
              className="settings-project-sessions-btn is-danger"
              onClick={() => {
                void handleDeleteSelected();
              }}
              disabled={selectedCount === 0 || isDeleting}
              data-testid="settings-radar-history-delete-selected"
            >
              <span className="codicon codicon-trash" aria-hidden />
              {deleteLabel}
            </button>
            <button
              type="button"
              className="settings-project-sessions-btn"
              onClick={() => {
                setDeleteArmed(false);
                setNotice(null);
              }}
              disabled={!deleteArmed || isDeleting}
            >
              <span className="codicon codicon-close" aria-hidden />
              {t("settings.radarHistoryCancelDelete")}
            </button>
          </div>

          {notice && (
            <div
              className={`settings-project-sessions-notice is-${notice.kind}`}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              {notice.text}
            </div>
          )}

          {orderedEntries.length === 0 ? (
            <div className="settings-project-sessions-empty">{t("settings.radarHistoryEmpty")}</div>
          ) : (
            <ul className="settings-project-sessions-list">
              {orderedEntries.map((entry) => {
                const selected = Boolean(selectedIds[entry.id]);
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={`settings-project-sessions-item${selected ? " is-selected" : ""}`}
                      onClick={() => toggleSelection(entry.id)}
                      aria-pressed={selected}
                      disabled={isDeleting}
                    >
                      <span className="settings-project-sessions-item-engine" aria-hidden>
                        <EngineIcon engine={resolveEngineType(entry.engine)} size={14} />
                      </span>
                      <span className="settings-project-sessions-item-content">
                        <span className="settings-project-sessions-item-title">
                          {entry.threadName?.trim() || t("settings.projectSessionItemUntitled")}
                        </span>
                        <span className="settings-project-sessions-item-meta">
                          {entry.workspaceName} · {formatUpdatedAtDisplay(entry.completedAt ?? entry.updatedAt, i18n.language)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
