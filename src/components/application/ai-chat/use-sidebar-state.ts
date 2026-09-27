"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import type { ThreadMenuState } from "@/components/application/ai-chat/thread-context-menu";
import type {
  BlankMenuState,
  WorkspaceMenuState,
} from "@/components/application/ai-chat/workspace-context-menu";
import type { AiChatRepo } from "./ai-chat-sidebar";
import type { ThreadAction } from "./sidebar-types";
import { registerShortcutHandler } from "@/features/shortcuts/runtime";
import { useRegistry, workspaceMenuRegistry } from "@ccgui/plugin-sdk";

/**
 * AiChatSidebar state hooks: search palette (⌘L), persisted workspace
 * expansion / group collapse, and the right-click workspace + blank-area
 * menus. The sidebar component keeps only the layout; everything stateful
 * lives here.
 */

/** localStorage key for the collapsed workspace-group id set. */
const COLLAPSED_GROUPS_KEY = "ccgui-next.sidebarCollapsedGroups:v1";
/** Reserved id in the collapsed-group set for the 已归档 section (group ids
 *  are generated, so a sentinel can't collide). */
export const ARCHIVED_SECTION_ID = "__archived__";

function readCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function writeCollapsedGroups(collapsed: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...collapsed]));
  } catch {
    // Storage unavailable/full is non-fatal: collapse stays in memory.
  }
}

/** Group collapse: persisted so the tree reopens the way it was left. */
export function useCollapsedGroups() {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(readCollapsedGroups);
  const toggleGroup = useCallback(
    (groupId: string) => {
      const next = new Set(collapsedGroups);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      setCollapsedGroups(next);
      writeCollapsedGroups(next);
    },
    [collapsedGroups],
  );
  return { collapsedGroups, toggleGroup };
}

/** localStorage key for the expanded workspace id set. */
const EXPANDED_WORKSPACES_KEY = "ccgui-next.sidebarExpandedWorkspaces:v1";

/** Expanded workspace ids, or null when the user never expanded/collapsed
 *  anything — null keeps the built-in default (the first workspace open)
 *  instead of reading "nothing stored" as "everything collapsed". */
function readExpandedWorkspaces(): Set<string> | null {
  try {
    const raw = localStorage.getItem(EXPANDED_WORKSPACES_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [],
    );
  } catch {
    return null;
  }
}

function writeExpandedWorkspaces(expanded: Set<string>) {
  try {
    localStorage.setItem(EXPANDED_WORKSPACES_KEY, JSON.stringify([...expanded]));
  } catch {
    // Storage unavailable/full is non-fatal: expansion stays in memory.
  }
}

/** Workspace expansion: likewise persisted. null = the user never toggled a
 *  workspace, so the built-in default (the first one open) still applies. */
