import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntry } from "@/lib/ipc";

const mocks = vi.hoisted(() => ({
  listDir: vi.fn(),
  readFile: vi.fn(async () => ({ kind: "text", text: "", dataUrl: null, truncated: false })),
  gitTreeStatus: vi.fn(),
  gitRepositorySummaries: vi.fn(),
  gitFileColors: vi.fn(),
}));
const browserMock = vi.hoisted(() => ({ deactivate: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: mocks }));
vi.mock("@/features/browser/store", () => ({
  useBrowserStore: { getState: () => browserMock },
}));
import { useGitStore } from "@/features/git/store";
import { resetMissionStore, useMissionStore } from "@/features/mission/store";
import { usePluginHubStore } from "@/features/plugins/hub/store";
import { usePluginTabsStore } from "@/features/plugins/runtime/center-tabs";
import { FILE_TREE_FILTER_KEY, fileTreeWorkspaceKey, useFilesStore } from "./store";
import { DEFAULT_FILE_TREE_FILTER } from "./file-tree-filter";

const entry = (name: string, isDir = false): DirEntry => ({ name, isDir, size: 0, mtimeMs: 0 });
const emptyStatus = () => ({ repositories: [], fileColors: {} });

describe("file tree Git refresh", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    mocks.listDir.mockResolvedValue([entry("file.txt")]);
    mocks.gitTreeStatus.mockResolvedValue(emptyStatus());
    mocks.gitRepositorySummaries.mockResolvedValue([]);
    mocks.gitFileColors.mockResolvedValue({});
    useFilesStore.setState({ root: "/repo", children: { "/repo": [], "/repo/sub": [] }, expanded: {}, loadingDirs: {}, dirErrors: {}, repositories: {}, fileColors: {}, refreshing: false });
  });

  it("batches all loaded levels instead of requesting a scan per directory", async () => {
    await useFilesStore.getState().refreshTree();
    expect(mocks.gitTreeStatus).toHaveBeenCalledTimes(1);
    expect(mocks.gitTreeStatus).toHaveBeenCalledWith([
      { path: "/repo", files: ["file.txt"], directories: [] },
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

describe("已加载目录的批量展开与收起", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useFilesStore.setState({
      root: "/repo",
      children: {
        "/repo": [entry("a", true), entry("unloaded", true)],
        "/repo/a": [entry("b", true)],
        "/repo/a/b": [entry("file.txt")],
      },
      expanded: { "/repo": true },
      loadingDirs: {},
      filterConfig: DEFAULT_FILE_TREE_FILTER,
    });
  });

  it("只展开已加载且仍在树中的目录，不读取磁盘", () => {
    useFilesStore.getState().expandLoadedDirs();
    expect(useFilesStore.getState().expanded).toEqual({
      "/repo": true,
      "/repo/a": true,
      "/repo/a/b": true,
    });
    expect(mocks.listDir).not.toHaveBeenCalled();
  });

  it("不会展开被过滤的已加载目录", () => {
    useFilesStore.setState({
      children: {
        "/repo": [entry("a", true), entry(".hidden", true), entry("dist", true)],
        "/repo/a": [],
        "/repo/.hidden": [],
        "/repo/dist": [],
      },
    });
    useFilesStore.getState().expandLoadedDirs();
    expect(useFilesStore.getState().expanded).toEqual({ "/repo": true, "/repo/a": true });
    expect(mocks.listDir).not.toHaveBeenCalled();
  });

  it("收起全部时保留工作区根目录展开", () => {
    useFilesStore.getState().expandLoadedDirs();
    useFilesStore.getState().collapseAllDirs();
    expect(useFilesStore.getState().expanded).toEqual({ "/repo": true });
  });

  it("合并行展开最深层，再次点击收起整行", async () => {
    mocks.listDir.mockResolvedValue([entry("file.txt")]);
    mocks.gitTreeStatus.mockResolvedValue(emptyStatus());
    await useFilesStore.getState().toggleCompactDir(["/repo/a", "/repo/a/b"]);
    expect(useFilesStore.getState().expanded["/repo/a/b"]).toBe(true);
    expect(mocks.listDir).not.toHaveBeenCalled();
    await useFilesStore.getState().toggleCompactDir(["/repo/a", "/repo/a/b"]);
    expect(useFilesStore.getState().expanded["/repo/a"]).toBeUndefined();
  });
});

describe("文件树工作区记忆", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listDir.mockResolvedValue([]);
    mocks.gitTreeStatus.mockResolvedValue(emptyStatus());
    localStorage.removeItem(fileTreeWorkspaceKey("/memory-a"));
    localStorage.removeItem(fileTreeWorkspaceKey("/memory-b"));
    localStorage.removeItem(FILE_TREE_FILTER_KEY);
    useFilesStore.setState({ root: "", children: {}, expanded: {}, filterConfig: DEFAULT_FILE_TREE_FILTER });
  });

  it("分别恢复各工作区的展开路径和过滤规则", () => {
    useFilesStore.getState().setRoot("/memory-a");
    useFilesStore.setState({ expanded: { "/memory-a": true, "/memory-a/src": true } });
    useFilesStore.getState().setFilterConfig({
      ignorePatterns: ["*.log"], dotWhitelist: [".github"],
    });
    useFilesStore.getState().setRoot("/memory-b");
    expect(useFilesStore.getState().expanded).toEqual({ "/memory-b": true });
    expect(useFilesStore.getState().filterConfig).toEqual(DEFAULT_FILE_TREE_FILTER);
    useFilesStore.getState().setFilterConfig({
      ignorePatterns: ["temp/"], dotWhitelist: [".claude"],
    });
    useFilesStore.getState().setRoot("/memory-a");
    expect(useFilesStore.getState().expanded).toEqual({
      "/memory-a": true, "/memory-a/src": true,
    });
    expect(useFilesStore.getState().filterConfig.ignorePatterns).toEqual(["*.log"]);
    expect(JSON.parse(localStorage.getItem(fileTreeWorkspaceKey("/memory-b"))!).filterConfig.ignorePatterns)
      .toEqual(["temp/"]);
  });

  it("根目录手动收起后仍保持收起，并忽略损坏的存储内容", async () => {
    useFilesStore.getState().setRoot("/memory-a");
    await useFilesStore.getState().toggleDir("/memory-a");
    useFilesStore.getState().setRoot("/memory-b");
    useFilesStore.getState().setRoot("/memory-a");
    expect(useFilesStore.getState().expanded["/memory-a"]).toBeUndefined();

    localStorage.setItem(fileTreeWorkspaceKey("/memory-a"), "{bad json");
    useFilesStore.getState().setRoot("/memory-b");
    useFilesStore.getState().setRoot("/memory-a");
    expect(useFilesStore.getState().expanded).toEqual({ "/memory-a": true });
  });

  it("将旧版全局过滤配置用于未建立状态的新工作区", () => {
    localStorage.setItem(FILE_TREE_FILTER_KEY, JSON.stringify({
      ignorePatterns: ["legacy/"], dotWhitelist: [".github"],
    }));
    useFilesStore.getState().setRoot("/memory-a");
    expect(useFilesStore.getState().filterConfig.ignorePatterns).toEqual(["legacy/"]);
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
