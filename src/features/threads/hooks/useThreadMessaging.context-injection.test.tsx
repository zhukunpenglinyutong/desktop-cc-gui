// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { useThreadMessaging } from "./useThreadMessaging";
import {
  engineSendMessage,
  sendUserMessage,
  projectMemoryCaptureAuto,
} from "../../../services/tauri";
import { projectMemoryFacade } from "../../project-memory/services/projectMemoryFacade";
import { noteCardsFacade } from "../../note-cards/services/noteCardsFacade";

vi.mock("@sentry/react", () => ({
  metrics: {
    count: vi.fn(),
  },
}));

vi.mock("./useReviewPrompt", () => ({
  useReviewPrompt: () => ({
    reviewPrompt: null,
    openReviewPrompt: vi.fn(),
    closeReviewPrompt: vi.fn(),
    showPresetStep: false,
    choosePreset: vi.fn(),
    highlightedPresetIndex: -1,
    setHighlightedPresetIndex: vi.fn(),
    highlightedBranchIndex: -1,
    setHighlightedBranchIndex: vi.fn(),
    highlightedCommitIndex: -1,
    setHighlightedCommitIndex: vi.fn(),
    handleReviewPromptKeyDown: vi.fn(),
    confirmBranch: vi.fn(),
    selectBranch: vi.fn(),
    selectBranchAtIndex: vi.fn(),
    selectCommit: vi.fn(),
    selectCommitAtIndex: vi.fn(),
    confirmCommit: vi.fn(),
    updateCustomInstructions: vi.fn(),
    confirmCustom: vi.fn(),
  }),
}));

vi.mock("../../../services/tauri", () => ({
  sendUserMessage: vi.fn(),
  startReview: vi.fn(),
  interruptTurn: vi.fn(),
  listMcpServerStatus: vi.fn(),
  engineSendMessage: vi.fn(),
  engineInterruptTurn: vi.fn(),
  engineInterrupt: vi.fn(),
  projectMemoryCaptureAuto: vi.fn(),
}));

