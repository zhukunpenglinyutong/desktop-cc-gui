import type { TFunction } from "i18next";
import type { AccessMode, EngineType, ReviewTarget } from "../../../types";
import { isValidModelId } from "../../composer/types/provider";
import {
  classifyNetworkError,
  parseFirstPacketTimeoutSeconds,
  stripBackendErrorPrefix,
} from "../utils/networkErrors";

export function normalizeCollaborationModeId(
  value: unknown,
): "plan" | "code" | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "default") {
    return "code";
  }
  return normalized === "plan" || normalized === "code"
    ? normalized
    : null;
}

export function resolveCollaborationModeIdFromPayload(
  payload: Record<string, unknown> | null | undefined,
): "plan" | "code" | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return (
    normalizeCollaborationModeId(payload.mode) ??
    normalizeCollaborationModeId(payload.id) ??
    null
  );
}

export function normalizeAccessMode(
  mode:
    | AccessMode
    | "default"
    | "read-only"
    | "current"
    | "full-access"
    | undefined,
  engine: EngineType,
): "default" | "read-only" | "current" | "full-access" | undefined {
  if (mode === undefined) {
    return undefined;
  }
  if (mode === "default") {
    // Codex does not expose a dedicated "default" policy, so we keep legacy behavior there.
    return engine === "codex" ? "current" : "default";
  }
  return mode;
}

export function isUnknownEngineInterruptTurnMethodError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : (() => {
          try {
            return JSON.stringify(error);
          } catch {
            return String(error);
          }
        })();
  return message.toLowerCase().includes("unknown method: engine_interrupt_turn");
}

export function isLikelyForeignModelForGemini(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  // Allow custom Gemini aliases like "[L]gemini-3-pro-preview" even if they
  // are wrapped by proxy-specific prefixes.
  if (normalized.includes("gemini")) {
    return false;
  }
  if (normalized.startsWith("claude-")) {
    return true;
  }
  if (normalized.startsWith("gpt-") || normalized.includes("codex")) {
    return true;
  }
  return (
    normalized.startsWith("openai/")
    || normalized.startsWith("anthropic/")
    || normalized.startsWith("x-ai/")
    || normalized.startsWith("openrouter/")
    || normalized.startsWith("deepseek/")
    || normalized.startsWith("qwen/")
    || normalized.startsWith("meta/")
    || normalized.startsWith("mistral/")
  );
}

export function isValidClaudeModelForPassthrough(modelId: string): boolean {
  const normalized = modelId.trim();
  if (!normalized) {
    return false;
  }
  return isValidModelId(normalized);
}

export function buildReviewCommandText(target: ReviewTarget): string {
  if (target.type === "uncommittedChanges") {
    return "/review";
  }
  if (target.type === "baseBranch") {
    return `/review base ${target.branch}`.trim();
  }
  if (target.type === "commit") {
    const title = target.title?.trim();
    return title
      ? `/review commit ${target.sha} ${title}`.trim()
      : `/review commit ${target.sha}`.trim();
  }
  return `/review custom ${target.instructions}`.trim();
}

export function isInvalidReviewThreadIdError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("invalid thread id")
    || normalized.includes("expected an optional prefix of `urn:uuid:`")
    || normalized.includes('expected an optional prefix of "urn:uuid:"')
  );
}

export function mapNetworkErrorToUserMessage(
  rawMessage: string,
  t: TFunction,
): { message: string; isNetwork: boolean } {
  const timeoutSeconds = parseFirstPacketTimeoutSeconds(rawMessage);
  if (timeoutSeconds) {
    return {
      message: t("threads.firstPacketTimeout", { seconds: timeoutSeconds }),
      isNetwork: true,
    };
  }

  const networkKind = classifyNetworkError(rawMessage);
  if (networkKind) {
    if (networkKind === "timeout") {
      return {
        message: t("threads.requestTimeoutHint"),
        isNetwork: true,
      };
    }
    return {
      message:
        networkKind === "proxy"
          ? t("threads.networkProxyHint")
          : t("threads.networkConnectionHint"),
      isNetwork: true,
    };
  }

  return {
    message: stripBackendErrorPrefix(rawMessage),
    isNetwork: false,
  };
}

function normalizeSessionIdCandidate(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized && normalized !== "pending" ? normalized : null;
  }
  if (typeof value === "number") {
    const normalized = String(value).trim();
    return normalized && normalized !== "pending" ? normalized : null;
  }
  return null;
}

export function extractSessionIdFromEngineSendResponse(
  response: Record<string, unknown>,
): string | null {
  const result =
    response.result && typeof response.result === "object"
      ? (response.result as Record<string, unknown>)
      : null;
  const thread =
    result?.thread && typeof result.thread === "object"
      ? (result.thread as Record<string, unknown>)
      : null;
  const candidates = [
    response.sessionId,
    response.session_id,
    result?.sessionId,
    result?.session_id,
    thread?.sessionId,
    thread?.session_id,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeSessionIdCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

type GeminiSessionSummary = {
  sessionId: string;
  updatedAt: number;
};

function normalizeGeminiSessionSummary(value: unknown): GeminiSessionSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const sessionId = normalizeSessionIdCandidate(record.sessionId ?? record.session_id);
  if (!sessionId) {
    return null;
  }
  const rawUpdatedAt = record.updatedAt ?? record.updated_at;
  const updatedAt =
    typeof rawUpdatedAt === "number" && Number.isFinite(rawUpdatedAt)
      ? rawUpdatedAt
      : typeof rawUpdatedAt === "string"
        ? Number(rawUpdatedAt)
        : 0;
  return {
    sessionId,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
  };
}

export function pickLikelyGeminiSessionId(
  payload: unknown,
  minUpdatedAt: number,
): string | null {
  const nestedSessions =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).sessions
      : null;
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(nestedSessions)
      ? nestedSessions
      : [];
  const summaries = entries
    .map(normalizeGeminiSessionSummary)
    .filter((entry): entry is GeminiSessionSummary => entry !== null);
  if (summaries.length === 0) {
    return null;
  }
  const recents = summaries.filter((entry) => entry.updatedAt >= minUpdatedAt);
  // Safety first: only bind when there is exactly one plausible candidate.
  // This prevents cross-thread session hijack when multiple pending Gemini
  // conversations update around the same time in the same workspace.
  if (recents.length === 1) {
    return recents[0]?.sessionId ?? null;
  }
  if (recents.length > 1) {
    return null;
  }
  if (summaries.length === 1) {
    return summaries[0]?.sessionId ?? null;
  }
  return null;
}

export function resolveRecoverableCodexFirstPacketTimeout(
  engine: EngineType,
  rawMessage: string,
): number | null {
  if (engine !== "codex") {
    return null;
  }
  return parseFirstPacketTimeoutSeconds(rawMessage);
}
