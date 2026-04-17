// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem, WorkspaceInfo } from "../../../types";
import { useThreadMessaging } from "./useThreadMessaging";
import {
  engineInterruptTurn,
  engineInterrupt,
  engineSendMessage,
  getGitLog,
  getOpenCodeLspDocumentSymbols,
  getOpenCodeLspSymbols,
  getOpenCodeMcpStatus,
  getWorkspaceFiles,
  importOpenCodeSession,
  interruptTurn,
  listGitBranches,
  listExternalSpecTree,
  listGeminiSessions,
  listMcpServerStatus,
  sendUserMessage,
  startReview as startReviewService,
} from "../../../services/tauri";
import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";
import { pushErrorToast } from "../../../services/toasts";
import { sendSharedSessionTurn } from "../../shared-session/runtime/sendSharedSessionTurn";

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

vi.mock("../../../services/tauri", () => ({
  sendUserMessage: vi.fn(),
  startReview: vi.fn(),
  interruptTurn: vi.fn(),
  listMcpServerStatus: vi.fn(),
  getOpenCodeMcpStatus: vi.fn(),
  getOpenCodeLspDiagnostics: vi.fn(),
  getOpenCodeLspSymbols: vi.fn(),
  getOpenCodeLspDocumentSymbols: vi.fn(),
  importOpenCodeSession: vi.fn(),
  exportOpenCodeSession: vi.fn(),
  getOpenCodeStats: vi.fn(),
  getWorkspaceFiles: vi.fn(),
  shareOpenCodeSession: vi.fn(),
  listExternalSpecTree: vi.fn(),
  listGitBranches: vi.fn(),
  getGitLog: vi.fn(),
  listGeminiSessions: vi.fn(),
  engineSendMessage: vi.fn(),
  engineInterruptTurn: vi.fn(),
  engineInterrupt: vi.fn(),
}));

vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("../../shared-session/runtime/sendSharedSessionTurn", () => ({
  sendSharedSessionTurn: vi.fn(),
}));

