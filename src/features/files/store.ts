import { create } from "zustand";
import { useBrowserStore } from "@/features/browser/store";
import { useGitStore } from "@/features/git/store";
import { useMissionStore } from "@/features/mission/store";
import { usePluginHubStore } from "@/features/plugins/hub/store";
import { usePluginTabsStore } from "@/features/plugins/runtime/center-tabs";
import { useChatStore } from "@/features/chat/store";
import { useReleaseNotesTabStore } from "@/features/update/notes-tab";
import {
  ipc,
  type DirEntry,
  type FileContent,
  type FileTreeColor,
  type RepositorySummary,
  type SessionFileDocument,
  type SessionMeta,
} from "@/lib/ipc";
import { errorText } from "@/lib/errors";
import i18n from "@/lib/i18n";
import { readStoredJson, writeStored } from "@/lib/storage";
import { installFilesBridge, readRemoteAware } from "./remote-files";
import { nextChainDir } from "./tree-chain";
import { useFileTreePreferencesStore } from "./tree-preferences";

export const FILES_ROOT_KEY = "ccgui-next.filesRoot";
export const fileTreeWorkspaceKey = (root: string) =>
  `ccgui-next.fileTreeWorkspace:${encodeURIComponent(root)}`;
let treeGeneration = 0;

/** `root` and every folder from it down to `path`, or null when `path` is
 *  outside the tree. Tree paths are built with joinPath, so below the root
 *  each segment is "/"-separated, under a drive root (`C:\`) too. */
export function treeLineage(root: string, path: string): string[] | null {
  if (!root) return null;
  if (path === root) return [root];
  const prefix = joinPath(root, "");
  if (!path.startsWith(prefix)) return null;
  const lineage = [root];
  for (const name of path.slice(prefix.length).split("/")) {
    if (!name) return null;
    lineage.push(joinPath(lineage[lineage.length - 1], name));
  }
  return lineage;
}

/** `expanded` without `dir` and every folder beneath it. */
function withoutSubtree(expanded: Record<string, true>, dir: string): Record<string, true> {
  const prefix = joinPath(dir, "");
  return Object.fromEntries(
    Object.entries(expanded).filter(([key]) => key !== dir && !key.startsWith(prefix)),
  );
}

/** The listing entry for a tree path, from its parent's loaded level. */
function treeEntry(
  state: { root: string; children: Record<string, DirEntry[]> },
  path: string,
): DirEntry | undefined {
  const lineage = treeLineage(state.root, path);
  const parent = lineage?.[lineage.length - 2];
  if (parent === undefined) return undefined;
  // Sliced, not fileName(): on macOS/Linux a name may contain "\".
  const name = path.slice(joinPath(parent, "").length);
  return state.children[parent]?.find((entry) => entry.name === name);
}

/** Expanded paths whose every folder from the root down is expanded too. */
function reachableExpanded(root: string, expanded: Record<string, true>): Record<string, true> {
  const reachable: Record<string, true> = {};
  for (const path of Object.keys(expanded)) {
    if (treeLineage(root, path)?.every((dir) => expanded[dir])) reachable[path] = true;
  }
  return reachable;
}

function readWorkspaceExpanded(root: string): Record<string, true> {
  const saved = root ? readStoredJson(fileTreeWorkspaceKey(root), (value) => {
    if (!value || typeof value !== "object" || !Array.isArray((value as { expanded?: unknown }).expanded)) return null;
    const paths = (value as { expanded: unknown[] }).expanded;
    if (!paths.every((path) => typeof path === "string")) return null;
    return reachableExpanded(root, Object.fromEntries(paths.map((path) => [path, true])));
  }) : null;
  return saved ?? (root ? { [root]: true } : {});
}

/** Newest listing request per directory. list_dir runs off the main thread,
 *  so two listings of one directory (a refresh and a post-rename
 *  invalidate) can resolve out of order; only the newest may write.
 *  Cleared with each tree (root switch), which bounds it. */
const listingSeq = new Map<string, number>();

/** List `path` for the tree, with Git ignore flags bounded by the tree root.
 *  Resolves null (errors included) once a newer listing of the same
 *  directory has started. */
