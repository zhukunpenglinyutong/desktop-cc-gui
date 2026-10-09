import { create } from "zustand";
import { useBrowserStore } from "@/features/browser/store";
import { useGitStore } from "@/features/git/store";
import { useMissionStore } from "@/features/mission/store";
import { usePluginHubStore } from "@/features/plugins/hub/store";
import { usePluginTabsStore } from "@/features/plugins/runtime/center-tabs";
import { useReleaseNotesTabStore } from "@/features/update/notes-tab";
import {
  ipc,
  type DirEntry,
  type FileContent,
  type FileTreeColor,
  type RepositorySummary,
} from "@/lib/ipc";
import { errorText } from "@/lib/errors";
import { readStoredJson, writeStored } from "@/lib/storage";
import { installFilesBridge, readRemoteAware } from "./remote-files";

/** 旧版单根持久化键(仍读作迁移来源)。 */
export const FILES_ROOT_KEY = "ccgui-next.filesRoot";
/** 当前多根持久化键(JSON 字符串数组,主目录在前)。 */
export const FILES_ROOTS_KEY = "ccgui-next.filesRoots";
let treeGeneration = 0;

/** 读回持久化的根列表:优先新键;旧单根键作为一次性迁移来源。 */
function readStoredRoots(): string[] {
  const stored = readStoredJson(FILES_ROOTS_KEY, (raw) =>
    Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : null,
  );
  if (stored) return stored;
  const legacy = localStorage.getItem(FILES_ROOT_KEY);
  return legacy ? [legacy] : [];
}

function writeStoredRoots(roots: string[]) {
  if (roots.length === 0) {
    localStorage.removeItem(FILES_ROOTS_KEY);
  } else {
    writeStored(FILES_ROOTS_KEY, JSON.stringify(roots));
  }
  // 旧单根键不再是权威来源,避免下次启动又迁移出陈旧路径。
  localStorage.removeItem(FILES_ROOT_KEY);
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
}

export interface OpenFileState {
  path: string;
  /** null while the first read is in flight. */
  content: FileContent | null;
  loading: boolean;
  error: string | null;
  /** Bumped on every successful (re)load so the editor resets its draft. */
  loadNonce: number;
}

interface FilesStore {
  /** 工作区多目录:树的全部根,主目录在前、附加根在后。空数组 = 未设置。
   *  单根时与旧的单 `root` 行为一致;每个根的子树并列渲染成同一棵树。 */
  roots: string[];
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
  /** Tree item staged by the context menu's Copy; consumed by Paste. */
  clipboard: TreeClipboard | null;
  /** Folder the workspace file search is scoped to (absolute); null = closed. */
  searchRoot: string | null;

