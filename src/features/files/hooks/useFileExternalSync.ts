import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { subscribeDetachedExternalFileChanges } from "../../../services/events";
import { readWorkspaceFile } from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import {
  reduceExternalChangeSyncState,
  type ExternalChangeSyncState,
} from "../externalChangeStateMachine";
import { normalizeComparablePath } from "../../../utils/workspacePaths";

const EXTERNAL_CHANGE_NOTICE_MS = 3_200;
const EXTERNAL_CHANGE_ERROR_TOAST_THRESHOLD = 3;
const EXTERNAL_CHANGE_ERROR_TOAST_COOLDOWN_MS = 30_000;
const MISSING_FILE_ERROR_PATTERN =
  /no such file or directory|os error 2|enoent|cannot find the file|cannot find the path|path not found|the system cannot find the file specified|the system cannot find the path specified|系统找不到指定的路径/i;
const WINDOWS_PATH_NOT_FOUND_ERROR_PATTERN =
  /os error 3/i;
const WINDOWS_PATH_NOT_FOUND_TEXT_PATTERN =
  /cannot find the path|path not found|the system cannot find the path specified|系统找不到指定的路径/i;

export type ExternalChangeConflict = {
  diskContent: string;
  diskTruncated: boolean;
  updateCount: number;
  detectedAt: number;
};

type UseFileExternalSyncArgs = {
  filePath: string;
  workspaceId: string;
  workspaceRelativeFilePath: string;
  fileReadTargetDomain: "workspace" | "external-spec" | "external-absolute" | "invalid";
  externalChangeMonitoringEnabled: boolean;
  externalChangeTransportMode: "watcher" | "polling";
  externalChangePollIntervalMs: number;
  isBinary: boolean;
  isLoading: boolean;
  caseInsensitivePathCompare: boolean;
  setContent: (value: string) => void;
  setTruncated: (value: boolean) => void;
  savedContentRef: MutableRefObject<string>;
  latestIsDirtyRef: MutableRefObject<boolean>;
  externalDiskSnapshotRef: MutableRefObject<{ content: string; truncated: boolean } | null>;
  autoSyncedMessage: string;
};

function isMissingFileErrorMessage(message: string) {
  return (
    MISSING_FILE_ERROR_PATTERN.test(message) ||
    (
      WINDOWS_PATH_NOT_FOUND_ERROR_PATTERN.test(message) &&
      WINDOWS_PATH_NOT_FOUND_TEXT_PATTERN.test(message)
    )
  );
}

function errorMessageFromUnknown(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  return fallback;
}

