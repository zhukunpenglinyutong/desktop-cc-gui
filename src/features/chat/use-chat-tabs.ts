import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import FileText from "lucide-react/dist/esm/icons/file-text";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import { fileName, useFilesStore } from "@/features/files/store";
import { useGitStore } from "@/features/git/store";
import type { SessionMeta } from "@/lib/ipc";
import { sessionKey, useChatStore } from "./store";
import type { ChatPageDialog } from "./ChatPageDialogs";

// File tabs share the session tab strip; their keys are prefixed so select /
// close handlers can route them to the files store instead of the chat store.
const FILE_TAB_PREFIX = "file:";
// The changes diff opens as a center tab too; a single instance at a time.
const DIFF_TAB_KEY = "diff:";

/** Center tab strip data: session/file/diff tab items, the active key, and
 * the select/close/reorder handlers routing each tab kind to its store.
 * Sidebar/tab-strip slices are low-frequency — they change only on
 * navigation or a list refresh. */
export function useChatTabs({
  setDialog,
}: {
  setDialog: (dialog: ChatPageDialog) => void;
}) {
  const { t } = useTranslation();
  const { active, openTabs, sessions, unseen } = useChatStore(
    useShallow((s) => ({
      active: s.active,
      openTabs: s.openTabs,
      sessions: s.sessions,
      unseen: s.unseen,
    })),
  );
  const { focusTab, closeTab, moveTab } = useChatStore(
    useShallow((s) => ({
      focusTab: s.focusTab,
      closeTab: s.closeTab,
      moveTab: s.moveTab,
    })),
  );
  // Open file tabs render alongside the session tabs in the center area.
  const { openFiles, activeFilePath, dirtyPaths, activateFile, clearActiveFile, closeFile, moveOpenFile } =
    useFilesStore(
      useShallow((s) => ({
        openFiles: s.openFiles,
        activeFilePath: s.activeFilePath,
        dirtyPaths: s.dirtyPaths,
        activateFile: s.activateFile,
        clearActiveFile: s.clearActiveFile,
        closeFile: s.closeFile,
        moveOpenFile: s.moveOpenFile,
      })),
    );
  // Center diff, opened from the changes panel's file rows.
  const diffView = useGitStore((s) => s.diffView);
  const closeDiff = useGitStore((s) => s.closeDiff);
  // Flat streaming map: its reference changes only when a session actually
  // starts/stops streaming, so these selectors do not rescan bySession on
  // every per-frame stream flush.
  const streamingByKey = useChatStore((s) => s.streamingByKey);
  // Per-tab streaming flags for the tab strip; recomputed only when a flag
  // actually flips (or the tab list changes).
  const tabStreaming = useMemo(
    () =>
      openTabs.map(
        (tab) => streamingByKey[sessionKey(tab.engine, tab.sessionId, tab.workspacePath)] === true,
      ),
    [openTabs, streamingByKey],
  );
  // Sidebar status dots: per-thread streaming flags plus the unseen map
  // (reference-stable until a flag actually changes).
  const threadStreaming = useMemo(
    () =>
      sessions.map(
        (sess) =>
          streamingByKey[sessionKey(sess.engine, sess.sessionId, sess.workspacePath)] === true,
      ),
    [sessions, streamingByKey],
  );

  const sessionById = useMemo(() => {
    const map = new Map<string, SessionMeta>();
    for (const s of sessions) map.set(`${s.engine}/${s.sessionId}`, s);
    return map;
  }, [sessions]);
  const sessionTabItems = useMemo(
    () =>
      openTabs.map((tab, index) => {
        const meta = tab.sessionId
          ? sessionById.get(`${tab.engine}/${tab.sessionId}`)
          : undefined;
        return {
          key: sessionKey(tab.engine, tab.sessionId, tab.workspacePath),
          engine: tab.engine,
          label: meta?.customTitle || meta?.title || t("chat.newChat"),
          streaming: tabStreaming[index] ?? false,
          unseen: unseen[`${tab.engine}/${tab.sessionId}`] ?? false,
          tab,
        };
      }),
    [openTabs, sessionById, tabStreaming, t, unseen],
  );
  // File tabs trail the session tabs in the same strip.
  const fileTabItems = useMemo(
    () =>
      openFiles.map((path) => ({
        key: FILE_TAB_PREFIX + path,
        label: fileName(path),
        title: path,
        icon: FileText,
        streaming: false,
        dirty: !!dirtyPaths[path],
      })),
    [openFiles, dirtyPaths],
  );
  const tabItems = useMemo(
    () => [
      ...sessionTabItems,
      ...fileTabItems,
      ...(diffView
        ? [
            {
              key: DIFF_TAB_KEY,
              label: fileName(diffView.target.file),
              title: diffView.target.file,
              icon: GitBranch,
              streaming: false,
            },
          ]
        : []),
    ],
    [sessionTabItems, fileTabItems, diffView],
  );
  const activeTabKey = diffView
    ? DIFF_TAB_KEY
    : activeFilePath
      ? FILE_TAB_PREFIX + activeFilePath
      : active
        ? sessionKey(active.engine, active.sessionId, active.workspacePath)
        : null;
  const handleTabSelect = useCallback(
    (tabKey: string) => {
      // The diff tab is already the active center view while diffView is set.
      if (tabKey === DIFF_TAB_KEY) return;
      // Selecting any other tab dismisses the diff so the tab shows.
      closeDiff();
      if (tabKey.startsWith(FILE_TAB_PREFIX)) {
        activateFile(tabKey.slice(FILE_TAB_PREFIX.length));
        return;
      }
      clearActiveFile();
      const item = sessionTabItems.find((i) => i.key === tabKey);
      if (item) focusTab(item.tab.engine, item.tab.sessionId, item.tab.workspacePath);
    },
    [sessionTabItems, focusTab, activateFile, clearActiveFile, closeDiff],
  );
  const handleTabClose = useCallback(
    (tabKey: string) => {
      if (tabKey === DIFF_TAB_KEY) {
        closeDiff();
        return;
      }
      if (tabKey.startsWith(FILE_TAB_PREFIX)) {
        const path = tabKey.slice(FILE_TAB_PREFIX.length);
        if (dirtyPaths[path]) setDialog({ kind: "closeFile", path });
        else closeFile(path);
        return;
      }
      const item = sessionTabItems.find((i) => i.key === tabKey);
      if (item) closeTab(item.tab.engine, item.tab.sessionId, item.tab.workspacePath);
    },
    [sessionTabItems, closeTab, closeFile, dirtyPaths, closeDiff, setDialog],
  );
  // Drag-reorder stays within each tab group: file tabs reorder openFiles,
  // session tabs reorder openTabs; cross-group drops are ignored.
  const handleTabReorder = useCallback(
    (draggedKey: string, targetKey: string, before: boolean) => {
      if (draggedKey === DIFF_TAB_KEY || targetKey === DIFF_TAB_KEY) return;
      const draggedIsFile = draggedKey.startsWith(FILE_TAB_PREFIX);
      if (draggedIsFile !== targetKey.startsWith(FILE_TAB_PREFIX)) return;
      if (draggedIsFile) {
        const draggedPath = draggedKey.slice(FILE_TAB_PREFIX.length);
        const targetPath = targetKey.slice(FILE_TAB_PREFIX.length);
        const from = openFiles.indexOf(draggedPath);
        let to = openFiles.indexOf(targetPath) + (before ? 0 : 1);
        if (from >= 0 && from < to) to -= 1;
        moveOpenFile(draggedPath, to);
        return;
      }
      const from = sessionTabItems.findIndex((i) => i.key === draggedKey);
      const targetIdx = sessionTabItems.findIndex((i) => i.key === targetKey);
      const dragged = sessionTabItems[from]?.tab;
      if (!dragged || targetIdx < 0) return;
      let to = targetIdx + (before ? 0 : 1);
      if (from < to) to -= 1;
      moveTab(dragged.engine, dragged.sessionId, dragged.workspacePath, to);
    },
    [openFiles, moveOpenFile, sessionTabItems, moveTab],
  );


  // Tab context menu "Close All": drop every tab. Dirty file tabs cannot be
  // discarded silently — close everything else first, then route the first
  // dirty file through the existing save-confirmation dialog (any others
  // stay open and a repeat Close All walks through them).
  const handleTabCloseAll = useCallback(() => {
    closeDiff();
    for (const item of sessionTabItems) {
      closeTab(item.tab.engine, item.tab.sessionId, item.tab.workspacePath);
    }
    const dirty = openFiles.filter((path) => dirtyPaths[path]);
    for (const path of openFiles) {
      if (!dirtyPaths[path]) closeFile(path);
    }
    if (dirty[0]) setDialog({ kind: "closeFile", path: dirty[0] });
  }, [sessionTabItems, closeTab, openFiles, dirtyPaths, closeFile, closeDiff, setDialog]);

  // Tab context menu "Close Inactive": drop the tabs that are neither in
  // view nor running. A session tab whose turn is still streaming stays —
  // closing it would leave the turn running with nothing showing it.
  // Same dirty-file rule as Close All: unsaved edits are never discarded
  // silently; the first one routes through the save dialog and the others
  // stay open. The tab in view keeps its edit either way.
  const handleTabCloseInactive = useCallback(() => {
    if (activeTabKey !== DIFF_TAB_KEY) closeDiff();
    for (const item of sessionTabItems) {
      if (item.key === activeTabKey || item.streaming) continue;
      closeTab(item.tab.engine, item.tab.sessionId, item.tab.workspacePath);
    }
    const others = openFiles.filter((path) => FILE_TAB_PREFIX + path !== activeTabKey);
    const dirty = others.filter((path) => dirtyPaths[path]);
    for (const path of others) {
      if (!dirtyPaths[path]) closeFile(path);
    }
    if (dirty[0]) setDialog({ kind: "closeFile", path: dirty[0] });
  }, [
    activeTabKey,
    sessionTabItems,
    closeTab,
    openFiles,
    dirtyPaths,
    closeFile,
    closeDiff,
    setDialog,
  ]);

  return {
    tabItems,
    activeTabKey,
    handleTabSelect,
    handleTabClose,
    handleTabCloseAll,
    handleTabCloseInactive,
    handleTabReorder,
    sessionById,
    threadStreaming,
    openFiles,
    activeFilePath,
    diffView,
    closeDiff,
  };
}
