// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { useWorkspaceActions } from "./useWorkspaceActions";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  ensureRuntimeReady,
  openNewWindow,
  pickWorkspacePath,
} from "../../../services/tauri";
import { pushGlobalRuntimeNotice } from "../../../services/globalRuntimeNotices";
import { pushErrorToast } from "../../../services/toasts";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      switch (key) {
        case "workspace.loadingProgressCreateSessionMessage":
          return `create:${String(options?.engine ?? "")}:${String(options?.workspace ?? "")}`;
        case "workspace.loadingProgressAddProjectMessage":
          return `add:${String(options?.project ?? "")}`;
        case "workspace.loadingProgressOpenProjectMessage":
          return `open:${String(options?.project ?? "")}`;
        case "errors.failedToCreateSessionRuntimeRecovering":
          return "errors.failedToCreateSessionRuntimeRecovering";
        case "errors.reconnectAndRetryCreateSession":
          return "errors.reconnectAndRetryCreateSession";
        case "errors.reconnectingAndRetryingCreateSession":
          return "errors.reconnectingAndRetryingCreateSession";
        case "errors.runtimeRecovered":
          return "errors.runtimeRecovered";
        case "errors.retryingCreateSessionAfterRecovery":
          return "errors.retryingCreateSessionAfterRecovery";
        default:
          return key;
      }
    },
  }),
}));

vi.mock("./useNewAgentShortcut", () => ({
  useNewAgentShortcut: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
}));

vi.mock("../../../services/tauri", () => ({
  openNewWindow: vi.fn(async () => undefined),
  pickWorkspacePath: vi.fn(async () => null),
  ensureRuntimeReady: vi.fn(async () => undefined),
}));

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

vi.mock("../../../services/globalRuntimeNotices", () => ({
  pushGlobalRuntimeNotice: vi.fn(),
}));

const baseWorkspace: WorkspaceInfo = {
  id: "ws-1",
  name: "Workspace",
  path: "/tmp/workspace",
  connected: true,
  settings: { sidebarCollapsed: false },
};

function makeOptions(overrides?: Partial<Parameters<typeof useWorkspaceActions>[0]>) {
  return {
    activeWorkspace: baseWorkspace,
    isCompact: false,
    activeEngine: "claude" as const,
    newAgentShortcut: null,
    setActiveEngine: vi.fn(async () => undefined),
    addWorkspace: vi.fn(async () => null),
    addWorkspaceFromPath: vi.fn(async () => null),
    connectWorkspace: vi.fn(async () => undefined),
    startThreadForWorkspace: vi.fn(async () => "thread-1"),
    setActiveThreadId: vi.fn(),
    setActiveTab: vi.fn(),
    exitDiffView: vi.fn(),
    selectWorkspace: vi.fn(),
    openWorktreePrompt: vi.fn(),
    openClonePrompt: vi.fn(),
    composerInputRef: { current: null },
    showLoadingProgressDialog: vi.fn(() => "loading-1"),
    hideLoadingProgressDialog: vi.fn(),
    onDebug: vi.fn(),
    ...overrides,
  };
}

