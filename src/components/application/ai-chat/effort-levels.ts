export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

/** The six effort stops, in slider order (Codex Astra catalog order). */
export const EFFORT_LEVELS: readonly EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

/** i18n label key per effort stop. */
export const EFFORT_LABEL_KEYS: Record<EffortLevel, string> = {
  low: "chat.effortLow",
  medium: "chat.effortMedium",
  high: "chat.effortHigh",
  xhigh: "chat.effortXhigh",
  max: "chat.effortMax",
  ultra: "chat.effortUltra",
};

/** Engines known to support reasoning effort configuration (all supported engines). */
export const EFFORT_SUPPORTED_ENGINES: Record<string, true> = {
  claude: true,
  codex: true,
  omp: true,
  pi: true,
  agy: true,
  qoder: true,
  "qoder-cn": true,
  grok: true,
  opencode: true,
  kimi: true,
  dsh: true,
  minimax: true,
};

export function supportsEffort(
  engineId: string,
  engines?: { id: string; supportsEffort?: boolean }[],
): boolean {
  const found = engines?.find((e) => e.id === engineId);
  if (found && typeof found.supportsEffort === "boolean") {
    return found.supportsEffort;
  }
  return Boolean(EFFORT_SUPPORTED_ENGINES[engineId] ?? true);
}
