import { parseUsage } from "../usage";

type UsagePartKind = "input" | "output" | "cacheRead" | "cacheWrite" | "total";

export const USAGE_PART_LABEL_KEYS: Record<UsagePartKind, string> = {
  input: "chat.usageInput",
  output: "chat.usageOutput",
  cacheRead: "chat.usageCacheRead",
  cacheWrite: "chat.usageCacheWrite",
  total: "chat.usageTokens",
};

export interface UsageBreakdown {
  /** Exact occupancy for threshold decisions; round only at display time. */
  pct: number;
  parts: { kind: UsagePartKind; tokens: number }[];
}

export function usageBreakdown(usage: unknown, maxTokens: number): UsageBreakdown | null {
  const u = parseUsage(usage);
  if (!u) return null;
  const parts = [
    { kind: "input" as const, tokens: u.input },
    { kind: "output" as const, tokens: u.output },
    { kind: "cacheRead" as const, tokens: u.cacheRead },
    { kind: "cacheWrite" as const, tokens: u.cacheWrite },
  ].filter((p) => p.tokens > 0);
  return {
    // Clamp at 0 as well: a malformed payload with negative tokens must not
    // produce a negative percentage. The dynamic context window is resolved
    // upstream in ChatConversation (contextMax), keeping a single source.
    pct: Math.max(0, Math.min(100, (u.total * 100) / maxTokens)),
    parts: parts.length ? parts : [{ kind: "total", tokens: u.total }],
  };
}
