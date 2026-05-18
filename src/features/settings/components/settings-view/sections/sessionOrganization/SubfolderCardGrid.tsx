import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { FolderProjectionNode } from "./folderProjection";
import { formatUpdatedAt } from "./formatUpdatedAt";

type SubfolderCardGridProps = {
  nodes: FolderProjectionNode[];
  locale: string;
  onSelect: (folderId: string) => void;
};

export const SubfolderCardGrid = memo(function SubfolderCardGrid({
  nodes,
  locale,
  onSelect,
}: SubfolderCardGridProps) {
  const { t } = useTranslation();
  if (nodes.length === 0) {
    return null;
  }
  return (
    <section
      className="session-organization-subfolder-grid"
      data-testid="session-organization-subfolder-grid"
      aria-label={t("settings.sessionOrganizationSubfolderGridLabel")}
    >
      <header className="session-organization-subfolder-grid-header">
        <span className="session-organization-subfolder-grid-title">
          {t("settings.sessionOrganizationSubfolderGridTitle")}
        </span>
        <span className="session-organization-subfolder-grid-count">
          {t("settings.sessionOrganizationSubfolderGridCount", {
            count: nodes.length,
          })}
        </span>
      </header>
      <ul className="session-organization-subfolder-grid-cards" role="list">
        {nodes.map((node) => (
          <li key={node.folder.id} role="listitem">
            <button
              type="button"
              className="session-organization-subfolder-card"
              onClick={() => onSelect(node.folder.id)}
              data-testid={`session-organization-subfolder-card-${node.folder.id}`}
              aria-label={t(
                "settings.sessionOrganizationSubfolderCardAria",
                { name: node.folder.name, count: node.directEntryCount },
              )}
            >
              <span className="session-organization-subfolder-card-name">
                {node.folder.name}
              </span>
              <span className="session-organization-subfolder-card-count">
                {t("settings.sessionOrganizationSubfolderCardCount", {
                  count: node.directEntryCount,
                })}
              </span>
              <span className="session-organization-subfolder-card-time">
                {formatUpdatedAt(node.directLatestUpdatedAt, locale)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
});