describe("useWorkspaceActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("alert", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses selected engine for new session and switches active engine first", async () => {
    const workspace: WorkspaceInfo = { ...baseWorkspace, connected: false };
    const options = makeOptions({ activeEngine: "claude" });

    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(workspace, "codex");
    });

    expect(options.selectWorkspace).toHaveBeenCalledWith("ws-1");
    expect(options.connectWorkspace).toHaveBeenCalledWith(workspace);
    expect(options.setActiveEngine).toHaveBeenCalledWith("codex");
    expect(options.startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      engine: "codex",
    });
    expect(options.showLoadingProgressDialog).toHaveBeenCalledWith({
      title: "workspace.loadingProgressCreateSessionTitle",
      message: "create:workspace.engineCodex:Workspace",
    });
    expect(options.hideLoadingProgressDialog).toHaveBeenCalledWith("loading-1");
  });

  it("falls back to current active engine when no explicit engine provided", async () => {
    const options = makeOptions({ activeEngine: "opencode" });

    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace);
    });

    expect(options.setActiveEngine).not.toHaveBeenCalled();
    expect(options.startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      engine: "opencode",
    });
    expect(options.hideLoadingProgressDialog).toHaveBeenCalledWith("loading-1");
  });

  it("adds workspace to current window when open mode is current", async () => {
    vi.mocked(pickWorkspacePath).mockResolvedValue("/tmp/new-repo");
    vi.mocked(ask).mockResolvedValueOnce(true);
    const options = makeOptions({
      addWorkspaceFromPath: vi.fn(async () => ({
        id: "ws-2",
        name: "new-repo",
        path: "/tmp/new-repo",
        connected: true,
        settings: { sidebarCollapsed: false },
      })),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddWorkspace();
    });

    expect(options.addWorkspaceFromPath).toHaveBeenCalledWith("/tmp/new-repo");
    expect(openNewWindow).not.toHaveBeenCalled();
    expect(options.showLoadingProgressDialog).toHaveBeenCalledWith({
      title: "workspace.loadingProgressAddProjectTitle",
      message: "add:new-repo",
    });
    expect(options.hideLoadingProgressDialog).toHaveBeenCalledWith("loading-1");
  });

  it("opens new window when mode is new-window", async () => {
    vi.mocked(pickWorkspacePath).mockResolvedValue("/tmp/new-repo");
    vi.mocked(ask).mockResolvedValueOnce(false);
    const options = makeOptions();
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddWorkspace();
    });

    expect(openNewWindow).toHaveBeenCalledWith("/tmp/new-repo");
    expect(options.addWorkspaceFromPath).not.toHaveBeenCalled();
    expect(options.showLoadingProgressDialog).toHaveBeenCalledWith({
      title: "workspace.loadingProgressOpenProjectTitle",
      message: "open:new-repo",
    });
    expect(options.hideLoadingProgressDialog).toHaveBeenCalledWith("loading-1");
  });

  it("asks user for mode once on each add workspace flow", async () => {
    vi.mocked(pickWorkspacePath).mockResolvedValue("/tmp/new-repo");
    vi.mocked(ask).mockResolvedValueOnce(false);
    const options = makeOptions();
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddWorkspace();
    });

    expect(ask).toHaveBeenCalledTimes(1);
    expect(openNewWindow).toHaveBeenCalledWith("/tmp/new-repo");
  });

  it("extracts the project name from Windows paths when showing progress copy", async () => {
    vi.mocked(pickWorkspacePath).mockResolvedValue("C:\\Users\\chen\\code\\mossx");
    vi.mocked(ask).mockResolvedValueOnce(true);
    const options = makeOptions({
      addWorkspaceFromPath: vi.fn(async () => ({
        id: "ws-2",
        name: "",
        path: "C:\\Users\\chen\\code\\mossx",
        connected: true,
        settings: { sidebarCollapsed: false },
      })),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddWorkspace();
    });

    expect(options.showLoadingProgressDialog).toHaveBeenCalledWith({
      title: "workspace.loadingProgressAddProjectTitle",
      message: "add:mossx",
    });
  });

  it("surfaces session creation failures when no thread id is returned", async () => {
    const options = makeOptions({
      isCompact: true,
      startThreadForWorkspace: vi.fn(async () => null),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace, "claude");
    });

    expect(window.alert).toHaveBeenCalledWith(
      "errors.failedToCreateSession\n\nerrors.failedToCreateSessionNoThreadId",
    );
    expect(options.setActiveTab).not.toHaveBeenCalled();
    expect(options.hideLoadingProgressDialog).toHaveBeenCalledWith("loading-1");
  });

  it("localizes stopping-runtime create-session failures after automatic retry is exhausted", async () => {
    const options = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        throw new Error(
          "[SESSION_CREATE_RUNTIME_RECOVERING] Managed runtime was restarting while creating this session. The app retried automatically but could not acquire a healthy runtime yet. Reconnect the workspace and try again.",
        );
      }),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace, "codex");
    });

    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "create-session-recovery-ws-1-codex",
        title: "errors.failedToCreateSession",
        message: "errors.failedToCreateSessionRuntimeRecovering",
        sticky: true,
        actions: [
          expect.objectContaining({
            label: "errors.reconnectAndRetryCreateSession",
            pendingLabel: "errors.reconnectingAndRetryingCreateSession",
          }),
        ],
      }),
    );
    expect(pushGlobalRuntimeNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: "runtimeNotice.error.createSessionRecoveryRequired",
        messageParams: {
          workspace: "Workspace",
        },
      }),
    );
    expect(options.onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "workspace/create-session recovery toast",
        payload: expect.objectContaining({
          error: expect.stringContaining("[SESSION_CREATE_RUNTIME_RECOVERING]"),
        }),
      }),
    );
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("reuses runtime-ready recovery contract when the create-session toast action runs", async () => {
    let shouldFail = true;
    const recoverableOptions = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        if (shouldFail) {
          throw new Error(
            "[SESSION_CREATE_RUNTIME_RECOVERING] Managed runtime was restarting while creating this session. The app retried automatically but could not acquire a healthy runtime yet. Reconnect the workspace and try again.",
          );
        }
        return "thread-recovered";
      }),
    });
    const recoverableHook = renderHook(() => useWorkspaceActions(recoverableOptions));

    await act(async () => {
      await recoverableHook.result.current.handleAddAgent(baseWorkspace, "codex");
    });

    const toastInput = vi.mocked(pushErrorToast).mock.calls[0]?.[0];
    const retryAction = toastInput?.actions?.[0];

    shouldFail = false;

    await act(async () => {
      await retryAction?.run();
    });

    expect(ensureRuntimeReady).toHaveBeenCalledWith("ws-1");
    expect(vi.mocked(pushErrorToast)).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "create-session-recovery-progress-ws-1-codex",
        title: "errors.runtimeRecovered",
        message: "errors.retryingCreateSessionAfterRecovery",
        variant: "info",
      }),
    );
    expect(recoverableOptions.startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      engine: "codex",
    });
  });

  it("localizes empty-thread retry failures before surfacing them back to the toast action", async () => {
    let shouldRecover = false;
    const recoverableOptions = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        if (!shouldRecover) {
          throw new Error(
            "[SESSION_CREATE_RUNTIME_RECOVERING] Managed runtime was restarting while creating this session. The app retried automatically but could not acquire a healthy runtime yet. Reconnect the workspace and try again.",
          );
        }
        return null;
      }),
    });
    const recoverableHook = renderHook(() => useWorkspaceActions(recoverableOptions));

    await act(async () => {
      await recoverableHook.result.current.handleAddAgent(baseWorkspace, "codex");
    });

    const toastInput = vi.mocked(pushErrorToast).mock.calls[0]?.[0];
    const retryAction = toastInput?.actions?.[0];
    shouldRecover = true;

    await expect(retryAction?.run()).rejects.toThrow(
      "errors.failedToCreateSessionNoThreadId",
    );
  });

  it("localizes Windows CLI-not-found create-session failures", async () => {
    const options = makeOptions({
      startThreadForWorkspace: vi.fn(async () => {
        throw new Error(
          "Failed to execute codex: The system cannot find the file specified. (os error 2)",
        );
      }),
    });
    const { result } = renderHook(() => useWorkspaceActions(options));

    await act(async () => {
      await result.current.handleAddAgent(baseWorkspace, "codex");
    });

    expect(window.alert).toHaveBeenCalledWith(
      "errors.failedToCreateSession\n\nerrors.cliNotFound\n\nerrors.cliNotFoundHint",
    );
  });
});
