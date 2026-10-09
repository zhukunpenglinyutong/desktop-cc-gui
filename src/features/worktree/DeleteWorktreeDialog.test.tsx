import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import type { Workspace } from "@/lib/ipc";
import { useChatStore } from "@/features/chat/store";
import { useTerminalStore } from "@/features/terminal/store";
import { useWorktreeStore } from "./store";

const gitStatusMock = vi.fn();
const gitBranchMergedMock = vi.fn();
const gitWorktreeListMock = vi.fn();
const gitWorktreeRemoveMock = vi.fn();
const removeWorkspaceMock = vi.fn(async () => {});
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: {
    gitStatus: (...args: unknown[]) => gitStatusMock(...args),
    gitBranchMerged: (...args: unknown[]) => gitBranchMergedMock(...args),
    gitWorktreeList: (...args: unknown[]) => gitWorktreeListMock(...args),
    gitWorktreeRemove: (...args: unknown[]) => gitWorktreeRemoveMock(...args),
  },
}));

import { DeleteWorktreeDialog } from "./DeleteWorktreeDialog";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const PARENT: Workspace = {
  id: "p1",
  path: "/repo/app",
  name: "app",
  lastOpenedAt: null,
  sortOrder: 0,
  groupId: null,
} as Workspace;

const WT: Workspace = {
  id: "wt1",
  path: "/repo/app-worktrees/pr-1842",
  name: "pr-1842",
  lastOpenedAt: null,
  sortOrder: 1,
  groupId: null,
  kind: "worktree",
  parentId: "p1",
  roots: [],
  meta: { worktree: { branch: "pr-1842-fix", baseRef: "main" } },
} as Workspace;

let container: HTMLDivElement;
let root: Root;
let closed: boolean;

function render(workspace: Workspace = WT) {
  closed = false;
  act(() => {
    root.render(<DeleteWorktreeDialog workspace={workspace} onClose={() => (closed = true)} />);
  });
}

// ModalShell 走 portal 渲染到 body，查询必须在 document.body 上做。
function button(text: string): HTMLButtonElement | null {
  return [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) ?? null;
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

describe("DeleteWorktreeDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({ workspaces: [PARENT, WT], openTabs: [], streamingByKey: {} });
    useTerminalStore.setState({ tabsByWorkspace: {} });
    useWorktreeStore.setState({ lockedPaths: {}, missingPaths: {} });
    gitStatusMock.mockResolvedValue({
      branch: "pr-1842-fix",
      ahead: 1,
      staged: [{ path: "src/session.rs", status: "M" }],
      unstaged: [{ path: "README.md", status: "M" }],
      untracked: [],
    });
    gitBranchMergedMock.mockResolvedValue(false);
    gitWorktreeListMock.mockResolvedValue([
      { path: WT.path, branch: "pr-1842-fix", head: "aaa", isMain: false, locked: false, prunable: false },
    ]);
    gitWorktreeRemoveMock.mockResolvedValue({ orphanDirectory: false, branchDeleted: false });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    removeWorkspaceMock.mockClear();
  });

  it("预检展示未提交/未推送/未合入三类警告", async () => {
    render();
    await act(async () => {});
    const text = bodyText();
    expect(text).toContain("2 个文件有未提交变更");
    expect(text).toContain("1 个提交未推送");
    expect(text).toContain("未合入 main");
    expect(gitStatusMock).toHaveBeenCalledWith(WT.path);
    expect(gitBranchMergedMock).toHaveBeenCalledWith(PARENT.path, "pr-1842-fix", "main");
  });

  it("全干净时只显示安全提示", async () => {
    gitStatusMock.mockResolvedValue({ branch: "b", staged: [], unstaged: [], untracked: [] });
    gitBranchMergedMock.mockResolvedValue(true);
    render();
    await act(async () => {});
    const text = bodyText();
    expect(text).toContain("没有未提交或未推送的改动");
    // 不出现三类警告行（分支勾选提示里本来就含「未合入」字样，不能粗暴断言）。
    expect(text).not.toContain("有未提交变更");
    expect(text).not.toContain("个提交未推送");
    expect(text).not.toContain("分支 pr-1842-fix 未合入");
  });

  it("locked 的 worktree 禁提交并说明原因", async () => {
    gitWorktreeListMock.mockResolvedValue([
      { path: WT.path, branch: "b", head: "aaa", isMain: false, locked: true, lockReason: "out on loan", prunable: false },
    ]);
    render();
    await act(async () => {});
    expect(bodyText()).toContain("out on loan");
    const submit = button("删除 Worktree")!;
    expect(submit.disabled).toBe(true);
  });

  it("勾选删除分支后按钮文案升级，提交走后台删除并立即关闭", async () => {
    useChatStore.setState({ removeWorkspace: removeWorkspaceMock } as never);
    render();
    await act(async () => {});
    expect(button("删除 Worktree 和分支")).toBeNull();

    const checkbox = document.body.querySelector('input[type="checkbox"]') ??
      document.body.querySelector("[role=checkbox]");
    expect(checkbox).not.toBeNull();
    await act(async () => {
      (checkbox as HTMLElement).click();
    });
    const submit = button("删除 Worktree 和分支")!;
    expect(submit.disabled).toBe(false);

    await act(async () => {
      submit.click();
    });
    // 即关：后台 remove 异步完成，但对话框已关闭。
    expect(closed).toBe(true);
    await vi.waitFor(() => expect(gitWorktreeRemoveMock).toHaveBeenCalledWith(
      PARENT.path,
      WT.path,
      "pr-1842-fix",
      true,
    ));
  });

  it("父工作区缺失时退化为仅移除登记（不碰 git）", async () => {
    useChatStore.setState({ workspaces: [WT] });
    // removeWorkspace 走 chat store 的真实 action → ipc.removeWorkspace；这里
    // 换成 spy 验证「仅登记移除、无 git 调用」的语义。
    useChatStore.setState({ removeWorkspace: removeWorkspaceMock } as never);
    render();
    await act(async () => {});
    expect(bodyText()).toContain("无法定位主仓库");
    const submit = button("移除登记")!;
    await act(async () => {
      submit.click();
    });
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(gitWorktreeRemoveMock).not.toHaveBeenCalled();
    expect(removeWorkspaceMock).toHaveBeenCalledWith(WT.id);
  });
});
