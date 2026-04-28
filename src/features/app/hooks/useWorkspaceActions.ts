import type { RefObject } from "react";
import { useCallback } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { useNewAgentShortcut } from "./useNewAgentShortcut";
import type { LoadingProgressDialogConfig } from "./useLoadingProgressDialogState";
import { runWithLoadingProgress } from "../utils/loadingProgressActions";
import { pushGlobalRuntimeNotice } from "../../../services/globalRuntimeNotices";
import { ensureRuntimeReady, openNewWindow, pickWorkspacePath } from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import type { DebugEntry, EngineType, WorkspaceInfo } from "../../../types";

type WorkspaceOpenMode = "current-window" | "new-window";
const SESSION_CREATION_EMPTY_THREAD_ID = "SESSION_CREATION_EMPTY_THREAD_ID";
const CREATE_SESSION_RUNTIME_RECOVERING_ERROR_PREFIX =
  "[SESSION_CREATE_RUNTIME_RECOVERING]";
const CREATE_SESSION_RECOVERY_TOAST_ID_PREFIX = "create-session-recovery";
const CREATE_SESSION_RECOVERY_PROGRESS_TOAST_ID_PREFIX =
  "create-session-recovery-progress";

function isStoppingRuntimeCreateSessionError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    message.startsWith(CREATE_SESSION_RUNTIME_RECOVERING_ERROR_PREFIX) ||
    normalized.includes("manual shutdown") ||
    normalized.includes("manual_shutdown") ||
    (normalized.includes("[runtime_ended]") && normalized.includes("stopped after"))
  );
}

function isCliNotFoundError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    message.startsWith("CLI_NOT_FOUND:") ||
    normalized.includes("no such file or directory") ||
    normalized.includes("the system cannot find the file specified") ||
    normalized.includes("is not recognized as an internal or external command") ||
    normalized.includes("spawn") && normalized.includes("enoent") ||
    normalized.includes("failed to execute claude") ||
    normalized.includes("failed to execute codex") ||
    normalized.includes("failed to execute gemini") ||
    normalized.includes("failed to execute opencode")
  );
}

type Params = {
  activeWorkspace: WorkspaceInfo | null;
  isCompact: boolean;
  activeEngine: EngineType;
  newAgentShortcut: string | null;
  setActiveEngine?: (engine: EngineType) => Promise<void> | void;
  addWorkspace: () => Promise<WorkspaceInfo | null>;
  addWorkspaceFromPath: (path: string) => Promise<WorkspaceInfo | null>;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: { engine?: EngineType },
  ) => Promise<string | null>;
  setActiveThreadId: (threadId: string | null, workspaceId: string) => void;
  setActiveTab: (tab: "projects" | "codex" | "spec" | "git" | "log") => void;
  exitDiffView: () => void;
  selectWorkspace: (workspaceId: string) => void;
  openWorktreePrompt: (workspace: WorkspaceInfo) => void;
  openClonePrompt: (workspace: WorkspaceInfo) => void;
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  showLoadingProgressDialog: (config: LoadingProgressDialogConfig) => string;
  hideLoadingProgressDialog: (requestId: string) => void;
  onDebug: (entry: DebugEntry) => void;
};

