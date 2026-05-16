import type { ReactNode } from "react";
import FolderKanban from "lucide-react/dist/esm/icons/folder-kanban";
import FileText from "lucide-react/dist/esm/icons/file-text";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import MessagesSquare from "lucide-react/dist/esm/icons/messages-square";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type TabKey = "projects" | "codex" | "spec" | "git" | "log";

type TabBarProps = {
  activeTab: TabKey;
  onSelect: (tab: TabKey) => void;
};

export function TabBar({ activeTab, onSelect }: TabBarProps) {
  const { t } = useTranslation();

  const iconClass = "size-[18px]";
  const tabs: { id: TabKey; label: string; icon: ReactNode }[] = [
    { id: "projects", label: t("tabbar.projects"), icon: <FolderKanban className={iconClass} /> },
    { id: "codex", label: t("tabbar.codex"), icon: <MessagesSquare className={iconClass} /> },
    { id: "spec", label: t("tabbar.spec"), icon: <FileText className={iconClass} /> },
    { id: "git", label: t("tabbar.git"), icon: <GitBranch className={iconClass} /> },
    { id: "log", label: t("tabbar.log"), icon: <TerminalSquare className={iconClass} /> },
  ];

  return (
    <nav
      className={cn(
        "tabbar grid grid-cols-4 gap-1.5 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]",
        "border-t border-border bg-card",
        "min-h-14 sm:hidden",
      )}
      aria-label={t("tabbar.primaryNavigation")}
    >
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            className={cn(
              "tabbar-item flex flex-col items-center justify-center gap-1 cursor-pointer",
              "border border-transparent rounded-xl px-1.5 py-2",
              "text-xs font-semibold tracking-tight",
              "transition-colors",
              active
                ? "tabbar-item-active text-foreground bg-secondary border-border"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
            onClick={() => onSelect(tab.id)}
            aria-current={active ? "page" : undefined}
          >
            {tab.icon}
            <span className="tabbar-label inline-flex items-center gap-1.5">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
