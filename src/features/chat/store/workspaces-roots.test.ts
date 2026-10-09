import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/ipc";
import { ipc } from "@/lib/ipc";
import { useChatStore } from "../store";

/** 工作区多目录:附加根的增删 store 动作。覆盖「主目录不可移除」这一不变量
 *  与「后端拒绝(如路径不存在)原样进 actionError」的失败可见性。 */
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: {
    listWorkspaces: vi.fn(async () => []),
    addWorkspaceRoot: vi.fn(),
    removeWorkspaceRoot: vi.fn(),
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

const WS: Workspace = {
  id: "w1",
  path: "/ws/main",
  name: "main",
  lastOpenedAt: null,
  sortOrder: 0,
  groupId: null,
  roots: ["/ws/extra"],
};

function reset() {
  vi.mocked(ipc.addWorkspaceRoot).mockReset();
  vi.mocked(ipc.removeWorkspaceRoot).mockReset();
  vi.mocked(ipc.listWorkspaces).mockReset();
  vi.mocked(ipc.listWorkspaces).mockResolvedValue([]);
  useChatStore.setState({ workspaces: [WS], actionError: null });
}

describe("工作区多目录 store 动作", () => {
  beforeEach(reset);

  it("添加附加根调用 IPC 并刷新工作区", async () => {
    vi.mocked(ipc.addWorkspaceRoot).mockResolvedValue({ ...WS, roots: [...WS.roots, "/ws/new"] });
    await useChatStore.getState().addWorkspaceRoot("w1", "/ws/new");
    expect(ipc.addWorkspaceRoot).toHaveBeenCalledWith("w1", "/ws/new");
    expect(ipc.listWorkspaces).toHaveBeenCalled();
    expect(useChatStore.getState().actionError).toBeNull();
  });

  it("添加失败(如路径不存在)把可读错误落进 actionError", async () => {
    vi.mocked(ipc.addWorkspaceRoot).mockRejectedValue("not a directory: /nope");
    await useChatStore.getState().addWorkspaceRoot("w1", "/nope");
    expect(useChatStore.getState().actionError).toContain("not a directory: /nope");
  });

  it("移除附加根调用 IPC", async () => {
    vi.mocked(ipc.removeWorkspaceRoot).mockResolvedValue({ ...WS, roots: [] });
    await useChatStore.getState().removeWorkspaceRoot("w1", "/ws/extra");
    expect(ipc.removeWorkspaceRoot).toHaveBeenCalledWith("w1", "/ws/extra");
    expect(useChatStore.getState().actionError).toBeNull();
  });

  it("主目录不可移除:传主目录路径时不发 IPC", async () => {
    await useChatStore.getState().removeWorkspaceRoot("w1", "/ws/main");
    expect(ipc.removeWorkspaceRoot).not.toHaveBeenCalled();
  });

  it("移除失败也落进 actionError", async () => {
    vi.mocked(ipc.removeWorkspaceRoot).mockRejectedValue("unknown workspace: w1");
    await useChatStore.getState().removeWorkspaceRoot("w1", "/ws/extra");
    expect(useChatStore.getState().actionError).toContain("unknown workspace: w1");
  });
});
