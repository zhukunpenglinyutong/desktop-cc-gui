import { useCallback, useSyncExternalStore } from "react";
import { readStoredJson, writeStored } from "@/lib/storage";
import i18n from "@/lib/i18n";

export const AUTO_COMPACT_STORAGE_KEY = "ccgui-next.chat.autoCompactBySession";
const AUTO_COMPACT_CHANGED_EVENT = "ccgui-next:auto-compact-changed";
export const DEFAULT_AUTO_COMPACT_THRESHOLD = 80;

export interface AutoCompactSettings {
  enabled: boolean;
  threshold: number;
}

const DEFAULT_SETTINGS: AutoCompactSettings = Object.freeze({
  enabled: false,
  threshold: DEFAULT_AUTO_COMPACT_THRESHOLD,
});

type StoredSettings = Record<string, AutoCompactSettings>;

export function normalizeAutoCompactThreshold(value: unknown, fallback = DEFAULT_AUTO_COMPACT_THRESHOLD): number {
  const parsed =
    typeof value === "string"
      ? value.trim() === ""
        ? Number.NaN
        : Number(value)
      : typeof value === "number"
        ? value
        : Number(value);
  const safeFallback = Math.round(Math.max(1, Math.min(100, fallback)));
  if (!Number.isFinite(parsed)) return safeFallback;
  return Math.round(Math.max(1, Math.min(100, parsed)));
}

export function usesNativeAutoCompact(engine: string): boolean {
  return engine === "claude" || engine === "codex";
}

/** Integer percentages representable by this engine's native token range. */
export function autoCompactThresholdRange(engine: string, contextMax: number): { min: number; max: number } | null {
  if (!Number.isFinite(contextMax) || contextMax <= 0) return null;
  const minTokens = engine === "claude" ? 100_000 : 1;
  const maxTokens = engine === "claude" ? 1_000_000 : Number.MAX_SAFE_INTEGER;
  const min = Math.max(1, Math.ceil(minTokens / contextMax * 100));
  const max = Math.min(100, Math.floor(maxTokens / contextMax * 100));
  return min <= max ? { min, max } : null;
}

/** Undefined means no launch override. Invalid enabled settings fail visibly
 *  rather than silently falling back to a different native threshold. */
export function nativeAutoCompactThreshold(engine: string, settings: AutoCompactSettings, contextMax: number): number | undefined {
  if (!settings.enabled || !usesNativeAutoCompact(engine)) return undefined;
  // Divide before multiplying so every safe integer window stays exact,
  // including percentage fractions such as 29% and the 100% upper bound.
  const tokens = Math.floor(contextMax / 100) * settings.threshold +
    Math.floor((contextMax % 100) * settings.threshold / 100);
  if (!Number.isSafeInteger(tokens) || tokens <= 0 ||
      (engine === "claude" && (tokens < 100_000 || tokens > 1_000_000))) {
    throw new Error(i18n.t(engine === "claude" ? "chat.autoCompactClaudeRange" : "chat.autoCompactTokenRange", { tokens }));
  }
  return tokens;
}

function readStoredSettings(): StoredSettings {
  const raw = readStoredJson(AUTO_COMPACT_STORAGE_KEY, (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const result: StoredSettings = {};
    for (const [sessionKey, entry] of Object.entries(value)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      result[sessionKey] = {
        enabled: record.enabled === true,
        threshold: normalizeAutoCompactThreshold(record.threshold),
      };
    }
    return result;
  });
  return raw ?? {};
}

let settingsSnapshot = readStoredSettings();
const listeners = new Set<() => void>();

function refreshSettingsSnapshot(): void {
  settingsSnapshot = readStoredSettings();
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener(AUTO_COMPACT_CHANGED_EVENT, refreshSettingsSnapshot);
  window.addEventListener("storage", refreshSettingsSnapshot);
}

export function subscribeAutoCompactSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAutoCompactSettings(sessionKey: string): AutoCompactSettings {
  if (!sessionKey) return DEFAULT_SETTINGS;
  return settingsSnapshot[sessionKey] ?? DEFAULT_SETTINGS;
}

function updateSettings(sessionKey: string, patch: Partial<AutoCompactSettings>): void {
  if (!sessionKey) return;
  const current = readStoredSettings();
  const previous = current[sessionKey] ?? DEFAULT_SETTINGS;
  const next = {
    ...current,
    [sessionKey]: {
      enabled: patch.enabled ?? previous.enabled,
      threshold: normalizeAutoCompactThreshold(patch.threshold ?? previous.threshold, previous.threshold),
    },
  };
  writeStored(AUTO_COMPACT_STORAGE_KEY, JSON.stringify(next));
  settingsSnapshot = next;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTO_COMPACT_CHANGED_EVENT));
  } else {
    for (const listener of listeners) listener();
  }
}

