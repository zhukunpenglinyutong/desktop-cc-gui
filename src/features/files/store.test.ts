import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntry, SessionFileDocument, SessionMeta } from "@/lib/ipc";

const mocks = vi.hoisted(() => ({
  listDir: vi.fn(),
  readFile: vi.fn(async () => ({ kind: "text", text: "", dataUrl: null, truncated: false })),
  readSessionFile: vi.fn(),
  writeSessionFile: vi.fn(),
  writeFile: vi.fn(),
  gitTreeStatus: vi.fn(),
  gitRepositorySummaries: vi.fn(),
  gitFileColors: vi.fn(),
}));
const browserMock = vi.hoisted(() => ({ deactivate: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: mocks }));
vi.mock("@/features/browser/store", () => ({
  useBrowserStore: { getState: () => browserMock },
}));
import { useChatStore, type SessionState } from "@/features/chat/store";
import { useGitStore } from "@/features/git/store";
import { resetMissionStore, useMissionStore } from "@/features/mission/store";
import { usePluginHubStore } from "@/features/plugins/hub/store";
import { usePluginTabsStore } from "@/features/plugins/runtime/center-tabs";
import { fileTreeWorkspaceKey, useFilesStore } from "./store";
import { useFileTreePreferencesStore } from "./tree-preferences";
import { buildVisibleNodes } from "./visible-nodes";

const entry = (name: string, isDir = false): DirEntry => ({ name, isDir, size: 0, mtimeMs: 0 });
const emptyStatus = () => ({ repositories: [], fileColors: {} });

