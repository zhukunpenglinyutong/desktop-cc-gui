import { useTranslation } from "react-i18next";

type ThreadEmptyStateProps = {
  nested?: boolean;
};

export function ThreadEmptyState({ nested = false }: ThreadEmptyStateProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`thread-empty-state${nested ? " thread-empty-state-nested" : ""}`}
      role="status"
      aria-live="polite"
    >
      {t("sidebar.emptyWorkspaceSessions")}
    </div>
  );
}
