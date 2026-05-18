import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { EngineIcon } from "../../../../../engine/components/EngineIcon";
import type { EngineType } from "../../../../../../types";
import type { WorkspaceSessionCatalogEntry } from "../../../../../../services/tauri/sessionManagement";
import { formatUpdatedAt } from "./formatUpdatedAt";

type OrganizationSessionListProps = {
  entries: WorkspaceSessionCatalogEntry[];
  selectedIds: Record<string, true>;
  onToggleSelection: (selectionKey: string) => void;
  onOpenSessionDetail?: (entry: WorkspaceSessionCatalogEntry) => void;
  emptyMessage: string;
  locale: string;
};

function normalizeEngine(engine: string): EngineType {
  if (engine === "claude" || engine === "gemini" || engine === "opencode") {
    return engine;
  }
  return "codex";
}

function buildSelectionKey(entry: WorkspaceSessionCatalogEntry): string {
  return `${entry.workspaceId}::${entry.sessionId}`;
}

export const OrganizationSessionList = memo(function OrganizationSessionList({
  entries,
  selectedIds,
  onToggleSelection,
  onOpenSessionDetail,
  emptyMessage,
  locale,
}: OrganizationSessionListProps) {
  const { t } = useTranslation();
  if (entries.length === 0) {
    return (
      <div
        className="session-organization-session-list-empty"
        data-testid="session-organization-session-list-empty"
      >
        {emptyMessage}
      </div>
    );
  }
  return (
    <ul
      className="session-organization-session-list"
      data-testid="session-organization-session-list"
    >
      {entries.map((entry) => {
        const selectionKey = buildSelectionKey(entry);
        const selected = Boolean(selectedIds[selectionKey]);
        const engineType = normalizeEngine(entry.engine);
        const titleLabel =
          entry.title.trim() || t("settings.projectSessionItemUntitled");
        return (
          <li
            key={selectionKey}
            className={`session-organization-session-list-row${
              selected ? " is-selected" : ""
            }`}
            data-testid={`session-organization-session-list-row-${entry.sessionId}`}
          >
            <input
              type="checkbox"
              className="session-organization-session-list-checkbox"
              checked={selected}
              onChange={() => onToggleSelection(selectionKey)}
              aria-label={t(
                "settings.sessionOrganizationToggleSelectionAria",
                { title: titleLabel },
              )}
              data-testid={`session-organization-session-list-checkbox-${entry.sessionId}`}
            />
            <button
              type="button"
              className="session-organization-session-list-title-button"
              onClick={() => onOpenSessionDetail?.(entry)}
              aria-label={t("settings.sessionOrganizationOpenSessionAria", {
                title: titleLabel,
              })}
              data-testid={`session-organization-session-list-title-${entry.sessionId}`}
            >
              <span
                className="session-organization-session-list-engine"
                aria-hidden
              >
                <EngineIcon engine={engineType} size={14} />
              </span>
              <span className="session-organization-session-list-title">
                {titleLabel}
              </span>
              {entry.archivedAt ? (
                <Badge variant="secondary" size="sm">
                  {t("settings.sessionManagementBadgeArchived")}
                </Badge>
              ) : null}
            </button>
            <span
              className="session-organization-session-list-meta"
              aria-label={t("settings.sessionOrganizationLastUpdatedAria", {
                value: formatUpdatedAt(entry.updatedAt, locale),
              })}
            >
              {formatUpdatedAt(entry.updatedAt, locale)}
            </span>
          </li>
        );
      })}
    </ul>
  );
});
