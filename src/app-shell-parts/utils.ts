import type {
  ConversationItem,
  EngineType,
  RequestUserInputResponse,
  TurnPlan,
  TurnPlanStepStatus,
} from "../types";

// Non-security UI panel lock: decorative only, not for access control.
export const PANEL_LOCK_INITIAL_PASSWORD = "000000";
export const LOCK_LIVE_SESSION_LIMIT = 12;
export const LOCK_LIVE_PREVIEW_MAX = 180;
export const OPENCODE_VARIANT_OPTIONS = ["minimal", "low", "medium", "high", "max"];
const GIT_HISTORY_PANEL_MIN_HEIGHT = 260;
const GIT_HISTORY_PANEL_MIN_TOP_CLEARANCE = 44;
const GIT_HISTORY_PANEL_DEFAULT_RATIO = 0.5;
export const GIT_HISTORY_PANEL_MAX_SNAP_THRESHOLD = 36;
export const GIT_HISTORY_PANEL_CLOSE_THRESHOLD = 48;
const APP_JANK_DEBUG_FLAG_KEY = "ccgui.debug.jank";
export const LOCAL_PLAN_APPLY_REQUEST_PREFIX = "ccgui-plan-apply:";
export const PLAN_APPLY_ACTION_QUESTION_ID = "plan_apply_action";
export const PLAN_APPLY_EXECUTE_PROMPT = "Implement this plan.";
export const CODE_MODE_RESUME_PROMPT =
  "I switched to code mode. Continue from the latest context and execute directly.";

type ResolveThreadScopedCollaborationModeSyncOptions = {
  activeEngine: EngineType;
  activeThreadId: string | null;
  mappedMode: "plan" | "code" | null;
  selectedCollaborationModeId: string | null;
  lastSyncedThreadId: string | null;
};

type ThreadScopedCollaborationModeSyncResult = {
  nextMode: "plan" | "code" | null;
  nextSyncedThreadId: string | null;
  shouldUpdateSelectedMode: boolean;
};

export function resolveThreadScopedCollaborationModeSync({
  activeEngine,
  activeThreadId,
  mappedMode,
  selectedCollaborationModeId,
  lastSyncedThreadId,
}: ResolveThreadScopedCollaborationModeSyncOptions): ThreadScopedCollaborationModeSyncResult | null {
  if (activeEngine !== "codex" && activeEngine !== "claude") {
    return null;
  }
  if (mappedMode === "plan" || mappedMode === "code") {
    return {
      nextMode: mappedMode,
      nextSyncedThreadId: activeThreadId,
      shouldUpdateSelectedMode: selectedCollaborationModeId !== mappedMode,
    };
  }
  if (lastSyncedThreadId === activeThreadId) {
    return null;
  }
  if (!activeThreadId) {
    return {
      nextMode: null,
      nextSyncedThreadId: null,
      shouldUpdateSelectedMode: false,
    };
  }
  return {
    nextMode: "code",
    nextSyncedThreadId: activeThreadId,
    shouldUpdateSelectedMode: selectedCollaborationModeId !== "code",
  };
}

export type ThreadCompletionTracker = {
  isProcessing: boolean;
  lastDurationMs: number | null;
  lastAgentTimestamp: number;
};

export function extractFirstUserInputAnswer(response: RequestUserInputResponse): string | null {
  const entries = Object.values(response.answers ?? {});
  for (const entry of entries) {
    for (const answer of entry?.answers ?? []) {
      const normalized = String(answer ?? "").trim();
      if (!normalized) {
        continue;
      }
      if (normalized.toLowerCase().startsWith("user_note:")) {
        const note = normalized.slice("user_note:".length).trim();
        if (note) {
          return note;
        }
        continue;
      }
      return normalized;
    }
  }
  return null;
}

function getViewportHeight(): number {
  if (typeof window === "undefined") {
    return 900;
  }
  return window.innerHeight;
}

export function getGitHistoryPanelResizeBounds(viewportHeight = getViewportHeight()) {
  const maxHeight = Math.max(
    GIT_HISTORY_PANEL_MIN_HEIGHT,
    viewportHeight - GIT_HISTORY_PANEL_MIN_TOP_CLEARANCE,
  );
  const minHeight = Math.min(GIT_HISTORY_PANEL_MIN_HEIGHT, maxHeight);
  return {
    viewportHeight,
    minHeight,
    maxHeight,
  };
}