describe("文件树单链展开与记忆", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.gitTreeStatus.mockResolvedValue(emptyStatus());
    useFileTreePreferencesStore.setState({ hideIgnored: false });
    useFilesStore.setState({ root: "/chain", children: { "/chain": [entry("src", true)] }, expanded: { "/chain": true }, loadingDirs: {}, dirErrors: {}, repositories: {}, fileColors: {} });
    localStorage.removeItem(fileTreeWorkspaceKey("/chain"));
  });

  it("一次点击沿唯一子目录读到含文件的链尾", async () => {
    mocks.listDir.mockImplementation(async (path: string) => ({
      "/chain/src": [entry("main", true)],
      "/chain/src/main": [entry("java", true)],
      "/chain/src/main/java": [entry("App.java")],
    })[path] ?? []);
    await useFilesStore.getState().toggleCompactDir(["/chain/src"]);
    expect(mocks.listDir.mock.calls.map(([path]) => path)).toEqual([
      "/chain/src", "/chain/src/main", "/chain/src/main/java",
    ]);
    expect(useFilesStore.getState().expanded).toMatchObject({
      "/chain/src": true, "/chain/src/main": true, "/chain/src/main/java": true,
    });
    expect(useFilesStore.getState().children["/chain/src/main/java"]).toEqual([entry("App.java")]);
  });

  it("读取途中收起目录后不继续展开晚到的子目录", async () => {
    let finish!: (entries: DirEntry[]) => void;
    mocks.listDir.mockReturnValue(new Promise<DirEntry[]>((resolve) => { finish = resolve; }));
    const click = useFilesStore.getState().toggleCompactDir(["/chain/src"]);
    await useFilesStore.getState().toggleDir("/chain/src");
    finish([entry("main", true)]);
    await click;
    expect(useFilesStore.getState().expanded["/chain/src/main"]).toBeUndefined();
    expect(mocks.listDir).toHaveBeenCalledTimes(1);
  });

  it("隐藏 Git 忽略项时不沿其展开，也不批量展开", async () => {
    useFileTreePreferencesStore.setState({ hideIgnored: true });
    useFilesStore.setState({ children: {
      "/chain": [entry("src", true), { ...entry("cache", true), ignored: true }],
      "/chain/src": [{ ...entry("ignored", true), ignored: true }, entry("Main.java")],
      "/chain/cache": [],
    } });
    await useFilesStore.getState().toggleCompactDir(["/chain/src"]);
    expect(useFilesStore.getState().expanded["/chain/src/ignored"]).toBeUndefined();
    useFilesStore.getState().expandLoadedDirs();
    expect(useFilesStore.getState().expanded["/chain/cache"]).toBeUndefined();
    expect(mocks.listDir).not.toHaveBeenCalled();
  });

  it("收起父目录清理后代展开路径，持久化只保留可达路径", async () => {
    useFilesStore.setState({ expanded: { "/chain": true, "/chain/src": true, "/chain/src/main": true } });
    await useFilesStore.getState().toggleDir("/chain/src");
    expect(useFilesStore.getState().expanded).toEqual({ "/chain": true });
    expect(JSON.parse(localStorage.getItem(fileTreeWorkspaceKey("/chain"))!)).toEqual({ expanded: ["/chain"] });
  });

  it("切换工作区后分别恢复展开路径，持久化内容不含过滤配置", () => {
    mocks.listDir.mockResolvedValue([]);
    useFilesStore.setState({ expanded: { "/chain": true, "/chain/src": true } });
    useFilesStore.getState().setRoot("/other");
    expect(useFilesStore.getState().expanded).toEqual({ "/other": true });
    useFilesStore.getState().setRoot("/chain");
    expect(useFilesStore.getState().expanded).toEqual({ "/chain": true, "/chain/src": true });
    expect(JSON.parse(localStorage.getItem(fileTreeWorkspaceKey("/chain"))!)).toEqual({
      expanded: ["/chain", "/chain/src"],
    });
  });

  it("链尾是嵌套仓库时，一次点击也展开到仓库内容", async () => {
    mocks.listDir.mockImplementation(async (path: string) => ({
      "/chain/src": [entry("repo", true)],
      "/chain/src/repo": [entry("index.ts")],
    })[path] ?? []);
    mocks.gitTreeStatus.mockImplementation(async (requests: { path: string }[]) => ({
      repositories: requests.some((request) => request.path === "/chain/src")
        ? [{ path: "/chain/src/repo", branch: "main", changed: 0, untracked: 0 }]
        : [],
      fileColors: {},
    }));
    await useFilesStore.getState().toggleCompactDir(["/chain/src"]);
    expect(mocks.listDir.mock.calls.map(([path]) => path)).toEqual(["/chain/src", "/chain/src/repo"]);
    const row = buildVisibleNodes({ ...useFilesStore.getState(), hideIgnored: false })[1];
    expect(row).toMatchObject({ name: "src/repo", path: "/chain/src/repo", expanded: true });
  });

  it("单链在 Git 忽略状态变化处断开，点击不越过分界", async () => {
    mocks.listDir.mockImplementation(async (path: string) => ({
      "/chain/src": [{ ...entry("gen", true), ignored: true }],
      "/chain/src/gen": [{ ...entry("out.ts"), ignored: true }],
    })[path] ?? []);
    await useFilesStore.getState().toggleCompactDir(["/chain/src"]);
    expect(mocks.listDir.mock.calls.map(([path]) => path)).toEqual(["/chain/src"]);
    expect(useFilesStore.getState().expanded["/chain/src/gen"]).toBeUndefined();
  });

  it("点击工作区根行只展开一层，不沿单链继续", async () => {
    useFilesStore.setState({ expanded: {} });
    // A finite listing: a regression then fails instead of looping forever.
    mocks.listDir.mockImplementation(async (path: string) => ({ "/chain/src": [entry("App.ts")] })[path] ?? []);
    await useFilesStore.getState().toggleCompactDir(["/chain"]);
    expect(useFilesStore.getState().expanded).toEqual({ "/chain": true });
    expect(mocks.listDir).not.toHaveBeenCalled();
  });

  it("在收起的合并行里新建后，合并行的每一层都展开", async () => {
    useFilesStore.setState({ children: {
      "/chain": [entry("a", true)],
      "/chain/a": [entry("b", true)],
      "/chain/a/b": [entry("c", true)],
      "/chain/a/b/c": [entry("created.ts")],
    } });
    await useFilesStore.getState().revealDir("/chain/a/b/c");
    expect(mocks.listDir).not.toHaveBeenCalled();
    const row = buildVisibleNodes({ ...useFilesStore.getState(), hideIgnored: false })[1];
    expect(row).toMatchObject({ name: "a/b/c", expanded: true });
    expect(JSON.parse(localStorage.getItem(fileTreeWorkspaceKey("/chain"))!).expanded).toContain("/chain/a/b/c");
  });

  it("展开已加载的文件夹保留正在读取的已展开目录", () => {
    useFilesStore.setState({
      children: { "/chain": [entry("src", true), entry("slow", true)], "/chain/src": [] },
      expanded: { "/chain": true, "/chain/slow": true },
      loadingDirs: { "/chain/slow": true },
    });
    useFilesStore.getState().expandLoadedDirs();
    expect(useFilesStore.getState().expanded).toEqual({ "/chain": true, "/chain/src": true, "/chain/slow": true });
  });

  it("刷新重读已收起的已加载目录，再展开时不是旧内容", async () => {
    useFilesStore.setState({ children: { "/chain": [entry("src", true)], "/chain/src": [entry("old.ts")] } });
    mocks.listDir.mockImplementation(async (path: string) => ({
      "/chain": [entry("src", true)],
      "/chain/src": [entry("new.ts")],
    })[path] ?? []);
    await useFilesStore.getState().refreshTree();
    expect(mocks.listDir.mock.calls.map(([path]) => path).sort()).toEqual(["/chain", "/chain/src"]);
    await useFilesStore.getState().toggleCompactDir(["/chain/src"]);
    expect(useFilesStore.getState().children["/chain/src"]).toEqual([entry("new.ts")]);
  });

  it("刷新后父目录不再列出的已加载目录丢弃缓存，不再拿旧内容参与 Git 着色", async () => {
    useFilesStore.setState({
      children: { "/chain": [entry("src", true), entry("gone", true)], "/chain/src": [], "/chain/gone": [entry("old.ts")] },
      expanded: { "/chain": true, "/chain/gone": true },
    });
    mocks.listDir.mockImplementation(async (path: string) => {
      if (path === "/chain/gone") throw new Error("not found");
      return ({ "/chain": [entry("src", true)] } as Record<string, DirEntry[]>)[path] ?? [];
    });
    await useFilesStore.getState().refreshTree();
    expect(useFilesStore.getState().children["/chain/gone"]).toBeUndefined();
    expect(mocks.gitTreeStatus.mock.calls[0][0].map((request: { path: string }) => request.path).sort()).toEqual(["/chain", "/chain/src"]);
  });

  it("刷新重试读取失败的展开目录", async () => {
    useFilesStore.setState({
      children: { "/chain": [entry("src", true)] },
      expanded: { "/chain": true, "/chain/src": true },
      dirErrors: { "/chain/src": "denied" },
    });
    mocks.listDir.mockImplementation(async (path: string) => ({
      "/chain": [entry("src", true)],
      "/chain/src": [entry("Main.java")],
    })[path] ?? []);
    await useFilesStore.getState().refreshTree();
    expect(mocks.listDir.mock.calls.map(([path]) => path).sort()).toEqual(["/chain", "/chain/src"]);
    expect(useFilesStore.getState().dirErrors["/chain/src"]).toBeUndefined();
    expect(useFilesStore.getState().children["/chain/src"]).toEqual([entry("Main.java")]);
  });

  it("单击途中被刷新顶替的首次读取，链条仍一次展开到底", async () => {
    const pending: Array<(entries: DirEntry[]) => void> = [];
    const listings: Record<string, DirEntry[]> = {
      "/chain": [entry("src", true)],
      "/chain/src": [entry("main", true)],
      "/chain/src/main": [entry("App.java")],
    };
    let srcCalls = 0;
    mocks.listDir.mockImplementation((path: string) => {
      if (path === "/chain/src" && srcCalls++ < 2) return new Promise<DirEntry[]>((resolve) => pending.push(resolve));
      return Promise.resolve(listings[path] ?? []);
    });
    const click = useFilesStore.getState().toggleCompactDir(["/chain/src"]);
    const refresh = useFilesStore.getState().refreshTree();
    // The click's own listing lands first, already superseded by the refresh.
    pending[0]([entry("main", true)]);
    await click;
    pending[1]([entry("main", true)]);
    await refresh;
    expect(useFilesStore.getState().expanded).toMatchObject({ "/chain/src": true, "/chain/src/main": true });
    expect(useFilesStore.getState().children["/chain/src/main"]).toEqual([entry("App.java")]);
  });

  it("文件夹名含反斜杠时（macOS/Linux）单击与显示仍按同一 Git 忽略状态判断", async () => {
    useFilesStore.setState({ children: {
      "/chain": [{ ...entry("x\\y", true), ignored: true }],
      "/chain/x\\y": [{ ...entry("gen", true), ignored: true }],
      "/chain/x\\y/gen": [{ ...entry("out.ts"), ignored: true }],
    } });
    await useFilesStore.getState().toggleCompactDir(["/chain/x\\y"]);
    const row = buildVisibleNodes({ ...useFilesStore.getState(), hideIgnored: false })[1];
    expect(row).toMatchObject({ name: "x\\y/gen", expanded: true });
  });

  it("磁盘根目录作为工作区时也记住展开路径", () => {
    useFilesStore.setState({ root: "C:\\", children: {}, expanded: { "C:\\": true, "C:\\src": true, "C:\\src/app": true, "C:\\gone/x": true } });
    expect(JSON.parse(localStorage.getItem(fileTreeWorkspaceKey("C:\\"))!)).toEqual({
      expanded: ["C:\\", "C:\\src", "C:\\src/app"],
    });
    localStorage.removeItem(fileTreeWorkspaceKey("C:\\"));
  });

  it("刷新不重读当前被隐藏的 Git 忽略目录", async () => {
    useFileTreePreferencesStore.setState({ hideIgnored: true });
    useFilesStore.setState({
      children: { "/chain": [{ ...entry("cache", true), ignored: true }], "/chain/cache": [] },
      expanded: { "/chain": true, "/chain/cache": true },
    });
    mocks.listDir.mockResolvedValue([]);
    await useFilesStore.getState().refreshTree();
    expect(mocks.listDir.mock.calls.map(([path]) => path)).toEqual(["/chain"]);
    // The hidden level is dropped instead of kept stale; it loads fresh
    // once the switch shows it again.
    expect(useFilesStore.getState().children["/chain/cache"]).toBeUndefined();
  });
});

