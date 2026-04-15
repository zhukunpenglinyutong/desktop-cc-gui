// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import {
  connectWorkspace,
  getOpenCodeSessionList,
  listClaudeSessions,
  listGeminiSessions,
  listThreadTitles,
  listThreads,
  readWorkspaceFile,
  renameThreadTitleKey,
  setThreadTitle,
  trashWorkspaceItem,
  writeWorkspaceFile,
} from "../../../services/tauri";
import {
  getThreadTimestamp,
  previewThreadName,
} from "../../../utils/threadItems";
import { listSharedSessions } from "../../shared-session/services/sharedSessions";
import { loadCodexRewindHiddenItemIds } from "../utils/threadStorage";
import { useThreadActions } from "./useThreadActions";

vi.mock("../../../services/tauri", () => ({
  archiveThread: vi.fn(),
  connectWorkspace: vi.fn(),
  deleteCodexSession: vi.fn(),
  deleteClaudeSession: vi.fn(),
  deleteGeminiSession: vi.fn(),
  deleteOpenCodeSession: vi.fn(),
  forkClaudeSession: vi.fn(),
  forkClaudeSessionFromMessage: vi.fn(),
  forkThread: vi.fn(),
  getOpenCodeSessionList: vi.fn(),
  listClaudeSessions: vi.fn(),
  listGeminiSessions: vi.fn(),
  listThreadTitles: vi.fn(),
  listThreads: vi.fn(),
  loadClaudeSession: vi.fn(),
  loadCodexSession: vi.fn(),
  loadGeminiSession: vi.fn(),
  readWorkspaceFile: vi.fn(),
  renameThreadTitleKey: vi.fn(),
  resumeThread: vi.fn(),
  setThreadTitle: vi.fn(),
  startThread: vi.fn(),
  trashWorkspaceItem: vi.fn(),
  writeWorkspaceFile: vi.fn(),
}));

vi.mock("../../../utils/threadItems", () => ({
  buildItemsFromThread: vi.fn(),
  getThreadTimestamp: vi.fn(),
  isReviewingFromThread: vi.fn(),
  mergeThreadItems: vi.fn(),
  previewThreadName: vi.fn(),
}));

vi.mock("../utils/threadStorage", () => ({
  loadCodexRewindHiddenItemIds: vi.fn(() => ({})),
  makeCustomNameKey: (workspaceId: string, threadId: string) =>
    `${workspaceId}:${threadId}`,
  saveCodexRewindHiddenItemIds: vi.fn(),
  saveThreadActivity: vi.fn(),
}));

vi.mock("../../shared-session/services/sharedSessions", () => ({
  deleteSharedSession: vi.fn(),
  listSharedSessions: vi.fn(),
  loadSharedSession: vi.fn(),
  startSharedSession: vi.fn(),
}));

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "ccgui",
  path: "/tmp/codex",
  connected: true,
  settings: { sidebarCollapsed: false },
};

function renderActions() {
  const dispatch = vi.fn();
  const loadedThreadsRef = { current: {} as Record<string, boolean> };
  const replaceOnResumeRef = { current: {} as Record<string, boolean> };
  const threadActivityRef = {
    current: {} as Record<string, Record<string, number>>,
  };

  const args: Parameters<typeof useThreadActions>[0] = {
    dispatch,
    itemsByThread: {},
    userInputRequests: [],
    threadsByWorkspace: {},
    activeThreadIdByWorkspace: {},
    threadListCursorByWorkspace: {},
    threadStatusById: {},
    getCustomName: () => undefined,
    threadActivityRef,
    loadedThreadsRef,
    replaceOnResumeRef,
    applyCollabThreadLinksFromThread: vi.fn(),
    updateThreadParent: vi.fn(),
    onThreadTitleMappingsLoaded: vi.fn(),
    onRenameThreadTitleMapping: vi.fn(),
  };

  const utils = renderHook(() => useThreadActions(args));
  return { dispatch, ...utils };
}

