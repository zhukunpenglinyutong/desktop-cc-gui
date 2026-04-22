import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RuntimePoolRow, RuntimePoolSnapshot } from "../../../types";
import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";
import {
  clearGlobalRuntimeNotices,
  pushGlobalRuntimeNotice,
  subscribeGlobalRuntimeNotices,
  type GlobalRuntimeNotice,
  type GlobalRuntimeNoticeSeverity,
} from "../../../services/globalRuntimeNotices";
import { getRuntimePoolSnapshot } from "../../../services/tauri";

const GLOBAL_RUNTIME_NOTICE_DOCK_VISIBILITY_KEY = "globalRuntimeNoticeDock.visibility";
const GLOBAL_RUNTIME_NOTICE_STREAMING_WINDOW_MS = 8000;
const GLOBAL_RUNTIME_NOTICE_RUNTIME_POLL_MS = 5000;

export type GlobalRuntimeNoticeDockVisibility = "minimized" | "expanded";
export type GlobalRuntimeNoticeDockStatus = "idle" | "streaming" | "has-error";

type RuntimeSignalToken =
  | "startup-pending"
  | "resume-pending"
  | "ready"
  | "suspect-stale"
  | "cooldown"
  | "quarantined"
  | null;

function resolveWorkspaceLabel(
  row: Pick<RuntimePoolRow, "workspaceId" | "workspaceName" | "workspacePath">,
) {
  const trimmedName = row.workspaceName.trim();
  if (trimmedName.length > 0) {
    return trimmedName;
  }
  const trimmedPath = row.workspacePath.trim();
  const segments = trimmedPath
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? (trimmedPath || row.workspaceId.trim());
}

function resolveRuntimeEngineLabel(engine: string) {
  switch (engine.trim().toLowerCase()) {
    case "claude":
      return "Claude Code";
    case "gemini":
      return "Gemini";
    case "opencode":
      return "OpenCode";
    case "codex":
      return "Codex";
    default:
      return engine.trim() || "Runtime";
  }
}

function resolveRuntimeSignalToken(row: RuntimePoolRow): RuntimeSignalToken {
  if (row.foregroundWorkState === "startup-pending") {
    return "startup-pending";
  }
  if (row.foregroundWorkState === "resume-pending") {
    return "resume-pending";
  }
  if (row.startupState === "starting") {
    return "startup-pending";
  }
  if (
    row.startupState === "ready" ||
    row.startupState === "suspect-stale" ||
    row.startupState === "cooldown" ||
    row.startupState === "quarantined"
  ) {
    return row.startupState;
  }
  return null;
}

function shouldPushRuntimeSignal(
  previousToken: RuntimeSignalToken,
  nextToken: RuntimeSignalToken,
) {
  if (!nextToken) {
    return false;
  }
  if (!previousToken) {
    return true;
  }
  if (nextToken === "ready") {
    return previousToken !== "ready";
  }
  return previousToken !== nextToken;
}

function resolveRuntimeSignalPayload(
  token: Exclude<RuntimeSignalToken, null>,
): {
  severity: GlobalRuntimeNoticeSeverity;
  messageKey: string;
} {
  switch (token) {
    case "startup-pending":
      return {
        severity: "info",
        messageKey: "runtimeNotice.runtime.startupPending",
      };
    case "resume-pending":
      return {
        severity: "warning",
        messageKey: "runtimeNotice.runtime.resumePending",
      };
    case "ready":
      return {
        severity: "info",
        messageKey: "runtimeNotice.runtime.ready",
      };
    case "suspect-stale":
      return {
        severity: "warning",
        messageKey: "runtimeNotice.runtime.suspectStale",
      };
    case "cooldown":
      return {
        severity: "warning",
        messageKey: "runtimeNotice.runtime.cooldown",
      };
    case "quarantined":
      return {
        severity: "error",
        messageKey: "runtimeNotice.runtime.quarantined",
      };
  }
}

