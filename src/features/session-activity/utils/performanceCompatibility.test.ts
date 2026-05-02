import { describe, expect, it } from "vitest";
import {
  SESSION_RADAR_COMPATIBILITY_TICK_MS,
  SESSION_RADAR_DEFAULT_TICK_MS,
  isPerformanceCompatibilityModeEnabled,
  resolveSessionRadarTickMs,
  shouldPauseSessionRadarTick,
} from "./performanceCompatibility";

describe("performance compatibility helpers", () => {
  it("defaults compatibility mode to disabled", () => {
    expect(isPerformanceCompatibilityModeEnabled(null)).toBe(false);
    expect(isPerformanceCompatibilityModeEnabled(undefined)).toBe(false);
    expect(
      isPerformanceCompatibilityModeEnabled({
        performanceCompatibilityModeEnabled: false,
      }),
    ).toBe(false);
  });

  it("enables compatibility mode only for explicit true", () => {
    expect(
      isPerformanceCompatibilityModeEnabled({
        performanceCompatibilityModeEnabled: true,
      }),
    ).toBe(true);
  });

  it("keeps the default radar interval unless compatibility is enabled", () => {
    expect(resolveSessionRadarTickMs(false)).toBe(SESSION_RADAR_DEFAULT_TICK_MS);
    expect(resolveSessionRadarTickMs(true)).toBe(SESSION_RADAR_COMPATIBILITY_TICK_MS);
  });

  it("pauses radar ticks only when compatibility is enabled and document is hidden", () => {
    expect(shouldPauseSessionRadarTick(false, "hidden")).toBe(false);
    expect(shouldPauseSessionRadarTick(true, "visible")).toBe(false);
    expect(shouldPauseSessionRadarTick(true, "hidden")).toBe(true);
  });
});