async function listTreeDir(path: string, root: string): Promise<DirEntry[] | null> {
  const seq = (listingSeq.get(path) ?? 0) + 1;
  listingSeq.set(path, seq);
  const latest = () => listingSeq.get(path) === seq;
  try {
    const entries = await ipc.listDir(path, { gitIgnoreRoot: root });
    return latest() ? entries : null;
  } catch (error) {
    if (!latest()) return null;
    throw error;
  }
}

/** Join a directory path and a child name. Backend paths are POSIX-style on
 * macOS/Linux; Rust's fs APIs also accept "/" separators on Windows. */
export function joinPath(dir: string, name: string): string {
  if (dir.endsWith("/") || dir.endsWith("\\")) return dir + name;
  return dir + "/" + name;
}

export function fileName(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}
export function parentPath(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(0, idx) : path;
}

/** In-app copy/paste clipboard for tree items (path-based; paste copies). */
export interface TreeClipboard {
  path: string;
  isDir: boolean;
  /** OS clipboard generation read right after this item's Copy tried to put
   *  it on the system clipboard, whether or not that write landed. `null`:
   *  the platform keeps no generation; absent: not known. Rename remaps
   *  `path` and keeps this, so Paste can tell the item is still the newest
   *  copy (`choosePasteSource`). */
  osChangeCount?: number | null;
}

export interface OpenFileState {
  path: string;
  /** null while the first read is in flight. */
  content: FileContent | null;
  loading: boolean;
  error: string | null;
  /** Bumped on every successful (re)load so the editor resets its draft. */
  loadNonce: number;
  /** Native session tabs are keyed by identity, not a shared database path. */
  session?: Pick<SessionMeta, "engine" | "sessionId" | "workspacePath" | "remote" | "remotePath">;
  sourcePath?: string;
  /** Version of the native document currently backing this editor draft. */
  version?: string;
  saving?: boolean;
  name?: string;
}

/** The native source changed on disk: re-read a conversation the chat already
 *  shows, in place, so it matches without a manual "Refresh rendering". A load
 *  still running may have read the old source, so re-read once it settles. */
function refreshLoadedConversation(target: NonNullable<OpenFileState["session"]>) {
  const key = `${target.engine}/${target.sessionId}`;
  const reload = () => {
    const chat = useChatStore.getState();
    if (!chat.bySession[key]) return;
    const meta = chat.sessions.find((s) => s.engine === target.engine && s.sessionId === target.sessionId);
    if (meta) void chat.reloadSession(meta);
  };
  if (!useChatStore.getState().bySession[key]?.loading) {
    reload();
    return;
  }
  const unsubscribe = useChatStore.subscribe((state) => {
    if (state.bySession[key]?.loading) return;
    unsubscribe();
    reload();
  });
}

type ExternalEditorLaunch =
  | { status: "opening"; promise: Promise<void> }
  | { status: "opened" }
  | { status: "error"; error: string };

interface FilesStore {
  /** Folder the tree is rooted at; "" = unset. Persisted to localStorage. */
  root: string;
  /** dirPath -> loaded children (dirs first; backend sorts). Missing = not fetched. */
  children: Record<string, DirEntry[]>;
  loadingDirs: Record<string, true>;
  dirErrors: Record<string, string>;
  expanded: Record<string, true>;
  /** Exact nested repository root -> compact Git status (branch + counts). */
  repositories: Record<string, RepositorySummary>;
  /** Loaded level -> per-file git color ("modified" / "untracked"). */
  fileColors: Record<string, Record<string, FileTreeColor>>;
  /** Currently selected tree node (file or dir). */
  selectedPath: string | null;
  /** Whether the selected tree node is a directory. */
  selectedIsDir: boolean;
  /** Open file tabs, in tab order. */
  openFiles: string[];
  /** Per-tab load state keyed by absolute path. */
  fileStates: Record<string, OpenFileState>;
  /** File tab shown in the center area; null = a chat tab is active. */
  activeFilePath: string | null;
  /** Paths with unsaved editor drafts (reported by EditorPane). */
  dirtyPaths: Record<string, true>;
  /** Session-identity launch state survives reloads and pending tab reopens. */
  externalEditorLaunches: Record<string, ExternalEditorLaunch>;
  /** Tree item staged by the context menu's Copy; consumed by Paste. */
  clipboard: TreeClipboard | null;
  /** Folder the workspace file search is scoped to (absolute); null = closed. */
  searchRoot: string | null;