function reconcileRuntimeSnapshot(
  snapshot: RuntimePoolSnapshot,
  previousStateByWorkspace: Map<string, RuntimeSignalToken>,
) {
  const nextStateByWorkspace = new Map<string, RuntimeSignalToken>();

  for (const row of snapshot.rows) {
    const nextToken = resolveRuntimeSignalToken(row);
    const previousToken = previousStateByWorkspace.get(row.workspaceId) ?? null;
    if (nextToken) {
      nextStateByWorkspace.set(row.workspaceId, nextToken);
    }
    if (!shouldPushRuntimeSignal(previousToken, nextToken)) {
      continue;
    }
    if (!nextToken) {
      continue;
    }
    const signal = resolveRuntimeSignalPayload(nextToken);
    pushGlobalRuntimeNotice({
      severity: signal.severity,
      category: "runtime",
      messageKey: signal.messageKey,
      messageParams: {
        workspace: resolveWorkspaceLabel(row),
        engine: resolveRuntimeEngineLabel(row.engine),
      },
      dedupeKey: `runtime:${row.workspaceId}:${nextToken}`,
    });
  }

  return nextStateByWorkspace;
}

export function sanitizeGlobalRuntimeNoticeDockVisibility(
  value: unknown,
): GlobalRuntimeNoticeDockVisibility {
  return value === "expanded" ? "expanded" : "minimized";
}

export function resolveGlobalRuntimeNoticeDockStatus(
  notices: readonly GlobalRuntimeNotice[],
  nowMs: number,
): GlobalRuntimeNoticeDockStatus {
  if (notices.some((notice) => notice.severity === "error")) {
    return "has-error";
  }
  const latestNotice = notices[notices.length - 1];
  if (!latestNotice) {
    return "idle";
  }
  return nowMs - latestNotice.timestampMs <= GLOBAL_RUNTIME_NOTICE_STREAMING_WINDOW_MS
    ? "streaming"
    : "idle";
}

export function useGlobalRuntimeNoticeDock() {
  const [notices, setNotices] = useState<GlobalRuntimeNotice[]>([]);
  const [visibility, setVisibility] = useState<GlobalRuntimeNoticeDockVisibility>(() =>
    sanitizeGlobalRuntimeNoticeDockVisibility(
      getClientStoreSync("app", GLOBAL_RUNTIME_NOTICE_DOCK_VISIBILITY_KEY),
    ),
  );
  const [statusNowMs, setStatusNowMs] = useState(() => Date.now());
  const runtimeStateByWorkspaceRef = useRef(new Map<string, RuntimeSignalToken>());

  useEffect(() => {
    return subscribeGlobalRuntimeNotices((snapshot) => {
      setNotices([...snapshot]);
    });
  }, []);

  useEffect(() => {
    writeClientStoreValue("app", GLOBAL_RUNTIME_NOTICE_DOCK_VISIBILITY_KEY, visibility);
  }, [visibility]);

  useEffect(() => {
    const latestNotice = notices[notices.length - 1];
    if (!latestNotice || notices.some((notice) => notice.severity === "error")) {
      return;
    }
    const remainingMs =
      latestNotice.timestampMs + GLOBAL_RUNTIME_NOTICE_STREAMING_WINDOW_MS - Date.now();
    if (remainingMs <= 0) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setStatusNowMs(Date.now());
    }, remainingMs + 16);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notices]);

  useEffect(() => {
    let disposed = false;

    const loadRuntimeSnapshot = async () => {
      try {
        const snapshot = await getRuntimePoolSnapshot();
        if (disposed) {
          return;
        }
        runtimeStateByWorkspaceRef.current = reconcileRuntimeSnapshot(
          snapshot,
          runtimeStateByWorkspaceRef.current,
        );
      } catch (error) {
        if (!disposed) {
          console.error("[runtimeNoticeDock] failed to load runtime snapshot", error);
        }
      }
    };

    void loadRuntimeSnapshot();
    const intervalId = window.setInterval(() => {
      void loadRuntimeSnapshot();
    }, GLOBAL_RUNTIME_NOTICE_RUNTIME_POLL_MS);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const status = useMemo(
    () => resolveGlobalRuntimeNoticeDockStatus(notices, statusNowMs),
    [notices, statusNowMs],
  );

  const expand = useCallback(() => {
    setVisibility("expanded");
  }, []);

  const minimize = useCallback(() => {
    setVisibility("minimized");
  }, []);

  const clear = useCallback(() => {
    clearGlobalRuntimeNotices();
  }, []);

  return {
    notices,
    visibility,
    status,
    expand,
    minimize,
    clear,
  };
}