vi.mock("../../project-memory/services/projectMemoryFacade", () => ({
  projectMemoryFacade: {
    list: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock("../../note-cards/services/noteCardsFacade", () => ({
  noteCardsFacade: {
    get: vi.fn(),
  },
}));

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "ws",
  path: "/tmp/ws",
  connected: true,
  settings: { sidebarCollapsed: false },
};

function buildHook(engine: "claude" | "codex", dispatch = vi.fn()) {
  return renderHook(() =>
    useThreadMessaging({
      activeWorkspace: workspace,
      activeThreadId: engine === "claude" ? "claude:session-1" : "thread-1",
      steerEnabled: false,
      customPrompts: [],
      activeEngine: engine,
      threadStatusById: {},
      itemsByThread: {},
      activeTurnIdByThread: {},
      codexAcceptedTurnByThread: {},
      tokenUsageByThread: {},
      rateLimitsByWorkspace: {},
      pendingInterruptsRef: { current: new Set<string>() },
      interruptedThreadsRef: { current: new Set<string>() },
      dispatch,
      getCustomName: vi.fn(),
      getThreadEngine: vi.fn(),
      markProcessing: vi.fn(),
      markReviewing: vi.fn(),
      setActiveTurnId: vi.fn(),
      recordThreadActivity: vi.fn(),
      safeMessageActivity: vi.fn(),
      onDebug: vi.fn(),
      pushThreadErrorMessage: vi.fn(),
      ensureThreadForActiveWorkspace: vi.fn(),
      ensureThreadForWorkspace: vi.fn(),
      refreshThread: vi.fn(),
      forkThreadForWorkspace: vi.fn(),
      updateThreadParent: vi.fn(),
      startThreadForWorkspace: vi.fn(),
      onInputMemoryCaptured: vi.fn(),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(projectMemoryCaptureAuto).mockResolvedValue(null);
  vi.mocked(projectMemoryFacade.list).mockResolvedValue({
    items: [],
    total: 0,
  } as never);
  vi.mocked(projectMemoryFacade.get).mockResolvedValue(null);
  vi.mocked(noteCardsFacade.get).mockResolvedValue(null);
});

describe("useThreadMessaging context injection", () => {
  it("does not auto inject memory block on claude path", async () => {
    vi.mocked(engineSendMessage).mockResolvedValue({
      result: { turn: { id: "turn-1" } },
    } as never);

    const { result } = buildHook("claude");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude:session-1",
        "数据库查询优化",
        [],
        { skipPromptExpansion: true },
      );
    });

    const payload = vi.mocked(engineSendMessage).mock.calls[0]?.[1] as any;
    expect(payload.text).toBe("数据库查询优化");
  });

  it("injects selected memories with detail mode by default on codex path", async () => {
    vi.mocked(sendUserMessage).mockResolvedValue({
      result: { turn: { id: "turn-2" } },
    } as never);
    vi.mocked(projectMemoryFacade.get).mockResolvedValue({
      id: "m-1",
      workspaceId: "ws-1",
      kind: "known_issue",
      title: "数据库连接池超时",
      summary: "数据库连接池超时",
      detail: "用户输入：数据库连接池超时怎么办\n助手输出摘要：优先检查连接上限与超时设置",
      cleanText: "",
      tags: ["数据库"],
      importance: "high",
      source: "manual",
      fingerprint: "fp",
      createdAt: 1,
      updatedAt: 1,
    } as never);

    const { result } = buildHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "数据库查询优化",
        [],
        {
          skipPromptExpansion: true,
          selectedMemoryIds: ["m-1"],
        },
      );
    });

    const textArg = vi.mocked(sendUserMessage).mock.calls[0]?.[2] as string;
    expect(textArg.startsWith("<project-memory")).toBe(true);
    expect(textArg).toContain('source="manual-selection"');
    expect(textArg).toContain("用户输入：数据库连接池超时怎么办");
    expect(textArg).toContain("数据库查询优化");
    expect(projectMemoryFacade.get).toHaveBeenCalledWith("m-1", "ws-1");
  });

  it("supports summary mode for selected memory injection on codex path", async () => {
    vi.mocked(sendUserMessage).mockResolvedValue({
      result: { turn: { id: "turn-2b" } },
    } as never);
    vi.mocked(projectMemoryFacade.get).mockResolvedValue({
      id: "m-2",
      workspaceId: "ws-1",
      kind: "known_issue",
      title: "数据库连接池超时",
      summary: "这是 summary 内容",
      detail: "这段 detail 不应被注入",
      cleanText: "",
      tags: ["数据库"],
      importance: "high",
      source: "manual",
      fingerprint: "fp",
      createdAt: 1,
      updatedAt: 1,
    } as never);

    const { result } = buildHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "数据库查询优化",
        [],
        {
          skipPromptExpansion: true,
          selectedMemoryIds: ["m-2"],
          selectedMemoryInjectionMode: "summary",
        },
      );
    });

    const textArg = vi.mocked(sendUserMessage).mock.calls[0]?.[2] as string;
    expect(textArg).toContain("这是 summary 内容");
    expect(textArg).not.toContain("这段 detail 不应被注入");
  });

  it("ignores localStorage contextInjectionEnabled=true and keeps plain text", async () => {
    window.localStorage.setItem("projectMemory.contextInjectionEnabled", "true");
    vi.mocked(sendUserMessage).mockResolvedValue({
      result: { turn: { id: "turn-3" } },
    } as never);

    const { result } = buildHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "plain-text",
        [],
        { skipPromptExpansion: true },
      );
    });

    const textArg = vi.mocked(sendUserMessage).mock.calls[0]?.[2] as string;
    expect(textArg).toBe("plain-text");
  });

  it("inserts a separate note-card context summary item and keeps note images in the injected context", async () => {
    const dispatch = vi.fn();
    vi.mocked(sendUserMessage).mockResolvedValue({
      result: { turn: { id: "turn-note-1" } },
    } as never);
    vi.mocked(noteCardsFacade.get).mockResolvedValue({
      id: "note-1",
      workspaceId: "ws-1",
      workspaceName: "ws",
      workspacePath: "/tmp/ws",
      projectName: "ws",
      title: "发布清单",
      bodyMarkdown: "先构建，再发布",
      plainTextExcerpt: "先构建，再发布",
      attachments: [
        {
          id: "attachment-1",
          fileName: "deploy.png",
          contentType: "image/png",
          relativePath: "deploy.png",
          absolutePath: "/tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png",
          sizeBytes: 4,
        },
      ],
      createdAt: 1,
      updatedAt: 2,
      archivedAt: null,
    } as never);

    const { result } = buildHook("codex", dispatch);

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "请按这个执行",
        [],
        {
          skipPromptExpansion: true,
          selectedNoteCardIds: ["note-1"],
        },
      );
    });

    const textArg = vi.mocked(sendUserMessage).mock.calls[0]?.[2] as string;
    const optionsArg = vi.mocked(sendUserMessage).mock.calls[0]?.[3] as
      | { images?: string[] }
      | undefined;
    expect(textArg).toContain("<note-card-context>");
    expect(textArg).toContain('title="发布清单"');
    expect(optionsArg?.images).toEqual([
      "/tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png",
    ]);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "upsertItem",
        item: expect.objectContaining({
          kind: "message",
          role: "assistant",
          text: expect.stringContaining("【便签上下文】"),
        }),
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "upsertItem",
        item: expect.objectContaining({
          kind: "message",
          role: "user",
          text: expect.stringContaining("<note-card-context>"),
          images: ["/tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png"],
        }),
      }),
    );
  });
});
