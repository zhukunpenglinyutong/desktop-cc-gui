import type {
  Disposer,
  PluginContext,
  UsageLimitProviderId,
  UsageLimitsResult,
  UsagePriceInfo,
  UsageScanProgress,
  UsageScanSummary,
  UsageSourceStatus,
  UsageStatsBucket,
  UsageStatsResult,
} from "@ccgui/plugin-sdk";
import { invoke, listen } from "@/lib/transport";
import { withCredentialConsent } from "@/lib/credential-consent";
import { runAsPlugin, withAuthorizedHostInvoke } from "./hardening";

/**
 * ctx.usage / ctx.limits (SDK 0.3.25). Numbers come from the host's read-only
 * usage data layer (src-tauri/src/usage_stats) and limit lookup
 * (src-tauri/src/usage_limits); the plugin only displays them. Every call is
 * gated twice: here by the manifest permission, and again in Rust by
 * `require_grant` against the installed manifest and enabled state.
 */

export type UsageTopic = "changed" | "progress";

/** What the host command receives: the plugin query plus the caller's
 *  timezone, filled here so plugin authors never deal with offsets. */
export interface UsageStatsHostQuery {
  from: string;
  to: string;
  bucket: UsageStatsBucket;
  tzOffsetMinutes: number;
}

export interface LimitsHostOptions {
  providers: UsageLimitProviderId[] | null;
  refresh: boolean;
}

export interface UsageBackend {
  usageQuery?(id: string, query: UsageStatsHostQuery): Promise<UsageStatsResult>;
  usageSources?(id: string): Promise<UsageSourceStatus[]>;
  usageRefresh?(id: string): Promise<UsageScanSummary>;
  usageRescan?(id: string): Promise<UsageScanSummary>;
  usagePrices?(id: string): Promise<UsagePriceInfo>;
  usageUpdatePrices?(id: string): Promise<UsagePriceInfo>;
  usageSubscribe?(topic: UsageTopic, cb: (payload: unknown) => void): Disposer;
  limitsGet?(id: string, options: LimitsHostOptions): Promise<UsageLimitsResult>;
}

const TOPICS: Record<UsageTopic, string> = {
  changed: "usage-stats://changed",
  progress: "usage-stats://scan-progress",
};
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_RANGE_DAYS = 3700;
const PROVIDERS: readonly UsageLimitProviderId[] = ["claude", "codex"];
const UNAVAILABLE = "Usage statistics are unavailable on this host";

function parseDay(value: unknown, name: string): Date {
  const match = typeof value === "string" ? DATE_RE.exec(value) : null;
  if (!match) throw new Error(`${name} must be a YYYY-MM-DD date string`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d, 12);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new Error(`${name} is not a valid calendar date`);
  }
  return date;
}

/** Minutes east of UTC on the given local day (noon avoids DST edges). */
export function tzOffsetForDay(date: Date): number {
  return -date.getTimezoneOffset();
}

export function normalizeUsageQuery(query: unknown): UsageStatsHostQuery {
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    throw new Error("query must be an object");
  }
  const { from, to, bucket } = query as Record<string, unknown>;
  const start = parseDay(from, "from");
  const end = parseDay(to, "to");
  if (start > end) throw new Error("from must not be after to");
  const inclusiveDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (inclusiveDays > MAX_RANGE_DAYS) {
    throw new Error(`date range must not exceed ${MAX_RANGE_DAYS} days`);
  }
  if (bucket !== undefined && bucket !== "day" && bucket !== "hour") {
    throw new Error('bucket must be "day" or "hour"');
  }
  return {
    from: from as string,
    to: to as string,
    bucket: (bucket as UsageStatsBucket | undefined) ?? "day",
    tzOffsetMinutes: tzOffsetForDay(end),
  };
}

export function normalizeLimitsOptions(options: unknown): LimitsHostOptions {
  if (options === undefined) return { providers: null, refresh: false };
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new Error("options must be an object");
  }
  const { providers, refresh } = options as Record<string, unknown>;
  if (refresh !== undefined && typeof refresh !== "boolean") {
    throw new Error("refresh must be a boolean");
  }
  if (providers !== undefined) {
    if (!Array.isArray(providers) || providers.some((p) => !PROVIDERS.includes(p as UsageLimitProviderId))) {
      throw new Error(`providers must be a subset of ${PROVIDERS.join(", ")}`);
    }
  }
  return {
    providers: providers === undefined ? null : [...new Set(providers as UsageLimitProviderId[])],
    refresh: refresh === true,
  };
}

