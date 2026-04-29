import { useCallback } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type {
  AccessMode,
  RateLimitSnapshot,
  ThreadTokenUsage,
  WorkspaceInfo,
} from "../../../types";
import {
  compactThreadContext as compactThreadContextService,
  listMcpServerStatus as listMcpServerStatusService,
  getOpenCodeLspDiagnostics as getOpenCodeLspDiagnosticsService,
  getOpenCodeLspDocumentSymbols as getOpenCodeLspDocumentSymbolsService,
  getOpenCodeLspSymbols as getOpenCodeLspSymbolsService,
  getOpenCodeMcpStatus as getOpenCodeMcpStatusService,
  getOpenCodeStats as getOpenCodeStatsService,
  importOpenCodeSession as importOpenCodeSessionService,
  exportOpenCodeSession as exportOpenCodeSessionService,
  shareOpenCodeSession as shareOpenCodeSessionService,
} from "../../../services/tauri";
import { writeClientStoreValue } from "../../../services/clientStorage";
import { formatRelativeTime } from "../../../utils/time";
import { pushErrorToast } from "../../../services/toasts";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";
import { asString } from "../utils/threadNormalize";
import {
  buildDefaultSpecRootPath,
  isAbsoluteHostPath,
  normalizeExtendedWindowsPath,
  probeSessionSpecLink,
  resolveWorkspaceSpecRoot,
  toFileUriFromAbsolutePath,
  type SessionSpecLinkContext,
} from "./threadMessagingSpecRoot";
import { resolveCollaborationModeIdFromPayload } from "./threadMessagingHelpers";

type ToolingSendMessageOptions = {
  skipPromptExpansion?: boolean;
};

type UseThreadMessagingSessionToolingOptions = {
  activeThreadId: string | null;
  activeWorkspace: WorkspaceInfo | null;
  accessMode?: AccessMode;
  collaborationMode?: Record<string, unknown> | null;
  effort?: string | null;
  model?: string | null;
  tokenUsageByThread: Record<string, ThreadTokenUsage>;
  rateLimitsByWorkspace: Record<string, RateLimitSnapshot | null>;
  threadStatusById: ThreadState["threadStatusById"];
  codexCompactionInFlightByThreadRef: MutableRefObject<Record<string, boolean>>;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  ensureThreadForActiveWorkspace: () => Promise<string | null>;
  forkThreadForWorkspace: (
    workspaceId: string,
    threadId: string,
    options?: { activate?: boolean },
  ) => Promise<string | null>;
  updateThreadParent: (parentId: string, childIds: string[]) => void;
  pushThreadErrorMessage: (threadId: string, message: string) => void;
  recordThreadActivity: (
    workspaceId: string,
    threadId: string,
    timestamp?: number,
  ) => void;
  refreshThread: (workspaceId: string, threadId: string) => Promise<string | null>;
  resolveCollaborationRuntimeMode?: (threadId: string) => "plan" | "code" | null;
  resolveThreadEngine: (
    workspaceId: string,
    threadId: string,
  ) => "claude" | "codex" | "gemini" | "opencode";
  isThreadIdCompatibleWithEngine: (
    engine: "claude" | "codex" | "gemini" | "opencode",
    threadId: string,
  ) => boolean;
  safeMessageActivity: () => void;
  sendMessageToThread: (
    workspace: WorkspaceInfo,
    threadId: string,
    text: string,
    images?: string[],
    options?: ToolingSendMessageOptions,
  ) => Promise<void>;
  sessionSpecLinkByThreadRef: MutableRefObject<Map<string, SessionSpecLinkContext>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  onDebug?: (entry: {
    id: string;
    timestamp: number;
    source: "client" | "server" | "error";
    label: string;
    payload: unknown;
  }) => void;
};

