import type { EngineType, ThreadSummary } from "../../../types";

export const TOPBAR_SESSION_TAB_MAX = 5;

const TOPBAR_SESSION_TAB_LABEL_CHAR_LIMIT = 7;
const TAB_KEY_SEPARATOR = "::";

export type TopbarSessionTabReference = {
  workspaceId: string;
  threadId: string;
};

export type TopbarSessionWindowEntry = {
  tabs: TopbarSessionTabReference[];
  activationOrdinalByTabKey: Record<string, number>;
  nextActivationOrdinal: number;
};

export type TopbarSessionWindows = TopbarSessionWindowEntry;

export type TopbarSessionTabItem = {
  workspaceId: string;
  threadId: string;
  label: string;
  displayLabel: string;
  engineType: EngineType;
  engineLabel: string;
  isShared?: boolean;
  isActive: boolean;
};

export type TopbarSessionThreadStatusMap = Record<
  string,
  { isProcessing?: boolean } | undefined
>;

const DEFAULT_ENGINE_LABEL_BY_TYPE: Record<EngineType, string> = {
  codex: "Codex",
  claude: "Claude",
  opencode: "OpenCode",
  gemini: "Gemini",
};

export function createEmptyTopbarSessionWindows(): TopbarSessionWindows {
  return {
    tabs: [],
    activationOrdinalByTabKey: {},
    nextActivationOrdinal: 0,
  };
}

function toTabKey(workspaceId: string, threadId: string): string {
  return `${workspaceId}${TAB_KEY_SEPARATOR}${threadId}`;
}

function isSameTab(
  tab: TopbarSessionTabReference,
  workspaceId: string,
  threadId: string,
): boolean {
  return tab.workspaceId === workspaceId && tab.threadId === threadId;
}