describe("useThreadActions shared/native compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadCodexRewindHiddenItemIds).mockReturnValue({});
    vi.mocked(listThreadTitles).mockResolvedValue({});
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    });
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(listGeminiSessions).mockResolvedValue([]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(listSharedSessions).mockResolvedValue([]);
    vi.mocked(renameThreadTitleKey).mockResolvedValue(undefined);
    vi.mocked(setThreadTitle).mockResolvedValue("title");
    vi.mocked(connectWorkspace).mockResolvedValue(undefined);
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "",
      truncated: false,
    });
    vi.mocked(trashWorkspaceItem).mockResolvedValue(undefined);
    vi.mocked(writeWorkspaceFile).mockResolvedValue(undefined);
    vi.mocked(previewThreadName).mockImplementation((text: string, fallback: string) => {
      const trimmed = text.trim();
      return trimmed || fallback;
    });
    vi.mocked(getThreadTimestamp).mockImplementation((thread) => {
      const record = thread as Record<string, unknown>;
      const value = record.updated_at ?? record.updatedAt;
      return typeof value === "number" ? value : 0;
    });
  });

  it("keeps native gemini and opencode sessions visible when shared summaries contain legacy foreign bindings", async () => {
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([
      {
        sessionId: "ses_opc_visible_1",
        title: "OpenCode Visible",
        updatedLabel: "1m ago",
        updatedAt: 1_730_000_310_000,
      },
    ]);
    vi.mocked(listGeminiSessions).mockResolvedValue([
      {
        sessionId: "ses_gemini_visible_1",
        firstMessage: "Gemini Visible",
        updatedAt: 1_730_000_320_000,
      },
    ]);
    vi.mocked(listSharedSessions).mockResolvedValue([
      {
        id: "shared-session-legacy-1",
        threadId: "shared:shared-session-legacy-1",
        title: "Shared Legacy",
        updatedAt: 1_730_000_330_000,
        selectedEngine: "claude",
        nativeThreadIds: [
          "gemini:ses_gemini_visible_1",
          "opencode:ses_opc_visible_1",
          "claude:session-1",
        ],
      },
    ]);

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    await waitFor(() => {
      const setThreadsActions = vi.mocked(dispatch).mock.calls
        .map(([action]) => action)
        .filter((action) => action?.type === "setThreads");
      expect(setThreadsActions.length).toBeGreaterThan(0);
      expect(
        setThreadsActions.some((action) => {
          const threadIds = Array.isArray(action.threads)
            ? action.threads.map((thread: { id: string }) => thread.id)
            : [];
          return (
            threadIds.includes("shared:shared-session-legacy-1") &&
            threadIds.includes("gemini:ses_gemini_visible_1") &&
            threadIds.includes("opencode:ses_opc_visible_1")
          );
        }),
      ).toBe(true);
    });
  });

  it("hides claude native bindings owned by shared sessions from native thread list", async () => {
    vi.mocked(listClaudeSessions).mockResolvedValue([
      {
        sessionId: "session-hidden",
        firstMessage: "Hidden Claude Binding",
        updatedAt: 1_730_000_340_000,
      },
      {
        sessionId: "session-visible",
        firstMessage: "Visible Claude Session",
        updatedAt: 1_730_000_350_000,
      },
    ]);
    vi.mocked(listSharedSessions).mockResolvedValue([
      {
        id: "shared-session-claude-1",
        threadId: "shared:shared-session-claude-1",
        title: "Shared Claude",
        updatedAt: 1_730_000_360_000,
        selectedEngine: "claude",
        nativeThreadIds: ["claude:session-hidden"],
      },
    ]);

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    await waitFor(() => {
      const setThreadsActions = vi.mocked(dispatch).mock.calls
        .map(([action]) => action)
        .filter((action) => action?.type === "setThreads");
      expect(setThreadsActions.length).toBeGreaterThan(0);
      expect(
        setThreadsActions.some((action) => {
          const threadIds = Array.isArray(action.threads)
            ? action.threads.map((thread: { id: string }) => thread.id)
            : [];
          return (
            threadIds.includes("shared:shared-session-claude-1") &&
            threadIds.includes("claude:session-visible") &&
            !threadIds.includes("claude:session-hidden")
          );
        }),
      ).toBe(true);
    });
  });
});