  setRoot: (path: string) => void;
  ensureDir: (path: string) => Promise<void>;
  toggleDir: (path: string) => Promise<void>;
  toggleCompactDir: (paths: string[]) => Promise<void>;
  /** Expand `path` and every folder above it, then load it. A merged
   *  single-chain row only opens when all of its folders are expanded. */
  revealDir: (path: string) => Promise<void>;
  expandLoadedDirs: () => void;
  collapseAllDirs: () => void;
  /** Re-fetch a directory only if it has been loaded before. */
  invalidateDir: (path: string) => Promise<void>;
  /** Re-fetch every loaded level the tree can still show, collapsed ones
   *  included, plus open folders not loaded yet (titlebar refresh button). */
  refreshTree: () => Promise<void>;
  /** True while refreshTree is in flight. */
  refreshing: boolean;
  loadGitStatus: (levels: Record<string, DirEntry[]>) => Promise<void>;
  selectPath: (path: string | null, isDir?: boolean) => void;
  /** Open a file as a center tab (or focus its existing tab). */
  openFile: (path: string) => Promise<void>;
  /** Open the CLI's complete native transcript in the existing editor. */
  openSessionFile: (session: SessionMeta) => Promise<void>;
  /** Ask the host's default text editor to open a stopped, local transcript. */
  openSessionFileExternally: (path: string) => Promise<void>;
  saveFile: (path: string, content: string) => Promise<string>;
  /** Switch the center area to an already-open file tab. */
  activateFile: (path: string) => void;
  /** Return the center area to the chat (a chat tab was selected). */
  clearActiveFile: () => void;
  /** Re-read a file from disk, resetting its editor draft. */
  reloadFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  /** Move an open file tab to a new position (drag-reorder in the tab strip). */
  moveOpenFile: (path: string, toIndex: number) => void;
  /** Re-point open tabs after a rename/move (content unchanged on disk). */
  remapOpenFiles: (from: string, to: string) => void;
  /** Stage a tree item for Paste. */
  setClipboard: (item: TreeClipboard | null) => void;
  /** Drop cached tree state at/under a removed path and close its tabs. */
  removeTreePath: (path: string) => void;
  /** Re-key cached tree state (and open tabs) after a rename/move. */
  remapTreePath: (from: string, to: string) => void;
  /** Close every tab at or under a removed path. */
  closeFilesUnder: (path: string) => void;
  setFileDirty: (path: string, dirty: boolean) => void;
  /** Open the workspace file search scoped to `searchRoot` (absolute dir). */
  openSearch: (searchRoot: string) => void;
  /** Close the workspace file search overlay. */
  closeSearch: () => void;
}

/** 文件抢到中心前，非文件面（差异/浏览器/插件页/插件中心/任务工作台/版本
 *  更新说明）让位。页签条的选择器（use-chat-tabs）会完整清场，但文件树、
 *  搜索和插件桥直接调 openFile 时同样得切过去——否则编辑器页签亮了，画面还
 *  停在上一个面。 */
function dismissNonFileSurfaces() {
  useGitStore.getState().closeDiff();
  useBrowserStore.getState().deactivate();
  usePluginTabsStore.getState().deactivate();
  usePluginHubStore.getState().deactivate();
  useMissionStore.getState().deactivate();
  useReleaseNotesTabStore.getState().deactivate();
}

/** Levels a refresh re-reads: the root, every loaded level reachable through
 *  entries the tree shows (collapsed ones too, so they never reopen with an
 *  old listing; Git actions rely on this), and open folders that have not
 *  loaded or failed to (the retry path). Folders hidden by the Git-ignore
 *  switch, and everything under them, are skipped. */
function refreshTargets(
  s: Pick<FilesStore, "root" | "children" | "expanded">,
  hideIgnored: boolean,
): Set<string> {
  const dirs = new Set([s.root]);
  const visit = (dir: string, open: boolean) => {
    for (const entry of s.children[dir] ?? []) {
      if (!entry.isDir || (hideIgnored && entry.ignored)) continue;
      const path = joinPath(dir, entry.name);
      const isOpen = open && !!s.expanded[path];
      if (s.children[path]) {
        dirs.add(path);
        visit(path, isOpen);
      } else if (isOpen) {
        dirs.add(path);
      }
    }
  };
  visit(s.root, !!s.expanded[s.root]);
  return dirs;
}

