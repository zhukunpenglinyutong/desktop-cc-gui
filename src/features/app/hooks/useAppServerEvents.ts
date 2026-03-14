import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type {
  AppServerEvent,
  ApprovalRequest,
  CollaborationModeBlockedRequest,
  CollaborationModeResolvedRequest,
  RequestUserInputRequest,
} from "../../../types";
import { subscribeAppServerEvents } from "../../../services/events";
import type { NormalizedThreadEvent } from "../../threads/contracts/conversationCurtainContracts";
import {
  getRealtimeAdapterByEngine,
  inferRealtimeAdapterEngine,
} from "../../threads/adapters/realtimeAdapterRegistry";
import { hydrateToolSnapshotWithEventParams } from "../../threads/adapters/toolSnapshotHydration";

type AgentDelta = {
  workspaceId: string;
  threadId: string;
  itemId: string;
  delta: string;
};

type AgentCompleted = {
  workspaceId: string;
  threadId: string;
  itemId: string;
  text: string;
};

type AppServerEventHandlers = {
  onWorkspaceConnected?: (workspaceId: string) => void;
  onThreadStarted?: (workspaceId: string, thread: Record<string, unknown>) => void;
  onThreadSessionIdUpdated?: (
    workspaceId: string,
    threadId: string,
    sessionId: string,
    engine?: "claude" | "opencode" | "codex" | "gemini" | null,
  ) => void;
  onBackgroundThreadAction?: (
    workspaceId: string,
    threadId: string,
    action: string,
  ) => void;
  onApprovalRequest?: (request: ApprovalRequest) => void;
  onRequestUserInput?: (request: RequestUserInputRequest) => void;
  onModeBlocked?: (event: CollaborationModeBlockedRequest) => void;
  onModeResolved?: (event: CollaborationModeResolvedRequest) => void;
  onAgentMessageDelta?: (event: AgentDelta) => void;
  onAgentMessageCompleted?: (event: AgentCompleted) => void;
  onAppServerEvent?: (event: AppServerEvent) => void;
  onTurnStarted?: (workspaceId: string, threadId: string, turnId: string) => void;
  onTurnCompleted?: (workspaceId: string, threadId: string, turnId: string) => void;
  onProcessingHeartbeat?: (workspaceId: string, threadId: string, pulse: number) => void;
  onContextCompacting?: (
    workspaceId: string,
    threadId: string,
    payload: {
      usagePercent: number | null;
      thresholdPercent: number | null;
      targetPercent: number | null;
    },
  ) => void;
  onContextCompacted?: (workspaceId: string, threadId: string, turnId: string) => void;
  onContextCompactionFailed?: (
    workspaceId: string,
    threadId: string,
    reason: string,
  ) => void;
  onTurnError?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: { message: string; willRetry: boolean },
  ) => void;
  onTurnPlanUpdated?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: { explanation: unknown; plan: unknown },
  ) => void;
  onItemStarted?: (workspaceId: string, threadId: string, item: Record<string, unknown>) => void;
  onItemUpdated?: (workspaceId: string, threadId: string, item: Record<string, unknown>) => void;
  onItemCompleted?: (workspaceId: string, threadId: string, item: Record<string, unknown>) => void;
  onReasoningSummaryDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onReasoningSummaryBoundary?: (workspaceId: string, threadId: string, itemId: string) => void;
  onReasoningTextDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onCommandOutputDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onTerminalInteraction?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    stdin: string,
  ) => void;
  onFileChangeOutputDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onTurnDiffUpdated?: (workspaceId: string, threadId: string, diff: string) => void;
  onThreadTokenUsageUpdated?: (
    workspaceId: string,
    threadId: string,
    tokenUsage: Record<string, unknown>,
  ) => void;
  onAccountRateLimitsUpdated?: (
    workspaceId: string,
    rateLimits: Record<string, unknown>,
  ) => void;
  /**
   * 获取指定 workspace 当前活动的 Codex thread ID
   * 用于处理没有 threadId 的 token_count 事件
   * 奶奶请看：这就是那个"智能收件室"的功能，当信没有收件人时，它会自动查找正在使用的房间
   */
  getActiveCodexThreadId?: (workspaceId: string) => string | null;
};

