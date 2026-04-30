import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { getClientStoreSync, writeClientStoreValue } from "../services/clientStorage";
import type { DebugEntry } from "../types";
import {
  getThreadComposerSelectionStorageKey,
  normalizeComposerSessionSelection,
  shouldApplyDraftComposerSelectionToThread,
  shouldMigrateComposerSelectionBetweenThreadIds,
  type ComposerSessionSelection,
} from "./selectedComposerSession";

function selectionsEqual(
  left: ComposerSessionSelection | null,
  right: ComposerSessionSelection | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.modelId === right.modelId && left.effort === right.effort;
}

function readStoredThreadComposerSelectionEntryBySessionKey(
  sessionKey: string,
): { exists: boolean; value: ComposerSessionSelection | null } {
  const raw = getClientStoreSync<unknown>("composer", sessionKey);
  if (raw === undefined) {
    return {
      exists: false,
      value: null,
    };
  }
  return {
    exists: true,
    value: normalizeComposerSessionSelection(raw),
  };
}

type UseSelectedComposerSessionOptions = {
  activeThreadId: string | null;
  activeWorkspaceId: string | null;
  resolveCanonicalThreadId: (threadId: string) => string;
  onDebug?: (entry: DebugEntry) => void;
};

type UseSelectedComposerSessionResult = {
  selectedComposerSelection: ComposerSessionSelection | null;
  selectedComposerSelectionRef: MutableRefObject<ComposerSessionSelection | null>;
  handleSelectComposerSelection: (selection: ComposerSessionSelection | null) => void;
  persistComposerSelectionForThread: (
    workspaceId: string | null,
    threadId: string | null,
    selection: ComposerSessionSelection | null,
  ) => void;
  reloadSelectedComposerSelection: () => void;
  resolveComposerSelectionForThread: (
    workspaceId: string | null,
    threadId: string | null,
  ) => ComposerSessionSelection | null;
};