describe("file tree Git refresh", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    mocks.listDir.mockResolvedValue([entry("file.txt")]);
    mocks.gitTreeStatus.mockResolvedValue(emptyStatus());
    mocks.gitRepositorySummaries.mockResolvedValue([]);
    mocks.gitFileColors.mockResolvedValue({});
    // `sub` was loaded and then collapsed: a refresh still re-reads it, so
    // reopening it (or a Git action's refresh) never shows an old listing.
    useFilesStore.setState({ root: "/repo", children: { "/repo": [entry("sub", true)], "/repo/sub": [] }, expanded: { "/repo": true }, loadingDirs: {}, dirErrors: {}, repositories: {}, fileColors: {}, refreshing: false });
  });

  it("batches all loaded levels instead of requesting a scan per directory", async () => {
    // The root keeps listing `sub`; a level its parent no longer lists is
    // dropped rather than refreshed.
    mocks.listDir.mockImplementation(async (path: string) => (path === "/repo" ? [entry("sub", true)] : [entry("file.txt")]));
    await useFilesStore.getState().refreshTree();
    expect(mocks.gitTreeStatus).toHaveBeenCalledTimes(1);
    expect(mocks.gitTreeStatus).toHaveBeenCalledWith([
      { path: "/repo", files: ["sub"], directories: ["sub"] },
      { path: "/repo/sub", files: ["file.txt"], directories: [] },
    ]);
    expect(mocks.gitFileColors).not.toHaveBeenCalled();
    expect(mocks.gitRepositorySummaries).not.toHaveBeenCalled();
  });

  it("keeps refreshing true until Git settles and rejects duplicate refreshes", async () => {
    vi.useFakeTimers();
    let finish!: (value: ReturnType<typeof emptyStatus>) => void;
    const pending = new Promise<ReturnType<typeof emptyStatus>>((resolve) => { finish = resolve; });
    mocks.gitTreeStatus.mockReturnValue(pending);
    mocks.gitFileColors.mockReturnValue(pending);
    const refresh = useFilesStore.getState().refreshTree();
    await vi.advanceTimersByTimeAsync(600);
    expect(useFilesStore.getState().refreshing).toBe(true);
    await useFilesStore.getState().refreshTree();
    expect(mocks.listDir).toHaveBeenCalledTimes(2);
    finish(emptyStatus());
    await refresh;
    expect(useFilesStore.getState().refreshing).toBe(false);
  });

  it("removes obsolete repository badges and colors after a successful refresh", async () => {
    useFilesStore.setState({ repositories: { "/repo": { path: "/repo", branch: "main", changed: 1, untracked: 0 } }, fileColors: { "/repo": { "file.txt": "modified" } } });
    await useFilesStore.getState().refreshTree();
    expect(useFilesStore.getState().repositories).toEqual({});
    expect(useFilesStore.getState().fileColors["/repo"]).toEqual({});
  });

  it("awaits Git when invalidating a directory and recovers from Git failure", async () => {
    let fail!: (error: Error) => void;
    mocks.gitTreeStatus.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    let settled = false;
    const refresh = useFilesStore.getState().invalidateDir("/repo").then(() => { settled = true; });
    await vi.waitFor(() => expect(mocks.gitTreeStatus).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    fail(new Error("Git unavailable"));
    await refresh;
    expect(settled).toBe(true);
    expect(useFilesStore.getState().children["/repo"]).toEqual([entry("file.txt")]);
  });

  it("retains cached Git state on failure and allows a fresh retry", async () => {
    useFilesStore.setState({ fileColors: { "/repo": { "file.txt": "modified" } } });
    mocks.gitTreeStatus.mockRejectedValueOnce(new Error("Git unavailable"));
    await useFilesStore.getState().refreshTree();
    expect(useFilesStore.getState().refreshing).toBe(false);
    expect(useFilesStore.getState().fileColors["/repo"]).toEqual({ "file.txt": "modified" });
    await useFilesStore.getState().refreshTree();
    expect(mocks.gitTreeStatus).toHaveBeenCalledTimes(2);
    expect(useFilesStore.getState().fileColors["/repo"]).toEqual({});
  });

  it("discards old Git replies after switching away and back to the same root", async () => {
    let finish!: (value: { repositories: []; fileColors: Record<string, Record<string, string>> }) => void;
    mocks.gitTreeStatus.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const refresh = useFilesStore.getState().refreshTree();
    await vi.waitFor(() => expect(mocks.gitTreeStatus).toHaveBeenCalledTimes(1));
    useFilesStore.getState().setRoot("");
    useFilesStore.getState().setRoot("/repo");
    await vi.waitFor(() => expect(mocks.gitTreeStatus).toHaveBeenCalledTimes(2));
    finish({ repositories: [], fileColors: { "/repo": { "stale.txt": "modified" } } });
    await refresh;
    expect(useFilesStore.getState().fileColors["/repo"]).toEqual({});
  });
});

