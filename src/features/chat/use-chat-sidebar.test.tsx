import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import type { AiChatRepo } from "@/components/application/ai-chat/ai-chat-sidebar";
import { ipc, type SessionMeta, type Workspace } from "@/lib/ipc";
import { useBrowserStore } from "@/features/browser/store";
import { useFilesStore } from "@/features/files/store";
import { useGitStore } from "@/features/git/store";
import { resetMissionStore, useMissionStore } from "@/features/mission/store";
import { usePluginHubStore } from "@/features/plugins/hub/store";
import { usePluginTabsStore } from "@/features/plugins/runtime/center-tabs";
import { useChatStore } from "./store";
import { UNBOUND_DRAFT_KEY } from "./store/persistence";
import { useChatSidebar } from "./use-chat-sidebar";
// 命名空间导入：vi.mocked 必须走属性访问，命名导入会抛错。
import * as platform from "@/lib/platform";

vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: {
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    // 无工作区时 handleAddWorkspace 会走这条链路：登记目录 + 重读列表。
    addWorkspace: vi.fn(async () => {}),
    listWorkspaces: vi.fn(async () => []),

  
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));
// 展开真实模块再覆盖：`isWeb` 的真身在 transport、由 platform 再导出，
// 整个 mock 掉会把它的其它导出（含 isWeb）一并抹掉——handleAddWorkspace
// 第一行就读 isWeb，读不到会抛错并被它自己的 try/catch 吞掉，测试就会
// 误判成「没调用 addWorkspace」。
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  isWeb: false,
  pickDirectory: vi.fn(async () => null),
}));
// 聚焦助手自带 rAF 重试窗口，单测里只关心语义。
vi.mock("./focus-composer", () => ({ focusComposerWhenVisible: vi.fn() }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const WS: Workspace = {
  id: "w1",
  path: "/ws/a",
  name: "a",
  sortOrder: 0,
  groupId: null,
} as Workspace;

const SESSION: SessionMeta = {
  engine: "codex",
  sessionId: "s-1",
  workspacePath: "/ws/a",
  filePath: "/local/s-1.jsonl",
  fileSize: 1,
  fileMtimeMs: 1,
  title: "local",
  preview: "",
  createdAt: null,
  updatedAt: 1,
  messageCount: 1,
  pinned: false,
  customTitle: null,
};

let container: HTMLDivElement;
let root: Root;
let captured: AiChatRepo[];
let sidebar: ReturnType<typeof useChatSidebar>;

function Harness() {
  const streaming = useChatStore((s) => s.streamingByKey["codex/s-1"] === true);
  const retrying = useChatStore((s) => s.retryingByKey["codex/s-1"] === true);
  sidebar = useChatSidebar({
    sessionById: new Map(),
    threadStreaming: [streaming],
    threadRetrying: [retrying],
    collapseSidebarOnMobile: () => {},
    composerInputRef: { current: null },
    setDialog: () => {},
  });
  captured = sidebar.repos;
  return null;
}

describe("useChatSidebar repo mapping", () => {
  beforeEach(async () => {
    useChatStore.setState({
      workspaces: [WS],
      sessions: [SESSION],
      openTabs: [],
      threadLimit: 7,
      workspaceGroups: [],
      workspaceAliases: {},
      archivedWorkspaces: [],
      retryingByKey: {},
      streamingByKey: {},
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });
  });

  afterEach(async () => {
    await act(async () => {
      window.__ccguiWorkspaceUI?.registerHooks(null);
      root.unmount();
    });
    container.remove();
  });

  it("threadLimit 透传到 repo(分页折叠依赖它,删了设置就失效)", () => {
    expect(captured).toHaveLength(1);
    expect(captured[0]?.threadLimit).toBe(7);
    expect(captured[0]?.threads.map((t) => t.id)).toEqual(["codex/s-1"]);
  });

  it("pending 新对话出现在对应工作区线程列表顶部", async () => {
    await act(async () => {
      useChatStore.setState({
        openTabs: [{ engine: "codex", sessionId: null, workspacePath: "/ws/a" }],
        active: { engine: "codex", sessionId: null, workspacePath: "/ws/a" },
      });
    });
    expect(captured[0]?.threads.map((thread) => thread.id)).toEqual([
      "new:codex:/ws/a",
      "codex/s-1",
    ]);
    expect(captured[0]?.threads[0]).toMatchObject({
      label: "新对话",
      isDraft: true,
      engine: "codex",
    });
  });

  it("worktree 子工作区挂到父行下，标签用分支名并带 PR 元数据", async () => {
    const WT = {
      id: "wt1",
      path: "/ws/a-worktrees/pr-1842",
      name: "pr-1842",
      lastOpenedAt: null,
      sortOrder: 1,
      groupId: null,
      kind: "worktree",
      parentId: "w1",
      meta: { worktree: { branch: "pr-1842-fix-crash", prNumber: 1842 } },
    } as Workspace;
    await act(async () => {
      useChatStore.setState({
        workspaces: [WS, WT],
        sessions: [SESSION, { ...SESSION, sessionId: "s-wt", workspacePath: WT.path }],
      });
    });
    // 顶层只剩父行；子行连同自己的会话挂进 worktrees。
    expect(captured.map((r) => r.id)).toEqual(["w1"]);
    const child = captured[0]?.worktrees?.[0];
    expect(child).toMatchObject({
      id: "wt1",
      path: WT.path,
      label: "pr-1842-fix-crash",
      originalLabel: "pr-1842",
      worktree: { branch: "pr-1842-fix-crash", prNumber: 1842 },
    });
    expect(child?.threads.map((t) => t.id)).toEqual(["codex/s-wt"]);
  });

  it("父行不可见（已归档/被移除）时 worktree 降级为普通顶层行", async () => {
    const WT = {
      id: "wt1",
      path: "/ws/a-worktrees/pr-1842",
      name: "pr-1842",
      lastOpenedAt: null,
      sortOrder: 1,
      groupId: null,
      kind: "worktree",
      parentId: "w1",
      meta: { worktree: { branch: "pr-1842-fix-crash" } },
    } as Workspace;
    await act(async () => {
      useChatStore.setState({
        workspaces: [WS, WT],
        archivedWorkspaces: ["w1"],
      });
    });
    expect(captured.map((r) => r.id)).toEqual(["wt1"]);
    expect(captured[0]?.worktrees).toBeUndefined();
    expect(captured[0]?.label).toBe("pr-1842-fix-crash");
  });

  it("插件桥 hooks 注册后徽标响应式出现(activate/热重载不等无关重渲染)", async () => {
    expect(captured[0]?.labelSuffix).toBeUndefined();
    await act(async () => {
      window.__ccguiWorkspaceUI?.registerHooks({
        allowedEngines: () => null,
        labelSuffix: (p) => (p === "/ws/a" ? "WSL" : null),
      });
    });
    expect(captured[0]?.labelSuffix).toBe("WSL");
  });

  it("maps retrying state to the matching sidebar thread", async () => {
    await act(async () => {
      useChatStore.setState({
        streamingByKey: { "codex/s-1": true },
        retryingByKey: { "codex/s-1": true },
      });
    });

    expect(captured[0]?.threads[0]).toMatchObject({
      streaming: true,
      retrying: true,
    });
  });
});

/**
 * 中心面互斥：会话入口必须把中心区从其他面（插件中心页、插件页签、浏览器、
 * 任务工作台、文件、差异）切回对话，否则会话新建/选中了，画面却停在原处。
 */
describe("会话入口切回对话中心面", () => {
  beforeEach(async () => {
    useChatStore.setState({
      activeEngine: "codex",
      workspaces: [WS],
      sessions: [SESSION],
      openTabs: [],
      active: null,
      unseen: {},
    });
    useBrowserStore.setState({
      tabs: [{ id: "b1", url: "https://example.com", title: "example" }],
      activeId: "b1",
    });
    useFilesStore.setState({ activeFilePath: "/ws/a/x.ts" });
    useGitStore.setState({
      diffView: { workspacePath: "/ws/a", target: { file: "x.ts", staged: false } },
    });
    resetMissionStore();
    useMissionStore.setState({ open: true, active: true });
    usePluginHubStore.setState({ open: true, active: true, view: "market" });
    usePluginTabsStore.setState({ tabs: ["plugin:demo:main"], activeId: "plugin:demo:main" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    useBrowserStore.setState({ tabs: [], activeId: null });
    useFilesStore.setState({ activeFilePath: null });
    useGitStore.setState({ diffView: null });
    resetMissionStore();
    usePluginHubStore.setState({ open: false, active: false, view: "market" });
    usePluginTabsStore.setState({ tabs: [], activeId: null });
  });

  function expectOnlyChatLeft() {
    expect(usePluginHubStore.getState().active).toBe(false);
    expect(usePluginTabsStore.getState().activeId).toBeNull();
    expect(useBrowserStore.getState().activeId).toBeNull();
    expect(useMissionStore.getState().active).toBe(false);
    expect(useFilesStore.getState().activeFilePath).toBeNull();
    expect(useGitStore.getState().diffView).toBeNull();
  }

  it("新建会话（侧栏/+、快捷键走同一入口）切回对话", async () => {
    await act(async () => {
      sidebar.handleNewSession();
    });
    expectOnlyChatLeft();
    expect(useChatStore.getState().active).toEqual({
      engine: "codex",
      sessionId: null,
      workspacePath: "/ws/a",
    });
  });

  it("工作区行的 + 也切回对话", async () => {
    await act(async () => {
      sidebar.handleNewSessionInWorkspace("w1");
    });
    expectOnlyChatLeft();
    expect(useChatStore.getState().active).toMatchObject({ sessionId: null, workspacePath: "/ws/a" });
  });

  it("点击会话线程切回对话（草稿态走 focusTab）", async () => {
    await act(async () => {
      sidebar.handleThreadSelect("new:codex:/ws/a");
    });
    expectOnlyChatLeft();
  });

  it("新建浏览器页签时其他中心面让位（页签高亮与画面一致）", async () => {
    await act(async () => {
      sidebar.handleNewBrowser();
    });
    expect(usePluginHubStore.getState().active).toBe(false);
    expect(usePluginTabsStore.getState().activeId).toBeNull();
    expect(useMissionStore.getState().active).toBe(false);
    expect(useFilesStore.getState().activeFilePath).toBeNull();
    expect(useGitStore.getState().diffView).toBeNull();
    expect(useBrowserStore.getState().activeId).not.toBeNull();
  });
});

/**
 * 首启（零工作区）的「新建会话」：用户点的是「新会话」，所以选完目录必须
 * 接着把会话开出来——只登记目录会让输入框继续不可用，还看不出缺哪一步。
 * 对齐 worktree 创建完成的既有范式（worktree/store.ts 的
 * refreshWorkspaces().then(startNewChat)）。
 */
describe("首启无工作区时的新建会话", () => {
  beforeEach(async () => {
    useChatStore.setState({
      activeEngine: "codex",
      workspaces: [],
      sessions: [],
      openTabs: [],
      active: null,
      unseen: {},
      actionError: null,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.mocked(platform.pickDirectory).mockResolvedValue(null);
    vi.restoreAllMocks();
  });

  it("选完目录后直接开出待发会话，而不是停在「已登记工作区」", async () => {
    const picked = "/ws/picked";
    vi.mocked(platform.pickDirectory).mockResolvedValue(picked);
    // 断言落在 IPC 边界，而不是 spy store 的 addWorkspace：钩子在渲染时就把
    // store 上的动作引用读进了闭包，事后再 vi.spyOn 替换属性，钩子用的仍是
    // 旧引用（spy 永远 0 次）——测「真的登记了目录」要看它最终调用的 IPC。
    vi.mocked(ipc.addWorkspace).mockClear();

    await act(async () => {
      sidebar.handleNewSession();
      // 目录选择器是异步链路：等 addWorkspace 与随后的开会话落地。
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(platform.pickDirectory).toHaveBeenCalled();
    expect(ipc.addWorkspace).toHaveBeenCalledWith(picked, undefined);
    expect(useChatStore.getState().active).toEqual({
      engine: "codex",
      sessionId: null,
      workspacePath: picked,
    });
    expect(useChatStore.getState().openTabs).toEqual([
      { engine: "codex", sessionId: null, workspacePath: picked },
    ]);
  });

  it("取消目录选择时不建会话（不留空标签页）", async () => {
    vi.mocked(platform.pickDirectory).mockResolvedValue(null);

    await act(async () => {
      sidebar.handleNewSession();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useChatStore.getState().active).toBeNull();
    expect(useChatStore.getState().openTabs).toEqual([]);
  });

  it("登记失败时不建会话（不留下指向未登记目录的标签页）", async () => {
    // store.addWorkspace 会吞掉异常只留 actionError；若「新建会话」据此仍往
    // 下走，就会开出一个指向未登记目录的待发会话——正是要消灭的「输入框灰着」
    // 形态，所以它必须把成功与否报回来（Promise<boolean>）。
    vi.mocked(platform.pickDirectory).mockResolvedValue("/ws/denied");
    vi.mocked(ipc.addWorkspace).mockRejectedValueOnce(new Error("拒绝访问"));

    await act(async () => {
      sidebar.handleNewSession();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ipc.addWorkspace).toHaveBeenCalledWith("/ws/denied", undefined);
    expect(useChatStore.getState().active).toBeNull();
    expect(useChatStore.getState().openTabs).toEqual([]);
    // 失败原因仍要留给用户看（错误条由 store 负责）。
    expect(useChatStore.getState().actionError).toBeTruthy();
  });
});

/**
 * 还没有任何标签页时输入框仍可输入，字落在 drafts[""]（sessionKey 在
 * active === null 时返回空串）。这份草稿属于用户接下来的第一个会话，不能
 * 随着会话建立而变成永远读不回来的孤儿——其他键变化本来就会迁移草稿
 * （engine-events 的待发→真实 id、setActiveEngine 的引擎切换）。
 */
describe("首启草稿迁移", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    useChatStore.setState({
      activeEngine: "codex",
      workspaces: [],
      sessions: [],
      openTabs: [],
      active: null,
      unseen: {},
      drafts: {},
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    useChatStore.setState({ drafts: {} });
  });

  it("开会话时把无归属草稿搬过去，并清掉空键", () => {
    act(() => useChatStore.getState().setDraft(UNBOUND_DRAFT_KEY, "刚装好时敲的问题"));

    act(() => useChatStore.getState().startNewChat("/ws/a"));

    const drafts = useChatStore.getState().drafts;
    expect(drafts["new:codex:/ws/a"]).toBe("刚装好时敲的问题");
    expect(UNBOUND_DRAFT_KEY in drafts).toBe(false);
  });

  it("只搬一次：第二个工作区不会拿到同一份草稿", () => {
    act(() => useChatStore.getState().setDraft(UNBOUND_DRAFT_KEY, "只属于第一个会话"));

    act(() => useChatStore.getState().startNewChat("/ws/a"));
    act(() => useChatStore.getState().startNewChat("/ws/b"));

    const drafts = useChatStore.getState().drafts;
    expect(drafts["new:codex:/ws/a"]).toBe("只属于第一个会话");
    expect(drafts["new:codex:/ws/b"]).toBeUndefined();
  });

  it("目标键已有草稿时不覆盖它，无归属草稿仍留在空键上", () => {
    act(() => {
      useChatStore.getState().setDraft(UNBOUND_DRAFT_KEY, "无归属");
      useChatStore.getState().setDraft("new:codex:/ws/a", "这个会话自己的草稿");
    });

    act(() => useChatStore.getState().startNewChat("/ws/a"));

    const drafts = useChatStore.getState().drafts;
    expect(drafts["new:codex:/ws/a"]).toBe("这个会话自己的草稿");
    // 取舍 A：宁可不搬，也不静默丢弃用户已经敲下的字——草稿留在无归属键上，
    // 等下一个「还没有草稿的会话」接手（下一条用例钉住这个去向）。
    expect(drafts[UNBOUND_DRAFT_KEY]).toBe("无归属");
  });

  it("无归属草稿会被下一个还没有草稿的会话接手", () => {
    act(() => {
      useChatStore.getState().setDraft(UNBOUND_DRAFT_KEY, "无归属");
      useChatStore.getState().setDraft("new:codex:/ws/a", "这个会话自己的草稿");
    });

    act(() => useChatStore.getState().startNewChat("/ws/a")); // 已有草稿 → 不接手
    act(() => useChatStore.getState().startNewChat("/ws/b")); // 没有草稿 → 接手

    const drafts = useChatStore.getState().drafts;
    expect(drafts["new:codex:/ws/a"]).toBe("这个会话自己的草稿");
    expect(drafts["new:codex:/ws/b"]).toBe("无归属");
    expect(UNBOUND_DRAFT_KEY in drafts).toBe(false);
  });
});