describe("useThreadMessaging", () => {
  const workspace: WorkspaceInfo = {
    id: "ws-1",
    name: "ccgui",
    path: "/tmp/mossx",
    connected: true,
    settings: { sidebarCollapsed: false },
  };
  const windowsWorkspace: WorkspaceInfo = {
    id: "ws-win",
    name: "ccgui-Win",
    path: "C:\\repo\\mossx",
    connected: true,
    settings: { sidebarCollapsed: false },
  };
  const noPathWorkspace: WorkspaceInfo = {
    id: "ws-nopath",
    name: "ccgui-NoPath",
    path: "",
    connected: true,
    settings: { sidebarCollapsed: false },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientStoreSync).mockReturnValue(undefined);
    vi.mocked(engineSendMessage).mockResolvedValue({
      result: { turn: { id: "turn-1" } },
    });
    vi.mocked(sendUserMessage).mockResolvedValue({
      result: { turn: { id: "turn-2" } },
    });
    vi.mocked(getOpenCodeMcpStatus).mockResolvedValue({ text: "No MCP servers configured" });
    vi.mocked(getWorkspaceFiles).mockResolvedValue({
      files: ["openspec/changes/add-spec-hub/proposal.md", "openspec/changes/add-spec-hub/tasks.md"],
      directories: ["openspec", "openspec/changes", "openspec/specs"],
      gitignored_files: [],
      gitignored_directories: [],
    });
    vi.mocked(listExternalSpecTree).mockResolvedValue({
      files: ["openspec/changes/add-spec-hub/proposal.md", "openspec/changes/add-spec-hub/tasks.md"],
      directories: ["openspec", "openspec/changes", "openspec/specs"],
      gitignored_files: [],
      gitignored_directories: [],
    });
    vi.mocked(listGitBranches).mockResolvedValue({
      branches: [
        { name: "main", lastCommit: 2000 },
        { name: "release/1.0", lastCommit: 1500 },
      ],
    });
    vi.mocked(listGeminiSessions).mockResolvedValue([]);
    vi.mocked(getGitLog).mockResolvedValue({
      total: 2,
      ahead: 0,
      behind: 0,
      aheadEntries: [],
      behindEntries: [],
      upstream: "origin/main",
      entries: [
        { sha: "abc1234", summary: "fix dropdown", author: "chen", timestamp: 2000 },
        { sha: "def5678", summary: "refactor review", author: "chen", timestamp: 1500 },
      ],
    });
    vi.mocked(listMcpServerStatus).mockResolvedValue({ result: { data: [] } });
    vi.mocked(getOpenCodeLspSymbols).mockResolvedValue({ query: "Thread", result: [] });
    vi.mocked(importOpenCodeSession).mockResolvedValue({
      sessionId: "ses_test",
      source: "/tmp/session.json",
      output: "Imported session: ses_test",
    });
    vi.mocked(engineInterrupt).mockResolvedValue();
    vi.mocked(engineInterruptTurn).mockResolvedValue();
    vi.mocked(interruptTurn).mockResolvedValue({});
    vi.mocked(writeClientStoreValue).mockImplementation(() => undefined);
    vi.mocked(sendSharedSessionTurn).mockResolvedValue({
      result: { turn: { id: "shared-turn-1" } },
    });
  });

  function makeHook(
    activeEngine: "claude" | "codex" | "gemini" | "opencode",
    overrides: {
      workspace?: WorkspaceInfo;
      activeThreadId?: string;
      ensuredThreadId?: string;
      activeTurnIdByThread?: Record<string, string | null>;
      threadEngineById?: Record<string, "claude" | "codex" | "gemini" | "opencode" | undefined>;
      itemsByThread?: Record<string, ConversationItem[]>;
      startThreadForWorkspace?: ReturnType<typeof vi.fn>;
      refreshThread?: ReturnType<typeof vi.fn>;
      dispatch?: ReturnType<typeof vi.fn>;
    } = {},
  ) {
    const activeThreadId = overrides.activeThreadId ?? "thread-1";
    const ensuredThreadId = overrides.ensuredThreadId ?? activeThreadId;
    const dispatch = overrides.dispatch ?? vi.fn();
    const markProcessing = vi.fn();
    const markReviewing = vi.fn();
    const setActiveTurnId = vi.fn();
    const recordThreadActivity = vi.fn();
    const safeMessageActivity = vi.fn();
    const pushThreadErrorMessage = vi.fn();
    const onDebug = vi.fn();
    const pendingInterruptsRef = { current: new Set<string>() };
    const interruptedThreadsRef = { current: new Set<string>() };

    const startThreadForWorkspace =
      overrides.startThreadForWorkspace ??
      vi.fn(async () => ensuredThreadId);
    const refreshThread = overrides.refreshThread ?? vi.fn(async () => null);

    const hook = renderHook(() =>
      useThreadMessaging({
        activeWorkspace: overrides.workspace ?? workspace,
        activeThreadId,
        accessMode: "current",
        model: null,
        effort: null,
        collaborationMode: null,
        steerEnabled: false,
        customPrompts: [],
        activeEngine,
        threadStatusById: {},
        itemsByThread: overrides.itemsByThread ?? {},
        activeTurnIdByThread: overrides.activeTurnIdByThread ?? {},
        tokenUsageByThread: {},
        rateLimitsByWorkspace: {},
        pendingInterruptsRef,
        interruptedThreadsRef,
        dispatch,
        getCustomName: () => undefined,
        getThreadEngine: (_workspaceId, threadId) =>
          overrides.threadEngineById?.[threadId] ?? undefined,
        getThreadKind: (_workspaceId, threadId) =>
          threadId.startsWith("shared:") ? "shared" : "native",
        markProcessing,
        markReviewing,
        setActiveTurnId,
        recordThreadActivity,
        safeMessageActivity,
        pushThreadErrorMessage,
        ensureThreadForActiveWorkspace: async () => ensuredThreadId,
        ensureThreadForWorkspace: async () => ensuredThreadId,
        refreshThread,
        forkThreadForWorkspace: async () => null,
        updateThreadParent: vi.fn(),
        startThreadForWorkspace,
        onDebug,
      }),
    );
    return {
      ...hook,
      dispatch,
      markProcessing,
      markReviewing,
      setActiveTurnId,
      recordThreadActivity,
      safeMessageActivity,
      pushThreadErrorMessage,
      onDebug,
      pendingInterruptsRef,
      interruptedThreadsRef,
    };
  }

  it("routes opencode thread through engineSendMessage", async () => {
    const { result } = makeHook("opencode");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "opencode-pending-abc",
        "hello opencode",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ engine: "opencode" }),
    );
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("normalizes unsupported shared-session sends back to claude", async () => {
    const dispatch = vi.fn();
    const { result } = makeHook("gemini", {
      activeThreadId: "shared:thread-1",
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-1",
        "hello shared",
      );
    });

    expect(sendSharedSessionTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        threadId: "shared:thread-1",
        engine: "claude",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadEngine",
        threadId: "shared:thread-1",
        engine: "claude",
      }),
    );
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("uses active shared engine selection instead of stale thread engine when sending", async () => {
    const dispatch = vi.fn();
    const { result } = makeHook("claude", {
      activeThreadId: "shared:thread-sticky-engine",
      dispatch,
      threadEngineById: {
        "shared:thread-sticky-engine": "codex",
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-sticky-engine",
        "切回 claude 后继续发送",
      );
    });

    expect(sendSharedSessionTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        threadId: "shared:thread-sticky-engine",
        engine: "claude",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadEngine",
        workspaceId: "ws-1",
        threadId: "shared:thread-sticky-engine",
        engine: "claude",
      }),
    );
  });

  it("hides shared native thread id returned from shared send response", async () => {
    const dispatch = vi.fn();
    vi.mocked(sendSharedSessionTurn).mockResolvedValue({
      result: { turn: { id: "shared-turn-2" } },
      nativeThreadId: "550e8400-e29b-41d4-a716-446655440000",
    });
    const { result } = makeHook("codex", {
      activeThreadId: "shared:thread-2",
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-2",
        "hello shared hide native",
      );
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "hideThread",
        workspaceId: "ws-1",
        threadId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    );
  });

  it("passes custom spec root through cli engine send when configured", async () => {
    vi.mocked(getClientStoreSync).mockImplementation((_store, key) => {
      if (key === "specHub.specRoot.ws-1") {
        return "/tmp/external-openspec";
      }
      return undefined;
    });
    const { result } = makeHook("opencode");

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "opencode-pending-abc", "hello");
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        customSpecRoot: "/tmp/external-openspec",
      }),
    );
  });

  it("sanitizes leaked claude model for opencode", async () => {
    const { result } = makeHook("opencode");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "opencode-pending-abc",
        "hello opencode",
        [],
        { model: "claude-sonnet-4-5" },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        model: "openai/gpt-5.3-codex",
      }),
    );
  });

  it("sanitizes leaked claude model for codex", async () => {
    const { result } = makeHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello codex",
        [],
        { model: "claude-sonnet-4-5" },
      );
    });

    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "hello codex",
      expect.objectContaining({
        model: null,
      }),
    );
  });

  it("keeps custom claude model ids for claude engine", async () => {
    const { result } = makeHook("claude");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
        [],
        { model: "GLM-5.1" },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "GLM-5.1",
      }),
    );
  });

  it("keeps custom claude model ids with slash/colon/brackets for claude engine", async () => {
    const { result } = makeHook("claude");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
        [],
        { model: "provider/model:202603[beta]" },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "provider/model:202603[beta]",
      }),
    );
  });

  it("sanitizes invalid claude model ids for claude engine", async () => {
    const { result, onDebug } = makeHook("claude");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
        [],
        { model: "bad model with spaces" },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: null,
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "model/sanitize",
        payload: expect.objectContaining({
          reason: "invalid-claude-model",
          model: "bad model with spaces",
        }),
      }),
    );
  });

  it("sanitizes overlong claude model ids for claude engine", async () => {
    const { result, onDebug } = makeHook("claude");
    const overlongModelId = `m${"x".repeat(128)}`;

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
        [],
        { model: overlongModelId },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: null,
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "model/sanitize",
        payload: expect.objectContaining({
          reason: "invalid-claude-model",
          model: overlongModelId,
        }),
      }),
    );
  });

  it("sanitizes leaked codex default model for gemini", async () => {
    const { result } = makeHook("gemini");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "gemini-pending-abc",
        "hello gemini",
        [],
        { model: "openai/gpt-5.3-codex" },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "gemini",
        model: null,
      }),
    );
  });

  it("keeps custom gemini model aliases for gemini engine", async () => {
    const { result } = makeHook("gemini");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "gemini-pending-abc",
        "hello gemini",
        [],
        { model: "123" },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "gemini",
        model: "123",
      }),
    );
  });

  it("clears gemini interrupted guard before a new send starts", async () => {
    const { result, interruptedThreadsRef } = makeHook("gemini");
    interruptedThreadsRef.current.add("gemini:session-1");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "gemini:session-1",
        "hello again",
      );
    });

    expect(interruptedThreadsRef.current.has("gemini:session-1")).toBe(false);
    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "gemini",
        threadId: "gemini:session-1",
      }),
    );
  });

  it.each([
    ["claude", "claude:session-1"],
    ["codex", "thread-1"],
    ["opencode", "opencode:session-1"],
  ] as const)(
    "clears stale interrupted guard before a new %s send starts",
    async (engine, threadId) => {
      const { result, interruptedThreadsRef } = makeHook(engine, {
        activeThreadId: threadId,
        ensuredThreadId: threadId,
        threadEngineById:
          engine === "codex"
            ? { [threadId]: "codex" }
            : { [threadId]: engine },
      });
      interruptedThreadsRef.current.add(threadId);

      await act(async () => {
        await result.current.sendUserMessageToThread(
          workspace,
          threadId,
          "hello again",
        );
      });

      expect(interruptedThreadsRef.current.has(threadId)).toBe(false);
    },
  );

  it("does not trigger auto title generation for opencode", async () => {
    const { result } = makeHook("opencode");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "opencode-pending-abc",
        "hello opencode",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not trigger auto title generation for codex", async () => {
    const { result } = makeHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "thread-1", "hello codex");
    });

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it("does not trigger auto title generation for claude", async () => {
    const { result } = makeHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude:session-1",
        "hello claude",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
  });

  it("reuses response-derived session id for follow-up sends on claude pending thread", async () => {
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        sessionId: "session-xyz",
        result: { turn: { id: "turn-1" }, sessionId: "session-xyz" },
      })
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-2" } },
      });
    const { result } = makeHook("claude", {
      activeThreadId: "claude-pending-abc",
      ensuredThreadId: "claude-pending-abc",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-abc",
        "hello claude",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-abc",
        "follow up",
      );
    });

    expect(engineSendMessage).toHaveBeenNthCalledWith(
      1,
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        continueSession: false,
        sessionId: null,
        threadId: "claude-pending-abc",
      }),
    );
    expect(engineSendMessage).toHaveBeenNthCalledWith(
      2,
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        continueSession: true,
        sessionId: "session-xyz",
        threadId: "claude-pending-abc",
      }),
    );
  });

  it("accepts snake_case claude session_id for pending thread follow-up sends", async () => {
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        result: {
          turn: { id: "turn-1" },
          session_id: "session-snake",
        },
      })
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-2" } },
      });
    const { result } = makeHook("claude", {
      activeThreadId: "claude-pending-snake",
      ensuredThreadId: "claude-pending-snake",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-snake",
        "hello claude",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-snake",
        "follow up",
      );
    });

    expect(engineSendMessage).toHaveBeenNthCalledWith(
      2,
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        continueSession: true,
        sessionId: "session-snake",
        threadId: "claude-pending-snake",
      }),
    );
  });

  it("reuses discovered gemini session id for follow-up sends on pending thread", async () => {
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-g1" } },
      })
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-g2" } },
      });
    vi.mocked(listGeminiSessions).mockResolvedValueOnce([
      {
        sessionId: "gem-session-xyz",
        updatedAt: Date.now(),
      },
    ]);
    const { result } = makeHook("gemini", {
      activeThreadId: "gemini-pending-abc",
      ensuredThreadId: "gemini-pending-abc",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "gemini-pending-abc",
        "hello gemini",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "gemini-pending-abc",
        "follow up",
      );
    });

    expect(engineSendMessage).toHaveBeenNthCalledWith(
      1,
      "ws-1",
      expect.objectContaining({
        engine: "gemini",
        continueSession: false,
        sessionId: null,
        threadId: "gemini-pending-abc",
      }),
    );
    expect(engineSendMessage).toHaveBeenNthCalledWith(
      2,
      "ws-1",
      expect.objectContaining({
        engine: "gemini",
        continueSession: true,
        sessionId: "gem-session-xyz",
        threadId: "gemini-pending-abc",
      }),
    );
  });

  it("does not bind gemini pending thread when session fallback is ambiguous", async () => {
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-g1" } },
      })
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-g2" } },
      });
    vi.mocked(listGeminiSessions).mockResolvedValueOnce([
      {
        sessionId: "gem-session-a",
        updatedAt: Date.now(),
      },
      {
        sessionId: "gem-session-b",
        updatedAt: Date.now(),
      },
    ]);
    const { result } = makeHook("gemini", {
      activeThreadId: "gemini-pending-ambiguous",
      ensuredThreadId: "gemini-pending-ambiguous",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "gemini-pending-ambiguous",
        "hello gemini",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "gemini-pending-ambiguous",
        "follow up",
      );
    });

    expect(engineSendMessage).toHaveBeenNthCalledWith(
      2,
      "ws-1",
      expect.objectContaining({
        engine: "gemini",
        continueSession: false,
        sessionId: null,
        threadId: "gemini-pending-ambiguous",
      }),
    );
  });

  it("does not treat thread id as claude session id fallback", async () => {
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        result: {
          turn: { id: "turn-1" },
          thread: { id: "claude:session-from-thread-id" },
        },
      })
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-2" } },
      });
    const { result } = makeHook("claude", {
      activeThreadId: "claude-pending-def",
      ensuredThreadId: "claude-pending-def",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-def",
        "hello claude",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-def",
        "follow up",
      );
    });

    expect(engineSendMessage).toHaveBeenNthCalledWith(
      2,
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        continueSession: false,
        sessionId: null,
        threadId: "claude-pending-def",
      }),
    );
  });

  it("routes by thread ownership when active engine mismatches", async () => {
    const { result } = makeHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "opencode-pending-abc",
        "hello opencode",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ engine: "opencode" }),
    );
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("uses opencode MCP command path when engine is opencode", async () => {
    const { result } = makeHook("opencode");
    await act(async () => {
      await result.current.startMcp("/mcp");
    });
    expect(getOpenCodeMcpStatus).toHaveBeenCalledWith("ws-1");
  });

  it("opens review preset and supports base-branch/commit third-level steps", async () => {
    const { result } = makeHook("codex");

    await act(async () => {
      await result.current.startReview("/review");
    });

    await waitFor(() => {
      expect(result.current.reviewPrompt?.step).toBe("preset");
      expect(result.current.reviewPrompt?.isLoadingBranches).toBe(false);
      expect(result.current.reviewPrompt?.isLoadingCommits).toBe(false);
    });

    expect(result.current.reviewPrompt?.branches.length).toBeGreaterThan(0);
    expect(result.current.reviewPrompt?.commits.length).toBeGreaterThan(0);

    await act(async () => {
      result.current.choosePreset("baseBranch");
    });
    expect(result.current.reviewPrompt?.step).toBe("baseBranch");

    await act(async () => {
      result.current.showPresetStep();
      result.current.choosePreset("commit");
    });
    expect(result.current.reviewPrompt?.step).toBe("commit");
  });

  it("runs uncommitted preset directly without entering third-level list", async () => {
    const { result } = makeHook("codex");

    await act(async () => {
      await result.current.startReview("/review");
    });

    await waitFor(() => {
      expect(result.current.reviewPrompt?.step).toBe("preset");
    });

    await act(async () => {
      result.current.choosePreset("uncommitted");
    });

    await waitFor(() => {
      expect(startReviewService).toHaveBeenCalledWith(
        "ws-1",
        "thread-1",
        { type: "uncommittedChanges" },
        "inline",
      );
      expect(result.current.reviewPrompt).toBeNull();
    });
  });

  it("runs /review in claude thread via command passthrough instead of codex RPC", async () => {
    const { result } = makeHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
      threadEngineById: {
        "claude:session-1": "claude",
      },
    });

    await act(async () => {
      await result.current.startReview("/review");
    });

    await waitFor(() => {
      expect(result.current.reviewPrompt?.step).toBe("preset");
    });

    await act(async () => {
      result.current.choosePreset("uncommitted");
    });

    await waitFor(() => {
      expect(engineSendMessage).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({
          engine: "claude",
          threadId: "claude:session-1",
          text: "/review",
        }),
      );
      expect(startReviewService).not.toHaveBeenCalled();
      expect(result.current.reviewPrompt).toBeNull();
    });
  });

  it("ignores /review-like custom commands in review entrypoint", async () => {
    const { result } = makeHook("codex");

    await act(async () => {
      await result.current.startReview("/review-code run full check");
      await result.current.startReview("/review:custom run");
      await result.current.startReview("/review_custom run");
      await result.current.startReview("/review.custom run");
    });

    expect(result.current.reviewPrompt).toBeNull();
    expect(listGitBranches).not.toHaveBeenCalled();
    expect(getGitLog).not.toHaveBeenCalled();
    expect(startReviewService).not.toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
  });

  it("rebinds /review to a codex thread when the active thread is claude", async () => {
    const startThreadForWorkspace = vi.fn(async () => "thread-review-1");
    const { result } = makeHook("codex", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
      threadEngineById: {
        "claude:session-1": "claude",
      },
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.startReview("/review");
    });

    await waitFor(() => {
      expect(result.current.reviewPrompt?.step).toBe("preset");
    });

    await act(async () => {
      result.current.choosePreset("uncommitted");
    });

    await waitFor(() => {
      expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
        activate: true,
        engine: "codex",
      });
      expect(startReviewService).toHaveBeenCalledWith(
        "ws-1",
        "thread-review-1",
        { type: "uncommittedChanges" },
        "inline",
      );
      expect(result.current.reviewPrompt).toBeNull();
    });
  });

  it("retries /review on a new codex thread when backend rejects legacy thread id", async () => {
    vi.mocked(startReviewService)
      .mockResolvedValueOnce({
        error: {
          message:
            "invalid thread id: invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `l` at 2",
        },
      } as never)
      .mockResolvedValueOnce({ result: { ok: true } } as never);
    const startThreadForWorkspace = vi.fn(async () => "thread-review-rebound");
    const { result } = makeHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.startReview("/review");
    });

    await waitFor(() => {
      expect(result.current.reviewPrompt?.step).toBe("preset");
    });

    await act(async () => {
      result.current.choosePreset("uncommitted");
    });

    await waitFor(() => {
      expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
        activate: true,
        engine: "codex",
      });
      expect(startReviewService).toHaveBeenNthCalledWith(
        1,
        "ws-1",
        "legacy-thread-id",
        { type: "uncommittedChanges" },
        "inline",
      );
      expect(startReviewService).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-review-rebound",
        { type: "uncommittedChanges" },
        "inline",
      );
      expect(result.current.reviewPrompt).toBeNull();
    });
  });

  it("uses thread engine for MCP command path when active engine mismatches", async () => {
    const { result } = makeHook("codex", {
      activeThreadId: "opencode:session-1",
      ensuredThreadId: "opencode:session-1",
    });

    await act(async () => {
      await result.current.startMcp("/mcp");
    });

    expect(getOpenCodeMcpStatus).toHaveBeenCalledWith("ws-1");
    expect(listMcpServerStatus).not.toHaveBeenCalled();
  });

  it("supports /lsp symbols command on opencode", async () => {
    const { result } = makeHook("opencode");
    await act(async () => {
      await result.current.startLsp("/lsp symbols Thread");
    });
    expect(getOpenCodeLspSymbols).toHaveBeenCalledWith("ws-1", "Thread");
  });

  it("supports /lsp document-symbols with Windows absolute path", async () => {
    vi.mocked(getOpenCodeLspDocumentSymbols).mockResolvedValue({
      fileUri: "file:///C:/repo/mossx/src/main.ts",
      result: [],
    });
    const { result } = makeHook("opencode", {
      workspace: windowsWorkspace,
      activeThreadId: "opencode:ses-win",
      ensuredThreadId: "opencode:ses-win",
    });

    await act(async () => {
      await result.current.startLsp("/lsp document-symbols C:\\repo\\mossx\\src\\main.ts");
    });

    expect(getOpenCodeLspDocumentSymbols).toHaveBeenCalledWith(
      "ws-win",
      "file:///C:/repo/mossx/src/main.ts",
    );
  });

  it("supports /lsp document-symbols with Windows extended absolute path", async () => {
    vi.mocked(getOpenCodeLspDocumentSymbols).mockResolvedValue({
      fileUri: "file:///C:/repo/mossx/src/main.ts",
      result: [],
    });
    const { result } = makeHook("opencode", {
      workspace: windowsWorkspace,
      activeThreadId: "opencode:ses-win",
      ensuredThreadId: "opencode:ses-win",
    });

    await act(async () => {
      await result.current.startLsp("/lsp document-symbols \\\\?\\C:\\repo\\mossx\\src\\main.ts");
    });

    expect(getOpenCodeLspDocumentSymbols).toHaveBeenCalledWith(
      "ws-win",
      "file:///C:/repo/mossx/src/main.ts",
    );
  });

  it("supports /lsp document-symbols with Windows relative path", async () => {
    vi.mocked(getOpenCodeLspDocumentSymbols).mockResolvedValue({
      fileUri: "file:///C:/repo/mossx/src/main.ts",
      result: [],
    });
    const { result } = makeHook("opencode", {
      workspace: windowsWorkspace,
      activeThreadId: "opencode:ses-win",
      ensuredThreadId: "opencode:ses-win",
    });

    await act(async () => {
      await result.current.startLsp("/lsp document-symbols src/main.ts");
    });

    expect(getOpenCodeLspDocumentSymbols).toHaveBeenCalledWith(
      "ws-win",
      "file:///C:/repo/mossx/src/main.ts",
    );
  });

  it("keeps relative LSP document path when workspace path is empty", async () => {
    vi.mocked(getOpenCodeLspDocumentSymbols).mockResolvedValue({
      fileUri: "src/main.ts",
      result: [],
    });
    const { result } = makeHook("opencode", {
      workspace: noPathWorkspace,
      activeThreadId: "opencode:ses-no-path",
      ensuredThreadId: "opencode:ses-no-path",
    });

    await act(async () => {
      await result.current.startLsp("/lsp document-symbols src/main.ts");
    });

    expect(getOpenCodeLspDocumentSymbols).toHaveBeenCalledWith(
      "ws-nopath",
      "src/main.ts",
    );
  });

  it("supports /lsp symbols based on thread ownership when active engine mismatches", async () => {
    const { result } = makeHook("codex", {
      activeThreadId: "opencode:session-1",
      ensuredThreadId: "opencode:session-1",
    });

    await act(async () => {
      await result.current.startLsp("/lsp symbols Thread");
    });

    expect(getOpenCodeLspSymbols).toHaveBeenCalledWith("ws-1", "Thread");
  });

  it("supports /import command on opencode", async () => {
    const { result } = makeHook("opencode");
    await act(async () => {
      await result.current.startImport("/import /tmp/session.json");
    });
    expect(importOpenCodeSession).toHaveBeenCalledWith("ws-1", "/tmp/session.json");
  });

  it("interrupt routes codex thread through daemon rpc even when active engine is opencode", async () => {
    const { result } = makeHook("opencode", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      activeTurnIdByThread: { "thread-1": "turn-1" },
      threadEngineById: { "thread-1": "codex" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(interruptTurn).toHaveBeenCalledWith("ws-1", "thread-1", "turn-1");
    expect(engineInterrupt).toHaveBeenCalledWith("ws-1");
  });

  it("shows fusion-specific stop copy when interrupt is triggered for queue fusion", async () => {
    const { result, dispatch } = makeHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      activeTurnIdByThread: { "thread-1": "turn-1" },
      threadEngineById: { "thread-1": "codex" },
    });

    await act(async () => {
      await result.current.interruptTurn({ reason: "queue-fusion" });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "addAssistantMessage",
      threadId: "thread-1",
      text: "已切换到融合回复，内容正在继续生成。",
    });
  });

  it("keeps the default stop copy for a normal manual interrupt", async () => {
    const { result, dispatch } = makeHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      activeTurnIdByThread: { "thread-1": "turn-1" },
      threadEngineById: { "thread-1": "codex" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "addAssistantMessage",
      threadId: "thread-1",
      text: "会话已停止。",
    });
  });

  it("keeps plan handoff interrupts silent while still stopping the active turn", async () => {
    const { result, dispatch, markProcessing, setActiveTurnId } = makeHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
      activeTurnIdByThread: { "claude:session-1": "turn-1" },
      threadEngineById: { "claude:session-1": "claude" },
    });

    await act(async () => {
      await result.current.interruptTurn({ reason: "plan-handoff" });
    });

    expect(markProcessing).toHaveBeenCalledWith("claude:session-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("claude:session-1", null);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "addAssistantMessage",
        threadId: "claude:session-1",
      }),
    );
    expect(engineInterruptTurn).toHaveBeenCalledWith("ws-1", "turn-1", "claude");
  });

  it("interrupt routes opencode thread through engine interrupt only", async () => {
    const { result } = makeHook("codex", {
      activeThreadId: "opencode:session-1",
      ensuredThreadId: "opencode:session-1",
      activeTurnIdByThread: { "opencode:session-1": "turn-9" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(engineInterruptTurn).toHaveBeenCalledWith("ws-1", "turn-9", "opencode");
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("falls back to workspace interrupt when turn-scoped interrupt rpc is unavailable", async () => {
    vi.mocked(engineInterruptTurn).mockRejectedValue(
      new Error("unknown method: engine_interrupt_turn"),
    );
    const { result } = makeHook("codex", {
      activeThreadId: "opencode:session-1",
      ensuredThreadId: "opencode:session-1",
      activeTurnIdByThread: { "opencode:session-1": "turn-9" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(engineInterruptTurn).toHaveBeenCalledWith("ws-1", "turn-9", "opencode");
    expect(engineInterrupt).toHaveBeenCalledWith("ws-1");
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("interrupt on cli-managed engine queues pending interrupt when turn id is not ready", async () => {
    const { result, pendingInterruptsRef } = makeHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
      activeTurnIdByThread: {},
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(pendingInterruptsRef.current.has("claude:session-1")).toBe(true);
    expect(engineInterruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("clears queued pending interrupt before starting a new claude send", async () => {
    const { result, pendingInterruptsRef } = makeHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
      activeTurnIdByThread: {},
    });
    pendingInterruptsRef.current.add("claude:session-1");

    await act(async () => {
      await result.current.sendUserMessage("resume execution", [], {
        accessMode: "default",
        collaborationMode: { mode: "code", settings: {} },
        suppressUserMessageRender: true,
      });
    });

    expect(pendingInterruptsRef.current.has("claude:session-1")).toBe(false);
    expect(engineSendMessage).toHaveBeenCalled();
  });

  it("creates new opencode pending thread when active thread id is not opencode-prefixed", async () => {
    const startThreadForWorkspace = vi.fn(async () => "opencode-pending-new");
    const { result } = makeHook("opencode", {
      activeThreadId: "thread-legacy",
      ensuredThreadId: "thread-legacy",
      threadEngineById: { "thread-legacy": "opencode" },
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello");
    });

    expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      activate: true,
      engine: "opencode",
    });
    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "opencode",
        threadId: "opencode-pending-new",
      }),
    );
  });

  it("keeps sending follow-up messages on the current compatible codex thread", async () => {
    const startThreadForWorkspace = vi.fn(async () => "thread-new-1");
    const { result } = makeHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: { "thread-1": "codex" },
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.sendUserMessage("follow up");
    });

    expect(startThreadForWorkspace).not.toHaveBeenCalled();
    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "follow up",
      expect.any(Object),
    );
  });

  it("sends follow-up messages on the rewound codex child thread", async () => {
    const refreshThread = vi.fn(async () => null);
    const startThreadForWorkspace = vi.fn(async () => "thread-new-1");
    const { result } = makeHook("codex", {
      activeThreadId: "thread-codex-rewind-1",
      ensuredThreadId: "thread-codex-rewind-1",
      threadEngineById: { "thread-codex-rewind-1": "codex" },
      refreshThread,
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.sendUserMessage("follow up after rewind");
    });

    expect(refreshThread).not.toHaveBeenCalled();
    expect(startThreadForWorkspace).not.toHaveBeenCalled();
    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-codex-rewind-1",
      "follow up after rewind",
      expect.any(Object),
    );
  });

  it("resumes explicit opencode session from /resume command", async () => {
    const dispatch = vi.fn();
    const refreshThread = vi.fn(async () => null);
    const { result } = renderHook(() =>
      useThreadMessaging({
        activeWorkspace: workspace,
        activeThreadId: "thread-1",
        accessMode: "current",
        model: null,
        effort: null,
        collaborationMode: null,
        steerEnabled: false,
        customPrompts: [],
        activeEngine: "opencode",
        threadStatusById: {},
        itemsByThread: {},
        activeTurnIdByThread: {},
        tokenUsageByThread: {},
        rateLimitsByWorkspace: {},
        pendingInterruptsRef: { current: new Set<string>() },
        interruptedThreadsRef: { current: new Set<string>() },
        dispatch,
        getCustomName: () => undefined,
        getThreadEngine: () => "opencode",
        markProcessing: vi.fn(),
        markReviewing: vi.fn(),
        setActiveTurnId: vi.fn(),
        recordThreadActivity: vi.fn(),
        safeMessageActivity: vi.fn(),
        pushThreadErrorMessage: vi.fn(),
        ensureThreadForActiveWorkspace: async () => "thread-1",
        ensureThreadForWorkspace: async () => "thread-1",
        refreshThread,
        forkThreadForWorkspace: async () => null,
        updateThreadParent: vi.fn(),
        startThreadForWorkspace: vi.fn(async () => "thread-1"),
        onDebug: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.startResume("/resume ses_from_panel");
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setActiveThreadId",
        threadId: "opencode:ses_from_panel",
      }),
    );
    expect(refreshThread).toHaveBeenCalledWith("ws-1", "opencode:ses_from_panel");
  });

  it("passes selected collaboration mode payload through codex send", async () => {
    const { result } = makeHook("codex");
    const collaborationMode = {
      mode: "plan",
      settings: {
        model: "openai/gpt-5.3-codex",
        reasoning_effort: "medium",
      },
    };

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello codex",
        [],
        { collaborationMode },
      );
    });

    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "hello codex",
      expect.objectContaining({
        collaborationMode: expect.objectContaining({
          mode: "plan",
        }),
      }),
    );
  });

  it("retries codex send on refreshed thread when backend rejects legacy thread id", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message:
            "invalid thread id: invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `r` at 1",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-rebound-1" } },
      } as never);
    const refreshThread = vi.fn(async () => "thread-rebound-1");
    const startThreadForWorkspace = vi.fn(async () => "thread-rebound-1");
    const dispatch = vi.fn();
    const { result } = makeHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        1,
        "ws-1",
        "legacy-thread-id",
        "hello codex",
        expect.any(Object),
      );
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-rebound-1",
        "hello codex",
        expect.any(Object),
      );
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setThreadItems",
          threadId: "legacy-thread-id",
        }),
      );
    });
  });

  it("does not create new codex thread when invalid legacy id cannot be refreshed", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message:
          "invalid thread id: invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `r` at 1",
      },
    } as never);
    const refreshThread = vi.fn(async () => null);
    const startThreadForWorkspace = vi.fn(async () => "thread-new-1");
    const { result, pushThreadErrorMessage } = makeHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        "legacy-thread-id",
        expect.any(String),
      );
    });
  });

  it("retries codex send once when refresh returns the same thread id", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message:
            "invalid thread id: invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `r` at 1",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-retry-same-id" } },
      } as never);
    const refreshThread = vi.fn(async () => "legacy-thread-id");
    const startThreadForWorkspace = vi.fn(async () => "thread-new-1");
    const dispatch = vi.fn();
    const { result } = makeHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "legacy-thread-id",
        "hello codex",
        expect.any(Object),
      );
      const optimisticUserBubbleActions = dispatch.mock.calls.filter(
        ([action]) =>
          action &&
          typeof action === "object" &&
          "type" in action &&
          (action as { type?: string }).type === "upsertItem" &&
          "item" in action &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.kind ===
            "message" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.role ===
            "user" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.text ===
            "hello codex",
      );
      expect(optimisticUserBubbleActions).toHaveLength(1);
    });
  });

  it("adds optimistic user bubble immediately for codex send", async () => {
    const dispatch = vi.fn();
    const { result } = makeHook("codex", { dispatch });

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "thread-1", "hello codex");
    });

    const optimisticCall = dispatch.mock.calls.find(
      ([action]) =>
        action &&
        typeof action === "object" &&
        "type" in action &&
        (action as { type?: string }).type === "upsertItem" &&
        "item" in action &&
        (action as { item?: { kind?: string; role?: string; text?: string } }).item?.kind ===
          "message" &&
        (action as { item?: { kind?: string; role?: string; text?: string } }).item?.role ===
          "user" &&
        (action as { item?: { kind?: string; role?: string; text?: string } }).item?.text ===
          "hello codex",
    );

    expect(optimisticCall).toBeDefined();
    const optimisticAction = optimisticCall?.[0] as { item?: { id?: string } };
    expect(optimisticAction.item?.id).toMatch(/^optimistic-user-/);
  });

  it("suppresses rendered user bubbles when send opts request silent execution prompts", async () => {
    const dispatch = vi.fn();
    const { result } = makeHook("claude", {
      dispatch,
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
      threadEngineById: { "claude:session-1": "claude" },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "claude:session-1", "Implement this plan.", [], {
        suppressUserMessageRender: true,
      });
    });

    const renderedUserBubbleCalls = dispatch.mock.calls.filter(
      ([action]) =>
        action &&
        typeof action === "object" &&
        "type" in action &&
        (action as { type?: string }).type === "upsertItem" &&
        "item" in action &&
        (action as { item?: { kind?: string; role?: string } }).item?.kind === "message" &&
        (action as { item?: { kind?: string; role?: string } }).item?.role === "user",
    );

    expect(renderedUserBubbleCalls).toHaveLength(0);
    expect(engineSendMessage).toHaveBeenCalled();
  });

  it("does not attach selectedAgentIcon when sending without selected agent", async () => {
    const dispatch = vi.fn();
    const { result } = makeHook("codex", { dispatch });

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "thread-1", "hello codex");
    });

    const optimisticCall = dispatch.mock.calls.find(
      ([action]) =>
        action &&
        typeof action === "object" &&
        "type" in action &&
        (action as { type?: string }).type === "upsertItem" &&
        "item" in action &&
        (action as { item?: { kind?: string; role?: string } }).item?.kind === "message" &&
        (action as { item?: { kind?: string; role?: string } }).item?.role === "user",
    );
    expect(optimisticCall).toBeDefined();
    const optimisticAction = optimisticCall?.[0] as {
      item?: { selectedAgentName?: string | null; selectedAgentIcon?: string | null };
    };
    expect(optimisticAction.item?.selectedAgentName ?? null).toBeNull();
    expect(optimisticAction.item?.selectedAgentIcon ?? null).toBeNull();
  });

  it("injects selected agent name marker into codex prompt block", async () => {
    const { result } = makeHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "请继续",
        [],
        {
          selectedAgent: {
            id: "agent-backend-1",
            name: "后端架构师",
            prompt: "你是一位资深后端架构师，擅长服务治理和高并发设计。",
            icon: "agent-robot-03",
          },
        },
      );
    });

    const calls = vi.mocked(sendUserMessage).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const latestCall = calls[calls.length - 1];
    const sentText = String(latestCall?.[2] ?? "");
    expect(sentText).toContain("## Agent Role and Instructions");
    expect(sentText).toContain("Agent Name: 后端架构师");
    expect(sentText).toContain("Agent Icon: agent-robot-03");
    expect(sentText).toContain("你是一位资深后端架构师，擅长服务治理和高并发设计。");
  });

  it("releases codex processing state when first packet timeout is recoverable", async () => {
    vi.mocked(sendUserMessage).mockRejectedValueOnce(
      new Error(
        "FIRST_PACKET_TIMEOUT:35:Timed out waiting for initial response. Network, proxy, or upstream service load may be causing delay. Please retry.",
      ),
    );
    const { result, markProcessing, setActiveTurnId, pushThreadErrorMessage } =
      makeHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello codex",
      );
    });

    expect(markProcessing).toHaveBeenCalledWith("thread-1", true);
    expect(markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("thread-1", null);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "thread-1",
      "threads.firstPacketTimeout",
    );
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "common.warning",
        message: "threads.firstPacketTimeout",
      }),
    );
  });

  it("releases codex processing state when first packet timeout comes back as rpc error", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message:
          "FIRST_PACKET_TIMEOUT:20:Timed out waiting for initial response. Network, proxy, or upstream service load may be causing delay. Please retry.",
      },
    });
    const { result, markProcessing, setActiveTurnId, pushThreadErrorMessage } =
      makeHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello codex",
      );
    });

    expect(markProcessing).toHaveBeenCalledWith("thread-1", true);
    expect(markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("thread-1", null);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "thread-1",
      "threads.firstPacketTimeout",
    );
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "common.warning",
        message: "threads.firstPacketTimeout",
      }),
    );
  });

  it("passes custom spec root through codex send when configured", async () => {
    vi.mocked(getClientStoreSync).mockImplementation((_store, key) => {
      if (key === "specHub.specRoot.ws-1") {
        return "/tmp/external-openspec";
      }
      return undefined;
    });

    const { result } = makeHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "thread-1", "hello codex");
    });

    const calls = vi.mocked(sendUserMessage).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const latestCall = calls[calls.length - 1];
    expect(latestCall?.[0]).toBe("ws-1");
    expect(latestCall?.[1]).toBe("thread-1");
    expect(latestCall?.[2]).toContain("[Spec Root Priority]");
    expect(latestCall?.[2]).toContain("/tmp/external-openspec");
    expect(latestCall?.[2]).toContain("[User Input] hello codex");
    expect(latestCall?.[3]).toEqual(
      expect.objectContaining({
        customSpecRoot: "/tmp/external-openspec",
      }),
    );
  });

  it("does not prepend spec root hint after first codex turn when thread already has items", async () => {
    vi.mocked(getClientStoreSync).mockImplementation((_store, key) => {
      if (key === "specHub.specRoot.ws-1") {
        return "/tmp/external-openspec";
      }
      return undefined;
    });

    const { result } = makeHook("codex", {
      itemsByThread: {
        "thread-1": [{ id: "existing-user", kind: "message", role: "user", text: "existing" }],
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "thread-1", "follow up");
    });

    const calls = vi.mocked(sendUserMessage).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const latestCall = calls[calls.length - 1];
    expect(latestCall?.[2]).toBe("follow up");
    expect(latestCall?.[2]).not.toContain("[Spec Root Priority]");
    expect(latestCall?.[2]).not.toContain("[Session Spec Link]");
    expect(latestCall?.[3]).toEqual(
      expect.objectContaining({
        customSpecRoot: "/tmp/external-openspec",
      }),
    );
  });

  it("normalizes file URI custom spec root before codex send", async () => {
    vi.mocked(getClientStoreSync).mockImplementation((_store, key) => {
      if (key === "specHub.specRoot.ws-1") {
        return "file:///tmp/external-openspec";
      }
      return undefined;
    });

    const { result } = makeHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "thread-1", "hello codex");
    });

    const calls = vi.mocked(sendUserMessage).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const latestCall = calls[calls.length - 1];
    expect(latestCall?.[3]).toEqual(
      expect.objectContaining({
        customSpecRoot: "/tmp/external-openspec",
      }),
    );
  });

  it("injects a collapsible external spec card on first codex turn", async () => {
    vi.mocked(getClientStoreSync).mockImplementation((_store, key) => {
      if (key === "specHub.specRoot.ws-1") {
        return "/tmp/external-openspec";
      }
      return undefined;
    });
    const dispatch = vi.fn();
    const { result } = makeHook("codex", { dispatch, itemsByThread: {} });

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "thread-1", "hello codex");
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "upsertItem",
        threadId: "thread-1",
        item: expect.objectContaining({
          id: "spec-root-context-thread-1",
          kind: "explore",
          collapsible: true,
          mergeKey: "spec-root-context",
        }),
      }),
    );
  });

  it("does not inject external spec card when thread already has items", async () => {
    vi.mocked(getClientStoreSync).mockImplementation((_store, key) => {
      if (key === "specHub.specRoot.ws-1") {
        return "/tmp/external-openspec";
      }
      return undefined;
    });
    const dispatch = vi.fn();
    const { result } = makeHook("codex", {
      dispatch,
      itemsByThread: {
        "thread-1": [{ id: "existing-user", kind: "message", role: "user", text: "existing" }],
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "thread-1", "hello codex");
    });

    expect(
      dispatch.mock.calls.some(
        ([action]) =>
          action &&
          typeof action === "object" &&
          "item" in action &&
          (action as { item?: { id?: string } }).item?.id === "spec-root-context-thread-1",
      ),
    ).toBe(false);
  });

  it("records visible probe status without repair actions in spec context card", async () => {
    vi.mocked(getClientStoreSync).mockImplementation((_store, key) => {
      if (key === "specHub.specRoot.ws-1") {
        return "/tmp/external-openspec";
      }
      return undefined;
    });
    vi.mocked(listExternalSpecTree).mockResolvedValue({
      files: ["openspec/changes/add-spec-hub/proposal.md", "openspec/changes/add-spec-hub/tasks.md"],
      directories: ["openspec", "openspec/changes", "openspec/specs"],
      gitignored_files: [],
      gitignored_directories: [],
    });
    const dispatch = vi.fn();
    const { result } = makeHook("codex", { dispatch, itemsByThread: {} });

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "thread-1", "hello codex");
    });

    const upsertCall = dispatch.mock.calls.find(
      ([action]) =>
        action &&
        typeof action === "object" &&
        "type" in action &&
        (action as { type?: string }).type === "upsertItem" &&
        "item" in action &&
        (action as { item?: { id?: string } }).item?.id === "spec-root-context-thread-1",
    );
    expect(upsertCall).toBeDefined();

    const action = upsertCall?.[0] as {
      item?: { entries?: Array<{ label?: string; detail?: string }> };
    };
    const entries = action.item?.entries ?? [];
    expect(entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Probe status", detail: "visible" })]),
    );
    expect(entries.some((entry) => entry.label === "/spec-root rebind")).toBe(false);
    expect(entries.some((entry) => entry.label === "/spec-root default")).toBe(false);
  });

  it("records malformed probe status and repair actions in spec context card", async () => {
    vi.mocked(getClientStoreSync).mockImplementation((_store, key) => {
      if (key === "specHub.specRoot.ws-1") {
        return "/tmp/external-openspec";
      }
      return undefined;
    });
    vi.mocked(listExternalSpecTree).mockResolvedValue({
      files: ["openspec/changes/add-spec-hub/proposal.md"],
      directories: ["openspec", "openspec/changes"],
      gitignored_files: [],
      gitignored_directories: [],
    });
    const dispatch = vi.fn();
    const { result } = makeHook("codex", { dispatch, itemsByThread: {} });

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "thread-1", "hello codex");
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "upsertItem",
        threadId: "thread-1",
        item: expect.objectContaining({
          id: "spec-root-context-thread-1",
          kind: "explore",
          entries: expect.arrayContaining([
            expect.objectContaining({ label: "Probe status", detail: "malformed" }),
            expect.objectContaining({ label: "/spec-root rebind" }),
            expect.objectContaining({ label: "/spec-root default" }),
          ]),
        }),
      }),
    );
  });

  it("updates spec root context to visible after /spec-root rebind succeeds", async () => {
    vi.mocked(getClientStoreSync).mockImplementation((_store, key) => {
      if (key === "specHub.specRoot.ws-1") {
        return "/tmp/external-openspec";
      }
      return undefined;
    });
    vi.mocked(listExternalSpecTree)
      .mockResolvedValueOnce({
        files: ["openspec/changes/add-spec-hub/proposal.md"],
        directories: ["openspec", "openspec/changes"],
        gitignored_files: [],
        gitignored_directories: [],
      })
      .mockResolvedValueOnce({
        files: ["openspec/changes/add-spec-hub/proposal.md", "openspec/changes/add-spec-hub/tasks.md"],
        directories: ["openspec", "openspec/changes", "openspec/specs"],
        gitignored_files: [],
        gitignored_directories: [],
      });

    const dispatch = vi.fn();
    const { result } = makeHook("codex", { dispatch, itemsByThread: {} });

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "thread-1", "hello codex");
    });
    await act(async () => {
      await result.current.startSpecRoot("/spec-root rebind");
    });

    const upsertCalls = dispatch.mock.calls.filter(
      ([action]) =>
        action &&
        typeof action === "object" &&
        "type" in action &&
        (action as { type?: string }).type === "upsertItem" &&
        "item" in action &&
        (action as { item?: { id?: string } }).item?.id === "spec-root-context-thread-1",
    );
    expect(upsertCalls.length).toBeGreaterThanOrEqual(2);

    const latestUpsert = upsertCalls[upsertCalls.length - 1]?.[0] as {
      item?: { entries?: Array<{ label?: string; detail?: string }> };
    };
    const latestEntries = latestUpsert.item?.entries ?? [];
    expect(latestEntries).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Probe status", detail: "visible" })]),
    );
    expect(latestEntries.some((entry) => entry.label === "/spec-root rebind")).toBe(false);
    expect(latestEntries.some((entry) => entry.label === "/spec-root default")).toBe(false);

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "addAssistantMessage",
        threadId: "thread-1",
        text: expect.stringContaining("Action: rebind"),
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "addAssistantMessage",
        threadId: "thread-1",
        text: expect.stringContaining("Status: visible"),
      }),
    );
  });

  it("supports /spec-root default command and writes workspace spec root back to default", async () => {
    vi.mocked(getClientStoreSync).mockImplementation((_store, key) => {
      if (key === "specHub.specRoot.ws-1") {
        return "/tmp/external-openspec";
      }
      return undefined;
    });
    const dispatch = vi.fn();
    const { result } = makeHook("codex", { dispatch });

    await act(async () => {
      await result.current.startSpecRoot("/spec-root default");
    });

    expect(writeClientStoreValue).toHaveBeenCalledWith("app", "specHub.specRoot.ws-1", null);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "addAssistantMessage",
        threadId: "thread-1",
        text: expect.stringContaining("Action: default"),
      }),
    );
  });

  it("formats /status output with CLI-aligned labels and remaining limits", async () => {
    const dispatch = vi.fn();
    const ensureThreadForActiveWorkspace = vi.fn(async () => "thread-1");
    const { result } = renderHook(() =>
      useThreadMessaging({
        activeWorkspace: workspace,
        activeThreadId: "thread-1",
        accessMode: "full-access",
        model: "gpt-5.3-codex",
        effort: "medium",
        collaborationMode: null,
        steerEnabled: false,
        customPrompts: [],
        activeEngine: "codex",
        threadStatusById: {},
        itemsByThread: {},
        activeTurnIdByThread: {},
        tokenUsageByThread: {},
        rateLimitsByWorkspace: {
          [workspace.id]: {
            primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: null },
            secondary: { usedPercent: 65, windowDurationMins: 10080, resetsAt: null },
            credits: null,
            planType: null,
          },
        },
        pendingInterruptsRef: { current: new Set<string>() },
        interruptedThreadsRef: { current: new Set<string>() },
        dispatch,
        getCustomName: () => undefined,
        getThreadEngine: () => "codex",
        markProcessing: vi.fn(),
        markReviewing: vi.fn(),
        setActiveTurnId: vi.fn(),
        recordThreadActivity: vi.fn(),
        safeMessageActivity: vi.fn(),
        pushThreadErrorMessage: vi.fn(),
        ensureThreadForActiveWorkspace,
        ensureThreadForWorkspace: async () => "thread-1",
        refreshThread: async () => null,
        forkThreadForWorkspace: async () => null,
        updateThreadParent: vi.fn(),
        startThreadForWorkspace: vi.fn(async () => "thread-1"),
        onDebug: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.startStatus("/status");
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "addAssistantMessage",
        threadId: "thread-1",
        text: expect.stringContaining("OpenAI Codex"),
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Permissions:        Full Access"),
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("5h limit: 85% left"),
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Weekly limit: 35% left"),
      }),
    );
  });
});