/** list_dir 在后台线程跑，同一目录的两次列举可能乱序返回：只有最新一次能写入。 */
describe("file tree listings of one directory", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    mocks.gitTreeStatus.mockResolvedValue(emptyStatus());
    useFilesStore.setState({ root: "/repo", children: { "/repo": [entry("old.txt")] }, expanded: {}, loadingDirs: {}, dirErrors: {}, repositories: {}, fileColors: {}, refreshing: false });
  });

  function deferredListing() {
    let resolve!: (entries: DirEntry[]) => void;
    mocks.listDir.mockReturnValueOnce(new Promise<DirEntry[]>((r) => { resolve = r; }));
    return resolve;
  }

  it("asks for Git ignore flags bounded by the tree root", async () => {
    mocks.listDir.mockResolvedValue([entry("a.txt")]);
    await useFilesStore.getState().invalidateDir("/repo");
    expect(mocks.listDir).toHaveBeenCalledWith("/repo", { gitIgnoreRoot: "/repo" });
  });

  it("a refresh listing that resolves after a newer invalidate does not overwrite it", async () => {
    const finishRefresh = deferredListing();
    mocks.listDir.mockResolvedValueOnce([entry("renamed.txt")]);
    const refresh = useFilesStore.getState().refreshTree();
    await useFilesStore.getState().invalidateDir("/repo");
    expect(useFilesStore.getState().children["/repo"]).toEqual([entry("renamed.txt")]);

    finishRefresh([entry("before-rename.txt")]);
    await refresh;
    expect(useFilesStore.getState().children["/repo"]).toEqual([entry("renamed.txt")]);
    expect(useFilesStore.getState().refreshing).toBe(false);
  });

  it("a superseded first load still clears its loading flag", async () => {
    useFilesStore.setState({ children: { "/repo": [entry("sub", true)] }, expanded: { "/repo": true, "/repo/sub": true } });
    const finishLoad = deferredListing();
    mocks.listDir.mockImplementation(async (path: string) => (path === "/repo" ? [entry("sub", true)] : [entry("fresh.txt")]));
    const load = useFilesStore.getState().ensureDir("/repo/sub");
    await useFilesStore.getState().refreshTree();
    expect(useFilesStore.getState().children["/repo/sub"]).toEqual([entry("fresh.txt")]);

    finishLoad([entry("stale.txt")]);
    await load;
    expect(useFilesStore.getState().children["/repo/sub"]).toEqual([entry("fresh.txt")]);
    expect(useFilesStore.getState().loadingDirs["/repo/sub"]).toBeUndefined();
  });
});

