import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { getClientStoreSync, writeClientStoreValue } from "../services/clientStorage";
import { listAgentConfigs } from "../services/tauri";
import type { DebugEntry, SelectedAgentOption } from "../types";
import {
  getThreadAgentSelectionStorageKey,
  normalizeSelectedAgentOption,
  parseStoredThreadAgentSelectionEntry,
  shouldApplyDraftAgentToThread,
  shouldMigrateSelectedAgentBetweenThreadIds,
} from "./selectedAgentSession";

function resolveSelectedAgentFromCatalog(
  candidate: SelectedAgentOption | null,
  catalogById: Record<string, SelectedAgentOption>,
): SelectedAgentOption | null {
  if (!candidate) {
    return null;
  }
  const catalogAgent = catalogById[candidate.id];
  if (catalogAgent) {
    return catalogAgent;
  }
  return candidate;
}

type UseSelectedAgentSessionOptions = {
  activeThreadId: string | null;
  activeWorkspaceId: string | null;
  resolveCanonicalThreadId: (threadId: string) => string;
  onDebug?: (entry: DebugEntry) => void;
};

type UseSelectedAgentSessionResult = {
  selectedAgent: SelectedAgentOption | null;
  selectedAgentRef: MutableRefObject<SelectedAgentOption | null>;
  handleSelectAgent: (agent: SelectedAgentOption | null) => void;
  reloadSelectedAgent: () => void;
  reloadAgentCatalog: () => Promise<void>;
};