export function clampGitHistoryPanelHeight(height: number, viewportHeight = getViewportHeight()): number {
  const { maxHeight, minHeight } = getGitHistoryPanelResizeBounds(viewportHeight);
  return Math.round(Math.min(maxHeight, Math.max(minHeight, height)));
}

export function getDefaultGitHistoryPanelHeight(): number {
  const viewportHeight = getViewportHeight();
  return clampGitHistoryPanelHeight(viewportHeight * GIT_HISTORY_PANEL_DEFAULT_RATIO, viewportHeight);
}

export function isJankDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(APP_JANK_DEBUG_FLAG_KEY) === "1";
}

function normalizeLockLiveSnippet(text: string, maxLength = LOCK_LIVE_PREVIEW_MAX) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 1))}...`;
}

function normalizeTimelinePlanStepStatus(raw: string): TurnPlanStepStatus {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "completed" || normalized === "done" || normalized === "success") {
    return "completed";
  }
  if (
    normalized === "in_progress" ||
    normalized === "in-progress" ||
    normalized === "inprogress" ||
    normalized === "running"
  ) {
    return "inProgress";
  }
  return "pending";
}

export function extractPlanFromTimelineItems(items: ConversationItem[]): TurnPlan | null {
  const latestPlanItem = [...items]
    .reverse()
    .find(
      (item) =>
        item.kind === "tool" &&
        (item.toolType === "proposed-plan" || item.toolType === "plan-implementation"),
    );
  if (!latestPlanItem || latestPlanItem.kind !== "tool") {
    return null;
  }
  const output = (latestPlanItem.output ?? "").trim();
  const lines = output
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const steps = lines
    .map((line) => {
      const withStatus = line.match(/^- \[([^\]]+)\]\s*(.+)$/);
      if (withStatus) {
        return {
          step: (withStatus[2] ?? "").trim(),
          status: normalizeTimelinePlanStepStatus(withStatus[1] ?? ""),
        };
      }
      const bullet = line.match(/^- (.+)$/);
      if (bullet) {
        return {
          step: (bullet[1] ?? "").trim(),
          status: "pending" as TurnPlanStepStatus,
        };
      }
      return null;
    })
    .filter((entry): entry is { step: string; status: TurnPlanStepStatus } => Boolean(entry));
  const detail = (latestPlanItem.detail ?? "").trim();
  const turnId = detail.startsWith("implement-plan:")
    ? detail.slice("implement-plan:".length).trim() || latestPlanItem.id
    : latestPlanItem.id;
  const explanation = steps.length > 0 ? null : output || null;
  if (!explanation && steps.length === 0) {
    return null;
  }
  return {
    turnId,
    explanation,
    steps,
  };
}

export function resolveLockLivePreview(
  items: ConversationItem[] | undefined,
  fallbackText: string | undefined,
) {
  const threadItems = items ?? [];
  for (let index = threadItems.length - 1; index >= 0; index -= 1) {
    const item = threadItems[index];
    if (!item) {
      continue;
    }
    if (item.kind === "message") {
      const value = normalizeLockLiveSnippet(item.text);
      if (value) {
        return value;
      }
      continue;
    }
    if (item.kind === "reasoning") {
      const value = normalizeLockLiveSnippet(item.summary || item.content);
      if (value) {
        return value;
      }
      continue;
    }
    if (item.kind === "tool") {
      const value = normalizeLockLiveSnippet(item.output || item.detail || item.title);
      if (value) {
        return value;
      }
      continue;
    }
    if (item.kind === "review") {
      const value = normalizeLockLiveSnippet(item.text);
      if (value) {
        return value;
      }
      continue;
    }
    if (item.kind === "diff") {
      const value = normalizeLockLiveSnippet(item.title);
      if (value) {
        return value;
      }
      continue;
    }
    if (item.kind === "explore") {
      const latest = item.entries[item.entries.length - 1];
      const value = normalizeLockLiveSnippet(latest?.detail || latest?.label || "");
      if (value) {
        return value;
      }
    }
  }
  return normalizeLockLiveSnippet(fallbackText || "");
}