export function useWorkspaceActions({
  activeWorkspace,
  isCompact,
  activeEngine,
  newAgentShortcut,
  setActiveEngine,
  addWorkspace: _addWorkspace,
  addWorkspaceFromPath,
  connectWorkspace,
  startThreadForWorkspace,
  setActiveThreadId,
  setActiveTab,
  exitDiffView,
  selectWorkspace,
  openWorktreePrompt,
  openClonePrompt,
  composerInputRef,
  showLoadingProgressDialog,
  hideLoadingProgressDialog,
  onDebug,
}: Params) {
  const { t } = useTranslation();

  const resolveWorkspaceDisplayName = useCallback((value: string) => {
    const segments = value
      .split(/[\\/]/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    return segments[segments.length - 1] ?? value;
  }, []);

  const resolveWorkspaceLabel = useCallback(
    (workspace: Pick<WorkspaceInfo, "name" | "path">) => {
      const trimmedName = workspace.name.trim();
      if (trimmedName.length > 0) {
        return trimmedName;
      }
      return resolveWorkspaceDisplayName(workspace.path);
    },
    [resolveWorkspaceDisplayName],
  );

  const resolveEngineLabel = useCallback(
    (engine: EngineType) => {
      switch (engine) {
        case "codex":
          return t("workspace.engineCodex");
        case "gemini":
          return t("workspace.engineGemini");
        case "opencode":
          return t("workspace.engineOpenCode");
        case "claude":
        default:
          return t("workspace.engineClaudeCode");
      }
    },
    [t],
  );

  const localizeErrorMessage = useCallback(
    (message: string): string => {
      if (isCliNotFoundError(message)) {
        return `${t("errors.cliNotFound")}\n\n${t("errors.cliNotFoundHint")}`;
      }
      return message;
    },
    [t],
  );

  const localizeSessionCreationErrorMessage = useCallback(
    (message: string): string => {
      if (isStoppingRuntimeCreateSessionError(message)) {
        return t("errors.failedToCreateSessionRuntimeRecovering");
      }
      return localizeErrorMessage(message);
    },
    [localizeErrorMessage, t],
  );

  const resolveSessionCreationErrorDetail = useCallback(
    (message: string): string => {
      if (message === SESSION_CREATION_EMPTY_THREAD_ID) {
        return t("errors.failedToCreateSessionNoThreadId");
      }
      return localizeSessionCreationErrorMessage(message);
    },
    [localizeSessionCreationErrorMessage, t],
  );

  const runCreateSessionFlow = useCallback(
    async (workspace: WorkspaceInfo, targetEngine: EngineType) => {
      await runWithLoadingProgress(
        { showLoadingProgressDialog, hideLoadingProgressDialog },
        {
          title: t("workspace.loadingProgressCreateSessionTitle"),
          message: t("workspace.loadingProgressCreateSessionMessage", {
            engine: resolveEngineLabel(targetEngine),
            workspace: resolveWorkspaceLabel(workspace),
          }),
        },
        async () => {
          exitDiffView();
          selectWorkspace(workspace.id);
          if (!workspace.connected) {
            await connectWorkspace(workspace);
          }
          if (targetEngine !== activeEngine) {
            try {
              await setActiveEngine?.(targetEngine);
            } catch (error) {
              onDebug({
                id: `${Date.now()}-client-switch-engine-before-new-thread-error`,
                timestamp: Date.now(),
                source: "error",
                label: "workspace/switch engine before new thread error",
                payload: error instanceof Error ? error.message : String(error),
              });
            }
          }
          const threadId = await startThreadForWorkspace(workspace.id, {
            engine: targetEngine,
          });
          if (!threadId) {
            throw new Error(SESSION_CREATION_EMPTY_THREAD_ID);
          }
          if (isCompact) {
            setActiveTab("codex");
          }
          setTimeout(() => composerInputRef.current?.focus(), 0);
        },
      );
    },
    [
      activeEngine,
      composerInputRef,
      connectWorkspace,
      exitDiffView,
      hideLoadingProgressDialog,
      isCompact,
      onDebug,
      resolveEngineLabel,
      resolveWorkspaceLabel,
      selectWorkspace,
      setActiveEngine,
      setActiveTab,
      showLoadingProgressDialog,
      startThreadForWorkspace,
      t,
    ],
  );

  const retryCreateSessionAfterRuntimeRecovery = useCallback(
    async (workspace: WorkspaceInfo, targetEngine: EngineType) => {
      try {
        await ensureRuntimeReady(workspace.id);
        pushErrorToast({
          id: `${CREATE_SESSION_RECOVERY_PROGRESS_TOAST_ID_PREFIX}-${workspace.id}-${targetEngine}`,
          title: t("errors.runtimeRecovered"),
          message: t("errors.retryingCreateSessionAfterRecovery"),
          variant: "info",
          durationMs: 2600,
        });
        await runCreateSessionFlow(workspace, targetEngine);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(resolveSessionCreationErrorDetail(message));
      }
    },
    [resolveSessionCreationErrorDetail, runCreateSessionFlow, t],
  );

  const showRecoverableCreateSessionToast = useCallback(
    (workspace: WorkspaceInfo, targetEngine: EngineType, message: string) => {
      const detail = localizeSessionCreationErrorMessage(message);
      pushGlobalRuntimeNotice({
        severity: "error",
        category: "workspace",
        messageKey: "runtimeNotice.error.createSessionRecoveryRequired",
        messageParams: {
          workspace: resolveWorkspaceLabel(workspace),
        },
        dedupeKey: `workspace:create-session-recovery:${workspace.id}:${targetEngine}`,
      });
      pushErrorToast({
        id: `${CREATE_SESSION_RECOVERY_TOAST_ID_PREFIX}-${workspace.id}-${targetEngine}`,
        title: t("errors.failedToCreateSession"),
        message: detail,
        sticky: true,
        actions: [
          {
            label: t("errors.reconnectAndRetryCreateSession"),
            pendingLabel: t("errors.reconnectingAndRetryingCreateSession"),
            run: async () => {
              onDebug({
                id: `${Date.now()}-client-create-session-recovery-toast-action`,
                timestamp: Date.now(),
                source: "client",
                label: "workspace/create-session recovery toast action",
                payload: {
                  workspaceId: workspace.id,
                  engine: targetEngine,
                },
              });
              await retryCreateSessionAfterRuntimeRecovery(workspace, targetEngine);
            },
          },
        ],
      });
    },
    [
      localizeSessionCreationErrorMessage,
      onDebug,
      resolveWorkspaceLabel,
      retryCreateSessionAfterRuntimeRecovery,
      t,
    ],
  );

  const handleWorkspaceAdded = useCallback(
    (workspace: WorkspaceInfo) => {
      setActiveThreadId(null, workspace.id);
      if (isCompact) {
        setActiveTab("codex");
      }
    },
    [isCompact, setActiveTab, setActiveThreadId],
  );

  const resolveWorkspaceOpenMode = useCallback(async (): Promise<WorkspaceOpenMode> => {
    const useCurrentWindow = await ask(t("workspace.addWorkspaceOpenModePrompt"), {
      title: t("workspace.addWorkspaceOpenModeTitle"),
      kind: "info",
      okLabel: t("workspace.addWorkspaceOpenCurrent"),
      cancelLabel: t("workspace.addWorkspaceOpenNewWindow"),
    });
    return useCurrentWindow ? "current-window" : "new-window";
  }, [t]);

  const handleOpenNewWindow = useCallback(
    async (path?: string | null) => {
      const projectName = path?.trim()
        ? resolveWorkspaceDisplayName(path)
        : t("workspace.projectInfo");
      try {
        await runWithLoadingProgress(
          { showLoadingProgressDialog, hideLoadingProgressDialog },
          {
            title: t("workspace.loadingProgressOpenProjectTitle"),
            message: t("workspace.loadingProgressOpenProjectMessage", {
              project: projectName,
            }),
          },
          () => openNewWindow(path),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onDebug({
          id: `${Date.now()}-client-open-new-window-error`,
          timestamp: Date.now(),
          source: "error",
          label: "workspace/open-new-window error",
          payload: message,
        });
        alert(`${t("errors.failedToOpenNewWindow")}\n\n${localizeErrorMessage(message)}`);
      }
    },
    [
      hideLoadingProgressDialog,
      localizeErrorMessage,
      onDebug,
      resolveWorkspaceDisplayName,
      showLoadingProgressDialog,
      t,
    ],
  );

  const handleAddWorkspaceFromPath = useCallback(
    async (path: string) => {
      try {
        await runWithLoadingProgress(
          { showLoadingProgressDialog, hideLoadingProgressDialog },
          {
            title: t("workspace.loadingProgressAddProjectTitle"),
            message: t("workspace.loadingProgressAddProjectMessage", {
              project: resolveWorkspaceDisplayName(path),
            }),
          },
          async () => {
            const workspace = await addWorkspaceFromPath(path);
            if (workspace) {
              handleWorkspaceAdded(workspace);
            }
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onDebug({
          id: `${Date.now()}-client-add-workspace-error`,
          timestamp: Date.now(),
          source: "error",
          label: "workspace/add error",
          payload: message,
        });
        alert(`${t("errors.failedToAddWorkspace")}\n\n${localizeErrorMessage(message)}`);
      }
    },
    [
      addWorkspaceFromPath,
      handleWorkspaceAdded,
      hideLoadingProgressDialog,
      localizeErrorMessage,
      onDebug,
      resolveWorkspaceDisplayName,
      showLoadingProgressDialog,
      t,
    ],
  );

  const handleAddWorkspace = useCallback(async () => {
    try {
      const path = await pickWorkspacePath();
      if (!path) {
        return;
      }
      const mode = await resolveWorkspaceOpenMode();
      if (mode === "new-window") {
        await handleOpenNewWindow(path);
        return;
      }
      await handleAddWorkspaceFromPath(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onDebug({
        id: `${Date.now()}-client-add-workspace-error`,
        timestamp: Date.now(),
        source: "error",
        label: "workspace/add error",
        payload: message,
      });
      alert(`${t("errors.failedToAddWorkspace")}\n\n${localizeErrorMessage(message)}`);
    }
  }, [
    handleAddWorkspaceFromPath,
    handleOpenNewWindow,
    localizeErrorMessage,
    onDebug,
    resolveWorkspaceOpenMode,
    t,
  ]);

  const handleAddAgent = useCallback(
    async (workspace: WorkspaceInfo, engine?: EngineType) => {
      const targetEngine = engine ?? activeEngine;
      try {
        await runCreateSessionFlow(workspace, targetEngine);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isStoppingRuntimeCreateSessionError(message)) {
          onDebug({
            id: `${Date.now()}-client-create-session-recovery-toast`,
            timestamp: Date.now(),
            source: "client",
            label: "workspace/create-session recovery toast",
            payload: {
              workspaceId: workspace.id,
              engine: targetEngine,
              error: message,
            },
          });
          showRecoverableCreateSessionToast(workspace, targetEngine, message);
          return;
        }
        const detail = resolveSessionCreationErrorDetail(message);
        onDebug({
          id: `${Date.now()}-client-create-session-error`,
          timestamp: Date.now(),
          source: "error",
          label: "workspace/create-session error",
          payload: {
            workspaceId: workspace.id,
            engine: targetEngine,
            error: message,
          },
        });
        alert(`${t("errors.failedToCreateSession")}\n\n${detail}`);
      }
    },
    [
      activeEngine,
      onDebug,
      resolveSessionCreationErrorDetail,
      runCreateSessionFlow,
      showRecoverableCreateSessionToast,
      t,
    ],
  );

  const handleAddWorktreeAgent = useCallback(
    async (workspace: WorkspaceInfo) => {
      exitDiffView();
      openWorktreePrompt(workspace);
    },
    [exitDiffView, openWorktreePrompt],
  );

  const handleAddCloneAgent = useCallback(
    async (workspace: WorkspaceInfo) => {
      exitDiffView();
      openClonePrompt(workspace);
    },
    [exitDiffView, openClonePrompt],
  );

  useNewAgentShortcut({
    isEnabled: Boolean(activeWorkspace),
    shortcut: newAgentShortcut,
    onTrigger: () => {
      if (activeWorkspace) {
        void handleAddAgent(activeWorkspace);
      }
    },
  });

  return {
    handleAddWorkspace,
    handleOpenNewWindow,
    handleAddWorkspaceFromPath,
    handleAddAgent,
    handleAddWorktreeAgent,
    handleAddCloneAgent,
  };
}