function compareTabKeysByCodeUnit(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function shortThreadId(threadId: string): string {
  const normalized = threadId.trim();
  if (normalized.length <= 8) {
    return normalized;
  }
  return normalized.slice(0, 8);
}

function truncateSessionLabel(label: string): string {
  const units = Array.from(label.trim());
  if (units.length <= TOPBAR_SESSION_TAB_LABEL_CHAR_LIMIT) {
    return units.join("");
  }
  return `${units.slice(0, TOPBAR_SESSION_TAB_LABEL_CHAR_LIMIT).join("")}...`;
}

function resolveEngineType(engineSource: ThreadSummary["engineSource"] | undefined): EngineType {
  if (engineSource === "claude" || engineSource === "gemini" || engineSource === "opencode") {
    return engineSource;
  }
  return "codex";
}

export function resolveTopbarSessionTabLabel(
  thread: ThreadSummary,
  untitledLabel: string,
): string {
  const title = thread.name.trim();
  if (title.length > 0) {
    return title;
  }
  return `${untitledLabel} · ${shortThreadId(thread.id)}`;
}

export function pruneTopbarSessionWindows(
  windows: TopbarSessionWindows,
  threadsByWorkspace: Record<string, ThreadSummary[]>,
): TopbarSessionWindows {
  const validThreadIdsByWorkspace = new Map<string, Set<string>>();
  for (const [workspaceId, threads] of Object.entries(threadsByWorkspace)) {
    validThreadIdsByWorkspace.set(
      workspaceId,
      new Set(threads.map((thread) => thread.id)),
    );
  }

  const dedupedTabs: TopbarSessionTabReference[] = [];
  const seenTabKeys = new Set<string>();
  const nextActivationOrdinalByTabKey: Record<string, number> = {};

  for (const tab of windows.tabs) {
    const workspaceThreads = validThreadIdsByWorkspace.get(tab.workspaceId);
    if (!workspaceThreads?.has(tab.threadId)) {
      continue;
    }
    const tabKey = toTabKey(tab.workspaceId, tab.threadId);
    if (seenTabKeys.has(tabKey)) {
      continue;
    }
    seenTabKeys.add(tabKey);
    dedupedTabs.push(tab);
    const ordinal = windows.activationOrdinalByTabKey[tabKey];
    if (Number.isFinite(ordinal)) {
      nextActivationOrdinalByTabKey[tabKey] = ordinal ?? 0;
    }
  }

  return {
    tabs: dedupedTabs,
    activationOrdinalByTabKey: nextActivationOrdinalByTabKey,
    nextActivationOrdinal: windows.nextActivationOrdinal,
  };
}

function pickEvictionCandidate(
  candidateTabs: TopbarSessionTabReference[],
  activationOrdinalByTabKey: Record<string, number>,
): string | null {
  if (candidateTabs.length === 0) {
    return null;
  }
  const sorted = [...candidateTabs].sort((left, right) => {
    const leftKey = toTabKey(left.workspaceId, left.threadId);
    const rightKey = toTabKey(right.workspaceId, right.threadId);
    const leftOrdinal =
      activationOrdinalByTabKey[leftKey] ?? Number.MAX_SAFE_INTEGER;
    const rightOrdinal =
      activationOrdinalByTabKey[rightKey] ?? Number.MAX_SAFE_INTEGER;
    if (leftOrdinal !== rightOrdinal) {
      return leftOrdinal - rightOrdinal;
    }
    return compareTabKeysByCodeUnit(leftKey, rightKey);
  });
  const oldest = sorted[0];
  if (!oldest) {
    return null;
  }
  return toTabKey(oldest.workspaceId, oldest.threadId);
}

export function recordTopbarSessionActivation(
  windows: TopbarSessionWindows,
  workspaceId: string,
  threadId: string,
  threadsByWorkspace: Record<string, ThreadSummary[]>,
  maxTabs = TOPBAR_SESSION_TAB_MAX,
): TopbarSessionWindows {
  const validThreadIds = new Set(
    (threadsByWorkspace[workspaceId] ?? []).map((thread) => thread.id),
  );
  const prunedWindows = pruneTopbarSessionWindows(windows, threadsByWorkspace);
  if (!validThreadIds.has(threadId)) {
    return prunedWindows;
  }

  const activeKey = toTabKey(workspaceId, threadId);
  const nextTabs = [...prunedWindows.tabs];
  const existingIndex = nextTabs.findIndex(
    (tab) => toTabKey(tab.workspaceId, tab.threadId) === activeKey,
  );
  if (existingIndex < 0) {
    nextTabs.push({ workspaceId, threadId });
  }

  const nextActivationOrdinal = prunedWindows.nextActivationOrdinal + 1;
  const nextActivationOrdinalByTabKey = {
    ...prunedWindows.activationOrdinalByTabKey,
    [activeKey]: nextActivationOrdinal,
  };

  while (nextTabs.length > maxTabs) {
    const candidates = nextTabs.filter(
      (tab) => toTabKey(tab.workspaceId, tab.threadId) !== activeKey,
    );
    const evictKey = pickEvictionCandidate(candidates, nextActivationOrdinalByTabKey);
    if (!evictKey) {
      nextTabs.shift();
      continue;
    }
    const index = nextTabs.findIndex(
      (tab) => toTabKey(tab.workspaceId, tab.threadId) === evictKey,
    );
    if (index >= 0) {
      nextTabs.splice(index, 1);
    }
    delete nextActivationOrdinalByTabKey[evictKey];
  }

  return {
    tabs: nextTabs,
    activationOrdinalByTabKey: nextActivationOrdinalByTabKey,
    nextActivationOrdinal,
  };
}

export function dismissTopbarSessionTab(
  windows: TopbarSessionWindows,
  workspaceId: string,
  threadId: string,
): TopbarSessionWindows {
  const targetKey = toTabKey(workspaceId, threadId);
  const nextTabs = windows.tabs.filter(
    (tab) => toTabKey(tab.workspaceId, tab.threadId) !== targetKey,
  );
  if (nextTabs.length === windows.tabs.length) {
    return windows;
  }
  const nextActivationOrdinalByTabKey = { ...windows.activationOrdinalByTabKey };
  delete nextActivationOrdinalByTabKey[targetKey];
  return {
    ...windows,
    tabs: nextTabs,
    activationOrdinalByTabKey: nextActivationOrdinalByTabKey,
  };
}

function dismissTopbarSessionTabsByPredicate(
  windows: TopbarSessionWindows,
  shouldDismiss: (tab: TopbarSessionTabReference, index: number) => boolean,
): TopbarSessionWindows {
  const removedKeys = new Set<string>();
  const nextTabs = windows.tabs.filter((tab, index) => {
    if (!shouldDismiss(tab, index)) {
      return true;
    }
    removedKeys.add(toTabKey(tab.workspaceId, tab.threadId));
    return false;
  });
  if (nextTabs.length === windows.tabs.length) {
    return windows;
  }
  const nextActivationOrdinalByTabKey = { ...windows.activationOrdinalByTabKey };
  removedKeys.forEach((tabKey) => {
    delete nextActivationOrdinalByTabKey[tabKey];
  });
  return {
    ...windows,
    tabs: nextTabs,
    activationOrdinalByTabKey: nextActivationOrdinalByTabKey,
  };
}

export function dismissAllTopbarSessionTabs(
  windows: TopbarSessionWindows,
): TopbarSessionWindows {
  if (windows.tabs.length === 0) {
    return windows;
  }
  return {
    ...windows,
    tabs: [],
    activationOrdinalByTabKey: {},
  };
}

export function dismissTopbarSessionTabsToLeft(
  windows: TopbarSessionWindows,
  workspaceId: string,
  threadId: string,
): TopbarSessionWindows {
  const targetIndex = windows.tabs.findIndex((tab) => isSameTab(tab, workspaceId, threadId));
  if (targetIndex <= 0) {
    return windows;
  }
  return dismissTopbarSessionTabsByPredicate(windows, (_tab, index) => index < targetIndex);
}

export function dismissTopbarSessionTabsToRight(
  windows: TopbarSessionWindows,
  workspaceId: string,
  threadId: string,
): TopbarSessionWindows {
  const targetIndex = windows.tabs.findIndex((tab) => isSameTab(tab, workspaceId, threadId));
  if (targetIndex < 0 || targetIndex >= windows.tabs.length - 1) {
    return windows;
  }
  return dismissTopbarSessionTabsByPredicate(windows, (_tab, index) => index > targetIndex);
}

export function dismissCompletedTopbarSessionTabs(
  windows: TopbarSessionWindows,
  threadStatusById: TopbarSessionThreadStatusMap,
): TopbarSessionWindows {
  return dismissTopbarSessionTabsByPredicate(
    windows,
    (tab) => threadStatusById[tab.threadId]?.isProcessing === false,
  );
}

export function pickAdjacentTopbarSessionFallbackTab(
  previousWindows: TopbarSessionWindows,
  nextWindows: TopbarSessionWindows,
  workspaceId: string,
  threadId: string,
): TopbarSessionTabReference | null {
  const targetIndex = previousWindows.tabs.findIndex((tab) =>
    isSameTab(tab, workspaceId, threadId),
  );
  if (targetIndex < 0) {
    return null;
  }
  const nextTabKeys = new Set(
    nextWindows.tabs.map((tab) => toTabKey(tab.workspaceId, tab.threadId)),
  );
  for (let index = targetIndex + 1; index < previousWindows.tabs.length; index += 1) {
    const candidate = previousWindows.tabs[index];
    if (!candidate) {
      continue;
    }
    const candidateKey = toTabKey(candidate.workspaceId, candidate.threadId);
    if (nextTabKeys.has(candidateKey)) {
      return candidate;
    }
  }
  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const candidate = previousWindows.tabs[index];
    if (!candidate) {
      continue;
    }
    const candidateKey = toTabKey(candidate.workspaceId, candidate.threadId);
    if (nextTabKeys.has(candidateKey)) {
      return candidate;
    }
  }
  return null;
}

