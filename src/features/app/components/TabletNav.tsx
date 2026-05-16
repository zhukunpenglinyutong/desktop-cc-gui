import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import FileText from "lucide-react/dist/esm/icons/file-text";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import MessagesSquare from "lucide-react/dist/esm/icons/messages-square";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import { cn } from "@/lib/utils";

type TabletNavTab = "codex" | "spec" | "git" | "log";

type TabletNavProps = {
  activeTab: TabletNavTab;
  onSelect: (tab: TabletNavTab) => void;
};

const iconClass = "tablet-nav-icon size-5";

const tabIcons: Record<TabletNavTab, ReactNode> = {
  codex: <MessagesSquare className={iconClass} />,
  spec: <FileText className={iconClass} />,
  git: <GitBranch className={iconClass} />,
  log: <TerminalSquare className={iconClass} />,
};

const tabKeys: TabletNavTab[] = ["codex", "spec", "git", "log"];

const tabI18nKeys: Record<TabletNavTab, string> = {
  codex: "tabbar.codex",
  spec: "tabbar.spec",
  git: "tabbar.git",
  log: "tabbar.log",
};

export function TabletNav({ activeTab, onSelect }: TabletNavProps) {
  const { t } = useTranslation();
  return (
    <nav
      className={cn(
        "tablet-nav flex flex-col items-stretch gap-2.5",
        "px-2 pt-9 pb-4 h-full min-h-0",
        "bg-card border-r border-border",
      )}
      aria-label={t("tabbar.workspaceNavigation")}
    >
      <div className="tablet-nav-group flex flex-col gap-2.5">
        {tabKeys.map((id) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              className={cn(
                "tablet-nav-item flex flex-col items-center gap-1.5 cursor-pointer text-center",
                "border border-transparent rounded-xl px-1.5 py-2.5",
                "text-[11px] font-semibold tracking-tight",
                "transition-colors",
                active
                  ? "tablet-nav-item-active text-foreground bg-secondary border-border"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
              onClick={() => onSelect(id)}
              aria-current={active ? "page" : undefined}
            >
              {tabIcons[id]}
              <span className="tablet-nav-label inline-flex items-center justify-center w-full">
                {t(tabI18nKeys[id])}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
