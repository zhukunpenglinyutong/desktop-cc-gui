import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import type { AiChatRepo } from "@/components/application/ai-chat/ai-chat-sidebar";
import type { SessionMeta, Workspace } from "@/lib/ipc";
import { useBrowserStore } from "@/features/browser/store";
import { useFilesStore } from "@/features/files/store";
import { useGitStore } from "@/features/git/store";
import { resetMissionStore, useMissionStore } from "@/features/mission/store";
import { usePluginHubStore } from "@/features/plugins/hub/store";
import { usePluginTabsStore } from "@/features/plugins/runtime/center-tabs";
import { useChatStore } from "./store";
import { useChatSidebar } from "./use-chat-sidebar";
import { ipc } from "@/lib/ipc";
import { pickDirectory } from "@/lib/platform";

vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: {
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    addWorkspaceRoot: vi.fn(async () => WS),
    removeWorkspaceRoot: vi.fn(async () => WS),
    listWorkspaces: vi.fn(async () => []),


  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));
vi.mock("@/lib/platform", () => ({
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
let dialogCalls: unknown[];

function Harness() {
  const streaming = useChatStore((s) => s.streamingByKey["codex/s-1"] === true);
  const retrying = useChatStore((s) => s.retryingByKey["codex/s-1"] === true);
  sidebar = useChatSidebar({
    sessionById: new Map(),
    threadStreaming: [streaming],
    threadRetrying: [retrying],
    collapseSidebarOnMobile: () => {},
    composerInputRef: { current: null },
    setDialog: (dialog) => dialogCalls.push(dialog),
  });
  captured = sidebar.repos;
  return null;
}

describe("useChatSidebar repo mapping", () => {
  beforeEach(async () => {
    dialogCalls = [];
    vi.mocked(pickDirectory).mockClear();
    vi.mocked(ipc.addWorkspaceRoot).mockClear();
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

  it("buildRepo 透传工作区多目录的附加根(单目录为空数组)", async () => {
    const MULTI = {
      ...WS,
      id: "w2",
      path: "/ws/multi",
      name: "multi",
      roots: ["/ws/multi-extra", "/ws/multi-more"],
    } as Workspace;
    await act(async () => {
      useChatStore.setState({ workspaces: [WS, MULTI], sessions: [SESSION] });
    });
    expect(captured.find((r) => r.id === "w2")?.roots).toEqual([
      "/ws/multi-extra",
      "/ws/multi-more",
    ]);
    // 单目录工作区的 roots 是空数组,不是 undefined。
    expect(captured.find((r) => r.id === "w1")?.roots).toEqual([]);
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
      roots: [],
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
      roots: [],
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

  it("「添加目录…」选中的目录作为附加根发给 IPC", async () => {
    vi.mocked(pickDirectory).mockResolvedValueOnce("/ws/extra");
    await act(async () => {
      sidebar.handleAddWorkspaceRoot("w1");
    });
    await act(async () => {});
    expect(ipc.addWorkspaceRoot).toHaveBeenCalledWith("w1", "/ws/extra");
  });

  it("「添加目录…」取消(返回 null)时不发 IPC", async () => {
    vi.mocked(pickDirectory).mockResolvedValueOnce(null);
    await act(async () => {
      sidebar.handleAddWorkspaceRoot("w1");
    });
    await act(async () => {});
    expect(ipc.addWorkspaceRoot).not.toHaveBeenCalled();
  });

  it("「移除目录…」打开移除对话框(不带主目录)", async () => {
    await act(async () => {
      sidebar.handleRemoveWorkspaceRoot("w1");
    });
    expect(dialogCalls).toContainEqual({ kind: "removeWorkspaceRoot", workspaceId: "w1" });
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
