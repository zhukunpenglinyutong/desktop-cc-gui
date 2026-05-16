import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Folder from "lucide-react/dist/esm/icons/folder";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import ScrollText from "lucide-react/dist/esm/icons/scroll-text";
import Brain from "lucide-react/dist/esm/icons/brain";
import Search from "lucide-react/dist/esm/icons/search";
import Activity from "lucide-react/dist/esm/icons/activity";
import LayoutList from "lucide-react/dist/esm/icons/layout-list";
import NotebookPen from "lucide-react/dist/esm/icons/notebook-pen";
import { TooltipIconButton } from "../../../components/ui/tooltip-icon-button";
import { cn } from "@/lib/utils";

export type PanelTabId =
  | "radar"
  | "git"
  | "files"
  | "search"
  | "notes"
  | "prompts"
  | "memory"
  | "activity";

type PanelTab = {
  id: PanelTabId;
  label: string;
  icon: ReactNode;
};

type PanelTabsProps = {
  active: PanelTabId;
  onSelect: (id: PanelTabId) => void;
  tabs?: PanelTab[];
  liveStates?: Partial<Record<PanelTabId, boolean>>;
  visibleTabs?: Partial<Record<PanelTabId, boolean>>;
};

// Toggle to show/hide prompts tab (set to true to re-enable)
const SHOW_PROMPTS_TAB = false;
// Toggle to show/hide git tab
const SHOW_GIT_TAB = true;

const tabIds: PanelTabId[] = (["activity", "radar", "git", "files", "search", "notes", "prompts"] as const).filter(
  (id) =>
    (id !== "prompts" || SHOW_PROMPTS_TAB) &&
    (id !== "git" || SHOW_GIT_TAB)
);

const tabIcons: Record<PanelTabId, ReactNode> = {
  radar: <LayoutList aria-hidden />,
  git: <GitBranch aria-hidden />,
  files: <Folder aria-hidden />,
  search: <Search aria-hidden />,
  notes: <NotebookPen aria-hidden />,
  memory: <Brain aria-hidden />,
  activity: <Activity aria-hidden />,
  prompts: <ScrollText aria-hidden />,
};

const tabI18nKeys: Record<PanelTabId, string> = {
  radar: "panels.radar",
  git: "panels.git",
  files: "panels.files",
  search: "panels.search",
  notes: "panels.notes",
  memory: "panels.memory",
  activity: "panels.activity",
  prompts: "panels.prompts",
};

export function PanelTabs({
  active,
  onSelect,
  tabs,
  liveStates,
  visibleTabs,
}: PanelTabsProps) {
  const { t } = useTranslation();
  const resolvedTabs =
    tabs ??
    tabIds.map((id) => ({
      id,
      label: t(tabI18nKeys[id]),
      icon: tabIcons[id],
    }));
  const visibleResolvedTabs = resolvedTabs.filter(
    (tab) => visibleTabs?.[tab.id] !== false,
  );
  if (visibleResolvedTabs.length === 0) {
    return null;
  }
  return (
    <div
      className={cn(
        "panel-tabs inline-flex items-center gap-2 px-2",
        "border-r border-border",
      )}
      role="tablist"
      aria-label="Panel"
    >
      {visibleResolvedTabs.map((tab) => {
        const isActive = active === tab.id;
        const isLive = Boolean(liveStates?.[tab.id]);
        return (
          <TooltipIconButton
            key={tab.id}
            className={cn(
              "panel-tab relative inline-flex items-center justify-center",
              "min-w-5 min-h-5 p-0.5",
              "border border-transparent rounded-md bg-transparent",
              "transition-[color,opacity] duration-150",
              isActive
                ? "is-active text-foreground border-border"
                : "text-muted-foreground hover:text-foreground",
              isLive && "is-live",
            )}
            onClick={() => onSelect(tab.id)}
            aria-current={isActive ? "page" : undefined}
            data-tauri-drag-region="false"
            label={tab.label}
          >
            <span
              className={cn(
                "panel-tab-icon relative inline-flex items-center [&>svg]:size-[13px] [&>svg]:stroke-[2.2]",
                isLive && "is-live text-[#57d18c] drop-shadow-[0_0_8px_rgba(87,209,140,0.45)]",
              )}
              aria-hidden
            >
              {tab.icon}
            </span>
          </TooltipIconButton>
        );
      })}
    </div>
  );
}
