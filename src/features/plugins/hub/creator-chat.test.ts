import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatorSkillReport, Workspace } from "@/lib/ipc";

const creatorSkillInstall = vi.fn(async (): Promise<CreatorSkillReport> => ({
  source: "/app/skills/ccgui-plugin-creator",
  targets: [
    {
      root: "/home/u/.claude/skills",
      path: "/home/u/.claude/skills/ccgui-plugin-creator",
      action: "current",
      error: null,
    },
  ],
}));
vi.mock("@/lib/ipc", () => ({
  ipc: { creatorSkillInstall: () => creatorSkillInstall() },
}));

import { useChatStore } from "@/features/chat/store";
import { usePluginHubStore } from "./store";
import { CREATOR_SKILL_COMMAND, creatorChatWorkspace, startCreatorChat } from "./creator-chat";

/**
 * 「创建插件」的入口动作：开一个新会话、把内置 skill 的调用预填进去、把中心面
 * 从插件 hub 切回聊天。composer ref 的聚焦归 ChatCenterPane（它才有 ref），
 * 这里只断言语义。
 */
const WORKSPACE: Workspace = {
  id: "ws-1",
  path: "/tmp/ws-1",
  name: "ws-1",
  lastOpenedAt: null,
  sortOrder: null,
  groupId: null,
  roots: [],
};

describe("creator chat entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePluginHubStore.setState({ open: true, active: true, view: "market" });
    useChatStore.setState({
      activeEngine: "claude",
      workspaces: [WORKSPACE],
      openTabs: [],
      active: null,
      drafts: {},
    });
  });

  it("prefers the active session's workspace, else the first one", () => {
    const other: Workspace = { ...WORKSPACE, id: "ws-2", path: "/tmp/ws-2", name: "ws-2" };
    expect(creatorChatWorkspace(null, [WORKSPACE, other])?.path).toBe("/tmp/ws-1");
    expect(
      creatorChatWorkspace(
        { engine: "claude", sessionId: "s1", workspacePath: other.path },
        [WORKSPACE, other],
      )?.path,
    ).toBe("/tmp/ws-2");
    expect(creatorChatWorkspace(null, [])).toBeNull();
  });

  it("opens a new chat, seeds the skill command and leaves the hub", () => {
    const key = startCreatorChat(WORKSPACE.path);

    const state = useChatStore.getState();
    expect(state.active).toEqual({
      engine: "claude",
      sessionId: null,
      workspacePath: WORKSPACE.path,
    });
    expect(state.drafts[key]).toBe(CREATOR_SKILL_COMMAND);
    // `/${name} `：与 `/` 选择器插入的 token 一致，引擎才认得出是 skill 调用。
    expect(CREATOR_SKILL_COMMAND).toBe("/ccgui-plugin-creator ");
    expect(usePluginHubStore.getState().active).toBe(false);
    // skill 落盘是 best-effort：调用一次，失败不影响开新会话。
    expect(creatorSkillInstall).toHaveBeenCalledTimes(1);
  });

  it("still opens the chat when the skill install fails", async () => {
    creatorSkillInstall.mockRejectedValueOnce(new Error("resource missing"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const key = startCreatorChat(WORKSPACE.path);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useChatStore.getState().drafts[key]).toBe(CREATOR_SKILL_COMMAND);
    expect(warn).toHaveBeenCalledWith(
      "[creator-skill] install failed",
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it("warns when no engine could take the skill (a dead command must be diagnosable)", async () => {
    creatorSkillInstall.mockResolvedValueOnce({
      source: null,
      targets: [],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    startCreatorChat(WORKSPACE.path);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warn).toHaveBeenCalledWith(
      "[creator-skill] not available for any engine",
      expect.objectContaining({ source: null }),
    );
    warn.mockRestore();
  });
});