export const useFilesStore = create<FilesStore>((set, get) => ({
  root: localStorage.getItem(FILES_ROOT_KEY) ?? "",
  children: {},
  loadingDirs: {},
  dirErrors: {},
  expanded: readWorkspaceExpanded(localStorage.getItem(FILES_ROOT_KEY) ?? ""),
  repositories: {},
  fileColors: {},
  selectedPath: null,
  selectedIsDir: false,
  refreshing: false,
  openFiles: [],
  fileStates: {},
  activeFilePath: null,
  dirtyPaths: {},
  externalEditorLaunches: {},
  clipboard: null,
  searchRoot: null,

  setRoot: (path) => {
    const root = path.trim();
    if (root === get().root) return;
    treeGeneration += 1;
    listingSeq.clear();
    if (root) {
      writeStored(FILES_ROOT_KEY, root);
    } else {
      localStorage.removeItem(FILES_ROOT_KEY);
    }
    // Open file tabs survive root (workspace) switches — they are absolute
    // paths and stay editable regardless of which tree is shown.
    set({
      root,
      refreshing: false,
      children: {},
      loadingDirs: {},
      dirErrors: {},
      expanded: readWorkspaceExpanded(root),
      repositories: {},
      fileColors: {},
      selectedPath: null,
      selectedIsDir: false,
      // A workspace switch invalidates the search scope (it belonged to the
      // previous tree).
      searchRoot: null,
    });
    if (root) void get().ensureDir(root);
  },

  ensureDir: async (path) => {
    const s = get();
    if (s.children[path] || s.loadingDirs[path]) return;
    const generation = treeGeneration;
    set((s) => ({ loadingDirs: { ...s.loadingDirs, [path]: true } }));
    try {
      const entries = await listTreeDir(path, s.root);
      if (generation !== treeGeneration) return;
      set((s) => {
        const loadingDirs = { ...s.loadingDirs };
        delete loadingDirs[path];
        // Superseded: a newer listing (a refresh) already wrote this level.
        if (!entries) return { loadingDirs };
        const dirErrors = { ...s.dirErrors };
        delete dirErrors[path];
        return {
          children: { ...s.children, [path]: entries },
          loadingDirs,
          dirErrors,
        };
      });
      if (entries) await get().loadGitStatus({ [path]: entries });
    } catch (e) {
      if (generation !== treeGeneration) return;
      set((s) => {
        const loadingDirs = { ...s.loadingDirs };
        delete loadingDirs[path];
        return {
          loadingDirs,
          dirErrors: { ...s.dirErrors, [path]: errorText(e) },
        };
      });
    }
  },

  loadGitStatus: async (levels) => {
    const generation = treeGeneration;
    const requests = Object.entries(levels).map(([path, entries]) => ({
      path,
      files: entries.filter((entry) => !entry.name.startsWith(".")).map((entry) => entry.name),
      directories: entries.filter((entry) => entry.isDir).map((entry) => entry.name),
    }));
    if (requests.length === 0) return;
    try {
      const result = await ipc.gitTreeStatus(requests);
      if (generation !== treeGeneration) return;
      set((state) => {
        const repositories = { ...state.repositories };
        const fileColors = { ...state.fileColors };
        for (const request of requests) {
          delete repositories[request.path];
          for (const name of request.directories) delete repositories[joinPath(request.path, name)];
          fileColors[request.path] = result.fileColors[request.path] ?? {};
        }
        for (const summary of result.repositories) repositories[summary.path] = summary;
        return { repositories, fileColors };
      });
    } catch {
      return;
    }
  },

  toggleDir: async (path) => {
    const s = get();
    if (s.expanded[path]) {
      set({ expanded: withoutSubtree(s.expanded, path) });
      return;
    }
    set((s) => ({ expanded: { ...s.expanded, [path]: true } }));
    await get().ensureDir(path);
  },

  toggleCompactDir: async (paths) => {
    if (paths.length === 0) return;
    const generation = treeGeneration;
    if (paths.every((path) => get().expanded[path])) {
      set((s) => ({ expanded: withoutSubtree(s.expanded, paths[0]) }));
      return;
    }
    let path = paths[paths.length - 1];
    // Every folder of one chain shares a Git-ignore state (nextChainDir).
    const ignored = !!treeEntry(get(), path)?.ignored;
    set((s) => ({ expanded: { ...s.expanded, ...Object.fromEntries(paths.map((part) => [part, true])) } }));
    while (true) {
      await get().ensureDir(path);
      // A refresh that started meanwhile superseded this first listing and
      // may land later; list once more so the chain does not stop here.
      if (!get().children[path] && !get().dirErrors[path]) await get().ensureDir(path);
      if (generation !== treeGeneration) return;
      const state = get();
      // The synthetic root row is never merged, so it opens one level only.
      if (!state.expanded[path] || path === state.root) return;
      const next = nextChainDir(path, ignored, {
        children: state.children,
        loadingDirs: state.loadingDirs,
        dirErrors: state.dirErrors,
        repositories: state.repositories,
        hideIgnored: useFileTreePreferencesStore.getState().hideIgnored,
      });
      if (!next) return;
      path = joinPath(path, next.name);
      set((s) => ({ expanded: { ...s.expanded, [path]: true } }));
    }
  },

  revealDir: async (path) => {
    const lineage = treeLineage(get().root, path);
    if (!lineage) return;
    set((s) => ({ expanded: { ...s.expanded, ...Object.fromEntries(lineage.map((dir) => [dir, true])) } }));
    await get().ensureDir(path);
  },

  expandLoadedDirs: () => {
    const { root, children, expanded: current } = get();
    if (!root) return;
    const hideIgnored = useFileTreePreferencesStore.getState().hideIgnored;
    // Folders already open stay open, ones still loading included.
    const expanded: Record<string, true> = { ...current, [root]: true };
    const visit = (dir: string) => {
      for (const entry of children[dir] ?? []) {
        if (!entry.isDir || (hideIgnored && entry.ignored)) continue;
        const path = joinPath(dir, entry.name);
        if (!children[path]) continue;
        expanded[path] = true;
        visit(path);
      }
    };
    visit(root);
    set({ expanded });
  },

  collapseAllDirs: () => {
    const root = get().root;
    set({ expanded: root ? { [root]: true } : {} });
  },

  invalidateDir: async (path) => {
    if (!get().children[path]) return;
    const generation = treeGeneration;
    try {
      const entries = await listTreeDir(path, get().root);
      if (generation !== treeGeneration || !entries) return;
      set((s) => ({ children: { ...s.children, [path]: entries } }));
      await get().loadGitStatus({ [path]: entries });
    } catch {
      // Keep stale listing on refresh failure; the user can retry by toggling.
    }
  },
  refreshTree: async () => {
    const s = get();
    if (!s.root || s.refreshing) return;
    const generation = treeGeneration;
    set({ refreshing: true });
    try {
      const hideIgnored = useFileTreePreferencesStore.getState().hideIgnored;
      const dirs = refreshTargets(s, hideIgnored);
      const levels: Record<string, DirEntry[]> = {};
      await Promise.all(
        [...dirs].map(async (dir) => {
          try {
            const entries = await listTreeDir(dir, s.root);
            // Superseded listings leave this level (and its Git pass) to
            // the newer one.
            if (generation !== treeGeneration || !entries) return;
            levels[dir] = entries;
            set((state) => {
              const dirErrors = { ...state.dirErrors };
              delete dirErrors[dir];
              return { children: { ...state.children, [dir]: entries }, dirErrors };
            });
          } catch {
            if (generation !== treeGeneration) return;
            if (s.children[dir]) levels[dir] = s.children[dir];
          }
        }),
      );
      if (generation !== treeGeneration) return;
      // Judged on the fresh listings: levels the tree can no longer show
      // (hidden by the Git-ignore switch, or no longer listed by their
      // parent, e.g. deleted by a checkout) are dropped and load fresh when
      // shown again, instead of reappearing with an old listing.
      const live = refreshTargets(get(), hideIgnored);
      const dropped = Object.keys(get().children).filter((dir) => !live.has(dir));
      if (dropped.length > 0) {
        set((state) => {
          const children = { ...state.children };
          const fileColors = { ...state.fileColors };
          for (const dir of dropped) {
            delete children[dir];
            delete fileColors[dir];
          }
          return { children, fileColors };
        });
      }
      const liveLevels = Object.fromEntries(Object.entries(levels).filter(([dir]) => live.has(dir)));
      await get().loadGitStatus(liveLevels);
    } finally {
      if (generation === treeGeneration) set({ refreshing: false });
    }
  },

  selectPath: (path, isDir = false) => set({ selectedPath: path, selectedIsDir: isDir }),

  openFile: async (path) => {
    dismissNonFileSurfaces();
    if (get().fileStates[path]) {
      set({ activeFilePath: path, selectedPath: path, selectedIsDir: false });
      return;
    }
    set((s) => ({
      openFiles: [...s.openFiles, path],
      fileStates: {
        ...s.fileStates,
        [path]: { path, content: null, loading: true, error: null, loadNonce: 0 },
      },
      activeFilePath: path,
      selectedPath: path,
      selectedIsDir: false,
    }));
    await get().reloadFile(path);
  },

  openSessionFile: async (session) => {
    if (session.engine === "agy") return;
    const key = `session:${session.engine}/${session.sessionId}`;
    dismissNonFileSurfaces();
    const existing = get().fileStates[key];
    if (existing) {
      set({ activeFilePath: key });
      if (!get().dirtyPaths[key] && !existing.saving) await get().reloadFile(key);
      return;
    }
    const sourcePath = (session.remote ? session.remotePath : session.filePath) ?? "";
    const target = {
      engine: session.engine,
      sessionId: session.sessionId,
      workspacePath: session.workspacePath,
      remote: session.remote,
      remotePath: session.remotePath,
    };
    set((s) => ({
      openFiles: [...s.openFiles, key],
      fileStates: {
        ...s.fileStates,
        [key]: { path: key, sourcePath, name: fileName(sourcePath), session: target, content: null, loading: true, error: null, loadNonce: 0 },
      },
      activeFilePath: key,
    }));
    await get().reloadFile(key);
  },
  openSessionFileExternally: async (path) => {
    const target = get().fileStates[path]?.session;
    if (!target) throw new Error("Not a native session editor");
    const key = `session:${target.engine}/${target.sessionId}`;
    const current = get().externalEditorLaunches[key];
    if (current?.status === "opening") return current.promise;
    const finish = (result: Exclude<ExternalEditorLaunch, { status: "opening" }>) => {
      set((s) => {
        const launch = s.externalEditorLaunches[key];
        if (launch?.status !== "opening" || launch.promise !== promise) return s;
        const externalEditorLaunches = { ...s.externalEditorLaunches };
        if (s.fileStates[key]?.session) externalEditorLaunches[key] = result;
        else delete externalEditorLaunches[key];
        return { externalEditorLaunches };
      });
    };
    // Publish the promise before any host call or validation can settle it.
    const promise = Promise.resolve().then(async () => {
      try {
        if (target.remote || target.remotePath) throw new Error(i18n.t("files.externalEditorRemote"));
        if (["dsh", "opencode", "agy"].includes(target.engine)) {
          throw new Error(i18n.t("files.externalEditorStructured"));
        }
        const chatKey = `${target.engine}/${target.sessionId}`;
        const chat = useChatStore.getState();
        if (chat.streamingByKey[chatKey] || chat.bySession[chatKey]?.streaming) {
          throw new Error(i18n.t("chat.sessionEditRunning"));
        }
        await ipc.openSessionFileInDefaultEditor(target.engine, target.sessionId);
        finish({ status: "opened" });
      } catch (error) {
        finish({ status: "error", error: errorText(error) });
        throw error;
      }
    });
    set((s) => ({ externalEditorLaunches: { ...s.externalEditorLaunches, [key]: { status: "opening", promise } } }));
    await promise;
  },

  saveFile: async (path, content) => {
    const entry = get().fileStates[path];
    if (!entry?.content || entry.content.kind !== "text" || entry.content.truncated || entry.content.readOnly) {
      throw new Error("File is not editable");
    }
    const target = entry.session;
    let savedText = content;
    if (target) {
      if (target.engine === "agy" || entry.loading || entry.saving || !entry.version) {
        throw new Error("Session file is not editable; reload it before saving");
      }
      const key = `${target.engine}/${target.sessionId}`;
      const chat = useChatStore.getState();
      if (chat.streamingByKey[key] || chat.bySession[key]?.streaming) {
        throw new Error(i18n.t("chat.sessionEditRunning"));
      }
      const pending = { ...entry, saving: true };
      set((s) => ({ fileStates: { ...s.fileStates, [path]: pending } }));
      try {
        const savedDocument: SessionFileDocument = await ipc.writeSessionFile(target.engine, target.sessionId, content, entry.version, target.remote ? target.workspacePath : undefined, target.remote ? target.remotePath : undefined);
        refreshLoadedConversation(target);
        if (get().fileStates[path] !== pending) throw new Error("The session editor changed while saving; reopen it to read the current file");
        savedText = savedDocument.text;
        const savedContent = { ...entry.content, text: savedText };
        set((s) => ({ fileStates: { ...s.fileStates, [path]: { ...pending, saving: false, sourcePath: savedDocument.path, name: savedDocument.name, version: savedDocument.version, content: savedContent } } }));
      } catch (error) {
        set((s) => s.fileStates[path] === pending
          ? { fileStates: { ...s.fileStates, [path]: { ...pending, saving: false } } }
          : s);
        if (errorText(error).includes("SESSION_EDIT_CONFLICT")) throw new Error(i18n.t("files.sessionEditConflict"));
        throw error;
      }
    } else {
      await ipc.writeFile(path, content);
      set((s) => {
        const current = s.fileStates[path];
        if (!current?.content || current.session) return s;
        return { fileStates: { ...s.fileStates, [path]: { ...current, content: { ...current.content, text: savedText } } } };
      });
    }
    return savedText;
  },

  activateFile: (path) => {
    if (get().fileStates[path]) set({ activeFilePath: path });
    // A file taking the center dismisses every other surface in view
    // (mutual exclusion enforced here so file-tree opens cover it too).
    dismissNonFileSurfaces();
  },

  clearActiveFile: () => set({ activeFilePath: null }),

  reloadFile: async (path) => {
    const entry = get().fileStates[path];
    if (!entry || (entry.session && entry.saving)) return;
    const target = entry.session;
    set((s) => {
      const st = s.fileStates[path];
      if (!st) return s;
      return {
        fileStates: { ...s.fileStates, [path]: { ...st, loading: true, error: null } },
      };
    });
    const pending = get().fileStates[path];
    try {
      const document = target
        ? await ipc.readSessionFile(target.engine, target.sessionId, target.remote ? target.workspacePath : undefined, target.remote ? target.remotePath : undefined)
        : null;
      const content: FileContent = document
        ? { kind: "text", text: document.text, dataUrl: null, truncated: false }
        : await readRemoteAware(path, (p) => ipc.readFile(p));
      set((s) => {
        const st = s.fileStates[path];
        if (!st || (target ? st !== pending : st.session !== target)) return s;
        return {
          fileStates: {
            ...s.fileStates,
            [path]: { ...st, ...(document ? { sourcePath: document.path, name: document.name, version: document.version } : {}), content, loading: false, loadNonce: st.loadNonce + 1 },
          },
        };
      });
    } catch (e) {
      const message = errorText(e);
      set((s) => {
        const st = s.fileStates[path];
        if (!st || (target ? st !== pending : st.session !== target)) return s;
        return {
          fileStates: { ...s.fileStates, [path]: { ...st, loading: false, error: message } },
        };
      });
    }
  },

  closeFile: (path) =>
    set((s) => {
      if (!s.fileStates[path]) return s;
      const openFiles = s.openFiles.filter((p) => p !== path);
      const fileStates = { ...s.fileStates };
      delete fileStates[path];
      const dirtyPaths = { ...s.dirtyPaths };
      delete dirtyPaths[path];
      const externalEditorLaunches = { ...s.externalEditorLaunches };
      if (externalEditorLaunches[path]?.status !== "opening") delete externalEditorLaunches[path];
      let activeFilePath = s.activeFilePath;
      if (activeFilePath === path) {
        const idx = s.openFiles.indexOf(path);
        // Focus the tab that slid into the closed one's slot (or the last).
        activeFilePath = openFiles[Math.min(idx, openFiles.length - 1)] ?? null;
      }
      return { openFiles, fileStates, dirtyPaths, activeFilePath, externalEditorLaunches };
    }),
  moveOpenFile: (path, toIndex) =>
    set((s) => {
      const from = s.openFiles.indexOf(path);
      if (from < 0) return s;
      const openFiles = [...s.openFiles];
      openFiles.splice(from, 1);
      openFiles.splice(Math.max(0, Math.min(toIndex, openFiles.length)), 0, path);
      return { openFiles };
    }),

  remapOpenFiles: (from, to) =>
    set((s) => {
      const mapPath = (p: string) =>
        p === from ? to : p.startsWith(from + "/") ? to + p.slice(from.length) : p;
      if (!s.openFiles.some((p) => mapPath(p) !== p)) return s;
      const fileStates: Record<string, OpenFileState> = {};
      for (const [p, st] of Object.entries(s.fileStates)) {
        const np = mapPath(p);
        fileStates[np] = np === p ? st : { ...st, path: np };
      }
      const dirtyPaths: Record<string, true> = {};
      for (const p of Object.keys(s.dirtyPaths)) dirtyPaths[mapPath(p)] = true;
      return {
        openFiles: s.openFiles.map(mapPath),
        fileStates,
        dirtyPaths,
        activeFilePath: s.activeFilePath ? mapPath(s.activeFilePath) : null,
      };
    }),

  closeFilesUnder: (path) => {
    for (const p of [...get().openFiles]) {
      if (p === path || p.startsWith(path + "/")) get().closeFile(p);
    }
  },
  setClipboard: (item) => set({ clipboard: item }),

  removeTreePath: (path) => {
    const prune = <T,>(map: Record<string, T>) => {
      const next: Record<string, T> = {};
      for (const [k, v] of Object.entries(map)) {
        if (k !== path && !k.startsWith(path + "/")) next[k] = v;
      }
      return next;
    };
    set((s) => ({
      children: prune(s.children),
      expanded: prune(s.expanded),
      loadingDirs: prune(s.loadingDirs),
      dirErrors: prune(s.dirErrors),
      repositories: prune(s.repositories),
      fileColors: prune(s.fileColors),
      selectedPath:
        s.selectedPath && (s.selectedPath === path || s.selectedPath.startsWith(path + "/"))
          ? null
          : s.selectedPath,
      clipboard:
        s.clipboard && (s.clipboard.path === path || s.clipboard.path.startsWith(path + "/"))
          ? null
          : s.clipboard,
    }));
    get().closeFilesUnder(path);
  },

  remapTreePath: (from, to) => {
    const mapPath = (p: string) =>
      p === from ? to : p.startsWith(from + "/") ? to + p.slice(from.length) : p;
    const remap = <T,>(map: Record<string, T>) => {
      const next: Record<string, T> = {};
      for (const [k, v] of Object.entries(map)) next[mapPath(k)] = v;
      return next;
    };
    set((s) => ({
      children: remap(s.children),
      expanded: remap(s.expanded),
      loadingDirs: remap(s.loadingDirs),
      dirErrors: remap(s.dirErrors),
      selectedPath: s.selectedPath ? mapPath(s.selectedPath) : s.selectedPath,
      // Keep the object unless its own path moved: a Copy whose OS write is
      // still in flight records its generation onto that same object.
      clipboard:
        s.clipboard && mapPath(s.clipboard.path) !== s.clipboard.path
          ? { ...s.clipboard, path: mapPath(s.clipboard.path) }
          : s.clipboard,
      repositories: remap(s.repositories),
      fileColors: remap(s.fileColors),
    }));
    get().remapOpenFiles(from, to);
  },

  setFileDirty: (path, dirty) =>
    set((s) => {
      const has = !!s.dirtyPaths[path];
      if (dirty === has) return s;
      const dirtyPaths = { ...s.dirtyPaths };
      if (dirty) dirtyPaths[path] = true;
      else delete dirtyPaths[path];
      return { dirtyPaths };
    }),

  openSearch: (searchRoot) => set({ searchRoot }),

  closeSearch: () => set({ searchRoot: null }),
}));

useFilesStore.subscribe((state, previous) => {
  if (!state.root || state.expanded === previous.expanded) return;
  writeStored(fileTreeWorkspaceKey(state.root), JSON.stringify({
    expanded: Object.keys(reachableExpanded(state.root, state.expanded)),
  }));
});

// WSL 插件(独立 bundle)经 window.__ccguiFiles 拿到中央编辑器的打开入口,
// 并注册远程读取器 —— 见 remote-files.ts。
installFilesBridge((path) => useFilesStore.getState().openFile(path));
