import type { SelectedAgentOption } from "../types";
import { resolveAgentIconForAgent } from "../utils/agentIcons";

const THREAD_AGENT_SELECTION_STORAGE_KEY_PREFIX = "composer.selectedAgentByThread.";

export function normalizeSelectedAgentOption(
  value: unknown,
): SelectedAgentOption | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!id || !name) {
    return null;
  }
  const prompt =
    typeof record.prompt === "string"
      ? record.prompt
      : record.prompt == null
        ? null
        : String(record.prompt);
  const icon = resolveAgentIconForAgent({ id, name, icon: record.icon });
  return {
    id,
    name,
    prompt: prompt && prompt.trim().length > 0 ? prompt : null,
    icon,
  };
}

export function getThreadAgentSelectionStorageKey(
  workspaceId: string | null,
  threadId: string,
): string {
  const workspaceKey =
    typeof workspaceId === "string" && workspaceId.trim().length > 0
      ? workspaceId.trim()
      : "__workspace__unknown__";
  return `${THREAD_AGENT_SELECTION_STORAGE_KEY_PREFIX}${workspaceKey}:${threadId}`;
}

export function parseStoredThreadAgentSelectionEntry(raw: unknown): {
  exists: boolean;
  value: SelectedAgentOption | null;
} {
  if (raw === undefined) {
    return {
      exists: false,
      value: null,
    };
  }
  return {
    exists: true,
    value: normalizeSelectedAgentOption(raw),
  };
}

function resolveThreadEngine(threadId: string): "claude" | "gemini" | "opencode" | "codex" | null {
  if (threadId.startsWith("claude:") || threadId.startsWith("claude-pending-")) {
    return "claude";
  }
  if (threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")) {
    return "gemini";
  }
  if (threadId.startsWith("opencode:") || threadId.startsWith("opencode-pending-")) {
    return "opencode";
  }
  if (threadId.startsWith("codex:") || threadId.startsWith("codex-pending-")) {
    return "codex";
  }
  return null;
}

export function shouldApplyDraftAgentToThread(input: {
  candidate: SelectedAgentOption | null;
  shouldApplyDraftToNextThread: boolean;
  draftSelectedAgent: SelectedAgentOption | null;
  activeThreadId: string | null;
}): boolean {
  return Boolean(
    !input.candidate
      && input.shouldApplyDraftToNextThread
      && input.draftSelectedAgent
      && input.activeThreadId
      && input.activeThreadId.includes("-pending-"),
  );
}

export function shouldMigrateSelectedAgentBetweenThreadIds(input: {
  previousThreadId: string | null;
  activeThreadId: string | null;
  previousSessionKey: string | null;
  activeSessionKey: string | null;
  hasSourceSelection: boolean;
  hasTargetSelection: boolean;
  resolveCanonicalThreadId: (threadId: string) => string;
}): boolean {
  const {
    previousThreadId,
    activeThreadId,
    previousSessionKey,
    activeSessionKey,
    hasSourceSelection,
    hasTargetSelection,
    resolveCanonicalThreadId,
  } = input;

  const previousEngine = previousThreadId ? resolveThreadEngine(previousThreadId) : null;
  const activeEngine = activeThreadId ? resolveThreadEngine(activeThreadId) : null;
  const hasEngineMismatch =
    previousEngine !== null
      && activeEngine !== null
      && previousEngine !== activeEngine;
  const hasForwardFinalizeTransition = Boolean(
    previousThreadId
      && activeThreadId
      && previousThreadId.includes("-pending-")
      && !activeThreadId.includes("-pending-"),
  );
  const hasCanonicalMatch = Boolean(
    previousThreadId
      && activeThreadId
      && resolveCanonicalThreadId(previousThreadId)
        === resolveCanonicalThreadId(activeThreadId),
  );

  return Boolean(
    previousThreadId
      && activeThreadId
      && previousThreadId !== activeThreadId
      && previousSessionKey
      && activeSessionKey
      && hasSourceSelection
      && !hasTargetSelection
      && !hasEngineMismatch
      && (hasForwardFinalizeTransition || hasCanonicalMatch),
  );
}
