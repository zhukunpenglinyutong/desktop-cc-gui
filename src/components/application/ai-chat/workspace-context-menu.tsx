import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import Archive from "lucide-react/dist/esm/icons/archive";
import ArchiveRestore from "lucide-react/dist/esm/icons/archive-restore";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import GitBranchPlus from "lucide-react/dist/esm/icons/git-branch-plus";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Puzzle from "lucide-react/dist/esm/icons/puzzle";
import { ContextMenu, type ContextMenuEntry } from "@/components/context-menu";
import { useChatStore } from "@/features/chat/store";
import { useWorktreeStore } from "@/features/worktree/store";
import { ipc, worktreeMetaOf, type Workspace } from "@/lib/ipc";
import {
  compareByOrder,
  pluginIdFromRegistryKey,
  useRegistry,
  workspaceMenuRegistry,
  type WorkspaceMenuItemDef,
  type WorkspaceMenuLabelValue,
  type WorkspaceMenuStatusTone,
} from "@ccgui/plugin-sdk";
import { PluginBoundary } from "@/features/plugins/boundary/PluginBoundary";

export interface WorkspaceMenuState {
  x: number;
  y: number;
  workspaceId: string;
  /** Row lives in the 已归档 section: the archive entry flips to 取消归档. */
  archived: boolean;
}

export interface BlankMenuState {
  x: number;
  y: number;
}

/** Platform-appropriate label for the worktree's "reveal in file manager" row. */
function revealLabel(t: TFunction): string {
  const platform = navigator.platform;
  if (platform.includes("Mac")) return t("files.revealInFinder");
  if (platform.includes("Win")) return t("files.revealInExplorer");
  return t("files.revealInFileManager");
}

interface WorkspaceMenuEntriesOptions {
  menu: WorkspaceMenuState;
  workspace: Workspace | undefined;
  isWorktree: boolean;
  /** git-level lock reason; `undefined` = deletable, `""` = locked, no reason. */
  lockReason: string | undefined;
  t: TFunction;
  onSetAlias?: (workspaceId: string) => void;
  onSetArchived?: (workspaceId: string, archived: boolean) => void;
  onNewWorktree?: (workspaceId: string) => void;
  onDeleteWorktree?: (workspaceId: string) => void;
}

/** Builds the row menu: worktree rows get reveal/delete, plain rows get the
 *  archive toggle; alias and new-worktree entries show whenever enabled. */
function buildWorkspaceMenuEntries({
  menu,
  workspace,
  isWorktree,
  lockReason,
  t,
  onSetAlias,
  onSetArchived,
  onNewWorktree,
  onDeleteWorktree,
}: WorkspaceMenuEntriesOptions): (ContextMenuEntry | "separator")[] {
  const entries: (ContextMenuEntry | "separator")[] = [];
  if (onNewWorktree && workspace) {
    entries.push({
      id: "new-worktree",
      label: t("worktree.newWorktree"),
      icon: <GitBranchPlus className="size-4" aria-hidden />,
      onSelect: () => onNewWorktree(menu.workspaceId),
    });
  }
  if (onSetAlias) {
    entries.push({
      id: "set-alias",
      label: t("chat.setWorkspaceAlias"),
      icon: <Pencil className="size-4" aria-hidden />,
      onSelect: () => onSetAlias(menu.workspaceId),
    });
  }
  if (isWorktree && workspace) {
    entries.push({
      id: "reveal-worktree",
      label: revealLabel(t),
      icon: <FolderOpen className="size-4" aria-hidden />,
      onSelect: () => void ipc.revealInFileManager(workspace.path).catch(() => undefined),
    });
    if (onDeleteWorktree) {
      entries.push("separator");
      entries.push({
        id: "delete-worktree",
        label: t("worktree.deleteWorktree"),
        icon: <Trash2 className="size-4" aria-hidden />,
        danger: true,
        disabled: lockReason !== undefined,
        title:
          lockReason !== undefined
            ? lockReason || t("worktree.lockedDeleteDisabled")
            : undefined,
        onSelect: () => onDeleteWorktree(menu.workspaceId),
      });
    }
  }
  if (onSetArchived && !isWorktree) {
    entries.push({
      id: "toggle-archive",
      label: menu.archived ? t("chat.unarchiveWorkspace") : t("chat.archiveWorkspace"),
      icon: menu.archived ? (
        <ArchiveRestore className="size-4" aria-hidden />
      ) : (
        <Archive className="size-4" aria-hidden />
      ),
      onSelect: () => onSetArchived(menu.workspaceId, !menu.archived),
    });
  }
  return entries;
}

/** Status parenthetical tones (SDK `WorkspaceMenuLabel.status`): semantic
 *  tokens only — a plugin picks a tone, never a color. */
const workspaceMenuStatusClassNames: Record<WorkspaceMenuStatusTone, string> = {
  success: "text-notification-success-foreground",
  muted: "text-text-tertiary",
};

function renderWorkspaceMenuLabel(label: WorkspaceMenuLabelValue): ContextMenuEntry["label"] {
  if (typeof label === "string") return label;
  if (!label.status) return label.text;
  return (
    <>
      {label.text}{" "}
      <span
        className={workspaceMenuStatusClassNames[label.status.tone]}
        data-workspace-menu-status
      >
        ({label.status.text})
      </span>
    </>
  );
}

