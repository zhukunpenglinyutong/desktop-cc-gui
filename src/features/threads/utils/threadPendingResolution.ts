export type PendingResolutionInput = {
  workspaceId: string;
  engine: "claude" | "gemini" | "opencode";
  threadsByWorkspace: Record<string, Array<{ id: string }>>;
  activeThreadIdByWorkspace: Record<string, string | null>;
  threadStatusById: Record<string, { isProcessing?: boolean } | undefined>;
  activeTurnIdByThread: Record<string, string | null | undefined>;
  itemsByThread: Record<string, unknown[] | undefined>;
};

export type PendingTurnResolutionInput = Pick<
  PendingResolutionInput,
  "workspaceId" | "engine" | "threadsByWorkspace" | "activeThreadIdByWorkspace" | "activeTurnIdByThread"
> & {
  turnId: string | null | undefined;
};

function normalizeTurnId(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolvePendingThreadIdForSession({
  workspaceId,
  engine,
  threadsByWorkspace,
  activeThreadIdByWorkspace,
  threadStatusById,
  activeTurnIdByThread,
  itemsByThread,
}: PendingResolutionInput): string | null {
  const prefix = `${engine}-pending-`;
  const threads = threadsByWorkspace[workspaceId] ?? [];
  const pendingThreads = threads.filter((thread) => thread.id.startsWith(prefix));
  if (pendingThreads.length === 0) {
    return null;
  }

  const activePendingId = activeThreadIdByWorkspace[workspaceId] ?? null;
  const pickActivePending = (candidates: Array<{ id: string }>): string | null => {
    if (!activePendingId || !activePendingId.startsWith(prefix)) {
      return null;
    }
    return candidates.some((candidate) => candidate.id === activePendingId)
      ? activePendingId
      : null;
  };
  const hasObservedItems = (threadId: string) => (itemsByThread[threadId]?.length ?? 0) > 0;
  const hasPendingAnchor = (threadId: string) => {
    const hasActiveTurn = normalizeTurnId(activeTurnIdByThread[threadId]).length > 0;
    if (hasActiveTurn) {
      return true;
    }
    const isProcessing = Boolean(threadStatusById[threadId]?.isProcessing);
    return isProcessing && hasObservedItems(threadId);
  };

  // Boundary guard: pending->session reconciliation requires a concrete anchor
  // (active turn or observed items). Processing state alone is not sufficient,
  // otherwise old in-flight streams can be rebound into unrelated new sessions.
  const activePending = pickActivePending(pendingThreads);
  if (activePending && hasPendingAnchor(activePending)) {
    return activePending;
  }

  const turnBoundPending = pendingThreads.filter(
    (thread) => normalizeTurnId(activeTurnIdByThread[thread.id]).length > 0,
  );
  if (turnBoundPending.length === 1) {
    return turnBoundPending[0]?.id ?? null;
  }
  if (turnBoundPending.length > 1) {
    return pickActivePending(turnBoundPending);
  }

  const contentBoundPending = pendingThreads.filter(
    (thread) =>
      Boolean(threadStatusById[thread.id]?.isProcessing)
      && hasObservedItems(thread.id),
  );
  if (contentBoundPending.length === 1) {
    return contentBoundPending[0]?.id ?? null;
  }
  if (contentBoundPending.length > 1) {
    return pickActivePending(contentBoundPending);
  }

  if (pendingThreads.length === 1) {
    const onlyPendingId = pendingThreads[0]?.id ?? "";
    return hasPendingAnchor(onlyPendingId) ? onlyPendingId : null;
  }

  return null;
}

export function resolvePendingThreadIdForTurn({
  workspaceId,
  engine,
  turnId,
  threadsByWorkspace,
  activeThreadIdByWorkspace,
  activeTurnIdByThread,
}: PendingTurnResolutionInput): string | null {
  const normalizedTurnId = normalizeTurnId(turnId);
  if (!normalizedTurnId) {
    return null;
  }

  const prefix = `${engine}-pending-`;
  const pendingThreads = (threadsByWorkspace[workspaceId] ?? []).filter((thread) =>
    thread.id.startsWith(prefix),
  );
  if (pendingThreads.length === 0) {
    return null;
  }

  const matchedPendingThreads = pendingThreads.filter(
    (thread) => normalizeTurnId(activeTurnIdByThread[thread.id]) === normalizedTurnId,
  );
  if (matchedPendingThreads.length === 1) {
    return matchedPendingThreads[0]?.id ?? null;
  }
  if (matchedPendingThreads.length > 1) {
    const activePendingId = activeThreadIdByWorkspace[workspaceId] ?? null;
    if (
      activePendingId &&
      activePendingId.startsWith(prefix) &&
      matchedPendingThreads.some((thread) => thread.id === activePendingId)
    ) {
      return activePendingId;
    }
  }

  return null;
}
