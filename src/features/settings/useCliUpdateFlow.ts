import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeTauriEvent } from "@/hooks/use-tauri-event";
import { listenCliUpdateProgress } from "@/lib/events";
import { ipc, type CliUpdatePlan } from "@/lib/ipc";
import { launchCliInstallInTerminal } from "./cliInstallTerminal";
import type { EngineId } from "./providers";
import { useCliVersionStatus } from "./useCliVersionStatus";

/**
 * One-click CLI install/update flow behind the confirm dialog:
 * idle → planning → ready → running → done | error. `begin` asks the
 * backend for the exact execution plan (command preview + manual
 * fallback); `confirm` stamps a runId, subscribes to the streamed
 * `cli://update-progress` events for that run, and drives the shared
 * version store's update (which keeps the header pill on 更新中… and
 * re-probes the version afterwards).
 *
 * Official installer scripts (`plan.terminalCommand`) take the other
 * branch: ready → terminal. The line is typed into the built-in terminal and
 * the version store follows that tab to completion, so the dialog may close
 * while the installer keeps running where the user can see it.
 *
 * The listener only exists while a run is active — idle settings pages
 * pay nothing.
 */

export type CliUpdateFlowStatus =
  | "idle"
  | "planning"
  | "ready"
  /** Opening the terminal tab (up to ~7s): the confirm button stays off. */
  | "launching"
  | "running"
  | "terminal"
  | "done"
  | "error";

/** Why a terminal launch did not start (rendered from i18n by the dialog). */
export type CliUpdateNotice = "no-workspace" | "terminal-unavailable";

export interface CliUpdateLogLine {
  stream: "stdout" | "stderr";
  text: string;
}

/** Older lines are dropped so a chatty installer can't grow memory. */
const MAX_LOG_LINES = 200;

export interface CliUpdateFlowState {
  status: CliUpdateFlowStatus;
  plan: CliUpdatePlan | null;
  error: string | null;
  notice: CliUpdateNotice | null;
  runId: string | null;
  logs: CliUpdateLogLine[];
}

const IDLE: CliUpdateFlowState = {
  status: "idle",
  plan: null,
  error: null,
  notice: null,
  runId: null,
  logs: [],
};

export interface CliUpdateFlow {
  state: CliUpdateFlowState;
  /** Open the dialog and fetch the execution plan. */
  begin: () => Promise<void>;
  /** Run the planned command, streaming output into the dialog. */
  confirm: () => Promise<void>;
  /** Close the dialog (a no-op while a run is active). */
  close: () => void;
}

export function useCliUpdateFlow(
  engine: EngineId,
  callbacks?: { onSuccess?: () => void; onError?: (message: string) => void },
): CliUpdateFlow {
  const { update, watchTerminal } = useCliVersionStatus(engine);
  const [state, setState] = useState<CliUpdateFlowState>(IDLE);
  const callbacksRef = useRef(callbacks);
  /** One terminal launch at a time: a second click must not type the
   *  installer into a second tab. A ref, not state: the click handler's
   *  closure would still see the old status. */
  const launchingRef = useRef(false);
  /** Bumped by close/begin: a launch that settles afterwards must not
   *  reopen a dialog the user dismissed. */
  const generationRef = useRef(0);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  // Subscribe only for the duration of a run; events carry the runId, so a
  // stale/other-engine run can never leak lines into this dialog.
  const running = state.status === "running";
  useEffect(() => {
    if (!running) return;
    // subscribeTauriEvent also covers the race where this teardown runs
    // before the listen promise resolves (late unlistener fires at once).
    return subscribeTauriEvent(() =>
      listenCliUpdateProgress((events) => {
        setState((cur) => {
          if (cur.runId === null) return cur;
          let logs = cur.logs;
          for (const event of events) {
            if (event.runId !== cur.runId) continue;
            if (event.phase === "stdout" || event.phase === "stderr") {
              logs = [...logs, { stream: event.phase, text: event.line ?? "" }];
            }
          }
          if (logs === cur.logs) return cur;
          if (logs.length > MAX_LOG_LINES) logs = logs.slice(-MAX_LOG_LINES);
          return { ...cur, logs };
        });
      }),
    );
  }, [running]);

  const begin = useCallback(async () => {
    generationRef.current += 1;
    setState({ ...IDLE, status: "planning" });
    try {
      const plan = await ipc.cliUpdatePlan(engine);
      setState({ ...IDLE, status: "ready", plan });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ ...IDLE, status: "error", error: message });
      callbacksRef.current?.onError?.(message);
    }
  }, [engine]);

  const confirm = useCallback(async () => {
    const terminalCommand = state.plan?.terminalCommand;
    if (terminalCommand) {
      if (launchingRef.current) return;
      launchingRef.current = true;
      const generation = generationRef.current;
      setState((cur) => ({ ...cur, status: "launching", error: null, notice: null }));
      try {
        const launch = await launchCliInstallInTerminal(terminalCommand);
        // The installer runs in its tab either way: follow it to completion
        // even if the dialog was closed meanwhile.
        if (launch.ok) watchTerminal(launch.terminalId);
        if (generation !== generationRef.current) return;
        if (!launch.ok) {
          setState((cur) => ({ ...cur, status: "error", notice: launch.reason }));
          return;
        }
        setState((cur) => ({ ...cur, status: "terminal" }));
      } finally {
        launchingRef.current = false;
      }
      return;
    }
    const runId = `${engine}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setState((cur) => ({ ...cur, status: "running", runId, logs: [], error: null, notice: null }));
    try {
      await update(runId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState((cur) => (cur.runId === runId ? { ...cur, status: "error", error: message } : cur));
      callbacksRef.current?.onError?.(message);
      return;
    }
    setState((cur) => (cur.runId === runId ? { ...cur, status: "done" } : cur));
    callbacksRef.current?.onSuccess?.();
  }, [engine, update, watchTerminal, state.plan]);

  const close = useCallback(() => {
    // Only terminal launches read the generation; an in-app npm run keeps
    // its dialog (closing is a no-op while it runs).
    generationRef.current += 1;
    setState((cur) => (cur.status === "running" ? cur : IDLE));
  }, []);

  return { state, begin, confirm, close };
}