type UseAppServerEventsOptions = {
  useNormalizedRealtimeAdapters?: boolean;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function extractThreadIdFromParams(params: Record<string, unknown>): string {
  const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
  const threadObj = (params.thread as Record<string, unknown> | undefined) ?? {};
  return asString(
    params.threadId ??
      params.thread_id ??
      turn.threadId ??
      turn.thread_id ??
      threadObj.id ??
      "",
  ).trim();
}

function extractItemIdFromParams(params: Record<string, unknown>): string {
  const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
  const itemObj = (params.item as Record<string, unknown> | undefined) ?? {};
  const messageObj = (params.message as Record<string, unknown> | undefined) ?? {};
  const partObj = (params.part as Record<string, unknown> | undefined) ?? {};
  const contentObj = (params.content as Record<string, unknown> | undefined) ?? {};
  return asString(
    params.itemId ??
      params.item_id ??
      partObj.itemId ??
      partObj.item_id ??
      itemObj.id ??
      itemObj.itemId ??
      itemObj.item_id ??
      messageObj.id ??
      contentObj.itemId ??
      contentObj.item_id ??
      turn.itemId ??
      turn.item_id ??
      "",
  ).trim();
}

function extractReasoningDeltaFromParams(params: Record<string, unknown>): string {
  const partObj = (params.part as Record<string, unknown> | undefined) ?? {};
  const itemObj = (params.item as Record<string, unknown> | undefined) ?? {};
  const contentObj = (params.content as Record<string, unknown> | undefined) ?? {};
  return asString(
    params.delta ??
      params.text ??
      params.summary ??
      partObj.delta ??
      partObj.text ??
      partObj.summary ??
      itemObj.delta ??
      itemObj.text ??
      itemObj.summary ??
      contentObj.delta ??
      contentObj.text ??
      contentObj.summary ??
      "",
  ).trim();
}

function extractAgentMessageDeltaPayload(
  method: string,
  params: Record<string, unknown>,
): { threadId: string; itemId: string; delta: string } | null {
  const isTextAliasMethod = method === "text:delta" || method === "text/delta";
  const isAgentDeltaMethod =
    method === "item/agentMessage/delta" ||
    method === "item/agentMessage/textDelta" ||
    method === "item/agentMessage/text/delta" ||
    isTextAliasMethod;
  if (!isAgentDeltaMethod) {
    return null;
  }

  const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
  const itemObj = (params.item as Record<string, unknown> | undefined) ?? {};
  const messageObj = (params.message as Record<string, unknown> | undefined) ?? {};
  const partObj = (params.part as Record<string, unknown> | undefined) ?? {};
  const threadId = extractThreadIdFromParams(params);
  if (
    isTextAliasMethod &&
    !threadId.startsWith("claude:") &&
    !threadId.startsWith("claude-pending-")
  ) {
    return null;
  }
  const rawItemId = asString(
    params.itemId ??
      params.item_id ??
      itemObj.id ??
      messageObj.id ??
      partObj.itemId ??
      partObj.item_id ??
      turn.itemId ??
      turn.item_id ??
      turn.id ??
      "",
  ).trim();
  const itemId =
    rawItemId || (isTextAliasMethod ? `${threadId}:text-delta` : "");
  const delta = asString(
    params.delta ??
      params.text ??
      params.output_text ??
      params.outputText ??
      params.content ??
      partObj.delta ??
      partObj.text ??
      partObj.content ??
      itemObj.delta ??
      itemObj.text ??
      itemObj.content ??
      messageObj.delta ??
      messageObj.text ??
      messageObj.content ??
      "",
  );

  if (!threadId || !itemId || !delta) {
    return null;
  }
  return { threadId, itemId, delta };
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function extractTokenUsageFromNormalizedEvent(
  event: NormalizedThreadEvent,
): Record<string, unknown> | null {
  const usageFromItem =
    event.rawItem && typeof event.rawItem.usage === "object" && event.rawItem.usage
      ? (event.rawItem.usage as Record<string, unknown>)
      : null;
  const usage = event.rawUsage ?? usageFromItem;
  if (!usage) {
    return null;
  }

  const inputTokens = toNumber(usage.input_tokens ?? usage.inputTokens);
  const outputTokens = toNumber(usage.output_tokens ?? usage.outputTokens);
  const cachedInputTokens = toNumber(
    usage.cached_input_tokens ??
      usage.cache_read_input_tokens ??
      usage.cachedInputTokens ??
      usage.cacheReadInputTokens,
  );
  const modelContextWindow = toNumber(
    usage.model_context_window ?? usage.modelContextWindow,
  );
  if (inputTokens <= 0 && outputTokens <= 0 && cachedInputTokens <= 0) {
    return null;
  }
  const safeModelContextWindow = modelContextWindow > 0 ? modelContextWindow : 200000;
  return {
    total: {
      inputTokens,
      outputTokens,
      cachedInputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    last: {
      inputTokens,
      outputTokens,
      cachedInputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    modelContextWindow: safeModelContextWindow,
  };
}

function routeNormalizedRealtimeEvent({
  handlers,
  workspaceId,
  event,
  threadAgentDeltaSeenRef,
  threadAgentCompletedSeenRef,
}: {
  handlers: AppServerEventHandlers;
  workspaceId: string;
  event: NormalizedThreadEvent;
  threadAgentDeltaSeenRef: MutableRefObject<Record<string, true>>;
  threadAgentCompletedSeenRef: MutableRefObject<Record<string, true>>;
}): boolean {
  const threadId = event.threadId;
  const itemId = event.item.id;
  switch (event.operation) {
    case "itemStarted":
      if (event.rawItem) {
        handlers.onItemStarted?.(workspaceId, threadId, event.rawItem);
        return true;
      }
      return false;
    case "itemUpdated":
      if (event.rawItem) {
        handlers.onItemUpdated?.(workspaceId, threadId, event.rawItem);
        return true;
      }
      return false;
    case "itemCompleted":
      if (event.rawItem) {
        handlers.onItemCompleted?.(workspaceId, threadId, event.rawItem);
        const tokenUsage = extractTokenUsageFromNormalizedEvent(event);
        if (tokenUsage) {
          handlers.onThreadTokenUsageUpdated?.(workspaceId, threadId, tokenUsage);
        }
        return true;
      }
      return false;
    case "appendAgentMessageDelta": {
      const delta = event.delta ?? (event.item.kind === "message" ? event.item.text : "");
      if (!delta) {
        return false;
      }
      threadAgentDeltaSeenRef.current[threadId] = true;
      handlers.onAgentMessageDelta?.({
        workspaceId,
        threadId,
        itemId,
        delta,
      });
      return true;
    }
    case "completeAgentMessage": {
      const text = event.item.kind === "message" ? event.item.text : "";
      if (event.rawItem) {
        handlers.onItemCompleted?.(workspaceId, threadId, event.rawItem);
      }
      const tokenUsage = extractTokenUsageFromNormalizedEvent(event);
      if (tokenUsage) {
        handlers.onThreadTokenUsageUpdated?.(workspaceId, threadId, tokenUsage);
      }
      if (threadAgentCompletedSeenRef.current[threadId]) {
        return true;
      }
      handlers.onAgentMessageCompleted?.({
        workspaceId,
        threadId,
        itemId,
        text,
      });
      threadAgentCompletedSeenRef.current[threadId] = true;
      return true;
    }
    case "appendReasoningSummaryDelta": {
      const delta = event.delta ?? "";
      if (!delta) {
        return false;
      }
      handlers.onReasoningSummaryDelta?.(workspaceId, threadId, itemId, delta);
      return true;
    }
    case "appendReasoningSummaryBoundary":
      handlers.onReasoningSummaryBoundary?.(workspaceId, threadId, itemId);
      return true;
    case "appendReasoningContentDelta": {
      const delta = event.delta ?? "";
      if (!delta) {
        return false;
      }
      handlers.onReasoningTextDelta?.(workspaceId, threadId, itemId, delta);
      return true;
    }
    case "appendToolOutputDelta": {
      const delta = event.delta ?? "";
      if (!delta || event.item.kind !== "tool") {
        return false;
      }
      if (event.item.toolType === "fileChange") {
        handlers.onFileChangeOutputDelta?.(workspaceId, threadId, itemId, delta);
      } else {
        handlers.onCommandOutputDelta?.(workspaceId, threadId, itemId, delta);
      }
      return true;
    }
    default:
      return false;
  }
}

function tryRouteNormalizedRealtimeEvent({
  handlers,
  workspaceId,
  message,
  threadAgentDeltaSeenRef,
  threadAgentCompletedSeenRef,
}: {
  handlers: AppServerEventHandlers;
  workspaceId: string;
  message: Record<string, unknown>;
  threadAgentDeltaSeenRef: MutableRefObject<Record<string, true>>;
  threadAgentCompletedSeenRef: MutableRefObject<Record<string, true>>;
}): boolean {
  const params = (message.params as Record<string, unknown> | undefined) ?? {};
  const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
  const threadId = asString(
    params.threadId ??
      params.thread_id ??
      turn.threadId ??
      turn.thread_id ??
      "",
  );
  if (!threadId) {
    return false;
  }
  const engine = inferRealtimeAdapterEngine(threadId);
  const adapter = getRealtimeAdapterByEngine(engine);
  const normalized = adapter.mapEvent({
    workspaceId,
    message,
  });
  if (!normalized) {
    return false;
  }
  return routeNormalizedRealtimeEvent({
    handlers,
    workspaceId,
    event: normalized,
    threadAgentDeltaSeenRef,
    threadAgentCompletedSeenRef,
  });
}

export function useAppServerEvents(
  handlers: AppServerEventHandlers,
  options: UseAppServerEventsOptions = {},
) {
  const threadAgentDeltaSeenRef = useRef<Record<string, true>>({});
  const threadAgentCompletedSeenRef = useRef<Record<string, true>>({});
  useEffect(() => {
    const useNormalizedRealtimeAdapters = options.useNormalizedRealtimeAdapters === true;
    const unlisten = subscribeAppServerEvents((payload) => {
      handlers.onAppServerEvent?.(payload);

      const { workspace_id, message } = payload;
      const method = String(message.method ?? "");

      if (method === "codex/connected") {
        handlers.onWorkspaceConnected?.(workspace_id);
        return;
      }

      const params = (message.params as Record<string, unknown>) ?? {};
      const requestIdValue = message.id ?? params.requestId ?? params.request_id;
      const requestId =
        typeof requestIdValue === "number" || typeof requestIdValue === "string"
          ? requestIdValue
          : null;
      const hasRequestId = requestId !== null;

      if (
        (method.includes("requestApproval") || method === "approval/request") &&
        hasRequestId
      ) {
        handlers.onApprovalRequest?.({
          workspace_id,
          request_id: requestId,
          method,
          params,
        });
        return;
      }

      if (method === "collaboration/modeBlocked") {
        const requestIdValue = params.requestId ?? params.request_id;
        const requestId =
          typeof requestIdValue === "number" || typeof requestIdValue === "string"
            ? requestIdValue
            : null;
        const reasonCodeValue = params.reasonCode ?? params.reason_code;
        const parsedReasonCode =
          reasonCodeValue === undefined || reasonCodeValue === null
            ? undefined
            : String(reasonCodeValue);
        handlers.onModeBlocked?.({
          workspace_id,
          params: {
            thread_id: String(params.threadId ?? params.thread_id ?? ""),
            blocked_method: String(
              params.blockedMethod ?? params.blocked_method ?? "",
            ),
            effective_mode: String(
              params.effectiveMode ?? params.effective_mode ?? "",
            ),
            ...(parsedReasonCode ? { reason_code: parsedReasonCode } : {}),
            reason: String(params.reason ?? ""),
            suggestion:
              params.suggestion === undefined || params.suggestion === null
                ? undefined
                : String(params.suggestion),
            request_id: requestId,
          },
        });
        return;
      }

      if (method === "collaboration/modeResolved") {
        const params = (message.params as Record<string, unknown>) ?? {};
        const selectedUiModeRaw = String(
          params.selectedUiMode ?? params.selected_ui_mode ?? "",
        ).trim().toLowerCase();
        const effectiveRuntimeModeRaw = String(
          params.effectiveRuntimeMode ?? params.effective_runtime_mode ?? "",
        ).trim().toLowerCase();
        const effectiveUiModeRaw = String(
          params.effectiveUiMode ?? params.effective_ui_mode ?? "",
        ).trim().toLowerCase();
        const fallbackReasonRaw =
          params.fallbackReason ?? params.fallback_reason;
        const selectedUiMode =
          selectedUiModeRaw === "plan" ? "plan" : "default";
        const effectiveRuntimeMode =
          effectiveRuntimeModeRaw === "plan" ? "plan" : "code";
        const effectiveUiMode =
          effectiveUiModeRaw === "plan" ? "plan" : "default";
        handlers.onModeResolved?.({
          workspace_id,
          params: {
            thread_id: String(params.threadId ?? params.thread_id ?? ""),
            selected_ui_mode: selectedUiMode,
            effective_runtime_mode: effectiveRuntimeMode,
            effective_ui_mode: effectiveUiMode,
            fallback_reason:
              fallbackReasonRaw === undefined || fallbackReasonRaw === null
                ? null
                : String(fallbackReasonRaw),
          },
        });
        return;
      }

      if (method === "item/tool/requestUserInput" && hasRequestId) {
        const params = (message.params as Record<string, unknown>) ?? {};
        const fallbackThreadId = handlers.getActiveCodexThreadId?.(workspace_id) ?? "";
        const resolvedThreadId =
          extractThreadIdFromParams(params) || fallbackThreadId;
        const completed = Boolean(params.completed);
        const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
        const questionsRaw = Array.isArray(params.questions) ? params.questions : [];
        const questions = questionsRaw
          .map((entry) => {
            const question = entry as Record<string, unknown>;
            const optionsRaw = Array.isArray(question.options) ? question.options : [];
            const options = optionsRaw
              .map((option) => {
                const record = option as Record<string, unknown>;
                const label = String(record.label ?? "").trim();
                const description = String(record.description ?? "").trim();
                if (!label && !description) {
                  return null;
                }
                return { label, description };
              })
              .filter((option): option is { label: string; description: string } => Boolean(option));
            return {
              id: String(question.id ?? "").trim(),
              header: String(question.header ?? ""),
              question: String(question.question ?? ""),
              isOther: Boolean(question.isOther ?? question.is_other),
              isSecret: Boolean(question.isSecret ?? question.is_secret),
              options: options.length ? options : undefined,
            };
          })
          .filter((question) => question.id);
        handlers.onRequestUserInput?.({
          workspace_id,
          request_id: requestId,
          params: {
            thread_id: resolvedThreadId,
            turn_id: String(params.turnId ?? params.turn_id ?? turn.id ?? ""),
            item_id: String(params.itemId ?? params.item_id ?? turn.itemId ?? turn.item_id ?? ""),
            questions,
            ...(completed ? { completed: true } : {}),
          },
        });
        return;
      }

      if (
        useNormalizedRealtimeAdapters &&
        tryRouteNormalizedRealtimeEvent({
          handlers,
          workspaceId: workspace_id,
          message,
          threadAgentDeltaSeenRef,
          threadAgentCompletedSeenRef,
        })
      ) {
        return;
      }

      const agentDeltaPayload = extractAgentMessageDeltaPayload(method, params);
      if (agentDeltaPayload) {
        threadAgentDeltaSeenRef.current[agentDeltaPayload.threadId] = true;
        handlers.onAgentMessageDelta?.({
          workspaceId: workspace_id,
          threadId: agentDeltaPayload.threadId,
          itemId: agentDeltaPayload.itemId,
          delta: agentDeltaPayload.delta,
        });
        return;
      }

      if (method === "turn/started") {
        const params = message.params as Record<string, unknown>;
        const turn = params.turn as Record<string, unknown> | undefined;
        const threadId = String(
          params.threadId ?? params.thread_id ?? turn?.threadId ?? turn?.thread_id ?? "",
        );
        const turnId = String(turn?.id ?? params.turnId ?? params.turn_id ?? "");
        if (threadId) {
          delete threadAgentDeltaSeenRef.current[threadId];
          delete threadAgentCompletedSeenRef.current[threadId];
          handlers.onTurnStarted?.(workspace_id, threadId, turnId);
        }
        return;
      }

      if (method === "thread/started") {
        const params = message.params as Record<string, unknown>;
        const thread = (params.thread as Record<string, unknown> | undefined) ?? null;
        const threadId = String(thread?.id ?? params.threadId ?? params.thread_id ?? "");
        const sessionId = String(params.sessionId ?? params.session_id ?? "");
        const rawEngine = String(params.engine ?? "").toLowerCase();
        const eventEngine =
          rawEngine === "claude" ||
          rawEngine === "opencode" ||
          rawEngine === "codex" ||
          rawEngine === "gemini"
            ? rawEngine
            : null;

        // If we have a real sessionId (not "pending"), notify for thread ID update
        if (threadId && sessionId && sessionId !== "pending") {
          handlers.onThreadSessionIdUpdated?.(
            workspace_id,
            threadId,
            sessionId,
            eventEngine,
          );
        }

        if (thread && threadId) {
          handlers.onThreadStarted?.(workspace_id, thread);
        }
        return;
      }

      if (method === "codex/parseError") {
        const params = (message.params as Record<string, unknown>) ?? {};
        const fallbackThreadId = handlers.getActiveCodexThreadId?.(workspace_id) ?? "";
        const threadId = extractThreadIdFromParams(params) || fallbackThreadId;
        if (!threadId) {
          return;
        }
        const parseErrorText = String(params.error ?? "").trim();
        const rawText = String(params.raw ?? "").trim();
        const detail = rawText ? `\n${rawText}` : "";
        const messageText = parseErrorText
          ? `Codex stream parse error: ${parseErrorText}${detail}`
          : `Codex stream parse error${detail}`;
        handlers.onTurnError?.(workspace_id, threadId, "", {
          message: messageText,
          willRetry: false,
        });
        return;
      }

      if (method === "turn/error") {
        const params = message.params as Record<string, unknown>;
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const turnId = String(params.turnId ?? params.turn_id ?? "");
        const willRetry = Boolean(params.willRetry ?? params.will_retry);
        const errorValue = params.error;
        const messageText =
          typeof errorValue === "string"
            ? errorValue
            : typeof errorValue === "object" && errorValue
              ? String((errorValue as Record<string, unknown>).message ?? "")
              : "";
        if (threadId) {
          handlers.onTurnError?.(workspace_id, threadId, turnId, {
            message: messageText,
            willRetry,
          });
        }
        return;
      }

      if (method === "codex/backgroundThread") {
        const params = message.params as Record<string, unknown>;
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const action = String(params.action ?? "hide");
        if (threadId) {
          handlers.onBackgroundThreadAction?.(workspace_id, threadId, action);
        }
        return;
      }

      if (method === "error") {
        const params = message.params as Record<string, unknown>;
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const turnId = String(params.turnId ?? params.turn_id ?? "");
        const error = (params.error as Record<string, unknown> | undefined) ?? {};
        const messageText = String(error.message ?? "");
        const willRetry = Boolean(params.willRetry ?? params.will_retry);
        if (threadId) {
          handlers.onTurnError?.(workspace_id, threadId, turnId, {
            message: messageText,
            willRetry,
          });
        }
        return;
      }

      if (method === "turn/completed") {
        const params = message.params as Record<string, unknown>;
        const turn = params.turn as Record<string, unknown> | undefined;
        const threadId = String(
          params.threadId ?? params.thread_id ?? turn?.threadId ?? turn?.thread_id ?? "",
        );
        const turnId = String(turn?.id ?? params.turnId ?? params.turn_id ?? "");
        if (threadId) {
          const seenDelta = Boolean(threadAgentDeltaSeenRef.current[threadId]);
          const seenCompleted = Boolean(threadAgentCompletedSeenRef.current[threadId]);
          const result = (params.result as Record<string, unknown> | undefined) ?? undefined;
          const textFromResult = [
            typeof params.text === "string" ? params.text : "",
            typeof result?.text === "string" ? String(result.text) : "",
            typeof result?.output_text === "string" ? String(result.output_text) : "",
            typeof result?.outputText === "string" ? String(result.outputText) : "",
            typeof result?.content === "string" ? String(result.content) : "",
          ]
            .map((item) => item.trim())
            .find((item) => item.length > 0);
          if (!seenDelta && !seenCompleted && textFromResult) {
            handlers.onAgentMessageCompleted?.({
              workspaceId: workspace_id,
              threadId,
              itemId: turnId || `assistant-final-${Date.now()}`,
              text: textFromResult,
            });
            threadAgentCompletedSeenRef.current[threadId] = true;
          }
          delete threadAgentDeltaSeenRef.current[threadId];
          delete threadAgentCompletedSeenRef.current[threadId];
          handlers.onTurnCompleted?.(workspace_id, threadId, turnId);

          // Try to extract usage data from turn/completed (Codex may include it here)
          const usage =
            (params.usage as Record<string, unknown> | undefined) ??
            (params.result as Record<string, unknown> | undefined)?.usage as Record<string, unknown> | undefined;

          if (usage) {
            const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0);
            const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0);
            const cachedInputTokens = Number(
              usage.cached_input_tokens ??
              usage.cache_read_input_tokens ??
              usage.cachedInputTokens ??
              usage.cacheReadInputTokens ?? 0
            );
            const modelContextWindow = Number(
              usage.model_context_window ??
              usage.modelContextWindow ??
              200000 // Default for Codex (will be updated by runtime events)
            );

            if (inputTokens > 0 || outputTokens > 0) {
              const tokenUsage = {
                total: {
                  inputTokens,
                  outputTokens,
                  cachedInputTokens,
                  totalTokens: inputTokens + outputTokens,
                },
                last: {
                  inputTokens,
                  outputTokens,
                  cachedInputTokens,
                  totalTokens: inputTokens + outputTokens,
                },
                modelContextWindow,
              };
              handlers.onThreadTokenUsageUpdated?.(workspace_id, threadId, tokenUsage);
            }
          }
        }
        return;
      }

      if (method === "processing/heartbeat") {
        const params = message.params as Record<string, unknown>;
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const pulse = Number(params.pulse ?? 0);
        if (threadId && Number.isFinite(pulse) && pulse > 0) {
          handlers.onProcessingHeartbeat?.(workspace_id, threadId, pulse);
        }
        return;
      }

      if (method === "thread/compacted") {
        const params = message.params as Record<string, unknown>;
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const turnId = String(params.turnId ?? params.turn_id ?? "");
        if (threadId) {
          handlers.onContextCompacted?.(workspace_id, threadId, turnId);
        }
        return;
      }

      if (method === "thread/compacting") {
        const params = message.params as Record<string, unknown>;
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        if (threadId) {
          const usagePercentRaw = Number(params.usagePercent ?? params.usage_percent);
          const thresholdPercentRaw = Number(
            params.thresholdPercent ?? params.threshold_percent,
          );
          const targetPercentRaw = Number(params.targetPercent ?? params.target_percent);
          handlers.onContextCompacting?.(workspace_id, threadId, {
            usagePercent: Number.isFinite(usagePercentRaw) ? usagePercentRaw : null,
            thresholdPercent: Number.isFinite(thresholdPercentRaw)
              ? thresholdPercentRaw
              : null,
            targetPercent: Number.isFinite(targetPercentRaw) ? targetPercentRaw : null,
          });
        }
        return;
      }

      if (method === "thread/compactionFailed") {
        const params = message.params as Record<string, unknown>;
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        if (threadId) {
          const reason = String(params.reason ?? "").trim();
          handlers.onContextCompactionFailed?.(workspace_id, threadId, reason);
        }
        return;
      }

      if (method === "turn/plan/updated") {
        const params = message.params as Record<string, unknown>;
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const turnId = String(params.turnId ?? params.turn_id ?? "");
        if (threadId) {
          handlers.onTurnPlanUpdated?.(workspace_id, threadId, turnId, {
            explanation: params.explanation,
            plan: params.plan,
          });
        }
        return;
      }

      if (method === "turn/diff/updated") {
        const params = message.params as Record<string, unknown>;
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const diff = String(params.diff ?? "");
        if (threadId && diff) {
          handlers.onTurnDiffUpdated?.(workspace_id, threadId, diff);
        }
        return;
      }

      if (method === "thread/tokenUsage/updated") {
        const params = message.params as Record<string, unknown>;
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const tokenUsage =
          (params.tokenUsage as Record<string, unknown> | undefined) ??
          (params.token_usage as Record<string, unknown> | undefined);
        if (threadId && tokenUsage) {
          handlers.onThreadTokenUsageUpdated?.(workspace_id, threadId, tokenUsage);
        }
        return;
      }

      // Handle Codex token_count events (Codex sends usage data this way)
      // Format: {"method":"token_count","params":{"info":{"total_token_usage":{...}}}}
      if (method === "token_count") {
        const params = message.params as Record<string, unknown>;
        const info = params.info as Record<string, unknown> | undefined;
        let threadId = String(params.threadId ?? params.thread_id ?? "");

        // If no threadId in event, try to resolve from the active Codex thread
        if (!threadId && handlers.getActiveCodexThreadId) {
          const activeThreadId = handlers.getActiveCodexThreadId(workspace_id);
          if (activeThreadId) {
            threadId = activeThreadId;
          }
        }

        // Skip this event if threadId is still unavailable
        if (!threadId) {
          return;
        }

        if (info) {
          const totalUsageData =
            (info.total_token_usage as Record<string, unknown> | undefined) ??
            (info.totalTokenUsage as Record<string, unknown> | undefined);
          const lastUsageData =
            (info.last_token_usage as Record<string, unknown> | undefined) ??
            (info.lastTokenUsage as Record<string, unknown> | undefined);
          // Prefer last/current snapshot, fallback to total when unavailable.
          const fallbackUsageData = lastUsageData ?? totalUsageData;

          if (fallbackUsageData) {
            const normalizeUsage = (usageData: Record<string, unknown>) => {
              const inputTokens = Number(usageData.input_tokens ?? usageData.inputTokens ?? 0);
              const outputTokens = Number(usageData.output_tokens ?? usageData.outputTokens ?? 0);
              const cachedInputTokens = Number(
                usageData.cached_input_tokens ??
                  usageData.cache_read_input_tokens ??
                  usageData.cachedInputTokens ??
                  usageData.cacheReadInputTokens ??
                  0,
              );
              return {
                inputTokens,
                outputTokens,
                cachedInputTokens,
                totalTokens: inputTokens + outputTokens,
              };
            };

            const totalUsage = normalizeUsage(totalUsageData ?? fallbackUsageData);
            const lastUsage = lastUsageData
              ? normalizeUsage(lastUsageData)
              : {
                  inputTokens: 0,
                  outputTokens: 0,
                  cachedInputTokens: 0,
                  totalTokens: 0,
                };
            const modelContextWindow = Number(
              lastUsageData?.model_context_window ??
                lastUsageData?.modelContextWindow ??
                totalUsageData?.model_context_window ??
                totalUsageData?.modelContextWindow ??
                info.model_context_window ??
                info.modelContextWindow ??
                200000, // Default for Codex (will be updated by runtime events)
            );

            const tokenUsage = {
              total: totalUsage,
              last: lastUsage,
              modelContextWindow,
            };

            handlers.onThreadTokenUsageUpdated?.(workspace_id, threadId, tokenUsage);
          }
        }
        return;
      }

      if (method === "account/rateLimits/updated") {
        const params = message.params as Record<string, unknown>;
        const rateLimits =
          (params.rateLimits as Record<string, unknown> | undefined) ??
          (params.rate_limits as Record<string, unknown> | undefined);
        if (rateLimits) {
          handlers.onAccountRateLimitsUpdated?.(workspace_id, rateLimits);
        }
        return;
      }

      if (method === "item/completed") {
        const params = message.params as Record<string, unknown>;
        const threadId = extractThreadIdFromParams(params);
        const item =
          params.item && typeof params.item === "object"
            ? hydrateToolSnapshotWithEventParams(
                params.item as Record<string, unknown>,
                params,
              )
            : undefined;
        if (threadId && item) {
          handlers.onItemCompleted?.(workspace_id, threadId, item);

          // Try to extract usage data from item/completed (Codex may include it here)
          const usage =
            (item.usage as Record<string, unknown> | undefined) ??
            (params.usage as Record<string, unknown> | undefined);

          if (usage) {
            const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0);
            const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0);
            const cachedInputTokens = Number(
              usage.cached_input_tokens ??
              usage.cache_read_input_tokens ??
              usage.cachedInputTokens ??
              usage.cacheReadInputTokens ?? 0
            );
            const modelContextWindow = Number(
              usage.model_context_window ??
              usage.modelContextWindow ??
              200000 // Default for Codex (will be updated by runtime events)
            );

            if (inputTokens > 0 || outputTokens > 0 || cachedInputTokens > 0) {
              const tokenUsage = {
                total: {
                  inputTokens,
                  outputTokens,
                  cachedInputTokens,
                  totalTokens: inputTokens + outputTokens,
                },
                last: {
                  inputTokens,
                  outputTokens,
                  cachedInputTokens,
                  totalTokens: inputTokens + outputTokens,
                },
                modelContextWindow,
              };
              handlers.onThreadTokenUsageUpdated?.(workspace_id, threadId, tokenUsage);
            }
          }
        }
        if (threadId && item?.type === "agentMessage") {
          const itemId = String(item.id ?? "");
          const text = String(item.text ?? "");
          if (itemId && !threadAgentCompletedSeenRef.current[threadId]) {
            handlers.onAgentMessageCompleted?.({
              workspaceId: workspace_id,
              threadId,
              itemId,
              text,
            });
            threadAgentCompletedSeenRef.current[threadId] = true;
          }
        }
        return;
      }

      if (method === "item/started") {
        const params = message.params as Record<string, unknown>;
        const threadId = extractThreadIdFromParams(params);
        const item =
          params.item && typeof params.item === "object"
            ? hydrateToolSnapshotWithEventParams(
                params.item as Record<string, unknown>,
                params,
              )
            : undefined;
        if (threadId && item) {
          handlers.onItemStarted?.(workspace_id, threadId, item);
        }
        return;
      }

      if (method === "item/updated") {
        const params = message.params as Record<string, unknown>;
        const threadId = extractThreadIdFromParams(params);
        const item =
          params.item && typeof params.item === "object"
            ? hydrateToolSnapshotWithEventParams(
                params.item as Record<string, unknown>,
                params,
              )
            : undefined;
        if (threadId && item) {
          handlers.onItemUpdated?.(workspace_id, threadId, item);
        }
        return;
      }

      if (
        method === "item/reasoning/summaryTextDelta" ||
        method === "response.reasoning_summary_text.delta" ||
        method === "response.reasoning_summary_text.done" ||
        method === "response.reasoning_summary.delta" ||
        method === "response.reasoning_summary.done" ||
        method === "response.reasoning_summary_part.done"
      ) {
        const params = message.params as Record<string, unknown>;
        const fallbackThreadId = handlers.getActiveCodexThreadId?.(workspace_id) ?? "";
        const threadId = extractThreadIdFromParams(params) || fallbackThreadId;
        const itemId = extractItemIdFromParams(params);
        const delta = extractReasoningDeltaFromParams(params);
        if (threadId && itemId && delta) {
          handlers.onReasoningSummaryDelta?.(workspace_id, threadId, itemId, delta);
        }
        return;
      }

      if (
        method === "item/reasoning/summaryPartAdded" ||
        method === "response.reasoning_summary_part.added"
      ) {
        const params = message.params as Record<string, unknown>;
        const fallbackThreadId = handlers.getActiveCodexThreadId?.(workspace_id) ?? "";
        const threadId = extractThreadIdFromParams(params) || fallbackThreadId;
        const itemId = extractItemIdFromParams(params);
        if (threadId && itemId) {
          handlers.onReasoningSummaryBoundary?.(workspace_id, threadId, itemId);
        }
        return;
      }

      if (
        method === "item/reasoning/textDelta" ||
        method === "response.reasoning_text.delta" ||
        method === "response.reasoning_text.done"
      ) {
        const params = message.params as Record<string, unknown>;
        const fallbackThreadId = handlers.getActiveCodexThreadId?.(workspace_id) ?? "";
        const threadId = extractThreadIdFromParams(params) || fallbackThreadId;
        const itemId = extractItemIdFromParams(params);
        const delta = extractReasoningDeltaFromParams(params);
        if (threadId && itemId && delta) {
          handlers.onReasoningTextDelta?.(workspace_id, threadId, itemId, delta);
        }
        return;
      }

      // Compatibility for Codex app-server variants that emit reasoning deltas
      // without the "textDelta" suffix.
      if (method === "item/reasoning/delta") {
        const params = message.params as Record<string, unknown>;
        const fallbackThreadId = handlers.getActiveCodexThreadId?.(workspace_id) ?? "";
        const threadId = extractThreadIdFromParams(params) || fallbackThreadId;
        const itemId = extractItemIdFromParams(params);
        const delta = extractReasoningDeltaFromParams(params);
        if (threadId && itemId && delta) {
          handlers.onReasoningTextDelta?.(workspace_id, threadId, itemId, delta);
        }
        return;
      }

      if (method === "item/commandExecution/outputDelta") {
        const params = message.params as Record<string, unknown>;
        const threadId = extractThreadIdFromParams(params);
        const itemId = extractItemIdFromParams(params);
        const delta = String(params.delta ?? "");
        if (threadId && itemId && delta) {
          handlers.onCommandOutputDelta?.(workspace_id, threadId, itemId, delta);
        }
        return;
      }

      if (method === "item/commandExecution/terminalInteraction") {
        const params = message.params as Record<string, unknown>;
        const threadId = extractThreadIdFromParams(params);
        const itemId = extractItemIdFromParams(params);
        const stdin = String(params.stdin ?? "");
        if (threadId && itemId) {
          handlers.onTerminalInteraction?.(workspace_id, threadId, itemId, stdin);
        }
        return;
      }

      if (method === "item/fileChange/outputDelta") {
        const params = message.params as Record<string, unknown>;
        const threadId = extractThreadIdFromParams(params);
        const itemId = extractItemIdFromParams(params);
        const delta = String(params.delta ?? "");
        if (threadId && itemId && delta) {
          handlers.onFileChangeOutputDelta?.(workspace_id, threadId, itemId, delta);
        }
        return;
      }
    });

    return () => {
      unlisten();
    };
  }, [handlers, options.useNormalizedRealtimeAdapters]);
}