export function useSelectedAgentSession({
  activeThreadId,
  activeWorkspaceId,
  resolveCanonicalThreadId,
  onDebug,
}: UseSelectedAgentSessionOptions): UseSelectedAgentSessionResult {
  const [selectedAgentBySessionKey, setSelectedAgentBySessionKey] = useState<
    Record<string, SelectedAgentOption | null>
  >({});
  const [agentCatalogById, setAgentCatalogById] = useState<
    Record<string, SelectedAgentOption>
  >({});
  const [draftSelectedAgent, setDraftSelectedAgent] = useState<SelectedAgentOption | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<SelectedAgentOption | null>(null);
  const selectedAgentRef = useRef<SelectedAgentOption | null>(null);
  const draftSelectedAgentWorkspaceIdRef = useRef<string | null>(null);
  const shouldApplyDraftAgentToNextThreadRef = useRef(false);

  const resolveSelectedAgentSessionKey = useCallback(
    (workspaceId: string | null, threadId: string | null): string | null => {
      if (!threadId) {
        return null;
      }
      return getThreadAgentSelectionStorageKey(workspaceId, threadId);
    },
    [],
  );

  const reloadAgentCatalog = useCallback(async () => {
    try {
      const configs = await listAgentConfigs();
      const nextCatalog: Record<string, SelectedAgentOption> = {};
      for (const config of configs) {
        const normalized = normalizeSelectedAgentOption({
          id: config.id,
          name: config.name,
          prompt: config.prompt ?? null,
          icon: config.icon ?? null,
        });
        if (normalized) {
          nextCatalog[normalized.id] = normalized;
        }
      }
      setAgentCatalogById(nextCatalog);
    } catch (error) {
      onDebug?.({
        id: `${Date.now()}-agent-catalog-load-error`,
        timestamp: Date.now(),
        source: "error",
        label: "agent/catalog load error",
        payload: error instanceof Error ? error.message : String(error),
      });
    }
  }, [onDebug]);

  const handleSelectAgent = useCallback(
    (agent: SelectedAgentOption | null) => {
      const normalized = normalizeSelectedAgentOption(agent);
      const normalizedFromCatalog = normalized
        ? (agentCatalogById[normalized.id] ?? normalized)
        : null;
      selectedAgentRef.current = normalizedFromCatalog;
      setSelectedAgent(normalizedFromCatalog);
      if (!activeThreadId) {
        setDraftSelectedAgent(normalizedFromCatalog);
        draftSelectedAgentWorkspaceIdRef.current = activeWorkspaceId ?? null;
        shouldApplyDraftAgentToNextThreadRef.current = true;
        return;
      }
      shouldApplyDraftAgentToNextThreadRef.current = false;
      const sessionKey = resolveSelectedAgentSessionKey(activeWorkspaceId, activeThreadId);
      if (!sessionKey) {
        return;
      }
      setSelectedAgentBySessionKey((prev) => ({
        ...prev,
        [sessionKey]: normalizedFromCatalog,
      }));
      writeClientStoreValue("app", sessionKey, normalizedFromCatalog);
    },
    [activeThreadId, activeWorkspaceId, agentCatalogById, resolveSelectedAgentSessionKey],
  );

  const reloadSelectedAgent = useCallback(() => {
    if (!activeThreadId) {
      const draftForActiveWorkspace =
        draftSelectedAgentWorkspaceIdRef.current === (activeWorkspaceId ?? null)
          ? draftSelectedAgent
          : null;
      selectedAgentRef.current = draftForActiveWorkspace;
      setSelectedAgent(draftForActiveWorkspace);
      return;
    }
    const sessionKey = resolveSelectedAgentSessionKey(activeWorkspaceId, activeThreadId);
    if (!sessionKey) {
      selectedAgentRef.current = null;
      setSelectedAgent(null);
      return;
    }

    let candidate: SelectedAgentOption | null = null;
    let hasCandidate = false;
    if (sessionKey in selectedAgentBySessionKey) {
      candidate = selectedAgentBySessionKey[sessionKey] ?? null;
      hasCandidate = true;
    } else {
      const stored = parseStoredThreadAgentSelectionEntry(
        getClientStoreSync<unknown>("app", sessionKey),
      );
      candidate = stored.value;
      hasCandidate = stored.exists;
      const shouldApplyDraftSelection =
        draftSelectedAgentWorkspaceIdRef.current === (activeWorkspaceId ?? null)
        && shouldApplyDraftAgentToThread({
          candidate,
          shouldApplyDraftToNextThread: shouldApplyDraftAgentToNextThreadRef.current,
          draftSelectedAgent,
          activeThreadId,
        });
      if (shouldApplyDraftSelection) {
        candidate = draftSelectedAgent;
        hasCandidate = true;
        shouldApplyDraftAgentToNextThreadRef.current = false;
        writeClientStoreValue("app", sessionKey, candidate);
      }
      if (hasCandidate) {
        setSelectedAgentBySessionKey((prev) => ({
          ...prev,
          [sessionKey]: candidate ?? null,
        }));
      }
    }

    const resolved = resolveSelectedAgentFromCatalog(
      candidate,
      agentCatalogById,
    );
    selectedAgentRef.current = resolved;
    setSelectedAgent(resolved);

    if (
      resolved
      && (!candidate
        || candidate.name !== resolved.name
        || (candidate.prompt ?? null) !== (resolved.prompt ?? null)
        || (candidate.icon ?? null) !== (resolved.icon ?? null))
    ) {
      setSelectedAgentBySessionKey((prev) => ({
        ...prev,
        [sessionKey]: resolved,
      }));
      writeClientStoreValue("app", sessionKey, resolved);
    }
  }, [
    activeThreadId,
    activeWorkspaceId,
    draftSelectedAgent,
    selectedAgentBySessionKey,
    agentCatalogById,
    resolveSelectedAgentSessionKey,
  ]);

  const previousThreadIdForDraftCarryRef = useRef<string | null>(activeThreadId ?? null);
  useEffect(() => {
    const previousThreadId = previousThreadIdForDraftCarryRef.current;
    if (previousThreadId && !activeThreadId) {
      const latestSelectedAgent = selectedAgentRef.current;
      setDraftSelectedAgent(latestSelectedAgent ?? null);
      draftSelectedAgentWorkspaceIdRef.current = activeWorkspaceId ?? null;
      shouldApplyDraftAgentToNextThreadRef.current = Boolean(latestSelectedAgent);
    }
    previousThreadIdForDraftCarryRef.current = activeThreadId ?? null;
  }, [activeThreadId, activeWorkspaceId]);

  const previousThreadIdRef = useRef<string | null>(null);
  const previousThreadWorkspaceIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previousThreadId = previousThreadIdRef.current;
    const previousWorkspaceId = previousThreadWorkspaceIdRef.current;
    const previousSelectedAgentSessionKey = resolveSelectedAgentSessionKey(
      previousWorkspaceId,
      previousThreadId ?? null,
    );
    const activeSelectedAgentSessionKey = resolveSelectedAgentSessionKey(
      activeWorkspaceId,
      activeThreadId,
    );
    const previousSelectedAgentFromMemory =
      previousSelectedAgentSessionKey &&
      Object.prototype.hasOwnProperty.call(
        selectedAgentBySessionKey,
        previousSelectedAgentSessionKey,
      )
        ? selectedAgentBySessionKey[previousSelectedAgentSessionKey] ?? null
        : null;
    const activeSelectedAgentFromMemory =
      activeSelectedAgentSessionKey &&
      Object.prototype.hasOwnProperty.call(
        selectedAgentBySessionKey,
        activeSelectedAgentSessionKey,
      )
        ? selectedAgentBySessionKey[activeSelectedAgentSessionKey] ?? null
        : null;
    const previousSelectedAgentFromStore =
      previousSelectedAgentSessionKey
        ? parseStoredThreadAgentSelectionEntry(
            getClientStoreSync<unknown>("app", previousSelectedAgentSessionKey),
          ).value
        : null;
    const activeSelectedAgentFromStore =
      activeSelectedAgentSessionKey
        ? parseStoredThreadAgentSelectionEntry(
            getClientStoreSync<unknown>("app", activeSelectedAgentSessionKey),
          ).value
        : null;
    const previousSelectedAgentValue =
      previousSelectedAgentFromMemory ?? previousSelectedAgentFromStore;
    const activeSelectedAgentValue =
      activeSelectedAgentFromMemory ?? activeSelectedAgentFromStore;
    const shouldMigrateAgentSelection = shouldMigrateSelectedAgentBetweenThreadIds({
      previousThreadId,
      activeThreadId,
      previousSessionKey: previousSelectedAgentSessionKey,
      activeSessionKey: activeSelectedAgentSessionKey,
      hasSourceSelection: Boolean(previousSelectedAgentValue),
      hasTargetSelection: Boolean(activeSelectedAgentValue),
      resolveCanonicalThreadId,
    });
    if (
      shouldMigrateAgentSelection
      && previousSelectedAgentSessionKey
      && activeSelectedAgentSessionKey
    ) {
      const targetSessionKey = activeSelectedAgentSessionKey;
      const migratedSelection = previousSelectedAgentValue;
      setSelectedAgentBySessionKey((prev) => ({
        ...prev,
        [targetSessionKey]: migratedSelection,
      }));
      writeClientStoreValue("app", targetSessionKey, migratedSelection);
    }
    previousThreadIdRef.current = activeThreadId ?? null;
    previousThreadWorkspaceIdRef.current = activeWorkspaceId ?? null;
  }, [
    activeThreadId,
    activeWorkspaceId,
    resolveCanonicalThreadId,
    selectedAgentBySessionKey,
    resolveSelectedAgentSessionKey,
  ]);

  useEffect(() => {
    reloadSelectedAgent();
  }, [reloadSelectedAgent]);

  return {
    selectedAgent,
    selectedAgentRef,
    handleSelectAgent,
    reloadSelectedAgent,
    reloadAgentCatalog,
  };
}
