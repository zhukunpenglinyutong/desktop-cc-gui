import type { RunActivitySnapshot } from "@/lib/ipc";
import { isSubagentToolLabel } from "./components/agent-task-steps";

export type {
  RetryCategory,
  RunActivitySnapshot,
  RunRetryActivity,
  RunToolActivity,
} from "@/lib/ipc";

/**
 * Run-activity panel model: the host's live facts about a running turn
 * (`run_activity` IPC, see src-tauri/src/engine/activity.rs) and the one
 * question the panel answers from them — what is the run doing right now,
 * and since when.
 *
 * The status line alone says "Responding" for every state: waiting on the
 * model's first token, a model thinking with its reasoning hidden, a local
 * build running for minutes, a provider backoff. Each needs a different
 * reaction from the user (wait / check the network / stop the command), so
 * the phase below is derived from facts, never guessed from elapsed time.
 */

export type RunPhaseKind =
  | "retrying"
  | "compacting"
  | "awaiting_user"
  | "model_thinking"
  | "model_writing"
  | "model_tool_input"
  | "model_first_output"
  | "subagents"
  | "tools"
  | "waiting_model";

export interface RunPhase {
  kind: RunPhaseKind;
  /** Host-clock ms the phase began (compare with `snapshot.nowMs`). */
  sinceMs: number;
}

/** Silence after which a phase that should be producing output is flagged.
 *  Tools, questions, backoff and compaction are legitimately silent. */
export const RUN_SILENCE_WARN_MS = 120_000;

const SILENT_OK: ReadonlySet<RunPhaseKind> = new Set([
  "retrying",
  "compacting",
  "awaiting_user",
  "subagents",
  "tools",
  // Hidden reasoning streams nothing until the block ends; the block start
  // itself is the proof the model is working.
  "model_thinking",
]);

export function deriveRunPhase(a: RunActivitySnapshot): RunPhase {
  const lastAt = a.lastEventAtMs ?? a.startedAtMs;
  if (a.retrying) {
    const last = a.retries[a.retries.length - 1];
    return { kind: "retrying", sinceMs: last?.atMs ?? lastAt };
  }
  if (a.compactingSinceMs != null) {
    return { kind: "compacting", sinceMs: a.compactingSinceMs };
  }
  if (a.awaitingUser) return { kind: "awaiting_user", sinceMs: lastAt };
  // Engine-reported content block of the open response (claude).
  if (a.block === "thinking") {
    return { kind: "model_thinking", sinceMs: a.blockSinceMs ?? lastAt };
  }
  if (a.block === "text" || a.block === "other") {
    return { kind: "model_writing", sinceMs: a.blockSinceMs ?? lastAt };
  }
  if (a.block === "tool_input") {
    return { kind: "model_tool_input", sinceMs: a.blockSinceMs ?? lastAt };
  }
  if (a.responseSinceMs != null && !a.responseHasOutput) {
    return { kind: "model_first_output", sinceMs: a.responseSinceMs };
  }
  if (a.responseSinceMs != null) {
    // Open response between blocks, or an engine without block markers.
    return {
      kind: a.lastEvent === "thinking" ? "model_thinking" : "model_writing",
      sinceMs: a.responseSinceMs,
    };
  }
  if (a.tools.length > 0) {
    const sinceMs = Math.min(...a.tools.map((tool) => tool.sinceMs));
    return {
      kind: a.tools.some((tool) => isSubagentToolLabel(tool.name)) ? "subagents" : "tools",
      sinceMs,
    };
  }
  // Engines without response markers stream deltas only: the latest one
  // says what the model is doing.
  if (a.lastEvent === "thinking") return { kind: "model_thinking", sinceMs: lastAt };
  if (a.lastEvent === "text") return { kind: "model_writing", sinceMs: lastAt };
  // Nothing open: the request (initial, after a tool result, after a retry)
  // is with the provider and no response stream has started yet.
  return { kind: "waiting_model", sinceMs: lastAt };
}

/** Ms since the CLI last said anything the host saw (raw output or a
 *  parsed event, whichever is later). */
export function runSilenceMs(a: RunActivitySnapshot): number {
  const last = Math.max(a.lastOutputAtMs ?? 0, a.lastEventAtMs ?? 0, a.startedAtMs);
  return Math.max(0, a.nowMs - last);
}

/** Whether the panel should call out the silence: a phase that should be
 *  streaming has produced nothing for a long time. */
export function isRunSilenceSuspicious(a: RunActivitySnapshot, phase = deriveRunPhase(a)): boolean {
  return !SILENT_OK.has(phase.kind) && runSilenceMs(a) >= RUN_SILENCE_WARN_MS;
}

/** The newest run among several routed to one session (a follow-up or a
 *  replacement run can briefly share the key with its predecessor). */
export function pickLatestRun(list: RunActivitySnapshot[]): RunActivitySnapshot | null {
  let latest: RunActivitySnapshot | null = null;
  for (const item of list) {
    if (!latest || item.startedAtMs > latest.startedAtMs) latest = item;
  }
  return latest;
}
