import { useTranslation } from "react-i18next";

interface PlaceholderSectionProps {
  type: "usage" | "mcp" | "permissions" | "skills";
}

const iconMap: Record<PlaceholderSectionProps["type"], string> = {
  usage: "codicon-graph",
  mcp: "codicon-server",
  permissions: "codicon-shield",
  skills: "codicon-book",
};

export function PlaceholderSection({ type }: PlaceholderSectionProps) {
  const { t } = useTranslation();

  const title = t(`settings.placeholder.${type}.title`);
  const desc = t(`settings.placeholder.${type}.desc`);
  const icon = iconMap[type];

  return (
    <section className="settings-section">
      <div className="settings-section-title text-[15px] font-semibold text-(--text-strong) mb-1">{title}</div>
      <div className="settings-section-subtitle text-xs text-(--text-subtle) mb-4">{desc}</div>
      <div className="settings-placeholder-notice">
        <span className={`codicon ${icon}`} />
        <p>{t("settings.placeholder.comingSoon")}</p>
      </div>
    </section>
  );
}
