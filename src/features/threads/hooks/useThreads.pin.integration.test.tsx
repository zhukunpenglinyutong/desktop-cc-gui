// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import type { useAppServerEvents } from "../../app/hooks/useAppServerEvents";
import { useThreadRows } from "../../app/hooks/useThreadRows";
import { writeClientStoreData } from "../../../services/clientStorage";
import { useThreads } from "./useThreads";

type AppServerHandlers = Parameters<typeof useAppServerEvents>[0];

vi.mock("../../app/hooks/useAppServerEvents", () => ({
  useAppServerEvents: (_incoming: AppServerHandlers) => {},
}));

vi.mock("../../../services/tauri", () => ({
  respondToServerRequest: vi.fn(),
  respondToUserInputRequest: vi.fn(),
  listThreadTitles: vi.fn(),
  setThreadTitle: vi.fn(),
  renameThreadTitleKey: vi.fn(),
  generateThreadTitle: vi.fn(),
  rememberApprovalRule: vi.fn(),
  sendUserMessage: vi.fn(),
  startReview: vi.fn(),
  startThread: vi.fn(),
  listThreads: vi.fn(),
  resumeThread: vi.fn(),
  archiveThread: vi.fn(),
  deleteOpenCodeSession: vi.fn(),
  getAccountRateLimits: vi.fn(),
  getAccountInfo: vi.fn(),
  interruptTurn: vi.fn(),
  approveToolCall: vi.fn(),
  denyToolCall: vi.fn(),
  executeSlashCommand: vi.fn(),
  branchWorkspace: vi.fn(),
  startMcpSession: vi.fn(),
  startSpecRootSession: vi.fn(),
  startStatusSession: vi.fn(),
  startContextSession: vi.fn(),
  startFastSession: vi.fn(),
  startModeSession: vi.fn(),
  startExportSession: vi.fn(),
  startImportSession: vi.fn(),
  startLspSession: vi.fn(),
  startShareSession: vi.fn(),
  listWorkspacePlugins: vi.fn(),
  addWorkspacePlugin: vi.fn(),
  removeWorkspacePlugin: vi.fn(),
  listWorkspaceProviderProfiles: vi.fn(),
  saveWorkspaceProviderProfile: vi.fn(),
  removeWorkspaceProviderProfile: vi.fn(),
  saveWorkspaceProviderSelection: vi.fn(),
  listWorkspaceOpenCodeAgents: vi.fn(),
  projectMemoryUpdate: vi.fn(),
  projectMemoryCreate: vi.fn(),
}));

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "MossX",
  path: "/tmp/codex",
  connected: true,
  settings: { sidebarCollapsed: false },
};

describe("useThreads pin integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeClientStoreData("threads", {});
  });

  it("keeps pin state/version and thread row partition in sync", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );
    const rowsHook = renderHook(() => useThreadRows(result.current.threadParentById));

    const threads = [
      { id: "thread-a", name: "A", updatedAt: 10 },
      { id: "thread-b", name: "B", updatedAt: 20 },
    ];

    const initialRows = rowsHook.result.current.getThreadRows(
      threads,
      true,
      workspace.id,
      result.current.getPinTimestamp,
    );
    expect(initialRows.pinnedRows).toHaveLength(0);
    expect(initialRows.unpinnedRows.map((entry) => entry.thread.id)).toEqual([
      "thread-a",
      "thread-b",
    ]);

    const initialVersion = result.current.pinnedThreadsVersion;
    let pinResult = false;
    await act(async () => {
      pinResult = result.current.pinThread(workspace.id, "thread-a");
    });
    expect(pinResult).toBe(true);
    expect(result.current.isThreadPinned(workspace.id, "thread-a")).toBe(true);
    expect(result.current.pinnedThreadsVersion).toBe(initialVersion + 1);
    expect(result.current.getPinTimestamp(workspace.id, "thread-a")).not.toBeNull();

    const pinnedRows = rowsHook.result.current.getThreadRows(
      threads,
      true,
      workspace.id,
      result.current.getPinTimestamp,
    );
    expect(pinnedRows.pinnedRows.map((entry) => entry.thread.id)).toEqual(["thread-a"]);
    expect(pinnedRows.unpinnedRows.map((entry) => entry.thread.id)).toEqual(["thread-b"]);

    await act(async () => {
      result.current.unpinThread(workspace.id, "thread-a");
    });
    expect(result.current.isThreadPinned(workspace.id, "thread-a")).toBe(false);
    expect(result.current.getPinTimestamp(workspace.id, "thread-a")).toBeNull();
    expect(result.current.pinnedThreadsVersion).toBe(initialVersion + 2);

    const unpinnedRowsAgain = rowsHook.result.current.getThreadRows(
      threads,
      true,
      workspace.id,
      result.current.getPinTimestamp,
    );
    expect(unpinnedRowsAgain.pinnedRows).toHaveLength(0);
    expect(unpinnedRowsAgain.unpinnedRows.map((entry) => entry.thread.id)).toEqual([
      "thread-a",
      "thread-b",
    ]);
  });
});