export function createUsageCaps(
  id: string,
  backend: UsageBackend,
  requirePermission: (capability: string) => void,
  track: (d: Disposer) => Disposer,
): Pick<PluginContext, "usage" | "limits"> {
  const subscribe = <T>(topic: UsageTopic, cb: (payload: T) => void): Disposer => {
    requirePermission("usage.read");
    if (typeof cb !== "function") throw new Error("callback must be a function");
    if (!backend.usageSubscribe) throw new Error(UNAVAILABLE);
    return track(backend.usageSubscribe(topic, (payload) => runAsPlugin(() => cb(payload as T))));
  };
  // The IPC must be marked as SDK-authorized synchronously: plugin callbacks
  // (onChange, activate) run under runAsPlugin, and the hardening guard
  // rejects any invoke that is not wrapped — exactly like storage/workspace.
  const call = async <T>(method: keyof UsageBackend, run: () => Promise<T>): Promise<T> => {
    requirePermission("usage.read");
    if (!backend[method]) throw new Error(UNAVAILABLE);
    return withAuthorizedHostInvoke(run);
  };

  return {
    usage: {
      async query(query) {
        requirePermission("usage.read");
        const normalized = normalizeUsageQuery(query);
        if (!backend.usageQuery) throw new Error(UNAVAILABLE);
        return withAuthorizedHostInvoke(() => backend.usageQuery!(id, normalized));
      },
      sources: () => call("usageSources", () => backend.usageSources!(id)),
      refresh: () => call("usageRefresh", () => backend.usageRefresh!(id)),
      rescan: () => call("usageRescan", () => backend.usageRescan!(id)),
      prices: () => call("usagePrices", () => backend.usagePrices!(id)),
      updatePrices: () => call("usageUpdatePrices", () => backend.usageUpdatePrices!(id)),
      onChange: (cb) => subscribe<{ scannedAt: number }>("changed", cb),
      onScanProgress: (cb) => subscribe<UsageScanProgress>("progress", cb),
    },
    limits: {
      async get(options) {
        requirePermission("limits.read");
        const normalized = normalizeLimitsOptions(options);
        if (!backend.limitsGet) throw new Error("Usage limits are unavailable on this host");
        return withAuthorizedHostInvoke(() => backend.limitsGet!(id, normalized));
      },
    },
  };
}

/** Host event → callback; the returned disposer also covers the window where
 *  `listen` has not resolved yet. */
export function subscribeUsageTopic(topic: UsageTopic, cb: (payload: unknown) => void): Disposer {
  let disposed = false;
  let unlisten: (() => void) | null = null;
  void listen<unknown>(TOPICS[topic], (event) => {
    if (!disposed) cb(event.payload);
  })
    .then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    })
    .catch(() => {
      // A host without the event bridge simply never fires; the plugin's
      // own polling (query/refresh) still works.
    });
  return () => {
    disposed = true;
    unlisten?.();
    unlisten = null;
  };
}

/** IPC half of the backend seam (bound in loader.ts). */
export const ipcUsageBackend: Required<UsageBackend> = {
  usageQuery: (pluginId, query) => invoke("plugin_usage_query", { pluginId, query }),
  usageSources: (pluginId) => invoke("plugin_usage_sources", { pluginId }),
  usageRefresh: (pluginId) => invoke("plugin_usage_refresh", { pluginId }),
  usageRescan: (pluginId) => invoke("plugin_usage_rescan", { pluginId }),
  usagePrices: (pluginId) => invoke("plugin_usage_prices", { pluginId }),
  usageUpdatePrices: (pluginId) => invoke("plugin_usage_update_prices", { pluginId }),
  usageSubscribe: subscribeUsageTopic,
  // The host asks the desktop user once before it reads any CLI login
  // (lib/credential-consent.ts); the first invoke stays synchronous so the
  // bridge's single authorized IPC hop still covers it.
  limitsGet: (pluginId, options) =>
    withCredentialConsent(() =>
      invoke("plugin_limits_get", { pluginId, providers: options.providers, refresh: options.refresh }),
    ),
};