export function useSelectedComposerSession({
  activeThreadId,
  activeWorkspaceId,
  resolveCanonicalThreadId,
}: UseSelectedComposerSessionOptions): UseSelectedComposerSessionResult {
  const [selectedComposerSelectionBySessionKey, setSelectedComposerSelectionBySessionKey] =
    useState<Record<string, ComposerSessionSelection | null>>({});
  const [draftComposerSelection, setDraftComposerSelection] =
    useState<ComposerSessionSelection | null>(null);
  const [selectedComposerSelection, setSelectedComposerSelection] =
    useState<ComposerSessionSelection | null>(null);
  const selectedComposerSelectionRef = useRef<ComposerSessionSelection | null>(null);
  const draftComposerSelectionWorkspaceIdRef = useRef<string | null>(null);
  const shouldApplyDraftToNextThreadRef = useRef(false);

  const resolveSelectedComposerSessionKey = useCallback(
    (workspaceId: string | null, threadId: string | null): string | null => {
      if (!threadId) {
        return null;
      }
      return getThreadComposerSelectionStorageKey(workspaceId, threadId);
    },
    [],
  );

  const writeSelectionForSessionKey = useCallback(
    (sessionKey: string, selection: ComposerSessionSelection | null) => {
      setSelectedComposerSelectionBySessionKey((prev) => {
        if (selectionsEqual(prev[sessionKey] ?? null, selection)) {
          return prev;
        }
        return {
          ...prev,
          [sessionKey]: selection,
        };
      });
      writeClientStoreValue("composer", sessionKey, selection);
    },
    [],
  );

  const persistComposerSelectionForThread = useCallback(
    (
      workspaceId: string | null,
      threadId: string | null,
      selection: ComposerSessionSelection | null,
    ) => {
      if (!threadId) {
        return;
      }
      const sessionKey = resolveSelectedComposerSessionKey(workspaceId, threadId);
      if (!sessionKey) {
        return;
      }
      const normalized = normalizeComposerSessionSelection(selection);
      writeSelectionForSessionKey(sessionKey, normalized);
    },
    [resolveSelectedComposerSessionKey, writeSelectionForSessionKey],
  );

  const handleSelectComposerSelection = useCallback(
    (selection: ComposerSessionSelection | null) => {
      const normalized = normalizeComposerSessionSelection(selection);
      selectedComposerSelectionRef.current = normalized;
      setSelectedComposerSelection(normalized);
      if (!activeThreadId) {
        setDraftComposerSelection(normalized);
        draftComposerSelectionWorkspaceIdRef.current = activeWorkspaceId ?? null;
        shouldApplyDraftToNextThreadRef.current = Boolean(normalized);
        return;
      }
      shouldApplyDraftToNextThreadRef.current = false;
      persistComposerSelectionForThread(activeWorkspaceId, activeThreadId, normalized);
    },
    [activeThreadId, activeWorkspaceId, persistComposerSelectionForThread],
  );

  const resolveComposerSelectionForThread = useCallback(
    (workspaceId: string | null, threadId: string | null): ComposerSessionSelection | null => {
      const sessionKey = resolveSelectedComposerSessionKey(workspaceId, threadId);
      if (!sessionKey) {
        return null;
      }
      if (Object.prototype.hasOwnProperty.call(selectedComposerSelectionBySessionKey, sessionKey)) {
        return selectedComposerSelectionBySessionKey[sessionKey] ?? null;
      }
      return readStoredThreadComposerSelectionEntryBySessionKey(sessionKey).value;
    },
    [resolveSelectedComposerSessionKey, selectedComposerSelectionBySessionKey],
  );

  const reloadSelectedComposerSelection = useCallback(() => {
    if (!activeThreadId) {
      const draftForActiveWorkspace =
        draftComposerSelectionWorkspaceIdRef.current === (activeWorkspaceId ?? null)
          ? draftComposerSelection
          : null;
      selectedComposerSelectionRef.current = draftForActiveWorkspace;
      setSelectedComposerSelection(draftForActiveWorkspace);
      return;
    }

    const sessionKey = resolveSelectedComposerSessionKey(activeWorkspaceId, activeThreadId);
    if (!sessionKey) {
      selectedComposerSelectionRef.current = null;
      setSelectedComposerSelection(null);
      return;
    }

    let candidate: ComposerSessionSelection | null = null;
    let hasCandidate = false;
    if (Object.prototype.hasOwnProperty.call(selectedComposerSelectionBySessionKey, sessionKey)) {
      candidate = selectedComposerSelectionBySessionKey[sessionKey] ?? null;
      hasCandidate = true;
    } else {
      const stored = readStoredThreadComposerSelectionEntryBySessionKey(sessionKey);
      candidate = stored.value;
      hasCandidate = stored.exists;
      const shouldApplyDraftSelection =
        draftComposerSelectionWorkspaceIdRef.current === (activeWorkspaceId ?? null) &&
        shouldApplyDraftComposerSelectionToThread({
          candidate,
          shouldApplyDraftToNextThread: shouldApplyDraftToNextThreadRef.current,
          draftComposerSelection,
          activeThreadId,
        });
      if (shouldApplyDraftSelection) {
        candidate = draftComposerSelection;
        hasCandidate = true;
        shouldApplyDraftToNextThreadRef.current = false;
        writeClientStoreValue("composer", sessionKey, candidate);
      }
      if (hasCandidate) {
        setSelectedComposerSelectionBySessionKey((prev) => ({
          ...prev,
          [sessionKey]: candidate ?? null,
        }));
      }
    }

    selectedComposerSelectionRef.current = candidate;
    setSelectedComposerSelection(candidate);
  }, [
    activeThreadId,
    activeWorkspaceId,
    draftComposerSelection,
    resolveSelectedComposerSessionKey,
    selectedComposerSelectionBySessionKey,
  ]);

  const previousThreadIdForDraftCarryRef = useRef<string | null>(activeThreadId ?? null);
  useEffect(() => {
    const previousThreadId = previousThreadIdForDraftCarryRef.current;
    if (previousThreadId && !activeThreadId) {
      const latestSelection = selectedComposerSelectionRef.current;
      setDraftComposerSelection(latestSelection ?? null);
      draftComposerSelectionWorkspaceIdRef.current = activeWorkspaceId ?? null;
      shouldApplyDraftToNextThreadRef.current = Boolean(latestSelection);
    }
    previousThreadIdForDraftCarryRef.current = activeThreadId ?? null;
  }, [activeThreadId, activeWorkspaceId]);

  const previousThreadIdRef = useRef<string | null>(null);
  const previousThreadWorkspaceIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previousThreadId = previousThreadIdRef.current;
    const previousWorkspaceId = previousThreadWorkspaceIdRef.current;
    const previousSelectedComposerSessionKey = resolveSelectedComposerSessionKey(
      previousWorkspaceId,
      previousThreadId,
    );
    const activeSelectedComposerSessionKey = resolveSelectedComposerSessionKey(
      activeWorkspaceId,
      activeThreadId,
    );
    const previousSelectedComposerFromMemory =
      previousSelectedComposerSessionKey &&
      Object.prototype.hasOwnProperty.call(
        selectedComposerSelectionBySessionKey,
        previousSelectedComposerSessionKey,
      )
        ? selectedComposerSelectionBySessionKey[previousSelectedComposerSessionKey] ?? null
        : null;
    const activeSelectedComposerFromMemory =
      activeSelectedComposerSessionKey &&
      Object.prototype.hasOwnProperty.call(
        selectedComposerSelectionBySessionKey,
        activeSelectedComposerSessionKey,
      )
        ? selectedComposerSelectionBySessionKey[activeSelectedComposerSessionKey] ?? null
        : null;
    const previousSelectedComposerFromStore = previousSelectedComposerSessionKey
      ? readStoredThreadComposerSelectionEntryBySessionKey(previousSelectedComposerSessionKey)
          .value
      : null;
    const activeSelectedComposerFromStore = activeSelectedComposerSessionKey
      ? readStoredThreadComposerSelectionEntryBySessionKey(activeSelectedComposerSessionKey).value
      : null;
    const previousSelectedComposerValue =
      previousSelectedComposerFromMemory ?? previousSelectedComposerFromStore;
    const activeSelectedComposerValue =
      activeSelectedComposerFromMemory ?? activeSelectedComposerFromStore;
    const shouldMigrateComposerSelection =
      shouldMigrateComposerSelectionBetweenThreadIds({
        previousThreadId,
        activeThreadId,
        previousSessionKey: previousSelectedComposerSessionKey,
        activeSessionKey: activeSelectedComposerSessionKey,
        hasSourceSelection: Boolean(previousSelectedComposerValue),
        hasTargetSelection: Boolean(activeSelectedComposerValue),
        resolveCanonicalThreadId,
      });
    if (
      shouldMigrateComposerSelection &&
      previousSelectedComposerSessionKey &&
      activeSelectedComposerSessionKey
    ) {
      const migratedSelection = previousSelectedComposerValue;
      writeSelectionForSessionKey(activeSelectedComposerSessionKey, migratedSelection);
    }
    previousThreadIdRef.current = activeThreadId ?? null;
    previousThreadWorkspaceIdRef.current = activeWorkspaceId ?? null;
  }, [
    activeThreadId,
    activeWorkspaceId,
    resolveCanonicalThreadId,
    resolveSelectedComposerSessionKey,
    selectedComposerSelectionBySessionKey,
    writeSelectionForSessionKey,
  ]);

  useLayoutEffect(() => {
    reloadSelectedComposerSelection();
  }, [reloadSelectedComposerSelection]);

  return {
    selectedComposerSelection,
    selectedComposerSelectionRef,
    handleSelectComposerSelection,
    persistComposerSelectionForThread,
    reloadSelectedComposerSelection,
    resolveComposerSelectionForThread,
  };
}
