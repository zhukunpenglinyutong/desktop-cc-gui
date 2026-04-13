import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EngineType,
  MessageSendOptions,
  QueuedMessage,
  WorkspaceInfo,
} from "../../../types";

const OPENCODE_INFLIGHT_STALL_MS = 18_000;
const FUSION_AWAIT_START_GRACE_MS = 1_200;

type UseQueuedSendOptions = {
  activeThreadId: string | null;
  activeTurnId?: string | null;
  isProcessing: boolean;
  isReviewing: boolean;
  steerEnabled: boolean;
  activeWorkspace: WorkspaceInfo | null;
  activeEngine?: EngineType;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: { activate?: boolean; engine?: EngineType },
  ) => Promise<string | null>;
  sendUserMessage: (
    text: string,
    images?: string[],
    options?: MessageSendOptions,
  ) => Promise<void>;
  sendUserMessageToThread: (
    workspace: WorkspaceInfo,
    threadId: string,
    text: string,
    images?: string[],
    options?: MessageSendOptions,
  ) => Promise<void>;
  startFork: (text: string) => Promise<void>;
  startReview: (text: string) => Promise<void>;
  startResume: (text: string) => Promise<void>;
  startMcp: (text: string) => Promise<void>;
  startSpecRoot: (text: string) => Promise<void>;
  startStatus: (text: string) => Promise<void>;
  startContext: (text: string) => Promise<void>;
  startExport: (text: string) => Promise<void>;
  startImport: (text: string) => Promise<void>;
  startLsp: (text: string) => Promise<void>;
  startShare: (text: string) => Promise<void>;
  startFast: (text: string) => Promise<void>;
  startMode: (text: string) => Promise<void>;
  setCodexCollaborationMode?: (mode: "plan" | "code") => void;
  getCodexCollaborationMode?: () => "plan" | "code" | null;
  getCodexCollaborationPayload?: () => Record<string, unknown> | null;
  interruptTurn?: (options?: {
    reason?: "user-stop" | "queue-fusion";
  }) => Promise<void>;
  clearActiveImages: () => void;
};

type UseQueuedSendResult = {
  queuedByThread: Record<string, QueuedMessage[]>;
  activeQueue: QueuedMessage[];
  handleSend: (
    text: string,
    images?: string[],
    options?: MessageSendOptions,
  ) => Promise<void>;
  queueMessage: (
    text: string,
    images?: string[],
    options?: MessageSendOptions,
  ) => Promise<void>;
  removeQueuedMessage: (threadId: string, messageId: string) => void;
  fuseQueuedMessage: (threadId: string, messageId: string) => Promise<void>;
  canFuseActiveQueue: boolean;
  activeFusingMessageId: string | null;
};

type ThreadFusionState = {
  messageId: string;
  turnIdBeforeFusion: string | null;
  mode: "same-run" | "cutover";
  awaitingIdleBeforeStart: boolean;
  stage: "dispatching" | "awaiting-cutover";
};

type SlashCommandKind =
  | "fork"
  | "fast"
  | "clear"
  | "mcp"
  | "new"
  | "resume"
  | "specRoot"
  | "review"
  | "status"
  | "context"
  | "export"
  | "import"
  | "lsp"
  | "share"
  | "plan"
  | "defaultMode"
  | "code"
  | "mode";

const MODE_QUERY_DENYLIST =
  /(区别|差别|不同|怎么|如何|为什么|为何|影响|不影响|约束|规则|行为|能力|planfirst|agents\.?md)/i;

function readSlashCommandToken(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const withoutSlash = trimmed.slice(1);
  if (!withoutSlash) {
    return null;
  }
  const firstToken = withoutSlash.split(/\s+/, 1)[0]?.trim();
  if (!firstToken) {
    return null;
  }
  return firstToken.toLowerCase();
}

