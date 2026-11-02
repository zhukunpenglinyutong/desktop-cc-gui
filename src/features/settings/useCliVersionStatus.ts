import { useCallback, useEffect, useSyncExternalStore } from "react";
import i18n from "@/lib/i18n";
import { ipc, type CliVersionStatus } from "@/lib/ipc";
import { hasTerminalSession, terminalBacklog } from "@/features/terminal/sessions";
import { terminalInstallOutcome } from "./cliInstallMarker";
import type { EngineId } from "./providers";

/**
 * Session-local store for managed-CLI version status, one entry per engine.
 * The CLI 管理 header and the DSH host card both read it, so probes are
 * deduped: switching engine pages repaints from cache instantly and only
 * soft-refreshes in the background, and concurrent consumers share one
 * in-flight probe. No polling — refresh happens on page mount and explicit
 * user action only (each probe spawns `<bin> --version` + `npm view`).
 */

interface Entry {
  status: CliVersionStatus | null;
  /** A probe is in flight; a cached status stays visible meanwhile. */
  loading: boolean;
  error: string | null;
  updating: boolean;
  inflight: Promise<void> | null;
}

const EMPTY: Entry = {
  status: null,
  loading: false,
  error: null,
  updating: false,
  inflight: null,
};

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function patch(engine: EngineId, partial: Partial<Entry>) {
  entries.set(engine, { ...(entries.get(engine) ?? EMPTY), ...partial });
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Probe (or share the in-flight probe for) an engine's version status. */
function refresh(engine: EngineId): Promise<void> {
  const current = entries.get(engine) ?? EMPTY;
  if (current.inflight) return current.inflight;
  const task = (async () => {
    try {
      const status = await ipc.cliVersionStatus(engine);
      patch(engine, { status, loading: false, error: null });
    } catch (e) {
      patch(engine, {
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();
  patch(engine, { loading: true, inflight: task });
  return task.finally(() => patch(engine, { inflight: null }));
}

/** Install/update an engine, then re-probe so badges reflect the result.
 *  `runId` scopes the streamed `cli://update-progress` events to this run. */
async function update(engine: EngineId, runId: string): Promise<void> {
  patch(engine, { updating: true, error: null });
  try {
    await ipc.cliUpdate(engine, runId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    patch(engine, { updating: false, error: message });
    throw e;
  }
  patch(engine, { updating: false });
  await refresh(engine);
}

/** Terminal installs report through their tab's output (see
 * cliInstallTerminal.ts): poll for the completion marker. */
const TERMINAL_POLL_MS = 1000;
/** Bound the watch: an installer left sitting at a prompt must not keep a
 * timer alive for the whole session. */
const TERMINAL_WATCH_LIMIT_MS = 30 * 60 * 1000;
const terminalWatches = new Map<string, ReturnType<typeof setInterval>>();

/** Track an official installer typed into the built-in terminal: the engine
 * shows 更新中… until the line's completion marker arrives, the tab goes
 * away (closed, Ctrl+C then closed, PTY lost) or the watch times out; every
 * end re-probes the version, and a non-zero exit is surfaced as an error. */
function watchTerminal(engine: EngineId, terminalId: string): void {
  const previous = terminalWatches.get(engine);
  if (previous !== undefined) clearInterval(previous);
  patch(engine, { updating: true, error: null });
  const startedAt = Date.now();
  const finish = (error: string | null) => {
    clearInterval(timer);
    if (terminalWatches.get(engine) === timer) terminalWatches.delete(engine);
    patch(engine, { updating: false, error });
    void refresh(engine).then(() => {
      // A successful probe clears the error; keep the failed run's.
      if (error) patch(engine, { error });
    });
  };
  const timer = setInterval(() => {
    const outcome = terminalInstallOutcome(terminalBacklog(terminalId));
    if (outcome === "succeeded") return finish(null);
    if (outcome === "failed") return finish(i18n.t("settings.cliUpdateTerminalFailed"));
    if (!hasTerminalSession(terminalId) || Date.now() - startedAt > TERMINAL_WATCH_LIMIT_MS) {
      finish(null);
    }
  }, TERMINAL_POLL_MS);
  terminalWatches.set(engine, timer);
}

/** What the hook hands to components: latest probe state + actions. */
export interface CliVersionStatusView {
  status: CliVersionStatus | null;
  loading: boolean;
  error: string | null;
  updating: boolean;
  refresh: () => void;
  update: (runId: string) => Promise<void>;
  /** Follow an official installer running in a built-in terminal tab. */
  watchTerminal: (terminalId: string) => void;
}

export function useCliVersionStatus(engine: EngineId): CliVersionStatusView {
  useEffect(() => {
    void refresh(engine);
  }, [engine]);
  const entry = useSyncExternalStore(subscribe, () => entries.get(engine) ?? EMPTY);
  return {
    status: entry.status,
    loading: entry.loading,
    error: entry.error,
    updating: entry.updating,
    refresh: useCallback(() => void refresh(engine), [engine]),
    update: useCallback((runId: string) => update(engine, runId), [engine]),
    watchTerminal: useCallback(
      (terminalId: string) => watchTerminal(engine, terminalId),
      [engine],
    ),
  };
}
