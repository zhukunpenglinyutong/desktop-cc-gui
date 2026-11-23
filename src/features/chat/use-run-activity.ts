import { useEffect, useState } from "react";
import { ipc } from "@/lib/ipc";
import { runRouting } from "./store/stream";
import { pickLatestRun, type RunActivitySnapshot } from "./run-activity";

/** Poll interval while the run-activity panel is open. */
export const RUN_ACTIVITY_POLL_MS = 1000;

export interface RunActivityState {
  snapshot: RunActivitySnapshot | null;
  /** At least one poll finished (so "no snapshot" means no tracked run). */
  loaded: boolean;
  failed: boolean;
}

const IDLE: RunActivityState = { snapshot: null, loaded: false, failed: false };

/** Run ids routed to this session key right now. */
function routedRunIds(key: string): string[] {
  const ids: string[] = [];
  for (const [runId, routed] of runRouting) {
    if (routed === key) ids.push(runId);
  }
  return ids;
}

/**
 * Live run-activity snapshot for one session, polled only while `enabled`
 * (the panel is open). Every poll is a single read-only IPC call; the next
 * one is scheduled after the previous settles, so a slow host never stacks
 * requests, and closing the panel or unmounting stops the loop and drops
 * any late answer.
 */
export function useRunActivity(key: string | null, enabled: boolean): RunActivityState {
  const [state, setState] = useState<RunActivityState>(IDLE);
  useEffect(() => {
    if (!enabled || !key) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      const runIds = routedRunIds(key);
      try {
        const list = runIds.length > 0 ? await ipc.runActivity(runIds) : [];
        if (cancelled) return;
        setState({ snapshot: pickLatestRun(list), loaded: true, failed: false });
      } catch {
        if (cancelled) return;
        setState((prev) => ({ ...prev, loaded: true, failed: true }));
      }
      timer = window.setTimeout(() => void tick(), RUN_ACTIVITY_POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [key, enabled]);
  return state;
}
