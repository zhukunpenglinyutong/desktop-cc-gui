"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ThreadMenuState } from "@/components/application/ai-chat/thread-context-menu";
import type { WorkspaceMenuState } from "@/components/application/ai-chat/workspace-context-menu";
import type { AiChatRepo, AiChatRepoSection } from "./ai-chat-sidebar";
import type { ThreadAction } from "./sidebar-types";
import { registerShortcutHandler } from "@/features/shortcuts/runtime";

/**
 * AiChatSidebar state hooks: quick search (⌘L), persisted workspace
 * expansion / group collapse, the right-click workspace menu, and the
 * query-driven filtering of the workspace tree. The sidebar component keeps
 * only the layout; everything stateful lives here.
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
export function useExpandedWorkspaces(allRepos: AiChatRepo[]) {
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
      // First toggle materializes the current defaults, so workspaces the
      // user never touched keep the state they were showing.
      const base =
        expandedWorkspaces ??
        new Set(
          allRepos.flatMap((r) => (r.defaultOpen && r.id ? [r.id] : [])),
        );
      const next = new Set(base);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeExpandedWorkspaces(next);
      setExpandedWorkspaces(next);
    },
    [allRepos, expandedWorkspaces],
  );
  return { isRepoExpanded, toggleRepoExpanded };
}

/** Workspace right-click menu: pointer-anchored, one open at a time. The
 *  archived flag selects the 归档/取消归档 entry label. */
export function useWorkspaceMenu(
  onWorkspaceAlias?: (id: string) => void,
  onSetWorkspaceArchived?: (id: string, archived: boolean) => void,
) {
  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceMenuState | null>(null);
  const openWorkspaceMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, workspaceId: string, archived = false) => {
      if (!onWorkspaceAlias && !onSetWorkspaceArchived) return;
      event.preventDefault();
      setWorkspaceMenu({ x: event.clientX, y: event.clientY, workspaceId, archived });
    },
    [onWorkspaceAlias, onSetWorkspaceArchived],
  );
  const openArchivedMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, workspaceId: string) =>
      openWorkspaceMenu(event, workspaceId, true),
    [openWorkspaceMenu],
  );
  const closeWorkspaceMenu = useCallback(() => setWorkspaceMenu(null), []);
  return { workspaceMenu, closeWorkspaceMenu, openWorkspaceMenu, openArchivedMenu };
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

/** Quick search: the nav row swaps for a field that filters workspaces and
 *  sessions by label; ⌘L focuses it from anywhere. */
export function useSidebarSearch() {
  const [searchActive, setSearchActive] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const activateSearch = useCallback(() => setSearchActive(true), []);
  const deactivateSearch = useCallback(() => {
    setQuery("");
    setSearchActive(false);
  }, []);

  useEffect(() => {
    if (!searchActive) return;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [searchActive]);

  // Activation key lives in the shortcut runtime (default ⌘L, configurable
  // in Settings → Shortcuts).
  useEffect(
    () => registerShortcutHandler("sidebarSearch", activateSearch),
    [activateSearch],
  );

  return {
    searchActive,
    query,
    setQuery,
    normalizedQuery,
    searchInputRef,
    activateSearch,
    deactivateSearch,
  };
}

/** Query filter for one repo: matches by label, otherwise keeps only the
 *  matching threads in a copy. */
function matchRepo(repo: AiChatRepo, normalizedQuery: string): AiChatRepo | null {
  if (!normalizedQuery || repo.label.toLocaleLowerCase().includes(normalizedQuery)) {
    return repo;
  }
  const threads = repo.threads.filter((thread) =>
    thread.label.toLocaleLowerCase().includes(normalizedQuery),
  );
  return threads.length ? { ...repo, threads } : null;
}

/** The query filter applied to the whole workspace tree: flat repos, grouped
 *  sections (groups with no matches drop out while searching; empty groups
 *  stay when not searching so they can render as mid-drag drop targets; the
 *  ungrouped section always stays), and the 已归档 labels (label match only
 *  — archived rows carry no threads). */
export function useFilteredWorkspaces(
  repos: AiChatRepo[],
  sections: AiChatRepoSection[] | undefined,
  archivedRepos: AiChatRepo[],
  normalizedQuery: string,
) {
  const filteredRepos = useMemo(
    () =>
      repos.flatMap((repo) => {
        const match = matchRepo(repo, normalizedQuery);
        return match ? [match] : [];
      }),
    [repos, normalizedQuery],
  );
  const filteredSections = useMemo(() => {
    if (!sections) return undefined;
    return sections.reduce<AiChatRepoSection[]>((acc, section) => {
      const repos = section.repos.flatMap((repo) => {
        const match = matchRepo(repo, normalizedQuery);
        return match ? [match] : [];
      });
      if (section.id === null || repos.length > 0 || !normalizedQuery) {
        acc.push({ ...section, repos });
      }
      return acc;
    }, []);
  }, [sections, normalizedQuery]);
  const filteredArchivedRepos = useMemo(
    () =>
      archivedRepos.filter(
        (repo) =>
          !normalizedQuery || repo.label.toLocaleLowerCase().includes(normalizedQuery),
      ),
    [archivedRepos, normalizedQuery],
  );
  return { filteredRepos, filteredSections, filteredArchivedRepos };
}