export function useFileExternalSync({
  filePath,
  workspaceId,
  workspaceRelativeFilePath,
  fileReadTargetDomain,
  externalChangeMonitoringEnabled,
  externalChangeTransportMode,
  externalChangePollIntervalMs,
  isBinary,
  isLoading,
  caseInsensitivePathCompare,
  setContent,
  setTruncated,
  savedContentRef,
  latestIsDirtyRef,
  externalDiskSnapshotRef,
  autoSyncedMessage,
}: UseFileExternalSyncArgs) {
  const [externalChangeConflict, setExternalChangeConflict] =
    useState<ExternalChangeConflict | null>(null);
  const [externalCompareOpen, setExternalCompareOpen] = useState(false);
  const [externalAutoSyncAt, setExternalAutoSyncAt] = useState<number | null>(null);
  const [externalChangeSyncState, setExternalChangeSyncState] =
    useState<ExternalChangeSyncState>("in-sync");
  const externalPollInFlightRef = useRef(false);
  const externalPollErrorCountRef = useRef(0);
  const externalPollLastToastAtRef = useRef(0);
  const watcherRefreshQueuedRef = useRef(false);
  const fileVersionRef = useRef(0);

  useEffect(() => {
    fileVersionRef.current += 1;
    externalPollInFlightRef.current = false;
    watcherRefreshQueuedRef.current = false;
    externalPollErrorCountRef.current = 0;
    setExternalChangeConflict(null);
    setExternalCompareOpen(false);
    setExternalAutoSyncAt(null);
    setExternalChangeSyncState((current) =>
      reduceExternalChangeSyncState(current, { type: "file-loaded" }),
    );
  }, [filePath]);

  useEffect(() => {
    if (!externalAutoSyncAt) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setExternalAutoSyncAt(null);
      setExternalChangeSyncState((current) =>
        reduceExternalChangeSyncState(current, { type: "notice-cleared" }),
      );
    }, EXTERNAL_CHANGE_NOTICE_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [externalAutoSyncAt]);

  const applyExternalDiskSnapshot = useCallback(
    (
      nextContent: string,
      nextTruncated: boolean,
      source: "polling" | "watcher" | string,
      eventKind: string,
    ) => {
      const previousDiskSnapshot = externalDiskSnapshotRef.current;
      const isSameAsKnownDisk =
        previousDiskSnapshot?.content === nextContent &&
        previousDiskSnapshot?.truncated === nextTruncated;
      if (isSameAsKnownDisk) {
        return;
      }

      externalDiskSnapshotRef.current = {
        content: nextContent,
        truncated: nextTruncated,
      };
      if (latestIsDirtyRef.current) {
        setExternalChangeSyncState((current) =>
          reduceExternalChangeSyncState(current, { type: "external-change-detected-dirty" }),
        );
        setExternalChangeConflict((current) => {
          if (
            current &&
            current.diskContent === nextContent &&
            current.diskTruncated === nextTruncated
          ) {
            return current;
          }
          return {
            diskContent: nextContent,
            diskTruncated: nextTruncated,
            updateCount: Math.min(99, (current?.updateCount ?? 0) + 1),
            detectedAt: Date.now(),
          };
        });
        return;
      }

      setContent(nextContent);
      savedContentRef.current = nextContent;
      setTruncated(nextTruncated);
      setExternalCompareOpen(false);
      setExternalChangeConflict(null);
      setExternalAutoSyncAt(Date.now());
      setExternalChangeSyncState((current) =>
        reduceExternalChangeSyncState(
          reduceExternalChangeSyncState(current, { type: "external-change-detected-clean" }),
          { type: "refresh-applied" },
        ),
      );
      if (source === "polling" && eventKind === "watcher-fallback") {
        pushErrorToast({
          title: "External file monitor fallback",
          message: autoSyncedMessage,
        });
      }
    },
    [
      autoSyncedMessage,
      externalDiskSnapshotRef,
      latestIsDirtyRef,
      savedContentRef,
      setContent,
      setTruncated,
    ],
  );

  const refreshFromDisk = useCallback(
    async (source: "polling" | "watcher" | string, eventKind: string) => {
      const requestedFileVersion = fileVersionRef.current;
      if (externalPollInFlightRef.current) {
        watcherRefreshQueuedRef.current = true;
        return;
      }
      externalPollInFlightRef.current = true;
      try {
        const response = await readWorkspaceFile(workspaceId, workspaceRelativeFilePath);
        if (requestedFileVersion !== fileVersionRef.current) {
          return;
        }
        externalPollErrorCountRef.current = 0;
        const nextContent = response.content ?? "";
        const nextTruncated = Boolean(response.truncated);
        applyExternalDiskSnapshot(nextContent, nextTruncated, source, eventKind);
      } catch (pollError) {
        if (requestedFileVersion !== fileVersionRef.current) {
          return;
        }
        const message = errorMessageFromUnknown(
          pollError,
          "Unable to refresh file from disk.",
        );
        const isMissingFileError = isMissingFileErrorMessage(message);
        const isTransientFsError =
          /permission denied|resource busy|sharing violation|used by another process/i.test(
            message,
          );
        if (isMissingFileError) {
          externalPollErrorCountRef.current = 0;
          return;
        }
        if (!isTransientFsError) {
          externalPollErrorCountRef.current += 1;
          const now = Date.now();
          const shouldNotify =
            externalPollErrorCountRef.current >= EXTERNAL_CHANGE_ERROR_TOAST_THRESHOLD &&
            now - externalPollLastToastAtRef.current >=
              EXTERNAL_CHANGE_ERROR_TOAST_COOLDOWN_MS;
          if (shouldNotify) {
            externalPollLastToastAtRef.current = now;
            externalPollErrorCountRef.current = 0;
            pushErrorToast({
              title: "External file monitor is unavailable",
              message,
            });
          }
        }
      } finally {
        const shouldReleasePollingSlot = requestedFileVersion === fileVersionRef.current;
        if (shouldReleasePollingSlot) {
          externalPollInFlightRef.current = false;
          if (watcherRefreshQueuedRef.current) {
            watcherRefreshQueuedRef.current = false;
            void refreshFromDisk(source, eventKind);
          }
        }
      }
    },
    [applyExternalDiskSnapshot, workspaceId, workspaceRelativeFilePath],
  );

  useEffect(() => {
    if (
      !externalChangeMonitoringEnabled ||
      externalChangeTransportMode !== "polling" ||
      fileReadTargetDomain !== "workspace" ||
      isBinary ||
      isLoading
    ) {
      return;
    }

    let cancelled = false;
    let timeoutId = 0;
    externalPollErrorCountRef.current = 0;

    const scheduleNext = () => {
      if (cancelled) {
        return;
      }
      timeoutId = window.setTimeout(() => {
        void refreshFromDisk("polling", "polling-tick").finally(() => {
          scheduleNext();
        });
      }, externalChangePollIntervalMs);
    };

    scheduleNext();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    externalChangeMonitoringEnabled,
    externalChangePollIntervalMs,
    externalChangeTransportMode,
    fileReadTargetDomain,
    isBinary,
    isLoading,
    refreshFromDisk,
  ]);

  useEffect(() => {
    if (
      !externalChangeMonitoringEnabled ||
      externalChangeTransportMode !== "watcher" ||
      fileReadTargetDomain !== "workspace" ||
      isBinary ||
      isLoading
    ) {
      return;
    }

    void refreshFromDisk("watcher", "watcher-startup-sync");
    return subscribeDetachedExternalFileChanges((event) => {
      if (event.workspaceId !== workspaceId) {
        return;
      }
      const samePath =
        normalizeComparablePath(event.normalizedPath, caseInsensitivePathCompare) ===
        normalizeComparablePath(workspaceRelativeFilePath, caseInsensitivePathCompare);
      if (!samePath) {
        return;
      }
      void refreshFromDisk(event.source, event.eventKind || "watcher-event");
    });
  }, [
    caseInsensitivePathCompare,
    externalChangeMonitoringEnabled,
    externalChangeTransportMode,
    fileReadTargetDomain,
    isBinary,
    isLoading,
    refreshFromDisk,
    workspaceId,
    workspaceRelativeFilePath,
  ]);

  const handleExternalReloadFromDisk = useCallback(() => {
    if (!externalChangeConflict) {
      return;
    }
    setContent(externalChangeConflict.diskContent);
    savedContentRef.current = externalChangeConflict.diskContent;
    setTruncated(externalChangeConflict.diskTruncated);
    externalDiskSnapshotRef.current = {
      content: externalChangeConflict.diskContent,
      truncated: externalChangeConflict.diskTruncated,
    };
    setExternalCompareOpen(false);
    setExternalChangeConflict(null);
    setExternalAutoSyncAt(Date.now());
    setExternalChangeSyncState((current) =>
      reduceExternalChangeSyncState(current, { type: "conflict-reload" }),
    );
  }, [externalChangeConflict, externalDiskSnapshotRef, savedContentRef, setContent, setTruncated]);

  const handleExternalKeepLocal = useCallback(() => {
    setExternalCompareOpen(false);
    setExternalChangeConflict(null);
    setExternalChangeSyncState((current) =>
      reduceExternalChangeSyncState(current, { type: "conflict-keep-local" }),
    );
  }, []);

  const handleExternalToggleCompare = useCallback(() => {
    setExternalCompareOpen((current) => !current);
  }, []);

  return {
    externalChangeConflict,
    externalCompareOpen,
    externalAutoSyncAt,
    externalChangeSyncState,
    handleExternalReloadFromDisk,
    handleExternalKeepLocal,
    handleExternalToggleCompare,
    setExternalChangeSyncState,
    setExternalChangeConflict,
    setExternalCompareOpen,
    setExternalAutoSyncAt,
  };
}
