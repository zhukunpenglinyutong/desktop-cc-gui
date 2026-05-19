// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem, WorkspaceInfo } from "../../../types";
import { useThreadMessaging } from "./useThreadMessaging";
import type { ThreadState } from "./useThreadsReducer";
import type { CodexAcceptedTurnRecord } from "../utils/codexConversationLiveness";
import {
  compactThreadContext,
  engineInterruptTurn,
  engineInterrupt,
  engineSendMessage,
  getWorkspaceFiles,
  interruptTurn,
  listGeminiSessions,
  loadClaudeSession,
  listMcpServerStatus,
  sendUserMessage,
} from "../../../services/tauri";
import { getClientStoreSync } from "../../../services/clientStorage";
import { pushErrorToast } from "../../../services/toasts";
import {
  clearGlobalRuntimeNotices,
  getGlobalRuntimeNoticesSnapshot,
} from "../../../services/globalRuntimeNotices";
import { sendSharedSessionTurn } from "../../shared-session/runtime/sendSharedSessionTurn";

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

vi.mock("../../../services/tauri", () => ({
  compactThreadContext: vi.fn(),
  sendUserMessage: vi.fn(),
  projectMemoryCaptureAuto: vi.fn(async () => null),
  projectMemoryCaptureTurnInput: vi.fn(async () => null),
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
  loadClaudeSession: vi.fn(),
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

  beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalRuntimeNotices();
    vi.mocked(compactThreadContext).mockResolvedValue({ status: "completed" });
    vi.mocked(getClientStoreSync).mockReturnValue(undefined);
    vi.mocked(engineSendMessage).mockResolvedValue({
      result: { turn: { id: "turn-1" } },
    });
    vi.mocked(sendUserMessage).mockResolvedValue({
      result: { turn: { id: "turn-2" } },
    });
    vi.mocked(getWorkspaceFiles).mockResolvedValue({
      files: ["openspec/changes/add-spec-hub/proposal.md", "openspec/changes/add-spec-hub/tasks.md"],
      directories: ["openspec", "openspec/changes", "openspec/specs"],
      gitignored_files: [],
      gitignored_directories: [],
    });
    vi.mocked(listGeminiSessions).mockResolvedValue([]);
    vi.mocked(loadClaudeSession).mockResolvedValue({ messages: [] });
    vi.mocked(listMcpServerStatus).mockResolvedValue({ result: { data: [] } });
    vi.mocked(engineInterrupt).mockResolvedValue();
    vi.mocked(engineInterruptTurn).mockResolvedValue();
    vi.mocked(interruptTurn).mockResolvedValue({});
    vi.mocked(sendSharedSessionTurn).mockResolvedValue({
      result: { turn: { id: "shared-turn-1" } },
    });
  });

  function makeHook(
    activeEngine: "claude" | "codex" | "gemini" | "opencode",
    overrides: {
      workspace?: WorkspaceInfo;
      activeThreadId?: string | null;
      ensuredThreadId?: string | null;
      activeTurnIdByThread?: Record<string, string | null>;
      threadStatusById?: ThreadState["threadStatusById"];
      codexAcceptedTurnByThread?: Record<string, CodexAcceptedTurnRecord>;
      threadEngineById?: Record<string, "claude" | "codex" | "gemini" | "opencode" | undefined>;
      itemsByThread?: Record<string, ConversationItem[]>;
      startThreadForWorkspace?: ReturnType<typeof vi.fn>;
      refreshThread?: ReturnType<typeof vi.fn>;
      dispatch?: ReturnType<typeof vi.fn>;
      runWithCreateSessionLoading?: ReturnType<typeof vi.fn>;
      resolveComposerSelection?: () => {
        id?: string | null;
        model: string | null;
        source?: string | null;
        effort: string | null;
        collaborationMode: Record<string, unknown> | null;
      };
      claudeThinkingVisible?: boolean;
    } = {},
  ) {
    const activeThreadId =
      "activeThreadId" in overrides ? overrides.activeThreadId ?? null : "thread-1";
    const ensuredThreadId =
      "ensuredThreadId" in overrides ? overrides.ensuredThreadId ?? null : activeThreadId;
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
    const codexCompactionInFlightByThreadRef = { current: {} as Record<string, boolean> };

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
        resolveComposerSelection: overrides.resolveComposerSelection,
        claudeThinkingVisible: overrides.claudeThinkingVisible,
        threadStatusById: overrides.threadStatusById ?? {},
        itemsByThread: overrides.itemsByThread ?? {},
        activeTurnIdByThread: overrides.activeTurnIdByThread ?? {},
        codexAcceptedTurnByThread: overrides.codexAcceptedTurnByThread ?? {},
        tokenUsageByThread: {},
        rateLimitsByWorkspace: {},
        codexCompactionInFlightByThreadRef,
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
        runWithCreateSessionLoading: overrides.runWithCreateSessionLoading,
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
      codexCompactionInFlightByThreadRef,
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

  it("disables Claude CLI thinking for shared Claude sends when visibility is off", async () => {
    const { result } = makeHook("claude", {
      activeThreadId: "shared:thread-disable-thinking",
      claudeThinkingVisible: false,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-disable-thinking",
        "hello shared claude",
      );
    });

    expect(sendSharedSessionTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        threadId: "shared:thread-disable-thinking",
        engine: "claude",
        disableThinking: true,
      }),
    );
    expect(engineSendMessage).not.toHaveBeenCalled();
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

  it("disables Claude CLI thinking when Claude thinking visibility is off", async () => {
    const { result } = makeHook("claude", {
      claudeThinkingVisible: false,
      threadEngineById: { "claude:session-1": "claude" },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude:session-1",
        "hello claude",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        disableThinking: true,
      }),
    );
  });

  it("does not disable non-Claude thinking from the Claude visibility toggle", async () => {
    const { result } = makeHook("opencode", {
      claudeThinkingVisible: false,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "opencode-pending-abc",
        "hello opencode",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "opencode",
        disableThinking: false,
      }),
    );
  });

  it("sends resolved Claude runtime model while diagnostics keep selected id and source", async () => {
    const { result, onDebug } = makeHook("claude", {
      resolveComposerSelection: () => ({
        id: "claude-sonnet-option",
        model: "sonnet",
        source: "cli-discovered",
        effort: null,
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "sonnet",
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "model/resolve",
        payload: expect.objectContaining({
          selectedModelId: "claude-sonnet-option",
          selectedModelSource: "cli-discovered",
          modelForSend: "sonnet",
        }),
      }),
    );
  });

  it("sends custom Claude model ids with bracket suffix to the backend", async () => {
    const { result, onDebug } = makeHook("claude", {
      resolveComposerSelection: () => ({
        id: "Cxn[1m]",
        model: "Cxn[1m]",
        source: "custom",
        effort: null,
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "Cxn[1m]",
      }),
    );
    expect(engineSendMessage).not.toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        model: "claude-opus-4-6[1m]",
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "model/resolve",
        payload: expect.objectContaining({
          selectedModelId: "Cxn[1m]",
          selectedModelSource: "custom",
          modelForSend: "Cxn[1m]",
        }),
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

  it("passes arbitrary claude custom model ids through to the backend", async () => {
    const { result } = makeHook("claude");

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
        model: "bad model with spaces",
      }),
    );
  });

  it("passes overlong claude custom model ids through to the backend", async () => {
    const { result } = makeHook("claude");
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
        model: overlongModelId,
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

  it("blocks claude pending follow-up until native session confirmation arrives", async () => {
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        sessionId: "session-xyz",
        result: { turn: { id: "turn-1" }, sessionId: "session-xyz" },
      });
    const { result, pushThreadErrorMessage } = makeHook("claude", {
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
    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "claude-pending-abc",
      "threads.claudePendingNativeSessionWait",
    );
  });

  it("rebinds claude pending follow-up after candidate transcript validates", async () => {
    const workspaceWithTrailingSpace = { ...workspace, path: "/tmp/mossx " };
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        sessionId: "session-xyz",
        result: { turn: { id: "turn-1" }, sessionId: "session-xyz" },
      })
      .mockResolvedValueOnce({
        sessionId: "session-xyz",
        result: { turn: { id: "turn-2" }, sessionId: "session-xyz" },
      });
    vi.mocked(loadClaudeSession).mockResolvedValueOnce({
      messages: [
        {
          kind: "message",
          id: "user-1",
          role: "user",
          text: "hello claude",
        },
        {
          kind: "message",
          id: "assistant-1",
          role: "assistant",
          text: "done",
        },
      ],
    });
    const dispatch = vi.fn();
    const { result, pushThreadErrorMessage } = makeHook("claude", {
      activeThreadId: "claude-pending-abc",
      ensuredThreadId: "claude-pending-abc",
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspaceWithTrailingSpace,
        "claude-pending-abc",
        "hello claude",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspaceWithTrailingSpace,
        "claude-pending-abc",
        "follow up",
      );
    });

    expect(loadClaudeSession).toHaveBeenCalledWith("/tmp/mossx ", "session-xyz");
    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "claude-pending-abc",
      newThreadId: "claude:session-xyz",
    });
    expect(engineSendMessage).toHaveBeenNthCalledWith(
      2,
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        continueSession: true,
        sessionId: "session-xyz",
        threadId: "claude:session-xyz",
      }),
    );
    expect(pushThreadErrorMessage).not.toHaveBeenCalledWith(
      "claude-pending-abc",
      "threads.claudePendingNativeSessionWait",
    );
  });

  it("does not rebind claude pending follow-up from user-only candidate transcript", async () => {
    vi.mocked(engineSendMessage).mockResolvedValueOnce({
      sessionId: "session-user-only",
      result: { turn: { id: "turn-1" }, sessionId: "session-user-only" },
    });
    vi.mocked(loadClaudeSession).mockResolvedValueOnce({
      messages: [
        {
          kind: "message",
          id: "user-1",
          role: "user",
          text: "hello claude",
        },
      ],
    });
    const dispatch = vi.fn();
    const { result, pushThreadErrorMessage } = makeHook("claude", {
      activeThreadId: "claude-pending-user-only",
      ensuredThreadId: "claude-pending-user-only",
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-user-only",
        "hello claude",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-user-only",
        "follow up too early",
      );
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "claude-pending-user-only",
      "threads.claudePendingNativeSessionWait",
    );
  });

  it("blocks restored claude pending thread with local items even without memory marker", async () => {
    const { result, pushThreadErrorMessage } = makeHook("claude", {
      activeThreadId: "claude-pending-restored",
      ensuredThreadId: "claude-pending-restored",
      itemsByThread: {
        "claude-pending-restored": [
          {
            id: "user-1",
            kind: "message",
            role: "user",
            text: "hello claude",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-restored",
        "follow up after remount",
      );
    });

    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "claude-pending-restored",
      "threads.claudePendingNativeSessionWait",
    );
  });

  it("passes forkSessionId for the first send on a claude fork thread", async () => {
    vi.mocked(engineSendMessage).mockResolvedValueOnce({
      sessionId: "new-child-session",
      result: { turn: { id: "turn-1" }, sessionId: "new-child-session" },
    });
    const threadId = "claude-fork:parent-session-1:local-1";
    const { result } = makeHook("claude", {
      activeThreadId: threadId,
      ensuredThreadId: threadId,
      threadEngineById: {
        [threadId]: "claude",
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        threadId,
        "hello from fork",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        continueSession: false,
        sessionId: null,
        forkSessionId: "parent-session-1",
        threadId,
      }),
    );
  });

  it("does not accept snake_case claude session_id as pending native confirmation", async () => {
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        result: {
          turn: { id: "turn-1" },
          session_id: "session-snake",
        },
      });
    const { result, pushThreadErrorMessage } = makeHook("claude", {
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

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "claude-pending-snake",
      "threads.claudePendingNativeSessionWait",
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

  it("continues finalized claude session with native thread id", async () => {
    const { result } = makeHook("claude", {
      activeThreadId: "claude:session-native-1",
      ensuredThreadId: "claude:session-native-1",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude:session-native-1",
        "follow up",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        continueSession: true,
        sessionId: "session-native-1",
        threadId: "claude:session-native-1",
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
      });
    const { result, pushThreadErrorMessage } = makeHook("claude", {
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

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "claude-pending-def",
      "threads.claudePendingNativeSessionWait",
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

  it("runs /compact in active claude thread via dedicated compact RPC", async () => {
    vi.mocked(compactThreadContext).mockResolvedValue({
      status: "completed",
      turnId: "compact-turn-1",
    });
    const { result, dispatch, recordThreadActivity, safeMessageActivity } = makeHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
      threadEngineById: {
        "claude:session-1": "claude",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact now");
    });

    expect(compactThreadContext).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-1",
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "claude:session-1",
      isCompacting: true,
      timestamp: expect.any(Number),
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "claude:session-1",
      isCompacting: false,
      timestamp: expect.any(Number),
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendContextCompacted",
      threadId: "claude:session-1",
      turnId: "compact-turn-1",
    });
    expect(recordThreadActivity).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-1",
      expect.any(Number),
    );
    expect(safeMessageActivity).toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("runs manual Codex compaction via dedicated compact RPC and inserts the curtain message immediately", async () => {
    vi.mocked(compactThreadContext).mockResolvedValue({ status: "queued" });
    const {
      result,
      dispatch,
      recordThreadActivity,
      safeMessageActivity,
      codexCompactionInFlightByThreadRef,
    } = makeHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: {
        "thread-1": "codex",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).toHaveBeenCalledWith("ws-1", "thread-1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: true,
      timestamp: expect.any(Number),
      source: "manual",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendCodexCompactionMessage",
      threadId: "thread-1",
      text: "threads.codexCompactionStarted",
    });
    expect(recordThreadActivity).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      expect.any(Number),
    );
    expect(codexCompactionInFlightByThreadRef.current["thread-1"]).toBe(true);
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("does not send duplicate Codex compact RPCs while one is already in flight", async () => {
    const {
      result,
      dispatch,
      codexCompactionInFlightByThreadRef,
    } = makeHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: {
        "thread-1": "codex",
      },
    });
    codexCompactionInFlightByThreadRef.current["thread-1"] = true;

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "appendCodexCompactionMessage" }),
    );
  });

  it("rolls back the started Codex compaction curtain message when the compact RPC fails immediately", async () => {
    vi.mocked(compactThreadContext).mockRejectedValue(new Error("rpc failed"));
    const {
      result,
      dispatch,
      codexCompactionInFlightByThreadRef,
      pushThreadErrorMessage,
      safeMessageActivity,
    } = makeHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: {
        "thread-1": "codex",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: expect.any(Number),
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "discardLatestCodexCompactionMessage",
      threadId: "thread-1",
      text: "threads.codexCompactionStarted",
    });
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "thread-1",
      "threads.contextCompactionFailedWithMessage",
    );
    expect(codexCompactionInFlightByThreadRef.current["thread-1"]).toBeUndefined();
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("does not create a new thread for /compact when no active claude thread exists", async () => {
    const startThreadForWorkspace = vi.fn(async () => "claude:session-new");
    const { result } = makeHook("claude", {
      activeThreadId: null,
      ensuredThreadId: null,
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).not.toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(startThreadForWorkspace).not.toHaveBeenCalled();
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "common.warning",
        message: "threads.claudeManualCompactUnavailable",
      }),
    );
  });

  it("rejects /compact on unsupported active thread without rebinding", async () => {
    const startThreadForWorkspace = vi.fn(async () => "claude:session-new");
    const { result } = makeHook("gemini", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: {
        "thread-1": "gemini",
      },
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).not.toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(startThreadForWorkspace).not.toHaveBeenCalled();
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "common.warning",
        message: "threads.claudeManualCompactUnavailable",
      }),
    );
  });

  it("rejects /compact on pending claude thread to avoid creating a session just for compaction", async () => {
    const { result } = makeHook("claude", {
      activeThreadId: "claude-pending-123",
      ensuredThreadId: "claude-pending-123",
      threadEngineById: {
        "claude-pending-123": "claude",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).not.toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "common.warning",
        message: "threads.claudeManualCompactUnavailable",
      }),
    );
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

  it("shows fusion-specific stop copy without blocking same-thread realtime continuation", async () => {
    const { result, dispatch, interruptedThreadsRef, pendingInterruptsRef } = makeHook("codex", {
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
      text: "正在切换到融合回复，等待新的接续事件…",
    });
    expect(interruptedThreadsRef.current.has("thread-1")).toBe(false);
    expect(pendingInterruptsRef.current.has("thread-1")).toBe(false);
  });

  it("keeps the default stop copy for a normal manual interrupt", async () => {
    const { result, dispatch, interruptedThreadsRef } = makeHook("codex", {
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
    expect(interruptedThreadsRef.current.has("thread-1")).toBe(true);
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
      threadStatusById: {
        "claude:session-1": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: 1,
          lastDurationMs: null,
        },
      },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(pendingInterruptsRef.current.has("claude:session-1")).toBe(true);
    expect(engineInterruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("does not queue a pending interrupt after a stalled codex turn already settled", async () => {
    const { result, pendingInterruptsRef, dispatch } = makeHook("codex", {
      activeThreadId: "thread-stalled",
      ensuredThreadId: "thread-stalled",
      activeTurnIdByThread: { "thread-stalled": null },
      threadEngineById: { "thread-stalled": "codex" },
      threadStatusById: {
        "thread-stalled": {
          isProcessing: false,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: null,
          lastDurationMs: 120_000,
        },
      },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(pendingInterruptsRef.current.has("thread-stalled")).toBe(false);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "addAssistantMessage",
        threadId: "thread-stalled",
      }),
    );
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
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

  it("shows create-session loading when first send needs to create a thread", async () => {
    const startThreadForWorkspace = vi.fn(async () => "thread-new-1");
    const runWithCreateSessionLoading = vi.fn(async (_params, action) => action());
    const { result } = makeHook("codex", {
      activeThreadId: null,
      ensuredThreadId: "thread-new-1",
      startThreadForWorkspace,
      runWithCreateSessionLoading,
    });

    await act(async () => {
      await result.current.sendUserMessage("first message");
    });

    expect(runWithCreateSessionLoading).toHaveBeenCalledWith(
      {
        workspace,
        engine: "codex",
      },
      expect.any(Function),
    );
    expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      activate: true,
      engine: "codex",
    });
    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-new-1",
      "first message",
      expect.any(Object),
    );
  });

  it("does not show create-session loading for follow-up sends on existing threads", async () => {
    const runWithCreateSessionLoading = vi.fn(async (_params, action) => action());
    const { result } = makeHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: { "thread-1": "codex" },
      runWithCreateSessionLoading,
    });

    await act(async () => {
      await result.current.sendUserMessage("follow up");
    });

    expect(runWithCreateSessionLoading).not.toHaveBeenCalled();
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

  it("creates a fresh codex thread when invalid legacy id cannot be refreshed", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message:
            "invalid thread id: invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `n` at 1",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-new-legacy" } },
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
      expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
        activate: true,
        engine: "codex",
      });
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-new-1",
        "hello codex",
        expect.any(Object),
      );
      expect(pushThreadErrorMessage).not.toHaveBeenCalled();
    });
  });

  it("does not silently replace a stale codex thread when durable local activity exists", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "thread not found: legacy-thread-id",
      },
    } as never);
    const refreshThread = vi.fn(async () => null);
    const startThreadForWorkspace = vi.fn(async () => "thread-new-unknown");
    const { result, pushThreadErrorMessage } = makeHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
      itemsByThread: {
        "legacy-thread-id": [
          {
            id: "user-accepted-earlier",
            kind: "message",
            role: "user",
            text: "accepted earlier",
          },
        ],
      },
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

  it("freshly resends first prompt when empty local codex draft lost its marker", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message: "thread not found: legacy-thread-id",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-fresh-local-draft" } },
      } as never);
    const refreshThread = vi.fn(async () => null);
    const startThreadForWorkspace = vi.fn(async () => "thread-fresh-local-draft");
    const dispatch = vi.fn();
    const { result, recordThreadActivity, pushThreadErrorMessage } = makeHook("codex", {
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
      expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
        activate: true,
        engine: "codex",
      });
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-fresh-local-draft",
        "hello codex",
        expect.any(Object),
      );
      expect(dispatch).toHaveBeenCalledWith({
        type: "setActiveThreadId",
        workspaceId: "ws-1",
        threadId: "thread-fresh-local-draft",
      });
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "upsertItem",
          workspaceId: "ws-1",
          threadId: "thread-fresh-local-draft",
          item: expect.objectContaining({
            id: expect.stringMatching(/^optimistic-user-/),
            text: "hello codex",
          }),
        }),
      );
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "markCodexAcceptedTurn",
          threadId: "thread-fresh-local-draft",
          fact: "accepted",
          source: "turn-start-response",
        }),
      );
      expect(pushThreadErrorMessage).not.toHaveBeenCalled();
      expect(recordThreadActivity).not.toHaveBeenCalledWith(
        "ws-1",
        "legacy-thread-id",
        expect.any(Number),
      );
      expect(recordThreadActivity).toHaveBeenCalledWith(
        "ws-1",
        "thread-fresh-local-draft",
        expect.any(Number),
      );
    });
  });

  it("freshly resends first prompt when empty codex draft cannot be rebound", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message: "thread not found: legacy-thread-id",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-fresh-draft" } },
      } as never);
    const refreshThread = vi.fn(async () => null);
    const startThreadForWorkspace = vi.fn(async () => "thread-fresh-draft");
    const dispatch = vi.fn();
    const { result, recordThreadActivity } = makeHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
      dispatch,
      codexAcceptedTurnByThread: {
        "legacy-thread-id": {
          fact: "empty-draft",
          source: "thread-start",
          updatedAt: 1,
        },
      },
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
        activate: true,
        engine: "codex",
      });
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-fresh-draft",
        "hello codex",
        expect.any(Object),
      );
      expect(dispatch).toHaveBeenCalledWith({
        type: "setActiveThreadId",
        workspaceId: "ws-1",
        threadId: "thread-fresh-draft",
      });
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setThreadItems",
          threadId: "legacy-thread-id",
        }),
      );
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "markCodexAcceptedTurn",
          threadId: "thread-fresh-draft",
          fact: "accepted",
          source: "turn-start-response",
        }),
      );
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "renameThreadId",
          oldThreadId: "legacy-thread-id",
          newThreadId: "thread-fresh-draft",
        }),
      );
      expect(recordThreadActivity).not.toHaveBeenCalledWith(
        "ws-1",
        "legacy-thread-id",
        expect.any(Number),
      );
      expect(recordThreadActivity).toHaveBeenCalledWith(
        "ws-1",
        "thread-fresh-draft",
        expect.any(Number),
      );
    });
  });

  it("mirrors codex turn-start rpc failures into runtime notices", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        type: "invalid_request_error",
        message:
          "The 'demo' model is not supported when using Codex with a ChatGPT account.",
      },
    } as never);
    const { result, pushThreadErrorMessage } = makeHook("codex");

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        "thread-1",
        "会话启动失败：The 'demo' model is not supported when using Codex with a ChatGPT account.",
      );
      expect(getGlobalRuntimeNoticesSnapshot()).toEqual([
        expect.objectContaining({
          severity: "error",
          category: "user-action-error",
          messageKey: "runtimeNotice.error.threadTurnFailed",
          messageParams: {
            engine: "Codex",
            message:
              "The 'demo' model is not supported when using Codex with a ChatGPT account.",
          },
        }),
      ]);
    });
  });

  it("mirrors classified runtime-ended failures with reconnect action context", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "[RUNTIME_ENDED] Managed runtime ended before this conversation turn settled.",
      },
    } as never);
    const { result } = makeHook("codex");

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(getGlobalRuntimeNoticesSnapshot()).toEqual([
        expect.objectContaining({
          severity: "error",
          category: "user-action-error",
          messageKey: "runtimeNotice.error.threadTurnFailed",
          messageParams: {
            engine: "Codex",
            message: "[RUNTIME_ENDED] Managed runtime ended before this conversation turn settled.",
            reasonCode: "runtime-ended",
            userAction: "reconnect",
            actionHint: "Reconnect the runtime and retry.",
          },
        }),
      ]);
    });
  });

  it("marks codex thread as accepted after turn start response", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      result: { turn: { id: "turn-accepted" } },
    } as never);
    const dispatch = vi.fn();
    const { result } = makeHook("codex", { dispatch });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "markCodexAcceptedTurn",
          threadId: "thread-1",
          fact: "accepted",
          source: "turn-start-response",
          timestamp: expect.any(Number),
        }),
      );
    });
  });

  it("retries codex send once when stale thread reports thread not found", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message: "thread not found: legacy-thread-id",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-rebound-thread-not-found" } },
      } as never);
    const refreshThread = vi.fn(async () => "thread-rebound-2");
    const dispatch = vi.fn();
    const { result, onDebug } = makeHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      refreshThread,
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-rebound-2",
        "hello codex",
        expect.any(Object),
      );
      const reboundUserBubbleActions = dispatch.mock.calls.filter(
        ([action]) =>
          action &&
          typeof action === "object" &&
          "type" in action &&
          (action as { type?: string }).type === "upsertItem" &&
          "threadId" in action &&
          (action as { threadId?: string }).threadId === "thread-rebound-2" &&
          "item" in action &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.kind ===
            "message" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.role ===
            "user" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.text ===
            "hello codex",
      );
      expect(reboundUserBubbleActions).toHaveLength(1);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setThreadItems",
          threadId: "legacy-thread-id",
        }),
      );
      expect(onDebug).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "turn/start thread rebind retry",
          payload: expect.objectContaining({
            reasonCode: "stale-thread-binding",
            staleReason: "thread-not-found",
            retryable: true,
            userAction: "recover-thread",
            outcome: "rebound",
          }),
        }),
      );
    });
  });

  it("retries codex send once when stale thread throws session not found", async () => {
    vi.mocked(sendUserMessage)
      .mockRejectedValueOnce(new Error("[SESSION_NOT_FOUND] session file not found"))
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-rebound-session-not-found" } },
      } as never);
    const refreshThread = vi.fn(async () => "thread-rebound-3");
    const dispatch = vi.fn();
    const { result, pushThreadErrorMessage } = makeHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      refreshThread,
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-rebound-3",
        "hello codex",
        expect.any(Object),
      );
      expect(pushThreadErrorMessage).not.toHaveBeenCalled();
      const reboundUserBubbleActions = dispatch.mock.calls.filter(
        ([action]) =>
          action &&
          typeof action === "object" &&
          "type" in action &&
          (action as { type?: string }).type === "upsertItem" &&
          "threadId" in action &&
          (action as { threadId?: string }).threadId === "thread-rebound-3" &&
          "item" in action &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.kind ===
            "message" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.role ===
            "user" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.text ===
            "hello codex",
      );
      expect(reboundUserBubbleActions).toHaveLength(1);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setThreadItems",
          threadId: "legacy-thread-id",
        }),
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

});
