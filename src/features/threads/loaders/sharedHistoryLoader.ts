import type { ConversationItem } from "../../../types";
import type { HistoryLoader } from "../contracts/conversationCurtainContracts";
import { normalizeHistorySnapshot } from "../contracts/conversationCurtainContracts";
import { normalizeSharedSessionEngine } from "../../shared-session/utils/sharedSessionEngines";

type SharedHistoryLoaderOptions = {
  workspaceId: string;
  loadSharedSession: (
    workspaceId: string,
    threadId: string,
  ) => Promise<Record<string, unknown> | null>;
};

function asString(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function createSharedHistoryLoader({
  workspaceId,
  loadSharedSession,
}: SharedHistoryLoaderOptions): HistoryLoader {
  return {
    engine: "codex",
    async load(threadId: string) {
      const response = await loadSharedSession(workspaceId, threadId);
      const items = Array.isArray(response?.items)
        ? (response?.items as ConversationItem[])
        : [];
      const selectedEngine = asString(response?.selectedEngine).trim().toLowerCase();
      const normalizedSelectedEngine = normalizeSharedSessionEngine(
        selectedEngine === "codex" || selectedEngine === "claude"
          ? selectedEngine
          : undefined,
      );
      return normalizeHistorySnapshot({
        engine: normalizedSelectedEngine,
        workspaceId,
        threadId,
        items,
        meta: {
          workspaceId,
          threadId,
          engine: normalizedSelectedEngine,
          activeTurnId: null,
          isThinking: false,
          heartbeatPulse: null,
          historyRestoredAtMs: Date.now(),
        },
      });
    },
  };
}