export function useThreadMessagingSessionTooling({
  activeThreadId,
  activeWorkspace,
  accessMode,
  collaborationMode,
  dispatch,
  effort,
  ensureThreadForActiveWorkspace,
  forkThreadForWorkspace,
  getCustomName,
  isThreadIdCompatibleWithEngine,
  model,
  onDebug,
  pushThreadErrorMessage,
  rateLimitsByWorkspace,
  recordThreadActivity,
  refreshThread,
  resolveCollaborationRuntimeMode,
  resolveThreadEngine,
  safeMessageActivity,
  sendMessageToThread,
  sessionSpecLinkByThreadRef,
  t,
  threadStatusById,
  codexCompactionInFlightByThreadRef,
  tokenUsageByThread,
  updateThreadParent,
}: UseThreadMessagingSessionToolingOptions) {
  const startContext = useCallback(
    async (_text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }

      const usage = tokenUsageByThread[threadId] ?? null;
      const formatTokenCount = (value: number) =>
        Math.max(0, Math.round(value)).toLocaleString("en-US");

      const noUsageLines = [
        "Context Usage",
        "",
        "No context usage telemetry yet for this thread.",
        "Send at least one turn, then run /context again.",
      ];

      if (!usage) {
        const timestamp = Date.now();
        recordThreadActivity(activeWorkspace.id, threadId, timestamp);
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: ["```text", ...noUsageLines, "```"].join("\n"),
        });
        safeMessageActivity();
        return;
      }

      const inputTokens = usage.last.inputTokens ?? 0;
      const cachedInputTokens = usage.last.cachedInputTokens ?? 0;
      const outputTokens = usage.last.outputTokens ?? 0;
      const reasoningOutputTokens = usage.last.reasoningOutputTokens ?? 0;
      const usedTokens = inputTokens + cachedInputTokens;
      const contextWindow = usage.modelContextWindow ?? null;
      const usedPercent = contextWindow && contextWindow > 0
        ? Math.min(Math.max((usedTokens / contextWindow) * 100, 0), 100)
        : null;
      const remainingPercent =
        usedPercent === null ? null : Math.max(0, 100 - usedPercent);

      const lines = [
        "Context Usage",
        "",
        `Thread:             ${threadId}`,
        `Used:               ${formatTokenCount(usedTokens)} tokens`,
        contextWindow && contextWindow > 0
          ? `Context window:     ${formatTokenCount(contextWindow)} tokens`
          : "Context window:     n/a",
        usedPercent === null
          ? "Used percent:       n/a"
          : `Used percent:       ${usedPercent.toFixed(1)}%`,
        remainingPercent === null
          ? "Remaining:          n/a"
          : `Remaining:          ${remainingPercent.toFixed(1)}%`,
        "",
        "Last turn breakdown:",
        `- Input:            ${formatTokenCount(inputTokens)}`,
        `- Cached input:     ${formatTokenCount(cachedInputTokens)}`,
        `- Output:           ${formatTokenCount(outputTokens)}`,
        `- Reasoning output: ${formatTokenCount(reasoningOutputTokens)}`,
        "",
        "Session totals:",
        `- Total tokens:     ${formatTokenCount(usage.total.totalTokens ?? 0)}`,
        `- Input tokens:     ${formatTokenCount(usage.total.inputTokens ?? 0)}`,
        `- Cached input:     ${formatTokenCount(usage.total.cachedInputTokens ?? 0)}`,
        `- Output tokens:    ${formatTokenCount(usage.total.outputTokens ?? 0)}`,
      ];

      const timestamp = Date.now();
      recordThreadActivity(activeWorkspace.id, threadId, timestamp);
      dispatch({
        type: "addAssistantMessage",
        threadId,
        text: ["```text", ...lines, "```"].join("\n"),
      });
      safeMessageActivity();
    },
    [
      activeWorkspace,
      dispatch,
      ensureThreadForActiveWorkspace,
      recordThreadActivity,
      safeMessageActivity,
      tokenUsageByThread,
    ],
  );

  const startStatus = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }
      const resolvedThreadEngine = resolveThreadEngine(activeWorkspace.id, threadId);
      if (resolvedThreadEngine === "opencode") {
        try {
          const match = text.trim().match(/^\/status(?:\s+(\d+))?/i);
          const days = match?.[1] ? Number(match[1]) : null;
          const stats = await getOpenCodeStatsService(
            activeWorkspace.id,
            Number.isFinite(days as number) ? (days as number) : null,
          );
          const timestamp = Date.now();
          recordThreadActivity(activeWorkspace.id, threadId, timestamp);
          dispatch({
            type: "addAssistantMessage",
            threadId,
            text: `OpenCode stats:\n\n${stats}`,
          });
          safeMessageActivity();
        } catch (error) {
          pushThreadErrorMessage(
            threadId,
            error instanceof Error ? error.message : String(error),
          );
          safeMessageActivity();
        }
        return;
      }

      const rateLimits = rateLimitsByWorkspace[activeWorkspace.id] ?? null;
      const primaryUsed = rateLimits?.primary?.usedPercent;
      const secondaryUsed = rateLimits?.secondary?.usedPercent;
      const primaryReset = rateLimits?.primary?.resetsAt;
      const secondaryReset = rateLimits?.secondary?.resetsAt;
      const credits = rateLimits?.credits ?? null;

      const normalizeReset = (value?: number | null) => {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return null;
        }
        return value > 1_000_000_000_000 ? value : value * 1000;
      };

      const resetLabel = (value?: number | null) => {
        const resetAt = normalizeReset(value);
        return resetAt ? formatRelativeTime(resetAt) : null;
      };

      const collaborationModeId = resolveCollaborationModeIdFromPayload(
        collaborationMode,
      );

      const formatLimitLine = (
        label: string,
        usedPercent: number | null | undefined,
        resetAt: number | null | undefined,
      ): string[] => {
        if (typeof usedPercent !== "number" || Number.isNaN(usedPercent)) {
          return [`${label}: n/a`];
        }
        const clampedUsed = Math.max(0, Math.min(100, Math.round(usedPercent)));
        const remaining = Math.max(0, 100 - clampedUsed);
        const reset = resetLabel(resetAt);
        if (!reset) {
          return [`${label}: ${remaining}% left`];
        }
        return [`${label}: ${remaining}% left`, `  (resets ${reset})`];
      };

      const modelLabel = model ?? "gpt-5.3-codex";
      const effortLabel = effort ?? "medium";
      const permissionLabel =
        accessMode === "read-only"
          ? "Read Only"
          : accessMode === "full-access"
            ? "Full Access"
            : "Default";
      const collaborationLabel =
        collaborationModeId === "plan" ? "Plan Mode" : "Default";
      const sessionLabel = threadId.startsWith("opencode:")
        ? threadId.slice("opencode:".length)
        : threadId;

      const lines = [
        "OpenAI Codex",
        "",
        "Visit https://chatgpt.com/codex/settings/usage for up-to-date",
        "information on rate limits and credits",
        "",
        `Model:              ${modelLabel} (reasoning ${effortLabel})`,
        `Directory:          ${activeWorkspace.path || "~"}`,
        `Permissions:        ${permissionLabel}`,
        "Agents.md:          <none>",
        "Account:            <unknown>",
        `Collaboration mode: ${collaborationLabel}`,
        `Session:            ${sessionLabel}`,
        "",
        ...formatLimitLine("5h limit", primaryUsed, primaryReset),
        ...formatLimitLine("Weekly limit", secondaryUsed, secondaryReset),
      ];

      if (credits?.hasCredits) {
        if (credits.unlimited) {
          lines.push("Credits:            unlimited");
        } else if (credits.balance) {
          lines.push(`Credits:            ${credits.balance}`);
        }
      }

      const timestamp = Date.now();
      recordThreadActivity(activeWorkspace.id, threadId, timestamp);
      dispatch({
        type: "addAssistantMessage",
        threadId,
        text: ["```text", ...lines, "```"].join("\n"),
      });
      safeMessageActivity();
    },
    [
      accessMode,
      activeWorkspace,
      collaborationMode,
      dispatch,
      effort,
      ensureThreadForActiveWorkspace,
      model,
      pushThreadErrorMessage,
      rateLimitsByWorkspace,
      recordThreadActivity,
      resolveThreadEngine,
      safeMessageActivity,
    ],
  );

  const startMode = useCallback(
    async (_text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }
      const selectedMode = resolveCollaborationModeIdFromPayload(
        collaborationMode,
      );
      const uiMode: "plan" | "default" =
        selectedMode === "plan" ? "plan" : "default";
      const runtimeMode =
        resolveCollaborationRuntimeMode?.(threadId) ??
        (selectedMode === "plan" ? "plan" : "code");
      const normalizedRuntimeMode: "plan" | "code" =
        runtimeMode === "plan" ? "plan" : "code";
      const uiModeLabel = uiMode === "plan" ? "Plan Mode（计划模式）" : "Default（默认模式）";
      const timestamp = Date.now();
      recordThreadActivity(activeWorkspace.id, threadId, timestamp);
      dispatch({
        type: "addAssistantMessage",
        threadId,
        text: [
          "```text",
          `当前产品模式: ${uiModeLabel}`,
          `运行时模式: ${normalizedRuntimeMode}`,
          `线程: ${threadId}`,
          "",
          "说明:",
          "- 这里的模式仅表示 Codex 产品能力（Plan/Default）。",
          "- AGENTS.md / PlanFirst 规则仍会照常读取，不会被该开关切换或关闭。",
          "```",
        ].join("\n"),
      });
      safeMessageActivity();
    },
    [
      activeWorkspace,
      collaborationMode,
      dispatch,
      ensureThreadForActiveWorkspace,
      recordThreadActivity,
      resolveCollaborationRuntimeMode,
      safeMessageActivity,
    ],
  );

  const startFast = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }

      const match = text.trim().match(/^\/fast(?:\s+(on|off))?/i);
      const mode = match?.[1]?.toLowerCase();
      const normalizedCommand = mode === "on" || mode === "off" ? `/fast ${mode}` : "/fast";

      await sendMessageToThread(activeWorkspace, threadId, normalizedCommand, [], {
        skipPromptExpansion: true,
      });
    },
    [
      activeWorkspace,
      ensureThreadForActiveWorkspace,
      sendMessageToThread,
    ],
  );

  const startCompact = useCallback(
    async (_text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = activeThreadId;
      const claudeUnavailableMessage = t("threads.claudeManualCompactUnavailable");
      const codexUnavailableMessage = t("chat.contextDualViewManualCompactUnavailable");
      const isConcreteClaudeThread = typeof threadId === "string" && threadId.startsWith("claude:");
      if (!threadId) {
        pushErrorToast({
          title: t("common.warning"),
          message: claudeUnavailableMessage,
        });
        return;
      }

      const threadEngine = resolveThreadEngine(activeWorkspace.id, threadId);
      const isClaudeThread =
        threadEngine === "claude" &&
        isThreadIdCompatibleWithEngine("claude", threadId) &&
        isConcreteClaudeThread;
      const isCodexThread =
        threadEngine === "codex" &&
        isThreadIdCompatibleWithEngine("codex", threadId);
      if (!isClaudeThread && !isCodexThread) {
        onDebug?.({
          id: `${Date.now()}-client-compact-thread-unavailable`,
          timestamp: Date.now(),
          source: "client",
          label: "compact/thread unavailable",
          payload: {
            workspaceId: activeWorkspace.id,
            threadId,
            threadEngine,
            isClaudeThread,
            isCodexThread,
            isConcreteClaudeThread,
          },
        });
        pushErrorToast({
          title: t("common.warning"),
          message:
            threadEngine === "codex"
              ? codexUnavailableMessage
              : claudeUnavailableMessage,
        });
        return;
      }

      if (isCodexThread) {
        if (codexCompactionInFlightByThreadRef.current[threadId]) {
          onDebug?.({
            id: `${Date.now()}-client-compact-thread-in-flight`,
            timestamp: Date.now(),
            source: "client",
            label: "compact/thread in-flight",
            payload: {
              workspaceId: activeWorkspace.id,
              threadId,
            },
          });
          return;
        }
        const timestamp = Date.now();
        codexCompactionInFlightByThreadRef.current[threadId] = true;
        dispatch({
          type: "appendCodexCompactionMessage",
          threadId,
          text: t("threads.codexCompactionStarted"),
        });
        recordThreadActivity(activeWorkspace.id, threadId, timestamp);
        safeMessageActivity();
        try {
          await compactThreadContextService(activeWorkspace.id, threadId);
        } catch (error) {
          delete codexCompactionInFlightByThreadRef.current[threadId];
          dispatch({
            type: "discardLatestCodexCompactionMessage",
            threadId,
            text: t("threads.codexCompactionStarted"),
          });
          const reason = error instanceof Error ? error.message : String(error);
          const message = reason
            ? t("threads.contextCompactionFailedWithMessage", { message: reason })
            : t("threads.contextCompactionFailed");
          pushThreadErrorMessage(threadId, message);
          safeMessageActivity();
        }
        return;
      }

      dispatch({
        type: "markContextCompacting",
        threadId,
        isCompacting: true,
        timestamp: Date.now(),
      });
      safeMessageActivity();

      try {
        const response = await compactThreadContextService(activeWorkspace.id, threadId);
        const responseObject =
          response && typeof response === "object"
            ? (response as Record<string, unknown>)
            : null;
        const turnId = asString(
          responseObject?.turnId ??
            ((responseObject?.result as Record<string, unknown> | undefined)?.turnId ?? ""),
        ).trim();
        const completedAt = Date.now();
        dispatch({
          type: "markContextCompacting",
          threadId,
          isCompacting: false,
          timestamp: completedAt,
        });
        dispatch({
          type: "appendContextCompacted",
          threadId,
          turnId: turnId || `manual-${completedAt}`,
        });
        recordThreadActivity(activeWorkspace.id, threadId, completedAt);
        safeMessageActivity();
      } catch (error) {
        dispatch({
          type: "markContextCompacting",
          threadId,
          isCompacting: false,
          timestamp: Date.now(),
        });
        const reason = error instanceof Error ? error.message : String(error);
        const message = reason
          ? t("threads.contextCompactionFailedWithMessage", { message: reason })
          : t("threads.contextCompactionFailed");
        pushThreadErrorMessage(threadId, message);
        safeMessageActivity();
      }
    },
    [
      activeThreadId,
      activeWorkspace,
      dispatch,
      isThreadIdCompatibleWithEngine,
      onDebug,
      pushThreadErrorMessage,
      recordThreadActivity,
      resolveThreadEngine,
      safeMessageActivity,
      t,
      codexCompactionInFlightByThreadRef,
    ],
  );

  const startSpecRoot = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }

      const actionRaw = text.trim().replace(/^\/spec-root\b/i, "").trim().toLowerCase();
      const action: "check" | "rebind" | "default" = actionRaw.startsWith("default")
        ? "default"
        : actionRaw.startsWith("rebind")
          ? "rebind"
          : "check";
      const specRootStorageKey = `specHub.specRoot.${activeWorkspace.id}`;
      const latestCustomSpecRoot = resolveWorkspaceSpecRoot(activeWorkspace.id);
      const resolvedCustomSpecRoot = action === "default" ? null : latestCustomSpecRoot;
      if (action === "default") {
        writeClientStoreValue("app", specRootStorageKey, null);
      }

      const source = resolvedCustomSpecRoot ? "custom" : "default";
      const rootPath = resolvedCustomSpecRoot ?? buildDefaultSpecRootPath(activeWorkspace.path);
      const probe = await probeSessionSpecLink(activeWorkspace.id, activeWorkspace.path, source, rootPath);
      sessionSpecLinkByThreadRef.current.set(`${activeWorkspace.id}:${threadId}`, probe);

      const entries: { kind: "read" | "search" | "list" | "run"; label: string; detail?: string }[] = [
        {
          kind: "list",
          label: t("threads.specRootContext.activeRoot"),
          detail: probe.rootPath,
        },
        {
          kind: "list",
          label: "Probe status",
          detail: probe.status,
        },
        {
          kind: "read",
          label: t("threads.specRootContext.priorityLabel"),
          detail:
            probe.status === "visible"
              ? t("threads.specRootContext.priorityDetail")
              : "Linked root is not usable. Resolve link before relying on fallback inference.",
        },
      ];
      if (probe.reason) {
        entries.push({
          kind: "read",
          label: "Failure reason",
          detail: probe.reason,
        });
      }
      if (probe.status !== "visible") {
        entries.push(
          {
            kind: "run",
            label: "/spec-root rebind",
            detail: "Rebind to latest Spec Hub path and re-probe.",
          },
          {
            kind: "run",
            label: "/spec-root default",
            detail: "Restore workspace default openspec path and re-probe.",
          },
        );
      }

      dispatch({
        type: "upsertItem",
        workspaceId: activeWorkspace.id,
        threadId,
        item: {
          id: `spec-root-context-${threadId}`,
          kind: "explore",
          status: "explored",
          title: t("threads.specRootContext.title"),
          collapsible: true,
          mergeKey: "spec-root-context",
          entries,
        },
        hasCustomName: Boolean(getCustomName(activeWorkspace.id, threadId)),
      });

      const lines = [
        "Spec root probe",
        `Action: ${action}`,
        `Source: ${probe.source}`,
        `Path: ${probe.rootPath}`,
        `Status: ${probe.status}`,
      ];
      if (probe.reason) {
        lines.push(`Reason: ${probe.reason}`);
      }
      if (probe.status !== "visible") {
        lines.push("Repair: /spec-root rebind | /spec-root default");
      }
      dispatch({
        type: "addAssistantMessage",
        threadId,
        text: ["```text", ...lines, "```"].join("\n"),
      });
      safeMessageActivity();
    },
    [activeWorkspace, dispatch, ensureThreadForActiveWorkspace, getCustomName, safeMessageActivity, sessionSpecLinkByThreadRef, t],
  );

  const resolveOpenCodeSessionId = useCallback((threadId: string, text: string): string | null => {
    if (threadId.startsWith("opencode:")) {
      return threadId.slice("opencode:".length);
    }
    const args = text.trim().split(/\s+/).slice(1);
    return args[0] ?? null;
  }, []);

  const normalizeCommandArg = useCallback((value: string) => {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  }, []);

  const resolveFileUri = useCallback(
    (rawPath: string) => {
      const cleaned = normalizeCommandArg(rawPath);
      if (cleaned.startsWith("file://")) {
        return cleaned;
      }
      if (!activeWorkspace) {
        return cleaned;
      }
      const normalizedInput = normalizeExtendedWindowsPath(cleaned).replace(/\\/g, "/");
      if (isAbsoluteHostPath(cleaned)) {
        return toFileUriFromAbsolutePath(normalizedInput);
      }
      const workspacePath = activeWorkspace.path.replace(/\\/g, "/").replace(/\/+$/, "");
      if (!workspacePath) {
        return cleaned;
      }
      const absolutePath = `${workspacePath}/${normalizedInput.replace(/^\/+/, "")}`;
      return toFileUriFromAbsolutePath(absolutePath);
    },
    [activeWorkspace, normalizeCommandArg],
  );

  const startExport = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }
      const sessionId = resolveOpenCodeSessionId(threadId, text);
      if (!sessionId) {
        pushThreadErrorMessage(
          threadId,
          "OpenCode export requires an opencode session. Open an OpenCode thread first.",
        );
        safeMessageActivity();
        return;
      }
      try {
        const pathArg = text.trim().split(/\s+/).slice(2).join(" ").trim();
        const outputPath = pathArg.length > 0 ? pathArg : null;
        const result = await exportOpenCodeSessionService(
          activeWorkspace.id,
          sessionId,
          outputPath,
        );
        const timestamp = Date.now();
        recordThreadActivity(activeWorkspace.id, threadId, timestamp);
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: `Session exported:\n- session: ${result.sessionId}\n- file: ${result.filePath}`,
        });
        safeMessageActivity();
      } catch (error) {
        pushThreadErrorMessage(
          threadId,
          error instanceof Error ? error.message : String(error),
        );
        safeMessageActivity();
      }
    },
    [
      activeWorkspace,
      dispatch,
      ensureThreadForActiveWorkspace,
      pushThreadErrorMessage,
      recordThreadActivity,
      resolveOpenCodeSessionId,
      safeMessageActivity,
    ],
  );

  const startShare = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }
      const sessionId = resolveOpenCodeSessionId(threadId, text);
      if (!sessionId) {
        pushThreadErrorMessage(
          threadId,
          "OpenCode share requires an opencode session. Open an OpenCode thread first.",
        );
        safeMessageActivity();
        return;
      }
      try {
        const result = await shareOpenCodeSessionService(activeWorkspace.id, sessionId);
        const timestamp = Date.now();
        recordThreadActivity(activeWorkspace.id, threadId, timestamp);
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: `Shared session link:\n${result.url}`,
        });
        safeMessageActivity();
      } catch (error) {
        pushThreadErrorMessage(
          threadId,
          error instanceof Error ? error.message : String(error),
        );
        safeMessageActivity();
      }
    },
    [
      activeWorkspace,
      dispatch,
      ensureThreadForActiveWorkspace,
      pushThreadErrorMessage,
      recordThreadActivity,
      resolveOpenCodeSessionId,
      safeMessageActivity,
    ],
  );

  const startImport = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }
      const source = normalizeCommandArg(
        text.trim().split(/\s+/).slice(1).join(" ").trim(),
      );
      if (!source) {
        pushThreadErrorMessage(
          threadId,
          "Usage: /import <path-or-url>",
        );
        safeMessageActivity();
        return;
      }
      try {
        const result = await importOpenCodeSessionService(activeWorkspace.id, source);
        const importedSessionId =
          typeof result.sessionId === "string" ? result.sessionId : null;
        const importedThreadId = importedSessionId
          ? `opencode:${importedSessionId}`
          : null;
        const timestamp = Date.now();
        recordThreadActivity(activeWorkspace.id, threadId, timestamp);
        if (importedThreadId) {
          dispatch({
            type: "ensureThread",
            workspaceId: activeWorkspace.id,
            threadId: importedThreadId,
            engine: "opencode",
          });
          dispatch({
            type: "setThreadEngine",
            workspaceId: activeWorkspace.id,
            threadId: importedThreadId,
            engine: "opencode",
          });
          dispatch({
            type: "setThreadTimestamp",
            workspaceId: activeWorkspace.id,
            threadId: importedThreadId,
            timestamp,
          });
          dispatch({
            type: "addAssistantMessage",
            threadId: importedThreadId,
            text: `Imported from ${source}`,
          });
        }
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: importedSessionId
            ? `Session imported:\n- session: ${importedSessionId}\n- source: ${source}`
            : `Session import completed:\n- source: ${source}\n- output: ${result.output}`,
        });
      } catch (error) {
        pushThreadErrorMessage(
          threadId,
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        safeMessageActivity();
      }
    },
    [
      activeWorkspace,
      dispatch,
      ensureThreadForActiveWorkspace,
      normalizeCommandArg,
      pushThreadErrorMessage,
      recordThreadActivity,
      safeMessageActivity,
    ],
  );

  const startMcp = useCallback(
    async (_text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }

      try {
        const resolvedThreadEngine = resolveThreadEngine(activeWorkspace.id, threadId);
        if (resolvedThreadEngine === "opencode") {
          const response = await getOpenCodeMcpStatusService(activeWorkspace.id);
          const text = (response.text ?? "").trim();
          const timestamp = Date.now();
          recordThreadActivity(activeWorkspace.id, threadId, timestamp);
          dispatch({
            type: "addAssistantMessage",
            threadId,
            text: text
              ? `OpenCode MCP status:\n${text}`
              : "OpenCode MCP status: no output.",
          });
          return;
        }

        const response = (await listMcpServerStatusService(
          activeWorkspace.id,
          null,
          null,
        )) as Record<string, unknown> | null;
        const result = (response?.result ?? response) as
          | Record<string, unknown>
          | null;
        const data = Array.isArray(result?.data)
          ? (result?.data as Array<Record<string, unknown>>)
          : [];

        const lines: string[] = ["MCP tools:"];
        if (data.length === 0) {
          lines.push("- No MCP servers configured.");
        } else {
          const servers = [...data].sort((left, right) =>
            String(left.name ?? "").localeCompare(String(right.name ?? "")),
          );
          for (const server of servers) {
            const name = String(server.name ?? "unknown");
            const authStatus = server.authStatus ?? server.auth_status ?? null;
            const authLabel =
              typeof authStatus === "string"
                ? authStatus
                : authStatus &&
                    typeof authStatus === "object" &&
                    "status" in authStatus
                  ? String((authStatus as { status?: unknown }).status ?? "")
                  : "";
            lines.push(`- ${name}${authLabel ? ` (auth: ${authLabel})` : ""}`);

            const toolsRecord =
              server.tools && typeof server.tools === "object"
                ? (server.tools as Record<string, unknown>)
                : {};
            const prefix = `mcp__${name}__`;
            const toolNames = Object.keys(toolsRecord)
              .map((toolName) =>
                toolName.startsWith(prefix)
                  ? toolName.slice(prefix.length)
                  : toolName,
              )
              .sort((left, right) => left.localeCompare(right));
            lines.push(
              toolNames.length > 0
                ? `  tools: ${toolNames.join(", ")}`
                : "  tools: none",
            );

            const resources = Array.isArray(server.resources)
              ? server.resources.length
              : 0;
            const templates = Array.isArray(server.resourceTemplates)
              ? server.resourceTemplates.length
              : Array.isArray(server.resource_templates)
                ? server.resource_templates.length
                : 0;
            if (resources > 0 || templates > 0) {
              lines.push(`  resources: ${resources}, templates: ${templates}`);
            }
          }
        }

        const timestamp = Date.now();
        recordThreadActivity(activeWorkspace.id, threadId, timestamp);
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: lines.join("\n"),
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load MCP status.";
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: `MCP tools:\n- ${message}`,
        });
      } finally {
        safeMessageActivity();
      }
    },
    [
      activeWorkspace,
      dispatch,
      ensureThreadForActiveWorkspace,
      recordThreadActivity,
      resolveThreadEngine,
      safeMessageActivity,
    ],
  );

  const startLsp = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }
      const resolvedThreadEngine = resolveThreadEngine(activeWorkspace.id, threadId);
      if (resolvedThreadEngine !== "opencode") {
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: "LSP command is currently supported only for OpenCode.",
        });
        safeMessageActivity();
        return;
      }

      const rest = text.trim().replace(/^\/lsp\b/i, "").trim();
      const [sub, ...parts] = rest.split(/\s+/);
      const arg = normalizeCommandArg(parts.join(" ").trim());
      if (!sub) {
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: "Usage: /lsp <diagnostics|symbols|document-symbols> <arg>",
        });
        safeMessageActivity();
        return;
      }

      try {
        let payload: unknown;
        let heading = "";
        if (sub === "diagnostics") {
          if (!arg) {
            throw new Error("Usage: /lsp diagnostics <file-path>");
          }
          const response = await getOpenCodeLspDiagnosticsService(
            activeWorkspace.id,
            arg,
          );
          heading = `LSP diagnostics (${arg})`;
          payload = response.result;
        } else if (sub === "symbols") {
          if (!arg) {
            throw new Error("Usage: /lsp symbols <query>");
          }
          const response = await getOpenCodeLspSymbolsService(
            activeWorkspace.id,
            arg,
          );
          heading = `LSP symbols (${arg})`;
          payload = response.result;
        } else if (sub === "document-symbols") {
          if (!arg) {
            throw new Error("Usage: /lsp document-symbols <file-path-or-file-uri>");
          }
          const fileUri = resolveFileUri(arg);
          const response = await getOpenCodeLspDocumentSymbolsService(
            activeWorkspace.id,
            fileUri,
          );
          heading = `LSP document symbols (${fileUri})`;
          payload = response.result;
        } else {
          throw new Error(
            "Unknown LSP command. Use diagnostics, symbols, or document-symbols.",
          );
        }

        const rendered =
          typeof payload === "string"
            ? payload
            : JSON.stringify(payload ?? null, null, 2);
        const timestamp = Date.now();
        recordThreadActivity(activeWorkspace.id, threadId, timestamp);
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: `${heading}:\n${rendered}`,
        });
      } catch (error) {
        pushThreadErrorMessage(
          threadId,
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        safeMessageActivity();
      }
    },
    [
      activeWorkspace,
      dispatch,
      ensureThreadForActiveWorkspace,
      normalizeCommandArg,
      pushThreadErrorMessage,
      recordThreadActivity,
      resolveFileUri,
      resolveThreadEngine,
      safeMessageActivity,
    ],
  );

  const startFork = useCallback(
    async (text: string) => {
      if (!activeWorkspace || !activeThreadId) {
        return;
      }
      const trimmed = text.trim();
      const rest = trimmed.replace(/^\/fork\b/i, "").trim();
      const threadId = await forkThreadForWorkspace(activeWorkspace.id, activeThreadId);
      if (!threadId) {
        return;
      }
      updateThreadParent(activeThreadId, [threadId]);
      if (rest) {
        await sendMessageToThread(activeWorkspace, threadId, rest, []);
      }
    },
    [
      activeThreadId,
      activeWorkspace,
      forkThreadForWorkspace,
      sendMessageToThread,
      updateThreadParent,
    ],
  );

  const startResume = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      if (activeThreadId && threadStatusById[activeThreadId]?.isProcessing) {
        return;
      }
      const resumeTargetRaw = text.trim().replace(/^\/resume\b/i, "").trim();
      let threadId: string | null = null;
      if (resumeTargetRaw.length > 0) {
        const sessionId = resumeTargetRaw.split(/\s+/)[0] ?? "";
        if (sessionId) {
          const targetThreadId = sessionId.startsWith("opencode:")
            ? sessionId
            : `opencode:${sessionId}`;
          const timestamp = Date.now();
          dispatch({
            type: "ensureThread",
            workspaceId: activeWorkspace.id,
            threadId: targetThreadId,
            engine: "opencode",
          });
          dispatch({
            type: "setThreadEngine",
            workspaceId: activeWorkspace.id,
            threadId: targetThreadId,
            engine: "opencode",
          });
          dispatch({
            type: "setThreadTimestamp",
            workspaceId: activeWorkspace.id,
            threadId: targetThreadId,
            timestamp,
          });
          dispatch({
            type: "setActiveThreadId",
            workspaceId: activeWorkspace.id,
            threadId: targetThreadId,
          });
          threadId = targetThreadId;
        }
      }
      if (!threadId) {
        threadId = activeThreadId ?? (await ensureThreadForActiveWorkspace());
      }
      if (!threadId) {
        return;
      }
      await refreshThread(activeWorkspace.id, threadId);
      safeMessageActivity();
    },
    [
      activeThreadId,
      activeWorkspace,
      dispatch,
      ensureThreadForActiveWorkspace,
      refreshThread,
      safeMessageActivity,
      threadStatusById,
    ],
  );

  return {
    startCompact,
    startContext,
    startExport,
    startFast,
    startFork,
    startImport,
    startLsp,
    startMcp,
    startMode,
    startResume,
    startShare,
    startSpecRoot,
    startStatus,
  };
}