function isImplicitModeQuery(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 64) {
    return false;
  }
  if (MODE_QUERY_DENYLIST.test(trimmed)) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (
    /^(?:mode|current\s+mode|what(?:'s| is)\s+(?:the\s+)?(?:current\s+)?mode|am i in (?:plan|default) mode)\s*[?]?$/i
      .test(normalized)
  ) {
    return true;
  }
  if (/^(现在呢|当前呢|此时呢)\s*[？?]?$/u.test(trimmed)) {
    return true;
  }
  return /^(现在|当前|此时).{0,24}(模式|计划模式|default|默认).{0,24}(吗|呢)?\s*[？?]?$/u
    .test(trimmed);
}

function parseSlashCommand(text: string): SlashCommandKind | null {
  const commandToken = readSlashCommandToken(text);
  if (commandToken === "fork") {
    return "fork";
  }
  if (commandToken === "fast") {
    return "fast";
  }
  if (commandToken === "clear" || commandToken === "reset") {
    return "clear";
  }
  if (commandToken === "mcp") {
    return "mcp";
  }
  if (commandToken === "review") {
    return "review";
  }
  if (commandToken === "new") {
    return "new";
  }
  if (commandToken === "resume") {
    return "resume";
  }
  if (commandToken === "spec-root") {
    return "specRoot";
  }
  if (commandToken === "status") {
    return "status";
  }
  if (commandToken === "context") {
    return "context";
  }
  if (commandToken === "export") {
    return "export";
  }
  if (commandToken === "import") {
    return "import";
  }
  if (commandToken === "lsp") {
    return "lsp";
  }
  if (commandToken === "share") {
    return "share";
  }
  if (commandToken === "plan") {
    return "plan";
  }
  if (commandToken === "default") {
    return "defaultMode";
  }
  if (commandToken === "code") {
    return "code";
  }
  if (commandToken === "mode") {
    return "mode";
  }
  return null;
}

function isQueuedMessageFuseEligible(item: QueuedMessage): boolean {
  return readSlashCommandToken(item.text) === null;
}

function isCodexOnlyCommand(command: SlashCommandKind): boolean {
  return (
    command === "fast" ||
    command === "plan" ||
    command === "defaultMode" ||
    command === "code" ||
    command === "mode"
  );
}

function canExecuteSlashCommand(
  command: SlashCommandKind | null,
  activeEngine: EngineType,
): command is SlashCommandKind {
  if (!command) {
    return false;
  }
  if (command === "clear" && activeEngine !== "claude") {
    return false;
  }
  if (isCodexOnlyCommand(command) && activeEngine !== "codex") {
    return false;
  }
  return true;
}

export function useQueuedSend({
  activeThreadId,
  activeTurnId,
  isProcessing,
  isReviewing,
  steerEnabled,
  activeWorkspace,
  activeEngine = "claude",
  connectWorkspace,
  startThreadForWorkspace,
  sendUserMessage,
  sendUserMessageToThread,
  startFork,
  startReview,
  startResume,
  startMcp,
  startSpecRoot,
  startStatus,
  startContext,
  startExport,
  startImport,
  startLsp,
  startShare,
  startFast,
  startMode,
  setCodexCollaborationMode,
  getCodexCollaborationMode,
  getCodexCollaborationPayload,
  interruptTurn,
  clearActiveImages,
}: UseQueuedSendOptions): UseQueuedSendResult {
  const isClaudePendingBootstrapThread =
    activeEngine === "claude" && Boolean(activeThreadId?.startsWith("claude-pending-"));
  const [queuedByThread, setQueuedByThread] = useState<
    Record<string, QueuedMessage[]>
  >({});
  const [inFlightByThread, setInFlightByThread] = useState<
    Record<string, QueuedMessage | null>
  >({});
  const [hasStartedByThread, setHasStartedByThread] = useState<
    Record<string, boolean>
  >({});
  const [fusionByThread, setFusionByThread] = useState<
    Record<string, ThreadFusionState | null>
  >({});
  const previousActiveThreadIdRef = useRef<string | null>(activeThreadId);

  const activeQueue = useMemo(
    () => (activeThreadId ? queuedByThread[activeThreadId] ?? [] : []),
    [activeThreadId, queuedByThread],
  );
  const activeFusion = useMemo(
    () => (activeThreadId ? fusionByThread[activeThreadId] ?? null : null),
    [activeThreadId, fusionByThread],
  );
  const activeFusingMessageId = activeFusion?.messageId ?? null;
  const canFuseActiveQueue = useMemo(
    () =>
      Boolean(
        activeThreadId &&
          activeWorkspace &&
          activeQueue.length > 0 &&
          !activeFusion &&
          !isClaudePendingBootstrapThread &&
          isProcessing &&
          !isReviewing &&
          (steerEnabled || interruptTurn),
      ),
    [
      activeFusion,
      activeQueue.length,
      activeThreadId,
      activeWorkspace,
      isClaudePendingBootstrapThread,
      interruptTurn,
      isProcessing,
      isReviewing,
      steerEnabled,
    ],
  );

  useEffect(() => {
    if (previousActiveThreadIdRef.current === activeThreadId) {
      return;
    }
    const oldThreadId = previousActiveThreadIdRef.current;
    const newThreadId = activeThreadId;
    previousActiveThreadIdRef.current = newThreadId;
    if (!oldThreadId || !newThreadId) {
      return;
    }
    const isClaudeSessionTransition =
      oldThreadId.startsWith("claude-pending-") && newThreadId.startsWith("claude:");
    if (!isClaudeSessionTransition) {
      return;
    }

    setQueuedByThread((prev) => {
      const pendingQueue = prev[oldThreadId] ?? [];
      if (pendingQueue.length < 1) {
        return prev;
      }
      const nextQueue = prev[newThreadId] ?? [];
      const next = {
        ...prev,
        [newThreadId]: [...pendingQueue, ...nextQueue],
      };
      delete next[oldThreadId];
      return next;
    });

    setInFlightByThread((prev) => {
      const pendingInFlight = prev[oldThreadId];
      if (pendingInFlight === undefined) {
        return prev;
      }
      const next = { ...prev };
      if (next[newThreadId] === undefined) {
        next[newThreadId] = pendingInFlight;
      }
      delete next[oldThreadId];
      return next;
    });

    setHasStartedByThread((prev) => {
      const pendingStarted = prev[oldThreadId];
      if (pendingStarted === undefined) {
        return prev;
      }
      const next = { ...prev };
      if (next[newThreadId] === undefined) {
        next[newThreadId] = pendingStarted;
      }
      delete next[oldThreadId];
      return next;
    });

    setFusionByThread((prev) => {
      const pendingFusion = prev[oldThreadId];
      if (pendingFusion === undefined) {
        return prev;
      }
      const next = { ...prev };
      if (next[newThreadId] === undefined) {
        next[newThreadId] = pendingFusion;
      }
      delete next[oldThreadId];
      return next;
    });
  }, [activeThreadId]);

  const buildQueuedMessage = useCallback(
    (
      text: string,
      images: string[] = [],
      options?: MessageSendOptions,
    ): QueuedMessage => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      createdAt: Date.now(),
      images,
      sendOptions: options,
    }),
    [],
  );

  const enqueueMessage = useCallback((threadId: string, item: QueuedMessage) => {
    setQueuedByThread((prev) => ({
      ...prev,
      [threadId]: [...(prev[threadId] ?? []), item],
    }));
  }, []);

  const removeQueuedMessage = useCallback(
    (threadId: string, messageId: string) => {
      setQueuedByThread((prev) => ({
        ...prev,
        [threadId]: (prev[threadId] ?? []).filter(
          (entry) => entry.id !== messageId,
        ),
      }));
    },
    [],
  );

  const insertQueuedMessageAt = useCallback(
    (threadId: string, item: QueuedMessage, index: number) => {
      setQueuedByThread((prev) => {
        const threadQueue = [...(prev[threadId] ?? [])];
        const boundedIndex = Math.max(0, Math.min(index, threadQueue.length));
        threadQueue.splice(boundedIndex, 0, item);
        return {
          ...prev,
          [threadId]: threadQueue,
        };
      });
    },
    [],
  );

  const prependQueuedMessage = useCallback(
    (threadId: string, item: QueuedMessage) => {
      insertQueuedMessageAt(threadId, item, 0);
    },
    [insertQueuedMessageAt],
  );

  const withCodexCollaborationMode = useCallback(
    (options?: MessageSendOptions): MessageSendOptions | undefined => {
      if (activeEngine !== "codex") {
        return options;
      }
      const existingPayload = options?.collaborationMode;
      const existingModeRaw =
        existingPayload &&
          typeof existingPayload === "object" &&
          !Array.isArray(existingPayload)
          ? (existingPayload as Record<string, unknown>).mode
          : null;
      const existingMode = typeof existingModeRaw === "string"
        ? existingModeRaw.trim().toLowerCase()
        : null;
      if (existingMode === "plan" || existingMode === "code" || existingMode === "default") {
        return options;
      }
      const currentPayload = getCodexCollaborationPayload?.();
      if (
        currentPayload &&
        typeof currentPayload === "object" &&
        !Array.isArray(currentPayload)
      ) {
        return {
          ...(options ?? {}),
          collaborationMode: { ...currentPayload },
        };
      }
      const currentMode = getCodexCollaborationMode?.();
      if (currentMode !== "plan" && currentMode !== "code") {
        return options;
      }
      return {
        ...(options ?? {}),
        collaborationMode: {
          mode: currentMode,
          settings: {},
        },
      };
    },
    [
      activeEngine,
      getCodexCollaborationMode,
      getCodexCollaborationPayload,
    ],
  );

  const runSlashCommand = useCallback(
    async (
      command: SlashCommandKind,
      trimmed: string,
      options?: MessageSendOptions,
    ): Promise<boolean> => {
      if (
        (command === "plan" || command === "defaultMode" || command === "code") &&
        activeEngine === "codex" &&
        setCodexCollaborationMode
      ) {
        const targetMode = command === "plan" ? "plan" : "code";
        setCodexCollaborationMode(targetMode);
        const rest = trimmed
          .replace(/^\/(?:plan|default|code)\b/i, "")
          .trim();
        if (rest) {
          const modeOverrideOptions: MessageSendOptions = {
            ...(options ?? {}),
            collaborationMode: {
              mode: targetMode,
              settings: {},
            },
          };
          if (options) {
            await sendUserMessage(rest, [], modeOverrideOptions);
          } else {
            await sendUserMessage(rest, [], modeOverrideOptions);
          }
        }
        return true;
      }
      if (command === "mode" && activeEngine === "codex") {
        await startMode(trimmed);
        return true;
      }
      if (command === "fast" && activeEngine === "codex") {
        await startFast(trimmed);
        return true;
      }
      if (command === "fork") {
        await startFork(trimmed);
        return true;
      }
      if (command === "review") {
        await startReview(trimmed);
        return true;
      }
      if (command === "resume") {
        await startResume(trimmed);
        return true;
      }
      if (command === "mcp") {
        await startMcp(trimmed);
        return true;
      }
      if (command === "specRoot") {
        await startSpecRoot(trimmed);
        return true;
      }
      if (command === "status") {
        await startStatus(trimmed);
        return true;
      }
      if (command === "context") {
        await startContext(trimmed);
        return true;
      }
      if (command === "export") {
        await startExport(trimmed);
        return true;
      }
      if (command === "import") {
        await startImport(trimmed);
        return true;
      }
      if (command === "lsp") {
        await startLsp(trimmed);
        return true;
      }
      if (command === "share") {
        await startShare(trimmed);
        return true;
      }
      if (command === "clear" && activeWorkspace) {
        const threadId = await startThreadForWorkspace(activeWorkspace.id, { engine: activeEngine });
        const rest = trimmed.replace(/^\/(?:clear|reset)\b/i, "").trim();
        const effectiveOptions = withCodexCollaborationMode(options);
        if (threadId && rest) {
          if (effectiveOptions) {
            await sendUserMessageToThread(activeWorkspace, threadId, rest, [], effectiveOptions);
          } else {
            await sendUserMessageToThread(activeWorkspace, threadId, rest, []);
          }
        }
        return true;
      }
      if (command === "new" && activeWorkspace) {
        const threadId = await startThreadForWorkspace(activeWorkspace.id, { engine: activeEngine });
        const rest = trimmed.replace(/^\/new\b/i, "").trim();
        const effectiveOptions = withCodexCollaborationMode(options);
        if (threadId && rest) {
          if (effectiveOptions) {
            await sendUserMessageToThread(activeWorkspace, threadId, rest, [], effectiveOptions);
          } else {
            await sendUserMessageToThread(activeWorkspace, threadId, rest, []);
          }
        }
        return true;
      }
      return false;
    },
    [
      activeWorkspace,
      activeEngine,
      setCodexCollaborationMode,
      sendUserMessage,
      sendUserMessageToThread,
      startFork,
      startReview,
      startResume,
      startMcp,
      startSpecRoot,
      startStatus,
      startContext,
      startExport,
      startImport,
      startLsp,
      startShare,
      startFast,
      startMode,
      startThreadForWorkspace,
      withCodexCollaborationMode,
    ],
  );

  const dispatchQueuedMessage = useCallback(
    async (item: QueuedMessage): Promise<boolean> => {
      const trimmed = item.text.trim();
      const command = parseSlashCommand(trimmed);
      const commandEnabled = canExecuteSlashCommand(command, activeEngine);
      if (activeWorkspace && !activeWorkspace.connected) {
        await connectWorkspace(activeWorkspace);
      }
      if (commandEnabled && command) {
        const handled = await runSlashCommand(command, trimmed, item.sendOptions);
        if (handled) {
          return command === "review";
        }
      }
      const implicitModeQuery =
        activeEngine === "codex" &&
        !command &&
        (item.images?.length ?? 0) === 0 &&
        isImplicitModeQuery(trimmed);
      if (implicitModeQuery) {
        await startMode(trimmed);
        return false;
      }
      const effectiveOptions = withCodexCollaborationMode(item.sendOptions);
      if (effectiveOptions) {
        await sendUserMessage(trimmed, item.images ?? [], effectiveOptions);
      } else {
        await sendUserMessage(trimmed, item.images ?? []);
      }
      return true;
    },
    [
      activeEngine,
      activeWorkspace,
      connectWorkspace,
      runSlashCommand,
      sendUserMessage,
      startMode,
      withCodexCollaborationMode,
    ],
  );

  const handleSend = useCallback(
    async (
      text: string,
      images: string[] = [],
      options?: MessageSendOptions,
    ) => {
      const trimmed = text.trim();
      const command = parseSlashCommand(trimmed);
      const commandEnabled = canExecuteSlashCommand(command, activeEngine);
      const nextImages = commandEnabled ? [] : images;
      if (!trimmed && nextImages.length === 0) {
        return;
      }
      if (activeThreadId && isReviewing) {
        return;
      }
      const shouldQueueWhileProcessing =
        isProcessing &&
        activeThreadId &&
        (!steerEnabled || isClaudePendingBootstrapThread);
      if (shouldQueueWhileProcessing) {
        const item = buildQueuedMessage(trimmed, nextImages, options);
        enqueueMessage(activeThreadId, item);
        clearActiveImages();
        return;
      }
      await dispatchQueuedMessage(buildQueuedMessage(trimmed, nextImages, options));
      clearActiveImages();
    },
    [
      activeEngine,
      activeThreadId,
      buildQueuedMessage,
      clearActiveImages,
      dispatchQueuedMessage,
      enqueueMessage,
      isClaudePendingBootstrapThread,
      isProcessing,
      isReviewing,
      steerEnabled,
    ],
  );

  const queueMessage = useCallback(
    async (
      text: string,
      images: string[] = [],
      options?: MessageSendOptions,
    ) => {
      const trimmed = text.trim();
      const command = parseSlashCommand(trimmed);
      const commandEnabled = canExecuteSlashCommand(command, activeEngine);
      const nextImages = commandEnabled ? [] : images;
      if (!trimmed && nextImages.length === 0) {
        return;
      }
      if (activeThreadId && isReviewing) {
        return;
      }
      if (!activeThreadId) {
        return;
      }
      const item = buildQueuedMessage(trimmed, nextImages, options);
      enqueueMessage(activeThreadId, item);
      clearActiveImages();
    },
    [
      activeEngine,
      activeThreadId,
      buildQueuedMessage,
      clearActiveImages,
      enqueueMessage,
      isReviewing,
    ],
  );

  const fuseQueuedMessage = useCallback(
    async (threadId: string, messageId: string) => {
      if (!activeThreadId || threadId !== activeThreadId) {
        return;
      }
      if (isClaudePendingBootstrapThread) {
        return;
      }
      if (!activeWorkspace || !isProcessing || isReviewing) {
        return;
      }
      if (fusionByThread[threadId]) {
        return;
      }
      const threadQueue = queuedByThread[threadId] ?? [];
      const originalIndex = threadQueue.findIndex((entry) => entry.id === messageId);
      if (originalIndex < 0) {
        return;
      }
      const item = threadQueue[originalIndex];
      if (!item) {
        return;
      }
      if (!isQueuedMessageFuseEligible(item)) {
        return;
      }

      const useSameRunContinuation = steerEnabled;
      const canUseSafeCutover =
        !useSameRunContinuation && typeof interruptTurn === "function";
      if (!useSameRunContinuation && !canUseSafeCutover) {
        return;
      }

      setFusionByThread((prev) => ({
        ...prev,
        [threadId]: {
          messageId,
          turnIdBeforeFusion: activeTurnId ?? null,
          mode: useSameRunContinuation ? "same-run" : "cutover",
          awaitingIdleBeforeStart: !useSameRunContinuation,
          stage: "dispatching",
        },
      }));
      setQueuedByThread((prev) => ({
        ...prev,
        [threadId]: (prev[threadId] ?? []).filter(
          (entry) => entry.id !== messageId,
        ),
      }));

      try {
        if (!useSameRunContinuation && interruptTurn) {
          await interruptTurn({ reason: "queue-fusion" });
        }
        const dispatchedRun = await dispatchQueuedMessage(item);
        if (!dispatchedRun) {
          setFusionByThread((prev) => ({ ...prev, [threadId]: null }));
          return;
        }
        if (useSameRunContinuation) {
          setFusionByThread((prev) => {
            const current = prev[threadId];
            if (!current || current.messageId !== messageId) {
              return prev;
            }
            return {
              ...prev,
              [threadId]: null,
            };
          });
          return;
        }
        setFusionByThread((prev) => {
          const current = prev[threadId];
          if (!current || current.messageId !== messageId) {
            return prev;
          }
          return {
            ...prev,
            [threadId]: {
              ...current,
              stage: "awaiting-cutover",
            },
          };
        });
      } catch (error) {
        setFusionByThread((prev) => ({ ...prev, [threadId]: null }));
        insertQueuedMessageAt(threadId, item, originalIndex);
        throw error;
      }
    },
    [
      activeThreadId,
      activeTurnId,
      activeWorkspace,
      dispatchQueuedMessage,
      fusionByThread,
      isClaudePendingBootstrapThread,
      insertQueuedMessageAt,
      interruptTurn,
      isProcessing,
      isReviewing,
      queuedByThread,
      steerEnabled,
    ],
  );

  useEffect(() => {
    if (activeTurnId === undefined || !activeThreadId) {
      return;
    }
    const fusion = fusionByThread[activeThreadId];
    if (
      !fusion ||
      fusion.mode !== "cutover" ||
      fusion.stage !== "awaiting-cutover"
    ) {
      return;
    }
    if (!activeTurnId || activeTurnId === fusion.turnIdBeforeFusion) {
      return;
    }
    setFusionByThread((prev) => {
      const current = prev[activeThreadId];
      if (
        !current ||
        current.mode !== "cutover" ||
        current.stage !== "awaiting-cutover"
      ) {
        return prev;
      }
      if (!activeTurnId || activeTurnId === current.turnIdBeforeFusion) {
        return prev;
      }
      return {
        ...prev,
        [activeThreadId]: null,
      };
    });
  }, [activeThreadId, activeTurnId, fusionByThread]);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }
    const inFlight = inFlightByThread[activeThreadId];
    if (!inFlight) {
      return;
    }
    if (isProcessing || isReviewing) {
      if (!hasStartedByThread[activeThreadId]) {
        setHasStartedByThread((prev) => ({
          ...prev,
          [activeThreadId]: true,
        }));
      }
      return;
    }
    if (hasStartedByThread[activeThreadId]) {
      setInFlightByThread((prev) => ({ ...prev, [activeThreadId]: null }));
      setHasStartedByThread((prev) => ({ ...prev, [activeThreadId]: false }));
    }
  }, [
    activeThreadId,
    hasStartedByThread,
    inFlightByThread,
    isProcessing,
    isReviewing,
  ]);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }
    const fusion = fusionByThread[activeThreadId];
    if (
      !fusion ||
      fusion.mode !== "cutover" ||
      fusion.stage !== "awaiting-cutover"
    ) {
      return;
    }
    if (isProcessing || isReviewing) {
      if (fusion.awaitingIdleBeforeStart) {
        return;
      }
      setFusionByThread((prev) => {
        const current = prev[activeThreadId];
        if (
          !current ||
          current.mode !== "cutover" ||
          current.stage !== "awaiting-cutover" ||
          current.awaitingIdleBeforeStart
        ) {
          return prev;
        }
        return {
          ...prev,
          [activeThreadId]: null,
        };
      });
      return;
    }
    if (fusion.awaitingIdleBeforeStart) {
      setFusionByThread((prev) => {
        const current = prev[activeThreadId];
        if (
          !current ||
          current.mode !== "cutover" ||
          current.stage !== "awaiting-cutover" ||
          !current.awaitingIdleBeforeStart
        ) {
          return prev;
        }
        return {
          ...prev,
          [activeThreadId]: {
            ...current,
            awaitingIdleBeforeStart: false,
          },
        };
      });
      return;
    }
  }, [activeThreadId, fusionByThread, isProcessing, isReviewing]);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }
    const fusion = fusionByThread[activeThreadId];
    if (
      !fusion ||
      fusion.mode !== "cutover" ||
      fusion.stage !== "awaiting-cutover"
    ) {
      return;
    }
    if (fusion.awaitingIdleBeforeStart) {
      return;
    }
    if (isProcessing || isReviewing) {
      return;
    }
    const timer = window.setTimeout(() => {
      setFusionByThread((prev) => {
        const current = prev[activeThreadId];
        if (
          !current ||
          current.mode !== "cutover" ||
          current.stage !== "awaiting-cutover" ||
          current.awaitingIdleBeforeStart
        ) {
          return prev;
        }
        return {
          ...prev,
          [activeThreadId]: null,
        };
      });
    }, FUSION_AWAIT_START_GRACE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeThreadId, fusionByThread, isProcessing, isReviewing]);

  useEffect(() => {
    if (activeEngine !== "opencode") {
      return;
    }
    if (!activeThreadId || isProcessing || isReviewing) {
      return;
    }
    const inFlight = inFlightByThread[activeThreadId];
    if (!inFlight) {
      return;
    }
    if (hasStartedByThread[activeThreadId]) {
      return;
    }
    const timer = window.setTimeout(() => {
      setInFlightByThread((prev) => {
        const current = prev[activeThreadId];
        if (!current || current.id !== inFlight.id) {
          return prev;
        }
        return { ...prev, [activeThreadId]: null };
      });
      setHasStartedByThread((prev) => ({ ...prev, [activeThreadId]: false }));
      prependQueuedMessage(activeThreadId, inFlight);
    }, OPENCODE_INFLIGHT_STALL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    activeEngine,
    activeThreadId,
    hasStartedByThread,
    inFlightByThread,
    isProcessing,
    isReviewing,
    prependQueuedMessage,
  ]);

  useEffect(() => {
    if (!activeThreadId || isProcessing || isReviewing) {
      return;
    }
    if (fusionByThread[activeThreadId]) {
      return;
    }
    if (inFlightByThread[activeThreadId]) {
      return;
    }
    const queue = queuedByThread[activeThreadId] ?? [];
    if (queue.length === 0) {
      return;
    }
    const threadId = activeThreadId;
    const nextItem = queue[0];
    if (!nextItem) {
      return;
    }
    setInFlightByThread((prev) => ({ ...prev, [threadId]: nextItem }));
    setHasStartedByThread((prev) => ({ ...prev, [threadId]: false }));
    setQueuedByThread((prev) => ({
      ...prev,
      [threadId]: (prev[threadId] ?? []).slice(1),
    }));
    (async () => {
      try {
        const dispatchedRun = await dispatchQueuedMessage(nextItem);
        if (!dispatchedRun) {
          setInFlightByThread((prev) => ({ ...prev, [threadId]: null }));
          setHasStartedByThread((prev) => ({ ...prev, [threadId]: false }));
        }
      } catch {
        setInFlightByThread((prev) => ({ ...prev, [threadId]: null }));
        setHasStartedByThread((prev) => ({ ...prev, [threadId]: false }));
        prependQueuedMessage(threadId, nextItem);
      }
    })();
  }, [
    activeThreadId,
    dispatchQueuedMessage,
    fusionByThread,
    inFlightByThread,
    isProcessing,
    isReviewing,
    prependQueuedMessage,
    queuedByThread,
  ]);

  return {
    queuedByThread,
    activeQueue,
    handleSend,
    queueMessage,
    removeQueuedMessage,
    fuseQueuedMessage,
    canFuseActiveQueue,
    activeFusingMessageId,
  };
}
