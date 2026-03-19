import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Folder from "lucide-react/dist/esm/icons/folder";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import ScrollText from "lucide-react/dist/esm/icons/scroll-text";
import Brain from "lucide-react/dist/esm/icons/brain";
import Search from "lucide-react/dist/esm/icons/search";
import Activity from "lucide-react/dist/esm/icons/activity";
import LayoutList from "lucide-react/dist/esm/icons/layout-list";

export type PanelTabId =
  | "radar"
  | "git"
  | "files"
  | "search"
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
};

// Toggle to show/hide prompts tab (set to true to re-enable)
const SHOW_PROMPTS_TAB = false;
// Toggle to show/hide git tab
const SHOW_GIT_TAB = true;

const tabIds: PanelTabId[] = (["activity", "radar", "git", "files", "search", "prompts"] as const).filter(
  (id) =>
    (id !== "prompts" || SHOW_PROMPTS_TAB) &&
    (id !== "git" || SHOW_GIT_TAB)
);

const tabIcons: Record<PanelTabId, ReactNode> = {
  radar: <LayoutList aria-hidden />,
  git: <GitBranch aria-hidden />,
  files: <Folder aria-hidden />,
  search: <Search aria-hidden />,
  memory: <Brain aria-hidden />,
  activity: <Activity aria-hidden />,
  prompts: <ScrollText aria-hidden />,
};

const tabI18nKeys: Record<PanelTabId, string> = {
  radar: "panels.radar",
  git: "panels.git",
  files: "panels.files",
  search: "panels.search",
  memory: "panels.memory",
  activity: "panels.activity",
  prompts: "panels.prompts",
};

export function PanelTabs({ active, onSelect, tabs, liveStates }: PanelTabsProps) {
  const { t } = useTranslation();
  const resolvedTabs =
    tabs ??
    tabIds.map((id) => ({
      id,
      label: t(tabI18nKeys[id]),
      icon: tabIcons[id],
    }));
  return (
    <div className="panel-tabs" role="tablist" aria-label="Panel">
      {resolvedTabs.map((tab) => {
        const isActive = active === tab.id;
        const isLive = Boolean(liveStates?.[tab.id]);
        return (
          <button
            key={tab.id}
            type="button"
            className={`panel-tab${isActive ? " is-active" : ""}${isLive ? " is-live" : ""}`}
            onClick={() => onSelect(tab.id)}
            aria-current={isActive ? "page" : undefined}
            aria-label={tab.label}
            title={tab.label}
            data-tauri-drag-region="false"
          >
            <span className={`panel-tab-icon${isLive ? " is-live" : ""}`} aria-hidden>
              {tab.icon}
            </span>
          </button>
        );
      })}
    </div>
  );
}
