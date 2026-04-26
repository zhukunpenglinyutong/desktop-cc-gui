import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import type { DebugEntry } from "../../../types";

type UpdateStage =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "restarting"
  | "latest"
  | "error";

type UpdateProgress = {
  totalBytes?: number;
  downloadedBytes: number;
};

export type UpdateState = {
  stage: UpdateStage;
  version?: string;
  progress?: UpdateProgress;
  error?: string;
};

type UseUpdaterOptions = {
  enabled?: boolean;
  onDebug?: (entry: DebugEntry) => void;
};

type CheckForUpdatesOptions = {
  announceNoUpdate?: boolean;
  interactive?: boolean;
};

const AUTO_UPDATE_ENABLED = true;

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    const serialized = JSON.stringify(error);
    if (typeof serialized === "string" && serialized.length > 0) {
      return serialized;
    }
  } catch {
    // Fall back to String(error) for circular or host-owned objects.
  }
  return String(error);
}

export function useUpdater({ enabled = true, onDebug }: UseUpdaterOptions) {
  // Force disable auto update if the global flag is off
  const effectiveEnabled = AUTO_UPDATE_ENABLED && enabled;
  const [state, setState] = useState<UpdateState>({ stage: "idle" });
  const updateRef = useRef<Update | null>(null);
  const latestTimeoutRef = useRef<number | null>(null);
  const checkRequestIdRef = useRef(0);
  const onDebugRef = useRef(onDebug);
  const latestToastDurationMs = 2000;

  onDebugRef.current = onDebug;

  const clearLatestTimeout = useCallback(() => {
    if (latestTimeoutRef.current !== null) {
      window.clearTimeout(latestTimeoutRef.current);
      latestTimeoutRef.current = null;
    }
  }, []);

  const invalidatePendingChecks = useCallback(() => {
    checkRequestIdRef.current += 1;
  }, []);

  const closeUpdateHandle = useCallback(async (update: Update | null | undefined) => {
    try {
      await update?.close();
    } catch (error) {
      onDebugRef.current?.({
        id: `${Date.now()}-client-updater-close-error`,
        timestamp: Date.now(),
        source: "error",
        label: "updater/close-error",
        payload: describeError(error),
      });
    }
  }, []);

  const resetToIdle = useCallback(async () => {
    invalidatePendingChecks();
    clearLatestTimeout();
    const update = updateRef.current;
    updateRef.current = null;
    setState({ stage: "idle" });
    await closeUpdateHandle(update);
  }, [clearLatestTimeout, closeUpdateHandle, invalidatePendingChecks]);

  const checkForUpdates = useCallback(
    async (options?: CheckForUpdatesOptions) => {
      const requestId = checkRequestIdRef.current + 1;
      checkRequestIdRef.current = requestId;
      const isStaleRequest = () => checkRequestIdRef.current !== requestId;
      let update: Awaited<ReturnType<typeof check>> | null = null;

      try {
        clearLatestTimeout();
        setState({ stage: "checking" });
        update = await check();

        if (isStaleRequest()) {
          return;
        }

        if (!update) {
          const currentUpdate = updateRef.current;
          updateRef.current = null;
          await closeUpdateHandle(currentUpdate);

          if (options?.announceNoUpdate) {
            setState({ stage: "latest" });
            latestTimeoutRef.current = window.setTimeout(() => {
              if (checkRequestIdRef.current !== requestId) {
                return;
              }
              latestTimeoutRef.current = null;
              setState({ stage: "idle" });
            }, latestToastDurationMs);
          } else {
            setState({ stage: "idle" });
          }
          return;
        }

        const currentUpdate = updateRef.current;
        updateRef.current = update;
        if (currentUpdate && currentUpdate !== update) {
          await closeUpdateHandle(currentUpdate);
        }

        setState({
          stage: "available",
          version: update.version,
        });
      } catch (error) {
        if (isStaleRequest()) {
          return;
        }

        const message = describeError(error);
        onDebug?.({
          id: `${Date.now()}-client-updater-error`,
          timestamp: Date.now(),
          source: "error",
          label: "updater/error",
          payload: message,
        });
        setState(
          options?.interactive
            ? { stage: "error", error: message }
            : { stage: "idle" },
        );
      } finally {
        if (update && (isStaleRequest() || updateRef.current !== update)) {
          await closeUpdateHandle(update);
        }
      }
    },
    [clearLatestTimeout, closeUpdateHandle, onDebug],
  );

  const startUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) {
      await checkForUpdates({ announceNoUpdate: true, interactive: true });
      return;
    }

    setState((prev) => ({
      ...prev,
      stage: "downloading",
      progress: { totalBytes: undefined, downloadedBytes: 0 },
      error: undefined,
    }));

    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          setState((prev) => ({
            ...prev,
            progress: {
              totalBytes: event.data.contentLength,
              downloadedBytes: 0,
            },
          }));
          return;
        }

        if (event.event === "Progress") {
          setState((prev) => ({
            ...prev,
            progress: {
              totalBytes: prev.progress?.totalBytes,
              downloadedBytes:
                (prev.progress?.downloadedBytes ?? 0) + event.data.chunkLength,
            },
          }));
          return;
        }

        if (event.event === "Finished") {
          setState((prev) => ({
            ...prev,
            stage: "installing",
          }));
        }
      });

      setState((prev) => ({
        ...prev,
        stage: "restarting",
      }));
      await relaunch();
    } catch (error) {
      const message = describeError(error);
      onDebug?.({
        id: `${Date.now()}-client-updater-error`,
        timestamp: Date.now(),
        source: "error",
        label: "updater/error",
        payload: message,
      });
      setState((prev) => ({
        ...prev,
        stage: "error",
        error: message,
      }));
    }
  }, [checkForUpdates, onDebug]);

  useEffect(() => {
    if (!effectiveEnabled || import.meta.env.DEV || !isTauri()) {
      return;
    }
    void checkForUpdates();
  }, [checkForUpdates, effectiveEnabled]);

  useEffect(() => {
    return () => {
      invalidatePendingChecks();
      clearLatestTimeout();
      const update = updateRef.current;
      updateRef.current = null;
      void closeUpdateHandle(update);
    };
  }, [clearLatestTimeout, closeUpdateHandle, invalidatePendingChecks]);

  return {
    state,
    startUpdate,
    checkForUpdates,
    dismiss: resetToIdle,
  };
}