  /** 设置树的全部根(主目录在前、附加根在后;去空、去重)。单根时等价于
   *  旧 `setRoot(path)`。 */
  setRoots: (paths: string[]) => void;
  ensureDir: (path: string) => Promise<void>;
  toggleDir: (path: string) => Promise<void>;
  /** Re-fetch a directory only if it has been loaded before. */
  invalidateDir: (path: string) => Promise<void>;
  /** Re-fetch every loaded/expanded directory (titlebar refresh button). */
  refreshTree: () => Promise<void>;
  /** True while refreshTree is in flight. */
  refreshing: boolean;
  loadGitStatus: (levels: Record<string, DirEntry[]>) => Promise<void>;
  selectPath: (path: string | null, isDir?: boolean) => void;
  /** Open a file as a center tab (or focus its existing tab). */
  openFile: (path: string) => Promise<void>;
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

export const useFilesStore = create<FilesStore>((set, get) => ({
  roots: readStoredRoots(),
  children: {},
  loadingDirs: {},
  dirErrors: {},
  expanded: {},
  repositories: {},
  fileColors: {},
  selectedPath: null,
  selectedIsDir: false,
  refreshing: false,
  openFiles: [],
  fileStates: {},
  activeFilePath: null,
  dirtyPaths: {},
  clipboard: null,
  searchRoot: null,

  setRoots: (paths) => {
    // 去空白、去重(保序:主目录在前、附加根在后)。
    const seen = new Set<string>();
    const roots: string[] = [];
    for (const p of paths) {
      const trimmed = p.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      roots.push(trimmed);
    }
    const current = get().roots;
    if (roots.length === current.length && roots.every((r, i) => r === current[i])) return;
    treeGeneration += 1;
    writeStoredRoots(roots);
    // Open file tabs survive root (workspace) switches — they are absolute
    // paths and stay editable regardless of which tree is shown.
    set({
      roots,
      refreshing: false,
      children: {},
      loadingDirs: {},
      dirErrors: {},
      expanded: {},
      repositories: {},
      fileColors: {},
      selectedPath: null,
      selectedIsDir: false,
      // A workspace switch invalidates the search scope (it belonged to the
      // previous tree).
      searchRoot: null,
    });
    // 每个根都预取顶层:所有根并列成一棵树,展开各自的下一层。
    for (const root of roots) void get().ensureDir(root);
  },

  ensureDir: async (path) => {
    const s = get();
    if (s.children[path] || s.loadingDirs[path]) return;
    const generation = treeGeneration;
    set((s) => ({ loadingDirs: { ...s.loadingDirs, [path]: true } }));
    try {
      const entries = await ipc.listDir(path);
      if (generation !== treeGeneration) return;
      set((s) => {
        const loadingDirs = { ...s.loadingDirs };
        const dirErrors = { ...s.dirErrors };
        delete loadingDirs[path];
        delete dirErrors[path];
        return {
          children: { ...s.children, [path]: entries },
          loadingDirs,
          dirErrors,
        };
      });
      await get().loadGitStatus({ [path]: entries });
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
      const expanded = { ...s.expanded };
      delete expanded[path];
      set({ expanded });
      return;
    }
    set((s) => ({ expanded: { ...s.expanded, [path]: true } }));
    await get().ensureDir(path);
  },

  invalidateDir: async (path) => {
    if (!get().children[path]) return;
    const generation = treeGeneration;
    try {
      const entries = await ipc.listDir(path);
      if (generation !== treeGeneration) return;
      set((s) => ({ children: { ...s.children, [path]: entries } }));
      await get().loadGitStatus({ [path]: entries });
    } catch {
      // Keep stale listing on refresh failure; the user can retry by toggling.
    }
  },
  refreshTree: async () => {
    const s = get();
    if (s.roots.length === 0 || s.refreshing) return;
    const generation = treeGeneration;
    set({ refreshing: true });
    try {
      const dirs = new Set([...s.roots, ...Object.keys(s.children), ...Object.keys(s.expanded)]);
      const levels: Record<string, DirEntry[]> = {};
      await Promise.all(
        [...dirs].map(async (dir) => {
          try {
            const entries = await ipc.listDir(dir);
            if (generation !== treeGeneration) return;
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
      if (generation === treeGeneration) await get().loadGitStatus(levels);
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

  activateFile: (path) => {
    if (get().fileStates[path]) set({ activeFilePath: path });
    // A file taking the center dismisses every other surface in view
    // (mutual exclusion enforced here so file-tree opens cover it too).
    dismissNonFileSurfaces();
  },

  clearActiveFile: () => set({ activeFilePath: null }),

  reloadFile: async (path) => {
    set((s) => {
      const st = s.fileStates[path];
      if (!st) return s;
      return {
        fileStates: { ...s.fileStates, [path]: { ...st, loading: true, error: null } },
      };
    });
    try {
      const content = await readRemoteAware(path, (p) => ipc.readFile(p));
      set((s) => {
        const st = s.fileStates[path];
        if (!st) return s; // tab closed mid-load
        return {
          fileStates: {
            ...s.fileStates,
            [path]: { ...st, content, loading: false, loadNonce: st.loadNonce + 1 },
          },
        };
      });
    } catch (e) {
      const message = errorText(e);
      set((s) => {
        const st = s.fileStates[path];
        if (!st) return s;
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
      let activeFilePath = s.activeFilePath;
      if (activeFilePath === path) {
        const idx = s.openFiles.indexOf(path);
        // Focus the tab that slid into the closed one's slot (or the last).
        activeFilePath = openFiles[Math.min(idx, openFiles.length - 1)] ?? null;
      }
      return { openFiles, fileStates, dirtyPaths, activeFilePath };
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
      clipboard: s.clipboard ? { ...s.clipboard, path: mapPath(s.clipboard.path) } : s.clipboard,
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

// WSL 插件(独立 bundle)经 window.__ccguiFiles 拿到中央编辑器的打开入口,
// 并注册远程读取器 —— 见 remote-files.ts。
installFilesBridge((path) => useFilesStore.getState().openFile(path));