/** 文件抢到中心时，其余中心面（插件中心/插件页/工作台/差异/浏览器）要让位，
 *  否则编辑器页签亮了，画面还停在原来那一面。 */
describe("文件打开时的中心面互斥", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFilesStore.setState({
      root: "/repo",
      children: {},
      expanded: {},
      loadingDirs: {},
      dirErrors: {},
      repositories: {},
      fileColors: {},
      refreshing: false,
      openFiles: [],
      fileStates: {},
      activeFilePath: null,
      dirtyPaths: {},
    });
    usePluginHubStore.setState({ open: true, active: true, view: "market" });
    usePluginTabsStore.setState({ tabs: ["plugin:demo:main"], activeId: "plugin:demo:main" });
    resetMissionStore();
    useMissionStore.setState({ open: true, active: true });
    useGitStore.setState({
      diffView: { workspacePath: "/repo", target: { file: "a.ts", staged: false } },
    });
  });

  afterEach(() => {
    usePluginHubStore.setState({ open: false, active: false, view: "market" });
    usePluginTabsStore.setState({ tabs: [], activeId: null });
    resetMissionStore();
    useGitStore.setState({ diffView: null });
  });

  function expectOnlyFileLeft() {
    expect(usePluginHubStore.getState().active).toBe(false);
    expect(usePluginTabsStore.getState().activeId).toBeNull();
    expect(useMissionStore.getState().active).toBe(false);
    expect(useGitStore.getState().diffView).toBeNull();
    expect(browserMock.deactivate).toHaveBeenCalled();
  }

  it("openFile（文件树/搜索/插件桥）让其他中心面靠边", async () => {
    await useFilesStore.getState().openFile("/repo/a.ts");
    expectOnlyFileLeft();
    expect(useFilesStore.getState().activeFilePath).toBe("/repo/a.ts");
  });

  it("activateFile（页签选择/已加载文件）同样清场", () => {
    useFilesStore.setState({
      fileStates: {
        "/repo/a.ts": {
          path: "/repo/a.ts",
          content: { kind: "text", text: "", dataUrl: null, truncated: false, readOnly: false },
          loading: false,
          error: null,
          loadNonce: 0,
        },
      },
    });
    useFilesStore.getState().activateFile("/repo/a.ts");
    expectOnlyFileLeft();
    expect(useFilesStore.getState().activeFilePath).toBe("/repo/a.ts");
  });
});

