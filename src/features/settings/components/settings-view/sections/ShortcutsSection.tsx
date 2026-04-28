import type { KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";
import Archive from "lucide-react/dist/esm/icons/archive";
import Bug from "lucide-react/dist/esm/icons/bug";
import BrainCircuit from "lucide-react/dist/esm/icons/brain-circuit";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import CopyPlus from "lucide-react/dist/esm/icons/copy-plus";
import Cpu from "lucide-react/dist/esm/icons/cpu";
import FolderTree from "lucide-react/dist/esm/icons/folder-tree";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import GitBranchPlus from "lucide-react/dist/esm/icons/git-branch-plus";
import KanbanSquare from "lucide-react/dist/esm/icons/kanban-square";
import MessageSquare from "lucide-react/dist/esm/icons/message-square";
import MessageSquarePlus from "lucide-react/dist/esm/icons/message-square-plus";
import OctagonX from "lucide-react/dist/esm/icons/octagon-x";
import PanelLeftOpen from "lucide-react/dist/esm/icons/panel-left-open";
import PanelRightOpen from "lucide-react/dist/esm/icons/panel-right-open";
import RotateCcw from "lucide-react/dist/esm/icons/rotate-ccw";
import Save from "lucide-react/dist/esm/icons/save";
import Search from "lucide-react/dist/esm/icons/search";
import SearchCode from "lucide-react/dist/esm/icons/search-code";
import Settings from "lucide-react/dist/esm/icons/settings";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check";
import SquarePlus from "lucide-react/dist/esm/icons/square-plus";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import UsersRound from "lucide-react/dist/esm/icons/users-round";
import ZoomIn from "lucide-react/dist/esm/icons/zoom-in";
import ZoomOut from "lucide-react/dist/esm/icons/zoom-out";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import MonitorCog from "lucide-react/dist/esm/icons/monitor-cog";
import { formatShortcutForPlatform, getDefaultInterruptShortcut } from "@/utils/shortcuts";
import type {
  ShortcutActionMetadata,
  ShortcutDrafts,
  ShortcutSettingKey,
} from "../settingsViewShortcuts";
import {
  shortcutActions,
  shortcutCategoryDefinitions,
} from "../settingsViewShortcuts";

const shortcutIconByActionId: Record<string, LucideIcon> = {
  "open-settings": Settings,
  "new-window": SquarePlus,
  "open-chat-mode": MessageSquare,
  "open-kanban-mode": KanbanSquare,
  "new-agent": MessageSquarePlus,
  "new-worktree-agent": GitBranchPlus,
  "new-clone-agent": CopyPlus,
  "archive-active-thread": Archive,
  "cycle-open-session-prev": ChevronLeft,
  "cycle-open-session-next": ChevronRight,
  "toggle-left-conversation-sidebar": PanelLeftOpen,
  "toggle-right-conversation-sidebar": PanelRightOpen,
  "toggle-projects-sidebar": PanelLeftOpen,
  "toggle-git-sidebar": GitBranch,
  "toggle-global-search": Search,
  "toggle-debug-panel": Bug,
  "toggle-terminal": TerminalSquare,
  "toggle-runtime-console": MonitorCog,
  "toggle-files-surface": FolderOpen,
  "composer-cycle-model": Cpu,
  "composer-cycle-access": ShieldCheck,
  "composer-cycle-reasoning": BrainCircuit,
  "composer-cycle-collaboration": UsersRound,
  "interrupt-active-run": OctagonX,
  "save-file": Save,
  "find-in-file": SearchCode,
  "toggle-git-diff-list-view": FolderTree,
  "increase-ui-scale": ZoomIn,
  "decrease-ui-scale": ZoomOut,
  "reset-ui-scale": RotateCcw,
  "cycle-agent-next": ChevronDown,
  "cycle-agent-prev": ChevronUp,
  "cycle-workspace-next": ChevronRight,
  "cycle-workspace-prev": ChevronLeft,
};

function resolveDefaultShortcut(action: ShortcutActionMetadata): string | null {
  if (action.setting === "interruptShortcut") {
    return getDefaultInterruptShortcut();
  }
  return action.defaultShortcut;
}

type ShortcutsSectionProps = {
  active: boolean;
  t: (key: string) => string;
  shortcutDrafts: ShortcutDrafts;
  handleShortcutKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
    setting: ShortcutSettingKey,
  ) => void;
  updateShortcut: (setting: ShortcutSettingKey, value: string | null) => Promise<void>;
};

export function ShortcutsSection({
  active,
  t,
  shortcutDrafts,
  handleShortcutKeyDown,
  updateShortcut,
}: ShortcutsSectionProps) {
  if (!active) {
    return null;
  }

  const shortcutGroups = shortcutCategoryDefinitions
    .map((category) => ({
      id: category.id,
      title: t(category.titleKey),
      description: t(category.descriptionKey),
      items: shortcutActions.filter((action) => action.category === category.id),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <section className="settings-section settings-shortcuts-section">
      <div className="settings-section-title">{t("settings.shortcutsTitle")}</div>
      <div className="settings-section-subtitle">
        {t("settings.shortcutsDescription")}
      </div>
      <div className="settings-shortcuts-groups">
        {shortcutGroups.map((group) => (
          <div className="settings-shortcuts-group" key={group.id}>
            <div className="settings-shortcuts-group-header">
              <div className="settings-subsection-title">{group.title}</div>
              <div className="settings-subsection-subtitle">
                {group.description}
              </div>
            </div>
            <div className="settings-shortcuts-grid">
              {group.items.map((item) => {
                const Icon = shortcutIconByActionId[item.id] ?? Settings;
                const defaultShortcut = resolveDefaultShortcut(item);
                return (
                  <div className="settings-shortcuts-item" key={item.setting}>
                    <div className="settings-shortcuts-item-heading">
                      <span className="settings-shortcuts-item-icon" aria-hidden="true">
                        <Icon size={15} strokeWidth={2.1} />
                      </span>
                      <div className="settings-shortcuts-item-title">
                        {t(item.labelKey)}
                      </div>
                    </div>
                    <input
                      className="settings-input settings-input--shortcut settings-shortcuts-item-input"
                      value={formatShortcutForPlatform(shortcutDrafts[item.draftKey])}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, item.setting)
                      }
                      placeholder={t("settings.typeShortcut")}
                      aria-label={`${t(item.labelKey)} ${t("settings.typeShortcut")}`}
                      readOnly
                    />
                    <div className="settings-shortcuts-item-footer">
                      <span className="settings-shortcuts-item-default">
                        {t(item.defaultLabelKey ?? "settings.defaultColon")}{" "}
                        {formatShortcutForPlatform(defaultShortcut)}
                      </span>
                      <button
                        type="button"
                        className="ghost settings-button-compact settings-shortcuts-item-clear"
                        onClick={() => void updateShortcut(item.setting, null)}
                      >
                        {t("settings.clear")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
