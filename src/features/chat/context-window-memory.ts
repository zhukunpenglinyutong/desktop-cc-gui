/**
 * Cross-session memory for the context gauge's denominator.
 *
 * A model's real window only ever arrives with an engine report — for claude
 * that is the `modelUsage` map on a turn's result line — so a brand-new
 * session has nothing to show and the gauge falls back to the 200k guess
 * until its first turn ends. Remembering the last reported window per
 * engine+model slot lets the next session start at the right scale.
 *
 * localStorage-backed and best effort: a missing or throwing storage just
 * means the gauge keeps its old fallback behaviour.
 */
import { ASSUMED_CONTEXT_WINDOW, reportedContextWindow } from "./usage";

const PREFIX = "ccgui.context-window";

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function cacheKey(engine: string, model: string | null | undefined): string {
  return `${PREFIX}.${engine}.${model || "default"}`;
}

/** Record the window an engine just reported for this engine+model slot. */
export function rememberContextWindow(
  engine: string,
  model: string | null | undefined,
  window: number,
): void {
  if (!engine || !(window > 0)) return;
  try {
    storage()?.setItem(cacheKey(engine, model), String(window));
  } catch {
    // Private mode / quota: the gauge just falls back to its old guess.
  }
}

/** The last window this engine+model slot reported, if any. */
export function recallContextWindow(
  engine: string,
  model: string | null | undefined,
): number | undefined {
  if (!engine) return undefined;
  try {
    const raw = storage()?.getItem(cacheKey(engine, model));
    const n = raw ? Number(raw) : 0;
    return n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/** The gauge's denominator: a live report wins, then the remembered window,
 *  then the model catalog, then the shared last-resort guess. */
export function resolveContextMax(opts: {
  usage: unknown;
  engine: string;
  model?: string | null;
  catalogWindow?: number | null;
}): number {
  return (
    reportedContextWindow(opts.usage) ||
    recallContextWindow(opts.engine, opts.model) ||
    opts.catalogWindow ||
    ASSUMED_CONTEXT_WINDOW
  );
}