export function useExpandedWorkspaces(allRepos: AiChatRepo[], activeThreadId?: string) {
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string> | null>(
    readExpandedWorkspaces,
  );
  const isRepoExpanded = useCallback(
    (repo: AiChatRepo) =>
      expandedWorkspaces && repo.id
        ? expandedWorkspaces.has(repo.id)
        : (repo.defaultOpen ?? false),
    [expandedWorkspaces],
  );
  const toggleRepoExpanded = useCallback(
    (repo: AiChatRepo) => {
      const id = repo.id;
      if (!id) return;
      setExpandedWorkspaces((prev) => {
        // First toggle materializes the current defaults, so workspaces the
        // user never touched keep the state they were showing.
        const base =
          prev ??
          new Set(
            allRepos.flatMap((r) => (r.defaultOpen && r.id ? [r.id] : [])),
          );
        const next = new Set(base);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [allRepos],
  );
  // Persist after commit, not inside the updater: React may replay updater
  // functions, and a replayed localStorage write would be a duplicate side
  // effect. null = the user never toggled, so there is nothing to store yet;
  // a stored set rewritten on mount is idempotent.
  useEffect(() => {
    if (expandedWorkspaces) writeExpandedWorkspaces(expandedWorkspaces);
  }, [expandedWorkspaces]);
  // Reveal a pending "新对话" once so it is not born inside a collapsed
  // folder. Do not keep forcing it open — that would fight the user
  // collapsing the workspace afterwards. Adjusting state during render (the
  // documented replacement for a prop-change effect): the revealed-draft
  // guard makes each draft id expand at most once, and React re-renders
  // immediately before committing.
  const [revealedDraftId, setRevealedDraftId] = useState<string | null>(null);
  if (activeThreadId && revealedDraftId !== activeThreadId) {
    const repo = allRepos.find((item) =>
      item.threads.some((thread) => thread.id === activeThreadId && thread.isDraft),
    );
    if (repo?.id) {
      setRevealedDraftId(activeThreadId);
      if (!isRepoExpanded(repo)) toggleRepoExpanded(repo);
    }
  }
  return { isRepoExpanded, toggleRepoExpanded };
}

/** Workspace right-click menu: pointer-anchored, one open at a time. The
 *  archived flag selects the 归档/取消归档 entry label. */
export function useWorkspaceMenu(
  onWorkspaceAlias?: (id: string) => void,
  onSetWorkspaceArchived?: (id: string, archived: boolean) => void,
) {
  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceMenuState | null>(null);
  // Registered extension entries can make the menu worth opening even when the
  // host passed no builtin handlers. Read in render (not from a snapshot inside
  // the callback) so a (de)registration re-binds the opener.
  const extensionDefs = useRegistry(workspaceMenuRegistry);
  const openWorkspaceMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, workspaceId: string, archived = false) => {
      const target = { workspaceId, archived };
      // Foreign `visible` predicates can throw; a throwing entry counts as
      // hidden, matching what WorkspaceContextMenu ends up rendering.
      const hasEntries =
        Boolean(onWorkspaceAlias || onSetWorkspaceArchived) ||
        extensionDefs.some((def) => {
          try {
            return def.visible?.(target) !== false;
          } catch {
            return false;
          }
        });
      if (!hasEntries) return;
      event.preventDefault();
      setWorkspaceMenu({ x: event.clientX, y: event.clientY, ...target });
    },
    [extensionDefs, onWorkspaceAlias, onSetWorkspaceArchived],
  );
  const openArchivedMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, workspaceId: string) =>
      openWorkspaceMenu(event, workspaceId, true),
    [openWorkspaceMenu],
  );
  const closeWorkspaceMenu = useCallback(() => setWorkspaceMenu(null), []);
  return { workspaceMenu, closeWorkspaceMenu, openWorkspaceMenu, openArchivedMenu };
}

/** Blank-area right-click menu (the workspace section's empty space): one
 *  open at a time. Row menus preventDefault on the same event, so a bubbling
 *  contextmenu with defaultPrevented set already belongs to a row — the
 *  blank menu stays closed for those. */
export function useBlankMenu() {
  const [blankMenu, setBlankMenu] = useState<BlankMenuState | null>(null);
  const openBlankMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    setBlankMenu({ x: event.clientX, y: event.clientY });
  }, []);
  const closeBlankMenu = useCallback(() => setBlankMenu(null), []);
  return { blankMenu, openBlankMenu, closeBlankMenu };
}
/** Thread right-click menu: pointer-anchored, one open at a time. Opens only
 *  when at least one entry has a handler. */
export function useThreadMenu(
  onThreadAction?: (id: string, action: ThreadAction) => void,
  onCopyThreadId?: (id: string) => void,
) {
  const [threadMenu, setThreadMenu] = useState<ThreadMenuState | null>(null);
  const openThreadMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, threadId: string) => {
      if (!onThreadAction && !onCopyThreadId) return;
      event.preventDefault();
      setThreadMenu({ x: event.clientX, y: event.clientY, threadId });
    },
    [onThreadAction, onCopyThreadId],
  );
  const closeThreadMenu = useCallback(() => setThreadMenu(null), []);
  return { threadMenu, openThreadMenu, closeThreadMenu };
}

/** Session search palette: ⌘L toggles it from anywhere. The binding lives
 *  in the shortcut runtime (default ⌘L, configurable in Settings →
 *  Shortcuts); the palette itself owns its query state. */
export function useSearchPalette() {
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  useEffect(() => registerShortcutHandler("sidebarSearch", () => setSearchOpen((v) => !v)), []);

  return { searchOpen, openSearch, closeSearch };
}
