/**
 * Denominator for the context gauge when nothing real is known: neither the
 * engine's own report nor the model catalog supplied a window.
 *
 * It is a last resort, not a default. Every engine that knows its window
 * reports it — Codex through its rollout/`debug models`, Claude through the
 * `modelUsage` map on its result line — so a value here means the engine said
 * nothing, and the gauge is a guess (pi, agy and dsh today).
 */
export const ASSUMED_CONTEXT_WINDOW = 200_000;

export interface ParsedUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  /** Engine-reported window (Codex `model_context_window`). */
  contextWindow?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function num(u: Record<string, unknown>, k: string): number {
  return typeof u[k] === "number" ? (u[k] as number) : 0;
}

function reportedWindow(...sources: Array<Record<string, unknown> | null>): number | undefined {
  for (const source of sources) {
    for (const key of ["model_context_window", "context_window", "contextWindow"]) {
      const raw = source?.[key];
      const match = typeof raw === "string" ? raw.trim().match(/^(\d+(?:\.\d+)?)\s*([kKmM]?)$/) : null;
      const n = typeof raw === "number" ? raw : match
        ? Number(match[1]) * ({ k: 1000, m: 1000000 }[match[2].toLowerCase()] ?? 1) : 0;
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

/** Window metadata is useful even before any tokens have been reported. */
export function reportedContextWindow(usage: unknown): number | undefined {
  const raw = asRecord(usage);
  const info = asRecord(raw?.info);
  return reportedWindow(raw, info, asRecord(raw?.last_token_usage), asRecord(info?.last_token_usage));
}

/** Engines whose cache counters sit *inside* `input_tokens`. Codex reports
 *  `cached_input_tokens` / `cache_write_input_tokens` as parts of the prompt
 *  it bills (`total_tokens` = input + output), while Claude and the pi family
 *  report `cache_read_input_tokens` / `cacheRead` outside it. */
function cacheInsideInput(u: Record<string, unknown>): boolean {
  return typeof u.cached_input_tokens === "number";
}

/** Normalize the per-engine usage shapes (snake_case for claude/codex, bare
 * keys for pi/omp) into one token breakdown. Returns null when no tokens
 * were reported at all. */
export function parseUsage(usage: unknown): ParsedUsage | null {
  const raw = asRecord(usage);
  if (!raw) return null;
  // Codex token_count info: occupancy is last_token_usage; the sibling
  // total_token_usage is session-billed cumulative and must not fill the bar.
  const info = asRecord(raw.info) ?? raw;
  const nested = asRecord(info.last_token_usage);
  const u = nested ?? info;
  const reportedInput = num(u, "input_tokens") || num(u, "input");
  const output = num(u, "output_tokens") || num(u, "output");
  // Codex names its cache fields differently (cached_input_tokens /
  // cache_write_input_tokens): without them a codex report's cache hits land
  // in the ledger as zero.
  const cacheRead =
    num(u, "cache_read_input_tokens") || num(u, "cacheRead") || num(u, "cached_input_tokens");
  const cacheWrite =
    num(u, "cache_creation_input_tokens") ||
    num(u, "cacheWrite") ||
    num(u, "cache_write_input_tokens");
  // Fold codex's cache counters out of its input so the four parts never
  // overlap. Adding them on top inflated every total by the whole cache
  // volume (a cache-heavy codex turn counted ~3x its real prompt).
  const input = cacheInsideInput(u)
    ? Math.max(0, reportedInput - cacheRead - cacheWrite)
    : reportedInput;
  const total =
    num(u, "total_tokens") || num(u, "totalTokens") || input + output + cacheRead + cacheWrite;
  if (!total) return null;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total,
    contextWindow: reportedContextWindow(raw),
  };
}

/** Keep a previously reported context window when a later snapshot omits it. */
export function mergeUsage(next: unknown, prev: unknown): unknown {
  if (!next) return prev ?? null;
  const nextObj = asRecord(next);
  const prevObj = asRecord(prev);
  if (!nextObj || !prevObj) return next;
  if (reportedContextWindow(nextObj)) return next;
  const window = reportedContextWindow(prevObj);
  if (!window) return next;
  return { ...nextObj, model_context_window: window };
}