/** Registered extension entries (`ctx.ui.registerWorkspaceMenuItem`), resolved
 *  against the row the user right-clicked — never the active workspace.
 *  Extension callbacks are foreign code: a throwing `label`/`visible` drops
 *  that one entry instead of taking the sidebar down, and a failing `onSelect`
 *  (sync throw or rejected promise) is reported and swallowed. */
function buildExtensionEntries(
  defs: readonly WorkspaceMenuItemDef[],
  target: { workspaceId: string; archived: boolean },
): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = [];
  // compareByOrder: undefined order sorts last, ties break by id.
  for (const def of [...defs].sort(compareByOrder)) {
    const Icon = def.icon ?? Puzzle;
    try {
      if (def.visible?.(target) === false) continue;
      entries.push({
        id: def.id,
        label: renderWorkspaceMenuLabel(def.label(target)),
        icon: def.icon ? (
          <PluginBoundary
            pluginId={pluginIdFromRegistryKey(def.id)}
            fallback={<Puzzle className="size-4" aria-hidden />}
          >
            <Icon className="size-4" aria-hidden />
          </PluginBoundary>
        ) : (
          <Icon className="size-4" aria-hidden />
        ),
        onSelect: () => {
          try {
            void Promise.resolve(def.onSelect(target)).catch((error: unknown) =>
              console.error(`[plugins] workspace menu ${def.id} onSelect failed`, error),
            );
          } catch (error) {
            console.error(`[plugins] workspace menu ${def.id} onSelect failed`, error);
          }
        },
      });
    } catch (error) {
      console.error(`[plugins] workspace menu ${def.id} failed to resolve`, error);
    }
  }
  return entries;
}

/**
 * Right-click menu for sidebar workspace rows. Chrome (portal anchoring,
 * viewport clamping, Escape/outside dismissal) comes from the shared
 * ContextMenu; this component only owns the workspace action entries.
 */
export function WorkspaceContextMenu({
  menu,
  onClose,
  onSetAlias,
  onSetArchived,
  onNewWorktree,
  onDeleteWorktree,
}: {
  menu: WorkspaceMenuState;
  onClose: () => void;
  onSetAlias?: (workspaceId: string) => void;
  onSetArchived?: (workspaceId: string, archived: boolean) => void;
  onNewWorktree?: (workspaceId: string) => void;
  onDeleteWorktree?: (workspaceId: string) => void;
}) {
  const { t } = useTranslation();
  // Worktree 子行与普通行共用此菜单：worktree 行多出「在访达中显示」
  // 与「删除 Worktree…」，隐藏归档（子行不支持归档/分组/拖拽）。
  const workspace = useChatStore((s) => s.workspaces.find((w) => w.id === menu.workspaceId));
  const isWorktree = workspace != null && (worktreeMetaOf(workspace) != null || workspace.parentId != null);
  // git 层面 locked 的 worktree 禁删（原因进 title，不谎报可点）。
  const lockReason = useWorktreeStore((s) =>
    workspace ? s.lockedPaths[workspace.path] : undefined,
  );
  // Read in render so a language flip or an owner's state change re-labels an
  // open menu.
  const extensionDefs = useRegistry(workspaceMenuRegistry);
  const target = { workspaceId: menu.workspaceId, archived: menu.archived };

  const builtins = buildWorkspaceMenuEntries({
    menu,
    workspace,
    isWorktree,
    lockReason,
    t,
    onSetAlias,
    onSetArchived,
    onNewWorktree,
    onDeleteWorktree,
  });
  const extensions = buildExtensionEntries(extensionDefs, target);
  const entries: (ContextMenuEntry | "separator")[] =
    builtins.length > 0 && extensions.length > 0
      ? [...builtins, "separator", ...extensions]
      : [...builtins, ...extensions];
  // An extension-only menu whose last owner unloads while it is open has
  // nothing left to show: close instead of leaving an empty popover.
  useEffect(() => {
    if (entries.length === 0) onClose();
  }, [entries.length, onClose]);
  if (entries.length === 0) return null;

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      ariaLabel={menu.workspaceId}
      entries={entries}
      onClose={onClose}
    />
  );
}

/**
 * Right-click menu for the workspace section's blank area: create a group
 * without a trip to Settings → 工作区. Selecting the entry opens the
 * sidebar's inline name composer (owned by the sidebar component).
 */
export function WorkspaceBlankContextMenu({
  menu,
  onClose,
  onCreateGroup,
}: {
  menu: BlankMenuState;
  onClose: () => void;
  onCreateGroup?: () => void;
}) {
  const { t } = useTranslation();

  const entries: ContextMenuEntry[] = [];
  if (onCreateGroup) {
    entries.push({
      id: "create-group",
      label: t("chat.newGroup"),
      icon: <FolderPlus className="size-4" aria-hidden />,
      onSelect: onCreateGroup,
    });
  }

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      ariaLabel={t("chat.workspaces")}
      entries={entries}
      onClose={onClose}
    />
  );
}