export function setAutoCompactEnabled(sessionKey: string, enabled: boolean): void {
  updateSettings(sessionKey, { enabled });
}

export function setAutoCompactThreshold(sessionKey: string, threshold: unknown): void {
  updateSettings(sessionKey, { threshold: normalizeAutoCompactThreshold(threshold) });
}

/** Carry a pending tab's settings onto the native session it just adopted.
 *  Without this, a threshold set on a brand-new chat is lost the moment the
 *  first send resolves the session id (the key changes from `new:<engine>:<ws>`
 *  to `<engine>/<id>`). A native key that already has settings wins — the user
 *  configured that session explicitly. */
export function migrateAutoCompactSettings(fromKey: string, toKey: string): void {
  if (!fromKey || !toKey || fromKey === toKey) return;
  const current = readStoredSettings();
  const pending = current[fromKey];
  if (!pending) return;
  const next = { ...current, [toKey]: current[toKey] ?? pending };
  delete next[fromKey];
  writeStored(AUTO_COMPACT_STORAGE_KEY, JSON.stringify(next));
  settingsSnapshot = next;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTO_COMPACT_CHANGED_EVENT));
  } else {
    for (const listener of listeners) listener();
  }
}

export function useAutoCompactSettings(sessionKey: string): AutoCompactSettings {
  const getSnapshot = useCallback(() => getAutoCompactSettings(sessionKey), [sessionKey]);
  return useSyncExternalStore(subscribeAutoCompactSettings, getSnapshot, () => DEFAULT_SETTINGS);
}

export interface AutoCompactDecisionInput {
  enabled: boolean;
  threshold: number;
  usagePct: number | undefined;
  streaming: boolean;
  compacting: boolean;
  /** Exact usage pct at the last attempt; null means untried or re-armed.
   *  Repeat attempts retain whole-percent growth buckets, so exposing more
   *  precise usage cannot turn tiny increments into a compaction loop. */
  attemptedAtPct: number | null;
  /** Confirmed live transport capability. OMP aborts and resumes natively;
   *  the host must not start a second chat turn to continue it. */
  canCompactWhileStreaming: boolean;
}

export function shouldAutoCompact({
  enabled,
  threshold,
  usagePct,
  streaming,
  compacting,
  attemptedAtPct,
  canCompactWhileStreaming,
}: AutoCompactDecisionInput): boolean {
  return Boolean(
    enabled &&
      (!streaming || canCompactWhileStreaming) &&
      !compacting &&
      usagePct !== undefined &&
      usagePct >= threshold &&
      (attemptedAtPct === null || Math.round(usagePct) > Math.round(attemptedAtPct)),
  );
}

/** Message slice that can park the session on a user decision. Structural on
 *  purpose: store messages satisfy it as-is, tests pass the bare fields. */
export interface ParkedInputMessage {
  question?: { status?: string } | null;
  grant?: { status?: string } | null;
  planReview?: { status?: string } | null;
}

/** True while the session waits on the user — the footer swaps the composer
 *  for a dock then, and sending anything would race the dialog the CLI is
 *  parked on. Answered/decided rows keep their history but stop matching. */
export function hasPendingUserInput(
  messages: readonly ParkedInputMessage[],
): boolean {
  return messages.some(
    (message) =>
      message.question?.status === "pending" ||
      message.grant?.status === "pending" ||
      message.planReview?.status === "awaiting_review" ||
      message.planReview?.status === "submitting",
  );
}

export interface AutoCompactResumeInput {
  trigger: "manual" | "threshold";
  /** Session error after the attempt. Every send clears it up front, so a
   *  non-null value means this attempt raised one — omp maps its compact RPC
   *  failure to 「压缩失败」 — and the task must not resume on top of it. */
  errorAfter: string | null;
  interrupted: boolean;
  streaming: boolean;
  queued: number;
  parked: boolean;
  sessionId: string | null;
}

/** After a threshold compaction the task picks itself back up — the point of
 *  auto-compact is not having to type 「继续」 by hand. A manual click stays
 *  the user's own move, and stop / queued messages / parked dialogs all mean
 *  someone else owns what happens next. */
export function shouldResumeAfterAutoCompact(
  input: AutoCompactResumeInput,
): boolean {
  return (
    input.trigger === "threshold" &&
    input.sessionId !== null &&
    input.errorAfter === null &&
    !input.interrupted &&
    !input.streaming &&
    input.queued === 0 &&
    !input.parked
  );
}