export function buildTopbarSessionTabItems(
  activeWorkspaceId: string | null,
  activeThreadId: string | null,
  threadsByWorkspace: Record<string, ThreadSummary[]>,
  windows: TopbarSessionWindows,
  untitledLabel: string,
  engineLabelByType: Partial<Record<EngineType, string>> = {},
): TopbarSessionTabItem[] {
  const threadByWorkspaceAndId = new Map<string, Map<string, ThreadSummary>>();
  for (const [workspaceId, threads] of Object.entries(threadsByWorkspace)) {
    threadByWorkspaceAndId.set(
      workspaceId,
      new Map(threads.map((thread) => [thread.id, thread])),
    );
  }

  const items: TopbarSessionTabItem[] = [];
  for (const tab of windows.tabs) {
    const thread = threadByWorkspaceAndId.get(tab.workspaceId)?.get(tab.threadId);
    if (!thread) {
      continue;
    }
    const label = resolveTopbarSessionTabLabel(thread, untitledLabel);
    const engineType = resolveEngineType(thread.engineSource);
    const baseEngineLabel =
      engineLabelByType[engineType] ?? DEFAULT_ENGINE_LABEL_BY_TYPE[engineType];
    const engineLabel =
      thread.threadKind === "shared"
        ? `Shared · ${baseEngineLabel}`
        : baseEngineLabel;
    items.push({
      workspaceId: tab.workspaceId,
      threadId: tab.threadId,
      label,
      displayLabel: truncateSessionLabel(label),
      engineType,
      engineLabel,
      isShared: thread.threadKind === "shared",
      isActive:
        tab.workspaceId === activeWorkspaceId && tab.threadId === activeThreadId,
    });
  }

  return items;
}