describe("native session editor tabs", () => {
  const session: SessionMeta = {
    engine: "omp", sessionId: "edited", workspacePath: "/repo",
    filePath: "/home/me/.omp/agent/sessions/repo/timestamp_edited.jsonl",
    fileSize: 2_000_000, fileMtimeMs: 1, title: "Edited", preview: "",
    createdAt: 1, updatedAt: 1, messageCount: 2, pinned: false, customTitle: null,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.writeSessionFile.mockImplementation(async (_engine: string, id: string, text: string) => ({ path: session.filePath, name: `${id}.json`, text, version: "saved" }));
    useFilesStore.setState({ openFiles: [], fileStates: {}, activeFilePath: null, dirtyPaths: {} });
  });

  it("opens a complete large source and keeps an unsaved draft when opened again", async () => {
    const text = "x".repeat(1_100_000);
    mocks.readSessionFile.mockResolvedValue({ path: session.filePath, name: "timestamp_edited.jsonl", text, version: "A" });
    await useFilesStore.getState().openSessionFile(session);
    const key = useFilesStore.getState().activeFilePath!;
    const entry = useFilesStore.getState().fileStates[key];
    expect(entry.content).toMatchObject({ text, truncated: false, kind: "text" });
    expect(entry.sourcePath).toBe(session.filePath);
    expect(entry.name).toBe("timestamp_edited.jsonl");
    useFilesStore.getState().setFileDirty(key, true);
    mocks.readSessionFile.mockResolvedValue({ path: session.filePath, name: "timestamp_edited.jsonl", text: "Externally changed", version: "B" });
    await useFilesStore.getState().openSessionFile(session);
    expect(useFilesStore.getState().fileStates[key]).toBe(entry);
    expect(useFilesStore.getState().dirtyPaths[key]).toBe(true);
    expect(useFilesStore.getState().openFiles).toEqual([key]);
  });

  it("two OpenCode sessions sharing one database remain independently editable", async () => {
    const one = { ...session, engine: "opencode", sessionId: "one", filePath: "/data/opencode.db\u001fone" };
    const two = { ...one, sessionId: "two", filePath: "/data/opencode.db\u001ftwo" };
    mocks.readSessionFile.mockImplementation(async (_engine: string, id: string) => ({ path: "/data/opencode.db", name: `${id}.json`, text: JSON.stringify({ sessionId: id }), version: id }));
    await useFilesStore.getState().openSessionFile(one);
    const oneKey = useFilesStore.getState().activeFilePath!;
    await useFilesStore.getState().openSessionFile(two);
    const twoKey = useFilesStore.getState().activeFilePath!;
    expect(oneKey).not.toBe(twoKey);
    expect(useFilesStore.getState().fileStates[oneKey].content?.text).toBe('{"sessionId":"one"}');
    expect(useFilesStore.getState().fileStates[twoKey].content?.text).toBe('{"sessionId":"two"}');
    await useFilesStore.getState().saveFile(oneKey, '{"sessionId":"one","text":"Edited"}');
    expect(useFilesStore.getState().fileStates[oneKey].content?.text).toBe('{"sessionId":"one","text":"Edited"}');
    expect(useFilesStore.getState().fileStates[twoKey].content?.text).toBe('{"sessionId":"two"}');
  });

  it("does not recreate a session editor closed during its initial read", async () => {
    const pending = Promise.withResolvers<any>();
    mocks.readSessionFile.mockReturnValueOnce(pending.promise);
    const opening = useFilesStore.getState().openSessionFile(session);
    const key = useFilesStore.getState().activeFilePath!;
    useFilesStore.getState().closeFile(key);
    pending.resolve({ path: session.filePath, name: "timestamp_edited.jsonl", text: "Late source", version: "late" });
    await opening;
    expect(useFilesStore.getState().fileStates[key]).toBeUndefined();
    expect(useFilesStore.getState().activeFilePath).toBeNull();
  });

  const document = (text: string, version = text) => ({ path: session.filePath, name: "edited.jsonl", text, version });

  it("reopens a clean tab with the appended turn and its current version", async () => {
    mocks.readSessionFile.mockResolvedValueOnce(document("A")).mockResolvedValueOnce(document("A+B"));
    await useFilesStore.getState().openSessionFile(session);
    const key = useFilesStore.getState().activeFilePath!;
    await useFilesStore.getState().openSessionFile(session);
    expect(useFilesStore.getState().fileStates[key]).toMatchObject({ content: { text: "A+B" }, version: "A+B", loadNonce: 2 });
    await useFilesStore.getState().saveFile(key, "A+B edited");
    expect(mocks.writeSessionFile).toHaveBeenLastCalledWith("omp", "edited", "A+B edited", "A+B", undefined, undefined);
  });

  it("retains the dirty version on conflict and advances it after each successful save", async () => {
    mocks.readSessionFile.mockResolvedValue(document("A"));
    await useFilesStore.getState().openSessionFile(session);
    const key = useFilesStore.getState().activeFilePath!;
    useFilesStore.getState().setFileDirty(key, true);
    mocks.writeSessionFile.mockRejectedValueOnce(new Error("SESSION_EDIT_CONFLICT"));
    await expect(useFilesStore.getState().saveFile(key, "draft")).rejects.toThrow();
    expect(useFilesStore.getState().fileStates[key]).toMatchObject({ content: { text: "A" }, version: "A" });
    expect(useFilesStore.getState().dirtyPaths[key]).toBe(true);
    await useFilesStore.getState().openSessionFile(session);
    expect(mocks.readSessionFile).toHaveBeenCalledTimes(1);
    await useFilesStore.getState().saveFile(key, "first");
    await useFilesStore.getState().saveFile(key, "second");
    expect(mocks.writeSessionFile).toHaveBeenLastCalledWith("omp", "edited", "second", "saved", undefined, undefined);
  });

  it("ignores an older read that resolves after the newest reopen", async () => {
    const old = Promise.withResolvers<SessionFileDocument>();
    mocks.readSessionFile.mockReturnValueOnce(old.promise).mockResolvedValueOnce(document("A+B"));
    const opening = useFilesStore.getState().openSessionFile(session);
    const key = useFilesStore.getState().activeFilePath!;
    await useFilesStore.getState().openSessionFile(session);
    old.resolve(document("A"));
    await opening;
    expect(useFilesStore.getState().fileStates[key]).toMatchObject({ content: { text: "A+B" }, version: "A+B" });
  });

  it("does not apply a late save to a closed and reopened session", async () => {
    mocks.readSessionFile.mockResolvedValueOnce(document("A")).mockResolvedValueOnce(document("A+B"));
    await useFilesStore.getState().openSessionFile(session);
    const key = useFilesStore.getState().activeFilePath!;
    const pending = Promise.withResolvers<SessionFileDocument>();
    mocks.writeSessionFile.mockReturnValueOnce(pending.promise);
    const saving = useFilesStore.getState().saveFile(key, "edited A");
    useFilesStore.getState().closeFile(key);
    await useFilesStore.getState().openSessionFile(session);
    pending.resolve(document("edited A"));
    await expect(saving).rejects.toThrow();
    expect(useFilesStore.getState().fileStates[key]).toMatchObject({ content: { text: "A+B" }, version: "A+B" });
  });

  it("blocks overlapping saves and reloads until the saved token is available", async () => {
    mocks.readSessionFile.mockResolvedValue(document("A"));
    await useFilesStore.getState().openSessionFile(session);
    const key = useFilesStore.getState().activeFilePath!;
    const pending = Promise.withResolvers<SessionFileDocument>();
    mocks.writeSessionFile.mockReturnValueOnce(pending.promise);
    const saving = useFilesStore.getState().saveFile(key, "edited");
    await useFilesStore.getState().openSessionFile(session);
    await expect(useFilesStore.getState().saveFile(key, "second")).rejects.toThrow();
    expect(mocks.readSessionFile).toHaveBeenCalledTimes(1);
    expect(mocks.writeSessionFile).toHaveBeenCalledTimes(1);
    pending.resolve(document("edited", "new-version"));
    await saving;
    await useFilesStore.getState().saveFile(key, "second");
    expect(mocks.writeSessionFile).toHaveBeenLastCalledWith("omp", "edited", "second", "new-version", undefined, undefined);
  });

  it("re-reads a conversation the chat already shows after a save, without switching to it", async () => {
    const original = useChatStore.getState();
    const reloadSession = vi.fn(async () => {});
    try {
      useChatStore.setState({ reloadSession, sessions: [session], bySession: {} });
      mocks.readSessionFile.mockResolvedValue(document("A"));
      await useFilesStore.getState().openSessionFile(session);
      const key = useFilesStore.getState().activeFilePath!;
      await useFilesStore.getState().saveFile(key, "not loaded in chat");
      expect(reloadSession).not.toHaveBeenCalled();

      useChatStore.setState({ bySession: { "omp/edited": {} as SessionState } });
      mocks.writeSessionFile.mockRejectedValueOnce(new Error("SESSION_EDIT_CONFLICT"));
      await expect(useFilesStore.getState().saveFile(key, "conflict")).rejects.toThrow();
      expect(reloadSession).not.toHaveBeenCalled();

      await useFilesStore.getState().saveFile(key, "saved and shown");
      expect(reloadSession).toHaveBeenCalledTimes(1);
      expect(reloadSession).toHaveBeenCalledWith(session);
      expect(useFilesStore.getState().activeFilePath).toBe(key);

      // A history load already running may have read the pre-save source:
      // re-read once after it settles, not during it.
      useChatStore.setState({ bySession: { "omp/edited": { loading: true } as SessionState } });
      await useFilesStore.getState().saveFile(key, "saved during a load");
      expect(reloadSession).toHaveBeenCalledTimes(1);
      useChatStore.setState({ bySession: { "omp/edited": { loading: false } as SessionState } });
      expect(reloadSession).toHaveBeenCalledTimes(2);
      useChatStore.setState({ bySession: { "omp/edited": { loading: false } as SessionState } });
      expect(reloadSession).toHaveBeenCalledTimes(2);
    } finally {
      useChatStore.setState(original, true);
    }
  });

  it("rejects edits without a source version", async () => {
    mocks.readSessionFile.mockResolvedValue({ path: session.filePath, name: "edited.jsonl", text: "A" });
    await useFilesStore.getState().openSessionFile(session);
    await expect(useFilesStore.getState().saveFile(useFilesStore.getState().activeFilePath!, "draft")).rejects.toThrow();
    expect(mocks.writeSessionFile).not.toHaveBeenCalled();
  });

  it("does not open an agy editor", async () => {
    await useFilesStore.getState().openSessionFile({ ...session, engine: "agy" });
    expect(mocks.readSessionFile).not.toHaveBeenCalled();
    expect(useFilesStore.getState().openFiles).toEqual([]);
  });

  it("rejects an agy save even if a caller supplies an editor entry", async () => {
    const key = "session:agy/edited";
    useFilesStore.setState({ fileStates: { [key]: {
      path: key, session: { ...session, engine: "agy" }, version: "old",
      content: { kind: "text", text: "old", dataUrl: null, truncated: false }, loading: false, error: null, loadNonce: 1,
    } } });
    await expect(useFilesStore.getState().saveFile(key, "new")).rejects.toThrow();
    expect(mocks.writeSessionFile).not.toHaveBeenCalled();
  });

  it("keeps ordinary file saves on the unversioned file API", async () => {
    const path = "/repo/notes.txt";
    useFilesStore.setState({ fileStates: { [path]: {
      path, content: { kind: "text", text: "old", dataUrl: null, truncated: false }, loading: false, error: null, loadNonce: 1,
    } } });
    await useFilesStore.getState().saveFile(path, "new");
    expect(mocks.writeFile).toHaveBeenCalledWith(path, "new");
    expect(mocks.writeSessionFile).not.toHaveBeenCalled();
    expect(useFilesStore.getState().fileStates[path].content?.text).toBe("new");
  });
});
