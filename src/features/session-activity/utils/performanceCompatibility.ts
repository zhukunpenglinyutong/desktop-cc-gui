import type { AppSettings } from "../../../types";

export const SESSION_RADAR_DEFAULT_TICK_MS = 1_000;
export const SESSION_RADAR_COMPATIBILITY_TICK_MS = 5_000;

export function isPerformanceCompatibilityModeEnabled(
  settings: Pick<AppSettings, "performanceCompatibilityModeEnabled"> | null | undefined,
) {
  return settings?.performanceCompatibilityModeEnabled === true;
}

export function resolveSessionRadarTickMs(
  performanceCompatibilityModeEnabled: boolean,
) {
  return performanceCompatibilityModeEnabled
    ? SESSION_RADAR_COMPATIBILITY_TICK_MS
    : SESSION_RADAR_DEFAULT_TICK_MS;
}

export function shouldPauseSessionRadarTick(
  performanceCompatibilityModeEnabled: boolean,
  visibilityState: DocumentVisibilityState | undefined,
) {
  return performanceCompatibilityModeEnabled && visibilityState === "hidden";
}
